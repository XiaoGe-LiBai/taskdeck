'use server';

import { Buffer } from 'node:buffer';

import { revalidatePath } from 'next/cache';
import { getSessionToken, PANEL_API_URL, panelSend } from '@/libs/PanelApi';

/* ---------------------------------------------------------------- 应用宝（YYB） */

/** 直接供客户端弹窗调用的结构化取码接口 */
export async function yybGetCodeDirectAction(
  ref: string | number,
  appId: string,
): Promise<{ ok: boolean; code?: string; errMsg?: string; msg?: string }> {
  const cleanAppId = String(appId).trim();
  if (!cleanAppId) {
    return { ok: false, msg: '请填写小程序 AppID' };
  }
  const result = await panelSend<{ code: string; errMsg: string }>('POST', '/yyb/get-code', {
    ref: String(ref),
    app_id: cleanAppId,
  });
  if (!result.ok) {
    return { ok: false, msg: result.msg || '取码失败' };
  }
  const code = result.data?.code ?? '';
  if (!code) {
    return { ok: false, msg: result.data?.errMsg || '协议服务未返回有效 code' };
  }
  return { ok: true, code, errMsg: result.data?.errMsg || 'ok' };
}

/** 直接供客户端调用的备注更新接口 */
export async function yybUpdateRemarkDirectAction(
  ref: string | number,
  remark: string,
): Promise<{ ok: boolean; msg: string }> {
  const result = await panelSend('PUT', '/yyb/accounts/remark', {
    ref: String(ref),
    remark: String(remark).trim(),
  });
  revalidatePath('/dashboard/yyb');
  return { ok: result.ok, msg: result.ok ? '备注已更新' : (result.msg || '更新失败') };
}

/** 直接供客户端调用的保活刷新接口 */
export async function yybRefreshDirectAction(
  ref: string | number,
): Promise<{ ok: boolean; msg: string }> {
  const result = await panelSend('POST', '/yyb/accounts/refresh', {
    ref: String(ref),
  });
  revalidatePath('/dashboard/yyb');
  return { ok: result.ok, msg: result.ok ? '账号状态已刷新' : (result.msg || '刷新失败') };
}

export async function yybRunJobAction(_state: string, formData: FormData): Promise<string> {
  const ref = String(formData.get('ref') ?? '');
  const scriptKey = String(formData.get('script_key') ?? '');
  const result = await panelSend('POST', '/yyb/jobs/run', { ref, script_key: scriptKey });
  revalidatePath('/dashboard/yyb/jobs');
  return result.ok ? 'ok:已发送运行指令' : `error:${result.msg || '运行失败'}`;
}

export async function yybToggleJobAction(_state: string, formData: FormData): Promise<string> {
  const ref = String(formData.get('ref') ?? '');
  const scriptKey = String(formData.get('script_key') ?? '');
  const enabled = String(formData.get('enabled') ?? '') === '1';
  const result = await panelSend('PUT', '/yyb/jobs/enable', { ref, script_key: scriptKey, enabled });
  revalidatePath('/dashboard/yyb/jobs');
  if (!result.ok) {
    return `error:${result.msg || '操作失败'}`;
  }
  return enabled ? 'ok:任务已启用' : 'ok:任务已停用';
}

