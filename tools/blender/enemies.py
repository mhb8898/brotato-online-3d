"""
The ten enemy types from src/data.js ENEMIES, exported to assets/enemies.glb.

Enemies are drawn as InstancedMeshes, two per type, so each model is split by
part name into:
  - body: everything else. Lit, and multiplied in game by the enemy's colour
    (and by gold for elites, white for the hit flash), so skin is modelled
    white and details as greys: a grey here is a darker shade of the enemy
  - face: parts whose name contains "_face". Unlit and never tinted, so eyes,
    teeth, gold and sparks keep their own colour
Scale: one unit = the enemy's hit radius. The body sits on the ground (z=0)
and is roughly a unit sphere centred one unit up, facing +X, like the
procedural shapes they replace.
"""

import importlib
import math
import os
import sys

import bmesh
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
importlib.reload(common)
from common import box, cone, face_rot, ico, mat, prism, rod, root, sphere, torus  # noqa: E402,F401

SKIN = None


def grey(v, rough=0.6, metal=0.0):
    h = f"#{v:02x}{v:02x}{v:02x}"
    return mat(f"e_grey{v}_{int(rough * 10)}_{int(metal * 10)}", h, rough=rough, metal=metal)


def face(name, color):
    return mat("e_face_" + name, color, rough=0.5, emit=1.0)


