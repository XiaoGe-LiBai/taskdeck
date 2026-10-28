import type { PanelAccount, PanelAccountRow, PanelList } from '@/types/Panel';
import { AnimatedList } from '@/components/reactbits';
import { Input, Select } from '@/components/ui/input';
import {
  batchExpireAction,
  deleteAccountAction,
  refreshAccountLevelAction,
  refreshAccountLevelsAction,
  signupAccountAction,
  toggleAccountFeatureAction,
  toggleAccountStatusAction,
} from '@/features/panel/actions';
import { ActionForm, Collapsible, FeedbackButton } from '@/features/panel/Client';
import { ExpireEditor, StateForm } from '@/features/panel/ExpireEditor';
import { OwnAccounts } from '@/features/panel/OwnAccounts';
import {
  Card,
  CountValue,
  Empty,
  fmtTime,
  Pager,
  PageTitle,
  StatCard,
  Table,
  Tag,
  Td,
} from '@/features/panel/Ui';
import { panelGet, panelMe } from '@/libs/PanelApi';

const FEATURES = [
  '限量大牌券-代理版',
  '保底大牌券',
  '会员专属返利券',
  '每日签到',
  '元宝一键领取',
  '元宝抽奖',
  '影音周卡',
  '红包雨',
  '免单券',
  '双节抽礼',
];

