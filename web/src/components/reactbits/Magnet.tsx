'use client';

import { useRef } from 'react';
import { cn } from '@/utils/Helpers';

/**
 * ReactBits 风格 Magnet：鼠标靠近时内容被轻微「吸附」跟随，移开回弹。
 * 只改 transform，不重渲染。
 */
export const Magnet = (props: {
  children: React.ReactNode;
  className?: string;
  /** 吸附强度 0~1，越大跟得越紧 */
  strength?: number;
  /** 最大位移 px */
  max?: number;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const strength = props.strength ?? 0.25;
    const max = props.max ?? 10;
    const dx = (e.clientX - (rect.left + rect.width / 2)) * strength;
    const dy = (e.clientY - (rect.top + rect.height / 2)) * strength;
    el.style.transform = `translate(${Math.max(-max, Math.min(max, dx))}px, ${Math.max(-max, Math.min(max, dy))}px)`;
  };

  const onMouseLeave = () => {
    const el = ref.current;
    if (el) {
      el.style.transform = 'translate(0, 0)';
    }
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={cn('magnet-wrap', props.className)}
    >
      {props.children}
    </div>
  );
};
