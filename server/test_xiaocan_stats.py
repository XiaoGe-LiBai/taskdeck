"""看板统计单测：口径（累计/在途/今日）、账号过滤、日志读写。

    python3 test_xiaocan_stats.py
"""
from __future__ import annotations

import os
import tempfile
import time
import unittest

import core
import xiaocan_stats as stats


class StatsBase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        tmp = self._tmp.name
        self._old = (core.DATA_DIR, core.DB_PATH)
        core.DATA_DIR, core.DB_PATH = tmp, os.path.join(tmp, "panel.db")
        core.close_db()
        core.init_db()
        stats.ensure_tables()
        self.addCleanup(self._restore)

    def _restore(self) -> None:
        core.close_db()
        core.DATA_DIR, core.DB_PATH = self._old
        self._tmp.cleanup()

    def order(self, *, account_id=1, sn="A1", status="pending", rebate=10.0, money=30.0,
              platform="meituan", created=None):
        core.get_db().execute(
            "INSERT INTO xc_orders (account_id,order_sn,store_name,platform,order_money,rebate_money,"
            "status,created_time) VALUES (?,?,?,?,?,?,?,?)",
            (account_id, sn, "店", platform, money, rebate, status, created or core.iso()),
        )


class StatsTests(StatsBase):
    def test_empty(self) -> None:
        result = stats.stats([])
        self.assertEqual(result["total_orders"], 0)
        self.assertEqual(result["total_rebate"], 0)

    def test_rebate_split_by_status(self) -> None:
        self.order(sn="A1", status="completed", rebate=12.5)
        self.order(sn="A2", status="pending", rebate=8.0)
        self.order(sn="A3", status="auditing", rebate=2.0)
        self.order(sn="A4", status="rejected", rebate=99.0)
        self.order(sn="A5", status="cancelled", rebate=99.0)
        result = stats.stats(None)
        self.assertEqual(result["total_rebate"], 12.5, "累计到账只算已完成")
        self.assertEqual(result["pending_rebate"], 10.0, "在途 = pending + auditing")
        self.assertEqual(result["completed_orders"], 1)
        self.assertEqual(result["pending_orders"], 2)
        self.assertEqual(result["total_orders"], 3, "被拒/取消不计入总单量")

    def test_account_scope(self) -> None:
        self.order(account_id=1, sn="A1", status="completed", rebate=5)
        self.order(account_id=2, sn="A2", status="completed", rebate=7)
        self.assertEqual(stats.stats([1])["total_rebate"], 5)
        self.assertEqual(stats.stats([1, 2])["total_rebate"], 12)
        self.assertEqual(stats.stats([])["total_rebate"], 0, "没有账号时不能退化成全量")

    def test_today_metrics(self) -> None:
        yesterday = time.strftime("%Y-%m-%dT10:00:00.000+08:00",
                                  time.localtime(time.time() - 86400))
        self.order(sn="A1", status="completed", rebate=6, created=core.iso())
        self.order(sn="A2", status="pending", rebate=4, created=core.iso())
        self.order(sn="A3", status="completed", rebate=100, created=yesterday)
        result = stats.stats(None)
        self.assertEqual(result["today_orders"], 2)
        self.assertEqual(result["today_saved"], 10.0)
        self.assertEqual(result["today_completed_orders"], 1)
        self.assertEqual(result["today_pending_orders"], 1)


class ChartTests(StatsBase):
    def test_trend_has_seven_days_and_today_bucket(self) -> None:
        self.order(sn="A1", status="completed", rebate=3.5)
        data = stats.chart_data(None)
        self.assertEqual(len(data["trend"]), 7)
        self.assertEqual(data["trend"][-1]["rebate"], 3.5, "今天的返现落在最后一格")
        self.assertEqual(data["status_counts"]["completed"], 1)
        self.assertEqual(data["platform_counts"]["meituan"], 1)
        self.assertEqual(data["today_summary"]["today_orders"], 1)

    def test_platform_alias(self) -> None:
        self.order(sn="A1", platform="jd")
        data = stats.chart_data(None)
        self.assertEqual(data["platform_counts"]["jingdong"], 1)


class JobLogTests(StatsBase):
    def test_record_and_list_and_clear(self) -> None:
        stats.record_job(1, "grab", "success", "ok")
        stats.record_job(2, "daily", "failed", "401")
        self.assertEqual(len(stats.list_jobs(None)), 2)
        self.assertEqual(len(stats.list_jobs([1])), 1)
        self.assertEqual(stats.clear_jobs([1]), 1)
        self.assertEqual(len(stats.list_jobs(None)), 1)

    def test_record_order_is_idempotent(self) -> None:
        stats.record_order(1, order_sn="SN1", rebate_money=9)
        stats.record_order(1, order_sn="SN1", rebate_money=9)
        self.assertEqual(stats.stats(None)["pending_orders"], 1)


if __name__ == "__main__":
    unittest.main()
