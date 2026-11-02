'use client';

import { useEffect, useState } from 'react';

const STORE_KEY = 'xc_theme';

type Theme = 'light' | 'dark' | 'system';

const ORDER: Theme[] = ['light', 'dark', 'system'];

const LABEL: Record<Theme, string> = {
  light: '浅色',
  dark: '深色',
  system: '跟随系统',
};

const ICON: Record<Theme, string> = {
  light: '☀️',
  dark: '🌙',
  system: '🖥️',
};

const isDark = (theme: Theme) =>
  theme === 'dark'
  || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

/**
 * 主题切换：浅色 → 深色 → 跟随系统（点一下切一档）。
 *
 * 真正的首屏着色由 `app/layout.tsx` 里的内联脚本完成（避免刷新时白屏闪一下），
 * 这里只负责用户点击与系统配色变化。
 */
export const ThemeToggle = () => {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const stored = localStorage.getItem(STORE_KEY) as Theme | null;
    if (stored && ORDER.includes(stored)) {
      setTheme(stored);
    }
  }, []);

  // 跟随系统时，系统切换深/浅要实时跟
  useEffect(() => {
    if (theme !== 'system') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (event: MediaQueryListEvent | MediaQueryList) => {
      document.documentElement.classList.toggle('dark', event.matches);
    };
    apply(media);
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? 'system';
    localStorage.setItem(STORE_KEY, next);
    document.documentElement.classList.toggle('dark', isDark(next));
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      title={`当前：${LABEL[theme]}（点击切换）`}
      aria-label={`主题：${LABEL[theme]}`}
      className="
        inline-flex size-8 items-center justify-center rounded-md border text-sm
        transition-colors
        hover:bg-muted
      "
    >
      <span aria-hidden>{ICON[theme]}</span>
    </button>
  );
};
