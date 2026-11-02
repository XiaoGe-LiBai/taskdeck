"""电脑微信直连提 token。

原理（与开源版一致）：微信 PC 端的小程序运行引擎 `WeChatAppEx.exe` 会把小蚕
小程序的鉴权凭证（JWT）留在进程内存里。直接读进程内存就能拿到 token，
不需要改代理、不装证书、不断网。

两种用法：
1. **服务端就跑在 Windows 上**：调 `scan()` 就地扫描入库（和开源版一样一键完成）；
2. **服务端在 Linux 容器**（本项目的现网形态）：读不到你电脑上的微信进程，
   所以由面板生成 6 位配对码，你在 Windows 上跑 `build_windows_script()` 产出的
   单文件脚本，扫完直接 POST 回来入库。脚本只用标准库，装了 Python 3 就能跑。

注意：读取其他进程内存需要与微信同权限（普通用户即可，管理员更稳）；
仅扫描 `WeChatAppEx.exe` / `wmpf` 进程，不碰聊天数据。
"""
from __future__ import annotations

import base64
import json
import re
import secrets
import sys
import time
from typing import Any

import core

# ---------------------------------------------------------------- 扫描（Windows）

IS_WINDOWS = sys.platform == "win32"

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
MEM_COMMIT = 0x1000
TH32CS_SNAPPROCESS = 0x00000002
READABLE = (0x02, 0x04, 0x20, 0x40)

JWT_RE = re.compile(rb"eyJ[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")
SILK_RE = re.compile(rb'["\']silk_id["\']\s*:\s*(\d{6,12})')
NICK_RE = re.compile(rb'["\']nickname["\']\s*:\s*["\']([^"\']{1,24})["\']')

_kernel32 = None
if IS_WINDOWS:
    import ctypes
    from ctypes import wintypes

    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    class _PROCESSENTRY32(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_void_p),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", ctypes.c_char * 260),
        ]

    class _MEMORY_BASIC_INFORMATION(ctypes.Structure):
        _fields_ = [
            ("BaseAddress", ctypes.c_void_p),
            ("AllocationBase", ctypes.c_void_p),
            ("AllocationProtect", wintypes.DWORD),
            ("RegionSize", ctypes.c_size_t),
            ("State", wintypes.DWORD),
            ("Protect", wintypes.DWORD),
            ("Type", wintypes.DWORD),
        ]


def available() -> bool:
    """服务端能不能就地扫（只有 Windows 部署才可能）。"""
    return bool(IS_WINDOWS)


def _applet_pids() -> list[int]:
    if not IS_WINDOWS or _kernel32 is None:
        return []
    import ctypes

    pids: list[int] = []
    snap = _kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap == -1:
        return pids
    entry = _PROCESSENTRY32()
    entry.dwSize = ctypes.sizeof(_PROCESSENTRY32)
    try:
        if _kernel32.Process32First(snap, ctypes.byref(entry)):
            while True:
                exe = entry.szExeFile.decode("gbk", errors="ignore").lower()
                if "wechatappex" in exe or "wmpf" in exe:
                    pids.append(int(entry.th32ProcessID))
                if not _kernel32.Process32Next(snap, ctypes.byref(entry)):
                    break
    finally:
        _kernel32.CloseHandle(snap)
    return pids


def _jwt_payload(token: str) -> dict:
    try:
        part = token.split(".")[1]
        padded = part + "=" * ((4 - len(part) % 4) % 4)
        return json.loads(base64.urlsafe_b64decode(padded).decode("utf-8", errors="ignore"))
    except Exception:
        return {}


def scan(max_seconds: float = 8.0) -> dict | None:
    """扫描微信小程序进程内存，返回最近可用的凭证；扫不到返回 None。"""
    if not IS_WINDOWS or _kernel32 is None:
        return None
    import ctypes

    pids = _applet_pids()
    if not pids:
        return None

    deadline = time.time() + max_seconds
    mbi_size = ctypes.sizeof(_MEMORY_BASIC_INFORMATION)
    best: dict[str, Any] | None = None

    for pid in pids:
        if time.time() > deadline:
            break
        handle = _kernel32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
        if not handle:
            continue
        try:
            addr = 0
            mbi = _MEMORY_BASIC_INFORMATION()
            while _kernel32.VirtualQueryEx(
                handle, ctypes.c_void_p(addr), ctypes.byref(mbi), mbi_size,
            ) == mbi_size:
                if time.time() > deadline:
                    break
                if mbi.State != MEM_COMMIT or mbi.Protect not in READABLE:
                    addr += mbi.RegionSize or 0x1000
                    continue
                size = int(mbi.RegionSize or 0)
                if not (4096 <= size <= 16 * 1024 * 1024):
                    addr += size or 0x1000
                    continue
                buf = ctypes.create_string_buffer(size)
                read = ctypes.c_size_t()
                if _kernel32.ReadProcessMemory(
                    handle, ctypes.c_void_p(addr), buf, size, ctypes.byref(read),
                ):
                    chunk = buf.raw[: read.value]
                    if b"eyJhbGciOi" in chunk or b"eyJVc2VySWQi" in chunk:
                        cand = _extract(chunk)
                        if cand and (
                            best is None or cand.get("exp", 0) > best.get("exp", 0)
                        ):
                            best = cand
                addr += size or 0x1000
        finally:
            _kernel32.CloseHandle(handle)
        if best:
            break
    return best


