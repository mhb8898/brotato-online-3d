// Loads the Blender-made models in assets/ and flattens them into merged,
// vertex-coloured geometries the renderer can draw in a few calls each.
//
// Every .glb here is produced by a script in tools/blender/ (see the
// docstrings there for the naming conventions this file relies on). Blender
// materials are flat colours, so a model made of forty parts collapses into
// one geometry per *kind* of surface - matte, metal, glowing, unlit face - with
// each part's colour baked into a vertex colour.
//
// Nothing here is required: render3d.js draws its procedural shapes until
// loadAssets() resolves, and keeps them if it rejects (file:// pages, a
// missing file, an old browser). The game never waits on art.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BASE = new URL('../assets/', import.meta.url);

/**
 * Merge the meshes under `root` into one geometry per group.
 *
 * `classify(mesh)` returns a group name, or null to skip the mesh. Geometry is
 * baked into `root`'s space (optionally through `space`, a node under root),
 * reduced to position + normal, and given a `color` attribute from the part's
 * material colour. Returns { group: BufferGeometry }.
 */
export function bake(root, classify, space = root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(space.matrixWorld).invert();
  const lists = {};
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const g0 = o.geometry;
    // multi-material meshes arrive as one geometry with groups; split them
    const pieces = g0.groups.length > 1
      ? g0.groups.map((gr) => ({ geo: subGeometry(g0, gr), mat: mats[gr.materialIndex] || mats[0] }))
      : [{ geo: g0.clone(), mat: mats[0] }];
    m.multiplyMatrices(inv, o.matrixWorld);
    for (const { geo, mat } of pieces) {
      const group = classify(o, mat);
      if (!group) { geo.dispose(); continue; }
      // mergeGeometries wants every input indexed (or none); glTF usually is
      const g = geo;
      if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      g.applyMatrix4(m);
      c.copy(mat.color);
      if (group === 'glow' && mat.emissive) c.lerp(mat.emissive, 0.5);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      (lists[group] ||= []).push(g);
    }
  });
  const out = {};
  for (const [k, list] of Object.entries(lists)) {
    out[k] = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    out[k].computeBoundingSphere();
  }
  return out;
}

function subGeometry(geo, group) {
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a.clone());
  const idx = geo.index.array.slice(group.start, group.start + group.count);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/** Surface kind of a model part, from its name and material. */
function surface(mesh, mat) {
  const n = mesh.name;
  if (/_eye|_pupil/.test(n)) return 'face';
  if (/_glow/.test(n) || (mat.emissive && mat.emissive.getHSL({}).l > 0.02 && mat.emissiveIntensity > 0)) return 'glow';
  if (mat.metalness > 0.5) return 'metal';
  return 'matte';
}

// ------------------------------------------------------------------ loaders
function loadGlb(loader, file) {
  return new Promise((res, rej) => loader.load(new URL(file, BASE).href, (g) => res(g.scene), undefined, rej));
}

function loadTex(file, srgb) {
  return new Promise((res, rej) => new THREE.TextureLoader().load(new URL(file, BASE).href, (t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    res(t);
  }, undefined, rej));
}

const byName = (scene, name) => scene.getObjectByName(name);

/**
 * Fetch and bake everything. Resolves to:
 *   characters[name] = { skin, matte, metal, glow, face }       (geometries)
 *   weapons[id]      = { parts: {matte,metal,glow}, spin, spinAt, muzzle }
 *   projectiles[kind]= geometry;  fx[name] = geometry
 *   enemies[name]    = { body, face }
 *   arena            = { stone, glow }
 *   floor, floorBump, sprites                                    (textures)
 * Each file is optional; a missing one just leaves its key out.
 */
export async function loadAssets() {
  const loader = new GLTFLoader();
  const soft = (p) => p.catch((e) => { console.warn('[assets]', e?.message || e); return null; });
  const [chars, weps, projs, foes, arena, floor, floorBump, sprites] = await Promise.all([
    soft(loadGlb(loader, 'characters.glb')),
    soft(loadGlb(loader, 'weapons.glb')),
    soft(loadGlb(loader, 'projectiles.glb')),
    soft(loadGlb(loader, 'enemies.glb')),
    soft(loadGlb(loader, 'arena.glb')),
    soft(loadTex('floor.jpg', true)),
    soft(loadTex('floor_bump.jpg', false)),
    soft(loadTex('fx_sprites.png', true)),
  ]);
  const out = { characters: {}, weapons: {}, projectiles: {}, fx: {}, enemies: {}, floor, floorBump, sprites };

  if (chars) {
    for (const root of chars.children) {
      out.characters[root.name] = bake(root, (o, mat) => (/_body|_butt/.test(o.name) ? 'skin' : surface(o, mat)));
    }
  }
  if (weps) {
    for (const root of weps.children) {
      const id = root.name;
      const spinNode = byName(root, `${id}_spin`);
      const inSpin = (o) => { for (let p = o; p && p !== root; p = p.parent) if (p === spinNode) return true; return false; };
      const w = { parts: bake(root, (o, mat) => (inSpin(o) ? null : surface(o, mat))) };
      if (spinNode) {
        const sp = bake(root, (o) => (inSpin(o) ? 'spin' : null), spinNode);
        w.spin = sp.spin;
        w.spinAt = spinNode.getWorldPosition(new THREE.Vector3()).sub(root.getWorldPosition(new THREE.Vector3()));
      }
      const mz = byName(root, `${id}_muzzle`);
      w.muzzle = mz ? mz.getWorldPosition(new THREE.Vector3()).sub(root.getWorldPosition(new THREE.Vector3()))
        : new THREE.Vector3(1.2, 0, 0);
      out.weapons[id] = w;
    }
  }
  if (projs) {
    for (const root of projs.children) {
      const g = bake(root, () => 'all').all;
      if (!g) continue;
      if (root.name.startsWith('fx_')) out.fx[root.name.slice(3)] = g;
      else out.projectiles[root.name] = g;
    }
  }
  if (foes) {
    for (const root of foes.children) {
      out.enemies[root.name] = bake(root, (o) => (/_face/.test(o.name) ? 'face' : 'body'));
    }
  }
  if (arena) {
    const root = arena.children[0] || arena;
    const a = bake(root, (o) => (/_glow/.test(o.name) ? 'glow' : 'stone'));
    out.arena = a;
  }
  return out;
}
