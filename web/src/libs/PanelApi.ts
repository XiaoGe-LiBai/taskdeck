import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
/**
 * 小蚕面板数据层：把后端（server/，Flask）的 /api 封装成前端可直接用的函数。
 *
 * 登录态放在 httpOnly cookie，服务端组件每次请求带上 Bearer token 调后端，
 * 前端页面本身不接触 token。
 */
import { cache } from 'react';
// cookie 名定义在 libs/Cookies.ts（middleware 也用它，那边不能依赖本模块的 next/headers）
import { SESSION_COOKIE, USER_COOKIE } from './Cookies';

export const PANEL_API_URL = process.env.PANEL_API_URL ?? 'http://127.0.0.1:8100';

export { SESSION_COOKIE, USER_COOKIE };

/** 后端请求超时：Flask 是本地服务，默认 15 秒（兼顾扫码取图与外部接口长轮询） */
const BACKEND_TIMEOUT_MS = 15000;

export type PanelUser = {
  id: number;
  email: string;
  nickname: string;
  role: 'user' | 'admin';
  /** 渠道：xiaocan = 小蚕·大牌券，yyb = 应用宝·协议服务。两个渠道的账号不混用 */
  channel: 'xiaocan' | 'yyb';
  status: string;
  points_balance: number;
  points_spent: number;
  invite_code: string;
  slot_total: number;
  slot_used: number;
  /** 生效会员等级显示名（普通会员/高级会员/至尊会员） */
  vip_level_name?: string;
  vip_expire?: string | null;
  last_login_ip: string;
  last_login_time: string | null;
  created_time: string;
};

type Envelope<T> = { code: number; data: T; msg: string };

export type PanelRequestResult<T> = {
  ok: boolean;
  data: T | null;
  msg: string;
  unauthorized: boolean;
};

async function unwrap<T>(resp: Response): Promise<PanelRequestResult<T>> {
  let body: Envelope<T>;
  try {
    body = (await resp.json()) as Envelope<T>;
  } catch {
    return { ok: false, data: null, msg: `后端返回非 JSON（HTTP ${resp.status}）`, unauthorized: false };
  }

  return {
    ok: body.code === 200,
    data: (body.data ?? null) as T | null,
    msg: body.msg ?? '',
    unauthorized: body.code === 401,
  };
}

/**
 * 把真实客户端 IP 透传给 Flask。
 *
 * Next.js 只是中间层：Node 进程去 fetch Flask 时，Flask 看到的 remote_addr
 * 永远是 127.0.0.1，所以「登录 IP」会恒为本地地址。这里从上游请求头取出
 * 客户端地址，转成 X-Forwarded-For / X-Real-IP 带给后端
 * （后端 core.current_ip() 优先读 X-Forwarded-For）。
 */
async function clientIpHeaders(): Promise<Record<string, string>> {
  try {
    const store = await headers();
    const forwarded = (store.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? '';
    const ip = forwarded || (store.get('x-real-ip') ?? '').trim();
    if (!ip) {
      return {};
    }
    return { 'X-Forwarded-For': ip, 'X-Real-IP': ip };
  } catch {
    // 不在请求作用域（例如构建期）时静默跳过
    return {};
  }
}

/** 用 email/password 登录后端，成功返回 token + user（渠道是登录后的视图，不影响登录） */
export async function panelLogin(email: string, password: string) {
  try {
    const resp = await fetch(`${PANEL_API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await clientIpHeaders()) },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    return await unwrap<{ access_token: string; user: PanelUser }>(resp);
  } catch (error) {
    return {
      ok: false,
      data: null,
      msg: `连接后端失败：${(error as Error).message}`,
      unauthorized: false,
    } satisfies PanelRequestResult<{ access_token: string; user: PanelUser }>;
  }
}

/** 注册发码。后端未配 SMTP 时会把验证码放进 dev_code 回传（仅本地联调用，配好邮件后自动为 null） */
export type RegisterCodeData = {
  sent: boolean;
  dev_code: string | null;
  /** 后端提示的重发间隔（秒），与前端倒计时对齐 */
  retry_after?: number;
};

export async function panelRegisterCode(email: string) {
  try {
    const resp = await fetch(`${PANEL_API_URL}/api/auth/register/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await clientIpHeaders()) },
      body: JSON.stringify({ email }),
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    return await unwrap<RegisterCodeData>(resp);
  } catch (error) {
    return {
      ok: false,
      data: null,
      msg: `连接后端失败：${(error as Error).message}`,
      unauthorized: false,
    } satisfies PanelRequestResult<RegisterCodeData>;
  }
}

