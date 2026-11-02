import type { PanelAccount } from '@/types/Panel';
import Link from 'next/link';
import { Card, PageTitle } from '@/features/panel/Ui';
import { WechatDirectPanel } from '@/features/panel/WechatDirectPanel';
import { XiaocanAutomation } from '@/features/panel/XiaocanAutomation';
import { XiaocanBindPanel } from '@/features/panel/XiaocanBindPanel';
import { XiaocanConsole } from '@/features/panel/XiaocanConsole';
import { XiaocanSniping } from '@/features/panel/XiaocanSniping';
import { panelGet, panelMe } from '@/libs/PanelApi';

/**
 * 小蚕工作台。
 *
 * 顺序按「每天真正会做的事」排：先看/改自动化任务，再看资产与福利，
 * 最后才是账号绑定这类一次性操作。原来把绑定放最上面、再跟一张写死的任务表，
 * 既占首屏又和真实开关对不上，已经去掉。
 */
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
        title="小蚕"
        description="霸王餐抢单与预约、每日任务与元宝资产都在这一页；任务按账号独立开关，改动即时生效"
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

      <div className="flex flex-col gap-6">
        {/* 霸王餐在最前：每天第一件事是看附近有什么可抢的，再看任务开关 */}
        <XiaocanSniping accounts={safeAccounts} />

        <XiaocanAutomation accounts={safeAccounts} />

        <XiaocanConsole accounts={safeAccounts} />

        <Card
          title="绑定小蚕账号"
          description="微信扫码，或在 Windows 上直连电脑微信提取，二选一"
        >
          <XiaocanBindPanel />
          <WechatDirectPanel />
        </Card>
      </div>
    </>
  );
}
