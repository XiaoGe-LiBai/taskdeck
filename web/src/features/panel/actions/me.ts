'use server';

import { revalidatePath } from 'next/cache';
import { panelChangeEmail, panelSend, panelSendEmailChangeCode } from '@/libs/PanelApi';

/**
 * 个人中心域（用户自己的操作，与管理员后台无关）：
 * 每日签到 / 卡密兑换积分 / 消息推送设置 / 站内信 / 换绑邮箱。
 */
type _prev = string;

export async function doCheckInAction(
  kind: 'daily' | 'gamble' = 'daily',
): Promise<{ ok: boolean; msg: string; reward?: number; balance?: number }> {
  const result = await panelSend<{ balance: number; reward: number; kind: string }>(
    'POST',
    '/points/check-in',
    { kind },
  );
  revalidatePath('/dashboard/checkin');
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/profile');
  if (result.ok && result.data) {
    const reward = Number(result.data.reward ?? 0);
    const label = kind === 'gamble' ? '赌狗签到' : '每日签到';
    const msg = reward > 0
      ? `${label}成功，获得 +${reward} 分！`
      : reward < 0
        ? `${label}…扣掉了 ${Math.abs(reward)} 分`
        : `${label}：本次 0 分，无事发生`;
    return { ok: true, msg, reward, balance: result.data.balance };
  }
  return { ok: false, msg: result.msg || '签到失败' };
}

export async function redeemPointsCardAction(
  _state: _prev,
  formData: FormData,
): Promise<string> {
  const code = String(formData.get('code') ?? '').trim();
  if (!code) {
    return 'error:请输入卡密兑换码';
  }
  const result = await panelSend<{ balance: number }>('POST', '/points/redeem', { code });
  revalidatePath('/dashboard/profile');
  // 用户兑换后不该去刷新管理端的卡密页（那是 admin only），刷新项目市场即可
  // —— 那里的「当前可用余额」要靠新余额重算
  revalidatePath('/dashboard/market');
  revalidatePath('/dashboard');
  return result.ok ? 'ok:兑换成功' : `error:${result.msg || '兑换失败'}`;
}

/**
 * 购买会员套餐（会员期商品需指定作用到哪个账号）。
 *
 * 后端会同时做两件事：给该账号加会员期 + 按天数提升用户等级（取较大者，不降级），
 * 并按等级打折扣分。返回里带上实付与授予等级，供页面给出准确提示。
 */
export async function purchaseProductAction(
  productId: number,
  accountId?: number,
): Promise<{ ok: boolean; msg: string; grantedLevel?: number }> {
  const result = await panelSend<{
    balance: number;
    paid: number;
    list_price: number;
    granted_level: number;
    old_vip_level: number;
    vip_level: number;
    vip_level_name: string;
  }>('POST', '/points/purchase', { product_id: productId, account_id: accountId });

  revalidatePath('/dashboard/profile');
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/accounts');
  revalidatePath('/dashboard/market');

  if (!result.ok) {
    return { ok: false, msg: result.msg || '购买失败' };
  }
  const d = result.data;
  const paid = d?.paid ?? 0;
  const saved = d && d.list_price > d.paid ? `（省 ${d.list_price - d.paid} 分）` : '';
  // 只在等级**真的变高**时才提等级：老用户买短套餐是"维持当前等级"，不是"降级"
  const oldLv = d?.old_vip_level ?? 0;
  const newLv = d?.vip_level ?? oldLv;
  // 等级名用后端下发的（唯一来源 vip.py），前端不拼「VIP2 至尊会员」这类混搭
  const levelPart = newLv > oldLv ? `，会员等级提升至 ${d?.vip_level_name ?? '会员'}` : '';

  return {
    ok: true,
    msg: `购买成功，扣除 ${paid} 分${saved}${levelPart}`,
    grantedLevel: newLv,
  };
}

export async function saveNotifySettingsAction(
  _state: _prev,
  formData: FormData,
): Promise<string> {
  const emailNotify = formData.get('email_notify') === 'on';
  const result = await panelSend('PUT', '/auth/notify', { email_notify: emailNotify });
  revalidatePath('/dashboard/notifications');
  return result.ok ? 'ok:推送配置已更新' : `error:${result.msg || '更新失败'}`;
}

export type MyNotificationRow = {
  id: number;
  title: string;
  content: string;
  type: string;
  is_read: number;
  created_time: string;
};

export async function fetchMyNotificationsAction(
  page: number = 1,
  size: number = 20,
): Promise<{
  records: MyNotificationRow[];
  total: number;
  unread: number;
} | null> {
  const { panelGet } = await import('@/libs/PanelApi');
  return await panelGet<{
    records: MyNotificationRow[];
    total: number;
    unread: number;
  }>(`/my/notifications?page=${page}&size=${size}`);
}

export async function markNotificationReadAction(id: number): Promise<void> {
  await panelSend('PUT', `/my/notifications/${id}/read`, {});
  revalidatePath('/dashboard/notifications');
}

