'use server';

import type { ScriptFieldParam } from '@/types/Panel';
import { revalidatePath } from 'next/cache';
import { panelSend } from '@/libs/PanelApi';

/* ---------------------------------------------------------------- 项目管理 */

/** 批量保存：积分价格 + 隐藏 + 单独授权，单次调用后端批量端点（事务原子生效） */
export async function projectsSaveAction(
  items: { id: number; points_cost: number; hidden: boolean }[],
  grants: Record<number, number[]> = {},
): Promise<string> {
  if (!items.length && !Object.keys(grants).length) {
    return 'ok:没有改动需要保存';
  }
  const result = await panelSend<{ updated: number; granted: number }>(
    'PUT',
    '/admin/projects/batch',
    { items, grants: Object.fromEntries(Object.entries(grants).map(([k, v]) => [k, v])) },
  );
  revalidatePath('/dashboard/projects');
  if (!result.ok) {
    return `error:${result.msg}`;
  }
  return `ok:已保存 ${result.data?.updated ?? items.length} 个项目（授权 ${result.data?.granted ?? 0} 条）`;
}

/* ---------------------------------------------------------------- 自定义脚本 */

export type CustomScriptPayload = {
  name: string;
  ref_id?: string;
  description?: string;
  points_cost: number;
  hidden: boolean;
  sort_order?: number;
  submit_mode?: string;
  env_name?: string;
  env_template?: string;
  target_script?: string;
  field_config: ScriptFieldParam[];
};

/** 管理员创建自定义对接脚本 */
export async function customScriptCreateAction(payload: CustomScriptPayload): Promise<string> {
  const result = await panelSend<any>('POST', '/admin/custom-scripts', payload);
  revalidatePath('/dashboard/projects');
  revalidatePath('/dashboard/market');
  if (!result.ok) {
    return `error:${result.msg}`;
  }
  return `ok:自定义脚本「${payload.name}」创建成功`;
}

/** 管理员更新自定义对接脚本 */
export async function customScriptUpdateAction(
  id: number,
  payload: Partial<CustomScriptPayload>,
): Promise<string> {
  const result = await panelSend<any>('PUT', `/admin/custom-scripts/${id}`, payload);
  revalidatePath('/dashboard/projects');
  revalidatePath('/dashboard/market');
  if (!result.ok) {
    return `error:${result.msg}`;
  }
  return `ok:脚本更新成功`;
}

/** 管理员删除自定义对接脚本 */
export async function customScriptDeleteAction(id: number): Promise<string> {
  const result = await panelSend<any>('DELETE', `/admin/custom-scripts/${id}`, {});
  revalidatePath('/dashboard/projects');
  revalidatePath('/dashboard/market');
  if (!result.ok) {
    return `error:${result.msg}`;
  }
  return `ok:脚本已删除`;
}

/** 用户提交脚本并按配置扣费执行 */
export async function projectSubmitAction(
  projectKey: string,
  params: Record<string, string>,
  note?: string,
): Promise<{ ok: boolean; msg: string; data?: any }> {
  const result = await panelSend<any>('POST', '/projects/submit', {
    project_key: projectKey,
    params,
    note,
  });
  revalidatePath('/dashboard/market');
  revalidatePath('/dashboard');
  if (!result.ok) {
    return { ok: false, msg: result.msg || '提交失败' };
  }
  return {
    ok: true,
    msg: result.data?.note || '提交成功',
    data: result.data,
  };
}
