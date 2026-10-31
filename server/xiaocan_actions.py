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


def _call(account: dict, server: str, method: str, body: dict[str, Any]) -> dict:
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
        city_code=ctx.get("city_code"),
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
