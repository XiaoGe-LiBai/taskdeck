'use client';

import type { ReactNode } from 'react';
import type { GeoLocation, LocationContextValue } from './LocationContext';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LocationContext } from './LocationContext';
import { LocationModal } from './LocationModal';

const STORE_KEY = 'xc_geo_location';
const HISTORY_KEY = 'xc_geo_history';
const PROMPTED_KEY = 'xc_geo_prompted';
const HISTORY_MAX = 6;

const parse = <T,>(raw: string | null): T | null => {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const sameLocation = (a: GeoLocation, b: GeoLocation) =>
  a.addressName === b.addressName && a.cityCode === b.cityCode && a.lat === b.lat && a.lon === b.lon;

/**
 * 全局定位。
 *
 * 系统**不设默认定位**：没定位时附近霸王餐、抢单、店铺监控都用不了，
 * 顶部会一直挂着醒目提示，避免「默默按深圳查」这种看起来有数据、其实全错的情况。
 * 定位只存浏览器（localStorage），换设备需要重新获取。
 */
export const LocationProvider = (props: { children: ReactNode }) => {
  const [location, setLocation] = useState<GeoLocation | null>(null);
  const [history, setHistory] = useState<GeoLocation[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [restored, setRestored] = useState(false);

  // 首屏后再读本地存储：直接读会和服务端渲染结果不一致
  useEffect(() => {
    const stored = parse<GeoLocation>(localStorage.getItem(STORE_KEY));
    const storedHistory = parse<GeoLocation[]>(localStorage.getItem(HISTORY_KEY)) ?? [];
    if (stored) {
      setLocation(stored);
    }
    if (storedHistory.length) {
      setHistory(storedHistory);
    }
    if (!stored && !sessionStorage.getItem(PROMPTED_KEY)) {
      sessionStorage.setItem(PROMPTED_KEY, '1');
      setIsOpen(true);
    }
    setRestored(true);
  }, []);

  const apply = useCallback((next: GeoLocation) => {
    setLocation(next);
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
    setHistory((prev) => {
      const merged = [next, ...prev.filter(item => !sameLocation(item, next))].slice(0, HISTORY_MAX);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
      return merged;
    });
    setIsOpen(false);
  }, []);

  const removeHistory = useCallback((item: GeoLocation) => {
    setHistory((prev) => {
      const merged = prev.filter(entry => !sameLocation(entry, item));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
      return merged;
    });
  }, []);

  const clearHistory = useCallback(() => {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  }, []);

  const value = useMemo<LocationContextValue>(() => ({
    location,
    history,
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    apply,
    removeHistory,
    clearHistory,
    label: location
      ? `${location.cityName || '未知城市'} · ${location.addressName || '已定位'}`
      : '未设置定位',
  }), [location, history, isOpen, apply, removeHistory, clearHistory]);

  return (
    <LocationContext.Provider value={value}>
      {restored && !location && (
        <div className="
          relative mb-4 flex flex-wrap items-center justify-between gap-3
          rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3
          text-sm text-amber-700
          dark:text-amber-300
        "
        >
          <div>
            <span className="font-semibold">请先获取抢单定位。</span>
            系统不设默认定位：附近霸王餐、抢单与店铺监控都要按真实位置匹配，
            否则拿到的店和名额都是错的。
          </div>
          <button
            type="button"
            onClick={value.open}
            className="
              shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium
              text-white shadow-sm transition-opacity
              hover:opacity-90
            "
          >
            获取本机定位 / 搜索商圈
          </button>
        </div>
      )}
      {props.children}
      <LocationModal />
    </LocationContext.Provider>
  );
};
