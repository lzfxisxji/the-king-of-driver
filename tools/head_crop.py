# -*- coding: utf-8 -*-
"""从 driver_1.png 抠出更紧的头部特写（用于坐进车里的驾驶员）。"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(ROOT, "assets", "chars")
d = Image.open(os.path.join(DST, "driver_1.png")).convert("RGBA")
W, H = d.size
box = (int(W * 0.10), 0, int(W * 0.94), int(H * 0.66))
head = d.crop(box)
bb = head.split()[3].getbbox()
if bb:
    head = head.crop(bb)
head.thumbnail((460, 460), Image.LANCZOS)
head.save(os.path.join(DST, "driver_head.png"))
print("driver_head", head.size, head.size[0] / head.size[1])
