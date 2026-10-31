'use client';

import type { XcAction } from './actions';
import { useState } from 'react';
import { callXiaocanAction } from './actions';
import { Card } from './Ui';

/** 中文名与分组：后端只给 key，文案放前端 */
const GROUP_OF: Record<string, string> = {
  get_daily_tasks: '任务与积分',
  get_user_task_v2: '任务与积分',
  collect_points: '任务与积分',
  user_claim_points: '任务与积分',
  get_unreceived_point_records: '任务与积分',
  get_sign_in_history: '任务与积分',
  get_lottery_info: '抽奖与红包',
  do_lottery_spin: '抽奖与红包',
  receive_extra_lottery: '抽奖与红包',
  claim_ad_lottery_chance: '抽奖与红包',
  get_lottery_progress: '抽奖与红包',
  get_redpack_rain_event: '抽奖与红包',
  join_redpack_rain: '抽奖与红包',
  grab_redpack_rain: '抽奖与红包',
  list_user_redpack: '抽奖与红包',
  get_user_max_redpack: '红包与提现',
  get_app_redpack_list: '红包与提现',
  get_user_redpack_num: '红包与提现',
  client_withdraw: '红包与提现',
  get_client_withdraw_list: '红包与提现',
  get_order_list: '订单',
  cancel_promotion_quota: '订单',
  get_store_promotion_detail: '订单',
  get_user_card_number: '卡片与券',
  get_user_card_list: '卡片与券',
  get_brand_card_info: '卡片与券',
  grab_brand_card: '卡片与券',
  get_user_free_order_info: '卡片与券',
  grab_free_order_quota: '卡片与券',
  use_free_order_card: '卡片与券',
  get_plus_vip_rebate_card_infos: '卡片与券',
  grab_rebate_card_quota: '卡片与券',
  list_flash_sale_exchanges: '社区与礼包',
  today_exchange: '社区与礼包',
  exchange_goods: '社区与礼包',
  list_vip_gifts: '社区与礼包',
  list_vip_gift_details: '社区与礼包',
  get_vip_up_gift: '社区与礼包',
  draw_page_gift: '社区与礼包',
  get_vip_task: '社区与礼包',
  get_vip_prizes: '社区与礼包',
  get_vip_rebate_info: '社区与礼包',
  get_message_channels: '消息中心',
  get_messages: '消息中心',
  set_all_messages_read: '消息中心',
};

const LABEL: Record<string, string> = {
  get_daily_tasks: '每日任务',
  get_user_task_v2: '任务总览',
  collect_points: '一键领取元宝',
  user_claim_points: '领取指定任务',
  get_unreceived_point_records: '未领取记录',
  get_sign_in_history: '签到历史',
  get_lottery_info: '抽奖信息',
  do_lottery_spin: '抽奖一次',
  receive_extra_lottery: '领取额外次数',
  claim_ad_lottery_chance: '看广告加次数',
  get_lottery_progress: '抽奖进度',
  get_redpack_rain_event: '红包雨活动',
  join_redpack_rain: '报名红包雨',
  grab_redpack_rain: '抢红包雨',
  list_user_redpack: '我的红包',
  get_user_max_redpack: '最大红包',
  get_app_redpack_list: '红包列表',
  get_user_redpack_num: '红包数量',
  client_withdraw: '申请提现',
  get_client_withdraw_list: '提现记录',
  get_order_list: '订单列表',
  cancel_promotion_quota: '取消占位',
  get_store_promotion_detail: '活动详情',
  get_user_card_number: '卡片数量',
  get_user_card_list: '我的卡片',
  get_brand_card_info: '品牌券信息',
  grab_brand_card: '抢品牌券',
  get_user_free_order_info: '免单卡信息',
  grab_free_order_quota: '抢免单名额',
  use_free_order_card: '使用免单卡',
  get_plus_vip_rebate_card_infos: '返利卡信息',
  grab_rebate_card_quota: '抢返利卡',
  list_flash_sale_exchanges: '秒杀兑换',
  today_exchange: '今日兑换',
  exchange_goods: '兑换商品',
  list_vip_gifts: 'VIP 礼包',
  list_vip_gift_details: '礼包明细',
  get_vip_up_gift: '升级礼包',
  draw_page_gift: '页面抽奖',
  get_vip_task: 'VIP 任务',
  get_vip_prizes: 'VIP 奖品',
  get_vip_rebate_info: 'VIP 返利',
  get_message_channels: '消息渠道',
  get_messages: '消息列表',
  set_all_messages_read: '全部已读',
};

