"""
Builds one model per weapon in src/data.js WEAPONS and exports them to
assets/weapons.glb.

Conventions (read by render3d.js):
  - one Blender unit = PLAYER_R in game, the same scale as the potatoes
  - the grip is at the origin and the business end points +X; up is +Z
  - the camera looks down from ~57 degrees, so every weapon is designed to
    read in top view: blades lie flat in the XY plane, guns show their
    length, width and a coloured accent from above
  - each weapon is an empty named by its id ("pistol", "sword", ...)
  - "<id>_muzzle" is an empty at the barrel tip (muzzle flash position)
  - parts named "<id>_spin..." are grouped under "<id>_spin", an empty the
    game rotates about X (the minigun barrels)
  - parts named "..._glow..." are emissive and drawn unlit in game
"""

import importlib
import math
import os
import sys

import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
importlib.reload(common)
from common import (box, cone, marker, mat, prism, rod, root, sphere,  # noqa: E402
                    star_outline, torus)

# accent colours straight from data.js so the model matches the shop card
ACCENT = {
    "knife": "#dfe9f5", "sword": "#b8c6d9", "spear": "#cbb88f", "hammer": "#a08b6b",
    "scythe": "#a6f0c6", "pistol": "#ffe9a8", "smg": "#ffd166", "shotgun": "#ffb37a",
    "shuriken": "#c8e6ff", "wand": "#c39bff", "flamer": "#ff7a45", "laser": "#66f0ff",
    "sniper": "#a8ffd0", "rocket": "#ff9f6b", "minigun": "#ffcf5c", "tesla": "#7fd7ff",
}


def materials():
    return {
        "steel": mat("w_steel", "#c9d2e0", rough=0.25, metal=0.9),
        "gun": mat("w_gunmetal", "#33374a", rough=0.4, metal=0.6),
        "dark": mat("w_dark", "#1c1e28", rough=0.6, metal=0.2),
        "wood": mat("w_wood", "#8b5a2b", rough=0.75),
        "leather": mat("w_leather", "#4a2f1f", rough=0.85),
        "brass": mat("w_brass", "#d9a441", rough=0.3, metal=0.9),
        "copper": mat("w_copper", "#c7703a", rough=0.35, metal=0.9),
        "red": mat("w_red", "#d62828", rough=0.45),
    }


def accent(wid, rough=0.4, metal=0.3):
    return mat("w_accent_" + wid, ACCENT[wid], rough=rough, metal=metal)


def glow(wid, color=None, strength=3.0):
    return mat("w_glow_" + wid, color or ACCENT[wid], rough=0.3, emit=strength)


# --------------------------------------------------------------------------
# Melee
# --------------------------------------------------------------------------
def knife(n, p, M):
    prism(n + "_blade", M["steel"], p, (0, 0, 0),
          [(0.2, -0.1), (0.95, -0.06), (1.12, 0.03), (0.95, 0.1), (0.2, 0.1)], 0.05)
    box(n + "_guard", accent(n), p, (0.17, 0, 0), (0.04, 0.18, 0.05), bevel=0.3)
    box(n + "_grip", M["leather"], p, (-0.08, 0, 0), (0.22, 0.07, 0.06), bevel=0.4)
    sphere(n + "_pommel", M["brass"], p, (-0.32, 0, 0), 0.07, segs=(10, 8))


def sword(n, p, M):
    prism(n + "_blade", M["steel"], p, (0, 0, 0),
          [(0.25, -0.13), (1.55, -0.11), (1.85, 0.0), (1.55, 0.11), (0.25, 0.13)], 0.06)
    box(n + "_fuller", M["gun"], p, (0.9, 0, 0.03), (0.55, 0.025, 0.012), bevel=0.2)
    box(n + "_guard", M["brass"], p, (0.2, 0, 0), (0.06, 0.36, 0.07), bevel=0.4)
    sphere(n + "_gem", accent(n, 0.15, 0.2), p, (0.2, 0, 0.07), (0.07, 0.07, 0.04), segs=(10, 6))
    box(n + "_grip", M["leather"], p, (-0.07, 0, 0), (0.2, 0.07, 0.07), bevel=0.4)
    sphere(n + "_pommel", M["brass"], p, (-0.3, 0, 0), 0.09, segs=(12, 8))


