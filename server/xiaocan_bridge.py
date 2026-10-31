"""小蚕账号域逻辑：序列化、功能开关、账号数据导出、报名/抢兑派发、扫码登录。

绑定方式（两条路都可用，不依赖额外配置）：
  1) 手动粘贴「备注#小蚕UserId#小蚕silk_id#token」，多账号用 @ 分隔（与原站「账号数据」格式完全一致）
  2) 扫码绑定：微信开放平台 qrconnect 拿 uuid → 长轮询二维码状态 → 用户确认后
     用 code 走两步小蚕 RPC 换凭证（WechatOpenapiService.AppLogin → SilkwormService.GetClientUserInfo），
     最终仍落成第 1 种的四段格式入库。
"""
from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import secrets
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import requests

try:
    import urllib3.util.connection as urllib3_conn
    urllib3_conn.allowed_gai_family = lambda: socket.AF_INET
except Exception:
    pass

import core
import vip

# 小蚕网关（PC 端签名，与「扫码登录获取token」参考实现一致）
XC_RPC_URL = "https://gw.xiaocantech.com/rpc"
XC_RPC_BACKUP_URL = "https://gwh.xiaocantech.com/rpc"
XC_APP_ID = 25
XC_APP_VERSION = "3.16.9.0"
XC_UA = "XC;iOS;3.16.9"

BIND_LINE_RE = re.compile(r"^\s*([^#@]*)#([^#@]+)#([^#@]+)#([^#@\s]+)\s*$")

# ---------------------------------------------------------------- WAF 熔断
#
# 腾讯云 WAF 在频次超限时返回 403；此时继续重发会把封禁时间越叠越长。
# 所以命中 WAF 后进入冷却期：冷却期内所有网关调用直接失败，不发网络请求。
WAF_BLOCK_SECONDS = 15
_waf_blocked_until = 0.0
_waf_lock = threading.Lock()


def is_waf_blocked() -> bool:
    return time.time() < _waf_blocked_until


def waf_cooldown_seconds() -> int:
    return max(0, int(_waf_blocked_until - time.time()))


def mark_waf_blocked(seconds: int = WAF_BLOCK_SECONDS) -> int:
    """命中 WAF 后调用；返回本次冷却的总秒数。"""
    global _waf_blocked_until
    with _waf_lock:
        _waf_blocked_until = max(_waf_blocked_until, time.time() + seconds)
        return seconds


def clear_waf_block() -> None:
    global _waf_blocked_until
    with _waf_lock:
        _waf_blocked_until = 0.0


def _looks_like_waf(resp) -> bool:
    """WAF 的特征：响应体带 WAF 字样，或网关 server 头是腾讯 stgw。"""
    try:
        server = (resp.headers.get("server") or "").lower()
        if "stgw" in server:
            return True
        body = (resp.text or "")[:2000]
        return "WAF" in body or "waf" in body
    except Exception:
        return False


# ------------------------------------------------------------ 功能开关


def feature_names() -> list[str]:
    """任务开关的规范清单：以 coupon_types 为源，缺失的内置任务补在末尾。"""
    names = [r["name"] for r in core.query("SELECT name FROM coupon_types WHERE status='enabled' ORDER BY sort_order, id")]
    for name in core.TASK_ORDER:
        if name not in names:
            names.append(name)
    return names


def account_features(account_id: int) -> dict:
    stored = {r["feature_name"]: bool(r["enabled"]) for r in core.query(
        "SELECT feature_name, enabled FROM account_features WHERE account_id=?", (account_id,)
    )}
    return {name: bool(stored.get(name, False)) for name in feature_names()}


def toggle_feature(account_id: int, name: str) -> bool:
    row = core.query_one(
        "SELECT enabled FROM account_features WHERE account_id=? AND feature_name=?", (account_id, name)
    )
    value = 0 if (row and row["enabled"]) else 1
    core.execute(
        "INSERT INTO account_features (account_id, feature_name, enabled) VALUES (?,?,?) "
        "ON CONFLICT(account_id, feature_name) DO UPDATE SET enabled=excluded.enabled",
        (account_id, name, value),
    )
    return bool(value)


