"""内置执行器：不依赖青龙脚本、由本服务直接调小蚕网关的任务。

为什么需要它：
- 开源版这些任务是内置调度的，参数（抽奖间隔、扫描范围、提前天数）能真正生效；
- 交给青龙脚本跑的任务，参数在脚本内部写死，给个表单只会是假的。

只实现**接口已确认可用**的动作；红包雨（Join/Grab 一律返回 [10001] 请求参数错误）
和元宝秒杀（缺商品与接口）不在此列。
"""
from __future__ import annotations

import random
import time
from typing import Any, Callable

import core
import notify
import store_watch
import xiaocan_methods as methods

# 免费开红包的机会类型：1=签到 2=分享 4=沾一沾 8=饿了么 9=美团 10=福利中心 11=霸王餐页
FREE_LOTTERY_TYPES = (1, 2, 4, 8, 9, 10, 11)
# 广告加次：2=视频广告 4=抖音商城
AD_LOTTERY_TYPES = (2, 4)
# 天天赚元宝中心的任务（用 CompleteTask 提交，再 UserClaimPoints 领奖）
ACTIVITY_TASKS = ((5, "加入官方社群"), (57, "抖音电商浏览"), (59, "天天赚元宝打卡"))
# 领券类事件：3=饿了么 4=美团 6=社群（需要订单上下文，没有时上游会拒，失败不算异常）
MISSION_TYPES = ((3, "饿了么领券"), (4, "美团领券"), (6, "小蚕专属社群"))


