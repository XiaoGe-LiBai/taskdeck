/**
 * 巡检：逐个打开面板页面，收集客户端/服务端报错。
 * 用来确认「Functions cannot be passed directly to Client Components」到底出在哪一页。
 *
 * 用法：node scripts/check-pages.mjs [baseUrl]
 */
import { chromium } from '@playwright/test';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const PATHS = [
  '/dashboard',
  '/dashboard/yyb',
  '/dashboard/yyb/bindings',
  '/dashboard/yyb/jobs',
  '/dashboard/yyb/settings',
  '/dashboard/panels',
  '/dashboard/logs',
  '/dashboard/accounts',
  '/dashboard/users',
  '/dashboard/settings',
];

const main = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', 'admin@example.com');
  await page.fill('input[name="password"]', 'admin12345');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  for (const path of PATHS) {
    const errors = [];
    const onError = e => errors.push(e.message.split('\n')[0]);
    page.on('pageerror', onError);
    const resp = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    page.off('pageerror', onError);

    const body = await page.locator('body').innerText().catch(() => '');
    const crashed = body.includes('Application error') || body.includes('client-side exception');
    const flag = errors.length || crashed ? '❌' : '✅';
    console.log(`${flag} ${path}  HTTP ${resp?.status()}`);
    for (const message of errors.slice(0, 2)) {
      console.log(`     ${message.slice(0, 140)}`);
    }
  }

  await browser.close();
};

main().catch((error) => {
  console.error('巡检失败:', error.message);
  process.exit(1);
});
