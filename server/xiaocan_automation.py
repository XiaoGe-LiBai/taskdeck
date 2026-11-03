"""自动化任务目录与调度。

两块：
1. **目录**：秒杀抢券 / 日常任务 / 资产与提醒 三组，每项带描述、时段、VIP 门槛与参数定义；
2. **调度**：内置任务（`executor=builtin`）由本服务按天/按场次执行，参数真正生效；
   脚本任务（`executor=script`）只做开关，执行在青龙，参数由脚本自己决定，所以不给表单。

收录原则：只收**真能执行**的项。开源版有、我们没有执行路径的（元宝秒杀抢券、
美团神券按账号轮领、红包雨的 Join/Grab 已返回 [10001]）不列 —— 列出来跑不了比不列更糟。
"""
from __future__ import annotations

import threading
import time
from typing import Any

import core
import notify

GROUP_ORDER = ("member", "daily", "custom")

GROUPS: dict[str, dict] = {
    "member": {"label": "秒杀抢券", "hint": "按场次准点开抢，未到点不会空转"},
    "daily": {"label": "日常任务", "hint": "每天固定跑一次，攒元宝与保底收益"},
    "custom": {"label": "资产与提醒", "hint": "账号与资产到期前主动推送，不抢名额"},
}

# 参数类型：int / text / select
# param_defs 只在「真会用这些参数」的任务上出现，避免给出存了不生效的表单。
TASKS: list[dict] = [
    # ---------------- 秒杀抢券（脚本托管） ----------------
    {
        "key": "limited_brand",
        "label": "抢限量大牌券",
        "tip": "每日 09:28 准点抢限量大牌神券，名额有限先到先得",
        "category": "member",
        "vip": "SVIP2-6 / VIP5+",
        "time_label": "09:28 固定",
        "executor": "script",
        "feature": "限量大牌券-代理版",
        "script": "小蚕限量大牌券-代理版.py",
    },
    {
        "key": "fallback_brand",
        "label": "抢保底大牌券",
        "tip": "08:59 兜底通道，限量大牌没抢到时补一张保底券",
        "category": "member",
        "vip": "SVIP",
        "time_label": "08:59 固定",
        "executor": "script",
        "feature": "保底大牌券",
        "script": "小蚕保底大牌券.py",
    },
    {
        "key": "rebate",
        "label": "抢 SVIP 专属返利券",
        "tip": "SVIP 专属大额返利券，每日 08:59:05 准点秒杀",
        "category": "member",
        "vip": "SVIP2-6",
        "time_label": "08:59 固定",
        "executor": "script",
        "feature": "会员专属返利券",
        "script": "小蚕会员专属返利券.py",
    },
    {
        "key": "media_vip",
        "label": "抢每月影音 VIP",
        "tip": "影音会员周卡（网易云 / 腾讯视频等），每日 09:59 / 16:59 / 19:59 三场，自动跳过本月已领",
        "category": "member",
        "vip": "SVIP4-6 / VIP5-6",
        "time_label": "三场 09:59 / 16:59 / 19:59",
        "executor": "script",
        "feature": "影音周卡",
        "script": "小蚕影音会员周卡.py",
    },
    {
        "key": "free_order",
        "label": "抢每月免单券",
        "tip": "外卖霸王餐全额免单券，每日 13:59:10 准点秒杀，每月限 1 张",
        "category": "member",
        "vip": "SVIP5-6 / VIP6",
        "time_label": "13:59 固定",
        "executor": "script",
        "feature": "免单券",
        "script": "小蚕svip6免单券.py",
    },
    {
        "key": "redpack_rain",
        "label": "整点红包雨",
        "tip": "每日六场整点放量红包雨自动接入与高频额度抓取",
        "category": "member",
        "vip": "",
        "time_label": "六场 10:00 / 11:00 / 12:00 / 14:00 / 16:00 / 19:00",
        "executor": "builtin",
        "slots": ["09:59", "10:59", "11:59", "13:59", "15:59", "18:59"],
        "param_defs": [
            {
                "key": "click_num",
                "label": "上报抓取点击数",
                "type": "number",
                "def": 15,
                "step": 1,
                "min": 1,
                "max": 99,
                "hint": "模拟在红包雨过程中成功点击并抓取的红包数量（参考默认值 15）",
            },
            {
                "key": "jitter",
                "label": "点击随机抖动值",
                "type": "number",
                "def": 5,
                "step": 1,
                "min": 0,
                "max": 20,
                "hint": "实际提交数量将在 click_num ± jitter 之间浮动（如 10~20 次），拟真防风控",
            },
            {
                "key": "game_wait_sec",
                "label": "雨落拟真等待时长（秒）",
                "type": "number",
                "def": 28,
                "step": 1,
                "min": 10,
                "max": 45,
                "hint": "成功接入场次后模拟红包下落和交互等待的时间（实测约 28~35 秒）后再上报结算",
            },
        ],
    },
    {
        "key": "flash_sale",
        "label": "元宝秒杀抢券",
        "tip": "元宝商城限量秒杀，每日 09:00 / 14:00 / 18:00 放量；留空商品 ID 会自动挑剩余库存最多的一款",
        "category": "member",
        "vip": "",
        "time_label": "三场 09:00 / 14:00 / 18:00",
        "executor": "builtin",
        "slots": ["09:00", "14:00", "18:00"],
        "param_defs": [
            {
                "key": "goods_ids",
                "label": "秒杀商品 ID（逗号分隔）",
                "type": "text",
                "def": "",
                "hint": "指定优先秒杀的商品/券 ID，留空则自动优选在场次内剩余库存最多的一款",
            },
        ],
    },
    # ---------------- 日常任务 ----------------
    {
        "key": "checkin",
        "label": "每日签到",
        "tip": "天天赚元宝签到 + 会员签到抽奖，累积连续天数与成长值",
        "category": "daily",
        "vip": "",
        "time_label": "09:35 固定",
        "executor": "script",
        "feature": "每日签到",
        "script": "小蚕每日签到.py",
    },
    {
        "key": "daily_earn",
        "label": "领天天赚元宝",
        "tip": "把饿了么、美团、社群三个线上任务各领一次，元宝直接入账",
        "category": "daily",
        "vip": "",
        "time_label": "每日 08:05",
        "executor": "builtin",
        "daily_at": "08:05",
        "param_defs": [],
    },
    {
        "key": "vip_sign",
        "label": "会员每日签到",
        "tip": "会员打卡 + 签到抽奖（抽奖依赖当天已签到，顺序固定）",
        "category": "daily",
        "vip": "VIP2+ / SVIP",
        "time_label": "每日 08:30",
        "executor": "builtin",
        "daily_at": "08:30",
        "param_defs": [],
    },
    {
        "key": "collect_points",
        "label": "收取未收元宝",
        "tip": "把已成熟的气泡元宝与任务奖励收掉，防过期清零",
        "category": "daily",
        "vip": "",
        "time_label": "每日 23:59",
        "executor": "builtin",
        "daily_at": "23:59",
        "param_defs": [],
    },
    {
        "key": "free_lottery",
        "label": "免费开红包与抽奖",
        "tip": "领取全部免费开红包机会（签到/分享/沾一沾/平台加赠）与广告加次，再按间隔开完",
        "category": "daily",
        "vip": "",
        "time_label": "每日 07:40",
        "executor": "builtin",
        "daily_at": "07:40",
        "param_defs": [
            {
                "key": "draw_sec",
                "label": "转盘抽奖间隔秒数",
                "type": "number",
                "def": 0.35,
                "step": 0.05,
                "min": 0.1,
                "max": 5.0,
                "hint": "每次抽奖间隔时间（建议 0.2~0.5 秒），兼顾极速执行与拟真防风控",
            },
        ],
    },
    {
        "key": "yuanbao_claim",
        "label": "领取元宝任务",
        "tip": "晚间把已完成任务的元宝一次性领掉，防过期",
        "category": "daily",
        "vip": "",
        "time_label": "22:31 固定",
        "executor": "script",
        "feature": "元宝一键领取",
        "script": "小蚕元宝一键领取.py",
    },
    {
        "key": "double_festival",
        "label": "双节抽好礼",
        "tip": "节日活动期自动参与抽奖；非活动期会直接跳过，不空跑",
        "category": "daily",
        "vip": "",
        "time_label": "每日 00:00",
        "executor": "script",
        "feature": "双节抽礼",
        "script": "小蚕双节抽好礼.py",
    },
    # ---------------- 资产与提醒 ----------------
    {
        "key": "credential_remind",
        "label": "凭据 / JWT 到期预警",
        "tip": "登录凭据快到期时提前推送，避免某天起来发现全部任务掉线",
        "category": "custom",
        "vip": "",
        "time_label": "每日 08:00",
        "executor": "builtin",
        "kind": "reminder",
        "daily_at": "08:00",
        "param_defs": [
            {
                "key": "warn_days",
                "label": "提前预警天数",
                "type": "number",
                "def": 3,
                "step": 1,
                "min": 0,
                "max": 30,
                "hint": "凭据剩余有效天数小于等于此值时触发预警",
            },
            {
                "key": "jwt_check",
                "label": "核验 JWT 有效期",
                "type": "check",
                "def": True,
                "hint": "主动解码并核验小蚕 JWT 真实生命周期",
            },
        ],
    },
    {
        "key": "coupon_remind",
        "label": "卡券 / 红包到期提醒",
        "tip": "每天早间核查快过期的特权券与红包，汇总推送一次",
        "category": "custom",
        "vip": "",
        "time_label": "每日 08:30",
        "executor": "builtin",
        "kind": "reminder",
        "daily_at": "08:30",
        "param_defs": [
            {
                "key": "warn_hours",
                "label": "提前预警小时数",
                "type": "number",
                "def": 168,
                "step": 1,
                "min": 1,
                "max": 720,
                "hint": "券过期前多少小时发送到期提醒（168 = 7 天）",
            },
        ],
    },
    {
        "key": "dual_rebate",
        "label": "美团同店双返利监控",
        "tip": "按固定时段扫描附近商户，同一家店出现多个方案时推送",
        "category": "custom",
        "vip": "",
        "time_label": "09:00 起按间隔巡检",
        "executor": "builtin",
        "daily_at": "09:00",
        "param_defs": [
            {
                "key": "interval_minutes",
                "label": "固定时间段",
                "type": "select",
                "def": 60,
                "options": [
                    {"label": "30 分钟", "value": 30},
                    {"label": "1 小时", "value": 60},
                    {"label": "2 小时", "value": 120},
                ],
                "hint": "固定巡检时段：默认 1 小时，可选 30 分钟或 2 小时。频率过高易触发平台风控",
            },
            {
                "key": "active_hours_only",
                "label": "仅在营业时段巡检",
                "type": "check",
                "def": True,
                "hint": "开启后仅在营业时段运行，夜间自动休眠静默，防风控与打扰",
            },
            {
                "key": "confirm_removal",
                "label": "下架二次核验保护",
                "type": "check",
                "def": True,
                "hint": "商户缺失时连续 2 轮巡检均未检出才确认为已下架，杜绝接口偶发异常导致的误报",
            },
            {
                "key": "max_stores",
                "label": "扫描商户范围上限",
                "type": "number",
                "def": 300,
                "step": 50,
                "min": 100,
                "max": 800,
                "hint": "按距离由近及远流式扫描的美团商户数上限，建议 200 至 500 家",
            },
            {
                "key": "keyword",
                "label": "关键词优先过滤",
                "type": "text",
                "def": "",
                "hint": "指定优先扫描的品类或品牌关键词，留空则扫描全商圈",
            },
            {
                "key": "notify_on_initial",
                "label": "首轮全量基准推送",
                "type": "check",
                "def": True,
                "hint": "任务开启或跨天重置后的第一轮扫描，是否推送完整基准商户清单",
            },
        ],
    },
]

