'use server';

import type { PanelSettings } from '@/types/Panel';
import { revalidatePath } from 'next/cache';
import { panelSend, panelUpload } from '@/libs/PanelApi';

/**
 * 系统设置域（站点参数 + 邮件服务）。
 *
 * 统一约定：所有写操作 server action 都返回 "ok:..." / "error:..." 字符串，
 * 客户端表单（ActionForm / StateForm / FeedbackButton）据此展示结果，
 * 杜绝「点了按钮没反应但其实失败了」的静默失败。
 */
type _prev = string;

export async function saveSettingsAction(
  _state: _prev,
  formData: FormData,
): Promise<string> {
  const payload: Partial<PanelSettings> = {
    site_name: String(formData.get('site_name') ?? ''),
    site_url: String(formData.get('site_url') ?? ''),
    register_enabled: formData.get('register_enabled') ? 'true' : 'false',
    referral_rate_bps: String(formData.get('referral_rate_bps') ?? ''),
    checkin_daily_reward: String(formData.get('checkin_daily_reward') ?? ''),
    checkin_rewards: String(formData.get('checkin_rewards') ?? ''),
    checkin_gamble_rewards: String(formData.get('checkin_gamble_rewards') ?? ''),
    checkin_makeup_cost: String(formData.get('checkin_makeup_cost') ?? ''),
    checkin_makeup_quota: String(formData.get('checkin_makeup_quota') ?? ''),
    level_refresh_enabled: String(formData.get('level_refresh_enabled') ?? 'true'),
    level_refresh_hour: String(formData.get('level_refresh_hour') ?? ''),
    smtp_host: String(formData.get('smtp_host') ?? ''),
    smtp_port: String(formData.get('smtp_port') ?? ''),
    smtp_ssl: formData.get('smtp_ssl') ? 'true' : 'false',
    smtp_user: String(formData.get('smtp_user') ?? ''),
    smtp_sender: String(formData.get('smtp_sender') ?? ''),
    smtp_from_name: String(formData.get('smtp_from_name') ?? ''),
  };

  // 授权码留空 = 不修改：后端不回显明文，空值只能理解为「这栏没动」
  const smtpPassword = String(formData.get('smtp_password') ?? '').trim();
  if (smtpPassword) {
    payload.smtp_password = smtpPassword;
  }

  const result = await panelSend<Record<string, unknown>>('PUT', '/admin/settings', payload);
  revalidatePath('/dashboard/settings');

  return result.ok ? 'ok:设置已保存' : `error:${result.msg}`;
}

/**
 * 发送测试邮件：先把表单里刚填的 SMTP 配置落库，再让后端真发一封，
 * 免得出现「测的是旧配置、测通了但线上还是发不出去」。
 */
export async function testMailAction(_state: _prev, formData: FormData): Promise<string> {
  const saved = await saveSettingsAction('', formData);
  if (!saved.startsWith('ok:')) {
    return saved;
  }

  const to = String(formData.get('smtp_test_to') ?? '').trim();
  const result = await panelSend<{ sent: boolean; to: string; dry_run?: boolean; error?: string }>(
    'POST',
    '/admin/settings/mail-test',
    { to },
  );
  if (!result.ok || !result.data) {
    return `error:${result.msg || '测试发信失败'}`;
  }
  if (result.data.sent) {
    return `ok:测试邮件已发往 ${result.data.to}，去收件箱（含垃圾箱）看看`;
  }
  return `error:${result.data.error || '测试发信失败'}`;
}

/**
 * 站点图标（自定义 logo）域。
 *
 * 这三个 action 不走 useActionState，而是由 SiteLogoSettings 组件在
 * startTransition 里直接 await —— 因为系统设置的主表单已经是一个 <form>，
 * 里面不能再嵌套 <form>（HTML 不允许），所以图标这块改成「按钮 + 手动调用」。
 *
 * 每个动作都要 revalidate 到根 layout：站点图标不止在设置页用，侧栏、登录页、
 * 落地页、浏览器标签页都会跟着变。
 */

/** 上传自定义站点图标；后端会统一转成 PNG 并自动启用 */
export async function uploadSiteLogoAction(formData: FormData): Promise<string> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return 'error:请先选择一张图片';
  }

  const payload = new FormData();
  payload.set('file', file);

  const result = await panelUpload<{ width: number; height: number }>('/admin/site-logo', payload);
  if (!result.ok) {
    return `error:${result.msg || '上传失败'}`;
  }

  revalidatePath('/dashboard/settings');
  revalidatePath('/', 'layout');
  return `ok:图标已更新（${result.data?.width ?? '?'}×${result.data?.height ?? '?'}），全站已切换`;
}

/** 启用 / 停用自定义图标（停用不清除已上传的文件） */
export async function toggleSiteLogoAction(enabled: boolean): Promise<string> {
  const result = await panelSend<Record<string, unknown>>('PUT', '/admin/settings', {
    site_logo_enabled: enabled ? 'true' : 'false',
  });
  if (!result.ok) {
    return `error:${result.msg || '切换失败'}`;
  }

  revalidatePath('/dashboard/settings');
  revalidatePath('/', 'layout');
  return enabled ? 'ok:已启用自定义图标' : 'ok:已切回内置图标';
}

/** 删除已上传的图标并关闭开关 */
export async function deleteSiteLogoAction(): Promise<string> {
  const result = await panelSend<Record<string, unknown>>('DELETE', '/admin/site-logo');
  if (!result.ok) {
    return `error:${result.msg || '删除失败'}`;
  }

  revalidatePath('/dashboard/settings');
  revalidatePath('/', 'layout');
  return 'ok:已删除自定义图标，全站回到内置标';
}
