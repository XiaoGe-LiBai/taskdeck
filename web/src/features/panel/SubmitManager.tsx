'use client';

import type { CustomSubmission, PanelProject } from '@/types/Panel';
import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { AnimatedList, CountUp } from '@/components/reactbits';
import { projectSubmitAction } from '@/features/panel/projectActions';
import { cn } from '@/utils/Helpers';

/** 用字段配置里的 default_value 预填用户端表单 */
const initialParams = (project?: PanelProject): Record<string, string> => {
  const out: Record<string, string> = {};
  (project?.field_config ?? []).forEach((f) => {
    if (f.default_value) {
      out[f.key] = f.default_value;
    }
  });
  return out;
};

export const SubmitManager = (props: {
  projects: PanelProject[];
  balance: number;
  initialSubmissions: CustomSubmission[];
  userRole?: string;
}) => {
  const [balance, setBalance] = useState(props.balance);

  // 服务端下发新余额（例如在会员中心兑换卡密后回到本页）→ 以服务端为准。
  // 之前是纯本地副本，服务端数据变了它也不会跟，会拿旧余额误判"积分不足"把按钮禁掉。
  // （渲染期同步：React 官方 derived state 写法，比 useEffect 少一次渲染）
  const [lastServerBalance, setLastServerBalance] = useState(props.balance);
  if (props.balance !== lastServerBalance) {
    setLastServerBalance(props.balance);
    setBalance(props.balance);
  }
  const [selectedKey, setSelectedKey] = useState<string>(() => {
    return props.projects[0]?.project_key || '';
  });
  const [keyword, setKeyword] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [params, setParams] = useState<Record<string, string>>(
    () => initialParams(props.projects.find(p => p.channel === 'custom')),
  );
  const [showPwd, setShowPwd] = useState<Record<string, boolean>>({});
  const [submissions, setSubmissions] = useState<CustomSubmission[]>(props.initialSubmissions);
  const [resultMsg, setResultMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // 严格只显示自定义脚本
  const customProjects = useMemo(() => {
    return props.projects.filter(p => p.channel === 'custom');
  }, [props.projects]);

  // 当前选中的项目
  const selectedProject = useMemo(() => {
    return customProjects.find(p => p.project_key === selectedKey) || customProjects[0];
  }, [customProjects, selectedKey]);

  // 过滤脚本列表
  const filteredProjects = useMemo(() => {
    return customProjects.filter((p) => {
      if (keyword && !p.name.toLowerCase().includes(keyword.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [customProjects, keyword]);

  // 切换项目时按新项目的默认值重置参数，并收起选择器
  const handleSelectProject = (key: string) => {
    setSelectedKey(key);
    setParams(initialParams(customProjects.find(p => p.project_key === key)));
    setResultMsg(null);
    setPickerOpen(false);
  };

  const handleParamChange = (fieldKey: string, val: string) => {
    setParams(prev => ({ ...prev, [fieldKey]: val }));
  };

  const cost = selectedProject ? Number(selectedProject.points_cost || 0) : 0;
  const isInsufficient = balance < cost;

  // 提交流程
  const handleSubmit = () => {
    if (!selectedProject) {
      setResultMsg({ ok: false, text: '请先选择需要提交的自定义脚本' });
      return;
    }
    if (isInsufficient) {
      setResultMsg({ ok: false, text: `积分不足：当前可用 ${balance} 分，需要 ${cost} 分` });
      return;
    }

    // 必填项校验
    const fields = selectedProject.field_config || [];
    for (const f of fields) {
      if (f.required && !params[f.key]?.trim()) {
        setResultMsg({ ok: false, text: `请填写必填项：${f.label || f.key}` });
        return;
      }
    }

    startTransition(async () => {
      setResultMsg(null);
      const res = await projectSubmitAction(selectedProject.project_key, params);
      if (!res.ok) {
        setResultMsg({ ok: false, text: res.msg });
      } else {
        const newBal = res.data?.balance ?? balance - cost;
        setBalance(newBal);
        setResultMsg({ ok: true, text: res.msg || '提交成功！' });
        // 添加到本地历史
        if (res.data?.submission_id) {
          const newSub: CustomSubmission = {
            id: res.data.submission_id,
            user_id: 0,
            project_id: selectedProject.id,
            project_key: selectedProject.project_key,
            script_name: selectedProject.name,
            account: res.data.account || '提交账号',
            params_data: params,
            points_cost: cost,
            status: 'submitted',
            result_msg: res.data.note || '提交成功',
            created_time: new Date().toISOString().replace('T', ' ').slice(0, 19),
            updated_time: new Date().toISOString().replace('T', ' ').slice(0, 19),
          };
          setSubmissions(prev => [newSub, ...prev]);
        }
        // 恢复为默认值
        setParams(initialParams(selectedProject));
      }
    });
  };

  // 根容器用 AnimatedList：余额横幅 / 步骤 1-3 / 提交历史 五个区块依次弹入
  return (
    <AnimatedList stagger={70} className="flex flex-col gap-6">
      {/* 顶部可用积分横幅 */}
      <div className="
        flex flex-wrap items-center justify-between gap-4 rounded-xl border
        bg-linear-to-r from-indigo-50/70 to-purple-50/40 p-4
        dark:from-indigo-950/20 dark:to-purple-950/10
      "
      >
        <div>
          <div className="text-xs font-medium text-muted-foreground">当前可用余额</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="
              text-3xl font-bold text-indigo-600
              dark:text-indigo-400
            "
            >
              {/* 余额数字滚动：与其他页面的 StatCard 口径一致 */}
              <CountUp to={balance} duration={900} />
            </span>
            <span className="text-xs text-muted-foreground">分</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            提交自定义脚本按次扣减（单位：分）；仅展示管理员新对接的扩展脚本，不包含 code/小蚕预设任务。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 兑换是「用户自己的钱」的操作，落在会员中心的卡密兑换卡片上。
              注意不要指到 /dashboard/cards —— 那是管理端的卡密管理（admin only），
              普通用户点进去会被后端 401 踢回登录页。 */}
          <Link
            href="/dashboard/profile"
            title="在「会员中心 → 卡密充值 / 积分兑换」里兑换"
            className="
              rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold
              text-white shadow-sm
              hover:bg-indigo-700
            "
          >
            去充值兑换卡密 ›
          </Link>
        </div>
      </div>

      {/* 步骤 1：选择自定义脚本（紧凑折叠：默认只占一行，展开后是行列表） */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <span className="
            flex size-6 items-center justify-center rounded-full bg-indigo-600
            text-xs font-bold text-white
          "
          >
            1
          </span>
          <h3 className="text-sm font-semibold">选择需要提交的自定义脚本</h3>
          {customProjects.length > 0 && (
            <span className="
              ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px]
              text-muted-foreground
            "
            >
              共
              {' '}
              {customProjects.length}
              {' '}
              个
            </span>
          )}
        </div>

        {customProjects.length === 0
          ? (
              <div className="
                rounded-lg border border-dashed p-8 text-center text-xs
                text-muted-foreground
              "
              >
                暂无自定义对接脚本，请稍后再来看看。
              </div>
            )
          : (
              <>
                {/* 折叠态：只显示当前选中的一行 */}
                <button
                  type="button"
                  onClick={() => setPickerOpen(v => !v)}
                  className={cn(
                    `
                      flex w-full items-center justify-between gap-3 rounded-lg
                      border px-3.5 py-2.5 text-left transition-colors
                    `,
                    pickerOpen
                      ? `
                        border-indigo-600 bg-indigo-50/40
                        dark:bg-indigo-950/20
                      `
                      : `
                        bg-background
                        hover:border-muted-foreground/30
                      `,
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="
                      flex size-5 shrink-0 items-center justify-center
                      rounded-full bg-indigo-600 text-[10px] text-white
                    "
                    >
                      ✓
                    </span>
                    <span className="truncate text-sm font-semibold">
                      {selectedProject?.name ?? '请选择脚本'}
                    </span>
                    {selectedProject?.env_name && (
                      <span className="
                        shrink-0 rounded-sm bg-sky-100 px-1.5 py-0.5 text-[10px]
                        text-sky-800
                        dark:bg-sky-900/40 dark:text-sky-300
                      "
                      >
                        {selectedProject.env_name}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    <span className="
                      font-bold text-indigo-600
                      dark:text-indigo-400
                    "
                    >
                      {cost > 0 ? `${cost} 分` : '免费'}
                    </span>
                    <span className="text-muted-foreground">
                      {pickerOpen ? '收起 ▲' : '更换 ▼'}
                    </span>
                  </div>
                </button>

                {/* 展开态：紧凑行列表 + 搜索 */}
                {pickerOpen && (
                  <div className="
                    mt-2 overflow-hidden rounded-lg border bg-background
                  "
                  >
                    <div className="border-b p-2">
                      <input
                        value={keyword}
                        onChange={e => setKeyword(e.target.value)}
                        placeholder="搜索脚本名称…"
                        className="
                          h-8 w-full rounded-md border bg-card px-2.5 text-xs
                          outline-none
                          focus:border-indigo-600
                        "
                      />
                    </div>
                    <AnimatedList
                      stagger={45}
                      className="max-h-72 divide-y overflow-y-auto"
                    >
                      {filteredProjects.length === 0
                        ? (
                            <div className="
                              p-6 text-center text-xs text-muted-foreground
                            "
                            >
                              没有匹配「
                              {keyword}
                              」的脚本
                            </div>
                          )
                        : filteredProjects.map((p) => {
                            const isSelected = p.project_key === (selectedProject?.project_key || selectedKey);
                            const pCost = Number(p.points_cost || 0);
                            return (
                              <button
                                type="button"
                                key={p.project_key}
                                onClick={() => handleSelectProject(p.project_key)}
                                className={cn(
                                  `
                                    flex w-full items-center justify-between
                                    gap-3 px-3.5 py-2.5 text-left
                                    transition-colors
                                  `,
                                  isSelected
                                    ? `
                                      bg-indigo-50/60
                                      dark:bg-indigo-950/25
                                    `
                                    : 'hover:bg-muted/40',
                                )}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className={cn(
                                    `
                                      flex size-4.5 shrink-0 items-center
                                      justify-center rounded-full border
                                      text-[9px]
                                    `,
                                    isSelected
                                      ? `
                                        border-indigo-600 bg-indigo-600
                                        text-white
                                      `
                                      : `
                                        border-muted-foreground/40
                                        text-transparent
                                      `,
                                  )}
                                  >
                                    ✓
                                  </span>
                                  <span className="truncate text-sm font-medium">
                                    {p.name}
                                  </span>
                                  {p.env_name && (
                                    <span className="
                                      shrink-0 rounded-sm bg-sky-100 px-1.5
                                      py-0.5 text-[10px] text-sky-800
                                      dark:bg-sky-900/40 dark:text-sky-300
                                    "
                                    >
                                      {p.env_name}
                                    </span>
                                  )}
                                </div>
                                <span className="
                                  shrink-0 text-xs font-bold text-indigo-600
                                  dark:text-indigo-400
                                "
                                >
                                  {pCost > 0 ? `${pCost} 分` : '免费'}
                                </span>
                              </button>
                            );
                          })}
                    </AnimatedList>
                  </div>
                )}
              </>
            )}
      </div>

      {/* 步骤 2：填写参数信息 */}
      {selectedProject && (
        <div className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="
              flex size-6 items-center justify-center rounded-full bg-indigo-600
              text-xs font-bold text-white
            "
            >
              2
            </span>
            <h3 className="text-sm font-semibold">
              填写参数信息（
              {selectedProject.name}
              ）
            </h3>
          </div>

          {/* 说明与注意事项（管理员配置，支持换行） */}
          {selectedProject.description && (
            <div className="
              rounded-lg border border-amber-500/25 bg-amber-500/5 px-3.5 py-2.5
              text-xs/5 whitespace-pre-line text-amber-700
              dark:text-amber-400
            "
            >
              {selectedProject.description}
            </div>
          )}

          {/* 动态表单字段（换脚本时整组字段依次弹入） */}
          <AnimatedList stagger={60} className="space-y-3.5">
            {selectedProject.field_config && selectedProject.field_config.length > 0
              ? (
                  selectedProject.field_config.map((f) => {
                    const isPwd = f.type === 'password';
                    const show = showPwd[f.key] || false;
                    return (
                      <div key={f.key} className="space-y-1">
                        <label className="
                          flex items-center gap-1 text-xs font-medium
                          text-foreground
                        "
                        >
                          <span>{f.label}</span>
                          <span className="
                            font-mono text-[10px] text-muted-foreground
                          "
                          >
                            (
                            {f.key}
                            )
                          </span>
                          {f.required && (
                            <span className="font-bold text-red-500">
                              *
                            </span>
                          )}
                        </label>

                        {f.type === 'textarea'
                          ? (
                              <textarea
                                rows={3}
                                value={params[f.key] || ''}
                                onChange={e => handleParamChange(f.key, e.target.value)}
                                placeholder={f.placeholder || `请输入 ${f.label}`}
                                className="
                                  w-full rounded-md border bg-background px-3
                                  py-2 font-mono text-xs outline-none
                                  focus:border-indigo-600
                                "
                              />
                            )
                          : f.type === 'select'
                            ? (
                                <select
                                  value={params[f.key] || ''}
                                  onChange={e => handleParamChange(f.key, e.target.value)}
                                  className="
                                    w-full rounded-md border bg-background px-3
                                    py-2 text-xs outline-none
                                    focus:border-indigo-600
                                  "
                                >
                                  <option value="">{f.placeholder || `请选择 ${f.label}`}</option>
                                  {(f.options ?? []).map(opt => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              )
                            : isPwd
                              ? (
                                  <div className="relative">
                                    <input
                                      type={show ? 'text' : 'password'}
                                      value={params[f.key] || ''}
                                      onChange={e => handleParamChange(f.key, e.target.value)}
                                      placeholder={f.placeholder || `请输入 ${f.label}`}
                                      className="
                                        w-full rounded-md border bg-background
                                        px-3 py-2 pr-14 font-mono text-xs
                                        outline-none
                                        focus:border-indigo-600
                                      "
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setShowPwd(prev => ({ ...prev, [f.key]: !show }))}
                                      className="
                                        absolute top-1.5 right-2 rounded-sm px-2
                                        py-1 text-[11px] text-muted-foreground
                                        hover:bg-muted
                                      "
                                    >
                                      {show ? '隐藏' : '显示'}
                                    </button>
                                  </div>
                                )
                              : (
                                  <input
                                    type={f.type === 'number' ? 'number' : 'text'}
                                    value={params[f.key] || ''}
                                    onChange={e => handleParamChange(f.key, e.target.value)}
                                    placeholder={f.placeholder || `请输入 ${f.label}`}
                                    className="
                                      w-full rounded-md border bg-background
                                      px-3 py-2 text-xs outline-none
                                      focus:border-indigo-600
                                    "
                                  />
                                )}
                      </div>
                    );
                  })
                )
              : (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium">账号标识 *</label>
                      <input
                        value={params.account || ''}
                        onChange={e => handleParamChange('account', e.target.value)}
                        placeholder="请输入绑定的账号标识或手机号"
                        className="
                          w-full rounded-md border bg-background px-3 py-2
                          text-xs outline-none
                          focus:border-indigo-600
                        "
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium">凭证 / Cookie / Token</label>
                      <textarea
                        rows={3}
                        value={params.cookie || ''}
                        onChange={e => handleParamChange('cookie', e.target.value)}
                        placeholder="粘贴对应抓包获得的 Token 或 Cookie"
                        className="
                          w-full rounded-md border bg-background px-3 py-2
                          font-mono text-xs outline-none
                          focus:border-indigo-600
                        "
                      />
                    </div>
                  </div>
                )}
          </AnimatedList>

          {/* 步骤 3：确认提交 */}
          <div className="border-t pt-4">
            <div className="
              mb-3 flex items-center justify-between rounded-lg bg-muted/40 p-3
              text-xs
            "
            >
              <div>
                <span className="text-muted-foreground">已选脚本：</span>
                <span className="font-semibold text-foreground">{selectedProject.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">提交扣减：</span>
                <span className="
                  font-bold text-indigo-600
                  dark:text-indigo-400
                "
                >
                  {cost > 0 ? `${cost} 分` : '免费'}
                </span>
                <span className="ml-2 text-muted-foreground">
                  （预计剩余
                  {Math.max(0, balance - cost)}
                  {' '}
                  分）
                </span>
              </div>
            </div>

            {resultMsg && (
              <div
                className={cn(
                  'mb-3 rounded-lg p-3 text-xs',
                  resultMsg.ok
                    ? `
                      border border-emerald-200 bg-emerald-50 text-emerald-800
                      dark:border-emerald-900 dark:bg-emerald-950/30
                      dark:text-emerald-300
                    `
                    : `
                      border border-red-200 bg-red-50 text-red-800
                      dark:border-red-900 dark:bg-red-950/30 dark:text-red-300
                    `,
                )}
              >
                {resultMsg.text}
              </div>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={pending || isInsufficient}
              className={cn(
                `
                  w-full rounded-lg py-2.5 text-center text-sm font-semibold
                  text-white shadow-sm transition-all
                `,
                isInsufficient
                  ? `
                    cursor-not-allowed bg-muted-foreground/40
                    text-muted-foreground
                  `
                  : `
                    bg-indigo-600
                    hover:bg-indigo-700
                    active:scale-[0.99]
                    disabled:opacity-50
                  `,
              )}
            >
              {pending ? '正在提交上车…' : isInsufficient ? '余额不足，请先充值' : '确认并提交上车'}
            </button>
          </div>
        </div>
      )}

      {/* 提交历史记录 */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">自定义脚本提交记录</h3>
        {submissions.length === 0
          ? (
              <div className="py-6 text-center text-xs text-muted-foreground">暂无提交记录</div>
            )
          : (
              <div className="overflow-x-auto">
                <table className="row-stagger w-full border-collapse text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">编号</th>
                      <th className="px-3 py-2 text-left font-medium">脚本名称</th>
                      <th className="px-3 py-2 text-left font-medium">账号标识</th>
                      <th className="px-3 py-2 text-left font-medium">消耗（分）</th>
                      <th className="px-3 py-2 text-left font-medium">状态</th>
                      <th className="px-3 py-2 text-left font-medium">结果说明</th>
                      <th className="px-3 py-2 text-right font-medium">提交时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {submissions.map(sub => (
                      <tr key={sub.id} className="hover:bg-muted/30">
                        <td className="px-3 py-2 font-mono">
                          #
                          {sub.id}
                        </td>
                        <td className="px-3 py-2 font-medium">{sub.script_name}</td>
                        <td className="
                          px-3 py-2 font-mono text-muted-foreground
                        "
                        >
                          {sub.account}
                        </td>
                        <td className="
                          px-3 py-2 font-semibold text-indigo-600
                          dark:text-indigo-400
                        "
                        >
                          {sub.points_cost}
                        </td>
                        <td className="px-3 py-2">
                          <span className="
                            rounded-sm bg-emerald-100 px-1.5 py-0.5 text-[10px]
                            text-emerald-800
                            dark:bg-emerald-950/40 dark:text-emerald-300
                          "
                          >
                            {sub.status === 'submitted' ? '已提交' : sub.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{sub.result_msg || '-'}</td>
                        <td className="
                          px-3 py-2 text-right font-mono text-muted-foreground
                        "
                        >
                          {sub.created_time}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>
    </AnimatedList>
  );
};
