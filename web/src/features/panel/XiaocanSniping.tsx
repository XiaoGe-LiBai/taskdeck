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


/** 上游把店铺信息放在 store 子对象里，顶层只有活动字段。 */
const shopOf = (item: StoreItem): Record<string, unknown> => {
  const shop = item.store;
  return shop && typeof shop === 'object' ? shop as Record<string, unknown> : {};
};

const shopIcon = (item: StoreItem) => {
  const icon = shopOf(item).icon;
  return typeof icon === 'string' ? icon : '';
};

const shopAddress = (item: StoreItem) => {
  const address = shopOf(item).address;
  return typeof address === 'string' ? address : '';
};

const shopHours = (item: StoreItem) => {
  const hours = shopOf(item).opening_hours;
  return typeof hours === 'string' && hours.trim() ? hours : '';
};

const shopCategory = (item: StoreItem) => {
  const category = item.xc_category ?? shopOf(item).category;
  return typeof category === 'string' ? category : '';
};

/** 满 X 返 Y：上游以分计价 */
const conditionText = (item: StoreItem) => {
  const money = Number(item.order_money ?? 0);
  const rebate = Number(item.user_rebate ?? item.rebate_price ?? 0);
  if (money > 0 && rebate > 0) {
    return `满 ${(money / 100).toFixed(0)} 返 ${(rebate / 100).toFixed(0)}`;
  }
  return '';
};

const leftCount = (item: StoreItem) => {
  const left = item.left_number ?? item.left_num;
  return typeof left === 'number' ? left : 0;
};

const canUseRedpack = (item: StoreItem) => Boolean(item.if_use_red_pack);

const canAdvance = (item: StoreItem) => {
  const info = shopOf(item).store_info as Record<string, unknown> | undefined;
  return Boolean(info?.if_advance ?? item.if_advance);
};

/** 服务费 / 每日限单这些限制写在 store.store_info.store_limit 里 */
const limitText = (item: StoreItem) => {
  const info = shopOf(item).store_info as Record<string, unknown> | undefined;
  const limit = info?.store_limit as Record<string, unknown> | undefined;
  if (!limit) {
    return '';
  }
  const parts: string[] = [];
  const fee = Number(limit.service_charge ?? 0);
  if (fee > 0) {
    parts.push(`服务费 ¥${(fee / 100).toFixed(2)}`);
  }
  const days = Number(limit.days_limit ?? 0);
  if (days > 0) {
    parts.push(`${days} 天内限 ${Number(limit.days_order_limit ?? 1)} 单`);
  }
  return parts.join(' · ');
};

