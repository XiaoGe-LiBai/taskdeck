import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const token = readFileSync('/tmp/tok.txt', 'utf8').trim();
const base = 'http://127.0.0.1:13002';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
await ctx.addCookies([{ name: 'xc_panel_token', value: token, url: base }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(`${base}/dashboard/xiaocan`, { waitUntil: 'networkidle' });
// 首次进页面会弹「抢单位置设置」，先关掉再操作
const closeBtn = page.getByRole('button', { name: '关闭' });
if (await closeBtn.count()) {
  await closeBtn.click();
  await page.waitForTimeout(300);
}
const lightClass = await page.evaluate(() => document.documentElement.className);
await page.screenshot({ path: '/tmp/theme-light.png' });

// 点主题按钮：system -> light -> dark
const btn = page.getByRole('button', { name: /主题/ });
await btn.click();
await btn.click();
await page.waitForTimeout(400);
const darkClass = await page.evaluate(() => document.documentElement.className);
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.screenshot({ path: '/tmp/theme-dark.png' });

// 刷新后是否保持深色（防闪烁脚本）
await page.reload({ waitUntil: 'networkidle' });
const afterReload = await page.evaluate(() => document.documentElement.className);

// 打开用户菜单，看复制 cookie
const menuBtn = page.locator('header button').last();
console.log('menuBtn text =', (await menuBtn.innerText()).replace(/\s+/g, ' ').slice(0, 40));
await menuBtn.click();
await page.waitForTimeout(200);
const hasCopy = await page.getByRole('button', { name: '复制登录 Cookie' }).count();
await page.getByRole('button', { name: '复制登录 Cookie' }).click();
await page.waitForTimeout(800);
const clip = await page.evaluate(() => navigator.clipboard.readText());
const hint = await page.locator('text=/已复制到剪贴板|复制失败/').count();
await page.screenshot({ path: '/tmp/theme-menu.png' });

console.log(JSON.stringify({
  lightClass, darkClass, afterReload, bg,
  hasCopy, clipLen: clip.length, clipHead: clip.slice(0, 26), hint, errors,
}, null, 2));
await browser.close();
