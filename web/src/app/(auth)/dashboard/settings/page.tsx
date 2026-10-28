import type { PanelSettings } from '@/types/Panel';
import { SettingsForm } from '@/features/panel/SettingsForm';
import { PageTitle } from '@/features/panel/Ui';
import { panelGet } from '@/libs/PanelApi';

/**
 * 系统设置（管理员视角）。
 *
 * 页面壳只负责取数与标题；分组卡片与左栏锚点导航都在 SettingsForm 里
 * （它需要客户端状态做滚动高亮），避免把纯展示的标题混进客户端组件。
 */
export default async function SettingsPage() {
  const settings = await panelGet<PanelSettings>('/admin/settings');

  return (
    <>
      <PageTitle
        title="系统设置"
        description="站点基础、签到与积分、等级刷新、邮件服务，保存后立即写入后端"
      />

      <SettingsForm
        settings={settings}
        logoUrl={settings?.site_logo_url ?? ''}
      />
    </>
  );
}

export const dynamic = 'force-dynamic';
