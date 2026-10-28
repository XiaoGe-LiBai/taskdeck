import { CheckInCalendar } from '@/features/panel/CheckInCalendar';
import { CheckInCard } from '@/features/panel/CheckInCard';
import { CheckInRecords } from '@/features/panel/CheckInRecords';
import { CheckInSyncProvider } from '@/features/panel/CheckInSync';
import { PageTitle } from '@/features/panel/Ui';
import { panelGet } from '@/libs/PanelApi';

type CheckInInfo = {
  balance: number;
  checked_in_today: boolean;
  today_kind?: string;
  total_days: number;
  records: Array<{ date: string; reward: number; kind?: string }>;
  streak?: number;
  daily_reward?: number;
  today_reward?: number | null;
  next_reward?: number;
  base_reward?: number;
  streak_bonus?: number;
  signin_multiplier?: number;
  streak_bonus_from_day?: number;
  streak_bonus_list?: number[];
  gamble_rewards?: number[];
};

export default async function CheckInPage() {
  const checkinData = await panelGet<CheckInInfo>('/points/check-in');

  return (
    <>
      <PageTitle
        title="每日签到"
        description="每日签到（基础 + 连签加成，会员再乘倍率）与赌狗签到（随机 ±）二选一；漏签可补，补签保连签"
      />
      {/* 余额同步层：签到卡与日历各自会改余额，必须共享同一个权威值，
          否则补签扣了分、上面那张卡的余额纹丝不动 */}
      <CheckInSyncProvider serverBalance={checkinData?.balance ?? 0}>
        <div className="flex flex-col gap-6">
          {/* 统计 + 两个签到入口 */}
          <CheckInCard initialData={checkinData} />

          {/* 日历与记录等宽两列（各占一半，铺满不留边）。
              日历不再额外限宽，而是填满自己那一列 —— 上一版是「卡片 513px、日历却限死 360px」，
              于是卡片里空出一大截，我才误去缩卡片，结果页面右边又空出来。 */}
          <div className="
            grid gap-6
            lg:grid-cols-2
          "
          >
            <CheckInCalendar />
            <CheckInRecords
              records={checkinData?.records ?? []}
              totalDays={checkinData?.total_days ?? 0}
            />
          </div>
        </div>
      </CheckInSyncProvider>
    </>
  );
}
