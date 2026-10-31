"""美团账号：扫码授权、凭证托管、福利社领券。

实现说明（重要）：
- 扫码与领券依赖 `meituan_assets/` 下的 `run.js` 与 `mtuser-pt-passport` 包，
  这两个文件来自第三方开源项目（无 LICENSE，仅本地自用，见 meituan_assets/NOTICE.md）；
- 本模块自身只做「调用 Node CLI + 解析 JSON + 落库 + 会话管理」，不复制对方业务代码；
- 凭证目录通过 MEITUAN_AUTH_DIR 指到数据卷，容器重建不影响已登录账号。
"""
from __future__ import annotations

import base64
import io
import json
import os
import shutil
import subprocess
import tarfile
import threading
import time
import uuid
from typing import Any

import core

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(SERVER_DIR, "meituan_assets")
RUN_JS = os.path.join(ASSETS_DIR, "run.js")
AUTH_DIR = os.path.join(core.DATA_DIR, "meituan")
SESSION_TTL = 180  # 扫码会话最长存活（秒）

_lock = threading.Lock()
_sessions: dict[str, dict[str, Any]] = {}


# ---------------------------------------------------------------- 运行时准备

def auth_dir() -> str:
    path = os.environ.get("MEITUAN_AUTH_DIR") or AUTH_DIR
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


def ensure_assets() -> bool:
    """离线解压 pt-passport 并补 .bin 软链；缺文件返回 False（不抛异常）。"""
    target = os.path.join(ASSETS_DIR, "node_modules", "@mtuser", "pt-passport", "package")
    if not os.path.exists(os.path.join(target, "dist", "index.js")):
        tgz = [f for f in os.listdir(ASSETS_DIR) if f.startswith("mtuser-pt-passport-")] if os.path.isdir(ASSETS_DIR) else []
        if not tgz:
            return False
        os.makedirs(target, exist_ok=True)
        with tarfile.open(os.path.join(ASSETS_DIR, tgz[0])) as tf:
            tf.extractall(target, filter="data")
    bin_dir = os.path.join(ASSETS_DIR, "node_modules", ".bin")
    os.makedirs(bin_dir, exist_ok=True)
    link = os.path.join(bin_dir, "pt-passport")
    if not os.path.exists(link):
        os.symlink("../@mtuser/pt-passport/package/dist/index.js", link)
        os.chmod(link, 0o755)
    return True


def node_bin() -> str:
    return os.environ.get("MEITUAN_NODE") or shutil.which("node") or ""


def available() -> bool:
    return bool(node_bin()) and os.path.exists(RUN_JS) and ensure_assets()


def run_node(args: list[str], timeout: int = 40) -> dict:
    """执行 run.js 子命令，返回解析后的 JSON（最后一行）。"""
    node = node_bin()
    if not node:
        raise RuntimeError("运行环境缺少 node，无法执行美团相关操作")
    if not ensure_assets():
        raise RuntimeError("美团运行依赖缺失（meituan_assets 不完整）")
    env = {**os.environ, "MEITUAN_AUTH_DIR": auth_dir(), "HOME": os.environ.get("HOME") or "/tmp"}
    proc = subprocess.run([node, RUN_JS, *args], cwd=ASSETS_DIR, env=env,
                          capture_output=True, text=True, timeout=timeout)
    output = (proc.stdout or "").strip().splitlines()
    for line in reversed(output):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    raise RuntimeError(f"run.js 未返回 JSON：{(proc.stderr or proc.stdout or '')[:200]}")


def qr_base64(url: str) -> str:
    """把授权链接画成二维码；缺 qrcode 库时返回空串（前端退化为显示链接）。"""
    try:
        import qrcode
    except ImportError:
        return ""
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------- 扫码会话

def start_session(account_id: int | None = None) -> dict:
    if not available():
        raise RuntimeError("当前环境不支持美团扫码（缺 node 或运行依赖）")
    code = run_node(["auth-get-code"])
    if not code.get("ok") or not code.get("url"):
        raise RuntimeError(code.get("message") or "获取美团授权链接失败")
    session_id = uuid.uuid4().hex[:12]
    session = {
        "id": session_id,
        "account_id": account_id,
        "url": code["url"],
        "qr": qr_base64(code["url"]),
        "status": "waiting",
        "token": "",
        "message": "",
        "created": time.time(),
        "expires": time.time() + SESSION_TTL,
    }
    with _lock:
        _sessions[session_id] = session
    threading.Thread(target=_poll, args=(session_id,), daemon=True).start()
    return public(session)


