"""/api/* 用户端接口：权益、积分、签到、转盘、邀请、公告、小蚕账号。"""
from __future__ import annotations

import math
import os
import random
from datetime import timedelta

from flask import Blueprint, Response, abort, request, send_file

import core
import runner_dispatch
import vip
import meituan_runner
import time_service
import xiaocan_actions
import xiaocan_extras
import xiaocan_stats
import xiaocan_bridge as xc
import xiaocan_tasks

bp = Blueprint("user", __name__)


# ------------------------------------------------------------ 站点公开信息
#
# 未登录也要能拿到：登录页、注册页、落地页、以及 Next 的 root metadata
# 都得显示站点名称。所以这里**不能**加 @core.require_login，也**不能**
# 直接复用 /admin/settings（那里有 smtp 等敏感配置，公开等于泄露）。
# 只挑出「公开安全、且前端确实要用」的字段返回，需要新字段时逐个加。


@bp.get("/site-info")
def site_info():
    """
    站点公开信息：站名 + 自定义图标地址。

    未登录页面（登录/注册/落地页）和 Next 的 root metadata 都要它，所以
    **不能**加 @core.require_login，也**不能**直接复用 /admin/settings
    （那里有 smtp 等敏感配置）。只挑公开安全的字段返回，新增字段逐个加。
    """
    logo_url = ""
    if core.site_logo_enabled():
        # 带 mtime 做 cache-busting：换图之后浏览器/中间层不会还拿着旧 logo
        stamp = int(os.path.getmtime(core.SITE_LOGO_PATH))
        logo_url = f"/site-icon?v={stamp}"

    return core.ok({
        "site_name": core.site_name(),
        "logo_url": logo_url,
    })


@bp.get("/site-logo")
def site_logo():
    """
    自定义站点图标的图片本体（前端 /site-icon 路由会转发它）。

    这里是**图片接口**，不是 /api 信封接口，所以出错要给真正的 HTTP 状态码 ——
    用 core.fail 的话 HTTP 仍是 200、错误码藏在 body 里，Next 那边会把这段 JSON
    当成图片原样吐给浏览器，最后表现为一个裂图。
    """
    if not core.site_logo_enabled():
        abort(404)
    return send_file(core.SITE_LOGO_PATH, mimetype="image/png", conditional=True)

TYPE_TEXT = {
    "redeem": "卡密兑换",
    "daily_check_in": "每日签到",
    "gamble_check_in": "赌狗签到",
    "makeup_check_in": "补签",
    "lottery_reward": "转盘中奖",
    "lottery_cost": "转盘消耗",
    "purchase": "购买消费",
    "admin_adjust": "管理员调整",
    "invite_reward": "邀请奖励",
}


# ------------------------------------------------------------ 权益 / 账号


@bp.get("/billing/status")
@core.require_login
def billing_status():
    user = core.current_user()
    rows = core.query(
        "SELECT * FROM accounts WHERE user_id=? ORDER BY id", (user["id"],)
    )
    accounts = [
        {
            "id": r["id"],
            "nickname": r["nickname"],
            "status": r["status"],
            "membership_expire": r["membership_expire"],
            "remaining_days": xc.membership_days(r["membership_expire"]),
        }
        for r in rows
    ]
    return core.ok(
        {
            "accounts": accounts,
            "points_balance": user["points_balance"],
            "slot_total": user["slot_total"],
            "slot_used": user["slot_used"],
        }
    )


# ------------------------------------------------------------ 积分


@bp.get("/points/summary")
@core.require_login
def points_summary():
    user = core.current_user()
    rows = core.query("SELECT * FROM products WHERE status='enabled' ORDER BY sort_order, id")
    level = vip.current_level(user)

    products = []
    for r in rows:
        p = dict(r)
        list_price = int(p["points_price"] or 0)
        # 与 purchase() 同一口径：会员期商品按等级打折，车位不打折
        p["list_price"] = list_price
        p["pay_price"] = (
            vip.apply_discount(list_price, user) if p["product_type"] == "membership" else list_price
        )
        p["discounted"] = p["pay_price"] < list_price
        products.append(p)

    return core.ok(
        {
            "balance": user["points_balance"],
            "products": products,
            "referral_rate_bps": int(core.get_setting("referral_rate_bps", "800") or 0),
            "vip_level": level,
            "vip_level_name": vip.table(level)["name"],
            "vip_expire": user["vip_expire"],
        }
    )


@bp.get("/points/transactions")
@core.require_login
def transactions():
    user = core.current_user()
    page = core.arg_int("page", 1, 1, 100000)
    size = core.arg_int("size", 20, 1, 100)
    total = core.query_one(
        "SELECT COUNT(*) AS n FROM points_transactions WHERE user_id=?", (user["id"],)
    )["n"]
    rows = core.query(
        "SELECT * FROM points_transactions WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?",
        (user["id"], size, (page - 1) * size),
    )
    return core.ok(
        {
            "records": [
                {
                    "id": r["id"],
                    "amount": r["amount"],
                    "type": r["type"],
                    "type_text": TYPE_TEXT.get(r["type"], r["type"]),
                    "note": r["note"],
                    "created_time": r["created_time"],
                }
                for r in rows
            ],
            "total": total,
            "page": page,
            "size": size,
        }
    )


@bp.post("/points/redeem")
@core.require_login
def redeem_card():
    user = core.current_user()
    body = request.get_json(silent=True) or {}
    code = (body.get("code") or "").strip().upper()
    if not code:
        return core.fail("请输入卡密")
    card = core.query_one("SELECT * FROM cards WHERE upper(code)=?", (code,))
    if not card:
        return core.fail("卡密不存在")
    if card["status"] == "used":
        return core.fail("该卡密已被使用")
    if card["status"] == "void":
        return core.fail("该卡密已作废")
    cur = core.execute(
        "UPDATE cards SET status='used', user_id=?, used_time=? WHERE id=? AND status='unused'",
        (user["id"], core.iso(), card["id"]),
    )
    # 并发下两个请求都能过上面的 SELECT 检查，真正防重靠这条 UPDATE 的条件：
    # rowcount=0 说明被别人抢先兑掉了，绝不能继续走 add_points，否则同一卡密加两次分。
    if cur.rowcount == 0:
        return core.fail("该卡密已被使用")
    try:
        balance = core.add_points(user["id"], int(card["points_value"]), "redeem", "卡密兑换")
    except ValueError as exc:
        core.execute("UPDATE cards SET status='unused', user_id=NULL, used_time=NULL WHERE id=?", (card["id"],))
        return core.fail(str(exc))
    return core.ok({"balance": balance, "amount": int(card["points_value"])})


