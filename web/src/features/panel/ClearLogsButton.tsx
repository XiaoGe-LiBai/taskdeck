'use client';

import { useActionState } from 'react';
import { clearJobLogsAction } from './actions';

/** 清空运行日志：结果就地回显，不刷新整页。 */
export const ClearLogsButton = () => {
  const [state, formAction, pending] = useActionState(clearJobLogsAction, '');
  const ok = state.startsWith('ok:');
  const message = state.replace(/^(ok|error):/, '');

  return (
    <form action={formAction} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="
          rounded-md border px-3 py-1.5 text-xs
          hover:bg-muted
          disabled:opacity-50
        "
      >
        {pending ? '清空中…' : '清空日志'}
      </button>
      {message && (
        <span className={ok
          ? 'text-xs text-emerald-600'
          : `text-xs text-destructive`}
        >
          {message}
        </span>
      )}
    </form>
  );
};
