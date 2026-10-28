'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AnimatedList, ClickSpark, ConfettiBurst, CountUp } from '@/components/reactbits';
import { doCheckInAction } from './actions';
import { useCheckInSync } from './CheckInSyncContext';
import { Card, StatCard } from './Ui';

type CheckInKind = 'daily' | 'gamble';

type CheckInRecord = { date: string; reward: number; kind?: string };

type CheckInProps = {
  initialData: {
    balance: number;
    checked_in_today: boolean;
    /** 今日已用哪种签到：daily / gamble；未签为空串 */
    today_kind?: string;
    total_days: number;
    records: CheckInRecord[];
    /** 连签天数（今天已签=含今天；未签=截至昨天）。断一天归零 */
    streak?: number;
    /** 每日签到今天能拿的分（含连签额外与会员倍率），与今天实际签了哪种无关 */
    daily_reward?: number;
    /** 今天实际拿到的分（未签为 null）——赌狗可能是负数 */
    today_reward?: number | null;
    /** 下一次签到的预计得分 */
    next_reward?: number;
    /** 基础奖励（分） */
    base_reward?: number;
    /** 连签额外（分），前 5 天为 0 */
    streak_bonus?: number;
    /** 会员签到倍率：1 / 1.25 / 1.5 */
    signin_multiplier?: number;
    /** 连签额外从第几天开始给 */
    streak_bonus_from_day?: number;
    /** 连签额外序列（分） */
    streak_bonus_list?: number[];
    /** 赌狗签到的奖励池（分），所有用户共用 */
    gamble_rewards?: number[];
  } | null;
};

const KIND_LABEL: Record<string, string> = { daily: '每日签到', gamble: '赌狗签到' };

const EMPTY = {
  balance: 0,
  checked_in_today: false,
  today_kind: '',
  total_days: 0,
  records: [] as CheckInRecord[],
  streak: 0,
  daily_reward: 8,
  today_reward: null as number | null,
  next_reward: 8,
  base_reward: 8,
  streak_bonus: 0,
  signin_multiplier: 1,
  streak_bonus_from_day: 6,
  streak_bonus_list: [] as number[],
  gamble_rewards: [] as number[],
};

