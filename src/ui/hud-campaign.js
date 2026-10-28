// A campaign mission on the HUD (DESIGN 9.3, 5.16): the objective panel in the top-right corner (where the
// lesson's panel sits), one row per objective the mission has shown, ticked, crossed out or counting, and a pin
// over the current objective's spot (the lesson's GuidePointer, fed by the sim's `cp.at`).
import { el, setClass, setHidden, setText } from './hud-dom.js';
import { formatClock } from './hud-data.js';
import { GuidePointer } from './hud-tutorial.js';
import { CAMPAIGN } from '../data/campaign.js';
import { currentObjective } from '../sim/campaign.js';

const UPDATE_MS = 500;
const DONE_FLASH_MS = 1400;

/** The progress words of one objective row ('' for none). */
export function objectiveProgress(o, vs) {
  if (o.state !== 0) return '';
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
      el('header', 'hud-tips-head', el('b', 'hud-tips-title', `${CAMPAIGN.chapter} · Mission ${m.n}`), this.count),
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
    const sig = rows.map((o) => `${o.id}:${o.state}:${objectiveProgress(o, vs)}`).join('|');
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
