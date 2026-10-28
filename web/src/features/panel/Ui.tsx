/** 面板公共 UI 积木：卡片、指标卡、表格、状态徽章（全部基于模板的 shadcn token）。 */
import { Children, cloneElement, isValidElement } from 'react';
import { CountUp, FoldText, GradientText, SplitText, SpotlightCard, StrokeText, TextType } from '@/components/reactbits';
import { cn } from '@/utils/Helpers';

/**
 * 「数字 + 单位」的统计值：数字部分带滚动动效，单位跟在后面。
 *
 * 给 StatCard 用。例如 `<CountValue value={5} suffix="个" />` 会先滚出 5、后面跟着「个」。
 * 直接写 `value={`${n} 个`}` 是死字符串，动效加不上 —— 所以统一走这里。
 */
export const CountValue = (props: {
  value: number;
  suffix?: string;
  duration?: number;
}) => (
  <>
    <CountUp to={props.value} duration={props.duration ?? 800} immediate />
    {props.suffix ? ` ${props.suffix}` : null}
  </>
);

export const Card = (props: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) => (
  <SpotlightCard
    className={cn('rounded-lg border bg-card brand-shadow', props.className)}
  >
    <section className="p-5">
      {(props.title || props.actions) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {props.title && (
              <div className="flex items-center gap-2 font-semibold">
                <span className="
                  inline-block h-3.5 w-1 rounded-full bg-brand-gradient
                "
                />
                {/* 区块标题用折页翻入；title 可能是 ReactNode，只有纯字符串才切分 */}
                {typeof props.title === 'string'
                  ? (
                      <FoldText
                        text={props.title}
                        splitBy="char"
                        hinge="top"
                        fontSize="inherit"
                        fontWeight="inherit"
                        color="inherit"
                        duration={0.5}
                        stagger={0.028}
                        creaseShading={0.28}
                        trigger="mount"
                      />
                    )
                  : props.title}
              </div>
            )}
            {props.description && (
              <div className="mt-0.5 text-xs text-muted-foreground">{props.description}</div>
            )}
          </div>
          {props.actions}
        </div>
      )}
      {props.children}
    </section>
  </SpotlightCard>
);

export const StatCard = (props: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  plain?: boolean;
}) => (
  <SpotlightCard className="
    brand-topline rounded-lg border bg-card p-4 brand-shadow transition-all
    hover:scale-[1.01]
  "
  >
    <div className="flex items-center justify-between">
      <div className="text-xs font-medium text-muted-foreground">{props.label}</div>
      <span className="text-lg">{props.icon}</span>
    </div>
    <div
      className={cn('mt-2 text-2xl font-semibold tabular-nums', !props.plain && `
        text-brand-gradient
      `)}
    >
      {/* value 是纯数字时自动加滚动动效；字符串/节点（带单位、状态文案）由调用方决定。
          用 immediate：统计卡要挂载就滚，不能停在 0 等视口观察器。 */}
      {typeof props.value === 'number'
        ? <CountUp to={props.value} duration={800} immediate />
        : props.value}
    </div>
    {props.hint && <div className="mt-1 text-xs text-muted-foreground">{props.hint}</div>}
  </SpotlightCard>
);

const statusTone: Record<string, string> = {
  success: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  danger: 'bg-red-500/10 text-red-600 border-red-500/20',
  warning: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  info: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  gray: 'bg-muted text-muted-foreground border-border',
};

export const Tag = (props: { tone?: keyof typeof statusTone; children: React.ReactNode }) => (
  <span
    className={cn(
      `
        inline-flex items-center rounded-full border px-2 py-0.5 text-xs
        font-medium whitespace-nowrap
      `,
      statusTone[props.tone ?? 'gray'],
    )}
  >
    {props.children}
  </span>
);

/**
 * 小屏卡片化：把表头文字注入每个单元格的 data-label，
 * 由 global.css 中的 .rtable 规则在移动端渲染成「字段名 + 值」的卡片。
 */
const withRowLabels = (head: React.ReactNode[], children: React.ReactNode) =>
  Children.toArray(children).map((row) => {
    if (!isValidElement(row)) {
      return row;
    }
    const rowElement = row as React.ReactElement<{ children?: React.ReactNode }>;
    const cells = Children.toArray(rowElement.props.children).map((cell, index) => {
      if (!isValidElement(cell)) {
        return cell;
      }
      const label = head[index];
      const text = typeof label === 'string' || typeof label === 'number' ? String(label) : '';
      return cloneElement(cell as React.ReactElement<{ 'data-label'?: string }>, {
        'data-label': text,
      });
    });
    return cloneElement(rowElement, {}, cells);
  });

