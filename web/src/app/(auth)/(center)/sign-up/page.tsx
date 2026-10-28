import { SignUpForm } from '@/features/auth/SignUpForm';
import { getSiteInfo } from '@/libs/PanelApi';

export default async function SignUpPage() {
  const { logo_url: logoUrl } = await getSiteInfo();

  return <SignUpForm logoUrl={logoUrl} />;
}
