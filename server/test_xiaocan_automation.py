"""自动化任务目录：分组、开关归属、提醒触发时刻。

    python3 test_xiaocan_automation.py
"""
from __future__ import annotations

import unittest
from datetime import datetime
from unittest import mock

import xiaocan_automation as auto


class CatalogTests(unittest.TestCase):
    def test_categories_are_known(self) -> None:
        for task in auto.TASKS:
            self.assertIn(task["category"], auto.GROUPS, task["key"])
            self.assertTrue(task["time_label"], task["key"])
            self.assertTrue(task["tip"], task["key"])

    def test_task_keys_unique(self) -> None:
        keys = [task["key"] for task in auto.TASKS]
        self.assertEqual(len(keys), len(set(keys)))

    def test_script_tasks_have_feature_and_script(self) -> None:
        for task in auto.TASKS:
            if task["executor"] != "script":
                continue
            self.assertTrue(task.get("feature"), task["key"])
            self.assertTrue(task.get("script", "").endswith(".py"), task["key"])

    def test_builtin_tasks_have_daily_at(self) -> None:
        for task in auto.TASKS:
            if task["executor"] != "builtin":
                continue
            self.assertTrue(task.get("daily_at"), task["key"])

    def test_param_defs_only_on_builtin(self) -> None:
        """脚本任务的参数在脚本里写死，给表单就是假的。"""
        for task in auto.TASKS:
            if task.get("param_defs"):
                self.assertEqual(task["executor"], "builtin", task["key"])

    def test_reminder_tasks_have_daily_at(self) -> None:
        for task in auto.TASKS:
            if task.get("kind") != "reminder":
                continue
            self.assertRegex(task["daily_at"], r"^\d{2}:\d{2}$")
            self.assertIn(task["key"], auto.REMINDER_RUNNERS)


class ToggleRoutingTests(unittest.TestCase):
    def test_script_task_reads_account_features(self) -> None:
        task = auto.BY_KEY["checkin"]
        account = {"id": 1, "features": {"每日签到": True}}
        self.assertTrue(auto.task_enabled(task, account, {}))

    def test_reminder_task_reads_flags(self) -> None:
        task = auto.BY_KEY["coupon_remind"]
        account = {"id": 7, "features": {}}
        self.assertFalse(auto.task_enabled(task, account, {}))
        self.assertTrue(auto.task_enabled(task, account, {(7, "coupon_remind"): True}))
        # 不能串账号
        self.assertFalse(auto.task_enabled(task, account, {(8, "coupon_remind"): True}))

    def test_set_task_writes_to_right_store(self) -> None:
        account = {"id": 3, "features": {}}
        with mock.patch("xiaocan_bridge.set_feature") as set_feature:
            out = auto.set_task(account, "checkin", True)
        set_feature.assert_called_once_with(3, "每日签到", True)
        self.assertEqual(out["store"], "features")

        with mock.patch.object(auto, "set_reminder") as set_reminder:
            out = auto.set_task(account, "credential_remind", True)
        set_reminder.assert_called_once_with(3, "credential_remind", True)
        self.assertEqual(out["store"], "builtin")

    def test_set_task_rejects_unknown(self) -> None:
        with self.assertRaises(ValueError):
            auto.set_task({"id": 1}, "nope", True)


class DueTests(unittest.TestCase):
    def test_before_time_not_due(self) -> None:
        with mock.patch.object(auto, "_last_run_date", return_value=""):
            self.assertFalse(auto._due("credential_remind", "08:00", datetime(2026, 11, 2, 7, 59)))

    def test_after_time_due_once_per_day(self) -> None:
        with mock.patch.object(auto, "_last_run_date", return_value="") as last:
            self.assertTrue(auto._due("credential_remind", "08:00", datetime(2026, 11, 2, 8, 0)))
        with mock.patch.object(auto, "_last_run_date", return_value="2026-11-02"):
            self.assertFalse(auto._due("credential_remind", "08:00", datetime(2026, 11, 2, 9, 30)))

    def test_missed_slot_catches_up_same_day(self) -> None:
        """容器整点重启错过时刻时，当天仍补跑一次。"""
        with mock.patch.object(auto, "_last_run_date", return_value="2026-11-01"):
            self.assertTrue(auto._due("coupon_remind", "08:30", datetime(2026, 11, 2, 15, 0)))

    def test_bad_time_label_not_due(self) -> None:
        with mock.patch.object(auto, "_last_run_date", return_value=""):
            self.assertFalse(auto._due("x", "not-a-time", datetime(2026, 11, 2, 9, 0)))


class OverviewTests(unittest.TestCase):
    def test_counts_per_group(self) -> None:
        accounts = [
            {"id": 1, "nickname": "甲", "account_info": "9001", "features": {"每日签到": True}},
            {"id": 2, "nickname": "乙", "account_info": "9002", "features": {}},
        ]
        with mock.patch.object(auto, "reminder_flags", return_value={(2, "coupon_remind"): True}):
            out = auto.overview(accounts)

        self.assertEqual([g["key"] for g in out["groups"]], ["member", "daily", "custom"])
        daily = next(g for g in out["groups"] if g["key"] == "daily")
        checkin = next(t for t in daily["tasks"] if t["key"] == "checkin")
        self.assertEqual(checkin["enabled_count"], 1)
        self.assertEqual(checkin["account_count"], 2)

        custom = next(g for g in out["groups"] if g["key"] == "custom")
        coupon = next(t for t in custom["tasks"] if t["key"] == "coupon_remind")
        self.assertEqual(coupon["enabled_account_ids"], [2])


if __name__ == "__main__":
    unittest.main()


class ParamTests(unittest.TestCase):
    def test_defaults_from_defs(self) -> None:
        task = auto.BY_KEY["dual_rebate"]
        self.assertEqual(auto.default_params(task), {
            "interval_minutes": 60, "scan_limit": 300, "keyword": "",
        })

    def test_slots_follow_interval_param(self) -> None:
        task = auto.BY_KEY["dual_rebate"]
        hourly = auto._slots_of(task, {"interval_minutes": 60})
        self.assertEqual(hourly[:3], ["09:00", "10:00", "11:00"])
        self.assertEqual(hourly[-1], "23:00")
        half = auto._slots_of(task, {"interval_minutes": 30})
        self.assertIn("09:30", half)
        self.assertGreater(len(half), len(hourly))

    def test_single_daily_task_has_one_slot(self) -> None:
        task = auto.BY_KEY["vip_sign"]
        self.assertEqual(auto._slots_of(task, {}), ["08:30"])

    def test_due_slot_window(self) -> None:
        from datetime import datetime
        with mock.patch.object(auto.core, "get_setting", return_value=""):
            self.assertTrue(auto._due_slot("vip_sign", 1, "08:30", datetime(2026, 11, 2, 8, 35)))
            self.assertFalse(auto._due_slot("vip_sign", 1, "08:30", datetime(2026, 11, 2, 8, 45)))
            self.assertFalse(auto._due_slot("vip_sign", 1, "08:30", datetime(2026, 11, 2, 8, 29)))
        with mock.patch.object(auto.core, "get_setting", return_value="2026-11-02 08:30"):
            self.assertFalse(auto._due_slot("vip_sign", 1, "08:30", datetime(2026, 11, 2, 8, 31)))