export const Table = (props: { head: React.ReactNode[]; children: React.ReactNode }) => (
  <div className="rtable-wrap w-full overflow-x-auto">
    <table className="rtable w-full border-collapse text-sm">
      <thead>
        <tr className="
          border-b bg-brand-soft text-left text-xs text-muted-foreground
        "
        >
          {props.head.map((cell, index) => (
            <th key={index} className="px-3 py-2 font-medium whitespace-nowrap">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y">{withRowLabels(props.head, props.children)}</tbody>
    </table>
  </div>
);

export const Td = (props: {
  'children'?: React.ReactNode;
  'className'?: string;
  'data-label'?: string;
  /** 整行展开的编辑区要跨列（移动端卡片化下会被忽略，不影响） */
  'colSpan'?: number;
}) => (
  <td
    data-label={props['data-label']}
    colSpan={props.colSpan}
    className={cn('px-3 py-2.5 align-top', props.className)}
  >
    {props.children}
  </td>
);

export const Empty = (props: { text?: string }) => (
  <div className="py-10 text-center text-sm text-muted-foreground">{props.text ?? '暂无数据'}</div>
);

export const PageTitle = (props: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /**
   * 标题动效：
   *  - type（默认）打字机 + 品牌渐变。渐变靠 `background-clip:text` 实现，
   *    实测该机制**不受子元素 opacity/transform 影响**，所以只能用「增字型」动效（TextType），
   *    不能用 SplitText / FoldText 这类改透明度位移的方案。
   *  - stroke 描边绘制（独立 SVG，不吃父级渐变）—— 适合门户页换一点仪式感。
   */
  titleEffect?: 'type' | 'stroke';
}) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="flex items-center gap-3 text-2xl font-semibold">
        <span className="inline-block h-6 w-1.5 rounded-full bg-brand-gradient" />
        {props.titleEffect === 'stroke'
          ? (
              <StrokeText
                text={props.title}
                strokeColor="currentColor"
                fillColor="currentColor"
                strokeWidth={1.5}
                fontSize={30}
                letterSpacing={1}
                drawDuration={1.1}
                className="text-primary"
              />
            )
          : (
              <GradientText>
                <TextType
                  text={props.title}
                  loop={false}
                  showCursor={false}
                  // 标题很短（2~7 字），打字速度太快就完全看不出在"打"——放慢到肉眼可辨
                  typingSpeed={110}
                  initialDelay={150}
                />
              </GradientText>
            )}
      </h1>
      {props.description && (
        <p className="mt-1 text-sm text-muted-foreground">
          {/* 描述是纯色小字，不受渐变约束，可以逐字上浮 */}
          <SplitText text={props.description} delay={22} duration={0.45} shift={0.7} />
        </p>
      )}
    </div>
    {props.actions}
  </div>
);

export const Field = (props: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <label className="flex flex-col gap-1.5">
    <span className="text-sm font-medium">{props.label}</span>
    {props.children}
    {props.hint && <span className="text-xs text-muted-foreground">{props.hint}</span>}
  </label>
);

/** 分页条 */
export const Pager = (props: {
  page: number;
  size: number;
  total: number;
  basePath: string;
  query?: Record<string, string | undefined>;
}) => {
  const pages = Math.max(1, Math.ceil(props.total / props.size));
  const link = (target: number) => {
    const params = new URLSearchParams();
    Object.entries(props.query ?? {}).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      }
    });
    params.set('page', String(target));
    return `${props.basePath}?${params.toString()}`;
  };

  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        共
        {' '}
        {props.total}
        {' '}
        条 · 第
        {' '}
        {props.page}
        {' '}
        /
        {' '}
        {pages}
        {' '}
        页
      </span>
      <div className="flex gap-2">
        <a
          href={link(Math.max(1, props.page - 1))}
          className={cn(
            'rounded-md border px-3 py-1.5',
            props.page <= 1 && 'pointer-events-none opacity-50',
          )}
        >
          上一页
        </a>
        <a
          href={link(Math.min(pages, props.page + 1))}
          className={cn(
            'rounded-md border px-3 py-1.5',
            props.page >= pages && 'pointer-events-none opacity-50',
          )}
        >
          下一页
        </a>
      </div>
    </div>
  );
};

/** 积分：后端以「分」存整数；前端统一按「分」展示（100 分 = 1.00 积分），避免同额不同名 */
export const fen = (value: number | null | undefined) => (Number(value) || 0).toLocaleString();

export const fmtTime = (value?: string | null) => (value ? value.slice(0, 16).replace('T', ' ') : '—');
