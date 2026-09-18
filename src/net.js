// ---------------------------------------------------------------------------
// WebRTC transport.
//
// Topology is a star: the host is the authority and every client holds exactly
// one connection, to the host. That is O(n) connections instead of the O(n^2)
// a full mesh would need, and it is the only topology where "who decides what
// actually happened" has a single answer.
//
// Each peer pair opens TWO data channels, because the two kinds of traffic want
// opposite guarantees:
//
//   's' (state)   unordered, 0 retransmits  - snapshots and inputs. A late
//                 snapshot is worse than no snapshot; head-of-line blocking on
//                 a reliable channel would stall every later packet behind one
//                 lost frame. Losing one is invisible: another arrives in 33ms.
//
//   'c' (control) ordered + reliable, JSON  - shop, level-ups, wave changes.
//                 Rare, and losing one desynchronises the game permanently.
//
// PeerJS supplies the signalling (SDP/ICE exchange) over its public broker.
// After the handshake nothing but game traffic flows, and it flows peer-to-peer.
// ---------------------------------------------------------------------------

import { PEER_SERVER, ICE_SERVERS } from './config.js';
import { SIGNAL_PREFIX, PROTO_VERSION } from './data.js';

const peerOpts = () => ({
  debug: 1,
  config: { iceServers: ICE_SERVERS, sdpSemantics: 'unified-plan' },
  ...(PEER_SERVER || {}),
});

/**
 * PeerJS attaches the RTCPeerConnection lazily, so poll briefly for it and then
 * report ICE state changes. This is the difference between "no room with that
 * code" and "the room is there but your two networks will not talk to each
 * other" - previously both surfaced as the same unhelpful timeout.
 */
function watchIce(conn, onState) {
  let done = false;
  const attach = () => {
    const pc = conn.peerConnection;
    if (!pc || done) return !!pc;
    done = true;
    onState(pc.iceConnectionState);
    pc.addEventListener('iceconnectionstatechange', () => onState(pc.iceConnectionState));
    return true;
  };
  if (attach()) return;
  const t = setInterval(() => { if (attach()) clearInterval(t); }, 200);
  setTimeout(() => clearInterval(t), 20000);
}

/** Per-session secret a rejoining client uses to prove it owned a slot. */
export function makeToken() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function makeRoomCode() {
  // Ambiguity-free alphabet: no O/0, no I/1 - people read these aloud.
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += A[(Math.random() * A.length) | 0];
  return s;
}

const STATE_OPTS = { label: 's', reliable: false, serialization: 'binary' };
const CTRL_OPTS = { label: 'c', reliable: true, serialization: 'json' };

// PeerJS gives each DataConnection its own RTCPeerConnection, so the two
// channels negotiate ICE independently and can succeed independently. The
// control channel opening while the state channel never does is a real and
// survivable outcome - the player reaches the lobby, starts the wave, and then
// stares at an empty arena because no snapshot ever arrives. When that
// happens the host falls back to pushing snapshots down the control channel:
// reliable and ordered rather than unreliable, so it jitters more, but it is
// a game instead of a blank screen.
const STATE_RETRY_MS = 4000;
const STATE_RETRIES = 3;