BY_KEY: dict[str, dict] = {task["key"]: task for task in TASKS}
FEATURE_TO_TASK: dict[str, str] = {
    task["feature"]: task["key"] for task in TASKS if task.get("feature")
}
REMINDER_KEYS = tuple(task["key"] for task in TASKS if task.get("kind") == "reminder")


# ---------------------------------------------------------------- 存储


def ensure_schema() -> None:
    core.execute(
        "CREATE TABLE IF NOT EXISTS automation_flags ("
        " account_id INTEGER NOT NULL,"
        " task_key TEXT NOT NULL,"
        " enabled INTEGER NOT NULL DEFAULT 0,"
        " updated_time TEXT,"
        " PRIMARY KEY (account_id, task_key))"
    )
    core.execute(
        "CREATE TABLE IF NOT EXISTS automation_params ("
        " account_id INTEGER NOT NULL,"
        " task_key TEXT NOT NULL,"
        " params TEXT NOT NULL DEFAULT '{}',"
        " updated_time TEXT,"
        " PRIMARY KEY (account_id, task_key))"
    )


def reminder_flags(account_id: int | None = None) -> dict[tuple[int, str], bool]:
    ensure_schema()
    sql = "SELECT account_id, task_key, enabled FROM automation_flags"
    args: tuple = ()
    if account_id is not None:
        sql += " WHERE account_id=?"
        args = (account_id,)
    return {(row["account_id"], row["task_key"]): bool(row["enabled"]) for row in core.query(sql, args)}


