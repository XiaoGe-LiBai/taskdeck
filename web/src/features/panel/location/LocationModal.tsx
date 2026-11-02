'use client';

import type { LocationCandidate } from '../actions/location';
import type { GeoLocation } from './LocationContext';
import { useEffect, useRef, useState } from 'react';
import { ipLocationAction, resolveLocationAction, searchLocationAction } from '../actions/location';
import { useGeoLocation } from './LocationContext';

const SOURCE_LABEL: Record<string, string> = {
  tianditu: '天地图',
  fallback: '免费逆地理',
  estimate: '粗略估算',
  ip: '网络 IP',
  manual: '手动微调',
};

/** 从后端候选/逆地理结果拼成统一结构 */
const toGeo = (
  base: { city_code: number; city_name: string; address_name?: string; full_address?: string; latitude: string; longitude: string; source: string },
): GeoLocation => ({
  cityCode: String(base.city_code || ''),
  cityName: base.city_name || '',
  addressName: base.address_name || base.full_address || base.city_name || '',
  lat: String(base.latitude || ''),
  lon: String(base.longitude || ''),
  source: base.source || 'manual',
  updatedAt: Date.now(),
});

export const LocationModal = () => {
  const { isOpen, close, location, history, apply, removeHistory, clearHistory } = useGeoLocation();
  const [keyword, setKeyword] = useState('');
  const [candidates, setCandidates] = useState<LocationCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<'geo' | 'ip' | 'resolve' | ''>('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [lng, setLng] = useState(location?.lon ?? '');
  const [lat, setLat] = useState(location?.lat ?? '');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLng(location?.lon ?? '');
      setLat(location?.lat ?? '');
      setMessage(null);
    }
  }, [isOpen, location]);

  // 关键词防抖：每敲一下都打接口既慢又容易被地图服务限频
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    const q = keyword.trim();
    if (!q) {
      setCandidates([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      const result = await searchLocationAction(q);
      setCandidates(result.items);
      setSearching(false);
      if (!result.ok) {
        setMessage({ ok: false, text: result.msg });
      }
    }, 400);
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [keyword]);

  if (!isOpen) {
    return null;
  }

  const applyBrowserGeo = () => {
    if (!navigator.geolocation) {
      setMessage({ ok: false, text: '当前浏览器不支持定位，请搜索地址或手动填坐标' });
      return;
    }
    if (!window.isSecureContext) {
      // HTTP 下浏览器直接拒绝定位（只有 https 或 localhost 才算安全上下文）
      setMessage({
        ok: false,
        text: '当前是 HTTP 访问，浏览器禁止定位。请改用 HTTPS，或点「网络 IP 定位」/搜索商圈代替',
      });
      return;
    }
    setBusy('geo');
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const result = await resolveLocationAction(
          pos.coords.latitude.toFixed(6),
          pos.coords.longitude.toFixed(6),
        );
        setBusy('');
        if (!result.ok || !result.data) {
          setMessage({ ok: false, text: result.msg || '定位解析失败' });
          return;
        }
        setLat(result.data.latitude);
        setLng(result.data.longitude);
        setMessage({ ok: true, text: `已获取本机定位：${result.data.address_name || result.data.city_name}` });
      },
      (error) => {
        setBusy('');
        setMessage({
          ok: false,
          text: error.code === error.PERMISSION_DENIED
            ? '定位被拒绝，请在浏览器地址栏允许本站获取位置，或手动搜索商圈'
            : '定位失败，请重试或搜索地址',
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  const applyIp = async () => {
    setBusy('ip');
    setMessage(null);
    const result = await ipLocationAction();
    setBusy('');
    if (!result.ok || !result.data) {
      setMessage({ ok: false, text: result.msg });
      return;
    }
    setLat(result.data.latitude);
    setLng(result.data.longitude);
    setMessage({ ok: true, text: `已按网络 IP 定位到 ${result.data.address_name || result.data.city_name}` });
  };

  const applyManual = async () => {
    if (!lng.trim() || !lat.trim()) {
      setMessage({ ok: false, text: '请把经度和纬度都填上' });
      return;
    }
    if (!/^-?\d+(?:\.\d+)?$/.test(lng.trim()) || !/^-?\d+(?:\.\d+)?$/.test(lat.trim())) {
      setMessage({ ok: false, text: '经纬度只能是数字' });
      return;
    }
    setBusy('resolve');
    setMessage(null);
    const result = await resolveLocationAction(lat.trim(), lng.trim());
    setBusy('');
    if (!result.ok || !result.data) {
      setMessage({ ok: false, text: result.msg || '解析失败' });
      return;
    }
    apply({ ...toGeo(result.data), source: 'manual' });
  };

  return (
    <div className="
      fixed inset-0 z-50 flex items-start justify-center overflow-y-auto
      bg-black/40 p-4 backdrop-blur-sm
    "
    >
      <div className="
        mt-10 w-full max-w-2xl rounded-lg border bg-card shadow-xl
      "
      >
        <div className="
          flex items-start justify-between gap-4 border-b px-5 py-4
        "
        >
          <div>
            <h2 className="text-base font-semibold">抢单位置设置</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              系统不设默认定位。抢单前请获取本机真实定位或搜索商圈，以精确匹配周边霸王餐与满返名额。
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="
              rounded-md border px-2 py-1 text-xs text-muted-foreground
              hover:bg-muted
            "
          >
            关闭
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-xs text-muted-foreground">当前位置：</span>
            {location
              ? (
                  <span className="font-medium">
                    {location.cityName}
                    {' · '}
                    {location.addressName}
                    <span className="ml-2 text-xs text-muted-foreground">
                      （
                      {location.lon}
                      ,
                      {' '}
                      {location.lat}
                      {' '}
                      ·
                      {' '}
                      {SOURCE_LABEL[location.source] ?? location.source}
                      ）
                    </span>
                  </span>
                )
              : <span className="text-amber-600">未获取位置，请点击「获取本机定位」或搜索地址</span>}
            <div className="mt-1 text-xs text-muted-foreground">
              城市码：
              {location?.cityCode || '未配置'}
            </div>
          </div>

          {message && (
            <div className={`
              rounded-md border px-3 py-2 text-xs
              ${message.ok
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
              : 'border-rose-500/20 bg-rose-500/10 text-rose-700'}
            `}
            >
              {message.text}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyBrowserGeo}
              disabled={Boolean(busy)}
              className="
                rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-medium
                text-white shadow-sm
                disabled:opacity-50
              "
            >
              {busy === 'geo' ? '定位中…' : '获取本机定位'}
            </button>
            <button
              type="button"
              onClick={() => void applyIp()}
              disabled={Boolean(busy)}
              className="
                rounded-md border px-3 py-1.5 text-xs font-medium
                hover:bg-muted
                disabled:opacity-50
              "
            >
              {busy === 'ip' ? '查询中…' : '网络 IP 定位'}
            </button>
          </div>

          <div>
            <label className="
              mb-1 block text-xs font-medium text-muted-foreground
            "
            >
              搜索地址或地标
            </label>
            <input
              value={keyword}
              onChange={event => setKeyword(event.target.value)}
              placeholder="例如：深圳福田车公庙 / 广州天河城"
              className="
                h-9 w-full rounded-md border bg-background px-3 text-sm
              "
            />
            {searching && <div className="mt-1 text-xs text-muted-foreground">搜索中…</div>}
            {!searching && keyword.trim() && candidates.length === 0 && (
              <div className="mt-1 text-xs text-muted-foreground">
                没有搜到候选；可换关键词，或直接用下方坐标微调
              </div>
            )}
            {candidates.length > 0 && (
              <ul className="mt-2 max-h-56 overflow-y-auto rounded-md border">
                {candidates.map(item => (
                  <li key={`${item.city_code}-${item.longitude}-${item.latitude}-${item.short_name}`}>
                    <button
                      type="button"
                      onClick={() => apply(toGeo({ ...item, address_name: item.full_address || item.short_name }))}
                      className="
                        w-full px-3 py-2 text-left text-sm
                        hover:bg-muted
                      "
                    >
                      <div className="font-medium">{item.short_name || item.poi}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.city_name}
                        {item.district_name ? ` · ${item.district_name}` : ''}
                        {' · '}
                        {item.longitude}
                        ,
                        {item.latitude}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">历史位置</span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="
                    text-xs text-muted-foreground
                    hover:underline
                  "
                >
                  清空
                </button>
              )}
            </div>
            {history.length === 0
              ? <div className="text-xs text-muted-foreground">暂无历史位置，确认设置后自动记录</div>
              : (
                  <ul className="flex flex-col gap-1">
                    {history.map(item => (
                      <li
                        key={`${item.cityCode}-${item.lon}-${item.lat}-${item.addressName}`}
                        className="
                          flex items-center justify-between gap-2 rounded-md
                          border px-3 py-1.5
                        "
                      >
                        <button
                          type="button"
                          onClick={() => apply(item)}
                          className="min-w-0 flex-1 text-left text-sm"
                        >
                          <span className="font-medium">{item.cityName}</span>
                          <span className="text-muted-foreground">
                            {' '}
                            ·
                            {item.addressName}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeHistory(item)}
                          className="
                            text-xs text-muted-foreground
                            hover:underline
                          "
                        >
                          删除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">坐标微调</div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="
                flex flex-col gap-1 text-xs text-muted-foreground
              "
              >
                经度
                <input
                  value={lng}
                  onChange={event => setLng(event.target.value)}
                  placeholder="114.057868"
                  className="
                    h-9 w-32 rounded-md border bg-background px-2 text-sm
                    text-foreground
                  "
                />
              </label>
              <label className="
                flex flex-col gap-1 text-xs text-muted-foreground
              "
              >
                纬度
                <input
                  value={lat}
                  onChange={event => setLat(event.target.value)}
                  placeholder="22.543099"
                  className="
                    h-9 w-32 rounded-md border bg-background px-2 text-sm
                    text-foreground
                  "
                />
              </label>
              <button
                type="button"
                onClick={() => void applyManual()}
                disabled={Boolean(busy)}
                className="
                  h-9 rounded-md border px-3 text-xs font-medium
                  hover:bg-muted
                  disabled:opacity-50
                "
              >
                {busy === 'resolve' ? '解析中…' : '按坐标定位'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
