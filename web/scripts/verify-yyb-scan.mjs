/**
 * 验证 YYB 扫码加号已接进面板：
 * 点「开始扫码加号」后应拿到 data:image 二维码，且状态为等待扫码。
 *
 * 用法：node scripts/verify-yyb-scan.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../截图');
mkdirSync(OUT, { recursive: true });

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', ADMIN[0]);
  await page.fill('input[name="password"]', ADMIN[1]);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 30000 });

  await page.goto(`${BASE}/dashboard/yyb`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const startBtn = page.locator('button:has-text("开始扫码加号")');
  check('页面上有「开始扫码加号」按钮', (await startBtn.count()) === 1);

  await startBtn.click();
  // 二维码由 YYB 实时生成，给足时间
  await page.waitForTimeout(6000);

  const img = await page.evaluate(() => {
    const el = document.querySelector('img[alt="微信扫码加号"]');
    return el ? { src: el.getAttribute('src') ?? '', w: el.clientWidth, h: el.clientHeight } : null;
  });
  check('二维码图片已渲染', img !== null, img ? `${img.w}x${img.h}` : '未找到 img');
  check('二维码是服务端代理回传的 data URL', (img?.src ?? '').startsWith('data:image/'), (img?.src ?? '').slice(0, 30));

  const bodyText = await page.locator('main').innerText();
  check('状态显示为等待扫码', bodyText.includes('等待扫码'), '');
  check('出现重新生成入口', (await page.locator('button:has-text("重新生成二维码")').count()) === 1);

  await page.screenshot({ path: `${OUT}/应用宝-扫码加号.png`, fullPage: false });

  await browser.close();
  console.log(failed === 0 ? '\n🎉 扫码链路通过' : `\n❌ 有 ${failed} 项未通过`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e); process.exit(1);
});
