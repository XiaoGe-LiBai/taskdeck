"""霸王餐订单：手工录入、提交外卖单号、延时券、免单卡核销。

与 `xiaocan_stats` 的分工：
- stats 只负责读（看板统计/趋势），不写；
- 本模块负责写入与三个官方动作，动作全部走 `xiaocan_methods.call`，失败不静默。
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

import core
import notify
import xiaocan_methods as methods
import xiaocan_stats as stats

# 允许手工设置的字段（其余字段只由系统维护）
EDITABLE = ("store_name", "platform", "order_money", "rebate_money", "status",
            "order_sn", "platform_order_id", "order_type", "rebate_ratio", "note")

STATUSES = ("pending", "auditing", "completed", "rejected", "cancelled")
# 钱到账、被拒、取消，都算这一单结束，进入这三态时补结算时间
FINISHED_STATUSES = ("completed", "rejected", "cancelled")
STATUS_LABEL_CN = {
    "pending": "待提交",
    "auditing": "审核中",
    "completed": "已到账",
    "rejected": "已拒绝",
    "cancelled": "已取消",
}


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
                account_id: int | None = None, platform: str = "",
                keyword: str = "", limit: int = 100) -> list[dict]:
    ensure_tables()
    where, args = _scope(account_ids)
    sql = f"SELECT * FROM xc_orders WHERE {where}"
    if account_id is not None:
        if account_ids is not None and account_id not in account_ids:
            return []
        sql += " AND account_id=?"
        args += (account_id,)
    if status in STATUSES:
        sql += " AND status=?"
        args += (status,)
    platform = stats.PLATFORM_ALIAS.get(platform, platform)
    if platform in ("meituan", "eleme", "jingdong"):
        sql += " AND platform=?"
        args += (platform,)
    keyword = str(keyword or "").strip()
    if keyword:
        sql += " AND (store_name LIKE ? OR order_sn LIKE ? OR platform_order_id LIKE ?)"
        like = f"%{keyword}%"
        args += (like, like, like)
    sql += " ORDER BY id DESC LIMIT ?"
    rows = core.query(sql, (*args, max(1, min(500, limit))))
    return [dict(r) for r in rows]


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _money(value: Any) -> float:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return round(amount / 100 if abs(amount) >= 100 else amount, 2)


def _platform(value: Any) -> str:
    return {2: "eleme", 3: "jingdong"}.get(_int(value), "meituan")


def _status(value: Any) -> str:
    return {0: "pending", 1: "auditing", 2: "completed",
            3: "rejected", 4: "cancelled"}.get(_int(value), "pending")


def _time_text(value: Any) -> str:
    timestamp = _int(value)
    if timestamp <= 0:
        return core.iso()
    return datetime.fromtimestamp(timestamp).astimezone().isoformat(timespec="seconds")


def _normalize_upstream_order(account_id: int, raw: dict) -> dict | None:
    promotion_id = _int(raw.get("promotion_order_id"))
    order_sn = str(raw.get("order_id_str") or promotion_id or "").strip()
    if not order_sn:
        return None
    promotion = raw.get("store_promotion") or {}
    store = promotion.get("store") or {}
    order_type = _int(raw.get("order_type"))
    ratio_raw = float(raw.get("ratio") or 0)
    ratio = round(ratio_raw / 100 if ratio_raw >= 100 else ratio_raw, 2)
    percent_order = order_type == 12 or ratio > 0 or bool(raw.get("if_mt_fan"))
    order_money = _money(raw.get("platform_order_total_price")) if percent_order else _money(raw.get("store_platform_order_money"))
    if order_money <= 0:
        order_money = _money(raw.get("platform_order_total_price"))
    rebate_money = _money(raw.get("user_rebate"))
    if percent_order and rebate_money <= 0:
        rebate_money = _money(raw.get("max_commission") or raw.get("store_platform_order_money"))
    status = _status(raw.get("order_status"))
    created = _time_text(raw.get("order_time"))
    return {
        "account_id": account_id,
        "order_sn": order_sn,
        "store_name": str(store.get("name") or promotion.get("store_name") or "小蚕霸王餐").strip(),
        "platform": _platform(raw.get("store_platform")),
        "order_money": order_money,
        "rebate_money": rebate_money,
        "status": status,
        "promotion_order_id": promotion_id,
        "platform_order_id": str(raw.get("platform_order_id") or "").strip(),
        "order_type": order_type,
        "rebate_ratio": ratio,
        "created_time": created,
        "settled_time": created if status == "completed" else None,
        "updated_time": core.iso(),
    }


def sync_account_orders(account: dict, *, limit: int = 200) -> int:
    """Pull real platform orders for one bound account and upsert by official order id."""
    ensure_tables()
    synced = 0
    page_size = 50
    maximum = max(1, min(int(limit or 200), 500))
    for offset in range(0, maximum, page_size):
        response = methods.call(account, "get_order_list", {
            "order_status": 99,
            "offset": offset,
            "number": min(page_size, maximum - offset),
        })
        raw_orders = response.get("order_list") or response.get("orders") or []
        if not isinstance(raw_orders, list):
            break
        for raw in raw_orders:
            if not isinstance(raw, dict):
                continue
            data = _normalize_upstream_order(int(account["id"]), raw)
            if not data:
                continue
            core.get_db().execute(
                "INSERT INTO xc_orders (account_id,order_sn,store_name,platform,order_money,rebate_money,status,"
                "promotion_order_id,platform_order_id,order_type,rebate_ratio,created_time,settled_time,updated_time) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(order_sn) DO UPDATE SET account_id=excluded.account_id,store_name=excluded.store_name,"
                "platform=excluded.platform,order_money=excluded.order_money,rebate_money=excluded.rebate_money,"
                "status=excluded.status,promotion_order_id=excluded.promotion_order_id,"
                "platform_order_id=excluded.platform_order_id,order_type=excluded.order_type,"
                "rebate_ratio=excluded.rebate_ratio,updated_time=excluded.updated_time,"
                "settled_time=COALESCE(xc_orders.settled_time,excluded.settled_time)",
                tuple(data[key] for key in ("account_id", "order_sn", "store_name", "platform",
                    "order_money", "rebate_money", "status", "promotion_order_id",
                    "platform_order_id", "order_type", "rebate_ratio", "created_time",
                    "settled_time", "updated_time")),
            )
            synced += 1
        if len(raw_orders) < page_size:
            break
    return synced


def sync_orders(accounts: list[dict], *, limit: int = 200) -> dict:
    synced = 0
    errors = []
    for account in accounts:
        try:
            synced += sync_account_orders(account, limit=limit)
        except Exception as exc:
            errors.append({"account_id": account.get("id"), "message": str(exc)[:200]})
    return {"synced": synced, "accounts": len(accounts), "errors": errors}


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
    old_status = str(order.get("status") or "")
    new_status = str(data.get("status") or old_status)
    data["updated_time"] = core.iso()
    # 进入终态时补一个结算时间：只在原值为空时写，人工纠正过的时间一律保留
    if new_status in FINISHED_STATUSES and not order.get("settled_time"):
        data["settled_time"] = core.iso()
    sets = ",".join(f"{key}=?" for key in data)
    core.execute(f"UPDATE xc_orders SET {sets} WHERE id=?", (*data.values(), order_id))
    # 只在状态真的变了才通知，否则每次编辑都会打扰一遍
    if "status" in data and new_status != old_status:
        notify.notify_async("霸王餐订单状态变化", _status_line(order, old_status, new_status))
    return get_order(order_id, account_ids) or {}


def _status_line(order: dict, old: str, new: str) -> str:
    """状态变化通知的一行文案，店铺名缺失时退回订单标识。"""
    store = order.get("store_name") or f"订单#{order.get('id')}"
    platform = order.get("platform") or "-"
    return (f"{store}（{platform}）："
            f"{STATUS_LABEL_CN.get(old, old or '未设置')} → {STATUS_LABEL_CN.get(new, new)}")


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
