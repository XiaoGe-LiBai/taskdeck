'use server';

import { revalidatePath } from 'next/cache';
import { panelSend } from '@/libs/PanelApi';

/**
 * 小蚕账号动作（管理员触发）。
 *
 * 后端 `POST /admin/xiaocan/accounts/<id>/daily` 会串行跑「元宝签到 → 会员签到抽奖 → 任务总览」，
 * 逐条返回结果；单步失败不影响其它步骤，所以这里把 steps 原样交给界面展示。
 */
export type XcDailyStep = {
  step: string;
  ok: boolean;
  /** 上游提示「已签到 / 已领取」时为 true：不算失败 */
  skipped: boolean;
  error: string;
};

export type XcDailyResult = {
  ok: boolean;
  failed: number;
  skipped: number;
  steps: XcDailyStep[];
};

export async function runXiaocanDailyAction(
  accountId: number,
): Promise<{ ok: boolean; msg: string; result?: XcDailyResult }> {
  const resp = await panelSend<XcDailyResult>(
    'POST',
    `/admin/xiaocan/accounts/${accountId}/daily`,
    {},
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, msg: resp.msg || '执行失败' };
  }
  revalidatePath('/dashboard/users');
  return { ok: true, msg: '', result: resp.data };
}

/** 账号所有者视角：走用户级接口，后端按 user_id 校验归属。 */
export async function runMyXiaocanDailyAction(
  _prev: string,
  formData: FormData,
): Promise<string> {
  const accountId = Number(formData.get('account_id') ?? 0);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return 'error:账号参数错误';
  }
  const resp = await panelSend<XcDailyResult>('POST', `/xiaocan/accounts/${accountId}/daily`, {});
  if (!resp.ok || !resp.data) {
    return `error:${resp.msg || '执行失败'}`;
  }
  revalidatePath('/dashboard/accounts');
  return formatDaily(resp.data);
}

/** 管理员视角：列表里对任意账号执行一次日常。 */
export async function runAdminXiaocanDailyAction(
  _prev: string,
  formData: FormData,
): Promise<string> {
  const accountId = Number(formData.get('account_id') ?? 0);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return 'error:账号参数错误';
  }
  const res = await runXiaocanDailyAction(accountId);
  if (!res.ok || !res.result) {
    return `error:${res.msg || '执行失败'}`;
  }
  return formatDaily(res.result);
}

function formatDaily(result: XcDailyResult): string {
  const summary = result.steps
    .map(s => `${s.step}${s.ok ? ' ✓' : s.skipped ? ' (已做过)' : ` ✗ ${s.error}`}`)
    .join('；');
  return result.ok ? `ok:${summary}` : `error:${summary}`;
}

export type StoreItem = Record<string, unknown>;

export type StoresResult = {
  ok: boolean;
  msg: string;
  items: StoreItem[];
  /** explore 会带总数，feed/search 没有就为 0 */
  total: number;
};

/** 店铺检索：附近(feed) / 关键词(search) / 到店(explore)。定位来自页面，不落库。 */
export async function fetchStoresAction(params: {
  accountId: number;
  kind: 'feed' | 'search' | 'explore';
  q?: string;
  lat: string;
  lon: string;
  cityCode: string;
  offset?: number;
}): Promise<StoresResult> {
  const query = new URLSearchParams({
    lat: params.lat,
    lon: params.lon,
    city_code: params.cityCode,
    offset: String(params.offset ?? 0),
    limit: '20',
  });
  if (params.kind === 'search') {
    query.set('q', (params.q ?? '').trim());
  }
  const resp = await panelSend<Record<string, unknown>>(
    'GET',
    `/xiaocan/accounts/${params.accountId}/stores/${params.kind}?${query.toString()}`,
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, msg: resp.msg || '拉取失败', items: [], total: 0 };
  }
  const data = resp.data as { items?: StoreItem[]; count?: number };
  return {
    ok: true,
    msg: '',
    items: Array.isArray(data.items) ? data.items : [],
    total: Number(data.count ?? 0),
  };
}

