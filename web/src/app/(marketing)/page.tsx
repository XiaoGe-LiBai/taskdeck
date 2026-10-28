import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandMark } from '@/components/BrandMark';
import {
  Aurora,
  BlurText,
  ClickSpark,
  CountUp,
  FadeContent,
  FoldText,
  GridBeams,
  Magnet,
  ShinyText,
  SplitText,
  SpotlightCard,
  StarBorder,
  StrokeText,
  TextPressure,
  TextType,
  TiltCard,
} from '@/components/reactbits';
import { backendDown, getSiteInfo } from '@/libs/PanelApi';

export async function generateMetadata(): Promise<Metadata> {
  const { site_name: siteName } = await getSiteInfo();

  return {
    title: siteName,
    description: '小蚕大牌券 / 应用宝协议 / 自定义脚本任务托管入口',
  };
}

const FEATURES = [
  { icon: '🎫', title: '大牌券托管', desc: '限量/保底/返利多路并发，命中自动通知' },
  { icon: '📱', title: '应用宝协议', desc: '账号保活、取码、扫码加号一站管理' },
  { icon: '🐉', title: '青龙对接', desc: '多面板任务下发、日志回收、定时编排' },
  { icon: '🪙', title: '积分体系', desc: '卡密充值、签到抽奖、邀请返利闭环' },
  { icon: '🧩', title: '脚本市场', desc: '自有仓库 + 第三方仓库统一定价上架' },
  { icon: '📊', title: '执行看板', desc: '多节点运行状态、失败原因实时聚合' },
];

/** 多段落地页：GridBeams hero + TiltCard 功能矩阵 */
export default async function Index() {
  const [down, siteInfo] = await Promise.all([backendDown(), getSiteInfo()]);
  const siteName = siteInfo.site_name;

  return (
    <ClickSpark color="#ff8a00" className="block min-h-svh w-full">
      <div className="relative min-h-svh w-full bg-background">
        {/* ===== Hero：GridBeams + Aurora 双背景 ===== */}
        <section className="relative flex min-h-svh flex-col overflow-hidden">
          <Aurora />
          <GridBeams />

          <div className="
            relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col
            items-center justify-center px-5 text-center
          "
          >
            <BrandMark
              size={64}
              logoUrl={siteInfo.logo_url}
              className="shadow-lg shadow-primary/25"
            />

            <h1 className="mt-6 text-3xl font-semibold tracking-tight">
              <SplitText text={siteName} delay={55} />
            </h1>
            <p className="mt-4 text-base font-medium">
              <TextType
                text={[
                  '大牌券自动抢券',
                  '应用宝账号保活取码',
                  '青龙多面板任务下发',
                  '卡密与积分自动结算',
                ]}
                typingSpeed={70}
                deletingSpeed={30}
                pauseDuration={1500}
                cursorCharacter="▍"
              />
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              <BlurText text="小蚕 / 应用宝 · 任务托管 · 脚本市场 · 积分体系" by="char" delay={35} />
            </p>

            <div
              className={`
                mt-6 inline-flex items-center gap-2 rounded-full border
                bg-card/70 px-3 py-1.5 text-xs font-medium backdrop-blur-sm
              `}
            >
              <span
                className={`
                  size-2 rounded-full
                  ${down ? 'bg-destructive' : 'animate-pulse bg-emerald-500'}
                `}
              />
              {down ? '后端服务未连接' : '后端服务正常'}
            </div>

            <div className="mt-8 w-full max-w-sm">
              <Magnet strength={0.25} max={10} className="w-full">
                <StarBorder speed={5} className="w-full">
                  <Link
                    href="/sign-in"
                    className="
                      block w-full rounded-[10px] bg-brand-gradient px-5 py-3
                      text-sm font-medium text-white shadow-md shadow-primary/20
                      transition-opacity
                      hover:opacity-90
                    "
                  >
                    <ShinyText text="登录面板" speed={2.5} baseColor="#fff" />
                  </Link>
                </StarBorder>
              </Magnet>
            </div>
          </div>
        </section>

        {/* ===== 功能矩阵：TiltCard 3D 倾斜 ===== */}
        <section className="relative mx-auto w-full max-w-5xl px-5 py-20">
          <FadeContent>
            <h2 className="text-center text-xl font-semibold">
              <FoldText
                text="一个后台，托管全部羊毛"
                splitBy="char"
                hinge="top"
                fontSize="1.25rem"
                fontWeight={600}
                color="inherit"
                duration={0.55}
                stagger={0.035}
                creaseShading={0.35}
                trigger="scroll"
              />
            </h2>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              从账号到执行到结算，整条链路都在这一个面板里
            </p>
          </FadeContent>

          <div className="
            mt-10 grid gap-4
            sm:grid-cols-2
            lg:grid-cols-3
          "
          >
            {FEATURES.map((f, i) => (
              <FadeContent key={f.title} delay={i * 90} distance={18}>
                <TiltCard
                  className="rounded-xl border bg-card p-5 brand-shadow"
                  maxTilt={8}
                >
                  <div className="text-2xl">{f.icon}</div>
                  <div className="mt-3 font-semibold">{f.title}</div>
                  <div className="mt-1 text-xs/5 text-muted-foreground">{f.desc}</div>
                </TiltCard>
              </FadeContent>
            ))}
          </div>
        </section>

        {/* ===== 数字带：CountUp + SpotlightCard ===== */}
        <section className="border-y bg-secondary/40 py-12">
          <div className="
            mx-auto grid w-full max-w-4xl grid-cols-3 gap-6 px-5 text-center
          "
          >
            {[
              { to: 210, suffix: '+', label: '托管脚本' },
              { to: 11, suffix: ' 类', label: '小蚕任务' },
              { to: 4, suffix: ' 端', label: '接入渠道' },
            ].map(item => (
              <FadeContent key={item.label}>
                <SpotlightCard className="
                  rounded-xl border bg-card/80 p-5 brand-shadow backdrop-blur-sm
                "
                >
                  <div className="text-3xl font-bold tabular-nums">
                    <span className="text-brand-gradient">
                      <CountUp to={item.to} duration={1400} />
                    </span>
                    {item.suffix}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.label}</div>
                </SpotlightCard>
              </FadeContent>
            ))}
          </div>
        </section>

        {/* ===== 描边绘制收尾字标 + TextPressure ===== */}
        <section className="mx-auto w-full max-w-5xl px-5 py-16">
          <div className="mb-10 flex justify-center text-primary">
            <StrokeText
              text={siteName}
              strokeColor="currentColor"
              fillColor="currentColor"
              strokeWidth={1.6}
              fontSize={72}
              letterSpacing={2}
              drawDuration={1.5}
              trigger="scroll"
            />
          </div>
          <TextPressure
            text="羊毛托管 就用这一个"
            className="text-brand-gradient font-bold"
          />
        </section>

        <div className="border-t py-4 text-center text-xs text-muted-foreground">
          {`© ${new Date().getFullYear()} ${siteName}`}
        </div>
      </div>
    </ClickSpark>
  );
}
