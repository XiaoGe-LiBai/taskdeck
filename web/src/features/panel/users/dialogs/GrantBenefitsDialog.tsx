'use client';

import type { PanelUserRow } from '@/types/Panel';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { fetchVipLevelsAction, grantUserBenefitsAction } from '@/features/panel/actions';
import { fmtTime } from '@/features/panel/Ui';

/** 后端取不到时的兜底（名称与 server/vip.py 的 VIP_TABLE 一致；只有两档付费等级） */
const FALLBACK_LEVELS = [
  { level: 1, name: '高级会员' },
  { level: 2, name: '至尊会员' },
];

/** 13. 赠送权益弹窗：车位 / 会员天数 / 等级，可勾选是否发站内信。 */
export const GrantBenefitsDialog = (props: {
  user: PanelUserRow;
  onClose: () => void;
  onDone: (msg: { type: 'ok' | 'error'; text: string }) => void;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { user } = props;

  const [grantType, setGrantType] = useState<'slots' | 'membership' | 'both'>('both');
  const [grantSlots, setGrantSlots] = useState('1');
  // 会员等级只有 3 档（0 普通 / 1 高级 / 2 至尊），赠送时限定在 1-2，并夹住越界的存量值
  const [grantVipLevel, setGrantVipLevel] = useState(
    String(Math.min(Math.max(user.vip_level ?? 1, 1), 2)),
  );
  const [grantDays, setGrantDays] = useState('30');
  const [grantNote, setGrantNote] = useState('管理员赠送');
  const [grantNotify, setGrantNotify] = useState(true);
  // 等级名从后端读（唯一来源 server/vip.py），不在前端硬编码
  const [levels, setLevels] = useState<{ level: number; name: string }[]>([]);

  useEffect(() => {
    let alive = true;
    fetchVipLevelsAction().then((data) => {
      if (alive && data?.length) {
        setLevels(data.map(l => ({ level: l.level, name: l.name })));
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const levelOptions = (levels.length ? levels : FALLBACK_LEVELS).filter(l => l.level > 0);

  const submit = () => {
    const slots = grantType !== 'membership' ? Number.parseInt(grantSlots, 10) || 0 : 0;
    const days = grantType !== 'slots' ? Number.parseInt(grantDays, 10) || 0 : 0;
    const vipLv = grantType !== 'slots' ? Number.parseInt(grantVipLevel, 10) || 1 : 0;
    if (slots <= 0 && days <= 0) {
      props.onDone({ type: 'error', text: '请至少填写一项赠送内容' });
      return;
    }
    startTransition(async () => {
      const res = await grantUserBenefitsAction(user.id, {
        grant_type: grantType,
        slots,
        vip_level: vipLv,
        days,
        note: grantNote,
        notify: grantNotify,
      });
      if (res.ok) {
        props.onDone({ type: 'ok', text: res.msg });
        props.onClose();
        router.refresh();
      } else {
        props.onDone({ type: 'error', text: res.msg });
      }
    });
  };

  return (
    <div className="
      fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4
      backdrop-blur-xs
    "
    >
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-base font-semibold text-foreground">
            🎁 赠送
            {' '}
            {user.nickname}
            {' '}
            权益
          </h3>
          <button
            type="button"
            onClick={props.onClose}
            className="
              rounded-lg p-1.5 text-muted-foreground
              hover:bg-muted
            "
          >
            ✕
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-4 text-xs">
          {/* 赠送类型 */}
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground">赠送类型</label>
            <div className="flex gap-1.5">
              {([
                { value: 'slots', label: '🅿️ 仅车位' },
                { value: 'membership', label: '👑 仅会员' },
                { value: 'both', label: '🎁 车位+会员' },
              ] as const).map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setGrantType(opt.value)}
                  className={`
                    flex-1 rounded-lg border px-3 py-2 text-center text-xs
                    font-medium transition-colors
                    ${
                grantType === opt.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : `
                    border-input bg-background
                    hover:bg-muted
                  `
                }
                  `}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 车位数 */}
          {(grantType === 'slots' || grantType === 'both') && (
            <div className="flex flex-col gap-1.5">
              <label className="font-medium text-foreground">赠送车位数</label>
              <input
                type="number"
                min="1"
                value={grantSlots}
                onChange={e => setGrantSlots(e.target.value)}
                className="
                  h-9 w-full rounded-lg border border-input bg-background px-3
                  text-sm
                  focus:ring-1 focus:ring-primary
                "
              />
              <span className="text-[10px] text-muted-foreground">
                当前车位:
                {' '}
                {user.slot_used ?? 0}
                /
                {user.slot_total ?? 0}
              </span>
            </div>
          )}

          {/* 会员等级 + 天数 */}
          {(grantType === 'membership' || grantType === 'both') && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground">会员等级</label>
                <select
                  value={grantVipLevel}
                  onChange={e => setGrantVipLevel(e.target.value)}
                  className="
                    h-9 w-full rounded-lg border border-input bg-background px-3
                    text-sm
                    focus:ring-1 focus:ring-primary
                  "
                >
                  {levelOptions.map(l => (
                    <option key={l.level} value={l.level}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-foreground">赠送天数</label>
                <input
                  type="number"
                  min="1"
                  value={grantDays}
                  onChange={e => setGrantDays(e.target.value)}
                  className="
                    h-9 w-full rounded-lg border border-input bg-background px-3
                    text-sm
                    focus:ring-1 focus:ring-primary
                  "
                />
                <span className="text-[10px] text-muted-foreground">
                  当前到期:
                  {' '}
                  {user.vip_expire ? fmtTime(user.vip_expire) : '未开通'}
                </span>
              </div>
            </>
          )}

          {/* 备注 */}
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground">备注说明</label>
            <input
              type="text"
              value={grantNote}
              onChange={e => setGrantNote(e.target.value)}
              placeholder="例如：新用户福利 / 活动奖励"
              className="
                h-9 w-full rounded-lg border border-input bg-background px-3
                text-sm
                focus:ring-1 focus:ring-primary
              "
            />
          </div>

          {/* 是否通知 */}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={grantNotify}
              onChange={e => setGrantNotify(e.target.checked)}
              className="size-4 rounded-sm border-gray-300 text-primary"
            />
            <span className="text-xs text-muted-foreground">发送站内信通知用户</span>
          </label>

          <div className="flex justify-end gap-2 border-t pt-3">
            <button
              type="button"
              onClick={props.onClose}
              className="
                rounded-lg border px-4 py-2
                hover:bg-muted
              "
            >
              取消
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={submit}
              className="
                rounded-lg bg-amber-600 px-4 py-2 font-medium text-white
                hover:bg-amber-700
                disabled:opacity-50
              "
            >
              {pending ? '赠送中…' : '确认赠送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
