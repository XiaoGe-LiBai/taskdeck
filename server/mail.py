"""邮件发送：SMTP 凭据存 settings 表，管理端「系统设置 → 邮件服务」可直接改，
未配置 SMTP 时不会发信；仅显式 mail_dev_mode 才记录正文供隔离联调。

配置读取优先级（先命中先用，逐字段独立回退）：
  1. settings 表   smtp_host / smtp_port / smtp_ssl / smtp_user / smtp_password /
                   smtp_sender / smtp_from_name
  2. config.json   "smtp": {"host","port","ssl","user","password","sender"}
  3. 环境变量      MAIL_SMTP / MAIL_PORT / MAIL_SENDER / MAIL_PASSWORD
                   （对齐「狐蒂云」「算法助手」两个脚本的 .env 口径）

口令只往这些来源读，绝不回传前端：api_admin.settings_get 会把 smtp_password 掩成空串。
"""
from __future__ import annotations

import html
import os
import smtplib
import time
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr

import core

LOG_PATH = os.path.join(core.DATA_DIR, "mail.log")

# 发信失败重试：参考「算法助手」是 3 次 / 间隔 15 秒，那是监控循环里等得起；
# 这里是 HTTP 请求线程，80 秒的重试会把注册请求拖死，所以压缩成 2 次 / 间隔 1 秒。
RETRY_TIMES = 2
RETRY_GAP_SECONDS = 1


def _log(line: str) -> None:
    os.makedirs(core.DATA_DIR, exist_ok=True)
    with open(LOG_PATH, "a", encoding="utf-8") as fh:
        fh.write(f"{core.iso()} {line}\n")


def _env(key: str) -> str:
    return (os.getenv(key) or "").strip().strip('"').strip("'")


def _truthy(value, default: bool = True) -> bool:
    if value is None or value == "":
        return default
    return str(value).strip().lower() not in ("0", "false", "no", "off")


def smtp_config() -> dict:
    """合并三个来源，返回发信所需的一份配置；host 为空表示没配。"""
    legacy = core.CONFIG.get("smtp") or {}
    setting = core.get_setting

    host = setting("smtp_host", "") or legacy.get("host") or _env("MAIL_SMTP")
    ssl_on = _truthy(setting("smtp_ssl", "") or legacy.get("ssl"), True)
    port_raw = setting("smtp_port", "") or legacy.get("port") or _env("MAIL_PORT")
    try:
        port = int(port_raw)
    except (TypeError, ValueError):
        port = 465 if ssl_on else 587

    user = setting("smtp_user", "") or legacy.get("user") or _env("MAIL_SENDER")
    password = setting("smtp_password", "") or legacy.get("password") or _env("MAIL_PASSWORD")
    sender = setting("smtp_sender", "") or legacy.get("sender") or _env("MAIL_SENDER") or user

    return {
        "host": (host or "").strip(),
        "port": port,
        "ssl": ssl_on,
        "user": (user or "").strip(),
        "password": password or "",
        "sender": (sender or "").strip(),
        "from_name": (setting("smtp_from_name", "") or core.site_name()).strip(),
    }


def configured() -> bool:
    cfg = smtp_config()
    return bool(cfg["host"] and cfg["user"] and cfg["password"])


def send_mail(to: str, subject: str, html: str) -> dict:
    """真正发信。返回 {"sent": bool, "dry_run": bool, "error": str}，从不抛异常。

    没配 SMTP 时只写日志（dry_run=True），调用方据此决定是否把验证码回传前端。
    """
    to = (to or "").strip()
    if not to:
        return {"sent": False, "dry_run": False, "error": "收件人为空"}

    cfg = smtp_config()
    if not configured():
        if core.CONFIG.get("mail_dev_mode", False):
            _log(f"[DRY-RUN] to={to} subject={subject}（仅开发模式）")
            _log(f"[DRY-RUN-BODY] {html}")
        else:
            _log("[DISABLED] 未配置 SMTP，邮件未发送，不记录正文")
        return {"sent": False, "dry_run": True, "error": ""}

    msg = MIMEText(html, "html", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = formataddr((str(Header(cfg["from_name"], "utf-8")), cfg["sender"]))
    msg["To"] = to

    last_error = ""
    for attempt in range(1, RETRY_TIMES + 1):
        try:
            if cfg["ssl"]:
                server = smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=20)
            else:
                server = smtplib.SMTP(cfg["host"], cfg["port"], timeout=20)
                server.starttls()
            with server:
                if cfg["user"]:
                    server.login(cfg["user"], cfg["password"])
                server.sendmail(cfg["sender"], [to], msg.as_string())
            _log(f"[SENT] to={to} subject={subject} via={cfg['host']}:{cfg['port']}")
            return {"sent": True, "dry_run": False, "error": ""}
        except Exception as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            _log(f"[FAIL] to={to} attempt={attempt}/{RETRY_TIMES} err={last_error}")
            if attempt < RETRY_TIMES:
                time.sleep(RETRY_GAP_SECONDS)

    return {"sent": False, "dry_run": False, "error": last_error}


# ---------------------------------------------------------------- 邮件模板
#
# 验证码 / 管理员通知 / SMTP 自检三处发信共用这一套骨架，避免风格各自漂移。
#
# 邮件客户端的硬约束（别随手改成 flex / grid / 外部样式表）：
#   - 只能用 table 布局 + 内联 style：Gmail 会剥掉 <style> 和 class，
#     Outlook 用 Word 内核渲染，flex/grid 一律不认
#   - 渐变写在 background-image，同时保留 background-color 兜底
#     （Outlook 不支持 linear-gradient，会回落到底色，不至于变白板）
#   - 抬头 logo 是可选增强：只有「开关打开 + 已上传 + 配了 site_url」才放图，
#     而且带 alt，加载不出来也只是少一张图，不影响读邮件

