"""/api/yyb/*：应用宝（YYB-Go-Enhanced）项目模块。

面板是 YYB 的客户端：账号存活与凭据、保活刷新、取码测试、扫码加号、
以及「每账号托管了哪些脚本 / 跑得怎么样 / 日志全文」。
"""
from __future__ import annotations

import json

from flask import Blueprint, request

import core
import bindings as bindings_mod
import qinglong_client as qlc
import yyb_client as yyb

bp = Blueprint("yyb", __name__)


def _endpoint_or_fail(row_id=None):
    ep = yyb.endpoint(int(row_id)) if row_id else yyb.default_endpoint()
    if not ep:
        raise LookupError("应用宝服务暂未配置，请联系管理员")
    return ep


def _guard(fn):
    """统一把 YYBError/LookupError 转成标准信封"""
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except LookupError as exc:
            return core.fail(str(exc))
        except yyb.YYBError as exc:
            return core.fail(str(exc))

    return wrapper


def _ep_id():
    return request.args.get("endpoint_id") or (request.get_json(silent=True) or {}).get("endpoint_id")


# 扫码/代理接口透传给 YYB 的字段（对齐 accountProxyIn，避免把无关参数带过去）
_PROXY_FIELDS = (
    "mode",
    "proxy_type",
    "static_proxy",
    "api_url",
    "provider_profile_id",
    "region_code",
    "region_province",
    "region_city",
    "refresh_ahead_minutes",
)


def _proxy_payload(body: dict) -> dict:
    payload = {"product": "appstore"}
    for key in _PROXY_FIELDS:
        if key in body:
            payload[key] = body[key]
    return payload


# ---------------------------------------------------------------- 端点管理


@bp.get("/endpoints")
@core.require_login
def endpoints():
    rows = core.query("SELECT * FROM service_endpoints WHERE kind='yyb' ORDER BY id")
    user = core.current_user()
    is_admin = user and user.get("role") == "admin"
    if not is_admin:
        # 普通用户脱敏，不暴露底层内网服务地址与密码
        return core.ok([
            {
                "id": r["id"],
                "name": r["name"],
                "status": r["status"],
            }
            for r in rows
        ])
    return core.ok([
        {
            "id": r["id"],
            "name": r["name"],
            "base_url": r["base_url"],
            "username": r["username"],
            "has_password": bool(r["password"]),
            "has_token": bool(r["integration_token"]),
            "status": r["status"],
            "last_check": r["last_check"],
        }
        for r in rows
    ])


@bp.post("/endpoints")
@core.require_admin
def create_endpoint():
    body = request.get_json(silent=True) or {}
    url = (body.get("base_url") or "").strip()
    if not url:
        return core.fail("请填写 YYB 服务地址")
    new_id = core.insert(
        "service_endpoints",
        {
            "kind": "yyb",
            "name": (body.get("name") or "YYB 协议服务").strip(),
            "base_url": url.rstrip("/"),
            "username": (body.get("username") or "").strip(),
            "password": body.get("password") or "",
            "integration_token": (body.get("integration_token") or "").strip(),
            "extra": "{}",
            "status": "unknown",
            "last_check": None,
            "created_time": core.iso(),
        },
    )
    return core.ok({"id": new_id})


@bp.put("/endpoints/<int:row_id>")
@core.require_admin
def update_endpoint(row_id: int):
    body = request.get_json(silent=True) or {}
    ep = yyb.endpoint(row_id)
    if not ep:
        return core.fail("端点不存在")
    data = {}
    for key in ("name", "base_url", "username"):
        if body.get(key) is not None:
            data[key] = str(body[key]).strip()
    if data.get("base_url"):
        data["base_url"] = data["base_url"].rstrip("/")
    if body.get("password"):
        data["password"] = body["password"]
    if body.get("integration_token") is not None:
        data["integration_token"] = str(body["integration_token"]).strip()
    if data:
        core.update("service_endpoints", row_id, data)
    return core.ok({})


@bp.delete("/endpoints/<int:row_id>")
@core.require_admin
def delete_endpoint(row_id: int):
    core.delete("service_endpoints", row_id)
    return core.ok({})


def _check_account_permission(ep: dict, ref: str) -> bool:
    """检查当前登录用户是否有权访问/操作该微信账号。管理员拥有一切权限。"""
    user = core.current_user()
    if not user:
        return False
    if user.get("role") == "admin":
        return True
    row = core.query_one(
        "SELECT 1 FROM yyb_account_links WHERE endpoint_id=? AND ref=? AND user_id=?",
        (ep["id"], str(ref), user["id"]),
    )
    return row is not None


