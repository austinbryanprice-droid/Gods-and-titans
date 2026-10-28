// Mouse and keyboard control (DESIGN 9 input): WC3-style selection (click,
// drag box, shift add/remove, double-click / ctrl-click for all of a type on
// screen, control groups, Tab subgroups), right-click smart orders with shift
// queueing, command-card hotkeys, targeting modes (attack-move, abilities,
// gather, pray, rally), building placement with the ghost, and the camera
// (edge scroll, arrows, wheel zoom, middle-drag, minimap, Space, F1–F3), and the team's pings and
// markers (Alt+click, middle-click, the marker buttons).
import { TERRAIN, MAX_QUEUE, MAX_WALL_SELECTION } from '../config.js';
import { UNITS, BUILDINGS } from '../data/index.js';
import { isWallType } from '../data/walls.js';
import { MANOR, houseBlocks } from '../data/houses.js';
import { MARKS, DEFAULT_MARK } from '../data/marks.js';
import { getSettings } from '../settings.js';
import { sfx } from '../audio/sfx.js';
import { checkPlacement, checkWallLine, footprintAt, peaceAnchors } from '../game/placement.js';
import { getCommandCard, buttonForKey, buildCheck, trainCheck, affordReason } from './command-card.js';
import { isComplete, isWallEntity, isMergingEntity } from './hud-data.js';
import { MAX_SELECTION } from './hud-selection.js';
import { deletePlan, DELETE_CONFIRM_MS } from './delete-key.js';
import { peaceNotice } from '../sim/peace.js';

const DRAG_THRESHOLD = 5; // px before a left press becomes a box
const DOUBLE_MS = 350;
const PING_CLICK_MS = 350; // a middle press that ends sooner than this without moving is a ping; otherwise it was a camera drag
const EDGE_PX = 4;
const PAN_SPEED = 26; // tiles per second for edge scroll and arrow keys
const HOVER_MS = 60;
const PLACE_CHECK_MS = 90;
const ALERT_JUMP_MS = 20000;
const WHEEL_STEP_PX = 100; // wheel delta that zooms one step
const WHEEL_MAX_STEPS = 3; // cap for one event

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// Inputs that take no typed text: a focused menu toggle or the volume slider must not swallow Esc / F10.
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image']);

