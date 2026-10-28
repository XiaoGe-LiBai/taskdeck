import type { PanelAnnouncement } from '@/types/Panel';
import { AnimatedList } from '@/components/reactbits';
import {
  deleteAnnouncementAction,
  saveAnnouncementAction,
} from '@/features/panel/actions';
import { ActionForm } from '@/features/panel/Client';
import { StateForm } from '@/features/panel/ExpireEditor';
import { Card, CountValue, Empty, fmtTime, PageTitle, StatCard, Tag } from '@/features/panel/Ui';
import { panelGet } from '@/libs/PanelApi';
import { announcementText } from '@/utils/Announcement';

/**
 * 公告管理（管理员视角）。
 *
 * 布局思路：左边「读」、右边「写」。
 *  - 左栏是公告列表，默认全部收起（`<details>`，SSR 可用、不引入客户端状态），
 *    展开才出现编辑表单 —— 以前每条公告的表单都常驻展开，公告一多整页全是输入框。
 *  - 右栏是发布区，桌面端 sticky 吸顶，滚动翻列表时随时能发新公告。
 *
 * 「用户端展示中」的口径必须与后端 /announcements/latest 完全一致：
 * `COALESCE(updated_time, published_time)` 最大的那一条（修订会刷新 updated_time，
 * 所以「保存并发布」也能把老公告顶上去）。这里按同一规则在本地算一遍，
 * 而不是直接取列表第一行 —— 列表按 id 倒序（发布顺序），多条公告并存时两者会分叉。
 *
 * version 是「这条公告被改过几次」，只做展示，不参与排序。
 */
