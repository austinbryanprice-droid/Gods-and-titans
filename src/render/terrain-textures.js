// Procedural ground textures for the terrain (DESIGN 8), painted once per page
// with typed arrays (no canvas or DOM, so they also build in Node tests):
//
//   ground  DataArrayTexture, one GROUND_SIZE² layer per ground type (LAYER):
//           sRGB albedo in RGB, a height field in A (per-pixel bump lighting
//           and height-based blending between types). Every layer tiles.
//   noise   NOISE_SIZE² RGBA, four independent tileable fbm fields (domain
//           warp of the type borders, macro color variation, anti-tiling).
//   fx      FX_SIZE² RGBA: RG a rippled water height field's slope (x, z),
//           B a caustic network, A foam / sparkle noise.
//
// The pixel data is shared (built on first use); textures wrap it and are
// owned (disposed) by whoever made them.
import * as THREE from 'three';

/** Texture-array layer of each ground type. */
export const LAYER = Object.freeze({ GRASS: 0, DRY: 1, DIRT: 2, SAND: 3, ROCK: 4, FOREST: 5, BED: 6 });
export const LAYER_COUNT = 7;
export const GROUND_SIZE = 256;
export const NOISE_SIZE = 128;
export const FX_SIZE = 256;

// ---------------------------------------------------------------------------
// noise helpers (all periodic over the texture size, so the results tile)
// ---------------------------------------------------------------------------

function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Small deterministic PRNG for scattering strokes and pebbles. */
function rng(seed) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    return (a >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Add amp × periodic value noise (period p lattice cells over the texture) to out. */
function addValueNoise(out, S, p, seed, amp) {
  const lat = new Float32Array(p * p);
  for (let j = 0; j < p; j++) for (let i = 0; i < p; i++) lat[j * p + i] = hash(i, j, seed);
  const x0 = new Int32Array(S);
  const x1 = new Int32Array(S);
  const sx = new Float32Array(S);
  for (let x = 0; x < S; x++) {
    const u = ((x + 0.5) * p) / S;
    const i = Math.floor(u);
    const f = u - i;
    x0[x] = i % p;
    x1[x] = (i + 1) % p;
    sx[x] = f * f * (3 - 2 * f);
  }
  for (let y = 0; y < S; y++) {
    const v = ((y + 0.5) * p) / S;
    const j = Math.floor(v);
    const f = v - j;
    const sy = f * f * (3 - 2 * f);
    const r0 = (j % p) * p;
    const r1 = ((j + 1) % p) * p;
    const row = y * S;
    for (let x = 0; x < S; x++) {
      const a = lat[r0 + x0[x]];
      const b = lat[r0 + x1[x]];
      const c = lat[r1 + x0[x]];
      const d = lat[r1 + x1[x]];
      const top = a + (b - a) * sx[x];
      const bot = c + (d - c) * sx[x];
      out[row + x] += amp * (top + (bot - top) * sy);
    }
  }
}

/** Tileable fbm in [0, 1] (roughly mean 0.5): `oct` octaves from period p. */
function fbm(S, p, oct, seed, gain = 0.5) {
  const out = new Float32Array(S * S);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    addValueNoise(out, S, p << o, seed + o * 101, amp);
    norm += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Stretch a field to span [0, 1]. */
function normalize(a) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < lo) lo = a[i];
    if (a[i] > hi) hi = a[i];
  }
  const k = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * k;
  return a;
}

/**
 * Tileable Worley (cellular) noise with one feature point per cell of an n×n
 * grid: distances (pixels) to the nearest and second nearest point, and the
 * nearest point's cell id.
 */
