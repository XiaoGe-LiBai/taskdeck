'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/utils/Helpers';

/**
 * ReactBits 风格 TextPressure：文字字号随容器宽度弹性填充，
 * 鼠标横移时字重（粗细）跟随变化（font-variation 感，用 weight + scale 模拟）。
 */
export const TextPressure = (props: {
  text: string;
  className?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const fit = () => {
      const span = el.querySelector<HTMLSpanElement>('.text-pressure-inner');
      if (!span) {
        return;
      }
      span.style.fontSize = '16px';
      const ratio = el.clientWidth / Math.max(1, span.offsetWidth);
      span.style.fontSize = `${Math.floor(16 * ratio * 0.92)}px`;
    };

    fit();

    const observer = new ResizeObserver(fit);
    observer.observe(el);

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const span = el.querySelector<HTMLSpanElement>('.text-pressure-inner');
      if (span) {
        span.style.fontWeight = String(400 + Math.round(t * 400));
        span.style.letterSpacing = `${(t - 0.5) * 0.06}em`;
      }
    };
    el.addEventListener('mousemove', onMove);
    return () => {
      observer.disconnect();
      el.removeEventListener('mousemove', onMove);
    };
  }, [props.text]);

  return (
    <div ref={ref} className={cn('text-pressure', props.className)}>
      <span className="text-pressure-inner">{props.text}</span>
    </div>
  );
};
