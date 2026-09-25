"""
Projectile and effect meshes, exported to assets/projectiles.glb.

Projectiles (one root per PROJ_KINDS entry in src/protocol.js):
  - one unit = the projectile's drawn radius; the game scales each instance
    uniformly by that radius, so proportions here are the final look
  - they fly along +X and are drawn unlit, so material base colours are the
    final on-screen colours (the game adds a soft additive halo on top)

Effects (roots prefixed "fx_"):
  - fx_muzzle: a flat star-burst flash, 1 unit long along +X
  - fx_blast:  a lumpy fireball of radius 1 for explosions
  - fx_slash:  a crescent sweep for melee swings, radius 1 in the XY plane
  These are white; the game tints them per weapon with additive blending.
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
from common import cone, ico, mat, prism, root, sphere, star_outline, torus  # noqa: E402


def c(name, color):
    return mat("p_" + name, color, rough=0.5, emit=2.0)


def bullet(n, p):
    cone(n + "_slug", c("bullet_body", "#ffd98a"), p, (0.2, 0, 0), 0.75, 0.75, 2.0, rot=(0, 90, 0), segs=12)
    cone(n + "_nose", c("bullet_nose", "#fff6d8"), p, (1.8, 0, 0), 0.75, 0.0, 1.2, rot=(0, 90, 0), segs=12)
    cone(n + "_trail", c("bullet_trail", "#ff9f3c"), p, (-2.2, 0, 0), 0.0, 0.7, 2.8, rot=(0, 90, 0), segs=10)


def pellet(n, p):
    sphere(n + "_ball", c("pellet", "#ffc27a"), p, (0, 0, 0), 1.0, segs=(12, 8))
    cone(n + "_trail", c("pellet_trail", "#ff8a3c"), p, (-1.6, 0, 0), 0.0, 0.8, 1.8, rot=(0, 90, 0), segs=8)


def laser(n, p):
    cone(n + "_beam", c("laser", "#8ff6ff"), p, (0, 0, 0), 0.55, 0.55, 9.0, rot=(0, 90, 0), segs=10)
    for s in (1, -1):
        cone(f"{n}_tip{s}", c("laser_tip", "#e8feff"), p, (4.5 * s + 0.6 * s, 0, 0), 0.55, 0.0, 1.2,
             rot=(0, 90 * s, 0), segs=10)
    cone(n + "_core", c("laser_core", "#ffffff"), p, (0.2, 0, 0), 0.3, 0.3, 9.4, rot=(0, 90, 0), segs=8)


def rocket(n, p):
    cone(n + "_body", c("rocket_body", "#e9ecf2"), p, (0, 0, 0), 0.8, 0.8, 3.0, rot=(0, 90, 0), segs=14)
    cone(n + "_nose", c("rocket_nose", "#e63946"), p, (2.1, 0, 0), 0.8, 0.0, 1.2, rot=(0, 90, 0), segs=14)
    cone(n + "_band", c("rocket_band", "#ffd166"), p, (0.9, 0, 0), 0.82, 0.82, 0.35, rot=(0, 90, 0), segs=14)
    fin = c("rocket_fin", "#4a5068")
    for i in range(4):
        a = i * 90 + 45
        prism(f"{n}_fin{i}", fin, p, (-1.2, 0, 0), [(-0.4, 0.6), (0.6, 0.6), (-0.2, 1.5), (-0.5, 1.5)], 0.14,
              rot=(a, 0, 0))
    cone(n + "_exhaust", c("rocket_fire", "#ffb347"), p, (-2.4, 0, 0), 0.0, 0.65, 1.8, rot=(0, 90, 0), segs=10)
    cone(n + "_exhaustCore", c("rocket_fireCore", "#fff3c4"), p, (-1.9, 0, 0), 0.0, 0.4, 1.0,
         rot=(0, 90, 0), segs=8)


def flame(n, p):
    lumpy(n + "_puff", c("flame", "#ffb03a"), p, (0, 0, 0), 1.0, seed=3, amp=0.28)
    ico(n + "_core", c("flame_core", "#fff1b8"), p, (0.25, 0, 0), 0.55, subdiv=1, smooth=True)


def orb(n, p):
    sphere(n + "_ball", c("orb", "#caa6ff"), p, (0, 0, 0), 1.05, segs=(16, 10))
    sphere(n + "_core", c("orb_core", "#f4ecff"), p, (0.25, 0, 0.25), 0.55, segs=(10, 8))
    torus(n + "_ring", c("orb_ring", "#8f5cff"), p, (0, 0, 0), 1.55, 0.12, rot=(70, 0, 0), segs=(24, 6))


def star(n, p):
    prism(n + "_blades", c("star", "#e3f1ff"), p, (0, 0, 0), star_outline(4, 1.9, 0.55, 0.0), 0.3)
    cone(n + "_hub", c("star_hub", "#7fb8e6"), p, (0, 0, 0), 0.45, 0.45, 0.4, segs=12)


def enemy(n, p):
    ico(n + "_core", c("enemy", "#ff5c7a"), p, (0, 0, 0), 1.05, subdiv=1, smooth=True)
    spike = c("enemy_spike", "#ffb3c1")
    verts = [Vector(v) for v in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1),
                                 (0.7, 0.7, 0), (-0.7, 0.7, 0), (0.7, -0.7, 0), (-0.7, -0.7, 0))]
    for i, d in enumerate(verts):
        d.normalize()
        q = Vector((0, 0, 1)).rotation_difference(d)
        cone(f"{n}_spike{i}", spike, p, d * 1.15, 0.28, 0.0, 0.6,
             rot=[math.degrees(a) for a in q.to_euler()], segs=6, smooth=False)


def spit(n, p):
    sphere(n + "_drop", c("spit", "#9ddc5c"), p, (0.3, 0, 0), (1.2, 1.0, 1.0), segs=(14, 10))
    cone(n + "_tail", c("spit_tail", "#6fbf3a"), p, (-1.3, 0, 0), 0.0, 0.85, 2.0, rot=(0, 90, 0), segs=10)
    sphere(n + "_shine", c("spit_shine", "#e6ffc8"), p, (0.8, 0.3, 0.5), 0.3, segs=(8, 6))


# --------------------------------------------------------------------------
# Effects
# --------------------------------------------------------------------------
def lumpy(name, material, parent, loc, radius, seed=1, amp=0.25, subdiv=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    off = Vector((seed * 5.3, seed * 1.7, seed * 9.1))
    for v in bm.verts:
        d = v.co.normalized()
        v.co = d * (1.0 + noise.noise(d * 2.2 + off) * amp + noise.noise(d * 5.0 + off) * amp * 0.4)
    return common.mesh_object(name, bm, material, parent, loc, (0, 0, 0), radius, smooth=True)


def fx_muzzle(n, p):
    white = c("fx_white", "#ffffff")
    # a long forward petal, two angled side petals and a round core, all flat
    prism(n + "_petals", white, p, (0, 0, 0),
          [(0.0, -0.18), (0.35, -0.12), (0.55, -0.42), (0.55, -0.1), (1.0, 0.0),
           (0.55, 0.1), (0.55, 0.42), (0.35, 0.12), (0.0, 0.18)], 0.04)
    sphere(n + "_core", white, p, (0.12, 0, 0), (0.22, 0.2, 0.08), segs=(10, 6))


def fx_blast(n, p):
    lumpy(n + "_ball", c("fx_white", "#ffffff"), p, (0, 0, 0), 1.0, seed=7, amp=0.22)


def fx_slash(n, p):
    """A blade trail in the XY plane centred on +X, about 76 degrees wide.

    Drawn additively, so colour is opacity: the leading edge (-Y, the side a
    swing sweeps toward in game) is white and the tail fades to dark grey.
    """
    seg = 6                      # one material per segment, bright to dim
    per = 4
    for k in range(seg):
        bm = bmesh.new()
        outer, inner = [], []
        for i in range(per + 1):
            t = (k * per + i) / (seg * per)          # 0 = leading edge, 1 = tail
            a = math.radians(-38 + 76 * t)
            w = 0.34 * math.sin(math.pi * min(1.0, 0.15 + t * 0.95))
            outer.append(bm.verts.new((math.cos(a), math.sin(a), 0)))
            r_in = 1.0 - w
            inner.append(bm.verts.new((math.cos(a) * r_in, math.sin(a) * r_in, 0)))
        for i in range(per):
            bm.faces.new((inner[i], inner[i + 1], outer[i + 1], outer[i]))
        v = int(255 * (1.0 - k / seg) ** 1.6)
        common.mesh_object(f"{n}_arc{k}", bm, mat(f"p_fx_slash{k}", f"#{v:02x}{v:02x}{v:02x}", emit=1.0), p,
                           smooth=False)


KINDS = [bullet, pellet, laser, rocket, flame, orb, star, enemy, spit]
FX = [fx_muzzle, fx_blast, fx_slash]


def build():
    common.use_collection("Projectiles")
    roots = []
    for i, fn in enumerate(KINDS + FX):
        r = root(fn.__name__, (30 + (i % 6) * 5.0 - 12, -14 - (i // 6) * 6.0, 2.0))
        fn(fn.__name__, r)
        roots.append(r)
    return roots


def export(roots):
    return common.export_glb("projectiles.glb", roots)


if globals().get("RUN", True):
    ROOTS = build()
