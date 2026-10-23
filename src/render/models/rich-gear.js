// Hand-held gear for the rich humanoids (rich-humanoid.js): swords, axes and hammers built
// from smooth lofts and beveled plates instead of the low-poly boxes, in the same grip frame
// the low-poly weapons use (unit-parts.js addWeapon: origin = palm, +Y along the weapon).
// Anything not built here keeps its low-poly model.
import * as THREE from 'three';
import { MeshKit, ps } from './rich-kit.js';
import { TEAM, shadeC, mixC, tintC, withMat } from './unit-geo.js';
import { gripRotation } from './unit-parts.js';
import { dye, mul, lerp } from './rich-paint.js';
import { feather } from './rich-feathers.js';

const PI = Math.PI;
const TAU = PI * 2;
export const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-9)));
  return t * t * (3 - 2 * t);
};

/** Weapons the rich kit builds itself. */
export const RICH_WEAPONS = new Set(['sword', 'axe', 'hammer', 'spear', 'club', 'bow', 'staff', 'katana', 'halberd']);

/** Matrix taking a piece modelled in the grip frame into the hand bone's frame (palm center, wrist at the origin's parent). */
export function handFrame(P, side, grip) {
  const r = gripRotation(grip);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(0.01, -P.handR * 0.55, side * 0.005),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2])),
    new THREE.Vector3(1, 1, 1),
  );
}

/** A rigid piece: no skin attributes, baked occlusion only (moved by `matrix` into its bone's frame). */
export function finishGear(kit, matrix = null) {
  const g = kit.build({ ground: 0, strength: 0.3, matrix });
  g.deleteAttribute('skinIndex');
  g.deleteAttribute('skinWeight');
  return g;
}

/** Leather-wrapped grip: a tube along +Y with a few cord bands. */
export function grip(kit, y0, y1, r, color, bands = 4) {
  const mid = (y0 + y1) / 2;
  kit.loft([ps(0, y0, 0, r * 0.95), ps(0, mid, 0, r), ps(0, y1, 0, r * 0.95)], {
    ref: [1, 0, 0], rings: 7, sides: 8, start: null, end: null, color, mat: 'leather',
    warp: (p, a, u) => {
      const k = Math.max(0, Math.sin(u * PI * bands)) ** 2 * r * 0.1;
      p[0] += Math.cos(a) * k;
      p[2] += Math.sin(a) * k;
    },
  });
}

function sword(kit, pal, s, { flame = false, blade = null, fitting: fit = null } = {}) {
  const steel = flame ? mixC(pal.accentMetal, '#ff9a3a', 0.4) : blade || pal.accentMetal;
  const fitting = flame ? shadeC(pal.darkMetal, 0.9) : fit || shadeC(pal.accentMetal, 0.78);
  grip(kit, -0.115 * s, 0.075 * s, 0.02 * s, pal.leather, 4);
  // pommel
  kit.loft([ps(0, -0.12 * s, 0, 0.028 * s), ps(0, -0.138 * s, 0, 0.03 * s), ps(0, -0.152 * s, 0, 0.022 * s)], {
    ref: [1, 0, 0], rings: 5, sides: 10, start: null, end: 'round', capDepth: 0.014 * s, color: fitting,
  });
  // cross guard along X, ends bent toward the blade
  const gw = (flame ? 0.15 : 0.115) * s;
  const gy = 0.082 * s;
  kit.loft([
    ps(-gw, gy + 0.02 * s, 0, 0.011 * s, 0.017 * s),
    ps(-gw * 0.55, gy + 0.004 * s, 0, 0.014 * s, 0.021 * s),
    ps(0, gy, 0, 0.018 * s, 0.025 * s),
    ps(gw * 0.55, gy + 0.004 * s, 0, 0.014 * s, 0.021 * s),
    ps(gw, gy + 0.02 * s, 0, 0.011 * s, 0.017 * s),
  ], { ref: [0, 1, 0], rings: 8, sides: 8, start: 'round', end: 'round', capDepth: 0.012 * s, color: fitting });
  // blade
  const w = flame ? 1.45 : 1;
  const len = flame ? 0.86 : 0.7;
  const st = [
    [0.085, 0.034 * w, 0.0125],
    [0.22, 0.042 * w, 0.012],
    [0.42, 0.041 * w, 0.0108],
    [0.58, 0.034 * w, 0.0085],
    [len - 0.05, 0.018 * w, 0.0055],
    [len, 0.003, 0.002],
  ].map(([y, rx, rz]) => ps(0, y * s, 0, rx * s, rz * s, 1.8));
  kit.loft(st, {
    ref: [1, 0, 0], rings: 12, sides: 8, start: null, end: 'round', capDepth: 0.025 * s, color: steel, mat: 'metal', glow: flame ? 0.9 : 0,
    warp: flame ? (p, a, u) => {
      // a flame-licked edge: the cutting edges ripple
      const e = Math.cos(a);
      p[0] += Math.sign(e) * Math.abs(e) ** 3 * 0.014 * s * Math.sin(u * 26 + (e > 0 ? 0 : 1.7)) * (0.4 + u);
    } : null,
    paint: (o, x, y, z, u, a) => {
      const ang = a * TAU;
      const face = Math.abs(Math.sin(ang));
      const edge = Math.abs(Math.cos(ang));
      if (flame) {
        // a hot core down the middle, cooler orange toward the edges and the tip
        const hot = sstep(0.55, 1, face) * (1 - 0.5 * u);
        o.r = lerp3(0.95, 1.0, hot);
        o.g = lerp3(0.42, 0.86, hot);
        o.b = lerp3(0.1, 0.35, hot);
        o.glow = 0.7 + 0.3 * hot;
        return;
      }
      // fuller: a shallow darker groove along the middle of each face; bright edges
      mul(o, 1 - 0.2 * sstep(0.7, 1, face) * sstep(0.04, 0.2, u) * (1 - sstep(0.62, 0.85, u)));
      if (edge > 0.9) mul(o, 1.08);
    },
  });
}

/**
 * A katana: a long, gently curved, single-edged blade (the edge on +X, the tip bending back toward -X
 * and so up when the sword is carried point-forward) with a pale wavy temper line, a round guard,
 * a gold collar and a handle wrapped in cord.
 */
function katana(kit, pal, s) {
  const steel = withMat(mixC(pal.accentMetal, '#dde2e8', 0.65), 'metal');
  const fitting = pal.accentMetal;
  const cord = withMat('#2a2430', 'cloth');
  // the handle: ray skin under a diamond wrap, a cap at the butt
  grip(kit, -0.165 * s, 0.07 * s, 0.0215 * s, cord, 7);
  kit.loft([ps(0, -0.17 * s, 0, 0.026 * s), ps(0, -0.19 * s, 0, 0.026 * s), ps(0, -0.2 * s, 0, 0.018 * s)], {
    ref: [1, 0, 0], rings: 4, sides: 10, start: null, end: 'round', capDepth: 0.012 * s, color: fitting, mat: 'gold',
  });
  // the round guard and the collar at the root of the blade
  kit.loft([ps(0, 0.072 * s, 0, 0.058 * s, 0.054 * s), ps(0, 0.086 * s, 0, 0.058 * s, 0.054 * s)], {
    ref: [1, 0, 0], sides: 16, start: 'flat', end: 'flat', color: shadeC(fitting, 0.85), mat: 'gold',
  });
  kit.loft([ps(0, 0.086 * s, 0, 0.026 * s, 0.0105 * s), ps(0, 0.12 * s, 0, 0.0245 * s, 0.0095 * s)], {
    ref: [1, 0, 0], sides: 8, start: null, end: null, color: fitting, mat: 'gold',
  });
  // the blade: long, thick at the back (mune), curving; stations along a shallow arc
  const y0 = 0.12;
  const L = 0.8;
  const arc = (t) => -0.052 * t * t;
  const rows = [[0, 0.0235, 0.0095], [0.14, 0.0235, 0.009], [0.4, 0.0225, 0.0082], [0.7, 0.0215, 0.0072], [0.9, 0.0195, 0.006], [0.975, 0.0145, 0.0038], [1, 0.002, 0.002]];
  kit.loft(rows.map(([t, rx, rz]) => ps(arc(t) * s, (y0 + t * (L - y0)) * s, 0, rx * s, rz * s, 1.7)), {
    ref: [1, 0, 0], rings: 12, sides: 8, start: null, end: 'round', capDepth: 0.02 * s, color: steel, mat: 'metal',
    paint: (o, x, y, z, u, a) => {
      const c = Math.cos(a * TAU);
      // the temper line: a pale wavy band a little back from the cutting edge; the back of the blade a shade bluer and darker
      const w = 0.52 + 0.09 * Math.sin(u * 38) + 0.05 * Math.sin(u * 91 + 1);
      const band = sstep(w - 0.14, w, c) * (1 - sstep(w, w + 0.18, c));
      mul(o, 0.84 + 0.34 * band + (c > 0.88 ? 0.16 : 0) - (c < -0.3 ? 0.08 : 0));
    },
  });
}

