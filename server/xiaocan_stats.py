"""小蚕助手看板数据：订单返现统计、7 日趋势、运行日志。

口径对齐开源版：
- 累计到账返现 = 已完成订单的返现之和
- 在途/待入账 = pending + auditing 的返现之和
- 今日已省外卖费 = 今天创建的订单（未被拒绝/取消）返现之和
- 今日单量拆成已完成 / 在途两段

数据表是本项目自己的（`xc_orders` / `xc_job_logs`），不与开源版共用文件。
"""
from __future__ import annotations

import datetime
from typing import Any

import core

SETTLED = "completed"
PENDING_STATUSES = ("pending", "auditing")
DEAD_STATUSES = ("rejected", "cancelled")

PLATFORM_ALIAS = {"jd": "jingdong", "taobao": "eleme"}


def ensure_tables() -> None:
    db = core.get_db()
    db.execute("""
    CREATE TABLE IF NOT EXISTS xc_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      order_sn TEXT UNIQUE,
      store_name TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT 'meituan',
      order_money REAL NOT NULL DEFAULT 0,
      rebate_money REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      promotion_order_id INTEGER NOT NULL DEFAULT 0,
      created_time TEXT NOT NULL,
      settled_time TEXT
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_xc_orders_account ON xc_orders(account_id, id DESC)")
    db.execute("""
    CREATE TABLE IF NOT EXISTS xc_job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      created_time TEXT NOT NULL
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_xc_job_logs ON xc_job_logs(id DESC)")


def _scope(account_ids: list[int] | None) -> tuple[str, tuple]:
    """拼 WHERE：None = 全部账号；空列表 = 没有账号，直接查不到东西。"""
    if account_ids is None:
        return "1=1", ()
    if not account_ids:
        return "1=0", ()
    marks = ",".join("?" * len(account_ids))
    return f"account_id IN ({marks})", tuple(account_ids)


def record_job(account_id: int | None, kind: str, status: str, message: str = "") -> None:
    """写一条运行日志（抢单/日常/查询失败都记）。"""
    ensure_tables()
    core.insert("xc_job_logs", {
        "account_id": account_id,
        "kind": kind,
        "status": status,
        "message": message[:500],
        "created_time": core.iso(),
    })


def list_jobs(account_ids: list[int] | None = None, limit: int = 50) -> list[dict]:
    ensure_tables()
    where, args = _scope(account_ids)
    rows = core.query(
        f"SELECT * FROM xc_job_logs WHERE {where} ORDER BY id DESC LIMIT ?",
        (*args, max(1, min(200, limit))),
    )
    return [dict(r) for r in rows]


def clear_jobs(account_ids: list[int] | None = None) -> int:
    ensure_tables()
    where, args = _scope(account_ids)
    row = core.query_one(f"SELECT COUNT(*) AS n FROM xc_job_logs WHERE {where}", args)
    core.execute(f"DELETE FROM xc_job_logs WHERE {where}", args)
    return int(row["n"] if row else 0)


def record_order(
    account_id: int | None,
    *,
    order_sn: str,
    store_name: str = "",
    platform: str = "meituan",
    order_money: float = 0.0,
    rebate_money: float = 0.0,
    status: str = "pending",
    promotion_order_id: int = 0,
) -> None:
    """抢单成功后落一条在途订单；同 order_sn 重复即忽略。"""
    ensure_tables()
    db = core.get_db()
    db.execute(
        "INSERT OR IGNORE INTO xc_orders (account_id,order_sn,store_name,platform,order_money,"
        "rebate_money,status,promotion_order_id,created_time) VALUES (?,?,?,?,?,?,?,?,?)",
        (account_id, str(order_sn), store_name, PLATFORM_ALIAS.get(platform, platform),
         float(order_money or 0), float(rebate_money or 0), status, int(promotion_order_id or 0), core.iso()),
    )


def _rows(account_ids: list[int] | None) -> list[dict]:
    ensure_tables()
    where, args = _scope(account_ids)
    return [dict(r) for r in core.query(f"SELECT * FROM xc_orders WHERE {where}", args)]


def stats(account_ids: list[int] | None = None) -> dict[str, Any]:
    rows = _rows(account_ids)
    live = [r for r in rows if r["status"] not in DEAD_STATUSES]
    completed = [r for r in rows if r["status"] == SETTLED]
    pending = [r for r in rows if r["status"] in PENDING_STATUSES]

    today = core.today_str()
    todays = [r for r in live if str(r["created_time"])[:10] == today]
    today_completed = [r for r in todays if r["status"] == SETTLED]
    today_pending = [r for r in todays if r["status"] in PENDING_STATUSES]

    def total(items, key="rebate_money") -> float:
        return round(sum(float(r[key] or 0) for r in items), 2)

    return {
        "total_orders": len(live),
        "completed_orders": len(completed),
        "pending_orders": len(pending),
        # 开源版口径：累计到账 = 已完成订单返现
        "total_rebate": total(completed),
        "pending_rebate": total(pending),
        "total_spent": total(completed, "order_money"),
        "today_saved": total(todays),
        "today_orders": len(todays),
        "today_completed_orders": len(today_completed),
        "today_completed_rebate": total(today_completed),
        "today_pending_orders": len(today_pending),
        "today_pending_rebate": total(today_pending),
    }


def chart_data(account_ids: list[int] | None = None) -> dict[str, Any]:
    """近 7 天返现趋势 + 状态/平台分布 + 今日汇总。"""
    rows = _rows(account_ids)
    today = datetime.date.today()

    days: dict[str, dict] = {}
    for offset in range(6, -1, -1):
        day = today - datetime.timedelta(days=offset)
        days[day.strftime("%Y-%m-%d")] = {
            "date": day.strftime("%m-%d"),
            "rebate": 0.0,
            "orders": 0,
            "spent": 0.0,
        }

    status_counts = {"completed": 0, "auditing": 0, "pending": 0, "rejected": 0, "cancelled": 0}
    platform_counts = {"meituan": 0, "eleme": 0, "jingdong": 0}

    for row in rows:
        status = row["status"] if row["status"] in status_counts else "pending"
        platform = PLATFORM_ALIAS.get(row["platform"], row["platform"])
        if platform not in platform_counts:
            platform = "meituan"
        status_counts[status] += 1
        platform_counts[platform] += 1

        day_key = str(row["created_time"])[:10]
        bucket = days.get(day_key)
        if bucket and status not in DEAD_STATUSES:
            bucket["rebate"] += float(row["rebate_money"] or 0)
            bucket["spent"] += float(row["order_money"] or 0)
            bucket["orders"] += 1

    for bucket in days.values():
        bucket["rebate"] = round(bucket["rebate"], 2)
        bucket["spent"] = round(bucket["spent"], 2)

    summary = stats(account_ids)
    return {
        "trend": list(days.values()),
        "status_counts": status_counts,
        "platform_counts": platform_counts,
        "today_summary": {
            "today_saved": summary["today_saved"],
            "today_orders": summary["today_orders"],
            "today_pending_orders": summary["today_pending_orders"],
            "today_completed_orders": summary["today_completed_orders"],
            "today_completed_rebate": summary["today_completed_rebate"],
        },
    }