# ---------------------------------------------------------------- 状态 / 账号


@bp.get("/status")
@core.require_login
@_guard
def status():
    ep = _endpoint_or_fail(_ep_id())
    result = yyb.status(ep)
    try:
        result["version"] = yyb.version(ep)
    except yyb.YYBError:
        pass
    return core.ok(result)


@bp.get("/accounts")
@core.require_login
@_guard
def accounts():
    ep = _endpoint_or_fail(_ep_id())
    rows = yyb.accounts(ep)
    user = core.current_user()
    is_admin = bool(user and user.get("role") == "admin")

    # 查归属关系
    links = {
        str(r["ref"]): dict(r)
        for r in core.query(
            "SELECT ref, user_id, label FROM yyb_account_links WHERE endpoint_id=?",
            (ep["id"],),
        )
    }

    if not is_admin:
        # 普通用户：严格数据隔离，只返回归属于当前用户的微信号
        uid = user["id"]
        rows = [r for r in rows if links.get(str(r.get("id")), {}).get("user_id") == uid]

    # 管理员视角查用户信息用于展示归属者
    users = {}
    if is_admin:
        users = {
            r["id"]: dict(r)
            for r in core.query("SELECT id, email, nickname FROM users")
        }

    out = []
    now = int(core.now_dt().timestamp())
    for row in rows:
        ref = str(row.get("id"))
        expires_in = row.get("credential_expires_in")
        if not expires_in and row.get("credential_expires_at"):
            expires_in = max(0, int(row["credential_expires_at"]) - now)
        openid = row.get("openid") or ""
        link = links.get(ref, {})
        uid = link.get("user_id")
        owner = users.get(uid) if (is_admin and uid) else None

        item = {
            **row,
            "openid_masked": f"{openid[:8]}…{openid[-6:]}" if len(openid) > 16 else openid,
            "credential_expires_in": expires_in,
            "display_name": row.get("remark") or row.get("alias") or row.get("nickname") or f"账号 {row.get('id')}",
            "user_id": uid,
        }
        if is_admin:
            item["owner_email"] = (owner or {}).get("email", "")
            item["owner_nickname"] = (owner or {}).get("nickname", "")
        out.append(item)
    return core.ok(out)


@bp.post("/accounts/refresh")
@core.require_login
@_guard
def account_refresh():
    ep = _endpoint_or_fail(_ep_id())
    body = request.get_json(silent=True) or {}
    ref = body.get("ref")
    if not ref:
        return core.fail("缺少账号 ref")
    if not _check_account_permission(ep, str(ref)):
        return core.fail("无权操作此账号", 403)
    return core.ok(yyb.refresh_account(ep, ref))


@bp.put("/accounts/remark")
@core.require_login
@_guard
def account_remark():
    ep = _endpoint_or_fail(_ep_id())
    body = request.get_json(silent=True) or {}
    ref = body.get("ref")
    if not ref:
        return core.fail("缺少账号 ref")
    if not _check_account_permission(ep, str(ref)):
        return core.fail("无权操作此账号", 403)
    remark = (body.get("remark") or "").strip()
    res = yyb.set_remark(ep, ref, remark)
    # 同步更新本地映射表的 label
    core.execute(
        "UPDATE yyb_account_links SET label=? WHERE endpoint_id=? AND ref=?",
        (remark, ep["id"], str(ref)),
    )
    return core.ok(res)


@bp.post("/get-code")
@core.require_login
@_guard
def get_code():
    ep = _endpoint_or_fail(_ep_id())
    body = request.get_json(silent=True) or {}
    ref = body.get("ref")
    app_id = body.get("app_id")
    if not ref or not app_id:
        return core.fail("需要 ref 与 app_id")
    if not _check_account_permission(ep, str(ref)):
        return core.fail("无权操作此账号", 403)
    data = yyb.get_code(ep, ref, app_id)
    result = (data or {}).get("result") or {}
    return core.ok(
        {
            "code": result.get("code", ""),
            "errMsg": result.get("errMsg", ""),
            "account": (data or {}).get("account"),
            "expires_in": (data or {}).get("expires_in"),
        }
    )


# ---------------------------------------------------------------- 青龙托管任务


@bp.get("/qinglong")
@core.require_admin
@_guard
def qinglong():
    ep = _endpoint_or_fail(_ep_id())
    return core.ok({"status": yyb.qinglong_status(ep), "config": yyb.qinglong_config(ep), "push": yyb.push_config(ep)})


@bp.get("/jobs")
@core.require_login
@_guard
def jobs():
    ep = _endpoint_or_fail(_ep_id())
    ref = request.args.get("ref")
    if not ref:
        return core.fail("缺少 ref")
    if not _check_account_permission(ep, str(ref)):
        return core.fail("无权访问此账号的任务", 403)
    return core.ok(yyb.jobs(ep, ref))


