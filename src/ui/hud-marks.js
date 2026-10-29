// Team marks on the HUD (DESIGN 9): the pins that stand over the battlefield where a teammate (or
// I) pinged or marked, the arrows on the edge of the play area for the ones out of view (click to
// go there), and the marker buttons beside the minimap. The marks themselves live in a TeamMarks
// store (src/game/team-marks.js); the minimap draws its own copy.
import { MARKS, MARK_KINDS } from '../data/marks.js';
import { sanitizeName } from '../net/protocol.js';
import { el, setClass, setStyle, safeColor } from './hud-dom.js';
import { displayColor } from '../team-colors.js';

const EDGE_PAD_EM = 3.2; // distance from the border of the play area to the chip of an edge arrow
const ARROW_EM = 1.9; // distance from that chip's middle to its arrowhead
const PIN_EM = 5.6; // height of a standing pin (name, chip, stem and bob) above its spot, plus the top bar's crest
const INSET_REFRESH_MS = 500; // how often the heights of the top bar and bottom console are read again
const FADE_MS = 800; // a mark fades out over its last moments

/** How many computer players share my team: they answer an Attack, Defend or Help marker (DESIGN 10). */
export function aiAllyCount(vs) {
  const list = (vs.setup && vs.setup.players) || [];
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (i !== vs.myIndex && p && p.team === vs.myTeam && p.kind === 'ai') n++;
  }
  return n;
}

/** How many other people share my team: the players who can see a mark (a computer teammate has no screen). */
export function teammateCount(vs) {
  const list = (vs.setup && vs.setup.players) || vs.players || [];
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (i !== vs.myIndex && p && p.team === vs.myTeam && p.kind !== 'ai') n++;
  }
  return n;
}

/** Pins over the battlefield and arrows at the edge, one element per standing mark. */
export class MarksLayer {
  /**
   * @param {object} o
   * @param {HTMLElement} o.root the HUD root; the layer is added to it
   * @param {object} o.marks TeamMarks
   * @param {object} o.viewState senders' names and colours
   * @param {() => object|null} o.getRenderer the renderer (worldToScreen, camera)
   * @param {() => { top: number, bottom: number }} [o.getInsets] heights of the panels that cover the top and bottom of the screen
   */
  constructor({ root, marks, viewState, getRenderer, getInsets }) {
    this.root = root;
    this.marks = marks;
    this.vs = viewState;
    this.getRenderer = getRenderer;
    this.getInsets = getInsets || (() => ({ top: 0, bottom: 0 }));
    this.layer = el('div', 'hud-marks');
    root.appendChild(this.layer);
    this.items = new Map(); // mark id → { root, arrow }
    this.insets = { top: 0, bottom: 0 };
    this.insetsAt = -Infinity;
    this.em = 11; // px per em of the HUD, which follows the size of the window
  }

