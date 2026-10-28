'use client';

import type { PanelUserDetail } from '@/types/Panel';
import { useEffect, useState, useTransition } from 'react';
import {
  fetchUserDetailAction,
  grantUserProjectsAction,
  sendUserNotificationAction,
} from './actions';
import { fen, fmtTime, Tag } from './Ui';

type Props = {
  userId: number | null;
  onClose: () => void;
  onRefresh?: () => void;
};

export const UserDetailDrawer = ({ userId, onClose, onRefresh }: Props) => {
  const [detail, setDetail] = useState<PanelUserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'accounts' | 'yyb' | 'tasks' | 'logins' | 'grants' | 'notify'
  >('overview');

  // 项目授权状态
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [grantsPending, startGrantsTransition] = useTransition();

  // 消息通知状态
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyContent, setNotifyContent] = useState('');
  const [notifyEmail, setNotifyEmail] = useState(false);
  const [notifyPending, startNotifyTransition] = useTransition();

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!userId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setFeedback(null);
    fetchUserDetailAction(userId)
      .then((data) => {
        if (data) {
          setDetail(data);
          const granted = data.hidden_projects.filter(p => p.granted).map(p => p.id);
          setSelectedProjectIds(granted);
        }
      })
      .finally(() => {
        setLoading(false);
      });
  }, [userId]);

  if (!userId) {
    return null;
  }

  const handleToggleProject = (id: number) => {
    setSelectedProjectIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  const handleSaveGrants = () => {
    if (!userId) {
      return;
    }
    startGrantsTransition(async () => {
      const res = await grantUserProjectsAction(userId, selectedProjectIds);
      if (res.ok) {
        setFeedback({ type: 'ok', text: res.msg });
        if (onRefresh) {
          onRefresh();
        }
      } else {
        setFeedback({ type: 'error', text: res.msg });
      }
    });
  };

  const handleSendNotification = () => {
    if (!userId || !notifyTitle.trim()) {
      setFeedback({ type: 'error', text: '请填写通知标题' });
      return;
    }
    startNotifyTransition(async () => {
      const res = await sendUserNotificationAction(userId, notifyTitle, notifyContent, notifyEmail);
      if (res.ok) {
        setFeedback({ type: 'ok', text: res.msg });
        setNotifyTitle('');
        setNotifyContent('');
        // 刷新列表
        const updated = await fetchUserDetailAction(userId);
        if (updated) {
          setDetail(updated);
        }
      } else {
        setFeedback({ type: 'error', text: res.msg });
      }
    });
  };

  const u = detail?.user;

  return (
    <div className="
      fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4
      backdrop-blur-xs
    "
    >
      <div className="
        flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border bg-card
        shadow-2xl
      "
      >
        {/* 顶部标题栏 */}
        <div className="
          flex items-center justify-between border-b bg-muted/20 px-5 py-4
        "
        >
          <div className="flex items-center gap-3">
            <div className="
              flex size-10 items-center justify-center rounded-full
              bg-primary/10 font-bold text-primary
            "
            >
              {(u?.nickname || u?.email || 'U').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">
                  {u?.nickname || '用户详情'}
                </h2>
                <span className="font-mono text-xs text-muted-foreground">
                  #
                  {userId}
                </span>
                {u?.role === 'admin' && <Tag tone="info">管理员</Tag>}
                <Tag tone={u?.status === 'normal' ? 'success' : 'danger'}>
                  {u?.status === 'normal' ? '正常' : '封禁'}
                </Tag>
              </div>
              <p className="text-xs text-muted-foreground">{u?.email || '加载中…'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="
              rounded-lg p-2 text-muted-foreground
              hover:bg-muted hover:text-foreground
            "
          >
            ✕
          </button>
        </div>

        {/* 反馈提示 */}
        {feedback && (
          <div
            className={`
              mx-5 mt-3 flex items-center justify-between rounded-md border px-3
              py-2 text-xs
              ${
          feedback.type === 'ok'
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
            : 'border-rose-500/20 bg-rose-500/10 text-rose-600'
          }
            `}
          >
            <span>{feedback.text}</span>
            <button type="button" onClick={() => setFeedback(null)}>✕</button>
          </div>
        )}

        {/* 导航 Tab */}
        <div className="flex overflow-x-auto border-b px-5 text-xs font-medium">
          {[
            { id: 'overview', label: '资产画像' },
            { id: 'accounts', label: `小蚕账号 (${detail?.accounts.length ?? 0})` },
            { id: 'yyb', label: `应用宝微信号 (${detail?.yyb_accounts.length ?? 0})` },
            { id: 'tasks', label: `任务上车 (${detail?.submissions.length ?? 0})` },
            { id: 'logins', label: '登录审计' },
            { id: 'grants', label: '专属脚本' },
            { id: 'notify', label: '发送通知' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`
                border-b-2 p-3 whitespace-nowrap transition-colors
                ${
            activeTab === tab.id
              ? 'border-primary font-semibold text-primary'
              : `
                border-transparent text-muted-foreground
                hover:text-foreground
              `
            }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5 text-sm">
          {loading
            ? (
                <div className="py-20 text-center text-muted-foreground">正在加载用户 360° 数据画像…</div>
              )
            : !detail
                ? (
                    <div className="py-20 text-center text-muted-foreground">未能获取用户数据</div>
                  )
                : (
                    <>
                      {/* 1. 资产画像 */}
                      {activeTab === 'overview' && (
                        <div className="flex flex-col gap-4">
                          <div className="
                            grid grid-cols-2 gap-3
                            sm:grid-cols-4
                          "
                          >
                            <div className="rounded-lg border bg-muted/20 p-3">
                              <div className="text-xs text-muted-foreground">积分余额</div>
                              <div className="
                                mt-1 font-mono text-lg font-semibold
                                text-emerald-600
                              "
                              >
                                {fen(u?.points_balance || 0)}
                              </div>
                            </div>
                            <div className="rounded-lg border bg-muted/20 p-3">
                              <div className="text-xs text-muted-foreground">累计消耗积分</div>
                              <div className="
                                mt-1 font-mono text-lg font-semibold
                                text-foreground
                              "
                              >
                                {fen(u?.points_spent || 0)}
                              </div>
                            </div>
                            <div className="rounded-lg border bg-muted/20 p-3">
                              <div className="text-xs text-muted-foreground">会员等级/到期</div>
                              <div className="
                                mt-1 flex items-center gap-1 font-semibold
                                text-foreground
                              "
                              >
                                {(u?.vip_level_effective ?? 0) > 0
                                  ? (
                                      <span
                                        className="
                                          rounded-sm bg-amber-500/15 px-1 py-0.5
                                          text-xs font-bold text-amber-600
                                        "
                                        title="会员等级：决定车位、折扣、签到加成、邀请返利"
                                      >
                                        {u?.vip_level_name ?? '会员'}
                                      </span>
                                    )
                                  : (
                                      <span className="
                                        text-xs text-muted-foreground
                                      "
                                      >
                                        {(u?.vip_level ?? 0) > 0 && u?.vip_expire ? '会员已过期' : '普通会员'}
                                      </span>
                                    )}
                              </div>
                              <div className="
                                mt-0.5 truncate text-[10px]
                                text-muted-foreground
                              "
                              >
                                {u?.vip_expire ? fmtTime(u.vip_expire) : '未设到期'}
                              </div>
                            </div>
                            <div className="rounded-lg border bg-muted/20 p-3">
                              <div className="text-xs text-muted-foreground">车位配额</div>
                              <div className="
                                mt-1 font-mono text-lg font-semibold
                                text-foreground
                              "
                              >
                                {u?.slot_used ?? 0}
                                {' '}
                                /
                                {u?.slot_total ?? 0}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-lg border p-4">
                            <h3 className="
                              mb-3 text-xs font-semibold text-muted-foreground
                              uppercase
                            "
                            >
                              账户详细档案
                            </h3>
                            <div className="grid grid-cols-2 gap-y-2.5 text-xs">
                              <div>
                                <span className="text-muted-foreground">用户标识：</span>
                                <span className="font-mono text-foreground">
                                  UID #
                                  {u?.id}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">邀请码：</span>
                                <span className="font-mono text-foreground">{u?.invite_code || '无'}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">直推下级人数：</span>
                                <span className="font-semibold text-foreground">
                                  {detail.invite_stats.invites_count}
                                  {' '}
                                  人
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">上级推荐人：</span>
                                <span className="text-foreground">
                                  {detail.invite_stats.inviter
                                    ? `${detail.invite_stats.inviter.nickname} (#${detail.invite_stats.inviter.id})`
                                    : '无上级推荐人'}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">注册时间：</span>
                                <span className="font-mono text-foreground">{fmtTime(u?.created_time)}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">上次登录：</span>
                                <span className="font-mono text-foreground">{fmtTime(u?.last_login_time)}</span>
                              </div>
                              <div className="col-span-2">
                                <span className="text-muted-foreground">上次登录 IP：</span>
                                <span className="font-mono text-foreground">{u?.last_login_ip || '暂无'}</span>
                                {(u?.same_ip_count ?? 0) > 1 && (
                                  <span className="
                                    ml-2 rounded-sm bg-amber-500/10 px-1.5
                                    py-0.5 text-[10px] text-amber-600
                                  "
                                  >
                                    ⚠️ 同 IP 存在
                                    {' '}
                                    {u?.same_ip_count}
                                    {' '}
                                    个账号
                                  </span>
                                )}
                              </div>
                              <div className="col-span-2">
                                <span className="text-muted-foreground">管理员备注：</span>
                                <span className="text-foreground">{u?.remark || '无备注'}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 2. 小蚕账号列表 */}
                      {activeTab === 'accounts' && (
                        <div className="flex flex-col gap-3">
                          {detail.accounts.length === 0
                            ? (
                                <div className="
                                  py-12 text-center text-muted-foreground
                                "
                                >
                                  该用户暂未绑定任何小蚕账号
                                </div>
                              )
                            : (
                                detail.accounts.map(acc => (
                                  <div
                                    key={acc.id}
                                    className="
                                      rounded-lg border p-3 transition-colors
                                      hover:bg-muted/10
                                    "
                                  >
                                    <div className="
                                      flex items-center justify-between
                                    "
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className="
                                          font-semibold text-foreground
                                        "
                                        >
                                          {acc.nickname || '未命名账号'}
                                        </span>
                                        <span className="
                                          font-mono text-xs
                                          text-muted-foreground
                                        "
                                        >
                                          ID:
                                          {acc.id}
                                        </span>
                                        <Tag tone={acc.status === 'enabled' ? 'success' : 'warning'}>
                                          {acc.status === 'enabled' ? '正常运行' : '已暂停'}
                                        </Tag>
                                        {acc.vip_level > 0 && (
                                          <span className="
                                            rounded-sm bg-amber-500/15 px-1.5
                                            py-0.5 text-[10px] font-bold
                                            text-amber-600
                                          "
                                          >
                                            SVIP
                                            {' '}
                                            {acc.vip_level}
                                          </span>
                                        )}
                                      </div>
                                      <span className="
                                        text-xs text-muted-foreground
                                      "
                                      >
                                        到期:
                                        {' '}
                                        {acc.membership_expire ? fmtTime(acc.membership_expire) : '未激活'}
                                      </span>
                                    </div>
                                    <div className="
                                      mt-2 font-mono text-xs break-all
                                      text-muted-foreground
                                    "
                                    >
                                      silk_id:
                                      {' '}
                                      {acc.account_info || '无'}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                      {Object.entries(acc.features).map(([fName, enabled]) => (
                                        <span
                                          key={fName}
                                          className={`
                                            rounded-sm px-1.5 py-0.5 text-[10px]
                                            ${
                                        enabled
                                          ? `
                                            bg-emerald-500/10 font-medium
                                            text-emerald-600
                                          `
                                          : `
                                            bg-muted text-muted-foreground
                                            line-through opacity-60
                                          `
                                        }
                                          `}
                                        >
                                          {fName}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                ))
                              )}
                        </div>
                      )}

                      {/* 3. 应用宝微信号列表 */}
                      {activeTab === 'yyb' && (
                        <div className="flex flex-col gap-3">
                          {detail.yyb_accounts.length === 0
                            ? (
                                <div className="
                                  py-12 text-center text-muted-foreground
                                "
                                >
                                  该用户暂未绑定任何应用宝微信号
                                </div>
                              )
                            : (
                                detail.yyb_accounts.map(yyb => (
                                  <div
                                    key={yyb.id}
                                    className="
                                      flex items-center justify-between
                                      rounded-lg border p-3
                                    "
                                  >
                                    <div>
                                      <div className="
                                        font-semibold text-foreground
                                      "
                                      >
                                        {yyb.label || yyb.ref}
                                      </div>
                                      <div className="
                                        font-mono text-xs text-muted-foreground
                                      "
                                      >
                                        标识:
                                        {' '}
                                        {yyb.ref}
                                        {' '}
                                        · 实例:
                                        {' '}
                                        {yyb.endpoint_name || `#${yyb.endpoint_id}`}
                                      </div>
                                    </div>
                                    <span className="
                                      font-mono text-xs text-muted-foreground
                                    "
                                    >
                                      {fmtTime(yyb.created_time)}
                                    </span>
                                  </div>
                                ))
                              )}
                        </div>
                      )}

                      {/* 4. 任务提交记录 */}
                      {activeTab === 'tasks' && (
                        <div className="flex flex-col gap-2">
                          {detail.submissions.length === 0
                            ? (
                                <div className="
                                  py-12 text-center text-muted-foreground
                                "
                                >
                                  暂无自定义脚本任务提交记录
                                </div>
                              )
                            : (
                                detail.submissions.map(sub => (
                                  <div
                                    key={sub.id}
                                    className="rounded-lg border p-3 text-xs"
                                  >
                                    <div className="
                                      flex items-center justify-between
                                    "
                                    >
                                      <span className="
                                        font-semibold text-foreground
                                      "
                                      >
                                        {sub.script_name}
                                      </span>
                                      <Tag tone={sub.status === 'success' ? 'success' : sub.status === 'failed' ? 'danger' : 'info'}>
                                        {sub.status}
                                      </Tag>
                                    </div>
                                    <div className="
                                      mt-1 flex justify-between
                                      text-muted-foreground
                                    "
                                    >
                                      <span>
                                        账号/参数:
                                        {sub.account || '-'}
                                      </span>
                                      <span className="font-mono text-amber-600">
                                        消耗
                                        {sub.points_cost}
                                        {' '}
                                        分
                                      </span>
                                    </div>
                                    {sub.result_msg && (
                                      <div className="
                                        mt-1 rounded-sm bg-muted/40 p-1.5
                                        font-mono text-[11px]
                                        text-muted-foreground
                                      "
                                      >
                                        {sub.result_msg}
                                      </div>
                                    )}
                                    <div className="
                                      mt-1 text-right font-mono text-[10px]
                                      text-muted-foreground
                                    "
                                    >
                                      {fmtTime(sub.created_time)}
                                    </div>
                                  </div>
                                ))
                              )}
                        </div>
                      )}

                      {/* 5. 登录审计 */}
                      {activeTab === 'logins' && (
                        <div className="flex flex-col gap-2">
                          {detail.login_logs.length === 0
                            ? (
                                <div className="
                                  py-12 text-center text-muted-foreground
                                "
                                >
                                  暂无登录记录
                                </div>
                              )
                            : (
                                detail.login_logs.map(log => (
                                  <div
                                    key={log.id}
                                    className="
                                      flex items-center justify-between
                                      rounded-lg border p-2.5 text-xs
                                    "
                                  >
                                    <div>
                                      <div className="font-mono text-foreground">{log.ip}</div>
                                      <div className="
                                        max-w-sm truncate text-[10px]
                                        text-muted-foreground
                                      "
                                      >
                                        {log.user_agent}
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <Tag tone={log.status === 'success' ? 'success' : 'danger'}>
                                        {log.status === 'success' ? '成功' : '失败'}
                                      </Tag>
                                      <div className="
                                        mt-0.5 font-mono text-[10px]
                                        text-muted-foreground
                                      "
                                      >
                                        {fmtTime(log.created_time)}
                                      </div>
                                    </div>
                                  </div>
                                ))
                              )}
                        </div>
                      )}

                      {/* 7. 隐藏专属项目授权 */}
                      {activeTab === 'grants' && (
                        <div className="flex flex-col gap-3">
                          <p className="text-xs text-muted-foreground">
                            勾选允许该用户访问并上车的隐藏专属脚本（默认非白名单用户看不到这些脚本）：
                          </p>
                          {detail.hidden_projects.length === 0
                            ? (
                                <div className="
                                  py-8 text-center text-muted-foreground
                                "
                                >
                                  当前暂无隐藏项目配置
                                </div>
                              )
                            : (
                                <div className="
                                  flex flex-col gap-2 rounded-lg border p-3
                                "
                                >
                                  {detail.hidden_projects.map((proj) => {
                                    const checked = selectedProjectIds.includes(proj.id);
                                    return (
                                      <label
                                        key={proj.id}
                                        className="
                                          flex cursor-pointer items-center
                                          justify-between rounded-sm p-2 text-xs
                                          hover:bg-muted/40
                                        "
                                      >
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => handleToggleProject(proj.id)}
                                            className="
                                              size-4 rounded-sm border-gray-300
                                              text-primary
                                            "
                                          />
                                          <span className="
                                            font-semibold text-foreground
                                          "
                                          >
                                            {proj.name}
                                          </span>
                                          <span className="
                                            font-mono text-[10px]
                                            text-muted-foreground
                                          "
                                          >
                                            (
                                            {proj.channel}
                                            )
                                          </span>
                                        </div>
                                        <span className="
                                          font-mono text-[10px]
                                          text-muted-foreground
                                        "
                                        >
                                          {proj.project_key}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                          <div className="flex justify-end pt-2">
                            <button
                              type="button"
                              onClick={handleSaveGrants}
                              disabled={grantsPending}
                              className="
                                rounded-lg bg-primary px-4 py-2 text-xs
                                font-medium text-primary-foreground shadow-xs
                                hover:bg-primary/90
                                disabled:opacity-50
                              "
                            >
                              {grantsPending ? '保存中…' : '保存专属项目授权'}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* 8. 发送定向通知 */}
                      {activeTab === 'notify' && (
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-col gap-1.5">
                            <label className="
                              text-xs font-medium text-foreground
                            "
                            >
                              通知标题
                            </label>
                            <input
                              type="text"
                              value={notifyTitle}
                              onChange={e => setNotifyTitle(e.target.value)}
                              placeholder="例如: 账号授权即将失效提醒"
                              className="
                                h-9 w-full rounded-lg border border-input
                                bg-background px-3 text-xs outline-hidden
                                focus:border-primary focus:ring-1
                                focus:ring-primary
                              "
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label className="
                              text-xs font-medium text-foreground
                            "
                            >
                              通知内容
                            </label>
                            <textarea
                              rows={4}
                              value={notifyContent}
                              onChange={e => setNotifyContent(e.target.value)}
                              placeholder="向该用户发送站内信或邮件通知的详细内容…"
                              className="
                                w-full rounded-lg border border-input
                                bg-background p-3 text-xs outline-hidden
                                focus:border-primary focus:ring-1
                                focus:ring-primary
                              "
                            />
                          </div>
                          <label className="
                            flex cursor-pointer items-center gap-2 text-xs
                            text-foreground
                          "
                          >
                            <input
                              type="checkbox"
                              checked={notifyEmail}
                              onChange={e => setNotifyEmail(e.target.checked)}
                              className="
                                size-4 rounded-sm border-gray-300 text-primary
                              "
                            />
                            <span>
                              同时发送邮件到该用户邮箱 (
                              {u?.email}
                              )
                            </span>
                          </label>
                          <div className="flex justify-end pt-2">
                            <button
                              type="button"
                              onClick={handleSendNotification}
                              disabled={notifyPending || !notifyTitle.trim()}
                              className="
                                rounded-lg bg-primary px-4 py-2 text-xs
                                font-medium text-primary-foreground shadow-xs
                                hover:bg-primary/90
                                disabled:opacity-50
                              "
                            >
                              {notifyPending ? '发送中…' : '立即发送通知'}
                            </button>
                          </div>

                          {/* 历史通知列表 */}
                          {detail.notifications.length > 0 && (
                            <div className="mt-4 border-t pt-3">
                              <h4 className="
                                mb-2 text-xs font-semibold text-muted-foreground
                              "
                              >
                                已发送历史通知
                              </h4>
                              <div className="flex flex-col gap-2">
                                {detail.notifications.map(n => (
                                  <div
                                    key={n.id}
                                    className="rounded-sm border p-2 text-xs"
                                  >
                                    <div className="
                                      flex justify-between font-medium
                                      text-foreground
                                    "
                                    >
                                      <span>{n.title}</span>
                                      <span className="
                                        font-mono text-[10px]
                                        text-muted-foreground
                                      "
                                      >
                                        {fmtTime(n.created_time)}
                                      </span>
                                    </div>
                                    {n.content && (
                                      <p className="
                                        mt-1 text-[11px] text-muted-foreground
                                      "
                                      >
                                        {n.content}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
        </div>
      </div>
    </div>
  );
};
