"""「脚本 × 账号」绑定矩阵。

背景：账号类脚本的账号来源是**脚本自己的专属变量**（`hrt_wxid` / `bjy_wxid` /
`soy_wxid_data` / …），不是适配器的统一入口。所以「哪些账号参加哪些脚本」
天然就是一张 N×M 矩阵，只是以前的载体是青龙环境变量里的一大堆值。

本模块把这张矩阵从青龙读出来、存进面板、再由面板写回去。值的真实落点有两个
（都在青龙侧，由 YYB_SERVER 之外的机制承载）：

    env_name        = "1,2"                                   ← 青龙环境变量
    cron.task_before = "export hrt_wxid='1,2'; ..."           ← 任务前后缀

`source` 字段标明这行当前读到的是哪一种；面板保存矩阵后再按选定路线下发。
"""
from __future__ import annotations

import json
import os
import re

import core
import qinglong_client as ql

PANEL_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_ROOT = os.path.dirname(os.path.dirname(PANEL_DIR))

# 青龙仓库目录名 -> 本地仓库目录名
DEFAULT_REPO_MAP = {
    "XiaoGe-LiBai_yangmao_main": "yangmao-main",
    "lcmovie_YYB-GO-Script-i": "小蚕网站/repos/yyb-go-script-i",
    "lcmovie_YYB-GO-Script-i_main": "小蚕网站/repos/yyb-go-script-i",
    "yyb-go-script-i": "小蚕网站/repos/yyb-go-script-i",
}

# 账号 ref 的分隔符：你的脚本约定是「换行、& 或 @」
REF_SPLIT = re.compile(r"[\s,&@]+")

_ENV_NAME_PATTERNS = (
    r"""WXID_ENV\s*=\s*["']([A-Za-z_][A-Za-z0-9_]*)["']""",
    r"""变量[:：]\s*([A-Za-z_][A-Za-z0-9_]*)\s*[（(]微信""",
    r"""os\.getenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*_wxid)["']""",
    r"""getenv\(\s*["']([A-Za-z_][A-Za-z0-9_]*_wxid)["']""",
)

_APPID_PATTERNS = (
    r"""APP_ID\s*=\s*["'](wx[0-9a-zA-Z]+)["']""",
    r"""wx_appid\s*=\s*["'](wx[0-9a-zA-Z]+)["']""",
    r"""APPID\s*=\s*["'](wx[0-9a-zA-Z]+)["']""",
    r"""appid\s*=\s*["'](wx[0-9a-zA-Z]+)["']""",
    r"""appId\s*=\s*["'](wx[0-9a-zA-Z]+)["']""",
    r"""(wx[0-9a-zA-Z]{16})""",
)

# task_before 里的 export 形式：export name='v' / export name="v" / export name=v
_EXPORT_RE = re.compile(
    r"""export\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s;]+))"""
)


# ---------------------------------------------------------------- 本地脚本


def repo_map() -> dict:
    conf = core.CONFIG.get("script_repo_map") or {}
    merged = dict(DEFAULT_REPO_MAP)
    merged.update({str(k): str(v) for k, v in conf.items()})
    return merged


def _safe_join(base: str, rest: str) -> str | None:
    """拼接并校验路径必须落在 base 之内（防 script_key 里的 ../ 穿越）。"""
    base_real = os.path.realpath(base)
    candidate = os.path.realpath(os.path.join(base_real, rest))
    if candidate != base_real and candidate.startswith(base_real + os.sep):
        return candidate
    return None


