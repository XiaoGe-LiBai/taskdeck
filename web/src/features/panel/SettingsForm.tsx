'use client';

import type { PanelSettings } from '@/types/Panel';
import { useActionState, useEffect, useState } from 'react';
import { Input, Select } from '@/components/ui/input';
import { Card, Field } from '@/features/panel/Ui';
import { cn } from '@/utils/Helpers';
import { saveSettingsAction, testMailAction, testNotifyChannelAction } from './actions';
import { SiteLogoSettings } from './SiteLogoSettings';

/**
 * 系统设置表单（管理员视角）。
 *
 * 布局：左侧分组锚点导航（桌面端 sticky + 滚动高亮），右侧一列分组卡片。
 * 之所以拆成「导航 + 分组」而不是旧的单列长表单：设置项从 4 个长到 20+ 个，
 * 平铺在一起时找一项要滚很久，也看不出哪些项属于同一类。
 *
 * 仍然是**一个 <form>、一次提交**：后端 `PUT /admin/settings` 只更新请求体里
 * 出现过的 key，所以视觉分组不影响已有契约（未出现的键保持原值）。
 */

const GROUPS = [
  { id: 'basic', label: '站点与注册', icon: '🏠' },
  { id: 'logo', label: '站点图标', icon: '🖼️' },
  { id: 'checkin', label: '签到与积分', icon: '📅' },
  { id: 'level', label: '等级刷新', icon: '📈' },
  { id: 'mail', label: '邮件服务', icon: '📧' },
  { id: 'notify', label: '通知渠道', icon: '🔔' },
] as const;

type GroupId = (typeof GROUPS)[number]['id'];

/** 通知渠道字段的中文名（后端只下发字段名，文案放前端） */
const NOTIFY_FIELD_LABEL: Record<string, string> = {
  url: 'Webhook 地址 / Key',
  secret: '加签密钥',
  token: 'Token',
  chat_id: 'Chat ID',
};

/** 分组卡片：统一「锚点 + 标题 + 说明」外壳，避免四处重复写 section 结构 */
const GroupSection = (props: {
  id: GroupId;
  title: string;
  description: string;
  children: React.ReactNode;
}) => (
  <section id={props.id} className="scroll-mt-6">
    <Card title={props.title} description={props.description}>
      <div className="flex flex-col gap-5">{props.children}</div>
    </Card>
  </section>
);

