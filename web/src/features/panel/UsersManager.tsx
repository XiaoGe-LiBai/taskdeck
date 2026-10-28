'use client';

import type { PanelList, PanelUserRow } from '@/types/Panel';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { batchUsersAction } from '@/features/panel/actions';
import { Empty, fen, fmtTime, Pager, Tag } from '@/features/panel/Ui';
import { UserDetailDrawer } from './UserDetailDrawer';
import { getAvatarBg } from './users/avatar';
import { BatchInputDialog } from './users/dialogs/BatchInputDialog';
import {
  DeleteConfirmDialog,
  KickConfirmDialog,
  RoleConfirmDialog,
  StatusConfirmDialog,
} from './users/dialogs/ConfirmDialogs';
import { CreateUserDialog } from './users/dialogs/CreateUserDialog';
import { GrantBenefitsDialog } from './users/dialogs/GrantBenefitsDialog';
import { MembershipDialog } from './users/dialogs/MembershipDialog';
import { MoreActionsDialog } from './users/dialogs/MoreActionsDialog';
import { PointsDialog } from './users/dialogs/PointsDialog';
import { RemarkDialog } from './users/dialogs/RemarkDialog';
import { RenameDialog } from './users/dialogs/RenameDialog';
import { ResetPasswordDialog } from './users/dialogs/ResetPasswordDialog';
import { SlotsDialog } from './users/dialogs/SlotsDialog';
import { TransactionsDialog } from './users/dialogs/TransactionsDialog';
import { UsersBatchBar } from './users/UsersBatchBar';
import { UserStatsBar } from './users/UserStatsBar';
import { UserToolbar } from './users/UserToolbar';

type Props = {
  data: PanelList<PanelUserRow> | null;
  query: {
    page?: string;
    size?: string;
    q?: string;
    role?: string;
    status?: string;
  };
};

/**
 * 用户全景管理（管理端）。
 *
 * 文件职责只保留三件事：**筛选/分页状态、勾选状态、把各弹窗编排在一起**。
 * 具体弹窗与表格区块都在 ./users/ 下：
 *   users/UserStatsBar.tsx      顶部指标卡 + 操作结果通知条
 *   users/UserToolbar.tsx       搜索 / 角色·状态筛选 / 新建入口
 *   users/UsersBatchBar.tsx     底部悬浮批量操作栏
 *   users/avatar.ts             头像确定性配色
 *   users/dialogs/*             各弹窗（自持内部状态，自己调 action）
 */
