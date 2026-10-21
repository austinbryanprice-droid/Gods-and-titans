// Procedural leaf and needle textures for the foliage shader (foliage-shader.js).
//
//   const leaf = leafTexture();       // shared DataTexture: R brightness (0..1.3), G warmth, A leaf coverage
//
// The look of a tree up close is made of small things: leaves overlapping like scales, dark gaps
// between them, a lighter tip on each. A few hundred ellipses painted once at startup (seeded, so
// every client builds the same pixels) and mipmapped replace a stack of noise evaluations per
// fragment: far away the leaves average out to a soft green, close up they read as leaves.
import * as THREE from 'three';
import { RNG } from '../../sim/rng.js';

/** Edge length of the leaf texture, texels. */
const LEAF_SIZE = 128;

/** Smooth tileable value noise on a g × g lattice (0..1). */
function latticeNoise(g, rng) {
  const v = new Float32Array(g * g);
  for (let i = 0; i < v.length; i++) v[i] = rng.next();
  return (x, y) => {
    const fx = (x - Math.floor(x)) * g;
    const fy = (y - Math.floor(y)) * g;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (ix, iy) => v[(((iy % g) + g) % g) * g + (((ix % g) + g) % g)];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/**
 * RGBA texels of the leaf texture: pointed leaves scattered over a dark ground, each with its
 * own brightness and warmth, a lighter tip, a darker midrib and an anti-aliased edge. Tiles.
 * @returns {Uint8Array}
 */
export function leafTexels(size = LEAF_SIZE) {
  const W = size;
  const s = W / LEAF_SIZE;
  const lum = new Float32Array(W * W).fill(0.2); // the gaps between leaves
  const warm = new Float32Array(W * W).fill(0.4);
  const cov = new Float32Array(W * W);
  const rng = new RNG(4242);
  const count = Math.round(118 * s * s);
  for (let i = 0; i < count; i++) {
    const cx = rng.next() * W;
    const cy = rng.next() * W;
    const ang = rng.next() * Math.PI * 2;
    const hl = (8.5 + rng.next() * 6.5) * s; // half length, texels
    const hw = hl * (0.4 + rng.next() * 0.12); // half width
    const base = 0.52 + 0.5 * Math.pow(rng.next(), 0.8);
    const hue = rng.next();
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const r = Math.ceil(hl) + 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        // leaf frame: u along the axis (-1 stem … 1 tip), v across (texels)
        const u = (dx * ca + dy * sa) / hl;
        if (u <= -1 || u >= 1) continue;
        const v = -dx * sa + dy * ca;
        const wu = Math.pow(1 - u * u, 0.8) * (1 - 0.25 * u) * hw;
        const f = Math.abs(v) / Math.max(wu, 1e-3);
        const c = Math.min(1, Math.max(0, (1 - f) * wu + 0.5));
        if (c <= 0) continue;
        // brighter toward the tip and on one side, darker midrib and edge
        const b = base * (0.78 + 0.3 * (u * 0.5 + 0.5)) * (0.94 + 0.12 * (v / hw))
          * (1 - 0.16 * Math.max(0, 1 - Math.abs(v) / (0.14 * hw))) * (1 - 0.14 * f * f);
        const x = (((Math.round(cx + dx)) % W) + W) % W;
        const y = (((Math.round(cy + dy)) % W) + W) % W;
        const o = y * W + x;
        lum[o] += (b - lum[o]) * c;
        warm[o] += (hue - warm[o]) * c;
        cov[o] = Math.max(cov[o], c);
      }
    }
  }
  // coarse clumps: some patches of the foliage are lighter than others
  const clump = latticeNoise(4, new RNG(77));
  const out = new Uint8Array(W * W * 4);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * W + x;
      const k = 0.84 + 0.32 * clump(x / W, y / W);
      out[o * 4] = Math.round(Math.min(1, (lum[o] * k) / 1.3) * 255);
      out[o * 4 + 1] = Math.round(warm[o] * 255);
      out[o * 4 + 2] = 0;
      out[o * 4 + 3] = Math.round(cov[o] * 255);
    }
  }
  return out;
}

