'use client';

import type { PanelUserRow } from '@/types/Panel';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { renameUserAction } from '@/features/panel/actions';

/** 4. 修改昵称弹窗。 */
export const RenameDialog = (props: {
  user: PanelUserRow;
  onClose: () => void;
  onDone: (msg: { type: 'ok' | 'error'; text: string }) => void;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nickname, setNickname] = useState(props.user.nickname);

  const renameInputId = useId();
  const { user } = props;

  const submit = () => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      props.onDone({ type: 'error', text: '昵称不能为空' });
      return;
    }
    const fd = new FormData();
    fd.set('user_id', String(user.id));
    fd.set('nickname', trimmed);

    startTransition(async () => {
      const res = await renameUserAction('', fd);
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
          <h3 className="text-base font-semibold text-foreground">修改用户昵称</h3>
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
              htmlFor={renameInputId}
              className="font-medium text-foreground"
            >
              新昵称 (限20字)
            </label>
            <input
              id={renameInputId}
              type="text"
              maxLength={20}
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              className="
                h-9 w-full rounded-lg border border-input bg-background px-3
                text-sm
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
              disabled={pending || !nickname.trim()}
              className="
                rounded-lg bg-primary px-4 py-2 font-medium
                text-primary-foreground
                hover:bg-primary/90
                disabled:opacity-50
              "
            >
              {pending ? '保存中…' : '保存昵称'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
