'use client';

import type { StoreItem } from './actions';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { fetchStoresAction } from './actions';
import { Card, Empty, Tag } from './Ui';

type Kind = 'feed' | 'search' | 'explore';

const TABS: Array<{ key: Kind; label: string; hint: string }> = [
  { key: 'feed', label: '附近外卖', hint: '按定位推送附近的外卖霸王餐，主源空时自动换备源' },
  { key: 'search', label: '搜索店铺', hint: '输入店名关键词搜索' },
  { key: 'explore', label: '到店团购', hint: '到店/探店类团购霸王餐' },
];

/** 默认定位：深圳福田（可在页面上改，不落库） */
const DEFAULT_LOCATION = { lat: '22.5431', lon: '114.0579', city: '440303' };

const text = (item: StoreItem, keys: string[]): string => {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return '';
};

const storeName = (item: StoreItem) =>
  text(item, ['meituan_shop_url', 'shop_name', 'store_name', 'poi_name', 'name', 'title']) || '未命名店铺';

const storeDistance = (item: StoreItem) => {
  const raw = item.distance;
  if (typeof raw !== 'number') {
    return '';
  }
  return raw >= 1000 ? `${(raw / 1000).toFixed(1)} km` : `${Math.round(raw)} m`;
};

/** 返现金额：上游以「分」为单位 */
const storeRebate = (item: StoreItem) => {
  const raw = item.order_money ?? item.rebate_money ?? item.back_money;
  if (typeof raw !== 'number' || raw <= 0) {
    return '';
  }
  return `返 ${(raw / 100).toFixed(2)} 元`;
};

export const StoresExplorer = (props: {
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
}) => {
  const [accountId, setAccountId] = useState(props.accounts[0]?.id ?? 0);
  const [kind, setKind] = useState<Kind>('feed');
  const [keyword, setKeyword] = useState('');
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<StoreItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  if (!props.accounts.length) {
    return (
      <Card title="附近霸王餐" description="先绑定一个小蚕账号，才能代你查询店铺">
        <Empty text="还没有绑定小蚕账号" />
      </Card>
    );
  }

  const load = async (nextOffset: number) => {
    setPending(true);
    setMessage('');
    const result = await fetchStoresAction({
      accountId,
      kind,
      q: keyword,
      lat: location.lat,
      lon: location.lon,
      cityCode: location.city,
      offset: nextOffset,
    });
    setPending(false);
    if (!result.ok) {
      setMessage(result.msg);
      setItems([]);
      return;
    }
    setItems(result.items);
    setTotal(result.total);
    setOffset(nextOffset);
    if (!result.items.length) {
      setMessage('这一页没有结果，换个位置或关键词试试');
    }
  };

  const currentHint = TABS.find(tab => tab.key === kind)?.hint ?? '';

  return (
    <div className="flex flex-col gap-4">
      <Card title="查询条件" description={currentHint}>
        <div className="
          grid gap-3
          sm:grid-cols-2 lg:grid-cols-5
        "
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            使用账号
            <select
              value={accountId}
              onChange={e => setAccountId(Number(e.target.value))}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {props.accounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.nickname || account.account_info}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            纬度
            <Input
              value={location.lat}
              onChange={e => setLocation(prev => ({ ...prev, lat: e.target.value }))}
              className="h-9"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            经度
            <Input
              value={location.lon}
              onChange={e => setLocation(prev => ({ ...prev, lon: e.target.value }))}
              className="h-9"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            城市码
            <Input
              value={location.city}
              onChange={e => setLocation(prev => ({ ...prev, city: e.target.value }))}
              className="h-9"
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={pending}
              onClick={() => load(0)}
              className="
                h-9 w-full rounded-md bg-brand-gradient px-4 text-sm
                font-semibold text-white
                hover:opacity-90
                disabled:opacity-50
              "
            >
              {pending ? '查询中…' : '查询'}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setKind(tab.key);
                setMessage('');
              }}
              className={`
                rounded-md border px-3 py-1.5 text-xs font-medium
                ${kind === tab.key ? `bg-muted` : `hover:bg-muted/60`}
              `}
            >
              {tab.label}
            </button>
          ))}
          {kind === 'search' && (
            <Input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="店名关键词，如 瑞幸"
              className="h-8 w-56 text-xs"
            />
          )}
        </div>

        {message && (
          <div className="
            mt-3 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground
          "
          >
            {message}
          </div>
        )}
      </Card>

      <Card
        title={`结果 ${items.length} 条${total ? ` / 共 ${total}` : ''}`}
        description="距离与返现金额来自小蚕平台；点「下一页」继续翻"
      >
        {items.length
          ? (
              <div className="flex flex-col gap-2">
                {items.map((item, index) => (
                  <div
                    key={`${storeName(item)}-${index}`}
                    className="
                      flex flex-wrap items-center justify-between gap-2 rounded-lg
                      border p-3
                    "
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {storeName(item)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {storeDistance(item) && <span>{storeDistance(item)}</span>}
                        {storeRebate(item) && <Tag tone="warning">{storeRebate(item)}</Tag>}
                        {typeof item.left_number === 'number' && (
                          <span>{`剩余名额 ${item.left_number}`}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          : <Empty text="还没有查询结果" />}

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            disabled={pending || offset === 0}
            onClick={() => load(Math.max(0, offset - 20))}
            className="
              rounded-md border px-3 py-1.5 text-xs
              hover:bg-muted
              disabled:opacity-40
            "
          >
            上一页
          </button>
          <span className="text-xs text-muted-foreground">{`偏移 ${offset}`}</span>
          <button
            type="button"
            disabled={pending || items.length < 20}
            onClick={() => load(offset + 20)}
            className="
              rounded-md border px-3 py-1.5 text-xs
              hover:bg-muted
              disabled:opacity-40
            "
          >
            下一页
          </button>
        </div>
      </Card>
    </div>
  );
};
