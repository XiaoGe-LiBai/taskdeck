import type { PanelUser } from '@/libs/PanelApi';
import type { PanelAccount, PanelAnnouncement } from '@/types/Panel';
import Link from 'next/link';
import { AnimatedList, CountUp, FadeContent, Magnet, ShinyText, TiltCard } from '@/components/reactbits';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  Empty,
  fmtTime,
  PageTitle,
  StatCard,
  Table,
  Tag,
  Td,
} from '@/features/panel/Ui';
import { announcementText } from '@/utils/Announcement';

type Transaction = {
  id: number;
  amount: number;
  type: string;
  type_text: string;
  note: string;
  created_time: string;
};

type CheckInInfo = {
  balance: number;
  checked_in_today: boolean;
  total_days: number;
  records: Array<{ date: string; reward: number }>;
};

type UserDashboardProps = {
  user: PanelUser | null;
  accounts: PanelAccount[];
  checkinInfo: CheckInInfo | null;
  transactions: Transaction[];
  /** 用户端可见的公告：后端 /announcements/latest 只给「最近发布或修订」的那一条 */
  announcement: PanelAnnouncement | null;
};

export const UserDashboard = ({
  user,
  accounts,
  checkinInfo,
  transactions,
  announcement,
}: UserDashboardProps) => {
  const activeCount = accounts.filter(a => a.status === 'enabled').length;
  const balance = user?.points_balance ?? checkinInfo?.balance ?? 0;
  const checkedIn = checkinInfo?.checked_in_today ?? false;
  const totalDays = checkinInfo?.total_days ?? 0;
  const pointsSpent = user?.points_spent ?? 0;
  const slotUsed = user?.slot_used ?? accounts.length;
  const slotTotal = user?.slot_total ?? 10;
  const inviteCode = user?.invite_code || '';

  return (
    <div className="flex section-enter flex-col gap-6">
      {/* 头部标题与快捷入口 */}
      <PageTitle
        title="控制台"
        titleEffect="stroke"
        description={`欢迎回来，${user?.nickname || user?.email || '用户'}！查看您的资产概况、托管账号与快捷业务`}
        actions={(
          <div className="flex gap-2">
            <Magnet strength={0.2} max={6}>
              <Link
                href="/dashboard/checkin"
                className="
                  inline-block rounded-md border bg-card px-3 py-2 text-sm
                  font-medium
                  hover:bg-muted
                "
              >
                📅
                {' '}
                {checkedIn ? '打卡记录' : '立即打卡'}
              </Link>
            </Magnet>
            <Magnet strength={0.25} max={8}>
              <Link
                href="/dashboard/profile"
                className="
                  inline-block rounded-md bg-brand-gradient px-3.5 py-2 text-sm
                  font-medium text-white shadow-sm
                  hover:opacity-95
                "
              >
                <ShinyText text="🪙 积分充值" speed={3} baseColor="#fff" />
              </Link>
            </Magnet>
          </div>
        )}
      />

      {/* 核心指标卡片：只看用户自己的数据（数字滚动 + 依次弹入） */}
      <AnimatedList
        stagger={70}
        className="
          grid grid-cols-2 gap-4
          lg:grid-cols-3
          xl:grid-cols-6
        "
      >
        <StatCard
          label="可用余额"
          value={<CountUp to={balance} />}
          hint="单位：分 · 可用于上车与任务扣费"
          icon="🪙"
        />
        <StatCard
          label="我的托管账号"
          value={(
            <>
              <CountUp to={accounts.length} />
              {' '}
              个
            </>
          )}
          hint={`${activeCount} 个正常运行中`}
          icon="📱"
          plain
        />
        <StatCard
          label="今日打卡状态"
          value={checkedIn ? '今日已签' : '今日待签'}
          hint={`累计签到 ${totalDays} 天`}
          icon={checkedIn ? '✅' : '⏳'}
          plain={checkedIn}
        />
        <StatCard
          label="累计消费"
          value={<CountUp to={pointsSpent} />}
          hint="单位：分 · 历史消耗统计"
          icon="💎"
          plain
        />
        <StatCard
          label="卡槽使用"
          value={(
            <>
              <CountUp to={slotUsed} />
              {' / '}
              <CountUp to={slotTotal} />
            </>
          )}
          hint="托管卡槽占用"
          icon="📦"
          plain
        />
        <StatCard
          label="我的邀请码"
          value={inviteCode || '未设置'}
          hint="邀请好友注册享福利"
          icon="🎁"
          plain
        />
      </AnimatedList>

      {/* 快捷业务专区 */}
      <Card title="业务专区快捷导航" description="一键前往常用业务模块">
        <div className="
          grid grid-cols-2 gap-3
          sm:grid-cols-3
          lg:grid-cols-6
        "
        >
          <TiltCard maxTilt={8} className="rounded-lg">
            <Link
              href="/dashboard/xiaocan"
              className="
                flex h-full flex-col items-center justify-center gap-2
                rounded-lg border bg-card p-4 text-center transition
                hover:border-primary/40 hover:bg-muted/50
              "
            >
              <Magnet strength={0.3} max={6}><span className="text-2xl">🎫</span></Magnet>
              <span className="text-sm font-semibold">小蚕大牌券</span>
              <span className="text-xs text-muted-foreground">10项托管任务</span>
            </Link>
          </TiltCard>
          <TiltCard maxTilt={8} className="rounded-lg">
            <Link
              href="/dashboard/yyb"
              className="
                flex h-full flex-col items-center justify-center gap-2
                rounded-lg border bg-card p-4 text-center transition
                hover:border-primary/40 hover:bg-muted/50
              "
            >
              <Magnet strength={0.3} max={6}><span className="text-2xl">🤖</span></Magnet>
              <span className="text-sm font-semibold">应用宝服务</span>
              <span className="text-xs text-muted-foreground">微信协议托管</span>
            </Link>
          </TiltCard>
          <TiltCard maxTilt={8} className="rounded-lg">
            <Link
              href="/dashboard/market"
              className="
                flex h-full flex-col items-center justify-center gap-2
                rounded-lg border bg-card p-4 text-center transition
                hover:border-primary/40 hover:bg-muted/50
              "
            >
              <Magnet strength={0.3} max={6}><span className="text-2xl">🚀</span></Magnet>
              <span className="text-sm font-semibold">项目市场</span>
              <span className="text-xs text-muted-foreground">自定义脚本上车</span>
            </Link>
          </TiltCard>
          <TiltCard maxTilt={8} className="rounded-lg">
            <Link
              href="/dashboard/profile"
              className="
                flex h-full flex-col items-center justify-center gap-2
                rounded-lg border bg-card p-4 text-center transition
                hover:border-primary/40 hover:bg-muted/50
              "
            >
              <Magnet strength={0.3} max={6}><span className="text-2xl">💳</span></Magnet>
              <span className="text-sm font-semibold">会员中心</span>
              <span className="text-xs text-muted-foreground">卡密充值兑换</span>
            </Link>
          </TiltCard>
          <TiltCard maxTilt={8} className="rounded-lg">
            <Link
              href="/dashboard/checkin"
              className="
                flex h-full flex-col items-center justify-center gap-2
                rounded-lg border bg-card p-4 text-center transition
                hover:border-primary/40 hover:bg-muted/50
              "
            >
              <Magnet strength={0.3} max={6}><span className="text-2xl">📅</span></Magnet>
              <span className="text-sm font-semibold">每日签到</span>
              <span className="text-xs text-muted-foreground">打卡领积分</span>
            </Link>
          </TiltCard>
          <TiltCard maxTilt={8} className="rounded-lg">
            <Link
              href="/dashboard/notifications"
              className="
                flex h-full flex-col items-center justify-center gap-2
                rounded-lg border bg-card p-4 text-center transition
                hover:border-primary/40 hover:bg-muted/50
              "
            >
              <Magnet strength={0.3} max={6}><span className="text-2xl">🔔</span></Magnet>
              <span className="text-sm font-semibold">消息推送</span>
              <span className="text-xs text-muted-foreground">Webhook配置</span>
            </Link>
          </TiltCard>
        </div>
      </Card>

      {/* 左右分栏：我的账号 + 近期动态 */}
      <FadeContent delay={100}>
        <div className="
          grid gap-6
          lg:grid-cols-2
        "
        >
          {/* 我的小蚕账号 */}
          <Card
            title="我的小蚕账号"
            description={`共托管 ${accounts.length} 个账号`}
            actions={(
              <Link
                href="/dashboard/accounts"
                className="
                  text-xs font-semibold text-primary
                  hover:underline
                "
              >
                管理全部账号 →
              </Link>
            )}
          >
            {accounts.length > 0
              ? (
                  <div className="flex flex-col divide-y">
                    {accounts.slice(0, 5).map(acc => (
                      <div
                        key={acc.id}
                        className="
                          flex items-center justify-between py-3 text-sm
                        "
                      >
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{acc.nickname || `账号 #${acc.id}`}</span>
                            {acc.vip_level > 0 && (
                              <Badge
                                variant="secondary"
                                className="px-1.5 py-0 text-[10px]"
                              >
                                SVIP
                                {acc.vip_level}
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {acc.membership_expire ? `到期: ${acc.membership_expire.slice(0, 10)}` : '未开通会员权益'}
                          </span>
                        </div>
                        <Tag tone={acc.status === 'enabled' ? 'success' : 'danger'}>
                          {acc.status === 'enabled' ? '正常运行' : '已暂停'}
                        </Tag>
                      </div>
                    ))}
                  </div>
                )
              : (
                  <div className="
                    flex flex-col items-center justify-center py-8 text-center
                  "
                  >
                    <span className="mb-2 text-3xl">📋</span>
                    <p className="mb-3 text-sm text-muted-foreground">您还没有添加任何托管账号</p>
                    <Link
                      href="/dashboard/accounts"
                      className="
                        rounded-md bg-brand-gradient px-3.5 py-1.5 text-xs
                        font-medium text-white shadow-sm
                      "
                    >
                      前往添加小蚕账号
                    </Link>
                  </div>
                )}
          </Card>

          {/* 近期积分变动流水 */}
          <Card
            title="近期积分明细"
            description="展示个人最近的积分获取与消费流水"
            actions={(
              <Link
                href="/dashboard/profile"
                className="
                  text-xs font-semibold text-primary
                  hover:underline
                "
              >
                查看完整明细 →
              </Link>
            )}
          >
            {transactions.length > 0
              ? (
                  <div className="overflow-x-auto">
                    <Table head={['类型', '变动', '说明', '时间']}>
                      {transactions.slice(0, 5).map(t => (
                        <tr key={t.id}>
                          <Td>
                            <Tag tone={t.amount > 0 ? 'success' : 'warning'}>
                              {t.type_text || t.type}
                            </Tag>
                          </Td>
                          <Td className={`
                            font-semibold tabular-nums
                            ${t.amount > 0
                          ? `text-emerald-600`
                          : `text-amber-600`}
                          `}
                          >
                            {t.amount > 0 ? `+${t.amount}` : t.amount}
                          </Td>
                          <Td className="
                            max-w-[140px] truncate text-muted-foreground
                          "
                          >
                            {t.note || '—'}
                          </Td>
                          <Td className="
                            text-xs text-muted-foreground tabular-nums
                          "
                          >
                            {fmtTime(t.created_time)}
                          </Td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                )
              : (
                  <Empty text="暂无积分明细记录" />
                )}
          </Card>
        </div>
      </FadeContent>

      {/* 平台公告：只展示用户端当前可见的那一条（与管理端「用户端展示中」同源） */}
      {announcement && (
        <Card title="最新系统公告" description="了解平台最新功能更新与维护通知">
          <div className="rounded-lg border bg-card/60 p-4">
            <div className="
              mb-2 flex flex-wrap items-center justify-between gap-2
            "
            >
              <div className="flex items-center gap-2 font-semibold">
                <span aria-hidden>📢</span>
                {announcement.title}
              </div>
              <Tag tone="info">
                v
                {announcement.version}
              </Tag>
            </div>
            <p className="
              text-sm/relaxed wrap-break-word whitespace-pre-line
              text-muted-foreground
            "
            >
              {announcementText(announcement.content)}
            </p>
            <div className="
              mt-3 font-mono text-xs text-muted-foreground tabular-nums
            "
            >
              发布于
              {' '}
              {fmtTime(announcement.published_time)}
              {announcement.updated_time && announcement.updated_time !== announcement.published_time
                ? ` · 更新于 ${fmtTime(announcement.updated_time)}`
                : ''}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
