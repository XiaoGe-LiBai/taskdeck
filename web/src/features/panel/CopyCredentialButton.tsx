'use client';

import { useState } from 'react';
import { readXiaocanCredentialAction } from './actions';

/**
 * 复制小蚕账号凭据（`备注#小蚕UserId#silk_id#token`）。
 *
 * 与管理员「账号数据」导出同一格式，可原样粘到开源版或其它工具里导入。
 * 这里复制的是**小蚕账号**的登录凭据，不是本站面板的登录态。
 *
 * 非安全上下文（http）下 clipboard 不可用，退回把串显示出来让用户手动选中复制 ——
 * 否则点了按钮什么也没发生，用户根本不知道该怎么办。
 */
export const CopyCredentialButton = (props: { accountId: number; silkId?: string }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [detail, setDetail] = useState('');

  const copy = async () => {
    setState('idle');
    setDetail('');
    const result = await readXiaocanCredentialAction(props.accountId);
    if (!result.ok) {
      setState('error');
      setDetail(result.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.data.text);
      setState('copied');
      setDetail('');
      window.setTimeout(setState, 2500, 'idle');
    } catch {
      setState('error');
      setDetail(`浏览器不允许自动复制，请手动选中复制：${result.data.text}`);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void copy()}
        title="复制这个小蚕账号的凭据（备注#小蚕UserId#silk_id#token），可直接导入开源版；不是本站登录态"
        className="
          rounded-md border px-2.5 py-1 text-xs font-medium transition-colors
          hover:bg-muted
        "
      >
        {state === 'copied' ? '已复制 ✓' : '复制小蚕凭据'}
      </button>
      {detail && (
        <span className={`
          max-w-72 text-xs break-all select-all
          ${state === 'error'
          ? `
            text-rose-600
            dark:text-rose-400
          `
          : `text-muted-foreground`}
        `}
        >
          {detail}
        </span>
      )}
    </span>
  );
};
