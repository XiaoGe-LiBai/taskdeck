"""管理员配置与运行密钥回归：全部使用临时目录，不读取也不改动本机数据。

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

# 导入 core 之前隔离配置和自动生成的密钥，避免测试自身污染真实部署。
_IMPORT_DIR = tempfile.TemporaryDirectory(prefix="taskdeck-tests-")
for key in tuple(os.environ):
    if key.startswith(("PANEL_", "MAIL_", "YYB_", "QL_")):
        os.environ.pop(key)
os.environ.update(PANEL_DATA_DIR=_IMPORT_DIR.name,
                  PANEL_CONFIG_PATH=str(Path(_IMPORT_DIR.name) / "config.json"),
                  PANEL_CONFIG_LOCAL_PATH=str(Path(_IMPORT_DIR.name) / "local.json"))
Path(os.environ["PANEL_CONFIG_PATH"]).write_text("{}", encoding="utf-8")

import bootstrap
import core
from runtime_config import persistent_keys

PASSWORD = "test-only-Long-Password!42"


class AdminProvisioningTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="taskdeck-admin-")
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(core.close_db)
        core.close_db()
        core.DATA_DIR = self.tmp.name
        core.DB_PATH = str(Path(self.tmp.name) / "panel.db")
        core.CONFIG = dict(core.DEFAULT_CONFIG)
        core.CONFIG.update(persistent_keys(self.tmp.name, {}))
        core.init_db()

    def configure(self, email="", password=""):
        core.CONFIG.update(admin_email=email, admin_password=password)

    def prepare(self):
        with contextlib.redirect_stdout(io.StringIO()):
            bootstrap.prepare()

    def admin(self):
        return core.query_one("SELECT * FROM users WHERE role='admin'")

    def test_empty_db_without_credentials_refuses_to_start(self):
        for email, password in (("", ""), ("owner@example.test", ""), ("", PASSWORD)):
            with self.subTest(email=email, password=password):
                self.configure(email, password)
                with self.assertRaises(RuntimeError) as caught:
                    self.prepare()
                self.assertIn("PANEL_ADMIN_EMAIL", str(caught.exception))
                self.assertIsNone(self.admin())

    def test_invalid_credentials_refused_before_creating_anything(self):
        cases = {
            "邮箱": ("not-an-email", PASSWORD),
            "短口令": ("owner@example.test", "short"),
            "超长口令": ("owner@example.test", "x" * 129),
            "常见默认": ("owner@example.test", "Admin12345678"),
        }
        for name, (email, password) in cases.items():
            with self.subTest(name):
                self.configure(email, password)
                with self.assertRaises(RuntimeError):
                    self.prepare()
                self.assertIsNone(self.admin())

    def test_creates_admin_from_environment(self):
        self.configure("Owner@Example.Test", PASSWORD)
        self.prepare()
        admin = self.admin()
        self.assertEqual(admin["email"], "owner@example.test")
        self.assertEqual(admin["status"], "normal")
        self.assertTrue(core.verify_password(PASSWORD, admin["password_hash"]))
        self.assertTrue(admin["invite_code"])

    def test_existing_admin_kept_when_no_password_given(self):
        self.configure("owner@example.test", PASSWORD)
        self.prepare()
        before = dict(self.admin())
        self.configure("other@example.test", "")
        self.prepare()
        self.assertEqual(dict(self.admin()), before)

    def test_same_password_does_not_rotate_sessions(self):
        self.configure("owner@example.test", PASSWORD)
        self.prepare()
        before = dict(self.admin())
        self.prepare()
        self.assertEqual(dict(self.admin()), before)

    def test_new_password_rotates_and_revokes_sessions(self):
        self.configure("owner@example.test", PASSWORD)
        self.prepare()
        before = self.admin()["token_version"]
        changed = "another-Long-Password!77"
        self.configure("owner@example.test", changed)
        self.prepare()
        admin = self.admin()
        self.assertTrue(core.verify_password(changed, admin["password_hash"]))
        self.assertFalse(core.verify_password(PASSWORD, admin["password_hash"]))
        self.assertEqual(admin["token_version"], before + 1)
        self.assertEqual(admin["email"], "owner@example.test")

    def test_invalid_new_password_refused_instead_of_ignored(self):
        self.configure("owner@example.test", PASSWORD)
        self.prepare()
        before = dict(self.admin())
        self.configure("owner@example.test", "short")
        with self.assertRaises(RuntimeError):
            self.prepare()
        self.assertEqual(dict(self.admin()), before)

    def test_email_collision_with_normal_user_refused(self):
        core.insert("users", {"email": "taken@example.test", "password_hash": core.hash_password(PASSWORD),
                              "nickname": "普通用户", "role": "user", "status": "normal",
                              "invite_code": core.gen_invite_code(), "created_time": core.iso()})
        self.configure("taken@example.test", PASSWORD)
        with self.assertRaises(RuntimeError):
            self.prepare()
        self.assertIsNone(self.admin())

    def test_concurrent_startup_creates_exactly_one_admin(self):
        self.configure("owner@example.test", PASSWORD)
        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(lambda _: self.prepare(), range(6)))
        self.assertEqual(core.query_one("SELECT COUNT(*) n FROM users")["n"], 1)

    def test_restart_twice_keeps_single_admin(self):
        self.configure("owner@example.test", PASSWORD)
        self.prepare()
        core.close_db()
        core.init_db()
        self.prepare()
        self.assertEqual(core.query_one("SELECT COUNT(*) n FROM users")["n"], 1)


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
        for data in ("broken", "[]", "{}", '{"secret_key":"","runner_key":"x"}'):
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
