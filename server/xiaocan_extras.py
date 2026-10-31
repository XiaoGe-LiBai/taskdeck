"""A/B/C 档扩展动作：任务、抽奖、红包、提现、订单、卡片、社区、VIP 礼包、消息。

约定：
- 每个动作只声明「接受哪些参数、类型是什么、默认值多少」，请求体由这里统一拼；
- 未声明的参数一律拒绝（避免把用户输入直接透传到官方接口）；
- 真正的签名与容灾在 `xiaocan_bridge.xiaocan_rpc`，方法名映射在 `xiaocan_methods`。
"""
from __future__ import annotations

from typing import Any

import xiaocan_methods as methods

# key -> {参数名: (类型, 默认值, 是否必填)}
PARAMS: dict[str, dict[str, tuple[type, Any, bool]]] = {
    # ---- A：元宝任务 ----
    "get_daily_tasks": {},
    "collect_points": {},
    "get_unreceived_point_records": {"page": (int, 1, False), "page_size": (int, 20, False)},
    "get_sign_in_history": {},
    "get_user_task_v2": {},
    "user_claim_points": {"task_id": (int, None, True)},
    # ---- A：抽奖与红包雨 ----
    "get_lottery_info": {},
    "do_lottery_spin": {"prize_type": (int, 1, False)},
    "receive_extra_lottery": {"step": (int, 1, False)},
    "claim_ad_lottery_chance": {},
    "get_lottery_progress": {},
    "get_redpack_rain_event": {},
    "join_redpack_rain": {},
    "grab_redpack_rain": {"click_num": (int, 1, False)},
    "list_user_redpack": {},
    # ---- A：红包与提现 ----
    "get_user_max_redpack": {},
    "get_app_redpack_list": {},
    "get_user_redpack_num": {},
    "client_withdraw": {"money": (int, None, True), "type": (int, 1, False)},
    "get_client_withdraw_list": {},
    # ---- A：订单 ----
    "get_order_list": {"offset": (int, 0, False), "number": (int, 10, False), "order_status": (int, 0, False)},
    "cancel_promotion_quota": {"promotion_id": (int, None, True)},
    "get_store_promotion_detail": {"promotion_id": (int, None, True)},
    # ---- B：卡片与券 ----
    "get_user_card_number": {},
    "get_user_card_list": {},
    "get_brand_card_info": {},
    "grab_brand_card": {},
    "get_user_free_order_info": {},
    "grab_free_order_quota": {},
    "use_free_order_card": {"promotion_id": (int, None, True)},
    "get_plus_vip_rebate_card_infos": {},
    "grab_rebate_card_quota": {},
    # ---- C：社区与 VIP 礼包 ----
    "list_flash_sale_exchanges": {},
    "today_exchange": {},
    "exchange_goods": {"goods_id": (int, None, True)},
    "list_vip_gifts": {},
    "list_vip_gift_details": {},
    "get_vip_up_gift": {},
    "draw_page_gift": {},
    "get_vip_task": {},
    "get_vip_prizes": {},
    "get_vip_rebate_info": {},
    # ---- C：消息中心 ----
    "get_message_channels": {},
    "get_messages": {"page": (int, 1, False), "page_size": (int, 20, False)},
    "set_all_messages_read": {},
}

# 需要在 body 里带 status=1 的接口（未领取记录）
_FIXED_BODY: dict[str, dict[str, Any]] = {
    "get_unreceived_point_records": {"status": 1},
    "get_user_card_number": {"card_number_mode": 1},
}


def available() -> list[str]:
    return sorted(PARAMS)


def build_body(account: dict, key: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """把外部参数校验成网关请求体；未知参数或类型错误直接报错。"""
    if key not in PARAMS:
        raise ValueError(f"不支持的动作：{key}")
    spec = PARAMS[key]
    incoming = params or {}
    unknown = set(incoming) - set(spec)
    if unknown:
        raise ValueError(f"{key} 不接受参数：{', '.join(sorted(unknown))}")

    body: dict[str, Any] = dict(_FIXED_BODY.get(key, {}))
    for name, (cast, default, required) in spec.items():
        raw = incoming.get(name, default)
        if raw is None or raw == "":
            if required:
                raise ValueError(f"{key} 缺少必填参数：{name}")
            continue
        try:
            body[name] = cast(raw)
        except (TypeError, ValueError):
            raise ValueError(f"{key} 的参数 {name} 类型不对") from None

    # 少数接口要求显式 user_id
    if key in ("user_claim_points", "get_daily_tasks"):
        body["user_id"] = int(str(account.get("xc_user_id") or 0) or 0)
    return body


def run(account: dict, key: str, params: dict[str, Any] | None = None) -> dict:
    body = build_body(account, key, params)
    return methods.call(account, key, body)
