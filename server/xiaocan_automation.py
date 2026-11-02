"""自动化任务目录：把「账号任务开关」组织成可按分组展示的卡片。

与开源版对齐的是**呈现方式**（秒杀抢券 / 日常任务 / 资产与提醒 三组卡片、
每项显示账号启用 x/y 与时段），任务本身必须真能执行，所以这里只收录两类：

- `script`：对应青龙里的托管脚本，开关落在 `account_features`（既有机制，不另立一套）；
- `reminder`：由本模块的后台线程按天执行（凭据到期 / 卡券到期），开关落在
  `automation_flags`（提醒不是券种，混进 coupon_types 会污染任务派发）。

刻意**不收录**开源版有、我们还没有执行路径的项（元宝秒杀抢券、美团神券定时、
同店双返利监控的独立调度）—— 列出来却跑不了比不列更糟。
"""
from __future__ import annotations

import threading
import time
from datetime import timedelta

import core
import notify

GROUP_ORDER = ("member", "daily", "custom")

GROUPS: dict[str, dict] = {
    "member": {"label": "秒杀抢券", "hint": "按场次准点开抢，未到点不会空转"},
    "daily": {"label": "日常任务", "hint": "每天固定跑一次，攒元宝与保底收益"},
    "custom": {"label": "资产与提醒", "hint": "账号与资产到期前主动推送，不抢名额"},
}

# feature 名即 account_features 里的键（与 coupon_types / TASK_ORDER 一致）
TASKS: list[dict] = [
    # ---------------- 秒杀抢券 ----------------
    {
        "key": "limited_brand",
        "label": "抢限量大牌券",
        "tip": "每日 09:28 准点抢限量大牌神券，名额有限先到先得",
        "category": "member",
        "vip": "SVIP2-6 / VIP5+",
        "time_label": "09:28 固定",
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
        "feature": "免单券",
        "script": "小蚕svip6免单券.py",
    },
    {
        "key": "redpack_rain",
        "label": "整点红包雨",
        "tip": "每日多场整点放量，自动接入场次并高频抓取额度",
        "category": "member",
        "vip": "",
        "time_label": "四场 07:59 / 09:59 / 10:59 / 11:59",
        "feature": "红包雨",
        "script": "小蚕红包雨.py",
    },
    # ---------------- 日常任务 ----------------
    {
        "key": "checkin",
        "label": "每日签到",
        "tip": "天天赚元宝签到 + 会员签到抽奖，累积连续天数与成长值",
        "category": "daily",
        "vip": "",
        "time_label": "09:35 固定",
        "feature": "每日签到",
        "script": "小蚕每日签到.py",
    },
    {
        "key": "yuanbao_claim",
        "label": "领取元宝任务",
        "tip": "晚间把已完成任务的元宝一次性领掉，防过期",
        "category": "daily",
        "vip": "",
        "time_label": "22:31 固定",
        "feature": "元宝一键领取",
        "script": "小蚕元宝一键领取.py",
    },
    {
        "key": "yuanbao_lottery",
        "label": "元宝抽奖",
        "tip": "领取免费开红包机会并自动开启，带上阶梯进度",
        "category": "daily",
        "vip": "",
        "time_label": "00:03 固定",
        "feature": "元宝抽奖",
        "script": "小蚕元宝抽奖.py",
    },
    {
        "key": "double_festival",
        "label": "双节抽好礼",
        "tip": "节日活动期自动参与抽奖；非活动期会直接跳过，不空跑",
        "category": "daily",
        "vip": "",
        "time_label": "每日 00:00",
        "feature": "双节抽礼",
        "script": "小蚕双节抽好礼.py",
    },
    # ---------------- 资产与提醒 ----------------
    {
        "key": "credential_remind",
        "label": "凭据到期预警",
        "tip": "登录凭据 3 天内到期时提前推送，避免某天起来发现全部任务掉线",
        "category": "custom",
        "vip": "",
        "time_label": "每日 08:00",
        "daily_at": "08:00",
        "kind": "reminder",
    },
    {
        "key": "coupon_remind",
        "label": "卡券到期提醒",
        "tip": "每天早间核查 7 天内到期的特权券与红包，汇总推送一次",
        "category": "custom",
        "vip": "",
        "time_label": "每日 08:30",
        "daily_at": "08:30",
        "kind": "reminder",
    },
]

BY_KEY: dict[str, dict] = {task["key"]: task for task in TASKS}
FEATURE_TO_TASK: dict[str, str] = {
    task["feature"]: task["key"] for task in TASKS if task.get("feature")
}


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


def task_enabled(task: dict, account: dict, flags: dict[tuple[int, str], bool]) -> bool:
    if task.get("feature"):
        return bool((account.get("features") or {}).get(task["feature"]))
    return bool(flags.get((account["id"], task["key"])))


