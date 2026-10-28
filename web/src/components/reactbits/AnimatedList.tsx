'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/Helpers';

type AnimatedListProps = {
  children: React.ReactNode;
  /** 每项入场间隔 ms */
  stagger?: number;
  /**
   * 触发比例。默认 0.01（只要露出一像素就播）。
   * 不要用大值：threshold 要求「元素可见比例」达标，容器一旦高于约 1/threshold 个视口
   * （0.15 → 约 6.7 个视口）就永远达不到，子项会**永久隐形**。
   */
  threshold?: number;
  className?: string;
};

/**
 * ReactBits 风格 AnimatedList：列表进入视口后子项依次弹入。
 * 直接包一层 div，对 children 逐个附加延迟类。
 */
export const AnimatedList = ({
  children,
  stagger = 80,
  threshold = 0.01,
  className,
}: AnimatedListProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return undefined;
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

  return (
    <div
      ref={ref}
      className={cn('animated-list', visible && 'animated-list-in', className)}
      style={{ ['--stagger' as string]: `${stagger}ms` }}
    >
      {children}
    </div>
  );
};
