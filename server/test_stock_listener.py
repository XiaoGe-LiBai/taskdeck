"""Tests for explicit stock listening; no external requests are made."""
from __future__ import annotations

import os
import tempfile
import threading
import time
import unittest
from unittest import mock

import core
import stock_listener
import xiaocan_actions as actions


class StockListenerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = (core.DATA_DIR, core.DB_PATH)
        core.close_db()
        core.DATA_DIR = self.temp.name
        core.DB_PATH = os.path.join(self.temp.name, 'panel.db')
        core.init_db()
        core.insert('accounts', {'user_id': 1, 'nickname': 'test', 'account_info': '9001',
                                 'xc_user_id': '8002', 'access_token': 'token', 'status': 'enabled',
                                 'bind_time': core.iso(), 'created_time': core.iso(), 'updated_time': core.iso()})

    def tearDown(self):
        stock_listener.reset_for_tests()
        core.close_db()
        core.DATA_DIR, core.DB_PATH = self.old
        self.temp.cleanup()

    def test_stock_triggers_one_grab_and_persists_success(self):
        done = threading.Event()

        def grab(*args, **kwargs):
            done.set()
            return {'order_id': 42}

        with mock.patch.object(actions, 'promotion_stock', return_value=1), \
             mock.patch.object(actions, 'grab_promotion_quota', side_effect=grab) as call:
            job = stock_listener.create(1, '123456789', lat='1', lon='2', city_code='440300')
            self.assertTrue(done.wait(2))
            for _ in range(100):
                final = stock_listener.get_job(job['id'])
                if final['status'] == 'success':
                    break
                time.sleep(.01)
        self.assertEqual(final['status'], 'success')
        self.assertEqual(final['order_id'], 42)
        call.assert_called_once()

    def test_cancel_during_stock_query_prevents_grab(self):
        started, finish = threading.Event(), threading.Event()

        def probe(*args, **kwargs):
            started.set()
            finish.wait(2)
            return 1

        with mock.patch.object(actions, 'promotion_stock', side_effect=probe), \
             mock.patch.object(actions, 'grab_promotion_quota') as grab:
            job = stock_listener.create(1, '123456789', lat='1', lon='2', city_code='440300')
            self.assertTrue(started.wait(2))
            self.assertTrue(stock_listener.cancel(job['id']))
            finish.set()
            stock_listener.reset_for_tests()
        grab.assert_not_called()
        self.assertEqual(stock_listener.get_job(job['id'])['status'], 'cancelled')

    def test_recovery_marks_inflight_unknown(self):
        with mock.patch.object(actions, 'promotion_stock', return_value=0):
            job = stock_listener.create(1, '123456789', lat='1', lon='2', city_code='440300')
            stock_listener.reset_for_tests()
        core.execute("UPDATE xc_stock_listeners SET status='running' WHERE id=?", (job['id'],))
        stock_listener.recover()
        self.assertEqual(stock_listener.get_job(job['id'])['status'], 'unknown')

    def test_duplicate_active_listener_rejected(self):
        with mock.patch.object(actions, 'promotion_stock', return_value=0):
            stock_listener.create(1, '123456789', lat='1', lon='2', city_code='440300')
            with self.assertRaisesRegex(ValueError, '已有'):
                stock_listener.create(1, '123456789', lat='1', lon='2', city_code='440300')

    def test_scope_and_invalid_activity(self):
        with self.assertRaises(ValueError):
            stock_listener.create(1, '1234567890123456', lat='1', lon='2', city_code='440300')
        with mock.patch.object(actions, 'promotion_stock', return_value=0):
            job = stock_listener.create(1, '123456789', lat='1', lon='2', city_code='440300')
            self.assertEqual(stock_listener.list_jobs([2]), [])
            self.assertEqual(stock_listener.list_jobs([1])[0]['id'], job['id'])


if __name__ == '__main__':
    unittest.main()