def spear(n, p, M):
    rod(n + "_shaft", M["wood"], p, (-0.7, 0, 0), (1.75, 0, 0), 0.05, segs=10)
    prism(n + "_head", M["steel"], p, (0, 0, 0),
          [(1.7, -0.05), (1.95, -0.15), (2.45, 0.0), (1.95, 0.15), (1.7, 0.05)], 0.06)
    cone(n + "_collar", M["brass"], p, (1.72, 0, 0), 0.08, 0.06, 0.12, rot=(0, 90, 0), segs=10)
    rib = accent(n, 0.8, 0.0)
    box(n + "_ribbon1", rib, p, (1.55, 0.12, 0), (0.12, 0.06, 0.012), rot=(0, 0, 30), bevel=0.1)
    box(n + "_ribbon2", rib, p, (1.5, -0.1, 0), (0.1, 0.05, 0.012), rot=(0, 0, -25), bevel=0.1)
    box(n + "_grip", M["leather"], p, (0.0, 0, 0), (0.18, 0.065, 0.065), bevel=0.4)


def hammer(n, p, M):
    rod(n + "_handle", M["wood"], p, (-0.35, 0, 0), (1.3, 0, 0), 0.06, segs=10)
    box(n + "_head", M["gun"], p, (1.35, 0, 0), (0.28, 0.46, 0.26), bevel=0.15)
    box(n + "_face1", M["steel"], p, (1.35, 0.5, 0), (0.3, 0.06, 0.28), bevel=0.2)
    box(n + "_face2", M["steel"], p, (1.35, -0.5, 0), (0.3, 0.06, 0.28), bevel=0.2)
    box(n + "_band", accent(n), p, (1.35, 0, 0), (0.3, 0.12, 0.28), bevel=0.2)
    box(n + "_grip", M["leather"], p, (-0.05, 0, 0), (0.22, 0.08, 0.08), bevel=0.4)
    cone(n + "_cap", M["brass"], p, (-0.37, 0, 0), 0.08, 0.08, 0.06, rot=(0, 90, 0), segs=10)


def scythe(n, p, M):
    rod(n + "_shaft", M["wood"], p, (-0.5, 0, 0), (1.85, 0, 0), 0.05, segs=10)
    # curved blade sweeping back along +Y from the top of the shaft
    torus(n + "_blade", M["steel"], p, (1.2, 0.02, 0), 0.64, 0.085, rot=(0, 0, -3),
          scale=(1.0, 1.0, 0.35), segs=(24, 6), arc=125)
    torus(n + "_edge_glow", glow(n, strength=2.0), p, (1.2, 0.02, 0), 0.72, 0.025, rot=(0, 0, -1),
          scale=(1.0, 1.0, 0.5), segs=(24, 5), arc=120)
    cone(n + "_socket", M["gun"], p, (1.82, 0, 0), 0.09, 0.07, 0.16, rot=(0, 90, 0), segs=10)
    box(n + "_grip", M["leather"], p, (0.05, 0, 0), (0.16, 0.065, 0.065), bevel=0.4)
    box(n + "_grip2", M["leather"], p, (0.9, 0, 0), (0.12, 0.065, 0.065), bevel=0.4)


# --------------------------------------------------------------------------
# Ranged
# --------------------------------------------------------------------------
def pistol(n, p, M):
    box(n + "_frame", M["gun"], p, (0.35, 0, 0.02), (0.36, 0.1, 0.12), bevel=0.25)
    box(n + "_slide", accent(n, 0.35, 0.5), p, (0.38, 0, 0.12), (0.4, 0.09, 0.05), bevel=0.3)
    rod(n + "_barrel", M["dark"], p, (0.7, 0, 0.06), (0.86, 0, 0.06), 0.045, segs=10)
    box(n + "_grip", M["dark"], p, (0.05, 0, -0.14), (0.1, 0.085, 0.18), rot=(0, -15, 0), bevel=0.3)
    box(n + "_sight", M["dark"], p, (0.68, 0, 0.18), (0.03, 0.02, 0.02), bevel=0.2)
    marker(n + "_muzzle", p, (0.9, 0, 0.06))


