"""/api/admin/* 管理后台接口。"""
from __future__ import annotations

import io
import math
import os
import random
import secrets
import string
from datetime import timedelta

from flask import Blueprint, request

import core
import mail
import notify
import vip
import xiaocan_bridge as xc
import xiaocan_tasks

bp = Blueprint("admin", __name__)


# ------------------------------------------------------------ 仪表盘


@bp.get("/stats")
@core.require_admin
def stats():
    users = core.query_one("SELECT COUNT(*) AS n FROM users")["n"]
    accounts = core.query_one("SELECT COUNT(*) AS n FROM accounts")["n"]
    vip_accounts = core.query_one("SELECT COUNT(*) AS n FROM accounts WHERE vip_level>0")["n"]
    cards_total = core.query_one("SELECT COUNT(*) AS n FROM cards")["n"]
    cards_used = core.query_one("SELECT COUNT(*) AS n FROM cards WHERE status='used'")["n"]
    issued = core.query_one(
        "SELECT COALESCE(SUM(amount),0) AS n FROM points_transactions WHERE amount>0"
    )["n"]
    spent = core.query_one(
        "SELECT COALESCE(SUM(-amount),0) AS n FROM points_transactions WHERE amount<0"
    )["n"]
    levels = {
        str(r["vip_level"]): r["n"]
        for r in core.query(
            "SELECT vip_level, COUNT(*) AS n FROM accounts WHERE vip_level>0 GROUP BY vip_level"
        )
    }
    return core.ok(
        {
            "users": users,
            "accounts": accounts,
            "vip_accounts": vip_accounts,
            "cards_total": cards_total,
            "cards_used": cards_used,
            "points_issued": issued,
            "points_spent": spent,
            "vip_levels": levels,
        }
    )


@bp.get("/brand-coupon-failures")
@core.require_admin
def brand_coupon_failures():
    days = core.arg_int("days", 7, 1, 90)
    return core.ok({"records": xiaocan_tasks.recent_failures(days)})


# ------------------------------------------------------------ 用户


@bp.get("/users")
@core.require_admin
def users():
    page = core.arg_int("page", 1, 1, 100000)
    size = core.arg_int("size", 10, 1, 200)
    keyword = (request.args.get("q") or "").strip()
    role = (request.args.get("role") or "").strip()
    status = (request.args.get("status") or "").strip()

    conds, args = [], []
    if keyword:
        conds.append("(nickname LIKE ? OR email LIKE ? OR CAST(id AS TEXT)=? OR last_login_ip LIKE ?)")
        args.extend([f"%{keyword}%", f"%{keyword}%", keyword, f"%{keyword}%"])
    if role in ("admin", "user"):
        conds.append("role = ?")
        args.append(role)
    if status in ("normal", "banned"):
        conds.append("status = ?")
        args.append(status)

    where = (" WHERE " + " AND ".join(conds)) if conds else ""
    total = core.query_one(f"SELECT COUNT(*) AS n FROM users{where}", tuple(args))["n"]
    rows = core.query(
        f"SELECT * FROM users{where} ORDER BY id DESC LIMIT ? OFFSET ?",
        tuple(args) + (size, (page - 1) * size),
    )

    ip_counts = {
        r["last_login_ip"]: r["n"]
        for r in core.query(
            "SELECT last_login_ip, COUNT(*) AS n FROM users WHERE last_login_ip IS NOT NULL AND last_login_ip != '' GROUP BY last_login_ip"
        )
    }

    records = []
    for row in rows:
        data = core.user_public(dict(row))
        data["accounts"] = core.query_one(
            "SELECT COUNT(*) AS n FROM accounts WHERE user_id=?", (row["id"],)
        )["n"]
        data["same_ip_count"] = ip_counts.get(data.get("last_login_ip", ""), 0)
        records.append(data)

    stats = {
        "total": core.query_one("SELECT COUNT(*) AS n FROM users")["n"],
        "admins": core.query_one("SELECT COUNT(*) AS n FROM users WHERE role='admin'")["n"],
        "normal": core.query_one("SELECT COUNT(*) AS n FROM users WHERE status='normal'")["n"],
        "banned": core.query_one("SELECT COUNT(*) AS n FROM users WHERE status='banned'")["n"],
        "total_points": core.query_one("SELECT COALESCE(SUM(points_balance),0) AS n FROM users")["n"],
        "total_spent": core.query_one("SELECT COALESCE(SUM(points_spent),0) AS n FROM users")["n"],
    }
    return core.ok({"records": records, "total": total, "page": page, "size": size, "stats": stats})


@bp.put("/users/<int:uid>/nickname")
@core.require_admin
def user_nickname(uid: int):
    body = request.get_json(silent=True) or {}
    nickname = (body.get("nickname") or "").strip()
    if not nickname:
        return core.fail("昵称不能为空")
    if not core.query_one("SELECT 1 FROM users WHERE id=?", (uid,)):
        return core.fail("用户不存在")
    core.execute("UPDATE users SET nickname=? WHERE id=?", (nickname[:20], uid))
    return core.ok({})


@bp.post("/users/<int:uid>/points")
@core.require_admin
def user_points(uid: int):
    body = request.get_json(silent=True) or {}
    try:
        amount = int(body.get("amount"))
    except (TypeError, ValueError):
        return core.fail("积分数量不合法")
    note = (body.get("note") or "").strip() or "管理员调整"
    try:
        balance = core.add_points(uid, amount, "admin_adjust", note)
    except ValueError as exc:
        return core.fail(str(exc))
    return core.ok({"balance": balance})


@bp.put("/users/<int:uid>/status")
@core.require_admin
def user_status(uid: int):
    body = request.get_json(silent=True) or {}
    status = body.get("status") or "normal"
    if status not in ("normal", "banned"):
        return core.fail("状态不合法")
    core.execute("UPDATE users SET status=? WHERE id=?", (status, uid))
    return core.ok({"status": status})


@bp.put("/users/<int:uid>/role")
@core.require_admin
def user_role(uid: int):
    body = request.get_json(silent=True) or {}
    role = body.get("role") or "user"
    if role not in ("user", "admin"):
        return core.fail("角色不合法")
    core.execute("UPDATE users SET role=? WHERE id=?", (role, uid))
    return core.ok({"role": role})


@bp.post("/users")
@core.require_admin
def user_create():
    """管理员建号。

    channel 只是数据归属标记（这个号主要做小蚕还是应用宝），
    不构成登录分墙：登录是单入口，任何账号都能访问两个业务模块。
    """
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    nickname = (body.get("nickname") or "").strip() or email.split("@")[0]
    channel = (body.get("channel") or core.CHANNEL_XIAOCAN).strip().lower()
    role = body.get("role") or "user"
    slot_total = int(body.get("slot_total") or 0)

    if channel not in core.CHANNELS:
        return core.fail(f"渠道只能是 {' / '.join(core.CHANNELS)}")
    if role not in ("user", "admin"):
        return core.fail("角色只能是 user / admin")
    if not email or "@" not in email:
        return core.fail("请输入正确的邮箱")
    if len(password) < 8:
        return core.fail("密码至少 8 位")
    if core.query_one("SELECT 1 FROM users WHERE lower(email)=?", (email,)):
        return core.fail("该邮箱已存在")

    now = core.iso()
    uid = core.insert(
        "users",
        {
            "email": email,
            "password_hash": core.hash_password(password),
            "nickname": nickname[:20],
            "role": role,
            "channel": channel,
            "status": "normal",
            "points_balance": 0,
            "points_spent": 0,
            "invite_code": core.gen_invite_code(),
            "inviter_id": None,
            "email_notify": 1,
            "slot_total": max(0, slot_total),
            "slot_used": 0,
            "last_login_ip": "",
            "last_login_time": None,
            "created_time": now,
        },
    )
    return core.ok({"id": uid, "email": email, "channel": channel, "role": role})