def set_reminder(account_id: int, task_key: str, enabled: bool) -> None:
    ensure_schema()
    core.execute(
        "INSERT INTO automation_flags (account_id, task_key, enabled, updated_time) VALUES (?,?,?,?) "
        "ON CONFLICT(account_id, task_key) DO UPDATE SET enabled=excluded.enabled, updated_time=excluded.updated_time",
        (account_id, task_key, 1 if enabled else 0, core.iso()),
    )


def default_params(task: dict) -> dict:
    return {item["key"]: item["def"] for item in task.get("param_defs") or []}


def task_params(account_id: int, task_key: str) -> dict:
    """参数以定义为默认值，库里存的是覆盖。"""
    import json

    task = BY_KEY.get(task_key) or {}
    merged = default_params(task)
    ensure_schema()
    row = core.query_one(
        "SELECT params FROM automation_params WHERE account_id=? AND task_key=?",
        (account_id, task_key),
    )
    if row and row["params"]:
        try:
            merged.update(json.loads(row["params"]))
        except Exception:
            pass
    return merged


def set_params(account_id: int, task_key: str, incoming: dict) -> dict:
    """按定义校验后保存；类型不对直接拒绝，避免脏值进执行器。"""
    import json

    task = BY_KEY.get(task_key)
    if not task:
        raise ValueError("未知任务")
    defs = task.get("param_defs") or []
    if not defs:
        raise ValueError("该任务没有可配置的参数")
    spec = {item["key"]: item for item in defs}
    unknown = set(incoming) - set(spec)
    if unknown:
        raise ValueError(f"不支持的参数：{', '.join(sorted(unknown))}")

    clean: dict[str, Any] = {}
    for key, item in spec.items():
        raw = incoming.get(key, item["def"])
        kind = item.get("type", "text")
        if kind in ("int", "number"):
            try:
                value = float(raw) if kind == "number" else int(raw)
            except (TypeError, ValueError):
                raise ValueError(f"{item['label']} 必须是数字") from None
            low, high = item.get("min"), item.get("max")
            if low is not None and value < low:
                raise ValueError(f"{item['label']} 不能小于 {low}")
            if high is not None and value > high:
                raise ValueError(f"{item['label']} 不能大于 {high}")
            if kind == "number" and float(value).is_integer():
                value = int(value)  # 整数就别存成 15.0
        elif kind == "check":
            value = bool(raw) if isinstance(raw, bool) else str(raw).lower() in ("1", "true", "on", "yes")
        elif kind == "select":
            allowed = [opt["value"] for opt in item.get("options") or []]
            try:
                value = type(allowed[0])(raw) if allowed else raw
            except (TypeError, ValueError):
                value = raw
            if value not in allowed:
                raise ValueError(f"{item['label']} 取值不合法")
        else:
            value = str(raw or "").strip()
        clean[key] = value

    ensure_schema()
    core.execute(
        "INSERT INTO automation_params (account_id, task_key, params, updated_time) VALUES (?,?,?,?) "
        "ON CONFLICT(account_id, task_key) DO UPDATE SET params=excluded.params, updated_time=excluded.updated_time",
        (account_id, task_key, json.dumps(clean, ensure_ascii=False), core.iso()),
    )
    return clean