export default async function AnnouncementsPage() {
  const list = (await panelGet<PanelAnnouncement[]>('/admin/announcements')) ?? [];
  const revisions = list.reduce((sum, item) => sum + Math.max(0, (item.version ?? 1) - 1), 0);

  /** 与后端同一口径：最近「有动静」的那条（发布或修订都算） */
  const activity = (item: PanelAnnouncement) => item.updated_time || item.published_time;
  const delivered = list.reduce<PanelAnnouncement | null>(
    (best, item) => (!best || activity(item) > activity(best) ? item : best),
    null,
  );

  return (
    <>
      <PageTitle
        title="公告管理"
        description="发布与修订平台公告；用户端在「控制台」与「消息推送」页读取同一最新条"
        actions={(
          <a
            href="#publish"
            className="
              rounded-md bg-brand-gradient px-3.5 py-2 text-sm font-medium
              text-white shadow-sm
              hover:opacity-95
            "
          >
            ＋ 发布新公告
          </a>
        )}
      />

      <AnimatedList
        stagger={60}
        className="
          mb-6 grid grid-cols-2 gap-4
          lg:grid-cols-4
        "
      >
        <StatCard
          label="公告总数"
          value={<CountValue value={list.length} suffix="条" />}
          hint="列表按发布顺序倒序"
          icon="📢"
        />
        <StatCard
          label="用户端展示中"
          value={delivered ? `v${delivered.version}` : '—'}
          hint={delivered ? delivered.title : '暂无公告'}
          icon="📡"
          plain
        />
        <StatCard
          label="累计修订"
          value={<CountValue value={revisions} suffix="次" />}
          hint="每条公告保存一次记 1 次"
          icon="✏️"
        />
        <StatCard
          label="最近活动时间"
          value={delivered ? fmtTime(activity(delivered)) : '—'}
          hint={delivered?.updated_time ? '来自最近一次修订' : '来自最近一次发布'}
          icon="🕒"
          plain
        />
      </AnimatedList>

      <div className="
        grid items-start gap-6
        lg:grid-cols-3
      "
      >
        {/* ---------------------------------------------- 左：公告列表 */}
        <Card
          className="lg:col-span-2"
          title="公告列表"
          description="点击任意一条展开编辑；列表默认收起，避免表单铺满整页"
          actions={<Tag tone="gray">{`共 ${list.length} 条`}</Tag>}
        >
          {list.length
            ? (
                <div className="flex flex-col">
                  {list.map((item) => {
                    const text = announcementText(item.content);
                    const edited = item.updated_time && item.updated_time !== item.published_time;
                    const live = item.id === delivered?.id;

                    return (
                      <details
                        key={item.id}
                        className="
                          group border-b border-border/60
                          last:border-b-0
                        "
                      >
                        <summary
                          className="
                            flex cursor-pointer list-none items-center gap-3
                            rounded-md px-2 py-3 transition-colors
                            hover:bg-brand-soft
                            [&::-webkit-details-marker]:hidden
                          "
                        >
                          <span
                            className="
                              shrink-0 text-xs text-muted-foreground
                              transition-transform duration-200
                              group-open:rotate-90
                            "
                            aria-hidden
                          >
                            ▶
                          </span>

                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">{item.title}</span>
                              {live && <Tag tone="success">用户端展示中</Tag>}
                            </div>
                            <div className="
                              mt-0.5 text-xs text-muted-foreground
                            "
                            >
                              发布于
                              {' '}
                              {fmtTime(item.published_time)}
                              {' · '}
                              {text.length}
                              {' '}
                              字
                              {edited ? ` · 更新于 ${fmtTime(item.updated_time)}` : ''}
                            </div>
                          </div>

                          <Tag tone={live ? 'success' : 'gray'}>
                            {`v${item.version}`}
                          </Tag>
                        </summary>

                        <div className="flex flex-col gap-3 px-2 pt-1 pb-4 pl-7">
                          <div className="
                            rounded-md border bg-muted/40 px-3 py-2 text-sm
                          "
                          >
                            <div className="text-xs text-muted-foreground">用户端看到的内容</div>
                            <div className="
                              mt-1 leading-relaxed wrap-break-word
                              whitespace-pre-line
                            "
                            >
                              {text || '（空）'}
                            </div>
                          </div>

                          <StateForm
                            action={saveAnnouncementAction}
                            fields={{ id: item.id }}
                            className="flex-col items-stretch gap-2"
                            okLabel="已保存（版本号 +1，用户端立即读到新内容）"
                            submitLabel="保存并发布"
                          >
                            <input
                              name="title"
                              defaultValue={item.title}
                              placeholder="公告标题"
                              className="
                                h-10 w-full rounded-md border bg-transparent
                                px-3 text-sm
                              "
                            />
                            <textarea
                              name="content"
                              rows={5}
                              defaultValue={item.content}
                              placeholder="公告内容"
                              className="
                                min-h-24 w-full resize-y rounded-md border
                                bg-transparent px-3 py-2 font-mono text-sm
                              "
                            />
                          </StateForm>

                          <div className="flex justify-end">
                            <ActionForm
                              action={deleteAnnouncementAction}
                              fields={{ id: item.id }}
                              confirm={`确认删除公告「${item.title}」？用户端将立即不再展示。`}
                              className="
                                [&_button]:border-destructive/40
                                [&_button]:text-destructive
                              "
                            >
                              删除公告
                            </ActionForm>
                          </div>
                        </div>
                      </details>
                    );
                  })}
                </div>
              )
            : <Empty text="暂无公告，右侧发布第一条" />}
        </Card>

        {/* ---------------------------------------------- 右：发布区 + 投递说明 */}
        <div className="
          flex flex-col gap-6
          lg:sticky lg:top-6
        "
        >
          <Card
            title="发布新公告"
            description="提交后版本号从 v1 起算，用户端立即可见"
          >
            <span id="publish" className="block scroll-mt-24" />
            <StateForm
              action={saveAnnouncementAction}
              fields={{}}
              className="flex-col items-stretch gap-3"
              okLabel="公告已发布"
              submitLabel="发布公告"
            >
              <input
                name="title"
                placeholder="公告标题（如：抢券脚本维护通知）"
                className="
                  h-10 w-full rounded-md border bg-transparent px-3 text-sm
                "
              />
              <textarea
                name="content"
                rows={6}
                placeholder={'公告内容（纯文本）\n例：本周日凌晨 2:00-4:00 平台维护，抢券任务暂停。'}
                className="
                  min-h-28 w-full resize-y rounded-md border bg-transparent px-3
                  py-2 font-mono text-sm
                "
              />
              <p className="text-xs text-muted-foreground">
                内容按纯文本渲染，HTML 标签不会生效（防止管理员账号被盗后成为投递通道）。
              </p>
            </StateForm>
          </Card>

          <Card title="用户端投递说明" description="公告发布或修订后，用户在哪里看到">
            <ul className="flex flex-col gap-2.5 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <span aria-hidden>🏠</span>
                <span>
                  <strong className="text-foreground">控制台</strong>
                  {' '}
                  （
                  <code className="font-mono text-xs">/dashboard</code>
                  ）底部「最新系统公告」
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden>🔔</span>
                <span>
                  <strong className="text-foreground">消息推送</strong>
                  {' '}
                  （
                  <code className="font-mono text-xs">/dashboard/notifications</code>
                  ）「系统公告与通知」
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden>📡</span>
                <span>
                  两处展示的是
                  {' '}
                  <strong className="text-foreground">同一条</strong>
                  ：最近发布或修订的那条（即上面标了「用户端展示中」的公告）
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden>🔖</span>
                <span>
                  修订任意公告都会把它顶成用户端可见的那条；版本号只表示这条被改过几次
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden>🗑️</span>
                <span>
                  删除公告后用户端立即改读上一条，无历史留档
                </span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

export const dynamic = 'force-dynamic';