function worley(S, n, seed, jitter = 1) {
  const f1 = new Float32Array(S * S);
  const f2 = new Float32Array(S * S);
  const id = new Int32Array(S * S);
  const cs = S / n;
  const px = new Float32Array(n * n);
  const py = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      px[j * n + i] = 0.5 + (hash(i, j, seed) - 0.5) * jitter;
      py[j * n + i] = 0.5 + (hash(i, j, seed + 1) - 0.5) * jitter;
    }
  }
  for (let y = 0; y < S; y++) {
    const cy = Math.floor((y + 0.5) / cs);
    for (let x = 0; x < S; x++) {
      const cx = Math.floor((x + 0.5) / cs);
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const nj = cy + dj;
        const wj = ((nj % n) + n) % n;
        for (let di = -1; di <= 1; di++) {
          const ni = cx + di;
          const wi = ((ni % n) + n) % n;
          const k = wj * n + wi;
          const dx = x + 0.5 - (ni + px[k]) * cs;
          const dy = y + 0.5 - (nj + py[k]) * cs;
          const d = dx * dx + dy * dy;
          if (d < d1) {
            d2 = d1;
            d1 = d;
            best = k;
          } else if (d < d2) d2 = d;
        }
      }
      const i = y * S + x;
      f1[i] = Math.sqrt(d1);
      f2[i] = Math.sqrt(d2);
      id[i] = best;
    }
  }
  return { f1, f2, id, cs };
}

// ---------------------------------------------------------------------------
// painting
// ---------------------------------------------------------------------------

/** sRGB hex → [r, g, b] in 0..1 (the layers are painted in display space). */
const C = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

class Canvas {
  constructor(S) {
    this.S = S;
    this.r = new Float32Array(S * S);
    this.g = new Float32Array(S * S);
    this.b = new Float32Array(S * S);
    this.h = new Float32Array(S * S);
  }

  set(i, c) {
    this.r[i] = c[0];
    this.g[i] = c[1];
    this.b[i] = c[2];
  }

  /** Blend color c over pixel i by t, multiplied by k (shade). */
  mix(i, c, t, k = 1) {
    this.r[i] += (c[0] * k - this.r[i]) * t;
    this.g[i] += (c[1] * k - this.g[i]) * t;
    this.b[i] += (c[2] * k - this.b[i]) * t;
  }

