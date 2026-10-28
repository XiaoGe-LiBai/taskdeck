'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { cn } from '@/utils/Helpers';

/** 面板写操作的统一签名：返回 "ok:..." / "error:..."，由表单组件展示结果 */
export type PanelAction = (prev: string, formData: FormData) => Promise<string>;

/** 解析 action 返回的 "ok:xxx" / "error:xxx" 字符串 */
const parseActionMsg = (state: string) => ({
  ok: !!state && !state.startsWith('error:'),
  error: state.startsWith('error:') ? state.slice(6) : '',
  detail: state.includes(':') ? state.slice(state.indexOf(':') + 1) : state,
});

/** 结果文案：成功 4 秒 / 失败 8 秒后自动隐藏 */
function useActionFeedback(state: string) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!state) {
      return;
    }
    setVisible(true);
    const timer = setTimeout(setVisible, state.startsWith('error:') ? 8000 : 4000, false);
    return () => clearTimeout(timer);
  }, [state]);
  return visible;
}

const ACTION_BUTTON_CLASS = `
  rounded-md border px-2.5 py-1 text-xs font-medium transition-colors
  hover:bg-muted disabled:opacity-50
`;

/** 通用动作表单：隐藏字段 + 提交按钮，自动展示 ok/error 结果（不再静默失败） */
export const ActionForm = (props: {
  action: PanelAction;
  fields: Record<string, string | number | undefined>;
  children: React.ReactNode;
  className?: string;
  confirm?: string;
  title?: string;
  /** 成功文案模板，{v} 替换为返回内容；不传则直接展示返回内容 */
  okLabel?: string;
}) => {
  const [state, formAction, pending] = useActionState(props.action, '');
  const visible = useActionFeedback(state);
  const { ok, error, detail } = parseActionMsg(state);
  const okText = props.okLabel ? props.okLabel.replace('{v}', detail) : detail || '操作成功';

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        // eslint-disable-next-line no-alert -- 项目约定：危险操作二次确认用 window.confirm（见 README「交互约定」）
        if (props.confirm && !window.confirm(props.confirm)) {
          event.preventDefault();
        }
      }}
      className={cn('inline-flex flex-wrap items-center gap-2', props.className)}
    >
      {Object.entries(props.fields).map(([key, value]) =>
        value === undefined
          ? null
          : (
              <input key={key} type="hidden" name={key} value={String(value)} />
            ),
      )}

      <button
        type="submit"
        disabled={pending}
        title={props.title}
        className={ACTION_BUTTON_CLASS}
      >
        {pending ? '处理中…' : props.children}
      </button>

      {visible && ok && <span className="text-xs text-emerald-600">{okText}</span>}
      {visible && error && <span className="text-xs text-destructive">{error}</span>}
    </form>
  );
};

/**
 * 裸表单里的结果反馈按钮：手动收集 FormData 调用 server action，
 * 用于「表格里 checkbox + 多个提交按钮」的场景（如卡密批量作废/删除）。
 * 按钮自身的 name/value 会合并进 FormData（与原生提交按钮语义一致）。
 */
export const FeedbackButton = (props: {
  formAction: PanelAction;
  name?: string;
  value?: string | number;
  confirm?: string;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) => {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!msg) {
      return;
    }
    setVisible(true);
    const timer = setTimeout(setVisible, msg.ok ? 4000 : 8000, false);
    return () => clearTimeout(timer);
  }, [msg]);

  const onClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // eslint-disable-next-line no-alert -- 项目约定：危险操作二次确认用 window.confirm（见 README「交互约定」）
    if (props.confirm && !window.confirm(props.confirm)) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const form = event.currentTarget.form;
    if (!form) {
      return;
    }
    const fd = new FormData(form);
    if (props.name) {
      fd.set(props.name, String(props.value ?? ''));
    }
    startTransition(async () => {
      const res = await props.formAction('', fd);
      const parsed = parseActionMsg(res);
      setMsg(parsed.ok
        ? { ok: true, text: parsed.detail || '操作成功' }
        : { ok: false, text: parsed.error || '操作失败' });
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        title={props.title}
        onClick={onClick}
        className={cn(ACTION_BUTTON_CLASS, props.className)}
      >
        {pending ? '处理中…' : props.children}
      </button>
      {visible && msg && (
        <span className={msg.ok
          ? 'text-xs text-emerald-600'
          : `text-xs text-destructive`}
        >
          {msg.text}
        </span>
      )}
    </span>
  );
};

/** 折叠面板：任务开关、报名等低频操作放在里面 */
export const Collapsible = (props: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className={props.className}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="
          rounded-md border px-2.5 py-1 text-xs font-medium
          hover:bg-muted
        "
      >
        {open ? `收起${props.label}` : props.label}
      </button>
      {open && <div className="mt-3">{props.children}</div>}
    </div>
  );
};
