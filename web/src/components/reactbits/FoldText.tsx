'use client';

import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/utils/Helpers';

type Hinge = 'top' | 'bottom' | 'left' | 'right';

type FoldTextProps = {
  text?: string;
  /** 切分粒度 */
  splitBy?: 'char' | 'word' | 'line';
  /** 以哪条边为折页轴 */
  hinge?: Hinge;
  /** 单片翻入时长（秒） */
  duration?: number;
  /** 片与片之间的错峰（秒） */
  stagger?: number;
  /** CSS 缓动函数 */
  ease?: string;
  perspective?: number;
  /** 折起期间的暗部强度 0~1（0 = 关闭） */
  creaseShading?: number;
  trigger?: 'mount' | 'scroll' | 'hover' | 'loop';
  fontSize?: number | string;
  fontWeight?: number | string;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
};

/** 每条折页轴对应的起始旋转方向与位移符号 */
const HINGE_CONFIG: Record<Hinge, { rotateX: number; rotateY: number }> = {
  top: { rotateX: -92, rotateY: 0 },
  bottom: { rotateX: 92, rotateY: 0 },
  left: { rotateX: 0, rotateY: 92 },
  right: { rotateX: 0, rotateY: -92 },
};

/**
 * ReactBits 风格 FoldText：文字按折页轴逐片翻入。
 *
 * 本地零依赖实现：官方用 gsap + ScrollTrigger，这里用
 * CSS 负责结构/perspective/暗部渐变，Web Animations API 负责 3D 折叠与重播
 * （hover / loop 需要能反复 play，WAAPI 比 CSS 关键帧更好控制）。
 */
export const FoldText = ({
  text = 'Design unfolds',
  splitBy = 'char',
  hinge = 'top',
  duration = 0.65,
  stagger = 0.045,
  ease = 'cubic-bezier(0.22, 1, 0.36, 1)',
  perspective = 700,
  creaseShading = 0.55,
  trigger = 'mount',
  fontSize = 80,
  fontWeight = 800,
  color = '#f7f2e8',
  className,
  style,
}: FoldTextProps) => {
  const rootRef = useRef<HTMLSpanElement>(null);
  const animationsRef = useRef<Animation[]>([]);

  const safePerspective = Math.max(120, perspective);
  const safeCrease = Math.min(1, Math.max(0, creaseShading));
  const hingeConfig = HINGE_CONFIG[hinge] ?? HINGE_CONFIG.top;

  const segments = useMemo(() => {
    const renderSegment = (content: string, key: string) => (
      <span
        key={key}
        className="fold-text-segment"
        style={{ ['--fold-perspective' as string]: `${safePerspective}px` }}
      >
        <span className="fold-text-piece" data-hinge={hinge}>
          {content || '\u00A0'}
          <span className="fold-text-crease" aria-hidden />
        </span>
      </span>
    );

    if (splitBy === 'line') {
      return text.split('\n').map((line, index) => (
        <span key={`line-${index}`} className="fold-text-line">
          {renderSegment(line, `seg-line-${index}`)}
        </span>
      ));
    }

    if (splitBy === 'word') {
      return text.split(/(\s+)/).flatMap((part, index) => {
        if (!part) {
          return [];
        }
        // 空白保持不参与折叠，否则词间距会被折出诡异空隙
        if (/^\s+$/.test(part)) {
          return [
            <span key={`ws-${index}`} className="fold-text-whitespace">
              {part.replace(/ /g, '\u00A0')}
            </span>,
          ];
        }
        return [renderSegment(part, `seg-word-${index}`)];
      });
    }

    return Array.from(text).map((char, index) => {
      if (char === '\n') {
        return <br key={`br-${index}`} />;
      }
      return renderSegment(char === ' ' ? '\u00A0' : char, `seg-char-${index}`);
    });
  }, [text, splitBy, hinge, safePerspective]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return undefined;
    }

    const pieces = Array.from(root.querySelectorAll<HTMLElement>('.fold-text-piece'));
    if (pieces.length === 0) {
      return undefined;
    }

    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const activeDuration = reduce ? Math.min(duration, 0.22) : duration;
    const activeStagger = reduce ? Math.min(stagger, 0.02) : stagger;
    const rotateX = reduce ? 0 : hingeConfig.rotateX;
    const rotateY = reduce ? 0 : hingeConfig.rotateY;

    const cancelAll = () => {
      animationsRef.current.forEach(animation => animation.cancel());
      animationsRef.current = [];
    };

    // paused=true 用于 scroll：先建好并悬停起始帧，进入视口再 play
    const build = (paused: boolean) => {
      cancelAll();
      pieces.forEach((piece, index) => {
        const delay = index * activeStagger * 1000;
        const animation = piece.animate(
          [
            { opacity: 0, transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg)` },
            { opacity: 1, transform: 'rotateX(0deg) rotateY(0deg)' },
          ],
          {
            duration: activeDuration * 1000,
            delay,
            easing: ease,
            // both：等待错峰期间就预置起始帧，否则会先闪一下完整文字
            fill: 'both',
          },
        );
        if (paused) {
          animation.pause();
        }
        animationsRef.current.push(animation);

        const crease = piece.querySelector<HTMLElement>('.fold-text-crease');
        if (crease && safeCrease > 0 && !reduce) {
          const creaseAnimation = crease.animate(
            [{ opacity: safeCrease }, { opacity: 0 }],
            { duration: activeDuration * 1000, delay, easing: 'ease-out', fill: 'both' },
          );
          if (paused) {
            creaseAnimation.pause();
          }
          animationsRef.current.push(creaseAnimation);
        }
      });
    };

    const playAll = () => {
      animationsRef.current.forEach(animation => animation.play());
    };

    if (trigger === 'hover') {
      // 悬停前保持静止（可见），每次移入重播一遍
      const onEnter = () => {
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
      // WAAPI 没有 repeatDelay，用「播完再等一会重播」来补
      const slowest = animationsRef.current.reduce((max, animation) => {
        const raw = Number(animation.effect?.getTiming().duration ?? 0);
        return Number.isFinite(raw) ? Math.max(max, raw) : max;
      }, 0);
      const total = slowest + pieces.length * activeStagger * 1000;
      const timer = setInterval(build, total + 750, false);
      return () => {
        clearInterval(timer);
        cancelAll();
      };
    }

    return cancelAll;
  }, [
    segments,
    trigger,
    hinge,
    duration,
    stagger,
    ease,
    safeCrease,
    hingeConfig.rotateX,
    hingeConfig.rotateY,
  ]);

  return (
    <span
      ref={rootRef}
      className={cn('fold-text', className)}
      style={{
        ['--fold-text-font-size' as string]: typeof fontSize === 'number' ? `${fontSize}px` : fontSize,
        ['--fold-text-font-weight' as string]: String(fontWeight),
        ['--fold-text-color' as string]: color,
        ...style,
      }}
    >
      {/* 屏幕阅读器读原文，视觉层对辅助技术隐藏 */}
      <span className="fold-text-sr-only">{text}</span>
      <span aria-hidden>{segments}</span>
    </span>
  );
};
