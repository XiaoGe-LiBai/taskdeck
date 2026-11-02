'use client';

import type { AutomationGroup, AutomationOverview, AutomationTask, ParamDef } from './actions/automation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAutomationAction,
  getAutomationParamsAction,
  saveAutomationParamsAction,
  toggleAutomationTaskAction,
} from './actions/automation';
import { Card, Empty, Tag } from './Ui';

/**
 * 自动化任务：按「秒杀抢券 / 日常任务 / 资产与提醒」三组折叠展示。
 *
 * 分组默认第一个展开、其余收起，避免一屏铺开十几张卡片。
 * 只有带 `param_defs` 的任务才出现「参数」——脚本任务的参数在青龙脚本里写死，
 * 给个存了不生效的表单比不给更糟。
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
  onOpenParams: (task: AutomationTask) => void;
}) => {
  const enabled = props.task.enabled_account_ids.includes(props.activeAccountId);
  const allOn = props.task.account_count > 0
    && props.task.enabled_count === props.task.account_count;
  const hasParams = props.task.param_defs.length > 0;

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
            <Tag tone="gray">{props.task.executor === 'script' ? '脚本' : '内置'}</Tag>
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

      {hasParams && (
        <button
          type="button"
          onClick={() => props.onOpenParams(props.task)}
          className="
            self-start rounded-md border px-2 py-1 text-xs
            hover:bg-muted
          "
        >
          参数
        </button>
      )}

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
                title={on
                  ? `${account.nickname || account.account_info}：已开启`
                  : `${account.nickname || account.account_info}：已关闭`}
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

/** 参数弹窗：字段完全由后端的 param_defs 决定，前端不硬编码任何任务参数。 */
const ParamDialog = (props: {
  task: AutomationTask;
  accountId: number;
  accountName: string;
  onClose: () => void;
  onSaved: (text: string) => void;
}) => {
  const [defs, setDefs] = useState<ParamDef[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await getAutomationParamsAction(props.accountId, props.task.key);
      if (!alive) {
        return;
      }
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDefs(result.defs);
      setValues(Object.fromEntries(
        result.defs.map(item => [item.key, String(result.params[item.key] ?? item.def ?? '')]),
      ));
    })();
    return () => {
      alive = false;
    };
  }, [props.accountId, props.task.key]);

  const save = async () => {
    setSaving(true);
    setError('');
    const payload: Record<string, string | number> = {};
    for (const def of defs) {
      const raw = values[def.key] ?? '';
      payload[def.key] = def.type === 'int' ? Number(raw) : raw;
    }
    const result = await saveAutomationParamsAction(props.accountId, props.task.key, payload);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    props.onSaved(`${props.task.label} 参数已保存`);
    props.onClose();
  };

  return (
    <div className="
      fixed inset-0 z-50 flex items-start justify-center overflow-y-auto
      bg-black/40 p-4 backdrop-blur-sm
    "
    >
      <div className="mt-10 w-full max-w-xl rounded-lg border bg-card shadow-xl">
        <div className="
          flex items-start justify-between gap-4 border-b px-5 py-4
        "
        >
          <div>
            <h2 className="text-base font-semibold">
              配置任务参数 ·
              {props.task.label}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              仅对账号「
              {props.accountName}
              」生效，不同账号可以各自设置
            </p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="
              rounded-md border px-2 py-1 text-xs text-muted-foreground
              hover:bg-muted
            "
          >
            关闭
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
            <span className="text-muted-foreground">任务说明：</span>
            {props.task.tip}
            <div className="mt-1 text-muted-foreground">
              触发时间：
              {props.task.time_label}
            </div>
          </div>

          {loading && <div className="text-xs text-muted-foreground">读取中…</div>}
          {error && (
            <div className="
              rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2
              text-xs text-rose-700
              dark:border-rose-400/30 dark:bg-rose-400/15 dark:text-rose-300
            "
            >
              {error}
            </div>
          )}

          {!loading && defs.map((def) => {
            const id = `param-${def.key}`;
            return (
              <label
                key={def.key}
                htmlFor={id}
                className="flex flex-col gap-1 text-sm"
              >
                <span className="font-medium">{def.label}</span>
                {def.type === 'select'
                  ? (
                      <select
                        id={id}
                        value={values[def.key] ?? ''}
                        onChange={event => setValues(prev => ({ ...prev, [def.key]: event.target.value }))}
                        className="
                          h-9 rounded-md border bg-background px-2 text-sm
                        "
                      >
                        {(def.options ?? []).map(option => (
                          <option key={String(option.value)} value={String(option.value)}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    )
                  : (
                      <input
                        id={id}
                        type={def.type === 'int' ? 'number' : 'text'}
                        min={def.min}
                        max={def.max}
                        value={values[def.key] ?? ''}
                        onChange={event => setValues(prev => ({ ...prev, [def.key]: event.target.value }))}
                        className="
                          h-9 rounded-md border bg-background px-2 text-sm
                        "
                      />
                    )}
                {def.hint && <span className="text-xs text-muted-foreground">{def.hint}</span>}
              </label>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={props.onClose}
            className="
              rounded-md border px-3 py-1.5 text-xs
              hover:bg-muted
            "
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading}
            className="
              rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-medium
              text-white shadow-sm
              disabled:opacity-50
            "
          >
            {saving ? '保存中…' : '保存参数'}
          </button>
        </div>
      </div>
    </div>
  );
};

const GroupSection = (props: {
  group: AutomationGroup;
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
  activeAccountId: number;
  pending: string;
  defaultOpen: boolean;
  onToggle: (task: AutomationTask, enabled: boolean) => Promise<void>;
  onOpenParams: (task: AutomationTask) => void;
}) => {
  const [open, setOpen] = useState(props.defaultOpen);
  const enabledCount = props.group.tasks.filter(
    task => task.enabled_account_ids.includes(props.activeAccountId),
  ).length;

  return (
    <section className="rounded-lg border bg-card brand-shadow">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="
          flex w-full items-center justify-between gap-3 px-4 py-3 text-left
          hover:bg-muted/30
        "
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold">{props.group.label}</span>
          <span className="text-xs text-muted-foreground">{`${props.group.tasks.length} 项`}</span>
          <span className="
            rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground
          "
          >
            当前账号
            {' '}
            {enabledCount}
            {' '}
            /
            {props.group.tasks.length}
          </span>
        </div>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="
            hidden
            sm:inline
          "
          >
            {props.group.hint}
          </span>
          <span aria-hidden>{open ? '收起 ▴' : '展开 ▾'}</span>
        </span>
      </button>

      {open && (
        <div className="
          grid gap-3 border-t p-4
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
              onOpenParams={props.onOpenParams}
            />
          ))}
        </div>
      )}
    </section>
  );
};

export const XiaocanAutomation = (props: {
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
}) => {
  const [data, setData] = useState<AutomationOverview | null>(null);
  const [activeId, setActiveId] = useState(props.accounts[0]?.id ?? 0);
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<AutomationTask | null>(null);

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
    setMessage({
      ok: true,
      text: `${task.label} 已在「${accountLabel(accounts, accountId)}」上${enabled ? '开启' : '关闭'}`,
    });
  };

  const groups = data?.groups ?? [];
  const totals = useMemo(() => groups.map(group => ({
    key: group.key,
    label: group.label,
    enabled: group.tasks.filter(task => task.enabled_account_ids.includes(activeAccountId)).length,
    total: group.tasks.length,
  })), [groups, activeAccountId]);

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
        description="多账号独立开关；脚本任务交给青龙按 cron 跑，内置任务由本服务按时段执行"
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

      {groups.map((group, index) => (
        <GroupSection
          key={group.key}
          group={group}
          accounts={accounts}
          activeAccountId={activeAccountId}
          pending={pending}
          defaultOpen={index === 0}
          onToggle={toggle}
          onOpenParams={setEditing}
        />
      ))}

      {editing && activeAccountId > 0 && (
        <ParamDialog
          task={editing}
          accountId={activeAccountId}
          accountName={accountLabel(accounts, activeAccountId)}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setMessage({ ok: true, text });
            void load();
          }}
        />
      )}
    </div>
  );
};
