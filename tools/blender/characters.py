"""
Builds the eight playable potatoes and exports them to assets/characters.glb.

Run inside Blender (Text Editor → Run Script, or exec() over the MCP bridge).
Re-running replaces the "Characters" collection, so edit and re-run freely.

Conventions match makePlayer() in src/render3d.js, so a model can stand in
for the procedural sphere without re-tuning anything:
  - one Blender unit = PLAYER_R in game; the body is the same ellipsoid
    (radii 1.0 / 0.92 / 1.15 centred 1.12 up)
  - the character faces +X, Z is up (glTF export turns that into Three's +Y)
  - weapons are separate models (weapons.py) that float beside the potato,
    so nothing here is held
  - each character is an empty named after it; parts named "_body" or
    "_butt" take the skin material, which the game swaps for the hit flash,
    and "_eye"/"_pupil" parts are drawn unlit
"""

import importlib
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
importlib.reload(common)
from common import box, cone, face_rot, mat, shade, sphere, torus  # noqa: E402,F401

BODY_C = Vector((0.0, 0.0, 1.12))
BODY_R = Vector((1.0, 0.92, 1.15))
SPACING = 3.4


def _obj(name, bm, material, parent, loc, rot, scale, smooth):
    return common.mesh_object(name, bm, material, parent, loc, rot, scale, smooth)


_shade = shade
_face_rot = face_rot


def on_body(x, y, z, push=0.0):
    """Point on the body surface in direction (x, y, z), pushed out by `push`."""
    d = Vector((x, y, z)).normalized()
    p = Vector((d.x * BODY_R.x, d.y * BODY_R.y, d.z * BODY_R.z))
    n = Vector((d.x / BODY_R.x, d.y / BODY_R.y, d.z / BODY_R.z)).normalized()
    return BODY_C + p + n * push


def ring_at(z, pad=0.0):
    """Body radii (x, y) of the horizontal slice at height z, plus padding."""
    t = (z - BODY_C.z) / BODY_R.z
    f = math.sqrt(max(0.0, 1 - t * t))
    return BODY_R.x * f + pad, BODY_R.y * f + pad


# --------------------------------------------------------------------------
# Shared parts: lumpy potato body, eyes, stubby feet
# --------------------------------------------------------------------------
def potato_body(name, color, parent, seed):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=20, radius=1.0)
    off = Vector((seed * 7.1, seed * 3.3, seed * 5.7))
    for v in bm.verts:
        d = v.co.normalized()
        lump = noise.noise(d * 1.6 + off) * 0.07 + noise.noise(d * 3.4 + off) * 0.025
        if d.x > 0.45 and 0.05 < d.z < 0.75:   # keep the face smooth around the eyes
            lump *= 0.25
        if d.z > 0.4:                            # and the crown, where hats and hair sit
            lump *= 0.3
        v.co = d * (1.0 + lump)
        if v.co.z < -0.82:                       # a slightly flat bottom it can stand on
            v.co.z = -0.82 + (v.co.z + 0.82) * 0.35
    body_mat = mat("body_" + name, color, rough=0.72)
    ob = _obj(name + "_body", bm, body_mat, parent, BODY_C, (0, 0, 0), BODY_R, True)
    # a small round butt: two cheeks low on the back, same skin as the body
    for s in (1, -1):
        sphere(f"{name}_butt{'L' if s > 0 else 'R'}", body_mat, parent, (-0.74, 0.16 * s, 0.4),
               (0.24, 0.22, 0.25), rot=(0, 0, 18 * s), segs=(16, 10))
    # a few darker potato "eyes" (the tuber kind), placed away from the face
    spot = mat("potato_spot_" + name, _shade(color, 0.72), rough=0.9)
    for i, (dx, dy, dz) in enumerate(((-0.6, 0.7, 0.2), (-0.8, -0.4, -0.2), (0.1, 0.9, -0.4))):
        sphere(f"{name}_spot{i}", spot, parent, on_body(dx, dy, dz, -0.02), (0.07, 0.07, 0.05),
               rot=_face_rot(dx, dy, dz), segs=(8, 6))
    return ob






def eyes(name, parent, pupil="#141421", pupil_scale=0.13):
    white = mat("eye_white", "#ffffff", rough=0.3)
    dark = mat("pupil_" + pupil.lstrip("#"), pupil, rough=0.25)
    for s in (1, -1):
        sphere(f"{name}_eye{'L' if s > 0 else 'R'}", white, parent, (0.78, 0.34 * s, 1.42), 0.26, segs=(14, 10))
        sphere(f"{name}_pupil{'L' if s > 0 else 'R'}", dark, parent, (0.98, 0.36 * s, 1.44), pupil_scale, segs=(10, 8))


