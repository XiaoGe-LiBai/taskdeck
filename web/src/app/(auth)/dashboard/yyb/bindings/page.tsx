import type { YybBindingsPayload } from '@/types/Panel';
import { redirect } from 'next/navigation';

import { BindingsMatrix } from '@/features/panel/BindingsMatrix';
import { Card, Empty, PageTitle, Tag } from '@/features/panel/Ui';
import { panelGet, panelMe } from '@/libs/PanelApi';

export default async function YybBindingsPage(props: {
  searchParams: Promise<{ collect?: string }>;
}) {
  const user = await panelMe();
  if (!user || user.role !== 'admin') {
    redirect('/dashboard/yyb');
  }

  const query = await props.searchParams;
  const collect = query.collect === '1' ? '?collect=1' : '';

  const data = await panelGet<YybBindingsPayload>(`/yyb/bindings${collect}`);

  if (!data) {
    return (
      <>
        <PageTitle title="应用宝 · 账号绑定" description="脚本 × 账号矩阵" />
        <Card title="读不到矩阵">
          <Empty text="还没有配置青龙端点。先在「应用宝 · 服务设置」填 YYB 地址，再在 config.json 的 qinglong 段填青龙地址与 OpenAPI 凭据。" />
        </Card>
      </>
    );
  }

  const { scripts, accounts, stats, qinglong } = data;

  return (
    <>
      <PageTitle
        title="应用宝 · 账号绑定"
        description="哪些账号参加哪些脚本——勾选即绑定，一张矩阵管全部"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Tag tone="gray">{`脚本 ${stats.scripts}`}</Tag>
        <Tag tone="gray">{`账号 ${stats.accounts}`}</Tag>
        <Tag tone={stats.bound ? 'success' : 'gray'}>{`已绑定 ${stats.bound}`}</Tag>
        <Tag tone={stats.empty ? 'warning' : 'success'}>{`未绑定 ${stats.empty}`}</Tag>
        {stats.unknown_refs > 0 && (
          <Tag tone="warning">{`${stats.unknown_refs} 个账号标识无效`}</Tag>
        )}
        {qinglong && (
          <span className="text-muted-foreground">
            {`青龙：${qinglong.base_url}（端点 #${qinglong.id}）`}
          </span>
        )}
      </div>

      {stats.unknown_refs > 0 && (
        <p className="
          mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs
          text-amber-800
        "
        >
          有行的账号值填成了微信 wxid（形如
          {' '}
          <code>wxid_xxx</code>
          ）。YYB 的 ref 只认
          <b>账号 ID / UIN / OpenID</b>
          ，wxid 会被 404（实测
          <code>account not found</code>
          ）。请在下面重新勾选。
        </p>
      )}

      <Card
        title="脚本 × 账号 矩阵"
        description="行 = 青龙里已有的 code 版任务，列 = 应用宝账号；勾完点「保存矩阵」"
      >
        <BindingsMatrix scripts={scripts} accounts={accounts} />
      </Card>
    </>
  );
}

export const dynamic = 'force-dynamic';