def lumpy(name, material, parent, loc, scale, seed=1, amp=0.12, subdiv=2, smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    off = Vector((seed * 5.3, seed * 1.7, seed * 9.1))
    for v in bm.verts:
        d = v.co.normalized()
        v.co = d * (1.0 + noise.noise(d * 1.8 + off) * amp)
    return common.mesh_object(name, bm, material, parent, loc, (0, 0, 0), scale, smooth)


def eyes(n, p, x=0.72, y=0.36, z=1.3, r=0.22, pupil_dx=0.18, angry=False, color="#fff4d0"):
    w, k = face("eye", color), face("pupil", "#2a0810")
    for s in (1, -1):
        sphere(f"{n}_face_eye{s}", w, p, (x, y * s, z), r, segs=(12, 8))
        sphere(f"{n}_face_pupil{s}", k, p, (x + pupil_dx, y * s * 1.03, z + 0.01), r * 0.5, segs=(8, 6))
        if angry:
            box(f"{n}_brow{s}", grey(70), p, (x + 0.08, y * s, z + r + 0.05), (0.07, r * 1.15, 0.05),
                rot=(-24 * s, 0, 0), bevel=0.3)


def teeth(n, p, x, z, width, count, h=0.14, down=True, color="#fff4d0"):
    t = face("tooth", color)
    for i in range(count):
        y = (i / max(1, count - 1) - 0.5) * width
        cone(f"{n}_face_tooth{i}", t, p, (x, y, z), 0.06, 0.0, h,
             rot=(180 if down else 0, 0, 0), segs=5, smooth=False)


def feet(n, p, pairs=((0.35, 0.45), (-0.35, 0.45)), size=(0.25, 0.18, 0.14), shade=90):
    m = grey(shade, 0.8)
    for i, (x, y) in enumerate(pairs):
        for s in (1, -1):
            sphere(f"{n}_foot{i}{s}", m, p, (x, y * s, 0.1), size, segs=(10, 6))


# --------------------------------------------------------------------------
# The roster
# --------------------------------------------------------------------------
def grunt(n, p):
    lumpy(n + "_body", SKIN, p, (0, 0, 0.95), (1.0, 0.95, 0.9), seed=1, amp=0.06)
    horn = grey(215, 0.5)
    for s in (1, -1):
        cone(f"{n}_horn{s}", horn, p, (0.1, 0.45 * s, 1.75), 0.14, 0.0, 0.45, rot=(-25 * s, 10, 0), segs=8)
    eyes(n, p, angry=True)
    sphere(n + "_face_mouth", face("mouth", "#2a0810"), p, (0.88, 0, 0.72), (0.12, 0.32, 0.1), segs=(12, 6))
    teeth(n, p, 0.94, 0.8, 0.44, 4, h=0.1)
    feet(n, p)


def runner(n, p):
    sphere(n + "_body", SKIN, p, (0.05, 0, 1.0), (1.1, 0.72, 0.78), rot=(0, 12, 0), segs=(20, 12))
    cone(n + "_tail", SKIN, p, (-1.05, 0, 1.2), 0.3, 0.0, 0.9, rot=(0, -110, 0), segs=10)
    fin = grey(150)
    for s in (1, -1):
        prism(f"{n}_ear{s}", fin, p, (-0.2, 0.45 * s, 1.55), [(0.2, 0), (-0.6, 0.12), (-0.5, -0.1)], 0.06,
              rot=(90 * s - 60 * s, 0, 0))
        for i, x in enumerate((0.35, -0.35)):
            rod(f"{n}_leg{i}{s}", grey(110), p, (x, 0.35 * s, 0.55), (x + 0.2, 0.5 * s, 0.05), 0.07, 0.05, segs=6)
    eyes(n, p, x=0.85, z=1.2, r=0.2, angry=False)
    teeth(n, p, 1.05, 0.9, 0.3, 3, h=0.1)


def tank(n, p):
    lumpy(n + "_body", SKIN, p, (0, 0, 0.95), (1.05, 1.0, 0.92), seed=4, amp=0.14, subdiv=1, smooth=False)
    plate = grey(150, 0.45, 0.4)
    sphere(n + "_armor", plate, p, (-0.1, 0, 1.15), (0.95, 0.95, 0.82), cut_below=0.35, segs=(18, 10))
    for i, (x, y) in enumerate(((-0.1, 0.0), (0.2, 0.45), (0.2, -0.45))):
        cone(f"{n}_stud{i}", grey(200, 0.3, 0.8), p, (x, y, 1.85 - abs(y) * 0.4), 0.09, 0.0, 0.2, segs=6)
    sphere(n + "_jaw", grey(185), p, (0.65, 0, 0.55), (0.5, 0.7, 0.3), segs=(14, 8))
    tusk = face("tusk", "#f2e6cf")
    for s in (1, -1):
        cone(f"{n}_face_tusk{s}", tusk, p, (0.95, 0.42 * s, 0.85), 0.09, 0.0, 0.42, rot=(-12 * s, -20, 0), segs=6)
    eyes(n, p, x=0.72, z=1.25, r=0.17, angry=True)
    feet(n, p, size=(0.32, 0.24, 0.16), shade=80)


def shooter(n, p):
    cone(n + "_body", SKIN, p, (0, 0, 0.95), 0.95, 0.75, 1.5, segs=18)
    sphere(n + "_cap", SKIN, p, (0, 0, 1.7), (0.75, 0.75, 0.4), cut_below=0.0, segs=(18, 8))
    cone(n + "_base", grey(90, 0.5, 0.4), p, (0, 0, 0.15), 1.0, 1.0, 0.3, segs=18)
    rod(n + "_cannon", grey(80, 0.4, 0.6), p, (0.5, 0, 0.95), (1.35, 0, 0.95), 0.2, segs=12)
    cone(n + "_face_bore", face("bore", "#ffb3c1"), p, (1.36, 0, 0.95), 0.12, 0.12, 0.02, rot=(0, 90, 0), segs=10)
    torus(n + "_band", grey(120, 0.4, 0.5), p, (0, 0, 1.35), 0.83, 0.05, segs=(24, 6))
    eyes(n, p, x=0.62, y=0.3, z=1.55, r=0.18)
    rod(n + "_antenna", grey(90), p, (-0.3, 0, 1.95), (-0.45, 0, 2.5), 0.03, segs=6)
    sphere(n + "_face_blink", face("blink", "#ff5c7a"), p, (-0.45, 0, 2.52), 0.08, segs=(8, 6))


def charger(n, p):
    sphere(n + "_body", SKIN, p, (0, 0, 0.95), (1.1, 0.95, 0.85), segs=(20, 12))
    sphere(n + "_hump", SKIN, p, (-0.3, 0, 1.5), (0.6, 0.7, 0.45), segs=(14, 8))
    horn = face("horn", "#efe4cc")
    for s in (1, -1):
        rod(f"{n}_face_hornBase{s}", horn, p, (0.55, 0.45 * s, 1.5), (0.9, 0.95 * s, 1.65), 0.13, 0.09, segs=8)
        cone(f"{n}_face_hornTip{s}", horn, p, (1.1, 1.05 * s, 1.85), 0.09, 0.0, 0.45,
             rot=face_rot(0.5, 0.15 * s, 0.8), segs=8)
    sphere(n + "_snout", grey(200), p, (0.95, 0, 0.8), (0.3, 0.42, 0.28), segs=(12, 8))
    torus(n + "_face_ring", face("ring", "#ffd166"), p, (1.2, 0, 0.66), 0.12, 0.03, rot=(0, 90, 0), segs=(14, 5))
    eyes(n, p, x=0.78, y=0.4, z=1.25, r=0.18, angry=True)
    feet(n, p, size=(0.26, 0.2, 0.14), shade=60)


def exploder(n, p):
    sphere(n + "_body", SKIN, p, (0, 0, 1.0), 1.0, segs=(22, 14))
    cone(n + "_cap", grey(110, 0.35, 0.8), p, (0, 0, 1.95), 0.3, 0.26, 0.22, segs=14)
    rod(n + "_fuse", grey(60, 0.9), p, (0, 0, 2.05), (0.15, 0, 2.4), 0.05, segs=6)
    sphere(n + "_face_spark", face("spark", "#ffd166"), p, (0.17, 0, 2.45), 0.13, segs=(8, 6))
    sphere(n + "_face_sparkCore", face("sparkCore", "#fff4d0"), p, (0.19, 0, 2.47), 0.07, segs=(6, 4))
    torus(n + "_band", grey(70, 0.4, 0.6), p, (0, 0, 1.0), 1.0, 0.06, segs=(28, 6))
    eyes(n, p, x=0.74, y=0.34, z=1.32, r=0.2, angry=True)
    sphere(n + "_face_grin", face("mouth", "#2a0810"), p, (0.9, 0, 0.75), (0.1, 0.38, 0.12), segs=(12, 6))
    teeth(n, p, 0.97, 0.83, 0.55, 5, h=0.11)


def spitter(n, p):
    lumpy(n + "_body", SKIN, p, (0, 0, 0.75), (1.1, 1.0, 0.75), seed=6, amp=0.08)
    sphere(n + "_sac", grey(215), p, (-0.45, 0, 1.3), (0.55, 0.6, 0.5), segs=(14, 8))
    bump = grey(235)
    for i, (x, y, z) in enumerate(((-0.4, 0.4, 1.6), (-0.7, -0.3, 1.45), (-0.2, -0.45, 1.55), (0.1, 0.5, 1.25))):
        sphere(f"{n}_wart{i}", bump, p, (x, y, z), 0.12, segs=(8, 6))
    sphere(n + "_lips", grey(175), p, (0.9, 0, 0.62), (0.3, 0.55, 0.22), segs=(14, 8))
    sphere(n + "_face_mouth", face("mouth", "#2a0810"), p, (1.08, 0, 0.62), (0.12, 0.4, 0.1), segs=(12, 6))
    sphere(n + "_face_drool", face("drool", "#c8ff8a"), p, (1.12, 0.2, 0.42), (0.06, 0.06, 0.12), segs=(8, 6))
    eyes(n, p, x=0.55, y=0.4, z=1.25, r=0.22)


def swarmer(n, p):
    ico(n + "_body", SKIN, p, (0, 0, 1.0), (1.0, 0.8, 0.8), subdiv=1, smooth=True)
    sphere(n + "_abdomen", grey(190), p, (-0.9, 0, 0.95), (0.6, 0.5, 0.5), segs=(12, 8))
    for i in range(3):
        torus(f"{n}_stripe{i}", grey(60), p, (-0.7 - i * 0.22, 0, 0.95), 0.42 - i * 0.07, 0.04, rot=(0, 90, 0),
              scale=(1, 1, 1), segs=(16, 5))
    cone(n + "_stinger", grey(50), p, (-1.55, 0, 0.95), 0.12, 0.0, 0.35, rot=(0, -90, 0), segs=6)
    wing = face("wing", "#e6f4ff")
    for s in (1, -1):
        sphere(f"{n}_face_wing{s}", wing, p, (-0.3, 0.75 * s, 1.75), (0.55, 0.3, 0.03),
               rot=(15 * s, 0, 25 * s), segs=(12, 6))
        rod(f"{n}_antenna{s}", grey(50), p, (0.6, 0.2 * s, 1.55), (1.0, 0.45 * s, 2.1), 0.03, segs=5)
        sphere(f"{n}_antTip{s}", grey(50), p, (1.0, 0.45 * s, 2.1), 0.07, segs=(6, 4))
    eyes(n, p, x=0.75, y=0.32, z=1.15, r=0.24, pupil_dx=0.16)


def warden(n, p):
    sphere(n + "_body", SKIN, p, (0, 0, 1.0), 1.0, segs=(28, 18))
    for i, z in enumerate((0.55, 1.35)):
        torus(f"{n}_band{i}", grey(90, 0.35, 0.7), p, (0, 0, z), math.sqrt(1 - (z - 1) ** 2) + 0.02, 0.06,
              segs=(32, 6))
    gold = face("gold", "#ffd166")
    torus(n + "_face_crownRing", gold, p, (0, 0, 1.82), 0.52, 0.07, segs=(24, 6))
    for i in range(7):
        a = i * math.tau / 7
        cone(f"{n}_face_crownSpike{i}", gold, p, (math.cos(a) * 0.52, math.sin(a) * 0.52, 2.05), 0.1, 0.0, 0.4,
             segs=6, smooth=False)
    sphere(n + "_face_jewel", face("jewel", "#7fd7ff"), p, (0.5, 0, 1.9), 0.09, segs=(8, 6))
    spike = grey(200, 0.4, 0.5)
    for s in (1, -1):
        sphere(f"{n}_pauldron{s}", grey(110, 0.35, 0.7), p, (-0.1, 0.9 * s, 1.35), (0.4, 0.3, 0.32), segs=(12, 8))
        for j in range(3):
            cone(f"{n}_spike{s}{j}", spike, p, (-0.3 + j * 0.2, 1.08 * s, 1.55), 0.07, 0.0, 0.35,
                 rot=(-30 * s, 0, 0), segs=6)
    eyes(n, p, x=0.8, y=0.3, z=1.3, r=0.16, angry=True)
    sphere(n + "_face_mouth", face("mouth", "#2a0810"), p, (0.9, 0, 0.8), (0.1, 0.35, 0.1), segs=(12, 6))
    teeth(n, p, 0.97, 0.87, 0.5, 5, h=0.1)


def devourer(n, p):
    lumpy(n + "_body", SKIN, p, (0, 0, 1.0), (1.0, 1.0, 0.95), seed=9, amp=0.08, subdiv=3)
    for s in (1, -1):
        cone(f"{n}_horn{s}", grey(60), p, (-0.1, 0.55 * s, 1.85), 0.16, 0.0, 0.6, rot=(-35 * s, -20, 0), segs=8)
    # the maw: a dark disc on the front ringed by two rows of teeth
    sphere(n + "_face_maw", face("maw", "#1a0510"), p, (0.8, 0, 0.9), (0.28, 0.62, 0.45), segs=(16, 10))
    t = face("fang", "#fff4d0")
    for i in range(9):
        a = math.pi * (0.1 + 0.8 * i / 8)
        y, z = math.cos(a) * 0.52, math.sin(a) * 0.36
        cone(f"{n}_face_fangTop{i}", t, p, (0.98, y, 0.95 + z), 0.07, 0.0, 0.2, rot=(180, 0, 0), segs=5)
        cone(f"{n}_face_fangBot{i}", t, p, (0.98, y, 0.85 - z), 0.07, 0.0, 0.2, segs=5)
    sphere(n + "_face_tongue", face("tongue", "#ff5c7a"), p, (0.92, 0, 0.62), (0.2, 0.25, 0.08), segs=(10, 6))
    eyes(n, p, x=0.55, y=0.42, z=1.6, r=0.14, angry=True, color="#ffe066")
    for i in range(6):
        a = i * math.tau / 6 + 0.3
        base = Vector((math.cos(a) * 0.8, math.sin(a) * 0.8, 0.35))
        tip = Vector((math.cos(a) * 1.3, math.sin(a) * 1.3, 0.05))
        rod(f"{n}_tentacle{i}", grey(150), p, base, tip, 0.16, 0.04, segs=8)


ROSTER = [grunt, runner, tank, shooter, charger, exploder, spitter, swarmer, warden, devourer]
NAMES = ["Grunt", "Runner", "Tank", "Shooter", "Charger", "Exploder", "Spitter", "Swarmer", "Warden", "Devourer"]
PREVIEW_TINT = ["#e05f5f", "#f0a35e", "#8c6bb1", "#5ea8e0", "#d94f8c", "#ff5c2e", "#7ed957", "#ffd166",
                "#ff3b6b", "#b026ff"]


def build(preview_tint=True):
    """preview_tint colours the skin like the game would, only for looking at it in Blender."""
    global SKIN
    common.use_collection("Enemies")
    roots = []
    for i, fn in enumerate(ROSTER):
        SKIN = mat("e_skin_" + NAMES[i], PREVIEW_TINT[i] if preview_tint else "#ffffff", rough=0.6)
        r = root(NAMES[i], (-4 + (i % 5) * 3.2, 16 + (i // 5) * 3.6, 0), enemy_type=i)
        fn(NAMES[i], r)
        roots.append(r)
    return roots


def export():
    """Rebuild with white skin (the game tints it), export, then restore the tinted preview."""
    roots = build(preview_tint=False)
    out = common.export_glb("enemies.glb", roots)
    globals()["ROOTS"] = build(preview_tint=True)
    return out


if globals().get("RUN", True):
    ROOTS = build()