def feet(name, parent, color="#3a2a22", scale=(0.3, 0.2, 0.13)):
    m = mat("feet_" + color.lstrip("#"), color, rough=0.8)
    return [sphere(f"{name}_foot{'L' if s > 0 else 'R'}", m, parent, (0.42, 0.42 * s, 0.1), scale, segs=(12, 8))
            for s in (1, -1)]


# --------------------------------------------------------------------------
# The cast
# --------------------------------------------------------------------------
def wanderer(n, p):
    """Backpacker with a red scarf and a fresh sprout on top."""
    scarf = mat("wanderer_scarf", "#e04848", rough=0.85)
    z = 0.92
    rx, ry = ring_at(z, 0.02)
    torus(n + "_scarf", scarf, p, (0, 0, z), 1.0, 0.13, scale=(rx, ry, 1.0))
    box(n + "_scarfTail", scarf, p, (-0.95, 0.42, 0.68), (0.1, 0.16, 0.36), rot=(18, -20, 0))
    pack = mat("wanderer_pack", "#8b5a2b", rough=0.8)
    box(n + "_pack", pack, p, (-0.98, 0, 1.18), (0.3, 0.55, 0.6), rot=(0, 8, 0))
    box(n + "_pocket", mat("wanderer_pocket", "#6e4520", rough=0.8), p, (-1.28, 0, 1.0), (0.08, 0.36, 0.25))
    cone(n + "_bedroll", mat("wanderer_roll", "#c9b28a", rough=0.9), p, (-1.08, 0, 1.72), 0.19, 0.19, 1.0,
         rot=(90, 0, 0), segs=14)
    leaf = mat("sprout_leaf", "#5cc94a", rough=0.6)
    cone(n + "_stem", leaf, p, (0, 0, 2.4), 0.06, 0.05, 0.4, segs=8)
    sphere(n + "_leaf1", leaf, p, (0.08, 0.26, 2.6), (0.14, 0.32, 0.06), rot=(-30, 0, 0), segs=(10, 6))
    sphere(n + "_leaf2", leaf, p, (0.08, -0.26, 2.6), (0.14, 0.32, 0.06), rot=(30, 0, 0), segs=(10, 6))
    feet(n, p)


def brawler(n, p):
    """Headband, scowl, a sticking plaster and one boxing glove."""
    band = mat("brawler_band", "#d62828", rough=0.7)
    z = 1.86
    rx, ry = ring_at(z, 0.01)
    torus(n + "_band", band, p, (0, 0, z), 1.0, 0.09, scale=(rx, ry, 1.0))
    sphere(n + "_knot", band, p, (-rx - 0.02, 0, z), 0.12)
    box(n + "_tail1", band, p, (-rx - 0.28, 0.12, z - 0.14), (0.26, 0.05, 0.08), rot=(0, 30, 18), bevel=0.03)
    box(n + "_tail2", band, p, (-rx - 0.24, -0.14, z - 0.26), (0.22, 0.05, 0.08), rot=(0, 45, -22), bevel=0.03)
    brow = mat("brow", "#2a1a14", rough=0.6)
    for s in (1, -1):
        box(f"{n}_brow{s}", brow, p, (0.9, 0.34 * s, 1.72), (0.07, 0.25, 0.06), rot=(22 * s, 0, 0), bevel=0.03)
    plaster = mat("plaster", "#f2dfc4", rough=0.9)
    pos = on_body(0.75, -0.58, -0.1, 0.0)
    box(n + "_plasterA", plaster, p, pos, (0.03, 0.2, 0.06), rot=(35, 0, -38), bevel=0.02)
    box(n + "_plasterB", plaster, p, pos, (0.03, 0.2, 0.06), rot=(-35, 0, -38), bevel=0.02)
    glove = mat("brawler_glove", "#c1121f", rough=0.35)
    sphere(n + "_glove", glove, p, (0.6, 0.92, 0.95), (0.34, 0.3, 0.3))
    cone(n + "_cuff", mat("glove_cuff", "#f1f1f1", rough=0.6), p, (0.28, 0.9, 0.95), 0.2, 0.22, 0.2,
         rot=(0, 90, 0))
    feet(n, p, "#2b2d42")


