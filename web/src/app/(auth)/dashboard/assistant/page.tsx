import type { MeituanAccount, XcAction } from '@/features/panel/actions';
import { ClearLogsButton } from '@/features/panel/ClearLogsButton';
import { GrabScheduler } from '@/features/panel/GrabScheduler';
import { MeituanCard } from '@/features/panel/MeituanCard';
import { Card, Empty, PageTitle, StatCard, Tag } from '@/features/panel/Ui';
import { XiaocanToolbox } from '@/features/panel/XiaocanToolbox';
import { panelGet } from '@/libs/PanelApi';

type Stats = {
  total_orders: number;
  completed_orders: number;
  pending_orders: number;
  total_rebate: number;
  pending_rebate: number;
  total_spent: number;
  today_saved: number;
  today_orders: number;
  today_completed_orders: number;
  today_completed_rebate: number;
  today_pending_orders: number;
  today_pending_rebate: number;
};

type ChartData = {
  trend: Array<{ date: string; rebate: number; orders: number; spent: number }>;
  status_counts: Record<string, number>;
  platform_counts: Record<string, number>;
  today_summary: {
    today_saved: number;
    today_orders: number;
    today_pending_orders: number;
    today_completed_orders: number;
    today_completed_rebate: number;
  };
};

type TimeStatus = {
  synced: boolean;
  source: string;
  offset_ms: number;
  round_trip_ms: number;
  server_time: string;
  error: string;
};

type Scheduler = {
  grab_jobs: Array<{
    id: string;
    account_id: number;
    promotion_id: string;
    status: string;
    at: string;
    order_id: number;
    message: string;
  }>;
  level_refresh: boolean;
};

type JobLog = {
  id: number;
  account_id: number | null;
  kind: string;
  status: string;
  message: string;
  created_time: string;
};

const STATUS_LABEL: Record<string, string> = {
  completed: '已到账',
  auditing: '审核中',
  pending: '在途',
  rejected: '已拒绝',
  cancelled: '已取消',
  success: '成功',
  failed: '失败',
  cancelled_job: '已取消',
};

const money = (value: number) => `¥${Number(value || 0).toFixed(2)}`;

const KIND_LABEL: Record<string, string> = { grab: '抢单', daily: '日常' };

