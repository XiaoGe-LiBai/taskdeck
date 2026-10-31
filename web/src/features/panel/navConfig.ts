/**
 * 侧栏导航与权限声明（**唯一事实来源**）。
 *
 * 这里只放纯数据，不带 'use client'：
 *   - PanelNav（客户端组件）按它渲染侧栏；
 *   - proxy.ts（middleware）按它拦截普通用户访问管理端 URL。
 *
 * 为什么单独抽出来：过去「哪些页面是管理端」只写在侧栏里，结果出现
 * 「侧栏藏了入口，但直接敲 URL 照样能进」的缺口（页面本身没有守卫）。
 * 现在只要在下面的分组里声明一次，侧栏与路由守卫同时生效 —— 新增管理页
 * 不会再漏。
 */

export type NavItem = {
  key: string;
  href: string;
  label: string;
  /** 老路径别名，仅用于侧栏高亮（不参与权限判断） */
  aliases?: string[];
  /** 普通用户可访问 */
  userOk?: boolean;
};

export type NavGroup = {
  label: string;
  icon?: string;
  /** 整组仅管理员可见/可访问 */
  adminOnly?: boolean;
  items: NavItem[];
};

/**
 * 侧边栏分组：遵从参考站布局层级（概览、账号、业务、其他），管理员底部增补平台管理。
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: '概览',
    icon: '📊',
    items: [
      { key: 'dashboard', href: '/dashboard', label: '控制台', userOk: true },
      { key: 'checkin', href: '/dashboard/checkin', label: '每日签到', userOk: true },
    ],
  },
  {
    label: '账号',
    icon: '👥',
    items: [
      { key: 'accounts', href: '/dashboard/accounts', label: '账号管理', userOk: true },
    ],
  },
  {
    label: '业务',
    icon: '💼',
    items: [
      { key: 'xiaocan', href: '/dashboard/xiaocan', label: '小蚕', userOk: true },
      { key: 'stores', href: '/dashboard/stores', label: '附近霸王餐', userOk: true },
      { key: 'yyb', href: '/dashboard/yyb', label: '应用宝', userOk: true },
      { key: 'market', href: '/dashboard/market', label: '项目市场', aliases: ['/dashboard/submit'], userOk: true },
      { key: 'profile', href: '/dashboard/profile', label: '会员中心', userOk: true },
    ],
  },
  {
    label: '其他',
    icon: '⚙️',
    items: [
      { key: 'history', href: '/dashboard/history', label: '报名/抢兑记录', userOk: true },
      { key: 'login-logs', href: '/dashboard/login-logs', label: '登陆记录', userOk: true },
      { key: 'notifications', href: '/dashboard/notifications', label: '消息推送', userOk: true },
    ],
  },
  {
    label: '平台管理',
    icon: '🛡️',
    adminOnly: true,
    items: [
      { key: 'projects', href: '/dashboard/projects', label: '项目管理' },
      { key: 'panels', href: '/dashboard/panels', label: '青龙面板' },
      { key: 'users', href: '/dashboard/users', label: '用户管理' },
      { key: 'cards', href: '/dashboard/cards', label: '卡密管理' },
      { key: 'logs', href: '/dashboard/logs', label: '任务日志' },
      { key: 'announcements', href: '/dashboard/announcements', label: '公告管理' },
      { key: 'settings', href: '/dashboard/settings', label: '系统设置' },
    ],
  },
];

/** 按角色筛掉管理项；普通用户只展示四大分组 */
export function visibleGroups(role: string): NavGroup[] {
  const isAdmin = role === 'admin';
  return NAV_GROUPS
    .filter(group => isAdmin || !group.adminOnly)
    .map(group => ({
      ...group,
      items: group.items.filter(item => isAdmin || item.userOk),
    }))
    .filter(group => group.items.length > 0);
}

/**
 * 管理端专属路径前缀（普通用户禁止访问）。
 *
 * 来源一：侧栏里标了 adminOnly 的整组；
 * 来源二：不在侧栏出现、但属于管理端能力的管理子页（如应用宝的绑定矩阵/服务设置）。
 */
export const ADMIN_ONLY_PREFIXES: string[] = [
  ...NAV_GROUPS.filter(group => group.adminOnly).flatMap(group => group.items.map(item => item.href)),
  '/dashboard/yyb/bindings',
  '/dashboard/yyb/settings',
];

/** 路径是否落在管理端前缀里（精确匹配或子路径匹配） */
export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some(
    prefix => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
