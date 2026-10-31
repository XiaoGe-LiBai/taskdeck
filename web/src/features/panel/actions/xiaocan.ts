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
