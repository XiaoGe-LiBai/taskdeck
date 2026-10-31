"""小蚕动作层单测：只验证「调哪个方法、参数怎么拼、失败怎么归类」，不打真实网关。

    python3 test_xiaocan_actions.py
"""
from __future__ import annotations

import unittest
from unittest import mock

import xiaocan_actions as actions
import xiaocan_bridge as xc

ACCOUNT = {
    "id": 7,
    "user_id": 1,
    "account_info": "9001",   # silk_id
    "xc_user_id": "8002",
    "access_token": "tok-abc",
}


class CallMappingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.calls: list[dict] = []

        def fake_rpc(server, method, payload=None, **kwargs):
            self.calls.append({"server": server, "method": method, "payload": payload, **kwargs})
            return {"ok": True}

        patcher = mock.patch.object(xc, "xiaocan_rpc", side_effect=fake_rpc)
        patcher.start()
        self.addCleanup(patcher.stop)

    def one(self) -> dict:
        self.assertEqual(len(self.calls), 1, self.calls)
        return self.calls[0]

    def test_sign_in_uses_activity_task_service(self) -> None:
        actions.do_sign_in(ACCOUNT)
        call = self.one()
        self.assertEqual(call["server"], "ActivityTask")
        self.assertEqual(call["method"], "ActivityTaskMobileService.SignIn")
        self.assertEqual(call["payload"], {"silk_id": 9001})
        self.assertEqual(call["app_id"], 10, "活动类接口用 app_id=10")

    def test_status_uses_vip_rights_service(self) -> None:
        actions.sign_in_status(ACCOUNT)
        call = self.one()
        self.assertEqual(call["server"], "SilkwormVip")
        self.assertEqual(call["method"], "VipRightsService.UserSignInDays")

    def test_lottery_uses_vip_rights_service(self) -> None:
        actions.sign_in_lottery(ACCOUNT)
        self.assertEqual(self.one()["method"], "VipRightsService.SignInLottery")

    def test_task_overview_uses_user_task_v2(self) -> None:
        actions.user_task_overview(ACCOUNT)
        self.assertEqual(self.one()["method"], "ActivityTaskMobileService.UserTaskV2")

    def test_complete_task_event_passes_type_and_order(self) -> None:
        actions.complete_task_event(ACCOUNT, 4, 123456)
        call = self.one()
        self.assertEqual(call["server"], "SilkwormMarketing")
        self.assertEqual(call["method"], "SilkwormMobileMarketingService.CompleteTaskEvent")
        self.assertEqual(call["payload"]["task_type"], 4)
        self.assertEqual(call["payload"]["promotion_order_id"], 123456)

    def test_credentials_are_forwarded(self) -> None:
        actions.do_sign_in(ACCOUNT)
        call = self.one()
        self.assertEqual(call["user_id"], "8002")
        self.assertEqual(call["silk_id"], "9001")
        self.assertEqual(call["token"], "tok-abc")
        self.assertEqual(call["app_id"], 10)

    def test_city_header_only_when_account_has_city(self) -> None:
        actions.do_sign_in(ACCOUNT)
        self.assertIsNone(self.one()["city_code"])
        actions.do_sign_in({**ACCOUNT, "city_code": 440305})
        self.assertEqual(self.calls[-1]["city_code"], 440305)

    def test_missing_credentials_fails_before_request(self) -> None:
        with self.assertRaises(ValueError):
            actions.do_sign_in({**ACCOUNT, "access_token": ""})
        self.assertEqual(self.calls, [])


