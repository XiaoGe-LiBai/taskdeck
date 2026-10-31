"""WAF 熔断单测：命中后进入冷却、冷却期内不再发请求、冷却结束自动恢复。

    python3 test_xiaocan_waf.py
"""
from __future__ import annotations

import unittest
from unittest import mock

import xiaocan_bridge as xc


class FakeResp:
    def __init__(self, status_code: int, *, body: str = "{}", headers: dict | None = None, payload=None):
        self.status_code = status_code
        self.text = body
        self.headers = headers or {}
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload


class WafBreakerTests(unittest.TestCase):
    def setUp(self) -> None:
        xc.clear_waf_block()
        self.addCleanup(xc.clear_waf_block)

    def call(self):
        return xc.xiaocan_rpc("Silkworm", "SilkwormService.GetClientUserInfo", {}, silk_id="1", token="t")

    def test_waf_403_marks_block(self) -> None:
        resp = FakeResp(403, body="<html>waf blocked</html>")
        with mock.patch("requests.post", return_value=resp):
            with self.assertRaises(RuntimeError) as caught:
                self.call()
        self.assertIn("熔断", str(caught.exception))
        self.assertTrue(xc.is_waf_blocked())
        self.assertGreater(xc.waf_cooldown_seconds(), 0)

    def test_stgw_server_header_also_counts(self) -> None:
        with mock.patch("requests.post", return_value=FakeResp(403, headers={"server": "stgw/1.0"})):
            with self.assertRaises(RuntimeError):
                self.call()
        self.assertTrue(xc.is_waf_blocked())

    def test_plain_403_does_not_block(self) -> None:
        with mock.patch("requests.post", return_value=FakeResp(403, body="forbidden", headers={"server": "nginx"})):
            with self.assertRaises(RuntimeError) as caught:
                self.call()
        self.assertNotIn("熔断", str(caught.exception))
        self.assertFalse(xc.is_waf_blocked())

    def test_blocked_call_skips_network(self) -> None:
        xc.mark_waf_blocked(30)
        with mock.patch("requests.post") as post:
            with self.assertRaises(RuntimeError) as caught:
                self.call()
        post.assert_not_called()
        self.assertIn("冷却", str(caught.exception))

    def test_cooldown_expires(self) -> None:
        xc.mark_waf_blocked(1)
        self.assertTrue(xc.is_waf_blocked())
        with mock.patch("xiaocan_bridge.time.time", return_value=__import__("time").time() + 2):
            self.assertFalse(xc.is_waf_blocked())
            self.assertEqual(xc.waf_cooldown_seconds(), 0)

    def test_success_keeps_clear(self) -> None:
        with mock.patch("requests.post", return_value=FakeResp(200, payload={"code": 200})):
            self.call()
        self.assertFalse(xc.is_waf_blocked())


if __name__ == "__main__":
    unittest.main()
