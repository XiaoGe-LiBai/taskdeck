'use client';

import { useEffect, useRef, useState } from 'react';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';

type DecryptedTextProps = {
  text: string;
  /** 每个字符解开间隔 ms */
  speed?: number;
  /** 进入视口才触发 */
  animateOn?: 'view' | 'load';
  className?: string;
};

/**
 * ReactBits 风格 DecryptedText：字符从乱码逐个「解密」成原文。
 */
export const DecryptedText = ({
  text,
  speed = 30,
  animateOn = 'view',
  className,
}: DecryptedTextProps) => {
  const [display, setDisplay] = useState(text);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const start = () => {
      if (started.current) {
        return;
      }
      started.current = true;
      let revealed = 0;
      const timer = setInterval(() => {
        revealed += 1;
        if (revealed >= text.length) {
          setDisplay(text);
          clearInterval(timer);
          return;
        }
        setDisplay(
          text.slice(0, revealed)
          + text
            .slice(revealed)
            .split('')
            .map(c => (c === ' ' ? ' ' : CHARS[Math.floor(Math.random() * CHARS.length)]))
            .join(''),
        );
      }, speed);
    };

    if (animateOn === 'load') {
      start();
      return;
    }
    const el = ref.current;
    if (!el) {
      return;
    }
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => e.isIntersecting && start()),
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, speed, animateOn]);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
};