def ranger(n, p):
    """Feathered hunter's cap and a quiver of arrows."""
    cap = mat("ranger_cap", "#2f6b3a", rough=0.8)
    sphere(n + "_capBase", cap, p, (0.0, 0, 1.95), (0.86, 0.82, 0.5), cut_below=0.0, segs=(24, 12))
    cone(n + "_capPeak", cap, p, (-0.32, 0, 2.3), 0.62, 0.02, 1.0, rot=(0, -62, 0), scale=(1, 0.95, 1))
    cone(n + "_brim", cap, p, (0.62, 0, 1.98), 0.5, 0.2, 0.08, rot=(0, 80, 0), scale=(1, 1.3, 1))
    feather = mat("ranger_feather", "#e63946", rough=0.6)
    sphere(n + "_feather", feather, p, (-0.2, 0.62, 2.45), (0.55, 0.05, 0.12), rot=(0, 20, 12))
    quiver = mat("ranger_quiver", "#5a3a1e", rough=0.8)
    trim = mat("ranger_trim", "#c9a86a", rough=0.5, metal=0.3)
    qrot = (-28, -15, 0)
    cone(n + "_quiver", quiver, p, (-0.98, 0.32, 1.3), 0.27, 0.27, 1.1, rot=qrot, segs=14)
    cone(n + "_quiverRim", trim, p, (-1.06, 0.6, 1.8), 0.29, 0.29, 0.07, rot=qrot, segs=14)
    shaft = mat("arrow_shaft", "#d8c3a5", rough=0.8)
    fletch = mat("fletching", "#e63946", rough=0.7)
    for i, (dx, dy) in enumerate(((0.06, -0.1), (-0.06, 0.02), (0.05, 0.14))):
        base = Vector((-1.08 + dx, 0.64 + dy, 1.86))
        up = Vector((0, 0, 1))
        up.rotate(Matrix.Rotation(math.radians(qrot[0]), 3, "X"))
        up.rotate(Matrix.Rotation(math.radians(qrot[1]), 3, "Y"))
        cone(f"{n}_shaft{i}", shaft, p, base + up * 0.18, 0.025, 0.025, 0.36, rot=qrot, segs=5)
        cone(f"{n}_fletch{i}", fletch, p, base + up * 0.38, 0.1, 0.02, 0.2, rot=qrot, segs=3, smooth=False)
    feet(n, p, "#4a3222")


def bulwark(n, p):
    """Knight's helmet with a plume, pauldrons and a round shield."""
    steel = mat("steel", "#9aa3b8", rough=0.3, metal=0.85)
    dark_steel = mat("steel_dark", "#5b6275", rough=0.35, metal=0.85)
    sphere(n + "_helm", steel, p, BODY_C, (1.06, 0.98, 1.2), cut_below=0.48, segs=(28, 16))
    z = BODY_C.z + 0.48 * 1.2
    rx, ry = ring_at(z, 0.08)
    torus(n + "_rim", dark_steel, p, (0, 0, z), 1.0, 0.07, scale=(rx, ry, 1.0))
    box(n + "_noseguard", dark_steel, p, (0.99, 0, 1.56), (0.05, 0.07, 0.24), bevel=0.02)
    plume = mat("bulwark_plume", "#c1121f", rough=0.8)
    sphere(n + "_plume", plume, p, (-0.15, 0, 2.42), (0.75, 0.12, 0.26), rot=(0, 12, 0))
    for s in (1, -1):
        sphere(f"{n}_pauldron{s}", steel, p, (-0.12, 0.9 * s, 1.18), (0.42, 0.3, 0.36), cut_below=-0.15)
    shield = mat("shield_wood", "#8b5a2b", rough=0.8)
    cone(n + "_shield", shield, p, (0.62, 0.98, 0.95), 0.62, 0.62, 0.1, rot=(90, 0, -40), segs=24)
    torus(n + "_shieldRim", dark_steel, p, (0.64, 1.0, 0.95), 0.62, 0.05, rot=(90, 0, -40), segs=(28, 6))
    sphere(n + "_boss", steel, p, (0.67, 1.04, 0.95), (0.18, 0.1, 0.18), rot=(0, 0, -40))
    feet(n, p, "#5b6275", (0.34, 0.24, 0.15))


