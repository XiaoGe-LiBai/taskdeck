'use client';

import { useActionState, useState, useTransition } from 'react';
import { changeEmailAction, sendEmailChangeCodeAction } from './actions';
import { Card } from './Ui';

/** 换绑邮箱：新邮箱 → 获取验证码 → 验码提交。当前邮箱显示在上面作提示 */
export const ChangeEmailCard = (props: { currentEmail: string }) => {
  const [state, formAction, pending] = useActionState(changeEmailAction, '');
  const [codeMsg, setCodeMsg] = useState('');
  const [sendingCode, startSendCode] = useTransition();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  const ok = state.startsWith('ok:');
  const error = state.startsWith('error:') ? state.slice(6) : '';
  const codeOk = codeMsg.startsWith('ok:');
  const codeError = codeMsg.startsWith('error:') ? codeMsg.slice(6) : '';

  const sendCode = () => {
    startSendCode(async () => {
      setCodeMsg(await sendEmailChangeCodeAction(email));
    });
  };

  return (
    <Card title="换绑邮箱" description="登录名就是邮箱；验证码会发到你要换绑的新邮箱">
      <div className="mb-3 text-xs text-muted-foreground">
        当前邮箱：
        <span className="font-medium text-foreground">{props.currentEmail}</span>
      </div>

      <form action={formAction} className="flex max-w-lg flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          新邮箱
          <input
            name="new_email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="new@example.com"
            className="
              rounded-md border bg-background px-3 py-2 text-sm
              focus:ring-2 focus:ring-primary/20 focus:outline-none
            "
            required
          />
        </label>

        <div className="flex flex-col gap-1.5 text-sm font-medium">
          邮箱验证码
          <div className="flex items-center gap-2">
            <input
              name="code"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="6 位数字"
              className="
                flex-1 rounded-md border bg-background px-3 py-2 text-sm
                focus:ring-2 focus:ring-primary/20 focus:outline-none
              "
              required
            />
            <button
              type="button"
              onClick={sendCode}
              disabled={sendingCode || !email.includes('@')}
              className="
                shrink-0 rounded-md border px-3 py-2 text-xs font-medium
                hover:bg-muted
                disabled:opacity-50
              "
            >
              {sendingCode ? '发送中…' : '获取验证码'}
            </button>
          </div>
          {codeOk && <span className="text-xs font-normal text-emerald-600">{codeMsg.slice(3)}</span>}
          {codeError && <span className="text-xs font-normal text-destructive">{codeError}</span>}
        </div>

        <button
          type="submit"
          disabled={pending}
          className="
            mt-1 rounded-md bg-brand-gradient px-5 py-2 text-sm font-semibold
            text-white shadow-sm
            hover:opacity-90
            disabled:opacity-50
          "
        >
          {pending ? '提交中…' : '确认换绑'}
        </button>

        {ok && <span className="text-xs text-emerald-600">{state.slice(3)}</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </form>
    </Card>
  );
};
