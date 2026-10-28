"""青龙面板 OpenAPI 客户端。

面板用两个后端：
  - YYB-Go-Enhanced（yyb_client.py）：取码、账号、托管任务
  - 青龙（本文件）：环境变量 + 任务（cron），含 task_before

之所以要直连青龙：YYB 的 /api/qinglong/config 不返回 Client Secret 明文，
它也没有「替外部写环境变量 / 改 task_before」的接口。所以「脚本 × 账号」
矩阵要落到 env 或 task_before 上，只能由面板自己拿青龙 OpenAPI 凭据去写。

端点存在 service_endpoints(kind='qinglong')：
    base_url = http://host:5700
    username = client_id
    password = client_secret

实测（青龙 2.x，2026-09）：
    GET /open/auth/token           -> {"code":200,"data":{"token":"...","expiration":...}}
    GET /open/envs                 -> {"code":200,"data":[{id,name,value,remarks,status}]}   # 平铺 list
    GET /open/crons?page=1&size=N  -> {"code":200,"data":{"data":[...],"total":1021}}        # 分页 dict
    成功一律 code=200；错误是 {"code":4xx,"message":"..."}。
"""
from __future__ import annotations

import threading
import time

import requests

import core

_TOKENS: dict[int, dict] = {}
_LOCK = threading.Lock()

# 青龙 token 有效期 24h，这里保守缓 25 分钟
TOKEN_TTL = 1500


class QLError(RuntimeError):
    pass


# ---------------------------------------------------------------- 端点配置


def endpoint(row_id=None) -> dict | None:
    if row_id:
        row = core.query_one(
            "SELECT * FROM service_endpoints WHERE id=? AND kind='qinglong'", (int(row_id),)
        )
    else:
        row = core.query_one(
            "SELECT * FROM service_endpoints WHERE kind='qinglong' ORDER BY id LIMIT 1"
        )
    return dict(row) if row else None


def ensure_seed() -> None:
    """把 config.json 里的 qinglong 段作为默认端点写进库（幂等）。"""
    conf = core.CONFIG.get("qinglong") or {}
    url = (conf.get("url") or "").strip()
    if not url or endpoint():
        return
    core.insert(
        "service_endpoints",
        {
            "kind": "qinglong",
            "name": conf.get("name") or "青龙面板",
            "base_url": url.rstrip("/"),
            "username": (conf.get("client_id") or conf.get("username") or "").strip(),
            "password": (conf.get("client_secret") or conf.get("password") or "").strip(),
            "integration_token": "",
            "extra": "{}",
            "status": "unknown",
            "last_check": None,
            "created_time": core.iso(),
        },
    )


# ---------------------------------------------------------------- 鉴权


def _token(ep: dict, force: bool = False) -> str:
    key = int(ep["id"])
    with _LOCK:
        cached = _TOKENS.get(key)
        if cached and not force and time.time() < cached["expire"]:
            return cached["token"]
    base = ep["base_url"].rstrip("/")
    try:
        resp = requests.get(
            f"{base}/open/auth/token",
            params={"client_id": ep["username"], "client_secret": ep["password"]},
            timeout=15,
        )
        data = resp.json()
    except Exception as exc:
        raise QLError(f"连接青龙失败：{exc}") from exc
    token = str(((data.get("data") or {}) if isinstance(data.get("data"), dict) else {}).get("token") or "").strip()
    if not token:
        raise QLError(data.get("message") or data.get("msg") or "青龙鉴权失败（检查 client_id / client_secret）")
    with _LOCK:
        _TOKENS[key] = {"token": token, "expire": time.time() + TOKEN_TTL}
    return token


def _request(ep: dict, method: str, path: str, *, params=None, json_body=None, timeout=None):
    base = ep["base_url"].rstrip("/")
    last_error = ""
    req_timeout = timeout or (5, 25)
    for attempt in (0, 1):
        token = _token(ep, force=attempt > 0)
        try:
            resp = requests.request(
                method,
                f"{base}{path}",
                params=params,
                json=json_body,
                headers={"Authorization": f"Bearer {token}"},
                timeout=req_timeout,
            )
        except Exception as exc:
            raise QLError(f"请求失败：{exc}") from exc

        try:
            data = resp.json()
        except ValueError:
            raise QLError(f"青龙返回非 JSON（HTTP {resp.status_code}）：{resp.text[:200]}")
        if not isinstance(data, dict):
            return data

        code = data.get("code")
        msg = str(data.get("message") or data.get("msg") or "")
        is_auth_error = (
            resp.status_code in (401, 403)
            or code in (401, 403)
            or any(kw in msg.lower() for kw in ("token", "jwt", "unauthorized", "expired", "鉴权", "未登录"))
        )
        if is_auth_error and attempt == 0:
            last_error = f"鉴权失效（{msg or resp.status_code}）"
            continue

        if code in (200, 0) or (code is None and resp.ok):
            return data.get("data")
        raise QLError(msg or f"青龙返回 code={code}")
    raise QLError(last_error or "青龙请求失败")