@bp.put("/users/<int:uid>/channel")
@core.require_admin
def user_channel(uid: int):
    """改渠道（仅数据归属标记，不影响登录入口与访问范围）。"""
    body = request.get_json(silent=True) or {}
    channel = (body.get("channel") or "").strip().lower()
    if channel not in core.CHANNELS:
        return core.fail(f"渠道只能是 {' / '.join(core.CHANNELS)}")
    if not core.query_one("SELECT 1 FROM users WHERE id=?", (uid,)):
        return core.fail("用户不存在")
    core.execute("UPDATE users SET channel=? WHERE id=?", (channel, uid))
    return core.ok({"channel": channel})


@bp.get("/users/<int:uid>/detail")
@core.require_admin
def user_detail(uid: int):
    """用户 360° 全景画像：基本信息、小蚕账号、应用宝账号、提交历史、积分流水、登录日志、私有项目。"""
    u = core.query_one("SELECT * FROM users WHERE id=?", (uid,))
    if not u:
        return core.fail("用户不存在", 404)
    user_data = core.user_public(dict(u))

    # 小蚕账号列表
    accounts = [dict(r) for r in core.query(
        "SELECT id, nickname, account_info, xc_user_id, avatar, vip_level, is_plus, status, "
        "admin_paused, membership_expire, token_expire, remark, bind_time, updated_time "
        "FROM accounts WHERE user_id=? ORDER BY id DESC",
        (uid,)
    )]
    for acc in accounts:
        acc["features"] = {
            r["feature_name"]: bool(r["enabled"])
            for r in core.query("SELECT feature_name, enabled FROM account_features WHERE account_id=?", (acc["id"],))
        }

    # 应用宝账号列表
    yyb_accounts = [dict(r) for r in core.query(
        "SELECT l.id, l.endpoint_id, l.ref, l.label, l.created_time, e.name as endpoint_name "
        "FROM yyb_account_links l "
        "LEFT JOIN service_endpoints e ON e.id = l.endpoint_id "
        "WHERE l.user_id=? ORDER BY l.id DESC",
        (uid,)
    )]

    # 最近上车任务提交
    submissions = [dict(r) for r in core.query(
        "SELECT id, project_key, script_name, account, points_cost, status, result_msg, created_time "
        "FROM custom_submissions WHERE user_id=? ORDER BY id DESC LIMIT 20",
        (uid,)
    )]

    # 最近积分流水
    transactions = [dict(r) for r in core.query(
        "SELECT id, amount, type, note, created_time FROM points_transactions WHERE user_id=? ORDER BY id DESC LIMIT 20",
        (uid,)
    )]

    # 最近登录日志
    login_logs = [dict(r) for r in core.query(
        "SELECT id, ip, user_agent, status, created_time FROM login_logs WHERE user_id=? ORDER BY id DESC LIMIT 20",
        (uid,)
    )]

    # 隐藏项目授权
    granted_pids = {r["project_id"] for r in core.query("SELECT project_id FROM project_grants WHERE user_id=?", (uid,))}
    all_hidden_projects = [dict(r) for r in core.query("SELECT id, name, channel, project_key FROM projects WHERE hidden=1 ORDER BY channel, id")]
    for p in all_hidden_projects:
        p["granted"] = p["id"] in granted_pids

    # 邀请统计
    invites_count = core.query_one("SELECT COUNT(*) AS n FROM users WHERE inviter_id=?", (uid,))["n"]
    inviter = None
    if u["inviter_id"]:
        inv_u = core.query_one("SELECT id, email, nickname FROM users WHERE id=?", (u["inviter_id"],))
        if inv_u:
            inviter = dict(inv_u)

    # 站内信通知列表
    notifications = [dict(r) for r in core.query(
        "SELECT id, title, content, type, is_read, created_time FROM user_notifications WHERE user_id=? ORDER BY id DESC LIMIT 20",
        (uid,)
    )]

    return core.ok({
        "user": user_data,
        "accounts": accounts,
        "yyb_accounts": yyb_accounts,
        "submissions": submissions,
        "transactions": transactions,
        "login_logs": login_logs,
        "hidden_projects": all_hidden_projects,
        "invite_stats": {
            "invites_count": invites_count,
            "inviter": inviter,
        },
        "notifications": notifications,
    })


@bp.put("/users/<int:uid>/slots")
@core.require_admin
def user_slots(uid: int):
    """调整用户车位配额。"""
    body = request.get_json(silent=True) or {}
    try:
        slot_total = int(body.get("slot_total"))
    except (TypeError, ValueError):
        return core.fail("车位数不合法")
    if slot_total < 0:
        return core.fail("车位数不能小于 0")
    u = core.query_one("SELECT slot_total FROM users WHERE id=?", (uid,))
    if not u:
        return core.fail("用户不存在")
    old_slots = u["slot_total"]
    note = (body.get("note") or "").strip()
    core.execute("UPDATE users SET slot_total=? WHERE id=?", (slot_total, uid))
    core.log_admin_action("adjust_slots", uid, {"old_slots": old_slots, "new_slots": slot_total, "note": note})
    return core.ok({"slot_total": slot_total})


@bp.put("/users/<int:uid>/membership")
@core.require_admin
def user_membership(uid: int):
    """手动调整用户会员等级与到期时间。"""
    body = request.get_json(silent=True) or {}
    u = core.query_one("SELECT * FROM users WHERE id=?", (uid,))
    if not u:
        return core.fail("用户不存在")

    try:
        vip_level = int(body.get("vip_level", 0))
    except (TypeError, ValueError):
        return core.fail("会员等级不合法")
    if vip_level < 0:
        vip_level = 0

    vip_expire = body.get("vip_expire")
    if vip_expire:
        vip_expire = str(vip_expire).strip()
        if vip_expire in ("", "null", "None"):
            vip_expire = None
    else:
        vip_expire = None

    note = (body.get("note") or "").strip()
    core.execute("UPDATE users SET vip_level=?, vip_expire=? WHERE id=?", (vip_level, vip_expire, uid))
    core.log_admin_action("adjust_membership", uid, {
        "old_vip_level": u["vip_level"],
        "new_vip_level": vip_level,
        "old_expire": u["vip_expire"],
        "new_expire": vip_expire,
        "note": note,
    })
    return core.ok({"vip_level": vip_level, "vip_expire": vip_expire})


@bp.get("/vip/levels")
@core.require_admin
def vip_levels():
    """会员等级权益表。

    唯一来源是 server/vip.py —— 前端后台只读这里，避免两边各写一份权益说明导致不一致。
    """
    return core.ok({"levels": vip.benefits_snapshot()})


