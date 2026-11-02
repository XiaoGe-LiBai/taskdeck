'use client';

import type { DualRebateStore, GrabJob, StoreItem } from './actions';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  fetchDualRebateStoresAction,
  fetchSchedulerAction,
  fetchStoresAction,
  grabPromotionAction,
} from './actions';
import { useGeoLocation } from './location/LocationContext';
import { Card, Empty, Tag } from './Ui';

/**
 * 霸王餐抢单与预约。
 *
 * 结构与开源版一致：顶部四个标签页（附近店铺 / 大牌券专享 / 同店双返利 /
 * 预约与监听），每个标签页里是可抢单的店铺列表。大牌券专享不是独立接口，
 * 它是附近店铺里 need_brand_coupon 为真的那一批，所以只在本地拆分一次。
 */
type TabKey = 'stores' | 'brand' | 'dual' | 'appointments';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'stores', label: '附近店铺' },
  { key: 'brand', label: '大牌券专享' },
  { key: 'dual', label: '美团同店双返利' },
  { key: 'appointments', label: '预约与监听' },
];

const FIRST_KEYS = ['shop_name', 'store_name', 'poi_name', 'name', 'title', 'meituan_shop_url'];

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

const storeName = (item: StoreItem) => text(item, FIRST_KEYS) || '未命名店铺';

const storeDistance = (item: StoreItem) => {
  const raw = item.distance;
  if (typeof raw !== 'number') {
    return '';
  }
  return raw >= 1000 ? `${(raw / 1000).toFixed(1)} km` : `${Math.round(raw)} m`;
};

const storeRebate = (item: StoreItem) => {
  const raw = item.order_money ?? item.rebate_money ?? item.back_money;
  if (typeof raw !== 'number' || raw <= 0) {
    return '';
  }
  return `返 ¥${(raw / 100).toFixed(2)}`;
};

const promoId = (item: StoreItem) => {
  for (const key of ['promotion_id', 'id', 'promotionId']) {
    const value = item[key];
    if (typeof value === 'number' || (typeof value === 'string' && value.trim())) {
      return String(value).trim();
    }
  }
  return '';
};

const isBrand = (item: StoreItem) => {
  const flag = item.need_brand_coupon ?? item.brand_coupon ?? item.needBrandCoupon;
  if (typeof flag === 'boolean') {
    return flag;
  }
  if (typeof flag === 'number') {
    return flag > 0;
  }
  return String(flag ?? '') === 'true' || String(flag ?? '') === '1';
};

const leftText = (item: StoreItem) => {
  const left = item.left_number ?? item.left_num;
  return typeof left === 'number' ? `剩余名额 ${left}` : '';
};

