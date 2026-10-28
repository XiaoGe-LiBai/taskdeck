"""api_auth 验证码规则的离线单测：节流 / 每日限次 / 错误次数作废 / 过期。

    python3 -m unittest test_auth_code -v
"""
from __future__ import annotations

import os
import tempfile
import unittest
from datetime import timedelta
from unittest import mock

import api_auth
import core


class AuthCodeTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        tmp = self._tmp.name
        self._old = (core.DATA_DIR, core.DB_PATH)
        core.DATA_DIR = tmp
        core.DB_PATH = os.path.join(tmp, "panel.db")
        core.close_db()
        core.init_db()

    def tearDown(self) -> None:
        core.close_db()
        core.DATA_DIR, core.DB_PATH = self._old
        self._tmp.cleanup()

    @staticmethod
    def put_code(email: str, code: str = "111111", purpose: str = "register",
                 minutes: int = 10, created_minutes_ago: float = 0, attempts: int = 0) -> None:
        created = core.now_dt() - timedelta(minutes=created_minutes_ago)
        core.insert("email_codes", {
            "email": email,
            "code": code,
            "purpose": purpose,
            "used": 0,
            "attempts": attempts,
            "expire_time": core.iso(core.now_dt() + timedelta(minutes=minutes)),
            "created_time": core.iso(created),
        })


class ThrottleTests(AuthCodeTestBase):
    def test_no_code_yet_not_throttled(self) -> None:
        self.assertFalse(api_auth._code_throttled("a@x.com", "register"))

    def test_second_send_within_interval_is_throttled(self) -> None:
        self.put_code("a@x.com", created_minutes_ago=0.2)  # 12 秒前
        self.assertTrue(api_auth._code_throttled("a@x.com", "register"))

    def test_send_after_interval_ok(self) -> None:
        self.put_code("a@x.com", created_minutes_ago=2)
        self.assertFalse(api_auth._code_throttled("a@x.com", "register"))

    def test_purposes_are_independent(self) -> None:
        """注册发码不影响同一邮箱马上走找回密码。"""
        self.put_code("a@x.com", purpose="register", created_minutes_ago=0.1)
        self.assertFalse(api_auth._code_throttled("a@x.com", "reset"))


class DailyLimitTests(AuthCodeTestBase):
    def test_under_limit_ok(self) -> None:
        for _ in range(api_auth._CODE_DAILY_LIMIT - 1):
            self.put_code("a@x.com", created_minutes_ago=30)
        self.assertFalse(api_auth._code_daily_exceeded("a@x.com", "register"))

    def test_at_limit_blocks(self) -> None:
        for _ in range(api_auth._CODE_DAILY_LIMIT):
            self.put_code("a@x.com", created_minutes_ago=30)
        self.assertTrue(api_auth._code_daily_exceeded("a@x.com", "register"))

    def test_old_codes_do_not_count(self) -> None:
        """25 小时前的发码不计入今天额度。"""
        for _ in range(api_auth._CODE_DAILY_LIMIT + 3):
            self.put_code("a@x.com", created_minutes_ago=25 * 60)
        self.assertFalse(api_auth._code_daily_exceeded("a@x.com", "register"))


