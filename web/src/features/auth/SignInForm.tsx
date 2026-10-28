'use client';

import type { AuthActionState } from './actions';
import Link from 'next/link';
import { useActionState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { ClickSpark, DecryptedText, Magnet, SpotlightCard } from '@/components/reactbits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signInAction } from './actions';

/**
 * 单入口登录。
 *
 * 一个后台、一个入口：小蚕与应用宝两个业务模块对所有登录用户开放，
 * 不做渠道分墙（账号的 channel 只是数据归属，不限制登录与访问）。
 */
export const SignInForm = (props: { redirectUrl?: string; siteName: string; logoUrl?: string; setupComplete?: boolean }) => {
  const [state, formAction, pending] = useActionState<AuthActionState, FormData>(
    signInAction,
    {},
  );

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
          <DecryptedText text={props.siteName} speed={60} />
        </div>
      </div>

      {props.setupComplete && (
        <p role="status" className="mb-4 rounded-md bg-primary/10 p-3 text-sm">
          管理员已创建，请使用刚设置的邮箱和密码登录。
        </p>
      )}
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="redirect_url" value={props.redirectUrl ?? ''} />

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          邮箱
          <Input name="email" type="email" placeholder="admin@example.com" autoComplete="email" required />
        </label>

        <label className="flex flex-col gap-1.5 text-sm font-medium">
          <span className="flex items-center justify-between">
            密码
            <Link
              href="/forgot-password"
              className="
                text-xs font-normal text-muted-foreground
                hover:text-foreground hover:underline
              "
            >
              忘记密码？
            </Link>
          </span>
          <Input name="password" type="password" placeholder="请输入密码" autoComplete="current-password" required />
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
              {pending ? '登录中…' : '登录'}
            </Button>
          </ClickSpark>
        </Magnet>
      </form>

      <div className="mt-4 text-center text-sm text-muted-foreground">
        还没有账号？
        {' '}
        <Link href="/sign-up" className="font-medium text-foreground underline">
          注册
        </Link>
      </div>
    </SpotlightCard>
  );
};