  /** The area where a pin can be seen: the screen without the panels along its top and bottom (px), and the pad edge arrows keep from its border. */
  playArea(now) {
    if (now - this.insetsAt >= INSET_REFRESH_MS) {
      this.insetsAt = now;
      this.insets = this.getInsets();
      const fs = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(this.root).fontSize) : NaN;
      if (fs > 0) this.em = fs;
    }
    const W = this.root.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1280);
    const H = this.root.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 720);
    return {
      left: 0,
      right: W,
      top: this.insets.top,
      bottom: Math.max(this.insets.top + 1, H - this.insets.bottom),
      pad: EDGE_PAD_EM * this.em,
    };
  }

  make(m) {
    const def = MARKS[m.kind];
    const p = this.vs.players[m.from] || (this.vs.setup && this.vs.setup.players[m.from]);
    const name = sanitizeName(p && p.name, 'Teammate');
    const arrow = el('i', 'hud-mark-arrow');
    const node = el('button', `hud-mark is-${m.kind}`,
      el('i', 'hud-mark-ring'),
      el('span', 'hud-mark-pin', el('b', 'hud-mark-who', name), el('span', 'hud-mark-chip', def.icon)),
      arrow);
    node.type = 'button';
    node.tabIndex = -1;
    node.title = `${name}: ${def.text} Click to go there.`;
    node.style.setProperty('--c', displayColor(safeColor(p && p.color, '#f1e8d4')));
    node.style.setProperty('--k', def.color);
    // Only an edge arrow takes clicks; it takes the camera to the mark.
    node.addEventListener('mousedown', (e) => e.preventDefault());
    node.addEventListener('click', () => {
      const r = this.getRenderer();
      if (r && r.camera) r.camera.centerOn(m.x, m.y);
    });
    this.layer.appendChild(node);
    const item = { root: node, arrow };
    this.items.set(m.id, item);
    return item;
  }

  /** Put every standing mark where it belongs on the screen; drop the elements of marks that went out. */
  update(now = performance.now()) {
    const list = this.marks.active(now);
    if (this.items.size) {
      const live = new Set(list.map((m) => m.id));
      for (const [id, item] of this.items) {
        if (live.has(id)) continue;
        item.root.remove();
        this.items.delete(id);
      }
    }
    const r = this.getRenderer();
    if (!r || !list.length) return;
    const area = this.playArea(now);
    for (const m of list) this.place(this.items.get(m.id) || this.make(m), m, r, area, now);
  }

  place(item, m, r, area, now) {
    const s = r.worldToScreen(m.x, m.y, 0);
    const inside = s.onScreen && s.sx >= area.left && s.sx <= area.right && s.sy >= area.top && s.sy <= area.bottom;
    let x = s.sx;
    let y = s.sy;
    let angle = 0;
    if (!inside) {
      // Out of view (or under a panel): an arrow on the edge of the play area, toward the spot from its middle.
      const cx = (area.left + area.right) / 2;
      const cy = (area.top + area.bottom) / 2;
      let dx = s.sx - cx;
      let dy = s.sy - cy;
      const cam = r.camera;
      if (!s.onScreen && cam && cam.target) {
        // (A spot behind the camera projects mirrored, so go by where it lies on the ground.)
        dx = m.x - cam.target.x;
        dy = (m.y - cam.target.y) * Math.sin(cam.pitch || 1);
      }
      if (!dx && !dy) dy = 1;
      const hw = Math.max(1, (area.right - area.left) / 2 - area.pad);
      const hh = Math.max(1, (area.bottom - area.top) / 2 - area.pad);
      const k = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
      x = cx + dx * k;
      y = cy + dy * k;
      angle = Math.atan2(dy, dx);
    }
    setStyle(item.root, 'transform', `translate(${Math.round(x * 2) / 2}px, ${Math.round(y * 2) / 2}px)`);
    setClass(item.root, 'is-edge', !inside);
    // A spot just below the top bar: the pin hangs under it, stem up, instead of standing up into the bar.
    setClass(item.root, 'is-below', inside && y - PIN_EM * this.em < area.top);
    if (!inside) setStyle(item.arrow, 'transform', `rotate(${Math.round(angle * 100) / 100}rad) translateX(${ARROW_EM}em)`);
    const fade = Math.min(1, Math.max(0, (m.t1 - now) / FADE_MS));
    setStyle(item.root, 'opacity', fade < 1 ? String(Math.round(fade * 20) / 20) : '');
  }

  dispose() {
    this.layer.remove();
    this.items.clear();
  }
}

/** The marker buttons beside the minimap: pick one, then click the map or the minimap. */
export class MarkPalette {
  /**
   * @param {object} o
   * @param {(kind: string) => void} o.onPick
   */
  constructor({ onPick }) {
    this.root = el('div', 'hud-markpad');
    this.buttons = new Map();
    for (const id of MARK_KINDS) {
      const b = el('button', `hud-markbtn is-${id}`, MARKS[id].icon);
      b.type = 'button';
      b.tabIndex = -1;
      b.style.setProperty('--k', MARKS[id].color);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => onPick(id));
      this.root.appendChild(b);
      this.buttons.set(id, b);
    }
    this.teammates = -1;
    this.aiAllies = -1;
    this.setTeammates(0);
  }

  /** Light the button of the marker being placed (null for none). */
  setArmed(kind) {
    for (const [id, b] of this.buttons) setClass(b, 'is-armed', id === kind);
  }

  /**
   * The tooltips say who will see a mark, and that computer allies answer an Attack, Defend or Help
   * marker (DESIGN 10: they send their army there).
   * @param {number} n other people on my team
   * @param {number} [ai] computer players on my team
   */
  setTeammates(n, ai = 0) {
    if (n === this.teammates && ai === this.aiAllies) return;
    this.teammates = n;
    this.aiAllies = ai;
    const who = n > 0 ? `Only your ${n === 1 ? 'teammate sees' : `${n} teammates see`} it.` : ai > 0 ? 'No other person sees it.' : 'You have no teammates in this match, so only you see it.';
    const answer = ai > 0 ? ` Your computer ${ai === 1 ? 'ally sends its' : 'allies send their'} army there.` : '';
    for (const [id, b] of this.buttons) {
      const def = MARKS[id];
      const how = id === 'ping'
        ? 'Alt+click or middle-click the map or minimap pings at once; this button makes your next click a ping.'
        : `Click, then click the map or the minimap to call "${def.text}"`;
      const ans = id === 'attack' || id === 'defend' || id === 'help' ? answer : '';
      b.title = `${def.name}: ${how} ${who}${ans} (Esc cancels)`;
    }
  }
}
