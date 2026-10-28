/**
 * 站点名称配置的端到端验证。
 *
 * 站名是**后端 settings 的运行时配置**（管理员在「系统设置 → 站点与注册」改），
 * 不是前端常量。所以这里不能断言某个写死的名字，而要：
 *   1) 从后端公开接口 /api/site-info 读出当前值；
 *   2) 校验标签页 / 登录页 / 落地页 / 后台侧栏 / 移动端抽屉都显示这个值；
 *   3) 改一次设置，确认页面**不用重新构建、不用重启**就跟着变，再改回去。
 *
 * 第 3 步是关键回归点：历史上站名是前端硬编码，管理员改设置完全不生效
 * （存得进去、读得出来，但全站 8 处都写死），改名时又把 `AppConfig.ts`
 * 这个死配置删掉了。任何一处再写死站名，这个脚本都会红。
 *
 * 前置：前后端都在跑（web 3001 / server 8100）。
 * 用法：node scripts/verify-branding.mjs [baseUrl] [apiUrl]
 */
/* eslint-disable unicorn/prefer-dom-node-text-content -- 验证用户可见文本，不能包含隐藏节点 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../../截图');
mkdirSync(OUT, { recursive: true });

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const API = (process.argv[3] ?? 'http://127.0.0.1:8100').replace(/\/$/, '');
const ADMIN = [process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD];
if (ADMIN.some(value => !value)) {
  throw new Error('请设置独立测试环境的 TEST_ADMIN_EMAIL 和 TEST_ADMIN_PASSWORD');
}

/** 历史上用过的站名：任何一个出现在页面上，都说明又有地方写死了 */
const LEGACY_NAMES = ['任务托管面板', '我中了大牌券助手', '多项目面板', '小蚕抢券面板'];

let failed = 0;
const check = (title, pass, detail = '') => {
  if (!pass) {
    failed++;
  }
  console.log(`${pass ? '✅' : '❌'} ${title}${detail ? `  (${detail})` : ''}`);
};

/** 带信封解包的 API 调用：失败直接抛，避免"看着过了其实没生效" */
const api = async (method, path, { token, body } = {}) => {
  const resp = await fetch(`${API}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await resp.json();
  if (json.code !== 200) {
    throw new Error(`${method} ${path} → ${json.msg}`);
  }
  return json.data;
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
  const original = (await api('GET', '/site-info')).site_name;
  const token = (await api('POST', '/auth/login', {
    body: { email: ADMIN[0], password: ADMIN[1] },
  })).access_token;

  console.log(`后端 settings 当前站名：「${original}」\n`);

  const browser = await chromium.launch({ channel: 'chrome' });
  const temp = `改名自检${Date.now() % 100000}`;
  let signInText = '';
  let homeText = '';
  let asideText = '';
  let drawerText = '';

  try {
    /* ---- 未登录视角：标签页 + 登录页 + 落地页 ---- */
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    const page = await ctx.newPage();

    await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    signInText = await page.locator('body').innerText();
    check('登录页显示当前站名', signInText.includes(original), original);
    check('登录页标签页标题', (await page.title()).includes(original), await page.title());

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    homeText = await page.locator('body').innerText();
    check('落地页显示当前站名', homeText.includes(original));
    check('落地页标签页标题', (await page.title()).includes(original), await page.title());

    /* ---- 关键回归：改设置 → 页面立即跟随（不重建、不重启） ---- */
    await api('PUT', '/admin/settings', { token, body: { site_name: temp } });

    await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    check(
      '改设置后标签页立即跟随（无需重新构建/重启）',
      (await page.title()).includes(temp),
      await page.title(),
    );
    check('改设置后登录页立即跟随', (await page.locator('body').innerText()).includes(temp));

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    check('改设置后落地页立即跟随', (await page.locator('body').innerText()).includes(temp));

    await api('PUT', '/admin/settings', { token, body: { site_name: original } });
    await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    check('改回后立即恢复', (await page.title()).includes(original), await page.title());

    /* ---- 登录后：侧栏 ---- */
    await login(page);
    asideText = await page.locator('aside').innerText();
    check('后台侧栏显示当前站名', asideText.includes(original));
    check('后台标签页标题', (await page.title()).includes(original), await page.title());
    if (process.env.TEST_NO_SCREENSHOTS !== '1') {
      await page.screenshot({ path: `${OUT}/站名-01-后台侧栏.png`, fullPage: false });
    }

    /* ---- 移动端抽屉 ---- */
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
    const mPage = await mctx.newPage();
    await login(mPage);
    await mPage.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    await mPage.waitForTimeout(400);
    await mPage.click('button[aria-label="打开导航菜单"]');
    await mPage.waitForTimeout(400);
    drawerText = await mPage.locator('[role="dialog"]').innerText();
    check('移动端抽屉显示当前站名', drawerText.includes(original));
    if (process.env.TEST_NO_SCREENSHOTS !== '1') {
      await mPage.screenshot({ path: `${OUT}/站名-02-移动端抽屉.png`, fullPage: false });
    }

    await mctx.close();
    await ctx.close();
  } finally {
    // 无论中途怎么挂，都要把站名改回去
    const now = (await api('GET', '/site-info')).site_name;
    if (now !== original) {
      await api('PUT', '/admin/settings', { token, body: { site_name: original } });
      console.log(`\n（已把站名从「${now}」改回「${original}」）`);
    }
    await browser.close();
  }

  /* ---- 硬编码残留 ---- */
  const allText = [signInText, homeText, asideText, drawerText].join('\n');
  for (const legacy of LEGACY_NAMES) {
    check(`无硬编码残留「${legacy}」`, !allText.includes(legacy));
  }

  console.log(failed === 0 ? '\n🎉 站点名称链路验证通过' : `\n❌ 有 ${failed} 项未通过`);
  process.exit(failed === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
