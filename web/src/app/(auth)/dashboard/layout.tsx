import type { Metadata } from 'next';
import type { PanelStats } from '@/types/Panel';
import { redirect } from 'next/navigation';
import { BrandMark } from '@/components/BrandMark';
import { DotGrid, SwarmCursor } from '@/components/reactbits';
import { DashboardSidebar } from '@/features/panel/DashboardSidebar';
import { DeniedNotice } from '@/features/panel/DeniedNotice';
import { MobileNav } from '@/features/panel/MobileNav';
import { PageTransition } from '@/features/panel/PageTransition';
import { UserMenu } from '@/features/panel/UserMenu';
import { backendDown, getSiteInfo, PANEL_API_URL, panelGet, panelMe } from '@/libs/PanelApi';

type DashboardLayoutProps = {
  children: React.ReactNode;
};

export async function generateMetadata(): Promise<Metadata> {
  const { site_name: siteName } = await getSiteInfo();

  return {
    title: `${siteName} · 管理后台`,
    description: '多项目任务托管：小蚕、应用宝与自定义脚本的账号、卡密、积分与青龙任务',
  };
}

export default async function DashboardLayout(props: DashboardLayoutProps) {
  // 实时用户信息（不再用登录时的 cookie 快照）；token 失效直接回登录页
  const user = await panelMe();
  if (!user) {
    redirect('/sign-in');
  }
  const role = user.role;

  // 后端是否可达：不可达时页面照常渲染（数据用快照/空），顶部给出明确提示
  const down = await backendDown();

  const [stats, yybAccounts, siteInfo] = await Promise.all([
    role === 'admin' ? panelGet<PanelStats>('/admin/stats') : Promise.resolve(null),
    panelGet<{ id: number }[]>('/yyb/accounts'),
    getSiteInfo(),
  ]);

  const badges: Record<string, number> = role === 'admin'
    ? {
        accounts: stats?.accounts ?? 0,
        users: stats?.users ?? 0,
        cards: stats?.cards_total ?? 0,
        ...(yybAccounts ? { yyb: yybAccounts.length } : {}),
      }
    : {
        ...(yybAccounts ? { yyb: yybAccounts.length } : {}),
      };

  return (
    <div className="flex h-screen overflow-hidden bg-brand-soft">
      <DashboardSidebar
        badges={badges as Record<string, number>}
        role={role}
        siteName={siteInfo.site_name}
        logoUrl={siteInfo.logo_url}
      />

      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <header className="
          z-30 flex shrink-0 items-center justify-between gap-3 border-b
          bg-card/90 px-4 py-3 backdrop-blur-sm
          lg:px-6
        "
        >
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav
              role={role}
              badges={badges as Record<string, number>}
              siteName={siteInfo.site_name}
              logoUrl={siteInfo.logo_url}
            />
            <div className="
              flex items-center gap-2
              lg:hidden
            "
            >
              <BrandMark size={26} logoUrl={siteInfo.logo_url} />
              <span className="
                max-w-40 truncate text-brand-gradient text-sm font-semibold
                whitespace-nowrap
              "
              >
                {siteInfo.site_name}
              </span>
            </div>
          </div>

          <UserMenu
            email={user.email}
            nickname={user.nickname}
            role={user.role}
          />
        </header>

        <main className="
          relative min-h-0 flex-1 overflow-y-auto px-4 py-6
          lg:px-6
        "
        >
          <DotGrid className="fixed z-0" />
          {/* 跟随光标的粒子群背景层：fixed z-0 固定在内容（relative z-10）之下，
              叠加 pointer-events:none，既不挡点击也不会盖住卡片。
              几何参数用官方默认，只收小 size / 压低 opacity —— 品牌橙不透明时在浅色主题上偏重。 */}
          <SwarmCursor
            className="fixed z-0"
            color="#fa8927"
            accentColor="#fa3569"
            size={7}
            opacity={0.6}
          />
          {down && (
            <div className="
              relative mb-4 rounded-lg border border-amber-500/30
              bg-amber-500/10 px-4 py-3 text-sm text-amber-600
              dark:text-amber-400
            "
            >
              ⚠️ 无法连接后端服务（
              {PANEL_API_URL}
              ）。页面展示的是缓存/空数据，
              请确认 Flask 后端已启动（
              <code className="font-mono">cd server &amp;&amp; ./run.sh</code>
              ）后刷新。
            </div>
          )}
          <DeniedNotice />
          <PageTransition>{props.children}</PageTransition>
        </main>
      </div>
    </div>
  );
}

export const dynamic = 'force-dynamic';
