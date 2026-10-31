"""霸王餐订单：手工录入、提交外卖单号、延时券、免单卡核销。

与 `xiaocan_stats` 的分工：
- stats 只负责读（看板统计/趋势），不写；
- 本模块负责写入与三个官方动作，动作全部走 `xiaocan_methods.call`，失败不静默。
"""
from __future__ import annotations

import re
from typing import Any

import core
import xiaocan_methods as methods
import xiaocan_stats as stats

# 允许手工设置的字段（其余字段只由系统维护）
EDITABLE = ("store_name", "platform", "order_money", "rebate_money", "status",
            "order_sn", "platform_order_id", "order_type", "rebate_ratio", "note")

STATUSES = ("pending", "auditing", "completed", "rejected", "cancelled")


def ensure_tables() -> None:
    stats.ensure_tables()
    db = core.get_db()
    existing = {row["name"] for row in db.execute("PRAGMA table_info(xc_orders)")}
    for column, ddl in (
        ("platform_order_id", "TEXT NOT NULL DEFAULT ''"),
        ("order_type", "INTEGER NOT NULL DEFAULT 0"),
        ("rebate_ratio", "REAL NOT NULL DEFAULT 0"),
        ("note", "TEXT NOT NULL DEFAULT ''"),
        ("updated_time", "TEXT"),
    ):
        if column not in existing:
            db.execute(f"ALTER TABLE xc_orders ADD COLUMN {column} {ddl}")


def _scope(account_ids: list[int] | None) -> tuple[str, tuple]:
    if account_ids is None:
        return "1=1", ()
    if not account_ids:
        return "1=0", ()
    marks = ",".join("?" * len(account_ids))
    return f"account_id IN ({marks})", tuple(account_ids)


def list_orders(account_ids: list[int] | None = None, *, status: str = "",
                limit: int = 100) -> list[dict]:
    ensure_tables()
    where, args = _scope(account_ids)
    sql = f"SELECT * FROM xc_orders WHERE {where}"
    if status in STATUSES:
        sql += " AND status=?"
        args += (status,)
    sql += " ORDER BY id DESC LIMIT ?"
    rows = core.query(sql, (*args, max(1, min(500, limit))))
    return [dict(r) for r in rows]


def get_order(order_id: int, account_ids: list[int] | None = None) -> dict | None:
    ensure_tables()
    row = core.query_one("SELECT * FROM xc_orders WHERE id=?", (order_id,))
    if not row:
        return None
    item = dict(row)
    if account_ids is not None and item["account_id"] not in account_ids:
        return None
    return item


def _clean(payload: dict[str, Any]) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for key in EDITABLE:
        if key not in payload:
            continue
        value = payload[key]
        if key in ("order_money", "rebate_money", "rebate_ratio"):
            try:
                data[key] = float(value or 0)
            except (TypeError, ValueError):
                raise ValueError(f"{key} 必须是数字") from None
        elif key == "order_type":
            try:
                data[key] = int(value or 0)
            except (TypeError, ValueError):
                raise ValueError("order_type 必须是整数") from None
        else:
            data[key] = str(value or "").strip()[:200]
    if "status" in data and data["status"] not in STATUSES:
        raise ValueError(f"status 只能是 {', '.join(STATUSES)}")
    if "platform" in data:
        data["platform"] = stats.PLATFORM_ALIAS.get(data["platform"], data["platform"] or "meituan")
    return data


def create_order(account_id: int | None, payload: dict[str, Any]) -> dict:
    ensure_tables()
    data = _clean(payload)
    if not data.get("store_name"):
        raise ValueError("请填写店铺名")
    if data.get("platform") not in ("meituan", "eleme", "jingdong"):
        raise ValueError("platform 只能是 meituan / eleme / jingdong")
    order_sn = data.get("order_sn") or f"manual-{core.now_dt().strftime('%Y%m%d%H%M%S%f')}"
    db = core.get_db()
    db.execute(
        "INSERT OR IGNORE INTO xc_orders (account_id,order_sn,store_name,platform,order_money,"
        "rebate_money,status,platform_order_id,order_type,rebate_ratio,note,created_time,updated_time) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (account_id, order_sn, data.get("store_name", ""), data.get("platform", "meituan"),
         data.get("order_money", 0), data.get("rebate_money", 0), data.get("status", "pending"),
         data.get("platform_order_id", ""), data.get("order_type", 0), data.get("rebate_ratio", 0),
         data.get("note", ""), core.iso(), core.iso()),
    )
    row = core.query_one("SELECT * FROM xc_orders WHERE order_sn=?", (order_sn,))
    return dict(row) if row else {}


