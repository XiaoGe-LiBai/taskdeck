"""项目目录：积分定价、隐藏与单独授权。

「项目」= 一个能提交同步到青龙的东西。两个渠道共用一张目录表：

    小蚕   project_key = "xiaocan:<coupon_types.id>"    业务名如「每日签到」
    应用宝 project_key = "yyb:<script_key>"              业务名如「华润通签到」

定价与余额是**一套**：扣分走 core.add_points()，和小蚕买会员、转盘抽奖共用 users.points_balance。
"""
from __future__ import annotations

import json
import re

import core
import vip


class ProjectError(RuntimeError):
    pass


class InsufficientPoints(ProjectError):
    pass


CHANNEL_LABEL = {"xiaocan": "小蚕", "yyb": "应用宝", "custom": "自定义脚本"}


# ---------------------------------------------------------------- 目录同步


def sync_catalog() -> dict:
    """把两个渠道的可提交项同步进 projects（幂等）。

    只补缺失的行，**绝不覆盖**已经设好的价格 / 隐藏 / 排序 —— 那些是管理员的配置。
    源里消失的项目标记成 status='removed'（保留授权和历史，不硬删）。
    """
    now = core.iso()
    created = 0
    known: set[str] = set()

    sources: list[tuple[str, str, str, str, int]] = []
    # xiaocan：coupon_types 就是小蚕的任务开关目录
    for row in core.query("SELECT * FROM coupon_types ORDER BY sort_order, id"):
        key = f"xiaocan:{row['id']}"
        sources.append((key, "xiaocan", row["name"] or f"任务 {row['id']}", str(row["id"]), int(row["points_cost"] or 0)))
    # yyb：script_bindings 是青龙里已订阅的 code 版脚本
    for row in core.query("SELECT * FROM script_bindings ORDER BY name"):
        key = f"yyb:{row['script_key']}"
        sources.append((key, "yyb", row["name"] or row["script_key"], row["script_key"], 0))

    for key, channel, name, ref_id, cost in sources:
        known.add(key)
        existing = core.query_one("SELECT * FROM projects WHERE project_key=?", (key,))
        if existing:
            # 只同步展示名和恢复被标记移除的项，价格/隐藏/排序保持管理员设定
            if existing["name"] != name and not existing["hidden"]:
                core.execute("UPDATE projects SET name=? WHERE id=?", (name, existing["id"]))
            if existing["status"] == "removed":
                core.execute("UPDATE projects SET status='enabled' WHERE id=?", (existing["id"],))
            continue
        core.insert(
            "projects",
            {
                "project_key": key,
                "channel": channel,
                "name": name,
                "ref_id": ref_id,
                "points_cost": cost,
                "hidden": 0,
                "status": "enabled",
                "sort_order": 0,
                "created_time": now,
            },
        )
        created += 1

    removed = 0
    for row in core.query(
        "SELECT * FROM projects WHERE status='enabled' AND channel IN ('xiaocan', 'yyb')"
    ):
        if row["project_key"] not in known:
            core.execute("UPDATE projects SET status='removed' WHERE id=?", (row["id"],))
            removed += 1

    return {"created": created, "removed": removed, "total": len(known)}


# ---------------------------------------------------------------- 读


def all_projects() -> list[dict]:
    """管理员视角：全部（含隐藏与已移除）。"""
    return [
        dict(r)
        for r in core.query(
            "SELECT * FROM projects ORDER BY channel, sort_order, name"
        )
    ]


def grants_map() -> dict[int, list[dict]]:
    """{project_id: [{user_id, email, nickname}, ...]}"""
    rows = core.query(
        "SELECT g.project_id, g.user_id, u.email, u.nickname "
        "FROM project_grants g LEFT JOIN users u ON u.id = g.user_id ORDER BY g.project_id, g.user_id"
    )
    out: dict[int, list[dict]] = {}
    for row in rows:
        out.setdefault(int(row["project_id"]), []).append(
            {"user_id": row["user_id"], "email": row["email"] or "", "nickname": row["nickname"] or ""}
        )
    return out


