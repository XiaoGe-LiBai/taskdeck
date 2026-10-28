'use client';

import { useSearchParams } from 'next/navigation';

/**
 * 「无权访问」提示条。
 *
 * 中间件（src/proxy.ts）把普通用户访问管理端路由重定向回 /dashboard?denied=1，
 * 这里读取该参数给出明确说明 —— 否则用户只会看到「莫名其妙回到了控制台」。
 */
export const DeniedNotice = () => {
  const denied = useSearchParams().get('denied');
  if (denied !== '1') {
    return null;
  }

  return (
    <div className="
      relative mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4
      py-3 text-sm text-rose-600
      dark:text-rose-400
    "
    >
      🔒 该页面仅管理员可访问，已为您返回控制台。如需权限请联系平台管理员。
    </div>
  );
};