const lerp3 = (a, b, t) => a + (b - a) * t;

function axe(kit, pal, s, opts = {}) {
  const shaft = opts.shaftColor || pal.wood;
  const head = pal.accentMetal;
  // haft: slightly swelling toward the grip, capped at the butt
  kit.loft([ps(0, -0.1 * s, 0, 0.022 * s), ps(0, 0.08 * s, 0, 0.0195 * s), ps(0, 0.3 * s, 0, 0.018 * s), ps(0, 0.52 * s, 0, 0.0185 * s)], {
    ref: [1, 0, 0], rings: 9, sides: 8, start: 'round', end: 'round', capDepth: 0.01 * s, color: shaft, mat: 'wood',
    paint: (o, x, y, z, u) => mul(o, 0.92 + 0.12 * Math.sin(u * 20)),
  });
  grip(kit, -0.08 * s, 0.1 * s, 0.0235 * s, pal.leather, 5);
  kit.loft([ps(0, -0.112 * s, 0, 0.026 * s), ps(0, -0.1 * s, 0, 0.028 * s)], { ref: [1, 0, 0], sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: shadeC(head, 0.75) });
  // socket collar where the head sits
  kit.loft([ps(0, 0.335 * s, 0, 0.03 * s, 0.032 * s), ps(0, 0.47 * s, 0, 0.03 * s, 0.032 * s)], { ref: [1, 0, 0], sides: 10, start: null, end: null, color: shadeC(head, 0.7), mat: 'iron' });
  // a bearded head: poll behind the haft, a long curved edge in front, the beard hooking down
  const y0 = 0.41 * s;
  const pts = [
    [-0.034, 0.045], [0.0, 0.058], [0.07, 0.092], [0.14, 0.128], [0.19, 0.126],
    [0.208, 0.07], [0.212, 0.0], [0.2, -0.07], [0.168, -0.135], [0.12, -0.17],
    [0.095, -0.155], [0.07, -0.095], [0.02, -0.058], [-0.034, -0.045],
  ].map(([x, y]) => [x * s, y0 + y * s]);
  kit.slab(pts, {
    depth: 0.027 * s, bevel: 0.01 * s, color: head, mat: 'metal',
    paint: (o, x, y, z, u) => {
      // the edge is brighter and the cheek a touch darker
      mul(o, 0.86 + 0.3 * sstep(0.55, 1, u));
    },
  });
  // inlaid rune stripe on the cheek
  kit.slab([[0.045 * s, y0 + 0.05 * s], [0.1 * s, y0 + 0.06 * s], [0.12 * s, y0 + 0.03 * s], [0.07 * s, y0 + 0.02 * s]],
    { depth: 0.032 * s, bevel: 0.004 * s, color: shadeC(head, 0.6), mat: 'iron' });
}

function hammer(kit, pal, s, { glow = null } = {}) {
  const head = shadeC(pal.accentMetal, 0.82);
  grip(kit, -0.075 * s, 0.36 * s, 0.023 * s, pal.leather, 7);
  // wrist loop at the butt
  kit.loft([ps(0, -0.08 * s, 0, 0.03 * s), ps(0, -0.095 * s, 0, 0.032 * s)], { ref: [1, 0, 0], sides: 8, start: 'round', end: null, capDepth: 0.01 * s, color: shadeC(pal.accentMetal, 0.7) });
  // the head: a heavy block, its two striking faces slightly flared, along X
  const hy = 0.435 * s;
  const sec = (x, h, d) => ps(x * s, hy, 0, h * s, d * s, 4.2);
  kit.loft([sec(-0.142, 0.056, 0.06), sec(-0.134, 0.077, 0.081), sec(-0.1, 0.074, 0.078), sec(-0.04, 0.065, 0.069), sec(0.04, 0.065, 0.069), sec(0.1, 0.074, 0.078), sec(0.134, 0.077, 0.081), sec(0.142, 0.056, 0.06)], {
    ref: [0, 1, 0], rings: 12, sides: 16, start: 'round', end: 'round', capDepth: 0.01 * s, capRings: 2, color: head, mat: 'metal',
    paint: (o, x, y, z, u) => {
      // worn faces, darker toward the middle of the block
      mul(o, 0.9 + 0.14 * Math.abs(u - 0.5) * 2);
    },
  });
  // bands: iron at the middle, inlaid runes (glowing for a god's hammer) on either side
  const band = (x, w, h, d, color, mat, g = 0) => kit.loft([ps((x - w) * s, hy, 0, h * s, d * s, 4.2), ps((x + w) * s, hy, 0, h * s, d * s, 4.2)],
    { ref: [0, 1, 0], sides: 16, start: null, end: null, color, mat, glow: g });
  band(0, 0.024, 0.071, 0.075, shadeC(head, 0.62), 'iron');
  const runeColor = glow ? tintC(glow, 0.15) : shadeC(pal.accentMetal, 1.05);
  for (const x of [-0.083, 0.083]) band(x, 0.009, 0.0775, 0.0815, runeColor, glow ? 'gem' : 'metal', glow ? 0.75 : 0);
}

/** Turned wood: a gentle swell and a few pale growth rings along the grain. */
export const grain = (k = 0.1) => (o, x, y, z, u) => mul(o, 0.94 + k * Math.sin(u * 23 + y * 11));

/** A spear: ash shaft with a wrapped grip, iron butt-spike, a socketed leaf head (opts.runes: gold bands and a glowing rune on a god's). */
function spear(kit, pal, s, { runes = null, shaftColor = null } = {}) {
  const shaft = shaftColor || pal.wood;
  const metal = pal.accentMetal;
  const iron = shadeC(pal.darkMetal, 1.15);
  kit.loft([ps(0, -0.42 * s, 0, 0.016 * s), ps(0, -0.12 * s, 0, 0.0195 * s), ps(0, 0.4 * s, 0, 0.0185 * s), ps(0, 0.8 * s, 0, 0.0165 * s)], {
    ref: [1, 0, 0], rings: 9, sides: 8, start: null, end: null, color: shaft, mat: 'wood', paint: grain(),
  });
  grip(kit, -0.1 * s, 0.1 * s, 0.0235 * s, pal.leather, 5);
  // butt: a ferrule and a short iron spike
  kit.loft([ps(0, -0.4 * s, 0, 0.021 * s), ps(0, -0.44 * s, 0, 0.0185 * s), ps(0, -0.5 * s, 0, 0.003 * s)], {
    ref: [1, 0, 0], rings: 4, sides: 8, start: 'round', end: 'round', capDepth: [0.008 * s, 0.004 * s], color: iron, mat: 'iron',
  });
  // socket: a flared collar where the head is set, with two bands
  kit.loft([ps(0, 0.76 * s, 0, 0.0215 * s), ps(0, 0.8 * s, 0, 0.027 * s), ps(0, 0.855 * s, 0, 0.0215 * s)], {
    ref: [1, 0, 0], rings: 5, sides: 10, start: null, end: null, color: shadeC(metal, 0.72), mat: 'metal',
  });
  // the head: a long leaf, flat in Z, widest a third of the way up, with a raised midrib
  const st = [
    [0.85, 0.02, 0.011], [0.9, 0.038, 0.0125], [0.965, 0.054, 0.0125], [1.04, 0.05, 0.0115], [1.12, 0.032, 0.0085], [1.2, 0.013, 0.005], [1.25, 0.002, 0.002],
  ].map(([y, rx, rz]) => ps(0, y * s, 0, rx * s, rz * s, 1.6));
  kit.loft(st, {
    ref: [1, 0, 0], rings: 12, sides: 10, start: null, end: 'round', capDepth: 0.03 * s, color: metal, mat: 'metal',
    paint: (o, x, y, z, u, a) => {
      const ang = a * TAU;
      const face = Math.abs(Math.sin(ang));
      const edge = Math.abs(Math.cos(ang));
      mul(o, 0.9 + 0.16 * sstep(0.7, 1, edge) - 0.12 * sstep(0.8, 1, face) * sstep(0.1, 0.4, u));
    },
  });
  if (runes) {
    const c = tintC(runes, 0.2);
    for (const y of [0.31, 0.5, 0.69]) {
      kit.loft([ps(0, (y - 0.014) * s, 0, 0.0208 * s), ps(0, (y + 0.014) * s, 0, 0.0208 * s)], {
        ref: [1, 0, 0], sides: 8, start: null, end: null, color: c, mat: 'gem', glow: 0.8,
      });
    }
    kit.loft([ps(0, 0.965 * s, 0, 0.012 * s, 0.0138 * s), ps(0, 1.06 * s, 0, 0.008 * s, 0.0128 * s)], {
      ref: [1, 0, 0], sides: 6, start: 'round', end: 'round', capDepth: 0.006 * s, color: c, mat: 'gem', glow: 0.9,
    });
  }
}

