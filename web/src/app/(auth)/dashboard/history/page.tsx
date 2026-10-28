import type { MyHistory } from '@/types/Panel';
import { AnimatedList } from '@/components/reactbits';
import { CountValue, Empty, fmtTime, PageTitle, StatCard, Table, Tag, Td } from '@/features/panel/Ui';
import { panelGet } from '@/libs/PanelApi';

const signupStatusText: Record<string, string> = {
  success: '成功',
  pending: '执行中',
  failed: '失败',
};
const signupStatusTone: Record<string, 'success' | 'warning' | 'danger' | 'gray'> = {
  success: 'success',
  pending: 'warning',
  failed: 'danger',
};

export default async function HistoryPage() {
  const data = await panelGet<MyHistory>('/my/xiaocan-history');
  const records = data?.records ?? [];
  const signupCount = records.filter(r => r.kind === 'signup').length;
  const redeemCount = records.filter(r => r.kind === 'redeem').length;

  return (
    <>
      <PageTitle
        title="我的报名/抢兑记录"
        description="每次「立即报名」的执行结果、当前开抢的抢兑配置，按时间倒序"
      />

      <AnimatedList
        stagger={60}
        className="
          mb-6 grid gap-4
          sm:grid-cols-3
        "
      >
        <StatCard
          label="记录总计"
          value={<CountValue value={records.length} suffix="条" />}
          hint="近期抢券与抢兑动作"
          icon="📋"
        />
        <StatCard
          label="大牌券报名"
          value={<CountValue value={signupCount} suffix="次" />}
          hint="限量大牌与保底券执行"
          icon="🎫"
        />
        <StatCard
          label="元宝抢兑"
          value={<CountValue value={redeemCount} suffix="次" />}
          hint="自动准点抢兑权益"
          icon="🎁"
        />
      </AnimatedList>

      {records.length === 0
        ? <Empty text="还没有报名或抢兑记录，去「小蚕」页绑定账号后试试" />
        : (
            <Table head={['类型', '账号', '内容', '状态', '时间', '详情']}>
              {records.map((row) => {
                if (row.kind === 'signup') {
                  return (
                    <tr key={`signup-${row.id}`}>
                      <Td><Tag tone="info">报名</Tag></Td>
                      <Td>{row.account_nickname}</Td>
                      <Td>
                        <div className="font-medium">{row.tea_name || '—'}</div>
                        <div className="text-xs text-muted-foreground">
                          订单号：
                          {row.order_numbers || '—'}
                        </div>
                      </Td>
                      <Td>
                        <Tag tone={signupStatusTone[row.status ?? ''] ?? 'gray'}>
                          {signupStatusText[row.status ?? ''] ?? row.status ?? '—'}
                        </Tag>
                      </Td>
                      <Td className="text-xs tabular-nums">
                        {fmtTime(row.created_time)}
                        {row.finished_time && (
                          <div className="text-muted-foreground">
                            {fmtTime(row.finished_time)}
                          </div>
                        )}
                      </Td>
                      <Td className="
                        max-w-72 text-xs break-all text-muted-foreground
                      "
                      >
                        {row.error
                          ? <span className="text-destructive">{row.error}</span>
                          : (row.output || '—')}
                      </Td>
                    </tr>
                  );
                }
                return (
                  <tr key={`redeem-${row.account_id}`}>
                    <Td><Tag tone="warning">抢兑</Tag></Td>
                    <Td>{row.account_nickname}</Td>
                    <Td>
                      <div className="font-medium">{row.prize_name ?? `奖品#${row.exchange_id ?? '—'}`}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.yuanbao_cost ? `消耗 ${row.yuanbao_cost} 元宝` : ''}
                      </div>
                    </Td>
                    <Td>
                      {row.enabled
                        ? (
                            <Tag tone={row.runner_ready ? 'success' : 'danger'}>
                              {row.runner_ready ? '已开抢' : '派发失败'}
                            </Tag>
                          )
                        : <Tag tone="gray">已关闭</Tag>}
                    </Td>
                    <Td className="text-xs tabular-nums">{fmtTime(row.updated_time)}</Td>
                    <Td className="text-xs text-muted-foreground">
                      {row.runner_ready
                        ? '任务已排队，开抢前 20 秒自动启动'
                        : '任务暂未就绪，请稍后重试或联系管理员'}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
    </>
  );
}

export const dynamic = 'force-dynamic';
