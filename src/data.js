// ---------------------------------------------------------------------------
// Static game data. Everything here is pure data: the simulation (world.js)
// and the renderer (render.js) both import it, so host and clients agree on
// every number without sending it over the wire.
// ---------------------------------------------------------------------------

export const ARENA = { w: 1600, h: 900 };

export const MAX_WAVE = 20;        // clearing this wave is the win; endless continues past it
export const HARD_WAVE_CAP = 99;   // the snapshot carries the wave as a u8
export const MAX_WEAPONS = 6;

/** Seconds a wave lasts. 21s on wave 1, 60s from wave 14 on. */
export function waveDuration(n) { return Math.min(60, 18 + 3 * n); }

/** Bosses on a boss wave: one, two at wave 20, one more per ten endless waves. */
export function bossCountForWave(w) {
  if (w < 20) return 1;
  return 2 + Math.floor((w - 20) / 10);
}

// Danger is picked by the host in the lobby. Harder is also richer: the
// harvest bonus keeps the shop moving when enemies take longer to die.
export const DANGER = [
  { name: 'Danger 0', hp: 1,   dmg: 1,    spawn: 1,    elite: 0,    harvest: 0,  desc: 'The standard run.' },
  { name: 'Danger 1', hp: 1.3, dmg: 1.15, spawn: 1.12, elite: 0.04, harvest: 10, desc: 'Tougher enemies, a few more elites.' },
  { name: 'Danger 2', hp: 1.6, dmg: 1.3,  spawn: 1.25, elite: 0.08, harvest: 20, desc: 'Denser waves. Armor stops being optional.' },
  { name: 'Danger 3', hp: 2,   dmg: 1.5,  spawn: 1.4,  elite: 0.12, harvest: 30, desc: 'Everything hits like a truck.' },
];

// Every stat a player can have. Percent-based unless noted.
export const BASE_STATS = {
  maxHp: 12,      // flat
  hpRegen: 0,     // points: 1 = 0.2 HP/s, +0.089 HP/s per extra point (Brotato)
  lifesteal: 0,   // % of damage dealt healed (chance-based)
  armor: 0,       // flat, feeds a diminishing-returns curve
  dodge: 0,       // % chance to ignore a hit, capped
  speed: 0,       // % move speed
  damage: 0,      // % all damage
  melee: 0,       // flat, scaled per-weapon
  ranged: 0,      // flat, scaled per-weapon
  elem: 0,        // flat, scaled per-weapon
  atkSpeed: 0,    // % attack speed
  crit: 5,        // % crit chance
  critMult: 200,  // % damage on crit
  range: 0,       // % weapon range
  luck: 0,        // % better shop / drop rolls
  harvest: 0,     // % extra materials
  pickup: 0,      // % pickup radius
};

/**
 * HP Regeneration is in points, like Brotato: the first point heals 0.2 HP/s
 * and every further point adds 0.089, so 10 points is 1 HP/s. It used to be
 * raw HP/s, which made one uncommon bandage worth a Brotato build's whole
 * regen investment.
 */
export function regenPerSec(points) {
  return points <= 0 ? 0 : 0.2 + 0.089 * (points - 1);
}

export const STAT_LABEL = {
  maxHp: 'Max HP', hpRegen: 'HP Regen', lifesteal: 'Lifesteal', armor: 'Armor',
  dodge: 'Dodge', speed: 'Speed', damage: 'Damage', melee: 'Melee Damage',
  ranged: 'Ranged Damage', elem: 'Elemental Damage', atkSpeed: 'Attack Speed',
  crit: 'Crit Chance', critMult: 'Crit Damage', range: 'Range', luck: 'Luck',
  harvest: 'Harvesting', pickup: 'Pickup Range',
};

// Which stats read as percentages in the UI.
export const STAT_PCT = new Set(['lifesteal', 'dodge', 'speed', 'damage',
  'atkSpeed', 'crit', 'critMult', 'range', 'luck', 'harvest', 'pickup']);

