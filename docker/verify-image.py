"""镜像验收：隔离命名卷与随机本机端口，不访问已有部署。

python3 docker/verify-image.py IMAGE [--browser]
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def docker(*args, input=None, check=True, timeout=120):
    result = subprocess.run(["docker", *args], input=input, text=True, capture_output=True,
                            timeout=timeout, check=False)
    if check and result.returncode:
        # 不转储命令输入、容器完整日志或凭据。
        raise RuntimeError(f"Docker {args[0]} 失败：{result.stderr[-1500:]}")
    return result.stdout.strip()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def web(base, path):
    try:
        response = urllib.request.build_opener(NoRedirect).open(base + path, timeout=8)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


def wait_ready(name):
    for _ in range(90):
        info = json.loads(docker("inspect", name))[0]
        if info["State"]["Status"] == "exited":
            raise RuntimeError("容器在就绪前退出，请单独查看脱敏日志")
        ports = info["NetworkSettings"]["Ports"].get("3001/tcp")
        if ports:
            base = "http://127.0.0.1:" + ports[0]["HostPort"]
            try:
                if web(base, "/sign-in")[0] in (200, 307):
                    return base
            except (OSError, urllib.error.URLError):
                pass
        time.sleep(1)
    raise RuntimeError("容器启动超时")


def api(name, path, method="GET", data=None, token=""):
    script = """import json,sys,urllib.request,urllib.error
p=json.load(sys.stdin)
headers={'Content-Type':'application/json'}
if p['token']: headers['Authorization']='Bearer '+p['token']
req=urllib.request.Request('http://127.0.0.1:8100'+p['path'],data=json.dumps(p['data']).encode() if p['data'] is not None else None,headers=headers,method=p['method'])
try: response=urllib.request.urlopen(req,timeout=20)
except urllib.error.HTTPError as error: response=error
raw=response.read()
try: body=json.loads(raw)
except ValueError: body=None
print(json.dumps({'status':response.status,'body':body}))
"""
    return json.loads(docker("exec", "-i", name, "/app/venv/bin/python", "-c", script,
                             input=json.dumps(dict(path=path, method=method, data=data, token=token))))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image")
    parser.add_argument("--browser", action="store_true", help="额外运行本机 Playwright 图标及品牌回归")
    args = parser.parse_args()
    name = "taskdeck-verify-" + secrets.token_hex(5)
    volume = name + "-data"
    email = "verify@example.test"
    password = secrets.token_urlsafe(24)
    rotated = secrets.token_urlsafe(24)
    image = args.image
    docker("volume", "create", volume)

    def admin_env(pw):
        return ["-e", f"PANEL_ADMIN_EMAIL={email}", "-e", f"PANEL_ADMIN_PASSWORD={pw}"]

    def start(*extra):
        docker("run", "-d", "--name", name, "-p", "127.0.0.1::3001", "-v", volume + ":/app/server/data",
               *(["-p", "127.0.0.1::8100"] if args.browser else []), *extra, image)
        return wait_ready(name)

    def run_expecting_failure(*extra):
        result = subprocess.run(["docker", "run", "--rm", "-v", volume + ":/app/server/data", *extra, image],
                                capture_output=True, text=True, timeout=300)
        output = result.stdout + result.stderr
        assert result.returncode != 0, "缺少或非法管理员配置时容器不应成功启动"
        assert "PANEL_ADMIN_EMAIL" in output or "PANEL_ADMIN_PASSWORD" in output, "启动失败时应提示管理员变量"
        return output

    def snapshot():
        script = "import hashlib,pathlib; print(hashlib.sha256(pathlib.Path('/app/server/data/runtime-secrets.json').read_bytes()).hexdigest())"
        return docker("exec", name, "/app/venv/bin/python", "-c", script)

    def login(pw):
        return api(name, "/api/auth/login", "POST", dict(email=email, password=pw))["body"]

    try:
        # 在镜像内而非宿主代码上跑测试，确认发布产物具备同样行为。
        docker("run", "--rm", "--entrypoint", "/app/venv/bin/python", "-w", "/app/server", image,
               "-m", "unittest", "-q", "test_installation", "test_notify", timeout=300)
        # 启动前检查镜像文件系统，不能把本机配置、数据库或生成预览带入产物。
        safety = "from pathlib import Path; root=Path('/app'); forbidden=['server/config.json','server/config.local.json','server/data/panel.db','server/data/runtime-secrets.json','web/.env','web/.env.local','web/public/_preview']; assert not any((root/p).exists() for p in forbidden), '镜像包含本地运行文件'"
        docker("run", "--rm", "--entrypoint", "/app/venv/bin/python", image, "-c", safety)
        print("通过：镜像内离线单测与文件系统检查", flush=True)

        run_expecting_failure()
        run_expecting_failure("-e", f"PANEL_ADMIN_EMAIL={email}", "-e", "PANEL_ADMIN_PASSWORD=short")
        print("通过：空库缺少或非法管理员配置时拒绝启动", flush=True)

        base = start(*admin_env(password))
        assert login(password)["code"] == 200, "环境变量配置的管理员应能登录"
        assert api(name, "/api/setup")["body"]["code"] == 404, "不应再存在安装接口"
        assert web(base, "/setup")[0] == 404, "不应再存在安装页"
        assert "初始化码" not in docker("logs", name)
        assert api(name, "/api/auth/register", "POST", {})["body"]["code"] != 200
        keys = snapshot()
        token = login(password)["data"]["access_token"]
        print("通过：按部署变量创建管理员、无安装入口、正式邮件禁回显", flush=True)

        assert api(name, "/api/admin/settings", "PUT", {"site_name": "部署回归站点"}, token)["body"]["code"] == 200

        if args.browser:
            browser_env = {**os.environ, "TEST_NO_SCREENSHOTS": "1", "TEST_ADMIN_EMAIL": email, "TEST_ADMIN_PASSWORD": password}
            api_base = "http://127.0.0.1:" + json.loads(docker("inspect", name))[0]["NetworkSettings"]["Ports"]["8100/tcp"][0]["HostPort"]
            # 图标脚本要求初始为「未上传」状态，所以必须在下面用 API 上传之前跑。
            subprocess.run(["node", "scripts/verify-site-logo.mjs", base], cwd=ROOT / "web", env=browser_env, check=True, timeout=120)
            subprocess.run(["node", "scripts/verify-password-change.mjs", base, api_base], cwd=ROOT / "web", env=browser_env, check=True, timeout=120)
            subprocess.run(["node", "scripts/verify-branding.mjs", base, api_base], cwd=ROOT / "web", env=browser_env, check=True, timeout=120)

        upload_script = """import io,json,sys,requests
