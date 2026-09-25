"""
The arena around the fight: walls, corner pillars, banners, props, and a
Blender-rendered flagstone floor.

Outputs:
  assets/arena.glb          walls, pillars, braziers, banners and props
  assets/floor.jpg          floor colour, rendered top-down from a shader
  assets/floor_bump.jpg     matching height map (mortar low, stone high)

Scale: one Blender unit = 10 game units. The playable floor spans Blender
x 0..160, y 0..-90 (game x 0..1600, z 0..900); the game scales the model by
10. Everything is built outside the play area or hugging the walls, so the
simulation's collision (a plain rectangle) still matches what you see.

Materials are flat colours; the game merges the whole model into one lit
draw call plus one unlit draw call for parts named "_glow".
"""

import importlib
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common  # noqa: E402
importlib.reload(common)
from common import box, cone, hex_rgb, mat, prism, rod, root, sphere, torus  # noqa: E402,F401

W, H = 160.0, 90.0          # arena in Blender units
WALL_T, WALL_H = 2.6, 4.2
STONE = ["#2b3046", "#31374f", "#272b3f", "#353b55", "#2e3349"]


def stone(i):
    return mat(f"a_stone{i}", STONE[i % len(STONE)], rough=0.9)


# --------------------------------------------------------------------------
# Walls
# --------------------------------------------------------------------------
def wall_run(p, rng, name, a, b, inward, courses=(1.5, 1.4, 1.3)):
    """Stone blocks from a to b (2D points, the wall's inner edge) stacked in courses.

    inward is the unit vector pointing into the arena; the wall extends the
    other way by WALL_T.
    """
    a, b = Vector((*a, 0)), Vector((*b, 0))
    along = (b - a).normalized()
    length = (b - a).length
    out = -Vector((*inward, 0))
    z = 0.0
    for ci, ch in enumerate(courses):
        t = -rng.uniform(0.0, 2.0) if ci % 2 else 0.0
        while t < length:
            bl = rng.uniform(2.6, 5.0)
            t0, t1 = max(0.0, t), min(length, t + bl)
            if t1 - t0 > 0.3:
                mid = a + along * ((t0 + t1) / 2) + out * (WALL_T / 2 - rng.uniform(-0.06, 0.1))
                ext = along * ((t1 - t0) / 2 - 0.05)
                sx = abs(ext.x) + abs(out.x) * (WALL_T / 2)
                sy = abs(ext.y) + abs(out.y) * (WALL_T / 2)
                box(f"{name}_b{ci}_{int(t * 10)}", stone(rng.randrange(5)), p,
                    (mid.x, mid.y, z + ch / 2), (sx, sy, ch / 2 - 0.04), bevel=0)
            t += bl
        z += ch
    # cap slab with a small overhang on the arena side
    cap = mat("a_cap", "#3a4160", rough=0.85)
    mid = (a + b) / 2 + out * (WALL_T / 2) - out * 0.15
    sx = abs(along.x) * (length / 2 + 0.2) + abs(out.x) * (WALL_T / 2 + 0.2)
    sy = abs(along.y) * (length / 2 + 0.2) + abs(out.y) * (WALL_T / 2 + 0.2)
    box(name + "_cap", cap, p, (mid.x, mid.y, z + 0.25), (sx, sy, 0.25), bevel=0)
    # merlons along the outer half of the cap
    n = int(length // 8)
    for i in range(n):
        c = a + along * ((i + 0.5) * length / n) + out * (WALL_T * 0.7)
        ex, ey = abs(along.x) * 1.5 + abs(out.x) * 0.8, abs(along.y) * 1.5 + abs(out.y) * 0.8
        box(f"{name}_merlon{i}", stone(i + 2), p, (c.x, c.y, z + 0.5 + 0.7), (ex, ey, 0.7), bevel=0)


def walls(p, rng):
    wall_run(p, rng, "north", (-WALL_T, 0), (W + WALL_T, 0), (0, -1))
    wall_run(p, rng, "south", (-WALL_T, -H), (W + WALL_T, -H), (0, 1))
    wall_run(p, rng, "west", (0, 0), (0, -H), (1, 0))
    wall_run(p, rng, "east", (W, 0), (W, -H), (-1, 0))


# --------------------------------------------------------------------------
# Corner pillars with brazier bowls (the flame itself is animated in game)
# --------------------------------------------------------------------------
PILLARS = [(4.3, -4.3), (W - 4.3, -4.3), (4.3, -H + 4.3), (W - 4.3, -H + 4.3)]


def pillars(p):
    base = mat("a_pillarBase", "#2a2f44", rough=0.9)
    shaft = mat("a_pillar", "#343a55", rough=0.8)
    trim = mat("a_pillarTrim", "#454c6c", rough=0.7)
    iron = mat("a_iron", "#2a2230", rough=0.45, metal=0.7)
    coal = mat("a_coal_glow", "#ff7a2e", rough=0.6, emit=3.0)
    for i, (x, y) in enumerate(PILLARS):
        box(f"pillar{i}_base", base, p, (x, y, 0.4), (2.6, 2.6, 0.4), bevel=0.1)
        box(f"pillar{i}_shaft", shaft, p, (x, y, 3.9), (2.2, 2.2, 3.1), bevel=0.04)
        for k, z in enumerate((1.4, 5.2)):
            box(f"pillar{i}_band{k}", trim, p, (x, y, z), (2.3, 2.3, 0.15), bevel=0.2)
        box(f"pillar{i}_cap", trim, p, (x, y, 7.2), (2.5, 2.5, 0.2), bevel=0.2)
        cone(f"pillar{i}_bowl", iron, p, (x, y, 7.85), 0.8, 1.45, 1.1, segs=16)
        torus(f"pillar{i}_rim", iron, p, (x, y, 8.4), 1.45, 0.1, segs=(20, 6))
        sphere(f"pillar{i}_coals_glow", coal, p, (x, y, 8.25), (1.25, 1.25, 0.3), segs=(14, 6))


# --------------------------------------------------------------------------
# Wall dressing: banners and sconces on the north wall, which faces the camera
# --------------------------------------------------------------------------
def banners(p):
    red = mat("a_bannerRed", "#7a1f2b", rough=0.9)
    purple = mat("a_bannerPurple", "#3d2a6b", rough=0.9)
    gold = mat("a_gold", "#d9a441", rough=0.35, metal=0.9)
    potato = mat("a_potato", "#c9a86a", rough=0.8)
    wood = mat("a_wood", "#5a3a1e", rough=0.8)
    for i, x in enumerate((20, 50, 80, 110, 140)):
        big = x == 80
        w, top, bot = (2.2 if big else 1.6), 4.0, (0.9 if big else 1.5)
        cloth = red if i % 2 == 0 else purple
        rod(f"banner{i}_pole", wood, p, (x - w - 0.3, -0.25, top + 0.1), (x + w + 0.3, -0.25, top + 0.1), 0.09)
        # cloth: a thin slab with a notched bottom, lying in the XZ plane facing -Y
        outline = [(-w, top), (w, top), (w, bot + 0.6), (0, bot), (-w, bot + 0.6)]
        prism(f"banner{i}_cloth", cloth, p, (x, -0.18, 0), [(ox, oz) for ox, oz in outline], 0.08,
              rot=(90, 0, 0))
        prism(f"banner{i}_trim", gold, p, (x, -0.24, 0),
              [(-w, top - 0.2), (w, top - 0.2), (w, top - 0.35), (-w, top - 0.35)], 0.04, rot=(90, 0, 0))
        cy = (top + bot) / 2 + 0.3
        if big:
            sphere(f"banner{i}_emblem", potato, p, (x, -0.28, cy), (0.9, 0.08, 1.05), segs=(16, 10))
            for s in (1, -1):
                sphere(f"banner{i}_emblemEye{s}", mat("a_ink", "#141421"), p, (x + 0.3 * s, -0.36, cy + 0.3),
                       (0.12, 0.04, 0.14), segs=(8, 6))
        else:
            prism(f"banner{i}_emblem", gold, p, (x, -0.26, 0),
                  [(0, cy + 0.55), (0.4, cy), (0, cy - 0.55), (-0.4, cy)], 0.04, rot=(90, 0, 0))
    iron = mat("a_iron", "#2a2230", rough=0.45, metal=0.7)
    fire = mat("a_sconce_glow", "#ffb060", rough=0.6, emit=3.0)
    for i, x in enumerate((35, 65, 95, 125)):
        box(f"sconce{i}_plate", iron, p, (x, -0.1, 2.9), (0.3, 0.1, 0.45), bevel=0.2)
        rod(f"sconce{i}_arm", iron, p, (x, -0.1, 2.8), (x, -0.7, 3.1), 0.07)
        cone(f"sconce{i}_cup", iron, p, (x, -0.75, 3.2), 0.15, 0.3, 0.3, segs=10)
        sphere(f"sconce{i}_flame_glow", fire, p, (x, -0.75, 3.55), (0.22, 0.22, 0.4), segs=(10, 8))


# --------------------------------------------------------------------------
# Props hugging the walls: rubble, bones, skulls, broken columns, pots
# --------------------------------------------------------------------------
def lumpy(name, material, parent, loc, scale, seed, amp=0.25):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    off = Vector((seed * 3.1, seed * 7.7, seed * 1.3))
    for v in bm.verts:
        d = v.co.normalized()
        v.co = d * (1.0 + noise.noise(d * 1.5 + off) * amp)
    return common.mesh_object(name, bm, material, parent, loc, (0, 0, seed * 37 % 360), scale, smooth=False)


def edge_spot(rng, margin=1.4):
    """A random point hugging one of the four walls, away from the corner pillars."""
    side = rng.randrange(4)
    if side < 2:
        x, y = rng.uniform(9, W - 9), (-margin if side == 0 else -H + margin)
    else:
        x, y = (margin if side == 2 else W - margin), -rng.uniform(9, H - 9)
    return x + rng.uniform(-0.3, 0.3), y + rng.uniform(-0.3, 0.3)


def props(p, rng):
    rock = [mat(f"a_rock{i}", c, rough=0.95) for i, c in enumerate(("#3b3f52", "#474b5e", "#2f3344"))]
    bone = mat("a_bone", "#cfc6b0", rough=0.7)
    dark = mat("a_hole", "#15161c", rough=0.9)
    clay = mat("a_clay", "#7a4a33", rough=0.85)
    col = mat("a_column", "#4a5070", rough=0.8)
    for i in range(34):   # rubble piles
        x, y = edge_spot(rng)
        for k in range(rng.randint(1, 3)):
            s = rng.uniform(0.35, 0.8)
            lumpy(f"rock{i}_{k}", rock[rng.randrange(3)], p,
                  (x + rng.uniform(-0.7, 0.7), y + rng.uniform(-0.5, 0.5), s * 0.45), (s, s * 0.9, s * 0.6), i * 5 + k)
    for i in range(10):   # bones
        x, y = edge_spot(rng, 2.2)
        a = rng.uniform(0, math.tau)
        d = Vector((math.cos(a), math.sin(a), 0)) * 0.55
        rod(f"bone{i}", bone, p, (x - d.x, y - d.y, 0.1), (x + d.x, y + d.y, 0.1), 0.06)
        for s in (1, -1):
            sphere(f"bone{i}_knob{s}", bone, p, (x + d.x * s, y + d.y * s, 0.1), 0.11, segs=(8, 6))
    for i in range(5):    # skulls
        x, y = edge_spot(rng, 1.8)
        sphere(f"skull{i}", bone, p, (x, y, 0.3), (0.34, 0.3, 0.3), segs=(12, 8))
        sphere(f"skull{i}_jaw", bone, p, (x + 0.12, y, 0.12), (0.22, 0.2, 0.1), segs=(10, 6))
        for s in (1, -1):
            sphere(f"skull{i}_eye{s}", dark, p, (x + 0.27, y + 0.12 * s, 0.34), 0.07, segs=(8, 6))
    for i in range(6):    # broken column stumps along the long walls
        x, y = edge_spot(rng, 1.6)
        h = rng.uniform(0.6, 1.6)
        cone(f"stump{i}", col, p, (x, y, h / 2), 0.55, 0.5, h, segs=10, smooth=False)
        lumpy(f"stump{i}_chunk", col, p, (x + 0.9, y + 0.2, 0.2), (0.4, 0.3, 0.25), i + 50)
    for i in range(6):    # clay pots, some broken
        x, y = edge_spot(rng, 1.5)
        sphere(f"pot{i}", clay, p, (x, y, 0.4), (0.4, 0.4, 0.42), segs=(12, 8))
        cone(f"pot{i}_neck", clay, p, (x, y, 0.82), 0.22, 0.28, 0.16, segs=12)


# --------------------------------------------------------------------------
# Floor texture: render a flagstone shader straight down, emission only, so
# the image is pure albedo and the game's own lights do the shading
# --------------------------------------------------------------------------
def _node(t, kind, **inputs):
    n = t.nodes.new(kind)
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def floor_material(bump=False):
    name = "a_floorBake_bump" if bump else "a_floorBake"
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    t.nodes.clear()
    L = t.links.new
    tc = t.nodes.new("ShaderNodeTexCoord")
    # warp the lookup a little so the joints are not ruler-straight
    warp = _node(t, "ShaderNodeTexNoise", Scale=0.35, Detail=2.0)
    L(tc.outputs["Object"], warp.inputs["Vector"])
    wmix = t.nodes.new("ShaderNodeVectorMath"); wmix.operation = "MULTIPLY_ADD"
    wmix.inputs[1].default_value = (0.35, 0.35, 0.0)
    L(warp.outputs["Color"], wmix.inputs[0]); L(tc.outputs["Object"], wmix.inputs[2])

    brick = t.nodes.new("ShaderNodeTexBrick")
    brick.offset, brick.offset_frequency = 0.5, 2
    for k, v in {"Scale": 1.0, "Brick Width": 8.0, "Row Height": 8.0, "Mortar Size": 0.16,
                 "Mortar Smooth": 0.25, "Bias": 0.0}.items():
        brick.inputs[k].default_value = v
    brick.inputs["Color1"].default_value = (*hex_rgb("#414a62"), 1)
    brick.inputs["Color2"].default_value = (*hex_rgb("#2a3044"), 1)
    brick.inputs["Mortar"].default_value = (*hex_rgb("#0e1017"), 1)
    L(wmix.outputs[0], brick.inputs["Vector"])

    grime = _node(t, "ShaderNodeTexNoise", Scale=0.09, Detail=8.0, Roughness=0.62)
    L(tc.outputs["Object"], grime.inputs["Vector"])
    fine = _node(t, "ShaderNodeTexNoise", Scale=1.6, Detail=6.0, Roughness=0.7)
    L(tc.outputs["Object"], fine.inputs["Vector"])
    cracks = t.nodes.new("ShaderNodeTexVoronoi"); cracks.feature = "DISTANCE_TO_EDGE"
    cracks.inputs["Scale"].default_value = 0.22
    L(wmix.outputs[0], cracks.inputs["Vector"])
    crack_mask = t.nodes.new("ShaderNodeMapRange")          # 1 on a crack line, 0 elsewhere
    crack_mask.inputs["From Min"].default_value = 0.0
    crack_mask.inputs["From Max"].default_value = 0.035
    crack_mask.inputs["To Min"].default_value = 1.0
    crack_mask.inputs["To Max"].default_value = 0.0
    L(cracks.outputs["Distance"], crack_mask.inputs["Value"])
    crack_where = t.nodes.new("ShaderNodeMapRange")         # only some regions crack
    crack_where.inputs["From Min"].default_value = 0.6
    crack_where.inputs["From Max"].default_value = 0.67
    L(grime.outputs["Factor"], crack_where.inputs["Value"])
    crack = t.nodes.new("ShaderNodeMath"); crack.operation = "MULTIPLY"
    L(crack_mask.outputs["Result"], crack.inputs[0]); L(crack_where.outputs["Result"], crack.inputs[1])

    # radial falloff: brighter centre, darker edges, like the old baked floor
    loc = t.nodes.new("ShaderNodeVectorMath"); loc.operation = "ADD"
    loc.inputs[1].default_value = (-W / 2, H / 2, 0)
    L(tc.outputs["Object"], loc.inputs[0])
    sc = t.nodes.new("ShaderNodeVectorMath"); sc.operation = "MULTIPLY"
    sc.inputs[1].default_value = (1 / (W / 2), 1 / (H / 2), 0)
    L(loc.outputs[0], sc.inputs[0])
    dist = t.nodes.new("ShaderNodeVectorMath"); dist.operation = "LENGTH"
    L(sc.outputs[0], dist.inputs[0])
    vign = t.nodes.new("ShaderNodeMapRange")
    vign.inputs["From Min"].default_value = 0.2
    vign.inputs["From Max"].default_value = 1.35
    vign.inputs["To Min"].default_value = 1.18
    vign.inputs["To Max"].default_value = 0.55
    L(dist.outputs["Value"], vign.inputs["Value"])

    out = t.nodes.new("ShaderNodeOutputMaterial")
    emit = t.nodes.new("ShaderNodeEmission")
    L(emit.outputs[0], out.inputs["Surface"])
    if bump:
        # height: stone 1, mortar 0, a little surface noise, cracks cut in
        h = t.nodes.new("ShaderNodeMath"); h.operation = "SUBTRACT"
        h.inputs[0].default_value = 1.0
        L(brick.outputs["Factor"], h.inputs[1])
        hn = t.nodes.new("ShaderNodeMath"); hn.operation = "MULTIPLY_ADD"
        hn.inputs[1].default_value = 0.25
        L(fine.outputs["Factor"], hn.inputs[0]); L(h.outputs[0], hn.inputs[2])
        hc = t.nodes.new("ShaderNodeMath"); hc.operation = "MULTIPLY_ADD"
        hc.inputs[1].default_value = -0.6
        L(crack.outputs[0], hc.inputs[0]); L(hn.outputs[0], hc.inputs[2])
        hs = t.nodes.new("ShaderNodeMath"); hs.operation = "MULTIPLY"
        hs.inputs[1].default_value = 0.8
        L(hc.outputs[0], hs.inputs[0])
        L(hs.outputs[0], emit.inputs["Color"])
        return m
    # colour: brick colour x grime x fine speckle x vignette, cracks darkened
    g = t.nodes.new("ShaderNodeMapRange")
    g.inputs["From Min"].default_value = 0.3
    g.inputs["From Max"].default_value = 0.7
    g.inputs["To Min"].default_value = 0.7
    g.inputs["To Max"].default_value = 1.12
    L(grime.outputs["Factor"], g.inputs["Value"])
    f = t.nodes.new("ShaderNodeMapRange")
    f.inputs["To Min"].default_value = 0.85
    f.inputs["To Max"].default_value = 1.12
    L(fine.outputs["Factor"], f.inputs["Value"])
    k1 = t.nodes.new("ShaderNodeMath"); k1.operation = "MULTIPLY"
    L(g.outputs["Result"], k1.inputs[0]); L(f.outputs["Result"], k1.inputs[1])
    k2 = t.nodes.new("ShaderNodeMath"); k2.operation = "MULTIPLY"
    L(k1.outputs[0], k2.inputs[0]); L(vign.outputs["Result"], k2.inputs[1])
    kc = t.nodes.new("ShaderNodeMath"); kc.operation = "MULTIPLY_ADD"   # 1 - 0.75 * crack
    kc.inputs[1].default_value = -0.55
    kc.inputs[2].default_value = 1.0
    L(crack.outputs[0], kc.inputs[0])
    k3 = t.nodes.new("ShaderNodeMath"); k3.operation = "MULTIPLY"
    L(k2.outputs[0], k3.inputs[0]); L(kc.outputs[0], k3.inputs[1])
    col = t.nodes.new("ShaderNodeVectorMath"); col.operation = "SCALE"
    L(brick.outputs["Color"], col.inputs[0]); L(k3.outputs[0], col.inputs["Scale"])
    L(col.outputs[0], emit.inputs["Color"])
    return m


def bake_floor(size=(2048, 1152)):
    """Render floor.jpg and floor_bump.jpg from a throwaway scene."""
    scn = bpy.data.scenes.get("FloorBake") or bpy.data.scenes.new("FloorBake")
    for ob in list(scn.collection.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    me = bpy.data.meshes.new("FloorBake")
    bm.to_mesh(me); bm.free()
    # the shader reads object coords, so the mesh itself spans arena coords x 0..W, y 0..-H
    for v in me.vertices:
        v.co.x = (v.co.x + 0.5) * W
        v.co.y = (v.co.y - 0.5) * H
    plane = bpy.data.objects.new("FloorBake", me)
    scn.collection.objects.link(plane)
    cam = bpy.data.objects.get("FloorBakeCam") or bpy.data.objects.new("FloorBakeCam", bpy.data.cameras.new("FloorBakeCam"))
    if cam.name not in scn.collection.objects:
        scn.collection.objects.link(cam)
    cam.data.type = "ORTHO"; cam.data.ortho_scale = W
    cam.location = (W / 2, -H / 2, 50); cam.rotation_euler = (0, 0, 0)
    scn.camera = cam
    r = scn.render
    r.resolution_x, r.resolution_y, r.resolution_percentage = size[0], size[1], 100
    try:
        r.engine = "BLENDER_EEVEE"
    except TypeError:
        pass
    try:
        scn.view_settings.view_transform = "Standard"
    except TypeError:
        pass
    scn.world = bpy.data.worlds.get("FloorBakeWorld") or bpy.data.worlds.new("FloorBakeWorld")
    r.image_settings.file_format = "JPEG"
    r.image_settings.quality = 90
    outs = []
    for bump, fname in ((False, "floor.jpg"), (True, "floor_bump.jpg")):
        me.materials.clear()
        me.materials.append(floor_material(bump))
        r.filepath = os.path.join(common.ASSETS, fname)
        bpy.ops.render.render(write_still=True, scene=scn.name)
        outs.append((r.filepath, os.path.getsize(r.filepath)))
    return outs


# --------------------------------------------------------------------------
def build(seed=7):
    common.use_collection("Arena")
    rng = random.Random(seed)
    r = root("Arena", (0, 0, 0))
    walls(r, rng)
    pillars(r)
    banners(r)
    props(r, rng)
    common.join_children(r, "arena", keep=lambda ob: "_glow" in ob.name)
    return [r]


def export(roots):
    return common.export_glb("arena.glb", roots, at_origin=False)


if globals().get("RUN", True):
    ROOTS = build()