// --------------------------------------------------------------------------
// Characters
// --------------------------------------------------------------------------
export const CHARACTERS = [
  { id: 0, name: 'Wanderer',  color: '#7ec8ff', weapon: 'pistol',
    desc: 'Nothing special. Everything works.',
    mods: { damage: 5, maxHp: 2, speed: 5 } },
  { id: 1, name: 'Brawler',   color: '#ff8a5c', weapon: 'knife',
    desc: 'Melee damage way up, guns feel wrong in your hands.',
    mods: { melee: 6, maxHp: 5, ranged: -8, speed: -5 } },
  { id: 2, name: 'Ranger',    color: '#8dffb0', weapon: 'smg',
    desc: 'Reach out and touch them. Fragile though.',
    mods: { ranged: 5, range: 25, atkSpeed: 10, maxHp: -3 } },
  { id: 3, name: 'Bulwark',   color: '#c9a86a', weapon: 'hammer',
    desc: 'Slow, armoured, extremely hard to remove.',
    mods: { armor: 8, maxHp: 15, speed: -18, atkSpeed: -10 } },
  { id: 4, name: 'Streaker',  color: '#ffe66d', weapon: 'knife',
    desc: 'Blindingly fast, made of paper.',
    mods: { speed: 45, dodge: 15, maxHp: -3 } },
  { id: 5, name: 'Gambler',   color: '#d59bff', weapon: 'shotgun',
    desc: 'Crits, loot, and a great deal of hope.',
    mods: { luck: 50, crit: 12, harvest: 25, maxHp: -3 } },
  { id: 6, name: 'Pyro',      color: '#ff6b6b', weapon: 'flamer',
    desc: 'Elemental damage specialist. Burns the front row.',
    mods: { elem: 8, atkSpeed: 15, maxHp: -2, armor: -2 } },
  { id: 7, name: 'Leech',     color: '#9be7d8', weapon: 'sword',
    desc: 'Heals off everything it hits, hits softly.',
    mods: { lifesteal: 12, maxHp: -4, damage: -10, hpRegen: 3 } },
];

