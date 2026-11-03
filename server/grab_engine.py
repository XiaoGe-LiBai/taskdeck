"""Persistent scheduled grab jobs.

A job is claimed atomically before the upstream request. Interrupted requests are
never retried automatically because the upstream order may already exist.
"""
from __future__ import annotations

import math
import threading
import time
import uuid
from datetime import datetime

import core
import xiaocan_actions as actions
import xiaocan_stats as stats

_LOCK = threading.Lock()
_TIMERS: dict[str, tuple[threading.Thread, threading.Event]] = {}
MAX_JOBS = 200


def ensure_tables() -> None:
    core.get_db().execute("""CREATE TABLE IF NOT EXISTS xc_grab_jobs (
        id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, promotion_id TEXT NOT NULL,
        at_ts REAL NOT NULL, at TEXT NOT NULL, advance INTEGER NOT NULL DEFAULT 0,
        lat TEXT, lon TEXT, city_code TEXT, store_platform INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL, order_id INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
        early_ms INTEGER NOT NULL DEFAULT 0, redpack_id INTEGER NOT NULL DEFAULT 0,
        redpack_mode INTEGER NOT NULL DEFAULT 0
    )""")
    columns = {row["name"] for row in core.query("PRAGMA table_info(xc_grab_jobs)")}
    if "redpack_mode" not in columns:
        core.get_db().execute("ALTER TABLE xc_grab_jobs ADD COLUMN redpack_mode INTEGER NOT NULL DEFAULT 0")
    core.get_db().execute("CREATE INDEX IF NOT EXISTS xc_grab_jobs_account ON xc_grab_jobs(account_id, created_at DESC)")


def _now() -> float:
    return time.time()


def _iso_from_ts(ts: float) -> str:
    return core.iso(datetime.fromtimestamp(ts, core.CN_TZ))


def _row(job_id: str) -> dict | None:
    row = core.query_one("SELECT * FROM xc_grab_jobs WHERE id=?", (job_id,))
    return dict(row) if row else None


def _spawn(job_id: str) -> None:
    with _LOCK:
        if job_id in _TIMERS:
            return
        event = threading.Event()
        thread = threading.Thread(target=_fire, args=(job_id, event), name=f"grab-{job_id}", daemon=True)
        _TIMERS[job_id] = (thread, event)
        thread.start()


def _fire(job_id: str, cancelled: threading.Event) -> None:
    try:
        job = _row(job_id)
        if not job:
            return
        target = job["at_ts"] - job["early_ms"] / 1000
        while not cancelled.is_set():
            remaining = target - _now()
            if remaining <= 0:
                break
            cancelled.wait(min(remaining, 0.05 if remaining > 0.5 else 0.005))
        if cancelled.is_set():
            return
        cur = core.get_db().execute(
            "UPDATE xc_grab_jobs SET status='running', started_at=? WHERE id=? AND status='scheduled'",
            (core.iso(), job_id),
        )
        if cur.rowcount != 1:
            return
        try:
            account = core.query_one("SELECT * FROM accounts WHERE id=?", (job["account_id"],))
            if not account:
                raise ValueError("账号不存在")
            redpack_id = int(job["redpack_id"] or 0)
            if int(job["redpack_mode"]) == 0:
                try:
                    redpack_id = actions.best_redpack_id(dict(account)) or 0
                except Exception:
                    redpack_id = 0
            elif int(job["redpack_mode"]) == 2:
                redpack_id = 0
            result = actions.grab_promotion_quota(
                dict(account), job["promotion_id"], advance=bool(job["advance"]),
                lat=job["lat"], lon=job["lon"], city_code=job["city_code"],
                store_platform=job["store_platform"], redpack_id=redpack_id,
            )
            order_id = int(result.get("order_id") or 0)
            status = "success" if order_id else "failed"
            message = "" if order_id else (result.get("msg") or "未返回官方订单号")
        except Exception as exc:
            order_id = 0
            status = "failed" if isinstance(exc, ValueError) else "unknown"
            message = str(exc) if status == "failed" else f"请求结果未确认，请先检查平台订单：{exc}"
        core.get_db().execute(
            "UPDATE xc_grab_jobs SET status=?, order_id=?, message=?, finished_at=? WHERE id=? AND status='running'",
            (status, order_id, message, core.iso(), job_id),
        )
        if order_id:
            stats.record_order(job["account_id"], order_sn=f"grab-{order_id}",
                               promotion_order_id=order_id, status="pending")
        stats.record_job(job["account_id"], "grab", status, message)
    finally:
        with _LOCK:
            _TIMERS.pop(job_id, None)
        core.close_db()


