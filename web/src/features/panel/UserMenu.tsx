'use client';

import Link from 'next/link';
import { useState } from 'react';
import { signOutAction } from '@/features/auth/actions';
import { readLoginCookieAction } from './actions/session';

export const UserMenu = (props: { email: string; nickname?: string; role?: string }) => {
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState('');

  const copyCookie = async () => {
    setCopyState('');
    const result = await readLoginCookieAction();
    if (!result.ok) {
      setCopyState(result.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(result.cookie);
      setCopyState('已复制到剪贴板（等同账号密码，别外传）');
    } catch {
      // 非安全上下文（http）下 clipboard 不可用，退回让用户手动复制
      setCopyState(`复制失败，请手动复制：${result.cookie}`);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="
          flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm
          hover:bg-muted
        "
      >
        <span className="
          flex size-6 items-center justify-center rounded-full bg-primary
          text-xs text-primary-foreground
        "
        >
          {(props.nickname || props.email).slice(0, 1).toUpperCase()}
        </span>
        <span className="max-w-40 truncate">{props.nickname || props.email}</span>
        <span className="text-muted-foreground">⌄</span>
      </button>

      {open && (
        <div className="
          absolute right-0 z-20 mt-2 w-56 rounded-md border bg-card p-2
          shadow-lg
        "
        >
          <div className="border-b p-2 text-xs text-muted-foreground">
            <div className="truncate font-medium text-foreground">{props.email}</div>
            <div>{props.role === 'admin' ? '管理员' : '普通用户'}</div>
          </div>
          <Link
            href="/"
            className="
              block rounded-sm p-2 text-sm
              hover:bg-muted
            "
            onClick={() => setOpen(false)}
          >
            返回官网首页
          </Link>
          <button
            type="button"
            onClick={() => void copyCookie()}
            title="把当前登录 Cookie 复制到剪贴板，可直接带到其它工具或调试用"
            className="
              w-full rounded-sm p-2 text-left text-sm
              hover:bg-muted
            "
          >
            复制登录 Cookie
          </button>
          {copyState && (
            <div className="px-2 pb-2 text-xs break-all text-muted-foreground">
              {copyState}
            </div>
          )}
          <form action={signOutAction}>
            <button
              type="submit"
              className="
                w-full rounded-sm p-2 text-left text-sm text-destructive
                hover:bg-muted
              "
            >
              退出登录
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
