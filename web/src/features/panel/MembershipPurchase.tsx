'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { purchaseProductAction } from './actions';
import { Card, Empty, Tag } from './Ui';

export type PurchaseProduct = {
  id: number;
  name: string;
  product_type: 'membership' | 'slot';
  grant_value: number;
  /** 标价（分） */
  list_price: number;
  /** 按会员等级打折后的实付（分） */
  pay_price: number;
  discounted: boolean;
};

export type PurchaseAccount = {
  id: number;
  nickname?: string;
  account_info?: string;
  membership_expire?: string | null;
};

const fmtPoints = (n: number) => n.toLocaleString();

/**
 * 会员套餐购买（会员中心用）。
 *
 * 会员期商品必须选一个账号——买到的是**那个账号**的会员期；
 * 同时后端会按天数提升**用户等级**（取较大者，不降级）。
 * 价格由后端按等级算好（pay_price），这里只展示，避免两边各算一套。
 */
export const MembershipPurchase = (props: {
  products: PurchaseProduct[];
  accounts: PurchaseAccount[];
  balance: number;
  levelName: string;
  vipExpire: string | null;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState<number | null>(props.accounts[0]?.id ?? null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const membership = props.products.filter(p => p.product_type === 'membership');
  const slots = props.products.filter(p => p.product_type === 'slot');
  const noAccount = props.accounts.length === 0;
  /** 只有一个账号时不用下拉（选择器没有意义，直接显示名字） */
  const singleAccount = props.accounts.length === 1 ? (props.accounts[0] ?? null) : null;

  const buy = (product: PurchaseProduct) => {
    if (pending) {
      return;
    }
    if (product.product_type === 'membership' && !accountId) {
      setMsg({ ok: false, text: '请先选择要开通的账号（会员期是按账号计时的）' });
      return;
    }
    startTransition(async () => {
      const res = await purchaseProductAction(
        product.id,
        product.product_type === 'membership' ? (accountId ?? undefined) : undefined,
      );
      setMsg({ ok: res.ok, text: res.msg });
      if (res.ok) {
        router.refresh();
      }
    });
  };

  const row = 'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-xs';

  return (
    <Card
      title="会员套餐"
      description="购买后：账号获得会员期（决定该号能不能跑任务），同时你的会员等级按套餐提升（决定车位、折扣与加成）"
      actions={(
        <span className="flex items-center gap-2">
          <Tag tone="warning">{props.levelName}</Tag>
          {props.vipExpire
            ? (
                <span className="text-[10px] text-muted-foreground">
                  到期
                  {props.vipExpire.slice(0, 10)}
                </span>
              )
            : <span className="text-[10px] text-muted-foreground">永久</span>}
        </span>
      )}
    >
      <div className="flex flex-col gap-3">
        {/* 作用账号。
            这里刻意**不重复显示账号名与可用余额** —— 上面「登录账号」「可用余额」两张统计卡
            已经显示过一遍了。也只在**多账号**时才给下拉：只有一个号时选择器没有意义。 */}
        {membership.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">会员期作用到：</span>
            {noAccount
              ? <span className="text-rose-600">还没有绑定小蚕账号，请先到「小蚕」页扫码绑定</span>
              : singleAccount
                ? (
                    <span className="font-medium text-foreground">
                      {singleAccount.nickname || singleAccount.account_info || `账号 #${singleAccount.id}`}
                      <span className="ml-1 font-normal text-muted-foreground">
                        {singleAccount.membership_expire
                          ? `（会员期至 ${singleAccount.membership_expire.slice(0, 10)}）`
                          : '（尚未开通会员期）'}
                      </span>
                    </span>
                  )
                : (
                    <select
                      value={accountId ?? ''}
                      onChange={e => setAccountId(Number(e.target.value) || null)}
                      className="
                        h-8 rounded-md border border-input bg-background px-2
                        text-xs
                      "
                    >
                      {props.accounts.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.nickname || a.account_info || `账号 #${a.id}`}
                          {a.membership_expire ? `（到期 ${a.membership_expire.slice(0, 10)}）` : '（未开通）'}
                        </option>
                      ))}
                    </select>
                  )}
          </div>
        )}

        {/* 反馈 */}
        {msg && (
          <div className={`
            rounded-md border px-3 py-2 text-xs
            ${msg.ok
            ? `
              border-emerald-500/20 bg-emerald-500/10 text-emerald-700
              dark:text-emerald-300
            `
            : `
              border-rose-500/20 bg-rose-500/10 text-rose-700
              dark:text-rose-300
            `}
          `}
          >
            {msg.text}
          </div>
        )}

        {/* 会员套餐 */}
        <div className="flex flex-col gap-2">
          {membership.length === 0
            ? <Empty text="暂无可购买的会员套餐" />
            : membership.map(p => (
                <div key={p.id} className={row}>
                  <div className="flex min-w-0 flex-col">
                    <span className="font-medium text-foreground">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {p.grant_value >= 3650 ? '永久有效' : `${p.grant_value} 天会员期`}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-right">
                      {p.discounted
                        ? (
                            <>
                              <s className="text-muted-foreground">{fmtPoints(p.list_price)}</s>
                              <span className="
                                ml-1.5 font-semibold text-emerald-600
                              "
                              >
                                {fmtPoints(p.pay_price)}
                              </span>
                            </>
                          )
                        : <span className="font-semibold text-foreground">{fmtPoints(p.pay_price)}</span>}
                      <span className="ml-1 text-muted-foreground">分</span>
                    </span>
                    <button
                      type="button"
                      disabled={pending || noAccount || props.balance < p.pay_price}
                      onClick={() => buy(p)}
                      className="
                        rounded-md bg-brand-gradient px-3 py-1.5 text-xs
                        font-medium text-white shadow-xs
                        hover:opacity-95
                        disabled:opacity-40
                      "
                    >
                      {props.balance < p.pay_price ? '积分不足' : '购买'}
                    </button>
                  </div>
                </div>
              ))}
        </div>

        {/* 车位 */}
        {slots.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <span className="text-[11px] font-medium text-muted-foreground">车位（容量，不打折）</span>
            {slots.map(p => (
              <div key={p.id} className={row}>
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium text-foreground">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground">
                    +
                    {p.grant_value}
                    {' '}
                    个绑定名额
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-semibold text-foreground">
                    {fmtPoints(p.pay_price)}
                    <span className="ml-1 font-normal text-muted-foreground">分</span>
                  </span>
                  <button
                    type="button"
                    disabled={pending || props.balance < p.pay_price}
                    onClick={() => buy(p)}
                    className="
                      rounded-md border border-input bg-background px-3 py-1.5
                      text-xs font-medium
                      hover:bg-muted
                      disabled:opacity-40
                    "
                  >
                    {props.balance < p.pay_price ? '积分不足' : '购买'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};
