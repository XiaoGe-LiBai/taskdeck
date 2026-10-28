"""/api/auth/*：登录、注册、找回、资料、改密、通知开关。"""
from __future__ import annotations

import random
from datetime import timedelta

from flask import Blueprint, request

import core
import mail

bp = Blueprint("auth", __name__)

# 验证码安全参数
_CODE_MIN_INTERVAL_SECONDS = 60   # 同一邮箱两次发码的最小间隔（防邮件轰炸）
_CODE_MAX_ATTEMPTS = 5            # 单条验证码允许的最大错误次数（防爆破 6 位数字）
_CODE_DAILY_LIMIT = 10            # 同一邮箱 24 小时内最多索取这么多封（发信人信誉保护）


def _code_throttled(email: str, purpose: str) -> bool:
    """同邮箱同用途，距上次发码不足间隔则视为被节流。"""
    row = core.query_one(
        "SELECT created_time FROM email_codes WHERE email=? AND purpose=? ORDER BY id DESC LIMIT 1",
        (email, purpose),
    )
    if not row:
        return False
    last = core.parse_iso(row["created_time"])
    if not last:
        return False
    return (core.now_dt() - last).total_seconds() < _CODE_MIN_INTERVAL_SECONDS


def _code_daily_exceeded(email: str, purpose: str) -> bool:
    """同邮箱同用途 24 小时内发码次数超上限。

    created_time 统一由 core.iso() 生成，格式固定，字符串比较等价于时间比较。
    """
    since = core.iso(core.now_dt() - timedelta(hours=24))
    row = core.query_one(
        "SELECT COUNT(*) AS n FROM email_codes WHERE email=? AND purpose=? AND created_time>=?",
        (email, purpose, since),
    )
    return int(row["n"] if row else 0) >= _CODE_DAILY_LIMIT


def _send_code_or_fail(email: str, code: str, purpose: str, minutes: int = 10) -> dict | None:
    """发码。返回 None 表示已成功发出（或 dry-run 回显），否则返回给前端的失败体。

    - 真发出：{sent: true, dev_code: null}
    - 没配 SMTP：{sent: true, dev_code: <码>, dry_run: true}，本地联调用（见 README）
    - 配了但发失败：core.fail(...)，并把这条码作废，避免留下一堆「发不出去却有效」的码
    """
    title = {"register": "注册验证码", "reset": "找回密码验证码", "email_change": "换绑邮箱验证码"}.get(purpose, "验证码")
    result = mail.send_mail(email, f"{title} · {core.site_name()}",
                            mail.code_html(code, minutes))
    if result["sent"]:
        return None
    if result["dry_run"]:
        return None
    core.execute("UPDATE email_codes SET used=1 WHERE email=? AND purpose=? AND code=? AND used=0",
                 (email, purpose, code))
    return core.fail("验证码发送失败，请稍后再试或联系管理员")


def _check_email_code(email: str, purpose: str, code: str) -> str | None:
    """校验最新一条未用验证码。返回 None 表示通过，否则返回错误文案。

    每错一次 attempts+1，达到上限直接作废这条码，必须重新发码。
    """
    row = core.query_one(
        "SELECT * FROM email_codes WHERE email=? AND purpose=? AND used=0 ORDER BY id DESC LIMIT 1",
        (email, purpose),
    )
    if not row:
        return "请先获取验证码"
    if int(row["attempts"] or 0) >= _CODE_MAX_ATTEMPTS:
        core.execute("UPDATE email_codes SET used=1 WHERE id=?", (row["id"],))
        return "验证码错误次数过多，请重新获取"
    if row["code"] != (code or "").strip():
        core.execute("UPDATE email_codes SET attempts=attempts+1 WHERE id=?", (row["id"],))
        return "验证码不正确"
    expire = core.parse_iso(row["expire_time"])
    if expire and expire < core.now_dt():
        return "验证码已过期"
    core.execute("UPDATE email_codes SET used=1 WHERE id=?", (row["id"],))
    return None


@bp.post("/login")
def login():
    """单入口登录。

    channel 只是「期望落地的渠道」，不匹配也不拒绝 —— 渠道是登录后在侧栏切换的视图，
    不是账号的墙。账号自己的 channel 决定登录后默认落在哪一边。
    """
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not email or not password:
        return core.fail("请输入邮箱和密码")

    user = core.query_one("SELECT * FROM users WHERE lower(email)=?", (email,))
    if not user or not core.verify_password(password, user["password_hash"]):
        return core.fail("邮箱或密码错误")
    if user["status"] == "banned":
        return core.fail("账号已被封禁，请联系管理员")

    now_iso = core.iso()
    client_ip = core.current_ip()
    user_agent = request.headers.get("User-Agent", "")[:200]
    core.execute(
        "UPDATE users SET last_login_ip=?, last_login_time=? WHERE id=?",
        (client_ip, now_iso, user["id"]),
    )
    core.insert(
        "login_logs",
        {
            "user_id": user["id"],
            "ip": client_ip,
            "user_agent": user_agent,
            "status": "success",
            "created_time": now_iso,
        },
    )
    user = core.query_one("SELECT * FROM users WHERE id=?", (user["id"],))
    tv = dict(user).get("token_version") or 1
    token, _ttl = core.make_token(user["id"], user["role"], tv)
    return core.ok({"access_token": token, "user": core.user_public(dict(user))})


