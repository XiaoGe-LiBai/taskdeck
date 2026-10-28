/**
 * 3001 后台：全部路由在移动端(390) 与桌面端(1440) 的回归
 * 检查：页面不崩溃、无横向溢出、无控制台错误。
 *
 * 用法：node scripts/verify-dashboard-mobile.mjs
 */
import { chromium } from '@playwright/test';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const ADMIN = ['admin@example.com', 'admin12345'];

const ROUTES = [
  '/dashboard',
  '/dashboard/checkin',
  '/dashboard/accounts',
  '/dashboard/xiaocan',
  '/dashboard/yyb',
  '/dashboard/yyb/bindings',
  '/dashboard/yyb/jobs',
  '/dashboard/yyb/log',
  '/dashboard/yyb/settings',
  '/dashboard/market',
  '/dashboard/profile',
  '/dashboard/login-logs',
  '/dashboard/notifications',
  '/dashboard/projects',
  '/dashboard/panels',
  '/dashboard/users',
  '/dashboard/cards',
  '/dashboard/logs',
  '/dashboard/announcements',
  '/dashboard/settings',
];

const login = async (page) => {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', ADMIN[0]);
  await page.fill('input[name="password"]', ADMIN[1]);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 30000 });
  await page.waitForTimeout(800);
};

let failed = 0;

const run = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });

  for (const width of [390, 1440]) {
    const label = width === 390 ? '移动端' : '桌面端';
    console.log(`\n===== ${label} ${width}px =====`);
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, locale: 'zh-CN' });
    const page = await ctx.newPage();

    const errors = [];
    page.on('pageerror', e => errors.push(e.message.split('\n')[0]));
    await login(page);

    for (const route of ROUTES) {
      const before = errors.length;
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(450);

      const r = await page.evaluate(() => {
        const de = document.documentElement;
        const body = document.body.innerText;
        return {
          overflow: de.scrollWidth - de.clientWidth,
          crashed: body.includes('Application error') || body.includes('client-side exception'),
        };
      });
      const newErrors = errors.length - before;
      const ok = r.overflow <= 0 && !r.crashed && newErrors === 0;
      if (!ok) {
        failed++;
      }
      const notes = [];
      if (r.overflow > 0) {
        notes.push(`溢出 ${r.overflow}px`);
      }
      if (r.crashed) {
        notes.push('页面崩溃');
      }
      if (newErrors > 0) {
        notes.push(`${newErrors} 个 JS 错误: ${errors[before]?.slice(0, 80)}`);
      }
      console.log(`${ok ? '✅' : '❌'} ${route}${notes.length ? `  — ${notes.join('; ')}` : ''}`);
    }

    await ctx.close();
  }

  await browser.close();
  console.log(failed === 0 ? '\n🎉 全部路由通过' : `\n❌ 有 ${failed} 项未通过`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e); process.exit(1);
});
