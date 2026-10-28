import { cn } from '@/utils/Helpers';

/**
 * ReactBits 风格 ShinyText：文字表面扫过一道高光（品牌渐变色）。
 * 纯 CSS，可在服务端组件里用。
 * baseColor 默认站点前景色；白底按钮上传 "#fff"。
 */
export const ShinyText = (props: {
  text: string;
  className?: string;
  /** 高光循环周期 s */
  speed?: number;
  /** 文字基色，默认 var(--foreground) */
  baseColor?: string;
}) => (
  <span
    className={cn('shiny-text', props.className)}
    style={{
      animationDuration: `${props.speed ?? 3}s`,
      ['--shiny-base' as string]: props.baseColor ?? 'var(--foreground)',
    }}
  >
    {props.text}
  </span>
);
