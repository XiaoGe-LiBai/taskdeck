'use client';

import type { PanelUserRow } from '@/types/Panel';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { adjustUserPointsAction } from '@/features/panel/actions';
import { fen } from '@/features/panel/Ui';

/** 2. 调整积分弹窗：快捷额度、自定义变动值、操作备注。 */
export const PointsDialog = (props: {
  user: PanelUserRow;
  onClose: () => void;
  onDone: (msg: { type: 'ok' | 'error'; text: string }) => void;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('管理员调整');

  const amountInputId = useId();
  const noteInputId = useId();
  const { user } = props;

  const submit = () => {
    const amountNum = Number.parseInt(amount, 10);
    if (!amountNum) {
      props.onDone({ type: 'error', text: '请输入非 0 的有效变动积分' });
      return;
    }
    const fd = new FormData();
    fd.set('user_id', String(user.id));
    fd.set('amount', String(amountNum));
    fd.set('note', note || '管理员调整');

    startTransition(async () => {
      const res = await adjustUserPointsAction('', fd);
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
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between border-b pb-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">调整用户积分</h3>
            <p className="text-xs text-muted-foreground">
              为用户「
              {user.nickname}
              」(#
              {' '}
              {user.id}
              ) 增减积分
            </p>
          </div>
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
        <div className="mt-4 flex flex-col gap-4">
          <div className="
            flex items-center justify-between rounded-lg bg-muted/40 p-3 text-xs
          "
          >
            <span className="text-muted-foreground">当前积分余额</span>
            <span className="font-semibold text-foreground">
              {user.points_balance}
              {' '}
              分 (
              {fen(user.points_balance)}
              )
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">快捷调整:</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: '+100分', val: '100' },
                { label: '+500分', val: '500' },
                { label: '+1000分', val: '1000' },
                { label: '+2000分', val: '2000' },
                { label: '-100分', val: '-100' },
                { label: '-500分', val: '-500' },
              ].map(item => (
                <button
                  key={item.val}
                  type="button"
                  onClick={() => setAmount(item.val)}
                  className="
                    rounded-md border border-input bg-background px-2.5 py-1
                    text-xs
                    hover:bg-muted
                  "
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={amountInputId}
              className="text-xs font-medium text-foreground"
            >
              变动积分（正数充值，负数扣减）
            </label>
            <input
              id={amountInputId}
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="例如: 500 或 -200"
              className="
                h-9 w-full rounded-lg border border-input bg-background px-3
                text-sm outline-hidden
                focus:border-primary focus:ring-1 focus:ring-primary
              "
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={noteInputId}
              className="text-xs font-medium text-foreground"
            >
              操作备注
            </label>
            <input
              id={noteInputId}
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="填写调整事由，供日志溯源"
              className="
                h-9 w-full rounded-lg border border-input bg-background px-3
                text-sm outline-hidden
                focus:border-primary focus:ring-1 focus:ring-primary
              "
            />
          </div>
          <div className="
            mt-2 flex items-center justify-end gap-2 border-t pt-3
          "
          >
            <button
              type="button"
              onClick={props.onClose}
              className="
                rounded-lg border border-input px-4 py-2 text-xs font-medium
                hover:bg-muted
              "
            >
              取消
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || !amount}
              className="
                rounded-lg bg-primary px-4 py-2 text-xs font-medium
                text-primary-foreground shadow-xs
                hover:bg-primary/90
                disabled:opacity-50
              "
            >
              {pending ? '提交中…' : '确认调整'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
