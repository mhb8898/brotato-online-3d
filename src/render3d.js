// Three.js renderer for Potato Royale.
//
// The simulation, networking and HUD all still speak in 2D world units
// (ARENA.w x ARENA.h, y pointing "down" the screen). This module maps that
// plane onto the XZ ground of a 3D scene (world x -> X, world y -> Z, height
// -> Y) and draws it with a pitched perspective camera that follows the local
// player. Nothing outside this file knows the game is 3D.
//
// Two canvases are used: the WebGL canvas passed in (#game), and an overlay
// 2D canvas created here for text and bars (names, health, damage numbers,
// vignette). Text is far cheaper and crisper in 2D than as textured quads,
// and the overlay never receives pointer events so input keeps working.
//
// Public surface (must stay compatible with main.js):
//   new Renderer(canvas)      draw(view, info, dt)      spawnFx(list)
//   toWorld(screenX, screenY) -> { x, y } in world units (mouse aiming)
//   .shake  .flash  .parts  .floats

import * as THREE from 'three';
import { ARENA, CHARACTERS, ENEMIES, WEAPONS, TIER_COLOR } from './data.js';
import { FX, PROJ_KINDS } from './protocol.js';

const TAU = Math.PI * 2;
const PLAYER_R = 14;
const MAX_PARTS = 420;
const MAX_FLOATS = 80;
const MAX_PROJ_INST = 300;
const MAX_ENEMY_INST = 220;   // per enemy type
const MAX_MAT_INST = 200;     // material gems on the floor
const MIN_DPR = 1;
const OUTLINE_LIMIT = 34;
const WALL_H = 42;
const WALL_T = 26;

