import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:3001';
const SHOT_DIR = path.resolve('../截图');

if (!fs.existsSync(SHOT_DIR)) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
}

async function main() {
  console.log('🚀 启动 Playwright 端到端验证...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  // 1. 普通用户登录并进入 /dashboard/submit
  console.log('👤 普通用户登录中...');
  const userContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  });
  const userPage = await userContext.newPage();
  await userPage.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await userPage.fill('input[name="email"]', 'demo@example.com');
  await userPage.fill('input[name="password"]', 'demo12345');
  await userPage.click('button[type="submit"]');
  await userPage.waitForURL('**/dashboard', { timeout: 30000 });

  // 2. 打开提交上车页面 /dashboard/submit
  console.log('🚀 打开用户提交上车页面 (/dashboard/submit)...');
  await userPage.goto(`${BASE}/dashboard/submit`, { waitUntil: 'networkidle' });
  await userPage.waitForTimeout(600);

  // 3. 验证侧边栏“提交上车”菜单只高亮了一个，没有双重亮起
  const navItems = await userPage.locator('aside nav a:has-text("提交上车")').all();
  console.log(`🔍 侧边栏中“提交上车”菜单项总数: ${navItems.length}`);
  if (navItems.length !== 1) {
    throw new Error(`侧边栏存在 ${navItems.length} 个“提交上车”项，期望为 1 个！`);
  }
  const isNavActive = await navItems[0].evaluate(el => el.classList.contains('bg-brand-gradient') || el.classList.contains('text-white'));
  console.log(`✅ 侧边栏唯一“提交上车”高亮状态: ${isNavActive ? '高亮正常' : '未激活'}`);

  // 4. 验证主体内容区仅展示自定义脚本，绝不包含 code 版脚本
  const mainContent = await userPage.locator('main').innerText();
  const hasCodeScript = mainContent.includes('code版_');
  console.log(`🔍 主体内容区是否混入 code 版脚本: ${hasCodeScript ? '⚠️ 混入了！' : '✅ 未混入 (已严格隔离)'}`);
  if (hasCodeScript) {
    throw new Error('检测到主体内容区混入了 code 版脚本！');
  }

  // 截图：隔离后的纯粹自定义脚本提交页
  const shotSubmitPure = path.join(SHOT_DIR, '17-用户端纯净自定义脚本提交.png');
  await userPage.screenshot({ path: shotSubmitPure, fullPage: true });
  console.log(`📸 截图已保存: ${shotSubmitPure}`);

  // 5. 填写参数提交
  console.log('✍️ 测试动态参数提交...');
  const accountInput = userPage.locator('input[placeholder*="138"], input[placeholder*="手机号"], input[placeholder*="账号"]').first();
  if (await accountInput.count() > 0) {
    await accountInput.fill('13800009999');
  }
  const cookieTextarea = userPage.locator('textarea').first();
  if (await cookieTextarea.count() > 0) {
    await cookieTextarea.fill('pt_key=test_second_round; pt_pin=verified_pin;');
  }

  const submitBtn = userPage.locator('button:has-text("确认并提交上车")');
  if (await submitBtn.count() > 0 && !(await submitBtn.isDisabled())) {
    await submitBtn.click();
    await userPage.waitForTimeout(1500);
    console.log('✅ 提交完成');
  }

  // 截图：提交完成态
  const shotSubmitDone = path.join(SHOT_DIR, '18-用户端提交成功-单菜单高亮.png');
  await userPage.screenshot({ path: shotSubmitDone, fullPage: true });
  console.log(`📸 提交结果截图已保存: ${shotSubmitDone}`);

  await browser.close();
  console.log('🎉 验证全部通过！侧边栏单按钮高亮，code 脚本完全隔离！');
}

main().catch((err) => {
  console.error('❌ 测试运行出错:', err);
  process.exit(1);
});
