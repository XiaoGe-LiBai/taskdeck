"""青龙面板客户端。

主链路（连通性 / 任务列表 / 启停）走 OpenAPI，凭据是「系统设置 → 应用」里的
Client ID + Client Secret，**不需要账号密码**：

    GET  /open/auth/token?client_id=&client_secret=   -> {data:{token, expiration}}
    GET  /open/crons?page=&size=                      -> {data:{data:[...], total}}
    PUT  /open/crons/run    body=[id, ...]            -> {code:200}
    PUT  /open/crons/stop   body=[id, ...]            -> {code:200}

例外：「查看日志内容」。青龙 OpenAPI 只能列目录（/open/logs），
/open/logs/detail 取不到内容（实测各版本返回空），所以日志这一项在
配置了账号密码时回退到网页 API /api/*；没配则抛出明确的 QLError。
"""
from __future__ import annotations

import threading
import time

import requests

import core

# 网页 API（仅日志用）的 token 缓存：panel_id -> {token, at}
_WEB_TOKENS: dict[int, dict] = {}
_WEB_LOCK = threading.Lock()

WEB_TOKEN_TTL = 1500


class QLError(RuntimeError):
    pass


def _base(url: str) -> str:
    return (url or "").rstrip("/")


def _client_id(panel: dict) -> str:
    return (panel.get("client_id") or "").strip()


def _client_secret(panel: dict) -> str:
    return (panel.get("client_secret") or "").strip()


def has_credentials(panel: dict) -> bool:
    """是否配好了 OpenAPI 凭据。"""
    return bool(_client_id(panel) and _client_secret(panel))


def has_web_credentials(panel: dict) -> bool:
    """是否额外配了网页账号密码（只为看日志内容）。"""
    return bool((panel.get("username") or "").strip() and (panel.get("password") or ""))


def ensure_seed() -> None:
    """把 config.json 的 qinglong 凭据补进 ql_panels（幂等）。

    只在「面板地址与 config.json 一致」时回填 —— 否则会把 A 实例的
    Client ID/Secret 写到 B 实例上，反而更难排查。
    """
    conf = core.CONFIG.get("qinglong") or {}
    url = (conf.get("url") or "").strip().rstrip("/")
    client_id = (conf.get("client_id") or "").strip()
    client_secret = (conf.get("client_secret") or "").strip()
    if not url or not client_id or not client_secret:
        return
    for row in core.query("SELECT * FROM ql_panels ORDER BY id"):
        panel = dict(row)
        if (panel.get("url") or "").rstrip("/") != url:
            continue
        if (panel.get("client_id") or "").strip():
            continue
        core.execute(
            "UPDATE ql_panels SET client_id=?, client_secret=? WHERE id=?",
            (client_id, client_secret, panel["id"]),
        )


# ---------------------------------------------------------------- OpenAPI 鉴权


def login(panel: dict) -> str:
    """用 Client ID / Client Secret 换 OpenAPI token，并缓存到 ql_tokens。"""
    base = _base(panel["url"])
    if not base:
        raise QLError("面板地址为空")
    if not has_credentials(panel):
        raise QLError("缺少 Client ID / Client Secret（青龙：系统设置 → 应用 → 新建应用）")
    try:
        resp = requests.get(
            f"{base}/open/auth/token",
            params={"client_id": _client_id(panel), "client_secret": _client_secret(panel)},
            timeout=15,
        )
        data = resp.json()
    except Exception as exc:
        raise QLError(f"连接失败：{exc}") from exc

    payload = data.get("data") if isinstance(data.get("data"), dict) else {}
    token = (payload or {}).get("token") or ""
    if not token:
        raise QLError(
            data.get("message") or data.get("msg") or "OpenAPI 鉴权失败（检查 Client ID / Client Secret）"
        )

    expiration = (payload or {}).get("expiration")
    now_ts = time.time()
    if expiration:
        try:
            exp_ts = int(expiration)
        except (ValueError, TypeError):
            exp_ts = int(now_ts + 7200)
    else:
        # 青龙部分版本不返回 expiration 字段，默认兜底 2 小时有效
        exp_ts = int(now_ts + 7200)

    expire_dt = datetime.fromtimestamp(exp_ts, core.CN_TZ)
    expire_iso = core.iso(expire_dt, ms=False)

    core.execute(
        "INSERT INTO ql_tokens (panel_id, token, expire_time) VALUES (?,?,?) "
        "ON CONFLICT(panel_id) DO UPDATE SET token=excluded.token, expire_time=excluded.expire_time",
        (panel["id"], token, expire_iso),
    )
    return token


