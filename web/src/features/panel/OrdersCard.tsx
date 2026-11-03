'use client';

import type { XcOrder } from './actions';
import { Fragment, useActionState, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  createOrderAction,
  deleteOrderAction,
  orderAction,
  submitPlatformIdAction,
  syncOrdersAction,
  updateOrderAction,
} from './actions';
import {
  ORDER_PLATFORM_LABEL,
  ORDER_STATUS_FILTERS,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_TONE,
} from './OrderStatus';
import { Card, Empty, Tag } from './Ui';

const yuan = (value: number) => `¥${Number(value || 0).toFixed(2)}`;

const dayText = (raw: string | null) =>
  raw ? new Date(raw).toLocaleString('zh-CN', { hour12: false }) : '—';

/** 霸王餐订单：手工录入 + 提交外卖单号 + 延时券 + 免单卡核销 + 状态流转。 */
export const OrdersCard = (props: {
  orders: XcOrder[];
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
}) => {
  const [createState, createAction, creating] = useActionState(createOrderAction, '');
  const [submitState, submitAction] = useActionState(submitPlatformIdAction, '');
  const [delState, delAction] = useActionState(deleteOrderAction, '');
  const [rowMessage, setRowMessage] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState('');
  const [accountFilter, setAccountFilter] = useState(0);
  const [platformFilter, setPlatformFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [editing, setEditing] = useState<number | null>(null);

  const accountNames = useMemo(() => Object.fromEntries(
    props.accounts.map(account => [account.id, account.nickname || account.account_info]),
  ), [props.accounts]);

  const counts = Object.fromEntries(
    ORDER_STATUS_FILTERS.map(key => [
      key,
      key ? props.orders.filter(o => o.status === key).length : props.orders.length,
    ]),
  );
  const visible = props.orders.filter(order => {
    if (filter && order.status !== filter) return false;
    if (accountFilter && order.account_id !== accountFilter) return false;
    if (platformFilter && order.platform !== platformFilter) return false;
    const query = keyword.trim().toLowerCase();
    if (query && !`${order.store_name} ${order.order_sn} ${order.platform_order_id || ''}`.toLowerCase().includes(query)) return false;
    return true;
  });

  const sync = async () => {
    setSyncing(true);
    const result = await syncOrdersAction(accountFilter || undefined);
    setSyncing(false);
    setSyncMessage(result.msg);
    if (result.ok) window.location.reload();
  };

  const runAction = async (id: number, action: 'delay-voucher' | 'use-free-card') => {
    setBusy(`${id}-${action}`);
    const res = await orderAction(id, action);
    setBusy('');
    setRowMessage(prev => ({
      ...prev,
      [id]: res.ok ? (action === 'delay-voucher' ? '已申请延时 2 小时' : '免单卡已核销') : res.msg,
    }));
  };

  /** 到账是最高频的收尾动作，给一个不用展开表单的快捷键。 */
  const markDone = async (id: number) => {
    setBusy(`${id}-done`);
    const res = await updateOrderAction(id, { status: 'completed' });
    setBusy('');
    if (!res.ok) {
      setRowMessage(prev => ({ ...prev, [id]: res.msg }));
    }
  };

  return (
    <Card
      title="霸王餐订单"
      description="同步小蚕平台真实订单，也可手工补录；支持提交外卖单号、延时券与免单卡"
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
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          账号
          <select value={accountFilter} onChange={event => setAccountFilter(Number(event.target.value))} className="h-8 min-w-36 rounded-md border bg-background px-2 text-xs">
            <option value={0}>全部账号</option>
            {props.accounts.map(account => <option key={account.id} value={account.id}>{account.nickname || account.account_info}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          平台
          <select value={platformFilter} onChange={event => setPlatformFilter(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs">
            <option value="">全部平台</option>
            <option value="meituan">美团</option>
            <option value="eleme">饿了么</option>
            <option value="jingdong">京东</option>
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium">
          搜索
          <Input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="店铺名或订单号" className="h-8 text-xs" />
        </label>
        <button type="button" disabled={syncing || props.accounts.length === 0} onClick={() => void sync()} className="h-8 rounded-md bg-brand-gradient px-3 text-xs font-semibold text-white disabled:opacity-50">
          {syncing ? '同步中…' : '同步平台订单'}
        </button>
        {syncMessage && <span className="w-full text-xs text-muted-foreground">{syncMessage}</span>}
      </div>
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
            <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
              {ORDER_STATUS_FILTERS.map(key => (
                <button
                  key={key || 'all'}
                  type="button"
                  onClick={() => setFilter(key)}
                  className="
                    rounded-full border px-2 py-0.5
                    hover:bg-muted
                  "
                >
                  <span className="mr-1">{key ? ORDER_STATUS_LABEL[key] : '全部'}</span>
                  <span className="text-muted-foreground">{counts[key]}</span>
                </button>
              ))}
              <span className="ml-auto text-[10px] text-muted-foreground">
                {`显示 ${visible.length} / ${props.orders.length} 条`}
              </span>
            </div>
          )
        : null}

      {visible.length
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
                  {visible.map(order => (
                    <Fragment key={order.id}>
                      <tr className="border-b align-top">
                        <td className="py-2">
                          <div className="text-xs font-medium">{order.store_name}</div>
                          <div className="
                            font-mono text-[10px] text-muted-foreground
                          "
                          >
                            {order.order_sn.slice(0, 24)}
                          </div>
                          {order.account_id && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {`账号：${accountNames[order.account_id] ?? `#${order.account_id}`}`}
                            </div>
                          )}
                          {order.note && (
                            <div className="
                              mt-0.5 text-[10px] text-muted-foreground
                            "
                            >
                              {order.note}
                            </div>
                          )}
                        </td>
                        <td className="py-2 text-xs">
                          {ORDER_PLATFORM_LABEL[order.platform] ?? order.platform}
                        </td>
                        <td className="py-2 text-xs tabular-nums">
                          {`${yuan(order.order_money)} / ${yuan(order.rebate_money)}`}
                          {order.settled_time && (
                            <div className="text-[10px] text-muted-foreground">
                              {`结算 ${dayText(order.settled_time)}`}
                            </div>
                          )}
                        </td>
                        <td className="py-2 text-xs">
                          <Tag tone={ORDER_STATUS_TONE[order.status] ?? 'gray'}>
                            {ORDER_STATUS_LABEL[order.status] ?? order.status}
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
                            {order.status !== 'completed' && (
                              <button
                                type="button"
                                disabled={busy === `${order.id}-done`}
                                onClick={() => markDone(order.id)}
                                className="
                                  rounded-sm border px-2 py-0.5 text-[10px]
                                  hover:bg-muted
                                  disabled:opacity-50
                                "
                              >
                                标记到账
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setEditing(editing === order.id ? null : order.id)}
                              className="
                                rounded-sm border px-2 py-0.5 text-[10px]
                                hover:bg-muted
                              "
                            >
                              {editing === order.id ? '收起' : '编辑'}
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
                      {editing === order.id && (
                        <tr className="border-b bg-muted/30">
                          <td colSpan={6} className="py-2">
                            <EditForm order={order} onDone={() => setEditing(null)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )
        : <Empty text={filter ? '这个状态下还没有订单' : '还没有订单记录'} />}
    </Card>
  );
};

/** 行内编辑：改状态、金额与备注。状态变化会自动补结算时间并触发通知。 */
function EditForm(props: { order: XcOrder; onDone: () => void }) {
  const [status, setStatus] = useState(props.order.status);
  const [orderMoney, setOrderMoney] = useState(String(props.order.order_money ?? 0));
  const [rebateMoney, setRebateMoney] = useState(String(props.order.rebate_money ?? 0));
  const [note, setNote] = useState(props.order.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    const res = await updateOrderAction(props.order.id, {
      status,
      order_money: Number(orderMoney || 0),
      rebate_money: Number(rebateMoney || 0),
      note,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.msg);
      return;
    }
    props.onDone();
  };

  return (
    <div className="
      grid gap-2 text-xs
      sm:grid-cols-2
      lg:grid-cols-5
    "
    >
      <label className="flex flex-col gap-1 font-medium">
        状态
        <select
          value={status}
          onChange={event => setStatus(event.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
        >
          {Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 font-medium">
        实付
        <Input
          value={orderMoney}
          type="number"
          step="0.01"
          onChange={event => setOrderMoney(event.target.value)}
          className="h-8 text-xs"
        />
      </label>
      <label className="flex flex-col gap-1 font-medium">
        返现
        <Input
          value={rebateMoney}
          type="number"
          step="0.01"
          onChange={event => setRebateMoney(event.target.value)}
          className="h-8 text-xs"
        />
      </label>
      <label className="flex flex-col gap-1 font-medium">
        备注
        <Input
          value={note}
          onChange={event => setNote(event.target.value)}
          className="h-8 text-xs"
        />
      </label>
      <div className="flex items-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="
            h-8 rounded-md bg-brand-gradient px-3 text-xs font-semibold
            text-white
            disabled:opacity-50
          "
        >
          {busy ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          onClick={props.onDone}
          className="
            h-8 rounded-md border px-3 text-xs
            hover:bg-muted
          "
        >
          取消
        </button>
      </div>
      {error && (
        <div className="
          text-[10px] text-destructive
          sm:col-span-2
          lg:col-span-5
        "
        >
          {error}
        </div>
      )}
    </div>
  );
}
