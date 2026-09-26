// ---------------------------------------------------------------------------
// What every peer (host included) uses to turn a stream of 30 Hz snapshots
// into a smooth 60+ fps picture.
//
// Two different tricks, for two different problems:
//
//  * Remote entities are rendered INTERPOLATED, ~90ms in the past. We always
//    have two real snapshots bracketing that moment, so nothing is ever
//    guessed - the cost is a fixed sliver of latency nobody can see.
//
//  * Your OWN player is PREDICTED forward. Waiting for the host to confirm
//    your movement would add a full round-trip of input lag, which is the one
//    thing a twitch game cannot hide. So we move locally at once, keep the
//    inputs we have not had acknowledged yet, and when a snapshot arrives we
//    snap to the host's position and replay those inputs on top of it.
//    Movement is a pure function of input here (no collision push-back), so
//    the replay lands exactly where we already were and you never see a
//    correction - except when the host genuinely disagrees.
// ---------------------------------------------------------------------------

import { INTERP_MS } from './config.js';
import { TICK } from './world.js';
import { ARENA } from './data.js';

const lerp = (a, b, t) => a + (b - a) * t;
function lerpAng(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const PLAYER_R = 14;

export class ClientState {
  constructor(onFx) {
    this.onFx = onFx;
    this.snaps = [];
    this.pid = 0;
    this.you = null;         // last 'you' control message (stats, inventory)
    this.roster = new Map(); // pid -> { name, char, ready }
    this.pending = [];       // unacknowledged inputs, for replay
    this.pred = { x: ARENA.w / 2, y: ARENA.h / 2 };
    this.predValid = false;
    this.lastInputAt = 0;
    this.lastMove = { mx: 0, my: 0 };
    this.clockOffset = null; // maps host tick -> local time
    this.lastSnapAt = 0;
  }

  reset() {
    this.snaps.length = 0;
    this.pending.length = 0;
    this.predValid = false;
    this.clockOffset = null;
  }

  get speed() { return this.you ? this.you.speed : 235; }

  // ------------------------------------------------------------- snapshots
  pushSnapshot(snap) {
    const now = performance.now();
    this.lastSnapAt = now;
    snap.at = now;
    snap.fired = false;

    // Estimate when this snapshot's tick "happened" in local time, keeping the
    // slowest-drifting estimate so a single late packet cannot yank the clock.
    const est = now - snap.tick * TICK * 1000;
    if (this.clockOffset === null) this.clockOffset = est;
    else this.clockOffset = Math.min(this.clockOffset + 0.6, lerp(this.clockOffset, est, 0.02));
    snap.time = snap.tick * TICK * 1000 + this.clockOffset;

    // Out-of-order arrival is normal on an unreliable channel: insert sorted
    // and let the interpolator pick whichever pair brackets the render time.
    const last = this.snaps[this.snaps.length - 1];
    if (last && snap.tick <= last.tick) {
      if (snap.tick <= (this.snaps[0]?.tick ?? 0)) return;
      let i = this.snaps.length - 1;
      while (i >= 0 && this.snaps[i].tick > snap.tick) i--;
      if (i >= 0 && this.snaps[i].tick === snap.tick) return;
      this.snaps.splice(i + 1, 0, snap);
    } else {
      this.snaps.push(snap);
    }
    while (this.snaps.length > 24) this.snaps.shift();

    this.reconcile(snap);
  }

  reconcile(snap) {
    const me = snap.players.find((p) => p.id === this.pid);
    if (!me) return;
    while (this.pending.length && this.pending[0].seq <= me.ack) this.pending.shift();

    if (!this.predValid) { this.pred.x = me.x; this.pred.y = me.y; this.predValid = true; }

    // Replay from the authoritative position.
    let x = me.x, y = me.y;
    const spd = this.speed;
    for (const inp of this.pending) {
      let { mx, my } = inp;
      const l = Math.hypot(mx, my);
      if (l > 1) { mx /= l; my /= l; }
      x = clamp(x + mx * spd * TICK, PLAYER_R, ARENA.w - PLAYER_R);
      y = clamp(y + my * spd * TICK, PLAYER_R, ARENA.h - PLAYER_R);
    }

    // If the host and the replay agree closely, ease across the gap instead of
    // teleporting - stat changes and packet loss cause small honest drift.
    const d = Math.hypot(x - this.pred.x, y - this.pred.y);
    if (d > 90) { this.pred.x = x; this.pred.y = y; }
    else { this.pred.x = lerp(this.pred.x, x, 0.35); this.pred.y = lerp(this.pred.y, y, 0.35); }
  }

  /** Called at INPUT_HZ; advances the local prediction immediately. */
  applyLocalInput(inp) {
    this.pending.push(inp);
    if (this.pending.length > 90) this.pending.shift();
    this.lastInputAt = performance.now();
    this.lastMove = { mx: inp.mx, my: inp.my };
    if (!this.predValid) return;
    let { mx, my } = inp;
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    const spd = this.speed;
    this.pred.x = clamp(this.pred.x + mx * spd * TICK, PLAYER_R, ARENA.w - PLAYER_R);
    this.pred.y = clamp(this.pred.y + my * spd * TICK, PLAYER_R, ARENA.h - PLAYER_R);
  }

  /** Smooth the 30 Hz prediction up to display rate by extrapolating. */
  predictedPos(now) {
    const dt = Math.min((now - this.lastInputAt) / 1000, TICK);
    let { mx, my } = this.lastMove;
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    return {
      x: clamp(this.pred.x + mx * this.speed * dt, PLAYER_R, ARENA.w - PLAYER_R),
      y: clamp(this.pred.y + my * this.speed * dt, PLAYER_R, ARENA.h - PLAYER_R),
    };
  }

  // ---------------------------------------------------------- interpolation
  /** @returns a view of the world as it should be drawn right now, or null */
  sample(now) {
    if (!this.snaps.length) return null;
    const target = now - INTERP_MS;

    let older = null, newer = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].time <= target) { older = this.snaps[i]; newer = this.snaps[i + 1] || null; break; }
    }
    if (!older) { older = this.snaps[0]; newer = this.snaps[1] || null; }
    if (!newer) newer = older;

    // Fire effects once, at the moment their snapshot becomes visible.
    for (const s of this.snaps) {
      if (!s.fired && s.time <= target + 16) { s.fired = true; if (s.fx.length) this.onFx?.(s.fx); }
    }

    const span = newer.time - older.time;
    const t = span > 0.001 ? clamp((target - older.time) / span, 0, 1) : 0;

    let players = blend(older.players, newer.players, t, true);

    // Draw OUR player from the prediction, everyone else from the snapshot.
    //
    // Without this the whole predict-and-reconcile machinery above is dead
    // code: `pred` was computed, corrected, and then never drawn, so a client
    // watched its own character move only after a full round trip plus the
    // INTERP_MS buffer. The host, rendering its own simulation, felt instant -
    // which is exactly the "host is fine, everyone else lags" report.
    if (this.predValid) {
      const i = players.findIndex((p) => p.id === this.pid);
      // Never predict a corpse forward: a dead player has no inputs, and
      // sliding their body around after the host stopped it looks broken.
      if (i >= 0 && !(players[i].flags & 1)) {
        const me = this.predictedPos(now);
        // blend() hands back the stored array verbatim when there is nothing to
        // interpolate, so writing into it would corrupt the buffered snapshot -
        // and reconcile() reads that same array as the authority, which would
        // feed the prediction back into itself. Copy first.
        const copy = players.slice();
        copy[i] = { ...copy[i], x: me.x, y: me.y };
        players = copy;
      }
    }

    // Flag 8 is a telegraphed spawn: drawn as a warning marker, never as a
    // body, so every enemy loop in the renderers can ignore it entirely.
    const all = blend(older.enemies, newer.enemies, t, true);
    const enemies = [], spawns = [];
    for (const e of all) (e.flags & 8 ? spawns : enemies).push(e);
    return {
      phase: newer.phase,
      wave: newer.wave,
      timeLeft: lerp(older.timeLeft, newer.timeLeft, t),
      players,
      enemies, spawns,
      projs: blend(older.projs, newer.projs, t, true),
      pickups: blend(older.pickups, newer.pickups, t, false),
    };
  }

  get stale() { return this.lastSnapAt > 0 && performance.now() - this.lastSnapAt > 3000; }

  /**
   * True when the game is running but not one snapshot has ever arrived.
   *
   * `stale` cannot cover this: it needs a first snapshot to measure from, so a
   * client whose state channel never opened scored `stale === false` and got a
   * silent empty arena under a HUD still showing its untouched HTML defaults.
   */
  get neverReceived() { return this.lastSnapAt === 0; }
}

/** Match entities by id across two snapshots and interpolate the pairs. */
function blend(oldArr, newArr, t, withAng) {
  if (t <= 0 || oldArr === newArr) return newArr;
  const map = new Map();
  for (const o of oldArr) map.set(o.id, o);
  const out = new Array(newArr.length);
  for (let i = 0; i < newArr.length; i++) {
    const n = newArr[i];
    const o = map.get(n.id);
    if (!o) { out[i] = n; continue; }   // spawned this frame: no history to blend
    const e = { ...n, x: lerp(o.x, n.x, t), y: lerp(o.y, n.y, t) };
    if (withAng && o.ang !== undefined) e.ang = lerpAng(o.ang, n.ang, t);
    out[i] = e;
  }
  return out;
}