def visible_for(user: dict) -> list[dict]:
    """某个用户能看到哪些项目。

    管理员看全部。普通用户按两个**独立维度**判断：

      · `hidden`        —— 是否公开：未隐藏 = 所有人可见；隐藏 = 只有被单独授权的能看
      · `min_vip_level` —— 等级门槛：达到该会员等级才可见（0 = 不限）

    可见条件：`(未隐藏 且 等级达标) 或 被单独授权`。
    也就是说「单独授权」是运营后门，被授权者不受隐藏与等级限制。
    """
    rows = [
        dict(r)
        for r in core.query("SELECT * FROM projects WHERE status='enabled' ORDER BY channel, sort_order, name")
    ]
    if (user.get("role") or "user") == "admin":
        return rows

    granted = {
        int(r["project_id"])
        for r in core.query("SELECT project_id FROM project_grants WHERE user_id=?", (user.get("id"),))
    }
    level = vip.current_level(user)

    return [
        r
        for r in rows
        if int(r["id"]) in granted
        or (not r["hidden"] and level >= int(r.get("min_vip_level") or 0))
    ]


def get_by_key(project_key: str) -> dict | None:
    row = core.query_one("SELECT * FROM projects WHERE project_key=?", (project_key,))
    return dict(row) if row else None


# ---------------------------------------------------------------- 提交扣分


def charge(user_id: int, project_key: str, note: str = "") -> dict:
    """提交前扣积分。余额不足抛 InsufficientPoints，价格 0 直接放行。

    和小蚕共用一套余额：走 core.add_points()，写 points_transactions。
    **按会员等级打折**（vip.apply_discount）：高级实付 95%、至尊实付 90%。
    """
    project = get_by_key(project_key)
    if not project or project["status"] != "enabled":
        raise ProjectError(f"项目不存在或已下架：{project_key}")

    user = core.query_one("SELECT * FROM users WHERE id=?", (user_id,))
    if not user:
        raise ProjectError("用户不存在")
    balance = int(user["points_balance"] or 0)

    list_cost = int(project["points_cost"] or 0)
    cost = vip.apply_discount(list_cost, user)

    if cost <= 0:
        return {"cost": 0, "balance": balance, "project": project, "list_cost": list_cost}
    if balance < cost:
        discount_hint = f"（原价 {list_cost} 分，{vip.table(vip.current_level(user))['name']}已优惠）" if cost < list_cost else ""
        raise InsufficientPoints(
            f"积分不足：提交「{project['name']}」需要 {cost} 分{discount_hint}，当前只有 {balance} 分"
        )

    new_balance = core.add_points(
        user_id, -cost, "project_submit", note or f"提交「{project['name']}」加入托管"
    )
    return {"cost": cost, "balance": new_balance, "project": project, "list_cost": list_cost}


# ---------------------------------------------------------------- 管理写操作


def set_grants(project_id: int, user_ids: list[int]) -> int:
    """覆盖式设置某个项目的授权用户列表。"""
    core.execute("DELETE FROM project_grants WHERE project_id=?", (project_id,))
    now = core.iso()
    n = 0
    for uid in sorted({int(x) for x in user_ids}):
        if not core.query_one("SELECT 1 FROM users WHERE id=?", (uid,)):
            continue
        core.insert("project_grants", {"project_id": project_id, "user_id": uid, "created_time": now})
        n += 1
    return n


# ---------------------------------------------------------------- 自定义脚本扩展


def parse_field_config(raw) -> list[dict]:
    """标准化解析参数字段定义。
    每项结构：{
        "key": "cookie",
        "label": "Cookie / Token",
        "type": "textarea", # text | textarea | password | number | select
        "placeholder": "请输入抓包获得的完整 Cookie",
        "required": true,
        "default_value": "",
        "options": [],
        "env_mapping": "JD_COOKIE"
    }
    """
    if not raw:
        return []
    items = raw
    if isinstance(raw, str):
        try:
            items = json.loads(raw)
        except Exception:
            return []
    if isinstance(items, dict):
        # 兼容字典格式：{"account": {"label": "..."}, "cookie": {...}}
        converted = []
        for k, v in items.items():
            if isinstance(v, dict):
                converted.append({
                    "key": str(k).strip(),
                    "label": str(v.get("label") or k).strip(),
                    "type": str(v.get("type") or "text").strip(),
                    "placeholder": str(v.get("placeholder") or "").strip(),
                    "required": bool(v.get("required", True)),
                    "default_value": str(v.get("default_value") or "").strip(),
                    "options": v.get("options") or [],
                    "env_mapping": str(v.get("env_mapping") or "").strip(),
                })
        items = converted
    if not isinstance(items, list):
        return []

    clean: list[dict] = []
    seen_keys: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)
        clean.append({
            "key": key,
            "label": str(item.get("label") or key).strip(),
            "type": str(item.get("type") or "text").strip().lower(),
            "placeholder": str(item.get("placeholder") or "").strip(),
            "required": bool(item.get("required", False)),
            "default_value": str(item.get("default_value") or "").strip(),
            "options": item.get("options") if isinstance(item.get("options"), list) else [],
            "env_mapping": str(item.get("env_mapping") or "").strip(),
        })
    return clean


