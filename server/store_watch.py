"""店铺监控：关键词新店、指定店名、名额捡漏、同店多方案扫描。

设计取舍（与开源版对齐但更保守）：
- 监控只做「发现 + 通知 + 记录」，**不自动抢单**；要抢就由人点或另建抢单任务，
  避免监控线程在无人值守时把额度打空；
- 已通知过的条目写进 `xc_watch_seen`，同一个活动不会重复打扰；
- 每类监控复用 `xiaocan_actions` 的店铺检索，不重复实现协议。
"""
from __future__ import annotations

import json
import threading
import time
from typing import Any

import core
import notify
import xiaocan_actions as actions
import xiaocan_stats as stats

KINDS = ("keyword", "name", "stock", "dual")
DEFAULT_INTERVAL = 300       # 秒
MIN_INTERVAL = 60
SCAN_PAGES = 2               # 每次扫两页（每页 20 条）
_loop_started = False
_lock = threading.Lock()


def ensure_tables() -> None:
    stats.ensure_tables()
    db = core.get_db()
    db.execute("""
    CREATE TABLE IF NOT EXISTS xc_store_watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      interval_sec INTEGER NOT NULL DEFAULT 300,
      status TEXT NOT NULL DEFAULT 'active',
      hits INTEGER NOT NULL DEFAULT 0,
      last_run REAL NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT '',
      created_time TEXT NOT NULL
    )""")
    db.execute("""
    CREATE TABLE IF NOT EXISTS xc_watch_seen (
      watch_id INTEGER NOT NULL,
      item_key TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      PRIMARY KEY (watch_id, item_key)
    )""")


