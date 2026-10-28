'use client';

import { useRef, useState, useTransition } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { deleteSiteLogoAction, toggleSiteLogoAction, uploadSiteLogoAction } from '@/features/panel/actions';
import { cn } from '@/utils/Helpers';

/**
 * 站点图标设置：预览 + 启用开关 + 上传 / 删除。
 *
 * 为什么不写成 `<form>`：这块要塞进「系统设置」那张主表单里，而 HTML 不允许
 * form 嵌套 form。所以改成「按钮 + startTransition 里直接 await server action」。
 * 组件内的按钮必须显式 `type="button"`，否则会被当成主表单的提交按钮，
 * 点一下就把设置页所有字段一起保存了。
 *
 * 状态口径（和后端一致）：
 *   - 有文件 + 开关开 → 用自定义图
 *   - 有文件 + 开关关 → 用内置标，文件留着随时能开回来
 *   - 没文件          → 用内置标，开关置灰
 */
export const SiteLogoSettings = (props: {
  /** 是否已上传过文件 */
  hasLogo: boolean;
  /** 后端里那个开关的值 */
  enabled: boolean;
  /**
   * 已上传图标的地址（`/site-icon?v=…`）。**与你上传过就有值，与开关无关** ——
   * 设置页要在「传了但开关关着」时也能预览，所以不能按生效状态给。
   */
  logoUrl: string;
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState('');
  // 上传成功后先本地点亮预览，不必等整页重新渲染
  const [optimisticOn, setOptimisticOn] = useState(props.enabled);

  const run = (job: () => Promise<string>) => {
    startTransition(async () => {
      const message = await job();
      setFeedback(message);
    });
  };

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const payload = new FormData();
    payload.set('file', file);
    setOptimisticOn(true); // 后端「上传即启用」，预览跟着走
    run(() => uploadSiteLogoAction(payload));
    // 清掉 value：同一个文件连传两次也要能触发 change
    event.target.value = '';
  };

  const ok = feedback.startsWith('ok:');
  const error = feedback.startsWith('error:') ? feedback.slice(6) : '';
  // 开关就是「当前该显示哪张图」的唯一判据；没上传过时开关必然为关
  const showImage = optimisticOn;

  return (
    <div className="flex flex-col gap-4">
      {/* 预览 */}
      <div className="flex flex-wrap items-center gap-4">
        <BrandMark
          size={56}
          logoUrl={showImage ? props.logoUrl : ''}
          className="shadow-sm"
        />

        <div className="min-w-0 text-xs text-muted-foreground">
          {!props.hasLogo && '还没上传，当前用的是内置图标（托管鸭）。'}
          {props.hasLogo && (optimisticOn ? '正在使用你上传的图标。' : '已上传，但开关关着，仍显示内置图标。')}
          <div className="mt-1">建议用正方形、底色不透明、边长 256px 以上的 PNG。</div>
        </div>
      </div>

      {/* 启用开关 */}
      <label
        className={cn(
          `
            flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5
            text-sm
          `,
          !props.hasLogo && 'opacity-60',
        )}
      >
        <button
          type="button"
          role="switch"
          aria-checked={optimisticOn}
          aria-label="使用自定义站点图标"
          disabled={pending || !props.hasLogo}
          onClick={() => {
            const next = !optimisticOn;
            setOptimisticOn(next);
            run(() => toggleSiteLogoAction(next));
          }}
          className={cn(
            `
              relative inline-flex h-5 w-9 shrink-0 items-center rounded-full
              transition-colors
              disabled:cursor-not-allowed
            `,
            optimisticOn ? 'bg-primary' : 'bg-input',
          )}
        >
          <span
            className={cn(
              `
                inline-block size-4 rounded-full bg-white shadow-sm
                transition-transform
              `,
              optimisticOn ? 'translate-x-4.5' : 'translate-x-0.5',
            )}
          />
        </button>
        <span>
          使用自定义站点图标
          <span className="ml-2 text-xs text-muted-foreground">
            开启后全站、浏览器标签页、邮件抬头都用它
          </span>
        </span>
      </label>

      {/* 上传 / 删除 */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={onPick}
          className="hidden"
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => fileRef.current?.click()}
          className="
            rounded-md border px-4 py-2 text-sm font-medium
            hover:bg-accent
            disabled:opacity-60
          "
        >
          {pending ? '处理中…' : props.hasLogo ? '重新上传' : '选择图片上传'}
        </button>

        {props.hasLogo && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setOptimisticOn(false);
              run(() => deleteSiteLogoAction());
            }}
            className="
              rounded-md border border-destructive/40 px-4 py-2 text-sm
              font-medium text-destructive
              hover:bg-destructive/10
              disabled:opacity-60
            "
          >
            删除图标
          </button>
        )}

        <span className="text-xs text-muted-foreground">支持 PNG / JPG / WebP，2MB 以内</span>
      </div>

      {ok && (
        <div className="
          rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600
        "
        >
          {feedback.slice(3)}
        </div>
      )}
      {error && (
        <div className="
          rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive
        "
        >
          {error}
        </div>
      )}

      <div className="
        rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground
      "
      >
        邮件抬头里的图标需要
        <b>绝对地址</b>
        ，所以只有在下面填了「站点对外地址」之后
        邮件才会带上图标；没填时邮件用纯样式的抬头，一样能正常阅读。
      </div>
    </div>
  );
};
