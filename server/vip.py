"""会员等级体系（VIP）—— **唯一事实来源**。

三档：VIP0 普通 / VIP1 高级 / VIP2 至尊。

设计要点：
  · 等级有效期由 `users.vip_expire` 决定，**过期即回落 VIP0**（所有读取都走 current_level）
  · **车位赠送不落库**，由等级实时计算（降级自动回收，不产生脏数据）
  · 与「账号会员期」（`accounts.membership_expire`）职责分开：
      账号会员期管「哪个号能跑」，VIP 等级管「能绑几个号、花多少钱、有多少加成」

改动本文件即可调整全部权益数值，前端后台展示也读这里。
"""
from __future__ import annotations

from datetime import datetime

import core

# 最高等级（越界时收敛到这个值）
MAX_LEVEL = 2

# 等级配置表：改数值只改这里
#   slots        赠送车位数
#   pay_bps      实付比例（10000 = 原价，9500 = 95 折，9000 = 90 折）
#   signin_mult  签到收益倍率
#   referral_bps 邀请返利比例（800 = 8%）
VIP_TABLE = {
    0: {
        "key": "normal",
        "name": "普通会员",
        "slots": 0,
        "pay_bps": 10000,
        "signin_mult": 1.0,
        "referral_bps": 800,
    },
    1: {
        "key": "senior",
        "name": "高级会员",
        "slots": 3,
        "pay_bps": 9500,
        "signin_mult": 1.25,
        "referral_bps": 1200,
    },
    2: {
        "key": "supreme",
        "name": "至尊会员",
        "slots": 10,
        "pay_bps": 9000,
        "signin_mult": 1.5,
        "referral_bps": 1800,
    },
}

# 购买「会员天数」商品时，按天数决定授予的等级（不依赖商品名，改名字也不会失效）
LEVEL_BY_DAYS = (
    (365, 2),  # 年卡 / 永久卡
    (7, 1),    # 周卡 / 月卡 / 季卡
)


def _field(user, key, default=None):
    """兼容 dict 与 sqlite3.Row。"""
    if user is None:
        return default
    try:
        value = user[key]
    except (KeyError, IndexError, TypeError):
        return default
    return default if value is None else value


def table(level: int) -> dict:
    """取某等级的配置；越界收敛到 [0, MAX_LEVEL]。"""
    return VIP_TABLE[max(0, min(int(level or 0), MAX_LEVEL))]


def current_level(user) -> int:
    """用户**当前生效**的等级；未设置或已过期返回 0。

    所有需要判断等级的地方都必须走这里，避免各处各写一遍过期判断。
    """
    level = int(_field(user, "vip_level", 0) or 0)
    if level <= 0:
        return 0
    expire = core.parse_iso(_field(user, "vip_expire"))
    if expire is not None and expire < core.now_dt():
        return 0
    return max(0, min(level, MAX_LEVEL))


def slot_bonus(user) -> int:
    """等级赠送的车位数（不落库）。"""
    return int(table(current_level(user))["slots"])


def effective_slots(user) -> int:
    """生效车位容量 = 花钱买的 + 等级赠送的。

    降级只回收赠送部分，用户买的车位不受影响。
    """
    purchased = int(_field(user, "slot_total", 0) or 0)
    return purchased + slot_bonus(user)


def pay_ratio_bps(user) -> int:
    """实付比例（用于会员期 / 项目提交打折）。"""
    return int(table(current_level(user))["pay_bps"])


def apply_discount(points: int, user) -> int:
    """按等级给积分价打折，四舍五入到整数分。"""
    price = max(0, int(points or 0))
    return (price * pay_ratio_bps(user) + 5000) // 10000


def signin_multiplier(user) -> float:
    """签到收益倍率。"""
    return float(table(current_level(user))["signin_mult"])


def referral_bps(user) -> int:
    """邀请返利比例（bps）。"""
    return int(table(current_level(user))["referral_bps"])


def level_for_membership_days(days: int) -> int:
    """按购买的天数决定授予哪个等级（0 = 不授级）。"""
    d = int(days or 0)
    for threshold, level in LEVEL_BY_DAYS:
        if d >= threshold:
            return level
    return 0


def extend_expire(current_expire: str | None, days: int) -> str:
    """在现有到期时间上顺延；已过期或为空则从今天算。"""
    from datetime import timedelta

    base = core.parse_iso(current_expire)
    now = core.now_dt()
    start = base if (base and base > now) else now
    return core.iso(start + timedelta(days=int(days or 0)), ms=False)


def benefits_snapshot() -> list[dict]:
    """给后台展示的权益明细（含每个等级的全部数值）。"""
    out = []
    for level in range(0, MAX_LEVEL + 1):
        cfg = table(level)
        discount_label = (
            "无折扣" if cfg["pay_bps"] >= 10000 else f"实付 {cfg['pay_bps'] / 100:g}%"
        )
        out.append(
            {
                "level": level,
                "name": cfg["name"],
                "slots": cfg["slots"],
                "discount_label": discount_label,
                "signin_mult": cfg["signin_mult"],
                "signin_bonus_label": (
                    "无加成" if cfg["signin_mult"] <= 1.0 else f"+{round((cfg['signin_mult'] - 1) * 100)}%"
                ),
                "referral_bps": cfg["referral_bps"],
                "referral_label": f"{cfg['referral_bps'] / 100:.0f}%",
            }
        )
    return out


def remaining_days(user) -> int | None:
    """等级剩余天数；永久（无到期时间）返回 None。"""
    expire = core.parse_iso(_field(user, "vip_expire"))
    if expire is None:
        return None
    delta = expire - core.now_dt()
    return max(0, delta.days + (1 if delta.seconds else 0))
