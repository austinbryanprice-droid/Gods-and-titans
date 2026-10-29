// A campaign mission on the HUD (DESIGN 9.6, 5.16): the objective panel in the top-right corner (where the
// lesson's panel sits), one row per objective the mission has shown, ticked, crossed out or counting, and a pin
// over the current objective's spot (the lesson's GuidePointer, fed by the sim's `cp.at`).
import { el, setClass, setHidden, setText } from './hud-dom.js';
import { formatClock } from './hud-data.js';
import { GuidePointer } from './hud-tutorial.js';
import { chapterOf } from '../data/campaign.js';
import { currentObjective } from '../sim/campaign.js';

const UPDATE_MS = 500;
const DONE_FLASH_MS = 1400;

/** The progress words of one objective row ('' for none). */
export function objectiveProgress(o, vs) {
  if (o.state !== 0) return '';
  const words = progressWords(o, vs);
  if (!Number.isFinite(o.limit)) return words;
  // A deadline: the clock left beside the count.
  const left = formatClock(Math.max(0, o.limit - ((vs && vs.time) || 0)));
  return words ? `${words} · ${left}` : left;
}

function progressWords(o, vs) {
  switch (o.kind) {
    case 'build':
    case 'gods':
    case 'army':
      return `${Math.min(o.value, o.count)}/${o.count}`;
    case 'kill':
    case 'destroy':
      return o.value > 0 ? `${o.value} left` : '';
    case 'survive':
      return formatClock(Math.max(0, o.seconds - ((vs && vs.time) || 0)));
    case 'hold':
      return o.value > 0 ? `${formatClock(o.value)} of ${formatClock(o.seconds)}` : '';
    case 'conquer':
      return o.value > 1 ? `${o.value} enemies left` : '';
    default:
      return '';
  }
}

/**
 * The rows of a mission's story beats still to come: each hidden objective the mission's `waitFor` names, still
 * open and not yet revealed, as { id, icon, text (its `waitText`), progress (the clock to the timed event that
 * reveals it, or '') }. Without it a player who has beaten every enemy early sees nothing left to do while the
 * mission waits (Ragnarök's Loki, at 13:00). Derived from the snapshot alone.
 */
export function waitingRows(c, vs) {
  const m = c && c.mission;
  if (!m || !Array.isArray(m.waitFor)) return [];
  const out = [];
  for (const id of m.waitFor) {
    const o = c.objectives.find((x) => x.id === id);
    if (!o || o.shown || o.state !== 0 || !o.waitText) continue;
    const e = m.events.find((x) => x.reveal === id && Number.isFinite(x.at));
    const progress = e ? formatClock(Math.max(0, e.at - ((vs && vs.time) || 0))) : '';
    out.push({ id: `wait:${id}`, icon: o.icon, text: o.waitText, progress });
  }
  return out;
}

export class CampaignView {
  /**
   * @param {HTMLElement} root the HUD root (the panel is appended to it)
   * @param {{ viewState: object }} o
   */
  constructor(root, { viewState }) {
    this.vs = viewState;
    this.last = -Infinity;
    this.sig = '';
    this.flashUntil = 0;
    this.doneSig = '';
    const m = viewState.mission();
    this.count = el('span', 'hud-tips-progress');
    this.list = el('ol', 'hud-tips-list hud-mission-list');
    this.el = el('section', 'hud-tips hud-guide hud-mission hud-panel',
      el('header', 'hud-tips-head', el('b', 'hud-tips-title', `${chapterOf(m).chapter} · Mission ${m.n}`), this.count),
      el('div', 'hud-guide-step', el('span', 'hud-guide-icon', '📜'), el('b', 'hud-guide-title', m.title)),
      this.list,
      el('div', 'hud-tips-foot', 'F10 opens the menu, where you can restart the mission.'));
    this.el.setAttribute('aria-label', `Objectives: ${m.title}`);
    this.el.setAttribute('aria-live', 'polite');
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    root.appendChild(this.el);
    this.update(performance.now(), true);
  }

  update(now = performance.now(), force = false) {
    if (!force && now - this.last < UPDATE_MS) {
      setClass(this.el, 'is-done-flash', now < this.flashUntil);
      return;
    }
    this.last = now;
    const vs = this.vs;
    const c = vs.campaign();
    setHidden(this.el, !c || !vs.me || vs.myIndex < 0 || !!vs.gameOver);
    if (!c) return;
    const done = c.objectives.map((o) => o.state).join('');
    if (this.doneSig && done !== this.doneSig) this.flashUntil = now + DONE_FLASH_MS;
    this.doneSig = done;
    setClass(this.el, 'is-done-flash', now < this.flashUntil);
    const rows = c.objectives.filter((o) => o.shown);
    const main = rows.filter((o) => !o.optional && o.kind !== 'protect');
    setText(this.count, `${main.filter((o) => o.state === 1).length}/${main.length}`);
    const waits = waitingRows(c, vs);
    const sig = rows.map((o) => `${o.id}:${o.state}:${objectiveProgress(o, vs)}`).concat(waits.map((w) => `${w.id}:${w.progress}`)).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    this.list.textContent = '';
    for (const o of rows) {
      const mark = o.state === 1 ? '✓' : o.state === 2 ? '✕' : '';
      const progress = objectiveProgress(o, vs);
      const li = el('li', 'hud-tips-step',
        el('span', 'hud-tips-check', mark),
        el('span', 'hud-tips-icon', o.icon || '•'),
        el('span', 'hud-tips-text', o.text, progress ? el('span', 'hud-mission-progress', progress) : null));
      setClass(li, 'is-done', o.state === 1);
      setClass(li, 'is-failed', o.state === 2);
      setClass(li, 'is-optional', !!o.optional);
      setClass(li, 'is-protect', o.kind === 'protect');
      this.list.appendChild(li);
    }
    // A story beat still to come (a waitFor objective not yet revealed): a row of words and its clock.
    for (const w of waits) {
      const li = el('li', 'hud-tips-step is-waiting',
        el('span', 'hud-tips-check', ''),
        el('span', 'hud-tips-icon', w.icon || '•'),
        el('span', 'hud-tips-text', w.text, w.progress ? el('span', 'hud-mission-progress', w.progress) : null));
      this.list.appendChild(li);
    }
  }

  dispose() {
    this.el.remove();
  }
}

/** The pin over the current objective: the lesson's pointer, reading the mission's spot from the snapshot. */
export function missionPointer({ root, viewState, getRenderer, getInsets }) {
  const director = {
    get finished() {
      return !!viewState.gameOver;
    },
    get current() {
      const c = viewState.campaign();
      if (!c) return null;
      const os = c.objectives;
      const o = os[currentObjective(os, os.map((x) => x.state), os.map((x) => x.shown))];
      return o ? { id: o.id, icon: o.icon || '★' } : null;
    },
    target() {
      const c = viewState.campaign();
      return c ? c.at : null;
    },
  };
  return new GuidePointer({ root, director, viewState, getRenderer, getInsets });
}