@bp.post("/register/code")
def register_code():
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return core.fail("请输入正确的邮箱")
    if core.get_setting("register_enabled", "true") != "true":
        return core.fail("当前已关闭注册")
    if core.query_one("SELECT 1 FROM users WHERE lower(email)=?", (email,)):
        return core.fail("该邮箱已注册")
    if _code_daily_exceeded(email, "register"):
        return core.fail("该邮箱今日获取验证码次数过多，请明天再试")
    if _code_throttled(email, "register"):
        return core.fail("发送太频繁了，请 60 秒后再试")

    code = "%06d" % random.randint(0, 999999)
    core.insert(
        "email_codes",
        {
            "email": email,
            "code": code,
            "purpose": "register",
            "used": 0,
            "expire_time": core.iso(core.now_dt() + timedelta(minutes=10)),
            "created_time": core.iso(),
        },
    )
    failure = _send_code_or_fail(email, code, "register", minutes=10)
    if failure is not None:
        return failure
    # 未配置 SMTP 时把验证码回传给前端（仅开发用；配置邮件后自动隐藏）
    return core.ok({"sent": True, "dev_code": None if mail.configured() else code, "retry_after": _CODE_MIN_INTERVAL_SECONDS})


@bp.post("/register")
def register():
    body = request.get_json(silent=True) or {}
    if core.get_setting("register_enabled", "true") != "true":
        return core.fail("当前已关闭注册")

    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    confirm = body.get("confirmPassword") or body.get("confirm_password") or password
    nickname = (body.get("nickname") or "").strip() or email.split("@")[0]
    invite_code = (body.get("invite_code") or "").strip().upper()
    code = (body.get("code") or "").strip()

    if not email or "@" not in email:
        return core.fail("请输入正确的邮箱")
    if len(password) < 8:
        return core.fail("密码至少 8 位")
    if password != confirm:
        return core.fail("两次输入的密码不一致")
    if core.query_one("SELECT 1 FROM users WHERE lower(email)=?", (email,)):
        return core.fail("该邮箱已注册")

    if core.CONFIG.get("register_require_code"):
        error = _check_email_code(email, "register", code)
        if error:
            return core.fail(error)

    inviter = None
    if invite_code:
        inviter = core.query_one("SELECT * FROM users WHERE invite_code=?", (invite_code,))
        if not inviter:
            return core.fail("邀请码不存在")

    now = core.iso()
    uid = core.insert(
        "users",
        {
            "email": email,
            "password_hash": core.hash_password(password),
            "nickname": nickname[:20],
            "role": "user",
            "status": "normal",
            "points_balance": 0,
            "points_spent": 0,
            "invite_code": core.gen_invite_code(),
            "inviter_id": inviter["id"] if inviter else None,
            "email_notify": 1,
            "slot_total": 0,
            "slot_used": 0,
            "last_login_ip": core.current_ip(),
            "last_login_time": now,
            "created_time": now,
        },
    )
    user = core.query_one("SELECT * FROM users WHERE id=?", (uid,))
    tv = dict(user).get("token_version") or 1
    token, _ttl = core.make_token(uid, "user", tv)
    return core.ok({"access_token": token, "user": core.user_public(dict(user))})


@bp.post("/reset-password")
def reset_password():
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    row = core.query_one("SELECT id FROM users WHERE lower(email)=?", (email,))
    if not row:
        return core.fail("该邮箱未注册")
    if _code_daily_exceeded(email, "reset"):
        return core.fail("该邮箱今日获取验证码次数过多，请明天再试")
    if _code_throttled(email, "reset"):
        return core.fail("发送太频繁了，请 60 秒后再试")
    code = "%06d" % random.randint(0, 999999)
    core.insert(
        "email_codes",
        {
            "email": email,
            "code": code,
            "purpose": "reset",
            "used": 0,
            "expire_time": core.iso(core.now_dt() + timedelta(minutes=30)),
            "created_time": core.iso(),
        },
    )
    failure = _send_code_or_fail(email, code, "reset", minutes=30)
    if failure is not None:
        return failure
    return core.ok({"sent": True, "dev_code": None if mail.configured() else code})


