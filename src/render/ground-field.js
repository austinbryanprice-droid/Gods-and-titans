// The ground the player sees (DESIGN 8): a smooth height field over the map, sampled
// FIELD_RES times per tile, built from the sim's cosmetic vertex heights (which stay
// as they are) and shared by everything that stands on the ground (heightAt), by the
// terrain mesh and by the water mesh, so units, trees, stones, the lake surface and
// the ground agree to the last sample.
//
//   - The sim heights are interpolated with a Catmull-Rom surface: it passes through
//     every vertex height and its slope is continuous across tile edges (no creases,
//     so no tile-sized facets in the light).
//   - Shorelines are rebuilt from a smoothed signed distance to the water tiles: the
//     boxy tile outline becomes a rounded, wobbling coast (corners round off, the
//     edge meanders by a third of a tile), with a gentle beach on the land side and
//     a shallow shelf that deepens into the lake. Tiles stay what the sim says they
//     are; the coast only moves by a fraction of a tile.
//   - Impassable rock tiles rise into sandstone outcrops: steep walls, a flat
//     craggy top and a hint of a ledge every STRATA_STEP. Nothing walks there, so
//     the sim never notices; boulders and the camera follow through heightAt.
//
// Besides the heights it keeps what the ground shader needs per sample: the signed
// shore distance (tiles, + on land), the outcrop rise, a smoothed forest share and a
// cavity term (blurred height minus height: dark in hollows and at cliff feet, light
// on crests). Pure typed arrays, no three.js: it also builds in Node tests.
import { TERRAIN } from '../config.js';

/** Water surface height (notes/decisions.md [map]: the sim's water edge sits about here). */
export const WATER_LEVEL = -0.2;
/** Field samples per tile, each way. */
export const FIELD_RES = 4;
/** Height of one sandstone ledge on an outcrop. */
export const STRATA_STEP = 0.25;
/** How much of the staircase the outcrop keeps (0 smooth, 1 full ledges). */
export const STRATA_AMOUNT = 0.3;
/** Outcrop rise that the data texture maps to 1. */
export const RISE_MAX = 1.2;
/** Range of the shore distance the data texture can hold (tiles). */
export const SHORE_MIN = -3;
export const SHORE_MAX = 5;
/** Shore distance reported on maps without water. */
const FAR = 60;
/** Where the waterline sits relative to the tile edge of the water (tiles, onto the land). */
const SHORE_OFFSET = 0.12;

const R = FIELD_RES;

function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, s) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, s);
  const b = hash2(x0 + 1, y0, s);
  const c = hash2(x0, y0 + 1, s);
  const d = hash2(x0 + 1, y0 + 1, s);
  return a + (b - a) * sx + (c - a + (d - c - b + a) * sx) * sy;
}

/** Two octaves of value noise at world point (x, y) in tiles, 0..1 around 0.5. */
function wobble(x, y, seed, scale) {
  return vnoise(x / (5.5 * scale), y / (5.5 * scale), seed) * 0.68 + vnoise(x / (2.3 * scale), y / (2.3 * scale), seed + 1) * 0.32;
}

const smooth01 = (a, b, v) => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// grid helpers
// ---------------------------------------------------------------------------

/** Squared Euclidean distance (cells) from every cell to the nearest `on` cell (Felzenszwalb and Huttenlocher). */
function edt2(on, nx, ny) {
  const INF = 1e20;
  const n = Math.max(nx, ny);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const out = new Float32Array(nx * ny);
  for (let i = 0; i < out.length; i++) out[i] = on[i] ? 0 : INF;
  const pass = (len) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) f[y] = out[y * nx + x];
    pass(ny);
    for (let y = 0; y < ny; y++) out[y * nx + x] = d[y];
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) f[x] = out[y * nx + x];
    pass(nx);
    for (let x = 0; x < nx; x++) out[y * nx + x] = d[x];
  }
  return out;
}

