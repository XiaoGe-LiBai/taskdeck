'use client';

import type { PanelUserRow } from '@/types/Panel';
import { fen } from '@/features/panel/Ui';
import { getAvatarBg } from '../avatar';

/** 「更多操作」面板需要打开的各个弹窗/抽屉的回调集合（避免十几个平铺 props）。 */
export type MoreActionsHandlers = {
  onOpenDrawer: (id: number) => void;
  onOpenPoints: (user: PanelUserRow) => void;
  onOpenSlots: (user: PanelUserRow) => void;
  onOpenTransactions: (user: PanelUserRow) => void;
  onOpenMembership: (user: PanelUserRow) => void;
  onOpenRename: (user: PanelUserRow) => void;
  onOpenRemark: (user: PanelUserRow) => void;
  onOpenResetPassword: (user: PanelUserRow) => void;
  onOpenRole: (user: PanelUserRow) => void;
  onOpenStatus: (user: PanelUserRow) => void;
  onOpenKick: (user: PanelUserRow) => void;
  onOpenDelete: (user: PanelUserRow) => void;
  onOpenGrant: (user: PanelUserRow) => void;
};

/**
 * 15. 更多操作面板：表格里「操作 ▾」打开的入口中枢。
 *
 * 它自己不做任何写操作，只负责把用户转发给对应的弹窗 —— 所以这里只有回调，没有状态。
 * 点任意一项都是「先让父组件打开目标弹窗，再关掉自己」。
 */
