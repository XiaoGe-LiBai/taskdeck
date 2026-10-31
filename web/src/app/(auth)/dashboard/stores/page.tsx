import type { PanelAccount } from '@/types/Panel';
import { StoresExplorer } from '@/features/panel/StoresExplorer';
import { PageTitle } from '@/features/panel/Ui';
import { panelGet } from '@/libs/PanelApi';

/**
 * 附近霸王餐：只读查询，不消耗积分、不改账号状态。
 *
 * 定位参数由页面传入，不落库也不进 URL —— 换个城市只是换一次查询，
 * 不涉及账号本身的城市归属。
 */
export default async function StoresPage() {
  const accounts = (await panelGet<PanelAccount[]>('/xiaocan/accounts')) ?? [];

  return (
    <>
      <PageTitle
        title="附近霸王餐"
        description="按定位查附近外卖霸王餐、搜指定店铺、看到店团购；数据实时来自小蚕平台"
      />
      <StoresExplorer
        accounts={accounts.map(account => ({
          id: account.id,
          nickname: account.nickname,
          account_info: account.account_info,
        }))}
      />
    </>
  );
}

export const dynamic = 'force-dynamic';
