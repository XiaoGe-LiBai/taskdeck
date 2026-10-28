"""初始数据：与原站默认值对齐，缺什么补什么（幂等，可反复执行）。"""
from __future__ import annotations

import core

COUPON_TYPES = [
    ("免单券", "SVIP5-6 / VIP6", "免单券"),
    ("元宝抽奖", "", "元宝抽奖"),
    ("红包雨", "", "红包雨"),
    ("限量大牌券-代理版", "", "限量的大牌券"),
    ("保底大牌券", "", "保底大牌券"),
    ("会员专属返利券", "", "会员专属返利券"),
    ("每日签到", "", "每日签到"),
    ("元宝一键领取", "", "元宝一键领取"),
    ("影音周卡", "SVIP3-6 / VIP6", "影音会员周卡"),
    ("双节抽礼", "", "小蚕双节抽好礼"),
]

PRODUCTS = [
    ("membership_day", "1 天会员", "membership", 1, 198, 1),
    ("membership_week", "7 天会员", "membership", 7, 1188, 2),
    ("membership_month", "30 天会员", "membership", 30, 3998, 3),
    ("slot_one", "1 个账号车位", "slot", 1, 99, 4),
    ("forever", "永久会员-加盟", "membership", 3650, 38800, 5),
]

CARD_TIERS = [
    ("2积分卡", 200, 2.0, 1),
    ("6积分卡", 600, 6.0, 2),
    ("12积分卡", 1200, 12.0, 3),
    ("40积分卡", 4000, 40.0, 4),
]

PLATFORMS = [
    ("某外卖平台", "🛵", "外卖红包/大牌券"),
    ("某电商平台", "🛒", "电商满减/红包雨"),
    ("某出行平台", "🚗", "出行优惠券"),
]

PRIZES = [
    ("特等奖", 10, 3800, 1),
    ("一等奖", 100, 1800, 2),
    ("二等奖", 500, 800, 3),
    ("三等奖", 800, 500, 4),
    ("四等奖", 1000, 200, 5),
    ("五等奖", 3000, 100, 6),
    ("参与奖", 3300, 50, 7),
]

SETTINGS = {
    "site_name": core.DEFAULT_SITE_NAME,
    "register_enabled": "true",
    "referral_rate_bps": "800",
    "lottery_cost": "200",
    "lottery_daily_limit": "30",
    # 每日签到：基础固定奖励（分）。只填一个正整数。
    "checkin_daily_reward": "8",
    # 连签额外加成（分）：从连签第 6 天起依次生效，超出取最后一个值（第 10 天封顶）。
    "checkin_rewards": "5,7,11,13,15",
    # 赌狗签到：奖励池（分），可含负数与 0，随机抽一个。所有用户共用，不吃会员倍率。
    "checkin_gamble_rewards": "-25,-13,-6,0,6,13,25",
    # 补签：每次消耗积分 / 每月次数上限（固定，不按等级）
    "checkin_makeup_cost": "30",
    "checkin_makeup_quota": "4",
    # 小蚕账号等级：每天自动向平台刷一次（等级是平台属性，会随用户消费变化）
    "level_refresh_enabled": "true",
    "level_refresh_hour": "4",
}


def ensure_seed() -> None:
    now = core.iso()

    for key, value in SETTINGS.items():
        if not core.query_one("SELECT 1 FROM settings WHERE key=?", (key,)):
            core.set_setting(key, value)

    for name, label, desc in COUPON_TYPES:
        if not core.query_one("SELECT 1 FROM coupon_types WHERE name=?", (name,)):
            core.insert(
                "coupon_types",
                {
                    "name": name,
                    "label": label,
                    "description": desc,
                    "points_cost": 0,
                    "sort_order": 0,
                    "status": "enabled",
                    "created_time": now,
                },
            )

    if not core.query_one("SELECT 1 FROM products"):
        for code, name, ptype, grant, price, order in PRODUCTS:
            core.insert(
                "products",
                {
                    "code": code,
                    "name": name,
                    "product_type": ptype,
                    "grant_value": grant,
                    "points_price": price,
                    "sort_order": order,
                    "status": "enabled",
                    "created_time": now,
                },
            )

    if not core.query_one("SELECT 1 FROM card_tiers"):
        for name, value, price, order in CARD_TIERS:
            core.insert(
                "card_tiers",
                {
                    "name": name,
                    "points_value": value,
                    "price": price,
                    "sort_order": order,
                    "status": "enabled",
                    "created_time": now,
                },
            )

    if not core.query_one("SELECT 1 FROM platforms"):
        for name, icon, desc in PLATFORMS:
            core.insert(
                "platforms",
                {
                    "name": name,
                    "icon": icon,
                    "description": desc,
                    "sort_order": 0,
                    "status": "enabled",
                    "created_time": now,
                },
            )

    if not core.query_one("SELECT 1 FROM lottery_prizes"):
        for name, bps, reward, order in PRIZES:
            core.insert(
                "lottery_prizes",
                {
                    "name": name,
                    "probability_bps": bps,
                    "reward_points": reward,
                    "sort_order": order,
                },
            )

    if not core.query_one("SELECT 1 FROM announcements"):
        core.insert(
            "announcements",
            {
                "title": f"欢迎使用{core.DEFAULT_SITE_NAME}",
                "content": "<p>绑定小蚕账号后，可在「我的账号」里按任务开关投放到青龙面板执行。</p>",
                "version": 1,
                "published_time": now,
                "updated_time": now,
            },
        )

    # 管理员不再属于演示种子数据；空库走安装向导，已有管理员不覆盖。
    import bootstrap
    bootstrap.prepare()


if __name__ == "__main__":
    core.init_db()
    ensure_seed()
    print("seed done:", core.DB_PATH)
