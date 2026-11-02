'use client';

import { useActionState } from 'react';
import { Input } from '@/components/ui/input';
import { scheduleGrabAction } from './actions';
import { useGeoLocation } from './location/LocationContext';
import { Card } from './Ui';

/** 抢单预约：填活动 ID + 计划时间；时间留空即立即抢。 */
export const GrabScheduler = (props: {
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
}) => {
  const [state, formAction, pending] = useActionState(scheduleGrabAction, '');
  const { location, open: openLocation } = useGeoLocation();
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

        {/* 定位统一走全局设置：抢单要按真实位置匹配周边名额，不能让每个表单各填一份 */}
        <input type="hidden" name="lat" value={location?.lat ?? ''} />
        <input type="hidden" name="lon" value={location?.lon ?? ''} />
        <input type="hidden" name="city_code" value={location?.cityCode ?? ''} />
        <div className="
          flex flex-col gap-1 text-sm font-medium
          sm:col-span-2
        "
        >
          当前定位
          <div className="flex flex-wrap items-center gap-2">
            <span className={`
              rounded-md border px-2.5 py-1.5 text-xs
              ${location
      ? 'bg-muted/40'
      : `
        border-amber-500/40 bg-amber-500/10 text-amber-700
        dark:text-amber-300
      `}
            `}
            >
              {location
                ? `${location.cityName} · ${location.addressName}（${location.cityCode}）`
                : '未设置定位，抢单前请先获取'}
            </span>
            <button
              type="button"
              onClick={openLocation}
              className="
                rounded-md border px-2.5 py-1.5 text-xs
                hover:bg-muted
              "
            >
              {location ? '修改定位' : '去设置定位'}
            </button>
          </div>
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending || !location}
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