export const XiaocanSniping = (props: {
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
}) => {
  const [accountId, setAccountId] = useState(props.accounts[0]?.id ?? 0);
  const [tab, setTab] = useState<TabKey>('stores');
  const [items, setItems] = useState<StoreItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [dualStores, setDualStores] = useState<DualRebateStore[]>([]);
  const [jobs, setJobs] = useState<GrabJob[]>([]);
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const { location, open: openLocation } = useGeoLocation();

  const brandItems = useMemo(() => items.filter(isBrand), [items]);
  const normalItems = useMemo(() => items.filter(item => !isBrand(item)), [items]);

  const requireLocation = useCallback(() => {
    if (location) {
      return true;
    }
    setMessage({ ok: false, text: '请先设置定位：不设默认城市，否则拿到的店和名额都是错的' });
    openLocation();
    return false;
  }, [location, openLocation]);

  const loadStores = useCallback(async (q = '') => {
    if (!requireLocation()) {
      return;
    }
    setPending('stores');
    setMessage(null);
    const result = await fetchStoresAction({
      accountId,
      kind: q ? 'search' : 'feed',
      q,
      lat: location!.lat,
      lon: location!.lon,
      cityCode: location!.cityCode,
    });
    setPending('');
    if (!result.ok) {
      setMessage({ ok: false, text: result.msg });
      setItems([]);
      return;
    }
    setItems(result.items);
    setMessage(
      result.items.length
        ? null
        : { ok: false, text: '这一页没有结果，换个定位或关键词试试' },
    );
  }, [accountId, location, requireLocation]);

  const scanDual = useCallback(async () => {
    if (!requireLocation()) {
      return;
    }
    setPending('dual');
    setMessage(null);
    const result = await fetchDualRebateStoresAction({
      accountId,
      lat: location!.lat,
      lon: location!.lon,
      cityCode: location!.cityCode,
      q: keyword,
    });
    setPending('');
    if (!result.ok) {
      setMessage({ ok: false, text: result.msg });
      return;
    }
    setDualStores(result.stores);
    setMessage(
      result.stores.length
        ? null
        : { ok: false, text: '附近没有同店多方案的门店，换个定位再扫一次' },
    );
  }, [accountId, keyword, location, requireLocation]);

  const loadJobs = useCallback(async () => {
    const result = await fetchSchedulerAction();
    if (result.ok) {
      setJobs(result.jobs);
    }
  }, []);

  useEffect(() => {
    if (!props.accounts.length) {
      return;
    }
    void loadStores();
    void loadJobs();
  }, [props.accounts.length, loadStores, loadJobs]);

  const grab = async (id: string) => {
    if (!id) {
      setMessage({ ok: false, text: '这家店没有活动 ID，无法抢单' });
      return;
    }
    setPending(`grab-${id}`);
    const result = await grabPromotionAction({
      accountId,
      promotionId: id,
      lat: location?.lat,
      lon: location?.lon,
      cityCode: location?.cityCode,
    });
    setPending('');
    setMessage({ ok: result.ok, text: result.ok ? `抢单成功：${result.msg}` : result.msg });
    if (result.ok) {
      void loadJobs();
    }
  };

  if (!props.accounts.length) {
    return (
      <Card title="霸王餐抢单与预约" description="先绑定小蚕账号，才能代你查店与抢单">
        <Empty text="还没有绑定小蚕账号" />
      </Card>
    );
  }

  const renderStoreRow = (item: StoreItem, index: number) => {
    const id = promoId(item);
    const busy = pending === `grab-${id}`;
    return (
      <div
        key={`${storeName(item)}-${id || index}`}
        className="
          flex flex-wrap items-center justify-between gap-2 rounded-lg border
          p-3
        "
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{storeName(item)}</span>
            {isBrand(item) && <Tag tone="primary">大牌券</Tag>}
          </div>
          <div className="
            mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground
          "
          >
            {storeDistance(item) && <span>{storeDistance(item)}</span>}
            {storeRebate(item) && <Tag tone="warning">{storeRebate(item)}</Tag>}
            {leftText(item) && <span>{leftText(item)}</span>}
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void grab(id)}
          className="
            rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-medium
            text-white shadow-sm transition-all duration-150
            hover:opacity-95
            active:scale-95
            disabled:opacity-50
          "
        >
          {busy ? '抢单中…' : '立即抢单'}
        </button>
      </div>
    );
  };

  return (
    <Card
      title="霸王餐抢单与预约"
      description="查看附近外卖返利活动，支持即时抢单、定时预约与名额监听"
      actions={(
        <div className="flex items-center gap-2">
          <select
            value={accountId}
            onChange={e => setAccountId(Number(e.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            {props.accounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.nickname || account.account_info}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void (tab === 'dual' ? scanDual() : loadStores(keyword))}
            disabled={Boolean(pending)}
            className="
              rounded-md border px-3 py-1.5 text-xs font-medium
              hover:bg-muted
              disabled:opacity-50
            "
          >
            {pending === 'stores' || pending === 'dual' ? '查询中…' : (tab === 'dual' ? '扫描同店双返利' : '刷新')}
          </button>
        </div>
      )}
    >
      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {TABS.map(item => (
          <button
            key={item.key}
            type="button"
            aria-pressed={tab === item.key}
            onClick={() => {
              setTab(item.key);
              if (item.key === 'appointments') {
                void loadJobs();
              }
            }}
            className={`
              rounded-md px-3 py-1.5 text-sm font-medium transition-colors
              ${tab === item.key
            ? 'bg-brand-gradient text-white shadow-sm'
            : `
              text-muted-foreground
              hover:bg-muted
            `}
            `}
          >
            {item.label}
            {item.key === 'stores' && ` (${normalItems.length})`}
            {item.key === 'brand' && ` (${brandItems.length})`}
            {item.key === 'dual' && dualStores.length > 0 && ` (${dualStores.length})`}
            {item.key === 'appointments' && jobs.length > 0 && ` (${jobs.length})`}
          </button>
        ))}

        {(tab === 'stores' || tab === 'brand' || tab === 'dual') && (
          <div className="ml-auto flex items-center gap-2">
            <Input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="店名关键词，如 瑞幸"
              className="h-8 w-48 text-xs"
            />
            <button
              type="button"
              onClick={() => void (tab === 'dual' ? scanDual() : loadStores(keyword))}
              className="
                rounded-md border px-3 py-1.5 text-xs
                hover:bg-muted
              "
            >
              搜索
            </button>
          </div>
        )}
      </div>

      {message && (
        <div className={`
          mt-3 rounded-md px-3 py-2 text-xs
          ${message.ok
          ? `
            bg-emerald-500/10 text-emerald-700
            dark:text-emerald-300
          `
          : `
            bg-amber-500/10 text-amber-700
            dark:text-amber-300
          `}
        `}
        >
          {message.text}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {tab === 'stores' && (normalItems.length
          ? normalItems.map(renderStoreRow)
          : <Empty text="暂无附近店铺" />)}

        {tab === 'brand' && (brandItems.length
          ? brandItems.map(renderStoreRow)
          : <Empty text="当前列表里没有需要大牌券的店" />)}

        {tab === 'dual' && (dualStores.length
          ? dualStores.map(store => (
              <div key={store.name} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{store.name}</span>
                  <Tag tone="warning">
                    {store.count}
                    {' '}
                    个方案
                  </Tag>
                </div>
                <div className="mt-2 flex flex-col gap-2">
                  {store.items.map((item, index) => (
                    <div
                      key={`${store.name}-${promoId(item)}-${index}`}
                      className="
                        flex items-center justify-between gap-2 rounded-md
                        bg-muted/40 px-2 py-1.5
                      "
                    >
                      <span className="text-xs text-muted-foreground">
                        {storeRebate(item) || '返利未知'}
                        {leftText(item) ? ` · ${leftText(item)}` : ''}
                      </span>
                      <button
                        type="button"
                        disabled={pending === `grab-${promoId(item)}`}
                        onClick={() => void grab(promoId(item))}
                        className="
                          rounded-md border px-2 py-1 text-xs
                          hover:bg-muted
                          disabled:opacity-50
                        "
                      >
                        抢这个方案
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          : <Empty text="点右上角「扫描同店双返利」开始扫描" />)}

        {tab === 'appointments' && (jobs.length
          ? jobs.map(job => (
              <div
                key={job.id}
                className="
                  flex flex-wrap items-center justify-between gap-2 rounded-lg
                  border p-3
                "
              >
                <div>
                  <div className="text-sm font-medium">
                    {job.title || job.promotion_id || job.id}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    计划时间
                    {' '}
                    {job.at || '立即'}
                    {job.status ? ` · ${job.status}` : ''}
                  </div>
                </div>
                <Tag tone="primary">{job.status || '排队中'}</Tag>
              </div>
            ))
          : <Empty text="还没有预约任务：在上面的店铺列表里抢单，或到「任务调度」页创建定时预约" />)}
      </div>
    </Card>
  );
};
