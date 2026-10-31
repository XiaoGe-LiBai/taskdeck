"""授时单测：SNTP 报文解析、HTTP 降级、缓存与失败处理（全部离线）。

    python3 test_time_service.py
"""
from __future__ import annotations

import struct
import time
import unittest
from unittest import mock

import time_service as ts


def ntp_packet(receive_unix: float, transmit_unix: float | None = None) -> bytes:
    """构造 48 字节 SNTP 响应：Receive 在 32:40，Transmit 在 40:48。"""
    transmit_unix = receive_unix if transmit_unix is None else transmit_unix

    def stamp(value: float) -> bytes:
        return struct.pack("!II", int(value) + ts.NTP_DELTA, int((value - int(value)) * 2**32))

    data = bytearray(48)
    data[0] = 0x24
    data[32:40] = stamp(receive_unix)
    data[40:48] = stamp(transmit_unix)
    return bytes(data)


class ParseTests(unittest.TestCase):
    def test_offset_when_server_ahead(self) -> None:
        t0 = 1_700_000_000.0
        t3 = t0 + 0.2            # 往返 200ms
        t1 = t0 + 5.0            # 服务端收包时刻：比本机快 5 秒
        t2 = t1 + 0.1            # 服务端处理 100ms
        parsed = ts.parse_ntp_response(ntp_packet(t1, t2), t0, t3)
        # offset = ((t1-t0) + (t2-t3)) / 2 = (5.0 + 4.9) / 2
        self.assertAlmostEqual(parsed["offset"], 4.95, places=3)
        # delay = (t3-t0) - (t2-t1) = 0.2 - 0.1
        self.assertAlmostEqual(parsed["round_trip"], 0.1, places=3)

    def test_short_packet_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ts.parse_ntp_response(b"\x24" * 10, 0, 1)

    def test_zero_timestamp_rejected(self) -> None:
        data = b"\x24" + 47 * b"\0"
        with self.assertRaises(ValueError):
            ts.parse_ntp_response(data, 0, 1)


class HttpFallbackTests(unittest.TestCase):
    def test_date_header_gives_offset(self) -> None:
        fixed = "Mon, 02 Jan 2006 15:04:05 GMT"
        server = 1136214245.0
        resp = mock.MagicMock()
        resp.headers = {"Date": fixed}
        resp.__enter__ = lambda self: self
        resp.__exit__ = lambda *args: False
        with mock.patch("urllib.request.urlopen", return_value=resp):
            result = ts.query_http()
        self.assertTrue(result["source"].startswith("http:"))
        self.assertAlmostEqual(result["offset"], server - (time.time()), delta=3)

    def test_missing_date_raises(self) -> None:
        resp = mock.MagicMock()
        resp.headers = {}
        resp.__enter__ = lambda self: self
        resp.__exit__ = lambda *args: False
        with mock.patch("urllib.request.urlopen", return_value=resp):
            with self.assertRaises(ValueError):
                ts.query_http()


class SyncTests(unittest.TestCase):
    def setUp(self) -> None:
        ts._state.update({"offset": 0.0, "round_trip": 0.0, "source": "", "last_sync": 0.0,
                          "synced": False, "error": ""})
        self.addCleanup(lambda: ts._state.update({"synced": False, "offset": 0.0, "last_sync": 0.0}))

    def test_cache_avoids_repeat(self) -> None:
        with mock.patch.object(ts, "_try_sources",
                               return_value={"offset": 1.5, "round_trip": 0.02, "source": "sntp:x"}) as src:
            ts.sync()
            ts.sync()
            self.assertEqual(src.call_count, 1, "120 秒内应命中缓存")
            ts.sync(force=True)
            self.assertEqual(src.call_count, 2, "force 必须绕过缓存")

    def test_offset_applied_to_clock(self) -> None:
        with mock.patch.object(ts, "_try_sources",
                               return_value={"offset": 10.0, "round_trip": 0.01, "source": "sntp:x"}):
            ts.sync(force=True)
        self.assertAlmostEqual(ts.clock() - time.time(), 10.0, delta=0.5)

    def test_failure_is_reported_not_raised(self) -> None:
        with mock.patch.object(ts, "_try_sources", side_effect=RuntimeError("UDP 123 被墙")):
            result = ts.status(force=True)
        self.assertFalse(result["synced"])
        self.assertIn("被墙", result["error"])
        self.assertIn("server_time", result)

    def test_tries_next_source(self) -> None:
        calls = []

        def flaky(host, timeout=ts.TIMEOUT):
            calls.append(host)
            if len(calls) == 1:
                raise OSError("timeout")
            return {"offset": 0.0, "round_trip": 0.01, "source": f"sntp:{host}"}

        with mock.patch.object(ts, "query_ntp", side_effect=flaky), \
             mock.patch.object(ts, "query_http", side_effect=AssertionError("不该走到 HTTP")):
            result = ts._try_sources()
        self.assertEqual(len(calls), 2, "第一个源失败应换下一个")
        self.assertEqual(result["source"], f"sntp:{ts.NTP_HOSTS[1]}")


if __name__ == "__main__":
    unittest.main()
