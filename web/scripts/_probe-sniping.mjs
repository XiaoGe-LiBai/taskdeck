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
// 首次进入会强制弹「抢单位置设置」，关掉它才能点到下面的卡片
await page.waitForTimeout(600);
await page.evaluate(() => {
  const modal = [...document.querySelectorAll('div.fixed')]
    .find(el => el.textContent?.includes('抢单位置设置'));
  const btn = modal && [...modal.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === '关闭');
  btn?.click();
});
await page.waitForTimeout(400);

const snipingTabs = await page.getByRole('button', { name: /附近店铺|大牌券专享|美团同店双返利|预约与监听/ }).allInnerTexts();
const grabButtons = await page.getByRole('button', { name: '立即抢单' }).count();

// 卡片「参数」按钮可能被固定顶栏挡住，用脚本直接触发点击
await page.evaluate(() => {
  const card = [...document.querySelectorAll('article')]
    .find(el => el.textContent?.includes('整点红包雨'));
  const btn = card && [...card.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === '参数');
  btn?.click();
});
await page.waitForTimeout(900);
const drawerEl = page.getByTestId('param-drawer');
const box = await drawerEl.boundingBox();
const vp = page.viewportSize();
const drawer = box && {
  x: Math.round(box.x), width: Math.round(box.width), height: Math.round(box.height),
  flushRight: Math.abs(box.x + box.width - vp.width) < 2,
  fullHeight: Math.abs(box.height - vp.height) < 2,
};
const fields = await page.locator('[id^="param-"]').count();
await page.evaluate(() => {
  const drawer = document.querySelector('[data-testid="param-drawer"]');
  const btn = drawer && [...drawer.querySelectorAll('button')]
    .find(b => b.textContent?.trim() === '关闭');
  btn?.click();
});
await page.waitForTimeout(400);
const closed = await page.getByTestId('param-drawer').count();

console.log(JSON.stringify({ snipingTabs, grabButtons, drawer, fields, closed, errors }, null, 2));
await browser.close();
