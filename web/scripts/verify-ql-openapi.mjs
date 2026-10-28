/**
 * 验证「青龙面板」已改为 Client ID / Client Secret 接入：
 *  1. 表单字段正确（Client ID / Secret + 可选的日志账号密码）
 *  2. 未配置时给出明确提示
 *  3. 端到端：临时用真实凭据加一台面板 → 测试连通 → 删除
 *
 * 用法：node scripts/verify-ql-openapi.mjs
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

// 与 server/config.json 的 qinglong 段一致（仅测试用，测完删除面板）
const TEST_PANEL = {
  name: `E2E 青龙 ${Date.now()}`,
  url: 'http://127.0.0.1:5700',
  client_id: 'your-client-id',
  client_secret: 'your-client-secret',
};

let failed = 0;
const check = (title, pass, detail = '') => {
  if (!pass) {
    failed++;
  }
  console.log(`${pass ? '✅' : '❌'} ${title}${detail ? `  (${detail})` : ''}`);
};

const login = async (page) => {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', ADMIN[0]);
  await page.fill('input[name="password"]', ADMIN[1]);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 30000 });
  await page.waitForTimeout(700);
};

const run = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await login(page);

  await page.goto(`${BASE}/dashboard/panels`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  console.log('\n=== 1. 表单字段 ===');
  check('有 Client ID 输入框', (await page.locator('input[name="client_id"]').count()) === 1);
  check('有 Client Secret 输入框', (await page.locator('input[name="client_secret"]').count()) === 1);
  check('有可选的日志账号输入框', (await page.locator('input[name="username"]').count()) >= 1);
  const bodyText = await page.locator('main').innerText();
  check('说明文案指向 Client ID / Secret', bodyText.includes('Client ID') && bodyText.includes('Client Secret'));
  check('未配置时卡片有明确提示', bodyText.includes('未配置 Client ID'));

  console.log('\n=== 2. 端到端：真实凭据接入 ===');
  await page.fill('input[name="name"]', TEST_PANEL.name);
  await page.fill('input[name="url"]', TEST_PANEL.url);
  await page.fill('input[name="client_id"]', TEST_PANEL.client_id);
  await page.fill('input[name="client_secret"]', TEST_PANEL.client_secret);
  await page.click('button:has-text("添加面板")');
  await page.waitForTimeout(2500);

  await page.goto(`${BASE}/dashboard/panels`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const card = page.locator('section', { hasText: TEST_PANEL.name }).first();
  check('新面板已出现', (await card.count()) > 0);
  const cardText = await card.innerText();
  check('卡片显示 Client ID', cardText.includes(TEST_PANEL.client_id), '');

  await card.locator('button:has-text("测试连通")').click();
  await page.waitForTimeout(6000);
  const afterCheck = await page.locator('section', { hasText: TEST_PANEL.name }).first().innerText();
  check('测试连通成功（走 OpenAPI）', afterCheck.includes('连接成功'), afterCheck.replace(/\s+/g, ' ').slice(0, 90));

  await page.screenshot({ path: `${OUT}/青龙面板-OpenAPI.png`, fullPage: false });

  console.log('\n=== 3. 清理 ===');
  // 删除用的是原生 confirm，必须先挂上处理器再点
  page.on('dialog', d => d.accept());
  const delCard = page.locator('section', { hasText: TEST_PANEL.name }).first();
  await delCard.locator('button:has-text("删除面板")').click();
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/dashboard/panels`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const finalText = await page.locator('main').innerText();
  check('测试面板已清理', !finalText.includes(TEST_PANEL.name));

  await browser.close();
  console.log(failed === 0 ? '\n🎉 青龙 OpenAPI 改造验证通过' : `\n❌ 有 ${failed} 项未通过`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e); process.exit(1);
});
