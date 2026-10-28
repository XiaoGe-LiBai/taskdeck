"""mail.py 离线单测：临时 SQLite + 打桩 SMTP，全程不连外网。

    python3 -m unittest test_mail -v
"""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

import core
import mail

# SMTP 重试间隔在测试里压成 0，避免拖慢用例
mail.RETRY_GAP_SECONDS = 0


class MailTestBase(unittest.TestCase):
    """每个用例一份干净的临时库 + 临时 data 目录，不碰 server/data/panel.db。"""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        tmp = self._tmp.name
        self._old = (core.DATA_DIR, core.DB_PATH, mail.LOG_PATH)
        core.DATA_DIR = tmp
        core.DB_PATH = os.path.join(tmp, "panel.db")
        mail.LOG_PATH = os.path.join(tmp, "mail.log")
        core.close_db()
        core.init_db()

    def tearDown(self) -> None:
        core.close_db()
        core.DATA_DIR, core.DB_PATH, mail.LOG_PATH = self._old
        self._tmp.cleanup()

    # ---------------------------------------------------------------- 工具

    @staticmethod
    def set_smtp(**kwargs) -> None:
        for key, value in kwargs.items():
            core.set_setting(f"smtp_{key}", value)

    @staticmethod
    def log_lines() -> list[str]:
        with open(mail.LOG_PATH, encoding="utf-8") as fh:
            return fh.read().splitlines()

    @staticmethod
    def fake_smtp(ok: bool = True, error: Exception | None = None) -> mock.MagicMock:
        """构造一个可注入的 SMTP 桩；ok=False 时 login 或 sendmail 抛错。"""
        server = mock.MagicMock()
        if ok:
            return server
        if isinstance(error, type) and issubclass(error, Exception):
            server.login.side_effect = error("bad", "auth failed")
        else:
            server.sendmail.side_effect = error or OSError("boom")
        return server


class ConfigMergeTests(MailTestBase):
    """三个来源的合并优先级：settings 表 > config.json smtp 段 > 环境变量。"""

    def test_empty_db_falls_back_to_env(self) -> None:
        with mock.patch.dict(os.environ, {"MAIL_SMTP": "smtp.env.com", "MAIL_PORT": "465",
                                          "MAIL_SENDER": "env@x.com", "MAIL_PASSWORD": "envpw"}):
            cfg = mail.smtp_config()
        self.assertEqual(cfg["host"], "smtp.env.com")
        self.assertEqual(cfg["user"], "env@x.com")
        self.assertEqual(cfg["password"], "envpw")

    def test_db_beats_env(self) -> None:
        self.set_smtp(host="smtp.db.com", user="db@x.com", password="dbpw")
        with mock.patch.dict(os.environ, {"MAIL_SMTP": "smtp.env.com", "MAIL_SENDER": "env@x.com",
                                          "MAIL_PASSWORD": "envpw"}):
            cfg = mail.smtp_config()
        self.assertEqual(cfg["host"], "smtp.db.com")
        self.assertEqual(cfg["user"], "db@x.com")

    def test_db_beats_config_json_smtp_section(self) -> None:
        self.set_smtp(host="smtp.db.com")
        with mock.patch.object(core, "CONFIG", {**core.CONFIG, "smtp": {"host": "smtp.legacy.com"}}):
            self.assertEqual(mail.smtp_config()["host"], "smtp.db.com")
        # settings 表没配时才轮到 config.json
        with mock.patch.object(core, "CONFIG", {**core.CONFIG, "smtp": {"host": "smtp.legacy.com"}}):
            core.execute("DELETE FROM settings WHERE key='smtp_host'")
            self.assertEqual(mail.smtp_config()["host"], "smtp.legacy.com")

    def test_configured_requires_host_user_password(self) -> None:
        self.assertFalse(mail.configured())
        self.set_smtp(host="smtp.x.com", user="a@x.com")
        self.assertFalse(mail.configured())  # 缺授权码
        self.set_smtp(password="pw")
        self.assertTrue(mail.configured())

    def test_port_defaults_follow_ssl(self) -> None:
        self.set_smtp(host="smtp.x.com", user="a@x.com", password="pw")
        self.assertEqual(mail.smtp_config()["port"], 465)
        self.set_smtp(ssl="false")
        self.assertEqual(mail.smtp_config()["port"], 587)

    def test_password_is_never_in_config_json(self) -> None:
        """口令只能进 settings 表；config.json 不该被写入口令。"""
        self.set_smtp(host="smtp.x.com", user="a@x.com", password="topsecret")
        with open(core.CONFIG_PATH, encoding="utf-8") as fh:
            self.assertNotIn("topsecret", fh.read())