def local_path(script_key: str) -> str | None:
    """把青龙里的 script_key 映射成本地脚本路径。

    XiaoGe-LiBai_yangmao_main/miniapp/code/code版_x.py
        -> <工作区>/yangmao-main/miniapp/code/code版_x.py
    lcmovie_YYB-GO-Script-i/wx-script/chzhjj.py
        -> <工作区>/小蚕网站/repos/yyb-go-script-i/wx-script/chzhjj.py
    """
    parts = str(script_key or "").strip().split("/")
    if len(parts) < 2:
        return None
    repo, rest = parts[0], "/".join(parts[1:])
    fallback_base = os.path.join(WORKSPACE_ROOT, "小蚕网站/repos/yyb-go-script-i")
    local_repo = repo_map().get(repo)
    if not local_repo:
        repo_lower = repo.lower()
        if "yyb-go-script" in repo_lower or "lcmovie" in repo_lower:
            candidate = _safe_join(fallback_base, rest)
            if candidate and os.path.isfile(candidate):
                return candidate
        return None
    path = _safe_join(os.path.join(WORKSPACE_ROOT, local_repo), rest)
    if path and os.path.isfile(path):
        return path
    # 模糊兜底
    repo_lower = repo.lower()
    if "yyb-go-script" in repo_lower or "lcmovie" in repo_lower:
        candidate = _safe_join(fallback_base, rest)
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


def parse_script_meta(text: str) -> dict:
    """从脚本源码里抓账号变量名、AppID与展示名称。"""
    env_name = ""
    for pattern in _ENV_NAME_PATTERNS:
        m = re.search(pattern, text)
        if m:
            env_name = m.group(1)
            break
    app_id = ""
    for pattern in _APPID_PATTERNS:
        m = re.search(pattern, text, re.I)
        if m:
            app_id = m.group(1)
            break

    friendly_name = ""
    m_name = re.search(r"""(?:name|TITLE)\s*[:=]\s*["']?([^"'\r\n]+)["']?""", text, re.I)
    if m_name:
        friendly_name = m_name.group(1).strip()

    is_yyb_server = False
    if not env_name and "YYB_SERVER" in text:
        env_name = "YYB_SERVER"
        is_yyb_server = True
    elif env_name == "YYB_SERVER":
        is_yyb_server = True

    return {
        "env_name": env_name,
        "app_id": app_id,
        "friendly_name": friendly_name,
        "is_yyb_server": is_yyb_server,
    }


def split_refs(raw: str) -> list[str]:
    """把 "1,2 / 换行 / & / @" 混写的账号值拆成列表。"""
    if not raw:
        return []
    return [x for x in REF_SPLIT.split(str(raw).strip()) if x]


def refs_from_yyb_server(raw: str) -> list[str]:
    """从 YYB_SERVER（多行 server@ref）中解析提取出所有的 ref。"""
    refs = []
    for line in str(raw or "").splitlines():
        line = line.strip().strip("'\"")
        if not line or "@" not in line:
            continue
        _, ref = line.rsplit("@", 1)
        ref = ref.strip().strip("'\"")
        if ref and ref not in refs:
            refs.append(ref)
    return refs


def refs_from_task_before(before: str, env_name: str) -> list[str]:
    """从 cron.task_before 里取某个变量的值。取不到 env_name 时尝试取 YYB_SERVER 或第一个 *_wxid。"""
    if not before:
        return []
    found: dict[str, str] = {}
    for m in _EXPORT_RE.finditer(before):
        name = m.group(1)
        value = m.group(2) if m.group(2) is not None else (m.group(3) if m.group(3) is not None else m.group(4))
        found[name] = value or ""
    if env_name == "YYB_SERVER" or (not env_name and "YYB_SERVER" in found):
        return refs_from_yyb_server(found.get("YYB_SERVER", ""))
    if env_name and env_name in found:
        return split_refs(found[env_name])
    for name, value in found.items():
        if name.endswith("_wxid") or name == "soy_wxid_data":
            return split_refs(value)
    if "YYB_SERVER" in found:
        return refs_from_yyb_server(found["YYB_SERVER"])
    return []


