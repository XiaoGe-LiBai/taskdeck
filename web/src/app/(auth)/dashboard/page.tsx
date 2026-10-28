import type {
  PanelAccount,
  PanelAnnouncement,
  PanelFailure,
  PanelQlPanel,
  PanelStats,
  PanelTaskLogs,
} from '@/types/Panel';
import { AdminDashboard } from '@/features/panel/AdminDashboard';
import { UserDashboard } from '@/features/panel/UserDashboard';
import { panelGet, panelMe } from '@/libs/PanelApi';

const today = () => new Date().toISOString().slice(0, 10);

export default async function DashboardPage() {
  const user = await panelMe();
  const isAdmin = user?.role === 'admin';

  if (!isAdmin) {
    // 普通用户数据加载：只查当前用户所属数据，绝不请求 /admin/* 接口
    const [accounts, checkinInfo, transData, announcement] = await Promise.all([
      panelGet<PanelAccount[]>('/xiaocan/accounts'),
      panelGet<{
        balance: number;
        checked_in_today: boolean;
        total_days: number;
        records: Array<{ date: string; reward: number }>;
      }>('/points/check-in'),
      panelGet<{
        records: Array<{
          id: number;
          amount: number;
          type: string;
          type_text: string;
          note: string;
          created_time: string;
        }>;
        total: number;
      }>('/points/transactions?page=1&size=5'),
      // 注意：这个接口返回的是「单条公告对象」，不是数组（无公告时为 null）。
      // 之前这里写成 PanelAnnouncement[]，导致 announcements.length 恒为 undefined，
      // 控制台的公告卡片从来没渲染出来过。
      panelGet<PanelAnnouncement>('/announcements/latest'),
    ]);

    return (
      <UserDashboard
        user={user}
        accounts={accounts ?? []}
        checkinInfo={checkinInfo}
        transactions={transData?.records ?? []}
        announcement={announcement}
      />
    );
  }

  // 管理员数据加载：平台全站监控数据
  const todayStr = today();
  const [stats, failures, panels, logs] = await Promise.all([
    panelGet<PanelStats>('/admin/stats'),
    panelGet<{ records: PanelFailure[] }>('/admin/brand-coupon-failures?days=7'),
    panelGet<PanelQlPanel[]>('/admin/ql/panels'),
    panelGet<PanelTaskLogs>(`/admin/task-logs?date=${todayStr}`),
  ]);

  return (
    <AdminDashboard
      stats={stats}
      failures={failures}
      panels={panels}
      logs={logs}
      todayStr={todayStr}
    />
  );
}

export const dynamic = 'force-dynamic';
