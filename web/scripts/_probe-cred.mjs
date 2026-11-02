import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const token = readFileSync('/tmp/tok.txt', 'utf8').trim();
const base = 'http://127.0.0.1:13002';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
await ctx.addCookies([{ name: 'xc_panel_token', value: token, url: base }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(`${base}/dashboard/accounts`, { waitUntil: 'networkidle' });
const close = page.getByRole('button', { name: '关闭' });
if (await close.count()) { await close.click(); await page.waitForTimeout(300); }

const btn = page.getByRole('button', { name: '复制小蚕凭据' }).first();
const btnCount = await page.getByRole('button', { name: '复制小蚕凭据' }).count();
await btn.click();
await page.waitForTimeout(900);
const clip = await page.evaluate(() => navigator.clipboard.readText());
const segs = clip.split('#');

// 头像菜单里不该再有本站 cookie 复制
await page.locator('header button').last().click();
await page.waitForTimeout(300);
const stale = await page.getByRole('button', { name: /复制本站登录 Cookie/ }).count();

console.log(JSON.stringify({
  btnCount,
  segments: segs.length,
  nick: segs[0], userId: segs[1], silk: segs[2], tokenLen: (segs[3] || '').length,
  staleCookieItem: stale,
  errors,
}, null, 2));
await browser.close();