@bp.post("/reset-password/confirm")
def reset_password_confirm():
    """找回密码第 2 步：验码 + 改密。码作废前先把两次密码、长度都校验完。"""
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip()
    password = body.get("password") or ""
    confirm = body.get("confirmPassword") or body.get("confirm_password") or ""

    if not email or "@" not in email:
        return core.fail("请输入正确的邮箱")
    if not core.query_one("SELECT 1 FROM users WHERE lower(email)=?", (email,)):
        return core.fail("该邮箱未注册")
    if len(password) < 8:
        return core.fail("新密码至少 8 位")
    if password != confirm:
        return core.fail("两次输入的密码不一致")

    error = _check_email_code(email, "reset", code)
    if error:
        return core.fail(error)

    core.execute(
        "UPDATE users SET password_hash=? WHERE lower(email)=?",
        (core.hash_password(password), email),
    )
    return core.ok({})


@bp.post("/logout")
@core.require_login
def logout():
    return core.ok({})


@bp.get("/profile")
@core.require_login
def profile():
    return core.ok(core.user_public(core.current_user()))


@bp.put("/password")
@core.require_login
def change_password():
    body = request.get_json(silent=True) or {}
    old = body.get("old_password") or ""
    new = body.get("new_password") or ""
    if len(new) < 8:
        return core.fail("新密码至少 8 位")
    user = core.query_one("SELECT * FROM users WHERE id=?", (core.current_user()["id"],))
    if not core.verify_password(old, user["password_hash"]):
        return core.fail("原密码不正确")
    core.execute("UPDATE users SET password_hash=? WHERE id=?", (core.hash_password(new), user["id"]))
    return core.ok({})


@bp.put("/notify")
@core.require_login
def notify():
    body = request.get_json(silent=True) or {}
    core.execute(
        "UPDATE users SET email_notify=? WHERE id=?",
        (1 if body.get("email_notify") else 0, core.current_user()["id"]),
    )
    return core.ok({})


@bp.post("/email/change-code")
@core.require_login
def email_change_code():
    """换绑邮箱第 1 步：把验证码发到「新邮箱」。新邮箱未被占用才发。"""
    body = request.get_json(silent=True) or {}
    new_email = (body.get("email") or "").strip().lower()
    if not new_email or "@" not in new_email:
        return core.fail("请输入正确的新邮箱")
    current = core.current_user()
    if new_email == current["email"]:
        return core.fail("新邮箱与当前邮箱相同")
    if core.query_one("SELECT 1 FROM users WHERE lower(email)=?", (new_email,)):
        return core.fail("该邮箱已被其他账号使用")
    if _code_daily_exceeded(new_email, "email_change"):
        return core.fail("该邮箱今日获取验证码次数过多，请明天再试")
    if _code_throttled(new_email, "email_change"):
        return core.fail("发送太频繁了，请 60 秒后再试")

    code = "%06d" % random.randint(0, 999999)
    core.insert(
        "email_codes",
        {
            "email": new_email,
            "code": code,
            "purpose": "email_change",
            "used": 0,
            "expire_time": core.iso(core.now_dt() + timedelta(minutes=10)),
            "created_time": core.iso(),
        },
    )
    failure = _send_code_or_fail(new_email, code, "email_change", minutes=10)
    if failure is not None:
        return failure
    return core.ok({"sent": True, "dev_code": None if mail.configured() else code})


@bp.put("/email")
@core.require_login
def email_change():
    """换绑邮箱第 2 步：验码通过才改 email。唯一性在验码后再查一次，防并发抢注。"""
    body = request.get_json(silent=True) or {}
    new_email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip()
    if not new_email or "@" not in new_email:
        return core.fail("请输入正确的新邮箱")

    current = core.current_user()
    if new_email == current["email"]:
        return core.fail("新邮箱与当前邮箱相同")

    error = _check_email_code(new_email, "email_change", code)
    if error:
        return core.fail(error)

    # 验码通过后才落库；期间被别人抢注就明确告知
    if core.query_one("SELECT 1 FROM users WHERE lower(email)=?", (new_email,)):
        return core.fail("该邮箱已被其他账号使用")
    core.execute("UPDATE users SET email=? WHERE id=?", (new_email, current["id"]))
    return core.ok({"email": new_email})


@bp.get("/login-logs")
@core.require_login
def login_logs():
    uid = core.current_user()["id"]
    rows = core.query(
        "SELECT * FROM login_logs WHERE user_id=? ORDER BY id DESC LIMIT 50",
        (uid,),
    )
    records = [dict(r) for r in rows]
    if not records:
        u = core.current_user()
        records = [
            {
                "id": 1,
                "user_id": uid,
                "ip": u.get("last_login_ip") or "未知",
                "user_agent": "—",
                "status": "success",
                "created_time": u.get("last_login_time") or core.iso(),
            }
        ]
    return core.ok({"records": records, "total": len(records)})

