// ---------------------------------------------------------------------------
// DOM UI. Kept strictly separate from the simulation: this file only ever
// reads the 'you' / 'shop' / 'lobby' control messages the host sends, so a
// client can render the full interface without owning any game state.
// ---------------------------------------------------------------------------

import {
  CHARACTERS, WEAPONS, ITEMS, STAT_LABEL, STAT_PCT, BASE_STATS, regenPerSec,
  TIER_COLOR, TIER_NAME, MAX_WEAPONS, MAX_WEAPON_LVL, ROMAN, MAX_WAVE,
  CLASSES, SET_STEPS, DANGER, TRADE_TAX, STAT_DESC, UPGRADE_TIER_LEVEL, classCounts, setTier, waveDuration,
  weaponAt, weaponName, weaponDps,
} from './data.js';
import { renderPortrait } from './render.js';
import { CharStage } from './charstage.js';
import { INTRO, LORE, quip, introSeen, markIntroSeen } from './story.js';
import { renderIcon, paintStatIcons } from './icons.js';
import * as progress from './progress.js';
import { ZOOM_MIN, ZOOM_MAX } from './settings.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Which damage stats actually feed this weapon - the thing shop cards hid. */
function scaleText(def) {
  const out = [];
  if (def.scale.m) out.push(`Melee &times;${def.scale.m}`);
  if (def.scale.r) out.push(`Ranged &times;${def.scale.r}`);
  if (def.scale.e) out.push(`Elemental &times;${def.scale.e}`);
  return out.join(' &middot; ') || 'flat damage only';
}

/** Short behaviour tags: everything the raw numbers do not say out loud. */
function weaponTags(def) {
  const t = [];
  if (def.count) t.push(`${def.count} projectiles`);
  if (def.pierce) t.push(def.pierce >= 99 ? 'pierces all' : `pierces ${def.pierce}`);
  if (def.chain) t.push(`chains ${def.chain}`);
  if (def.aoe) t.push(`${def.aoe} blast`);
  if (def.homing) t.push('homing');
  if (def.knock) t.push('knockback');
  if (def.lifesteal) t.push(`${def.lifesteal}% lifesteal`);
  if (def.crit) t.push(`+${def.crit}% crit`);
  if (def.spread) t.push('spread');
  return t;
}

/** Icon + number for one stat. The label lives in the tooltip. */
function statChip(k, v, extra = '') {
  const dir = v > 0 ? 'up' : v < 0 ? 'down' : '';
  return `<span class="schip ${dir} ${extra}" title="${STAT_LABEL[k]} ${fmtStat(k, v)}">` +
    `<canvas class="sicon" width="40" height="40" data-stat="${k}"></canvas><b>${fmtStat(k, v)}</b></span>`;
}

/** A row of stat chips from a mods object. */
function modChips(mods, extra = '') {
  return `<div class="chips ${extra}">${Object.entries(mods).map(([k, v]) => statChip(k, v)).join('')}</div>`;
}

/** Class chips for a weapon, with how many of that class you already own. */
function classChips(id, owned) {
  return WEAPONS[id].tags.map((t) => {
    const c = CLASSES[t];
    const n = owned ? (owned[t] || 0) : 0;
    return `<span class="cls" style="color:${c.color};border-color:${c.color}55">${c.name}${owned ? ` <b>${n}</b>` : ''}</span>`;
  }).join('');
}

/** The full stat block for one weapon at one level. */
function weaponBody(id, lvl, owned, fold = false) {
  const def = weaponAt(id, lvl);
  const tags = weaponTags(def).map((x) => `<span class="tag">${x}</span>`).join('');
  const scales = [['melee', def.scale.m], ['ranged', def.scale.r], ['elem', def.scale.e]]
    .filter(([, m]) => m)
    .map(([k, m]) => `<span class="schip" title="${STAT_LABEL[k]} adds &times;${m}"><canvas class="sicon" width="40" height="40" data-stat="${k}"></canvas><b>&times;${m}</b></span>`)
    .join('');
  const extra = `<div class="cls-row">${classChips(id, owned)}</div>` +
    (scales ? `<div class="chips scales" title="Scales with">${scales}</div>` : '') +
    (tags ? `<div class="tags">${tags}</div>` : '');
  return (
    (fold ? '' : extra) +
    `<div class="wstat icons">` +
    `<span class="schip" title="Damage per hit"><canvas class="sicon" width="40" height="40" data-stat="dmg"></canvas><b>${def.dmg}</b></span>` +
    `<span class="schip" title="Attacks per second"><canvas class="sicon" width="40" height="40" data-stat="atkSpeed"></canvas><b>${(1 / def.cd).toFixed(1)}/s</b></span>` +
    `<span class="schip" title="Range"><canvas class="sicon" width="40" height="40" data-stat="range"></canvas><b>${def.range}</b></span>` +
    `<span class="schip dps" title="Damage per second"><canvas class="sicon" width="40" height="40" data-stat="dps"></canvas><b>${Math.round(weaponDps(def))}</b><small>dps</small></span>` +
    `</div>` +
    (fold ? `<div class="more">${extra}<p class="wdesc">${WEAPONS[id].desc}</p></div>` : '')
  );
}

function fmtStat(k, v) {
  const sign = v > 0 ? '+' : '';
  if (STAT_PCT.has(k)) return `${sign}${Math.round(v)}%`;
  return `${sign}${Math.round(v)}`;
}

