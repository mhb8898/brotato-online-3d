// ---------------------------------------------------------------------------
// 2D outfits: the same look each character wears in 3D (tools/blender/
// characters.py), flattened to a front view so the canvas renderer, the
// lobby portraits and the intro art can tell the cast apart by more than
// colour.
//
// Three layers, all in body space (body radius r, centred on 0,0, +y down):
//   paintOutfitBack   behind the body: packs, tanks, quivers, capes, shoes
//   paintOutfitFront  on the body, baked into the cached sprite with it:
//                     hats, helmets, hair, bands, scarves. Kept above y = -0.5r
//                     and below y = +0.5r so the live-drawn face stays clear.
//   paintFaceExtras   drawn live after the eyes: brows, monocle, fangs
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;
const INK = 'rgba(0,0,0,0.55)';

/** The potato outline paintPotato fills, as a clip path. Must match it. */
export function bodyPath(g, r, blob) {
  g.save();
  g.rotate(-0.35);
  g.scale(1, 1.18);
  blob(g, r, 3, 0.07, 42);
  g.restore();
}

// Top of the head leans left with the body tilt; hats sit here.
const HEAD_X = -0.36, HEAD_Y = -1.05;

function ell(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); }
function fillStroke(g, fill, lw = 1) { g.fillStyle = fill; g.fill(); g.lineWidth = lw; g.strokeStyle = INK; g.stroke(); }
function rrect(g, x, y, w, h, rad) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, rad) : g.rect(x, y, w, h); }

/** Run `fn` clipped to the body, for things that wrap around it. */
function onBody(g, r, blob, fn) {
  g.save();
  bodyPath(g, r, blob);
  g.clip();
  fn();
  g.restore();
}

/** Run `fn` in head space: origin on the crown, rotated with the body lean. */
function onHead(g, r, fn, dx = 0, dy = 0, rot = -0.3) {
  g.save();
  g.translate((HEAD_X + dx) * r, (HEAD_Y + dy) * r);
  g.rotate(rot);
  fn();
  g.restore();
}

// ------------------------------------------------------------------- back
export function paintOutfitBack(g, id, r) {
  g.lineJoin = 'round';
  switch (id) {
    case 0: { // Wanderer: backpack with a bedroll
      rrect(g, -1.35 * r, -0.55 * r, 0.75 * r, 1.15 * r, 0.22 * r); fillStroke(g, '#8b5a2b');
      rrect(g, -1.45 * r, 0.0, 0.3 * r, 0.42 * r, 0.08 * r); fillStroke(g, '#6e4520');
      rrect(g, -1.5 * r, -0.85 * r, 0.95 * r, 0.36 * r, 0.18 * r); fillStroke(g, '#c9b28a');
      break;
    }
    case 2: { // Ranger: quiver over the right shoulder, three red fletchings
      g.save();
      g.translate(0.85 * r, -0.35 * r); g.rotate(0.45);
      rrect(g, -0.22 * r, -0.7 * r, 0.44 * r, 1.3 * r, 0.12 * r); fillStroke(g, '#5a3a1e');
      rrect(g, -0.25 * r, -0.72 * r, 0.5 * r, 0.14 * r, 0.05 * r); fillStroke(g, '#c9a86a');
      for (const dx of [-0.12, 0, 0.12]) {
        g.fillStyle = '#d8c3a5'; g.fillRect((dx - 0.025) * r, -1.05 * r, 0.05 * r, 0.35 * r);
        g.beginPath(); g.moveTo(dx * r, -1.25 * r); g.lineTo((dx + 0.09) * r, -1.0 * r); g.lineTo((dx - 0.09) * r, -1.0 * r);
        g.closePath(); g.fillStyle = '#e63946'; g.fill();
      }
      g.restore();
      break;
    }
    case 4: { // Streaker: red sneakers
      for (const s of [-1, 1]) {
        ell(g, s * 0.5 * r, 1.14 * r, 0.44 * r, 0.14 * r); fillStroke(g, '#f8f9fa', 0.8);
        ell(g, s * 0.5 * r, 1.04 * r, 0.42 * r, 0.2 * r); fillStroke(g, '#e63946', 0.8);
      }
      break;
    }
    case 6: { // Pyro: twin fuel tanks
      for (const s of [-1, 1]) {
        const x = s * 1.08 * r - 0.1 * r;
        rrect(g, x - 0.27 * r, -1.0 * r, 0.54 * r, 1.25 * r, 0.26 * r); fillStroke(g, '#ffb703');
        g.fillStyle = '#2b2d42'; g.fillRect(x - 0.27 * r, -0.62 * r, 0.54 * r, 0.14 * r);
      }
      break;
    }
    case 7: { // Leech: high vampire collar, red lining
      g.beginPath();
      g.moveTo(-1.6 * r, -1.4 * r); g.lineTo(-0.8 * r, 0.2 * r); g.lineTo(0.8 * r, 0.2 * r);
      g.lineTo(1.45 * r, -1.45 * r); g.quadraticCurveTo(0, -0.1 * r, -1.6 * r, -1.4 * r);
      g.closePath(); fillStroke(g, '#3a0f3f');
      g.beginPath();
      g.moveTo(-1.38 * r, -1.2 * r); g.lineTo(-0.7 * r, 0.05 * r); g.lineTo(0.7 * r, 0.05 * r);
      g.lineTo(1.25 * r, -1.25 * r); g.quadraticCurveTo(0, -0.2 * r, -1.38 * r, -1.2 * r);
      g.closePath(); g.fillStyle = '#9d0208'; g.fill();
      break;
    }
    default: break;
  }
}

