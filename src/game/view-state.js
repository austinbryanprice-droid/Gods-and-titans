// Client-side view of the game (DESIGN 7), used identically on the host and
// on clients: the latest ViewSnapshot plus smooth interpolated positions, the
// fog of war for my team, last-seen enemy buildings and gold mines, the map
// with felled trees removed (and the terrain as I have seen it, where trees
// felled out of sight still stand), and an event bus fed by each snapshot's
// events. Runs in Node too.
import { INTERP_DELAY_MS, TERRAIN } from '../config.js';
import { computeVisibility } from '../sim/visibility.js';
import { peaceSeconds } from '../sim/peace.js';
import { sacredVictoryOn } from '../sim/sacred.js';
import { UNITS, BUILDINGS, GOLD_MINE } from '../data/index.js';

const HISTORY = 8; // position samples kept per unit
const SNAP_DIST = 4; // tiles; a jump this big between samples (blink) is not interpolated
const DEFAULT_SIGHT = 6;
const CLOCK_WINDOW = 20; // snapshots (~1 s): if all of them came late, the playback clock follows
const KEEP_KEYS = new Set(['ix', 'iy', 'if']);

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function cloneMap(mapData) {
  if (!mapData || !mapData.width || !mapData.height) throw new Error('ViewState needs mapData (width, height, terrain).');
  const n = mapData.width * mapData.height;
  const terrain = Uint8Array.from(mapData.terrain || new Uint8Array(n));
  let wood;
  if (mapData.wood && mapData.wood.length === n) wood = Uint16Array.from(mapData.wood);
  else {
    wood = new Uint16Array(n);
    for (let i = 0; i < n; i++) if (terrain[i] === TERRAIN.FOREST) wood[i] = 50;
  }
  return { ...mapData, terrain, wood };
}

export class ViewState {
  /**
   * @param {object} o
   * @param {object} o.setup GameSetup
   * @param {object} o.mapData MapData from generateMap (cloned; the original is never modified)
   * @param {number} o.myIndex my player index (-1 = spectator: sees everything)
   * @param {number} [o.interpDelayMs] render this far behind the newest snapshot
   */
  constructor({ setup, mapData, myIndex, interpDelayMs = INTERP_DELAY_MS }) {
    this.setup = setup;
    this.myIndex = myIndex;
    this.interpDelayMs = interpDelayMs;
    this.map = cloneMap(mapData);
    this.width = this.map.width;
    this.height = this.map.height;
    this.mapVersion = 0; // bumped whenever a tree falls
    // Terrain as I have seen it (minimap, placement ghost, tree orders): a tree felled
    // out of my sight stays forest here until I see its tile (as the 3D view does).
    this.seenTerrain = Uint8Array.from(this.map.terrain);
    this.seenVersion = 0; // bumped whenever seenTerrain changes
    this.unseenFells = new Set(); // tile indices felled out of sight, still forest in seenTerrain
    this.visible = new Uint8Array(this.width * this.height);
    this.explored = new Uint8Array(this.width * this.height);
    this.entities = new Map();
    this.lastSeen = new Map();
    // Gold mine id → { x, y, tx, ty, amt }: where it is (mines never move; kept after it
    // collapses) and its gold when last in sight (the map's starting gold until then).
    this.mineMemory = new Map();
    this.players = [];
    this.me = null;
    const sp = setup && setup.players && setup.players[myIndex];
    this.myTeam = sp ? sp.team : null;
    this.tick = -1;
    this.time = 0;
    this.renderTime = 0; // interpolated sim time (s) of what update() shows
    this.fields = [];
    this.reveals = [];
    this.relics = []; // RelicViews (DESIGN 6.3): { i, t, s: 'k'|'g'|'c'|'h', x?, y?, c?, b?, o? }
    // Sacred sites (DESIGN 5.11): the map's places until the first snapshot, then the host's rows
    // { x, y, o, p?, c?, cn? }; sacred is the Sacred Victory countdown { tm, end } or null.
    this.sites = (this.map.sacred || []).map((p) => ({ x: p.x, y: p.y, o: -1 }));
    this.sacred = null;
    this.gameOver = null;
    this.snapshot = null;
    this.felledAll = [];
    this.revealAll = myIndex < 0;
    this.snapshotCount = 0;
    this.listeners = new Map();
    this.hist = new Map(); // unit id → { t, x, y, f: Float64Array(HISTORY), n, head }
    this.clockOffset = null; // local ms − sim ms of the newest snapshot (minimum-latency estimate)
    this.windowMin = Infinity; // smallest local ms − sim ms in the current CLOCK_WINDOW snapshots
    this.windowCount = 0;
    this.lastPushMs = 0;
    this.sightCache = new Map();
    this.sources = [];
    this.srcOf = new Map(); // entity id → the snapshot object last copied from
  }

