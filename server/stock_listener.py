"""Persistent, explicitly enabled stock listeners."""
from __future__ import annotations

import threading
import time
import uuid

import core
import xiaocan_actions as actions
import xiaocan_stats as stats

_LOCK = threading.Lock()
_THREADS: dict[str, tuple[threading.Thread, threading.Event]] = {}


def ensure_tables() -> None:
    core.get_db().execute("""CREATE TABLE IF NOT EXISTS xc_stock_listeners (
        id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, promotion_id TEXT NOT NULL,
        lat TEXT NOT NULL, lon TEXT NOT NULL, city_code TEXT, store_platform INTEGER NOT NULL,
        interval_sec INTEGER NOT NULL, until_ts REAL NOT NULL, advance INTEGER NOT NULL DEFAULT 0,
        redpack_id INTEGER NOT NULL DEFAULT 0, redpack_mode INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL, order_id INTEGER NOT NULL DEFAULT 0,
        message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, finished_at TEXT
    )""")
    columns = {row["name"] for row in core.query("PRAGMA table_info(xc_stock_listeners)")}
    if "redpack_mode" not in columns:
        core.get_db().execute("ALTER TABLE xc_stock_listeners ADD COLUMN redpack_mode INTEGER NOT NULL DEFAULT 0")


def get_job(job_id: str) -> dict | None:
    ensure_tables()
    row = core.query_one("SELECT * FROM xc_stock_listeners WHERE id=?", (job_id,))
    return dict(row) if row else None


def _spawn(job_id: str) -> None:
    with _LOCK:
        if job_id in _THREADS:
            return
        event = threading.Event()
        thread = threading.Thread(target=_run, args=(job_id, event), daemon=True, name=job_id)
        _THREADS[job_id] = (thread, event)
        thread.start()


def _run(job_id: str, event: threading.Event) -> None:
    try:
        while not event.is_set():
            job = get_job(job_id)
            if not job or job["status"] != "monitoring":
                return
            if time.time() >= job["until_ts"]:
                core.execute("UPDATE xc_stock_listeners SET status='expired', finished_at=? WHERE id=? AND status='monitoring'", (core.iso(), job_id))
                return
            account = core.query_one("SELECT * FROM accounts WHERE id=?", (job["account_id"],))
            if not account:
                core.execute("UPDATE xc_stock_listeners SET status='failed', message=?, finished_at=? WHERE id=? AND status='monitoring'", ("账号不存在", core.iso(), job_id))
                return
            try:
                left = actions.promotion_stock(dict(account), job["promotion_id"], store_platform=job["store_platform"], city_code=job["city_code"])
            except Exception as exc:
                core.execute("UPDATE xc_stock_listeners SET message=? WHERE id=? AND status='monitoring'", (str(exc)[:300], job_id))
                event.wait(job["interval_sec"])
                continue
            if left <= 0:
                core.execute("UPDATE xc_stock_listeners SET message='' WHERE id=? AND status='monitoring'", (job_id,))
                event.wait(job["interval_sec"])
                continue
            claimed = core.get_db().execute("UPDATE xc_stock_listeners SET status='running', message='' WHERE id=? AND status='monitoring' AND until_ts>?", (job_id, time.time()))
            if claimed.rowcount != 1:
                core.execute("UPDATE xc_stock_listeners SET status='expired', finished_at=? WHERE id=? AND status='monitoring' AND until_ts<=?", (core.iso(), job_id, time.time()))
                return
            try:
                redpack_id = int(job["redpack_id"] or 0)
                if int(job["redpack_mode"]) == 0:
                    try:
                        redpack_id = actions.best_redpack_id(dict(account)) or 0
                    except Exception:
                        redpack_id = 0
                elif int(job["redpack_mode"]) == 2:
                    redpack_id = 0
                result = actions.grab_promotion_quota(
                    dict(account), job["promotion_id"], store_platform=job["store_platform"],
                    advance=bool(job["advance"]), lat=job["lat"], lon=job["lon"],
                    city_code=job["city_code"], redpack_id=redpack_id,
                )
                order_id = int(result.get("order_id") or 0)
                status = "success" if order_id else "failed"
                message = "" if order_id else (result.get("msg") or "未返回订单号")
            except Exception as exc:
                order_id, status, message = 0, "unknown", f"请求结果未确认，请检查平台订单：{exc}"
            core.execute("UPDATE xc_stock_listeners SET status=?, order_id=?, message=?, finished_at=? WHERE id=? AND status='running'", (status, order_id, message, core.iso(), job_id))
            if order_id:
                stats.record_order(job["account_id"], order_sn=f"grab-{order_id}", promotion_order_id=order_id, status="pending")
            stats.record_job(job["account_id"], "stock_monitor", status, message)
            return
    finally:
        with _LOCK:
            _THREADS.pop(job_id, None)
        core.close_db()


