"""店铺监控单测：创建校验、四类探测、去重与通知（网络全部打桩）。

    python3 test_store_watch.py
"""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

import core
import store_watch as watch


def item(name, promo="1", left=3, money=800):
    return {"meituan_shop_url": name, "promotion_id": promo, "left_number": left, "order_money": money}


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old = (core.DATA_DIR, core.DB_PATH)
        core.DATA_DIR, core.DB_PATH = self._tmp.name, os.path.join(self._tmp.name, "panel.db")
        core.close_db()
        core.init_db()
        watch.ensure_tables()
        core.insert("accounts", {"user_id": 1, "nickname": "t", "account_info": "9001",
                                 "xc_user_id": "8002", "access_token": "tok", "status": "enabled",
                                 "bind_time": core.iso(), "created_time": core.iso(),
                                 "updated_time": core.iso()})
        self.account_id = core.query_one("SELECT id FROM accounts")["id"]
        self.addCleanup(self._restore)

    def _restore(self) -> None:
        core.close_db()
        core.DATA_DIR, core.DB_PATH = self._old
        self._tmp.cleanup()


class CreateTests(Base):
    def test_keyword_requires_keyword(self) -> None:
        with self.assertRaises(ValueError):
            watch.create_watch(self.account_id, "keyword", {})

    def test_stock_requires_promotion_id(self) -> None:
        with self.assertRaises(ValueError):
            watch.create_watch(self.account_id, "stock", {})

    def test_bad_kind(self) -> None:
        with self.assertRaises(ValueError):
            watch.create_watch(self.account_id, "nope", {})

    def test_interval_floor(self) -> None:
        created = watch.create_watch(self.account_id, "name", {"keyword": "披萨"}, interval_sec=5)
        self.assertEqual(created["interval_sec"], watch.MIN_INTERVAL)

    def test_list_and_delete_scope(self) -> None:
        created = watch.create_watch(self.account_id, "name", {"keyword": "披萨"})
        self.assertEqual(len(watch.list_watches(None)), 1)
        self.assertEqual(len(watch.list_watches([999])), 0)
        self.assertFalse(watch.delete_watch(created["id"], [999]))
        self.assertTrue(watch.delete_watch(created["id"], None))


class ProbeTests(Base):
    def test_keyword_filters_by_name(self) -> None:
        rows = [item("dough bros 披萨"), item("瑞幸咖啡")]
        with mock.patch("xiaocan_actions.search_stores", return_value={"items": rows}):
            found = watch.probe({"id": 1}, "keyword", {"keyword": "披萨", "lat": 1, "lon": 2})
        self.assertEqual(len(found), 1)
        self.assertIn("披萨", found[0]["title"])
        self.assertIn("|", found[0]["key"])

    def test_stock_only_when_positive(self) -> None:
        rows = [item("A", promo="777", left=2), item("B", promo="888", left=0)]
        with mock.patch("xiaocan_actions.feed_stores", return_value={"items": rows}):
            found = watch.probe({"id": 1}, "stock", {"promotion_id": "777", "lat": 1, "lon": 2})
            self.assertEqual(len(found), 1)
            found_zero = watch.probe({"id": 1}, "stock", {"promotion_id": "888", "lat": 1, "lon": 2})
        self.assertEqual(found_zero, [], "名额为 0 不应触发")

    def test_dual_groups_same_store(self) -> None:
        rows = [item("同店", promo="1"), item("同店", promo="2"), item("独店", promo="3")]
        with mock.patch("xiaocan_actions.feed_stores", return_value={"items": rows}):
            found = watch.probe({"id": 1}, "dual", {"lat": 1, "lon": 2})
        self.assertEqual([f["title"] for f in found], ["同店"])

    def test_error_surfaces_when_nothing_collected(self) -> None:
        """WAF 熔断这类错误不能被吞掉，否则界面只会看到「扫描 0 条」。"""
        with mock.patch("xiaocan_actions.feed_stores", side_effect=RuntimeError("WAF 熔断中")):
            with self.assertRaises(RuntimeError) as caught:
                watch.probe({"id": 1}, "dual", {"lat": 1, "lon": 2})
        self.assertIn("熔断", str(caught.exception))

    def test_collect_stops_on_short_page(self) -> None:
        with mock.patch("xiaocan_actions.feed_stores", return_value={"items": rows[:2]}) as feed:
            watch.probe({"id": 1}, "dual", {"lat": 1, "lon": 2})
        self.assertEqual(feed.call_count, 1, "首页不足 20 条就不该再翻页")


rows = [item("同店", promo="1"), item("同店", promo="2")]


class RunOnceTests(Base):
    def test_dedupes_and_notifies_once(self) -> None:
        created = watch.create_watch(self.account_id, "dual", {"lat": 1, "lon": 2})
        with mock.patch.object(watch, "probe", return_value=[
                {"key": "同店", "title": "同店", "detail": "同店 2 个方案"}]), \
             mock.patch("notify.notify_async") as notify_call:
            first = watch.run_once(created)
            second = watch.run_once(created)
        self.assertEqual(len(first["new"]), 1)
        self.assertEqual(second["new"], [], "同一活动只通知一次")
        self.assertEqual(notify_call.call_count, 1)
        stored = watch.list_watches(None)[0]
        self.assertEqual(stored["hits"], 1)

    def test_probe_error_is_recorded(self) -> None:
        created = watch.create_watch(self.account_id, "dual", {"lat": 1, "lon": 2})
        with mock.patch.object(watch, "probe", side_effect=RuntimeError("WAF 熔断中")):
            result = watch.run_once(created)
        self.assertEqual(result["new"], [])
        self.assertIn("熔断", result["error"])
        self.assertIn("熔断", watch.list_watches(None)[0]["last_error"])

    def test_paused_watch_skipped_by_status(self) -> None:
        created = watch.create_watch(self.account_id, "dual", {"lat": 1, "lon": 2})
        watch.set_status(created["id"], "paused")
        self.assertEqual(watch.list_watches(None)[0]["status"], "paused")
        with self.assertRaises(ValueError):
            watch.set_status(created["id"], "wat")


if __name__ == "__main__":
    unittest.main()
