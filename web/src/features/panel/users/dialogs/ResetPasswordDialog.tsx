'use client';

import type { PanelUserRow } from '@/types/Panel';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { resetUserPasswordAction } from '@/features/panel/actions';

/**
 * 6. 重置密码弹窗。
 *
 * 与其它弹窗不同：成功后**不自动关闭**，而是在弹窗里展示新密码供管理员复制，
 * 点「完成」才关闭。这个结果态因此是本组件内部状态（resetResult）。
 */
export const ResetPasswordDialog = (props: {
  user: PanelUserRow;
  onClose: () => void;
  onDone: (msg: { type: 'ok' | 'error'; text: string }) => void;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [customPwd, setCustomPwd] = useState('');
  const [resetResult, setResetResult] = useState<string | null>(null);

  const { user } = props;

  const submit = () => {
    const fd = new FormData();
    fd.set('user_id', String(user.id));
    if (customPwd.trim()) {
      fd.set('password', customPwd.trim());
    }

    startTransition(async () => {
      const res = await resetUserPasswordAction('', fd);
      if (res.startsWith('ok:')) {
        setResetResult(res.slice(3));
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
          <h3 className="text-base font-semibold text-foreground">重置用户密码</h3>
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
          {resetResult
            ? (
                <div className="
                  rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3
                  text-emerald-700
                  dark:text-emerald-300
                "
                >
                  <div className="mb-1 font-semibold">✓ 重置成功！</div>
                  <p>{resetResult}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">请复制上方新密码提供给该用户登录。</p>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={props.onClose}
                      className="
                        rounded-lg bg-primary px-4 py-1.5 font-medium
                        text-primary-foreground
                      "
                    >
                      完成
                    </button>
                  </div>
                </div>
              )
            : (
                <>
                  <p className="text-muted-foreground">
                    重置用户「
                    <strong>{user.nickname}</strong>
                    」的登录密码。
                    重置后该用户已登录的所有设备将强制失效掉线。
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <label className="font-medium text-foreground">自定义新密码 (留空则随机生成)</label>
                    <input
                      type="text"
                      value={customPwd}
                      onChange={e => setCustomPwd(e.target.value)}
                      placeholder="留空自动生成 12 位高强密码"
                      className="
                        h-9 w-full rounded-lg border border-input bg-background
                        px-3 font-mono text-xs
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
                        rounded-lg bg-amber-600 px-4 py-2 font-medium text-white
                        hover:bg-amber-700
                        disabled:opacity-50
                      "
                    >
                      {pending ? '重置中…' : '确认重置密码'}
                    </button>
                  </div>
                </>
              )}
        </div>
      </div>
    </div>
  );
};
