import type { PanelAccount } from '@/types/Panel';
import { ProfileCenter } from '@/features/panel/ProfileCenter';
import { PageTitle } from '@/features/panel/Ui';
import { panelGet, panelMe } from '@/libs/PanelApi';

type TransactionsPayload = {
  records: Array<{
    id: number;
    amount: number;
    type: string;
    type_text: string;
    note: string;
    created_time: string;
  }>;
  total: number;
  page: number;
  size: number;
};

type ProductsPayload = {
  balance: number;
  products: Array<{
    id: number;
    name: string;
    product_type: 'membership' | 'slot';
    grant_value: number;
    list_price: number;
    pay_price: number;
    discounted: boolean;
  }>;
  vip_level: number;
  vip_level_name: string;
  vip_expire: string | null;
};

export default async function ProfilePage() {
  const [user, transData, productsData, accounts] = await Promise.all([
    panelMe(),
    panelGet<TransactionsPayload>('/points/transactions?page=1&size=30'),
    panelGet<ProductsPayload>('/points/summary'),
    panelGet<PanelAccount[]>('/xiaocan/accounts'),
  ]);

  return (
    <>
      <PageTitle
        title="会员中心"
        description="管理个人资料与会员等级 · 购买会员套餐 · 兑换充值卡密 · 查询积分变动明细"
      />
      <ProfileCenter
        user={user}
        transactions={transData?.records ?? []}
        totalTransactions={transData?.total ?? 0}
        products={productsData?.products ?? []}
        accounts={(accounts ?? []).map(a => ({
          id: a.id,
          nickname: a.nickname,
          account_info: a.account_info,
          membership_expire: a.membership_expire,
        }))}
        balance={productsData?.balance ?? user?.points_balance ?? 0}
        vipLevel={productsData?.vip_level ?? 0}
        levelName={productsData?.vip_level_name ?? '普通会员'}
        vipExpire={productsData?.vip_expire ?? null}
      />
    </>
  );
}
