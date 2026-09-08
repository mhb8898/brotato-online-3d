#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Headless balance harness. Runs the real World with a scripted bot, no
// rendering, no network, and prints where each character tends to die.
//
//   node tools/sim.mjs                 # every character, 12 runs each, danger 0
//   node tools/sim.mjs --runs 30 --danger 2 --char 3,5 --endless 40
//
// The bot is deliberately naive (kite away from the nearest enemies, buy the
// best dps-per-material weapon, take the damage upgrade). A human plays
// better, so the bot's median death wave is a floor, not a target for real
// play. What the table is for: catching a character or a curve that is far
// out of line with the rest before a player does.
// ---------------------------------------------------------------------------

import { World, PHASE, TICK } from '../src/world.js';
import {
  ARENA, CHARACTERS, WEAPONS, MAX_WEAPONS, MAX_WAVE, weaponAt, weaponDps,
} from '../src/data.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => {
  if (!a.startsWith('--')) return [];
  const v = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true';
  return [a.slice(2), v];
}).filter((x) => x.length));

const RUNS = +(args.runs || 12);
const DANGER = +(args.danger || 0);
const ENDLESS_CAP = +(args.endless || 0);           // 0 = stop at the win
const CHARS = args.char ? args.char.split(',').map(Number) : CHARACTERS.map((c) => c.id);
const PID = 1;
const TRACE = !!args.trace;   // per-wave line: hp, damage taken, kills, enemies left, build

// Level-up preference, most wanted first.
const LEVEL_PREF = ['damage', 'maxHp', 'atkSpeed', 'armor', 'melee', 'ranged', 'elem', 'speed', 'crit', 'hpRegen', 'dodge', 'lifesteal', 'range', 'harvest', 'luck', 'pickup', 'critMult'];
// How much one point of each stat is worth to the bot when comparing items.
const ITEM_WEIGHT = { damage: 1.2, maxHp: 1.6, armor: 2.2, atkSpeed: 0.8, melee: 1.5, ranged: 1.5, elem: 1.5, hpRegen: 5, speed: 0.4, dodge: 0.8, crit: 0.5, lifesteal: 1.2, range: 0.2, harvest: 0.3, luck: 0.1, pickup: 0.05, critMult: 0.15 };

function itemScore(o, p) {
  let s = 0;
  if (o.mods) for (const k in o.mods) s += (ITEM_WEIGHT[k] || 0.2) * o.mods[k];
  if (o.desc) s += 10;                                    // effect items are always interesting
  return s / o.price;
}

function weaponScore(o, p) {
  const def = weaponAt(o.id, 1);
  const st = p.stats;
  const flat = def.dmg + st.melee * def.scale.m + st.ranged * def.scale.r + st.elem * def.scale.e;
  return weaponDps({ ...def, dmg: flat }) / o.price;
}

export function shopUntilBroke(world, p) {
  for (let guard = 0; guard < 12; guard++) {
    if (!p.shop) return;
    let best = null, bestScore = 0;
    p.shop.offers.forEach((o, i) => {
      if (!o || o.sold || o.price > p.mats) return;
      let s;
      if (o.kind === 'weapon') {
        const merges = p.weapons.some((w) => w.id === o.id && w.lvl === 1);
        if (p.weapons.length >= MAX_WEAPONS && !merges) return;
        s = weaponScore(o, p) * (merges ? 1.6 : 1);
      } else s = itemScore(o, p);
      if (s > bestScore) { bestScore = s; best = i; }
    });
    if (best === null) return;
    world.buy(p, best);
  }
}

export function botInput(world, p, seq) {
  let fx = 0, fy = 0;
  // Keep enemies just inside the shortest weapon's range: a knife bot that
  // flees everything never lands a hit and tells us nothing about knives.
  let minRange = 1e9;
  for (const w of p.weapons) minRange = Math.min(minRange, weaponAt(w.id, w.lvl).range * (1 + p.stats.range / 100));
  const hold = Math.max(70, Math.min(260, minRange * 0.8));
  for (const e of world.enemies) {
    if (e.dead) continue;
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const reach = e.boss ? Math.max(hold, 300) : hold;
    if (d > reach) continue;
    const w = (reach - d) / reach;
    fx += (dx / d) * w * w * 3; fy += (dy / d) * w * w * 3;
  }
  // Sidestep incoming enemy shots.
  for (const b of world.projs) {
    if (b.owner !== -1) continue;
    const dx = p.x - b.x, dy = p.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d > 150) continue;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const towards = (b.vx * -dx + b.vy * -dy) / (sp * d);   // 1 = heading straight at us
    if (towards < 0.6) continue;
    fx += (-b.vy / sp) * 2 * Math.sign(dx * -b.vy + dy * b.vx || 1);
    fy += (b.vx / sp) * 2 * Math.sign(dx * -b.vy + dy * b.vx || 1);
  }
  // Drift toward materials when nothing is pressing, and always away from walls.
  let nearest = null, nd = 1e9;
  for (const pk of world.pickups) {
    const d = Math.hypot(pk.x - p.x, pk.y - p.y);
    if (d < nd) { nd = d; nearest = pk; }
  }
  if (nearest && Math.hypot(fx, fy) < 0.8) { fx += (nearest.x - p.x) / nd * 0.7; fy += (nearest.y - p.y) / nd * 0.7; }
  // Cap the crowd's push so the wall term below can always win near an edge.
  const fm = Math.hypot(fx, fy);
  if (fm > 1.5) { fx *= 1.5 / fm; fy *= 1.5 / fm; }
  const cx = ARENA.w / 2 - p.x, cy = ARENA.h / 2 - p.y;
  const cd = Math.hypot(cx, cy) || 1;
  const wall = Math.min(p.x, p.y, ARENA.w - p.x, ARENA.h - p.y);
  const wallW = wall < 220 ? (220 - wall) / 220 * 3.5 : 0.15;
  fx += (cx / cd) * wallW; fy += (cy / cd) * wallW;

  // Orbit rather than back away: a pure flee vector cancels out when enemies
  // come from two sides and parks the bot in a corner. Rotate the escape
  // toward whichever side has the arena centre, which is how people kite.
  const fl = Math.hypot(fx, fy);
  if (fl > 0.3) {
    const side = Math.sign(fx * cy - fy * cx) || 1;
    const tx = -fy * side, ty = fx * side;
    fx += tx * 0.9; fy += ty * 0.9;
  }
  const l = Math.hypot(fx, fy);
  const mx = l > 1 ? fx / l : fx, my = l > 1 ? fy / l : fy;
  const t = world.nearestEnemy(p.x, p.y, 2000);
  const aim = t ? Math.atan2(t.y - p.y, t.x - p.x) : 0;
  return { seq, mx, my, aim };
}

