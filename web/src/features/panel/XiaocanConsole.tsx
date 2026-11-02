'use client';

import type { XcOverview, XcOverviewSection } from './actions';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { callXiaocanAction, fetchXiaocanOverviewAction, runXiaocanDailyForAccountAction } from './actions';
import { useGeoLocation } from './location/LocationContext';
import { Card, Empty, StatCard, Tag } from './Ui';

/**
 * 小蚕资产工作台。
 *
 * 数据分两批拉：首屏只要账号档案与元宝资产，其余段落后台补齐 —— 官方网关对
 * 频次敏感，一次性打十几个请求既慢又容易触发限流。每段独立回报错误，
 * 某一段挂了不影响其它段。
 *
 * variant='compact' 用于账号详情抽屉：只保留写操作相关的资产、任务、抽奖与红包雨。
 */

type Account = { id: number; nickname: string; account_info: string };

const CATEGORY_TABS = ['全部', '免单卡', '影音卡', '品牌券', '其他卡券'];

/** 未绑定账号时的模块清单：让人先看清能力面，而不是只看到一句「还没绑定」 */
const MODULES = [
  { icon: '🪙', name: '元宝资产', hint: '余额、待领取、已兑换' },
  { icon: '📋', name: '每日任务', hint: '任务列表与单条领取' },
  { icon: '📅', name: '签到历史', hint: '连续天数与逐日记录' },
  { icon: '🎰', name: '幸运抽奖', hint: '抽一次 / 广告加次 / 额外次数' },
  { icon: '🧧', name: '整点红包雨', hint: '场次状态 / 报名 / 抢' },
  { icon: '🎟️', name: '外卖免单卡', hint: '每月持有状态 / 抢免单' },
  { icon: '💳', name: '卡券包', hint: '免单卡 / 影音卡 / 品牌券' },
  { icon: '💰', name: '霸王餐红包', hint: '金额、门槛、到期时间' },
];

const fen = (value: number) => `¥${((Number(value) || 0) / 100).toFixed(2)}`;

const pointText = (value: number) => (Number(value) || 0).toLocaleString();