export async function yybSaveEndpointAction(
  _prev: string,
  formData: FormData,
): Promise<string> {
  const id = Number(formData.get('id')) || 0;
  const payload: Record<string, string> = {
    name: String(formData.get('name') ?? 'YYB 协议服务'),
    base_url: String(formData.get('base_url') ?? '').trim(),
    username: String(formData.get('username') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
    integration_token: String(formData.get('integration_token') ?? ''),
  };
  if (!payload.base_url) {
    return 'error:请填写服务地址';
  }

  const result = id
    ? await panelSend('PUT', `/yyb/endpoints/${id}`, payload)
    : await panelSend('POST', '/yyb/endpoints', payload);
  revalidatePath('/dashboard/yyb/settings');
  revalidatePath('/dashboard/yyb');
  return result.ok ? 'ok:已保存，可点「测试连接」验证' : `error:${result.msg}`;
}

export async function yybCheckAction(
  _prev: string,
  formData: FormData,
): Promise<string> {
  const endpointId = String(formData.get('endpoint_id') ?? '');
  const suffix = endpointId ? `?endpoint_id=${endpointId}` : '';
  const result = await panelSend<{ online: boolean; accounts: number; msg: string }>(
    'GET',
    `/yyb/status${suffix}`,
  );
  revalidatePath('/dashboard/yyb/settings');
  revalidatePath('/dashboard/yyb');
  if (!result.ok) {
    return `error:${result.msg}`;
  }
  return result.data?.online
    ? `ok:连接成功，读到 ${result.data.accounts} 个账号`
    : `error:${result.data?.msg || '连接失败'}`;
}

/* ---------------------------------------------------------------- 扫码加号 + 登录代理 */

export type YybProxyProfile = {
  id: number;
  name: string;
  provider: string;
  proxy_type: string;
  api_url?: string;
};

export type YybProxyArea = {
  code: string;
  name: string;
};

/**
 * 与 YYB `accountProxyIn` 对齐的代理负载。
 *
 * 四种模式在面板侧映射成与 YYB /scan 相同的形式：
 *  - direct  → mode=direct
 *  - static  → mode=static + static_proxy
 *  - api     → mode=api + api_url
 *  - profile → mode=api + provider_profile_id + 地区（由 YYB 解析配置库）
 */
export type YybProxyPayload = {
  product: 'appstore';
  mode: 'direct' | 'static' | 'api';
  proxy_type: 'http' | 'socks5';
  static_proxy: string;
  api_url: string;
  provider_profile_id: number | null;
  region_code: string;
  region_province: string;
  region_city: string;
  refresh_ahead_minutes: number;
};

function endpointSuffix(endpointId?: number) {
  return endpointId ? `?endpoint_id=${endpointId}` : '';
}

/** YYB 代理配置库（品赞/巨量/静态预设）；非管理员后端会去掉 api_url */
export async function yybProxyProfilesAction(
  endpointId?: number,
): Promise<{ ok: true; data: YybProxyProfile[] } | { ok: false; error: string }> {
  const result = await panelSend<YybProxyProfile[]>(
    'GET',
    `/yyb/proxy-profiles${endpointSuffix(endpointId)}`,
    undefined,
    40000,
  );
  return result.ok
    ? { ok: true, data: result.data ?? [] }
    : { ok: false, error: result.msg || '代理配置读取失败' };
}

export async function yybProxyProvincesAction(
  endpointId?: number,
): Promise<{ ok: true; data: YybProxyArea[] } | { ok: false; error: string }> {
  const result = await panelSend<YybProxyArea[]>(
    'GET',
    `/yyb/proxy-profiles/areas/provinces${endpointSuffix(endpointId)}`,
    undefined,
    40000,
  );
  return result.ok
    ? { ok: true, data: result.data ?? [] }
    : { ok: false, error: result.msg || '省份列表读取失败' };
}

export async function yybProxyCitiesAction(
  province: string,
  endpointId?: number,
): Promise<{ ok: true; data: YybProxyArea[] } | { ok: false; error: string }> {
  const params = new URLSearchParams({ province });
  if (endpointId) {
    params.set('endpoint_id', String(endpointId));
  }
  const result = await panelSend<YybProxyArea[]>(
    'GET',
    `/yyb/proxy-profiles/areas/cities?${params.toString()}`,
    undefined,
    40000,
  );
  return result.ok
    ? { ok: true, data: result.data ?? [] }
    : { ok: false, error: result.msg || '城市列表读取失败' };
}

/** 代理测试的返回（YYB /accounts/proxy/test） */
export type YybProxyTestResult = {
  resolved: boolean;
  proxy?: string;
  exit_ip?: string;
  exit_region?: string;
  exit_city?: string;
  probe_error?: string;
};

/** 按当前选择提取一次代理并探测出口，不落库 */
export async function yybProxyTestAction(
  payload: YybProxyPayload,
  endpointId?: number,
): Promise<
  | { ok: true; data: YybProxyTestResult }
  | { ok: false; error: string }
> {
  const result = await panelSend<YybProxyTestResult>(
    'POST',
    `/yyb/proxy/test${endpointSuffix(endpointId)}`,
    payload,
    100000,
  );
  return result.ok
    ? { ok: true, data: result.data ?? { resolved: false } }
    : { ok: false, error: result.msg || '代理测试失败' };
}

/**
 * 新建扫码会话，并把二维码图片取回成 data URL。
 *
 * 面板的 Flask 侧需要 Bearer 鉴权，浏览器无法直接 <img src> 那个地址，
 * 所以由服务端代取图片再回传。proxy 会原样透传给 YYB 的 POST /qr。
 */
export async function yybQrStartAction(endpointId?: number, proxy?: YybProxyPayload): Promise<
  | { ok: true; sessionId: string; status: string; image: string }
  | { ok: false; error: string }
> {
  const suffix = endpointSuffix(endpointId);
  const created = await panelSend<{ session_id: string; status?: string }>(
    'POST',
    `/yyb/qr${suffix}`,
    proxy ?? {},
    100000,
  );
  if (!created.ok || !created.data?.session_id) {
    return { ok: false, error: created.msg || '创建扫码会话失败，请稍后重试' };
  }

  const sessionId = created.data.session_id;
  const token = await getSessionToken();
  const params = new URLSearchParams({ session_id: sessionId });
  if (endpointId) {
    params.set('endpoint_id', String(endpointId));
  }

  try {
    const resp = await fetch(`${PANEL_API_URL}/api/yyb/qr/image?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    });
    if (!resp.ok) {
      return { ok: false, error: `二维码获取失败（HTTP ${resp.status}）` };
    }
    const mime = resp.headers.get('content-type') || 'image/jpeg';
    const base64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
    return {
      ok: true,
      sessionId,
      status: created.data.status ?? 'pending',
      image: `data:${mime};base64,${base64}`,
    };
  } catch (error) {
    return { ok: false, error: `二维码获取异常：${(error as Error).message}` };
  }
}

/** 轮询扫码状态（前端每 2.5 秒调一次） */
export async function yybQrPollAction(
  sessionId: string,
  endpointId?: number,
): Promise<{ ok: true; status: string; errcode?: number } | { ok: false; error: string }> {
  const params = new URLSearchParams({ session_id: sessionId });
  if (endpointId) {
    params.set('endpoint_id', String(endpointId));
  }
  const result = await panelSend<{ status?: string; errcode?: number }>(
    'GET',
    `/yyb/qr/poll?${params.toString()}`,
  );
  if (!result.ok) {
    return { ok: false, error: result.msg };
  }
  return {
    ok: true,
    status: String(result.data?.status ?? ''),
    errcode: typeof result.data?.errcode === 'number' ? result.data.errcode : undefined,
  };
}

/* ---------------------------------------------------------------- 脚本 × 账号 绑定矩阵 */

/** 从青龙重新采集一次矩阵（读 cron + env + 脚本源码） */
/** 保存整张矩阵（只落面板库，下发是后面单独一步） */
export async function yybSaveBindingsAction(
  items: { script_key: string; refs: string[]; is_hidden?: number }[],
): Promise<string> {
  const result = await panelSend<{ saved: number }>('PUT', '/yyb/bindings', { items });
  revalidatePath('/dashboard/yyb/bindings');
  revalidatePath('/dashboard/yyb/activities');
  if (!result.ok) {
    return `error:${result.msg}`;
  }
  return `ok:已保存 ${result.data?.saved ?? 0} 行绑定（尚未下发到青龙）`;
}

/** 切换脚本的失效隐藏状态（前台活动页面禁止展示） */
export async function yybToggleScriptVisibilityAction(
  scriptKey: string,
  isHidden: boolean,
): Promise<{ ok: boolean; msg: string }> {
  const result = await panelSend<{ updated: number; is_hidden: number }>(
    'PUT',
    '/yyb/bindings/visibility',
    { script_key: scriptKey, is_hidden: isHidden ? 1 : 0 },
  );
  revalidatePath('/dashboard/yyb/bindings');
  revalidatePath('/dashboard/yyb/activities');
  if (!result.ok) {
    return { ok: false, msg: result.msg || '更新状态失败' };
  }
  return {
    ok: true,
    msg: isHidden ? '已标记为失效隐藏（前台活动页面已禁止展示）' : '已恢复正常展示（前台可见）',
  };
}

/** 保存用户名下某个账号参与的活动列表 */
export async function yybSaveMyActivitiesAction(
  accountRef: string,
  enabledScriptKeys: string[],
): Promise<{ ok: boolean; msg: string }> {
  const result = await panelSend<{ modified_count: number; sync_note?: string }>(
    'PUT',
    '/yyb/my-activities',
    {
      account_ref: String(accountRef).trim(),
      enabled_script_keys: enabledScriptKeys,
    },
  );
  revalidatePath('/dashboard/yyb/activities');
  revalidatePath('/dashboard/yyb');
  if (!result.ok) {
    return { ok: false, msg: result.msg || '保存失败' };
  }
  const note = result.data?.sync_note ? `（${result.data.sync_note}）` : '';
  return { ok: true, msg: `配置已生效，更新了 ${result.data?.modified_count ?? 0} 个活动${note}` };
}

/** 跨账号复制活动配置 */
export async function yybCopyActivitiesAction(
  copyFrom: string,
  targetRefs: string[],
): Promise<{ ok: boolean; msg: string }> {
  const result = await panelSend<{ modified_count: number; sync_note?: string }>(
    'PUT',
    '/yyb/my-activities',
    {
      copy_from: String(copyFrom).trim(),
      target_refs: targetRefs,
    },
  );
  revalidatePath('/dashboard/yyb/activities');
  revalidatePath('/dashboard/yyb');
  if (!result.ok) {
    return { ok: false, msg: result.msg || '同步失败' };
  }
  return { ok: true, msg: `已成功将配置同步到 ${targetRefs.length} 个账号` };
}

/** 从青龙重新全量同步定时任务到面板 */
export async function yybSyncBindingsAction(): Promise<{ ok: boolean; msg: string; total?: number }> {
  const result = await panelSend<{ total: number; saved: number }>('POST', '/yyb/bindings/sync');
  revalidatePath('/dashboard/yyb/activities');
  revalidatePath('/dashboard/yyb/bindings');
  if (!result.ok) {
    return { ok: false, msg: result.msg || '同步青龙任务失败' };
  }
  return {
    ok: true,
    msg: `同步成功！已同步青龙最新任务：共 ${result.data?.total ?? 0} 个活动（已落库 ${result.data?.saved ?? 0} 个）`,
    total: result.data?.total,
  };
}
