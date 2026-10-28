import { cn } from '@/utils/Helpers';

/**
 * ReactBits 风格 GradientText：品牌渐变文字，渐变色缓慢流动。
 * 纯 CSS，服务端组件可用。
 */
export const GradientText = (props: {
  children: React.ReactNode;
  className?: string;
  /** 流动周期 s */
  speed?: number;
}) => (
  <span
    className={cn('gradient-text', props.className)}
    style={{ animationDuration: `${props.speed ?? 6}s` }}
  >
    {props.children}
  </span>
);