  /** Soften the colors (not the height) with a wrap-around [1 2 1] kernel, `passes` times each way. */
  blur(passes = 1) {
    const S = this.S;
    const tmp = new Float32Array(S * S);
    for (const ch of [this.r, this.g, this.b]) {
      for (let p = 0; p < passes; p++) {
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            tmp[y * S + x] = (ch[y * S + ((x + S - 1) % S)] + 2 * ch[y * S + x] + ch[y * S + ((x + 1) % S)]) * 0.25;
          }
        }
        for (let y = 0; y < S; y++) {
          for (let x = 0; x < S; x++) {
            ch[y * S + x] = (tmp[((y + S - 1) % S) * S + x] + 2 * tmp[y * S + x] + tmp[((y + 1) % S) * S + x]) * 0.25;
          }
        }
      }
    }
  }

  /** The same [1 2 1] softening for the height field. */
  blurHeight() {
    const S = this.S;
    const tmp = new Float32Array(S * S);
    const h = this.h;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) tmp[y * S + x] = (h[y * S + ((x + S - 1) % S)] + 2 * h[y * S + x] + h[y * S + ((x + 1) % S)]) * 0.25;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = (tmp[((y + S - 1) % S) * S + x] + 2 * tmp[y * S + x] + tmp[((y + 1) % S) * S + x]) * 0.25;
  }

  scale(i, k) {
    this.r[i] *= k;
    this.g[i] *= k;
    this.b[i] *= k;
  }

  /**
   * A soft, rotated elliptical splat (leaf, pebble, blob) with wrap-around:
   * color blended by `alpha` × coverage, height raised by `lift` × a dome.
   * `shade` darkens the side away from the light (upper left) for a 3-D read.
   */
  splat(cx, cy, rx, ry, ang, col, alpha, lift, shade = 0.18) {
    const S = this.S;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const R = Math.ceil(Math.max(rx, ry)) + 1;
    for (let oy = -R; oy <= R; oy++) {
      for (let ox = -R; ox <= R; ox++) {
        const dx = ox + 0.5 - (cx - Math.floor(cx));
        const dy = oy + 0.5 - (cy - Math.floor(cy));
        const u = (dx * ca + dy * sa) / rx;
        const v = (-dx * sa + dy * ca) / ry;
        const d = u * u + v * v;
        if (d >= 1) continue;
        const x = (((Math.floor(cx) + ox) % S) + S) % S;
        const y = (((Math.floor(cy) + oy) % S) + S) % S;
        const i = y * S + x;
        const cov = smooth(1, 0.55, d);
        const dome = Math.sqrt(1 - d);
        // baked light from the sun's side (texture u = world x, v = world z: the
        // sun is toward -x, +z), so pebbles and leaves read as raised
        const k = 1 + shade * ((dy - dx) / R) * 0.9;
        this.mix(i, col, alpha * cov, k);
        const nh = this.h[i] + (lift * (0.55 + 0.45 * dome) - this.h[i]) * cov;
        if (nh > this.h[i]) this.h[i] = nh;
      }
    }
  }

  /** A thin tapered stroke (grass blade, pine needle), wrap-around; tip color toward `tip`. */
  stroke(x0, y0, ang, len, col, tip, alpha, lift, width = 1) {
    const S = this.S;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const n = Math.max(2, Math.ceil(len * 2));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const c0 = col[0] + (tip[0] - col[0]) * t;
      const c1 = col[1] + (tip[1] - col[1]) * t;
      const c2 = col[2] + (tip[2] - col[2]) * t;
      const a = alpha * (1 - 0.35 * t);
      const hh = lift * (0.55 + 0.45 * t);
      // blades are wider at the root and taper to a point: `width` pixels across at the base
      const w = Math.max(1, Math.round(width * (1 - 0.7 * t)));
      for (let k = 0; k < w; k++) {
        const off = k - (w - 1) / 2;
        const x = ((Math.floor(x0 + dx * len * t - dy * off) % S) + S) % S;
        const y = ((Math.floor(y0 + dy * len * t + dx * off) % S) + S) % S;
        const i = y * S + x;
        this.r[i] += (c0 - this.r[i]) * a;
        this.g[i] += (c1 - this.g[i]) * a;
        this.b[i] += (c2 - this.b[i]) * a;
        if (hh > this.h[i]) this.h[i] = hh;
      }
    }
  }
}

/** Scatter grass blades in tufts: clusters of strokes fanning out from a root. */
function grassBlades(cv, rand, count, palette, tips, lift, spread = 1, width = 1, lenScale = 1) {
  const S = cv.S;
  for (let k = 0; k < count; k++) {
    const x = rand() * S;
    const y = rand() * S;
    const blades = 3 + Math.floor(rand() * 4);
    const base = rand() * Math.PI * 2;
    const col = palette[Math.floor(rand() * palette.length)];
    const tip = tips[Math.floor(rand() * tips.length)];
    for (let b = 0; b < blades; b++) {
      const ang = base + (rand() - 0.5) * 2.2 * spread;
      const len = (3 + rand() * 5) * lenScale;
      cv.stroke(x + (rand() - 0.5) * 2, y + (rand() - 0.5) * 2, ang, len, col, tip, 0.75, lift * (0.75 + rand() * 0.25), width);
    }
  }
}