def _extract(chunk: bytes) -> dict | None:
    for raw in JWT_RE.findall(chunk):
        token = raw.decode("latin1")
        payload = _jwt_payload(token)
        if not payload.get("UserId"):
            continue
        result = {
            "token": token,
            "user_id": str(payload["UserId"]),
            "exp": int(payload.get("exp") or 0),
            "silk_id": "",
            "nickname": "",
        }
        silk = SILK_RE.search(chunk)
        if silk:
            result["silk_id"] = silk.group(1).decode()
        nick = NICK_RE.search(chunk)
        if nick:
            try:
                result["nickname"] = nick.group(1).decode("utf-8", errors="ignore")
            except Exception:
                result["nickname"] = ""
        return result
    return None


# ---------------------------------------------------------------- 配对码（服务端在 Linux 时用）

_PAIRS: dict[str, dict] = {}
PAIR_TTL = 600


def _gc_pairs() -> None:
    now = time.time()
    for code in [c for c, item in _PAIRS.items() if now - item["created"] > PAIR_TTL * 2]:
        _PAIRS.pop(code, None)


_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 去掉 0/O/1/I 这类易混字符


def _new_code() -> str:
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(10))


def create_pair(user_id: int) -> dict:
    """生成 10 位配对码：Windows 脚本凭它把 token 报到「生成它的这个用户」名下。

    不能用短数字码：report 是匿名接口，码太短会被枚举，等于把别人的 token 交出去。
    """
    _gc_pairs()
    code = _new_code()
    while code in _PAIRS:
        code = _new_code()
    _PAIRS[code] = {
        "user_id": int(user_id),
        "created": time.time(),
        "state": "waiting",
        "account": None,
        "error": "",
    }
    return {"code": code, "expires_in": PAIR_TTL}


def pair_status(code: str, user_id: int) -> dict:
    _gc_pairs()
    item = _PAIRS.get(code)
    if not item or item["user_id"] != int(user_id):
        return {"state": "expired"}
    if time.time() - item["created"] > PAIR_TTL and item["state"] == "waiting":
        return {"state": "expired"}
    return {"state": item["state"], "account": item["account"], "error": item["error"]}


def _safe_account(account: dict | None) -> dict | None:
    """对外只给必要字段：token 已经在库里，没必要再回传给浏览器或脚本。"""
    if not account:
        return account
    return {k: v for k, v in account.items() if k not in ("access_token", "token")}


def report(code: str, payload: dict) -> dict:
    """脚本上报：校验配对码 → 落成标准四段格式 → 入库。"""
    _gc_pairs()
    item = _PAIRS.get(code)
    if not item:
        raise ValueError("配对码无效或已过期，请在面板重新生成")
    if time.time() - item["created"] > PAIR_TTL:
        _PAIRS.pop(code, None)
        raise ValueError("配对码已过期，请在面板重新生成")

    token = str(payload.get("token") or "").strip()
    user_id = str(payload.get("user_id") or "").strip()
    silk_id = str(payload.get("silk_id") or "").strip()
    nickname = str(payload.get("nickname") or "").strip()
    if not token or token.count(".") != 2:
        raise ValueError("上报的 token 不是有效 JWT")
    if not silk_id:
        raise ValueError("缺少 silk_id：请先在电脑微信里打开一次小蚕小程序再重试")

    import xiaocan_bridge

    line = f"{nickname or silk_id[-4:]}#{user_id}#{silk_id}#{token}"
    data = xiaocan_bridge.bind_from_lines(item["user_id"], line)
    raw = data["accounts"][0] if data.get("accounts") else None
    account = _safe_account(raw)
    item["state"] = "done"
    item["account"] = account
    return {"account": account, "errors": data.get("errors", [])}


# ---------------------------------------------------------------- Windows 脚本

