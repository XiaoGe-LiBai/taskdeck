'use client';

import { useEffect, useState } from 'react';

const COLORS = ['#f97316', '#ec4899', '#a855f7', '#22c55e', '#3b82f6', '#eab308'];

type ConfettiBurstProps = {
  /** 自增触发：值变化时放一轮彩带；0 不放 */
  fire: number;
  /** 彩带数量 */
  count?: number;
};

/**
 * 签到/中奖成功彩带：fire 变化时在原地撒一轮 CSS 彩带，结束自动卸载。
 */
export const ConfettiBurst = ({ fire, count = 26 }: ConfettiBurstProps) => {
  const [pieces, setPieces] = useState<Array<{ x: number; c: string; d: number }>>([]);

  useEffect(() => {
    if (!fire) {
      return;
    }
    setPieces(
      Array.from({ length: count }, (_, i) => ({
        x: (Math.random() - 0.5) * 220,
        c: COLORS[i % COLORS.length]!,
        d: Math.random() * 180,
      })),
    );
    const timer = setTimeout(setPieces, 1700, []);
    return () => clearTimeout(timer);
  }, [fire, count]);

  if (pieces.length === 0) {
    return null;
  }
  return (
    <div
      aria-hidden
      className="
        pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center
      "
    >
      <div className="relative">
        {pieces.map((p, i) => (

          <span
            key={`${fire}-${i}`}
            className="confetti-piece"
            style={{
              left: `${(i / pieces.length) * 100}%`,
              background: p.c,
              ['--cx' as string]: `${p.x}px`,
              ['--cd' as string]: `${p.d}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
};