@bp.post("/points/purchase")
@core.require_login
def purchase():
    user = core.current_user()
    body = request.get_json(silent=True) or {}
    product = core.query_one("SELECT * FROM products WHERE id=?", (body.get("product_id"),))
    if not product or product["status"] != "enabled":
        return core.fail("商品不存在或已下架")

    account = None
    account_id = body.get("account_id")
    if account_id:
        row = core.query_one("SELECT * FROM accounts WHERE id=? AND user_id=?", (account_id, user["id"]))
        if not row:
            return core.fail("账号不存在")
        account = dict(row)

    if product["product_type"] == "membership" and not account:
        return core.fail("请先绑定一个小蚕账号")

    # 会员期商品按会员等级打折（高级实付 95% / 至尊 90%）；
    # 车位不打折——它是"容量"，不在会员期折扣的语义里。
    list_price = int(product["points_price"])
    is_membership = product["product_type"] == "membership"
    price = vip.apply_discount(list_price, user) if is_membership else list_price

    if int(user["points_balance"]) < price:
        return core.fail("积分不足")

    note = f"购买 {product['name']}"
    if price < list_price:
        note = f"购买 {product['name']}（原价 {list_price}，会员折扣后 {price}）"

    try:
        balance = core.add_points(user["id"], -price, "purchase", note)
    except ValueError as exc:
        return core.fail(str(exc))

    granted_level = 0
    old_level = vip.current_level(user)
    new_level = old_level
    if is_membership and account:
        days = int(product["grant_value"] or 0)

        # ① 账号会员期：决定"哪个号能跑"（原有逻辑，不动）
        base = core.parse_iso(account["membership_expire"])
        start = base if (base and base > core.now_dt()) else core.now_dt()
        new_expire = start + timedelta(days=days)
        core.update(
            "accounts",
            account["id"],
            {"membership_expire": core.iso(new_expire, ms=False)[:16], "updated_time": core.iso()},
        )

        # ② 用户等级：决定"有哪些权益"。取当前等级与本次授予等级的较大者（不降级），
        #    到期时间按购买天数顺延（已过期则从今天算）。
        granted_level = vip.level_for_membership_days(days)
        if granted_level > 0:
            new_level = max(old_level, granted_level)
            new_vip_expire = vip.extend_expire(user["vip_expire"], days)
            core.execute(
                "UPDATE users SET vip_level=?, vip_expire=? WHERE id=?",
                (new_level, new_vip_expire, user["id"]),
            )

    if product["product_type"] == "slot":
        core.execute(
            "UPDATE users SET slot_total=slot_total+? WHERE id=?", (int(product["grant_value"]), user["id"])
        )

    # 邀请奖励：直接上级拿消费积分的比例由**上级的会员等级**决定；
    # 上级是普通会员时回落到设置项 referral_rate_bps（后台可调）。
    inviter_id = user["inviter_id"]
    if inviter_id:
        inviter = core.query_one("SELECT * FROM users WHERE id=?", (inviter_id,))
        if inviter and vip.current_level(inviter) > 0:
            rate = vip.referral_bps(inviter)
        else:
            rate = int(core.get_setting("referral_rate_bps", "0") or 0)
        reward = price * rate // 10000
        if reward > 0:
            try:
                core.add_points(int(inviter_id), reward, "invite_reward", f"下级购买 {product['name']}")
            except ValueError:
                pass

    return core.ok({
        "balance": balance,
        "paid": price,
        "list_price": list_price,
        # granted_level = 本次套餐名义授予的等级；vip_level = 购买后的实际生效等级
        # （不降级：老等级更高时 vip_level 保持老等级）。前端要用 vip_level 提示。
        "granted_level": granted_level,
        "old_vip_level": old_level,
        "vip_level": new_level,
        "vip_level_name": vip.table(new_level)["name"],
    })


# ------------------------------------------------------------ 签到


DEFAULT_DAILY_REWARD = 8
DEFAULT_GAMBLE_REWARDS = [-25, -13, -6, 0, 6, 13, 25]
# 连签额外加成：从第 6 天开始依次生效，第 10 天封顶（超出取最后一个值，不会无限递增）
DEFAULT_STREAK_BONUS = [5, 7, 11, 13, 15]
STREAK_BONUS_FROM_DAY = 6

CHECKIN_KIND_TEXT = {"daily": "每日签到", "gamble": "赌狗签到", "makeup": "补签"}
# 用户可直接发起的签到类型（补签只能走 /points/check-in/makeup，不能被普通签到接口伪造）
CHECKIN_ALLOWED_KINDS = ("daily", "gamble")


def _parse_rewards(raw) -> list[int]:
    """解析逗号分隔的数值列表（兼容中文逗号、空格）。"""
    out: list[int] = []
    for part in str(raw or "").replace("，", ",").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.append(int(float(part)))
        except ValueError:
            continue
    return out


def checkin_daily_reward() -> int:
    """每日签到：固定奖励（单位：分）。"""
    positives = [v for v in _parse_rewards(core.get_setting("checkin_daily_reward", "")) if v > 0]
    return positives[0] if positives else DEFAULT_DAILY_REWARD


def checkin_gamble_rewards() -> list[int]:
    """赌狗签到：奖励池（单位：分），可含负数与 0。

    池子**所有用户共用**，不按会员等级区分（等级加成只作用于每日签到）。
    """
    return _parse_rewards(core.get_setting("checkin_gamble_rewards", "")) or list(DEFAULT_GAMBLE_REWARDS)


def checkin_streak_bonus_list() -> list[int]:
    """连签额外加成序列（分）。"""
    return _parse_rewards(core.get_setting("checkin_rewards", "")) or list(DEFAULT_STREAK_BONUS)


def checkin_streak(user_id: int, today: str | None = None) -> int:
    """当前连签天数。

    口径：从今天往前数，连续有签到记录（daily / gamble / makeup 都算"签了"）的天数。
    今天还没签时返回的是**截至昨天**的连签（调用方 +1 即为今天签完后的连签）。
    断一天即归零。
    """
    from datetime import date, timedelta

    today = today or core.today_str()
    dates = {
        r["date"] for r in core.query("SELECT date FROM checkin_records WHERE user_id=?", (user_id,))
    }
    cursor = date.fromisoformat(today)
    if today not in dates:
        cursor -= timedelta(days=1)
    streak = 0
    while cursor.isoformat() in dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _round_half_up(value: float) -> int:
    """四舍五入（不用 Python 的 round()——那是银行家舍入，round(22.5)=22 会少给分）。"""
    return int(value + 0.5) if value >= 0 else -int(-value + 0.5)


def checkin_base_reward(streak: int) -> tuple[int, int]:
    """按连签天数返回 (基础奖励, 连签额外)。

    前 5 天没有额外；第 6 天取序列第 1 个，依次往后，超出序列长度取最后一个（封顶）。
    """
    base = checkin_daily_reward()
    bonuses = checkin_streak_bonus_list()
    if streak < STREAK_BONUS_FROM_DAY or not bonuses:
        return base, 0
    idx = min(streak - STREAK_BONUS_FROM_DAY, len(bonuses) - 1)
    return base, bonuses[idx]