def schedule(account_id: int, promotion_id: str, *, at_ts: float | None = None,
             advance: bool = False, lat=None, lon=None, city_code=None,
             store_platform: int = 1, early_ms: int = 0, redpack_id: int = 0,
             redpack_mode: int = 0) -> dict:
    ensure_tables()
    target = float(at_ts) if at_ts is not None else _now()
    if not math.isfinite(target) or not 0 <= int(early_ms) <= 60000 or int(redpack_id) < 0 or int(redpack_mode) not in (0, 1, 2):
        raise ValueError("预约参数无效")
    if at_ts is not None and target - int(early_ms) / 1000 <= _now():
        raise ValueError("预约时间已过，请刷新后重试")
    actions._geo(lat, lon, city_code)
    job_id = uuid.uuid4().hex[:12]
    now = core.iso()
    conn = core.get_db()
    conn.execute("BEGIN IMMEDIATE")
    try:
        if int(redpack_mode) == 1 and int(redpack_id) <= 0:
            raise ValueError("请选择红包")
        active = conn.execute("SELECT COUNT(*) FROM xc_grab_jobs WHERE status IN ('scheduled', 'running')").fetchone()[0]
        account_active = conn.execute("SELECT COUNT(*) FROM xc_grab_jobs WHERE account_id=? AND status IN ('scheduled', 'running')", (account_id,)).fetchone()[0]
        if active >= MAX_JOBS or account_active >= 20:
            raise ValueError("预约任务过多，请先停止或等待已有任务")
        conn.execute("""INSERT INTO xc_grab_jobs
            (id, account_id, promotion_id, at_ts, at, advance, lat, lon, city_code,
             store_platform, status, created_at, early_ms, redpack_id, redpack_mode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)""",
            (job_id, int(account_id), str(promotion_id), target, _iso_from_ts(target),
             int(advance), lat, lon, city_code, int(store_platform), now, int(early_ms), int(redpack_id), int(redpack_mode)))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    result = _row(job_id)
    _spawn(job_id)
    return result or {}


def recover() -> None:
    ensure_tables()
    now = _now()
    conn = core.get_db()
    conn.execute("UPDATE xc_grab_jobs SET status='unknown', message=?, finished_at=? WHERE status='running'",
                 ("服务中断，请先检查平台订单", core.iso()))
    conn.execute("UPDATE xc_grab_jobs SET status='missed', message=?, finished_at=? WHERE status='scheduled' AND at_ts - early_ms / 1000.0 <= ?",
                 ("服务停止期间错过预约时间", core.iso(), now))
    for row in core.query("SELECT id FROM xc_grab_jobs WHERE status='scheduled'"):
        _spawn(row["id"])


def get_job(job_id: str) -> dict | None:
    ensure_tables()
    return _row(job_id)


def cancel(job_id: str) -> bool:
    ensure_tables()
    cur = core.get_db().execute("UPDATE xc_grab_jobs SET status='cancelled', finished_at=? WHERE id=? AND status='scheduled'", (core.iso(), job_id))
    if cur.rowcount != 1:
        return False
    with _LOCK:
        timer = _TIMERS.get(job_id)
        if timer:
            timer[1].set()
    return True


def delete(job_id: str) -> bool:
    ensure_tables()
    return core.get_db().execute("DELETE FROM xc_grab_jobs WHERE id=? AND status NOT IN ('scheduled', 'running')", (job_id,)).rowcount == 1


def list_jobs(limit: int = 50, account_ids: list[int] | None = None) -> list[dict]:
    ensure_tables()
    limit = max(1, min(int(limit), MAX_JOBS))
    if account_ids is not None:
        if not account_ids:
            return []
        placeholders = ','.join('?' for _ in account_ids)
        rows = core.query(f"SELECT * FROM xc_grab_jobs WHERE account_id IN ({placeholders}) ORDER BY created_at DESC LIMIT ?", (*account_ids, limit))
    else:
        rows = core.query("SELECT * FROM xc_grab_jobs ORDER BY created_at DESC LIMIT ?", (limit,))
    return [dict(row) for row in rows]


def reset_for_tests() -> None:
    with _LOCK:
        timers = list(_TIMERS.values())
        for _, event in timers:
            event.set()
    for thread, _ in timers:
        thread.join(timeout=2)
