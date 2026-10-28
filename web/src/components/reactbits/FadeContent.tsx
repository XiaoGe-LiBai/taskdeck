'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/Helpers';

type FadeContentProps = {
  children: React.ReactNode;
  /** 触发后的过渡时长 ms */
  duration?: number;
  /** 进入视口阈值 */
  threshold?: number;
  /** 起始位移 px */
  distance?: number;
  direction?: 'up' | 'down' | 'left' | 'right' | 'none';
  delay?: number;
  className?: string;
};

/**
 * ReactBits 风格 FadeContent：子内容进入视口时淡入 + 位移。
 */
export const FadeContent = ({
  children,
  duration = 600,
  threshold = 0.2,
  distance = 16,
  direction = 'up',
  delay = 0,
  className,
}: FadeContentProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new IntersectionObserver(
      entries => entries.forEach((e) => {
        if (e.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      }),
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  const offset: Record<string, string> = {
    up: `translateY(${distance}px)`,
    down: `translateY(-${distance}px)`,
    left: `translateX(${distance}px)`,
    right: `translateX(-${distance}px)`,
    none: 'none',
  };

  return (
    <div
      ref={ref}
      className={cn('transition-all ease-out', className)}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : offset[direction],
        transitionDuration: `${duration}ms`,
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  );
};
