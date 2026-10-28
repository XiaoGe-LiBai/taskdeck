import { cn } from '@/utils/Helpers';

/**
 * ReactBits 风格 GridBeams 背景：网格线 + 沿轨道穿梭的光束。
 * 纯 CSS，服务端组件可用；放 relative 容器里当底纹。
 */
export const GridBeams = (props: { className?: string }) => (
  <div aria-hidden className={cn('grid-beams', props.className)}>
    <span className="grid-beam grid-beam-h" />
    <span className="grid-beam grid-beam-h grid-beam-h-2" />
    <span className="grid-beam grid-beam-v" />
  </div>
);
