/** 后端（server/，Flask）返回的数据结构（只声明前端用到的字段） */

export type PanelStats = {
  users: number;
  accounts: number;
  vip_accounts: number;
  cards_total: number;
  cards_used: number;
  points_issued: number;
  points_spent: number;
  vip_levels: Record<string, number>;
};

export type PanelUserRow = {
  id: number;
  email: string;
  nickname: string;
  role: 'admin' | 'user';
  status: 'normal' | 'banned';
  channel?: string;
  points_balance: number;
  points_spent: number;
  slot_total?: number;
  slot_used?: number;
  vip_level?: number;
  /** 生效等级：已过期回落为 0（后端算好给前端，前端不重复判断到期） */
  vip_level_effective?: number;
  /** 等级显示名（普通会员/高级会员/至尊会员）——后端下发，前端不要自己拼 */
  vip_level_name?: string;
  vip_expire?: string | null;
  token_version?: number;
  remark?: string;
  invite_code?: string;
  inviter_id?: number | null;
  last_login_ip: string;
  last_login_time: string | null;
  created_time: string;
  accounts?: number;
  same_ip_count?: number;
};

export type PanelTransactionRow = {
  id: number;
  amount: number;
  type: string;
  note: string;
  created_time: string;
};

export type PanelUserDetail = {
  user: PanelUserRow;
  accounts: Array<{
    id: number;
    nickname: string;
    account_info: string;
    xc_user_id: string;
    avatar: string;
    vip_level: number;
    is_plus: number;
    status: 'enabled' | 'disabled';
    admin_paused: number;
    membership_expire: string | null;
    token_expire: string | null;
    remark: string;
    bind_time: string;
    updated_time: string;
    features: Record<string, boolean>;
  }>;
  yyb_accounts: Array<{
    id: number;
    endpoint_id: number;
    ref: string;
    label: string;
    created_time: string;
    endpoint_name?: string;
  }>;
  submissions: Array<{
    id: number;
    project_key: string;
    script_name: string;
    account: string;
    points_cost: number;
    status: string;
    result_msg: string;
    created_time: string;
  }>;
  transactions: Array<{
    id: number;
    amount: number;
    type: string;
    note: string;
    created_time: string;
  }>;
  login_logs: Array<{
    id: number;
    ip: string;
    user_agent: string;
    status: string;
    created_time: string;
  }>;
  hidden_projects: Array<{
    id: number;
    name: string;
    channel: string;
    project_key: string;
    granted: boolean;
  }>;
  invite_stats: {
    invites_count: number;
    inviter: {
      id: number;
      email: string;
      nickname: string;
    } | null;
  };
  notifications: Array<{
    id: number;
    title: string;
    content: string;
    type: string;
    is_read: number;
    created_time: string;
  }>;
};

export type PanelAdminAuditLogRow = {
  id: number;
  admin_id: number;
  admin_email: string;
  target_user_id: number | null;
  action: string;
  detail: string;
  ip: string;
  created_time: string;
};

export type PanelAccountRow = {
  id: number;
  user_id: number;
  nickname: string;
  account_info: string;
  vip_level: number;
  status: 'enabled' | 'disabled';
  membership_expire: string | null;
  token_expire: string | null;
  bind_time: string;
  remark: string;
  user_nickname: string;
  user_email: string;
  default_panel_name: string;
  default_panel_remark: string;
  brand_panel_name: string;
  brand_panel_remark: string;
  features: Record<string, boolean>;
};

export type PanelCardRow = {
  id: number;
  code: string;
  tier_id: number | null;
  tier_name: string | null;
  points_value: number;
  status: 'unused' | 'used' | 'void';
  user_id: number | null;
  created_time: string;
};

export type PanelCardTier = {
  id: number;
  name: string;
  points_value: number;
  price: number;
  /** 排序，小的在前；新增/编辑档位时维护 */
  sort_order: number;
  status: string;
};

export type PanelList<T> = {
  records: T[];
  total: number;
  page: number;
  size: number;
  stats?: {
    total: number;
    admins: number;
    normal: number;
    banned: number;
    total_points: number;
    total_spent: number;
  };
};

