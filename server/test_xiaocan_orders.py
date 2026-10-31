"""订单流单测：CRUD、三个官方动作（RPC 打桩）、状态与校验。

    python3 test_xiaocan_orders.py
"""
from __future__ import annotations

import os
import tempfile
import unittest
from unittest import mock

import core
import xiaocan_methods as methods
import xiaocan_orders as orders


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old = (core.DATA_DIR, core.DB_PATH)
        core.DATA_DIR, core.DB_PATH = self._tmp.name, os.path.join(self._tmp.name, "panel.db")
        core.close_db()
        core.init_db()
        orders.ensure_tables()
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

    def make(self, **kw) -> dict:
        payload = {"store_name": "测试店", "platform": "meituan", "order_money": 30,
                   "rebate_money": 12.5, "order_type": 0, "rebate_ratio": 0}
        payload.update(kw)
        return orders.create_order(kw.pop("account_id", self.account_id), payload)


class CrudTests(Base):
    def test_create_and_list(self) -> None:
        order = self.make()
        self.assertEqual(order["store_name"], "测试店")
        self.assertEqual(len(orders.list_orders(None)), 1)
        self.assertEqual(orders.list_orders([self.account_id])[0]["id"], order["id"])
        self.assertEqual(orders.list_orders([999]), [])

    def test_status_and_platform_validated(self) -> None:
        with self.assertRaises(ValueError):
            orders.create_order(self.account_id, {"store_name": "x", "status": "wat"})
        with self.assertRaises(ValueError):
            orders.create_order(self.account_id, {"store_name": "x", "platform": "pdd"})
        # taobao 是历史叫法，按开源版口径归到饿了么
        self.assertEqual(orders.create_order(self.account_id,
                                             {"store_name": "z", "platform": "taobao"})["platform"], "eleme")
        self.assertEqual(orders.create_order(self.account_id,
                                             {"store_name": "y", "platform": "jd"})["platform"], "jingdong")

    def test_store_name_required(self) -> None:
        with self.assertRaises(ValueError):
            orders.create_order(self.account_id, {"store_name": "  "})

    def test_update_and_delete(self) -> None:
        order = self.make()
        updated = orders.update_order(order["id"], {"status": "completed", "rebate_money": 20})
        self.assertEqual(updated["status"], "completed")
        self.assertEqual(updated["rebate_money"], 20)
        self.assertTrue(orders.delete_order(order["id"]))
        self.assertIsNone(orders.get_order(order["id"]))


class SubmitPlatformIdTests(Base):
    def test_body_and_local_status(self) -> None:
        order = self.make(order_sn="abc12345678")
        with mock.patch.object(methods, "call", return_value={"ok": True}) as call:
            orders.submit_platform_order_id(order["id"], "MT-999")
        body = call.call_args.args[2]
        self.assertEqual(call.call_args.args[1], "submit_platform_order_id")
        self.assertEqual(body["promotion_order_id"], 12345678, "从 order_sn 尾部取活动订单号")
        self.assertEqual(body["platform_order_id"], "MT-999")
        self.assertEqual(body["order_type"], 0)
        self.assertEqual(orders.get_order(order["id"])["status"], "auditing")

    def test_uses_stored_promotion_order_id_first(self) -> None:
        order = self.make()
        core.execute("UPDATE xc_orders SET promotion_order_id=? WHERE id=?", (555666, order["id"]))
        with mock.patch.object(methods, "call", return_value={}) as call:
            orders.submit_platform_order_id(order["id"], "X1")
        self.assertEqual(call.call_args.args[2]["promotion_order_id"], 555666)

    def test_rejects_second_platform_id(self) -> None:
        order = self.make(order_sn="abc12345678")
        with mock.patch.object(methods, "call", return_value={}):
            orders.submit_platform_order_id(order["id"], "A1")
        with self.assertRaises(ValueError):
            orders.submit_platform_order_id(order["id"], "B2")

    def test_requires_promotion_order_id(self) -> None:
        order = self.make(order_sn="no-digits")
        with self.assertRaises(ValueError):
            orders.submit_platform_order_id(order["id"], "A1")


class DelayVoucherTests(Base):
    def test_meituan_and_eleme_task_type(self) -> None:
        meituan = self.make(order_sn="abc12345678")
        eleme = self.make(order_sn="abc87654321", platform="eleme")
        with mock.patch.object(methods, "call", return_value={}) as call:
            orders.delay_voucher(meituan["id"])
            self.assertEqual(call.call_args.args[2]["task_type"], 4)
            orders.delay_voucher(eleme["id"])
            self.assertEqual(call.call_args.args[2]["task_type"], 3)

    def test_ratio_order_rejected(self) -> None:
        order = self.make(order_sn="abc12345678", rebate_ratio=0.12)
        with self.assertRaises(ValueError) as caught:
            orders.delay_voucher(order["id"])
        self.assertIn("比例", str(caught.exception))


class UseFreeCardTests(Base):
    def test_needs_platform_order_id(self) -> None:
        order = self.make(order_sn="abc12345678")
        with self.assertRaises(ValueError):
            orders.use_free_card(order["id"])

    def test_uses_card_from_upstream(self) -> None:
        order = self.make(order_sn="abc12345678", platform="eleme")
        core.execute("UPDATE xc_orders SET platform_order_id=? WHERE id=?", ("E-777", order["id"]))
        results = [{"info": {"had": True, "user_free_card_id": 321}}, {"ok": True}]
        with mock.patch.object(methods, "call", side_effect=results) as call:
            out = orders.use_free_card(order["id"])
        self.assertEqual(out["user_free_card_id"], 321)
        body = call.call_args.args[2]
        self.assertEqual(body["order_no"], "E-777")
        self.assertEqual(body["order_business"], 2, "饿了么传 2")
        self.assertEqual(body["user_free_card_id"], 321)

    def test_no_card_available(self) -> None:
        order = self.make(order_sn="abc12345678")
        core.execute("UPDATE xc_orders SET platform_order_id=? WHERE id=?", ("M-1", order["id"]))
        with mock.patch.object(methods, "call", return_value={"info": {"had": False}}):
            with self.assertRaises(ValueError) as caught:
                orders.use_free_card(order["id"])
        self.assertIn("没有可用的免单卡", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
