import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const token = readFileSync('/tmp/tok.txt', 'utf8').trim();
const base = 'http://127.0.0.1:13002';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'xc_panel_token', value: token, url: base }]);
await ctx.addInitScript(() => {
  localStorage.setItem('xc_geo_location', JSON.stringify({ cityCode: '440300', cityName: '深圳市', addressName: 'x', lat: '22.54', lon: '114.06', source: 'manual', updatedAt: Date.now() }));
});
const page = await ctx.newPage();
const logs = [];
page.on('console', m => logs.push(`${m.type()}: ${m.text()}`.slice(0, 200)));
page.on('pageerror', e => logs.push(`PAGEERROR: ${String(e)}`.slice(0, 300)));
await page.goto(`${base}/dashboard/xiaocan`, { waitUntil: 'networkidle' });
const close = page.getByRole('button', { name: '关闭', exact: true });
if (await close.count()) { await close.click(); await page.waitForTimeout(300); }
const articles = await page.locator('article').count();
const heads = await page.locator('article h3').allInnerTexts();
const card = page.locator('article').filter({ hasText: '整点红包雨' }).first();
const n = await card.count();
if (n) {
  await card.getByRole('button', { name: '参数' }).click();
  await page.waitForTimeout(1500);
}
const drawer = await page.getByTestId('param-drawer').count();
const headCount = await page.locator('text=配置任务参数').count();
const bodyTail = (await page.locator('body').innerText()).slice(0, 400);
await page.screenshot({ path: '/tmp/diag.png', fullPage: false });
console.log(JSON.stringify({ articles, cardCount: n, drawer, headCount, bodyTail, logs: logs.slice(0, 6) }, null, 2));
await browser.close();
