import { cn } from '@/utils/Helpers';

/**
 * ReactBits 风格 Aurora 背景：纯 CSS 渐变光斑缓慢漂移，零依赖。
 * 颜色自动跟随 global.css 里的品牌渐变变量（--brand-from/via/to）。
 *
 * 用法：在 relative 容器里放 <Aurora />，内容用 relative z-10 盖在上面。
 */
export const Aurora = (props: { className?: string }) => (
  <div
    aria-hidden
    className={cn(
      'floating-lines',
      props.className,
    )}
  >
    <div className="aurora-blob aurora-blob-1" />
    <div className="aurora-blob aurora-blob-2" />
    <div className="aurora-blob aurora-blob-3" />
  </div>
);