def create_custom_project(data: dict) -> dict:
    """管理员新增一个自定义脚本项目。"""
    name = str(data.get("name") or "").strip()
    if not name:
        raise ProjectError("脚本名称不能为空")

    ref_id = str(data.get("ref_id") or "").strip()
    if not ref_id:
        # 自动生成合法 slug
        clean_slug = re.sub(r"[^\w\-]", "_", name).strip("_").lower()
        ref_id = clean_slug[:32] or f"custom_{core.random_str(8)}"

    project_key = f"custom:{ref_id}"
    existing = core.query_one("SELECT id FROM projects WHERE project_key=?", (project_key,))
    if existing:
        project_key = f"custom:{ref_id}_{core.random_str(4)}"
        ref_id = project_key.split(":", 1)[1]

    cost = int(data.get("points_cost") or 0)
    if cost < 0:
        raise ProjectError("积分消耗不能为负")

    hidden = 1 if data.get("hidden") else 0
    sort_order = int(data.get("sort_order") or 0)
    description = str(data.get("description") or "").strip()
    submit_mode = str(data.get("submit_mode") or "custom").strip()
    field_config = parse_field_config(data.get("field_config") or [])
    target_script = str(data.get("target_script") or "").strip()
    env_name = str(data.get("env_name") or "").strip()
    env_template = str(data.get("env_template") or "").strip()
    status = "enabled" if data.get("status") != "disabled" else "disabled"

    now = core.iso()
    pid = core.insert(
        "projects",
        {
            "project_key": project_key,
            "channel": "custom",
            "name": name,
            "ref_id": ref_id,
            "points_cost": cost,
            "hidden": hidden,
            "status": status,
            "sort_order": sort_order,
            "description": description,
            "submit_mode": submit_mode,
            "field_config": json.dumps(field_config, ensure_ascii=False),
            "target_script": target_script,
            "env_name": env_name,
            "env_template": env_template,
            "created_time": now,
        },
    )
    row = core.query_one("SELECT * FROM projects WHERE id=?", (pid,))
    item = dict(row)
    item["field_config"] = parse_field_config(item.get("field_config"))
    return item


def update_custom_project(project_id: int, data: dict) -> dict:
    """管理员更新自定义脚本项目。"""
    row = core.query_one("SELECT * FROM projects WHERE id=?", (project_id,))
    if not row:
        raise ProjectError("项目不存在")
    if row["channel"] != "custom":
        raise ProjectError("非自定义脚本项目无法在此直接修改参数定义")

    patch: dict = {}
    if "name" in data:
        name = str(data["name"]).strip()
        if not name:
            raise ProjectError("脚本名称不能为空")
        patch["name"] = name[:60]
    if "points_cost" in data:
        try:
            c = int(data["points_cost"])
            if c < 0:
                raise ValueError()
            patch["points_cost"] = c
        except Exception:
            raise ProjectError("积分必须是非负整数")
    if "hidden" in data:
        patch["hidden"] = 1 if data["hidden"] else 0
    if "status" in data:
        s = str(data["status"]).strip()
        if s not in ("enabled", "disabled"):
            raise ProjectError("状态只能是 enabled 或 disabled")
        patch["status"] = s
    if "sort_order" in data:
        try:
            patch["sort_order"] = int(data["sort_order"])
        except Exception:
            raise ProjectError("排序值必须是整数")
    if "description" in data:
        patch["description"] = str(data["description"]).strip()
    if "submit_mode" in data:
        patch["submit_mode"] = str(data["submit_mode"]).strip()
    if "target_script" in data:
        patch["target_script"] = str(data["target_script"]).strip()
    if "env_name" in data:
        patch["env_name"] = str(data["env_name"]).strip()
    if "env_template" in data:
        patch["env_template"] = str(data["env_template"]).strip()
    if "field_config" in data:
        fc = parse_field_config(data["field_config"])
        patch["field_config"] = json.dumps(fc, ensure_ascii=False)

    if patch:
        sets = ", ".join(f"{k}=?" for k in patch)
        core.execute(f"UPDATE projects SET {sets} WHERE id=?", tuple(patch.values()) + (project_id,))

    updated = core.query_one("SELECT * FROM projects WHERE id=?", (project_id,))
    item = dict(updated)
    item["field_config"] = parse_field_config(item.get("field_config"))
    return item