/**
 * A club: a gnarled trunk swelling to a heavy head ringed with studs. opts: color (the wood; iron for a
 * kanabo), studs (their color), kanabo (a smooth round iron club, the head ringed with rows of studs).
 */
function club(kit, pal, s, { color = null, studs = null, kanabo = false } = {}) {
  const wood = color || pal.wood;
  const stud = studs || shadeC(wood, 0.55);
  kit.loft([ps(0, -0.08 * s, 0, 0.034 * s), ps(0, 0.05 * s, 0, 0.03 * s), ps(0, 0.22 * s, 0, 0.04 * s), ps(0, 0.38 * s, 0, 0.066 * s), ps(0, 0.5 * s, 0, 0.088 * s), ps(0, 0.58 * s, 0, 0.07 * s)], {
    ref: [1, 0, 0], rings: 12, sides: kanabo ? 12 : 10, start: 'round', end: 'round', capDepth: [0.014 * s, 0.045 * s], color: wood, mat: kanabo ? 'iron' : 'wood',
    warp: kanabo ? null : (p, a, u) => {
      // knots and burrs along the trunk
      const k = Math.max(0, Math.sin(u * 17 + a * 2.3)) ** 3 * 0.012 * s * (0.4 + u);
      p[0] += Math.cos(a) * k;
      p[2] += Math.sin(a) * k;
    },
    paint: kanabo ? (o, x, y, z, u) => mul(o, 0.78 + 0.34 * u + 0.06 * Math.sin(u * 60 + y * 9)) : (o, x, y, z, u) => mul(o, 0.8 + 0.3 * u + 0.08 * Math.sin(u * 40 + y * 9)),
  });
  grip(kit, -0.06 * s, 0.12 * s, 0.0375 * s, pal.leather, 4);
  if (kanabo) {
    // iron bands under the studs, three staggered rows of conical studs round the head
    for (const y of [0.34, 0.585]) {
      kit.loft([ps(0, (y - 0.014) * s, 0, (y > 0.5 ? 0.07 : 0.062) * s), ps(0, (y + 0.014) * s, 0, (y > 0.5 ? 0.073 : 0.065) * s)], { ref: [1, 0, 0], sides: 12, start: null, end: null, color: shadeC(stud, 0.8), mat: 'iron' });
    }
    const rows = [[0.4, 0.062], [0.46, 0.078], [0.52, 0.086]];
    rows.forEach(([y, r], row) => {
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = ((i + (row % 2) * 0.5) / n) * TAU;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        kit.loft([ps(dx * r * 0.9 * s, y * s, dz * r * 0.9 * s, 0.016 * s), ps(dx * (r + 0.05) * s, (y + 0.006) * s, dz * (r + 0.05) * s, 0.003 * s)], {
          ref: [0, 1, 0], sides: 5, rings: 2, start: null, end: 'round', capDepth: 0.01 * s, color: stud, mat: 'iron',
        });
      }
    });
    return;
  }
  // studs around the head
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + (i % 2) * 0.35;
    const y = (0.4 + (i % 3) * 0.075) * s;
    const r = (0.066 + 0.022 * ((y / s - 0.38) / 0.12)) * s;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    kit.loft([ps(dx * r * 0.85, y, dz * r * 0.85, 0.015 * s), ps(dx * (r + 0.045 * s), y + 0.012 * s, dz * (r + 0.045 * s), 0.003 * s)], {
      ref: [0, 1, 0], sides: 5, rings: 2, start: null, end: 'round', capDepth: 0.01 * s, color: stud, mat: 'bone',
    });
  }
}

/**
 * A double-bitted axe, the long-handled one of the Celts' raiders: a haft with a wrapped grip and an iron-shod butt, an iron
 * block at its top, and to each side of the block a broad blade with a horn at either end of its edge. opts: shaftColor, metal (the blades').
 */
function doubleAxe(kit, pal, s, { shaftColor = null, metal = null } = {}) {
  const shaft = shaftColor || pal.wood;
  const head = metal || pal.accentMetal;
  const iron = shadeC(pal.darkMetal, 1.15);
  kit.loft([ps(0, -0.12 * s, 0, 0.022 * s), ps(0, 0.1 * s, 0, 0.0195 * s), ps(0, 0.4 * s, 0, 0.018 * s), ps(0, 0.66 * s, 0, 0.0185 * s)], {
    ref: [1, 0, 0], rings: 10, sides: 8, start: 'round', end: 'round', capDepth: 0.01 * s, color: shaft, mat: 'wood', paint: grain(0.1),
  });
  grip(kit, -0.1 * s, 0.12 * s, 0.0235 * s, pal.leather, 5);
  kit.loft([ps(0, -0.115 * s, 0, 0.027 * s), ps(0, -0.15 * s, 0, 0.026 * s), ps(0, -0.175 * s, 0, 0.012 * s)], {
    ref: [1, 0, 0], rings: 4, sides: 8, start: null, end: 'round', capDepth: 0.01 * s, color: iron, mat: 'iron',
  });
  // the iron block the blades are set on, a band at each end of it
  const y0 = 0.56 * s;
  kit.loft([ps(0, y0 - 0.06 * s, 0, 0.033 * s, 0.032 * s), ps(0, y0 + 0.06 * s, 0, 0.033 * s, 0.032 * s)], { ref: [1, 0, 0], sides: 10, start: 'round', end: 'round', capDepth: 0.012 * s, color: iron, mat: 'iron' });
  for (const dy of [-0.05, 0.05]) {
    kit.loft([ps(0, y0 + (dy - 0.008) * s, 0, 0.036 * s, 0.035 * s), ps(0, y0 + (dy + 0.008) * s, 0, 0.036 * s, 0.035 * s)], { ref: [1, 0, 0], sides: 10, start: null, end: null, color: shadeC(head, 0.7), mat: 'metal' });
  }
  const half = [[0.03, 0.055], [0.09, 0.088], [0.15, 0.14], [0.205, 0.178], [0.238, 0.1], [0.248, 0.0], [0.238, -0.1], [0.205, -0.178], [0.15, -0.14], [0.09, -0.088], [0.03, -0.055]];
  for (const dir of [1, -1]) {
    const pts = half.map(([x, y]) => [dir * x * s, y0 + y * s]);
    if (dir < 0) pts.reverse();
    kit.slab(pts, {
      depth: 0.024 * s, bevel: 0.009 * s, color: head, mat: 'metal',
      paint: (o, x, y, z, u) => mul(o, 0.84 + 0.32 * sstep(0.5, 1, dir > 0 ? u : 1 - u)),
    });
  }
}

/**
 * A torch, Brigid's: a stave of dark wood leaning a little outward, a head of pitch-soaked rags bound in iron at its top, and a flame
 * above it with two smaller tongues at its sides (the flame flickers: the piece it is in must be driven as a flame, see rich-humanoid.js).
 */
function torch(kit, pal, s) {
  const wood = shadeC(pal.wood, 0.85);
  const pitch = withMat('#33261a', 'cloth');
  const f = pal.fire;
  const h = pal.fireHot;
  kit.placed(new THREE.Matrix4().makeRotationZ(-0.3), () => {
    kit.loft([ps(0, -0.2 * s, 0, 0.02 * s), ps(0, 0.1 * s, 0, 0.022 * s), ps(0, 0.3 * s, 0, 0.02 * s), ps(0, 0.42 * s, 0, 0.019 * s)], {
      ref: [1, 0, 0], rings: 8, sides: 8, start: 'round', end: null, capDepth: 0.009 * s, color: wood, mat: 'wood', paint: grain(0.1),
    });
    grip(kit, -0.1 * s, 0.1 * s, 0.0245 * s, pal.leather, 4);
    // the head: rags wound thick about the stave, bound in iron
    kit.loft([ps(0, 0.38 * s, 0, 0.022 * s), ps(0, 0.41 * s, 0, 0.034 * s), ps(0, 0.46 * s, 0, 0.041 * s), ps(0, 0.51 * s, 0, 0.034 * s), ps(0, 0.53 * s, 0, 0.018 * s)], {
      ref: [1, 0, 0], rings: 8, sides: 10, start: null, end: 'round', capDepth: 0.012 * s, color: pitch, mat: 'cloth',
      paint: (o, x, y, z, u) => mul(o, 0.8 + 0.3 * Math.abs(Math.sin(u * 30))),
    });
    for (const y of [0.405, 0.495]) {
      kit.loft([ps(0, (y - 0.008) * s, 0, 0.036 * s), ps(0, (y + 0.008) * s, 0, 0.036 * s)], { ref: [1, 0, 0], sides: 10, start: null, end: null, color: shadeC(pal.darkMetal, 1.1), mat: 'iron' });
    }
    const tongue = (x0, z0, len, r, lean) => {
      const st = [];
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        const rr = r * (1 - t) ** 0.85 + 0.003 * s;
        st.push(ps(x0 + lean[0] * len * t * t, 0.52 * s + len * t, z0 + lean[1] * len * t * t, rr, rr * 0.85));
      }
      kit.loft(st, {
        ref: [1, 0, 0], rings: 6, sides: 6, start: 'round', end: 'round', capRings: 3, capDepth: [r * 0.5, len * 0.08], color: pal.fire, mat: 'gem', glow: 0.95, flicker: { base: [x0, 0.52 * s, z0], k: 0.35 },
        paint: (o, x, y, z, u) => {
          const k = u * u;
          o.r = f.r + (h.r - f.r) * k;
          o.g = f.g + (h.g - f.g) * k;
          o.b = f.b + (h.b - f.b) * k;
        },
      });
    };
    tongue(0, 0, 0.19 * s, 0.034 * s, [-0.05 * s, 0]);
    tongue(0.014 * s, 0.018 * s, 0.11 * s, 0.02 * s, [0.0, 0.05 * s]);
    tongue(-0.012 * s, -0.02 * s, 0.09 * s, 0.018 * s, [-0.03 * s, -0.05 * s]);
  });
}

