'use client';

import type { YybMyActivitiesPayload } from '@/types/Panel';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { CountUp } from '@/components/reactbits';
import { Card, Empty, Tag } from '@/features/panel/Ui';
import { yybCopyActivitiesAction, yybSaveMyActivitiesAction } from '@/features/panel/yybActions';
import { cn } from '@/utils/Helpers';

export const YybUserActivitiesManager = (props: {
  initialData: YybMyActivitiesPayload;
  defaultAccountRef?: string;
}) => {
  const { accounts, activities, categories } = props.initialData;

  // 1. 初始化账号选择
  const defaultRef = useMemo(() => {
    if (props.defaultAccountRef && accounts.some(a => a.ref === props.defaultAccountRef)) {
      return props.defaultAccountRef;
    }
    return accounts[0]?.ref ?? '';
  }, [accounts, props.defaultAccountRef]);

  const [currentRef, setCurrentRef] = useState<string>(defaultRef);

  // 2. 本地参与状态矩阵：Record<accountRef, Set<script_key>>
  const initialBindings = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const acc of accounts) {
      map[acc.ref] = new Set<string>();
    }
    for (const act of activities) {
      for (const ref of act.participating_refs) {
        if (!map[ref]) {
          map[ref] = new Set<string>();
        }
        map[ref].add(act.script_key);
      }
    }
    return map;
  }, [accounts, activities]);

  const [bindings, setBindings] = useState<Record<string, Set<string>>>(() => {
    // 深度复制 Sets
    const copy: Record<string, Set<string>> = {};
    for (const [k, v] of Object.entries(initialBindings)) {
      copy[k] = new Set(v);
    }
    return copy;
  });

  // 3. 筛选与视图状态
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // 4. 跨账号克隆弹窗
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyTargets, setCopyTargets] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showToast = (type: 'success' | 'error', text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => {
      setToastMsg(null);
    }, 4000);
  };

  // 当前选中账号已开启的集合
  const currentKeys = useMemo(() => {
    return bindings[currentRef] ?? new Set<string>();
  }, [bindings, currentRef]);

  // 脏检查（当前选中的账号是否有变动）
  const isCurrentDirty = useMemo(() => {
    const orig = initialBindings[currentRef] ?? new Set<string>();
    const curr = bindings[currentRef] ?? new Set<string>();
    if (orig.size !== curr.size) {
      return true;
    }
    for (const k of curr) {
      if (!orig.has(k)) {
        return true;
      }
    }
    return false;
  }, [initialBindings, bindings, currentRef]);

  // 当前选中的账号对象
  const currentAccount = useMemo(() => {
    return accounts.find(a => a.ref === currentRef);
  }, [accounts, currentRef]);

  // 各账号已启用的数量映射
  const accountCountMap = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const acc of accounts) {
      counts[acc.ref] = bindings[acc.ref]?.size ?? 0;
    }
    return counts;
  }, [accounts, bindings]);

  // 过滤后的活动列表
  const filteredActivities = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activities.filter((act) => {
      // 分类筛选
      if (selectedCategory !== '全部' && act.category !== selectedCategory) {
        return false;
      }

      // 状态筛选
      const isActive = currentKeys.has(act.script_key);
      if (statusFilter === 'active' && !isActive) {
        return false;
      }
      if (statusFilter === 'inactive' && isActive) {
        return false;
      }

      // 关键词搜索
      if (q) {
        const matchName = act.name.toLowerCase().includes(q);
        const matchClean = act.clean_name.toLowerCase().includes(q);
        const matchEnv = act.env_name.toLowerCase().includes(q);
        const matchAppId = act.app_id.toLowerCase().includes(q);
        if (!matchName && !matchClean && !matchEnv && !matchAppId) {
          return false;
        }
      }

      return true;
    });
  }, [activities, selectedCategory, statusFilter, search, currentKeys]);

  // 单个活动开关切换
  const handleToggle = (scriptKey: string) => {
    setBindings((prev) => {
      const nextMap = { ...prev };
      const currentSet = new Set(nextMap[currentRef] ?? []);
      if (currentSet.has(scriptKey)) {
        currentSet.delete(scriptKey);
      } else {
        currentSet.add(scriptKey);
      }
      nextMap[currentRef] = currentSet;
      return nextMap;
    });
  };

  // 批量全选当前视图
  const handleSelectAllFiltered = () => {
    setBindings((prev) => {
      const nextMap = { ...prev };
      const currentSet = new Set(nextMap[currentRef] ?? []);
      for (const act of filteredActivities) {
        currentSet.add(act.script_key);
      }
      nextMap[currentRef] = currentSet;
      return nextMap;
    });
  };

  // 批量全清当前视图
  const handleDeselectAllFiltered = () => {
    setBindings((prev) => {
      const nextMap = { ...prev };
      const currentSet = new Set(nextMap[currentRef] ?? []);
      for (const act of filteredActivities) {
        currentSet.delete(act.script_key);
      }
      nextMap[currentRef] = currentSet;
      return nextMap;
    });
  };

  // 批量反选当前视图
  const handleInvertFiltered = () => {
    setBindings((prev) => {
      const nextMap = { ...prev };
      const currentSet = new Set(nextMap[currentRef] ?? []);
      for (const act of filteredActivities) {
        if (currentSet.has(act.script_key)) {
          currentSet.delete(act.script_key);
        } else {
          currentSet.add(act.script_key);
        }
      }
      nextMap[currentRef] = currentSet;
      return nextMap;
    });
  };

  // 放弃当前账号的未保存修改
  const handleResetCurrent = () => {
    setBindings((prev) => {
      const nextMap = { ...prev };
      nextMap[currentRef] = new Set(initialBindings[currentRef] ?? []);
      return nextMap;
    });
  };

  // 保存当前账号的配置
  const handleSaveCurrent = () => {
    if (!currentRef) {
      return;
    }
    const enabledKeys = Array.from(currentKeys);
    startTransition(async () => {
      const res = await yybSaveMyActivitiesAction(currentRef, enabledKeys);
      if (res.ok) {
        showToast('success', res.msg);
        // 同步 initialBindings
        initialBindings[currentRef] = new Set(enabledKeys);
      } else {
        showToast('error', res.msg);
      }
    });
  };

  // 执行跨账号复制
  const handleExecuteCopy = () => {
    if (!currentRef || copyTargets.length === 0) {
      return;
    }
    startTransition(async () => {
      const res = await yybCopyActivitiesAction(currentRef, copyTargets);
      if (res.ok) {
        showToast('success', res.msg);
        // 本地状态同步
        const srcKeys = new Set(currentKeys);
        setBindings((prev) => {
          const nextMap = { ...prev };
          for (const tgt of copyTargets) {
            nextMap[tgt] = new Set(srcKeys);
            initialBindings[tgt] = new Set(srcKeys);
          }
          return nextMap;
        });
        setCopyModalOpen(false);
        setCopyTargets([]);
      } else {
        showToast('error', res.msg);
      }
    });
  };

  if (!accounts || accounts.length === 0) {
    return (
      <Card title="暂无可配置的微信账号">
        <Empty text="您名下暂无绑定的应用宝微信账号。请先返回应用宝主页扫码授权添加微信号。" />
        <div className="mt-4 flex justify-center">
          <Link
            href="/dashboard/yyb"
            className="
              inline-flex items-center gap-1.5 rounded-md bg-brand-gradient px-4
              py-2 text-xs font-semibold text-white shadow-sm transition
              hover:opacity-95
            "
          >
            ← 前往添加微信账号
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <div className="relative space-y-6">
      {/* Toast 提示通知 */}
      {toastMsg && (
        <div className="
          fixed top-5 right-5 z-50 animate-in duration-200 fade-in
          slide-in-from-top-4
        "
        >
          <div
            className={cn(
              `
                flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm
                font-medium shadow-lg backdrop-blur-md
              `,
              toastMsg.type === 'success'
                ? `
                  border-emerald-500/30 bg-emerald-50 text-emerald-800
                  dark:bg-emerald-950/80 dark:text-emerald-200
                `
                : `
                  border-red-500/30 bg-red-50 text-red-800
                  dark:bg-red-950/80 dark:text-red-200
                `,
            )}
          >
            <span>{toastMsg.type === 'success' ? '✅' : '❌'}</span>
            <span>{toastMsg.text}</span>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          核心布局优化 1：多账号选项卡 / 药丸选择栏 (Account Pills Bar)
         ───────────────────────────────────────────────────────────── */}
      <Card
        title={(
          <div className="flex items-center gap-2">
            <span>我的微信账号</span>
            <span className="
              rounded-full bg-muted px-2 py-0.5 text-xs font-normal
              text-muted-foreground
            "
            >
              共
              {' '}
              {accounts.length}
              {' '}
              个账号
            </span>
          </div>
        )}
        description="点击切换当前要配置的微信账号；每个账号均可独立配置参加哪些小程序活动"
        actions={accounts.length > 1 && (
          <button
            type="button"
            onClick={() => {
              setCopyTargets(accounts.filter(a => a.ref !== currentRef).map(a => a.ref));
              setCopyModalOpen(true);
            }}
            className="
              inline-flex items-center gap-1.5 rounded-md border border-input
              bg-background px-3 py-1.5 text-xs font-medium text-foreground
              transition
              hover:bg-muted
            "
          >
            <span>📋</span>
            <span>从当前账号同步到其他账号...</span>
          </button>
        )}
      >
        <div className="flex flex-wrap gap-2.5 pt-1">
          {accounts.map((acc) => {
            const isSelected = acc.ref === currentRef;
            const count = accountCountMap[acc.ref] ?? 0;
            const pct = Math.round((count / (activities.length || 1)) * 100);
            const isAlive = acc.status === 'alive';

            return (
              <button
                key={acc.ref}
                type="button"
                onClick={() => setCurrentRef(acc.ref)}
                className={cn(
                  `
                    relative flex min-w-[200px] flex-1 cursor-pointer flex-col
                    rounded-lg border p-3 text-left transition-all
                  `,
                  isSelected
                    ? `
                      border-primary bg-primary/5 shadow-sm ring-1 ring-primary
                      dark:bg-primary/10
                    `
                    : `
                      border-border bg-card/60
                      hover:border-foreground/20 hover:bg-muted/40
                    `,
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-base">📱</span>
                    <span className="
                      truncate text-sm font-semibold text-foreground
                    "
                    >
                      {acc.remark || acc.nickname || acc.label || `账号 #${acc.ref}`}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      isAlive
                        ? 'bg-emerald-500 shadow-sm shadow-emerald-500/50'
                        : `bg-amber-400`,
                    )}
                    title={isAlive ? '协议在线' : '离线/未探测'}
                  />
                </div>

                {acc.remark && acc.nickname && acc.nickname !== acc.remark && (
                  <div className="
                    mt-0.5 truncate text-[11px] text-muted-foreground
                  "
                  >
                    微信：
                    {acc.nickname}
                  </div>
                )}

                <div className="
                  mt-2.5 flex items-center justify-between text-xs
                "
                >
                  <span className="text-muted-foreground">已开启活动</span>
                  <span className="font-semibold text-foreground tabular-nums">
                    <CountUp to={count} duration={700} />
                    {' / '}
                    <CountUp to={activities.length} duration={700} />
                    {' '}
                    <span className="
                      text-[10px] font-normal text-muted-foreground
                    "
                    >
                      (
                      {pct}
                      %)
                    </span>
                  </span>
                </div>

                {/* 进度条 */}
                <div className="
                  mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted
                "
                >
                  <div
                    className={cn(
                      'h-full transition-all duration-300',
                      isSelected ? 'bg-primary' : 'bg-muted-foreground/40',
                    )}
                    style={{ width: `${Math.min(100, Math.max(3, pct))}%` }}
                  />
                </div>

                {isSelected && (
                  <div className="
                    absolute -top-2 right-2 rounded-sm bg-primary px-1.5 py-0.5
                    text-[10px] font-semibold text-primary-foreground shadow-xs
                  "
                  >
                    正在配置
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {/* ─────────────────────────────────────────────────────────────
          核心布局优化 2：海量活动管理工具栏与分类筛选 (110+ 活动)
         ───────────────────────────────────────────────────────────── */}
      <Card
        title={(
          <div className="flex flex-wrap items-center gap-2">
            <span>小程序活动订阅</span>
            <span className="text-xs font-normal text-muted-foreground">
              为「
              <span className="font-semibold text-foreground">
                {currentAccount?.remark || currentAccount?.nickname || `账号 #${currentRef}`}
              </span>
              」勾选需参与的小程序任务
            </span>
          </div>
        )}
        description={`系统已接入 ${activities.length} 个小程序活动，可通过搜索、业务分类与状态快速定位`}
        actions={(
          <div className="flex items-center gap-1.5">
            {/* 视图模式切换 */}
            <div className="
              flex items-center rounded-md border bg-muted p-0.5 text-xs
            "
            >
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={cn(
                  'rounded-sm px-2.5 py-1 font-medium transition',
                  viewMode === 'grid'
                    ? 'bg-background text-foreground shadow-xs'
                    : `
                      text-muted-foreground
                      hover:text-foreground
                    `,
                )}
              >
                🔲 卡片网格
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={cn(
                  'rounded-sm px-2.5 py-1 font-medium transition',
                  viewMode === 'table'
                    ? 'bg-background text-foreground shadow-xs'
                    : `
                      text-muted-foreground
                      hover:text-foreground
                    `,
                )}
              >
                📑 紧凑列表
              </button>
            </div>
          </div>
        )}
      >
        {/* 工具栏：搜索 + 状态过滤 + 快捷批量操作 */}
        <div className="space-y-3.5 border-b pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* 搜索框 */}
            <div className="
              relative min-w-[240px] flex-1
              sm:max-w-md
            "
            >
              <span className="
                absolute top-1/2 left-3 -translate-y-1/2 text-sm
                text-muted-foreground
              "
              >
                🔍
              </span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索活动名称、分类或拼音关键词（如 顺丰、肯德基）..."
                className="
                  w-full rounded-md border border-input bg-background py-1.5
                  pr-8 pl-9 text-xs text-foreground
                  placeholder:text-muted-foreground
                  focus:border-primary focus:ring-1 focus:ring-primary
                  focus:outline-none
                "
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="
                    absolute top-1/2 right-2.5 -translate-y-1/2 text-xs
                    text-muted-foreground
                    hover:text-foreground
                  "
                >
                  ✕
                </button>
              )}
            </div>

            {/* 状态过滤 Tab */}
            <div className="
              flex items-center rounded-md border bg-muted/60 p-0.5 text-xs
            "
            >
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={cn(
                  'rounded-sm px-3 py-1 font-medium transition',
                  statusFilter === 'all'
                    ? 'bg-background text-foreground shadow-xs'
                    : `
                      text-muted-foreground
                      hover:text-foreground
                    `,
                )}
              >
                全部 (
                {activities.length}
                )
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={cn(
                  'rounded-sm px-3 py-1 font-medium transition',
                  statusFilter === 'active'
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
                已参加 (
                {currentKeys.size}
                )
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('inactive')}
                className={cn(
                  'rounded-sm px-3 py-1 font-medium transition',
                  statusFilter === 'inactive'
                    ? 'bg-background text-foreground shadow-xs'
                    : `
                      text-muted-foreground
                      hover:text-foreground
                    `,
                )}
              >
                未参加 (
                {activities.length - currentKeys.size}
                )
              </button>
            </div>

            {/* 批量操作快捷按钮 */}
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="
                  rounded-sm border border-input bg-background px-2.5 py-1.5
                  font-medium text-foreground transition
                  hover:bg-muted
                "
              >
                全选本页
              </button>
              <button
                type="button"
                onClick={handleDeselectAllFiltered}
                className="
                  rounded-sm border border-input bg-background px-2.5 py-1.5
                  font-medium text-foreground transition
                  hover:bg-muted
                "
              >
                全清本页
              </button>
              <button
                type="button"
                onClick={handleInvertFiltered}
                className="
                  rounded-sm border border-input bg-background px-2.5 py-1.5
                  font-medium text-foreground transition
                  hover:bg-muted
                "
              >
                反选
              </button>
            </div>
          </div>

          {/* 分类胶囊标签条 */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="mr-1 text-xs text-muted-foreground">分类筛选：</span>
            {categories.map((cat) => {
              const count = activities.filter(a => cat === '全部' || a.category === cat).length;
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-xs transition-colors',
                    isSelected
                      ? `
                        bg-primary font-medium text-primary-foreground shadow-xs
                      `
                      : `
                        bg-muted text-muted-foreground
                        hover:bg-muted/80 hover:text-foreground
                      `,
                  )}
                >
                  {cat}
                  {' '}
                  <span className="text-[10px] opacity-75">
                    (
                    {count}
                    )
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 筛选结果统计小条 */}
        <div className="
          my-3 flex items-center justify-between text-xs text-muted-foreground
        "
        >
          <div>
            当前显示
            {' '}
            <span className="font-semibold text-foreground">{filteredActivities.length}</span>
            {' '}
            个活动（其中该账号已开启
            {' '}
            <span className="
              font-semibold text-emerald-600
              dark:text-emerald-400
            "
            >
              {filteredActivities.filter(a => currentKeys.has(a.script_key)).length}
            </span>
            {' '}
            个）
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            展示形式 1：网格卡片视图 (Grid View)
           ───────────────────────────────────────────────────────────── */}
        {viewMode === 'grid' && (
          <div className="
            grid grid-cols-1 gap-3
            sm:grid-cols-2
            lg:grid-cols-3
            xl:grid-cols-4
          "
          >
            {filteredActivities.map((act) => {
              const isChecked = currentKeys.has(act.script_key);
              return (
                <div
                  key={act.script_key}
                  onClick={() => handleToggle(act.script_key)}
                  className={cn(
                    `
                      group relative flex cursor-pointer flex-col
                      justify-between rounded-lg border p-3.5 transition-all
                    `,
                    isChecked
                      ? `
                        border-primary/50 bg-primary/4 shadow-xs
                        dark:bg-primary/8
                      `
                      : `
                        border-border bg-card/60
                        hover:border-foreground/20 hover:bg-muted/30
                      `,
                  )}
                >
                  <div>
                    {/* 头部：分类徽标 */}
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="
                        rounded-sm bg-muted px-1.5 py-0.5 text-[10px]
                        font-medium text-muted-foreground
                      "
                      >
                        {act.category}
                      </span>
                    </div>

                    {/* 主标题 */}
                    <div className="
                      mt-2 text-sm font-semibold text-foreground
                      group-hover:text-primary
                    "
                    >
                      {act.clean_name || act.name}
                    </div>

                    {/* AppID */}
                    {act.app_id && (
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-1 truncate">
                          <span>🔑</span>
                          <span className="font-mono text-[10px]">{act.app_id}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 底部开关行 */}
                  <div className="
                    mt-3.5 flex items-center justify-between border-t
                    border-border/60 pt-2.5
                  "
                  >
                    <span
                      className={cn(
                        'text-xs font-medium',
                        isChecked
                          ? `
                            text-emerald-600
                            dark:text-emerald-400
                          `
                          : 'text-muted-foreground',
                      )}
                    >
                      {isChecked ? '● 已开启参加' : '○ 未参加'}
                    </span>

                    {/* Switch 控件 */}
                    <div
                      className={cn(
                        `
                          relative inline-flex h-5 w-9 shrink-0 cursor-pointer
                          rounded-full border-2 border-transparent
                          transition-colors duration-200 ease-in-out
                        `,
                        isChecked ? 'bg-primary' : 'bg-muted-foreground/30',
                      )}
                    >
                      <span
                        className={cn(
                          `
                            pointer-events-none inline-block size-4 transform
                            rounded-full bg-white shadow-sm ring-0 transition
                            duration-200 ease-in-out
                          `,
                          isChecked ? 'translate-x-4' : 'translate-x-0',
                        )}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            展示形式 2：紧凑表格视图 (Table View)
           ───────────────────────────────────────────────────────────── */}
        {viewMode === 'table' && (
          <div className="overflow-x-auto rounded-md border">
            <table className="row-stagger w-full text-left text-xs">
              <thead className="bg-muted/70 text-muted-foreground">
                <tr>
                  <th className="w-12 px-3 py-2 text-center">状态</th>
                  <th className="px-3 py-2">活动名称</th>
                  <th className="w-32 px-3 py-2">分类</th>
                  <th className="w-24 px-3 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredActivities.map((act) => {
                  const isChecked = currentKeys.has(act.script_key);
                  return (
                    <tr
                      key={act.script_key}
                      onClick={() => handleToggle(act.script_key)}
                      className={cn(
                        `
                          cursor-pointer transition
                          hover:bg-muted/50
                        `,
                        isChecked && 'bg-primary/3',
                      )}
                    >
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // 由 tr 点击统一驱动
                          className="
                            size-4 rounded-sm border-input accent-primary
                          "
                        />
                      </td>
                      <td className="px-3 py-2 font-semibold text-foreground">
                        {act.clean_name || act.name}
                      </td>
                      <td className="px-3 py-2">
                        <Tag tone="gray">{act.category}</Tag>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className={cn(
                            'rounded-sm px-2 py-0.5 text-[11px] font-medium',
                            isChecked
                              ? 'bg-emerald-500/10 text-emerald-600'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {isChecked ? '已开' : '停用'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {filteredActivities.length === 0 && (
          <Empty text="未找到符合筛选条件的小程序活动，请尝试清除搜索词或切换分类" />
        )}
      </Card>

      {/* ─────────────────────────────────────────────────────────────
          吸底浮动保存栏 (Sticky Floating Action Bar)
         ───────────────────────────────────────────────────────────── */}
      {isCurrentDirty && (
        <div className="
          sticky bottom-4 z-40 mx-auto max-w-2xl animate-in duration-200 fade-in
          slide-in-from-bottom-4
        "
        >
          <div className="
            flex items-center justify-between gap-4 rounded-xl border
            border-primary/40 bg-card/95 px-5 py-3.5 shadow-xl backdrop-blur-md
          "
          >
            <div className="flex items-center gap-2.5">
              <span className="text-xl">⚠️</span>
              <div>
                <div className="text-xs font-semibold text-foreground">
                  账号「
                  {currentAccount?.remark || currentAccount?.nickname || `账号 #${currentRef}`}
                  」有未保存的配置更改
                </div>
                <div className="text-[11px] text-muted-foreground">
                  当前已选中
                  {' '}
                  <span className="font-semibold text-primary">{currentKeys.size}</span>
                  {' '}
                  个活动
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetCurrent}
                disabled={isPending}
                className="
                  rounded-md border border-input bg-background px-3 py-1.5
                  text-xs font-medium text-muted-foreground transition
                  hover:bg-muted hover:text-foreground
                "
              >
                重置放弃
              </button>
              <button
                type="button"
                onClick={handleSaveCurrent}
                disabled={isPending}
                className="
                  inline-flex items-center gap-1.5 rounded-md bg-brand-gradient
                  px-4 py-1.5 text-xs font-semibold text-white shadow-sm
                  transition
                  hover:opacity-95
                  disabled:opacity-50
                "
              >
                {isPending
                  ? (
                      <>
                        <span className="
                          size-3 animate-spin rounded-full border-2 border-white
                          border-t-transparent
                        "
                        />
                        <span>正在保存...</span>
                      </>
                    )
                  : (
                      <>
                        <span>💾</span>
                        <span>立即保存配置</span>
                      </>
                    )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          跨账号复制配置弹窗 (Copy Modal)
         ───────────────────────────────────────────────────────────── */}
      {copyModalOpen && (
        <div className="
          fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4
          backdrop-blur-xs
        "
        >
          <div className="
            w-full max-w-md animate-in rounded-xl border bg-card p-5 shadow-2xl
            duration-150 zoom-in-95 fade-in
          "
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-foreground">同步活动配置</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  将源账号「
                  <span className="font-semibold text-foreground">
                    {currentAccount?.remark || currentAccount?.nickname || `账号 #${currentRef}`}
                  </span>
                  」的全部活动配置（已开启
                  {' '}
                  {currentKeys.size}
                  {' '}
                  项）一键同步给目标账号
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCopyModalOpen(false)}
                className="
                  text-muted-foreground
                  hover:text-foreground
                "
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <div className="text-xs font-medium text-foreground">请选择要覆盖同步的目标账号：</div>
              <div className="
                max-h-48 space-y-1.5 overflow-y-auto rounded-md border p-2
              "
              >
                {accounts
                  .filter(a => a.ref !== currentRef)
                  .map((acc) => {
                    const checked = copyTargets.includes(acc.ref);
                    return (
                      <label
                        key={acc.ref}
                        className="
                          flex cursor-pointer items-center justify-between
                          rounded-md p-2 transition
                          hover:bg-muted
                        "
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setCopyTargets(prev =>
                                checked ? prev.filter(x => x !== acc.ref) : [...prev, acc.ref],
                              );
                            }}
                            className="
                              size-4 rounded-sm border-input accent-primary
                            "
                          />
                          <span className="text-xs font-medium text-foreground">
                            {acc.remark || acc.nickname || `账号 #${acc.ref}`}
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          当前已开启
                          {' '}
                          {accountCountMap[acc.ref] ?? 0}
                          {' '}
                          项
                        </span>
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCopyModalOpen(false)}
                className="
                  rounded-md border px-3 py-1.5 text-xs font-medium
                  hover:bg-muted
                "
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleExecuteCopy}
                disabled={copyTargets.length === 0 || isPending}
                className="
                  rounded-md bg-brand-gradient px-4 py-1.5 text-xs font-semibold
                  text-white shadow-sm transition
                  hover:opacity-95
                  disabled:opacity-50
                "
              >
                {isPending ? '正在同步...' : `确认同步到 ${copyTargets.length} 个账号`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
