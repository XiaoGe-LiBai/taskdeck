import { cn } from '@/utils/Helpers';

/**
 * ReactBits 风格 StarBorder：边框上一圈流动的星光渐变，常用来包装按钮/卡片。
 * 纯 CSS，服务端组件可用。
 */
export const StarBorder = (props: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  /** 光效循环周期 s */
  speed?: number;
}) => (
  <div
    className={cn('star-border', props.className)}
    style={{ ['--star-speed' as string]: `${props.speed ?? 4}s` }}
  >
    <div className={cn('star-border-inner', props.innerClassName)}>
      {props.children}
    </div>
  </div>
);
