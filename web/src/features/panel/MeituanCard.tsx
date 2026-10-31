'use client';

import type { MeituanAccount, MeituanSession } from './actions';
import { useActionState, useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  claimMeituanAction,
  deleteMeituanAccountAction,
  pollMeituanAuthAction,
  saveMeituanTokenAction,
  startMeituanAuthAction,
} from './actions';
import { Card, Empty, Tag } from './Ui';

const STATUS_TEXT: Record<string, string> = {
  waiting: '等待手机确认',
  success: '登录成功',
  failed: '登录失败',
  expired: '已超时',
  cancelled: '已取消',
};

/** 美团账号：扫码登录、手工粘贴凭证、领券。 */
export const MeituanCard = (props: {
  accounts: MeituanAccount[];
  runtimeReady: boolean;
  boundAccounts: Array<{ id: number; nickname: string; account_info: string }>;
}) => {
  const [session, setSession] = useState<MeituanSession | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [claimResult, setClaimResult] = useState('');
  const [saveState, saveAction, saving] = useActionState(saveMeituanTokenAction, '');
  const [delState, delAction] = useActionState(deleteMeituanAccountAction, '');

  // 轮询授权结果：成功后停表并提示刷新
  useEffect(() => {
    if (!session || session.status !== 'waiting') {
      return;
    }
    const timer = setInterval(async () => {
      const next = await pollMeituanAuthAction(session.id);
      if (next) {
        setSession(next);
        if (next.status === 'success') {
          setMessage('美团登录成功，凭证已保存');
        } else if (next.status === 'failed' || next.status === 'expired') {
          setMessage(next.message || '登录未完成');
        }
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [session]);

  const start = async () => {
    setBusy('start');
    setMessage('');
    const res = await startMeituanAuthAction(props.boundAccounts[0]?.id);
    setBusy('');
    if (!res.ok || !res.session) {
      setMessage(res.msg);
      return;
    }
    setSession(res.session);
  };

  const claim = async () => {
    setBusy('claim');
    setClaimResult('');
    const res = await claimMeituanAction();
    setBusy('');
    setClaimResult(res.ok ? JSON.stringify(res.data) : res.msg);
  };

  return (
    <Card
      title="美团账号"
      description="扫码登录美团官方账号，用于福利社领券；凭证保存在数据卷，容器重建不掉"
    >
      {!props.runtimeReady && (
        <div className="
          mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive
        "
        >
          运行环境缺少 node 或美团依赖（server/meituan_assets），扫码与领券不可用
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy === 'start' || !props.runtimeReady}
          onClick={start}
          className="
            rounded-md bg-brand-gradient px-4 py-1.5 text-sm font-semibold
            text-white
            hover:opacity-90
            disabled:opacity-50
          "
        >
          {busy === 'start' ? '获取中…' : '扫码登录美团'}
        </button>
        <button
          type="button"
          disabled={busy === 'claim' || !props.accounts.length}
          onClick={claim}
          className="
            rounded-md border px-4 py-1.5 text-sm
            hover:bg-muted
            disabled:opacity-50
          "
        >
          {busy === 'claim' ? '领券中…' : '领取福利社券'}
        </button>
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>

      {session && (
        <div className="mb-4 rounded-lg border p-3">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <Tag tone={session.status === 'success' ? 'success' : 'gray'}>
              {STATUS_TEXT[session.status] ?? session.status}
            </Tag>
            <span className="text-muted-foreground">{`会话 ${session.id}`}</span>
          </div>
          {session.qr
            ? (
                // 二维码是后端生成的 data URL，用普通 img 即可
                <img src={session.qr} alt="美团登录二维码" className="size-40" />
              )
            : (
                <a
                  href={session.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs break-all text-primary underline"
                >
                  {session.url}
                </a>
              )}
          <div className="mt-2 text-[11px] text-muted-foreground">
            用美团 App 扫码后在手机上确认；页面每 2.5 秒自动查询一次结果
          </div>
        </div>
      )}

      {claimResult && (
        <div className="
          mb-4 rounded-md bg-muted px-3 py-2 font-mono text-[11px] break-all
          text-muted-foreground
        "
        >
          {claimResult.slice(0, 400)}
        </div>
      )}

      <div className="mb-4">
        <div className="mb-2 text-xs font-semibold text-muted-foreground">
          {`已保存凭证 ${props.accounts.length} 个`}
        </div>
        {props.accounts.length
          ? (
              <ul className="flex flex-col gap-1 text-sm">
                {props.accounts.map(item => (
                  <li
                    key={item.id}
                    className="
                      flex flex-wrap items-center gap-2 border-b py-1.5
                      last:border-0
                    "
                  >
                    <span className="font-mono text-xs">{item.token_mask}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.account_id ? `绑定账号 #${item.account_id}` : '未绑定'}
                    </span>
                    {item.last_claimed_at > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {`上次领券 ${new Date(item.last_claimed_at * 1000).toLocaleString('zh-CN')}`}
                      </span>
                    )}
                    <form action={delAction} className="ml-auto">
                      <input type="hidden" name="record_id" value={item.id} />
                      <button
                        type="submit"
                        className="
                          rounded-sm border px-2 py-0.5 text-xs
                          hover:bg-muted
                        "
                      >
                        删除
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )
          : <Empty text="还没有美团凭证" />}
        {delState && (
          <div className="mt-1 text-xs text-muted-foreground">{delState.replace(/^(ok|error):/, '')}</div>
        )}
      </div>

      <form
        action={saveAction}
        className="flex flex-wrap items-end gap-2 border-t pt-3"
      >
        <label className="flex flex-col gap-1 text-xs font-medium">
          手工粘贴美团凭证
          <Input name="token" placeholder="已有 token 时可跳过扫码" className="h-8 w-72" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          绑定到小蚕账号
          <select
            name="account_id"
            className="h-8 rounded-md border bg-background px-2 text-xs"
          >
            <option value="">不绑定</option>
            {props.boundAccounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.nickname || account.account_info}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={saving}
          className="
            h-8 rounded-md border px-3 text-xs
            hover:bg-muted
            disabled:opacity-50
          "
        >
          {saving ? '保存中…' : '保存凭证'}
        </button>
        {saveState && (
          <span className="text-xs text-muted-foreground">{saveState.replace(/^(ok|error):/, '')}</span>
        )}
      </form>
    </Card>
  );
};