def task_enabled(task: dict, account: dict, flags: dict[tuple[int, str], bool]) -> bool:
    if task.get("feature"):
        return bool((account.get("features") or {}).get(task["feature"]))
    if task.get("executor") == "builtin":
        return bool(flags.get((account["id"], task["key"])))
    return False


def set_task(account: dict, task_key: str, enabled: bool) -> dict:
    """按任务定义决定往哪张表写。返回 {enabled} 供前端确认。"""
    task = BY_KEY.get(task_key)
    if not task:
        raise ValueError("未知任务")
    if task.get("feature"):
        import xiaocan_bridge

        xiaocan_bridge.set_feature(account["id"], task["feature"], enabled)
        return {"enabled": enabled, "store": "features"}
    if task.get("executor") == "builtin":
        set_reminder(account["id"], task_key, enabled)
        return {"enabled": enabled, "store": "builtin"}
    raise ValueError("该任务暂不支持开关")


# ---------------------------------------------------------------- 聚合


def overview(accounts: list[dict]) -> dict:
    flags = reminder_flags()
    accounts_payload = [
        {
            "id": account["id"],
            "nickname": (account.get("nickname") or "").strip(),
            "account_info": account.get("account_info") or "",
        }
        for account in accounts
    ]

    groups = []
    for group_key in GROUP_ORDER:
        items = []
        for task in TASKS:
            if task["category"] != group_key:
                continue
            enabled_ids = [
                account["id"] for account in accounts
                if task_enabled(task, account, flags)
            ]
            items.append({
                "key": task["key"],
                "label": task["label"],
                "tip": task["tip"],
                "vip": task.get("vip", ""),
                "time_label": task["time_label"],
                "executor": task["executor"],
                "script": task.get("script", ""),
                "param_defs": task.get("param_defs") or [],
                "enabled_account_ids": enabled_ids,
                "enabled_count": len(enabled_ids),
                "account_count": len(accounts),
            })
        groups.append({
            "key": group_key,
            "label": GROUPS[group_key]["label"],
            "hint": GROUPS[group_key]["hint"],
            "tasks": items,
        })

    return {"groups": groups, "accounts": accounts_payload}


