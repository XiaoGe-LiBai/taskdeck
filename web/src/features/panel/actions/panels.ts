'use server';

import { revalidatePath } from 'next/cache';
import { panelSend } from '@/libs/PanelApi';

/** 青龙面板域：连通检测、一键下发托管任务、cron 运行/停止、面板增删。 */
type _prev = string;

export async function checkPanelAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('panel_id'));
  const result = await panelSend<{ status: string; msg: string }>('POST', `/admin/ql/panels/${id}/check`);
  revalidatePath('/dashboard/panels');
  if (!result.ok) {
    return `error:${result.msg}`;
  }
  return result.data?.status === 'online' ? 'ok:连接成功' : `error:连接失败 ${result.data?.msg ?? ''}`;
}

export async function provisionPanelAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('panel_id'));
  const result = await panelSend<{ count: number }>('POST', `/admin/ql/panels/${id}/provision`);
  revalidatePath('/dashboard/panels');
  return result.ok ? `provisioned:${result.data?.count ?? 0}` : `error:${result.msg}`;
}

export async function runCronAction(_state: _prev, formData: FormData): Promise<string> {
  const panelId = Number(formData.get('panel_id'));
  const cronId = Number(formData.get('cron_id'));
  const result = await panelSend('PUT', `/admin/ql/panels/${panelId}/proxy/api/crons/run`, { id: cronId });
  revalidatePath('/dashboard/panels');
  return result.ok ? 'ok:已发送运行指令' : `error:${result.msg || '运行失败'}`;
}

export async function stopCronAction(_state: _prev, formData: FormData): Promise<string> {
  const panelId = Number(formData.get('panel_id'));
  const cronId = Number(formData.get('cron_id'));
  const result = await panelSend('PUT', `/admin/ql/panels/${panelId}/proxy/api/crons/stop`, { id: cronId });
  revalidatePath('/dashboard/panels');
  return result.ok ? 'ok:已发送停止指令' : `error:${result.msg || '停止失败'}`;
}

export async function addPanelAction(_state: _prev, formData: FormData): Promise<string> {
  const url = String(formData.get('url') ?? '').trim();
  if (!url) {
    return 'error:请填写面板地址';
  }
  const result = await panelSend<{ id: number }>('POST', '/admin/ql/panels', {
    name: String(formData.get('name') ?? '青龙面板'),
    remark: String(formData.get('remark') ?? ''),
    url,
    client_id: String(formData.get('client_id') ?? '').trim(),
    client_secret: String(formData.get('client_secret') ?? ''),
    username: String(formData.get('username') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
  });
  revalidatePath('/dashboard/panels');
  return result.ok ? 'ok:面板已添加' : `error:${result.msg}`;
}

export async function deletePanelAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('panel_id'));
  const result = await panelSend('DELETE', `/admin/ql/panels/${id}`);
  revalidatePath('/dashboard/panels');
  return result.ok ? 'ok:面板已删除' : `error:${result.msg || '删除失败'}`;
}
