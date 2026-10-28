import type { Metadata, Viewport } from 'next';
import { getSiteInfo } from '@/libs/PanelApi';
import '@/styles/global.css';

/**
 * 站点名称与图标都来自后端 settings（管理员在「系统设置 → 站点与注册」改），
 * 所以标题和图标必须动态生成 —— 之前这里写死的字符串导致改了设置也不生效。
 */
export async function generateMetadata(): Promise<Metadata> {
  const { site_name: siteName, logo_url: logoUrl } = await getSiteInfo();

  // 管理员传了自己的图标就用它（经 /site-icon 转发，浏览器拿不到后端内网地址）；
  // 否则用内置的静态一套
  const builtinIcons: Metadata['icons'] = [
    { rel: 'apple-touch-icon', url: '/apple-touch-icon.png' },
    { rel: 'icon', type: 'image/png', sizes: '32x32', url: '/favicon-32x32.png' },
    { rel: 'icon', type: 'image/png', sizes: '16x16', url: '/favicon-16x16.png' },
    { rel: 'icon', url: '/favicon.ico' },
  ];

  return {
    title: siteName,
    applicationName: siteName,
    appleWebApp: { title: siteName },
    icons: logoUrl
      ? [
          { rel: 'icon', url: logoUrl },
          { rel: 'apple-touch-icon', url: logoUrl },
        ]
      : builtinIcons,
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout(props: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{props.children}</body>
    </html>
  );
}