@bp.post("/jobs/run")
@core.require_login
@_guard
def jobs_run():
    ep = _endpoint_or_fail(_ep_id())
    body = request.get_json(silent=True) or {}
    ref = body.get("ref")
    if not ref or not body.get("script_key"):
        return core.fail("需要 ref 与 script_key")
    if not _check_account_permission(ep, str(ref)):
        return core.fail("无权运行此账号的任务", 403)
    return core.ok(yyb.run_job(ep, str(ref), body["script_key"]))


@bp.put("/jobs/enable")
@core.require_login
@_guard
def jobs_enable():
    ep = _endpoint_or_fail(_ep_id())
    body = request.get_json(silent=True) or {}
    ref = body.get("ref")
    if not ref or not body.get("script_key"):
        return core.fail("需要 ref 与 script_key")
    if not _check_account_permission(ep, str(ref)):
        return core.fail("无权修改此账号的任务状态", 403)
    return core.ok(yyb.enable_job(ep, str(ref), body["script_key"], bool(body.get("enabled"))))


@bp.get("/runs")
@core.require_login
@_guard
def runs():
    ep = _endpoint_or_fail(_ep_id())
    ref = request.args.get("ref")
    if not ref:
        return core.fail("缺少 ref")
    if not _check_account_permission(ep, str(ref)):
        return core.fail("无权查看此账号的历史执行记录", 403)
    return core.ok(yyb.runs(ep, ref))


@bp.post("/runs/log")
@core.require_login
@_guard
def runs_log():
    ep = _endpoint_or_fail(_ep_id())
    body = request.get_json(silent=True) or {}
    ref = body.get("ref")
    if not ref or not body.get("log_key"):
        return core.fail("需要 ref 与 log_key")
    if not _check_account_permission(ep, str(ref)):
        return core.fail("无权查看此账号的日志", 403)
    return core.ok(yyb.run_log(ep, str(ref), body["log_key"], body.get("script_key") or ""))


@bp.get("/jobs/log")
@core.require_login
@_guard
def jobs_log():
    ep = _endpoint_or_fail(_ep_id())
    ref = request.args.get("ref")
    script_key = request.args.get("script_key")
    if not ref or not script_key:
        return core.fail("需要 ref 与 script_key")
    if not _check_account_permission(ep, str(ref)):
        return core.fail("无权查看此账号的日志", 403)
    return core.ok(yyb.job_log(ep, str(ref), script_key))


# ---------------------------------------------------------------- 扫码加号


@bp.post("/qr")
@core.require_login
@_guard
def qr_new():
    ep = _endpoint_or_fail(_ep_id())
    body = request.get_json(silent=True) or {}
    data = yyb.scan_session(ep, _proxy_payload(body))
    session_id = data.get("session_id") or data.get("id") or ""
    return core.ok({**data, "image_url": f"/api/yyb/qr/image?session_id={session_id}&endpoint_id={ep['id']}"})


@bp.get("/qr/poll")
@core.require_login
@_guard
def qr_poll():
    ep = _endpoint_or_fail(_ep_id())
    session_id = request.args.get("session_id", "")
    if not session_id:
        return core.fail("缺少 session_id")
    res = yyb.scan_poll(ep, session_id)
    status = res.get("status")

    # 当 YYB 侧指示微信已授权（authorized），自动代为调用 confirm 入库并绑定给当前登录用户
    if status == "authorized":
        try:
            acc = yyb.scan_confirm(ep, session_id)
            if acc and acc.get("id"):
                ref = str(acc["id"])
                user = core.current_user()
                now = core.iso()
                label = acc.get("remark") or acc.get("alias") or acc.get("nickname") or f"账号 {ref}"
                existing = core.query_one(
                    "SELECT id FROM yyb_account_links WHERE endpoint_id=? AND ref=?",
                    (ep["id"], ref),
                )
                if existing:
                    core.execute(
                        "UPDATE yyb_account_links SET user_id=?, label=? WHERE id=?",
                        (user["id"], label, existing["id"]),
                    )
                else:
                    core.insert(
                        "yyb_account_links",
                        {
                            "endpoint_id": ep["id"],
                            "ref": ref,
                            "user_id": user["id"],
                            "label": label,
                            "created_time": now,
                        },
                    )
                res["status"] = "success"
                res["account"] = acc
        except Exception:
            pass

    return core.ok(res)


