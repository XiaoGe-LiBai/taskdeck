import { ProjectsManager } from '@/features/panel/ProjectsManager';
import { Card, Empty, PageTitle, Tag } from '@/features/panel/Ui';
import { panelGet, panelSend } from '@/libs/PanelApi';

type ProjectRow = {
  id: number;
  project_key: string;
  channel: string;
  channel_label: string;
  name: string;
  points_cost: number;
  hidden: number;
  status: string;
  grants: { user_id: number; email: string; nickname: string }[];
};

type Payload = {
  projects: ProjectRow[];
  users: { id: number; email: string; nickname: string; role: string; channel: string }[];
  stats: { total: number; hidden: number; priced: number; granted: number };
};

export default async function ProjectsPage(props: {
  searchParams: Promise<{ sync?: string }>;
}) {
  const query = await props.searchParams;

  if (query.sync === '1') {
    await panelSend('POST', '/admin/projects/sync', {});
  }

  const data = await panelGet<Payload>('/admin/projects');

  if (!data) {
    return (
      <>
        <PageTitle title="项目管理" description="积分定价 · 隐藏与单独授权" />
        <Card title="读不到项目目录">
          <Empty text="需要管理员权限。" />
        </Card>
      </>
    );
  }

  const { projects, users, stats } = data;

  return (
    <>
      <PageTitle
        title="项目管理"
        description="给每个项目设「提交同步到青龙」要花多少积分；可隐藏项目并单独放给某个用户"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Tag tone="gray">{`项目 ${stats.total}`}</Tag>
        <Tag tone={stats.priced ? 'success' : 'gray'}>{`已定价 ${stats.priced}`}</Tag>
        <Tag tone={stats.hidden ? 'warning' : 'gray'}>{`隐藏 ${stats.hidden}`}</Tag>
        <Tag tone={stats.granted ? 'info' : 'gray'}>{`单独授权 ${stats.granted}`}</Tag>
        <span className="text-muted-foreground">
          积分两个渠道共用一套余额：改价后用户提交时按这里的价格扣
        </span>
      </div>

      <Card title="项目定价与可见性" description="行内改价 / 勾隐藏 / 指定可见用户，改完点「保存改动」">
        <ProjectsManager projects={projects} users={users} />
      </Card>
    </>
  );
}

export const dynamic = 'force-dynamic';
