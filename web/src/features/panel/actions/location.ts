'use server';

import { panelSend } from '@/libs/PanelApi';

/**
 * 位置服务（后端代理）。
 *
 * 天地图 key 存在服务端设置里，浏览器只拿到候选与 city_code，
 * 不会接触 key，也不会直连第三方地图接口。
 */

export type LocationCandidate = {
  city_code: number;
  city_name: string;
  district_name: string;
  poi: string;
  short_name: string;
  full_address: string;
  latitude: string;
  longitude: string;
  source: string;
};

export async function searchLocationAction(
  keyword: string,
): Promise<{ ok: boolean; msg: string; items: LocationCandidate[] }> {
  const q = keyword.trim();
  if (!q) {
    return { ok: true, msg: '', items: [] };
  }
  const resp = await panelSend<{ candidates: LocationCandidate[] }>(
    'GET',
    `/location/search?q=${encodeURIComponent(q)}`,
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, msg: resp.msg || '搜索失败', items: [] };
  }
  return { ok: true, msg: '', items: resp.data.candidates ?? [] };
}

export type ResolvedLocation = {
  ok: boolean;
  city_code: number;
  city_name: string;
  address_name: string;
  latitude: string;
  longitude: string;
  source: string;
};

/** 经纬度 → 城市/地址（天地图优先，失败自动降级）。 */
export async function resolveLocationAction(
  lat: string,
  lon: string,
): Promise<{ ok: boolean; msg: string; data?: ResolvedLocation }> {
  const resp = await panelSend<ResolvedLocation>(
    'GET',
    `/location/resolve?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
  );
  if (!resp.ok || !resp.data) {
    return { ok: false, msg: resp.msg || '解析失败' };
  }
  return { ok: true, msg: '', data: resp.data };
}

/** 网络 IP 粗略定位（拿不到本机定位时的兜底）。 */
export async function ipLocationAction(): Promise<{ ok: boolean; msg: string; data?: ResolvedLocation }> {
  const resp = await panelSend<ResolvedLocation>('GET', '/location/ip');
  if (!resp.ok || !resp.data) {
    return { ok: false, msg: resp.msg || 'IP 定位失败' };
  }
  if (!resp.data.ok) {
    return { ok: false, msg: '没能从当前网络判断位置，请手动搜索商圈' };
  }
  return { ok: true, msg: '', data: resp.data };
}
