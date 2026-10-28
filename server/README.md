# 任务托管平台 · 后端 API（server/）

对接小蚕（大牌券）与应用宝（YYB 协议服务）两个业务的后端：**Flask + SQLite，零构建**，
对外只提供 `/api/*`，UI 由 `../web`（Next.js）提供。

前端不再由本服务托管：老版 Vue SPA（static/templates）已退役。

## 快速开始

```bash
cd server
pip install -r requirements.txt      # flask / PyJWT / requests（qrcode+pillow 可选）
python3 seed.py                      # 初始化数据库与种子数据（app.py 启动时也会自动执行）
./run.sh                             # 开发模式，端口取 config.json（默认 http://0.0.0.0:8100）
./run.sh prod                        # gunicorn 部署（单 worker，原因见 run.sh 注释）
PORT=8200 ./run.sh                   # 临时换端口
python3 smoke_test.py                # 87 项全链路冒烟测试（默认打 :8100）
```

端口口径只有一个来源：`config.json` 的 `port`（默认 8100），`run.sh` 与前端 `PANEL_API_URL` 都对齐它。

### 初始口令（重要）

默认管理员 `admin@example.com / admin12345` **仅首次建库时使用**。改口令不用删库：

```bash
python3 tools/set_admin_password.py                 # 改 config.json 里 admin_email 那个账号（交互输入口令）
python3 tools/set_admin_password.py you@mail.com    # 指定账号
python3 tools/set_admin_password.py --list          # 只看有哪些账号
```

改完会顺带把该账号的 `token_version` +1（现有登录凭证立即失效）。
后端每次启动若发现口令仍是出厂默认值，会在控制台打印告警。

## 配置

三级合并，后者覆盖前者：

```
DEFAULT_CONFIG ← config.json ← config.local.json ← 环境变量
```

| 文件 | 用途 | 是否进版本库 |
|:---|:---|:---|
| `config.example.json` | 模板（含所有可配项与说明） | ✅ 提交 |
| `config.json` | 本机基础配置（端口、密钥、青龙/应用宝地址） | ❌ 已忽略 |
| `config.local.json` | 敏感凭据覆盖层（推荐只放这里的密码） | ❌ 已忽略 |

敏感项也可完全走环境变量，见 `config.example.json` 的 `_环境变量` 清单：
`PANEL_PORT / PANEL_SECRET_KEY / PANEL_ADMIN_PASSWORD / PANEL_RUNNER_KEY`、
`YYB_URL / YYB_USERNAME / YYB_PASSWORD`、`QL_URL / QL_CLIENT_ID / QL_CLIENT_SECRET`。

> 自动生成的 `secret_key` / `runner_key` 仍会回填 `config.json`；
> 来自 `config.local.json` 或环境变量的值**不会**被写回磁盘。

## 目录

```
server/
├─ app.py               Flask 入口：注册蓝图、/api 兜底、/healthz 探活
├─ core.py              SQLite schema、JWT/密码、统一响应体、积分流水、设置、配置三级合并
├─ seed.py              种子数据（任务类型/商品/卡档/平台/奖品/公告/管理员）
├─ api_auth.py          /api/auth/*          登录注册改密通知
├─ api_user.py          /api/*               权益、积分、签到、转盘、邀请、小蚕账号、绑定、抢兑
├─ api_projects.py      /api/*               项目市场与提交（项目 × 渠道可见性）
├─ projects.py          项目体系、提交扣分、授权判定
├─ api_admin.py         /api/admin/*         仪表盘、用户、卡密、商品、账号订单、公告、设置、任务总览与日志
├─ api_ql.py            /api/admin/ql/*      青龙面板 CRUD、连通检测、crons 代理、任务下发
├─ api_runner.py        /api/runner/*        青龙 runner 与本站之间的内部通道
├─ ql_client.py         青龙客户端（网页 API /api/*：登录/token 续期/crons/日志）
├─ qinglong_client.py   青龙 OpenAPI 客户端（/open/*，client_id+secret）：envs 与 crons 读写
├─ api_yyb.py           /api/yyb/*           应用宝模块：账号、取码、托管任务、绑定矩阵
├─ yyb_client.py        应用宝（YYB-Go-Enhanced）客户端：账号/保活/取码/青龙托管任务与日志
├─ bindings.py          「脚本 × 账号」绑定矩阵：采集、解析 env_name/app_id、入库
├─ xiaocan_tasks.py     小蚕任务目录、托管判定、多面板日志聚合
├─ xiaocan_bridge.py    账号序列化、功能开关、账号数据导出、绑定、抢兑设置
├─ runner_dispatch.py   报名/抢兑派发到青龙、runner 拉取账号数据
├─ mail.py              邮件发送：SMTP 凭据存 settings 表，没配就写 data/mail.log 并把验证码回传前端
├─ smoke_test.py        全链路冒烟测试
├─ test_mail.py         SMTP 配置/发信单测（32 项离线单测之一）
├─ test_auth_code.py    验证码节流/作废/重放单测
├─ tools/
│  ├─ set_admin_password.py   改口令 CLI（不删库）
│  └─ make_demo_user.py       造一个普通用户视角的演示账号
└─ data/panel.db        SQLite（首次启动生成，含 WAL）—— 生产库，勿删，勿提交
```