function isTyping(e) {
  const t = e.target;
  if (!t || !t.tagName) return false;
  const tag = t.tagName;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(String(t.type || '').toLowerCase());
  return tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export class InputController {
  /**
   * @param {object} o
   * @param {object} o.game the Game: viewState, selection, renderer, hud, command(cmd), setShowAllBars(bool)
   * @param {HTMLCanvasElement} o.canvas
   * @param {HTMLElement} o.overlayRoot element that receives the drag box
   */
  constructor({ game, canvas, overlayRoot }) {
    this.game = game;
    this.vs = game.viewState;
    this.sel = game.selection;
    this.canvas = canvas;
    this.mode = { kind: 'normal' };
    this.menu = 'root';
    this.mx = -1;
    this.my = -1;
    this.mouseInWindow = false;
    this.overCanvas = false;
    this.leftDown = null;
    this.midDown = null;
    this.keys = new Set();
    this.altHeld = false;
    this.lastClick = null;
    this.lastGroup = { n: -1, t: 0 };
    this.lastGod = { i: -1, t: 0 };
    this.lastAlert = null;
    this.idleIndex = -1;
    this.hoverId = null;
    this.hoverRelic = null; // a relic on the ground under the cursor (vs.relicNear)
    this.hoverAt = 0;
    this.hoverMoved = true;
    this.placeAt = 0;
    this.placeSig = '';
    this.zoneSig = ''; // the enemy Town Centers whose kept-clear ground the renderer has been given
    this.queuedBuilds = []; // [{ b, tx, ty }] placed with Shift in this placement mode
    this.deleteArmed = null; // { ids: Set, until } after a first Delete press that asks for a second
    this.shiftHeld = false;
    this.cursor = '';
    this.disposed = false;

    this.box = document.createElement('div');
    this.box.className = 'hud-dragbox';
    this.box.hidden = true;
    (overlayRoot || canvas.parentNode).appendChild(this.box);
    // Next to the cursor while a wall is dragged out: how many segments and what they cost.
    this.wallTip = document.createElement('div');
    this.wallTip.className = 'hud-walltip';
    this.wallTip.hidden = true;
    (overlayRoot || canvas.parentNode).appendChild(this.wallTip);

    this.offs = [];
    const on = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      this.offs.push(() => el.removeEventListener(type, fn, opts));
    };
    on(canvas, 'mousedown', (e) => this.onMouseDown(e));
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(canvas, 'dblclick', (e) => e.preventDefault());
    on(window, 'mousemove', (e) => this.onMouseMove(e));
    on(window, 'mouseup', (e) => this.onMouseUp(e));
    on(window, 'keydown', (e) => this.onKeyDown(e));
    on(window, 'keyup', (e) => this.onKeyUp(e));
    on(window, 'blur', () => this.onBlur());
    on(document, 'mouseleave', () => (this.mouseInWindow = false));
    on(window, 'mouseout', (e) => {
      if (!e.relatedTarget) this.mouseInWindow = false;
    });
    on(document, 'visibilitychange', () => {
      if (document.hidden) this.onBlur();
    });
    // The canvas rect is cached (reading layout every frame forces a reflow).
    this.rect = null;
    on(window, 'resize', () => (this.rect = null));
    if (typeof ResizeObserver === 'function') {
      this.resizeObs = new ResizeObserver(() => (this.rect = null));
      this.resizeObs.observe(canvas);
    }
    this.setCursor('');
  }

  get renderer() {
    return this.game.renderer;
  }

  get hud() {
    return this.game.hud;
  }

  // ---------------------------------------------------------------- helpers

  canvasPoint(clientX, clientY) {
    if (!this.rect) {
      const b = this.canvas.getBoundingClientRect();
      this.rect = { left: b.left, top: b.top, width: b.width, height: b.height };
    }
    const r = this.rect;
    return { x: clientX - r.left, y: clientY - r.top, w: r.width, h: r.height };
  }

  /** Entity under a canvas point as I know it (a fogged enemy building is its remembered copy), or null. */
  pick(x, y) {
    const r = this.renderer;
    if (!r) return null;
    const id = r.pickEntity(x, y);
    if (id === null || id === undefined) return null;
    return this.vs.knownEntity(id);
  }

  ground(x, y) {
    const r = this.renderer;
    return r ? r.screenToWorld(x, y) : null;
  }

  error(text) {
    if (!text) return;
    this.hud.message(text, 'error');
    sfx.play('error');
  }

  command(cmd) {
    this.game.command(cmd);
  }

  marker(x, y, kind) {
    const r = this.renderer;
    if (r && Number.isFinite(x) && Number.isFinite(y)) r.showCommandMarker(x, y, kind);
  }

  /** 'root' | 'build' | 'target' | 'place' for the command card. */
  cardMode() {
    if (this.mode.kind === 'target') return 'target';
    if (this.mode.kind === 'place') return 'place';
    if (this.menu === 'build') {
      // The build menu belongs to the worker subgroup: leave it when another type is
      // active (the selection panel's unit icons change the selection without going through afterSelect).
      const g = this.sel.activeGroup();
      const d = g && UNITS[g.type];
      if (!d || d.class !== 'worker') this.menu = 'root';
    }
    return this.menu;
  }

  setCursor(c) {
    if (this.cursor === c) return;
    this.cursor = c;
    this.canvas.className = c ? `cur-${c}` : 'cur-default';
  }

  ownUnits() {
    return this.sel.ownUnitIds();
  }

  ownWorkers() {
    return this.ownUnits().filter((id) => {
      const e = this.vs.entities.get(id);
      return e && UNITS[e.t] && UNITS[e.t].class === 'worker';
    });
  }

  /** Where the selected worshippers stand, which bounds how far away a dragged wall may be placed (null with none selected). */
  workerSpots() {
    const spots = this.ownWorkers().map((id) => this.vs.entities.get(id)).filter(Boolean);
    return spots.length ? spots : null;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode.kind !== 'place' && this.renderer) this.renderer.hidePlacement();
    this.wallTip.hidden = true;
    this.placeSig = '';
    if (this.queuedBuilds.length) {
      this.queuedBuilds = [];
      if (this.renderer && this.renderer.setPlannedBuilds) this.renderer.setPlannedBuilds(this.queuedBuilds);
    }
    if (this.hud) this.hud.refreshCard();
  }

  /**
   * My buildings already ordered but not placed yet, which a new one may not
   * overlap: the ones Shift-queued in this placement mode and, when this order
   * queues too, the selected workers' pending builds (the snapshot's `bo`).
   */
  plannedBuilds(queue) {
    const out = this.queuedBuilds.slice();
    if (queue) {
      for (const id of this.ownWorkers()) {
        const e = this.vs.entities.get(id);
        if (e && e.bo) out.push(e.bo);
      }
    }
    return out;
  }

  cancelMode() {
    if (this.mode.kind === 'place' && this.mode.anchor) {
      this.dropWallAnchor(); // first Esc / right-click: just the wall being dragged
      return true;
    }
    if (this.mode.kind !== 'normal') {
      this.setMode({ kind: 'normal' });
      return true;
    }
    if (this.menu !== 'root') {
      this.menu = 'root';
      this.hud.refreshCard();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- mouse

  onMouseDown(e) {
    if (this.disposed || this.hud.overlays.open) return;
    if (this.hud.chatOpen) this.hud.closeChat();
    const p = this.canvasPoint(e.clientX, e.clientY);
    this.mx = e.clientX;
    this.my = e.clientY;
    this.mouseInWindow = true;
    if (e.button === 1) {
      e.preventDefault();
      // x, y: where the camera was last moved from; spot: what a ping would mark (the camera moves if this becomes a drag).
      this.midDown = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, spot: this.markSpot(p.x, p.y) };
      this.setCursor('pan');
      return;
    }
    if (e.button === 2) {
      e.preventDefault();
      if (this.mode.kind !== 'normal') this.cancelMode();
      else this.smartAt(p.x, p.y, e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    if (e.altKey && this.mode.kind === 'normal') {
      // Alt+click is a team ping and nothing else (no selection). With an order or a building pending it stays an ordinary click.
      const spot = this.markSpot(p.x, p.y);
      if (spot) this.pingAt(spot.x, spot.y);
      return;
    }
    if (this.mode.kind === 'target') {
      this.confirmTarget(p.x, p.y, null, e.shiftKey);
      return;
    }
    if (this.mode.kind === 'place') {
      if (isWallType(this.mode.building)) this.startWallLine(p.x, p.y);
      else this.confirmPlace(p.x, p.y, e.shiftKey);
      return;
    }
    this.leftDown = { x: e.clientX, y: e.clientY, cx: p.x, cy: p.y, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, box: false };
  }

  onMouseMove(e) {
    this.mx = e.clientX;
    this.my = e.clientY;
    this.shiftHeld = !!e.shiftKey;
    this.mouseInWindow = true;
    this.overCanvas = e.target === this.canvas;
    this.hoverMoved = true;
    if (this.leftDown) {
      const d = Math.hypot(e.clientX - this.leftDown.x, e.clientY - this.leftDown.y);
      if (!this.leftDown.box && d > DRAG_THRESHOLD) this.leftDown.box = true;
      if (this.leftDown.box) this.drawBox(this.leftDown.x, this.leftDown.y, e.clientX, e.clientY);
    }
    if (this.midDown && this.renderer) {
      const md = this.midDown;
      // A few pixels of shake still make a click (a ping); past DRAG_THRESHOLD the press is a drag from where it began.
      if (!md.moved && Math.hypot(e.clientX - md.x, e.clientY - md.y) > DRAG_THRESHOLD) md.moved = true;
      if (md.moved) {
        const cam = this.renderer.camera;
        if (typeof cam.panPixels === 'function') {
          cam.panPixels(e.clientX - md.x, e.clientY - md.y);
        } else {
          const a = this.canvasPoint(md.x, md.y);
          const b = this.canvasPoint(e.clientX, e.clientY);
          const wa = this.ground(a.x, a.y);
          const wb = this.ground(b.x, b.y);
          if (wa && wb) cam.pan(wa.x - wb.x, wa.y - wb.y);
        }
        md.x = e.clientX;
        md.y = e.clientY;
      }
    }
  }

  onMouseUp(e) {
    if (e.button === 1 && this.midDown) {
      const md = this.midDown;
      this.midDown = null;
      this.setCursor('');
      // A middle click, as opposed to a drag of the camera, pings the spot it was made on.
      if (!md.moved && md.spot && !this.disposed && performance.now() - md.t < PING_CLICK_MS) this.pingAt(md.spot.x, md.spot.y);
      return;
    }
    if (e.button === 0 && this.mode.kind === 'place' && this.mode.anchor) {
      // The wall being dragged out is ordered where the button is released (over the map).
      if (this.disposed || !this.overCanvas) this.dropWallAnchor();
      else {
        const p = this.canvasPoint(e.clientX, e.clientY);
        this.confirmWallLine(p.x, p.y, e.shiftKey);
      }
      return;
    }
    if (e.button !== 0 || !this.leftDown) return;
    const ld = this.leftDown;
    this.leftDown = null;
    this.box.hidden = true;
    if (this.disposed) return;
    if (ld.box) {
      const a = this.canvasPoint(ld.x, ld.y);
      const b = this.canvasPoint(e.clientX, e.clientY);
      this.boxSelect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), ld.shift);
    } else {
      this.clickSelect(ld.cx, ld.cy, ld.shift, ld.ctrl);
    }
  }

  onWheel(e) {
    e.preventDefault();
    if (this.hud.overlays.open || !this.renderer) return;
    let dy = e.deltaY || 0;
    if (dy === 0) return;
    // Scale by the size of the scroll (a notched wheel is ~100 per click = one step) so
    // trackpads and free-spinning wheels, which send many tiny events, zoom gently.
    if (e.deltaMode === 1) dy *= 33; // lines
    else if (e.deltaMode === 2) dy *= 300; // pages
    this.renderer.camera.zoomBy(Math.max(-WHEEL_MAX_STEPS, Math.min(WHEEL_MAX_STEPS, -dy / WHEEL_STEP_PX)));
  }

  drawBox(x0, y0, x1, y1) {
    const b = this.box;
    b.hidden = false;
    b.style.left = `${Math.min(x0, x1)}px`;
    b.style.top = `${Math.min(y0, y1)}px`;
    b.style.width = `${Math.abs(x1 - x0)}px`;
    b.style.height = `${Math.abs(y1 - y0)}px`;
  }

  // ---------------------------------------------------------------- selection

  /** Own entities of a type currently on screen. */
  ownOfTypeOnScreen(type) {
    const r = this.renderer;
    const vs = this.vs;
    if (!r) return [];
    const { w, h } = this.canvasPoint(0, 0);
    const out = [];
    for (const e of vs.entities.values()) {
      if (e.o !== vs.myIndex || e.t !== type || (e.k !== 'u' && e.k !== 'b')) continue;
      const p = r.worldToScreen(e.ix ?? e.x, e.iy ?? e.y, 0);
      if (p && p.sx >= 0 && p.sy >= 0 && p.sx <= w && p.sy <= h) out.push(e.id);
    }
    return out;
  }

  clickSelect(x, y, shift, ctrl) {
    const e = this.pick(x, y);
    const now = performance.now();
    const sel = this.sel;
    if (!e) {
      if (!shift) sel.clear();
      this.lastClick = null;
      return;
    }
    const own = e.o === this.vs.myIndex;
    const dbl = this.lastClick && this.lastClick.t > now - DOUBLE_MS && this.lastClick.type === e.t && Math.hypot(this.lastClick.x - x, this.lastClick.y - y) < 12;
    this.lastClick = { t: now, type: e.t, x, y };
    if (own && (ctrl || dbl)) {
      const ids = this.ownOfTypeOnScreen(e.t);
      if (!ids.includes(e.id)) ids.unshift(e.id);
      if (shift) sel.add(ids);
      else sel.set(ids, { activeType: e.t });
      this.lastClick = null;
    } else if (own && shift && sel.isOwn()) {
      sel.toggle(e.id);
    } else {
      sel.set([e.id]);
    }
    this.afterSelect();
  }

  boxSelect(x0, y0, x1, y1, shift) {
    const r = this.renderer;
    if (!r) return;
    const vs = this.vs;
    let ids = (r.entitiesInRect(x0, y0, x1, y1) || []).filter((id) => {
      const e = vs.entities.get(id);
      return e && e.k === 'u' && e.o === vs.myIndex;
    });
    let wallsOnly = false;
    if (!ids.length) {
      // No units: own buildings whose centre is inside the box. A box over a walled base takes
      // its buildings and leaves the wall; a box over nothing but wall takes the segments.
      const walls = [];
      for (const e of vs.entities.values()) {
        if (e.k !== 'b' || e.o !== vs.myIndex) continue;
        const p = r.worldToScreen(e.x, e.y, 0);
        if (p && p.sx >= x0 && p.sx <= x1 && p.sy >= y0 && p.sy <= y1) (isWallEntity(e) ? walls : ids).push(e.id);
      }
      if (!ids.length) {
        ids = walls;
        wallsOnly = true;
      }
    }
    if (!ids.length) {
      if (!shift) this.sel.clear();
      return;
    }
    ids = ids.slice(0, wallsOnly ? MAX_WALL_SELECTION : MAX_SELECTION * 2);
    if (shift && this.sel.isOwn()) this.sel.add(ids);
    else this.sel.set(ids);
    this.afterSelect();
  }

  afterSelect() {
    this.menu = 'root';
    if (this.sel.size) sfx.play('select');
    if (this.renderer) this.renderer.setSelection(this.sel.ids);
    this.hud.refreshCard();
  }

  /** Centre the camera on a list of ids (their average position). */
  centerOnIds(ids) {
    const r = this.renderer;
    if (!r || !ids.length) return false;
    let x = 0;
    let y = 0;
    let n = 0;
    for (const id of ids) {
      const e = this.vs.knownEntity(id);
      if (!e) continue;
      x += e.ix ?? e.x;
      y += e.iy ?? e.y;
      n++;
    }
    if (!n) return false;
    r.camera.centerOn(x / n, y / n);
    return true;
  }

  centerOnSelection() {
    const prim = this.sel.primary();
    if (prim && prim.k !== 'u') return this.centerOnIds([prim.id]);
    return this.centerOnIds(this.sel.ownUnitIds().length ? this.sel.ownUnitIds() : this.sel.ids);
  }

  /** Remember the latest alert for Space. */
  noteAlert(x, y) {
    this.lastAlert = { x, y, t: performance.now(), used: false };
  }

  spaceJump() {
    const a = this.lastAlert;
    if (a && !a.used && performance.now() - a.t < ALERT_JUMP_MS && this.renderer) {
      a.used = true;
      this.renderer.camera.centerOn(a.x, a.y);
      return;
    }
    this.centerOnSelection();
  }

  /** F1–F3 / portrait click. */
  selectGod(i, center = false, shift = false) {
    const gods = this.hud.ownGods();
    const g = gods[i];
    if (!g) return;
    const now = performance.now();
    const dbl = this.lastGod.i === i && now - this.lastGod.t < DOUBLE_MS;
    this.lastGod = { i, t: now };
    if (shift) this.sel.toggle(g.id);
    else this.sel.set([g.id]);
    this.afterSelect();
    if (center || dbl) this.centerOnIds([g.id]);
  }

  /** "." / idle button: next idle worshipper (all of them with shift / ctrl). */
  cycleIdleWorker(all = false) {
    const ids = this.hud.idleWorkers();
    if (!ids.length) return;
    if (all) {
      this.sel.set(ids);
      this.afterSelect();
      return;
    }
    const cur = this.sel.size === 1 ? this.sel.ids[0] : null;
    let i = cur !== null ? ids.indexOf(cur) : -1;
    i = i >= 0 ? (i + 1) % ids.length : (this.idleIndex + 1) % ids.length;
    this.idleIndex = i;
    this.sel.set([ids[i]]);
    this.afterSelect();
    this.centerOnIds([ids[i]]);
  }

  // ---------------------------------------------------------------- orders

  /** Right click: smart order for units, rally for production buildings. */
  smartAt(x, y, shift, world = null) {
    const vs = this.vs;
    const units = this.ownUnits();
    const target = world ? null : this.pick(x, y);
    const p = world || this.ground(x, y);
    if (units.length) {
      if (!p && !target) return;
      const cmd = { type: 'smart', units, queue: !!shift };
      const px = p ? p.x : target.x;
      const py = p ? p.y : target.y;
      cmd.x = px;
      cmd.y = py;
      let kind = 'move';
      // A relic on the ground under the cursor (DESIGN 5.13): the nearest carrier picks it up.
      const relic = p && !(target && target.k !== 'm' && (vs.isEnemy(target.o) || target.o < 0) && vs.canHarm(target.o)) ? vs.relicNear(p.x, p.y) : null;
      if (relic) {
        cmd.relic = relic.i;
        cmd.x = relic.x;
        cmd.y = relic.y;
        this.command(cmd);
        this.marker(relic.x, relic.y, 'gather');
        sfx.play('move');
        return;
      }
      if (target && !(target.k === 'u' && units.includes(target.id))) {
        cmd.target = target.id;
        if (target.k === 'm') kind = 'gather';
        else if (vs.isEnemy(target.o) || target.o < 0) kind = vs.canHarm(target.o) ? 'attack' : 'move'; // (Decade of Peace: a walk)
      } else if (p) {
        const tx = Math.floor(p.x);
        const ty = Math.floor(p.y);
        if (tx >= 0 && ty >= 0 && tx < vs.width && ty < vs.height && vs.seenTerrain[ty * vs.width + tx] === TERRAIN.FOREST && vs.isExplored(tx, ty)) {
          cmd.tx = tx;
          cmd.ty = ty;
          kind = 'gather';
        }
      }
      this.command(cmd);
      const mx = target && kind !== 'move' ? target.ix ?? target.x : px;
      const my = target && kind !== 'move' ? target.iy ?? target.y : py;
      this.marker(mx, my, kind);
      sfx.play('move');
      return;
    }
    const blds = this.sel.ownBuildings().filter((b) => isComplete(b) && this.produces(b));
    if (blds.length && (p || target)) {
      this.rally(blds, p || { x: target.x, y: target.y }, target);
      sfx.play('click');
    }
  }

  produces(b) {
    const def = BUILDINGS[b.t];
    return !!def && (Array.isArray(def.produces) ? def.produces.length > 0 : !!def.produces);
  }

  rally(buildings, p, target) {
    for (const b of buildings) {
      const cmd = { type: 'rally', building: b.id, x: p.x, y: p.y };
      if (target && target.id !== b.id) cmd.target = target.id;
      this.command(cmd);
    }
    this.marker(target ? target.x : p.x, target ? target.y : p.y, 'rally');
  }

  /** Is there a tree at or near a tile (gather targeting)? */
  treeNear(x, y, r = 2) {
    const vs = this.vs;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let best = null;
    let bestD = Infinity;
    for (let ty = cy - r; ty <= cy + r; ty++) {
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (tx < 0 || ty < 0 || tx >= vs.width || ty >= vs.height) continue;
        if (vs.seenTerrain[ty * vs.width + tx] !== TERRAIN.FOREST || !vs.isExplored(tx, ty)) continue;
        const d = Math.hypot(tx + 0.5 - x, ty + 0.5 - y);
        if (d < bestD) {
          bestD = d;
          best = { tx, ty };
        }
      }
    }
    return best;
  }

  /**
   * Left click in a targeting mode. `world` is set when clicking the minimap.
   * Stays in the mode on an invalid target, or with shift held.
   */
  confirmTarget(x, y, world, shift) {
    const m = this.mode;
    const vs = this.vs;
    const target = world ? null : this.pick(x, y);
    const p = world || this.ground(x, y) || (target ? { x: target.x, y: target.y } : null);
    if (!p) return;
    const units = this.ownUnits();
    let ok = true;
    switch (m.order) {
      case 'move': {
        if (target && target.k === 'u' && vs.isAlly(target.o) && !units.includes(target.id)) {
          this.command({ type: 'smart', units, x: target.x, y: target.y, target: target.id, queue: !!shift });
        } else this.command({ type: 'move', units, x: p.x, y: p.y, queue: !!shift });
        this.marker(p.x, p.y, 'move');
        sfx.play('move');
        break;
      }
      case 'attack': {
        if (target && target.k === 'b' && !vs.isEntityVisible(vs.entities.get(target.id))) {
          // A remembered building in the fog (maybe destroyed since): a smart order attacks
          // it if it still stands, else walks to it. 'attack' would do nothing at all then.
          this.command({ type: 'smart', units, target: target.id, x: target.x, y: target.y, queue: !!shift });
          this.marker(target.x, target.y, 'attack');
        } else if (target && (target.k === 'u' || target.k === 'b') && (vs.isEnemy(target.o) || target.o < 0)) {
          this.command({ type: 'attack', units, target: target.id, queue: !!shift });
          this.marker(target.ix ?? target.x, target.iy ?? target.y, vs.canHarm(target.o) ? 'attack' : 'move');
        } else {
          this.command({ type: 'attackMove', units, x: p.x, y: p.y, queue: !!shift });
          this.marker(p.x, p.y, 'attack');
        }
        sfx.play('move');
        break;
      }
      case 'gather': {
        const workers = this.ownWorkers();
        if (target && target.k === 'm') {
          this.command({ type: 'gather', units: workers, target: target.id, queue: !!shift });
          this.marker(target.x, target.y, 'gather');
        } else {
          const tree = this.treeNear(p.x, p.y);
          if (!tree) {
            ok = false;
            this.error('Must target a gold mine or trees.');
            break;
          }
          this.command({ type: 'gather', units: workers, tx: tree.tx, ty: tree.ty, queue: !!shift });
          this.marker(tree.tx + 0.5, tree.ty + 0.5, 'gather');
        }
        sfx.play('move');
        break;
      }
      case 'pray': {
        const def = target && target.k === 'b' ? BUILDINGS[target.t] : null;
        if (!def || target.o !== vs.myIndex || !(def.prayerSlots > 0) || !isComplete(target)) {
          ok = false;
          this.error('Must target your Shrine or Temple.');
          break;
        }
        this.command({ type: 'pray', units: this.ownWorkers(), target: target.id, queue: !!shift });
        this.marker(target.x, target.y, 'move');
        sfx.play('move');
        break;
      }
      case 'repair': {
        if (!target || target.k !== 'b' || target.o !== vs.myIndex) {
          ok = false;
          this.error('Must target one of your buildings.');
          break;
        }
        if (isComplete(target) && !(target.hp < target.mhp)) {
          ok = false;
          this.error('That building is not damaged.');
          break;
        }
        this.command({ type: 'repair', units: this.ownWorkers(), target: target.id, queue: !!shift });
        this.marker(target.x, target.y, 'move');
        sfx.play('move');
        break;
      }
      case 'rally': {
        const blds = this.sel.ownBuildings().filter((b) => isComplete(b) && this.produces(b));
        this.rally(blds, p, target);
        sfx.play('click');
        break;
      }
      case 'cast':
        ok = this.castAt(m, p, target, shift);
        break;
      case 'mark': {
        // A marker button's click: a unit or building under the cursor is marked where it stands.
        const spot = target ? { x: target.ix ?? target.x, y: target.iy ?? target.y } : p;
        ok = this.sendMark(m.mark, spot.x, spot.y);
        break;
      }
      default:
        break;
    }
    if (ok && !shift) this.setMode({ kind: 'normal' });
    else if (ok) m.shiftUsed = true; // releasing Shift ends the mode
  }

  /** Units of the active ability's type that can cast it now. */
  readyCasters(m) {
    const ab = UNITS[m.unitType] && UNITS[m.unitType].abilities.find((a) => a.id === m.ability);
    if (!ab) return { ab: null, casters: [] };
    const casters = [];
    for (const id of this.ownUnits()) {
      const e = this.vs.entities.get(id);
      if (!e || e.t !== m.unitType) continue;
      if (UNITS[e.t].class === 'god' && (e.lv || 1) < (ab.unlockLevel || 1)) continue;
      if (e.cd && e.cd[ab.id] > 0) continue;
      if (e.fx && e.fx.includes('stun')) continue;
      casters.push(e);
    }
    return { ab, casters };
  }

  castAt(m, p, target, shift) {
    const vs = this.vs;
    const { ab, casters } = this.readyCasters(m);
    if (!ab) return true;
    if (!casters.length) {
      this.error('That ability is not ready.');
      return true;
    }
    let tgt = null;
    if (m.target === 'unit') {
      if (!target || target.k !== 'u') return this.castError('Must target a unit.');
      tgt = target;
    } else if (m.target === 'ally') {
      if (!target || target.k !== 'u' || !vs.isAlly(target.o)) return this.castError('Must target a friendly unit.');
      tgt = target;
    } else if (m.target === 'enemy') {
      if (!target || target.k === 'm' || !(vs.isEnemy(target.o) || target.o < 0)) return this.castError('Must target an enemy.');
      if (!vs.canHarm(target.o)) return this.castError(peaceNotice(vs.peaceLeft()));
      tgt = target;
    }
    const tx = tgt ? tgt.x : p.x;
    const ty = tgt ? tgt.y : p.y;
    // The closest ready caster takes it.
    let best = casters[0];
    let bestD = Infinity;
    for (const c of casters) {
      const d = Math.hypot(c.x - tx, c.y - ty);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    const cmd = { type: 'cast', unit: best.id, ability: ab.id, queue: !!shift };
    if (tgt) cmd.target = tgt.id;
    else {
      cmd.x = p.x;
      cmd.y = p.y;
    }
    this.command(cmd);
    this.marker(tx, ty, tgt && vs.isAlly(tgt.o) ? 'move' : 'attack');
    sfx.play('move');
    return true;
  }

  castError(text) {
    this.error(text);
    return false;
  }

  confirmPlace(x, y, shift) {
    const m = this.mode;
    const p = this.ground(x, y);
    if (!p) return;
    const { tx, ty } = footprintAt(m.building, p.x, p.y);
    const chk = checkPlacement(this.vs, this.vs.myIndex, m.building, tx, ty, this.plannedBuilds(shift));
    if (!chk.valid) {
      this.error(chk.message || "Can't build there.");
      return;
    }
    const bc = buildCheck(this.vs, m.building);
    if (bc.state !== 'ready') {
      this.error(bc.reason);
      this.setMode({ kind: 'normal' });
      return;
    }
    const workers = this.ownWorkers();
    if (!workers.length) {
      this.setMode({ kind: 'normal' });
      return;
    }
    // WC3: the nearest selected worker goes.
    const size = BUILDINGS[m.building].size;
    const cx = tx + size / 2;
    const cy = ty + size / 2;
    let best = workers[0];
    let bestD = Infinity;
    for (const id of workers) {
      const e = this.vs.entities.get(id);
      if (!e) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    this.command({ type: 'build', units: [best], building: m.building, tx, ty, queue: !!shift });
    this.marker(cx, cy, 'move');
    sfx.play('move');
    if (!shift) {
      this.menu = 'root';
      this.setMode({ kind: 'normal' });
    } else {
      m.shiftUsed = true; // keep placing while Shift is held
      this.placeSig = '';
      // Until the worker gets there this spot is taken: the ghost turns red on it, and it is drawn.
      this.queuedBuilds.push({ b: m.building, tx, ty });
      if (this.renderer && this.renderer.setPlannedBuilds) this.renderer.setPlannedBuilds(this.queuedBuilds);
    }
  }

  // ---------------------------------------------------------------- wall lines

  /** Left press while placing a wall: the line starts on this tile and ends where the button is released. */
  startWallLine(x, y) {
    const p = this.ground(x, y);
    if (!p) return;
    const { tx, ty } = footprintAt(this.mode.building, p.x, p.y);
    this.mode.anchor = { tx, ty };
    this.placeSig = '';
  }

  /** Give up the line being dragged (Esc, right-click, focus lost) but stay in wall placement. */
  dropWallAnchor() {
    this.mode.anchor = null;
    this.placeSig = '';
    this.wallTip.hidden = true;
    if (this.renderer) this.renderer.hidePlacement();
  }

  /** Button released: order the line when any of it can be built and paid for. */
  confirmWallLine(x, y, shift) {
    const m = this.mode;
    const a = m.anchor;
    if (!a) return;
    m.anchor = null;
    this.wallTip.hidden = true;
    this.placeSig = '';
    const p = this.ground(x, y);
    if (!p) return; // let go past the edge of the map, where no ground shows: nothing is ordered, the placement stays open
    const end = footprintAt(m.building, p.x, p.y);
    const line = checkWallLine(this.vs, this.vs.myIndex, m.building, a.tx, a.ty, end.tx, end.ty, null, this.workerSpots());
    if (!line.build) {
      this.error(line.message);
      return;
    }
    const bc = buildCheck(this.vs, m.building);
    if (bc.state === 'locked') {
      this.error(bc.reason);
      this.setMode({ kind: 'normal' });
      return;
    }
    const short = affordReason(this.vs.me, line.cost);
    if (short) {
      this.error(short); // stay in the mode: a shorter line may be affordable
      return;
    }
    const workers = this.ownWorkers();
    if (!workers.length) {
      this.setMode({ kind: 'normal' });
      return;
    }
    this.command({ type: 'build', units: workers, building: m.building, tx: a.tx, ty: a.ty, tx2: end.tx, ty2: end.ty, queue: !!shift });
    const mid = line.tiles[Math.floor(line.tiles.length / 2)];
    this.marker(mid.tx + 0.5, mid.ty + 0.5, 'move');
    sfx.play('move');
    if (!shift) {
      this.menu = 'root';
      this.setMode({ kind: 'normal' });
    } else {
      m.shiftUsed = true; // keep laying walls while Shift is held
    }
  }

  /**
   * In a Decade of Peace, tint the ground kept clear around the enemy Town Centers I know of under the
   * placement ghost (it only goes to the renderer when those Town Centers change).
   */
  showPeaceZone(r) {
    if (!r.setNoBuildZones) return;
    const anchors = peaceAnchors(this.vs);
    const sig = anchors.map((a) => `${a.tx},${a.ty}`).join(';');
    if (sig === this.zoneSig) return;
    this.zoneSig = sig;
    r.setNoBuildZones(anchors);
  }

  /** The tip beside the cursor says why the ghost is red when it is the peace's kept-clear ground (the sim says the same). */
  peaceTip(chk) {
    const tip = this.wallTip;
    if (!chk.peace) {
      tip.hidden = true;
      return;
    }
    const text = chk.message.replace(': ', ':\n');
    if (tip.textContent !== text) tip.textContent = text;
    tip.classList.add('is-bad');
    tip.style.left = `${this.mx + 18}px`;
    tip.style.top = `${this.my + 18}px`;
    tip.hidden = false;
  }

  /** The dragged line's ghost, and the tip beside the cursor with what it would build and cost. */
  previewWallLine(tx, ty) {
    const m = this.mode;
    const a = m.anchor || { tx, ty };
    const line = checkWallLine(this.vs, this.vs.myIndex, m.building, a.tx, a.ty, tx, ty, null, this.workerSpots());
    const sig = `w|${m.building}|${line.tiles.map((t) => `${t.tx},${t.ty},${t.state[0]}`).join(';')}`;
    if (sig !== this.placeSig) {
      this.placeSig = sig;
      this.renderer.showWallLine(m.building, line.tiles);
    }
    const tip = this.wallTip;
    if (!m.anchor) {
      tip.hidden = true;
      return;
    }
    const short = line.build ? affordReason(this.vs.me, line.cost) : null;
    const cost = [line.cost.gold ? `💰 ${line.cost.gold}` : '', line.cost.wood ? `🌲 ${line.cost.wood}` : '', line.cost.faith ? `✨ ${line.cost.faith}` : ''].filter(Boolean).join(' ');
    tip.textContent = line.build ? `${line.build} × ${BUILDINGS[m.building].name}  ${cost}${short ? `  ${short}` : ''}` : line.message;
    tip.classList.toggle('is-bad', !line.build || !!short);
    tip.style.left = `${this.mx + 18}px`;
    tip.style.top = `${this.my + 18}px`;
    tip.hidden = false;
  }

  /** Minimap pointer events (from minimap.js). */
  onMinimap({ button, phase, x, y, shift, alt }) {
    if (this.hud.overlays.open) return;
    const r = this.renderer;
    // The middle button, and Alt+click when no order is pending, ping the team at that spot.
    if (button === 1 || (button === 0 && alt && this.mode.kind === 'normal')) {
      if (phase === 'down') this.pingAt(x, y);
      return;
    }
    if (button === 0) {
      if (phase === 'down' && this.mode.kind === 'target') {
        this.confirmTarget(0, 0, { x, y }, shift);
        return;
      }
      if (this.mode.kind !== 'normal' && phase === 'down') return;
      if (r && (phase === 'down' || phase === 'drag')) r.camera.centerOn(x, y);
    } else if (button === 2 && phase === 'down') {
      if (this.mode.kind !== 'normal') {
        this.cancelMode();
        return;
      }
      this.smartAt(0, 0, shift, { x, y });
    }
  }

  // ---------------------------------------------------------------- team marks

  /** True while a marker button is armed (its next click on the map or minimap places the marker). */
  marking() {
    return this.mode.kind === 'target' && this.mode.order === 'mark';
  }

  /** What a click on the map marks: a unit or building where it stands, otherwise the ground under the cursor. */
  markSpot(x, y) {
    const t = this.pick(x, y);
    if (t && Number.isFinite(t.x) && Number.isFinite(t.y)) return { x: t.ix ?? t.x, y: t.iy ?? t.y };
    return this.ground(x, y);
  }

  /** Ping the team at a spot (Alt+click, middle-click). */
  pingAt(x, y) {
    return this.sendMark(DEFAULT_MARK, x, y);
  }

  /** Send a mark of this kind; the game keeps the pace, shows it here and tells the team. */
  sendMark(kind, x, y) {
    if (this.disposed || this.hud.overlays.open || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    return this.game.sendMark(kind, x, y);
  }

  /** A marker button was pressed: the next click on the map or minimap places it (the button again, or Esc, puts it away). */
  armMark(kind) {
    if (this.disposed || this.hud.overlays.open || !Object.hasOwn(MARKS, kind)) return;
    sfx.play('click');
    if (this.marking() && this.mode.mark === kind) {
      this.cancelMode();
      return;
    }
    this.setMode({ kind: 'target', order: 'mark', mark: kind, target: 'point' });
    this.hud.message(`${MARKS[kind].name}: click the map or the minimap. Esc cancels.`, 'info', { icon: MARKS[kind].icon });
  }

  // ---------------------------------------------------------------- command card

  /**
   * Run a command card button (click or hotkey).
   * @param {object} b button from getCommandCard
   * @param {{ shift?: boolean, fromClick?: boolean }} [opts]
   */
  activate(b, { shift = false } = {}) {
    if (!b || b.passive || this.disposed) return;
    if (!b.enabled) {
      if (b.reason) this.error(b.reason);
      return;
    }
    const a = b.action || {};
    const vs = this.vs;
    sfx.play('click');
    switch (a.kind) {
      case 'stop':
        this.command({ type: 'stop', units: this.ownUnits() });
        break;
      case 'hold':
        this.command({ type: 'hold', units: this.ownUnits(), queue: !!shift });
        break;
      case 'return':
        this.command({ type: 'returnCargo', units: this.ownWorkers(), queue: !!shift });
        break;
      case 'submenu':
        this.menu = a.menu;
        this.hud.refreshCard();
        break;
      case 'back':
      case 'cancel':
        this.cancelMode();
        break;
      case 'place':
        this.setMode({ kind: 'place', building: a.building });
        break;
      case 'target':
        this.setMode({ kind: 'target', ...a });
        break;
      case 'cast': {
        const { ab, casters } = this.readyCasters(a);
        if (!ab) break;
        if (!casters.length) {
          this.error('That ability is not ready.');
          break;
        }
        for (const c of casters) this.command({ type: 'cast', unit: c.id, ability: ab.id, queue: !!shift });
        break;
      }
      case 'train': {
        const group = this.sel.activeGroup();
        const blds = this.sel.ownBuildings().filter((e) => group && e.t === group.type && isComplete(e));
        // Shift-click queues up to five (as many as the queues and the purse allow).
        let budget = 1;
        if (shift) {
          const me = vs.me;
          const chk = trainCheck(vs, a.unit, blds);
          budget = 5;
          for (const k of ['gold', 'wood', 'faith']) if (chk.cost[k] > 0) budget = Math.min(budget, Math.floor(me[k] / chk.cost[k]));
          if (chk.cost.pop > 0) budget = Math.min(budget, Math.floor((me.popCap - me.pop) / chk.cost.pop));
          budget = Math.max(1, budget);
        }
        const slots = blds.map((e) => ({ id: e.id, n: (e.q || []).length, growing: (e.q || []).some((q) => q.u === 'tier_up') }));
        let sent = 0;
        for (let i = 0; i < budget; i++) {
          let pick = null;
          for (const s of slots) if (!s.growing && s.n < MAX_QUEUE && (!pick || s.n < pick.n)) pick = s;
          if (!pick) break;
          pick.n++;
          this.command({ type: 'train', building: pick.id, unit: a.unit });
          sent++;
        }
        if (!sent) this.error('Production queue is full.');
        break;
      }
      case 'tier': {
        const tc = this.sel.ownBuildings().find((e) => e.t === 'town_center' && isComplete(e));
        if (tc) this.command({ type: 'upgradeTier', building: tc.id });
        break;
      }
      case 'cancelBuild':
        for (const e of this.sel.ownBuildings()) if (!isComplete(e)) this.command({ type: 'cancelBuild', building: e.id });
        break;
      case 'upgradeWall': {
        // Every finished segment of the active type that is not upgrading already (the sim pays one by one).
        const walls = this.activeWalls().filter((e) => isComplete(e) && !(e.q || []).length).map((e) => e.id);
        if (walls.length) this.command({ type: 'upgradeWall', walls });
        break;
      }
      case 'dismantleWall':
        for (const e of this.activeWalls()) if (isComplete(e)) this.command({ type: 'cancelBuild', building: e.id });
        break;
      case 'cancelWall':
        for (const e of this.activeWalls()) {
          if (!isComplete(e)) this.command({ type: 'cancelBuild', building: e.id });
          else if ((e.q || []).length) this.command({ type: 'cancelTrain', building: e.id, index: 0 });
        }
        break;
      case 'upgradeHouses': {
        // Every finished House of the active type: the sim finds the squares among them and pays square by square.
        const houses = this.activeHouses().map((e) => e.id);
        if (houses.length) this.command({ type: 'upgradeHouses', houses });
        break;
      }
      case 'cancelMerge': {
        // Stopping any one House of a square stops all four: one order for each whole square among the
        // selected Houses, and one for each House left over from a part of a square.
        const merging = this.activeHouses().filter(isMergingEntity);
        const squares = houseBlocks(merging);
        const covered = new Set(squares.flatMap((sq) => sq.ids));
        const stop = [...squares.map((sq) => sq.ids[0]), ...merging.filter((e) => !covered.has(e.id)).map((e) => e.id)];
        for (const id of stop) this.command({ type: 'cancelTrain', building: id, index: vs.entities.get(id).q.findIndex((it) => it.u === MANOR) });
        break;
      }
      case 'research': {
        // The least busy finished building of the active group researches it.
        const group = this.sel.activeGroup();
        let pick = null;
        for (const e of this.sel.ownBuildings()) {
          if (!group || e.t !== group.type || !isComplete(e)) continue;
          const q = e.q || [];
          if (q.some((it) => it.u === 'tier_up') || q.length >= MAX_QUEUE || isMergingEntity(e)) continue;
          if (!pick || q.length < (pick.q || []).length) pick = e;
        }
        if (pick) this.command({ type: 'research', building: pick.id, upgrade: a.upgrade });
        break;
      }
      case 'autoRepair':
        this.command({ type: 'autoRepair', on: !!a.on });
        break;
      default:
        break;
    }
  }

  /** Own Houses of the active subgroup (the command card's combine buttons act on these). */
  activeHouses() {
    const group = this.sel.activeGroup();
    return this.sel.ownBuildings().filter((e) => group && e.t === group.type && isComplete(e));
  }

  /** Own wall segments of the active subgroup (the command card's wall buttons act on these). */
  activeWalls() {
    const group = this.sel.activeGroup();
    return this.sel.ownBuildings().filter((e) => group && e.t === group.type && isWallEntity(e));
  }

  /** Right-click on an ability button: autocast on / manual for the selected units of that type. */
  toggleAutocast(b) {
    const t = b && b.toggle;
    if (!t || t.kind !== 'autocast' || this.disposed) return;
    const units = this.ownUnits().filter((id) => {
      const e = this.vs.entities.get(id);
      return e && e.t === t.unitType;
    });
    if (!units.length) return;
    sfx.play('click');
    this.command({ type: 'autocast', units, ability: t.ability, on: !!t.on });
  }

  /** ` key: every ability of the selected units to manual, or back to autocast when all are manual. */
  toggleAllAutocast() {
    const units = [];
    let anyOn = false;
    for (const id of this.ownUnits()) {
      const e = this.vs.entities.get(id);
      const def = e && UNITS[e.t];
      if (!def || def.class === 'worker' || !def.abilities.length) continue;
      units.push(id);
      const all = (1 << def.abilities.length) - 1;
      if (((e.mc || 0) & all) !== all) anyOn = true;
    }
    if (!units.length) return;
    sfx.play('click');
    this.command({ type: 'autocast', units, on: !anyOn });
    this.hud.message(anyOn ? 'Abilities set to manual.' : 'Abilities set to autocast.', 'info', { icon: '⚙️' });
  }

  /** The Delete question still waiting for its second press, or null (it lapses after DELETE_CONFIRM_MS). */
  pendingDelete() {
    if (this.deleteArmed && performance.now() >= this.deleteArmed.until) this.deleteArmed = null;
    return this.deleteArmed;
  }

  /**
   * Delete, or Backspace (the delete key of a Mac keyboard): destroy the selected own units (the sim's
   * `kill`). A few plain units go at once; a bigger group, a god or a Titan first says what it would
   * destroy and needs a second press (of either key, DELETE_CONFIRM_MS) with nothing new in the
   * selection. Buildings are not units and stay.
   */
  deleteSelected() {
    const units = this.ownUnits().map((id) => this.vs.entities.get(id)).filter(Boolean);
    if (!units.length) {
      this.deleteArmed = null;
      if (this.sel.ownBuildings().length) this.error('Delete destroys units, not buildings.');
      return;
    }
    const plan = deletePlan(units);
    const armed = this.pendingDelete();
    if (plan.confirm && !(armed && plan.ids.every((id) => armed.ids.has(id)))) {
      this.deleteArmed = { ids: new Set(plan.ids), until: performance.now() + DELETE_CONFIRM_MS };
      this.hud.message(plan.prompt, 'error');
      return;
    }
    this.deleteArmed = null;
    // The units are about to be gone: a pending placement or target would have nobody to order.
    if (this.mode.kind !== 'normal') this.setMode({ kind: 'normal' });
    this.menu = 'root';
    this.command({ type: 'kill', units: plan.ids });
  }

  // ---------------------------------------------------------------- keyboard

  onKeyDown(e) {
    if (this.disposed) return;
    const hud = this.hud;
    if (!hud) return;
    if (isTyping(e)) return;
    const key = e.key;
    if (key === 'Shift') this.shiftHeld = true;
    // Holding a key fires keydown repeatedly: only arrows (scrolling) and train hotkeys
    // (hold W to queue more) use that; everything else acts once per press.
    const rep = e.repeat === true;
    const overlays = hud.overlays;
    if (overlays.open) {
      if (key === 'Escape' || key === 'F10') {
        e.preventDefault();
        if (!rep) overlays.escape();
      } else if (key === 'Enter' && overlays.name === 'menu') {
        // let Enter activate the focused button
      } else if (/^F[1-3]$/.test(key)) e.preventDefault(); // browser help / search; F5, F11, F12 keep working
      return;
    }
    if (key === 'F10') {
      e.preventDefault();
      if (!rep) overlays.openMenu();
      return;
    }
    if (key === 'Enter') {
      e.preventDefault();
      if (!rep) hud.openChat();
      return;
    }
    if (key === 'Alt') {
      e.preventDefault();
      if (!this.altHeld) {
        this.altHeld = true;
        this.game.setShowAllBars(true);
      }
      return;
    }
    if (ARROWS[key]) {
      e.preventDefault();
      this.keys.add(key);
      return;
    }
    if (key === 'Tab') {
      e.preventDefault();
      if (!rep && this.sel.cycleSubgroup(e.shiftKey ? -1 : 1)) {
        this.menu = 'root';
        hud.refreshCard();
      }
      return;
    }
    if (key === ' ' || e.code === 'Space') {
      e.preventDefault();
      if (!rep) this.spaceJump();
      return;
    }
    if (key === 'F1' || key === 'F2' || key === 'F3') {
      e.preventDefault();
      if (!rep) this.selectGod(Number(key[1]) - 1, false, e.shiftKey);
      return;
    }
    if (key === 'Home') {
      e.preventDefault();
      if (rep) return;
      const tc = [...this.vs.entities.values()].find((x) => x.k === 'b' && x.o === this.vs.myIndex && x.t === 'town_center');
      if (tc) this.renderer.camera.centerOn(tc.x, tc.y);
      return;
    }
    // Control groups: Digit1..9 (also with shift, whose key is a symbol).
    const m = /^(Digit|Numpad)([1-9])$/.exec(e.code || '');
    if (m) {
      e.preventDefault();
      if (rep) return;
      const n = Number(m[2]);
      if (e.ctrlKey || e.metaKey) {
        if (this.sel.saveGroup(n)) hud.message(`Group ${n} assigned.`, 'info', { icon: '👥' });
      } else if (e.shiftKey) {
        this.sel.addToGroup(n);
      } else {
        const now = performance.now();
        const dbl = this.lastGroup.n === n && now - this.lastGroup.t < DOUBLE_MS;
        this.lastGroup = { n, t: now };
        if (this.sel.recallGroup(n)) {
          this.afterSelect();
          if (dbl) this.centerOnSelection();
        }
      }
      return;
    }
    if (key === '.' || e.code === 'NumpadDecimal' || e.code === 'Period') {
      e.preventDefault();
      if (rep) return;
      this.cycleIdleWorker(e.shiftKey || e.ctrlKey);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
    if (key === '`' || e.code === 'Backquote') {
      e.preventDefault();
      if (!rep) this.toggleAllAutocast();
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      if (!rep) this.deleteSelected();
      return;
    }
    if (key === 'Escape') {
      e.preventDefault();
      if (rep) return;
      if (this.pendingDelete()) {
        this.deleteArmed = null; // Esc takes back the question and nothing else
        return;
      }
      const card = hud.currentCard();
      const b = buttonForKey(card, 'Escape');
      if (b) {
        hud.flashSlot(b.slot);
        this.activate(b);
        return;
      }
      if (this.cancelMode()) return;
      // A building with a queue: cancel the last item (WC3). (Not a wall's upgrade or Houses being combined: Esc by habit would take it back.)
      const blds = this.sel.ownBuildings().filter((x) => x.q && x.q.length && !isWallEntity(x) && !isMergingEntity(x));
      if (blds.length) {
        const bq = blds[0];
        this.command({ type: 'cancelTrain', building: bq.id, index: bq.q.length - 1 });
      }
      return;
    }
    if (key.length === 1) {
      let b = buttonForKey(hud.currentCard(), key);
      // While targeting or placing the card is only Cancel: another command hotkey
      // replaces the pending order (WC3), so A then S stops instead of doing nothing.
      const pending = this.mode.kind !== 'normal';
      if (!b && pending) b = buttonForKey(getCommandCard(this.sel.forCard(), this.vs, this.menu), key);
      if (b) {
        e.preventDefault();
        if (rep && !(b.enabled && b.action && b.action.kind === 'train')) return;
        hud.flashSlot(b.slot);
        if (pending && b.enabled) this.cancelMode();
        this.activate(b, { shift: e.shiftKey });
      }
    }
  }

  onKeyUp(e) {
    if (ARROWS[e.key]) this.keys.delete(e.key);
    if (e.key === 'Shift') {
      this.shiftHeld = false;
      this.endShiftMode();
    }
    if (e.key === 'Alt') {
      e.preventDefault();
      this.altHeld = false;
      this.game.setShowAllBars(false);
    }
  }

  /** After Shift-queued targets or placements, letting go of Shift finishes the mode. */
  endShiftMode() {
    if (!this.mode.shiftUsed || this.mode.anchor) return; // a wall still being dragged ends the mode when ordered
    if (this.mode.kind === 'place') this.menu = 'root';
    this.setMode({ kind: 'normal' });
  }

  onBlur() {
    this.shiftHeld = false;
    this.deleteArmed = null;
    this.endShiftMode();
    this.keys.clear();
    if (this.altHeld) {
      this.altHeld = false;
      this.game.setShowAllBars(false);
    }
    this.mouseInWindow = false;
    if (this.leftDown) {
      this.leftDown = null;
      this.box.hidden = true;
    }
    if (this.mode.kind === 'place' && this.mode.anchor) this.dropWallAnchor();
    this.midDown = null;
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    const r = this.renderer;
    if (!r || this.disposed) return;
    const overlay = this.hud.overlays.open;
    // Camera pan: arrows and edge scroll.
    let dx = 0;
    let dy = 0;
    for (const k of this.keys) {
      dx += ARROWS[k][0];
      dy += ARROWS[k][1];
    }
    if (!overlay && getSettings().edgeScroll && this.mouseInWindow && !this.leftDown && !this.midDown && (typeof document.hasFocus !== 'function' || document.hasFocus())) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (this.mx >= 0) {
        if (this.mx <= EDGE_PX) dx -= 1;
        else if (this.mx >= w - 1 - EDGE_PX) dx += 1;
        if (this.my <= EDGE_PX) dy -= 1;
        else if (this.my >= h - 1 - EDGE_PX) dy += 1;
      }
    }
    if ((dx || dy) && !overlay) {
      const len = Math.hypot(dx, dy) || 1;
      const sx = (dx / len) * PAN_SPEED * dt;
      const sy = (dy / len) * PAN_SPEED * dt;
      if (typeof r.camera.scroll === 'function') r.camera.scroll(sx, sy);
      else r.camera.pan(sx, sy);
    }

    const now = performance.now();
    const p = this.canvasPoint(this.mx, this.my);
    // Hover + cursor.
    if (this.overCanvas && !overlay && (this.hoverMoved || now - this.hoverAt > 250) && now - this.hoverAt > HOVER_MS) {
      this.hoverAt = now;
      this.hoverMoved = false;
      const e = this.pick(p.x, p.y);
      const id = e ? e.id : null;
      const g = e ? null : this.ground(p.x, p.y);
      this.hoverRelic = g ? this.vs.relicNear(g.x, g.y) : null;
      if (id !== this.hoverId) {
        this.hoverId = id;
        r.setHover(id);
      }
    } else if ((!this.overCanvas || overlay) && this.hoverId !== null) {
      this.hoverRelic = null;
      this.hoverId = null;
      r.setHover(null);
    }
    this.updateCursor();

    // Placement ghost.
    if (this.mode.kind === 'place') {
      if (!this.overCanvas) {
        if (this.placeSig) {
          r.hidePlacement();
          this.placeSig = '';
          this.wallTip.hidden = true;
        }
      } else if (now - this.placeAt > PLACE_CHECK_MS || this.hoverMoved) {
        const w = this.ground(p.x, p.y);
        if (w) {
          const { tx, ty } = footprintAt(this.mode.building, w.x, w.y);
          this.showPeaceZone(r);
          if (isWallType(this.mode.building)) this.previewWallLine(tx, ty);
          else {
            const chk = checkPlacement(this.vs, this.vs.myIndex, this.mode.building, tx, ty, this.plannedBuilds(this.shiftHeld));
            const sig = `${this.mode.building}|${tx}|${ty}|${chk.tiles.map((t) => (t ? 1 : 0)).join('')}`;
            if (sig !== this.placeSig || now - this.placeAt > 400) {
              this.placeSig = sig;
              r.showPlacement(this.mode.building, tx, ty, chk.valid, chk.tiles);
            }
            this.peaceTip(chk);
          }
          this.placeAt = now;
        }
      }
    }
  }

  updateCursor() {
    if (this.midDown) return this.setCursor('pan');
    const vs = this.vs;
    const h = this.hoverId !== null ? vs.knownEntity(this.hoverId) : null;
    if (this.mode.kind === 'place') return this.setCursor('place');
    if (this.mode.kind === 'target') {
      if (h && vs.canHarm(h.o) && (h.o >= 0 || h.k === 'u')) return this.setCursor('target-enemy');
      if (h && h.k !== 'm' && vs.isAlly(h.o)) return this.setCursor('target-ally');
      return this.setCursor('target');
    }
    if (h && this.sel.ownUnitIds().length && vs.canHarm(h.o) && (h.o >= 0 || h.k === 'u')) return this.setCursor('enemy');
    if (h || (this.hoverRelic && this.sel.ownUnitIds().length)) return this.setCursor('select');
    return this.setCursor('');
  }

  dispose() {
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    if (this.resizeObs) this.resizeObs.disconnect();
    this.box.remove();
    this.wallTip.remove();
    this.keys.clear();
  }
}
