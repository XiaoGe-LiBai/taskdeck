import type { PanelAnnouncement } from '@/types/Panel';
import { AnimatedList } from '@/components/reactbits';
import { NotificationSettings } from '@/features/panel/NotificationSettings';
import { Card, PageTitle, StatCard, Tag } from '@/features/panel/Ui';
import { UserNotifications } from '@/features/panel/UserNotifications';
import { panelGet, panelMe } from '@/libs/PanelApi';
import { announcementText } from '@/utils/Announcement';

export default async function NotificationsPage() {
  const [me, latestAnn] = await Promise.all([
    panelMe(),
    panelGet<PanelAnnouncement>('/announcements/latest'),
  ]);

  return (
    <>
      <PageTitle
        title="消息推送"
        description="系统通知中心 · 管理邮件通知与三方机器人推送通道"
      />

      <AnimatedList
        stagger={60}
        className="
          mb-6 grid gap-4
          sm:grid-cols-3
        "
      >
        <StatCard
          label="系统通知频道"
          value="已就绪"
          hint="支持系统公告与邮件提醒"
          icon="🔔"
          plain
        />
        <StatCard
          label="邮件提醒状态"
          value={me?.email ? '已绑定' : '未设置'}
          hint={me?.email ?? '请先在个人中心绑定'}
          icon="📧"
          plain
        />
        <StatCard
          label="微信/群机器人通道"
          value="PushPlus / Qmsg"
          hint="任务调度与协议服务已接入"
          icon="💬"
          plain
        />
      </AnimatedList>

      <div className="flex flex-col gap-6">
        {/* 个人站内信 */}
        <UserNotifications />

        {/* 系统最新公告 */}
        <Card
          title="系统公告与通知"
          description="系统重要变更、抢券维护及上车动态第一时间获悉"
        >
          {latestAnn
            ? (
                <div className="rounded-lg border bg-card/60 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-base font-semibold text-foreground">
                      📢
                      {' '}
                      {latestAnn.title}
                    </div>
                    <Tag tone="info">
                      v
                      {latestAnn.version}
                    </Tag>
                  </div>
                  <div className="
                    text-sm wrap-break-word whitespace-pre-line
                    text-muted-foreground
                  "
                  >
                    {announcementText(latestAnn.content)}
                  </div>
                  <div className="mt-3 font-mono text-xs text-muted-foreground">
                    发布时间：
                    {latestAnn.published_time ? latestAnn.published_time.replace('T', ' ').slice(0, 19) : '-'}
                  </div>
                </div>
              )
            : (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  暂无未读系统公告
                </div>
              )}
        </Card>

        {/* 用户个人通知设置 */}
        <NotificationSettings initialEmailNotify={true} />
      </div>
    </>
  );
}
