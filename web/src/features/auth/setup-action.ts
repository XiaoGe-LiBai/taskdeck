'use server';

import type { AuthActionState } from './actions';
import { redirect } from 'next/navigation';
import { PANEL_API_URL } from '@/libs/PanelApi';

/** 复用 Server Action 的同源校验，不把初始化码放到 URL 或返回状态里。 */
export async function setupAction(_prev: AuthActionState, formData: FormData): Promise<AuthActionState> {
  const payload = {
    setup_code: String(formData.get('setup_code') ?? '').trim(),
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    password: String(formData.get('password') ?? ''),
    confirm_password: String(formData.get('confirm_password') ?? ''),
  };
  if (!payload.setup_code || !payload.email || !payload.password) {
    return { error: '请填写完整的初始化信息' };
  }
  if (payload.password !== payload.confirm_password) {
    return { error: '两次输入的密码不一致' };
  }
  try {
    const response = await fetch(`${PANEL_API_URL}/api/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || result.code !== 200) {
      return { error: result.msg || '初始化失败，请稍后重试' };
    }
  } catch {
    return { error: '暂时无法完成初始化，请稍后重试' };
  }
  redirect('/sign-in?setup=1');
}
