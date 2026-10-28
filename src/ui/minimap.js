// Minimap (DESIGN 9): a 2D canvas with the pre-rendered terrain (repainted when
// trees fall), gold mines, team-coloured units and buildings that the local
// player can see (or remembers), the fog of war, the camera's view quad, alert
// pings and the team's pings and markers. Left click / drag moves the camera,
// right click issues a smart order, Alt+click or a middle click pings the team;
// the input controller receives them all through `onPointer`.
import { TERRAIN, NEUTRAL_COLOR } from '../config.js';
import { BUILDINGS, UNITS } from '../data/index.js';
import { MARKS } from '../data/marks.js';
import { safeColor } from './hud-dom.js';

const DRAW_INTERVAL_MS = 100; // entities + fog layer (10 Hz); the camera quad redraws every frame
const TERRAIN_REPAINT_MS = 700;
const PING_MS = 3200;

const BASE = {
  [TERRAIN.GRASS]: [86, 132, 62],
  [TERRAIN.DIRT]: [138, 110, 70],
  [TERRAIN.WATER]: [38, 86, 138],
  [TERRAIN.FOREST]: [30, 72, 38],
  [TERRAIN.ROCK]: [118, 112, 104],
  [TERRAIN.SAND]: [196, 176, 120],
};

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export class Minimap {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {object} o.viewState
   * @param {() => object|null} o.getCamera returns the renderer's camera (getViewQuad)
   * @param {(info: {button: number, phase: 'down'|'drag'|'up', x: number, y: number, shift: boolean, ctrl: boolean, alt: boolean}) => void} [o.onPointer]
   * @param {object} [o.marks] TeamMarks: the pings and markers to draw
   */
  constructor({ canvas, viewState, getCamera, onPointer, marks }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.vs = viewState;
    this.getCamera = getCamera || (() => null);
    this.onPointer = onPointer || null;
    this.marks = marks || null;
    this.marksShown = false;
    this.W = viewState.width;
    this.H = viewState.height;
    this.pings = [];
    this.lastDraw = -Infinity;
    this.lastTerrain = -Infinity;
    this.terrainVersion = -1;
    this.pxPerTile = 0;
    this.dragging = 0; // mouse button held on the minimap + 1
    this.colorCache = new Map();
    this.viewQuad = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]; // refilled by camera.getViewQuad every draw

    // Layers: terrain (1 px per tile), fog (1 px per tile), entities (canvas size).
    this.terrain = document.createElement('canvas');
    this.terrain.width = this.W;
    this.terrain.height = this.H;
    this.fog = document.createElement('canvas');
    this.fog.width = this.W;
    this.fog.height = this.H;
    this.fogData = this.fog.getContext('2d').createImageData(this.W, this.H);
    this.layer = document.createElement('canvas');
    this.paintTerrain();

    this.handlers = [];
    const on = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      this.handlers.push(() => el.removeEventListener(type, fn, opts));
    };
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'mousedown', (e) => {
      if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      // A ping (Alt+click, or the middle button) is one press: nothing is dragged after it.
      const ping = e.button === 1 || (e.button === 0 && e.altKey);
      this.dragging = ping ? 0 : e.button + 1;
      this.emit(e, 'down');
    });
    on(window, 'mousemove', (e) => {
      if (this.dragging === 1) this.emit(e, 'drag', 0);
    });
    on(window, 'mouseup', (e) => {
      if (!this.dragging) return;
      const b = this.dragging - 1;
      this.dragging = 0;
      if (e.button === b) this.emit(e, 'up', b);
    });
    // Re-measure only when the element or the window changes size (reading
    // layout every frame would force a reflow after each HUD update).
    this.needsFit = true;
    on(window, 'resize', () => (this.needsFit = true));
    if (typeof ResizeObserver === 'function') {
      this.resizeObs = new ResizeObserver(() => (this.needsFit = true));
      this.resizeObs.observe(canvas);
    }
  }

  /** World (tile) coordinates of a client point, clamped to the map. */
  worldAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / Math.max(1, r.width)) * this.W;
    const y = ((clientY - r.top) / Math.max(1, r.height)) * this.H;
    return { x: Math.max(0, Math.min(this.W - 0.01, x)), y: Math.max(0, Math.min(this.H - 0.01, y)) };
  }

  emit(e, phase, button = e.button) {
    if (!this.onPointer) return;
    const p = this.worldAt(e.clientX, e.clientY);
    this.onPointer({ button, phase, x: p.x, y: p.y, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: !!e.altKey });
  }

  /** Flash an alert ring at a world position. */
  ping(x, y, color = '#ff4a3a') {
    this.pings.push({ x, y, color, t0: performance.now() });
    if (this.pings.length > 8) this.pings.shift();
  }

  /** Paint the terrain layer as I have seen it (felled trees are grass once seen). */
  paintTerrain() {
    const { W, H } = this;
    const map = this.vs.map;
    const terrain = this.vs.seenTerrain || map.terrain;
    const heights = map.heights;
    const ctx = this.terrain.getContext('2d');
    const img = ctx.createImageData(W, H);
    const d = img.data;
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        const i = ty * W + tx;
        const t = terrain[i];
        const base = BASE[t] || BASE[TERRAIN.GRASS];
        let shade = 1;
        if (heights && heights.length === (W + 1) * (H + 1)) {
          const h0 = heights[ty * (W + 1) + tx];
          const h1 = heights[(ty + 1) * (W + 1) + tx + 1];
          shade = t === TERRAIN.WATER ? 0.85 + Math.max(-0.6, h0) * 0.35 : 0.9 + h0 * 0.25 + (h0 - h1) * 0.6;
        }
        shade *= 0.94 + hash2(tx, ty) * 0.12;
        d[i * 4] = Math.min(255, base[0] * shade);
        d[i * 4 + 1] = Math.min(255, base[1] * shade);
        d[i * 4 + 2] = Math.min(255, base[2] * shade);
        d[i * 4 + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.terrainVersion = this.vs.seenVersion;
  }

  /** Fog image: unexplored dark, explored-but-unseen dimmed, visible clear. */
  paintFog() {
    const vs = this.vs;
    const d = this.fogData.data;
    const n = this.W * this.H;
    const all = vs.revealAll;
    for (let i = 0; i < n; i++) {
      const a = all || vs.visible[i] ? 0 : vs.explored[i] ? 120 : 228;
      d[i * 4 + 3] = a;
    }
    this.fog.getContext('2d').putImageData(this.fogData, 0, 0);
  }

  colorOf(owner) {
    let c = this.colorCache.get(owner);
    if (!c) {
      const p = this.vs.players[owner] || (this.vs.setup && this.vs.setup.players[owner]);
      c = owner < 0 ? '#d8c890' : safeColor(p && p.color, NEUTRAL_COLOR);
      this.colorCache.set(owner, c);
    }
    return c;
  }

  /** Resize the backing store to the element's CSS size × devicePixelRatio. */
  fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(32, Math.round(r.width * dpr));
    const h = Math.max(32, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.layer.width = w;
      this.layer.height = h;
      this.lastDraw = -Infinity;
    }
    this.pxPerTile = w / this.W;
  }

  drawLayer() {
    const vs = this.vs;
    const ctx = this.layer.getContext('2d');
    const w = this.layer.width;
    const h = this.layer.height;
    const k = w / this.W;
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.terrain, 0, 0, w, h);

    // Buildings and mines (under units).
    const drawRect = (tx, ty, size, fill, stroke) => {
      const x = tx * k;
      const y = ty * k;
      const s = Math.max(3, size * k);
      ctx.fillStyle = stroke;
      ctx.fillRect(x - 1, y - 1, s + 2, s + 2);
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, s, s);
    };
    // A wall segment is a thin line of its owner's colour, not a boxed block (a wall is dozens of them).
    const drawBuilding = (typeId, tx, ty, owner) => {
      const def = BUILDINGS[typeId];
      if (def && def.wall) {
        const s = Math.max(1.6, k);
        ctx.fillStyle = this.colorOf(owner);
        ctx.fillRect(tx * k, ty * k, s, s);
      } else drawRect(tx, ty, (def && def.size) || 2, this.colorOf(owner), 'rgba(0,0,0,0.85)');
    };
    for (const e of vs.entities.values()) {
      if (e.k === 'm') {
        if (vs.isEntityVisible(e)) drawRect(e.tx, e.ty, 3, '#ffd34a', '#3a2a00');
        continue;
      }
      if (e.k !== 'b') continue;
      if (!vs.isAlly(e.o) && !vs.isEntityVisible(e)) continue;
      drawBuilding(e.t, e.tx, e.ty, e.o);
    }
    // Remembered enemy buildings under fog.
    if (vs.lastSeen) {
      for (const [id, ls] of vs.lastSeen) {
        const cur = vs.entities.get(id);
        if (cur && vs.isEntityVisible(cur)) continue;
        drawBuilding(ls.t, ls.tx, ls.ty, ls.o);
      }
    }
    // Fog over terrain and remembered things, under live units.
    ctx.drawImage(this.fog, 0, 0, w, h);
    // Sacred sites (DESIGN 5.11): public knowledge, so drawn over the fog: a diamond in the holder's colour, pale gold when nobody holds it.
    const r = Math.max(3.2, k * 1.9);
    for (const site of vs.sites || []) {
      const x = site.x * k;
      const y = site.y * k;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fillStyle = site.o >= 0 ? this.colorOf(site.o) : '#fff0c4';
      ctx.fill();
      ctx.lineWidth = Math.max(1, k * 0.45);
      ctx.strokeStyle = site.p > 0 ? '#ffffff' : 'rgba(0,0,0,0.9)';
      ctx.stroke();
    }
    // Units.
    const dot = Math.max(2.2, k * 1.15);
    for (const e of vs.entities.values()) {
      if (e.k !== 'u') continue;
      if (!vs.isAlly(e.o) && !vs.isEntityVisible(e)) continue;
      const ud = UNITS[e.t];
      const s = ud && (ud.class === 'titan' || ud.class === 'god') ? dot * 1.6 : dot;
      const x = (e.ix ?? e.x) * k;
      const y = (e.iy ?? e.y) * k;
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(x - s / 2 - 0.75, y - s / 2 - 0.75, s + 1.5, s + 1.5);
      ctx.fillStyle = this.colorOf(e.o);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
    // Relics on the ground or still guarded (DESIGN 5.14): a gold diamond, brighter once free.
    const rs = Math.max(3, k * 1.6);
    for (const r of vs.relics || []) {
      if ((r.s !== 'g' && r.s !== 'k') || !vs.relicKnown(r)) continue;
      const x = r.x * k;
      const y = r.y * k;
      ctx.beginPath();
      ctx.moveTo(x, y - rs);
      ctx.lineTo(x + rs, y);
      ctx.lineTo(x, y + rs);
      ctx.lineTo(x - rs, y);
      ctx.closePath();
      ctx.fillStyle = r.s === 'g' ? '#fff3b0' : '#e0a93a';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(40,20,0,0.9)';
      ctx.stroke();
    }
  }

  /**
   * Redraw. The fog and entity layer refresh at 10 Hz; the camera quad and
   * pings every call.
   * @param {number} [now] performance.now()
   */
  update(now = performance.now()) {
    if (!this.canvas.isConnected) return;
    if (this.needsFit) {
      this.needsFit = false;
      this.fit();
    }
    if (this.vs.seenVersion !== this.terrainVersion && now - this.lastTerrain > TERRAIN_REPAINT_MS) {
      this.lastTerrain = now;
      this.paintTerrain();
      this.lastDraw = -Infinity;
    }
    let dirty = false;
    if (now - this.lastDraw >= DRAW_INTERVAL_MS) {
      this.lastDraw = now;
      this.paintFog();
      this.drawLayer();
      dirty = true;
    }
    const cam = this.getCamera();
    const quad = cam && typeof cam.getViewQuad === 'function' ? cam.getViewQuad(this.viewQuad) : null;
    const quadSig = quad ? quad.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') : '';
    if (quadSig !== this.quadSig) {
      this.quadSig = quadSig;
      dirty = true;
    }
    // Nothing moved: keep the last frame (pings and marks animate, so they always redraw).
    const marks = this.marks ? this.marks.active(now) : null;
    const marked = !!marks && marks.length > 0;
    if (!dirty && !this.pings.length && !this.pingsShown && !marked && !this.marksShown) return;
    this.pingsShown = this.pings.length > 0;
    this.marksShown = marked;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const k = w / this.W;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.layer, 0, 0);

    // Camera view quad.
    if (quad && quad.length === 4) {
      ctx.save();
      ctx.beginPath();
      quad.forEach((p, i) => {
        const x = Math.max(-1, Math.min(w + 1, p.x * k));
        const y = Math.max(-1, Math.min(h + 1, p.y * k));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.lineWidth = Math.max(1.2, w / 160);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.stroke();
      ctx.lineWidth = Math.max(0.8, w / 260);
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.stroke();
      ctx.restore();
    }

    // Alert pings: expanding rings.
    if (this.pings.length) {
      this.pings = this.pings.filter((p) => now - p.t0 < PING_MS);
      for (const p of this.pings) {
        const t = (now - p.t0) / PING_MS;
        for (let r = 0; r < 2; r++) {
          const tt = (t * 3 + r * 0.5) % 1;
          ctx.beginPath();
          ctx.arc(p.x * k, p.y * k, (2 + tt * 14) * (w / 200), 0, Math.PI * 2);
          ctx.lineWidth = Math.max(1.5, w / 140);
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = (1 - tt) * (1 - t * 0.6);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    if (marked) this.drawMarks(ctx, marks, w, h, now);
  }

  /**
   * The team's pings and markers: two rings spreading in the sender's colour, and a badge with the
   * kind's icon on the spot (kept inside the map when the spot is at its edge). A mark fades out
   * over its last moments.
   */
  drawMarks(ctx, marks, w, h, now) {
    const k = w / this.W;
    const unit = w / 200;
    const r = Math.max(6, w * 0.036);
    ctx.save();
    ctx.lineWidth = Math.max(1.5, w / 120);
    for (const m of marks) {
      const fade = Math.min(1, Math.max(0, (m.t1 - now) / 800));
      const t = (now - m.t0) / 1000;
      ctx.strokeStyle = this.colorOf(m.from);
      for (let i = 0; i < 2; i++) {
        const tt = (t * 0.8 + i * 0.5) % 1;
        ctx.beginPath();
        ctx.arc(m.x * k, m.y * k, r * 0.8 + tt * 13 * unit, 0, Math.PI * 2);
        ctx.globalAlpha = (1 - tt) * 0.9 * fade;
        ctx.stroke();
      }
    }
    ctx.font = `${Math.round(r * 1.25)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of marks) {
      const def = MARKS[m.kind];
      if (!def) continue;
      const x = Math.min(w - r - 1, Math.max(r + 1, m.x * k));
      const y = Math.min(h - r - 1, Math.max(r + 1, m.y * k));
      ctx.globalAlpha = Math.min(1, Math.max(0, (m.t1 - now) / 800));
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(8, 10, 16, 0.88)';
      ctx.fill();
      ctx.strokeStyle = this.colorOf(m.from);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(def.icon, x, y + 0.5);
    }
    ctx.restore();
  }

  dispose() {
    for (const off of this.handlers.splice(0)) off();
    if (this.resizeObs) this.resizeObs.disconnect();
    this.onPointer = null;
  }
}