export default async function AccountsPage(props: {
  searchParams: Promise<{ page?: string; q?: string; vip?: string }>;
}) {
  const user = await panelMe();

  // 普通用户走用户级接口：/admin/accounts 需要管理权限（否则 403 空白页）
  if (user?.role !== 'admin') {
    const accounts = (await panelGet<PanelAccount[]>('/xiaocan/accounts')) ?? [];

    return (
      <>
        <PageTitle
          title="账号订单"
          description="我的小蚕账号：任务开关、大牌券报名与删除，绑定入口在「小蚕」页"
        />
        <OwnAccounts accounts={accounts} />
      </>
    );
  }

  const query = await props.searchParams;

  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const params = new URLSearchParams({ page: String(page), size: '10' });
  if (query.q) {
    params.set('q', query.q);
  }
  if (query.vip === '1') {
    params.set('vip', '1');
  }

  const data = await panelGet<PanelList<PanelAccountRow>>(`/admin/accounts?${params.toString()}`);
  const rows = data?.records ?? [];
  const total = data?.total ?? 0;
  const enabledCount = rows.filter(r => r.status === 'enabled').length;
  const vipCount = rows.filter(r => (r.vip_level ?? 0) > 0).length;

  return (
    <>
      <PageTitle
        title="账号订单"
        description="暂停 / 恢复、设置到期、任务开关、大牌券报名，全部在这里直接操作"
      />

      <AnimatedList
        stagger={60}
        className="
          mb-6 grid gap-4
          sm:grid-cols-3
        "
      >
        <StatCard
          label="托管账号总计"
          value={<CountValue value={total} suffix="个" />}
          hint="平台全量小蚕账号"
          icon="👥"
        />
        <StatCard
          label="正常托管中"
          value={<CountValue value={enabledCount} suffix="个" />}
          hint="状态为启用并接收调度"
          icon="⚡"
        />
        <StatCard
          label="SVIP 特权账号"
          value={<CountValue value={vipCount} suffix="个" />}
          hint="享有限量与专属大牌券"
          icon="👑"
        />
      </AnimatedList>

      <Card
        title={`共 ${data?.total ?? 0} 个账号`}
        actions={(
          <form className="flex gap-2" action="/dashboard/accounts">
            {query.vip === '1' && <input type="hidden" name="vip" value="1" />}
            <Input
              name="q"
              defaultValue={query.q ?? ''}
              placeholder="搜索用户 / 邮箱 / 昵称 / 小蚕 ID"
              className="h-9 w-64"
            />
            <button
              type="submit"
              className="
                rounded-md border px-3 text-sm transition-all duration-150
                hover:bg-muted
                active:scale-95
              "
            >
              搜索
            </button>
          </form>
        )}
      >
        {/* 批量操作表单：表格里的 checkbox 用 form="batch-expire" 关联进来 */}
        <form
          id="batch-expire"
          className="
            mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40
            px-3 py-2
          "
        >
          <span className="text-xs text-muted-foreground">勾选左侧账号后批量延长到期时间</span>
          <Select name="days" defaultValue="7" className="h-8 w-28 text-xs">
            <option value="1">+1 天</option>
            <option value="3">+3 天</option>
            <option value="7">+7 天</option>
            <option value="15">+15 天</option>
            <option value="30">+30 天</option>
          </Select>
          <FeedbackButton
            formAction={batchExpireAction}
            confirm="确认把勾选账号的抢券到期时间统一延后？"
          >
            批量延长
          </FeedbackButton>

          <span className="h-4 w-px bg-border" />

          {/* 账号等级是**小蚕平台上**的真实属性，只能去平台查；不勾选就是刷新全部 */}
          <FeedbackButton
            formAction={refreshAccountLevelsAction}
            title="向小蚕平台逐个查询账号的真实 SVIP 等级（未勾选 = 全部）"
            confirm="将逐个向小蚕平台查询等级（每个账号一次请求，稍慢），确认继续？"
          >
            刷新等级
          </FeedbackButton>
        </form>

        {data?.records?.length
          ? (
              <>
                <Table head={['选择', 'ID', '用户', '昵称 / 小蚕账号', 'SVIP', '运行面板', '开关', '状态 / 到期', '操作']}>
                  {data.records.map((row) => {
                    const enabledCount = Object.values(row.features ?? {}).filter(Boolean).length;
                    const nextStatus = row.status === 'enabled' ? 'disabled' : 'enabled';

                    return (
                      <tr key={row.id}>
                        <Td>
                          <input
                            type="checkbox"
                            name="ids"
                            value={row.id}
                            form="batch-expire"
                            className="size-4"
                            aria-label={`选择账号 ${row.id}`}
                          />
                        </Td>
                        <Td className="tabular-nums">{row.id}</Td>
                        <Td>
                          <div>{row.user_nickname || '—'}</div>
                          <div className="text-xs text-muted-foreground">{row.user_email}</div>
                        </Td>
                        <Td>
                          <div className="font-medium">{row.nickname}</div>
                          <div className="
                            font-mono text-xs text-muted-foreground
                          "
                          >
                            {row.account_info}
                          </div>
                        </Td>
                        <Td>
                          {row.vip_level
                            ? <Tag tone="warning">{`SVIP${row.vip_level}`}</Tag>
                            : <Tag tone="gray">待刷新</Tag>}
                        </Td>
                        <Td className="text-xs">
                          <div>{`普通：${row.default_panel_remark || row.default_panel_name || '未分配'}`}</div>
                          <div className="text-muted-foreground">
                            {`限量：${row.brand_panel_remark || row.brand_panel_name || '未分配'}`}
                          </div>
                        </Td>
                        <Td className="tabular-nums">{`${enabledCount} / 10`}</Td>
                        <Td>
                          <Tag tone={row.status === 'enabled' ? 'success' : 'gray'}>
                            {row.status === 'enabled' ? '运行中' : '已暂停'}
                          </Tag>
                          <div className="
                            mt-1 text-xs text-muted-foreground tabular-nums
                          "
                          >
                            {fmtTime(row.membership_expire)}
                          </div>
                        </Td>
                        <Td>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <ActionForm
                              action={toggleAccountStatusAction}
                              fields={{ account_id: row.id, status: nextStatus }}
                              confirm={`确认${nextStatus === 'disabled' ? '暂停' : '启用'}「${row.nickname}」？`}
                            >
                              {nextStatus === 'disabled' ? '暂停' : '启用'}
                            </ActionForm>

                            <ExpireEditor accountId={row.id} current={row.membership_expire} />

                            <ActionForm
                              action={refreshAccountLevelAction}
                              fields={{ account_id: row.id }}
                              title="向小蚕平台查一次该账号的真实 SVIP 等级"
                            >
                              刷新等级
                            </ActionForm>

                            <ActionForm
                              action={deleteAccountAction}
                              fields={{ account_id: row.id }}
                              confirm={`确认删除「${row.nickname}」？删除后该账号的任务开关与抢兑设置一并清除。`}
                              className="
                                [&_button]:border-destructive/40
                                [&_button]:text-destructive
                              "
                            >
                              删除
                            </ActionForm>
                          </div>

                          <div className="mt-2 flex flex-wrap gap-2">
                            <Collapsible label="任务开关">
                              <div className="grid grid-cols-2 gap-1.5">
                                {FEATURES.map(name => (
                                  <ActionForm
                                    key={name}
                                    action={toggleAccountFeatureAction}
                                    fields={{ account_id: row.id, feature: name }}
                                    className="justify-between"
                                  >
                                    <span className="flex items-center gap-1.5">
                                      <span
                                        className={`
                                          inline-block size-2 rounded-full
                                          ${
                                  row.features?.[name]
                                    ? `bg-emerald-500`
                                    : `bg-muted-foreground/40`
                                  }
                                        `}
                                      />
                                      {name}
                                    </span>
                                  </ActionForm>
                                ))}
                              </div>
                            </Collapsible>

                            <Collapsible label="大牌券报名">
                              <StateForm
                                action={signupAccountAction}
                                fields={{ account_id: row.id }}
                                className="flex-col items-stretch gap-2"
                                submitLabel="立即报名"
                              >
                                <Input
                                  name="tea_name"
                                  placeholder="奶茶名称，如 瑞幸"
                                  className="h-9 text-sm"
                                />
                                <Input
                                  name="order_numbers"
                                  placeholder="订单号，多个用 # 分隔"
                                  className="h-9 text-sm"
                                />
                              </StateForm>
                            </Collapsible>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </Table>

                <Pager
                  page={data.page}
                  size={data.size}
                  total={data.total}
                  basePath="/dashboard/accounts"
                  query={{ q: query.q, vip: query.vip }}
                />
              </>
            )
          : (
              <Empty text="没有匹配的账号" />
            )}
      </Card>
    </>
  );
}

export const dynamic = 'force-dynamic';
