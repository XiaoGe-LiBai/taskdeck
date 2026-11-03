'use client';

import type { GrabJob, StoreItem } from './actions';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { createStockListenerAction, fetchSchedulerAction, fetchStoresAction, grabPromotionAction, manageGrabJobAction } from './actions';
import { useGeoLocation } from './location/LocationContext';
import { Card, Empty, Tag } from './Ui';

/**
 * 霸王餐抢单与预约。
 *
 * 布局照抄开源版 StoreSniping：一张表、三列 —— 店铺 / 实付满返方案 / 按比例返方案。
 * 同一家店的多档满返在右列用「档位」切换，比例返同理；两类活动都有的店才是「同店双返利」。
 */
type TabKey = 'stores' | 'brand' | 'dual' | 'appointments';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'stores', label: '附近店铺' },
  { key: 'brand', label: '大牌券专享' },
  { key: 'dual', label: '美团同店双返利' },
  { key: 'appointments', label: '预约与监听' },
];

type StoreRow = {
  key: string;
  name: string;
  icon: string;
  address: string;
  hours: string;
  category: string;
  distance: number;
  redpack: boolean;
  /** 实付满返档位（多条即多档） */
  fixed: StoreItem[];
  /** 按比例返档位 */
  percent: StoreItem[];
};

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

const shopOf = (item: StoreItem): Record<string, unknown> => {
  const shop = item.store;
  return shop && typeof shop === 'object' ? shop as Record<string, unknown> : {};
};

const storeName = (item: StoreItem) =>
  text(item, ['meituan_shop_url', 'name', 'shop_name']) || text(shopOf(item), ['name']) || '未命名店铺';

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
  const flag = item.need_brand_coupon ?? item.brand_coupon;
  return flag === true || flag === 1 || flag === 'true';
};

/** 实付满返：有门槛金额与返现金额 */
const isFixed = (item: StoreItem) => Number(item.order_money ?? 0) > 0 && Number(item.user_rebate ?? 0) > 0;

/** 按比例返：ratio 是万分比（5400 = 54%），max_commission 是最高返（分） */
const isPercent = (item: StoreItem) => Number(item.ratio ?? 0) > 0;

const money = (value: unknown) => (Number(value ?? 0) / 100).toFixed(Number(value ?? 0) % 100 === 0 ? 0 : 2);

const fixedDesc = (item: StoreItem) => {
  const condition = text(item, ['rebate_condition_str']);
  if (condition) {
    return condition;
  }
  return `满 ${money(item.order_money)} 返 ${money(item.user_rebate)}`;
};

const percentDesc = (item: StoreItem) => {
  const rate = Number(item.ratio ?? 0) / 100;
  const cap = Number(item.max_commission ?? 0);
  const rateText = Number.isInteger(rate) ? `${rate}%` : `${rate.toFixed(2)}%`;
  return cap > 0 ? `返 ${rateText} · 最高 ¥${money(cap)}` : `返 ${rateText}`;
};

/** 余量：上游比例返活动经常不带 left_number，缺字段代表「不限量」而不是「已领完」 */
const leftOf = (item: StoreItem): number | null => {
  const left = item.left_number ?? item.left_num;
  return typeof left === 'number' ? left : null;
};

const leftSummary = (label: string, value: number | null) =>
  value === null ? `${label}不限` : `${label}剩 ${value} 单`;

const distanceText = (value: number) => {
  if (!value) {
    return '附近';
  }
  return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
};

type Window = 'before' | 'active' | 'after';