function paintGrass(cv, seed, dry) {
  const S = cv.S;
  const rand = rng(seed);
  const n1 = fbm(S, 4, 4, seed + 1);
  const n2 = fbm(S, 16, 2, seed + 2);
  const cells = worley(S, 13, seed + 3);
  const dark = C(dry ? 0x6f7346 : 0x3c5c2c);
  const mid = C(dry ? 0x8d915a : 0x55793a);
  const soil = C(dry ? 0x76623f : 0x4a4a2e);
  const tone = C(dry ? 0x9da368 : 0x6a8a44);
  for (let i = 0; i < S * S; i++) {
    const t = clamp01((n1[i] - 0.5) * 0.9 + 0.5 + (n2[i] - 0.5) * 0.7);
    cv.set(i, dark);
    cv.mix(i, mid, t);
    // tufts: lighter toward each cell's middle, darker gaps between them
    const c = 1 - clamp01(cells.f1[i] / (cells.cs * 0.8));
    const ct = hash(cells.id[i], 3, seed);
    cv.mix(i, tone, c * c * (0.25 + 0.3 * ct));
    const gap = 1 - clamp01((cells.f2[i] - cells.f1[i]) / 6);
    cv.mix(i, soil, gap * gap * (dry ? 0.5 : 0.35));
    cv.h[i] = 0.25 + 0.35 * c + 0.1 * n2[i] - 0.15 * gap;
  }
  if (dry) {
    // bare soil showing through in places
    const bare = fbm(S, 8, 3, seed + 4);
    for (let i = 0; i < S * S; i++) {
      const b = smooth(0.58, 0.72, bare[i]);
      if (b > 0) {
        cv.mix(i, soil, b * 0.75);
        cv.h[i] *= 1 - 0.5 * b;
      }
    }
  }
  const palette = dry ? [C(0x898e54), C(0x969a5e), C(0x7d824c)] : [C(0x4a7036), C(0x5a7e3e), C(0x426632)];
  const tips = dry ? [C(0xaeb074), C(0xa4a86c), C(0x9ca266)] : [C(0x8aa05a), C(0x96a862), C(0x7e9652)];
  // the base is a soft carpet; blades on top are a few pixels wide so they read
  // as grass (not 1 px salt and pepper) once the texture is minified on screen
  cv.blur(1);
  grassBlades(cv, rand, dry ? 900 : 1500, palette, tips, 0.9, 1, 2, 1.3);
  cv.blurHeight();
  // a few flowers / seed heads in lush grass, pale stalks in dry
  const dots = dry ? [C(0xd6c98a)] : [C(0xe8e4c8), C(0xe6cf56), C(0xb9a6d8)];
  for (let k = 0; k < (dry ? 90 : 60); k++) {
    cv.splat(rand() * S, rand() * S, 1.1, 1.1, 0, dots[Math.floor(rand() * dots.length)], 0.85, 1, 0.1);
  }
}

function paintDirt(cv, seed) {
  const S = cv.S;
  const rand = rng(seed);
  const n1 = fbm(S, 4, 4, seed + 1);
  const n2 = fbm(S, 16, 3, seed + 2);
  const cracks = worley(S, 7, seed + 3);
  const lo = C(0x6a4e31);
  const hi = C(0x94734b);
  const damp = C(0x4e3a26);
  const crack = C(0x3e2e1f);
  for (let i = 0; i < S * S; i++) {
    const t = clamp01((n1[i] - 0.5) * 1.1 + 0.5);
    cv.set(i, lo);
    cv.mix(i, hi, t);
    cv.mix(i, damp, smooth(0.62, 0.8, n2[i]) * 0.35);
    // fine grain
    cv.scale(i, 0.94 + 0.12 * hash(i, 7, seed));
    const e = 1 - clamp01((cracks.f2[i] - cracks.f1[i]) / 1.6);
    const ce = e * smooth(0.45, 0.7, n2[i]);
    cv.mix(i, crack, ce * 0.6);
    cv.h[i] = 0.3 + 0.25 * t + 0.1 * n2[i] - 0.25 * ce;
  }
  // pebbles and small stones
  const stones = [C(0x8f8574), C(0x7d7262), C(0x9c907c), C(0x6c6152)];
  for (let k = 0; k < 230; k++) {
    const r = 1.5 + rand() * rand() * 3.4;
    cv.splat(rand() * S, rand() * S, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, stones[Math.floor(rand() * stones.length)], 0.78, 0.75 + r * 0.06);
  }
  // trampled grass bits
  grassBlades(cv, rand, 60, [C(0x5a6a2c)], [C(0x7d8a40)], 0.6, 0.7, 2);
}

