'use client';

import { useActionState } from 'react';
import { saveNotifySettingsAction } from './actions';
import { Card } from './Ui';

export const NotificationSettings = (props: {
  initialEmailNotify: boolean;
}) => {
  const [state, formAction, isPending] = useActionState(saveNotifySettingsAction, '');

  const isOk = state.startsWith('ok:');
  const msg = state.replace(/^(ok|error):/, '');

  return (
    <Card
      title="通知推送渠道偏好"
      description="配置系统执行结果、账号异常或卡密变动时的消息推送渠道。"
    >
      <form action={formAction} className="flex max-w-lg flex-col gap-4">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            name="email_notify"
            defaultChecked={props.initialEmailNotify}
            className="
              size-4 rounded-sm border-gray-300 text-primary
              focus:ring-primary
            "
          />
          <div>
            <div className="text-sm font-medium text-foreground">开启邮件消息提醒</div>
            <div className="text-xs text-muted-foreground">
              当账号掉线、卡密充值或任务异常时向注册邮箱发送提醒邮件
            </div>
          </div>
        </label>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="
              bg-brand-gradient rounded-md px-4 py-2 text-sm font-semibold
              text-white shadow-sm
              hover:opacity-90
              disabled:opacity-50
            "
          >
            {isPending ? '正在保存…' : '保存推送设置'}
          </button>
        </div>

        {state && (
          <div
            className={`
              mt-2 rounded-md border p-3 text-sm
              ${
          isOk
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
            : 'border-red-500/20 bg-red-500/10 text-red-600'
          }
            `}
          >
            {msg}
          </div>
        )}
      </form>
    </Card>
  );
};
