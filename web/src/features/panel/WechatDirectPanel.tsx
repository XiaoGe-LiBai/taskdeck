'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createWechatPairAction,
  fetchWechatScriptAction,
  pollWechatPairAction,
} from './actions/wechatDirect';

/**
 * 电脑微信直连。
 *
 * 原理与开源版一致：读 `WeChatAppEx.exe` 进程内存里的 JWT。
 * 区别是——服务端在 Linux 容器里读不到你电脑的微信进程，所以由面板发一次性配对码，
 * 你在本机双击脚本后它自己把 token 报回来。
 */
export const WechatDirectPanel = () => {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [expiresIn, setExpiresIn] = useState(0);
  const [created, setCreated] = useState(0);
  const [state, setState] = useState<'idle' | 'waiting' | 'done' | 'expired'>('idle');
  const [nickname, setNickname] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const stoppedRef = useRef(false);

  const start = useCallback(async () => {
    setBusy(true);
    setMessage('');
    setNickname('');
    const result = await createWechatPairAction();
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setCode(result.code);
    setExpiresIn(result.expiresIn);
    setCreated(Date.now());
    setState('waiting');
    stoppedRef.current = false;
  }, []);

  // 轮询：脚本上报成功后这里会看到 done
  useEffect(() => {
    if (!code || state !== 'waiting') {
      return;
    }
    const timer = setInterval(async () => {
      if (stoppedRef.current) {
        return;
      }
      const result = await pollWechatPairAction(code);
      if (!result.ok) {
        return;
      }
      if (result.state === 'done') {
        stoppedRef.current = true;
        clearInterval(timer);
        setState('done');
        setNickname(result.nickname);
        router.refresh();
        return;
      }
      if (result.state === 'expired') {
        stoppedRef.current = true;
        clearInterval(timer);
        setState('expired');
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [code, state, router]);

  const download = async () => {
    const result = await fetchWechatScriptAction(code);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    const blob = new Blob([result.text], { type: 'text/x-python;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wechat_direct_${code}.py`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage('脚本已下载：在 Windows 上双击运行即可');
  };

  const remain = expiresIn
    ? Math.max(0, Math.floor((created + expiresIn * 1000 - Date.now()) / 1000))
    : 0;

  return (
    <div className="mt-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">电脑微信直连（免扫码）</div>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            先在电脑微信里打开一次「小蚕霸王餐」小程序，再到 Windows 上运行下面的脚本，
            它会从微信小程序进程内存里取出 token 自动填进来。不需要扫码、不用装证书、不断网。
          </p>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={busy}
          className="
            rounded-md border px-3 py-1.5 text-xs font-medium
            hover:bg-muted
            disabled:opacity-50
          "
        >
          {busy ? '生成中…' : code ? '重新生成配对码' : '生成配对码'}
        </button>
      </div>

      {code && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-muted-foreground">配对码</span>
            <span className="
              rounded-md border bg-muted/40 px-3 py-1 font-mono text-base
              tracking-widest
            "
            >
              {code}
            </span>
            {state === 'waiting' && (
              <span className="text-xs text-muted-foreground">
                约
                {' '}
                {Math.ceil(remain / 60) || 1}
                {' '}
                分钟内有效，等待脚本上报…
              </span>
            )}
            {state === 'done' && (
              <span className="text-xs text-emerald-600">
                已入库：
                {nickname || '小蚕账号'}
              </span>
            )}
            {state === 'expired' && (
              <span className="text-xs text-rose-600">配对码已过期，请重新生成</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void download()}
              className="
                rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-medium
                text-white shadow-sm
              "
            >
              下载 Windows 脚本
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(code);
                setMessage('配对码已复制');
              }}
              className="
                rounded-md border px-3 py-1.5 text-xs
                hover:bg-muted
              "
            >
              复制配对码
            </button>
          </div>
          <ol className="
            mt-1 list-decimal space-y-1 pl-5 text-xs text-muted-foreground
          "
          >
            <li>电脑微信里打开「小蚕霸王餐」小程序并保持登录</li>
            <li>下载脚本，放到 Windows 上双击运行（需要 Python 3.8+）</li>
            <li>脚本提示「上报成功」后，本页会自动出现账号</li>
          </ol>
        </div>
      )}

      {message && <div className="mt-2 text-xs text-muted-foreground">{message}</div>}
    </div>
  );
};