def enabled_tasks(account_id: int) -> list[str]:
    return [name for name, on in account_features(account_id).items() if on]


# ------------------------------------------------------------ 序列化


def redeem_of(account_id: int) -> dict:
    row = core.query_one("SELECT * FROM redeem_settings WHERE account_id=?", (account_id,))
    if not row:
        return {"enabled": False, "exchange_id": None, "runner_ready": True}
    return {
        "enabled": bool(row["enabled"]),
        "exchange_id": row["exchange_id"],
        "runner_ready": bool(row["runner_ready"]),
        "start_at": row["start_at"],
    }


def latest_signup(account_id: int) -> dict | None:
    row = core.query_one(
        "SELECT * FROM signup_records WHERE account_id=? ORDER BY id DESC LIMIT 1", (account_id,)
    )
    if not row:
        return None
    return {
        "id": row["id"],
        "status": row["status"],
        "tea_name": row["tea_name"],
        "order_numbers": row["order_numbers"],
        "output": row["output"],
        "error": row["error"],
        "panel_id": row["panel_id"],
        "created_time": row["created_time"],
        "finished_time": row["finished_time"],
    }


def panel_label(panel_id) -> tuple[str, str]:
    if not panel_id:
        return "", ""
    row = core.query_one("SELECT name, remark FROM ql_panels WHERE id=?", (panel_id,))
    if not row:
        return "", ""
    return row["name"], row["remark"]


def serialize_account(account: dict, admin: bool = False) -> dict:
    data = {
        "id": account["id"],
        "user_id": account["user_id"],
        "nickname": account["nickname"],
        "account_info": account["account_info"],
        "access_token": account["access_token"],
        "avatar": account["avatar"],
        "vip_level": account["vip_level"],
        "is_plus": account["is_plus"],
        "status": account["status"],
        "admin_paused": account["admin_paused"],
        "membership_expire": account["membership_expire"],
        "token_expire": account["token_expire"],
        "remark": account["remark"],
        "bind_time": account["bind_time"],
        "created_time": account["created_time"],
        "updated_time": account["updated_time"],
        "features": account_features(account["id"]),
        "redeem": redeem_of(account["id"]),
        "signup": latest_signup(account["id"]),
    }
    if admin:
        owner = core.query_one("SELECT nickname, email FROM users WHERE id=?", (account["user_id"],))
        name, remark = panel_label(account["default_panel_id"])
        bname, bremark = panel_label(account["brand_panel_id"])
        data.update(
            {
                "user_nickname": owner["nickname"] if owner else "",
                "user_email": owner["email"] if owner else "",
                "xc_user_id": account["xc_user_id"],
                "default_panel_name": name,
                "default_panel_remark": remark,
                "brand_panel_name": bname,
                "brand_panel_remark": bremark,
            }
        )
    return data


def account_data_text(skip_expired: bool = False) -> dict:
    """导出「备注#小蚕UserId#silk_id#token」，多账号 @ 分隔。"""
    rows = core.query(
        "SELECT * FROM accounts WHERE account_info<>'' AND access_token<>'' ORDER BY id"
    )
    lines, skipped = [], 0
    for row in rows:
        nickname = (row["remark"] or row["nickname"] or "").strip()
        user_id = (row["xc_user_id"] or "").strip()
        silk_id = (row["account_info"] or "").strip()
        token = (row["access_token"] or "").strip()
        if not user_id or not silk_id or not token:
            skipped += 1
            continue
        if skip_expired and row["token_expire"] and core.parse_iso(row["token_expire"]) and core.parse_iso(row["token_expire"]) < core.now_dt():
            skipped += 1
            continue
        lines.append(f"{nickname}#{user_id}#{silk_id}#{token}")
    return {"text": "@".join(lines), "count": len(lines), "skipped": skipped}