def smg(n, p, M):
    box(n + "_body", M["gun"], p, (0.45, 0, 0.02), (0.48, 0.12, 0.13), bevel=0.2)
    box(n + "_top", accent(n, 0.35, 0.5), p, (0.45, 0, 0.14), (0.4, 0.08, 0.03), bevel=0.3)
    rod(n + "_barrel", M["dark"], p, (0.9, 0, 0.04), (1.22, 0, 0.04), 0.05, segs=10)
    cone(n + "_brake", M["steel"], p, (1.2, 0, 0.04), 0.07, 0.07, 0.1, rot=(0, 90, 0), segs=10)
    box(n + "_mag", M["dark"], p, (0.5, 0, -0.26), (0.07, 0.07, 0.2), rot=(0, 12, 0), bevel=0.3)
    box(n + "_grip", M["dark"], p, (0.12, 0, -0.16), (0.08, 0.08, 0.16), rot=(0, -12, 0), bevel=0.3)
    box(n + "_stock", M["gun"], p, (-0.18, 0, 0.0), (0.16, 0.05, 0.08), bevel=0.3)
    marker(n + "_muzzle", p, (1.27, 0, 0.04))


def shotgun(n, p, M):
    for s in (1, -1):
        rod(f"{n}_barrel{s}", M["gun"], p, (0.3, 0.07 * s, 0.05), (1.5, 0.07 * s, 0.05), 0.065, segs=12)
        cone(f"{n}_bore{s}", M["dark"], p, (1.5, 0.07 * s, 0.05), 0.045, 0.045, 0.02, rot=(0, 90, 0), segs=10)
    box(n + "_receiver", M["gun"], p, (0.3, 0, 0.0), (0.18, 0.15, 0.12), bevel=0.25)
    box(n + "_pump", M["wood"], p, (0.9, 0, -0.06), (0.2, 0.13, 0.07), bevel=0.35)
    box(n + "_rib", accent(n, 0.35, 0.5), p, (0.9, 0, 0.13), (0.6, 0.025, 0.015), bevel=0.2)
    prism(n + "_stock", M["wood"], p, (0, 0, -0.04),
          [(0.15, -0.1), (0.15, 0.1), (-0.5, 0.12), (-0.5, -0.12)], 0.18)
    marker(n + "_muzzle", p, (1.55, 0, 0.05))


def shuriken(n, p, M):
    # a throwing star held flat; the game spins the whole thing about Z
    prism(n + "_star", M["steel"], p, (0.25, 0, 0), star_outline(4, 0.42, 0.13, math.pi / 4), 0.05)
    cone(n + "_hub", accent(n, 0.3, 0.6), p, (0.25, 0, 0), 0.11, 0.11, 0.08, segs=12)
    cone(n + "_hole", M["dark"], p, (0.25, 0, 0.001), 0.045, 0.045, 0.09, segs=10)
    marker(n + "_muzzle", p, (0.3, 0, 0))


def wand(n, p, M):
    rod(n + "_stick", M["wood"], p, (-0.3, 0, 0), (1.05, 0, 0), 0.045, 0.035, segs=10)
    box(n + "_grip", M["leather"], p, (-0.1, 0, 0), (0.15, 0.06, 0.06), bevel=0.4)
    for i, x in enumerate((1.02, 1.1)):
        torus(f"{n}_prong{i}", M["brass"], p, (x, 0, 0), 0.09 + i * 0.03, 0.02, rot=(0, 90, 0), segs=(14, 5))
    prism(n + "_crystal_glow", glow(n, strength=4.0), p, (1.28, 0, 0),
          [(-0.14, 0.0), (0.0, -0.1), (0.2, 0.0), (0.0, 0.1)], 0.14, smooth=False)
    marker(n + "_muzzle", p, (1.45, 0, 0))


