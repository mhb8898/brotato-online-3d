"""
Particle sprite sheet for the game's point particles: assets/fx_sprites.png.

Four 128 px cells side by side, white on transparent (the game tints them):
  0 glow   soft round falloff       (dots, sparks, pickups)
  1 smoke  lumpy fbm puff           (smoke, dust)
  2 star   four-ray flare with glow (level up, rising sparkles, crits)
  3 ember  hard irregular chunk     (gibs and debris)

Generated with Blender's noise module and written through bpy.data.images,
so it needs nothing outside Blender.
"""

import math
import os
import sys

import bpy
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402

CELL = 128
CELLS = 4


def glow(u, v):
    r = math.hypot(u, v)
    return max(0.0, 1.0 - r) ** 2.2


def smoke(u, v):
    r = math.hypot(u, v)
    n = noise.fractal(Vector((u * 2.2 + 11, v * 2.2 + 3, 0.5)), 0.6, 2.0, 5)
    edge = 0.72 + n * 0.28
    a = max(0.0, 1.0 - r / max(0.05, edge))
    return min(1.0, a ** 1.3 * (0.75 + n * 0.5))


def star(u, v):
    r = math.hypot(u, v)
    a = math.atan2(v, u)
    rays = abs(math.cos(a * 2)) ** 40            # four thin rays
    ray = rays * max(0.0, 1.0 - r) ** 1.5
    core = max(0.0, 1.0 - r * 3.2) ** 1.5
    halo = max(0.0, 1.0 - r * 1.6) ** 3 * 0.5
    return min(1.0, ray + core + halo)


def ember(u, v):
    a = math.atan2(v, u)
    r = math.hypot(u, v)
    edge = 0.62 + 0.18 * noise.noise(Vector((math.cos(a) * 1.3, math.sin(a) * 1.3, 4.2)))
    if r > edge:
        return 0.0
    return min(1.0, (edge - r) * 12)


def build(path=None):
    path = path or os.path.join(common.ASSETS, "fx_sprites.png")
    w, h = CELL * CELLS, CELL
    img = bpy.data.images.get("fx_sprites")
    if img and (img.size[0] != w or img.size[1] != h):
        bpy.data.images.remove(img)
        img = None
    img = img or bpy.data.images.new("fx_sprites", w, h, alpha=True)
    px = [0.0] * (w * h * 4)
    fns = [glow, smoke, star, ember]
    for y in range(h):
        v = (y + 0.5) / CELL * 2 - 1
        for x in range(w):
            cell, cx = divmod(x, CELL)
            u = (cx + 0.5) / CELL * 2 - 1
            a = fns[cell](u, v)
            i = (y * w + x) * 4
            px[i] = px[i + 1] = px[i + 2] = 1.0
            px[i + 3] = a
    img.pixels.foreach_set(px)
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return path, os.path.getsize(path)


if globals().get("RUN", True):
    OUT = build()
