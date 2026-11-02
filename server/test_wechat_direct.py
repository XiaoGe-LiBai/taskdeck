"""电脑微信直连单测：配对码生命周期、上报校验、脚本可编译。

    python3 test_wechat_direct.py
"""
from __future__ import annotations

import unittest
from unittest import mock

import wechat_direct


class PairTests(unittest.TestCase):
    def test_pair_is_six_digits_and_scoped(self) -> None:
        created = wechat_direct.create_pair(7)
        code = created["code"]
        self.assertEqual(len(code), 10)
        self.assertTrue(code.isalnum())
        self.assertEqual(wechat_direct.pair_status(code, 7)["state"], "waiting")
        # 别人的码查不到（按 user_id 隔离）
        self.assertEqual(wechat_direct.pair_status(code, 8)["state"], "expired")

    def test_unknown_code_expired(self) -> None:
        self.assertEqual(wechat_direct.pair_status("000000", 7)["state"], "expired")


class ReportTests(unittest.TestCase):
    def _pair(self) -> str:
        return wechat_direct.create_pair(7)["code"]

    def test_report_rejects_bad_token(self) -> None:
        code = self._pair()
        with self.assertRaises(ValueError) as caught:
            wechat_direct.report(code, {"token": "not-a-jwt", "silk_id": "9001"})
        self.assertIn("JWT", str(caught.exception))

    def test_report_requires_silk_id(self) -> None:
        code = self._pair()
        token = "a.eyJ.bbbbbbbbbbbb"
        with self.assertRaises(ValueError) as caught:
            wechat_direct.report(code, {"token": token, "silk_id": ""})
        self.assertIn("silk_id", str(caught.exception))

    def test_report_binds_to_pair_owner(self) -> None:
        code = wechat_direct.create_pair(7)["code"]
        captured: list[tuple[int, str]] = []

        def fake_bind(user_id, line, account_id=None):
            captured.append((user_id, line))
            return {"accounts": [{"id": 1, "account_info": "9001"}], "errors": []}

        with mock.patch("xiaocan_bridge.bind_from_lines", side_effect=fake_bind):
            out = wechat_direct.report(code, {
                "token": "h.eyJ.bbbbbbbbbbbb", "user_id": "8002",
                "silk_id": "9001", "nickname": "小蚕号",
            })

        self.assertEqual(captured[0][0], 7, "必须绑到生成配对码的那个人名下")
        self.assertEqual(captured[0][1], "小蚕号#8002#9001#h.eyJ.bbbbbbbbbbbb")
        self.assertEqual(out["account"]["account_info"], "9001")
        self.assertEqual(wechat_direct.pair_status(code, 7)["state"], "done")

    def test_report_unknown_code(self) -> None:
        with self.assertRaises(ValueError):
            wechat_direct.report("999999", {"token": "h.eyJ.b", "silk_id": "9001"})


class ScriptTests(unittest.TestCase):
    def test_generated_script_compiles(self) -> None:
        text = wechat_direct.build_windows_script("https://panel.example.com", "123456")
        compile(text, "wechat_direct.py", "exec")
        self.assertIn("https://panel.example.com", text)
        self.assertIn("'123456'", text)

    def test_scan_unavailable_off_windows(self) -> None:
        if wechat_direct.IS_WINDOWS:
            self.skipTest("Windows 上才有真实扫描")
        self.assertIsNone(wechat_direct.scan())
        self.assertFalse(wechat_direct.available())


if __name__ == "__main__":
    unittest.main()