def set_task(account: dict, task_key: str, enabled: bool) -> dict:
    """按任务定义决定往哪张表写。返回 {enabled} 供前端确认。"""
    task = BY_KEY.get(task_key)
    if not task:
        raise ValueError("未知任务")
    if task.get("feature"):
        import xiaocan_bridge

        xiaocan_bridge.set_feature(account["id"], task["feature"], enabled)
        return {"enabled": enabled, "store": "features"}
    if task.get("kind") == "reminder":
        set_reminder(account["id"], task_key, enabled)
        return {"enabled": enabled, "store": "reminders"}
    raise ValueError("该任务暂不支持开关")


# ---------------------------------------------------------------- 聚合


def overview(accounts: list[dict]) -> dict:
    """按分组产出卡片数据：任务元数据 + 每账号开关 + 计数。

    账号少（一般 < 10）时前端可以直接把它渲染成 chips，所以这里连每账号状态一起带出去。
    """
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
                "kind": task.get("kind", "script"),
                "script": task.get("script", ""),
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


# ---------------------------------------------------------------- 每日提醒


_DAEMON_LOCK = threading.Lock()
_DAEMON_STARTED = False


def _last_run_date(task_key: str) -> str:
    return core.get_setting(f"automation_last_{task_key}", "")


def _mark_run(task_key: str, day: str) -> None:
    core.set_setting(f"automation_last_{task_key}", day)


def _enabled_accounts_for(task_key: str) -> list[dict]:
    flags = reminder_flags()
    rows = [
        dict(row) for row in core.query(
            "SELECT * FROM accounts WHERE status='enabled' AND access_token<>'' ORDER BY id"
        )
    ]
    return [row for row in rows if flags.get((row["id"], task_key))]


def credential_reminders() -> str:
    """3 天内到期的凭据汇总成一条推送（只看开启了这个提醒的账号）。"""
    horizon = core.now_dt() + timedelta(days=3)
    lines = []
    for row in _enabled_accounts_for("credential_remind"):
        expire = core.parse_iso(row.get("token_expire"))
        if not expire or expire > horizon:
            continue
        name = (row["remark"] or row["nickname"] or row["account_info"] or "").strip()
        lines.append(f"{name}（silk {row['account_info']}）将于 {row['token_expire'][:16]} 到期")
    if not lines:
        return ""
    notify.notify_async(
        f"小蚕凭据 {len(lines)} 个即将到期",
        "请尽快重新扫码绑定，否则任务会静默失败：\n" + "\n".join(lines[:20]),
    )
    return f"{len(lines)} 个凭据即将到期"


def coupon_reminders() -> str:
    """7 天内到期的卡券与红包汇总；每账号一次网关请求，串行 + 间隔。"""
    import xiaocan_console

    horizon = time.time() + 7 * 86400
    lines = []
    for account in _enabled_accounts_for("coupon_remind"):
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
        f"小蚕 {len(lines)} 项资产 7 天内到期",
        "\n".join(lines[:20]),
    )
    return f"{len(lines)} 项资产即将到期"


REMINDER_RUNNERS = {
    "credential_remind": credential_reminders,
    "coupon_remind": coupon_reminders,
}


def _due(task_key: str, daily_at: str, now) -> bool:
    """到点且今天没跑过。错过时刻（比如容器整点重启）后当天仍会补跑一次。"""
    try:
        hour, minute = (int(part) for part in daily_at.split(":"))
    except ValueError:
        return False
    if (now.hour, now.minute) < (hour, minute):
        return False
    return _last_run_date(task_key) != now.strftime("%Y-%m-%d")


def run_due_reminders() -> list[str]:
    """供守护线程与单测调用；返回本轮实际执行的任务 key。"""
    now = core.now_dt()
    done = []
    for task in TASKS:
        if task.get("kind") != "reminder":
            continue
        if not _due(task["key"], task["daily_at"], now):
            continue
        # 先标记再执行：执行失败也不该在当天反复重试打网关
        _mark_run(task["key"], now.strftime("%Y-%m-%d"))
        runner = REMINDER_RUNNERS.get(task["key"])
        if not runner:
            continue
        try:
            summary = runner()
            print(f"[automation] {task['label']}: {summary or '无到期项'}", flush=True)
        except Exception as exc:  # 提醒失败不能拖垮线程
            print(f"[automation] {task['label']} 失败：{exc}", flush=True)
        done.append(task["key"])
    return done


def start_daemon() -> None:
    global _DAEMON_STARTED
    with _DAEMON_LOCK:
        if _DAEMON_STARTED:
            return
        _DAEMON_STARTED = True

    def worker() -> None:
        while True:
            try:
                run_due_reminders()
            except Exception as exc:
                print(f"[automation] 守护线程异常：{exc}", flush=True)
            time.sleep(600)

    threading.Thread(target=worker, name="automation-reminder", daemon=True).start()
    print("[automation] 已启动资产到期提醒线程")
