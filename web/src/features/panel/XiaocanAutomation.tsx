'use client';

import type { AutomationGroup, AutomationOverview, AutomationTask } from './actions/automation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAutomationAction, toggleAutomationTaskAction } from './actions/automation';
import { Card, Empty, Tag } from './Ui';

/**
 * 自动化任务：按「秒杀抢券 / 日常任务 / 资产与提醒」三组卡片呈现。
 *
 * 每张卡片显示该任务在哪些账号上开着（x/y），并可直接对**当前账号**开关。
 * 开关是幂等设置而不是翻转，避免重复渲染后界面与后端不一致。
 *
 * 不提供「立即执行」按钮：脚本由青龙按 cron 跑，这里没有同步执行的通道，
 * 放一个点了不生效的按钮只会更糟。
 */
const accountLabel = (
  accounts: Array<{ id: number; nickname: string; account_info: string }>,
  id: number,
) => {
  const found = accounts.find(item => item.id === id);
  return found ? (found.nickname?.trim() || found.account_info) : '该账号';
};

/** 本地乐观更新：只动 enabled_account_ids 与计数，任务元数据不变。 */
const patchTask = (
  overview: AutomationOverview,
  taskKey: string,
  accountId: number,
  enabled: boolean,
): AutomationOverview => ({
  ...overview,
  groups: overview.groups.map(group => ({
    ...group,
    tasks: group.tasks.map((task) => {
      if (task.key !== taskKey) {
        return task;
      }
      const ids = new Set(task.enabled_account_ids);
      if (enabled) {
        ids.add(accountId);
      } else {
        ids.delete(accountId);
      }
      return { ...task, enabled_account_ids: [...ids], enabled_count: ids.size };
    }),
  })),
});

