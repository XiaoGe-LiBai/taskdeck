"""YYB-Go-Enhanced 客户端：账号、保活、取码、青龙托管任务与日志。

鉴权两条路：
  1. 账号密码登录（POST /login），拿 HttpOnly Cookie 会话，缓存在进程内，401 自动重登
  2. 免密集成 Token（`Authorization: Bearer <YYB_INTEGRATION_TOKEN>`），走 /integration/*
     需要在 YYB 部署里设置 YYB_INTEGRATION_TOKEN；未设置时服务端返回 503 "integration API is disabled"
"""
from __future__ import annotations

import json
import threading
import time

import requests

import core

_SESSIONS: dict[int, dict] = {}
_LOCK = threading.Lock()


class YYBError(RuntimeError):
    pass


# ---------------------------------------------------------------- 端点配置


def endpoint(row_id: int) -> dict | None:
    row = core.query_one("SELECT * FROM service_endpoints WHERE id=? AND kind='yyb'", (row_id,))
    return dict(row) if row else None


def default_endpoint() -> dict | None:
    row = core.query_one("SELECT * FROM service_endpoints WHERE kind='yyb' ORDER BY id LIMIT 1")
    return dict(row) if row else None


def ensure_seed() -> None:
    """把 config.json 里的 yyb 段作为默认端点写进库（幂等）。"""
    conf = core.CONFIG.get("yyb") or {}
    url = (conf.get("url") or "").strip()
    if not url or default_endpoint():
        return
    core.insert(
        "service_endpoints",
        {
            "kind": "yyb",
            "name": conf.get("name") or "YYB 协议服务",
            "base_url": url.rstrip("/"),
            "username": conf.get("username") or "",
            "password": conf.get("password") or "",
            "integration_token": conf.get("integration_token") or "",
            "extra": "{}",
            "status": "unknown",
            "last_check": None,
            "created_time": core.iso(),
        },
    )


# ---------------------------------------------------------------- 会话


def _session(ep: dict, force: bool = False) -> requests.Session:
    key = int(ep["id"])
    with _LOCK:
        cached = _SESSIONS.get(key)
        if cached and not force and time.time() - cached["at"] < 1800:
            return cached["session"]
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        if ep.get("integration_token"):
            session.headers["Authorization"] = "Bearer " + ep["integration_token"].strip()
        else:
            try:
                resp = session.post(
                    f"{ep['base_url']}/login",
                    json={"username": ep["username"], "password": ep["password"]},
                    timeout=15,
                )
                data = resp.json()
            except Exception as exc:
                raise YYBError(f"连接协议服务失败：{exc}") from exc
            if data.get("code") != 0:
                raise YYBError(data.get("msg") or "协议服务登录失败")
        _SESSIONS[key] = {"session": session, "at": time.time()}
        return session


def _request(ep: dict, method: str, path: str, *, params=None, json_body=None, timeout: int = 25):
    base = ep["base_url"].rstrip("/")
    last_error = ""
    for attempt in (0, 1):
        session = _session(ep, force=attempt > 0)
        try:
            resp = session.request(method, f"{base}{path}", params=params, json=json_body, timeout=timeout)
        except Exception as exc:
            raise YYBError(f"请求协议服务失败：{exc}") from exc
        if resp.status_code in (401, 403) and attempt == 0:
            last_error = f"鉴权失效（HTTP {resp.status_code}）"
            continue
        try:
            data = resp.json()
        except ValueError:
            raise YYBError(f"协议服务响应异常（HTTP {resp.status_code}）")
        code = data.get("code")
        if code == 0:
            return data.get("data")
        msg = data.get("msg") or data.get("message") or "未知错误"
        if code == 503:
            raise YYBError("应用宝服务鉴权异常，请稍后重试或联系管理员")
        raise YYBError(f"协议服务返回错误：{msg}")
    raise YYBError(last_error or "协议服务请求失败")


# ---------------------------------------------------------------- 业务方法


def status(ep: dict) -> dict:
    """连通性 + 账号数 + 青龙连接状态，并回写 endpoint 的 status/last_check。"""
    now = core.iso()
    result = {"online": False, "accounts": 0, "qinglong": None, "msg": ""}
    try:
        accounts = _request(ep, "GET", "/accounts")
        result["online"] = True
        result["accounts"] = len(accounts or [])
        try:
            ql = _request(ep, "GET", "/api/qinglong/status")
            result["qinglong"] = ql
        except YYBError as exc:
            result["qinglong"] = {"configured": False, "connected": False, "msg": str(exc)}
    except YYBError as exc:
        result["msg"] = str(exc)
    core.execute(
        "UPDATE service_endpoints SET status=?, last_check=? WHERE id=?",
        ("online" if result["online"] else "offline", now, ep["id"]),
    )
    result["last_check"] = now
    return result


def accounts(ep: dict) -> list[dict]:
    data = _request(ep, "GET", "/accounts")
    return data if isinstance(data, list) else []