/**
 * A druid's staff: a gnarled stave of oak with a golden crescent at its top (the sickle moon) cradling a pearl of mistletoe, a
 * spray of two oak leaves at its foot. opts: shaftColor.
 */
function druidStaff(kit, pal, s, { shaftColor = null } = {}) {
  const wood = shaftColor || pal.wood;
  const gold = pal.accentMetal;
  kit.loft([ps(0, -0.5 * s, 0, 0.02 * s), ps(0, -0.2 * s, 0, 0.0235 * s), ps(0, 0.15 * s, 0, 0.022 * s), ps(0, 0.4 * s, 0, 0.0245 * s), ps(0, 0.56 * s, 0, 0.0215 * s)], {
    ref: [1, 0, 0], rings: 10, sides: 8, start: 'round', end: null, capDepth: 0.009 * s, color: wood, mat: 'wood',
    warp: (p, a, u) => {
      // knots and a slow bend along the stave
      const k = Math.max(0, Math.sin(u * 13 + a * 2.1)) ** 3 * 0.01 * s;
      p[0] += Math.cos(a) * k + 0.012 * s * Math.sin(u * 5);
      p[2] += Math.sin(a) * k;
    },
    paint: grain(0.12),
  });
  grip(kit, -0.1 * s, 0.1 * s, 0.0255 * s, pal.leather, 4);
  // the crescent: an arc of gold open upward, thick at its belly, its horns drawn out fine
  const R = 0.085 * s;
  const cy = 0.66 * s;
  const arc = [];
  for (let i = 0; i <= 12; i++) {
    const a = lerp(-2.45, 2.45, i / 12);
    const k = 1 - Math.abs(a) / 2.6;
    arc.push(ps(Math.sin(a) * R, cy - Math.cos(a) * R, 0, (0.006 + 0.014 * k) * s, (0.006 + 0.014 * k) * s));
  }
  kit.loft(arc, { ref: [0, 0, 1], rings: 12, sides: 8, start: 'round', end: 'round', capDepth: 0.004 * s, color: gold, mat: 'gold' });
  kit.loft([ps(0, 0.55 * s, 0, 0.0215 * s), ps(0, 0.58 * s, 0, 0.03 * s), ps(0, cy - R - 0.004 * s, 0, 0.022 * s)], { ref: [1, 0, 0], rings: 4, sides: 8, start: null, end: null, color: gold, mat: 'gold' });
  kit.loft([ps(0, cy - 0.026 * s, 0, 0.028 * s), ps(0, cy, 0, 0.03 * s), ps(0, cy + 0.026 * s, 0, 0.028 * s)], {
    ref: [1, 0, 0], rings: 5, sides: 10, start: 'round', end: 'round', capDepth: 0.02 * s, color: withMat('#f4efe0', 'gem'), mat: 'gem', glow: 0.35,
  });
  for (const j of [1, -1]) {
    feather(kit, [0.0, -0.2 * s, j * 0.02 * s], [j * 0.7, -0.3, 0.5], [0, 1, 0], 0.11 * s, 0.032 * s, { color: withMat('#4f7a34', 'cloth'), tip: null, mat: 'cloth', rows: 4, shape: 0.5, cup: 0.2, thick: 0.003 });
  }
}

/**
 * A macuahuitl, the Mexica's sword: a flat paddle of hardwood, broad and rounded at its end, a row of obsidian blades set into each
 * edge like teeth, a grip wrapped in cord with a gold collar at the paddle and a tassel at the butt. opts: color (the wood), blade (the
 * obsidian), tassel.
 */
function macuahuitl(kit, pal, s, { color = null, blade = null, tassel = null } = {}) {
  const wood = color || pal.wood;
  const glass = blade || withMat('#1a1620', 'gloss');
  const prof = [[0.12, 0.024], [0.2, 0.04], [0.34, 0.05], [0.48, 0.054], [0.6, 0.05], [0.7, 0.036], [0.76, 0.016]];
  const wAt = (y) => {
    for (let i = 0; i + 1 < prof.length; i++) if (y <= prof[i + 1][0]) return lerp(prof[i][1], prof[i + 1][1], (y - prof[i][0]) / (prof[i + 1][0] - prof[i][0]));
    return prof[prof.length - 1][1];
  };
  kit.loft(prof.map(([y, w]) => ps(0, y * s, 0, w * s, 0.0125 * s)), {
    ref: [1, 0, 0], rings: 9, sides: 10, start: 'round', end: 'round', capDepth: [0.012 * s, 0.03 * s], color: wood, mat: 'wood', paint: grain(0.1),
  });
  grip(kit, -0.08 * s, 0.14 * s, 0.0235 * s, pal.leather, 5);
  kit.loft([ps(0, 0.105 * s, 0, 0.03 * s), ps(0, 0.145 * s, 0, 0.032 * s)], { ref: [1, 0, 0], sides: 10, start: null, end: null, color: pal.accentMetal, mat: 'gold' });
  kit.loft([ps(0, -0.08 * s, 0, 0.024 * s), ps(0, -0.095 * s, 0, 0.028 * s), ps(0, -0.108 * s, 0, 0.018 * s)], { ref: [1, 0, 0], rings: 3, sides: 8, start: null, end: 'round', capDepth: 0.01 * s, color: pal.accentMetal, mat: 'gold' });
  kit.loft([ps(0, -0.1 * s, 0, 0.011 * s), ps(0.01 * s, -0.17 * s, 0, 0.015 * s), ps(0.014 * s, -0.25 * s, 0, 0.004 * s)], {
    ref: [1, 0, 0], rings: 4, sides: 6, start: 'round', end: 'round', capDepth: [0.008 * s, 0.01 * s], color: tassel || pal.secondary, mat: 'cloth',
    paint: (o, x, y, z, u, a) => mul(o, 0.8 + 0.3 * Math.abs(Math.sin(a * TAU * 2))),
  });
  // the obsidian: a strip of black glass set along each edge, serrated, its teeth pointing outward
  const teeth = 15;
  for (const dir of [1, -1]) {
    kit.sheet(1, teeth * 2, (u, v, out) => {
      const y = 0.2 + v * 0.54;
      out[0] = dir * (wAt(y) * 0.96 + u * (Math.round(v * teeth * 2) % 2 ? 0.028 : 0)) * s;
      out[1] = y * s;
      out[2] = 0;
    }, { thick: 0.005 * s, color: glass, inner: glass, mat: 'gloss' });
  }
}

/**
 * A recurved bow: tapering flat limbs curving away from the archer, a wrapped grip, horn nocks and a drawn-string
 * line. opts: color, yumi (the Japanese bow: taller, held a third of the way up, so the lower limb is the shorter).
 */