_SCRIPT_TEMPLATE = '''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""小蚕·电脑微信直连（由面板生成，一次性配对码已内嵌）。

用法：
  1. 先在电脑微信里打开一次「小蚕霸王餐」小程序（保持窗口开着）
  2. 双击本文件，或在命令行执行： python {filename}
  3. 看到「上报成功」即可回到面板刷新

只读 WeChatAppEx.exe / wmpf 进程内存里的 JWT，不碰聊天记录；
需要 Python 3.8+（Windows 官方安装包即可），不装任何第三方库。
"""
import base64
import ctypes
import json
import re
import sys
import urllib.request
from ctypes import wintypes

BASE = {base!r}
CODE = {code!r}

PROCESS_QUERY_INFORMATION = 0x0400
PROCESS_VM_READ = 0x0010
MEM_COMMIT = 0x1000
TH32CS_SNAPPROCESS = 0x00000002
READABLE = (0x02, 0x04, 0x20, 0x40)

JWT_RE = re.compile(rb"eyJ[A-Za-z0-9_-]{{10,}}\\.ey[A-Za-z0-9_-]{{10,}}\\.[A-Za-z0-9_-]{{10,}}")
SILK_RE = re.compile(rb'["\\\']silk_id["\\\']\\s*:\\s*(\\d{{6,12}})')
NICK_RE = re.compile(rb'["\\\']nickname["\\\']\\s*:\\s*["\\\']([^"\\\']{{1,24}})["\\\']')

k32 = ctypes.WinDLL("kernel32", use_last_error=True)


class PROCESSENTRY32(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_void_p),
        ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD), ("szExeFile", ctypes.c_char * 260),
    ]


class MEMORY_BASIC_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BaseAddress", ctypes.c_void_p), ("AllocationBase", ctypes.c_void_p),
        ("AllocationProtect", wintypes.DWORD), ("RegionSize", ctypes.c_size_t),
        ("State", wintypes.DWORD), ("Protect", wintypes.DWORD), ("Type", wintypes.DWORD),
    ]


def pids():
    out = []
    snap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap == -1:
        return out
    e = PROCESSENTRY32()
    e.dwSize = ctypes.sizeof(PROCESSENTRY32)
    if k32.Process32First(snap, ctypes.byref(e)):
        while True:
            exe = e.szExeFile.decode("gbk", errors="ignore").lower()
            if "wechatappex" in exe or "wmpf" in exe:
                out.append(int(e.th32ProcessID))
            if not k32.Process32Next(snap, ctypes.byref(e)):
                break
    k32.CloseHandle(snap)
    return out


def payload_of(token):
    try:
        part = token.split(".")[1]
        part += "=" * ((4 - len(part) % 4) % 4)
        return json.loads(base64.urlsafe_b64decode(part).decode("utf-8", errors="ignore"))
    except Exception:
        return {{}}


def scan():
    found = []
    size_mbi = ctypes.sizeof(MEMORY_BASIC_INFORMATION)
    for pid in pids():
        h = k32.OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, False, pid)
        if not h:
            continue
        addr = 0
        mbi = MEMORY_BASIC_INFORMATION()
        while k32.VirtualQueryEx(h, ctypes.c_void_p(addr), ctypes.byref(mbi), size_mbi) == size_mbi:
            size = int(mbi.RegionSize or 0)
            if mbi.State == MEM_COMMIT and mbi.Protect in READABLE and 4096 <= size <= 16 * 1024 * 1024:
                buf = ctypes.create_string_buffer(size)
                read = ctypes.c_size_t()
                if k32.ReadProcessMemory(h, ctypes.c_void_p(addr), buf, size, ctypes.byref(read)):
                    chunk = buf.raw[: read.value]
                    if b"eyJhbGciOi" in chunk or b"eyJVc2VySWQi" in chunk:
                        for raw in JWT_RE.findall(chunk):
                            token = raw.decode("latin1")
                            pl = payload_of(token)
                            if not pl.get("UserId"):
                                continue
                            silk = SILK_RE.search(chunk)
                            nick = NICK_RE.search(chunk)
                            found.append({{
                                "token": token,
                                "user_id": str(pl["UserId"]),
                                "exp": int(pl.get("exp") or 0),
                                "silk_id": silk.group(1).decode() if silk else "",
                                "nickname": (nick.group(1).decode("utf-8", errors="ignore") if nick else ""),
                            }})
            addr += size or 0x1000
        k32.CloseHandle(h)
        if found:
            break
    found.sort(key=lambda item: item.get("exp", 0), reverse=True)
    return found[0] if found else None


def main():
    if not pids():
        print("未检测到微信小程序进程：请先在电脑微信里打开「小蚕霸王餐」小程序，然后重试。")
        return 1
    print("正在扫描微信小程序进程内存 …")
    cred = scan()
    if not cred:
        print("没扫到小蚕凭证：请确认小程序已经打开并处于登录状态，再重试。")
        return 1
    if not cred.get("silk_id"):
        print("扫到 token 但缺少 silk_id：在小程序里随便点一个页面后重试。")
        return 1
    body = json.dumps({{"code": CODE, **{{k: cred[k] for k in ("token", "user_id", "silk_id", "nickname")}}}}).encode()
    req = urllib.request.Request(
        BASE.rstrip("/") + "/api/xiaocan/wechat/report",
        data=body,
        headers={{"Content-Type": "application/json"}},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
    except Exception as exc:
        print("上报失败：%s" % exc)
        return 1
    if data.get("code") != 200:
        print("上报失败：%s" % data.get("msg"))
        return 1
    account = (data.get("data") or {{}}).get("account") or {{}}
    print("上报成功：%s（silk_id %s）" % (account.get("nickname") or "小蚕账号", account.get("account_info") or ""))
    print("回到面板刷新即可看到账号。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
'''


def build_windows_script(base_url: str, code: str) -> str:
    """生成内嵌面板地址与配对码的一次性脚本。"""
    return _SCRIPT_TEMPLATE.format(
        base=base_url.rstrip("/"),
        code=code,
        filename=f"wechat_direct_{code}.py",
    )