let LEAF = null;

/** The shared leaf texture (built on first use). */
export function leafTexture() {
  if (LEAF) return LEAF;
  const tex = new THREE.DataTexture(leafTexels(), LEAF_SIZE, LEAF_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'leaf-texture';
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  LEAF = tex;
  return tex;
}

// ---------------------------------------------------------------------------
// needles: the sprays that hang from the tiers of a spruce
// ---------------------------------------------------------------------------

const NEEDLE_W = 128;
const NEEDLE_H = 64;
/** Sprays across the width of the needle texture (it repeats around a tier). */
export const NEEDLE_SPRAYS = 8;

/**
 * RGBA texels of the needle texture: u runs around the tier (tiles), v from the middle of the
 * tier (0) out to the tips of its branches (1). Eight slender sprays side by side, each a twig
 * with needles streaking out and forward from it, a fresher tip, its own length and brightness;
 * the base is filled and the gaps open up toward the tips. R brightness (0..1.3), G warmth
 * (tips lean yellow), A coverage.
 * @returns {Uint8Array}
 */
export function needleTexels() {
  const W = NEEDLE_W;
  const H = NEEDLE_H;
  const out = new Uint8Array(W * H * 4);
  const rng = new RNG(515);
  const pitch = W / NEEDLE_SPRAYS;
  const sprays = [];
  for (let k = 0; k < NEEDLE_SPRAYS; k++) {
    sprays.push({
      xc: (k + 0.5) * pitch + (rng.next() - 0.5) * 3,
      tip: 0.8 + rng.next() * 0.19, // where the spray ends (v)
      wmax: pitch * (0.5 + rng.next() * 0.16), // half width at its widest, texels
      bright: 0.82 + rng.next() * 0.3,
      sway: rng.next() * 6.28,
    });
  }
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      let lum = 0.2;
      let warm = 0.3;
      let cov = 0;
      for (const sp of sprays) {
        // nearest copy of the spray on the tiling axis
        let dx = x + 0.5 - sp.xc;
        if (dx > W / 2) dx -= W;
        if (dx < -W / 2) dx += W;
        // the twig sways a little along its length
        dx -= Math.sin(v * 9 + sp.sway) * 1.6;
        const t = v / sp.tip;
        if (t >= 1) continue;
        // lanceolate: full width from the base, narrowing to a point at the tip
        const hw = sp.wmax * Math.pow(1 - Math.pow(Math.max(t, 0), 2.4), 0.75);
        const f = Math.abs(dx);
        const c = Math.min(1, Math.max(0, hw - f + 0.5));
        if (c <= 0) continue;
        // needles: strokes running out from the twig and forward toward the tip
        const stripe = 0.5 + 0.5 * Math.sin((f * 0.9 + y * 0.8) * 1.6 + sp.sway * 3);
        let b = sp.bright * (0.6 + 0.42 * stripe) * (0.72 + 0.4 * (f / Math.max(hw, 1)));
        b *= 1 - 0.45 * Math.max(0, 1 - f / 1.3); // the twig itself is dark
        b *= 1 + 0.25 * Math.pow(t, 3); // fresh tips are lighter
        const w = 0.3 + 0.55 * Math.pow(t, 2.5);
        lum += (b - lum) * c;
        warm += (w - warm) * c;
        cov = Math.max(cov, c);
      }
      const o = (y * W + x) * 4;
      out[o] = Math.round(Math.min(1, lum / 1.3) * 255);
      out[o + 1] = Math.round(Math.min(1, warm) * 255);
      out[o + 2] = 0;
      out[o + 3] = Math.round(cov * 255);
    }
  }
  return out;
}

let NEEDLE = null;

/** The shared needle texture (built on first use). */
export function needleTexture() {
  if (NEEDLE) return NEEDLE;
  const tex = new THREE.DataTexture(needleTexels(), NEEDLE_W, NEEDLE_H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'needle-texture';
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  NEEDLE = tex;
  return tex;
}