def streaker(n, p):
    """Swept-back spikes, aviator goggles and flashy red sneakers."""
    hair = mat("streaker_hair", "#ff9f1c", rough=0.6)
    for i, (y, zz, ln) in enumerate(((0.0, 2.25, 1.2), (0.36, 2.1, 0.95), (-0.36, 2.1, 0.95))):
        cone(f"{n}_spike{i}", hair, p, (-0.55, y, zz), 0.26, 0.0, ln, rot=(0, -62, 0), segs=6, smooth=False)
    strap = mat("goggle_strap", "#2b2d42", rough=0.7)
    z = 1.84
    rx, ry = ring_at(z, 0.02)
    torus(n + "_strap", strap, p, (0, 0, z), 1.0, 0.06, scale=(rx, ry, 1.0))
    rim = mat("goggle_rim", "#b08d57", rough=0.35, metal=0.7)
    lens = mat("goggle_lens", "#66f0ff", rough=0.1, emit=0.6)
    for s in (1, -1):
        pos = on_body(0.62, 0.3 * s, 0.62, 0.04)
        rot = _face_rot(pos.x, pos.y * 0.6, (pos.z - BODY_C.z) * 0.9)
        torus(f"{n}_rim{s}", rim, p, pos, 0.17, 0.045, rot=rot, segs=(18, 6))
        sphere(f"{n}_lens{s}", lens, p, pos, (0.16, 0.16, 0.06), rot=rot, segs=(12, 8))
    for s in (1, -1):
        sphere(f"{n}_shoe{s}", mat("sneaker", "#e63946", rough=0.45), p, (0.48, 0.42 * s, 0.12),
               (0.38, 0.22, 0.14), segs=(14, 8))
        sphere(f"{n}_sole{s}", mat("sneaker_sole", "#f8f9fa", rough=0.7), p, (0.48, 0.42 * s, 0.02),
               (0.4, 0.23, 0.06), segs=(14, 8))


def gambler(n, p):
    """Top hat with an ace in the band, a monocle and a bow tie."""
    hat = mat("gambler_hat", "#1b1b24", rough=0.45)
    band = mat("gambler_band", "#c9184a", rough=0.5)
    tilt = (8, -6, 0)
    cone(n + "_brim", hat, p, (0.0, 0, 2.2), 0.82, 0.82, 0.06, rot=tilt, segs=28)
    cone(n + "_crown", hat, p, (-0.02, -0.06, 2.62), 0.5, 0.55, 0.82, rot=tilt, segs=24)
    cone(n + "_band", band, p, (0.0, -0.04, 2.33), 0.54, 0.56, 0.16, rot=tilt, segs=24)
    card = mat("card", "#fdfdfd", rough=0.6)
    box(n + "_card", card, p, (0.12, 0.54, 2.5), (0.13, 0.015, 0.19), rot=(10, 0, -25), bevel=0.01)
    box(n + "_pip", band, p, (0.13, 0.56, 2.5), (0.05, 0.01, 0.06), rot=(10, 0, -25), bevel=0.01)
    gold = mat("gold", "#e9c46a", rough=0.25, metal=1.0)
    torus(n + "_monocle", gold, p, (1.02, -0.36, 1.44), 0.2, 0.03, rot=(0, 90, 0), segs=(20, 6))
    torus(n + "_chain", gold, p, (0.92, -0.62, 1.1), 0.26, 0.012, rot=(0, 80, 60), segs=(16, 4), arc=160)
    tie = mat("gambler_tie", "#141421", rough=0.5)
    x = ring_at(0.6)[0] - 0.02
    for s in (1, -1):
        cone(f"{n}_bow{s}", tie, p, (x, 0.17 * s, 0.6), 0.2, 0.03, 0.32, rot=(-90 * s, 0, 0), segs=8)
    sphere(n + "_knot", tie, p, (x + 0.03, 0, 0.6), 0.09)
    feet(n, p, "#1b1b24")


