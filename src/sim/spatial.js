// Uniform-grid spatial hash for units, rebuilt once per tick with a counting sort.

export class SpatialHash {
  /**
   * @param {number} width map width in tiles
   * @param {number} height map height in tiles
   * @param {number} [cell] cell size in tiles
   */
  constructor(width, height, cell = 2) {
    this.cell = cell;
    this.cols = Math.ceil(width / cell) + 1;
    this.rows = Math.ceil(height / cell) + 1;
    const n = this.cols * this.rows;
    this.start = new Int32Array(n + 1);
    this.count = new Int32Array(n);
    this.items = [];
    this.cellOf = new Int32Array(64);
  }

  _cellIndex(x, y) {
    let cx = Math.floor(x / this.cell);
    let cy = Math.floor(y / this.cell);
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /** Rebuild from an array of entities with x, y (dead ones skipped). */
  rebuild(units) {
    const n = units.length;
    if (this.cellOf.length < n) this.cellOf = new Int32Array(Math.max(n, this.cellOf.length * 2));
    const count = this.count;
    count.fill(0);
    const cellOf = this.cellOf;
    for (let i = 0; i < n; i++) {
      const u = units[i];
      if (u.dead) {
        cellOf[i] = -1;
        continue;
      }
      const c = this._cellIndex(u.x, u.y);
      cellOf[i] = c;
      count[c]++;
    }
    const start = this.start;
    let acc = 0;
    for (let c = 0; c < count.length; c++) {
      start[c] = acc;
      acc += count[c];
    }
    start[count.length] = acc;
    const items = this.items;
    items.length = acc;
    const fill = count; // reuse as write cursor
    fill.fill(0);
    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      if (c < 0) continue;
      items[start[c] + fill[c]++] = units[i];
    }
  }

  /**
   * Collect entities from all cells overlapping the square around (x, y) with half-size r.
   * Callers filter by exact distance.
   */
  query(x, y, r, out) {
    const cs = this.cell;
    let cx0 = Math.floor((x - r) / cs);
    let cy0 = Math.floor((y - r) / cs);
    let cx1 = Math.floor((x + r) / cs);
    let cy1 = Math.floor((y + r) / cs);
    if (cx0 < 0) cx0 = 0;
    if (cy0 < 0) cy0 = 0;
    if (cx1 >= this.cols) cx1 = this.cols - 1;
    if (cy1 >= this.rows) cy1 = this.rows - 1;
    const start = this.start;
    const items = this.items;
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = row + cx;
        const e = start[c + 1];
        for (let i = start[c]; i < e; i++) out.push(items[i]);
      }
    }
    return out;
  }
}