@bp.get("/qr/image")
@core.require_login
@_guard
def qr_image():
    """把 YYB 的二维码图片代理回面板（浏览器直连会有跨域/取不到的问题）"""
    import requests as _requests
    from flask import Response

    ep = _endpoint_or_fail(_ep_id())
    session_id = request.args.get("session_id", "")
    url = yyb.scan_image_url(ep, session_id)
    session = yyb._session(ep)  # noqa: SLF001 取已登录会话，二维码接口需要鉴权
    resp = _requests.get(url, cookies=session.cookies, timeout=20)
    return Response(resp.content, mimetype=resp.headers.get("Content-Type", "image/png"))


# ---------------------------------------------------------------- 登录代理（直读 YYB）
#
# 面板不在本地维护代理池：配置库、省份/城市都实时读 YYB，选中的配置随
# /qr 一起下发。这样 YYB 控制台里改过的配置，面板刷新就能看到。


@bp.get("/proxy-profiles")
@core.require_login
@_guard
def proxy_profiles():
    ep = _endpoint_or_fail(_ep_id())
    rows = yyb.proxy_profiles(ep)
    user = core.current_user()
    if user and user.get("role") == "admin":
        return core.ok(rows)
    # 非管理员只给「选择配置」需要的字段；api_url 可能带供应商密钥，不下发
    return core.ok([
        {k: row.get(k) for k in ("id", "name", "provider", "proxy_type")}
        for row in rows
    ])


@bp.get("/proxy-profiles/areas/provinces")
@core.require_login
@_guard
def proxy_provinces():
    ep = _endpoint_or_fail(_ep_id())
    return core.ok(yyb.proxy_provinces(ep))


@bp.get("/proxy-profiles/areas/cities")
@core.require_login
@_guard
def proxy_cities():
    ep = _endpoint_or_fail(_ep_id())
    province = (request.args.get("province") or "").strip()
    if not province:
        return core.fail("缺少 province")
    return core.ok(yyb.proxy_cities(ep, province))


@bp.post("/proxy/test")
@core.require_login
@_guard
def proxy_test():
    ep = _endpoint_or_fail(_ep_id())
    body = request.get_json(silent=True) or {}
    return core.ok(yyb.proxy_test(ep, _proxy_payload(body)))


# ---------------------------------------------------------------- 绑定矩阵
#
# 「哪些账号参加哪些脚本」这张 (脚本 × 账号) 矩阵。
# 这里只负责读出来和存起来；真正的下发（写青龙 env 或 cron.task_before）是单独一步。


def _account_columns() -> list[dict]:
    """YYB 账号作为矩阵的列。

    注意 ref 只认 YYB 的 id / uin / openid —— 微信 wxid 会被 404
    （实测：ref=wxid_c5k6k72soruj22 -> "account not found"）。
    """
    ep = yyb.default_endpoint()
    if not ep:
        return []
    try:
        rows = yyb.accounts(ep)
    except yyb.YYBError:
        return []
    out = []
    for a in rows:
        out.append(
            {
                "ref": str(a.get("id")),
                "id": a.get("id"),
                "uin": a.get("uin"),
                "openid": a.get("openid"),
                "label": a.get("remark") or a.get("alias") or a.get("nickname") or f"账号 {a.get('id')}",
                "status": a.get("status") or "unknown",
            }
        )
    return out


@bp.get("/bindings")
@core.require_admin
@_guard
def bindings_list():
    """脚本 × 账号 矩阵。

    默认读面板库里存的那份（秒回）；?collect=1 才去青龙重新采集并覆盖。
    """
    ep_ql = qlc.endpoint(request.args.get("qinglong_id"))
    if not ep_ql:
        return core.fail("还没有配置青龙端点，请先填青龙地址与 OpenAPI 凭据")
    if request.args.get("collect") == "1":
        data = bindings_mod.collect(ep_ql)
        bindings_mod.sync(data["scripts"])
    rows = bindings_mod.stored()
    accounts = _account_columns()
    valid = {a["ref"] for a in accounts}
    for r in rows:
        r["unknown_refs"] = [x for x in r["refs"] if x not in valid]
    return core.ok(
        {
            "scripts": rows,
            "accounts": accounts,
            "qinglong": {
                "id": ep_ql["id"],
                "name": ep_ql["name"],
                "base_url": ep_ql["base_url"],
            },
            "stats": {
                "scripts": len(rows),
                "accounts": len(accounts),
                "bound": sum(1 for r in rows if r["refs"]),
                "empty": sum(1 for r in rows if not r["refs"]),
                "hidden": sum(1 for r in rows if r.get("is_hidden") == 1),
                "unknown_refs": sum(len(r["unknown_refs"]) for r in rows),
            },
        }
    )


