"""小蚕资产工作台：把只读 RPC 聚合成页面能直接渲染的结构。

分工：
- `xiaocan_methods` 负责方法名与签名，本模块只做「调哪几个方法、字段怎么归一」；
- 分段取数（profile / assets / tasks / points / signin / lottery / rain / cards / redpacks），
  页面按需拉取，任何一段失败都只影响该段，不拖垮整页；
- 上游字段有的在顶层、有的在 `data`/`point`/`lottery_info` 里，且命名不统一，
  归一逻辑集中在这里，前端不再猜结构。

注意：部分字段上游没有公开文档（签到历史条目、抽奖阶梯），这里按已知响应
做容错提取，取不到就留空数组并把原始响应放进 `raw`，不臆造数值。
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

import xiaocan_methods as methods

# 段名 → 该段需要的 RPC。顺序即调用顺序。
SECTIONS: dict[str, tuple[str, ...]] = {
    "profile": ("get_user_info",),
    "assets": ("get_user_task_v2",),
    "tasks": ("get_daily_tasks",),
    "points": ("get_unreceived_point_records",),
    "signin": ("get_sign_in_history", "get_user_sign_in_days"),
    "lottery": ("get_lottery_info", "get_lottery_progress"),
    "rain": ("get_redpack_rain_event",),
    "freeorder": ("get_user_free_order_info",),
    "cards": ("get_user_card_number", "get_user_card_list"),
    "redpacks": ("get_user_redpack_num", "get_app_redpack_list"),
}

DEFAULT_SECTIONS = ("profile", "assets")

# 单段 RPC 的请求体：只放接口确实需要的参数，未知参数不上送
_BODIES: dict[str, dict[str, Any]] = {
    "get_user_info": {"if_need_subscribe": True, "if_need_notify_status": True, "inviter_silk_id": 0},
    "get_user_card_number": {"card_number_mode": 1},
    "get_unreceived_point_records": {"status": 1, "page": 1, "page_size": 20},
    "get_user_card_list": {"status": 0, "offset": 0, "number": 50},
    "get_app_redpack_list": {"page": 1, "page_size": 50},
}

# 需要显式 user_id 的接口（ActivityTask 系列）
_NEED_USER_ID = ("get_daily_tasks", "user_claim_points", "get_unreceived_point_records")


def _num(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _card_category(name: str) -> str:
    """卡券归类：上游 card_type 没有公开枚举，只能按券名关键词归类。"""
    if "免单" in name:
        return "免单卡"
    if any(word in name for word in ("影音", "腾讯", "爱奇艺", "优酷", "芒果", "视频会员")):
        return "影音卡"
    if "品牌" in name:
        return "品牌券"
    return "其他卡券"


def _normalize_cards(number_res: dict, list_res: dict) -> dict:
    raw_items = _list(list_res.get("list"))
    grouped: dict[tuple, dict] = {}
    for item in raw_items:
        item = _dict(item)
        card = _dict(item.get("card"))
        name = str(card.get("name") or "特权券")
        expire = _num(item.get("expire_time"))
        key = (card.get("id"), name, expire)
        if key in grouped:
            grouped[key]["count"] += 1
            continue
        grouped[key] = {
            "id": item.get("id"),
            "name": name,
            "desc": str(card.get("desc") or ""),
            "pic": str(card.get("pic") or ""),
            "card_type": card.get("card_type"),
            "category": _card_category(name),
            "expire_time": expire,
            "status": _num(item.get("status")),
            "count": 1,
        }
    items = sorted(grouped.values(), key=lambda card: (card["category"], card["expire_time"]))
    return {
        "can_use_number": _num(number_res.get("can_use_number")),
        "expiring_soon_number": _num(number_res.get("expiring_soon_number")),
        "items": items,
        "total": len(raw_items),
    }


def _normalize_redpacks(number_res: dict, list_res: dict) -> dict:
    items = []
    for item in _list(list_res.get("unused_items") or list_res.get("list")):
        item = _dict(item)
        limit = _dict(item.get("limit"))
        platforms = _list(limit.get("platform_items") or limit.get("bwc_platforms"))
        items.append({
            "id": item.get("user_red_pack_id"),
            "name": str(item.get("name") or "霸王餐红包"),
            "info": str(item.get("info") or ""),
            "value_num": _num(item.get("value_num") or item.get("reward_num")),
            "threshold_num": _num(item.get("threshold_num")),
            "end_time": _num(item.get("end_time")),
            "platforms": [int(p) for p in platforms if isinstance(p, (int, float, str)) and str(p).isdigit()],
        })
    items.sort(key=lambda rp: rp["end_time"])
    return {
        "num": _num(number_res.get("num")),
        "items": items,
    }


def _normalize_tasks(res: dict) -> dict:
    data = _dict(res.get("data"))
    items = []
    for task in _list(data.get("list")):
        task = _dict(task)
        completed = _num(task.get("completed"))
        items.append({
            "id": task.get("id"),
            "title": str(task.get("title") or task.get("name") or f"任务#{task.get('id')}"),
            "desc": str(task.get("desc") or task.get("sub_title") or ""),
            "icon": str(task.get("icon") or ""),
            "point": _num(task.get("point")),
            "completed": completed,
            # 开源版只把 completed==3 当作「已达标可领取」，其它值不下结论
            "claimable": completed == 3,
        })
    return {
        "items": items,
        "claimable_count": sum(1 for task in items if task["claimable"]),
        "claimable_point": sum(task["point"] for task in items if task["claimable"]),
    }


def _normalize_points(res: dict) -> dict:
    point = _dict(res.get("point"))
    items = []
    for item in _list(point.get("items")):
        item = _dict(item)
        items.append({
            "task_id": item.get("task_id"),
            "task_name": str(item.get("task_name") or f"任务#{item.get('task_id')}"),
            "point": _num(item.get("point")),
            "time": _num(item.get("time") or item.get("create_time")),
        })
    return {
        "points": _num(point.get("points")),
        "items": items,
    }


def _normalize_signin(history_res: dict, days_res: dict) -> dict:
    data = _dict(history_res.get("data"))
    days = _num(history_res.get("days") or data.get("days") or days_res.get("days"))
    raw_records = _list(
        history_res.get("list")
        or history_res.get("records")
        or history_res.get("sign_in_list")
        or history_res.get("history")
        or data.get("list")
        or data.get("records")
        or data.get("sign_in_list"),
    )
    records = []
    for item in raw_records:
        item = _dict(item) if isinstance(item, dict) else {"date": item}
        records.append({
            "date": str(item.get("date") or item.get("day") or item.get("sign_date") or item.get("time") or ""),
            "point": _num(item.get("point") or item.get("reward")),
        })
    return {
        "days": days,
        "records": records,
        "vip_signed_today": bool(days_res.get("signed") or days_res.get("is_sign") or data.get("signed")),
    }


def _normalize_lottery(info_res: dict, progress_res: dict) -> dict:
    info = _dict(info_res.get("lottery_info"))
    steps = []
    for item in _list(progress_res.get("progress") or progress_res.get("list")):
        item = _dict(item)
        steps.append({
            "step": _num(item.get("step") or item.get("index")),
            "title": str(item.get("title") or item.get("name") or ""),
            "target": _num(item.get("target") or item.get("need_num")),
            "current": _num(item.get("current") or item.get("num")),
            "received": bool(item.get("received") or item.get("is_receive")),
        })
    return {
        "lucky_times": _num(info.get("lucky_times")),
        "day_num": _num(info.get("day_num")),
        "steps": steps,
    }


def _normalize_freeorder(res: dict) -> dict:
    """每月外卖免单券：上游把状态放在 info 里（had=已持有, used=已核销）。"""
    info = _dict(res.get("info") or res.get("data"))
    return {
        "had": bool(info.get("had")),
        "used": bool(info.get("used")),
        "card_id": info.get("user_free_card_id") or info.get("id"),
    }


def _normalize_rain(res: dict) -> dict:
    event = _dict(res.get("event"))
    return {
        "has_event": bool(res.get("has_event")),
        "event_id": event.get("event_id"),
        "begin_time": _num(event.get("begin_time")),
        "end_time": _num(event.get("end_time")),
        "status": _num(event.get("status")),
    }


def _normalize_profile(res: dict) -> dict:
    info = _dict(res.get("user_info"))
    vip = _dict(info.get("vip_level_info"))
    return {
        "nickname": str(info.get("nickname") or ""),
        "avatar": str(info.get("avatar") or ""),
        "silk": _num(info.get("silk")),
        "withdrawing": _num(info.get("withdrawing")),
        "withdraw_total": _num(info.get("withdraw_total")),
        "completed_number": _num(info.get("completed_number")),
        "phone": str(info.get("phone") or ""),
        "real_name": str(info.get("real_name") or ""),
        "vip": {
            "level": _num(vip.get("new_level")),
            "score": _num(vip.get("score")),
            "next_level_score": _num(vip.get("next_level_score")),
            "current_level_score": _num(vip.get("current_level_score")),
            "is_plus": bool(vip.get("is_plus")),
            "expired_at": _num(vip.get("expired_at")),
        },
    }


def _normalize_assets(res: dict) -> dict:
    data = _dict(res.get("data"))
    return {
        "yb_point": _num(data.get("yb_point")),
        "unreceived_points": _num(data.get("unreceived_points")),
        "exchanged_yb_point": _num(data.get("exchanged_yb_point")),
    }


def _body_for(key: str, account: dict) -> dict:
    body = dict(_BODIES.get(key, {}))
    if key in _NEED_USER_ID:
        body["user_id"] = _num(account.get("xc_user_id"))
    return body


def _call(account: dict, key: str, city_code: int | None = None) -> dict:
    return methods.call(account, key, _body_for(key, account), city_code=city_code)


def _section_reader(name: str, city_code: int | None = None) -> Callable[[dict], dict]:
    def call(account: dict, key: str) -> dict:
        return _call(account, key, city_code)

    if name == "profile":
        return lambda acc: _normalize_profile(call(acc, "get_user_info"))
    if name == "assets":
        return lambda acc: _normalize_assets(call(acc, "get_user_task_v2"))
    if name == "tasks":
        return lambda acc: _normalize_tasks(call(acc, "get_daily_tasks"))
    if name == "points":
        return lambda acc: _normalize_points(call(acc, "get_unreceived_point_records"))
    if name == "signin":
        return lambda acc: _normalize_signin(
            call(acc, "get_sign_in_history"), call(acc, "get_user_sign_in_days"),
        )
    if name == "lottery":
        return lambda acc: _normalize_lottery(
            call(acc, "get_lottery_info"), call(acc, "get_lottery_progress"),
        )
    if name == "rain":
        return lambda acc: _normalize_rain(call(acc, "get_redpack_rain_event"))
    if name == "freeorder":
        return lambda acc: _normalize_freeorder(call(acc, "get_user_free_order_info"))
    if name == "cards":
        return lambda acc: _normalize_cards(
            call(acc, "get_user_card_number"), call(acc, "get_user_card_list"),
        )
    if name == "redpacks":
        return lambda acc: _normalize_redpacks(
            call(acc, "get_user_redpack_num"), call(acc, "get_app_redpack_list"),
        )
    raise ValueError(f"未知的小蚕数据段：{name}")


def parse_sections(raw: str | None) -> tuple[str, ...]:
    """解析 `sections=a,b`；非法值忽略，全空时用默认段。"""
    if not raw:
        return DEFAULT_SECTIONS
    picked = tuple(part.strip() for part in str(raw).split(",") if part.strip() in SECTIONS)
    return picked or DEFAULT_SECTIONS


def overview(
    account: dict,
    sections: tuple[str, ...] | None = None,
    city_code: int | None = None,
) -> dict:
    """并发拉取指定段，单段失败只记录错误。

    并发度压到 3：官方网关对频次敏感，页面上「全都要」也不能一次打出十几个请求。
    city_code 由页面定位决定：卡券/红包/任务类接口会带 x-City 头。
    """
    picked = tuple(sections or DEFAULT_SECTIONS)
    data: dict[str, Any] = {}
    errors: dict[str, str] = {}

    def run(name: str) -> tuple[str, dict | None, str]:
        try:
            return name, _section_reader(name, city_code)(account), ""
        except Exception as exc:  # 单段失败不影响其它段
            return name, None, str(exc)

    with ThreadPoolExecutor(max_workers=3) as pool:
        for name, value, error in pool.map(run, picked):
            if error:
                errors[name] = error
            else:
                data[name] = value

    return {"ok": not errors, "data": data, "errors": errors}