@bp.post("/users/<int:uid>/grant-benefits")
@core.require_admin
def user_grant_benefits(uid: int):
    """赠送会员车位、会员天数或余额权益。"""
    body = request.get_json(silent=True) or {}
    u = core.query_one("SELECT * FROM users WHERE id=?", (uid,))
    if not u:
        return core.fail("用户不存在")

    grant_type = (body.get("grant_type") or "both").strip()  # slots | membership | both
    slots = int(body.get("slots") or 0)
    vip_level = int(body.get("vip_level") or 1)
    days = int(body.get("days") or 0)
    note = (body.get("note") or "管理员赠送福利").strip()
    notify = bool(body.get("notify", True))

    updated_fields = {}
    gift_desc_parts = []

    # 1. 赠送车位
    if grant_type in ("slots", "both") and slots > 0:
        new_slots = max(0, int(u["slot_total"] or 0) + slots)
        core.execute("UPDATE users SET slot_total=? WHERE id=?", (new_slots, uid))
        updated_fields["slot_total"] = new_slots
        gift_desc_parts.append(f"{slots} 个车位")

    # 2. 赠送会员天数
    if grant_type in ("membership", "both") and days > 0:
        now_dt = core.now_dt()
        curr_expire = core.parse_iso(u["vip_expire"])
        base_dt = curr_expire if (curr_expire and curr_expire > now_dt) else now_dt
        new_expire_dt = base_dt + timedelta(days=days)
        new_expire_str = core.iso(new_expire_dt, ms=False)
        target_vip_level = max(int(u["vip_level"] or 0), vip_level if vip_level > 0 else 1)

        core.execute("UPDATE users SET vip_level=?, vip_expire=? WHERE id=?", (target_vip_level, new_expire_str, uid))
        updated_fields["vip_level"] = target_vip_level
        updated_fields["vip_expire"] = new_expire_str
        gift_desc_parts.append(f"{days} 天 VIP{target_vip_level} 会员")

    if not gift_desc_parts:
        return core.fail("未指定任何有效的赠送项（车位数或天数须大于0）")

    summary_text = "、".join(gift_desc_parts)

    # 3. 站内信通知
    if notify:
        core.insert("user_notifications", {
            "user_id": uid,
            "title": "🎁 恭喜获得系统赠送福利",
            "content": f"系统管理员已为您赠送了 {summary_text}！祝您使用愉快。\n备注：{note}",
            "type": "system",
            "is_read": 0,
            "created_time": core.iso(),
        })

    core.log_admin_action("grant_benefits", uid, {
        "grant_type": grant_type,
        "slots": slots,
        "days": days,
        "vip_level": vip_level,
        "summary": summary_text,
        "note": note,
    })

    return core.ok({
        "msg": f"成功赠送 {summary_text}",
        "summary": summary_text,
        "updated": updated_fields,
    })


@bp.get("/users/<int:uid>/transactions")
@core.require_admin
def user_transactions(uid: int):
    """查看指定用户的收支/积分明细。"""
    if not core.query_one("SELECT 1 FROM users WHERE id=?", (uid,)):
        return core.fail("用户不存在")

    page = core.arg_int("page", 1, 1, 100000)
    size = core.arg_int("size", 15, 1, 100)
    total = core.query_one("SELECT COUNT(*) AS n FROM points_transactions WHERE user_id=?", (uid,))["n"]
    rows = core.query(
        "SELECT id, amount, type, note, created_time FROM points_transactions WHERE user_id=? ORDER BY id DESC LIMIT ? OFFSET ?",
        (uid, size, (page - 1) * size),
    )
    return core.ok({
        "records": [dict(r) for r in rows],
        "total": total,
        "page": page,
        "size": size,
    })


@bp.post("/users/<int:uid>/reset-password")
@core.require_admin
def user_reset_password(uid: int):
    """管理员重置用户密码并吊销其现有 Token。"""
    body = request.get_json(silent=True) or {}
    password = (body.get("password") or "").strip()
    if not password:
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
        password = "".join(secrets.choice(alphabet) for _ in range(12))
    elif len(password) < 8:
        return core.fail("密码至少 8 位")

    u = core.query_one("SELECT id, email, token_version FROM users WHERE id=?", (uid,))
    if not u:
        return core.fail("用户不存在")

    new_tv = (u["token_version"] or 1) + 1
    core.execute(
        "UPDATE users SET password_hash=?, token_version=? WHERE id=?",
        (core.hash_password(password), new_tv, uid),
    )
    core.log_admin_action("reset_password", uid, {"email": u["email"]})
    return core.ok({"password": password, "msg": "密码已重置，且已吊销该用户所有现有登录凭证"})


@bp.post("/users/<int:uid>/kick")
@core.require_admin
def user_kick(uid: int):
    """强制用户所有设备端下线。"""
    u = core.query_one("SELECT id, token_version FROM users WHERE id=?", (uid,))
    if not u:
        return core.fail("用户不存在")
    new_tv = (u["token_version"] or 1) + 1
    core.execute("UPDATE users SET token_version=? WHERE id=?", (new_tv, uid))
    core.log_admin_action("kick_user", uid)
    return core.ok({"token_version": new_tv})


@bp.put("/users/<int:uid>/remark")
@core.require_admin
def user_remark(uid: int):
    """更新用户管理备注。"""
    body = request.get_json(silent=True) or {}
    remark = (body.get("remark") or "").strip()
    if not core.query_one("SELECT 1 FROM users WHERE id=?", (uid,)):
        return core.fail("用户不存在")
    core.execute("UPDATE users SET remark=? WHERE id=?", (remark[:200], uid))
    core.log_admin_action("update_remark", uid, {"remark": remark})
    return core.ok({"remark": remark})


@bp.delete("/users/<int:uid>")
@core.require_admin
def user_delete(uid: int):
    """彻底删除用户及清理其关联资产。"""
    if uid == core.current_user()["id"]:
        return core.fail("不能删除当前正在登录的管理员账号")
    u = core.query_one("SELECT id, email FROM users WHERE id=?", (uid,))
    if not u:
        return core.fail("用户不存在")

    db = core.get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        acc_ids = [r["id"] for r in core.query("SELECT id FROM accounts WHERE user_id=?", (uid,))]
        for aid in acc_ids:
            core.execute("DELETE FROM account_features WHERE account_id=?", (aid,))
            core.execute("DELETE FROM redeem_settings WHERE account_id=?", (aid,))
            core.execute("DELETE FROM redeem_prizes WHERE account_id=?", (aid,))
        core.execute("DELETE FROM accounts WHERE user_id=?", (uid,))
        core.execute("UPDATE yyb_account_links SET user_id=NULL WHERE user_id=?", (uid,))
        core.execute("DELETE FROM project_grants WHERE user_id=?", (uid,))
        core.execute("DELETE FROM custom_submissions WHERE user_id=?", (uid,))
        core.execute("DELETE FROM points_transactions WHERE user_id=?", (uid,))
        core.execute("DELETE FROM login_logs WHERE user_id=?", (uid,))
        core.execute("DELETE FROM user_notifications WHERE user_id=?", (uid,))
        core.execute("DELETE FROM users WHERE id=?", (uid,))
        db.execute("COMMIT")
    except Exception as exc:
        db.execute("ROLLBACK")
        return core.fail(f"删除失败: {exc}")

    core.log_admin_action("delete_user", uid, {"email": u["email"]})
    return core.ok({"deleted": True})


