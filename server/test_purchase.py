"""会员购买单测：vip（无需账号升级）/ membership（需账号续期）/ slot（车位）。

python3 test_purchase.py
"""
from __future__ import annotations

import datetime as _dt
import os
import tempfile
import unittest

import core


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._old = (core.DATA_DIR, core.DB_PATH)
        core.DATA_DIR, core.DB_PATH = self._tmp.name, os.path.join(self._tmp.name, "panel.db")
        core.close_db()
        core.init_db()

        core.insert("users", {
            "email": "buyer@test", "password_hash": "x", "nickname": "买家",
            "role": "user", "channel": "xiaocan", "status": "normal",
            "points_balance": 100000, "points_spent": 0,
            "slot_total": 0, "slot_used": 0,
            "vip_level": 0, "vip_expire": None, "token_version": 1,
            "created_time": core.iso(),
        })
        self.user_id = core.query_one("SELECT id FROM users")["id"]

        self.vip_id = core.insert("products", {
            "code": "vip30", "name": "高级会员30天", "product_type": "vip",
            "grant_value": 30, "points_price": 2998, "sort_order": 1,
            "status": "enabled", "created_time": core.iso()})
        self.mem_id = core.insert("products", {
            "code": "acc30", "name": "托管续期30天", "product_type": "membership",
            "grant_value": 30, "points_price": 3998, "sort_order": 2,
            "status": "enabled", "created_time": core.iso()})
        self.slot_id = core.insert("products", {
            "code": "slot1", "name": "车位", "product_type": "slot",
            "grant_value": 1, "points_price": 99, "sort_order": 3,
            "status": "enabled", "created_time": core.iso()})

        core.insert("accounts", {
            "user_id": self.user_id, "nickname": "a1", "account_info": "9001",
            "xc_user_id": "8002", "access_token": "tok", "status": "enabled",
            "membership_expire": None, "bind_time": core.iso(),
            "created_time": core.iso(), "updated_time": core.iso()})
        self.account_id = core.query_one("SELECT id FROM accounts")["id"]

        from flask import Flask

        import api_user

        app = Flask(__name__)
        app.json.ensure_ascii = False
        app.register_blueprint(api_user.bp, url_prefix="/api")
        app.teardown_appcontext(core.close_db)
        self.client = app.test_client()
        self.token = core.make_token(self.user_id, "user", 1)[0]
        self.addCleanup(self._restore)

    def _restore(self) -> None:
        core.close_db()
        core.DATA_DIR, core.DB_PATH = self._old
        self._tmp.cleanup()

    def _buy(self, product_id: int, account_id=None):
        body = {"product_id": product_id}
        if account_id:
            body["account_id"] = account_id
        return self.client.post(
            "/api/points/purchase", json=body,
            headers={"Authorization": f"Bearer {self.token}"})

    def _user(self):
        return core.query_one("SELECT * FROM users WHERE id=?", (self.user_id,))


class PurchaseTests(Base):
    def test_vip_without_account(self) -> None:
        resp = self._buy(self.vip_id)
        self.assertEqual(resp.json["code"], 200)
        self.assertEqual(resp.json["data"]["vip_level"], 1, "30 天应授予高级会员")
        self.assertEqual(self._user()["vip_level"], 1)
        self.assertIsNotNone(self._user()["vip_expire"], "购买后应有等级到期时间")

    def test_membership_requires_account(self) -> None:
        resp = self._buy(self.mem_id)
        self.assertEqual(resp.json["code"], 400)
        self.assertIn("托管账号", resp.json["msg"])

    def test_membership_renews_account_only(self) -> None:
        resp = self._buy(self.mem_id, self.account_id)
        self.assertEqual(resp.json["code"], 200)
        account = core.query_one("SELECT * FROM accounts WHERE id=?", (self.account_id,))
        self.assertIsNotNone(account["membership_expire"], "托管号应获得会员期")
        self.assertEqual(self._user()["vip_level"], 0, "托管续期不应联动用户等级")

    def test_slot_adds_without_discount(self) -> None:
        resp = self._buy(self.slot_id)
        self.assertEqual(resp.json["code"], 200)
        self.assertEqual(self._user()["slot_total"], 1)
        self.assertEqual(resp.json["data"]["paid"], 99, "车位不打折")

    def test_vip_discount_for_supreme(self) -> None:
        core.execute(
            "UPDATE users SET vip_level=2, vip_expire=? WHERE id=?",
            (core.iso(core.now_dt() + _dt.timedelta(days=10)), self.user_id),
        )
        resp = self._buy(self.vip_id)
        self.assertEqual(resp.json["code"], 200)
        self.assertEqual(resp.json["data"]["paid"], 2698, "至尊会员应 9 折")


if __name__ == "__main__":
    unittest.main()
