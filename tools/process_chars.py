# -*- coding: utf-8 -*-
"""把角色设定稿（四视图）切成独立立绘并抠掉背景，输出真 RGBA PNG。

流程：
 1) 从图像边界 floodfill 灌掉背景（含面板底色）
 2) 全局连通域，用「高瘦 + 纵向居中 + 填充率」筛掉面板边框/logo/文字标签
 3) 按 x 重叠把同一角色的多个部件合成一组，取面积最大的 4 组
 4) 每组只保留自身像素生成 alpha（彻底去掉残留标签/logo），裁 bbox 存盘
 5) 拼 contact sheet（棋盘底）供人工核对
"""
import os, sys
from collections import deque
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "素材")
DST = os.path.join(ROOT, "assets", "chars")
OUT = os.path.join(ROOT, "tools", "out")
os.makedirs(DST, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
MAGIC = (255, 0, 255)

CHARS = [
    ("lulu", "角色-噜噜.png", "噜噜"),
    ("kangaroo", "角色-肥嘟袋鼠.png", "肥嘟袋鼠"),
    ("nailong", "角色-奶龙.png", "奶龙"),
    ("niulai", "角色-牛来.png", "牛来"),
    ("doubao", "角色-豆包.png", "豆包"),
]
log = []


def cut_background(im):
    """背景抠除：
    1) 全局颜色谓词判定"中性浅色"（背景/面板底/阴影/标签胶囊）
    2) 从图像四边泛洪，只吃与边界连通的浅色区 -> 背景
    3) 孔洞回填：不与边界连通的小透明块（眼白高光、内部缝隙）恢复为不透明
    """
    rgb = im.convert("RGB")
    W, H = rgb.size
    px = rgb.load()

    def is_bg(c):
        r, g, b = c
        mx, mn = max(r, g, b), min(r, g, b)
        return (mx - mn) < 32 and mn > 158

    outside = bytearray(W * H)
    q = deque()
    for x in range(W):
        for y in (0, H - 1):
            if is_bg(px[x, y]) and not outside[x + y * W]:
                outside[x + y * W] = 1; q.append(x + y * W)
    for y in range(H):
        for x in (0, W - 1):
            if is_bg(px[x, y]) and not outside[x + y * W]:
                outside[x + y * W] = 1; q.append(x + y * W)
    while q:
        j = q.popleft()
        x = j % W; y = j // W
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H:
                k = nx + ny * W
                if not outside[k] and is_bg(px[nx, ny]):
                    outside[k] = 1; q.append(k)

    # 孔洞回填：透明区域里不接触边界的连通块 -> 填回不透明
    filled = bytearray(W * H)
    for i in range(W * H):
        if outside[i] and not filled[i]:
            stack = [i]; filled[i] = 1
            cells = []
            touch = False
            while stack:
                j = stack.pop(); cells.append(j)
                x = j % W; y = j // W
                if x == 0 or y == 0 or x == W - 1 or y == H - 1:
                    touch = True
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H:
                        k = nx + ny * W
                        if outside[k] and not filled[k]:
                            filled[k] = 1; stack.append(k)
            if not touch:
                for j in cells:
                    outside[j] = 0

    alpha = Image.new("L", (W, H), 0)
    ap = alpha.load()
    mask = bytearray(W * H)
    for y in range(H):
        for x in range(W):
            if not outside[x + y * W]:
                ap[x, y] = 255
                mask[x + y * W] = 1
    rgba = rgb.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba, mask, W, H


def label_components(mask, W, H):
    seen = bytearray(W * H)
    comps = []
    for i in range(W * H):
        if mask[i] and not seen[i]:
            q = deque([i]); seen[i] = 1
            bx0 = bx1 = i % W; by0 = by1 = i // W; n = 0
            while q:
                j = q.popleft(); n += 1
                x = j % W; y = j // W
                if x < bx0: bx0 = x
                if x > bx1: bx1 = x
                if y < by0: by0 = y
                if y > by1: by1 = y
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H:
                        k = nx + ny * W
                        if mask[k] and not seen[k]:
                            seen[k] = 1; q.append(k)
            if n > 1200:
                comps.append({"n": n, "x0": bx0, "y0": by0, "x1": bx1, "y1": by1, "id": len(comps)})
    return comps


def character_groups(comps, W, H):
    keep = []
    for c in comps:
        h = c["y1"] - c["y0"] + 1
        w = c["x1"] - c["x0"] + 1
        cy = (c["y0"] + c["y1"]) / 2
        fill = c["n"] / float(w * h)
        if h > H * 0.32 and H * 0.16 < cy < H * 0.88 and h / float(w) > 0.5 and fill > 0.22:
            keep.append(c)
    if not keep:
        return []
    keep.sort(key=lambda c: c["x0"])
    groups = []
    for c in keep:
        hit = None
        for g in groups:
            ov = min(g["x1"], c["x1"]) - max(g["x0"], c["x0"])
            if ov > 0.30 * min(g["x1"] - g["x0"] + 1, c["x1"] - c["x0"] + 1):
                hit = g
                break
        if hit:
            hit["n"] += c["n"]
            hit["x0"] = min(hit["x0"], c["x0"]); hit["y0"] = min(hit["y0"], c["y0"])
            hit["x1"] = max(hit["x1"], c["x1"]); hit["y1"] = max(hit["y1"], c["y1"])
            hit["ids"].append(c["id"])
        else:
            groups.append({"n": c["n"], "x0": c["x0"], "y0": c["y0"], "x1": c["x1"], "y1": c["y1"], "ids": [c["id"]]})
    groups.sort(key=lambda g: g["n"], reverse=True)
    groups = groups[:4]
    groups.sort(key=lambda g: g["x0"])
    return groups


def render_group(rgba, mask, W, H, comps, group):
    """只保留该组连通域的像素 -> 返回裁剪后的 RGBA"""
    ids = set(group["ids"])
    keep = bytearray(W * H)
    # 重新扫一遍，标记属于这些 id 的像素：用一次 floodfill 集合重建代价高，
    # 改为按 bbox 局部重扫 + 连通域归属判断
    x0, y0, x1, y1 = group["x0"], group["y0"], group["x1"], group["y1"]
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    sub = bytearray(bw * bh)
    for y in range(bh):
        for x in range(bw):
            sub[x + y * bw] = mask[(x0 + x) + (y0 + y) * W]
    seen = bytearray(bw * bh)
    for i in range(bw * bh):
        if sub[i] and not seen[i]:
            q = deque([i]); seen[i] = 1
            cells = []
            bx0 = bx1 = i % bw; by0 = by1 = i // bw
            while q:
                j = q.popleft(); cells.append(j)
                x = j % bw; y = j // bw
                if x < bx0: bx0 = x
                if x > bx1: bx1 = x
                if y < by0: by0 = y
                if y > by1: by1 = y
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < bw and 0 <= ny < bh:
                        k = nx + ny * bw
                        if sub[k] and not seen[k]:
                            seen[k] = 1; q.append(k)
            gx0, gy0 = bx0 + x0, by0 + y0
            gx1, gy1 = bx1 + x0, by1 + y0
            for c in comps:
                if c["x0"] == gx0 and c["y0"] == gy0 and c["x1"] == gx1 and c["y1"] == gy1 and c["id"] in ids:
                    for j in cells:
                        keep[(j % bw + x0) + (j // bw + y0) * W] = 1
                    break
    a = Image.new("L", (W, H), 0)
    ap = a.load()
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if keep[x + y * W]:
                ap[x, y] = 255
    out = rgba.copy()
    out.putalpha(a)
    return out.crop((x0, y0, x1 + 1, y1 + 1))


sheet_cells = []
for key, fn, cn in CHARS:
    im = Image.open(os.path.join(SRC, fn))
    rgba, mask, W, H = cut_background(im)
    comps = label_components(mask, W, H)
    groups = character_groups(comps, W, H)
    log.append("%s(%s) %dx%d 连通域=%d 角色组=%d" % (cn, key, W, H, len(comps), len(groups)))
    if len(groups) != 4:
        log.append("   !! 组数不是4")
    for i, g in enumerate(groups):
        crop = render_group(rgba, mask, W, H, comps, g)
        nm = "%s_%d.png" % (key, i)
        crop.save(os.path.join(DST, nm))
        log.append("   %-16s bbox=(%d,%d,%d,%d) -> %dx%d" % (nm, g["x0"], g["y0"], g["x1"], g["y1"], crop.size[0], crop.size[1]))
        sheet_cells.append((cn + str(i), crop))

d_im = Image.open(os.path.join(SRC, "角色-driver.png")).convert("RGBA")
bb = d_im.split()[3].getbbox()
d_im = d_im.crop(bb)
d_im.save(os.path.join(DST, "driver_1.png"))
log.append("driver_1.png -> %dx%d" % d_im.size)
sheet_cells.append(("driver", d_im))

# driver 头部特写（放到车顶当驾驶员）
W, H = d_im.size
side = int(W * 0.86)
head = d_im.crop((int((W - side) / 2), 0, int((W + side) / 2), side))
head.thumbnail((420, 420), Image.LANCZOS)
head.save(os.path.join(DST, "driver_head.png"))
log.append("driver_head.png -> %dx%d" % head.size)

CW, CH_ = 250, 300
cols = 4
rows = (len(sheet_cells) + cols - 1) // cols
sheet = Image.new("RGB", (CW * cols, CH_ * rows), (255, 255, 255))
sd = ImageDraw.Draw(sheet)
for y in range(0, sheet.height, 16):
    for x in range(0, sheet.width, 16):
        if ((x // 16) + (y // 16)) % 2 == 0:
            sd.rectangle([x, y, x + 15, y + 15], fill=(228, 228, 234))
for i, (label, im) in enumerate(sheet_cells):
    im2 = im.copy()
    im2.thumbnail((CW - 20, CH_ - 54), Image.LANCZOS)
    ox, oy = (i % cols) * CW, (i // cols) * CH_
    sheet.paste(im2, (ox + (CW - im2.size[0]) // 2, oy + 32), im2)
    sd.rectangle([ox + 4, oy + 4, ox + CW - 4, oy + CH_ - 4], outline=(120, 120, 130))
    sd.text((ox + 10, oy + 12), label, fill=(20, 20, 24))
sheet.save(os.path.join(OUT, "chars_sheet.png"))

with open(os.path.join(OUT, "chars.log"), "w", encoding="utf-8") as f:
    f.write("\n".join(log))
print("done")