def pyro(n, p):
    """Gas-mask snout, twin fuel tanks and a pilot flame on top."""
    mask = mat("pyro_mask", "#3d405b", rough=0.5)
    metal = mat("steel", "#9aa3b8", rough=0.3, metal=0.85)
    sphere(n + "_mask", mask, p, (0.9, 0, 0.98), (0.26, 0.4, 0.26), segs=(16, 10))
    cone(n + "_filter", metal, p, (1.14, 0, 0.94), 0.17, 0.2, 0.16, rot=(0, 90, 0), segs=14)
    cone(n + "_filterCap", mask, p, (1.23, 0, 0.94), 0.13, 0.13, 0.04, rot=(0, 90, 0), segs=14)
    z = 1.0
    rx, ry = ring_at(z, 0.01)
    torus(n + "_strap", mask, p, (0, 0, z), 1.0, 0.05, scale=(rx, ry, 1.0))
    tank = mat("pyro_tank", "#ffb703", rough=0.35, metal=0.4)
    stripe = mat("pyro_stripe", "#2b2d42", rough=0.6)
    for s in (1, -1):
        cone(f"{n}_tank{s}", tank, p, (-0.95, 0.3 * s, 1.15), 0.24, 0.24, 1.0, segs=16)
        sphere(f"{n}_tankTop{s}", tank, p, (-0.95, 0.3 * s, 1.65), (0.24, 0.24, 0.16), cut_below=0.0)
        cone(f"{n}_tankBand{s}", stripe, p, (-0.95, 0.3 * s, 1.3), 0.25, 0.25, 0.1, segs=16)
    torus(n + "_hose", mask, p, (-0.55, -0.62, 1.2), 0.45, 0.05, rot=(0, 0, -30), segs=(20, 6), arc=150)
    flame_o = mat("flame_outer", "#ff4d00", rough=0.5, emit=1.2)
    flame_i = mat("flame_inner", "#ffc300", rough=0.5, emit=1.5)
    sphere(n + "_flame", flame_o, p, (0, 0, 2.42), (0.24, 0.24, 0.24))
    cone(n + "_flameTip", flame_o, p, (-0.04, 0, 2.72), 0.235, 0.0, 0.5, rot=(0, -10, 0), segs=12)
    sphere(n + "_flameCore", flame_i, p, (0.12, 0, 2.42), (0.14, 0.14, 0.18))
    feet(n, p, "#3d405b")


def leech(n, p):
    """Vampire: slicked hair with a widow's peak, fangs and a high collar."""
    hair = mat("leech_hair", "#1d1a2b", rough=0.3)
    sphere(n + "_hair", hair, p, BODY_C, (1.03, 0.95, 1.18), cut_below=0.62, segs=(28, 16))
    cone(n + "_peak", hair, p, (0.66, 0, 1.94), 0.16, 0.0, 0.34, rot=(0, 140, 0), segs=8, scale=(1, 1.6, 1))
    fang = mat("fang", "#fdfdfd", rough=0.3)
    for s in (1, -1):
        pos = on_body(0.95, 0.13 * s, -0.12, -0.03)
        cone(f"{n}_fang{s}", fang, p, pos, 0.05, 0.0, 0.17, rot=(180, 0, 0), segs=6)
    collar_out = mat("leech_collar", "#3a0f3f", rough=0.6)
    collar_in = mat("leech_lining", "#9d0208", rough=0.5)
    bm = bmesh.new()
    def shell(name, r1, r2, depth, z, keep):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, cap_tris=False, segments=32, radius1=r1, radius2=r2, depth=depth)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co)], context="VERTS")
        bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=0.05)
        ob = _obj(name, bm, collar_out, p, (0, 0, z), (0, 0, 0), (1.0, 0.95, 1.0), True)
        ob.data.materials.append(collar_in)
        for poly in ob.data.polygons:  # inward-facing shell gets the red lining
            poly.material_index = 1 if (poly.center.x * poly.normal.x + poly.center.y * poly.normal.y) < 0 else 0
        return ob
    shell(n + "_collar", 1.0, 1.32, 0.75, 1.38, lambda co: co.x < 0.3)
    shell(n + "_cape", 1.18, 1.02, 0.7, 0.88, lambda co: co.x < -0.05)
    clasp = mat("gold", "#e9c46a", rough=0.25, metal=1.0)
    for s in (1, -1):
        sphere(f"{n}_clasp{s}", clasp, p, (0.3, 0.95 * s, 1.05), 0.08)
    feet(n, p, "#1d1a2b")


CAST = [
    ("Wanderer", "#7ec8ff", wanderer, "#141421"),
    ("Brawler", "#ff8a5c", brawler, "#141421"),
    ("Ranger", "#8dffb0", ranger, "#141421"),
    ("Bulwark", "#c9a86a", bulwark, "#141421"),
    ("Streaker", "#ffe66d", streaker, "#141421"),
    ("Gambler", "#d59bff", gambler, "#141421"),
    ("Pyro", "#ff6b6b", pyro, "#141421"),
    ("Leech", "#9be7d8", leech, "#b0102a"),
]


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------
def build():
    common.use_collection("Characters")
    roots = []
    for i, (name, color, fn, pupil) in enumerate(CAST):
        r = common.root(name, (0, (i - (len(CAST) - 1) / 2) * SPACING, 0), character_id=i)
        potato_body(name, color, r, seed=i + 1)
        eyes(name, r, pupil)
        fn(name, r)
        roots.append(r)
    return roots


def export(roots):
    return common.export_glb("characters.glb", roots)


if globals().get("RUN", True):
    ROOTS = build()
