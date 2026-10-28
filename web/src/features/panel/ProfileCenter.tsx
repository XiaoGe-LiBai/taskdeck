'use client';

import type { PurchaseAccount, PurchaseProduct } from './MembershipPurchase';
import type { PanelUser } from '@/libs/PanelApi';
import { useActionState, useState } from 'react';
import { AnimatedList } from '@/components/reactbits';
import { redeemPointsCardAction } from './actions';
import { ChangeEmailCard } from './ChangeEmailCard';
import { MembershipPurchase } from './MembershipPurchase';
import { Card, StatCard, Tag } from './Ui';

type Transaction = {
  id: number;
  amount: number;
  type: string;
  type_text: string;
  note: string;
  created_time: string;
};

export const ProfileCenter = (props: {
  user: PanelUser | null;
  transactions: Transaction[];
  totalTransactions: number;
  products: PurchaseProduct[];
  accounts: PurchaseAccount[];
  balance: number;
  /** 会员等级数字（0 = 普通会员）——只用来判断"是不是普通会员"，展示一律用 levelName */
  vipLevel: number;
  levelName: string;
  vipExpire: string | null;
}) => {
  const [state, formAction, isPending] = useActionState(redeemPointsCardAction, '');
  const [code, setCode] = useState('');
  const user = props.user;

  const isOk = state.startsWith('ok:');
  const msg = state.replace(/^(ok|error):/, '');

  return (
    <div className="flex section-enter flex-col gap-6">
      {/* 用户基本资料与资产 */}
      <AnimatedList
        stagger={55}
        className="
          grid gap-4
          sm:grid-cols-2
          lg:grid-cols-4
        "
      >
        <StatCard
          label="登录账号"
          value={user?.nickname || '我的账号'}
          hint={`${user?.email ?? ''} · UID ${user?.id ?? 0}`}
          icon="👤"
          plain
        />
        {/* 这里以前显示的是 user.role（权限角色），所以至尊会员会看到「普通会员」。
            改成真实的会员等级 + 到期时间。等级名只显示名称，不拼 VIP 编号。 */}
        <StatCard
          label="会员等级"
          value={props.levelName}
          hint={props.vipExpire ? `到期 ${props.vipExpire.slice(0, 10)}` : '永久有效'}
          icon="👑"
          plain={props.vipLevel === 0}
        />
        <StatCard
          label="可用余额"
          value={props.balance}
          hint="单位：分 · 可用于上车与任务扣费"
          icon="🪙"
        />
        <StatCard
          label="累计消费（分）"
          value={user?.points_spent ?? 0}
          hint={`邀请码: ${user?.invite_code || '无'}`}
          icon="📊"
          plain
        />
      </AnimatedList>

      {/* 会员套餐购买：会员期 + 等级一起到手 */}
      <MembershipPurchase
        products={props.products}
        accounts={props.accounts}
        balance={props.balance}
        levelName={props.levelName}
        vipExpire={props.vipExpire}
      />

      {/* 卡密充值兑换 */}
      <Card
        title="卡密充值 / 积分兑换"
        description="持有兑换卡密？在下方输入卡密代码即可瞬间增加积分余额。"
      >
        <form
          action={formAction}
          className="
            flex flex-col gap-3
            sm:flex-row
          "
        >
          <input
            type="text"
            name="code"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="请输入卡密兑换代码，例如：CARD-XXXX-XXXX"
            className="
              flex-1 rounded-md border bg-background px-3 py-2 text-sm
              focus:ring-2 focus:ring-primary/20 focus:outline-none
            "
            required
          />
          <button
            type="submit"
            disabled={isPending}
            className="
              rounded-md bg-brand-gradient px-5 py-2 text-sm font-semibold
              text-white shadow-sm
              hover:opacity-90
              disabled:opacity-50
            "
          >
            {isPending ? '正在兑换…' : '立即充值兑换'}
          </button>
        </form>

        {state && (
          <div
            className={`
              mt-3 rounded-md border p-3 text-sm
              ${
          isOk
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
            : 'border-red-500/20 bg-red-500/10 text-red-600'
          }
            `}
          >
            {msg}
          </div>
        )}
      </Card>

      {/* 换绑邮箱 */}
      {user && <ChangeEmailCard currentEmail={user.email} />}

      {/* 积分流水记录 */}
      <Card
        title="积分变动明细"
        description={`展示最近的积分获取与消费流水记录（共 ${props.totalTransactions} 条）`}
      >
        {props.transactions.length === 0
          ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                暂无积分流水变动记录
              </div>
            )
          : (
              <div className="overflow-x-auto">
                <table className="row-stagger w-full text-left text-sm">
                  <thead className="
                    border-b bg-muted/30 text-xs text-muted-foreground uppercase
                  "
                  >
                    <tr>
                      <th className="px-4 py-3">变动类型</th>
                      <th className="px-4 py-3">积分变动</th>
                      <th className="px-4 py-3">说明备注</th>
                      <th className="px-4 py-3">时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {props.transactions.map(t => (
                      <tr
                        key={t.id}
                        className="
                          transition-colors
                          hover:bg-muted/30
                        "
                      >
                        <td className="px-4 py-3 font-medium">
                          <Tag tone={t.amount > 0 ? 'success' : 'warning'}>{t.type_text}</Tag>
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold">
                          <span className={t.amount > 0
                            ? 'text-emerald-600'
                            : `text-amber-600`}
                          >
                            {t.amount > 0 ? `+${t.amount}` : t.amount}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{t.note}</td>
                        <td className="
                          px-4 py-3 font-mono text-xs text-muted-foreground
                        "
                        >
                          {t.created_time ? t.created_time.replace('T', ' ').slice(0, 19) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </Card>
    </div>
  );
};