# ---------------------------------------------------------------- 调度


_DAEMON_LOCK = threading.Lock()
_DAEMON_STARTED = False
SLOT_WINDOW_MINUTES = 10  # 命中窗口：容器抖动时仍能补跑，但不会把整天的场次全补一遍


def _enabled_accounts() -> list[dict]:
    return [
        dict(row) for row in core.query(
            "SELECT * FROM accounts WHERE status='enabled' AND admin_paused=0 AND access_token<>'' ORDER BY id"
        )
    ]


def _slots_of(task: dict, params: dict) -> list[str]:
    """任务当天的执行时刻。同店双返利按参数的巡检间隔铺满 09:00-23:00。"""
    if task["key"] == "dual_rebate":
        step = max(30, int(params.get("interval_minutes") or 60))
        start, end = (9 * 60, 23 * 60 + 1) if params.get("active_hours_only", True) else (0, 24 * 60)
        slots, cursor = [], start
        while cursor < end:
            slots.append(f"{cursor // 60:02d}:{cursor % 60:02d}")
            cursor += step
        return slots
    if task.get("slots"):
        return list(task["slots"])
    if task.get("daily_at"):
        return [task["daily_at"]]
    return []


def _due_slot(task_key: str, account_id: int, slot: str, now) -> bool:
    """当前时刻落在 [slot, slot+窗口) 且这一场没跑过。"""
    try:
        hour, minute = (int(part) for part in slot.split(":"))
    except ValueError:
        return False
    start = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    delta = (now - start).total_seconds()
    if delta < 0 or delta >= SLOT_WINDOW_MINUTES * 60:
        return False
    key = f"automation_last_{task_key}_{account_id}"
    return core.get_setting(key, "") != f"{now.strftime('%Y-%m-%d')} {slot}"


def _mark_slot(task_key: str, account_id: int, slot: str, now) -> None:
    core.set_setting(f"automation_last_{task_key}_{account_id}", f"{now.strftime('%Y-%m-%d')} {slot}")


def run_due_builtin(now=None) -> list[str]:
    """执行到点的内置任务；返回执行记录（供日志与单测）。"""
    import xiaocan_builtin
    import xiaocan_stats

    now = now or core.now_dt()
    flags = reminder_flags()
    accounts = _enabled_accounts()
    executed: list[str] = []

    for task in TASKS:
        if task["executor"] != "builtin" or task.get("kind") == "reminder":
            continue
        for account in accounts:
            if not task_enabled(task, account, flags):
                continue
            params = task_params(account["id"], task["key"])
            for slot in _slots_of(task, params):
                if not _due_slot(task["key"], account["id"], slot, now):
                    continue
                # 先占位再执行：失败也不在窗口内反复重试打网关
                _mark_slot(task["key"], account["id"], slot, now)
                try:
                    summary = xiaocan_builtin.run(account, task["key"], params)
                    xiaocan_stats.record_job(account["id"], task["key"], "success", summary[:200])
                    print(f"[automation] {task['label']} @{slot} 账号{account['id']}：{summary}", flush=True)
                except Exception as exc:
                    xiaocan_stats.record_job(account["id"], task["key"], "failed", str(exc)[:200])
                    print(f"[automation] {task['label']} @{slot} 账号{account['id']} 失败：{exc}", flush=True)
                executed.append(f"{task['key']}@{slot}#{account['id']}")
    return executed


# ---------------------------------------------------------------- 每日提醒


