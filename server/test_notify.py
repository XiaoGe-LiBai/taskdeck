"""notify.py 离线单测：报文构造、加签、配置判定、失败不抛异常。

    python3 test_notify.py
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import tempfile
import time
import unittest
import urllib.parse
from unittest import mock

import core
import notify


class NotifyTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        tmp = self._tmp.name
        self._old = (core.DATA_DIR, core.DB_PATH, notify.LOG_PATH)
        core.DATA_DIR = tmp
        core.DB_PATH = os.path.join(tmp, "panel.db")
        notify.LOG_PATH = os.path.join(tmp, "notify.log")
        core.close_db()
        core.init_db()
        # 本机 config.json 可能开着「注册必须验证码」；这里测的是通知钩子，显式关掉
        self._config_backup = dict(core.CONFIG)
        core.CONFIG["register_require_code"] = False

    def tearDown(self) -> None:
        core.CONFIG.clear()
        core.CONFIG.update(self._config_backup)
        core.close_db()
        core.DATA_DIR, core.DB_PATH, notify.LOG_PATH = self._old
        self._tmp.cleanup()


class BuildRequestTests(NotifyTestBase):
    def test_wecom_markdown(self) -> None:
        req = notify.build_request("wecom", {"url": "https://qy.example/hook"}, "标题", "正文")
        self.assertEqual(req["method"], "POST")
        self.assertEqual(req["kwargs"]["json"]["msgtype"], "markdown")
        self.assertIn("正文", req["kwargs"]["json"]["markdown"]["content"])

    def test_dingtalk_sign_matches_reference(self) -> None:
        secret = "SEC001"
        req = notify.build_request("dingtalk", {"url": "https://oapi.example/robot", "secret": secret},
                                   "标题", "正文")
        query = urllib.parse.parse_qs(urllib.parse.urlparse(req["url"]).query)
        ts = query["timestamp"][0]
        expected = base64.b64encode(
            hmac.new(secret.encode(), f"{ts}\n{secret}".encode(), hashlib.sha256).digest()).decode()
        self.assertEqual(query["sign"][0], expected)
        self.assertEqual(req["kwargs"]["json"]["markdown"]["title"], "标题")

    def test_dingtalk_without_secret_keeps_url(self) -> None:
        req = notify.build_request("dingtalk", {"url": "https://oapi.example/robot", "secret": ""}, "t", "c")
        self.assertEqual(req["url"], "https://oapi.example/robot")

    def test_feishu_text(self) -> None:
        req = notify.build_request("feishu", {"url": "https://open.feishu.cn/hook/x"}, "标题", "正文")
        self.assertEqual(req["kwargs"]["json"]["msg_type"], "text")
        self.assertEqual(req["kwargs"]["json"]["content"]["text"], "标题\n正文")

    def test_bark_encodes_path(self) -> None:
        req = notify.build_request("bark", {"url": "https://api.day.app/KEY/"}, "标题 A", "正文/一")
        self.assertTrue(req["url"].startswith("https://api.day.app/KEY/"))
        self.assertIn(urllib.parse.quote("标题 A", safe=""), req["url"])
        self.assertIn(urllib.parse.quote("正文/一", safe=""), req["url"])

    def test_serverchan_accepts_key_or_full_url(self) -> None:
        by_key = notify.build_request("serverchan", {"url": "SCT123abc"}, "t", "c")
        self.assertEqual(by_key["url"], "https://sctapi.ftqq.com/SCT123abc.send")
        full = notify.build_request("serverchan", {"url": "https://sctapi.ftqq.com/SCT1.send"}, "t", "c")
        self.assertEqual(full["url"], "https://sctapi.ftqq.com/SCT1.send")

    def test_telegram_uses_token_in_path(self) -> None:
        req = notify.build_request("telegram", {"token": "123:abc", "chat_id": "42"}, "t", "c")
        self.assertEqual(req["url"], "https://api.telegram.org/bot123:abc/sendMessage")
        self.assertEqual(req["kwargs"]["json"]["chat_id"], "42")

    def test_webhook_bearer_only_when_token_given(self) -> None:
        with_token = notify.build_request("webhook", {"url": "https://x/h", "token": "tk"}, "t", "c")
        self.assertEqual(with_token["kwargs"]["headers"]["Authorization"], "Bearer tk")
        without = notify.build_request("webhook", {"url": "https://x/h", "token": ""}, "t", "c")
        self.assertNotIn("Authorization", without["kwargs"]["headers"])
        self.assertEqual(without["kwargs"]["json"]["event"], "panel.notify")


class ConfigureTests(NotifyTestBase):
    def test_missing_required_field_means_disabled(self) -> None:
        self.assertFalse(notify.configured("telegram"))
        core.set_setting("notify_telegram_token", "123:abc")
        self.assertFalse(notify.configured("telegram"))
        core.set_setting("notify_telegram_chat_id", "42")
        self.assertTrue(notify.configured("telegram"))

    def test_enabled_channels_lists_only_configured(self) -> None:
        core.set_setting("notify_bark_url", "https://api.day.app/k")
        self.assertEqual(notify.enabled_channels(), ["bark"])

    def test_unknown_channel(self) -> None:
        self.assertFalse(notify.configured("nope"))


class SendTests(NotifyTestBase):
    def test_success_and_log(self) -> None:
        core.set_setting("notify_wecom_url", "https://qy.example/hook")
        resp = mock.MagicMock(status_code=200)
        resp.json.return_value = {"errcode": 0}
        with mock.patch("requests.request", return_value=resp) as req:
            result = notify.send("wecom", "标题", "正文")
        self.assertTrue(result["sent"])
        self.assertEqual(req.call_args.args[1], "https://qy.example/hook")
        with open(notify.LOG_PATH, encoding="utf-8") as fh:
            self.assertIn("[SENT]", fh.read())

    def test_business_error_code_counts_as_failure(self) -> None:
        core.set_setting("notify_wecom_url", "https://qy.example/hook")
        resp = mock.MagicMock(status_code=200)
        resp.json.return_value = {"errcode": 93000, "errmsg": "invalid webhook url"}
        with mock.patch("requests.request", return_value=resp):
            result = notify.send("wecom", "标题")
        self.assertFalse(result["sent"])
        self.assertIn("93000", result["error"])

    def test_http_error_is_failure(self) -> None:
        core.set_setting("notify_webhook_url", "https://x/h")
        resp = mock.MagicMock(status_code=502)
        resp.json.side_effect = ValueError
        with mock.patch("requests.request", return_value=resp):
            result = notify.send("webhook", "标题")
        self.assertFalse(result["sent"])
        self.assertIn("502", result["error"])

    def test_network_exception_never_raises(self) -> None:
        core.set_setting("notify_bark_url", "https://api.day.app/k")
        with mock.patch("requests.request", side_effect=timeout_error()):
            result = notify.send("bark", "标题")
        self.assertFalse(result["sent"])
        self.assertIn("Timeout", result["error"])

    def test_unconfigured_channel_short_circuits(self) -> None:
        with mock.patch("requests.request") as req:
            result = notify.send("feishu", "标题")
        self.assertFalse(result["sent"])
        self.assertEqual(result["error"], "未配置")
        req.assert_not_called()

    def test_send_all_covers_configured_only(self) -> None:
        core.set_setting("notify_bark_url", "https://api.day.app/k")
        core.set_setting("notify_webhook_url", "https://x/h")
        resp = mock.MagicMock(status_code=200)
        resp.json.return_value = {}
        with mock.patch("requests.request", return_value=resp):
            results = notify.send_all("标题", "正文")
        self.assertEqual([r["channel"] for r in results], ["bark", "webhook"])
        self.assertTrue(all(r["sent"] for r in results))

    def test_notify_async_skips_thread_when_nothing_configured(self) -> None:
        with mock.patch("threading.Thread") as thread_cls:
            notify.notify_async("标题")
        thread_cls.assert_not_called()


class RegisterHookTests(NotifyTestBase):
    """注册流程必须真的把事件推出去：api_auth 里有个同名的 `notify()` 接口函数，
    曾经把模块名遮蔽成 function，导致注册直接 500。"""
    def test_register_triggers_notify(self) -> None:
        from flask import Flask
        import api_auth

        app = Flask(__name__)
        app.json.ensure_ascii = False
        app.register_blueprint(api_auth.bp, url_prefix="/api/auth")
        app.teardown_appcontext(core.close_db)
        core.set_setting("notify_webhook_url", "https://hooks.example/x")

        with mock.patch.object(notify, "send_all") as send_all:
            resp = app.test_client().post("/api/auth/register", json={
                "email": "newbie@example.test",
                "password": "Passw0rd-123",
                "confirm_password": "Passw0rd-123",
            })
            self.assertEqual(resp.json["code"], 200)
            for _ in range(60):
                if send_all.called:
                    break
                time.sleep(0.05)
        self.assertTrue(send_all.called, "注册后应触发通知")
        self.assertEqual(send_all.call_args.args[0], "新用户注册")


def timeout_error() -> Exception:
    import requests
    return requests.Timeout("read timed out")


if __name__ == "__main__":
    unittest.main()