## 关键契约

- 响应体 `{"code":200,"data":...,"msg":"success"}`，HTTP 状态码恒 200；未匹配的 `/api/*` 返回 `code:404 / msg:"page not found"`。
- JWT（HS256，载荷 `user_id/role/iat/exp/jti/token_version`，默认 2 小时）放在 `Authorization: Bearer`。
- 积分以「分」存整数，**100 = 1.00 积分**，前端 `pts()` 展示。
- 时间统一 `+08:00` ISO8601（前端按 `slice(0,16)` 截断）。
- 任务开关名就是 `coupon_types.name` 的中文名，前端 10 个固定开关；账号未激活会员时后端拒绝开关。
- 账号数据导出：**`备注#小蚕UserId#silk_id#token`**，多账号 `@` 分隔 —— 与 `小蚕/*.py` 脚本入参格式完全一致。
- 渠道隔离：`users.channel ∈ {xiaocan, yyb}`，两个登录入口各认各的，跨渠道登录直接拒绝。

## 账号绑定

扫码绑定走「小蚕 RPC 取微信开放平台 uuid → 用户微信扫码 → 轮询拿 token」。本服务两条路：

1. **手动粘贴绑定**（默认可用）：绑定页填一整段账号数据，多账号 `@` 分隔；后端自动解析 JWT 里的 `exp` 与 `UserId` 填 `token_expire` / `xc_user_id`。
   也可以直接把后台「账号数据」页导出的整段文本粘进去。
2. **扫码绑定**（留接入点）：在 `config.json` 增补
   ```json
   { "xiaocan_rpc_url": "https://gw.xiaocantech.com/rpc",
     "xiaocan_qr_method": "XxxService.获取二维码方法",
     "xiaocan_qr_poll_method": "XxxService.轮询扫码状态方法" }
   ```
   两个方法名来自小蚕 RPC（`gw.xiaocantech.com/rpc`，鉴权靠 `methodname` 头 + `x-ashe` = `md5(md5("server.method")+x-garen+x-nami)`，
   参考 `小蚕/小蚕每日签到.py` 的 `build_ashe`）。填上后 `POST /api/xiaocan/qrcode` 走真扫码。

## 应用宝（YYB-Go-Enhanced）

面板是 YYB 的客户端：账号存活与凭据倒计时、保活刷新、取码测试、每账号托管任务与日志。
端点存 `service_endpoints(kind='yyb')`，`config.json` 的 `yyb` 段做首次种子。

两套青龙客户端分工别搞混：

| 客户端 | 入口 | 用途 |
|:---|:---|:---|
| `ql_client.py` | 网页 API `/api/*` | 青龙账号密码登录；小蚕那套面板 CRUD、crons、日志 |
| `qinglong_client.py` | OpenAPI `/open/*` | 青龙 Client ID/Secret；envs 与 crons 读写，供应用宝绑定矩阵使用 |

### 账号绑定矩阵

