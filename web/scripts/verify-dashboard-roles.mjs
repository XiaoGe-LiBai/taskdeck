/**
 * 验证控制台角色分流与数据边界隔离：
 * 普通用户绝不展示「用户数、账号总数、VIP 账号、卡密总数、积分发放、今日抢券率、小蚕等级分布、青龙面板」
 * 管理员完整保留全站监控仪表盘
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

  console.log('=== 1. 普通用户控制台数据隔离验证 ===');
  await login(context, page, XIAOCAN_USER);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const userContent = await page.locator('main').innerText();

  // 必须严格不存在管理员全站级指标
  const forbiddenAdminKeywords = [
    '用户数',
    '账号总数',
    'VIP 账号',
    '卡密总数',
    '积分发放',
    '今日抢券率',
    '小蚕等级分布',
    '青龙面板',
    '近 7 日限量大牌券未中',
    '全站大牌券命中口径',
  ];

  for (const kw of forbiddenAdminKeywords) {
    check(`普通用户不包含管理员字段 [${kw}]`, !userContent.includes(kw));
  }

  // 必须展示普通用户个人数据
  const expectedUserKeywords = [
    '可用积分',
    '我的托管账号',
    '今日打卡状态',
    '累计消费积分',
    '卡槽使用',
    '我的邀请码',
    '业务专区快捷导航',
    '我的小蚕账号',
    '近期积分明细',
  ];

  for (const kw of expectedUserKeywords) {
    check(`普通用户正常展示个人专属模块 [${kw}]`, userContent.includes(kw));
  }

  await page.screenshot({ path: `${OUT}/控制台-普通用户-个人工作台.png`, fullPage: false });

  console.log('\n=== 2. 管理员控制台平台监控验证 ===');
  await login(context, page, PANEL_ADMIN);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const adminContent = await page.locator('main').innerText();

  check('管理员展示「平台管理仪表盘」', adminContent.includes('平台管理仪表盘'));
  check('管理员展示全站指标「用户数」', adminContent.includes('用户数'));
  check('管理员展示全站指标「账号总数」', adminContent.includes('账号总数'));
  check('管理员展示全站指标「卡密总数」', adminContent.includes('卡密总数'));
  check('管理员展示全站指标「小蚕等级分布」', adminContent.includes('小蚕等级分布'));
  check('管理员展示节点监控「青龙面板」', adminContent.includes('青龙面板'));

  await page.screenshot({ path: `${OUT}/控制台-管理员-平台管理仪表盘.png`, fullPage: false });

  await browser.close();
  if (failed > 0) {
    console.error(`\n❌ 自动化验证失败，共 ${failed} 项未通过。`);
    process.exit(1);
  } else {
    console.log('\n🎉 所有角色分流验证全部通过！');
  }
};

run().catch((e) => {
  console.error('测试执行出错:', e);
  process.exit(1);
});
