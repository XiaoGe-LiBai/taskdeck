'use client';

import type { YybAccount } from '@/types/Panel';
import Link from 'next/link';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  yybGetCodeDirectAction,
  yybRefreshDirectAction,
  yybUpdateRemarkDirectAction,
} from '@/features/panel/yybActions';

const PRESET_APPIDS = [
  { name: '风云再起xx', appid: 'wxbc00cc79a68e2305' },
  { name: '恰恰会员俱乐部', appid: 'wxc72491b6cd007333' },
];

export const YybAccountRowActions = (props: { account: YybAccount }) => {
  const { account } = props;

  // 刷新状态
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTip, setRefreshTip] = useState('');

  // 改备注弹窗状态
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [remarkValue, setRemarkValue] = useState(account.remark || '');
  const [remarkLoading, setRemarkLoading] = useState(false);
  const [remarkError, setRemarkError] = useState('');

  // 测试取码弹窗状态
  const [codeOpen, setCodeOpen] = useState(false);
  const [appId, setAppId] = useState(PRESET_APPIDS[0]?.appid || '');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeResult, setCodeResult] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 执行保活刷新
  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshTip('');
    try {
      const res = await yybRefreshDirectAction(account.id);
      setRefreshTip(res.ok ? '已刷新' : (res.msg || '失败'));
      setTimeout(setRefreshTip, 3000, '');
    } catch {
      setRefreshTip('请求失败');
      setTimeout(setRefreshTip, 3000, '');
    } finally {
      setRefreshing(false);
    }
  };

  // 执行修改备注
  const handleSaveRemark = async (e: React.FormEvent) => {
    e.preventDefault();
    setRemarkLoading(true);
    setRemarkError('');
    try {
      const res = await yybUpdateRemarkDirectAction(account.id, remarkValue);
      if (res.ok) {
        setRemarkOpen(false);
      } else {
        setRemarkError(res.msg || '保存失败');
      }
    } catch (err: any) {
      setRemarkError(err?.message || '保存失败');
    } finally {
      setRemarkLoading(false);
    }
  };

  // 执行测试取码
  const handleGetCode = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
    }
    const cleanAppId = appId.trim();
    if (!cleanAppId) {
      setCodeError('请填写小程序 AppID');
      return;
    }
    setCodeLoading(true);
    setCodeResult(null);
    setCodeError(null);
    setCopied(false);

    try {
      const res = await yybGetCodeDirectAction(account.id, cleanAppId);
      if (res.ok && res.code) {
        setCodeResult(res.code);
      } else {
        setCodeError(res.msg || '未获取到 code');
      }
    } catch (err: any) {
      setCodeError(err?.message || '网络请求异常');
    } finally {
      setCodeLoading(false);
    }
  };

  // 复制 Code
  const handleCopy = async () => {
    if (!codeResult) {
      return;
    }
    try {
      await navigator.clipboard.writeText(codeResult);
      setCopied(true);
      setTimeout(setCopied, 2000, false);
    } catch {
      // 回退方案
      const textarea = document.createElement('textarea');
      textarea.value = codeResult;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(setCopied, 2000, false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5 whitespace-nowrap">
        {/* 保活刷新 */}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="
            inline-flex h-7 items-center rounded-md border border-input
            bg-background px-2.5 text-xs font-medium
            hover:bg-muted
            disabled:opacity-50
          "
          title="立即向应用宝检测账号存活"
        >
          {refreshing ? '刷新中…' : (refreshTip || '保活刷新')}
        </button>

        {/* 测试取码按钮 */}
        <button
          type="button"
          onClick={() => {
            setCodeOpen(true);
            setCodeResult(null);
            setCodeError(null);
            setCopied(false);
          }}
          className="
            inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs
            font-medium text-primary-foreground
            hover:bg-primary/90
          "
        >
          测试取码
        </button>

        {/* 改备注按钮 */}
        <button
          type="button"
          onClick={() => {
            setRemarkOpen(true);
            setRemarkValue(account.remark || '');
            setRemarkError('');
          }}
          className="
            inline-flex h-7 items-center rounded-md border border-input
            bg-background px-2 text-xs text-muted-foreground
            hover:bg-muted hover:text-foreground
          "
        >
          改备注
        </button>

        {/* 小程序活动配置入口 */}
        <Link
          href={`/dashboard/yyb/activities?account=${account.id}`}
          className="
            inline-flex h-7 items-center rounded-md border border-input
            bg-background px-2 text-xs font-medium text-foreground
            hover:border-primary hover:bg-primary/5 hover:text-primary
          "
          title="配置该账号参与哪些小程序任务"
        >
          🎯 活动
        </Link>
      </div>

      {/* 修改备注弹窗 */}
      {remarkOpen && (
        <div className="
          fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4
        "
        >
          <div className="
            w-full max-w-sm rounded-lg border bg-card p-5 shadow-2xl
          "
          >
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-semibold">修改微信账号备注</h3>
              <button
                type="button"
                onClick={() => setRemarkOpen(false)}
                className="
                  text-xs text-muted-foreground
                  hover:text-foreground
                "
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRemark} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  账号：
                  {account.remark && account.nickname && account.nickname !== account.remark
                    ? `${account.remark}（微信：${account.nickname}）`
                    : (account.remark || account.nickname || account.display_name)}
                </label>
                <Input
                  value={remarkValue}
                  onChange={e => setRemarkValue(e.target.value)}
                  placeholder="例如：主号 / 备用1 / 小米10"
                  className="h-9 text-xs"
                  autoFocus
                />
              </div>

              {remarkError && (
                <div className="text-xs text-destructive">{remarkError}</div>
              )}

              <div className="flex justify-end gap-2 border-t pt-2">
                <button
                  type="button"
                  onClick={() => setRemarkOpen(false)}
                  className="
                    rounded-md border px-3 py-1.5 text-xs text-muted-foreground
                    hover:bg-muted
                  "
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={remarkLoading}
                  className="
                    rounded-md bg-primary px-3 py-1.5 text-xs font-medium
                    text-primary-foreground
                    hover:opacity-90
                    disabled:opacity-60
                  "
                >
                  {remarkLoading ? '保存中…' : '保存备注'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 测试取码专属弹窗 */}
      {codeOpen && (
        <div className="
          fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4
        "
        >
          <div className="
            flex w-full max-w-lg flex-col rounded-lg border bg-card shadow-2xl
          "
          >
            {/* Header */}
            <div className="
              flex items-center justify-between border-b px-5 py-3.5
            "
            >
              <div>
                <h3 className="text-sm font-semibold">微信小程序测试取码</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  向应用宝换取真实 wx.login 动态 Code（
                  {account.remark && account.nickname && account.nickname !== account.remark
                    ? `${account.remark} · 微信：${account.nickname}`
                    : (account.remark || account.nickname || account.display_name)}
                  ）
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCodeOpen(false)}
                className="
                  text-sm text-muted-foreground
                  hover:text-foreground
                "
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 p-5">
              {/* AppID 输入与快捷选择 */}
              <div>
                <label className="mb-1.5 block text-xs font-medium">
                  目标小程序 AppID
                </label>
                <div className="flex gap-2">
                  <Input
                    value={appId}
                    onChange={e => setAppId(e.target.value)}
                    placeholder="输入微信小程序 AppID (以 wx 开头)"
                    className="h-9 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleGetCode}
                    disabled={codeLoading || !appId.trim()}
                    className="
                      inline-flex items-center rounded-md bg-primary px-4 py-2
                      text-xs font-medium whitespace-nowrap
                      text-primary-foreground
                      hover:bg-primary/90
                      disabled:opacity-60
                    "
                  >
                    {codeLoading ? '取码中…' : '立即取码'}
                  </button>
                </div>

                {/* 快捷推荐预设 */}
                <div className="
                  mt-2 flex flex-wrap items-center gap-1.5 text-xs
                "
                >
                  <span className="text-muted-foreground">常用预设：</span>
                  {PRESET_APPIDS.map(preset => (
                    <button
                      key={preset.appid}
                      type="button"
                      onClick={() => setAppId(preset.appid)}
                      className={`
                        rounded-sm border px-2 py-0.5 text-[11px]
                        transition-colors
                        ${
                    appId === preset.appid
                      ? 'border-primary bg-primary/10 font-medium text-primary'
                      : `
                        border-border text-muted-foreground
                        hover:bg-muted
                      `
                    }
                      `}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 取码成功展示区 */}
              {codeResult && (
                <div className="
                  space-y-3 rounded-lg border border-emerald-500/30
                  bg-emerald-500/5 p-4
                "
                >
                  <div className="flex items-center justify-between">
                    <div className="
                      flex items-center gap-1.5 text-xs font-medium
                      text-emerald-600
                    "
                    >
                      <span>✅</span>
                      <span>获取成功！微信登录凭证 (Code)</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      有效期约 5 分钟 · 单次换取
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="
                      flex-1 rounded-sm border border-emerald-500/20
                      bg-background p-2.5 font-mono text-xs break-all
                      text-foreground select-all
                    "
                    >
                      {codeResult}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="
                        inline-flex h-9 items-center rounded-md bg-emerald-600
                        px-3 text-xs font-medium whitespace-nowrap text-white
                        hover:bg-emerald-700
                      "
                    >
                      {copied ? '已复制！' : '一键复制'}
                    </button>
                  </div>
                </div>
              )}

              {/* 错误提示区 */}
              {codeError && (
                <div className="
                  rounded-lg border border-destructive/30 bg-destructive/5 p-3.5
                  text-xs text-destructive
                "
                >
                  <div className="mb-1 font-medium">❌ 取码失败：</div>
                  <div>{codeError}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    提示：请检查微信账号协议存活状态或小程序 AppID 是否正确。
                  </div>
                </div>
              )}

              {/* 帮助提示 */}
              <div className="
                space-y-1 rounded-sm border bg-muted/30 p-3 text-xs
                text-muted-foreground
              "
              >
                <div className="font-medium text-foreground">💡 取码测试说明：</div>
                <div>
                  • 点击后应用宝将调用底层协议真实向微信服务器执行一次
                  <code>wx.login</code>
                  {' '}
                  操作。
                </div>
                <div>• 成功获取的 Code 可直接在青龙脚本、第三方接口换取 session_key 或微信 Token。</div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end border-t px-5 py-3">
              <button
                type="button"
                onClick={() => setCodeOpen(false)}
                className="
                  rounded-md border px-4 py-1.5 text-xs text-muted-foreground
                  hover:bg-muted
                "
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