# ---------------------------------------------------------------- 状态


def status(ep: dict) -> dict:
    """连通性 + 变量数 + 任务数，并回写 endpoint 的 status/last_check。"""
    now = core.iso()
    result = {"online": False, "envs": 0, "crons": 0, "msg": ""}
    try:
        result["envs"] = len(envs(ep))
        result["crons"] = len(crons(ep))
        result["online"] = True
    except QLError as exc:
        result["msg"] = str(exc)
    core.execute(
        "UPDATE service_endpoints SET status=?, last_check=? WHERE id=?",
        ("online" if result["online"] else "offline", now, ep["id"]),
    )
    result["last_check"] = now
    return result


# ---------------------------------------------------------------- 环境变量


def envs(ep: dict, env_id=None) -> list[dict]:
    """全部环境变量。env_id 给定时只取那一条。"""
    if env_id:
        data = _request(ep, "GET", f"/open/envs/{int(env_id)}")
        row = data if isinstance(data, dict) else {}
        return [dict(row)] if row else []
    data = _request(ep, "GET", "/open/envs")
    if isinstance(data, dict):  # 少数版本分页
        data = data.get("data") or []
    return [dict(e) for e in (data or []) if isinstance(e, dict)]


def env_by_name(ep: dict, name: str) -> list[dict]:
    """按名字取变量（同名可能多条，青龙允许多条同名）。"""
    return [e for e in envs(ep) if str(e.get("name") or "") == name]


def save_env(ep: dict, name: str, value: str, remarks: str = "", env_id=None) -> dict:
    """新建或更新一条环境变量（自动清洗 Windows 换行符并兼容版本格式差异）。"""
    clean_val = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if env_id:
        try:
            return _request(
                ep, "PUT", "/open/envs",
                json_body=[{"id": int(env_id), "name": name, "value": clean_val, "remarks": remarks}],
            ) or {}
        except QLError:
            return _request(
                ep, "PUT", "/open/envs",
                json_body={"id": int(env_id), "name": name, "value": clean_val, "remarks": remarks},
            ) or {}
    return _request(
        ep, "POST", "/open/envs",
        json_body=[{"name": name, "value": clean_val, "remarks": remarks}],
    ) or {}


def delete_env(ep: dict, env_ids) -> dict:
    if isinstance(env_ids, int):
        env_ids = [env_ids]
    ids = [int(i) for i in env_ids]
    if not ids:
        return {}
    return _request(ep, "DELETE", "/open/envs", json_body=ids) or {}


# ---------------------------------------------------------------- 任务（cron）


def crons(ep: dict, page_size: int = 200, max_items: int = 5000) -> list[dict]:
    """拉全量任务。青龙 /open/crons 是分页的（{data:{data,total}}），必须翻页。

    实测 1021 条时 size=200 只回 200 条，page 递增才拿得全。
    """
    out: list[dict] = []
    page = 1
    while len(out) < max_items:
        data = _request(
            ep, "GET", "/open/crons", params={"page": page, "size": page_size}, timeout=60
        )
        if isinstance(data, list):
            out.extend(dict(c) for c in data)
            break
        items = (data or {}).get("data") or []
        total = int((data or {}).get("total") or 0)
        out.extend(dict(c) for c in items if isinstance(c, dict))
        if not items or len(out) >= total:
            break
        page += 1
    return out


def cron(ep: dict, cron_id: int) -> dict:
    data = _request(ep, "GET", f"/open/crons/{int(cron_id)}")
    return dict(data) if isinstance(data, dict) else {}


def update_cron(ep: dict, cron_row: dict) -> dict:
    """整行 PUT 回去。青龙要求带 id，其余字段按行内已有值原样回传最稳。"""
    return _request(ep, "PUT", "/open/crons", json_body=cron_row) or {}
