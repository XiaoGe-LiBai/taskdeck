'use client';

import { useActionState } from 'react';
import { Input } from '@/components/ui/input';
import { scheduleGrabAction } from './actions';
import { Card } from './Ui';

/** 抢单预约：填活动 ID + 计划时间；时间留空即立即抢。 */
export const GrabScheduler = (props: {
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
}) => {
  const [state, formAction, pending] = useActionState(scheduleGrabAction, '');
  const ok = state.startsWith('ok:');
  const message = state.replace(/^(ok|error):/, '');

  if (!props.accounts.length) {
    return (
      <Card title="抢单 / 预约" description="先绑定小蚕账号">
        <p className="text-sm text-muted-foreground">还没有绑定小蚕账号</p>
      </Card>
    );
  }

  return (
    <Card
      title="抢单 / 预约"
      description="填活动 ID：时间留空立即抢；填了就到点触发。抢单结果会写进下方运行日志"
    >
      <form
        action={formAction}
        className="
          grid gap-3
          sm:grid-cols-2
          lg:grid-cols-4
        "
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          使用账号
          <select
            name="account_id"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            required
          >
            {props.accounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.nickname || account.account_info}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          活动 ID
          <Input name="promotion_id" placeholder="如 123456789" className="h-9" required />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          计划时间（留空=立即）
          <Input name="at" type="datetime-local" className="h-9" />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm font-medium">
          <input type="checkbox" name="advance" className="size-4" />
          使用超前券
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          纬度（可选）
          <Input name="lat" placeholder="22.5431" className="h-9" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          经度（可选）
          <Input name="lon" placeholder="114.0579" className="h-9" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          城市码（可选）
          <Input name="city_code" placeholder="440303" className="h-9" />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="
              h-9 w-full rounded-md bg-brand-gradient px-4 text-sm font-semibold
              text-white
              hover:opacity-90
              disabled:opacity-50
            "
          >
            {pending ? '提交中…' : '提交任务'}
          </button>
        </div>
      </form>

      {message && (
        <div
          className={`
            mt-3 rounded-md px-3 py-2 text-xs
            ${ok
          ? `bg-emerald-500/10 text-emerald-600`
          : `bg-destructive/10 text-destructive`}
          `}
        >
          {message}
        </div>
      )}
    </Card>
  );
};