/** 上游时间统一是秒级时间戳；0 或缺失时显示占位符。 */
const timeText = (value: number) => {
  if (!value) {
    return '—';
  }
  const date = new Date(value * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const RAIN_STATUS: Record<number, string> = {
  0: '未开始',
  1: '未开始',
  2: '进行中',
  3: '已结束',
};

export const XiaocanConsole = (props: {
  accounts: Account[];
  variant?: 'full' | 'compact';
  defaultAccountId?: number;
  className?: string;
}) => {
  const compact = props.variant === 'compact';
  const [accountId, setAccountId] = useState(props.defaultAccountId ?? props.accounts[0]?.id ?? 0);
  // 定位统一取全局设置（顶栏可改）；没有定位时接口不带 x-City，交给后端按账号默认处理
  const { location, open: openLocation } = useGeoLocation();
  const cityCode = location?.cityCode ?? '';
  const [data, setData] = useState<XcOverview['data']>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [category, setCategory] = useState('全部');

  const pull = useCallback(async (
    id: number,
    sections: XcOverviewSection[],
    city: string,
  ) => {
    const result = await fetchXiaocanOverviewAction(id, sections, city);
    if (!result.ok || !result.data) {
      setMessage({ ok: false, text: result.msg || '读取失败' });
      return;
    }
    setData(prev => ({ ...prev, ...result.data!.data }));
    setErrors((prev) => {
      // 两批请求并行，各自只带自己那几段的错误：先清掉本次请求的段，再合并结果
      const next = { ...prev };
      for (const section of sections) {
        delete next[section];
      }
      return { ...next, ...result.data!.errors };
    });
  }, []);

  /** 全量刷新：两批并行，互不阻塞。 */
  const reloadAll = useCallback(async (id: number, city: string) => {
    setLoading(true);
    setMessage(null);
    setData({});
    setErrors({});
    await Promise.all([
      pull(id, ['profile', 'assets', 'tasks', 'points', 'signin'], city),
      pull(id, ['lottery', 'rain', 'freeorder', 'cards', 'redpacks'], city),
    ]);
    setLoading(false);
  }, [pull]);

  /**
   * 实际生效的账号。
   *
   * state 里的 accountId 可能是 0（首次进来还没绑号），绑定成功后 props 才有账号；
   * 这里在渲染期回落到第一个账号，避免「绑定成功但工作台一直空着」，
   * 也避免用 effect 里 setState 造成的多余渲染。
   */
  const activeAccountId = props.accounts.some(item => item.id === accountId)
    ? accountId
    : (props.accounts[0]?.id ?? 0);

  useEffect(() => {
    if (activeAccountId) {
      void reloadAll(activeAccountId, cityCode);
    }
    // 只在换账号/换定位时重拉；reloadAll 已 memo
  }, [activeAccountId, cityCode, reloadAll]);

  /** 写操作：执行成功后按需刷新受影响的段。 */
  const run = async (
    label: string,
    action: string,
    params: Record<string, unknown>,
    sections: XcOverviewSection[],
  ) => {
    setPending(action);
    setMessage(null);
    const result = await callXiaocanAction(activeAccountId, action, params);
    setPending('');
    if (!result.ok) {
      setMessage({ ok: false, text: `${label}失败：${result.msg || '未知错误'}` });
      return false;
    }
    setMessage({ ok: true, text: `${label}已完成` });
    await pull(activeAccountId, sections, cityCode);
    return true;
  };

  const runDaily = async () => {
    setPending('daily');
    setMessage(null);
    const result = await runXiaocanDailyForAccountAction(activeAccountId);
    setPending('');
    setMessage({
      ok: result.ok,
      text: result.summary || result.msg || '已执行',
    });
    await reloadAll(activeAccountId, cityCode);
  };

  const assets = data.assets;
  const profile = data.profile;
  const tasks = data.tasks;
  const lottery = data.lottery;
  const rain = data.rain;
  const cards = data.cards;
  const redpacks = data.redpacks;
  const signin = data.signin;

  const cardItems = useMemo(() => {
    const items = cards?.items ?? [];
    return category === '全部' ? items : items.filter(item => item.category === category);
  }, [cards, category]);

  const busy = loading || Boolean(pending);

  if (!props.accounts.length) {
    // 没绑号时也要让人看到「这里到底有什么」，否则整页只剩一句「还没绑定」，
    // 看起来就像功能不存在
    return (
      <Card
        title="小蚕资产工作台"
        description="绑定小蚕账号后，下面这些模块会按官方数据实时展示"
      >
        <div className="
          grid gap-2
          sm:grid-cols-2
          lg:grid-cols-4
        "
        >
          {MODULES.map(item => (
            <div key={item.name} className="rounded-md border px-3 py-2">
              <div className="text-sm font-medium">
                {item.icon}
                {' '}
                {item.name}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{item.hint}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          下方「小蚕账号登录 / 绑定」扫码即可接入；绑定成功后本区自动出现数据与操作按钮。
        </p>
      </Card>
    );
  }

  const sectionError = (name: string) => errors[name]
    ? (
        <div className="
          mb-3 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2
          text-xs text-amber-700
          dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-300
        "
        >
          {errors[name]}
        </div>
      )
    : null;

  return (
    <div className={props.className}>
      <Card
        title="小蚕资产工作台"
        description="元宝、任务、签到、抽奖、红包雨与卡券都来自小蚕官方接口；写操作会记录运行日志"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={activeAccountId}
              onChange={event => setAccountId(Number(event.target.value))}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              {props.accounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.nickname?.trim() || account.account_info}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={() => void reloadAll(activeAccountId, cityCode)}
              className="
                rounded-md border px-3 py-1.5 text-xs font-medium transition-all
                duration-150
                hover:bg-muted
                disabled:opacity-50
              "
            >
              {loading ? '同步中…' : '刷新'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runDaily()}
              className="
                rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-medium
                text-white shadow-sm transition-all duration-150
                hover:opacity-95
                disabled:opacity-50
              "
            >
              {pending === 'daily' ? '执行中…' : '执行日常'}
            </button>
          </div>
        )}
      >
        <div className="
          grid gap-3
          sm:grid-cols-2
          lg:grid-cols-3
        "
        >
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            定位（城市码）
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-8 text-sm text-foreground">
                {location ? `${location.cityName}（${location.cityCode}）` : '未设置'}
              </span>
              <button
                type="button"
                onClick={openLocation}
                className="
                  rounded-md border px-2 py-1 text-xs
                  hover:bg-muted
                "
              >
                {location ? '修改' : '去设置'}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            账号昵称
            <span className="h-8 text-sm text-foreground">
              {profile?.nickname?.trim() || '—'}
            </span>
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            会员等级
            <span className="h-8 text-sm text-foreground">
              {profile ? `${profile.vip.is_plus ? 'SVIP' : 'VIP'} ${profile.vip.level || '—'} 级` : '—'}
            </span>
          </div>
        </div>
        {message && (
          <div className={`
            mt-3 rounded-md border px-3 py-2 text-xs
            ${message.ok
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
            : 'border-red-500/20 bg-red-500/10 text-red-700'}
          `}
          >
            {message.text}
          </div>
        )}
      </Card>

      <div className="
        mt-4 grid gap-4
        sm:grid-cols-2
        lg:grid-cols-3
      "
      >
        <StatCard
          label="元宝余额"
          value={pointText(assets?.yb_point ?? 0)}
          hint={`待领取 ${pointText(assets?.unreceived_points ?? 0)} · 已兑换 ${pointText(assets?.exchanged_yb_point ?? 0)}`}
          icon="🪙"
        />
        <StatCard
          label="钱包余额"
          value={fen(profile?.silk ?? 0)}
          hint={`累计提现 ${fen(profile?.withdraw_total ?? 0)} · 提现中 ${fen(profile?.withdrawing ?? 0)}`}
          icon="👛"
        />
        <StatCard
          label="霸王餐成单"
          value={`${profile?.completed_number ?? 0} 单`}
          hint="来自小蚕官方档案，点「刷新」可同步"
          icon="🧾"
        />
        <StatCard
          label="可用卡券"
          value={`${cards?.can_use_number ?? 0} 张`}
          hint={cards?.expiring_soon_number ? `${cards.expiring_soon_number} 张今日到期` : '含免单卡 / 影音卡 / 品牌券'}
          icon="🎫"
        />
        <StatCard
          label="可用红包"
          value={`${redpacks?.num ?? 0} 个`}
          hint="整点红包雨、签到与任务中心获取"
          icon="🧧"
        />
        <StatCard
          label="抽奖次数"
          value={`${lottery?.lucky_times ?? 0} 次`}
          hint={`今日额度 ${lottery?.day_num ?? 0} 次`}
          icon="🎰"
        />
      </div>

      <div className={`
        mt-4 grid gap-4
        ${compact ? '' : 'lg:grid-cols-2'}
      `}
      >
        <Card
          title="每日任务"
          description={tasks
            ? `可领取 ${tasks.claimable_count} 项，共 ${pointText(tasks.claimable_point)} 元宝`
            : '读取中…'}
          actions={(
            <button
              type="button"
              disabled={busy}
              onClick={() => void run('一键领取元宝', 'collect_points', {}, ['assets', 'tasks', 'points'])}
              className="
                rounded-md border px-3 py-1.5 text-xs font-medium transition-all
                duration-150
                hover:bg-muted
                disabled:opacity-50
              "
            >
              {pending === 'collect_points' ? '领取中…' : '一键领取'}
            </button>
          )}
        >
          {sectionError('tasks')}
          {(tasks?.items.length ?? 0) === 0
            ? <Empty text={tasks ? '暂无任务，稍后刷新试试' : '读取中…'} />
            : (
                <ul className="flex flex-col gap-2">
                  {tasks?.items.map(task => (
                    <li
                      key={`${task.id}-${task.title}`}
                      className="
                        flex items-center justify-between gap-3 rounded-md
                        border px-3 py-2
                      "
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{task.title}</div>
                        <div className="text-xs text-muted-foreground">
                          +
                          {pointText(task.point)}
                          {' '}
                          元宝
                          {task.desc ? ` · ${task.desc}` : ''}
                        </div>
                      </div>
                      {task.claimable && task.id
                        ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void run(
                                `领取「${task.title}」`,
                                'user_claim_points',
                                { task_id: task.id },
                                ['assets', 'tasks', 'points'],
                              )}
                              className="
                                shrink-0 rounded-md border border-emerald-500/30
                                bg-emerald-500/10 px-2.5 py-1 text-xs
                                font-medium text-emerald-700
                                disabled:opacity-50
                              "
                            >
                              领取
                            </button>
                          )
                        : <Tag tone={task.completed === 3 ? 'success' : 'gray'}>{task.completed === 3 ? '可领取' : '未完成'}</Tag>}
                    </li>
                  ))}
                </ul>
              )}
        </Card>

        <Card
          title="未领取积分"
          description={data.points ? `共 ${pointText(data.points.points)} 元宝待入账` : '读取中…'}
        >
          {sectionError('points')}
          {(data.points?.items.length ?? 0) === 0
            ? <Empty text={data.points ? '没有待领取的记录' : '读取中…'} />
            : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {data.points?.items.map(item => (
                    <li
                      key={`${item.task_id}-${item.time}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="truncate text-muted-foreground">{item.task_name}</span>
                      <span className="shrink-0 font-medium text-amber-600">
                        +
                        {pointText(item.point)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
        </Card>

        <Card
          title="签到历史"
          description={signin ? `连续签到 ${signin.days} 天` : '读取中…'}
        >
          {sectionError('signin')}
          {(signin?.records.length ?? 0) === 0
            ? <Empty text={signin ? '上游只返回连续天数，没有逐日明细' : '读取中…'} />
            : (
                <ul className="flex flex-wrap gap-1.5 text-xs">
                  {signin?.records.map(record => (
                    <li
                      key={`${record.date}-${record.point}`}
                      className="rounded-md border px-2 py-1"
                      title={`${record.date} · +${pointText(record.point)} 元宝`}
                    >
                      {record.date || '—'}
                    </li>
                  ))}
                </ul>
              )}
        </Card>

        <Card
          title="幸运抽奖"
          description="免费开红包与幸运转盘；次数由签到、分享与广告任务增加"
          actions={(
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void run('抽奖', 'do_lottery_spin', {}, ['lottery', 'assets'])}
                className="
                  rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-medium
                  text-white shadow-sm
                  disabled:opacity-50
                "
              >
                {pending === 'do_lottery_spin' ? '抽奖中…' : '抽一次'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run('看广告加次数', 'claim_ad_lottery_chance', { bus_type: 2 }, ['lottery'])}
                className="
                  rounded-md border px-3 py-1.5 text-xs font-medium
                  hover:bg-muted
                  disabled:opacity-50
                "
              >
                广告加次
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run('领取额外次数', 'receive_extra_lottery', {}, ['lottery'])}
                className="
                  rounded-md border px-3 py-1.5 text-xs font-medium
                  hover:bg-muted
                  disabled:opacity-50
                "
              >
                额外次数
              </button>
            </div>
          )}
        >
          {sectionError('lottery')}
          <div className="mb-2 text-sm">
            剩余
            {' '}
            <span className="text-brand-gradient font-semibold">{lottery?.lucky_times ?? 0}</span>
            {' '}
            次 / 今日额度
            {' '}
            {lottery?.day_num ?? 0}
            {' '}
            次
          </div>
          {(lottery?.steps.length ?? 0) > 0 && (
            <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              {lottery?.steps.map(step => (
                <li
                  key={`${step.step}-${step.title}`}
                  className="flex justify-between gap-3"
                >
                  <span className="truncate">{step.title || `第 ${step.step} 档`}</span>
                  <span className="shrink-0 tabular-nums">
                    {step.current}
                    /
                    {step.target}
                    {step.received ? '（已领）' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="整点红包雨"
          description="每日 10 / 11 / 12 / 14 / 16 / 19 点开场，先报名再抢"
          actions={(
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void run('报名红包雨', 'join_redpack_rain', {}, ['rain'])}
                className="
                  rounded-md border px-3 py-1.5 text-xs font-medium
                  hover:bg-muted
                  disabled:opacity-50
                "
              >
                报名
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run('抢红包雨', 'grab_redpack_rain', { click_num: 15 }, ['rain', 'redpacks', 'assets'])}
                className="
                  rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-medium
                  text-white shadow-sm
                  disabled:opacity-50
                "
              >
                抢红包
              </button>
            </div>
          )}
        >
          {sectionError('rain')}
          {rain?.has_event
            ? (
                <div className="text-sm">
                  <div className="font-medium">
                    场次 #
                    {rain.event_id}
                    <Tag tone={rain.status === 2 ? 'success' : 'info'}>
                      {RAIN_STATUS[rain.status] ?? `状态 ${rain.status}`}
                    </Tag>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {timeText(rain.begin_time)}
                    {' '}
                    –
                    {' '}
                    {timeText(rain.end_time)}
                  </div>
                </div>
              )
            : <Empty text="当前没有生效中的场次，开场前 2 分钟再刷新" />}
        </Card>

        <Card
          title="外卖免单卡"
          description="每月限领 1 张，14:00 开抢；已持有的券在下单时使用"
          actions={(
            <button
              type="button"
              disabled={busy}
              onClick={() => void run('抢免单卡', 'grab_free_order_quota', {}, ['freeorder'])}
              className="
                rounded-md border px-3 py-1.5 text-xs font-medium
                hover:bg-muted
                disabled:opacity-50
              "
            >
              抢免单
            </button>
          )}
        >
          {sectionError('freeorder')}
          {data.freeorder
            ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Tag tone={data.freeorder.had ? (data.freeorder.used ? 'gray' : 'success') : 'info'}>
                    {data.freeorder.had
                      ? (data.freeorder.used ? '本月已使用' : '本月已持有，未使用')
                      : '本月未持有'}
                  </Tag>
                  <span className="text-xs text-muted-foreground">
                    {data.freeorder.had
                      ? `券 ID ${data.freeorder.card_id ?? '—'}`
                      : '14:00 准点开抢，抢到后可在订单里选「用免单卡」'}
                  </span>
                </div>
              )
            : <Empty text="读取中…" />}
        </Card>

        {!compact && (
          <Card
            title="卡券包"
            description={cards
              ? `可用 ${cards.can_use_number} 张，共拉取 ${cards.total} 张`
              : '读取中…'}
            actions={(
              <div className="flex flex-wrap gap-1">
                {CATEGORY_TABS.map(tab => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setCategory(tab)}
                    className={`
                      rounded-md border px-2 py-1 text-xs
                      ${category === tab
                    ? 'bg-brand-soft font-medium'
                    : `hover:bg-muted`}
                    `}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            )}
          >
            {sectionError('cards')}
            {cardItems.length === 0
              ? <Empty text={cards ? '该分类下没有卡券' : '读取中…'} />
              : (
                  <ul className="
                    grid gap-2
                    sm:grid-cols-2
                  "
                  >
                    {cardItems.map(card => (
                      <li
                        key={`${card.id}-${card.name}-${card.expire_time}`}
                        className="
                          flex items-center gap-3 rounded-md border px-3 py-2
                        "
                      >
                        {card.pic
                          ? (
                              // 上游图标是外链，可能 404，加载失败就隐藏，不阻塞其它信息
                              // eslint-disable-next-line next/no-img-element
                              <img
                                src={card.pic}
                                alt=""
                                className="
                                  size-9 shrink-0 rounded-sm object-contain
                                "
                                onError={(event) => {
                                  event.currentTarget.style.display = 'none';
                                }}
                              />
                            )
                          : null}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{card.name}</div>
                          <div className="
                            truncate text-xs text-muted-foreground
                          "
                          >
                            {card.category}
                            {card.expire_time ? ` · 到期 ${timeText(card.expire_time)}` : ''}
                          </div>
                        </div>
                        {card.count > 1 && <Tag tone="info">{`x${card.count}`}</Tag>}
                      </li>
                    ))}
                  </ul>
                )}
          </Card>
        )}

        {!compact && (
          <Card
            title="霸王餐红包"
            description={redpacks ? `可用 ${redpacks.num} 个` : '读取中…'}
          >
            {sectionError('redpacks')}
            {(redpacks?.items.length ?? 0) === 0
              ? <Empty text={redpacks ? '暂无可用红包' : '读取中…'} />
              : (
                  <ul className="flex flex-col gap-2">
                    {redpacks?.items.map(redpack => (
                      <li
                        key={redpack.id ?? `${redpack.name}-${redpack.end_time}`}
                        className="
                          flex items-center justify-between gap-3 rounded-md
                          border px-3 py-2
                        "
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {redpack.name}
                            {redpack.platforms.map(platform => (
                              <Tag key={platform} tone={platform === 1 ? 'warning' : platform === 2 ? 'info' : 'gray'}>
                                {platform === 1 ? '美团' : platform === 2 ? '饿了么' : '点评'}
                              </Tag>
                            ))}
                          </div>
                          <div className="
                            truncate text-xs text-muted-foreground
                          "
                          >
                            {redpack.threshold_num
                              ? `满 ${fen(redpack.threshold_num)} 可用`
                              : '无门槛'}
                            {redpack.end_time ? ` · ${timeText(redpack.end_time)} 到期` : ''}
                          </div>
                        </div>
                        <span className="
                          shrink-0 text-base font-semibold text-red-600
                        "
                        >
                          {fen(redpack.value_num)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
          </Card>
        )}
      </div>
    </div>
  );
};