def checkin_daily_preview(user, streak: int) -> dict:
    """每日签到的收益明细：基础 + 连签额外，再乘会员倍率。

    user 需要含 vip_level / vip_expire（用于算倍率）。
    """
    base, bonus = checkin_base_reward(streak)
    mult = vip.signin_multiplier(user)
    total = _round_half_up((base + bonus) * mult)
    return {
        "base": base,
        "streak_bonus": bonus,
        "multiplier": mult,
        "total": total,
    }


# ---------------------------------------------------------------- 补签

DEFAULT_MAKEUP_COST = 30
DEFAULT_MAKEUP_QUOTA = 4
# 只能补最近 N 天内的漏签日期（防止补一年前）
MAKEUP_MAX_LOOKBACK_DAYS = 31


def checkin_makeup_cost() -> int:
    try:
        v = int(str(core.get_setting("checkin_makeup_cost", "")).strip())
        return v if v >= 0 else DEFAULT_MAKEUP_COST
    except (TypeError, ValueError):
        return DEFAULT_MAKEUP_COST


def checkin_makeup_quota() -> int:
    try:
        v = int(str(core.get_setting("checkin_makeup_quota", "")).strip())
        return v if v >= 0 else DEFAULT_MAKEUP_QUOTA
    except (TypeError, ValueError):
        return DEFAULT_MAKEUP_QUOTA


def checkin_makeup_used(uid: int, month: str | None = None) -> int:
    """某自然月已用补签次数。

    口径是**补签操作时间**所在的月份（本月用了 4 次就用完），不是被补日期的月份。
    """
    month = month or core.today_str()[:7]
    return core.query_one(
        "SELECT COUNT(*) AS n FROM checkin_records "
        "WHERE user_id=? AND kind='makeup' AND created_time LIKE ?",
        (uid, month + "%"),
    )["n"]


def checkin_calendar(user, month: str) -> dict:
    """某个月的签到日历：每日状态 + 四项统计。

    month 形如 `2026-10`；非法值抛 ValueError。
    """
    import calendar as _calendar
    from datetime import date, timedelta

    uid = user["id"]
    now = core.now_dt()
    today = date.fromisoformat(core.today_str())
    earliest = today - timedelta(days=MAKEUP_MAX_LOOKBACK_DAYS)

    try:
        year, mon = int(month[:4]), int(month[5:7])
        days_in_month = _calendar.monthrange(year, mon)[1]
    except (ValueError, IndexError) as exc:
        raise ValueError("月份格式应为 YYYY-MM") from exc

    records = core.query(
        "SELECT date, kind, reward FROM checkin_records WHERE user_id=? AND date LIKE ?",
        (uid, f"{month}%"),
    )
    by_date = {r["date"]: r for r in records}

    today_str = today.isoformat()
    days, checked_days = [], 0
    for d in range(1, days_in_month + 1):
        cur = date(year, mon, d)
        key = cur.isoformat()
        rec = by_date.get(key)
        if rec:
            status = "makeup" if _record_kind(rec) == "makeup" else "checked"
            checked_days += 1
        elif cur > today:
            status = "future"
        elif key == today_str:
            status = "today"
        elif cur >= earliest:
            status = "missed"  # 在可补范围内 → 可补
        else:
            status = "out_of_range"
        days.append({
            "date": key,
            "day": d,
            "status": status,
            "reward": int(rec["reward"]) if rec else 0,
            "kind": _record_kind(rec) if rec else "",
        })

    quota = checkin_makeup_quota()
    used = checkin_makeup_used(uid, month)
    today_checked = today_str in by_date

    return {
        "month": month,
        "days": days,
        "checked_days": checked_days,
        "total_days": core.query_one(
            "SELECT COUNT(*) AS n FROM checkin_records WHERE user_id=?", (uid,)
        )["n"],
        "streak": checkin_streak(uid, today_str),
        "makeup_used": used,
        "makeup_quota": quota,
        "makeup_remaining": max(0, quota - used),
        "makeup_cost": checkin_makeup_cost(),
        # 补签的前置条件：必须先完成今日签到
        "today_checked": today_checked,
        "can_makeup": today_checked and (quota - used) > 0,
        "earliest_makeup_date": earliest.isoformat(),
        "today": today_str,
        "server_time": core.iso(now),
    }


def _record_kind(row) -> str:
    return ((row["kind"] if "kind" in row.keys() else "daily") or "daily")


def checkin_payload(user) -> dict:
    records = core.query(
        "SELECT date, kind, reward FROM checkin_records WHERE user_id=? ORDER BY date DESC LIMIT 200",
        (user["id"],),
    )
    today = core.today_str()
    today_record = next((r for r in records if r["date"] == today), None)
    streak = checkin_streak(user["id"], today)
    # 今天已签时 streak 含今天，下一次（明天）就是 streak+1；今天没签时 streak 截至昨天，今天即 streak+1
    next_streak = streak + 1
    preview = checkin_daily_preview(user, next_streak)

    return {
        "balance": user["points_balance"],
        "checked_in_today": today_record is not None,
        # 今日已用哪种签到（daily / gamble）；没签则为空串
        "today_kind": _record_kind(today_record) if today_record else "",
        "total_days": core.query_one(
            "SELECT COUNT(*) AS n FROM checkin_records WHERE user_id=?", (user["id"],)
        )["n"],
        # 连签天数（今天已签=含今天；未签=截至昨天）
        "streak": streak,
        # 每日签到今天/下一次能得多少（已含连签额外与会员倍率）。
        # 注意：与"今天实际签了哪种"无关——今天用赌狗签了也可能是负数，
        # 那是 today_reward 的事，不能混进这里，否则明细会算出「基础8 ×1.5 = -5」这种鬼话。
        "daily_reward": preview["total"],
        # 今天实际拿到的分（未签为 null）
        "today_reward": int(today_record["reward"]) if today_record else None,
        # 下一次（明天）签到的预计收益明细
        "next_reward": preview["total"],
        "base_reward": preview["base"],
        "streak_bonus": preview["streak_bonus"],
        "signin_multiplier": preview["multiplier"],
        "streak_bonus_from_day": STREAK_BONUS_FROM_DAY,
        "streak_bonus_list": checkin_streak_bonus_list(),
        "gamble_rewards": checkin_gamble_rewards(),
        "records": [
            {"date": r["date"], "reward": r["reward"], "kind": _record_kind(r)} for r in records
        ],
    }


