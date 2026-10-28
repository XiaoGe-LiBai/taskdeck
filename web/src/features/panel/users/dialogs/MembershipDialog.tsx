'use client';

import type { VipLevelBenefit } from '@/features/panel/actions';
import type { PanelUserRow } from '@/types/Panel';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { fetchVipLevelsAction, updateUserMembershipAction } from '@/features/panel/actions';
import { fmtTime } from '@/features/panel/Ui';

/** 兜底等级列表（后端 `server/vip.py` 取不到时用，避免弹窗打不开） */
const FALLBACK_LEVELS: VipLevelBenefit[] = [
  { level: 0, name: '普通会员', slots: 0, discount_label: '无折扣', signin_mult: 1, signin_bonus_label: '无加成', referral_bps: 800, referral_label: '8%' },
  { level: 1, name: '高级会员', slots: 3, discount_label: '实付 95%', signin_mult: 1.25, signin_bonus_label: '+25%', referral_bps: 1200, referral_label: '12%' },
  { level: 2, name: '至尊会员', slots: 10, discount_label: '实付 90%', signin_mult: 1.5, signin_bonus_label: '+50%', referral_bps: 1800, referral_label: '18%' },
];

/**
 * 14. 调整会员等级 / 到期时间弹窗。
 *
 * 等级选项与权益说明都从后端 `/admin/vip/levels` 读（唯一来源 server/vip.py），
 * 前端不写死等级——改 vip.py 的数值，这里自动跟着变。
 */
export const MembershipDialog = (props: {
  user: PanelUserRow;
  onClose: () => void;
  onDone: (msg: { type: 'ok' | 'error'; text: string }) => void;
}) => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { user } = props;

  const [level, setLevel] = useState(String(user.vip_level ?? 0));
  const [expire, setExpire] = useState(user.vip_expire || '');
  const [levels, setLevels] = useState<VipLevelBenefit[]>(FALLBACK_LEVELS);

  useEffect(() => {
    let alive = true;
    fetchVipLevelsAction().then((data) => {
      if (alive && data && data.length) {
        setLevels(data);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const selected = levels.find(l => String(l.level) === level) ?? levels[0];

  const submit = () => {
    const lv = Number.parseInt(level, 10) || 0;
    const expireValue = expire || null;
    startTransition(async () => {
      const res = await updateUserMembershipAction(user.id, lv, expireValue, '管理员手动调整');
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
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-base font-semibold text-foreground">
            👑 调整
            {' '}
            {user.nickname}
            {' '}
            会员
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
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground">会员等级</label>
            <select
              value={level}
              onChange={e => setLevel(e.target.value)}
              className="
                h-9 w-full rounded-lg border border-input bg-background px-3
                text-sm
                focus:ring-1 focus:ring-primary
              "
            >
              {levels.map(l => (
                <option key={l.level} value={l.level}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* 该等级的权益（只读展示，来源后端 vip.py） */}
          {selected && (
            <div className="
              rounded-lg border border-primary/20 bg-primary/5 p-3
            "
            >
              <div className="mb-1.5 font-medium text-foreground">
                {selected.name}
                {' '}
                权益
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <span className="text-muted-foreground">赠送车位</span>
                <span className="text-right font-medium text-foreground">
                  {selected.slots > 0 ? `+${selected.slots} 个` : '无'}
                </span>
                <span className="text-muted-foreground">会员期/项目折扣</span>
                <span className="text-right font-medium text-foreground">{selected.discount_label}</span>
                <span className="text-muted-foreground">签到加成</span>
                <span className="text-right font-medium text-foreground">{selected.signin_bonus_label}</span>
                <span className="text-muted-foreground">邀请返利</span>
                <span className="text-right font-medium text-foreground">{selected.referral_label}</span>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-foreground">到期时间（留空 = 永久/不限）</label>
            <input
              type="datetime-local"
              value={expire}
              onChange={e => setExpire(e.target.value)}
              className="
                h-9 w-full rounded-lg border border-input bg-background px-3
                text-sm
                focus:ring-1 focus:ring-primary
              "
            />
            <span className="text-[10px] text-muted-foreground">
              当前:
              {' '}
              {user.vip_expire ? fmtTime(user.vip_expire) : '未设置'}
              {expire ? '（到期后自动回落普通会员）' : ''}
            </span>
          </div>
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
                rounded-lg bg-primary px-4 py-2 font-medium
                text-primary-foreground
                hover:bg-primary/90
                disabled:opacity-50
              "
            >
              {pending ? '保存中…' : '确认调整'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
