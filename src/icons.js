// ---------------------------------------------------------------------------
// Weapon silhouettes and item glyphs, drawn from primitives.
//
// Two consumers share this file: the arena renderer draws the held weapon in
// a player's hands, and the DOM UI draws the same shape into a <canvas> icon
// on shop cards, inventory rows and HUD chips. One source of truth means the
// thing you buy looks like the thing your potato is holding.
// ---------------------------------------------------------------------------

import { WEAPONS, ITEMS, TIER_COLOR } from './data.js';

const TAU = Math.PI * 2;

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

function hex2rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) {
  const [r, g, b] = hex2rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

const WOOD = '#6b4a30', WOOD_D = '#3f2a18';
const STEEL = '#3a4054', STEEL_D = '#1a1d28', STEEL_L = '#59607a';
const OUT = 'rgba(0,0,0,0.55)';

// ---------------------------------------------------------- weapons
/**
 * Paint weapon `id` pointing along +x, sized to a hand at radius r. The grip
 * sits around x = 0.5r so the shape reads as held when drawn on a body.
 */
export function paintWeaponShape(g, id, r) {
  const def = WEAPONS[id] || WEAPONS.pistol;
  const col = def.color || '#dfe9f5';
  g.lineJoin = 'round';
  g.strokeStyle = OUT;
  g.lineWidth = Math.max(0.8, r * 0.07);

  const blade = (x0, x1, w, tipLen = r * 0.35) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x0, -w); g.lineTo(x1 - tipLen, -w * 0.85); g.lineTo(x1, 0);
    g.lineTo(x1 - tipLen, w * 0.85); g.lineTo(x0, w);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(x0 + r * 0.1, -w * 0.5, (x1 - x0) * 0.7, w * 0.35);
  };
  const handle = (x0, len, w, colr = WOOD) => {
    g.fillStyle = colr;
    roundRect(g, x0, -w, len, w * 2, w * 0.6); g.fill(); g.stroke();
  };
  const guard = (x, w, h, colr = '#c9a86a') => {
    g.fillStyle = colr;
    roundRect(g, x - w / 2, -h, w, h * 2, w * 0.4); g.fill(); g.stroke();
  };
  const gunBody = (x0, len, h, colr = STEEL) => {
    g.fillStyle = colr;
    roundRect(g, x0, -h, len, h * 2, r * 0.12); g.fill(); g.stroke();
  };
  const barrel = (x0, len, h, colr = STEEL_L) => {
    g.fillStyle = colr;
    roundRect(g, x0, -h, len, h * 2, h * 0.8); g.fill(); g.stroke();
  };
  const grip = (x0, colr = WOOD) => {
    g.fillStyle = colr;
    roundRect(g, x0, r * 0.15, r * 0.36, r * 0.6, r * 0.08); g.fill(); g.stroke();
  };
  const accent = (x0, len, y = -r * 0.24, h = r * 0.12) => {
    g.fillStyle = col;
    roundRect(g, x0, y, len, h, h / 2); g.fill();
  };
  const glow = (x0, len, h) => {
    g.save();
    g.shadowColor = col; g.shadowBlur = r * 0.6;
    g.fillStyle = col;
    roundRect(g, x0, -h, len, h * 2, h); g.fill();
    g.restore();
  };

  switch (id) {
    case 'knife':
      handle(r * 0.35, r * 0.6, r * 0.16);
      guard(r * 0.95, r * 0.14, r * 0.3);
      blade(r * 1.0, r * 2.2, r * 0.19);
      break;
    case 'sword':
      handle(r * 0.3, r * 0.6, r * 0.15, WOOD_D);
      g.fillStyle = '#c9a86a'; g.beginPath(); g.arc(r * 0.3, 0, r * 0.15, 0, TAU); g.fill(); g.stroke();
      guard(r * 0.95, r * 0.16, r * 0.5);
      blade(r * 1.0, r * 2.75, r * 0.24, r * 0.45);
      break;
    case 'spear':
      handle(r * 0.2, r * 2.0, r * 0.09, WOOD);
      g.fillStyle = '#c9a86a'; roundRect(g, r * 2.05, -r * 0.14, r * 0.2, r * 0.28, r * 0.05); g.fill();
      blade(r * 2.2, r * 3.05, r * 0.22, r * 0.45);
      break;
    case 'hammer':
      handle(r * 0.35, r * 1.5, r * 0.13);
      g.fillStyle = col;
      roundRect(g, r * 1.7, -r * 0.6, r * 0.8, r * 1.2, r * 0.12); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(g, r * 1.8, -r * 0.5, r * 0.25, r * 1.0, r * 0.08); g.fill();
      break;
    case 'scythe':
      handle(r * 0.2, r * 1.9, r * 0.1, WOOD_D);
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(r * 2.0, -r * 0.1);
      g.quadraticCurveTo(r * 2.9, -r * 0.2, r * 2.7, -r * 1.25);
      g.quadraticCurveTo(r * 2.75, -r * 0.35, r * 2.0, r * 0.22);
      g.closePath(); g.fill(); g.stroke();
      break;
    case 'smg':
      gunBody(r * 0.45, r * 1.35, r * 0.3);
      barrel(r * 1.75, r * 0.6, r * 0.13);
      g.fillStyle = STEEL_D; roundRect(g, r * 0.95, r * 0.2, r * 0.3, r * 0.75, r * 0.06); g.fill(); g.stroke();
      grip(r * 0.5, STEEL_D);
      accent(r * 0.6, r * 1.0);
      break;
    case 'shotgun':
      handle(r * 0.1, r * 0.7, r * 0.26, WOOD);
      gunBody(r * 0.75, r * 0.8, r * 0.28);
      barrel(r * 1.5, r * 1.3, r * 0.12, STEEL);
      g.fillStyle = STEEL; roundRect(g, r * 1.5, r * 0.02, r * 1.3, r * 0.22, r * 0.1); g.fill(); g.stroke();
      g.fillStyle = WOOD; roundRect(g, r * 1.5, r * 0.22, r * 0.7, r * 0.18, r * 0.06); g.fill(); g.stroke();
      accent(r * 0.85, r * 0.5);
      break;
    case 'shuriken': {
      g.save(); g.translate(r * 1.3, 0);
      g.fillStyle = col;
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        const rr = i % 2 ? r * 0.25 : r * 0.8;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = STEEL_D; g.beginPath(); g.arc(0, 0, r * 0.14, 0, TAU); g.fill();
      g.restore();
      break;
    }
    case 'wand':
      handle(r * 0.3, r * 1.7, r * 0.08, '#4a3a5e');
      g.save();
      g.shadowColor = col; g.shadowBlur = r * 0.8;
      g.fillStyle = col;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU - Math.PI / 2;
        const rr = i % 2 ? r * 0.18 : r * 0.42;
        const x = r * 2.2 + Math.cos(a) * rr, y = Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill();
      g.restore();
      break;
    case 'flamer':
      g.fillStyle = '#8a2f1f'; roundRect(g, r * 0.35, -r * 0.42, r * 0.7, r * 0.84, r * 0.2); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.2)'; roundRect(g, r * 0.45, -r * 0.32, r * 0.2, r * 0.64, r * 0.1); g.fill();
      gunBody(r * 1.0, r * 0.7, r * 0.22);
      barrel(r * 1.65, r * 0.7, r * 0.1, STEEL);
      g.fillStyle = '#ff9a3c';
      g.beginPath(); g.moveTo(r * 2.35, -r * 0.2); g.quadraticCurveTo(r * 2.9, -r * 0.1, r * 2.75, 0);
      g.quadraticCurveTo(r * 2.9, r * 0.1, r * 2.35, r * 0.2); g.closePath(); g.fill();
      g.fillStyle = '#fff1b0'; g.beginPath(); g.arc(r * 2.45, 0, r * 0.08, 0, TAU); g.fill();
      grip(r * 1.05, STEEL_D);
      break;
    case 'laser':
      gunBody(r * 0.4, r * 1.5, r * 0.26, STEEL_D);
      barrel(r * 1.85, r * 0.75, r * 0.1, STEEL);
      glow(r * 0.6, r * 1.9, r * 0.07);
      grip(r * 0.6, STEEL_D);
      break;
    case 'sniper':
      handle(r * 0.05, r * 0.6, r * 0.24, WOOD_D);
      gunBody(r * 0.6, r * 0.9, r * 0.22);
      barrel(r * 1.45, r * 1.65, r * 0.08, STEEL);
      // scope
      g.fillStyle = STEEL_D; roundRect(g, r * 0.75, -r * 0.55, r * 0.9, r * 0.24, r * 0.1); g.fill(); g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(r * 1.6, -r * 0.43, r * 0.09, 0, TAU); g.fill();
      grip(r * 0.7, WOOD_D);
      break;
    case 'rocket':
      g.fillStyle = '#4a5068'; roundRect(g, r * 0.3, -r * 0.42, r * 2.2, r * 0.84, r * 0.3); g.fill(); g.stroke();
      g.fillStyle = STEEL_D; roundRect(g, r * 2.3, -r * 0.5, r * 0.3, r * 1.0, r * 0.1); g.fill(); g.stroke();
      // rocket nose peeking out
      g.fillStyle = col; g.beginPath(); g.moveTo(r * 2.55, -r * 0.3); g.lineTo(r * 3.0, 0); g.lineTo(r * 2.55, r * 0.3); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.18)'; roundRect(g, r * 0.5, -r * 0.3, r * 1.7, r * 0.2, r * 0.1); g.fill();
      grip(r * 1.0, STEEL_D);
      break;
    case 'minigun':
      gunBody(r * 0.3, r * 1.0, r * 0.4, STEEL_D);
      for (const y of [-r * 0.26, 0, r * 0.26]) { g.save(); g.translate(0, y); barrel(r * 1.2, r * 1.5, r * 0.1, STEEL); g.restore(); }
      g.fillStyle = STEEL_L; roundRect(g, r * 2.2, -r * 0.4, r * 0.18, r * 0.8, r * 0.06); g.fill(); g.stroke();
      accent(r * 0.45, r * 0.6, -r * 0.1, r * 0.2);
      grip(r * 0.45, STEEL_D);
      break;
    case 'tesla':
      handle(r * 0.35, r * 0.7, r * 0.16, STEEL_D);
      g.fillStyle = '#b87333';
      for (let i = 0; i < 4; i++) { roundRect(g, r * (1.1 + i * 0.28), -r * 0.36, r * 0.18, r * 0.72, r * 0.05); g.fill(); g.stroke(); }
      g.save();
      g.shadowColor = col; g.shadowBlur = r * 0.9;
      g.fillStyle = col; g.beginPath(); g.arc(r * 2.5, 0, r * 0.3, 0, TAU); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = r * 0.08;
      g.beginPath(); g.moveTo(r * 2.55, -r * 0.55); g.lineTo(r * 2.75, -r * 0.2); g.lineTo(r * 2.6, -r * 0.2); g.lineTo(r * 2.85, r * 0.2); g.stroke();
      g.restore();
      break;
    default: // pistol
      gunBody(r * 0.45, r * 1.15, r * 0.27);
      barrel(r * 1.5, r * 0.75, r * 0.15);
      grip(r * 0.6);
      accent(r * 0.6, r * 0.85);
  }
}

