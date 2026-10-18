// "Getting started" tips for new players: a small, dismissible checklist in the
// top-right corner that ticks itself off as the player does each step
// (mine gold → build → pray at a Shrine → summon a god at a Temple → Titan
// Gate in the City). Closing it, or finishing every step, stores
// `tipsDismissed` in the settings so it does not come back next game.
//
//   tipSteps(vs) → [{ id, icon, text, keys, done }]   (pure, Node-testable)
//   new TipsView(root, { viewState, onDismiss })      (DOM; update() ~2 Hz)
import { UNITS, BUILDINGS } from '../data/index.js';
import { el, setClass, setHidden, setText } from './hud-dom.js';

/** Own entities of the local player, split by kind. */
function own(vs) {
  const units = [];
  const buildings = [];
  for (const e of vs.entities.values()) {
    if (e.o !== vs.myIndex) continue;
    if (e.k === 'u') units.push(e);
    else if (e.k === 'b') buildings.push(e);
  }
  return { units, buildings };
}

/**
 * The checklist with each step's state for the local player.
 * `keys` lists the hotkeys mentioned (drawn as <kbd>), `done` is true once the
 * player has done what the step asks.
 * @param {object} vs ViewState
 * @returns {{ id: string, icon: string, text: string, keys: string[], done: boolean }[]}
 */
export function tipSteps(vs) {
  const me = vs.me || null;
  const { units, buildings } = own(vs);
  const workers = units.filter((u) => UNITS[u.t] && UNITS[u.t].class === 'worker');
  const has = (type) => buildings.some((b) => b.t === type);
  const queued = (cls) => buildings.some((b) => (b.q || []).some((q) => UNITS[q.u] && UNITS[q.u].class === cls));
  const gods = !!(me && ((me.gods && me.gods.length) || (me.fallen && Object.keys(me.fallen).length))) || queued('god');
  const mining = workers.some((u) => (u.st === 'gather' && u.tg) || u.c === 'g');
  const built = buildings.length > 1 || workers.some((u) => u.bo || u.st === 'build');
  return [
    { id: 'mine', icon: '⛏️', text: 'Select your Worshippers (drag a box around them) and right-click the gold mine.', keys: [], done: mining },
    { id: 'build', icon: '🔨', text: 'Press B to build. Houses (H) raise your population limit.', keys: ['B', 'H'], done: built },
    { id: 'pray', icon: '🙏', text: 'Build a Shrine (S), then right-click it with Worshippers to pray for Faith.', keys: ['S'], done: !!(me && me.faithRate > 0) },
    { id: 'god', icon: BUILDINGS.temple.icon, text: 'A Temple (E) summons your gods with Faith.', keys: ['E'], done: gods },
    { id: 'titan', icon: '🌀', text: 'Grow the Town Center into a Town, then a City (U), and raise a Titan Gate (G) for your Titan.', keys: ['U', 'G'], done: has('titan_gate') || !!(me && me.titan) },
  ];
}

const UPDATE_MS = 500;

/**
 * Text with the step's hotkey letters drawn as <kbd> (only standalone capitals
 * listed in keys); "(H)" becomes just the key cap, without the brackets.
 */
export function splitKeys(text, keys) {
  const list = (keys || []).map((k) => String(k).replace(/[^A-Z0-9]/g, '')).filter(Boolean);
  if (!list.length) return [text];
  const alt = list.join('|');
  const re = new RegExp(`\\((${alt})\\)|\\b(${alt})\\b`, 'g');
  const out = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push({ key: m[1] || m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function withKeys(text, keys) {
  return splitKeys(text, keys).map((p) => (typeof p === 'string' ? p : el('kbd', null, p.key)));
}

export class TipsView {
  /**
   * @param {HTMLElement} root the HUD root (the panel is appended to it)
   * @param {{ viewState: object, onDismiss: (reason: 'closed'|'done') => void }} o
   */
  constructor(root, { viewState, onDismiss }) {
    this.vs = viewState;
    this.onDismiss = onDismiss;
    this.last = -Infinity;
    this.closed = false;
    this.rows = [];
    const close = el('button', 'hud-tips-close', '✕');
    close.type = 'button';
    close.tabIndex = -1;
    close.title = 'Hide these tips (they will not come back; Settings can turn them on again)';
    close.setAttribute('aria-label', 'Hide the getting-started tips');
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismiss('closed');
    });
    const list = el('ol', 'hud-tips-list');
    this.doneIds = new Set(); // a step stays ticked once done
    for (const s of tipSteps(viewState)) {
      const check = el('span', 'hud-tips-check');
      const li = el('li', 'hud-tips-step', check, el('span', 'hud-tips-icon', s.icon), el('span', 'hud-tips-text', ...withKeys(s.text, s.keys)));
      li.dataset.step = s.id;
      list.appendChild(li);
      this.rows.push({ id: s.id, li, check });
    }
    this.progress = el('span', 'hud-tips-progress');
    this.el = el('section', 'hud-tips hud-panel',
      el('header', 'hud-tips-head', el('b', 'hud-tips-title', 'Getting started'), this.progress, close),
      list,
      el('div', 'hud-tips-foot', 'Click a building for its commands; hover a button for details.'));
    this.el.setAttribute('aria-label', 'Getting started tips');
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    root.appendChild(this.el);
    this.update(performance.now(), true);
  }

  /** Refresh the ticks (cheap; throttled). */
  update(now = performance.now(), force = false) {
    if (this.closed || (!force && now - this.last < UPDATE_MS)) return;
    this.last = now;
    const me = this.vs.me;
    // Spectators and defeated players have nothing to learn here.
    setHidden(this.el, !me || me.defeated || this.vs.myIndex < 0);
    const steps = tipSteps(this.vs);
    let done = 0;
    let current = false;
    steps.forEach((s, i) => {
      const r = this.rows[i];
      if (!r) return;
      if (s.done) this.doneIds.add(s.id);
      const ok = this.doneIds.has(s.id);
      setClass(r.li, 'is-done', ok);
      const isNext = !ok && !current;
      if (isNext) current = true;
      setClass(r.li, 'is-next', isNext);
      setText(r.check, ok ? '✓' : String(i + 1));
      if (ok) done++;
    });
    setText(this.progress, `${done}/${steps.length}`);
    if (done === steps.length) this.dismiss('done');
  }

  dismiss(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    this.el.remove();
    if (this.onDismiss) this.onDismiss(reason);
  }

  dispose() {
    this.closed = true;
    this.el.remove();
  }
}