export type PanelQlPanel = {
  id: number;
  name: string;
  remark: string;
  url: string;
  /** 主凭据：青龙 OpenAPI（Client ID / Secret） */
  client_id: string;
  has_secret: boolean;
  /** 备用凭据：仅「查看日志内容」用，可留空 */
  username: string;
  has_password: boolean;
  status: 'online' | 'offline' | 'unknown';
  last_check: string | null;
};

export type PanelXiaocanTask = {
  id: number;
  name: string;
  status: string;
  error?: string;
  tasks: {
    id: number;
    name: string;
    command: string;
    schedule: string;
    isDisabled: boolean;
    managed: boolean;
  }[];
};

type PanelTaskLogEntry = {
  panel_id: number;
  panel_name: string;
  time: string;
  file: string;
  output: string;
  state: 'success' | 'error' | 'unknown';
};

type PanelTaskLogEvent = {
  task_key: string;
  task_name: string;
  time: string;
  state: 'success' | 'error' | 'unknown';
  panel_count: number;
  entries: PanelTaskLogEntry[];
};

export type PanelTaskLogs = {
  date: string;
  tasks: { key: string; name: string }[];
  events: PanelTaskLogEvent[];
};

export type PanelFailure = {
  run_date: string;
  account_info: string;
  nickname: string;
  vip_level: number;
  panel_name: string;
  reason: string;
};

/** 通知渠道元数据：由后端 notify.CHANNELS 下发，前端不硬编码渠道清单 */
export type NotifyChannelSpec = {
  key: string;
  label: string;
  fields: string[];
  secret_fields: string[];
  hint: string;
  configured: boolean;
};

export type PanelSettings = {
  site_name: string;
  /** 站点对外地址（如 https://panel.example.com）。邮件里的 logo 与链接要用绝对地址 */
  site_url: string;
  /** "true" / "false"：是否启用自定义站点图标（单独由开关切换，不随主表单提交） */
  site_logo_enabled: string;
  /** 后端附带：有没有上传过图标文件（"true" / "false"） */
  site_logo_has_file?: string;
  /** 后端附带：已上传图标的地址（**与开关无关**，供设置页预览用）；没传过为空串 */
  site_logo_url?: string;
  register_enabled: string;
  referral_rate_bps: string;
  /** 每日签到：基础固定奖励（分） */
  checkin_daily_reward: string;
  /** 连签额外加成（分，逗号分隔，第 6 天起依次生效） */
  checkin_rewards: string;
  /** 赌狗签到：奖励池（分），可含负数与 0，随机抽一个 */
  checkin_gamble_rewards: string;
  /** 补签：每次消耗（分） */
  checkin_makeup_cost: string;
  /** 补签：每月次数上限 */
  checkin_makeup_quota: string;
  /** 小蚕账号等级：每天自动从平台刷一遍 */
  level_refresh_enabled: string;
  /** 自动刷新的时刻（0-23） */
  level_refresh_hour: string;
  /** 通知渠道清单（后端下发） */
  notify_channels?: NotifyChannelSpec[];
  /** 邮件服务：SMTP 主机；留空 = 关闭发信（验证码只写后端 data/mail.log） */
  smtp_host: string;
  smtp_port: string;
  /** "true" / "false"：465 用 SSL，587 用 STARTTLS */
  smtp_ssl: string;
  smtp_user: string;
  /** 后端永远不回传明文，这里恒为空串；留空提交 = 不修改 */
  smtp_password: string;
  /** 后端附带：授权码是否已配置（"true" / "false"） */
  smtp_password_set?: string;
  smtp_sender: string;
  smtp_from_name: string;
};

/* ---------------------------------------------------------------- 我的报名/抢兑记录 */

export type PanelProduct = {
  id: number;
  code: string;
  name: string;
  product_type: string;
  grant_value: number;
  points_price: number;
  sort_order: number;
  status: string;
};

export type MySignupEvent = {
  kind: 'signup';
  id: number;
  account_id: number;
  account_nickname: string;
  tea_name: string;
  order_numbers: string;
  status: string;
  output: string;
  error: string;
  created_time: string;
  finished_time: string | null;
};

export type MyRedeemEvent = {
  kind: 'redeem';
  id: number;
  account_id: number;
  account_nickname: string;
  exchange_id: number | null;
  prize_name: string | null;
  yuanbao_cost: number | null;
  enabled: boolean;
  runner_ready: boolean;
  start_at: number | null;
  updated_time: string | null;
};

export type MyHistoryEvent = MySignupEvent | MyRedeemEvent;

