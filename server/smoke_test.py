#!/usr/bin/env python3
"""后端全流程冒烟测试：对着本地 8100 端口跑一遍主链路。

用法：
    python3 smoke_test.py [base_url]
默认 http://127.0.0.1:8100
只操作本地测试库，不动远端任何站点。
"""
from __future__ import annotations

import json
import sys
import time

import requests

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100").rstrip("/")
API = BASE + "/api"

PASS, FAIL = [], []


def check(name: str, cond: bool, detail: str = "") -> bool:
    (PASS if cond else FAIL).append(name)
    print(("  ✔ " if cond else "  ✘ ") + name + (f"  → {detail}" if detail and not cond else ""))
    return cond


def req(method: str, path: str, token: str = "", **kwargs):
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = "Bearer " + token
    if "json" in kwargs:
        headers["Content-Type"] = "application/json"
    resp = requests.request(method, API + path, headers=headers, timeout=30, **kwargs)
    try:
        return resp.status_code, resp.json()
    except ValueError:
        return resp.status_code, {"_raw": resp.text[:200]}


def data_of(payload):
    return (payload or {}).get("data")


def main() -> int:
    print(f"== 后端冒烟测试 {BASE} ==")

    # ---------- 1. 管理员登录
    print("\n[1] 管理员登录 / 后台")
    code, body = req("POST", "/auth/login", json={"email": "admin@example.com", "password": "admin12345"})
    admin = data_of(body) or {}
    if not check("admin 登录", bool(admin.get("access_token")), json.dumps(body, ensure_ascii=False)[:200]):
        return 1
    at = admin["access_token"]

    for path, key in [
        ("/admin/stats", "users"),
        ("/admin/users?page=1&size=5", "records"),
        ("/admin/accounts?page=1&size=5", "records"),
        ("/admin/account-data", "text"),
        ("/admin/platforms", None),
        ("/admin/coupon-types", None),
        ("/admin/card-tiers", None),
        ("/admin/products", None),
        ("/admin/announcements", None),
        ("/admin/settings", "site_name"),
        ("/admin/cards?page=1&size=5", "records"),
        ("/admin/brand-coupon-failures?days=7", "records"),
    ]:
        code, body = req("GET", path, at)
        d = data_of(body)
        ok = code == 200 and (d is not None if key is None else (isinstance(d, dict) and key in d))
        check(f"GET {path}", ok, json.dumps(body, ensure_ascii=False)[:160])

    code, body = req("GET", "/admin/task-logs?date=" + time.strftime("%Y-%m-%d"), at)
    d = data_of(body) or {}
    check("GET /admin/task-logs", code == 200 and "events" in d and "tasks" in d, str(body)[:160])

    code, body = req("GET", "/admin/xiaocan-tasks", at)
    check("GET /admin/xiaocan-tasks", code == 200 and isinstance(data_of(body), list), str(body)[:160])

    code, body = req("GET", "/admin/ql/panels", at)
    panels = data_of(body)
    check("GET /admin/ql/panels", code == 200 and isinstance(panels, list), str(body)[:160])

    # 面板 CRUD（用假地址，只为验证接口）
    code, body = req("POST", "/admin/ql/panels", at, json={"name": "冒烟面板", "url": "http://127.0.0.1:59999", "username": "admin", "password": "x"})
    pid = (data_of(body) or {}).get("id")
    check("POST /admin/ql/panels", code == 200 and bool(pid), str(body)[:160])
    if pid:
        code, body = req("POST", f"/admin/ql/panels/{pid}/check", at)
        check("POST /admin/ql/panels/{id}/check（离线应返回 offline）", (data_of(body) or {}).get("status") == "offline", str(body)[:160])
        code, body = req("PUT", f"/admin/ql/panels/{pid}", at, json={"remark": "冒烟"})
        check("PUT /admin/ql/panels/{id}", code == 200, str(body)[:160])
        code, body = req("DELETE", f"/admin/ql/panels/{pid}", at)
        check("DELETE /admin/ql/panels/{id}", code == 200, str(body)[:160])

    # 设置
    code, body = req("PUT", "/admin/settings", at, json={"site_name": "我中了大牌券助手"})
    check("PUT /admin/settings", code == 200, str(body)[:160])

    # 邮件服务设置（SMTP 入库 / 口令掩码 / 自检接口）
    # 口令永远不会回传前端，所以这里只写非口令字段；测完把 host 关掉，
    # 否则 DB 里若已存有授权码，配上 host 就会真的去连外网发信。
    code, body = req("GET", "/admin/settings", at)
    smtp_before = data_of(body) or {}
    smtp_host_before = (smtp_before.get("smtp_host") or "").strip()
    pwd_set = smtp_before.get("smtp_password_set") == "true"

    req("PUT", "/admin/settings", at, json={"smtp_host": "smtp.example.com", "smtp_from_name": "冒烟发件人"})
    code, body = req("GET", "/admin/settings", at)
    smtp_now = data_of(body) or {}
    check("PUT/GET /admin/settings（SMTP 字段入库）",
          smtp_now.get("smtp_host") == "smtp.example.com" and smtp_now.get("smtp_from_name") == "冒烟发件人",
          str(body)[:200])
    check("授权码不回传前端（只给 smtp_password_set）",
          smtp_now.get("smtp_password") == "" and "smtp_password_set" in smtp_now, str(body)[:200])

    if not pwd_set:
        code, body = req("POST", "/admin/settings/mail-test", at, json={"to": "smoke@test.local"})
        mail_test = data_of(body) or {}
        check("POST /admin/settings/mail-test（未配置→dry_run，不真连外网）",
              code == 200 and mail_test.get("sent") is False and mail_test.get("dry_run") is True,
              str(body)[:200])
    else:
        print("  · 跳过 mail-test 断言：本机已存 SMTP 授权码，不拿占位主机名去连外网")

    # 关掉发信，下面要用 dev_code 走「取验证码→注册」；冒烟跑完再还原
    req("PUT", "/admin/settings", at, json={"smtp_host": ""})

    # 公告
    code, body = req("POST", "/admin/announcements", at, json={"title": "冒烟公告", "content": "<p>hello</p>"})
    aid = (data_of(body) or {}).get("id")
    check("POST /admin/announcements", bool(aid), str(body)[:160])
    if aid:
        code, body = req("PUT", f"/admin/announcements/{aid}", at, json={"title": "冒烟公告", "content": "<p>hello2</p>"})
        check("PUT /admin/announcements/{id}", code == 200, str(body)[:160])
        code, body = req("GET", "/announcements/latest")
        check("GET /announcements/latest（版本自增）", (data_of(body) or {}).get("version", 0) >= 2, str(body)[:160])

    # ---------- 2. 新用户注册（邮箱验证码）
    print("\n[2] 注册 / 登录 / 资料")
    stamp = int(time.time())
    email = f"smoke{stamp}@test.local"
    register_payload = {
        "email": email, "password": "test12345", "confirmPassword": "test12345", "nickname": "冒烟用户",
    }

    # 先探一次「不带验证码能不能注册」，据此判断 register_require_code 开关
    probe_email = f"probe{stamp}@test.local"
    _, probe_body = req("POST", "/auth/register", json={**register_payload, "email": probe_email})
    require_code = probe_body.get("code") != 200

    if require_code:
        code, body = req("POST", "/auth/register/code", json={"email": email})
        dev_code = (data_of(body) or {}).get("dev_code")
        check("POST /auth/register/code（未配 SMTP → 回传 dev_code）",
              code == 200 and body.get("code") == 200 and bool(dev_code), str(body)[:200])

        code, body = req("POST", "/auth/register/code", json={"email": email})
        check("发码节流：60 秒内重复请求被拒", body.get("code") != 200, str(body)[:160])

        code, body = req("POST", "/auth/register", json={**register_payload, "code": "000000"})
        check("验证码错误 → 注册被拒", body.get("code") != 200, str(body)[:160])

        register_payload["code"] = dev_code
    else:
        print("  · register_require_code=false：本次跳过验证码相关断言")

    code, body = req("POST", "/auth/register", json=register_payload)
    user = data_of(body) or {}
    if not check("注册新用户", bool(user.get("access_token")), str(body)[:200]):
        return 1
    ut = user["access_token"]

    if smtp_host_before:
        req("PUT", "/admin/settings", at, json={"smtp_host": smtp_host_before})

    code, body = req("POST", "/auth/login", json={"email": email, "password": "test12345"})
    check("新用户登录", bool((data_of(body) or {}).get("access_token")), str(body)[:160])

    code, body = req("GET", "/auth/profile", ut)
    check("GET /auth/profile", (data_of(body) or {}).get("email") == email, str(body)[:160])

    code, body = req("PUT", "/auth/notify", ut, json={"email_notify": False})
    check("PUT /auth/notify", code == 200, str(body)[:160])

    code, body = req("PUT", "/auth/password", ut, json={"old_password": "test12345", "new_password": "test123456"})
    check("PUT /auth/password", code == 200, str(body)[:160])

    # ---------- 2b. 找回密码闭环（发码 → 错码 → 正确码改密 → 新密码登录）
    code, body = req("POST", "/auth/reset-password", json={"email": email})
    reset_code = (data_of(body) or {}).get("dev_code")
    check("POST /auth/reset-password（回传 dev_code）",
          code == 200 and body.get("code") == 200 and bool(reset_code), str(body)[:200])

    code, body = req("POST", "/auth/reset-password/confirm", json={
        "email": email, "code": "000000", "password": "test654321", "confirmPassword": "test654321",
    })
    check("找回密码：错码被拒", body.get("code") != 200, str(body)[:160])

    code, body = req("POST", "/auth/reset-password/confirm", json={
        "email": email, "code": reset_code, "password": "test654321", "confirmPassword": "test654321",
    })
    check("找回密码：正确码改密", code == 200 and body.get("code") == 200, str(body)[:160])

    code, body = req("POST", "/auth/login", json={"email": email, "password": "test123456"})
    check("旧密码登录失败", body.get("code") != 200, str(body)[:160])
    code, body = req("POST", "/auth/login", json={"email": email, "password": "test654321"})
    check("新密码登录成功", bool((data_of(body) or {}).get("access_token")), str(body)[:160])
    ut = (data_of(body) or {}).get("access_token") or ut

    # ---------- 2c. 换绑邮箱闭环（发码 → 验码换绑 → profile 更新 → 占用拦截）
    bound_email = f"bound{stamp}@test.local"
    code, body = req("POST", "/auth/email/change-code", ut, json={"email": bound_email})
    chg_code = (data_of(body) or {}).get("dev_code")
    check("POST /auth/email/change-code", code == 200 and bool(chg_code), str(body)[:200])

    code, body = req("PUT", "/auth/email", ut, json={"email": bound_email, "code": "000000"})
    check("换绑邮箱：错码被拒", body.get("code") != 200, str(body)[:160])

    code, body = req("PUT", "/auth/email", ut, json={"email": bound_email, "code": chg_code})
    check("换绑邮箱：验码换绑", code == 200 and body.get("code") == 200, str(body)[:160])

    code, body = req("GET", "/auth/profile", ut)
    check("换绑后 profile.email 已更新", (data_of(body) or {}).get("email") == bound_email, str(body)[:160])

    code, body = req("POST", "/auth/email/change-code", ut, json={"email": bound_email})
    check("换绑到当前邮箱应被拒", body.get("code") != 200, str(body)[:160])

    # ---------- 2d. 我的报名/抢兑记录
    code, body = req("GET", "/my/xiaocan-history", ut)
    history = data_of(body) or {}
    check("GET /my/xiaocan-history",
          code == 200 and "records" in history and "signup_total" in history, str(body)[:200])

    # 后续用例里登录态统一用这个（换绑后邮箱变了，token 没变）
    current_email = bound_email

    # ---------- 3. 卡密 -> 积分
    print("\n[3] 卡密生成 / 兑换 / 积分")
    code, body = req("GET", "/admin/card-tiers", at)
    tiers = data_of(body) or []
    tier_id = tiers[0]["id"] if tiers else None
    code, body = req("POST", "/admin/cards/generate", at, json={"tier_id": tier_id, "count": 2})
    codes = (data_of(body) or {}).get("codes") or []
    check("POST /admin/cards/generate", len(codes) == 2, str(body)[:200])

    # 档位 / 商品自由排序
    if len(tiers) >= 2:
        ids = [t["id"] for t in tiers]
        reversed_ids = list(reversed(ids))
        code, body = req("POST", "/admin/reorder", at, json={"table": "card_tiers", "ids": reversed_ids})
        check("POST /admin/reorder（档位倒序）",
              code == 200 and (data_of(body) or {}).get("updated") == len(reversed_ids), str(body)[:200])
        code, body = req("GET", "/admin/card-tiers", at)
        check("排序已生效（返回顺序 = 提交顺序）",
              [t["id"] for t in (data_of(body) or [])] == reversed_ids, str(body)[:200])
        # 还原，别把生产顺序改坏
        req("POST", "/admin/reorder", at, json={"table": "card_tiers", "ids": ids})
    else:
        print("  · 档位少于 2 条，跳过排序断言")

    code, body = req("POST", "/admin/reorder", at, json={"table": "users", "ids": [1]})
    check("排序：非白名单表被拒", body.get("code") != 200, str(body)[:160])
    code, body = req("POST", "/admin/reorder", at, json={"table": "card_tiers", "ids": [999999]})
    check("排序：不存在的 id 被拒", body.get("code") != 200, str(body)[:160])

    if codes:
        code, body = req("POST", "/points/redeem", ut, json={"code": codes[0]})
        check("POST /points/redeem", (data_of(body) or {}).get("balance", 0) > 0, str(body)[:200])
        code, body = req("POST", "/points/redeem", ut, json={"code": codes[0]})
        check("重复兑换应失败", code == 200 and (body.get("code") != 200), str(body)[:160])

    code, body = req("GET", "/points/transactions?page=1&size=10", ut)
    check("GET /points/transactions", "records" in (data_of(body) or {}), str(body)[:160])

    # ---------- 4. 签到 / 转盘 / 邀请
    print("\n[4] 签到 / 转盘 / 邀请")
    code, body = req("GET", "/points/check-in", ut)
    check("GET /points/check-in", "checked_in_today" in (data_of(body) or {}), str(body)[:160])
    code, body = req("POST", "/points/check-in", ut, json={})
    d = data_of(body) or {}
    check("POST /points/check-in", d.get("reward", 0) > 0 and d.get("checked_in_today") is True, str(body)[:160])
    code, body = req("POST", "/points/check-in", ut, json={})
    check("重复签到应失败", body.get("code") != 200, str(body)[:160])

    code, body = req("GET", "/points/lottery", ut)
    d = data_of(body) or {}
    check("GET /points/lottery", bool(d.get("prizes")), str(body)[:160])
    check("  └ 未中奖概率 = 10000 - Σprizes",
          d.get("no_prize_probability_bps") == max(0, 10000 - sum(p["probability_bps"] for p in d.get("prizes", []))),
          str(d.get("no_prize_probability_bps")))
    if d.get("balance", 0) >= d.get("cost_points", 0):
        code, body = req("POST", "/points/lottery/draw", ut, json={})
        check("POST /points/lottery/draw", "prize" in (data_of(body) or {}), str(body)[:160])

    code, body = req("GET", "/invite/stats", ut)
    check("GET /invite/stats", "total" in (data_of(body) or {}), str(body)[:160])

    code, body = req("GET", "/billing/status", ut)
    check("GET /billing/status", "points_balance" in (data_of(body) or {}), str(body)[:160])

    code, body = req("GET", "/points/summary", ut)
    check("GET /points/summary", "products" in (data_of(body) or {}), str(body)[:160])

    # ---------- 5. 绑定小蚕账号
    print("\n[5] 小蚕账号绑定 / 功能开关 / 权益")
    fake_token = _fake_token(stamp)
    line = f"冒烟账号#{stamp}#{stamp}88#{fake_token}"
    code, body = req("POST", "/xiaocan/bind", ut, json={"data": line})
    accounts = (data_of(body) or {}).get("accounts") or []
    check("POST /xiaocan/bind（粘贴绑定）", len(accounts) == 1, str(body)[:200])
    account = accounts[0] if accounts else {}
    check("  └ 自动解析 token_expire", bool(account.get("token_expire")), json.dumps(account, ensure_ascii=False)[:200])

    code, body = req("GET", "/xiaocan/accounts", ut)
    check("GET /xiaocan/accounts", len(data_of(body) or []) == 1, str(body)[:160])

    code, body = req("PUT", f"/xiaocan/accounts/{account.get('id')}/features/每日签到", ut, json={})
    check("PUT 功能开关（未激活权益应被拦）", body.get("code") != 200, str(body)[:160])

    # 管理员给账号开会员
    code, body = req("PUT", f"/admin/accounts/{account.get('id')}/membership-expire", at,
                     json={"membership_expire": time.strftime("%Y-%m-%dT%H:%M")})
    check("PUT /admin/accounts/{id}/membership-expire", code == 200, str(body)[:160])

    code, body = req("PUT", f"/admin/accounts/{account.get('id')}/membership-expire", at,
                     json={"membership_expire": time.strftime("%Y-%m-%dT%H:%M", time.localtime(time.time() + 3 * 86400))})
    code, body = req("PUT", f"/xiaocan/accounts/{account.get('id')}/features/每日签到", ut, json={})
    check("PUT 功能开关（激活后开启）", (data_of(body) or {}).get("value") is True, str(body)[:160])
    code, body = req("PUT", f"/xiaocan/accounts/{account.get('id')}/features/每日签到", ut, json={})
    check("PUT 功能开关（再点一次关闭）", (data_of(body) or {}).get("value") is False, str(body)[:160])

    # 报名（无面板时应落库为 failed 并给出提示）
    code, body = req("POST", f"/xiaocan/accounts/{account.get('id')}/signup", ut,
                     json={"tea_name": "瑞幸", "order_numbers": "123#456"})
    check("POST 大牌券报名", body.get("code") == 200, str(body)[:200])

    # 抢兑
    code, body = req("GET", f"/xiaocan/accounts/{account.get('id')}/redeem-prizes", ut)
    check("GET redeem-prizes", isinstance(data_of(body), list), str(body)[:160])
    code, body = req("PUT", f"/xiaocan/accounts/{account.get('id')}/redeem", ut, json={"enabled": False, "exchange_id": 1})
    check("PUT redeem（关闭态保存）", body.get("code") == 200, str(body)[:160])

    # 购买会员（用新用户自己的账号，验证完整购买链路）
    code, body = req("GET", "/auth/profile", ut)
    uid = (data_of(body) or {}).get("id")
    code, body = req("POST", f"/admin/users/{uid}/points", at, json={"amount": 100000, "note": "冒烟充值"})
    check("POST /admin/users/{id}/points（管理员调积分）", (data_of(body) or {}).get("balance", 0) >= 100000, str(body)[:160])
    code, body = req("GET", "/points/summary", ut)
    products = [p for p in (data_of(body) or {}).get("products", []) if p["product_type"] == "membership"]
    if products and account.get("id"):
        code, body = req("POST", "/points/purchase", ut, json={"product_id": products[0]["id"], "account_id": account["id"]})
        check("POST /points/purchase", body.get("code") == 200, str(body)[:160])

    # ---------- 6. 账号数据导出 / runner 通道
    print("\n[6] 账号数据 / runner 通道")
    code, body = req("GET", "/admin/account-data", at)
    d = data_of(body) or {}
    check("账号数据格式 备注#UserId#silk_id#token", d.get("count", 0) >= 1 and "#" in d.get("text", ""), str(d)[:200])

    runner_key = _runner_key()
    if runner_key:
        code, body = req("GET", f"/runner/accounts?task=checkin&key={runner_key}")
        check("GET /api/runner/accounts", body.get("code") == 200, str(body)[:160])
        code, body = req("POST", f"/runner/report?key={runner_key}", json={
            "type": "account", "account_id": account.get("id"), "vip_level": 6, "nickname": "冒烟账号",
        })
        check("POST /api/runner/report(account)", body.get("code") == 200, str(body)[:160])
        code, body = req("POST", f"/runner/report?key={runner_key}", json={
            "type": "prizes", "account_id": account.get("id"),
            "prizes": [{"exchange_id": 101, "name": "测试奖品", "yuanbao_cost": 20, "group": "每日", "start_at": int(time.time()) + 3600,
                        "available": True, "upcoming": True}],
        })
        check("POST /api/runner/report(prizes)", body.get("code") == 200, str(body)[:160])
        code, body = req("GET", f"/xiaocan/accounts/{account.get('id')}/redeem-prizes", ut)
        check("  └ 抢兑奖品已入库", len(data_of(body) or []) == 1, str(body)[:160])
        code, body = req("POST", f"/runner/report?key={runner_key}", json={
            "type": "failure", "account_id": account.get("id"), "reason": "库存耗尽",
        })
        check("POST /api/runner/report(failure)", body.get("code") == 200, str(body)[:160])
        code, body = req("GET", "/admin/brand-coupon-failures?days=7", at)
        check("  └ 未中记录进仪表盘", len(data_of(body) or []) >= 1, str(body)[:160])
        code, body = req("GET", "/runner/accounts?task=x", headers={"X-Runner-Key": "wrong"})
        check("runner 鉴权：错误 key 应 401", body.get("code") == 401, str(body)[:160])

    # ---------- 7. 权限校验
    print("\n[7] 权限校验")
    code, body = req("GET", "/admin/stats", ut)
    check("普通用户访问后台应 403", body.get("code") == 403, str(body)[:160])
    code, body = req("GET", "/auth/profile")
    check("无 token 应 401", body.get("code") == 401, str(body)[:160])
    code, body = req("GET", "/admin/nope", at)
    check("不存在的接口应 404 page not found", body.get("msg") == "page not found", str(body)[:160])

    print(f"\n== 结果：{len(PASS)} 通过 / {len(FAIL)} 失败 ==")
    if FAIL:
        print("失败项：")
        for item in FAIL:
            print(" -", item)
    return 1 if FAIL else 0


def _fake_token(stamp: int) -> str:
    """构造一个带 exp 的假小蚕 token，用于本地冒烟（不参与任何真实请求）。"""
    import base64

    def enc(obj) -> str:
        raw = json.dumps(obj, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).decode().rstrip("=")

    header = enc({"alg": "HS256", "typ": "JWT"})
    payload = enc({"UserId": stamp, "exp": int(time.time()) + 86400 * 7})
    return f"{header}.{payload}.smoke"


def _runner_key() -> str:
    try:
        import os

        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
        with open(path, encoding="utf-8") as fh:
            return json.load(fh).get("runner_key", "")
    except Exception:
        return ""


if __name__ == "__main__":
    sys.exit(main())
