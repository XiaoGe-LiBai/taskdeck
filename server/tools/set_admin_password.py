"""改口令 CLI：不删库、不停服地修改任意账号（含管理员）的登录口令。

背景：README 过去写的是「改 config.json 后删库重建」——那等于逼人一直用出厂默认口令。
本脚本直接改 users.password_hash，并顺带把 token_version +1 吊销该账号的现有登录凭证
（与后台「重置密码 / 强制下线」同一套语义）。

用法：
    cd 小蚕网站/server

    # 改 config.json 里 admin_email 那个账号（最常见用法，交互输入口令）
    python3 tools/set_admin_password.py

    # 指定邮箱
    python3 tools/set_admin_password.py someone@example.com

    # 非交互（写进脚本/CI 用，注意别留在 shell history 里）
    python3 tools/set_admin_password.py someone@example.com '新口令'

    # 只看有哪些账号，不改任何东西
    python3 tools/set_admin_password.py --list

安全约定：
  · 口令至少 8 位，永不回显、不落日志；
  · 改的若是 config.json 里的管理员账号，会把 config.json 的 admin_password 清空，
    这样 core.admin_password_is_default() 不再报警（该字段只在首次建库时用）；
  · 环境变量 PANEL_ADMIN_PASSWORD 优先级更高，仍设置时下次重启会覆盖本脚本的结果。
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import core  # noqa: E402

MIN_LENGTH = 8


def _load_accounts() -> list:
    return core.query("SELECT id, email, nickname, role, channel FROM users ORDER BY id")


def list_accounts() -> int:
    rows = _load_accounts()
    if not rows:
        print("库里还没有账号，请先用 -e PANEL_ADMIN_EMAIL / -e PANEL_ADMIN_PASSWORD 启动一次后端。")
        return 0
    print(f"{'ID':>5}  {'渠道':<8} {'角色':<7} {'邮箱':<32} 昵称")
    print("-" * 78)
    for r in rows:
        print(f"{r['id']:>5}  {r['channel'] or '':<8} {r['role'] or '':<7} {r['email']:<32} {r['nickname'] or ''}")
    return 0


def resolve_account(email: str):
    """按邮箱找账号；大小写不敏感。"""
    return core.query_one("SELECT * FROM users WHERE lower(email)=lower(?)", (email.strip(),))


def prompt_password() -> str:
    while True:
        first = getpass.getpass("新口令（至少 8 位，输入时不显示）：")
        if len(first) < MIN_LENGTH:
            print(f"  ✗ 至少 {MIN_LENGTH} 位，重新输入。")
            continue
        second = getpass.getpass("再输入一次确认：")
        if first != second:
            print("  ✗ 两次输入不一致，重新输入。")
            continue
        return first


def sync_config_admin_password(email: str) -> None:
    """改的是 config.json 里的管理员账号时，清掉那个出厂默认口令字段。

    config.json 的 admin_password 只在「首次建库」时被 bootstrap 使用，库已存在时它不参与登录；
    清空它只是为了不再触发「口令仍是默认值」的启动提醒。

    注意：如果口令来自环境变量 PANEL_ADMIN_PASSWORD，脚本改不动它 —— 下次重启会按变量同步回去。
    这种情况请改用部署变量，或先把变量从启动命令里去掉。
    """
    configured = str(core.CONFIG.get("admin_email") or "").strip().lower()
    if not configured or configured != email.strip().lower():
        return
    path = core.CONFIG_PATH
    data = core._read_json(path)
    if not data.get("admin_password"):
        return
    data["admin_password"] = ""
    data["_admin_password_note"] = "已由 tools/set_admin_password.py 改密，此字段仅首次建库时使用，留空即可"
    try:
        import json

        with open(path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        print("  · 已清空 config.json 的 admin_password（仅首次建库用，现由数据库口令生效）")
    except OSError as exc:
        print(f"  ! config.json 写回失败（不影响改密结果）：{exc}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="修改小蚕面板账号口令（不删库、不改代码）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("email", nargs="?", help="目标账号邮箱；省略则用 config.json 的 admin_email")
    parser.add_argument("password", nargs="?", help="新口令；省略则交互输入（推荐）")
    parser.add_argument("--list", action="store_true", help="列出所有账号后退出")
    args = parser.parse_args()

    core.init_db()

    if args.list:
        return list_accounts()

    email = (args.email or core.CONFIG.get("admin_email") or "").strip()
    if not email:
        print("✗ 没给邮箱，且 config.json 里也没有 admin_email。用 --list 看看有哪些账号。")
        return 2

    user = resolve_account(email)
    if not user:
        print(f"✗ 找不到账号：{email}（用 --list 查看现有账号）")
        return 2

    print(f"目标账号：#{user['id']} {user['email']}（{user['role']} / {user['channel'] or '-'}）")

    password = (args.password or "").strip() or prompt_password()
    if len(password) < MIN_LENGTH:
        print(f"✗ 口令至少 {MIN_LENGTH} 位。")
        return 2

    new_tv = (user["token_version"] or 1) + 1
    core.execute(
        "UPDATE users SET password_hash=?, token_version=? WHERE id=?",
        (core.hash_password(password), new_tv, user["id"]),
    )

    print(f"✓ 口令已更新：{user['email']}")
    print(f"  · 已吊销该账号现有登录凭证（token_version → {new_tv}），需要重新登录")
    sync_config_admin_password(user["email"])
    if str(user["role"]) == "admin":
        print("  · 这是管理员账号，后台「管理端」入口用它登录")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
