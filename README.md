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

## 通知渠道（IM 机器人）

在「系统设置 → 通知渠道」配置，**不依赖邮件服务**，独立可用。已支持 7 个渠道：

| 渠道 | 必填 | 说明 |
|---|---|---|
| 企业微信机器人 | Webhook | 群机器人地址 |
| 钉钉机器人 | Webhook（+加签密钥） | 开了「加签」时填 secret，服务端自动加 `timestamp`/`sign` |
| 飞书机器人 | Webhook | 自定义机器人地址 |
| Bark（iOS） | 服务地址 + Key | 自建服务同样可用 |
| Server酱 | SendKey | 填 SCT 开头的 key 或完整 `.send` 地址 |
| Telegram | Bot Token + Chat ID | 直连 `api.telegram.org`，需要服务器可达 |
| 自定义 Webhook | URL（+Bearer Token） | POST JSON：`{event,title,content,time}` |

实现要点（`server/notify.py`）：

- 配置存 `settings` 表 `notify_<渠道>_<字段>`，必填项不齐即视为未启用，**不影响其它渠道**；
- 钉钉 secret、Telegram token、Webhook token **不回传前端**，只给「已设置」标记，留空表示不修改；
- 发送失败只写 `data/notify.log`，绝不让机器人故障拖垮业务；业务事件走后台线程，不阻塞请求；
- 已接入事件：新用户注册。后续事件（提现、抢兑、runner 失败等）在对应位置调用 `notify.notify_async(标题, 正文)` 即可。

先把配置保存，再点「发送测试」——测试发的是库里已保存的配置，避免「测的是旧值、测通了线上却没生效」。

## 小蚕动作（签到 / 任务）

复用 `server/xiaocan_bridge.py` 已有的网关签名与主备容灾，只补业务方法，不重写协议层（`server/xiaocan_actions.py`）：

| 动作 | 微服务 / 方法 | 说明 |
|---|---|---|
| 会员签到状态 | `SilkwormVip.VipRightsService.UserSignInDays` | 只读，连续天数 + 今日状态 |
| 元宝签到 | `ActivityTask.ActivityTaskMobileService.SignIn` | 写操作 |
| 会员签到抽奖 | `SilkwormVip.VipRightsService.SignInLottery` | 写操作，需当天已签到 |
| 元宝任务总览 | `ActivityTask.ActivityTaskMobileService.UserTaskV2` | 只读 |
| 营销任务 | `SilkwormMarketing.SilkwormMobileMarketingService.CompleteTaskEvent` | `task_type`：3=饿了么、4=美团、6=社群 |

活动类接口用 `app_id=10`（与登录用的 25 不是同一套）；账号带 `city_code` 时附带 `x-City` 头。

管理端接口：

```
GET  /api/admin/xiaocan/accounts/<id>/daily-status   查签到状态
POST /api/admin/xiaocan/accounts/<id>/daily          元宝签到 → 会员抽奖 → 任务总览
POST /api/admin/xiaocan/accounts/<id>/task-event     {"task_type": 4, "promotion_order_id": 123}
```

`daily` 逐条返回 `{step, ok, skipped, error}`：单步失败不中断后续步骤；上游提示「已签到 / 已领取」时标记 `skipped` 而不是失败。

### 店铺检索（只读）

| 动作 | 微服务 / 方法 | 说明 |
|---|---|---|
| 附近外卖霸王餐 | `SilkwormFusion.FusionService.GetFeedPromotions` | 主源；空结果或报错自动回落 `SilkwormRec.RecService.GetStorePromotionList` |
| 关键词搜店 | `SilkwormFusion.FusionService.SearchPromotions` | 需要 `q` |
| 到店/团购霸王餐 | `SilkwormExplore.ExploreMobile.ListGroupPromotion` | 分页用 `page_num/page_size` |

