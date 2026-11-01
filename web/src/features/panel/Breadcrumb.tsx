'use client';

import { usePathname } from 'next/navigation';
import { NAV_GROUPS } from './navConfig';

/**
 * 顶栏面包屑：按当前路径反查「分组 / 项名」。
 *
 * 桌面端 header 左边原本几乎空着（移动端品牌和汉堡按钮都是 lg 以下才显示），
 * 这里补上当前位置，切页时一眼知道自己在哪。
 */
export const Breadcrumb = () => {
  const pathname = usePathname();
  const isRoot = pathname === '/dashboard';
  let current: { group: string; label: string } | null = null;

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      // /dashboard 是根项，不参与子路径前缀匹配，否则会抢掉 /dashboard/* 的所有页面
      if (item.href === '/dashboard' && !isRoot) {
        continue;
      }
      const hitHref = pathname === item.href || pathname.startsWith(`${item.href}/`);
      const hitAlias = item.aliases?.some(
        alias => pathname === alias || pathname.startsWith(`${alias}/`),
      );
      if (hitHref || hitAlias) {
        current = { group: group.label, label: item.label };
        break;
      }
    }
    if (current) {
      break;
    }
  }

  if (!current) {
    return null;
  }

  return (
    <nav
      aria-label="面包屑"
      className="
        hidden items-center gap-1.5 text-sm
        lg:flex
      "
    >
      <span className="text-muted-foreground">{current.group}</span>
      <span className="text-muted-foreground/40">/</span>
      <span className="font-medium text-foreground">{current.label}</span>
    </nav>
  );
};
