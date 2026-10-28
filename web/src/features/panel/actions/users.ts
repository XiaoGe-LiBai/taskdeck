'use server';

import { revalidatePath } from 'next/cache';
import { panelSend } from '@/libs/PanelApi';

/** 用户域：积分 / 车位 / 会员 / 项目授权 / 封禁 / 改密 / 批量操作 / 站内信下发 / 详情与流水查询。 */
type _prev = string;

export async function adjustUserPointsAction(
  _state: _prev,
  formData: FormData,
): Promise<string> {
  const id = Number(formData.get('user_id'));
  const amount = Number(formData.get('amount')) || 0;
  const note = String(formData.get('note') ?? '').trim() || '管理员调整';
  if (!id || amount === 0) {
    return 'error:请填写非 0 的积分变动值';
  }
  const result = await panelSend<{ balance: number }>('POST', `/admin/users/${id}/points`, {
    amount,
    note,
  });
  revalidatePath('/dashboard/users');
  return result.ok
    ? `ok:已调整，余额 ${result.data?.balance ?? 0} 分`
    : `error:${result.msg}`;
}

export async function toggleUserStatusAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('user_id'));
  const status = String(formData.get('status') ?? 'normal');
  const result = await panelSend('PUT', `/admin/users/${id}/status`, { status });
  revalidatePath('/dashboard/users');
  if (!result.ok) {
    return `error:${result.msg || '操作失败'}`;
  }
  return status === 'banned' ? 'ok:已封禁' : 'ok:已解封';
}

export async function toggleUserRoleAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('user_id'));
  const role = String(formData.get('role') ?? 'user');
  const result = await panelSend('PUT', `/admin/users/${id}/role`, { role });
  revalidatePath('/dashboard/users');
  if (!result.ok) {
    return `error:${result.msg || '操作失败'}`;
  }
  return role === 'admin' ? 'ok:已设为管理员' : 'ok:已取消管理员';
}

export async function renameUserAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('user_id'));
  const nickname = String(formData.get('nickname') ?? '').trim();
  if (!id || !nickname) {
    return 'error:昵称不能为空';
  }
  const result = await panelSend('PUT', `/admin/users/${id}/nickname`, { nickname });
  revalidatePath('/dashboard/users');
  return result.ok ? 'ok:昵称已更新' : `error:${result.msg}`;
}

export async function createUserAction(_state: _prev, formData: FormData): Promise<string> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '').trim();
  const nickname = String(formData.get('nickname') ?? '').trim();
  const channel = String(formData.get('channel') ?? 'xiaocan').trim();
  const role = String(formData.get('role') ?? 'user').trim();
  const slot_total = Number(formData.get('slot_total') ?? 0);

  if (!email || !email.includes('@')) {
    return 'error:请输入正确的邮箱地址';
  }
  if (password.length < 8) {
    return 'error:密码至少 8 位';
  }

  const result = await panelSend<{ id: number }>('POST', '/admin/users', {
    email,
    password,
    nickname,
    channel,
    role,
    slot_total,
  });
  revalidatePath('/dashboard/users');
  return result.ok ? 'ok:用户创建成功' : `error:${result.msg || '创建失败'}`;
}

export async function adjustUserSlotsAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('user_id'));
  const slot_total = Number(formData.get('slot_total'));
  const note = String(formData.get('note') ?? '').trim();
  if (!id || slot_total < 0) {
    return 'error:车位数不能小于 0';
  }
  const result = await panelSend('PUT', `/admin/users/${id}/slots`, {
    slot_total,
    note,
  });
  revalidatePath('/dashboard/users');
  return result.ok ? `ok:已更新车位为 ${slot_total}` : `error:${result.msg || '更新车位失败'}`;
}

export async function resetUserPasswordAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('user_id'));
  const password = String(formData.get('password') ?? '').trim();
  if (!id) {
    return 'error:缺少用户 ID';
  }
  const result = await panelSend<{ password: string; msg: string }>('POST', `/admin/users/${id}/reset-password`, {
    password,
  });
  revalidatePath('/dashboard/users');
  if (!result.ok) {
    return `error:${result.msg || '重置密码失败'}`;
  }
  return `ok:密码已重置为「${result.data?.password}」，并已注销现有登录`;
}

export async function kickUserAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('user_id'));
  if (!id) {
    return 'error:缺少用户 ID';
  }
  const result = await panelSend('POST', `/admin/users/${id}/kick`, {});
  revalidatePath('/dashboard/users');
  return result.ok ? 'ok:已强制该用户下线' : `error:${result.msg || '强制下线失败'}`;
}

export async function updateUserRemarkAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('user_id'));
  const remark = String(formData.get('remark') ?? '').trim();
  if (!id) {
    return 'error:缺少用户 ID';
  }
  const result = await panelSend('PUT', `/admin/users/${id}/remark`, { remark });
  revalidatePath('/dashboard/users');
  return result.ok ? 'ok:用户备注已更新' : `error:${result.msg || '更新备注失败'}`;
}

export async function deleteUserAction(_state: _prev, formData: FormData): Promise<string> {
  const id = Number(formData.get('user_id'));
  if (!id) {
    return 'error:缺少用户 ID';
  }
  const result = await panelSend('DELETE', `/admin/users/${id}`);
  revalidatePath('/dashboard/users');
  return result.ok ? 'ok:用户及关联资产已彻底删除' : `error:${result.msg || '删除用户失败'}`;
}

