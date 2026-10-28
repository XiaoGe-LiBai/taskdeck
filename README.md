# 任务托管平台 · 项目总览

任务托管面板：用户端 + 管理后台（Next.js）+ 后端 API（Flask）+ 青龙面板/应用宝对接。

## 架构

```
浏览器 → web  (Next.js 16, 端口 3001, 唯一 UI)
              │  HTTP /api/*  (PANEL_API_URL, 见 web/.env)
              ▼
          server (Flask, 端口 8100, 全部业务逻辑与数据)
              ├─ data/panel.db   SQLite 生产库
              ├─ ql_client         → 青龙网页 API (127.0.0.1:5700)
              ├─ qinglong_client   → 青龙 OpenAPI (/open/*)
              └─ yyb_client        → 应用宝 YYB-Go  (127.0.0.1:5844)
```

前后端分离：`web` 与 `server` 只通过 HTTP 通信，改前端不动后端、改后端不动前端。
Flask 只对外提供 `/api/*`（外加 `/healthz` 探活），不再托管任何页面或静态资源。

## 目录

```
taskdeck/
├─ web/         Next.js 前端（端口 3001）——所有页面与交互在这里
├─ server/      Flask 后端（端口 8100）——数据库、鉴权、青龙/应用宝对接、脚本绑定矩阵
├─ repos/       外部脚本仓库（submodule）
│  ├─ yyb-go-script-i/    应用宝微信小程序脚本（server/bindings.py 的路径映射指向这里）
│  └─ yyb-go-enhanced/    应用宝服务端
├─ docs/        接口规格与验证脚本（本地保留，不入库）
├─ screenshots/ 站点截图
├─ archive/     已退役的老版前端与缓存
├─ .gitignore   忽略敏感配置与运行时数据（务必保留）
└─ README.md    本文件
```

## 启动

```bash
# 1. 后端（先起）
cd server && ./run.sh              # http://0.0.0.0:8100（端口取 server/config.json）

# 2. 前端
cd web && npm ci && npm run dev    # 开发 http://localhost:3000（占用时换 3001）
cd web && npm run build && npx next start -p 3001   # 生产
```

默认管理员：`admin@example.com / admin12345`（配置在 `server/config.json`，**仅首次建库时使用**）。

**上线前必须改口令**（不用删库）：

```bash
cd server && python3 tools/set_admin_password.py
```

## 敏感配置（重要）

`server/config.json` 含 JWT secret、runner key、应用宝与青龙凭据；`server/data/panel.db`
含用户口令哈希、第三方 access_token、YYB 凭据。这些**只能留在本机**，根目录 `.gitignore` 已把它们全部排除。

配置三级合并，后者覆盖前者：

```
DEFAULT_CONFIG ← config.json ← config.local.json ← 环境变量
```

- 想收紧凭据：把密码类字段挪到 `server/config.local.json`（已忽略），或用环境变量
  （`PANEL_ADMIN_PASSWORD`、`YYB_PASSWORD`、`QL_CLIENT_SECRET`…完整清单见 `server/config.example.json`）。
- 另有一份 `server/config.example.json` 模板，含全部可配项说明，是可以提交的。

## 改动须知

- **改页面/样式/交互** → 只动 `web/`；**改数据/脚本规则/对接** → 只动 `server/`。
- `server/bindings.py` 顶部的 `DEFAULT_REPO_MAP` 与模糊兜底路径指向
  `repos/yyb-go-script-i`，**移动 repos 目录必须同步改**。
- `server/data/panel.db` 是生产库，删除前先备份。
- 端口口径只有一个来源：`server/config.json` 的 `port`（默认 8100），`web/.env` 的
  `PANEL_API_URL` 与它保持一致。

## 邮件服务

注册 / 找回密码的邮箱验证码由 `server/mail.py` 发出，SMTP 凭据存在数据库 `settings` 表，
**在后台「系统设置 → 邮件服务」里填**（`smtp_host` 留空 = 关闭发信），不用改任何文件。
邮箱服务商 → 主机对应关系：126 用 `smtp.126.com`、QQ 用 `smtp.qq.com`，端口 465 + SSL，密码填**授权码**。
填完点「发送测试邮件」自检，失败会把 SMTP 原始报错显示在页面上。

未配 SMTP 时不会真发信：邮件正文写 `server/data/mail.log`，验证码回传前端并在注册页提示「开发模式」，
所以本地联调不需要邮箱也能走完注册。详见 `server/README.md` 的「邮件服务」一节。

## Docker（单镜像，推荐测试用）

一个容器同时跑 Next.js（对外 3001）和 Flask（容器内 8100），无需额外依赖。
镜像由 `.github/workflows/docker-publish.yml` 在 push 到 `main` 时自动构建并推送到 GHCR。

```bash
# 镜像地址（GHCR，全小写）
docker pull ghcr.io/xiaoge-libai/taskdeck:latest

docker run -d --name xiaocan-panel \
  -p 3001:3001 \
  -v xiaocan-data:/app/server/data \
  -e PANEL_ADMIN_PASSWORD='上线前务必改掉' \
  ghcr.io/xiaoge-libai/taskdeck:latest
```

打开 `http://localhost:3001`。首次启动会用 `server/config.example.json` 生成
`server/config.json`，默认管理员 `admin@example.com / admin12345`（仅首次建库生效，
`PANEL_ADMIN_PASSWORD` 可覆盖）。

常用环境变量（完整清单见 `server/config.example.json` 顶部）：

| 变量 | 作用 |
|---|---|
| `PANEL_ADMIN_EMAIL` / `PANEL_ADMIN_PASSWORD` | 首次建库的管理员账号口令 |
| `PANEL_SECRET_KEY` | JWT 签名密钥，不设则自动生成并写回 config.json |
| `PANEL_RUNNER_KEY` | 青龙 runner 回调本站的内部密钥 |
| `YYB_URL` / `YYB_USERNAME` / `YYB_PASSWORD` | 应用宝 YYB-Go 对接 |
| `QL_URL` / `QL_CLIENT_ID` / `QL_CLIENT_SECRET` | 青龙面板对接 |
| `WORKERS` / `THREADS` | gunicorn 进程/线程数，默认 1/4（扫码会话存在进程内缓存，勿轻易加 worker） |

数据持久化：SQLite 库、上传的图标、日志都在 `/app/server/data`，务必挂 volume。

本地构建与编排：

```bash
docker build -t xiaocan-panel .
docker compose up -d --build    # 见 docker-compose.yml
```

需要 ARM 镜像（树莓派/NAS）时，把 workflow 里的 `platforms` 改成
`linux/amd64,linux/arm64`。

> `docs/` 含抓包 token 与明文账号密码，已在 `.gitignore` 中排除，不入公开仓库；
> `repos/` 是上游公开仓库的 submodule，clone 时用 `git clone --recursive`。