/** 清空运行日志（只清当前用户可见范围）。 */
export async function clearJobLogsAction(): Promise<string> {
  const resp = await panelSend<{ cleared: number }>('DELETE', '/xiaocan/job-logs');
  if (!resp.ok) {
    return `error:${resp.msg || '清空失败'}`;
  }
  revalidatePath('/dashboard/assistant');
  return `ok:已清空 ${resp.data?.cleared ?? 0} 条日志`;
}

export type DualRebateStore = {
  name: string;
  count: number;
  items: StoreItem[];
};

/** 同店多方案扫描：同一家店出现 2 个以上返利方案时返回分组结果。 */
export async function fetchDualRebateStoresAction(params: {
  accountId: number;
  lat: string;
  lon: string;
  cityCode: string;
  q?: string;
}): Promise<{ ok: boolean; msg: string; stores: DualRebateStore[] }> {
  const query = new URLSearchParams({
    lat: params.lat,
    lon: params.lon,
    city_code: params.cityCode,
  });
  if (params.q) {
    query.set('q', params.q);
  }
  const resp = await panelSend<{ stores?: DualRebateStore[] }>(
    'GET',
    `/xiaocan/accounts/${params.accountId}/stores/dual-rebate?${query.toString()}`,
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, msg: resp.msg || '扫描失败', stores: [] };
  }
  return { ok: true, msg: '', stores: resp.data.stores ?? [] };
}

/** 直接抢单（不经表单）：返回可读结果，供列表里的按钮调用。 */
export async function grabPromotionAction(params: {
  accountId: number;
  promotionId: string;
  advance?: boolean;
  lat?: string;
  lon?: string;
  cityCode?: string;
  at?: string;
}): Promise<{ ok: boolean; msg: string }> {
  const payload: Record<string, unknown> = {
    promotion_id: params.promotionId,
    advance: Boolean(params.advance),
    lat: params.lat || undefined,
    lon: params.lon || undefined,
    city_code: params.cityCode || undefined,
  };
  if (params.at) {
    payload.at = params.at;
  }
  const resp = await panelSend<{ id: string; at: string }>(
    'POST',
    `/xiaocan/accounts/${params.accountId}/grab`,
    payload,
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, msg: resp.msg || '提交失败' };
  }
  revalidatePath('/dashboard/xiaocan');
  return { ok: true, msg: `已排队，计划 ${resp.data.at}` };
}

export type GrabJob = {
  id: string;
  account_id: number;
  status?: string;
  at?: string;
  promotion_id?: string;
  title?: string;
};

/** 预约与监听列表：进程内抢单任务 + 等级刷新开关。 */
export async function fetchSchedulerAction(): Promise<{ ok: boolean; jobs: GrabJob[]; levelRefresh: boolean }> {
  const resp = await panelSend<{ grab_jobs?: GrabJob[]; level_refresh?: boolean }>(
    'GET',
    '/xiaocan/scheduler',
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, jobs: [], levelRefresh: false };
  }
  return { ok: true, jobs: resp.data.grab_jobs ?? [], levelRefresh: Boolean(resp.data.level_refresh) };
}

/** 抢单/预约：at 为空立即抢；填 datetime-local 则到点触发。 */
export async function scheduleGrabAction(_prev: string, formData: FormData): Promise<string> {
  const accountId = Number(formData.get('account_id') ?? 0);
  const promotionId = String(formData.get('promotion_id') ?? '').trim();
  const at = String(formData.get('at') ?? '').trim();
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return 'error:请选择账号';
  }
  if (!promotionId) {
    return 'error:请填写活动 ID';
  }
  const payload: Record<string, unknown> = {
    promotion_id: promotionId,
    advance: formData.get('advance') === 'on',
    lat: String(formData.get('lat') ?? '').trim() || undefined,
    lon: String(formData.get('lon') ?? '').trim() || undefined,
    city_code: String(formData.get('city_code') ?? '').trim() || undefined,
  };
  if (at) {
    payload.at = at;
  }
  const resp = await panelSend<{ id: string; at: string }>(
    'POST',
    `/xiaocan/accounts/${accountId}/grab`,
    payload,
  );
  if (!resp.ok || !resp.data) {
    return `error:${resp.msg || '提交失败'}`;
  }
  revalidatePath('/dashboard/assistant');
  return `ok:任务 ${resp.data.id} 已排队，计划 ${resp.data.at}`;
}

