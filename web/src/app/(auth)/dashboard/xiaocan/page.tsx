import type { PanelAccount } from '@/types/Panel';
import Link from 'next/link';
import { AnimatedList } from '@/components/reactbits';
import { Card, CountValue, PageTitle, StatCard, Table, Tag, Td } from '@/features/panel/Ui';
import { XiaocanBindPanel } from '@/features/panel/XiaocanBindPanel';
import { panelGet, panelMe } from '@/libs/PanelApi';

const XIAOCAN_TASKS = [
  { name: '限量大牌券-代理版', script: '小蚕限量大牌券-代理版.py', schedule: '10 28 9 * * *', time: '09:28:10', type: '限量抢券' },
  { name: '保底大牌券', script: '小蚕保底大牌券.py', schedule: '45 59 8 * * *', time: '08:59:45', type: '保底券' },
  { name: '会员专属返利券', script: '小蚕会员专属返利券.py', schedule: '05 59 8 * * *', time: '08:59:05', type: '返利券' },
  { name: '每日签到', script: '小蚕每日签到.py', schedule: '03 35 9 * * *', time: '09:35:03', type: '日常签到' },
  { name: '元宝一键领取', script: '小蚕元宝一键领取.py', schedule: '00 31 22 * * *', time: '22:31:00', type: '资产福利' },
  { name: '元宝抽奖', script: '小蚕元宝抽奖.py', schedule: '14 3 0 * * *', time: '00:03:14', type: '抽奖福利' },
  { name: '影音周卡', script: '小蚕影音会员周卡.py', schedule: '10 5 0 * * *', time: '00:05:10', type: '周卡权益' },
  { name: '红包雨', script: '小蚕红包雨.py', schedule: '50 59 11 * * *', time: '11:59:50', type: '限时福利' },
  { name: '免单券', script: '小蚕免单券.py', schedule: '45 59 19 * * *', time: '19:59:45', type: '限时抢免单' },
  { name: '双节抽礼', script: '小蚕双节抽好礼.py', schedule: '00 40 9 * * *', time: '09:40:00', type: '节日活动' },
];

export default async function XiaoCanPage() {
  const [accounts, me] = await Promise.all([
    panelGet<PanelAccount[]>('/xiaocan/accounts'),
    panelMe(),
  ]);
  const safeAccounts = accounts ?? [];
  const isAdmin = me?.role === 'admin';

  return (
    <>
      <PageTitle
        title="小蚕 · 大牌券业务"
        description="小蚕专区自动化：涵盖限量大牌、保底券、返利券、元宝领取与影音周卡等 10 项托管任务"
        actions={(
          <div className="flex gap-2">
            <Link
              href="/dashboard/accounts"
              className="
                rounded-md border bg-card px-3 py-2 text-sm font-medium
                transition-all duration-150
                hover:bg-muted
                active:scale-95
              "
            >
              账号订单管理
            </Link>
            {/* 执行日志有两个落点：管理员看全站「任务日志」(管理端)，
                普通用户只能看自己的「报名/抢兑记录」，别把用户引到管理端去 */}
            <Link
              href={isAdmin ? '/dashboard/logs' : '/dashboard/history'}
              className="
                rounded-md bg-brand-gradient px-3 py-2 text-sm font-medium
                text-white shadow-sm transition-all duration-150
                hover:opacity-95
                active:scale-95
              "
            >
              {isAdmin ? '查看执行日志' : '我的执行记录'}
            </Link>
          </div>
        )}
      />

      <AnimatedList
        stagger={60}
        className="
          mb-6 grid gap-4
          sm:grid-cols-3
        "
      >
        <StatCard
          label="已配置小蚕账号"
          value={<CountValue value={safeAccounts.length} suffix="个" />}
          hint="逐账号独立配置各项大牌券开关"
          icon="🎫"
        />
        <StatCard
          label="预置托管任务数"
          value={<CountValue value={10} suffix="项" />}
          hint="覆盖每日抢券、返利与元宝抽奖"
          icon="⚡"
        />
        <StatCard
          label="调度引擎"
          value="自动调度"
          hint="多节点并发与毫秒级抢跑"
          icon="🚀"
        />
      </AnimatedList>

      <div className="flex flex-col gap-6">
        <Card
          title="小蚕账号登录 / 绑定"
          description="用微信扫码登录小蚕账号接入托管；绑定完成后在「账号管理」中维护开关与有效期"
        >
          <XiaocanBindPanel />
        </Card>

        <Card
          title="小蚕自动化任务流水"
          description="系统自动编排的 10 项核心任务，支持毫秒级时钟校准与多节点并发执行"
        >
          <Table head={['业务任务', '类型', '执行时段', '调度 Cron', '状态']}>
            {XIAOCAN_TASKS.map(t => (
              <tr key={t.name}>
                <Td>
                  <div className="font-semibold text-foreground">{t.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{t.script}</div>
                </Td>
                <Td>
                  <Tag tone="info">{t.type}</Tag>
                </Td>
                <Td className="font-mono text-sm">{t.time}</Td>
                <Td className="font-mono text-xs text-muted-foreground">{t.schedule}</Td>
                <Td>
                  <Tag tone="success">运行中</Tag>
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