// --------------------------------------------------------------- helpers
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hex2rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shade(hex, k) {
  const [r, g, b] = hex2rgb(hex);
  const t = k < 0 ? 0 : 255;
  const m = Math.abs(k);
  const f = (c) => Math.round(c + (t - c) * m);
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
const damp = (dt, k) => 1 - Math.exp(-dt * k);

/**
 * Merge several coloured copies of unit geometries into one indexed geometry
 * with a vertex colour attribute. Eyes, pupils and other trim then cost one
 * draw call per entity type instead of one per piece per entity.
 */
function mergeGeos(parts) {
  const pos = [], nor = [], col = [], idx = [];
  let off = 0;
  const c = new THREE.Color();
  for (const part of parts) {
    const g = part.geo.clone();
    const sc = part.scale;
    if (Array.isArray(sc)) g.scale(sc[0], sc[1], sc[2]); else g.scale(sc, sc, sc);
    g.translate(part.pos[0], part.pos[1], part.pos[2]);
    const pa = g.attributes.position.array, na = g.attributes.normal.array;
    c.set(part.color);
    for (let i = 0; i < pa.length; i += 3) {
      pos.push(pa[i], pa[i + 1], pa[i + 2]);
      nor.push(na[i], na[i + 1], na[i + 2]);
      col.push(c.r, c.g, c.b);
    }
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx.push(ia[i] + off);
    off += pa.length / 3;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

const PROJ_COLOR = {
  bullet: '#ffe9a8', pellet: '#ffb37a', laser: '#66f0ff', rocket: '#ff9f6b',
  flame: '#ff8a3c', orb: '#c58bff', star: '#9be7ff', enemy: '#ff5c7a', spit: '#9ddc5c',
};

/**
 * Pool of scene objects keyed by entity id. Objects not touched between two
 * sweeps are hidden and recycled, so per-frame work is a Map lookup and a
 * transform update - no allocation while the wave is running.
 */
class Pool {
  constructor(parent, make) {
    this.parent = parent; this.make = make;
    this.active = new Map(); this.free = []; this.mark = 1;
  }
  get(id) {
    let o = this.active.get(id);
    if (!o) {
      o = this.free.pop();
      if (!o) { o = this.make(); this.parent.add(o); }
      o.visible = true;
      this.active.set(id, o);
    }
    o.userData.mark = this.mark;
    return o;
  }
  sweep() {
    for (const [id, o] of this.active) {
      if (o.userData.mark !== this.mark) { this.active.delete(id); o.visible = false; this.free.push(o); }
    }
    this.mark++;
  }
  clear() {
    for (const [, o] of this.active) { o.visible = false; this.free.push(o); }
    this.active.clear();
  }
}

// ---------------------------------------------------------------- shapes
// Shared unit geometries; every instance is a scaled copy of one of these.
const GEO = {
  sphere: new THREE.SphereGeometry(1, 20, 14),
  loSphere: new THREE.SphereGeometry(1, 10, 8),
  cone: new THREE.ConeGeometry(1, 2, 12),
  ico: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  dodeca: new THREE.DodecahedronGeometry(1, 0),
  octa: new THREE.OctahedronGeometry(1, 0),
  cyl: new THREE.CylinderGeometry(0.8, 1, 1.7, 14),
  box: new THREE.BoxGeometry(1, 1, 1),
  torus: new THREE.TorusGeometry(1.5, 0.12, 8, 40),
  ring: new THREE.RingGeometry(0.86, 1, 40),
  swing: new THREE.RingGeometry(0.45, 0.98, 28, 1, -0.6, 1.2),
  arrow: new THREE.ConeGeometry(0.5, 1.4, 6),
};
GEO.cone.rotateZ(-Math.PI / 2);   // tip points +X, the "forward" direction
GEO.cone.translate(0.3, 0, 0);
GEO.ring.rotateX(-Math.PI / 2);
GEO.swing.rotateX(-Math.PI / 2);
GEO.torus.rotateX(Math.PI / 2);
GEO.arrow.rotateZ(-Math.PI / 2);

// body geometry per enemy type (index into ENEMIES)
const ENEMY_GEO = [
  GEO.sphere,   // Grunt
  GEO.cone,     // Runner
  GEO.dodeca,   // Tank
  GEO.cyl,      // Shooter
  GEO.ico,      // Charger
  GEO.sphere,   // Exploder
  GEO.sphere,   // Spitter
  GEO.octa,     // Swarmer
  GEO.ico1,     // Warden
  GEO.ico1,     // Devourer
];
const ENEMY_SCALE = [
  [1, 1, 1], [1, 0.9, 0.9], [1.05, 0.9, 1.05], [1, 1, 1], [1.15, 0.9, 1],
  [1, 1.05, 1], [1, 0.75, 1.15], [1, 1, 1], [1, 1, 1], [1, 1, 1],
];

// ============================================================== renderer
export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.parts = [];      // point particles
    this.shapes = [];     // mesh particles: rings, glows, beams
    this.floats = [];     // damage numbers and text popups
    this.shake = 0;
    this.flash = 0;
    this.t = 0;
    this.dt = 0;
    this.trk = new Map();
    this.menuActors = null;
    this.lastPhase = -1;
    this.decalDirty = false;
    this.shapeSeq = 0;

    // ---- overlay canvas for text
    const ov = document.createElement('canvas');
    ov.id = 'overlay';
    ov.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:block;';
    canvas.parentNode.insertBefore(ov, canvas.nextSibling);
    this.ov = ov;
    this.og = ov.getContext('2d');

    // ---- three.js core
    // On high-density screens the extra pixels already hide edges, and MSAA
    // on top of a 2x buffer is the single most expensive thing we could do.
    this.maxDpr = Math.min(devicePixelRatio || 1, 2);
    this.dprCur = this.maxDpr;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: this.maxDpr < 1.5, alpha: false, powerPreference: 'high-performance' });
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    // adaptive resolution: frame-time history drives dprCur between MIN_DPR and maxDpr
    this.ftAcc = 0; this.ftN = 0; this.ftGood = 0; this.ftCooldown = 0;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.15;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05060a');
    this.scene.fog = new THREE.Fog(new THREE.Color('#05060a'), 1300, 2600);

    this.camera = new THREE.PerspectiveCamera(48, 16 / 9, 5, 5000);
    this.camTarget = new THREE.Vector3(ARENA.w / 2, 0, ARENA.h / 2);
    this.camOffset = new THREE.Vector3(0, 480, 310);
    this.camera.position.copy(this.camTarget).add(this.camOffset);
    this.camera.lookAt(this.camTarget);
    this.ray = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._col = new THREE.Color();
    this._mouseNdc = new THREE.Vector2();

    this.matCache = new Map();
    this.buildLights();
    this.buildArena();
    this.buildPools();
    this.buildParticles();

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  // ------------------------------------------------------------- setup
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, this.c.clientWidth), h = Math.max(1, this.c.clientHeight);
    this.w = w; this.h = h; this.dpr = dpr;
    this.maxDpr = dpr;
    this.dprCur = Math.min(this.dprCur, dpr);
    this.gl.setPixelRatio(this.dprCur);
    this.gl.setSize(w, h, false);
    this.bakeVignette();
    this.camera.aspect = w / h;
    // Portrait phones see less to the side; pull the camera up to compensate.
    this.camOffset.set(0, 480, 310).multiplyScalar(this.camera.aspect < 1 ? 1.5 : this.camera.aspect < 1.4 ? 1.2 : 1);
    this.camera.updateProjectionMatrix();
    this.ov.width = Math.round(w * dpr);
    this.ov.height = Math.round(h * dpr);
  }

  /**
   * Scale the 3D buffer to hold 60fps. A long frame is usually the GPU, and
   * pixel count is the lever we can pull without touching the look of the
   * text overlay, which always stays at native resolution.
   */
  adaptResolution(dt) {
    if (dt > 0.08) return;               // a stall (tab switch, GC), not a trend
    this.ftAcc += dt; this.ftN++;
    if (this.ftAcc < 1) return;
    const avg = this.ftAcc / this.ftN;
    this.ftAcc = 0; this.ftN = 0;
    if (this.ftCooldown > 0) { this.ftCooldown--; return; }
    if (avg > 1 / 50 && this.dprCur > MIN_DPR) {
      this.dprCur = Math.max(MIN_DPR, +(this.dprCur - 0.25).toFixed(2));
      this.gl.setPixelRatio(this.dprCur);
      this.ftGood = 0; this.ftCooldown = 1;
    } else if (avg < 1 / 58 && this.dprCur < this.maxDpr) {
      if (++this.ftGood >= 4) {
        this.dprCur = Math.min(this.maxDpr, +(this.dprCur + 0.25).toFixed(2));
        this.gl.setPixelRatio(this.dprCur);
        this.ftGood = 0; this.ftCooldown = 2;
      }
    } else this.ftGood = 0;
  }

  /** The vignette is two static gradients; drawing them as images is ~free. */
  bakeVignette() {
    const W = Math.max(1, Math.round(this.w / 2)), H = Math.max(1, Math.round(this.h / 2));
    const mk = (r, g, b, a) => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      const vg = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.78);
      vg.addColorStop(0, `rgba(${r},${g},${b},0)`);
      vg.addColorStop(1, `rgba(${r},${g},${b},${a})`);
      x.fillStyle = vg;
      x.fillRect(0, 0, W, H);
      return c;
    };
    this.vigBase = mk(0, 0, 0, 0.42);
    this.vigDanger = mk(60, 0, 0, 0.6);
  }

  /** Screen (CSS px) -> world coords by casting a ray onto the ground plane. */
  toWorld(sx, sy) {
    this._mouseNdc.set((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1);
    this.ray.setFromCamera(this._mouseNdc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.ground, this._v);
    if (!hit) return { x: this.camTarget.x, y: this.camTarget.z };
    return { x: hit.x, y: hit.z };
  }

  /** World (x, height, y) -> overlay CSS px. Returns null when behind the camera. */
  project(x, hgt, y) {
    const v = this._v2.set(x, hgt, y);
    const dist = v.distanceTo(this.camera.position);
    v.project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * this.w, y: (1 - v.y) / 2 * this.h, d: dist };
  }

  mat(key, make) {
    let m = this.matCache.get(key);
    if (!m) { m = make(); this.matCache.set(key, m); }
    return m;
  }
  bodyMat(color, variant = '') {
    return this.mat(`b${color}${variant}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.62, metalness: 0.05 });
      if (variant === 'hit') { m.emissive.set('#ffffff'); m.emissiveIntensity = 0.85; }
      if (variant === 'elite') { m.emissive.set(color); m.emissiveIntensity = 0.35; m.metalness = 0.3; m.roughness = 0.4; }
      if (variant === 'dead') { m.color.set('#5a5e6c'); m.roughness = 0.95; }
      return m;
    });
  }
  glowMat(color, opacity = 1) {
    return this.mat(`g${color}${opacity}`, () => new THREE.MeshBasicMaterial({
      color: new THREE.Color(color), transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
      blending: opacity < 1 ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
    }));
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight('#aebfe6', '#232636', 1.1);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight('#ffe9d2', 2.6);
    sun.position.set(ARENA.w / 2 - 520, 1000, ARENA.h / 2 + 380);
    sun.target.position.set(ARENA.w / 2, 0, ARENA.h / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    const sc = sun.shadow.camera;
    sc.left = -ARENA.w * 0.62; sc.right = ARENA.w * 0.62;
    sc.top = ARENA.h * 0.7; sc.bottom = -ARENA.h * 0.7;
    sc.near = 200; sc.far = 2400;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun, sun.target);
    this.sun = sun;

    // rim light from the far side so silhouettes read against the dark floor
    const rim = new THREE.DirectionalLight('#6f86ff', 0.55);
    rim.position.set(ARENA.w / 2 + 600, 500, ARENA.h / 2 - 900);
    rim.target.position.set(ARENA.w / 2, 0, ARENA.h / 2);
    this.scene.add(rim, rim.target);

    // braziers in the four corners: warm point lights that flicker
    this.braziers = [];
    const inset = WALL_T / 2 + 30;
    for (const [x, z] of [[inset, inset], [ARENA.w - inset, inset], [inset, ARENA.h - inset], [ARENA.w - inset, ARENA.h - inset]]) {
      const l = new THREE.PointLight('#ffb060', 26000, 640, 2);
      l.position.set(x, 70, z);
      this.scene.add(l);
      this.braziers.push({ light: l, ph: Math.random() * TAU, x, z });
    }
  }

  buildArena() {
    // ---- floor: baked flagstone texture, reused as a bump map
    const tex = new THREE.CanvasTexture(this.bakeFloor());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.gl.capabilities.getMaxAnisotropy());
    const floorMat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.6, roughness: 0.92, metalness: 0.02 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.w, ARENA.h), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(ARENA.w / 2, 0, ARENA.h / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // ---- decal layer (blood, scorch) on a transparent plane a hair above the floor
    const dc = document.createElement('canvas');
    dc.width = 800; dc.height = 450;
    this.decalCanvas = dc;
    this.decalCtx = dc.getContext('2d');
    this.decalCtx.scale(0.5, 0.5);
    this.decalTex = new THREE.CanvasTexture(dc);
    this.decalTex.colorSpace = THREE.SRGBColorSpace;
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA.w, ARENA.h),
      new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(ARENA.w / 2, 0.4, ARENA.h / 2);
    this.scene.add(decal);

    // ---- void beyond the walls, so the arena is an island in the dark
    const voidM = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: '#090a12', roughness: 1 }));
    voidM.rotation.x = -Math.PI / 2;
    voidM.position.set(ARENA.w / 2, -70, ARENA.h / 2);
    voidM.receiveShadow = true;
    this.scene.add(voidM);
    // a plinth under the arena so the drop reads as a cliff, not a floating sheet
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(ARENA.w + WALL_T * 2, 70, ARENA.h + WALL_T * 2), new THREE.MeshStandardMaterial({ color: '#171a27', roughness: 0.95 }));
    plinth.position.set(ARENA.w / 2, -35.5, ARENA.h / 2);
    this.scene.add(plinth);

    // ---- walls: every block goes into one merged mesh (one draw call, one shadow pass)
    const wallParts = [];
    const block = (w, h, d, x, y, z, color) => wallParts.push({ geo: GEO.box, color, scale: [w, h, d], pos: [x, y, z] });
    const wall = (w, d, x, z) => {
      block(w, WALL_H, d, x, WALL_H / 2, z, '#2b3046');
      block(w + 4, 5, d + 4, x, WALL_H + 2.5, z, '#3a4160');
    };
    wall(ARENA.w + WALL_T * 2, WALL_T, ARENA.w / 2, -WALL_T / 2);
    wall(ARENA.w + WALL_T * 2, WALL_T, ARENA.w / 2, ARENA.h + WALL_T / 2);
    wall(WALL_T, ARENA.h, -WALL_T / 2, ARENA.h / 2);
    wall(WALL_T, ARENA.h, ARENA.w + WALL_T / 2, ARENA.h / 2);
    for (let x = 40; x < ARENA.w; x += 80) {
      for (const z of [-WALL_T / 2, ARENA.h + WALL_T / 2]) block(30, 14, WALL_T + 2, x, WALL_H + 12, z, '#2b3046');
    }
    const walls = new THREE.Mesh(mergeGeos(wallParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.04 }));
    walls.castShadow = true; walls.receiveShadow = true;
    this.scene.add(walls);

    // ---- corner pillars with braziers
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#343a55', roughness: 0.8 });
    const bowlMat = new THREE.MeshStandardMaterial({ color: '#2a2230', roughness: 0.5, metalness: 0.6 });
    for (const b of this.braziers) {
      const p = new THREE.Mesh(GEO.box, pillarMat);
      p.scale.set(44, WALL_H + 30, 44);
      p.position.set(b.x, (WALL_H + 30) / 2, b.z);
      p.castShadow = true; p.receiveShadow = true;
      this.scene.add(p);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(14, 8, 12, 12), bowlMat);
      bowl.position.set(b.x, WALL_H + 36, b.z);
      this.scene.add(bowl);
      const flame = new THREE.Mesh(GEO.loSphere, this.glowMat('#ffb060'));
      flame.scale.set(9, 13, 9);
      flame.position.set(b.x, WALL_H + 48, b.z);
      this.scene.add(flame);
      const core = new THREE.Mesh(GEO.loSphere, this.glowMat('#fff3d0'));
      core.scale.set(4.5, 6.5, 4.5);
      core.position.copy(flame.position);
      this.scene.add(core);
      b.flame = flame; b.core = core;
    }
  }

  /** Same flagstone recipe as the 2D game, drawn once into a texture. */
  bakeFloor() {
    const c = document.createElement('canvas');
    c.width = ARENA.w; c.height = ARENA.h;
    const g = c.getContext('2d');
    const rnd = mulberry(2024);
    const grd = g.createRadialGradient(ARENA.w / 2, ARENA.h / 2, 80, ARENA.w / 2, ARENA.h / 2, ARENA.w * 0.7);
    grd.addColorStop(0, '#3a4258');
    grd.addColorStop(0.6, '#2b3145');
    grd.addColorStop(1, '#1b1f2e');
    g.fillStyle = grd;
    g.fillRect(0, 0, ARENA.w, ARENA.h);
    const T = 80;
    for (let y = 0; y < ARENA.h; y += T) {
      for (let x = 0; x < ARENA.w; x += T) {
        const checker = ((x / T + y / T) & 1) ? 0.05 : 0;
        const a = checker + (rnd() - 0.5) * 0.07;
        g.fillStyle = a >= 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`;
        g.fillRect(x + 1, y + 1, T - 2, T - 2);
      }
    }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= ARENA.w; x += T) { g.moveTo(x, 0); g.lineTo(x, ARENA.h); }
    for (let y = 0; y <= ARENA.h; y += T) { g.moveTo(0, y); g.lineTo(ARENA.w, y); }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    g.beginPath();
    for (let x = 2; x <= ARENA.w; x += T) { g.moveTo(x, 0); g.lineTo(x, ARENA.h); }
    for (let y = 2; y <= ARENA.h; y += T) { g.moveTo(0, y); g.lineTo(ARENA.w, y); }
    g.stroke();
    for (let i = 0; i < 14; i++) {
      const x = rnd() * ARENA.w, y = rnd() * ARENA.h, r = 60 + rnd() * 140;
      const bg = g.createRadialGradient(x, y, 0, x, y, r);
      bg.addColorStop(0, `rgba(0,0,0,${0.15 + rnd() * 0.15})`);
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = bg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1.5;
    for (let i = 0; i < 16; i++) {
      let x = rnd() * ARENA.w, y = rnd() * ARENA.h, a = rnd() * TAU;
      g.beginPath(); g.moveTo(x, y);
      const n = 3 + Math.floor(rnd() * 5);
      for (let j = 0; j < n; j++) {
        a += (rnd() - 0.5) * 1.4;
        const l = 8 + rnd() * 18;
        x += Math.cos(a) * l; y += Math.sin(a) * l;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 2200; i++) {
      const x = rnd() * ARENA.w, y = rnd() * ARENA.h;
      const light = rnd() < 0.5;
      g.fillStyle = light ? `rgba(255,255,255,${0.04 + rnd() * 0.08})` : `rgba(0,0,0,${0.12 + rnd() * 0.22})`;
      const s = 1 + rnd() * 2;
      g.fillRect(x, y, s, s);
    }
    return c;
  }

  buildPools() {
    const S = this.scene;
    this.playerPools = CHARACTERS.map((ch) => new Pool(S, () => this.makePlayer(ch)));
    this.buildEnemyInstances();
    this.haloPool = new Pool(S, () => {
      const m = new THREE.Mesh(GEO.torus, this.glowMat('#ff3b6b', 0.8));
      return m;
    });
    this.windupPool = new Pool(S, () => {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(GEO.ring, this.glowMat('#ff5050', 0.75));
      ring.position.y = 0.9;
      const arrow = new THREE.Mesh(GEO.arrow, this.glowMat('#ff7070', 0.6));
      arrow.position.y = 3;
      g.add(ring, arrow);
      g.userData.ring = ring; g.userData.arrow = arrow;
      return g;
    });
    this.swingPool = new Pool(S, () => {
      const m = new THREE.Mesh(GEO.swing, this.mat('swing', () => new THREE.MeshBasicMaterial({
        color: '#ffffff', transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      })));
      m.position.y = PLAYER_R * 0.9;
      return m;
    });
    // material gems: one instanced mesh for the whole floor
    this.gemInst = new THREE.InstancedMesh(GEO.octa, new THREE.MeshStandardMaterial({
      color: '#5ee68f', emissive: '#2fbf6a', emissiveIntensity: 0.7, roughness: 0.25, metalness: 0.2,
    }), MAX_MAT_INST);
    this.gemInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.gemInst.castShadow = true;
    this.gemInst.frustumCulled = false;
    this.gemInst.count = 0;
    S.add(this.gemInst);
    this.pickupPools = [
      null,
      new Pool(S, () => {
        const g = new THREE.Group();
        const orb = new THREE.Mesh(GEO.sphere, this.mat('hp', () => new THREE.MeshStandardMaterial({
          color: '#ff6b7a', emissive: '#ff3d55', emissiveIntensity: 0.6, roughness: 0.3,
        })));
        orb.scale.setScalar(7.5); orb.castShadow = true;
        const cross = this.mat('cross', () => new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }));
        const a = new THREE.Mesh(GEO.box, cross); a.scale.set(8, 2.4, 2.4); a.position.z = 7.2;
        const b = new THREE.Mesh(GEO.box, cross); b.scale.set(2.4, 8, 2.4); b.position.z = 7.2;
        g.add(orb, a, b);
        return g;
      }),
      // boss loot crate: a big gold gem with a slow halo, unmistakable on the floor
      new Pool(S, () => {
        const g = new THREE.Group();
        const gem = new THREE.Mesh(GEO.octa, this.mat('crate', () => new THREE.MeshStandardMaterial({
          color: '#ffc857', emissive: '#ff9f1c', emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.4,
        })));
        gem.scale.set(13, 19, 13); gem.castShadow = true;
        const halo = new THREE.Mesh(GEO.ring, this.mat('crateHalo', () => new THREE.MeshBasicMaterial({
          color: '#ffd68a', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        })));
        halo.scale.set(34, 1, 34); halo.position.y = -8;
        g.add(gem, halo);
        return g;
      }),
    ];
    // ring / glow / beam mesh particles
    this.ringPool = new Pool(S, () => {
      const m = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      m.position.y = 1.2;
      return m;
    });
    this.glowPool = new Pool(S, () => new THREE.Mesh(GEO.loSphere, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
    this.beamPool = new Pool(S, () => new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#9ee6ff', transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));

    // projectiles: one instanced mesh, per-instance colour and stretch
    const pm = new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false });
    this.projInst = new THREE.InstancedMesh(GEO.loSphere, pm, MAX_PROJ_INST);
    this.projInst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.projInst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PROJ_INST * 3), 3);
    this.projInst.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.projInst.count = 0;
    this.projInst.frustumCulled = false;
    S.add(this.projInst);
    // soft halo behind each projectile, additive and slightly larger
    const hm = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.projHalo = new THREE.InstancedMesh(GEO.loSphere, hm, MAX_PROJ_INST);
    this.projHalo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.projHalo.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PROJ_INST * 3), 3);
    this.projHalo.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.projHalo.count = 0;
    this.projHalo.frustumCulled = false;
    S.add(this.projHalo);

    // dashed "this is you" ring
    this.meRing = new THREE.Mesh(new THREE.RingGeometry(21, 24, 48, 1), new THREE.MeshBasicMaterial({
      color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.meRing.geometry.rotateX(-Math.PI / 2);
    this.meRing.position.y = 0.8;
    this.meRing.visible = false;
    S.add(this.meRing);
  }

  makePlayer(ch) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(GEO.sphere, this.bodyMat(ch.color));
    body.scale.set(1, 1.15, 0.92);
    body.position.y = 1.12;
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    // face: two eyes looking down +X, merged into a single draw call
    const face = new THREE.Mesh(
      this.faceGeo || (this.faceGeo = mergeGeos([
        { geo: GEO.loSphere, color: '#ffffff', scale: 0.26, pos: [0.78, 1.42, -0.34] },
        { geo: GEO.loSphere, color: '#ffffff', scale: 0.26, pos: [0.78, 1.42, 0.34] },
        { geo: GEO.loSphere, color: '#141421', scale: 0.13, pos: [0.98, 1.44, -0.36] },
        { geo: GEO.loSphere, color: '#141421', scale: 0.13, pos: [0.98, 1.44, 0.36] },
      ])),
      this.mat('face', () => new THREE.MeshBasicMaterial({ vertexColors: true })),
    );
    g.add(face);
    // weapon held out front
    const w = WEAPONS[ch.weapon];
    const metal = this.mat('metal', () => new THREE.MeshStandardMaterial({ color: '#9aa3b8', roughness: 0.35, metalness: 0.8 }));
    const dark = this.mat('dark', () => new THREE.MeshStandardMaterial({ color: '#2a2d3a', roughness: 0.5, metalness: 0.4 }));
    const arm = new THREE.Group();
    arm.position.set(0.55, 1.0, 0.55);
    if (w?.cls === 'melee') {
      const blade = new THREE.Mesh(GEO.box, metal);
      blade.scale.set(1.7, 0.09, 0.32); blade.position.x = 1.2;
      const grip = new THREE.Mesh(GEO.box, dark);
      grip.scale.set(0.45, 0.16, 0.16); grip.position.x = 0.15;
      blade.castShadow = true;
      arm.add(blade, grip);
    } else {
      const barrel = new THREE.Mesh(GEO.box, dark);
      barrel.scale.set(1.35, 0.3, 0.3); barrel.position.x = 0.85;
      const tip = new THREE.Mesh(GEO.box, metal);
      tip.scale.set(0.3, 0.34, 0.34); tip.position.x = 1.55;
      barrel.castShadow = true;
      arm.add(barrel, tip);
    }
    g.add(arm);
    g.scale.setScalar(PLAYER_R);
    g.userData = { body, arm, ch, mark: 0 };
    return g;
  }

  /**
   * Enemies are drawn with two InstancedMeshes per type: a lit body and an
   * unlit face (eyes, pupils, fuse). Per-instance colour carries the elite
   * tint and the hit flash, so a crowd of 200 costs ~20 draw calls.
   */
  buildEnemyInstances() {
    this.enemyInst = ENEMIES.map((def, type) => {
      const sc = ENEMY_SCALE[type] || [1, 1, 1];
      const bodyGeo = (ENEMY_GEO[type] || GEO.sphere).clone();
      bodyGeo.scale(sc[0], sc[1], sc[2]);
      bodyGeo.translate(0, 1, 0);
      const body = new THREE.InstancedMesh(bodyGeo, this.mat('ebody', () => new THREE.MeshStandardMaterial({
        color: '#ffffff', roughness: 0.62, metalness: 0.05,
      })), MAX_ENEMY_INST);
      body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      body.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ENEMY_INST * 3), 3);
      body.instanceColor.setUsage(THREE.DynamicDrawUsage);
      body.castShadow = true; body.receiveShadow = true;
      body.frustumCulled = false;
      body.count = 0;

      const es = def.boss ? 0.16 : 0.22;
      const parts = [
        { geo: GEO.loSphere, color: '#fff4d0', scale: es, pos: [0.72, 1.3, -0.36] },
        { geo: GEO.loSphere, color: '#fff4d0', scale: es, pos: [0.72, 1.3, 0.36] },
        { geo: GEO.loSphere, color: '#2a0810', scale: es * 0.5, pos: [0.9, 1.31, -0.37] },
        { geo: GEO.loSphere, color: '#2a0810', scale: es * 0.5, pos: [0.9, 1.31, 0.37] },
      ];
      if (type === 5) parts.push({ geo: GEO.loSphere, color: '#ffd166', scale: 0.25, pos: [0, 2.1, 0] });
      const face = new THREE.InstancedMesh(mergeGeos(parts), this.mat('eface', () => new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })), MAX_ENEMY_INST);
      face.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      face.frustumCulled = false;
      face.count = 0;
      this.scene.add(body, face);

      const base = new THREE.Color(def.color);
      const elite = base.clone().lerp(new THREE.Color('#ffc857'), 0.35).multiplyScalar(1.15);
      return { body, face, base, elite, white: new THREE.Color('#ffffff') };
    });
  }

  buildParticles() {
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTS * 3);
    this.pCol = new Float32Array(MAX_PARTS * 3);
    this.pSize = new Float32Array(MAX_PARTS);
    this.pAlpha = new Float32Array(MAX_PARTS);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
      uniforms: { uScale: { value: 1 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vCol; varying float vA; uniform float uScale;
        void main() {
          vCol = color; vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vCol; varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d) * 2.0;
          if (r > 1.0) discard;
          float a = smoothstep(1.0, 0.45, r) * vA;
          gl_FragColor = vec4(vCol, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  // -------------------------------------------------------------- decals
  splat(x, y, r, col) {
    const g = this.decalCtx;
    g.fillStyle = col; g.globalAlpha = 0.7;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * TAU, d = r * (0.6 + Math.random() * 0.9);
      g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.18 + Math.random() * 0.3), 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
    this.decalDirty = true;
  }
  scorch(x, y, r) {
    const g = this.decalCtx;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(0,0,0,0.75)');
    grd.addColorStop(0.7, 'rgba(20,10,5,0.4)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    this.decalDirty = true;
  }
  clearDecals() {
    this.decalCtx.clearRect(0, 0, ARENA.w, ARENA.h);
    this.decalDirty = true;
  }

  // ------------------------------------------------------------------ fx
  spawnFx(list) {
    for (const f of list) {
      switch (f.t) {
        case FX.HIT:
          this.burst(f.x, f.y, 12, 4, '#ffd98a', 150, 0.22, 2, 'spark');
          break;
        case FX.EXPLODE:
          this.shape({ kind: 'ring', x: f.x, y: f.y, r: 6, max: f.a, life: 0.4, maxLife: 0.4, col: '#ffb070' });
          this.shape({ kind: 'glow', x: f.x, y: f.y, r: f.a * 0.6, life: 0.25, maxLife: 0.25, col: '#ffe0a0' });
          this.burst(f.x, f.y, 16, 14, '#ff7a3c', 340, 0.5, 4, 'spark');
          this.burst(f.x, f.y, 16, 10, '#ffd166', 220, 0.4, 3, 'dot');
          this.burst(f.x, f.y, 20, 9, '#3a3a44', 70, 1.1, 10, 'smoke');
          this.scorch(f.x, f.y, f.a * 0.55);
          this.shake = Math.max(this.shake, 7);
          this.flash = Math.max(this.flash, 0.35);
          break;
        case FX.BEAM:
          this.shape({ kind: 'beam', x: f.x, y: f.y, x2: f.x2, y2: f.y2, life: 0.18, maxLife: 0.18, col: '#9ee6ff' });
          this.burst(f.x2, f.y2, 14, 4, '#c8f4ff', 120, 0.25, 2, 'spark');
          break;
        case FX.LEVELUP:
          this.shape({ kind: 'ring', x: f.x, y: f.y, r: 8, max: 90, life: 0.6, maxLife: 0.6, col: '#ffe066' });
          this.burst(f.x, f.y, 4, 18, '#ffe066', 160, 0.9, 3, 'rise');
          this.float({ x: f.x, y: f.y, h: 44, text: 'LEVEL UP', col: '#ffe066', life: 1.1, maxLife: 1.1, size: 20, vy: -26 });
          break;
        case FX.PICKUP:
          this.burst(f.x, f.y, 6, 4, '#8dffb0', 90, 0.3, 2, 'rise');
          break;
        case FX.DEATH: {
          const def = f.x2 > 0 ? ENEMIES[f.x2 - 1] : null;
          const col = def ? def.color : '#8b90a0';
          const r = f.a / 2;
          this.burst(f.x, f.y, r * 0.8, Math.min(22, 6 + f.a / 5), col, 200, 0.5, 3, 'dot');
          this.burst(f.x, f.y, r * 0.8, Math.min(8, 3 + f.a / 12), shade(col, -0.3), 120, 0.7, 5, 'chunk');
          if (def) this.splat(f.x, f.y, Math.max(6, r * 0.7), shade(col, -0.25));
          if (def?.boss) {
            this.shape({ kind: 'ring', x: f.x, y: f.y, r: 10, max: 220, life: 0.8, maxLife: 0.8, col });
            this.shape({ kind: 'glow', x: f.x, y: f.y, r: 70, life: 0.4, maxLife: 0.4, col });
            this.shake = Math.max(this.shake, 12);
            this.flash = Math.max(this.flash, 0.5);
          }
          break;
        }
        case FX.HEAL:
          this.float({ x: f.x, y: f.y, h: 36, text: '+', col: '#8dffb0', life: 0.6, maxLife: 0.6, size: 18, vy: -40 });
          this.burst(f.x, f.y, 6, 3, '#8dffb0', 60, 0.5, 2, 'rise');
          break;
        case FX.DODGE:
          this.float({ x: f.x, y: f.y, h: 36, text: 'DODGE', col: '#7ec8ff', life: 0.7, maxLife: 0.7, size: 14, vy: -34 });
          break;
        case FX.DAMAGE: {
          const crit = f.x2 === 1;
          this.float({
            x: f.x + (Math.random() - 0.5) * 16, y: f.y, h: 24, text: String(f.a),
            col: crit ? '#ffd166' : '#ffffff', life: crit ? 0.8 : 0.55,
            maxLife: crit ? 0.8 : 0.55, size: crit ? 21 : 13, vy: -46, crit,
          });
          break;
        }
        default: break;
      }
    }
  }

  /** Point particles live in 3D: (x, z) on the ground plane, h is height. */
  burst(x, y, h, n, col, spd, life, size, kind = 'dot') {
    const head = MAX_PARTS - this.parts.length;
    if (head <= 0) return;
    if (n > head) n = head;
    const [r, g, b] = hex2rgb(col);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = spd * (0.4 + Math.random() * 0.6);
      const up = kind === 'rise' ? 40 + Math.random() * 50
        : kind === 'smoke' ? 25 + Math.random() * 30
          : kind === 'chunk' ? 120 + Math.random() * 160
            : (Math.random() - 0.3) * s * 0.8;
      this.parts.push({
        kind, x, y, h, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vh: up,
        life: life * (0.6 + Math.random() * 0.6), maxLife: life, size, r: r / 255, g: g / 255, b: b / 255,
      });
    }
  }
  shape(s) { if (this.shapes.length < 60) { s.id = ++this.shapeSeq; this.shapes.push(s); } }
  float(f) {
    if (this.floats.length >= MAX_FLOATS) this.floats.shift();
    f.rise = 0;
    this.floats.push(f);
  }

  stepFx(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      switch (p.kind) {
        case 'dot': case 'spark':
          p.x += p.vx * dt; p.y += p.vy * dt; p.h += p.vh * dt;
          p.vx *= 0.9; p.vy *= 0.9; p.vh -= 300 * dt;
          if (p.h < 1) { p.h = 1; p.vh = Math.abs(p.vh) * 0.4; }
          break;
        case 'chunk':
          p.x += p.vx * dt; p.y += p.vy * dt; p.h += p.vh * dt;
          p.vx *= 0.93; p.vy *= 0.93; p.vh -= 520 * dt;
          if (p.h < 1.5) { p.h = 1.5; p.vh = Math.abs(p.vh) * 0.35; p.vx *= 0.6; p.vy *= 0.6; }
          break;
        case 'smoke':
          p.x += p.vx * dt; p.y += p.vy * dt; p.h += p.vh * dt;
          p.vx *= 0.96; p.vy *= 0.96; p.size += 14 * dt;
          break;
        case 'rise':
          p.x += p.vx * dt * 0.3; p.y += p.vy * dt * 0.3; p.h += p.vh * dt;
          break;
        default: break;
      }
    }
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      const s = this.shapes[i];
      s.life -= dt;
      if (s.life <= 0) { this.shapes.splice(i, 1); continue; }
      if (s.kind === 'ring') s.r += (s.max - s.r) * Math.min(1, dt * 9);
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt;
      if (f.life <= 0) { this.floats.splice(i, 1); continue; }
      f.rise -= f.vy * dt;
      f.vy *= 0.94;
    }
    this.shake *= Math.pow(0.0015, dt);
    if (this.shake < 0.2) this.shake = 0;
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  // ---------------------------------------------------------------- draw
  draw(view, info, dt) {
    this.t += dt;
    this.dt = dt;
    this.adaptResolution(dt);
    this.stepFx(dt);

    if (!view) view = this.menuView(dt);
    else if (view.phase !== this.lastPhase) {
      // fresh floor each wave, like sweeping the arena between rounds
      if (view.phase === 1 && this.lastPhase !== -1) this.clearDecals();
      this.lastPhase = view.phase;
    }

    this.updateCamera(view, info, dt);
    this.updateBraziers();

    this.syncPlayers(view, info);
    this.syncEnemies(view);
    this.syncProjectiles(view);
    this.syncPickups(view);
    this.syncShapes();
    this.syncParticles();

    if (this.decalDirty) { this.decalTex.needsUpdate = true; this.decalDirty = false; }

    this.gl.render(this.scene, this.camera);
    this.drawOverlay(view, info);

    if (this.trk.size > view.players.length) {
      const alive = new Set(view.players.map((p) => p.id));
      for (const id of this.trk.keys()) if (!alive.has(id)) this.trk.delete(id);
    }
  }

  updateCamera(view, info, dt) {
    let tx, tz;
    if (info) {
      const me = view.players.find((p) => p.id === info.pid);
      const src = me && !(me.flags & 1) ? me : me || view.players[0];
      if (src) { tx = src.x; tz = src.y; }
    }
    if (tx === undefined) {
      // menu / spectating: slow orbit around the arena centre
      const a = this.t * 0.12;
      tx = ARENA.w / 2; tz = ARENA.h / 2;
      this.camTarget.x += (tx - this.camTarget.x) * damp(dt, 3);
      this.camTarget.z += (tz - this.camTarget.z) * damp(dt, 3);
      this.camera.position.set(tx + Math.cos(a) * 980, 560, tz + Math.sin(a) * 980);
      this.camera.lookAt(this.camTarget.x, 30, this.camTarget.z);
      return;
    }
    // Keep a margin so the camera never stares into the void past the walls.
    const mx = Math.min(ARENA.w / 2, 260), mz = Math.min(ARENA.h / 2, 160);
    tx = Math.max(mx, Math.min(ARENA.w - mx, tx));
    tz = Math.max(mz, Math.min(ARENA.h - mz, tz));
    const k = damp(dt, 5.5);
    this.camTarget.x += (tx - this.camTarget.x) * k;
    this.camTarget.z += (tz - this.camTarget.z) * k;
    const sx = this.shake ? (Math.random() - 0.5) * this.shake * 1.6 : 0;
    const sz = this.shake ? (Math.random() - 0.5) * this.shake * 1.6 : 0;
    this.camera.position.set(
      this.camTarget.x + this.camOffset.x + sx,
      this.camOffset.y,
      this.camTarget.z + this.camOffset.z + sz,
    );
    this.camera.lookAt(this.camTarget.x + sx, 0, this.camTarget.z + sz);
  }

  updateBraziers() {
    for (const b of this.braziers) {
      const f = 0.85 + Math.sin(this.t * 9 + b.ph) * 0.08 + Math.sin(this.t * 23 + b.ph * 3) * 0.07;
      b.light.intensity = 26000 * f;
      b.flame.scale.set(9 * f, 13 * (0.9 + f * 0.3), 9 * f);
      b.core.scale.set(4.5, 6.5 * f, 4.5);
    }
  }

  // ------------------------------------------------------------- players
  syncPlayers(view, info) {
    let meSeen = false;
    for (const p of view.players) {
      const ch = CHARACTERS[p.char] || CHARACTERS[0];
      const g = this.playerPools[ch.id].get(p.id);
      const ud = g.userData;
      const dead = p.flags & 1, hurt = p.flags & 2, inv = p.flags & 4;
      const isMe = info && p.id === info.pid;

      if (dead) {
        g.position.set(p.x, -PLAYER_R * 0.45, p.y);
        g.rotation.set(0, -p.ang, Math.PI / 2);
        g.scale.setScalar(PLAYER_R);
        ud.body.material = this.bodyMat(ch.color, 'dead');
        g.visible = true;
        continue;
      }

      // walk cycle from observed speed
      let tr = this.trk.get(p.id);
      if (!tr) { tr = { x: p.x, y: p.y, spd: 0, ph: 0 }; this.trk.set(p.id, tr); }
      const dx = p.x - tr.x, dy = p.y - tr.y;
      const inst = this.dt > 0 ? Math.hypot(dx, dy) / this.dt : 0;
      tr.spd += (Math.min(inst, 400) - tr.spd) * Math.min(1, this.dt * 12);
      tr.x = p.x; tr.y = p.y;
      const moving = tr.spd / 400;
      tr.ph += this.dt * (6 + tr.spd * 0.05);
      const bob = Math.abs(Math.sin(tr.ph)) * 3.2 * moving;
      const sq = Math.sin(tr.ph * 2) * 0.06 * moving;

      g.position.set(p.x, bob, p.y);
      g.rotation.set(0, -p.ang, 0);
      g.scale.set(PLAYER_R * (1 + sq), PLAYER_R * (1 - sq), PLAYER_R * (1 + sq));
      ud.body.material = this.bodyMat(ch.color, hurt ? 'hit' : '');
      g.visible = !(inv && !hurt) || Math.sin(this.t * 40) > -0.4;

      if (isMe) {
        meSeen = true;
        this.meRing.position.set(p.x, 0.8, p.y);
        this.meRing.rotation.y = this.t * 1.5;
      }
    }
    this.meRing.visible = meSeen;
    for (const pool of this.playerPools) pool.sweep();
  }

  // ------------------------------------------------------------- enemies
  syncEnemies(view) {
    const inst = this.enemyInst;
    for (const it of inst) it.n = 0;
    const m = this._m, q = this._q, sc = this._s, pos = this._v;
    const yAxis = this._v2.set(0, 1, 0);
    for (const e of view.enemies) {
      const type = ENEMIES[e.type] ? e.type : 0;
      const def = ENEMIES[type];
      const it = inst[type];
      if (it.n >= MAX_ENEMY_INST) continue;
      const elite = e.flags & 1, hit = e.flags & 2, windup = e.flags & 4;
      const r = def.r * (elite ? 1.5 : 1);
      const ph = this.t * (def.name === 'Swarmer' ? 22 : def.name === 'Runner' ? 12 : 6) + e.id * 1.7;
      const w = Math.sin(ph) * (def.name === 'Exploder' ? 0.08 : 0.045);
      const hop = def.name === 'Swarmer' || def.name === 'Runner' ? Math.abs(Math.sin(ph)) * r * 0.35 : 0;
      pos.set(e.x, hop, e.y);
      q.setFromAxisAngle(yAxis, -e.ang);
      sc.set(r * (1 + w), r * (1 - w), r * (1 + w));
      m.compose(pos, q, sc);
      it.body.setMatrixAt(it.n, m);
      it.face.setMatrixAt(it.n, m);
      it.body.setColorAt(it.n, hit ? it.white : elite ? it.elite : it.base);
      it.n++;

      if (def.boss) {
        const halo = this.haloPool.get(e.id);
        halo.material = this.glowMat(def.color, 0.8);
        halo.position.set(e.x, r, e.y);
        halo.scale.setScalar(r);
        halo.rotation.set(Math.sin(this.t * 0.7) * 0.4, this.t * 1.3, 0);
      }
      if (windup) {
        const wu = this.windupPool.get(e.id);
        wu.position.set(e.x, 0, e.y);
        wu.rotation.y = -e.ang;
        const rr = r + 9 + Math.sin(this.t * 30) * 3;
        wu.userData.ring.scale.set(rr, 1, rr);
        wu.userData.arrow.position.x = r + 26;
        wu.userData.arrow.scale.set(28, 10, 10);
      }
    }
    for (const it of inst) {
      it.body.count = it.n; it.face.count = it.n;
      if (it.n) {
        it.body.instanceMatrix.needsUpdate = true; it.face.instanceMatrix.needsUpdate = true;
        it.body.instanceColor.needsUpdate = true;
      }
    }
    this.haloPool.sweep();
    this.windupPool.sweep();
  }

  // --------------------------------------------------------- projectiles
  syncProjectiles(view) {
    const inst = this.projInst, halo = this.projHalo;
    let n = 0;
    const m = this._m, q = this._q, s = this._s, col = this._col, pos = this._v;
    const yAxis = this._v2.set(0, 1, 0);
    for (const b of view.projs) {
      const kind = PROJ_KINDS[b.type] || 'bullet';
      if (kind === 'swing') {
        const sw = this.swingPool.get(b.id);
        sw.position.set(b.x, PLAYER_R * 0.9, b.y);
        sw.rotation.y = -b.ang;
        sw.scale.set(b.size, 1, b.size);
        continue;
      }
      if (n >= MAX_PROJ_INST) continue;
      col.set(b.flags & 2 ? '#ffd166' : (PROJ_COLOR[kind] || '#ffe9a8'));
      const hostile = b.flags & 1;
      // b.size is the 2D hit radius; the drawn body is a bit tighter than that
      const sr = b.size * 0.5;
      let sx = sr, sy = sr, sz = sr, h = 14;
      switch (kind) {
        case 'bullet': sx = sr * 3; sy = sz = sr * 0.9; break;
        case 'pellet': sx = sr * 1.7; sy = sz = sr * 0.8; break;
        case 'laser': sx = sr * 6; sy = sz = sr * 0.55; break;
        case 'rocket': sx = sr * 2.6; sy = sz = sr * 1.2; h = 16;
          if (Math.random() < 0.6) this.burst(b.x - Math.cos(b.ang) * 14, b.y - Math.sin(b.ang) * 14, 16, 1, '#5a5a66', 20, 0.7, 5, 'smoke');
          break;
        case 'flame': { const f = sr * 1.5 + Math.random() * 2.5; sx = sy = sz = f; h = 10 + Math.random() * 8; break; }
        case 'orb': sx = sy = sz = sr * 1.6; break;
        case 'star': sx = sz = sr * 1.8; sy = sr * 0.5; break;
        case 'enemy': sx = sy = sz = sr * 1.6; break;
        case 'spit': sx = sr * 1.8; sy = sz = sr * 1.2; break;
        default: break;
      }
      q.setFromAxisAngle(yAxis, kind === 'star' ? this.t * 10 : -b.ang);
      pos.set(b.x, h, b.y);
      s.set(sx, sy, sz);
      m.compose(pos, q, s);
      inst.setMatrixAt(n, m);
      inst.setColorAt(n, col);
      s.multiplyScalar(hostile ? 1.8 : 1.5);
      m.compose(pos, q, s);
      halo.setMatrixAt(n, m);
      halo.setColorAt(n, col);
      n++;
    }
    inst.count = n; halo.count = n;
    inst.instanceMatrix.needsUpdate = true; halo.instanceMatrix.needsUpdate = true;
    inst.instanceColor.needsUpdate = true; halo.instanceColor.needsUpdate = true;
    this.swingPool.sweep();
  }

  // ------------------------------------------------------------- pickups
  syncPickups(view) {
    const gem = this.gemInst;
    let n = 0;
    const m = this._m, q = this._q, sc = this._s.set(6, 9, 6), pos = this._v;
    const yAxis = this._v2.set(0, 1, 0);
    for (const p of view.pickups) {
      const bob = Math.sin(this.t * 6 + p.id) * 2.5;
      if (p.type === 2) {
        const o = this.pickupPools[2].get(p.id);
        o.position.set(p.x, 22 + bob * 2, p.y);
        o.rotation.y = this.t * 1.2;
        o.children[1].rotation.y = -this.t * 0.7;
        continue;
      }
      if (p.type !== 1) {
        if (n >= MAX_MAT_INST) continue;
        pos.set(p.x, 10 + bob, p.y);
        q.setFromAxisAngle(yAxis, this.t * 2 + p.id);
        m.compose(pos, q, sc);
        gem.setMatrixAt(n++, m);
        continue;
      }
      const o = this.pickupPools[1].get(p.id);
      o.position.set(p.x, 10 + bob, p.y);
      const pulse = 1 + Math.sin(this.t * 7 + p.id) * 0.08;
      o.scale.setScalar(pulse);
      o.rotation.y = -Math.atan2(this.camera.position.z - p.y, this.camera.position.x - p.x) + Math.PI / 2;
    }
    gem.count = n;
    if (n) gem.instanceMatrix.needsUpdate = true;
    this.pickupPools[1].sweep();
    this.pickupPools[2].sweep();
  }

  // ----------------------------------------------------- mesh particles
  syncShapes() {
    for (const s of this.shapes) {
      const a = s.life / s.maxLife;
      const id = s.id;
      if (s.kind === 'ring') {
        const m = this.ringPool.get(id);
        m.position.set(s.x, 1.2 + (1 - a) * 6, s.y);
        m.scale.set(s.r, 1, s.r);
        m.material.color.set(s.col);
        m.material.opacity = a * 0.9;
      } else if (s.kind === 'glow') {
        const m = this.glowPool.get(id);
        m.position.set(s.x, s.r * 0.35, s.y);
        m.scale.setScalar(s.r * (1.3 - a * 0.3));
        m.material.color.set(s.col);
        m.material.opacity = a * 0.7;
      } else if (s.kind === 'beam') {
        const m = this.beamPool.get(id);
        const dx = s.x2 - s.x, dz = s.y2 - s.y;
        const len = Math.hypot(dx, dz);
        m.position.set((s.x + s.x2) / 2, 14, (s.y + s.y2) / 2);
        m.rotation.set(0, -Math.atan2(dz, dx), 0);
        m.scale.set(len, 2 + a * 5, 2 + a * 5);
        m.material.color.set(s.col);
        m.material.opacity = a;
      }
    }
    this.ringPool.sweep(); this.glowPool.sweep(); this.beamPool.sweep();
  }

  syncParticles() {
    const n = this.parts.length;
    for (let i = 0; i < n; i++) {
      const p = this.parts[i];
      const a = p.life / p.maxLife;
      this.pPos[i * 3] = p.x; this.pPos[i * 3 + 1] = p.h; this.pPos[i * 3 + 2] = p.y;
      this.pCol[i * 3] = p.r; this.pCol[i * 3 + 1] = p.g; this.pCol[i * 3 + 2] = p.b;
      // sizes are world units at the projection reference distance
      this.pSize[i] = p.size * (p.kind === 'spark' ? 1.4 : p.kind === 'smoke' ? 2.2 : 1.8) * 420 * this.dpr;
      this.pAlpha[i] = p.kind === 'smoke' ? a * 0.45 : Math.min(1, a * 1.6);
    }
    const geo = this.points.geometry;
    geo.setDrawRange(0, n);
    for (const k of ['position', 'color', 'size', 'alpha']) geo.attributes[k].needsUpdate = true;
  }

  // ------------------------------------------------------------- overlay
  drawOverlay(view, info) {
    const g = this.og;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';

    // ---- enemy bars and labels
    for (const e of view.enemies) {
      const def = ENEMIES[e.type] || ENEMIES[0];
      const elite = e.flags & 1;
      const r = def.r * (elite ? 1.5 : 1);
      const needBar = e.hpPct < 255;
      if (!needBar && !elite && !def.boss) continue;
      const s = this.project(e.x, r * 2.3 + 6, e.y);
      if (!s) continue;
      const k = this.labelScale(s.d);
      if (needBar) {
        const bw = Math.max(22, r * 2.2) * k;
        g.fillStyle = 'rgba(0,0,0,0.65)';
        roundRect(g, s.x - bw / 2 - 1, s.y - 1, bw + 2, 6, 3); g.fill();
        g.fillStyle = def.boss ? '#ff3b6b' : elite ? '#ffc857' : '#7ee081';
        const fw = bw * (e.hpPct / 255);
        if (fw > 0.5) { roundRect(g, s.x - bw / 2, s.y, fw, 4, 2); g.fill(); }
      }
      if (elite && !def.boss) {
        g.fillStyle = '#ffc857';
        g.font = 'bold 11px system-ui, sans-serif';
        g.fillText('ELITE', s.x, s.y - 5);
      }
      if (def.boss) {
        g.font = 'bold 14px system-ui, sans-serif';
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.7)';
        g.strokeText(def.name.toUpperCase(), s.x, s.y - 8);
        g.fillStyle = '#ff5c7a';
        g.fillText(def.name.toUpperCase(), s.x, s.y - 8);
      }
    }

    // ---- player bars and names
    for (const p of view.players) {
      const isMe = info && p.id === info.pid;
      const name = info?.roster?.get(p.id)?.name || '';
      const dead = p.flags & 1;
      if (dead) {
        const s = this.project(p.x, 20, p.y);
        if (!s) continue;
        g.fillStyle = '#8b90a0';
        g.font = 'bold 12px system-ui, sans-serif';
        g.fillText(`${name} (down)`, s.x, s.y);
        continue;
      }
      const s = this.project(p.x, PLAYER_R * 2.5 + 8, p.y);
      if (!s) continue;
      const w = 42;
      const by = s.y;
      g.fillStyle = 'rgba(0,0,0,0.65)';
      roundRect(g, s.x - w / 2 - 1, by - 1, w + 2, 7, 3.5); g.fill();
      const hp = Math.max(0, p.hp / p.maxHp);
      g.fillStyle = hp < 0.3 ? '#ff5c5c' : hp < 0.6 ? '#ffc857' : '#7ee081';
      if (hp > 0.02) { roundRect(g, s.x - w / 2, by, w * hp, 5, 2.5); g.fill(); }
      if (name) {
        g.font = `bold ${isMe ? 13 : 12}px system-ui, sans-serif`;
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.7)';
        g.strokeText(name, s.x, by - 5);
        g.fillStyle = isMe ? '#ffffff' : 'rgba(220,225,240,0.85)';
        g.fillText(name, s.x, by - 5);
      }
    }

    // ---- floating text
    const outline = this.floats.length <= OUTLINE_LIMIT;
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.75)';
    let font = '';
    for (const f of this.floats) {
      const s = this.project(f.x, f.h + f.rise * 0.6, f.y);
      if (!s) continue;
      const a = f.life / f.maxLife;
      g.globalAlpha = Math.max(0, Math.min(1, a * 1.4));
      const size = f.crit ? Math.round(f.size * (1 + Math.max(0, a - 0.75) * 2)) : f.size;
      const want = `bold ${size}px system-ui, sans-serif`;
      if (want !== font) { font = want; g.font = want; }
      if (outline) g.strokeText(f.text, s.x, s.y);
      g.fillStyle = f.col;
      g.fillText(f.text, s.x, s.y);
    }
    g.globalAlpha = 1;

    // ---- vignette, reddening as the wave timer runs down
    const danger = info?.danger || 0;
    g.drawImage(this.vigBase, 0, 0, this.w, this.h);
    if (danger > 0.01) {
      g.globalAlpha = danger;
      g.drawImage(this.vigDanger, 0, 0, this.w, this.h);
      g.globalAlpha = 1;
    }

    if (this.flash > 0) {
      g.fillStyle = `rgba(255,240,220,${this.flash * 0.3})`;
      g.fillRect(0, 0, this.w, this.h);
    }
  }

  /** Bars shrink a little for things far from the camera so depth still reads. */
  labelScale(dist) {
    return Math.max(0.7, Math.min(1.2, 780 / Math.max(1, dist)));
  }

  // ---------------------------------------------------------------- menu
  /** Behind the menu a potato and a few monsters wander so the title is alive. */
  menuView(dt) {
    if (!this.menuActors) {
      const rnd = mulberry(99);
      this.menuActors = [];
      for (let i = 0; i < 11; i++) {
        this.menuActors.push({
          kind: i < 2 ? 'player' : 'enemy', type: [0, 1, 2, 3, 4, 6, 7, 5, 0, 1, 3][i],
          x: 200 + rnd() * (ARENA.w - 400), y: 150 + rnd() * (ARENA.h - 300), ang: rnd() * TAU, spd: 25 + rnd() * 40, id: i,
          turn: (rnd() - 0.5) * 0.6,
        });
      }
    }
    const players = [], enemies = [];
    for (const a of this.menuActors) {
      a.ang += a.turn * dt + Math.sin(this.t * 0.5 + a.id) * 0.01;
      a.x += Math.cos(a.ang) * a.spd * dt;
      a.y += Math.sin(a.ang) * a.spd * dt;
      if (a.x < 60 || a.x > ARENA.w - 60 || a.y < 60 || a.y > ARENA.h - 60) {
        a.ang = Math.atan2(ARENA.h / 2 - a.y, ARENA.w / 2 - a.x) + (Math.random() - 0.5);
      }
      if (a.kind === 'enemy') enemies.push({ id: a.id, type: a.type, x: a.x, y: a.y, ang: a.ang, hpPct: 255, flags: 0 });
      else players.push({ id: 200 + a.id, char: (Math.floor(this.t / 6) + a.id) % CHARACTERS.length, x: a.x, y: a.y, ang: a.ang, hp: 1, maxHp: 1, flags: 0 });
    }
    return { phase: 0, wave: 0, timeLeft: 0, players, enemies, projs: [], pickups: [] };
  }
}

export { TIER_COLOR };