// ------------------------------------------------------------------ front
export function paintOutfitFront(g, id, r, blob) {
  g.lineJoin = 'round';
  switch (id) {
    case 0: { // Wanderer: red scarf and a fresh sprout
      onBody(g, r, blob, () => { g.fillStyle = '#e04848'; g.fillRect(-2 * r, 0.52 * r, 4 * r, 0.26 * r); });
      rrect(g, -0.95 * r, 0.6 * r, 0.26 * r, 0.62 * r, 0.1 * r); fillStroke(g, '#e04848');
      onHead(g, r, () => {
        g.strokeStyle = '#3f8f33'; g.lineWidth = 0.1 * r;
        g.beginPath(); g.moveTo(0, 0.1 * r); g.lineTo(0, -0.45 * r); g.stroke();
        for (const s of [-1, 1]) { ell(g, s * 0.3 * r, -0.5 * r, 0.32 * r, 0.14 * r, s * -0.4); fillStroke(g, '#5cc94a', 0.8); }
      });
      break;
    }
    case 1: { // Brawler: red headband with tails, a plaster, one boxing glove
      onBody(g, r, blob, () => { g.fillStyle = '#d62828'; g.fillRect(-2 * r, -0.78 * r, 4 * r, 0.22 * r); });
      g.fillStyle = '#d62828';
      g.save(); g.translate(-1.02 * r, -0.62 * r);
      ell(g, 0, 0, 0.14 * r, 0.14 * r); g.fill();
      g.rotate(0.5); g.fillRect(-0.55 * r, -0.05 * r, 0.5 * r, 0.12 * r);
      g.rotate(0.45); g.fillRect(-0.5 * r, -0.05 * r, 0.42 * r, 0.12 * r);
      g.restore();
      g.save(); g.translate(-0.6 * r, 0.3 * r); g.fillStyle = '#f2dfc4';
      for (const a of [0.6, -0.6]) { g.save(); g.rotate(a); g.fillRect(-0.2 * r, -0.05 * r, 0.4 * r, 0.1 * r); g.restore(); }
      g.restore();
      ell(g, -1.05 * r, 0.55 * r, 0.36 * r, 0.32 * r); fillStroke(g, '#c1121f');
      rrect(g, -1.12 * r, 0.8 * r, 0.3 * r, 0.2 * r, 0.05 * r); fillStroke(g, '#f1f1f1', 0.8);
      break;
    }
    case 2: { // Ranger: green feathered cap with a peak
      onBody(g, r, blob, () => { g.fillStyle = '#2f6b3a'; g.fillRect(-2 * r, -2 * r, 4 * r, 1.4 * r); });
      onHead(g, r, () => {
        g.beginPath(); g.moveTo(0.35 * r, 0.62 * r); g.quadraticCurveTo(1.2 * r, 0.55 * r, 1.25 * r, 0.8 * r);
        g.quadraticCurveTo(0.8 * r, 0.8 * r, 0.3 * r, 0.8 * r); g.closePath(); fillStroke(g, '#24552e', 0.8);
        g.save(); g.translate(-0.25 * r, 0.45 * r); g.rotate(-0.55);
        ell(g, 0, -0.45 * r, 0.11 * r, 0.5 * r); fillStroke(g, '#e63946', 0.8);
        g.strokeStyle = '#9d1b25'; g.lineWidth = 0.6;
        g.beginPath(); g.moveTo(0, 0.05 * r); g.lineTo(0, -0.9 * r); g.stroke();
        g.restore();
      });
      break;
    }
    case 3: { // Bulwark: steel helmet, nose guard, plume; pauldrons; round shield
      onBody(g, r, blob, () => {
        g.fillStyle = '#9aa3b8'; g.fillRect(-2 * r, -2 * r, 4 * r, 1.47 * r);
        g.fillStyle = '#5b6275'; g.fillRect(-2 * r, -0.62 * r, 4 * r, 0.12 * r);
        g.fillStyle = 'rgba(255,255,255,0.35)'; ell(g, -0.45 * r, -0.95 * r, 0.3 * r, 0.14 * r, -0.5); g.fill();
      });
      g.fillStyle = '#5b6275'; g.fillRect(-0.07 * r, -0.55 * r, 0.14 * r, 0.42 * r);
      onHead(g, r, () => { ell(g, -0.1 * r, 0.02 * r, 0.6 * r, 0.2 * r, 0); fillStroke(g, '#c1121f', 0.8); }, 0.05, 0.12);
      for (const s of [-1, 1]) { ell(g, s * 1.0 * r, 0.12 * r, 0.26 * r, 0.2 * r, s * 0.3); fillStroke(g, '#9aa3b8'); }
      ell(g, -0.95 * r, 0.55 * r, 0.52 * r, 0.52 * r); fillStroke(g, '#8b5a2b');
      g.lineWidth = 0.1 * r; g.strokeStyle = '#5b6275'; ell(g, -0.95 * r, 0.55 * r, 0.47 * r, 0.47 * r); g.stroke();
      ell(g, -0.95 * r, 0.55 * r, 0.14 * r, 0.14 * r); fillStroke(g, '#c9ced9', 0.8);
      break;
    }
    case 4: { // Streaker: swept orange spikes, goggles pushed up on the forehead
      onHead(g, r, () => {
        g.fillStyle = '#ff9f1c'; g.strokeStyle = INK; g.lineWidth = 0.8;
        for (const [x, len, a] of [[-0.5, 0.75, -0.85], [-0.05, 0.95, -0.55], [0.4, 0.75, -0.3]]) {
          g.save(); g.translate(x * r, 0.3 * r); g.rotate(a);
          g.beginPath(); g.moveTo(-0.2 * r, 0); g.lineTo(0, -len * r); g.lineTo(0.2 * r, 0); g.closePath();
          g.fill(); g.stroke(); g.restore();
        }
      }, 0, 0.1);
      onBody(g, r, blob, () => { g.fillStyle = '#2b2d42'; g.fillRect(-2 * r, -0.8 * r, 4 * r, 0.1 * r); });
      for (const s of [-1, 1]) {
        ell(g, s * 0.34 * r - 0.08 * r, -0.74 * r, 0.22 * r, 0.18 * r); fillStroke(g, '#b08d57');
        ell(g, s * 0.34 * r - 0.08 * r, -0.74 * r, 0.14 * r, 0.11 * r); g.fillStyle = '#66f0ff'; g.fill();
      }
      break;
    }
    case 5: { // Gambler: tilted top hat with an ace in the band, bow tie
      onHead(g, r, () => {
        ell(g, 0, 0, 0.9 * r, 0.2 * r); fillStroke(g, '#1b1b24');
        rrect(g, -0.52 * r, -1.0 * r, 1.04 * r, 1.0 * r, 0.08 * r); fillStroke(g, '#1b1b24');
        g.fillStyle = '#c9184a'; g.fillRect(-0.52 * r, -0.32 * r, 1.04 * r, 0.2 * r);
        g.save(); g.translate(0.3 * r, -0.5 * r); g.rotate(0.3);
        rrect(g, -0.12 * r, -0.17 * r, 0.24 * r, 0.34 * r, 0.03 * r); fillStroke(g, '#fdfdfd', 0.6);
        g.fillStyle = '#c9184a'; ell(g, 0, 0, 0.05 * r, 0.06 * r); g.fill();
        g.restore();
      }, 0.05, 0.05);
      g.fillStyle = '#141421';
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(0, 0.7 * r); g.lineTo(s * 0.34 * r, 0.56 * r); g.lineTo(s * 0.34 * r, 0.86 * r); g.closePath(); g.fill();
      }
      ell(g, 0, 0.71 * r, 0.09 * r, 0.09 * r); g.fill();
      break;
    }
    case 6: { // Pyro: pilot flame on top, hose to the tank
      onHead(g, r, () => {
        g.beginPath(); g.moveTo(0, -0.95 * r);
        g.quadraticCurveTo(0.42 * r, -0.35 * r, 0.28 * r, -0.05 * r);
        g.quadraticCurveTo(0, 0.18 * r, -0.28 * r, -0.05 * r);
        g.quadraticCurveTo(-0.4 * r, -0.4 * r, 0, -0.95 * r);
        g.closePath(); g.fillStyle = '#ff4d00'; g.fill();
        ell(g, 0.02 * r, -0.18 * r, 0.14 * r, 0.2 * r); g.fillStyle = '#ffc300'; g.fill();
      }, 0.05, 0);
      g.strokeStyle = '#3d405b'; g.lineWidth = 0.12 * r; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-0.95 * r, 0.3 * r); g.quadraticCurveTo(-0.9 * r, 0.9 * r, -0.2 * r, 0.8 * r); g.stroke();
      g.lineCap = 'butt';
      break;
    }
    case 7: { // Leech: slicked hair with a widow's peak, gold clasps
      onBody(g, r, blob, () => {
        g.fillStyle = '#1d1a2b';
        g.beginPath();
        g.moveTo(-2 * r, -2 * r); g.lineTo(2 * r, -2 * r); g.lineTo(2 * r, -0.62 * r);
        g.lineTo(0.14 * r, -0.62 * r); g.lineTo(-0.05 * r, -0.36 * r); g.lineTo(-0.24 * r, -0.62 * r);
        g.lineTo(-2 * r, -0.62 * r); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.18)'; ell(g, -0.5 * r, -0.95 * r, 0.32 * r, 0.1 * r, -0.5); g.fill();
      });
      for (const s of [-1, 1]) { ell(g, s * 0.62 * r, 0.62 * r, 0.1 * r, 0.1 * r); fillStroke(g, '#e9c46a', 0.6); }
      break;
    }
    default: break;
  }
}