`/api/yyb/bindings` 把「哪些账号参加哪些 code 版脚本」摊成一张 (脚本 × 账号) 矩阵：
数据从青龙 cron + 环境变量 + 脚本源码采集，账号变量名（如 `hrt_wxid`）自动识别。
`/api/yyb/bindings/preview?mode=env|task_before` 预览两种下发落点会写成什么。
说明文档：`../docs/账号绑定矩阵.md`。

## 青龙对接

**面板侧**：后台「青龙面板」页添加面板（url/账号/密码）→ 测试连通 → 「查看任务」直接读 crons、运行/停止。
`POST /api/admin/ql/panels/<id>/provision` 可把 10 个内置小蚕任务按默认定时一键下发。

**runner 侧**（青龙上的 `xiaocan_console_runner.py` 之类脚本），用 `config.json` 的 `runner_key`：

```bash
KEY=$(python3 -c "import json;print(json.load(open('config.json'))['runner_key'])")

# 1) 拉这个任务要跑的账号（备注#UserId#silk_id#token，直接塞给原脚本）
curl -s -H "X-Runner-Key: $KEY" "http://面板地址:8100/api/runner/accounts?task=checkin"

# 2) 回传结果（5 种 type）
curl -s -X POST -H "X-Runner-Key: $KEY" -H 'Content-Type: application/json' \
  -d '{"type":"signup_result","record_id":12,"status":"success","output":"日志全文"}' \
  http://面板地址:8100/api/runner/report
```

`type` 取值：

| type | 用途 | 关键字段 |
|---|---|---|
| `accounts`（GET） | 拉账号数据，按任务过滤（未启用/已过期/暂停的自动跳过） | `task=<key>` |
| `signup_result` | 回填报名日志，用户端「立即报名」的结果就来自这里 | `record_id,status,output,error` |
| `prizes` | 回填抢兑奖品列表（账号页抢兑下拉框） | `account_id, prizes[]` |
| `failure` | 记一条「未中/库存耗尽」到仪表盘近 7 日列表 | `account_id, reason` |
| `account` | 更新账号昵称/头像/VIP 等级/token（自动解析 exp） | `account_id, vip_level, token...` |

报名/抢兑这类即时任务：`runner_dispatch` 会在面板里找同名 cron 并触发；找不到就落库为 `failed/pending` 并提示，不会卡住用户。

## 测试

```bash
python3 -m unittest test_mail test_auth_code   # 33 项离线单测（临时 SQLite，不碰 data/panel.db）
python3 smoke_test.py [base_url]               # 87 项全链路冒烟（默认 :8100；对生产库跑会写测试数据，建议先拷库）
```

冒烟覆盖：管理员登录、后台 12 个页面接口、面板 CRUD 与离线检测、公告版本自增、SMTP 设置入库与授权码不回传、发信自检（未配置走 dry-run）、注册发码/节流/验证码错误、注册登录改密、
找回密码与换绑邮箱闭环、档位/商品自由排序（POST `/api/admin/reorder`，含白名单与 id 校验）、
卡密生成与兑换（含重复兑换拒绝）、签到（含重复签到拒绝）、转盘概率守恒、邀请、绑定解析、功能开关权益拦截、报名、抢兑、购买
会员、账号数据导出、runner 4 类回传、权限与 404 兜底。若本机已配过真实 SMTP，冒烟会先临时关掉 host
（不动授权码）以便用 `dev_code` 跑注册链路，跑完还原。

单测覆盖：

- `test_mail.py`：三来源 SMTP 配置优先级、dry-run、重试、STARTTLS、535 报错透传、口令不入日志/不入 config.json。
- `test_auth_code.py`：发码节流 / 每日限次 / 错误次数作废 / 过期 / 重放 / dry-run 与真失败的码作废差异。
- 前端配套：`../web/tests/e2e/AuthSignUp.e2e.ts`（注册验证码端到端）与 `../web/src/features/auth/actions.test.ts`。

## 邮件服务（注册/找回验证码）

SMTP 凭据放在 **settings 表**，后台「系统设置 → 邮件服务」直接改，改完立即生效（不用重启，也不用编辑文件）。

