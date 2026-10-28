'use client';

import type { PanelUserRow } from '@/types/Panel';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { adjustUserSlotsAction } from '@/features/panel/actions';

/** 3. 调整车位弹窗：设置 slot_total 并记录调整原因。 */
export const SlotsDialog = (props: {
  user: PanelUserRow;
  onClose: () => void;
  onDone: (msg: { type: 'ok' | 'error'; text: string }) => void;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newSlots, setNewSlots] = useState(String(props.user.slot_total ?? 0));
  const [note, setNote] = useState('管理员调整车位');

  const slotsInputId = useId();
  const { user } = props;

  const submit = () => {
    const fd = new FormData();
    fd.set('user_id', String(user.id));
    fd.set('slot_total', String(Math.max(0, Number(newSlots) || 0)));
    fd.set('note', note);

    startTransition(async () => {
      const res = await adjustUserSlotsAction('', fd);
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
          <h3 className="text-base font-semibold text-foreground">调整用户车位配额</h3>
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
          <div className="flex justify-between rounded-lg bg-muted/40 p-2.5">
            <span className="text-muted-foreground">当前配额</span>
            <span className="font-semibold text-foreground">
              已用
              {' '}
              {user.slot_used ?? 0}
              {' '}
              / 总量
              {' '}
              {user.slot_total ?? 0}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={slotsInputId}
              className="font-medium text-foreground"
            >
              新车位总数 (slot_total)
            </label>
            <input
              id={slotsInputId}
              type="number"
              min="0"
              value={newSlots}
              onChange={e => setNewSlots(e.target.value)}
              className="
                h-9 w-full rounded-lg border border-input bg-background px-3
                text-sm
                focus:ring-1 focus:ring-primary
              "
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground">调整原因/备注</label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="例如: 客户升级车位赠送"
              className="
                h-9 w-full rounded-lg border border-input bg-background px-3
                text-xs
                focus:ring-1 focus:ring-primary
              "
            />
          </div>
          <div className="mt-3 flex justify-end gap-2 border-t pt-3">
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
              {pending ? '保存中…' : '确认修改车位'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
