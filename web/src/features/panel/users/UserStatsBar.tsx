'use client';

import type { PanelList, PanelUserRow } from '@/types/Panel';
import { AnimatedList } from '@/components/reactbits';
import { CountValue, fen, StatCard } from '@/features/panel/Ui';

type UserRowStats = NonNullable<PanelList<PanelUserRow>['stats']>;

/** 顶部 4 张指标卡 + 操作结果通知条（纯展示，数据全部由父组件传入）。 */
export const UserStatsBar = (props: {
  stats: UserRowStats | undefined;
  records: PanelUserRow[];
  /** 后端返回的筛选结果总数（不是当前页条数） */
  filteredTotal: number;
  totalPoints: number;
  totalSpent: number;
  msg: { type: 'ok' | 'error'; text: string } | null;
  onDismissMsg: () => void;
}) => {
  const { stats, records, filteredTotal, totalPoints, totalSpent, msg } = props;

  return (
    <>
      <AnimatedList
        stagger={60}
        className="
          grid grid-cols-2 gap-3
          sm:grid-cols-4
        "
      >
        <StatCard
          label="注册用户总数"
          value={stats?.total ?? filteredTotal}
          hint={`当前筛选结果: ${filteredTotal} 人`}
          icon={<span className="text-xl">👥</span>}
        />
        <StatCard
          label="管理员团队"
          value={stats?.admins ?? records.filter(r => r.role === 'admin').length}
          hint="具备后台最高配置与审核权限"
          icon={<span className="text-xl">🛡️</span>}
        />
        <StatCard
          label="账号状态分布"
          value={<CountValue value={stats?.normal ?? records.filter(r => r.status === 'normal').length} suffix="正常" />}
          hint={
            (stats?.banned ?? 0) > 0
              ? (
                  <span className="font-medium text-rose-500">
                    {stats?.banned}
                    {' '}
                    个封禁中
                  </span>
                )
              : (
                  '暂无封禁风险账号'
                )
          }
          icon={<span className="text-xl">⚡</span>}
        />
        <StatCard
          label="平台积分总池"
          value={fen(totalPoints)}
          hint={`累计消耗 ${fen(totalSpent)}`}
          icon={<span className="text-xl">💎</span>}
        />
      </AnimatedList>

      {msg && (
        <div
          className={`
            flex items-center justify-between rounded-md border px-4 py-2.5
            text-xs shadow-xs transition-all
            ${
        msg.type === 'ok'
          ? `
            border-emerald-500/20 bg-emerald-500/10 text-emerald-700
            dark:text-emerald-300
          `
          : `
            border-rose-500/20 bg-rose-500/10 text-rose-700
            dark:text-rose-300
          `
        }
          `}
        >
          <div className="flex items-center gap-2">
            <span>{msg.type === 'ok' ? '✓' : '⚠️'}</span>
            <span className="font-medium">{msg.text}</span>
          </div>
          <button
            type="button"
            onClick={props.onDismissMsg}
            className="hover:underline"
          >
            知道了
          </button>
        </div>
      )}
    </>
  );
};
