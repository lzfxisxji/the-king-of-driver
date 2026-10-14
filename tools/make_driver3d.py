# -*- coding: utf-8 -*-
"""
从 assets/chars/{key}_drive.png 采样每个角色的「肩部锚点 + 手臂颜色」，
生成 tools/driver3d_config.js —— 3D 卡丁车驾驶员（精灵 + 3D 手臂）配置。

· 锚点 (ax, ay) = 手臂起点（肩）在 240x320 画布上的比例坐标，
  3D 端映射：x = (ax-0.5)*planeW，y = planeCenterY + (0.5-ay)*planeH；
· 颜色 = 锚点附近不透明像素的中位数 —— 手臂颜色自动贴合每个角色的身体色，
  不需要手工调色。
"""
import os
import statistics

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'assets', 'chars')
OUT = os.path.join(HERE, 'driver3d_config.js')

ORDER = ['lulu', 'kangaroo', 'nailong', 'niulai', 'doubao', 'driver']

# 每角色配置：
#   ax/ay      3D 手臂锚点（肩）在内容 bbox 内的相对位置
#   cx/cy      颜色采样点（缺省=锚点）
#   arm_fixed  固定手臂色（不采样）
#   hand_from_front  手部肤色取自正面贴图脸颊
SPEC = {
    'default': dict(ax=0.12, ay=0.52),                       # 团子角色：肩侧取身体色
    # 豆包是「人形女孩」：肩点在发脚两侧，手臂取黑 T 恤衣摆色，手取正面脸颊肤色
    'doubao':  dict(ax=0.14, ay=0.60, cx=0.50, cy=0.95, hand_from_front=True),
    # 老司机背面只有头发+脖子：肩点在发脚两侧，手臂用固定深色上衣，手取脸颊肤色
    'driver':  dict(ax=0.14, ay=0.62, arm_fixed='#3c414b', hand_from_front=True),
}


def sample(im, cx, cy, r=4):
    px = im.load()
    cols = []
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            x, y = cx + dx, cy + dy
            if 0 <= x < im.width and 0 <= y < im.height:
                p = px[x, y]
                if p[3] > 200:
                    cols.append((p[0], p[1], p[2]))
    if not cols:
        return None
    med = tuple(int(statistics.median(c[i] for c in cols)) for i in range(3))
    return '#%02x%02x%02x' % med


def sample_front_skin(key):
    """从正面驾驶位贴图下部（脸颊）取肤色当手色。"""
    im = Image.open(os.path.join(SRC, key + '_drive_front.png')).convert('RGBA')
    b = im.split()[-1].getbbox()
    x = (b[0] + b[2]) // 2
    y = int(b[1] + 0.80 * (b[3] - b[1]))
    return sample(im, x, y, r=3)


def main():
    drivers = {}
    for key in ORDER:
        im = Image.open(os.path.join(SRC, key + '_drive.png')).convert('RGBA')
        bbox = im.split()[-1].getbbox()
        L, T, R, B = bbox
        bw, bh = R - L, B - T
        sp = dict(SPEC['default'], **SPEC.get(key, {}))
        ax = int(round(L + sp['ax'] * bw))
        ay = int(round(T + sp['ay'] * bh))
        cx = int(round(L + sp.get('cx', sp['ax']) * bw))
        cy = int(round(T + sp.get('cy', sp['ay']) * bh))
        arm = sp.get('arm_fixed') or sample(im, cx, cy) or '#ffd24d'
        hand = sample_front_skin(key) if sp.get('hand_from_front') else arm
        hand = hand or arm
        drivers[key] = {
            'ax': round(ax / 240.0, 4),
            'ay': round(ay / 320.0, 4),
            'arm': arm,
            'hand': hand,
        }
        print('  %-9s 锚点(%d,%d) 胳臂 %s 手 %s bbox=%s' % (key, ax, ay, arm, hand, bbox))

    js = ['/* 自动生成：tools/make_driver3d.py —— 3D 驾驶员配置（勿手工改，重跑脚本再生成） */',
          'export const DRIVER_ORDER = %s;' % json_dumps(ORDER),
          'export const DRIVERS = {']
    for k in ORDER:
        d = drivers[k]
        js.append("  %s: { ax: %s, ay: %s, arm: '%s', hand: '%s' }," %
                  (k, d['ax'], d['ay'], d['arm'], d['hand']))
    js.append('};')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(js) + '\n')
    print('写出 ->', OUT)


def json_dumps(arr):
    return '[' + ', '.join("'%s'" % a for a in arr) + ']'


if __name__ == '__main__':
    main()
