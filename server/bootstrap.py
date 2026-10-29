"""管理员直接由部署环境变量创建，不用网页向导，也没有默认口令。

    docker run -e PANEL_ADMIN_EMAIL=you@example.com \
               -e PANEL_ADMIN_PASSWORD='至少12位' ...

- 空库：按环境变量创建管理员；缺变量或口令不合规直接拒绝启动，避免部署出打不开的后台。
- 已有管理员：环境变量里的口令视为唯一事实，不一致就同步并吊销旧会话（改密码 = 改命令后重启）。
- 已有管理员且没给口令：什么都不做，保留库里现有口令。
"""
from __future__ import annotations

import re
import sqlite3

import core

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 128
COMMON_PASSWORDS = {"admin12345678", "password12345", "123456789012", "demo12345678"}
_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")


def validate_admin(email: str, password: str) -> str | None:
    if len(email) > 254 or not _EMAIL.fullmatch(email):
        return "管理员邮箱格式不正确"
    if not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
        return f"管理员口令须为 {MIN_PASSWORD_LENGTH}～{MAX_PASSWORD_LENGTH} 位"
    if password.lower() in COMMON_PASSWORDS:
        return "请勿使用常见默认口令"
    return None


def _config_credentials() -> tuple[str, str]:
    return (str(core.CONFIG.get("admin_email") or "").strip().lower(),
            str(core.CONFIG.get("admin_password") or ""))


def _create(db: sqlite3.Connection, email: str, password: str) -> None:
    db.execute("BEGIN IMMEDIATE")
    try:
        if db.execute("SELECT 1 FROM users WHERE role='admin'").fetchone():
            db.rollback()
            return
        if db.execute("SELECT 1 FROM users WHERE lower(email)=?", (email,)).fetchone():
            raise RuntimeError(f"PANEL_ADMIN_EMAIL 已被现有账号占用：{email}")
        db.execute(
            "INSERT INTO users (email,password_hash,nickname,role,status,invite_code,created_time) "
            "VALUES (?,?,'管理员','admin','normal',?,?)",
            (email, core.hash_password(password), core.gen_invite_code(), core.iso()),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


def prepare() -> None:
    db = core.get_db()
    admin = db.execute("SELECT * FROM users WHERE role='admin' ORDER BY id LIMIT 1").fetchone()
    email, password = _config_credentials()

    if not admin:
        if not email or not password:
            raise RuntimeError(
                "首次启动缺少管理员配置：请用 -e PANEL_ADMIN_EMAIL=... -e PANEL_ADMIN_PASSWORD=... "
                "重新运行容器（两个变量必须同时提供）"
            )
        error = validate_admin(email, password)
        if error:
            raise RuntimeError(f"PANEL_ADMIN_EMAIL / PANEL_ADMIN_PASSWORD 无效：{error}")
        _create(db, email, password)
        print(f"[admin] 已按部署配置创建管理员：{email}", flush=True)
        return

    if not password:
        return
    error = validate_admin(email or admin["email"], password)
    if error:
        raise RuntimeError(f"PANEL_ADMIN_PASSWORD 无效：{error}")
    if email and email != admin["email"]:
        print(f"[admin] 已有管理员 {admin['email']}，忽略 PANEL_ADMIN_EMAIL；改邮箱请在后台操作。", flush=True)
    if core.verify_password(password, admin["password_hash"]):
        return
    db.execute("UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?",
               (core.hash_password(password), admin["id"]))
    print("[admin] 管理员口令已按部署配置同步，原有登录会话已失效。", flush=True)