```
GET /api/xiaocan/accounts/<id>/stores/feed?lat=&lon=&city_code=&offset=&limit=
GET /api/xiaocan/accounts/<id>/stores/search?q=&lat=&lon=&city_code=
GET /api/xiaocan/accounts/<id>/stores/explore?lat=&lon=&city_code=
```

三种接口的列表字段名各不相同（`feed_items` / `promotion_list` / `list`），后端统一补一个 `items` 数组给前端。`limit` 上限 20；定位参数缺失或越界会在本地直接 400，不发无效请求。

面板入口：侧栏「业务 → 附近霸王餐」(`/dashboard/stores`)，可选账号、填经纬度/城市码，在「附近外卖 / 搜索店铺 / 到店团购」间切换并翻页。定位只随请求传递，不落库。

### 自动化任务（秒杀 / 日常 / 资产提醒）

面板「小蚕」页第一块。按三组卡片呈现，每张卡片显示该任务在哪些账号上开着（x/y），
并可直接对当前账号开关；开关是**幂等设置**，不是翻转。

三组**默认只展开第一组**，其余点开再看，避免一屏铺开十几张卡片。

| 分组 | 项 | 执行方式 | 可配参数 |
|---|---|---|---|
| 秒杀抢券（6） | 限量大牌、保底大牌、SVIP 返利券、影音 VIP、免单券、整点红包雨 | 青龙脚本按 cron 跑 | 无（参数在脚本内） |
| 日常任务（7） | 每日签到、领取元宝任务、双节抽礼（脚本）；领天天赚元宝、会员每日签到、收取未收元宝、免费开红包与抽奖（内置） | 脚本 + 内置 | 开红包间隔 |
| 资产与提醒（3） | 凭据/JWT 到期预警、卡券/红包到期提醒、美团同店双返利监控 | 内置 | 提前天数、巡检间隔、扫描上限、关键词 |

**参数只出现在「真会用这些参数」的任务上**：脚本任务的参数写死在青龙脚本里，
给个存了不生效的表单比不给更糟。内置任务由 `server/xiaocan_builtin.py` 执行，
参数从 `automation_params` 表读取后直接进执行器（例如巡检间隔会决定当天排几个时段）。

- 脚本任务的开关复用 `account_features`（与「账号管理」的任务开关同一份数据，不会两处不一致）；
- 提醒任务的开关单独存 `automation_flags`，不混进 `coupon_types`，避免污染任务派发；
- 提醒线程每天到点各跑一次，**错过时刻当天会补跑**；凭据预警只看开了提醒的账号，
  卡券提醒每账号一次网关请求、串行间隔 1.5s，失败只写日志不影响线程。

```
GET /api/xiaocan/automation                                   分组 + 每任务开关 + 参数定义 + 计数
PUT /api/xiaocan/accounts/<id>/automation/<task_key>          {"enabled": true}
GET /api/xiaocan/accounts/<id>/automation/<task_key>/params   当前参数（含默认值）
PUT /api/xiaocan/accounts/<id>/automation/<task_key>/params   {"params": {...}}（按定义校验类型与范围）
```

> 刻意**不收录**开源版有、我们还没有执行路径的项：元宝秒杀抢券、美团神券定时、
> 同店双返利监控的独立调度。列出来却跑不了，比不列更糟。

### 资产工作台（元宝 / 任务 / 签到 / 抽奖 / 红包雨 / 卡券）

`server/xiaocan_console.py` 把只读 RPC 聚合成页面能直接渲染的结构，按段返回：

