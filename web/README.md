# 任务托管平台 · 前端（Next.js）

基于 [ixartz/SaaS-Boilerplate](https://github.com/ixartz/SaaS-Boilerplate)（Next.js 16 + React 19 + Tailwind 4 + shadcn/ui）
改造的**多项目**任务托管面板：小蚕（大牌券）与应用宝（YYB 协议服务）两个项目共用一套后台与权限。

数据与写操作全部落到 `../server`（Flask + SQLite）真实接口，本层只做 BFF + 视图。

## 侧边栏分组

| 分组 | 页面 |
|:---|:---|
| **小蚕 · 大牌券** | 仪表盘、账号订单、卡密管理、用户管理、任务日志 |
| **应用宝 · 协议服务** | 微信账号、账号绑定、运行管理、服务设置 |
| **平台** | 青龙面板、公告管理、系统设置 |

## 应用宝（YYB-Go-Enhanced）模块

对接 `../server/api_yyb.py` → `yyb_client.py`，面板侧是 YYB 的客户端：

- **微信账号**（`/dashboard/yyb`）：协议服务在线状态、版本、青龙连接、账号存活、**凭据剩余实时倒计时**、
  OpenID 掩码、UIN；行内可**保活刷新**、**改备注**、**测试取码**（真实向应用宝换一次 `wx.login` code 并回显）。
- **登录网络代理**（`/dashboard/yyb` 扫码面板内）：**直连 / 静态代理 / 动态代理 API / 供应商配置**四种模式，
  与 YYB `/scan` 对齐。供应商配置与省份/城市**直接读 YYB**（`/api/proxy-profiles`），面板不另存代理池；
  选中的配置随 `POST /api/yyb/qr` 下发，只影响本次扫码登录，已生成的二维码会话保持原配置。
  对应接口：`GET /api/yyb/proxy-profiles`、`/proxy-profiles/areas/provinces`、`/proxy-profiles/areas/cities?province=`、
  `POST /api/yyb/proxy/test`。
- **运行管理**（`/dashboard/yyb/jobs`）：按账号切换，看该号托管的脚本任务（定时/启停/青龙任务 ID）、
  一键**运行/停用**，右侧列历史运行，点进去看**日志全文**。
- **账号绑定**（`/dashboard/yyb/bindings`）：**脚本 × 账号**勾选矩阵，回答「哪些账号参加哪些脚本」。
  数据来自青龙（cron + 环境变量 + 脚本源码），`env_name` 从脚本里自动识别；
  页面右下角可预览两种下发落点（青龙环境变量 / cron `task_before`）会写成什么。
  详见 `../docs/账号绑定矩阵.md`。
- **服务设置**（`/dashboard/yyb/settings`）：服务地址/账号密码/免密集成 Token，保存后可**测试连接**。
- **小程序活动自选管理**（`/dashboard/yyb/activities`）：**普通用户自己就能用**——给名下每个微信号
  勾选参与哪些小程序活动（112 个活动、分类筛选、一键全选/清空、跨账号克隆配置）。
  入口只有两处，避免同页重复：页面顶部的「⚡ 小程序活动管理」（带活动数徽标）+ 账号行内的「🎯 活动」
  （带 `?account=<id>`，直接定位到那个号）。

后台还有一条独立链路：`../server/qinglong_client.py` 直连青龙 OpenAPI（`service_endpoints` 里
`kind='qinglong'`），负责读任务/变量，以及后续把绑定矩阵写回去。

鉴权两条路：账号密码登录（HttpOnly Cookie 会话，进程内缓存、401 自动重登）；
或免密集成 Token（`Authorization: Bearer <YYB_INTEGRATION_TOKEN>`，走 `/integration/*`，需在 YYB 部署里设该环境变量）。

## 跑起来

```bash
# 1) 后端（先起）
cd ../server && ./run.sh            # http://127.0.0.1:8100

# 2) 前端
cd web
npm ci                              # 首次
npm run dev                         # 开发：http://localhost:3000（占用时自动换 3001）

# 3) 生产
npm run build && npx next start -p 3001
node scripts/screenshots.mjs http://127.0.0.1:3001   # 全站截图 → ../screenshots/
```

后端地址来自 `.env` 的 `PANEL_API_URL`（默认 `http://127.0.0.1:8100`，与 `server/config.json` 的 `port` 同口径）。

登录：`admin@example.com / admin12345`（**上线前务必改口令**，见 `../server/README.md` 的「初始口令」）。

## 管理动作（Server Actions，全部已实测落库）

| 页面 | 可执行动作 |
|---|---|
| 账号订单 | 暂停 / 启用账号、删除账号、**设置到期**（+1/+3/+7/+15 天、到月底、自定义 datetime）、**10 个任务开关**逐账号切换（带状态圆点）、**大牌券报名**（奶茶名 + 订单号，立即派发青龙）、勾选后**批量延长到期** |
| 卡密管理 | **生成卡密**（选档位 + 数量 1-1000，返回“已生成 N 张”）、单张/勾选**批量作废**、**批量删除** |
| 用户管理 | **调积分**（正充负扣 + 备注）、**改昵称**、设/取消管理员、封禁 / 解封、赠送权益、调整会员、重置密码、强制下线、删除；行内显示账号数、积分消耗、登录 IP，支持批量操作与 360° 画像抽屉 |
| 青龙面板 | **添加面板**、**测试连通**（行内显示成功/失败原因）、**一键下发 10 个托管任务**、**运行 / 停止**单个 cron、删除面板；下方按面板列出任务的定时与启用状态 |
| 公告管理 | **发布公告**、编辑（版本号 +1，用户端会重新弹窗）、删除，带渲染预览 |
| 系统设置 | 站点名、抢券率、邀请返利、转盘消耗与上限、注册开关、邮件服务（SMTP） |

实现要点：
- 所有写操作走 `src/features/panel/actions/` 里的 `'use server'` action → `panelSend()` → Flask API → `revalidatePath()` 刷新。
- 二次确认用客户端 `SubmitButton`（`window.confirm`）与 `StateForm`/`ActionForm`（`useFormStatus` / `useActionState` 显示 pending 与结果）。
- **Server Component 不能把函数当 props 传给 Client Component**，所以成功文案用字符串模板 `okLabel="已生成 {v} 张卡密"`（`{v}` 由 action 返回值填充），别写 `okText={fn}`。
- **barrel 文件（`index.ts`）不要写 `'use server'`**：Turbopack 16 会在中文注释上 panic（`next-code-frame` 字符边界 bug）。只做转发的文件保持纯净，指令留在每个实现文件里。

### 面板代码组织

```
src/features/panel/
├─ actions/                写操作 server action，按域拆分（导入方仍用 @/features/panel/actions）
│  ├─ accounts.ts          小蚕账号：任务开关 / 到期 / 报名 / 删除 / 批量延长
│  ├─ cards.ts             卡密、档位、积分商品、拖拽排序
│  ├─ users.ts             用户管理：积分 / 车位 / 会员 / 权限 / 批量 / 详情流水
│  ├─ panels.ts            青龙面板：连通检测 / 下发 / cron 运行停止 / 增删
│  ├─ announcements.ts     公告
│  ├─ me.ts                个人中心：签到 / 卡密兑换 / 推送设置 / 站内信 / 换绑邮箱
│  ├─ settings.ts          系统设置与邮件服务
│  └─ index.ts             barrel，只转发
├─ users/                  用户管理页的区块与弹窗（UsersManager.tsx 只负责编排状态）
│  ├─ UserStatsBar.tsx     顶部指标卡 + 结果通知条
│  ├─ UserToolbar.tsx      搜索 / 角色·状态筛选 / 新建入口
│  ├─ UsersBatchBar.tsx    底部悬浮批量操作栏
│  ├─ avatar.ts            头像确定性配色
│  └─ dialogs/*            各弹窗（自持内部状态、自己调 action）
├─ UsersManager.tsx        用户全景管理页（状态 + 编排）
└─ Client.tsx              ActionForm / FeedbackButton / Collapsible 等通用交互组件
```

**弹窗约定**：弹窗内部状态（输入框、pending）自己持有；跨组件只传
`user` + `onClose` + `onDone(msg)`，父组件把它塞进顶部通知条。这样加一个弹窗不改主文件逻辑。

## 渐变主题

`src/styles/global.css` 里定义品牌渐变（橙 → 玫红 → 紫）与工具类：

```text
--brand-from / --brand-via / --brand-to / --gradient-brand / --gradient-brand-soft
.bg-brand-gradient   /* 实心渐变：侧边栏选中项、主按钮、LOGO 方块 */
.text-brand-gradient /* 渐变文字：KPI 数值、标题、套餐价格 */
.bg-brand-soft       /* 极浅渐变底色：页面背景、表头、区块 */
.brand-topline       /* 卡片顶部 3px 渐变描边 */
.brand-glass         /* 渐变玻璃卡片：登录框、Hero 右侧看板 */
.brand-outline       /* 渐变描边卡片：登录框、套餐卡 */
.brand-shadow        /* 品牌色阴影：所有卡片 */
```

主色 `--primary` 也换成了渐变里的橙色，shadcn 组件（按钮/输入框/焦点圈）自动跟着变。

## 数据层

`src/libs/PanelApi.ts`：服务端组件直接调 Flask（无 CORS），token 只存在于 httpOnly cookie。
- `panelLogin / panelRegister`、`panelGet`（401 自动跳登录）、`panelSend`（写操作）
- 后端地址：`.env` 的 `PANEL_API_URL`

## 角色与权限（一处声明，两处生效）

**唯一事实来源：`src/features/panel/navConfig.ts`** 的 `NAV_GROUPS`（`adminOnly` / `userOk`）。

| 消费方 | 用法 |
|:---|:---|
| `PanelNav.tsx`（客户端） | `visibleGroups(role)` — 普通用户看不到「平台管理」整组 |
| `src/proxy.ts`（middleware） | `isAdminOnlyPath(pathname)` — 普通用户**手敲管理端 URL 也会被重定向**回 `/dashboard?denied=1` |

新增管理页时，只要在 `NAV_GROUPS` 的平台管理组里加一项，**侧栏与路由守卫同时生效**，不会再出现
「侧栏藏了入口但 URL 能进」的缺口。不在侧栏出现的管理子页（如 `/dashboard/yyb/bindings`、
`/dashboard/yyb/settings`）加进 `ADMIN_ONLY_PREFIXES` 的额外清单即可。

配套：
- `src/libs/Cookies.ts` 单独存 cookie 名 —— middleware 跑在 Edge Runtime，不能依赖
  `PanelApi.ts`（那边 import 了 `next/headers`）。
- `DeniedNotice.tsx` 读取 `?denied=1` 给出明确文案，避免「莫名其妙回到控制台」。

> ⚠️ 这层是 **UI 守卫**，不是安全边界：cookie 理论上可伪造（伪造后也只能看到空页面/被 401 拦）。
> 真正的边界在后端 —— 所有 `/api/admin/*` 都走 `core.require_admin`。

## 页面

`/` 状态页（后端健康指示 + 入口） · `/sign-in`、`/sign-up`（自建鉴权，不是 Clerk） · `/dashboard`（6 KPI + SVIP 分布 + 面板状态 + 近 7 日未中 + 今日执行） · `/dashboard/{accounts,cards,users,panels,logs,announcements,settings}`

## 相对原模板的改造

| 模块 | 改动 |
|---|---|
| Clerk 鉴权 | 整块移除（没 key 进不去）：登录/注册改自建表单 → Flask `/api/auth/*`，httpOnly cookie `xc_panel_token` 2 小时 |
| 中间件 | `src/proxy.ts` 去掉 clerkMiddleware，只保留 cookie 守卫（未登录 /dashboard → /sign-in） |
| 组织 / 多租户 | 删掉 organization-profile、user-profile、onboarding 路由与相关组件 |
| 语言 | 移除 next-intl 与 [locale] 路由：全站单一 `zh-CN`，路径扁平化（无 `/zh-CN` 前缀） |
| 首页 | 换成简洁状态页（后端健康指示 + 登录/后台入口），原营销模板目录整体删除 |
| 仪表盘 | 重做成管理后台：左侧渐变侧边栏 + 多个业务页面 |
| Sentry / Storybook / PGlite | 连同模板工具链一并删除，无运行时依赖 |

## 交互约定（管理端表格）

- **排序靠拖拽**：按住行首 `⠿` 拖动即可，改的是本地顺序，点「保存排序」才写库（避免每拖一次发一次请求）。
  拖动中的动效（reactbits 风格，全部零依赖本地实现）：被拖行 **抬起**（投影 + 品牌色描边 + `scale(1.01)` + 跟随指针轻微横移）、
  让位行 **FLIP 平滑滑动**（`translateY` 过渡 220ms）、落点行 **静态高亮**、手柄 **呼吸放大**、保存成功 **ConfettiBurst 彩带**。
  **不旋转整行**（旋转 `<tr>` 会让所有单元格一起歪，看着像坏了）。实测拖动期间锁 60fps（98 帧 / 平均 16.7ms / 无 >25ms 卡顿帧）。
  实现用 **pointer 事件**（`pointerdown/move/up` + `setPointerCapture` + `elementFromPoint` 命中判定），
  鼠标与触屏通用；手柄带 `touch-none`，手机上拖动不会变成滚页面。
  早先用 HTML5 `draggable`，那套在触屏上不触发（只有长按才可能开始拖），所以换掉了。
- **流畅度三要点**（改之前先看，否则很容易又做卡）：
  1. 拖动跟随**不要走 React state**：每个 pointermove 都 setState 会整表重渲；改成 rAF 节流 + 直接写 `el.style.transform`（同时注意 `getBoundingClientRect` 已含上一帧位移，要减掉避免自激漂移）。
  2. 拖动过程中被拖行**不要挂 `transition`**：每次移动都重启过渡，行会一直追不上指针、发飘；只在松手归位时上 160ms 过渡。
  3. 带投影/描边的行加 `will-change: transform` 提升图层，且**别用无限动画改 `box-shadow`**（每帧重绘整行，落点高亮因此改成静态）。
- **两个 CSS 坑**（改这两张表的动效前务必知道）：
  1. `.rtable tbody > tr` 的入场动画在 React 重排 DOM 时会**重启**，而 CSS 动画优先级高于行内样式，
     会把拖拽的 `transform`（缩放/旋转）整个盖掉。所以这张表的行在入场播完后会加上 `drag-static`（`animation: none !important`）。
  2. 同理，该入场动画的 `animation-fill-mode` 必须是 `backwards`（不是 `both`），否则播完仍占着 `transform`。
- **编辑表单整行展开**：`Card` 底层 `.spotlight-card` 带 `overflow:hidden`，表单塞进窄卡片会被裁掉右侧，
  因此编辑态用 `colSpan` 占满整行（`Td` 已支持 `colSpan`）。

## 已知限制

- 商品（积分套餐）、卡密档位的**新增/编辑**仍走旧后台；要的话照着 `actions/cards.ts` 的模式加两个页面即可。
- `npm run build` 会跑严格 ESLint，出生产包前先 `npm run check:types`。

## 测试

```bash
npm run check:types        # tsc 全量类型检查
npm run test               # server action 单测（node，mock 后端）
npm run lint               # ESLint 全量（既有代码里还残留一些 better-tailwindcss 风格告警）
```

界面级验证走 `scripts/verify-*.mjs`（Playwright 驱动，真实前端 + 真实后端，两个服务都要先起好）：

```bash
#   1) cd ../server && ./run.sh
#   2) npm run dev
#   3) node scripts/verify-panel-ui.mjs http://127.0.0.1:3001
```

本机没装 playwright 浏览器时会自动用系统 Chrome。脚本会写库，**别对着生产库跑** —— 或先备份 `server/data/panel.db`。

> 模板自带的 `tests/e2e/`、`playwright.config.ts`、Storybook 等工具链已随 SaaS-Boilerplate 模板壳一并移除（2026-10）。

⚠️ **改完前端代码跑 `next start` 的场合，必须先 `npm run build` 再重启进程。**
`next start` 只认构建产物，且启动后会把构建清单缓存在内存里：如果进程运行期间你删过/重建过 `.next`，
它会继续按旧清单返回 `/_next/static/*`，样式表 404，页面变成一堆无样式裸文本（重启即恢复）。

- 依赖声明 `node>=24`，本机 v22 只出 warning，实测正常。
- 浏览器直连 `http://127.0.0.1:3001` 时可能因代理设置出现 `ERR_TOO_MANY_REDIRECTS`，
  改用局域网 IP（如 `http://192.168.x.x:3001`）即可 —— 与代码无关。
