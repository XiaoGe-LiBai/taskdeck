"""美团模块单测：凭证存储、脱敏、会话生命周期（Node CLI 全程打桩）。

    python3 test_meituan_runner.py
"""
from __future__ import annotations

import os
import tempfile
import time
import unittest
from unittest import mock

import core
import meituan_runner as mt


class StoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old = (core.DATA_DIR, core.DB_PATH)
        core.DATA_DIR, core.DB_PATH = self._tmp.name, os.path.join(self._tmp.name, "panel.db")
        core.close_db()
        core.init_db()
        mt.ensure_tables()
        self.addCleanup(self._restore)

    def _restore(self) -> None:
        core.close_db()
        core.DATA_DIR, core.DB_PATH = self._old
        self._tmp.cleanup()

    def test_save_is_idempotent_and_masks(self) -> None:
        first = mt.save_account("tok-abcdefghijkl", account_id=1, nickname="美团号")
        second = mt.save_account("tok-abcdefghijkl", account_id=2)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(second["account_id"], 2, "重复保存应更新绑定而不是新增")
        items = mt.list_accounts(None)
        self.assertEqual(len(items), 1)
        self.assertNotIn("token", items[0], "列表绝不能回传明文")
        self.assertEqual(items[0]["token_mask"], "tok-ab****ijkl")

    def test_empty_token_rejected(self) -> None:
        with self.assertRaises(ValueError):
            mt.save_account("   ")

    def test_scope_filter_and_delete(self) -> None:
        mt.save_account("token-aaaaaaaaaaaa", account_id=1)
        mt.save_account("token-bbbbbbbbbbbb", account_id=2)
        self.assertEqual(len(mt.list_accounts([1])), 1)
        items = mt.list_accounts(None)
        target = next(i for i in items if i["account_id"] == 2)
        self.assertFalse(mt.delete_account(target["id"], [1]), "越权删除应失败")
        self.assertTrue(mt.delete_account(target["id"], [2]))

    def test_clear_all(self) -> None:
        mt.save_account("token-cccccccccccc")
        self.assertEqual(mt.clear_all(), 1)
        self.assertEqual(mt.list_accounts(None), [])


class SessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old = (core.DATA_DIR, core.DB_PATH)
        core.DATA_DIR, core.DB_PATH = self._tmp.name, os.path.join(self._tmp.name, "panel.db")
        core.close_db()
        core.init_db()
        mt.ensure_tables()
        mt._sessions.clear()
        self.addCleanup(self._restore)
        self.addCleanup(mt._sessions.clear)

    def _restore(self) -> None:
        core.close_db()
        core.DATA_DIR, core.DB_PATH = self._old
        self._tmp.cleanup()

    def test_start_returns_qr_and_waits(self) -> None:
        with mock.patch.object(mt, "available", return_value=True), \
             mock.patch.object(mt, "run_node", side_effect=[
                 {"ok": True, "url": "https://dpurl.cn/abc"},
                 {"ok": False, "error": "POLL_FAILED"},
             ]), \
             mock.patch.object(mt, "qr_base64", return_value="data:image/png;base64,QQ=="):
            session = mt.start_session(account_id=1)
            self.assertEqual(session["status"], "waiting")
            self.assertTrue(session["qr"] == "" or session["qr"].startswith("data:image"))
            self.assertNotIn("token", session)
            time.sleep(0.2)
        self.assertEqual(mt.session_status(session["id"])["status"], "waiting")

    def test_success_saves_account(self) -> None:
        with mock.patch.object(mt, "available", return_value=True), \
             mock.patch.object(mt, "qr_base64", return_value="data:,"), \
             mock.patch.object(mt, "run_node", side_effect=[
                 {"ok": True, "url": "https://dpurl.cn/abc"},
                 {"ok": True, "token": "mt-token-1234567890"},
             ]):
            session = mt.start_session(account_id=7)
            for _ in range(50):
                if mt.session_status(session["id"])["status"] != "waiting":
                    break
                time.sleep(0.05)
        final = mt.session_status(session["id"])
        self.assertEqual(final["status"], "success")
        self.assertTrue(final["has_token"])
        self.assertNotIn("token", final, "会话状态不能回传 token")
        saved = mt.list_accounts(None)
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]["account_id"], 7)

    def test_missing_runtime_reports_clearly(self) -> None:
        with mock.patch.object(mt, "available", return_value=False):
            with self.assertRaises(RuntimeError) as caught:
                mt.start_session()
        self.assertIn("不支持", str(caught.exception))

    def test_cancel(self) -> None:
        with mock.patch.object(mt, "available", return_value=True), \
             mock.patch.object(mt, "qr_base64", return_value="data:,"), \
             mock.patch.object(mt, "run_node", side_effect=[
                 {"ok": True, "url": "https://dpurl.cn/abc"},
                 {"ok": False, "error": "POLL_FAILED"},
             ]):
            session = mt.start_session()
            self.assertTrue(mt.cancel_session(session["id"]))
            self.assertEqual(mt.session_status(session["id"])["status"], "cancelled")

    def test_unknown_session(self) -> None:
        with self.assertRaises(ValueError):
            mt.session_status("nope")


class ExtractCompatTests(unittest.TestCase):
    def test_extract_works_without_filter_kwarg(self) -> None:
        """Python 3.11 的 extractall 没有 filter 参数，必须能回退。"""
        import tarfile as tf_mod
        calls = []

        class FakeTar:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def extractall(self, path, filter=None):
                calls.append(filter)
                if filter is not None:
                    raise TypeError("unexpected keyword argument 'filter'")

        with tempfile.TemporaryDirectory() as directory:
            tgz = os.path.join(directory, "mtuser-pt-passport-0.0.0.tgz")
            open(tgz, "wb").close()
            with mock.patch.object(mt, "ASSETS_DIR", directory), \
                 mock.patch.object(tf_mod, "open", return_value=FakeTar()):
                self.assertTrue(mt.ensure_assets())
        self.assertEqual(calls, ["data", None], "先带 filter，失败后回退")


if __name__ == "__main__":
    unittest.main()