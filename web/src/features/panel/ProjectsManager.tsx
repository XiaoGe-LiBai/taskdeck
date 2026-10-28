'use client';

import type { PanelProject, ScriptFieldParam } from '@/types/Panel';

import { useMemo, useState, useTransition } from 'react';
import {
  customScriptCreateAction,
  customScriptDeleteAction,
  customScriptUpdateAction,
  projectsSaveAction,
} from '@/features/panel/projectActions';
import { cn } from '@/utils/Helpers';

type PUser = { id: number; email: string; nickname: string; role: string };
type Draft = { points_cost: number; hidden: boolean; min_vip_level: number; userIds: number[] };

const DEFAULT_PARAMS: ScriptFieldParam[] = [
  { key: 'account', label: '账号/备注', type: 'text', placeholder: '如 手机号或账号标识', required: true },
  { key: 'cookie', label: '抓包Cookie/Token', type: 'textarea', placeholder: '完整Cookie或Token', required: true },
];

/** 字段 Key 只允许字母/数字/下划线且不以数字开头（表单 key 与青龙环境变量都吃这套） */
const KEY_RE = /^[A-Z_]\w*$/i;

const FIELD_TYPES: { value: ScriptFieldParam['type']; label: string }[] = [
  { value: 'text', label: '单行文本' },
  { value: 'textarea', label: '多行文本' },
  { value: 'password', label: '密码框' },
  { value: 'number', label: '数字' },
  { value: 'select', label: '下拉选择' },
];

/** 「每行一个：值=显示名」→ options（只写值则显示名同值） */
const parseOptionsText = (text: string): { label: string; value: string }[] =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('=');
      if (idx === -1) {
        return { label: line, value: line };
      }
      const value = line.slice(0, idx).trim();
      const label = line.slice(idx + 1).trim() || value;
      return { label, value };
    });

const optionsToText = (options?: { label: string; value: string }[]): string =>
  (options ?? []).map(o => `${o.value}=${o.label}`).join('\n');

/**
 * 项目管理：
 * 1. 小蚕 / 应用宝：给每个项目设积分价、切隐藏、单独授权
 * 2. 自定义脚本：新增/编辑自定义对接脚本，自由定义参数与类型（含下拉选择），
 *    并提供「用户端表单预览」与保存前校验
 */