export default async function AssistantPage() {
  const [stats, chart, scheduler, logs, accounts] = await Promise.all([
    panelGet<Stats>('/xiaocan/stats'),
    panelGet<ChartData>('/xiaocan/chart-data'),
    panelGet<Scheduler>('/xiaocan/scheduler'),
    panelGet<{ jobs: JobLog[] }>('/xiaocan/job-logs?limit=30'),
    panelGet<Array<{ id: number; nickname: string; account_info: string }>>('/xiaocan/accounts'),
  ]);
  const catalog = (await panelGet<{ actions: XcAction[] }>('/xiaocan/actions'))?.actions ?? [];
  const meituan = await panelGet<{ accounts: MeituanAccount[]; runtime_ready: boolean }>('/xiaocan/meituan/accounts');
  const clock = await panelGet<TimeStatus>('/xiaocan/time');

  const trend = chart?.trend ?? [];
  const peak = Math.max(1, ...trend.map(point => point.rebate));
  const summary = chart?.today_summary;

  return (
    <>
      <PageTitle
        title="助手看板"
        description="返现收益、任务调度与运行日志；数据来自本面板的订单与任务记录"
      />

      <div className="
        mb-6 grid gap-4
        sm:grid-cols-3
      "
      >
        <StatCard
          label="累计到账返现"
          value={money(stats?.total_rebate ?? 0)}
          hint={`已完成 ${stats?.completed_orders ?? 0} 单 · 累计消费 ${money(stats?.total_spent ?? 0)}`}
          icon="💰"
        />
        <StatCard
          label="在途 / 待入账"
          value={money(stats?.pending_rebate ?? 0)}
          hint={`在途 ${stats?.pending_orders ?? 0} 单`}
          icon="⏳"
        />
        <StatCard
          label="今日已省外卖费"
          value={money(stats?.today_saved ?? 0)}
          hint={`今日 ${stats?.today_orders ?? 0} 单 · 已完成 ${summary?.today_completed_orders ?? 0} · 在途 ${summary?.today_pending_orders ?? 0}`}
          icon="🎯"
        />
      </div>

      <div className="
        mb-6 grid gap-6
        lg:grid-cols-2
      "
      >
        <Card title="近 7 天返现" description="按订单创建日期统计（不含被拒/取消）">
          <div className="flex items-end gap-3">
            {trend.map(point => (
              <div
                key={point.date}
                className="flex flex-1 flex-col items-center gap-1"
              >
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {point.rebate > 0 ? `¥${point.rebate.toFixed(0)}` : ''}
                </span>
                <div className="flex h-24 w-full items-end">
                  <div
                    className="w-full rounded-t bg-brand-gradient"
                    style={{ height: `${Math.max(2, (point.rebate / peak) * 100)}%` }}
                    title={`${point.date} · ¥${point.rebate.toFixed(2)} · ${point.orders} 单`}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">{point.date}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="订单分布" description="状态与平台维度">
          <div className="
            grid gap-4
            sm:grid-cols-2
          "
          >
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">按状态</div>
              <ul className="flex flex-col gap-1 text-sm">
                {Object.entries(chart?.status_counts ?? {}).map(([key, count]) => (
                  <li key={key} className="flex justify-between">
                    <span className="text-muted-foreground">{STATUS_LABEL[key] ?? key}</span>
                    <span className="tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">按平台</div>
              <ul className="flex flex-col gap-1 text-sm">
                {Object.entries(chart?.platform_counts ?? {}).map(([key, count]) => (
                  <li key={key} className="flex justify-between">
                    <span className="text-muted-foreground">{key}</span>
                    <span className="tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>

      <div className="mb-6">
        <GrabScheduler accounts={accounts ?? []} />
      </div>

      <div className="mb-6">
        <XiaocanToolbox accounts={accounts ?? []} actions={catalog} />
      </div>

      <div className="mb-6">
        <MeituanCard
          accounts={meituan?.accounts ?? []}
          runtimeReady={Boolean(meituan?.runtime_ready)}
          boundAccounts={accounts ?? []}
        />
      </div>

      <div className="mb-6">
        <Card
          title="任务调度中心"
          description="抢单任务存在进程内，重启后清空；等级刷新由后台每日执行"
        >
          <div className="
            mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground
          "
          >
            <Tag tone={scheduler?.level_refresh ? 'success' : 'gray'}>
              {scheduler?.level_refresh ? '等级刷新 已开启' : '等级刷新 已关闭'}
            </Tag>
            <span>{`当前抢单任务 ${scheduler?.grab_jobs.length ?? 0} 个`}</span>
            <Tag tone={clock?.synced ? 'success' : 'warning'}>
              {clock?.synced
                ? `授时 ${clock.offset_ms > 0 ? '+' : ''}${clock.offset_ms.toFixed(0)}ms`
                : '授时未校准'}
            </Tag>
            {clock?.synced && (
              <span>{`源 ${clock.source} · 往返 ${clock.round_trip_ms.toFixed(0)}ms`}</span>
            )}
            {!clock?.synced && clock?.error
              ? <span className="text-destructive">{clock.error.slice(0, 60)}</span>
              : null}
          </div>
          {scheduler?.grab_jobs.length
            ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b text-xs text-muted-foreground">
                      <tr>
                        <th className="py-2">任务</th>
                        <th className="py-2">账号</th>
                        <th className="py-2">活动 ID</th>
                        <th className="py-2">计划时间</th>
                        <th className="py-2">状态</th>
                        <th className="py-2">订单号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduler.grab_jobs.map(job => (
                        <tr
                          key={job.id}
                          className="
                            border-b
                            last:border-0
                          "
                        >
                          <td className="py-2 font-mono text-xs">{job.id}</td>
                          <td className="py-2 tabular-nums">{job.account_id}</td>
                          <td className="py-2 font-mono text-xs">{job.promotion_id}</td>
                          <td className="py-2 text-xs text-muted-foreground">{job.at}</td>
                          <td className="py-2 text-xs">
                            <Tag tone={job.status === 'success' ? 'success' : job.status === 'failed' ? 'warning' : 'gray'}>
                              {STATUS_LABEL[job.status] ?? job.status}
                            </Tag>
                          </td>
                          <td className="py-2 font-mono text-xs">{job.order_id || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            : <Empty text="还没有抢单任务" />}
        </Card>
      </div>

      <Card
        title="运行日志"
        description="抢单与日常执行的最近记录"
        actions={<ClearLogsButton />}
      >
        {logs?.jobs.length
          ? (
              <ul className="flex flex-col gap-1 text-sm">
                {logs.jobs.map(log => (
                  <li
                    key={log.id}
                    className="
                      flex flex-wrap items-center gap-2 border-b py-1.5 text-xs
                      last:border-0
                    "
                  >
                    <Tag tone={log.status === 'success' ? 'success' : 'warning'}>
                      {STATUS_LABEL[log.status] ?? log.status}
                    </Tag>
                    <span className="font-medium">{KIND_LABEL[log.kind] ?? log.kind}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {`账号 ${log.account_id ?? '—'}`}
                    </span>
                    <span className="
                      min-w-0 flex-1 truncate text-muted-foreground
                    "
                    >
                      {log.message || '—'}
                    </span>
                    <span className="text-muted-foreground">{log.created_time.slice(5, 19)}</span>
                  </li>
                ))}
              </ul>
            )
          : <Empty text="还没有运行记录" />}
      </Card>
    </>
  );
}

export const dynamic = 'force-dynamic';