export const MoreActionsDialog = (props: {
  user: PanelUserRow;
  onClose: () => void;
  actions: MoreActionsHandlers;
}) => {
  const { user, onClose, actions } = props;

  /** 统一入口：先开目标弹窗，再收起本面板 */
  const open = (fn: (u: PanelUserRow) => void) => () => {
    fn(user);
    onClose();
  };

  const sectionLabel = 'mb-2 text-[10px] font-medium tracking-wider text-muted-foreground uppercase';
  const tileClass = `
    flex items-center gap-2 rounded-lg border p-3 text-left
    transition-colors
    hover:border-primary/30 hover:bg-primary/5
  `;

  return (
    <div className="
      fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4
      backdrop-blur-xs
    "
    >
      <div className="w-full max-w-md rounded-xl border bg-card shadow-xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className={`
              flex size-8 items-center justify-center rounded-full border
              text-xs font-semibold
              ${getAvatarBg(user.nickname || user.email)}
            `}
            >
              {(user.nickname || user.email || 'U').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {user.nickname}
              </h3>
              <p className="text-[10px] text-muted-foreground">
                #
                {user.id}
                {' '}
                ·
                {user.email}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="
              rounded-lg p-1.5 text-muted-foreground
              hover:bg-muted hover:text-foreground
            "
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5 text-xs">
          {/* ── 快捷入口 ── */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                actions.onOpenDrawer(user.id);
                onClose();
              }}
              className="
                flex items-center justify-center gap-2 rounded-lg border
                border-primary/20 bg-primary/5 p-3 transition-colors
                hover:border-primary/40 hover:bg-primary/10
              "
            >
              <span className="text-lg">👤</span>
              <div>
                <div className="font-medium text-primary">360° 用户画像</div>
                <div className="text-[10px] text-muted-foreground">
                  全景数据 · 资产 · 登录审计
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={open(actions.onOpenGrant)}
              className="
                flex items-center justify-center gap-2 rounded-lg border
                border-amber-500/20 bg-amber-500/5 p-3 transition-colors
                hover:border-amber-500/40 hover:bg-amber-500/10
              "
            >
              <span className="text-lg">🎁</span>
              <div>
                <div className="font-medium text-amber-600">赠送权益</div>
                <div className="text-[10px] text-muted-foreground">
                  车位 · 会员天数 · 等级
                </div>
              </div>
            </button>
          </div>

          {/* ── 资产管理 ── */}
          <div>
            <div className={sectionLabel}>
              资产管理
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={open(actions.onOpenPoints)}
                className={tileClass}
              >
                <span className="text-lg">💰</span>
                <div>
                  <div className="font-medium text-foreground">调整余额</div>
                  <div className="text-[10px] text-muted-foreground">
                    余额
                    {' '}
                    {fen(user.points_balance)}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={open(actions.onOpenSlots)}
                className={tileClass}
              >
                <span className="text-lg">🅿️</span>
                <div>
                  <div className="font-medium text-foreground">调整车位</div>
                  <div className="text-[10px] text-muted-foreground">
                    {user.slot_used ?? 0}
                    /
                    {user.slot_total ?? 0}
                    {' '}
                    已用/总量
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={open(actions.onOpenTransactions)}
                className={tileClass}
              >
                <span className="text-lg">📋</span>
                <div>
                  <div className="font-medium text-foreground">收支明细</div>
                  <div className="text-[10px] text-muted-foreground">
                    消耗
                    {' '}
                    {fen(user.points_spent)}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={open(actions.onOpenMembership)}
                className={tileClass}
              >
                <span className="text-lg">👑</span>
                <div>
                  <div className="font-medium text-foreground">调整会员</div>
                  <div className="text-[10px] text-muted-foreground">
                    {(user.vip_level_effective ?? 0) > 0
                      ? (user.vip_level_name ?? '会员')
                      : ((user.vip_level ?? 0) > 0 && user.vip_expire ? '会员已过期' : '普通会员')}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* ── 基本信息 ── */}
          <div>
            <div className={sectionLabel}>
              基本信息
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={open(actions.onOpenRename)}
                className={tileClass}
              >
                <span className="text-lg">✏️</span>
                <div>
                  <div className="font-medium text-foreground">修改昵称</div>
                  <div className="
                    max-w-24 truncate text-[10px] text-muted-foreground
                  "
                  >
                    {user.nickname}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={open(actions.onOpenRemark)}
                className={tileClass}
              >
                <span className="text-lg">📝</span>
                <div>
                  <div className="font-medium text-foreground">修改备注</div>
                  <div className="
                    max-w-24 truncate text-[10px] text-muted-foreground
                  "
                  >
                    {user.remark || '无备注'}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* ── 安全风控 ── */}
          <div>
            <div className={sectionLabel}>
              安全风控
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={open(actions.onOpenResetPassword)}
                className="
                  flex items-center gap-2 rounded-lg border p-3 text-left
                  transition-colors
                  hover:border-amber-500/30 hover:bg-amber-500/5
                "
              >
                <span className="text-lg">🔑</span>
                <div>
                  <div className="font-medium text-amber-600">重置密码</div>
                  <div className="text-[10px] text-muted-foreground">生成新密码</div>
                </div>
              </button>
              <button
                type="button"
                onClick={open(actions.onOpenRole)}
                className={tileClass}
              >
                <span className="text-lg">
                  {user.role === 'admin' ? '👤' : '⭐'}
                </span>
                <div>
                  <div className="font-medium text-foreground">
                    {user.role === 'admin' ? '降为用户' : '设管理员'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    当前:
                    {' '}
                    {user.role === 'admin' ? '管理员' : '用户'}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={open(actions.onOpenStatus)}
                className={`
                  flex items-center gap-2 rounded-lg border p-3 text-left
                  transition-colors
                  ${user.status === 'normal'
      ? 'hover:border-rose-500/30 hover:bg-rose-500/5'
      : `hover:border-emerald-500/30 hover:bg-emerald-500/5`}
                `}
              >
                <span className="text-lg">
                  {user.status === 'normal' ? '🚫' : '✅'}
                </span>
                <div>
                  <div className={`
                    font-medium
                    ${user.status === 'normal'
      ? 'text-rose-600'
      : `text-emerald-600`}
                  `}
                  >
                    {user.status === 'normal' ? '冻结账号' : '解冻账号'}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    当前:
                    {' '}
                    {user.status === 'normal' ? '正常' : '已冻结'}
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={open(actions.onOpenKick)}
                className="
                  flex items-center gap-2 rounded-lg border p-3 text-left
                  transition-colors
                  hover:border-orange-500/30 hover:bg-orange-500/5
                "
              >
                <span className="text-lg">⚡</span>
                <div>
                  <div className="font-medium text-orange-600">强制下线</div>
                  <div className="text-[10px] text-muted-foreground">注销所有设备</div>
                </div>
              </button>
            </div>
          </div>

          {/* ── 危险操作 ── */}
          <div className="border-t pt-3">
            <button
              type="button"
              onClick={open(actions.onOpenDelete)}
              className="
                flex w-full items-center gap-2 rounded-lg border
                border-rose-500/20 p-3 text-left transition-colors
                hover:border-rose-500/40 hover:bg-rose-500/5
              "
            >
              <span className="text-lg">🗑️</span>
              <div>
                <div className="font-medium text-rose-600">删除用户</div>
                <div className="text-[10px] text-muted-foreground">
                  彻底删除该用户及关联资产，不可恢复
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
