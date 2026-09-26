// ---------------------------------------------------------------------------
// Canvas 2D renderer.
//
// The whole arena is always on screen (no camera), which is deliberate: in
// co-op everyone must see the same field or callouts are meaningless, and it
// removes an entire class of "where is my teammate" problems. The canvas is
// scaled to fit and letterboxed, so 1600x900 world units mean the same thing
// on every machine. That also makes `setZoom` a no-op here and spectating
// nearly free: everyone is already on screen, so a spectator only needs to be
// told who to look at.
//
// This class is interchangeable with the Three.js Renderer in render3d.js -
// the display setting swaps between them at runtime, so the two must keep the
// same public surface:
//   new Renderer(canvas)  draw(view, info, dt)  spawnFx(list)  toWorld(x, y)
//   setZoom(z)  setOptions(o)  dispose()  .shake .flash .parts .floats
//
// Nothing here is loaded from disk - every sprite is drawn from primitives.
// A deploy is therefore just HTML/CSS/JS with zero binary assets to 404.
//
// Sprites are procedurally painted once into small offscreen canvases and then
// blitted with drawImage. That is what pays for the extra detail: glow, rim
// light and faces are baked in, so a frame with 120 monsters costs about the
// same as the old flat polygons did - shadowBlur never runs in the hot loop.
// ---------------------------------------------------------------------------

import { ARENA, CHARACTERS, ENEMIES, TIER_COLOR } from './data.js';
import { FX, PROJ_KINDS } from './protocol.js';
import { paintWeaponShape } from './icons.js';

const TAU = Math.PI * 2;

// Budgets, not guesses: a wave-20 minigun build pushes ~1400 damage numbers a
// second through here, and canvas text (stroke + fill) is by far the most
// expensive thing this renderer does. Past these counts the extra draws are
// illegible anyway, so they buy nothing but frame time.
const MAX_PARTS = 380;
const MAX_FLOATS = 80;
const TRAIL_PROJ_LIMIT = 90;   // above this many bullets, bullets lose their trail
const OUTLINE_LIMIT = 34;      // above this many floats, drop the text outline
const SPR = 3;                 // sprite cache resolution, px per world unit
const PLAYER_R = 14;

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

/** Mix a hex colour toward black (k<0) or white (k>0). Returns an rgb() string. */
function shade(hex, k, alpha = 1) {
  const [r, g, b] = hex2rgb(hex);
  const t = k < 0 ? 0 : 255;
  const m = Math.abs(k);
  const f = (c) => Math.round(c + (t - c) * m);
  return alpha >= 1 ? `rgb(${f(r)},${f(g)},${f(b)})` : `rgba(${f(r)},${f(g)},${f(b)},${alpha})`;
}

