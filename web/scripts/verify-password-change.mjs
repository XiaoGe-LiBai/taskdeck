/**
 * 个人资料页「修改密码」端到端验证。
 *
 * 走真实界面：登录 → 个人资料 → 改密 → 再改回来。
 * 判定依据是**后端登录结果**，不是页面文案——成功提示会一直留在卡片上，
 * 拿它当信号会在第二次提交时立刻返回，读到尚未清空的输入框（假失败）。
 *
 * 结束时口令恢复原值，不影响调用方后续步骤。
 */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const [base, apiBase] = process.argv.slice(2);
const { TEST_ADMIN_EMAIL: email, TEST_ADMIN_PASSWORD: password } = process.env;
const temp = `Tmp-${Date.now()}-passw0rd`;
assert(base && apiBase && email && password, '缺少测试地址或管理员凭据');

/** 直接问后端：该口令能否登录。 */
const canLogin = async (candidate) => {
  const resp = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: candidate }),
  });
  const body = await resp.json();
  return body.code === 200;
};

const waitForLogin = async (candidate, expected) => {
  for (let i = 0; i < 30; i++) {
    if ((await canLogin(candidate)) === expected) {
      return;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  assert.fail(`后端状态未按预期变为 expected=${expected}`);
};

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
    await waitForLogin(to, true);
  };

  await submit(password, temp);
  // 提交后输入框应清空，不把口令留在 DOM 里
  for (let i = 0; i < 20; i++) {
    if ((await page.locator('input[name="old_password"]').inputValue()) === '') {
      break;
    }
    await page.waitForTimeout(250);
  }
  assert.equal(await page.locator('input[name="old_password"]').inputValue(), '', '提交成功后应清空输入框');

  await submit(temp, password);
  await waitForLogin(password, true);
  await waitForLogin(temp, false);

  // 会话未被吊销：仍停在面板内
  assert.equal(page.url().includes('/dashboard'), true, '改密不应把自己踢下线');
  console.log('通过：个人资料页修改密码（改 → 改回），旧口令已失效');
} finally {
  await browser.close();
}
