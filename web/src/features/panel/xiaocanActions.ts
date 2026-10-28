'use server';

import { Buffer } from 'node:buffer';
import { getSessionToken, PANEL_API_URL, panelSend } from '@/libs/PanelApi';

/**
 * 小蚕账号绑定：微信扫码登录。
 *
 * 二维码由后端向微信开放平台实时取回（浏览器拿不到 Bearer，且 proxy 会拦 /api），
 * 所以服务端取图后转 base64 data URL 交给前端；确认后由后端自动换取小蚕凭证入库。
 */
export async function xiaocanQrStartAction(): Promise<
  | { ok: true; sessionId: string; image: string }
  | { ok: false; error: string }
> {
  const created = await panelSend<{ session_id: string }>('POST', '/xiaocan/qrcode', {});
  if (!created.ok || !created.data?.session_id) {
    return { ok: false, error: created.msg || '创建扫码会话失败' };
  }
  const sessionId = created.data.session_id;
  const token = await getSessionToken();
  try {
    const resp = await fetch(`${PANEL_API_URL}/api/xiaocan/qrcode/img/${sessionId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      return { ok: false, error: `二维码获取失败（HTTP ${resp.status}）` };
    }
    const mime = resp.headers.get('content-type') || 'image/png';
    const base64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
    return { ok: true, sessionId, image: `data:${mime};base64,${base64}` };
  } catch (error) {
    return { ok: false, error: `二维码获取失败：${(error as Error).message}` };
  }
}

/** 轮询扫码状态：waiting/scanned/done/expired/error */
export async function xiaocanQrPollAction(
  sessionId: string,
): Promise<{ ok: true; state: string } | { ok: false; error: string }> {
  const result = await panelSend<{ state?: string; error?: string }>(
    'GET',
    `/xiaocan/qrcode/status?session_id=${encodeURIComponent(sessionId)}`,
  );
  if (!result.ok) {
    return { ok: false, error: result.msg };
  }
  return { ok: true, state: String(result.data?.state ?? '') };
}
