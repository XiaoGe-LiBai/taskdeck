"""/api/admin/ql/*：青龙面板对接（CRUD、连通性、crons 代理）。"""
from __future__ import annotations

import time

from flask import Blueprint, request

import core
import ql_client
import xiaocan_tasks

bp = Blueprint("ql", __name__)


def _panel_or_none(panel_id: int) -> dict | None:
    row = core.query_one("SELECT * FROM ql_panels WHERE id=?", (panel_id,))
    return dict(row) if row else None


def _public(panel: dict) -> dict:
    return {
        "id": panel["id"],
        "name": panel["name"],
        "remark": panel["remark"],
        "url": panel["url"],
        "client_id": panel.get("client_id") or "",
        "has_secret": bool((panel.get("client_secret") or "").strip()),
        "username": panel.get("username") or "",
        "has_password": bool((panel.get("password") or "").strip()),
        "status": panel["status"],
        "last_check": panel["last_check"],
        "created_time": panel["created_time"],
    }


@bp.get("/panels")
@core.require_admin
def panels_list():
    rows = core.query("SELECT * FROM ql_panels ORDER BY id")
    return core.ok([_public(dict(r)) for r in rows])


@bp.post("/panels")
@core.require_admin
def panels_create():
    body = request.get_json(silent=True) or {}
    if not (body.get("url") or "").strip():
        return core.fail("请填写地址")
    new_id = core.insert(
        "ql_panels",
        {
            "name": (body.get("name") or "青龙面板").strip(),
            "remark": (body.get("remark") or "").strip(),
            "url": body["url"].strip().rstrip("/"),
            # 主凭据：OpenAPI
            "client_id": (body.get("client_id") or "").strip(),
            "client_secret": (body.get("client_secret") or "").strip(),
            # 备用凭据：仅日志内容用
            "username": (body.get("username") or "").strip(),
            "password": body.get("password") or "",
            "status": "unknown",
            "last_check": None,
            "created_time": core.iso(),
        },
    )
    return core.ok({"id": new_id})


@bp.put("/panels/<int:panel_id>")
@core.require_admin
def panels_update(panel_id: int):
    panel = _panel_or_none(panel_id)
    if not panel:
        return core.fail("面板不存在")
    body = request.get_json(silent=True) or {}
    data = {}
    for key in ("name", "remark", "url", "client_id", "username"):
        if key in body and body[key] is not None:
            data[key] = str(body[key]).strip()
    if data.get("url"):
        data["url"] = data["url"].rstrip("/")
    # 密钥类字段留空表示不修改；改了就把缓存的 token 清掉
    for secret_key in ("client_secret", "password"):
        if body.get(secret_key):
            data[secret_key] = str(body[secret_key])
            core.execute("DELETE FROM ql_tokens WHERE panel_id=?", (panel_id,))
    if data:
        core.update("ql_panels", panel_id, data)
    return core.ok({})


@bp.delete("/panels/<int:panel_id>")
@core.require_admin
def panels_delete(panel_id: int):
    core.delete("ql_panels", panel_id)
    core.execute("DELETE FROM ql_tokens WHERE panel_id=?", (panel_id,))
    core.execute("UPDATE accounts SET default_panel_id=NULL WHERE default_panel_id=?", (panel_id,))
    core.execute("UPDATE accounts SET brand_panel_id=NULL WHERE brand_panel_id=?", (panel_id,))
    return core.ok({})


@bp.post("/panels/<int:panel_id>/check")
@core.require_admin
def panels_check(panel_id: int):
    panel = _panel_or_none(panel_id)
    if not panel:
        return core.fail("面板不存在")
    result = ql_client.check(panel)
    return core.ok(result)


@bp.post("/panels/<int:panel_id>/provision")
@core.require_admin
def panels_provision(panel_id: int):
    """把内置的小蚕托管任务下发到面板（已存在的跳过）。"""
    panel = _panel_or_none(panel_id)
    if not panel:
        return core.fail("面板不存在")
    try:
        existing = {c["name"]: c for c in ql_client.crons(panel)}
    except Exception as exc:
        return core.fail(str(exc))
    created = []
    for key, meta in xiaocan_tasks.CATALOG.items():
        if not meta["schedule"]:  # 报名/抢兑为按需任务，不建定时
            continue
        if key in existing:
            continue
        try:
            ql_client.request(
                panel,
                "POST",
                "/open/crons",
                json={
                    "name": meta["name"],
                    "command": xiaocan_tasks.command_of(key),
                    "schedule": meta["schedule"],
                },
            )
            created.append(key)
        except Exception as exc:
            return core.fail(f"{key} 创建失败：{exc}")
    return core.ok({"created": created, "count": len(created)})


# ------------------------------------------------------ crons 代理（前端直接用）


@bp.get("/panels/<int:panel_id>/proxy/api/crons")
@core.require_admin
def proxy_crons(panel_id: int):
    panel = _panel_or_none(panel_id)
    if not panel:
        return core.fail("面板不存在")
    params = {k: v for k, v in request.args.items()}
    try:
        data = ql_client.request(panel, "GET", "/open/crons", params=params)
    except ql_client.QLError as exc:
        return core.fail(str(exc))
    return core.ok(data)


@bp.put("/panels/<int:panel_id>/proxy/api/crons/run")
@core.require_admin
def proxy_crons_run(panel_id: int):
    panel = _panel_or_none(panel_id)
    if not panel:
        return core.fail("面板不存在")
    body = request.get_json(silent=True) or {}
    cron_id = body.get("id")
    if not cron_id:
        return core.fail("缺少任务 id")
    try:
        data = ql_client.run_cron(panel, cron_id)
    except ql_client.QLError as exc:
        return core.fail(str(exc))
    return core.ok(data)


@bp.put("/panels/<int:panel_id>/proxy/api/crons/stop")
@core.require_admin
def proxy_crons_stop(panel_id: int):
    panel = _panel_or_none(panel_id)
    if not panel:
        return core.fail("面板不存在")
    body = request.get_json(silent=True) or {}
    cron_id = body.get("id")
    if not cron_id:
        return core.fail("缺少任务 id")
    try:
        data = ql_client.stop_cron(panel, cron_id)
    except ql_client.QLError as exc:
        return core.fail(str(exc))
    return core.ok(data)


@bp.get("/panels/<int:panel_id>/proxy/api/logs")
@core.require_admin
def proxy_logs(panel_id: int):
    panel = _panel_or_none(panel_id)
    if not panel:
        return core.fail("面板不存在")
    params = {k: v for k, v in request.args.items()}
    params.setdefault("t", str(int(time.time() * 1000)))
    try:
        data = ql_client.web_request(panel, "GET", "/api/logs", params=params)
    except ql_client.QLError as exc:
        return core.fail(str(exc))
    return core.ok(data)


@bp.get("/panels/<int:panel_id>/proxy/api/logs/<path:file_path>")
@core.require_admin
def proxy_log_content(panel_id: int, file_path: str):
    panel = _panel_or_none(panel_id)
    if not panel:
        return core.fail("面板不存在")
    try:
        content = ql_client.log_content(panel, file_path)
    except ql_client.QLError as exc:
        return core.fail(str(exc))
    return core.ok(content)
