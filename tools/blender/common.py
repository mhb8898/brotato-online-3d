"""
Shared helpers for the asset scripts in tools/blender/.

Everything is built with bmesh and the data API rather than bpy.ops, so a
script behaves the same from the Text Editor, over the MCP bridge, or in
`blender --background --python`.

Game conventions every script follows:
  - forward is +X and up is +Z in Blender; the glTF exporter turns Z-up into
    Three's Y-up, so +X stays forward and Blender -Y becomes Three +Z
  - materials only carry flat values (base colour, roughness, metallic,
    emission). render3d.js bakes those into vertex colours and merges each
    model into a handful of draw calls, so textures would be thrown away
"""

import contextlib
import io
import math
import os

import bmesh
import bpy
from mathutils import Vector

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ASSETS = os.path.join(REPO, "assets")

COLL = None   # collection new objects are linked into; set by use_collection()


# --------------------------------------------------------------------------
# Collections
# --------------------------------------------------------------------------
def use_collection(name):
    """Empty (or create) a top-level collection and make it the build target."""
    global COLL
    coll = bpy.data.collections.get(name)
    if coll:
        for ob in list(coll.all_objects):
            data = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if isinstance(data, bpy.types.Mesh) and data.users == 0:
                bpy.data.meshes.remove(data)
    else:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    COLL = coll
    return coll


def root(name, loc=(0, 0, 0), **props):
    """An empty that one exported model hangs off."""
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "PLAIN_AXES"
    ob.empty_display_size = 0.4
    for k, v in props.items():
        ob[k] = v
    COLL.objects.link(ob)
    ob.location = loc
    return ob


def marker(name, parent, loc):
    """An empty the game reads back by name, e.g. a muzzle point."""
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "SPHERE"
    ob.empty_display_size = 0.06
    COLL.objects.link(ob)
    ob.parent = parent
    ob.location = loc
    return ob


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------
def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def shade(color, k):
    h = color.lstrip("#")
    return "#" + "".join(f"{max(0, min(255, int(int(h[i:i + 2], 16) * k))):02x}" for i in (0, 2, 4))


def mat(name, color, rough=0.6, metal=0.0, emit=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    rgb = hex_rgb(color)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Emission Strength"].default_value = emit
    m.diffuse_color = (*rgb, 1.0)
    return m


# --------------------------------------------------------------------------
# Primitives
# --------------------------------------------------------------------------
def mesh_object(name, bm, material, parent, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    COLL.objects.link(ob)
    ob.parent = parent
    ob.location = loc
    ob.rotation_euler = [math.radians(a) for a in rot]
    ob.scale = scale if hasattr(scale, "__len__") else (scale, scale, scale)
    return ob


def sphere(name, material, parent, loc, scale=1.0, rot=(0, 0, 0), segs=(20, 12), cut_below=None, smooth=True):
    """UV sphere; cut_below drops the vertices under that local z (a dome)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs[0], v_segments=segs[1], radius=1.0)
    if cut_below is not None:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut_below - 1e-4], context="VERTS")
    return mesh_object(name, bm, material, parent, loc, rot, scale, smooth)


def ico(name, material, parent, loc, scale=1.0, rot=(0, 0, 0), subdiv=1, smooth=False):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    return mesh_object(name, bm, material, parent, loc, rot, scale, smooth)


def cone(name, material, parent, loc, r1, r2, depth, rot=(0, 0, 0), scale=1.0, segs=16, smooth=True, caps=True):
    """Cylinder/cone along local Z, centred on loc."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs,
                          radius1=r1, radius2=r2, depth=depth)
    return mesh_object(name, bm, material, parent, loc, rot, scale, smooth)


def rod(name, material, parent, a, b, r1, r2=None, segs=12, smooth=True):
    """Cylinder from point a to point b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    rot = [math.degrees(x) for x in q.to_euler()]
    return cone(name, material, parent, (a + b) / 2, r1, r1 if r2 is None else r2, d.length,
                rot=rot, segs=segs, smooth=smooth)


def box(name, material, parent, loc, scale, rot=(0, 0, 0), bevel=0.25):
    """Box with half-extents `scale`; bevel is relative to the unit cube."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2,
                        profile=0.5, affect="EDGES", clamp_overlap=True)
    return mesh_object(name, bm, material, parent, loc, rot, scale, bevel > 0)


