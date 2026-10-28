/**
 * 侧边栏层级与单高亮验证 + 页面巡检 + 截图
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
  await page.waitForURL('**/dashboard**', { timeout: 30000 });
  await page.waitForTimeout(1000);
};

const getAsideActiveNavItems = async (page) => {
  // 精确针对桌面端 aside 中的 nav 链接
  const links = await page.locator('aside nav a').all();
  const activeItems = [];
  for (const link of links) {
    const text = (await link.innerText()).trim();
    const href = await link.getAttribute('href');
    const className = (await link.getAttribute('class')) || '';
    // 激活状态样式为 bg-brand-gradient text-white
    const isActive = className.includes('bg-brand-gradient');
    if (isActive) {
      activeItems.push({ text, href, className });
    }
  }
  return activeItems;
};

const run = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();

  let failed = 0;
  const check = (title, pass, detail = '') => {
    if (!pass) {
      failed++;
    }
    console.log(`${pass ? '✅' : '❌'} ${title} ${detail ? `(${detail})` : ''}`);
  };

  console.log('=== 1. 管理员登录与侧边栏分组验证 ===');
  await login(context, page, PANEL_ADMIN);
  const navText = await page.locator('aside nav').first().innerText();

  check('包含分组【概览】', navText.includes('概览'));
  check('包含分组【账号】', navText.includes('账号'));
  check('包含分组【业务】', navText.includes('业务'));
  check('包含分组【其他】', navText.includes('其他'));
  check('包含概览菜单：控制台、每日签到', navText.includes('控制台') && navText.includes('每日签到'));
  check('包含账号菜单：账号管理', navText.includes('账号管理'));
  check(
    '包含业务菜单：小蚕、应用宝、项目市场、会员中心',
    navText.includes('小蚕') && navText.includes('应用宝') && navText.includes('项目市场') && navText.includes('会员中心'),
  );
  check('包含其他菜单：登陆记录、消息推送', navText.includes('登陆记录') && navText.includes('消息推送'));
  check(
    '管理员可见拓展管理模块：用户管理、任务日志、系统设置',
    navText.includes('用户管理') && navText.includes('任务日志') && navText.includes('系统设置'),
  );

  console.log('\n=== 2. 侧边栏单高亮准确性验证 ===');
  const targetPages = [
    { url: '/dashboard', expectedText: '控制台' },
    { url: '/dashboard/checkin', expectedText: '每日签到' },
    { url: '/dashboard/accounts', expectedText: '账号管理' },
    { url: '/dashboard/xiaocan', expectedText: '小蚕' },
    { url: '/dashboard/yyb', expectedText: '应用宝' },
    { url: '/dashboard/market', expectedText: '项目市场' },
    { url: '/dashboard/profile', expectedText: '会员中心' },
    { url: '/dashboard/login-logs', expectedText: '登陆记录' },
    { url: '/dashboard/notifications', expectedText: '消息推送' },
    { url: '/dashboard/projects', expectedText: '项目管理' },
    { url: '/dashboard/settings', expectedText: '系统设置' },
  ];

  for (const item of targetPages) {
    await page.goto(`${BASE}${item.url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const activeItems = await getAsideActiveNavItems(page);

    const countOk = activeItems.length === 1;
    const nameOk = activeItems.length === 1 && activeItems[0].text.includes(item.expectedText);
    const details = activeItems.map(i => i.text.replace(/\n+/g, ' ')).join(', ') || '无高亮';

    check(`单高亮验证: ${item.url} -> [${item.expectedText}]`, countOk && nameOk, `激活数量: ${activeItems.length}, 当前: ${details}`);
  }

  console.log('\n=== 3. 关键页面功能与截图采集 ===');
  // 1. 控制台
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/重构-00-控制台.png`, fullPage: false });

  // 2. 每日签到
  await page.goto(`${BASE}/dashboard/checkin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const checkInText = await page.locator('body').innerText();
  check('每日签到页面正常渲染', checkInText.includes('每日签到打卡') && checkInText.includes('累计签到天数'));
  await page.screenshot({ path: `${OUT}/重构-01-每日签到.png`, fullPage: false });

  // 3. 小蚕页面
  await page.goto(`${BASE}/dashboard/xiaocan`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const xiaocanText = await page.locator('body').innerText();
  check('小蚕页面正常渲染', xiaocanText.includes('小蚕 · 大牌券业务') && xiaocanText.includes('限量大牌券'));
  await page.screenshot({ path: `${OUT}/重构-02-小蚕业务.png`, fullPage: false });

  // 4. 项目市场
  await page.goto(`${BASE}/dashboard/market`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const marketText = await page.locator('body').innerText();
  check('项目市场页面正常渲染', marketText.includes('项目市场') || marketText.includes('提交自定义脚本'));
  await page.screenshot({ path: `${OUT}/重构-03-项目市场.png`, fullPage: false });

  // 5. 会员中心
  await page.goto(`${BASE}/dashboard/profile`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const profileText = await page.locator('body').innerText();
  check('会员中心页面正常渲染', profileText.includes('会员中心') && (profileText.includes('卡密') || profileText.includes('积分变动')));
  await page.screenshot({ path: `${OUT}/重构-04-会员中心.png`, fullPage: false });

  // 6. 登陆记录
  await page.goto(`${BASE}/dashboard/login-logs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const loginLogsText = await page.locator('body').innerText();
  check('登陆记录页面正常渲染', loginLogsText.includes('登陆记录') || loginLogsText.includes('登录日志'));
  await page.screenshot({ path: `${OUT}/重构-05-登陆记录.png`, fullPage: false });

  // 7. 消息推送
  await page.goto(`${BASE}/dashboard/notifications`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const notifText = await page.locator('body').innerText();
  check('消息推送页面正常渲染', notifText.includes('消息推送') && notifText.includes('系统公告'));
  await page.screenshot({ path: `${OUT}/重构-06-消息推送.png`, fullPage: false });

  console.log('\n=== 4. 普通用户权限与菜单纯净度验证 ===');
  await login(context, page, XIAOCAN_USER);
  const userNavText = await page.locator('aside nav').first().innerText();
  check('普通用户侧栏无「用户管理」', !userNavText.includes('用户管理'));
  check('普通用户侧栏无「系统设置」', !userNavText.includes('系统设置'));
  check('普通用户侧栏无「项目管理」', !userNavText.includes('项目管理'));
  check(
    '普通用户保留业务与概览全套功能',
    userNavText.includes('控制台')
    && userNavText.includes('每日签到')
    && userNavText.includes('小蚕')
    && userNavText.includes('应用宝')
    && userNavText.includes('项目市场')
    && userNavText.includes('会员中心')
    && userNavText.includes('消息推送'),
  );
  await page.screenshot({ path: `${OUT}/重构-07-普通用户侧栏与控制台.png`, fullPage: false });

  await browser.close();
  if (failed > 0) {
    console.error(`\n❌ 自动化验证失败，共 ${failed} 项未通过。`);
    process.exit(1);
  } else {
    console.log('\n🎉 所有验证全部通过！');
  }
};

run().catch((e) => {
  console.error('测试执行出错:', e);
  process.exit(1);
});
