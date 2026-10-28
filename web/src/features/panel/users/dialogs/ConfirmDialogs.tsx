'use client';

import type { PanelUserRow } from '@/types/Panel';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import {
  deleteUserAction,
  kickUserAction,
  toggleUserRoleAction,
  toggleUserStatusAction,
} from '@/features/panel/actions';

/**
 * 四个「一问一答」型确认弹窗：切换角色 / 封禁解封 / 强制下线 / 删除用户。
 *
 * 它们没有输入项，所以状态只在弹窗内部（pending）；父组件只需给 user 与两个回调：
 *   onClose   关闭自己
 *   onDone    把结果文案回传给父组件的顶部通知条
 */

export type ConfirmDialogProps = {
  user: PanelUserRow;
  onClose: () => void;
  onDone: (msg: { type: 'ok' | 'error'; text: string }) => void;
};

/** 把 action 返回的 "ok:xxx" / "error:xxx" 转成通知条消息 */
function toMsg(res: string): { type: 'ok' | 'error'; text: string } {
  return res.startsWith('ok:')
    ? { type: 'ok', text: res.slice(3) }
    : { type: 'error', text: res.slice(6) };
}

/** 统一的遮罩 + 卡片外壳（与其余弹窗保持完全一致的类名） */
function Shell(props: {
  children: React.ReactNode;
  onClose: () => void;
  maxWidth?: 'sm' | 'md';
}) {
  return (
    <div className="
      fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4
      backdrop-blur-xs
    "
    >
      <div className={`
        w-full rounded-xl border bg-card p-6 shadow-xl
        ${props.maxWidth === 'md' ? 'max-w-md' : 'max-w-sm'}
      `}
      >
        {props.children}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- 7. 切换角色 */

export const RoleConfirmDialog = (props: ConfirmDialogProps) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { user } = props;

  const submit = () => {
    const nextRole = user.role === 'admin' ? 'user' : 'admin';
    const fd = new FormData();
    fd.set('user_id', String(user.id));
    fd.set('role', nextRole);

    startTransition(async () => {
      const res = await toggleUserRoleAction('', fd);
      if (res.startsWith('ok:')) {
        props.onDone(toMsg(res));
        props.onClose();
        router.refresh();
      } else {
        props.onDone(toMsg(res));
      }
    });
  };

  return (
    <Shell onClose={props.onClose}>
      <h3 className="text-base font-semibold text-foreground">确认权限变更</h3>
      <p className="mt-2 text-xs/relaxed text-muted-foreground">
        确认将用户「
        <strong className="text-foreground">{user.nickname}</strong>
        」
        {user.role === 'admin' ? '取消管理员权限，降为普通用户' : '设为管理员，授予后台管理权限'}
        ？
      </p>
      <div className="mt-5 flex items-center justify-end gap-2 border-t pt-3">
        <button
          type="button"
          onClick={props.onClose}
          className="
            rounded-lg border px-4 py-2 text-xs font-medium
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
            rounded-lg bg-primary px-4 py-2 text-xs font-medium
            text-primary-foreground
            hover:bg-primary/90
            disabled:opacity-50
          "
        >
          {pending ? '执行中…' : '确认变更'}
        </button>
      </div>
    </Shell>
  );
};

/* ---------------------------------------------------------------- 8. 封禁 / 解封 */

export const StatusConfirmDialog = (props: ConfirmDialogProps) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { user } = props;
  const isNormal = user.status === 'normal';

  const submit = () => {
    const fd = new FormData();
    fd.set('user_id', String(user.id));
    fd.set('status', isNormal ? 'banned' : 'normal');

    startTransition(async () => {
      const res = await toggleUserStatusAction('', fd);
      if (res.startsWith('ok:')) {
        props.onDone(toMsg(res));
        props.onClose();
        router.refresh();
      } else {
        props.onDone(toMsg(res));
      }
    });
  };

  return (
    <Shell onClose={props.onClose}>
      <h3 className="text-base font-semibold text-foreground">
        {isNormal ? '封禁账号警告' : '解除账号封禁'}
      </h3>
      <p className="mt-2 text-xs/relaxed text-muted-foreground">
        确认对用户「
        <strong className="text-foreground">{user.nickname}</strong>
        」执行
        <strong className={isNormal ? `text-rose-600` : `text-emerald-600`}>
          {isNormal ? '【封禁】' : '【解封】'}
        </strong>
        操作？
      </p>
      <div className="mt-5 flex items-center justify-end gap-2 border-t pt-3">
        <button
          type="button"
          onClick={props.onClose}
          className="
            rounded-lg border px-4 py-2 text-xs font-medium
            hover:bg-muted
          "
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={`
            rounded-lg px-4 py-2 text-xs font-medium text-white shadow-xs
            disabled:opacity-50
            ${
    isNormal
      ? `
        bg-rose-600
        hover:bg-rose-700
      `
      : `
        bg-emerald-600
        hover:bg-emerald-700
      `
    }
          `}
        >
          {pending ? '执行中…' : isNormal ? '确认封禁' : '确认解封'}
        </button>
      </div>
    </Shell>
  );
};

