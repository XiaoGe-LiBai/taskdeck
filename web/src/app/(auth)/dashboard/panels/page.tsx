import type { PanelQlPanel, PanelXiaocanTask } from '@/types/Panel';
import { AnimatedList } from '@/components/reactbits';
import { Input } from '@/components/ui/input';
import {
  addPanelAction,
  checkPanelAction,
  deletePanelAction,
  provisionPanelAction,
  runCronAction,
  stopCronAction,
} from '@/features/panel/actions';
import { ActionForm } from '@/features/panel/Client';
import { StateForm } from '@/features/panel/ExpireEditor';
import {
  Card,
  CountValue,
  Empty,
  fmtTime,
  PageTitle,
  StatCard,
  Table,
  Tag,
  Td,
} from '@/features/panel/Ui';
import { panelGet } from '@/libs/PanelApi';

export default async function PanelsPage() {
  const [panels, overview] = await Promise.all([
    panelGet<PanelQlPanel[]>('/admin/ql/panels'),
    panelGet<PanelXiaocanTask[]>('/admin/xiaocan-tasks'),
  ]);

  const taskCount = (overview ?? []).reduce((sum, item) => sum + item.tasks.length, 0);
  const onlineCount = (panels ?? []).filter(p => p.status === 'online').length;

  return (
    <>
      <PageTitle
        title="青龙面板"
        description={`${panels?.length ?? 0} 台面板 · 识别到 ${taskCount} 个小蚕托管任务`}
      />

      <AnimatedList
        stagger={60}
        className="
          mb-6 grid gap-4
          sm:grid-cols-3
        "
      >
        <StatCard
          label="已接入面板数"
          value={<CountValue value={panels?.length ?? 0} suffix="台" />}
          hint="多节点分布式下发载体"
          icon="🖥️"
        />
        <StatCard
          label="当前在线节点"
          value={<CountValue value={onlineCount} suffix="台" />}
          hint="OpenAPI 连通测试通过"
          icon="🟢"
        />
        <StatCard
          label="识别托管任务"
          value={<CountValue value={taskCount} suffix="个" />}
          hint="已同步到面板的定时作业"
          icon="⚡"
        />
      </AnimatedList>

      <Card
        className="mb-6"
        title="添加面板"
        description="用青龙「系统设置 → 应用」里的 Client ID / Client Secret 接入；账号密码是可选的，仅在面板内查看日志内容时才需要"
      >
        <StateForm action={addPanelAction} fields={{}} okLabel="面板已添加" submitLabel="添加面板">
          <Input
            name="name"
            placeholder="面板名（如 本机5700）"
            className="h-9 w-44 text-sm"
          />
          <Input
            name="remark"
            placeholder="备注（如 服）"
            className="h-9 w-28 text-sm"
          />
          <Input
            name="url"
            placeholder="http://ip:5700"
            className="h-9 w-52 text-sm"
          />
          <Input
            name="client_id"
            placeholder="Client ID"
            className="h-9 w-40 text-sm"
          />
          <Input
            name="client_secret"
            type="password"
            placeholder="Client Secret"
            className="h-9 w-44 text-sm"
          />
          <Input
            name="username"
            placeholder="日志账号（可选）"
            className="h-9 w-32 text-sm"
          />
          <Input
            name="password"
            type="password"
            placeholder="日志密码（可选）"
            className="h-9 w-32 text-sm"
          />
        </StateForm>
      </Card>

      <AnimatedList
        stagger={70}
        className="
          grid gap-4
          lg:grid-cols-2
        "
      >
        {panels?.map((panel) => {
          const detail = overview?.find(item => item.id === panel.id);
          return (
            <Card
              key={panel.id}
              title={panel.remark || panel.name}
              description={`${panel.url} · ${panel.client_id || '未配置 Client ID'} · 上次检测 ${fmtTime(panel.last_check)}`}
              actions={(
                <Tag tone={panel.status === 'online' ? 'success' : panel.status === 'offline' ? 'danger' : 'gray'}>
                  {panel.status === 'online' ? '在线' : panel.status === 'offline' ? '离线' : '未测'}
                </Tag>
              )}
            >
              <div className="mb-3 flex flex-wrap items-start gap-2">
                <StateForm
                  action={checkPanelAction}
                  fields={{ panel_id: panel.id }}
                  okLabel="连接成功"
                  submitLabel="测试连通"
                >
                  <span className="text-xs text-muted-foreground">连通性</span>
                </StateForm>

                <StateForm
                  action={provisionPanelAction}
                  fields={{ panel_id: panel.id }}
                  okLabel="已下发 {v} 个任务"
                  submitLabel="一键下发任务"
                >
                  <span className="text-xs text-muted-foreground">托管任务</span>
                </StateForm>

                <ActionForm
                  action={deletePanelAction}
                  fields={{ panel_id: panel.id }}
                  confirm={`确认删除面板「${panel.remark || panel.name}」？该面板上的托管任务会解除绑定。`}
                  className="
                    [&_button]:border-destructive/40 [&_button]:text-destructive
                  "
                >
                  删除面板
                </ActionForm>
              </div>

              {detail?.error && (
                <div className="
                  mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs
                  text-destructive
                "
                >
                  {detail.error}
                </div>
              )}

              {detail?.tasks.length
                ? (
                    <Table head={['任务', '定时', '状态', '控制']}>
                      {detail.tasks.map(task => (
                        <tr key={task.id}>
                          <Td>
                            <div className="text-sm font-medium">{task.name}</div>
                            <div className="
                              max-w-[240px] truncate font-mono text-xs
                              text-muted-foreground
                            "
                            >
                              {task.command}
                            </div>
                          </Td>
                          <Td className="font-mono text-xs">{task.schedule || '—'}</Td>
                          <Td>
                            <Tag tone={task.isDisabled ? 'gray' : 'success'}>
                              {task.isDisabled ? '禁用' : '启用'}
                            </Tag>
                          </Td>
                          <Td>
                            <div className="flex gap-1.5">
                              <ActionForm action={runCronAction} fields={{ panel_id: panel.id, cron_id: task.id }}>
                                运行
                              </ActionForm>
                              <ActionForm action={stopCronAction} fields={{ panel_id: panel.id, cron_id: task.id }}>
                                停止
                              </ActionForm>
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </Table>
                  )
                : (
                    <Empty text="该面板暂无小蚕任务，可点上方「托管任务」一键下发" />
                  )}
            </Card>
          );
        })}

        {!panels?.length && (
          <Card title="还没有接入青龙面板">
            <Empty text="用上面的表单添加 url / 账号 / 密码" />
          </Card>
        )}
      </AnimatedList>
    </>
  );
}

export const dynamic = 'force-dynamic';
