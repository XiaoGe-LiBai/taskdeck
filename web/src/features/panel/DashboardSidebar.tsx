'use client';

import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { FoldText, StrokeText } from '@/components/reactbits';
import { cn } from '@/utils/Helpers';
import { PanelNav } from './PanelNav';

type Props = {
  badges?: Record<string, number | string>;
  role?: string;
  /** 站点名称，来自后端 settings（由 dashboard/layout 以服务端方式取好传下来） */
  siteName: string;
  /** 自定义站点图标地址；空值 = 用内置鸭标 */
  logoUrl?: string;
};

const STORAGE_KEY = 'dashboard_sidebar_collapsed';

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }
  window.addEventListener('storage', callback);
  window.addEventListener('sidebar-toggle', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('sidebar-toggle', callback);
  };
}

function getSnapshot() {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function getServerSnapshot() {
  return false;
}

export const DashboardSidebar = ({ badges, role, siteName, logoUrl }: Props) => {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // 侧栏在 layout 里，路由切换不会重挂；拿路径当 key 才能让字标每次切页重播一次描边
  const pathname = usePathname();

  const toggle = () => {
    try {
      const next = !collapsed;
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      window.dispatchEvent(new Event('sidebar-toggle'));
    } catch {
      // ignore
    }
  };

  return (
    <aside
      className={cn(
        `
          hidden h-full min-h-0 shrink-0 flex-col border-r border-border/40
          bg-card transition-[width,padding] duration-300 ease-in-out
          lg:flex
        `,
        collapsed ? 'w-18 px-2 py-4' : 'w-64 px-3 py-4',
      )}
    >
      {/* 顶部 Logo 与切换按钮 */}
      <div
        className={cn(
          'mb-5 flex items-center',
          collapsed ? 'justify-center' : 'justify-between px-2',
        )}
      >
        <div className="flex items-center gap-2.5 overflow-hidden">
          <BrandMark
            size={36}
            logoUrl={logoUrl}
            className="
              shrink-0 shadow-sm transition-transform duration-300
              hover:scale-105
            "
          />
          {!collapsed && (
            <div className="min-w-0 transition-opacity duration-200">
              {/* 字标用 StrokeText：切换到任意页面都会重新"描"一遍 */}
              <div className="
                flex min-w-0 truncate text-sm font-semibold tracking-tight
                text-foreground
              "
              >
                <StrokeText
                  key={pathname}
                  text={siteName}
                  strokeColor="currentColor"
                  fillColor="currentColor"
                  strokeWidth={0.9}
                  fontSize={14}
                  letterSpacing={0.4}
                  drawDuration={1.2}
                />
              </div>
              {/* 副标题用 FoldText：字标管"描"、副标题管"折"。
                  这两处都在 layout 内，所以 4 种文字动效在控制台每一页都齐
                  （不依赖各页面是否用了共享 Card 组件）。 */}
              <div className="flex min-w-0 text-[10px] text-muted-foreground">
                <FoldText
                  key={pathname}
                  text="自动化管理中心"
                  splitBy="char"
                  hinge="top"
                  fontSize={10}
                  fontWeight={400}
                  color="inherit"
                  duration={0.42}
                  stagger={0.022}
                  creaseShading={0.2}
                  trigger="mount"
                />
              </div>
            </div>
          )}
        </div>

        {/* 展开状态下的右上角折叠按钮 */}
        {!collapsed && (
          <button
            type="button"
            onClick={toggle}
            aria-label="收起侧边栏"
            title="收起侧边栏"
            className="
              inline-flex size-7 items-center justify-center rounded-md border
              border-border/60 text-muted-foreground transition-all duration-150
              hover:bg-muted hover:text-foreground
              active:scale-90
            "
          >
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}
      </div>

      {/* 导航菜单容器，支持滚动 */}
      <div className="flex-1 overflow-x-hidden overflow-y-auto py-1">
        <PanelNav
          badges={badges}
          role={role}
          collapsed={collapsed}
        />
      </div>

      {/* 底部折叠切换与信息 */}
      <div
        className="
          mt-auto flex shrink-0 flex-col gap-2 border-t border-border/40 pt-3
        "
      >
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className={cn(
            `
              flex items-center rounded-md text-xs text-muted-foreground
              transition-all duration-150
              hover:bg-muted hover:text-foreground
              active:scale-95
            `,
            collapsed
              ? 'justify-center p-2'
              : 'justify-between px-2.5 py-1.5',
          )}
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <svg
              className={cn(
                'size-4 shrink-0 transition-transform duration-300',
                collapsed ? 'rotate-180' : '',
              )}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <path d="m14 9-3 3 3 3" />
            </svg>
            {!collapsed && <span>收起侧边栏</span>}
          </div>
          {!collapsed && (
            <kbd
              className="
                rounded-sm border bg-muted/50 px-1.5 py-0.5 font-mono
                text-[10px] text-muted-foreground
              "
            >
              收缩
            </kbd>
          )}
        </button>
      </div>
    </aside>
  );
};
