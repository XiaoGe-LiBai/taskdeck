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
await page.waitForTimeout(500);
await page.evaluate(() => {
  const modal = [...document.querySelectorAll('div.fixed')].find(el => el.textContent?.includes('抢单位置设置'));
  [...(modal?.querySelectorAll('button') ?? [])].find(b => b.textContent?.trim() === '关闭')?.click();
  localStorage.setItem('xc_geo_location', JSON.stringify({ cityCode: '440300', cityName: '深圳市', addressName: 'x', lat: '22.54', lon: '114.06', source: 'manual', updatedAt: Date.now() }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const headers = await page.locator('table thead th').allInnerTexts();
const firstRow = await page.evaluate(() => {
  const tr = document.querySelector('table tbody tr');
  if (!tr) return null;
  return [...tr.querySelectorAll('td')].map(td => td.innerText.split('\n').map(s => s.trim()).filter(Boolean));
});
const tabs = await page.getByRole('button', { name: /附近店铺|大牌券专享|美团同店双返利|预约与监听/ }).allInnerTexts();
// 打开参数抽屉确认还是右侧滑出
await page.evaluate(() => {
  const card = [...document.querySelectorAll('article')].find(el => el.textContent?.includes('整点红包雨'));
  [...(card?.querySelectorAll('button') ?? [])].find(b => b.textContent?.trim() === '参数')?.click();
});
await page.waitForTimeout(800);
const box = await page.getByTestId('param-drawer').boundingBox();
console.log(JSON.stringify({ headers, firstRow, tabs, drawer: box && { x: Math.round(box.x), w: Math.round(box.width) }, errors }, null, 2));
await browser.close();
