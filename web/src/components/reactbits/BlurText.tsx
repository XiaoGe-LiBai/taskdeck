'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/Helpers';

type BlurTextProps = {
  text: string;
  /** 按词还是按字拆分 */
  by?: 'word' | 'char';
  delay?: number;
  className?: string;
};

/**
 * ReactBits 风格 BlurText：词/字从模糊到清晰，依次浮现。
 */
export const BlurText = ({
  text,
  by = 'word',
  delay = 120,
  className,
}: BlurTextProps) => {
  const ref = useRef<HTMLSpanElement>(null);
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
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const units = by === 'word' ? text.split(' ') : text.split('');

  return (
    <span ref={ref} className={cn('inline-block', className)} aria-label={text}>
      {units.map((unit, i) => (

        <span
          key={`${i}-${unit}`}
          aria-hidden
          className={cn('blur-unit', visible && 'blur-unit-in')}
          style={{ animationDelay: `${i * delay}ms` }}
        >
          {unit}
          {by === 'word' && i < units.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
};