@bp.get("/bindings/preview")
@core.require_admin
@_guard
def bindings_preview():
    """预览下发物：同一张矩阵在 env / task_before 两种落点下各会写成什么。只读。"""
    mode = request.args.get("mode") or "env"
    rows = bindings_mod.stored()
    ep = _endpoint_or_fail(_ep_id())
    yyb_base = (ep.get("base_url") or "").rstrip("/")
    items = []
    for r in rows:
        value = ",".join(r["refs"])
        is_yyb = r["env_name"] == "YYB_SERVER" or not r["env_name"]
        if is_yyb:
            rendered = bindings_mod.set_task_before_yyb_server("", yyb_base, r["refs"])
        elif not r["env_name"]:
            rendered = ""
        elif mode == "task_before":
            rendered = f"export {r['env_name']}='{value}'"
        else:
            rendered = f"{r['env_name']} = {value}"
        items.append(
            {
                "name": r["name"],
                "script_key": r["script_key"],
                "cron_id": r["cron_id"],
                "env_name": r["env_name"],
                "refs": r["refs"],
                "rendered": rendered,
                "is_yyb_server": is_yyb,
            }
        )
    return core.ok({"mode": mode, "items": items})


def _write_bindings(items: list[dict]) -> int:
    now = core.iso()
    n = 0
    for item in items:
        script_key = str(item.get("script_key") or "").strip()
        if not script_key:
            continue
        cur = core.query_one("SELECT id FROM script_bindings WHERE script_key=?", (script_key,))
        if not cur:
            continue
        updates = []
        params = []
        if "refs" in item:
            refs = [str(x).strip() for x in (item.get("refs") or []) if str(x).strip()]
            updates.append("refs=?")
            params.append(json.dumps(refs, ensure_ascii=False))
            updates.append("source=?")
            params.append("manual")
        if "is_hidden" in item:
            updates.append("is_hidden=?")
            params.append(int(item["is_hidden"]))
        if not updates:
            continue
        updates.append("updated_time=?")
        params.append(now)
        params.append(cur["id"])
        core.execute(
            f"UPDATE script_bindings SET {', '.join(updates)} WHERE id=?",
            tuple(params),
        )
        n += 1
    return n


@bp.put("/bindings")
@core.require_admin
@_guard
def bindings_save():
    """保存绑定。接受单行 {script_key, refs, is_hidden?} 或批量 {items:[{script_key, refs, is_hidden?}]}。

    只落面板库，不动青龙。下发走 /bindings/apply（尚未开放）。
    """
    body = request.get_json(silent=True) or {}
    items = body.get("items")
    if items is None:
        items = [body] if body.get("script_key") else []
    if not items:
        return core.fail("没有可保存的绑定行")
    saved = _write_bindings(items)
    return core.ok({"saved": saved})


@bp.put("/bindings/visibility")
@core.require_admin
@_guard
def bindings_visibility():
    """快速切换脚本的失效隐藏状态（单条或批量）。
    body: {"script_key": "xxx", "is_hidden": 1} 或 {"script_keys": ["a", "b"], "is_hidden": 1}
    """
    body = request.get_json(silent=True) or {}
    keys = body.get("script_keys")
    if keys is None:
        keys = [body.get("script_key")] if body.get("script_key") else []
    keys = [str(k).strip() for k in keys if str(k or "").strip()]
    if not keys:
        return core.fail("未指定脚本 key")
    is_hidden = 1 if body.get("is_hidden") else 0
    now = core.iso()
    placeholders = ",".join("?" for _ in keys)
    core.execute(
        f"UPDATE script_bindings SET is_hidden=?, updated_time=? WHERE script_key IN ({placeholders})",
        (is_hidden, now, *keys),
    )
    return core.ok({"updated": len(keys), "is_hidden": is_hidden})
    if not items:
        return core.fail("没有可保存的绑定行")
    saved = _write_bindings(items)
    return core.ok({"saved": saved})


@bp.post("/bindings/sync")
@core.require_admin
@_guard
def bindings_sync():
    """从青龙重新采集全量定时任务并更新面板数据库。仅管理员权限可操作。"""
    ep_ql = qlc.endpoint()
    if not ep_ql:
        return core.fail("未配置青龙端点")
    try:
        data = bindings_mod.collect(ep_ql)
        saved = bindings_mod.sync(data["scripts"])
        return core.ok({"total": len(data["scripts"]), "saved": saved})
    except Exception as exc:
        return core.fail(f"同步青龙任务失败：{exc}")


