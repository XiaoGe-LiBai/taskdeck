import { cn } from '@/utils/Helpers';

/**
 * ReactBits 风格 DotGrid 背景：均匀圆点阵 + 中心径向渐隐。
 * 纯 CSS，服务端组件可用；放 relative 容器里当底纹。
 */
export const DotGrid = (props: {
  className?: string;
  /** 点间距 px */
  gap?: number;
  /** 点大小 px */
  dotSize?: number;
}) => (
  <div
    aria-hidden
    className={cn('dot-grid', props.className)}
    style={{
      ['--dot-gap' as string]: `${props.gap ?? 26}px`,
      ['--dot-size' as string]: `${props.dotSize ?? 1.5}px`,
    }}
  />
);