const TaskCard = (props: {
  task: AutomationTask;
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
  activeAccountId: number;
  pending: boolean;
  onToggle: (task: AutomationTask, enabled: boolean) => Promise<void>;
}) => {
  const enabled = props.task.enabled_account_ids.includes(props.activeAccountId);
  const allOn = props.task.account_count > 0
    && props.task.enabled_count === props.task.account_count;

  return (
    <article className="
      flex flex-col gap-3 rounded-lg border p-3.5 transition-colors
      hover:bg-muted/20
    "
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{props.task.label}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {props.task.vip && <Tag tone="warning">{props.task.vip}</Tag>}
            <Tag tone="info">{props.task.time_label}</Tag>
            {props.task.kind === 'reminder' && <Tag tone="gray">提醒</Tag>}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${props.task.label} 在当前账号的开关`}
          disabled={props.pending || !props.activeAccountId}
          onClick={() => void props.onToggle(props.task, !enabled)}
          className={`
            relative h-6 w-11 shrink-0 rounded-full border transition-colors
            disabled:opacity-50
            ${enabled
      ? 'border-emerald-500/40 bg-emerald-500'
      : `bg-muted-foreground/30`}
          `}
        >
          <span className={`
            absolute top-0.5 size-4.5 rounded-full bg-white shadow-sm
            transition-all
            ${enabled ? 'left-6' : 'left-0.5'}
          `}
          />
        </button>
      </header>

      <p className="text-xs/5 text-muted-foreground">{props.task.tip}</p>

      <div className="mt-auto rounded-md border bg-muted/30 px-2.5 py-2">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            账号启用 (
            {props.task.enabled_count}
            /
            {props.task.account_count}
            )
          </span>
          {allOn && (
            <span className="
              text-emerald-600
              dark:text-emerald-400
            "
            >
              全部开启
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {props.accounts.slice(0, 6).map((account) => {
            const on = props.task.enabled_account_ids.includes(account.id);
            return (
              <span
                key={account.id}
                title={on ? `${account.nickname || account.account_info}：已开启` : `${account.nickname || account.account_info}：已关闭`}
                className={`
                  rounded-sm px-1.5 py-0.5 text-[11px]
                  ${on
                ? `
                  bg-emerald-500/15 text-emerald-700
                  dark:text-emerald-300
                `
                : 'bg-muted text-muted-foreground'}
                  ${account.id === props.activeAccountId ? 'ring-1 ring-ring' : ''}
                `}
              >
                {(account.nickname?.trim() || account.account_info).slice(0, 6)}
              </span>
            );
          })}
          {props.accounts.length > 6 && (
            <span className="px-1 text-[11px] text-muted-foreground">
              +
              {props.accounts.length - 6}
            </span>
          )}
        </div>
      </div>
    </article>
  );
};
const GroupSection = (props: {
  group: AutomationGroup;
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
  activeAccountId: number;
  pending: string;
  onToggle: (task: AutomationTask, enabled: boolean) => Promise<void>;
}) => (
  <Card
    title={`${props.group.label}（${props.group.tasks.length}）`}
    description={props.group.hint}
  >
    <div className="
      grid gap-3
      sm:grid-cols-2
      xl:grid-cols-3
    "
    >
      {props.group.tasks.map(task => (
        <TaskCard
          key={task.key}
          task={task}
          accounts={props.accounts}
          activeAccountId={props.activeAccountId}
          pending={props.pending === task.key}
          onToggle={props.onToggle}
        />
      ))}
    </div>
  </Card>
);

export const XiaocanAutomation = (props: {
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
}) => {
  const [data, setData] = useState<AutomationOverview | null>(null);
  const [activeId, setActiveId] = useState(props.accounts[0]?.id ?? 0);
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const result = await fetchAutomationAction();
    if (!result.ok) {
      setMessage({ ok: false, text: result.error });
      return;
    }
    setData(result.data);
    const list = result.data.accounts;
    setActiveId(prev => (list.some(item => item.id === prev) ? prev : (list[0]?.id ?? 0)));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accounts = data?.accounts ?? props.accounts;

  const activeAccountId = accounts.some(item => item.id === activeId)
    ? activeId
    : (accounts[0]?.id ?? 0);

  /** 变更某个任务在某账号上的开关；乐观更新，失败回滚。 */
  const toggle = async (task: AutomationTask, enabled: boolean) => {
    const accountId = activeAccountId;
    if (!accountId) {
      return;
    }
    setPending(task.key);
    setMessage(null);
    setData(prev => prev && patchTask(prev, task.key, accountId, enabled));
    const result = await toggleAutomationTaskAction(accountId, task.key, enabled);
    setPending('');
    if (!result.ok) {
      setData(prev => prev && patchTask(prev, task.key, accountId, !enabled));
      setMessage({ ok: false, text: `${task.label}：${result.error}` });
      return;
    }
    setMessage({ ok: true, text: `${task.label} 已在「${accountLabel(accounts, accountId)}」上${enabled ? '开启' : '关闭'}` });
  };

  const groups = data?.groups ?? [];
  const totals = useMemo(() => {
    return groups.map(group => ({
      key: group.key,
      label: group.label,
      enabled: group.tasks.filter(task => task.enabled_account_ids.includes(activeAccountId)).length,
      total: group.tasks.length,
    }));
  }, [groups, activeAccountId]);

  if (!props.accounts.length && !data) {
    return (
      <Card title="自动化任务" description="绑定小蚕账号后可在这里逐项开关定时任务">
        <Empty text="还没有绑定小蚕账号" />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="自动化任务"
        description="多账号独立开关，定时任务在绑定成功后自动排期；改动即时生效"
        actions={(
          <label className="
            flex items-center gap-2 text-xs text-muted-foreground
          "
          >
            当前账号
            <select
              value={activeAccountId}
              onChange={event => setActiveId(Number(event.target.value))}
              className="
                h-8 rounded-md border bg-background px-2 text-sm text-foreground
              "
            >
              {accounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.nickname?.trim() || account.account_info}
                </option>
              ))}
            </select>
          </label>
        )}
      >
        <div className="
          grid gap-3
          sm:grid-cols-3
        "
        >
          {totals.map(item => (
            <div
              key={item.key}
              className="rounded-md border bg-muted/30 px-3 py-2"
            >
              <div className="text-xs text-muted-foreground">{item.label}</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">
                {item.enabled}
                {' '}
                /
                {item.total}
                {' '}
                项开启
              </div>
            </div>
          ))}
        </div>
        {message && (
          <div className={`
            mt-3 rounded-md border px-3 py-2 text-xs
            ${message.ok
            ? `
              border-emerald-500/20 bg-emerald-500/10 text-emerald-700
              dark:border-emerald-400/30 dark:bg-emerald-400/15
              dark:text-emerald-300
            `
            : `
              border-rose-500/20 bg-rose-500/10 text-rose-700
              dark:border-rose-400/30 dark:bg-rose-400/15 dark:text-rose-300
            `}
          `}
          >
            {message.text}
          </div>
        )}
      </Card>

      {groups.map(group => (
        <GroupSection
          key={group.key}
          group={group}
          accounts={accounts}
          activeAccountId={activeAccountId}
          pending={pending}
          onToggle={toggle}
        />
      ))}
    </div>
  );
};
