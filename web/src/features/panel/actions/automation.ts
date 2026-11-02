'use server';

import { panelSend } from '@/libs/PanelApi';

/**
 * 自动化任务：三组卡片（秒杀 / 日常 / 资产提醒）与逐账号开关。
 */

export type AutomationTask = {
  key: string;
  label: string;
  tip: string;
  vip: string;
  time_label: string;
  /** script=青龙脚本按 cron 跑；builtin=本服务按时段执行 */
  executor: 'script' | 'builtin';
  script: string;
  /** 只有真会用这些参数的任务才有定义 */
  param_defs: ParamDef[];
  enabled_account_ids: number[];
  enabled_count: number;
  account_count: number;
};

export type AutomationGroup = {
  key: 'member' | 'daily' | 'custom';
  label: string;
  hint: string;
  tasks: AutomationTask[];
};

export type AutomationOverview = {
  groups: AutomationGroup[];
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
};

export async function fetchAutomationAction(): Promise<
  { ok: true; data: AutomationOverview } | { ok: false; error: string }
> {
  const resp = await panelSend<AutomationOverview>('GET', '/xiaocan/automation');
  if (!resp.ok || !resp.data) {
    return { ok: false, error: resp.msg || '读取自动化任务失败' };
  }
  return { ok: true, data: resp.data };
}

/** 开关某个任务在某个账号上的状态（脚本任务落 account_features，提醒任务落 automation_flags）。 */
export async function toggleAutomationTaskAction(
  accountId: number,
  taskKey: string,
  enabled: boolean,
): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> {
  const resp = await panelSend<{ enabled: boolean }>(
    'PUT',
    `/xiaocan/accounts/${accountId}/automation/${encodeURIComponent(taskKey)}`,
    { enabled },
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, error: resp.msg || '保存失败' };
  }
  return { ok: true, enabled: Boolean(resp.data.enabled) };
}

export type ParamOption = { label: string; value: string | number };

export type ParamDef = {
  key: string;
  label: string;
  type: 'int' | 'number' | 'text' | 'select' | 'check';
  def: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: ParamOption[];
  hint?: string;
};

export async function getAutomationParamsAction(
  accountId: number,
  taskKey: string,
): Promise<{ ok: true; params: Record<string, string | number | boolean>; defs: ParamDef[] } | { ok: false; error: string }> {
  const resp = await panelSend<{ params: Record<string, string | number | boolean>; param_defs: ParamDef[] }>(
    'GET',
    `/xiaocan/accounts/${accountId}/automation/${encodeURIComponent(taskKey)}/params`,
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, error: resp.msg || '读取参数失败' };
  }
  return { ok: true, params: resp.data.params ?? {}, defs: resp.data.param_defs ?? [] };
}

export async function saveAutomationParamsAction(
  accountId: number,
  taskKey: string,
  params: Record<string, string | number | boolean>,
): Promise<{ ok: true; params: Record<string, string | number | boolean> } | { ok: false; error: string }> {
  const resp = await panelSend<{ params: Record<string, string | number | boolean> }>(
    'PUT',
    `/xiaocan/accounts/${accountId}/automation/${encodeURIComponent(taskKey)}/params`,
    { params },
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, error: resp.msg || '保存失败' };
  }
  return { ok: true, params: resp.data.params ?? {} };
}
