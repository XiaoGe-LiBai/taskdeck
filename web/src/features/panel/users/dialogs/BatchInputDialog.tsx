'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { batchUsersAction } from '@/features/panel/actions';

/** 11. 批量调整（积分/车位）的输入弹窗：勾选后需要填一个数值才会执行。 */
export const BatchInputDialog = (props: {
  actionType: 'adjust_points' | 'adjust_slots';
  selectedIds: number[];
  onClose: () => void;
  onDone: (msg: { type: 'ok' | 'error'; text: string }) => void;
  /** 成功执行后清空勾选 */
  onCleared: () => void;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState('');
  const isPoints = props.actionType === 'adjust_points';

  const submit = () => {
    const val = Number.parseInt(value, 10);
    if (Number.isNaN(val) || val === 0) {
      props.onDone({ type: 'error', text: '请输入非 0 的有效数值' });
      return;
    }
    if (!props.selectedIds.length) {
      props.onDone({ type: 'error', text: '请先勾选需要操作的用户' });
      return;
    }

    startTransition(async () => {
      const res = await batchUsersAction(props.actionType, props.selectedIds, {
        amount: isPoints ? val : undefined,
        delta: isPoints ? undefined : val,
      });
      if (res.ok) {
        props.onDone({ type: 'ok', text: res.msg });
        props.onClose();
        props.onCleared();
        router.refresh();
      } else {
        props.onDone({ type: 'error', text: res.msg });
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
        <h3 className="text-base font-semibold text-foreground">
          {isPoints ? '批量调整积分' : '批量调整车位'}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          已选
          {' '}
          <strong className="text-primary">{props.selectedIds.length}</strong>
          {' '}
          位用户
        </p>
        <div className="mt-4 flex flex-col gap-3 text-xs">
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground">
              {isPoints
                ? '变动积分数量（正数增加，负数扣除）'
                : '增减车位数量（正数增加，负数扣除）'}
            </label>
            <input
              type="number"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={isPoints ? '例如: 500 或 -200' : '例如: 2 或 -1'}
              className="
                h-9 w-full rounded-lg border border-input bg-background px-3
                text-sm
                focus:ring-1 focus:ring-primary
              "
            />
          </div>
          <div className="mt-2 flex justify-end gap-2 border-t pt-3">
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
              disabled={pending || !value}
              className="
                rounded-lg bg-primary px-4 py-2 font-medium
                text-primary-foreground
                hover:bg-primary/90
                disabled:opacity-50
              "
            >
              {pending ? '执行中…' : '确认批量调整'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
