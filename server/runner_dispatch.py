"""把本站的任务派发到青龙面板，并回收结果。

设计（对应原站行为）：
1. 报名 / 抢兑这类「立刻执行」的任务，找一台在线面板触发对应 cron（小蚕大牌券报名 / 小蚕抢兑-控制台）。
2. 青龙上的 runner 脚本反过来调本站 /api/runner/accounts 拉「哪些账号开了哪些任务」，
   跑完再 POST /api/runner/report 回传日志、奖品、未中记录。
3. 面板没接或 cron 不存在时，记录落库为 pending，前端提示，不阻塞用户操作。
"""
from __future__ import annotations

import time

import core
import ql_client
import xiaocan_bridge
import xiaocan_tasks


def panel_by_id(panel_id) -> dict | None:
    if not panel_id:
        return None
    row = core.query_one("SELECT * FROM ql_panels WHERE id=?", (panel_id,))
    return dict(row) if row else None


def _trigger(key: str, panel: dict | None, prefer_online: bool = True) -> dict:
    panels = [panel] if panel else [dict(r) for r in core.query("SELECT * FROM ql_panels ORDER BY id")]
    if prefer_online:
        panels.sort(key=lambda p: 0 if p.get("status") == "online" else 1)
    for candidate in panels:
        if not candidate:
            continue
        try:
            for cron in ql_client.crons(candidate):
                if xiaocan_tasks.key_of_command(cron.get("command")) == key:
                    ql_client.run_cron(candidate, cron["id"])
                    return {"ok": True, "panel_id": candidate["id"], "cron_id": cron["id"], "status": "running"}
        except Exception as exc:
            xiaocan_bridge.log_runner(f"[dispatch] panel={candidate.get('id')} key={key} err={exc}")
            continue
    return {"ok": False, "error": f"「{xiaocan_tasks.task_name(key)}」任务暂不可用，请稍后重试或联系管理员"}


def dispatch_signup(record_id: int, account: dict) -> dict:
    result = _trigger("signup", panel_by_id(account.get("default_panel_id")))
    if result.get("ok"):
        xiaocan_bridge.log_runner(f"[signup] record={record_id} account={account['id']} panel={result['panel_id']}")
        return {"ok": True, "panel_id": result["panel_id"], "status": "running"}
    return result


def dispatch_redeem(account: dict) -> dict:
    result = _trigger("redeem", panel_by_id(account.get("brand_panel_id") or account.get("default_panel_id")), prefer_online=False)
    return result


def runner_account_lines(task_key: str) -> dict:
    """runner 拉取账号数据：返回 备注#UserId#silk_id#token 行 + 开关状态。"""
    feature = {v: k for k, v in xiaocan_tasks.FEATURE_TO_KEY.items()}.get(task_key)
    rows = core.query("SELECT * FROM accounts ORDER BY id")
    lines, accounts = [], []
    now = core.now_dt()
    for row in rows:
        account = dict(row)
        if account["status"] != "enabled" or account["admin_paused"]:
            continue
        if account["token_expire"]:
            expire = core.parse_iso(account["token_expire"])
            if expire and expire < now:
                continue
        if feature and task_key != "signup":
            on = core.query_one(
                "SELECT enabled FROM account_features WHERE account_id=? AND feature_name=?",
                (account["id"], feature),
            )
            if not on or not on["enabled"]:
                continue
        if not account["access_token"]:
            continue
        lines.append(
            f"{account['remark'] or account['nickname']}#{account['xc_user_id']}#{account['account_info']}#{account['access_token']}"
        )
        accounts.append(
            {
                "id": account["id"],
                "account_info": account["account_info"],
                "xc_user_id": account["xc_user_id"],
                "nickname": account["nickname"],
                "vip_level": account["vip_level"],
                "panel_id": account["default_panel_id"],
                "membership_expire": account["membership_expire"],
            }
        )
    return {"task": task_key, "data": "@".join(lines), "count": len(accounts), "accounts": accounts}


def reap_zombie_tasks(timeout_minutes: int = 15) -> dict:
    """自动扫描并收割超时的悬挂/僵尸任务，将其流转为终止失败状态，防止前端永远卡在运行中。"""
    now = core.iso()
    reaped_signups = 0
    reaped_custom = 0

    from datetime import timedelta
    signup_cutoff = core.iso(core.now_dt() - timedelta(minutes=timeout_minutes))
    custom_cutoff = core.iso(core.now_dt() - timedelta(minutes=30))

    # 1. 收割超过 timeout_minutes 分钟仍处于 pending 或 running 的 signup_records
    stale_signups = core.query(
        "SELECT id, account_id, status, created_time FROM signup_records "
        "WHERE status IN ('pending', 'running') AND created_time < ?",
        (signup_cutoff,),
    )
    for r in stale_signups:
        core.execute(
            "UPDATE signup_records SET status='failed', error=?, finished_time=? WHERE id=?",
            (f"任务执行超时（超过 {timeout_minutes} 分钟未收到青龙执行回调，已自动收割标记结束）", now, r["id"]),
        )
        reaped_signups += 1

    # 2. 收割超过 30 分钟仍处于 submitted 且未同步的 custom_submissions
    stale_subs = core.query(
        "SELECT id, status, created_time FROM custom_submissions "
        "WHERE status = 'running' AND created_time < ?",
        (custom_cutoff,),
    )
    for r in stale_subs:
        core.execute(
            "UPDATE custom_submissions SET status='failed', result_msg=?, updated_time=? WHERE id=?",
            ("执行超时：超过 30 分钟未上报结果", now, r["id"]),
        )
        reaped_custom += 1

    if reaped_signups or reaped_custom:
        xiaocan_bridge.log_runner(
            f"[zombie_reaper] 收割完成：{reaped_signups} 条报名任务，{reaped_custom} 条自定义任务"
        )

    return {"reaped_signups": reaped_signups, "reaped_custom": reaped_custom}

