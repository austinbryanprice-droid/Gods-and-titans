// Grid pathfinding: A* with a binary heap, octile heuristic, no diagonal corner
// cutting and a node cap with closest-reachable fallback; line-of-sight path
// smoothing; and a per-tick budgeted request queue shared by all units.

const SQRT2 = Math.SQRT2;
const DXS = [1, -1, 0, 0, 1, 1, -1, -1];
const DYS = [0, 0, 1, -1, 1, -1, 1, -1];
const COSTS = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];

/** Octile distance between tile deltas. */
export function octile(dx, dy) {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  return ax > ay ? ax + (SQRT2 - 1) * ay : ay + (SQRT2 - 1) * ax;
}

/**
 * True when the straight segment crosses only passable tiles (DDA traversal).
 * Points are in tile units; out-of-bounds tiles are blocked.
 */
export function lineClear(grid, w, h, x0, y0, x1, y1) {
  let tx = Math.floor(x0);
  let ty = Math.floor(y0);
  const ex = Math.floor(x1);
  const ey = Math.floor(y1);
  if (tx < 0 || ty < 0 || tx >= w || ty >= h || grid[ty * w + tx] === 0) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx > 0 ? (tx + 1 - x0) / dx : dx < 0 ? (x0 - tx) / -dx : Infinity;
  let tMaxY = dy > 0 ? (ty + 1 - y0) / dy : dy < 0 ? (y0 - ty) / -dy : Infinity;
  let n = Math.abs(ex - tx) + Math.abs(ey - ty);
  while (n-- > 0) {
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      tx += stepX;
    } else {
      tMaxY += tDeltaY;
      ty += stepY;
    }
    if (tx < 0 || ty < 0 || tx >= w || ty >= h || grid[ty * w + tx] === 0) return false;
  }
  return true;
}

/**
 * Segment clear for a body of radius r: checks the centre line and two
 * parallel lines offset by ±0.9 r.
 */
export function segmentClear(grid, w, h, x0, y0, x1, y1, r) {
  if (!lineClear(grid, w, h, x0, y0, x1, y1)) return false;
  if (r <= 0.01) return true;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return true;
  const k = (0.9 * r) / len;
  const nx = -dy * k;
  const ny = dx * k;
  return lineClear(grid, w, h, x0 + nx, y0 + ny, x1 + nx, y1 + ny) && lineClear(grid, w, h, x0 - nx, y0 - ny, x1 - nx, y1 - ny);
}

