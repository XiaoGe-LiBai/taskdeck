'use server';

import { cookies } from 'next/headers';
import { SESSION_COOKIE, USER_COOKIE } from '@/libs/Cookies';

/**
 * 把当前登录态的 Cookie 读出来给前端复制。
 *
 * 为什么要服务端读：登录 cookie 是 httpOnly 的，`document.cookie` 拿不到 —— 这是
 * 有意的安全设计，不能让 XSS 直接偷走 token。用户主动点「复制」时由服务端取一次。
 *
 * 拿到的串等同于账号密码：能直接以你的身份访问面板，直到 token 过期（默认 2 小时）。
 */
export async function readLoginCookieAction(): Promise<
  { ok: true; cookie: string; expiresHint: string } | { ok: false; error: string }
> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? '';
  const user = store.get(USER_COOKIE)?.value ?? '';
  if (!token) {
    return { ok: false, error: '当前没有登录态，请先重新登录' };
  }
  const parts = [`${SESSION_COOKIE}=${token}`];
  if (user) {
    parts.push(`${USER_COOKIE}=${user}`);
  }
  return {
    ok: true,
    cookie: parts.join('; '),
    expiresHint: '有效期跟随登录态（默认 2 小时），退出登录或改密后立即失效',
  };
}