def _decode_jwt_payload(token: str) -> dict:
    """不校验签名，只取 payload（小蚕 token 是 {"UserId":x,"exp":...}）。"""
    try:
        parts = (token or "").split(".")
        if len(parts) < 2:
            return {}
        seg = parts[1]
        seg += "=" * (-len(seg) % 4)
        raw = base64.urlsafe_b64decode(seg.encode())
        data = json.loads(raw.decode("utf-8", "replace"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def token_expire_of(token: str) -> str | None:
    """从小蚕 JWT 里取 exp。"""
    payload = _decode_jwt_payload(token)
    if payload.get("exp"):
        try:
            return core.iso(core.now_dt().fromtimestamp(int(payload["exp"]), core.CN_TZ), ms=False)
        except Exception:
            return None
    return None


def token_user_id(token: str) -> str:
    payload = _decode_jwt_payload(token)
    for key in ("UserId", "user_id", "userId", "uid"):
        if payload.get(key):
            return str(payload[key])
    return ""


# ------------------------------------------------------------ 绑定


def bind_from_lines(user_id: int, raw: str, account_id: int | None = None) -> dict:
    """解析粘贴文本并入库（多个账号用 @ 换行分隔）。account_id 存在时为「更新数据」。"""
    text = (raw or "").strip()
    if not text:
        raise ValueError("绑定内容为空")

    chunks = [c.strip() for c in re.split(r"[@\n\r]+", text) if c.strip()]
    results, errors = [], []
    for chunk in chunks:
        match = BIND_LINE_RE.match(chunk)
        if not match:
            errors.append(f"格式不符：{chunk[:40]}")
            continue
        nickname, xc_user_id, silk_id, token = (p.strip() for p in match.groups())
        try:
            results.append(_upsert_account(user_id, nickname, xc_user_id, silk_id, token, account_id))
        except ValueError as exc:
            # 单个失败（最常见：车位已满）不该连累其它账号，收集原因继续
            errors.append(f"{silk_id or nickname}：{exc}")
            continue
        account_id = None  # 一次只更新第一个账号
    if not results:
        raise ValueError("；".join(errors) or "没有可解析的账号数据")
    return {"accounts": results, "errors": errors}


def _upsert_account(user_id: int, nickname: str, xc_user_id: str, silk_id: str, token: str, account_id=None) -> dict:
    now = core.iso()
    token_expire = token_expire_of(token) if token.count(".") == 2 else None
    if not xc_user_id:
        xc_user_id = token_user_id(token)

    row = None
    if account_id:
        row = core.query_one("SELECT * FROM accounts WHERE id=? AND user_id=?", (account_id, user_id))
        if not row:
            raise ValueError("账号不存在或不属于当前用户")
    if row is None:
        row = core.query_one("SELECT * FROM accounts WHERE user_id=? AND account_info=?", (user_id, silk_id))

    if row:
        core.update(
            "accounts",
            row["id"],
            {
                "nickname": nickname or row["nickname"],
                "xc_user_id": xc_user_id or row["xc_user_id"],
                "account_info": silk_id,
                "access_token": token,
                "token_expire": token_expire or row["token_expire"],
                "remark": nickname,
                "updated_time": now,
            },
        )
        target_id = row["id"]
    else:
        # 新增账号前先检查车位容量 = 购买的车位 + 等级赠送（vip.effective_slots）。
        # 注意：历史上这里从不校验，本次才补上；超量用户已存在的账号不受影响（只拦新增）。
        owner = core.query_one("SELECT * FROM users WHERE id=?", (user_id,))
        used = core.query_one(
            "SELECT COUNT(*) AS n FROM accounts WHERE user_id=?", (user_id,)
        )["n"]
        capacity = vip.effective_slots(owner)
        if used >= capacity:
            tier = vip.table(vip.current_level(owner))["name"]
            raise ValueError(
                f"车位已满（{used}/{capacity}）：请先删除不用的账号，或升级会员增加车位（当前 {tier}）"
            )
        target_id = core.insert(
            "accounts",
            {
                "user_id": user_id,
                "nickname": nickname or silk_id[-4:],
                "account_info": silk_id,
                "xc_user_id": xc_user_id,
                "access_token": token,
                "avatar": "",
                "vip_level": 0,
                "is_plus": 0,
                "status": "enabled",
                "admin_paused": 0,
                "membership_expire": None,
                "token_expire": token_expire,
                "remark": nickname,
                "signup_error": "",
                "default_panel_id": None,
                "brand_panel_id": None,
                "bind_time": now,
                "created_time": now,
                "updated_time": now,
            },
        )
    # 更新车位占用
    core.execute(
        "UPDATE users SET slot_used=(SELECT COUNT(*) FROM accounts WHERE user_id=?) WHERE id=?",
        (user_id, user_id),
    )
    account = core.query_one("SELECT * FROM accounts WHERE id=?", (target_id,))
    return serialize_account(dict(account))


# ------------------------------------------------------------ 扫码会话（微信开放平台 + 小蚕 RPC）

# 小蚕 PC 端登录用的微信开放平台应用（与原站「扫码登录」一致）
WX_APPID = "wxf6738eeaf6596977"
WX_REDIRECT_URI = "https%3A%2F%2Fgw.realtech-inc.com%2Fstatic%2Foffical%2Fsilk.html"
WX_QRCONNECT_URL = (
    f"https://open.weixin.qq.com/connect/qrconnect"
    f"?appid={WX_APPID}&scope=snsapi_login&redirect_uri={WX_REDIRECT_URI}"
)
WX_QR_IMG_URL = "https://open.weixin.qq.com/connect/qrcode/"
WX_QR_POLL_URL = "https://long.open.weixin.qq.com/connect/l/qrconnect"

_QR_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.6478.61 Safari/537.36"
)

_QR_SESSIONS: dict[str, dict] = {}
_QR_TTL = 300  # 二维码有效期（秒）


def _gc_qr_sessions() -> None:
    """惰性清理：每次新建/查询会话时顺手删掉过期与已终结的会话，防内存只进不出。

    done 状态多留一段宽限（2×TTL），让前端最后一次轮询还能拿到 account 再被回收。
    """
    now = time.time()
    stale = []
    for sid, s in _QR_SESSIONS.items():
        age = now - s.get("created", now)
        state = s.get("state")
        if age > _QR_TTL * 2:
            stale.append(sid)
        elif age > _QR_TTL and state != "done":
            stale.append(sid)
    for sid in stale:
        _QR_SESSIONS.pop(sid, None)


def fetch_qr_uuid() -> str:
    """请求 qrconnect 页面，从 HTML 里解析出二维码 uuid。"""
    resp = requests.get(WX_QRCONNECT_URL, headers={"user-agent": _QR_UA}, timeout=10)
    resp.raise_for_status()
    match = re.search(r"/connect/qrcode/([0-9a-zA-Z_-]+)", resp.text)
    if not match:
        raise RuntimeError("无法从微信 qrconnect 页面解析二维码 uuid")
    return match.group(1)


def poll_wx_status(session: dict) -> tuple[int, str]:
    """短轮询一次微信扫码状态。

    返回 (errcode, code)：408=等待扫码 404=已扫码待确认 405=已确认(带 code) 402=过期 403=拒绝。
    微信长轮询在无人扫码时会挂住，所以这里用较短的读超时：超时按「等待」处理，不终结会话。
    """
    params = {"uuid": session["uuid"]}
    if session.get("last"):
        params["last"] = session["last"]
    resp = requests.get(WX_QR_POLL_URL, params=params,
                        headers={"user-agent": _QR_UA}, timeout=(5, 4))
    resp.raise_for_status()
    match = re.search(r"window\.wx_errcode=(\d+);", resp.text)
    if not match:
        raise RuntimeError(f"无法解析扫码状态：{resp.text[:120]}")
    errcode = int(match.group(1))
    code = ""
    if errcode == 404:
        session["last"] = "404"
    elif errcode == 405:
        found = re.search(r"window\.wx_code='([^']*)'", resp.text)
        code = found.group(1) if found else ""
    return errcode, code


def parse_vip_level(info: dict) -> int:
    """从小蚕 `GetClientUserInfo` 的 user_info 里取**平台上的真实 SVIP 等级**。

    与「小蚕」脚本同一口径（`小蚕会员专属返利券.py` / `小蚕限量大牌券-代理版.py`）：
    优先 `vip_level_info.new_level`，兜底 `client_vip.level`，取不到按 0。
    """
    level = (info.get("vip_level_info") or {}).get("new_level")
    if level is None:
        level = (info.get("client_vip") or {}).get("level")
    try:
        return int(level)
    except (TypeError, ValueError):
        return 0


def fetch_vip_level(xc_user_id: str, silk_id: str, token: str) -> int:
    """向小蚕查一次该账号的真实 SVIP 等级（网络/鉴权失败会抛异常）。"""
    resp = xiaocan_rpc(
        "Silkworm",
        "SilkwormService.GetClientUserInfo",
        {
            "user_id": int(xc_user_id),
            "inviter_silk_id": 0,
            "up": {"rcp": 1, "rc": 0, "dm": "microsoft", "re_ch": ""},
            "from_po_id": 0,
            "from_aid": 0,
        },
        user_id=xc_user_id,
        silk_id=silk_id,
        token=token,
    )
    return parse_vip_level(resp.get("user_info") or {})


def refresh_account_level(account_id: int, user_id: int | None = None) -> dict:
    """刷新某账号的 SVIP 等级并写库。

    带 user_id 时顺带做归属校验（用户端调自己的账号用）。
    账号等级是**小蚕平台上的真实属性**，不是本站的会员等级 —— 只在调用平台成功后才写。
    """
    sql = "SELECT * FROM accounts WHERE id=?"
    args: tuple = (account_id,)
    if user_id is not None:
        sql += " AND user_id=?"
        args = (account_id, user_id)
    acc = core.query_one(sql, args)
    if not acc:
        raise ValueError("账号不存在或不属于当前用户")

    xc_user_id = str(acc["xc_user_id"] or "").strip()
    token = str(acc["access_token"] or "").strip()
    if not xc_user_id or not token:
        raise ValueError("账号缺少 UserId 或 token，无法查询等级")

    level = fetch_vip_level(xc_user_id, str(acc["account_info"] or ""), token)
    core.update("accounts", account_id, {"vip_level": level, "updated_time": core.iso()})
    return {"id": account_id, "vip_level": level}


def refresh_all_levels(gap_seconds: float = 1.5) -> dict:
    """把所有账号的等级刷一遍（顺序执行，单个失败不影响后面）。

    `gap_seconds` 是每条之间歇的时间 —— 这是别人的平台，别当自家接口打。
    """
    rows = core.query("SELECT id FROM accounts ORDER BY id")
    ok_count, failed = 0, []
    for i, r in enumerate(rows):
        if i:
            time.sleep(gap_seconds)
        try:
            refresh_account_level(r["id"])
            ok_count += 1
        except Exception as exc:
            failed.append({"id": r["id"], "error": str(exc)[:80]})
    summary = {"total": len(rows), "updated": ok_count, "failed": failed}
    print(f"[level_refresh] 刷新完成：共 {summary['total']} 个，成功 {ok_count}，失败 {len(failed)}")
    for item in failed:
        print(f"[level_refresh]   #{item['id']} 失败：{item['error']}")
    return summary


# 每天定时刷新等级：进程内只允许起一个线程
_level_refresh_lock = threading.Lock()
_level_refresh_started = False


def start_level_refresh_daemon() -> None:
    """后台守护线程：每天在设定时刻把【所有账号】的 SVIP 等级从小蚕平台刷一遍。

    为什么要自动刷：等级是平台属性、凭据会过期，靠人工点按钮不现实，
    但等级又直接影响任务适配（比如免单券只认 SVIP5-6）。

    设计取舍：
      · 每 10 分钟看一次表，同一天只跑一次；顺序执行、每条之间歇 1.5 秒 —— 别把平台打爆
      · 凭据失效（401）的账号计入失败继续跑，**不会把等级写成 0**
      · 开关与执行时刻放 settings，后台可改：`level_refresh_enabled` / `level_refresh_hour`
    """
    global _level_refresh_started
    with _level_refresh_lock:
        if _level_refresh_started:
            return
        _level_refresh_started = True

    def _worker():
        time.sleep(60)  # 启动后先让建库/种子跑完，别抢
        last_run_date = ""
        while True:
            try:
                raw = str(core.get_setting("level_refresh_enabled", "true")).strip().lower()
                enabled = raw not in ("0", "false", "no", "off", "")
                try:
                    hour = int(str(core.get_setting("level_refresh_hour", "4")).strip())
                except (TypeError, ValueError):
                    hour = 4
                now = core.now_dt()
                today = now.strftime("%Y-%m-%d")
                if enabled and now.hour == hour and last_run_date != today:
                    last_run_date = today  # 先占位，避免同一天重复触发
                    refresh_all_levels()
            except Exception as exc:
                print(f"[level_refresh] 守护线程异常: {exc}")
            time.sleep(600)

    threading.Thread(target=_worker, name="level-refresh", daemon=True).start()
    print("[level_refresh] 已启动每日账号等级刷新线程")


def exchange_code(code: str) -> tuple[str, int]:
    """code → (「nickname#user_id#silk_id#access_token」四段串, 平台真实 SVIP 等级)。"""
    login = xiaocan_rpc(
        "WechatOpenapi", "WechatOpenapiService.AppLogin",
        {"code": code},
    )
    user_info = login.get("user_info") or {}
    user_id = str(user_info.get("user_id") or "")
    token = (user_info.get("token") or {}).get("access_token") or ""
    if not user_id or not token:
        raise RuntimeError("AppLogin 未返回 user_id / access_token")

    detail_resp = xiaocan_rpc(
        "Silkworm", "SilkwormService.GetClientUserInfo",
        {
            "user_id": int(user_id),
            "inviter_silk_id": 0,
            "up": {"rcp": 1, "rc": 0, "dm": "microsoft", "re_ch": ""},
            "from_po_id": 0,
            "from_aid": 0,
        },
        user_id=user_id, token=token,
    )
    detail = detail_resp.get("user_info") or {}
    silk_id = str(detail.get("silk_id") or "")
    if not silk_id:
        raise RuntimeError("GetClientUserInfo 未返回 silk_id")
    nickname = detail.get("nickname") or user_info.get("nick_name") or ""
    # 这个接口本来就返回了等级，顺手带出去，省一次请求
    return f"{nickname}#{user_id}#{silk_id}#{token}", parse_vip_level(detail)


def start_qr_session(user_id: int, account_id: int | None = None) -> dict:
    """生成扫码会话：取微信二维码 uuid 并登记会话。"""
    _gc_qr_sessions()
    qr_uuid = fetch_qr_uuid()
    session_id = secrets.token_hex(16)
    _QR_SESSIONS[session_id] = {
        "user_id": user_id,
        "account_id": account_id,
        "state": "waiting",
        "uuid": qr_uuid,
        "last": None,
        "result": None,
        "error": None,
        "account": None,
        "created": time.time(),
    }
    return {"session_id": session_id, "qrcode_url": f"/api/xiaocan/qrcode/img/{session_id}"}


def qr_status(session_id: str) -> dict:
    """查询扫码状态；用户确认后自动兑换凭证并写入账号。"""
    _gc_qr_sessions()
    session = _QR_SESSIONS.get(session_id)
    if not session:
        return {"state": "expired"}
    if time.time() - session["created"] > _QR_TTL and session["state"] == "waiting":
        return {"state": "expired"}
    if session["state"] == "done":
        return {"state": "done", "account": session.get("account")}
    if session["state"] == "error":
        return {"state": "error", "error": session.get("error") or ""}

    try:
        errcode, code = poll_wx_status(session)
    except Exception:
        # 网络抖动不终结会话，让前端继续轮询
        return {"state": "waiting"}

    if errcode == 408:
        return {"state": "waiting"}
    if errcode == 404:
        session["state"] = "scanned"
        return {"state": "scanned"}
    if errcode == 402:
        session["state"] = "expired"
        return {"state": "expired"}
    if errcode == 403:
        session["state"] = "error"
        session["error"] = "用户取消了授权"
        return {"state": "error", "error": session["error"]}
    if errcode != 405 or not code:
        return {"state": "waiting"}

    # 用户已确认 → 兑换凭证并入库
    try:
        text, level = exchange_code(code)
        data = bind_from_lines(session["user_id"], text, session["account_id"])
        # 顺手写入平台真实等级（上面那个接口本来就返回了，不额外发请求）
        bound = data.get("accounts") or []
        if bound:
            core.update("accounts", bound[0]["id"], {"vip_level": level, "updated_time": core.iso()})
            data["accounts"][0]["vip_level"] = level
    except Exception as exc:
        session["state"] = "error"
        session["error"] = str(exc)
        return {"state": "error", "error": session["error"]}
    session["state"] = "done"
    session["result"] = text
    session["account"] = data["accounts"][0] if data.get("accounts") else None
    return {"state": "done", "account": session.get("account")}


def qr_image_bytes(session_id: str) -> bytes:
    """二维码图片：优先代理微信原图，失败时本地渲染 uuid 文本。"""
    session = _QR_SESSIONS.get(session_id)
    if not session:
        raise KeyError("会话不存在")
    try:
        resp = requests.get(WX_QR_IMG_URL + session["uuid"],
                            headers={"user-agent": _QR_UA}, timeout=10)
        resp.raise_for_status()
        if resp.content:
            return resp.content
    except Exception:
        pass
    return render_qr_png(session["uuid"])


def render_qr_png(text: str) -> bytes:
    """本地渲染二维码：有 qrcode 库就用，否则给一张占位 PNG。"""
    try:
        import io

        import qrcode  # type: ignore

        img = qrcode.make(text)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        return _PLACEHOLDER_PNG


_PLACEHOLDER_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000a49444154789c6300010000050001"
    "0d0a2db40000000049454e44ae426082"
)