// ------------------------------------------------------------ face extras
/** Pupil colour, if the character's eyes are not the usual ink. */
export function pupilColor(id) { return id === 7 ? '#b0102a' : '#15121c'; }

/** Drawn after the eyes, at body centre (x, y). Cheap: a few paths each. */
export function paintFaceExtras(g, id, x, y, r) {
  switch (id) {
    case 1: { // Brawler: a scowl
      g.strokeStyle = '#2a1a14'; g.lineWidth = r * 0.11; g.lineCap = 'round';
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(x + s * r * 0.6, y - r * 0.56); g.lineTo(x + s * r * 0.16, y - r * 0.44); g.stroke();
      }
      g.lineCap = 'butt';
      break;
    }
    case 5: { // Gambler: monocle on the right eye, chain down the side
      g.strokeStyle = '#e9c46a'; g.lineWidth = r * 0.07;
      g.beginPath(); g.ellipse(x + r * 0.36, y - r * 0.18, r * 0.3, r * 0.33, 0, 0, TAU); g.stroke();
      g.lineWidth = r * 0.035;
      g.beginPath(); g.moveTo(x + r * 0.62, y - r * 0.05); g.quadraticCurveTo(x + r * 0.85, y + r * 0.4, x + r * 0.6, y + r * 0.62); g.stroke();
      break;
    }
    case 7: { // Leech: fangs at the corners of the smile
      g.fillStyle = '#fdfdfd';
      for (const s of [-1, 1]) {
        const fx = x + s * r * 0.15, fy = y + r * 0.4;
        g.beginPath(); g.moveTo(fx - r * 0.06, fy - r * 0.02); g.lineTo(fx + r * 0.06, fy - r * 0.02); g.lineTo(fx, fy + r * 0.16);
        g.closePath(); g.fill();
      }
      break;
    }
    default: break;
  }
}
