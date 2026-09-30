# -*- coding: utf-8 -*-
import os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
im = Image.open(os.path.join(ROOT, "素材", "map.png")).convert("RGB")
OUT = os.path.join(ROOT, "tools", "out")
crops = {
    "z2_topright": (1280, 110, 1500, 350, 4),
    "z2_topmid": (730, 150, 910, 330, 5),
    "z2_rightstraight": (1430, 320, 1672, 520, 4),
    "z2_bottomright_start": (1240, 590, 1470, 800, 4),
}
for n, (x0, y0, x1, y1, s) in crops.items():
    c = im.crop((x0, y0, x1, y1))
    c = c.resize((c.width * s, c.height * s), Image.LANCZOS)
    c.save(os.path.join(OUT, n + ".png"))
print("done")