| 字段 | 说明 |
|:---|:---|
| `smtp_host` | `smtp.126.com` / `smtp.qq.com`；**留空 = 关闭发信** |
| `smtp_port` / `smtp_ssl` | 默认 465 + SSL；关掉 SSL 走 STARTTLS（587） |
| `smtp_user` / `smtp_password` | 邮箱地址 + **授权码**（不是登录密码）。`smtp_password` 只进不出：`GET /api/admin/settings` 永远返回空串，只给一个 `smtp_password_set` 标记，提交空值表示「不改」 |
| `smtp_sender` / `smtp_from_name` | 发件地址（留空用账号）与发件人显示名 |

读取优先级（逐字段回退）：**settings 表 → `config.json` 的 `smtp` 段 → 环境变量 `MAIL_SMTP/MAIL_PORT/MAIL_SENDER/MAIL_PASSWORD`**（后两者对齐 `狐蒂云`、`算法助手` 两个脚本的 `.env` 口径）。

**自检**：后台填好点「发送测试邮件」= 先保存当前表单，再真发一封；失败会把 SMTP 原始报错（如 `SMTPAuthenticationError: 535`）原样显示在页面上，不用去翻日志。对应的 `POST /api/admin/settings/mail-test` 返回 `{sent, dry_run, error}`，永远 HTTP 200，便于脚本断言。

**没配 SMTP 时的行为**（本地联调通道）：`mail.send_mail` 不连外网，只把邮件正文写进 `data/mail.log`，`/api/auth/register/code` 会把验证码放进 `dev_code` 回传给前端，注册页会提示「开发模式（后端未配置 SMTP），验证码：xxxxxx」。**一旦配上 host + 账号 + 授权码，`dev_code` 自动变 null，回显通道消失。**
反过来，如果 host/账号/授权码都填了但发信失败（授权码错、被限流），接口返回「验证码发送失败」并作废这条码，**不会**悄悄退回回显验证码。

### 发码限次与验证码规则

| 规则 | 值 | 位置 |
|:---|:---|:---|
| 同邮箱同用途两次发码最小间隔 | 60 秒 | `api_auth._CODE_MIN_INTERVAL_SECONDS` |
| 同邮箱 24 小时发码上限 | 10 封 | `api_auth._CODE_DAILY_LIMIT` |
| 单条验证码错误次数上限 | 5 次（超过作废，必须重新发码） | `api_auth._CODE_MAX_ATTEMPTS` |
| 验证码有效期 | 注册 10 分钟 / 找回 30 分钟 | `api_auth` |

`config.json` 的 `register_require_code: true` 表示**注册必须带验证码**（默认已开）；置回 `false` 可临时关掉。
发信失败重试 2 次、间隔 1 秒（参考脚本是 3 次 / 15 秒，那是监控循环等得起，HTTP 里会把注册请求拖死）。

### 注册表单流程

邮箱 → 邮箱验证码（点「获取验证码」+ 60 秒倒计时）→ 昵称 → 密码 → 确认密码 → 邀请码（选填）。
前端 `web/src/features/auth/SignUpForm.tsx` 的输入全部**受控**：React 19 会在表单 action 跑完后自动 reset `<form>`，非受控输入会被打回 defaultValue（表现为「点一下获取验证码，邮箱密码全被清空」）。

## 实现说明

1. 扫码绑定默认关闭（需小蚕 RPC 方法名），改为粘贴绑定；接口与页面结构不变。
2. 抢兑奖品列表需要真实小蚕接口，由 runner 通过 `type=prizes` 回填。
3. 邮件走后台配置的 SMTP（`settings` 表）；没配 SMTP 时验证码写 `data/mail.log` 并回传前端，注册仍能在本地跑通。
4. `access_token` 返回给前端（账号卡片「更新数据」要用），本服务保持一致以便前端原样复用；
   若要收紧，可在 `xiaocan_bridge.serialize_account` 里去掉该字段并改造账号卡片。
5. 不再托管老版 Vue SPA，`/`、`/assets/*`、`/css/*`、`/js/*` 等静态路由整体移除，只保留 `/api/*` 与 `/healthz`。