def refresh_account(ep: dict, ref: str) -> dict:
    return _request(ep, "POST", "/accounts/refresh", json_body={"ref": str(ref)}) or {}


def set_remark(ep: dict, ref: str, remark: str) -> dict:
    return _request(ep, "PUT", "/accounts/remark", json_body={"ref": str(ref), "remark": remark}) or {}


def qinglong_status(ep: dict) -> dict:
    return _request(ep, "GET", "/api/qinglong/status") or {}


def qinglong_config(ep: dict) -> dict:
    return _request(ep, "GET", "/api/qinglong/config") or {}


def jobs(ep: dict, ref: str) -> dict:
    return _request(ep, "GET", "/api/qinglong/jobs", params={"ref": str(ref)}) or {}


def run_job(ep: dict, ref: str, script_key: str) -> dict:
    return _request(ep, "POST", "/api/qinglong/jobs/run", json_body={"ref": str(ref), "script_key": script_key}) or {}


def enable_job(ep: dict, ref: str, script_key: str, enabled: bool) -> dict:
    return _request(
        ep, "PUT", "/api/qinglong/jobs/enable",
        json_body={"ref": str(ref), "script_key": script_key, "enabled": bool(enabled)},
    ) or {}


def runs(ep: dict, ref: str) -> dict:
    return _request(ep, "GET", "/api/qinglong/runs", params={"ref": str(ref)}) or {}


def run_log(ep: dict, ref: str, log_key: str, script_key: str = "") -> dict:
    body = {"ref": str(ref), "log_key": log_key}
    if script_key:
        body["script_key"] = script_key
    return _request(ep, "POST", "/api/qinglong/runs/log", json_body=body) or {}


def job_log(ep: dict, ref: str, script_key: str) -> dict:
    return _request(
        ep, "GET", "/api/qinglong/jobs/log",
        params={"ref": str(ref), "script_key": script_key},
    ) or {}


def get_code(ep: dict, ref: str, app_id: str) -> dict:
    """测试取码：优先免密集成接口，回退协议接口"""
    if ep.get("integration_token"):
        return _request(ep, "POST", "/integration/actions/get-code", json_body={"ref": str(ref), "app_id": app_id}) or {}
    return _request(ep, "POST", "/wxapp/getCode", json_body={"ref": str(ref), "app_id": app_id}) or {}


def sync_all(ep: dict) -> dict:
    return _request(ep, "POST", "/api/qinglong/sync-all") or {}


def push_config(ep: dict) -> dict:
    return _request(ep, "GET", "/api/qinglong/push") or {}


def version(ep: dict) -> dict:
    return _request(ep, "GET", "/api/version") or {}


def scan_session(ep: dict, proxy: dict | None = None) -> dict:
    """新建扫码会话，供面板直接展示二维码（加微信账号用）。

    proxy 为 YYB `accountProxyIn` 的子集：mode / proxy_type / static_proxy /
    api_url / provider_profile_id / region_code / region_province / region_city /
    refresh_ahead_minutes。空值等价于直连。
    """
    body = dict(proxy or {})
    body.setdefault("product", "appstore")
    # 动态代理要先请求供应商 API 提取出口，再生成二维码，比直连慢
    return _request(ep, "POST", "/qr", json_body=body, timeout=90) or {}


def scan_poll(ep: dict, session_id: str) -> dict:
    return _request(ep, "GET", f"/qr/{session_id}/poll") or {}


def scan_confirm(ep: dict, session_id: str) -> dict:
    """确认扫码会话，使微信账号正式入库到 YYB 服务"""
    return _request(ep, "POST", f"/qr/{session_id}/confirm") or {}


def scan_image_url(ep: dict, session_id: str) -> str:
    return f"{ep['base_url'].rstrip('/')}/qr/{session_id}/image"


# ---------------------------------------------------------------- 登录网络代理
#
# 面板不自己实现代理池：直接读 YYB 的代理配置库与地区表，选中的配置随 /qr
# 一起下发。四种模式与 YYB /scan 对齐：direct / static / api / profile。


def proxy_profiles(ep: dict) -> list[dict]:
    """YYB 代理配置库（品赞 / 巨量 / 静态预设）。profile 模式用。"""
    data = _request(ep, "GET", "/api/proxy-profiles")
    return data if isinstance(data, list) else []


def proxy_provinces(ep: dict) -> list[dict]:
    data = _request(ep, "GET", "/api/proxy-profiles/areas/provinces", timeout=30)
    return data if isinstance(data, list) else []


def proxy_cities(ep: dict, province: str) -> list[dict]:
    data = _request(
        ep,
        "GET",
        "/api/proxy-profiles/areas/cities",
        params={"province": province},
        timeout=30,
    )
    return data if isinstance(data, list) else []


def proxy_test(ep: dict, body: dict) -> dict:
    """按给定配置提取一次并探测出口，不落库、不影响已有账号。"""
    return _request(ep, "POST", "/accounts/proxy/test", json_body=body, timeout=90) or {}
