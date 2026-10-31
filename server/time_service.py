"""授时：SNTP(RFC 5905) 校准本机时钟，UDP 被墙时降级用 HTTP Date 头。

为什么需要：抢单是秒级窗口，本机时钟漂移 1 秒就可能抢空。
为什么带降级：很多云主机/容器网络封 UDP 123，只做 SNTP 会永远失败。

对外只暴露两个函数：
- `sync(force=False)`：拿一次校准结果（带 120 秒缓存）
- `status()`：给接口用的快照，永远不抛异常
"""
from __future__ import annotations

import socket
import struct
import threading
import time
import urllib.request
from datetime import datetime, timezone
from typing import Any

NTP_HOSTS = ("ntp.aliyun.com", "cn.pool.ntp.org", "time.cloudflare.com")
HTTP_FALLBACKS = ("https://www.baidu.com", "https://www.taobao.com")
NTP_DELTA = 2208988800  # 1900-01-01 到 1970-01-01 的秒数
CACHE_TTL = 120
TIMEOUT = 2.0

_lock = threading.Lock()
_state: dict[str, Any] = {
    "offset": 0.0,
    "round_trip": 0.0,
    "source": "",
    "last_sync": 0.0,
    "synced": False,
    "error": "",
}


def _to_unix(seconds: int, fraction: int) -> float:
    return (seconds - NTP_DELTA) + fraction / 2**32


def parse_ntp_response(data: bytes, t0: float, t3: float) -> dict[str, float]:
    """解析 48 字节 SNTP 响应，算出 (offset, round_trip)。

    offset = ((t1 - t0) + (t2 - t3)) / 2；delay = (t3 - t0) - (t2 - t1)
    """
    if len(data) < 48:
        raise ValueError("SNTP 响应不足 48 字节")
    originate = struct.unpack("!II", data[24:32])
    receive = struct.unpack("!II", data[32:40])
    transmit = struct.unpack("!II", data[40:48])
    if receive == (0, 0) or transmit == (0, 0):
        raise ValueError("SNTP 响应缺少时间戳")
    t1 = _to_unix(*receive)
    t2 = _to_unix(*transmit)
    del originate  # 仅用于校验，暂不参与计算
    offset = ((t1 - t0) + (t2 - t3)) / 2
    delay = (t3 - t0) - (t2 - t1)
    return {"offset": offset, "round_trip": max(0.0, delay)}


def query_ntp(host: str = NTP_HOSTS[0], timeout: float = TIMEOUT) -> dict[str, Any]:
    packet = b"\x1b" + 47 * b"\0"  # LI=0, VN=3, Mode=3(client)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(timeout)
        t0 = time.time()
        sock.sendto(packet, (host, 123))
        data, _addr = sock.recvfrom(48)
        t3 = time.time()
    parsed = parse_ntp_response(data, t0, t3)
    return {**parsed, "source": f"sntp:{host}"}


def query_http(url: str = HTTP_FALLBACKS[0], timeout: float = TIMEOUT) -> dict[str, Any]:
    """读响应头 Date（秒级精度），用请求往返中点抵消一半延迟。"""
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
    t0 = time.time()
    with urllib.request.urlopen(request, timeout=timeout) as resp:
        header = resp.headers.get("Date") or ""
    t3 = time.time()
    if not header:
        raise ValueError("响应头没有 Date")
    server = datetime.strptime(header, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=timezone.utc).timestamp()
    offset = server - (t0 + t3) / 2
    return {"offset": offset, "round_trip": t3 - t0, "source": f"http:{url}"}


def _try_sources() -> dict[str, Any]:
    errors = []
    for host in NTP_HOSTS:
        try:
            return query_ntp(host)
        except Exception as exc:
            errors.append(f"{host}: {exc}")
    for url in HTTP_FALLBACKS:
        try:
            return query_http(url)
        except Exception as exc:
            errors.append(f"{url}: {exc}")
    raise RuntimeError("；".join(errors[-3:]) or "授时失败")


def sync(force: bool = False) -> dict[str, Any]:
    """同步一次（带缓存）；失败时保留上次成功结果并记录错误。"""
    with _lock:
        now = time.time()
        if not force and _state["synced"] and now - _state["last_sync"] < CACHE_TTL:
            return dict(_state)
        try:
            result = _try_sources()
            _state.update({
                "offset": result["offset"],
                "round_trip": result["round_trip"],
                "source": result["source"],
                "last_sync": now,
                "synced": True,
                "error": "",
            })
        except Exception as exc:
            _state["error"] = str(exc)[:300]
        return dict(_state)


def clock() -> float:
    """校准后的当前时间戳（未同步过则等同本机时间）。"""
    return time.time() + (_state["offset"] if _state["synced"] else 0.0)


def status(force: bool = False) -> dict[str, Any]:
    """给接口用的快照：永远返回结构，不抛异常。"""
    state = sync(force=force)
    now = clock()
    return {
        "synced": bool(state["synced"]),
        "source": state["source"],
        "offset_ms": round(state["offset"] * 1000, 2),
        "round_trip_ms": round(state["round_trip"] * 1000, 2),
        "last_sync": state["last_sync"],
        "server_time": datetime.fromtimestamp(now, timezone.utc).astimezone().isoformat(timespec="milliseconds"),
        "timestamp": now,
        "error": state["error"],
    }
