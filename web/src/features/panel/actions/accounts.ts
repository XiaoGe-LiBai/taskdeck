'use server';

import { revalidatePath } from 'next/cache';
import { panelSend } from '@/libs/PanelApi';

/** 小蚕账号域：任务开关、到期时间、报名、删除、批量延长。 */
type _prev = string;

export async function toggleAccountStatusAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('account_id'));
  const status = String(formData.get('status') ?? 'enabled');
  const result = await panelSend('PUT', `/admin/accounts/${id}/status`, { status });
  revalidatePath('/dashboard/accounts');
  if (!result.ok) {
    return `error:${result.msg || '操作失败'}`;
  }
  return status === 'disabled' ? 'ok:已暂停' : 'ok:已启用';
}

export async function toggleAccountFeatureAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('account_id'));
  const name = String(formData.get('feature') ?? '');
  if (!id || !name) {
    return 'error:缺少参数';
  }
  const result = await panelSend('PUT', `/admin/accounts/${id}/features/${encodeURIComponent(name)}`, {});
  revalidatePath('/dashboard/accounts');
  return result.ok ? `ok:「${name}」已切换` : `error:${result.msg || '操作失败'}`;
}

/**
 * 普通用户视角的任务开关：走用户级接口（后端按 user_id 校验归属），
 * 与上面的管理员版本（/admin/accounts，需管理权限）区分开。
 */
export async function toggleOwnFeatureAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('account_id'));
  const name = String(formData.get('feature') ?? '');
  if (!id || !name) {
    return 'error:缺少参数';
  }
  const result = await panelSend('PUT', `/xiaocan/accounts/${id}/features/${encodeURIComponent(name)}`, {});
  revalidatePath('/dashboard/accounts');
  revalidatePath('/dashboard/xiaocan');
  return result.ok ? `ok:「${name}」已切换` : `error:${result.msg || '操作失败'}`;
}

function localDateTime(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export async function setAccountExpireAction(
  _state: _prev,
  formData: FormData,
): Promise<string> {
  const id = Number(formData.get('account_id'));
  const quick = String(formData.get('quick') ?? '');
  let value = String(formData.get('membership_expire') ?? '').trim();

  if (quick) {
    const now = new Date();
    if (quick === 'month') {
      // 到月底 23:59
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59);
      value = localDateTime(end);
    } else {
      const days = Number(quick) || 0;
      now.setDate(now.getDate() + days);
      value = localDateTime(now);
    }
  }

  const result = await panelSend('PUT', `/admin/accounts/${id}/membership-expire`, {
    membership_expire: value,
  });
  revalidatePath('/dashboard/accounts');
  return result.ok ? 'ok:已保存' : `error:${result.msg}`;
}

export async function signupAccountAction(
  _state: _prev,
  formData: FormData,
): Promise<string> {
  const id = Number(formData.get('account_id'));
  const teaName = String(formData.get('tea_name') ?? '').trim();
  const orderNumbers = String(formData.get('order_numbers') ?? '').trim();
  if (!id || !teaName || !orderNumbers) {
    return 'error:请填写奶茶名称和订单号';
  }
  const result = await panelSend<{ status: string; error?: string }>(
    'POST',
    `/xiaocan/accounts/${id}/signup`,
    { tea_name: teaName, order_numbers: orderNumbers },
  );
  revalidatePath('/dashboard/accounts');
  if (!result.ok) {
    return `error:${result.msg}`;
  }
  const status = result.data?.status ?? 'pending';
  const note = result.data?.error ? `（${result.data.error}）` : '';
  return status === 'running' || status === 'success'
    ? `ok:已派发到青龙执行${note}`
    : `ok:已提交，状态 ${status}${note}`;
}

export async function deleteAccountAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('account_id'));
  const result = await panelSend('DELETE', `/xiaocan/accounts/${id}`);
  revalidatePath('/dashboard/accounts');
  return result.ok ? 'ok:账号已删除' : `error:${result.msg || '删除失败'}`;
}

/** 批量改到期：单次调用后端批量端点（事务，全成功或全回滚） */
export async function batchExpireAction(_state: _prev, formData: FormData): Promise<string> {
  const ids = formData.getAll('ids').map(value => Number(value)).filter(Boolean);
  const days = Number(formData.get('days')) || 0;
  if (!ids.length) {
    return 'error:请先勾选账号';
  }
  const base = new Date();
  base.setDate(base.getDate() + days);
  const value = localDateTime(base);
  const result = await panelSend<{ updated: number }>('POST', '/admin/accounts/batch-expire', {
    ids,
    membership_expire: value,
  });
  revalidatePath('/dashboard/accounts');
  if (!result.ok) {
    return `error:${result.msg || '批量延长失败'}`;
  }
  return `ok:已延长 ${result.data?.updated ?? ids.length} 个账号`;
}

/* ---------------------------------------------------------------- 小蚕账号等级 */

/**
 * 刷新小蚕账号的**真实 SVIP 等级**（向小蚕平台查一次）。
 *
 * 注意：这是账号在**小蚕平台上**的等级，不是本站的会员等级。
 * 用户端只能刷自己的账号；管理端用下面那个可刷任意账号。
 */
export async function refreshOwnAccountLevelAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('account_id'));
  if (!id) {
    return 'error:缺少账号 ID';
  }
  const result = await panelSend<{ id: number; vip_level: number }>(
    'POST',
    `/xiaocan/accounts/${id}/refresh-level`,
    {},
  );
  revalidatePath('/dashboard/accounts');
  revalidatePath('/dashboard/xiaocan');
  if (!result.ok) {
    return `error:${result.msg || '刷新失败'}`;
  }
  return `ok:平台等级 SVIP${result.data?.vip_level ?? 0}`;
}

/** 刷新小蚕账号等级（管理端，可刷任意账号） */
export async function refreshAccountLevelAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('account_id'));
  if (!id) {
    return 'error:缺少账号 ID';
  }
  const result = await panelSend<{ id: number; vip_level: number }>(
    'POST',
    `/admin/accounts/${id}/refresh-level`,
    {},
  );
  revalidatePath('/dashboard/accounts');
  if (!result.ok) {
    return `error:${result.msg || '刷新失败'}`;
  }
  return `ok:平台等级 SVIP${result.data?.vip_level ?? 0}`;
}

/** 批量刷新账号等级（管理端）；没勾选就是全部 */
export async function refreshAccountLevelsAction(_state: _prev, formData: FormData): Promise<string> {
  const ids = formData.getAll('ids').map(value => Number(value)).filter(Boolean);
  const result = await panelSend<{
    updated: number;
    failed: Array<{ id: number; error: string }>;
  }>('POST', '/admin/accounts/refresh-levels', ids.length ? { ids } : {});
  revalidatePath('/dashboard/accounts');
  if (!result.ok) {
    return `error:${result.msg || '批量刷新失败'}`;
  }
  const updated = result.data?.updated ?? 0;
  const failed = result.data?.failed?.length ?? 0;
  // 逐个查平台，失败多半是凭据过期 —— 把条数说清楚，别让人以为全成功了
  return failed
    ? `ok:已刷新 ${updated} 个，${failed} 个失败（多为凭据过期，需重新绑定）`
    : `ok:已刷新 ${updated} 个账号的等级`;
}