export class Pathfinder {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    const n = width * height;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.openGen = new Uint32Array(n);
    this.closedGen = new Uint32Array(n);
    this.goalGen = new Uint32Array(n);
    this.gen = 0;
    this.heapIdx = new Int32Array(1 << 14);
    this.heapF = new Float64Array(1 << 14);
    this.heapSize = 0;
  }

  _push(idx, f) {
    if (this.heapSize >= this.heapIdx.length) {
      const ni = new Int32Array(this.heapIdx.length * 2);
      ni.set(this.heapIdx);
      const nf = new Float64Array(this.heapF.length * 2);
      nf.set(this.heapF);
      this.heapIdx = ni;
      this.heapF = nf;
    }
    const hi = this.heapIdx;
    const hf = this.heapF;
    let i = this.heapSize++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      hi[i] = hi[p];
      hf[i] = hf[p];
      i = p;
    }
    hi[i] = idx;
    hf[i] = f;
  }

  _pop() {
    const hi = this.heapIdx;
    const hf = this.heapF;
    const top = hi[0];
    const n = --this.heapSize;
    if (n > 0) {
      const li = hi[n];
      const lf = hf[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lf) break;
        hi[i] = hi[c];
        hf[i] = hf[c];
        i = c;
      }
      hi[i] = li;
      hf[i] = lf;
    }
    return top;
  }

  /**
   * A* search on a passability grid.
   * @param {Uint8Array} grid 1 = passable
   * @param {number} sx start tile x
   * @param {number} sy start tile y
   * @param {{kind:'tile', tx:number, ty:number} | {kind:'rect', x0:number, y0:number, x1:number, y1:number}} goal
   *   rect is an inclusive tile range (a footprint); the goal is any passable tile adjacent to it.
   * @param {number} maxNodes expansion cap
   * @returns {{ tiles: number[], reached: boolean, expanded: number }} tiles from the first step to the end
   */
  search(grid, sx, sy, goal, maxNodes = 12000) {
    const w = this.w;
    const h = this.h;
    if (++this.gen >= 0xfffffff0) {
      this.openGen.fill(0);
      this.closedGen.fill(0);
      this.goalGen.fill(0);
      this.gen = 1;
    }
    const gen = this.gen;
    const g = this.g;
    const parent = this.parent;
    const openGen = this.openGen;
    const closedGen = this.closedGen;
    const goalGen = this.goalGen;
    this.heapSize = 0;

    let gx0;
    let gy0;
    let gx1;
    let gy1;
    let goalIdx = -1;
    const isRect = goal.kind === 'rect';
    if (isRect) {
      gx0 = goal.x0 - 1;
      gy0 = goal.y0 - 1;
      gx1 = goal.x1 + 1;
      gy1 = goal.y1 + 1;
      for (let y = gy0; y <= gy1; y++) {
        for (let x = gx0; x <= gx1; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if (x >= goal.x0 && x <= goal.x1 && y >= goal.y0 && y <= goal.y1) continue;
          const i = y * w + x;
          if (grid[i]) goalGen[i] = gen;
        }
      }
    } else {
      gx0 = gx1 = goal.tx;
      gy0 = gy1 = goal.ty;
      goalIdx = goal.ty * w + goal.tx;
    }
    const heur = (x, y) => {
      const dx = x < gx0 ? gx0 - x : x > gx1 ? x - gx1 : 0;
      const dy = y < gy0 ? gy0 - y : y > gy1 ? y - gy1 : 0;
      return dx > dy ? dx + (SQRT2 - 1) * dy : dy + (SQRT2 - 1) * dx;
    };

    const start = sy * w + sx;
    g[start] = 0;
    parent[start] = -1;
    openGen[start] = gen;
    this._push(start, heur(sx, sy));
    let bestIdx = start;
    let bestH = heur(sx, sy);
    let bestG = 0;
    let expanded = 0;
    let found = -1;

    while (this.heapSize > 0) {
      const cur = this._pop();
      if (closedGen[cur] === gen) continue;
      closedGen[cur] = gen;
      if (isRect ? goalGen[cur] === gen : cur === goalIdx) {
        found = cur;
        break;
      }
      const cx = cur % w;
      const cy = (cur - cx) / w;
      const ch = heur(cx, cy);
      if (ch < bestH || (ch === bestH && g[cur] < bestG)) {
        bestH = ch;
        bestG = g[cur];
        bestIdx = cur;
      }
      if (++expanded >= maxNodes) break;
      const cg = g[cur];
      for (let k = 0; k < 8; k++) {
        const nx = cx + DXS[k];
        const ny = cy + DYS[k];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (grid[ni] === 0 || closedGen[ni] === gen) continue;
        if (k >= 4 && (grid[cy * w + nx] === 0 || grid[ny * w + cx] === 0)) continue; // no corner cutting
        const ng = cg + COSTS[k];
        if (openGen[ni] === gen && ng >= g[ni]) continue;
        openGen[ni] = gen;
        g[ni] = ng;
        parent[ni] = cur;
        this._push(ni, ng + heur(nx, ny));
      }
    }
    const end = found >= 0 ? found : bestIdx;
    const tiles = [];
    for (let i = end; i !== start && i >= 0; i = parent[i]) tiles.push(i);
    tiles.reverse();
    return { tiles, reached: found >= 0, expanded };
  }
}

/**
 * Turn a tile path into smoothed waypoints [x0, y0, x1, y1, ...] (tile centres),
 * removing collinear points and skipping waypoints in line of sight.
 * The last point is replaced by (endX, endY) when given.
 */