def torus(name, material, parent, loc, major, minor, rot=(0, 0, 0), scale=1.0, segs=(28, 8), arc=360.0):
    bm = bmesh.new()
    n_maj, n_min = segs
    full = arc >= 360.0
    rings = n_maj if full else n_maj + 1
    grid = []
    for i in range(rings):
        a = math.radians(arc) * i / n_maj
        centre = Vector((math.cos(a) * major, math.sin(a) * major, 0.0))
        out = Vector((math.cos(a), math.sin(a), 0.0))
        grid.append([bm.verts.new(centre + out * math.cos(b) * minor + Vector((0, 0, math.sin(b) * minor)))
                     for b in (2 * math.pi * j / n_min for j in range(n_min))])
    for i in range(n_maj if full else rings - 1):
        r0, r1 = grid[i], grid[(i + 1) % rings]
        for j in range(n_min):
            bm.faces.new((r0[j], r1[j], r1[(j + 1) % n_min], r0[(j + 1) % n_min]))
    if not full:
        bm.faces.new(grid[0][::-1])
        bm.faces.new(grid[-1])
    return mesh_object(name, bm, material, parent, loc, rot, scale, True)


def prism(name, material, parent, loc, outline, depth, rot=(0, 0, 0), scale=1.0, smooth=False):
    """Extrude a 2D outline [(x, y), ...] (counter-clockwise) along Z by depth."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, -depth / 2)) for x, y in outline]
    hi = [bm.verts.new((x, y, depth / 2)) for x, y in outline]
    bm.faces.new(lo[::-1])
    bm.faces.new(hi)
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_object(name, bm, material, parent, loc, rot, scale, smooth)


def star_outline(points, r_out, r_in, phase=0.0):
    out = []
    for i in range(points * 2):
        a = phase + math.pi * i / points
        r = r_out if i % 2 == 0 else r_in
        out.append((math.cos(a) * r, math.sin(a) * r))
    return out


def face_rot(x, y, z):
    """Euler (degrees) turning local +Z to point along (x, y, z)."""
    q = Vector((0, 0, 1)).rotation_difference(Vector((x, y, z)).normalized())
    return [math.degrees(a) for a in q.to_euler()]


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------
def export_glb(filename, roots, coll=None, at_origin=True):
    """Export everything under `roots` to assets/<filename>.

    Roots are moved to the origin for the export (they are laid out side by
    side in the scene only so they can be looked at) and put back afterwards.
    """
    coll = coll or COLL
    path = os.path.join(ASSETS, filename)
    os.makedirs(ASSETS, exist_ok=True)
    saved = [r.location.copy() for r in roots]
    if at_origin:
        for r in roots:
            r.location = (0, 0, 0)
    for ob in bpy.context.view_layer.objects:
        ob.select_set(False)
    for ob in coll.all_objects:
        ob.select_set(True)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                                      export_apply=True, export_yup=True)
    finally:
        for r, loc in zip(roots, saved):
            r.location = loc
    return path, os.path.getsize(path)


def join_children(parent, name, keep=lambda ob: False):
    """Merge every mesh under `parent` into one mesh object `name`, one material slot per material.

    Objects for which keep(ob) is true are merged into a second object
    "<name>_glow" instead (used to keep emissive parts separable by name).
    Transforms are baked relative to `parent`, and the originals are removed.
    """
    groups = {False: [], True: []}
    for ob in parent.children_recursive:
        if ob.type == "MESH":
            groups[bool(keep(ob))].append(ob)
    inv = parent.matrix_world.inverted()
    made = []
    for glowing, obs in groups.items():
        if not obs:
            continue
        bm = bmesh.new()
        mats = []
        for ob in obs:
            n0 = len(bm.faces)
            v0 = len(bm.verts)
            bm.from_mesh(ob.data)
            bm.verts.ensure_lookup_table()
            bm.faces.ensure_lookup_table()
            bmesh.ops.transform(bm, matrix=inv @ ob.matrix_world, verts=bm.verts[v0:])
            src = list(ob.data.materials)
            for f in bm.faces[n0:]:
                m = src[f.material_index] if f.material_index < len(src) else src[0]
                if m not in mats:
                    mats.append(m)
                f.material_index = mats.index(m)
        me = bpy.data.meshes.new(name + ("_glow" if glowing else ""))
        bm.to_mesh(me)
        bm.free()
        for m in mats:
            me.materials.append(m)
        out = bpy.data.objects.new(me.name, me)
        COLL.objects.link(out)
        out.parent = parent
        made.append(out)
        for ob in obs:
            data = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if data.users == 0:
                bpy.data.meshes.remove(data)
    return made