export type XcActionParam = { name: string; required: boolean; default: unknown; type: 'int' | 'str' };
export type XcAction = { key: string; params: XcActionParam[] };

/** 执行一个允许清单内的小蚕动作。 */
export async function callXiaocanAction(
  accountId: number,
  action: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; msg: string; data?: unknown }> {
  const resp = await panelSend<Record<string, unknown>>(
    'POST',
    `/xiaocan/accounts/${accountId}/call`,
    { action, params },
  );
  if (!resp.ok) {
    return { ok: false, msg: resp.msg || '执行失败' };
  }
  revalidatePath('/dashboard/assistant');
  return { ok: true, msg: '', data: resp.data };
}

// ---------------------------------------------------------------- 美团

export type MeituanSession = {
  id: string;
  status: 'waiting' | 'success' | 'failed' | 'expired' | 'cancelled';
  url: string;
  qr: string;
  message: string;
  has_token: boolean;
};

export type MeituanAccount = {
  id: number;
  account_id: number | null;
  nickname: string;
  token_mask: string;
  saved_at: number;
  last_claimed_at: number;
};

export async function startMeituanAuthAction(accountId?: number): Promise<{ ok: boolean; msg: string; session?: MeituanSession }> {
  const resp = await panelSend<MeituanSession>('POST', '/xiaocan/meituan/auth/start', { account_id: accountId });
  return resp.ok && resp.data ? { ok: true, msg: '', session: resp.data } : { ok: false, msg: resp.msg || '发起失败' };
}

export async function pollMeituanAuthAction(sessionId: string): Promise<MeituanSession | null> {
  const resp = await panelSend<MeituanSession>('GET', `/xiaocan/meituan/auth/poll?session_id=${encodeURIComponent(sessionId)}`);
  return resp.ok ? resp.data : null;
}

export async function cancelMeituanAuthAction(sessionId: string): Promise<void> {
  await panelSend('POST', '/xiaocan/meituan/auth/cancel', { session_id: sessionId });
}

export async function saveMeituanTokenAction(_prev: string, formData: FormData): Promise<string> {
  const token = String(formData.get('token') ?? '').trim();
  const accountId = Number(formData.get('account_id') ?? 0) || undefined;
  if (!token) {
    return 'error:请粘贴美团凭证';
  }
  const resp = await panelSend('POST', '/xiaocan/meituan/accounts', { token, account_id: accountId });
  if (!resp.ok) {
    return `error:${resp.msg || '保存失败'}`;
  }
  revalidatePath('/dashboard/assistant');
  return 'ok:美团凭证已保存';
}

export async function deleteMeituanAccountAction(_prev: string, formData: FormData): Promise<string> {
  const id = Number(formData.get('record_id') ?? 0);
  const resp = await panelSend('DELETE', `/xiaocan/meituan/accounts/${id}`);
  if (!resp.ok) {
    return `error:${resp.msg || '删除失败'}`;
  }
  revalidatePath('/dashboard/assistant');
  return 'ok:已删除';
}

export async function claimMeituanAction(): Promise<{ ok: boolean; msg: string; data?: unknown }> {
  const resp = await panelSend<Record<string, unknown>>('POST', '/xiaocan/meituan/claim', {});
  if (!resp.ok) {
    return { ok: false, msg: resp.msg || '领券失败' };
  }
  revalidatePath('/dashboard/assistant');
  return { ok: true, msg: '', data: resp.data };
}

// ---------------------------------------------------------------- 霸王餐订单

export type XcOrder = {
  id: number;
  account_id: number | null;
  store_name: string;
  platform: string;
  order_money: number;
  rebate_money: number;
  status: string;
  order_sn: string;
  platform_order_id: string;
  promotion_order_id: number;
  order_type: number;
  rebate_ratio: number;
  note: string;
  created_time: string;
  updated_time: string | null;
  settled_time: string | null;
};