function rgba(hex, a) {
  const [r, g, b] = hex2rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function roundRect(g, x, y, w, h, r) {
  if (g.roundRect) { g.beginPath(); g.roundRect(x, y, w, h, r); return; }
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A blobby closed shape: a circle with a few soft bumps, for organic bodies. */
function blob(g, r, bumps, amp, seed) {
  const rnd = mulberry(seed);
  const n = 24;
  const ph = rnd() * TAU;
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const rr = r * (1 + Math.sin(a * bumps + ph) * amp);
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

// Glossy highlight in the upper-left, shared by every body type.
function gloss(g, r, alpha = 0.35) {
  g.fillStyle = `rgba(255,255,255,${alpha})`;
  g.beginPath();
  g.ellipse(-r * 0.32, -r * 0.38, r * 0.42, r * 0.26, -0.6, 0, TAU);
  g.fill();
}

// Two eyes at (ex, ±ey) with pupils looking toward +x.
function eyes(g, ex, ey, er, look = 0.35, pupil = '#101018', angry = 0) {
  for (const s of [-1, 1]) {
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(ex, s * ey, er, 0, TAU); g.fill();
    g.fillStyle = pupil;
    g.beginPath(); g.arc(ex + er * look, s * ey, er * 0.5, 0, TAU); g.fill();
    if (angry) {
      g.strokeStyle = pupil;
      g.lineWidth = er * 0.55;
      g.beginPath();
      g.moveTo(ex - er * 1.1, s * (ey - er * angry));
      g.lineTo(ex + er * 1.1, s * (ey - er * 0.2));
      g.stroke();
    }
  }
}

// -------------------------------------------------------- sprite cache
const spriteCache = new Map();

/**
 * Fetch (or bake) a sprite. `half` is the half-size in world units including
 * room for glow. `paint(g)` draws the sprite centred on the origin in world
 * units, facing +x.
 */
function sprite(key, half, paint) {
  let s = spriteCache.get(key);
  if (s) return s;
  const px = Math.ceil(half * 2 * SPR);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d');
  g.translate(px / 2, px / 2);
  g.scale(SPR, SPR);
  g.lineJoin = 'round';
  paint(g);
  s = { c, half };
  spriteCache.set(key, s);
  return s;
}

function blit(g, s, x, y, ang, sx = 1, sy = 1) {
  g.save();
  g.translate(x, y);
  if (ang) g.rotate(ang);
  if (sx !== 1 || sy !== 1) g.scale(sx, sy);
  g.drawImage(s.c, -s.half, -s.half, s.half * 2, s.half * 2);
  g.restore();
}

// ------------------------------------------------------- enemy painting
function paintEnemy(g, type, elite, hit) {
  const def = ENEMIES[type] || ENEMIES[0];
  const r = def.r * (elite ? 1.5 : 1);
  const col = hit ? '#ffffff' : def.color;
  const dark = hit ? '#c8c8d8' : shade(def.color, -0.55);
  const ink = hit ? '#9a9ab0' : '#15121c';

  if (def.boss || elite) {
    g.shadowColor = hit ? '#ffffff' : def.color;
    g.shadowBlur = (def.boss ? 26 : 14) * SPR;
  }
  g.lineWidth = Math.max(1.6, r * 0.11);
  g.strokeStyle = dark;
  g.fillStyle = col;

  switch (def.name) {
    case 'Runner': {
      // teardrop: fat front, pointed tail
      g.beginPath();
      g.moveTo(-r * 1.55, 0);
      g.quadraticCurveTo(-r * 0.3, -r * 1.05, r * 0.7, -r * 0.7);
      g.quadraticCurveTo(r * 1.15, 0, r * 0.7, r * 0.7);
      g.quadraticCurveTo(-r * 0.3, r * 1.05, -r * 1.55, 0);
      g.closePath();
      g.fill(); g.stroke();
      g.shadowBlur = 0;
      gloss(g, r, 0.3);
      // one big eye
      g.fillStyle = '#fff'; g.beginPath(); g.arc(r * 0.25, 0, r * 0.38, 0, TAU); g.fill();
      g.fillStyle = ink; g.beginPath(); g.arc(r * 0.4, 0, r * 0.2, 0, TAU); g.fill();
      break;
    }
    case 'Tank': {
      // armoured hexagon with plate seams
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill(); g.stroke();
      g.shadowBlur = 0;
      g.strokeStyle = hit ? '#d0d0e0' : shade(def.color, -0.35);
      g.lineWidth = r * 0.07;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        g.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55);
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.stroke();
      g.fillStyle = hit ? '#e8e8f0' : shade(def.color, 0.18);
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const x = Math.cos(a) * r * 0.55, y = Math.sin(a) * r * 0.55;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill();
      gloss(g, r, 0.18);
      // visor slit
      g.fillStyle = ink;
      roundRect(g, r * 0.1, -r * 0.28, r * 0.55, r * 0.56, r * 0.1); g.fill();
      g.fillStyle = hit ? '#fff' : '#ff8a8a';
      roundRect(g, r * 0.22, -r * 0.16, r * 0.3, r * 0.32, r * 0.06); g.fill();
      break;
    }
    case 'Shooter': {
      blob(g, r, 5, 0.05, 31);
      g.fill(); g.stroke();
      g.shadowBlur = 0;
      // barrel
      g.fillStyle = hit ? '#d8d8e8' : '#2b2f45';
      roundRect(g, r * 0.35, -r * 0.24, r * 1.05, r * 0.48, r * 0.1); g.fill();
      g.fillStyle = hit ? '#fff' : shade(def.color, 0.4);
      roundRect(g, r * 1.05, -r * 0.14, r * 0.35, r * 0.28, r * 0.06); g.fill();
      gloss(g, r, 0.3);
      // lens
      g.fillStyle = '#fff'; g.beginPath(); g.arc(-r * 0.05, 0, r * 0.4, 0, TAU); g.fill();
      g.fillStyle = ink; g.beginPath(); g.arc(r * 0.08, 0, r * 0.22, 0, TAU); g.fill();
      g.fillStyle = hit ? '#ddd' : '#ff5c7a'; g.beginPath(); g.arc(r * 0.1, 0, r * 0.1, 0, TAU); g.fill();
      break;
    }
    case 'Charger': {
      blob(g, r, 4, 0.06, 7);
      g.fill(); g.stroke();
      g.shadowBlur = 0;
      // horns
      g.fillStyle = hit ? '#eee' : '#f1e6d0';
      g.strokeStyle = dark;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(r * 0.45, s * r * 0.5);
        g.lineTo(r * 1.45, s * r * 0.75);
        g.lineTo(r * 0.75, s * r * 0.15);
        g.closePath(); g.fill(); g.stroke();
      }
      gloss(g, r, 0.28);
      eyes(g, r * 0.3, r * 0.34, r * 0.2, 0.5, ink, 0.9);
      break;
    }
    case 'Exploder': {
      blob(g, r, 6, 0.08, 99);
      g.fill(); g.stroke();
      g.shadowBlur = 0;
      // hot core + cracks
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.75);
      grd.addColorStop(0, hit ? '#fff' : '#fff3a0');
      grd.addColorStop(0.5, hit ? '#eee' : '#ffb347');
      grd.addColorStop(1, rgba(def.color, 0));
      g.fillStyle = grd;
      g.beginPath(); g.arc(0, 0, r * 0.75, 0, TAU); g.fill();
      g.strokeStyle = ink; g.lineWidth = r * 0.08;
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.4;
        g.moveTo(Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.35);
        g.lineTo(Math.cos(a + 0.3) * r * 0.7, Math.sin(a + 0.3) * r * 0.7);
        g.lineTo(Math.cos(a + 0.15) * r * 0.95, Math.sin(a + 0.15) * r * 0.95);
      }
      g.stroke();
      // fuse
      g.strokeStyle = hit ? '#ccc' : '#3a2a20'; g.lineWidth = r * 0.12;
      g.beginPath(); g.moveTo(-r * 0.2, -r * 0.85); g.quadraticCurveTo(-r * 0.5, -r * 1.35, -r * 0.05, -r * 1.4); g.stroke();
      g.fillStyle = '#ffe680'; g.beginPath(); g.arc(-r * 0.05, -r * 1.4, r * 0.16, 0, TAU); g.fill();
      eyes(g, r * 0.25, r * 0.3, r * 0.15, 0.3, ink, 0);
      break;
    }
    case 'Spitter': {
      blob(g, r, 7, 0.07, 55);
      g.fill(); g.stroke();
      g.shadowBlur = 0;
      // warts
      g.fillStyle = hit ? '#e0e0e8' : shade(def.color, -0.25);
      for (const [wx, wy, wr] of [[-0.45, -0.4, 0.16], [-0.1, 0.55, 0.13], [-0.6, 0.25, 0.11], [0.2, -0.65, 0.1]]) {
        g.beginPath(); g.arc(wx * r, wy * r, wr * r, 0, TAU); g.fill();
      }
      gloss(g, r, 0.25);
      // gaping mouth
      g.fillStyle = ink;
      g.beginPath(); g.ellipse(r * 0.55, 0, r * 0.38, r * 0.5, 0, 0, TAU); g.fill();
      g.fillStyle = hit ? '#bbb' : '#7ec850';
      g.beginPath(); g.ellipse(r * 0.55, r * 0.18, r * 0.24, r * 0.18, 0, 0, TAU); g.fill();
      eyes(g, r * 0.1, r * 0.55, r * 0.17, 0.4, ink, 0);
      break;
    }
    case 'Swarmer': {
      // wings
      g.fillStyle = hit ? 'rgba(255,255,255,0.7)' : 'rgba(255,240,200,0.55)';
      for (const s of [-1, 1]) {
        g.beginPath(); g.ellipse(-r * 0.3, s * r * 1.0, r * 0.95, r * 0.5, s * 0.35, 0, TAU); g.fill();
      }
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(r * 1.1, 0); g.lineTo(0, -r * 0.8); g.lineTo(-r * 1.1, 0); g.lineTo(0, r * 0.8);
      g.closePath(); g.fill(); g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = ink; g.beginPath(); g.arc(r * 0.35, 0, r * 0.22, 0, TAU); g.fill();
      break;
    }
    case 'Warden': {
      // spiked octagon with a rotating-looking inner ring and a huge eye
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        const rr = i % 2 ? r * 0.78 : r;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill(); g.stroke();
      g.shadowBlur = 0;
      g.strokeStyle = hit ? '#ddd' : shade(def.color, -0.3);
      g.lineWidth = r * 0.06;
      g.beginPath(); g.arc(0, 0, r * 0.62, 0, TAU); g.stroke();
      g.fillStyle = hit ? '#eee' : shade(def.color, -0.45);
      g.beginPath(); g.arc(0, 0, r * 0.5, 0, TAU); g.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + TAU / 16;
        g.fillStyle = hit ? '#fff' : '#ffd9e2';
        g.beginPath(); g.arc(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7, r * 0.06, 0, TAU); g.fill();
      }
      gloss(g, r, 0.2);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(r * 0.05, 0, r * 0.32, 0, TAU); g.fill();
      g.fillStyle = hit ? '#999' : '#c0002e'; g.beginPath(); g.arc(r * 0.15, 0, r * 0.19, 0, TAU); g.fill();
      g.fillStyle = ink; g.beginPath(); g.arc(r * 0.18, 0, r * 0.09, 0, TAU); g.fill();
      break;
    }
    case 'Devourer': {
      blob(g, r, 9, 0.06, 1234);
      g.fill(); g.stroke();
      g.shadowBlur = 0;
      // veins
      g.strokeStyle = hit ? '#ddd' : shade(def.color, -0.4); g.lineWidth = r * 0.05;
      g.beginPath();
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        g.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        g.quadraticCurveTo(Math.cos(a + 0.35) * r * 0.75, Math.sin(a + 0.35) * r * 0.75, Math.cos(a + 0.2) * r * 0.97, Math.sin(a + 0.2) * r * 0.97);
      }
      g.stroke();
      gloss(g, r, 0.18);
      // maw with teeth
      g.fillStyle = ink;
      g.beginPath(); g.arc(0, 0, r * 0.48, 0, TAU); g.fill();
      g.fillStyle = hit ? '#fff' : '#f5e9ff';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        g.beginPath();
        g.moveTo(Math.cos(a - 0.14) * r * 0.5, Math.sin(a - 0.14) * r * 0.5);
        g.lineTo(Math.cos(a + 0.14) * r * 0.5, Math.sin(a + 0.14) * r * 0.5);
        g.lineTo(Math.cos(a) * r * 0.22, Math.sin(a) * r * 0.22);
        g.closePath(); g.fill();
      }
      g.fillStyle = hit ? '#aaa' : '#ff2bd6';
      g.beginPath(); g.arc(0, 0, r * 0.1, 0, TAU); g.fill();
      // small eyes above the maw
      eyes(g, r * 0.35, r * 0.62, r * 0.12, 0.3, ink, 0.6);
      break;
    }
    default: {
      // Grunt: angry blob with teeth
      blob(g, r, 5, 0.07, 3 + type);
      g.fill(); g.stroke();
      g.shadowBlur = 0;
      gloss(g, r, 0.3);
      eyes(g, r * 0.3, r * 0.38, r * 0.2, 0.45, ink, 0.8);
      // jagged mouth
      g.fillStyle = ink;
      g.beginPath();
      g.moveTo(r * 0.55, -r * 0.25);
      for (let i = 0; i <= 4; i++) {
        const y = -r * 0.25 + (i / 4) * r * 0.5;
        g.lineTo(i % 2 ? r * 0.75 : r * 0.92, y);
      }
      g.lineTo(r * 0.55, r * 0.25);
      g.closePath(); g.fill();
      break;
    }
  }

  if (elite && !hit) {
    g.strokeStyle = 'rgba(255,200,87,0.9)';
    g.lineWidth = 2;
    g.setLineDash([r * 0.35, r * 0.25]);
    g.beginPath(); g.arc(0, 0, r + 4, 0, TAU); g.stroke();
    g.setLineDash([]);
  }
}

