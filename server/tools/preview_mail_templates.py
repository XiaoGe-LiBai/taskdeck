"""生成邮件模板预览页，方便在浏览器里核对样式（调邮件模板时用）。

用法：
    cd server && python3 tools/preview_mail_templates.py

输出到 ../web/public/_preview/*.html —— 该目录是本机调试用的临时产物，
已加进 web/.gitignore，不会被提交。看的时候随便起个静态服务即可：

    cd web && python3 -m http.server 8099 --directory public
    # 浏览器打开 http://127.0.0.1:8099/_preview/

为什么要单独做预览：邮件正文只能在邮件客户端里渲染，靠读 Python 字符串
调样式太痛苦（一个 <td> 少个属性整封就塌）。先用浏览器把结构看对，
再去真机上验证兼容性。
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import mail  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent.parent.parent / "web" / "public" / "_preview"


def page(title: str, caption: str, subject: str, inner: str) -> str:
    """把邮件正文套进一个模拟邮件客户端的白底容器里展示。

    这里刻意**不**复用 mail.render_email，因为那才是被观察的对象；
    外面这层只是模拟 Gmail 那种「白底卡片 + 顶部收发件信息」的样子。
    """
    cfg = mail.smtp_config()
    sender = f"{cfg['from_name']} &#60;{cfg['sender'] or '（未配置 SMTP）'}&#62;"

    return f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title></head>
<body style="margin:0;background:#eef0f3;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif">
<div style="max-width:760px;margin:0 auto;padding:20px">
  <div style="margin-bottom:14px;font:600 13px/1.6 sans-serif;color:#6b7280">{caption}</div>
  <div style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
    <div style="padding:14px 18px;border-bottom:1px solid #eceef1;font-size:13px;color:#374151;line-height:1.9">
      <div><span style="color:#9ca3af">发件人：</span>{sender}</div>
      <div><span style="color:#9ca3af">主题：</span>{subject}</div>
      <div><span style="color:#9ca3af">收件人：</span>user@example.com</div>
    </div>
    <div style="background:#eef0f3">{inner}</div>
  </div>
</div></body></html>"""


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    notice_title = "🎁 恭喜获得系统赠送福利"
    notice_body = "系统管理员已为您赠送了 30 天 VIP2 会员、2 个车位数！祝您使用愉快。\n备注：新用户回馈"

    cases = [
        ("mail", "验证码邮件（注册 / 找回密码 / 换绑邮箱）", "注册验证码 · 托管鸭", mail.code_html("483920", 10)),
        ("notice", "通知邮件（管理员下发通知时勾选「同时发邮件」）", f"【系统通知】{notice_title}",
         mail.notice_html(notice_title, notice_body)),
        ("test", "SMTP 自检邮件（设置页「发送测试邮件」）", "【自检】邮件服务连通测试", mail.test_html()),
    ]

    for key, caption, subject, body in cases:
        path = OUT / f"{key}.html"
        path.write_text(page(f"{key} · 邮件模板预览", caption, subject, body), encoding="utf-8")
        print(f"  {path.name}")

    print(f"\n输出目录：{OUT}")
    print("起个静态服务看：cd web && python3 -m http.server 8099 --directory public")


if __name__ == "__main__":
    main()