# ------------------------------------------------------------ 小蚕 RPC（预留）


def _xc_sign(server: str, method: str, silk_id: str = "0") -> tuple[str, str, str]:
    """小蚕网关签名：x-nami 由 uuid 与 silk_id 拼接，x-ashe = md5(md5("server.method") + garen + nami)。"""
    y = secrets.token_hex(16)
    silk = str(silk_id or "0")
    end = max(4, 20 - len(silk) - 4)
    x_nami = y[0:4] + silk + y[4:end]
    x_garen = str(int(time.time() * 1000))
    inner = hashlib.md5(f"{server}.{method}".lower().encode()).hexdigest()
    x_ashe = hashlib.md5((inner + x_garen + x_nami).encode()).hexdigest()
    return x_nami, x_garen, x_ashe


def xiaocan_rpc(
    server: str,
    method: str,
    payload: dict | None = None,
    *,
    user_id: str | int = "0",
    silk_id: str | int = "0",
    token: str = "",
    app_id: int = XC_APP_ID,
    city_code: int | None = None,
) -> dict:
    """调用小蚕网关 RPC，返回完整响应体（业务错误抛 RuntimeError）。

    server 形如 'Silkworm'，method 形如 'SilkwormService.GetClientUserInfo'；
    请求体就是业务参数本身，方法名靠 methodname 头传递。

    city_code 非空时附带 x-City 头：活动/店铺类接口按城市返回数据，
    登录与用户信息接口不需要它（传 None 就保持原样，不改变现有调用）。
    """
    if is_waf_blocked():
        remain = waf_cooldown_seconds()
        raise RuntimeError(
            f"当前网络处于官方 WAF 频次拦截冷却中（剩余约 {remain} 秒），已自动暂停请求以避免延长封禁；"
            "可换网络（手机热点/重启光猫）或等待冷却结束"
        )

    body = dict(payload or {})
    body.setdefault("app_id", app_id)
    data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()

    last_error = ""
    for url in (XC_RPC_URL, XC_RPC_BACKUP_URL):
        host = urllib.parse.urlparse(url).netloc
        x_nami, x_garen, x_ashe = _xc_sign(server, method, str(silk_id))
        headers = {
            "Host": host,
            "appid": str(app_id),
            "content-type": "application/json",
            "accept": "*/*",
            "accept-language": "zh-Hans-CN;q=1.0",
            "user-agent": XC_UA,
            "version": XC_APP_VERSION,
            "x-version": XC_APP_VERSION,
            "servername": server,
            "methodname": method,
            "x-annie": "XC",
            "x-platform": "iOS",
            "x-vayne": str(user_id or "0"),
            "x-teemo": str(silk_id or "0"),
            "x-sivir": token or "",
            "x-garen": x_garen,
            "x-nami": x_nami,
            "x-ashe": x_ashe,
        }
        if city_code:
            headers["x-City"] = str(int(city_code))
        try:
            resp = requests.post(url, headers=headers, data=data, timeout=25)
        except Exception as exc:
            last_error = f"{host} 连接异常：{exc}"
            continue
        if resp.status_code == 401:
            raise RuntimeError("小蚕凭据已失效（HTTP 401），请重新扫码绑定")
        if resp.status_code == 403:
            if _looks_like_waf(resp):
                seconds = mark_waf_blocked()
                raise RuntimeError(
                    f"被官方 WAF 拦截（HTTP 403），已进入 {seconds} 秒熔断冷却；"
                    "常见原因是代理/VPN/TUN 或当前 IP 频次超限"
                )
            raise RuntimeError("小蚕网关拦截（HTTP 403），请稍后重试或降低频率")
        if resp.status_code >= 400:
            last_error = f"{host} HTTP {resp.status_code}"
            continue
        try:
            res = resp.json()
        except ValueError:
            last_error = f"{host} 返回非 JSON：{resp.text[:120]}"
            continue
        status = res.get("status") or {}
        code = status.get("code")
        if code in (0, None):
            return res
        msg = status.get("msg") or status.get("message") or res.get("msg") or "未知错误"
        raise RuntimeError(f"{method} 业务错误：[{code}] {msg}")
    raise RuntimeError(f"小蚕网关请求失败：{last_error}")


