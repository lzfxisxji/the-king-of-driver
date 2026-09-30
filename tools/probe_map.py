# -*- coding: utf-8 -*-
"""探测 map.png 的赛道几何：沥青带范围、车道分隔线、起终点线位置。"""
import os, json
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
im = Image.open(os.path.join(ROOT, "素材", "map.png")).convert("RGB")
W, H = im.size
px = im.load()
L = []


def is_asphalt(c):
    r, g, b = c
    mx, mn = max(r, g, b), min(r, g, b)
    return mx < 130 and (mx - mn) < 26 and mx > 30


def is_white(c):
    r, g, b = c
    return r > 195 and g > 195 and b > 190


def runs_row(y):
    out = []
    x = 0
    while x < W:
        if is_asphalt(px[x, y]):
            s = x
            while x < W and is_asphalt(px[x, y]):
                x += 1
            if x - s > 12:
                out.append((s, x - 1))
        else:
            x += 1
    return out


def runs_col(x):
    out = []
    y = 0
    while y < H:
        if is_asphalt(px[x, y]):
            s = y
            while y < H and is_asphalt(px[x, y]):
                y += 1
            if y - s > 12:
                out.append((s, y - 1))
        else:
            y += 1
    return out


def white_runs_row(y, x0, x1):
    """在 [x0,x1] 内找白色标记（车道虚线 / 起跑格）"""
    out = []
    x = x0
    while x <= x1 and x < W:
        if is_white(px[x, y]):
            s = x
            while x <= x1 and x < W and is_white(px[x, y]):
                x += 1
            if x - s >= 2:
                out.append((s, x - 1))
        else:
            x += 1
    return out


L.append("map %dx%d" % (W, H))
L.append("\n== 横向扫描（找上下直道的沥青带 y 范围与车道线） ==")
for y in range(20, H - 20, 10):
    r = runs_row(y)
    if len(r) <= 4:
        L.append("y=%4d  %s" % (y, r))

L.append("\n== 纵向扫描（找左右弯道的沥青带 x 范围） ==")
for x in range(20, W - 20, 20):
    r = runs_col(x)
    if len(r) <= 4:
        L.append("x=%4d  %s" % (x, r))

# 上直道：取中间一条水平线，输出所有白色标记（车道虚线）
L.append("\n== 上直道车道线（y=140 / 150 / 160）==")
for y in (130, 140, 150, 160, 170):
    L.append("y=%d 白=%s" % (y, white_runs_row(y, 0, W)))

L.append("\n== 下直道车道线（y=800 / 820 / 840）==")
for y in (800, 810, 820, 830, 840):
    L.append("y=%d 白=%s" % (y, white_runs_row(y, 0, W)))

# 找起终点格纹：扫描纯黑/纯白交替的方块区域
L.append("\n== 竖直方向：上下直道沥青带边界（x=830 中段） ==")
for x in (300, 500, 830, 1100, 1400):
    L.append("x=%d  %s" % (x, runs_col(x)))

with open(os.path.join(ROOT, "tools", "out", "probe.log"), "w", encoding="utf-8") as f:
    f.write("\n".join(L))
print("ok", len(L))
