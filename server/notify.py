"""多渠道通知：把管理员关心的事件推到 IM 机器人 / 自定义 Webhook。

设计要点：
- 每个渠道的「配置从哪来」「报文长什么样」都是纯函数，便于离线单测（见 test_notify.py）；
- 配置存 settings 表 `notify_<渠道>_<字段>`，缺必填字段 = 该渠道未启用，不影响其它渠道；
- 发送永不抛异常：面板的核心业务不能因为一个机器人挂了而失败，失败只写 data/notify.log；
- 密钥类字段（钉钉 secret、Telegram token、Webhook token）不回传前端，只回 `_set` 标记。

目前支持：企业微信机器人 / 钉钉机器人 / 飞书机器人 / Bark / Server酱 / Telegram / 自定义 Webhook。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import threading
import time
import urllib.parse
from typing import Any

import requests

import core

LOG_PATH = os.path.join(core.DATA_DIR, "notify.log")
TIMEOUT = (3.05, 8)  # (连接, 读取)：机器人接口慢不该拖住请求

# 渠道定义：fields 里的字段都会落成 settings 键 notify_<渠道>_<字段>
CHANNELS: dict[str, dict[str, Any]] = {
    "wecom": {
        "label": "企业微信机器人",
        "fields": ("url",),
        "required": ("url",),
        "secret_fields": (),
        "hint": "群机器人 Webhook：https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...",
    },
    "dingtalk": {
        "label": "钉钉机器人",
        "fields": ("url", "secret"),
        "required": ("url",),
        "secret_fields": ("secret",),
        "hint": "Webhook 地址；群机器人开了「加签」时把密钥填到 secret",
    },
    "feishu": {
        "label": "飞书机器人",
        "fields": ("url",),
        "required": ("url",),
        "secret_fields": (),
        "hint": "自定义机器人 Webhook：https://open.feishu.cn/open-apis/bot/v2/hook/...",
    },
    "bark": {
        "label": "Bark（iOS）",
        "fields": ("url",),
        "required": ("url",),
        "secret_fields": (),
        "hint": "https://api.day.app/你的Key，或自建服务地址",
    },
    "serverchan": {
        "label": "Server酱",
        "fields": ("url",),
        "required": ("url",),
        "secret_fields": (),
        "hint": "Turbo 版 SendKey（SCT 开头），也接受完整 .send 地址",
    },
    "telegram": {
        "label": "Telegram",
        "fields": ("token", "chat_id"),
        "required": ("token", "chat_id"),
        "secret_fields": ("token",),
        "hint": "Bot Token 与 Chat ID；直连 api.telegram.org",
    },
    "webhook": {
        "label": "自定义 Webhook",
        "fields": ("url", "token"),
        "required": ("url",),
        "secret_fields": ("token",),
        "hint": "POST JSON：{event,title,content,time}；token 非空时带 Authorization: Bearer",
    },
}


def setting_key(channel: str, field: str) -> str:
    return f"notify_{channel}_{field}"


def _config(channel: str) -> dict[str, str]:
    spec = CHANNELS[channel]
    return {field: str(core.get_setting(setting_key(channel, field), "") or "").strip()
            for field in spec["fields"]}


def configured(channel: str) -> bool:
    """必填字段齐全才算启用。"""
    if channel not in CHANNELS:
        return False
    cfg = _config(channel)
    return all(cfg.get(field) for field in CHANNELS[channel]["required"])


def enabled_channels() -> list[str]:
    return [name for name in CHANNELS if configured(name)]


# ---------------------------------------------------------------- 报文构造（纯函数）

def _dingtalk_url(url: str, secret: str) -> str:
    """加签：sign = base64(hmac_sha256(secret, f"{ts}\\n{secret}"))，附带 timestamp 与 sign。"""
    if not secret:
        return url
    ts = str(int(time.time() * 1000))
    digest = hmac.new(secret.encode("utf-8"), f"{ts}\n{secret}".encode("utf-8"), hashlib.sha256).digest()
    sign = urllib.parse.quote_plus(base64.b64encode(digest))
    joiner = "&" if "?" in url else "?"
    return f"{url}{joiner}timestamp={ts}&sign={sign}"


def build_request(channel: str, cfg: dict[str, str], title: str, content: str) -> dict[str, Any]:
    """返回 {method, url, kwargs}，不发起网络请求。"""
    text = f"{title}\n{content}" if content else title
    if channel == "wecom":
        return {"method": "POST", "url": cfg["url"],
                "kwargs": {"json": {"msgtype": "markdown", "markdown": {"content": text}}}}
    if channel == "dingtalk":
        return {"method": "POST", "url": _dingtalk_url(cfg["url"], cfg.get("secret", "")),
                "kwargs": {"json": {"msgtype": "markdown",
                                    "markdown": {"title": title, "text": text}}}}
    if channel == "feishu":
        return {"method": "POST", "url": cfg["url"],
                "kwargs": {"json": {"msg_type": "text", "content": {"text": text}}}}
    if channel == "bark":
        base = cfg["url"].rstrip("/")
        url = f"{base}/{urllib.parse.quote(title, safe='')}/{urllib.parse.quote(content, safe='')}"
        return {"method": "GET", "url": url, "kwargs": {"params": {"group": "托管鸭"}}}
    if channel == "serverchan":
        key = cfg["url"]
        url = key if key.startswith("http") else f"https://sctapi.ftqq.com/{key}.send"
        return {"method": "POST", "url": url,
                "kwargs": {"data": {"title": title, "desp": content or title}}}
    if channel == "telegram":
        url = f"https://api.telegram.org/bot{cfg['token']}/sendMessage"
        return {"method": "POST", "url": url,
                "kwargs": {"json": {"chat_id": cfg["chat_id"], "text": text,
                                    "disable_web_page_preview": True}}}
    if channel == "webhook":
        headers = {"Content-Type": "application/json"}
        if cfg.get("token"):
            headers["Authorization"] = f"Bearer {cfg['token']}"
        body = {"event": "panel.notify", "title": title, "content": content,
                "time": core.iso()}
        return {"method": "POST", "url": cfg["url"], "kwargs": {"headers": headers, "json": body}}
    raise KeyError(channel)


def _ok(channel: str, payload: Any) -> tuple[bool, str]:
    """各机器人 HTTP 200 也可能带业务错误码，这里统一判一次。"""
    if not isinstance(payload, dict):
        return True, ""
    code = payload.get("errcode", payload.get("code", payload.get("StatusCode", 0)))
    if payload.get("ok") is False or code not in (0, None, "0"):
        return False, json.dumps(payload, ensure_ascii=False)[:300]
    return True, ""


def _log(line: str) -> None:
    try:
        os.makedirs(core.DATA_DIR, exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(f"{core.iso()} {line}\n")
    except OSError:
        pass


def send(channel: str, title: str, content: str = "") -> dict[str, Any]:
    """发一条到指定渠道；永不抛异常。"""
    if channel not in CHANNELS:
        return {"channel": channel, "sent": False, "error": "未知渠道"}
    if not configured(channel):
        return {"channel": channel, "sent": False, "error": "未配置"}
    try:
        request = build_request(channel, _config(channel), title, content)
        resp = requests.request(request["method"], request["url"], timeout=TIMEOUT,
                                **request["kwargs"])
        try:
            payload = resp.json()
        except ValueError:
            payload = None
        ok, detail = _ok(channel, payload)
        if resp.status_code >= 400:
            ok, detail = False, f"HTTP {resp.status_code} {str(payload)[:200]}"
    except Exception as exc:  # 网络/URL/编码问题都不该冒泡到业务
        ok, detail = False, f"{type(exc).__name__}: {exc}"
    if not ok:
        _log(f"[FAIL] channel={channel} title={title} err={detail}")
        return {"channel": channel, "sent": False, "error": detail}
    _log(f"[SENT] channel={channel} title={title}")
    return {"channel": channel, "sent": True, "error": ""}


def send_all(title: str, content: str = "") -> list[dict[str, Any]]:
    """发给所有已配置渠道；返回每个渠道的结果。"""
    return [send(name, title, content) for name in enabled_channels()]


def notify_async(title: str, content: str = "") -> None:
    """业务事件用：没有渠道配置时零开销，有则丢到后台线程，不阻塞请求。"""
    if not enabled_channels():
        return
    threading.Thread(target=send_all, args=(title, content), daemon=True).start()