def token_of(panel: dict, force: bool = False) -> str:
    if not force:
        row = core.query_one("SELECT * FROM ql_tokens WHERE panel_id=?", (panel["id"],))
        if row and row["token"]:
            expire = core.parse_iso(row["expire_time"])
            # 必须解析出有效时间且离过期大于 120 秒才复用，提前平滑刷新
            if expire and (expire - core.now_dt()).total_seconds() > 120:
                return row["token"]
    return login(panel)


def request(panel: dict, method: str, path: str, **kwargs) -> dict:
    """带自动重登的 OpenAPI 请求；path 形如 /open/crons。"""
    base = _base(panel["url"])
    last_error = None
    for attempt in range(2):
        token = token_of(panel, force=attempt > 0)
        headers = {"Authorization": f"Bearer {token}"}
        # 连接超时 5 秒，读取超时 25 秒，避免外部面板无响应挂死工作线程
        kwargs.setdefault("timeout", (5, 25))
        try:
            resp = requests.request(method, f"{base}{path}", headers=headers, **kwargs)
        except Exception as exc:
            raise QLError(f"请求失败：{exc}") from exc
        try:
            data = resp.json()
        except ValueError:
            raise QLError(f"面板返回非 JSON（HTTP {resp.status_code}）")
        if not isinstance(data, dict):
            return {"code": 200, "data": data}
        code = data.get("code")
        if code in (200, 0):
            return data

        msg = str(data.get("message") or data.get("msg") or "")
        is_auth_error = (
            resp.status_code in (401, 403)
            or code in (401, 403)
            or any(kw in msg.lower() for kw in ("token", "jwt", "unauthorized", "expired", "鉴权", "未登录"))
        )
        if is_auth_error and attempt == 0:
            last_error = QLError(msg or "面板鉴权失效")
            core.execute("DELETE FROM ql_tokens WHERE panel_id=?", (panel["id"],))
            continue
        raise QLError(msg or f"面板返回 code={code}")
    raise last_error or QLError("面板请求失败")


# ---------------------------------------------------------------- 连通性


def check(panel: dict) -> dict:
    """连通性检查，返回 {status, msg, last_check}。"""
    now = core.iso()
    try:
        data = request(panel, "GET", "/open/crons", params={"page": 1, "size": 1})
        payload = data.get("data")
        items = payload.get("data") if isinstance(payload, dict) else payload
        if not isinstance(items, list):
            raise QLError("面板返回结构异常")
        status, msg = "online", "连接成功（OpenAPI）"
    except QLError as exc:
        status, msg = "offline", str(exc)
        core.execute("DELETE FROM ql_tokens WHERE panel_id=?", (panel["id"],))
    core.execute("UPDATE ql_panels SET status=?, last_check=? WHERE id=?", (status, now, panel["id"]))
    return {"status": status, "msg": msg, "last_check": now}


# ---------------------------------------------------------------- 任务（cron）


def crons(panel: dict, page_size: int = 200, max_items: int = 5000) -> list[dict]:
    """拉全量任务（OpenAPI 是分页的：{data:{data:[],total}}）。"""
    out: list[dict] = []
    page = 1
    while len(out) < max_items:
        data = request(panel, "GET", "/open/crons", params={"page": page, "size": page_size}, timeout=60)
        payload = data.get("data")
        if isinstance(payload, list):
            items, total = payload, len(payload)
        else:
            items = (payload or {}).get("data") or []
            total = int((payload or {}).get("total") or 0)
        for item in items:
            if not isinstance(item, dict):
                continue
            out.append(
                {
                    "id": item.get("id"),
                    "name": item.get("name"),
                    "command": item.get("command"),
                    "schedule": item.get("schedule"),
                    "isDisabled": bool(item.get("isDisabled")),
                    "status": item.get("status"),
                    "log_path": item.get("log_path"),
                }
            )
        if not items or len(out) >= total:
            break
        page += 1
    return out


