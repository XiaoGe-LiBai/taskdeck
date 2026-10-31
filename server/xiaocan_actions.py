"""小蚕业务动作层：元宝签到 / 会员签到抽奖 / 元宝任务 / 营销任务。

分工：
- 签名、主备网关、超时与 401/403 归类都在 `xiaocan_bridge.xiaocan_rpc`，这里不重复实现；
- 本模块只负责「调哪个微服务、方法名是什么、请求体怎么拼、失败怎么归类」；
- 所有函数返回 dict，不向上抛异常：调用方（管理端/定时任务）拿到结构化的结果再决定后续。

方法名与参数结构来自对小蚕 App 网关的观察（接口事实），实现为本项目自有代码。
"""
from __future__ import annotations

from typing import Any, Callable

import xiaocan_bridge as xc

# 这些接口在 App 端用 app_id=10（与登录用的 25 不是同一套）
XC_ACTIVITY_APP_ID = 10

# 重复执行时上游返回的「已经做过」提示：不算失败，标记 skipped
IDEMPOTENT_HINTS = ("已签到", "已领取", "已抽", "重复", "already", "already signed")


def _ctx(account: dict) -> dict[str, Any]:
    """账号行 → RPC 需要的四个值。缺 token/silk_id 时给明确错误，而不是发一个注定 401 的请求。"""
    silk_id = str(account.get("account_info") or "").strip()
    user_id = str(account.get("xc_user_id") or "").strip()
    token = str(account.get("access_token") or "").strip()
    if not silk_id or not token:
        raise ValueError("账号缺少 silk_id 或 access_token，请先重新绑定")
    ctx = {"user_id": user_id or "0", "silk_id": silk_id, "token": token}
    city = account.get("city_code")
    if city:
        ctx["city_code"] = int(city)
    return ctx


def _call(
    account: dict,
    server: str,
    method: str,
    body: dict[str, Any],
    *,
    city_code: int | None = None,
) -> dict:
    """city_code 显式传入时优先（店铺类接口按请求里的定位走），否则用账号自带的。"""
    ctx = _ctx(account)
    payload = {"silk_id": int(ctx["silk_id"]), **body}
    return xc.xiaocan_rpc(
        server,
        method,
        payload,
        user_id=ctx["user_id"],
        silk_id=ctx["silk_id"],
        token=ctx["token"],
        app_id=XC_ACTIVITY_APP_ID,
        city_code=city_code if city_code is not None else ctx.get("city_code"),
    )


# ---------------------------------------------------------------- 单个动作

def sign_in_status(account: dict) -> dict:
    """会员连续签到天数与今日状态。"""
    return _call(account, "SilkwormVip", "VipRightsService.UserSignInDays", {})


def do_sign_in(account: dict) -> dict:
    """天天赚元宝每日签到（官方原生微服务）。"""
    return _call(account, "ActivityTask", "ActivityTaskMobileService.SignIn", {})


def sign_in_lottery(account: dict) -> dict:
    """会员专属每日签到抽奖。"""
    return _call(account, "SilkwormVip", "VipRightsService.SignInLottery", {})


def user_task_overview(account: dict) -> dict:
    """元宝总览与待领取状态。"""
    return _call(account, "ActivityTask", "ActivityTaskMobileService.UserTaskV2", {})


# task_type：3=饿了么订单延时，4=美团订单延时，6=社群
def complete_task_event(account: dict, task_type: int, promotion_order_id: int | None = None) -> dict:
    body: dict[str, Any] = {"task_type": int(task_type)}
    if promotion_order_id is not None:
        body["promotion_order_id"] = int(promotion_order_id)
    return _call(account, "SilkwormMarketing", "SilkwormMobileMarketingService.CompleteTaskEvent", body)


# ---------------------------------------------------------------- 串行执行

def _step(name: str, fn: Callable[[], dict]) -> dict:
    """执行一步并归类结果：ok / skipped（上游说已经做过）/ failed。"""
    try:
        data = fn()
    except Exception as exc:  # 单步失败不能中断整条链路
        message = str(exc)
        skipped = any(hint in message for hint in IDEMPOTENT_HINTS)
        return {"step": name, "ok": False, "skipped": skipped, "error": message}
    return {"step": name, "ok": True, "skipped": False, "error": "", "data": data}


def run_daily(account: dict) -> dict:
    """日常三件事：元宝签到 → 会员签到抽奖 → 拉一次任务总览。

    顺序有讲究：先签到再抽奖（抽奖依赖当天已签到），最后查总览给调用方看结果。
    任一步失败都不影响后续步骤，调用方按 steps 里逐条结果展示。
    """
    steps = [
        _step("元宝签到", lambda: do_sign_in(account)),
        _step("会员签到抽奖", lambda: sign_in_lottery(account)),
        _step("任务总览", lambda: user_task_overview(account)),
    ]
    failed = [s for s in steps if not s["ok"] and not s["skipped"]]
    return {
        "ok": not failed,
        "skipped": sum(1 for s in steps if s["skipped"]),
        "failed": len(failed),
        "steps": steps,
    }

# ---------------------------------------------------------------- 店铺检索

DEFAULT_CITY_CODE = 440303
MAX_PAGE_SIZE = 20


