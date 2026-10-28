'use client';

import type { YybBindingAccount, YybBindingScript } from '@/types/Panel';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  yybSaveBindingsAction,
  yybSyncBindingsAction,
  yybToggleScriptVisibilityAction,
} from '@/features/panel/yybActions';
import { cn } from '@/utils/Helpers';

type Props = {
  scripts: YybBindingScript[];
  accounts: YybBindingAccount[];
};

const SOURCE_LABEL: Record<string, string> = {
  env: '青龙变量',
  task_before: '任务前缀',
  manual: '面板已改',
  none: '未配置',
};

/**
 * 「脚本 × 账号」绑定矩阵与前台可见性管理。
 *
 * - 矩阵行管理：勾选账号绑定，配置哪个账号跑哪个脚本。
 * - 失效脚本管理：支持将失效/下架脚本一键标记为「失效隐藏」，前台活动管理页面禁止展示，且青龙重新采集时不会覆盖此状态。
 * - 单脚本独立预览：精准预览单个脚本即将下发到青龙的环境变量或 task_before 命令（支持微信 OpenID 与账号 ID 双模切换）。
 */
export const BindingsMatrix = ({ scripts = [], accounts = [] }: Props) => {
  const [sel, setSel] = useState<Record<string, string[]>>(() =>
    Object.fromEntries((scripts ?? []).map(s => [s.script_key, [...(s.refs ?? [])]])),
  );
  const [hiddenMap, setHiddenMap] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((scripts ?? []).map(s => [s.script_key, Boolean(s.is_hidden)])),
  );

  const [msg, setMsg] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [search, setSearch] = useState('');
  const [pending, startTransition] = useTransition();
  const [collecting, setCollecting] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  // 单个脚本预览弹窗状态
  const [previewScript, setPreviewScript] = useState<YybBindingScript | null>(null);
  const [previewMode, setPreviewMode] = useState<'env' | 'task_before'>('env');
  const [identityMode, setIdentityMode] = useState<'openid' | 'id' | 'uin'>('openid');
  const [copied, setCopied] = useState(false);

  // ESC 键关闭预览弹窗
  useEffect(() => {
    if (!previewScript) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewScript(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewScript]);

  const handleCollect = async () => {
    setCollecting(true);
    setMsg('正在从青龙重新扫描采集任务…（已标记为失效隐藏的脚本状态将自动保留）');
    try {
      const res = await yybSyncBindingsAction();
      if (res.ok) {
        setMsg(res.msg);
        setTimeout(() => {
          window.location.reload();
        }, 1200);
      } else {
        setMsg(`采集失败：${res.msg}`);
      }
    } catch (e: any) {
      setMsg(`采集异常：${e?.message || e}`);
    } finally {
      setCollecting(false);
    }
  };

  const dirtyBindings = useMemo(
    () =>
      (scripts ?? []).filter((s) => {
        const before = [...(s.refs ?? [])].sort().join(',');
        const after = [...(sel[s.script_key] ?? [])].sort().join(',');
        return before !== after;
      }).length,
    [scripts, sel],
  );

  const dirtyHidden = useMemo(
    () =>
      (scripts ?? []).filter((s) => {
        const before = Boolean(s.is_hidden);
        const after = Boolean(hiddenMap[s.script_key]);
        return before !== after;
      }).length,
    [scripts, hiddenMap],
  );

  const dirty = dirtyBindings + dirtyHidden;

  const totalHiddenCount = useMemo(
    () => Object.values(hiddenMap).filter(Boolean).length,
    [hiddenMap],
  );

  const toggleAccount = (key: string, ref: string) => {
    setSel((prev) => {
      const cur = prev[key] ?? [];
      const next = cur.includes(ref) ? cur.filter(x => x !== ref) : [...cur, ref];
      return { ...prev, [key]: next };
    });
  };

  const selectAllAccounts = (key: string) => {
    setSel(prev => ({
      ...prev,
      [key]: accounts.map(a => a.ref),
    }));
  };

  const clearAllAccounts = (key: string) => {
    setSel(prev => ({
      ...prev,
      [key]: [],
    }));
  };

  // 即时切换某脚本的失效隐藏状态
  const handleToggleVisibility = async (scriptKey: string) => {
    const nextHidden = !hiddenMap[scriptKey];
    setTogglingKey(scriptKey);
    setHiddenMap(prev => ({ ...prev, [scriptKey]: nextHidden }));
    try {
      const res = await yybToggleScriptVisibilityAction(scriptKey, nextHidden);
      if (res.ok) {
        setMsg(`「${scriptKey}」${res.msg}`);
      } else {
        setMsg(`切换失败：${res.msg}`);
        setHiddenMap(prev => ({ ...prev, [scriptKey]: !nextHidden }));
      }
    } catch (e: any) {
      setMsg(`请求异常：${e?.message || e}`);
      setHiddenMap(prev => ({ ...prev, [scriptKey]: !nextHidden }));
    } finally {
      setTogglingKey(null);
    }
  };

  const save = () => {
    startTransition(async () => {
      const payload = (scripts ?? []).map(s => ({
        script_key: s.script_key,
        refs: sel[s.script_key] ?? [],
        is_hidden: hiddenMap[s.script_key] ? 1 : 0,
      }));
      const r = await yybSaveBindingsAction(payload);
      setMsg(r);
    });
  };

  // 过滤脚本列表
  const filteredScripts = useMemo(() => {
    return (scripts ?? []).filter((s) => {
      const isHidden = Boolean(hiddenMap[s.script_key]);
      if (statusFilter === 'visible' && isHidden) {
        return false;
      }
      if (statusFilter === 'hidden' && !isHidden) {
        return false;
      }
      if (!search.trim()) {
        return true;
      }
      const kw = search.trim().toLowerCase();
      return (
        s.name.toLowerCase().includes(kw)
        || s.script_key.toLowerCase().includes(kw)
        || s.env_name.toLowerCase().includes(kw)
        || s.app_id.toLowerCase().includes(kw)
      );
    });
  }, [scripts, hiddenMap, statusFilter, search]);

  // 计算单个脚本的下发预览文本（支持微信 OpenID、账号 ID、UIN 双模）
  const getSingleScriptPreviewCode = (
    script: YybBindingScript,
    targetMode: 'env' | 'task_before',
    targetIdentity: 'openid' | 'id' | 'uin',
  ) => {
    const refs = sel[script.script_key] ?? [];
    const envName = script.env_name || '未识别账号变量';
    const isHidden = Boolean(hiddenMap[script.script_key]);

    if (isHidden) {
      return '# ⚠️ 当前脚本已被设为失效隐藏\n# 下发时将自动跳过此任务，不会在青龙生成有效配置。';
    }

    if (refs.length === 0) {
      return '# 当前未勾选任何账号，下发时将清空该脚本的配置。';
    }

    const accountMap = new Map(accounts.map(a => [String(a.ref), a]));
    const selectedValues = refs.map((r) => {
      const acc = accountMap.get(String(r));
      if (!acc) {
        return r;
      }
      if (targetIdentity === 'openid' && acc.openid) {
        return acc.openid;
      }
      if (targetIdentity === 'uin' && acc.uin) {
        return String(acc.uin);
      }
      return String(acc.id ?? r);
    });

    if (script.is_yyb_server || envName === 'YYB_SERVER') {
      const serverBlock = selectedValues
        .map(val => `http://127.0.0.1:5844@${val}`)
        .join('\n');
      if (targetMode === 'env') {
        return `YYB_SERVER = \n${serverBlock}`;
      }
      return `export YYB_SERVER='${selectedValues.map(val => `http://127.0.0.1:5844@${val}`).join('\\n')}'`;
    }

    const value = selectedValues.join('&');
    if (targetMode === 'env') {
      return `${envName} = ${value}`;
    }
    return `export ${envName}='${value}'`;
  };

  const copyCode = (text: string) => {
    if (!navigator?.clipboard) {
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(setCopied, 2000, false);
    });
  };

  // 当前预览脚本勾选的账号对象列表
  const previewSelectedAccounts = useMemo(() => {
    if (!previewScript) {
      return [];
    }
    const refs = sel[previewScript.script_key] ?? [];
    const map = new Map(accounts.map(a => [String(a.ref), a]));
    return refs.map(r => map.get(String(r))).filter(Boolean) as YybBindingAccount[];
  }, [previewScript, sel, accounts]);

  return (
    <div className="flex flex-col gap-4">
      {/* 顶部宏观统计面板 */}
      <div className="
        grid grid-cols-2 gap-3
        sm:grid-cols-4
        lg:grid-cols-5
      "
      >
        <div className="rounded-lg border bg-card p-3 shadow-xs">
          <div className="text-xs text-muted-foreground">总活动脚本</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-bold tracking-tight text-foreground">
              {scripts.length}
            </span>
            <span className="text-[11px] text-muted-foreground">个</span>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-3 shadow-xs">
          <div className="text-xs text-muted-foreground">正常展示中</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="
              text-xl font-bold tracking-tight text-emerald-600
              dark:text-emerald-400
            "
            >
              {scripts.length - totalHiddenCount}
            </span>
            <span className="
              text-[11px] text-emerald-600/70
              dark:text-emerald-400/70
            "
            >
              前台可见
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-3 shadow-xs">
          <div className="text-xs text-muted-foreground">已失效隐藏</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={cn(
                'text-xl font-bold tracking-tight',
                totalHiddenCount > 0
                  ? `
                    text-rose-600
                    dark:text-rose-400
                  `
                  : 'text-muted-foreground',
              )}
            >
              {totalHiddenCount}
            </span>
            <span className="text-[11px] text-muted-foreground">已屏蔽</span>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-3 shadow-xs">
          <div className="text-xs text-muted-foreground">有效应用宝账号</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-bold tracking-tight text-foreground">
              {accounts.length}
            </span>
            <span className="text-[11px] text-muted-foreground">个</span>
          </div>
        </div>

        <div className="
          col-span-2 rounded-lg border bg-card p-3 shadow-xs
          sm:col-span-4
          lg:col-span-1
        "
        >
          <div className="text-xs text-muted-foreground">待保存改动</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={cn(
                'text-xl font-bold tracking-tight',
                dirty > 0
                  ? `
                    text-amber-600
                    dark:text-amber-400
                  `
                  : 'text-muted-foreground',
              )}
            >
              {dirty}
            </span>
            <span className="text-[11px] text-muted-foreground">项未落库</span>
          </div>
        </div>
      </div>

      {/* 操作与通知栏 */}
      {msg && (
        <div className="
          flex items-center justify-between rounded-md border border-blue-500/20
          bg-blue-500/10 px-3.5 py-2 text-xs text-blue-700
          dark:text-blue-300
        "
        >
          <div className="flex items-center gap-2">
            <span>ℹ️</span>
            <span>{msg}</span>
          </div>
          <button
            type="button"
            onClick={() => setMsg('')}
            className="
              rounded-sm px-1.5 py-0.5
              hover:bg-blue-500/20
            "
          >
            ✕
          </button>
        </div>
      )}

      {/* 工具操作与状态过滤条 */}
      <div className="
        flex flex-wrap items-center justify-between gap-3 rounded-lg border
        bg-card p-3 shadow-xs
      "
      >
        <div className="flex flex-wrap items-center gap-2">
          {/* 状态过滤切换 */}
          <div className="flex rounded-md border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={cn(
                'rounded-sm px-2.5 py-1 font-medium transition-colors',
                statusFilter === 'all'
                  ? 'bg-background text-foreground shadow-xs'
                  : `
                    text-muted-foreground
                    hover:text-foreground
                  `,
              )}
            >
              全部 (
              {scripts.length}
              )
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('visible')}
              className={cn(
                'rounded-sm px-2.5 py-1 font-medium transition-colors',
                statusFilter === 'visible'
                  ? `
                    bg-background text-emerald-600 shadow-xs
                    dark:text-emerald-400
                  `
                  : `
                    text-muted-foreground
                    hover:text-foreground
                  `,
              )}
            >
              正常展示 (
              {scripts.length - totalHiddenCount}
              )
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('hidden')}
              className={cn(
                'rounded-sm px-2.5 py-1 font-medium transition-colors',
                statusFilter === 'hidden'
                  ? `
                    bg-background text-rose-600 shadow-xs
                    dark:text-rose-400
                  `
                  : `
                    text-muted-foreground
                    hover:text-foreground
                  `,
              )}
            >
              已失效隐藏 (
              {totalHiddenCount}
              )
            </button>
          </div>

          {/* 快速搜索框 */}
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索脚本名称、变量名或 AppID…"
              className="
                w-56 rounded-md border border-input bg-background py-1.5 pr-7
                pl-3 text-xs outline-hidden
                focus:border-primary
                sm:w-72
              "
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="
                  absolute top-1/2 right-2 -translate-y-1/2 text-xs
                  text-muted-foreground
                  hover:text-foreground
                "
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* 右侧全局保存与从青龙同步按钮 */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={pending || dirty === 0}
            className="
              inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5
              py-1.5 text-xs font-medium text-primary-foreground shadow-xs
              transition-colors
              hover:bg-primary/90
              disabled:cursor-not-allowed disabled:opacity-50
            "
          >
            {pending
              ? '正在保存…'
              : dirty > 0
                ? `保存矩阵改动 (${dirty})`
                : '保存矩阵改动'}
          </button>
          <button
            type="button"
            onClick={handleCollect}
            disabled={collecting}
            className="
              inline-flex items-center gap-1.5 rounded-md border border-input
              bg-background px-3 py-1.5 text-xs font-medium transition-colors
              hover:bg-muted
              disabled:cursor-not-allowed disabled:opacity-50
            "
            title="从青龙重新采集任务，已失效隐藏的脚本状态将自动保留"
          >
            {collecting ? '采集同步中…' : '从青龙重新同步'}
          </button>
        </div>
      </div>

      {/* 矩阵表格区 */}
      <div className="overflow-x-auto rounded-lg border bg-card shadow-xs">
        <table className="row-stagger w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b bg-muted/60 text-xs text-muted-foreground">
              <th className="
                sticky left-0 z-20 min-w-90 bg-muted/95 p-3 backdrop-blur-xs
              "
              >
                <div className="flex items-center justify-between">
                  <span>活动脚本 / 元数据 / 下发操作</span>
                  <span className="text-[11px] font-normal">
                    当前显示
                    {' '}
                    {filteredScripts.length}
                    {' '}
                    项
                  </span>
                </div>
              </th>
              {accounts.map(acc => (
                <th
                  key={acc.ref}
                  className="min-w-28 p-3 text-center whitespace-nowrap"
                >
                  <div className="font-semibold text-foreground">
                    {acc.label}
                  </div>
                  <div className="
                    font-mono text-[10px] text-muted-foreground/80
                  "
                  >
                    #
                    {acc.id}
                    {' '}
                    ·
                    {' '}
                    {acc.openid ? `${acc.openid.slice(0, 6)}…` : acc.ref}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filteredScripts.length === 0
              ? (
                  <tr>
                    <td
                      colSpan={accounts.length + 1}
                      className="p-8 text-center text-xs text-muted-foreground"
                    >
                      未找到符合筛选条件的脚本
                    </td>
                  </tr>
                )
              : (
                  filteredScripts.map((script) => {
                    const picked = sel[script.script_key] ?? [];
                    const unknown = script.unknown_refs ?? [];
                    const isHidden = Boolean(hiddenMap[script.script_key]);
                    const isToggling = togglingKey === script.script_key;

                    return (
                      <tr
                        key={script.script_key}
                        className={cn(
                          `
                            transition-colors
                            hover:bg-muted/30
                          `,
                          isHidden ? 'bg-muted/20 opacity-80' : 'bg-background',
                        )}
                      >
                        {/* 左侧固定脚本列 */}
                        <td
                          className={cn(
                            'sticky left-0 z-10 p-3 backdrop-blur-xs',
                            isHidden ? 'bg-card/95' : 'bg-card/95',
                          )}
                        >
                          <div className="flex flex-col gap-2">
                            {/* 第一行：标题与状态标签 */}
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  'text-sm font-semibold',
                                  isHidden
                                    ? `
                                      text-muted-foreground line-through
                                      decoration-muted-foreground/60
                                    `
                                    : 'text-foreground',
                                )}
                              >
                                {script.name}
                              </span>

                              {isHidden && (
                                <span className="
                                  rounded-sm bg-rose-500/15 px-1.5 py-0.5
                                  text-[10px] font-medium text-rose-600
                                  dark:text-rose-400
                                "
                                >
                                  已失效·前台已隐藏
                                </span>
                              )}

                              {!script.enabled && (
                                <span className="
                                  rounded-sm bg-amber-500/15 px-1.5 py-0.5
                                  text-[10px] font-medium text-amber-600
                                  dark:text-amber-400
                                "
                                >
                                  青龙任务停用
                                </span>
                              )}
                            </div>

                            {/* 第二行：脚本元数据标签组 */}
                            <div className="
                              flex flex-wrap items-center gap-1.5 text-[11px]
                              text-muted-foreground
                            "
                            >
                              {script.env_name
                                ? (
                                    <code className="
                                      rounded-sm bg-muted px-1.5 py-0.5
                                      font-mono text-[10px] text-foreground
                                    "
                                    >
                                      {script.env_name}
                                    </code>
                                  )
                                : (
                                    <span className="
                                      rounded-sm bg-amber-500/15 px-1.5 py-0.5
                                      text-[10px] text-amber-600
                                    "
                                    >
                                      未识别变量
                                    </span>
                                  )}

                              <span className="
                                rounded-sm border border-border/80 px-1.5 py-0.5
                                text-[10px]
                              "
                              >
                                {SOURCE_LABEL[script.source] ?? script.source}
                              </span>

                              {script.app_id && (
                                <span
                                  className="
                                    font-mono text-[10px]
                                    text-muted-foreground/80
                                  "
                                  title={`AppID: ${script.app_id}`}
                                >
                                  {script.app_id}
                                </span>
                              )}

                              <span className="
                                font-mono text-[10px] text-muted-foreground/70
                              "
                              >
                                {script.schedule || '—'}
                              </span>

                              {unknown.length > 0 && (
                                <span className="
                                  font-mono text-[10px] text-rose-600
                                "
                                >
                                  未匹配:
                                  {unknown.join(',')}
                                </span>
                              )}
                            </div>

                            {/* 第三行：操作按钮组（预览下发、失效切换、全选/全清账号） */}
                            <div className="
                              flex flex-wrap items-center gap-1.5 pt-0.5
                            "
                            >
                              {/* 单脚本预览下发按钮 */}
                              <button
                                type="button"
                                onClick={() => {
                                  setPreviewScript(script);
                                  setPreviewMode('env');
                                  // 如果是普通微信脚本，默认采用真实微信 OpenID；若是 YYB_SERVER 则默认为账号 ID
                                  setIdentityMode(
                                    script.env_name && script.env_name !== 'YYB_SERVER'
                                      ? 'openid'
                                      : 'id',
                                  );
                                }}
                                className="
                                  inline-flex items-center gap-1 rounded-sm
                                  border border-border/80 bg-background px-2
                                  py-0.5 text-[11px] font-medium text-foreground
                                  transition-colors
                                  hover:bg-muted
                                "
                                title="单独针对此脚本预览青龙下发代码与配置"
                              >
                                <svg
                                  className="size-3 text-muted-foreground"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <circle cx="11" cy="11" r="8" />
                                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                                </svg>
                                预览下发
                              </button>

                              {/* 失效/正常展示状态切换 */}
                              <button
                                type="button"
                                onClick={() => handleToggleVisibility(script.script_key)}
                                disabled={isToggling}
                                className={cn(
                                  `
                                    rounded-sm px-2 py-0.5 text-[11px]
                                    font-medium transition-colors
                                  `,
                                  isHidden
                                    ? `
                                      border border-emerald-500/30
                                      bg-emerald-500/10 text-emerald-600
                                      hover:bg-emerald-500/20
                                      dark:text-emerald-400
                                    `
                                    : `
                                      border border-rose-500/30 bg-rose-500/10
                                      text-rose-600
                                      hover:bg-rose-500/20
                                      dark:text-rose-400
                                    `,
                                  isToggling && 'cursor-not-allowed opacity-50',
                                )}
                              >
                                {isToggling ? '更新中…' : isHidden ? '恢复正常展示' : '设为失效隐藏'}
                              </button>

                              {/* 行快捷全选与全清 */}
                              {!isHidden && (
                                <div className="
                                  ml-auto flex items-center gap-1 text-[10px]
                                  text-muted-foreground
                                "
                                >
                                  <button
                                    type="button"
                                    onClick={() => selectAllAccounts(script.script_key)}
                                    className="
                                      hover:text-foreground hover:underline
                                    "
                                  >
                                    全选
                                  </button>
                                  <span>/</span>
                                  <button
                                    type="button"
                                    onClick={() => clearAllAccounts(script.script_key)}
                                    className="
                                      hover:text-foreground hover:underline
                                    "
                                  >
                                    全清
                                  </button>
                                  <span className="
                                    ml-1 text-muted-foreground/70
                                  "
                                  >
                                    (
                                    {picked.length}
                                    /
                                    {accounts.length}
                                    )
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* 账号勾选列 */}
                        {accounts.map(account => (
                          <td
                            key={account.ref}
                            className="p-3 text-center align-middle"
                          >
                            <input
                              type="checkbox"
                              className="
                                size-4 cursor-pointer accent-primary
                                disabled:cursor-not-allowed disabled:opacity-30
                              "
                              disabled={isHidden}
                              checked={picked.includes(account.ref)}
                              onChange={() =>
                                toggleAccount(script.script_key, account.ref)}
                              aria-label={`${script.name} - ${account.label}`}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
          </tbody>
        </table>
      </div>

      {/* 单个脚本独立预览弹窗 (Single-Script Preview Modal) */}
      {previewScript && (
        <div
          className="
            fixed inset-0 z-50 flex animate-in items-center justify-center
            bg-black/50 p-4 backdrop-blur-xs fade-in
          "
          onClick={() => setPreviewScript(null)}
        >
          <div
            className="
              w-full max-w-2xl animate-in rounded-lg border bg-card p-5
              shadow-xl duration-150 zoom-in-95
            "
            onClick={e => e.stopPropagation()}
          >
            {/* 弹窗头部 */}
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground">
                    「
                    {previewScript.name}
                    」下发预览
                  </h3>
                  {hiddenMap[previewScript.script_key] && (
                    <span className="
                      rounded-sm bg-rose-500/15 px-1.5 py-0.5 text-xs
                      text-rose-600
                      dark:text-rose-400
                    "
                    >
                      已失效隐藏
                    </span>
                  )}
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {previewScript.script_key}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setPreviewScript(null)}
                className="
                  rounded-md p-1 text-muted-foreground
                  hover:bg-muted hover:text-foreground
                "
              >
                ✕
              </button>
            </div>

            {/* 弹窗主体内容 */}
            <div className="mt-4 flex flex-col gap-3">
              {/* 关联账号概况 */}
              <div className="
                flex flex-wrap items-center justify-between rounded-md
                bg-muted/40 px-3 py-2 text-xs
              "
              >
                <div>
                  <span className="text-muted-foreground">已勾选账号：</span>
                  <span className="font-semibold text-foreground">
                    {previewSelectedAccounts.length}
                    {' '}
                    /
                    {' '}
                    {accounts.length}
                    {' '}
                    个
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">脚本变量名：</span>
                  <code className="
                    rounded-sm bg-muted px-1.5 py-0.5 font-mono text-foreground
                  "
                  >
                    {previewScript.env_name || '未识别'}
                  </code>
                </div>
              </div>

              {/* 账号明细与微信标识映射 */}
              {previewSelectedAccounts.length > 0 && (
                <div className="rounded-md border bg-muted/20 p-2.5 text-xs">
                  <div className="
                    mb-1.5 flex items-center justify-between font-semibold
                    text-foreground
                  "
                  >
                    <span>勾选账号明细与标识映射：</span>
                    <span className="
                      text-[11px] font-normal text-muted-foreground
                    "
                    >
                      共
                      {' '}
                      {previewSelectedAccounts.length}
                      {' '}
                      个
                    </span>
                  </div>
                  <div className="
                    flex max-h-28 flex-col gap-1 overflow-y-auto pr-1
                  "
                  >
                    {previewSelectedAccounts.map(a => (
                      <div
                        key={a.ref}
                        className="
                          flex items-center justify-between border-b
                          border-border/40 py-0.5 text-[11px]
                          last:border-0
                        "
                      >
                        <span className="font-medium text-foreground">
                          账号 #
                          {a.id}
                          {' '}
                          ·
                          {' '}
                          {a.label}
                        </span>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-muted-foreground">
                            OpenID:
                            {' '}
                            <span className="font-semibold text-primary">
                              {a.openid || '无'}
                            </span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 账号标识切换（微信 OpenID vs 账号序号 ID） */}
              <div className="
                flex flex-wrap items-center justify-between gap-2 border-t
                border-border/60 pt-2 text-xs
              "
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-muted-foreground">账号标识模式:</span>
                  <div className="
                    flex rounded-md border bg-muted/40 p-0.5 text-xs
                  "
                  >
                    <button
                      type="button"
                      onClick={() => setIdentityMode('openid')}
                      className={cn(
                        'rounded-sm px-2 py-0.5 font-medium transition-colors',
                        identityMode === 'openid'
                          ? 'bg-background text-primary shadow-xs'
                          : `
                            text-muted-foreground
                            hover:text-foreground
                          `,
                      )}
                      title="微信全局唯一 OpenID，符合各类微信小程序脚本的 wxid 参数规范"
                    >
                      微信 OpenID (推荐)
                    </button>
                    <button
                      type="button"
                      onClick={() => setIdentityMode('id')}
                      className={cn(
                        'rounded-sm px-2 py-0.5 font-medium transition-colors',
                        identityMode === 'id'
                          ? 'bg-background text-primary shadow-xs'
                          : `
                            text-muted-foreground
                            hover:text-foreground
                          `,
                      )}
                      title="应用宝内部账号序号（如 1, 2）"
                    >
                      账号序号 ID
                    </button>
                    <button
                      type="button"
                      onClick={() => setIdentityMode('uin')}
                      className={cn(
                        'rounded-sm px-2 py-0.5 font-medium transition-colors',
                        identityMode === 'uin'
                          ? 'bg-background text-primary shadow-xs'
                          : `
                            text-muted-foreground
                            hover:text-foreground
                          `,
                      )}
                      title="微信数字 UIN 标识"
                    >
                      微信 UIN
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    copyCode(
                      getSingleScriptPreviewCode(
                        previewScript,
                        previewMode,
                        identityMode,
                      ),
                    )}
                  className="
                    inline-flex items-center gap-1 rounded-md border
                    border-input bg-background px-2.5 py-1 text-xs font-medium
                    hover:bg-muted
                  "
                >
                  {copied ? '✅ 已复制' : '📋 复制内容'}
                </button>
              </div>

              {/* 下发方式选择 Tab */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">下发方式:</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPreviewMode('env')}
                    className={cn(
                      `
                        rounded-md px-2.5 py-1 text-xs font-medium
                        transition-colors
                      `,
                      previewMode === 'env'
                        ? 'bg-primary text-primary-foreground'
                        : `
                          border text-muted-foreground
                          hover:bg-muted
                        `,
                    )}
                  >
                    方式 1 · 青龙全局环境变量
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('task_before')}
                    className={cn(
                      `
                        rounded-md px-2.5 py-1 text-xs font-medium
                        transition-colors
                      `,
                      previewMode === 'task_before'
                        ? 'bg-primary text-primary-foreground'
                        : `
                          border text-muted-foreground
                          hover:bg-muted
                        `,
                    )}
                  >
                    方式 2 · 定时任务前缀 (task_before)
                  </button>
                </div>
              </div>

              {/* 代码展示区 */}
              <div className="
                relative rounded-md border bg-muted/30 p-3 font-mono text-xs
              "
              >
                <pre className="
                  overflow-x-auto leading-relaxed whitespace-pre-wrap
                  text-foreground/90
                "
                >
                  {getSingleScriptPreviewCode(
                    previewScript,
                    previewMode,
                    identityMode,
                  )}
                </pre>
              </div>

              {/* 提示信息 */}
              <div className="
                rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground
              "
              >
                <p>
                  💡
                  {' '}
                  <b>微信 ID 与网关取码原理</b>
                  ：对于 Code 版脚本（如周大生、趣淘卡），其通过适配器向应用宝网关发送
                  {' '}
                  <code className="font-mono">ref</code>
                  {' '}
                  获取登录 code。应用宝网关原生同时支持
                  {' '}
                  <b>微信 OpenID (如 owNAX...)</b>
                  {' '}
                  与
                  {' '}
                  <b>账号 ID (如 1, 2)</b>
                  。默认推荐使用「微信 OpenID」，具备唯一性且完全符合微信 wxid 规范。
                </p>
              </div>
            </div>

            {/* 弹窗底部操作 */}
            <div className="mt-4 flex justify-end gap-2 border-t pt-3">
              <button
                type="button"
                onClick={() => setPreviewScript(null)}
                className="
                  rounded-md border border-input bg-background px-3 py-1.5
                  text-xs font-medium
                  hover:bg-muted
                "
              >
                关闭预览
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
