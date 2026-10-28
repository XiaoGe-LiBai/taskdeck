"""首次安装：一次性创建管理员，状态随 SQLite 持久化，不依赖容器生命周期。"""
from __future__ import annotations

import hmac
import re
import secrets
import sqlite3
import time

from flask import Blueprint, jsonify, request

import core

bp = Blueprint("setup", __name__)
_MAX_FAILURES = 5
_LOCK_SECONDS = 60


def _finish(db: sqlite3.Connection) -> None:
    # 永久标记完成；即使以后误删管理员，也不能重新开放匿名安装入口。
    db.execute("UPDATE installation SET completed=1, setup_code=NULL, failures=0, locked_until=0 WHERE id=1")


def _create_admin(db: sqlite3.Connection, email: str, password: str) -> None:
    db.execute(
        "INSERT INTO users (email,password_hash,nickname,role,status,invite_code,created_time) "
        "VALUES (?,?,'管理员','admin','normal',?,?)",
        (email, core.hash_password(password), core.gen_invite_code(), core.iso()),
    )
    _finish(db)


def validate_admin(email: str, password: str) -> str | None:
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        return "请输入正确的邮箱"
    if not 12 <= len(password) <= 128:
        return "密码长度须为 12～128 位"
    if password.lower() in {"admin12345678", "password12345", "123456789012", "demo12345678"}:
        return "请勿使用常见默认密码"
    return None


def prepare() -> None:
    """兼容旧库；空库支持环境变量预置或网页初始化，所有检查在同一写事务中。"""
    db = core.get_db()
    db.execute("""CREATE TABLE IF NOT EXISTS installation (
        id INTEGER PRIMARY KEY CHECK (id=1),
        completed INTEGER NOT NULL DEFAULT 0,
        setup_code TEXT,
        failures INTEGER NOT NULL DEFAULT 0,
        locked_until REAL NOT NULL DEFAULT 0
    )""")
    db.execute("BEGIN IMMEDIATE")
    try:
        db.execute("INSERT OR IGNORE INTO installation (id) VALUES (1)")
        row = db.execute("SELECT * FROM installation WHERE id=1").fetchone()
        if row["completed"] or db.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
            _finish(db)
            db.commit()
            return

        email = str(core.CONFIG.get("admin_email") or "").strip().lower()
        password = str(core.CONFIG.get("admin_password") or "")
        if email or password:
            error = validate_admin(email, password)
            if not email or not password or error:
                raise RuntimeError("首次初始化的管理员邮箱和密码必须同时提供，密码须为 12～128 位且不能为常见默认值")
            _create_admin(db, email, password)
            db.commit()
            print("[setup] 管理员已按部署配置创建，请使用自己设置的邮箱和密码登录。", flush=True)
            return

        code = row["setup_code"] or secrets.token_urlsafe(32)
        db.execute("UPDATE installation SET setup_code=? WHERE id=1", (code,))
        db.commit()
    except Exception:
        db.rollback()
        raise
    # 只发往部署日志，不进入网页、URL、公开 settings 或 API 响应。
    print(f"[setup] 首次安装：打开站点 /setup 创建管理员。一次性初始化码：{code}", flush=True)


def initialized() -> bool:
    row = core.query_one("SELECT completed FROM installation WHERE id=1")
    return bool(row and row["completed"])


def require_initialized():
    """初始化之前封锁全部业务 API，防止抢先注册和调用 runner 等入口。"""
    allowed = {"/api/setup", "/api/site-info", "/api/site-logo"}
    if request.path.startswith("/api/") and request.path not in allowed and not initialized():
        return _reply(503, "站点尚未准备就绪，请稍后再试")
    return None


def _reply(code: int, msg: str, data=None):
    response = jsonify({"code": code, "msg": msg, "data": data})
    response.status_code = code
    response.headers["Cache-Control"] = "no-store"
    return response


@bp.get("")
def status():
    return _reply(200, "success", {"initialized": initialized()})


@bp.post("")
def complete():
    # 小体积、严格 JSON；不接受表单跨站提交，初始化码必须在 body 中且不记录。
    if (request.content_length or 0) > 4096:
        return _reply(413, "提交内容过长")
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return _reply(400, "请输入完整的初始化信息")
    fields = ("setup_code", "email", "password", "confirm_password")
    if any(not isinstance(body.get(key), str) for key in fields):
        return _reply(400, "请输入完整的初始化信息")
    if any(len(body[key]) > 512 for key in fields):
        return _reply(400, "输入内容过长")
    code = body["setup_code"].strip()
    email = body["email"].strip().lower()
    password = body["password"]

    db = core.get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        row = db.execute("SELECT * FROM installation WHERE id=1").fetchone()
        if not row or row["completed"]:
            db.rollback()
            return _reply(409, "初始化已完成，请登录")
        if db.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
            _finish(db)
            db.commit()
            return _reply(409, "初始化已完成，请登录")
        now = time.time()
        if row["locked_until"] > now:
            db.rollback()
            response = _reply(429, "尝试次数过多，请一分钟后重试")
            response.headers["Retry-After"] = str(max(1, int(row["locked_until"] - now) + 1))
            return response
        if not hmac.compare_digest(code.encode(), (row["setup_code"] or "").encode()):
            failures = (0 if row["locked_until"] else row["failures"]) + 1
            blocked = failures >= _MAX_FAILURES
            db.execute("UPDATE installation SET failures=?, locked_until=? WHERE id=1",
                       (0 if blocked else failures, now + _LOCK_SECONDS if blocked else 0))
            db.commit()
            return _reply(429 if blocked else 403,
                          "尝试次数过多，请一分钟后重试" if blocked else "初始化码不正确")
        error = validate_admin(email, password)
        if not error and password != body["confirm_password"]:
            error = "两次输入的密码不一致"
        if error:
            db.rollback()
            return _reply(400, error)
        if db.execute("SELECT 1 FROM users WHERE lower(email)=?", (email,)).fetchone():
            db.rollback()
            return _reply(409, "该邮箱已存在，请使用其他邮箱")
        _create_admin(db, email, password)
        db.commit()
        return _reply(200, "管理员已创建，请登录", {"initialized": True})
    except Exception:
        db.rollback()
        raise
