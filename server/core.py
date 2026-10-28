"""核心层：配置、SQLite、响应封装、鉴权、积分与时间工具。

对齐原站契约：
- 统一响应体 {"code":200,"data":...,"msg":"success"}，异常 {"code":401|404|500,"data":{},"msg":"..."}
- 积分内部以「分」为单位（100 = 1.00 积分），前端 pts() 做 /100 展示
- 时间统一 +08:00 ISO8601，如 2026-08-31T21:38:39.421+08:00（前端按 slice 截断展示）
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import string
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from flask import g, jsonify, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "panel.db")
CONFIG_PATH = os.path.join(BASE_DIR, "config.json")

# 自定义站点图标（管理端上传）落在这里。固定文件名、覆盖式写入 ——
# 一次只保留一个 logo，省掉「清理旧文件」的活儿。
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
SITE_LOGO_PATH = os.path.join(UPLOAD_DIR, "site-logo.png")

# 本地覆盖层（可选，不进版本库）：放敏感凭据，优先级高于 config.json 但低于环境变量。
# 约定与 web 侧的 *.local.json 一致，见 小蚕网站/.gitignore。
CONFIG_LOCAL_PATH = os.path.join(BASE_DIR, "config.local.json")

CN_TZ = timezone(timedelta(hours=8))

# 出厂默认管理员口令：只在「首次建库」时使用；上线前必须改（tools/set_admin_password.py）
DEFAULT_ADMIN_PASSWORD = "admin12345"

# 出厂站点名称：只是「settings 表里还没写过 site_name」时的兜底值。
# 管理员在「系统设置 → 站点与注册」改过之后，一切以数据库为准
# （前端统一从公开接口 /api/site-info 取，不再有任何硬编码站名）。
DEFAULT_SITE_NAME = "托管鸭"

DEFAULT_CONFIG = {
    "host": "0.0.0.0",
    "port": 8100,                # 与 run.sh / 前端 PANEL_API_URL 保持同一口径
    "secret_key": "",            # 首次启动自动生成并写回 config.json
    "token_ttl_seconds": 7200,   # 与原站一致：2 小时
    "admin_email": "admin@example.com",
    "admin_password": DEFAULT_ADMIN_PASSWORD,  # 仅首次建库时使用
    "runner_key": "",            # 青龙 runner 回调本站用的内部密钥
    "register_require_code": False,  # true 时注册必须填邮箱验证码
}


def _read_json(path: str) -> dict:
    """读一个 JSON 配置文件，缺失或损坏时返回空 dict（不让配置问题拖垮启动）。"""
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _env_str(key: str) -> str:
    return (os.getenv(key) or "").strip().strip('"').strip("'")


def _truthy(value, default: bool = True) -> bool:
    if value is None or value == "":
        return default
    return str(value).strip().lower() not in ("0", "false", "no", "off")


# 敏感凭据与部署相关项允许用环境变量覆盖（容器/CI 里不必落盘）。
# 扁平字段：PANEL_* 直接改顶层键；嵌套字段：YYB_*/QL_* 写进 yyb / qinglong 段。
_ENV_FLAT = (
    ("PANEL_HOST", "host", str),
    ("PANEL_PORT", "port", int),
    ("PANEL_SECRET_KEY", "secret_key", str),
    ("PANEL_ADMIN_EMAIL", "admin_email", str),
    ("PANEL_ADMIN_PASSWORD", "admin_password", str),
    ("PANEL_RUNNER_KEY", "runner_key", str),
    ("PANEL_REGISTER_REQUIRE_CODE", "register_require_code", _truthy),
)
_ENV_NESTED = (
    ("YYB_URL", ("yyb", "url"), str),
    ("YYB_USERNAME", ("yyb", "username"), str),
    ("YYB_PASSWORD", ("yyb", "password"), str),
    ("QL_URL", ("qinglong", "url"), str),
    ("QL_CLIENT_ID", ("qinglong", "client_id"), str),
    ("QL_CLIENT_SECRET", ("qinglong", "client_secret"), str),
)


def _set_nested(cfg: dict, path: tuple, value) -> None:
    node = cfg
    for key in path[:-1]:
        child = node.get(key)
        if not isinstance(child, dict):
            child = {}
            node[key] = child
        node = child
    node[path[-1]] = value


def _apply_env(cfg: dict) -> None:
    """环境变量覆盖（优先级最高）。转换失败的值忽略，不污染配置。"""
    for env_key, field, cast in _ENV_FLAT:
        raw = _env_str(env_key)
        if not raw:
            continue
        try:
            cfg[field] = cast(raw)
        except (TypeError, ValueError):
            continue
    for env_key, path, cast in _ENV_NESTED:
        raw = _env_str(env_key)
        if not raw:
            continue
        try:
            _set_nested(cfg, path, cast(raw))
        except (TypeError, ValueError):
            continue


def load_config() -> dict:
    """三级合并：DEFAULT_CONFIG ← config.json ← config.local.json ← 环境变量。

    只有「自动生成的密钥」会回填 config.json；来自 config.local.json 或环境变量的
    敏感值一律不落盘，避免把凭据写回可能被同步/提交的文件。
    """
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(_read_json(CONFIG_PATH))
    cfg.update(_read_json(CONFIG_LOCAL_PATH))
    _apply_env(cfg)

    generated: dict = {}
    if not cfg.get("secret_key"):
        cfg["secret_key"] = secrets.token_hex(32)
        generated["secret_key"] = cfg["secret_key"]
    if not cfg.get("runner_key"):
        cfg["runner_key"] = secrets.token_hex(16)
        generated["runner_key"] = cfg["runner_key"]

    if generated or not os.path.exists(CONFIG_PATH):
        # 保留 config.json 里已有的其它字段，只回填新生成的密钥
        merged = _read_json(CONFIG_PATH)
        merged.update(generated)
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
                json.dump(merged, fh, ensure_ascii=False, indent=2)
        except OSError:
            pass
    return cfg


DEFAULT_ADMIN_PASSWORD = "admin12345"


def admin_password_is_default() -> bool:
    """管理员口令是否仍为出厂默认值（用于启动提醒与改密 CLI）。"""
    return str(CONFIG.get("admin_password") or "") == DEFAULT_ADMIN_PASSWORD



CONFIG = load_config()

# ---------------------------------------------------------------- 时间工具


def now_dt() -> datetime:
    return datetime.now(CN_TZ)


def iso(dt: datetime | None = None, ms: bool = True) -> str:
    dt = dt or now_dt()
    text = dt.strftime("%Y-%m-%dT%H:%M:%S")
    if ms:
        text += ".%03d" % (dt.microsecond // 1000)
    return text + "+08:00"


def today_str() -> str:
    return now_dt().strftime("%Y-%m-%d")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip().replace("/", "-").replace(" ", "T")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(str(value).strip(), fmt)
                break
            except ValueError:
                continue
        else:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=CN_TZ)
    return dt


# ---------------------------------------------------------------- 渠道
#
# 面板同时服务两个项目，用户体系**不混用**：
#   xiaocan  小蚕 · 大牌券（原站用户，走 /api/auth/login，channel 默认 xiaocan）
#   yyb      应用宝 · 协议服务（自己的账号，登录时必须显式带 channel=yyb）
# 同一张 users 表用 channel 区分，两个登录入口各认各的，跨渠道登录直接拒绝。

CHANNEL_XIAOCAN = "xiaocan"
CHANNEL_YYB = "yyb"
CHANNELS = (CHANNEL_XIAOCAN, CHANNEL_YYB)
CHANNEL_LABEL = {CHANNEL_XIAOCAN: "小蚕", CHANNEL_YYB: "应用宝"}


# ---------------------------------------------------------------- 数据库

_local = threading.local()


def with_db_retry(func, max_retries: int = 5, initial_delay: float = 0.05):
    """自动捕获 SQLite database is locked / busy 并在指数退避后重试，解决瞬时写冲突。"""
    delay = initial_delay
    for attempt in range(max_retries):
        try:
            return func()
        except sqlite3.OperationalError as exc:
            msg = str(exc).lower()
            if ("locked" in msg or "busy" in msg) and attempt < max_retries - 1:
                time.sleep(delay + secrets.randbelow(30) / 1000.0)
                delay *= 2
                continue
            raise


def get_db() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=30000")
        conn.execute("PRAGMA cache_size=-64000")
        conn.execute("PRAGMA temp_store=MEMORY")
        _local.conn = conn
    return conn


def close_db(_exc=None) -> None:
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        finally:
            _local.conn = None


def rows_to_dicts(rows) -> list[dict]:
    return [dict(r) for r in rows]


def query(sql: str, args=()) -> list[sqlite3.Row]:
    return with_db_retry(lambda: get_db().execute(sql, args).fetchall())


def query_one(sql: str, args=()):
    return with_db_retry(lambda: get_db().execute(sql, args).fetchone())


def execute(sql: str, args=()):
    return with_db_retry(lambda: get_db().execute(sql, args))


def insert(table: str, data: dict) -> int:
    cols = ", ".join(data.keys())
    marks = ", ".join("?" for _ in data)
    def _do():
        cur = get_db().execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(data.values()))
        return int(cur.lastrowid)
    return with_db_retry(_do)


def update(table: str, row_id: int, data: dict) -> None:
    sets = ", ".join(f"{k}=?" for k in data)
    def _do():
        get_db().execute(f"UPDATE {table} SET {sets} WHERE id=?", tuple(data.values()) + (row_id,))
    with_db_retry(_do)


def delete(table: str, row_id: int) -> None:
    with_db_retry(lambda: get_db().execute(f"DELETE FROM {table} WHERE id=?", (row_id,)))


def random_str(length: int = 8) -> str:
    """URL 安全的随机串（小写字母+数字），给 slug/后缀用。"""
    alphabet = string.ascii_lowercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  channel TEXT NOT NULL DEFAULT 'xiaocan',
  status TEXT NOT NULL DEFAULT 'normal',
  points_balance INTEGER NOT NULL DEFAULT 0,
  points_spent INTEGER NOT NULL DEFAULT 0,
  invite_code TEXT UNIQUE,
  inviter_id INTEGER,
  email_notify INTEGER NOT NULL DEFAULT 1,
  slot_total INTEGER NOT NULL DEFAULT 0,
  slot_used INTEGER NOT NULL DEFAULT 0,
  vip_level INTEGER NOT NULL DEFAULT 0,
  vip_expire TEXT,
  token_version INTEGER NOT NULL DEFAULT 1,
  remark TEXT NOT NULL DEFAULT '',
  last_login_ip TEXT,
  last_login_time TEXT,
  created_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS points_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON points_transactions(user_id, id DESC);

CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'register',
  used INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  expire_time TEXT NOT NULL,
  created_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  account_info TEXT NOT NULL DEFAULT '',   -- 小蚕 silk_id
  xc_user_id TEXT NOT NULL DEFAULT '',     -- 小蚕 UserId（账号数据里的第 2 段）
  access_token TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  vip_level INTEGER NOT NULL DEFAULT 0,
  is_plus INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'enabled',
  admin_paused INTEGER NOT NULL DEFAULT 0,
  membership_expire TEXT,
  token_expire TEXT,
  remark TEXT NOT NULL DEFAULT '',
  signup_error TEXT NOT NULL DEFAULT '',
  default_panel_id INTEGER,
  brand_panel_id INTEGER,
  bind_time TEXT NOT NULL,
  created_time TEXT NOT NULL,
  updated_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_acc_user ON accounts(user_id);

CREATE TABLE IF NOT EXISTS account_features (
  account_id INTEGER NOT NULL,
  feature_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, feature_name)
);

CREATE TABLE IF NOT EXISTS redeem_settings (
  account_id INTEGER PRIMARY KEY,
  exchange_id INTEGER,
  start_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 0,
  runner_ready INTEGER NOT NULL DEFAULT 1,
  updated_time TEXT
);

CREATE TABLE IF NOT EXISTS signup_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  tea_name TEXT NOT NULL DEFAULT '',
  order_numbers TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  output TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  panel_id INTEGER,
  created_time TEXT NOT NULL,
  finished_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_signup_account ON signup_records(account_id, id DESC);

CREATE TABLE IF NOT EXISTS brand_coupon_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date TEXT NOT NULL,
  account_id INTEGER,
  account_info TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  vip_level INTEGER NOT NULL DEFAULT 0,
  panel_name TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🎯',
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'enabled',
  created_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coupon_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  points_cost INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'enabled',
  created_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS card_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  points_value INTEGER NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'enabled',
  created_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  tier_id INTEGER,
  points_value INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unused',
  user_id INTEGER,
  created_time TEXT NOT NULL,
  used_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status, id DESC);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'membership',
  grant_value INTEGER NOT NULL DEFAULT 0,
  points_price INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'enabled',
  created_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  published_time TEXT NOT NULL,
  updated_time TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS lottery_prizes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  probability_bps INTEGER NOT NULL DEFAULT 0,
  reward_points INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lottery_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  prize_name TEXT NOT NULL DEFAULT '',
  reward_points INTEGER NOT NULL DEFAULT 0,
  cost_points INTEGER NOT NULL DEFAULT 0,
  created_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lottery_user ON lottery_records(user_id, id DESC);

CREATE TABLE IF NOT EXISTS checkin_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  -- daily = 每日签到（固定加分）；gamble = 赌狗签到（随机 加/0/减）
  kind TEXT NOT NULL DEFAULT 'daily',
  reward INTEGER NOT NULL DEFAULT 0,
  created_time TEXT NOT NULL,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS ql_panels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  remark TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  -- 主凭据：青龙 OpenAPI（系统设置 → 应用 → Client ID / Client Secret）
  client_id TEXT NOT NULL DEFAULT '',
  client_secret TEXT NOT NULL DEFAULT '',
  -- 备用凭据：仅当需要「查看日志内容」时才用（青龙 OpenAPI 不返回日志内容）
  username TEXT NOT NULL DEFAULT 'admin',
  password TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unknown',
  last_check TEXT,
  created_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redeem_prizes (
  account_id INTEGER NOT NULL,
  exchange_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  yuanbao_cost INTEGER,
  group_name TEXT NOT NULL DEFAULT '',
  start_at INTEGER,
  end_at INTEGER,
  available INTEGER NOT NULL DEFAULT 0,
  upcoming INTEGER NOT NULL DEFAULT 0,
  updated_time TEXT,
  PRIMARY KEY (account_id, exchange_id)
);

CREATE TABLE IF NOT EXISTS ql_tokens (
  panel_id INTEGER PRIMARY KEY,
  token TEXT NOT NULL DEFAULT '',
  expire_time TEXT
);

CREATE TABLE IF NOT EXISTS service_endpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                 -- yyb / xiaocan / qinglong ...
  name TEXT NOT NULL DEFAULT '',
  base_url TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  integration_token TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'unknown',
  last_check TEXT,
  created_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_logs_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  panel_id INTEGER NOT NULL,
  log_date TEXT NOT NULL,
  task_key TEXT NOT NULL DEFAULT '',
  file TEXT NOT NULL DEFAULT '',
  log_time TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'unknown',
  output TEXT NOT NULL DEFAULT '',
  fetched_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS yyb_account_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id INTEGER,                   -- service_endpoints.id（哪个 YYB 实例）
  ref TEXT NOT NULL,                     -- YYB 账号标识：id / uin / openid
  user_id INTEGER,                       -- 归属的面板用户；NULL = 还没分配
  label TEXT NOT NULL DEFAULT '',        -- 冗余的显示名（备注/昵称），方便列表
  created_time TEXT NOT NULL,
  UNIQUE(endpoint_id, ref)
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_key TEXT NOT NULL UNIQUE,     -- 统一键：xiaocan:3 / yyb:XiaoGe-LiBai_yangmao_main/miniapp/code/code版_x.py / custom:<slug>
  channel TEXT NOT NULL DEFAULT 'xiaocan', -- xiaocan / yyb / custom
  name TEXT NOT NULL DEFAULT '',        -- 展示名（业务名）
  ref_id TEXT NOT NULL DEFAULT '',      -- 渠道内的关联标识（coupon id / script_key / slug）
  points_cost INTEGER NOT NULL DEFAULT 0,  -- 提交同步到青龙要消耗的积分（共用一套余额）
  hidden INTEGER NOT NULL DEFAULT 0,    -- 1 = 默认隐藏，只对 project_grants 里的用户展示
  min_vip_level INTEGER NOT NULL DEFAULT 0, -- 最低会员等级门槛（0 = 不限；2 = 仅至尊可见）
  status TEXT NOT NULL DEFAULT 'enabled',
  sort_order INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '', -- 脚本说明/提交须知
  submit_mode TEXT NOT NULL DEFAULT 'custom', -- custom / token / account_password
  field_config TEXT NOT NULL DEFAULT '[]',   -- JSON 格式自定义参数定义
  target_script TEXT NOT NULL DEFAULT '',    -- 青龙对应脚本文件名或任务名
  env_name TEXT NOT NULL DEFAULT '',         -- 关联环境变量名（如适用）
  env_template TEXT NOT NULL DEFAULT '',     -- 提交参数拼装模板，如 {unionId}#{idenId}；空则回退取第一个非空参数
  created_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  project_key TEXT NOT NULL,
  script_name TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT '',
  params_data TEXT NOT NULL DEFAULT '{}',
  points_cost INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'submitted',
  result_msg TEXT NOT NULL DEFAULT '',
  created_time TEXT NOT NULL,
  updated_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custom_sub_user ON custom_submissions(user_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_custom_sub_proj ON custom_submissions(project_id, id DESC);

CREATE TABLE IF NOT EXISTS project_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created_time TEXT NOT NULL,
  UNIQUE(project_id, user_id)
);

CREATE TABLE IF NOT EXISTS script_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  script_key TEXT NOT NULL UNIQUE,      -- 青龙仓库相对路径，如 XiaoGe-LiBai_yangmao_main/miniapp/code/code版_华润通签到.py
  cron_id INTEGER,                      -- 青龙任务 id
  name TEXT NOT NULL DEFAULT '',        -- 任务名
  env_name TEXT NOT NULL DEFAULT '',    -- 该脚本读的账号变量名，如 hrt_wxid
  app_id TEXT NOT NULL DEFAULT '',      -- 取码用的小程序 AppID
  refs TEXT NOT NULL DEFAULT '[]',      -- 账号 ref 列表 JSON，如 ["1","2"]
  source TEXT NOT NULL DEFAULT '',      -- refs 来源：env / task_before / manual / none
  schedule TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  is_hidden INTEGER NOT NULL DEFAULT 0, -- 是否在前台失效隐藏：0正常展示，1失效禁用前台不展示
  updated_time TEXT
);

CREATE TABLE IF NOT EXISTS login_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ip TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'success',
  created_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs (user_id, id DESC);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  admin_email TEXT NOT NULL DEFAULT '',
  target_user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  ip TEXT NOT NULL DEFAULT '',
  created_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_audit_logs(admin_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit_logs(target_user_id, id DESC);

CREATE TABLE IF NOT EXISTS user_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'system',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_time TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON user_notifications(user_id, id DESC);
"""


