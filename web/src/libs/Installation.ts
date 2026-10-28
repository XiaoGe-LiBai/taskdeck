import { PANEL_API_URL } from './PanelApi';

/** 只返回安装是否完成，不向浏览器泄露初始化码或部署配置。 */
export async function getInstallationStatus(): Promise<boolean | null> {
  try {
    const response = await fetch(`${PANEL_API_URL}/api/setup`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json();
    if (response.ok && result.code === 200 && typeof result.data?.initialized === 'boolean') {
      return result.data.initialized;
    }
  } catch {
    // 无法连接时不能误认为是空库，页面显示暂不可用。
  }
  return null;
}
