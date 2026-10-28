import { cn } from '@/utils/Helpers';

const VARIANTS = [
  'floating-line floating-line-1',
  'floating-line floating-line-2',
  'floating-line floating-line-3',
  'floating-line floating-line-4',
  'floating-line floating-line-5',
];

/**
 * ReactBits 风格 FloatingLines 背景：几条品牌色细线缓慢上下浮动。
 * 纯 CSS，比 Aurora 更「轻」，适合表单/列表页做底纹。
 */
export const FloatingLines = (props: {
  className?: string;
  /** 线条数量 2~5 */
  lines?: number;
}) => {
  const count = Math.max(2, Math.min(5, props.lines ?? 3));
  return (
    <div aria-hidden className={cn('floating-lines', props.className)}>
      {Array.from({ length: count }, (_, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <span key={i} className={VARIANTS[i]} />
      ))}
    </div>
  );
};