class DailyRunTests(unittest.TestCase):
    def test_steps_run_in_order_and_isolate_failures(self) -> None:
        seen: list[str] = []

        def fake(account, server, method, body):
            seen.append(method)
            if method == "ActivityTaskMobileService.SignIn":
                raise RuntimeError("今日已签到")
            if method == "VipRightsService.SignInLottery":
                raise RuntimeError("网络超时")
            return {"ok": True}

        with mock.patch.object(actions, "_call", side_effect=fake):
            result = actions.run_daily(ACCOUNT)

        self.assertEqual(seen, [
            "ActivityTaskMobileService.SignIn",
            "VipRightsService.SignInLottery",
            "ActivityTaskMobileService.UserTaskV2",
        ])
        by_step = {s["step"]: s for s in result["steps"]}
        self.assertTrue(by_step["元宝签到"]["skipped"], "「已签到」应判定为跳过而不是失败")
        self.assertFalse(by_step["会员签到抽奖"]["skipped"])
        self.assertEqual(by_step["会员签到抽奖"]["error"], "网络超时")
        self.assertTrue(by_step["任务总览"]["ok"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["skipped"], 1)

    def test_all_ok(self) -> None:
        with mock.patch.object(actions, "_call", return_value={"ok": True}):
            result = actions.run_daily(ACCOUNT)
        self.assertTrue(result["ok"])
        self.assertEqual((result["failed"], result["skipped"]), (0, 0))


class StoreSearchTests(unittest.TestCase):
    """店铺检索：只校验参数拼装与主备回落，不发真实请求。"""

    def setUp(self) -> None:
        self.calls: list[dict] = []

        def fake_rpc(server, method, payload=None, **kwargs):
            self.calls.append({"server": server, "method": method, "payload": payload, **kwargs})
            if method == "FusionService.GetFeedPromotions":
                return self.feed_result
            return {"promotion_list": [{"id": 1}]}

        self.feed_result = {"feed_items": [{"poi": 1}]}
        patcher = mock.patch.object(xc, "xiaocan_rpc", side_effect=fake_rpc)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_feed_uses_fusion_first(self) -> None:
        result = actions.feed_stores(ACCOUNT, lat=22.54, lon=114.06, city_code=440305)
        self.assertEqual(result["items"], [{"poi": 1}], "统一暴露 items 给前端")
        call = self.calls[0]
        self.assertEqual(call["server"], "SilkwormFusion")
        self.assertEqual(call["method"], "FusionService.GetFeedPromotions")
        self.assertEqual(call["payload"]["lat"], 22.54)
        self.assertEqual(call["payload"]["lon"], 114.06)
        self.assertEqual(call["payload"]["number"], 20)
        self.assertTrue(call["payload"]["is_show_mt"])
        self.assertEqual(call["city_code"], 440305)
        self.assertEqual(len(self.calls), 1, "主源有数据就不该再打备源")

    def test_feed_falls_back_when_primary_empty(self) -> None:
        self.feed_result = {"feed_items": []}
        actions.feed_stores(ACCOUNT, lat=1, lon=2)
        self.assertEqual([c["method"] for c in self.calls],
                         ["FusionService.GetFeedPromotions", "RecService.GetStorePromotionList"])
        fallback = self.calls[-1]["payload"]
        self.assertEqual(fallback["city_code"], actions.DEFAULT_CITY_CODE)
        self.assertEqual(fallback["promotion_sort"], 4)

    def test_feed_falls_back_when_primary_raises(self) -> None:
        self.feed_result = None

        def flaky(server, method, payload=None, **kwargs):
            self.calls.append({"server": server, "method": method, "payload": payload, **kwargs})
            if method.startswith("FusionService"):
                raise RuntimeError("WAF 403")
            return {"promotion_list": []}

        with mock.patch.object(xc, "xiaocan_rpc", side_effect=flaky):
            actions.feed_stores(ACCOUNT, lat=1, lon=2)
        self.assertEqual(self.calls[-1]["server"], "SilkwormRec")

    def test_search_trims_keyword_and_normalises_list(self) -> None:
        result = actions.search_stores(ACCOUNT, "  瑞幸  ", lat=1, lon=2)
        call = self.calls[0]
        self.assertEqual(call["method"], "FusionService.SearchPromotions")
        self.assertEqual(call["payload"]["keyword"], "瑞幸")
        self.assertEqual(result["promotion_list"], [{"id": 1}])

    def test_search_rejects_empty_keyword(self) -> None:
        with self.assertRaises(ValueError):
            actions.search_stores(ACCOUNT, "   ", lat=1, lon=2)
        self.assertEqual(self.calls, [])

    def test_explore_uses_page_number(self) -> None:
        result = actions.explore_stores(ACCOUNT, lat=1, lon=2, offset=40, limit=20)
        self.assertEqual(result["items"], [{"id": 1}], "explore 的 list 也要归一到 items")
        body = self.calls[0]["payload"]
        self.assertEqual(self.calls[0]["method"], "ExploreMobile.ListGroupPromotion")
        self.assertEqual(body["page"], {"page_num": 3, "page_size": 20})
        self.assertEqual(body["loc"], {"lat": 1.0, "lng": 2.0})
        self.assertTrue(body["filter"]["is_can_order"])

    def test_limit_is_clamped(self) -> None:
        actions.explore_stores(ACCOUNT, lat=1, lon=2, limit=99)
        self.assertEqual(self.calls[0]["payload"]["page"]["page_size"], actions.MAX_PAGE_SIZE)
        # 0/空 视为「没传」，走默认值；负数才是非法，被夹到 1
        actions.explore_stores(ACCOUNT, lat=1, lon=2, limit=0)
        self.assertEqual(self.calls[-1]["payload"]["page"]["page_size"], actions.MAX_PAGE_SIZE)
        actions.explore_stores(ACCOUNT, lat=1, lon=2, limit=-5)
        self.assertEqual(self.calls[-1]["payload"]["page"]["page_size"], 1)

    def test_missing_or_bad_location(self) -> None:
        for kwargs in ({"lat": None, "lon": 2}, {"lat": 1, "lon": None},
                       {"lat": "abc", "lon": 2}, {"lat": 91, "lon": 2}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                actions.feed_stores(ACCOUNT, **kwargs)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()