/** 改订单字段或状态；状态变化会触发后端通知并自动补结算时间。 */
export async function updateOrderAction(
  orderId: number,
  payload: Partial<Pick<XcOrder, 'status' | 'store_name' | 'order_money' | 'rebate_money' | 'note'>>,
): Promise<{ ok: boolean; msg: string }> {
  const resp = await panelSend<XcOrder>('PUT', `/xiaocan/orders/${orderId}`, payload);
  if (!resp.ok || !resp.data) {
    return { ok: false, msg: resp.msg || '修改失败' };
  }
  revalidatePath('/dashboard/assistant');
  revalidatePath('/dashboard/history');
  return { ok: true, msg: '' };
}

export async function createOrderAction(_prev: string, formData: FormData): Promise<string> {
  const payload: Record<string, unknown> = {
    account_id: Number(formData.get('account_id') ?? 0) || undefined,
    store_name: String(formData.get('store_name') ?? '').trim(),
    platform: String(formData.get('platform') ?? 'meituan'),
    order_money: Number(formData.get('order_money') ?? 0),
    rebate_money: Number(formData.get('rebate_money') ?? 0),
    order_sn: String(formData.get('order_sn') ?? '').trim() || undefined,
  };
  const resp = await panelSend('POST', '/xiaocan/orders', payload);
  if (!resp.ok) {
    return `error:${resp.msg || '录入失败'}`;
  }
  revalidatePath('/dashboard/assistant');
  return 'ok:订单已录入';
}

export async function deleteOrderAction(_prev: string, formData: FormData): Promise<string> {
  const id = Number(formData.get('order_id') ?? 0);
  const resp = await panelSend('DELETE', `/xiaocan/orders/${id}`);
  if (!resp.ok) {
    return `error:${resp.msg || '删除失败'}`;
  }
  revalidatePath('/dashboard/assistant');
  return 'ok:已删除';
}

export async function submitPlatformIdAction(_prev: string, formData: FormData): Promise<string> {
  const id = Number(formData.get('order_id') ?? 0);
  const platformOrderId = String(formData.get('platform_order_id') ?? '').trim();
  if (!platformOrderId) {
    return 'error:请填写外卖平台单号';
  }
  const resp = await panelSend('POST', `/xiaocan/orders/${id}/submit-platform-id`, {
    platform_order_id: platformOrderId,
  });
  if (!resp.ok) {
    return `error:${resp.msg || '提交失败'}`;
  }
  revalidatePath('/dashboard/assistant');
  return 'ok:外卖单号已提交审核';
}

export async function orderAction(
  orderId: number,
  action: 'delay-voucher' | 'use-free-card',
): Promise<{ ok: boolean; msg: string }> {
  const resp = await panelSend('POST', `/xiaocan/orders/${orderId}/${action}`, {});
  revalidatePath('/dashboard/assistant');
  return resp.ok ? { ok: true, msg: '' } : { ok: false, msg: resp.msg || '执行失败' };
}

// ---------------------------------------------------------------- 店铺监控

export type StoreWatch = {
  id: number;
  account_id: number;
  kind: string;
  params: { keyword?: string; promotion_id?: string; lat?: string; lon?: string; city_code?: string };
  interval_sec: number;
  status: string;
  hits: number;
  last_run: number;
  last_error: string;
};

export async function createWatchAction(_prev: string, formData: FormData): Promise<string> {
  const kind = String(formData.get('kind') ?? 'name');
  const params: Record<string, string> = {
    lat: String(formData.get('lat') ?? '').trim(),
    lon: String(formData.get('lon') ?? '').trim(),
    city_code: String(formData.get('city_code') ?? '').trim(),
  };
  const keyword = String(formData.get('keyword') ?? '').trim();
  const promotionId = String(formData.get('promotion_id') ?? '').trim();
  if (keyword) {
    params.keyword = keyword;
  }
  if (promotionId) {
    params.promotion_id = promotionId;
  }
  const resp = await panelSend('POST', '/xiaocan/watch', {
    account_id: Number(formData.get('account_id') ?? 0),
    kind,
    params,
    interval_sec: Number(formData.get('interval_sec') ?? 300),
  });
  if (!resp.ok) {
    return `error:${resp.msg || '创建失败'}`;
  }
  revalidatePath('/dashboard/assistant');
  return 'ok:监控已创建';
}

