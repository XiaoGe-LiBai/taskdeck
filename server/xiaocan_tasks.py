"""小蚕任务目录 + 任务日志聚合。

任务目录对齐原站：青龙里的命令形如
    task xiaocan_console_runner.py <key> <脚本名>
本模块负责：识别哪些 cron 属于本站托管、按日期聚合四台面板的执行日志。
"""
from __future__ import annotations

import re
import time
from datetime import timedelta

import core
import ql_client

# key -> (展示名, 脚本文件, 默认定时)
CATALOG: dict[str, dict] = {
    "limited_brand": {"name": "限量大牌", "script": "小蚕限量大牌券-代理版.py", "schedule": "10 28 9 * * *"},
    "fallback_brand": {"name": "保底大牌", "script": "小蚕保底大牌券.py", "schedule": "45 59 8 * * *"},
    "rebate": {"name": "返利券", "script": "小蚕会员专属返利券.py", "schedule": "05 59 8 * * *"},
    "checkin": {"name": "每日签到", "script": "小蚕每日签到.py", "schedule": "03 35 9 * * *"},
    "yuanbao_claim": {"name": "元宝领取", "script": "小蚕元宝一键领取.py", "schedule": "00 31 22 * * *"},
    "yuanbao": {"name": "元宝抽奖", "script": "小蚕元宝抽奖.py", "schedule": "14 3 0 * * *"},
    "week": {"name": "影音周卡", "script": "小蚕影音会员周卡.py", "schedule": "10 59 9,16,19 * * *"},
    "rain": {"name": "红包雨", "script": "小蚕红包雨.py", "schedule": "40 59 7,9,10,11 * * *"},
    "free": {"name": "免单券", "script": "小蚕svip6免单券.py", "schedule": "10 59 13 * * *"},
    "double_festival": {"name": "双节抽礼", "script": "小蚕双节抽好礼.py", "schedule": "0 0 0 * * *"},
    "signup": {"name": "大牌券报名", "script": "小蚕大牌券报名.py", "schedule": ""},
}

# 任务开关名 -> key（账号 features 里的中文名）
FEATURE_TO_KEY = {
    "限量大牌券-代理版": "limited_brand",
    "保底大牌券": "fallback_brand",
    "会员专属返利券": "rebate",
    "每日签到": "checkin",
    "元宝一键领取": "yuanbao_claim",
    "元宝抽奖": "yuanbao",
    "影音周卡": "week",
    "红包雨": "rain",
    "免单券": "free",
    "双节抽礼": "double_festival",
}

LOG_FILE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})")


def command_of(key: str) -> str:
    meta = CATALOG.get(key) or {}
    return f"task xiaocan_console_runner.py {key} {meta.get('script', '')}".strip()


def key_of_command(command: str | None) -> str | None:
    command = command or ""
    if "xiaocan_console_runner.py" in command:
        match = re.search(r"xiaocan_console_runner\.py\s+(\w+)", command)
        if match:
            return match.group(1)
        return "console"
    if "xiaocan_redeem_runner.py" in command:
        return "redeem"
    return None


def managed_task(task: dict) -> bool:
    return key_of_command(task.get("command")) is not None


def task_name(key: str) -> str:
    return (CATALOG.get(key) or {}).get("name", key)


# ------------------------------------------------------------ 面板总览


def panel_overview() -> list[dict]:
    panels = [dict(r) for r in core.query("SELECT * FROM ql_panels ORDER BY id")]
    out = []
    for panel in panels:
        entry = {"id": panel["id"], "name": panel["remark"] or panel["name"], "status": panel["status"], "tasks": []}
        try:
            tasks = ql_client.crons(panel)
            for task in tasks:
                key = key_of_command(task.get("command"))
                if key is None:
                    continue
                entry["tasks"].append(
                    {
                        "id": task["id"],
                        "name": task["name"],
                        "command": task["command"],
                        "schedule": task["schedule"],
                        "isDisabled": task["isDisabled"],
                        "managed": key in CATALOG,
                        "key": key,
                    }
                )
            entry["tasks"].sort(key=lambda t: t["name"])
        except Exception as exc:
            entry["error"] = str(exc)
        out.append(entry)
    return out


def find_cron_for_key(panels: list[dict], key: str) -> list[tuple[dict, dict]]:
    """在所有面板里找 <key> 对应的 cron，返回 [(panel, cron)]。"""
    found = []
    for panel in panels:
        try:
            for cron in ql_client.crons(panel):
                if key_of_command(cron.get("command")) == key:
                    found.append((panel, cron))
        except Exception:
            continue
    return found


# ------------------------------------------------------------ 任务日志


def _log_dirs(panel: dict) -> list[dict]:
    items = ql_client.logs(panel, path="")
    dirs = []
    for item in items:
        name = item.get("title") or item.get("name") or ""
        path = item.get("path") or item.get("key") or ""
        if item.get("type") == "directory" or not item.get("type"):
            if "小蚕" in name or "xiaocan" in name.lower():
                dirs.append({"name": name, "path": path or name})
    return dirs


def _log_files(panel: dict, directory: str) -> list[dict]:
    items = ql_client.logs(panel, path=directory)
    files = []
    for item in items:
        title = item.get("title") or item.get("name") or ""
        match = LOG_FILE_RE.match(title)
        if not match:
            continue
        files.append(
            {
                "file": f"{directory}/{title}",
                "title": title,
                "date": f"{match.group(1)}-{match.group(2)}-{match.group(3)}",
                "time": f"{match.group(1)}-{match.group(2)}-{match.group(3)} "
                        f"{match.group(4)}:{match.group(5)}:{match.group(6)}",
            }
        )
    return files