from PIL import Image
p=json.load(sys.stdin); image=Image.new('RGB',(480,180),'orange'); buf=io.BytesIO(); image.save(buf,format='PNG')
r=requests.post('http://127.0.0.1:8100/api/admin/site-logo',headers={'Authorization':'Bearer '+p['token']},files={'file':('logo.png',buf.getvalue(),'image/png')},timeout=15)
print(r.text)
"""
        uploaded = json.loads(docker("exec", "-i", name, "/app/venv/bin/python", "-c", upload_script,
                                     input=json.dumps({"token": token})))
        assert uploaded["code"] == 200 and uploaded["data"]["width"] == 256, "图标上传失败"
        logo = web(base, "/site-icon")[2]

        docker("stop", "-t", "15", name)
        assert json.loads(docker("inspect", name))[0]["State"]["ExitCode"] == 0
        docker("rm", name)

        base = start(*admin_env(password))
        assert login(password)["code"] == 200, "重建后管理员应仍然存在"
        assert api(name, "/api/auth/profile", token=token)["body"]["code"] == 200, "口令未变时旧会话应继续有效"
        assert snapshot() == keys, "重建不得更换运行密钥"
        assert api(name, "/api/site-info")["body"]["data"]["site_name"] == "部署回归站点"
        assert web(base, "/site-icon")[2] == logo, "重建后图标应保持一致"
        print("通过：重建保留管理员、会话、运行密钥、站名和图标", flush=True)

        docker("stop", "-t", "15", name)
        docker("rm", name)
        base = start(*admin_env(rotated))
        assert login(password)["code"] != 200, "改口令后旧口令必须失效"
        assert api(name, "/api/auth/profile", token=token)["body"]["code"] == 401, "改口令后旧会话必须失效"
        token = login(rotated)["data"]["access_token"]
        assert api(name, "/api/auth/profile", token=token)["body"]["code"] == 200
        assert rotated not in docker("logs", name), "日志不得出现管理员口令"
        docker("stop", "-t", "15", name)
        docker("rm", name)

        base = start()
        assert login(rotated)["code"] == 200, "去掉管理员变量后应沿用库里已有口令"
        assert web(base, "/site-icon")[2] == logo
        print("通过：改口令即同步并吊销旧会话、移除变量后仍可登录", flush=True)

        # 前端退出，入口应关闭后端并以非零状态结束；不接受半死容器。
        killer = "import os,signal,pathlib; [os.kill(int(p.name),signal.SIGTERM) for p in pathlib.Path('/proc').iterdir() if p.name.isdigit() and (p/'comm').exists() and (p/'comm').read_text().strip().startswith('next-server')]"
        docker("exec", name, "/app/venv/bin/python", "-c", killer)
        assert int(docker("wait", name, timeout=40)) != 0
        docker("rm", name)
        print("通过：子进程故障传播及正常停止", flush=True)

        # 换成宿主自定义 UID/GID，仍可读取全部持久化状态。
        docker("run", "--rm", "--user", "0:0", "--entrypoint", "chown", "-v", volume + ":/app/server/data",
               image, "-R", "12345:12345", "/app/server/data")
        base = start("--user", "12345:12345")
        assert login(rotated)["code"] == 200
        assert snapshot() == keys
        assert web(base, "/site-icon")[2] == logo
        print("通过：自定义非 root UID/GID 读取持久化数据", flush=True)
        print("镜像验收全部通过：" + image, flush=True)
    finally:
        docker("rm", "-f", name, check=False)
        docker("volume", "rm", volume, check=False)


if __name__ == "__main__":
    main()