function paintSand(cv, seed) {
  const S = cv.S;
  const rand = rng(seed);
  const n1 = fbm(S, 4, 4, seed + 1);
  const warp = fbm(S, 4, 3, seed + 2);
  const n3 = fbm(S, 32, 1, seed + 3);
  const patches = fbm(S, 3, 3, seed + 4);
  const lo = C(0xb59d70);
  const hi = C(0xd5c08f);
  const TAU = Math.PI * 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // wind ripples: integer wave vectors keep them tileable, fbm bends them; a
      // main train and a weaker crossing one, both fading in and out in patches
      // so beaches do not read as one striped carpet
      const ph = (TAU * (3 * x + 10 * y)) / S + warp[i] * 9;
      const ph2 = (TAU * (-7 * x + 5 * y)) / S + warp[i] * 6;
      const p = patches[i];
      const rip = Math.sin(ph + 0.6 * Math.sin(ph)) * (0.1 + 0.9 * smooth(0.42, 0.75, p)) + Math.sin(ph2 + 0.5 * Math.sin(ph2)) * 0.35 * (1 - smooth(0.2, 0.42, p));
      const t = clamp01((n1[i] - 0.5) * 1.5 + 0.5);
      cv.set(i, lo);
      cv.mix(i, hi, t);
      cv.scale(i, 1 + 0.025 * rip + 0.07 * (hash(x, y, seed) - 0.5) + 0.04 * (n3[i] - 0.5));
      cv.h[i] = 0.45 + 0.1 * rip + 0.2 * (t - 0.5) + 0.05 * n3[i];
    }
  }
  const bits = [C(0x8f8068), C(0xe8dcc0), C(0x9c8a6a)];
  for (let k = 0; k < 160; k++) {
    const r = 0.8 + rand() * 1.4;
    cv.splat(rand() * S, rand() * S, r, r * 0.8, rand() * 3, bits[Math.floor(rand() * bits.length)], 0.7, 0.75);
  }
}

function paintRock(cv, seed) {
  const S = cv.S;
  const rand = rng(seed);
  const n1 = fbm(S, 4, 5, seed + 1);
  const n2 = fbm(S, 8, 4, seed + 2);
  const slabs = worley(S, 6, seed + 3);
  const small = worley(S, 15, seed + 4);
  const cool = C(0x7c7c78);
  const warm = C(0x948b7c);
  const dark = C(0x3e3b37);
  const lichen = C(0x8f8f4c);
  const ochre = C(0xa08350);
  for (let i = 0; i < S * S; i++) {
    const tone = hash(slabs.id[i], 5, seed);
    cv.set(i, cool);
    cv.mix(i, warm, clamp01(tone * 0.8 + (n1[i] - 0.5)));
    cv.scale(i, 0.86 + 0.24 * n2[i] + 0.06 * (hash(i, 9, seed) - 0.5));
    // slab edges: bevel then a dark crack
    const e = slabs.f2[i] - slabs.f1[i];
    const bevel = smooth(0, 7, e);
    const crack = 1 - smooth(0.4, 2.2, e);
    const e2 = small.f2[i] - small.f1[i];
    const fine = (1 - smooth(0.2, 1.2, e2)) * smooth(0.5, 0.65, n1[i]);
    cv.scale(i, 0.82 + 0.18 * bevel);
    cv.mix(i, dark, crack * 0.85 + fine * 0.4);
    const l = smooth(0.66, 0.78, n2[i] * 0.7 + n1[i] * 0.3) * bevel;
    if (l > 0) cv.mix(i, tone > 0.5 ? lichen : ochre, l * 0.55);
    cv.h[i] = 0.25 + 0.55 * bevel + 0.15 * n2[i] - 0.3 * crack - 0.12 * fine;
  }
  const chips = [C(0x8d8a82), C(0x6f6c66)];
  for (let k = 0; k < 90; k++) {
    const r = 1 + rand() * 2;
    cv.splat(rand() * S, rand() * S, r, r * 0.7, rand() * 3, chips[k & 1], 0.8, 0.7);
  }
}

