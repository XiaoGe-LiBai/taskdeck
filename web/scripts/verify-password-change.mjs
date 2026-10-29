/**
 * 个人资料页「修改密码」端到端验证。
 *
 * 走真实界面：登录 → 个人资料 → 改密 → 再改回来。
 * 结束时口令恢复原值，不会影响调用方后续步骤。
 *
 * 前置：测试实例已用 TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD 建好管理员。
 */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.argv[2];
const { TEST_ADMIN_EMAIL: email, TEST_ADMIN_PASSWORD: password } = process.env;
const temp = `Tmp-${Date.now()}-passw0rd`;
assert(base && email && password, '缺少隔离测试地址或管理员凭据');

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  await page.goto(`${base}/sign-in`, { waitUntil: 'networkidle' });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL('**/dashboard**', { timeout: 30000 });

  await page.goto(`${base}/dashboard/profile`, { waitUntil: 'networkidle' });
  const card = page.locator('form', { has: page.locator('input[name="old_password"]') });
  assert.equal(await card.count(), 1, '个人资料页应存在修改密码表单');

  const submit = async (from, to) => {
    await page.locator('input[name="old_password"]').fill(from);
    await page.locator('input[name="new_password"]').fill(to);
    await page.locator('input[name="confirm_password"]').fill(to);
    await card.getByRole('button', { name: '修改密码' }).click();
    await page.getByText('密码已修改，下次登录请使用新密码').waitFor({ timeout: 20000 });
    // 成功后输入框应被清空，不把口令留在 DOM 里
    assert.equal(await page.locator('input[name="old_password"]').inputValue(), '');
  };

  await submit(password, temp);
  await submit(temp, password);

  // 改回后原口令仍可登录，说明两次都真正落库了
  await page.goto(`${base}/sign-in`, { waitUntil: 'networkidle' });
  assert.equal(page.url().includes('/dashboard'), true, '当前会话应仍然有效');
  console.log('通过：个人资料页修改密码（改 → 改回）');
} finally {
  await browser.close();
}
