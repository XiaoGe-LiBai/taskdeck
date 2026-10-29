# 托管鸭 · 任务托管平台

Next.js 用户端与管理后台 + Flask/SQLite API，对接青龙面板与应用宝。

> **升级前备份整个数据目录。** 管理员在部署命令里配置，没有默认账号或默认密码；已存在的管理员不会被静默替换。镜像目前提供 `linux/amd64`，ARM 设备不应直接照搬本说明。

## Docker 快速部署

```bash
docker run -d --name taskdeck --restart unless-stopped \
  -p 3001:3001 \
  -e PANEL_ADMIN_EMAIL=you@example.com \
  -e PANEL_ADMIN_PASSWORD='换成长口令，12～128 位' \
  -v xiaocan-data:/app/server/data \
  ghcr.io/xiaoge-libai/taskdeck:latest
```

1. 打开 `http://服务器地址:3001`，用上面的邮箱和口令登录。
2. 在「系统设置」配置站名、站点图标、站点地址和 SMTP；设置 `site_url` 后邮件才能使用绝对图标地址。

管理员规则（`server/bootstrap.py`）：

| 情形 | 行为 |
|---|---|
| 空库 + 两个变量齐全且合规 | 创建管理员 |
| 空库 + 缺变量 / 口令不足 12 位 / 常见默认口令 | **拒绝启动**，日志提示原因 |
| 已有管理员 + 口令变量相同 | 什么都不做，会话保持有效 |
| 已有管理员 + 口令变量不同 | 同步为新口令并吊销旧会话（改密码 = 改命令后重启） |
| 已有管理员 + 未给口令变量 | 沿用库里现有口令 |

`PANEL_ADMIN_EMAIL` 只在创建时使用；管理员已存在时改邮箱请在后台操作，容器日志会提示忽略。口令变量是唯一事实，因此在后台改的密码会在下次重启时被部署变量覆盖——要么长期用变量管理口令，要么设置一次后把变量从命令里删掉。

也可使用仓库自带编排（先 `cp .env.example .env` 并填好两个变量，`.env` 已被忽略）：

```bash
git clone --recurse-submodules git@github.com:XiaoGe-LiBai/taskdeck.git
cd taskdeck
docker compose pull
docker compose up -d
docker compose logs xiaocan-panel
```

只默认映射网页端口 `3001`。后端 `8100` 在容器内使用；需要青龙 runner 回调时，通过受控反向代理转发对应 `/api/runner/*`，或按实际网络单独配置后端映射和访问限制。**容器中的 `127.0.0.1` 指向容器自身**，对接外部青龙/应用宝时填写实际可达地址。

## 数据持久化与升级

必须挂载 **整个 `/app/server/data`**，不是只挂数据库文件：

| 内容 | 用途 |
|---|---|
| `panel.db` 及 SQLite 伴随文件 | 用户、业务数据、系统设置、安装状态 |
| `uploads/` | 上传的站点图标 |
| `runtime-secrets.json` | 自动生成的 JWT 和 runner 密钥 |
| 日志 | 运行记录，可能涉及敏感信息，应限制访问 |

正常停止容器后备份整个卷，升级时保留相同卷；不要执行 `docker compose down -v`。重建不会重置管理员、图标或自动密钥。运行密钥文件损坏会拒绝启动，应从备份恢复，**不要通过删除密钥文件尝试修复**。

旧部署：保留原数据目录；若原 `config.json`/`config.local.json` 有密钥，第一次升级时继续只读挂载旧配置，以迁入数据卷并保持登录和 runner 兼容。环境变量密钥优先级最高，但不会写回文件；使用它们的部署必须每次启动继续提供相同值。

### 使用宿主目录和非 root 用户

默认用户为 `10001:10001`，新命名卷自动采用镜像目录权限。宿主目录推荐显式匹配 UID/GID：

```bash
install -d -m 700 ./data
docker run -d --name taskdeck --restart unless-stopped \
  --user "$(id -u):$(id -g)" \
  -p 3001:3001 -v "$PWD/data:/app/server/data" \
  ghcr.io/xiaoge-libai/taskdeck:latest
```

已有卷更换 UID/GID 前，先停容器并正确迁移目录所有权；不要 `chmod 777`。Compose 改用宿主目录时，也需将 `user` 和目录所有者匹配。

## 配置