@bp.get("/users/<int:uid>/projects")
@core.require_admin
def user_projects_get(uid: int):
    """获取用户已授权和可授权的隐藏项目。"""
    if not core.query_one("SELECT 1 FROM users WHERE id=?", (uid,)):
        return core.fail("用户不存在")
    granted_ids = {r["project_id"] for r in core.query("SELECT project_id FROM project_grants WHERE user_id=?", (uid,))}
    all_projects = [dict(r) for r in core.query("SELECT id, name, channel, project_key, hidden FROM projects WHERE status='enabled' ORDER BY channel, sort_order, name")]
    for p in all_projects:
        p["granted"] = p["id"] in granted_ids
    return core.ok({"projects": all_projects})


@bp.put("/users/<int:uid>/projects")
@core.require_admin
def user_projects_put(uid: int):
    """批量配置用户的专属隐藏项目授权。"""
    if not core.query_one("SELECT 1 FROM users WHERE id=?", (uid,)):
        return core.fail("用户不存在")
    body = request.get_json(silent=True) or {}
    project_ids = body.get("project_ids") or []
    if not isinstance(project_ids, list):
        return core.fail("project_ids 必须为数组")

    clean_ids = [int(pid) for pid in project_ids if str(pid).isdigit()]
    core.execute("DELETE FROM project_grants WHERE user_id=?", (uid,))
    now = core.iso()
    for pid in clean_ids:
        if core.query_one("SELECT 1 FROM projects WHERE id=?", (pid,)):
            core.execute("INSERT OR IGNORE INTO project_grants (project_id, user_id, created_time) VALUES (?, ?, ?)", (pid, uid, now))

    core.log_admin_action("update_user_projects", uid, {"project_ids": clean_ids})
    return core.ok({"granted_count": len(clean_ids)})


@bp.get("/users/ip-collision")
@core.require_admin
def user_ip_collision():
    """同 IP 碰撞分析：查看使用相同 IP 的所有关联注册/登录账号。"""
    ip = (request.args.get("ip") or "").strip()
    if not ip:
        return core.fail("请提供 IP 地址")
    users = [core.user_public(dict(r)) for r in core.query("SELECT * FROM users WHERE last_login_ip=? ORDER BY id DESC", (ip,))]
    return core.ok({"ip": ip, "total": len(users), "records": users})


@bp.post("/users/batch")
@core.require_admin
def user_batch():
    """批量操作：批量封禁/解封/调积分/调车位/强制下线。"""
    body = request.get_json(silent=True) or {}
    action = (body.get("action") or "").strip()
    user_ids = body.get("user_ids") or []
    params = body.get("params") or {}

    if not isinstance(user_ids, list) or not user_ids:
        return core.fail("请选择至少一个用户")

    clean_uids = [int(u) for u in user_ids if str(u).isdigit()]
    current_admin_id = core.current_user()["id"]

    success_count = 0
    if action == "ban":
        for uid in clean_uids:
            if uid == current_admin_id:
                continue
            core.execute("UPDATE users SET status='banned' WHERE id=?", (uid,))
            success_count += 1
        core.log_admin_action("batch_ban", None, {"uids": clean_uids, "count": success_count})

    elif action == "unban":
        for uid in clean_uids:
            core.execute("UPDATE users SET status='normal' WHERE id=?", (uid,))
            success_count += 1
        core.log_admin_action("batch_unban", None, {"uids": clean_uids, "count": success_count})

    elif action == "adjust_points":
        try:
            amount = int(params.get("amount", 0))
        except (TypeError, ValueError):
            return core.fail("积分数值不合法")
        if amount == 0:
            return core.fail("积分变动值不能为 0")
        note = (params.get("note") or "").strip() or "管理员批量调整"
        for uid in clean_uids:
            try:
                core.add_points(uid, amount, "admin_batch_adjust", note)
                success_count += 1
            except Exception:
                pass
        core.log_admin_action("batch_adjust_points", None, {"uids": clean_uids, "amount": amount, "count": success_count})

    elif action == "adjust_slots":
        try:
            slot_delta = int(params.get("delta", 0))
        except (TypeError, ValueError):
            return core.fail("车位数值不合法")
        for uid in clean_uids:
            core.execute("UPDATE users SET slot_total = MAX(0, slot_total + ?) WHERE id=?", (slot_delta, uid))
            success_count += 1
        core.log_admin_action("batch_adjust_slots", None, {"uids": clean_uids, "delta": slot_delta, "count": success_count})

    elif action == "kick":
        for uid in clean_uids:
            core.execute("UPDATE users SET token_version = token_version + 1 WHERE id=?", (uid,))
            success_count += 1
        core.log_admin_action("batch_kick", None, {"uids": clean_uids, "count": success_count})

    else:
        return core.fail("不支持的批量操作")

    return core.ok({"action": action, "success_count": success_count})


@bp.post("/users/<int:uid>/notify")
@core.require_admin
def user_notify(uid: int):
    """向指定用户发送站内信或邮件通知。"""
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    content = (body.get("content") or "").strip()
    msg_type = (body.get("type") or "system").strip()
    send_email = bool(body.get("send_email"))

    if not title:
        return core.fail("标题不能为空")
    u = core.query_one("SELECT id, email FROM users WHERE id=?", (uid,))
    if not u:
        return core.fail("用户不存在")

    core.insert(
        "user_notifications",
        {
            "user_id": uid,
            "title": title[:100],
            "content": content[:1000],
            "type": msg_type,
            "is_read": 0,
            "created_time": core.iso(),
        },
    )

    email_sent = False
    if send_email and u["email"]:
        try:
            email_sent = mail.send_mail(
                u["email"],
                f"【系统通知】{title}",
                mail.notice_html(title, content),
            )
        except Exception:
            pass

    core.log_admin_action("send_notification", uid, {"title": title, "email_sent": email_sent})
    return core.ok({"notified": True, "email_sent": email_sent})


@bp.get("/audit-logs")
@core.require_admin
def audit_logs():
    """查看管理员操作审计日志。"""
    page = core.arg_int("page", 1, 1, 100000)
    size = core.arg_int("size", 20, 1, 100)
    target_uid = request.args.get("target_user_id")

    clause = ""
    args = []
    if target_uid and target_uid.isdigit():
        clause = " WHERE target_user_id=?"
        args.append(int(target_uid))

    total = core.query_one(f"SELECT COUNT(*) AS n FROM admin_audit_logs{clause}", tuple(args))["n"]
    rows = [dict(r) for r in core.query(
        f"SELECT * FROM admin_audit_logs{clause} ORDER BY id DESC LIMIT ? OFFSET ?",
        tuple(args) + (size, (page - 1) * size),
    )]
    return core.ok({"records": rows, "total": total, "page": page, "size": size})


# ------------------------------------------------------------ 通用 CRUD 工具


# 已知数值列：create/update 时做类型校验，避免字符串/None 被原样写进 INTEGER/REAL 列
_INT_FIELDS = {"points_cost", "points_value", "grant_value", "points_price", "sort_order", "probability_bps", "reward_points"}
_FLOAT_FIELDS = {"price"}


def _coerce_numeric(data: dict) -> str | None:
    """把 data 里已知的数值字段转成 int/float，失败返回错误文案，成功返回 None。"""
    for key, value in list(data.items()):
        if value is None:
            continue
        if key in _INT_FIELDS:
            try:
                data[key] = int(value)
            except (TypeError, ValueError):
                return f"字段 {key} 必须是整数"
        elif key in _FLOAT_FIELDS:
            try:
                data[key] = float(value)
            except (TypeError, ValueError):
                return f"字段 {key} 必须是数字"
    return None