/** In place box blur of half width m (clamped edges), `passes` times each way (three of them read as a Gaussian). */
function blur(a, nx, ny, m, passes = 3) {
  const tmp = new Float32Array(Math.max(nx, ny));
  const inv = 1 / (2 * m + 1);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < ny; y++) {
      const o = y * nx;
      let sum = 0;
      for (let k = -m; k <= m; k++) sum += a[o + Math.min(nx - 1, Math.max(0, k))];
      for (let x = 0; x < nx; x++) {
        tmp[x] = sum * inv;
        sum += a[o + Math.min(nx - 1, x + m + 1)] - a[o + Math.max(0, x - m)];
      }
      for (let x = 0; x < nx; x++) a[o + x] = tmp[x];
    }
    for (let x = 0; x < nx; x++) {
      let sum = 0;
      for (let k = -m; k <= m; k++) sum += a[Math.min(ny - 1, Math.max(0, k)) * nx + x];
      for (let y = 0; y < ny; y++) {
        tmp[y] = sum * inv;
        sum += a[Math.min(ny - 1, y + m + 1) * nx + x] - a[Math.max(0, y - m) * nx + x];
      }
      for (let y = 0; y < ny; y++) a[y * nx + x] = tmp[y];
    }
  }
  return a;
}

/** Signed distance (cells; + inside the mask, - outside) of a cell mask: distance to the boundary line. */
function signedDistance(mask, nx, ny) {
  let inside = 0;
  for (let i = 0; i < mask.length; i++) inside += mask[i];
  const out = new Float32Array(nx * ny);
  if (inside === 0) return out.fill(-FAR * R);
  if (inside === mask.length) return out.fill(FAR * R);
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const toMask = edt2(mask, nx, ny); // distance of every cell to the mask
  const toRest = edt2(inv, nx, ny); // ... and to the rest
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? Math.sqrt(toRest[i]) - 0.5 : -(Math.sqrt(toMask[i]) - 0.5);
  return out;
}

/** Cell grid value → corner (sample) grid value: the mean of the (up to) four cells around a sample. */
function cellsToSamples(cells, cw, ch) {
  const nx = cw + 1;
  const ny = ch + 1;
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const j0 = Math.max(0, j - 1);
    const j1 = Math.min(ch - 1, j);
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(cw - 1, i);
      out[j * nx + i] = (cells[j0 * cw + i0] + cells[j0 * cw + i1] + cells[j1 * cw + i0] + cells[j1 * cw + i1]) * 0.25;
    }
  }
  return out;
}

// Catmull-Rom weights for the four taps around a fractional position t (0 at the second tap)
function crWeights(t, w) {
  const t2 = t * t;
  const t3 = t2 * t;
  w[0] = -0.5 * t3 + t2 - 0.5 * t;
  w[1] = 1.5 * t3 - 2.5 * t2 + 1;
  w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  w[3] = 0.5 * t3 - 0.5 * t2;
}

// ---------------------------------------------------------------------------
// the field
// ---------------------------------------------------------------------------

