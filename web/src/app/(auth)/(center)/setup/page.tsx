import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SetupForm } from '@/features/auth/SetupForm';
import { getInstallationStatus } from '@/libs/Installation';
import { getSiteInfo } from '@/libs/PanelApi';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function SetupPage() {
  const initialized = await getInstallationStatus();
  if (initialized) {
    redirect('/sign-in');
  }
  if (initialized === null) {
    return <p role="alert">服务暂时不可用，请稍后刷新页面。</p>;
  }
  const { site_name: siteName } = await getSiteInfo();
  return <SetupForm siteName={siteName} />;
}