/** 注册（后端支持邀请码；register_require_code=true 时必须带邮箱验证码 code） */
export async function panelRegister(payload: {
  email: string;
  password: string;
  confirmPassword: string;
  nickname: string;
  invite_code?: string;
  code?: string;
}) {
  try {
    const resp = await fetch(`${PANEL_API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await clientIpHeaders()) },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    return await unwrap<{ access_token: string; user: PanelUser }>(resp);
  } catch (error) {
    return {
      ok: false,
      data: null,
      msg: `连接后端失败：${(error as Error).message}`,
      unauthorized: false,
    } satisfies PanelRequestResult<{ access_token: string; user: PanelUser }>;
  }
}

export async function getSessionToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

/** 登录时写入的 cookie 用户快照（后端宕机时 panelMe 用它兜底） */
async function getSessionUser(): Promise<PanelUser | null> {
  const store = await cookies();
  const raw = store.get(USER_COOKIE)?.value;
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(decodeURIComponent(raw)) as PanelUser;
  } catch {
    return null;
  }
}

/**
 * 当前用户（实时）：登录时写进 cookie 的 user 只是快照，积分余额、角色、
 * 昵称在会话期间随时会变。所以每次渲染都向后端 /auth/profile 取最新值，
 * cookie 只在两种情况下兜底：没登录（返回 null）或后端宕机（用快照保页面可用）。
 * token 失效（401）时返回 null，由调用方决定是否跳登录。
 */
export async function panelMe(): Promise<PanelUser | null> {
  const token = await getSessionToken();
  if (!token) {
    return null;
  }
  try {
    const resp = await fetch(`${PANEL_API_URL}/api/auth/profile`, {
      headers: { Authorization: `Bearer ${token}`, ...(await clientIpHeaders()) },
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    const result = await unwrap<PanelUser>(resp);
    if (result.unauthorized) {
      return null;
    }
    if (result.ok && result.data) {
      return result.data;
    }
  } catch {
    // 后端不可达：落到 cookie 快照，页面仍能看到自己的数据
  }
  return await getSessionUser();
}

/**
 * 后端是否不可达（React.cache：同一次页面渲染里多次调用只探测一次）。
 * 用公开接口 /announcements/latest 探测，不需要登录态。
 */
export const backendDown = cache(async (): Promise<boolean> => {
  try {
    const resp = await fetch(`${PANEL_API_URL}/api/announcements/latest`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    return !resp.ok;
  } catch {
    return true;
  }
});

/** 站点名称兜底值（后端不可达时用）—— 与 server/core.py 的 DEFAULT_SITE_NAME 保持一致 */
export const FALLBACK_SITE_NAME = '托管鸭';

export type SiteInfo = {
  site_name: string;
  /** 自定义站点图标地址（`/site-icon?v=…`）；未启用时为空串 */
  logo_url: string;
};

/**
 * 站点公开信息（**无需登录**）。
 *
 * 登录页、注册页、落地页、Next 的 root metadata 都要显示站点名称与图标，这些
 * 场景根本没有 token，所以走后端公开的 `/api/site-info`（只回站名和图标地址，
 * 不含 smtp 之类敏感配置，不要图省事改成读 /admin/settings）。
 *
 * 用 React.cache 收敛：一次页面渲染里 layout 和 page 往往都要它。
 */
export const getSiteInfo = cache(async (): Promise<SiteInfo> => {
  const fallback: SiteInfo = { site_name: FALLBACK_SITE_NAME, logo_url: '' };
  try {
    const resp = await fetch(`${PANEL_API_URL}/api/site-info`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    const result = await unwrap<SiteInfo>(resp);
    if (!result.ok || !result.data) {
      return fallback;
    }
    return {
      site_name: result.data.site_name?.trim() || FALLBACK_SITE_NAME,
      logo_url: result.data.logo_url ?? '',
    };
  } catch {
    // 后端没起来时页面照常渲染，只是用兜底站名 + 内置图标
    return fallback;
  }
});

/** 找回密码发码。未配 SMTP 时 dev_code 回显（仅本地联调） */
export async function panelSendResetCode(email: string) {
  return await postAuth<RegisterCodeData>('/api/auth/reset-password', { email });
}

/** 找回密码确认：验码 + 改密 */
export async function panelResetPasswordConfirm(payload: {
  email: string;
  code: string;
  password: string;
  confirmPassword: string;
}) {
  return await postAuth<Record<string, never>>('/api/auth/reset-password/confirm', payload);
}

/** 换绑邮箱发码（发到新邮箱）；走 panelSend 以便自动带上当前登录态 */
export async function panelSendEmailChangeCode(email: string) {
  return await panelSend<RegisterCodeData>('POST', '/auth/email/change-code', { email });
}

/** 换绑邮箱确认：验码 + 改 email */
export async function panelChangeEmail(payload: { email: string; code: string }) {
  return await panelSend<{ email: string }>('PUT', '/auth/email', payload);
}

/** 免登录鉴权接口的统一封装（登录/注册/找回这些没有 token 可用） */
async function postAuth<T>(
  path: string,
  payload: unknown,
): Promise<PanelRequestResult<T>> {
  try {
    const resp = await fetch(`${PANEL_API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await clientIpHeaders()) },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    return await unwrap<T>(resp);
  } catch (error) {
    return {
      ok: false,
      data: null,
      msg: `连接后端失败：${(error as Error).message}`,
      unauthorized: false,
    } satisfies PanelRequestResult<T>;
  }
}

