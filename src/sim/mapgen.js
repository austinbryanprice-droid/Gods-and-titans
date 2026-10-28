// Procedural melee map generator (DESIGN.md 6.7).
//
// generateMap({ seed, mapSize, playerCount, teams }) is a pure function. Every client
// regenerates the map from the seed, so terrain, wood, starts, mines and camps
// must be bit-identical in every browser and in Node. Everything above the
// RENDER-ONLY marker therefore uses only the seeded RNG, integer math, + - * /
// and Math.floor/ceil/round/abs/min/max/sqrt (all exactly specified by IEEE 754).
// Heights and decor are cosmetic and are built after the marker.
//
// Layout: Warcraft III style melee map, rotationally symmetric around the map
// center (180° for 1–2 players, 90° for 3–4) so every start gets the same base
// pocket, wood line, expansions and routes. Image k of the symmetry maps the
// top-left corner to: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left.
//
// Team games (DESIGN 6.7, startPlan): when a team has two players, the map
// switches to a team layout: 180° symmetry with two canonical bases along the
// top edge, so each team shares one side of the map (teammates about 0.46 of
// the map apart, the nearest enemy about 0.67) and gets a shared expansion
// between its two bases. A team of three takes three neighbouring corners.

import { RNG, hashSeed } from './rng.js';
import { MAP_SIZES, TERRAIN, TREE_WOOD, GOLD_MINE_AMOUNT, EXPANSION_MINE_AMOUNT, SITE_CLEAR } from '../config.js';
import { BUILDINGS, GOLD_MINE } from '../data/buildings.js';
import { isLandscape } from '../data/landscapes.js';

const { GRASS, DIRT, WATER, FOREST, ROCK, SAND } = TERRAIN;

const TC_SIZE = BUILDINGS.town_center.size; // 4
const MINE_SIZE = GOLD_MINE.size; // 3

/** Empty tiles between a start town center footprint and its gold mine footprint (Chebyshev gap). */
export const START_MINE_GAP = 3;
/** Minimum distance from a creep camp to any start's town center footprint. */
export const CAMP_MIN_START_DIST = 18;
/** Radius around each start's town center center that is guaranteed open, buildable ground. */
export const START_CLEAR_RADIUS = 8.75;

const BORDER_MIN = 3; // forest border ring thickness range
const BORDER_MAX = 5;
const NO_CARVE_EDGE = 3; // passages are never carved this close to the map edge
const GUARD_DIST = 5; // guard camp distance from its mine's center
const FRONT_DIST = 6; // a start's front yard: this far from its town center toward the map center
const POCKET_FILL_MAX = 60; // unreachable open pockets up to this size become forest
const MAX_ATTEMPTS = 6;
const SQRT_HALF = Math.sqrt(0.5);

// Landscapes (src/data/landscapes.js): the same fair base layout with different ground between
// the bases. forest: share of the free interior that is woods; lakes: side lakes on or off;
// centers: the center features it may draw (null keeps the classic roll); lane: lane carve radius;
// ridges / rivers / sea: the extra terrain pass (built from symmetric noise, so every start is
// treated alike); rockLift: how high rock stands in the cosmetic heights.
const LANDSCAPE_RULES = {
  classic: { forest: [0.42, 0.5], lakes: true, centers: null, lane: 2.3, rockLift: 0.09 },
  highlands: { forest: [0.2, 0.26], lakes: true, centers: ['lake', 'camp', 'open'], lane: 2.3, ridges: true, rockLift: 0.17, hills: 1.35 },
  rivers: { forest: [0.34, 0.4], lakes: false, centers: ['open', 'camp'], lane: 2.3, rivers: true, rockLift: 0.09 },
  islands: { forest: [0.34, 0.4], lakes: false, centers: ['camp'], lane: 2.3, sea: true, rockLift: 0.09 },
  forest: { forest: [0.6, 0.66], lakes: true, centers: null, lane: 1.9, rockLift: 0.09 },
};

// Player index → symmetry image of the canonical (top-left) start.
// 2 players: top-left, bottom-right. 3: top-left, bottom-right, top-right.
// 4: top-left, bottom-left, top-right, bottom-right (players 0,1 west, 2,3 east).
const START_IMAGES = { 1: [0], 2: [0, 2], 3: [0, 2, 1], 4: [0, 3, 1, 2] };

/**
 * Where each player starts, from the team of each player (DESIGN 6.7).
 * Returns { mode, slots }: slots[player] is a symmetry image k in 'corners'
 * mode, or a team-layout position in 'teams' mode (0 top-left, 1 top-right,
 * 2 bottom-right, 3 bottom-left; 0/1 and 2/3 share a side of the map).
 * - 1–2 players, or every team a single player: the classic corners.
 * - a team of two (2v2, 2v1, 2v1v1): team layout, that team on the top side,
 *   the other players on the bottom side.
 * - a team of three (3v1): three neighbouring corners, the last one opposite.
 * Groups are ordered by size, then by their lowest player index, so the
 * result depends only on the teams (deterministic in every browser).
 */
