import type { PanelTaskLogs } from '@/types/Panel';
import { AnimatedList } from '@/components/reactbits';
import {
  Card,
  Empty,
  PageTitle,
  Tag,
} from '@/features/panel/Ui';
import { panelGet } from '@/libs/PanelApi';

const stateText = { success: '执行成功', error: '存在异常', unknown: '执行记录' } as const;
const stateTone = { success: 'success', error: 'danger', unknown: 'gray' } as const;

export default async function LogsPage(props: {
  searchParams: Promise<{ date?: string; task?: string }>;
}) {
  const query = await props.searchParams;

  const date = query.date ?? new Date().toISOString().slice(0, 10);
  const params = new URLSearchParams({ date });
  if (query.task) {
    params.set('task', query.task);
  }

  const logs = await panelGet<PanelTaskLogs>(`/admin/task-logs?${params.toString()}`);

  const chip = (label: string, key: string) => {
    const search = new URLSearchParams({ date });
    if (key) {
      search.set('task', key);
    }
    return (
      <a
        key={key || 'all'}
        href={`/dashboard/logs?${search.toString()}`}
        className={`
          rounded-md border px-3 py-1.5 text-sm transition-all duration-150 active:scale-95
          ${
      (query.task ?? '') === key
        ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
        : `hover:bg-muted`
      }
        `}
      >
        {label}
      </a>
    );
  };

  return (
    <>
      <PageTitle
        title="任务日志"
        description="多台青龙面板按任务与执行场次合并，按时间倒序展示"
        actions={(
          <form className="flex items-end gap-2" action="/dashboard/logs">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              查看日期
              <input
                type="date"
                name="date"
                defaultValue={date}
                className="rounded-md border bg-transparent px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              className="
                rounded-md border px-3 py-2 text-sm
                hover:bg-muted
              "
            >
              查询
            </button>
          </form>
        )}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {chip('全部', '')}
        {(logs?.tasks ?? []).map(task => chip(task.name, task.key))}
      </div>

      {logs?.events?.length
        ? (
            <AnimatedList stagger={60} className="flex flex-col gap-3">
              {logs.events.map(event => (
                <Card key={`${event.task_key}-${event.time}`} className="p-0 transition-transform duration-200 hover:scale-[1.005]">
                  <div className="
                    flex items-center justify-between gap-3 border-b px-5 py-3
                  "
                  >
                    <div>
                      <div className="font-medium">
                        {event.time.slice(11, 16)}
                        {' · '}
                        {event.task_name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {event.panel_count}
                        {' '}
                        个面板日志
                      </div>
                    </div>
                    <Tag tone={stateTone[event.state]}>{stateText[event.state]}</Tag>
                  </div>

                  <div className="divide-y">
                    {event.entries.map(entry => (
                      <details
                        key={`${entry.panel_id}-${entry.file}`}
                        className="px-5 py-3"
                      >
                        <summary className="
                          flex cursor-pointer items-center justify-between
                          text-sm transition-colors hover:text-primary
                        "
                        >
                          <span className="font-medium">{entry.panel_name}</span>
                          <span className="text-xs text-muted-foreground">
                            {entry.time}
                            {' · '}
                            {entry.file}
                          </span>
                        </summary>
                        <pre className="
                          mt-3 max-h-80 overflow-auto rounded-md bg-muted p-3
                          text-xs whitespace-pre-wrap
                        "
                        >
                          {entry.output || '日志为空'}
                        </pre>
                      </details>
                    ))}
                  </div>
                </Card>
              ))}
            </AnimatedList>
          )
        : (
            <Card>
              <Empty text={`${date} 暂无任务日志`} />
            </Card>
          )}
    </>
  );
}

export const dynamic = 'force-dynamic';