const GROUPS = ['任务与积分', '抽奖与红包', '红包与提现', '订单', '卡片与券', '社区与礼包', '消息中心'];

const PARAM_LABEL: Record<string, string> = {
  task_id: '任务 ID',
  promotion_id: '活动 ID',
  money: '金额（分）',
  type: '类型',
  goods_id: '商品 ID',
  page: '页码',
  page_size: '每页',
  offset: '偏移',
  number: '条数',
  order_status: '订单状态',
  prize_type: '奖品类型',
  step: '步骤',
  click_num: '点击次数',
};

export const XiaocanToolbox = (props: {
  accounts: Array<{ id: number; nickname: string; account_info: string }>;
  actions: XcAction[];
}) => {
  const [accountId, setAccountId] = useState(props.accounts[0]?.id ?? 0);
  const [params, setParams] = useState<Record<string, string>>({});
  const [pending, setPending] = useState('');
  const [result, setResult] = useState<{ key: string; ok: boolean; text: string } | null>(null);

  if (!props.accounts.length) {
    return (
      <Card title="小蚕工具箱" description="先绑定小蚕账号">
        <p className="text-sm text-muted-foreground">还没有绑定小蚕账号</p>
      </Card>
    );
  }

  const run = async (action: XcAction) => {
    setPending(action.key);
    setResult(null);
    const payload: Record<string, unknown> = {};
    for (const param of action.params) {
      const raw = params[`${action.key}.${param.name}`] ?? String(param.default ?? '');
      if (raw !== '') {
        payload[param.name] = raw;
      }
    }
    const res = await callXiaocanAction(accountId, action.key, payload);
    setPending('');
    if (!res.ok) {
      setResult({ key: action.key, ok: false, text: res.msg });
      return;
    }
    const text = JSON.stringify(res.data ?? {}, null, 0);
    setResult({ key: action.key, ok: true, text: text.length > 400 ? `${text.slice(0, 400)}…` : text });
  };

  return (
    <Card
      title="小蚕工具箱"
      description="元宝任务、抽奖、红包、提现、订单、卡片、社区、消息；带参数的动作请先填参数"
    >
      <label className="mb-3 flex max-w-xs flex-col gap-1 text-sm font-medium">
        使用账号
        <select
          value={accountId}
          onChange={e => setAccountId(Number(e.target.value))}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          {props.accounts.map(account => (
            <option key={account.id} value={account.id}>
              {account.nickname || account.account_info}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-4">
        {GROUPS.map((group) => {
          const items = props.actions.filter(action => GROUP_OF[action.key] === group);
          if (!items.length) {
            return null;
          }
          return (
            <div key={group}>
              <div className="mb-2 text-xs font-semibold text-muted-foreground">{group}</div>
              <div className="flex flex-wrap items-end gap-2">
                {items.map(action => (
                  <div
                    key={action.key}
                    className="flex items-end gap-1 rounded-md border p-2"
                  >
                    {action.params.map(param => (
                      <label
                        key={param.name}
                        className="
                          flex flex-col text-[10px] text-muted-foreground
                        "
                      >
                        {PARAM_LABEL[param.name] ?? param.name}
                        <input
                          value={params[`${action.key}.${param.name}`] ?? ''}
                          onChange={e => setParams(prev => ({ ...prev, [`${action.key}.${param.name}`]: e.target.value }))}
                          placeholder={param.required ? '必填' : String(param.default ?? '')}
                          className="
                            h-7 w-20 rounded-sm border bg-background px-1
                            text-xs
                          "
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      disabled={pending === action.key}
                      onClick={() => run(action)}
                      className="
                        h-7 rounded-sm border px-2 text-xs
                        hover:bg-muted
                        disabled:opacity-50
                      "
                    >
                      {pending === action.key ? '执行中…' : (LABEL[action.key] ?? action.key)}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {result && (
        <div
          className={`
            mt-3 rounded-md px-3 py-2 font-mono text-[11px] break-all
            ${result.ok
          ? `bg-muted text-muted-foreground`
          : `bg-destructive/10 text-destructive`}
          `}
        >
          {`${result.key} → ${result.text}`}
        </div>
      )}
    </Card>
  );
};