function bow(kit, pal, s, { color = null, yumi = false } = {}) {
  const wood = color || pal.woodDark;
  const up = (yumi ? 0.62 : 0.42) * s;
  const lo = (yumi ? 0.36 : 0.42) * s;
  const at = (t) => {
    const k = Math.abs(t) * 2; // 0 at the grip, 1 at the tips
    const x = (0.108 * Math.cos(t * PI) ** 1.15 - 0.046 + 0.034 * sstep(0.62, 1, k)) * s;
    return [x, t * 2 * (t > 0 ? up : lo)];
  };
  const limb = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = i / n - 0.5;
    const [x, y] = at(t);
    const k = Math.abs(t) * 2;
    const r = (0.0125 + 0.0105 * (1 - k) ** 1.2) * s;
    limb.push(ps(x, y, 0, r, r * 1.45));
  }
  kit.loft(limb, {
    ref: [0, 0, 1], rings: 12, sides: 6, capRings: 2, start: 'round', end: 'round', capDepth: 0.01 * s, color: wood, mat: yumi ? 'lacquer' : 'wood',
    paint: (o, x, y, z, u) => mul(o, 0.9 + 0.14 * Math.sin(u * 34) * Math.sin(u * PI)),
  });
  // leather-wrapped grip
  const g0 = at(-0.075);
  const g1 = at(0.075);
  kit.loft([ps(g0[0], g0[1], 0, 0.026 * s, 0.03 * s), ps(0.0 + at(0)[0], 0, 0, 0.0285 * s, 0.032 * s), ps(g1[0], g1[1], 0, 0.026 * s, 0.03 * s)], {
    ref: [0, 0, 1], rings: 5, sides: 8, start: null, end: null, color: pal.leather, mat: 'leather',
  });
  if (yumi) {
    // the rattan binding: pale bands up the limbs
    for (const t of [-0.3, -0.19, 0.2, 0.3, 0.4]) {
      const [x, y] = at(t);
      const r = (0.0125 + 0.0105 * (1 - Math.abs(t) * 2) ** 1.2) * s;
      kit.loft([ps(x, y - 0.012 * s, 0, r * 1.15, r * 1.6), ps(x, y + 0.012 * s, 0, r * 1.15, r * 1.6)], { ref: [0, 0, 1], sides: 6, start: null, end: null, color: withMat('#d8c490', 'cloth') });
    }
  }
  // horn nocks at the tips, and the string between them
  for (const sgn of [-1, 1]) {
    const [x, y] = at(sgn * 0.5);
    kit.loft([ps(x, y - sgn * 0.012 * s, 0, 0.012 * s), ps(x - 0.006 * s, y + sgn * 0.016 * s, 0, 0.008 * s)], {
      ref: [0, 0, 1], sides: 6, start: 'round', end: 'round', capDepth: 0.007 * s, color: pal.bone, mat: 'bone',
    });
  }
  const [x0, y0] = at(-0.5);
  const [x1, y1] = at(0.5);
  kit.loft([ps(x0 - 0.008 * s, y0, 0, 0.0035 * s), ps((x0 + x1) / 2 - 0.006 * s, (y0 + y1) / 2, 0, 0.0035 * s), ps(x1 - 0.008 * s, y1, 0, 0.0035 * s)], {
    ref: [0, 0, 1], sides: 4, start: null, end: null, color: mixC(pal.white, pal.leather, 0.25), mat: 'cloth',
  });
}

/**
 * A shakujo, the pilgrim's staff: a shaft of wood under a head of gold, a tall ring with a smaller ring hung
 * at each side of it and a jewel at its crown.
 */
function shakujo(kit, pal, s) {
  const metal = pal.accentMetal;
  kit.loft([ps(0, -0.5 * s, 0, 0.0195 * s), ps(0, -0.1 * s, 0, 0.0215 * s), ps(0, 0.3 * s, 0, 0.0215 * s), ps(0, 0.56 * s, 0, 0.0195 * s)], {
    ref: [1, 0, 0], rings: 8, sides: 8, start: 'round', end: null, capDepth: 0.009 * s, color: pal.wood, mat: 'wood', paint: grain(0.08),
  });
  grip(kit, -0.1 * s, 0.1 * s, 0.0245 * s, pal.leather, 4);
  kit.loft([ps(0, -0.5 * s, 0, 0.0215 * s), ps(0, -0.455 * s, 0, 0.022 * s)], { ref: [1, 0, 0], sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: shadeC(metal, 0.72), mat: 'metal' });
  // the socket under the ring, flared
  kit.loft([ps(0, 0.5 * s, 0, 0.0245 * s), ps(0, 0.545 * s, 0, 0.034 * s), ps(0, 0.6 * s, 0, 0.0175 * s)], { ref: [1, 0, 0], rings: 4, sides: 10, start: null, end: null, color: metal, mat: 'gold' });
  // the great ring, taller than wide, standing across the blade so the front of the figure sees it face on
  const cy = 0.74 * s;
  const rx = 0.07 * s;
  const ry = 0.135 * s;
  const loop = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const a = -PI / 2 + (i / N) * TAU;
    loop.push(ps(0, cy + ry * Math.sin(a), rx * Math.cos(a), 0.0095 * s, 0.0095 * s));
  }
  kit.loft(loop, { ref: [1, 0, 0], sides: 5, start: null, end: null, color: metal, mat: 'gold' });
  // two small rings hung from each side of it
  for (const side of [1, -1]) {
    for (const k of [0, 1]) {
      const a = (0.2 + k * 0.5) * side;
      const pz = (rx + 0.022 * s) * Math.cos(a) * 0.98;
      const py = cy + ry * 0.5 * Math.sin(a * 1.6) + 0.02 * s;
      const ring = [];
      for (let i = 0; i <= 8; i++) {
        const b = (i / 8) * TAU;
        ring.push(ps(0, py + Math.sin(b) * 0.021 * s, pz + Math.cos(b) * 0.021 * s, 0.0048 * s, 0.0048 * s));
      }
      kit.loft(ring, { ref: [1, 0, 0], sides: 4, start: null, end: null, color: metal, mat: 'gold' });
    }
  }
  // the jewel at the crown, a flame of light on a gold cup
  const top = cy + ry;
  kit.loft([ps(0, top - 0.004 * s, 0, 0.012 * s), ps(0, top + 0.016 * s, 0, 0.02 * s), ps(0, top + 0.034 * s, 0, 0.012 * s)], { ref: [1, 0, 0], rings: 4, sides: 8, start: null, end: null, color: metal, mat: 'gold' });
  kit.loft([ps(0, top + 0.03 * s, 0, 0.016 * s), ps(0, top + 0.062 * s, 0, 0.022 * s), ps(0, top + 0.1 * s, 0, 0.005 * s)], {
    ref: [1, 0, 0], rings: 4, sides: 8, start: null, end: 'round', capDepth: 0.01 * s, color: tintC(pal.glow, 0.3), mat: 'gem', glow: 1,
  });
}

/** A staff: a straight shaft with bands, held in a four-pronged cradle by a glowing orb (opts.orb: its color). */
function staff(kit, pal, s, { shaftColor = null, orb = null } = {}) {
  const shaft = shaftColor || pal.wood;
  const metal = pal.accentMetal;
  kit.loft([ps(0, -0.5 * s, 0, 0.0195 * s), ps(0, -0.1 * s, 0, 0.0215 * s), ps(0, 0.3 * s, 0, 0.0215 * s), ps(0, 0.54 * s, 0, 0.0195 * s)], {
    ref: [1, 0, 0], rings: 8, sides: 8, start: 'round', end: null, capDepth: 0.009 * s, color: shaft, mat: 'wood', paint: grain(0.08),
  });
  grip(kit, -0.1 * s, 0.1 * s, 0.0245 * s, pal.leather, 4);
  // a metal ferrule at the foot and a band under the cradle
  kit.loft([ps(0, -0.5 * s, 0, 0.0215 * s), ps(0, -0.455 * s, 0, 0.022 * s)], { ref: [1, 0, 0], sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: shadeC(metal, 0.72), mat: 'metal' });
  kit.loft([ps(0, 0.5 * s, 0, 0.0245 * s), ps(0, 0.545 * s, 0, 0.03 * s), ps(0, 0.575 * s, 0, 0.0245 * s)], { ref: [1, 0, 0], rings: 4, sides: 10, start: null, end: null, color: shadeC(metal, 0.8), mat: 'metal' });
  const oy = 0.66 * s;
  const R = 0.052 * s;
  const glow = orb || tintC(pal.glow, 0.2);
  kit.loft([ps(0, oy - R, 0, R * 0.2), ps(0, oy, 0, R), ps(0, oy + R, 0, R * 0.2)], {
    ref: [1, 0, 0], rings: 8, sides: 12, start: 'round', end: 'round', capDepth: R * 0.3, color: glow, mat: 'gem', glow: 1,
    paint: (o, x, y, z, u) => mul(o, 0.85 + 0.3 * Math.sin(u * PI)),
  });
  // four prongs curling up and in around the orb
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + PI / 4;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    kit.loft([
      ps(dx * 0.012 * s, 0.57 * s, dz * 0.012 * s, 0.009 * s),
      ps(dx * 0.042 * s, 0.62 * s, dz * 0.042 * s, 0.0085 * s),
      ps(dx * 0.062 * s, 0.68 * s, dz * 0.062 * s, 0.0075 * s),
      ps(dx * 0.05 * s, 0.745 * s, dz * 0.05 * s, 0.005 * s),
    ], { ref: [0, 1, 0], rings: 6, sides: 5, start: 'round', end: 'round', capDepth: 0.005 * s, color: metal, mat: 'metal' });
  }
}

/**
 * A pole arm of the Chinese. The ji, the soldier's halberd: a long shaft under a leaf-shaped spearhead with a crescent blade
 * hooking up from the foot of it, a tassel streaming back from the socket and an iron spike at the butt. With opts.guandao,
 * the general's great blade: a heavy shaft under a long one-edged blade that swells toward the point, hooked teeth along its
 * spine and a green inlay down its flat. opts: guandao, tassel (the streamer's color; the team's by default).
 */
