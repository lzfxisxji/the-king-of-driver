# -*- coding: utf-8 -*-
"""
把「车尾立绘」批量转成「敞篷 / 开放驾驶舱」造型。

思路：车顶 + 后窗属于「驾驶舱以上」的部分，对 Q 版敞篷赛车来说要拿掉——
      在腰线处水平切掉顶部，并在车身中央切出一个 U 形下沉（驾驶舱开口），
      这样角色贴图从车后探出来时，读起来就是「人坐在车里」而不是「两张图叠加」。

用法：
  python tools/make_open.py probe     # 生成带标尺的对照图（人工确认腰线）
  python tools/make_open.py build     # 按 BELT 表批量转换并生成结果对照图
"""
import os
import sys
import math
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CARS = os.path.join(ROOT, 'assets', 'cars')
OUT = os.path.join(ROOT, 'tools', 'out')

# 启用为「敞篷」的 9 辆车（config.js 中 CARS 前九项）
TARGETS = [
    'car_r2c0', 'car_r2c1', 'car_r2c2', 'car_r2c3', 'car_r2c4',
    'car_r0c0', 'car_r0c1', 'car_r0c2', 'car_r0c3',
]

# 每辆车的腰线（占 alpha 包围盒高度的比例）：切掉这条线以上的一切。
# 数值由「逐行中央/外侧深色与蓝色占比」实测得到（窗带下沿 = 后箱盖顶边）。
BELT = {
    'car_r2c0': 0.335,   # 白色猎鹰（跑车）
    'car_r2c1': 0.345,   # 赤红闪电
    'car_r2c2': 0.335,   # 湛蓝战神
    'car_r2c3': 0.375,   # 暗夜幽灵（全黑车身，按宽度剖面取凹陷处）
    'car_r2c4': 0.345,   # 橘焰狂风（带尾翼）
    'car_r0c0': 0.485,   # 沙漠SUV（后窗很大，腰线明显偏下）
    'car_r0c1': 0.385,   # 白银轿车
    'car_r0c2': 0.325,   # 蜜糖小跑
    'car_r0c3': 0.365,   # 烈焰红轿
}

# 驾驶舱开口：中央这一段再往下多切一点，形成 U 形下沉（坐舱开口感）
DIP = 0.05           # 额外下沉比例
DIP_X0, DIP_X1 = 0.22, 0.78


def bbox_of(im):
    return im.split()[-1].getbbox()


def row_width(im, y, l, r):
    px = im.load()
    n = 0
    for x in range(l, r):
        if px[x, y][3] > 40:
            n += 1
    return n


def make_open(src, k, dip=DIP):
    im = Image.open(src).convert('RGBA')
    bb = bbox_of(im)
    l, t, r, b = bb
    W, H = r - l, b - t
    px = im.load()
    for x in range(l, r):
        u = (x - l) / float(W)
        if u <= DIP_X0 or u >= DIP_X1:
            f = 0.0
        else:
            a = (u - DIP_X0) / (DIP_X1 - DIP_X0)
            f = math.sin(math.pi * a) ** 0.7        # 两端平滑过渡，中间最深
        cut = t + H * (k + dip * f)
        for y in range(t, int(round(cut))):
            if px[x, y][3] > 0:
                px[x, y] = (0, 0, 0, 0)
    # 去掉上方残留的孤立小块（行李架 / 后视镜碎片）
    im = strip_specks(im, min_px=int(W * H * 0.004))
    bb2 = bbox_of(im)
    if bb2:
        im = im.crop(bb2)
    return im


def strip_specks(im, min_px):
    """把 alpha 连通域里面积过小的块抹掉（避免残留飘浮的行李架碎片）。"""
    from collections import deque
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    for y0 in range(h):
        for x0 in range(w):
            if px[x0, y0][3] > 40 and not seen[y0 * w + x0]:
                q = deque([(x0, y0)])
                seen[y0 * w + x0] = 1
                blob = []
                while q:
                    x, y = q.popleft()
                    blob.append((x, y))
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and px[nx, ny][3] > 40:
                            seen[ny * w + nx] = 1
                            q.append((nx, ny))
                if len(blob) < min_px:
                    for x, y in blob:
                        px[x, y] = (0, 0, 0, 0)
    return im


def sheet(items, path, cols=5, cell=190):
    rows = (len(items) + cols - 1) // cols
    sh = Image.new('RGB', (cols * cell, rows * (cell + 20)), (232, 238, 247))
    d = ImageDraw.Draw(sh)
    for i, (name, im) in enumerate(items):
        im2 = im.copy()
        im2.thumbnail((cell - 18, cell - 18), Image.LANCZOS)
        bg = Image.new('RGBA', im2.size, (255, 255, 255, 255))
        bg.alpha_composite(im2)
        x, y = (i % cols) * cell, (i // cols) * (cell + 20)
        sh.paste(bg.convert('RGB'), (x + 9, y + 9))
        d.text((x + 10, y + cell + 2), '%s  %dx%d' % (name, im.width, im.height), fill=(20, 30, 50))
    sh.save(path)
    return sh


def probe():
    """带 10% 标尺的原始图，用来人工确认腰线。"""
    items = []
    for f in TARGETS:
        im = Image.open(os.path.join(CARS, f + '.png')).convert('RGBA')
        bb = bbox_of(im)
        l, t, r, b = bb
        H = b - t
        c = im.copy()
        d = ImageDraw.Draw(c)
        for yy in range(1, 10):
            y = t + int(H * yy / 10.0)
            d.line([(l - 6, y), (r + 6, y)], fill=(255, 0, 128, 190), width=1)
            d.text((l - 34, y - 5), '%d0%%' % yy, fill=(200, 0, 90))
        items.append((f, c.crop((max(0, l - 38), max(0, t - 4), min(c.width, r + 8), b + 4))))
    p = os.path.join(OUT, '_open_probe.png')
    sheet(items, p, cols=3, cell=250)
    print('probe ->', p)


def build():
    items = []
    for f in TARGETS:
        src = os.path.join(CARS, f + '.png')
        k = BELT.get(f, 0.44)
        im = make_open(src, k)
        im.save(src)                      # 直接替换（原件已备份到 assets/cars_orig）
        items.append((f, im))
        print('  %-10s belt=%.2f -> %dx%d' % (f, k, im.width, im.height))
    p = os.path.join(OUT, '_open_sheet.png')
    sheet(items, p, cols=5, cell=200)
    print('sheet ->', p)


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'probe'
    (probe if mode == 'probe' else build)()
