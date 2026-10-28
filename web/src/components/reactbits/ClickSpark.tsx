'use client';

import { useRef } from 'react';
import { cn } from '@/utils/Helpers';

const SPARKS = 8;

/**
 * ReactBits 风格 ClickSpark：点击时从点击位置向外放射一圈小火花。
 * 包在任何可点击元素外即可。
 */
export const ClickSpark = (props: {
  children: React.ReactNode;
  className?: string;
  color?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const host = ref.current;
    if (!host) {
      return;
    }
    const rect = host.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (let i = 0; i < SPARKS; i += 1) {
      const spark = document.createElement('span');
      spark.className = 'click-spark';
      const angle = (Math.PI * 2 * i) / SPARKS + Math.random() * 0.4;
      const dist = 26 + Math.random() * 14;
      spark.style.left = `${x}px`;
      spark.style.top = `${y}px`;
      spark.style.background = props.color ?? 'var(--brand-via)';
      spark.style.setProperty('--sx', `${Math.cos(angle) * dist}px`);
      spark.style.setProperty('--sy', `${Math.sin(angle) * dist}px`);
      host.appendChild(spark);
      setTimeout(() => spark.remove(), 650);
    }
  };

  return (
    <div ref={ref} onClick={onClick} className={cn('click-spark-host', props.className)}>
      {props.children}
    </div>
  );
};
