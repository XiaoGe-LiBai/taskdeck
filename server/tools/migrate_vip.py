"""会员体系数据迁移（幂等，可重复跑）。

把落库的旧口径调到新口径。**只改「仍是旧值」的项**——管理员手动改过的会被跳过，
避免每次启动/重跑把自定义配置冲掉。

用法：
    cd server
    python3 tools/migrate_vip.py --dry-run   # 只看会改什么，不动数据
    python3 tools/migrate_vip.py             # 实际执行

覆盖内容：
  P3 签到口径
    · checkin_daily_reward     10 → 8
    · checkin_rewards          补上 5,7,11,13,15（连签额外，第 6 天起生效）
    · checkin_gamble_rewards   旧池 → 统一池 -25,-13,-6,0,6,13,25
  P5 等级口径
    · 存量 VIP 等级（>2 的旧档位）按规则收敛到 3 档
    · 买过会员天数但没等级的，按名下账号最长剩余会员期折算
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import core  # noqa: E402
import vip  # noqa: E402

# (设置键, 视为「旧值」的集合, 新值, 说明)
SETTING_MIGRATIONS = [
    ("checkin_daily_reward", {"10"}, "8", "每日签到基础奖励（分）"),
    ("checkin_rewards", {"", "5,7,11,13,15"}, "5,7,11,13,15", "连签额外加成（第 6 天起）"),
    (
        "checkin_gamble_rewards",
        {"-20,-10,-5,0,5,10,20"},
        "-25,-13,-6,0,6,13,25",
        "赌狗签到池（所有用户共用）",
    ),
]


def migrate_settings(dry_run: bool) -> int:
    changed = 0
    print("== 设置项 ==")
    for key, old_values, new_value, label in SETTING_MIGRATIONS:
        current = core.get_setting(key, "")
        if current == new_value:
            print(f"  · {label:<28} 已是新值（{new_value}），跳过")
            continue
        if current not in old_values:
            print(f"  · {label:<28} 当前 {current!r} 非旧值（可能被手动改过），**跳过不覆盖**")
            continue
        print(f"  · {label:<28} {current!r} → {new_value!r}")
        if not dry_run:
            core.set_setting(key, new_value)
        changed += 1
    return changed


def migrate_levels(dry_run: bool) -> int:
    """把存量等级收敛到 3 档，并给「买过会员但没等级」的用户补等级。"""
    rows = core.query("SELECT * FROM users ORDER BY id")
    changed = 0
    print()
    print("== 用户等级 ==")
    for row in rows:
        u = dict(row)
        uid = u["id"]
        raw = int(u["vip_level"] or 0)
        eff = vip.current_level(u)
        target = None
        reason = ""

        if raw > 0 and eff == 0:
            # 已过期：清成 0，避免库里留一个无效等级（先判这条，否则会被下面的"收敛"抢先）
            target = 0
            reason = f"VIP{raw} 已过期 → 归零"
        elif raw > vip.MAX_LEVEL:
            # 旧档位 3-5 → 收敛到最高档，保留其到期时间
            target = vip.MAX_LEVEL
            reason = f"旧档位 VIP{raw} → VIP{target}"

        if target is not None and target != raw:
            print(f"  · #{uid} {u['email']}: {reason}")
            if not dry_run:
                core.execute("UPDATE users SET vip_level=? WHERE id=?", (target, uid))
            changed += 1

    # 买过会员天数（钱进了账号会员期）但用户等级为 0 的：按名下最长剩余期折算
    print()
    print("== 按账号会员期补等级 ==")
    candidates = core.query(
        """
        SELECT u.id, u.email, MAX(a.membership_expire) AS mx
        FROM users u JOIN accounts a ON a.user_id = u.id
        WHERE COALESCE(u.vip_level, 0) = 0 AND a.membership_expire IS NOT NULL
        GROUP BY u.id
        """
    )
    now = core.now_dt()
    for c in candidates:
        expire = core.parse_iso(c["mx"])
        if not expire or expire <= now:
            continue
        days = (expire - now).days
        level = 1 if days >= 7 else 0
        if days >= vip.LEVEL_BY_DAYS[0][0]:
            level = vip.LEVEL_BY_DAYS[0][1]
        if level <= 0:
            continue
        print(f"  · #{c['id']} {c['email']}: 账号会员期剩 {days} 天 → 补 VIP{level}")
        if not dry_run:
            core.execute(
                "UPDATE users SET vip_level=?, vip_expire=? WHERE id=?",
                (level, core.iso(expire, ms=False), c["id"]),
            )
        changed += 1

    return changed


def main() -> int:
    parser = argparse.ArgumentParser(description="会员体系数据迁移（幂等）")
    parser.add_argument("--dry-run", action="store_true", help="只打印将要做的改动，不写库")
    args = parser.parse_args()

    core.init_db()
    if args.dry_run:
        print("【DRY RUN】不会修改任何数据")
    n = migrate_settings(args.dry_run)
    n += migrate_levels(args.dry_run)
    print()
    print(f"{'将要' if args.dry_run else '已'}修改 {n} 项")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
