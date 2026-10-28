'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/utils/Helpers';
import { visibleGroups } from './navConfig';

const paths: Record<string, string> = {
  // 概览
  'dashboard': 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  'checkin': 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01',

  // 账号
  'accounts': 'M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m7-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M3 20c0-3.3 2.5-5.5 5.5-5.5S14 16.7 14 20m1-5.2c2.6.3 4.2 2.2 4.2 5.2',

  // 业务
  'xiaocan': 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2zM9 9h.01M15 9h.01M9 15h.01M15 15h.01',
  'yyb': 'M4 4h16v5H4zM4 15h16v5H4zM9 6.5h6M9 17.5h6',
  'market': 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09zM12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z',
  'profile': 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM16 3.13a4 4 0 0 1 0 7.75',

  // 其他
  'login-logs': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zm0-14v4l3 3',
  'history': 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  'notifications': 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9zm-4.27 13a2 2 0 0 1-3.46 0',

  // 平台管理
  'projects': 'M4 6h16v4H4zM4 14h16v4H4zM8 8h.01M8 16h.01',
  'panels': 'M4 6h16M4 12h16M4 18h10M18 16l2 2-2 2',
  'users': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 20c0-3.6 3.1-6 8-6s8 2.4 8 6',
  'cards': 'M3 8.5A2.5 2.5 0 0 1 5.5 6h13A2.5 2.5 0 0 1 21 8.5v7A2.5 2.5 0 0 1 18.5 18h-13A2.5 2.5 0 0 1 3 15.5zM3 10h18M7 14h4',
  'logs': 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6',
  'announcements': 'M4 10v4h3l5 4V6L7 10zM16 8a5 5 0 0 1 0 8M18.5 5.5a8.5 8.5 0 0 1 0 13',
  'settings': 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M12 3v2m0 14v2M4.2 7l1.7 1M18.1 16l1.7 1M4.2 17l1.7-1M18.1 8l1.7-1',
};

const Icon = (props: { name: string }) => (
  <svg
    viewBox="0 0 24 24"
    className="size-4.5 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={paths[props.name] ?? paths.settings} />
  </svg>
);