// ------------------------------------------------------------ items
// Item glyphs are drawn in a 2x2 unit box centred on the origin; `c` is the
// tier colour, `lt` a light fill for the object itself.
const GLYPH = {
  boot(g, c, lt) {
    g.fillStyle = lt;
    g.beginPath();
    g.moveTo(-0.45, -0.85); g.lineTo(0.1, -0.85); g.lineTo(0.1, 0.05); g.lineTo(0.8, 0.35);
    g.quadraticCurveTo(0.95, 0.5, 0.8, 0.7); g.lineTo(-0.45, 0.7); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = c; roundRect(g, -0.45, 0.45, 1.3, 0.25, 0.08); g.fill();
    g.strokeStyle = c; g.lineWidth = 0.08;
    g.beginPath(); g.moveTo(-0.3, -0.55); g.lineTo(0, -0.55); g.moveTo(-0.3, -0.3); g.lineTo(0, -0.3); g.stroke();
  },
  shield(g, c, lt, star) {
    g.fillStyle = lt;
    g.beginPath();
    g.moveTo(0, -0.9); g.lineTo(0.8, -0.6); g.quadraticCurveTo(0.8, 0.45, 0, 0.9);
    g.quadraticCurveTo(-0.8, 0.45, -0.8, -0.6); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(0, -0.65); g.lineTo(0.55, -0.45); g.quadraticCurveTo(0.55, 0.3, 0, 0.62);
    g.quadraticCurveTo(-0.55, 0.3, -0.55, -0.45); g.closePath(); g.fill();
    if (star) {
      g.fillStyle = '#fff';
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU - Math.PI / 2;
        const rr = i % 2 ? 0.13 : 0.3;
        const x = Math.cos(a) * rr, y = -0.05 + Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill();
    } else {
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(-0.06, -0.5, 0.12, 0.95); g.fillRect(-0.4, -0.15, 0.8, 0.12);
    }
  },
  heart(g, c) {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(0, 0.85);
    g.bezierCurveTo(-1.1, 0.05, -0.9, -0.95, -0.15, -0.7);
    g.bezierCurveTo(0, -0.6, 0, -0.55, 0, -0.55);
    g.bezierCurveTo(0, -0.55, 0, -0.6, 0.15, -0.7);
    g.bezierCurveTo(0.9, -0.95, 1.1, 0.05, 0, 0.85);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.ellipse(-0.4, -0.35, 0.22, 0.14, -0.6, 0, TAU); g.fill();
  },
  fist(g, c, lt) {
    g.fillStyle = lt;
    roundRect(g, -0.75, -0.45, 1.3, 1.1, 0.3); g.fill(); g.stroke();
    g.fillStyle = c;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(-0.55 + i * 0.36, -0.5, 0.2, 0, TAU); g.fill(); g.stroke(); }
    g.fillStyle = lt; roundRect(g, 0.35, -0.2, 0.45, 0.75, 0.2); g.fill(); g.stroke();
  },
  crosshair(g, c, lt, dot) {
    g.strokeStyle = lt; g.lineWidth = 0.14;
    g.beginPath(); g.arc(0, 0, 0.68, 0, TAU); g.stroke();
    g.beginPath();
    g.moveTo(0, -0.95); g.lineTo(0, -0.4); g.moveTo(0, 0.4); g.lineTo(0, 0.95);
    g.moveTo(-0.95, 0); g.lineTo(-0.4, 0); g.moveTo(0.4, 0); g.lineTo(0.95, 0);
    g.stroke();
    g.fillStyle = dot ? '#ff4d5e' : c; g.beginPath(); g.arc(0, 0, dot ? 0.2 : 0.14, 0, TAU); g.fill();
  },
  flame(g, c) {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(0, -0.95);
    g.bezierCurveTo(0.7, -0.3, 0.85, 0.2, 0.55, 0.65);
    g.bezierCurveTo(0.35, 0.95, -0.35, 0.95, -0.55, 0.65);
    g.bezierCurveTo(-0.9, 0.15, -0.55, -0.35, -0.2, -0.45);
    g.bezierCurveTo(-0.25, -0.1, 0, 0, 0.1, -0.25);
    g.bezierCurveTo(0.15, -0.55, 0.05, -0.75, 0, -0.95);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fff3b0';
    g.beginPath(); g.moveTo(0, 0.05); g.bezierCurveTo(0.35, 0.3, 0.3, 0.7, 0, 0.75);
    g.bezierCurveTo(-0.3, 0.7, -0.35, 0.3, 0, 0.05); g.fill();
  },
  magnet(g, c) {
    g.strokeStyle = c; g.lineWidth = 0.42; g.lineCap = 'butt';
    g.beginPath(); g.arc(0, -0.1, 0.55, Math.PI, 0); g.stroke();
    g.beginPath(); g.moveTo(-0.55, -0.1); g.lineTo(-0.55, 0.55); g.moveTo(0.55, -0.1); g.lineTo(0.55, 0.55); g.stroke();
    g.fillStyle = '#e8ecf5'; g.fillRect(-0.76, 0.45, 0.42, 0.4); g.fillRect(0.34, 0.45, 0.42, 0.4);
    g.strokeStyle = OUT; g.lineWidth = 0.06; g.strokeRect(-0.76, 0.45, 0.42, 0.4); g.strokeRect(0.34, 0.45, 0.42, 0.4);
  },
  cup(g, c, lt) {
    g.fillStyle = lt; roundRect(g, -0.6, -0.4, 1.0, 1.2, 0.15); g.fill(); g.stroke();
    g.strokeStyle = lt; g.lineWidth = 0.18; g.beginPath(); g.arc(0.5, 0.1, 0.32, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.fillStyle = c; roundRect(g, -0.6, -0.4, 1.0, 0.3, 0.1); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 0.09; g.lineCap = 'round';
    for (const x of [-0.3, -0.05, 0.2]) { g.beginPath(); g.moveTo(x, -0.6); g.quadraticCurveTo(x + 0.15, -0.75, x, -0.95); g.stroke(); }
  },
  clover(g, c) {
    g.fillStyle = c;
    for (const [x, y] of [[0, -0.42], [0.42, 0], [-0.42, 0], [0, 0.42]]) { g.beginPath(); g.arc(x, y, 0.36, 0, TAU); g.fill(); }
    g.strokeStyle = c; g.lineWidth = 0.12; g.beginPath(); g.moveTo(0.05, 0.3); g.quadraticCurveTo(0.2, 0.7, 0.45, 0.9); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.arc(-0.12, -0.55, 0.12, 0, TAU); g.fill();
  },
  sickle(g, c, lt) {
    g.fillStyle = WOOD; roundRect(g, -0.15, 0.0, 0.3, 0.95, 0.1); g.fill(); g.stroke();
    g.fillStyle = lt;
    g.beginPath(); g.arc(0, -0.15, 0.8, Math.PI * 0.95, Math.PI * 2.05); g.arc(0, -0.15, 0.5, Math.PI * 2.05, Math.PI * 0.95, true); g.closePath(); g.fill(); g.stroke();
  },
  ribbon(g, c) {
    g.strokeStyle = c; g.lineWidth = 0.34; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-0.85, -0.5); g.bezierCurveTo(-0.2, -1.1, 0.2, 0.2, 0.85, -0.4); g.stroke();
    g.beginPath(); g.moveTo(-0.85, 0.5); g.bezierCurveTo(-0.2, -0.1, 0.2, 1.2, 0.85, 0.6); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 0.08;
    g.beginPath(); g.moveTo(-0.85, -0.5); g.bezierCurveTo(-0.2, -1.1, 0.2, 0.2, 0.85, -0.4); g.stroke();
  },
  stone(g, c, lt) {
    g.fillStyle = '#6a6f80'; roundRect(g, -0.85, -0.1, 1.7, 0.75, 0.2); g.fill(); g.stroke();
    g.fillStyle = lt;
    g.beginPath(); g.moveTo(-0.5, -0.1); g.lineTo(0.1, -0.95); g.lineTo(0.75, -0.7); g.lineTo(0.2, -0.1); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = c;
    for (const [x, y] of [[0.45, -0.35], [0.7, -0.15], [0.55, -0.55]]) { g.beginPath(); g.arc(x, y, 0.06, 0, TAU); g.fill(); }
  },
  atom(g, c) {
    g.strokeStyle = c; g.lineWidth = 0.1;
    for (const a of [0, TAU / 3, (2 * TAU) / 3]) { g.beginPath(); g.ellipse(0, 0, 0.9, 0.36, a, 0, TAU); g.stroke(); }
    g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 0.2, 0, TAU); g.fill();
    g.fillStyle = c; g.beginPath(); g.arc(0.62, -0.28, 0.1, 0, TAU); g.fill();
  },
  cross(g, c) {
    g.fillStyle = '#f2f4fa';
    roundRect(g, -0.85, -0.5, 1.7, 1.0, 0.15); g.fill(); g.stroke();
    g.fillStyle = c; roundRect(g, -0.15, -0.35, 0.3, 0.7, 0.06); g.fill(); roundRect(g, -0.35, -0.15, 0.7, 0.3, 0.06); g.fill();
  },
  fang(g, c) {
    for (const s of [-1, 1]) {
      g.fillStyle = '#f5f0ff';
      g.beginPath(); g.moveTo(s * 0.55, -0.85); g.lineTo(s * 0.15, -0.85); g.lineTo(s * 0.4, 0.55); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = c; g.beginPath(); g.arc(s * 0.4, 0.5, 0.14, 0, TAU); g.fill();
      g.fillStyle = c; g.globalAlpha = 0.7; g.beginPath(); g.ellipse(s * 0.4, 0.75, 0.1, 0.16, 0, 0, TAU); g.fill(); g.globalAlpha = 1;
    }
  },
  tube(g, c, lt) {
    g.save(); g.rotate(-0.6);
    g.fillStyle = STEEL_L; roundRect(g, -1.0, -0.22, 2.0, 0.44, 0.2); g.fill(); g.stroke();
    g.fillStyle = c; roundRect(g, -0.5, -0.3, 0.3, 0.6, 0.08); g.fill(); g.stroke(); roundRect(g, 0.5, -0.3, 0.3, 0.6, 0.08); g.fill(); g.stroke();
    g.fillStyle = STEEL_D; g.beginPath(); g.ellipse(0.98, 0, 0.1, 0.2, 0, 0, TAU); g.fill();
    g.restore();
  },
  die(g, c) {
    g.save(); g.rotate(0.35);
    g.fillStyle = '#f2f4fa'; roundRect(g, -0.65, -0.65, 1.3, 1.3, 0.22); g.fill(); g.stroke();
    g.fillStyle = c;
    for (const [x, y] of [[-0.35, -0.35], [0.35, -0.35], [0, 0], [-0.35, 0.35], [0.35, 0.35]]) { g.beginPath(); g.arc(x, y, 0.12, 0, TAU); g.fill(); }
    g.restore();
  },
  battery(g, c) {
    g.fillStyle = STEEL; roundRect(g, -0.45, -0.75, 0.9, 1.6, 0.15); g.fill(); g.stroke();
    g.fillStyle = STEEL_L; roundRect(g, -0.2, -0.95, 0.4, 0.25, 0.06); g.fill(); g.stroke();
    g.fillStyle = c; roundRect(g, -0.33, -0.05, 0.66, 0.72, 0.08); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0.1, -0.6); g.lineTo(-0.2, -0.05); g.lineTo(0.02, -0.05); g.lineTo(-0.1, 0.4); g.lineTo(0.22, -0.15); g.lineTo(0, -0.15); g.closePath(); g.fill();
  },
  gear(g, c, lt) {
    g.fillStyle = lt;
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const rr = i % 2 ? 0.7 : 0.92;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = c; g.beginPath(); g.arc(0, 0, 0.42, 0, TAU); g.fill(); g.stroke();
    g.fillStyle = '#0d1120'; g.beginPath(); g.arc(0, 0, 0.18, 0, TAU); g.fill();
  },
  prism(g, c) {
    g.fillStyle = c;
    g.beginPath(); g.moveTo(0, -0.9); g.lineTo(0.85, 0.65); g.lineTo(-0.85, 0.65); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.moveTo(0, -0.9); g.lineTo(0.3, 0.65); g.lineTo(-0.3, 0.65); g.closePath(); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = 0.08; g.lineCap = 'round';
    for (const [dy, colr] of [[-0.1, '#ff6b6b'], [0.1, '#ffe066'], [0.3, '#7ec8ff']]) { g.strokeStyle = colr; g.beginPath(); g.moveTo(0.2, 0.15 + dy * 0.4); g.lineTo(0.95, dy); g.stroke(); }
  },
  crown(g, c) {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(-0.85, 0.6); g.lineTo(-0.95, -0.55); g.lineTo(-0.45, -0.1); g.lineTo(0, -0.85); g.lineTo(0.45, -0.1); g.lineTo(0.95, -0.55); g.lineTo(0.85, 0.6);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ff3b6b';
    for (const [x, y] of [[-0.95, -0.55], [0, -0.85], [0.95, -0.55]]) { g.beginPath(); g.arc(x, y, 0.13, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(0,0,0,0.3)'; roundRect(g, -0.85, 0.35, 1.7, 0.25, 0.05); g.fill();
  },
  ghost(g, c) {
    g.fillStyle = c; g.globalAlpha = 0.9;
    g.beginPath();
    g.moveTo(-0.7, 0.8); g.lineTo(-0.7, -0.2); g.arc(0, -0.2, 0.7, Math.PI, 0); g.lineTo(0.7, 0.8);
    for (let i = 0; i < 3; i++) g.quadraticCurveTo(0.7 - (i + 0.5) * 0.47, 0.55, 0.7 - (i + 1) * 0.47, 0.8);
    g.closePath(); g.fill(); g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = '#0d1120'; for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 0.25, -0.25, 0.13, 0.2, 0, 0, TAU); g.fill(); }
  },
  seven(g, c) {
    g.fillStyle = c;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU - Math.PI / 2;
      const rr = i % 2 ? 0.45 : 0.95;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#1a1206'; g.font = 'bold 0.9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('7', 0, 0.08);
  },
  // ---- stat glyphs (no tile; drawn small next to a number)
  burst(g, c) {
    g.fillStyle = c;
    g.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const rr = i % 2 ? 0.45 : 0.9;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 0.22, 0, TAU); g.fill();
  },
  bolt(g, c) {
    g.fillStyle = c;
    g.beginPath();
    g.moveTo(0.15, -0.95); g.lineTo(-0.55, 0.1); g.lineTo(-0.05, 0.1); g.lineTo(-0.2, 0.95);
    g.lineTo(0.55, -0.15); g.lineTo(0.05, -0.15); g.closePath(); g.fill(); g.stroke();
  },
  star(g, c) {
    g.fillStyle = c;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU - Math.PI / 2;
      const rr = i % 2 ? 0.4 : 0.92;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill(); g.stroke();
  },
  ruler(g, c) {
    g.strokeStyle = c; g.lineWidth = 0.22; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-0.85, 0); g.lineTo(0.85, 0); g.stroke();
    g.beginPath(); g.moveTo(-0.85, 0); g.lineTo(-0.45, -0.38); g.moveTo(-0.85, 0); g.lineTo(-0.45, 0.38);
    g.moveTo(0.85, 0); g.lineTo(0.45, -0.38); g.moveTo(0.85, 0); g.lineTo(0.45, 0.38); g.stroke();
  },
  sword(g, c) {
    g.fillStyle = c;
    g.beginPath(); g.moveTo(-0.7, 0.7); g.lineTo(0.55, -0.55); g.lineTo(0.85, -0.85); g.lineTo(0.55, -0.15); g.lineTo(-0.5, 0.9); g.closePath(); g.fill(); g.stroke();
    g.strokeStyle = '#dfe5f2'; g.lineWidth = 0.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-0.85, 0.25); g.lineTo(-0.25, 0.85); g.stroke();
  },

};

