/**
 * 验证三项改动：
 *  A. 公告编辑框可双向拉伸（resize: both）
 *  B. 自定义对接脚本：Key 校验拦截、select 类型保存、用户端渲染 select
 *  C. 删除走行内二次确认，不再弹原生 confirm/alert
 *
 * 会在最后清理掉测试期间创建的脚本。
 * 用法：node scripts/verify-custom-scripts-ux.mjs
 */
import { chromium } from '@playwright/test';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const ADMIN = ['admin@example.com', 'admin12345'];
const SCRIPT_NAME = `E2E 测试脚本 ${Date.now()}`;

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
  await page.waitForTimeout(800);
};

const run = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();

  // 原生弹窗监听：改动后不应再出现
  const nativeDialogs = [];
  page.on('dialog', async (d) => {
    nativeDialogs.push(`${d.type()}:${d.message()}`);
    await d.dismiss();
  });

  await login(page);

  /* ---------------- A. 公告编辑框 ---------------- */
  console.log('\n=== A. 公告编辑框拉伸 ===');
  await page.goto(`${BASE}/dashboard/announcements`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const resize = await page.evaluate(() => {
    const ta = document.querySelector('textarea[name="content"]');
    return ta ? getComputedStyle(ta).resize : null;
  });
  check('发布公告编辑框支持双向拉伸', resize === 'both', `resize=${resize}`);

  /* ---------------- B. 自定义脚本 ---------------- */
  console.log('\n=== B. 自定义脚本参数配置 ===');
  await page.goto(`${BASE}/dashboard/projects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.click('button:has-text("自定义脚本 · 扩展对接")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("新增自定义脚本")');
  await page.waitForTimeout(400);

  await page.fill('input[placeholder="如 京东自动抓CK"]', SCRIPT_NAME);

  // 把第一个字段的 Key 改成非法值，保存应被拦截
  const firstKeyInput = page.locator('input[placeholder="key"]').first();
  await firstKeyInput.fill('1bad-key');
  await page.click('button:has-text("确认保存")');
  await page.waitForTimeout(600);
  const errText = await page.locator('text=⚠️').first().innerText().catch(() => '');
  check('非法 Key 被拦截并提示', errText.includes('Key'), errText.slice(0, 60));
  check('校验失败时弹窗保持打开', (await page.locator('button:has-text("确认保存")').count()) > 0);

  // 改成合法 Key 且不改类型；同时新增一个 select 字段
  await firstKeyInput.fill('account');
  await page.click('button:has-text("+ 添加字段")');
  await page.waitForTimeout(300);

  const keyInputs = page.locator('input[placeholder="key"]');
  const typeSelects = page.locator('select').filter({ has: page.locator('option[value="select"]') });
  const lastKey = keyInputs.last();
  await lastKey.fill('channel');
  await typeSelects.last().selectOption('select');
  await page.waitForTimeout(300);

  // 未填选项时保存应被拦截
  await page.click('button:has-text("确认保存")');
  await page.waitForTimeout(600);
  const optErr = await page.locator('text=⚠️').first().innerText().catch(() => '');
  check('select 缺选项被拦截', optErr.includes('选项'), optErr.slice(0, 60));

  // 填上选项后保存
  const optionsArea = page.locator('textarea[placeholder*="微信"]').last();
  await optionsArea.fill('1=微信\n2=支付宝');
  await page.fill('input[placeholder="placeholder"]', '请选择渠道');
  await page.click('button:has-text("确认保存")');
  await page.waitForTimeout(2500);

  check('校验通过后保存成功', (await page.locator('button:has-text("确认保存")').count()) === 0);

  // 列表里应出现新脚本
  await page.goto(`${BASE}/dashboard/projects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.click('button:has-text("自定义脚本 · 扩展对接")');
  await page.waitForTimeout(400);
  const listText = await page.locator('table').innerText();
  check('新脚本出现在列表', listText.includes(SCRIPT_NAME));
  check('列表中展示下拉字段', listText.includes('channel') && listText.includes('下拉选择'));

  /* ---------------- C. 用户端渲染 ---------------- */
  console.log('\n=== C. 用户端动态表单 ===');
  await page.goto(`${BASE}/dashboard/submit`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const scriptVisible = await page.locator(`text=${SCRIPT_NAME}`).count();
  check('用户端能看到新脚本', scriptVisible > 0);
  if (scriptVisible > 0) {
    await page.locator(`text=${SCRIPT_NAME}`).first().click();
    await page.waitForTimeout(600);
    const hasSelect = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('select')).some(s =>
        Array.from(s.options).some(o => o.textContent?.includes('微信')),
      );
    });
    check('用户端渲染出 select 且含选项', hasSelect === true);
  }

  /* ---------------- D. 清理 + 原生弹窗检查 ---------------- */
  console.log('\n=== D. 清理与原生弹窗检查 ===');
  await page.goto(`${BASE}/dashboard/projects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.click('button:has-text("自定义脚本 · 扩展对接")');
  await page.waitForTimeout(400);
  const row = page.locator('tr', { hasText: SCRIPT_NAME });
  await row.locator('button:has-text("删除")').click();
  await page.waitForTimeout(400);
  const confirmVisible = await row.locator('text=确认删除？').count();
  check('删除走行内二次确认', confirmVisible > 0);
  await row.locator('button:has-text("删除")').last().click();
  await page.waitForTimeout(2000);
  const afterDelete = await page.locator('table').innerText();
  check('测试脚本已清理', !afterDelete.includes(SCRIPT_NAME));

  check('全程未使用原生 alert/confirm', nativeDialogs.length === 0, nativeDialogs.join(' | ') || '无');

  await browser.close();
  console.log(failed === 0 ? '\n🎉 全部通过' : `\n❌ 有 ${failed} 项未通过`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e); process.exit(1);
});
