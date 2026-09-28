// ---------------------------------------------------------------------------
// The authoritative simulation. Exactly one peer (the host) runs this; every
// other peer just renders the snapshots it produces.
//
// The sim runs at a fixed 30 Hz and emits one snapshot per tick. Fixed-step is
// what makes the host's own view identical to a remote client's - the host
// consumes its own snapshots through the same pipeline instead of reading the
// simulation directly, so a bug that only shows up over the network cannot
// hide from whoever is hosting.
// ---------------------------------------------------------------------------

import {
  ARENA, BASE_STATS, CHARACTERS, WEAPONS, WEAPON_IDS, ITEMS, ITEM_BY_ID, UPGRADES,
  ENEMIES, MAX_WAVE, HARD_WAVE_CAP, MAX_WEAPONS, MAX_WEAPON_LVL, DANGER, TRADE_TAX, UPGRADE_TIER_LEVEL,
  bossForWave, bossCountForWave, waveDuration, setBonusMods, effectMap,
  weaponAt, weaponName, regenPerSec,
} from './data.js';
import { FX, PROJ_KINDS } from './protocol.js';

export const TICK = 1 / 30;
export const PHASE = { LOBBY: 0, WAVE: 1, SHOP: 2, OVER: 3 };

const TAU = Math.PI * 2;
const BASE_SPEED = 235;
const PLAYER_R = 14;
const PICKUP_BASE = 46;
// Brotato's window: 0.2s for a scratch, up to 0.4s for a hit worth a fifth of
// your health. The old flat 0.55s capped intake at under two hits a second no
// matter how many enemies were touching you, which is what made parking in a
// crowd survivable.
const IFRAME_MIN = 0.2, IFRAME_MAX = 0.4;
// Enemies appear anywhere on the field, telegraphed, never on top of a player.
// Edge-only spawns made the middle of the arena the one place nothing reached.
const SPAWN_WARN = 1.0;
const SPAWN_SAFE = 230;
const LIFESTEAL_CD = 0.1;   // at most 10 HP/s from lifesteal, as in Brotato
const SHOP_TIMEOUT = 150;
const INPUT_Q_TARGET = 1;   // spare frames of input the host will sit on
const MAX_INPUT_Q = 4;      // hard cap, so a stalled client cannot bank movement

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const kindIdx = (k) => PROJ_KINDS.indexOf(k);

// --- deterministic-ish rng so a host restart doesn't reuse the same waves ---
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- uniform spatial hash: enemy separation and bullet hits are both O(n) ---
const CELL = 72;
const OFF = 16; // shift so entities briefly outside the arena still hash sanely
class Grid {
  constructor() { this.m = new Map(); }
  clear() { this.m.clear(); }
  _k(x, y) { return (((y / CELL) | 0) + OFF) * 4096 + (((x / CELL) | 0) + OFF); }
  add(o) {
    const k = this._k(o.x, o.y);
    const a = this.m.get(k);
    if (a) a.push(o); else this.m.set(k, [o]);
  }
  query(x, y, r, out) {
    out.length = 0;
    const x0 = ((x - r) / CELL | 0) + OFF, x1 = ((x + r) / CELL | 0) + OFF;
    const y0 = ((y - r) / CELL | 0) + OFF, y1 = ((y + r) / CELL | 0) + OFF;
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const a = this.m.get(gy * 4096 + gx);
        if (a) for (let i = 0; i < a.length; i++) out.push(a[i]);
      }
    }
    return out;
  }
}

export class World {
  /**
   * @param send (playerId|null, msg) -> void   null broadcasts
   * @param hostId the one player allowed to change run settings (danger, continue)
   */
  constructor(send, hostId = 1) {
    this.send = send;
    this.hostId = hostId;
    this.rng = mulberry((Math.random() * 4294967295) >>> 0);
    this.tick = 0;
    this.phase = PHASE.LOBBY;
    this.wave = 0;
    this.danger = 0;
    this.trade = false;     // host option: teammates may send materials in the shop
    this.endless = false;   // set once the squad continues past MAX_WAVE
    this.blasts = [];       // Volatile explosions queued this tick, resolved once
    this.timeLeft = 0;
    this.players = new Map();
    this.enemies = [];
    this.incoming = [];     // telegraphed spawns: visible, not yet in the fight
    this.projs = [];
    this.pickups = [];
    this.fx = [];
    this.nextId = 1;
    this.spawnAcc = 0;
    this.deadCount = 0;
    this.grid = new Grid();
    this._scratch = [];
    this.result = null;
    // Set by the owner of this World so a kick can also cut the wire. The
    // simulation can drop a player from the roster but knows nothing about
    // peer connections, and a kicked player who kept their data channel would
    // simply be seated again by the next join.
    this.onKick = null;
  }

  // =========================================================================
  // Roster
  // =========================================================================
  addPlayer(id, name) {
    const p = {
      id, name: name || `Player ${id}`, char: 0,
      x: ARENA.w / 2 + (this.players.size - 1) * 60, y: ARENA.h / 2,
      ang: 0, hp: 10, alive: true, hurtT: 0, iframe: 0, regenAcc: 0, lsCd: 0,
      stats: { ...BASE_STATS }, fx: {},
      weapons: [], items: [], upgrades: [],
      mats: 0, level: 1, xp: 0, xpNeed: xpFor(1),
      pendingLevels: 0, levelOptions: null,
      shop: null, ready: false,
      input: { seq: 0, mx: 0, my: 0, aim: 0 }, inputQ: [],
      ack: 0, connected: true, kills: 0,
      // Per-wave counters (summary line + Momentum) and effect-item state.
      waveKills: 0, waveMats: 0, waveDmg: 0,
      frenzy: 0, frenzyT: 0, adrenT: 0, alchAcc: 0,
      xpAcc: 0, shieldN: 0, drainAcc: 0,
    };
    this.players.set(id, p);
    this.recomputeStats(p);
    p.hp = p.stats.maxHp;
    this.pushLobby();
    return p;
  }

  /**
   * A player dropped. In the lobby they are simply gone; mid-run their slot,
   * build and materials are kept and they spectate, so a refresh can bring
   * them back into the same run. `forget` removes them for good.
   */
  removePlayer(id, forget = false) {
    const p = this.players.get(id);
    if (!p) return;
    if (forget || this.phase === PHASE.LOBBY) {
      this.players.delete(id);
    } else {
      p.connected = false;
      p.alive = false;
      p.ready = false;
      p.inputQ.length = 0;
      p.input = { seq: 0, mx: 0, my: 0, aim: p.ang };
    }
    this.pushLobby();
    if (this.phase !== PHASE.LOBBY && this.players.size === 0) this.phase = PHASE.LOBBY;
    else if (this.phase === PHASE.SHOP) this.maybeStartWave();
  }

  /** The player behind `id` reconnected: bring them up to date with the run. */
  rejoinPlayer(id) {
    const p = this.players.get(id);
    if (!p) return false;
    p.connected = true;
    p.ready = false;
    p.inputQ.length = 0;
    if (this.phase !== PHASE.WAVE) p.alive = true;   // mid-wave they wait for the next one
    this.pushLobby();
    this.pushYou(p);
    // Clients derive their screen from these messages, so replay the one that
    // matches the current phase before anything else.
    if (this.phase === PHASE.WAVE) {
      this.send(id, { t: 'wave', wave: this.wave, dur: waveDuration(this.wave), boss: this.isBossWave(this.wave), danger: this.danger, endless: this.endless });
      this.send(id, { t: 'toast', kind: 'good', msg: 'Reconnected - you are back in at the next wave' });
    } else if (this.phase === PHASE.SHOP) {
      if (!p.shop) this.rollShop(p, true);
      this.send(id, { t: 'shopopen', wave: this.wave, next: this.wave + 1, dur: SHOP_TIMEOUT, summary: { kills: p.waveKills, mats: p.waveMats, dmg: p.waveDmg } });
      this.pushShop(p);
    } else if (this.phase === PHASE.OVER && this.result) {
      this.send(id, { t: 'over', win: this.result.win, wave: this.wave, scores: this.scores(), danger: this.danger, endless: this.endless, canContinue: false });
    }
    this.pushBuilds();
    this.pushLevel(p);
    return true;
  }

  /** Everyone still here is ready: the shop closes. Absent players do not hold it. */
  maybeStartWave() {
    const here = [...this.players.values()].filter((q) => q.connected);
    if (here.length && here.every((q) => q.ready)) this.startWave(this.wave + 1);
  }

