"""安装与发布回归：临时目录、离线邮件桩，不读取或改动本机数据。

    python3 test_installation.py
"""
from __future__ import annotations

import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest import mock

# 导入 core 之前隔离配置和自动生成的密钥，避免测试自身污染真实部署。
_IMPORT_DIR = tempfile.TemporaryDirectory(prefix="taskdeck-tests-")
for key in tuple(os.environ):
    if key.startswith(("PANEL_", "MAIL_", "YYB_", "QL_")):
        os.environ.pop(key)
os.environ.update(PANEL_DATA_DIR=_IMPORT_DIR.name,
                  PANEL_CONFIG_PATH=str(Path(_IMPORT_DIR.name) / "config.json"),
                  PANEL_CONFIG_LOCAL_PATH=str(Path(_IMPORT_DIR.name) / "local.json"))
Path(os.environ["PANEL_CONFIG_PATH"]).write_text("{}", encoding="utf-8")

import core
import bootstrap
import api_auth
import mail
from flask import Flask
from runtime_config import persistent_keys

PASSWORD = "test-only-Long-Password!42"


class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="taskdeck-case-")
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(core.close_db)
        core.close_db()
        core.DATA_DIR = self.tmp.name
        core.DB_PATH = str(Path(self.tmp.name) / "panel.db")
        core.CONFIG = dict(core.DEFAULT_CONFIG)
        core.CONFIG.update(persistent_keys(self.tmp.name, {}))
        core.init_db()
        self.app = Flask(__name__)
        self.app.config["TESTING"] = True
        self.app.before_request(bootstrap.require_initialized)
        self.app.register_blueprint(bootstrap.bp, url_prefix="/api/setup")
        self.app.register_blueprint(api_auth.bp, url_prefix="/api/auth")
        self.app.teardown_appcontext(core.close_db)
        self.client = self.app.test_client()
        self.prepare()
        self.code = core.query_one("SELECT setup_code FROM installation")["setup_code"]

    def prepare(self):
        with contextlib.redirect_stdout(io.StringIO()):
            bootstrap.prepare()

    def payload(self, **overrides):
        return {"setup_code": self.code, "email": "owner@example.test", "password": PASSWORD,
                "confirm_password": PASSWORD, **overrides}

    def install(self, **overrides):
        return self.client.post("/api/setup", json=self.payload(**overrides))

    def test_fresh_database_no_user_or_public_code(self):
        response = self.client.get("/api/setup")
        self.assertEqual(response.json["data"], {"initialized": False})
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotIn(self.code, response.get_data(as_text=True))
        self.assertIsNone(core.query_one("SELECT 1 FROM users"))
        self.assertGreaterEqual(len(self.code), 40)

    def test_business_apis_closed_before_install(self):
        for path in ("/api/auth/login", "/api/auth/register", "/api/admin/settings", "/api/runner/heartbeat"):
            self.assertEqual(self.client.post(path, json={}).status_code, 503, path)

    def test_invalid_inputs_and_no_partial_admin(self):
        self.assertEqual(self.client.post("/api/setup", json=[]).status_code, 400)
        self.assertEqual(self.client.post("/api/setup", data="x" * 5000).status_code, 413)
        for fields in ({"email": []}, {"email": "wrong"}, {"password": "short"},
                       {"password": "admin12345678"}, {"confirm_password": "different"}):
            self.assertEqual(self.install(**fields).status_code, 400)
        self.assertIsNone(core.query_one("SELECT 1 FROM users"))

    def test_wrong_code_and_persisted_rate_limit(self):
        self.assertEqual([self.install(setup_code="wrong").status_code for _ in range(5)],
                         [403, 403, 403, 403, 429])
        core.close_db()
        self.prepare()
        response = self.install()
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)
        core.execute("UPDATE installation SET locked_until=1")
        self.assertEqual(self.install().status_code, 200)

    def test_install_login_restart_no_overwrite(self):
        self.assertEqual(self.install(email="OWNER@EXAMPLE.TEST").status_code, 200)
        row = core.query_one("SELECT * FROM users")
        self.assertTrue(core.verify_password(PASSWORD, row["password_hash"]))
        self.assertEqual(row["email"], "owner@example.test")
        self.assertEqual(row["role"], "admin")
        self.assertIsNone(core.query_one("SELECT setup_code FROM installation")["setup_code"])
        core.close_db()
        core.CONFIG.update(admin_email="replacement@example.test", admin_password="bad")
        self.prepare()
        self.assertEqual(self.install().status_code, 409)
        login = self.client.post("/api/auth/login", json={"email": row["email"], "password": PASSWORD})
        self.assertEqual(login.json["code"], 200)
        self.assertEqual(core.query_one("SELECT COUNT(*) n FROM users")["n"], 1)

    def test_deleted_admin_does_not_reopen_setup(self):
        self.install()
        core.execute("DELETE FROM users")
        self.prepare()
        self.assertTrue(bootstrap.initialized())
        self.assertEqual(self.install().status_code, 409)

    def test_concurrent_install_exactly_one_winner(self):
        def submit(index):
            with self.app.test_client() as client:
                return client.post("/api/setup", json=self.payload(email=f"owner{index}@example.test")).status_code
        with ThreadPoolExecutor(max_workers=6) as pool:
            statuses = list(pool.map(submit, range(6)))
        self.assertEqual(statuses.count(200), 1)
        self.assertEqual(statuses.count(409), 5)
        self.assertEqual(core.query_one("SELECT COUNT(*) n FROM users")["n"], 1)

    def test_explicit_credentials_and_partial_configuration(self):
        core.CONFIG["admin_email"] = "env@example.test"
        with self.assertRaises(RuntimeError):
            self.prepare()
        core.CONFIG["admin_password"] = PASSWORD
        self.prepare()
        self.assertTrue(bootstrap.initialized())
        self.assertEqual(core.query_one("SELECT email FROM users")["email"], "env@example.test")

    def test_existing_admin_migrates_unchanged(self):
        self.install()
        before = dict(core.query_one("SELECT * FROM users"))
        # 模拟旧版本没有 installation 表，但已有真实管理员。
        core.execute("DROP TABLE installation")
        core.CONFIG.update(admin_email="new@example.test", admin_password=PASSWORD)
        self.prepare()
        self.assertEqual(dict(core.query_one("SELECT * FROM users")), before)
        self.assertTrue(bootstrap.initialized())

    def test_mail_all_three_routes_production_and_development(self):
        self.install()
        token = self.client.post("/api/auth/login", json={"email": "owner@example.test", "password": PASSWORD}).json["data"]["access_token"]
        routes = [("/api/auth/register/code", "new@example.test"),
                  ("/api/auth/reset-password", "owner@example.test"),
                  ("/api/auth/email/change-code", "changed@example.test")]
        for dev, sent in ((False, False), (True, False), (False, True)):
            with mock.patch.dict(core.CONFIG, {"mail_dev_mode": dev}), \
                 mock.patch.object(mail, "configured", return_value=sent), \
                 mock.patch.object(mail, "send_mail", return_value={"sent": sent, "dry_run": not sent, "error": ""}):
                for path, email in routes:
                    core.execute("DELETE FROM email_codes")
                    result = self.client.post(path, json={"email": email}, headers={"Authorization": f"Bearer {token}"}).json
                    self.assertEqual(result["code"], 200 if (dev or sent) else 400)
                    if dev:
                        self.assertEqual(len(result["data"]["dev_code"]), 6)
                    else:
                        self.assertFalse(result["data"].get("dev_code"))
                    if not dev and not sent:
                        self.assertEqual(core.query_one("SELECT used FROM email_codes")["used"], 1)

    def test_production_mail_does_not_log_body(self):
        with mock.patch.object(mail, "LOG_PATH", str(Path(self.tmp.name) / "mail.log")), \
             mock.patch.object(mail, "configured", return_value=False):
            mail.send_mail("target@example.test", "code", "private-body-654321")
            self.assertNotIn("private-body-654321", Path(mail.LOG_PATH).read_text())


