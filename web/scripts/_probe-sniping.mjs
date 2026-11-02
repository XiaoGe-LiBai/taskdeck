import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const token = readFileSync('/tmp/tok.txt', 'utf8').trim();
const base = 'http://127.0.0.1:13002';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.addCookies([{ name: 'xc_panel_token', value: token, url: base }]);
await ctx.addInitScript(() => {
  localStorage.setItem('xc_geo_location', JSON.stringify({
    cityCode: '440300', cityName: '深圳市', addressName: '测试定位',
    lat: '22.54', lon: '114.06', source: 'manual', updatedAt: Date.now(),
  }));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${base}/dashboard/xiaocan`, { waitUntil: 'networkidle' });
const close = page.getByRole('button', { name: '关闭', exact: true });
if (await close.count()) { await close.click(); await page.waitForTimeout(300); }

const snipingTabs = await page.getByRole('button', { name: /附近店铺|大牌券专享|美团同店双返利|预约与监听/ }).allInnerTexts();
const grabButtons = await page.getByRole('button', { name: '立即抢单' }).count();

// 参数抽屉位置
const autoTitles = await page.locator('article h3').allInnerTexts();
const card = page.locator('article').filter({ hasText: '整点红包雨' }).first();
await card.getByRole('button', { name: '参数' }).click();
await page.waitForTimeout(800);
const aside = page.getByTestId('param-drawer');
const box = await aside.boundingBox();
const vp = page.viewportSize();
const drawer = box ? { x: Math.round(box.x), width: Math.round(box.width), height: Math.round(box.height), flushRight: Math.abs(box.x + box.width - vp.width) < 2, fullHeight: Math.abs(box.height - vp.height) < 2 } : null;
const fields = await page.locator('[id^="param-"]').count();
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);
const closed = await page.getByTestId('param-drawer').count();

console.log(JSON.stringify({ snipingTabs, grabButtons, drawer, fields, closed, errors }, null, 2));
await browser.close();