| 段 | 数据来源 | 内容 |
|---|---|---|
| `profile` | `SilkwormService.GetClientUserInfo` | 昵称、钱包余额、累计提现、成单数、VIP 成长值 |
| `assets` | `ActivityTaskMobileService.UserTaskV2` | 元宝余额、待领取、已兑换 |
| `tasks` | `ActivityTaskMobileService.GetDailyTask` | 每日任务列表；上游 `completed==3` 才标可领取 |
| `points` | `ActivityTaskMobileService.GetUnReceivedPointRecords` | 未领取元宝明细 |
| `signin` | `SignInHistory` + `VipRightsService.UserSignInDays` | 连续签到天数（上游只给天数时没有逐日明细） |
| `lottery` | `SilkwormLotteryMobile.LotteryInfo` + `GetLotteryProgress` | 剩余次数、每日额度、阶梯进度 |
| `rain` | `SilkwormLotteryMobile.GetRedPackRainEvent` | 场次、起止时间、状态 |
| `freeorder` | `VipRightsService.UserFreeOrderInfo` | 每月免单卡：是否持有、是否已核销 |
| `cards` | `SilkwormCardService.GetUserCardNumber` + `GetUserCardList` | 卡券数量与列表，按券名归到免单卡 / 影音卡 / 品牌券 / 其他 |
| `redpacks` | `RedPackService.GetUserRedPackNum` + `GetAppRedPackList` | 可用红包数量与明细 |

```
GET /api/xiaocan/accounts/<id>/overview?sections=profile,assets&city_code=440303
```

- `sections` 缺省只拉 `profile,assets`；页面分两批（档案+任务+积分+签到 / 抽奖+红包雨+卡券+红包）后台补齐，避免一次打出十几个网关请求；
- 并发度固定 3，单段失败只写进 `errors`，不影响其它段；
- `city_code` 由页面定位决定，卡券/红包等接口会带 `x-City` 头；定位只随请求传递，不落库。

面板入口：

- 「业务工具 → 小蚕」(`/dashboard/xiaocan`) 顶部工作台：资产指标、每日任务（可领取的单条领取）、未领取积分、签到历史、抽奖（抽一次 / 广告加次 / 额外次数）、整点红包雨（报名 / 抢）、外卖免单卡（状态 / 抢）、卡券包、红包列表；「执行日常」串行跑元宝签到 → 会员签到抽奖 → 任务总览。
- 「账号管理」每个账号下方、「用户管理 → 用户详情 → 小蚕账号」每个账号卡片下方都有「资产与福利」折叠面板（compact 版，点开才拉数据）。

### 定位（不设默认定位）

系统**不设默认定位**：没有定位时附近霸王餐、抢单、店铺监控都会拦住并提示先设置，
不会默默按某个城市查出一堆看起来正常、其实全错的数据。

- 入口：顶栏「📍 设置定位」/ 页面顶部黄色提示条 / 各表单里的「去设置定位」；
- 获取方式：浏览器本机定位（Geolocation）、网络 IP 归属地、搜索商圈/地标、经纬度微调；
- 历史位置保存在浏览器本地（最多 6 条），定位只随请求传递，**不写数据库**；
- 天地图 key 由管理员在「系统设置 → 天地图 Key」填写，**普通用户不需要也不能看到 key**，
  所有检索都从后端 `/api/location/*` 代理；没填 key 时自动降级为
  BigDataCloud 逆地理 + 内置城市表 + IP 归属地。

```
GET /api/location/search?q=深圳福田车公庙      地址/商圈/地标候选
GET /api/location/resolve?lat=&lon=            逆地理（天地图 → BigDataCloud → 最近城市估算）
GET /api/location/ip                           IP 归属地兜底
```

> HTTP 访问时浏览器会禁用 Geolocation（只有 HTTPS/localhost 算安全上下文），
> 页面会明确提示改用 HTTPS 或走 IP/搜索；不要把它当成脚本 bug。

### 电脑微信直连提 token

与开源版同一原理：微信 PC 端的小程序引擎 `WeChatAppEx.exe` 会把小蚕的 JWT 留在进程内存里，
读出来即可，不改代理、不装证书、不断网。区别在部署形态：

