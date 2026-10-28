/**
 * 8100 老站用户端：多断点布局回归
 * 硬指标：无横向溢出；≥1100px 时内容进入两列网格；<1100px 时保持单列；登录页保持窄表单。
 *
 * 用法：node scripts/verify-old-responsive.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../截图/响应式审计');
mkdirSync(OUT, { recursive: true });

const OLD = 'http://127.0.0.1:8100';
const USER = ['demo@example.com', 'demo12345'];

const ROUTES = ['home', 'accounts', 'points', 'billing', 'invite', 'lottery', 'check-in', 'bind', 'card-purchase'];
const BREAKPOINTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'small-desktop', width: 1024, height: 900 },
  { name: 'desktop', width: 1440, height: 900 },
];

let failed = 0;
const check = (title, pass, detail = '') => {
  if (!pass) {
    failed++;
  }
  console.log(`${pass ? '✅' : '❌'} ${title}${detail ? `  (${detail})` : ''}`);
};

const login = async (page) => {
  await page.goto(`${OLD}/#/login`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${OLD}/#/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.fill('input[type="email"]', USER[0]);
  await page.fill('input[type="password"]', USER[1]);
  await page.click('button.btn-primary');
  await page.waitForTimeout(2200);
};

const measure = page => page.evaluate(() => {
  const de = document.documentElement;
  const shell = document.querySelector('.app-shell');
  const shellW = shell ? Math.round(shell.getBoundingClientRect().width) : null;
  const root = document.querySelector('.page');
  const cs = root ? getComputedStyle(root) : null;
  const kids = root
    ? Array.from(root.children).map(c => ({
        w: Math.round(c.getBoundingClientRect().width),
        top: Math.round(c.getBoundingClientRect().top),
      }))
    : [];
  return {
    overflow: de.scrollWidth - de.clientWidth,
    viewport: de.clientWidth,
    shellW,
    pageDisplay: cs ? cs.display : null,
    pageCols: cs ? cs.gridTemplateColumns : null,
    kids,
  };
});

const run = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });

  for (const bp of BREAKPOINTS) {
    console.log(`\n===== ${bp.name} (${bp.width}px) =====`);
    const ctx = await browser.newContext({ viewport: { width: bp.width, height: bp.height }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await login(page);

    for (const route of ROUTES) {
      await page.goto(`${OLD}/#/${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const m = await measure(page);

      check(`#/${route} 无横向溢出`, m.overflow <= 0, `溢出 ${m.overflow}px`);

      if (m.pageDisplay) {
        if (bp.width >= 1100) {
          const twoCols = m.pageDisplay === 'grid' && (m.pageCols || '').split(' ').length === 2;
          check(`#/${route} 大屏为两列网格`, twoCols, `${m.pageDisplay} / ${m.pageCols}`);
        } else {
          check(`#/${route} 中小屏保持单列`, m.pageDisplay !== 'grid', `display=${m.pageDisplay}`);
        }
        const overWide = m.kids.filter(k => k.w > (m.shellW ?? 0) + 1);
        check(`#/${route} 子元素不超出外壳`, overWide.length === 0, `${overWide.length} 个超宽`);
      }

      if (bp.width === 1440 || bp.width === 390) {
        await page.screenshot({ path: `${OUT}/改造后-8100-${route}-${bp.name}.png`, fullPage: false });
      }
    }

    // 登录页宽度
    const p2 = await ctx.newPage();
    await p2.goto(`${OLD}/#/login`, { waitUntil: 'networkidle' });
    await p2.evaluate(() => localStorage.clear());
    await p2.goto(`${OLD}/#/login`, { waitUntil: 'networkidle' });
    await p2.waitForTimeout(500);
    const loginShell = await p2.evaluate(() => {
      const s = document.querySelector('.app-shell');
      return s ? Math.round(s.getBoundingClientRect().width) : null;
    });
    check('登录页保持窄表单（<= 460px）', (loginShell ?? 0) > 0 && (loginShell ?? 0) <= 460, `${loginShell}px`);
    if (bp.width === 1440) {
      await p2.screenshot({ path: `${OUT}/改造后-8100-login-desktop.png`, fullPage: false });
    }

    await ctx.close();
  }

  await browser.close();
  console.log(failed === 0 ? '\n🎉 8100 多断点回归全部通过' : `\n❌ 有 ${failed} 项未通过`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error('验证执行出错:', e);
  process.exit(1);
});
