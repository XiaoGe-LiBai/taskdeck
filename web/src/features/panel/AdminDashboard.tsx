import type { PanelFailure, PanelQlPanel, PanelStats, PanelTaskLogs } from '@/types/Panel';
import Link from 'next/link';
import { AnimatedList, CountUp, Magnet, ShinyText } from '@/components/reactbits';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  Empty,
  fen,
  fmtTime,
  PageTitle,
  StatCard,
  Table,
  Tag,
  Td,
} from '@/features/panel/Ui';

type AdminDashboardProps = {
  stats: PanelStats | null;
  failures: { records: PanelFailure[] } | null;
  panels: PanelQlPanel[] | null;
  logs: PanelTaskLogs | null;
  todayStr: string;
};

export const AdminDashboard = ({
  stats,
  failures,
  panels,
  logs,
  todayStr,
}: AdminDashboardProps) => {
  const vipLevels = stats?.vip_levels ?? {};
  const recentEvents = (logs?.events ?? []).slice(0, 6);

  return (
    <div className="flex section-enter flex-col gap-6">
      <PageTitle
        title="平台管理仪表盘"
        titleEffect="stroke"
        description="全站账号托管、卡密积分与青龙多节点运行状态一览（管理员视角）"
        actions={(
          <div className="flex gap-2">
            <Magnet strength={0.2} max={6}>
              <Link
                href="/dashboard/users"
                className="
                  inline-block rounded-md border bg-card px-3 py-2 text-sm
                  font-medium
                  hover:bg-muted
                "
              >
                👥 用户管理
              </Link>
            </Magnet>
            <Magnet strength={0.2} max={6}>
              <Link
                href="/dashboard/projects"
                className="
                  inline-block rounded-md border bg-card px-3 py-2 text-sm
                  font-medium
                  hover:bg-muted
                "
              >
                📦 项目管理
              </Link>
            </Magnet>
            <Magnet strength={0.25} max={8}>
              <Link
                href="/dashboard/settings"
                className="
                  inline-block rounded-md bg-brand-gradient px-3.5 py-2 text-sm
                  font-medium text-white shadow-sm
                  hover:opacity-95
                "
              >
                <ShinyText text="⚙️ 系统设置" speed={3} baseColor="#fff" />
              </Link>
            </Magnet>
          </div>
        )}
      />

      <AnimatedList
        stagger={70}
        className="
          grid grid-cols-2 gap-4
          lg:grid-cols-3
          xl:grid-cols-5
        "
      >
        <StatCard label="用户数" value={<CountUp to={stats?.users ?? 0} />} icon="👥" />
        <StatCard label="账号总数" value={<CountUp to={stats?.accounts ?? 0} />} icon="📋" />
        <StatCard label="SVIP 账号" value={<CountUp to={stats?.vip_accounts ?? 0} />} icon="👑" />
        <StatCard
          label="卡密总数"
          value={<CountUp to={stats?.cards_total ?? 0} />}
          hint={`已使用 ${stats?.cards_used ?? 0}`}
          icon="🎫"
        />
        <StatCard
          label="积分发放（分）"
          value={<CountUp to={stats?.points_issued ?? 0} />}
          hint={`消耗 ${fen(stats?.points_spent)}`}
          icon="💎"
        />
      </AnimatedList>

      <div className="
        grid gap-6
        lg:grid-cols-3
      "
      >
        <Card title="小蚕等级分布" description="按全站账号 SVIP 等级聚合">
          <div className="flex flex-col gap-2">
            {[6, 5, 4, 3, 2].map(level => (
              <div
                key={level}
                className="flex items-center justify-between text-sm"
              >
                <span className="flex items-center gap-2">
                  <Badge variant="secondary">
                    SVIP
                    {level}
                  </Badge>
                </span>
                <span className="font-semibold tabular-nums">
                  {vipLevels[String(level)] ?? 0}
                  {' '}
                  个
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="青龙面板" description="托管任务的执行机器">
          {panels && panels.length > 0
            ? (
                <div className="flex flex-col gap-3">
                  {panels.map(panel => (
                    <div
                      key={panel.id}
                      className="flex items-center justify-between text-sm"
                    >
                      <div>
                        <div className="font-medium">{panel.remark || panel.name}</div>
                        <div className="text-xs text-muted-foreground">{panel.url}</div>
                      </div>
                      <Tag tone={panel.status === 'online' ? 'success' : 'danger'}>
                        {panel.status === 'online' ? '在线' : panel.status === 'offline' ? '离线' : '未测'}
                      </Tag>
                    </div>
                  ))}
                </div>
              )
            : (
                <Empty text="还没有接入青龙面板" />
              )}
        </Card>

        <Card title="近 7 日限量大牌券未中" description="库存耗尽等失败原因">
          {failures?.records?.length
            ? (
                <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
                  {failures.records.slice(0, 8).map((item, index) => (
                    <div
                      key={`${item.run_date}-${item.account_info}-${index}`}
                      className="text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{item.nickname || '未命名账号'}</span>
                        <Tag tone="warning">库存耗尽</Tag>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.run_date}
                        {' · SVIP'}
                        {item.vip_level || '-'}
                        {' · '}
                        {item.panel_name || '未分配'}
                      </div>
                    </div>
                  ))}
                </div>
              )
            : (
                <Empty text="近 7 日暂无未中记录" />
              )}
        </Card>
      </div>

      <Card title="最近任务执行" description={`${todayStr} 的全站多面板执行记录`}>
        {recentEvents.length
          ? (
              <Table head={['时间', '任务', '面板数', '状态']}>
                {recentEvents.map(event => (
                  <tr key={`${event.task_key}-${event.time}`}>
                    <Td className="tabular-nums">{fmtTime(event.time)}</Td>
                    <Td>{event.task_name}</Td>
                    <Td>{event.panel_count}</Td>
                    <Td>
                      <Tag tone={event.state === 'success' ? 'success' : event.state === 'error' ? 'danger' : 'gray'}>
                        {event.state === 'success' ? '执行成功' : event.state === 'error' ? '存在异常' : '执行记录'}
                      </Tag>
                    </Td>
                  </tr>
                ))}
              </Table>
            )
          : (
              <Empty text="今日暂无任务日志（青龙面板接入后自动汇总）" />
            )}
      </Card>
    </div>
  );
};