const ITEM_GLYPH = {
  boots: 'boot', engine: 'gear', vest: 'shield', plate: 'shield', aegis: 'shield',
  meal: 'heart', heart: 'heart', glove: 'fist', gauntlet: 'fist', whetstone: 'stone',
  scope: 'crosshair', laserdot: 'crosshair', railkit: 'crosshair',
  ember: 'flame', core: 'atom', nucleus: 'atom', prism: 'prism',
  magnet: 'magnet', coffee: 'cup', battery: 'battery',
  charm: 'clover', dice: 'die', jackpot: 'seven', sickle: 'sickle',
  scarf: 'ribbon', phantom: 'ghost', bandage: 'cross', fang: 'fang',
  barrel: 'tube', crown: 'crown',
  // effect items
  cactus: 'stone', adrenaline: 'cup', medkit: 'cross', piggy: 'seven', frag: 'flame',
  frenzy: 'battery', executioner: 'fang', momentum: 'gear', ricochet: 'crosshair', alchemy: 'atom',
  mushroom: 'clover', bat: 'fang', injection: 'cross', glasses: 'crosshair', cyclops: 'crosshair',
  leather: 'shield', muscle: 'fist', glass: 'prism', statue: 'stone', potato: 'crown',
  scar: 'fang', coupon: 'seven', bait: 'magnet', silver: 'bolt', tardigrade: 'shield',
  tomato: 'heart', pact: 'fang', trophy: 'star', ghost: 'ghost',
};