  // ---------------------------------------------------------------- events

  /**
   * Listen for events of one type ('death', 'hit', …), every event ('*'), or
   * 'snapshot' (after each pushed snapshot, with the snapshot).
   * @returns {() => void} unsubscribe
   */
  on(type, cb) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
  }

  emit(type, payload) {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    for (const cb of [...set]) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[view] '${type}' listener failed`, err);
      }
    }
  }

  // ---------------------------------------------------------------- relations

  /** Team of a player index (null for neutral / unknown). */
  teamOf(owner) {
    if (owner === undefined || owner === null || owner < 0) return null;
    const p = this.players[owner] || (this.setup && this.setup.players && this.setup.players[owner]);
    return p ? p.team : null;
  }

  /** 'own' | 'ally' | 'enemy' | 'neutral' for an owner index, from my point of view. */
  relation(owner) {
    if (owner === undefined || owner === null || owner < 0) return 'neutral';
    if (owner === this.myIndex) return 'own';
    const t = this.teamOf(owner);
    return t !== null && t === this.myTeam ? 'ally' : 'enemy';
  }

  isAlly(owner) {
    const r = this.relation(owner);
    return r === 'own' || r === 'ally';
  }

  isEnemy(owner) {
    return this.relation(owner) === 'enemy';
  }

  // ---------------------------------------------------------------- Decade of Peace

  /** Seconds of the Decade of Peace left at the latest snapshot (0 once it is over, and in a normal game). */
  peaceLeft() {
    const total = peaceSeconds(this.setup);
    return total > 0 ? Math.max(0, total - this.time) : 0;
  }

  /** Is the Decade of Peace on? */
  peaceActive() {
    return this.peaceLeft() > 0;
  }

  /** May my units hurt this owner's units and buildings now? Creatures always; rival players only once the peace is over. */
  canHarm(owner) {
    if (owner === undefined || owner === null) return false;
    if (owner < 0) return true;
    return this.isEnemy(owner) && !this.peaceActive();
  }

  // ---------------------------------------------------------------- Sacred Sites

  /** Is Sacred Victory on in this game? */
  sacredVictoryOn() {
    return sacredVictoryOn(this.setup) && this.sites.length > 0;
  }

  /** Seconds left on the Sacred Victory countdown at the latest snapshot (0 when nobody holds every site). */
  sacredLeft() {
    return this.sacred ? Math.max(0, this.sacred.end - this.time) : 0;
  }

  /** How many sacred sites a team holds. */
  sitesHeld(team) {
    let n = 0;
    for (const s of this.sites) if (s.o >= 0 && this.teamOf(s.o) === team) n++;
    return n;
  }

  // ---------------------------------------------------------------- fog of war

  /** True if the point (tile coords) is visible to my team now. */
  isVisibleAt(x, y) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return false;
    return this.visible[ty * this.width + tx] === 1;
  }

  /** True if my team has ever seen the tile. */
  isExplored(tx, ty) {
    tx = Math.floor(tx);
    ty = Math.floor(ty);
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return false;
    return this.explored[ty * this.width + tx] === 1;
  }

  footprintVisible(tx, ty, size, grid = this.visible) {
    const x0 = Math.max(0, tx);
    const y0 = Math.max(0, ty);
    const x1 = Math.min(this.width - 1, tx + size - 1);
    const y1 = Math.min(this.height - 1, ty + size - 1);
    for (let y = y0; y <= y1; y++) {
      const row = y * this.width;
      for (let x = x0; x <= x1; x++) if (grid[row + x] === 1) return true;
    }
    return false;
  }

  /**
   * Should this entity be drawn as currently seen? Own and allied things always;
   * enemy / neutral units when their tile is visible; buildings when any of
   * their footprint is visible; gold mines once explored.
   */
  isEntityVisible(e) {
    if (!e) return false;
    if (this.revealAll || this.isAlly(e.o)) return true;
    if (e.k === 'u') return this.isVisibleAt(e.x, e.y);
    const size = e.k === 'm' ? 3 : (BUILDINGS[e.t] && BUILDINGS[e.t].size) || 2;
    const tx = e.tx ?? Math.floor(e.x - size / 2);
    const ty = e.ty ?? Math.floor(e.y - size / 2);
    return this.footprintVisible(tx, ty, size, e.k === 'm' ? this.explored : this.visible);
  }

  /** Is any of a gold mine's footprint in sight now? */
  mineInSight(e) {
    if (this.revealAll) return true;
    const m = this.mineMemory.get(e.id);
    return m ? this.footprintVisible(m.tx, m.ty, GOLD_MINE.size) : this.isEntityVisible(e);
  }

  /** Gold left in a mine as far as I know: live while it is in sight, else as last seen. */
  mineGold(e) {
    const m = this.mineMemory.get(e.id);
    return m ? m.amt : e.amt;
  }

  getEntity(id) {
    return this.entities.get(id) || null;
  }

  /**
   * An entity as the local player knows it: the live view while it is own,
   * allied or in sight; the remembered copy of an enemy building in the fog
   * (also once it was destroyed out of sight); else null. Snapshots carry the
   * whole world, so anything shown about others' things should come from here.
   */
  knownEntity(id) {
    const e = this.entities.get(id);
    if (e && this.isEntityVisible(e)) return e;
    return this.lastSeen.get(id) || null;
  }

  // ---------------------------------------------------------------- relics (DESIGN 5.12)

  /**
   * Where a relic is drawn: its spot while guarded or on the ground, its carrier's (interpolated)
   * position, or its Temple. Null when its holder is not in the view.
   */
  relicSpot(r) {
    if (!r) return null;
    if (r.s === 'c' || r.s === 'h') {
      const e = this.entities.get(r.s === 'c' ? r.c : r.b);
      return e ? { x: e.ix ?? e.x, y: e.iy ?? e.y, holder: e } : null;
    }
    return Number.isFinite(r.x) && Number.isFinite(r.y) ? { x: r.x, y: r.y, holder: null } : null;
  }

  /** Should the local player see this relic? On the ground once its tile is explored; carried or housed when the holder is. */
  relicKnown(r) {
    const p = this.relicSpot(r);
    if (!p) return false;
    if (p.holder) return this.isEntityVisible(p.holder);
    return this.revealAll || this.isExplored(Math.floor(p.x), Math.floor(p.y));
  }

  /** The relic a unit carries, or null. */
  relicCarriedBy(id) {
    for (const r of this.relics) if (r.s === 'c' && r.c === id) return r;
    return null;
  }

  /** Relics resting in a Temple. */
  relicsIn(id) {
    return this.relics.filter((r) => r.s === 'h' && r.b === id);
  }

  /** A relic on the ground, in sight, within `range` tiles of a point (the nearest), or null: what a right click picks up. */
  relicNear(x, y, range = 1.2) {
    let best = null;
    let bestD = range;
    for (const r of this.relics) {
      if (r.s !== 'g' || !Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
      if (!this.revealAll && !this.isVisibleAt(r.x, r.y)) continue;
      const d = Math.hypot(r.x - x, r.y - y);
      if (d <= bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  sightOf(e) {
    if (typeof e.sight === 'number') return e.sight;
    let s = this.sightCache.get(e.t);
    if (s === undefined) {
      const def = e.k === 'u' ? UNITS[e.t] : BUILDINGS[e.t];
      s = def && typeof def.sight === 'number' ? def.sight : e.k === 'm' ? 0 : DEFAULT_SIGHT;
      this.sightCache.set(e.t, s);
    }
    return s;
  }

  // ---------------------------------------------------------------- snapshots

  /**
   * Take in a full ViewSnapshot.
   * @param {object} snap ViewSnapshot (treated as read-only)
   * @param {number} [now] local time in ms (performance.now())
   * @param {{ felledAll?: number[][] }} [extra] felledAll from a full resync
   */
  pushSnapshot(snap, now = nowMs(), extra = null) {
    // Trees: this snapshot's treeFelled events fire as usual; trees known only from
    // `felled` or from a resync's `felledAll` get a synthetic event so the renderer
    // can remove them too (sync: true marks the ones felled before we joined).
    const synthetic = [];
    const events = snap.events || [];
    let announced = null;
    for (const ev of events) {
      if (ev.type !== 'treeFelled') continue;
      (announced || (announced = new Set())).add(ev.ty * this.width + ev.tx);
      this.fellTree(ev.tx, ev.ty);
    }
    const felledAll = (extra && extra.felledAll) || snap.felledAll;
    if (felledAll) {
      for (const [tx, ty] of felledAll) {
        if (this.fellTree(tx, ty, true)) synthetic.push({ type: 'treeFelled', tx, ty, sync: true });
      }
    }
    if (snap.felled) {
      for (const [tx, ty] of snap.felled) {
        if (this.fellTree(tx, ty) && !(announced && announced.has(ty * this.width + tx))) synthetic.push({ type: 'treeFelled', tx, ty });
      }
    }

    // Playback clock: sim time is mapped to local time with the smallest observed latency.
    // A late snapshot (jitter) barely moves it; when every snapshot of the last second came
    // late (the sim paused or stalled, latency went up), it moves to the smallest of them.
    const simMs = (snap.time || 0) * 1000;
    const target = now - simMs;
    if (this.clockOffset === null || Math.abs(target - this.clockOffset) > 1000 || target < this.clockOffset) this.clockOffset = target;
    else this.clockOffset += Math.min(target - this.clockOffset, 2);
    this.windowMin = Math.min(this.windowMin, target);
    if (++this.windowCount >= CLOCK_WINDOW) {
      if (this.windowMin > this.clockOffset) this.clockOffset = this.windowMin;
      this.windowMin = Infinity;
      this.windowCount = 0;
    }
    this.lastPushMs = now;

    // Entities: keep one persistent view object per id.
    const src = this.srcOf;
    for (const e of snap.entities) {
      let v = this.entities.get(e.id);
      if (!v) {
        v = { ix: e.x, iy: e.y, if: e.f || 0 };
        this.entities.set(e.id, v);
      }
      if (src.get(e.id) !== e) {
        // (Decoded snapshots share unchanged entity objects, which skip this copy.)
        for (const k in v) if (!(k in e) && !KEEP_KEYS.has(k)) delete v[k];
        Object.assign(v, e);
        src.set(e.id, e);
      }
      if (e.k === 'u') this.addSample(e.id, simMs, e.x, e.y, e.f || 0);
      else {
        v.ix = e.x;
        v.iy = e.y;
        v.if = e.f || 0;
      }
    }
    if (this.entities.size !== snap.entities.length) {
      const seen = new Set();
      for (const e of snap.entities) seen.add(e.id);
      for (const id of this.entities.keys()) {
        if (!seen.has(id)) {
          this.entities.delete(id);
          this.hist.delete(id);
          src.delete(id);
        }
      }
    }

    this.snapshot = snap;
    this.tick = snap.tick;
    this.time = snap.time;
    this.players = snap.players || [];
    this.me = this.players[this.myIndex] || null;
    if (this.me) this.myTeam = this.me.team;
    this.fields = snap.fields || [];
    this.reveals = snap.reveals || [];
    this.relics = snap.relics || [];
    if (Array.isArray(snap.sites)) this.sites = snap.sites.filter((v) => Number.isFinite(v.x) && Number.isFinite(v.y));
    this.sacred = snap.sacred && Number.isFinite(snap.sacred.end) ? snap.sacred : null;
    this.gameOver = snap.gameOver || null;
    this.revealAll = this.myIndex < 0 || !!this.gameOver || !!(this.me && this.me.defeated);
    this.snapshotCount++;

    this.updateVisibility();
    this.updateLastSeen();
    this.updateMines();
    this.updateSeenTerrain();

    for (const ev of synthetic) this.fire(ev);
    for (const ev of events) this.fire(ev);
    this.emit('snapshot', snap);
  }

  /** Re-anchor the playback clock on the next snapshot (after a pause: sim time stood still). */
  resetClock() {
    this.clockOffset = null;
    this.windowMin = Infinity;
    this.windowCount = 0;
  }

  fire(ev) {
    this.emit(ev.type, ev);
    this.emit('*', ev);
  }

  /**
   * Turn a forest tile into grass. Returns true if it was still a tree.
   * In seenTerrain it falls once its tile is in sight (sync: at once, for trees
   * felled before a full snapshot, which the 3D view removes at once too).
   */
  fellTree(tx, ty, sync = false) {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return false;
    const i = ty * this.width + tx;
    if (this.map.terrain[i] !== TERRAIN.FOREST && this.map.wood[i] === 0) return false;
    const wasTree = this.map.terrain[i] === TERRAIN.FOREST;
    this.map.terrain[i] = TERRAIN.GRASS;
    this.map.wood[i] = 0;
    if (wasTree) {
      this.felledAll.push([tx, ty]);
      this.mapVersion++;
      this.unseenFells.add(i);
      if (sync) this.seeTile(i);
    }
    return wasTree;
  }

  seeTile(i) {
    this.unseenFells.delete(i);
    if (this.seenTerrain[i] !== this.map.terrain[i]) {
      this.seenTerrain[i] = this.map.terrain[i];
      this.seenVersion++;
    }
  }

  /** Trees felled out of sight fall in seenTerrain once their tiles are in sight. */
  updateSeenTerrain() {
    if (!this.unseenFells.size) return;
    for (const i of this.unseenFells) if (this.visible[i] === 1) this.seeTile(i);
  }

  updateVisibility() {
    if (this.revealAll) {
      this.visible.fill(1);
      this.explored.fill(1);
      return;
    }
    const src = this.sources;
    src.length = 0;
    for (const v of this.entities.values()) {
      if (v.o < 0 || !this.isAlly(v.o)) continue;
      const r = this.sightOf(v);
      if (r > 0) src.push({ x: v.x, y: v.y, r });
    }
    for (const rv of this.reveals) if (rv.tm === this.myTeam && rv.r > 0) src.push({ x: rv.x, y: rv.y, r: rv.r });
    computeVisibility(this.width, this.height, src, this.explored, this.visible);
  }

  updateLastSeen() {
    for (const v of this.entities.values()) {
      if (v.k !== 'b' || !this.isEnemy(v.o)) continue;
      const size = (BUILDINGS[v.t] && BUILDINGS[v.t].size) || 2;
      if (this.footprintVisible(v.tx, v.ty, size)) this.lastSeen.set(v.id, { ...v });
    }
    for (const [id, ls] of this.lastSeen) {
      const cur = this.entities.get(id);
      const size = (BUILDINGS[ls.t] && BUILDINGS[ls.t].size) || 2;
      // Forget a remembered building once we can see that it is gone (or no longer an enemy's).
      if ((!cur || !this.isEnemy(cur.o)) && this.footprintVisible(ls.tx, ls.ty, size)) this.lastSeen.delete(id);
    }
  }

  /** Remember where each gold mine is, and its gold while it is in sight. */
  updateMines() {
    for (const v of this.entities.values()) {
      if (v.k !== 'm') continue;
      let m = this.mineMemory.get(v.id);
      if (!m) {
        const tx = v.tx ?? Math.floor(v.x - GOLD_MINE.size / 2);
        const ty = v.ty ?? Math.floor(v.y - GOLD_MINE.size / 2);
        const start = (this.map.mines || []).find((mm) => mm.tx === tx && mm.ty === ty);
        m = { x: v.x, y: v.y, tx, ty, amt: start ? start.amount : v.amt };
        this.mineMemory.set(v.id, m);
      }
      if (this.revealAll || this.footprintVisible(m.tx, m.ty, GOLD_MINE.size)) m.amt = v.amt;
    }
  }

  addSample(id, t, x, y, f) {
    let h = this.hist.get(id);
    if (!h) {
      h = { t: new Float64Array(HISTORY), x: new Float64Array(HISTORY), y: new Float64Array(HISTORY), f: new Float64Array(HISTORY), n: 0, head: -1 };
      this.hist.set(id, h);
    }
    if (h.n > 0 && h.t[h.head] >= t) {
      // Same sim time again (e.g. a resync): overwrite the newest sample.
      h.x[h.head] = x;
      h.y[h.head] = y;
      h.f[h.head] = f;
      h.t[h.head] = t;
      return;
    }
    h.head = (h.head + 1) % HISTORY;
    h.t[h.head] = t;
    h.x[h.head] = x;
    h.y[h.head] = y;
    h.f[h.head] = f;
    if (h.n < HISTORY) h.n++;
  }

  /**
   * Interpolate unit positions for rendering: sets e.ix, e.iy, e.if on every
   * entity, interpDelayMs behind the newest snapshot.
   * @param {number} [now] local time in ms
   */
  update(now = nowMs()) {
    if (this.clockOffset === null) return;
    const rt = now - this.clockOffset - this.interpDelayMs;
    this.renderTime = Math.max(0, Math.min(this.time, rt / 1000));
    for (const [id, h] of this.hist) {
      const v = this.entities.get(id);
      if (!v || h.n === 0) continue;
      let i = h.head;
      // Walk back to the newest sample at or before rt.
      let steps = 0;
      while (steps < h.n - 1 && h.t[i] > rt) {
        i = (i - 1 + HISTORY) % HISTORY;
        steps++;
      }
      if (h.t[i] > rt || steps === 0) {
        // Before the oldest sample, or at/after the newest one: no interpolation.
        v.ix = h.x[i];
        v.iy = h.y[i];
        v.if = h.f[i];
        continue;
      }
      const j = (i + 1) % HISTORY;
      const span = h.t[j] - h.t[i];
      const u = span > 0 ? Math.min(1, Math.max(0, (rt - h.t[i]) / span)) : 1;
      const dx = h.x[j] - h.x[i];
      const dy = h.y[j] - h.y[i];
      if (dx * dx + dy * dy > SNAP_DIST * SNAP_DIST) {
        const k = u < 0.5 ? i : j;
        v.ix = h.x[k];
        v.iy = h.y[k];
        v.if = h.f[k];
      } else {
        v.ix = h.x[i] + dx * u;
        v.iy = h.y[i] + dy * u;
        v.if = lerpAngle(h.f[i], h.f[j], u);
      }
    }
    for (const ls of this.lastSeen.values()) {
      ls.ix = ls.x;
      ls.iy = ls.y;
      ls.if = ls.f || 0;
    }
  }
}
