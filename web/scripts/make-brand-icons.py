#!/usr/bin/env python3
"""
生成「托管鸭」站点图标（favicon 全套）。

品牌渐变取自 web/src/styles/global.css 的 --brand-* 变量（用浏览器 canvas 取过权威 sRGB）：

    --brand-from  oklch(0.74 0.17 55)   →  #fa8927  橙
    --brand-via   oklch(0.65 0.23 12)   →  #fa3569  红
    --brand-to    oklch(0.58 0.21 300)  →  #9051e1  紫

改品牌色后重跑本脚本同步图标：

    python3 scripts/make-brand-icons.py

几何与 src/components/BrandMark.tsx 的内联 SVG **同源**（同一组坐标常量），
改形时两边要一起改 —— 这里没有 svg→png 工具链，只能靠人工同步。
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

# ---------------------------------------------------------------- 几何（1024 基准）
# 侧面朝右的鸭头：圆头 + 右侧扁喙 + 靠喙一侧的镂空眼。
# 眼睛**必须**放在头的前半侧（靠喙那边）—— 放到后脑勺会读成"带尾巴的气泡"，
# 这是调这个图形时踩过的坑，16px 下尤其明显。
CANVAS = 1024
CORNER_RADIUS = 226  # 约 22%，贴近 iOS squircle

HEAD_CENTER = (356, 505)
HEAD_RADIUS = 250

BEAK_BOX = (500, 470, 906, 646)  # 左端伸进头内，保证与头连成一体
BEAK_RADIUS = 88

EYE_CENTER = (392, 384)
EYE_RADIUS = 56

# ---------------------------------------------------------------- 品牌渐变
STOPS = [
    (0.00, (0xFA, 0x89, 0x27)),
    (0.52, (0xFA, 0x35, 0x69)),
    (1.00, (0x90, 0x51, 0xE1)),
]

OUT_DIR = Path(__file__).resolve().parent.parent / 'public'


def color_at(t: float) -> tuple[int, int, int]:
    """三色停靠的线性插值；t 超出 [0,1] 时钳制到端点。"""
    t = min(1.0, max(0.0, t))
    for (p0, c0), (p1, c1) in zip(STOPS, STOPS[1:]):
        if t <= p1:
            k = 0.0 if p1 == p0 else (t - p0) / (p1 - p0)
            return tuple(round(a + (b - a) * k) for a, b in zip(c0, c1))
    return STOPS[-1][1]


def gradient(size: int) -> Image.Image:
    """
    CSS `linear-gradient(135deg, …)` 在正方形里的等价实现。

    135deg 的方向向量是右下 (0.707, 0.707)，渐变线从左下角到右上角，
    于是归一化参数正好是 t = (x + y) / (w + h)。颜色只跟 x+y 有关，
    所以按对角线预计算一次即可，不用逐像素算插值。
    """
    denom = 2 * (size - 1)
    diag = [bytes(color_at(s / denom)) for s in range(2 * size - 1)]
    # 第 y 行取 diag[y : y + size]，逐行拼起来就是整幅图
    data = b''.join(b''.join(diag[y:y + size]) for y in range(size))
    return Image.frombytes('RGB', (size, size), data)


def build_master() -> Image.Image:
    """1024 基准图：圆角渐变底 + 白色鸭头剪影（眼睛镂空露出底色）。"""
    size = CANVAS

    # 圆角方形蒙版
    round_mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(round_mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=CORNER_RADIUS, fill=255,
    )

    # 鸭子剪影（白）
    duck = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(duck)
    hx, hy = HEAD_CENTER
    draw.ellipse((hx - HEAD_RADIUS, hy - HEAD_RADIUS, hx + HEAD_RADIUS, hy + HEAD_RADIUS), fill=255)
    draw.rounded_rectangle(BEAK_BOX, radius=BEAK_RADIUS, fill=255)
    ex, ey = EYE_CENTER
    draw.ellipse((ex - EYE_RADIUS, ey - EYE_RADIUS, ex + EYE_RADIUS, ey + EYE_RADIUS), fill=0)  # 挖眼

    # 合成：先铺渐变，再把鸭子刷白（鸭子被圆角蒙版裁掉，眼睛处留空露出渐变）
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(gradient(size), (0, 0), round_mask)
    out.paste(Image.new('RGBA', (size, size), (255, 255, 255, 255)), (0, 0),
              ImageChops.multiply(duck, round_mask))
    return out


def preview(master: Image.Image, px: int = 32) -> None:
    """
    终端字符画预览。没有图形界面时用它调形 —— 16/32px 下认不认得出是鸭子，
    看字符画比看大图更接近真实观感。
    """
    im = master.resize((px, px), Image.LANCZOS).convert('RGBA')
    print(f'  {px}x{px} 预览（# 鸭子 / + 渐变底 / . 圆角外透明）')
    for y in range(px):
        row = ''
        for x in range(px):
            r, g, b, a = im.getpixel((x, y))
            if a < 128:
                row += '.'
            elif r > 245 and g > 245 and b > 245:
                row += '#'
            else:
                row += '+'
        print(f'  {row}')
    print()


def main() -> None:
    master = build_master()
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    preview(master, 32)

    # 超采样后 LANCZOS 缩小，边缘比直接在小画布上画干净得多
    targets = {
        'favicon-16x16.png': 16,
        'favicon-32x32.png': 32,
        'apple-touch-icon.png': 180,
    }
    for name, px in targets.items():
        path = OUT_DIR / name
        master.resize((px, px), Image.LANCZOS).save(path)
        print(f'  {name:<24} {px}x{px}')

    # .ico 里塞多尺寸，浏览器按需取（16 任务栏 / 32 标签页 / 48 桌面快捷方式）
    ico = OUT_DIR / 'favicon.ico'
    master.resize((256, 256), Image.LANCZOS).save(
        ico, sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print(f'  {"favicon.ico":<24} 16/32/48')


if __name__ == '__main__':
    main()