export function smoothTilePath(grid, w, h, startX, startY, tiles, r, endX, endY) {
  const pts = [];
  let pdx = 0;
  let pdy = 0;
  for (let i = 0; i < tiles.length; i++) {
    const tx = tiles[i] % w;
    const ty = (tiles[i] - tx) / w;
    if (i > 0 && i < tiles.length) {
      const ptx = tiles[i - 1] % w;
      const pty = (tiles[i - 1] - ptx) / w;
      const dx = tx - ptx;
      const dy = ty - pty;
      if (dx === pdx && dy === pdy && pts.length >= 2) {
        pts[pts.length - 2] = tx + 0.5;
        pts[pts.length - 1] = ty + 0.5;
        continue;
      }
      pdx = dx;
      pdy = dy;
    }
    pts.push(tx + 0.5, ty + 0.5);
  }
  if (endX !== undefined && pts.length >= 2) {
    pts[pts.length - 2] = endX;
    pts[pts.length - 1] = endY;
  }
  const n = pts.length / 2;
  if (n <= 1) return pts;
  const out = [];
  let ax = startX;
  let ay = startY;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && segmentClear(grid, w, h, ax, ay, pts[2 * (j + 1)], pts[2 * (j + 1) + 1], r)) j++;
    out.push(pts[2 * j], pts[2 * j + 1]);
    ax = pts[2 * j];
    ay = pts[2 * j + 1];
    i = j + 1;
  }
  return out;
}

/**
 * Queued path requests processed with a per-tick node budget. Each request
 * writes its result into the unit's movement state (`unit.mv`) if the request
 * is still current (token match).
 */
export class PathService {
  constructor(map, budget = 9000) {
    this.map = map;
    this.finder = new Pathfinder(map.width, map.height);
    this.queue = [];
    this.head = 0;
    this.budget = budget;
    this.token = 0;
    this.stats = { searches: 0, expanded: 0 };
  }

  /**
   * Queue a path for unit u toward its current mv goal.
   * mv.goal: { kind: 'tile' | 'rect', ... } as for Pathfinder.search plus endX/endY for point goals.
   */
  request(u) {
    const mv = u.mv;
    mv.pending = true;
    mv.token = ++this.token;
    this.queue.push(u, mv.token);
  }

  get pendingCount() {
    return (this.queue.length - this.head) / 2;
  }

  /** Process queued requests until the node budget is used. */
  process(getUnit) {
    let spent = 0;
    const q = this.queue;
    while (this.head < q.length && spent < this.budget) {
      const u = q[this.head];
      const token = q[this.head + 1];
      this.head += 2;
      if (u.dead || !u.mv || u.mv.token !== token || !u.mv.pending) continue;
      spent += this.solve(u);
    }
    if (this.head >= q.length) {
      q.length = 0;
      this.head = 0;
    } else if (this.head > 512) {
      this.queue = q.slice(this.head);
      this.head = 0;
    }
    return spent;
  }

