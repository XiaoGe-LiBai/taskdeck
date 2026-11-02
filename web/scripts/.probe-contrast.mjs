import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const token = readFileSync('/tmp/tok.txt', 'utf8').trim();
const base = 'http://127.0.0.1:13002';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
await ctx.addCookies([{ name: 'xc_panel_token', value: token, url: base }]);
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('xc_theme', 'dark'));
await page.goto(`${base}/dashboard/xiaocan`, { waitUntil: 'networkidle' });
const closeBtn = page.getByRole('button', { name: '关闭' });
if (await closeBtn.count()) { await closeBtn.click(); await page.waitForTimeout(300); }

const result = await page.evaluate(() => {
  // 直接用 canvas 画一个像素再读回来：这样 oklch()/lab() 也会被浏览器转成 sRGB
  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;
  const probeCtx = probe.getContext('2d', { willReadFrequently: true });
  const toRgb = (color) => {
    try {
      probeCtx.clearRect(0, 0, 1, 1);
      probeCtx.fillStyle = color;
      probeCtx.fillRect(0, 0, 1, 1);
      const [r, g, b] = probeCtx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    } catch {
      return [0, 0, 0];
    }
  };
  const lum = ([r, g, b]) => {
    const f = (x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const bgOf = (el) => {
    let node = el;
    while (node) {
      const c = getComputedStyle(node).backgroundColor;
      if (c && !c.includes('rgba(0, 0, 0, 0)') && !c.includes('transparent')) return c;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };

  const seen = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const bad = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.trim();
    if (!text) continue;
    const el = walker.currentNode.parentElement;
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.3) continue;
    // 渐变文字是 color:transparent + background-clip:text，不算对比度问题
    if (style.color.includes('rgba(0, 0, 0, 0)')) continue;
    const fg = toRgb(style.color);
    const bg = toRgb(bgOf(el));
    const r = ratio(fg, bg);
    if (r < 4.5) {
      bad.push({ text: text.slice(0, 24), ratio: Number(r.toFixed(2)), color: style.color, bg: bgOf(el), tag: el.tagName });
    }
    seen.push(1);
  }
  return { sampled: seen.length, bad: bad.slice(0, 12), badCount: bad.length };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