export async function deleteWatchAction(_prev: string, formData: FormData): Promise<string> {
  const id = Number(formData.get('watch_id') ?? 0);
  const resp = await panelSend('DELETE', `/xiaocan/watch/${id}`);
  revalidatePath('/dashboard/assistant');
  return resp.ok ? 'ok:已删除' : `error:${resp.msg || '删除失败'}`;
}

export async function setWatchStatusAction(
  watchId: number,
  status: 'active' | 'paused',
): Promise<{ ok: boolean; msg: string }> {
  const resp = await panelSend('POST', `/xiaocan/watch/${watchId}/status`, { status });
  revalidatePath('/dashboard/assistant');
  return resp.ok ? { ok: true, msg: '' } : { ok: false, msg: resp.msg || '操作失败' };
}

export async function runWatchAction(watchId: number): Promise<{ ok: boolean; msg: string }> {
  const resp = await panelSend<{ new: unknown[]; scanned: number }>('POST', `/xiaocan/watch/${watchId}/run`, {});
  revalidatePath('/dashboard/assistant');
  if (!resp.ok || !resp.data) {
    return { ok: false, msg: resp.msg || '执行失败' };
  }
  return { ok: true, msg: `扫描 ${resp.data.scanned} 条，新增 ${resp.data.new.length} 条` };
}

export type WatchHit = {
  item_key: string;
  title: string;
  detail: string;
  first_seen: string;
};

/** 改监控条件与间隔；类型不可改，后端会拒绝并提示删除重建。 */
export async function updateWatchAction(
  watchId: number,
  payload: { params?: StoreWatch['params']; interval_sec?: number },
): Promise<{ ok: boolean; msg: string }> {
  const resp = await panelSend<StoreWatch>('PUT', `/xiaocan/watch/${watchId}`, payload);
  if (!resp.ok) {
    return { ok: false, msg: resp.msg || '修改失败' };
  }
  revalidatePath('/dashboard/assistant');
  return { ok: true, msg: '' };
}

/** 命中流水：错过的通知还能回看。 */
export async function fetchWatchHitsAction(
  watchId: number,
): Promise<{ ok: boolean; msg: string; hits: WatchHit[] }> {
  const resp = await panelSend<{ hits: WatchHit[] }>(
    'GET',
    `/xiaocan/watch/${watchId}/hits?limit=100`,
  );
  return {
    ok: resp.ok,
    msg: resp.ok ? '' : (resp.msg || '读取失败'),
    hits: resp.ok ? (resp.data?.hits ?? []) : [],
  };
}

export async function resetWatchSeenAction(
  watchId: number,
): Promise<{ ok: boolean; msg: string }> {
  const resp = await panelSend<{ cleared: number }>('POST', `/xiaocan/watch/${watchId}/reset-seen`, {});
  if (!resp.ok) {
    return { ok: false, msg: resp.msg || '重置失败' };
  }
  revalidatePath('/dashboard/assistant');
  return { ok: true, msg: `已清空 ${resp.data?.cleared ?? 0} 条去重记录，同样的条目会重新提醒` };
}

// ---------------------------------------------------------------- 资产工作台

/** 后端 `/overview` 的分段名，与 server/xiaocan_console.py 的 SECTIONS 一一对应。 */
export type XcOverviewSection
  = | 'profile'
    | 'assets'
    | 'tasks'
    | 'points'
    | 'signin'
    | 'lottery'
    | 'rain'
    | 'freeorder'
    | 'cards'
    | 'redpacks';

export type XcTaskItem = {
  id: number | null;
  title: string;
  desc: string;
  icon: string;
  point: number;
  completed: number;
  /** 只有上游 completed==3 才算可领取 */
  claimable: boolean;
};