def init_db() -> None:
    db = get_db()
    db.executescript(SCHEMA)
    migrate(db)


def migrate(db=None) -> None:
    """轻量迁移：CREATE TABLE IF NOT EXISTS 不会给老表补列，这里显式补。

    幂等，可重复跑。新库走 SCHEMA 时这些列本来就有，这里是给已存在的库兜底。
    """
    db = db or get_db()
    wanted = {
        "users": [
            ("channel", "TEXT NOT NULL DEFAULT 'xiaocan'"),
            ("token_version", "INTEGER NOT NULL DEFAULT 1"),
            ("remark", "TEXT NOT NULL DEFAULT ''"),
            ("vip_level", "INTEGER NOT NULL DEFAULT 0"),
            ("vip_expire", "TEXT"),
        ],
        "ql_panels": [
            ("client_id", "TEXT NOT NULL DEFAULT ''"),
            ("client_secret", "TEXT NOT NULL DEFAULT ''"),
        ],
        "checkin_records": [
            ("kind", "TEXT NOT NULL DEFAULT 'daily'"),
        ],
        "email_codes": [
            ("attempts", "INTEGER NOT NULL DEFAULT 0"),
        ],
        "projects": [
            ("description", "TEXT NOT NULL DEFAULT ''"),
            ("submit_mode", "TEXT NOT NULL DEFAULT 'custom'"),
            ("field_config", "TEXT NOT NULL DEFAULT '[]'"),
            ("target_script", "TEXT NOT NULL DEFAULT ''"),
            ("env_name", "TEXT NOT NULL DEFAULT ''"),
            ("env_template", "TEXT NOT NULL DEFAULT ''"),
            ("min_vip_level", "INTEGER NOT NULL DEFAULT 0"),
        ],
        "script_bindings": [
            ("is_hidden", "INTEGER NOT NULL DEFAULT 0"),
        ],
    }
    for table, columns in wanted.items():
        existing = {r["name"] for r in db.execute(f"PRAGMA table_info({table})")}
        if not existing:
            continue
        for name, ddl in columns:
            if name not in existing:
                db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")

    db.execute("""
    CREATE TABLE IF NOT EXISTS custom_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      project_key TEXT NOT NULL,
      script_name TEXT NOT NULL,
      account TEXT NOT NULL DEFAULT '',
      params_data TEXT NOT NULL DEFAULT '{}',
      points_cost INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'submitted',
      result_msg TEXT NOT NULL DEFAULT '',
      created_time TEXT NOT NULL,
      updated_time TEXT NOT NULL
    );
    """)

    db.execute("""
    CREATE TABLE IF NOT EXISTS login_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      ip TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success',
      created_time TEXT NOT NULL
    );
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs (user_id, id DESC);")

    db.execute("""
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      admin_email TEXT NOT NULL DEFAULT '',
      target_user_id INTEGER,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '{}',
      ip TEXT NOT NULL DEFAULT '',
      created_time TEXT NOT NULL
    );
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_audit_admin ON admin_audit_logs(admin_id, id DESC);")
    db.execute("CREATE INDEX IF NOT EXISTS idx_audit_target ON admin_audit_logs(target_user_id, id DESC);")

    db.execute("""
    CREATE TABLE IF NOT EXISTS user_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'system',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_time TEXT NOT NULL
    );
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_notif_user ON user_notifications(user_id, id DESC);")
    db.execute("CREATE INDEX IF NOT EXISTS idx_custom_sub_user ON custom_submissions(user_id, id DESC);")
    db.execute("CREATE INDEX IF NOT EXISTS idx_custom_sub_proj ON custom_submissions(project_id, id DESC);")
    db.execute("CREATE INDEX IF NOT EXISTS idx_task_logs_cache_date ON task_logs_cache(log_date);")
    db.execute("CREATE INDEX IF NOT EXISTS idx_signup_created ON signup_records(created_time);")

    # 一次性数据迁移：清理历史误判录入的非 YYB 小程序项目（如 idp-script 脚本）。
    # 用 settings 打标只跑一次，避免像之前那样每次 sync_catalog 都全表 DELETE。
    if not query_one("SELECT 1 FROM settings WHERE key='migrated_idp_script_cleanup'"):
        db.execute("DELETE FROM projects WHERE project_key LIKE '%idp-script%'")
        db.execute(
            "INSERT INTO settings (key, value) VALUES ('migrated_idp_script_cleanup', '1') "
            "ON CONFLICT(key) DO NOTHING"
        )


# ---------------------------------------------------------------- 响应封装


def ok(data=None, msg: str = "success"):
    return jsonify({"code": 200, "data": {} if data is None else data, "msg": msg})


def fail(msg: str = "请求失败", code: int = 400, data=None):
    return jsonify({"code": code, "data": {} if data is None else data, "msg": msg}), 200


def not_found():
    return jsonify({"code": 404, "data": {}, "msg": "page not found"}), 200


# ---------------------------------------------------------------- 密码 / JWT


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120000)
    return "pbkdf2_sha256$120000$%s$%s" % (salt, base64.b64encode(dk).decode())


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, digest = stored.split("$")
        digest_name = algo.split("_", 1)[1] if "_" in algo else algo
        dk = hashlib.pbkdf2_hmac(digest_name, password.encode(), salt.encode(), int(iters))
        return hmac.compare_digest(base64.b64encode(dk).decode(), digest)
    except Exception:
        return False


def make_token(user_id: int, role: str, token_version: int = 1) -> tuple[str, int]:
    ttl = int(CONFIG.get("token_ttl_seconds") or 7200)
    issued = int(time.time())
    payload = {
        "user_id": int(user_id),
        "role": role,
        "token_version": int(token_version or 1),
        "iat": issued,
        "exp": issued + ttl,
        "jti": uuid.uuid4().hex,
    }
    token = jwt.encode(payload, CONFIG["secret_key"], algorithm="HS256")
    return token, ttl


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, CONFIG["secret_key"], algorithms=["HS256"])
    except Exception:
        return None


# ---------------------------------------------------------------- 用户上下文


def current_user():
    return getattr(g, "user", None)


def require_login(fn):
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        payload = decode_token(token) if token else None
        if not payload:
            return jsonify({"code": 401, "data": {}, "msg": "登录已失效，请重新登录"}), 200
        user = query_one("SELECT * FROM users WHERE id=?", (payload.get("user_id"),))
        if not user or user["status"] == "banned":
            return jsonify({"code": 401, "data": {}, "msg": "账号不可用"}), 200
        user_tv = dict(user).get("token_version")
        jwt_tv = payload.get("token_version")
        if user_tv is not None and jwt_tv is not None and int(jwt_tv) != int(user_tv):
            return jsonify({"code": 401, "data": {}, "msg": "登录已失效或已被强制下线，请重新登录"}), 200
        g.user = dict(user)
        g.token_payload = payload
        return fn(*args, **kwargs)

    return wrapper


def require_admin(fn):
    from functools import wraps

    @wraps(fn)
    @require_login
    def wrapper(*args, **kwargs):
        if current_user().get("role") != "admin":
            return fail("无管理权限", 403)
        return fn(*args, **kwargs)

    return wrapper


def current_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or ""


# ---------------------------------------------------------------- 业务工具


def _vip_effective(user) -> tuple[int, str]:
    """生效的会员等级与显示名（已过期回落 0 / 普通会员）。

    延迟导入 vip：vip.py 反过来要用本模块的 parse_iso / now_dt，模块级互相 import 会成环。
    真实的等级配置与判定逻辑都在 server/vip.py，这里只是给 user_public 用的薄封装。
    显示名统一由这里下发，前端不要再自己拼「VIP1 高级会员」这类混搭文案。
    """
    try:
        import vip as vip_mod
        level = vip_mod.current_level(user)
        return level, vip_mod.table(level)["name"]
    except Exception:
        return 0, "普通会员"


def user_public(user: dict, with_secret: bool = False) -> dict:
    effective_level, level_name = _vip_effective(user)
    data = {
        "id": user["id"],
        "email": user["email"],
        "nickname": user["nickname"],
        "role": user["role"],
        "channel": (user["channel"] if "channel" in user.keys() else "xiaocan") or "xiaocan",
        "status": user["status"],
        "points_balance": user["points_balance"],
        "points_spent": user["points_spent"],
        "invite_code": user["invite_code"],
        "inviter_id": user["inviter_id"],
        "email_notify": user["email_notify"],
        "slot_total": user["slot_total"],
        "slot_used": user["slot_used"],
        "vip_level": int(user.get("vip_level", 0) or 0) if "vip_level" in user.keys() else 0,
        # 生效等级：已过期即 0（判定逻辑在 server/vip.py，这里延迟导入避免循环依赖）
        "vip_level_effective": effective_level,
        # 等级显示名（普通会员/高级会员/至尊会员）——唯一来源是 vip.py，前端不硬编码
        "vip_level_name": level_name,
        "vip_expire": user.get("vip_expire") if "vip_expire" in user.keys() else None,
        "token_version": user.get("token_version", 1) if "token_version" in user.keys() else 1,
        "remark": (user.get("remark", "") if "remark" in user.keys() else "") or "",
        "last_login_ip": user["last_login_ip"] or "",
        "last_login_time": user["last_login_time"],
        "created_time": user["created_time"],
    }
    if with_secret:
        data["password"] = ""
    return data


def log_admin_action(action: str, target_user_id: int | None = None, detail: dict | None = None) -> None:
    """记录管理员关键操作审计日志。"""
    admin = current_user()
    admin_id = admin["id"] if admin else 0
    admin_email = admin.get("email", "") if admin else "system"
    try:
        insert(
            "admin_audit_logs",
            {
                "admin_id": admin_id,
                "admin_email": admin_email,
                "target_user_id": target_user_id,
                "action": action,
                "detail": json.dumps(detail or {}, ensure_ascii=False),
                "ip": current_ip(),
                "created_time": iso(),
            },
        )
    except Exception:
        pass


def gen_invite_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if not query_one("SELECT 1 FROM users WHERE invite_code=?", (code,)):
            return code


def get_settings() -> dict:
    defaults = {
        "site_name": DEFAULT_SITE_NAME,
        "register_enabled": "true",
        "referral_rate_bps": "800",
        "lottery_cost": "200",
        "lottery_daily_limit": "30",
        # 站点对外地址（如 https://panel.example.com）。邮件里的 logo、按钮链接
        # 必须是绝对地址才能被邮件客户端加载，所以这是发好邮件的前提；
        # 留空时邮件用纯样式抬头（不放图），不影响阅读。
        "site_url": "",
        # 自定义站点图标：只存一个开关。有没有上传过图由文件是否存在决定
        # （core.SITE_LOGO_PATH），不额外记文件名。
        "site_logo_enabled": "false",
        # 邮件服务（管理端「系统设置 → 邮件服务」维护，mail.py 按此发信）
        "smtp_host": "",
        "smtp_port": "465",
        "smtp_ssl": "true",
        "smtp_user": "",
        "smtp_password": "",
        "smtp_sender": "",
        "smtp_from_name": DEFAULT_SITE_NAME,
    }
    for row in query("SELECT key, value FROM settings"):
        defaults[row["key"]] = row["value"]
    return defaults


def get_setting(key: str, default=""):
    row = query_one("SELECT value FROM settings WHERE key=?", (key,))
    return row["value"] if row else default


def site_name() -> str:
    """
    当前站点名称：settings 有值就用值，否则回落到出厂默认。

    全站（页面标题、侧栏、邮件抬头、推送文案）都**只从这一个函数取**，
    不要各处再写 `get_setting('site_name','') or '某默认名'` —— 那样默认名会
    散落成一堆副本，改名时必然漏掉几处。
    """
    return (get_setting("site_name", "") or DEFAULT_SITE_NAME).strip()


def site_logo_enabled() -> bool:
    """
    自定义站点图标是否生效：**开关打开 且 确实上传过文件**，两个条件都要。

    只认文件是否在，不在数据库里记文件名 —— 一次只留一个 logo（覆盖式写入），
    少一个可能与磁盘不同步的状态。
    """
    if (get_setting("site_logo_enabled", "") or "").strip().lower() != "true":
        return False
    return os.path.exists(SITE_LOGO_PATH)


def set_setting(key: str, value) -> None:
    execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, str(value)),
    )


def _apply_points(user_id: int, amount: int, tx_type: str, note: str = "") -> int:
    """原子 CAS 变更积分并记流水（调用方负责事务）。从数据库引擎物理底层彻底杜绝透支和并发竞态。返回变更后余额。"""
    amount = int(amount)
    db = get_db()
    if amount < 0:
        deduct = -amount
        # 原子 CAS 条件更新：仅当 points_balance >= deduct 时生效
        cur = db.execute(
            "UPDATE users SET "
            "  points_balance = points_balance - ?, "
            "  points_spent = points_spent + ? "
            "WHERE id = ? AND points_balance >= ?",
            (deduct, deduct, user_id, deduct),
        )
        if cur.rowcount == 0:
            user = query_one("SELECT points_balance FROM users WHERE id=?", (user_id,))
            if not user:
                raise ValueError("用户不存在")
            cur_bal = int(user["points_balance"] or 0)
            raise ValueError(f"积分不足：需扣除 {deduct}，当前余额仅有 {cur_bal}")
    else:
        cur = db.execute(
            "UPDATE users SET points_balance = points_balance + ? WHERE id = ?",
            (amount, user_id),
        )
        if cur.rowcount == 0:
            user = query_one("SELECT 1 FROM users WHERE id=?", (user_id,))
            if not user:
                raise ValueError("用户不存在")

    user_row = query_one("SELECT points_balance FROM users WHERE id=?", (user_id,))
    new_balance = int(user_row["points_balance"] or 0)

    insert(
        "points_transactions",
        {
            "user_id": user_id,
            "amount": amount,
            "type": tx_type,
            "note": note,
            "created_time": iso(),
        },
    )
    return new_balance


def add_points(user_id: int, amount: int, tx_type: str, note: str = "") -> int:
    """变更用户积分并记流水（自带排他事务与并发重试），返回变更后的余额。amount 可为负。"""
    def _trans():
        db = get_db()
        db.execute("BEGIN IMMEDIATE")
        try:
            balance = _apply_points(user_id, amount, tx_type, note)
            db.execute("COMMIT")
            return balance
        except Exception:
            try:
                db.execute("ROLLBACK")
            except Exception:
                pass
            raise

    return with_db_retry(_trans, max_retries=5, initial_delay=0.05)


def truncate_log_text(text: str, max_length: int = 8000, head_ratio: float = 0.2) -> str:
    """智能截断超长日志：保留头部环境信息与尾部关键执行结果/报错，中间省略，防止 OOM 与数据库膨胀。"""
    if not text:
        return ""
    text_str = str(text)
    if len(text_str) <= max_length:
        return text_str
    head_len = int(max_length * head_ratio)
    tail_len = max_length - head_len - 80
    omitted = len(text_str) - head_len - tail_len
    return f"{text_str[:head_len]}\n\n... [中间已省略 {omitted} 字符以节省内存与存储空间] ...\n\n{text_str[-tail_len:]}"


def cleanup_expired_logs(keep_cache_days: int = 3, keep_signup_days: int = 30) -> dict:
    """清理过期日志缓存与归档旧任务长文本，防止数据库无限膨胀和查询 OOM。"""
    deleted_cache = 0
    archived_signup = 0
    deleted_audit = 0
    deleted_login = 0

    def _do_clean():
        nonlocal deleted_cache, archived_signup, deleted_audit, deleted_login
        db = get_db()
        # 统一使用带有本地时区的 ISO 字符串或日期字符串计算时间边界，避免 SQLite UTC 8小时偏差
        cache_cutoff_date = (now_dt() - timedelta(days=keep_cache_days)).strftime("%Y-%m-%d")
        signup_cutoff_iso = iso(now_dt() - timedelta(days=keep_signup_days))
        login_cutoff_iso = iso(now_dt() - timedelta(days=30))
        audit_cutoff_iso = iso(now_dt() - timedelta(days=60))

        # 1. 清理过期青龙日志缓存（超过 keep_cache_days 天）
        cur1 = db.execute(
            "DELETE FROM task_logs_cache WHERE log_date < ?",
            (cache_cutoff_date,),
        )
        deleted_cache = cur1.rowcount or 0

        # 2. 归档历史报名记录长文本（超过 keep_signup_days 天，保留记录但置空 output 释放磁盘）
        cur2 = db.execute(
            "UPDATE signup_records SET output='[历史日志已自动归档释放空间]' "
            "WHERE created_time < ? "
            "AND output != '' AND output != '[历史日志已自动归档释放空间]'",
            (signup_cutoff_iso,),
        )
        archived_signup = cur2.rowcount or 0

        # 3. 清理 30 天前的登录日志与 60 天前的审计日志
        cur3 = db.execute("DELETE FROM login_logs WHERE created_time < ?", (login_cutoff_iso,))
        deleted_login = cur3.rowcount or 0
        cur4 = db.execute("DELETE FROM admin_audit_logs WHERE created_time < ?", (audit_cutoff_iso,))
        deleted_audit = cur4.rowcount or 0

        try:
            db.execute("PRAGMA wal_checkpoint(PASSIVE)")
        except Exception:
            pass

    try:
        with_db_retry(_do_clean)
    except Exception as exc:
        print(f"[cleanup_logs] 清理日志异常: {exc}")

    return {
        "deleted_cache": deleted_cache,
        "archived_signup": archived_signup,
        "deleted_login": deleted_login,
        "deleted_audit": deleted_audit,
    }


def start_log_cleanup_daemon(interval_seconds: int = 43200):
    """启动后台守护看门狗线程，定时清理过期日志并巡检收割僵尸任务。"""
    def _worker():
        time.sleep(10)  # 启动后先稍等 10 秒
        last_clean = 0.0
        while True:
            now_ts = time.time()
            # 1. 僵尸任务收割器：每 60 秒巡检一次
            try:
                import runner_dispatch
                runner_dispatch.reap_zombie_tasks(timeout_minutes=15)
            except Exception as exc:
                print(f"[watchdog] 收割僵尸任务异常: {exc}")

            # 2. 日志与归档清理：每 interval_seconds 执行一次
            if now_ts - last_clean >= interval_seconds:
                try:
                    res = cleanup_expired_logs()
                    print(f"[log_cleanup] 定时清理完成: {res}")
                    last_clean = now_ts
                except Exception as exc:
                    print(f"[log_cleanup] 定时清理出错: {exc}")

            time.sleep(60)

    t = threading.Thread(target=_worker, name="BackgroundWatchdogDaemon", daemon=True)
    t.start()


def paginate(items: list, page: int, size: int) -> dict:
    total = len(items)
    start = max(0, (page - 1) * size)
    return {"records": items[start : start + size], "total": total, "page": page, "size": size}


def arg_int(name: str, default: int = 1, minimum: int = 1, maximum: int = 1000) -> int:
    try:
        value = int(request.args.get(name, default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


# 小蚕任务展示顺序。注意：这里与 xiaocan_tasks.CATALOG / FEATURE_TO_KEY 是同一份
# 任务清单的三个视角（此处是账号功能开关的规范名），增删任务时三处必须同步。
TASK_ORDER = [
    "限量大牌券-代理版",
    "保底大牌券",
    "会员专属返利券",
    "每日签到",
    "元宝一键领取",
    "元宝抽奖",
    "影音周卡",
    "红包雨",
    "免单券",
    "双节抽礼",
]
