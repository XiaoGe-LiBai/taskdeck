"""抢单执行器：到点触发 + 可取消 + 结果留痕。

定位：
- 只做「什么时候打、打完记什么」，真正的小蚕调用在 xiaocan_actions.grab_promotion_quota；
- 任务存在进程内存里（重启即失效），与开源版一致的取舍：抢单是秒级窗口，写库反而增加延迟风险；
- 到点前的等待分两段：>0.5s 时 50ms 轮询，最后 0.5s 缩到 5ms，兼顾精度与 CPU。
"""
from __future__ import annotations

import threading
import time
import uuid
from typing import Any

import core
import xiaocan_actions as actions

_JOBS: dict[str, dict[str, Any]] = {}
_TIMERS: dict[str, threading.Thread] = {}
_LOCK = threading.Lock()

MAX_JOBS = 200


def _now() -> float:
    return time.time()


def _wait_until(target_ts: float, cancelled: threading.Event) -> bool:
    """等到目标时刻；期间被取消则返回 False。"""
    while True:
        if cancelled.is_set():
            return False
        remain = target_ts - _now()
        if remain <= 0:
            return True
        time.sleep(0.05 if remain > 0.5 else 0.005)


def _fire(job_id: str, cancelled: threading.Event) -> None:
    job = _JOBS.get(job_id)
    if not job:
        return
    if not _wait_until(job["at_ts"], cancelled):
        job["status"] = "cancelled"
        return

    job["status"] = "running"
    job["started_at"] = core.iso()
    try:
        account = core.query_one("SELECT * FROM accounts WHERE id=?", (job["account_id"],))
        if not account:
            raise RuntimeError("账号不存在（可能已被删除）")
        result = actions.grab_promotion_quota(
            dict(account),
            job["promotion_id"],
            advance=job["advance"],
            lat=job["lat"],
            lon=job["lon"],
            city_code=job["city_code"],
            store_platform=job["store_platform"],
        )
        job["order_id"] = int(result.get("order_id") or 0)
        job["status"] = "success" if job["order_id"] > 0 else "failed"
        job["message"] = "" if job["order_id"] > 0 else (result.get("msg") or "未返回官方订单号")
    except Exception as exc:  # 失败原因要留给界面看，不能只写日志
        job["status"] = "failed"
        job["message"] = str(exc)
    finally:
        job["finished_at"] = core.iso()
        with _LOCK:
            _TIMERS.pop(job_id, None)


def _prune() -> None:
    """只保留最近 MAX_JOBS 条，避免长期运行后内存无限增长。"""
    if len(_JOBS) <= MAX_JOBS:
        return
    finished = sorted(
        (jid for jid, job in _JOBS.items() if job["status"] in ("success", "failed", "cancelled")),
        key=lambda jid: _JOBS[jid].get("finished_at") or "",
    )
    for jid in finished[: len(_JOBS) - MAX_JOBS]:
        _JOBS.pop(jid, None)


def schedule(
    account_id: int,
    promotion_id: str,
    *,
    at_ts: float | None = None,
    advance: bool = False,
    lat: str | float | None = None,
    lon: str | float | None = None,
    city_code: str | int | None = None,
    store_platform: int = 1,
) -> dict:
    """安排一次抢单；at_ts 为空或已过去则立即开始。"""
    job_id = uuid.uuid4().hex[:12]
    target = float(at_ts) if at_ts else _now()
    job = {
        "id": job_id,
        "account_id": int(account_id),
        "promotion_id": str(promotion_id),
        "at_ts": target,
        "at": core.iso(core.now_dt()) if target <= _now() else _iso_from_ts(target),
        "advance": bool(advance),
        "lat": lat,
        "lon": lon,
        "city_code": city_code,
        "store_platform": int(store_platform or 1),
        "status": "scheduled",
        "order_id": 0,
        "message": "",
        "created_at": core.iso(),
    }
    cancelled = threading.Event()
    with _LOCK:
        _JOBS[job_id] = job
        job["_cancelled"] = cancelled
        thread = threading.Thread(target=_fire, args=(job_id, cancelled), name=f"grab-{job_id}", daemon=True)
        _TIMERS[job_id] = thread
    thread.start()
    _prune()
    return public(job)


def _iso_from_ts(ts: float) -> str:
    from datetime import datetime
    return core.iso(datetime.fromtimestamp(ts, core.CN_TZ))


def cancel(job_id: str) -> bool:
    job = _JOBS.get(job_id)
    if not job or job["status"] not in ("scheduled", "running"):
        return False
    job["_cancelled"].set()  # type: ignore[union-attr]
    job["status"] = "cancelled"
    return True


def public(job: dict) -> dict:
    return {k: v for k, v in job.items() if not k.startswith("_")}


def list_jobs(limit: int = 50) -> list[dict]:
    jobs = sorted(_JOBS.values(), key=lambda j: j.get("created_at") or "", reverse=True)
    return [public(j) for j in jobs[:limit]]


def reset_for_tests() -> None:
    with _LOCK:
        for job in _JOBS.values():
            job["_cancelled"].set()  # type: ignore[union-attr]
        _JOBS.clear()
        _TIMERS.clear()
