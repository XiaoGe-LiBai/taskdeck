import type { PanelList, PanelUserRow } from '@/types/Panel';
import { PageTitle } from '@/features/panel/Ui';
import { UsersManager } from '@/features/panel/UsersManager';
import { panelGet } from '@/libs/PanelApi';

export default async function UsersPage(props: {
  searchParams: Promise<{
    page?: string;
    size?: string;
    q?: string;
    role?: string;
    status?: string;
  }>;
}) {
  const query = await props.searchParams;

  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const size = Math.max(1, Number(query.size ?? 10) || 10);
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
  });

  if (query.q) {
    params.set('q', query.q.trim());
  }
  if (query.role) {
    params.set('role', query.role.trim());
  }
  if (query.status) {
    params.set('status', query.status.trim());
  }

  const data = await panelGet<PanelList<PanelUserRow>>(`/admin/users?${params.toString()}`);

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="用户全景管理"
        description="全平台用户数据透视、权限流转、资产调配与风控状态管理"
      />

      <UsersManager data={data} query={query} />
    </div>
  );
}

export const dynamic = 'force-dynamic';