function halberd(kit, pal, s, { guandao = false, tassel = null } = {}) {
  const shaft = guandao ? shadeC(pal.woodDark, 0.85) : pal.wood;
  const metal = pal.accentMetal;
  const iron = shadeC(pal.darkMetal, 1.15);
  const top = guandao ? 0.82 : 0.8;
  kit.loft([ps(0, -0.42 * s, 0, 0.016 * s), ps(0, -0.12 * s, 0, 0.0195 * s), ps(0, 0.4 * s, 0, 0.0185 * s), ps(0, top * s, 0, 0.0165 * s)], {
    ref: [1, 0, 0], rings: 6, sides: 8, start: null, end: null, color: shaft, mat: 'wood', paint: grain(),
  });
  grip(kit, -0.1 * s, 0.1 * s, 0.0235 * s, pal.leather, 5);
  kit.loft([ps(0, -0.4 * s, 0, 0.021 * s), ps(0, -0.44 * s, 0, 0.0185 * s), ps(0, -0.51 * s, 0, 0.003 * s)], {
    ref: [1, 0, 0], rings: 4, sides: 8, start: 'round', end: 'round', capDepth: [0.008 * s, 0.004 * s], color: iron, mat: 'iron',
  });
  kit.loft([ps(0, (top - 0.04) * s, 0, 0.0215 * s), ps(0, top * s, 0, 0.027 * s), ps(0, (top + 0.055) * s, 0, 0.0215 * s)], {
    ref: [1, 0, 0], rings: 5, sides: 10, start: null, end: null, color: shadeC(metal, 0.72), mat: guandao ? 'gold' : 'metal',
  });
  const edge = (o, x, y, z, u) => mul(o, 0.86 + 0.3 * sstep(0.55, 1, u));
  if (guandao) {
    const blade = [[0.03, 0.84], [0.075, 0.9], [0.125, 0.98], [0.162, 1.07], [0.172, 1.15], [0.15, 1.24], [0.1, 1.32], [0.03, 1.375], [-0.015, 1.33], [-0.026, 1.22], [-0.022, 1.12],
      [-0.05, 1.07], [-0.03, 1.04], [-0.056, 0.98], [-0.032, 0.95], [-0.05, 0.9], [-0.03, 0.87]].map(([x, y]) => [x * s, y * s]);
    kit.slab(blade, { depth: 0.022 * s, bevel: 0.008 * s, color: metal, mat: 'metal', paint: edge });
    // the green inlay down the flat, showing on both faces
    kit.slab([[0.0, 0.93], [0.05, 0.99], [0.085, 1.07], [0.09, 1.15], [0.07, 1.24], [0.03, 1.3], [0.0, 1.24], [-0.005, 1.1], [-0.01, 0.99]].map(([x, y]) => [x * s, y * s]),
      { depth: 0.026 * s, bevel: 0.005 * s, color: mixC(pal.primary, '#2f8f6a', 0.3), mat: 'lacquer' });
    // the gold ring at the socket
    kit.loft([ps(0, 0.855 * s, 0, 0.03 * s), ps(0, 0.885 * s, 0, 0.034 * s), ps(0, 0.91 * s, 0, 0.026 * s)], { ref: [1, 0, 0], rings: 4, sides: 10, start: null, end: null, color: metal, mat: 'gold' });
  } else {
    const st = [[0.855, 0.017, 0.01], [0.9, 0.032, 0.0115], [0.975, 0.037, 0.012], [1.07, 0.03, 0.0105], [1.16, 0.014, 0.0065], [1.225, 0.002, 0.002]].map(([y, rx, rz]) => ps(0, y * s, 0, rx * s, rz * s, 1.6));
    kit.loft(st, {
      ref: [1, 0, 0], rings: 8, sides: 10, start: null, end: 'round', capRings: 2, capDepth: 0.03 * s, color: metal, mat: 'metal',
      paint: (o, x, y, z, u, a) => {
        const ang = a * TAU;
        mul(o, 0.9 + 0.16 * sstep(0.7, 1, Math.abs(Math.cos(ang))) - 0.12 * sstep(0.8, 1, Math.abs(Math.sin(ang))) * sstep(0.1, 0.4, u));
      },
    });
    // the crescent, hooking up from one side of the foot of the head
    kit.slab([[0.012, 0.8], [0.07, 0.79], [0.15, 0.8], [0.215, 0.845], [0.245, 0.92], [0.236, 1.0], [0.205, 0.96], [0.17, 0.92], [0.12, 0.895], [0.06, 0.89], [0.012, 0.9]].map(([x, y]) => [x * s, y * s]),
      { depth: 0.02 * s, bevel: 0.007 * s, color: metal, mat: 'metal', paint: edge });
  }
  // the tassel, streaming back from the socket
  const tc = tassel || TEAM(0.95, 'hair');
  const ty = (top + 0.02) * s;
  kit.loft([ps(0.004 * s, ty, 0, 0.014 * s), ps(0.02 * s, ty - 0.05 * s, 0, 0.036 * s), ps(0.032 * s, ty - 0.12 * s, 0, 0.04 * s), ps(0.04 * s, ty - 0.2 * s, 0, 0.03 * s), ps(0.04 * s, ty - 0.27 * s, 0, 0.008 * s)], {
    ref: [0, 0, 1], rings: 6, sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: [0.01 * s, 0.02 * s], color: tc, mat: 'hair',
    paint: (o, x, y, z, u, a) => mul(o, 0.8 + 0.3 * Math.abs(Math.sin(a * TAU * 5)) + 0.1 * u),
  });
}

/**
 * A crossbow held level before the archer: a wooden stock with a stirrup at its fore end, a broad prod curving back at its
 * tips, the string drawn back to the nut, a bolt laid in the groove. Lies along the grip's +X (the way it shoots), the limbs
 * along Z. opts.magazine: the repeating crossbow's box over the stock.
 */
function crossbow(kit, pal, s, { magazine = false } = {}) {
  const wood = pal.wood;
  const dark = pal.woodDark;
  const metal = pal.accentMetal;
  const y0 = 0.04 * s;
  const sec = (x, h, w) => ps(x * s, y0, 0, h * s, w * s, 3);
  kit.loft([sec(-0.3, 0.034, 0.017), sec(-0.2, 0.03, 0.016), sec(-0.05, 0.026, 0.0155), sec(0.1, 0.022, 0.015), sec(0.22, 0.02, 0.0145)], {
    ref: [0, 1, 0], rings: 8, sides: 10, start: 'round', end: 'round', capDepth: 0.014 * s, color: wood, mat: 'wood', paint: grain(0.1),
  });
  // the prod: a flat bow set across the fore end, its tips swept back
  const prod = [];
  for (let i = 0; i <= 10; i++) {
    const z = (i / 10 - 0.5) * 0.5;
    const k = Math.abs(z) / 0.25;
    prod.push(ps((0.2 - 0.06 * k * k) * s, y0 + 0.006 * s, z * s, (0.02 - 0.012 * k) * s, (0.0095 - 0.003 * k) * s));
  }
  kit.loft(prod, { ref: [0, 1, 0], rings: 12, sides: 6, start: 'round', end: 'round', capDepth: 0.008 * s, color: dark, mat: 'wood', paint: (o, x, y, z, u) => mul(o, 0.9 + 0.14 * Math.sin(u * 30) * Math.sin(u * PI)) });
  // the bridle that lashes it to the stock, the stirrup ahead of it, the trigger below
  kit.loft([ps(0.185 * s, y0, 0, 0.027 * s, 0.021 * s, 3), ps(0.215 * s, y0, 0, 0.027 * s, 0.021 * s, 3)], { ref: [0, 1, 0], sides: 10, start: null, end: null, color: metal, mat: 'metal' });
  const ring = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * TAU;
    ring.push(ps((0.25 + 0.026 * Math.cos(a)) * s, y0 + 0.026 * Math.sin(a) * s, 0, 0.0046 * s, 0.0046 * s));
  }
  kit.loft(ring, { ref: [0, 0, 1], sides: 5, start: null, end: null, color: metal, mat: 'metal' });
  kit.loft([ps(-0.06 * s, y0 - 0.02 * s, 0, 0.005 * s), ps(-0.066 * s, y0 - 0.056 * s, 0, 0.0045 * s)], { ref: [0, 0, 1], sides: 5, start: 'round', end: 'round', capDepth: 0.004 * s, color: metal, mat: 'metal' });
  // the string, drawn back in a V to the nut
  const str = [];
  for (let i = 0; i <= 8; i++) {
    const z = (i / 8 - 0.5) * 0.5;
    const k = Math.abs(z) / 0.25;
    str.push(ps((0.02 + (0.14 - 0.02) * k) * s, (0.074 - 0.016 * k) * s, z * s, 0.0034 * s, 0.0034 * s));
  }
  kit.loft(str, { ref: [0, 1, 0], sides: 4, start: null, end: null, color: mixC(pal.white, pal.leather, 0.3), mat: 'cloth' });
  // the bolt in its groove: a shaft with an iron head
  const yb = 0.074 * s;
  kit.loft([ps(0.02 * s, yb, 0, 0.0042 * s), ps(0.29 * s, yb, 0, 0.0042 * s)], { ref: [0, 1, 0], sides: 6, start: 'round', end: null, capDepth: 0.003 * s, color: shadeC(wood, 1.2), mat: 'wood' });
  kit.loft([ps(0.285 * s, yb, 0, 0.0065 * s), ps(0.325 * s, yb, 0, 0.0075 * s), ps(0.37 * s, yb, 0, 0.001 * s)], { ref: [0, 1, 0], rings: 4, sides: 6, start: null, end: 'round', capDepth: 0.003 * s, color: shadeC(pal.darkMetal, 1.2), mat: 'iron' });
  if (magazine) {
    kit.loft([ps(-0.03 * s, 0.1 * s, 0, 0.034 * s, 0.03 * s, 4), ps(0.07 * s, 0.1 * s, 0, 0.034 * s, 0.03 * s, 4), ps(0.17 * s, 0.1 * s, 0, 0.034 * s, 0.03 * s, 4)], {
      ref: [0, 1, 0], rings: 4, sides: 12, start: 'flat', end: 'flat', color: dark, mat: 'wood', paint: grain(0.12),
    });
    kit.loft([ps(-0.03 * s, 0.1 * s, 0, 0.037 * s, 0.033 * s, 4), ps(-0.015 * s, 0.1 * s, 0, 0.037 * s, 0.033 * s, 4)], { ref: [0, 1, 0], sides: 12, start: null, end: null, color: metal, mat: 'metal' });
    kit.loft([ps(0.155 * s, 0.1 * s, 0, 0.037 * s, 0.033 * s, 4), ps(0.17 * s, 0.1 * s, 0, 0.037 * s, 0.033 * s, 4)], { ref: [0, 1, 0], sides: 12, start: null, end: null, color: metal, mat: 'metal' });
  }
}

