'use client';

import type { PanelUserRow } from '@/types/Panel';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { updateUserRemarkAction } from '@/features/panel/actions';

/** 5. 修改管理员备注弹窗（运维识别用）。 */
export const RemarkDialog = (props: {
  user: PanelUserRow;
  onClose: () => void;
  onDone: (msg: { type: 'ok' | 'error'; text: string }) => void;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [remark, setRemark] = useState(props.user.remark ?? '');

  const remarkInputId = useId();
  const { user } = props;

  const submit = () => {
    const fd = new FormData();
    fd.set('user_id', String(user.id));
    fd.set('remark', remark.trim());

    startTransition(async () => {
      const res = await updateUserRemarkAction('', fd);
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
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-base font-semibold text-foreground">修改管理员备注</h3>
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
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={remarkInputId}
              className="font-medium text-foreground"
            >
              备注信息 (方便运维识别)
            </label>
            <textarea
              id={remarkInputId}
              rows={3}
              maxLength={200}
              value={remark}
              onChange={e => setRemark(e.target.value)}
              placeholder="例如: 重点监控账号、大客户、微信经常掉线等"
              className="
                w-full rounded-lg border border-input bg-background p-2.5
                text-xs
                focus:ring-1 focus:ring-primary
              "
            />
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
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
              {pending ? '保存中…' : '保存备注'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
