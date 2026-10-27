// Gameplay tips (DESIGN 9, "Alerts, tips and sounds"): every couple of minutes of a match a small
// card under the top bar says one thing worth knowing (a hotkey, a rule, a build), picked for what
// the player holds and has not heard yet (hint-data.js). The scheduler runs on game time, so a
// paused match shows none; it keeps quiet while the player is fighting and tells each tip twice at
// most (the counts live in localStorage). The `hints` setting turns the whole thing off.
//
//   new HintScheduler({ viewState, show, hide }).attach()   → .update() every frame, .hold(seconds)
//   new HintsView(root, { anchor, onTurnOff })              → .show({ id, text }), .hide()
//   hintStore()                                             → { counts(), bump(id) }
import { getSettings } from '../settings.js';
import { el, setStyle } from './hud-dom.js';
import { HINTS, hintContext, hintParts, pickHint } from './hint-data.js';

const FIRST_AT = 90; // game seconds before the first tip
const JOINED_LATE = 30; // a match joined part-way waits this long before the first one
const GAP = 150; // game seconds between two tips
const LOOK_EVERY = 1; // game seconds between two looks at the match
const HOLD_AFTER_ATTACK = 30; // quiet seconds after my things were hit
const MAX_SEEN = 2; // a tip is shown this often at most

const STORE_KEY = 'mythicwar-hints';

const SHOW_MIN_MS = 9000; // how long a tip stays: this plus a little per letter, up to the maximum
const SHOW_MAX_MS = 18000;
const MS_PER_CHAR = 60;
const HOVER_MS = 4000; // left on screen this long after the pointer leaves it
const FADE_MS = 400;

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * How often each tip has been shown, kept in localStorage; in memory when there is none (private
 * windows, blocked storage, Node). Only known tip ids count, so a hand-edited value cannot do harm.
 * @returns {{ counts: () => Record<string, number>, bump: (id: string) => void }}
 */
export function hintStore(storage = defaultStorage()) {
  let seen = null;
  const read = () => {
    if (seen) return seen;
    seen = {};
    try {
      const raw = storage ? JSON.parse(storage.getItem(STORE_KEY) || 'null') : null;
      if (raw && typeof raw === 'object') {
        for (const h of HINTS) {
          const n = Object.hasOwn(raw, h.id) ? raw[h.id] : 0;
          if (Number.isInteger(n) && n > 0) seen[h.id] = Math.min(n, 99);
        }
      }
    } catch {
      // corrupt or blocked: start afresh
    }
    return seen;
  };
  return {
    counts: () => ({ ...read() }),
    bump(id) {
      const s = read();
      s[id] = Math.min(99, (s[id] || 0) + 1);
      try {
        if (storage) storage.setItem(STORE_KEY, JSON.stringify(s));
      } catch {
        // storage full or blocked: the in-memory count still holds for this page
      }
    },
  };
}

export class HintScheduler {
  /**
   * @param {object} o
   * @param {object} o.viewState
   * @param {(hint: { id: string, text: string }) => void} o.show
   * @param {() => void} [o.hide] called when the player should be left alone
   * @param {() => object} [o.settings] default getSettings
   * @param {{ counts: Function, bump: Function }} [o.store] default hintStore()
   * @param {() => number} [o.rng]
   */
  constructor({ viewState, show, hide = () => {}, settings = getSettings, store = hintStore(), rng = Math.random }) {
    this.vs = viewState;
    this.show = show;
    this.hide = hide;
    this.settings = settings;
    this.store = store;
    this.rng = rng;
    this.nextAt = null; // game time of the next tip (set at the first look)
    this.quietUntil = -Infinity;
    this.lastLook = -Infinity;
    this.offs = [];
  }

  attach() {
    const vs = this.vs;
    this.offs.push(vs.on('underAttack', (ev) => {
      if (ev.player === vs.myIndex) this.hold(HOLD_AFTER_ATTACK);
    }));
    return this;
  }

  dispose() {
    for (const off of this.offs.splice(0)) off();
  }

  /** Something that matters is going on: no tip for `seconds` of game time, and the one on screen goes. */
  hold(seconds = HOLD_AFTER_ATTACK) {
    const t = Number.isFinite(this.vs.time) ? this.vs.time : 0;
    this.quietUntil = Math.max(this.quietUntil, t + seconds);
    this.hide();
  }

