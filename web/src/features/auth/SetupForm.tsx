'use client';

import { useActionState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { SpotlightCard } from '@/components/reactbits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setupAction } from './setup-action';

export function SetupForm({ siteName }: { siteName: string }) {
  const [state, action, pending] = useActionState(setupAction, {});
  return (
    <SpotlightCard className="
      w-full max-w-md rounded-xl brand-glass p-6 shadow-xl brand-outline
    "
    >
      <div className="mb-6 text-center">
        <BrandMark size={48} className="mx-auto" />
        <p className="mt-3 text-sm text-muted-foreground">{siteName}</p>
        <h1 className="mt-1 text-2xl font-semibold">创建管理员</h1>
        <p className="mt-2 text-sm text-muted-foreground">只需设置一次，即可开始使用。</p>
      </div>
      <form action={action} className="flex flex-col gap-4" aria-busy={pending}>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          初始化码
          <Input name="setup_code" type="password" autoComplete="off" required maxLength={128} aria-describedby="setup-code-help" />
          <span
            id="setup-code-help"
            className="text-sm font-normal text-muted-foreground"
          >
            请使用启动日志中提供的一次性初始化码。
          </span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          管理员邮箱
          <Input name="email" type="email" autoComplete="username" required maxLength={254} placeholder="请输入邮箱" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          设置密码
          <Input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} aria-describedby="setup-password-help" />
          <span
            id="setup-password-help"
            className="text-sm font-normal text-muted-foreground"
          >
            12～128 位，可使用密码管理器生成。
          </span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          确认密码
          <Input name="confirm_password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
        </label>
        {state.error && (
          <p
            role="alert"
            className="
              rounded-md bg-destructive/10 p-3 text-sm text-destructive
            "
          >
            {state.error}
          </p>
        )}
        <Button
          type="submit"
          disabled={pending}
          className="
            mt-2 min-h-11 w-full border-transparent bg-brand-gradient text-white
          "
        >
          {pending ? '正在创建…' : '创建管理员并开始使用'}
        </Button>
      </form>
    </SpotlightCard>
  );
}
