"""扩展动作单测：动作表完整性、参数校验、请求体拼装、统一注入。

    python3 test_xiaocan_extras.py
"""
from __future__ import annotations

import unittest
from unittest import mock

import xiaocan_extras as extras
import xiaocan_methods as methods

ACCOUNT = {"id": 1, "account_info": "9001", "xc_user_id": "8002", "access_token": "tok"}


class CatalogTests(unittest.TestCase):
    def test_every_action_has_rpc_mapping(self) -> None:
        missing = [key for key in extras.PARAMS if key not in methods.METHODS]
        self.assertEqual(missing, [], "动作表里不能有未映射的方法")

    def test_actions_cover_main_groups(self) -> None:
        keys = set(extras.available())
        for key in ("get_daily_tasks", "user_claim_points", "do_lottery_spin",
                    "grab_redpack_rain", "client_withdraw", "get_order_list",
                    "get_user_card_list", "exchange_goods", "get_messages"):
            self.assertIn(key, keys)


class BuildBodyTests(unittest.TestCase):
    def test_defaults_applied(self) -> None:
        body = extras.build_body(ACCOUNT, "get_order_list", {})
        self.assertEqual(body, {"offset": 0, "number": 10, "order_status": 0})
        self.assertNotIn("silk_id", body, "silk_id 由 methods.call 统一注入")

    def test_required_param_missing(self) -> None:
        with self.assertRaises(ValueError) as caught:
            extras.build_body(ACCOUNT, "user_claim_points", {})
        self.assertIn("task_id", str(caught.exception))

    def test_unknown_param_rejected(self) -> None:
        with self.assertRaises(ValueError) as caught:
            extras.build_body(ACCOUNT, "get_order_list", {"evil": 1})
        self.assertIn("evil", str(caught.exception))

    def test_bad_type_rejected(self) -> None:
        with self.assertRaises(ValueError):
            extras.build_body(ACCOUNT, "do_lottery_spin", {"prize_type": "abc"})

    def test_string_number_is_cast(self) -> None:
        body = extras.build_body(ACCOUNT, "do_lottery_spin", {"prize_type": "3"})
        self.assertEqual(body["prize_type"], 3)

    def test_fixed_body_injected(self) -> None:
        self.assertEqual(extras.build_body(ACCOUNT, "get_unreceived_point_records", {})["status"], 1)
        self.assertEqual(extras.build_body(ACCOUNT, "get_user_card_number", {})["card_number_mode"], 1)

    def test_user_id_injected_when_needed(self) -> None:
        body = extras.build_body(ACCOUNT, "user_claim_points", {"task_id": 7})
        self.assertEqual(body["user_id"], 8002)
        self.assertEqual(body["task_id"], 7)
        self.assertNotIn("user_id", extras.build_body(ACCOUNT, "get_order_list", {}))

    def test_unknown_action(self) -> None:
        with self.assertRaises(ValueError):
            extras.build_body(ACCOUNT, "not_exists", {})


class RunTests(unittest.TestCase):
    def test_run_forwards_to_methods_call(self) -> None:
        with mock.patch.object(methods, "call", return_value={"ok": 1}) as call:
            result = extras.run(ACCOUNT, "get_lottery_info", {})
        self.assertEqual(result, {"ok": 1})
        self.assertEqual(call.call_args.args[1], "get_lottery_info")
        self.assertEqual(call.call_args.args[2], {})

    def test_run_blocks_before_network_on_bad_params(self) -> None:
        with mock.patch.object(methods, "call") as call:
            with self.assertRaises(ValueError):
                extras.run(ACCOUNT, "client_withdraw", {})
        call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
