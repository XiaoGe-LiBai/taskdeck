'use client';

import { useGeoLocation } from './LocationContext';

/**
 * 顶栏定位入口：始终可见，未设置时高亮提醒。
 *
 * 定位不设默认值，所以这里必须能一眼看出「有没有定位、是哪」，
 * 否则用户会以为搜索没结果，其实是没定位。
 */
export const LocationButton = () => {
  const { location, label, open } = useGeoLocation();

  return (
    <button
      type="button"
      onClick={open}
      title={location ? `${label}（点击修改）` : '未设置定位，点击获取'}
      className={`
        inline-flex max-w-56 items-center gap-1.5 rounded-md border px-2.5
        py-1.5 text-xs font-medium whitespace-nowrap transition-colors
        ${location
      ? 'hover:bg-muted'
      : `
        border-amber-500/40 bg-amber-500/10 text-amber-700
        dark:text-amber-300
      `}
      `}
    >
      <span aria-hidden>📍</span>
      <span className="truncate">{location ? label : '设置定位'}</span>
    </button>
  );
};