export function runOnce(charId) {
  const msgs = [];
  const world = new World((pid, m) => msgs.push(m), PID);
  world.rng = (() => { let s = (Math.random() * 1e9) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  world.danger = DANGER;
  world.addPlayer(PID, 'bot');
  world.onControl(PID, { t: 'char', id: charId });
  world.onControl(PID, { t: 'ready', v: true });
  const p = world.players.get(PID);

  let seq = 0, ticks = 0, shopped = false;
  const stats = { matsPerWave: [], maxTicks: 30 * 60 * 90 };
  while (ticks++ < stats.maxTicks) {
    if (world.phase === PHASE.WAVE) {
      shopped = false;
      world.setInput(PID, botInput(world, p, ++seq));
      if (p.levelOptions) {
        let pick = 0;
        for (const key of LEVEL_PREF) { const i = p.levelOptions.findIndex((o) => o.key === key); if (i >= 0) { pick = i; break; } }
        world.pickUpgrade(p, pick);
      }
      world.step();
    } else if (world.phase === PHASE.SHOP) {
      if (!shopped) {
        shopped = true;
        stats.matsPerWave.push(p.waveMats);
        if (TRACE) console.log(`  w${String(world.wave).padStart(2)} hp ${String(Math.round(p.hp)).padStart(3)}/${String(p.stats.maxHp).padStart(3)} took ${String(p.waveDmg).padStart(3)} kills ${String(p.waveKills).padStart(3)} +${String(p.waveMats).padStart(3)}m lvl ${String(p.level).padStart(2)} mats ${String(p.mats).padStart(4)} | ${p.weapons.map((w) => `${w.id}${w.lvl}`).join(' ')} | ${p.items.join(' ')}`);
        shopUntilBroke(world, p);
        world.onControl(PID, { t: 'shopready', v: true });
      } else world.step();
    } else if (world.phase === PHASE.OVER) {
      const r = world.result;
      if (r.win && r.cleared && ENDLESS_CAP && world.wave < ENDLESS_CAP) {
        world.onControl(PID, { t: 'continue' });
        continue;
      }
      if (TRACE) console.log(`  ${r.win ? 'WIN' : 'DIED'} wave ${world.wave} took ${p.waveDmg} this wave, ${world.enemies.filter((e) => !e.dead).length} enemies alive, lvl ${p.level}`);
      return { wave: r.win && r.cleared ? world.wave : world.wave - 1, win: r.win, ticks, mats: stats.matsPerWave, weapons: p.weapons.map((w) => `${w.id}${w.lvl}`), level: p.level };
    } else break;
  }
  return { wave: world.wave, win: false, ticks, mats: stats.matsPerWave, weapons: [], level: p.level };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[(s.length / 2) | 0] : 0; };

const isMain = process.argv[1] && /sim\.mjs$/.test(process.argv[1]);
if (isMain) main();
function main() {
const rows = [];
const t0 = Date.now();
for (const id of CHARS) {
  const res = [];
  for (let i = 0; i < RUNS; i++) res.push(runOnce(id));
  const waves = res.map((r) => r.wave);
  const wins = res.filter((r) => r.win).length;
  const mins = res.reduce((a, r) => a + r.ticks * TICK, 0) / res.length / 60;
  const mats = res.flatMap((r) => r.mats);
  rows.push({
    character: CHARACTERS[id].name,
    'median wave': median(waves),
    'min..max': `${Math.min(...waves)}..${Math.max(...waves)}`,
    'win %': Math.round(wins / RUNS * 100),
    'mats/wave': Math.round(mats.reduce((a, b) => a + b, 0) / Math.max(1, mats.length)),
    'min/run': mins.toFixed(1),
    'lvl': median(res.map((r) => r.level)),
  });
  process.stderr.write(`${CHARACTERS[id].name} done\n`);
}
console.log(`danger ${DANGER}, ${RUNS} runs each${ENDLESS_CAP ? `, endless to ${ENDLESS_CAP}` : ''}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.table(rows);
const all = rows.map((r) => r['median wave']);
console.log(`overall median wave ${median(all)}, spread ${Math.min(...all)}..${Math.max(...all)}`);
}
