'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/utils/Helpers';

type StrokeTextProps = {
  text?: string;
  /** 描边颜色 */
  strokeColor?: string;
  /** 填充颜色 */
  fillColor?: string;
  strokeWidth?: number;
  /** 描边绘制时长（秒） */
  drawDuration?: number;
  /** 描边画完后，填充开始前的等待（秒） */
  fillDelay?: number;
  /** 每个字的错峰（秒） */
  stagger?: number;
  trigger?: 'mount' | 'scroll' | 'hover' | 'loop';
  /** 填充出现方式：擦除 / 淡入 / 不填充（只留描边） */
  fillMode?: 'wipe' | 'fade' | 'none';
  fontSize?: number;
  fontWeight?: number | string;
  letterSpacing?: number;
  /** 错峰从最后一个字开始 */
  reverse?: boolean;
  className?: string;
};

type Box = { x: number; y: number; width: number; height: number };

/**
 * ReactBits 风格 StrokeText：文字先被「描」出来，再填入实色。
 *
 * 本地零依赖实现：官方用 gsap timeline，这里用 Web Animations API
 * （hover / loop 需要反复重播，WAAPI 比 CSS 关键帧更可控）。
 * 尺寸靠 getBBox() 实测后写死像素，保证 viewBox 与渲染尺寸 1:1，字形不会被缩放走形。
 */
