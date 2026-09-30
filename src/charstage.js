// ---------------------------------------------------------------------------
// Character select stage: one potato on a pedestal, lit like a product shot.
// It sways to show off its face; drag spins it, and it turns back afterwards.
//
// A separate little WebGL renderer, not the arena's, so it works the same when
// Display is set to 2D and never has to move the game camera. It draws the
// same baked Blender models (assets3d.js) the arena uses, and only runs its
// frame loop while the lobby is on screen.
//
// Until the art arrives - and forever if it cannot (no WebGL, file:// page) -
// `ready` stays false and the UI shows the flat 2D portrait instead.
//
//   const st = new CharStage(canvas, () => ui.markChar());
//   st.show(charId, locked);   st.start();   st.stop();
// ---------------------------------------------------------------------------

import * as THREE from 'three';
import { loadAssets, artMaterial } from './assets3d.js';
import { CHARACTERS } from './data.js';

const SWAY = 0.55;          // idle: rock this far either side of the 3/4 view
const HOP_TIME = 0.5;       // seconds of squash-and-hop after a new pick
const FACE_CAM = -Math.PI / 2 + 0.5;   // models face +X; this turns the face 3/4 toward the camera
const CAM_DIST = 11.5;

export class CharStage {
  constructor(canvas, onReady) {
    this.canvas = canvas;
    this.onReady = onReady;
    this.ready = false;
    this.running = false;
    this.models = new Map();   // charId -> { group, locked }
    this.cur = null;
    this.charId = 0;
    this.locked = false;
    this.off = 0;              // drag rotation on top of the idle sway
    this.vel = 0;
    this.drag = null;
    this.hopAt = -1;
    this.t = 0;
    this.last = 0;
    try {
      this.gl = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    } catch (e) {
      console.warn('[charstage] no WebGL, portrait fallback:', e?.message || e);
      return;
    }
    this.gl.setClearColor(0x000000, 0);
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.1;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;

    const S = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    this.camera.position.set(0, 2.6, CAM_DIST);
    this.camera.lookAt(0, 1.2, 0);

    S.add(new THREE.HemisphereLight('#e4ecff', '#2a2233', 1.2));
    const key = new THREE.DirectionalLight('#fff1dc', 2.4);
    key.position.set(3, 5, 5);
    S.add(key);
    this.rim = new THREE.DirectionalLight('#ffffff', 2.2);
    this.rim.position.set(-4, 3, -4);
    S.add(this.rim);

    // soft contact shadow plus a faint pool of the character's colour
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(1.35, 48), new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false,
    }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(2.1, 48), new THREE.MeshBasicMaterial({
      map: radialTexture('rgba(255,255,255,0.5)', 'rgba(255,255,255,0)'), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.35,
    }));
    this.pool.rotation.x = -Math.PI / 2;
    S.add(this.pool, this.shadow);

    this.mats = new Map();
    this.silhouette = new THREE.MeshStandardMaterial({ color: '#16171f', roughness: 0.9, metalness: 0 });

    this.bindDrag();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();

    loadAssets()
      .then((a) => {
        this.art = a;
        if (!a?.characters || !Object.keys(a.characters).length) throw new Error('no character models');
        this.ready = true;
        this.show(this.charId, this.locked, true);
        this.onReady?.();
      })
      .catch((e) => console.warn('[charstage] portrait fallback:', e?.message || e));
  }

  mat(kind) {
    let m = this.mats.get(kind);
    if (!m) { m = artMaterial(kind); this.mats.set(kind, m); }
    return m;
  }

  /** Build (once) and cache a potato plus its starting weapon. */
  model(id) {
    let m = this.models.get(id);
    if (m) return m;
    const ch = CHARACTERS[id] || CHARACTERS[0];
    const art = this.art.characters[ch.name];
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);
    const lit = [];     // [mesh, its real material] - swapped for the silhouette when locked
    const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(ch.color), roughness: 0.62, metalness: 0.05 });
    if (art?.skin) {
      const skin = new THREE.Mesh(art.skin, skinMat);
      body.add(skin);
      lit.push([skin, skinMat]);
      for (const kind of ['matte', 'metal', 'glow', 'face']) {
        if (!art[kind]) continue;
        const mesh = new THREE.Mesh(art[kind], this.mat(kind));
        body.add(mesh);
        lit.push([mesh, mesh.material, kind]);
      }
    } else {
      // no model for this one: a plain potato-ish egg still beats a hole
      const egg = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), skinMat);
      egg.scale.set(1, 1.15, 0.92);
      egg.position.y = 1.12;
      body.add(egg);
      lit.push([egg, skinMat]);
    }
    const w = this.art.weapons?.[ch.weapon];
    let weapon = null;
    if (w) {
      weapon = new THREE.Group();
      for (const [kind, geo] of Object.entries(w.parts)) weapon.add(new THREE.Mesh(geo, this.mat(kind)));
      if (w.spin) {
        const sp = new THREE.Mesh(w.spin, this.mat('metal'));
        sp.position.copy(w.spinAt);
        weapon.add(sp);
      }
      // held out to the right of the face, like the first slot in the arena
      weapon.position.set(0.35, 1.05, 1.25);
      weapon.scale.setScalar(0.9);
      group.add(weapon);
    }
    m = { group, body, weapon, lit, color: new THREE.Color(ch.color) };
    this.models.set(id, m);
    return m;
  }

  /** Put a character on the turntable. `quiet` skips the hop. */
  show(id, locked = false, quiet = false) {
    const changed = id !== this.charId || locked !== this.locked;
    this.charId = id;
    this.locked = locked;
    if (!this.ready) return;
    const m = this.model(id);
    if (this.cur && this.cur !== m) this.scene.remove(this.cur.group);
    if (this.cur !== m) this.scene.add(m.group);
    this.cur = m;
    for (const [mesh, real, kind] of m.lit) {
      mesh.material = locked ? this.silhouette : real;
      mesh.visible = !(locked && (kind === 'face' || kind === 'glow'));
    }
    if (m.weapon) m.weapon.visible = !locked;
    this.rim.color.copy(locked ? new THREE.Color('#5a607a') : m.color);
    this.pool.material.color.copy(locked ? new THREE.Color('#333645') : m.color);
    if (changed && !quiet) { this.hopAt = this.t; this.off = 0; this.vel = 0; }
    if (!this.running) this.frame(0);
  }

  start() {
    if (this.running || !this.gl) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);   // rAF already pauses in background tabs
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  frame(dt) {
    if (!this.gl) return;
    this.t += dt;
    const m = this.cur;
    if (m) {
      if (!this.drag) {
        // a fling keeps spinning for a moment, then the face turns back to you
        this.off += this.vel * dt;
        this.vel *= Math.exp(-dt * 2.5);
        if (Math.abs(this.vel) < 1.5) {
          this.off = Math.atan2(Math.sin(this.off), Math.cos(this.off));
          this.off *= Math.exp(-dt * 2);
        }
      }
      m.group.rotation.y = FACE_CAM + Math.sin(this.t * 0.6) * SWAY + this.off;
      // idle: a slow breath; on a new pick, a squash and a hop
      const h = this.hopAt >= 0 ? (this.t - this.hopAt) / HOP_TIME : 1;
      let y = 0, sy = 1 + Math.sin(this.t * 2.2) * 0.015;
      if (h < 1) {
        y = Math.sin(h * Math.PI) * 0.45;
        sy *= h < 0.15 ? 1 - h * 1.2 : 1 + Math.sin(h * Math.PI) * 0.08;
      }
      m.body.position.y = y;
      m.body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      if (m.weapon) {
        m.weapon.position.y = 1.05 + y + Math.sin(this.t * 1.8 + 1) * 0.08;
        m.weapon.rotation.z = Math.sin(this.t * 1.3) * 0.08;
      }
      this.shadow.scale.setScalar(1 - y * 0.5);
    }
    this.gl.render(this.scene, this.camera);
  }

  resize() {
    if (!this.gl) return;
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.gl.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.gl.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    // narrow boxes pull back so the potato never clips the sides
    this.camera.position.z = CAM_DIST * Math.max(1, 0.95 / this.camera.aspect);
    this.camera.updateProjectionMatrix();
    if (!this.running) this.frame(0);
  }

  /** Drag to spin; let go and it eases back into the idle turn. */
  bindDrag() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, t: performance.now() };
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const now = performance.now();
      const dx = e.clientX - this.drag.x;
      const dts = Math.max(0.008, (now - this.drag.t) / 1000);
      this.off += dx * 0.012;
      this.vel = (dx * 0.012) / dts;
      this.drag = { x: e.clientX, t: now };
    });
    const end = () => { this.drag = null; c.classList.remove('dragging'); };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }
}

function radialTexture(inner, outer) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
