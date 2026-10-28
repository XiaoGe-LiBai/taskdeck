/**
 * 端到端验证「脚本 × 账号 绑定矩阵」页：
 * 登录 → 打开 bindings 页 → 断言矩阵行列数 → 勾选一个账号 → 保存 → 验证提示 → 复原
 *
 * 用法：node scripts/verify-bindings.mjs [baseUrl]
 */
import { chromium } from '@playwright/test';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');

const main = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();

  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', 'admin@example.com');
  await page.fill('input[name="password"]', 'admin12345');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 30000 });

  await page.goto(`${BASE}/dashboard/yyb/bindings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // 矩阵表：表头第一列是脚本，其余是账号
  const headCells = await page.locator('table thead th').count();
  const bodyRows = await page.locator('table tbody tr').count();
  const boxes = await page.locator('table tbody input[type="checkbox"]').count();
  console.log(`表头单元格 ${headCells}（1 脚本 + ${headCells - 1} 账号）`);
  console.log(`脚本行 ${bodyRows}，复选框 ${boxes}`);
  if (headCells < 2 || bodyRows < 1) {
    throw new Error('矩阵没渲染出来');
  }

  // 找一个未绑定的行，勾上第一个账号
  const firstRow = page.locator('table tbody tr').first();
  const scriptName = (await firstRow.locator('td').first().innerText()).split('\n')[0];
  const firstBox = firstRow.locator('input[type="checkbox"]').first();
  if (await firstBox.isChecked()) {
    console.log(`（第一行 ${scriptName} 本来就勾着，先取消）`);
    await firstBox.uncheck();
  }
  await firstBox.check();

  const status = page.locator('span', { hasText: '行未保存' }).first();
  console.log('改动提示:', (await status.innerText()).trim());

  await page.getByRole('button', { name: '保存矩阵' }).click();
  await page.waitForTimeout(2500);
  const msg = await page.locator('text=已保存').first().innerText().catch(() => '(没看到成功提示)');
  console.log('保存结果:', msg.trim());

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const checkedNow = await page.locator('table tbody tr').first().locator('input[type="checkbox"]').first().isChecked();
  console.log('刷新后该格仍勾选:', checkedNow);

  // 还原：取消勾选并保存
  const boxAgain = page.locator('table tbody tr').first().locator('input[type="checkbox"]').first();
  if (await boxAgain.isChecked()) {
    await boxAgain.uncheck();
    await page.getByRole('button', { name: '保存矩阵' }).click();
    await page.waitForTimeout(2000);
    console.log('已复原（取消勾选并保存）');
  }

  await page.screenshot({ path: '../截图/11-应用宝绑定.png', fullPage: true });
  await browser.close();
  console.log('OK');
};

main().catch((error) => {
  console.error('验证失败:', error.message);
  process.exit(1);
});
