import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const token = readFileSync('/tmp/tok.txt', 'utf8').trim();
const base = 'http://127.0.0.1:13002';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
await ctx.addCookies([{ name: 'xc_panel_token', value: token, url: base }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${base}/dashboard/xiaocan`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
// 关掉首次的定位弹窗
await page.evaluate(() => {
  const modal = [...document.querySelectorAll('div.fixed')].find(el => el.textContent?.includes('抢单位置设置'));
  [...(modal?.querySelectorAll('button') ?? [])].find(b => b.textContent?.trim() === '关闭')?.click();
});
await page.waitForTimeout(400);
// 注入定位后刷新列表
await page.evaluate(() => {
  localStorage.setItem('xc_geo_location', JSON.stringify({ cityCode: '440300', cityName: '深圳市', addressName: 'x', lat: '22.54', lon: '114.06', source: 'manual', updatedAt: Date.now() }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

const rows = await page.evaluate(() => {
  const card = [...document.querySelectorAll('div')].find(el => el.textContent?.trim().startsWith('霸王餐抢单与预约'));
  const rowEls = [...document.querySelectorAll('div.flex.items-start.gap-3.rounded-lg.border')];
  return rowEls.slice(0, 2).map(el => el.innerText.split('\n').map(t => t.trim()).filter(Boolean));
});
console.log(JSON.stringify({ rows, errors }, null, 2));
await browser.close();