class RuntimeKeysTests(unittest.TestCase):
    def test_restart_concurrent_generation_and_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            with ThreadPoolExecutor(max_workers=8) as pool:
                values = list(pool.map(lambda _: persistent_keys(directory, {}), range(8)))
            self.assertTrue(all(item == values[0] for item in values))
            self.assertEqual(persistent_keys(directory, {}), values[0])
            self.assertEqual((Path(directory) / "runtime-secrets.json").stat().st_mode & 0o777, 0o600)

    def test_legacy_keys_preserved_including_short_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = {"secret_key": "old-secret", "runner_key": "old-runner"}
            self.assertEqual(persistent_keys(directory, legacy), legacy)
            self.assertEqual(persistent_keys(directory, {}), legacy)

    def test_corrupt_keys_fail_closed(self):
        for data in ("broken", "[]", '{}', '{"secret_key":"","runner_key":"x"}'):
            with self.subTest(data=data), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "runtime-secrets.json"
                path.write_text(data)
                with self.assertRaises(RuntimeError):
                    persistent_keys(directory, {})
                self.assertEqual(path.read_text(), data)

    def test_real_process_config_precedence_and_environment_password(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "base.json"
            local = root / "local.json"
            config.write_text(json.dumps({"secret_key": "legacy-secret", "runner_key": "legacy-runner", "port": 1234}))
            local.write_text(json.dumps({"port": 2345}))
            env = {**os.environ, "PANEL_DATA_DIR": directory, "PANEL_CONFIG_PATH": str(config),
                   "PANEL_CONFIG_LOCAL_PATH": str(local), "PANEL_PORT": "3456",
                   "PANEL_SECRET_KEY": "env-secret", "PANEL_ADMIN_PASSWORD": " 'keep-this-password' "}
            script = "import core,json; print(json.dumps({k:core.CONFIG[k] for k in ('secret_key','runner_key','port','admin_password')}))"
            value = json.loads(subprocess.check_output([sys.executable, "-c", script], env=env, cwd=Path(__file__).parent))
            self.assertEqual(value, {"secret_key": "env-secret", "runner_key": "legacy-runner", "port": 3456,
                                     "admin_password": " 'keep-this-password' "})
            saved = json.loads((root / "runtime-secrets.json").read_text())
            self.assertEqual(saved["secret_key"], "legacy-secret")
            self.assertNotIn("env-secret", config.read_text())


if __name__ == "__main__":
    # 同一隔离入口运行已有邮件/验证码回归；它们同样只创建临时库。
    import test_auth_code
    import test_mail
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromModule(module)
                               for module in (sys.modules[__name__], test_auth_code, test_mail))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    core.close_db()
    _IMPORT_DIR.cleanup()
    sys.exit(not result.wasSuccessful())
