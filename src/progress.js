// ---------------------------------------------------------------------------
// Persistent progression, kept in this browser only.
//
// Records (best wave per character, runs, wins) and unlocks (four characters
// and the Danger levels) live in localStorage. In multiplayer every player
// keeps their own copy and the host's unlocks gate the Danger selector; the
// simulation never checks any of it, so this is an honour system by design -
// a game with no server has no one to lie to.
// ---------------------------------------------------------------------------

import { CHARACTERS, DANGER, MAX_WAVE } from './data.js';

const KEY = 'pr_progress';

// Characters not listed here are always available. `test` reads the saved
// progress; `hint` is what the locked card says.
export const UNLOCKS = {
  4: { hint: 'Reach wave 8',            test: (s) => s.bestWaveAny >= 8 },
  5: { hint: 'Reach wave 12',           test: (s) => s.bestWaveAny >= 12 },
  6: { hint: 'Win a run',               test: (s) => s.wins > 0 },
  7: { hint: 'Win a run on Danger 1+',  test: (s) => s.maxDangerWon >= 1 },
};

function blank() {
  return { runs: 0, wins: 0, bestWave: {}, bestWaveAny: 0, bestEndless: 0, maxDangerWon: -1 };
}

let cache = null;

export function load() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch { cache = blank(); }
  return cache;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode: play on */ }
}

export function isUnlocked(charId) {
  const rule = UNLOCKS[charId];
  return !rule || rule.test(load());
}

/** Highest Danger the host may select: one above the highest they have beaten. */
export function dangerUnlocked() {
  return Math.min(DANGER.length - 1, load().maxDangerWon + 1);
}

export function bestWave(charId) { return load().bestWave[charId] || 0; }

/**
 * Record progress. Called on every wave start (so a crash or a closed tab
 * still counts) and on the run's end. Returns a list of human-readable
 * things that just unlocked, for toasts.
 */
export function record({ char, wave, win, danger, over }) {
  const s = load();
  const before = snapshotUnlocks(s);
  const w = wave | 0;
  if (w > (s.bestWave[char] || 0)) s.bestWave[char] = w;
  if (w > s.bestWaveAny) s.bestWaveAny = w;
  if (w > MAX_WAVE && w > s.bestEndless) s.bestEndless = w;
  if (over) {
    s.runs++;
    if (win) { s.wins++; if ((danger | 0) > s.maxDangerWon) s.maxDangerWon = danger | 0; }
  }
  save();
  const after = snapshotUnlocks(s);
  return after.filter((x) => !before.includes(x));
}

function snapshotUnlocks(s) {
  const out = [];
  for (const id in UNLOCKS) if (UNLOCKS[id].test(s)) out.push(`${CHARACTERS[id].name} unlocked`);
  for (let d = 1; d < DANGER.length; d++) if (s.maxDangerWon + 1 >= d) out.push(`${DANGER[d].name} unlocked`);
  return out;
}

/** One-line summary for the main menu, or null when there is nothing yet. */
export function summary() {
  const s = load();
  if (!s.runs && !s.bestWaveAny) return null;
  const parts = [`${s.runs} run${s.runs === 1 ? '' : 's'}`, `${s.wins} win${s.wins === 1 ? '' : 's'}`];
  if (s.bestWaveAny) parts.push(`best wave ${s.bestWaveAny}`);
  if (s.maxDangerWon > 0) parts.push(`beat ${DANGER[s.maxDangerWon].name}`);
  return parts.join(' · ');
}
