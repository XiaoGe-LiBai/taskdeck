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
  created_time: string;
  note: string;
};

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
