// The guided first match on the HUD (DESIGN 9.2): the objective panel in the top-right corner
// (where the getting-started checklist sits in other games), a pin over the battlefield that
// points at the step's spot (an arrow at the edge of the screen when it is out of view; click it
// to go there), and a glow on the command-card buttons the step asks for. The steps themselves
// and when each is done live in src/game/tutorial.js (TutorialDirector).
import { el, setClass, setHidden, setText } from './hud-dom.js';
import { hintParts } from './hint-data.js';
import { MarksLayer } from './hud-marks.js';
import { TUTORIAL_STEPS } from '../game/tutorial.js';

const UPDATE_MS = 500;
const DONE_FLASH_MS = 1400; // the "done" glow on the panel when a step is finished

function withKeys(text) {
  return hintParts(text).map((p) => (typeof p === 'string' ? p : el('kbd', null, p.key)));
}

/** The objective panel: which step of how many, what to do, and how far along it is. */
export class TutorialView {
  /**
   * @param {HTMLElement} root the HUD root (the panel is appended to it)
   * @param {{ director: object }} o the TutorialDirector
   */
  constructor(root, { director }) {
    this.director = director;
    this.last = -Infinity;
    this.sig = '';
    this.flashUntil = 0;
    this.shownIndex = director.index;
    this.guideIds = [];
    this.count = el('span', 'hud-tips-progress');
    this.icon = el('span', 'hud-guide-icon');
    this.title = el('b', 'hud-guide-title');
    this.text = el('p', 'hud-guide-text');
    this.progress = el('div', 'hud-guide-progress');
    this.dots = el('ol', 'hud-guide-dots');
    this.dotEls = TUTORIAL_STEPS.map((s) => {
      const d = el('li', 'hud-guide-dot');
      d.title = s.title;
      this.dots.appendChild(d);
      return d;
    });
    this.el = el('section', 'hud-tips hud-guide hud-panel',
      el('header', 'hud-tips-head', el('b', 'hud-tips-title', 'Learn to Play'), this.count),
      el('div', 'hud-guide-step', this.icon, this.title),
      this.text,
      this.progress,
      this.dots,
      el('div', 'hud-tips-foot', 'Move the view with the arrow keys or the screen edges; scroll to zoom. F10 opens the menu.'));
    this.el.setAttribute('aria-label', 'Objectives of the guided first match');
    this.el.setAttribute('aria-live', 'polite');
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    root.appendChild(this.el);
    this.update(performance.now(), true);
  }

  /** Look at the match (throttled) and redraw the panel when its words changed. */
  update(now = performance.now(), force = false) {
    if (!force && now - this.last < UPDATE_MS) {
      setClass(this.el, 'is-done-flash', now < this.flashUntil);
      return;
    }
    this.last = now;
    const d = this.director;
    d.update();
    if (d.index !== this.shownIndex) {
      this.shownIndex = d.index;
      this.flashUntil = now + DONE_FLASH_MS;
    }
    setClass(this.el, 'is-done-flash', now < this.flashUntil);
    const vs = d.vs;
    setHidden(this.el, !vs.me || vs.myIndex < 0 || d.finished);
    const v = d.finished ? null : d.view();
    this.guideIds = v ? v.guide : [];
    if (!v) return;
    const sig = `${d.index}|${v.text}|${v.progress}`;
    if (sig === this.sig) return;
    this.sig = sig;
    setText(this.count, `${Math.min(d.index + 1, TUTORIAL_STEPS.length)}/${TUTORIAL_STEPS.length}`);
    setText(this.icon, v.step.icon);
    setText(this.title, v.step.title);
    this.text.textContent = '';
    for (const part of withKeys(v.text)) this.text.append(part);
    setText(this.progress, v.progress);
    setHidden(this.progress, !v.progress);
    this.dotEls.forEach((dot, i) => {
      setClass(dot, 'is-done', i < d.index);
      setClass(dot, 'is-next', i === d.index);
    });
  }

  /** The command-card button ids the current step asks for. */
  guide() {
    return this.guideIds;
  }

  dispose() {
    this.el.remove();
  }
}

/**
 * The pin over the step's spot (or the arrow at the edge toward it), drawn by the team marks'
 * layer with one standing mark of its own.
 */
export class GuidePointer extends MarksLayer {
  /**
   * @param {object} o
   * @param {HTMLElement} o.root the HUD root
   * @param {object} o.director the TutorialDirector
   * @param {object} o.viewState
   * @param {() => object|null} o.getRenderer
   * @param {() => { top: number, bottom: number }} [o.getInsets]
   */
  constructor({ root, director, viewState, getRenderer, getInsets }) {
    super({
      root,
      viewState,
      getRenderer,
      getInsets,
      marks: {
        active: () => {
          const t = director.finished ? null : director.target();
          const step = director.current;
          return t && step ? [{ id: `guide:${step.id}`, kind: 'guide', x: t.x, y: t.y, t1: Infinity, icon: step.icon }] : [];
        },
      },
    });
    this.layer.classList.add('hud-guide-marks');
  }

  make(m) {
    const arrow = el('i', 'hud-mark-arrow');
    const node = el('button', 'hud-mark is-guide',
      el('i', 'hud-mark-ring'),
      el('span', 'hud-mark-pin', el('b', 'hud-mark-who', 'Here'), el('span', 'hud-mark-chip', m.icon || '★')),
      arrow);
    node.type = 'button';
    node.tabIndex = -1;
    node.title = 'Your objective is here. Click to go there.';
    const item = { root: node, arrow, m };
    node.addEventListener('mousedown', (e) => e.preventDefault());
    node.addEventListener('click', () => {
      const r = this.getRenderer();
      if (r && r.camera) r.camera.centerOn(item.m.x, item.m.y);
    });
    this.layer.appendChild(node);
    this.items.set(m.id, item);
    return item;
  }

  /** The spot can move within a step (the forest edge, the raiders' camp once seen): a click goes where it is now. */
  place(item, m, r, area, now) {
    item.m = m;
    super.place(item, m, r, area, now);
  }
}

/** Light the command-card buttons whose ids are in `ids` (the CardView's slots and its current card). */
export function lightCard(cardView, ids) {
  if (!cardView || !cardView.slots) return;
  const want = ids && ids.length ? new Set(ids) : null;
  for (let i = 0; i < cardView.slots.length; i++) {
    const b = cardView.card ? cardView.card[i] : null;
    setClass(cardView.slots[i].btn, 'is-guide', !!(want && b && want.has(b.id)));
  }
}