def _geo(lat: float | str | None, lon: float | str | None, city_code: int | str | None) -> tuple[float, float, int]:
    """定位参数校验：宁可在这里报错，也不要发一个经纬度是 0 的请求出去。"""
    try:
        flat, flon = float(lat), float(lon)
    except (TypeError, ValueError):
        raise ValueError("需要有效的 lat / lon（先在小蚕 App 里定位到目标城市）") from None
    if not (-90 <= flat <= 90 and -180 <= flon <= 180):
        raise ValueError("lat / lon 超出合法范围")
    try:
        city = int(city_code) if city_code not in (None, "") else DEFAULT_CITY_CODE
    except (TypeError, ValueError):
        raise ValueError("city_code 必须是整数") from None
    return flat, flon, city


def _page(offset: int | str | None, limit: int | str | None) -> tuple[int, int]:
    try:
        off = max(0, int(offset or 0))
        lim = int(limit or MAX_PAGE_SIZE)
    except (TypeError, ValueError):
        raise ValueError("offset / limit 必须是整数") from None
    return off, max(1, min(MAX_PAGE_SIZE, lim))


def _with_items(res: dict, *keys: str) -> dict:
    """上游不同接口把列表放在不同键里（feed_items / promotion_list / list），
    统一补一个 items 给前端，省得每个页面各写一套兜底。"""
    if isinstance(res, dict) and "items" not in res:
        for key in keys:
            value = res.get(key)
            if isinstance(value, list):
                res["items"] = value
                break
        else:
            res["items"] = []
    return res


def feed_stores(
    account: dict,
    *,
    lat: float | str | None,
    lon: float | str | None,
    offset: int | str | None = 0,
    limit: int | str | None = MAX_PAGE_SIZE,
    sort: int = 0,
    city_code: int | str | None = None,
) -> dict:
    """附近外卖霸王餐店铺：先走主页推荐源，空结果或报错再回落到聚合推荐源。"""
    flat, flon, city = _geo(lat, lon, city_code)
    off, lim = _page(offset, limit)

    primary_body = {
        "lon": flon,
        "lat": flat,
        "number": lim,
        "offset": off,
        "sort": int(sort or 0),
        "scene": 1,
        "is_show_mt": True,
        "app_id": XC_ACTIVITY_APP_ID,
    }
    try:
        res = _call(account, "SilkwormFusion", "FusionService.GetFeedPromotions",
                    primary_body, city_code=city)
        if res.get("feed_items"):
            return _with_items(res, "feed_items", "promotion_list")
    except Exception:
        # 主源不可用就换备源，调用方只需要一份能看的列表
        pass

    fallback_body = {
        "city_code": city,
        "longitude": flon,
        "latitude": flat,
        "number": lim,
        "offset": off,
        "promotion_sort": 1 if int(sort or 0) == 1 else 4,
        "promotion_category": 0,
        "promotion_filter": 0,
        "store_category": 0,
        "store_platform": 0,
        "store_type": 0,
        "app_id": XC_ACTIVITY_APP_ID,
    }
    fallback = _call(account, "SilkwormRec", "RecService.GetStorePromotionList",
                     fallback_body, city_code=city)
    return _with_items(fallback, "promotion_list", "store_list")


def search_stores(
    account: dict,
    keyword: str,
    *,
    lat: float | str | None,
    lon: float | str | None,
    offset: int | str | None = 0,
    limit: int | str | None = MAX_PAGE_SIZE,
    city_code: int | str | None = None,
) -> dict:
    """按关键词搜索店铺。"""
    name = (keyword or "").strip()
    if not name:
        raise ValueError("请输入店铺关键词")
    flat, flon, city = _geo(lat, lon, city_code)
    off, lim = _page(offset, limit)
    body = {
        "lat": flat,
        "lon": flon,
        "keyword": name,
        "offset": off,
        "number": lim,
        "app_id": XC_ACTIVITY_APP_ID,
    }
    res = _call(account, "SilkwormFusion", "FusionService.SearchPromotions", body, city_code=city)
    # 上游在不同版本里把列表放在 promotions / promotion_list，统一成后者给前端
    if "promotions" in res and "promotion_list" not in res:
        res["promotion_list"] = res["promotions"]
    return _with_items(res, "promotion_list", "promotions")


def explore_stores(
    account: dict,
    *,
    lat: float | str | None,
    lon: float | str | None,
    offset: int | str | None = 0,
    limit: int | str | None = MAX_PAGE_SIZE,
    city_code: int | str | None = None,
) -> dict:
    """到店/探店团购霸王餐清单（分页用 page_num/page_size，不是 offset）。"""
    flat, flon, city = _geo(lat, lon, city_code)
    off, lim = _page(offset, limit)
    body = {
        "loc": {"lat": flat, "lng": flon},
        "city_code": city,
        "dist_item": 30000,
        "page": {"page_num": off // lim + 1, "page_size": lim},
        "filter": {
            "is_brand": False,
            "is_can_order": True,
            "is_discount_lt4": False,
            "is_done_bargain": False,
            "is_multi": False,
            "is_single": False,
            "original_price_get": 0,
            "store_first_category": 0,
        },
        "app_id": XC_ACTIVITY_APP_ID,
    }
    res = _call(account, "SilkwormExplore", "ExploreMobile.ListGroupPromotion", body, city_code=city)
    return _with_items(res, "list", "promotion_list")
