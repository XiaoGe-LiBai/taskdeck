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