def set_task_before_yyb_server(current_before: str, yyb_base: str, refs: list[str]) -> str:
    """在 task_before 中添加、更新或清除 export YYB_SERVER。"""
    cleaned = re.sub(
        r"""export\s+YYB_SERVER\s*=\s*(?:'[^']*'|"[^"]*"|[^\s;]+);?""",
        "",
        current_before or "",
        flags=re.S,
    ).strip()
    cleaned = re.sub(r";\s*;", ";", cleaned).strip(" ;")

    if not refs or not yyb_base:
        return cleaned

    base = yyb_base.rstrip("/")
    lines = [f"{base}@{str(ref).strip()}" for ref in refs if ref and str(ref).strip()]
    if not lines:
        return cleaned

    server_block = "\n".join(lines)
    export_stmt = f"export YYB_SERVER='{server_block}'"
    return f"{cleaned}; {export_stmt}" if cleaned else export_stmt


def is_supported_script_command(command: str) -> bool:
    """判断定时任务命令是否是受支持的微信小程序活动脚本。

    支持：
    1. Code 版脚本（如 code版_*.py）
    2. lcmovie / yyb-go-script-i 仓库中的微信小程序脚本（严格限定 wx-script/ 下的 *.py 或 *.js，排除 idp-script/ 等独立非小程序脚本）
    """
    cmd = str(command or "").lower()
    if "code版" in cmd or "code_" in cmd:
        return True
    if any(k in cmd for k in ("yyb-go-script", "lcmovie")):
        return ("wx-script/" in cmd or "/wx-script" in cmd) and any(ext in cmd for ext in (".py", ".js"))
    if "wx-script/" in cmd or "/wx-script" in cmd:
        return any(ext in cmd for ext in (".py", ".js"))
    return False


# ---------------------------------------------------------------- 采集


def _is_managed(cron: dict) -> bool:
    """YYB 自己克隆出来的托管任务不算（名字带 [YYB: 前缀）。"""
    return "[YYB:" in str(cron.get("name") or "")


def collect(ep_ql=None, ep_yyb=None) -> dict:
    """拼出矩阵：脚本行 + 账号列 + 当前读到的绑定。

    不写库，纯读。真正入库用 sync()。
    """
    ep_ql = ep_ql or ql.endpoint()
    if not ep_ql:
        raise ql.QLError("还没有配置青龙端点")

    crons = [c for c in ql.crons(ep_ql) if not _is_managed(c)]
    env_list = ql.envs(ep_ql)
    env_by_name: dict[str, list[dict]] = {}
    for e in env_list:
        env_by_name.setdefault(str(e.get("name") or ""), []).append(e)

    rows: list[dict] = []
    for cron in crons:
        command = str(cron.get("command") or "")
        if not is_supported_script_command(command):
            continue
        m = re.match(r"task\s+(\S+)", command)
        script_key = m.group(1) if m else command
        if not script_key:
            continue

        path = local_path(script_key)
        meta = {"env_name": "", "app_id": "", "friendly_name": "", "is_yyb_server": False}
        if path:
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                    meta = parse_script_meta(fh.read())
            except OSError:
                pass

        env_name = meta["env_name"]
        refs: list[str] = []
        source = "none"
        raw_value = ""

        before = str(cron.get("task_before") or "")
        before_refs = refs_from_task_before(before, env_name)
        if before_refs:
            refs, source, raw_value = before_refs, "task_before", before
        elif env_name and env_by_name.get(env_name):
            # 同名可能多条：按顺序拼起来去重
            values = [str(e.get("value") or "") for e in env_by_name[env_name]]
            refs = []
            for v in values:
                for item in split_refs(v):
                    if item not in refs:
                        refs.append(item)
            source = "env"
            raw_value = " | ".join(values)

        # 友好展示名称：如果 cron 原名就是文件名（如 chzhjj.py），优先使用解析出来的中文名称
        cron_name = str(cron.get("name") or "").strip()
        display_name = cron_name
        if (not display_name or display_name.endswith((".py", ".js"))) and meta.get("friendly_name"):
            display_name = meta["friendly_name"]
        display_name = display_name or os.path.basename(script_key)

        is_yyb = bool(meta.get("is_yyb_server") or env_name == "YYB_SERVER" or "YYB_SERVER" in before)

        rows.append(
            {
                "script_key": script_key,
                "cron_id": cron.get("id"),
                "name": display_name,
                "env_name": env_name,
                "app_id": meta["app_id"],
                "refs": refs,
                "source": source,
                "raw": raw_value,
                "schedule": cron.get("schedule") or "",
                "enabled": 0 if cron.get("isDisabled") else int(cron.get("status") or 0),
                "has_local": bool(path),
                "is_yyb_server": is_yyb,
            }
        )

    rows.sort(key=lambda r: str(r["name"]))
    return {
        "scripts": rows,
        "env_names": sorted({r["env_name"] for r in rows if r["env_name"]}),
        "stats": {
            "scripts": len(rows),
            "bound": sum(1 for r in rows if r["refs"]),
            "no_env_name": sum(1 for r in rows if not r["env_name"]),
            "no_local": sum(1 for r in rows if not r["has_local"]),
        },
    }