export type XcCardItem = {
  id: number | null;
  name: string;
  desc: string;
  pic: string;
  card_type: number | null;
  category: string;
  expire_time: number;
  status: number;
  count: number;
};

export type XcRedpackItem = {
  id: number | null;
  name: string;
  info: string;
  value_num: number;
  threshold_num: number;
  end_time: number;
  platforms: number[];
};

export type XcOverview = {
  ok: boolean;
  errors: Record<string, string>;
  sections: XcOverviewSection[];
  data: {
    profile?: {
      nickname: string;
      avatar: string;
      silk: number;
      withdrawing: number;
      withdraw_total: number;
      completed_number: number;
      phone: string;
      real_name: string;
      vip: {
        level: number;
        score: number;
        next_level_score: number;
        current_level_score: number;
        is_plus: boolean;
        expired_at: number;
      };
    };
    assets?: { yb_point: number; unreceived_points: number; exchanged_yb_point: number };
    tasks?: { items: XcTaskItem[]; claimable_count: number; claimable_point: number };
    points?: { points: number; items: Array<{ task_id: number | null; task_name: string; point: number; time: number }> };
    signin?: { days: number; records: Array<{ date: string; point: number }>; vip_signed_today: boolean };
    lottery?: { lucky_times: number; day_num: number; steps: Array<{ step: number; title: string; target: number; current: number; received: boolean }> };
    rain?: { has_event: boolean; event_id: number | null; begin_time: number; end_time: number; status: number };
    freeorder?: { had: boolean; used: boolean; card_id: number | null };
    cards?: { can_use_number: number; expiring_soon_number: number; items: XcCardItem[]; total: number };
    redpacks?: { num: number; items: XcRedpackItem[] };
  };
};

/** 按段读取小蚕资产；页面分两批拉，避免一次打出十几个网关请求。 */
export async function fetchXiaocanOverviewAction(
  accountId: number,
  sections: XcOverviewSection[],
  cityCode?: string,
): Promise<{ ok: boolean; msg: string; data?: XcOverview }> {
  const query = new URLSearchParams({ sections: sections.join(',') });
  if (cityCode && /^\d+$/.test(cityCode)) {
    query.set('city_code', cityCode);
  }
  const resp = await panelSend<XcOverview>(
    'GET',
    `/xiaocan/accounts/${accountId}/overview?${query.toString()}`,
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, msg: resp.msg || '读取失败' };
  }
  return { ok: true, msg: '', data: resp.data };
}

/** 账号所有者（管理员亦可跨用户）执行一次日常：元宝签到 → 会员签到抽奖 → 任务总览。 */
export async function runXiaocanDailyForAccountAction(
  accountId: number,
): Promise<{ ok: boolean; msg: string; summary: string }> {
  const resp = await panelSend<XcDailyResult>('POST', `/xiaocan/accounts/${accountId}/daily`, {});
  if (!resp.ok || !resp.data) {
    return { ok: false, msg: resp.msg || '执行失败', summary: '' };
  }
  const summary = resp.data.steps
    .map(step => `${step.step}${step.ok ? ' ✓' : step.skipped ? '（已做过）' : ` ✗ ${step.error}`}`)
    .join('；');
  return { ok: resp.data.ok, msg: resp.data.ok ? '' : '部分步骤未成功', summary };
}

// ---------------------------------------------------------------- 小蚕凭据

export type XcCredential = {
  /** 四段串：备注#小蚕UserId#silk_id#token */
  text: string;
  nickname: string;
  silk_id: string;
  token_expire: string | null;
};

/** 取单个小蚕账号的凭据（可直接粘到开源版/其它工具导入）。 */
export async function readXiaocanCredentialAction(
  accountId: number,
): Promise<{ ok: true; data: XcCredential } | { ok: false; error: string }> {
  const resp = await panelSend<XcCredential>(
    'GET',
    `/xiaocan/accounts/${accountId}/credential`,
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, error: resp.msg || '读取小蚕凭据失败' };
  }
  return { ok: true, data: resp.data };
}