def _crud(table: str, fields: list[str], name_field: str = "name", defaults: dict | None = None):
    """生成 list / create / update / delete 四个处理函数。"""
    defaults = defaults or {}

    def list_items():
        order = "sort_order, id" if _has_column(table, "sort_order") else "id"
        rows = core.query(f"SELECT * FROM {table} ORDER BY {order}")
        return core.ok([dict(r) for r in rows])

    def create_item():
        body = request.get_json(silent=True) or {}
        if name_field and not (body.get(name_field) or "").strip():
            return core.fail("请填写名称")
        data = {k: body.get(k, defaults.get(k)) for k in fields if k in body or k in defaults}
        if name_field and not data.get(name_field):
            return core.fail("请填写名称")
        numeric_err = _coerce_numeric(data)
        if numeric_err:
            return core.fail(numeric_err)
        if table == "products" and not data.get("code"):
            data["code"] = "custom_" + secrets.token_hex(4)
        data.setdefault("status", "enabled")
        if _has_column(table, "created_time"):
            data.setdefault("created_time", core.iso())
        if _has_column(table, "sort_order"):
            data.setdefault("sort_order", 0)
        check = _unique_check(table, data)
        if check:
            return core.fail(check)
        new_id = core.insert(table, data)
        return core.ok({"id": new_id})

    def update_item(item_id: int):
        body = request.get_json(silent=True) or {}
        if not core.query_one(f"SELECT 1 FROM {table} WHERE id=?", (item_id,)):
            return core.fail("记录不存在")
        data = {k: body.get(k) for k in fields if k in body and k != "id"}
        if name_field in data and not str(data[name_field] or "").strip():
            return core.fail("请填写名称")
        numeric_err = _coerce_numeric(data)
        if numeric_err:
            return core.fail(numeric_err)
        check = _unique_check(table, data, item_id)
        if check:
            return core.fail(check)
        if data:
            core.update(table, item_id, data)
        return core.ok({})

    def delete_item(item_id: int):
        if not core.query_one(f"SELECT 1 FROM {table} WHERE id=?", (item_id,)):
            return core.fail("记录不存在")
        core.delete(table, item_id)
        return core.ok({})

    return list_items, create_item, update_item, delete_item


def _has_column(table: str, column: str) -> bool:
    cols = {r["name"] for r in core.query(f"PRAGMA table_info({table})")}
    return column in cols


def _unique_check(table: str, data: dict, item_id: int | None = None) -> str | None:
    if table == "coupon_types" and data.get("name"):
        row = core.query_one("SELECT id FROM coupon_types WHERE name=?", (data["name"],))
        if row and row["id"] != item_id:
            return "同名任务类型已存在"
    return None


# 平台分类
_p_list, _p_create, _p_update, _p_delete = _crud(
    "platforms",
    ["name", "icon", "description", "sort_order", "status"],
    defaults={"icon": "🎯", "description": "", "sort_order": 0, "status": "enabled"},
)
bp.add_url_rule("/platforms", "platforms_list", core.require_admin(_p_list), methods=["GET"])
bp.add_url_rule("/platforms", "platforms_create", core.require_admin(_p_create), methods=["POST"])
bp.add_url_rule("/platforms/<int:item_id>", "platforms_update", core.require_admin(_p_update), methods=["PUT"])
bp.add_url_rule("/platforms/<int:item_id>", "platforms_delete", core.require_admin(_p_delete), methods=["DELETE"])

# 优惠券 / 任务类型
_c_list, _c_create, _c_update, _c_delete = _crud(
    "coupon_types",
    ["name", "label", "description", "points_cost", "sort_order", "status"],
    defaults={"label": "", "description": "", "points_cost": 0, "sort_order": 0, "status": "enabled"},
)
bp.add_url_rule("/coupon-types", "coupons_list", core.require_admin(_c_list), methods=["GET"])
bp.add_url_rule("/coupon-types", "coupons_create", core.require_admin(_c_create), methods=["POST"])
bp.add_url_rule("/coupon-types/<int:item_id>", "coupons_update", core.require_admin(_c_update), methods=["PUT"])
bp.add_url_rule("/coupon-types/<int:item_id>", "coupons_delete", core.require_admin(_c_delete), methods=["DELETE"])

# 卡密档位
_t_list, _t_create, _t_update, _t_delete = _crud(
    "card_tiers",
    ["name", "points_value", "price", "sort_order", "status"],
    defaults={"points_value": 0, "price": 0, "sort_order": 0, "status": "enabled"},
)
bp.add_url_rule("/card-tiers", "tiers_list", core.require_admin(_t_list), methods=["GET"])
bp.add_url_rule("/card-tiers", "tiers_create", core.require_admin(_t_create), methods=["POST"])
bp.add_url_rule("/card-tiers/<int:item_id>", "tiers_update", core.require_admin(_t_update), methods=["PUT"])
bp.add_url_rule("/card-tiers/<int:item_id>", "tiers_delete", core.require_admin(_t_delete), methods=["DELETE"])

# 积分商品
_pr_list, _pr_create, _pr_update, _pr_delete = _crud(
    "products",
    ["code", "name", "product_type", "grant_value", "points_price", "sort_order", "status"],
    defaults={
        "code": "",
        "product_type": "membership",
        "grant_value": 1,
        "points_price": 100,
        "sort_order": 0,
        "status": "enabled",
    },
)
bp.add_url_rule("/products", "products_list", core.require_admin(_pr_list), methods=["GET"])
bp.add_url_rule("/products", "products_create", core.require_admin(_pr_create), methods=["POST"])
bp.add_url_rule("/products/<int:item_id>", "products_update", core.require_admin(_pr_update), methods=["PUT"])
bp.add_url_rule("/products/<int:item_id>", "products_delete", core.require_admin(_pr_delete), methods=["DELETE"])

# 白名单：允许前端拖拽自由排序的表
_SORTABLE_TABLES = ("card_tiers", "products")


@bp.post("/reorder")
@core.require_admin
def reorder():
    """把 ids 的顺序写回 sort_order（0,1,2…），供前端拖拽/上下移动后一次保存。

    ids 必须与库存记录**完全一致**（不重不漏）——拖拽时前端可能拿着过期的列表，
    这种时候宁可让用户刷新重试，也不要静默漏排几条导致顺序错乱。
    """
    body = request.get_json(silent=True) or {}
    table = (body.get("table") or "").strip()
    ids = body.get("ids")
    if table not in _SORTABLE_TABLES:
        return core.fail("该表不支持排序")
    if not isinstance(ids, list) or not ids:
        return core.fail("请提供排序后的 id 列表")
    try:
        ids = [int(i) for i in ids]
    except (TypeError, ValueError):
        return core.fail("id 必须是整数")
    if len(set(ids)) != len(ids):
        return core.fail("id 列表有重复")

    existing = {r["id"] for r in core.query(f"SELECT id FROM {table}")}
    if set(ids) - existing:
        return core.fail("有记录已不存在，请刷新后重试")
    if existing - set(ids):
        return core.fail(f"还有 {len(existing - set(ids))} 条记录没排进来，请刷新后重试")

    db = core.get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        for index, item_id in enumerate(ids):
            db.execute(f"UPDATE {table} SET sort_order=? WHERE id=?", (index, item_id))
        db.execute("COMMIT")
    except Exception:
        db.execute("ROLLBACK")
        raise
    return core.ok({"updated": len(ids)})


