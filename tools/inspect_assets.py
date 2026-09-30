# -*- coding: utf-8 -*-
"""拆解素材：报告尺寸、按 alpha 连通域切分车辆表、裁出地图关键区域供人工核对。"""
import os, sys, json
from collections import deque

try:
    from PIL import Image
except Exception as e:
    print("NO_PIL", e)
    sys.exit(2)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "素材")
OUT = os.path.join(ROOT, "tools", "out")
os.makedirs(OUT, exist_ok=True)

log = []
log.append("== 素材尺寸 ==")
for f in sorted(os.listdir(SRC)):
    p = os.path.join(SRC, f)
    im = Image.open(p)
    log.append("%-28s %s %s  %d KB" % (f, im.size, im.mode, os.path.getsize(p) // 1024))

map_im = Image.open(os.path.join(SRC, "map.png")).convert("RGB")
MW, MH = map_im.size
log.append("\nmap size = %dx%d" % (MW, MH))

# --- 地图关键区域裁切（放大 2 倍便于观察）---
regions = {
    "map_top_straight": (0, 60, MW, 250),
    "map_bottom_straight": (0, 380, MW, 570),
    "map_left_bend": (0, 60, 260, 560),
    "map_right_bend": (830, 60, MW, 560),
    "map_center_1": (400, 60, 760, 300),
    "map_center_2": (400, 300, 760, 570),
}
for name, box in regions.items():
    c = map_im.crop(box)
    c = c.resize((min(1600, c.width * 2), min(1600, c.height * 2)), Image.LANCZOS)
    c.save(os.path.join(OUT, name + ".png"))

# --- 车辆表切片 ---
car_im = Image.open(os.path.join(SRC, "car-type.png")).convert("RGBA")
CW, CH = car_im.size
log.append("car-type size = %dx%d" % (CW, CH))

alpha = car_im.split()[3]
W, H = alpha.size
px = alpha.load()
mask = bytearray(W * H)
for y in range(H):
    row = y * W
    for x in range(W):
        if px[x, y] > 24:
            mask[row + x] = 1

label = [0] * (W * H)
boxes = []
cur = 0
for i in range(W * H):
    if mask[i] and not label[i]:
        cur += 1
        q = deque([i])
        label[i] = cur
        x0 = x1 = i % W
        y0 = y1 = i // W
        n = 0
        while q:
            j = q.popleft()
            n += 1
            x = j % W
            y = j // W
            if x < x0: x0 = x
            if x > x1: x1 = x
            if y < y0: y0 = y
            if y > y1: y1 = y
            for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H:
                    k = ny * W + nx
                    if mask[k] and not label[k]:
                        label[k] = cur
                        q.append(k)
        if n > 400:
            boxes.append([x0, y0, x1 + 1, y1 + 1, n])

log.append("连通域(>400px) 数量 = %d" % len(boxes))

# 按行聚类
boxes.sort(key=lambda b: (b[1] + b[3]) / 2)
rows = []
for b in boxes:
    cy = (b[1] + b[3]) / 2
    placed = False
    for r in rows:
        if abs(r["cy"] - cy) < (b[3] - b[1]) * 0.6:
            r["items"].append(b)
            r["cy"] = sum((it[1] + it[3]) / 2 for it in r["items"]) / len(r["items"])
            placed = True
            break
    if not placed:
        rows.append({"cy": cy, "items": [b]})

cars_dir = os.path.join(ROOT, "assets", "cars")
os.makedirs(cars_dir, exist_ok=True)
manifest = []
idx = 0
for ri, r in enumerate(rows):
    r["items"].sort(key=lambda b: b[0])
    log.append("行 %d: %d 个   y=[%d..%d]" % (ri, len(r["items"]), r["items"][0][1], r["items"][0][3]))
    for ci, b in enumerate(r["items"]):
        idx += 1
        crop = car_im.crop(tuple(b[:4]))
        name = "car_r%dc%d.png" % (ri, ci)
        crop.save(os.path.join(cars_dir, name))
        manifest.append({"file": name, "row": ri, "col": ci,
                         "w": b[2] - b[0], "h": b[3] - b[1],
                         "box": b, "px": b[4]})
        log.append("   %-14s w=%d h=%d px=%d" % (name, b[2]-b[0], b[3]-b[1], b[4]))

# --- 角色图裁到不透明包围盒 ---
chars_dir = os.path.join(ROOT, "assets", "chars")
os.makedirs(chars_dir, exist_ok=True)
log.append("\n== 角色 ==")
for f in sorted(os.listdir(SRC)):
    if not f.startswith("角色-"):
        continue
    im = Image.open(os.path.join(SRC, f)).convert("RGBA")
    bb = im.split()[3].getbbox()
    if bb:
        im2 = im.crop(bb)
    else:
        im2 = im
    outn = f.replace("角色-", "").replace(".png", "")
    im2.save(os.path.join(chars_dir, outn + ".png"))
    log.append("%-16s 原%dx%d -> 裁后%dx%d" % (outn, im.size[0], im.size[1], im2.size[0], im2.size[1]))

with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, ensure_ascii=False, indent=1)

with open(os.path.join(OUT, "inspect.log"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(log))
print("\n".join(log))
