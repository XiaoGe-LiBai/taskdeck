/**
 * 响应式改造验证（3001 后台）：
 * 1. 移动端导航：汉堡按钮 → 抽屉可用，导航区不再霸占整屏
 * 2. 移动端表格：卡片化（字段名 + 值），无横向溢出
 * 3. 桌面端：侧栏与表格形态保持不变（零回归）
 *
 * 用法：node scripts/verify-responsive.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../截图/响应式审计');
mkdirSync(OUT, { recursive: true });

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const ADMIN = ['admin@example.com', 'admin12345'];

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

  /* ================= 移动端 390 ================= */
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  const mPage = await mobile.newPage();
  await login(mPage);
  await mPage.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await mPage.waitForTimeout(700);

  console.log('\n=== 1. 移动端导航抽屉 ===');
  const burger = mPage.locator('button[aria-label="打开导航菜单"]');
  check('移动端存在汉堡按钮', (await burger.count()) === 1);

  const mainTop = await mPage.evaluate(() => Math.round(document.querySelector('main').getBoundingClientRect().top));
  check('导航不再霸占首屏（main 顶部 < 200px）', mainTop < 200, `main.top = ${mainTop}px`);

  const oldScroller = await mPage.evaluate(() => document.querySelectorAll('header + div[class*="overflow-x-auto"]').length);
  check('旧的横向滚动导航容器已移除', oldScroller === 0, `剩余 ${oldScroller} 个`);

  await burger.click();
  await mPage.waitForTimeout(400);
  const drawer = mPage.locator('[role="dialog"][aria-label="导航菜单"]');
  check('点击后抽屉出现', (await drawer.count()) === 1);

  const drawerLinks = await drawer.locator('nav a').count();
  check('抽屉内含完整导航项（>= 12）', drawerLinks >= 12, `${drawerLinks} 项`);

  const groupCount = await drawer.locator('nav > div').count();
  check('抽屉内保留分组结构（5 组）', groupCount === 5, `${groupCount} 组`);

  await mPage.screenshot({ path: `${OUT}/3001-移动端-抽屉打开.png`, fullPage: false });

  // 点击导航项后应跳转并关闭抽屉
  await drawer.locator('nav a', { hasText: '每日签到' }).first().click();
  await mPage.waitForTimeout(1200);
  check('点击抽屉导航可跳转', mPage.url().includes('/dashboard/checkin'), mPage.url());
  check('跳转后抽屉自动关闭', (await mPage.locator('[role="dialog"][aria-label="导航菜单"]').count()) === 0);

  console.log('\n=== 2. 移动端表格卡片化 ===');
  for (const route of ['/dashboard/accounts', '/dashboard/users', '/dashboard/cards']) {
    await mPage.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await mPage.waitForTimeout(600);
    const r = await mPage.evaluate(() => {
      const de = document.documentElement;
      const table = document.querySelector('.rtable');
      const thead = document.querySelector('.rtable thead');
      const tr = document.querySelector('.rtable tbody > tr');
      const td = document.querySelector('.rtable tbody > tr td:nth-child(2)');
      const firstTd = document.querySelector('.rtable tbody > tr td');
      const label = td ? getComputedStyle(td, '::before').content : '';
      const firstLabel = firstTd ? getComputedStyle(firstTd, '::before').content : '';
      return {
        hasTable: !!table,
        horizontalOverflow: de.scrollWidth - de.clientWidth,
        theadHidden: thead ? getComputedStyle(thead).display === 'none' : null,
        rowDisplay: tr ? getComputedStyle(tr).display : null,
        cellDisplay: td ? getComputedStyle(td).display : null,
        cellLabel: label,
        cellLabelVisible: !!(label && label !== 'none' && label !== 'normal' && label !== '""'),
        firstCellLabelSuppressed: !firstLabel || firstLabel === 'none' || firstLabel === 'normal' || firstLabel === '""',
        firstCellDataLabel: firstTd ? firstTd.getAttribute('data-label') : null,
      };
    });
    check(`${route} 表头隐藏（卡片模式）`, r.theadHidden === true);
    check(`${route} 行渲染为卡片（display:block）`, r.rowDisplay === 'block', `display=${r.rowDisplay}`);
    check(`${route} 单元格为字段名+值布局`, r.cellDisplay === 'flex', `display=${r.cellDisplay}`);
    check(`${route} 单元格显示字段名`, r.cellLabelVisible === true, `::before content=${r.cellLabel}`);
    check(
      `${route} 首列字段名处理正确`,
      r.firstCellDataLabel === '选择'
        ? r.firstCellLabelSuppressed === true
        : r.firstCellLabelSuppressed === false,
      `首列 data-label=${r.firstCellDataLabel}`,
    );
    check(`${route} 无横向溢出`, r.horizontalOverflow <= 0, `溢出 ${r.horizontalOverflow}px`);
  }
  await mPage.screenshot({ path: `${OUT}/3001-移动端-账号卡片.png`, fullPage: false });
  await mobile.close();

  /* ================= 桌面端 1440（零回归） ================= */
  console.log('\n=== 3. 桌面端零回归 ===');
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const dPage = await desktop.newPage();
  await login(dPage);
  await dPage.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await dPage.waitForTimeout(600);

  const asideVisible = await dPage.evaluate(() => {
    const aside = document.querySelector('aside');
    return aside ? getComputedStyle(aside).display !== 'none' : false;
  });
  check('桌面端固定侧栏仍在', asideVisible === true);

  const burgerHidden = await dPage.evaluate(() => {
    const btn = document.querySelector('button[aria-label="打开导航菜单"]');
    return btn ? getComputedStyle(btn).display === 'none' : true;
  });
  check('桌面端隐藏汉堡按钮', burgerHidden === true);

  await dPage.goto(`${BASE}/dashboard/accounts`, { waitUntil: 'networkidle' });
  await dPage.waitForTimeout(600);
  const dTable = await dPage.evaluate(() => {
    const thead = document.querySelector('.rtable thead');
    const tr = document.querySelector('.rtable tbody > tr');
    return {
      theadVisible: thead ? getComputedStyle(thead).display !== 'none' : false,
      rowDisplay: tr ? getComputedStyle(tr).display : null,
    };
  });
  check('桌面端表头仍显示', dTable.theadVisible === true);
  check('桌面端行仍为表格行', dTable.rowDisplay === 'table-row', `display=${dTable.rowDisplay}`);
  await dPage.screenshot({ path: `${OUT}/3001-桌面端-账号表格.png`, fullPage: false });
  await desktop.close();

  await browser.close();
  console.log(failed === 0 ? '\n🎉 响应式验证全部通过' : `\n❌ 有 ${failed} 项未通过`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error('验证执行出错:', e);
  process.exit(1);
});