/* ---------------------------------------------------------------- 9. 强制下线 */

export const KickConfirmDialog = (props: ConfirmDialogProps) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { user } = props;

  const submit = () => {
    const fd = new FormData();
    fd.set('user_id', String(user.id));

    startTransition(async () => {
      const res = await kickUserAction('', fd);
      if (res.startsWith('ok:')) {
        props.onDone(toMsg(res));
        props.onClose();
        router.refresh();
      } else {
        props.onDone(toMsg(res));
      }
    });
  };

  return (
    <Shell onClose={props.onClose}>
      <h3 className="text-base font-semibold text-foreground">强制用户下线</h3>
      <p className="mt-2 text-xs/relaxed text-muted-foreground">
        确认将用户「
        <strong className="text-foreground">{user.nickname}</strong>
        」在所有设备上强制踢下线？其当前的登录凭证将立即失效。
      </p>
      <div className="mt-5 flex items-center justify-end gap-2 border-t pt-3">
        <button
          type="button"
          onClick={props.onClose}
          className="
            rounded-lg border px-4 py-2 text-xs font-medium
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
            rounded-lg bg-orange-600 px-4 py-2 text-xs font-medium text-white
            hover:bg-orange-700
            disabled:opacity-50
          "
        >
          {pending ? '执行中…' : '立即踢下线'}
        </button>
      </div>
    </Shell>
  );
};

/* ---------------------------------------------------------------- 10. 删除用户 */

export const DeleteConfirmDialog = (
  props: ConfirmDialogProps & { onDeleted?: (id: number) => void },
) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { user } = props;

  const submit = () => {
    const fd = new FormData();
    fd.set('user_id', String(user.id));

    startTransition(async () => {
      const res = await deleteUserAction('', fd);
      if (res.startsWith('ok:')) {
        props.onDone(toMsg(res));
        props.onClose();
        props.onDeleted?.(user.id);
        router.refresh();
      } else {
        props.onDone(toMsg(res));
      }
    });
  };

  return (
    <Shell onClose={props.onClose}>
      <h3 className="text-base font-semibold text-rose-600">彻底删除用户警告</h3>
      <p className="mt-2 text-xs/relaxed text-muted-foreground">
        此操作不可逆！确认永久删除用户「
        <strong className="text-foreground">{user.nickname}</strong>
        」(#
        {' '}
        {user.id}
        )？其下辖绑定的小蚕账号、任务记录、积分流水将被一并清理。
      </p>
      <div className="mt-5 flex items-center justify-end gap-2 border-t pt-3">
        <button
          type="button"
          onClick={props.onClose}
          className="
            rounded-lg border px-4 py-2 text-xs font-medium
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
            rounded-lg bg-rose-600 px-4 py-2 text-xs font-medium text-white
            hover:bg-rose-700
            disabled:opacity-50
          "
        >
          {pending ? '正在删除…' : '确认彻底删除'}
        </button>
      </div>
    </Shell>
  );
};
