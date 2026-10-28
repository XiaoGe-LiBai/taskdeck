'use client';

import { usePathname } from 'next/navigation';

/**
 * 后台页面切换过渡：路由变化时整棵子树以新 key 重挂。
 *
 * 这里挂的是 `section-enter` 而不是整页一次性的 `page-enter`：
 * 由「整个页面一起淡入」升级为「页面内每个区块依次淡入」，
 * 而且因为挂在 layout 这一层，任何新页面都自动获得该动效，
 * 不需要（也不可能）逐页补丁。
 *
 * 子组件内部若再挂 `section-enter`（如各 Manager 组件），
 * 会形成两级连续错峰，视觉上是一整条更长的「渐渐出现」瀑布。
 */
export const PageTransition = (props: { children: React.ReactNode }) => {
  const pathname = usePathname();
  return (
    // relative + z-10：让页面内容稳定压在背景层（DotGrid / SwarmCursor 的 fixed z-0）之上。
    // 不加的话，未定位/未 transform 的卡片会掉到 fixed 背景层**下面**，粒子就会盖住正文。
    <div key={pathname} className="relative z-10 section-enter">
      {props.children}
    </div>
  );
};
