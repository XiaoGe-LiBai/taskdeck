'use client';

/** 搜索 / 角色·状态筛选 / 新建用户入口（受控组件：状态与跳转逻辑都在父组件）。 */
export const UserToolbar = (props: {
  keyword: string;
  onKeywordChange: (value: string) => void;
  roleFilter: string;
  statusFilter: string;
  onRoleChange: (role: string) => void;
  onStatusChange: (status: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onResetFilters: () => void;
  onCreate: () => void;
  /** 当前筛选结果总数（用于「共 N 位用户」） */
  filteredTotal: number;
  pending: boolean;
}) => {
  const { keyword, roleFilter, statusFilter } = props;
  const hasFilter = Boolean(keyword || roleFilter || statusFilter);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* 搜索栏 */}
        <form
          onSubmit={props.onSearchSubmit}
          className="
            flex flex-1 items-center gap-2
            sm:max-w-md
          "
        >
          <div className="relative flex-1">
            <input
              type="text"
              value={keyword}
              onChange={e => props.onKeywordChange(e.target.value)}
              placeholder="搜索 ID / 昵称 / 邮箱 / 登录 IP…"
              className="
                h-9 w-full rounded-lg border border-input bg-background px-3
                text-sm outline-hidden transition-colors
                focus:border-primary focus:ring-1 focus:ring-primary
              "
            />
            {keyword && (
              <button
                type="button"
                onClick={() => {
                  props.onKeywordChange('');
                  props.onResetFilters();
                }}
                className="
                  absolute top-2 right-2.5 text-xs text-muted-foreground
                  hover:text-foreground
                "
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={props.pending}
            className="
              inline-flex h-9 items-center justify-center rounded-lg bg-primary
              px-3.5 text-xs font-medium text-primary-foreground shadow-xs
              hover:bg-primary/90
              disabled:opacity-50
            "
          >
            {props.pending ? '查询中…' : '搜索'}
          </button>
        </form>

        {/* 新增用户按钮与状态提示 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={props.onCreate}
            className="
              inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600
              px-3.5 text-xs font-medium text-white shadow-xs transition-colors
              hover:bg-emerald-700
            "
          >
            <span>+</span>
            <span>新建用户</span>
          </button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              共
              {' '}
              <strong className="text-foreground">{props.filteredTotal}</strong>
              {' '}
              位用户
            </span>
            {hasFilter && (
              <button
                type="button"
                onClick={props.onResetFilters}
                className="
                  rounded-md border border-input bg-muted/40 px-2 py-1 text-xs
                  hover:bg-muted hover:text-foreground
                "
              >
                清空筛选
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 角色与状态快速选择 Tab */}
      <div className="flex flex-wrap items-center gap-4 border-t pt-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">角色:</span>
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
            {[
              { label: '全部', value: '' },
              { label: '用户', value: 'user' },
              { label: '管理员', value: 'admin' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => props.onRoleChange(opt.value)}
                className={`
                  rounded-sm px-2.5 py-1 font-medium transition-all
                  ${
              roleFilter === opt.value
                ? 'bg-background text-foreground shadow-xs'
                : `
                  text-muted-foreground
                  hover:text-foreground
                `
              }
                `}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground">状态:</span>
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
            {[
              { label: '全部', value: '' },
              { label: '正常', value: 'normal' },
              { label: '封禁', value: 'banned' },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => props.onStatusChange(opt.value)}
                className={`
                  rounded-sm px-2.5 py-1 font-medium transition-all
                  ${
              statusFilter === opt.value
                ? 'bg-background text-foreground shadow-xs'
                : `
                  text-muted-foreground
                  hover:text-foreground
                `
              }
                `}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