class CheckCodeTests(AuthCodeTestBase):
    def test_missing_code_asks_to_fetch_first(self) -> None:
        self.assertEqual(api_auth._check_email_code("a@x.com", "register", "111111"), "请先获取验证码")

    def test_wrong_code_increments_attempts(self) -> None:
        self.put_code("a@x.com", code="222222")
        self.assertEqual(api_auth._check_email_code("a@x.com", "register", "999999"), "验证码不正确")
        row = core.query_one("SELECT attempts FROM email_codes WHERE email='a@x.com'")
        self.assertEqual(int(row["attempts"]), 1)

    def test_too_many_attempts_voids_the_code(self) -> None:
        self.put_code("a@x.com", code="222222", attempts=api_auth._CODE_MAX_ATTEMPTS)
        self.assertEqual(api_auth._check_email_code("a@x.com", "register", "222222"),
                         "验证码错误次数过多，请重新获取")
        row = core.query_one("SELECT used FROM email_codes WHERE email='a@x.com'")
        self.assertEqual(int(row["used"]), 1)

    def test_expired_code_rejected_but_not_marked_used(self) -> None:
        """过期码打错不消耗 attempts 也不置 used，前端只能重新发码。"""
        self.put_code("a@x.com", code="222222", minutes=-5)
        self.assertEqual(api_auth._check_email_code("a@x.com", "register", "222222"), "验证码已过期")
        row = core.query_one("SELECT used, attempts FROM email_codes WHERE email='a@x.com'")
        self.assertEqual(int(row["used"]), 0)
        self.assertEqual(int(row["attempts"]), 0)

    def test_correct_code_marks_used(self) -> None:
        self.put_code("a@x.com", code="333333")
        self.assertIsNone(api_auth._check_email_code("a@x.com", "register", "333333"))
        row = core.query_one("SELECT used FROM email_codes WHERE email='a@x.com'")
        self.assertEqual(int(row["used"]), 1)

    def test_used_code_cannot_replay(self) -> None:
        self.put_code("a@x.com", code="333333")
        self.assertIsNone(api_auth._check_email_code("a@x.com", "register", "333333"))
        self.assertEqual(api_auth._check_email_code("a@x.com", "register", "333333"), "请先获取验证码")

    def test_latest_unused_code_wins(self) -> None:
        """连发两码后，只有最新一条有效。"""
        self.put_code("a@x.com", code="111111", created_minutes_ago=5)
        self.put_code("a@x.com", code="222222", created_minutes_ago=1)
        self.assertEqual(api_auth._check_email_code("a@x.com", "register", "111111"), "验证码不正确")
        self.assertIsNone(api_auth._check_email_code("a@x.com", "register", "222222"))

    def test_purposes_have_independent_code_pools(self) -> None:
        """注册的码不能拿来找回密码，找回的码也不能拿来换绑邮箱。"""
        self.put_code("a@x.com", code="111111", purpose="register")
        self.assertEqual(api_auth._check_email_code("a@x.com", "reset", "111111"), "请先获取验证码")
        self.assertEqual(api_auth._check_email_code("a@x.com", "email_change", "111111"), "请先获取验证码")
        # 对应 purpose 的码正常可用
        self.assertIsNone(api_auth._check_email_code("a@x.com", "register", "111111"))


class SendOrFailTests(AuthCodeTestBase):
    """_send_code_or_fail：dry-run 放行 / 真失败作废并报错。"""

    def setUp(self) -> None:
        super().setUp()
        # core.fail() 返回 Flask Response，需要请求上下文
        self._ctx = _minimal_app().test_request_context()
        self._ctx.push()

    def tearDown(self) -> None:
        self._ctx.pop()
        super().tearDown()

    def test_dry_run_returns_none_and_keeps_code(self) -> None:
        self.put_code("a@x.com", code="444444")
        with mock.patch.object(mail_module(), "send_mail",
                               return_value={"sent": False, "dry_run": True, "error": ""}):
            self.assertIsNone(api_auth._send_code_or_fail("a@x.com", "444444", "register"))
        row = core.query_one("SELECT used FROM email_codes WHERE email='a@x.com'")
        self.assertEqual(int(row["used"]), 0)

    def test_real_failure_voids_code_and_fails(self) -> None:
        self.put_code("a@x.com", code="444444")
        with mock.patch.object(mail_module(), "send_mail",
                               return_value={"sent": False, "dry_run": False, "error": "535 auth"}):
            failure = api_auth._send_code_or_fail("a@x.com", "444444", "register")
        self.assertIsNotNone(failure)
        body, http_status = failure                       # core.fail 返回 (response, 200)
        self.assertEqual(http_status, 200)                # 项目约定：HTTP 恒 200
        self.assertEqual(body.get_json()["code"], 400)
        self.assertIn("验证码发送失败", body.get_json()["msg"])
        row = core.query_one("SELECT used FROM email_codes WHERE email='a@x.com'")
        self.assertEqual(int(row["used"]), 1)

    def test_success_returns_none(self) -> None:
        self.put_code("a@x.com", code="444444")
        with mock.patch.object(mail_module(), "send_mail",
                               return_value={"sent": True, "dry_run": False, "error": ""}):
            self.assertIsNone(api_auth._send_code_or_fail("a@x.com", "444444", "register"))


def _minimal_app():
    """core.fail 要 Flask 上下文；起完整 app 会连带青龙/应用宝 seed，这里给个空壳。"""
    from flask import Flask

    app = Flask(__name__)
    app.json.ensure_ascii = False
    return app


def mail_module():
    """api_auth 以 `import mail` 引用，打桩要打到同一个模块对象上。"""
    import mail
    return mail


if __name__ == "__main__":
    unittest.main()
