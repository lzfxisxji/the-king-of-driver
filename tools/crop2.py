# -*- coding: utf-8 -*-
import os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
im = Image.open(os.path.join(ROOT, "素材", "map.png")).convert("RGB")
OUT = os.path.join(ROOT, "tools", "out")
crops = {
    "z_start_topleft": (110, 140, 350, 340, 4),
    "z_start_bottomright": (1260, 580, 1500, 790, 4),
    "z_arrow_topleft_corner": (20, 150, 200, 330, 5),
    "z_arrow_left_mid": (20, 330, 200, 520, 5),
    "z_arrow_right_mid": (1500, 250, 1672, 520, 5),
    "z_arrow_bottom_left": (20, 620, 260, 830, 5),
    "z_infield_tl": (200, 180, 520, 400, 3),
    "z_infield_br": (1150, 560, 1470, 780, 3),
}
for n, (x0, y0, x1, y1, s) in crops.items():
    c = im.crop((x0, y0, x1, y1))
    c = c.resize((c.width * s, c.height * s), Image.LANCZOS)
    c.save(os.path.join(OUT, n + ".png"))
    print(n, c.size)
print("done")
