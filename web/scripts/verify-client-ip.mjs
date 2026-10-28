/**
 * 验证真实客户端 IP 透传链路：浏览器 → Next.js → Flask。
 *
 * 思路：Playwright 伪造一个 X-Forwarded-For 源地址，登录后检查
 * 「登陆记录」与「用户管理」里显示的是否是这个地址，而不是 127.0.0.1。
 *
 * 用法：node scripts/verify-client-ip.mjs
 */
import { chromium } from '@playwright/test';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const FAKE_IP = '203.0.113.45';
const ADMIN = ['admin@example.com', 'admin12345'];

let failed = 0;
const check = (title, pass, detail = '') => {
  if (!pass) {
    failed++;
  }
  console.log(`${pass ? '✅' : '❌'} ${title}${detail ? `  (${detail})` : ''}`);
};

const run = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
    extraHTTPHeaders: { 'X-Forwarded-For': FAKE_IP },
  });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', ADMIN[0]);
  await page.fill('input[name="password"]', ADMIN[1]);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 30000 });
  await page.waitForTimeout(1200);

  await page.goto(`${BASE}/dashboard/login-logs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const logsText = await page.locator('main').innerText();
  check('登陆记录显示真实客户端 IP', logsText.includes(FAKE_IP), `期望包含 ${FAKE_IP}`);

  const latest = await page.evaluate(() => {
    const first = document.querySelector('tbody tr td:nth-child(2)');
    return first ? first.textContent?.trim() : null;
  });
  check('最新一条登录记录 IP 正确', latest === FAKE_IP, `实际 ${latest}`);

  await page.goto(`${BASE}/dashboard/users`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const usersText = await page.locator('main').innerText();
  check('用户管理「上次登录 IP」同步', usersText.includes(FAKE_IP));

  await browser.close();
  console.log(failed === 0 ? '\n🎉 IP 透传链路正常' : `\n❌ 有 ${failed} 项未通过`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e); process.exit(1);
});