/** 服务端取数：未登录直接跳登录页 */
export async function panelGet<T>(path: string): Promise<T | null> {
  const token = await getSessionToken();
  if (!token) {
    redirect('/sign-in');
  }
  try {
    const resp = await fetch(`${PANEL_API_URL}/api${path}`, {
      headers: { Authorization: `Bearer ${token}`, ...(await clientIpHeaders()) },
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });
    const result = await unwrap<T>(resp);
    if (result.unauthorized) {
      redirect('/sign-in');
    }
    return result.ok ? result.data : null;
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    return null;
  }
}

/** 服务端写操作（表单 action 用），返回后端 msg */
export async function panelSend<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  payload?: unknown,
  timeoutMs: number = BACKEND_TIMEOUT_MS,
): Promise<PanelRequestResult<T>> {
  const token = await getSessionToken();
  if (!token) {
    return { ok: false, data: null, msg: '登录已失效', unauthorized: true };
  }
  try {
    const resp = await fetch(`${PANEL_API_URL}/api${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(await clientIpHeaders()),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await unwrap<T>(resp);
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    return { ok: false, data: null, msg: `连接后端失败：${(error as Error).message}`, unauthorized: false };
  }
}

/**
 * 文件上传（multipart）—— 给站点图标这类接口用。
 *
 * 两点和面板其他写请求不同，都是有意的：
 *  - **不设 Content-Type**：交给 fetch 自己带 boundary，手写会漏 boundary 导致后端收不到文件
 *  - **超时放宽到 60 秒**：后端要解图 + 缩放，比普通写请求慢得多
 */
export async function panelUpload<T>(
  path: string,
  formData: FormData,
  timeoutMs = 60000,
): Promise<PanelRequestResult<T>> {
  const token = await getSessionToken();
  if (!token) {
    return { ok: false, data: null, msg: '登录已失效', unauthorized: true };
  }
  try {
    const resp = await fetch(`${PANEL_API_URL}/api${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(await clientIpHeaders()),
      },
      body: formData,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await unwrap<T>(resp);
  } catch (error) {
    if (isRedirectError(error)) {
      throw error;
    }
    return { ok: false, data: null, msg: `连接后端失败：${(error as Error).message}`, unauthorized: false };
  }
}