def _params(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        value = json.loads(raw or "{}")
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


def create_watch(account_id: int, kind: str, params: dict, interval_sec: int = DEFAULT_INTERVAL) -> dict:
    ensure_tables()
    if kind not in KINDS:
        raise ValueError(f"kind 只能是 {', '.join(KINDS)}")
    if kind in ("keyword", "name") and not str(params.get("keyword") or "").strip():
        raise ValueError("关键词监控必须填关键词")
    if kind == "stock" and not str(params.get("promotion_id") or "").strip():
        raise ValueError("名额监控必须填活动 ID")
    interval = max(MIN_INTERVAL, int(interval_sec or DEFAULT_INTERVAL))
    db = core.get_db()
    db.execute(
        "INSERT INTO xc_store_watches (account_id,kind,params,interval_sec,created_time) VALUES (?,?,?,?,?)",
        (account_id, kind, json.dumps(params, ensure_ascii=False), interval, core.iso()),
    )
    return dict(core.query_one("SELECT * FROM xc_store_watches ORDER BY id DESC LIMIT 1"))


def list_watches(account_ids: list[int] | None = None) -> list[dict]:
    ensure_tables()
    out = []
    for row in core.query("SELECT * FROM xc_store_watches ORDER BY id DESC"):
        item = dict(row)
        item["params"] = _params(item["params"])
        if account_ids is None or item["account_id"] in account_ids:
            out.append(item)
    return out


def delete_watch(watch_id: int, account_ids: list[int] | None = None) -> bool:
    ensure_tables()
    row = core.query_one("SELECT * FROM xc_store_watches WHERE id=?", (watch_id,))
    if not row or (account_ids is not None and row["account_id"] not in account_ids):
        return False
    core.execute("DELETE FROM xc_store_watches WHERE id=?", (watch_id,))
    core.execute("DELETE FROM xc_watch_seen WHERE watch_id=?", (watch_id,))
    return True


def set_status(watch_id: int, status: str) -> bool:
    if status not in ("active", "paused"):
        raise ValueError("status 只能是 active / paused")
    core.execute("UPDATE xc_store_watches SET status=? WHERE id=?", (status, watch_id))
    return True


# ---------------------------------------------------------------- 探测

def _store_name(item: dict) -> str:
    for key in ("meituan_shop_url", "shop_name", "store_name", "poi_name", "name", "title"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _promo_id(item: dict) -> str:
    for key in ("promotion_id", "id", "promotionId"):
        value = item.get(key)
        if isinstance(value, (int, str)) and str(value).strip():
            return str(value).strip()
    return ""


def _collect(account: dict, params: dict) -> list[dict]:
    """翻页取候选条目（只读）。"""
    items: list[dict] = []
    base = {
        "lat": params.get("lat"), "lon": params.get("lon"),
        "city_code": params.get("city_code"),
    }
    keyword = str(params.get("keyword") or "").strip()
    last_error: Exception | None = None
    for page in range(SCAN_PAGES):
        offset = page * 20
        try:
            if keyword:
                res = actions.search_stores(account, keyword, offset=offset, limit=20, **base)
            else:
                res = actions.feed_stores(account, offset=offset, limit=20, **base)
        except Exception as exc:
            last_error = exc
            break
        page_items = res.get("items") or []
        items.extend(page_items)
        if len(page_items) < 20:
            break
    # 一条都没拿到还把错误吞掉，监控会永远显示「0 条」而不报原因
    if not items and last_error is not None:
        raise last_error
    return items


def probe(account: dict, kind: str, params: dict) -> list[dict]:
    """按监控类型筛出需要的条目，统一成 {key,title,detail}。"""
    keyword = str(params.get("keyword") or "").strip()
    items = _collect(account, params)
    output: list[dict] = []

    if kind in ("keyword", "name"):
        for item in items:
            name = _store_name(item)
            if not name:
                continue
            if keyword and keyword not in name:
                continue
            output.append({"key": f"{name}|{_promo_id(item)}", "title": name,
                           "detail": f"返 {item.get('order_money', 0)} · 剩余 {item.get('left_number', '-')}"})
    elif kind == "stock":
        target = str(params.get("promotion_id") or "").strip()
        for item in items:
            if _promo_id(item) != target:
                continue
            left = item.get("left_number")
            if isinstance(left, int) and left > 0:
                output.append({"key": f"{target}|{left}", "title": _store_name(item) or target,
                               "detail": f"名额剩余 {left}"})
    else:  # dual：同店多方案
        grouped: dict[str, list[dict]] = {}
        for item in items:
            name = _store_name(item)
            if name:
                grouped.setdefault(name, []).append(item)
        for name, group in grouped.items():
            if len(group) < 2:
                continue
            output.append({"key": name, "title": name, "detail": f"同店 {len(group)} 个方案"})
    return output


def run_once(watch: dict) -> dict:
    """跑一次监控：写新命中、发通知、更新状态。"""
    ensure_tables()
    account = core.query_one("SELECT * FROM accounts WHERE id=?", (watch["account_id"],))
    if not account:
        core.execute("UPDATE xc_store_watches SET last_run=?, last_error=? WHERE id=?",
                     (time.time(), "账号不存在", watch["id"]))
        return {"new": [], "error": "账号不存在"}
    try:
        found = probe(dict(account), watch["kind"], _params(watch["params"]))
    except Exception as exc:
        core.execute("UPDATE xc_store_watches SET last_run=?, last_error=? WHERE id=?",
                     (time.time(), str(exc)[:200], watch["id"]))
        return {"new": [], "error": str(exc)[:200]}

    fresh = []
    for item in found:
        inserted = core.get_db().execute(
            "INSERT OR IGNORE INTO xc_watch_seen (watch_id,item_key,first_seen) VALUES (?,?,?)",
            (watch["id"], item["key"], core.iso()),
        ).rowcount
        if inserted:
            fresh.append(item)

    core.execute("UPDATE xc_store_watches SET last_run=?, last_error=?, hits=hits+? WHERE id=?",
                 (time.time(), "", len(fresh), watch["id"]))
    if fresh:
        titles = "；".join(f"{i['title']}（{i['detail']}）" for i in fresh[:5])
        notify.notify_async("店铺监控命中", f"监控 #{watch['id']}（{watch['kind']}）发现 {len(fresh)} 条：{titles}")
        stats.record_job(watch["account_id"], "store_watch", "success", f"新增 {len(fresh)} 条")
    return {"new": fresh, "scanned": len(found)}


def _loop() -> None:
    while True:
        try:
            ensure_tables()
            now = time.time()
            for watch in list_watches(None):
                if watch["status"] != "active":
                    continue
                if now - float(watch["last_run"] or 0) < int(watch["interval_sec"] or DEFAULT_INTERVAL):
                    continue
                with _lock:
                    run_once(watch)
        except Exception:
            pass
        time.sleep(30)


def start_daemon() -> None:
    global _loop_started
    if _loop_started:
        return
    _loop_started = True
    threading.Thread(target=_loop, name="store-watch", daemon=True).start()