// --------------------------------------------------------------------------
// Weapons
//   cls    : 'melee' swings an arc, 'ranged' fires projectiles
//   dmg    : base damage before stats
//   cd     : seconds between attacks at 0% attack speed
//   range  : targeting + projectile reach in world units
//   scale  : how much melee/ranged/elem stats add as flat damage
// --------------------------------------------------------------------------
export const WEAPONS = {
  knife:    { desc: 'Quick, short jabs. Cheap and never actually bad.', name: 'Knife',        cls: 'melee',  tier: 1, price: 12, dmg: 7,  cd: 0.45, range: 115, arc: 1.3, scale: { m: 1.0, r: 0, e: 0 }, crit: 5,  color: '#dfe9f5' },
  sword:    { desc: 'A wider, heavier swing than the knife. Solid all-round melee.', name: 'Sword',        cls: 'melee',  tier: 2, price: 26, dmg: 13, cd: 0.85, range: 145, arc: 2.1, scale: { m: 1.2, r: 0, e: 0 }, color: '#b8c6d9' },
  spear:    { desc: 'Long narrow thrust. Reaches past contact range, hits one target.', name: 'Spear',        cls: 'melee',  tier: 2, price: 24, dmg: 15, cd: 0.7,  range: 210, arc: 0.55, scale: { m: 1.1, r: 0, e: 0 }, color: '#cbb88f' },
  hammer:   { desc: 'Slow, huge arc, knocks everything back. Melee crowd control.', name: 'Hammer',       cls: 'melee',  tier: 2, price: 28, dmg: 24, cd: 1.35, range: 135, arc: 2.6, knock: 420, scale: { m: 1.5, r: 0, e: 0 }, color: '#a08b6b' },
  scythe:   { desc: 'Sweeps almost a full circle. Each swing has a 12% chance to heal 1.', name: 'Scythe',       cls: 'melee',  tier: 3, price: 46, dmg: 17, cd: 0.75, range: 175, arc: 3.4, scale: { m: 1.3, r: 0, e: 0.3 }, lifesteal: 12, color: '#a6f0c6' },
  pistol:   { desc: 'One accurate shot at a time. Steady damage at long range.', name: 'Pistol',       cls: 'ranged', tier: 1, price: 12, dmg: 8,  cd: 0.5,  range: 500, spd: 760, scale: { m: 0, r: 1.0, e: 0 }, color: '#ffe9a8' },
  smg:      { desc: 'Sprays fast and wide. Tiny per shot, enormous in volume.', name: 'SMG',          cls: 'ranged', tier: 1, price: 16, dmg: 4,  cd: 0.15, range: 420, spd: 800, spread: 0.13, scale: { m: 0, r: 0.5, e: 0 }, color: '#ffd166' },
  shotgun:  { desc: 'Six pellets in a cone. Brutal up close, wasted at distance.', name: 'Shotgun',      cls: 'ranged', tier: 2, price: 30, dmg: 5,  cd: 0.9,  range: 340, spd: 680, count: 6, spread: 0.42, scale: { m: 0, r: 0.6, e: 0 }, color: '#ffb37a' },
  shuriken: { desc: 'Punches through 2 enemies. Scales off melee AND ranged.', name: 'Shuriken',     cls: 'ranged', tier: 2, price: 26, dmg: 8,  cd: 0.5,  range: 460, spd: 620, pierce: 2, scale: { m: 0.4, r: 0.6, e: 0 }, color: '#c8e6ff' },
  wand:     { desc: 'Slow homing orb that never misses. Mostly elemental scaling.', name: 'Magic Wand',   cls: 'ranged', tier: 2, price: 32, dmg: 11, cd: 0.7,  range: 540, spd: 430, homing: 4.5, scale: { m: 0, r: 0.3, e: 0.9 }, color: '#c39bff' },
  flamer:   { desc: 'Short cone of fire that pierces everything in front of you.', name: 'Flamethrower', cls: 'ranged', tier: 2, price: 34, dmg: 3,  cd: 0.085, range: 230, spd: 330, life: 0.7, pierce: 99, scale: { m: 0, r: 0.1, e: 0.5 }, color: '#ff7a45' },
  laser:    { desc: 'Fast beam through up to 5 enemies. Ranged + elemental.', name: 'Laser Rifle',  cls: 'ranged', tier: 3, price: 48, dmg: 9,  cd: 0.38, range: 620, spd: 1250, pierce: 5, scale: { m: 0, r: 0.5, e: 0.8 }, color: '#66f0ff' },
  sniper:   { desc: 'Enormous damage at extreme range, high crit, very slow.', name: 'Sniper',       cls: 'ranged', tier: 3, price: 52, dmg: 32, cd: 1.55, range: 950, spd: 1600, pierce: 3, crit: 15, scale: { m: 0, r: 1.7, e: 0 }, color: '#a8ffd0' },
  rocket:   { desc: 'Explodes on impact for area damage. Slow, arcs into crowds.', name: 'Rocket Tube',  cls: 'ranged', tier: 3, price: 54, dmg: 26, cd: 1.7,  range: 620, spd: 470, aoe: 115, scale: { m: 0, r: 1.0, e: 0.6 }, color: '#ff9f6b' },
  minigun:  { desc: 'The highest fire rate in the game. Wants crit and range.', name: 'Minigun',      cls: 'ranged', tier: 4, price: 76, dmg: 6,  cd: 0.075, range: 450, spd: 880, spread: 0.2, scale: { m: 0, r: 0.4, e: 0 }, color: '#ffcf5c' },
  tesla:    { desc: 'Chains lightning between 4 nearby enemies. Pure elemental.', name: 'Tesla Coil',   cls: 'ranged', tier: 4, price: 80, dmg: 16, cd: 0.95, range: 430, chain: 4, scale: { m: 0, r: 0.2, e: 1.5 }, color: '#7fd7ff' },
};

export const WEAPON_IDS = Object.keys(WEAPONS);

