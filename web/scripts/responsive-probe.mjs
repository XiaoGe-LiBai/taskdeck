/**
 * 响应式探针：用 DOM 度量取代肉眼判断，精确定位「窄栏」「横向滚动条」等布局问题。
 * 用法：node scripts/responsive-probe.mjs
 */
import { chromium } from '@playwright/test';

const OLD = 'http://127.0.0.1:8100';
const NEW = 'http://127.0.0.1:3001';
const ADMIN = ['admin@example.com', 'admin12345'];
const USER = ['demo@example.com', 'demo12345'];

const loginOld = async (page, [email, password]) => {
  await page.goto(`${OLD}/#/login`, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${OLD}/#/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button.btn-primary');
  await page.waitForTimeout(2200);
};

const loginNew = async (page, [email, password]) => {
  await page.goto(`${NEW}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 30000 });
  await page.waitForTimeout(800);
};

const main = async () => {
  const browser = await chromium.launch({ channel: 'chrome' });

  /* ---- 8100 用户端：桌面端是否窄栏 ---- */
  for (const w of [1440, 1024]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await loginOld(page, USER);
    await page.goto(`${OLD}/#/home`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const vw = window.innerWidth;
      const shell = document.querySelector('.app-shell');
      const tabbar = document.querySelector('.tabbar');
      const cards = Array.from(document.querySelectorAll('.card')).slice(0, 3).map(c => Math.round(c.getBoundingClientRect().width));
      return {
        viewport: vw,
        shellWidth: shell ? Math.round(shell.getBoundingClientRect().width) : null,
        tabbarWidth: tabbar ? Math.round(tabbar.getBoundingClientRect().width) : null,
        deadSpace: shell ? Math.round((vw - shell.getBoundingClientRect().width) / 2) : null,
        cardWidths: cards,
      };
    });
    console.log(`[8100 用户端 #/home @${w}]`, JSON.stringify(r));
    await ctx.close();
  }

  /* ---- 3001 后台：移动端侧栏是否为横向滚动条 ---- */
  for (const w of [390, 768]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await loginNew(page, ADMIN);
    await page.goto(`${NEW}/dashboard`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const vw = window.innerWidth;
      const aside = document.querySelector('aside');
      const scroller = document.querySelector('header + div[class*="overflow-x-auto"]');
      const navs = document.querySelectorAll('nav');
      let navInfo = null;
      if (scroller) {
        const inner = scroller.firstElementChild;
        navInfo = {
          wrapperScrollW: scroller.scrollWidth,
          wrapperClientW: scroller.clientWidth,
          horizontalScrollable: scroller.scrollWidth > scroller.clientWidth + 1,
          innerWidth: inner ? Math.round(inner.getBoundingClientRect().width) : null,
          scrollerHeight: Math.round(scroller.getBoundingClientRect().height),
        };
      }
      return {
        viewport: vw,
        asideVisible: aside ? getComputedStyle(aside).display !== 'none' : null,
        navCount: navs.length,
        mobileScroller: navInfo,
      };
    });
    console.log(`[3001 /dashboard @${w}]`, JSON.stringify(r));
    await ctx.close();
  }

  /* ---- 3001 表格在移动端是否可读（溢出） ---- */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await loginNew(page, ADMIN);
    for (const route of ['/dashboard/accounts', '/dashboard/users']) {
      await page.goto(`${NEW}${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const r = await page.evaluate(() => {
        const vw = window.innerWidth;
        const table = document.querySelector('table');
        if (!table) {
          return { hasTable: false };
        }
        const tr = table.querySelector('tbody tr');
        return {
          hasTable: true,
          tableW: Math.round(table.getBoundingClientRect().width),
          viewport: vw,
          tableOverflowsViewport: table.getBoundingClientRect().width > vw,
          firstRowHeight: tr ? Math.round(tr.getBoundingClientRect().height) : null,
          columns: table.querySelectorAll('thead th').length,
          wrapperOverflowX: table.parentElement ? getComputedStyle(table.parentElement).overflowX : null,
        };
      });
      console.log(`[3001 ${route} @390]`, JSON.stringify(r));
    }
    await ctx.close();
  }

  await browser.close();
};

main().catch((e) => {
  console.error(e); process.exit(1);
});
