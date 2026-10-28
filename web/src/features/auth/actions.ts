'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  panelLogin,
  panelRegister,
  panelRegisterCode,
  panelResetPasswordConfirm,
  panelSendResetCode,
  SESSION_COOKIE,
  USER_COOKIE,
} from '@/libs/PanelApi';

export type AuthActionState = { error?: string };

/** 发码按钮的状态：ok 用来起 60 秒倒计时，devCode 只在后端没配 SMTP 时有值 */
export type SendCodeState = {
  ok?: boolean;
  error?: string;
  devCode?: string;
  /** 每次成功发码都换一个值，页面据此重开倒计时 */
  nonce?: number;
};

async function resolveCookieSecure(): Promise<boolean> {
  if (process.env.COOKIE_SECURE === 'true') {
    return true;
  }
  if (process.env.COOKIE_SECURE === 'false') {
    return false;
  }
  try {
    const store = await headers();
    const proto = store.get('x-forwarded-proto') || store.get('x-forwarded-protocol');
    if (proto) {
      return proto.split(',')[0]?.trim().toLowerCase() === 'https';
    }
  } catch {
    // 构建期或非请求上下文中安全降级
  }
  return false;
}

async function setSessionCookie(store: Awaited<ReturnType<typeof cookies>>, token: string, user: unknown) {
  const secure = await resolveCookieSecure();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  store.set(USER_COOKIE, encodeURIComponent(JSON.stringify(user)), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function signInAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const redirectUrl = String(formData.get('redirect_url') ?? '');

  if (!email || !password) {
    return { error: '请输入邮箱和密码' };
  }

  const result = await panelLogin(email, password);
  if (!result.ok || !result.data) {
    return { error: result.msg || '登录失败' };
  }

  const store = await cookies();
  await setSessionCookie(store, result.data.access_token, result.data.user);
  // 账号自己的 channel 决定默认落在哪个渠道视图；之后可在侧栏切换
  const fallback = result.data.user?.channel === 'yyb' ? '/dashboard/yyb' : '/dashboard';
  // 只允许站内相对路径；拒绝 // 开头（协议相对地址会被浏览器当外部域名，open redirect）
  const safe = redirectUrl.startsWith('/') && !redirectUrl.startsWith('//') ? redirectUrl : fallback;
  redirect(safe);
}

export async function sendRegisterCodeAction(email: string): Promise<SendCodeState> {
  // 与后端口径一致做小写归一：否则同一邮箱换大小写发码，前端闸门挡不住重复请求
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    return { error: '请先填写正确的邮箱' };
  }

  const result = await panelRegisterCode(normalized);
  if (!result.ok || !result.data) {
    return { error: result.msg || '验证码发送失败，请稍后再试' };
  }

  return {
    ok: true,
    devCode: result.data.dev_code ?? undefined,
    nonce: Date.now(),
  };
}

/** 找回密码：把验证码发到邮箱（后端不校验是否已注册，避免探测） */
export async function sendResetCodeAction(email: string): Promise<SendCodeState> {
  const normalized = (email ?? '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) {
    return { error: '请先填写正确的邮箱' };
  }
  const result = await panelSendResetCode(normalized);
  if (!result.ok || !result.data) {
    return { error: result.msg || '验证码发送失败，请稍后再试' };
  }
  return {
    ok: true,
    devCode: result.data.dev_code ?? undefined,
    nonce: Date.now(),
  };
}

export async function resetPasswordAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const code = String(formData.get('code') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');

  if (!email || !email.includes('@')) {
    return { error: '请输入正确的邮箱' };
  }
  if (!code) {
    return { error: '请先获取并填写邮箱验证码' };
  }
  if (password.length < 8) {
    return { error: '新密码至少 8 位' };
  }
  if (password !== confirmPassword) {
    return { error: '两次输入的密码不一致' };
  }

  const result = await panelResetPasswordConfirm({ email, code, password, confirmPassword });
  if (!result.ok) {
    return { error: result.msg || '重置失败' };
  }
  redirect('/sign-in?reset=1');
}

export async function signUpAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  const nickname = String(formData.get('nickname') ?? '').trim();
  const inviteCode = String(formData.get('invite_code') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();

  if (!email || !password) {
    return { error: '请填写邮箱和密码' };
  }
  if (password.length < 8) {
    return { error: '密码至少 8 位' };
  }
  if (password !== confirmPassword) {
    return { error: '两次输入的密码不一致' };
  }
  if (!code) {
    return { error: '请先获取并填写邮箱验证码' };
  }

  const result = await panelRegister({
    email,
    password,
    confirmPassword,
    nickname: nickname || email.split('@')[0] || '用户',
    invite_code: inviteCode,
    code,
  });
  if (!result.ok || !result.data) {
    return { error: result.msg || '注册失败' };
  }

  const store = await cookies();
  await setSessionCookie(store, result.data.access_token, result.data.user);
  redirect('/dashboard');
}

export async function signOutAction() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(USER_COOKIE);
  redirect('/sign-in');
}
