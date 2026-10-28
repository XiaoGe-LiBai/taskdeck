'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/utils/Helpers';

type TextTypeProps = {
  /** 单句文案，或需要轮播的多句 */
  text: string | string[];
  /** 每字输入间隔 ms */
  typingSpeed?: number;
  /** 首次开始前的额外延迟 ms */
  initialDelay?: number;
  /** 一句写完 / 删完后的停顿 ms */
  pauseDuration?: number;
  /** 退格时每字间隔 ms */
  deletingSpeed?: number;
  /** 多句时是否循环轮播；单句且 loop=false 则打完即停 */
  loop?: boolean;
  /** 随机打字速度区间；设置后覆盖 typingSpeed */
  variableSpeed?: { min: number; max: number };
  showCursor?: boolean;
  /** 打字 / 退格过程中隐藏光标 */
  hideCursorWhileTyping?: boolean;
  cursorCharacter?: string;
  /** 光标闪烁半周期（秒），对应 ReactBits 的 cursorBlinkDuration */
  cursorBlinkDuration?: number;
  /** 多句轮播时按序取色 */
  textColors?: string[];
  /** 倒着打（字符串反转后输入） */
  reverseMode?: boolean;
  /** 进入视口后才开始 */
  startOnVisible?: boolean;
  /** 一句退格完成时回调 */
  onSentenceComplete?: (text: string, index: number) => void;
  className?: string;
  cursorClassName?: string;
};

/**
 * ReactBits 风格 TextType：打字机效果（本地零依赖实现，用 CSS 关键帧替代 gsap 的光标 tween）。
 *
 * 与原版的行为对齐：支持多句轮播、退格、随机速度、多色、倒序、进入视口再开始。
 * 差异：根元素固定为 <span>（不暴露 `as`），以贴合本仓库其余文字动效组件的写法。
 */
export const TextType = ({
  text,
  typingSpeed = 50,
  initialDelay = 0,
  pauseDuration = 2000,
  deletingSpeed = 30,
  loop = true,
  variableSpeed,
  showCursor = true,
  hideCursorWhileTyping = false,
  cursorCharacter = '|',
  cursorBlinkDuration = 0.5,
  textColors = [],
  reverseMode = false,
  startOnVisible = false,
  onSentenceComplete,
  className,
  cursorClassName,
}: TextTypeProps) => {
  const list = useMemo(() => (Array.isArray(text) ? text : [text]), [text]);
  // 倒序模式在进入状态机前就把每句反转好，后续逻辑与正序完全一致
  const targets = useMemo(
    () => list.map(item => (reverseMode ? Array.from(item).reverse().join('') : item)),
    [list, reverseMode],
  );

  const [displayed, setDisplayed] = useState('');
  const [charIndex, setCharIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [textIndex, setTextIndex] = useState(0);
  const [visible, setVisible] = useState(!startOnVisible);

  const rootRef = useRef<HTMLSpanElement>(null);
  const startedRef = useRef(false);
  const completeRef = useRef(onSentenceComplete);

  useEffect(() => {
    completeRef.current = onSentenceComplete;
  }, [onSentenceComplete]);

  // startOnVisible：进入视口才开始打字
  useEffect(() => {
    if (!startOnVisible) {
      return undefined;
    }
    const el = rootRef.current;
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
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [startOnVisible]);

  const current = targets[textIndex] ?? '';
  // 用码点数组而不是下标切分，避免 emoji / 代理对被劈成半个字符
  const currentChars = useMemo(() => Array.from(current), [current]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const randomSpeed = () => {
      if (!variableSpeed) {
        return typingSpeed;
      }
      const { min, max } = variableSpeed;
      return Math.random() * (max - min) + min;
    };

    let timer: ReturnType<typeof setTimeout> | undefined;

    if (deleting) {
      if (displayed.length > 0) {
        timer = setTimeout(() => setDisplayed(prev => prev.slice(0, -1)), deletingSpeed);
      } else {
        // 退格清空后立刻切下一句开始输入：停顿只保留在「刚打完」那一步，
        // 否则光标会独自空闪 pauseDuration，观感很差
        completeRef.current?.(current, textIndex);
        setDeleting(false);
        setCharIndex(0);
        setTextIndex(prev => (prev + 1) % targets.length);
      }
      return () => clearTimeout(timer);
    }

    if (charIndex < currentChars.length) {
      const wait = randomSpeed() + (startedRef.current ? 0 : initialDelay);
      startedRef.current = true;
      timer = setTimeout(() => {
        setDisplayed(prev => prev + currentChars[charIndex]);
        setCharIndex(prev => prev + 1);
      }, wait);
      return () => clearTimeout(timer);
    }

    // 整句打完：需要继续才退格，否则就地停住
    if (!loop && textIndex === targets.length - 1) {
      return undefined;
    }
    timer = setTimeout(setDeleting, pauseDuration, true);
    return () => clearTimeout(timer);
  }, [
    visible,
    deleting,
    displayed,
    charIndex,
    textIndex,
    current,
    currentChars,
    targets,
    typingSpeed,
    deletingSpeed,
    pauseDuration,
    loop,
    initialDelay,
    variableSpeed,
  ]);

  const color = textColors.length > 0 ? textColors[textIndex % textColors.length] : undefined;
  const shouldHideCursor
    = hideCursorWhileTyping && (charIndex < currentChars.length || deleting);
  // 打字机的可见文本是逐字长出来的：屏幕阅读器读不到、SSR 首帧也是空的。
  // 这里额外输出一份完整原文（视觉隐藏），同时解决可访问名与 SEO。
  const srLabel = list.join('、');

  return (
    <span ref={rootRef} className={cn('text-type', className)}>
      <span className="sr-only">{srLabel}</span>
      <span aria-hidden style={{ color: color ?? 'inherit' }}>{displayed}</span>
      {showCursor && (
        <span
          aria-hidden
          className={cn(
            'text-type-cursor',
            cursorClassName,
            shouldHideCursor && 'text-type-cursor-hidden',
          )}
          // 半周期 ×2 = 一次完整亮灭
          style={{ animationDuration: `${Math.max(0.1, cursorBlinkDuration) * 2}s` }}
        >
          {cursorCharacter}
        </span>
      )}
    </span>
  );
};