// -------------------------------------------------------------- icons
const iconCache = new Map();

/**
 * Paint an icon for a weapon or item into `canvas`. The tile is tinted by
 * tier so rarity reads at a glance even before the label does.
 */
export function renderIcon(canvas, kind, id, lvl = 1) {
  const g = canvas.getContext('2d');
  const size = canvas.width;
  const key = `${kind}|${id}|${lvl}|${size}`;
  let src = iconCache.get(key);
  if (!src) {
    src = document.createElement('canvas');
    src.width = src.height = size;
    paintIcon(src.getContext('2d'), kind, id, lvl, size);
    iconCache.set(key, src);
  }
  g.clearRect(0, 0, size, size);
  g.drawImage(src, 0, 0);
}

function paintIcon(g, kind, id, lvl, size) {
  const def = kind === 'weapon' ? WEAPONS[id] : ITEMS.find((x) => x.id === id);
  const tier = def ? (kind === 'weapon' ? def.tier - 1 : def.tier - 1) : 0;
  const c = TIER_COLOR[Math.max(0, Math.min(3, tier))];
  const pad = size * 0.08;

  // tile
  const grd = g.createLinearGradient(0, 0, 0, size);
  grd.addColorStop(0, '#222a3f');
  grd.addColorStop(1, '#12161f');
  g.fillStyle = grd;
  roundRect(g, pad, pad, size - pad * 2, size - pad * 2, size * 0.18); g.fill();
  g.save();
  g.clip();
  const glow = g.createRadialGradient(size / 2, size * 0.85, 0, size / 2, size * 0.85, size * 0.8);
  glow.addColorStop(0, rgba(c, 0.35));
  glow.addColorStop(1, rgba(c, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  g.restore();
  g.strokeStyle = rgba(c, 0.8);
  g.lineWidth = Math.max(1.5, size * 0.03);
  roundRect(g, pad, pad, size - pad * 2, size - pad * 2, size * 0.18); g.stroke();

  g.save();
  g.translate(size / 2, size / 2);
  g.lineJoin = 'round';
  if (kind === 'weapon') {
    // The shape runs from ~0.1r to ~3r along +x; centre and tilt it.
    const r = size * 0.205;
    g.rotate(-0.7);
    g.translate(-r * 1.5, 0);
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = size * 0.06; g.shadowOffsetY = size * 0.03;
    paintWeaponShape(g, id, r);
  } else {
    const s = size * 0.3;
    g.scale(s, s);
    g.strokeStyle = OUT;
    g.lineWidth = 0.08;
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 0.25; g.shadowOffsetY = 0.1;
    const fn = GLYPH[ITEM_GLYPH[id]] || GLYPH.die;
    const star = id === 'aegis';
    const dot = id === 'laserdot';
    fn(g, c, '#dfe5f2', star || dot);
  }
  g.restore();

  if (kind === 'weapon' && lvl > 1) {
    const ROMAN = ['I', 'II', 'III', 'IV'];
    g.fillStyle = 'rgba(0,0,0,0.7)';
    roundRect(g, size - pad - size * 0.32, size - pad - size * 0.24, size * 0.32, size * 0.24, size * 0.06); g.fill();
    g.fillStyle = '#ffc857';
    g.font = `bold ${Math.round(size * 0.17)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ROMAN[lvl - 1], size - pad - size * 0.16, size - pad - size * 0.115);
  }
}

/** Convenience: build a <canvas class="icon"> for `kind`/`id`. */
export function iconEl(kind, id, size = 96, lvl = 1, cls = 'icon') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  c.className = cls;
  renderIcon(c, kind, id, lvl);
  return c;
}

// -------------------------------------------------------------- stat icons
// One small glyph per stat, so a card can say "+4" next to a fist instead of
// spelling out "Melee Damage +4" eight times over.
const STAT_ICON = {
  maxHp:     ['heart',     '#ff6b7a'],
  hpRegen:   ['cross',     '#8dffb0'],
  lifesteal: ['fang',      '#ff8fa3'],
  armor:     ['shield',    '#c9a86a'],
  dodge:     ['ghost',     '#7ec8ff'],
  speed:     ['boot',      '#ffe66d'],
  damage:    ['burst',     '#ff9f6b'],
  melee:     ['fist',      '#ff8a5c'],
  ranged:    ['crosshair', '#ffe9a8'],
  elem:      ['flame',     '#c39bff'],
  atkSpeed:  ['bolt',      '#ffd166'],
  crit:      ['star',      '#ffc857'],
  critMult:  ['die',       '#ffb347'],
  range:     ['ruler',     '#a8ffd0'],
  luck:      ['clover',    '#7ee081'],
  harvest:   ['sickle',    '#d59bff'],
  pickup:    ['magnet',    '#66f0ff'],
  // non-stat glyphs used by weapon cards
  dmg:       ['sword',     '#dfe9f5'],
  dps:       ['burst',     '#ffd166'],
};

const statCache = new Map();

/** Paint the glyph for stat `key` into `canvas`, no tile, cached per size. */
export function renderStatIcon(canvas, key) {
  const g = canvas.getContext('2d');
  const size = canvas.width;
  const ck = `${key}|${size}`;
  let src = statCache.get(ck);
  if (!src) {
    src = document.createElement('canvas');
    src.width = src.height = size;
    const sg = src.getContext('2d');
    const [name, color] = STAT_ICON[key] || ['die', '#dfe5f2'];
    sg.save();
    sg.translate(size / 2, size / 2);
    const sc = size * 0.42;
    sg.scale(sc, sc);
    sg.lineJoin = 'round';
    sg.strokeStyle = OUT;
    sg.lineWidth = 0.1;
    (GLYPH[name] || GLYPH.die)(sg, color, '#dfe5f2', false);
    sg.restore();
    statCache.set(ck, src);
  }
  g.clearRect(0, 0, size, size);
  g.drawImage(src, 0, 0);
}

/** Paint every `<canvas class="sicon" data-stat>` under `root`. */
export function paintStatIcons(root) {
  root.querySelectorAll('canvas.sicon[data-stat]').forEach((c) => renderStatIcon(c, c.dataset.stat));
}