export const PanelNav = (props: {
  badges?: Record<string, number | string>;
  role?: string;
  /** 点击任意导航项后的回调（移动端抽屉用来收起面板） */
  onNavigate?: () => void;
  /** 是否处于紧凑收缩模式 */
  collapsed?: boolean;
}) => {
  const pathname = usePathname();
  const role = props.role ?? 'user';
  const groups = visibleGroups(role);
  const isCollapsed = Boolean(props.collapsed);

  // 展开所有可匹配的项并找出命中项，严格避免 /dashboard 污染其他子页面
  const cleanPath = pathname || '/';
  const allItems = groups.flatMap(group => group.items);
  let activeKey = '';

  // 1. 先尝试子页面精确或别名前缀匹配（排除 /dashboard 根项）
  for (const item of allItems) {
    if (item.href === '/dashboard') {
      continue;
    }
    const matchesHref = cleanPath === item.href || cleanPath.startsWith(`${item.href}/`);
    const matchesAlias = item.aliases?.some(
      alias => cleanPath === alias || cleanPath.startsWith(`${alias}/`),
    );
    if (matchesHref || matchesAlias) {
      activeKey = item.key;
      break;
    }
  }

  // 2. 如果没有任何子项命中，且当前正好在 /dashboard，则高亮控制台
  if (!activeKey && (cleanPath === '/dashboard' || cleanPath === '')) {
    activeKey = 'dashboard';
  }

  return (
    <nav className={cn('flex flex-col', isCollapsed ? 'gap-3' : 'gap-5')}>
      {groups.map((group, groupIdx) => (
        <div
          key={group.label}
          title={group.label}
          className="flex flex-col gap-1"
        >
          {isCollapsed
            ? (
                groupIdx > 0 && (
                  <div className="mx-auto my-1.5 h-px w-6 bg-border/60" />
                )
              )
            : (
                <div className="flex items-center gap-1.5 px-3 pt-1 select-none">
                  <span className="
                    text-[13px] transition-transform duration-200
                    hover:scale-125
                  "
                  >
                    {group.icon || '📁'}
                  </span>
                  <span
                    className="
                      text-[11px] font-semibold tracking-wide
                      text-muted-foreground uppercase
                    "
                  >
                    {group.label}
                  </span>
                </div>
              )}

          {group.items.map((item) => {
            const isActive = activeKey === item.key;
            const badge = props.badges?.[item.key];

            return (
              <div key={item.key} className="group relative">
                <Link
                  href={item.href}
                  onClick={props.onNavigate}
                  className={cn(
                    `
                      relative flex items-center rounded-md font-medium
                      transition-all duration-200 ease-out outline-none
                      focus-visible:ring-2 focus-visible:ring-primary/40
                      active:scale-[0.96]
                    `,
                    isCollapsed
                      ? `
                        justify-center p-2.5 text-sm
                        hover:scale-105
                      `
                      : `
                        gap-3 px-3 py-2 text-sm
                        hover:translate-x-1
                      `,
                    isActive
                      ? `
                        bg-brand-gradient font-semibold text-white shadow-md
                        shadow-orange-500/20
                      `
                      : `
                        hover:bg-brand-soft/80
                        text-muted-foreground
                        hover:text-foreground
                      `,
                  )}
                >
                  {/* 激活状态左侧流光指示条 */}
                  {isActive && !isCollapsed && (
                    <span
                      className="
                        absolute inset-y-1.5 left-0 w-1 rounded-r-full
                        bg-white/90 shadow-[0_0_8px_rgba(255,255,255,0.9)]
                      "
                    />
                  )}

                  <span className={cn(
                    `
                      flex shrink-0 items-center justify-center
                      transition-transform duration-200
                    `,
                    `
                      group-hover:scale-110
                      group-active:scale-95
                    `,
                    isActive && 'scale-105 drop-shadow-sm',
                  )}
                  >
                    <Icon name={item.key} />
                  </span>

                  {!isCollapsed && (
                    <span className="
                      flex-1 truncate transition-colors duration-150
                    "
                    >
                      {item.label}
                    </span>
                  )}

                  {!isCollapsed && badge !== undefined && (
                    <span
                      className={cn(
                        `
                          rounded-full px-1.5 py-0.5 text-[11px] tabular-nums
                          transition-all duration-200
                        `,
                        isActive
                          ? 'bg-white/25 text-white shadow-xs'
                          : `
                            bg-muted text-muted-foreground
                            group-hover:bg-primary/10 group-hover:text-primary
                          `,
                      )}
                    >
                      {badge}
                    </span>
                  )}

                  {isCollapsed && badge !== undefined && (
                    <span
                      className={cn(
                        `
                          absolute top-1.5 right-1.5 size-2 rounded-full
                          transition-transform duration-200
                        `,
                        'group-hover:scale-125',
                        isActive ? 'bg-white' : 'bg-primary ring-2 ring-card',
                      )}
                    />
                  )}
                </Link>

                {/* 紧凑收缩模式下的浮动 Tooltip */}
                {isCollapsed && (
                  <div
                    className="
                      pointer-events-none absolute top-1/2 left-full z-50 ml-3
                      flex -translate-y-1/2 items-center gap-1.5 rounded-md
                      border border-border bg-popover px-2.5 py-1 text-xs
                      font-medium whitespace-nowrap text-popover-foreground
                      opacity-0 shadow-md transition-all duration-150
                      group-hover:translate-x-0 group-hover:opacity-100
                    "
                  >
                    <span>{item.label}</span>
                    {badge !== undefined && (
                      <span className="
                        rounded-full bg-muted px-1.5 py-0.5 text-[10px]
                        text-muted-foreground tabular-nums
                      "
                      >
                        {badge}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
};
