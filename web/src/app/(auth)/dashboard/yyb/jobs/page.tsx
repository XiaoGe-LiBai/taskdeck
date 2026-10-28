import type { YybAccount, YybJobsPayload } from '@/types/Panel';
import { ActionForm } from '@/features/panel/Client';
import { Card, Empty, fmtTime, PageTitle, Table, Tag, Td } from '@/features/panel/Ui';
import { yybRunJobAction, yybToggleJobAction } from '@/features/panel/yybActions';
import { panelGet } from '@/libs/PanelApi';

type RunEntry = {
  log_key: string;
  script_key?: string;
  time?: string;
  create_time?: string;
  size?: number;
};

export default async function YybJobsPage(props: {
  searchParams: Promise<{ ref?: string; script_key?: string }>;
}) {
  const query = await props.searchParams;

  const accounts = await panelGet<YybAccount[]>('/yyb/accounts');
  const ref = query.ref ?? String(accounts?.[0]?.id ?? '');

  const [jobs, runs] = await Promise.all([
    ref ? panelGet<YybJobsPayload>(`/yyb/jobs?ref=${ref}`) : Promise.resolve(null),
    ref ? panelGet<{ runs?: RunEntry[]; logs?: RunEntry[] }>(`/yyb/runs?ref=${ref}`) : Promise.resolve(null),
  ]);

  const runList = (runs?.runs ?? runs?.logs ?? []).slice(0, 15);
  const current = accounts?.find(a => String(a.id) === String(ref));

  return (
    <>
      <PageTitle
        title="应用宝 · 运行管理"
        description="每个微信号独立托管脚本：任务清单、运行触发、历史日志"
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {(accounts ?? []).map(account => (
          <a
            key={account.id}
            href={`/dashboard/yyb/jobs?ref=${account.id}`}
            className={`
              rounded-md border px-3 py-1.5 text-sm
              ${
          String(account.id) === String(ref)
            ? `bg-primary text-primary-foreground`
            : `hover:bg-muted`
          }
            `}
          >
            {account.display_name}
            <span className="ml-1 text-xs opacity-70">{`#${account.id}`}</span>
          </a>
        ))}
      </div>

      <div className="
        grid gap-4
        lg:grid-cols-2
      "
      >
        <Card
          title="托管脚本任务"
          description={current ? `账号：${current.display_name}（#${current.id}）` : '未选择账号'}
        >
          {jobs?.jobs?.length
            ? (
                <Table head={['脚本', '定时', '状态', '任务 ID', '操作']}>
                  {jobs.jobs.map(job => (
                    <tr key={job.script_key}>
                      <Td>
                        <div className="text-sm font-medium">{job.name || job.script_key}</div>
                        <div className="
                          max-w-[240px] truncate font-mono text-xs
                          text-muted-foreground
                        "
                        >
                          {job.script_key}
                        </div>
                      </Td>
                      <Td className="font-mono text-xs">{job.schedule || '—'}</Td>
                      <Td>
                        <Tag tone={job.enabled === false ? 'gray' : 'success'}>
                          {job.enabled === false ? '停用' : '启用'}
                        </Tag>
                      </Td>
                      <Td className="text-xs tabular-nums">{job.ql_cron_id ?? '—'}</Td>
                      <Td>
                        <div className="flex gap-1.5">
                          <ActionForm
                            action={yybRunJobAction}
                            fields={{ ref, script_key: job.script_key }}
                            confirm={`确认立刻运行「${job.name || job.script_key}」？`}
                          >
                            运行
                          </ActionForm>
                          <ActionForm
                            action={yybToggleJobAction}
                            fields={{ ref, script_key: job.script_key, enabled: job.enabled === false ? '1' : '0' }}
                          >
                            {job.enabled === false ? '启用' : '停用'}
                          </ActionForm>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </Table>
              )
            : (
                <Empty text="该账号还没有托管脚本。" />
              )}
        </Card>

        <Card title="历史运行" description="按时间倒序，最新在前">
          {runList.length
            ? (
                <Table head={['时间', '脚本', '大小', '日志']}>
                  {runList.map(run => (
                    <tr key={run.log_key}>
                      <Td className="text-xs tabular-nums">{fmtTime(run.time ?? run.create_time)}</Td>
                      <Td className="text-xs">{run.script_key || '—'}</Td>
                      <Td className="text-xs tabular-nums">
                        {run.size ? `${Math.round(run.size / 1024)} KB` : '—'}
                      </Td>
                      <Td>
                        <a
                          href={`/dashboard/yyb/log?ref=${ref}&log_key=${encodeURIComponent(run.log_key)}&script_key=${encodeURIComponent(run.script_key ?? '')}`}
                          className="
                            rounded-md border px-2.5 py-1 text-xs
                            hover:bg-muted
                          "
                        >
                          查看
                        </a>
                      </Td>
                    </tr>
                  ))}
                </Table>
              )
            : (
                <Empty text="暂无运行记录" />
              )}
        </Card>
      </div>
    </>
  );
}

export const dynamic = 'force-dynamic';
