'use client';

import { Card, Tag } from './Ui';

type CheckInRecord = { date: string; reward: number; kind?: string };

const KIND_LABEL: Record<string, string> = { daily: '每日签到', gamble: '赌狗签到', makeup: '补签' };

/**
 * 签到记录列表。
 *
 * 独立成组件是为了和「签到日历」并排摆放（原先它嵌在签到卡里、排在日历上面，顺序很别扭）。
 * 记录**完全以后端为准**：不自己存一份状态，签到/补签后由页面 `router.refresh()`
 * 重新下发 props 即可刷新，省掉两份状态不同步的麻烦。
 */
export const CheckInRecords = (props: {
  records: CheckInRecord[];
  /** 后端返回的累计签到天数 */
  totalDays: number;
}) => {
  const records = props.records;

  return (
    <Card
      title="签到记录"
      description={`累计 ${props.totalDays} 天 · 最近 ${records.length} 次`}
    >
      {records.length === 0
        ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              暂无签到记录，从上面选一种开始吧
            </div>
          )
        : (
            <div className="
              max-h-[360px] divide-y overflow-y-auto pr-1
              lg:max-h-[420px]
            "
            >
              {records.map(r => (
                <div
                  key={`${r.date}-${r.kind || 'daily'}`}
                  className="
                    flex items-center justify-between rounded-md p-2 text-sm
                    transition-colors
                    hover:bg-muted/40
                  "
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{r.date}</span>
                    <Tag tone={r.kind === 'makeup' ? 'gray' : r.kind === 'gamble' ? 'warning' : 'info'}>
                      {KIND_LABEL[r.kind || 'daily'] || '签到'}
                    </Tag>
                  </div>
                  <Tag tone={r.reward > 0 ? 'success' : r.reward < 0 ? 'danger' : 'gray'}>
                    {r.reward > 0 ? `+${r.reward}` : r.reward < 0 ? r.reward : '0'}
                    {' '}
                    分
                  </Tag>
                </div>
              ))}
            </div>
          )}
    </Card>
  );
};
