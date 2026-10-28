import type { CustomSubmission, PanelProject } from '@/types/Panel';
import { SubmitManager } from '@/features/panel/SubmitManager';
import { PageTitle } from '@/features/panel/Ui';
import { panelGet, panelMe } from '@/libs/PanelApi';

type ProjectsPayload = {
  projects: PanelProject[];
  role?: string;
  my_role?: string;
};

type SubmissionsPayload = {
  submissions: CustomSubmission[];
  total: number;
};

export default async function MarketPage() {
  // 并发拉取自定义脚本、用户资料与历史提交
  const [projectsData, me, subsData] = await Promise.all([
    panelGet<ProjectsPayload>('/custom-scripts'),
    panelMe(),
    panelGet<SubmissionsPayload>('/custom-scripts/submissions'),
  ]);

  // 自定义脚本进入提交流程
  const projects = (projectsData?.projects ?? []).filter(p => p.channel === 'custom');
  const balance = Number(me?.points_balance ?? 0);
  const submissions = subsData?.submissions ?? [];

  return (
    <>
      <PageTitle
        title="项目市场"
        description="浏览上架脚本与服务 · 填写动态参数配置 · 提交后自动加入托管运行"
      />
      <SubmitManager
        projects={projects}
        balance={balance}
        initialSubmissions={submissions}
        userRole={me?.role ?? 'user'}
      />
    </>
  );
}