// --------------------------------------------------------------- intro art
// Cheap 2D vignettes for the story panels, painted from the same portraits the
// lobby uses. Each `art` key in story.js INTRO names one of these.
const _portraits = new Map();
function portrait(id) {
  let c = _portraits.get(id);
  if (!c) { c = document.createElement('canvas'); c.width = c.height = 160; renderPortrait(c, id); _portraits.set(id, c); }
  return c;
}
function blob(g, x, y, r, color) {
  g.fillStyle = 'rgba(0,0,0,.35)';
  g.beginPath(); g.ellipse(x, y + r * 0.95, r * 0.9, r * 0.28, 0, 0, Math.PI * 2); g.fill();
  const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r);
  grd.addColorStop(0, color); grd.addColorStop(1, '#1a0b12');
  g.fillStyle = grd;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  for (const s of [-1, 1]) {
    g.fillStyle = '#fff4d0';
    g.beginPath(); g.arc(x + s * r * 0.33, y - r * 0.12, r * 0.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a0810';
    g.beginPath(); g.arc(x + s * r * 0.3, y - r * 0.08, r * 0.1, 0, Math.PI * 2); g.fill();
    // angry brow, slanting down to the middle
    g.strokeStyle = '#1a0610'; g.lineWidth = Math.max(2, r * 0.09); g.lineCap = 'round';
    g.beginPath(); g.moveTo(x + s * r * 0.55, y - r * 0.42); g.lineTo(x + s * r * 0.12, y - r * 0.26); g.stroke();
  }
  // a jagged grin
  g.fillStyle = '#1a0610';
  g.beginPath(); g.moveTo(x - r * 0.36, y + r * 0.3);
  for (let k = 0; k <= 6; k++) g.lineTo(x - r * 0.36 + k * r * 0.12, y + r * (k % 2 ? 0.44 : 0.3));
  g.lineTo(x + r * 0.36, y + r * 0.3); g.closePath(); g.fill();
}
function paintIntro(cv, art) {
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const glow = (x, y, r, c) => {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, c); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
  };
  const pot = (id, x, y, s, alpha = 1) => {
    g.globalAlpha = alpha; g.drawImage(portrait(id), x - s / 2, y - s / 2, s, s); g.globalAlpha = 1;
  };
  if (art === 'cellar') {
    glow(W / 2, H * 0.35, W * 0.45, 'rgba(255,200,120,.22)');
    // light falling through the cellar hatch
    for (const [x0, w] of [[0.36, 0.07], [0.47, 0.1], [0.6, 0.06]]) {
      const grd = g.createLinearGradient(0, 0, 0, H * 0.85);
      grd.addColorStop(0, 'rgba(255,220,160,.16)'); grd.addColorStop(1, 'rgba(255,220,160,0)');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(W * x0, 0); g.lineTo(W * (x0 + w), 0);
      g.lineTo(W * (x0 + w + 0.08), H * 0.85); g.lineTo(W * (x0 + 0.05), H * 0.85); g.closePath(); g.fill();
    }
    [0, 3, 7, 1, 5].forEach((id, i) => pot(id, W * 0.2 + i * W * 0.15, H * 0.62 + (i % 2) * 14, 130, 0.85));
  } else if (art === 'hunger') {
    glow(W / 2, H, W * 0.6, 'rgba(176,38,255,.28)');
    const foes = [['#e05f5f', 34], ['#f0a35e', 26], ['#8c6bb1', 48], ['#e05f5f', 30], ['#d94f8c', 36], ['#f0a35e', 24], ['#7ed957', 32]];
    foes.forEach(([c, r], i) => blob(g, W * 0.1 + i * W * 0.13, H * 0.62 + Math.sin(i * 1.7) * 30, r * 1.3, c));
  } else if (art === 'pit') {
    glow(W / 2, H * 0.6, W * 0.5, 'rgba(255,59,107,.22)');
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 3;
    g.beginPath(); g.ellipse(W / 2, H * 0.68, W * 0.4, H * 0.24, 0, 0, Math.PI * 2); g.stroke();
    blob(g, W / 2, H * 0.4, 70, '#ff3b6b');
    [2, 4, 6].forEach((id, i) => pot(id, W * 0.3 + i * W * 0.2, H * 0.74, 100, 0.8));
  } else {
    glow(W / 2, H * 0.5, W * 0.55, 'rgba(255,200,87,.22)');
    for (let i = 0; i < CHARACTERS.length; i++) {
      const row = i < 4 ? 0 : 1;
      const x = W * (0.2 + (i % 4) * 0.2) + (row ? W * 0.02 : -W * 0.02);
      pot(i, x, H * (row ? 0.7 : 0.36), 138);
    }
  }
}

export class UI {
  constructor(cb) {
    this.cb = cb;
    this.selChar = 0;        // the character you will play
    this.viewChar = 0;       // the one on the stage; may be a locked preview
    this.lastShopKey = '';
    this.hostPid = 0;        // who may kick and force-start, per the last lobby msg
    this.phase = 0;
    this.kickArmed = 0;      // pid whose kick button is waiting for a confirming click
    this.kickTimer = null;
    this.introStep = 0;
    this.bind();
    this.stage = new CharStage($('charStage'), () => this.markChar());
    this.buildChars();
    this.buildIntro();
  }