export const ProjectsManager = (props: { projects: PanelProject[]; users: PUser[] }) => {
  const [channel, setChannel] = useState<'xiaocan' | 'yyb' | 'custom'>('xiaocan');
  const [keyword, setKeyword] = useState('');
  const [openGrants, setOpenGrants] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [pending, startTransition] = useTransition();

  // 弹窗状态：新增或编辑自定义脚本
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [modalName, setModalName] = useState('');
  const [modalRefId, setModalRefId] = useState('');
  const [modalDesc, setModalDesc] = useState('');
  const [modalCost, setModalCost] = useState(0);
  const [modalEnv, setModalEnv] = useState('');
  const [modalEnvTemplate, setModalEnvTemplate] = useState('');
  const [modalFields, setModalFields] = useState<ScriptFieldParam[]>(DEFAULT_PARAMS);
  const [modalError, setModalError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const [drafts, setDrafts] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(
      props.projects.map(p => [
        p.id,
        {
          points_cost: Number(p.points_cost ?? 0),
          hidden: Boolean(p.hidden),
          min_vip_level: Number(p.min_vip_level ?? 0),
          userIds: (p.grants ?? []).map(g => g.user_id),
        },
      ]),
    ),
  );

  const list = useMemo(
    () =>
      props.projects.filter(
        p =>
          p.channel === channel
          && p.status === 'enabled'
          && (!keyword || p.name.toLowerCase().includes(keyword.toLowerCase())),
      ),
    [props.projects, channel, keyword],
  );

  const draftOf = (id: number): Draft => drafts[id] ?? { points_cost: 0, hidden: false, min_vip_level: 0, userIds: [] };

  const dirtyIds = useMemo(
    () =>
      props.projects
        .filter((p) => {
          const d = draftOf(p.id);
          const grantsBefore = (p.grants ?? []).map(g => g.user_id).sort().join(',');
          const grantsAfter = [...d.userIds].sort().join(',');
          return (
            Number(p.points_cost ?? 0) !== d.points_cost
            || Boolean(p.hidden) !== d.hidden
            || Number(p.min_vip_level ?? 0) !== d.min_vip_level
            || grantsBefore !== grantsAfter
          );
        })
        .map(p => p.id),
    [props.projects, drafts],
  );

  const patch = (id: number, next: Partial<Draft>) => {
    setDrafts((prev) => {
      const cur: Draft = prev[id] ?? { points_cost: 0, hidden: false, min_vip_level: 0, userIds: [] };
      return { ...prev, [id]: { ...cur, ...next } };
    });
  };

  const save = () => {
    const changed = props.projects.filter(p => dirtyIds.includes(p.id));
    startTransition(async () => {
      const priceItems = changed.map(p => ({
        id: p.id,
        points_cost: draftOf(p.id).points_cost,
        hidden: draftOf(p.id).hidden,
        min_vip_level: draftOf(p.id).min_vip_level,
      }));
      const grantItems: Record<number, number[]> = {};
      for (const p of changed) {
        const before = (p.grants ?? []).map(g => g.user_id).sort().join(',');
        const after = [...draftOf(p.id).userIds].sort().join(',');
        if (before !== after) {
          grantItems[p.id] = draftOf(p.id).userIds;
        }
      }
      const text = await projectsSaveAction(priceItems, grantItems);
      setMsg(text.startsWith('ok:') ? text.slice(3) : text.slice(6));
    });
  };

  const toggleGrant = (id: number, userId: number) => {
    const cur = drafts[id]?.userIds ?? [];
    patch(id, { userIds: cur.includes(userId) ? cur.filter(x => x !== userId) : [...cur, userId] });
  };

  // 打开新建弹窗
  const openCreateModal = () => {
    setEditingId(null);
    setModalName('');
    setModalRefId('');
    setModalDesc('');
    setModalCost(0);
    setModalEnv('');
    setModalEnvTemplate('');
    setModalFields([...DEFAULT_PARAMS]);
    setModalError('');
    setModalOpen(true);
  };

  // 打开编辑弹窗
  const openEditModal = (p: PanelProject) => {
    setEditingId(p.id);
    setModalName(p.name);
    setModalRefId(p.ref_id || p.project_key.replace(/^custom:/, ''));
    setModalDesc(p.description || '');
    setModalCost(p.points_cost || 0);
    setModalEnv(p.env_name || '');
    setModalEnvTemplate((p as any).env_template || '');
    setModalFields(p.field_config && p.field_config.length ? [...p.field_config] : [...DEFAULT_PARAMS]);
    setModalError('');
    setModalOpen(true);
  };

  /** 保存前校验：后端会静默丢弃重复 Key，所以必须在这里拦住 */
  const validateModal = (): string | null => {
    if (!modalName.trim()) {
      return '请填写脚本名称';
    }
    const refId = modalRefId.trim();
    // 仅新建时校验唯一标识格式；编辑时该字段只读（是 project_key 的一部分，
    // 改了会断掉历史提交关联），且存量数据可能是中文 slug，不应再校验
    if (!editingId && refId && !/^[\w-]+$/.test(refId)) {
      return '唯一标识只能包含字母、数字、下划线或短横线';
    }
    const seen = new Set<string>();
    for (const [i, f] of modalFields.entries()) {
      const key = f.key.trim();
      if (!key) {
        return `第 ${i + 1} 个字段：Key 不能为空`;
      }
      if (!KEY_RE.test(key)) {
        return `字段「${key}」：Key 只能用字母、数字、下划线，且不能以数字开头`;
      }
      if (seen.has(key)) {
        return `字段 Key 重复：「${key}」。后端会静默丢弃重复字段，请先改名`;
      }
      seen.add(key);
      if (!f.label.trim()) {
        return `字段「${key}」：中文标签不能为空`;
      }
      if (f.type === 'select' && !(f.options ?? []).length) {
        return `字段「${key}」：下拉选择至少需要 1 个选项`;
      }
    }
    return null;
  };

  // 保存自定义脚本
  const handleSaveModal = () => {
    const error = validateModal();
    if (error) {
      setModalError(error);
      return;
    }
    setModalError('');
    startTransition(async () => {
      const fields = modalFields.map(f => ({ ...f, key: f.key.trim(), label: f.label.trim() }));
      // 兼容输入字面 \n：统一转成真实换行符存储
      const desc = modalDesc.trim().replace(/\\n/g, '\n');
      let res: string;
      if (editingId) {
        res = await customScriptUpdateAction(editingId, {
          name: modalName.trim(),
          description: desc,
          points_cost: modalCost,
          env_name: modalEnv.trim(),
          env_template: modalEnvTemplate.trim(),
          field_config: fields,
        });
      } else {
        res = await customScriptCreateAction({
          name: modalName.trim(),
          ref_id: modalRefId.trim(),
          description: desc,
          points_cost: modalCost,
          hidden: false,
          env_name: modalEnv.trim(),
          env_template: modalEnvTemplate.trim(),
          field_config: fields,
        });
      }
      setModalOpen(false);
      setMsg(res.startsWith('ok:') ? res.slice(3) : res.slice(6));
    });
  };

  // 删除自定义脚本（二次确认交给行内 UI，不再用原生 confirm）
  const handleDeleteCustom = (p: PanelProject) => {
    startTransition(async () => {
      const res = await customScriptDeleteAction(p.id);
      setMsg(res.startsWith('ok:') ? res.slice(3) : res.slice(6));
    });
  };

  // 动态字段操作
  const addFieldRow = () => {
    setModalFields(prev => [
      ...prev,
      {
        key: `param_${prev.length + 1}`,
        label: `参数 ${prev.length + 1}`,
        type: 'text',
        placeholder: '',
        required: true,
      },
    ]);
  };

  const removeFieldRow = (index: number) => {
    setModalFields(prev => prev.filter((_, i) => i !== index));
  };

  const moveFieldRow = (index: number, delta: number) => {
    setModalFields((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      return next;
    });
  };

  const updateFieldRow = (index: number, patchVal: Partial<ScriptFieldParam>) => {
    setModalFields(prev => prev.map((f, i) => (i === index ? { ...f, ...patchVal } : f)));
  };

  return (
    <div className="section-enter flex flex-col gap-4">
      {/* 顶部控制栏 */}
      <div className="
        flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3
        py-2 text-sm
      "
      >
        <div className="flex gap-1">
          {(['xiaocan', 'yyb', 'custom'] as const).map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={cn(
                'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
                channel === c
                  ? 'bg-primary text-primary-foreground'
                  : `
                    border bg-background
                    hover:bg-muted
                  `,
              )}
            >
              {c === 'xiaocan' ? '🎫 小蚕 · 大牌券' : c === 'yyb' ? '🤖 应用宝 · 协议服务' : '⚡ 自定义脚本 · 扩展对接'}
            </button>
          ))}
        </div>

        {channel === 'custom' && (
          <button
            type="button"
            onClick={openCreateModal}
            className="
              flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5
              text-xs font-medium text-white shadow-sm
              hover:bg-emerald-700
            "
          >
            <span>+ 新增自定义脚本</span>
          </button>
        )}

        <input
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          placeholder="搜项目名…"
          className="h-8 rounded-md border bg-background px-2 text-sm"
        />

        <span className={dirtyIds.length
          ? 'font-medium text-amber-600'
          : `text-muted-foreground`}
        >
          {dirtyIds.length ? `${dirtyIds.length} 项未保存` : '无改动'}
        </span>

        <button
          type="button"
          onClick={save}
          disabled={pending || dirtyIds.length === 0}
          className="
            rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground
            disabled:opacity-50
          "
        >
          {pending ? '保存中…' : '保存改动'}
        </button>

        {channel !== 'custom' && (
          <a
            href="/dashboard/projects?sync=1"
            className="
              rounded-md border bg-background px-3 py-1.5 text-sm
              hover:bg-muted
            "
          >
            同步目录
          </a>
        )}

        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>

      {/* 提示信息 */}
      {channel === 'custom' && (
        <div className="
          rounded-md border border-indigo-200 bg-indigo-50/60 p-3 text-xs
          text-indigo-900
          dark:border-indigo-900/50 dark:bg-indigo-950/20 dark:text-indigo-200
        "
        >
          💡
          {' '}
          <strong>自定义脚本扩展</strong>
          ：可对接任意独立抓取/签到脚本。管理员配置所需参数后，用户端将在
          <strong>「提交上车」</strong>
          页面自动同步展示动态表单，用户填写提交后将自动校验必填项并按设定消耗（分）。
          <span className="
            mt-1 block text-indigo-800/80
            dark:text-indigo-300/80
          "
          >
            参数 Key 仅支持字母/数字/下划线（不能以数字开头）；支持单行文本、多行文本、密码框、数字与下拉选择五种控件。
          </span>
        </div>
      )}

      {/* 表格 */}
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="row-stagger w-full border-collapse text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">项目名称 / 标识</th>
              {channel === 'custom' && (
                <th className="px-3 py-2 text-left font-medium">
                  参数配置定义
                </th>
              )}
              <th className="w-32 px-3 py-2 text-left font-medium">提交消耗（分）</th>
              <th className="w-24 px-3 py-2 text-center font-medium">隐藏</th>
              <th className="w-32 px-3 py-2 text-left font-medium">
                <span title="达到该会员等级才可见；0 = 不限">等级门槛</span>
              </th>
              <th className="w-32 px-3 py-2 text-left font-medium">可见用户</th>
              {channel === 'custom' && (
                <th className="w-28 px-3 py-2 text-right font-medium">
                  操作
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {list.length === 0
              ? (
                  <tr>
                    <td
                      colSpan={channel === 'custom' ? 7 : 5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      {channel === 'custom' ? '暂无自定义脚本，点击上方「新增自定义脚本」创建' : '暂无匹配的项目'}
                    </td>
                  </tr>
                )
              : (
                  list.map((p) => {
                    const d = draftOf(p.id);
                    const dirty = dirtyIds.includes(p.id);
                    return (
                      <tr
                        key={p.id}
                        className={cn('border-t', dirty && `
                          bg-amber-50/60
                          dark:bg-amber-950/20
                        `)}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">{p.name}</span>
                            {p.env_name && (
                              <span className="
                                rounded-sm bg-sky-100 px-1.5 py-0.5 text-[10px]
                                text-sky-800
                                dark:bg-sky-900/40 dark:text-sky-300
                              "
                              >
                                {p.env_name}
                              </span>
                            )}
                          </div>
                          <div className="
                            font-mono text-[11px] text-muted-foreground
                          "
                          >
                            {p.project_key}
                          </div>
                          {p.description && (
                            <div className="
                              text-[11px] whitespace-pre-line
                              text-muted-foreground/80
                            "
                            >
                              {p.description}
                            </div>
                          )}
                        </td>

                        {channel === 'custom' && (
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {(p.field_config ?? []).map(f => (
                                <span
                                  key={f.key}
                                  className="
                                    inline-flex items-center gap-1 rounded-sm
                                    border bg-muted/60 px-1.5 py-0.5 text-[11px]
                                  "
                                  title={`${f.key} (${f.type}) - ${f.placeholder || '无提示'}`}
                                >
                                  <span className="font-semibold">{f.label}</span>
                                  <span className="
                                    font-mono text-[10px] text-muted-foreground
                                  "
                                  >
                                    {`[${f.key}]`}
                                  </span>
                                  <span className="
                                    text-[10px] text-muted-foreground/80
                                  "
                                  >
                                    {FIELD_TYPES.find(t => t.value === f.type)?.label ?? f.type}
                                  </span>
                                  {f.required && (
                                    <span className="font-bold text-red-500">
                                      *
                                    </span>
                                  )}
                                </span>
                              ))}
                              {(!p.field_config || p.field_config.length === 0) && (
                                <span className="
                                  text-[11px] text-muted-foreground
                                "
                                >
                                  未配置参数
                                </span>
                              )}
                            </div>
                          </td>
                        )}

                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            value={d.points_cost}
                            onChange={e => patch(p.id, { points_cost: Math.max(0, Number(e.target.value) || 0) })}
                            className="
                              h-8 w-24 rounded-md border bg-background px-2
                              text-sm tabular-nums
                            "
                          />
                        </td>

                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            className="size-4 cursor-pointer"
                            checked={d.hidden}
                            onChange={e => patch(p.id, { hidden: e.target.checked })}
                            title="隐藏后只对指定授权的用户可见"
                          />
                        </td>

                        <td className="px-3 py-2">
                          <select
                            value={d.min_vip_level}
                            onChange={e => patch(p.id, { min_vip_level: Number(e.target.value) || 0 })}
                            title="达到该会员等级才可见（隐藏与门槛是两个独立维度）"
                            className="
                              h-8 w-28 rounded-md border bg-background px-2 text-xs
                            "
                          >
                            <option value={0}>不限</option>
                            <option value={1}>高级会员以上</option>
                            <option value={2}>至尊会员以上</option>
                          </select>
                        </td>

                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setOpenGrants(openGrants === p.id ? null : p.id)}
                            className="
                              rounded-sm border bg-background px-2 py-1 text-xs
                              hover:bg-muted
                            "
                          >
                            {d.userIds.length ? `${d.userIds.length} 人可见` : '仅公开'}
                          </button>
                          {openGrants === p.id && (
                            <div className="
                              absolute z-10 mt-1 flex max-h-48 w-56 flex-col
                              gap-1 overflow-y-auto rounded-md border bg-card
                              p-2 text-xs shadow-lg
                            "
                            >
                              {props.users.length === 0 && (
                                <span className="text-muted-foreground">
                                  还没有用户
                                </span>
                              )}
                              {props.users.map(u => (
                                <label
                                  key={u.id}
                                  className="flex items-center gap-2"
                                >
                                  <input
                                    type="checkbox"
                                    className="size-3.5 cursor-pointer"
                                    checked={d.userIds.includes(u.id)}
                                    onChange={() => toggleGrant(p.id, u.id)}
                                  />
                                  <span className="truncate">
                                    {u.nickname || u.email}
                                    <span className="ml-1 text-muted-foreground">{`#${u.id}`}</span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          )}
                        </td>

                        {channel === 'custom' && (
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {confirmDeleteId === p.id
                                ? (
                                    <>
                                      <span className="text-[11px] text-red-600">确认删除？</span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setConfirmDeleteId(null);
                                          handleDeleteCustom(p);
                                        }}
                                        className="
                                          rounded-sm bg-red-600 px-2 py-1
                                          text-[11px] text-white
                                          hover:bg-red-700
                                        "
                                      >
                                        删除
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId(null)}
                                        className="
                                          rounded-sm border px-2 py-1
                                          text-[11px]
                                          hover:bg-muted
                                        "
                                      >
                                        取消
                                      </button>
                                    </>
                                  )
                                : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => openEditModal(p)}
                                        className="
                                          rounded-sm px-2 py-1 text-xs
                                          text-indigo-600
                                          hover:bg-indigo-50
                                          dark:hover:bg-indigo-950/30
                                        "
                                      >
                                        编辑
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId(p.id)}
                                        className="
                                          rounded-sm px-2 py-1 text-xs
                                          text-red-600
                                          hover:bg-red-50
                                          dark:hover:bg-red-950/30
                                        "
                                      >
                                        删除
                                      </button>
                                    </>
                                  )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
          </tbody>
        </table>
      </div>

      {/* 自定义脚本新增/编辑弹窗 */}
      {modalOpen && (
        <div className="
          fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2
          sm:p-4
        "
        >
          <div className="
            flex max-h-[92vh] w-full max-w-3xl flex-col rounded-lg border
            bg-card shadow-2xl
          "
          >
            <div className="
              flex items-center justify-between border-b px-4 py-3
              sm:px-5
            "
            >
              <h3 className="
                text-sm font-semibold
                sm:text-base
              "
              >
                {editingId ? '编辑自定义脚本与参数' : '新增自定义对接脚本'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="关闭"
                className="
                  text-sm text-muted-foreground
                  hover:text-foreground
                "
              >
                ✕
              </button>
            </div>

            <div className="
              flex-1 space-y-4 overflow-y-auto p-4 text-sm
              sm:p-5
            "
            >
              {modalError && (
                <div className="
                  rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs
                  text-red-700
                  dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300
                "
                >
                  ⚠️
                  {' '}
                  {modalError}
                </div>
              )}

              <div className="
                grid grid-cols-1 gap-3
                sm:grid-cols-2
              "
              >
                <div>
                  <label className="mb-1 block text-xs font-medium">脚本名称 *</label>
                  <input
                    className="
                      w-full rounded-sm border bg-background px-3 py-1.5 text-sm
                    "
                    placeholder="如 京东自动抓CK"
                    value={modalName}
                    onChange={e => setModalName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">唯一标识 (Ref ID)</label>
                  <input
                    className="
                      w-full rounded-sm border bg-background px-3 py-1.5 text-sm
                      disabled:opacity-60
                    "
                    placeholder="如 jd_auto_ck（留空自动生成）"
                    disabled={!!editingId}
                    value={modalRefId}
                    onChange={e => setModalRefId(e.target.value)}
                  />
                </div>
              </div>

              <div className="
                grid grid-cols-1 gap-3
                sm:grid-cols-2
              "
              >
                <div>
                  <label className="mb-1 block text-xs font-medium">每次提交消耗（分）</label>
                  <input
                    type="number"
                    min={0}
                    className="
                      w-full rounded-sm border bg-background px-3 py-1.5 text-sm
                    "
                    placeholder="0 为免费"
                    value={modalCost}
                    onChange={e => setModalCost(Math.max(0, Number(e.target.value) || 0))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">青龙环境变量名 (可选)</label>
                  <input
                    className="
                      w-full rounded-sm border bg-background px-3 py-1.5 text-sm
                    "
                    placeholder="如 JD_COOKIE"
                    value={modalEnv}
                    onChange={e => setModalEnv(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">变量值拼装模板 (可选)</label>
                  <input
                    className="w-full rounded-sm border bg-background px-3 py-1.5 text-sm font-mono"
                    placeholder="如 {unionId}#{idenId}，留空取第一个非 account 参数"
                    value={modalEnvTemplate}
                    onChange={e => setModalEnvTemplate(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">说明与注意事项</label>
                <textarea
                  rows={4}
                  className="
                    w-full rounded-sm border bg-background px-3 py-1.5 text-sm
                  "
                  placeholder={'用户在提交页面看到的提示说明\n支持直接回车换行，也可输入 \\n 表示换行'}
                  value={modalDesc}
                  onChange={e => setModalDesc(e.target.value)}
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  直接回车即可换行；用户端会原样按行展示。
                </p>
              </div>

              {/* 动态参数配置区 */}
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">动态参数字段定义</h4>
                    <p className="text-[11px] text-muted-foreground">用户侧将根据以下参数列表自动渲染对应表单</p>
                  </div>
                  <button
                    type="button"
                    onClick={addFieldRow}
                    className="
                      rounded-sm bg-primary/10 px-2 py-1 text-xs font-medium
                      text-primary
                      hover:bg-primary/20
                    "
                  >
                    + 添加字段
                  </button>
                </div>

                <div className="space-y-2">
                  {modalFields.map((field, idx) => (
                    <div
                      key={idx}
                      className="rounded-sm border bg-card p-2 text-xs"
                    >
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="w-24">
                          <span className="
                            block text-[10px] text-muted-foreground
                          "
                          >
                            字段Key
                          </span>
                          <input
                            className={cn(
                              `
                                w-full rounded-sm border bg-background px-2 py-1
                                font-mono text-xs
                              `,
                              field.key.trim() && !KEY_RE.test(field.key.trim()) && `
                                border-red-400
                              `,
                            )}
                            placeholder="key"
                            value={field.key}
                            onChange={e => updateFieldRow(idx, { key: e.target.value })}
                          />
                        </div>
                        <div className="w-32">
                          <span className="
                            block text-[10px] text-muted-foreground
                          "
                          >
                            中文标签
                          </span>
                          <input
                            className="
                              w-full rounded-sm border bg-background px-2 py-1
                              text-xs
                            "
                            placeholder="标签名"
                            value={field.label}
                            onChange={e => updateFieldRow(idx, { label: e.target.value })}
                          />
                        </div>
                        <div className="w-24">
                          <span className="
                            block text-[10px] text-muted-foreground
                          "
                          >
                            输入类型
                          </span>
                          <select
                            className="
                              w-full rounded-sm border bg-background px-1.5 py-1
                              text-xs
                            "
                            value={field.type}
                            onChange={e =>
                              updateFieldRow(idx, { type: e.target.value as ScriptFieldParam['type'] })}
                          >
                            {FIELD_TYPES.map(t => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-[120px] flex-1">
                          <span className="
                            block text-[10px] text-muted-foreground
                          "
                          >
                            占位提示
                          </span>
                          <input
                            className="
                              w-full rounded-sm border bg-background px-2 py-1
                              text-xs
                            "
                            placeholder="placeholder"
                            value={field.placeholder || ''}
                            onChange={e => updateFieldRow(idx, { placeholder: e.target.value })}
                          />
                        </div>
                        <div className="w-28">
                          <span className="
                            block text-[10px] text-muted-foreground
                          "
                          >
                            默认值
                          </span>
                          <input
                            className="
                              w-full rounded-sm border bg-background px-2 py-1
                              text-xs
                            "
                            placeholder="可留空"
                            value={field.default_value || ''}
                            onChange={e => updateFieldRow(idx, { default_value: e.target.value })}
                          />
                        </div>
                        <div className="flex items-center gap-1 pb-1.5">
                          <input
                            type="checkbox"
                            id={`req_${idx}`}
                            checked={field.required}
                            onChange={e => updateFieldRow(idx, { required: e.target.checked })}
                            className="size-3.5 cursor-pointer"
                          />
                          <label
                            htmlFor={`req_${idx}`}
                            className="
                              cursor-pointer text-[11px] text-muted-foreground
                            "
                          >
                            必填
                          </label>
                        </div>
                        <div className="flex items-center gap-0.5 pb-1">
                          <button
                            type="button"
                            onClick={() => moveFieldRow(idx, -1)}
                            disabled={idx === 0}
                            title="上移"
                            className="
                              rounded-sm px-1 text-muted-foreground
                              hover:bg-muted
                              disabled:opacity-30
                            "
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveFieldRow(idx, 1)}
                            disabled={idx === modalFields.length - 1}
                            title="下移"
                            className="
                              rounded-sm px-1 text-muted-foreground
                              hover:bg-muted
                              disabled:opacity-30
                            "
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFieldRow(idx)}
                            title="删除该字段"
                            className="
                              px-1 text-red-500
                              hover:text-red-700
                            "
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {field.type === 'select' && (
                        <div className="mt-2">
                          <span className="
                            block text-[10px] text-muted-foreground
                          "
                          >
                            下拉选项（每行一个，格式 值=显示名，可省略显示名）
                          </span>
                          <textarea
                            rows={3}
                            className="
                              w-full resize rounded-sm border bg-background px-2
                              py-1 font-mono text-xs
                            "
                            placeholder={'1=微信\n2=支付宝'}
                            value={optionsToText(field.options)}
                            onChange={e => updateFieldRow(idx, { options: parseOptionsText(e.target.value) })}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 用户端预览 */}
              {modalFields.length > 0 && (
                <div className="rounded-md border bg-muted/20 p-3">
                  <h4 className="mb-2 text-xs font-semibold text-foreground">用户端表单预览</h4>
                  <div className="space-y-2.5">
                    {modalFields.map((f, idx) => (
                      <div key={idx} className="space-y-1">
                        <div className="
                          flex items-center gap-1 text-[11px] font-medium
                        "
                        >
                          <span>{f.label || f.key || '未命名字段'}</span>
                          <span className="
                            font-mono text-[10px] text-muted-foreground
                          "
                          >
                            {`(${f.key})`}
                          </span>
                          {f.required && (
                            <span className="font-bold text-red-500">
                              *
                            </span>
                          )}
                        </div>
                        {f.type === 'textarea'
                          ? (
                              <textarea
                                disabled
                                rows={2}
                                placeholder={f.placeholder || `请输入 ${f.label}`}
                                defaultValue={f.default_value}
                                className="
                                  w-full rounded-md border bg-background px-3
                                  py-2 font-mono text-xs
                                "
                              />
                            )
                          : f.type === 'select'
                            ? (
                                <select
                                  disabled
                                  defaultValue={f.default_value || ''}
                                  className="
                                    w-full rounded-md border bg-background px-3
                                    py-2 text-xs
                                  "
                                >
                                  <option value="">{f.placeholder || `请选择 ${f.label}`}</option>
                                  {(f.options ?? []).map(o => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              )
                            : (
                                <input
                                  disabled
                                  type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : 'text'}
                                  placeholder={f.placeholder || `请输入 ${f.label}`}
                                  defaultValue={f.default_value}
                                  className="
                                    w-full rounded-md border bg-background px-3
                                    py-2 text-xs
                                  "
                                />
                              )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="
              flex justify-end gap-2 border-t bg-muted/20 px-4 py-3
              sm:px-5
            "
            >
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="
                  rounded-sm border bg-background px-3 py-1.5 text-xs
                  hover:bg-muted
                "
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveModal}
                disabled={pending}
                className="
                  rounded-sm bg-primary px-4 py-1.5 text-xs font-medium
                  text-primary-foreground
                  hover:opacity-90
                  disabled:opacity-50
                "
              >
                {pending ? '正在保存…' : '确认保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