// --------------------------------------------------------------------------
// Weapon classes. Every weapon belongs to one or two; owning 2 / 4 / 6
// weapons of a class grants that class's set bonus. This is what turns "six
// random guns" into a build: the shop card tells you which class a weapon
// feeds, and the inventory shows how close you are to the next tier.
// --------------------------------------------------------------------------
const WEAPON_TAGS = {
  knife: ['blade', 'precise'], sword: ['blade'], spear: ['blade', 'precise'],
  hammer: ['heavy'], scythe: ['blade', 'elemental'],
  pistol: ['gun', 'precise'], smg: ['gun'], shotgun: ['gun', 'heavy'],
  shuriken: ['blade', 'precise'], wand: ['elemental'], flamer: ['elemental'],
  laser: ['gun', 'elemental'], sniper: ['gun', 'precise'], rocket: ['heavy', 'elemental'],
  minigun: ['gun'], tesla: ['elemental'],
};
for (const id of WEAPON_IDS) WEAPONS[id].tags = WEAPON_TAGS[id] || [];

export const SET_STEPS = [2, 4, 6];
export const CLASSES = {
  blade:     { name: 'Blade',     color: '#a6f0c6', stat: 'lifesteal', steps: [3, 6, 10] },
  heavy:     { name: 'Heavy',     color: '#ffb37a', stat: 'damage',    steps: [8, 18, 30] },
  gun:       { name: 'Gun',       color: '#ffe9a8', stat: 'ranged',    steps: [3, 7, 12] },
  elemental: { name: 'Elemental', color: '#c39bff', stat: 'elem',      steps: [3, 7, 12] },
  precise:   { name: 'Precise',   color: '#7ec8ff', stat: 'crit',      steps: [5, 12, 20] },
};
export const CLASS_IDS = Object.keys(CLASSES);

/** How many owned weapons carry each class tag. Levels do not count double. */
export function classCounts(weapons) {
  const n = {};
  for (const w of weapons) for (const t of WEAPONS[w.id].tags) n[t] = (n[t] || 0) + 1;
  return n;
}

/** Index of the set-bonus tier reached with `count` weapons, or -1. */
export function setTier(count) {
  let t = -1;
  for (let i = 0; i < SET_STEPS.length; i++) if (count >= SET_STEPS[i]) t = i;
  return t;
}

/** Stat mods granted by every reached set bonus, ready for recomputeStats. */
export function setBonusMods(weapons) {
  const mods = {};
  const counts = classCounts(weapons);
  for (const c in counts) {
    const t = setTier(counts[c]);
    if (t < 0) continue;
    const cls = CLASSES[c];
    mods[cls.stat] = (mods[cls.stat] || 0) + cls.steps[t];
  }
  return mods;
}

// --------------------------------------------------------------------------
// Weapon levels (Brotato-style combining).
//
// `tier` above is *rarity* - which shop pool a weapon rolls from. `lvl` is a
// separate axis: two identical weapons at the same level merge into one at the
// next level, freeing a slot. Every level is a straight numeric upgrade, so a
// merge is never a downgrade and never needs a confirmation prompt.
// --------------------------------------------------------------------------
export const MAX_WEAPON_LVL = 4;
export const ROMAN = ['I', 'II', 'III', 'IV'];

const LVL_DMG = [1, 1.55, 2.35, 3.5];
const LVL_CD = [1, 0.94, 0.88, 0.82];
const LVL_RANGE = [1, 1.05, 1.1, 1.15];

const _lvlCache = new Map();

/** The effective definition of `id` at `lvl` (1..MAX_WEAPON_LVL). Cached. */
export function weaponAt(id, lvl) {
  const L = lvl < 1 ? 1 : lvl > MAX_WEAPON_LVL ? MAX_WEAPON_LVL : lvl | 0;
  const key = `${id}${L}`;
  let d = _lvlCache.get(key);
  if (d) return d;
  const b = WEAPONS[id];
  d = {
    ...b,
    lvl: L,
    dmg: Math.round(b.dmg * LVL_DMG[L - 1] * 10) / 10,
    cd: b.cd * LVL_CD[L - 1],
    range: Math.round(b.range * LVL_RANGE[L - 1]),
  };
  _lvlCache.set(key, d);
  return d;
}

/** Display name including the level numeral, e.g. "Knife II". */
export function weaponName(id, lvl) {
  const n = WEAPONS[id].name;
  return lvl > 1 ? `${n} ${ROMAN[Math.min(lvl, MAX_WEAPON_LVL) - 1]}` : n;
}