  /** Is there a living player to teach? */
  watching() {
    const vs = this.vs;
    return !!(vs.me && vs.myIndex >= 0 && !vs.me.defeated && !vs.gameOver);
  }

  /** Call every frame; it looks at the match about once per game second. */
  update() {
    const vs = this.vs;
    const t = vs.time;
    if (!Number.isFinite(t)) return;
    if (!this.settings().hints || !this.watching()) {
      this.nextAt = null; // switched on again part-way: the first tip waits its 30 s afresh
      this.hide();
      return;
    }
    if (this.nextAt === null) this.nextAt = Math.max(FIRST_AT, t + JOINED_LATE);
    if (t >= this.lastLook && t - this.lastLook < LOOK_EVERY) return;
    this.lastLook = t;
    if (t < this.nextAt || t < this.quietUntil) return;
    let hint = null;
    try {
      hint = pickHint({ ctx: hintContext(vs), seen: this.store.counts(), rng: this.rng, maxSeen: MAX_SEEN });
    } catch (err) {
      console.warn('[hints] could not pick a tip', err);
    }
    this.nextAt = t + GAP;
    if (!hint) return;
    this.store.bump(hint.id);
    this.show(hint);
  }
}

export class HintsView {
  /**
   * @param {HTMLElement} root the HUD root (the card is appended to it)
   * @param {object} [o]
   * @param {() => HTMLElement|null} [o.anchor] a panel the card sits under (the getting-started checklist)
   * @param {() => void} [o.onTurnOff] the player chose "Turn tips off"
   */
  constructor(root, { anchor = () => null, onTurnOff = () => {} } = {}) {
    this.anchor = anchor;
    this.onTurnOff = onTurnOff;
    this.visible = false;
    this.hovered = false;
    this.timer = null;
    const close = el('button', 'hud-hint-close', '✕');
    close.type = 'button';
    close.tabIndex = -1;
    close.title = 'Close this tip';
    close.setAttribute('aria-label', 'Close this tip');
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });
    const off = el('button', 'hud-hint-off', 'Turn tips off');
    off.type = 'button';
    off.tabIndex = -1;
    off.title = 'No more tips during the game (Settings can turn them on again)';
    off.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
      this.onTurnOff();
    });
    this.text = el('p', 'hud-hint-text');
    this.el = el('aside', 'hud-hint hud-panel',
      el('header', 'hud-hint-head', el('span', 'hud-hint-icon', '💡'), el('b', 'hud-hint-title', 'Tip'), close),
      this.text,
      el('div', 'hud-hint-foot', off));
    this.el.hidden = true;
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('mouseenter', () => {
      this.hovered = true;
      this.arm(0);
    });
    this.el.addEventListener('mouseleave', () => {
      this.hovered = false;
      if (this.visible) this.arm(HOVER_MS);
    });
    root.appendChild(this.el);
  }

  /** Show a tip { id, text } (a tip already on screen is replaced). */
  show(hint) {
    if (!hint || !hint.text) return;
    this.text.textContent = '';
    for (const part of hintParts(hint.text)) this.text.append(typeof part === 'string' ? part : el('kbd', null, part.key));
    this.place();
    this.el.dataset.hint = hint.id || '';
    this.el.classList.remove('is-leaving');
    this.visible = true;
    this.el.hidden = false;
    if (!this.hovered) this.arm(Math.min(SHOW_MAX_MS, SHOW_MIN_MS + hint.text.length * MS_PER_CHAR));
  }

  /** Under the getting-started checklist while that is up, else in the corner. */
  place() {
    const a = this.anchor();
    const below = a && !a.hidden ? a.offsetTop + a.offsetHeight : 0;
    setStyle(this.el, 'top', below > 0 ? `calc(${below}px + 0.5em)` : '');
  }

  /** (Re)start the countdown to the fade; 0 stops it. */
  arm(ms) {
    clearTimeout(this.timer);
    this.timer = null;
    if (!(ms > 0) || !this.visible) return;
    this.timer = setTimeout(() => this.fade(), ms);
  }

  fade() {
    this.el.classList.add('is-leaving');
    this.timer = setTimeout(() => this.hide(), FADE_MS);
  }

  hide() {
    if (!this.visible) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.visible = false;
    this.el.hidden = true;
    this.el.classList.remove('is-leaving');
  }

  dispose() {
    clearTimeout(this.timer);
    this.timer = null;
    this.visible = false;
    this.el.remove();
  }
}