  bind() {
    const c = this.cb;
    $('btnSolo').onclick = () => c.onSolo();
    $('btnHost').onclick = () => c.onHost();
    $('btnJoinPane').onclick = () => { this.pane('menuJoin'); $('codeInput').focus(); };
    $('btnBack').onclick = () => this.pane('menuMain');
    $('btnJoin').onclick = () => c.onJoin($('codeInput').value.trim().toUpperCase());
    $('btnCancel').onclick = () => c.onCancel();
    $('codeInput').onkeydown = (e) => { if (e.key === 'Enter') $('btnJoin').click(); };
    $('nameInput').oninput = () => localStorage.setItem('pr_name', $('nameInput').value);

    $('btnReady').onclick = () => c.onReady();
    $('btnLeave').onclick = () => c.onLeave();
    $('btnCopy').onclick = () => c.onCopyLink();

    $('btnReroll').onclick = () => c.onReroll();
    $('btnGo').onclick = () => c.onShopReady();
    $('btnAgain').onclick = () => c.onRestart();
    $('btnContinue').onclick = () => c.onContinue();
    $('btnQuit').onclick = () => c.onLeave();
    $('btnMute').onclick = () => c.onMute();

    $('btnNetTest').onclick = () => c.onNetTest();
    $('btnForceStart').onclick = () => c.onForceStart();
    $('btnShopForce').onclick = () => c.onForceStart();

    for (const b of $('tradeOpts').children) b.onclick = () => c.onTrade(b.dataset.v === '1');
    $('giveAmt').oninput = () => { this.lastGiveKey = ''; };
    $('giveAll').onclick = () => { $('giveAmt').value = this._giveMats || 0; this.lastGiveKey = ''; };
    $('btnGive').onclick = () => {
      const amt = Math.floor(+$('giveAmt').value);
      if ($('giveTo').value && amt > 0) c.onGive(+$('giveTo').value, amt);
    };

    // ---- spectator bar
    // Delegated, because the team rows are rebuilt from a string whenever a
    // health bar moves and per-row handlers would not survive that.
    $('teamPanel').onclick = (e) => {
      const row = e.target.closest?.('.team-row');
      if (row && $('teamPanel').classList.contains('pickable')) c.onSpectatePid(+row.dataset.pid);
    };
    $('specPrev').onclick = () => c.onSpectate(-1);
    $('specNext').onclick = () => c.onSpectate(1);
    $('specFree').onclick = () => c.onFreeCam();

    // ---- settings
    const openSettings = () => $('settings').classList.remove('hidden');
    $('btnSettings').onclick = openSettings;
    $('btnSettingsMenu').onclick = openSettings;
    $('btnSettingsClose').onclick = () => $('settings').classList.add('hidden');
    $('settings').onclick = (e) => { if (e.target.id === 'settings') $('settings').classList.add('hidden'); };
    for (const b of $('setView').children) b.onclick = () => c.onSetting({ view: b.dataset.v });
    $('setZoom').oninput = () => c.onSetting({ zoom: +$('setZoom').value });
    for (const id of ['setShake', 'setFloats', 'setAutoSpectate']) {
      $(id).onclick = () => c.onSetting({ [$(id).dataset.k]: $(id).getAttribute('aria-pressed') !== 'true' });
    }
    // Sound is stored inverted (muted), so the toggle reads the opposite way.
    $('setSound').onclick = () => c.onMute();
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { $('settings').classList.add('hidden'); if (!$('intro').classList.contains('hidden')) this.closeIntro(); }
      // Left / right flip through the cast on the character screen.
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      if (typing || $('lobby').classList.contains('hidden') || !$('intro').classList.contains('hidden')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const n = CHARACTERS.length;
        this.pickChar((this.viewChar + (e.key === 'ArrowLeft' ? n - 1 : 1)) % n, true);
      }
    });

    // ---- story
    $('btnStory').onclick = () => this.openIntro();
    $('introSkip').onclick = () => this.closeIntro();
    $('introBack').onclick = () => this.introGo(this.introStep - 1);
    $('introNext').onclick = () => (this.introStep >= INTRO.length - 1 ? this.closeIntro() : this.introGo(this.introStep + 1));
    $('intro').onclick = (e) => { if (e.target.id === 'intro') this.closeIntro(); };

    // ---- shop tabs (only visible on narrow screens; wide ones show all three)
    for (const b of $('shopTabs').children) {
      b.onclick = () => {
        for (const x of $('shopTabs').children) x.classList.toggle('on', x === b);
        for (const p of document.querySelectorAll('.shop-lower .panel')) p.classList.toggle('off', p.dataset.tab !== b.dataset.tab);
      };
    }

    $('nameInput').value = localStorage.getItem('pr_name') || '';
    this.renderRecords();
  }

  renderRecords() {
    const s = progress.summary();
    $('records').classList.toggle('hidden', !s);
    if (s) $('records').textContent = s;
  }

  // ------------------------------------------------------------- screens
  pane(id) {
    for (const p of ['menuMain', 'menuJoin', 'menuConnecting']) $(p).classList.toggle('hidden', p !== id);
  }

  screen(name) {
    for (const s of ['menu', 'lobby', 'shop', 'over']) $(s).classList.toggle('hidden', s !== name);
    $('hud').classList.toggle('hidden', name === 'menu' || name === 'over');
    $('app').dataset.screen = name;
    if (name !== 'shop') this.lastShopKey = '';
    // The turntable only spins while someone can see it.
    if (name === 'lobby') { this.stage.start(); this.stage.resize?.(); } else this.stage.stop();
  }

  connecting(text) { this.pane('menuConnecting'); $('connTxt').textContent = text; }

  netTest(state, res) {
    const box = $('netTest');
    box.classList.remove('hidden');
    $('btnNetTest').disabled = state === 'running';
    if (state === 'running') {
      box.className = 'net-test';
      box.innerHTML = '<b>Testing…</b><span>Asking STUN and TURN what they can do for you.</span>';
      return;
    }
    box.className = `net-test ${res.verdict}`;
    box.innerHTML = `<b>${esc(res.headline)}</b>`
      + res.lines.map((l) => `<span>${esc(l)}</span>`).join('');
  }
  joinError(text) { this.pane('menuJoin'); $('joinErr').textContent = text; }

  // ----------------------------------------------------------- settings
  /** Push the stored settings into the controls. One way only: the callbacks
   *  write to the settings module, and the module calls back here. */
  renderSettings(s) {
    for (const b of $('setView').children) b.classList.toggle('on', b.dataset.v === s.view);
    // The 2D view fits the whole arena on screen by construction, so there is
    // nothing for a zoom control to do. Saying so beats a slider that lies.
    $('setZoomRow').classList.toggle('disabled', s.view !== '3d');
    $('setZoom').disabled = s.view !== '3d';
    $('setZoom').min = ZOOM_MIN;
    $('setZoom').max = ZOOM_MAX;
    $('setZoom').value = s.zoom;
    $('setZoomVal').innerHTML = s.view === '3d' ? `${s.zoom.toFixed(2)}&times;` : 'n/a';
    const flag = (id, on) => $(id).setAttribute('aria-pressed', on ? 'true' : 'false');
    flag('setShake', s.shake);
    flag('setFloats', s.floats);
    flag('setAutoSpectate', s.autoSpectate);
    flag('setSound', !s.muted);
    $('btnMute').textContent = s.muted ? '\u{1F507}' : '\u{1F50A}';
  }

  // ---------------------------------------------------------- spectating
  /**
   * The bar a downed player drives. Called every frame, so everything that
   * does not change every frame is guarded by a key - rebuilding the teammate
   * buttons 60 times a second would make them impossible to click.
   */
  renderSpectate(s) {
    const box = $('spectate');
    if (!s) {
      box.classList.add('hidden');
      $('teamPanel').classList.remove('pickable');
      this._specKey = null;
      return;
    }
    box.classList.remove('hidden');
    $('teamPanel').classList.add('pickable');
    $('specFree').classList.toggle('primary', s.free);

    const back = s.timeLeft > 0 ? `back up in ${Math.ceil(s.timeLeft)}s` : 'back up at the shop';
    $('specHint').textContent = s.free ? `Free camera - WASD to fly, F to follow again - ${back}` : back;

    const t = s.target;
    const hasTarget = !!t && !s.free;
    $('specName').textContent = s.free ? 'Free camera' : (t ? t.name : 'Nobody left');
    $('specDot').style.background = hasTarget ? (CHARACTERS[t.char] || CHARACTERS[0]).color : 'transparent';
    // The free camera follows nobody, so there is no health to show.
    box.querySelector('.spec-bar').classList.toggle('hidden', !hasTarget);
    $('specHp').style.width = hasTarget ? `${Math.max(0, Math.min(1, t.hp / t.maxHp)) * 100}%` : '0%';
    $('specPrev').disabled = s.count < 2;
    $('specNext').disabled = s.count < 2;

    // Their build, as of the start of this wave - it cannot change mid-wave.
    const build = hasTarget ? t.build : null;
    const bKey = hasTarget
      ? `${t.id}|${build ? build.level : 0}|${build ? build.weapons.map((w) => `${w.id}${w.lvl}`).join(',') : ''}`
      : 'none';
    if (bKey !== this._specBuildKey) {
      this._specBuildKey = bKey;
      $('specBuild').innerHTML = build
        ? `<span class="lv">LV ${build.level}</span>` + build.weapons
          .map((w) => `<span class="wp">${esc(weaponName(w.id, w.lvl))}</span>`).join('')
        : '';
    }

    const key = s.others.map((o) => o.id).join(',');
    if (key !== this._specKey) {
      this._specKey = key;
      const picks = $('specPicks');
      picks.innerHTML = '';
      for (const o of s.others) {
        const b = el('button', 'spec-pick');
        b.dataset.pid = o.id;
        b.innerHTML = `<span class="dot" style="background:${(CHARACTERS[o.char] || CHARACTERS[0]).color}"></span>${esc(o.name)}`;
        b.onclick = () => this.cb.onSpectatePid(o.id);
        picks.appendChild(b);
      }
    }
    for (const b of $('specPicks').children) {
      b.classList.toggle('on', !s.free && !!t && +b.dataset.pid === t.id);
    }
  }
  get playerName() { return ($('nameInput').value || '').trim().slice(0, 14) || 'Spud'; }

  // -------------------------------------------------------------- lobby
  /** The strip of round portraits under the stage. */
  buildChars() {
    const grid = $('charGrid');
    grid.innerHTML = '';
    for (const ch of CHARACTERS) {
      const node = el('button', 'char');
      node.dataset.id = ch.id;
      node.setAttribute('role', 'option');
      node.title = ch.name;
      node.style.setProperty('--c', ch.color);
      node.innerHTML =
        `<canvas class="portrait" width="96" height="96"></canvas>` +
        `<span class="nm">${ch.name}</span>` +
        `<span class="best-dot hidden"></span>` +
        `<span class="lock-ico" aria-hidden="true">&#128274;</span>`;
      node.onclick = () => this.pickChar(ch.id);
      grid.appendChild(node);
      renderPortrait(node.querySelector('.portrait'), ch.id);
    }
    this.refreshChars();
  }

  /**
   * Put a character on the stage. An unlocked one also becomes your pick; a
   * locked one is only previewed, as a silhouette with its unlock hint.
   */
  pickChar(id, fromKeys = false) {
    this.viewChar = id;
    if (progress.isUnlocked(id) && id !== this.selChar) { this.selChar = id; this.cb.onChar(id); }
    this.markChar();
    if (fromKeys) $('charGrid').children[id]?.focus({ preventScroll: true });
  }

  /** Lock state and best-wave marks, re-read from progress. Cheap, call often. */
  refreshChars() {
    for (const n of $('charGrid').children) {
      const id = +n.dataset.id;
      n.classList.toggle('locked', !progress.isUnlocked(id));
      const best = progress.bestWave(id);
      const dot = n.querySelector('.best-dot');
      dot.classList.toggle('hidden', !best);
      dot.classList.toggle('won', best >= MAX_WAVE);
    }
    if (!progress.isUnlocked(this.selChar)) { this.selChar = 0; this.cb.onChar?.(0); }
    this.markChar();
  }

  markChar() {
    const id = this.viewChar;
    const ch = CHARACTERS[id] || CHARACTERS[0];
    const lore = LORE[id] || LORE[0];
    const locked = !progress.isUnlocked(id);
    this._previewing = locked;
    for (const n of $('charGrid').children) {
      const nid = +n.dataset.id;
      n.classList.toggle('sel', nid === this.selChar);
      n.classList.toggle('view', nid === id);
      n.setAttribute('aria-selected', nid === id ? 'true' : 'false');
    }

    // stage: 3D when the art is in, the flat portrait until then
    this.stage.show(id, locked);
    const flat = !this.stage.ready;
    $('stageBox').classList.toggle('flat', flat);
    $('stageBox').classList.toggle('locked', locked);
    $('stageBox').style.setProperty('--c', locked ? '#3a3d4d' : ch.color);
    if (flat) renderPortrait($('charFallback'), id);

    // info panel
    const w = WEAPONS[ch.weapon];
    $('charEpithet').textContent = lore.epithet;
    $('charName').textContent = ch.name;
    $('charBio').textContent = lore.bio;
    $('charLock').classList.toggle('hidden', !locked);
    if (locked) $('charLock').innerHTML = `&#128274; Locked &middot; ${esc(progress.UNLOCKS[id].hint)} to unlock`;
    $('charWpn').textContent = w.name;
    $('charWpnDesc').textContent = w.desc;
    renderIcon($('charWpnIcon'), 'weapon', ch.weapon);
    $('charMods').innerHTML = modChips(ch.mods);
    paintStatIcons($('charMods'));
    const best = progress.bestWave(id);
    $('charBest').classList.toggle('hidden', !best);
    if (best) $('charBest').textContent = best > MAX_WAVE ? `Best: endless wave ${best}` : best >= MAX_WAVE ? 'Best: cleared the Pit' : `Best: wave ${best}`;
    this.syncReady();
  }

  /** Ready is off while a locked character is on the stage: you cannot play it. */
  syncReady() {
    const b = $('btnReady');
    const locked = this._previewing;
    b.disabled = !!locked;
    if (locked) b.textContent = 'Locked';
    else b.textContent = this._meReady ? 'Not ready' : 'Ready';
    b.classList.toggle('primary', !this._meReady);
  }

  // ---------------------------------------------------------------- story
  buildIntro() {
    $('introDots').innerHTML = INTRO.map((_, i) => `<i data-i="${i}"></i>`).join('');
    for (const d of $('introDots').children) d.onclick = () => this.introGo(+d.dataset.i);
  }

  /** Called once at boot: first-time players get the story before the menu. */
  maybeIntro() { if (!introSeen()) this.openIntro(); }

  openIntro() {
    $('intro').classList.remove('hidden');
    this.introGo(0);
    $('introNext').focus({ preventScroll: true });
  }

  closeIntro() {
    $('intro').classList.add('hidden');
    markIntroSeen();
  }

  introGo(i) {
    this.introStep = Math.max(0, Math.min(INTRO.length - 1, i));
    const p = INTRO[this.introStep];
    $('introStep').textContent = `${this.introStep + 1} / ${INTRO.length}`;
    $('introTitle').textContent = p.title;
    $('introText').textContent = p.text;
    $('introBack').disabled = this.introStep === 0;
    const last = this.introStep === INTRO.length - 1;
    $('introNext').textContent = last ? 'Into the Pit' : 'Next';
    $('introSkip').classList.toggle('invisible', last);
    [...$('introDots').children].forEach((d, k) => d.classList.toggle('on', k === this.introStep));
    const card = $('intro').querySelector('.intro-card');
    card.classList.remove('turn'); void card.offsetWidth; card.classList.add('turn');
    paintIntro($('introArt'), p.art);
  }

  /**
   * Danger selector. Only the host can change it, and only up to one level
   * above what they have beaten; everyone else sees the current pick.
   */
  renderDanger(danger, editable) {
    const box = $('dangerOpts');
    const maxD = progress.dangerUnlocked();
    const key = `${danger}|${editable}|${maxD}`;
    if (key !== this._dangerKey) {
      this._dangerKey = key;
      box.innerHTML = '';
      DANGER.forEach((d, i) => {
        const b = el('button', `dopt ${i === danger ? 'on' : ''} ${editable && i > maxD ? 'locked' : ''}`, String(i));
        b.disabled = !editable;
        b.title = editable && i > maxD ? `Beat ${DANGER[i - 1].name} to unlock` : d.desc;
        b.onclick = () => { if (i <= maxD) this.cb.onDanger(i); };
        box.appendChild(b);
      });
    }
    $('dangerDesc').textContent = `${DANGER[danger].name}: ${DANGER[danger].desc}`
      + (editable ? '' : ' (host picks)');
  }

  /** Host-only lobby switch; hidden in a solo run, where there is nobody to share with. */
  renderTrade(on, editable, players) {
    $('tradeBox').classList.toggle('hidden', players < 2);
    for (const b of $('tradeOpts').children) {
      b.classList.toggle('on', (b.dataset.v === '1') === on);
      b.disabled = !editable;
    }
    $('tradeDesc').textContent = (on
      ? `Teammates can send each other materials in the shop, minus a ${Math.round(TRADE_TAX * 100)}% tax.`
      : 'Everyone keeps what they pick up.') + (editable ? '' : ' (host picks)');
  }

  setDanger(danger, endless) {
    const t = $('dangerTag');
    const show = danger > 0 || endless;
    t.classList.toggle('hidden', !show);
    if (show) t.textContent = `${endless ? 'ENDLESS' : ''}${endless && danger > 0 ? ' · ' : ''}${danger > 0 ? `D${danger}` : ''}`;
  }

  setRoom(code, link) {
    $('roomBox').classList.toggle('hidden', !code);
    if (code) { $('roomCode').textContent = code; this.inviteLink = link; }
  }

  setLobbySub(t) { $('lobbySub').textContent = t; }

  renderPlayers(roster, myPid, hostPid = 0, phase = 0) {
    this.hostPid = hostPid;
    this.phase = phase;
    const amHost = hostPid === myPid;
    const list = $('playerList');
    list.innerHTML = '';
    for (const [pid, p] of roster) {
      const ch = CHARACTERS[p.char] || CHARACTERS[0];
      const li = el('li');
      li.innerHTML =
        `<span class="dot" style="background:${ch.color}"></span>` +
        `<span class="pname">${esc(p.name)}${pid === myPid ? ' <small>you</small>' : ''}</span>` +
        `<span class="tick ${p.ready ? 'ok' : ''}">${p.connected === false ? 'away' : p.ready ? '&#10003; Ready' : 'Picking'}</span>`;
      if (amHost && pid !== myPid) li.appendChild(this.kickButton(pid, p.name));
      list.appendChild(li);
    }
    const me = roster.get(myPid);
    this._meReady = !!me?.ready;
    this.syncReady();

    // Waiting on someone who wandered off is the single most common way a
    // lobby dies, so the host gets to close it without them.
    const waiting = [...roster.values()].filter((p) => p.connected !== false && !p.ready).length;
    const canForce = amHost && roster.size > 1;
    $('btnForceStart').classList.toggle('hidden', !canForce);
    $('btnForceStart').disabled = waiting === 0;
    $('btnForceStart').textContent = waiting
      ? `Start now (${waiting} not ready)` : 'Everyone is ready';
  }

  /**
   * Kick, behind a confirming second click.
   *
   * A kick cannot be undone - the token is blocked for the life of the room -
   * and it sits one row away from the character grid, so a bare button would
   * eject a friend on a mis-click. A browser confirm() would do the job and
   * also freeze the arena for every other player while the host reads it.
   */
  kickButton(pid, name) {
    const armed = this.kickArmed === pid;
    const b = el('button', `btn tiny kick ${armed ? 'armed' : ''}`, armed ? 'Sure?' : '&times;');
    b.title = armed ? `Click again to remove ${name}` : `Remove ${name} from the room`;
    b.onclick = (e) => {
      e.stopPropagation();
      clearTimeout(this.kickTimer);
      if (this.kickArmed === pid) {
        this.kickArmed = 0;
        this.cb.onKick(pid);
        return;
      }
      this.kickArmed = pid;
      b.classList.add('armed');
      b.textContent = 'Sure?';
      this.kickTimer = setTimeout(() => {
        if (this.kickArmed !== pid) return;
        this.kickArmed = 0;
        b.classList.remove('armed');
        b.innerHTML = '&times;';
      }, 3000);
    };
    return b;
  }

  // ---------------------------------------------------------------- HUD
  updateHud(view, you, roster, pid) {
    if (!view) return;
    $('waveNum').textContent = view.wave || 1;
    const dur = waveDuration(view.wave || 1);
    const frac = Math.max(0, Math.min(1, view.timeLeft / dur));
    $('timerFill').style.width = `${frac * 100}%`;
    $('timerFill').classList.toggle('low', frac < 0.25);
    $('timerTxt').textContent = Math.ceil(view.timeLeft);

    const me = view.players.find((p) => p.id === pid);
    if (me) {
      const pct = Math.max(0, me.hp / me.maxHp) * 100;
      $('hpFill').style.width = `${pct}%`;
      $('hpFill').classList.toggle('low', pct < 30);
      $('hpTxt').textContent = `${Math.ceil(me.hp)} / ${me.maxHp}`;
    }
    if (you) {
      $('matNum').textContent = you.mats;
      $('lvlNum').textContent = you.level;
      $('xpFill').style.width = `${(you.xp / you.xpNeed) * 100}%`;
      const key = you.weapons.map((w) => `${w.id}${w.lvl}`).join(',');
      if (key !== this._wkey) {
        this._wkey = key;
        $('weaponRow').innerHTML = you.weapons
          .map((w) => `<span class="weapon-chip" title="${esc(w.name)}" style="--tier:${TIER_COLOR[w.tier - 1]}"><canvas class="icon xs" width="48" height="48"></canvas></span>`)
          .join('');
        $('weaponRow').querySelectorAll('.icon').forEach((c, i) => renderIcon(c, 'weapon', you.weapons[i].id, you.weapons[i].lvl));
      }
    }

    // Teammates panel is pointless in a solo run.
    const tp = $('teamPanel');
    if (roster.size <= 1) { tp.innerHTML = ''; return; }
    let html = '';
    for (const p of view.players) {
      const info = roster.get(p.id);
      if (!info) continue;
      const ch = CHARACTERS[info.char] || CHARACTERS[0];
      const down = p.flags & 1;
      const away = info.connected === false;
      html +=
        `<div class="team-row ${down || away ? 'down' : ''}" data-pid="${p.id}" title="${away ? 'Disconnected' : ''}">` +
        `<div class="nm"><span class="dot" style="background:${ch.color}"></span><span class="tn">${esc(info.name)}</span>${away ? ' <small>away</small>' : ''}</div>` +
        `<div class="bar"><i style="width:${down ? 100 : Math.round(Math.max(0, (p.hp / p.maxHp) * 100))}%"></i></div></div>`;
    }
    // Reparsing this every frame forced a full layout 60x a second for nothing.
    if (html !== this._teamHtml) { this._teamHtml = html; tp.innerHTML = html; }
  }

  netBadge(text) {
    const b = $('netBadge');
    b.classList.toggle('hidden', !text);
    if (text) b.textContent = text;
  }

  // --------------------------------------------------------------- shop
  setShopSummary(wave, s) {
    $('shopSummary').textContent = s
      ? `Wave ${wave}: ${s.kills} kills · +${s.mats} materials · ${s.dmg} damage taken`
      : '';
  }

  renderShop(shop, you, wave, timeLeft, roster, myPid) {
    $('shopNext').textContent = wave + 1;
    $('shopMats').textContent = you ? you.mats : 0;
    $('shopTimer').textContent = timeLeft > 0 ? `${Math.ceil(timeLeft)}s` : '--';
    if (!shop || !you) return;

    const freeRoll = shop.reroll === 0;
    $('rerollCost').textContent = freeRoll ? 'FREE' : shop.reroll;
    $('btnReroll').disabled = you.mats < shop.reroll;
    $('btnReroll').classList.toggle('primary', freeRoll);
    $('btnReroll').title = freeRoll ? 'You bought the whole shop - this roll is on the house' : '';
    $('wslots').textContent = `${you.weapons.length} / ${MAX_WEAPONS}`;

    const me = roster.get(myPid);
    $('btnGo').textContent = me?.ready ? 'Waiting for others…' : 'Ready for next wave';
    $('btnGo').classList.toggle('primary', !me?.ready);
    $('btnShopForce').classList.toggle('hidden', this.hostPid !== myPid || roster.size < 2);

    // Rebuilding the offer grid every frame would kill click targets mid-press,
    // so only redraw when something actually changed.
    const key = JSON.stringify([shop.offers.map((o) => o && [o.id, o.sold]), shop.locked,
      you.mats, you.weapons.map((w) => `${w.id}${w.lvl}`), you.items.length, you.stats]);
    if (key === this.lastShopKey) return;
    this.lastShopKey = key;

    const box = $('offers');
    box.innerHTML = '';
    const owned = classCounts(you.weapons);
    shop.offers.forEach((o, i) => {
      const card = el('div', `offer ${o?.sold ? 'sold' : ''}`);
      if (!o) { box.appendChild(card); return; }
      card.style.setProperty('--tier', TIER_COLOR[o.tier]);

      // Buying a duplicate merges instead of taking a slot, so it stays legal
      // at full slots - and saying so is the only way anyone would try it.
      const merges = o.kind === 'weapon' && you.weapons.some((w) => w.id === o.id && w.lvl === 1);
      let body;
      if (o.kind === 'weapon') {
        body = weaponBody(o.id, 1, owned, true);
        if (merges) {
          body += `<div class="merge">Combines with your ${WEAPONS[o.id].name}` +
            ` &rarr; <b>${weaponName(o.id, 2)}</b></div>`;
        } else {
          // Say out loud when this purchase completes a set.
          const next = WEAPONS[o.id].tags.find((t) => SET_STEPS.includes((owned[t] || 0) + 1));
          if (next) {
            const c = CLASSES[next];
            const tier = setTier((owned[next] || 0) + 1);
            body += `<div class="merge">Completes <b>${c.name} ${SET_STEPS[tier]}</b>: ${STAT_LABEL[c.stat]} ${fmtStat(c.stat, c.steps[tier])}</div>`;
          }
        }
      } else {
        body = (o.desc ? `<p class="wdesc effect">${o.desc}</p>` : '') +
          (o.mods ? modChips(o.mods, 'big') : '');
      }

      const afford = you.mats >= o.price;
      const full = o.kind === 'weapon' && you.weapons.length >= MAX_WEAPONS && !merges;
      const locked = !!shop.locked[i];
      card.classList.toggle('locked', locked);
      card.innerHTML =
        `<button class="lock ${locked ? 'on' : ''}" aria-pressed="${locked}" ` +
        `title="${locked ? 'Locked - kept through rerolls and into the next wave' : 'Lock: keep this through rerolls and into the next wave'}">` +
        `${locked ? '&#128274;' : '&#128275;'}</button>` +
        `<div class="offer-head"><canvas class="icon" width="112" height="112"></canvas>` +
        `<div class="offer-title"><span class="kind" style="color:${TIER_COLOR[o.tier]}">${TIER_NAME[o.tier]} ${o.kind}</span>` +
        `<h4>${o.name}</h4></div></div>${body}` +
        `<button class="btn buy ${afford && !o.sold && !full ? 'primary' : ''}" ${o.sold || !afford || full ? 'disabled' : ''}>` +
        `${o.sold ? 'Bought' : full ? 'Slots full' : merges ? `Combine ${o.price}` : `Buy ${o.price}`}</button>`;
      // Tap toggles the folded details on touch screens; hover does it elsewhere.
      if (o.kind === 'weapon') card.onclick = (e) => { if (!e.target.closest('button')) card.classList.toggle('open'); };
      renderIcon(card.querySelector('.icon'), o.kind, o.id);
      paintStatIcons(card);
      card.querySelector('.lock').onclick = () => this.cb.onLock(i);
      card.querySelector('.buy').onclick = () => this.cb.onBuy(i);
      box.appendChild(card);
    });

    this.renderInventory(you);
    this.renderStats(you);
  }

  /** Material transfer row. Rebuilt only on change, so the picker keeps its value. */
  renderGive(trade, you, roster, myPid) {
    const mates = [...roster.values()].filter((p) => p.id !== myPid && p.connected !== false);
    const show = trade && !!you && mates.length > 0;
    $('giveBox').classList.toggle('hidden', !show);
    if (!show) return;
    this._giveMats = you.mats;
    const amt = Math.max(0, Math.floor(+$('giveAmt').value) || 0);
    const key = JSON.stringify([mates.map((p) => [p.id, p.name]), you.mats, amt]);
    if (key === this.lastGiveKey) return;
    this.lastGiveKey = key;

    const sel = $('giveTo');
    const pick = sel.value;
    const opts = mates.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    if (sel.innerHTML !== opts) { sel.innerHTML = opts; if (mates.some((p) => String(p.id) === pick)) sel.value = pick; }
    const send = Math.min(amt, you.mats);
    const got = Math.floor(send * (1 - TRADE_TAX));
    $('btnGive').disabled = got < 1;
    $('giveNote').textContent = got >= 1
      ? `They get ${got} · ${send - got} tax (${Math.round(TRADE_TAX * 100)}%)`
      : `${Math.round(TRADE_TAX * 100)}% of every transfer is lost as tax`;
  }

  renderInventory(you) {
    // Class progress: which sets you are building and how far along each is.
    const owned = classCounts(you.weapons);
    $('classRow').innerHTML = Object.keys(CLASSES)
      .filter((t) => owned[t])
      .sort((a, b) => owned[b] - owned[a])
      .map((t) => {
        const c = CLASSES[t];
        const n = owned[t];
        const tier = setTier(n);
        const next = SET_STEPS.find((s) => s > n);
        const bonus = tier >= 0 ? `${STAT_LABEL[c.stat]} ${fmtStat(c.stat, c.steps[tier])}` : `next at ${next}`;
        return `<span class="cls ${tier >= 0 ? 'on' : ''}" style="color:${c.color};border-color:${c.color}66" ` +
          `title="${SET_STEPS.map((s, i) => `${s}: ${STAT_LABEL[c.stat]} ${fmtStat(c.stat, c.steps[i])}`).join('\n')}">` +
          `${c.name} <b>${n}${next ? `/${next}` : ''}</b><small>${bonus}</small></span>`;
      }).join('') || '<span class="empty">Own two weapons of one class for a set bonus.</span>';

    const wbox = $('invWeapons');
    wbox.innerHTML = '';
    you.weapons.forEach((w, i) => {
      const def = weaponAt(w.id, w.lvl);
      const row = el('div', 'inv-row wpn');
      const dupe = you.weapons.some((o, j) => j !== i && o.id === w.id && o.lvl === w.lvl);
      row.innerHTML =
        `<canvas class="icon sm" width="72" height="72"></canvas>` +
        `<span class="wname">${WEAPONS[w.id].name}${w.lvl > 1 ? ` <b class="lvl">${ROMAN[w.lvl - 1]}</b>` : ''}` +
        `<small>${Math.round(weaponDps(def))} dps &middot; ${def.range} range</small></span>` +
        `<button class="btn tiny sell" ${you.weapons.length <= 1 ? 'disabled' : ''}>Sell ${w.sell}</button>`;
      row.title = `${WEAPONS[w.id].desc}\nScales with ${scaleText(def).replace(/&times;/g, 'x').replace(/&middot;/g, ',')}`
        + (dupe && w.lvl < MAX_WEAPON_LVL ? '\nYou own two of these - they will combine.' : '');
      renderIcon(row.querySelector('.icon'), 'weapon', w.id, w.lvl);
      row.querySelector('.sell').onclick = () => this.cb.onSell('weapon', i);
      wbox.appendChild(row);
    });

    const ibox = $('invItems');
    ibox.innerHTML = '';
    if (!you.items.length) ibox.appendChild(el('div', 'empty', 'Nothing yet.'));
    you.items.forEach((it, i) => {
      const def = ITEMS.find((x) => x.id === it.id);
      const row = el('div', 'inv-row');
      row.innerHTML =
        `<canvas class="icon sm" width="72" height="72"></canvas>` +
        `<span class="wname">${it.name}${it.desc ? `<small>${it.desc}</small>` : (it.mods ? modChips(it.mods, 'mini') : '')}</span>` +
        `<button class="btn tiny sell">Sell ${Math.floor((def?.price || 10) * 0.5)}</button>`;
      row.title = (it.desc ? `${it.desc}\n` : '') + Object.entries(it.mods || {})
        .map(([k, v]) => `${STAT_LABEL[k]} ${fmtStat(k, v)}`).join('\n');
      renderIcon(row.querySelector('.icon'), 'item', it.id);
      paintStatIcons(row);
      row.querySelector('.sell').onclick = () => this.cb.onSell('item', i);
      ibox.appendChild(row);
    });
  }

  /**
   * Stat sheet. Whatever moved since the last draw flashes with its delta, so
   * a purchase, sale or level-up visibly changes the numbers it touched.
   */
  renderStats(you) {
    const box = $('statList');
    const prev = this._prevStats;
    this._prevStats = { ...you.stats };
    box.innerHTML = '';
    for (const k of Object.keys(BASE_STATS)) {
      const v = you.stats[k];
      const delta = prev ? Math.round(v - (prev[k] ?? v)) : 0;
      if (v === BASE_STATS[k] && v === 0 && !delta) continue;   // hide untouched zero stats
      const d = el('div', delta ? `changed ${delta > 0 ? 'gain' : 'loss'}` : '');
      d.title = STAT_LABEL[k];
      const cls = v > BASE_STATS[k] ? 'up' : v < BASE_STATS[k] ? 'down' : '';
      const pct = STAT_PCT.has(k) ? '%' : '';
      const shown = k === 'hpRegen' ? `${Math.round(v)} <small>${regenPerSec(v).toFixed(2)}/s</small>`
        : `${Math.round(v)}${pct}`;
      d.innerHTML = `<canvas class="sicon" width="40" height="40" data-stat="${k}"></canvas>` +
        (delta ? `<i class="delta">${delta > 0 ? '+' : ''}${delta}${pct}</i>` : '') +
        `<b class="${cls}">${shown}</b>`;
      box.appendChild(d);
    }
    paintStatIcons(box);
  }

  // ----------------------------------------------------------- level up
  /** @param you current stat sheet, for the "now -> after" line; optional. */
  renderLevelup(msg, you) {
    const box = $('levelup');
    const open = !!(msg && msg.options);
    // The spectator bar shares this corner of the screen and has to move.
    $('app').classList.toggle('lu-open', open);
    if (!open) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    $('luLevel').textContent = msg.level;
    $('luPending').textContent = msg.pending > 1 ? `(${msg.pending} pending)` : '';
    const opts = $('luOptions');
    opts.innerHTML = '';
    // Which tiers this level can roll, and when the next one opens up.
    const next = UPGRADE_TIER_LEVEL.find(([, lvl]) => msg.level < lvl);
    $('luHint').innerHTML = [0, ...UPGRADE_TIER_LEVEL.map(([t]) => t)]
      .map((t) => `<span style="color:${TIER_COLOR[t]}">${TIER_NAME[t]}</span>`).join(' &lt; ')
      + (next ? ` · <span style="color:${TIER_COLOR[next[0]]}">${TIER_NAME[next[0]]}</span> upgrades from level ${next[1]}` : ' · all tiers unlocked');
    msg.options.forEach((o, i) => {
      const [k, v] = Object.entries(o.mods)[0];
      const t = o.tier || 0;
      const b = el('button', `lu-opt t${t}`);
      b.style.setProperty('--tier', TIER_COLOR[t]);
      b.title = `${TIER_NAME[t]} ${STAT_LABEL[k]}: ${STAT_DESC[k] || ''}`;
      const now = you?.stats?.[k];
      const pct = STAT_PCT.has(k) ? '%' : '';
      b.innerHTML = `<span class="tier">${TIER_NAME[t]}</span>` +
        `<canvas class="sicon" width="64" height="64" data-stat="${k}"></canvas>` +
        `<span class="v">${fmtStat(k, v)}</span><span class="k">${STAT_LABEL[k]}</span>` +
        `<span class="d">${STAT_DESC[k] || ''}</span>` +
        (now != null ? `<span class="n">${Math.round(now)}${pct} &rarr; <b>${Math.round(now + v)}${pct}</b></span>` : '');
      b.onclick = () => this.cb.onPick(i);
      opts.appendChild(b);
    });
    paintStatIcons(opts);
    // Measure after layout so the spectator bar can sit clear of this panel.
    requestAnimationFrame(() => {
      $('app').style.setProperty('--lu-h', `${Math.round(box.getBoundingClientRect().height)}px`);
    });
  }

  // ---------------------------------------------------------- game over
  renderOver(msg, canRestart, opts = {}) {
    const endless = !!msg.endless;
    $('overTitle').textContent = msg.win ? (endless && !msg.canContinue ? 'Endless run over' : 'You survived!') : 'Wiped out';
    $('overSub').textContent = msg.win
      ? (endless && !msg.canContinue
        ? `The squad held out until wave ${msg.wave}.`
        : `All ${msg.wave} waves cleared${msg.danger > 0 ? ` on ${DANGER[msg.danger].name}` : ''}.`)
      : `The squad went down on wave ${msg.wave}.`;
    $('overBest').classList.toggle('hidden', !opts.newBest);
    if (opts.newBest) $('overBest').textContent = 'New personal best!';
    $('btnContinue').classList.toggle('hidden', !opts.canContinue);
    $('btnAgain').classList.toggle('primary', !opts.canContinue);
    const list = $('scoreList');
    list.innerHTML = '';
    for (const s of msg.scores || []) {
      const ch = CHARACTERS[s.char] || CHARACTERS[0];
      const li = el('li');
      li.innerHTML =
        `<span class="dot" style="background:${ch.color}"></span><b>${esc(s.name)}</b>` +
        `<span class="k">${s.kills} kills &middot; lv ${s.level}</span>`;
      list.appendChild(li);
    }
    const cid = opts.char ?? this.selChar;
    const ch = CHARACTERS[cid] || CHARACTERS[0];
    renderPortrait($('overPortrait'), cid);
    $('overQuipTxt').textContent = `\u201C${quip(cid, !!msg.win)}\u201D`;
    $('overQuipWho').textContent = `${ch.name}, ${(LORE[cid] || LORE[0]).epithet.toLowerCase()}`;
    $('overQuip').style.setProperty('--c', ch.color);
    $('btnAgain').classList.toggle('hidden', !canRestart);
    $('overHint').textContent = canRestart ? '' : 'Waiting for the host to start a new run.';
  }

  toast(text, kind) {
    const t = el('div', `toast ${kind || ''}`, esc(text));
    $('toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2400);
    setTimeout(() => t.remove(), 2800);
  }
}
