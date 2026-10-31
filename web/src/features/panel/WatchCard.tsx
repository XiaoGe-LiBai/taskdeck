'use client';

import type { StoreWatch } from './actions';
import { useActionState, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  createWatchAction,
  deleteWatchAction,
  runWatchAction,
  setWatchStatusAction,
} from './actions';
import { Card, Empty, Tag } from './Ui';

const KIND_LABEL: Record<string, string> = {
  keyword: '关键词找新店',
  name: '指定店名出现',
  stock: '名额捡漏',
  dual: '同店多方案',
};

const KIND_HINT: Record<string, string> = {
  keyword: '按关键词搜店，出现新店就通知',
  name: '店名完全匹配（含关键词即可）',
  stock: '盯某个活动的剩余名额，>0 就通知',
  dual: '首页里同一家店出现多个方案时通知',
};

const formatTime = (ts: number) =>
  ts > 0 ? new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false }) : '—';

/** 店铺监控：四类监控的创建、启停、立即执行、删除。 */
export const WatchCard = (props: {
  watches: StoreWatch[];
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
  defaultLocation: { lat: string; lon: string; city: string };
}) => {
  const [createState, createAction, creating] = useActionState(createWatchAction, '');
  const [delState, delAction] = useActionState(deleteWatchAction, '');
  const [rowMessage, setRowMessage] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState('');

  const run = async (id: number) => {
    setBusy(`run-${id}`);
    const res = await runWatchAction(id);
    setBusy('');
    setRowMessage(prev => ({ ...prev, [id]: res.ok ? res.msg : res.msg }));
  };

  const toggle = async (watch: StoreWatch) => {
    setBusy(`toggle-${watch.id}`);
    const res = await setWatchStatusAction(watch.id, watch.status === 'active' ? 'paused' : 'active');
    setBusy('');
    if (!res.ok) {
      setRowMessage(prev => ({ ...prev, [watch.id]: res.msg }));
    }
  };

  return (
    <Card
      title="店铺监控"
      description="只做发现与通知，不自动抢单；命中会推送到已配置的通知渠道"
    >
      <form
        action={createAction}
        className="
          mb-4 grid gap-2
          sm:grid-cols-3
          lg:grid-cols-6
        "
      >
        <label className="flex flex-col gap-1 text-xs font-medium">
          使用账号
          <select
            name="account_id"
            className="h-8 rounded-md border bg-background px-2 text-xs"
            required
          >
            {props.accounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.nickname || account.account_info}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          类型
          <select
            name="kind"
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          关键词
          <Input name="keyword" placeholder="店名关键词" className="h-8 text-xs" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          活动 ID
          <Input
            name="promotion_id"
            placeholder="名额监控必填"
            className="h-8 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          间隔（秒）
          <Input
            name="interval_sec"
            type="number"
            defaultValue="300"
            className="h-8 text-xs"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={creating}
            className="
              h-8 w-full rounded-md bg-brand-gradient px-3 text-xs font-semibold
              text-white
              disabled:opacity-50
            "
          >
            {creating ? '创建中…' : '创建监控'}
          </button>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium">
          纬度
          <Input
            name="lat"
            defaultValue={props.defaultLocation.lat}
            className="h-8 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          经度
          <Input
            name="lon"
            defaultValue={props.defaultLocation.lon}
            className="h-8 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          城市码
          <Input
            name="city_code"
            defaultValue={props.defaultLocation.city}
            className="h-8 text-xs"
          />
        </label>
      </form>
      {createState && (
        <div className="mb-3 text-xs text-muted-foreground">{createState.replace(/^(ok|error):/, '')}</div>
      )}
      {delState && (
        <div className="mb-3 text-xs text-muted-foreground">{delState.replace(/^(ok|error):/, '')}</div>
      )}

      {props.watches.length
        ? (
            <ul className="flex flex-col gap-2">
              {props.watches.map(item => (
                <li key={item.id} className="rounded-lg border p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag tone={item.status === 'active' ? 'success' : 'gray'}>
                      {item.status === 'active' ? '运行中' : '已暂停'}
                    </Tag>
                    <span className="font-medium">{KIND_LABEL[item.kind] ?? item.kind}</span>
                    <span className="text-muted-foreground">
                      {item.params.keyword || item.params.promotion_id || '—'}
                    </span>
                    <span className="text-muted-foreground">{`每 ${item.interval_sec}s`}</span>
                    <span className="text-muted-foreground">{`命中 ${item.hits}`}</span>
                    <span className="text-muted-foreground">{`上次 ${formatTime(item.last_run)}`}</span>
                    <div className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        disabled={busy === `run-${item.id}`}
                        onClick={() => run(item.id)}
                        className="
                          rounded-sm border px-2 py-0.5
                          hover:bg-muted
                          disabled:opacity-50
                        "
                      >
                        {busy === `run-${item.id}` ? '执行中…' : '立即执行'}
                      </button>
                      <button
                        type="button"
                        disabled={busy === `toggle-${item.id}`}
                        onClick={() => toggle(item)}
                        className="
                          rounded-sm border px-2 py-0.5
                          hover:bg-muted
                          disabled:opacity-50
                        "
                      >
                        {item.status === 'active' ? '暂停' : '恢复'}
                      </button>
                      <form action={delAction}>
                        <input type="hidden" name="watch_id" value={item.id} />
                        <button
                          type="submit"
                          className="
                            rounded-sm border px-2 py-0.5
                            hover:bg-muted
                          "
                        >
                          删除
                        </button>
                      </form>
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {KIND_HINT[item.kind] ?? ''}
                  </div>
                  {(rowMessage[item.id] || item.last_error) && (
                    <div className="
                      mt-1 text-[10px] break-all text-muted-foreground
                    "
                    >
                      {rowMessage[item.id] || item.last_error}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        : <Empty text="还没有监控任务" />}
    </Card>
  );
};
