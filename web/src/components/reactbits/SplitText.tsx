'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/utils/Helpers';

type SplitType = 'chars' | 'words' | 'lines';

type SplitTextProps = {
  text: string;
  /** 切分粒度：逐字 / 逐词 / 逐行 */
  splitType?: SplitType;
  /** 单位之间的错峰 ms */
  delay?: number;
  /** 单个单位动画时长（秒） */
  duration?: number;
  /** 起始下沉位移（em） */
  shift?: number;
  /** 进入视口的触发阈值 */
  threshold?: number;
  className?: string;
  unitClassName?: string;
};

type Part = { content: string; animated: boolean; index: number };

/**
 * ReactBits 风格 SplitText：按字 / 词 / 行上浮淡入，进入视口时播放一次。
 *
 * 本地零依赖实现（CSS 关键帧 + animationDelay 错峰）。
 * 行模式用 \n 切分；词模式保留空格不参与动画，避免词间距出现空洞。
 * 根元素固定为 <span>（不暴露 ReactBits 的 tag/from/to，保持本仓库写法一致）。
 */
export const SplitText = ({
  text,
  splitType = 'chars',
  delay = 40,
  duration = 0.5,
  shift = 0.6,
  threshold = 0.2,
  className,
  unitClassName,
}: SplitTextProps) => {
  const ref = useRef<HTMLSpanElement>(null);
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

  const parts = useMemo<Part[]>(() => {
    // 顺序编号只发给真正参与动画的单位，空格不占号，错峰才连续
    let animatedIndex = -1;
    const build = (content: string, animated: boolean): Part => {
      if (animated) {
        animatedIndex += 1;
      }
      return { content, animated, index: animatedIndex };
    };

    if (splitType === 'lines') {
      return text.split('\n').map(line => build(line || '\u00A0', true));
    }

    if (splitType === 'words') {
      return text
        .split(/(\s+)/)
        .filter(Boolean)
        .map(part => (/^\s+$/.test(part)
          ? build(part.replace(/ /g, '\u00A0'), false)
          : build(part, true)));
    }

    return Array.from(text).map(char => build(char === ' ' ? '\u00A0' : char, true));
  }, [text, splitType]);

  const isLineMode = splitType === 'lines';

  return (
    <span ref={ref} className={cn('text-split', className)} aria-label={text}>
      {parts.map((part, i) => {
        if (!part.animated) {
          return (
            // eslint-disable-next-line react/no-array-index-key
            <span key={`ws-${i}`} aria-hidden>
              {part.content}
            </span>
          );
        }
        return (
          <span
            // eslint-disable-next-line react/no-array-index-key
            key={`unit-${i}`}
            aria-hidden
            className={cn('text-split-unit', visible && 'text-split-unit-in', unitClassName)}
            style={{
              animationDelay: `${part.index * delay}ms`,
              display: isLineMode ? 'block' : undefined,
              ['--split-dur' as string]: `${duration}s`,
              ['--split-shift' as string]: `${shift}em`,
            }}
          >
            {part.content}
          </span>
        );
      })}
    </span>
  );
};
