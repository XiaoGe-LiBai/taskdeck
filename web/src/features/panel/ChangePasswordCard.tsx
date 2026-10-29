'use client';

import { useActionState, useState } from 'react';
import { changePasswordAction } from './actions';
import { Card } from './Ui';

/**
 * 修改登录口令：旧密码 → 新密码 → 确认。
 *
 * 与换绑邮箱不同，这里不需要验证码：验证的是「当前密码」本身。
 * 表单成功后清空输入，避免密码留在浏览器 DOM 里。
 */
export const ChangePasswordCard = () => {
  const [state, formAction, pending] = useActionState(changePasswordAction, '');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const ok = state.startsWith('ok:');
  const error = state.startsWith('error:') ? state.slice(6) : '';

  return (
    <Card title="修改密码" description="需要先验证当前密码；新密码至少 8 位">
      <form
        action={(formData) => {
          setOldPassword('');
          setNewPassword('');
          setConfirmPassword('');
          formAction(formData);
        }}
        className="flex max-w-lg flex-col gap-3"
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          当前密码
          <input
            name="old_password"
            type="password"
            autoComplete="current-password"
            value={oldPassword}
            onChange={e => setOldPassword(e.target.value)}
            className="
              rounded-md border bg-background px-3 py-2 text-sm
              focus:ring-2 focus:ring-primary/20 focus:outline-none
            "
            required
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          新密码
          <input
            name="new_password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="
              rounded-md border bg-background px-3 py-2 text-sm
              focus:ring-2 focus:ring-primary/20 focus:outline-none
            "
            required
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          确认新密码
          <input
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className="
              rounded-md border bg-background px-3 py-2 text-sm
              focus:ring-2 focus:ring-primary/20 focus:outline-none
            "
            required
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="
            mt-1 self-start rounded-md bg-brand-gradient px-5 py-2 text-sm
            font-semibold text-white shadow-sm
            hover:opacity-90
            disabled:opacity-50
          "
        >
          {pending ? '提交中…' : '修改密码'}
        </button>

        {ok && <span className="text-xs text-emerald-600">{state.slice(3)}</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </form>
    </Card>
  );
};