def _last_run_date(task_key: str) -> str:
    return core.get_setting(f"automation_last_{task_key}", "")


def _mark_run(task_key: str, day: str) -> None:
    core.set_setting(f"automation_last_{task_key}", day)


def _enabled_accounts_for(task_key: str) -> list[dict]:
    flags = reminder_flags()
    return [row for row in _enabled_accounts() if flags.get((row["id"], task_key))]


def credential_reminders() -> str:
    """凭据到期预警：按各账号自己的「提前天数」判断。"""
    from datetime import timedelta

    lines = []
    for row in _enabled_accounts_for("credential_remind"):
        days = int(task_params(row["id"], "credential_remind").get("warn_days") or 3)
        expire = core.parse_iso(row.get("token_expire"))
        if not expire or expire > core.now_dt() + timedelta(days=days):
            continue
        name = (row.get("remark") or row.get("nickname") or row["account_info"] or "").strip()
        lines.append(f"{name}（silk {row['account_info']}）将于 {row['token_expire'][:16]} 到期")
    if not lines:
        return ""
    notify.notify_async(
        f"小蚕凭据 {len(lines)} 个即将到期",
        "请尽快重新扫码绑定，否则任务会静默失败：\n" + "\n".join(lines[:20]),
    )
    return f"{len(lines)} 个凭据即将到期"


def coupon_reminders() -> str:
    """卡券/红包到期提醒：每账号一次网关请求，串行 + 间隔。"""
    import xiaocan_console

    lines = []
    for account in _enabled_accounts_for("coupon_remind"):
        hours = int(task_params(account["id"], "coupon_remind").get("warn_hours") or 168)
        horizon = time.time() + hours * 3600
        try:
            result = xiaocan_console.overview(account, ("cards", "redpacks"))
        except Exception:
            continue
        cards = (result.get("data") or {}).get("cards") or {}
        for card in cards.get("items") or []:
            expire = int(card.get("expire_time") or 0)
            if expire and expire <= horizon:
                lines.append(f"{account.get('nickname') or account['account_info']}：{card['name']} 到期")
        redpacks = (result.get("data") or {}).get("redpacks") or {}
        for redpack in redpacks.get("items") or []:
            expire = int(redpack.get("end_time") or 0)
            if expire and expire <= horizon:
                lines.append(f"{account.get('nickname') or account['account_info']}：红包 {redpack['name']} 到期")
        time.sleep(1.5)  # 别把网关打急
    if not lines:
        return ""
    notify.notify_async(
        f"小蚕 {len(lines)} 项资产即将到期",
        "\n".join(lines[:20]),
    )
    return f"{len(lines)} 项资产即将到期"


REMINDER_RUNNERS = {
    "credential_remind": credential_reminders,
    "coupon_remind": coupon_reminders,
}


def _due(task_key: str, daily_at: str, now) -> bool:
    """提醒类：到点且今天没跑过；错过时刻当天会补跑一次。"""
    try:
        hour, minute = (int(part) for part in daily_at.split(":"))
    except ValueError:
        return False
    if (now.hour, now.minute) < (hour, minute):
        return False
    return _last_run_date(task_key) != now.strftime("%Y-%m-%d")


def run_due_reminders(now=None) -> list[str]:
    now = now or core.now_dt()
    done = []
    for task in TASKS:
        if task.get("kind") != "reminder":
            continue
        if not _due(task["key"], task["daily_at"], now):
            continue
        _mark_run(task["key"], now.strftime("%Y-%m-%d"))
        runner = REMINDER_RUNNERS.get(task["key"])
        if not runner:
            continue
        try:
            summary = runner()
            print(f"[automation] {task['label']}: {summary or '无到期项'}", flush=True)
        except Exception as exc:
            print(f"[automation] {task['label']} 失败：{exc}", flush=True)
        done.append(task["key"])
    return done


def tick(now=None) -> list[str]:
    """守护线程每轮做的事：跑到点的内置任务 + 当日提醒。"""
    return run_due_builtin(now) + run_due_reminders(now)


def start_daemon() -> None:
    global _DAEMON_STARTED
    with _DAEMON_LOCK:
        if _DAEMON_STARTED:
            return
        _DAEMON_STARTED = True

    def worker() -> None:
        while True:
            try:
                tick()
            except Exception as exc:
                print(f"[automation] 守护线程异常：{exc}", flush=True)
            time.sleep(60)

    threading.Thread(target=worker, name="automation", daemon=True).start()
    print("[automation] 已启动自动化任务调度线程")