@bp.get("/points/check-in")
@core.require_login
def checkin_info():
    user = core.query_one("SELECT * FROM users WHERE id=?", (core.current_user()["id"],))
    return core.ok(checkin_payload(dict(user)))


@bp.post("/points/check-in")
@core.require_login
def checkin_do():
    """两种签到互斥：同一天只能用其中一种。

    互斥由 checkin_records 的 UNIQUE(user_id, date) 保证 —— 这里先查一次只是为了给出友好提示。
    """
    uid = core.current_user()["id"]
    today = core.today_str()
    existing = core.query_one("SELECT * FROM checkin_records WHERE user_id=? AND date=?", (uid, today))
    if existing:
        used = CHECKIN_KIND_TEXT.get(_record_kind(existing), "签到")
        return core.fail(f"今日已用「{used}」签过了")

    body = request.get_json(silent=True) or {}
    kind = str(body.get("kind") or "daily").strip().lower()
    if kind not in CHECKIN_ALLOWED_KINDS:
        return core.fail("签到类型不合法")

    if kind == "daily":
        # 今天签完后的连签天数 = 截至昨天的连签 + 1（今天必未签，前面已校验）
        full_user = core.query_one("SELECT * FROM users WHERE id=?", (uid,))
        streak_after = checkin_streak(uid, today) + 1
        reward = checkin_daily_preview(full_user, streak_after)["total"]
    else:
        # 赌狗签到：所有用户共用同一个池子，不吃会员倍率（等级加成只作用于每日签到）
        reward = random.choice(checkin_gamble_rewards())

    # 赌狗扣分不能把余额扣成负数（add_points 遇负余额会直接抛错，所以先钳制）
    if reward < 0:
        reward = -min(abs(reward), int(core.current_user()["points_balance"]))

    import sqlite3

    try:
        core.insert(
            "checkin_records",
            {"user_id": uid, "date": today, "kind": kind, "reward": reward, "created_time": core.iso()},
        )
    except sqlite3.IntegrityError:
        # 并发下两个请求同时过上面的 SELECT 检查，第二个 INSERT 撞 UNIQUE(user_id, date)
        return core.fail("今日已签过了")
    tx_type = "daily_check_in" if kind == "daily" else "gamble_check_in"
    try:
        balance = core.add_points(uid, reward, tx_type, f"{today} {CHECKIN_KIND_TEXT[kind]}")
    except ValueError as exc:
        # 积分入账失败（理论上已被钳制，兜底）：把刚写入的签到记录回滚，避免"签了没分"
        core.execute("DELETE FROM checkin_records WHERE user_id=? AND date=?", (uid, today))
        return core.fail(str(exc))
    user = core.query_one("SELECT * FROM users WHERE id=?", (uid,))
    payload = checkin_payload(dict(user))
    payload["balance"] = balance
    payload["reward"] = reward
    payload["kind"] = kind
    return core.ok(payload)


@bp.get("/points/check-in/calendar")
@core.require_login
def checkin_calendar_get():
    """签到日历：某月每日状态 + 四项统计（当月已签 / 累计签到 / 连签 / 本月可补签）。"""
    uid = core.current_user()["id"]
    month = (request.args.get("month") or core.today_str()[:7]).strip()
    user = core.query_one("SELECT * FROM users WHERE id=?", (uid,))
    try:
        return core.ok(checkin_calendar(dict(user), month))
    except ValueError as exc:
        return core.fail(str(exc))


@bp.post("/points/check-in/makeup")
@core.require_login
def checkin_makeup():
    """补签某一天。

    规则：
      1. 必须先完成**今日签到**
      2. 只能补今天之前、**最近 31 天内**的漏签日期
      3. **每月固定 4 次**（按补签操作时间所在自然月统计）
      4. 消耗固定积分；**不给该日签到奖励**（只补记录、保住连签连续性）——否则等于花小钱刷分
    """
    from datetime import date

    uid = core.current_user()["id"]
    today = core.today_str()
    body = request.get_json(silent=True) or {}
    target = str(body.get("date") or "").strip()

    # 1) 前置条件：今日已签
    if not core.query_one("SELECT 1 FROM checkin_records WHERE user_id=? AND date=?", (uid, today)):
        return core.fail("请先完成今日签到，再来补签")

    # 2) 日期合法性
    try:
        target_date = date.fromisoformat(target)
    except ValueError:
        return core.fail("日期格式应为 YYYY-MM-DD")
    today_date = date.fromisoformat(today)
    if target_date >= today_date:
        return core.fail("只能补今天之前的日期")
    if (today_date - target_date).days > MAKEUP_MAX_LOOKBACK_DAYS:
        return core.fail(f"只能补最近 {MAKEUP_MAX_LOOKBACK_DAYS} 天内的漏签")

    # 3) 该日不能已有记录
    if core.query_one("SELECT 1 FROM checkin_records WHERE user_id=? AND date=?", (uid, target)):
        return core.fail("该日已有签到记录，无需补签")

    # 4) 本月配额
    quota = checkin_makeup_quota()
    used = checkin_makeup_used(uid)
    if used >= quota:
        return core.fail(f"本月补签次数已用完（{used}/{quota}）")

    # 5) 扣分
    cost = checkin_makeup_cost()
    balance = int(core.current_user()["points_balance"])
    if cost > 0 and balance < cost:
        return core.fail(f"积分不足，补签需要 {cost} 分")

    import sqlite3

    try:
        core.insert(
            "checkin_records",
            {"user_id": uid, "date": target, "kind": "makeup", "reward": 0, "created_time": core.iso()},
        )
    except sqlite3.IntegrityError:
        return core.fail("该日已有签到记录，无需补签")

    if cost > 0:
        try:
            balance = core.add_points(uid, -cost, "makeup_check_in", f"补签 {target}")
        except ValueError as exc:
            # 扣分失败就把刚写的记录回滚，避免"补了没扣钱"
            core.execute("DELETE FROM checkin_records WHERE user_id=? AND date=?", (uid, target))
            return core.fail(str(exc))

    return core.ok({
        "date": target,
        "cost": cost,
        "balance": balance,
        "streak": checkin_streak(uid, today),
        "makeup_used": used + 1,
        "makeup_remaining": max(0, quota - used - 1),
        "total_days": core.query_one(
            "SELECT COUNT(*) AS n FROM checkin_records WHERE user_id=?", (uid,)
        )["n"],
    })


# ------------------------------------------------------------ 转盘


