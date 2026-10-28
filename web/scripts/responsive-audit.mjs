/**
 * 响应式审计：在多个断点下截取 8100（老站用户端）与 3001（新后台）关键页面，
 * 并检测是否存在横向溢出（scrollWidth > clientWidth）。
 *
 * 用法：node scripts/responsive-audit.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../截图/响应式审计');
mkdirSync(OUT, { recursive: true });

const OLD = 'http://127.0.0.1:8100';
const NEW = 'http://127.0.0.1:3001';

const ADMIN = ['admin@example.com', 'admin12345'];
const USER = ['demo@example.com', 'demo12345'];

const BREAKPOINTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const overflow = async page => page.evaluate(() => {
  const de = document.documentElement;
  return { scrollW: de.scrollWidth, clientW: de.clientWidth, over: de.scrollWidth - de.clientWidth };
});

const loginOld = async (page, [email, password]) => {
  await page.goto(`${OLD}/#/login`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${OLD}/#/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button.btn-primary');
  await page.waitForTimeout(2500);
};

const loginNew = async (page, [email, password]) => {
  await page.goto(`${NEW}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 30000 });
  await page.waitForTimeout(1000);
};

const main = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });

  /* ---------- 8100 老站用户端 ---------- */
  console.log('\n===== 8100 老站用户端 =====');
  for (const bp of BREAKPOINTS) {
    const ctx = await browser.newContext({ viewport: { width: bp.width, height: bp.height }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await loginOld(page, USER);
    for (const route of ['home', 'accounts', 'points', 'card-purchase']) {
      await page.goto(`${OLD}/#/${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const o = await overflow(page);
      console.log(`  ${bp.name.padEnd(7)} #/${route.padEnd(14)} 宽 ${o.clientW} / 内容 ${o.scrollW}  横向溢出 ${o.over}`);
      await page.screenshot({ path: `${OUT}/8100-用户端-${route}-${bp.name}.png`, fullPage: false });
    }
    // 老站管理后台
    await loginOld(page, ADMIN);
    await page.goto(`${OLD}/#/admin`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const oa = await overflow(page);
    console.log(`  ${bp.name.padEnd(7)} #/admin          宽 ${oa.clientW} / 内容 ${oa.scrollW}  横向溢出 ${oa.over}`);
    await page.screenshot({ path: `${OUT}/8100-老后台-${bp.name}.png`, fullPage: false });
    await ctx.close();
  }

  /* ---------- 3001 新后台 ---------- */
  console.log('\n===== 3001 新后台 =====');
  for (const bp of BREAKPOINTS) {
    const ctx = await browser.newContext({ viewport: { width: bp.width, height: bp.height }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await loginNew(page, ADMIN);
    for (const route of ['/dashboard', '/dashboard/accounts', '/dashboard/users', '/dashboard/checkin']) {
      await page.goto(`${NEW}${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      const o = await overflow(page);
      console.log(`  ${bp.name.padEnd(7)} ${route.padEnd(19)} 宽 ${o.clientW} / 内容 ${o.scrollW}  横向溢出 ${o.over}`);
      await page.screenshot({ path: `${OUT}/3001-${route.replace(/\//g, '_')}-${bp.name}.png`, fullPage: false });
    }
    await ctx.close();
  }

  await browser.close();
  console.log(`\n截图输出目录：${OUT}`);
};

main().catch((e) => {
  console.error('审计失败:', e);
  process.exit(1);
});
