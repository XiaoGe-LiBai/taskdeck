'use server';

import { revalidatePath } from 'next/cache';
import { panelSend } from '@/libs/PanelApi';

/** 公告域：发布 / 编辑（版本号 +1）/ 删除。 */
type _prev = string;

export async function saveAnnouncementAction(
  _state: _prev,
  formData: FormData,
): Promise<string> {
  const id = Number(formData.get('id')) || 0;
  const title = String(formData.get('title') ?? '').trim();
  const content = String(formData.get('content') ?? '').trim();
  if (!title || !content) {
    return 'error:请填写标题与内容';
  }
  const result = id
    ? await panelSend('PUT', `/admin/announcements/${id}`, { title, content })
    : await panelSend('POST', '/admin/announcements', { title, content });
  revalidatePath('/dashboard/announcements');
  return result.ok ? (id ? 'ok:已保存（版本号 +1）' : 'ok:公告已发布') : `error:${result.msg}`;
}

export async function deleteAnnouncementAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('id'));
  const result = await panelSend('DELETE', `/admin/announcements/${id}`);
  revalidatePath('/dashboard/announcements');
  return result.ok ? 'ok:公告已删除' : `error:${result.msg || '删除失败'}`;
}