# 公告（额外维护 version / published_time）
bp.add_url_rule("/announcements", "ann_list", core.require_admin(lambda: core.ok(
    [dict(r) for r in core.query("SELECT * FROM announcements ORDER BY id DESC")]
)), methods=["GET"])


@bp.post("/announcements")
@core.require_admin
def ann_create():
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    content = body.get("content") or ""
    if not title:
        return core.fail("请填写标题")
    if not content:
        return core.fail("请填写公告内容")
    now = core.iso()
    new_id = core.insert(
        "announcements",
        {"title": title, "content": content, "version": 1, "published_time": now, "updated_time": now},
    )
    return core.ok({"id": new_id})


@bp.put("/announcements/<int:aid>")
@core.require_admin
def ann_update(aid: int):
    body = request.get_json(silent=True) or {}
    row = core.query_one("SELECT * FROM announcements WHERE id=?", (aid,))
    if not row:
        return core.fail("公告不存在")
    title = (body.get("title") or row["title"]).strip()
    content = body.get("content", row["content"])
    # 版本号自增：前端靠它判断「改过就重新弹窗」
    core.update(
        "announcements",
        aid,
        {
            "title": title,
            "content": content,
            "version": int(row["version"]) + 1,
            "published_time": row["published_time"],
            "updated_time": core.iso(),
        },
    )
    return core.ok({})


@bp.delete("/announcements/<int:aid>")
@core.require_admin
def ann_delete(aid: int):
    core.delete("announcements", aid)
    return core.ok({})


# ------------------------------------------------------------ 卡密


def _card_code() -> str:
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    groups = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(4)]
    return "-".join(groups)


@bp.get("/cards")
@core.require_admin
def cards_list():
    page = core.arg_int("page", 1, 1, 100000)
    size = core.arg_int("size", 30, 1, 500)
    status = (request.args.get("status") or "").strip()
    tier_id = (request.args.get("tier_id") or "").strip()
    keyword = (request.args.get("q") or "").strip()

    where, args = [], []
    if status:
        where.append("c.status=?")
        args.append(status)
    if tier_id:
        where.append("c.tier_id=?")
        args.append(int(tier_id))
    if keyword:
        where.append("(c.code LIKE ? OR CAST(c.user_id AS TEXT)=?)")
        args.extend([f"%{keyword}%", keyword])
    clause = (" WHERE " + " AND ".join(where)) if where else ""

    total = core.query_one(f"SELECT COUNT(*) AS n FROM cards c{clause}", tuple(args))["n"]
    rows = core.query(
        f"SELECT c.*, t.name AS tier_name FROM cards c LEFT JOIN card_tiers t ON t.id=c.tier_id"
        f"{clause} ORDER BY c.id DESC LIMIT ? OFFSET ?",
        tuple(args) + (size, (page - 1) * size),
    )
    records = []
    for row in rows:
        item = dict(row)
        if item["user_id"]:
            user = core.query_one("SELECT nickname FROM users WHERE id=?", (item["user_id"],))
            item["user_nickname"] = user["nickname"] if user else ""
        records.append(item)
    return core.ok({"records": records, "total": total, "page": page, "size": size})


@bp.post("/cards/generate")
@core.require_admin
def cards_generate():
    body = request.get_json(silent=True) or {}
    tier = core.query_one("SELECT * FROM card_tiers WHERE id=?", (body.get("tier_id"),))
    if not tier:
        return core.fail("请选择档位")
    try:
        count = int(body.get("count") or 0)
    except (TypeError, ValueError):
        return core.fail("数量不合法")
    count = max(1, min(1000, count))

    codes = []
    while len(codes) < count:
        code = _card_code()
        if core.query_one("SELECT 1 FROM cards WHERE code=?", (code,)):
            continue
        codes.append(code)
        core.insert(
            "cards",
            {
                "code": code,
                "tier_id": tier["id"],
                "points_value": int(tier["points_value"]),
                "status": "unused",
                "user_id": None,
                "created_time": core.iso(),
                "used_time": None,
            },
        )
    return core.ok({"codes": codes, "count": len(codes)})


@bp.post("/cards/void")
@core.require_admin
def cards_void():
    body = request.get_json(silent=True) or {}
    ids = [int(i) for i in (body.get("ids") or [])]
    if not ids:
        return core.fail("请先选择卡密")
    marks = ",".join("?" for _ in ids)
    core.execute(f"UPDATE cards SET status='void' WHERE id IN ({marks}) AND status<>'used'", tuple(ids))
    return core.ok({"count": len(ids)})


@bp.post("/cards/delete")
@core.require_admin
def cards_delete():
    body = request.get_json(silent=True) or {}
    ids = [int(i) for i in (body.get("ids") or [])]
    if not ids:
        return core.fail("请先选择卡密")
    marks = ",".join("?" for _ in ids)
    core.execute(f"DELETE FROM cards WHERE id IN ({marks}) AND status<>'used'", tuple(ids))
    return core.ok({"count": len(ids)})


# ------------------------------------------------------------ 账号订单


def _admin_account_query() -> tuple[str, list]:
    where, args = [], []
    keyword = (request.args.get("q") or "").strip()
    if request.args.get("user_id"):
        where.append("a.user_id=?")
        args.append(int(request.args["user_id"]))
    if request.args.get("account_id"):
        where.append("a.id=?")
        args.append(int(request.args["account_id"]))
    if request.args.get("vip") == "1":
        where.append("a.vip_level>0")
    if request.args.get("vip_level"):
        where.append("a.vip_level=?")
        args.append(int(request.args["vip_level"]))
    if keyword:
        where.append(
            "(a.nickname LIKE ? OR a.account_info LIKE ? OR a.remark LIKE ? OR u.nickname LIKE ? OR u.email LIKE ?)"
        )
        args.extend([f"%{keyword}%"] * 5)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return clause, args


@bp.get("/accounts")
@core.require_admin
def accounts_list():
    page = core.arg_int("page", 1, 1, 100000)
    size = core.arg_int("size", 10, 1, 200)
    clause, args = _admin_account_query()
    total = core.query_one(
        f"SELECT COUNT(*) AS n FROM accounts a LEFT JOIN users u ON u.id=a.user_id{clause}", tuple(args)
    )["n"]
    rows = core.query(
        f"SELECT a.* FROM accounts a LEFT JOIN users u ON u.id=a.user_id{clause} ORDER BY a.id DESC LIMIT ? OFFSET ?",
        tuple(args) + (size, (page - 1) * size),
    )
    records = [xc.serialize_account(dict(r), admin=True) for r in rows]
    return core.ok({"records": records, "total": total, "page": page, "size": size})


@bp.put("/accounts/<int:account_id>/features/<path:name>")
@core.require_admin
def admin_toggle_feature(account_id: int, name: str):
    if not core.query_one("SELECT 1 FROM accounts WHERE id=?", (account_id,)):
        return core.fail("账号不存在")
    return core.ok({"value": xc.toggle_feature(account_id, name)})


@bp.put("/accounts/<int:account_id>/status")
@core.require_admin
def admin_account_status(account_id: int):
    body = request.get_json(silent=True) or {}
    status = body.get("status") or "enabled"
    if status not in ("enabled", "disabled"):
        return core.fail("状态不合法")
    core.execute(
        "UPDATE accounts SET status=?, admin_paused=?, updated_time=? WHERE id=?",
        (status, 1 if status == "disabled" else 0, core.iso(), account_id),
    )
    return core.ok({"status": status})