def lottery_payload(uid: int) -> dict:
    prizes = [dict(r) for r in core.query("SELECT * FROM lottery_prizes ORDER BY sort_order, id")]
    cost = int(core.get_setting("lottery_cost", "200") or 0)
    limit = int(core.get_setting("lottery_daily_limit", "30") or 0)
    today_draws = core.query_one(
        "SELECT COUNT(*) AS n FROM lottery_records WHERE user_id=? AND created_time LIKE ?",
        (uid, core.today_str() + "%"),
    )["n"]
    used_bps = sum(int(p["probability_bps"]) for p in prizes)
    records = core.query(
        "SELECT * FROM lottery_records WHERE user_id=? ORDER BY id DESC LIMIT 20", (uid,)
    )
    user = core.query_one("SELECT points_balance FROM users WHERE id=?", (uid,))
    return {
        "prizes": prizes,
        "balance": user["points_balance"],
        "cost_points": cost,
        "daily_limit": limit,
        "remaining_times": max(0, limit - today_draws),
        "no_prize_probability_bps": max(0, 10000 - used_bps),
        "records": [
            {"name": r["prize_name"], "reward_points": r["reward_points"], "created_time": r["created_time"]}
            for r in records
        ],
        "enabled": True,
        "open": True,
    }


@bp.get("/points/lottery")
@core.require_login
def lottery_info():
    return core.ok(lottery_payload(core.current_user()["id"]))


@bp.post("/points/lottery/draw")
@core.require_login
def lottery_draw():
    uid = core.current_user()["id"]
    data = lottery_payload(uid)
    if data["remaining_times"] <= 0:
        return core.fail("今日次数已用完")
    cost = data["cost_points"]
    if data["balance"] < cost:
        return core.fail("积分不足")

    prizes = data["prizes"]
    roll = random.randint(1, 10000)
    acc = 0
    hit = None
    for prize in prizes:
        acc += int(prize["probability_bps"])
        if roll <= acc:
            hit = prize
            break
    if int(data["no_prize_probability_bps"]) and hit is None:
        hit = None  # 落到未中奖区间

    # 扣费 / 中奖入账 / 写记录必须同一事务：任何一步失败整体回滚，
    # 避免出现"扣了钱没记录"或"中了奖没加钱"的中间态。
    db = core.get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        balance = core._apply_points(uid, -cost, "lottery_cost", "积分转盘消耗")
        prize_name = "未中奖"
        reward = 0
        if hit:
            prize_name = hit["name"]
            reward = int(hit["reward_points"])
            if reward > 0:
                balance = core._apply_points(uid, reward, "lottery_reward", f"转盘中奖 {prize_name}")
        core.insert(
            "lottery_records",
            {
                "user_id": uid,
                "prize_name": prize_name,
                "reward_points": reward,
                "cost_points": cost,
                "created_time": core.iso(),
            },
        )
        db.execute("COMMIT")
    except ValueError as exc:
        db.execute("ROLLBACK")
        return core.fail(str(exc))
    except Exception:
        db.execute("ROLLBACK")
        return core.fail("抽奖失败，请重试")
    return core.ok({"prize": {"name": prize_name, "reward_points": reward}, "balance": balance})


# ------------------------------------------------------------ 邀请 / 公告


@bp.get("/invite/stats")
@core.require_login
def invite_stats():
    total = core.query_one(
        "SELECT COUNT(*) AS n FROM users WHERE inviter_id=?", (core.current_user()["id"],)
    )["n"]
    return core.ok({"total": total})


@bp.get("/my/xiaocan-history")
@core.require_login
def my_xiaocan_history():
    """我的报名/抢兑记录（合并时间线，最多各 50 条）。

    - 报名：signup_records（每次「立即报名」一条，含结果回传）
    - 抢兑：redeem_settings（每个账号当前的开抢配置，只有开关没有逐次记录）
    """
    uid = core.current_user()["id"]
    try:
        import runner_dispatch
        runner_dispatch.reap_zombie_tasks()
    except Exception as exc:
        pass

    signups = core.query(
        "SELECT s.*, a.nickname AS account_nickname, a.account_info "
        "FROM signup_records s LEFT JOIN accounts a ON a.id=s.account_id "
        "WHERE s.user_id=? ORDER BY s.id DESC LIMIT 50",
        (uid,),
    )
    signup_events = [{
        "kind": "signup",
        "id": row["id"],
        "account_id": row["account_id"],
        "account_nickname": row["account_nickname"] or f"账号#{row['account_id']}",
        "tea_name": row["tea_name"],
        "order_numbers": row["order_numbers"],
        "status": row["status"],
        "output": row["output"],
        "error": row["error"],
        "created_time": row["created_time"],
        "finished_time": row["finished_time"],
    } for row in signups]

    redeems = core.query(
        "SELECT r.*, a.nickname AS account_nickname, p.name AS prize_name, p.yuanbao_cost, "
        "p.start_at AS prize_start_at, p.end_at AS prize_end_at "
        "FROM redeem_settings r "
        "JOIN accounts a ON a.id=r.account_id "
        "LEFT JOIN redeem_prizes p ON p.account_id=r.account_id AND p.exchange_id=r.exchange_id "
        "WHERE a.user_id=? ORDER BY r.updated_time DESC LIMIT 50",
        (uid,),
    )
    redeem_events = [{
        "kind": "redeem",
        "id": row["account_id"],
        "account_id": row["account_id"],
        "account_nickname": row["account_nickname"] or f"账号#{row['account_id']}",
        "exchange_id": row["exchange_id"],
        "prize_name": row["prize_name"],
        "yuanbao_cost": row["yuanbao_cost"],
        "enabled": int(row["enabled"] or 0) == 1,
        "runner_ready": int(row["runner_ready"] or 0) == 1,
        "start_at": row["start_at"],
        "updated_time": row["updated_time"],
    } for row in redeems]

    # 合并排序：报名按创建时间、抢兑按最近更新时间，新→旧
    merged = sorted(
        [*signup_events, *redeem_events],
        key=lambda e: (e.get("created_time") or e.get("updated_time") or ""),
        reverse=True,
    )
    return core.ok({"records": merged[:80], "signup_total": len(signup_events), "redeem_total": len(redeem_events)})


@bp.get("/announcements/latest")
def announcement_latest():
    """
    用户端公告：取「最近有动静」的那一条（发布或修订都算）。

    历史实现是 `ORDER BY version DESC`，但 version 是**每条公告各自的修订次数**，
    拿它做全局排序会出事：只要库里留过一条 v2 的旧公告，管理员新发的 v1 公告
    就永远被压在下面（用户端看不到新公告）。改成按活动时间排序后，
    「发新公告」和「改老公告」都会立刻成为用户端看到的那一条，
    与原始站点「改了公告就重新提示」的语义一致。
    时间戳统一由 core.iso() 产出（+08:00 固定偏移），字符串比较即时间序。
    """
    row = core.query_one(
        "SELECT * FROM announcements "
        "ORDER BY COALESCE(updated_time, published_time) DESC, id DESC LIMIT 1"
    )
    if not row:
        return core.ok(None)
    return core.ok(
        {
            "id": row["id"],
            "title": row["title"],
            "content": row["content"],
            "version": row["version"],
            "published_time": row["published_time"],
            "updated_time": row["updated_time"] or row["published_time"],
        }
    )