配置优先级：内置值 → `config.json` → `config.local.json` → 环境变量；未显式配置的密钥使用数据卷中的持久化值。镜像不携带本机配置、数据库、上传文件或 `.env`。

| 变量 | 用途 |
|---|---|
| `PANEL_ADMIN_EMAIL`、`PANEL_ADMIN_PASSWORD` | 管理员账号口令，规则见上表；空库必须同时提供 |
| `PANEL_SECRET_KEY`、`PANEL_RUNNER_KEY` | 可选显式密钥；不设则自动保存到数据卷 |
| `PANEL_DATA_DIR` | 数据目录，默认 `/app/server/data`；改动时同步调整挂载位置 |
| `PANEL_CONFIG_PATH`、`PANEL_CONFIG_LOCAL_PATH` | 可选配置路径，通常无需设置 |
| `PANEL_PORT`、`PORT` | 后端/前端端口，默认 `8100`/`3001`；改动时同步映射端口 |
| `THREADS` | 后端并发线程数，默认 `4` |
| `WORKERS` | **只能为 `1`**，扫码会话尚未跨进程共享 |
| `YYB_URL`、`YYB_USERNAME`、`YYB_PASSWORD` | 应用宝服务对接 |
| `QL_URL`、`QL_CLIENT_ID`、`QL_CLIENT_SECRET` | 青龙 OpenAPI 对接 |

口令会短暂存在于容器配置和进程环境中，不要把实际值写进 Git、镜像层或共享命令历史；用 `.env`、compose 的 `env_file` 或宿主密钥管理传入并限制文件权限。`ps`、`docker inspect` 能看到环境变量，多租户主机应改用文件挂载配合 `PANEL_CONFIG_LOCAL_PATH`。

不想继续用变量管理口令时，可改用 CLI（邮箱替换为实际管理员邮箱）：

```bash
docker exec -it -w /app/server taskdeck /app/venv/bin/python tools/set_admin_password.py --list
docker exec -it -w /app/server taskdeck /app/venv/bin/python tools/set_admin_password.py admin@example.org
```

改完后把 `PANEL_ADMIN_PASSWORD` 从部署命令里去掉，否则下次重启会再次同步成变量里的值。

## 邮件与品牌设置

SMTP 在「系统设置 → 邮件服务」配置；未配置或投递失败时，验证码请求明确失败，不回显验证码，也不把正文写入生产日志。仅隔离本地开发可在配置文件显式设置 `"mail_dev_mode": true`；不要用于公网实例。

站点名称、图标开关和图片随数据库/上传目录持久化；邮件验证码、通知和测试邮件共用模板。注册是否强制验证邮箱由 `PANEL_REGISTER_REQUIRE_CODE` 配置；开启前应先确认 SMTP 测试成功。

## 本地开发与验收

```bash
# 后端：空库启动前先给管理员变量
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
PANEL_ADMIN_EMAIL=you@example.com PANEL_ADMIN_PASSWORD='12位以上口令' .venv/bin/python app.py

# 另一个终端启动前端
cd web
npm ci
npm run dev
```

前端通过 `PANEL_API_URL` 连接后端，默认 `http://127.0.0.1:8100`。生产构建后必须重启旧前端进程，避免资源清单不同步。

```bash
# 在项目根目录：全部使用隔离数据，不需要本机真实管理员或 SMTP
python3 server/test_installation.py
docker build -t taskdeck:verify .
python3 docker/verify-image.py taskdeck:verify

# 本机已有 web/node_modules 和 Chrome 时，加测图标与站名界面
python3 docker/verify-image.py taskdeck:verify --browser
```

发布工作流先构建候选镜像，在镜像内执行离线测试并验证管理员配置、重建、口令轮换、图标、非 root 权限及进程故障，成功后推送同一镜像。提供 `latest`、`main` 和 `sha-完整提交号` 标签；生产可固定 digest，OCI `org.opencontainers.image.revision` 对应源码提交。

## 代码位置

- `web/`：Next.js 页面、Server Actions 和品牌组件。
- `server/`：Flask API、SQLite、业务逻辑和邮件模板。
- `server/bootstrap.py`：按部署变量创建/同步管理员。
- `server/runtime_config.py`：数据卷运行密钥。
- `docker/`：启动监督与镜像验收脚本。
- `repos/`：公开上游子模块；克隆和构建时需要实际内容。
- `docs/`、本地配置、运行目录与生成预览不进入公开仓库或构建上下文。

详细后端说明见 [server/README.md](server/README.md)。
