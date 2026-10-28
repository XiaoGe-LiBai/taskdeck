"""/api/projects/*：项目目录、积分定价、隐藏与单独授权、提交扣分。

「项目」是能提交同步到青龙的东西，两个渠道共用一张目录（见 projects.py）。
这里的接口分两组：
    管理员  /api/admin/projects*  改价格、切隐藏、授权给具体用户
    用户    /api/projects*        看自己可见的项目、提交（扣积分）
"""
from __future__ import annotations

from functools import wraps

from flask import Blueprint, request

import core
import projects as proj

bp = Blueprint("projects", __name__)


def _guard(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except proj.InsufficientPoints as exc:
            return core.fail(str(exc), code=402)
        except proj.ProjectError as exc:
            return core.fail(str(exc))

    return wrapper


def _decorate(rows: list[dict], grants: dict[int, list[dict]] | None = None) -> list[dict]:
    out = []
    for row in rows:
        item = dict(row)
        item["channel_label"] = proj.CHANNEL_LABEL.get(row["channel"], row["channel"])
        item["field_config"] = proj.parse_field_config(item.get("field_config"))
        if grants is not None:
            item["grants"] = grants.get(int(row["id"]), [])
        out.append(item)
    return out


# ---------------------------------------------------------------- 管理员


@bp.get("/admin/projects")
@core.require_admin
def admin_list():
    proj.sync_catalog()
    rows = proj.all_projects()
    grants = proj.grants_map()
    users = [
        dict(r)
        for r in core.query(
            "SELECT id, email, nickname, role, channel FROM users ORDER BY id"
        )
    ]
    return core.ok(
        {
            "projects": _decorate(rows, grants),
            "users": users,
            "stats": {
                "total": len(rows),
                "hidden": sum(1 for r in rows if r["hidden"]),
                "priced": sum(1 for r in rows if int(r["points_cost"] or 0) > 0),
                "granted": sum(1 for r in rows if grants.get(int(r["id"]))),
            },
        }
    )


@bp.post("/admin/projects/sync")
@core.require_admin
def admin_sync():
    """重新从 coupon_types / script_bindings 播种目录（不会覆盖已设的价格）。"""
    return core.ok(proj.sync_catalog())


@bp.put("/admin/projects/<int:pid>")
@core.require_admin
def admin_update(pid: int):
    body = request.get_json(silent=True) or {}
    row = core.query_one("SELECT * FROM projects WHERE id=?", (pid,))
    if not row:
        return core.fail("项目不存在")

    data: dict = {}
    if body.get("name") is not None:
        name = str(body["name"]).strip()
        if not name:
            return core.fail("项目名不能为空")
        data["name"] = name[:60]
    if body.get("points_cost") is not None:
        try:
            cost = int(body["points_cost"])
        except (TypeError, ValueError):
            return core.fail("积分价格必须是整数")
        if cost < 0:
            return core.fail("积分价格不能为负")
        data["points_cost"] = cost
    if body.get("hidden") is not None:
        data["hidden"] = 1 if body["hidden"] else 0
    if body.get("min_vip_level") is not None:
        try:
            lv = int(body["min_vip_level"])
        except (TypeError, ValueError):
            return core.fail("会员等级门槛必须是整数")
        if lv < 0:
            return core.fail("会员等级门槛不能为负")
        data["min_vip_level"] = lv
    if body.get("status") is not None:
        status = str(body["status"])
        if status not in ("enabled", "disabled"):
            return core.fail("状态只能是 enabled / disabled")
        data["status"] = status
    if body.get("sort_order") is not None:
        try:
            data["sort_order"] = int(body["sort_order"])
        except (TypeError, ValueError):
            return core.fail("排序必须是整数")

    if data:
        sets = ", ".join(f"{k}=?" for k in data)
        core.execute(f"UPDATE projects SET {sets} WHERE id=?", tuple(data.values()) + (pid,))
    updated = core.query_one("SELECT * FROM projects WHERE id=?", (pid,))
    return core.ok(_decorate([dict(updated)], proj.grants_map())[0])


@bp.put("/admin/projects/<int:pid>/grants")
@core.require_admin
def admin_set_grants(pid: int):
    body = request.get_json(silent=True) or {}
    if not core.query_one("SELECT 1 FROM projects WHERE id=?", (pid,)):
        return core.fail("项目不存在")
    user_ids = body.get("user_ids") or []
    n = proj.set_grants(pid, user_ids)
    return core.ok({"project_id": pid, "granted": n, "grants": proj.grants_map().get(pid, [])})


@bp.put("/admin/projects/batch")
@core.require_admin
def admin_projects_batch():
    """批量保存项目设置：价格/隐藏 + 单独授权，一次提交，单事务原子生效。

    body: {"items": [{"id":1,"points_cost":100,"hidden":false}, ...],
           "grants": {"1": [2,3], ...}}
    """
    body = request.get_json(silent=True) or {}
    items = body.get("items") or []
    grants = body.get("grants") or {}
    if not isinstance(items, list):
        return core.fail("items 必须是数组")
    if not items and not grants:
        return core.fail("没有要保存的改动")

    updated = 0
    granted = 0
    db = core.get_db()
    db.execute("BEGIN")
    try:
        for item in items:
            try:
                pid = int(item.get("id"))
                cost = int(item.get("points_cost", 0))
                min_lv = int(item.get("min_vip_level") or 0)
            except (TypeError, ValueError):
                raise ValueError("项目 id / 价格 / 等级门槛必须是整数")
            if cost < 0:
                raise ValueError("积分价格不能为负")
            if min_lv < 0:
                raise ValueError("会员等级门槛不能为负")
            if not db.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone():
                raise ValueError(f"项目 #{pid} 不存在")
            db.execute(
                "UPDATE projects SET points_cost=?, hidden=?, min_vip_level=? WHERE id=?",
                (cost, 1 if item.get("hidden") else 0, min_lv, pid),
            )
            updated += 1
        for raw_pid, user_ids in grants.items():
            try:
                pid = int(raw_pid)
            except (TypeError, ValueError):
                continue
            if not db.execute("SELECT 1 FROM projects WHERE id=?", (pid,)).fetchone():
                continue
            granted += proj.set_grants(pid, user_ids or [])
        db.execute("COMMIT")
    except ValueError as exc:
        db.execute("ROLLBACK")
        return core.fail(str(exc))
    except Exception:
        try:
            db.execute("ROLLBACK")
        except Exception:
            pass
        return core.fail("批量保存失败，已回滚")
    return core.ok({"updated": updated, "granted": granted})


@bp.post("/admin/custom-scripts")
@core.require_admin
@_guard
def admin_create_custom_script():
    """管理员新增自定义对接脚本。"""
    body = request.get_json(silent=True) or {}
    item = proj.create_custom_project(body)
    return core.ok(_decorate([item], proj.grants_map())[0], "创建成功")


@bp.put("/admin/custom-scripts/<int:pid>")
@core.require_admin
@_guard
def admin_update_custom_script(pid: int):
    """管理员更新自定义脚本配置及动态参数字段。"""
    body = request.get_json(silent=True) or {}
    item = proj.update_custom_project(pid, body)
    return core.ok(_decorate([item], proj.grants_map())[0], "更新成功")


@bp.delete("/admin/custom-scripts/<int:pid>")
@core.require_admin
@_guard
def admin_delete_custom_script(pid: int):
    """管理员删除自定义脚本。"""
    success = proj.delete_custom_project(pid)
    if not success:
        return core.fail("删除失败或项目不存在")
    return core.ok({"id": pid}, "已删除")


@bp.get("/admin/custom-scripts/submissions")
@core.require_admin
def admin_list_submissions():
    """管理员查看所有用户提交历史。"""
    limit = int(request.args.get("limit", 50))
    rows = proj.list_custom_submissions(user_id=None, limit=limit)
    return core.ok({"submissions": rows, "total": len(rows)})


# ---------------------------------------------------------------- 用户


@bp.get("/projects")
@core.require_login
def user_list():
    """当前登录用户可见的项目（隐藏项只对单独授权的用户出现）。
    支持 query 参数 ?channel=custom 仅获取自定义脚本。
    """
    user = dict(core.current_user())
    channel = (request.args.get("channel") or "").strip()
    rows = proj.visible_for(user)
    if channel:
        rows = [r for r in rows if r["channel"] == channel]
    return core.ok(
        {
            "projects": _decorate(rows),
            "role": user.get("role"),
            "my_role": user.get("role"),
            "channel_labels": proj.CHANNEL_LABEL,
        }
    )


@bp.get("/custom-scripts")
@core.require_login
def user_custom_scripts():
    """专门返回当前用户可见的自定义对接脚本列表。"""
    user = dict(core.current_user())
    rows = [r for r in proj.visible_for(user) if r["channel"] == "custom"]
    return core.ok(
        {
            "projects": _decorate(rows),
            "total": len(rows),
        }
    )


@bp.get("/custom-scripts/submissions")
@core.require_login
def user_list_submissions():
    """用户查看自己的自定义脚本提交历史。"""
    user = dict(core.current_user())
    limit = int(request.args.get("limit", 50))
    rows = proj.list_custom_submissions(user_id=int(user["id"]), limit=limit)
    return core.ok({"submissions": rows, "total": len(rows)})


@bp.post("/projects/submit")
@core.require_login
@_guard
def user_submit():
    """提交某个项目同步到青龙 —— 按项目定价扣积分（与小蚕共用一套余额）。
    如果该项目是自定义脚本，会自动校验其动态参数并保存提交记录。
    """
    user = dict(core.current_user())
    body = request.get_json(silent=True) or {}
    key = (body.get("project_key") or "").strip()
    if not key:
        return core.fail("缺少 project_key")

    project = proj.get_by_key(key)
    if not project:
        return core.fail("项目不存在")
    if (user.get("role") or "user") != "admin":
        visible = {r["project_key"] for r in proj.visible_for(user)}
        if key not in visible:
            return core.fail("这个项目不在你的可用范围内")

    channel = project.get("channel")
    params_data = body.get("params") or {}
    account_label = ""

    # 如果是自定义脚本，验证并清洗动态参数
    if channel == "custom":
        fc = proj.parse_field_config(project.get("field_config"))
        raw_params = {**params_data}
        for f in fc:
            k = f["key"]
            if k in body and k not in raw_params:
                raw_params[k] = body[k]
        cleaned_params, account_label = proj.validate_custom_params(fc, raw_params)
    else:
        cleaned_params = params_data
        account_label = body.get("account") or ""

    # 执行积分扣除
    submit_note = body.get("note") or f"提交「{project['name']}」"
    result = proj.charge(int(user["id"]), key, submit_note)

    # 记录到提交表
    sub_id = None
    if channel == "custom":
        sub_id = proj.record_custom_submission(
            user_id=int(user["id"]),
            project=project,
            params=cleaned_params,
            account=account_label,
            cost=result["cost"],
            status="submitted",
            result_msg="提交成功",
        )

    return core.ok(
        {
            "submission_id": sub_id,
            "project": result["project"]["name"],
            "project_key": key,
            "channel": channel,
            "cost": result["cost"],
            "balance": result["balance"],
            "account": account_label,
            "params": cleaned_params,
            "dispatched": bool(project.get("env_name")),
            "note": "提交成功并完成积分结算" if channel == "custom" else "已扣积分并记录，下发同步通道尚未接入",
        }
    )
