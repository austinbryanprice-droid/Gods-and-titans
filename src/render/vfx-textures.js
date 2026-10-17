// Procedural textures for the VFX system (no image assets): one 4×2 atlas of
// particle sprites. In the browser the atlas is a CanvasTexture whose glow cell
// is a canvas radial gradient; in Node (tests) the same pixels go into a
// DataTexture. Image row 0 is the top of a sprite (flipY = false), so a cell's
// uv is ((col + pc.x) / 4, (row + pc.y) / 2) with pc = gl_PointCoord.
import * as THREE from 'three';

/** Atlas cell indices (particle `cell` values). */
export const CELL = { GLOW: 0, STAR: 1, SMOKE: 2, SPARK: 3, RING: 4, SHARD: 5, PLUS: 6, FLAME: 7 };

const CELL_PX = 128;
const COLS = 4;
const ROWS = 2;
export const ATLAS_W = CELL_PX * COLS;
export const ATLAS_H = CELL_PX * ROWS;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x, y) {
  return vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.3 + vnoise(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.15;
}

// Irregular convex polygon for the debris shard (radius per vertex).
const SHARD = [0.82, 0.62, 0.9, 0.7, 0.86, 0.58];

/**
 * Luminance and alpha of one atlas cell at (u, v) ∈ [-1, 1]² (v down).
 * @returns {number} packed: lum in out[0], alpha in out[1]
 */
function cellPixel(cell, u, v, out) {
  const d = Math.sqrt(u * u + v * v);
  let lum = 1;
  let a = 0;
  switch (cell) {
    case CELL.GLOW:
      a = Math.exp(-d * d * 4.2) * (1 - smooth(0.7, 1, d));
      break;
    case CELL.STAR: {
      const arms = Math.exp(-Math.abs(u) * 16 - v * v * 2.6) + Math.exp(-Math.abs(v) * 16 - u * u * 2.6);
      const diag = 0.35 * (Math.exp(-Math.abs(u + v) * 22 - (u - v) * (u - v) * 7) + Math.exp(-Math.abs(u - v) * 22 - (u + v) * (u + v) * 7));
      a = Math.min(1, (arms + diag) * (1 - smooth(0.6, 1, d)) + Math.exp(-d * d * 18) * 0.9);
      break;
    }
    case CELL.SMOKE: {
      const n = fbm(u * 2.2 + 3, v * 2.2 + 3);
      const edge = 1 - smooth(0.25 + n * 0.35, 1, d);
      a = edge * (0.45 + 0.55 * n);
      lum = 0.72 + 0.28 * clamp01(0.6 - v * 0.5 + (n - 0.5) * 0.6);
      break;
    }
    case CELL.SPARK:
      a = Math.min(1, Math.exp(-d * d * 30) + 0.4 * Math.exp(-d * d * 6)) * (1 - smooth(0.8, 1, d));
      break;
    case CELL.RING:
      a = Math.exp(-(((d - 0.74) / 0.11) ** 2)) * (1 - smooth(0.92, 1, d));
      break;
    case CELL.SHARD: {
      const ang = Math.atan2(v, u);
      const k = ((ang + Math.PI) / (Math.PI * 2)) * SHARD.length;
      const i0 = Math.floor(k) % SHARD.length;
      const i1 = (i0 + 1) % SHARD.length;
      const f = k - Math.floor(k);
      const rad = SHARD[i0] + (SHARD[i1] - SHARD[i0]) * f;
      a = 1 - smooth(rad - 0.08, rad, d);
      lum = u + v * 0.3 > 0 ? 1 : 0.62; // two facets
      lum *= 0.85 + 0.15 * (1 - d);
      break;
    }
    case CELL.PLUS: {
      const bar = (p, q) => (1 - smooth(0.14, 0.24, Math.abs(p))) * (1 - smooth(0.62, 0.74, Math.abs(q)));
      a = Math.min(1, Math.max(bar(u, v), bar(v, u)) + 0.35 * Math.exp(-d * d * 3.5) * (1 - smooth(0.7, 1, d)));
      break;
    }
    case CELL.FLAME: {
      // teardrop pointing up (v = -1 top)
      const t = clamp01((v + 1) / 1.7);
      const w = 0.12 + 0.48 * Math.sqrt(t);
      const dd = Math.sqrt((u / w) ** 2 + ((v - 0.25) / 0.72) ** 2);
      const n = fbm(u * 3 + 11, v * 3 + 4);
      a = (1 - smooth(0.55, 1, dd + (n - 0.5) * 0.25)) * (0.55 + 0.45 * t);
      lum = 0.75 + 0.25 * t;
      break;
    }
    default:
      a = 0;
  }
  out[0] = clamp01(lum);
  out[1] = clamp01(a);
}

/**
 * RGBA pixels of the whole atlas (row 0 = top).
 * @returns {Uint8Array}
 */
export function buildAtlasPixels() {
  const px = new Uint8Array(ATLAS_W * ATLAS_H * 4);
  const out = [0, 0];
  for (let cell = 0; cell < COLS * ROWS; cell++) {
    const ox = (cell % COLS) * CELL_PX;
    const oy = Math.floor(cell / COLS) * CELL_PX;
    for (let y = 0; y < CELL_PX; y++) {
      for (let x = 0; x < CELL_PX; x++) {
        const u = ((x + 0.5) / CELL_PX) * 2 - 1;
        const v = ((y + 0.5) / CELL_PX) * 2 - 1;
        cellPixel(cell, u, v, out);
        const i = ((oy + y) * ATLAS_W + ox + x) * 4;
        const l = Math.round(out[0] * 255);
        px[i] = l;
        px[i + 1] = l;
        px[i + 2] = l;
        px[i + 3] = Math.round(out[1] * 255);
      }
    }
  }
  return px;
}

/**
 * The particle atlas texture.
 * @returns {THREE.Texture}
 */
export function makeAtlasTexture() {
  const px = buildAtlasPixels();
  let tex;
  if (typeof document !== 'undefined' && typeof ImageData !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_W;
    canvas.height = ATLAS_H;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), ATLAS_W, ATLAS_H), 0, 0);
    // Glow cell: a real radial gradient (soft halo, hot centre).
    const c = CELL_PX / 2;
    ctx.clearRect(0, 0, CELL_PX, CELL_PX);
    const g = ctx.createRadialGradient(c, c, 0, c, c, c - 1);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.88)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CELL_PX, CELL_PX);
    tex = new THREE.CanvasTexture(canvas);
  } else {
    tex = new THREE.DataTexture(px, ATLAS_W, ATLAS_H, THREE.RGBAFormat);
    tex.generateMipmaps = true;
  }
  tex.flipY = false;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
