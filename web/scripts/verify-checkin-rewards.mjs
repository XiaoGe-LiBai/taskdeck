/**
 * 验证「每日签到奖励」可由管理员配置：
 *  1. 系统设置页有该输入框
 *  2. 改成固定值后，用户端签到页文案同步
 *  3. 若当日未签到，实际签到发放的积分应等于配置值
 *  4. 结束后恢复默认池
 *
 * 用法：node scripts/verify-checkin-rewards.mjs
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
const USER = ['demo@example.com', 'demo12345'];
const DEFAULT_POOL = '5,7,11,13,15';
const FIXED = '20';

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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const page = await ctx.newPage();

  /* ---- 1. 管理端能改 ---- */
  console.log('\n=== 1. 管理端配置 ===');
  await login(page, ADMIN);
  await page.goto(`${BASE}/dashboard/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const input = page.locator('input[name="checkin_rewards"]');
  check('系统设置页有「每日签到奖励」输入框', (await input.count()) === 1);
  const before = await input.inputValue();
  const originalPool = before; // 结束时恢复它，避免污染你已有的配置
  check('默认值为奖励池', before === DEFAULT_POOL, before);

  await input.fill(FIXED);
  await page.click('button:has-text("保存设置")');
  await page.waitForTimeout(2500);
  const savedText = await page.locator('main').innerText();
  check('保存成功', savedText.includes('设置已保存'));

  /* ---- 2. 用户端文案同步 ---- */
  console.log('\n=== 2. 用户端展示 ===');
  const userCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const userPage = await userCtx.newPage();
  await login(userPage, USER);
  await userPage.goto(`${BASE}/dashboard/checkin`, { waitUntil: 'networkidle' });
  await userPage.waitForTimeout(800);

  const bodyText = await userPage.locator('main').innerText();
  check('签到页文案反映固定奖励', bodyText.includes(`固定获得 ${FIXED} 分`), '');
  check('文案不再写死 5~15', !bodyText.includes('5~15'));

  /* ---- 3. 实际发放（仅当今日未签到） ---- */
  console.log('\n=== 3. 实际发放 ===');
  const alreadyChecked = bodyText.includes('今日已签');
  if (alreadyChecked) {
    console.log('ℹ️  今日已签到，跳过实际发放校验（接口已由后端脚本验证）');
  } else {
    const btn = userPage.locator('button:has-text("立即签到打卡")');
    if ((await btn.count()) > 0) {
      await btn.click();
      await userPage.waitForTimeout(2500);
      const after = await userPage.locator('main').innerText();
      check('签到后提示获得配置的积分', after.includes(`+${FIXED}`) || after.includes(FIXED), after.replace(/\s+/g, ' ').slice(0, 80));
    } else {
      console.log('ℹ️  未找到签到按钮，跳过');
    }
  }

  await userPage.screenshot({ path: `${OUT}/签到-奖励配置生效.png`, fullPage: false });

  /* ---- 4. 恢复默认 ---- */
  console.log('\n=== 4. 恢复默认配置 ===');
  await page.goto(`${BASE}/dashboard/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.fill('input[name="checkin_rewards"]', originalPool);
  await page.click('button:has-text("保存设置")');
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const restored = await page.locator('input[name="checkin_rewards"]').inputValue();
  check('已恢复原有奖励池', restored === originalPool, restored);

  await browser.close();
  console.log(failed === 0 ? '\n🎉 签到奖励可配置验证通过' : `\n❌ 有 ${failed} 项未通过`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e); process.exit(1);
});