export async function grantUserProjectsAction(
  userId: number,
  projectIds: number[],
): Promise<{ ok: boolean; msg: string }> {
  const result = await panelSend<{ granted_count: number }>('PUT', `/admin/users/${userId}/projects`, {
    project_ids: projectIds,
  });
  revalidatePath('/dashboard/users');
  return { ok: result.ok, msg: result.ok ? '项目授权已更新' : (result.msg || '授权更新失败') };
}

export async function batchUsersAction(
  action: 'ban' | 'unban' | 'adjust_points' | 'adjust_slots' | 'kick',
  userIds: number[],
  params: { amount?: number; delta?: number; note?: string } = {},
): Promise<{ ok: boolean; msg: string; count?: number }> {
  if (!userIds.length) {
    return { ok: false, msg: '请先勾选需要操作的用户' };
  }
  const result = await panelSend<{ success_count: number }>('POST', '/admin/users/batch', {
    action,
    user_ids: userIds,
    params,
  });
  revalidatePath('/dashboard/users');
  if (!result.ok) {
    return { ok: false, msg: result.msg || '批量操作执行失败' };
  }
  return {
    ok: true,
    msg: `批量操作成功完成，已处理 ${result.data?.success_count ?? userIds.length} 位用户`,
    count: result.data?.success_count,
  };
}

export async function sendUserNotificationAction(
  userId: number,
  title: string,
  content: string,
  sendEmail: boolean = false,
): Promise<{ ok: boolean; msg: string }> {
  if (!title.trim()) {
    return { ok: false, msg: '通知标题不能为空' };
  }
  const result = await panelSend<{ notified: boolean; email_sent: boolean }>(
    'POST',
    `/admin/users/${userId}/notify`,
    { title, content, send_email: sendEmail },
  );
  revalidatePath('/dashboard/users');
  if (!result.ok) {
    return { ok: false, msg: result.msg || '通知发送失败' };
  }
  const emailMsg = result.data?.email_sent ? '（并已发送邮件）' : '';
  return { ok: true, msg: `通知发送成功${emailMsg}` };
}

export async function fetchUserDetailAction(userId: number) {
  const { panelGet } = await import('@/libs/PanelApi');
  return await panelGet<import('@/types/Panel').PanelUserDetail>(`/admin/users/${userId}/detail`);
}

/** 会员等级权益（唯一来源是后端 server/vip.py，前端只读，避免两边写死不一致） */
export type VipLevelBenefit = {
  level: number;
  name: string;
  slots: number;
  discount_label: string;
  signin_mult: number;
  signin_bonus_label: string;
  referral_bps: number;
  referral_label: string;
};

export async function fetchVipLevelsAction(): Promise<VipLevelBenefit[] | null> {
  const { panelGet } = await import('@/libs/PanelApi');
  const data = await panelGet<{ levels: VipLevelBenefit[] }>('/admin/vip/levels');
  return data?.levels ?? null;
}

export async function updateUserMembershipAction(
  userId: number,
  vipLevel: number,
  vipExpire: string | null,
  note: string = '',
): Promise<{ ok: boolean; msg: string }> {
  if (!userId) {
    return { ok: false, msg: '缺少用户 ID' };
  }
  const result = await panelSend<{ vip_level: number; vip_expire: string | null }>(
    'PUT',
    `/admin/users/${userId}/membership`,
    { vip_level: vipLevel, vip_expire: vipExpire, note },
  );
  revalidatePath('/dashboard/users');
  return {
    ok: result.ok,
    msg: result.ok ? '会员等级与到期时间已更新' : (result.msg || '调整会员失败'),
  };
}

export async function grantUserBenefitsAction(
  userId: number,
  data: {
    grant_type: 'slots' | 'membership' | 'both';
    slots?: number;
    vip_level?: number;
    days?: number;
    note?: string;
    notify?: boolean;
  },
): Promise<{ ok: boolean; msg: string; summary?: string }> {
  if (!userId) {
    return { ok: false, msg: '缺少用户 ID' };
  }
  const result = await panelSend<{ msg: string; summary: string }>(
    'POST',
    `/admin/users/${userId}/grant-benefits`,
    data,
  );
  revalidatePath('/dashboard/users');
  return {
    ok: result.ok,
    msg: result.ok ? (result.data?.msg || '权益赠送成功') : (result.msg || '赠送失败'),
    summary: result.data?.summary,
  };
}

export async function fetchUserTransactionsAction(
  userId: number,
  page: number = 1,
  size: number = 15,
): Promise<{
  records: Array<{
    id: number;
    amount: number;
    type: string;
    note: string;
    created_time: string;
  }>;
  total: number;
  page: number;
  size: number;
} | null> {
  const { panelGet } = await import('@/libs/PanelApi');
  return await panelGet<{
    records: Array<{
      id: number;
      amount: number;
      type: string;
      note: string;
      created_time: string;
    }>;
    total: number;
    page: number;
    size: number;
  }>(`/admin/users/${userId}/transactions?page=${page}&size=${size}`);
}