@bp.post("/accounts/<int:account_id>/refresh-level")
@core.require_admin
def admin_refresh_account_level(account_id: int):
    """查一次小蚕平台，刷新该账号的**真实 SVIP 等级**。

    注意：账号等级是小蚕平台上的属性（`vip_level_info.new_level`），不是本站的会员等级；
    本站只做镜像，所以查询失败时保留原值、不写 0。
    """
    if not core.query_one("SELECT 1 FROM accounts WHERE id=?", (account_id,)):
        return core.fail("账号不存在")
    try:
        return core.ok(xc.refresh_account_level(account_id))
    except ValueError as exc:
        return core.fail(str(exc))
    except Exception as exc:
        return core.fail(f"查询小蚕等级失败：{exc}")


@bp.post("/accounts/refresh-levels")
@core.require_admin
def admin_refresh_account_levels():
    """批量刷新账号等级；不传 ids 就刷新全部。

    每个账号要发一次平台请求，所以逐条处理、逐条汇报：单个失败不影响其它账号。
    """
    body = request.get_json(silent=True) or {}
    ids = body.get("ids")
    if ids:
        try:
            ids = [int(i) for i in ids]
        except (TypeError, ValueError):
            return core.fail("ids 必须是整数数组")
        if len(ids) > 50:
            return core.fail("一次最多刷新 50 个账号，请分批")
    else:
        ids = [r["id"] for r in core.query("SELECT id FROM accounts ORDER BY id")]

    updated, failed, levels = 0, [], {}
    for aid in ids:
        try:
            levels[str(aid)] = xc.refresh_account_level(aid)["vip_level"]
            updated += 1
        except Exception as exc:
            failed.append({"id": aid, "error": str(exc)})

    core.log_admin_action("refresh_account_levels", None, {"updated": updated, "failed": len(failed)})
    return core.ok({"updated": updated, "failed": failed, "levels": levels})


@bp.put("/accounts/<int:account_id>/membership-expire")
@core.require_admin
def admin_account_expire(account_id: int):
    body = request.get_json(silent=True) or {}
    value = (body.get("membership_expire") or "").strip()
    if not core.query_one("SELECT 1 FROM accounts WHERE id=?", (account_id,)):
        return core.fail("账号不存在")
    if value and not core.parse_iso(value):
        return core.fail("时间格式不正确")
    stored = value.replace("T", "T")[:16] if value else None
    core.execute(
        "UPDATE accounts SET membership_expire=?, updated_time=? WHERE id=?",
        (stored, core.iso(), account_id),
    )
    return core.ok({"membership_expire": stored})


@bp.post("/accounts/batch-expire")
@core.require_admin
def admin_accounts_batch_expire():
    """批量改到期：把选中账号的会员到期时间统一设置为同一值（单事务，全成功或全回滚）。"""
    body = request.get_json(silent=True) or {}
    ids = []
    for raw in body.get("ids") or []:
        try:
            ids.append(int(raw))
        except (TypeError, ValueError):
            continue
    value = (body.get("membership_expire") or "").strip()
    if not ids:
        return core.fail("请先勾选账号")
    if not value or not core.parse_iso(value):
        return core.fail("时间格式不正确")
    stored = value.replace("T", "T")[:16]
    unique_ids = sorted(set(ids))
    db = core.get_db()
    db.execute("BEGIN")
    try:
        for account_id in unique_ids:
            db.execute(
                "UPDATE accounts SET membership_expire=?, updated_time=? WHERE id=?",
                (stored, core.iso(), account_id),
            )
        db.execute("COMMIT")
    except Exception:
        db.execute("ROLLBACK")
        return core.fail("批量延长失败，已回滚")
    row = db.execute(
        "SELECT COUNT(*) FROM accounts WHERE id IN ({})".format(",".join("?" * len(unique_ids))),
        tuple(unique_ids),
    ).fetchone()
    return core.ok({"updated": int(row[0]), "membership_expire": stored})


@bp.get("/accounts/<int:account_id>/redeem-prizes")
@core.require_admin
def admin_redeem_prizes(account_id: int):
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


@bp.put("/accounts/<int:account_id>/redeem")
@core.require_admin
def admin_save_redeem(account_id: int):
    body = request.get_json(silent=True) or {}
    enabled = bool(body.get("enabled"))
    exchange_id = body.get("exchange_id")
    start_at = body.get("start_at")
    row = None
    if exchange_id:
        row = core.query_one(
            "SELECT * FROM redeem_prizes WHERE account_id=? AND exchange_id=?", (account_id, exchange_id)
        )
    if enabled and (not row or not row["available"]):
        return core.fail("请选择可抢兑奖品")
    if row:
        start_at = row["start_at"]
    core.execute(
        "INSERT INTO redeem_settings (account_id, exchange_id, start_at, enabled, runner_ready, updated_time) "
        "VALUES (?,?,?,?,1,?) ON CONFLICT(account_id) DO UPDATE SET exchange_id=excluded.exchange_id, "
        "start_at=excluded.start_at, enabled=excluded.enabled, updated_time=excluded.updated_time",
        (account_id, exchange_id, start_at, 1 if enabled else 0, core.iso()),
    )
    return core.ok(xc.redeem_of(account_id))


@bp.get("/account-data")
@core.require_admin
def account_data():
    data = xc.account_data_text()
    return core.ok(data)


# ------------------------------------------------------------ 站点图标（自定义 logo）


# 上传限制：2MB 足够一张 square logo，再大只会拖慢每次页面加载
SITE_LOGO_MAX_BYTES = 2 * 1024 * 1024
# 统一处理成这个尺寸：页面 logo、favicon、邮件抬头都用同一份文件
SITE_LOGO_SIZE = 256


@bp.post("/site-logo")
@core.require_admin
def site_logo_upload():
    """
    上传自定义站点图标。

    统一转成 PNG 存一份（`data/uploads/site-logo.png`），页面、favicon、邮件
    抬头三处共用 —— 不按用途各存一份，省掉"改了 logo 忘了改 favicon"的老问题。

    处理上刻意**保持长宽比**（不裁成正方形）：管理员的 logo 很可能是横向的
    文字标，居中裁切会把内容切掉。前端用 object-fit:contain 显示，不方的地方
    留白比切掉好。
    """
    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        return core.fail("请选择要上传的图片")

    raw = uploaded.read(SITE_LOGO_MAX_BYTES + 1)
    if not raw:
        return core.fail("图片内容为空")
    if len(raw) > SITE_LOGO_MAX_BYTES:
        return core.fail(f"图片过大，请控制在 {SITE_LOGO_MAX_BYTES // 1024 // 1024}MB 以内")

    try:
        from PIL import Image, ImageOps
    except ImportError:  # pragma: no cover - requirements.txt 已含 pillow
        return core.fail("服务端缺少 Pillow，无法处理图片")

    try:
        # 用 PIL 真解一遍：光看扩展名挡不住改名换姓的非图片文件
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception:
        return core.fail("这不是一张能识别的图片，请换 PNG / JPG / WebP")

    # 手机拍的照片带 EXIF 旋转标记，不摆正会躺倒
    image = ImageOps.exif_transpose(image)
    image = image.convert("RGBA")

    longest = max(image.size)
    if longest != SITE_LOGO_SIZE:
        scale = SITE_LOGO_SIZE / longest
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.LANCZOS,
        )

    os.makedirs(core.UPLOAD_DIR, exist_ok=True)
    image.save(core.SITE_LOGO_PATH, "PNG", optimize=True)

    # 上传即启用：管理员传了图却什么都没变，会以为上传失败
    core.set_setting("site_logo_enabled", "true")
    return core.ok({
        "enabled": True,
        "width": image.width,
        "height": image.height,
        "bytes": os.path.getsize(core.SITE_LOGO_PATH),
    })