  /** Compute the path for u now. Returns nodes expanded. */
  solve(u) {
    const mv = u.mv;
    const map = this.map;
    const w = map.width;
    const h = map.height;
    const sx = Math.min(w - 1, Math.max(0, Math.floor(u.x)));
    const sy = Math.min(h - 1, Math.max(0, Math.floor(u.y)));
    let expanded = 0;
    const tr = u.terrainR;

    // Shared group trunk: reuse a path computed for the group leader when visible.
    const grp = mv.group;
    if (grp && grp.trunk === undefined) {
      grp.trunk = null;
      const lx = Math.floor(grp.sx);
      const ly = Math.floor(grp.sy);
      const gtx = Math.floor(grp.cx);
      const gty = Math.floor(grp.cy);
      if (map.inBounds(lx, ly) && map.inBounds(gtx, gty) && map.pass[gty * w + gtx]) {
        const res = this.finder.search(map.pass, lx, ly, { kind: 'tile', tx: gtx, ty: gty }, 12000);
        expanded += res.expanded;
        this.stats.searches++;
        if (res.reached) grp.trunk = smoothTilePath(map.pass, w, h, grp.sx, grp.sy, res.tiles, 0.4, grp.cx, grp.cy);
      }
    }
    if (grp && grp.trunk && grp.trunk.length >= 2 && !u.big && mv.goal.kind === 'tile') {
      const path = this._fromTrunk(u, grp.trunk, mv.goal.endX, mv.goal.endY);
      if (path) {
        this._assign(u, path, true);
        this.stats.expanded += expanded;
        return expanded + 4;
      }
    }

    let res = null;
    let grid = map.pass;
    if (u.big) {
      res = this.finder.search(map.pass3, sx, sy, mv.goal, 8000);
      expanded += res.expanded;
      grid = map.pass3;
      if (!res.reached) res = null;
    }
    if (!res) {
      grid = map.pass;
      res = this.finder.search(map.pass, sx, sy, mv.goal, mv.goal.cap || 12000);
      expanded += res.expanded;
    }
    this.stats.searches++;
    this.stats.expanded += expanded;
    let path;
    if (res.tiles.length === 0) {
      path = res.reached && mv.goal.kind === 'tile' ? [mv.goal.endX, mv.goal.endY] : [];
    } else {
      const useEnd = res.reached && mv.goal.kind === 'tile';
      path = smoothTilePath(grid, w, h, u.x, u.y, res.tiles, grid === map.pass3 ? 0.4 : tr, useEnd ? mv.goal.endX : undefined, useEnd ? mv.goal.endY : undefined);
      if (!useEnd && mv.goal.kind === 'rect') {
        // Stop at the edge of the adjacent tile closest to the footprint.
        const n = path.length;
        const g = mv.goal;
        const px = path[n - 2];
        const py = path[n - 1];
        const cx = Math.max(g.x0, Math.min(g.x1 + 1, px));
        const cy = Math.max(g.y0, Math.min(g.y1 + 1, py));
        const dx = px - cx;
        const dy = py - cy;
        const d = Math.hypot(dx, dy);
        if (res.reached && d > 0.01) {
          const want = Math.min(d, u.radius + 0.1);
          const nx = cx + (dx / d) * want;
          const ny = cy + (dy / d) * want;
          if (map.isPassable(Math.floor(nx), Math.floor(ny))) {
            path[n - 2] = nx;
            path[n - 1] = ny;
          }
        }
      }
    }
    this._assign(u, path, res.reached);
    return expanded;
  }

  _fromTrunk(u, trunk, endX, endY) {
    const map = this.map;
    const w = map.width;
    const h = map.height;
    const n = trunk.length / 2;
    const tr = u.terrainR;
    // Furthest of the first few trunk waypoints visible from the unit.
    let k = -1;
    const lim = Math.min(n - 1, 3);
    for (let i = lim; i >= 0; i--) {
      if (segmentClear(map.pass, w, h, u.x, u.y, trunk[2 * i], trunk[2 * i + 1], tr)) {
        k = i;
        break;
      }
    }
    if (k < 0) return null;
    const path = [];
    for (let i = k; i < n - 1; i++) path.push(trunk[2 * i], trunk[2 * i + 1]);
    const lx = path.length ? path[path.length - 2] : u.x;
    const ly = path.length ? path[path.length - 1] : u.y;
    if (segmentClear(map.pass, w, h, lx, ly, endX, endY, tr)) {
      path.push(endX, endY);
      return path;
    }
    // Last leg from the trunk end to the unit's own slot.
    const ex = trunk[2 * (n - 1)];
    const ey = trunk[2 * (n - 1) + 1];
    path.push(ex, ey);
    const res = this.finder.search(map.pass, Math.floor(ex), Math.floor(ey), { kind: 'tile', tx: Math.floor(endX), ty: Math.floor(endY) }, 600);
    if (!res.reached) return path;
    const tail = smoothTilePath(map.pass, w, h, ex, ey, res.tiles, tr, endX, endY);
    for (let i = 0; i < tail.length; i++) path.push(tail[i]);
    return path;
  }

  _assign(u, path, reached) {
    const mv = u.mv;
    mv.path = path;
    mv.pi = 0;
    mv.pending = false;
    mv.complete = reached;
    mv.ver = this.map.version;
    if (path.length === 0) mv.arrived = true;
  }
}
