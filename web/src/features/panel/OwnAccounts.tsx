import type { PanelAccount } from '@/types/Panel';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { deleteAccountAction, refreshOwnAccountLevelAction, signupAccountAction, toggleOwnFeatureAction } from '@/features/panel/actions';
import { ActionForm, Collapsible } from '@/features/panel/Client';
import { StateForm } from '@/features/panel/ExpireEditor';
import { Card, Empty, fmtTime, Table, Tag, Td } from '@/features/panel/Ui';

/**
 * 普通用户视角的「我的小蚕账号」。
 *
 * 只展示当前用户自己的账号（GET /xiaocan/accounts），所有操作走用户级接口，
 * 后端按 user_id 校验归属；管理员那套 /admin/accounts 表格仅管理员可见。
 * 任务开关清单直接取后端返回的 features 键（与 coupon_types 预置项一致），避免前后端两份硬编码。
 */
export const OwnAccounts = (props: { accounts: PanelAccount[] }) => {
  const bindEntry = (
    <Link
      href="/dashboard/xiaocan"
      className="
        rounded-md border bg-card px-3 py-2 text-sm font-medium transition-all
        duration-150
        hover:bg-muted
        active:scale-95
      "
    >
      ＋ 绑定小蚕账号
    </Link>
  );

  if (!props.accounts.length) {
    return (
      <Card
        title="我的小蚕账号"
        description="微信扫码登录绑定后，在这里管理任务开关与大牌券报名"
        actions={bindEntry}
      >
        <Empty text="还没有绑定小蚕账号" />
      </Card>
    );
  }

  return (
    <Card
      title={`我的小蚕账号（${props.accounts.length}）`}
      description="任务开关、大牌券报名、删除账号都在这里；到期时间由管理员统一维护"
      actions={bindEntry}
    >
      <Table head={['账号', 'SVIP', '状态 / 到期', '任务开关', '操作']}>
        {props.accounts.map((row) => {
          const features = Object.keys(row.features ?? {});
          const enabledCount = features.filter(name => row.features[name]).length;

          return (
            <tr key={row.id}>
              <Td>
                <div className="font-medium">{row.nickname || '未命名'}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {row.account_info || '—'}
                </div>
                {row.remark && (
                  <div className="text-xs text-muted-foreground">{row.remark}</div>
                )}
              </Td>
              <Td>
                {row.vip_level
                  ? <Tag tone="warning">{`SVIP${row.vip_level}`}</Tag>
                  : <Tag tone="gray">待刷新</Tag>}
              </Td>
              <Td>
                <Tag tone={row.status === 'enabled' ? 'success' : 'gray'}>
                  {row.status === 'enabled' ? '运行中' : '已暂停'}
                </Tag>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {fmtTime(row.membership_expire)}
                </div>
              </Td>
              <Td>
                <Collapsible label={`任务开关 ${enabledCount} / ${features.length}`}>
                  <div className="grid grid-cols-2 gap-1.5">
                    {features.map(name => (
                      <ActionForm
                        key={name}
                        action={toggleOwnFeatureAction}
                        fields={{ account_id: row.id, feature: name }}
                        className="justify-between"
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`
                              inline-block size-2 rounded-full
                              ${row.features[name]
                        ? `bg-emerald-500`
                        : `bg-muted-foreground/40`}
                            `}
                          />
                          {name}
                        </span>
                      </ActionForm>
                    ))}
                  </div>
                </Collapsible>
              </Td>
              <Td>
                <div className="flex flex-wrap items-start gap-2">
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

                  {/* 等级是账号在**小蚕平台上**的真实等级，只能去平台查一次 */}
                  <ActionForm
                    action={refreshOwnAccountLevelAction}
                    fields={{ account_id: row.id }}
                    title="向小蚕平台查一次该账号的真实 SVIP 等级"
                  >
                    刷新等级
                  </ActionForm>

                  <ActionForm
                    action={deleteAccountAction}
                    fields={{ account_id: row.id }}
                    confirm={`确认删除「${row.nickname || row.account_info}」？删除后任务开关与抢兑设置一并清除。`}
                    className="
                      [&_button]:border-destructive/40
                      [&_button]:text-destructive
                    "
                  >
                    删除
                  </ActionForm>
                </div>
              </Td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
};