export const SettingsForm = (props: {
  settings: PanelSettings | null;
  /** 自定义站点图标地址（`/site-icon?v=…`）；空值 = 用内置鸭标 */
  logoUrl?: string;
}) => {
  const [state, formAction, pending] = useActionState<string, FormData>(
    saveSettingsAction,
    '',
  );
  const [mailState, mailAction, testingMail] = useActionState<string, FormData>(
    testMailAction,
    '',
  );
  const [active, setActive] = useState<GroupId>('basic');
  // 通知渠道的测试结果按渠道存：每张卡各自展示，互不覆盖
  const [notifyResults, setNotifyResults] = useState<Record<string, string>>({});
  const [notifyPending, setNotifyPending] = useState('');

  const saved = state.startsWith('ok:');
  const error = state.startsWith('error:') ? state.slice(6) : '';
  const mailOk = mailState.startsWith('ok:');
  const mailError = mailState.startsWith('error:') ? mailState.slice(6) : '';
  const passwordSet = props.settings?.smtp_password_set === 'true';

  // 滚动高亮：以「顶栏下方 40% 内第一块可见的分组」为当前项。
  // 用 IntersectionObserver 而不是 scroll 事件，避免滚动时高频重排。
  useEffect(() => {
    const elements = GROUPS
      .map(group => document.getElementById(group.id))
      .filter((el): el is HTMLElement => !!el);
    if (!elements.length) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) {
          setActive(visible.target.id as GroupId);
        }
      },
      { rootMargin: '-15% 0px -60% 0px', threshold: 0 },
    );
    elements.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const goto = (id: GroupId) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  /** 保存按钮 + 结果提示：左栏（桌面）与底部（移动）复用同一份标记 */
  const submitBlock = (className?: string) => (
    <div className={cn('flex flex-col gap-2', className)}>
      <button
        type="submit"
        disabled={pending}
        className="
          w-full rounded-md bg-primary px-4 py-2 text-sm font-medium
          text-primary-foreground
          hover:opacity-90
          disabled:opacity-60
        "
      >
        {pending ? '保存中…' : '保存全部设置'}
      </button>
      {saved && (
        <div className="
          rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-600
        "
        >
          设置已保存，用户端实时生效
        </div>
      )}
      {error && (
        <div className="
          rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive
        "
        >
          {error}
        </div>
      )}
    </div>
  );

  return (
    <form
      action={formAction}
      className="
        grid section-enter items-start gap-6
        lg:grid-cols-[210px_1fr]
      "
    >
      {/* ------------------------------------------------ 左：分组导航（桌面） */}
      <nav className="
        hidden flex-col gap-1 rounded-lg border bg-card p-3 brand-shadow
        lg:sticky lg:top-6 lg:flex
      "
      >
        <div className="
          px-2 pt-1 pb-2 text-xs font-semibold text-muted-foreground
        "
        >
          设置分组
        </div>
        {GROUPS.map((group) => {
          const on = active === group.id;
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => goto(group.id)}
              className={cn(
                `
                  flex items-center gap-2 rounded-md px-2.5 py-2 text-left
                  text-sm transition-colors
                `,
                on
                  ? 'bg-brand-soft font-medium text-foreground'
                  : `
                    text-muted-foreground
                    hover:bg-muted
                  `,
              )}
            >
              <span aria-hidden>{group.icon}</span>
              <span className="min-w-0 flex-1 truncate">{group.label}</span>
              {on && <span className="h-4 w-0.5 rounded-full bg-brand-gradient" />}
            </button>
          );
        })}

        <div className="mt-2 border-t pt-3">
          {submitBlock()}
        </div>
      </nav>

      {/* ------------------------------------------------ 右：分组卡片 */}
      <div className="flex min-w-0 flex-col gap-6">
        {/* ① 站点与注册 */}
        <GroupSection
          id="basic"
          title="站点与注册"
          description="站点标识、开放注册与邀请返利规则"
        >
          <div className="
            grid gap-5
            sm:grid-cols-2
          "
          >
            <Field label="站点名称" hint="出现在浏览器标题、侧栏字标与邮件抬头里">
              <Input name="site_name" defaultValue={props.settings?.site_name ?? ''} />
            </Field>
            <Field
              label="站点对外地址"
              hint="如 https://panel.example.com。邮件里的图标与链接要用绝对地址，留空则邮件不带图标"
            >
              <Input
                name="site_url"
                placeholder="https://panel.example.com"
                defaultValue={props.settings?.site_url ?? ''}
              />
            </Field>
          </div>

          <Field label="邀请奖励比例（bps）" hint="800 = 8%；下级用积分购买会员时上级按此比例获得返利">
            <Input
              name="referral_rate_bps"
              defaultValue={props.settings?.referral_rate_bps ?? '800'}
            />
          </Field>

          <label className="
            flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5
            text-sm
          "
          >
            <input
              type="checkbox"
              name="register_enabled"
              defaultChecked={props.settings?.register_enabled !== 'false'}
              className="size-4"
            />
            <span>
              允许注册
              <span className="ml-2 text-xs text-muted-foreground">
                关闭后用户端注册入口失效（已注册用户不受影响）
              </span>
            </span>
          </label>
        </GroupSection>

        {/* ② 站点图标（独立开关 + 上传，不随主表单提交） */}
        <GroupSection
          id="logo"
          title="站点图标"
          description="替换内置图标；侧栏、登录页、浏览器标签页与邮件抬头都会跟着变"
        >
          <SiteLogoSettings
            hasLogo={props.settings?.site_logo_has_file === 'true'}
            enabled={props.settings?.site_logo_enabled === 'true'}
            logoUrl={props.logoUrl ?? ''}
          />
        </GroupSection>

        {/* ② 签到与积分 */}
        <GroupSection
          id="checkin"
          title="签到与积分"
          description="用户每日可获得的积分规模与补签成本"
        >
          <div className="
            grid gap-5
            sm:grid-cols-2
          "
          >
            <Field label="每日签到 · 基础奖励（分）" hint="人人都有；会员在此基础上再乘加成倍率">
              <Input
                name="checkin_daily_reward"
                defaultValue={props.settings?.checkin_daily_reward ?? '8'}
              />
            </Field>
            <Field label="连签额外加成（分）" hint="逗号分隔；从连签第 6 天起依次生效，超出取最后一个值">
              <Input
                name="checkin_rewards"
                defaultValue={props.settings?.checkin_rewards ?? '5,7,11,13,15'}
              />
            </Field>
          </div>

          <Field
            label="赌狗签到 · 奖励池（分，逗号分隔）"
            hint="所有用户共用同一个池子、不吃会员倍率；可含负数与 0，余额不足时最多扣到 0"
          >
            <Input
              name="checkin_gamble_rewards"
              defaultValue={props.settings?.checkin_gamble_rewards ?? '-25,-13,-6,0,6,13,25'}
            />
          </Field>

          <div className="
            grid gap-5
            sm:grid-cols-2
          "
          >
            <Field label="补签 · 每次消耗（分）" hint="补签只补记录、保住连签，不发放该日奖励">
              <Input
                name="checkin_makeup_cost"
                defaultValue={props.settings?.checkin_makeup_cost ?? '30'}
              />
            </Field>
            <Field label="补签 · 每月次数上限" hint="所有会员等级相同（固定值）">
              <Input
                name="checkin_makeup_quota"
                defaultValue={props.settings?.checkin_makeup_quota ?? '4'}
              />
            </Field>
          </div>

          <div className="
            rounded-md border bg-muted/40 px-3 py-2 text-xs
            text-muted-foreground
          "
          >
            每日签到与赌狗签到
            <strong className="text-foreground">每天只能选一种</strong>
            ：用其中一种签过之后，另一种要等第二天。
          </div>
        </GroupSection>

        {/* ③ 等级刷新 */}
        <GroupSection
          id="level"
          title="等级刷新"
          description="小蚕账号等级是小蚕平台上的真实等级，会随用户消费变化"
        >
          <div className="
            grid gap-5
            sm:grid-cols-2
          "
          >
            <Field label="每天自动刷新等级" hint="开启后每天定时去小蚕平台把全部账号等级查一遍">
              <Select
                name="level_refresh_enabled"
                defaultValue={props.settings?.level_refresh_enabled ?? 'true'}
              >
                <option value="true">开启（推荐）</option>
                <option value="false">关闭</option>
              </Select>
            </Field>
            <Field label="自动刷新时刻（0-23 点）" hint="建议放凌晨，避开抢券高峰；改完下个整点生效">
              <Input
                name="level_refresh_hour"
                defaultValue={props.settings?.level_refresh_hour ?? '4'}
              />
            </Field>
          </div>
        </GroupSection>

        {/* ④ 邮件服务 */}
        <GroupSection
          id="mail"
          title="邮件服务（SMTP）"
          description="注册验证码、找回密码验证码都走这里发信"
        >
          <div className="
            rounded-md border bg-muted/40 px-3 py-2 text-xs
            text-muted-foreground
          "
          >
            <strong className="text-foreground">主机留空 = 关闭发信</strong>
            ：此时验证码只写进后端
            {' '}
            <code className="font-mono">data/mail.log</code>
            {' '}
            并回传前端，方便本地联调。
          </div>

          <div className="
            grid gap-5
            sm:grid-cols-3
          "
          >
            <Field label="SMTP 主机" hint="126：smtp.126.com · QQ：smtp.qq.com">
              <Input
                name="smtp_host"
                placeholder="smtp.126.com"
                defaultValue={props.settings?.smtp_host ?? ''}
              />
            </Field>
            <Field label="端口" hint="SSL 用 465，STARTTLS 用 587">
              <Input
                name="smtp_port"
                placeholder="465"
                defaultValue={props.settings?.smtp_port ?? '465'}
              />
            </Field>
            <Field label="加密方式">
              <label className="
                flex h-10 items-center gap-2 rounded-md border px-3 text-sm
              "
              >
                <input
                  type="checkbox"
                  name="smtp_ssl"
                  defaultChecked={props.settings?.smtp_ssl !== 'false'}
                  className="size-4"
                />
                SSL
              </label>
            </Field>
          </div>

          <div className="
            grid gap-5
            sm:grid-cols-2
          "
          >
            <Field label="SMTP 账号" hint="一般是完整邮箱地址">
              <Input
                name="smtp_user"
                placeholder="you@126.com"
                defaultValue={props.settings?.smtp_user ?? ''}
              />
            </Field>
            <Field
              label="SMTP 授权码"
              hint={passwordSet ? '已配置；留空即不修改' : '邮箱后台生成的授权码，不是登录密码'}
            >
              <Input
                name="smtp_password"
                type="password"
                placeholder={passwordSet ? '已配置，留空不修改' : '授权码'}
                autoComplete="new-password"
              />
            </Field>
          </div>

          <div className="
            grid gap-5
            sm:grid-cols-2
          "
          >
            <Field label="发件人地址" hint="留空则用 SMTP 账号">
              <Input
                name="smtp_sender"
                placeholder="you@126.com"
                defaultValue={props.settings?.smtp_sender ?? ''}
              />
            </Field>
            <Field label="发件人显示名" hint="收件人看到的发件方名称">
              <Input
                name="smtp_from_name"
                defaultValue={props.settings?.smtp_from_name ?? props.settings?.site_name ?? ''}
              />
            </Field>
          </div>

          <div className="border-t pt-4">
            <div className="mb-2 text-sm font-medium">连通性自检</div>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                name="smtp_test_to"
                placeholder="测试收件邮箱（留空发给发件人自己）"
                className="sm:w-72"
              />
              <button
                type="submit"
                formAction={mailAction}
                formNoValidate
                disabled={testingMail}
                className="
                  rounded-md border px-4 py-2 text-sm font-medium
                  hover:bg-accent
                  disabled:opacity-60
                "
              >
                {testingMail ? '发送中…' : '发送测试邮件'}
              </button>
              <span className="text-xs text-muted-foreground">
                会先保存上面的配置再发信
              </span>
            </div>

            {mailOk && (
              <div className="
                mt-3 rounded-md bg-emerald-500/10 px-3 py-2 text-sm
                text-emerald-600
              "
              >
                {mailState.slice(3)}
              </div>
            )}
            {mailError && (
              <div className="
                mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm break-all
                text-destructive
              "
              >
                {mailError}
              </div>
            )}
          </div>
        </GroupSection>

        <GroupSection
          id="notify"
          title="通知渠道"
          description="新用户注册等事件会推送到这里配置的群机器人；不配则完全不推送"
        >
          <div className="
            rounded-md border bg-muted/40 px-3 py-2 text-xs
            text-muted-foreground
          "
          >
            渠道清单来自后端；
            <strong className="text-foreground">先保存再测试</strong>
            ，测试按钮发的是库里已保存的配置。密钥类字段留空表示不修改。
          </div>

          <div className="flex flex-col gap-4">
            {(props.settings?.notify_channels ?? []).map((channel) => {
              const values = (props.settings ?? {}) as Record<string, string | undefined>;
              const message = notifyResults[channel.key] ?? '';
              const ok = message.startsWith('ok:');
              return (
                <div key={channel.key} className="rounded-md border p-4">
                  <div className="
                    flex flex-wrap items-start justify-between gap-2
                  "
                  >
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {channel.label}
                        {channel.configured && (
                          <span className="
                            ml-2 text-xs font-normal text-emerald-600
                          "
                          >
                            已配置
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{channel.hint}</div>
                    </div>
                    <button
                      type="button"
                      disabled={!channel.configured || notifyPending === channel.key}
                      onClick={async () => {
                        setNotifyPending(channel.key);
                        const result = await testNotifyChannelAction(channel.key);
                        setNotifyResults(prev => ({ ...prev, [channel.key]: result }));
                        setNotifyPending('');
                      }}
                      className="
                        shrink-0 rounded-md border px-3 py-1.5 text-xs
                        font-medium
                        hover:bg-muted
                        disabled:opacity-50
                      "
                    >
                      {notifyPending === channel.key ? '发送中…' : '发送测试'}
                    </button>
                  </div>

                  <div className="
                    mt-3 grid gap-3
                    sm:grid-cols-2
                  "
                  >
                    {channel.fields.map((field) => {
                      const secret = channel.secret_fields.includes(field);
                      const set = values[`notify_${channel.key}_${field}_set`] === 'true';
                      return (
                        <Field
                          key={field}
                          label={NOTIFY_FIELD_LABEL[field] ?? field}
                          hint={secret && set ? '已设置，留空表示不修改' : undefined}
                        >
                          <Input
                            name={`notify_${channel.key}_${field}`}
                            type={secret ? 'password' : 'text'}
                            autoComplete="off"
                            placeholder={secret && set ? '已设置（留空不改）' : ''}
                            defaultValue={secret ? '' : (values[`notify_${channel.key}_${field}`] ?? '')}
                          />
                        </Field>
                      );
                    })}
                  </div>

                  {message && (
                    <div
                      className={cn(
                        'mt-3 rounded-md px-3 py-2 text-xs break-all',
                        ok
                          ? 'bg-emerald-500/10 text-emerald-600'
                          : 'bg-destructive/10 text-destructive',
                      )}
                    >
                      {message.replace(/^(ok|error):/, '')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </GroupSection>
      </div>

      {/* ------------------------------------------------ 移动端：底部吸底保存 */}
      <div className="
        sticky bottom-0 z-10 -mx-1 border-t bg-card/95 px-1 pt-3 pb-2
        backdrop-blur-sm
        lg:hidden
      "
      >
        {submitBlock('flex-col-reverse')}
      </div>
    </form>
  );
};
