"""镜像验收：隔离命名卷与随机本机端口，不访问已有部署。

python3 docker/verify-image.py IMAGE [--browser]
"""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import re
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
    parser.add_argument("--browser", action="store_true", help="额外运行本机 Playwright 安装及品牌回归")
    args = parser.parse_args()
    name = "taskdeck-verify-" + secrets.token_hex(5)
    volume = name + "-data"
    password = secrets.token_urlsafe(24)
    email = "verify@example.test"
    image = args.image
    docker("volume", "create", volume)

    def start(*extra):
        api_ports = ["-p", "127.0.0.1::8100"] if args.browser else []
        docker("run", "-d", "--name", name, "-p", "127.0.0.1::3001", "-v", volume + ":/app/server/data",
               *api_ports, *extra, image)
        return wait_ready(name)

    def snapshot():
        script = "import hashlib,pathlib; print(hashlib.sha256(pathlib.Path('/app/server/data/runtime-secrets.json').read_bytes()).hexdigest())"
        return docker("exec", name, "/app/venv/bin/python", "-c", script)

    try:
        # 在启动前检查镜像文件系统，不能把本机配置、数据库或生成预览带入产物。
        safety = "from pathlib import Path; root=Path('/app'); forbidden=['server/config.json','server/config.local.json','server/data/panel.db','server/data/runtime-secrets.json','web/.env','web/.env.local','web/public/_preview']; assert not any((root/p).exists() for p in forbidden), '镜像包含本地运行文件'"
        docker("run", "--rm", "--entrypoint", "/app/venv/bin/python", image, "-c", safety)
        # 运行镜像内而非宿主代码，验证发布产物具备同样的行为。
        tests = docker("run", "--rm", "--entrypoint", "/app/venv/bin/python", "-w", "/app/server", image,
                       "test_installation.py")
        assert "FAILED" not in tests
        print("通过：镜像内离线安装/密钥/邮件单测", flush=True)
        base = start()
        assert api(name, "/api/setup")["body"]["data"] == {"initialized": False}
        assert api(name, "/api/auth/register", "POST", {})["status"] == 503
        assert web(base, "/sign-in")[1].get("Location", "").endswith("/setup")
        page = web(base, "/setup")[2].decode()
        logs = docker("logs", name)
        code = re.search(r"一次性初始化码：([^\s]+)", logs).group(1)
        assert code not in page
        keys = snapshot()
        payload = dict(setup_code=code, email=email, password=password, confirm_password=password)
        assert api(name, "/api/setup", "POST", {**payload, "setup_code": "wrong"})["status"] == 403
        # 启动第二次但尚未安装，安装码也不得变化。
        docker("restart", "-t", "10", name)
        base = wait_ready(name)
        assert snapshot() == keys
        assert re.search(r"一次性初始化码：([^\s]+)", docker("logs", name)).group(1) == code
        browser_env = {**os.environ, "TEST_NO_SCREENSHOTS": "1", "TEST_SETUP_CODE": code, "TEST_ADMIN_EMAIL": email, "TEST_ADMIN_PASSWORD": password}
        if args.browser:
            subprocess.run(["node", "scripts/verify-installation.mjs", base], cwd=ROOT / "web", env=browser_env, check=True, timeout=120)
        else:
            assert api(name, "/api/setup", "POST", payload)["status"] == 200
        assert api(name, "/api/setup", "POST", payload)["status"] == 409
        login = api(name, "/api/auth/login", "POST", dict(email=email, password=password))["body"]
        assert login["code"] == 200 and login["data"]["user"]["role"] == "admin"
        token = login["data"]["access_token"]
        assert web(base, "/setup")[1].get("Location", "").endswith("/sign-in")
        assert api(name, "/api/auth/reset-password", "POST", {"email": email})["body"]["code"] != 200
        print("通过：首次安装、错误码拦截、登录、重复安装关闭、正式邮件禁回显", flush=True)

        if args.browser:
            subprocess.run(["node", "scripts/verify-site-logo.mjs", base], cwd=ROOT / "web", env=browser_env, check=True, timeout=120)
            info = json.loads(docker("inspect", name))[0]
            api_base = "http://127.0.0.1:" + info["NetworkSettings"]["Ports"]["8100/tcp"][0]["HostPort"]
            subprocess.run(["node", "scripts/verify-branding.mjs", base, api_base], cwd=ROOT / "web", env=browser_env, check=True, timeout=120)

        assert api(name, "/api/admin/settings", "PUT", {"site_name": "安装回归站点", "site_url": "https://example.test"}, token)["body"]["code"] == 200
        # 通过实际上传 API 保存横向 PNG，并检查站点图标代理。
        upload_script = """import base64,io,json,sys,requests
from PIL import Image
p=json.load(sys.stdin); image=Image.new('RGB',(480,180),'orange'); buf=io.BytesIO(); image.save(buf,format='PNG')
r=requests.post('http://127.0.0.1:8100/api/admin/site-logo',headers={'Authorization':'Bearer '+p['token']},files={'file':('logo.png',buf.getvalue(),'image/png')},timeout=15)
print(r.text)
"""
        uploaded = json.loads(docker("exec", "-i", name, "/app/venv/bin/python", "-c", upload_script, input=json.dumps({"token": token})))
        assert uploaded["code"] == 200, "图标上传失败"
        assert uploaded["data"]["width"] == 256 and uploaded["data"]["height"] == 96
        assert web(base, "/site-icon")[2].startswith(b"\x89PNG")
        logo = web(base, "/site-icon")[2]
        docker("stop", "-t", "15", name)
        assert json.loads(docker("inspect", name))[0]["State"]["ExitCode"] == 0
        docker("rm", name)
        # 换一组环境变量重建，已有管理员必须不受影响。
        base = start("-e", "PANEL_ADMIN_EMAIL=changed@example.test", "-e", "PANEL_ADMIN_PASSWORD=invalid")
        assert snapshot() == keys
        assert api(name, "/api/auth/profile", token=token)["body"]["code"] == 200
        assert api(name, "/api/site-info")["body"]["data"]["site_name"] == "安装回归站点"
        assert web(base, "/site-icon")[2] == logo
        assert api(name, "/api/setup")["body"]["data"]["initialized"] is True
        print("通过：容器重建保留管理员、JWT、运行密钥、站名和图标", flush=True)

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
        assert snapshot() == keys
        assert api(name, "/api/auth/profile", token=token)["body"]["code"] == 200
        assert web(base, "/site-icon")[2] == logo
        print("通过：自定义非 root UID/GID 读取持久化数据", flush=True)
        docker("stop", "-t", "15", name)
        docker("rm", name)
        base = start("--user", "12345:12345", "-e", "PANEL_DATA_DIR=/tmp/isolated-first-install",
                     "-e", "PANEL_ADMIN_EMAIL=" + email, "-e", "PANEL_ADMIN_PASSWORD=" + password)
        assert api(name, "/api/setup")["body"]["data"]["initialized"] is True
        assert api(name, "/api/auth/login", "POST", dict(email=email, password=password))["body"]["code"] == 200
        assert "一次性初始化码" not in docker("logs", name)
        print("通过：自定义 UID 空目录与环境变量无人值守初始化", flush=True)
        print("镜像验收全部通过：" + image, flush=True)
    finally:
        docker("rm", "-f", name, check=False)
        docker("volume", "rm", volume, check=False)


if __name__ == "__main__":
    main()
