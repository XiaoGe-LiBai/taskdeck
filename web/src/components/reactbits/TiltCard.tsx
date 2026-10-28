'use client';

import { useRef } from 'react';
import { cn } from '@/utils/Helpers';

/**
 * ReactBits 风格 TiltCard：卡片随鼠标位置做 3D 倾斜 + 顶部扫光。
 */
export const TiltCard = (props: {
  children: React.ReactNode;
  className?: string;
  /** 最大倾角 deg */
  maxTilt?: number;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const max = props.maxTilt ?? 10;

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(700px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) scale(1.02)`;
    el.style.setProperty('--glare-x', `${(px + 0.5) * 100}%`);
    el.style.setProperty('--glare-y', `${(py + 0.5) * 100}%`);
  };

  const onMouseLeave = () => {
    const el = ref.current;
    if (el) {
      el.style.transform = 'perspective(700px) rotateX(0deg) rotateY(0deg) scale(1)';
    }
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={cn('tilt-card', props.className)}
    >
      {props.children}
    </div>
  );
};