def _poll(session_id: str) -> None:
    """后台轮询授权结果：成功即落库并绑定账号，超时或失败标记原因。"""
    session = _sessions.get(session_id)
    while session and time.time() < session["expires"]:
        if session["status"] != "waiting":
            return
        try:
            result = run_node(["auth-poll-token"], timeout=60)
        except Exception as exc:
            session["message"] = str(exc)
            time.sleep(2)
            continue
        token = str(result.get("token") or "").strip()
        if result.get("ok") and token:
            # 先落库再改状态：否则调用方看到 success 时凭证可能还没写进去
            try:
                session["account"] = save_account(token, account_id=session["account_id"])
                session["token"] = token
                session["status"] = "success"
            except Exception as exc:
                session["status"] = "failed"
                session["message"] = f"登录成功但保存失败：{exc}"
            return
        time.sleep(2)
    if session and session["status"] == "waiting":
        session["status"] = "expired"
        session["message"] = session.get("message") or "等待超时，请重新发起"


def session_status(session_id: str) -> dict:
    session = _sessions.get(session_id)
    if not session:
        raise ValueError("会话不存在或已过期")
    return public(session)


def cancel_session(session_id: str) -> bool:
    session = _sessions.get(session_id)
    if not session:
        return False
    session["status"] = "cancelled"
    return True


def public(session: dict) -> dict:
    data = {k: v for k, v in session.items() if k != "token"}
    data["has_token"] = bool(session.get("token"))
    return data


# ---------------------------------------------------------------- 账号存储

def ensure_tables() -> None:
    db = core.get_db()
    db.execute("""
    CREATE TABLE IF NOT EXISTS xc_meituan_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      nickname TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL,
      saved_at INTEGER NOT NULL DEFAULT 0,
      last_claimed_at INTEGER NOT NULL DEFAULT 0,
      created_time TEXT NOT NULL
    )""")
    db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_xc_mt_token ON xc_meituan_accounts(token)")


def save_account(token: str, *, account_id: int | None = None, nickname: str = "") -> dict:
    ensure_tables()
    token = token.strip()
    if not token:
        raise ValueError("token 不能为空")
    db = core.get_db()
    row = db.execute("SELECT * FROM xc_meituan_accounts WHERE token=?", (token,)).fetchone()
    if row:
        if account_id is not None:
            db.execute("UPDATE xc_meituan_accounts SET account_id=? WHERE id=?", (account_id, row["id"]))
        return dict(db.execute("SELECT * FROM xc_meituan_accounts WHERE id=?", (row["id"],)).fetchone())
    db.execute(
        "INSERT INTO xc_meituan_accounts (account_id,nickname,token,saved_at,created_time) VALUES (?,?,?,?,?)",
        (account_id, nickname[:40], token, int(time.time()), core.iso()),
    )
    return dict(db.execute("SELECT * FROM xc_meituan_accounts WHERE token=?", (token,)).fetchone())


def list_accounts(account_ids: list[int] | None = None) -> list[dict]:
    ensure_tables()
    rows = core.query("SELECT * FROM xc_meituan_accounts ORDER BY id DESC")
    items = []
    for row in rows:
        item = dict(row)
        item["token_mask"] = mask(item["token"])
        item.pop("token", None)
        if account_ids is None or item["account_id"] in account_ids or item["account_id"] is None:
            items.append(item)
    return items


def mask(token: str) -> str:
    return f"{token[:6]}****{token[-4:]}" if len(token) > 12 else "****"


def delete_account(record_id: int, account_ids: list[int] | None = None) -> bool:
    ensure_tables()
    row = core.query_one("SELECT * FROM xc_meituan_accounts WHERE id=?", (record_id,))
    if not row:
        return False
    if account_ids is not None and row["account_id"] not in account_ids and row["account_id"] is not None:
        return False
    core.execute("DELETE FROM xc_meituan_accounts WHERE id=?", (record_id,))
    return True


def clear_all() -> int:
    ensure_tables()
    row = core.query_one("SELECT COUNT(*) AS n FROM xc_meituan_accounts")
    core.execute("DELETE FROM xc_meituan_accounts")
    return int(row["n"] if row else 0)


# ---------------------------------------------------------------- 领券

def claim(record_id: int | None = None) -> dict:
    """用当前已登录凭证领券。

    run.js 的 issue 命令使用 pt-passport 缓存里的**当前**登录态，
    所以这里先确认凭证存在，再触发；多账号场景需要逐个登录后调用。
    """
    if not available():
        raise RuntimeError("当前环境不支持美团领券（缺 node 或运行依赖）")
    ensure_tables()
    rows = core.query("SELECT * FROM xc_meituan_accounts ORDER BY id DESC")
    if record_id is not None:
        rows = [r for r in rows if r["id"] == record_id]
    if not rows:
        raise ValueError("还没有保存过美团凭证，请先扫码登录")
    started = time.time()
    result = run_node(["issue"], timeout=90)
    if record_id is not None:
        core.execute("UPDATE xc_meituan_accounts SET last_claimed_at=? WHERE id=?", (int(started), record_id))
    return result