def flamer(n, p, M):
    cone(n + "_tank", M["red"], p, (0.25, 0, 0.02), 0.16, 0.16, 0.7, rot=(0, 90, 0), segs=14)
    sphere(n + "_tankCap", M["red"], p, (-0.1, 0, 0.02), (0.08, 0.16, 0.16), segs=(12, 8))
    for x in (0.05, 0.45):
        cone(f"{n}_strap{x}", M["dark"], p, (x, 0, 0.02), 0.17, 0.17, 0.05, rot=(0, 90, 0), segs=14)
    rod(n + "_pipe", M["gun"], p, (0.6, 0, 0.02), (1.25, 0, 0.02), 0.06, segs=10)
    cone(n + "_nozzle", M["steel"], p, (1.3, 0, 0.02), 0.06, 0.11, 0.16, rot=(0, 90, 0), segs=12)
    sphere(n + "_pilot_glow", glow(n, "#ffb02e", 5.0), p, (1.26, 0, -0.1), 0.05, segs=(8, 6))
    box(n + "_grip", M["dark"], p, (0.75, 0, -0.14), (0.06, 0.06, 0.12), bevel=0.3)
    marker(n + "_muzzle", p, (1.4, 0, 0.02))


def laser(n, p, M):
    prism(n + "_body", mat("w_white", "#e8ecf4", rough=0.3, metal=0.2), p, (0, 0, 0.02),
          [(-0.3, -0.1), (0.9, -0.12), (1.3, -0.06), (1.3, 0.06), (0.9, 0.12), (-0.3, 0.1)], 0.18)
    box(n + "_stripe_glow", glow(n, strength=3.0), p, (0.55, 0, 0.12), (0.55, 0.03, 0.012), bevel=0.2)
    for s in (1, -1):
        box(f"{n}_fin{s}", M["gun"], p, (0.2, 0.14 * s, 0.02), (0.22, 0.04, 0.06), bevel=0.3)
    rod(n + "_emitter", M["gun"], p, (1.28, 0, 0.02), (1.45, 0, 0.02), 0.06, segs=12)
    cone(n + "_lens_glow", glow(n, strength=5.0), p, (1.46, 0, 0.02), 0.045, 0.045, 0.02, rot=(0, 90, 0), segs=12)
    box(n + "_grip", M["dark"], p, (0.1, 0, -0.15), (0.07, 0.07, 0.13), rot=(0, -12, 0), bevel=0.3)
    marker(n + "_muzzle", p, (1.5, 0, 0.02))


def sniper(n, p, M):
    rod(n + "_barrel", M["gun"], p, (0.5, 0, 0.04), (2.15, 0, 0.04), 0.045, segs=10)
    cone(n + "_brake", M["dark"], p, (2.15, 0, 0.04), 0.07, 0.07, 0.14, rot=(0, 90, 0), segs=10)
    box(n + "_body", accent(n, 0.5, 0.2), p, (0.4, 0, 0.0), (0.4, 0.1, 0.11), bevel=0.25)
    prism(n + "_stock", accent(n, 0.5, 0.2), p, (0, 0, -0.02),
          [(0.05, -0.09), (0.05, 0.09), (-0.55, 0.11), (-0.55, -0.11)], 0.2)
    rod(n + "_scope", M["dark"], p, (0.2, 0, 0.2), (0.75, 0, 0.2), 0.065, segs=12)
    cone(n + "_scopeLens_glow", glow(n, "#9ee6ff", 2.0), p, (0.76, 0, 0.2), 0.05, 0.05, 0.02,
         rot=(0, 90, 0), segs=12)
    box(n + "_mount", M["dark"], p, (0.45, 0, 0.13), (0.12, 0.04, 0.04), bevel=0.2)
    marker(n + "_muzzle", p, (2.25, 0, 0.04))