# ------------------------------------------------------------ 报名 / 抢兑


REPORT_PATH = os.path.join(core.DATA_DIR, "runner_calls.log")


def log_runner(line: str) -> None:
    os.makedirs(core.DATA_DIR, exist_ok=True)
    with open(REPORT_PATH, "a", encoding="utf-8") as fh:
        fh.write(f"{core.iso()} {line}\n")


def submit_signup(user_id: int, account: dict, tea_name: str, order_numbers: str) -> dict:
    """大牌券报名：落库 + 派发到青龙面板执行。"""
    import runner_dispatch

    now = core.iso()
    record_id = core.insert(
        "signup_records",
        {
            "account_id": account["id"],
            "user_id": user_id,
            "tea_name": tea_name,
            "order_numbers": order_numbers,
            "status": "pending",
            "output": "",
            "error": "",
            "panel_id": account["default_panel_id"],
            "created_time": now,
            "finished_time": None,
        },
    )
    dispatch = runner_dispatch.dispatch_signup(record_id, account)
    if dispatch.get("ok"):
        core.execute(
            "UPDATE signup_records SET status=?, panel_id=? WHERE id=?",
            (dispatch.get("status") or "pending", dispatch.get("panel_id"), record_id),
        )
    else:
        core.execute(
            "UPDATE signup_records SET status=?, error=?, finished_time=? WHERE id=?",
            ("failed", dispatch.get("error") or "派发失败", now, record_id),
        )
    row = core.query_one("SELECT * FROM signup_records WHERE id=?", (record_id,))
    return {"status": row["status"], "id": record_id, "error": row["error"], "output": row["output"]}


def membership_days(expire: str | None) -> int:
    dt = core.parse_iso(expire)
    if not dt:
        return 0
    return max(0, math.floor((dt - core.now_dt()).total_seconds() / 86400))