export const StrokeText = ({
  text = 'Draw Attention',
  strokeColor = '#A78BFA',
  fillColor = '#F8FAFC',
  strokeWidth = 1.4,
  drawDuration = 1.6,
  fillDelay = 0.2,
  stagger = 0.05,
  trigger = 'mount',
  fillMode = 'wipe',
  fontSize = 128,
  fontWeight = 800,
  letterSpacing = -4,
  reverse = false,
  className,
}: StrokeTextProps) => {
  const rootRef = useRef<HTMLSpanElement>(null);
  const strokeTextRef = useRef<SVGTextElement>(null);
  const clipRectRef = useRef<SVGRectElement>(null);
  const animationsRef = useRef<Animation[]>([]);
  const [box, setBox] = useState<Box | null>(null);

  const rawId = useId();
  const clipId = useMemo(
    () => `stroke-text-wipe-${rawId.replace(/[^\w-]/g, '')}`,
    [rawId],
  );

  const characters = useMemo(() => Array.from(String(text ?? '')), [text]);
  // 单个字形的描边总长上限：取足够大即可遮盖最长的笔画
  const dash = Math.max(fontSize * 7, 200);

  const fontStyle = useMemo(
    () => ({
      fontSize: `${fontSize}px`,
      fontWeight,
      letterSpacing: `${letterSpacing}px`,
    }),
    [fontSize, fontWeight, letterSpacing],
  );

  // 实测字形包围盒：viewBox 必须按真实尺寸算，否则字形会被缩放
  useLayoutEffect(() => {
    const node = strokeTextRef.current;
    if (!node) {
      return undefined;
    }
    let cancelled = false;

    const measure = () => {
      if (cancelled || !strokeTextRef.current) {
        return;
      }
      let bbox: SVGRect;
      try {
        bbox = strokeTextRef.current.getBBox();
      } catch {
        return;
      }
      if (!bbox || !bbox.width) {
        return;
      }
      const pad = Math.max(Number(strokeWidth) || 1, fontSize * 0.1);
      const next: Box = {
        x: bbox.x - pad,
        y: bbox.y - pad,
        width: bbox.width + pad * 2,
        height: bbox.height + pad * 2,
      };
      setBox(prev => (prev
        && Math.abs(prev.x - next.x) < 0.5
        && Math.abs(prev.y - next.y) < 0.5
        && Math.abs(prev.width - next.width) < 0.5
        ? prev
        : next));
    };

    measure();
    // 字体真正加载完字形宽度会变，必须重测
    document.fonts.ready.then(measure).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [characters, fontSize, fontWeight, letterSpacing, strokeWidth]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !box) {
      return undefined;
    }

    const strokes = Array.from(root.querySelectorAll<SVGElement>('[data-stroke-char]'));
    const fills = Array.from(root.querySelectorAll<SVGElement>('[data-fill-char]'));
    const clip = clipRectRef.current;
    if (strokes.length === 0) {
      return undefined;
    }

    const fillEnabled = fillMode !== 'none';
    const useWipe = fillEnabled && fillMode === 'wipe';
    const drawMs = drawDuration * 1000;
    const fillMs = Math.max(0.4, drawDuration * 0.5) * 1000;
    const staggerMs = stagger * 1000;
    const fillStartMs = drawMs + fillDelay * 1000;

    const cancelAll = () => {
      animationsRef.current.forEach(animation => animation.cancel());
      animationsRef.current = [];
    };

    // 反向错峰：从最后一个字开始收笔
    const orderOf = (index: number) => (reverse ? strokes.length - 1 - index : index);

    // 直接写行内样式作为「静止态」（未被 WAAPI 动画覆盖时生效）
    const applyEndState = () => {
      strokes.forEach((el) => {
        el.style.strokeDashoffset = '0';
      });
      fills.forEach((el) => {
        el.style.opacity = fillEnabled ? '1' : '0';
      });
      if (clip) {
        clip.style.transform = fillEnabled ? 'scaleX(1)' : 'scaleX(0)';
      }
    };

    const build = (paused: boolean) => {
      cancelAll();
      strokes.forEach((el, index) => {
        const animation = el.animate(
          [{ strokeDashoffset: dash }, { strokeDashoffset: 0 }],
          {
            duration: drawMs,
            delay: orderOf(index) * staggerMs,
            easing: 'ease-out',
            fill: 'both',
          },
        );
        if (paused) {
          animation.pause();
        }
        animationsRef.current.push(animation);
      });

      if (useWipe && clip) {
        const animation = clip.animate(
          [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
          { duration: fillMs, delay: fillStartMs, easing: 'ease-in-out', fill: 'both' },
        );
        if (paused) {
          animation.pause();
        }
        animationsRef.current.push(animation);
      } else if (fillEnabled) {
        fills.forEach((el, index) => {
          const animation = el.animate(
            [{ opacity: 0 }, { opacity: 1 }],
            {
              duration: fillMs,
              delay: fillStartMs + orderOf(index) * staggerMs,
              easing: 'ease-out',
              fill: 'both',
            },
          );
          if (paused) {
            animation.pause();
          }
          animationsRef.current.push(animation);
        });
      }
    };

    const playAll = () => {
      animationsRef.current.forEach(animation => animation.play());
    };

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reduce) {
      // 不做动画，直接呈现最终形态
      cancelAll();
      applyEndState();
      return undefined;
    }

    if (trigger === 'hover') {
      // 悬停前停在最终形态，每次移入重新描一遍
      applyEndState();
      const onEnter = () => {
        // 回到未描边状态再播，否则看不到「描」的过程
        strokes.forEach((el) => {
          el.style.strokeDashoffset = String(dash);
        });
        if (clip) {
          clip.style.transform = 'scaleX(0)';
        }
        if (fillEnabled && !useWipe) {
          fills.forEach((el) => {
            el.style.opacity = '0';
          });
        }
        build(false);
      };
      root.addEventListener('pointerenter', onEnter);
      return () => {
        root.removeEventListener('pointerenter', onEnter);
        cancelAll();
      };
    }

    if (trigger === 'scroll') {
      build(true);
      const observer = new IntersectionObserver(
        entries => entries.forEach((entry) => {
          if (entry.isIntersecting) {
            playAll();
            observer.disconnect();
          }
        }),
        { rootMargin: '0px 0px -18% 0px' },
      );
      observer.observe(root);
      return () => {
        observer.disconnect();
        cancelAll();
      };
    }

    build(false);

    if (trigger === 'loop') {
      const slowest = animationsRef.current.reduce((max, animation) => {
        const raw = Number(animation.effect?.getTiming().duration ?? 0);
        return Number.isFinite(raw) ? Math.max(max, raw) : max;
      }, 0);
      const timer = setInterval(build, slowest + fillStartMs + 900, false);
      return () => {
        clearInterval(timer);
        cancelAll();
      };
    }

    return cancelAll;
  }, [box, dash, drawDuration, fillDelay, stagger, trigger, fillMode, reverse]);

  const viewBox = box
    ? `${box.x} ${box.y} ${box.width} ${box.height}`
    : `0 ${-fontSize} 600 ${fontSize * 1.3}`;

  const rootStyle: React.CSSProperties = box
    ? {
        width: `${box.width}px`,
        // 窄屏等比缩小：定死像素宽会撑破小屏布局
        maxWidth: '100%',
        aspectRatio: `${box.width} / ${box.height}`,
      }
    : { width: '100%', height: `${Math.round(fontSize * 1.3)}px` };

  return (
    <span
      ref={rootRef}
      className={cn('stroke-text', className)}
      style={rootStyle}
      role="img"
      aria-label={String(text ?? '')}
    >
      <svg
        className="stroke-text-svg"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
        style={{ width: '100%', height: '100%', visibility: box ? 'visible' : 'hidden' }}
      >
        {fillMode === 'wipe' && box && (
          <defs>
            <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
              <rect
                ref={clipRectRef}
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                style={{
                  transformBox: 'view-box',
                  transformOrigin: `${box.x}px ${box.y}px`,
                  transform: 'scaleX(0)',
                }}
              />
            </clipPath>
          </defs>
        )}

        <text
          ref={strokeTextRef}
          className="stroke-text-stroke"
          x="0"
          y="0"
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          style={fontStyle}
        >
          {characters.map((char, index) => (

            <tspan
              key={`s-${index}`}
              data-stroke-char
              style={{ strokeDasharray: dash, strokeDashoffset: dash }}
            >
              {char}
            </tspan>
          ))}
        </text>

        <text
          className="stroke-text-fill"
          x="0"
          y="0"
          fill={fillColor}
          stroke="none"
          style={fontStyle}
          clipPath={fillMode === 'wipe' && box ? `url(#${clipId})` : undefined}
        >
          {characters.map((char, index) => (

            <tspan
              key={`f-${index}`}
              data-fill-char
              style={{ opacity: fillMode === 'fade' ? 0 : 1 }}
            >
              {char}
            </tspan>
          ))}
        </text>
      </svg>
    </span>
  );
};