export const CheckInCard = ({ initialData }: CheckInProps) => {
  const router = useRouter();
  // 余额由 CheckInSync 统一持有：补签是在**日历**里发生的，那张卡必须也能看到余额变化
  const { balance, commit } = useCheckInSync();
  const [data, setData] = useState(initialData ?? EMPTY);
  const [loading, setLoading] = useState<CheckInKind | ''>('');
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [burst, setBurst] = useState(0);

  // 服务端下发新数据（router.refresh 回来后）→ 以服务端为准覆盖本地乐观状态。
  // 这样"在日历里补签"导致的累计天数/连签变化，上面这张卡也能跟上。
  // （渲染期同步：React 官方 derived state 写法，比 useEffect 少一次渲染，也不会与乐观更新打架）
  const [lastServer, setLastServer] = useState(initialData);
  if (initialData !== lastServer) {
    setLastServer(initialData);
    setData(initialData ?? EMPTY);
  }

  const dailyReward = data.daily_reward ?? 8;
  const streak = data.streak ?? 0;
  const baseReward = data.base_reward ?? 8;
  const streakBonus = data.streak_bonus ?? 0;
  const multiplier = data.signin_multiplier ?? 1;
  const bonusFromDay = data.streak_bonus_from_day ?? 6;
  const pool = data.gamble_rewards ?? [];
  const poolText = pool.length
    ? `${Math.min(...pool)} ~ ${Math.max(...pool)} 分（${pool.join(' / ')}）`
    : '未配置';
  // 收益明细：基础 + 连签额外，再乘会员倍率（与后端同一口径）
  const bonusParts = [`基础 ${baseReward}`];
  if (streakBonus > 0) {
    bonusParts.push(`连签 +${streakBonus}`);
  }
  if (multiplier > 1) {
    bonusParts.push(`会员 ×${multiplier}`);
  }
  const breakdown = `${bonusParts.join('  ')} = ${dailyReward} 分`;
  const done = Boolean(data.checked_in_today);
  const usedKind = data.today_kind || '';
  const usedLabel = KIND_LABEL[usedKind] || '签到';

  const handleCheckIn = async (kind: CheckInKind) => {
    if (done || loading) {
      return;
    }
    setLoading(kind);
    setMessage(null);
    try {
      const res = await doCheckInAction(kind);
      if (res.ok) {
        setBurst(n => n + 1);
        setMessage({ text: res.msg, ok: true });
        setData(prev => ({
          ...prev,
          checked_in_today: true,
          today_kind: kind,
          total_days: prev.total_days + 1,
          today_reward: res.reward ?? 0,
        }));
        // 余额立刻用**服务端返回的值**刷新（不是前端猜的），并广播给日历；
        // 记录/日历/连签等由 router.refresh() 下发新 props 后统一校正
        commit(res.balance);
        router.refresh();
      } else {
        setMessage({ text: res.msg, ok: false });
      }
    } catch (e: any) {
      setMessage({ text: e.message || '网络异常', ok: false });
    } finally {
      setLoading('');
    }
  };

  const buttonClass = (accent: string) => {
    if (done) {
      return 'w-full rounded-md bg-muted px-4 py-2.5 text-sm font-semibold text-muted-foreground cursor-not-allowed';
    }
    return `w-full rounded-md px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-95 ${accent} ${
      loading ? 'opacity-60' : ''
    }`;
  };

  return (
    <div className="relative flex section-enter flex-col gap-6">
      <ConfettiBurst fire={burst} />
      <AnimatedList
        stagger={60}
        className="
          grid gap-4
          sm:grid-cols-2
          lg:grid-cols-4
        "
      >
        <StatCard
          label="累计签到天数"
          value={(
            <>
              <CountUp to={data.total_days} duration={500} />
              {' '}
              天
            </>
          )}
          hint="两种签到合并计算"
          icon="📅"
        />
        <StatCard
          label="当前连签"
          value={(
            <>
              <CountUp to={streak} duration={500} />
              {' '}
              天
            </>
          )}
          hint={streak >= bonusFromDay ? `连签加成 +${streakBonus} 分` : `连签满 ${bonusFromDay} 天开始有额外加成`}
          icon="🔥"
          plain={streak > 0}
        />
        <StatCard
          label="今日签到状态"
          value={done ? `已签 · ${usedLabel}` : '今日待签'}
          hint={done ? '今日签到已完成' : '二选一，签完即锁'}
          icon={done ? '✅' : '⏳'}
          plain={done}
        />
        <StatCard
          label="当前可用余额"
          value={<CountUp to={balance} duration={600} />}
          hint="单位：分（100 分 = 1 积分）"
          icon="🪙"
        />
      </AnimatedList>

      <div className="
        grid gap-4
        lg:grid-cols-2
      "
      >
        <Card title="每日签到" description={breakdown}>
          <ClickSpark className="w-full" color="#fff">
            <button
              type="button"
              data-kind="daily"
              onClick={() => handleCheckIn('daily')}
              disabled={done || loading !== ''}
              className={buttonClass('bg-brand-gradient')}
            >
              {loading === 'daily' ? '签到中…' : done ? '今日已签到' : `每日签到 +${dailyReward} 分`}
            </button>
          </ClickSpark>
          <p className="mt-3 text-xs text-muted-foreground">
            基础
            {' '}
            {baseReward}
            {' '}
            分人人都有；连签满
            {' '}
            {bonusFromDay}
            {' '}
            天起每天额外加分（第 10 天封顶），会员再按倍率加成。断签则连签归零重算。
          </p>
        </Card>

        <Card title="赌狗签到" description={`随机池 ${poolText}`}>
          <ClickSpark className="w-full" color="#fbbf24">
            <button
              type="button"
              data-kind="gamble"
              onClick={() => handleCheckIn('gamble')}
              disabled={done || loading !== ''}
              className={buttonClass('bg-gradient-to-r from-amber-500 to-rose-500')}
            >
              {loading === 'gamble' ? '开奖中…' : done ? '今日已签到' : '赌狗签到（随机 ±）'}
            </button>
          </ClickSpark>
          <p className="mt-3 text-xs text-muted-foreground">
            所有用户共用同一个池子（不吃会员倍率）；可能加分、可能 0 分、也可能扣分。
            余额不足时最多扣到 0，不会变负数。
          </p>
        </Card>
      </div>

      {done && (
        <div className="
          rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground
        "
        >
          今日已通过
          <strong className="text-foreground">{usedLabel}</strong>
          完成签到
          {typeof data.today_reward === 'number' && (
            <>
              ，本次
              <strong className={
                data.today_reward > 0
                  ? 'text-emerald-600'
                  : data.today_reward < 0 ? 'text-rose-600' : 'text-foreground'
              }
              >
                {data.today_reward > 0 ? `+${data.today_reward}` : data.today_reward}
                {' '}
                分
              </strong>
            </>
          )}
          。
        </div>
      )}

      {message && (
        <div
          className={`
            rounded-md border p-3 text-sm
            ${
        message.ok
          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
          : 'border-red-500/20 bg-red-500/10 text-red-600'
        }
          `}
        >
          {message.text}
        </div>
      )}

    </div>
  );
};
