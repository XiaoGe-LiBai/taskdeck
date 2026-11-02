'use server';

import { getSessionToken, PANEL_API_URL, panelSend } from '@/libs/PanelApi';

/**
 * 电脑微信直连（服务端在 Linux、脚本在你 Windows 上跑）。
 *
 * 流程：生成 6 位配对码 → 下载内嵌了码的脚本 → 在本机跑脚本扫微信进程内存
 * → 脚本把 token POST 回 /api/xiaocan/wechat/report → 面板轮询到 done。
 */

export async function createWechatPairAction(): Promise<
  { ok: true; code: string; expiresIn: number } | { ok: false; error: string }
> {
  const resp = await panelSend<{ code: string; expires_in: number }>('POST', '/xiaocan/wechat/pair', {});
  if (!resp.ok || !resp.data) {
    return { ok: false, error: resp.msg || '生成配对码失败' };
  }
  return { ok: true, code: resp.data.code, expiresIn: resp.data.expires_in };
}

export type WechatPairState = 'waiting' | 'done' | 'expired';

export async function pollWechatPairAction(
  code: string,
): Promise<{ ok: boolean; state: WechatPairState; nickname: string; error: string }> {
  const resp = await panelSend<{ state: string; account?: { nickname?: string } | null; error?: string }>(
    'GET',
    `/xiaocan/wechat/pair/${encodeURIComponent(code)}`,
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, state: 'waiting', nickname: '', error: resp.msg || '查询失败' };
  }
  return {
    ok: true,
    state: (resp.data.state as WechatPairState) ?? 'waiting',
    nickname: resp.data.account?.nickname ?? '',
    error: resp.data.error ?? '',
  };
}

/** 取回内嵌配对码的脚本正文（接口返回纯文本，不能走 panelSend 的 JSON 解包）。 */
export async function fetchWechatScriptAction(
  code: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const token = await getSessionToken();
  try {
    const resp = await fetch(
      `${PANEL_API_URL}/api/xiaocan/wechat/script?code=${encodeURIComponent(code)}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      },
    );
    const text = await resp.text();
    if (!resp.ok || resp.headers.get('content-type')?.includes('json')) {
      // 后端出错时返回的是 JSON 信封，直接把它当正文展示会很难看
      try {
        const body = JSON.parse(text) as { msg?: string };
        return { ok: false, error: body.msg || `脚本获取失败（HTTP ${resp.status}）` };
      } catch {
        return { ok: false, error: `脚本获取失败（HTTP ${resp.status}）` };
      }
    }
    return { ok: true, text };
  } catch (error) {
    return { ok: false, error: `脚本获取失败：${(error as Error).message}` };
  }
}
