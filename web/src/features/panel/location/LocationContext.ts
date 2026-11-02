'use client';

import { createContext, useContext } from 'react';

/** 当前生效的定位（不落库，只存浏览器本地，跨页面共用同一份）。 */
export type GeoLocation = {
  cityCode: string;
  cityName: string;
  addressName: string;
  lat: string;
  lon: string;
  /** tianditu / fallback / estimate / ip / manual */
  source: string;
  updatedAt: number;
};

export type LocationContextValue = {
  location: GeoLocation | null;
  history: GeoLocation[];
  isOpen: boolean;
  open: () => void;
  close: () => void;
  apply: (loc: GeoLocation) => void;
  removeHistory: (item: GeoLocation) => void;
  clearHistory: () => void;
  /** 顶栏/提示条用的一行文案 */
  label: string;
};

export const LocationContext = createContext<LocationContextValue | null>(null);

export const useGeoLocation = (): LocationContextValue => {
  const ctx = useContext(LocationContext);
  if (!ctx) {
    throw new Error('useGeoLocation 必须在 LocationProvider 内使用');
  }
  return ctx;
};