def _ids(cron_id) -> list[int]:
    raw = cron_id if isinstance(cron_id, list) else [cron_id]
    out = []
    for item in raw:
        try:
            out.append(int(item))
        except (TypeError, ValueError):
            continue
    return out


def run_cron(panel: dict, cron_id) -> dict:
    """OpenAPI 的运行接口 body 是裸数组：[id, ...]"""
    ids = _ids(cron_id)
    if not ids:
        raise QLError("缺少任务 ID")
    data = request(panel, "PUT", "/open/crons/run", json=ids)
    return data.get("data") or {}


def stop_cron(panel: dict, cron_id) -> dict:
    ids = _ids(cron_id)
    if not ids:
        raise QLError("缺少任务 ID")
    data = request(panel, "PUT", "/open/crons/stop", json=ids)
    return data.get("data") or {}


# ---------------------------------------------------------------- 日志（走网页 API）


def _web_token(panel: dict, force: bool = False) -> str:
    if not has_web_credentials(panel):
        raise QLError(
            "查看日志内容需要青龙账号密码（OpenAPI 不返回日志内容）。"
            "请在「青龙面板」配置里补上「日志账号 / 日志密码」，或直接去青龙后台看日志。"
        )
    key = int(panel["id"])
    with _WEB_LOCK:
        cached = _WEB_TOKENS.get(key)
        if cached and not force and time.time() - cached["at"] < WEB_TOKEN_TTL:
            return cached["token"]

    base = _base(panel["url"])
    try:
        resp = requests.post(
            f"{base}/api/user/login",
            json={"username": panel["username"], "password": panel["password"]},
            timeout=15,
        )
        data = resp.json()
    except Exception as exc:
        raise QLError(f"连接失败：{exc}") from exc
    if data.get("code") != 200:
        raise QLError(data.get("message") or "青龙网页登录失败（检查日志账号 / 密码）")
    token = ((data.get("data") or {}) if isinstance(data.get("data"), dict) else {}).get("token") or ""
    if not token:
        raise QLError("青龙网页登录未返回 token")
    with _WEB_LOCK:
        _WEB_TOKENS[key] = {"token": token, "at": time.time()}
    return token


def web_request(panel: dict, method: str, path: str, **kwargs) -> dict:
    """网页 API 请求（仅日志用），带自动重登。"""
    base = _base(panel["url"])
    last_error = None
    for attempt in range(2):
        token = _web_token(panel, force=attempt > 0)
        kwargs.setdefault("timeout", 20)
        try:
            resp = requests.request(
                method, f"{base}{path}", headers={"Authorization": f"Bearer {token}"}, **kwargs
            )
        except Exception as exc:
            raise QLError(f"请求失败：{exc}") from exc
        try:
            data = resp.json()
        except ValueError:
            raise QLError(f"面板返回非 JSON（HTTP {resp.status_code}）")
        code = data.get("code")
        if code == 200:
            return data
        if resp.status_code in (401, 403) or code in (401, 403):
            with _WEB_LOCK:
                _WEB_TOKENS.pop(int(panel["id"]), None)
            last_error = QLError(data.get("message") or "面板鉴权失效")
            continue
        raise QLError(data.get("message") or f"面板返回 code={code}")
    raise last_error or QLError("面板请求失败")


def logs(panel: dict, path: str = "", search: str = "") -> list[dict]:
    params = {"t": int(time.time() * 1000)}
    if path:
        params["path"] = path
    if search:
        params["searchValue"] = search
    data = web_request(panel, "GET", "/api/logs", params=params)
    items = data.get("data") or []
    if isinstance(items, dict):
        items = items.get("data") or []
    return [i for i in items if isinstance(i, dict)]


def log_content(panel: dict, file_path: str) -> str:
    data = web_request(panel, "GET", f"/api/logs/{file_path}", params={"t": int(time.time() * 1000)})
    payload = data.get("data")
    if isinstance(payload, str):
        return payload
    if isinstance(payload, dict):
        return payload.get("content") or payload.get("data") or ""
    return ""
