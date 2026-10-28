'use client';

import type { AuthActionState, SendCodeState } from './actions';
import Link from 'next/link';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resetPasswordAction, sendResetCodeAction } from './actions';

/** 后端发码限流 60 秒一次，前端倒计时对齐 */
const RESEND_SECONDS = 60;

const EMPTY_FORM = { email: '', code: '', password: '', confirmPassword: '' };

export const ForgotPasswordForm = () => {
  const [state, formAction, pending] = useActionState<AuthActionState, FormData>(
    resetPasswordAction,
    {},
  );
  const [codeState, setCodeState] = useState<SendCodeState>({});
  const [sendingCode, startSendCode] = useTransition();
  const [form, setForm] = useState(EMPTY_FORM);
  const field = (key: keyof typeof EMPTY_FORM) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [key]: event.target.value })),
  });

  const deadline = codeState.ok && codeState.nonce ? codeState.nonce + RESEND_SECONDS * 1000 : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline || Date.now() >= deadline) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  const countdown = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;

  const sendCode = () => {
    startSendCode(async () => {
      setCodeState(await sendResetCodeAction(form.email));
    });
  };

  return (
    <div className="
      w-full max-w-sm rounded-xl brand-glass p-6 shadow-xl brand-outline
    "
    >
      <div className="mb-6 text-center">
        <div className="
          mx-auto flex size-12 items-center justify-center rounded-xl
          bg-brand-gradient text-2xl text-white shadow-sm
        "
        >
          🔑
        </div>
        <div className="mt-3 text-xl font-semibold">找回密码</div>
        <div className="text-sm text-muted-foreground">验证码会发到你的注册邮箱</div>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          邮箱
          <Input
            name="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            required
            {...field('email')}
          />
        </label>

        <div className="flex flex-col gap-1.5 text-sm font-medium">
          邮箱验证码
          <div className="flex items-center gap-2">
            <Input
              name="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="6 位数字"
              required
              className="flex-1"
              {...field('code')}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={sendCode}
              disabled={sendingCode || countdown > 0}
              className="h-10 shrink-0"
            >
              {sendingCode ? '发送中…' : countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
            </Button>
          </div>
          {codeState.error && (
            <div className="text-xs font-normal text-destructive">{codeState.error}</div>
          )}
          {codeState.devCode && (
            <div className="text-xs font-normal text-amber-600">
              开发模式（后端未配置 SMTP），验证码：
              {codeState.devCode}
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          新密码
          <Input
            name="password"
            type="password"
            placeholder="至少 8 位"
            autoComplete="new-password"
            required
            {...field('password')}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          确认新密码
          <Input
            name="confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
            autoComplete="new-password"
            required
            {...field('confirmPassword')}
          />
        </label>

        {state.error && (
          <div className="
            rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive
          "
          >
            {state.error}
          </div>
        )}

        <Button
          type="submit"
          disabled={pending}
          className="
            mt-2 w-full border-transparent bg-brand-gradient text-white
            hover:opacity-90
          "
        >
          {pending ? '重置中…' : '重置密码'}
        </Button>
      </form>

      <div className="mt-4 text-center text-sm text-muted-foreground">
        想起来了？
        {' '}
        <Link href="/sign-in" className="font-medium text-foreground underline">
          去登录
        </Link>
      </div>
    </div>
  );
};
