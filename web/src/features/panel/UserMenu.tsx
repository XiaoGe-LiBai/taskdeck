'use client';

import Link from 'next/link';
import { useState } from 'react';
import { signOutAction } from '@/features/auth/actions';

export const UserMenu = (props: { email: string; nickname?: string; role?: string }) => {
  const [open, setOpen] = useState(false);

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
