'use client';

import type { XcOrder } from './actions';
import { useActionState, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  createOrderAction,
  deleteOrderAction,
  orderAction,
  submitPlatformIdAction,
} from './actions';
import { Card, Empty, Tag } from './Ui';

const STATUS_LABEL: Record<string, string> = {
  pending: '待提交',
  auditing: '审核中',
  completed: '已到账',
  rejected: '已拒绝',
  cancelled: '已取消',
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'gray'> = {
  completed: 'success',
  auditing: 'warning',
  pending: 'gray',
  rejected: 'warning',
  cancelled: 'gray',
};

const yuan = (value: number) => `¥${Number(value || 0).toFixed(2)}`;

/** 霸王餐订单：手工录入 + 提交外卖单号 + 延时券 + 免单卡核销。 */
export const OrdersCard = (props: {
  orders: XcOrder[];
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
}) => {
  const [createState, createAction, creating] = useActionState(createOrderAction, '');
  const [submitState, submitAction] = useActionState(submitPlatformIdAction, '');
  const [delState, delAction] = useActionState(deleteOrderAction, '');
  const [rowMessage, setRowMessage] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState('');

  const runAction = async (id: number, action: 'delay-voucher' | 'use-free-card') => {
    setBusy(`${id}-${action}`);
    const res = await orderAction(id, action);
    setBusy('');
    setRowMessage(prev => ({
      ...prev,
      [id]: res.ok ? (action === 'delay-voucher' ? '已申请延时 2 小时' : '免单卡已核销') : res.msg,
    }));
  };

  return (
    <Card
      title="霸王餐订单"
      description="手工录入订单，提交外卖平台单号进入小蚕审核；支持延时券与免单卡"
    >
      <form
        action={createAction}
        className="
          mb-4 grid gap-2
          sm:grid-cols-3
          lg:grid-cols-6
        "
      >
        <label className="flex flex-col gap-1 text-xs font-medium">
          关联账号
          <select
            name="account_id"
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            <option value="">不关联</option>
            {props.accounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.nickname || account.account_info}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          店铺名
          <Input name="store_name" className="h-8 text-xs" required />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          平台
          <select
            name="platform"
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            <option value="meituan">美团</option>
            <option value="eleme">饿了么</option>
            <option value="jingdong">京东</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          实付
          <Input
            name="order_money"
            type="number"
            step="0.01"
            className="h-8 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          返现
          <Input
            name="rebate_money"
            type="number"
            step="0.01"
            className="h-8 text-xs"
          />
        </label>
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium">
            活动订单号
            <Input name="order_sn" placeholder="可留空自动生成" className="h-8 text-xs" />
          </label>
          <button
            type="submit"
            disabled={creating}
            className="
              h-8 shrink-0 rounded-md bg-brand-gradient px-3 text-xs
              font-semibold text-white
              disabled:opacity-50
            "
          >
            {creating ? '录入中…' : '录入'}
          </button>
        </div>
      </form>
      {createState && (
        <div className="mb-3 text-xs text-muted-foreground">{createState.replace(/^(ok|error):/, '')}</div>
      )}
      {submitState && (
        <div className="mb-3 text-xs text-muted-foreground">{submitState.replace(/^(ok|error):/, '')}</div>
      )}
      {delState && (
        <div className="mb-3 text-xs text-muted-foreground">{delState.replace(/^(ok|error):/, '')}</div>
      )}

      {props.orders.length
        ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-xs text-muted-foreground">
                  <tr>
                    <th className="py-2">店铺</th>
                    <th className="py-2">平台</th>
                    <th className="py-2">实付 / 返现</th>
                    <th className="py-2">状态</th>
                    <th className="py-2">外卖单号</th>
                    <th className="py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {props.orders.map(order => (
                    <tr
                      key={order.id}
                      className="
                        border-b align-top
                        last:border-0
                      "
                    >
                      <td className="py-2">
                        <div className="text-xs font-medium">{order.store_name}</div>
                        <div className="
                          font-mono text-[10px] text-muted-foreground
                        "
                        >
                          {order.order_sn.slice(0, 24)}
                        </div>
                      </td>
                      <td className="py-2 text-xs">{order.platform}</td>
                      <td className="py-2 text-xs tabular-nums">
                        {`${yuan(order.order_money)} / ${yuan(order.rebate_money)}`}
                      </td>
                      <td className="py-2 text-xs">
                        <Tag tone={STATUS_TONE[order.status] ?? 'gray'}>
                          {STATUS_LABEL[order.status] ?? order.status}
                        </Tag>
                      </td>
                      <td className="py-2">
                        {order.platform_order_id
                          ? <span className="font-mono text-[10px]">{order.platform_order_id}</span>
                          : (
                              <form
                                action={submitAction}
                                className="flex items-center gap-1"
                              >
                                <input type="hidden" name="order_id" value={order.id} />
                                <Input
                                  name="platform_order_id"
                                  placeholder="填外卖单号"
                                  className="h-7 w-28 text-[10px]"
                                />
                                <button
                                  type="submit"
                                  className="
                                    h-7 rounded-sm border px-2 text-[10px]
                                    hover:bg-muted
                                  "
                                >
                                  提交
                                </button>
                              </form>
                            )}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            disabled={busy === `${order.id}-delay-voucher`}
                            onClick={() => runAction(order.id, 'delay-voucher')}
                            className="
                              rounded-sm border px-2 py-0.5 text-[10px]
                              hover:bg-muted
                              disabled:opacity-50
                            "
                          >
                            延时 2h
                          </button>
                          <button
                            type="button"
                            disabled={busy === `${order.id}-use-free-card`}
                            onClick={() => runAction(order.id, 'use-free-card')}
                            className="
                              rounded-sm border px-2 py-0.5 text-[10px]
                              hover:bg-muted
                              disabled:opacity-50
                            "
                          >
                            免单卡
                          </button>
                          <form action={delAction}>
                            <input type="hidden" name="order_id" value={order.id} />
                            <button
                              type="submit"
                              className="
                                rounded-sm border px-2 py-0.5 text-[10px]
                                hover:bg-muted
                              "
                            >
                              删除
                            </button>
                          </form>
                        </div>
                        {rowMessage[order.id] && (
                          <div className="
                            mt-1 text-[10px] break-all text-muted-foreground
                          "
                          >
                            {rowMessage[order.id]}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        : <Empty text="还没有订单记录" />}
    </Card>
  );
};