BRAND_FROM = "#fa8927"
BRAND_VIA = "#fa3569"
BRAND_TO = "#9051e1"
BRAND_GRADIENT = f"linear-gradient(135deg,{BRAND_FROM} 0%,{BRAND_VIA} 52%,{BRAND_TO} 100%)"


def _esc(value) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def logo_url() -> str:
    """
    邮件抬头可用的 logo 绝对地址。

    两个条件缺一不可，否则返回空串走纯样式抬头：自定义图标已启用（含文件存在）、
    配了 site_url。邮件客户端不会替你补相对路径，地址不完整只会得到一个裂图。
    """
    if not core.site_logo_enabled():
        return ""
    base = (core.get_setting("site_url", "") or "").strip().rstrip("/")
    return f"{base}/site-icon" if base else ""


def render_email(*, title: str, body_html: str, intro: str = "", footer_note: str = "") -> str:
    """统一邮件骨架。所有发信都走这里，不要在调用处自己拼 HTML。"""
    name = core.site_name()
    logo = logo_url()

    head_logo = (
        '<td style="padding-right:10px;vertical-align:middle">'
        f'<img src="{_esc(logo)}" width="30" height="30" alt="{_esc(name)}" '
        'style="display:block;width:30px;height:30px;border-radius:8px;background-color:#ffffff;object-fit:cover">'
        '</td>'
    ) if logo else ""

    intro_html = (
        f'<div style="font-size:14px;line-height:1.8;color:#52525b;padding-bottom:16px">{_esc(intro)}</div>'
    ) if intro else ""

    footer_html = (
        f'<div style="font-size:12px;line-height:1.7;color:#a1a1aa;padding-top:18px">{_esc(footer_note)}</div>'
    ) if footer_note else ""

    return f"""\
<div style="margin:0;padding:24px 12px;background-color:#f4f4f5">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
        <tr>
          <td style="background-color:{BRAND_VIA};background-image:{BRAND_GRADIENT};border-radius:14px 14px 0 0;padding:20px 24px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              {head_logo}<td style="vertical-align:middle">
                <div style="font-size:17px;font-weight:700;color:#ffffff">{_esc(name)}</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.85);padding-top:2px">任务托管面板</div>
              </td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="background-color:#ffffff;border-radius:0 0 14px 14px;padding:28px 24px">
            <div style="font-size:18px;font-weight:700;color:#18181b;padding-bottom:14px">{_esc(title)}</div>
            {intro_html}{body_html}{footer_html}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 8px;text-align:center;font-size:12px;color:#a1a1aa;line-height:1.7">
            本邮件由 {_esc(name)} 系统自动发送，请勿直接回复。<br>
            若你不确定这封邮件的来源，忽略它即可。
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</div>"""


def code_html(code: str, minutes: int = 10) -> str:
    """验证码邮件正文。"""
    box = (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background-color:#fff7ed;border:1px dashed #fdba74;border-radius:10px">'
        f'<tr><td style="padding:18px 16px;text-align:center">'
        f'<div style="font-size:12px;color:#9a3412;letter-spacing:2px">验证码</div>'
        f'<div style="font-family:Consolas,Menlo,monospace;font-size:34px;font-weight:700;'
        f'letter-spacing:10px;color:#c2410c;padding:6px 0 2px;text-indent:10px">{_esc(code)}</div>'
        f'<div style="font-size:12px;color:#9a3412">{minutes} 分钟内有效</div>'
        f'</td></tr></table>'
    )
    return render_email(
        title="你的验证码",
        intro=f"请在 {minutes} 分钟内完成验证。为保障账号安全，请勿把验证码转发给任何人。",
        body_html=box,
        footer_note="若不是你本人操作，忽略本邮件即可，你的账号不会有任何变化。",
    )


def notice_html(title: str, content: str) -> str:
    """
    管理员下发通知的邮件正文。

    站内信（user_notifications）与这封邮件共享同一份 title/content，
    所以两边用同一套视觉语言，用户在哪儿看到都认得出来。
    """
    text = _esc(content).replace("\n", "<br>")
    return render_email(
        title="系统通知",
        intro="管理员向你发送了一条通知：",
        body_html=(
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="background-color:#fafafa;border-left:4px solid {BRAND_VIA};border-radius:6px">'
            f'<tr><td style="padding:16px 18px">'
            f'<div style="font-size:16px;font-weight:700;color:#18181b;padding-bottom:8px">{_esc(title)}</div>'
            f'<div style="font-size:14px;line-height:1.8;color:#3f3f46">{text or "（无正文）"}</div>'
            f'</td></tr></table>'
        ),
        footer_note="本条通知同时保存在面板的「消息推送」页面，可随时回来查看。",
    )


def test_html() -> str:
    """SMTP 自检邮件正文。"""
    return render_email(
        title="邮件服务连通正常",
        intro="你收到这封邮件，说明面板的 SMTP 配置可用，注册与找回密码的验证码可以正常发出。",
        body_html=(
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
            f'<tr><td style="padding:14px 16px;background-color:#f0fdf4;border-radius:8px;'
            f'font-size:13px;color:#166534">'
            f'✅ 无需任何操作，这只是一封自检邮件。'
            f'</td></tr></table>'
        ),
        footer_note="可在「系统设置 → 邮件服务」里随时调整发信配置。",
    )


def send_code(email: str, code: str, subject: str = "验证码") -> bool:
    """返回是否真正通过 SMTP 发出。未配置时把邮件内容写进 data/mail.log。"""
    return send_mail(email, subject, code_html(code))["sent"]