const windowOf = (item: StoreItem): Window => {
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

const minutesUntil = (item: StoreItem) => {
  const start = Number(item.start_timestamp ?? 0);
  if (!start) {
    return 0;
  }
  return Math.max(0, Math.round((start - Date.now() / 1000) / 60));
};

/** 同店多档位余量汇总：全是 null 就返回 null（不限量） */
const sumLeft = (plans: StoreItem[]): number | null => {
  const values = plans.map(leftOf);
  if (values.every(value => value === null)) {
    return null;
  }
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
};

const slotText = (item: StoreItem) =>
  `${text(item, ['start_time_hour']) || '全天'} ~ ${text(item, ['end_time_hour']) || '23:59'}`;

const groupStores = (items: StoreItem[]): StoreRow[] => {
  const map = new Map<string, StoreRow>();
  for (const item of items) {
    const name = storeName(item);
    const shop = shopOf(item);
    const row = map.get(name) ?? {
      key: name,
      name,
      icon: typeof shop.icon === 'string' ? shop.icon : '',
      address: typeof shop.address === 'string' ? shop.address : '',
      hours: typeof shop.opening_hours === 'string' ? shop.opening_hours : '',
      category: text(item, ['xc_category']) || text(shop, ['category']),
      distance: Number(item.distance ?? 0),
      redpack: Boolean(item.if_use_red_pack),
      fixed: [],
      percent: [],
    };
    if (isFixed(item)) {
      row.fixed.push(item);
    } else if (isPercent(item)) {
      row.percent.push(item);
    } else {
      // 既没有门槛也没有比例，就按满返方案兜底展示，避免整店消失
      row.fixed.push(item);
    }
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => a.distance - b.distance);
};

export const XiaocanSniping = (props: {
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
}) => {
  const [accountId, setAccountId] = useState(props.accounts[0]?.id ?? 0);
  const [tab, setTab] = useState<TabKey>('stores');
  const [items, setItems] = useState<StoreItem[]>([]);
  const [keyword, setKeyword] = useState('');
  const [jobs, setJobs] = useState<GrabJob[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [pending, setPending] = useState('');
  const [appointment, setAppointment] = useState<StoreItem | null>(null);
  const [appointmentMode, setAppointmentMode] = useState<'appointment' | 'stock'>('appointment');
  const [intervalSec, setIntervalSec] = useState(5);
  const [timeoutMinutes, setTimeoutMinutes] = useState(60);
  const [advance, setAdvance] = useState(false);
  const [earlyMs, setEarlyMs] = useState(0);
  const [redpackId, setRedpackId] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const { location, open: openLocation } = useGeoLocation();

  const rows = useMemo(() => groupStores(items), [items]);
  const normalRows = useMemo(() => rows.filter(row => !row.fixed.some(isBrand)), [rows]);
  const brandRows = useMemo(() => rows.filter(row => row.fixed.some(isBrand) || row.percent.some(isBrand)), [rows]);
  const dualRows = useMemo(
    () => rows.filter(row => row.fixed.length > 0 && row.percent.length > 0),
    [rows],
  );

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
    setPending('load');
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
    setMessage(result.items.length ? null : { ok: false, text: '这一页没有结果，换个定位或关键词试试' });
  }, [accountId, location, requireLocation]);

  const loadJobs = useCallback(async () => {
    const result = await fetchSchedulerAction();
    if (result.ok) {
      setJobs(result.jobs);
    }
  }, []);

  useEffect(() => {
    if (props.accounts.length) {
      void loadStores();
      void loadJobs();
    }
  }, [props.accounts.length, loadStores, loadJobs]);

  useEffect(() => {
    if (tab !== 'appointments') {
      return;
    }
    void loadJobs();
    const timer = window.setInterval(() => void loadJobs(), 5000);
    return () => window.clearInterval(timer);
  }, [tab, loadJobs]);

  const manageJob = async (job: GrabJob, operation: 'cancel' | 'delete') => {
    setPending(`job-${job.id}`);
    const result = await manageGrabJobAction(job.id, operation);
    setPending('');
    setMessage({ ok: result.ok, text: result.msg });
    await loadJobs();
  };

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
    setMessage({ ok: result.ok, text: result.msg });
    if (result.ok) {
      void loadJobs();
    }
  };

  const scheduleAppointment = async () => {
    if (!appointment || !requireLocation()) {
      return;
    }
    const id = promoId(appointment);
    const startsAt = Number(appointment.start_timestamp ?? 0);
    if (!id || (appointmentMode === 'appointment' && (!Number.isFinite(startsAt) || startsAt * 1000 <= Date.now()))) {
      setMessage({ ok: false, text: '活动开抢时间无效或已到，请刷新店铺后重试' });
      setAppointment(null);
      return;
    }
    setPending(`grab-${id}`);
    const result = appointmentMode === 'stock'
      ? await createStockListenerAction({
          accountId,
          promotionId: id,
          lat: location!.lat,
          lon: location!.lon,
          cityCode: location!.cityCode,
          storePlatform: Number(appointment.store_platform || shopOf(appointment).store_platform || 1),
          intervalSec,
          timeoutSec: timeoutMinutes * 60,
          advance,
          redpackId: redpackId ? Number(redpackId) : 0,
        })
      : await grabPromotionAction({
          accountId,
          promotionId: id,
          at: new Date(startsAt * 1000).toISOString(),
          advance,
          earlyMs,
          redpackId: redpackId ? Number(redpackId) : 0,
          lat: location?.lat,
          lon: location?.lon,
          cityCode: location?.cityCode,
        });
    setPending('');
    setMessage({ ok: result.ok, text: result.msg });
    if (result.ok) {
      setAppointment(null);
      void loadJobs();
    }
  };

  /** 方案列：档位切换 + 状态化按钮，与开源版一致 */
  const renderPlans = (row: StoreRow, kind: 'fixed' | 'percent') => {
    const plans = kind === 'fixed' ? row.fixed : row.percent;
    if (!plans.length) {
      return (
        <span className="text-xs text-muted-foreground">
          {kind === 'fixed' ? '暂无满返活动' : '暂无比例活动'}
        </span>
      );
    }
    const pickKey = `${row.key}:${kind}`;
    const chosen = picked[pickKey] ?? promoId(plans[0]!);
    const active = plans.find(plan => promoId(plan) === chosen) ?? plans[0]!;
    const id = promoId(active);
    const left = leftOf(active);
    const soldOut = left !== null && left <= 0;
    const state = windowOf(active);
    const busy = pending === `grab-${id}`;

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Tag tone={kind === 'fixed' ? 'info' : 'success'}>
              {kind === 'fixed' ? '实付满返' : '按比例返'}
            </Tag>
            <span className="font-mono text-sm font-bold text-foreground">
              {kind === 'fixed' ? fixedDesc(active) : percentDesc(active)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Tag tone={soldOut ? 'gray' : (kind === 'fixed' ? 'info' : 'success')}>
              {soldOut ? '已领完' : (left === null ? '不限量' : `余 ${left} 份`)}
            </Tag>
            {state === 'active' && !soldOut && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void grab(id)}
                className="
                  rounded-md bg-brand-gradient px-2.5 py-1 text-xs font-medium
                  text-white shadow-sm transition-all
                  hover:opacity-95
                  active:scale-95
                  disabled:opacity-50
                "
              >
                {busy ? '抢单中…' : (kind === 'fixed' ? '抢满返' : '抢比例')}
              </button>
            )}
            {state === 'active' && soldOut && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAppointmentMode('stock');
                  setAdvance(false);
                  setRedpackId('');
                  setIntervalSec(5);
                  setTimeoutMinutes(60);
                  setAppointment(active);
                }}
                className="
                  rounded-md border border-primary/40 px-2.5 py-1 text-xs
                  text-primary hover:bg-primary/10 disabled:opacity-50
                "
              >
                名额监听
              </button>
            )}
            {state === 'before' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAppointmentMode('appointment');
                  setAdvance(false);
                  setEarlyMs(0);
                  setRedpackId('');
                  setAppointment(active);
                }}
                className="
                  rounded-md border border-primary/40 px-2.5 py-1 text-xs
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
                  rounded-md border px-2.5 py-1 text-xs text-muted-foreground
                  opacity-60
                "
              >
                已过时
              </button>
            )}
          </div>
        </div>

        <div className="
          flex flex-wrap items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1
          text-[11px] text-muted-foreground
        "
        >
          <span>抢单时段:</span>
          <span className="font-mono font-medium text-foreground">{slotText(active)}</span>
          {state === 'before'
            ? <Tag tone="info">{`未开抢 (${minutesUntil(active)} 分后)`}</Tag>
            : state === 'active'
              ? <Tag tone="success">进行中</Tag>
              : <Tag tone="gray">已结束</Tag>}
        </div>

        {plans.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">切换档位:</span>
            {plans.map((plan, index) => {
              const pid = promoId(plan);
              const isActive = pid === id;
              const planLeft = leftOf(plan);
              return (
                <button
                  key={pid || index}
                  type="button"
                  onClick={() => setPicked(prev => ({ ...prev, [pickKey]: pid }))}
                  className={`
                    rounded-md border px-2 py-0.5 text-[11px] transition-colors
                    ${isActive
                  ? 'border-primary bg-primary/10 text-primary'
                  : `hover:bg-muted`}
                  `}
                >
                  {`档位 ${index + 1}`}
                  <span className={(planLeft ?? 1) > 0
                    ? 'text-primary'
                    : `text-muted-foreground`}
                  >
                    {planLeft === null ? '[不限]' : (planLeft > 0 ? `[余${planLeft}]` : '[无票]')}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderTable = (list: StoreRow[], emptyText: string) => {
    if (!list.length) {
      return <Empty text={emptyText} />;
    }
    return (
      <div className="-mx-1 overflow-x-auto">
        <table className="
          w-full min-w-[900px] border-separate border-spacing-y-2 px-1
        "
        >
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="w-[34%] px-3 pb-1 font-medium">店铺</th>
              <th className="w-[33%] px-3 pb-1 font-medium">实付满返方案</th>
              <th className="w-[33%] px-3 pb-1 font-medium">按比例返方案</th>
            </tr>
          </thead>
          <tbody>
            {list.map(row => (
              <tr key={row.key} className="bg-card align-top">
                <td className="rounded-l-lg border border-r-0 p-3">
                  <div className="flex items-start gap-2.5">
                    <div className="
                      flex size-10 shrink-0 items-center justify-center
                      overflow-hidden rounded-lg bg-muted text-sm font-semibold
                      text-muted-foreground
                    "
                    >
                      {row.icon
                        ? (
                            <img
                              src={row.icon}
                              alt=""
                              className="size-full object-cover"
                              loading="lazy"
                            />
                          )
                        : row.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Tag tone="info">美团外卖</Tag>
                        <span className="truncate text-sm font-medium">{row.name}</span>
                      </div>
                      <div className="
                        mt-1.5 flex flex-wrap items-center gap-1.5 text-xs
                      "
                      >
                        <Tag tone="gray">{distanceText(row.distance)}</Tag>
                        {row.redpack && <Tag tone="danger">可用红包</Tag>}
                        {row.category && (
                          <span className="text-muted-foreground">{row.category}</span>
                        )}
                      </div>
                      <div className="
                        mt-1.5 flex flex-wrap items-center gap-1.5 text-xs
                      "
                      >
                        <Tag tone={row.fixed.some(plan => (leftOf(plan) ?? 1) > 0) ? 'info' : 'gray'}>
                          {leftSummary('实付', sumLeft(row.fixed))}
                        </Tag>
                        <Tag tone={row.percent.some(plan => (leftOf(plan) ?? 1) > 0) ? 'success' : 'gray'}>
                          {leftSummary('比例', sumLeft(row.percent))}
                        </Tag>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {`门店营业: ${row.hours || '00:00-23:59'}`}
                      </div>
                      <div className="
                        truncate text-[11px] text-muted-foreground
                      "
                      >
                        {`地址: ${row.address || '依据外卖平台定位'}`}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="border-y p-3">{renderPlans(row, 'fixed')}</td>
                <td className="rounded-r-lg border border-l-0 p-3">{renderPlans(row, 'percent')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  if (!props.accounts.length) {
    return (
      <Card title="霸王餐抢单与预约" description="先绑定小蚕账号，才能代你查店与抢单">
        <Empty text="还没有绑定小蚕账号" />
      </Card>
    );
  }

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
            onClick={() => void loadStores(keyword)}
            disabled={pending === 'load'}
            className="
              rounded-md border px-3 py-1.5 text-xs font-medium
              hover:bg-muted
              disabled:opacity-50
            "
          >
            {pending === 'load' ? '查询中…' : '刷新'}
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
            {item.key === 'stores' && ` (${normalRows.length})`}
            {item.key === 'brand' && ` (${brandRows.length})`}
            {item.key === 'dual' && ` (${dualRows.length})`}
            {item.key === 'appointments' && ` (${jobs.length})`}
          </button>
        ))}

        {tab !== 'appointments' && (
          <div className="ml-auto flex items-center gap-2">
            <Input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="店名关键词，如 瑞幸"
              className="h-8 w-48 text-xs"
            />
            <button
              type="button"
              onClick={() => void loadStores(keyword)}
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

      {appointment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="appointment-title" className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl">
            <h3 id="appointment-title" className="text-base font-semibold">{appointmentMode === 'stock' ? '名额监听' : '预约抢单'}</h3>
            <p className="mt-3 text-sm">{storeName(appointment)}</p>
            {appointmentMode === 'appointment' && (
              <p className="mt-1 text-sm text-muted-foreground">
                {`开抢时间：${new Date(Number(appointment.start_timestamp) * 1000).toLocaleString('zh-CN', { hour12: false })}`}
              </p>
            )}
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={advance} onChange={event => setAdvance(event.target.checked)} />
              使用超前券
            </label>
            {appointmentMode === 'appointment'
              ? (
                  <label className="mt-4 flex flex-col gap-1 text-sm">
                    提前量（毫秒）
                    <Input type="number" min={0} max={60000} value={earlyMs} onChange={event => setEarlyMs(Number(event.target.value))} />
                  </label>
                )
              : (
                  <>
                    <p className="mt-3 text-xs text-muted-foreground">发现名额后会自动尝试抢单。</p>
                    <label className="mt-3 flex flex-col gap-1 text-sm">
                      检查间隔（秒）
                      <Input type="number" min={3} max={60} value={intervalSec} onChange={event => setIntervalSec(Number(event.target.value))} />
                    </label>
                    <label className="mt-3 flex flex-col gap-1 text-sm">
                      最长监听时间（分钟）
                      <Input type="number" min={1} max={1440} value={timeoutMinutes} onChange={event => setTimeoutMinutes(Number(event.target.value))} />
                    </label>
                  </>
                )}
            <label className="mt-3 flex flex-col gap-1 text-sm">
              指定红包 ID（不填则不指定）
              <Input type="number" min={1} value={redpackId} onChange={event => setRedpackId(event.target.value)} />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => setAppointment(null)}>取消</button>
              <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50" disabled={Boolean(pending)} onClick={() => void scheduleAppointment()}>{appointmentMode === 'stock' ? '启动监听' : '确认预约'}</button>
            </div>
          </div>
        </div>
      )}
      <div className="mt-3">
        {tab === 'stores' && renderTable(normalRows, '暂无附近店铺')}
        {tab === 'brand' && renderTable(brandRows, '当前列表里没有需要大牌券的店')}
        {tab === 'dual' && renderTable(dualRows, '附近没有同时有满返与比例返的店')}
        {tab === 'appointments' && (
          <div className="flex flex-col gap-2">
            {jobs.length
              ? jobs.map(job => (
                  <div
                    key={job.id}
                    className="
                      flex flex-wrap items-center justify-between gap-2
                      rounded-lg border p-3
                    "
                  >
                    <div>
                      <div className="text-sm font-medium">
                        {job.title || job.promotion_id || job.id}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {job.id.startsWith('stock-')
                          ? `监听至 ${job.until_ts ? new Date(job.until_ts * 1000).toLocaleString('zh-CN', { hour12: false }) : '未知'} · 间隔 ${job.interval_sec} 秒`
                          : `计划时间 ${job.at || '立即'} · 提前 ${job.early_ms || 0} 毫秒${job.advance ? ' · 超前券' : ''}${job.redpack_id ? ` · 红包 ${job.redpack_id}` : ''}`}
                      </div>
                      {job.message && <div className="mt-1 text-xs text-muted-foreground">{job.message}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Tag tone="info">{({ scheduled: '等待中', monitoring: '监听中', expired: '已到期', running: '执行中', success: '成功', failed: '失败', cancelled: '已停止', missed: '已错过', unknown: '结果待核实' } as Record<string, string>)[job.status || ''] || job.status || '等待中'}</Tag>
                      {(job.status === 'scheduled' || job.status === 'monitoring') && <button type="button" disabled={pending === `job-${job.id}`} onClick={() => void manageJob(job, 'cancel')} className="rounded-md border px-2 py-1 text-xs">停止</button>}
                      {job.status !== 'scheduled' && job.status !== 'monitoring' && job.status !== 'running' && <button type="button" disabled={pending === `job-${job.id}`} onClick={() => void manageJob(job, 'delete')} className="rounded-md border px-2 py-1 text-xs">删除</button>}
                    </div>
                  </div>
                ))
              : <Empty text="还没有预约任务：在上面的方案里点「预约」即可排队" />}
          </div>
        )}
      </div>
    </Card>
  );
};