- **服务端在 Windows**：`POST /api/xiaocan/wechat/scan` 就地扫描入库（和开源版一键完成一致）；
- **服务端在 Linux 容器**（现网形态）：容器读不到你电脑上的微信进程，所以走配对码：
  1. 面板「小蚕 → 绑定」点「生成配对码」（10 位随机码，10 分钟有效，一次性）；
  2. 「下载 Windows 脚本」——脚本里已内嵌面板地址与配对码，只依赖标准库；
  3. 电脑微信先打开一次「小蚕霸王餐」小程序，再双击脚本；
  4. 脚本扫内存 → POST `/api/xiaocan/wechat/report` → 面板轮询到 done 自动刷新。

```
POST /api/xiaocan/wechat/pair            生成配对码
GET  /api/xiaocan/wechat/pair/<code>      查询状态（waiting/done/expired）
GET  /api/xiaocan/wechat/script?code=     下载内嵌配对码的脚本
POST /api/xiaocan/wechat/report           脚本回调（凭配对码，无需登录）
POST /api/xiaocan/wechat/scan             Windows 部署时就地扫描
```

只读 `WeChatAppEx.exe` / `wmpf` 进程内存中的 JWT，不读取聊天内容；配对码只能把账号绑到
生成它的那个用户名下，且用后即失效。

### 绑定小蚕账号（微信扫码）

面板「小蚕 → 小蚕账号登录 / 绑定」。

- 流程：`qrconnect` 取 uuid → 长轮询扫码状态 → 用户确认后拿 code 走 `WechatOpenapiService.AppLogin` 换 `user_id`/`access_token` → 落库成「昵称#user_id#silk_id#token」四段格式；
- **管理员账号不受车位限制**（站务自用）；普通用户新增账号受「购买车位 + 等级赠送」限制，超量返回「车位已满（x/y）：…」；
- 失败原因会写进服务端日志（`[xiaocan-qr] 兑换凭证失败：…`）并回显到页面，不再只显示笼统的「扫码失败」；
- 二维码 5 分钟有效；`WORKERS` 必须为 1，否则扫码会话跨进程丢失。

### 抢单与预约

```
POST   /api/admin/xiaocan/accounts/<id>/grab      {promotion_id, at?, advance?, lat, lon, city_code?, store_platform?}
GET    /api/admin/xiaocan/grab-jobs               最近任务（进程内）
DELETE /api/admin/xiaocan/grab-jobs/<job_id>      取消
```

- 按活动 ID 位数路由：7 位以下走 `SilkwormFusion.FusionGrabPromotionQuota`（source=2），其余走 `SilkwormService.GrabPromotionQuota`；主路由失败自动换另一个。
- 成功判定：响应里 `promotion_order_id > 0`；否则记为 `failed` 并保留上游原始原因。
- `at` 传时间戳或 ISO 时间即预约；不传立即执行。到点前 0.5 秒内把轮询间隔压到 5ms。
- 15 位以上的美团赏金活动（`poi_event_id`）需要额外参数，当前**显式拒绝**并说明原因，不会发出注定失败的请求。

### 霸王餐订单（录入 / 提交单号 / 延时券 / 免单卡）

```
GET    /api/xiaocan/orders?status=&limit=
POST   /api/xiaocan/orders                       手工录入
PUT    /api/xiaocan/orders/<id>                  改字段（状态、金额等）
DELETE /api/xiaocan/orders/<id>
POST   /api/xiaocan/orders/<id>/submit-platform-id   {"platform_order_id":"..."}
POST   /api/xiaocan/orders/<id>/delay-voucher    领红包延时 2 小时
POST   /api/xiaocan/orders/<id>/use-free-card    核销免单卡
```