def create(account_id: int, promotion_id: str, *, lat, lon, city_code, store_platform=1,
           interval_sec=5, timeout_sec=3600, advance=False, redpack_id=0,
           redpack_mode=0) -> dict:
    ensure_tables()
    _, pid = actions._clean_promo_id(promotion_id)
    if pid <= 0 or pid >= actions.SHANGJIN_ID_FLOOR:
        raise ValueError("当前活动类型暂不支持名额监听")
    flat, flon, city = actions._geo(lat, lon, city_code)
    interval, timeout = int(interval_sec), int(timeout_sec)
    if not 3 <= interval <= 60 or not 60 <= timeout <= 86400 or int(redpack_id) < 0 or int(redpack_mode) not in (0, 1, 2) or int(store_platform) not in (1, 2, 3):
        raise ValueError("监听参数无效")
    job_id = f"stock-{uuid.uuid4().hex[:12]}"
    conn = core.get_db()
    conn.execute("BEGIN IMMEDIATE")
    try:
        if int(redpack_mode) == 1 and int(redpack_id) <= 0:
            raise ValueError("请选择红包")
        total = conn.execute("SELECT COUNT(*) FROM xc_stock_listeners WHERE status IN ('monitoring','running')").fetchone()[0]
        own = conn.execute("SELECT COUNT(*) FROM xc_stock_listeners WHERE account_id=? AND status IN ('monitoring','running')", (account_id,)).fetchone()[0]
        duplicate = conn.execute("SELECT 1 FROM xc_stock_listeners WHERE account_id=? AND promotion_id=? AND store_platform=? AND status IN ('monitoring','running')", (account_id, str(promotion_id), int(store_platform))).fetchone()
        if duplicate:
            raise ValueError("该活动已有正在进行的名额监听")
        if total >= 200 or own >= 20:
            raise ValueError("监听任务过多，请先停止或等待已有任务")
        conn.execute("""INSERT INTO xc_stock_listeners
            (id,account_id,promotion_id,lat,lon,city_code,store_platform,interval_sec,until_ts,advance,redpack_id,redpack_mode,status,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'monitoring',?)""", (job_id, account_id, str(promotion_id), str(flat), str(flon), str(city), int(store_platform), interval, time.time() + timeout, int(advance), int(redpack_id), int(redpack_mode), core.iso()))
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    job = get_job(job_id)
    _spawn(job_id)
    return job or {}


def cancel(job_id: str) -> bool:
    ensure_tables()
    result = core.get_db().execute("UPDATE xc_stock_listeners SET status='cancelled', finished_at=? WHERE id=? AND status='monitoring'", (core.iso(), job_id))
    if result.rowcount != 1:
        return False
    with _LOCK:
        worker = _THREADS.get(job_id)
        if worker:
            worker[1].set()
    return True


def delete(job_id: str) -> bool:
    ensure_tables()
    return core.get_db().execute("DELETE FROM xc_stock_listeners WHERE id=? AND status NOT IN ('monitoring','running')", (job_id,)).rowcount == 1


def list_jobs(account_ids: list[int] | None = None, limit: int = 50) -> list[dict]:
    ensure_tables()
    limit = max(1, min(int(limit), 200))
    if account_ids is None:
        rows = core.query("SELECT * FROM xc_stock_listeners ORDER BY created_at DESC LIMIT ?", (limit,))
    elif not account_ids:
        return []
    else:
        placeholders = ','.join('?' for _ in account_ids)
        rows = core.query(f"SELECT * FROM xc_stock_listeners WHERE account_id IN ({placeholders}) ORDER BY created_at DESC LIMIT ?", (*account_ids, limit))
    return [dict(row) for row in rows]


def recover() -> None:
    ensure_tables()
    now = time.time()
    core.execute("UPDATE xc_stock_listeners SET status='unknown', message=?, finished_at=? WHERE status='running'", ("服务中断，请先检查平台订单", core.iso()))
    core.execute("UPDATE xc_stock_listeners SET status='expired', finished_at=? WHERE status='monitoring' AND until_ts<=?", (core.iso(), now))
    for row in core.query("SELECT id FROM xc_stock_listeners WHERE status='monitoring'"):
        _spawn(row["id"])


def reset_for_tests() -> None:
    with _LOCK:
        workers = list(_THREADS.values())
        for _, event in workers:
            event.set()
    for thread, _ in workers:
        thread.join(timeout=3)