# ---------------------------------------------------------------- 微信号归属
#
# YYB 实例里的微信号，默认是「无主」的 —— 谁登录都能看见。
# 做「用户只能控制自己的」，就得先有归属关系，这张关系表就是 yyb_account_links。
# 单后台单用户体系，归属可分配给系统内的所有普通用户。


def _owners_rows(ep: dict) -> list[dict]:
    links = {
        (int(r["endpoint_id"] or 0), str(r["ref"])): dict(r)
        for r in core.query("SELECT * FROM yyb_account_links")
    }
    users = {
        r["id"]: dict(r)
        for r in core.query("SELECT id, email, nickname, channel, role FROM users")
    }
    rows = []
    for account in yyb.accounts(ep):
        ref = str(account.get("id"))
        link = links.get((int(ep["id"]), ref), {})
        uid = link.get("user_id")
        owner = users.get(uid) if uid else None
        rows.append(
            {
                "ref": ref,
                "uin": account.get("uin") or "",
                "openid": account.get("openid") or "",
                "label": account.get("remark") or account.get("alias") or account.get("nickname") or f"账号 {ref}",
                "status": account.get("status") or "unknown",
                "user_id": uid,
                "owner_email": (owner or {}).get("email", ""),
                "owner_nickname": (owner or {}).get("nickname", ""),
            }
        )
    return rows


@bp.get("/owners")
@core.require_admin
@_guard
def owners_list():
    """微信号 + 归属。管理员视角，能看到全部。"""
    ep = _endpoint_or_fail(_ep_id())
    rows = _owners_rows(ep)
    owners = core.query(
        "SELECT id, email, nickname, channel, role FROM users WHERE status != 'banned' ORDER BY id"
    )
    return core.ok(
        {
            "accounts": rows,
            "users": [dict(r) for r in owners],
            "stats": {
                "total": len(rows),
                "assigned": sum(1 for r in rows if r["user_id"]),
                "free": sum(1 for r in rows if not r["user_id"]),
            },
        }
    )


@bp.put("/owners")
@core.require_admin
@_guard
def owners_assign():
    """把微信号分配给某个面板用户；user_id 传 null 表示解除归属。

    body: {"refs": ["1","3"], "user_id": 7}  或  {"ref": "1", "user_id": null}
    """
    ep = _endpoint_or_fail(_ep_id())
    body = request.get_json(silent=True) or {}
    refs = body.get("refs")
    if refs is None:
        refs = [body.get("ref")] if body.get("ref") else []
    refs = [str(r).strip() for r in refs if str(r or "").strip()]
    if not refs:
        return core.fail("没有指定微信号")

    user_id = body.get("user_id")
    if user_id in ("", None):
        user_id = None
    else:
        user_id = int(user_id)
        if not core.query_one("SELECT 1 FROM users WHERE id=?", (user_id,)):
            return core.fail("用户不存在")

    known = {str(a.get("id")) for a in yyb.accounts(ep)}
    now = core.iso()
    done = []
    for ref in refs:
        if ref not in known:
            return core.fail(f"应用宝里没有编号 {ref} 的账号")
        existing = core.query_one(
            "SELECT * FROM yyb_account_links WHERE endpoint_id=? AND ref=?", (ep["id"], ref)
        )
        if existing:
            core.execute(
                "UPDATE yyb_account_links SET user_id=? WHERE id=?", (user_id, existing["id"])
            )
        else:
            core.insert(
                "yyb_account_links",
                {
                    "endpoint_id": ep["id"],
                    "ref": ref,
                    "user_id": user_id,
                    "label": "",
                    "created_time": now,
                },
            )
        done.append(ref)
    return core.ok({"refs": done, "user_id": user_id})


# ---------------------------------------------------------------- 用户自主管理小程序活动


def _classify_activity(name: str) -> str:
    """按活动名称进行智能分类"""
    lower = name.lower()
    if any(k in lower for k in ("车", "丰田", "出行", "顺风", "smart")):
        return "汽车出行"
    if any(k in lower for k in ("快递", "中通", "顺丰", "提现", "回收", "衣", "蚂蚁", "生活", "日清", "万家乐", "老板电器", "海尔", "顾家")):
        return "便民生活"
    if any(k in lower for k in ("酒", "乐", "可乐", "茶", "奶", "食", "味", "饮", "粮", "吃", "塔斯汀", "康师傅", "恰恰", "好人家", "牛油谷", "臭宝", "国乐", "飞鹤", "植白")):
        return "食品餐饮"
    if any(k in lower for k in ("商城", "潮玩", "福利社", "casetify", "361", "乔丹", "交个朋友", "大生", "珠宝", "谢瑞麟", "谭木匠", "鸿星尔克", "麦富迪", "宠享", "千金")):
        return "电商潮玩"
    if any(k in lower for k in ("短剧", "电玩", "影", "音乐", "社区", "iqoo", "七彩虹", "游戏", "星", "抽盒", "tilta", "盈客宝", "风云再起")):
        return "数码文娱"
    return "综合签到"


