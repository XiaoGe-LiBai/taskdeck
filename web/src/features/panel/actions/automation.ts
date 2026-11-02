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
  kind: 'script' | 'reminder';
  script: string;
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
