import type { PanelCardRow, PanelCardTier, PanelList, PanelProduct } from '@/types/Panel';
import { AnimatedList } from '@/components/reactbits';
import { Input, Select } from '@/components/ui/input';
import {
  deleteCardsAction,
  generateCardsAction,
  voidCardsAction,
} from '@/features/panel/actions';
import { ProductBoard, TierBoard } from '@/features/panel/CatalogEditors';
import { FeedbackButton } from '@/features/panel/Client';
import { StateForm } from '@/features/panel/ExpireEditor';
import {
  Card,
  CountValue,
  Empty,
  fen,
  fmtTime,
  Pager,
  PageTitle,
  StatCard,
  Table,
  Tag,
  Td,
} from '@/features/panel/Ui';
import { panelGet } from '@/libs/PanelApi';

const statusText = { unused: '未使用', used: '已使用', void: '已作废' } as const;
const statusTone = { unused: 'info', used: 'gray', void: 'danger' } as const;

export default async function CardsPage(props: {
  searchParams: Promise<{ page?: string; status?: string; tier_id?: string }>;
}) {
  const query = await props.searchParams;

  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const params = new URLSearchParams({ page: String(page), size: '15' });
  if (query.status) {
    params.set('status', query.status);
  }
  if (query.tier_id) {
    params.set('tier_id', query.tier_id);
  }

  const [tiers, cards, products] = await Promise.all([
    panelGet<PanelCardTier[]>('/admin/card-tiers'),
    panelGet<PanelList<PanelCardRow>>(`/admin/cards?${params.toString()}`),
    panelGet<PanelProduct[]>('/admin/products'),
  ]);

  return (
    <>
      <PageTitle
        title="卡密管理"
        description="档位一览、生成卡密、批量作废 / 删除"
      />

      <AnimatedList
        stagger={60}
        className="
          mb-6 grid gap-4
          sm:grid-cols-3
        "
      >
        <StatCard
          label="全站卡密总数"
          value={<CountValue value={cards?.total ?? 0} suffix="张" />}
          hint="包含已使用与未核销"
          icon="🎫"
        />
        <StatCard
          label="卡密档位数"
          value={<CountValue value={tiers?.length ?? 0} suffix="档" />}
          hint="支持拖拽调整前端排序"
          icon="🏷️"
        />
        <StatCard
          label="积分商品上架"
          value={<CountValue value={products?.length ?? 0} suffix="件" />}
          hint="会员套餐与卡槽扩容"
          icon="📦"
        />
      </AnimatedList>

      <Card
        title="卡密档位"
        description="面额、售价、启用状态在线维护；拖动行首或用 ↑↓ 调整顺序，改完点「保存排序」"
      >
        {(tiers?.length ?? 0) > 0
          ? (
              <TierBoard
                key={(tiers ?? []).map(t => t.id).sort((a, b) => a - b).join(',')}
                tiers={tiers ?? []}
              />
            )
          : <Empty text="还没有档位，点下面「+ 新增档位」加一个" />}
      </Card>

      <Card
        className="mt-6"
        title="积分商品"
        description="会员套餐与卡槽商品：名称、价格、上架状态在线维护，顺序同样可拖拽调整"
      >
        {(products?.length ?? 0) > 0
          ? (
              <ProductBoard
                key={(products ?? []).map(p => p.id).sort((a, b) => a - b).join(',')}
                products={products ?? []}
              />
            )
          : <Empty text="还没有积分商品，点下面「+ 新增商品」加一个" />}
      </Card>

      {(tiers?.length ?? 0) > 0 && (
        <Card
          className="mt-6"
          title="生成卡密"
          description="生成后可直接复制卡密文本发给客户"
        >
          <StateForm
            action={generateCardsAction}
            fields={{}}
            okLabel="已生成 {v} 张卡密"
            submitLabel="生成"
          >
            <Select name="tier_id" className="h-9 w-48 text-sm">
              {(tiers ?? []).map(tier => (
                <option key={tier.id} value={tier.id}>
                  {`${tier.name} · ${fen(tier.points_value)} 分`}
                </option>
              ))}
            </Select>
            <Input
              name="count"
              type="number"
              min={1}
              max={1000}
              defaultValue={10}
              className="h-9 w-28 text-sm"
            />
            <span className="text-xs text-muted-foreground">张（1 - 1000）</span>
          </StateForm>
        </Card>
      )}

      <div className="mt-6">
        <Card title={`卡密列表 · 共 ${cards?.total ?? 0} 张`}>
          <div className="mb-4 flex flex-wrap gap-2 text-sm">
            {[
              { label: '全部状态', value: '' },
              { label: '未使用', value: 'unused' },
              { label: '已使用', value: 'used' },
              { label: '已作废', value: 'void' },
            ].map(item => (
              <a
                key={item.value || 'all'}
                href={`/dashboard/cards${item.value ? `?status=${item.value}` : ''}`}
                className={`
                  rounded-md border px-3 py-1.5
                  ${
              (query.status ?? '') === item.value
                ? `bg-primary text-primary-foreground`
                : `hover:bg-muted`
              }
                `}
              >
                {item.label}
              </a>
            ))}
          </div>

          {cards?.records?.length
            ? (
                <>
                  <form id="cards-form">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">勾选后批量处理</span>
                      <FeedbackButton
                        formAction={voidCardsAction}
                        confirm="确认作废勾选的卡密？作废后不可兑换。"
                      >
                        批量作废
                      </FeedbackButton>
                      <FeedbackButton
                        formAction={deleteCardsAction}
                        confirm="确认永久删除勾选的卡密？删除后不可恢复。"
                        className="border-destructive/40 text-destructive"
                      >
                        批量删除
                      </FeedbackButton>
                    </div>

                    <Table head={['选择', '卡密', '档位', '面额(分)', '状态', '使用人', '生成时间', '操作']}>
                      {cards.records.map(row => (
                        <tr key={row.id}>
                          <Td>
                            <input
                              type="checkbox"
                              name="ids"
                              value={row.id}
                              className="size-4"
                              aria-label={`选择卡密 ${row.code}`}
                            />
                          </Td>
                          <Td className="font-mono text-xs">{row.code}</Td>
                          <Td>{row.tier_name ?? '—'}</Td>
                          <Td className="tabular-nums">{fen(row.points_value)}</Td>
                          <Td>
                            <Tag tone={statusTone[row.status]}>{statusText[row.status]}</Tag>
                          </Td>
                          <Td className="tabular-nums">{row.user_id ?? '—'}</Td>
                          <Td className="text-xs tabular-nums">{fmtTime(row.created_time)}</Td>
                          <Td>
                            {row.status !== 'used' && (
                              <div className="flex gap-1.5">
                                <FeedbackButton
                                  formAction={voidCardsAction}
                                  name="ids"
                                  value={row.id}
                                  confirm="确认作废这张卡密？"
                                >
                                  作废
                                </FeedbackButton>
                                <FeedbackButton
                                  formAction={deleteCardsAction}
                                  name="ids"
                                  value={row.id}
                                  confirm="确认永久删除这张卡密？"
                                  className="
                                    border-destructive/40 text-destructive
                                  "
                                >
                                  删除
                                </FeedbackButton>
                              </div>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </Table>
                  </form>

                  <Pager
                    page={cards.page}
                    size={cards.size}
                    total={cards.total}
                    basePath="/dashboard/cards"
                    query={{ status: query.status, tier_id: query.tier_id }}
                  />
                </>
              )
            : (
                <Empty text="暂无卡密" />
              )}
        </Card>
      </div>
    </>
  );
}

export const dynamic = 'force-dynamic';
