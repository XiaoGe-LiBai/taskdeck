"""抢单路由与到点执行器单测（全程打桩，不发真实请求）。

    python3 test_xiaocan_grab.py
"""
from __future__ import annotations

import os
import tempfile
import time
import unittest
from unittest import mock

import core
import grab_engine
import xiaocan_actions as actions
import xiaocan_bridge as xc

ACCOUNT = {"id": 1, "account_info": "9001", "xc_user_id": "8002", "access_token": "tok"}


class GrabRoutingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.calls: list[dict] = []

        def fake_rpc(server, method, payload=None, **kwargs):
            self.calls.append({"server": server, "method": method, "payload": payload, **kwargs})
            return {"promotion_order_id": 4242}

        patcher = mock.patch.object(xc, "xiaocan_rpc", side_effect=fake_rpc)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_standard_id_goes_to_silkworm_first(self) -> None:
        res = actions.grab_promotion_quota(ACCOUNT, "123456789", lat=1, lon=2)
        call = self.calls[0]
        self.assertEqual(call["server"], "Silkworm")
        self.assertEqual(call["method"], "SilkwormService.GrabPromotionQuota")
        self.assertNotIn("source", call["payload"])
        self.assertEqual(res["order_id"], 4242)

    def test_short_id_goes_to_fusion_with_source_2(self) -> None:
        actions.grab_promotion_quota(ACCOUNT, "123456", lat=1, lon=2)
        call = self.calls[0]
        self.assertEqual(call["server"], "SilkwormFusion")
        self.assertEqual(call["payload"]["source"], 2)

    def test_group_suffix_is_stripped(self) -> None:
        actions.grab_promotion_quota(ACCOUNT, "123456789_p3", lat=1, lon=2)
        self.assertEqual(self.calls[0]["payload"]["promotion_id"], 123456789)

    def test_fallback_when_primary_fails(self) -> None:
        def flaky(server, method, payload=None, **kwargs):
            self.calls.append({"server": server, "method": method, "payload": payload, **kwargs})
            if method == "SilkwormService.GrabPromotionQuota":
                raise RuntimeError("跨表未命中")
            return {"promotion_order_id": 7}

        with mock.patch.object(xc, "xiaocan_rpc", side_effect=flaky):
            res = actions.grab_promotion_quota(ACCOUNT, "123456789", lat=1, lon=2)
        self.assertEqual(self.calls[-1]["server"], "SilkwormFusion")
        self.assertEqual(res["order_id"], 7)

    def test_advance_and_redpack_are_forwarded(self) -> None:
        actions.grab_promotion_quota(ACCOUNT, "123456789", lat=1, lon=2, advance=True, redpack_id=88)
        body = self.calls[0]["payload"]
        self.assertTrue(body["if_advance_order"])
        self.assertEqual(body["redpack_id"], 88)

    def test_shangjin_id_rejected_explicitly(self) -> None:
        with self.assertRaises(ValueError) as caught:
            actions.grab_promotion_quota(ACCOUNT, "1234567890123456", lat=1, lon=2)
        self.assertIn("美团赏金", str(caught.exception))
        self.assertEqual(self.calls, [])

    def test_order_id_fallbacks(self) -> None:
        self.assertEqual(actions.order_id_of({"promotion_order_id": 5}), 5)
        self.assertEqual(actions.order_id_of({"order": {"promotion_order_id": 6}}), 6)
        self.assertEqual(actions.order_id_of({}), 0)
        self.assertEqual(actions.order_id_of({"promotion_order_id": "bad"}), 0)


class GrabEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        tmp = self._tmp.name
        self._old = (core.DATA_DIR, core.DB_PATH)
        core.DATA_DIR, core.DB_PATH = tmp, os.path.join(tmp, "panel.db")
        core.close_db()
        core.init_db()
        core.insert("accounts", {"user_id": 1, "nickname": "t", "account_info": "9001",
                                 "xc_user_id": "8002", "access_token": "tok", "status": "enabled",
                                 "bind_time": core.iso(), "created_time": core.iso(),
                                 "updated_time": core.iso()})
        grab_engine.reset_for_tests()
        self.addCleanup(grab_engine.reset_for_tests)
        self.addCleanup(core.close_db)
        self.addCleanup(self._tmp.cleanup)
        self.addCleanup(setattr, core, "DATA_DIR", self._old[0])
        self.addCleanup(setattr, core, "DB_PATH", self._old[1])

    def test_immediate_run_records_success(self) -> None:
        with mock.patch.object(actions, "grab_promotion_quota", return_value={"order_id": 99}) as grab:
            job = grab_engine.schedule(1, "123456789", lat="1", lon="2")
            for _ in range(100):
                if grab_engine.list_jobs()[0]["status"] in ("success", "failed"):
                    break
                time.sleep(0.02)
        final = grab_engine.list_jobs()[0]
        self.assertEqual(final["status"], "success")
        self.assertEqual(final["order_id"], 99)
        # schedule() 返回后线程可能已经开始跑，状态只能是这两个之一
        self.assertIn(job["status"], ("scheduled", "running"))
        grab.assert_called_once()

    def test_failure_message_is_kept(self) -> None:
        with mock.patch.object(actions, "grab_promotion_quota", side_effect=RuntimeError("WAF 熔断中")):
            grab_engine.schedule(1, "123456789", lat="1", lon="2")
            for _ in range(100):
                if grab_engine.list_jobs()[0]["status"] == "failed":
                    break
                time.sleep(0.02)
        final = grab_engine.list_jobs()[0]
        self.assertEqual(final["status"], "failed")
        self.assertIn("熔断", final["message"])

    def test_cancel_before_fire(self) -> None:
        with mock.patch.object(actions, "grab_promotion_quota") as grab:
            job = grab_engine.schedule(1, "123456789", at_ts=time.time() + 30, lat="1", lon="2")
            self.assertTrue(grab_engine.cancel(job["id"]))
            time.sleep(0.15)
        grab.assert_not_called()
        self.assertEqual(grab_engine.list_jobs()[0]["status"], "cancelled")

    def test_missing_account_fails_cleanly(self) -> None:
        with mock.patch.object(actions, "grab_promotion_quota") as grab:
            grab_engine.schedule(999, "123456789", lat="1", lon="2")
            for _ in range(100):
                if grab_engine.list_jobs()[0]["status"] == "failed":
                    break
                time.sleep(0.02)
        grab.assert_not_called()
        self.assertIn("账号不存在", grab_engine.list_jobs()[0]["message"])


if __name__ == "__main__":
    unittest.main()
