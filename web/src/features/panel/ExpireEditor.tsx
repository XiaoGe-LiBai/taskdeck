'use client';

import { useActionState, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/utils/Helpers';
import { setAccountExpireAction } from './actions';

export type StateAction = (prev: string, formData: FormData) => Promise<string>;

/**
 * 带状态反馈的动作表单：server action 返回 "ok:xxx" / "error:xxx"
 *  注意：Server Component 不能把函数当 props 传给 Client Component，
 *  所以成功文案用字符串模板（{v} 会替换成 action 返回的冒号后半段）。
 */
export const StateForm = (props: {
  action: StateAction;
  fields: Record<string, string | number | undefined>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  /** 成功文案模板，{v} 替换为返回内容；不传则直接展示返回内容 */
  okLabel?: string;
  submitLabel?: string;
  inline?: boolean;
  /** 表单 id：供外部元素（表格 checkbox 的 form 属性）关联进来 */
  id?: string;
}) => {
  const [state, formAction, pending] = useActionState(props.action, '');
  const ok = state && !state.startsWith('error:');
  const error = state.startsWith('error:') ? state.slice(6) : '';
  const detail = state.includes(':') ? state.slice(state.indexOf(':') + 1) : '';
  const okLabel = props.okLabel
    ? props.okLabel.replace('{v}', detail)
    : (detail || '操作成功');

  return (
    <form
      id={props.id}
      action={formAction}
      onSubmit={(event) => {
        // eslint-disable-next-line no-alert -- 项目约定：危险操作二次确认用 window.confirm（见 README「交互约定」）
        if (props.confirm && !window.confirm(props.confirm)) {
          event.preventDefault();
        }
      }}
      className={cn(props.inline !== false && `
        inline-flex flex-wrap items-center gap-2
      `, props.className)}
    >
      {Object.entries(props.fields).map(([key, value]) =>
        value === undefined
          ? null
          : (
              <input key={key} type="hidden" name={key} value={String(value)} />
            ),
      )}

      {props.children}

      <button
        type="submit"
        disabled={pending}
        className="
          rounded-md bg-primary px-3 py-1.5 text-xs font-medium
          text-primary-foreground
          hover:opacity-90
          disabled:opacity-60
        "
      >
        {pending ? '处理中…' : (props.submitLabel ?? '提交')}
      </button>

      {ok && (
        <span className="text-xs text-emerald-600">{okLabel}</span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
};

/** 账号到期时间编辑器：快捷延长 + 自定义时间 */
export const ExpireEditor = (props: { accountId: number; current: string | null }) => {
  const [open, setOpen] = useState(false);
  const [quick, setQuick] = useState('');
  const [value, setValue] = useState(props.current ?? '');
  const [state, formAction, pending] = useActionState(setAccountExpireAction, '');

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="
          rounded-md border px-2.5 py-1 text-xs font-medium
          hover:bg-muted
        "
      >
        {open ? '收起' : '设置到期'}
      </button>

      {open && (
        <div className="mt-2 w-64 rounded-md border bg-card p-3 shadow-sm">
          <div className="mb-2 text-xs text-muted-foreground">快捷延长（以保存时刻计算）</div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {[
              { key: '1', label: '+1天' },
              { key: '3', label: '+3天' },
              { key: '7', label: '+7天' },
              { key: '15', label: '+15天' },
              { key: 'month', label: '到月底' },
            ].map(item => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setQuick(item.key);
                  setValue('');
                }}
                className={cn(
                  'rounded-sm border px-2 py-1 text-xs',
                  quick === item.key
                    ? 'bg-primary text-primary-foreground'
                    : `hover:bg-muted`,
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <form action={formAction} className="flex flex-col gap-2">
            <input type="hidden" name="account_id" value={props.accountId} />
            <input type="hidden" name="quick" value={quick} />
            <Input
              name="membership_expire"
              type="datetime-local"
              value={value}
              disabled={!!quick}
              onChange={(event) => {
                setQuick('');
                setValue(event.target.value);
              }}
              className="h-9 text-xs"
            />
            <button
              type="submit"
              disabled={pending}
              className="
                rounded-md bg-primary px-3 py-1.5 text-xs font-medium
                text-primary-foreground
                hover:opacity-90
                disabled:opacity-60
              "
            >
              {pending ? '保存中…' : '保存到期时间'}
            </button>
          </form>

          {state.startsWith('ok:') && (
            <div className="mt-2 text-xs text-emerald-600">
              已保存
            </div>
          )}
          {state.startsWith('error:') && (
            <div className="mt-2 text-xs text-destructive">{state.slice(6)}</div>
          )}
        </div>
      )}
    </div>
  );
};
