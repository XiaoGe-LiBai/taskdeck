/**
 * 验证「每日签到 / 赌狗签到」双签到与互斥：
 *  1. 系统设置页有两个配置项
 *  2. 用户端签到页同时展示两个入口
 *  3. 实际点一次赌狗签到 → 出现加减分结果
 *  4. 签完后两个入口都锁定，且提示用的是哪一种
 *
 * 用法：node scripts/verify-checkin-kinds.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../截图');
mkdirSync(OUT, { recursive: true });

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const ADMIN = ['admin@example.com', 'admin12345'];

let failed = 0;
const check = (title, pass, detail = '') => {
  if (!pass) {
    failed++;
  }
  console.log(`${pass ? '✅' : '❌'} ${title}${detail ? `  (${detail})` : ''}`);
};

const login = async (page, [email, password]) => {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 30000 });
  await page.waitForTimeout(700);
};

const run = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await login(page, ADMIN);

  /* ---- 1. 管理端配置项 ---- */
  console.log('\n=== 1. 管理端配置 ===');
  await page.goto(`${BASE}/dashboard/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  check('有「每日签到 · 固定奖励」输入框', (await page.locator('input[name="checkin_daily_reward"]').count()) === 1);
  check('有「赌狗签到 · 奖励池」输入框', (await page.locator('input[name="checkin_gamble_rewards"]').count()) === 1);
  const settingsText = await page.locator('main').innerText();
  check('页面说明两者互斥', settingsText.includes('每天只能选一种'));

  /* ---- 2. 用户端两个入口 ---- */
  console.log('\n=== 2. 签到页两个入口 ===');
  await page.goto(`${BASE}/dashboard/checkin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  let body = await page.locator('main').innerText();
  check('展示「每日签到」入口', body.includes('每日签到'));
  check('展示「赌狗签到」入口', body.includes('赌狗签到'));
  check('说明二选一', body.includes('二选一') || body.includes('另一种'));

  const dailyBtn = page.locator('button[data-kind="daily"]');
  const gambleBtn = page.locator('button[data-kind="gamble"]');

  if (body.includes('今日待签')) {
    console.log('  （今日未签，实际点一次赌狗签到）');
    await gambleBtn.click();
    await page.waitForTimeout(3000);
    body = await page.locator('main').innerText();
    const gotResult = /\+\d+ 分/.test(body) || /扣掉/.test(body) || /0 分/.test(body);
    check('赌狗签到给出加减分结果', gotResult, body.replace(/\s+/g, ' ').match(/(赌狗签到[^，。]*)/)?.[0] ?? '');
    check('签完后提示已用哪种签到', body.includes('今日已通过'));
    check('每日签到入口被锁定', await dailyBtn.isDisabled());
    check('赌狗签到入口被锁定', await gambleBtn.isDisabled());
  } else {
    console.log('  （今日已签，只校验锁定态）');
    check('每日签到入口处于锁定', await dailyBtn.isDisabled());
    check('赌狗签到入口处于锁定', await gambleBtn.isDisabled());
    check('提示今日已用哪种签到', body.includes('今日已通过'));
  }

  await page.screenshot({ path: `${OUT}/签到-双签到互斥.png`, fullPage: false });

  await browser.close();
  console.log(failed === 0 ? '\n🎉 双签到互斥验证通过' : `\n❌ 有 ${failed} 项未通过`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e); process.exit(1);
});