class SendTests(MailTestBase):
    """send_mail 的四条路径：dry-run / 成功 / 重试后成功 / 全部失败。"""

    def test_dry_run_writes_log_and_reports(self) -> None:
        with mock.patch.dict(core.CONFIG, {"mail_dev_mode": True}):
            result = mail.send_mail("to@x.com", "标题", "<p>正文</p>")
        self.assertFalse(result["sent"])
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["error"], "")
        lines = self.log_lines()
        self.assertTrue(any("[DRY-RUN]" in line and "to=to@x.com" in line for line in lines))
        # 正文也落日志，方便本地联调直接抄验证码
        self.assertTrue(any("[DRY-RUN-BODY]" in line and "正文" in line for line in lines))

    def test_empty_recipient_is_rejected_without_smtp(self) -> None:
        result = mail.send_mail("  ", "标题", "<p>x</p>")
        self.assertFalse(result["sent"])
        self.assertFalse(result["dry_run"])
        self.assertTrue(result["error"])

    def test_success_logs_and_returns_sent(self) -> None:
        self.set_smtp(host="smtp.x.com", user="a@x.com", password="pw", sender="from@x.com")
        server = self.fake_smtp(ok=True)
        with mock.patch("smtplib.SMTP_SSL", mock.MagicMock(return_value=server)) as smtp_cls:
            result = mail.send_mail("to@x.com", "标题", "<p>hi</p>")
        self.assertTrue(result["sent"])
        self.assertFalse(result["dry_run"])
        smtp_cls.assert_called_once_with("smtp.x.com", 465, timeout=20)
        server.login.assert_called_once_with("a@x.com", "pw")
        server.sendmail.assert_called_once()
        args = server.sendmail.call_args.args
        self.assertEqual(args[0], "from@x.com")
        self.assertEqual(args[1], ["to@x.com"])
        self.assertTrue(any("[SENT]" in line for line in self.log_lines()))

    def test_starttls_path_when_ssl_off(self) -> None:
        self.set_smtp(host="smtp.x.com", user="a@x.com", password="pw", ssl="false")
        server = self.fake_smtp(ok=True)
        with mock.patch("smtplib.SMTP", mock.MagicMock(return_value=server)) as smtp_cls, \
                mock.patch("smtplib.SMTP_SSL", mock.MagicMock(return_value=server)) as ssl_cls:
            result = mail.send_mail("to@x.com", "标题", "<p>hi</p>")
        self.assertTrue(result["sent"])
        smtp_cls.assert_called_once()
        ssl_cls.assert_not_called()
        server.starttls.assert_called_once()
        server.login.assert_called_once()

    def test_retry_then_success(self) -> None:
        self.set_smtp(host="smtp.x.com", user="a@x.com", password="pw")
        server = mock.MagicMock()
        server.login.side_effect = [OSError("temp fail"), None]  # 第一次挂，第二次好
        with mock.patch("smtplib.SMTP_SSL", mock.MagicMock(return_value=server)):
            result = mail.send_mail("to@x.com", "标题", "<p>hi</p>")
        self.assertTrue(result["sent"])
        self.assertEqual(server.login.call_count, 2)
        fails = [line for line in self.log_lines() if "[FAIL]" in line]
        self.assertEqual(len(fails), 1)                       # 第一次尝试留一条失败记录
        self.assertTrue(any("[SENT]" in line for line in self.log_lines()))

    def test_all_retries_fail_returns_error_without_raising(self) -> None:
        self.set_smtp(host="smtp.x.com", user="a@x.com", password="pw")
        server = self.fake_smtp(ok=False, error=OSError("connection refused"))
        with mock.patch("smtplib.SMTP_SSL", mock.MagicMock(return_value=server)):
            result = mail.send_mail("to@x.com", "标题", "<p>hi</p>")
        self.assertFalse(result["sent"])
        self.assertFalse(result["dry_run"])
        self.assertIn("OSError", result["error"])
        fails = [line for line in self.log_lines() if "[FAIL]" in line]
        self.assertEqual(len(fails), mail.RETRY_TIMES)
        self.assertTrue(any("to=to@x.com" in line for line in fails))
        # 口令绝不能出现在日志里
        self.assertFalse(any("pw" == line for line in self.log_lines()))

    def test_auth_failure_error_detail_surfaced(self) -> None:
        """管理端「发送测试邮件」靠 error 字段展示 535 之类的真实原因。"""
        import smtplib

        self.set_smtp(host="smtp.x.com", user="a@x.com", password="wrongpw")
        server = mock.MagicMock()
        server.login.side_effect = smtplib.SMTPAuthenticationError(535, b"Error: authentication failed")
        with mock.patch("smtplib.SMTP_SSL", mock.MagicMock(return_value=server)):
            result = mail.send_mail("to@x.com", "标题", "<p>hi</p>")
        self.assertFalse(result["sent"])
        self.assertIn("535", result["error"])
        self.assertIn("SMTPAuthenticationError", result["error"])

    def test_send_code_keeps_bool_contract(self) -> None:
        """api_auth 只依赖布尔返回，这个契约不能破。"""
        self.assertFalse(mail.send_code("to@x.com", "123456"))  # 未配置 → dry-run → False
        self.assertFalse(any("123456" in line for line in self.log_lines()))

    def test_code_html_contains_code_and_validity(self) -> None:
        html = mail.code_html("654321", minutes=30)
        self.assertIn("654321", html)
        self.assertIn("30", html)


if __name__ == "__main__":
    unittest.main()