/** The Ruyi Jingu Bang: a long straight pole of dark red lacquer, banded in gold at both ends, the bands ridged. */
function ruyi(kit, pal, s) {
  const gold = pal.accentMetal;
  const lacquer = mixC(pal.secondary, '#1c0606', 0.5);
  kit.loft([ps(0, -0.64 * s, 0, 0.0205 * s), ps(0, 0, 0, 0.0215 * s), ps(0, 0.72 * s, 0, 0.0205 * s)], {
    ref: [1, 0, 0], rings: 8, sides: 10, start: null, end: null, color: lacquer, mat: 'lacquer', paint: (o, x, y, z, u) => mul(o, 0.92 + 0.1 * Math.sin(u * 20)),
  });
  for (const sg of [-1, 1]) {
    const a = sg > 0 ? 0.56 : -0.52;
    const b = sg > 0 ? 0.76 : -0.68;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    kit.loft([ps(0, lo * s, 0, 0.022 * s), ps(0, (lo + 0.03) * s, 0, 0.0315 * s), ps(0, (hi - 0.03) * s, 0, 0.0315 * s), ps(0, hi * s, 0, 0.0235 * s)], {
      ref: [1, 0, 0], rings: 6, sides: 12, start: sg > 0 ? null : 'round', end: sg > 0 ? 'round' : null, capDepth: 0.012 * s, color: gold, mat: 'gold', glow: 0.1,
    });
    for (const k of [0.3, 0.5, 0.7]) {
      const y = lo + (hi - lo) * k;
      kit.loft([ps(0, (y - 0.008) * s, 0, 0.0335 * s), ps(0, (y + 0.008) * s, 0, 0.0335 * s)], { ref: [1, 0, 0], sides: 12, start: null, end: null, color: shadeC(gold, 0.82), mat: 'gold' });
    }
  }
}

/**
 * A yue, the great ceremonial axe: a long haft under a broad head, its edge a wide round arc, a gold ring set in the blade,
 * a spike above. opts: shaftColor.
 */
function yue(kit, pal, s, { shaftColor = null } = {}) {
  const shaft = shaftColor || pal.wood;
  const head = pal.accentMetal;
  kit.loft([ps(0, -0.1 * s, 0, 0.022 * s), ps(0, 0.08 * s, 0, 0.0195 * s), ps(0, 0.3 * s, 0, 0.018 * s), ps(0, 0.58 * s, 0, 0.0185 * s)], {
    ref: [1, 0, 0], rings: 9, sides: 8, start: 'round', end: 'round', capDepth: 0.01 * s, color: shaft, mat: 'wood', paint: grain(0.1),
  });
  grip(kit, -0.08 * s, 0.1 * s, 0.0235 * s, pal.leather, 5);
  kit.loft([ps(0, -0.112 * s, 0, 0.026 * s), ps(0, -0.1 * s, 0, 0.028 * s)], { ref: [1, 0, 0], sides: 8, start: 'round', end: null, capDepth: 0.008 * s, color: shadeC(head, 0.75) });
  kit.loft([ps(0, 0.3 * s, 0, 0.03 * s, 0.032 * s), ps(0, 0.54 * s, 0, 0.03 * s, 0.032 * s)], { ref: [1, 0, 0], sides: 10, start: null, end: null, color: shadeC(head, 0.7), mat: 'iron' });
  // the spike over the head
  kit.loft([ps(0, 0.54 * s, 0, 0.026 * s), ps(0, 0.6 * s, 0, 0.016 * s), ps(0, 0.7 * s, 0, 0.002 * s)], { ref: [1, 0, 0], rings: 5, sides: 8, start: null, end: 'round', capDepth: 0.005 * s, color: head, mat: 'metal' });
  const y0 = 0.4 * s;
  const pts = [[-0.03, 0.12], [0.03, 0.14], [0.11, 0.17], [0.19, 0.16], [0.25, 0.11], [0.28, 0.03], [0.275, -0.05], [0.22, -0.13], [0.14, -0.18], [0.05, -0.18], [-0.03, -0.14]].map(([x, y]) => [x * s, y0 + y * s]);
  kit.slab(pts, { depth: 0.026 * s, bevel: 0.01 * s, color: head, mat: 'metal', paint: (o, x, y, z, u) => mul(o, 0.86 + 0.3 * sstep(0.55, 1, u)) });
  // the gold ring set in the blade, standing out on both faces
  const ring = [];
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * TAU;
    ring.push(ps((0.13 + 0.06 * Math.cos(a)) * s, y0 - 0.01 * s + 0.06 * Math.sin(a) * s, 0, 0.0085 * s, 0.0165 * s));
  }
  kit.loft(ring, { ref: [0, 0, 1], sides: 6, start: null, end: null, color: pal.accentMetal, mat: 'gold' });
}

/**
 * Add weapon `id` to `kit` in the grip frame (origin = palm, +Y along the weapon, blade
 * width along X, thickness along Z), like the low-poly addWeapon. opts.glowBlade: a flaming
 * blade; opts.runes: the runic glow color of a god's hammer. The double axe and the torch are built here but not in
 * RICH_WEAPONS: a pantheon's outfit asks for them (gear returns { build: true }), so those pantheons that use them
 * with the low-poly models keep them.
 */
export function richWeapon(kit, pal, id, s, opts = {}) {
  switch (id) {
    case 'sword': if (opts.macuahuitl) macuahuitl(kit, pal, s, opts); else sword(kit, pal, s, { flame: !!opts.glowBlade, blade: opts.blade || null, fitting: opts.fitting || null }); return true;
    case 'katana': katana(kit, pal, s); return true;
    case 'axe': if (opts.axe === 'yue') yue(kit, pal, s, opts); else axe(kit, pal, s, opts); return true;
    case 'hammer': hammer(kit, pal, s, { glow: opts.runes || null }); return true;
    case 'spear': spear(kit, pal, s, { runes: opts.runes || null, shaftColor: opts.shaftColor || null }); return true;
    case 'club': if (opts.macuahuitl) macuahuitl(kit, pal, s, opts); else club(kit, pal, s, opts); return true;
    case 'bow': if (opts.crossbow) crossbow(kit, pal, s, opts); else bow(kit, pal, s, opts); return true;
    case 'staff': if (opts.staff === 'shakujo') shakujo(kit, pal, s); else if (opts.staff === 'ruyi') ruyi(kit, pal, s); else if (opts.staff === 'druid') druidStaff(kit, pal, s, opts); else staff(kit, pal, s, opts); return true;
    case 'double_axe': doubleAxe(kit, pal, s, opts); return true;
    case 'torch': torch(kit, pal, s); return true;
    case 'halberd': halberd(kit, pal, s, opts); return true;
    default: return false;
  }
}

