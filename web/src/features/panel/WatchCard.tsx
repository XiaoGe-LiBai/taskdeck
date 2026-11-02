'use client';

import type { StoreWatch, WatchHit } from './actions';
import { useActionState, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  createWatchAction,
  deleteWatchAction,
  fetchWatchHitsAction,
  resetWatchSeenAction,
  runWatchAction,
  setWatchStatusAction,
  updateWatchAction,
} from './actions';
import { useGeoLocation } from './location/LocationContext';
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

/** 店铺监控：四类监控的创建、启停、立即执行、参数编辑、命中回看与删除。 */
export const WatchCard = (props: {
  watches: StoreWatch[];
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
}) => {
  const [createState, createAction, creating] = useActionState(createWatchAction, '');
  // 监控的位置跟全局定位走：一个号盯一个城市，没定位就别创建（否则盯的是错城市的名额）
  const { location, open: openLocation } = useGeoLocation();
  const [delState, delAction] = useActionState(deleteWatchAction, '');
  const [rowMessage, setRowMessage] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [hitsOpen, setHitsOpen] = useState<number | null>(null);
  const [hits, setHits] = useState<Record<number, WatchHit[]>>({});

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

  /** 命中记录是点开才拉的，免得每张卡片都多一次请求。 */
  const toggleHits = async (id: number) => {
    if (hitsOpen === id) {
      setHitsOpen(null);
      return;
    }
    setHitsOpen(id);
    setBusy(`hits-${id}`);
    const res = await fetchWatchHitsAction(id);
    setBusy('');
    if (!res.ok) {
      setRowMessage(prev => ({ ...prev, [id]: res.msg }));
      return;
    }
    setHits(prev => ({ ...prev, [id]: res.hits }));
  };

  const resetSeen = async (id: number) => {
    setBusy(`reset-${id}`);
    const res = await resetWatchSeenAction(id);
    setBusy('');
    setRowMessage(prev => ({ ...prev, [id]: res.msg }));
    if (res.ok) {
      setHits(prev => ({ ...prev, [id]: [] }));
    }
  };

  return (
    <Card
      title="店铺监控"
      description="只做发现与通知，不自动抢单；命中会推送到已配置的通知渠道"
    >
      {!location && (
        <div className="
          mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md
          border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs
          text-amber-700
          dark:text-amber-300
        "
        >
          <span>未设置定位：监控会按城市匹配名额，请先设置再创建。</span>
          <button
            type="button"
            onClick={openLocation}
            className="rounded-md border border-amber-500/40 px-2 py-1"
          >
            去设置定位
          </button>
        </div>
      )}
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
            disabled={creating || !location}
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
            defaultValue={location?.lat ?? ''}
            className="h-8 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          经度
          <Input
            name="lon"
            defaultValue={location?.lon ?? ''}
            className="h-8 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          城市码
          <Input
            name="city_code"
            defaultValue={location?.cityCode ?? ''}
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
                        disabled={busy === `hits-${item.id}`}
                        onClick={() => toggleHits(item.id)}
                        className="
                          rounded-sm border px-2 py-0.5
                          hover:bg-muted
                          disabled:opacity-50
                        "
                      >
                        {hitsOpen === item.id ? '收起记录' : '命中记录'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(editing === item.id ? null : item.id)}
                        className="
                          rounded-sm border px-2 py-0.5
                          hover:bg-muted
                        "
                      >
                        {editing === item.id ? '收起编辑' : '编辑'}
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

                  {editing === item.id && (
                    <EditForm
                      watch={item}
                      onDone={() => setEditing(null)}
                      onReset={resetSeen}
                      resetting={busy === `reset-${item.id}`}
                    />
                  )}

                  {hitsOpen === item.id && (
                    <div className="mt-2 border-t pt-2 text-[10px]">
                      {(hits[item.id] ?? []).length
                        ? (
                            <ul className="flex flex-col gap-1">
                              {(hits[item.id] ?? []).map(hit => (
                                <li
                                  key={hit.item_key}
                                  className="
                                    flex flex-wrap items-baseline gap-2
                                  "
                                >
                                  <span className="font-medium">{hit.title}</span>
                                  <span className="text-muted-foreground">{hit.detail}</span>
                                  <span className="
                                    ml-auto text-muted-foreground
                                  "
                                  >
                                    {hit.first_seen}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )
                        : <div className="text-muted-foreground">还没有命中记录</div>}
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

/** 编辑监控条件与节奏。类型不可改，只能删除重建。 */
function EditForm(props: {
  watch: StoreWatch;
  onDone: () => void;
  onReset: (id: number) => void;
  resetting: boolean;
}) {
  const kind = props.watch.kind;
  const [keyword, setKeyword] = useState(props.watch.params.keyword ?? '');
  const [promotionId, setPromotionId] = useState(props.watch.params.promotion_id ?? '');
  const [lat, setLat] = useState(props.watch.params.lat ?? '');
  const [lon, setLon] = useState(props.watch.params.lon ?? '');
  const [cityCode, setCityCode] = useState(props.watch.params.city_code ?? '');
  const [intervalSec, setIntervalSec] = useState(String(props.watch.interval_sec));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const params: Record<string, string> = { lat, lon, city_code: cityCode };
    if (keyword.trim()) {
      params.keyword = keyword.trim();
    }
    if (promotionId.trim()) {
      params.promotion_id = promotionId.trim();
    }
    setBusy(true);
    const res = await updateWatchAction(props.watch.id, {
      params,
      interval_sec: Number(intervalSec || 0),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.msg);
      return;
    }
    props.onDone();
  };

  return (
    <div className="
      mt-2 grid gap-2 border-t pt-2 text-xs
      sm:grid-cols-2
      lg:grid-cols-4
    "
    >
      <div className="
        text-[10px] text-muted-foreground
        lg:col-span-4
      "
      >
        {`类型「${KIND_LABEL[kind] ?? kind}」不可修改，需要换类型请删除后重建`}
      </div>
      {(kind === 'keyword' || kind === 'name') && (
        <label className="flex flex-col gap-1 font-medium">
          关键词
          <Input
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            className="h-8 text-xs"
          />
        </label>
      )}
      {kind === 'stock' && (
        <label className="flex flex-col gap-1 font-medium">
          活动 ID
          <Input
            value={promotionId}
            onChange={event => setPromotionId(event.target.value)}
            className="h-8 text-xs"
          />
        </label>
      )}
      <label className="flex flex-col gap-1 font-medium">
        间隔（秒）
        <Input
          value={intervalSec}
          type="number"
          onChange={event => setIntervalSec(event.target.value)}
          className="h-8 text-xs"
        />
      </label>
      <label className="flex flex-col gap-1 font-medium">
        纬度
        <Input
          value={lat}
          onChange={event => setLat(event.target.value)}
          className="h-8 text-xs"
        />
      </label>
      <label className="flex flex-col gap-1 font-medium">
        经度
        <Input
          value={lon}
          onChange={event => setLon(event.target.value)}
          className="h-8 text-xs"
        />
      </label>
      <label className="flex flex-col gap-1 font-medium">
        城市码
        <Input
          value={cityCode}
          onChange={event => setCityCode(event.target.value)}
          className="h-8 text-xs"
        />
      </label>
      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="
            h-8 rounded-md bg-brand-gradient px-3 text-xs font-semibold
            text-white
            disabled:opacity-50
          "
        >
          {busy ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          onClick={props.onDone}
          className="
            h-8 rounded-md border px-3 text-xs
            hover:bg-muted
          "
        >
          取消
        </button>
        <button
          type="button"
          disabled={props.resetting}
          onClick={() => props.onReset(props.watch.id)}
          className="
            h-8 rounded-md border px-3 text-xs
            hover:bg-muted
            disabled:opacity-50
          "
        >
          {props.resetting ? '重置中…' : '重置去重'}
        </button>
      </div>
      {error && (
        <div className="
          text-[10px] text-destructive
          sm:col-span-2
          lg:col-span-4
        "
        >
          {error}
        </div>
      )}
    </div>
  );
}
