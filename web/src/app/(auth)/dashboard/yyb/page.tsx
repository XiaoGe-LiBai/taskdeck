import type { YybProxyProfile } from '@/features/panel/yybActions';
import type { YybAccount, YybMyActivitiesPayload, YybStatus } from '@/types/Panel';
import Link from 'next/link';
import { AnimatedList } from '@/components/reactbits';
import { Countdown } from '@/features/panel/Countdown';
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
import { YybAccountRowActions } from '@/features/panel/YybAccountRowActions';
import { YybScanPanel } from '@/features/panel/YybScanPanel';
import { panelGet, panelMe } from '@/libs/PanelApi';

export default async function YybPage() {
  const [user, status, accounts, endpoints, myActivities, proxyProfiles] = await Promise.all([
    panelMe(),
    panelGet<YybStatus>('/yyb/status'),
    panelGet<YybAccount[]>('/yyb/accounts'),
    panelGet<{ id: number; base_url?: string; name: string }[]>('/yyb/endpoints'),
    panelGet<YybMyActivitiesPayload>('/yyb/my-activities'),
    panelGet<YybProxyProfile[]>('/yyb/proxy-profiles'),
  ]);

  const isAdmin = user?.role === 'admin';
  const alive = (accounts ?? []).filter(a => a.status === 'alive').length;
  const needRescan = (accounts ?? []).filter(a => a.rescan_recommended).length;
  const consoleUrl = isAdmin ? (endpoints?.[0]?.base_url ?? '') : '';
  const activityCount = myActivities?.activities?.length;

  return (
    <>
      <PageTitle
        title="应用宝 · 微信账号"
        description="应用宝协议服务：账号存活、凭据续期、保活刷新与取码测试"
        actions={(
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/yyb/activities"
              title="选择名下各个微信号参与哪些小程序活动"
              className="
                inline-flex items-center gap-1.5 rounded-md bg-brand-gradient
                px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs
                transition
                hover:opacity-95
              "
            >
              <span>⚡ 小程序活动管理</span>
              {typeof activityCount === 'number' && activityCount > 0 && (
                <span className="
                  rounded-full bg-white/25 px-1.5 py-0.5 text-[10px]
                  leading-none font-bold tabular-nums
                "
                >
                  {activityCount}
                </span>
              )}
            </Link>
            {isAdmin && (
              <>
                <Link
                  href="/dashboard/yyb/bindings"
                  className="
                    rounded-md border border-input bg-background px-3 py-1.5
                    text-xs font-medium
                    hover:bg-muted
                  "
                >
                  青龙绑定矩阵
                </Link>
                <Link
                  href="/dashboard/yyb/settings"
                  className="
                    rounded-md border border-input bg-background px-3 py-1.5
                    text-xs font-medium
                    hover:bg-muted
                  "
                >
                  服务设置
                </Link>
              </>
            )}
          </div>
        )}
      />

      <AnimatedList
        stagger={55}
        className="
          grid grid-cols-2 gap-4
          lg:grid-cols-4
        "
      >
        <StatCard
          label="协议服务"
          value={status?.online ? '在线' : '离线'}
          hint={status?.version?.version ? `v${status.version.version}` : '—'}
          icon="📡"
          plain
        />
        <StatCard label="微信账号" value={accounts?.length ?? 0} hint={`存活 ${alive} 个`} icon="👥" />
        <StatCard
          label="托管连接"
          value={status?.qinglong?.connected ? '已连接' : '未连接'}
          hint={status?.qinglong?.configured ? '已接入' : '未接入'}
          icon="🐉"
          plain
        />
        <StatCard
          label="建议重扫码"
          value={needRescan}
          hint="登录态异常，建议重扫"
          icon="⚠️"
          plain
        />
      </AnimatedList>

      <div className="mt-6">
        <Card
          title={`账号列表 · ${accounts?.length ?? 0} 个`}
          description="保活刷新会立即探测协议存活；取码测试会真实向应用宝换取一次 wx.login code"
          actions={(
            <span className="text-xs text-muted-foreground">
              上次检测：
              {fmtTime(status?.last_check)}
            </span>
          )}
        >
          {accounts?.length
            ? (
                <Table
                  head={
                    isAdmin
                      ? ['ID', '账号', '协议状态', '归属用户', '凭据剩余', 'OpenID', 'UIN', '操作']
                      : ['ID', '账号', '协议状态', '凭据剩余', 'OpenID', 'UIN', '操作']
                  }
                >
                  {accounts.map(account => (
                    <tr key={account.id}>
                      <Td className="tabular-nums">{account.id}</Td>
                      <Td>
                        <div className="font-medium text-foreground">
                          {account.remark || account.nickname || account.alias || `账号 #${account.id}`}
                        </div>
                        {account.remark && account.nickname && account.nickname.trim() !== account.remark.trim() && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            微信：
                            {account.nickname}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <Tag
                          tone={
                            account.status === 'alive'
                              ? 'success'
                              : account.status === 'expired'
                                ? 'danger'
                                : 'warning'
                          }
                        >
                          {account.status === 'alive' ? '存活' : account.status === 'expired' ? '已失效' : '未探测'}
                        </Tag>
                      </Td>
                      {isAdmin && (
                        <Td className="text-xs">
                          {account.user_id
                            ? (
                                <div>
                                  <span className="font-medium text-foreground">
                                    {account.owner_nickname || account.owner_email || '已绑定'}
                                  </span>
                                  <span className="ml-1 text-muted-foreground">{`#${account.user_id}`}</span>
                                </div>
                              )
                            : (
                                <span className="text-muted-foreground">未分配</span>
                              )}
                        </Td>
                      )}
                      <Td className="text-xs">
                        <Countdown seconds={account.credential_expires_in} />
                      </Td>
                      <Td className="font-mono text-xs">{account.openid_masked}</Td>
                      <Td className="font-mono text-xs tabular-nums">{account.uin}</Td>
                      <Td>
                        <YybAccountRowActions account={account} />
                      </Td>
                    </tr>
                  ))}
                </Table>
              )
            : (
                <Empty text={isAdmin ? '读不到账号：先确认 YYB 服务在线并已扫码添加过微信号' : '暂未绑定微信账号：请使用下方二维码扫码授权添加'} />
              )}
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="扫码加号 / 账号管理"
          description={isAdmin ? '面板内直接生成二维码添加微信号；登录代理支持直连 / 静态 / 动态 API / 供应商配置，随二维码下发' : '请使用手机微信扫描下方二维码授权登录，登录成功后账号将自动绑定到您的面板'}
        >
          <YybScanPanel
            endpointId={endpoints?.[0]?.id}
            isAdmin={isAdmin}
            consoleUrl={consoleUrl}
            initialProfiles={proxyProfiles ?? []}
          />

          <div className="
            mt-4 flex flex-wrap items-center gap-3 border-t pt-4 text-sm
          "
          >
            {isAdmin
              ? (
                  consoleUrl
                    ? (
                        <>
                          <a
                            href={`${consoleUrl}/add-account`}
                            target="_blank"
                            rel="noreferrer"
                            className="
                              rounded-md border px-4 py-2
                              hover:bg-muted
                            "
                          >
                            YYB 原生扫码页
                          </a>
                          <a
                            href={consoleUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="
                              rounded-md border px-4 py-2
                              hover:bg-muted
                            "
                          >
                            打开 YYB 控制台
                          </a>
                        </>
                      )
                    : (
                        <span className="text-muted-foreground">尚未配置 YYB 服务地址，请先到「服务设置」填写</span>
                      )
                )
              : null}
            <span className="text-xs text-muted-foreground">
              {status?.online ? '协议服务已连通' : '协议服务未连通'}
            </span>
          </div>
        </Card>
      </div>
    </>
  );
}

export const dynamic = 'force-dynamic';
