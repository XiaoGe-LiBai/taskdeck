import type { YybMyActivitiesPayload } from '@/types/Panel';
import Link from 'next/link';

import { Card, Empty, PageTitle } from '@/features/panel/Ui';
import { YybUserActivitiesManager } from '@/features/panel/YybUserActivitiesManager';
import { panelGet, panelMe } from '@/libs/PanelApi';

export default async function YybActivitiesPage(props: {
  searchParams: Promise<{ account?: string }>;
}) {
  const [user, query] = await Promise.all([
    panelMe(),
    props.searchParams,
  ]);

  if (!user) {
    return null;
  }

  const data = await panelGet<YybMyActivitiesPayload>('/yyb/my-activities');

  if (!data) {
    return (
      <>
        <PageTitle
          title="应用宝 · 小程序活动"
          description="自主管理您的微信账号参与哪些小程序任务与签到活动"
        />
        <Card title="服务连接异常">
          <Empty text="活动列表暂时加载失败，请稍后重试；若持续失败请联系管理员。" />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageTitle
        title="应用宝 · 小程序活动管理"
        description="勾选开启或停用名下微信账号的小程序任务；支持搜索筛选、一键全选及多账号配置同步"
        actions={(
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/yyb"
              className="
                rounded-md border border-input bg-background px-3 py-1.5 text-xs
                font-medium text-foreground transition
                hover:bg-muted
              "
            >
              ← 返回账号列表
            </Link>
          </div>
        )}
      />

      <YybUserActivitiesManager
        initialData={data}
        defaultAccountRef={query.account}
      />
    </>
  );
}

export const dynamic = 'force-dynamic';
