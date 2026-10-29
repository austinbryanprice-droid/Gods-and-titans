// Coarse grid of the world's buildings, so a search near a point (target acquisition,
// queryRadius) looks at the buildings close by instead of every building in the game.
// Buildings never move, so the grid is rebuilt only when world.buildingList changes (a
// building is placed, or cleanup drops the dead): it remembers the list and its length.
// Lookups give buildings in buildingList order, so callers that keep the first of equally
// good candidates pick the same one as a scan of the whole list.

const CELL = 8; // tiles

class BuildingGrid {
  constructor(width, height) {
    this.cols = Math.ceil(width / CELL) + 1;
    this.rows = Math.ceil(height / CELL) + 1;
    this.start = new Int32Array(this.cols * this.rows + 1);
    this.items = new Int32Array(64); // buildingList indices, grouped by cell
    this.list = null;
    this.n = -1;
    this.seen = new Int32Array(64); // per building index: the query stamp that last took it
    this.stamp = 0;
    this.found = new Int32Array(64);
  }

  _span(v, max) {
    const c = Math.floor(v / CELL);
    return c < 0 ? 0 : c > max ? max : c;
  }

  rebuild(list) {
    const n = list.length;
    const cols = this.cols;
    const cells = cols * this.rows;
    const start = this.start;
    start.fill(0);
    let total = 0;
    // Pass 1: count cells per building (into start[c + 1]), pass 2: prefix sums, pass 3: fill.
    for (let i = 0; i < n; i++) {
      const b = list[i];
      const x0 = this._span(b.tx, cols - 1);
      const x1 = this._span(b.tx + b.size, cols - 1);
      const y0 = this._span(b.ty, this.rows - 1);
      const y1 = this._span(b.ty + b.size, this.rows - 1);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) start[cy * cols + cx + 1]++;
      total += (x1 - x0 + 1) * (y1 - y0 + 1);
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    if (this.items.length < total) this.items = new Int32Array(Math.max(total, this.items.length * 2));
    const fill = new Int32Array(cells);
    const items = this.items;
    for (let i = 0; i < n; i++) {
      const b = list[i];
      const x0 = this._span(b.tx, cols - 1);
      const x1 = this._span(b.tx + b.size, cols - 1);
      const y0 = this._span(b.ty, this.rows - 1);
      const y1 = this._span(b.ty + b.size, this.rows - 1);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const c = cy * cols + cx;
          items[start[c] + fill[c]++] = i;
        }
      }
    }
    if (this.seen.length < n) {
      this.seen = new Int32Array(Math.max(n, this.seen.length * 2));
      this.found = new Int32Array(this.seen.length);
      this.stamp = 0;
    }
    this.list = list;
    this.n = n;
  }

  /** Indices (ascending) of the buildings whose footprint may lie within r of (x, y); returns the count in this.found. */
  query(x, y, r) {
    if (++this.stamp > 0x3fffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const stamp = this.stamp;
    const cols = this.cols;
    const x0 = this._span(x - r, cols - 1);
    const x1 = this._span(x + r, cols - 1);
    const y0 = this._span(y - r, this.rows - 1);
    const y1 = this._span(y + r, this.rows - 1);
    const start = this.start;
    const items = this.items;
    const seen = this.seen;
    const found = this.found;
    let k = 0;
    let sorted = true;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * cols + cx;
        for (let j = start[c], e = start[c + 1]; j < e; j++) {
          const i = items[j];
          if (seen[i] === stamp) continue;
          seen[i] = stamp;
          if (k > 0 && i < found[k - 1]) sorted = false;
          found[k++] = i;
        }
      }
    }
    if (!sorted) found.subarray(0, k).sort(); // typed arrays sort numerically
    return k;
  }
}

/**
 * The buildings (dead ones included, as in buildingList) whose footprint may lie within r of
 * (x, y), in buildingList order, appended to out. A superset: callers test the exact distance.
 */
export function buildingsNear(world, x, y, r, out) {
  const list = world.buildingList;
  const map = world.map;
  if (!map || !(map.width > 0)) {
    for (let i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }
  let g = world._bgrid;
  if (!g) g = world._bgrid = new BuildingGrid(map.width, map.height);
  if (g.list !== list || g.n !== list.length) g.rebuild(list);
  const k = g.query(x, y, r + 0.01);
  const found = g.found;
  for (let j = 0; j < k; j++) out.push(list[found[j]]);
  return out;
}