@bp.get("/my-activities")
@core.require_login
@_guard
def my_activities_list():
    """获取当前用户的所有微信账号及其参与的小程序活动。普通用户专属接口。"""
    import re
    ep = _endpoint_or_fail(_ep_id())
    user = core.current_user()
    is_admin = bool(user and user.get("role") == "admin")

    # 查当前用户绑定的账号
    user_links = {
        str(r["ref"]): dict(r)
        for r in core.query(
            "SELECT ref, label FROM yyb_account_links WHERE endpoint_id=? AND user_id=?",
            (ep["id"], user["id"]),
        )
    }

    # 查 YYB 实例中的真实账号
    all_accounts = yyb.accounts(ep)
    my_accounts = []
    for a in all_accounts:
        ref_str = str(a.get("id"))
        if is_admin or ref_str in user_links:
            remark = a.get("remark") or ""
            nick = a.get("nickname") or ""
            label = remark or a.get("alias") or nick or f"账号 {ref_str}"
            my_accounts.append({
                "ref": ref_str,
                "id": a.get("id"),
                "label": label,
                "remark": remark,
                "nickname": nick,
                "status": a.get("status") or "unknown",
            })

    user_refs_set = {a["ref"] for a in my_accounts}

    # 读取数据库中的小程序活动（过滤已失效隐藏的活动，前台禁止展示）
    rows = core.query("SELECT * FROM script_bindings WHERE is_hidden = 0 ORDER BY name")
    activities = []
    account_active_counts = {ref: 0 for ref in user_refs_set}

    for r in rows:
        refs = json.loads(r["refs"] or "[]")
        # 仅过滤属于当前用户且已参与的 refs
        participating = [str(x) for x in refs if str(x) in user_refs_set]
        for pref in participating:
            account_active_counts[pref] = account_active_counts.get(pref, 0) + 1

        clean_name = re.sub(r"^(code版_|code_)", "", str(r["name"] or ""))
        activities.append({
            "id": r["id"],
            "script_key": r["script_key"],
            "name": r["name"],
            "clean_name": clean_name,
            "category": _classify_activity(clean_name),
            "env_name": r["env_name"] or "",
            "app_id": r["app_id"] or "",
            "schedule": r["schedule"] or "",
            "enabled": int(r["enabled"] or 0),
            "participating_refs": participating,
            "total_participants": len(refs),
        })

    # 为账号附加参与活动数
    for a in my_accounts:
        a["active_count"] = account_active_counts.get(a["ref"], 0)

    categories = ["全部", "电商潮玩", "便民生活", "食品餐饮", "汽车出行", "数码文娱", "综合签到"]

    return core.ok({
        "accounts": my_accounts,
        "activities": activities,
        "categories": categories,
        "stats": {
            "total_activities": len(activities),
            "user_accounts": len(my_accounts),
        },
    })