# ------------------------------------------------------------ 小蚕账号


@bp.get("/xiaocan/accounts")
@core.require_login
def list_accounts():
    rows = core.query("SELECT * FROM accounts WHERE user_id=? ORDER BY id", (core.current_user()["id"],))
    return core.ok([xc.serialize_account(dict(r)) for r in rows])


def _own_account(account_id: int) -> dict:
    """取账号；管理员可跨用户操作任意账号（与原站后台行为一致）。"""
    user = core.current_user()
    if user.get("role") == "admin":
        row = core.query_one("SELECT * FROM accounts WHERE id=?", (account_id,))
    else:
        row = core.query_one(
            "SELECT * FROM accounts WHERE id=? AND user_id=?", (account_id, user["id"])
        )
    if not row:
        return {}
    return dict(row)


@bp.put("/xiaocan/accounts/<int:account_id>/features/<path:name>")
@core.require_login
def toggle_feature(account_id: int, name: str):
    account = _own_account(account_id)
    if not account:
        return core.fail("账号不存在")
    if account["status"] != "enabled" or not account["membership_expire"]:
        return core.fail("该账号未激活抢券权益")
    value = xc.toggle_feature(account_id, name)
    return core.ok({"value": value})


@bp.delete("/xiaocan/accounts/<int:account_id>")
@core.require_login
def delete_account(account_id: int):
    account = _own_account(account_id)
    if not account:
        return core.fail("账号不存在")
    core.execute("DELETE FROM accounts WHERE id=?", (account_id,))
    core.execute("DELETE FROM account_features WHERE account_id=?", (account_id,))
    core.execute("DELETE FROM redeem_settings WHERE account_id=?", (account_id,))
    core.execute(
        "UPDATE users SET slot_used=(SELECT COUNT(*) FROM accounts WHERE user_id=?) WHERE id=?",
        (core.current_user()["id"], core.current_user()["id"]),
    )
    return core.ok({})


def _my_account_ids() -> list[int] | None:
    """当前用户可见的账号范围；管理员返回 None 表示全部。"""
    user = core.current_user()
    if user.get("role") == "admin":
        return None
    rows = core.query("SELECT id FROM accounts WHERE user_id=?", (user["id"],))
    return [r["id"] for r in rows]


# ---------------------------------------------------------------- 美团账号

def _meituan_scope():
    return _my_account_ids()


@bp.post("/xiaocan/meituan/auth/start")
@core.require_login
def meituan_auth_start():
    """发起美团扫码授权，返回二维码（data URL）与会话 ID。"""
    body = request.get_json(silent=True) or {}
    account_id = body.get("account_id")
    account_id = int(account_id) if account_id else None
    if account_id is not None:
        if not _own_account(account_id):
            return core.fail("账号不存在")
    try:
        session = meituan_runner.start_session(account_id)
    except Exception as exc:
        return core.fail(f"发起美团扫码失败：{exc}")
    return core.ok(session)


@bp.get("/xiaocan/meituan/auth/poll")
@core.require_login
def meituan_auth_poll():
    session_id = (request.args.get("session_id") or "").strip()
    if not session_id:
        return core.fail("缺少 session_id")
    try:
        return core.ok(meituan_runner.session_status(session_id))
    except ValueError as exc:
        return core.fail(str(exc))


@bp.post("/xiaocan/meituan/auth/cancel")
@core.require_login
def meituan_auth_cancel():
    body = request.get_json(silent=True) or {}
    ok = meituan_runner.cancel_session((body.get("session_id") or "").strip())
    return core.ok({"cancelled": ok})


@bp.get("/xiaocan/meituan/accounts")
@core.require_login
def meituan_accounts_list():
    return core.ok({"accounts": meituan_runner.list_accounts(_meituan_scope()),
                    "runtime_ready": meituan_runner.available()})


@bp.post("/xiaocan/meituan/accounts")
@core.require_login
def meituan_accounts_save():
    """手工录入美团凭证（已有 token 时不必扫码）。"""
    body = request.get_json(silent=True) or {}
    token = str(body.get("token") or "").strip()
    account_id = body.get("account_id")
    if account_id is not None and not _own_account(int(account_id)):
        return core.fail("账号不存在")
    try:
        saved = meituan_runner.save_account(
            token, account_id=int(account_id) if account_id else None,
            nickname=str(body.get("nickname") or ""))
    except ValueError as exc:
        return core.fail(str(exc))
    return core.ok({**{k: v for k, v in saved.items() if k != "token"},
                    "token_mask": meituan_runner.mask(saved["token"])})


@bp.delete("/xiaocan/meituan/accounts/<int:record_id>")
@core.require_login
def meituan_accounts_delete(record_id: int):
    if not meituan_runner.delete_account(record_id, _meituan_scope()):
        return core.fail("记录不存在")
    return core.ok({"deleted": record_id})


@bp.post("/xiaocan/meituan/claim")
@core.require_login
def meituan_claim():
    """用已登录的美团凭证领福利社券。"""
    body = request.get_json(silent=True) or {}
    record_id = body.get("record_id")
    try:
        result = meituan_runner.claim(int(record_id) if record_id else None)
    except ValueError as exc:
        return core.fail(str(exc))
    except Exception as exc:
        return core.fail(f"领券失败：{exc}")
    xiaocan_stats.record_job(None, "meituan_claim", "success" if result.get("ok") else "failed",
                             str(result.get("message") or "")[:200])
    return core.ok(result)


@bp.get("/xiaocan/actions")
@core.require_login
def xiaocan_actions_catalog():
    """可用的小蚕动作及参数说明（前端据此渲染表单，不用硬编码清单）。"""
    items = []
    for key in xiaocan_extras.available():
        spec = xiaocan_extras.PARAMS[key]
        items.append({
            "key": key,
            "params": [
                {"name": name, "required": required, "default": default,
                 "type": "int" if cast is int else "str"}
                for name, (cast, default, required) in spec.items()
            ],
        })
    return core.ok({"actions": items})


@bp.post("/xiaocan/accounts/<int:account_id>/call")
@core.require_login
def xiaocan_call_api(account_id: int):
    """执行一个允许清单内的小蚕动作。"""
    account = _own_account(account_id)
    if not account:
        return core.fail("账号不存在")
    body = request.get_json(silent=True) or {}
    action = str(body.get("action") or "").strip()
    params = body.get("params") or {}
    if not isinstance(params, dict):
        return core.fail("params 必须是对象")
    try:
        data = xiaocan_extras.run(account, action, params)
    except ValueError as exc:
        return core.fail(str(exc))
    except Exception as exc:
        return core.fail(f"{action} 执行失败：{exc}")
    if action in WRITE_ACTIONS:
        xiaocan_stats.record_job(account_id, action, "success", "执行成功")
    return core.ok(data)