function paintForest(cv, seed) {
  const S = cv.S;
  const rand = rng(seed);
  const n1 = fbm(S, 4, 4, seed + 1);
  const moss = fbm(S, 6, 3, seed + 2);
  const soil = C(0x3c3222);
  const humus = C(0x4f4029);
  const mossC = C(0x46562a);
  for (let i = 0; i < S * S; i++) {
    cv.set(i, soil);
    cv.mix(i, humus, clamp01((n1[i] - 0.5) * 1.1 + 0.5));
    const m = smooth(0.52, 0.68, moss[i]);
    cv.mix(i, mossC, m * 0.8);
    cv.h[i] = 0.2 + 0.15 * n1[i] + 0.2 * m;
  }
  // leaf litter
  const leaves = [C(0x684a2c), C(0x765a34), C(0x806838), C(0x5c4828), C(0x55562e), C(0x8a7040), C(0x4a3e26)];
  for (let k = 0; k < 2300; k++) {
    const rx = 2 + rand() * 2.4;
    cv.splat(rand() * S, rand() * S, rx, rx * (0.4 + rand() * 0.25), rand() * Math.PI, leaves[Math.floor(rand() * leaves.length)], 0.9, 0.55 + rand() * 0.4, 0.3);
  }
  // pine needles and twigs
  const needles = [C(0x7a5c34), C(0x5e4a2a), C(0x8a6c3e)];
  for (let k = 0; k < 900; k++) {
    const c = needles[Math.floor(rand() * needles.length)];
    cv.stroke(rand() * S, rand() * S, rand() * Math.PI * 2, 4 + rand() * 6, c, c, 0.8, 0.7 + rand() * 0.3);
  }
  // low plants and moss tufts
  grassBlades(cv, rand, 160, [C(0x3f5524)], [C(0x60783a)], 0.85);
}

function paintBed(cv, seed) {
  const S = cv.S;
  const rand = rng(seed);
  const n1 = fbm(S, 4, 4, seed + 1);
  const n2 = fbm(S, 12, 3, seed + 2);
  const silt = C(0x5f5c42);
  const light = C(0x7f785a);
  const algae = C(0x4c5a2e);
  for (let i = 0; i < S * S; i++) {
    cv.set(i, silt);
    cv.mix(i, light, clamp01((n1[i] - 0.5) * 1.2 + 0.5));
    cv.mix(i, algae, smooth(0.6, 0.75, n2[i]) * 0.55);
    cv.scale(i, 0.95 + 0.1 * hash(i, 3, seed));
    cv.h[i] = 0.25 + 0.2 * n1[i] + 0.1 * n2[i];
  }
  const stones = [C(0x857c68), C(0x6c6656), C(0x948a72), C(0x5a5546), C(0x9a9482)];
  for (let k = 0; k < 520; k++) {
    const r = 1.4 + rand() * rand() * 4.2;
    cv.splat(rand() * S, rand() * S, r, r * (0.65 + rand() * 0.35), rand() * Math.PI, stones[Math.floor(rand() * stones.length)], 0.92, 0.7 + r * 0.06, 0.25);
  }
}

const PAINTERS = [
  (cv) => paintGrass(cv, 101, false),
  (cv) => paintGrass(cv, 211, true),
  (cv) => paintDirt(cv, 307),
  (cv) => paintSand(cv, 401),
  (cv) => paintRock(cv, 503),
  (cv) => paintForest(cv, 601),
  (cv) => paintBed(cv, 701),
];

/** RGBA8 pixels of every ground layer, layer after layer (sRGB albedo, height in A). */
function paintGround(S = GROUND_SIZE) {
  const out = new Uint8Array(S * S * 4 * LAYER_COUNT);
  for (let l = 0; l < LAYER_COUNT; l++) {
    const cv = new Canvas(S);
    PAINTERS[l](cv);
    normalize(cv.h);
    const o = l * S * S * 4;
    for (let i = 0; i < S * S; i++) {
      out[o + i * 4] = Math.round(clamp01(cv.r[i]) * 255);
      out[o + i * 4 + 1] = Math.round(clamp01(cv.g[i]) * 255);
      out[o + i * 4 + 2] = Math.round(clamp01(cv.b[i]) * 255);
      out[o + i * 4 + 3] = Math.round(cv.h[i] * 255);
    }
  }
  return out;
}