- 提交单号走 `SilkwormPromotion.PromotionService.SubmitPlatformOrderId`（App 20），成功后本地状态转 `auditing`；
- 延时券按平台映射 `task_type`：美团 4、饿了么 3；比例返现订单会被拒绝；
- 免单卡先查 `UserFreeOrderInfo` 取券 ID，再用外卖单号核销（美团 `order_business=1`，饿了么 2）；
- 平台单号一旦绑定不允许二次修改（与官方一致）；
- `PUT` 改状态时，只有状态真的变了才推送通知（文案用中文标签），并在进入
  `completed / rejected / cancelled` 终态时补 `settled_time`（人工填过的时间不会被覆盖）；
- 订单同时并入 `GET /api/my/xiaocan-history`，所以「我的记录」页能看到订单，
  不再和助手页割裂成两套数据。

### 店铺监控（关键词 / 店名 / 名额 / 同店多方案）

```
GET    /api/xiaocan/watch
POST   /api/xiaocan/watch                        {account_id, kind, params, interval_sec}
PUT    /api/xiaocan/watch/<id>                   {params, interval_sec} 改条件与节奏
GET    /api/xiaocan/watch/<id>/hits?limit=       命中流水（错过的通知还能回看）
POST   /api/xiaocan/watch/<id>/run               立即执行一次
POST   /api/xiaocan/watch/<id>/status            {"status":"active|paused"}
POST   /api/xiaocan/watch/<id>/reset-seen        清空去重记录，允许重新提醒
DELETE /api/xiaocan/watch/<id>
```

- 后台常驻线程按各自间隔轮询（最小 60 秒），命中写 `xc_watch_seen` 去重后推送到已配置的通知渠道；
- **只发现与通知，不自动抢单**——避免无人值守时把额度打空；
- 扫描失败会把原因写进 `last_error`（WAF 熔断不再被吞成「0 条」）；
- `PUT` 不允许改 `kind` 与归属账号：去重键是按类型定义的，换类型后旧记录会和
  新判定结果互相矛盾，只能删除重建；间隔低于 60 秒会被抬到 60 秒；
- `xc_watch_seen` 除 `item_key` 外还存 `title/detail`，因此命中记录在界面上是
  可读的一行，而不是一个哈希键（加列之前的老行回退显示 `item_key`）；
- 暂停、编辑、查询命中、重置去重都带账号归属校验，越权请求直接失败；
- `reset-seen` 只清去重记录，`hits` 作为累计发现量不清零。

### 授时（NTP）

抢单是秒级窗口，本机时钟漂移会直接导致空枪，所以加了授时层（`server/time_service.py`）：

- 优先 SNTP（RFC 5905）对 `ntp.aliyun.com` / `cn.pool.ntp.org` / `time.cloudflare.com` 校时，算 offset 与往返延迟；
- **UDP 123 被墙时自动降级**到读 HTTP `Date` 头（用往返中点抵消一半延迟）；
- 结果缓存 120 秒，`?force=1` 可强制重校；
- 接口 `GET /api/xiaocan/time` 返回 `synced / source / offset_ms / round_trip_ms / server_time / error`，失败不抛异常，只回报原因。

面板「助手看板 → 任务调度中心」会显示 `授时 +35ms · 源 sntp:ntp.aliyun.com · 往返 60ms` 这样的状态。

### 美团账号

面板「助手看板 → 美团账号」支持：扫码登录（美团 App 扫码 → 手机确认 → 自动存凭证）、手工粘贴凭证、绑定到小蚕账号、领取福利社券。

```
POST /api/xiaocan/meituan/auth/start     发起扫码，返回二维码 data URL
GET  /api/xiaocan/meituan/auth/poll      轮询授权结果
POST /api/xiaocan/meituan/claim          用当前凭证领券
GET  /api/xiaocan/meituan/accounts       凭证列表（只回掩码）
```

凭证目录由 `MEITUAN_AUTH_DIR` 指定（默认数据卷下 `meituan/`），容器重建不掉。

> **注意**：扫码与领券依赖 `server/meituan_assets/`（第三方 `run.js` + `mtuser-pt-passport` tgz，**无 LICENSE**），
> 详见 `server/meituan_assets/NOTICE.md`。不需要美团功能时可整目录删除，其余功能不受影响。