export class GroundField {
  /**
   * @param {object} map mapData (width, height, terrain, heights, seed)
   */
  constructor(map) {
    const W = map.width;
    const H = map.height ?? map.width;
    const V = W + 1;
    // a map without heights is flat ground at 0 (stand-in maps in tests and tools)
    const hs = map.heights || new Float32Array(V * (H + 1));
    const T = map.terrain;
    const seed = (Number(map.seed) | 0) || 7;
    this.map = map;
    this.srcHeights = map.heights; // as given (undefined for a flat stand-in), so groundField() can tell it is the same map
    this.srcTerrain = T;
    this.width = W;
    this.height = H;
    const cw = W * R;
    const ch = H * R;
    const nx = cw + 1;
    const ny = ch + 1;
    this.nx = nx;
    this.ny = ny;

    // ---- cell masks (cell (cx, cy) covers world [cx / R, (cx + 1) / R])
    const water = new Uint8Array(cw * ch);
    const rock = new Uint8Array(cw * ch);
    const forest = new Float32Array(cw * ch);
    const wetVertex = new Uint8Array(V * (H + 1));
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        const t = T ? T[ty * W + tx] : TERRAIN.GRASS;
        if (t === TERRAIN.WATER) {
          wetVertex[ty * V + tx] = wetVertex[ty * V + tx + 1] = wetVertex[(ty + 1) * V + tx] = wetVertex[(ty + 1) * V + tx + 1] = 1;
        }
        if (t !== TERRAIN.WATER && t !== TERRAIN.ROCK && t !== TERRAIN.FOREST) continue;
        for (let cy = ty * R; cy < (ty + 1) * R; cy++) {
          for (let cx = tx * R; cx < (tx + 1) * R; cx++) {
            const i = cy * cw + cx;
            if (t === TERRAIN.WATER) water[i] = 1;
            else if (t === TERRAIN.ROCK) rock[i] = 1;
            else forest[i] = 1;
          }
        }
      }
    }

    // ---- shoreline: smoothed signed distance to the water (+ inside the water), wobbled,
    // turned around so that it reads + on land
    const sdWater = signedDistance(water, cw, ch);
    blur(sdWater, cw, ch, 3);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const i = cy * cw + cx;
        const x = (cx + 0.5) / R;
        const y = (cy + 0.5) / R;
        sdWater[i] = -sdWater[i] / R - SHORE_OFFSET + (wobble(x, y, seed + 11, 1) - 0.5) * 0.7;
      }
    }
    const shore = cellsToSamples(sdWater, cw, ch);

    // ---- outcrops: rise above the ground over the rock tiles
    const sdRock = signedDistance(rock, cw, ch);
    blur(sdRock, cw, ch, 1, 2); // light: a heavier blur would level a tile-wide strip of rock
    const riseCells = new Float32Array(cw * ch);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        const i = cy * cw + cx;
        if (sdRock[i] < -2 * R) continue; // far from any rock
        const x = (cx + 0.5) / R;
        const y = (cy + 0.5) / R;
        const sd = sdRock[i] / R + (wobble(x, y, seed + 23, 0.45) - 0.5) * 0.5;
        // a steep wall around a nearly level, craggy top; rock patches are small (a tile wide
        // strip is common), so even a thin one stands well clear of the meadow
        const face = smooth01(-0.1, 0.05, sd);
        if (face <= 0) continue;
        // (no dome: a rise that grows with the distance from the edge folds into a crease where
        // the two sides of a thin patch meet)
        const crag = 0.66 + 0.68 * wobble(x, y, seed + 29, 0.3) + 0.14 * (wobble(x, y, seed + 31, 0.12) - 0.5);
        const r0 = Math.min(RISE_MAX - 0.02, 0.72 * face * crag);
        // only a hint of ledges: a full staircase over a small mound reads as tree rings
        const tt = r0 / STRATA_STEP;
        const k = Math.floor(tt);
        riseCells[i] = r0 + STRATA_AMOUNT * ((k + smooth01(0.3, 0.7, tt - k)) * STRATA_STEP - r0);
      }
    }
    const rise = cellsToSamples(riseCells, cw, ch);

    // ---- smooth surface through the sim heights (shore vertices stand in for the bank)
    const land = new Float32Array(V * (H + 1));
    for (let i = 0; i < land.length; i++) land[i] = wetVertex[i] ? -0.05 : hs[i];
    const hgt = new Float32Array(nx * ny);
    const wx = new Float64Array(4);
    const wy = new Float64Array(4);
    const wxs = [];
    for (let f = 0; f < R; f++) {
      const w = new Float64Array(4);
      crWeights(f / R, w);
      wxs.push(w);
    }
    const tap = (vx, vy) => land[Math.min(H, Math.max(0, vy)) * V + Math.min(W, Math.max(0, vx))];
    for (let j = 0; j < ny; j++) {
      const vy = Math.floor(j / R);
      wy.set(wxs[j % R]);
      for (let i = 0; i < nx; i++) {
        const vx = Math.floor(i / R);
        wx.set(wxs[i % R]);
        let sum = 0;
        for (let b = 0; b < 4; b++) {
          let row = 0;
          for (let a = 0; a < 4; a++) row += wx[a] * tap(vx - 1 + a, vy - 1 + b);
          sum += wy[b] * row;
        }
        const k = j * nx + i;
        const s = shore[k];
        let h;
        if (s > 0) {
          // beach: climbs from the waterline, then hands over to the sim's land height
          const bank = WATER_LEVEL + 0.17 * (1 - Math.exp(-s / 0.75));
          const t = smooth01(0.4, 3.2, s);
          h = bank * (1 - t) + Math.max(sum, bank) * t;
        } else {
          // shelf: shallow along the shore, deeper out in the lake
          h = WATER_LEVEL - 0.4 * (1 - Math.exp(s / 1.7));
        }
        hgt[k] = h + rise[k];
      }
    }

    // ---- extremes, forest share, cavity
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < hgt.length; i++) {
      if (hgt[i] < lo) lo = hgt[i];
      if (hgt[i] > hi) hi = hgt[i];
    }
    this.hMin = lo;
    this.hMax = hi;
    this.hgt = hgt;
    this.shore = shore;
    this.rise = rise;
    blur(forest, cw, ch, 3);
    this.forest = cellsToSamples(forest, cw, ch);
    const smoothH = Float32Array.from(hgt);
    blur(smoothH, nx, ny, 10);
    const cav = new Float32Array(nx * ny);
    for (let i = 0; i < cav.length; i++) cav[i] = Math.max(-1, Math.min(1, (smoothH[i] - hgt[i]) * 5));
    this.cavity = cav;
  }

  /** Ground height at world point (x, y) in tiles (bilinear on the field; clamped to the map). */
  heightAt(x, y) {
    return this.sample(this.hgt, x, y);
  }

  /** Bilinear sample of any per-sample array (hgt, shore, rise, forest, cavity). */
  sample(arr, x, y) {
    const nx = this.nx;
    const fx = (x > 0 ? (x < this.width ? x : this.width) : 0) * R;
    const fy = (y > 0 ? (y < this.height ? y : this.height) : 0) * R;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    if (i > nx - 2) i = nx - 2;
    if (j > this.ny - 2) j = this.ny - 2;
    const tx = fx - i;
    const ty = fy - j;
    const k = j * nx + i;
    const top = arr[k] + (arr[k + 1] - arr[k]) * tx;
    const bot = arr[k + nx] + (arr[k + nx + 1] - arr[k + nx]) * tx;
    return top + (bot - top) * ty;
  }

  /**
   * Unit surface normal at sample (i, j), from central differences of the field.
   * @param {number[]|Float32Array} out receives x, y, z at offset `o`
   */
  normalAt(i, j, out, o = 0) {
    const nx = this.nx;
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(nx - 1, i + 1);
    const j0 = Math.max(0, j - 1);
    const j1 = Math.min(this.ny - 1, j + 1);
    const dx = ((this.hgt[j * nx + i1] - this.hgt[j * nx + i0]) * R) / (i1 - i0);
    const dz = ((this.hgt[j1 * nx + i] - this.hgt[j0 * nx + i]) * R) / (j1 - j0);
    const l = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
    out[o] = -dx * l;
    out[o + 1] = l;
    out[o + 2] = -dz * l;
  }

  /** RGBA8 per sample for the ground shader: shore distance, outcrop rise, forest share, cavity. */
  dataBytes() {
    const n = this.nx * this.ny;
    const out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      out[i * 4] = Math.round(Math.min(1, Math.max(0, (this.shore[i] - SHORE_MIN) / (SHORE_MAX - SHORE_MIN))) * 255);
      out[i * 4 + 1] = Math.round(Math.min(1, this.rise[i] / RISE_MAX) * 255);
      out[i * 4 + 2] = Math.round(Math.min(1, Math.max(0, this.forest[i])) * 255);
      out[i * 4 + 3] = Math.round((this.cavity[i] * 0.5 + 0.5) * 255);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// lookup (cached per map)
// ---------------------------------------------------------------------------

const FIELDS = new WeakMap();
let lastMap = null;
let lastField = null;

/**
 * The ground field of a map, built on first use and shared after that. Null for
 * something that is not a map.
 * @param {object} map mapData
 * @returns {GroundField|null}
 */
export function groundField(map) {
  if (map && map === lastMap && lastField && lastField.srcHeights === map.heights && lastField.srcTerrain === map.terrain) return lastField;
  if (!map || !(map.width > 0)) return null;
  let f = FIELDS.get(map);
  if (!f || f.srcHeights !== map.heights || f.srcTerrain !== map.terrain) {
    f = new GroundField(map);
    FIELDS.set(map, f);
  }
  lastMap = map;
  lastField = f;
  return f;
}