def detect_state(output: str) -> str:
    text = output or ""
    if "## 完成" in text or "执行完成" in text or "完成 ✅" in text:
        return "success"
    if "Traceback" in text or "失败" in text or "错误" in text or "异常" in text:
        return "error"
    return "unknown"


def aggregate_events(day: str, task_key: str = "", max_files: int = 60, use_cache: bool = True) -> dict:
    """按日期聚合多个面板的任务日志。day 形如 2026-09-27。"""
    panels = [dict(r) for r in core.query("SELECT * FROM ql_panels ORDER BY id")]
    if task_key and task_key not in CATALOG:
        task_key = ""

    tasks_meta = [{"key": key, "name": meta["name"]} for key, meta in CATALOG.items()]

    cached_rows = core.query(
        "SELECT * FROM task_logs_cache WHERE log_date=? ORDER BY log_time", (day,)
    )
    fresh = use_cache and cached_rows and any(
        abs(time.time() - (core.parse_iso(r["fetched_time"]).timestamp() if core.parse_iso(r["fetched_time"]) else 0)) < 120
        for r in cached_rows
    )
    if fresh:
        rows = [dict(r) for r in cached_rows]
    else:
        try:
            core.execute("DELETE FROM task_logs_cache WHERE log_date < date('now', '-3 days')")
        except Exception:
            pass
        rows = _fetch_logs(panels, day, task_key, max_files)
        core.execute("DELETE FROM task_logs_cache WHERE log_date=?", (day,))
        for row in rows:
            core.insert("task_logs_cache", row)

    if task_key:
        rows = [r for r in rows if r["task_key"] == task_key]

    # 按 (任务, 分钟) 归并成一次执行事件
    buckets: dict[tuple, dict] = {}
    for row in rows:
        bucket_key = (row["task_key"], row["log_time"][:16])
        event = buckets.setdefault(
            bucket_key,
            {
                "task_key": row["task_key"],
                "task_name": task_name(row["task_key"]),
                "time": row["log_time"],
                "state": "success",
                "entries": [],
                "panel_count": 0,
            },
        )
        event["entries"].append(
            {
                "panel_id": row["panel_id"],
                "panel_name": _panel_label(row["panel_id"]),
                "time": row["log_time"],
                "file": row["file"],
                "output": row["output"],
                "state": row["state"],
                "task_key": row["task_key"],
                "task_name": task_name(row["task_key"]),
            }
        )
        if row["state"] == "error":
            event["state"] = "error"
        elif row["state"] == "unknown" and event["state"] == "success":
            event["state"] = "unknown"
        event["panel_count"] = len({e["panel_id"] for e in event["entries"]})

    events = sorted(buckets.values(), key=lambda e: e["time"])
    events.reverse()
    return {"date": day, "tasks": tasks_meta, "events": events}


def _panel_label(panel_id: int) -> str:
    row = core.query_one("SELECT name, remark FROM ql_panels WHERE id=?", (panel_id,))
    if not row:
        return f"面板{panel_id}"
    return row["remark"] or row["name"]


def _fetch_logs(panels: list[dict], day: str, task_key: str, max_files: int) -> list[dict]:
    rows: list[dict] = []
    budget = max_files
    for panel in panels:
        try:
            directories = _log_dirs(panel)
        except Exception:
            continue
        for directory in directories:
            key_guess = _dir_key(directory["name"])
            if task_key and key_guess and key_guess != task_key:
                continue
            try:
                files = [f for f in _log_files(panel, directory["path"]) if f["date"] == day]
            except Exception:
                continue
            files.sort(key=lambda f: f["time"])
            for item in files[-8:]:  # 单目录最多取最近 8 次
                if budget <= 0:
                    return rows
                budget -= 1
                try:
                    content = ql_client.log_content(panel, item["file"])
                except Exception as exc:
                    content = f"[读取日志失败] {exc}"
                rows.append(
                    {
                        "panel_id": panel["id"],
                        "log_date": day,
                        "task_key": _dir_key(directory["name"]) or "unknown",
                        "file": item["file"],
                        "log_time": item["time"],
                        "state": detect_state(content),
                        "output": core.truncate_log_text(content, max_length=8000),
                        "fetched_time": core.iso(),
                    }
                )
    return rows


def _dir_key(dir_name: str) -> str | None:
    name = dir_name or ""
    for key, meta in CATALOG.items():
        script_stem = meta["script"].rsplit(".", 1)[0]
        if name.startswith(script_stem) or script_stem in name:
            return key
    for key, meta in CATALOG.items():
        if name.startswith("小蚕" + meta["name"].replace("大牌", "")):
            return key
    return None


def recent_failures(days: int = 7) -> list[dict]:
    since = (core.now_dt() - timedelta(days=days)).strftime("%Y-%m-%d")
    rows = core.query(
        "SELECT * FROM brand_coupon_failures WHERE run_date>=? ORDER BY run_date DESC, id DESC LIMIT 200",
        (since,),
    )
    return [
        {
            "run_date": r["run_date"],
            "account_info": r["account_info"],
            "nickname": r["nickname"],
            "vip_level": r["vip_level"],
            "panel_name": r["panel_name"],
            "reason": r["reason"],
        }
        for r in rows
    ]