/**
 * A shield on the left forearm, in the elbow bone's frame (the forearm hangs below it): a shallow
 * dish with a rim, and what each people paints on and fits to it. style (all optional):
 *   w, h        half width and height of the face (0.2 each: a round shield), n squareness (2 = an ellipse)
 *   face        'team' (default: team painted), 'metal' (the unit's metal), 'dark' or a color; disc { k, color } a painted roundel on the face
 *   pattern     'wedges' (default, alternating wedges) | 'rings' | 'cross' | 'stripe' | 'checker' | null
 *   boss        'dome' (default) | 'spike' | null;  spine: a ridge up the middle;  studs: a ring of rivets
 *   rim         the rim color (default the unit's metal);  dish: how deep the face is;  dy: moves it down the arm
 *   puffs       5: balls of down on the face, one in the middle and four about it, puffColor their color (the sun god's shield)
 *   fringe      { n, colors, tip, len }: feathers hanging from the lower rim (the Mexica's chimalli)
 *   band        a band of metal inset all round the face, its outer edge at that fraction of the radius (bandColor: its color, default the rim's)
 *   roundels    [{ y, k, color, mat }]: studs down the face, y as a fraction of its half height from the middle, k their radius as a fraction of the half width
 */
export function richShield(ctx, D, style = {}) {
  const { pal } = ctx;
  const S = D.weaponSize > 1 ? 0.92 : 1;
  const W = (style.w ?? 0.2) * S;
  const H = (style.h ?? 0.2) * S;
  const n = style.n ?? 2;
  const sides = style.sides ?? 22;
  const kit = new MeshKit(null, { sides });
  const cy = -D.fore * 0.5 - (style.dy ?? 0);
  const z0 = -(D.armR + 0.05);
  const dish = style.dish ?? 0.03;
  const rim = style.rim ?? pal.accentMetal;
  const iron = shadeC(pal.darkMetal, 1.1);
  const colorOf = (c, shade = 0.9) => (!c || c === 'team' ? TEAM(shade, 'painted') : c === 'metal' ? pal.accentMetal : c === 'dark' ? iron : c);
  const faceColor = colorOf(style.face);
  const ring = (k, z) => ps(0, cy, z, W * k, H * k, n);
  const pattern = style.pattern === undefined ? 'wedges' : style.pattern;
  // the face in the shield's own units: r = 0 at the center, 1 at the rim
  const radial = (x, y) => {
    const dx = Math.abs(x / W);
    const dy = Math.abs((y - cy) / H);
    return n === 2 ? Math.hypot(dx, dy) : (dx ** n + dy ** n) ** (1 / n);
  };
  const dark = style.pattern === 'checker' || style.pattern === 'stripe' ? shadeC(pal.darkMetal, 0.8) : null;
  kit.loft([ring(0.98, z0), ring(0.97, z0 - 0.012), ring(0.62, z0 - dish)], {
    ref: [1, 0, 0], rings: 6, sides, start: 'round', end: 'round', capDepth: [0.006, dish], color: faceColor,
    paint: (o, x, y, z, u, a) => {
      const r = radial(x, y);
      if (pattern === 'wedges') {
        if (Math.floor((a * 8) % 2) === 1) mul(o, 0.72);
      } else if (pattern === 'rings') {
        mul(o, 0.8 + 0.2 * Math.cos(r * 5 * PI));
      } else if (pattern === 'cross') {
        const q = Math.abs(Math.abs(x / W) - Math.abs((y - cy) / H));
        if (q < 0.16 && r < 0.95) mul(o, 0.7);
      } else if (pattern === 'stripe') {
        if (Math.abs(x) < W * 0.09) dye(o, dark, 1);
        else if (Math.abs(Math.abs(x) - W * 0.5) < W * 0.04) mul(o, 0.8);
      } else if (pattern === 'checker') {
        const cx = Math.floor((x / W + 1) * 3);
        const cyy = Math.floor(((y - cy) / H + 1) * 4.5);
        if (r < 0.88 && (cx + cyy) % 2 === 0) dye(o, dark, 1);
      }
    },
  });
  if (style.disc) {
    const k = style.disc.k;
    kit.loft([ring(k, z0 - dish * 0.35), ring(k * 0.98, z0 - dish * 0.5 - 0.004), ring(k * 0.5, z0 - dish - 0.004)], {
      ref: [1, 0, 0], rings: 5, sides, start: 'round', end: 'round', capDepth: [0.004, 0.006], color: colorOf(style.disc.color, 0.95),
    });
  }
  // the dish's surface in depth, at radial fraction r (the face is a cone from the rim in toward the boss)
  const faceZ = (r) => (r >= 0.62 ? z0 - 0.012 - (dish - 0.012) * ((0.97 - Math.min(r, 0.97)) / 0.35) : z0 - dish - dish * 0.45 * (1 - r / 0.62) ** 2);
  if (style.band) {
    // a band of metal inset all round the face
    const k = style.band;
    kit.loft([ring(k, faceZ(k) - 0.003), ring(k - 0.045, faceZ(k - 0.045) - 0.003)], { ref: [1, 0, 0], sides, start: null, end: null, color: style.bandColor ? colorOf(style.bandColor) : rim, mat: style.rimMat });
  }
  if (style.roundels) {
    // studs of enamel and metal in a row down the face
    for (const r of style.roundels) {
      const yy = cy + r.y * H;
      const rr = Math.abs(r.y);
      const zf = faceZ(rr);
      const k = (r.k ?? 0.1) * W;
      kit.loft([ps(0, yy, zf - 0.002, k, k), ps(0, yy, zf - 0.008, k * 0.94, k * 0.94)], { ref: [1, 0, 0], sides: 12, start: 'round', end: 'round', capDepth: 0.006, color: colorOf(r.color || 'metal', 1), mat: r.mat });
    }
  }
  // the rim, a rolled edge all round
  kit.loft([ring(1.035, z0 + 0.004), ring(1.035, z0 - 0.02)], { ref: [1, 0, 0], sides, start: null, end: null, color: rim, mat: style.rimMat });
  if (style.boss !== null) {
    const spike = style.boss === 'spike';
    kit.loft([ring(0.24, z0 - dish * 0.67), ring(0.2, z0 - dish * 1.33), ps(0, cy, z0 - (spike ? 0.1 : dish * 1.93), W * (spike ? 0.02 : 0.06), H * (spike ? 0.02 : 0.06))], {
      ref: [1, 0, 0], rings: 5, sides: 14, start: null, end: 'round', capDepth: spike ? 0.03 : 0.014, color: iron,
    });
  }
  if (style.spine) {
    const zf = z0 - dish * 1.25;
    kit.loft([ps(0, cy - H * 0.96, zf, W * 0.07, 0.012), ps(0, cy, zf - 0.006, W * 0.1, 0.016), ps(0, cy + H * 0.96, zf, W * 0.07, 0.012)], {
      ref: [1, 0, 0], rings: 7, sides: 8, start: 'round', end: 'round', capDepth: 0.01, color: rim, mat: style.rimMat,
    });
  }
  if (style.studs) {
    const m = style.studs;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * TAU;
      const x = Math.cos(a) * W * 0.84;
      const y = cy + Math.sin(a) * H * 0.84;
      kit.loft([ps(x, y, z0 - dish * 0.4, 0.011), ps(x, y, z0 - dish * 0.4 - 0.012, 0.007)], { ref: [1, 0, 0], sides: 6, start: null, end: 'round', capDepth: 0.006, color: iron });
    }
  }
  if (style.puffs) {
    const pc = style.puffColor || pal.white;
    for (const [px, py] of style.puffs >= 5 ? [[0, 0], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]] : [[0, 0]]) {
      const x = px * W;
      const y = cy + py * H;
      const zz = z0 - dish * 1.2;
      kit.loft([ps(x, y, zz, 0.036, 0.036), ps(x, y, zz - 0.012, 0.036, 0.036)], { ref: [1, 0, 0], sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: 0.018, color: pc, mat: 'feather' });
    }
  }
  if (style.fringe) {
    const f = style.fringe;
    for (let i = 0; i < f.n; i++) {
      const a = PI * (1.1 + (f.n > 1 ? i / (f.n - 1) : 0.5) * 0.8); // the lower half of the rim
      const cx = Math.cos(a);
      const cs = Math.sin(a);
      feather(kit, [cx * W * 1.0, cy + cs * H * 1.0, z0 - 0.006], [cx * 0.5, cs * 0.35 - 0.8, 0], [0, 0, -1], f.len ?? 0.1, 0.021, {
        color: f.colors[i % f.colors.length], tip: f.tip || null, rows: 4, thick: 0.003, bend: [0, 0, -0.012],
      });
    }
  }
  const g = kit.build({ ground: 0, strength: 0.3 });
  g.deleteAttribute('skinIndex');
  g.deleteAttribute('skinWeight');
  return g;
}
