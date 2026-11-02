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
  const toRgba = (color) => {
    try {
      probeCtx.clearRect(0, 0, 1, 1);
      probeCtx.fillStyle = color;
      probeCtx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = probeCtx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: a / 255 };
    } catch {
      return { r: 0, g: 0, b: 0, a: 1 };
    }
  };

  // 背景可能是 15% 透明色，必须逐层与父级合成，否则算出来的对比度是假的
  const backgroundColorOf = (el) => {
    const stack = [];
    let node = el;
    while (node) {
      const layer = toRgba(getComputedStyle(node).backgroundColor);
      if (layer.a > 0.001) {
        stack.push(layer);
      }
      node = node.parentElement;
    }
    stack.push({ r: 255, g: 255, b: 255, a: 1 });
    let out = { r: 255, g: 255, b: 255 };
    for (const layer of stack.reverse()) {
      out = {
        r: layer.r * layer.a + out.r * (1 - layer.a),
        g: layer.g * layer.a + out.g * (1 - layer.a),
        b: layer.b * layer.a + out.b * (1 - layer.a),
      };
    }
    return out;
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
    const fgRaw = toRgba(style.color);
    const bgRaw = backgroundColorOf(el);
    const fg = [
      fgRaw.r * fgRaw.a + bgRaw.r * (1 - fgRaw.a),
      fgRaw.g * fgRaw.a + bgRaw.g * (1 - fgRaw.a),
      fgRaw.b * fgRaw.a + bgRaw.b * (1 - fgRaw.a),
    ];
    const bg = [bgRaw.r, bgRaw.g, bgRaw.b];
    const r = ratio(fg, bg);
    if (r < 4.5) {
      bad.push({ text: text.slice(0, 24), ratio: Number(r.toFixed(2)), color: style.color, bg: bgOf(el), tag: el.tagName });
    }
    seen.push(1);
  }
  return { sampled: seen.length, bad: bad.slice(0, 12).map(b => ({ text: b.text, ratio: b.ratio, tag: b.tag })), badCount: bad.length };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
