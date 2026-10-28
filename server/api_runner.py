"""/api/runner/*：青龙 runner 脚本与本站之间的内部通道（X-Runner-Key 鉴权）。

青龙那边的 runner 只需要三件事：
1. GET  /api/runner/accounts?task=<key>     拉「这个任务要跑哪些账号」（备注#UserId#silk_id#token）
2. POST /api/runner/report                  回传执行结果（报名结果 / 未中记录 / 账号信息 / 奖品列表）
3. GET  /api/runner/ping                    健康检查
密钥在 config.json 的 runner_key，用请求头 X-Runner-Key 带上。
"""
from __future__ import annotations

from functools import wraps

from flask import Blueprint, g, jsonify, request

import core
import runner_dispatch
import xiaocan_bridge as xc

bp = Blueprint("runner", __name__)


def require_runner(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        key = request.headers.get("X-Runner-Key", "") or request.args.get("key", "")
        if not key or key != core.CONFIG.get("runner_key"):
            return jsonify({"code": 401, "data": {}, "msg": "runner key 无效"}), 200
        g.runner = True
        return fn(*args, **kwargs)

    return wrapper


@bp.get("/ping")
@require_runner
def ping():
    return core.ok({"ok": True, "time": core.iso()})


@bp.get("/accounts")
@require_runner
def accounts():
    task = (request.args.get("task") or "").strip()
    if not task:
        return core.fail("缺少 task 参数")
    return core.ok(runner_dispatch.runner_account_lines(task))


@bp.post("/report")
@require_runner
def report():
    body = request.get_json(silent=True) or {}
    kind = (body.get("type") or "").strip()
    xc.log_runner(f"[report:{kind}] {str(body)[:800]}")

    if kind == "signup_result":
        record_id = body.get("record_id")
        if not record_id:
            return core.fail("缺少 record_id")
        core.execute(
            "UPDATE signup_records SET status=?, output=?, error=?, finished_time=? WHERE id=?",
            (
                body.get("status") or "success",
                core.truncate_log_text(body.get("output") or "", max_length=8000),
                body.get("error") or "",
                core.iso(),
                record_id,
            ),
        )
        return core.ok({})

    if kind == "prizes":
        account_id = body.get("account_id")
        if not account_id:
            return core.fail("缺少 account_id")
        core.execute("DELETE FROM redeem_prizes WHERE account_id=?", (account_id,))
        now = core.iso()
        for item in body.get("prizes") or []:
            core.insert(
                "redeem_prizes",
                {
                    "account_id": account_id,
                    "exchange_id": item.get("exchange_id"),
                    "name": item.get("name") or "",
                    "yuanbao_cost": item.get("yuanbao_cost"),
                    "group_name": item.get("group") or item.get("group_name") or "",
                    "start_at": item.get("start_at"),
                    "end_at": item.get("end_at"),
                    "available": 1 if item.get("available") else 0,
                    "upcoming": 1 if item.get("upcoming") else 0,
                    "updated_time": now,
                },
            )
        core.execute("UPDATE redeem_settings SET runner_ready=1 WHERE account_id=?", (account_id,))
        return core.ok({"count": len(body.get("prizes") or [])})

    if kind == "failure":
        account_id = body.get("account_id")
        account = core.query_one("SELECT * FROM accounts WHERE id=?", (account_id,)) if account_id else None
        panel_name = ""
        if account and account["default_panel_id"]:
            panel = core.query_one("SELECT name, remark FROM ql_panels WHERE id=?", (account["default_panel_id"],))
            panel_name = (panel["remark"] or panel["name"]) if panel else ""
        core.insert(
            "brand_coupon_failures",
            {
                "run_date": body.get("run_date") or core.today_str(),
                "account_id": account_id,
                "account_info": (account["account_info"] if account else body.get("account_info") or ""),
                "nickname": (account["nickname"] if account else body.get("nickname") or ""),
                "vip_level": int((account["vip_level"] if account else body.get("vip_level")) or 0),
                "panel_name": panel_name,
                "reason": body.get("reason") or "库存耗尽",
                "created_time": core.iso(),
            },
        )
        return core.ok({})

    if kind == "account":
        account_id = body.get("account_id")
        if not account_id:
            return core.fail("缺少 account_id")
        data = {"updated_time": core.iso()}
        for src, dst in (
            ("nickname", "nickname"),
            ("vip_level", "vip_level"),
            ("avatar", "avatar"),
            ("is_plus", "is_plus"),
            ("account_info", "account_info"),
            ("token", "access_token"),
            ("membership_expire", "membership_expire"),
        ):
            if body.get(src) is not None:
                data[dst] = body[src]
        if body.get("token"):
            expire = xc.token_expire_of(body["token"])
            if expire:
                data["token_expire"] = expire
        core.update("accounts", int(account_id), data)
        return core.ok({})

    if kind == "task_result":
        return core.ok({})

    return core.fail(f"未知的 report 类型：{kind}")
