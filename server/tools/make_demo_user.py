"""造一个「用户视角」的演示账号，方便在面板上体验普通用户看到什么。

用法：
    cd 小蚕网站/server && python3 tools/make_demo_user.py

默认账号：demo@example.com / demo12345（role=user，非管理员）
幂等：重复跑不会重复建号，只补齐缺失的演示数据。

做四件事：
  1. 建/取普通用户（role=user）
  2. 给积分与可绑账号位（slot_total）
  3. 挂一个演示账号（照 admin 那个「演示账号」的结构，换个 user_id）
  4. 打开几个任务开关（feature_name 就是 coupon_types.name）
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import core  # noqa: E402

EMAIL = "demo@example.com"
PASSWORD = "demo12345"
NICKNAME = "演示用户"
POINTS = 1200
SLOT_TOTAL = 3
FEATURES = ["每日签到", "保底大牌券", "红包雨", "元宝抽奖"]

# 照抄 admin 那个演示账号的形状（token 是假的，只用于展示）
DEMO_ACCOUNT = {
    "nickname": "演示微信号",
    "remark": "演示微信号",
    "account_info": "716727905",
    "xc_user_id": "4404485",
    "access_token": (
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        ".eyJVc2VySWQiOjQ0MDQ0ODUsImV4cCI6MTc5MzA3NTcxN30.demoUserSig"
    ),
    "avatar": "",
    "vip_level": 6,
    "is_plus": 0,
    "status": "enabled",
    "admin_paused": 0,
    "membership_expire": "2026-12-31T23:59",
    "token_expire": "2026-10-27T12:35:17+08:00",
    "signup_error": "",
}


def main() -> None:
    core.init_db()
    now = core.iso()

    user = core.query_one("SELECT * FROM users WHERE lower(email)=?", (EMAIL,))
    if user:
        uid = int(user["id"])
        print(f"用户已存在：#{uid} {EMAIL}")
        if user["role"] != "user":
            core.execute("UPDATE users SET role='user' WHERE id=?", (uid,))
            print("  · 已把 role 改成 user（演示普通用户视角）")
    else:
        uid = core.insert(
            "users",
            {
                "email": EMAIL,
                "password_hash": core.hash_password(PASSWORD),
                "nickname": NICKNAME,
                "role": "user",
                "status": "normal",
                "points_balance": POINTS,
                "points_spent": 0,
                "invite_code": core.gen_invite_code(),
                "inviter_id": None,
                "email_notify": 1,
                "slot_total": SLOT_TOTAL,
                "slot_used": 0,
                "last_login_ip": "127.0.0.1",
                "last_login_time": now,
                "created_time": now,
            },
        )
        print(f"已创建用户：#{uid} {EMAIL} / {PASSWORD}")

    core.execute(
        "UPDATE users SET points_balance=?, slot_total=?, nickname=? WHERE id=?",
        (POINTS, SLOT_TOTAL, NICKNAME, uid),
    )

    account = core.query_one("SELECT * FROM accounts WHERE user_id=? LIMIT 1", (uid,))
    if account:
        account_id = int(account["id"])
        print(f"账号已存在：#{account_id} {account['remark']}")
    else:
        payload = dict(DEMO_ACCOUNT)
        payload.update(
            {
                "user_id": uid,
                "default_panel_id": None,
                "brand_panel_id": None,
                "bind_time": now,
                "created_time": now,
                "updated_time": now,
            }
        )
        account_id = core.insert("accounts", payload)
        core.execute("UPDATE users SET slot_used=1 WHERE id=?", (uid,))
        print(f"已挂演示账号：#{account_id} {payload['remark']}")

    for name in FEATURES:
        exists = core.query_one(
            "SELECT 1 FROM account_features WHERE account_id=? AND feature_name=?",
            (account_id, name),
        )
        if not exists:
            core.insert("account_features", {"account_id": account_id, "feature_name": name, "enabled": 1})
            print(f"  · 打开任务开关：{name}")

    print()
    print("登录信息")
    print(f"  后端 API：http://127.0.0.1:8100")
    print(f"  前端 UI ：http://127.0.0.1:3001 （cd ../web && npm run dev，生产用 next start -p 3001）")
    print(f"  邮箱：{EMAIL}")
    print(f"  密码：{PASSWORD}")
    print(f"  角色：user（非管理员，/api/admin/* 会拒绝）")
    print()
    print("用户端页面（Next.js）：/dashboard 控制台 · /dashboard/accounts 我的账号 · /dashboard/checkin 每日签到")
    print("                       /dashboard/profile 个人中心 · /dashboard/market 项目市场 · /dashboard/history 记录")
    print("                       /dashboard/notifications 消息推送 · /dashboard/submit 提交上车")


if __name__ == "__main__":
    main()
