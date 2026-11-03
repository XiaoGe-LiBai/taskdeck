/* eslint-disable next/no-img-element -- 二维码是服务端转好的 data URL，不需要 next/image 优化 */
'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { xiaocanManualBindAction, xiaocanQrPollAction, xiaocanQrStartAction } from './xiaocanActions';

const STATUS_LABEL: Record<string, string> = {
  waiting: '等待扫码…',
  scanned: '已扫码，请在手机上确认',
  done: '登录成功，账号已写入',
  expired: '二维码已过期，请重新生成',
  error: '扫码失败，请重试',
};

/** 这些状态说明还在等用户操作，继续轮询 */
const PENDING_STATES = new Set(['', 'waiting', 'pending', 'scanned']);

/**
 * 小蚕账号绑定入口（与 YYB 扫码入口对等）：
 * 微信扫码登录 —— 二维码由后端向微信开放平台实时取回，确认后自动换取
 * 小蚕凭证并入库，前端只负责展示与轮询。
 */
export const XiaocanBindPanel = () => {
  const router = useRouter();
  const [mode, setMode] = useState<'qr' | 'manual'>('qr');
  const [manualText, setManualText] = useState('');
  const [manualMessage, setManualMessage] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [image, setImage] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const stoppedRef = useRef(true);

  const start = useCallback(async () => {
    setLoading(true);
    setError('');
    setImage('');
    setStatus('');
    setSucceeded(false);
    stoppedRef.current = false;

    const res = await xiaocanQrStartAction();
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setImage(res.image);
    setSessionId(res.sessionId);
    setStatus('waiting');
  }, []);

  useEffect(() => {
    if (!sessionId || stoppedRef.current) {
      return;
    }
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled || stoppedRef.current) {
        return;
      }
      const res = await xiaocanQrPollAction(sessionId);
      if (cancelled) {
        return;
      }
      if (!res.ok) {
        setError(res.error);
        stoppedRef.current = true;
        clearInterval(timer);
        return;
      }
      setStatus(res.state);
      if (!PENDING_STATES.has(res.state)) {
        stoppedRef.current = true;
        clearInterval(timer);
        if (res.state === 'done') {
          setSucceeded(true);
          router.refresh();
        } else if (res.state === 'error' && res.detail) {
          // 有具体原因就显示具体原因，别让用户对着「扫码失败」猜
          setError(`扫码失败：${res.detail}`);
        } else {
          setError(STATUS_LABEL[res.state] ?? `扫码失败（${res.state}）`);
        }
      }
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId, router]);

  const submitManual = async () => {
    setManualBusy(true);
    setManualMessage('');
    const result = await xiaocanManualBindAction(manualText);
    setManualBusy(false);
    setManualMessage(result.msg);
    if (result.ok) {
      setManualText('');
      router.refresh();
    }
  };

  const statusText = succeeded
    ? '登录成功，账号已写入'
    : (error || STATUS_LABEL[status] || (status ? `状态：${status}` : '尚未开始'));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-fit rounded-md border bg-muted/30 p-1">
        <button type="button" onClick={() => setMode('qr')} className={`rounded px-3 py-1.5 text-sm ${mode === 'qr' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}>扫码登录</button>
        <button type="button" onClick={() => setMode('manual')} className={`rounded px-3 py-1.5 text-sm ${mode === 'manual' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}>手动导入</button>
      </div>

      {mode === 'manual' ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            账号凭据
            <textarea
              value={manualText}
              onChange={event => setManualText(event.target.value)}
              rows={6}
              placeholder="备注#小蚕UserId#silk_id#token；多个账号用 @ 或换行分隔"
              className="w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-primary"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={manualBusy || !manualText.trim()} onClick={() => void submitManual()} className="rounded-md bg-brand-gradient px-4 py-2 text-sm text-white disabled:opacity-50">
              {manualBusy ? '导入中…' : '验证并导入'}
            </button>
            <span className="text-xs text-muted-foreground">支持原版四段格式；同一 silk_id 再导入会更新凭据。</span>
          </div>
          {manualMessage && <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">{manualMessage}</div>}
        </div>
      ) : (
        <div className="flex flex-col gap-5 sm:flex-row">
      <div className="flex shrink-0 flex-col items-center gap-2">
        <div className="
          flex size-44 items-center justify-center overflow-hidden rounded-md
          border bg-white p-1
        "
        >
          {image
            ? (
                <img
                  src={image}
                  alt="小蚕扫码登录二维码"
                  className="size-full object-contain"
                />
              )
            : <span className="px-3 text-center text-xs text-slate-500">未生成二维码</span>}
        </div>
        <button
          type="button"
          onClick={start}
          disabled={loading}
          className="
            rounded-md bg-brand-gradient px-4 py-2 text-sm text-white shadow-sm
            hover:opacity-90
            disabled:opacity-60
          "
        >
          {loading ? '生成中…' : image ? '重新生成二维码' : '开始扫码登录'}
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">当前状态：</span>
          <span className={succeeded
            ? 'text-emerald-600'
            : `text-muted-foreground`}
          >
            {statusText}
          </span>
        </div>

        {error && !succeeded && (
          <div className="
            rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs
            text-red-700
            dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300
          "
          >
            ⚠️
            {' '}
            {error}
          </div>
        )}

        <ol className="
          mt-1 list-decimal space-y-1 pl-5 text-xs text-muted-foreground
        "
        >
          <li>点「开始扫码登录」，二维码由小蚕服务实时生成</li>
          <li>用要托管的小蚕账号扫码，并在手机上确认登录</li>
          <li>确认成功后本页自动刷新，账号进入「账号管理」</li>
          <li>二维码有效期 5 分钟，过期请点「重新生成二维码」</li>
        </ol>
      </div>
        </div>
      )}
    </div>
  );
};