function enemySprite(type, elite, hit) {
  const def = ENEMIES[type] || ENEMIES[0];
  const r = def.r * (elite ? 1.5 : 1);
  const half = r * 1.75 + (def.boss ? 30 : elite ? 18 : 4);
  return sprite(`e${type}|${elite ? 1 : 0}|${hit ? 1 : 0}`, half, (g) => paintEnemy(g, type, elite, hit));
}

// ------------------------------------------------------ player painting
/** A potato body in the character's colour, facing up (aim is drawn live). */
function paintPotato(g, color, r, hurt) {
  const col = hurt ? '#ffffff' : color;
  g.shadowColor = col; g.shadowBlur = 12 * SPR;
  g.fillStyle = col;
  g.strokeStyle = hurt ? '#c8c8d8' : shade(color, -0.55);
  g.lineWidth = 2;
  // potato: slightly lumpy ellipse
  g.save();
  g.rotate(-0.35);
  g.scale(1, 1.18);
  blob(g, r, 3, 0.07, 42);
  g.restore();
  g.fill(); g.stroke();
  g.shadowBlur = 0;
  // "skin" spots
  g.fillStyle = hurt ? 'rgba(200,200,220,0.6)' : shade(color, -0.3, 0.55);
  for (const [sx, sy, sr] of [[-0.45, 0.45, 0.13], [0.5, 0.55, 0.1], [-0.55, -0.6, 0.09], [0.55, -0.2, 0.08]]) {
    g.beginPath(); g.arc(sx * r, sy * r, sr * r, 0, TAU); g.fill();
  }
  gloss(g, r * 1.05, 0.38);
}

function playerSprite(charId, hurt) {
  const ch = CHARACTERS[charId] || CHARACTERS[0];
  return sprite(`p${charId}|${hurt ? 1 : 0}`, PLAYER_R * 1.5 + 16, (g) => paintPotato(g, ch.color, PLAYER_R, hurt));
}

const deadSprite = () => sprite('pdead', PLAYER_R * 1.5 + 6, (g) => {
  g.fillStyle = '#4a4f62'; g.strokeStyle = '#23262f'; g.lineWidth = 2;
  g.save(); g.rotate(1.2); g.scale(1, 1.18); blob(g, PLAYER_R, 3, 0.07, 42); g.restore();
  g.fill(); g.stroke();
  g.strokeStyle = '#181a22'; g.lineWidth = 2.2;
  for (const s of [-1, 1]) {
    const ex = s * 5, ey = -3;
    g.beginPath();
    g.moveTo(ex - 3, ey - 3); g.lineTo(ex + 3, ey + 3);
    g.moveTo(ex + 3, ey - 3); g.lineTo(ex - 3, ey + 3);
    g.stroke();
  }
});

/** Face: eyes whose pupils look toward `aim`, on a body of radius r. */
function paintFace(g, x, y, aim, r, dead = false) {
  const lx = Math.cos(aim) * r * 0.12, ly = Math.sin(aim) * r * 0.12;
  for (const s of [-1, 1]) {
    const ex = x + s * r * 0.36, ey = y - r * 0.18;
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(ex, ey, r * 0.24, r * 0.28, 0, 0, TAU); g.fill();
    g.fillStyle = '#15121c';
    g.beginPath(); g.arc(ex + lx, ey + ly, r * 0.13, 0, TAU); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(ex + lx - r * 0.04, ey + ly - r * 0.05, r * 0.045, 0, TAU); g.fill();
  }
  if (!dead) {
    g.strokeStyle = '#15121c'; g.lineWidth = Math.max(1, r * 0.09);
    g.beginPath(); g.arc(x, y + r * 0.22, r * 0.22, 0.25, Math.PI - 0.25); g.stroke();
  }
}

/** Held weapon, rotated to `aim`, flipped so the grip is never upside down. */
function paintWeapon(g, x, y, aim, weaponId, r) {
  g.save();
  g.translate(x, y);
  g.rotate(aim);
  const flip = Math.abs(((aim % TAU) + TAU) % TAU - Math.PI) < Math.PI / 2 ? -1 : 1;
  g.scale(1, flip);
  paintWeaponShape(g, weaponId, r);
  g.restore();
}

/** Paint a lobby portrait of `charId` into `canvas`. Exported for ui.js. */
export function renderPortrait(canvas, charId) {
  const ch = CHARACTERS[charId] || CHARACTERS[0];
  const g = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  const s = w / (PLAYER_R * 4.2);
  g.save();
  g.translate(w / 2, h / 2 + PLAYER_R * s * 0.15);
  g.scale(s, s);
  // ground shadow
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath(); g.ellipse(0, PLAYER_R * 1.05, PLAYER_R * 1.1, PLAYER_R * 0.35, 0, 0, TAU); g.fill();
  const aim = -0.45;
  const spr = playerSprite(ch.id, false);
  g.drawImage(spr.c, -spr.half, -spr.half, spr.half * 2, spr.half * 2);
  paintWeapon(g, 0, 0, aim, ch.weapon, PLAYER_R);
  paintFace(g, 0, 0, aim, PLAYER_R);
  g.restore();
}

