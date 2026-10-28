/**
 * 用系统 Chrome 走一遍 SaaS 版面板并截图，产出到 ../截图/
 *
 * 用法：
 *   node scripts/screenshots.mjs [baseUrl]
 * 依赖：@playwright/test（已装）+ 本机 google-chrome（channel: 'chrome'，不下载浏览器）
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const OUT = resolve(__dirname, '../../截图');

const pages = [
  { path: '/', name: '01-首页', note: '营销首页' },
  { path: '/sign-in', name: '02-登录', note: '登录页' },
  { path: '/dashboard', name: '03-仪表盘', note: '仪表盘' },
  { path: '/dashboard/accounts', name: '04-账号订单', note: '账号订单' },
  { path: '/dashboard/cards', name: '05-卡密管理', note: '卡密管理' },
  { path: '/dashboard/users', name: '06-用户管理', note: '用户管理' },
  { path: '/dashboard/panels', name: '07-青龙面板', note: '青龙面板' },
  { path: '/dashboard/logs', name: '08-任务日志', note: '任务日志' },
  { path: '/dashboard/announcements', name: '09-公告管理', note: '公告管理' },
  { path: '/dashboard/yyb', name: '10-应用宝账号', note: '应用宝账号' },
  { path: '/dashboard/yyb/bindings', name: '11-应用宝绑定', note: '脚本×账号绑定矩阵' },
  { path: '/dashboard/yyb/jobs', name: '12-应用宝运行', note: '应用宝运行管理' },
  { path: '/dashboard/yyb/settings', name: '13-应用宝设置', note: '应用宝设置' },
  { path: '/dashboard/settings', name: '14-系统设置', note: '系统设置' },
];

const main = async () => {
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  // 登录一次，之后的页面都带 cookie
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/02-登录.png` });
  await page.fill('input[name="email"]', 'admin@example.com');
  await page.fill('input[name="password"]', 'admin12345');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 30000 });
  console.log('登录成功 →', page.url());

  for (const item of pages) {
    if (item.path === '/sign-in') {
      continue;
    }
    await page.goto(`${BASE}${item.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    // 账号页：展开第一行的任务开关与报名面板，方便看出管理动作
    if (item.path === '/dashboard/accounts') {
      const toggles = page.locator('button', { hasText: '任务开关' });
      if (await toggles.count()) {
        await toggles.first().click();
        await page.waitForTimeout(300);
      }
    }
    await page.screenshot({ path: `${OUT}/${item.name}.png`, fullPage: true });
    console.log(`截图 ${item.name} (${item.note}) → ${item.path}`);
  }

  await browser.close();
  console.log('全部截图输出到:', OUT);
};

main().catch((error) => {
  console.error('截图失败:', error);
  process.exit(1);
});
