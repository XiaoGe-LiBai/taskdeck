'use client';

import type { CheckInCalendarData, CheckInCalendarDay } from './actions';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { CountUp } from '@/components/reactbits';
import { fetchCheckInCalendarAction, makeupCheckInAction } from './actions';
import { useCheckInSync } from './CheckInSyncContext';
import { Card } from './Ui';

const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
// 日期格前面的占位（最多 6 个：首日可能落在周日那一列）
const BLANKS = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'];

function shiftMonth(month: string, delta: number) {
  const [ys, ms] = (month || '').split('-');
  const y = Number(ys) || new Date().getFullYear();
  const m = Number(ms) || 1;
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string) {
  const [y, m] = (month || '').split('-');
  if (!y || !m) {
    return '加载中…';
  }
  return `${y} 年 ${Number(m)} 月`;
}

/** 单元格样式与标记：按状态给不同外观 */
function cellView(status: string) {
  switch (status) {
    case 'checked':
      return { mark: '✓', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', title: '已签到' };
    case 'makeup':
      return { mark: '◆', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300', title: '补签' };
    case 'missed':
      return { mark: '✗', cls: 'border-dashed border-rose-500/40 bg-rose-500/5 text-rose-600 dark:text-rose-400', title: '漏签（可点补签）' };
    case 'today':
      return { mark: '●', cls: 'border-primary/50 bg-primary/5 text-primary', title: '今天' };
    case 'out_of_range':
      return { mark: '', cls: 'border-border/40 text-muted-foreground/40', title: '已超出可补范围' };
    default:
      return { mark: '', cls: 'border-border/40 text-muted-foreground/50', title: '未来' };
  }
}

/**
 * 签到日历：当月视图 + 上月/下月 + 已签/今天/可补标记 + 四项统计。
 *
 * 补签规则由后端把关（需先完成今日签到 / 每月 4 次 / 30 分 / 最近 31 天），
 * 这里只做展示与二次确认，不重复实现规则。
 *
 * 尺寸：日历自己限宽 360px、格子固定 h-10。
 * （用 aspect-square 会让它在宽屏卡片里被撑到 180px/格，PC 上非常占地方。）
 */
export const CheckInCalendar = (props: { initialMonth?: string }) => {
  const router = useRouter();
  // version：签到卡那边签到时也会 +1，用来让日历跟着重新拉取
  // （日历有自己的接口，服务端组件的 router.refresh 不会触发它重新请求）
  const { commit, version } = useCheckInSync();
  // 传空串 → 后端按 +08:00 的"今天"决定月份，避免前端用 UTC 算出跨月偏差
  const [month, setMonth] = useState(props.initialMonth ?? '');
  const [data, setData] = useState<CheckInCalendarData | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // 加载态由「请求的月份」与「已拿到数据的月份」比较推导，
  // effect 里就不用同步 setState 了（否则白白多一次渲染）
  const loading = !data || data.month !== month;

  useEffect(() => {
    let alive = true;
    fetchCheckInCalendarAction(month).then((d) => {
      if (!alive || !d) {
        return;
      }
      setData(d);
      // 首次（month 为空）以服务端返回的月份为准
      if (!month) {
        setMonth(d.month);
      }
    });
    return () => {
      alive = false;
    };
    // version 变化 = 签到或补签成功过 → 重新拉一次（今日已签状态、本月已签、可补次数都会变）
  }, [month, version]);

  const doMakeup = (day: CheckInCalendarDay) => {
    if (!data || pending) {
      return;
    }
    if (!data.today_checked) {
      setMsg({ ok: false, text: '请先完成今日签到，再来补签' });
      return;
    }
    if (data.makeup_remaining <= 0) {
      setMsg({ ok: false, text: `本月补签次数已用完（${data.makeup_used}/${data.makeup_quota}）` });
      return;
    }
    // 项目约定：危险/花费类操作二次确认用 window.confirm
    // eslint-disable-next-line no-alert
    const ok = window.confirm(
      `补签 ${day.date}？\n\n将消耗 ${data.makeup_cost} 分，只补记录、保住连签，不发放该日签到奖励。\n本月还可补签 ${data.makeup_remaining} 次。`,
    );
    if (!ok) {
      return;
    }
    startTransition(async () => {
      const res = await makeupCheckInAction(day.date);
      setMsg({ ok: res.ok, text: res.msg });
      if (res.ok) {
        // 余额立刻用服务端返回值刷新 —— 签到卡上的「当前可用余额」会同步变化；
        // commit 同时把 version +1，本日历的 effect 会重新拉一次（不必再手动 load）
        commit(res.balance);
        router.refresh();
      }
    });
  };

  // 首日在一周中的位置（周一为第一列）
  const firstDay = data?.days[0]?.date;
  const firstWeekday = firstDay
    ? (new Date(`${firstDay}T00:00:00`).getDay() + 6) % 7
    : 0;

  const thisMonth = data?.month ?? month;

  return (
    <Card
      title="签到日历"
      description="点击「✗ 漏签」可补签（需先完成今日签到）"
    >
      <div className="flex flex-col gap-3">
        {/* 四项统计 */}
        <div className="
          grid grid-cols-2 gap-2 text-xs
          sm:grid-cols-4
        "
        >
          {[
            { label: '本月已签', count: data?.checked_days ?? 0, suffix: '天', icon: '📅' },
            { label: '累计签到', count: data?.total_days ?? 0, suffix: '天', icon: '🏅' },
            { label: '当前连签', count: data?.streak ?? 0, suffix: '天', icon: '🔥' },
            {
              label: '本月可补签',
              count: data?.makeup_remaining ?? 0,
              suffix: '次',
              icon: '🩹',
              hint: `每次 ${data?.makeup_cost ?? 0} 分`,
            },
          ].map(it => (
            <div
              key={it.label}
              className="rounded-lg border bg-muted/30 px-2.5 py-2"
            >
              <div className="text-[10px] text-muted-foreground">
                {it.icon}
                {' '}
                {it.label}
              </div>
              <div className="font-semibold text-foreground tabular-nums">
                <CountUp to={it.count} duration={700} />
                {' '}
                {it.suffix}
              </div>
              {it.hint && <div className="text-[10px] text-muted-foreground">{it.hint}</div>}
            </div>
          ))}
        </div>

        {/* 月份切换（放在卡片内居中，而不是挤在右上角） */}
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setMonth(m => shiftMonth(m, -1))}
            className="
              rounded-md border px-2.5 py-1 text-xs
              hover:bg-muted
            "
          >
            ‹ 上月
          </button>
          <span className="min-w-[104px] text-center text-xs font-medium">{monthLabel(month)}</span>
          <button
            type="button"
            disabled={month >= thisMonth}
            onClick={() => setMonth(m => shiftMonth(m, 1))}
            className="
              rounded-md border px-2.5 py-1 text-xs
              hover:bg-muted
              disabled:opacity-40
            "
          >
            下月 ›
          </button>
        </div>

        {loading
          ? (
              <div className="py-10 text-center text-sm text-muted-foreground">加载中…</div>
            )
          : (
              <div className="overflow-x-auto">
                {/* 填满自己那一列（约 473px），但设一个上限防止超宽屏把格子撑到 100px+。
                    格子高度固定 h-10，所以无论多宽都不会像以前那样"占好大一块"。 */}
                <div className="mx-auto w-full max-w-[560px]">
                  {/* 星期表头 */}
                  <div className="
                    grid grid-cols-7 gap-1 text-center text-[11px]
                    text-muted-foreground
                  "
                  >
                    {WEEK.map(w => <div key={w} className="py-0.5">{w}</div>)}
                  </div>
                  {/* 日期格：固定高度（不用 aspect-square，否则宽屏会把格子撑爆） */}
                  <div className="grid grid-cols-7 gap-1">
                    {BLANKS.slice(0, firstWeekday).map(k => (
                      <div key={k} />
                    ))}
                    {(data?.days ?? []).map((d) => {
                      const v = cellView(d.status);
                      const clickable = d.status === 'missed' && data?.today_checked;
                      return (
                        <button
                          key={d.date}
                          type="button"
                          disabled={!clickable || pending}
                          onClick={() => clickable && doMakeup(d)}
                          title={v.title}
                          className={`
                            relative flex h-10 flex-col items-center
                            justify-center rounded-md border text-[11px]
                            leading-tight transition-colors
                            ${v.cls}
                            ${clickable
                          ? `
                            cursor-pointer
                            hover:border-rose-500/70
                          `
                          : `cursor-default`}
                            ${d.status === 'today' ? 'ring-2 ring-primary/30' : ''}
                          `}
                        >
                          <span className="font-medium">{d.day}</span>
                          {v.mark && <span className="text-[9px] leading-none">{v.mark}</span>}
                          {d.reward > 0 && (
                            <span className="
                              text-[9px] leading-none text-muted-foreground
                            "
                            >
                              +
                              {d.reward}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

        {/* 提示 */}
        {data && !data.today_checked && (
          <div className="
            rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2
            text-xs text-amber-700
            dark:text-amber-300
          "
          >
            ⚠️ 需要先完成今日签到才能补签
          </div>
        )}

        {msg && (
          <div className={`
            rounded-md border px-3 py-2 text-xs
            ${msg.ok
            ? `
              border-emerald-500/20 bg-emerald-500/10 text-emerald-700
              dark:text-emerald-300
            `
            : `
              border-rose-500/20 bg-rose-500/10 text-rose-700
              dark:text-rose-300
            `}
          `}
          >
            {msg.text}
          </div>
        )}

        {/* 图例 */}
        <div className="
          flex flex-wrap items-center gap-3 border-t pt-3 text-[11px]
          text-muted-foreground
        "
        >
          <span className="flex items-center gap-1">
            <span className="
              inline-flex size-4 items-center justify-center rounded-sm border
              border-emerald-500/30 bg-emerald-500/10 text-[9px]
              text-emerald-600
            "
            >
              ✓
            </span>
            已签到
          </span>
          <span className="flex items-center gap-1">
            <span className="
              inline-flex size-4 items-center justify-center rounded-sm border
              border-amber-500/30 bg-amber-500/10 text-[9px] text-amber-600
            "
            >
              ◆
            </span>
            补签
          </span>
          <span className="flex items-center gap-1">
            <span className="
              inline-flex size-4 items-center justify-center rounded-sm border
              border-dashed border-rose-500/40 text-[9px] text-rose-600
            "
            >
              ✗
            </span>
            漏签（可补）
          </span>
          <span className="flex items-center gap-1">
            <span className="
              inline-flex size-4 items-center justify-center rounded-sm border
              border-primary/50 bg-primary/5 text-[9px] text-primary
            "
            >
              ●
            </span>
            今天
          </span>
          <span className="ml-auto">
            可补范围：最近 31 天内（
            {data?.earliest_makeup_date}
            {' '}
            起）
          </span>
        </div>
      </div>
    </Card>
  );
};