// ------------------------------------------------------------ renderer
export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.parts = [];
    this.floats = [];
    this.heavyProj = false;
    this.shake = 0;
    this.flash = 0;
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.t = 0;
    this.dt = 0;
    this.trk = new Map();      // per-player movement tracking for walk animation
    this.decalFade = 0;
    this.motes = [];
    this.menuActors = null;
    this.opt = { shake: true, floats: true };
    this.watching = 0;
    const mr = mulberry(7);
    for (let i = 0; i < 46; i++) {
      this.motes.push({ x: mr() * ARENA.w, y: mr() * ARENA.h, vx: (mr() - 0.5) * 14, vy: -6 - mr() * 10, r: 0.8 + mr() * 1.6, ph: mr() * TAU });
    }
    this.resize();
    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize);
  }

  /** No camera to move: the arena always fits the screen exactly. */
  setZoom() { /* intentionally nothing */ }

  setOptions(o) { Object.assign(this.opt, o); }

  /** Drop the offscreen canvases and stop listening. See render3d's dispose. */
  dispose() {
    removeEventListener('resize', this._onResize);
    this._floor = null;
    this._decal = null;
    this.parts.length = 0;
    this.floats.length = 0;
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = this.c.clientWidth, h = this.c.clientHeight;
    this.c.width = Math.max(1, Math.round(w * dpr));
    this.c.height = Math.max(1, Math.round(h * dpr));
    this.dpr = dpr;
    this.scale = Math.min(w / ARENA.w, h / ARENA.h);
    this.ox = (w - ARENA.w * this.scale) / 2;
    this.oy = (h - ARENA.h * this.scale) / 2;
    this.buildFloor();
    this._vig = null;
  }

  /** Screen (CSS px) -> world coords, for aiming with the mouse. */
  toWorld(sx, sy) {
    return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale };
  }

  // ----------------------------------------------------------------- floor
  // Baked once per resize into an offscreen canvas at display resolution, so
  // the per-frame cost is one 1:1 blit no matter how much detail is in it.
  buildFloor() {
    const k = Math.max(0.25, this.scale * this.dpr);
    const W = Math.max(1, Math.ceil(ARENA.w * k)), H = Math.max(1, Math.ceil(ARENA.h * k));
    const c = this._floor || document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.scale(k, k);
    const rnd = mulberry(2024);

    // base
    const grd = g.createRadialGradient(ARENA.w / 2, ARENA.h / 2, 80, ARENA.w / 2, ARENA.h / 2, ARENA.w * 0.7);
    grd.addColorStop(0, '#1c2233');
    grd.addColorStop(0.6, '#141828');
    grd.addColorStop(1, '#0b0d16');
    g.fillStyle = grd;
    g.fillRect(0, 0, ARENA.w, ARENA.h);

    // flagstones: alternating tint, per-tile variance, slightly inset edges
    const T = 80;
    for (let y = 0; y < ARENA.h; y += T) {
      for (let x = 0; x < ARENA.w; x += T) {
        const checker = ((x / T + y / T) & 1) ? 0.035 : 0;
        const v = (rnd() - 0.5) * 0.05;
        const a = checker + v;
        g.fillStyle = a >= 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`;
        g.fillRect(x + 1, y + 1, T - 2, T - 2);
      }
    }
    // mortar lines
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= ARENA.w; x += T) { g.moveTo(x, 0); g.lineTo(x, ARENA.h); }
    for (let y = 0; y <= ARENA.h; y += T) { g.moveTo(0, y); g.lineTo(ARENA.w, y); }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 1; x <= ARENA.w; x += T) { g.moveTo(x, 0); g.lineTo(x, ARENA.h); }
    for (let y = 1; y <= ARENA.h; y += T) { g.moveTo(0, y); g.lineTo(ARENA.w, y); }
    g.stroke();

    // dirt blotches
    for (let i = 0; i < 14; i++) {
      const x = rnd() * ARENA.w, y = rnd() * ARENA.h, r = 60 + rnd() * 140;
      const bg = g.createRadialGradient(x, y, 0, x, y, r);
      bg.addColorStop(0, `rgba(0,0,0,${0.12 + rnd() * 0.12})`);
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = bg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // cracks
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 12; i++) {
      let x = rnd() * ARENA.w, y = rnd() * ARENA.h;
      let a = rnd() * TAU;
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
    // speckles
    for (let i = 0; i < 1400; i++) {
      const x = rnd() * ARENA.w, y = rnd() * ARENA.h;
      const light = rnd() < 0.5;
      g.fillStyle = light ? `rgba(255,255,255,${0.03 + rnd() * 0.07})` : `rgba(0,0,0,${0.1 + rnd() * 0.2})`;
      const s = 1 + rnd() * 2;
      g.fillRect(x, y, s, s);
    }

    // arena wall: a stone band around the edge with a lit inner bevel
    const WALL = 12;
    g.fillStyle = '#262b3d';
    g.fillRect(0, 0, ARENA.w, WALL); g.fillRect(0, ARENA.h - WALL, ARENA.w, WALL);
    g.fillRect(0, 0, WALL, ARENA.h); g.fillRect(ARENA.w - WALL, 0, WALL, ARENA.h);
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2;
    g.strokeRect(1, 1, ARENA.w - 2, ARENA.h - 2);
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1.5;
    g.strokeRect(WALL - 0.75, WALL - 0.75, ARENA.w - WALL * 2 + 1.5, ARENA.h - WALL * 2 + 1.5);
    // inner shadow cast by the wall
    for (const [x, y, w, h, dir] of [
      [WALL, WALL, ARENA.w - WALL * 2, 26, 'd'], [WALL, ARENA.h - WALL - 26, ARENA.w - WALL * 2, 26, 'u'],
      [WALL, WALL, 26, ARENA.h - WALL * 2, 'r'], [ARENA.w - WALL - 26, WALL, 26, ARENA.h - WALL * 2, 'l'],
    ]) {
      const lg = dir === 'd' ? g.createLinearGradient(0, y, 0, y + h)
        : dir === 'u' ? g.createLinearGradient(0, y + h, 0, y)
        : dir === 'r' ? g.createLinearGradient(x, 0, x + w, 0)
        : g.createLinearGradient(x + w, 0, x, 0);
      lg.addColorStop(0, 'rgba(0,0,0,0.45)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = lg;
      g.fillRect(x, y, w, h);
    }
    // wall blocks
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.5;
    g.beginPath();
    for (let x = T; x < ARENA.w; x += T) { g.moveTo(x, 0); g.lineTo(x, WALL); g.moveTo(x + T / 2, ARENA.h - WALL); g.lineTo(x + T / 2, ARENA.h); }
    for (let y = T; y < ARENA.h; y += T) { g.moveTo(0, y); g.lineTo(WALL, y); g.moveTo(ARENA.w - WALL, y + T / 2); g.lineTo(ARENA.w, y + T / 2); }
    g.stroke();
    // corner braziers
    for (const [cx, cy] of [[WALL + 22, WALL + 22], [ARENA.w - WALL - 22, WALL + 22], [WALL + 22, ARENA.h - WALL - 22], [ARENA.w - WALL - 22, ARENA.h - WALL - 22]]) {
      const bg = g.createRadialGradient(cx, cy, 2, cx, cy, 120);
      bg.addColorStop(0, 'rgba(255,190,110,0.28)');
      bg.addColorStop(1, 'rgba(255,190,110,0)');
      g.fillStyle = bg;
      g.fillRect(cx - 120, cy - 120, 240, 240);
      g.fillStyle = '#3a3040';
      g.beginPath(); g.arc(cx, cy, 9, 0, TAU); g.fill();
      g.fillStyle = '#ffb060';
      g.beginPath(); g.arc(cx, cy, 5, 0, TAU); g.fill();
      g.fillStyle = '#fff1c0';
      g.beginPath(); g.arc(cx, cy, 2.2, 0, TAU); g.fill();
    }
    this._floor = c;

    // decal layer (blood splats, scorch marks) lives at the same resolution
    const d = this._decal || document.createElement('canvas');
    d.width = W; d.height = H;
    const dg = d.getContext('2d');
    dg.scale(k, k);
    this._decal = d;
    this._decalCtx = dg;
  }

  /** Stamp a splat onto the decal layer. Fades out slowly on its own. */
  splat(x, y, r, col) {
    const g = this._decalCtx;
    if (!g) return;
    g.fillStyle = col;
    g.globalAlpha = 0.6;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * TAU, d = r * (0.6 + Math.random() * 0.9);
      g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.18 + Math.random() * 0.3), 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
  }

  scorch(x, y, r) {
    const g = this._decalCtx;
    if (!g) return;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(0,0,0,0.6)');
    grd.addColorStop(0.7, 'rgba(20,10,5,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // ------------------------------------------------------------------- fx
  spawnFx(list) {
    for (const f of list) {
      switch (f.t) {
        case FX.HIT:
          this.burst(f.x, f.y, 4, '#ffd98a', 150, 0.22, 2, 'spark');
          break;
        case FX.EXPLODE:
          this.part({ kind: 'ring', x: f.x, y: f.y, r: 6, max: f.a, life: 0.4, maxLife: 0.4, col: '#ffb070' });
          this.part({ kind: 'glow', x: f.x, y: f.y, r: f.a * 0.6, life: 0.25, maxLife: 0.25, col: '#ffe0a0' });
          this.burst(f.x, f.y, 14, '#ff7a3c', 340, 0.5, 4, 'spark');
          this.burst(f.x, f.y, 10, '#ffd166', 220, 0.4, 3, 'dot');
          this.burst(f.x, f.y, 9, '#3a3a44', 70, 1.1, 10, 'smoke');
          this.scorch(f.x, f.y, f.a * 0.55);
          this.shake = Math.max(this.shake, 7);
          this.flash = Math.max(this.flash, 0.35);
          break;
        case FX.BEAM:
          this.part({ kind: 'beam', x: f.x, y: f.y, x2: f.x2, y2: f.y2, life: 0.18, maxLife: 0.18, col: '#9ee6ff', seed: Math.random() * 1000 });
          this.burst(f.x2, f.y2, 4, '#c8f4ff', 120, 0.25, 2, 'spark');
          break;
        case FX.LEVELUP:
          this.part({ kind: 'ring', x: f.x, y: f.y, r: 8, max: 90, life: 0.6, maxLife: 0.6, col: '#ffe066' });
          this.burst(f.x, f.y, 18, '#ffe066', 160, 0.9, 3, 'rise');
          this.float({ x: f.x, y: f.y - 34, text: 'LEVEL UP', col: '#ffe066', life: 1.1, maxLife: 1.1, size: 20, vy: -26 });
          break;
        case FX.PICKUP:
          this.burst(f.x, f.y, 4, '#8dffb0', 90, 0.3, 2, 'rise');
          break;
        case FX.DEATH: {
          // x2 carries enemy type + 1 (0 = a player went down)
          const def = f.x2 > 0 ? ENEMIES[f.x2 - 1] : null;
          const col = def ? def.color : '#8b90a0';
          const r = f.a / 2;
          this.burst(f.x, f.y, Math.min(22, 6 + f.a / 5), col, 200, 0.5, 3, 'dot');
          this.burst(f.x, f.y, Math.min(8, 3 + f.a / 12), shade(col, -0.3), 120, 0.7, 5, 'chunk');
          if (def) this.splat(f.x, f.y, Math.max(6, r * 0.7), shade(col, -0.25));
          if (def?.boss) {
            this.part({ kind: 'ring', x: f.x, y: f.y, r: 10, max: 220, life: 0.8, maxLife: 0.8, col });
            this.shake = Math.max(this.shake, 12);
            this.flash = Math.max(this.flash, 0.5);
          }
          break;
        }
        case FX.HEAL:
          this.float({ x: f.x, y: f.y - 26, text: '+', col: '#8dffb0', life: 0.6, maxLife: 0.6, size: 18, vy: -40 });
          this.burst(f.x, f.y, 3, '#8dffb0', 60, 0.5, 2, 'rise');
          break;
        case FX.DODGE:
          this.float({ x: f.x, y: f.y - 26, text: 'DODGE', col: '#7ec8ff', life: 0.7, maxLife: 0.7, size: 14, vy: -34 });
          break;
        case FX.DAMAGE: {
          const crit = f.x2 === 1;
          this.float({
            x: f.x + (Math.random() - 0.5) * 16, y: f.y, text: String(f.a),
            col: crit ? '#ffd166' : '#ffffff', life: crit ? 0.8 : 0.55,
            maxLife: crit ? 0.8 : 0.55, size: crit ? 21 : 13, vy: -46, crit,
          });
          break;
        }
        default: break;
      }
    }
  }

  part(p) {
    if (this.parts.length < MAX_PARTS) this.parts.push(p);
  }

  burst(x, y, n, col, spd, life, size, kind = 'dot') {
    // Thin the burst rather than refusing it: a half-density explosion still
    // reads as an explosion, an absent one does not.
    const head = MAX_PARTS - this.parts.length;
    if (head <= 0) return;
    if (n > head) n = head;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = spd * (0.4 + Math.random() * 0.6);
      this.parts.push({
        kind, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.6), maxLife: life, col, size,
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 12,
      });
    }
  }

  float(f) {
    if (!this.opt.floats) return;
    if (this.floats.length >= MAX_FLOATS) this.floats.shift();
    this.floats.push(f);
  }

  stepFx(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      switch (p.kind) {
        case 'dot': case 'spark':
          p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9;
          break;
        case 'chunk':
          p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy = p.vy * 0.93 + 260 * dt; p.rot += p.vr * dt;
          break;
        case 'smoke':
          p.x += p.vx * dt; p.y += p.vy * dt - 18 * dt; p.vx *= 0.96; p.vy *= 0.96; p.size += 14 * dt;
          break;
        case 'rise':
          p.x += p.vx * dt * 0.3; p.y += p.vy * dt * 0.3 - 55 * dt;
          break;
        case 'ring':
          p.r += (p.max - p.r) * Math.min(1, dt * 9);
          break;
        default: break;
      }
    }
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dt;
      if (f.life <= 0) { this.floats.splice(i, 1); continue; }
      f.y += f.vy * dt;
      f.vy *= 0.94;
    }
    this.shake *= Math.pow(0.0015, dt);
    if (this.shake < 0.2) this.shake = 0;
    this.flash = Math.max(0, this.flash - dt * 2.2);

    for (const m of this.motes) {
      m.x += m.vx * dt + Math.sin(this.t * 0.7 + m.ph) * 6 * dt;
      m.y += m.vy * dt;
      if (m.y < -4) { m.y = ARENA.h + 4; m.x = Math.random() * ARENA.w; }
      if (m.x < -4) m.x = ARENA.w + 4; else if (m.x > ARENA.w + 4) m.x = -4;
    }

    // Decals fade by punching a little transparency into the layer.
    this.decalFade += dt;
    if (this.decalFade > 0.15 && this._decalCtx) {
      this.decalFade = 0;
      const g = this._decalCtx;
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.03)';
      g.fillRect(0, 0, ARENA.w, ARENA.h);
      g.globalCompositeOperation = 'source-over';
    }
  }

  // ----------------------------------------------------------------- draw
  draw(view, ctxInfo, dt) {
    const g = this.ctx;
    this.t += dt;
    this.dt = dt;
    this.stepFx(dt);

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, this.c.clientWidth, this.c.clientHeight);

    const amp = this.opt.shake ? this.shake : 0;
    const sx = amp ? (Math.random() - 0.5) * amp : 0;
    const sy = amp ? (Math.random() - 0.5) * amp : 0;
    g.save();
    g.translate(this.ox + sx, this.oy + sy);
    g.scale(this.scale, this.scale);

    this.drawFloor(ctxInfo);

    if (!view) {
      this.drawMenuScene();
      this.drawMotes();
      this.drawVignette(0);
      g.restore();
      return;
    }

    this.heavyProj = view.projs.length > TRAIL_PROJ_LIMIT;
    this.watching = ctxInfo?.watching || 0;

    this.drawShadows(view);
    for (const p of view.pickups) this.drawPickup(p);
    if (view.spawns) for (const e of view.spawns) drawSpawnMark(g, e.x, e.y, 1, this.t, e.flags & 1);
    for (const b of view.projs) if (b.flags & 1) this.drawProj(b);
    for (const e of view.enemies) this.drawEnemy(e);
    for (const p of view.players) this.drawPlayer(p, ctxInfo);
    for (const b of view.projs) if (!(b.flags & 1)) this.drawProj(b);
    this.drawParticles();
    this.drawMotes();
    this.drawFloats();
    this.drawVignette(ctxInfo?.danger || 0);

    // Prune walk-tracking for players who left.
    if (this.trk.size > view.players.length) {
      const alive = new Set(view.players.map((p) => p.id));
      for (const id of this.trk.keys()) if (!alive.has(id)) this.trk.delete(id);
    }

    g.restore();

    if (this.flash > 0) {
      g.fillStyle = `rgba(255,240,220,${this.flash * 0.3})`;
      g.fillRect(0, 0, this.c.clientWidth, this.c.clientHeight);
    }
  }

  drawFloor(info) {
    const g = this.ctx;
    g.drawImage(this._floor, 0, 0, ARENA.w, ARENA.h);
    g.drawImage(this._decal, 0, 0, ARENA.w, ARENA.h);

    // Wall pulses red as the wave timer runs down.
    const danger = info?.danger || 0;
    if (danger > 0.02) {
      const pulse = 0.6 + 0.4 * Math.sin(this.t * (3 + danger * 6));
      g.strokeStyle = `rgba(255,${Math.round(90 - danger * 60)},${Math.round(90 - danger * 70)},${danger * (0.35 + pulse * 0.45)})`;
      g.lineWidth = 6;
      g.strokeRect(3, 3, ARENA.w - 6, ARENA.h - 6);
    }
  }

  drawVignette(danger) {
    const g = this.ctx;
    if (!this._vig) {
      const v = g.createRadialGradient(ARENA.w / 2, ARENA.h / 2, ARENA.h * 0.45, ARENA.w / 2, ARENA.h / 2, ARENA.w * 0.68);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.55)');
      this._vig = v;
      const d = g.createRadialGradient(ARENA.w / 2, ARENA.h / 2, ARENA.h * 0.35, ARENA.w / 2, ARENA.h / 2, ARENA.w * 0.62);
      d.addColorStop(0, 'rgba(255,30,50,0)');
      d.addColorStop(1, 'rgba(255,30,50,0.45)');
      this._dangerVig = d;
    }
    g.fillStyle = this._vig;
    g.fillRect(0, 0, ARENA.w, ARENA.h);
    if (danger > 0.7) {
      g.globalAlpha = (danger - 0.7) / 0.3 * (0.4 + 0.3 * Math.sin(this.t * 5));
      g.fillStyle = this._dangerVig;
      g.fillRect(0, 0, ARENA.w, ARENA.h);
      g.globalAlpha = 1;
    }
  }

  drawMotes() {
    const g = this.ctx;
    g.fillStyle = 'rgba(255,235,200,0.16)';
    g.beginPath();
    for (const m of this.motes) {
      g.moveTo(m.x + m.r, m.y);
      g.arc(m.x, m.y, m.r, 0, TAU);
    }
    g.fill();
  }

  /** All ground shadows in a single fill - one path, one call. */
  drawShadows(view) {
    const g = this.ctx;
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.beginPath();
    for (const e of view.enemies) {
      const def = ENEMIES[e.type] || ENEMIES[0];
      const r = def.r * (e.flags & 1 ? 1.5 : 1);
      g.moveTo(e.x + r * 0.95, e.y + r * 0.8);
      g.ellipse(e.x, e.y + r * 0.8, r * 0.95, r * 0.36, 0, 0, TAU);
    }
    for (const p of view.players) {
      if (p.flags & 1) continue;
      g.moveTo(p.x + PLAYER_R * 1.05, p.y + PLAYER_R * 1.0);
      g.ellipse(p.x, p.y + PLAYER_R * 1.0, PLAYER_R * 1.05, PLAYER_R * 0.36, 0, 0, TAU);
    }
    g.fill();
  }

  drawPickup(p) {
    const g = this.ctx;
    const bob = Math.sin(this.t * 6 + p.id) * 2.5;
    const y = p.y + bob;
    // soft ground glow
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath(); g.ellipse(p.x, p.y + 9, 7, 2.5, 0, 0, TAU); g.fill();
    if (p.type === 0) {
      // faceted crystal
      const s = pickupSprite(0);
      blit(g, s, p.x, y, Math.sin(this.t * 2 + p.id) * 0.25);
    } else {
      const s = pickupSprite(1);
      const pulse = 1 + Math.sin(this.t * 7 + p.id) * 0.08;
      blit(g, s, p.x, y, 0, pulse, pulse);
    }
  }

  drawEnemy(e) {
    const g = this.ctx;
    const def = ENEMIES[e.type] || ENEMIES[0];
    const elite = e.flags & 1;
    const hit = e.flags & 2;
    const windup = e.flags & 4;
    const r = def.r * (elite ? 1.5 : 1);

    if (windup) {
      g.strokeStyle = 'rgba(255,80,80,0.85)';
      g.lineWidth = 3;
      g.setLineDash([6, 5]);
      g.beginPath(); g.arc(e.x, e.y, r + 9 + Math.sin(this.t * 30) * 3, this.t * 4, this.t * 4 + TAU); g.stroke();
      g.setLineDash([]);
      // charge direction hint
      g.strokeStyle = 'rgba(255,120,120,0.5)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(e.x + Math.cos(e.ang) * (r + 6), e.y + Math.sin(e.ang) * (r + 6));
      g.lineTo(e.x + Math.cos(e.ang) * (r + 60), e.y + Math.sin(e.ang) * (r + 60));
      g.stroke();
    }

    // squash-and-stretch breathing, phase-shifted per enemy so a crowd shimmers
    const ph = this.t * (def.name === 'Swarmer' ? 22 : def.name === 'Runner' ? 12 : 6) + e.id * 1.7;
    const w = Math.sin(ph) * (def.name === 'Exploder' ? 0.08 : 0.045);
    const s = enemySprite(e.type, elite, hit);
    blit(g, s, e.x, e.y, e.ang, 1 + w, 1 - w);

    if (e.hpPct < 255) {
      const bw = Math.max(22, r * 2.2);
      const by = e.y - r - 12;
      g.fillStyle = 'rgba(0,0,0,0.65)';
      roundRect(g, e.x - bw / 2 - 1, by - 1, bw + 2, 6, 3); g.fill();
      g.fillStyle = def.boss ? '#ff3b6b' : elite ? '#ffc857' : '#7ee081';
      const fw = bw * (e.hpPct / 255);
      if (fw > 0.5) { roundRect(g, e.x - bw / 2, by, fw, 4, 2); g.fill(); }
    }
    if (elite && !def.boss) {
      g.fillStyle = '#ffc857';
      g.font = 'bold 11px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText('ELITE', e.x, e.y - r - 17);
    }
    if (def.boss) {
      g.font = 'bold 14px system-ui, sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.strokeText(def.name.toUpperCase(), e.x, e.y - r - 20);
      g.fillStyle = '#ff5c7a';
      g.fillText(def.name.toUpperCase(), e.x, e.y - r - 20);
    }
  }

  drawPlayer(p, info) {
    const g = this.ctx;
    const ch = CHARACTERS[p.char] || CHARACTERS[0];
    const dead = p.flags & 1;
    const hurt = p.flags & 2;
    const inv = p.flags & 4;
    const isMe = info && p.id === info.pid;
    const watched = this.watching && p.id === this.watching;
    const name = info?.roster?.get(p.id)?.name || '';

    if (dead) {
      g.globalAlpha = 0.6;
      blit(g, deadSprite(), p.x, p.y + 4, 0);
      g.globalAlpha = 1;
      g.fillStyle = '#8b90a0';
      g.font = 'bold 12px system-ui, sans-serif';
      g.textAlign = 'center';
      g.fillText(`${name} (down)`, p.x, p.y - 22);
      return;
    }

    // walk cycle: bob and squash driven by how far the player moved this frame
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
    const lean = Math.sign(dx) * Math.min(0.18, Math.abs(dx) * 0.02) * moving;

    if (isMe || watched) {
      g.strokeStyle = watched ? 'rgba(255,200,87,0.75)' : 'rgba(255,255,255,0.22)';
      g.lineWidth = watched ? 2.5 : 2;
      g.setLineDash([5, 7]);
      g.beginPath(); g.arc(p.x, p.y + 2, 24, this.t * 1.5, this.t * 1.5 + TAU); g.stroke();
      g.setLineDash([]);
    }

    if (inv && !hurt) g.globalAlpha = 0.55 + Math.sin(this.t * 40) * 0.25;

    const y = p.y - bob;
    blit(g, playerSprite(p.char, hurt), p.x, y, lean, 1 + sq, 1 - sq);
    paintFace(g, p.x, y, p.ang, PLAYER_R);
    paintWeapon(g, p.x, y, p.ang, ch.weapon, PLAYER_R);
    g.globalAlpha = 1;

    // health bar + name
    const w = 42;
    const by = p.y - 29;
    g.fillStyle = 'rgba(0,0,0,0.65)';
    roundRect(g, p.x - w / 2 - 1, by - 1, w + 2, 7, 3.5); g.fill();
    const hp = Math.max(0, p.hp / p.maxHp);
    g.fillStyle = hp < 0.3 ? '#ff5c5c' : hp < 0.6 ? '#ffc857' : '#7ee081';
    if (hp > 0.02) { roundRect(g, p.x - w / 2, by, w * hp, 5, 2.5); g.fill(); }
    if (name) {
      g.font = `bold ${isMe || watched ? 13 : 12}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.strokeText(name, p.x, p.y - 34);
      g.fillStyle = watched ? '#ffc857' : isMe ? '#ffffff' : 'rgba(220,225,240,0.85)';
      g.fillText(name, p.x, p.y - 34);
    }
  }

  drawProj(b) {
    const g = this.ctx;
    const kind = PROJ_KINDS[b.type] || 'bullet';
    if (kind === 'swing') {
      const r = b.size;
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.ang);
      // crescent blade: bright leading edge, fading trailing sweep
      const grd = g.createLinearGradient(0, -r, 0, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.0)');
      grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0.0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(0, 0, r * 0.95, -0.55, 0.55);
      g.arc(0, 0, r * 0.45, 0.55, -0.55, true);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 4;
      g.lineCap = 'round';
      g.beginPath(); g.arc(0, 0, r * 0.9, -0.38, 0.38); g.stroke();
      g.lineCap = 'butt';
      g.restore();
      return;
    }

    const col = b.flags & 2 ? '#ffd166' : (PROJ_COLOR[kind] || '#ffe9a8');
    const cos = Math.cos(b.ang), sin = Math.sin(b.ang);

    // trail: a fading streak behind the projectile along its heading
    if (!this.heavyProj && TRAIL_LEN[kind]) {
      const L = TRAIL_LEN[kind];
      g.strokeStyle = col;
      g.globalAlpha = 0.28;
      g.lineWidth = kind === 'laser' ? 6 : 4;
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(b.x - cos * L, b.y - sin * L); g.lineTo(b.x, b.y); g.stroke();
      g.lineCap = 'butt';
      g.globalAlpha = 1;
    }

    switch (kind) {
      case 'laser': {
        g.save(); g.translate(b.x, b.y); g.rotate(b.ang);
        g.fillStyle = rgba(col, 0.35);
        roundRect(g, -20, -3.5, 40, 7, 3.5); g.fill();
        g.fillStyle = '#ffffff';
        roundRect(g, -18, -1.2, 36, 2.4, 1.2); g.fill();
        g.restore();
        break;
      }
      case 'rocket': {
        g.save(); g.translate(b.x, b.y); g.rotate(b.ang);
        // exhaust flame, flickering
        const fl = 8 + Math.random() * 8;
        g.fillStyle = 'rgba(255,170,60,0.9)';
        g.beginPath(); g.moveTo(-10, -3.5); g.lineTo(-10 - fl, 0); g.lineTo(-10, 3.5); g.closePath(); g.fill();
        g.fillStyle = '#fff3c0';
        g.beginPath(); g.moveTo(-10, -1.5); g.lineTo(-10 - fl * 0.5, 0); g.lineTo(-10, 1.5); g.closePath(); g.fill();
        // body
        g.fillStyle = '#3a3f55'; g.strokeStyle = '#15171f'; g.lineWidth = 1;
        roundRect(g, -10, -4, 18, 8, 2); g.fill(); g.stroke();
        g.fillStyle = col;
        g.beginPath(); g.moveTo(8, -4); g.lineTo(15, 0); g.lineTo(8, 4); g.closePath(); g.fill();
        g.fillStyle = col;
        g.fillRect(-10, -6, 4, 2); g.fillRect(-10, 4, 4, 2);
        g.restore();
        // smoke puffs behind
        if (Math.random() < 0.6) this.part({ kind: 'smoke', x: b.x - cos * 14, y: b.y - sin * 14, vx: -cos * 30, vy: -sin * 30, life: 0.7, maxLife: 0.7, col: '#5a5a66', size: 5 });
        break;
      }
      case 'flame': {
        const r = b.size + Math.random() * 3;
        g.globalAlpha = 0.7;
        g.fillStyle = '#ff5a2a';
        g.beginPath(); g.arc(b.x, b.y, r, 0, TAU); g.fill();
        g.fillStyle = '#ffb347';
        g.beginPath(); g.arc(b.x + (Math.random() - 0.5) * 3, b.y + (Math.random() - 0.5) * 3, r * 0.6, 0, TAU); g.fill();
        g.fillStyle = '#fff3b0';
        g.beginPath(); g.arc(b.x, b.y, r * 0.28, 0, TAU); g.fill();
        g.globalAlpha = 1;
        if (Math.random() < 0.25) this.part({ kind: 'smoke', x: b.x, y: b.y, vx: cos * 20, vy: sin * 20, life: 0.5, maxLife: 0.5, col: '#3a3038', size: 4 });
        break;
      }
      case 'star': {
        g.save(); g.translate(b.x, b.y); g.rotate(this.t * 22);
        g.fillStyle = col;
        g.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          const rr = i % 2 ? 4 : 10;
          const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath(); g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(0, 0, 2.5, 0, TAU); g.fill();
        g.restore();
        break;
      }
      case 'orb': {
        const pulse = 1 + Math.sin(this.t * 12 + b.id) * 0.15;
        g.fillStyle = rgba(col, 0.35);
        g.beginPath(); g.arc(b.x, b.y, 10 * pulse, 0, TAU); g.fill();
        g.fillStyle = col;
        g.beginPath(); g.arc(b.x, b.y, 6, 0, TAU); g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(b.x - 1.5, b.y - 1.5, 2.2, 0, TAU); g.fill();
        break;
      }
      case 'enemy': {
        g.fillStyle = 'rgba(255,92,122,0.35)';
        g.beginPath(); g.arc(b.x, b.y, b.size + 4, 0, TAU); g.fill();
        g.fillStyle = '#ff5c7a';
        g.beginPath(); g.arc(b.x, b.y, b.size, 0, TAU); g.fill();
        g.fillStyle = '#3a0a18';
        g.beginPath(); g.arc(b.x, b.y, b.size * 0.45, 0, TAU); g.fill();
        break;
      }
      case 'spit': {
        g.save(); g.translate(b.x, b.y); g.rotate(b.ang);
        g.fillStyle = col;
        g.beginPath(); g.ellipse(0, 0, b.size + 2, b.size * 0.75, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.beginPath(); g.arc(1, -b.size * 0.3, b.size * 0.3, 0, TAU); g.fill();
        g.restore();
        break;
      }
      case 'pellet': {
        g.save(); g.translate(b.x, b.y); g.rotate(b.ang);
        g.fillStyle = col;
        roundRect(g, -4, -2, 8, 4, 2); g.fill();
        g.restore();
        break;
      }
      default: {
        // bullet: glowing capsule with a white-hot tip
        g.save(); g.translate(b.x, b.y); g.rotate(b.ang);
        g.fillStyle = col;
        roundRect(g, -7, -2.2, 14, 4.4, 2.2); g.fill();
        g.fillStyle = '#ffffff';
        roundRect(g, 1, -1.2, 5, 2.4, 1.2); g.fill();
        g.restore();
      }
    }
  }

  drawParticles() {
    const g = this.ctx;
    for (const p of this.parts) {
      const a = Math.max(0, Math.min(1, p.life / p.maxLife));
      g.globalAlpha = a;
      switch (p.kind) {
        case 'dot':
          g.fillStyle = p.col;
          g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
          break;
        case 'spark': {
          // streak along velocity
          g.strokeStyle = p.col;
          g.lineWidth = p.size * 0.8;
          g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05); g.stroke();
          break;
        }
        case 'chunk':
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
          g.fillStyle = p.col;
          g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
          g.restore();
          break;
        case 'smoke':
          g.globalAlpha = a * 0.45;
          g.fillStyle = p.col;
          g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill();
          break;
        case 'rise':
          g.fillStyle = p.col;
          g.beginPath(); g.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, TAU); g.fill();
          break;
        case 'ring':
          g.strokeStyle = p.col;
          g.lineWidth = 3 * a + 1;
          g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.stroke();
          break;
        case 'glow': {
          const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          grd.addColorStop(0, p.col);
          grd.addColorStop(1, 'rgba(255,200,120,0)');
          g.fillStyle = grd;
          g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill();
          break;
        }
        case 'beam': {
          // jagged lightning: a polyline with deterministic jitter that shivers
          const dx = p.x2 - p.x, dy = p.y2 - p.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          const segs = Math.max(3, Math.min(9, Math.round(len / 28)));
          const rnd = mulberry((p.seed * 1000 + Math.floor(this.t * 30)) | 0);
          g.lineCap = 'round';
          for (const [w, colr] of [[7 + a * 4, rgba('#66d0ff', 0.35)], [2.2 + a * 2, '#ffffff']]) {
            g.strokeStyle = colr;
            g.lineWidth = w;
            g.beginPath(); g.moveTo(p.x, p.y);
            for (let i = 1; i < segs; i++) {
              const f = i / segs;
              const j = (rnd() - 0.5) * 22 * Math.sin(f * Math.PI);
              g.lineTo(p.x + dx * f + nx * j, p.y + dy * f + ny * j);
            }
            g.lineTo(p.x2, p.y2);
            g.stroke();
          }
          g.lineCap = 'butt';
          break;
        }
        default: break;
      }
    }
    g.globalAlpha = 1;
  }

  drawFloats() {
    const g = this.ctx;
    g.textAlign = 'center';
    // strokeText costs about as much as fillText, so the outline is the first
    // thing to go once the screen is already a wall of numbers.
    const outline = this.floats.length <= OUTLINE_LIMIT;
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    let font = '';
    for (const f of this.floats) {
      const a = f.life / f.maxLife;
      g.globalAlpha = Math.max(0, Math.min(1, a * 1.4));
      // crits pop: they land big and settle to their resting size
      const size = f.crit ? Math.round(f.size * (1 + Math.max(0, a - 0.75) * 2)) : f.size;
      const want = `bold ${size}px system-ui, sans-serif`;
      if (want !== font) { font = want; g.font = want; }
      if (outline) g.strokeText(f.text, f.x, f.y);
      g.fillStyle = f.col;
      g.fillText(f.text, f.x, f.y);
    }
    g.globalAlpha = 1;
  }

  // -------------------------------------------------------------- menu
  // Behind the main menu a few monsters and a potato wander around so the
  // title screen is not a dead grid.
  drawMenuScene() {
    if (!this.menuActors) {
      const rnd = mulberry(99);
      this.menuActors = [];
      for (let i = 0; i < 9; i++) {
        this.menuActors.push({
          kind: i === 0 ? 'player' : 'enemy', type: [0, 1, 2, 3, 4, 6, 7, 5][i % 8],
          x: rnd() * ARENA.w, y: rnd() * ARENA.h, ang: rnd() * TAU, spd: 25 + rnd() * 40, id: i,
          turn: (rnd() - 0.5) * 0.6,
        });
      }
    }
    const g = this.ctx;
    g.globalAlpha = 0.55;
    for (const a of this.menuActors) {
      a.ang += a.turn * this.dt + Math.sin(this.t * 0.5 + a.id) * 0.01;
      a.x += Math.cos(a.ang) * a.spd * this.dt;
      a.y += Math.sin(a.ang) * a.spd * this.dt;
      if (a.x < 40 || a.x > ARENA.w - 40 || a.y < 40 || a.y > ARENA.h - 40) {
        a.ang = Math.atan2(ARENA.h / 2 - a.y, ARENA.w / 2 - a.x) + (Math.random() - 0.5);
      }
      if (a.kind === 'enemy') {
        this.drawEnemy({ id: a.id, type: a.type, x: a.x, y: a.y, ang: a.ang, hpPct: 255, flags: 0 });
      } else {
        this.drawPlayer({ id: 200 + a.id, char: Math.floor(this.t / 6) % CHARACTERS.length, x: a.x, y: a.y, ang: a.ang, hp: 1, maxHp: 1, flags: 0 }, null);
      }
    }
    g.globalAlpha = 1;
  }
}