def _num(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _call(account: dict, key: str, body: dict | None = None) -> dict:
    return methods.call(account, key, body or {})


def _already(message: str) -> bool:
    return any(hint in message for hint in ("已", "重复", "already"))


# ---------------------------------------------------------------- 执行器


def collect_points(account: dict, params: dict) -> str:
    """收取未收元宝（气泡成熟奖励）。"""
    result = _call(account, "collect_points", {})
    gained = _num(result.get("point") or (result.get("data") or {}).get("point"))
    return f"已收取 {gained} 元宝" if gained else "已发起收取"


def daily_earn(account: dict, params: dict) -> str:
    """领天天赚元宝：先提交任务中心的打卡任务并领奖，再补领券类事件。

    两类接口不同：任务中心走 `CompleteTask` + `UserClaimPoints`（要 task_id），
    领券事件走 `CompleteTaskEvent`（要 task_type，且多数需要订单上下文）。
    """
    done, skipped, failed = [], [], []
    for task_id, label in ACTIVITY_TASKS:
        try:
            _call(account, "complete_activity_task", {"task_id": task_id})
            done.append(label)
        except Exception as exc:
            if _already(str(exc)):
                skipped.append(label)
                continue
            failed.append(f"{label}（{exc}）")
            continue
        try:
            _call(account, "user_claim_points", {"task_id": task_id})
        except Exception:
            pass  # 提交成功但领奖失败（比如未达标）不影响整体
    for task_type, label in MISSION_TYPES:
        try:
            _call(account, "complete_task_event", {"task_type": task_type})
            done.append(label)
        except Exception as exc:
            if _already(str(exc)):
                skipped.append(label)
            # 领券类事件缺订单上下文是常态，不计入失败
    parts = []
    if done:
        parts.append("已领 " + "、".join(done))
    if skipped:
        parts.append("已完成 " + "、".join(skipped))
    if failed:
        parts.append("失败 " + "、".join(failed))
    return "；".join(parts) or "没有可领取的任务"


def vip_sign(account: dict, params: dict) -> str:
    """执行会员签到抽奖并核验成长权益。"""
    results, failures = [], []
    for key, label in (
        ("do_user_sign", "会员签到"),
        ("get_user_sign_in_days", "签到状态"),
        ("sign_in_lottery", "签到抽奖"),
        ("get_sign_in_node", "签到里程碑"),
        ("get_vip_up_gift", "会员成长礼包"),
        ("list_vip_gifts", "会员特权"),
        ("get_vip_task", "成长任务"),
    ):
        try:
            _call(account, key, {})
            results.append(f"{label}完成")
        except Exception as exc:
            if _already(str(exc)):
                results.append(f"{label}已完成")
            else:
                failures.append(f"{label}：{exc}")
    if failures:
        raise RuntimeError("；".join(results + failures))
    return "；".join(results)


def free_lottery(account: dict, params: dict) -> str:
    """免费开红包与抽奖：先领全部免费机会，再按间隔把次数开完。"""
    gap = max(0.2, float(params.get("draw_sec") or 0.8))
    claimed = 0
    for lottery_type in FREE_LOTTERY_TYPES:
        try:
            _call(account, "add_lottery_times", {"type": lottery_type})
            claimed += 1
        except Exception:
            continue
    for bus_type in AD_LOTTERY_TYPES:
        try:
            _call(account, "claim_ad_lottery_chance", {"bus_type": bus_type})
            claimed += 1
        except Exception:
            continue

    opened = 0
    try:
        info = _call(account, "get_lottery_info", {})
        lot = info.get("lottery_info") or {}
        # 上游 lucky_times 是「额外待抽次数」，日常额度在 day_num；
        # 只认 lucky_times 会出现「领了 5 次机会却一次都不开」。
        times = _num(lot.get("lucky_times")) or _num(lot.get("day_num"))
    except Exception:
        times = 0
    for _ in range(min(times, 30)):
        try:
            _call(account, "do_lottery_spin", {"prize_type": 1})
            opened += 1
        except Exception:
            break
        time.sleep(gap)
    return f"领到 {claimed} 个机会，开了 {opened} 次"


def redpack_rain(account: dict, params: dict) -> str:
    """整点红包雨：接入场次 → 拟真等待 → 按 click_num ± jitter 上报结算。"""
    click = _num(params.get("click_num"), 15) or 15
    jitter = max(0, _num(params.get("jitter"), 5))
    wait = max(10, _num(params.get("game_wait_sec"), 28))

    event_id = None
    try:
        info = _call(account, "get_redpack_rain_event", {})
        event = (info.get("event") or {}) if isinstance(info, dict) else {}
        event_id = event.get("event_id") or info.get("event_id")
    except Exception:
        event_id = None  # 上游这个接口时好时坏，拿不到就按「直接上报」走

    join_body = {"event_id": event_id} if event_id else {}
    _call(account, "join_redpack_rain", join_body)
    time.sleep(wait)  # 模拟红包下落与交互，太快上报反而异常
    submit = click + random.randint(-jitter, jitter)
    submit = max(1, submit)
    grab_body = {"click_num": submit}
    if event_id:
        grab_body["event_id"] = event_id
    _call(account, "grab_redpack_rain", grab_body)
    return f"已上报抓取 {submit} 个红包"


def flash_sale(account: dict, params: dict) -> str:
    """元宝秒杀抢券：拉当日在架商品 → 选目标 → 兑换。

    商品 ID 留空时自动优选「剩余库存最多」的一款，避免默认挑到已抢光的。
    """
    want = str(params.get("goods_ids") or "").strip()
    wanted_ids = [int(part.strip()) for part in want.split(",") if part.strip().isdigit()]

    # 上游必须带 new_level（会员等级），少这个参数直接 [2] 参数错误
    body = {
        "is_plus": bool(account.get("is_plus")),
        "new_level": _num(account.get("vip_level"), 5) or 5,
    }
    result = _call(account, "list_flash_sale_exchanges", body)
    listing = result.get("list") or {}
    items = listing.get("vip") or []
    if not items:
        return "今日商城暂无在架秒杀商品"

    target = None
    for item in items:
        if wanted_ids and item.get("exchange_id") in wanted_ids:
            target = item
            break
    if not target:
        candidates = [item for item in items if _num(item.get("left")) > 0]
        if candidates:
            target = max(candidates, key=lambda item: _num(item.get("left")))
        else:
            target = items[0]

    exchange_id = target.get("exchange_id")
    name = target.get("goods_name") or f"商品#{exchange_id}"
    cost = _num(target.get("community_silk"))
    left = _num(target.get("left"))
    _call(account, "today_exchange", {"exchange_id": exchange_id})
    return f"兑换成功：{name}（消耗 {cost} 元宝，场次剩余 {left}）"


def dual_rebate(account: dict, params: dict) -> str:
    """同店双返利巡检：按参数扫附近门店，同店出现多个方案就推送。"""
    scan_params = {
        "lat": params.get("lat") or account.get("latitude") or "",
        "lon": params.get("lon") or account.get("longitude") or "",
        "city_code": params.get("city_code") or account.get("city_code") or "",
        "limit": max(20, min(_num(params.get("max_stores"), 300), 800)),
        "keyword": str(params.get("keyword") or "").strip(),
    }
    if not (scan_params["lat"] and scan_params["lon"]):
        # 附近门店必须按真实位置查，没有定位就明确报错，不要拿空坐标去扫
        raise ValueError("该账号没有定位坐标，请先在账号里设置定位后再开同店双返利监控")
    found = store_watch.probe(account, "dual", scan_params)
    keyword = scan_params["keyword"]
    if keyword:
        # probe 的 dual 分支只做「同店多方案」聚合，关键词要在这里收口才算真生效
        found = [item for item in found if keyword in item["title"]]
    if not found:
        return "本轮没有同店多方案"
    lines = [f"{item['title']}：{item['detail']}" for item in found[:10]]
    notify.notify_async(
        f"发现 {len(found)} 家同店多方案",
        "账号 " + (account.get("nickname") or account.get("account_info") or "") + "：\n" + "\n".join(lines),
    )
    return f"发现 {len(found)} 家同店多方案"


RUNNERS: dict[str, Callable[[dict, dict], str]] = {
    "collect_points": collect_points,
    "daily_earn": daily_earn,
    "vip_sign": vip_sign,
    "free_lottery": free_lottery,
    "redpack_rain": redpack_rain,
    "flash_sale": flash_sale,
    "dual_rebate": dual_rebate,
}


def run(account: dict, task_key: str, params: dict | None = None) -> str:
    runner = RUNNERS.get(task_key)
    if not runner:
        raise ValueError(f"没有内置执行器：{task_key}")
    return runner(account, params or {})