@bp.put("/my-activities")
@core.require_login
@_guard
def my_activities_save():
    """保存当前用户的某个或多个账号的小程序活动参与配置。
    
    请求体格式：
    1. 单账号更新：{"account_ref": "4", "enabled_script_keys": ["key1", "key2"]}
    2. 复制配置：{"copy_from": "4", "target_refs": ["1", "2"]}
    3. 批量更新：{"bindings": {"4": ["key1"], "1": ["key1", "key2"]}}
    """
    ep = _endpoint_or_fail(_ep_id())
    user = core.current_user()
    is_admin = bool(user and user.get("role") == "admin")
    body = request.get_json(silent=True) or {}

    # 获取当前用户可支配的账号
    user_links = {
        str(r["ref"])
        for r in core.query(
            "SELECT ref FROM yyb_account_links WHERE endpoint_id=? AND user_id=?",
            (ep["id"], user["id"]),
        )
    }

    def _assert_ref(ref: str):
        if not is_admin and str(ref) not in user_links:
            raise LookupError(f"无权配置账号 #{ref}")

    updates: dict[str, set[str]] = {}  # ref -> set(enabled_script_keys)

    if "copy_from" in body and "target_refs" in body:
        src = str(body["copy_from"]).strip()
        _assert_ref(src)
        targets = [str(t).strip() for t in body.get("target_refs", []) if str(t).strip()]
        for t in targets:
            _assert_ref(t)
        # 读取 src 当前已开启的所有 script_key（仅限前台可见的有效活动）
        rows = core.query("SELECT script_key, refs FROM script_bindings WHERE is_hidden = 0")
        src_keys = set()
        for r in rows:
            r_refs = json.loads(r["refs"] or "[]")
            if src in [str(x) for x in r_refs]:
                src_keys.add(r["script_key"])
        for t in targets:
            updates[t] = set(src_keys)

    elif "bindings" in body and isinstance(body["bindings"], dict):
        for ref_key, keys in body["bindings"].items():
            r = str(ref_key).strip()
            _assert_ref(r)
            updates[r] = set(keys or [])

    elif "account_ref" in body:
        r = str(body["account_ref"]).strip()
        _assert_ref(r)
        keys = set(body.get("enabled_script_keys") or [])
        updates[r] = keys
    else:
        return core.fail("无效的请求参数，需指定 account_ref、bindings 或 copy_from")

    if not updates:
        return core.fail("未指定需要保存的配置")

    # 执行更新：对所有受影响的活动更新 refs，严格保留非本用户的 refs 与已隐藏的活动
    now = core.iso()
    # 仅允许更新未隐藏的可见活动，避免前台提交时将已被管理员隐藏的脚本中的账号绑定误清空
    visible_keys = {
        r["script_key"] for r in core.query("SELECT script_key FROM script_bindings WHERE is_hidden = 0")
    }
    rows = core.query("SELECT id, script_key, cron_id, env_name, refs, source FROM script_bindings")
    modified_rows = []

    for r in rows:
        key = r["script_key"]
        # 若活动已被管理员标记为隐藏/失效，用户前台提交不得对其做任何增删修改
        if key not in visible_keys:
            continue
        orig_refs = [str(x) for x in json.loads(r["refs"] or "[]")]
        new_refs_set = set(orig_refs)
        changed = False

        for target_ref, enabled_set in updates.items():
            should_enable = key in enabled_set
            is_enabled = target_ref in new_refs_set

            if should_enable and not is_enabled:
                new_refs_set.add(target_ref)
                changed = True
            elif not should_enable and is_enabled:
                new_refs_set.remove(target_ref)
                changed = True

        if changed:
            # 排序保持稳定
            final_refs = sorted(list(new_refs_set), key=lambda x: (len(x), x))
            core.execute(
                "UPDATE script_bindings SET refs=?, updated_time=? WHERE id=?",
                (json.dumps(final_refs, ensure_ascii=False), now, r["id"]),
            )
            modified_rows.append({
                "script_key": key,
                "cron_id": r["cron_id"],
                "env_name": r["env_name"],
                "refs": final_refs,
                "source": r["source"],
            })

    # 同步变更到青龙（支持专属环境变量与 task_before 级 YYB_SERVER）
    sync_err = ""
    try:
        ep_ql = qlc.endpoint()
        if ep_ql and modified_rows:
            ql_status = qlc.status(ep_ql)
            if ql_status.get("online"):
                yyb_base = (ep.get("base_url") or "").rstrip("/")
                for item in modified_rows:
                    env_name = item.get("env_name")
                    cron_id = item.get("cron_id")

                    # 1. 如果是 YYB_SERVER 模式（lcmovie 脚本）或没有专属变量名
                    if (env_name == "YYB_SERVER" or not env_name) and cron_id:
                        try:
                            cron_data = qlc.cron(ep_ql, cron_id)
                            if cron_data and cron_data.get("id"):
                                cur_before = str(cron_data.get("task_before") or "")
                                new_before = bindings_mod.set_task_before_yyb_server(
                                    cur_before, yyb_base, item["refs"]
                                )
                                if new_before != cur_before:
                                    cron_data["task_before"] = new_before
                                    qlc.update_cron(ep_ql, cron_data)
                        except Exception as cron_exc:
                            sync_err = f"青龙任务 task_before 同步提示: {cron_exc}"

                    # 2. 如果是专属环境变量模式（如 hrt_wxid）
                    elif env_name and env_name != "YYB_SERVER":
                        value = ",".join(item["refs"])
                        existing_envs = qlc.env_by_name(ep_ql, env_name)
                        if value:
                            env_id = existing_envs[0]["id"] if existing_envs else None
                            qlc.save_env(ep_ql, env_name, value, remarks="面板自动下发", env_id=env_id)
                        elif existing_envs:
                            qlc.delete_env(ep_ql, [e["id"] for e in existing_envs])
    except Exception as exc:
        sync_err = f"青龙同步提示: {exc}"

    return core.ok({
        "saved": True,
        "modified_count": len(modified_rows),
        "target_accounts": list(updates.keys()),
        "sync_note": sync_err,
    })