/** Four independent tileable fbm fields (linear data). */
function paintNoise(S = NOISE_SIZE) {
  const f = [fbm(S, 4, 4, 11), fbm(S, 4, 4, 23), fbm(S, 8, 3, 37), fbm(S, 16, 2, 41)].map(normalize);
  const out = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) for (let c = 0; c < 4; c++) out[i * 4 + c] = Math.round(f[c][i] * 255);
  return out;
}

/** Water ripple slopes (RG), caustic network (B) and foam noise (A). */
function paintFx(S = FX_SIZE) {
  // ripple heights: fbm plus a few tileable sine trains (integer wave vectors)
  const h = fbm(S, 8, 3, 53, 0.45);
  const TAU = Math.PI * 2;
  const waves = [[5, 2, 0.12, 0.3], [-3, 6, 0.1, 1.9], [7, -5, 0.06, 4.1], [2, 9, 0.05, 2.7]];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let s = 0;
      for (const [kx, ky, a, p] of waves) s += a * Math.sin((TAU * (kx * x + ky * y)) / S + p);
      h[y * S + x] += s;
    }
  }
  normalize(h);
  const cells = worley(S, 8, 61, 0.9);
  const foam = fbm(S, 16, 3, 71);
  const bubbles = worley(S, 24, 83);
  const out = new Uint8Array(S * S * 4);
  const slope = S / 40; // slope gain: the steepest ripples reach the ends of the byte range
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const dx = (h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)]) * 0.5;
      const dy = (h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x]) * 0.5;
      out[i * 4] = Math.round(clamp01(0.5 + dx * slope) * 255);
      out[i * 4 + 1] = Math.round(clamp01(0.5 + dy * slope) * 255);
      // caustics: bright, thin cell borders (sharpened F2 - F1)
      const e = (cells.f2[i] - cells.f1[i]) / cells.cs;
      out[i * 4 + 2] = Math.round(Math.pow(1 - smooth(0, 0.3, e), 1.7) * 255);
      // foam: fbm broken into bubbly clumps
      const b = 1 - clamp01(bubbles.f1[i] / (bubbles.cs * 0.55));
      out[i * 4 + 3] = Math.round(clamp01(foam[i] * 0.75 + b * 0.45 - 0.1) * 255);
    }
  }
  return out;
}

let cache = null;

/** The shared pixel data (painted on first call, ~0.2 s). */
export function terrainTextureData() {
  if (!cache) cache = { ground: paintGround(), noise: paintNoise(), fx: paintFx() };
  return cache;
}

function repeatLinear(tex, name, mips = true) {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  tex.generateMipmaps = mips;
  tex.name = name;
  tex.needsUpdate = true;
  return tex;
}

/**
 * New textures over the shared data.
 * @param {number} [anisotropy] ground texture anisotropic filtering
 * @returns {{ ground: THREE.DataArrayTexture, noise: THREE.DataTexture, fx: THREE.DataTexture, dispose: () => void }}
 */
export function createTerrainTextures(anisotropy = 4) {
  const d = terrainTextureData();
  const ground = new THREE.DataArrayTexture(d.ground, GROUND_SIZE, GROUND_SIZE, LAYER_COUNT);
  ground.format = THREE.RGBAFormat;
  ground.type = THREE.UnsignedByteType;
  ground.colorSpace = THREE.SRGBColorSpace;
  ground.anisotropy = anisotropy;
  repeatLinear(ground, 'terrain-ground');
  const noise = new THREE.DataTexture(d.noise, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  noise.colorSpace = THREE.NoColorSpace;
  repeatLinear(noise, 'terrain-noise');
  const fx = new THREE.DataTexture(d.fx, FX_SIZE, FX_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  fx.colorSpace = THREE.NoColorSpace;
  repeatLinear(fx, 'terrain-fx');
  return {
    ground,
    noise,
    fx,
    dispose() {
      ground.dispose();
      noise.dispose();
      fx.dispose();
    },
  };
}