export async function markAllNotificationsReadAction(): Promise<void> {
  await panelSend('PUT', '/my/notifications/read-all', {});
  revalidatePath('/dashboard/notifications');
}

/* ---------------------------------------------------------------- 签到日历 / 补签 */

export type CheckInCalendarDay = {
  date: string;
  day: number;
  /** checked=已签到 / makeup=补签 / missed=漏签(可补) / today=今天 / future=未来 / out_of_range=超期不可补 */
  status: string;
  reward: number;
  kind: string;
};

export type CheckInCalendarData = {
  month: string;
  days: CheckInCalendarDay[];
  checked_days: number;
  total_days: number;
  streak: number;
  makeup_used: number;
  makeup_quota: number;
  makeup_remaining: number;
  makeup_cost: number;
  today_checked: boolean;
  can_makeup: boolean;
  earliest_makeup_date: string;
  today: string;
};

/** 取某月签到日历（month 形如 2026-10） */
export async function fetchCheckInCalendarAction(month: string): Promise<CheckInCalendarData | null> {
  const { panelGet } = await import('@/libs/PanelApi');
  return await panelGet<CheckInCalendarData>(`/points/check-in/calendar?month=${month}`);
}

/** 补签某一天（消耗积分，保连签；需先完成今日签到） */
export async function makeupCheckInAction(
  date: string,
): Promise<{ ok: boolean; msg: string; streak?: number; remaining?: number; balance?: number }> {
  const result = await panelSend<{
    date: string;
    cost: number;
    balance: number;
    streak: number;
    makeup_remaining: number;
  }>('POST', '/points/check-in/makeup', { date });

  revalidatePath('/dashboard/checkin');
  revalidatePath('/dashboard');

  if (!result.ok) {
    return { ok: false, msg: result.msg || '补签失败' };
  }
  const d = result.data;
  const parts = [`补签成功（${date}）`];
  if (d?.cost) {
    parts.push(`扣除 ${d.cost} 分`);
  }
  if (typeof d?.streak === 'number') {
    parts.push(`当前连签 ${d.streak} 天`);
  }
  if (typeof d?.makeup_remaining === 'number') {
    parts.push(`本月还可补 ${d.makeup_remaining} 次`);
  }
  return {
    ok: true,
    msg: parts.join('，'),
    streak: d?.streak,
    remaining: d?.makeup_remaining,
    // 服务端权威余额：页面据此立刻刷新余额显示（不让用户等整页 refresh）
    balance: d?.balance,
  };
}

/**
 * 修改自己的登录口令（个人资料页）。
 *
 * 后端 PUT /auth/password 要求旧口令，且新口令至少 8 位；这里先做同规则的本地校验，
 * 避免把明显不合法的请求发出去。改完当前会话继续有效（后端不吊销自己）。
 */
export async function changePasswordAction(_state: _prev, formData: FormData): Promise<string> {
  const oldPassword = String(formData.get('old_password') ?? '');
  const newPassword = String(formData.get('new_password') ?? '');
  const confirmPassword = String(formData.get('confirm_password') ?? '');
  if (!oldPassword) {
    return 'error:请输入当前密码';
  }
  if (newPassword.length < 8) {
    return 'error:新密码至少 8 位';
  }
  if (newPassword !== confirmPassword) {
    return 'error:两次输入的新密码不一致';
  }
  if (newPassword === oldPassword) {
    return 'error:新密码不能与当前密码相同';
  }
  const result = await panelSend('PUT', '/auth/password', {
    old_password: oldPassword,
    new_password: newPassword,
  });
  if (!result.ok) {
    return `error:${result.msg || '修改失败'}`;
  }
  revalidatePath('/dashboard/profile');
  return 'ok:密码已修改，下次登录请使用新密码';
}

export async function sendEmailChangeCodeAction(email: string): Promise<string> {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    return 'error:请输入正确的新邮箱';
  }
  const result = await panelSendEmailChangeCode(normalized);
  if (!result.ok || !result.data) {
    return `error:${result.msg || '发送失败'}`;
  }
  return result.data.dev_code
    ? `ok:开发模式（未配置 SMTP），验证码：${result.data.dev_code}`
    : 'ok:验证码已发送，去新邮箱查收';
}

export async function changeEmailAction(_state: _prev, formData: FormData): Promise<string> {
  const email = String(formData.get('new_email') ?? '').trim().toLowerCase();
  const code = String(formData.get('code') ?? '').trim();
  if (!email || !email.includes('@')) {
    return 'error:请输入正确的新邮箱';
  }
  if (!code) {
    return 'error:请先获取并填写邮箱验证码';
  }
  const result = await panelChangeEmail({ email, code });
  if (!result.ok) {
    return `error:${result.msg || '换绑失败'}`;
  }
  revalidatePath('/dashboard/profile');
  return 'ok:邮箱已换绑，下次登录请用新邮箱';
}