/** Sustained damage per second, ignoring crit and stats. For shop cards. */
export function weaponDps(def) {
  const shots = def.count || 1;
  const hits = def.chain || (def.pierce ? Math.min(def.pierce + 1, 4) : 1);
  return (def.dmg * shots * hits) / def.cd;
}

// --------------------------------------------------------------------------
// Items (passive stat sticks bought in the shop)
// --------------------------------------------------------------------------
// Brotato's rule, adopted here: almost every stat item costs you something.
// A pure upside is a checkbox, not a choice, and a shop full of checkboxes is
// how a build ends up good at everything. The few with no downside are small.
export const ITEMS = [
  { id: 'boots',     name: 'Running Shoes',   tier: 1, price: 14, mods: { speed: 6, range: -5 } },
  { id: 'vest',      name: 'Padded Vest',     tier: 1, price: 15, mods: { armor: 1, speed: -2 } },
  { id: 'meal',      name: 'Hot Meal',        tier: 1, price: 13, mods: { maxHp: 4, damage: -1 } },
  { id: 'glove',     name: 'Weighted Glove',  tier: 1, price: 14, mods: { melee: 2, atkSpeed: -3 } },
  { id: 'scope',     name: 'Cheap Scope',     tier: 1, price: 14, mods: { ranged: 2, range: -5 } },
  { id: 'ember',     name: 'Ember',           tier: 1, price: 14, mods: { elem: 2, dodge: -2 } },
  { id: 'magnet',    name: 'Magnet',          tier: 1, price: 12, mods: { pickup: 30 } },
  { id: 'coffee',    name: 'Cold Brew',       tier: 1, price: 16, mods: { atkSpeed: 8, damage: -2 } },
  { id: 'charm',     name: 'Lucky Charm',     tier: 1, price: 15, mods: { luck: 15, maxHp: -1 } },
  { id: 'sickle',    name: 'Sickle',          tier: 1, price: 15, mods: { harvest: 15, damage: -1 } },
  { id: 'mushroom',  name: 'Mushroom',        tier: 1, price: 16, mods: { hpRegen: 3, luck: -5 } },
  { id: 'bat',       name: 'Bat',             tier: 1, price: 18, mods: { lifesteal: 3, harvest: -3 } },
  { id: 'injection', name: 'Injection',       tier: 1, price: 18, mods: { damage: 7, maxHp: -2 } },
  { id: 'glasses',   name: 'Glasses',         tier: 1, price: 17, mods: { range: 18 } },

  { id: 'plate',     name: 'Steel Plate',     tier: 2, price: 30, mods: { armor: 3, damage: -3 } },
  { id: 'scarf',     name: 'Silk Scarf',      tier: 2, price: 28, mods: { dodge: 6, maxHp: -2 } },
  { id: 'whetstone', name: 'Whetstone',       tier: 2, price: 30, mods: { melee: 4, damage: 2, range: -5 } },
  { id: 'laserdot',  name: 'Laser Dot',       tier: 2, price: 30, mods: { ranged: 3, crit: 4, atkSpeed: -3 } },
  { id: 'core',      name: 'Reactor Core',    tier: 2, price: 32, mods: { elem: 4, atkSpeed: 4, maxHp: -2 } },
  { id: 'bandage',   name: 'Field Bandage',   tier: 2, price: 28, mods: { hpRegen: 4, speed: -2 } },
  { id: 'fang',      name: 'Vampire Fang',    tier: 2, price: 32, mods: { lifesteal: 5, maxHp: -2 } },
  { id: 'barrel',    name: 'Long Barrel',     tier: 2, price: 29, mods: { range: 20, atkSpeed: -3 } },
  { id: 'dice',      name: 'Loaded Dice',     tier: 2, price: 31, mods: { crit: 6, luck: 10, damage: -2 } },
  { id: 'battery',   name: 'Overclock Cell',  tier: 2, price: 33, mods: { atkSpeed: 12, armor: -2 } },
  { id: 'cyclops',   name: 'Cyclops Eye',     tier: 2, price: 34, mods: { damage: 12, range: -12 } },
  { id: 'leather',   name: 'Leather Vest',    tier: 2, price: 34, mods: { armor: 2, dodge: 5, maxHp: -3 } },
  { id: 'muscle',    name: 'Muscle Tee',      tier: 2, price: 36, mods: { melee: 3, maxHp: 5, range: -15 } },

  { id: 'engine',    name: 'Turbo Engine',    tier: 3, price: 54, mods: { speed: 15, dodge: 5, maxHp: -5 } },
  { id: 'aegis',     name: 'Aegis',           tier: 3, price: 58, mods: { armor: 6, maxHp: 8, speed: -8 } },
  { id: 'gauntlet',  name: 'War Gauntlet',    tier: 3, price: 58, mods: { melee: 8, damage: 6, ranged: -4, range: -10 } },
  { id: 'railkit',   name: 'Rail Kit',        tier: 3, price: 58, mods: { ranged: 6, range: 20, atkSpeed: -6 } },
  { id: 'prism',     name: 'Storm Prism',     tier: 3, price: 60, mods: { elem: 7, crit: 5, maxHp: -3 } },
  { id: 'heart',     name: 'Second Heart',    tier: 3, price: 56, mods: { maxHp: 12, hpRegen: 3, speed: -5 } },
  { id: 'glass',     name: 'Glass Cannon',    tier: 3, price: 62, mods: { damage: 25, armor: -3 } },
  { id: 'statue',    name: 'Statue',          tier: 3, price: 60, mods: { atkSpeed: 35, speed: -12 } },

  { id: 'crown',     name: 'Bloody Crown',    tier: 4, price: 92, mods: { damage: 20, lifesteal: 6, maxHp: -8, armor: -4 } },
  { id: 'nucleus',   name: 'Nucleus',         tier: 4, price: 95, mods: { melee: 5, ranged: 5, elem: 5, atkSpeed: 8, dodge: -6 } },
  { id: 'phantom',   name: 'Phantom Cloak',   tier: 4, price: 90, mods: { dodge: 15, speed: 12, maxHp: -6 } },
  { id: 'jackpot',   name: 'Jackpot',         tier: 4, price: 94, mods: { crit: 15, critMult: 50, luck: 30, armor: -2 } },
  { id: 'potato',    name: 'Golden Potato',   tier: 4, price: 98,
    mods: { maxHp: 4, hpRegen: 2, lifesteal: 1, damage: 5, atkSpeed: 5, speed: 3, dodge: 3, armor: 1, luck: 5 } },

  // ---- effect items: one mechanic each. `unique` ones are one per player.
  // These are the build-defining pieces; the stat sticks above are what you
  // buy around them. Several are deliberately double-edged.
  { id: 'cactus',      name: 'Thorns',       tier: 1, price: 16, unique: true, effect: 'thorns',      v: 8,
    desc: 'Enemies that touch you take 8 damage.' },
  { id: 'adrenaline',  name: 'Adrenaline',   tier: 1, price: 15, unique: true, effect: 'adrenaline',  v: 35,
    desc: '+35% speed for 2s after you take a hit.' },
  { id: 'medkit',      name: 'Field Kit',    tier: 1, price: 14, unique: true, effect: 'medkit',      v: 5,
    desc: 'Health drops are 3x as common and heal 5.' },
  { id: 'scar',        name: 'Scar',         tier: 1, price: 18, unique: true, effect: 'xp',          v: 25, mods: { range: -8 },
    desc: '+25% experience.' },
  { id: 'coupon',      name: 'Coupon',       tier: 1, price: 15, effect: 'coupon', v: 5,
    desc: 'Shop prices -5%. Stacks up to -25%.' },
  { id: 'piggy',       name: 'Piggy Bank',   tier: 2, price: 30, unique: true, effect: 'interest',    v: 20,
    desc: 'End of wave: +20% of your unspent materials (max 40).' },
  { id: 'frag',        name: 'Volatile',     tier: 2, price: 34, unique: true, effect: 'frag',        v: 40,
    desc: 'Enemies explode on death for 40% of their max HP.' },
  { id: 'frenzy',      name: 'Frenzy',       tier: 2, price: 32, unique: true, effect: 'frenzy',      v: 4,
    desc: 'Each kill: +4% attack speed for 3s. Stacks 8 times.' },
  { id: 'executioner', name: 'Executioner',  tier: 2, price: 31, unique: true, effect: 'execute',     v: 60,
    desc: '+60% damage to enemies below 30% HP.' },
  { id: 'momentum',    name: 'Momentum',     tier: 2, price: 30, unique: true, effect: 'momentum',    v: 30,
    desc: '+1% damage per kill this wave, up to +30%. Resets each wave.' },
  { id: 'bait',        name: 'Bait',         tier: 2, price: 26, effect: 'crowd', v: 15, mods: { damage: 8 },
    desc: '15% more enemies spawn (more materials, more danger).' },
  { id: 'silver',      name: 'Silver Bullet', tier: 2, price: 36, unique: true, effect: 'bigGame',    v: 30,
    desc: '+30% damage to bosses and elites.' },
  { id: 'ricochet',    name: 'Ricochet',     tier: 3, price: 55, unique: true, effect: 'ricochet',    v: 1, mods: { damage: -10 },
    desc: 'Bullets that would stop bounce to a nearby enemy once.' },
  { id: 'alchemy',     name: 'Alchemy',      tier: 3, price: 56, unique: true, effect: 'alchemy',     v: 12,
    desc: 'Every 12 materials you collect heal 1 HP.' },
  { id: 'tardigrade',  name: 'Tardigrade',   tier: 3, price: 52, unique: true, effect: 'shield',      v: 1,
    desc: 'The first hit you take each wave does nothing.' },
  { id: 'tomato',      name: 'Sad Tomato',   tier: 3, price: 48, unique: true, effect: 'halfstart',   v: 50, mods: { hpRegen: 8 },
    desc: 'Every wave starts at half health.' },
  { id: 'pact',        name: 'Blood Pact',   tier: 3, price: 50, unique: true, effect: 'drain',       v: 1, mods: { harvest: 35 },
    desc: 'Lose 1 HP per second during waves (never below 1).' },
  { id: 'trophy',      name: 'Hunting Trophy', tier: 3, price: 55, unique: true, effect: 'trophy',    v: 33,
    desc: 'Critical kills have a 33% chance to drop an extra material.' },
  { id: 'ghost',       name: 'Ghost Cloak',  tier: 3, price: 70, unique: true, effect: 'dodgecap',    v: 10, mods: { dodge: 8, armor: -3 },
    desc: 'Your dodge cap rises from 60% to 70%.' },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

/** Sum of `v` per effect across owned items. Uniques mean this is one entry each. */
export function effectMap(itemIds) {
  const fx = {};
  for (const id of itemIds) {
    const it = ITEM_BY_ID[id];
    if (it && it.effect) fx[it.effect] = (fx[it.effect] || 0) + it.v;
  }
  return fx;
}

export const TIER_COLOR = ['#8c93a1', '#6ec1ff', '#c084fc', '#ffc857'];
export const TIER_NAME = ['Common', 'Uncommon', 'Rare', 'Legendary'];

// --------------------------------------------------------------------------
// Level-up upgrade pool. Each pick applies `mods` directly to the player.
// --------------------------------------------------------------------------
export const UPGRADES = [
  { key: 'maxHp',     tier: 0, mods: { maxHp: 3 } },
  { key: 'maxHp',     tier: 1, mods: { maxHp: 6 } },
  { key: 'maxHp',     tier: 2, mods: { maxHp: 10 } },
  { key: 'damage',    tier: 0, mods: { damage: 5 } },
  { key: 'damage',    tier: 1, mods: { damage: 10 } },
  { key: 'damage',    tier: 2, mods: { damage: 18 } },
  { key: 'melee',     tier: 0, mods: { melee: 2 } },
  { key: 'melee',     tier: 1, mods: { melee: 4 } },
  { key: 'ranged',    tier: 0, mods: { ranged: 2 } },
  { key: 'ranged',    tier: 1, mods: { ranged: 4 } },
  { key: 'elem',      tier: 0, mods: { elem: 2 } },
  { key: 'elem',      tier: 1, mods: { elem: 4 } },
  { key: 'atkSpeed',  tier: 0, mods: { atkSpeed: 6 } },
  { key: 'atkSpeed',  tier: 1, mods: { atkSpeed: 12 } },
  { key: 'speed',     tier: 0, mods: { speed: 6 } },
  { key: 'speed',     tier: 1, mods: { speed: 12 } },
  { key: 'armor',     tier: 0, mods: { armor: 2 } },
  { key: 'armor',     tier: 1, mods: { armor: 4 } },
  { key: 'dodge',     tier: 0, mods: { dodge: 4 } },
  { key: 'dodge',     tier: 1, mods: { dodge: 8 } },
  { key: 'crit',      tier: 0, mods: { crit: 4 } },
  { key: 'crit',      tier: 1, mods: { crit: 8 } },
  { key: 'critMult',  tier: 1, mods: { critMult: 25 } },
  { key: 'hpRegen',   tier: 0, mods: { hpRegen: 2 } },
  { key: 'hpRegen',   tier: 1, mods: { hpRegen: 4 } },
  { key: 'lifesteal', tier: 1, mods: { lifesteal: 5 } },
  { key: 'range',     tier: 0, mods: { range: 10 } },
  { key: 'range',     tier: 1, mods: { range: 20 } },
  { key: 'harvest',   tier: 0, mods: { harvest: 12 } },
  { key: 'luck',      tier: 0, mods: { luck: 15 } },
  { key: 'pickup',    tier: 0, mods: { pickup: 25 } },
];

// --------------------------------------------------------------------------
// Enemies. Array index IS the network id, so never reorder this list.
// One new type every wave or two from wave 4 on; bosses fill the gaps at 5/10/15/20.
// --------------------------------------------------------------------------
export const ENEMIES = [
  { name: 'Grunt',    ai: 'chase',   hp: 12,  spd: 78,  dmg: 2,  r: 15, color: '#e05f5f', mats: 1, minWave: 1 },
  { name: 'Runner',   ai: 'chase',   hp: 7,   spd: 145, dmg: 2,  r: 12, color: '#f0a35e', mats: 1, minWave: 2 },
  { name: 'Tank',     ai: 'chase',   hp: 46,  spd: 48,  dmg: 5,  r: 25, color: '#8c6bb1', mats: 2, minWave: 3 },
  { name: 'Shooter',  ai: 'shoot',   hp: 16,  spd: 62,  dmg: 3,  r: 15, color: '#5ea8e0', mats: 2, minWave: 4, keep: 330, fireCd: 3.0, shotSpd: 215 },
  { name: 'Charger',  ai: 'charge',  hp: 26,  spd: 70,  dmg: 5,  r: 18, color: '#d94f8c', mats: 2, minWave: 7 },
  { name: 'Exploder', ai: 'explode', hp: 14,  spd: 118, dmg: 9, r: 16, color: '#ff5c2e', mats: 2, minWave: 8, aoe: 95 },
  { name: 'Spitter',  ai: 'shoot',   hp: 22,  spd: 55,  dmg: 3,  r: 17, color: '#7ed957', mats: 3, minWave: 10, keep: 400, fireCd: 2.6, shotSpd: 205, shots: 3, spread: 0.3 },
  { name: 'Swarmer',  ai: 'chase',   hp: 5,   spd: 160, dmg: 1,  r: 9,  color: '#ffd166', mats: 1, minWave: 6, pack: 6 },
  { name: 'Warden',   ai: 'boss',    hp: 620, spd: 58,  dmg: 9, r: 46, color: '#ff3b6b', mats: 40, minWave: 5,  boss: true, ringCd: 3.2, ringN: 12, shotSpd: 185 },
  { name: 'Devourer', ai: 'boss',    hp: 1500, spd: 72, dmg: 13, r: 56, color: '#b026ff', mats: 80, minWave: 15, boss: true, ringCd: 2.4, ringN: 24, shotSpd: 210, summon: true },
];

// Which enemy type spawns on which wave, and the boss for boss waves.
export function bossForWave(w) { return w >= 15 ? 9 : 8; }

export const SIGNAL_PREFIX = 'brtoi-';   // PeerJS ids are namespaced to avoid clashes
export const PROTO_VERSION = 7;