export type MyHistory = {
  records: MyHistoryEvent[];
  signup_total: number;
  redeem_total: number;
};

/* ---------------------------------------------------------------- 应用宝（YYB） */

export type YybEndpoint = {
  id: number;
  name: string;
  base_url: string;
  username: string;
  has_password: boolean;
  has_token: boolean;
  status: 'online' | 'offline' | 'unknown';
  last_check: string | null;
};

export type YybStatus = {
  online: boolean;
  accounts: number;
  msg: string;
  last_check: string;
  qinglong: { configured?: boolean; connected?: boolean; msg?: string } | null;
  version?: { version?: string; commit?: string; build_date?: string };
};

export type YybAccount = {
  id: number;
  openid: string;
  openid_masked: string;
  uin: number;
  alias: string;
  nickname: string;
  remark: string;
  display_name: string;
  avatar: string;
  status: 'alive' | 'expired' | 'unknown';
  credential_expires_at?: number;
  credential_expires_in?: number;
  rescan_recommended?: boolean;
  last_checked_at?: number;
  user_id?: number | null;
  owner_email?: string;
  owner_nickname?: string;
};

type YybJob = {
  script_key: string;
  name?: string;
  ql_cron_id?: number;
  schedule?: string;
  enabled?: boolean;
  last_run_at?: string;
  last_status?: string;
};

export type YybJobsPayload = {
  account?: YybAccount;
  count: number;
  jobs: YybJob[];
};

/** 「脚本 × 账号」绑定矩阵：一行代表一个脚本该跑哪些账号 */
export type YybBindingScript = {
  script_key: string;
  cron_id: number | null;
  name: string;
  env_name: string;
  app_id: string;
  refs: string[];
  /** refs 的来源：env（青龙变量）/ task_before（任务前缀）/ manual（面板里改的）/ none */
  source: string;
  schedule: string;
  enabled: number;
  is_hidden?: number;
  is_yyb_server?: boolean;
  unknown_refs?: string[];
  updated_time?: string;
};

export type YybBindingAccount = {
  ref: string;
  id: number;
  uin: string;
  openid: string;
  label: string;
  status: string;
};

export type YybBindingsPayload = {
  scripts: YybBindingScript[];
  accounts: YybBindingAccount[];
  qinglong: { id: number; name: string; base_url: string } | null;
  stats: {
    scripts: number;
    accounts: number;
    bound: number;
    empty: number;
    hidden?: number;
    unknown_refs: number;
  };
};

/** 用户活动管理接口响应 */
export type YybMyActivitiesPayload = {
  accounts: {
    ref: string;
    id: number;
    label: string;
    remark: string;
    nickname: string;
    status: string;
    active_count?: number;
  }[];
  activities: {
    id: number;
    script_key: string;
    name: string;
    clean_name: string;
    category: string;
    env_name: string;
    app_id: string;
    schedule: string;
    enabled: number;
    participating_refs: string[];
    total_participants: number;
  }[];
  categories: string[];
  stats: {
    total_activities: number;
    user_accounts: number;
  };
};

export type ScriptFieldParam = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'password' | 'number' | 'select';
  placeholder?: string;
  required: boolean;
  default_value?: string;
  options?: { label: string; value: string }[];
  env_mapping?: string;
};

export type PanelProject = {
  id: number;
  project_key: string;
  channel: string;
  channel_label: string;
  name: string;
  ref_id?: string;
  points_cost: number;
  hidden: number;
  /** 最低会员等级门槛（0 = 不限） */
  min_vip_level?: number;
  status: string;
  sort_order?: number;
  description?: string;
  submit_mode?: string;
  field_config?: ScriptFieldParam[];
  target_script?: string;
  env_name?: string;
  env_template?: string;
  grants?: { user_id: number; email: string; nickname: string }[];
};

export type CustomSubmission = {
  id: number;
  user_id: number;
  project_id: number;
  project_key: string;
  script_name: string;
  account: string;
  params_data: Record<string, string>;
  points_cost: number;
  status: string;
  result_msg: string;
  created_time: string;
  updated_time: string;
  user_email?: string;
  user_nickname?: string;
};

export type PanelAnnouncement = {
  id: number;
  title: string;
  content: string;
  version: number;
  published_time: string;
  updated_time: string | null;
};

export type PanelAccount = PanelAccountRow;