export function startPlan(playerCount, teams = null) {
  const pc = Math.min(4, Math.max(1, Math.floor(Number(playerCount)) || 2));
  const classic = { mode: 'corners', slots: START_IMAGES[pc].slice() };
  if (pc <= 2 || !Array.isArray(teams)) return classic;
  const groups = new Map();
  for (let i = 0; i < pc; i++) {
    const t = teams[i] ?? i + 1;
    const key = typeof t === 'number' || typeof t === 'string' ? String(t) : `#${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const list = [...groups.values()].sort((a, b) => b.length - a.length || a[0] - b[0]);
  const big = list[0].length;
  if (big <= 1 || big >= pc) return classic;
  const order = list.flat();
  const slots = new Array(pc);
  if (big === 2) {
    order.forEach((p, j) => { slots[p] = j; });
    return { mode: 'teams', slots };
  }
  // A team of three: corners around the map in order (top-left, top-right, bottom-right, bottom-left).
  order.forEach((p, j) => { slots[p] = j; });
  return { mode: 'corners', slots };
}

// Neighbour offsets: the first 4 are orthogonal (step cost 10), the last 4 diagonal (14).
const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NY = [0, 0, 1, -1, 1, -1, 1, -1];
const NSTEP = [10, 10, 10, 10, 14, 14, 14, 14];

const isOpen = (t) => t === GRASS || t === DIRT || t === SAND;

function smoothstep(a, b, v) {
  if (v <= a) return 0;
  if (v >= b) return 1;
  const t = (v - a) / (b - a);
  return t * t * (3 - 2 * t);
}

function unit(dx, dy) {
  const len = Math.sqrt(dx * dx + dy * dy);
  return len > 0 ? [dx / len, dy / len] : [0, 0];
}

/** Round to the nearest multiple of 0.5 so symmetry images stay exact. */
const half2 = (v) => Math.round(v * 2) / 2;
/** Center of the tile containing (x, y). */
const tileCenter = (v) => Math.floor(v) + 0.5;

function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Distance from point (px, py) to the square footprint [x, x+s) × [y, y+s). */
function rectDist(px, py, x, y, s) {
  const dx = Math.max(x - px, 0, px - (x + s));
  const dy = Math.max(y - py, 0, py - (y + s));
  return Math.sqrt(dx * dx + dy * dy);
}

/** Chebyshev gap in empty tiles between footprints [ax, ax+as) and [bx, bx+bs). */
export function footprintGap(ax, ay, as, bx, by, bs) {
  const gx = Math.max(0, bx - (ax + as), ax - (bx + bs));
  const gy = Math.max(0, by - (ay + as), ay - (by + bs));
  return Math.max(gx, gy);
}

// ---------------------------------------------------------------------------
// Symmetry group (rotations about the map center)

class Symmetry {
  constructor(n, order) {
    this.n = n;
    this.order = order;
    this.ks = order === 4 ? [0, 1, 2, 3] : [0, 2];
  }

  /** Tile index of image k of tile (x, y). */
  tile(k, x, y) {
    const n = this.n;
    if (k === 0) return y * n + x;
    if (k === 1) return x * n + (n - 1 - y);
    if (k === 2) return (n - 1 - y) * n + (n - 1 - x);
    return (n - 1 - x) * n + y;
  }

  /** Image k of a point in world (tile) coordinates. */
  point(k, x, y) {
    const n = this.n;
    if (k === 0) return [x, y];
    if (k === 1) return [n - y, x];
    if (k === 2) return [n - x, n - y];
    return [y, n - x];
  }

  /** Top-left tile of image k of the s×s footprint with top-left (x, y). */
  rect(k, x, y, s) {
    const n = this.n;
    if (k === 0) return [x, y];
    if (k === 1) return [n - s - y, x];
    if (k === 2) return [n - s - x, n - s - y];
    return [y, n - s - x];
  }

  /** Image k of a direction vector. */
  dir(k, dx, dy) {
    if (k === 0) return [dx, dy];
    if (k === 1) return [-dy, dx];
    if (k === 2) return [-dx, -dy];
    return [dy, -dx];
  }

  inDomain(x, y) {
    const h = this.n / 2;
    return this.order === 4 ? x < h && y < h : y < h;
  }

  /** Set arr at tile (x, y) and all of its images. */
  stamp(arr, x, y, v) {
    for (const k of this.ks) arr[this.tile(k, x, y)] = v;
  }

  /** Average a raw field over each orbit (one value per orbit) and normalize to [0, 1]. */
  field(raw) {
    const out = new Float64Array(raw.length);
    const n = this.n;
    const h = n / 2;
    const four = this.order === 4;
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < (four ? h : n); x++) {
        const i0 = y * n + x;
        const i2 = (n - 1 - y) * n + (n - 1 - x);
        let v;
        if (four) {
          const i1 = x * n + (n - 1 - y);
          const i3 = (n - 1 - x) * n + y;
          v = (raw[i0] + raw[i1] + raw[i2] + raw[i3]) / 4;
          out[i1] = v;
          out[i3] = v;
        } else {
          v = (raw[i0] + raw[i2]) / 2;
        }
        out[i0] = v;
        out[i2] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const span = hi - lo || 1;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / span;
    return out;
  }
}

// ---------------------------------------------------------------------------
// Value noise (polynomial smoothstep interpolation only)

/** Add one octave of value noise sampled at (x + offset, y + offset) / cell over an n×n grid. */
function addValueNoise(rng, n, cell, amp, out, offset = 0.5) {
  const g = Math.floor(n / cell) + 3;
  const lat = new Float64Array(g * g);
  for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
  // Per-axis lattice cell and smoothstep weight (identical for rows and columns).
  const I = new Int32Array(n);
  const W = new Float64Array(n);
  for (let x = 0; x < n; x++) {
    const f = (x + offset) / cell;
    const ix = Math.floor(f);
    const t = f - ix;
    I[x] = ix;
    W[x] = t * t * (3 - 2 * t);
  }
  for (let y = 0; y < n; y++) {
    const ty = W[y];
    const r0 = I[y] * g;
    const r1 = r0 + g;
    const row = y * n;
    for (let x = 0; x < n; x++) {
      const ix = I[x];
      const tx = W[x];
      const a = lat[r0 + ix];
      const b = lat[r0 + ix + 1];
      const c = lat[r1 + ix];
      const d = lat[r1 + ix + 1];
      const top = a + (b - a) * tx;
      const bot = c + (d - c) * tx;
      out[row + x] += amp * (top + (bot - top) * ty);
    }
  }
}

function fbm(rng, n, octaves) {
  const out = new Float64Array(n * n);
  for (const [cell, amp] of octaves) addValueNoise(rng, n, cell, amp, out);
  return out;
}

function quantile(values, q) {
  const arr = Float64Array.from(values).sort();
  return arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * arr.length)))];
}

// ---------------------------------------------------------------------------
// Pathfinding helpers

class MinHeap {
  constructor() {
    this.keys = [];
    this.vals = [];
  }

  get size() {
    return this.keys.length;
  }

  push(key, val) {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] < key || (keys[p] === key && vals[p] <= val)) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  pop() {
    const { keys, vals } = this;
    const top = vals[0];
    const lastK = keys.pop();
    const lastV = vals.pop();
    const len = keys.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= len) break;
        const r = l + 1;
        let c = l;
        if (r < len && (keys[r] < keys[l] || (keys[r] === keys[l] && vals[r] < vals[l]))) c = r;
        if (keys[c] > lastK || (keys[c] === lastK && vals[c] >= lastV)) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = lastK;
      vals[i] = lastV;
    }
    return top;
  }
}

/**
 * A* over an integer cost grid (8-neighborhood). cost[i] < 0 = blocked; minCost is the
 * cheapest tile cost (keeps the octile heuristic admissible).
 * Returns the tile indices from start to goal, or null.
 */
function findPath(n, cost, start, goal, minCost = 1) {
  if (cost[start] < 0 || cost[goal] < 0) return null;
  const N = n * n;
  const g = new Int32Array(N).fill(0x7fffffff);
  const prev = new Int32Array(N).fill(-1);
  const gx = goal % n;
  const gy = (goal - gx) / n;
  const h = (i) => {
    const x = i % n;
    const dx = Math.abs(x - gx);
    const dy = Math.abs((i - x) / n - gy);
    return minCost * (10 * Math.max(dx, dy) + 4 * Math.min(dx, dy));
  };
  const open = new MinHeap();
  g[start] = 0;
  open.push(h(start), start);
  while (open.size) {
    const i = open.pop();
    if (i === goal) break;
    const x = i % n;
    const y = (i - x) / n;
    const gi = g[i];
    for (let d = 0; d < 8; d++) {
      const nx = x + NX[d];
      const ny = y + NY[d];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      const c = cost[j];
      if (c < 0) continue;
      // no corner cutting between two blocked tiles
      if (d >= 4 && cost[y * n + nx] < 0 && cost[ny * n + x] < 0) continue;
      const ng = gi + c * NSTEP[d];
      if (ng < g[j]) {
        g[j] = ng;
        prev[j] = i;
        open.push(ng + h(j), j);
      }
    }
  }
  if (prev[goal] < 0 && goal !== start) return null;
  const path = [];
  for (let i = goal; i >= 0; i = prev[i]) {
    path.push(i);
    if (i === start) break;
  }
  return path.reverse();
}

/** Label 4-connected components of walkable tiles. Returns { label: Int32Array (-1 blocked), sizes }. */
function labelComponents(n, walk) {
  const N = n * n;
  const label = new Int32Array(N).fill(-1);
  const sizes = [];
  const stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!walk[s] || label[s] >= 0) continue;
    const id = sizes.length;
    let top = 0;
    let count = 0;
    stack[top++] = s;
    label[s] = id;
    while (top) {
      const i = stack[--top];
      count++;
      const x = i % n;
      if (x > 0 && walk[i - 1] && label[i - 1] < 0) { label[i - 1] = id; stack[top++] = i - 1; }
      if (x < n - 1 && walk[i + 1] && label[i + 1] < 0) { label[i + 1] = id; stack[top++] = i + 1; }
      if (i >= n && walk[i - n] && label[i - n] < 0) { label[i - n] = id; stack[top++] = i - n; }
      if (i < N - n && walk[i + n] && label[i + n] < 0) { label[i + n] = id; stack[top++] = i + n; }
    }
    sizes.push(count);
  }
  return { label, sizes };
}

/** Walkable mask: open terrain minus the given footprint mask. */
function walkMask(terrain, foot) {
  const walk = new Uint8Array(terrain.length);
  for (let i = 0; i < terrain.length; i++) walk[i] = isOpen(terrain[i]) && !foot[i] ? 1 : 0;
  return walk;
}

/** Big-unit mask: tiles whose whole 3×3 block is walkable (titans need 3-wide routes). */
function bigMask(n, walk) {
  const big = new Uint8Array(n * n);
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      big[i] = walk[i - n - 1] & walk[i - n] & walk[i - n + 1] & walk[i - 1] & walk[i] & walk[i + 1] &
        walk[i + n - 1] & walk[i + n] & walk[i + n + 1];
    }
  }
  return big;
}

/** Tile index of the point `dist` tiles from a town center toward the map center (its front yard). */
function frontTile(n, cx, cy, dist) {
  const dx = n / 2 - cx;
  const dy = n / 2 - cy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  return Math.floor(cy + (dist * dy) / len) * n + Math.floor(cx + (dist * dx) / len);
}

/** Tiles in the one-tile ring around an s×s footprint (in bounds only). */
function ringTiles(n, x, y, s) {
  const out = [];
  for (let ty = y - 1; ty <= y + s; ty++) {
    for (let tx = x - 1; tx <= x + s; tx++) {
      if (tx >= x && tx < x + s && ty >= y && ty < y + s) continue;
      if (tx >= 0 && ty >= 0 && tx < n && ty < n) out.push(ty * n + tx);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layout planning

function planLayout(rng, sym, pc, plan, LS = LANDSCAPE_RULES.classic) {
  const { n, order, ks } = sym;
  const half = n / 2;
  const sc = n / 96;
  const teamMode = plan.mode === 'teams';
  const edge = n >= 112 ? 8 : 7; // mine distance from the map edge for edge expansions

  // Canonical start (top-left). Town center center (cx, cy), footprint top-left (tx, ty).
  // The team layout moves it along the top edge toward the middle, and adds its mirror.
  const B = Math.round(n * 0.165);
  const cx = (teamMode ? Math.round(n * 0.27) : B) + rng.int(-1, 1);
  const cy = B + rng.int(-1, 1);
  const tx = cx - TC_SIZE / 2;
  const ty = cy - TC_SIZE / 2;
  // Start mine: exactly START_MINE_GAP tiles from the footprint, on the side away from the center.
  const side = rng.int(3, 5);
  const west = rng.chance(0.5);
  const smx = west ? tx - START_MINE_GAP - MINE_SIZE : tx - side;
  const smy = west ? ty - side : ty - START_MINE_GAP - MINE_SIZE;
  const canonBases = [{ tx, ty, mx: smx, my: smy }];
  if (teamMode) canonBases.push({ tx: n - TC_SIZE - tx, ty, mx: n - MINE_SIZE - smx, my: smy });
  // Player at a base: corners mode keys by image k, team mode by position (ci + 2 on the far side).
  const playerAt = (ci, k) => plan.slots.indexOf(teamMode ? ci + (k === 0 ? 0 : 2) : k);

  const bases = [];
  canonBases.forEach((c, ci) => {
    for (const k of ks) {
      const [btx, bty] = sym.rect(k, c.tx, c.ty, TC_SIZE);
      const [bmx, bmy] = sym.rect(k, c.mx, c.my, MINE_SIZE);
      const bcx = btx + TC_SIZE / 2;
      const bcy = bty + TC_SIZE / 2;
      const [ux, uy] = unit(half - bcx, half - bcy);
      bases.push({ ci, k, tx: btx, ty: bty, cx: bcx, cy: bcy, ux, uy, mx: bmx, my: bmy, player: playerAt(ci, k) });
    }
  });

  // Canonical expansions: mine top-left and the "front" direction the open clearing faces.
  const canon = [];
  const frontFrom = (mx, my, wHome, hx = cx, hy = cy) => {
    const mcx = mx + MINE_SIZE / 2;
    const mcy = my + MINE_SIZE / 2;
    const [ax, ay] = unit(half - mcx, half - mcy);
    const [bx, by] = unit(hx - mcx, hy - mcy);
    return unit(ax + wHome * bx, ay + wHome * by);
  };
  if (teamMode) {
    // Each base gets a natural on its outer flank, partway down the side edge.
    const along = Math.round(n * 0.4) + rng.int(-2, 1);
    canon.push({ mx: edge, my: along - 1, f: frontFrom(edge, along - 1, 0.5), level: 2 });
    const rmx = n - edge - MINE_SIZE;
    canon.push({ mx: rmx, my: along - 1, f: frontFrom(rmx, along - 1, 0.5, n - cx, cy), level: 2 });
    // The team's shared expansion, between its two bases on the top edge.
    canon.push({ mx: half - 2, my: edge, f: [0, 1], level: 2 });
  } else if (order === 2) {
    // Natural: on the start's flank, partway along the map edge.
    const along = Math.round(n * 0.43) + rng.int(-2, 2);
    const natWest = rng.chance(0.5);
    const nmx = natWest ? edge : along - 1;
    const nmy = natWest ? along - 1 : edge;
    canon.push({ mx: nmx, my: nmy, f: frontFrom(nmx, nmy, 0.5), level: 2 });
    // Contested corner expansion (top-right; its image is bottom-left).
    const cmx = n - edge - MINE_SIZE - 2;
    const cmy = edge + 2;
    canon.push({ mx: cmx, my: cmy, f: [-SQRT_HALF, SQRT_HALF], level: 3 });
  } else {
    // Edge expansion between two neighbouring corners (top edge; images on every edge).
    // Medium 4-player maps also get an inner natural per start (3 players already have the spare corner).
    const inner = n >= 112 && pc === 4;
    const emx = half - 1 + rng.int(-2, 1);
    canon.push({ mx: emx, my: edge, f: [0, 1], level: inner ? 3 : 2 });
    if (inner) {
      // Inner natural expansion, off the diagonal toward one flank.
      const steep = rng.chance(0.5);
      const [dx, dy] = unit(steep ? 1 : 2.2, steep ? 2.2 : 1);
      const D = n * 0.27;
      const imx = Math.round(cx + dx * D - MINE_SIZE / 2);
      const imy = Math.round(cy + dy * D - MINE_SIZE / 2);
      canon.push({ mx: imx, my: imy, f: frontFrom(imx, imy, 2), level: 2 });
    }
  }

  // Expand expansions into symmetry images.
  const expansions = [];
  canon.forEach((c, ci) => {
    const mcx = c.mx + MINE_SIZE / 2;
    const mcy = c.my + MINE_SIZE / 2;
    const ex = half2(mcx + 6.5 * c.f[0]);
    const ey = half2(mcy + 6.5 * c.f[1]);
    const campX = tileCenter(mcx + GUARD_DIST * c.f[0]);
    const campY = tileCenter(mcy + GUARD_DIST * c.f[1]);
    for (const k of ks) {
      const [mx, my] = sym.rect(k, c.mx, c.my, MINE_SIZE);
      const [fx, fy] = sym.dir(k, c.f[0], c.f[1]);
      const [iex, iey] = sym.point(k, ex, ey);
      const [icx, icy] = sym.point(k, campX, campY);
      expansions.push({ ci, k, mx, my, mcx: mx + 1.5, mcy: my + 1.5, fx, fy, ex: iex, ey: iey, level: c.level, camp: { x: icx, y: icy } });
    }
  });

  // Unused start positions become rich expansions guarded by strong creeps.
  const spare = [];
  for (const b of bases) {
    if (b.player >= 0) continue;
    const mcx = b.mx + 1.5;
    const mcy = b.my + 1.5;
    const [fx, fy] = unit(b.cx - mcx, b.cy - mcy);
    spare.push({ k: b.k, mx: b.mx, my: b.my, mcx, mcy, level: 3, camp: { x: tileCenter(mcx + GUARD_DIST * fx), y: tileCenter(mcy + GUARD_DIST * fy) } });
  }

  // Center feature.
  const roll = rng.next();
  // (No river in the team layout: its lakes would sit in the top-right base.)
  let kind = order === 2 && !teamMode ? (roll < 0.34 ? 'river' : roll < 0.67 ? 'lake' : 'camp') : (roll < 0.5 ? 'lake' : 'camp');
  // A landscape may draw from its own center features ('open': plain ground with a site or a lane crossing).
  if (LS.centers) kind = LS.centers[Math.floor(roll * LS.centers.length)];
  const center = { kind, x: half, y: half, r: 0, level: n >= 112 ? 3 : 2 };
  const lakes = []; // all images: { x, y, r }
  let river = null;
  if (kind === 'lake') center.r = rng.range(0.055, 0.07) * n;
  if (kind === 'river') {
    const t = rng.range(0.285, 0.31);
    const ax = half2(n * (1 - t));
    const ay = half2(n * t);
    const ar = rng.range(3.8, 4.8) + (sc - 1) * 2;
    for (const k of ks) {
      const [lx, ly] = sym.point(k, ax, ay);
      lakes.push({ x: lx, y: ly, r: ar });
    }
    const amp = (rng.chance(0.5) ? 1 : -1) * rng.range(2, 4.5) * sc;
    const [nx, ny] = unit(half - ay, ax - half); // perpendicular to the lake→center axis
    const len = dist(ax, ay, half, half);
    const steps = Math.ceil(len / 0.4);
    const samples = [];
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const m = amp * 4 * s * (1 - s);
      samples.push([ax + (half - ax) * s + nx * m, ay + (half - ay) * s + ny * m]);
    }
    const fords = [{ x: half, y: half, r: 3.6 + sc }];
    if (rng.chance(0.6)) {
      const s = rng.range(0.4, 0.55);
      const m = amp * 4 * s * (1 - s);
      fords.push({ x: ax + (half - ax) * s + nx * m, y: ay + (half - ay) * s + ny * m, r: 2.7 });
    }
    river = { samples, w: rng.range(1.35, 1.75), fords };
  }

  // Zones that lakes and rocks keep away from (all images).
  const zones = [];
  for (const b of bases) zones.push({ x: b.cx, y: b.cy, r: 17 });
  for (const e of expansions) {
    zones.push({ x: e.mcx, y: e.mcy, r: 5 }, { x: e.ex, y: e.ey, r: 8.5 }, { x: e.camp.x, y: e.camp.y, r: 4 });
  }
  if (kind === 'camp') zones.push({ x: half, y: half, r: 8 });
  if (kind === 'lake') zones.push({ x: half, y: half, r: center.r + 5 });
  if (river) {
    for (const l of lakes) zones.push({ x: l.x, y: l.y, r: l.r + 3 });
    for (let i = 0; i < river.samples.length; i += 4) {
      for (const k of ks) {
        const [x, y] = sym.point(k, river.samples[i][0], river.samples[i][1]);
        zones.push({ x, y, r: river.w + 2.5 });
      }
    }
  }

  // Side lakes (canonical, rejection-sampled, then imaged).
  let lakeCount;
  if (order === 2) lakeCount = kind === 'camp' ? rng.int(1, 2) : rng.int(0, 1);
  else lakeCount = kind === 'camp' ? 1 : (rng.chance(0.5) ? 1 : 0);
  if (!LS.lakes) lakeCount = 0;
  for (let placed = 0, tries = 0; placed < lakeCount && tries < 80; tries++) {
    const r = rng.range(3.4, 4.8) + (sc - 1) * 2;
    const lx = half2(rng.range(r + 7, order === 4 ? half - 2 : n - r - 7));
    const ly = half2(rng.range(r + 7, half - 2));
    if (zones.some((z) => dist(lx, ly, z.x, z.y) < z.r + r + 3)) continue;
    let ok = true;
    for (const k of ks) {
      const [ix, iy] = sym.point(k, lx, ly);
      if (lakes.some((l) => dist(ix, iy, l.x, l.y) < l.r + r + 6)) ok = false;
    }
    if (!ok) continue;
    for (const k of ks) {
      const [ix, iy] = sym.point(k, lx, ly);
      lakes.push({ x: ix, y: iy, r });
    }
    placed++;
  }
  for (const l of lakes) zones.push({ x: l.x, y: l.y, r: l.r + 1 });

  return { bases, expansions, spare, center, lakes, river, zones };
}

// ---------------------------------------------------------------------------
// Map construction

function resolveSize(mapSize) {
  if (typeof mapSize === 'number' && Number.isFinite(mapSize)) {
    return Math.max(64, Math.min(256, Math.floor(mapSize / 2) * 2));
  }
  return MAP_SIZES[mapSize] || MAP_SIZES.small;
}

function buildMap(seed, n, pc, attempt, plan, landscape = 'classic') {
  const teamMode = plan.mode === 'teams';
  const order = pc <= 2 || teamMode ? 2 : 4;
  const sym = new Symmetry(n, order);
  const { ks } = sym;
  const LS = LANDSCAPE_RULES[landscape];
  const tag = landscape === 'classic' ? '' : `|${landscape}`; // the classic map keeps its original seeds
  const rng = new RNG(hashSeed(`mythicwar-map|${seed}|${n}|${pc}|${attempt}${teamMode ? '|teams' : ''}${tag}`));
  const N = n * n;
  const half = n / 2;
  const sc = n / 96;
  const dEdge = (x, y) => Math.min(x, y, n - 1 - x, n - 1 - y);
  // Visit tiles whose centers lie within r of (cx, cy): cb(index, distance, dx, dy).
  const disc = (cx, cy, r, cb) => {
    const x0 = Math.max(0, Math.floor(cx - r) - 1);
    const x1 = Math.min(n - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r) - 1);
    const y1 = Math.min(n - 1, Math.ceil(cy + r));
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < r2) cb(y * n + x, Math.sqrt(d2), dx, dy);
      }
    }
  };

  // ---- Noise fields (orbit-averaged, so they share the map's symmetry) ----
  const fDetail = sym.field(fbm(rng.fork('detail'), n, [[3.2, 0.65], [1.6, 0.35]]));
  const fForest = sym.field(fbm(rng.fork('forest'), n, [[11 * sc, 0.6], [5.5 * sc, 0.28]]));
  for (let i = 0; i < N; i++) fForest[i] = 0.88 * fForest[i] + 0.12 * fDetail[i]; // ragged edges
  const fDirt = sym.field(fbm(rng.fork('dirt'), n, [[7 * sc, 0.6], [3, 0.4]]));
  // Second small-scale field: fDetail transposed (transposition preserves the rotational symmetry).
  const fShape = new Float64Array(N);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) fShape[y * n + x] = fDetail[x * n + y];

  const L = planLayout(rng.fork('layout'), sym, pc, plan, LS);
  const lrng = rng.fork('local');

  // ---- Footprints (all images) ----
  const mineFoot = new Uint8Array(N);
  const tcFoot = new Uint8Array(N);
  const allMines = [...L.bases.map((b) => [b.mx, b.my]), ...L.expansions.map((e) => [e.mx, e.my])];
  for (const [mx, my] of allMines) {
    for (let y = my; y < my + MINE_SIZE; y++) for (let x = mx; x < mx + MINE_SIZE; x++) mineFoot[y * n + x] = 1;
  }
  for (const b of L.bases) {
    for (let y = b.ty; y < b.ty + TC_SIZE; y++) for (let x = b.tx; x < b.tx + TC_SIZE; x++) tcFoot[y * n + x] = 1;
  }
  const foot = new Uint8Array(N);
  for (let i = 0; i < N; i++) foot[i] = mineFoot[i] | tcFoot[i];

  // Camp positions that shape terrain: every image of every camp (keeps terrain symmetric).
  const terrainCamps = [];
  const pushCampImages = (x, y) => {
    for (const k of ks) {
      const [ix, iy] = sym.point(k, x, y);
      terrainCamps.push({ x: ix, y: iy });
    }
  };
  for (const e of L.expansions) if (e.k === 0) pushCampImages(e.camp.x, e.camp.y);
  for (const s of L.spare) {
    // spare camps are given in image space; map back to canonical first
    const inv = (4 - s.k) % 4;
    const [x, y] = sym.point(inv, s.camp.x, s.camp.y);
    pushCampImages(x, y);
  }
  if (L.center.kind === 'camp') terrainCamps.push({ x: half, y: half });

  // ---- Water: lakes and river ----
  const water = new Uint8Array(N);
  const ford = new Uint8Array(N);
  const lakeShapes = L.center.kind === 'lake' ? [...L.lakes, { x: half, y: half, r: L.center.r }] : L.lakes;
  for (const l of lakeShapes) {
    disc(l.x, l.y, l.r * 1.3 + 1, (i, d) => {
      if (d / l.r + 0.55 * (fShape[i] - 0.5) < 1) water[i] = 1;
    });
  }
  if (L.river) {
    const { samples, w, fords } = L.river;
    const rr = Math.ceil(w + 1);
    for (const [sx, sy] of samples) {
      const bx = Math.floor(sx);
      const by = Math.floor(sy);
      for (let y = by - rr; y <= by + rr; y++) {
        for (let x = bx - rr; x <= bx + rr; x++) {
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          if (dist(x + 0.5, y + 0.5, sx, sy) < w + 0.35 * (fShape[y * n + x] - 0.5)) sym.stamp(water, x, y, 1);
        }
      }
    }
    for (const f of fords) {
      const rr2 = Math.ceil(f.r + 1);
      const bx = Math.floor(f.x);
      const by = Math.floor(f.y);
      for (let y = by - rr2; y <= by + rr2; y++) {
        for (let x = bx - rr2; x <= bx + rr2; x++) {
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          if (dist(x + 0.5, y + 0.5, f.x, f.y) < f.r) sym.stamp(ford, x, y, 1);
        }
      }
    }
  }

  // ---- Rock outcrops (canonical random walks, stamped) ----
  const rock = new Uint8Array(N);
  const rockCount = order === 2 ? lrng.int(3, 5) : lrng.int(2, 3);
  for (let placed = 0, tries = 0; placed < rockCount && tries < 120; tries++) {
    const x0 = lrng.int(7, (order === 4 ? half : n) - 8);
    const y0 = lrng.int(7, half - 2);
    if (!sym.inDomain(x0, y0)) continue;
    const px = x0 + 0.5;
    const py = y0 + 0.5;
    if (L.zones.some((z) => dist(px, py, z.x, z.y) < z.r + 4)) continue;
    let ok = true;
    for (const k of ks) {
      if (k === 0) continue;
      const [ix, iy] = sym.point(k, px, py);
      if (dist(px, py, ix, iy) < 10) ok = false;
    }
    if (!ok) continue;
    const size = lrng.int(4, 10);
    let x = x0;
    let y = y0;
    for (let s = 0; s < size; s++) {
      if (dEdge(x, y) >= 6) sym.stamp(rock, x, y, 1);
      const d = lrng.int(0, 3);
      x += NX[d];
      y += NY[d];
    }
    placed++;
  }

  // ---- Landscape: ridges, rivers or the sea (every image alike, so starts stay fair) ----
  if (LS.ridges || LS.rivers || LS.sea) landscapePass(n, sym, rng.fork(`landscape|${landscape}`), L, LS, terrainCamps, rock, water, dEdge);

  // ---- Base pockets, expansion clearings, camp and center clearings ----
  const back = new Uint8Array(N); // forced forest behind bases and expansion mines
  const clear = new Uint8Array(N); // forced open ground
  const rBack = 9.6;
  const rFront = 12 + 2 * sc;
  // Every zone only ORs flags, so the result does not depend on processing order (keeps symmetry exact).
  for (const b of L.bases) {
    disc(b.cx, b.cy, rBack + 12, (i, d, dx, dy) => {
      const c = d > 0 ? (dx * b.ux + dy * b.uy) / d : 1;
      const r = rBack + (rFront - rBack) * smoothstep(-0.25, 0.7, c) + 1.6 * (fDetail[i] - 0.5);
      if (d < Math.max(r, START_CLEAR_RADIUS)) clear[i] = 1;
      else if (c < -0.15 || (c < 0.1 && d < rBack + 5)) back[i] = 1; // wood line behind the base
    });
  }
  for (const e of L.expansions) {
    disc(e.ex, e.ey, 7.75, (i, d) => {
      if (d < 7 + 1.5 * (fDetail[i] - 0.5)) clear[i] = 1;
    });
    disc(e.mcx, e.mcy, 8.25, (i, d, dx, dy) => {
      if (d < 7.5 + 1.5 * (fDetail[i] - 0.5) && dx * e.fx + dy * e.fy < -1.2) back[i] = 1;
    });
  }
  for (const c of terrainCamps) disc(c.x, c.y, 3.3, (i) => { clear[i] = 1; });
  if (L.center.kind === 'camp') {
    disc(half, half, 7, (i, d) => {
      if (d < 6 + 2 * (fDetail[i] - 0.5)) clear[i] = 1;
    });
  }
  if (L.center.kind === 'lake') {
    disc(half, half, L.center.r + 5.25, (i, d) => {
      if (!water[i] && d < L.center.r + 4.5 + 1.5 * (fDetail[i] - 0.5)) clear[i] = 1;
    });
  }
  // Open glades around side lakes so their shores are reachable.
  for (const l of L.lakes) {
    disc(l.x, l.y, l.r * 1.3 + 3.5, (i, d) => {
      if (!water[i] && d < l.r * 1.15 + 2.5 + 1.5 * (fDetail[i] - 0.5)) clear[i] = 1;
    });
  }

  // ---- Compose base terrain ----
  const T = new Uint8Array(N);
  // Forest density is measured over the free interior (outside bases, clearings and lakes).
  const free = [];
  for (let y = BORDER_MAX + 2; y < n - BORDER_MAX - 2; y++) {
    for (let x = BORDER_MAX + 2; x < n - BORDER_MAX - 2; x++) {
      const i = y * n + x;
      if (!clear[i] && !back[i] && !water[i]) free.push(fForest[i]);
    }
  }
  const thrForest = quantile(free, 1 - lrng.range(LS.forest[0], LS.forest[1]));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const de = dEdge(x, y);
      const thick = BORDER_MIN + Math.min(BORDER_MAX - BORDER_MIN, Math.floor(fDetail[i] * (BORDER_MAX - BORDER_MIN + 1)));
      let t = GRASS;
      if (de < thick || fForest[i] > thrForest - (de < BORDER_MAX + 2 ? 0.05 : 0)) t = FOREST;
      if (water[i]) t = WATER;
      if (rock[i] && t !== WATER) t = ROCK;
      if (back[i]) t = FOREST;
      if (clear[i]) t = GRASS;
      if (ford[i]) t = water[i] ? SAND : GRASS;
      if (de < BORDER_MIN) t = FOREST;
      T[i] = t;
    }
  }
  const locked = new Uint8Array(N);
  for (let i = 0; i < N; i++) locked[i] = back[i] && !clear[i] ? 1 : 0;
  // Mines sit on dirt with an open ring around them.
  for (const [mx, my] of allMines) {
    for (let y = my - 1; y <= my + MINE_SIZE; y++) {
      for (let x = mx - 1; x <= mx + MINE_SIZE; x++) {
        const i = y * n + x;
        T[i] = DIRT;
        locked[i] = 0;
      }
    }
  }

  // ---- Lanes: least-cost routes between bases, expansions and the center ----
  const road = new Uint8Array(N);
  const nodes = [];
  for (const b of L.bases) {
    const f = frontTile(n, b.cx, b.cy, FRONT_DIST);
    nodes.push({ type: 'b', idx: b.ci, k: b.k, x: f % n, y: Math.floor(f / n) });
  }
  for (const e of L.expansions) nodes.push({ type: 'e', idx: e.ci, k: e.k, x: Math.floor(e.ex), y: Math.floor(e.ey) });
  const centerNode = { type: 'c', idx: 0, k: 0, x: half, y: half };
  if (L.center.kind !== 'lake') nodes.push(centerNode);
  const nodeKey = (nd, j) => (nd.type === 'c' ? 'c' : `${nd.type}${nd.idx}:${(nd.k + j) % 4}`);
  const laneDone = new Set();
  const lanePairs = [];
  const addLane = (a, b) => {
    if (!a || !b || a === b) return;
    const key = `${nodeKey(a, 0)}|${nodeKey(b, 0)}`;
    if (laneDone.has(key)) return;
    for (const j of ks) {
      laneDone.add(`${nodeKey(a, j)}|${nodeKey(b, j)}`);
      laneDone.add(`${nodeKey(b, j)}|${nodeKey(a, j)}`);
    }
    lanePairs.push([a, b]);
  };
  for (const a of nodes) {
    if (a.k !== 0 || a.type === 'c') continue;
    const others = nodes.filter((b) => b !== a).sort((p, q) => dist(a.x, a.y, p.x, p.y) - dist(a.x, a.y, q.x, q.y) || nodes.indexOf(p) - nodes.indexOf(q));
    addLane(a, others[0]);
    addLane(a, others[1]);
    if (a.type === 'b') addLane(a, L.center.kind === 'lake' ? nodes.find((b) => b.type === 'b' && b.idx === a.idx && b.k === 2) : centerNode);
  }
  // Lanes keep two tiles away from uncarvable tiles where they can, so they stay wide.
  const hug = new Uint8Array(N);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!locked[y * n + x] && !foot[y * n + x]) continue;
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const tx = x + ox;
          const ty = y + oy;
          if (tx >= 0 && ty >= 0 && tx < n && ty < n) hug[ty * n + tx] = 1;
        }
      }
    }
  }
  const costGrid = new Int32Array(N);
  const tileCost = (i) => {
    const t = T[i];
    return (t === FOREST ? 6 : t === ROCK ? 9 : t === WATER ? 40 : 1) * 4 + Math.floor(fDetail[i] * 3) + (hug[i] ? 12 : 0);
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      costGrid[i] = foot[i] || locked[i] || dEdge(x, y) < NO_CARVE_EDGE ? -1 : tileCost(i);
    }
  }
  const carve = (x, y, r) => {
    const r2 = r * r;
    const ri = Math.ceil(r);
    for (let oy = -ri; oy <= ri; oy++) {
      for (let ox = -ri; ox <= ri; ox++) {
        if (ox * ox + oy * oy > r2) continue;
        const tx = x + ox;
        const ty = y + oy;
        if (tx < 0 || ty < 0 || tx >= n || ty >= n || dEdge(tx, ty) < NO_CARVE_EDGE) continue;
        for (const k of ks) {
          const j = sym.tile(k, tx, ty);
          if (foot[j] || locked[j]) continue;
          if (T[j] === FOREST || T[j] === ROCK) T[j] = GRASS;
          else if (T[j] === WATER) T[j] = SAND;
          else continue;
          costGrid[j] = tileCost(j);
        }
      }
    }
  };
  const lanes = [];
  for (const [a, b] of lanePairs) {
    const path = findPath(n, costGrid, a.y * n + a.x, b.y * n + b.x, 5);
    if (!path) continue;
    lanes.push({ a, b, path });
    for (const i of path) {
      const x = i % n;
      const y = (i - x) / n;
      carve(x, y, LS.lane);
      sym.stamp(road, x, y, 1);
    }
  }

  // ---- Camps ----
  const usedBases = L.bases.filter((b) => b.player >= 0);
  const camps = [];
  const minesOut = [];
  const startsOut = [];
  const byPlayer = [...usedBases].sort((p, q) => p.player - q.player);
  for (const b of byPlayer) {
    startsOut.push({ x: b.tx, y: b.ty });
    minesOut.push({ tx: b.mx, ty: b.my, amount: GOLD_MINE_AMOUNT });
  }
  for (const e of L.expansions) {
    minesOut.push({ tx: e.mx, ty: e.my, amount: EXPANSION_MINE_AMOUNT });
    camps.push({ x: e.camp.x, y: e.camp.y, level: e.level });
  }
  for (const s of L.spare) {
    minesOut.push({ tx: s.mx, ty: s.my, amount: EXPANSION_MINE_AMOUNT });
    camps.push({ x: s.camp.x, y: s.camp.y, level: s.level });
  }
  if (L.center.kind === 'camp') camps.push({ x: half, y: half, level: L.center.level });

  // Level-1 camps along the routes: lane points far from starts, spread as far apart as possible.
  const campOk = (x, y) => {
    for (const b of usedBases) if (rectDist(x, y, b.tx, b.ty, TC_SIZE) < CAMP_MIN_START_DIST + 1) return false;
    for (const b of L.bases) if (dist(x, y, b.cx, b.cy) < 16) return false;
    for (const [mx, my] of allMines) if (dist(x, y, mx + 1.5, my + 1.5) < 9) return false;
    for (const e of L.expansions) if (dist(x, y, e.ex, e.ey) < 9) return false;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    return isOpen(T[ty * n + tx]) && dEdge(tx, ty) >= 6;
  };
  // Spacing score: distance to the nearest existing camp or other image of this spot.
  const spacing = (imgs) => {
    let best = Infinity;
    for (const [x, y] of imgs) {
      for (const c of camps) best = Math.min(best, dist(x, y, c.x, c.y));
      for (const [ox, oy] of imgs) if (ox !== x || oy !== y) best = Math.min(best, dist(x, y, ox, oy));
    }
    return best;
  };
  const onLanes = [];
  for (const lane of lanes) for (let f = 0.3; f <= 0.71; f += 0.1) onLanes.push(lane.path[Math.floor(lane.path.length * f)]);
  const anywhere = [];
  for (let y = 6; y < half; y += 2) for (let x = 6; x < n - 6; x += 2) if (sym.inDomain(x, y)) anywhere.push(y * n + x);
  const routeMax = order === 2 ? 2 : 1;
  for (let placed = 0; placed < routeMax; placed++) {
    let pick = null;
    let pickScore = 12; // camps keep at least this far apart
    for (const pool of [onLanes, anywhere]) {
      for (const i of pool) {
        const imgs = ks.map((k) => sym.point(k, (i % n) + 0.5, Math.floor(i / n) + 0.5));
        if (!imgs.every(([x, y]) => campOk(x, y))) continue;
        const score = spacing(imgs);
        if (score > pickScore) {
          pick = imgs;
          pickScore = score;
        }
      }
      if (pick) break;
    }
    if (!pick) break;
    for (const [x, y] of pick) {
      camps.push({ x, y, level: 1 });
      terrainCamps.push({ x, y });
    }
  }

  // ---- Shores, dirt, roads ----
  const shore = new Uint8Array(N).fill(3); // Chebyshev distance to water, capped at 3
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (T[y * n + x] !== WATER) continue;
      for (let oy = -2; oy <= 2; oy++) {
        for (let ox = -2; ox <= 2; ox++) {
          const tx = x + ox;
          const ty = y + oy;
          if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
          const j = ty * n + tx;
          shore[j] = Math.min(shore[j], Math.max(Math.abs(ox), Math.abs(oy)));
        }
      }
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const t = T[i];
      if (shore[i] === 0 || shore[i] === 3 || t === ROCK || foot[i] || dEdge(x, y) < BORDER_MIN) continue;
      if (shore[i] === 1 && !locked[i]) T[i] = SAND;
      else if (shore[i] === 2 && (t === GRASS || t === DIRT) && fDetail[i] > 0.42) T[i] = SAND;
    }
  }
  const thrDirt = quantile(fDirt, 0.9);
  for (let i = 0; i < N; i++) {
    if (T[i] === GRASS && (fDirt[i] > thrDirt || (road[i] && fShape[i] > 0.32))) T[i] = DIRT;
  }
  for (const b of L.bases) {
    disc(b.cx, b.cy, 5.4, (i, d) => {
      if (T[i] === GRASS && d < 4.6 + 1.6 * (fDetail[i] - 0.5)) T[i] = DIRT;
    });
  }
  for (const c of terrainCamps) {
    disc(c.x, c.y, 2.6, (i, d) => {
      if (T[i] === GRASS && d < 2.1 + (fDetail[i] - 0.5)) T[i] = DIRT;
    });
  }
  for (const [mx, my] of allMines) {
    for (let y = my - 2; y <= my + MINE_SIZE + 1; y++) {
      for (let x = mx - 2; x <= mx + MINE_SIZE + 1; x++) {
        const i = y * n + x;
        if (T[i] === GRASS && fDetail[i] > 0.45) T[i] = DIRT;
      }
    }
  }

  // ---- Hard guarantees: open start pockets, mine rings, camp spots ----
  const openUp = (i) => {
    if (!isOpen(T[i])) T[i] = GRASS;
  };
  for (const b of L.bases) disc(b.cx, b.cy, START_CLEAR_RADIUS + 0.5, openUp);
  for (const c of terrainCamps) disc(c.x, c.y, 2.6, openUp);
  for (const [mx, my] of allMines) {
    for (let y = my - 1; y <= my + MINE_SIZE; y++) for (let x = mx - 1; x <= mx + MINE_SIZE; x++) if (!isOpen(T[y * n + x])) T[y * n + x] = DIRT;
  }

  // ---- Connectivity: carve passages to cut-off areas, fill tiny pockets ----
  const keys = [];
  for (const b of L.bases) for (const i of ringTiles(n, b.tx, b.ty, TC_SIZE)) keys.push(i);
  for (const [mx, my] of allMines) for (const i of ringTiles(n, mx, my, MINE_SIZE)) keys.push(i);
  for (const c of terrainCamps) keys.push(Math.floor(c.y) * n + Math.floor(c.x));
  const bigKeys = [];
  for (const b of L.bases) bigKeys.push(frontTile(n, b.cx, b.cy, FRONT_DIST));
  for (const e of L.expansions) bigKeys.push(Math.floor(e.ey) * n + Math.floor(e.ex));
  for (const c of terrainCamps) bigKeys.push(Math.floor(c.y) * n + Math.floor(c.x));
  connect(n, sym, T, foot, keys, bigKeys, dEdge);

  // ---- Wood ----
  const wood = new Uint16Array(N);
  for (let i = 0; i < N; i++) if (T[i] === FOREST) wood[i] = TREE_WOOD;

  const sacred = placeSacredSites(n, sym, T, foot, L, startsOut, allMines, camps, dEdge, landscape !== 'classic');

  const map = {
    width: n,
    height: n,
    seed,
    terrain: T,
    heights: null,
    wood,
    starts: startsOut,
    mines: minesOut,
    camps,
    sacred,
    decor: [],
    meta: { symmetry: order, layout: plan.mode, landscape, center: L.center.kind, lakes: L.lakes.length + (L.center.kind === 'lake' ? 1 : 0), river: !!L.river },
  };
  const layout = { bases: L.bases, expansions: L.expansions, center: L.center, road, sc, rockLift: LS.rockLift, hills: LS.hills || 1 };
  return { map, layout };
}

/**
 * The landscape's own terrain (LANDSCAPE_RULES), drawn before the base pockets and clearings
 * (which still win over it). Every field is orbit-averaged, so all starts see the same ground.
 * - ridges (Highlands): two-tile rock walls along two contour lines of a smooth field; the lanes
 *   and the connectivity pass later cut the passes through them.
 * - rivers: three- to four-tile rivers along two contour lines; where a lane crosses, its carve
 *   leaves a sandy ford.
 * - sea (Islands): water everywhere except an island under each base, expansion, camp and the
 *   center, plus a few noise islets; the lanes become sandy land bridges.
 * Ridges and rivers thin out near bases, expansions and camps, so they never press on a pocket.
 */
function landscapePass(n, sym, rng, L, LS, camps, rock, water, dEdge) {
  const N = n * n;
  const sc = n / 96;
  const zones = L.zones;
  // 0 inside a zone, rising to 1 a few tiles outside it.
  const taper = (x, y) => {
    let t = 1;
    for (const z of zones) {
      const d = dist(x, y, z.x, z.y);
      if (d < z.r + 6) t = Math.min(t, smoothstep(z.r - 1, z.r + 6, d));
    }
    return t;
  };
  // Distance in tiles from each tile to a contour line of f (value / gradient length).
  const contour = (f, levels, halfWidth, out) => {
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        const gx = (f[i + 1] - f[i - 1]) / 2;
        const gy = (f[i + n] - f[i - n]) / 2;
        const g = Math.sqrt(gx * gx + gy * gy) + 1e-6;
        let near = Infinity;
        for (const m of levels) near = Math.min(near, Math.abs(f[i] - m) / g);
        if (near >= halfWidth) continue;
        const w = halfWidth * taper(x + 0.5, y + 0.5);
        if (near < w) out[i] = 1;
      }
    }
  };
  if (LS.ridges) {
    const f = sym.field(fbm(rng.fork('ridges'), n, [[22 * sc, 0.8], [9 * sc, 0.2]]));
    contour(f, [quantile(f, 0.38), quantile(f, 0.62)], 1.6, rock);
  }
  if (LS.rivers) {
    const f = sym.field(fbm(rng.fork('rivers'), n, [[28 * sc, 0.82], [11 * sc, 0.18]]));
    contour(f, [quantile(f, 0.5)], 1.8, water);
  }
  if (LS.sea) {
    const fLand = sym.field(fbm(rng.fork('isles'), n, [[9 * sc, 0.62], [4 * sc, 0.38]]));
    const p = new Float64Array(N);
    const bumps = [];
    for (const b of L.bases) bumps.push([b.cx, b.cy, 15, 23]);
    for (const e of L.expansions) bumps.push([e.ex, e.ey, 8, 13], [e.mcx, e.mcy, 6, 10]);
    for (const c of camps) bumps.push([c.x, c.y, 4, 8]);
    if (L.center.kind !== 'lake') bumps.push([n / 2, n / 2, 7, 12]);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        let v = 0.78 * fLand[i];
        for (const [bx, by, r0, r1] of bumps) {
          const d = dist(x + 0.5, y + 0.5, bx, by);
          if (d < r1) v = Math.max(v, 1 - smoothstep(r0, r1, d));
        }
        v -= 0.7 * (1 - smoothstep(3, 13, dEdge(x, y)));
        p[i] = v + 0.14 * (fLand[(n - 1 - x) * n + (n - 1 - y)] - 0.5); // a second wobble from the transposed field keeps coasts ragged
      }
    }
    const thr = Math.min(0.62, quantile(p, 0.46));
    for (let i = 0; i < N; i++) if (p[i] < thr) water[i] = 1;
  }
}

/** Closest a sacred site comes to a start's Town Center footprint (then a gold mine's center, a creep camp, another site). */
export const SITE_MIN_START_DIST = 16;
const SITE_MIN_MINE_DIST = 7;
const SITE_CAMP_DISTS = [12, 9]; // from a creep camp: 12 when it fits (creeps wake 5 tiles from their spot and stand up to ~3 out), else 9
const SITE_MIN_GAP = 12; // between two sites

/**
 * Sacred sites (DESIGN 5.11): neutral holy ground for every player to fight over, placed as whole
 * symmetry orbits so no start is nearer to more of them than another. A site at the map center
 * when the middle is open ground, then one orbit of sites that sit as far from every start as from
 * its rivals (between the two corners of a duel, between two neighbouring corners in a 3 or 4
 * player game, on the side edges between the teams of a team game), then stand-in orbits until the
 * map has 3 (4 on a four-fold map). Each site needs a disc of radius SITE_CLEAR of open,
 * footprint-free ground reachable from the starts, away from starts, mines, creep camps and the
 * other sites; the search walks outward from each target and keeps the first tile whose every
 * image qualifies, so a crowded spot just moves a few tiles.
 * Deterministic (integer and IEEE-exact math only): every browser places the same sites.
 * @returns {{x:number,y:number}[]} site centers in tile coordinates
 */
function placeSacredSites(n, sym, T, foot, L, starts, allMines, camps, dEdge, widen = false) {
  const half = n / 2;
  const { ks } = sym;
  // Reachable ground: the component of the first start's front tile.
  const { label } = labelComponents(n, walkMask(T, foot));
  const s0 = starts[0];
  const main = s0 ? label[frontTile(n, s0.x + TC_SIZE / 2, s0.y + TC_SIZE / 2, FRONT_DIST)] : -1;
  const sites = [];
  const r = SITE_CLEAR;
  const R = Math.ceil(r);
  const clear = (x, y) => {
    for (let ty = Math.floor(y - R) - 1; ty <= Math.floor(y + R); ty++) {
      for (let tx = Math.floor(x - R) - 1; tx <= Math.floor(x + R); tx++) {
        const dx = tx + 0.5 - x;
        const dy = ty + 0.5 - y;
        if (dx * dx + dy * dy > r * r) continue;
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) return false;
        const i = ty * n + tx;
        if (!isOpen(T[i]) || foot[i] || label[i] !== main) return false;
      }
    }
    return true;
  };
  const ok = (x, y, others, campDist = SITE_CAMP_DISTS[0]) => {
    if (dEdge(Math.floor(x), Math.floor(y)) < R + 4) return false;
    for (const s of starts) if (rectDist(x, y, s.x, s.y, TC_SIZE) < SITE_MIN_START_DIST) return false;
    for (const [mx, my] of allMines) if (dist(x, y, mx + MINE_SIZE / 2, my + MINE_SIZE / 2) < SITE_MIN_MINE_DIST) return false;
    for (const c of camps) if (dist(x, y, c.x, c.y) < campDist) return false;
    for (const o of others) if (dist(x, y, o.x, o.y) < SITE_MIN_GAP) return false;
    return clear(x, y);
  };
  // One orbit around canonical target (fx, fy) (fractions of the map), searched up to `reach` tiles away;
  // a spot clear of the creep camps by the wider distance wins over a nearer one that is not.
  const orbit = (fx, fy, reach) => {
    const cx = Math.floor(fx * n);
    const cy = Math.floor(fy * n);
    const cands = [];
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= reach * reach) cands.push([d2, dy, dx]);
      }
    }
    cands.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    for (const campDist of SITE_CAMP_DISTS) {
      for (const [, dy, dx] of cands) {
        const imgs = ks.map((k) => sym.point(k, cx + dx + 0.5, cy + dy + 0.5));
        const placed = [];
        let good = true;
        for (const [x, y] of imgs) {
          if (!ok(x, y, [...sites, ...placed], campDist)) {
            good = false;
            break;
          }
          placed.push({ x, y });
        }
        if (good) {
          sites.push(...placed);
          return true;
        }
      }
    }
    return false;
  };
  const four = sym.order === 4;
  const teams = L.bases.length > 0 && L.bases.some((b) => b.ci === 1);
  // The center: one site on the fixed point when the middle is open.
  const middle = L.center.kind !== 'lake' && L.center.kind !== 'camp' && ok(half, half, []);
  if (middle) sites.push({ x: half, y: half });
  // Orbits in order of preference until the map has its sites: the first is the contested one, the
  // later ones stand in when lakes, forest or creep camps leave no room (a lake or camp in the middle
  // also takes the center's place).
  let plan;
  if (four) plan = [[0.5, 0.3, 20], [0.36, 0.36, 16], [0.5, 0.2, 16]]; // between each pair of neighbouring corners
  else if (teams) plan = [[0.2, 0.5, 20], [0.38, 0.5, 14], [0.5, 0.3, 14]]; // on the side edges, between the two teams
  else {
    // A pair as far from one corner as from the other, or, when a river runs along that diagonal, one on each corner's flank.
    plan = [L.center.kind === 'river' ? [0.5, 0.25, 20] : [0.66, 0.34, 20], [0.38, 0.38, 14], [0.5, 0.25, 14], [0.25, 0.5, 14]];
  }
  const want = four ? 4 : 3;
  for (const [fx, fy, reach] of plan) {
    if (sites.length >= want) break;
    orbit(fx, fy, reach);
  }
  // The new landscapes leave less open ground (sea, deep woods, rivers): when the usual spots are
  // taken, try the rest of the canonical half or quarter of the map, nearest the center first.
  if (widen && sites.length < want) {
    const spots = [];
    for (let fy = 0.2; fy < 0.5; fy += 0.075) {
      for (let fx = 0.2; fx < (four ? 0.5 : 0.8); fx += 0.075) spots.push([fx, fy, (fx - 0.5) * (fx - 0.5) + (fy - 0.5) * (fy - 0.5)]);
    }
    spots.sort((a, b) => a[2] - b[2]);
    for (const [fx, fy] of spots) {
      if (sites.length >= want) break;
      orbit(fx, fy, 5);
    }
  }
  return sites;
}

/**
 * Make every key tile reachable from the first one (4-connected, footprints blocked):
 * carve 3-wide passages (stamped symmetrically), then turn small unreachable
 * pockets into forest and connect large ones.
 */
function connect(n, sym, T, foot, keys, bigKeys, dEdge) {
  const N = n * n;
  const nearFoot = new Uint8Array(N); // footprints grown by one tile: a 3-wide route cannot pass here
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      if (!foot[y * n + x]) continue;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) nearFoot[(y + oy) * n + x + ox] = 1;
    }
  }
  const carvePath = (path) => {
    for (const i of path) {
      const x = i % n;
      const y = (i - x) / n;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const tx = x + ox;
          const ty = y + oy;
          if (tx < 0 || ty < 0 || tx >= n || ty >= n || dEdge(tx, ty) < NO_CARVE_EDGE) continue;
          for (const k of sym.ks) {
            const j = sym.tile(k, tx, ty);
            if (foot[j]) continue;
            if (T[j] === FOREST || T[j] === ROCK) T[j] = GRASS;
            else if (T[j] === WATER) T[j] = SAND;
          }
        }
      }
    }
  };
  // BFS from a cut-off tile through anything carvable to the nearest main-component tile.
  const bridge = (from, label, mainId, avoid = foot) => {
    const prev = new Int32Array(N).fill(-2);
    const queue = new Int32Array(N);
    let head = 0;
    let tail = 0;
    queue[tail++] = from;
    prev[from] = -1;
    while (head < tail) {
      const i = queue[head++];
      if (label[i] === mainId) {
        const path = [];
        for (let j = i; j >= 0; j = prev[j]) path.push(j);
        carvePath(path);
        return true;
      }
      const x = i % n;
      const y = (i - x) / n;
      for (let d = 0; d < 4; d++) {
        const tx = x + NX[d];
        const ty = y + NY[d];
        if (tx < 0 || ty < 0 || tx >= n || ty >= n || dEdge(tx, ty) < NO_CARVE_EDGE) continue;
        const j = ty * n + tx;
        if (prev[j] !== -2 || avoid[j]) continue;
        prev[j] = i;
        queue[tail++] = j;
      }
    }
    return false;
  };
  for (let iter = 0; iter < 48; iter++) {
    const { label, sizes } = labelComponents(n, walkMask(T, foot));
    const mainId = label[keys[0]];
    const cut = keys.find((i) => label[i] !== mainId);
    if (cut !== undefined) {
      if (!bridge(cut, label, mainId)) break;
      continue;
    }
    let changed = false;
    let bigLabel = -1;
    for (let i = 0; i < N; i++) {
      const l = label[i];
      if (l < 0 || l === mainId) continue;
      if (sizes[l] <= POCKET_FILL_MAX) {
        T[i] = FOREST;
        changed = true;
      } else if (bigLabel < 0) bigLabel = i;
    }
    if (bigLabel >= 0) {
      bridge(bigLabel, label, mainId);
      changed = true;
    }
    if (!changed) break;
  }
  // Big units: every front yard, expansion clearing and camp joined by 3-wide routes.
  for (let iter = 0; iter < 32; iter++) {
    const { label } = labelComponents(n, bigMask(n, walkMask(T, foot)));
    const mainId = label[bigKeys[0]];
    const cut = bigKeys.find((i) => label[i] < 0 || label[i] !== mainId);
    if (cut === undefined || mainId < 0) break;
    if (!bridge(cut, label, mainId, nearFoot)) break;
  }
}

// ---------------------------------------------------------------------------
// Validation and hashing (deterministic part)

/**
 * Check every gameplay guarantee of a generated map.
 * @param {object} map MapData from generateMap
 * @returns {string[]} problems (empty when the map is valid)
 */
export function validateMap(map) {
  const errors = [];
  const { width: n, terrain: T, wood, starts, mines, camps } = map;
  const N = n * n;
  const pc = starts.length;
  if (T.length !== N || wood.length !== N) errors.push('array sizes do not match the map size');
  for (let i = 0; i < N; i++) {
    if ((T[i] === FOREST) !== (wood[i] === TREE_WOOD) || (T[i] !== FOREST && wood[i] !== 0)) {
      errors.push(`wood mismatch at tile ${i}`);
      break;
    }
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (Math.min(x, y, n - 1 - x, n - 1 - y) < BORDER_MIN && T[y * n + x] !== FOREST) {
        errors.push(`border tile ${x},${y} is not forest`);
        y = n;
        break;
      }
    }
  }
  const foot = new Uint8Array(N);
  const inBounds = (x, y, s) => x >= 0 && y >= 0 && x + s <= n && y + s <= n;
  starts.forEach((s, p) => {
    if (!inBounds(s.x, s.y, TC_SIZE)) errors.push(`start ${p} out of bounds`);
    for (let y = s.y; y < s.y + TC_SIZE; y++) for (let x = s.x; x < s.x + TC_SIZE; x++) foot[y * n + x] = 1;
  });
  mines.forEach((m, mi) => {
    if (!inBounds(m.tx, m.ty, MINE_SIZE)) return errors.push(`mine ${mi} out of bounds`);
    const want = mi < pc ? GOLD_MINE_AMOUNT : EXPANSION_MINE_AMOUNT;
    if (m.amount !== want) errors.push(`mine ${mi} amount ${m.amount}`);
    for (let y = m.ty; y < m.ty + MINE_SIZE; y++) {
      for (let x = m.tx; x < m.tx + MINE_SIZE; x++) {
        const i = y * n + x;
        if (foot[i]) errors.push(`mine ${mi} overlaps another footprint`);
        if (!isOpen(T[i])) errors.push(`mine ${mi} sits on blocked terrain`);
        foot[i] = 1;
      }
    }
    for (const i of ringTiles(n, m.tx, m.ty, MINE_SIZE)) if (!isOpen(T[i])) errors.push(`mine ${mi} ring blocked`);
    starts.forEach((s, p) => {
      const gap = footprintGap(s.x, s.y, TC_SIZE, m.tx, m.ty, MINE_SIZE);
      if (mi === p && gap !== START_MINE_GAP) errors.push(`start mine ${mi} gap ${gap}`);
      if (gap < START_MINE_GAP) errors.push(`mine ${mi} too close to start ${p}`);
    });
  });
  const half = n / 2;
  starts.forEach((s, p) => {
    const cx = s.x + TC_SIZE / 2;
    const cy = s.y + TC_SIZE / 2;
    const m = mines[p];
    if (m && (m.tx + 1.5 - cx) * (half - cx) + (m.ty + 1.5 - cy) * (half - cy) >= 0) errors.push(`start mine ${p} faces the center`);
    const r = Math.ceil(START_CLEAR_RADIUS);
    for (let y = Math.floor(cy) - r; y <= Math.floor(cy) + r; y++) {
      for (let x = Math.floor(cx) - r; x <= Math.floor(cx) + r; x++) {
        if (dist(x + 0.5, y + 0.5, cx, cy) > 8) continue;
        if (x < 0 || y < 0 || x >= n || y >= n || !isOpen(T[y * n + x])) {
          errors.push(`start ${p} area blocked at ${x},${y}`);
          y = n;
          break;
        }
      }
    }
  });
  camps.forEach((c, ci) => {
    if (![1, 2, 3].includes(c.level)) errors.push(`camp ${ci} bad level`);
    starts.forEach((s, p) => {
      if (rectDist(c.x, c.y, s.x, s.y, TC_SIZE) < CAMP_MIN_START_DIST) errors.push(`camp ${ci} too close to start ${p}`);
    });
    const tx = Math.floor(c.x);
    const ty = Math.floor(c.y);
    for (let y = ty - 1; y <= ty + 1; y++) {
      for (let x = tx - 1; x <= tx + 1; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n || !isOpen(T[y * n + x]) || foot[y * n + x]) errors.push(`camp ${ci} spot blocked`);
      }
    }
  });
  for (let mi = pc; mi < mines.length; mi++) {
    const m = mines[mi];
    const guarded = camps.some((c) => c.level >= 2 && Math.abs(dist(c.x, c.y, m.tx + 1.5, m.ty + 1.5) - 5) <= 1);
    if (!guarded) errors.push(`expansion mine ${mi} has no guard camp`);
  }
  // Reachability (4-connected, footprints blocked).
  const { label } = labelComponents(n, walkMask(T, foot));
  const keys = [];
  for (const s of starts) keys.push(...ringTiles(n, s.x, s.y, TC_SIZE).filter((i) => isOpen(T[i]) && !foot[i]));
  for (const m of mines) keys.push(...ringTiles(n, m.tx, m.ty, MINE_SIZE).filter((i) => !foot[i]));
  for (const c of camps) keys.push(Math.floor(c.y) * n + Math.floor(c.x));
  const mainId = keys.length ? label[keys[0]] : -1;
  if (keys.some((i) => label[i] < 0 || label[i] !== mainId)) errors.push('not all starts, mines and camps are reachable');
  // Big units (3×3 clearance) reach every start's front yard and every camp.
  const big = labelComponents(n, bigMask(n, walkMask(T, foot))).label;
  const bigKeys = starts.map((s) => frontTile(n, s.x + TC_SIZE / 2, s.y + TC_SIZE / 2, FRONT_DIST));
  for (const c of camps) bigKeys.push(Math.floor(c.y) * n + Math.floor(c.x));
  const bigId = big[bigKeys[0]];
  if (bigId < 0 || bigKeys.some((i) => big[i] !== bigId)) errors.push('big units cannot reach every start and camp');
  return errors;
}

/**
 * 32-bit FNV-1a hash (hex) over terrain, wood, starts, mines and camps.
 * Host and clients compare it to verify they generated the same map.
 */
export function mapHash(map) {
  let h = 0x811c9dc5;
  const byte = (b) => {
    h ^= b & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  const int = (v) => {
    const x = v | 0;
    byte(x);
    byte(x >>> 8);
    byte(x >>> 16);
    byte(x >>> 24);
  };
  int(map.width);
  int(map.height);
  for (let i = 0; i < map.terrain.length; i++) byte(map.terrain[i]);
  for (let i = 0; i < map.wood.length; i++) {
    byte(map.wood[i]);
    byte(map.wood[i] >>> 8);
  }
  int(map.starts.length);
  for (const s of map.starts) { int(s.x); int(s.y); }
  int(map.mines.length);
  for (const m of map.mines) { int(m.tx); int(m.ty); int(m.amount); }
  int(map.camps.length);
  for (const c of map.camps) { int(Math.round(c.x * 100)); int(Math.round(c.y * 100)); int(c.level); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** generateMap options for a GameSetup: everyone (host, clients, tests) must build the same map. */
export function mapOptions(setup) {
  const players = (setup && setup.players) || [];
  const opts = { seed: setup.seed, mapSize: setup.mapSize, playerCount: players.length, teams: players.map((p) => p.team) };
  if (isLandscape(setup.landscape) && setup.landscape !== 'classic') opts.landscape = setup.landscape;
  return opts;
}

/**
 * Generate a melee map (DESIGN.md 6.7). Pure and deterministic.
 * `teams` (team of each player, optional) groups teammates (startPlan).
 * `landscape` (src/data/landscapes.js) picks the ground between the bases; unknown ids give the classic map.
 * @param {{ seed: number|string, mapSize?: 'small'|'medium'|number, playerCount?: number, teams?: Array<number|string>, landscape?: string }} opts
 * @returns {{ width:number, height:number, seed:number|string, terrain:Uint8Array, heights:Float32Array,
 *   wood:Uint16Array, starts:{x:number,y:number}[], mines:{tx:number,ty:number,amount:number}[],
 *   camps:{x:number,y:number,level:number}[], decor:{x:number,y:number,kind:string,rot:number,scale:number}[] }}
 */
export function generateMap({ seed = 1, mapSize = 'small', playerCount = 2, teams = null, landscape = 'classic' } = {}) {
  const n = resolveSize(mapSize);
  const pc = Math.min(4, Math.max(1, Math.floor(Number(playerCount)) || 2));
  const plan = startPlan(pc, teams);
  const ls = isLandscape(landscape) ? landscape : 'classic';
  let built = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    built = buildMap(seed, n, pc, attempt, plan, ls);
    built.map.meta.attempt = attempt;
    if (validateMap(built.map).length === 0) break;
  }
  addRenderData(built.map, built.layout);
  return built.map;
}

// ==== RENDER-ONLY: heights and decor below (cosmetic, may use any Math) ====

function addRenderData(map, layout) {
  const rng = new RNG(hashSeed(`mythicwar-render|${map.seed}|${map.width}|${map.starts.length}`));
  map.heights = buildHeights(map, layout, rng.fork('heights'));
  map.decor = buildDecor(map, layout, rng.fork('decor'));
}

function buildHeights(map, layout, rng) {
  const n = map.width;
  const V = n + 1;
  const T = map.terrain;

  // Rolling hills: two octaves of vertex value noise, gently shaped to 0.04..0.66.
  const hills = new Float64Array(V * V);
  addValueNoise(rng, V, 22 * layout.sc, 0.7, hills, 0);
  addValueNoise(rng, V, 9 * layout.sc, 0.3, hills, 0);
  const hillAmp = layout.hills || 1; // Highlands roll higher
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < hills.length; i++) {
    lo = Math.min(lo, hills[i]);
    hi = Math.max(hi, hills[i]);
  }
  const land = new Float32Array(V * V);
  for (let i = 0; i < land.length; i++) land[i] = 0.04 + 0.62 * hillAmp * Math.pow((hills[i] - lo) / (hi - lo || 1), 1.35);
  const vtx = (x, y) => Math.max(0, Math.min(V - 1, Math.round(y))) * V + Math.max(0, Math.min(V - 1, Math.round(x)));

  // Flatten around starts, mines, expansion clearings and camps (weighted toward each site's height).
  const sites = [];
  for (const s of map.starts) sites.push({ x: s.x + 2, y: s.y + 2, r0: 10, r1: 15 });
  for (const b of layout.bases) if (b.player < 0) sites.push({ x: b.cx, y: b.cy, r0: 9, r1: 14 });
  for (const m of map.mines) sites.push({ x: m.tx + 1.5, y: m.ty + 1.5, r0: 3.5, r1: 6.5 });
  for (const e of layout.expansions) sites.push({ x: e.ex, y: e.ey, r0: 6, r1: 10 });
  for (const c of map.camps) sites.push({ x: c.x, y: c.y, r0: 2.5, r1: 5 });
  if (layout.center.kind === 'camp') sites.push({ x: n / 2, y: n / 2, r0: 6, r1: 10 });
  for (const s of map.sacred || []) sites.push({ x: s.x, y: s.y, r0: 3.5, r1: 6 });
  const wsum = new Float32Array(V * V);
  const tsum = new Float32Array(V * V);
  for (const s of sites) {
    // A site inside an earlier, larger site (a start's own mine) shares that site's height.
    const host = sites.find((o) => o.target !== undefined && Math.hypot(o.x - s.x, o.y - s.y) < o.r0);
    s.target = host ? host.target : land[vtx(s.x, s.y)];
    const target = s.target;
    const y0 = Math.max(0, Math.ceil(s.y - s.r1));
    const y1 = Math.min(V - 1, Math.floor(s.y + s.r1));
    const x0 = Math.max(0, Math.ceil(s.x - s.r1));
    const x1 = Math.min(V - 1, Math.floor(s.x + s.r1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d >= s.r1) continue;
        const w = 1 - smoothstep(s.r0, s.r1, d);
        wsum[y * V + x] += w;
        tsum[y * V + x] += w * target;
      }
    }
  }

  // Count water / rock tiles touching each vertex.
  const wet = new Uint8Array(V * V);
  const rocky = new Uint8Array(V * V);
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const t = T[ty * n + tx];
      const counts = t === WATER ? wet : t === ROCK ? rocky : null;
      if (!counts) continue;
      const v = ty * V + tx;
      counts[v]++;
      counts[v + 1]++;
      counts[v + V]++;
      counts[v + V + 1]++;
    }
  }
  // Distance from the shore (only matters up to SHORE_SLOPE vertices away).
  const SHORE_SLOPE = 4;
  const dw = new Float32Array(V * V).fill(SHORE_SLOPE);
  for (let y = 0; y < V; y++) {
    for (let x = 0; x < V; x++) {
      if (!wet[y * V + x]) continue;
      for (let oy = -SHORE_SLOPE; oy <= SHORE_SLOPE; oy++) {
        const yy = y + oy;
        if (yy < 0 || yy >= V) continue;
        for (let ox = -SHORE_SLOPE; ox <= SHORE_SLOPE; ox++) {
          const xx = x + ox;
          if (xx < 0 || xx >= V) continue;
          const j = yy * V + xx;
          const d = Math.hypot(ox, oy);
          if (d < dw[j]) dw[j] = d;
        }
      }
    }
  }

  const out = new Float32Array(V * V);
  for (let i = 0; i < out.length; i++) {
    let h = land[i];
    if (wsum[i] > 0) h += (tsum[i] / wsum[i] - h) * Math.min(1, wsum[i]);
    h += (layout.rockLift ?? 0.09) * rocky[i];
    if (wet[i] === 4) h = -0.6;
    else if (wet[i] > 0) h = -0.35;
    else h = -0.05 + (h + 0.05) * smoothstep(0, SHORE_SLOPE, dw[i]);
    out[i] = Math.max(-0.6, Math.min(0.8, h));
  }
  return out;
}

function buildDecor(map, layout, rng) {
  const n = map.width;
  const T = map.terrain;
  const items = [];
  // Tiles where no decor goes: start bases, around mines, on camp spots.
  const keepOut = new Uint8Array(n * n);
  const mark = (cx, cy, r) => {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(n - 1, Math.floor(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(n - 1, Math.floor(cx + r)); x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < r) keepOut[y * n + x] = 1;
      }
    }
  };
  for (const s of map.starts) mark(s.x + 2, s.y + 2, 11.5);
  for (const m of map.mines) mark(m.tx + 1.5, m.ty + 1.5, 4.2);
  for (const c of map.camps) mark(c.x, c.y, 2.4);
  for (const s of map.sacred || []) mark(s.x, s.y, 3.6);
  const near = (x, y, code) => {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const tx = x + ox;
        const ty = y + oy;
        if (tx >= 0 && ty >= 0 && tx < n && ty < n && T[ty * n + tx] === code) return true;
      }
    }
    return false;
  };
  const SCALE = { rock: [0.6, 1.5], bush: [0.7, 1.3], flowers: [0.7, 1.2], ruin: [0.8, 1.4], stump: [0.8, 1.2], grass: [0.7, 1.3] };
  const round2 = (v) => Math.round(v * 100) / 100;
  const add = (x, y, kind) => {
    const [a, b] = SCALE[kind];
    items.push({ x: round2(x), y: round2(y), kind, rot: round2(rng.range(0, Math.PI * 2)), scale: round2(rng.range(a, b)) });
  };

  // Ruins around the stronger camps (and the center plaza).
  for (const c of map.camps) {
    if (c.level < 2) continue;
    const count = rng.int(1, 3);
    for (let j = 0; j < count; j++) {
      const ang = rng.range(0, Math.PI * 2);
      const r = rng.range(2.8, 4.5);
      const x = c.x + Math.cos(ang) * r;
      const y = c.y + Math.sin(ang) * r;
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= n || ty >= n || !isOpen(T[ty * n + tx])) continue;
      if (map.mines.some((m) => Math.hypot(x - m.tx - 1.5, y - m.ty - 1.5) < 3.2)) continue;
      add(x, y, 'ruin');
    }
  }

  // Scatter: bushes, stumps and rocks along forest edges, rocks on sand, grass and flowers in meadows.
  const target = Math.round((n * n) / 34);
  for (let tries = 0; items.length < target && tries < target * 8; tries++) {
    const tx = rng.int(0, n - 1);
    const ty = rng.int(0, n - 1);
    const i = ty * n + tx;
    const t = T[i];
    if (!isOpen(t) || keepOut[i]) continue;
    const x = tx + rng.range(0.15, 0.85);
    const y = ty + rng.range(0.15, 0.85);
    const byForest = near(tx, ty, FOREST);
    const byRock = near(tx, ty, ROCK);
    const r = rng.next();
    let kind;
    if (t === SAND) kind = r < 0.45 ? 'rock' : r < 0.8 ? 'grass' : 'bush';
    else if (byRock) kind = r < 0.6 ? 'rock' : r < 0.85 ? 'grass' : 'bush';
    else if (byForest) kind = r < 0.38 ? 'bush' : r < 0.55 ? 'stump' : r < 0.68 ? 'rock' : r < 0.86 ? 'grass' : 'flowers';
    else if (r < 0.45) kind = 'grass';
    else if (r < 0.72) kind = 'flowers';
    else if (r < 0.86) kind = 'bush';
    else if (r < 0.97) kind = 'rock';
    else kind = 'ruin';
    const small = kind === 'grass' || kind === 'flowers';
    if (layout.road[i] && !small) continue;
    // Open meadows get fewer solid props so players have room to build.
    if (!small && !byForest && !byRock && t !== SAND && rng.chance(0.5)) continue;
    add(x, y, kind);
  }
  return items;
}
