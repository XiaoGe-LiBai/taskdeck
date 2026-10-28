/**
 * 后台 UI 实测：侧栏上下分布 + 项目管理（定价 / 隐藏 / 授权）。
 *
 * 用法：node scripts/verify-panel-ui.mjs [baseUrl]
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const OUT = resolve(__dirname, '../../截图');
mkdirSync(OUT, { recursive: true });

const PANEL_ADMIN = ['admin@example.com', 'admin12345'];
const XIAOCAN_USER = ['demo@example.com', 'demo12345'];

const login = async (context, page, [email, password]) => {
  await context.clearCookies();
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  return page.url();
};

const navText = async page => (await page.locator('nav').first().innerText()).replace(/\n+/g, ' | ').trim();

const main = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();
  let failed = 0;
  const check = (label, ok, detail) => {
    if (!ok) {
      failed += 1;
    }
    console.log(`${ok ? '✅' : '❌'} ${label}${detail ? `  ${detail}` : ''}`);
  };

  /* ---------------- 侧栏：上下分布 ---------------- */
  await login(context, page, PANEL_ADMIN);
  let nav = await navText(page);
  check('侧栏同时含小蚕 + 应用宝 + 平台三块', nav.includes('小蚕 · 大牌券') && nav.includes('应用宝 · 协议服务') && nav.includes('平台'), '');
  check('小蚕视图下小蚕块标「当前」', nav.indexOf('小蚕 · 大牌券') < nav.indexOf('当前'), '');
  check('平台块有项目管理入口', nav.includes('项目管理'), '');
  await page.screenshot({ path: `${OUT}/面板-01-侧栏上下分布.png`, fullPage: true });

  await page.goto(`${BASE}/dashboard/yyb`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  nav = await navText(page);
  const yybPos = nav.indexOf('应用宝 · 协议服务');
  check('切到应用宝视图后该块成为当前', yybPos >= 0 && nav.indexOf('当前', yybPos) > yybPos, nav.slice(0, 90));
  await page.screenshot({ path: `${OUT}/面板-02-应用宝视图.png`, fullPage: true });

  /* ---------------- 项目：定价 / 隐藏 / 授权 ---------------- */
  await page.goto(`${BASE}/dashboard/projects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  let rows = await page.locator('table tbody tr').count();
  check('小蚕项目 10 行', rows === 10, `${rows} 行`);
  await page.screenshot({ path: `${OUT}/面板-03-项目管理-小蚕.png`, fullPage: true });

  await page.click('button:has-text("应用宝 · 协议服务")');
  await page.waitForTimeout(800);
  rows = await page.locator('table tbody tr').count();
  check('切到应用宝后 72 行', rows === 72, `${rows} 行`);
  await page.screenshot({ path: `${OUT}/面板-04-项目管理-应用宝.png`, fullPage: true });

  // 改一个小蚕项目的价格并保存
  await page.click('button:has-text("小蚕 · 大牌券")');
  await page.waitForTimeout(600);
  const firstPrice = page.locator('table tbody tr').first().locator('input[type="number"]');
  const before = await firstPrice.inputValue();
  const target = before === '7' ? '9' : '7';
  await firstPrice.fill(target);
  await page.waitForTimeout(200);
  check('改动提示出现', (await page.locator('text=项未保存').count()) > 0, '');
  await page.click('button:has-text("保存改动")');
  await page.waitForTimeout(2500);
  const savedMsg = await page.locator('text=已保存').first().innerText().catch(() => '(没看到提示)');
  check('保存成功', savedMsg.includes('已保存'), savedMsg.trim());

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const after = await page.locator('table tbody tr').first().locator('input[type="number"]').inputValue();
  check('刷新后价格保留', after === target, `${before} → ${after}`);

  // 恢复原值
  await page.locator('table tbody tr').first().locator('input[type="number"]').fill(before);
  await page.click('button:has-text("保存改动")');
  await page.waitForTimeout(2000);
  console.log('（已把价格恢复成原值）');

  /* ---------------- 普通用户：看不到管理项 ---------------- */
  await login(context, page, XIAOCAN_USER);
  nav = await navText(page);
  check('普通用户侧栏无项目管理/用户管理', !nav.includes('项目管理') && !nav.includes('用户管理'), nav);
  check('普通用户仍能看到应用宝块', nav.includes('应用宝 · 协议服务'), '');

  await browser.close();
  console.log(`\n失败项：${failed === 0 ? '0（全部符合预期）' : failed}`);
  process.exit(failed ? 1 : 0);
};

main().catch((error) => {
  console.error('实测失败:', error.message);
  process.exit(1);
});