/** Snapshots are binary; the control channel is JSON. Base64 bridges them. */
export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(s);
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ===========================================================================
// Host
// ===========================================================================
export class Host {
  /**
   * @param code  room code players type in
   * @param cb    { onJoin(pid,name), onLeave(pid), onControl(pid,msg),
   *                onInput(pid,bytes), onStatus(text,kind) }
   */
  constructor(code, cb) {
    this.code = code;
    this.cb = cb;
    this.peer = null;
    this.peers = new Map();      // peerId -> { pid, name, ctrl, state, alive }
    this.departed = new Map();   // pid -> { token, name }: slots a refresh can reclaim
    this.kicked = new Set();     // tokens the host threw out, for this room's life
    this.nextPid = 2;            // host is always pid 1
    this.open = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line no-undef
      this.peer = new Peer(SIGNAL_PREFIX + this.code, peerOpts());
      const timer = setTimeout(() => reject(new Error('Signalling server timed out')), 20000);

      this.peer.on('open', () => { clearTimeout(timer); this.open = true; resolve(this.code); });
      this.peer.on('error', (err) => {
        clearTimeout(timer);
        if (err.type === 'unavailable-id') reject(new Error('That room code is already in use'));
        else if (!this.open) reject(err);
        else this.cb.onStatus?.(`Network: ${err.type}`, 'warn');
      });
      this.peer.on('connection', (conn) => this._accept(conn));
      this.peer.on('disconnected', () => {
        this.cb.onStatus?.('Lost signalling server - reconnecting', 'warn');
        try { this.peer.reconnect(); } catch { /* already gone */ }
      });
    });
  }

  _accept(conn) {
    let rec = this.peers.get(conn.peer);
    if (!rec) {
      rec = { pid: 0, name: null, ctrl: null, state: null, joined: false };
      this.peers.set(conn.peer, rec);
    }
    if (conn.label === 'c') {
      rec.ctrl = conn;
      conn.on('data', (d) => this._onCtrl(conn.peer, d));
      conn.on('close', () => this._drop(conn.peer));
      conn.on('error', () => this._drop(conn.peer));
      // A peer that reaches signalling but never completes ICE used to hang
      // silently on both ends. Say so, and stop holding the slot.
      setTimeout(() => {
        const r = this.peers.get(conn.peer);
        if (r && !r.joined) {
          this.cb.onStatus?.('A player could not connect (their network blocked the direct link).', 'warn');
          this._drop(conn.peer);
        }
      }, 30000);
    } else {
      rec.state = conn;
      conn.on('data', (d) => {
        const r = this.peers.get(conn.peer);
        if (r && r.joined) this.cb.onInput?.(r.pid, d);
      });
    }
  }

  _onCtrl(peerId, msg) {
    const rec = this.peers.get(peerId);
    if (!rec) return;
    if (msg && msg.t === 'hello') {
      if (msg.ver !== PROTO_VERSION) {
        rec.ctrl?.send({ t: 'reject', reason: 'Version mismatch - both sides need to reload the page (hard refresh).' });
        setTimeout(() => this._drop(peerId), 400);
        return;
      }
      rec.token = String(msg.token || '').slice(0, 64);
      // A kick has to outlive the disconnect it causes, or the kicked tab
      // simply reconnects a second later - both automatically and by pressing
      // Join again. The token identifies a tab for its whole lifetime, so the
      // block survives both. It is not proof against a new tab; without a
      // server there is nothing to check an identity against, and the point is
      // to end the disruption, not to win an arms race.
      if (rec.token && this.kicked.has(rec.token)) {
        rec.ctrl?.send({ t: 'kicked' });
        setTimeout(() => this._drop(peerId), 400);
        return;
      }
      // A refresh mid-run comes back as a brand-new peer. If it can name the
      // slot it held and prove it with the token it was issued, hand the slot
      // back instead of seating a stranger.
      const old = msg.rejoin ? this.departed.get(msg.rejoin | 0) : null;
      if (old && rec.token && old.token === rec.token) {
        this.departed.delete(msg.rejoin | 0);
        rec.pid = msg.rejoin | 0;
        rec.name = old.name;
        rec.joined = true;
        rec.ctrl.send({ t: 'welcome', pid: rec.pid, code: this.code, rejoined: true });
        this.cb.onRejoin?.(rec.pid, rec.name);
        return;
      }
      // Count actual players, not half-finished handshakes.
      if ([...this.peers.values()].filter((r) => r.joined).length >= 7) {
        rec.ctrl?.send({ t: 'reject', reason: 'Room is full (8 players max).' });
        setTimeout(() => this._drop(peerId), 400);
        return;
      }
      rec.pid = this.nextPid++;
      rec.name = String(msg.name || 'Player').slice(0, 14);
      rec.joined = true;
      rec.ctrl.send({ t: 'welcome', pid: rec.pid, code: this.code });
      this.cb.onJoin?.(rec.pid, rec.name);
      return;
    }
    if (rec.joined) this.cb.onControl?.(rec.pid, msg);
  }

  _drop(peerId) {
    const rec = this.peers.get(peerId);
    if (!rec) return;
    this.peers.delete(peerId);
    try { rec.ctrl?.close(); rec.state?.close(); } catch { /* noop */ }
    if (rec.joined && !rec.kicked) {
      if (rec.token) this.departed.set(rec.pid, { token: rec.token, name: rec.name });
      this.cb.onLeave?.(rec.pid);
    }
  }

  /** Forget a slot for good (the player left on purpose, or the run reset). */
  forget(pid) { this.departed.delete(pid); }

  /**
   * Throw a player out. The notice goes down the reliable control channel and
   * the socket is closed a beat later: closing immediately would discard the
   * buffered message, and the client would see a bare disconnect and start
   * politely trying to rejoin the room that just ejected them.
   */
  kick(pid) {
    this.departed.delete(pid);
    for (const [peerId, rec] of this.peers) {
      if (rec.pid !== pid || !rec.joined) continue;
      rec.kicked = true;
      if (rec.token) this.kicked.add(rec.token);
      try { rec.ctrl?.send({ t: 'kicked' }); } catch { /* already gone */ }
      setTimeout(() => this._drop(peerId), 400);
    }
  }

  sendControl(pid, msg) {
    for (const rec of this.peers.values()) {
      if (!rec.joined) continue;
      if (pid !== null && rec.pid !== pid) continue;
      if (rec.ctrl?.open) { try { rec.ctrl.send(msg); } catch { /* dropped */ } }
    }
  }

  broadcastState(bytes) {
    this._sn = (this._sn || 0) + 1;
    let b64 = null;
    for (const rec of this.peers.values()) {
      if (!rec.joined) continue;
      if (rec.state?.open) {
        rec.degraded = false;
        try { rec.state.send(bytes); } catch { /* unreliable, fine */ }
        continue;
      }
      // No state channel. Push snapshots down the reliable control channel
      // instead, at half rate: it is ordered, so a backlog here shows up as
      // growing delay rather than dropped frames, and base64 costs a third
      // more bytes on top.
      if (!rec.ctrl?.open) continue;
      if (!rec.degraded) {
        rec.degraded = true;
        this.cb.onStatus?.(`${rec.name || 'A player'} lost their fast channel - using the slower fallback`, 'warn');
      }
      if (this._sn % 2) continue;
      if (b64 === null) b64 = bytesToB64(bytes);
      try { rec.ctrl.send({ t: 'snap', b: b64 }); } catch { /* dropped */ }
    }
  }

  close() {
    for (const id of [...this.peers.keys()]) this._drop(id);
    try { this.peer?.destroy(); } catch { /* noop */ }
  }
}