/** 抢单窗口状态：未开始可预约、进行中可抢、已结束只能看 */
const windowState = (item: StoreItem): 'before' | 'active' | 'after' => {
  const now = Math.floor(Date.now() / 1000);
  const start = Number(item.start_timestamp ?? 0);
  const end = Number(item.end_timestamp ?? 0);
  if (start > 0 && now < start) {
    return 'before';
  }
  if (end > 0 && now > end) {
    return 'after';
  }
  return 'active';
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
    const icon = shopIcon(item);
    const left = leftCount(item);
    const state = windowState(item);
    const soldOut = left <= 0;
    return (
      <div
        key={`${storeName(item)}-${id || index}`}
        className="
          flex items-start gap-3 rounded-lg border p-3 transition-colors
          hover:border-primary/40
        "
      >
        <div className="
          flex size-10 shrink-0 items-center justify-center overflow-hidden
          rounded-lg bg-muted text-sm font-semibold text-muted-foreground
        "
        >
          {icon
            ? <img src={icon} alt="" className="size-full object-cover" loading="lazy" />
            : storeName(item).slice(0, 1)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag tone="info">美团外卖</Tag>
            <span className="truncate text-sm font-medium">{storeName(item)}</span>
            {isBrand(item) && <Tag tone="warning">大牌券</Tag>}
            {Boolean(item.if_repurchase_promotion) && <Tag tone="gray">可复购</Tag>}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            {conditionText(item) && <Tag tone="warning">{conditionText(item)}</Tag>}
            <span className="text-muted-foreground">
              {storeDistance(item) || '附近'}
            </span>
            {canUseRedpack(item) && <Tag tone="danger">可用红包</Tag>}
            {canAdvance(item) && <Tag tone="info">支持超前抢</Tag>}
            {shopCategory(item) && (
              <span className="text-muted-foreground">{shopCategory(item)}</span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            <Tag tone={soldOut ? 'gray' : 'info'}>
              {soldOut ? '已领完' : `实付剩 ${left} 单`}
            </Tag>
            {limitText(item) && (
              <span className="text-muted-foreground">{limitText(item)}</span>
            )}
          </div>

          <div className="mt-1 text-[11px] text-muted-foreground">
            {`门店营业: ${shopHours(item) || '00:00-23:59'}`}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {`地址: ${shopAddress(item) || '依据外卖平台定位'}`}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {state === 'active' && !soldOut && (
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
              {busy ? '抢单中…' : '抢单'}
            </button>
          )}
          {state === 'active' && soldOut && (
            <button
              type="button"
              disabled
              className="
                rounded-md border px-3 py-1.5 text-xs text-muted-foreground
                opacity-60
              "
            >
              已领完
            </button>
          )}
          {state === 'before' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void grab(id)}
              className="
                rounded-md border border-primary/40 px-3 py-1.5 text-xs
                font-medium text-primary transition-colors
                hover:bg-primary/10
                disabled:opacity-50
              "
            >
              {busy ? '提交中…' : '预约'}
            </button>
          )}
          {state === 'after' && (
            <button
              type="button"
              disabled
              className="
                rounded-md border px-3 py-1.5 text-xs text-muted-foreground
                opacity-60
              "
            >
              已过时
            </button>
          )}
          <span className="text-[11px] text-muted-foreground">
            {state === 'before' ? '未开始' : (state === 'active' ? '进行中' : '已结束')}
          </span>
        </div>
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
                  {store.items.map((item, index) => {
                    const left = leftCount(item);
                    const state = windowState(item);
                    return (
                      <div
                        key={`${store.name}-${promoId(item)}-${index}`}
                        className="
                          flex flex-wrap items-center justify-between gap-2
                          rounded-md bg-muted/40 px-2 py-1.5
                        "
                      >
                        <div className="
                          flex flex-wrap items-center gap-1.5 text-xs
                        "
                        >
                          <Tag tone="warning">{conditionText(item) || storeRebate(item) || '返利未知'}</Tag>
                          <Tag tone={left > 0 ? 'info' : 'gray'}>
                            {left > 0 ? `余 ${left} 份` : '已领完'}
                          </Tag>
                          {canUseRedpack(item) && <Tag tone="danger">可用红包</Tag>}
                          {canAdvance(item) && <Tag tone="info">支持超前抢</Tag>}
                          <span className="text-muted-foreground">
                            {storeDistance(item) || '附近'}
                          </span>
                          {shopHours(item) && (
                            <span className="text-muted-foreground">{shopHours(item)}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={pending === `grab-${promoId(item)}` || state === 'after' || left <= 0}
                          onClick={() => void grab(promoId(item))}
                          className="
                            rounded-md border px-2 py-1 text-xs
                            hover:bg-muted
                            disabled:opacity-50
                          "
                        >
                          {state === 'before' ? '预约' : (left > 0 ? '抢这个方案' : '已领完')}
                        </button>
                      </div>
                    );
                  })}
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
                <Tag tone="info">{job.status || '排队中'}</Tag>
              </div>
            ))
          : <Empty text="还没有预约任务：在上面的店铺列表里抢单，或到「任务调度」页创建定时预约" />)}
      </div>
    </Card>
  );
};