@bp.delete("/site-logo")
@core.require_admin
def site_logo_delete():
    """删除自定义图标，全站回到内置标。"""
    if os.path.exists(core.SITE_LOGO_PATH):
        os.remove(core.SITE_LOGO_PATH)
    core.set_setting("site_logo_enabled", "false")
    return core.ok({"enabled": False})


# ------------------------------------------------------------ 系统设置


@bp.get("/settings")
@core.require_admin
def settings_get():
    data = core.get_settings()
    # 授权码不回传前端：只告诉前端「配没配」，表单里留空即表示不修改
    data["smtp_password_set"] = "true" if str(data.get("smtp_password") or "").strip() else "false"
    data["smtp_password"] = ""
    # 同上：图标不回传内容，只告诉前端「传没传过」——开关和文件是两个独立状态，
    # 只看 site_logo_enabled 分不清「没传过」和「传了但关着」
    data["site_logo_has_file"] = "true" if os.path.exists(core.SITE_LOGO_PATH) else "false"
    # 只要文件在就给地址（**不看开关**）：设置页要在「已上传但开关关着」时
    # 也能预览到自己的图，否则用户打开开关却看不到变化，会以为上传失败了
    if os.path.exists(core.SITE_LOGO_PATH):
        data["site_logo_url"] = f"/site-icon?v={int(os.path.getmtime(core.SITE_LOGO_PATH))}"
    else:
        data["site_logo_url"] = ""
    # 通知渠道：密钥类字段（钉钉加签 / Telegram token / Webhook token）不回传明文，
    # 只给 `_set` 标记，表单留空即表示「这栏没动」——和 smtp_password 同一套约定。
    for channel, spec in notify.CHANNELS.items():
        for field in spec["secret_fields"]:
            key = notify.setting_key(channel, field)
            data[f"{key}_set"] = "true" if str(data.get(key) or "").strip() else "false"
            data[key] = ""
    # 渠道清单以后端为准，前端不再硬编码一份
    data["notify_channels"] = [
        {"key": channel, "label": spec["label"], "fields": list(spec["fields"]),
         "secret_fields": list(spec["secret_fields"]), "hint": spec["hint"],
         "configured": notify.configured(channel)}
        for channel, spec in notify.CHANNELS.items()
    ]
    return core.ok(data)


@bp.put("/settings")
@core.require_admin
def settings_put():
    body = request.get_json(silent=True) or {}
    allowed = {
        "site_name",
        "site_url",
        "site_logo_enabled",
        "register_enabled",
        "referral_rate_bps",
        # 转盘参数保留：用户端功能未落地，管理端入口已移除；键留着不删，避免历史数据丢失
        "lottery_cost",
        "lottery_daily_limit",
        "checkin_daily_reward",
        "checkin_rewards",
        "checkin_gamble_rewards",
        "checkin_makeup_cost",
        "checkin_makeup_quota",
        "level_refresh_enabled",
        "level_refresh_hour",
        "smtp_host",
        "smtp_port",
        "smtp_ssl",
        "smtp_user",
        "smtp_password",
        "smtp_sender",
        "smtp_from_name",
    }
    # 通知渠道的键由 notify.CHANNELS 生成，避免两处维护
    secret_keys = set()
    for channel, spec in notify.CHANNELS.items():
        for field in spec["fields"]:
            key = notify.setting_key(channel, field)
            allowed.add(key)
            if field in spec["secret_fields"]:
                secret_keys.add(key)
    for key in allowed:
        if key not in body:
            continue
        value = body[key]
        # 口令/密钥留空 = 不改：GET 不回显明文，空值只能理解为「这栏没动」
        if key in secret_keys | {"smtp_password"} and not str(value or "").strip():
            continue
        core.set_setting(key, value)
    return core.ok({})


@bp.post("/settings/mail-test")
@core.require_admin
def settings_mail_test():
    """按当前 SMTP 设置真发一封自检邮件，把真实报错原文回给管理员。"""
    body = request.get_json(silent=True) or {}
    to = (body.get("to") or "").strip() or core.get_setting("smtp_sender", "") or core.current_user()["email"]
    if not to or "@" not in to:
        return core.fail("请填写收件邮箱")
    result = mail.send_mail(
        to,
        "【自检】邮件服务连通测试",
        mail.test_html(),
    )
    if result["sent"]:
        return core.ok({"sent": True, "to": to, "error": ""})
    if result["dry_run"]:
        return core.ok({
            "sent": False,
            "to": to,
            "dry_run": True,
            "error": "未配置 SMTP（主机 / 账号 / 授权码至少缺一项），邮件只写进了 data/mail.log",
        })
    return core.ok({"sent": False, "to": to, "dry_run": False, "error": result["error"]})


@bp.post("/settings/notify-test")
@core.require_admin
def settings_notify_test():
    """给指定渠道发一条自检消息，把真实报错原样回给管理员。"""
    body = request.get_json(silent=True) or {}
    channel = (body.get("channel") or "").strip()
    if channel not in notify.CHANNELS:
        return core.fail("未知通知渠道")
    if not notify.configured(channel):
        return core.fail("该渠道还没填必填项")
    result = notify.send(channel, "【自检】通知渠道连通测试",
                         f"如果你看到这条消息，说明 {notify.CHANNELS[channel]['label']} 配置正确。")
    return core.ok({"channel": channel, "sent": result["sent"], "error": result["error"]})


# ------------------------------------------------------------ 小蚕任务 / 日志


@bp.get("/xiaocan-tasks")
@core.require_admin
def xiaocan_tasks_overview():
    return core.ok(xiaocan_tasks.panel_overview())


@bp.get("/task-logs")
@core.require_admin
def task_logs():
    day = (request.args.get("date") or core.today_str()).strip()
    if not core.parse_iso(day):
        day = core.today_str()
        day = day[:10]
    task = (request.args.get("task") or "").strip()
    return core.ok(xiaocan_tasks.aggregate_events(day[:10], task))


@bp.post("/task-logs/cleanup")
@core.require_admin
def task_logs_cleanup():
    """手动触发过期日志清理与长文本归档，回收磁盘空间与防止 OOM。"""
    body = request.get_json(silent=True) or {}
    keep_cache_days = int(body.get("keep_cache_days", 3))
    keep_signup_days = int(body.get("keep_signup_days", 30))
    res = core.cleanup_expired_logs(keep_cache_days=keep_cache_days, keep_signup_days=keep_signup_days)
    return core.ok(res)


@bp.post("/tasks/reap-zombies")
@core.require_admin
def reap_zombie_tasks():
    """管理员手动收割超时悬挂的僵尸任务。"""
    body = request.get_json(silent=True) or {}
    timeout_mins = int(body.get("timeout_minutes", 15))
    import runner_dispatch
    res = runner_dispatch.reap_zombie_tasks(timeout_minutes=timeout_mins)
    return core.ok(res)


