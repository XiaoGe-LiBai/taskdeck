'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createUserAction } from '@/features/panel/actions';

/**
 * 1. 新建用户弹窗：邮箱/密码/昵称/角色/初始车位。
 *  不含「渠道」—— 那个字段用户选不了、管理员也改不了，登录也不校验，
 *  后端会统一按默认渠道落库，所以不在这里暴露。
 */
export const CreateUserDialog = (props: {
  onClose: () => void;
  onDone: (msg: { type: 'ok' | 'error'; text: string }) => void;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [slots, setSlots] = useState('0');

  const submit = () => {
    if (!email || !password) {
      props.onDone({ type: 'error', text: '请填写邮箱和密码' });
      return;
    }
    const fd = new FormData();
    fd.set('email', email);
    fd.set('password', password);
    fd.set('nickname', nickname || email.split('@')[0] || '用户');
    fd.set('role', role);
    fd.set('slot_total', slots || '0');

    startTransition(async () => {
      const res = await createUserAction('', fd);
      if (res.startsWith('ok:')) {
        props.onDone({ type: 'ok', text: res.slice(3) });
        props.onClose();
        router.refresh();
      } else {
        props.onDone({ type: 'error', text: res.slice(6) });
      }
    });
  };

  return (
    <div className="
      fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4
      backdrop-blur-xs
    "
    >
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-base font-semibold text-foreground">新建平台用户</h3>
          <button
            type="button"
            onClick={props.onClose}
            className="
              rounded-md p-1 text-muted-foreground
              hover:bg-muted
            "
          >
            ✕
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-3 text-xs">
          <div className="flex flex-col gap-1">
            <label className="font-medium text-foreground">登录邮箱 *</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="
                h-9 rounded-lg border border-input bg-background px-3 text-xs
                focus:ring-1 focus:ring-primary
              "
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-medium text-foreground">初始密码 * (至少8位)</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="******"
              className="
                h-9 rounded-lg border border-input bg-background px-3 text-xs
                focus:ring-1 focus:ring-primary
              "
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-medium text-foreground">用户昵称 (选填)</label>
            <input
              type="text"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              placeholder="留空自动截取邮箱前缀"
              className="
                h-9 rounded-lg border border-input bg-background px-3 text-xs
                focus:ring-1 focus:ring-primary
              "
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-medium text-foreground">初始角色</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as 'user' | 'admin')}
              className="
                h-9 rounded-lg border border-input bg-background px-2 text-xs
              "
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-medium text-foreground">初始车位总数</label>
            <input
              type="number"
              value={slots}
              onChange={e => setSlots(e.target.value)}
              className="
                h-9 rounded-lg border border-input bg-background px-3 text-xs
              "
            />
          </div>
          <div className="mt-3 flex justify-end gap-2 border-t pt-3">
            <button
              type="button"
              onClick={props.onClose}
              className="
                rounded-lg border px-4 py-2
                hover:bg-muted
              "
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="
                rounded-lg bg-primary px-4 py-2 font-medium
                text-primary-foreground
                hover:bg-primary/90
                disabled:opacity-50
              "
            >
              {pending ? '创建中…' : '立即创建'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