// ----------------------------------------------------------- pickups
function pickupSprite(type) {
  return sprite(`pk${type}`, 20, (g) => {
    if (type === 0) {
      g.shadowColor = '#8dffb0'; g.shadowBlur = 10 * SPR;
      g.fillStyle = '#5ee68f';
      g.strokeStyle = '#1f7a45'; g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, -9); g.lineTo(6, -2); g.lineTo(4, 8); g.lineTo(-4, 8); g.lineTo(-6, -2);
      g.closePath(); g.fill(); g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = '#c8ffd9';
      g.beginPath(); g.moveTo(0, -9); g.lineTo(6, -2); g.lineTo(0, 0); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath(); g.moveTo(-6, -2); g.lineTo(0, -9); g.lineTo(-1, -1); g.closePath(); g.fill();
    } else {
      g.shadowColor = '#ff5c7a'; g.shadowBlur = 12 * SPR;
      g.fillStyle = '#ff4d70';
      g.strokeStyle = '#8a1030'; g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(0, 9);
      g.bezierCurveTo(-11, 0, -9, -10, -2, -8);
      g.bezierCurveTo(0, -7, 0, -6, 0, -6);
      g.bezierCurveTo(0, -6, 0, -7, 2, -8);
      g.bezierCurveTo(9, -10, 11, 0, 0, 9);
      g.closePath(); g.fill(); g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.ellipse(-4, -3.5, 2.4, 1.6, -0.6, 0, TAU); g.fill();
    }
  });
}

const PROJ_COLOR = {
  bullet: '#ffe9a8', pellet: '#ffb37a', laser: '#66f0ff', rocket: '#ff9f6b',
  flame: '#ff7a45', orb: '#c39bff', star: '#c8e6ff', enemy: '#ff5c7a', spit: '#7ed957',
};

const TRAIL_LEN = { bullet: 22, pellet: 12, laser: 44, orb: 16, star: 14, enemy: 14, spit: 10 };

export { TIER_COLOR };

/**
 * The warning cross where an enemy is about to appear. Shared with the 3D
 * renderer's overlay so both display modes telegraph spawns identically.
 */
export function drawSpawnMark(g, x, y, k, t, elite) {
  const pulse = 0.75 + Math.sin(t * 14) * 0.25;
  const r = 11 * k;
  g.save();
  g.globalAlpha = pulse;
  g.strokeStyle = elite ? '#ffc857' : '#ff4d5e';
  g.lineWidth = 4 * k;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x - r, y - r); g.lineTo(x + r, y + r);
  g.moveTo(x + r, y - r); g.lineTo(x - r, y + r);
  g.stroke();
  g.restore();
}