### 小蚕工具箱（45 个动作）

`server/xiaocan_methods.py` 维护「函数名 → 微服务/方法名」映射（70 项，来自对官方 App 的调用点整理），
`server/xiaocan_extras.py` 按白名单声明每个动作接受的参数与默认值，未声明参数一律拒绝。

分组：任务与积分、抽奖与红包、红包与提现、订单、卡片与券、社区与礼包、消息中心。

```
GET  /api/xiaocan/actions                    动作清单（含参数定义，前端据此渲染）
POST /api/xiaocan/accounts/<id>/call         {"action":"get_lottery_info","params":{}}
POST /api/admin/xiaocan/accounts/<id>/call   管理员代任意账号执行
```

面板「助手看板 → 小蚕工具箱」每组按钮可直接执行，带参数的动作会在按钮旁出现输入框。

### 助手看板

面板「业务 → 助手看板」(`/dashboard/assistant`)：

- **累计到账返现** = 已完成订单返现之和；**在途/待入账** = pending + auditing；**今日已省外卖费** = 今天创建、未被拒/取消的返现之和（口径与开源版一致）
- 近 7 天返现柱状、订单状态/平台分布
- **任务调度中心**：抢单任务（进程内）+ 等级刷新开关
- **运行日志**：抢单/日常执行记录，可一键清空
- **抢单预约表单**：选账号、填活动 ID、可选计划时间与超前券

```
GET    /api/xiaocan/stats        GET /api/xiaocan/chart-data
GET    /api/xiaocan/scheduler    GET /api/xiaocan/time
GET    /api/xiaocan/job-logs     DELETE /api/xiaocan/job-logs
POST   /api/xiaocan/accounts/<id>/grab
```

订单与日志存本项目的 `xc_orders` / `xc_job_logs` 表；抢单成功会自动落一条在途订单。

### WAF 熔断

网关命中腾讯云 WAF 时返回 403。服务端识别后进入 **15 秒冷却**（`server/xiaocan_bridge.py`）：冷却期内所有网关调用直接失败、不发网络请求，避免越重试封得越久；冷却结束自动恢复。

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

### 可选：接入第三方「小蚕小帮手」（仅本机）

社区版 `xiaocan-assistant 1.0.1` 提供抢单/预约/多渠道通知，**没有 LICENSE，属未授权代码**：只在本机构建、不随镜像发布，源码也不进本仓库。

```bash
# 1) 在源码目录构建一次
docker build --network host -t xiaocan-assistant:1.0.1 .

# 2) 在仓库根目录启用该 profile（默认不会启动它）
docker compose --profile assistant up -d xiaocan-assistant

# 3) 它没有鉴权，只绑 127.0.0.1，用隧道访问
ssh -N -L 8690:127.0.0.1:8690 <user>@<host>
```

数据落在 `docker/assistant-data/`（已忽略）。升级时替换源码重新构建，再 `docker compose --profile assistant up -d xiaocan-assistant`。

> 注意：`docker compose up -d` 不带服务名会重建本项目的面板容器，而面板默认用命名卷 `xiaocan-data`；若你当前是绑定 `./docker/test`，先迁移数据或改 compose，否则重建后站点会变成空库。

## 代码位置

- `web/`：Next.js 页面、Server Actions 和品牌组件。
- `server/`：Flask API、SQLite、业务逻辑和邮件模板。
- `server/bootstrap.py`：按部署变量创建/同步管理员。
- `server/runtime_config.py`：数据卷运行密钥。
- `docker/`：启动监督与镜像验收脚本。
- `repos/`：公开上游子模块；克隆和构建时需要实际内容。
- `docs/`、本地配置、运行目录与生成预览不进入公开仓库或构建上下文。

详细后端说明见 [server/README.md](server/README.md)。