def rocket(n, p, M):
    tube = mat("w_olive", "#5b6b3a", rough=0.7)
    cone(n + "_tube", tube, p, (0.55, 0, 0.05), 0.17, 0.17, 1.5, rot=(0, 90, 0), segs=16)
    for x in (-0.15, 1.25):
        cone(f"{n}_rim{x}", M["dark"], p, (x, 0, 0.05), 0.2, 0.2, 0.08, rot=(0, 90, 0), segs=16)
    cone(n + "_warhead", accent(n, 0.4, 0.3), p, (1.42, 0, 0.05), 0.13, 0.0, 0.34, rot=(0, 90, 0), segs=14)
    box(n + "_sight", M["dark"], p, (0.8, 0.12, 0.25), (0.12, 0.03, 0.06), bevel=0.3)
    box(n + "_grip", M["dark"], p, (0.45, 0, -0.2), (0.06, 0.06, 0.12), bevel=0.3)
    box(n + "_stripe", mat("w_hazard", "#ffd166", rough=0.5), p, (0.1, 0, 0.05), (0.06, 0.18, 0.18),
        bevel=0.1)
    marker(n + "_muzzle", p, (1.6, 0, 0.05))


def minigun(n, p, M):
    box(n + "_housing", M["gun"], p, (0.25, 0, 0.02), (0.32, 0.2, 0.18), bevel=0.25)
    box(n + "_top", accent(n, 0.35, 0.5), p, (0.25, 0, 0.21), (0.26, 0.12, 0.03), bevel=0.3)
    cone(n + "_ammo", M["brass"], p, (0.2, -0.3, -0.04), 0.14, 0.14, 0.38, rot=(0, 90, 0), segs=12)
    box(n + "_handle", M["dark"], p, (0.25, 0, 0.3), (0.18, 0.03, 0.03), bevel=0.3)
    spin = root(n + "_spin", (0.58, 0, 0.02))
    spin.parent = p
    for i in range(6):
        a = i * math.tau / 6
        y, z = math.cos(a) * 0.1, math.sin(a) * 0.1
        rod(f"{n}_spinBarrel{i}", M["dark"], spin, (0, y, z), (1.0, y, z), 0.035, segs=8)
    for x in (0.25, 0.95):
        cone(f"{n}_spinClamp{x}", M["steel"], spin, (x, 0, 0), 0.16, 0.16, 0.05, rot=(0, 90, 0), segs=14)
    marker(n + "_muzzle", p, (1.62, 0, 0.02))


def tesla(n, p, M):
    rod(n + "_rod", M["gun"], p, (-0.25, 0, 0), (0.95, 0, 0), 0.06, segs=12)
    for i in range(5):
        torus(f"{n}_coil{i}", M["copper"], p, (0.25 + i * 0.13, 0, 0), 0.11, 0.03, rot=(0, 90, 0), segs=(14, 5))
    for s in (1, -1):
        box(f"{n}_fork{s}", M["steel"], p, (1.05, 0.12 * s, 0), (0.14, 0.025, 0.03), rot=(0, 0, 20 * s), bevel=0.3)
    sphere(n + "_orb_glow", glow(n, strength=5.0), p, (1.18, 0, 0), 0.13, segs=(14, 10))
    box(n + "_grip", M["leather"], p, (-0.05, 0, 0), (0.15, 0.07, 0.07), bevel=0.4)
    marker(n + "_muzzle", p, (1.2, 0, 0))


ARSENAL = [knife, sword, spear, hammer, scythe, pistol, smg, shotgun,
           shuriken, wand, flamer, laser, sniper, rocket, minigun, tesla]


def build(spacing=(3.0, 1.6), cols=4):
    common.use_collection("Weapons")
    M = materials()
    roots = []
    for i, fn in enumerate(ARSENAL):
        name = fn.__name__
        cx, cy = (i % cols) * spacing[0], -(i // cols) * spacing[1]
        r = root(name, (cx - 4.5 + 30, cy + 2.4, 1.2))
        fn(name, r, M)
        roots.append(r)
    return roots


def export(roots):
    return common.export_glb("weapons.glb", roots)


if globals().get("RUN", True):
    ROOTS = build()
