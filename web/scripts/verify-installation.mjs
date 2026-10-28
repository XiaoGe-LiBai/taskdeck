import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

// 只操作调用方提供的隔离测试实例，凭据不落盘、不写入 URL。
const base = process.argv[2];
const { TEST_SETUP_CODE: code, TEST_ADMIN_EMAIL: email, TEST_ADMIN_PASSWORD: password } = process.env;
assert(base && code && email && password, '缺少隔离测试地址或初始化凭据');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  await page.goto(`${base}/sign-up`);
  await page.waitForURL('**/setup');
  await page.getByLabel('初始化码').fill(code);
  await page.getByLabel('管理员邮箱').fill(email);
  await page.getByLabel('设置密码').fill(password);
  await page.getByLabel('确认密码').fill(password);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '手机页面横向溢出');
  await page.getByRole('button', { name: '创建管理员并开始使用' }).click();
  await page.waitForURL('**/sign-in?setup=1', { timeout: 30000 });
  assert((await page.getByRole('status').textContent()).includes('管理员已创建'));
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL('**/dashboard**', { timeout: 30000 });
  assert(!page.url().includes(code) && !page.url().includes(password));
  console.log('通过：手机安装页 → 成功提示 → 管理员登录，无横向溢出');
} finally {
  await browser.close();
}
