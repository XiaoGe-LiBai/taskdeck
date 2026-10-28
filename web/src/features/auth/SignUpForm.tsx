'use client';

import type { AuthActionState, SendCodeState } from './actions';
import Link from 'next/link';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { ClickSpark, DecryptedText, Magnet, SpotlightCard } from '@/components/reactbits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { sendRegisterCodeAction, signUpAction } from './actions';

/** 后端发码限流是 60 秒一次，前端倒计时对齐 */
const RESEND_SECONDS = 60;

const EMPTY_FORM = {
  email: '',
  code: '',
  nickname: '',
  password: '',
  confirmPassword: '',
  inviteCode: '',
};

/** logoUrl 由 sign-up 页面从后端取好传下来；空值 = 用内置鸭标 */
export const SignUpForm = (props: { logoUrl?: string }) => {
  const [state, formAction, pending] = useActionState<AuthActionState, FormData>(
    signUpAction,
    {},
  );
  const [codeState, setCodeState] = useState<SendCodeState>({});
  const [sendingCode, startSendCode] = useTransition();

  /**
   * 所有输入都受控。原因：React 19 在表单 action 跑完（无论成功失败）后会 reset 整个 <form>，
   * 非受控输入会被打回 defaultValue —— 之前就出现过「点一下获取验证码，邮箱密码全被清空」。
   */
  const [form, setForm] = useState(EMPTY_FORM);
  const field = (key: keyof typeof EMPTY_FORM) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm(prev => ({ ...prev, [key]: event.target.value })),
  });

  // 倒计时用「截止时刻」推导：不在 effect 里同步 setState（避免多余重渲染），也不会漂移
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

  // 发码走普通函数调用而不是表单 action：走表单会把整张表单 reset 掉
  const sendCode = () => {
    startSendCode(async () => {
      setCodeState(await sendRegisterCodeAction(form.email));
    });
  };

  return (
    <SpotlightCard className="
      w-full max-w-sm rounded-xl brand-glass p-6 shadow-xl brand-outline
    "
    >
      <div className="mb-6 text-center">
        <BrandMark
          size={48}
          logoUrl={props.logoUrl}
          className="mx-auto shadow-sm"
        />
        <div className="mt-3 text-xl font-semibold">
          <DecryptedText text="注册账号" speed={60} />
        </div>
        <div className="text-sm text-muted-foreground">绑定小蚕账号后即可托管抢券任务</div>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          邮箱
          <Input
            name="email"
            type="email"
            placeholder="you@example.com"
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
          昵称
          <Input name="nickname" placeholder="怎么称呼你" {...field('nickname')} />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          密码
          <Input
            name="password"
            type="password"
            placeholder="至少 8 位"
            required
            autoComplete="new-password"
            {...field('password')}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          确认密码
          <Input
            name="confirmPassword"
            type="password"
            placeholder="请再次输入密码"
            required
            autoComplete="new-password"
            {...field('confirmPassword')}
          />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          邀请码（选填）
          <Input name="invite_code" placeholder="6 位邀请码" {...field('inviteCode')} />
        </label>

        {state.error && (
          <div className="
            rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive
          "
          >
            {state.error}
          </div>
        )}

        <Magnet strength={0.15} max={6} className="mt-2 w-full">
          <ClickSpark className="w-full" color="#fff">
            <Button
              type="submit"
              disabled={pending}
              className="
                w-full border-transparent bg-brand-gradient text-white
                hover:opacity-90
              "
            >
              {pending ? '创建中…' : '创建账号'}
            </Button>
          </ClickSpark>
        </Magnet>
      </form>

      <div className="mt-4 text-center text-sm text-muted-foreground">
        已有账号？
        {' '}
        <Link href="/sign-in" className="font-medium text-foreground underline">
          去登录
        </Link>
      </div>
    </SpotlightCard>
  );
};
