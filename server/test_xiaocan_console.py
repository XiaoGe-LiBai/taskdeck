"""资产工作台单测：字段归一、分段解析、单段失败隔离。不打真实网关。

    python3 test_xiaocan_console.py
"""
from __future__ import annotations

import unittest
from unittest import mock

import xiaocan_console as console
import xiaocan_methods as methods

ACCOUNT = {"id": 1, "account_info": "9001", "xc_user_id": "8002", "access_token": "tok"}


class ParseSectionsTests(unittest.TestCase):
    def test_default_is_profile_and_assets(self) -> None:
        self.assertEqual(console.parse_sections(None), ("profile", "assets"))

    def test_unknown_sections_ignored(self) -> None:
        self.assertEqual(console.parse_sections("cards,evil"), ("cards",))

    def test_all_unknown_falls_back(self) -> None:
        self.assertEqual(console.parse_sections("nope"), ("profile", "assets"))


class NormalizeTests(unittest.TestCase):
    def test_tasks_only_completed_3_is_claimable(self) -> None:
        res = {"data": {"list": [
            {"id": 1, "title": "看视频", "point": 30, "completed": 3},
            {"id": 2, "title": "下单", "point": 100, "completed": 1},
        ]}}
        out = console._normalize_tasks(res)
        self.assertEqual(out["claimable_count"], 1)
        self.assertEqual(out["claimable_point"], 30)
        self.assertFalse(out["items"][1]["claimable"])

    def test_points_reads_point_block(self) -> None:
        res = {"point": {"points": 2, "items": [{"task_id": 7, "task_name": "签到", "point": 30}]}}
        out = console._normalize_points(res)
        self.assertEqual(out["points"], 2)
        self.assertEqual(out["items"][0]["task_name"], "签到")

    def test_cards_grouped_and_categorized(self) -> None:
        number = {"can_use_number": 3, "expiring_soon_number": 1}
        listing = {"list": [
            {"id": 11, "card": {"id": 5, "name": "全平台免单卡", "desc": ""}, "expire_time": 200},
            {"id": 12, "card": {"id": 5, "name": "全平台免单卡", "desc": ""}, "expire_time": 200},
            {"id": 13, "card": {"id": 6, "name": "腾讯视频周卡", "desc": ""}, "expire_time": 100},
            {"id": 14, "card": {"id": 7, "name": "某品牌 20 元券", "desc": ""}, "expire_time": 300},
        ]}
        out = console._normalize_cards(number, listing)
        self.assertEqual(out["can_use_number"], 3)
        self.assertEqual(out["total"], 4)
        by_name = {item["name"]: item for item in out["items"]}
        self.assertEqual(by_name["全平台免单卡"]["count"], 2)
        self.assertEqual(by_name["全平台免单卡"]["category"], "免单卡")
        self.assertEqual(by_name["腾讯视频周卡"]["category"], "影音卡")
        self.assertEqual(by_name["某品牌 20 元券"]["category"], "品牌券")

    def test_redpacks_normalized(self) -> None:
        out = console._normalize_redpacks(
            {"num": 1},
            {"unused_items": [{
                "user_red_pack_id": 9, "name": "红包", "value_num": 500,
                "threshold_num": 2000, "end_time": 100,
                "limit": {"bwc_platforms": [1, 2]},
            }]},
        )
        self.assertEqual(out["num"], 1)
        self.assertEqual(out["items"][0]["value_num"], 500)
        self.assertEqual(out["items"][0]["platforms"], [1, 2])

    def test_lottery_reads_lottery_info(self) -> None:
        out = console._normalize_lottery(
            {"lottery_info": {"lucky_times": 3, "day_num": 5}},
            {"progress": [{"step": 1, "title": "抽 10 次", "target": 10, "current": 4}]},
        )
        self.assertEqual(out["lucky_times"], 3)
        self.assertEqual(out["day_num"], 5)
        self.assertEqual(out["steps"][0]["target"], 10)

    def test_freeorder_reads_info_block(self) -> None:
        out = console._normalize_freeorder({"info": {"had": True, "used": False, "user_free_card_id": 88}})
        self.assertTrue(out["had"])
        self.assertFalse(out["used"])
        self.assertEqual(out["card_id"], 88)

    def test_rain_normalized(self) -> None:
        out = console._normalize_rain(
            {"has_event": True, "event": {"event_id": 4, "begin_time": 100, "end_time": 200, "status": 2}},
        )
        self.assertTrue(out["has_event"])
        self.assertEqual(out["event_id"], 4)
        self.assertEqual(out["status"], 2)


class OverviewTests(unittest.TestCase):
    def test_single_section_failure_isolated(self) -> None:
        fake = {
            "get_user_info": {"user_info": {"nickname": "小蚕", "silk": 1234}},
            "get_user_task_v2": RuntimeError("gateway down"),
        }

        def call(_account, key, _body=None, **_kwargs):
            value = fake[key]
            if isinstance(value, Exception):
                raise value
            return value

        with mock.patch.object(methods, "call", side_effect=call):
            out = console.overview(ACCOUNT, ("profile", "assets"))

        self.assertFalse(out["ok"])
        self.assertEqual(out["data"]["profile"]["nickname"], "小蚕")
        self.assertIn("assets", out["errors"])
        self.assertNotIn("profile", out["errors"])

    def test_sign_in_history_carries_user_id(self) -> None:
        """上游对 SignInHistory 校验 UserId>0，缺了会报 [10001] invalid field UserId。"""
        calls: list[tuple[str, dict]] = []

        def call(_account, key, body=None, **_kwargs):
            calls.append((key, dict(body or {})))
            return {}

        with mock.patch.object(methods, "call", side_effect=call):
            console.overview(ACCOUNT, ("signin",))

        keys = {key: body for key, body in calls}
        self.assertEqual(keys["get_sign_in_history"]["user_id"], 8002)

    def test_user_id_injected_only_for_activity_task(self) -> None:
        calls: list[tuple[str, dict]] = []

        def call(_account, key, body=None, **kwargs):
            calls.append((key, dict(body or {})))
            self.assertEqual(kwargs.get("city_code"), None)
            return {}

        with mock.patch.object(methods, "call", side_effect=call):
            console.overview(ACCOUNT, ("tasks",))

        key, body = calls[0]
        self.assertEqual(key, "get_daily_tasks")
        self.assertEqual(body["user_id"], 8002)


if __name__ == "__main__":
    unittest.main()
