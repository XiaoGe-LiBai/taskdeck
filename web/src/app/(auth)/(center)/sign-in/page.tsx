import { redirect } from 'next/navigation';
import { SignInForm } from '@/features/auth/SignInForm';
import { getSiteInfo, panelMe } from '@/libs/PanelApi';

/** 只接受站内相对路径，挡掉 `?redirect_url=https://evil.com` 这类开放重定向 */
function safeRedirect(target?: string) {
  const value = (target ?? '').trim();
  return value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}

export default async function SignInPage(props: {
  searchParams: Promise<{ redirect_url?: string }>;
}) {
  const { redirect_url: redirectUrl } = await props.searchParams;

  // 已登录（token 真有效）就别停在登录页。
  // 关键：这里用的是**真实校验**（panelMe 会问后端），而不是"cookie 在不在" ——
  // token 过期时 panelMe 返回 null，照常渲染登录表单，不会和中间件互相弹成死循环。
  const user = await panelMe();
  if (user) {
    redirect(safeRedirect(redirectUrl));
  }

  const { site_name: siteName, logo_url: logoUrl } = await getSiteInfo();

  return <SignInForm redirectUrl={redirectUrl} siteName={siteName} logoUrl={logoUrl} />;
}
