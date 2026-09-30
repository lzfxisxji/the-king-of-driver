# -*- coding: utf-8 -*-
"""
生成「驾驶位」角色贴图（两套，共用同一张 240x320 画布）：

    assets/chars/{key}_drive.png        游戏内用  —— 第三人称跟车视角 → 背面
    assets/chars/{key}_drive_front.png  选人界面用 —— 角色正对着玩家   → 正面

设计要点：
  · 只保留角色「头 + 肩 + 一点胸」的上半身，**不画方向盘、不画双手**；
  · 所有角色共用同一张画布与同一套骨架（240x320，AR 固定 1.3333），
    换角色 / 换车只换图片，尺寸与位置全部由 config.js 的
    carSize() / driverMetrics() 推导，前后两套贴图也共用同一骨架；
  · 画布底部 = 坐姿基线。上半身底边压在 OCCLUDE + TUCK 处 ——
    比车身上缘的遮挡线（= 0.74H，见 src/config.js 的 seatRatio）更低，
    所以车会把角色的下摆吃掉，看不到「人浮在车上」的缝；
    每个角色露出的比例都是 「1 - OCCLUDE - TUCK」不变，换人不跳。
"""
import os

from PIL import Image, ImageDraw

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'chars')
OUT = SRC

W, H = 240, 320                 # 统一画布（AR = 1.3333）
AR_CANVAS = H / float(W)

# 上半身底边必须比「车身上缘遮挡线」更低，才能把下摆藏干净。
#   遮挡线 = (1 - DRIVER_SEAT.seatRatio) = 1 - 0.26 = 0.74（见 src/config.js）
OCCLUDE = 0.74                  # 车身上缘遮挡线（画布高度比例）
TUCK = 0.20                     # 下摆往车身里再埋「内容高度 × TUCK」
BODY_MAXW = 0.88                # 上半身最大宽度（画布宽度比例）
BODY_MAXH = 0.78                # 上半身最大高度（画布高度比例）

# 「头肩块」目标高宽比（h / w）：0.90 ≈ 头 + 一点肩。
#   裁完会再按内容收紧左右，所以这个值只决定「这一块留多少身体」。
TORSO_AR = 0.90

# key、正对面朝素材、游戏内（背面）素材、该角色的头肩块高宽比
CHARS = [
    ('lulu',     'lulu_1',     'lulu_3',      TORSO_AR),
    ('kangaroo', 'kangaroo_1', 'kangaroo_3',  TORSO_AR),
    ('nailong',  'nailong_1',  'nailong_3',   TORSO_AR),
    ('niulai',   'niulai_1',   'niulai_3',    TORSO_AR),
    ('doubao',   'doubao_1',   'doubao_3',    TORSO_AR),
    # 老司机：正面图自带方向盘 → 裁得紧一点，到肩为止、不带盘；
    #         游戏内用唯一一张「头肩」素材（driver_head.png 本身不含方向盘）
    ('driver',   'driver_1',   'driver_head', 0.72),
]

RAW = {'driver_head'}           # 已自带「头肩」的素材：不再按比例裁切


def bbox_of(im):
    b = im.split()[-1].getbbox()
    return b or (0, 0, im.width, im.height)


def head_shoulders(im, torso_ar):
    """从素材顶部裁出「头 (+ 肩)」的一段。

    高度 = 素材宽 × torso_ar；裁完再按内容收紧左右 —— 这样后面
    「缩放到吃满画布宽度」才真正等于「这一块最宽的那一行吃满画布」，
    否则人形角色会拿整个身体的宽度当基准，头被缩得很小。
    """
    im = im.crop(bbox_of(im))
    w, h = im.size
    need = int(round(w * torso_ar))
    if need < h:
        im = im.crop((0, 0, w, need))
    return im.crop(bbox_of(im))


def fit(im, maxw, maxh):
    """等比缩放到 宽<=maxw 且 高<=maxh（宽优先）。"""
    w, h = im.size
    s = min(maxw / w, maxh / h)
    return im.resize((max(1, int(round(w * s))), max(1, int(round(h * s)))), Image.LANCZOS)


def compose(src_name, torso_ar):
    """把某张素材合成到统一画布上，返回 (画布, 主体尺寸)。"""
    im = Image.open(os.path.join(SRC, src_name + '.png')).convert('RGBA')
    if src_name not in RAW:
        im = head_shoulders(im, torso_ar)
    im = fit(im, BODY_MAXW * W, BODY_MAXH * H)

    # 下摆埋进车身：遮挡线以下再多埋 TUCK 比例，露出的部分恒定 ≈ (1-OCCLUDE-TUCK) / 1
    bottom = min(H, int(round(OCCLUDE * H + im.height * TUCK)))
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((W - im.width) // 2, bottom - im.height))
    return canvas, im


def build(key, front_src, game_src, torso_ar):
    game, gim = compose(game_src, torso_ar)
    front, fim = compose(front_src, torso_ar)
    game.save(os.path.join(OUT, key + '_drive.png'))
    front.save(os.path.join(OUT, key + '_drive_front.png'))
    print('  %-9s 游戏内 %-11s %dx%d | 正面 %-11s %dx%d | 画布 %dx%d'
          % (key, game_src, gim.width, gim.height, front_src, fim.width, fim.height, W, H))
    return game, front


if __name__ == '__main__':
    print('生成驾驶位贴图（统一画布 %dx%d，无方向盘 / 无双手）：' % (W, H))
    made = []
    for k, fs, gs, ta in CHARS:
        try:
            made.append((k,) + build(k, fs, gs, ta))
        except Exception as e:
            print('  !! %s failed: %s' % (k, e))

    # 对照表：白底 + 遮挡线（= 车身上缘，贴图高度的 74% 处）
    cell, cols = 250, 6
    rows = (len(made) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell, rows * 2 * (cell + 20)), (238, 243, 250))
    d = ImageDraw.Draw(sheet)
    for i, (k, game, front) in enumerate(made):
        for j, (tag, m) in enumerate((('game', game), ('front', front))):
            bg = Image.new('RGBA', m.size, (255, 255, 255, 255))
            bg.alpha_composite(m)
            bgr = bg.convert('RGB')
            y = int(m.height * 0.74)
            ImageDraw.Draw(bgr).line([(0, y), (m.width, y)], fill=(255, 0, 128), width=2)
            bgr.thumbnail((cell - 16, cell - 16), Image.LANCZOS)
            x0 = (i % cols) * cell
            y0 = (i // cols) * 2 * (cell + 20) + j * (cell + 20)
            sheet.paste(bgr, (x0 + 8, y0 + 8))
            d.text((x0 + 10, y0 + cell), '%s (%s)' % (k, tag), fill=(20, 30, 50))
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
    os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, '_drivesheet.png')
    sheet.save(out)
    print('对照表 ->', out, '（粉线 = 车身上缘遮挡线，线下会被车身吃掉）')
