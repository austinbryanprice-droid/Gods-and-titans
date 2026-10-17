// Mutable map state for the simulation: terrain, wood, building occupancy and
// the derived ground passability grids used by pathfinding and collision.
import { TERRAIN, TREE_WOOD } from '../config.js';

// Terrain codes a ground unit can walk on (and a building can stand on).
const WALKABLE = new Uint8Array(16);
WALKABLE[TERRAIN.GRASS] = 1;
WALKABLE[TERRAIN.DIRT] = 1;
WALKABLE[TERRAIN.SAND] = 1;

export class MapState {
  /** @param {object} mapData MapData from generateMap (DESIGN 6.7) */
  constructor(mapData) {
    const w = mapData.width;
    const h = mapData.height;
    this.width = w;
    this.height = h;
    this.seed = mapData.seed;
    this.terrain = Uint8Array.from(mapData.terrain);
    if (mapData.wood && mapData.wood.length === w * h) this.wood = Uint16Array.from(mapData.wood);
    else {
      this.wood = new Uint16Array(w * h);
      for (let i = 0; i < w * h; i++) if (this.terrain[i] === TERRAIN.FOREST) this.wood[i] = TREE_WOOD;
    }
    // A forest tile with no wood is not a tree.
    for (let i = 0; i < w * h; i++) {
      if (this.terrain[i] === TERRAIN.FOREST && this.wood[i] === 0) this.terrain[i] = TERRAIN.GRASS;
    }
    this.occ = new Int32Array(w * h); // entity id of the building / mine standing on the tile
    this.pass = new Uint8Array(w * h); // 1 = ground passable now
    this.pass3 = new Uint8Array(w * h); // 1 = the tile and its 8 neighbours are passable (big units)
    this.version = 0; // bumped whenever passability changes
    this.updateRegion(0, 0, w - 1, h - 1);
  }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  /** Ground passable: walkable terrain with no building or mine on it. */
  isPassable(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height && this.pass[ty * this.width + tx] === 1;
  }

  /** Terrain allows building and nothing stands there. */
  isBuildable(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const i = ty * this.width + tx;
    return WALKABLE[this.terrain[i]] === 1 && this.occ[i] === 0;
  }

  isWalkableTerrain(tx, ty) {
    return this.inBounds(tx, ty) && WALKABLE[this.terrain[ty * this.width + tx]] === 1;
  }

  isForest(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const i = ty * this.width + tx;
    return this.terrain[i] === TERRAIN.FOREST && this.wood[i] > 0;
  }

  woodAt(tx, ty) {
    if (!this.inBounds(tx, ty)) return 0;
    const i = ty * this.width + tx;
    return this.terrain[i] === TERRAIN.FOREST ? this.wood[i] : 0;
  }

  /** A tree a worker can stand next to (some 8-neighbour is ground passable). */
  isTreeAccessible(tx, ty) {
    if (!this.isForest(tx, ty)) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && this.isPassable(tx + dx, ty + dy)) return true;
      }
    }
    return false;
  }

  /**
   * Nearest forest tile to a point.
   * @param {number} x
   * @param {number} y
   * @param {number} [maxR] search radius in tiles
   * @param {boolean} [accessibleOnly] only trees with a walkable neighbour
   * @returns {{tx:number, ty:number}|null}
   */
  nearestForest(x, y, maxR = 12, accessibleOnly = false) {
    const pred = accessibleOnly ? (tx, ty) => this.isTreeAccessible(tx, ty) : (tx, ty) => this.isForest(tx, ty);
    return this.spiralNearest(x, y, maxR, pred);
  }

  /** Nearest ground passable tile to a point (optionally using the big-unit grid). */
  nearestPassable(x, y, maxR = 12, big = false) {
    const grid = big ? this.pass3 : this.pass;
    const w = this.width;
    return this.spiralNearest(x, y, maxR, (tx, ty) => grid[ty * w + tx] === 1);
  }

  /** Generic ring search returning the tile (by euclidean distance from tile centre to (x, y)) matching pred. */
  spiralNearest(x, y, maxR, pred) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let best = null;
    let bestD = Infinity;
    for (let r = 0; r <= maxR; r++) {
      if (best && (r - 1) * (r - 1) > bestD) break;
      const y0 = cy - r;
      const y1 = cy + r;
      for (let ty = y0; ty <= y1; ty++) {
        if (ty < 0 || ty >= this.height) continue;
        const edgeRow = ty === y0 || ty === y1;
        const step = edgeRow ? 1 : 2 * r;
        for (let tx = cx - r; tx <= cx + r; tx += step || 1) {
          if (tx < 0 || tx >= this.width) continue;
          if (!pred(tx, ty)) continue;
          const dx = tx + 0.5 - x;
          const dy = ty + 0.5 - y;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { tx, ty };
          }
        }
      }
    }
    return best;
  }

  /** Mark a footprint as occupied by entity id (0 clears). */
  setOccupied(tx, ty, size, id) {
    const w = this.width;
    for (let y = ty; y < ty + size; y++) {
      for (let x = tx; x < tx + size; x++) {
        if (this.inBounds(x, y)) this.occ[y * w + x] = id;
      }
    }
    this.updateRegion(tx, ty, tx + size - 1, ty + size - 1);
  }

  /**
   * Remove wood from a tree. Returns { taken, felled }.
   * A depleted tree becomes grass and its tile passable.
   */
  takeWood(tx, ty, amount) {
    if (!this.isForest(tx, ty)) return { taken: 0, felled: false };
    const i = ty * this.width + tx;
    const taken = Math.min(amount, this.wood[i]);
    this.wood[i] -= taken;
    if (this.wood[i] === 0) {
      this.fellTree(tx, ty);
      return { taken, felled: true };
    }
    return { taken, felled: false };
  }

  fellTree(tx, ty) {
    const i = ty * this.width + tx;
    this.terrain[i] = TERRAIN.GRASS;
    this.wood[i] = 0;
    this.updateRegion(tx, ty, tx, ty);
  }

  /** Recompute passability for a tile rectangle (inclusive). */
  updateRegion(x0, y0, x1, y1) {
    const w = this.width;
    const h = this.height;
    const ax = Math.max(0, x0);
    const ay = Math.max(0, y0);
    const bx = Math.min(w - 1, x1);
    const by = Math.min(h - 1, y1);
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) {
        const i = y * w + x;
        this.pass[i] = WALKABLE[this.terrain[i]] === 1 && this.occ[i] === 0 ? 1 : 0;
      }
    }
    const cx0 = Math.max(0, x0 - 1);
    const cy0 = Math.max(0, y0 - 1);
    const cx1 = Math.min(w - 1, x1 + 1);
    const cy1 = Math.min(h - 1, y1 + 1);
    for (let y = cy0; y <= cy1; y++) {
      for (let x = cx0; x <= cx1; x++) {
        let ok = 1;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) ok = 0;
        else {
          for (let dy = -1; dy <= 1 && ok; dy++) {
            const row = (y + dy) * w;
            for (let dx = -1; dx <= 1; dx++) {
              if (this.pass[row + x + dx] === 0) { ok = 0; break; }
            }
          }
        }
        this.pass3[y * w + x] = ok;
      }
    }
    this.version++;
  }
}