def update_order(order_id: int, payload: dict[str, Any], account_ids: list[int] | None = None) -> dict:
    order = get_order(order_id, account_ids)
    if not order:
        raise ValueError("订单不存在")
    data = _clean(payload)
    if not data:
        return order
    data["updated_time"] = core.iso()
    sets = ",".join(f"{key}=?" for key in data)
    core.execute(f"UPDATE xc_orders SET {sets} WHERE id=?", (*data.values(), order_id))
    return get_order(order_id, account_ids) or {}


def delete_order(order_id: int, account_ids: list[int] | None = None) -> bool:
    if not get_order(order_id, account_ids):
        return False
    core.execute("DELETE FROM xc_orders WHERE id=?", (order_id,))
    return True


# ---------------------------------------------------------------- 官方动作

def _promotion_order_id(order: dict) -> int:
    """优先用记录里的官方订单号；没有就从 order_sn 尾部 8~10 位数字里捞。"""
    pid = int(order.get("promotion_order_id") or 0)
    if pid:
        return pid
    match = re.search(r"(\d{8,10})$", str(order.get("order_sn") or ""))
    return int(match.group(1)) if match else 0


def _account(order: dict, account_ids: list[int] | None = None) -> dict:
    if order.get("account_id") is None:
        raise ValueError("该订单没有关联小蚕账号，无法调用官方接口")
    account = core.query_one("SELECT * FROM accounts WHERE id=?", (order["account_id"],))
    if not account:
        raise ValueError("订单关联的小蚕账号不存在")
    if account_ids is not None and account["id"] not in account_ids:
        raise ValueError("无权操作该账号")
    return dict(account)


def submit_platform_order_id(order_id: int, platform_order_id: str,
                             account_ids: list[int] | None = None) -> dict:
    """把外卖平台单号提交到小蚕审核接口。"""
    order = get_order(order_id, account_ids)
    if not order:
        raise ValueError("订单不存在")
    platform_order_id = str(platform_order_id or "").strip()
    if not platform_order_id:
        raise ValueError("外卖平台订单号不能为空")
    if order.get("platform_order_id") and order["platform_order_id"] != platform_order_id:
        raise ValueError("该订单已绑定其它外卖单号，平台禁止二次修改")
    promo_id = _promotion_order_id(order)
    if not promo_id:
        raise ValueError("订单缺少官方活动订单号，无法提交")

    account = _account(order, account_ids)
    upstream = methods.call(account, "submit_platform_order_id", {
        "promotion_order_id": promo_id,
        "platform_order_id": platform_order_id,
        "order_type": 0,
    })
    update_order(order_id, {"platform_order_id": platform_order_id, "status": "auditing"}, account_ids)
    return {"upstream": upstream, "order": get_order(order_id, account_ids)}


def delay_voucher(order_id: int, account_ids: list[int] | None = None) -> dict:
    """领红包延时 2 小时（按平台映射 task_type：美团 4 / 饿了么 3）。"""
    order = get_order(order_id, account_ids)
    if not order:
        raise ValueError("订单不存在")
    if float(order.get("rebate_ratio") or 0) > 0 or int(order.get("order_type") or 0) == 12:
        raise ValueError("百分比按比例返现订单不支持延时特权")
    promo_id = _promotion_order_id(order)
    if not promo_id:
        raise ValueError("订单缺少官方活动订单号，无法申请延时")
    account = _account(order, account_ids)
    task_type = 3 if "ele" in str(order.get("platform") or "") else 4
    upstream = methods.call(account, "complete_task_event",
                            {"task_type": task_type, "promotion_order_id": promo_id})
    return {"upstream": upstream, "task_type": task_type}


def use_free_card(order_id: int, account_ids: list[int] | None = None) -> dict:
    """核销免单卡：先查可用卡，再用外卖单号核销。"""
    order = get_order(order_id, account_ids)
    if not order:
        raise ValueError("订单不存在")
    platform_order_id = str(order.get("platform_order_id") or "").strip()
    if not platform_order_id:
        raise ValueError("请先提交外卖平台订单号，再使用免单卡")
    account = _account(order, account_ids)

    info = methods.call(account, "get_user_free_order_info", {})
    data = info.get("info") or info
    card_id = int(data.get("user_free_card_id") or data.get("card_id") or 0)
    if not card_id:
        raise ValueError("当前账号没有可用的免单卡")
    business = 2 if "ele" in str(order.get("platform") or "") else 1
    upstream = methods.call(account, "use_free_order_card", {
        "order_no": platform_order_id,
        "order_business": business,
        "user_free_card_id": card_id,
    })
    return {"upstream": upstream, "user_free_card_id": card_id}
