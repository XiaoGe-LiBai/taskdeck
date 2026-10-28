'use client';

import { Geometry, Mesh, Program, Renderer, RenderTarget, Triangle } from 'ogl';
import { useEffect, useRef } from 'react';
import { cn } from '@/utils/Helpers';

type SwarmCursorProps = {
  /** 主体色（hex） */
  color?: string;
  /** 高密区域的强调色（hex），metaball 融合处会过渡到它 */
  accentColor?: string;
  /** 粒子数 */
  count?: number;
  size?: number;
  /** metaball 阈值：越大越"紧实"，越小越容易糊成一片 */
  merge?: number;
  glow?: number;
  opacity?: number;
  spread?: number;
  separation?: number;
  speed?: number;
  wander?: number;
  /** 拖尾长度 0~1 */
  trail?: number;
  /** 点击时炸开 */
  scatterOnClick?: boolean;
  enabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

/** 把粒子位置先写进一张 float 纹理（加性混合），再由合成 pass 做 metaball 阈值提取 */
const FIELD_VERT = `
precision highp float;
attribute vec2 position;
attribute vec2 aLocal;
attribute float aWeight;
uniform vec2 uRes;
varying vec2 vLocal;
varying float vWeight;

void main() {
  vLocal = aLocal;
  vWeight = aWeight;
  vec2 clip = (position / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

const FIELD_FRAG = `
precision highp float;
varying vec2 vLocal;
varying float vWeight;

void main() {
  float d = length(vLocal);
  float a = exp(-d * d * 3.6) * vWeight;
  gl_FragColor = vec4(a, a, a, a);
}
`;

const SCREEN_VERT = `
precision highp float;
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const COMP_FRAG = `
precision highp float;
uniform sampler2D tField;
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uMerge;
uniform float uGlow;
uniform float uOpacity;
varying vec2 vUv;

void main() {
  float f = texture2D(tField, vUv).r;

  float edge = uMerge * 0.3;
  float core = smoothstep(uMerge - edge, uMerge + edge, f);
  float halo = smoothstep(uMerge * 0.12, uMerge, f);

  vec3 col = mix(uColor, uAccent, clamp(f / max(uMerge * 2.4, 0.001), 0.0, 1.0));

  float alpha = (core + halo * uGlow * (1.0 - core)) * uOpacity;
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

const hexToRgb = (hex: string): [number, number, number] => {
  let h = (hex || '').replace('#', '').trim();
  if (h.length === 3) {
    h = h.split('').map(c => c + c).join('');
  }
  const n = Number.parseInt(h || '000000', 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Perlin 噪声置换表：打乱 0~255 后复制一倍，省掉越界取模 */
const buildPerm = () => {
  const src = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    src[i] = i;
  }
  for (let i = 255; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const t = src[i]!;
    src[i] = src[j]!;
    src[j] = t;
  }
  const perm = new Uint16Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = src[i & 255]!;
  }
  return perm;
};

const smoothFade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

const gradDot = (h: number, x: number, y: number, z: number) => {
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
};

const noise3 = (perm: Uint16Array, x: number, y: number, z: number) => {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const fz = Math.floor(z);
  const X = fx & 255;
  const Y = fy & 255;
  const Z = fz & 255;
  const rx = x - fx;
  const ry = y - fy;
  const rz = z - fz;
  const u = smoothFade(rx);
  const v = smoothFade(ry);
  const w = smoothFade(rz);

  const A = perm[X]! + Y;
  const AA = perm[A & 511]! + Z;
  const AB = perm[(A + 1) & 511]! + Z;
  const B = perm[(X + 1) & 511]! + Y;
  const BA = perm[B & 511]! + Z;
  const BB = perm[(B + 1) & 511]! + Z;

  const g000 = gradDot(perm[AA & 511]! & 15, rx, ry, rz);
  const g100 = gradDot(perm[BA & 511]! & 15, rx - 1, ry, rz);
  const g010 = gradDot(perm[AB & 511]! & 15, rx, ry - 1, rz);
  const g110 = gradDot(perm[BB & 511]! & 15, rx - 1, ry - 1, rz);
  const g001 = gradDot(perm[(AA + 1) & 511]! & 15, rx, ry, rz - 1);
  const g101 = gradDot(perm[(BA + 1) & 511]! & 15, rx - 1, ry, rz - 1);
  const g011 = gradDot(perm[(AB + 1) & 511]! & 15, rx, ry - 1, rz - 1);
  const g111 = gradDot(perm[(BB + 1) & 511]! & 15, rx - 1, ry - 1, rz - 1);

  const x00 = g000 + u * (g100 - g000);
  const x10 = g010 + u * (g110 - g010);
  const x01 = g001 + u * (g101 - g001);
  const x11 = g011 + u * (g111 - g011);
  const y0 = x00 + v * (x10 - x00);
  const y1 = x01 + v * (x11 - x01);
  return y0 + w * (y1 - y0);
};

/**
 * ReactBits 风格 SwarmCursor：跟随光标的一群发光粒子（噪声流场 + metaball 融合 + 拖尾）。
 *
 * 与官方实现的两点差异（都是为了能当「全屏背景层」用）：
 *  1. 指针事件挂在 window 上，而不是容器上 —— 这样容器可以 pointer-events:none，
 *     否则一个铺满视口的背景层会把后台所有点击都吃掉。
 *  2. WebGL 初始化失败（不支持 / 被禁用）时静默降级为不渲染，绝不让背景层拖垮页面。
 *
 * 渲染管线（官方同款）：粒子先以加性混合写入离屏 RenderTarget，
 * 再由合成 pass 用 smoothstep 做阈值提取，得到「实心核心 + 光晕」的融合效果。
 */
export const SwarmCursor = ({
  color = '#ffffff',
  accentColor = '#ffffff',
  count = 10,
  size = 10,
  merge = 0.77,
  glow = 0.75,
  opacity = 1,
  spread = 100,
  separation = 0.15,
  speed = 2.5,
  wander = 0.25,
  trail = 0.75,
  scatterOnClick = true,
  enabled = true,
  className,
  style,
}: SwarmCursorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // 用 ref 传参，RAF 循环里读最新值，避免每帧重建 WebGL 上下文
  const propsRef = useRef({
    color,
    accentColor,
    count,
    size,
    merge,
    glow,
    opacity,
    spread,
    separation,
    speed,
    wander,
    trail,
    scatterOnClick,
    enabled,
  });
  propsRef.current = {
    color,
    accentColor,
    count,
    size,
    merge,
    glow,
    opacity,
    spread,
    separation,
    speed,
    wander,
    trail,
    scatterOnClick,
    enabled,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        alpha: true,
        dpr: Math.min(window.devicePixelRatio || 1, 1.75),
      });
    } catch {
      // 没有 WebGL 就安静地不渲染，背景层不该影响任何功能
      return undefined;
    }
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.canvas.className = 'swarm-cursor-canvas';
    container.appendChild(gl.canvas);

    const MAX = 120;
    const MAX_QUADS = 6000;
    const HISTORY = 120;
    const positions = new Float32Array(MAX_QUADS * 4 * 2);
    const locals = new Float32Array(MAX_QUADS * 4 * 2);
    const weights = new Float32Array(MAX_QUADS * 4);
    const index = new Uint16Array(MAX_QUADS * 6);
    for (let i = 0; i < MAX_QUADS; i++) {
      const v = i * 4;
      locals.set([-1, -1, 1, -1, 1, 1, -1, 1], v * 2);
      index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }

    const geometry = new Geometry(gl, {
      position: { size: 2, data: positions, usage: gl.DYNAMIC_DRAW },
      aLocal: { size: 2, data: locals },
      aWeight: { size: 1, data: weights, usage: gl.DYNAMIC_DRAW },
      index: { data: index },
    });
    const positionAttr = geometry.attributes.position;
    const weightAttr = geometry.attributes.aWeight;

    const fieldProgram = new Program(gl, {
      vertex: FIELD_VERT,
      fragment: FIELD_FRAG,
      uniforms: { uRes: { value: [1, 1] } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      cullFace: false,
    });
    // 粒子彼此叠加（加性），融合处才会"涨"过 metaball 阈值
    fieldProgram.setBlendFunc(gl.ONE, gl.ONE);
    const fieldMesh = new Mesh(gl, { geometry, program: fieldProgram });

    const compProgram = new Program(gl, {
      vertex: SCREEN_VERT,
      fragment: COMP_FRAG,
      uniforms: {
        tField: { value: null },
        uColor: { value: hexToRgb(propsRef.current.color) },
        uAccent: { value: hexToRgb(propsRef.current.accentColor) },
        uMerge: { value: propsRef.current.merge },
        uGlow: { value: propsRef.current.glow },
        uOpacity: { value: propsRef.current.opacity },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      cullFace: false,
    });
    const compMesh = new Mesh(gl, { geometry: new Triangle(gl), program: compProgram });

    let target: RenderTarget | null = null;
    let cssW = 1;
    let cssH = 1;

    const resize = () => {
      cssW = container.clientWidth || 1;
      cssH = container.clientHeight || 1;
      renderer.setSize(cssW, cssH);
      fieldProgram.uniforms.uRes!.value = [cssW, cssH];
      const w = Math.max(1, Math.round(gl.drawingBufferWidth));
      const h = Math.max(1, Math.round(gl.drawingBufferHeight));
      target = new RenderTarget(gl, { width: w, height: h, depth: false });
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const perm = buildPerm();
    const px = new Float32Array(MAX);
    const py = new Float32Array(MAX);
    const vx = new Float32Array(MAX);
    const vy = new Float32Array(MAX);
    const scale = new Float32Array(MAX);
    const agility = new Float32Array(MAX);
    const handed = new Float32Array(MAX);
    const noiseX = new Float32Array(MAX);
    const noiseY = new Float32Array(MAX);

    const histX = new Float32Array(HISTORY * MAX);
    const histY = new Float32Array(HISTORY * MAX);
    const histT = new Float32Array(HISTORY);
    let histHead = 0;
    let histLen = 0;
    let lastSample = -1;

    const spawn = (i: number, ox: number, oy: number) => {
      const a = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 120;
      px[i] = ox + Math.cos(a) * r;
      py[i] = oy + Math.sin(a) * r;
      vx[i] = Math.cos(a) * 60;
      vy[i] = Math.sin(a) * 60;
      for (let h = 0; h < HISTORY; h++) {
        histX[h * MAX + i] = px[i]!;
        histY[h * MAX + i] = py[i]!;
      }
    };

    for (let i = 0; i < MAX; i++) {
      spawn(i, cssW * 0.5, cssH * 0.5);
      scale[i] = 0.65 + Math.random() * 0.6;
      agility[i] = 0.75 + Math.random() * 0.5;
      handed[i] = Math.random() < 0.5 ? -1 : 1;
      noiseX[i] = Math.random() * 260;
      noiseY[i] = Math.random() * 260;
    }

    const cursor = { x: cssW * 0.5, y: cssH * 0.5, has: false };
    let burst = 0;
    let activeCount = Math.max(1, Math.min(MAX, Math.round(propsRef.current.count)));

    const toLocal = (clientX: number, clientY: number) => {
      const r = container.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = toLocal(e.clientX, e.clientY);
      cursor.x = x;
      cursor.y = y;
      cursor.has = true;
    };
    const onLeave = () => {
      cursor.has = false;
    };
    const onDown = (e: PointerEvent) => {
      if (!propsRef.current.scatterOnClick || !propsRef.current.enabled) {
        return;
      }
      const { x: cx, y: cy } = toLocal(e.clientX, e.clientY);
      const escape = 620 + propsRef.current.speed * 130;
      for (let i = 0; i < MAX; i++) {
        let dx = px[i]! - cx;
        let dy = py[i]! - cy;
        let d = Math.hypot(dx, dy);
        if (d < 1e-3) {
          const a = Math.random() * Math.PI * 2;
          dx = Math.cos(a);
          dy = Math.sin(a);
          d = 1;
        }
        const kick = escape * (0.75 + Math.random() * 0.5);
        vx[i] = (dx / d) * kick;
        vy[i] = (dy / d) * kick;
      }
      burst = 1;
    };
    // 监听 window：容器本身是 pointer-events:none，收不到事件
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown);
    document.documentElement.addEventListener('pointerleave', onLeave);

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const p = propsRef.current;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      if (!p.enabled || reduceMotion) {
        // 只跑合成 pass：tField 还没写过 → 采样恒为 0 → 整屏 discard（等于不显示）
        renderer.render({ scene: compMesh });
        return;
      }

      const n = Math.max(1, Math.min(MAX, Math.round(p.count)));
      const anchorX = cursor.has ? cursor.x : cssW * 0.5;
      const anchorY = cursor.has ? cursor.y : cssH * 0.5;

      for (let i = activeCount; i < n; i++) {
        spawn(i, anchorX, anchorY);
      }
      activeCount = n;

      const t = now * 0.001;
      burst = Math.max(0, burst - dt / 0.5);

      const maxSpeed = 110 + Math.max(0.1, p.speed) * 165;
      const steerRate = 4.5 + Math.max(0.1, p.speed) * 1.15;
      const maxForce = maxSpeed * 9;
      const band = Math.max(20, p.spread * 0.55);
      const sepDist = Math.max(1, p.spread * 0.42 * (0.35 + p.separation));
      const flowMix = p.wander * 2.4;
      const eps = 0.08;
      const baseScale = 0.0016;
      const fineScale = baseScale * 3.6;

      for (let i = 0; i < n; i++) {
        const dx = anchorX - px[i]!;
        const dy = anchorY - py[i]!;
        const dist = Math.hypot(dx, dy) || 1e-4;
        const ux = dx / dist;
        const uy = dy / dist;

        // 每颗粒子在「环绕半径」附近做涡旋，半径由噪声缓慢漂移 → 群体不会定格成圆环
        const orbitDrift = noise3(perm, noiseX[i]!, noiseY[i]!, t * 0.13);
        const orbit = band * (0.34 + 1.35 * Math.max(0, Math.min(1, orbitDrift + 0.5)));

        const radial = Math.max(-1, Math.min(1, (dist - orbit) / (band * 0.85)));
        const swirl = Math.sqrt(Math.max(0, 1 - radial * radial)) * handed[i]!;

        let wishX = ux * radial - uy * swirl;
        let wishY = uy * radial + ux * swirl;

        if (flowMix > 0.001) {
          // 两级噪声（粗 + 细）梯度当流场，让运动有"活物"感而不是纯弹簧
          const bx = px[i]! * baseScale;
          const by = py[i]! * baseScale;
          const bt = t * 0.22;
          const coarseX
            = (noise3(perm, bx, by + eps, bt) - noise3(perm, bx, by - eps, bt)) / (2 * eps);
          const coarseY
            = -(noise3(perm, bx + eps, by, bt) - noise3(perm, bx - eps, by, bt)) / (2 * eps);

          const fx = px[i]! * fineScale + noiseX[i]!;
          const fy = py[i]! * fineScale + noiseY[i]!;
          const ft = t * 0.55;
          const fineX = (noise3(perm, fx, fy + eps, ft) - noise3(perm, fx, fy - eps, ft)) / (2 * eps);
          const fineY = -(noise3(perm, fx + eps, fy, ft) - noise3(perm, fx - eps, fy, ft)) / (2 * eps);

          wishX += (coarseX + fineX * 0.7) * flowMix;
          wishY += (coarseY + fineY * 0.7) * flowMix;
        }

        const wl = Math.hypot(wishX, wishY) || 1e-4;
        wishX /= wl;
        wishY /= wl;

        const rate = steerRate * agility[i]! * (1 - burst);
        let ax = (wishX * maxSpeed - vx[i]!) * rate;
        let ay = (wishY * maxSpeed - vy[i]!) * rate;

        if (burst > 0.001) {
          ax -= ux * maxSpeed * burst * 5.5;
          ay -= uy * maxSpeed * burst * 5.5;
        }

        // 两两斥力：避免长时间重叠成一坨
        for (let j = 0; j < n; j++) {
          if (j === i) {
            continue;
          }
          const sx = px[i]! - px[j]!;
          const sy = py[i]! - py[j]!;
          const d2 = sx * sx + sy * sy;
          if (d2 > 1e-4 && d2 < sepDist * sepDist) {
            const d = Math.sqrt(d2);
            const f = (1 - d / sepDist) * maxSpeed * 3.2 * p.separation;
            ax += (sx / d) * f;
            ay += (sy / d) * f;
          }
        }

        const al = Math.hypot(ax, ay);
        const cap = maxForce * (1 + burst * 4);
        if (al > cap) {
          ax = (ax / al) * cap;
          ay = (ay / al) * cap;
        }

        vx[i] = vx[i]! + ax * dt;
        vy[i] = vy[i]! + ay * dt;

        // 夹住速度上下限：太快看不出融合，太慢会"爬"
        const sp = Math.hypot(vx[i]!, vy[i]!);
        const hi = maxSpeed * (1 + burst * 3.5);
        const lo = maxSpeed * 0.32;
        if (sp > hi) {
          vx[i] = (vx[i]! / sp) * hi;
          vy[i] = (vy[i]! / sp) * hi;
        } else if (sp < lo && sp > 1e-4) {
          vx[i] = (vx[i]! / sp) * lo;
          vy[i] = (vy[i]! / sp) * lo;
        }

        px[i] = px[i]! + vx[i]! * dt;
        py[i] = py[i]! + vy[i]! * dt;
      }

      const nowSec = now * 0.001;
      if (lastSample < 0 || nowSec - lastSample >= 0.008) {
        lastSample = nowSec;
        histT[histHead] = nowSec;
        const base = histHead * MAX;
        for (let i = 0; i < n; i++) {
          histX[base + i] = px[i]!;
          histY[base + i] = py[i]!;
        }
        histHead = (histHead + 1) % HISTORY;
        if (histLen < HISTORY) {
          histLen++;
        }
      }

      const trailAge = p.trail * 0.85;
      const perAgent = Math.max(0, Math.floor(MAX_QUADS / n) - 1);
      const maxStamps = Math.min(46, perAgent);

      let quad = 0;
      const pushQuad = (cx: number, cy: number, r: number, w: number) => {
        const v = quad * 8;
        positions[v] = cx - r;
        positions[v + 1] = cy - r;
        positions[v + 2] = cx + r;
        positions[v + 3] = cy - r;
        positions[v + 4] = cx + r;
        positions[v + 5] = cy + r;
        positions[v + 6] = cx - r;
        positions[v + 7] = cy + r;
        const o = quad * 4;
        weights[o] = w;
        weights[o + 1] = w;
        weights[o + 2] = w;
        weights[o + 3] = w;
        quad++;
      };

      for (let i = 0; i < n; i++) {
        const headR = p.size * scale[i]! * 2.1;
        const headW = 1.06 + 0.3 * scale[i]!;
        pushQuad(px[i]!, py[i]!, headR, headW);

        if (trailAge < 0.01 || maxStamps < 2 || histLen < 2) {
          continue;
        }

        // 沿历史轨迹按固定步长盖章，半径随距离衰减 → 拖尾自然收尖
        const step = Math.max(2, p.size * scale[i]! * 0.5);
        const span = step * maxStamps;

        let prevX = px[i]!;
        let prevY = py[i]!;
        let walked = 0;
        let nextAt = step;
        let stamps = 0;

        for (let j = 0; j < histLen && stamps < maxStamps; j++) {
          const slot = (histHead - 1 - j + HISTORY) % HISTORY;
          if (nowSec - histT[slot]! > trailAge) {
            break;
          }
          const hx = histX[slot * MAX + i]!;
          const hy = histY[slot * MAX + i]!;
          const segX = hx - prevX;
          const segY = hy - prevY;
          const segLen = Math.hypot(segX, segY);
          if (segLen < 1e-4) {
            continue;
          }

          while (nextAt <= walked + segLen && stamps < maxStamps) {
            const f = (nextAt - walked) / segLen;
            const u = nextAt / span;
            const taper = Math.max(0, 1 - u) ** 0.55;
            const rLocal = headR * taper;
            if (rLocal < step) {
              stamps = maxStamps;
              break;
            }
            const stampW = Math.min(headW, (headW * step) / (rLocal * 0.934));
            pushQuad(prevX + segX * f, prevY + segY * f, rLocal, stampW);
            stamps++;
            nextAt += step;
          }

          walked += segLen;
          prevX = hx;
          prevY = hy;
        }
      }

      if (positionAttr) {
        positionAttr.needsUpdate = true;
      }
      if (weightAttr) {
        weightAttr.needsUpdate = true;
      }
      geometry.setDrawRange(0, quad * 6);

      compProgram.uniforms.uColor!.value = hexToRgb(p.color);
      compProgram.uniforms.uAccent!.value = hexToRgb(p.accentColor);
      compProgram.uniforms.uMerge!.value = p.merge;
      compProgram.uniforms.uGlow!.value = p.glow;
      compProgram.uniforms.uOpacity!.value = p.opacity;

      // 第一趟：粒子场写进离屏纹理
      if (target) {
        renderer.render({ scene: fieldMesh, target, clear: true });
        compProgram.uniforms.tField!.value = target.texture;
      }
      // 第二趟：阈值合成到屏幕
      renderer.render({ scene: compMesh });
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      if (gl.canvas.parentElement === container) {
        container.removeChild(gl.canvas);
      }
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) {
        lose.loseContext();
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn('swarm-cursor', className)}
      style={style}
    />
  );
};