  pushLobby() {
    this.send(null, {
      t: 'lobby',
      phase: this.phase,
      danger: this.danger,
      trade: this.trade,
      host: this.hostId,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, char: p.char, ready: p.ready, connected: p.connected,
      })),
    });
  }

  /**
   * Everyone's build, for the spectator panel.
   *
   * Only sent when a build can have changed - a wave boundary - because a
   * spectator watching a live fight needs to know what the potato they are
   * following is carrying, and that answer is stable for a whole wave. Health
   * and position are already in the 30 Hz snapshot; putting inventories there
   * too would triple its size to restate something that never moves.
   */
  pushBuilds() {
    this.send(null, {
      t: 'builds',
      players: [...this.players.values()].map((p) => ({
        id: p.id, level: p.level,
        weapons: p.weapons.map((w) => ({ id: w.id, lvl: w.lvl })),
      })),
    });
  }

  /**
   * Throw a player out for good.
   *
   * Unlike a disconnect this must NOT leave a reclaimable slot behind: the
   * whole point is that they do not come back. `removePlayer(id, true)` forgets
   * the seat inside the simulation and `onKick` does the same on the wire.
   */
  kick(id) {
    const p = this.players.get(id);
    if (!p || id === this.hostId) return false;
    const name = p.name;
    this.removePlayer(id, true);
    this.onKick?.(id, name);
    this.send(null, { t: 'toast', kind: 'warn', msg: `${name} was removed by the host` });
    return true;
  }

  // =========================================================================
  // Control messages from clients (reliable channel)
  // =========================================================================
  onControl(pid, msg) {
    const p = this.players.get(pid);
    if (!p) return;
    switch (msg.t) {
      case 'char':
        if (this.phase === PHASE.LOBBY && msg.id >= 0 && msg.id < CHARACTERS.length) {
          p.char = msg.id | 0;
          this.applyCharacter(p);
          this.pushLobby();
          this.pushYou(p);
        }
        break;
      case 'ready':
        p.ready = !!msg.v;
        this.pushLobby();
        if (this.phase === PHASE.LOBBY
          && [...this.players.values()].filter((q) => q.connected).every((q) => q.ready)) {
          this.startRun();
        }
        break;
      case 'buy':     this.buy(p, msg.slot); break;
      case 'sell':    this.sell(p, msg.kind, msg.idx); break;
      case 'reroll':  this.reroll(p); break;
      case 'lock':
        if (this.phase === PHASE.SHOP && p.shop && p.shop.offers[msg.slot] && !p.shop.offers[msg.slot].sold) {
          p.shop.locked[msg.slot] = !p.shop.locked[msg.slot];
          this.pushShop(p);
        }
        break;
      case 'shopready':
        if (this.phase === PHASE.SHOP) {
          p.ready = !!msg.v;
          this.pushLobby();
          this.maybeStartWave();
        }
        break;
      case 'levelpick': this.pickUpgrade(p, msg.idx); break;
      case 'restart':
        if (this.phase === PHASE.OVER) this.resetToLobby();
        break;
      case 'danger':
        // Run settings belong to the host; the lobby is the only place they change.
        if (pid === this.hostId && this.phase === PHASE.LOBBY) {
          this.danger = clamp(msg.v | 0, 0, DANGER.length - 1);
          // Danger feeds harvesting, so every stat sheet changes with it.
          for (const q of this.players.values()) { this.recomputeStats(q); this.pushYou(q); }
          this.pushLobby();
        }
        break;
      case 'trade':
        if (pid === this.hostId && this.phase === PHASE.LOBBY) {
          this.trade = !!msg.v;
          this.pushLobby();
        }
        break;
      case 'give': this.give(p, msg.to | 0, msg.amt | 0); break;
      case 'kick':
        // Moderation is the host's alone, and the host cannot kick themselves.
        if (pid === this.hostId) this.kick(msg.id | 0);
        break;
      case 'forcestart':
        // An AFK player should not be able to hold eight people hostage, so the
        // host can close the lobby or the shop without a full house of readies.
        if (pid !== this.hostId) break;
        if (this.phase === PHASE.LOBBY && this.players.size) this.startRun();
        else if (this.phase === PHASE.SHOP) this.startWave(this.wave + 1);
        break;
      case 'continue':
        // Past the win line the squad may keep going with everything they own.
        if (pid === this.hostId && this.phase === PHASE.OVER && this.result?.win
          && this.result.cleared && this.wave < HARD_WAVE_CAP) {
          this.endless = true;
          this.result = null;
          this.startWave(this.wave + 1);
        }
        break;
    }
  }

  /**
   * Queue an input rather than overwrite the current one.
   *
   * The client predicts by replaying every input the host has not acked, one
   * simulation tick each. That only matches reality if the host also consumes
   * exactly one input per tick - overwriting meant two inputs arriving between
   * ticks silently lost one, and the client's replay then disagreed with the
   * host on every jittery packet.
   */
  setInput(pid, inp) {
    const p = this.players.get(pid);
    if (!p) return;
    if (inp.seq <= p.ack) return;                        // already consumed
    const q = p.inputQ;
    if (q.length && inp.seq <= q[q.length - 1].seq) {     // dup from redundancy
      if (q.some((o) => o.seq === inp.seq)) return;
      q.push(inp);
      q.sort((a, b) => a.seq - b.seq);
      return;
    }
    q.push(inp);
    if (q.length > MAX_INPUT_Q) q.splice(0, q.length - MAX_INPUT_Q);
  }

  /**
   * Take one queued input per tick, which is what makes the client's replay
   * match the host's integration exactly.
   *
   * The catch is that anything sitting in this queue is latency the player
   * feels directly. Two machines never tick at exactly the same rate, so a
   * client producing input a hair faster than the host consumes it will fill
   * any queue you give it - measured at 200ms of self-inflicted lag before
   * this drain existed. So keep at most one spare frame and burn through the
   * rest; the small prediction error that causes is smoothed by reconcile().
   */
  consumeInput(p) {
    const q = p.inputQ;
    if (!q.length) return;                 // starved: repeat the last input
    while (q.length > INPUT_Q_TARGET) { p.input = q.shift(); p.ack = p.input.seq; }
    p.input = q.shift();
    p.ack = p.input.seq;
  }

  // =========================================================================
  // Run lifecycle
  // =========================================================================
  applyCharacter(p) {
    const c = CHARACTERS[p.char];
    p.weapons = [{ id: c.weapon, lvl: 1, cd: 0 }];
    p.items = [];
    p.upgrades = [];
    this.recomputeStats(p);
    p.hp = p.stats.maxHp;
  }

  startRun() {
    for (const p of this.players.values()) {
      p.mats = 0; p.level = 1; p.xp = 0; p.xpNeed = xpFor(1);
      p.pendingLevels = 0; p.levelOptions = null; p.kills = 0;
      p.inputQ.length = 0;
      this.applyCharacter(p);
    }
    this.wave = 0;
    this.result = null;
    this.endless = false;
    this.startWave(1);
  }

  resetToLobby() {
    this.phase = PHASE.LOBBY;
    this.wave = 0;
    this.endless = false;
    this.result = null;
    // Whoever never came back is not in the next run.
    for (const p of [...this.players.values()]) if (!p.connected) this.players.delete(p.id);
    this.enemies.length = 0; this.incoming.length = 0; this.projs.length = 0; this.pickups.length = 0;
    for (const p of this.players.values()) {
      p.ready = false;
      p.shop = null;
      p.pendingLevels = 0;
      p.levelOptions = null;
      this.applyCharacter(p);
      this.pushLevel(p);
    }
    this.pushLobby();
    for (const p of this.players.values()) this.pushYou(p);
  }

  startWave(n) {
    this.wave = Math.min(n, HARD_WAVE_CAP);
    this.phase = PHASE.WAVE;
    this.timeLeft = waveDuration(this.wave);
    this.spawnAcc = 0;
    this.enemies.length = 0; this.incoming.length = 0; this.projs.length = 0; this.pickups.length = 0;
    this.blasts.length = 0;
    this.bossSpawned = false;

    let i = 0;
    for (const p of this.players.values()) {
      p.ready = false;
      p.alive = p.connected;   // a dropped player sits out until they are back
      // Every wave starts at full health, so a wave is a self-contained test
      // and chip damage from three waves ago cannot decide this one.
      p.hp = p.fx.halfstart ? Math.ceil(p.stats.maxHp * (1 - p.fx.halfstart / 100)) : p.stats.maxHp;
      p.shieldN = p.fx.shield || 0;
      p.iframe = 1.2;
      p.waveKills = 0; p.waveMats = 0; p.waveDmg = 0;
      p.frenzy = 0; p.frenzyT = 0; p.adrenT = 0;
      const a = (i / Math.max(1, this.players.size)) * TAU;
      p.x = ARENA.w / 2 + Math.cos(a) * 70;
      p.y = ARENA.h / 2 + Math.sin(a) * 70;
      for (const w of p.weapons) w.cd = 0;
      this.pushYou(p);
      i++;
    }
    this.send(null, {
      t: 'wave', wave: this.wave, dur: this.timeLeft, boss: this.isBossWave(this.wave),
      danger: this.danger, endless: this.endless,
    });
    this.pushLobby();
    this.pushBuilds();
    for (const p of this.players.values()) this.pushLevel(p);
  }

  isBossWave(n) { return n % 5 === 0; }

  endWave() {
    // Wave over: sweep the field, hand out whatever is still lying around.
    for (const pk of this.pickups) {
      const p = this.nearestPlayer(pk.x, pk.y, true) || this.nearestPlayer(pk.x, pk.y, false);
      if (p) this.collect(p, pk);
    }
    this.pickups.length = 0;
    this.enemies.length = 0;
    this.incoming.length = 0;
    this.projs.length = 0;
    this.blasts.length = 0;

    // Piggy Bank pays out before the shop opens, so the bonus is spendable now.
    for (const p of this.players.values()) {
      const rate = p.fx.interest || 0;
      if (rate > 0 && p.mats > 0) {
        const bonus = Math.min(40, Math.floor(p.mats * rate / 100));
        if (bonus > 0) {
          p.mats += bonus; p.waveMats += bonus;
          this.send(p.id, { t: 'toast', kind: 'good', msg: `Piggy Bank: +${bonus} materials` });
        }
      }
    }

    // The win line. Past it (endless) the run only ends on a wipe.
    if (this.wave === MAX_WAVE && !this.endless) { this.finish(true, true); return; }
    if (this.wave >= HARD_WAVE_CAP) { this.finish(true, false); return; }

    this.phase = PHASE.SHOP;
    this.timeLeft = SHOP_TIMEOUT;
    for (const p of this.players.values()) {
      p.ready = false;
      p.alive = p.connected;
      p.hp = p.stats.maxHp;
      this.rollShop(p, true);
      this.pushYou(p);
      this.send(p.id, {
        t: 'shopopen', wave: this.wave, next: this.wave + 1, dur: SHOP_TIMEOUT,
        summary: { kills: p.waveKills, mats: p.waveMats, dmg: p.waveDmg },
      });
    }
    this.pushLobby();
    for (const p of this.players.values()) this.pushLevel(p);
  }

  /**
   * End the run. A wipe in endless still counts as a win (the line was
   * crossed) but only a cleared wave can be continued from.
   */
  finish(win, cleared) {
    this.phase = PHASE.OVER;
    this.result = { win, wave: this.wave, cleared: !!cleared };
    this.send(null, {
      t: 'over', win, wave: this.wave, scores: this.scores(),
      danger: this.danger, endless: this.endless,
      canContinue: win && !!cleared && this.wave < HARD_WAVE_CAP,
    });
  }

  scores() {
    return [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, char: p.char, kills: p.kills, level: p.level, mats: p.mats }))
      .sort((a, b) => b.kills - a.kills);
  }

  // =========================================================================
  // Stats
  // =========================================================================
  recomputeStats(p) {
    const s = { ...BASE_STATS };
    const add = (mods) => { for (const k in mods) s[k] = (s[k] || 0) + mods[k]; };
    add(CHARACTERS[p.char].mods);
    for (const id of p.items) { const it = ITEM_BY_ID[id]; if (it && it.mods) add(it.mods); }
    for (const u of p.upgrades) add(u);
    add(setBonusMods(p.weapons));
    s.harvest += DANGER[this.danger].harvest;
    p.fx = effectMap(p.items);
    s.maxHp = Math.max(1, s.maxHp);
    s.dodge = clamp(s.dodge, 0, 60 + (p.fx.dodgecap || 0));
    s.crit = clamp(s.crit, 0, 100);
    s.speed = Math.max(-70, s.speed);
    p.stats = s;
    if (p.hp > s.maxHp) p.hp = s.maxHp;
  }

  // =========================================================================
  // Shop
  // =========================================================================
  shopTierRoll(luck) {
    const w = this.wave;
    const l = 1 + luck / 100;
    const weights = [
      Math.max(4, 100 - w * 6),
      Math.max(6, 22 + w * 3) * l,
      Math.max(0, (w - 3) * 3) * l,
      Math.max(0, (w - 7) * 1.4) * l,
    ];
    const tot = weights.reduce((a, b) => a + b, 0);
    let r = this.rng() * tot;
    for (let i = 0; i < 4; i++) { r -= weights[i]; if (r <= 0) return i; }
    return 0;
  }

  rollOffer(p) {
    const tier = this.shopTierRoll(p.stats.luck);
    const wantWeapon = this.rng() < (p.weapons.length < MAX_WEAPONS ? 0.42 : 0.18);
    const pool = wantWeapon
      ? WEAPON_IDS.filter((k) => WEAPONS[k].tier === tier + 1)
      // An effect item is one-per-player, and offering one you own twice
      // would be a dead card.
      : ITEMS.filter((i) => i.tier === tier + 1 && !(i.unique && p.items.includes(i.id)));
    if (!pool.length) return this.rollOffer(p);
    const pick = pool[(this.rng() * pool.length) | 0];
    const def = wantWeapon ? WEAPONS[pick] : pick;
    const id = wantWeapon ? pick : pick.id;
    return {
      kind: wantWeapon ? 'weapon' : 'item',
      id,
      name: def.name,
      tier: def.tier - 1,
      price: Math.ceil(def.price * priceScale(this.wave) * (1 - Math.min(25, p.fx.coupon || 0) / 100)),
      mods: wantWeapon ? null : (def.mods || null),
      desc: wantWeapon ? null : (def.desc || null),
      sold: false,
    };
  }

  /**
   * @param fresh true when a new shop opens (resets the reroll price ladder).
   *              Locks deliberately survive that: locking something you cannot
   *              afford yet is only useful if it is still there next wave.
   */
  rollShop(p, fresh) {
    if (!p.shop) p.shop = { offers: [null, null, null, null], locked: [false, false, false, false], rerolls: 0 };
    if (fresh) p.shop.rerolls = 0;
    for (let i = 0; i < 4; i++) {
      if (p.shop.offers[i] && p.shop.offers[i].sold) p.shop.locked[i] = false;
      if (p.shop.locked[i] && p.shop.offers[i]) continue;
      p.shop.offers[i] = this.rollOffer(p);
    }
    this.pushShop(p);
  }

  /** True once every slot is bought out - there is nothing left to reroll for. */
  shopCleared(p) {
    return !!p.shop && p.shop.offers.every((o) => !o || o.sold);
  }

  rerollCost(p) {
    if (this.shopCleared(p)) return 0;   // cleared the shop: the next roll is on us
    return Math.ceil((3 + this.wave * 0.9) * (1 + p.shop.rerolls * 0.55));
  }

  reroll(p) {
    if (this.phase !== PHASE.SHOP || !p.shop) return;
    const cost = this.rerollCost(p);
    if (p.mats < cost) return;
    p.mats -= cost;
    // A free roll does not advance the price ladder, so clearing the shop is
    // worth doing rather than something you fall into.
    if (cost > 0) p.shop.rerolls++;
    this.rollShop(p, false);
    this.pushYou(p);
  }

  /** Would buying a fresh `id` immediately merge with something already owned? */
  wouldMerge(p, id) {
    return p.weapons.some((w) => w.id === id && w.lvl === 1);
  }

  /**
   * Brotato-style combining: two identical weapons at the same level fuse into
   * one at the next level. Runs to a fixed point, so a merge that produces a
   * pair one level up cascades in the same step.
   */
  combineWeapons(p) {
    for (;;) {
      let a = -1, b = -1;
      for (let i = 0; i < p.weapons.length && a < 0; i++) {
        for (let j = i + 1; j < p.weapons.length; j++) {
          if (p.weapons[i].id === p.weapons[j].id
            && p.weapons[i].lvl === p.weapons[j].lvl
            && p.weapons[i].lvl < MAX_WEAPON_LVL) { a = i; b = j; break; }
        }
      }
      if (a < 0) return;
      p.weapons[a].lvl++;
      p.weapons[a].cd = 0;
      p.weapons.splice(b, 1);
      this.send(p.id, {
        t: 'toast', kind: 'good',
        msg: `Combined into ${weaponName(p.weapons[a].id, p.weapons[a].lvl)}`,
      });
    }
  }

  buy(p, slot) {
    if (this.phase !== PHASE.SHOP || !p.shop) return;
    const o = p.shop.offers[slot];
    if (!o || o.sold || p.mats < o.price) return;
    // A duplicate is always allowed at full slots: it merges instead of adding.
    if (o.kind === 'weapon' && p.weapons.length >= MAX_WEAPONS && !this.wouldMerge(p, o.id)) {
      this.send(p.id, { t: 'toast', msg: 'Weapon slots full - sell one first' });
      return;
    }
    p.mats -= o.price;
    o.sold = true;
    p.shop.locked[slot] = false;
    if (o.kind === 'weapon') { p.weapons.push({ id: o.id, lvl: 1, cd: 0 }); this.combineWeapons(p); }
    else p.items.push(o.id);
    this.recomputeStats(p);
    this.pushShop(p);
    this.pushYou(p);
  }

  sell(p, kind, idx) {
    if (this.phase !== PHASE.SHOP) return;
    if (kind === 'weapon') {
      if (p.weapons.length <= 1 || !p.weapons[idx]) return;
      const w = p.weapons[idx];
      p.weapons.splice(idx, 1);
      p.mats += this.sellValue(w);
    } else {
      const id = p.items[idx];
      if (!id) return;
      const def = ITEM_BY_ID[id];
      p.items.splice(idx, 1);
      p.mats += Math.floor((def ? def.price : 10) * 0.5);
    }
    this.recomputeStats(p);
    this.pushYou(p);
  }

  /**
   * Hand materials to a teammate, minus TRADE_TAX. Shop only, so nothing
   * changes hands mid-fight, and never to someone who left: their slot keeps
   * its build but a gift would just vanish into it.
   */
  give(p, to, amt) {
    if (!this.trade || this.phase !== PHASE.SHOP) return;
    const q = this.players.get(to);
    if (!q || q === p || !q.connected) return;
    amt = Math.min(amt, p.mats);
    const got = Math.floor(amt * (1 - TRADE_TAX));
    if (got < 1) return;
    p.mats -= amt;
    q.mats += got;
    this.pushYou(p);
    this.pushYou(q);
    this.send(p.id, { t: 'toast', kind: 'good', msg: `Sent ${got} materials to ${q.name} (${amt - got} tax)` });
    this.send(q.id, { t: 'toast', kind: 'good', msg: `${p.name} sent you ${got} materials` });
  }

  /** Half price, doubled per level, since each level swallowed two weapons. */
  sellValue(w) {
    return Math.floor(WEAPONS[w.id].price * 0.5 * Math.pow(2, (w.lvl || 1) - 1));
  }

  pushShop(p) {
    if (!p.shop) return;
    this.send(p.id, {
      t: 'shop', offers: p.shop.offers, locked: p.shop.locked,
      reroll: this.rerollCost(p),
    });
  }

  /** Small, high-frequency counters. The heavy 'you' payload stays event-driven. */
  pushVitals(p) {
    this.send(p.id, { t: 'v', mats: p.mats, xp: p.xp, xpNeed: p.xpNeed, level: p.level, kills: p.kills });
  }

  pushYou(p) {
    this.send(p.id, {
      t: 'you',
      id: p.id, char: p.char, stats: p.stats, mats: p.mats,
      level: p.level, xp: p.xp, xpNeed: p.xpNeed,
      weapons: p.weapons.map((w) => ({
        id: w.id, lvl: w.lvl, name: weaponName(w.id, w.lvl),
        tier: WEAPONS[w.id].tier, sell: this.sellValue(w),
      })),
      items: p.items.map((id) => {
        const it = ITEM_BY_ID[id];
        return { id, name: it.name, tier: it.tier, mods: it.mods || null, desc: it.desc || null };
      }),
      speed: BASE_SPEED * (1 + p.stats.speed / 100),
      alive: p.alive, kills: p.kills,
    });
  }

  // =========================================================================
  // Levelling
  // =========================================================================
  grantXp(p, n) {
    p.xp += n;
    while (p.xp >= p.xpNeed) {
      p.xp -= p.xpNeed;
      p.level++;
      p.xpNeed = xpFor(p.level);
      p.pendingLevels++;
      this.fx.push({ t: FX.LEVELUP, x: p.x, y: p.y, a: 0 });
    }
    if (p.pendingLevels > 0 && !p.levelOptions) this.offerUpgrades(p);
  }

  offerUpgrades(p) {
    const maxTier = 1 + UPGRADE_TIER_LEVEL.filter(([, lvl]) => p.level >= lvl).length;
    const pool = UPGRADES.filter((u) => u.tier < maxTier);
    const picked = [];
    const seen = new Set();
    let guard = 0;
    while (picked.length < 4 && guard++ < 200) {
      const u = pool[(this.rng() * pool.length) | 0];
      const sig = u.key + u.tier;
      if (seen.has(sig)) continue;
      seen.add(sig);
      picked.push(u);
    }
    p.levelOptions = picked;
    this.pushLevel(p);
  }

  /**
   * (Re)state whether a level-up choice is open. Clients drop their level-up
   * panel whenever the phase changes, so any pending choice has to be restated
   * afterwards or the player silently loses it - and because `levelOptions`
   * stays non-null on the host, every later level-up would be swallowed too.
   */
  pushLevel(p) {
    this.send(p.id, p.levelOptions
      ? { t: 'level', level: p.level, pending: p.pendingLevels, options: p.levelOptions }
      : { t: 'level', options: null });
  }

  pickUpgrade(p, idx) {
    if (!p.levelOptions || !p.levelOptions[idx]) return;
    p.upgrades.push(p.levelOptions[idx].mods);
    const healed = p.levelOptions[idx].mods.maxHp || 0;
    p.levelOptions = null;
    p.pendingLevels--;
    this.recomputeStats(p);
    if (healed > 0) p.hp = Math.min(p.stats.maxHp, p.hp + healed);
    this.pushYou(p);
    if (p.pendingLevels > 0) this.offerUpgrades(p);
    else this.pushLevel(p);
  }

  // =========================================================================
  // Main step
  // =========================================================================
  step() {
    this.tick++;
    this.fx.length = 0;
    // 5 Hz is plenty for counters the eye reads as numbers, and it keeps the
    // reliable channel almost empty for the messages that actually matter.
    if (this.tick % 6 === 0) for (const p of this.players.values()) this.pushVitals(p);

    if (this.phase === PHASE.WAVE) {
      this.timeLeft -= TICK;
      this.stepSpawning();
      this.stepIncoming();
      this.stepPlayers();
      this.stepEnemies();
      this.stepProjectiles();
      this.resolveBlasts();
      this.stepPickups();
      this.sweepDead();
      if (this.timeLeft <= 0) this.endWave();
      else if (![...this.players.values()].some((p) => p.alive)) this.finish(this.endless, false);
    } else if (this.phase === PHASE.SHOP) {
      this.timeLeft -= TICK;
      this.stepPlayers();
      if (this.timeLeft <= 0) this.startWave(this.wave + 1);
    } else if (this.phase === PHASE.LOBBY) {
      this.stepPlayers();
    }
  }

  // ------------------------------------------------------------------ spawn
  stepSpawning() {
    const np = Math.max(1, [...this.players.values()].filter((p) => p.alive).length);
    const dg = DANGER[this.danger];
    if (this.isBossWave(this.wave) && !this.bossSpawned) {
      this.bossSpawned = true;
      const n = bossCountForWave(this.wave);
      for (let i = 0; i < n; i++) this.spawnEnemy(bossForWave(this.wave), false);
    }
    // Front-load spawns a little so the wave has bite immediately.
    // Bait: every copy anyone carries thickens the wave for the whole squad.
    let crowd = 0;
    for (const p of this.players.values()) if (p.alive) crowd += p.fx.crowd || 0;
    const cap = Math.round((26 + Math.min(this.wave, 30) * 3.2) * (0.65 + 0.35 * np) * (1 + crowd / 200));
    const alive = () => this.enemies.length + this.incoming.length;
    if (alive() >= cap) { this.spawnAcc = Math.min(this.spawnAcc, 1); return; }

    // Gentle for the first few waves (starter weapons kill about one enemy a
    // second), bending upward so the late game is dense. Waves 1-5 see roughly
    // 15, 22, 32, 45, 60 spawns.
    const wv = this.wave;
    const rate = (1 + crowd / 100) * Math.min(6.5, 0.5 + wv * 0.22 + wv * wv * 0.006) * dg.spawn * (0.6 + 0.4 * np)
      * (this.isBossWave(this.wave) ? 0.45 : 1);
    this.spawnAcc += rate * TICK;
    while (this.spawnAcc >= 1 && alive() < cap) {
      this.spawnAcc -= 1;
      const type = this.pickEnemyType();
      const def = ENEMIES[type];
      const count = def.pack ? def.pack : 1;
      // A pack is several bodies; charging it as one spawn made the wave the
      // swarmers unlock on drop four times the materials of the one before.
      if (count > 1) this.spawnAcc -= (count - 1) * 0.5;
      const elite = !def.boss && this.rng() < Math.min(0.22, this.wave * 0.012) + dg.elite;
      // A pack lands together, so it reads as one threat rather than six.
      const at = this.spawnPoint();
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU;
        this.spawnEnemy(type, elite, count > 1 ? { x: at.x + Math.cos(a) * 34, y: at.y + Math.sin(a) * 34 } : at);
      }
    }
  }

  pickEnemyType() {
    // Ranged enemies are the ones a player cannot simply outrun, so their
    // share of the field is capped rather than left to the spawn dice.
    let ranged = 0;
    for (const e of this.enemies) if (ENEMIES[e.type].ai === 'shoot') ranged++;
    const rangedFull = ranged >= Math.max(2, this.enemies.length * 0.2);

    const avail = [];
    for (let i = 0; i < ENEMIES.length; i++) {
      const e = ENEMIES[i];
      if (e.boss || e.minWave > this.wave) continue;
      if (rangedFull && e.ai === 'shoot') continue;
      // Newer enemy types get progressively more common than the starter grunt.
      avail.push({ i, w: 1 + (this.wave - e.minWave) * 0.35 });
    }
    const tot = avail.reduce((a, b) => a + b.w, 0);
    let r = this.rng() * tot;
    for (const a of avail) { r -= a.w; if (r <= 0) return a.i; }
    return 0;
  }

  /**
   * A random point on the field at least SPAWN_SAFE from every live player.
   * Standing anywhere, the middle included, means things appear around you.
   */
  spawnPoint() {
    const m = 40;
    let best = null, bestD = -1;
    for (let tries = 0; tries < 14; tries++) {
      const x = m + this.rng() * (ARENA.w - 2 * m);
      const y = m + this.rng() * (ARENA.h - 2 * m);
      let d = Infinity;
      for (const p of this.players.values()) if (p.alive) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
      if (d >= SPAWN_SAFE) return { x, y };
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
    return best;
  }

  /** Telegraphed spawns that have waited long enough join the fight. */
  stepIncoming() {
    if (!this.incoming.length) return;
    let keep = 0;
    for (const e of this.incoming) {
      e.spawnT -= TICK;
      if (e.spawnT <= 0) this.enemies.push(e);
      else this.incoming[keep++] = e;
    }
    this.incoming.length = keep;
  }

  /** @param at optional {x, y}; omitted means a fresh telegraphed spawn point */
  spawnEnemy(type, elite, at) {
    const def = ENEMIES[type];
    const { x, y } = at || this.spawnPoint();

    const np = Math.max(1, this.players.size);
    // Bosses already start with a huge pool; scaling them on the same curve as
    // trash turns wave 20 into a ten-minute damage check.
    const dg = DANGER[this.danger];
    // Endless compounds on top of the linear curve so it does, eventually, end.
    const over = Math.max(0, this.wave - MAX_WAVE);
    const w = this.wave - 1;
    // Linear alone let a finished build coast: weapon levels, stats and set
    // bonuses multiply, so the curve has to bend upward to stay a fight.
    const waveScale = (def.boss ? 1 + w * 0.15 + w * w * 0.01 : 1 + w * 0.2 + w * w * 0.02)
      * Math.pow(1.10, over) * dg.hp;
    const hpScale = waveScale * (1 + 0.28 * (np - 1)) * (elite ? 3.2 : 1);
    const dmgScale = (1 + w * 0.07 + w * w * 0.002) * Math.pow(1.05, over) * dg.dmg * (elite ? 1.5 : 1);

    this.incoming.push({
      id: this.nextId++ & 65535, type, x, y, ang: 0, spawnT: SPAWN_WARN,
      hp: def.hp * hpScale, maxHp: def.hp * hpScale,
      spd: def.spd * (elite ? 0.88 : 1) * (1 + (this.rng() - 0.5) * 0.12),
      dmg: def.dmg * dmgScale,
      r: def.r * (elite ? 1.5 : 1),
      elite, boss: !!def.boss,
      hitT: 0, fireCd: (def.fireCd || 2) * this.rng(),
      state: 0, stateT: 0, vx: 0, vy: 0, touchCd: 0, dead: false,
      mats: Math.round(def.mats * (elite ? 4 : 1)),
    });
  }

  // ----------------------------------------------------------------- players
  stepPlayers() {
    for (const p of this.players.values()) {
      this.consumeInput(p);
      if (!p.alive) continue;
      const st = p.stats;
      if (p.frenzyT > 0) { p.frenzyT -= TICK; if (p.frenzyT <= 0) p.frenzy = 0; }
      if (p.adrenT > 0) p.adrenT -= TICK;
      const adren = p.adrenT > 0 ? (p.fx.adrenaline || 0) : 0;
      const spd = BASE_SPEED * (1 + (st.speed + adren) / 100);
      let { mx, my } = p.input;
      const len = Math.hypot(mx, my);
      if (len > 1) { mx /= len; my /= len; }
      p.x = clamp(p.x + mx * spd * TICK, PLAYER_R, ARENA.w - PLAYER_R);
      p.y = clamp(p.y + my * spd * TICK, PLAYER_R, ARENA.h - PLAYER_R);
      p.ang = p.input.aim;

      if (p.iframe > 0) p.iframe -= TICK;
      if (p.hurtT > 0) p.hurtT -= TICK;

      if (p.lsCd > 0) p.lsCd -= TICK;
      if (st.hpRegen > 0 && p.hp < st.maxHp) {
        p.regenAcc += regenPerSec(st.hpRegen) * TICK;
        if (p.regenAcc >= 1) {
          const n = Math.floor(p.regenAcc);
          p.regenAcc -= n;
          p.hp = Math.min(st.maxHp, p.hp + n);
        }
      }

      if (this.phase === PHASE.WAVE) {
        // Blood Pact: a steady bleed that never finishes the job by itself.
        if (p.fx.drain) {
          p.drainAcc += p.fx.drain * TICK;
          if (p.drainAcc >= 1) { p.drainAcc -= 1; if (p.hp > 1) p.hp -= 1; }
        }
        this.stepWeapons(p);
      }
    }
  }

  stepWeapons(p) {
    const st = p.stats;
    const frenzy = p.frenzy * (p.fx.frenzy || 0);
    const asMul = 1 / Math.max(0.25, 1 + (st.atkSpeed + frenzy) / 100);
    for (const w of p.weapons) {
      const def = weaponAt(w.id, w.lvl);
      w.cd -= TICK;
      if (w.cd > 0) continue;
      const range = def.range * (1 + st.range / 100);
      // Weapons pick the nearest enemy. Facing follows movement and is only
      // cosmetic, so it must never steer the guns.
      const target = this.nearestEnemy(p.x, p.y, range);
      if (!target) continue;
      w.cd = def.cd * asMul;
      // Lifesteal rolls once per attack, as in Brotato. Rolling per enemy hit
      // multiplied it by pellets, pierce and swing width, and made a shotgun
      // or a scythe in a crowd heal faster than anything could hurt you.
      const ls = st.lifesteal + (def.lifesteal || 0);
      if (ls > 0 && p.lsCd <= 0 && p.hp < st.maxHp && this.rng() * 100 < ls) {
        p.lsCd = LIFESTEAL_CD;
        p.hp = Math.min(st.maxHp, p.hp + 1);
        this.fx.push({ t: FX.HEAL, x: p.x, y: p.y, a: 0 });
      }
      const ang = Math.atan2(target.y - p.y, target.x - p.x);
      this.fireWeapon(p, w.id, def, ang, range, w.lvl);
    }
  }

  weaponDamage(p, def) {
    const st = p.stats;
    const flat = def.dmg
      + st.melee * (def.scale.m || 0)
      + st.ranged * (def.scale.r || 0)
      + st.elem * (def.scale.e || 0);
    const momentum = p.fx.momentum ? Math.min(p.fx.momentum, p.waveKills) : 0;
    let dmg = flat * (1 + (st.damage + momentum) / 100);
    const critChance = st.crit + (def.crit || 0);
    const crit = this.rng() * 100 < critChance;
    if (crit) dmg *= st.critMult / 100;
    return { dmg: Math.max(1, dmg), crit };
  }

  fireWeapon(p, id, def, ang, range, lvl) {
    if (def.cls === 'melee') {
      this.projs.push({
        id: this.nextId++ & 65535, kind: 'swing', owner: p.id,
        x: p.x, y: p.y, ang, life: 0.16, maxLife: 0.16,
        range, arc: def.arc, weapon: id, wlvl: lvl || 1, hit: new Set(),
        knock: def.knock || 0,
      });
      return;
    }
    if (def.chain) { this.fireChain(p, def, ang, range); return; }

    const n = def.count || 1;
    for (let i = 0; i < n; i++) {
      const spread = def.spread || 0;
      const jitter = n > 1
        ? (i / (n - 1) - 0.5) * spread * 2 + (this.rng() - 0.5) * spread * 0.4
        : (this.rng() - 0.5) * spread;
      const a = ang + jitter;
      const { dmg, crit } = this.weaponDamage(p, def);
      const life = def.life || range / def.spd;
      this.projs.push({
        id: this.nextId++ & 65535,
        kind: projKindFor(id), owner: p.id,
        x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18,
        vx: Math.cos(a) * def.spd, vy: Math.sin(a) * def.spd,
        ang: a, dmg, crit, life, maxLife: life,
        pierce: def.pierce || 0, aoe: def.aoe || 0,
        bounce: def.aoe ? 0 : (p.fx.ricochet || 0),
        homing: def.homing || 0, r: def.aoe ? 8 : 6,
        hit: new Set(),
        size: def.aoe ? 10 : (def.pierce >= 5 ? 4 : 6),
      });
    }
  }

  fireChain(p, def, ang, range) {
    let from = { x: p.x, y: p.y };
    const hit = new Set();
    let links = def.chain;
    let cur = this.nearestEnemy(p.x, p.y, range);
    while (cur && links-- > 0) {
      hit.add(cur.id);
      const { dmg, crit } = this.weaponDamage(p, def);
      this.fx.push({ t: FX.BEAM, x: from.x, y: from.y, x2: cur.x, y2: cur.y, a: 0 });
      this.damageEnemy(cur, dmg, crit, p, 0, 0);
      from = { x: cur.x, y: cur.y };
      cur = this.nearestEnemy(from.x, from.y, 220, hit);
    }
  }

  // ----------------------------------------------------------------- enemies
  stepEnemies() {
    this.grid.clear();
    for (const e of this.enemies) this.grid.add(e);
    const near = this._scratch;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) continue;
      if (e.hitT > 0) e.hitT -= TICK;
      if (e.touchCd > 0) e.touchCd -= TICK;

      const target = this.nearestPlayer(e.x, e.y, true);
      const def = ENEMIES[e.type];
      let dx = 0, dy = 0;

      if (target) {
        const tx = target.x - e.x, ty = target.y - e.y;
        const d = Math.hypot(tx, ty) || 1;
        e.ang = Math.atan2(ty, tx);

        switch (def.ai) {
          case 'shoot': {
            e.stateT += TICK;
            // Every few seconds a shooter pushes in, so it can be punished.
            const pressing = (e.stateT % 7) > 4.5;
            const keep = pressing ? 120 : def.keep;
            const push = d < keep - 40 ? -1 : d > keep + 40 ? 1 : 0;
            dx = (tx / d) * push;
            dy = (ty / d) * push;
            // strafe so they are not a static firing line
            dx += (-ty / d) * 0.35;
            dy += (tx / d) * 0.35;
            e.fireCd -= TICK;
            if (e.fireCd <= 0 && d < keep + 160) {
              e.fireCd = def.fireCd;
              const shots = def.shots || 1;
              for (let s = 0; s < shots; s++) {
                const a = e.ang + (shots > 1 ? (s / (shots - 1) - 0.5) * (def.spread || 0.3) * 2 : 0);
                this.spawnEnemyShot(e, a, def.shotSpd, e.dmg);
              }
            }
            break;
          }
          case 'charge': {
            e.stateT -= TICK;
            if (e.state === 0) {
              dx = tx / d; dy = ty / d;
              if (d < 260) { e.state = 1; e.stateT = 0.55; }
            } else if (e.state === 1) {           // wind-up telegraph
              if (e.stateT <= 0) {
                e.state = 2; e.stateT = 0.45;
                e.vx = (tx / d) * e.spd * 5.5;
                e.vy = (ty / d) * e.spd * 5.5;
              }
            } else {                               // dash
              e.x += e.vx * TICK; e.y += e.vy * TICK;
              if (e.stateT <= 0) { e.state = 0; e.stateT = 0.8; }
            }
            break;
          }
          case 'explode': {
            dx = tx / d; dy = ty / d;
            if (d < e.r + PLAYER_R + 6) { this.explodeEnemy(e, def); e.dead = true; this.deadCount++; continue; }
            break;
          }
          case 'boss': {
            dx = tx / d; dy = ty / d;
            e.fireCd -= TICK;
            if (e.fireCd <= 0) {
              e.fireCd = def.ringCd;
              for (let s = 0; s < def.ringN; s++) {
                this.spawnEnemyShot(e, (s / def.ringN) * TAU, def.shotSpd, e.dmg * 0.5);
              }
              if (def.summon) for (let s = 0; s < 4; s++) {
                const a = this.rng() * TAU;
                this.spawnEnemy(1, false, {
                  x: clamp(e.x + Math.cos(a) * (e.r + 40), 20, ARENA.w - 20),
                  y: clamp(e.y + Math.sin(a) * (e.r + 40), 20, ARENA.h - 20),
                });
              }
            }
            break;
          }
          default:
            dx = tx / d; dy = ty / d;
        }
      }

      // Soft separation keeps the horde readable instead of one fat blob.
      this.grid.query(e.x, e.y, e.r * 2 + 24, near);
      for (let k = 0; k < near.length; k++) {
        const o = near[k];
        if (o === e || o.dead) continue;
        const ox = e.x - o.x, oy = e.y - o.y;
        const dd = ox * ox + oy * oy;
        const min = e.r + o.r;
        if (dd > 0.01 && dd < min * min) {
          const d2 = Math.sqrt(dd);
          const push = (min - d2) / min;
          dx += (ox / d2) * push * 1.6;
          dy += (oy / d2) * push * 1.6;
        }
      }

      if (e.state !== 2) {
        const l = Math.hypot(dx, dy);
        if (l > 0.001) {
          e.x += (dx / l) * e.spd * TICK;
          e.y += (dy / l) * e.spd * TICK;
        }
      }
      e.x = clamp(e.x, -40, ARENA.w + 40);
      e.y = clamp(e.y, -40, ARENA.h + 40);

      // Contact damage
      if (target && e.touchCd <= 0) {
        const d2 = Math.hypot(target.x - e.x, target.y - e.y);
        if (d2 < e.r + PLAYER_R) {
          if (this.damagePlayer(target, e.dmg)) {
            e.touchCd = 0.6;
            // Thorns: touching you costs them. Landed or dodged alike.
            if (target.fx.thorns) this.damageEnemy(e, target.fx.thorns, false, target, 0, 0);
          }
        }
      }
    }
  }

  /**
   * Volatile: kills queued during the tick explode here, in one pass. Deaths
   * caused by a blast queue further blasts for the *next* pass of this loop,
   * so chain reactions happen without recursing through damageEnemy.
   */
  resolveBlasts() {
    let guard = 0;
    while (this.blasts.length && guard++ < 8) {
      const batch = this.blasts;
      this.blasts = [];
      for (const b of batch) {
        this.fx.push({ t: FX.EXPLODE, x: b.x, y: b.y, a: b.r });
        const near = this.grid.query(b.x, b.y, b.r + 40, []);
        for (const e of near) {
          if (e.dead || e.id === b.src) continue;
          if (Math.hypot(e.x - b.x, e.y - b.y) > b.r + e.r) continue;
          this.damageEnemy(e, b.dmg, false, b.owner, 0, 0);
        }
      }
    }
    this.blasts.length = 0;
  }

  /** Drop everything killed this tick in one pass, before the snapshot. */
  sweepDead() {
    if (!this.deadCount) return;
    this.deadCount = 0;
    const live = [];
    for (const e of this.enemies) if (!e.dead) live.push(e);
    this.enemies = live;
  }

  spawnEnemyShot(e, ang, spd, dmg) {
    this.projs.push({
      id: this.nextId++ & 65535, kind: 'enemy', owner: -1,
      x: e.x + Math.cos(ang) * e.r, y: e.y + Math.sin(ang) * e.r,
      vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      ang, dmg, life: 2.6, maxLife: 2.6, pierce: 0, r: 7, size: 7, hit: new Set(),
    });
  }

  explodeEnemy(e, def) {
    const rad = def.aoe || 90;
    this.fx.push({ t: FX.EXPLODE, x: e.x, y: e.y, a: Math.min(255, rad) });
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (Math.hypot(p.x - e.x, p.y - e.y) < rad) this.damagePlayer(p, e.dmg);
    }
  }

  // ------------------------------------------------------------- projectiles
  stepProjectiles() {
    const near = this._scratch;
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const b = this.projs[i];
      b.life -= TICK;

      if (b.kind === 'swing') {
        // Melee arcs stay glued to their owner and sweep as they age.
        const owner = this.players.get(b.owner);
        if (!owner || !owner.alive || b.life <= 0) { this.projs.splice(i, 1); continue; }
        b.x = owner.x; b.y = owner.y;
        const def = weaponAt(b.weapon, b.wlvl);
        const t = 1 - b.life / b.maxLife;
        const sweep = b.arc * (t - 0.5);
        this.grid.query(b.x, b.y, b.range + 40, near);
        for (const e of near) {
          if (e.dead || b.hit.has(e.id)) continue;
          const dx = e.x - b.x, dy = e.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d > b.range + e.r) continue;
          let da = Math.atan2(dy, dx) - (b.ang + sweep);
          da = Math.atan2(Math.sin(da), Math.cos(da));
          if (Math.abs(da) > b.arc / 2) continue;
          b.hit.add(e.id);
          const { dmg, crit } = this.weaponDamage(owner, def);
          this.damageEnemy(e, dmg, crit, owner, b.knock ? Math.cos(b.ang) * b.knock : 0,
            b.knock ? Math.sin(b.ang) * b.knock : 0);
        }
        continue;
      }

      if (b.homing) {
        const t = this.nearestEnemy(b.x, b.y, 400, b.hit);
        if (t) {
          const want = Math.atan2(t.y - b.y, t.x - b.x);
          let da = want - b.ang;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          b.ang += clamp(da, -b.homing * TICK, b.homing * TICK);
          const sp = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(b.ang) * sp;
          b.vy = Math.sin(b.ang) * sp;
        }
      }

      b.x += b.vx * TICK;
      b.y += b.vy * TICK;

      const out = b.x < -30 || b.y < -30 || b.x > ARENA.w + 30 || b.y > ARENA.h + 30;
      if (b.life <= 0 || out) {
        if (b.aoe && !out) this.detonate(b);
        this.projs.splice(i, 1);
        continue;
      }

      if (b.owner === -1) {
        // Enemy bullet: only players can be hit.
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          if (Math.hypot(p.x - b.x, p.y - b.y) < PLAYER_R + b.r) {
            this.damagePlayer(p, b.dmg);
            this.projs.splice(i, 1);
            break;
          }
        }
        continue;
      }

      const owner = this.players.get(b.owner);
      this.grid.query(b.x, b.y, b.r + 40, near);
      for (const e of near) {
        if (e.dead || b.hit.has(e.id)) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) > e.r + b.r) continue;
        b.hit.add(e.id);
        if (b.aoe) { this.detonate(b); this.projs.splice(i, 1); break; }
        const sp = Math.hypot(b.vx, b.vy) || 1;
        this.damageEnemy(e, b.dmg, b.crit, owner, (b.vx / sp) * 80, (b.vy / sp) * 80);
        this.fx.push({ t: FX.HIT, x: b.x, y: b.y, a: 0 });
        if (b.pierce > 0) { b.pierce--; b.dmg *= 0.88; continue; }
        // Ricochet: a bullet that would die here turns toward a fresh target.
        if (b.bounce > 0) {
          const t = this.nearestEnemy(b.x, b.y, 260, b.hit);
          if (t) {
            b.bounce--;
            b.ang = Math.atan2(t.y - b.y, t.x - b.x);
            b.vx = Math.cos(b.ang) * sp; b.vy = Math.sin(b.ang) * sp;
            b.life = Math.max(b.life, 0.6);
            b.dmg *= 0.8;
            break;
          }
        }
        this.projs.splice(i, 1); break;
      }
    }
  }

  detonate(b) {
    this.fx.push({ t: FX.EXPLODE, x: b.x, y: b.y, a: Math.min(255, b.aoe) });
    const owner = this.players.get(b.owner);
    const near = this.grid.query(b.x, b.y, b.aoe + 40, []);
    for (const e of near) {
      if (e.dead) continue;
      if (Math.hypot(e.x - b.x, e.y - b.y) > b.aoe + e.r) continue;
      this.damageEnemy(e, b.dmg, b.crit, owner, 0, 0);
    }
  }

  // -------------------------------------------------------------- damage
  damageEnemy(e, dmg, crit, owner, kx, ky) {
    if (e.dead) return;
    // Executioner: finish what is already bleeding.
    if (owner && owner.fx.execute && e.hp < e.maxHp * 0.3) dmg *= 1 + owner.fx.execute / 100;
    if (owner && owner.fx.bigGame && (e.boss || e.elite)) dmg *= 1 + owner.fx.bigGame / 100;
    e.hp -= dmg;
    e.hitT = 0.12;
    if (kx || ky) {
      const m = e.boss ? 0.05 : e.elite ? 0.25 : 1;
      e.x += kx * TICK * m * 3;
      e.y += ky * TICK * m * 3;
    }
    this.fx.push({ t: FX.DAMAGE, x: e.x, y: e.y - e.r, x2: crit ? 1 : 0, a: Math.min(255, Math.round(dmg)) });

    if (e.hp <= 0) {
      // Flag now, compact once at the end of the tick. A wave-20 minigun kills
      // dozens of enemies per second and indexOf+splice per corpse was two O(n)
      // passes each; everything downstream already skips `dead`.
      e.dead = true;
      this.deadCount++;
      this.fx.push({ t: FX.DEATH, x: e.x, y: e.y, a: Math.min(255, Math.round(e.r * 2)), x2: e.type + 1 });
      if (owner) {
        owner.kills++;
        owner.waveKills++;
        if (owner.fx.frenzy) { owner.frenzy = Math.min(8, owner.frenzy + 1); owner.frenzyT = 3; }
        if (owner.fx.frag) {
          this.blasts.push({
            x: e.x, y: e.y, r: e.boss ? 140 : 70, src: e.id, owner,
            dmg: Math.max(1, e.maxHp * owner.fx.frag / 100),
          });
        }
      }
      if (e.boss) {
        // A dead boss is worth more than its materials: a free item.
        this.pickups.push({
          id: this.nextId++ & 65535, type: 2, x: e.x, y: e.y, vx: 0, vy: 0, value: 0, life: 60,
        });
      }
      const harvest = owner ? owner.stats.harvest : 0;
      // Late waves hold several times the enemies of early ones, and every
      // material is also XP, so a flat drop rate made wave 19 pay for two
      // legendaries and three levels. Each kill is worth a little less as the
      // run goes on; probabilistic rounding keeps the average exact.
      const mv = e.mats * matScale(this.wave);
      let n = Math.floor(mv) + (this.rng() < mv % 1 ? 1 : 0);
      if (crit && owner && owner.fx.trophy && this.rng() * 100 < owner.fx.trophy) n++;
      const bonus = harvest / 100;
      n += Math.floor(bonus) + (this.rng() < bonus % 1 ? 1 : 0);
      const drops = Math.min(n, 4);
      for (let i = 0; i < drops; i++) {
        const a = this.rng() * TAU;
        this.pickups.push({
          id: this.nextId++ & 65535, type: 0,
          x: e.x, y: e.y,
          vx: Math.cos(a) * 70, vy: Math.sin(a) * 70,
          // The last drop carries the remainder so nothing is lost to rounding.
          value: i === drops - 1 ? n - (drops - 1) : 1, life: 30,
        });
      }
      const kit = owner ? owner.fx.medkit : 0;
      // Thinned with the wave like materials: a late wave kills hundreds.
      const healChance = (0.03 + (owner ? owner.stats.luck / 2500 : 0)) * (kit ? 3 : 1) * matScale(this.wave);
      if (this.rng() < healChance) {
        this.pickups.push({
          id: this.nextId++ & 65535, type: 1, x: e.x, y: e.y,
          vx: 0, vy: 0, value: kit || 3, life: 30,
        });
      }
    }
  }

  /** @returns true when the hit actually landed (used for touch cooldowns) */
  damagePlayer(p, raw) {
    if (!p.alive || p.iframe > 0) return false;
    const st = p.stats;
    if (st.dodge > 0 && this.rng() * 100 < st.dodge) {
      this.fx.push({ t: FX.DODGE, x: p.x, y: p.y, a: 0 });
      p.iframe = 0.12;
      return true;
    }
    if (p.shieldN > 0) {
      // Tardigrade: the hit happens, it just does not count.
      p.shieldN--;
      this.fx.push({ t: FX.DODGE, x: p.x, y: p.y, a: 0 });
      p.iframe = IFRAME_MAX;
      return true;
    }
    const reduce = st.armor >= 0
      ? st.armor / (st.armor + 22)
      : st.armor / 22;                       // negative armor amplifies
    const dmg = Math.max(1, Math.round(raw * (1 - reduce)));
    p.hp -= dmg;
    p.waveDmg += dmg;
    p.hurtT = 0.25;
    p.iframe = IFRAME_MIN + (IFRAME_MAX - IFRAME_MIN) * Math.min(1, dmg / (st.maxHp * 0.2));
    if (p.fx.adrenaline) p.adrenT = 2;
    this.fx.push({ t: FX.DAMAGE, x: p.x, y: p.y - 22, x2: 0, a: Math.min(255, dmg) });
    if (p.hp <= 0) {
      p.hp = 0;
      p.alive = false;
      this.fx.push({ t: FX.DEATH, x: p.x, y: p.y, a: 60, x2: 0 });
      this.send(null, { t: 'down', id: p.id, name: p.name });
      this.pushYou(p);
    }
    return true;
  }

  // -------------------------------------------------------------- pickups
  stepPickups() {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.life -= TICK;
      pk.x += pk.vx * TICK;
      pk.y += pk.vy * TICK;
      pk.vx *= 0.88; pk.vy *= 0.88;
      pk.x = clamp(pk.x, 8, ARENA.w - 8);
      pk.y = clamp(pk.y, 8, ARENA.h - 8);

      const p = this.nearestPlayer(pk.x, pk.y, true);
      if (!p) continue;
      const rad = PICKUP_BASE * (1 + p.stats.pickup / 100);
      const d = Math.hypot(p.x - pk.x, p.y - pk.y);
      if (d < rad) {
        // magnet toward the player, then collect on contact
        const s = 340 * (1 - d / rad) + 120;
        pk.vx += ((p.x - pk.x) / d) * s * TICK * 8;
        pk.vy += ((p.y - pk.y) / d) * s * TICK * 8;
      }
      if (d < PLAYER_R + 10 || pk.life <= 0) {
        if (d < PLAYER_R + 10) this.collect(p, pk);
        this.pickups.splice(i, 1);
      }
    }
  }

  collect(p, pk) {
    if (pk.type === 0) {
      p.mats += pk.value;
      p.waveMats += pk.value;
      if (p.fx.xp) {
        p.xpAcc += pk.value * (1 + p.fx.xp / 100);
        const n = Math.floor(p.xpAcc);
        p.xpAcc -= n;
        this.grantXp(p, n);
      } else this.grantXp(p, pk.value);
      this.fx.push({ t: FX.PICKUP, x: p.x, y: p.y, a: 0 });
      if (p.fx.alchemy) {
        p.alchAcc += pk.value;
        const heal = Math.floor(p.alchAcc / p.fx.alchemy);
        if (heal > 0 && p.alive) {
          p.alchAcc -= heal * p.fx.alchemy;
          if (p.hp < p.stats.maxHp) {
            p.hp = Math.min(p.stats.maxHp, p.hp + heal);
            this.fx.push({ t: FX.HEAL, x: p.x, y: p.y, a: 0 });
          }
        }
      }
    } else if (pk.type === 1) {
      p.hp = Math.min(p.stats.maxHp, p.hp + pk.value);
      this.fx.push({ t: FX.HEAL, x: p.x, y: p.y, a: 0 });
    } else if (pk.type === 2) {
      this.openCrate(p);
    }
  }

  /** Boss loot: a free item of rare-or-better quality, straight into the bag. */
  openCrate(p) {
    const pool = ITEMS.filter((i) => (i.tier === 2 || i.tier === 3)
      && !(i.unique && p.items.includes(i.id)));
    if (!pool.length) return;
    const it = pool[(this.rng() * pool.length) | 0];
    p.items.push(it.id);
    this.recomputeStats(p);
    this.fx.push({ t: FX.LEVELUP, x: p.x, y: p.y, a: 0 });
    this.send(p.id, { t: 'toast', kind: 'good', msg: `Boss loot: ${it.name}` });
    this.pushYou(p);
  }

  // -------------------------------------------------------------- queries
  nearestEnemy(x, y, range, exclude, aim, cone) {
    let best = null, bd = range * range;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (exclude && exclude.has(e.id)) continue;
      const dx = e.x - x, dy = e.y - y;
      const d = dx * dx + dy * dy;
      if (d >= bd) continue;
      if (cone !== undefined) {
        let da = Math.atan2(dy, dx) - aim;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > cone) continue;
      }
      bd = d; best = e;
    }
    return best;
  }

  nearestPlayer(x, y, aliveOnly) {
    let best = null, bd = Infinity;
    for (const p of this.players.values()) {
      if (aliveOnly && !p.alive) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // Snapshot size is a network budget, not a rendering one. These caps bound
  // the worst case (a wave-20 minigun build) instead of letting one player's
  // build decide everybody's bandwidth.
  trim() {
    const MAX_PROJ = 220, MAX_PICKUP = 180, MAX_FX = 48;
    if (this.projs.length > MAX_PROJ) this.projs.splice(0, this.projs.length - MAX_PROJ);
    if (this.pickups.length > MAX_PICKUP) {
      // Oldest drops are furthest from the action: bank them rather than bin them.
      const excess = this.pickups.splice(0, this.pickups.length - MAX_PICKUP);
      for (const pk of excess) {
        const p = this.nearestPlayer(pk.x, pk.y, true);
        if (p) this.collect(p, pk);
      }
    }
    if (this.fx.length > MAX_FX) {
      // Damage numbers are the most numerous and least essential effect.
      const keep = this.fx.filter((f) => f.t !== FX.DAMAGE);
      const nums = this.fx.filter((f) => f.t === FX.DAMAGE);
      this.fx = keep.concat(nums.slice(0, Math.max(0, MAX_FX - keep.length))).slice(0, MAX_FX);
    }
  }

  // -------------------------------------------------------------- snapshot
  snapshot() {
    this.trim();
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.id, x: Math.round(p.x), y: Math.round(p.y), ang: p.ang,
        hp: p.hp, maxHp: p.stats.maxHp, char: p.char, ack: p.ack,
        flags: (p.alive ? 0 : 1) | (p.hurtT > 0 ? 2 : 0) | (p.iframe > 0 ? 4 : 0),
      });
    }
    const enemies = this.incoming.map((e) => ({
      id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y), ang: 0, hpPct: 255,
      flags: 8 | (e.elite ? 1 : 0),
    }));
    for (const e of this.enemies) enemies.push({
      id: e.id, type: e.type, x: Math.round(e.x), y: Math.round(e.y), ang: e.ang,
      hpPct: Math.max(0, Math.min(255, Math.round((e.hp / e.maxHp) * 255))),
      flags: (e.elite ? 1 : 0) | (e.hitT > 0 ? 2 : 0) | (e.state === 1 ? 4 : 0),
    });
    const projs = this.projs.map((b) => ({
      id: b.id, type: kindIdx(b.kind), x: Math.round(b.x), y: Math.round(b.y),
      ang: b.kind === 'swing' ? b.ang + b.arc * ((1 - b.life / b.maxLife) - 0.5) : b.ang,
      flags: (b.owner === -1 ? 1 : 0) | (b.crit ? 2 : 0),
      size: b.kind === 'swing' ? Math.min(255, Math.round(b.range)) : (b.size || 6),
    }));
    const pickups = this.pickups.map((p) => ({
      id: p.id, type: p.type, x: Math.round(p.x), y: Math.round(p.y),
    }));
    return {
      tick: this.tick, phase: this.phase, wave: this.wave,
      timeLeft: Math.max(0, this.timeLeft),
      players, enemies, projs, pickups, fx: this.fx.slice(),
    };
  }
}

// Levelling is the player's main power curve, so it has to outrun the enemy
// curve early or the run is decided before you own a build.
function xpFor(level) {
  return Math.floor(2 + level * 2.2 + Math.pow(level, 1.75));
}

/** Materials per kill: full value on wave 1, about 60% by wave 20. */
function matScale(wave) {
  return 1 / (1 + 0.035 * (wave - 1));
}

// Late waves drop several hundred materials each. Prices have to bend the
// same way or the shop stops being a choice and becomes a checkout.
//
// The first few shops get a discount that fades out by wave 6: wave 1 pays
// about a dozen materials, and a first shop you cannot buy anything from
// teaches you to skip the shop.
function priceScale(wave) {
  const early = 1 - 0.45 * Math.max(0, 6 - wave) / 5;
  return (1 + wave * 0.07 + wave * wave * 0.007) * early;
}

function projKindFor(id) {
  switch (id) {
    case 'shotgun': return 'pellet';
    case 'laser': case 'sniper': return 'laser';
    case 'rocket': return 'rocket';
    case 'flamer': return 'flame';
    case 'wand': return 'orb';
    case 'shuriken': return 'star';
    default: return 'bullet';
  }
}
