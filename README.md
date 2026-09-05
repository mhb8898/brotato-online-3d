# Potato Royale 3D

> **This is the 3D fork** of [Potato Royale](https://github.com/mhb8898/brotato-online).
> The simulation, netcode and HUD are unchanged; the arena is drawn with
> [Three.js](https://threejs.org/) instead of Canvas 2D (see `src/render3d.js`).
> Play it at https://mhb8898.github.io/brotato-online-3d/

A browser co-op arena-survival roguelite in the spirit of **Brotato** — waves of
enemies, auto-firing weapons, a shop between waves — but playable **online with
up to 8 people over WebRTC**, hosted as a plain static site on GitHub Pages.

**Play:** https://mhb8898.github.io/brotato-online/

No install, no accounts, no game server. One player hosts, everyone else joins
with a 5-character room code.

---

## How the online part works without a server

GitHub Pages serves static files and nothing else — there is no process to run a
game loop or relay packets. That constraint shapes the whole design.

```
                    ┌──────────────────────┐
                    │  PeerJS cloud broker │   ← SDP/ICE handshake only
                    └──────────┬───────────┘      (a few KB, once)
             ┌─────────────────┼─────────────────┐
             │                 │                 │
        ┌────▼────┐       ┌────▼────┐       ┌────▼────┐
        │ Client  │       │  HOST   │       │ Client  │
        │         │◄─────►│  runs   │◄─────►│         │
        └─────────┘  P2P  │ the sim │  P2P  └─────────┘
                          └─────────┘
```

**Signalling vs. transport.** WebRTC peers cannot find each other unaided: they
must swap SDP offers and ICE candidates through some third party first. PeerJS's
free public broker does that handshake. Once the peer connection is up, the
broker is out of the loop entirely — every byte of gameplay travels directly
between browsers.

**Star topology, one authority.** The host runs the simulation; clients send
inputs and render what comes back. A full mesh would need O(n²) connections and,
worse, would have no answer to "who decides what actually happened". With one
authority there is exactly one truth, and cheating requires being the host.

**Two data channels per peer, because the traffic wants opposite guarantees:**

| Channel | Mode | Carries | Why |
|---|---|---|---|
| `s` (state) | unordered, 0 retransmits | snapshots, inputs | A late snapshot is worse than a lost one. On a reliable channel, one dropped packet blocks every later packet behind it; here a loss is invisible because another arrives in 33 ms. |
| `c` (control) | ordered, reliable, JSON | shop, level-ups, wave changes | Rare, and losing one desynchronises the run permanently. |

**Binary snapshots.** State is packed into an `ArrayBuffer` with fixed-width
fields — `int16` positions (the arena is 1600×900), one byte per angle. In
practice a snapshot is **250 B – 2.6 KB**, so a client uses roughly
**8–75 KB/s** down. JSON would be 3–4× that.

### Latency hiding

Two different tricks for two different problems:

- **Remote entities are interpolated**, rendered ~90 ms in the past. Two real
  snapshots always bracket that moment, so nothing is ever guessed. The cost is
  a fixed sliver of latency no one can perceive.
- **Your own player is predicted.** Waiting for the host to confirm your own
  movement would add a full round-trip of input lag — the one thing a twitch
  game cannot hide. So you move locally at once, keep the inputs the host has
  not acknowledged, and on each snapshot snap to the authoritative position and
  replay them. Movement is a pure function of input (no collision push-back), so
  the replay lands where you already were: **measured prediction error is 0 px**
  with inputs still in flight.

### The simulation clock is a Web Worker

`requestAnimationFrame` is the obvious game-loop clock, and it is the wrong one
here: browsers **pause it in background tabs**, so a host who alt-tabs freezes
the game for everyone else. `setInterval` on the main thread is throttled to
~1 Hz for the same reason. Timers inside a dedicated Worker are not, so the sim
ticks from there at a fixed 30 Hz and only rendering stays on `rAF` — where
pausing is exactly the behaviour you want.

---

## Gameplay

- **20 waves**, bosses on every 5th.
- **8 characters** with real trade-offs (armoured and slow, fast and papery,
  lifesteal but weak hits…).
- **16 weapons** — melee arcs, shotguns, homing wands, rockets, chain lightning.
  You carry up to 6 and they all fire themselves.
- **30 items** and a level-up pick every level, drawn from ~30 upgrades.
- **17 stats** that actually interact (armour is a diminishing-returns curve,
  negative armour amplifies damage, crit/luck/harvesting feed each other).
- Materials are both **currency and XP**, so every pickup is a real decision.
- Co-op: shared arena and wave, **separate inventories and economies**. Downed
  players spectate until the wave ends, then come back at half health.

**Controls** — `WASD`/arrows move, mouse aims, `1`–`4` pick a level-up.
Weapons fire on their own, but aim still matters: a target inside your aim cone
is preferred over a marginally closer one behind you. Touch devices get a
virtual stick.

---

## Running it locally

Any static file server works — it must be `http://`, not `file://`, because the
code uses ES modules.

```bash
git clone https://github.com/mhb8898/brotato-online.git
cd brotato-online
python3 -m http.server 8777
# open http://localhost:8777
```

To test multiplayer on one machine, open two tabs; they will connect to each
other through the public broker exactly as two different computers would.

There is **no build step**. Native ES modules are served correctly by Pages, so
`git push` *is* the deploy.

---

## Deploying your own copy

1. Fork or push this repo to GitHub.
2. **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.
3. Wait a minute; your copy is live at `https://<user>.github.io/<repo>/`.

The `.nojekyll` file matters: without it, Pages runs Jekyll, which ignores
directories beginning with an underscore and can interfere with asset paths.

### Self-hosting the signalling (optional)

The default uses PeerJS's free public broker, which is rate-limited and offers
no uptime guarantee. For anything serious, run your own — it is one command and
stays tiny, because it only brokers handshakes:

```bash
npx peerjs --port 9000 --key peerjs --path /myapp
```

Then in [`src/config.js`](src/config.js):

```js
export const PEER_SERVER = { host: 'you.example.com', port: 443, path: '/myapp', secure: true };
```

### About the ~10–15% of connections that need TURN

STUN (configured by default, free) is enough for most networks. Symmetric NATs
and strict corporate firewalls will not open a direct path, and those peers need
a **TURN relay**, which costs money because it forwards the actual traffic. Add
credentials to `ICE_SERVERS` in `src/config.js` if you need to cover them. This
is a property of WebRTC, not of this game — every P2P app faces it.

---

## Project layout

```
index.html          shell + HUD/shop/lobby markup
style.css           all UI; the canvas is a full-viewport layer underneath
src/
  config.js         signalling, ICE, tick rates — the only file to edit to self-host
  data.js           characters, weapons, items, enemies, upgrades (pure data)
  world.js          the authoritative simulation (host only)
  protocol.js       binary snapshot/input packing
  net.js            PeerJS transport, host + client
  clientstate.js    snapshot buffering, interpolation, prediction & reconciliation
  render.js         canvas 2D; every sprite drawn from primitives, zero assets
  ui.js             DOM panels, driven purely by control messages
  audio.js          procedural WebAudio sfx, zero asset files
  main.js           mode wiring, sim clock, render loop
```

Two deliberate choices worth flagging:

- **Solo mode takes the identical code path as hosting**, right down to encoding
  a snapshot to bytes and decoding it back before rendering. That costs a couple
  hundred microseconds a tick and buys a guarantee: a protocol bug cannot
  survive a solo playtest, and the host always sees what a remote client sees.
- **No image, audio or font files at all.** Everything is drawn from canvas
  primitives and synthesised with oscillators, so there is nothing to 404 and
  nothing to wait on before the game starts.

## Licence

MIT — see [LICENSE](LICENSE).
