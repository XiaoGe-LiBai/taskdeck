import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { isAdminOnlyPath } from './features/panel/navConfig';
import { SESSION_COOKIE, USER_COOKIE } from './libs/Cookies';

/** 需要登录的路由（/dashboard 及其子页） */
function isProtected(pathname: string) {
  return /(?:^|\/)dashboard(?:\/|$)/.test(pathname);
}

/**
 * 从登录时写入的用户快照 cookie 里取角色。
 *
 * 只是 UI 层守卫：cookie 是 httpOnly 且由服务端写入，但理论上仍可被伪造，
 * 所以**真正的安全边界在后端**（所有 /api/admin/* 都走 core.require_admin）。
 * 这层的作用是：普通用户即便手敲管理端 URL，也不会看到一个「接口全 401 →
 * 被踢回登录页」的坏页面。
 */
function readRole(request: NextRequest): string {
  const raw = request.cookies.get(USER_COOKIE)?.value;
  if (!raw) {
    return '';
  }
  try {
    const user = JSON.parse(decodeURIComponent(raw)) as { role?: string };
    return user?.role ?? '';
  } catch {
    return '';
  }
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // 只检查页面 GET；安装是否完成以数据库为准，不能靠 cookie 或进程缓存。
  if (request.method === 'GET' && !pathname.startsWith('/api/') && pathname !== '/site-icon') {
    try {
      const base = process.env.PANEL_API_URL ?? 'http://127.0.0.1:8100';
      const response = await fetch(`${base}/api/setup`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const result = await response.json();
      if (response.ok && result.code === 200 && result.data?.initialized === false && pathname !== '/setup') {
        return NextResponse.redirect(new URL('/setup', request.url));
      }
      if (response.ok && result.code === 200 && result.data?.initialized === true && pathname === '/setup') {
        return NextResponse.redirect(new URL('/sign-in', request.url));
      }
    } catch {
      // 状态未知不展示安装表单；业务 API 的独立守卫仍拒绝未初始化请求。
    }
  }
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  // 未登录访问面板 → 跳登录页（带上回跳地址）
  if (isProtected(pathname) && !hasSession) {
    const url = new URL('/sign-in', request.url);
    url.searchParams.set('redirect_url', pathname);
    return NextResponse.redirect(url);
  }

  // 注意：这里**故意不做**「有 cookie 就把 /sign-in 弹回 /dashboard」。
  // 中间件只能看到 cookie 在不在，看不到 token 还有没有效；
  // 而面板页会真去问后端，token 失效时会把人送回 /sign-in ——
  // 两边判据不一致就会互相弹，形成 ERR_TOO_MANY_REDIRECTS 死循环
  // （token 两小时过期后必现）。
  // 「已登录就别看登录页」交给 sign-in 页面自己用 panelMe() 判，那里是真实校验。

  // 普通用户访问管理端路由 → 回控制台（附提示参数，页面可据 denied=1 展示说明）
  if (hasSession && isAdminOnlyPath(pathname) && readRole(request) !== 'admin') {
    const url = new URL('/dashboard', request.url);
    url.searchParams.set('denied', '1');
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Match all pathnames except for
  // - … if they start with `/_next`, `/_vercel` or `monitoring`
  // - … the ones containing a dot (e.g. `favicon.ico`)
  matcher: '/((?!_next|_vercel|monitoring|.*\\..*).*)',
};