// ===========================================================================
// Client
// ===========================================================================
export class Client {
  /**
   * @param cb     { onControl(msg), onState(bytes), onStatus(text,kind), onClose() }
   * @param rejoin { pid, token } from a previous session in this room, if any
   */
  constructor(code, name, cb, rejoin = null) {
    this.code = code.toUpperCase().trim();
    this.name = name;
    this.cb = cb;
    this.token = rejoin?.token || makeToken();
    this.rejoin = rejoin?.pid || 0;
    this.rejoined = false;
    this.peer = null;
    this.ctrl = null;
    this.state = null;
    this.pid = 0;
    this.ice = 'new';
    this.reachedHost = false;
    this.stateOpen = false;
    this.closed = false;
  }

  /** What actually went wrong, in words a player can act on. */
  _timeoutReason() {
    if (!this.reachedHost) {
      return 'No answer from that room. Check the code, and make sure the host still has the tab open.';
    }
    if (this.ice === 'failed' || this.ice === 'checking' || this.ice === 'disconnected') {
      return 'Found the room, but your two networks refused a direct connection '
        + '(strict NAT, or a work/school firewall). This needs a TURN relay - see src/config.js.';
    }
    return 'Found the room, but the connection never finished opening. Try again.';
  }

  start() {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line no-undef
      this.peer = new Peer(null, peerOpts());
      const fail = (m) => { try { this.peer.destroy(); } catch { /* noop */ } reject(new Error(m)); };
      const timer = setTimeout(() => fail(this._timeoutReason()), 25000);
      let settled = false;

      this.peer.on('error', (err) => {
        if (settled) { this.cb.onStatus?.(`Network: ${err.type}`, 'warn'); return; }
        clearTimeout(timer);
        if (err.type === 'peer-unavailable') fail('No room with that code is open right now. Codes die when the host closes the tab.');
        else if (err.type === 'browser-incompatible') fail('This browser cannot do WebRTC data channels.');
        else if (err.type === 'network') fail('Could not reach the signalling server. Check your connection, then retry.');
        else fail(err.message || err.type);
      });

      this.peer.on('open', () => {
        const host = SIGNAL_PREFIX + this.code;
        this.ctrl = this.peer.connect(host, CTRL_OPTS);
        this._openState();

        watchIce(this.ctrl, (st) => {
          this.ice = st;
          if (settled) return;
          if (st === 'checking') this.cb.onStage?.('Found the room - negotiating a direct link…');
          else if (st === 'connected' || st === 'completed') this.cb.onStage?.('Connected - joining the lobby…');
          else if (st === 'failed') {
            clearTimeout(timer);
            fail('Found the room, but no direct connection is possible between your networks '
              + '(strict NAT or a firewall). This needs a TURN relay - see src/config.js.');
          }
        });

        this.ctrl.on('open', () => {
          this.reachedHost = true;
          this.ctrl.send({ t: 'hello', name: this.name, ver: PROTO_VERSION, token: this.token, rejoin: this.rejoin });
        });
        this.ctrl.on('data', (msg) => {
          if (msg && msg.t === 'welcome') {
            settled = true;
            clearTimeout(timer);
            this.pid = msg.pid;
            this.rejoined = !!msg.rejoined;
            resolve(msg);
            return;
          }
          if (msg && msg.t === 'reject') {
            clearTimeout(timer);
            if (!settled) fail(msg.reason);
            else this.cb.onStatus?.(msg.reason, 'warn');
            return;
          }
          this.cb.onControl?.(msg);
        });
        this.ctrl.on('close', () => { if (settled) this.cb.onClose?.(); });
        this.ctrl.on('error', () => { if (!settled) fail('Connection to host failed.'); });

      });
    });
  }

  /**
   * Open the state channel, and keep trying if it does not come up. Its ICE
   * negotiation is separate from the control channel's, so it can fail on its
   * own - and silently, since the game looks connected either way.
   */
  _openState(attempt = 0) {
    if (this.closed) return;
    try {
      this.state = this.peer.connect(SIGNAL_PREFIX + this.code, STATE_OPTS);
    } catch { return; }
    this.state.on('open', () => { this.stateOpen = true; });
    this.state.on('data', (d) => this.cb.onState?.(d));
    this.state.on('close', () => { this.stateOpen = false; });
    setTimeout(() => {
      if (this.closed || this.stateOpen) return;
      if (attempt < STATE_RETRIES) {
        try { this.state?.close(); } catch { /* noop */ }
        this._openState(attempt + 1);
      } else {
        this.cb.onStatus?.('Using the slower fallback channel - movement may stutter.', 'warn');
      }
    }, STATE_RETRY_MS);
  }

  sendControl(msg) {
    if (this.ctrl?.open) { try { this.ctrl.send(msg); } catch { /* noop */ } }
  }

  sendState(bytes) {
    if (this.state?.open) { try { this.state.send(bytes); } catch { /* noop */ } }
  }

  close() {
    this.closed = true;
    try { this.peer?.destroy(); } catch { /* noop */ }
  }
}