# 会改变账号状态的动作：成功后记一条运行日志，便于回溯
WRITE_ACTIONS = {
    "collect_points", "user_claim_points", "do_lottery_spin", "receive_extra_lottery",
    "claim_ad_lottery_chance", "join_redpack_rain", "grab_redpack_rain", "client_withdraw",
    "cancel_promotion_quota", "grab_brand_card", "grab_free_order_quota", "use_free_order_card",
    "grab_rebate_card_quota", "exchange_goods", "draw_page_gift", "set_all_messages_read",
}


@bp.post("/xiaocan/accounts/<int:account_id>/grab")
@core.require_login
def schedule_grab_api(account_id: int):
    """所有者发起抢单或预约（立即 / 到点）。"""
    import grab_engine
    account = _own_account(account_id)
    if not account:
        return core.fail("账号不存在")
    body = request.get_json(silent=True) or {}
    promotion_id = str(body.get("promotion_id") or "").strip()
    if not promotion_id:
        return core.fail("请填写活动 ID")
    at_ts = None
    at_raw = body.get("at")
    if at_raw not in (None, ""):
        try:
            at_ts = float(at_raw)
        except (TypeError, ValueError):
            parsed = core.parse_iso(str(at_raw))
            if not parsed:
                return core.fail("时间格式不正确")
            at_ts = parsed.timestamp()
    try:
        job = grab_engine.schedule(
            account_id, promotion_id, at_ts=at_ts, advance=bool(body.get("advance")),
            lat=body.get("lat"), lon=body.get("lon"), city_code=body.get("city_code"),
            store_platform=int(body.get("store_platform") or 1),
        )
    except ValueError as exc:
        return core.fail(str(exc))
    xiaocan_stats.record_job(account_id, "grab", "scheduled",
                             f"活动 {promotion_id} 计划于 {job['at']}")
    return core.ok(job)


@bp.get("/xiaocan/stats")
@core.require_login
def xiaocan_stats_api():
    """累计到账 / 在途待入账 / 今日已省。"""
    return core.ok(xiaocan_stats.stats(_my_account_ids()))


@bp.get("/xiaocan/chart-data")
@core.require_login
def xiaocan_chart_api():
    """近 7 天返现趋势 + 状态/平台分布 + 今日汇总。"""
    return core.ok(xiaocan_stats.chart_data(_my_account_ids()))


@bp.get("/xiaocan/job-logs")
@core.require_login
def xiaocan_job_logs_api():
    limit = int(request.args.get("limit", 50) or 50)
    return core.ok({"jobs": xiaocan_stats.list_jobs(_my_account_ids(), limit)})


@bp.delete("/xiaocan/job-logs")
@core.require_login
def xiaocan_job_logs_clear_api():
    return core.ok({"cleared": xiaocan_stats.clear_jobs(_my_account_ids())})


@bp.get("/xiaocan/scheduler")
@core.require_login
def xiaocan_scheduler_api():
    """调度中心视图：抢单任务（进程内）+ 等级刷新线程状态。"""
    import grab_engine
    scope = _my_account_ids()
    jobs = grab_engine.list_jobs()
    if scope is not None:
        jobs = [job for job in jobs if job["account_id"] in scope]
    return core.ok({
        "grab_jobs": jobs,
        "level_refresh": core.get_setting("level_refresh_enabled", "true") == "true",
    })


@bp.get("/xiaocan/time")
@core.require_login
def xiaocan_time_api():
    """授时状态：SNTP 校准后的时间与偏差；UDP 123 不通时自动降级 HTTP 授时。

    `?force=1` 绕过 120 秒缓存强制重新校准（比如抢单前手动校一次）。
    """
    force = request.args.get("force") in ("1", "true", "yes")
    return core.ok(time_service.status(force=force))


def _store_args() -> dict:
    """店铺类接口的公共查询参数（定位来自请求，不落库）。"""
    args = request.args
    return {
        "lat": args.get("lat"),
        "lon": args.get("lon"),
        "offset": args.get("offset", 0),
        "limit": args.get("limit", 20),
        "city_code": args.get("city_code"),
    }


def _store_reply(fn) -> object:
    try:
        return core.ok(fn())
    except ValueError as exc:
        return core.fail(str(exc))
    except Exception as exc:
        return core.fail(f"拉取店铺失败：{exc}")


@bp.get("/xiaocan/accounts/<int:account_id>/stores/feed")
@core.require_login
def store_feed_api(account_id: int):
    """附近外卖霸王餐店铺（推荐流；主源空则自动回落备源）。"""
    account = _own_account(account_id)
    if not account:
        return core.fail("账号不存在")
    args = _store_args()
    return _store_reply(lambda: xiaocan_actions.feed_stores(
        account, sort=int(request.args.get("sort", 0) or 0), **args))


@bp.get("/xiaocan/accounts/<int:account_id>/stores/search")
@core.require_login
def store_search_api(account_id: int):
    """按关键词搜店。"""
    account = _own_account(account_id)
    if not account:
        return core.fail("账号不存在")
    args = _store_args()
    return _store_reply(lambda: xiaocan_actions.search_stores(
        account, request.args.get("q", ""), **args))


@bp.get("/xiaocan/accounts/<int:account_id>/stores/explore")
@core.require_login
def store_explore_api(account_id: int):
    """到店/探店团购霸王餐清单。"""
    account = _own_account(account_id)
    if not account:
        return core.fail("账号不存在")
    args = _store_args()
    return _store_reply(lambda: xiaocan_actions.explore_stores(account, **args))


@bp.post("/xiaocan/accounts/<int:account_id>/daily")
@core.require_login
def run_own_daily_api(account_id: int):
    """账号所有者执行一次日常：元宝签到 → 会员签到抽奖 → 任务总览。

    逐条返回结果；单步失败或「已签到」不会中断其它步骤。
    """
    account = _own_account(account_id)
    if not account:
        return core.fail("账号不存在")
    result = xiaocan_actions.run_daily(account)
    xiaocan_stats.record_job(account_id, "daily", "success" if result["ok"] else "failed",
                             f"失败 {result['failed']} 步，跳过 {result['skipped']} 步")
    return core.ok(result)


@bp.post("/xiaocan/accounts/<int:account_id>/refresh-level")
@core.require_login
def refresh_account_level_api(account_id: int):
    """查一次小蚕平台，刷新该账号的**真实 SVIP 等级**。

    账号等级是小蚕平台上的属性，本站只是镜像；所以只在平台应答成功后才落库，
    查询失败不会把已有等级抹掉。
    """
    account = _own_account(account_id)
    if not account:
        return core.fail("账号不存在")
    try:
        result = xc.refresh_account_level(account_id, core.current_user()["id"])
    except ValueError as exc:
        return core.fail(str(exc))
    except Exception as exc:
        return core.fail(f"查询小蚕等级失败：{exc}")
    return core.ok(result)


