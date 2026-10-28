import { redirect } from 'next/navigation';

/**
 * 旧的「应用宝专用登录入口」已废弃。
 *
 * 改成单入口登录 + 登录后侧栏切换渠道，这里只做重定向，避免老链接 404。
 */
export default function YybSignInPage() {
  redirect('/sign-in');
}
