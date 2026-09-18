// ---------------------------------------------------------------------------
// Player-side display settings.
//
// Nothing here ever reaches the simulation or the wire: two people in the same
// room can be playing the same run in 2D and 3D at different zoom levels and
// the host cannot tell. That is the whole point of keeping it in its own
// module - a setting that changed the sim would have to be negotiated, and
// none of these do.
//
// Stored in localStorage (not sessionStorage) because a preference should
// survive closing the tab, unlike a seat in a room.
// ---------------------------------------------------------------------------

const KEY = 'pr_settings';

export const ZOOM_MIN = 0.55;
export const ZOOM_MAX = 2.5;
export const ZOOM_STEP = 0.15;

export const DEFAULTS = {
  view: '3d',      // '3d' perspective follow-cam | '2d' whole-arena top-down
  zoom: 1,         // 3D only: camera distance multiplier
  shake: true,     // screen shake on hits and explosions
  floats: true,    // damage numbers
  autoSpectate: true, // when you go down, jump straight onto a teammate
  muted: false,    // audio, which used to reset on every reload
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function sanitize(s) {
  const o = { ...DEFAULTS, ...(s || {}) };
  if (o.view !== '2d') o.view = '3d';
  o.zoom = clamp(+o.zoom || 1, ZOOM_MIN, ZOOM_MAX);
  o.shake = !!o.shake;
  o.floats = !!o.floats;
  o.autoSpectate = !!o.autoSpectate;
  o.muted = !!o.muted;
  return o;
}

let cur = (() => {
  try { return sanitize(JSON.parse(localStorage.getItem(KEY) || 'null')); }
  catch { return { ...DEFAULTS }; }
})();

const subs = new Set();

export function get() { return cur; }

/**
 * Merge a patch in and tell everyone who cares. The changed keys come with the
 * notification so a listener can skip work it does not need - swapping the
 * renderer is expensive and must not happen because the zoom slider moved.
 */
export function set(patch) {
  const next = sanitize({ ...cur, ...patch });
  const changed = Object.keys(next).filter((k) => next[k] !== cur[k]);
  if (!changed.length) return cur;
  cur = next;
  try { localStorage.setItem(KEY, JSON.stringify(cur)); }
  catch { /* private mode: the settings just do not persist */ }
  for (const fn of subs) fn(cur, changed);
  return cur;
}

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

/** Nudge the zoom by n steps, clamped. Returns the new value. */
export function zoomBy(n) {
  set({ zoom: clamp(cur.zoom + n * ZOOM_STEP, ZOOM_MIN, ZOOM_MAX) });
  return cur.zoom;
}
