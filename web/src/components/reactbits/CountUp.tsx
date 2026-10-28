'use client';

import { useEffect, useRef, useState } from 'react';

type CountUpProps = {
  to: number;
  from?: number;
  /** 动画时长 ms */
  duration?: number;
  /** 千分位分隔 */
  separator?: string;
  /**
   * 触发比例，默认 0.1。
   * 不要用大值：threshold 要求「元素可见比例」达标，遇到超高容器或观察器不回调的场景
   * 会永不触发，数字就一直停在 from（余额显示 0 是严重误导）。
   */
  threshold?: number;
  /**
   * 挂载即开始滚动（默认 true），不等进入视口。
   *
   * 默认开是因为本项目里 CountUp 全用在统计卡上：它们常被包在入场动画
   * （opacity/transform）里，观察器在那种情况下不回调，数字会先停在 0 等兜底 ——
   * 余额这种数字停在 0 看着像"钱没了"。
   * 真需要"滚到才播"的场景（长列表里的远端卡片）显式传 immediate={false}。
   */
  immediate?: boolean;
  className?: string;
};

/**
 * ReactBits 风格 CountUp：数字进入视口后从 from 滚动到 to（easeOut）。
 *
 * 有一道兜底：观察器最多等 `FALLBACK_DELAY`，超时就照常开始滚动 ——
 * 宁可提前播完，也不能让关键数字停在起始值。
 *
 * 这个兜底别调大：统计卡常被包在入场动画（opacity/transform）里，
 * 观察器在那种情况下**不会回调**，数字就真的一直停在 0。
 * 余额这类数字停在 0 一秒半会被当成"钱没了"。
 */
const FALLBACK_DELAY = 400;

export const CountUp = ({
  to,
  from = 0,
  duration = 1200,
  separator = ',',
  threshold = 0.1,
  immediate = true,
  className,
}: CountUpProps) => {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(from);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return undefined;
    }
    let raf = 0;
    let started = false;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let observer: IntersectionObserver | undefined;

    const begin = () => {
      if (started) {
        return;
      }
      started = true;
      observer?.disconnect();
      if (fallback) {
        clearTimeout(fallback);
      }
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - progress) ** 3;
        setValue(Math.round(from + (to - from) * eased));
        if (progress < 1) {
          raf = requestAnimationFrame(tick);
        }
      };
      raf = requestAnimationFrame(tick);
      // 兜底：rAF 被节流（后台标签页、无合成器环境）时定时器保证最终值一定落地，
      // 数字动画可以丢，显示错的余额不行
      settle = setTimeout(setValue, duration + 200, to);
    };

    if (immediate) {
      // 统计卡：挂载即开始，不等视口（观察器在入场动画里不回调，会让数字卡在 0）
      begin();
    } else {
      observer = new IntersectionObserver(
        entries => entries.forEach((e) => {
          if (e.isIntersecting) {
            begin();
          }
        }),
        { threshold },
      );
      observer.observe(el);
      fallback = setTimeout(begin, FALLBACK_DELAY);
    }

    return () => {
      observer?.disconnect();
      if (fallback) {
        clearTimeout(fallback);
      }
      if (settle) {
        clearTimeout(settle);
      }
      cancelAnimationFrame(raf);
    };
  }, [to, from, duration, threshold, immediate]);

  const text = separator
    ? value.toLocaleString('en-US').replace(/,/g, separator)
    : String(value);

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
};
