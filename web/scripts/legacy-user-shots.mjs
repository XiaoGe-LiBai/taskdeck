/**
 * 老版 SPA（archive/复刻版-legacy-frontend，端口 8100）的「普通用户视角」截图。
 *
 * 用法：node scripts/legacy-user-shots.mjs [baseUrl]
 * 默认用演示用户 demo@example.com / demo12345 登录，逐个用户端页面截图。
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? 'http://127.0.0.1:8100').replace(/\/$/, '');
const OUT = resolve(__dirname, '../../截图');
const EMAIL = 'demo@example.com';
const PASSWORD = 'demo12345';

const pages = [
  ['home', '01-首页'],
  ['accounts', '02-我的账号'],
  ['points', '03-积分'],
  ['card-purchase', '04-卡密购买'],
  ['billing', '05-账单'],
  ['check-in', '06-每日签到'],
  ['invite', '07-邀请好友'],
  ['profile', '08-个人资料'],
  ['bind', '09-绑定账号'],
];

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/#/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/用户视角-00-登录.png` });

  await page.fill('input[type="email"], input[name="email"], input[placeholder*="邮箱"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"], input[placeholder*="密码"]', PASSWORD);
  await page.click('button[type="submit"], button:has-text("登录")');
  await page.waitForTimeout(2000);
  console.log('登录后 URL:', page.url());

  for (const [path, name] of pages) {
    await page.goto(`${BASE}/#/${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/用户视角-${name}.png`, fullPage: true });
    console.log(`截图 ${name} → #/${path}`);
  }

  // 顺手看一眼普通用户点「管理」会怎样
  await page.goto(`${BASE}/#/admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const body = await page.locator('body').innerText();
  console.log('普通用户访问 #/admin 结果片段:', body.replace(/\s+/g, ' ').slice(0, 120));
  await page.screenshot({ path: `${OUT}/用户视角-10-访问管理端.png` });

  await browser.close();
  console.log('输出目录:', OUT);
};

main().catch((error) => {
  console.error('截图失败:', error.message);
  process.exit(1);
});
