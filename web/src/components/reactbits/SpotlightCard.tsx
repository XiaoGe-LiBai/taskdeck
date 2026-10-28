'use client';

import { useRef } from 'react';
import { cn } from '@/utils/Helpers';

/**
 * ReactBits 风格 SpotlightCard：卡片上跟随鼠标的径向聚光灯。
 * 挂在 onMouseMove 上改 CSS 变量，零重渲染。
 */
export const SpotlightCard = (props: {
  children: React.ReactNode;
  className?: string;
  /** 聚光颜色，默认品牌橙 */
  spotlightColor?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--spot-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--spot-y', `${e.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      className={cn('spotlight-card', props.className)}
      style={{
        ['--spot-color' as string]: props.spotlightColor
          ?? 'color-mix(in oklab, var(--brand-from) 18%, transparent)',
      }}
    >
      {props.children}
    </div>
  );
};
