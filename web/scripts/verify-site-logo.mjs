/**
 * 站点图标（自定义 logo）的端到端验证：上传 → 开关 → 删除 → 刷新确认落库。
 *
 * 这块是「客户端乐观状态 + server action + 后端文件」三层叠在一起，最容易出现
 * 「界面变了但后端没变」（或者反过来）。所以每一步都同时看 DOM 和真实 HTTP 结果：
 *   - 预览里有没有 <img>：界面
 *   - /site-icon 的状态码：后端到底认不认
 *   - 最后 reload 一次：确认刚才那些不是本地乐观状态撑出来的假象
 *
 * 测试图内嵌成 base64，不依赖任何外部文件，随手就能跑。
 *
 * 前置：前后端都在跑（web 3001 / server 8100），且用默认管理员账号。
 * 用法：node scripts/verify-site-logo.mjs [baseUrl]
 */
/* eslint-disable unicorn/prefer-dom-node-text-content -- 验证用户可见文本，不能包含隐藏节点 */
import { Buffer } from 'node:buffer';
import { chromium } from '@playwright/test';

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const ADMIN = [process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD];
if (ADMIN.some(value => !value)) {
  throw new Error('请设置独立测试环境的 TEST_ADMIN_EMAIL 和 TEST_ADMIN_PASSWORD');
}

/** 64×40 的橙紫双色 PNG —— 够小（172 字节 base64），也够辨识 */
const TEST_PNG_BASE64
  = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAIAAADBrGu+AAAASElEQVR42u3RQQ0AIAwAsQ0z6EEWPyxigxcyyELPQXN5Zo/KtSgeAAAAAAAAAAAAAAAAwKtyje0AAAAAAAAAAAAAAAAAwI+AC3N1A7tMLc6SAAAAAElFTkSuQmCC';

let failed = 0;
const check = (title, pass, detail = '') => {
  if (!pass) {
    failed++;
  }
  console.log(`${pass ? '✅' : '❌'} ${title}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'zh-CN' });
const page = await ctx.newPage();

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', ADMIN[0]);
  await page.fill('input[name="password"]', ADMIN[1]);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 30000 });
  await page.goto(`${BASE}/dashboard/settings`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const logoCard = page.locator('#logo');
  const sw = logoCard.locator('[role="switch"]');
  const imgCount = () => logoCard.locator('img').count();
  const cardText = () => logoCard.innerText();
  /** 操作结果提示行：排除卡片标题「站点图标」本身 */
  const feedback = async () => (await cardText())
    .split('\n')
    .find(line => /图标已更新|已删除|已启用|已切回/.test(line)) ?? '';

  /* ---------- 初始：应当是内置标 ---------- */
  check('初始开关为关', (await sw.getAttribute('aria-checked')) === 'false');
  check('初始预览是内置标（无 img）', (await imgCount()) === 0);
  check('没传过图时开关不可点', await sw.isDisabled());

  /* ---------- 上传 ---------- */
  await page.setInputFiles('#logo input[type="file"]', {
    name: 'verify-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TEST_PNG_BASE64, 'base64'),
  });
  await page.waitForTimeout(2500);
  check('上传有成功反馈', (await feedback()).includes('图标已更新'), await feedback());
  check('上传后开关自动打开（后端上传即启用）', (await sw.getAttribute('aria-checked')) === 'true');
  check('上传后开关可点', !(await sw.isDisabled()));
  check('预览切到自定义图', (await imgCount()) === 1);

  const iconUploaded = await fetch(`${BASE}/site-icon`);
  check('后端 /site-icon 返回 200', iconUploaded.status === 200, String(iconUploaded.status));

  /* ---------- 开关 ---------- */
  await sw.click();
  await page.waitForTimeout(2000);
  check('关闭后预览回到内置标', (await imgCount()) === 0);
  const iconOff = await fetch(`${BASE}/site-icon`);
  check('关闭后 /site-icon 返回 404（后端同步）', iconOff.status === 404, String(iconOff.status));

  await sw.click();
  await page.waitForTimeout(2000);
  check('重新打开后预览恢复自定义图', (await imgCount()) === 1);
  const iconOn = await fetch(`${BASE}/site-icon`);
  check('重新打开后 /site-icon 返回 200', iconOn.status === 200, String(iconOn.status));

  /* ---------- 删除 ---------- */
  await page.getByRole('button', { name: '删除图标' }).click();
  await page.waitForTimeout(2500);
  check('删除有反馈', (await feedback()).includes('已删除'), await feedback());
  check('删除后预览回到内置标', (await imgCount()) === 0);
  check('删除后按钮变回「选择图片上传」', (await cardText()).includes('选择图片上传'));

  /* ---------- 刷新：确认是真的落库了，不是本地乐观状态 ---------- */
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  check('刷新后仍是内置标（已落库）', (await imgCount()) === 0);
  check('刷新后开关仍是关', (await sw.getAttribute('aria-checked')) === 'false');
} finally {
  await browser.close();
}

console.log(failed === 0 ? '\n🎉 站点图标链路验证通过' : `\n❌ 有 ${failed} 项未通过`);
process.exit(failed === 0 ? 0 : 1);