@bp.post("/xiaocan/accounts/<int:account_id>/signup")
@core.require_login
def account_signup(account_id: int):
    account = _own_account(account_id)
    if not account:
        return core.fail("账号不存在")
    if not account["membership_expire"]:
        return core.fail("该账号未激活抢券权益")
    body = request.get_json(silent=True) or {}
    tea_name = (body.get("tea_name") or "").strip()
    order_numbers = (body.get("order_numbers") or "").strip()
    if not tea_name or not order_numbers:
        return core.fail("请填写奶茶名称和订单号")
    result = xc.submit_signup(core.current_user()["id"], account, tea_name, order_numbers)
    return core.ok({"status": result["status"], "id": result.get("id"), "error": result.get("error", "")})


# ------------------------------------------------------------ 绑定


@bp.post("/xiaocan/bind")
@core.require_login
def xiaocan_bind():
    """手动绑定：粘贴「备注#小蚕UserId#silk_id#token」，多账号 @ 分隔。"""
    body = request.get_json(silent=True) or {}
    raw = body.get("data") or body.get("line") or ""
    account_id = body.get("account_id")
    try:
        result = xc.bind_from_lines(core.current_user()["id"], raw, int(account_id) if account_id else None)
    except ValueError as exc:
        return core.fail(str(exc))
    return core.ok(result)


@bp.post("/xiaocan/qrcode")
@core.require_login
def xiaocan_qrcode():
    body = request.get_json(silent=True) or {}
    account_id = body.get("account_id")
    try:
        data = xc.start_qr_session(core.current_user()["id"], int(account_id) if account_id else None)
    except Exception as exc:
        return core.fail(str(exc))
    return core.ok(data)


@bp.get("/xiaocan/qrcode/status")
@core.require_login
def xiaocan_qrcode_status():
    session_id = request.args.get("session_id", "")
    return core.ok(xc.qr_status(session_id))


def _image_mime(data: bytes) -> str:
    """按魔数判断图片类型：微信二维码直出的是 JPEG，硬写 png 会让前端 data URL 类型不符。"""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


@bp.get("/xiaocan/qrcode/img/<session_id>")
def xiaocan_qrcode_img(session_id: str):
    try:
        image = xc.qr_image_bytes(session_id)
    except Exception:
        return core.not_found()
    return Response(image, mimetype=_image_mime(image), headers={"Cache-Control": "no-cache"})


# ------------------------------------------------------------ 抢兑


@bp.get("/xiaocan/accounts/<int:account_id>/redeem-prizes")
@core.require_login
def redeem_prizes(account_id: int):
    if not _own_account(account_id):
        return core.fail("账号不存在")
    rows = core.query(
        "SELECT * FROM redeem_prizes WHERE account_id=? ORDER BY start_at, exchange_id", (account_id,)
    )
    return core.ok(
        [
            {
                "exchange_id": r["exchange_id"],
                "name": r["name"],
                "yuanbao_cost": r["yuanbao_cost"],
                "group": r["group_name"],
                "start_at": r["start_at"],
                "end_at": r["end_at"],
                "available": bool(r["available"]),
                "upcoming": bool(r["upcoming"]),
            }
            for r in rows
        ]
    )


@bp.put("/xiaocan/accounts/<int:account_id>/redeem")
@core.require_login
def save_redeem(account_id: int):
    account = _own_account(account_id)
    if not account:
        return core.fail("账号不存在")
    body = request.get_json(silent=True) or {}
    enabled = bool(body.get("enabled"))
    exchange_id = body.get("exchange_id")
    start_at = body.get("start_at")

    if enabled:
        if not exchange_id:
            return core.fail("请选择可抢兑奖品")
        row = core.query_one(
            "SELECT * FROM redeem_prizes WHERE account_id=? AND exchange_id=?", (account_id, exchange_id)
        )
        if not row or not row["available"]:
            return core.fail("请选择可抢兑奖品")
        start_at = row["start_at"]

    core.execute(
        "INSERT INTO redeem_settings (account_id, exchange_id, start_at, enabled, runner_ready, updated_time) "
        "VALUES (?,?,?,?,1,?) ON CONFLICT(account_id) DO UPDATE SET exchange_id=excluded.exchange_id, "
        "start_at=excluded.start_at, enabled=excluded.enabled, updated_time=excluded.updated_time",
        (account_id, exchange_id, start_at, 1 if enabled else 0, core.iso()),
    )
    if enabled:
        result = runner_dispatch.dispatch_redeem(account)
        if not result.get("ok"):
            core.execute("UPDATE redeem_settings SET runner_ready=0 WHERE account_id=?", (account_id,))
            return core.ok({**xc.redeem_of(account_id), "warning": result.get("error")})
        core.execute("UPDATE redeem_settings SET runner_ready=1 WHERE account_id=?", (account_id,))
    return core.ok(xc.redeem_of(account_id))


# ------------------------------------------------------------ 站内信


@bp.get("/my/notifications")
@core.require_login
def my_notifications():
    """读取当前用户的站内信通知列表。"""
    user = core.current_user()
    page = core.arg_int("page", 1, 1, 100000)
    size = core.arg_int("size", 20, 1, 100)
    total = core.query_one(
        "SELECT COUNT(*) AS n FROM user_notifications WHERE user_id=?", (user["id"],)
    )["n"]
    unread = core.query_one(
        "SELECT COUNT(*) AS n FROM user_notifications WHERE user_id=? AND is_read=0", (user["id"],)
    )["n"]
    rows = core.query(
        "SELECT id, title, content, type, is_read, created_time FROM user_notifications "
        "WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?",
        (user["id"], size, (page - 1) * size),
    )
    return core.ok({
        "records": [dict(r) for r in rows],
        "total": total,
        "unread": unread,
        "page": page,
        "size": size,
    })


@bp.put("/my/notifications/<int:nid>/read")
@core.require_login
def my_notification_read(nid: int):
    """标记单条站内信为已读。"""
    user = core.current_user()
    core.execute(
        "UPDATE user_notifications SET is_read=1 WHERE id=? AND user_id=?",
        (nid, user["id"]),
    )
    return core.ok({"read": True})


@bp.put("/my/notifications/read-all")
@core.require_login
def my_notifications_read_all():
    """一键标记全部站内信为已读。"""
    user = core.current_user()
    core.execute(
        "UPDATE user_notifications SET is_read=1 WHERE user_id=? AND is_read=0",
        (user["id"],),
    )
    return core.ok({"read_all": True})
