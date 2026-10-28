'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { PanelNav } from './PanelNav';

/**
 * 移动端导航：汉堡按钮 + 左侧抽屉（off-canvas）。
 *
 * 桌面端（lg 及以上）由 layout 中的固定侧栏承担导航，本组件整体隐藏。
 * 抽屉开合有滑入/淡出过渡；路由变化（点完导航跳转）自动收起。
 */
export const MobileNav = (props: {
  role?: string;
  badges?: Record<string, number | string>;
  /** 站点名称，来自后端 settings（由 dashboard/layout 以服务端方式取好传下来） */
  siteName: string;
  /** 自定义站点图标地址；空值 = 用内置鸭标 */
  logoUrl?: string;
}) => {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // 路由变化自动收起抽屉（点了导航项跳转后不应还盖着遮罩）
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="打开导航菜单"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className="
          inline-flex size-9 shrink-0 items-center justify-center rounded-md
          border bg-card text-base transition-all duration-150
          hover:bg-muted
          active:scale-90
          lg:hidden
        "
      >
        {open ? '✕' : '☰'}
      </button>

      {open && (
        <div
          className="
            fixed inset-0 z-50 mobile-drawer-overlay
            lg:hidden
          "
          role="dialog"
          aria-modal="true"
          aria-label="导航菜单"
        >
          <button
            type="button"
            aria-label="关闭导航菜单"
            onClick={() => setOpen(false)}
            className="absolute inset-0 size-full cursor-default bg-black/40"
          />

          <div className="
            absolute top-0 left-0 flex h-full w-72 max-w-[85vw] mobile-drawer
            flex-col overflow-hidden bg-card shadow-2xl
          "
          >
            <div className="
              flex items-center justify-between border-b px-4 py-3
            "
            >
              <div className="flex min-w-0 items-center gap-2">
                <BrandMark
                  size={32}
                  logoUrl={props.logoUrl}
                  className="shrink-0 shadow-sm"
                />
                <div className="min-w-0 leading-tight">
                  <div className="truncate text-sm font-semibold">{props.siteName}</div>
                </div>
              </div>
              <button
                type="button"
                aria-label="关闭导航菜单"
                onClick={() => setOpen(false)}
                className="
                  inline-flex size-8 items-center justify-center rounded-md
                  text-muted-foreground
                  hover:bg-muted
                "
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-4">
              <PanelNav
                role={props.role}
                badges={props.badges}
                onNavigate={() => setOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};