# ---------------------------------------------------------------- 入库


def sync(rows: list[dict]) -> int:
    """把采集结果落库（按 script_key upsert），返回写入行数。
    特别注意：已存在的 script_bindings 若被标记为 is_hidden/失效隐藏，重新采集同步时绝不被覆盖冲掉。
    """
    now = core.iso()
    n = 0
    for row in rows:
        payload = {
            "script_key": row["script_key"],
            "cron_id": row.get("cron_id"),
            "name": row.get("name") or "",
            "env_name": row.get("env_name") or "",
            "app_id": row.get("app_id") or "",
            "refs": json.dumps(row.get("refs") or [], ensure_ascii=False),
            "source": row.get("source") or "none",
            "schedule": row.get("schedule") or "",
            "enabled": int(row.get("enabled") or 0),
            "updated_time": now,
        }
        existing = core.query_one(
            "SELECT id, is_hidden FROM script_bindings WHERE script_key=?", (payload["script_key"],)
        )
        if existing:
            # 保持管理员设定的 is_hidden 状态，若入参显式指定则依入参，否则继承数据库原有设定
            if "is_hidden" in row:
                payload["is_hidden"] = int(row["is_hidden"])
            else:
                payload["is_hidden"] = int(existing["is_hidden"] if "is_hidden" in existing.keys() else 0)
            sets = ", ".join(f"{k}=?" for k in payload)
            core.execute(
                f"UPDATE script_bindings SET {sets} WHERE id=?",
                tuple(payload.values()) + (existing["id"],),
            )
        else:
            payload["is_hidden"] = int(row.get("is_hidden") or 0)
            core.insert("script_bindings", payload)
        n += 1

    # 清理历史遗留或不再受支持的条目（例如曾经误入库的非 wx-script 脚本，如 idp-script/*）
    for old_row in core.query("SELECT id, script_key FROM script_bindings"):
        if not is_supported_script_command(old_row["script_key"]):
            core.execute("DELETE FROM script_bindings WHERE id=?", (old_row["id"],))

    return n


def stored() -> list[dict]:
    """读回面板里存的矩阵。"""
    return [
        {
            "id": r["id"],
            "script_key": r["script_key"],
            "cron_id": r["cron_id"],
            "name": r["name"],
            "env_name": r["env_name"],
            "app_id": r["app_id"],
            "refs": json.loads(r["refs"] or "[]"),
            "source": r["source"],
            "schedule": r["schedule"],
            "enabled": r["enabled"],
            "is_hidden": int(r["is_hidden"] if "is_hidden" in r.keys() else 0),
            "updated_time": r["updated_time"],
        }
        for r in core.query("SELECT * FROM script_bindings ORDER BY name")
    ]
