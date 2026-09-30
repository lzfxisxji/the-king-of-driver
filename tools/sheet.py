# -*- coding: utf-8 -*-
"""快速巡检：把 assets/chars 下所有 PNG 贴到棋盘底上拼一张图，并统计透明像素比例。"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, "assets", "chars")
OUT = os.path.join(ROOT, "tools", "out")
files = sorted(f for f in os.listdir(DST) if f.endswith(".png"))
CW, CH = 210, 250
cols = 7
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (CW * cols, CH * rows), (255, 255, 255))
sd = ImageDraw.Draw(sheet)
for y in range(0, sheet.height, 14):
    for x in range(0, sheet.width, 14):
        if ((x // 14) + (y // 14)) % 2 == 0:
            sd.rectangle([x, y, x + 13, y + 13], fill=(214, 214, 222))
report = []
for i, fn in enumerate(files):
    im = Image.open(os.path.join(DST, fn)).convert("RGBA")
    a = im.split()[3]
    hist = a.histogram()
    trans = hist[0] / float(im.size[0] * im.size[1])
    report.append("%-20s %dx%d 透明占比=%.1f%%" % (fn, im.size[0], im.size[1], trans * 100))
    im2 = im.copy()
    im2.thumbnail((CW - 14, CH - 34), Image.LANCZOS)
    ox, oy = (i % cols) * CW, (i // cols) * CH
    sheet.paste(im2, (ox + (CW - im2.size[0]) // 2, oy + 26), im2)
    sd.rectangle([ox + 3, oy + 3, ox + CW - 3, oy + CH - 3], outline=(120, 120, 130))
    sd.text((ox + 8, oy + 9), fn.replace(".png", ""), fill=(10, 10, 14))
sheet.save(os.path.join(OUT, "chars_sheet2.png"))
with open(os.path.join(OUT, "chars2.log"), "w", encoding="utf-8") as f:
    f.write("\n".join(report))
print("done")