def delete_custom_project(project_id: int) -> bool:
    """删除一个自定义脚本项目。"""
    row = core.query_one("SELECT * FROM projects WHERE id=?", (project_id,))
    if not row:
        return False
    if row["channel"] != "custom":
        raise ProjectError("仅能删除自定义脚本，小蚕/应用宝预设项目不可删除")
    core.execute("DELETE FROM project_grants WHERE project_id=?", (project_id,))
    core.execute("DELETE FROM projects WHERE id=?", (project_id,))
    return True


def validate_custom_params(field_config: list[dict], params: dict) -> tuple[dict, str]:
    """校验并清洗用户提交的参数。返回 (清洗后的参数字典, 识别出的主账号标识)。"""
    cleaned: dict = {}
    account_val = ""
    for field in field_config:
        k = field["key"]
        val = str(params.get(k) or "").strip()
        if field.get("required") and not val:
            raise ProjectError(f"缺少必填参数：{field.get('label') or k}")
        cleaned[k] = val
        if not account_val and k in ("account", "username", "phone", "user", "nickname", "id", "pin"):
            account_val = val

    if not account_val:
        # 取第一个非空字符串做账号标识
        for v in cleaned.values():
            if v and len(v) <= 64:
                account_val = v
                break
    return cleaned, account_val or "未命名账号"


def record_custom_submission(
    user_id: int,
    project: dict,
    params: dict,
    account: str,
    cost: int,
    status: str = "submitted",
    result_msg: str = "",
) -> int:
    """记录一次自定义脚本的提交，并可选择写入青龙环境变量。"""
    now = core.iso()
    sub_id = core.insert(
        "custom_submissions",
        {
            "user_id": user_id,
            "project_id": project["id"],
            "project_key": project["project_key"],
            "script_name": project["name"],
            "account": account,
            "params_data": json.dumps(params, ensure_ascii=False),
            "points_cost": cost,
            "status": status,
            "result_msg": result_msg or "提交成功",
            "created_time": now,
            "updated_time": now,
        },
    )

    # 尝试与青龙联动：如果脚本定义了 env_name，则按模板拼装账号值写入青龙
    try:
        import qinglong_client as ql
        ep = ql.endpoint()
        if ep and ep.get("status") != "disabled":
            target_env = project.get("env_name") or ""
            target_val = ""
            template = str(project.get("env_template") or "").strip()
            if template:
                # 按 {key} 占位符模板拼装，如 "{unionId}#{idenId}"
                def _fill(m: re.Match) -> str:
                    return params.get(m.group(1), "")
                target_val = re.sub(r"\{(\w+)\}", _fill, template)
                # 占位符没填上（值为空）则视为拼装失败，不下发
                if any(f"{{{k}}}" in target_val for k in params):
                    target_val = ""
            else:
                # 无模板：回退旧行为，取第一个非空参数（但跳过 account/备注类字段，
                # 避免把备注当凭据写进变量）
                for k, val in params.items():
                    if val and k != "account":
                        target_val = val
                        break
            if target_env and target_val:
                ql.ensure_seed()
                envs = ql.envs(ep)
                # 检查是否已有同名且包含该账号的环境变量
                matched = [e for e in envs if e.get("name") == target_env and account in str(e.get("remarks") or "")]
                if matched:
                    ql.save_env(ep, target_env, target_val, remarks=f"user_{user_id}_{account}", env_id=matched[0]["id"])
                else:
                    ql.save_env(ep, target_env, target_val, remarks=f"user_{user_id}_{account}")
    except Exception as e:
        # 青龙未配置或网络不通不阻塞主流程，仅记录
        print(f"[env-dispatch] 写青龙变量失败: {e!r}", flush=True)

    return sub_id


def list_custom_submissions(user_id: int | None = None, limit: int = 50) -> list[dict]:
    """查询自定义脚本提交历史。"""
    sql = (
        "SELECT s.*, u.email as user_email, u.nickname as user_nickname "
        "FROM custom_submissions s "
        "LEFT JOIN users u ON u.id = s.user_id "
    )
    args = []
    if user_id is not None:
        sql += "WHERE s.user_id = ? "
        args.append(user_id)
    sql += "ORDER BY s.id DESC LIMIT ?"
    args.append(limit)

    rows = core.query(sql, tuple(args))
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["params_data"] = json.loads(d.get("params_data") or "{}")
        except Exception:
            d["params_data"] = {}
        out.append(d)
    return out
