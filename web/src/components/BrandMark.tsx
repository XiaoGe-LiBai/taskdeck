'use client';

import { useId } from 'react';
import { cn } from '@/utils/Helpers';

/**
 * 「托管鸭」内置品牌标：品牌渐变圆角方块 + 白色鸭头剪影。
 *
 * 渐变交给 CSS（`bg-brand-gradient`），鸭形走内联 SVG —— 这样颜色永远跟随
 * global.css 的 --brand-* 变量，不用在组件里重复一份色值。
 *
 * 眼睛是**挖空**（mask）而不是画一个圆点：底色是渐变，纯色圆点对不上，
 * 挖空能自然露出任何底色。mask 的 id 用 useId 生成，否则同页多个实例
 * 会共用同一个 id（HTML 里重复 id）。
 *
 * 下面的坐标与 scripts/make-brand-icons.py **同源**（favicon 是 PIL 按同一组
 * 数字画的），改形时两边要一起改。
 */
const DuckMark = (props: { size: number; className?: string }) => {
  const maskId = useId();

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-brand-gradient',
        props.className,
      )}
      style={{
        width: props.size,
        height: props.size,
        // 与 favicon 一致的 22% 圆角（1024 基准下 CORNER_RADIUS=226）
        borderRadius: '22%',
      }}
    >
      <svg viewBox="0 0 1024 1024" className="size-full" role="presentation">
        <defs>
          {/* 白底 + 黑色眼洞：套在鸭形上就是「眼睛镂空」 */}
          <mask id={maskId}>
            <rect x="0" y="0" width="1024" height="1024" fill="#fff" />
            <circle cx="392" cy="384" r="56" fill="#000" />
          </mask>
        </defs>
        <g mask={`url(#${maskId})`}>
          {/* 头 */}
          <circle cx="356" cy="505" r="250" fill="#fff" />
          {/* 喙（左端伸进头内，与头连成一体） */}
          <rect x="500" y="470" width="406" height="176" rx="88" fill="#fff" />
        </g>
      </svg>
    </span>
  );
};

/**
 * 站点标志。管理员在「系统设置 → 站点与注册 → 站点图标」里传了自己的图就用图，
 * 否则回落到内置的托管鸭标。
 *
 * `logoUrl` 由服务端从后端 `/site-info` 取好再传下来（见各页面的 getSiteInfo），
 * 后端只有在「开关打开 + 确实传过图」时才会给地址。
 *
 * 自定义图用 `object-contain` 而不是 `cover`：管理员的 logo 常是横向文字标，
 * cover 会把它裁掉；宁可四周留白也要完整显示。
 */
export const BrandMark = (props: {
  /** 外框边长（px），默认 36 */
  size?: number;
  className?: string;
  /** 自定义图标地址；空值 = 用内置鸭标 */
  logoUrl?: string | null;
}) => {
  const size = props.size ?? 36;

  if (!props.logoUrl) {
    return <DuckMark size={size} className={props.className} />;
  }

  return (
    <span
      className={cn(
        `
          inline-flex shrink-0 items-center justify-center overflow-hidden
          bg-card ring-1 ring-border
        `,
        props.className,
      )}
      style={{ width: size, height: size, borderRadius: '22%' }}
    >
      {/* alt 留空：旁边一定有站名文字，重复念一遍反而啰嗦。
          刻意不用 next/image：这图来自后端动态接口（/site-icon），走 Image 还得配
          remotePatterns + 自定义 loader 才认，而它最长边只有 256px，
          优化收益基本为零、只剩复杂度。 */}
      {/* eslint-disable-next-line next/no-img-element -- 动态接口 + 256px 小图，见上 */}
      <img
        src={props.logoUrl}
        alt=""
        className="size-full object-contain"
        loading="eager"
        decoding="async"
      />
    </span>
  );
};
