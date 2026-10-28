'use client';

/** 底部悬浮批量操作栏：勾选用户后出现，支持封禁/解封/调积分/调车位/踢下线。 */
export const UsersBatchBar = (props: {
  count: number;
  pending: boolean;
  onAction: (action: 'ban' | 'unban' | 'adjust_points' | 'adjust_slots' | 'kick') => void;
  onClear: () => void;
}) => {
  const btn = 'rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50';

  return (
    <div className="
      fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3
      rounded-full border bg-card/95 px-5 py-2.5 shadow-2xl backdrop-blur-md
    "
    >
      <span className="text-xs font-semibold text-foreground">
        已勾选
        {' '}
        <span className="text-primary">{props.count}</span>
        {' '}
        位用户
      </span>
      <div className="h-4 w-px bg-border" />
      <button
        type="button"
        onClick={() => props.onAction('ban')}
        disabled={props.pending}
        className={`
          ${btn}
          bg-rose-500/10 text-rose-600
          hover:bg-rose-500/20
        `}
      >
        批量封禁
      </button>
      <button
        type="button"
        onClick={() => props.onAction('unban')}
        disabled={props.pending}
        className={`
          ${btn}
          bg-emerald-500/10 text-emerald-600
          hover:bg-emerald-500/20
        `}
      >
        批量解封
      </button>
      <button
        type="button"
        onClick={() => props.onAction('adjust_points')}
        disabled={props.pending}
        className={`
          ${btn}
          bg-primary/10 text-primary
          hover:bg-primary/20
        `}
      >
        批量调积分
      </button>
      <button
        type="button"
        onClick={() => props.onAction('adjust_slots')}
        disabled={props.pending}
        className={`
          ${btn}
          bg-blue-500/10 text-blue-600
          hover:bg-blue-500/20
        `}
      >
        批量调车位
      </button>
      <button
        type="button"
        onClick={() => props.onAction('kick')}
        disabled={props.pending}
        className={`
          ${btn}
          bg-orange-500/10 text-orange-600
          hover:bg-orange-500/20
        `}
      >
        批量踢下线
      </button>
      <button
        type="button"
        onClick={props.onClear}
        className="
          ml-1 text-xs text-muted-foreground
          hover:text-foreground
        "
      >
        取消选择
      </button>
    </div>
  );
};
