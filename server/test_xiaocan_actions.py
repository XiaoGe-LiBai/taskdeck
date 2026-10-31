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


if __name__ == "__main__":
    unittest.main()
