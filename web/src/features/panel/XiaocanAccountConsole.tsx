'use client';

import { useState } from 'react';
import { XiaocanConsole } from './XiaocanConsole';

/**
 * 账号卡片里的「资产与福利」折叠面板。
 *
 * 只有点开才挂载工作台，避免账号列表一渲染就对每个账号发起一轮网关请求。
 */
export const XiaocanAccountConsole = (props: {
  account: { id: number; nickname: string; account_info: string };
  label?: string;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="
          rounded-md border px-2.5 py-1 text-xs font-medium
          hover:bg-muted
        "
      >
        {open ? '收起资产与福利' : (props.label ?? '资产与福利')}
      </button>
      {open && (
        <XiaocanConsole
          accounts={[props.account]}
          variant="compact"
          defaultAccountId={props.account.id}
          className="mt-3"
        />
      )}
    </div>
  );
};
