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
const close = page.getByRole('button', { name: '关闭' });
if (await close.count()) { await close.click(); await page.waitForTimeout(300); }

const tabs = await page.locator('button[aria-pressed]').allInnerTexts();
const initialCards = await page.locator('article').count();
await page.locator('button[aria-pressed]').nth(1).click();
await page.waitForTimeout(400);
const secondCards = await page.locator('article').count();
const pressed = await page.locator('button[aria-pressed="true"]').innerText();

// 第三组 → 双返利参数（6 项，含 3 个 checkbox）
await page.locator('button[aria-pressed]').nth(2).click();
await page.waitForTimeout(400);
const titles = await page.locator('article h3').allInnerTexts();
const idx = titles.findIndex(t => t.includes('同店双返利'));
await page.locator('article').nth(idx).getByRole('button', { name: '参数' }).click();
await page.waitForTimeout(900);
const fields = await page.locator('[id^="param-"]').count();
const checks = await page.locator('input[type="checkbox"][id^="param-"]').count();
const numbers = await page.locator('input[type="number"][id^="param-"]').count();
const texts = await page.locator('input[type="text"][id^="param-"]').count();
const selects = await page.locator('select[id^="param-"]').count();

// 保存（勾选框改一个）
await page.locator('#param-active_hours_only').uncheck();
await page.getByRole('button', { name: '保存参数' }).click();
await page.waitForTimeout(1200);
const toast = await page.locator('text=/参数已保存/').count();

// 重新打开确认
await page.locator('article').nth(idx).getByRole('button', { name: '参数' }).click();
await page.waitForTimeout(900);
const reChecked = await page.locator('#param-active_hours_only').isChecked();

console.log(JSON.stringify({ tabs, initialCards, secondCards, pressed, fields, checks, numbers, texts, selects, toast, reChecked, errors }, null, 2));
await browser.close();