export const UsersManager = ({ data, query }: Props) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // 搜索和筛选的受控状态
  const [keyword, setKeyword] = useState(query.q ?? '');
  const [roleFilter, setRoleFilter] = useState(query.role ?? '');
  const [statusFilter, setStatusFilter] = useState(query.status ?? '');

  // 消息提示
  const [msg, setMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  // 多选选中的用户 ID 集合
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // 抽屉状态
  const [drawerUserId, setDrawerUserId] = useState<number | null>(null);

  // 「更多操作」面板当前指向的用户
  const [moreActionsUser, setMoreActionsUser] = useState<PanelUserRow | null>(null);

  // 各弹窗当前指向的用户（null = 关闭）。弹窗内部状态由弹窗自己持有。
  const [createOpen, setCreateOpen] = useState(false);
  const [pointsUser, setPointsUser] = useState<PanelUserRow | null>(null);
  const [slotsUser, setSlotsUser] = useState<PanelUserRow | null>(null);
  const [renameUser, setRenameUser] = useState<PanelUserRow | null>(null);
  const [remarkUser, setRemarkUser] = useState<PanelUserRow | null>(null);
  const [resetPwdUser, setResetPwdUser] = useState<PanelUserRow | null>(null);
  const [roleUser, setRoleUser] = useState<PanelUserRow | null>(null);
  const [statusUser, setStatusUser] = useState<PanelUserRow | null>(null);
  const [kickUser, setKickUser] = useState<PanelUserRow | null>(null);
  const [deleteUser, setDeleteUser] = useState<PanelUserRow | null>(null);
  const [txUser, setTxUser] = useState<PanelUserRow | null>(null);
  const [grantUser, setGrantUser] = useState<PanelUserRow | null>(null);
  const [membershipUser, setMembershipUser] = useState<PanelUserRow | null>(null);

  // 批量操作输入弹窗：adjust_points / adjust_slots 需要额外填数值
  const [batchActionType, setBatchActionType] = useState<'adjust_points' | 'adjust_slots' | null>(null);

  // 提交筛选查询
  const applyFilters = (newParams: { q?: string; role?: string; status?: string; page?: string }) => {
    const p = new URLSearchParams(searchParams.toString());
    const nextQ = newParams.q !== undefined ? newParams.q : keyword;
    const nextRole = newParams.role !== undefined ? newParams.role : roleFilter;
    const nextStatus = newParams.status !== undefined ? newParams.status : statusFilter;
    const nextPage = newParams.page !== undefined ? newParams.page : '1';

    if (nextQ.trim()) {
      p.set('q', nextQ.trim());
    } else {
      p.delete('q');
    }

    if (nextRole) {
      p.set('role', nextRole);
    } else {
      p.delete('role');
    }

    if (nextStatus) {
      p.set('status', nextStatus);
    } else {
      p.delete('status');
    }

    p.set('page', nextPage);
    router.push(`/dashboard/users?${p.toString()}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    applyFilters({ q: keyword });
  };

  const handleRoleChange = (role: string) => {
    setRoleFilter(role);
    applyFilters({ role });
  };

  const handleStatusChange = (status: string) => {
    setStatusFilter(status);
    applyFilters({ status });
  };

  const handleResetFilters = () => {
    setKeyword('');
    setRoleFilter('');
    setStatusFilter('');
    router.push('/dashboard/users');
  };

  // 全选/取消全选
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds((data?.records ?? []).map(r => r.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleSelect = (id: number) => {
    setSelectedIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  /** 批量操作：封禁/解封/踢下线立即执行；调积分/调车位先弹输入框 */
  const handleBatchAction = (
    action: 'ban' | 'unban' | 'adjust_points' | 'adjust_slots' | 'kick',
  ) => {
    if (!selectedIds.length) {
      setMsg({ type: 'error', text: '请先勾选需要操作的用户' });
      return;
    }
    if (action === 'adjust_points' || action === 'adjust_slots') {
      setBatchActionType(action);
      return;
    }

    startTransition(async () => {
      const res = await batchUsersAction(action, selectedIds);
      if (res.ok) {
        setMsg({ type: 'ok', text: res.msg });
        setSelectedIds([]);
        router.refresh();
      } else {
        setMsg({ type: 'error', text: res.msg });
      }
    });
  };

  const records = data?.records ?? [];
  const stats = data?.stats;

  const totalPoints = stats?.total_points ?? records.reduce((acc, r) => acc + (r.points_balance || 0), 0);
  const totalSpent = stats?.total_spent ?? records.reduce((acc, r) => acc + (r.points_spent || 0), 0);
  const isAllSelected = records.length > 0 && selectedIds.length === records.length;

  return (
    <div className="flex section-enter flex-col gap-5 pb-16">
      <UserStatsBar
        stats={stats}
        records={records}
        filteredTotal={data?.total ?? 0}
        totalPoints={totalPoints}
        totalSpent={totalSpent}
        msg={msg}
        onDismissMsg={() => setMsg(null)}
      />

      <UserToolbar
        keyword={keyword}
        onKeywordChange={setKeyword}
        roleFilter={roleFilter}
        statusFilter={statusFilter}
        onRoleChange={handleRoleChange}
        onStatusChange={handleStatusChange}
        onSearchSubmit={handleSearchSubmit}
        onResetFilters={handleResetFilters}
        onCreate={() => setCreateOpen(true)}
        filteredTotal={data?.total ?? 0}
        pending={pending}
      />

      {/* 用户数据主表格 */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {records.length > 0
          ? (
              <>
                <div className="overflow-x-auto">
                  <table className="
                    row-stagger w-full border-collapse text-left text-sm
                  "
                  >
                    <thead className="
                      border-b bg-muted/40 text-xs font-medium
                      text-muted-foreground
                    "
                    >
                      <tr>
                        <th className="w-10 px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isAllSelected}
                            onChange={e => handleSelectAll(e.target.checked)}
                            className="
                              size-4 cursor-pointer rounded-sm border-gray-300
                              text-primary
                            "
                          />
                        </th>
                        <th className="p-3">用户主体</th>
                        <th className="p-3">角色 / 会员</th>
                        <th className="p-3">车位 / 绑定</th>
                        <th className="p-3">积分收支</th>
                        <th className="p-3">注册 / 登录</th>
                        <th className="p-3">状态</th>
                        <th className="px-4 py-3 text-right">操作管理</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {records.map((user) => {
                        const avatarStyle = getAvatarBg(user.nickname || user.email);
                        const isBanned = user.status === 'banned';
                        const isSelected = selectedIds.includes(user.id);

                        return (
                          <tr
                            key={user.id}
                            className={`
                              transition-colors
                              hover:bg-muted/30
                              ${
                          isBanned ? 'bg-rose-500/5 text-muted-foreground' : ''
                          }
                              ${isSelected ? 'bg-primary/5' : ''}
                            `}
                          >
                            {/* 复选框 */}
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleSelect(user.id)}
                                className="
                                  size-4 cursor-pointer rounded-sm
                                  border-gray-300 text-primary
                                "
                              />
                            </td>

                            {/* 用户主体 */}
                            <td className="p-3">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`
                                    flex size-9 shrink-0 items-center
                                    justify-center rounded-full border text-xs
                                    font-semibold
                                    ${avatarStyle}
                                  `}
                                >
                                  {(user.nickname || user.email || 'U').slice(0, 1).toUpperCase()}
                                </div>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1.5">
                                    <span className="
                                      font-semibold text-foreground
                                    "
                                    >
                                      {user.nickname}
                                    </span>
                                    <span className="
                                      rounded-sm bg-muted px-1.5 py-0.5
                                      font-mono text-[10px]
                                      text-muted-foreground
                                    "
                                    >
                                      #
                                      {user.id}
                                    </span>
                                  </div>
                                  <span className="
                                    text-xs text-muted-foreground
                                  "
                                  >
                                    {user.email}
                                  </span>
                                  {user.remark && (
                                    <span
                                      className="
                                        max-w-xs truncate text-[11px]
                                        text-amber-600
                                        dark:text-amber-400
                                      "
                                      title="管理员备注（在「操作 → 修改备注」里填）"
                                    >
                                      📝 备注：
                                      {user.remark}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* 角色 / 会员等级 / 到期时间 */}
                            <td className="p-3">
                              <div className="flex flex-col items-start gap-1.5">
                                <div className="flex items-center gap-1.5">
                                  <Tag tone={user.role === 'admin' ? 'info' : 'gray'}>
                                    {user.role === 'admin' ? '管理员' : '用户'}
                                  </Tag>
                                </div>
                                {(user.vip_level_effective ?? 0) > 0
                                  ? (
                                      <div className="flex flex-col">
                                        <span
                                          className="
                                            inline-flex w-fit rounded-sm
                                            bg-amber-500/15 px-1.5 py-0.5
                                            text-[10px] font-bold text-amber-600
                                          "
                                          title="会员等级：决定车位、折扣、签到加成、邀请返利"
                                        >
                                          {user.vip_level_name ?? '会员'}
                                        </span>
                                        <span className="
                                          mt-0.5 text-[10px]
                                          text-muted-foreground
                                        "
                                        >
                                          {user.vip_expire ? fmtTime(user.vip_expire) : '永久'}
                                        </span>
                                      </div>
                                    )
                                  : (
                                      <span
                                        className="
                                          text-[10px] text-muted-foreground
                                        "
                                        title="会员等级：决定车位、折扣、签到加成、邀请返利"
                                      >
                                        {(user.vip_level ?? 0) > 0 && user.vip_expire
                                          ? '会员已过期'
                                          : '普通会员'}
                                      </span>
                                    )}
                              </div>
                            </td>

                            {/* 车位配额 / 绑定账号（合并列） */}
                            <td className="p-3">
                              <div className="flex flex-col gap-1.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="
                                    font-mono text-xs font-semibold
                                    text-foreground
                                  "
                                  >
                                    {user.slot_used ?? 0}
                                    /
                                    {user.slot_total ?? 0}
                                  </span>
                                  <span className="
                                    text-[10px] text-muted-foreground
                                  "
                                  >
                                    车位
                                  </span>
                                  {/* 车位使用率进度条 */}
                                  <div className="
                                    h-1 w-12 overflow-hidden rounded-full
                                    bg-muted
                                  "
                                  >
                                    <div
                                      className={`
                                        h-full rounded-full transition-all
                                        ${
                          (user.slot_total ?? 0) > 0 && (user.slot_used ?? 0) >= (user.slot_total ?? 0)
                            ? 'bg-rose-500'
                            : 'bg-emerald-500'
                          }
                                      `}
                                      style={{
                                        width: `${(user.slot_total ?? 0) > 0 ? Math.min(100, ((user.slot_used ?? 0) / (user.slot_total ?? 1)) * 100) : 0}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                                <span className="
                                  text-[10px] text-muted-foreground
                                "
                                >
                                  绑定
                                  {' '}
                                  {user.accounts ?? 0}
                                  {' '}
                                  个账号
                                </span>
                              </div>
                            </td>

                            {/* 积分收支（点击查收支明细） */}
                            <td className="p-3">
                              <div className="flex flex-col">
                                <button
                                  type="button"
                                  onClick={() => setTxUser(user)}
                                  className="group cursor-pointer text-left"
                                  title="点击查看收支明细"
                                >
                                  <span className="
                                    font-semibold text-emerald-600 tabular-nums
                                    group-hover:underline
                                    dark:text-emerald-400
                                  "
                                  >
                                    {fen(user.points_balance)}
                                  </span>
                                </button>
                                <span className="
                                  text-[11px] text-muted-foreground
                                "
                                >
                                  消耗
                                  {' '}
                                  {fen(user.points_spent)}
                                </span>
                              </div>
                            </td>

                            {/* 注册信息 / 登录动态（合并列） */}
                            <td className="p-3">
                              <div className="flex flex-col gap-1 text-xs">
                                <div className="flex items-center gap-1">
                                  <span className="
                                    text-[10px] text-muted-foreground
                                  "
                                  >
                                    注册:
                                  </span>
                                  <span className="
                                    font-mono text-[11px] text-foreground
                                  "
                                  >
                                    {fmtTime(user.created_time)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="
                                    font-mono text-[11px] text-foreground
                                  "
                                  >
                                    {user.last_login_ip || '未登录'}
                                  </span>
                                  {(user.same_ip_count ?? 0) > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => applyFilters({ q: user.last_login_ip })}
                                      title="点击筛选出共用该 IP 的所有账号"
                                      className="
                                        rounded-sm bg-amber-500/15 px-1 py-0.5
                                        text-[10px] font-medium text-amber-600
                                        hover:underline
                                      "
                                    >
                                      ⚠️同IP
                                      {' '}
                                      {user.same_ip_count}
                                    </button>
                                  )}
                                </div>
                                <span className="
                                  text-[10px] text-muted-foreground
                                "
                                >
                                  {fmtTime(user.last_login_time)}
                                </span>
                              </div>
                            </td>

                            {/* 账号状态 */}
                            <td className="p-3">
                              <Tag tone={user.status === 'normal' ? 'success' : 'danger'}>
                                <span className="flex items-center gap-1">
                                  <span
                                    className={`
                                      size-1.5 rounded-full
                                      ${
                          user.status === 'normal'
                            ? 'bg-emerald-500'
                            : `bg-rose-500`
                          }
                                    `}
                                  />
                                  {user.status === 'normal' ? '正常' : '已封禁'}
                                </span>
                              </Tag>
                            </td>

                            {/* 操作区 */}
                            <td className="px-4 py-3 text-right">
                              <div className="
                                inline-flex flex-wrap items-center justify-end
                                gap-1.5
                              "
                              >
                                {/* 操作面板 */}
                                <button
                                  type="button"
                                  onClick={() => setMoreActionsUser(user)}
                                  className="
                                    inline-flex items-center rounded-md border
                                    border-primary/30 bg-primary/10 px-2.5 py-1
                                    text-xs font-medium text-primary shadow-xs
                                    hover:bg-primary/20
                                  "
                                >
                                  操作 ▾
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 底部分页组件 */}
                <div className="border-t p-3">
                  <Pager
                    page={data?.page ?? 1}
                    size={data?.size ?? 10}
                    total={data?.total ?? 0}
                    basePath="/dashboard/users"
                    query={{
                      q: query.q,
                      role: query.role,
                      status: query.status,
                    }}
                  />
                </div>
              </>
            )
          : (
              <div className="py-12">
                <Empty text="没有匹配的用户数据，请尝试调整搜索或筛选条件" />
              </div>
            )}
      </div>

      {selectedIds.length > 0 && (
        <UsersBatchBar
          count={selectedIds.length}
          pending={pending}
          onAction={handleBatchAction}
          onClear={() => setSelectedIds([])}
        />
      )}

      {/* 360° 全景画像抽屉 */}
      <UserDetailDrawer
        userId={drawerUserId}
        onClose={() => setDrawerUserId(null)}
        onRefresh={() => router.refresh()}
      />

      {/* 「操作 ▾」中枢：只负责把用户转发给对应弹窗 */}
      {moreActionsUser && (
        <MoreActionsDialog
          user={moreActionsUser}
          onClose={() => setMoreActionsUser(null)}
          actions={{
            onOpenDrawer: setDrawerUserId,
            onOpenPoints: setPointsUser,
            onOpenSlots: setSlotsUser,
            onOpenTransactions: setTxUser,
            onOpenMembership: setMembershipUser,
            onOpenRename: setRenameUser,
            onOpenRemark: setRemarkUser,
            onOpenResetPassword: setResetPwdUser,
            onOpenRole: setRoleUser,
            onOpenStatus: setStatusUser,
            onOpenKick: setKickUser,
            onOpenDelete: setDeleteUser,
            onOpenGrant: setGrantUser,
          }}
        />
      )}

      {createOpen && (
        <CreateUserDialog onClose={() => setCreateOpen(false)} onDone={setMsg} />
      )}

      {pointsUser && (
        <PointsDialog user={pointsUser} onClose={() => setPointsUser(null)} onDone={setMsg} />
      )}

      {slotsUser && (
        <SlotsDialog user={slotsUser} onClose={() => setSlotsUser(null)} onDone={setMsg} />
      )}

      {renameUser && (
        <RenameDialog user={renameUser} onClose={() => setRenameUser(null)} onDone={setMsg} />
      )}

      {remarkUser && (
        <RemarkDialog user={remarkUser} onClose={() => setRemarkUser(null)} onDone={setMsg} />
      )}

      {resetPwdUser && (
        <ResetPasswordDialog
          user={resetPwdUser}
          onClose={() => setResetPwdUser(null)}
          onDone={setMsg}
        />
      )}

      {roleUser && (
        <RoleConfirmDialog user={roleUser} onClose={() => setRoleUser(null)} onDone={setMsg} />
      )}

      {statusUser && (
        <StatusConfirmDialog user={statusUser} onClose={() => setStatusUser(null)} onDone={setMsg} />
      )}

      {kickUser && (
        <KickConfirmDialog user={kickUser} onClose={() => setKickUser(null)} onDone={setMsg} />
      )}

      {deleteUser && (
        <DeleteConfirmDialog
          user={deleteUser}
          onClose={() => setDeleteUser(null)}
          onDone={setMsg}
          onDeleted={id => setSelectedIds(prev => prev.filter(x => x !== id))}
        />
      )}

      {txUser && (
        <TransactionsDialog user={txUser} onClose={() => setTxUser(null)} />
      )}

      {grantUser && (
        <GrantBenefitsDialog user={grantUser} onClose={() => setGrantUser(null)} onDone={setMsg} />
      )}

      {membershipUser && (
        <MembershipDialog
          user={membershipUser}
          onClose={() => setMembershipUser(null)}
          onDone={setMsg}
        />
      )}

      {batchActionType && (
        <BatchInputDialog
          actionType={batchActionType}
          selectedIds={selectedIds}
          onClose={() => setBatchActionType(null)}
          onDone={setMsg}
          onCleared={() => setSelectedIds([])}
        />
      )}
    </div>
  );
};
