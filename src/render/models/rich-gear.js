// Hand-held gear for the rich humanoids (rich-humanoid.js): swords, axes and hammers built
// from smooth lofts and beveled plates instead of the low-poly boxes, in the same grip frame
// the low-poly weapons use (unit-parts.js addWeapon: origin = palm, +Y along the weapon).
// Anything not built here keeps its low-poly model.
import * as THREE from 'three';
import { MeshKit, ps } from './rich-kit.js';
import { shadeC, mixC, tintC } from './unit-geo.js';
import { gripRotation } from './unit-parts.js';

const PI = Math.PI;
const TAU = PI * 2;
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-9)));
  return t * t * (3 - 2 * t);
};
const mul = (o, k) => {
  o.r *= k;
  o.g *= k;
  o.b *= k;
};

/** Weapons the rich kit builds itself. */
export const RICH_WEAPONS = new Set(['sword', 'axe', 'hammer', 'spear', 'club', 'bow', 'staff']);

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
function grip(kit, y0, y1, r, color, bands = 4) {
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

function sword(kit, pal, s, { flame = false } = {}) {
  const steel = flame ? mixC(pal.accentMetal, '#ff9a3a', 0.4) : pal.accentMetal;
  const fitting = flame ? shadeC(pal.darkMetal, 0.9) : shadeC(pal.accentMetal, 0.78);
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
const grain = (k = 0.1) => (o, x, y, z, u) => mul(o, 0.94 + k * Math.sin(u * 23 + y * 11));

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

/** A knotted club: a gnarled trunk swelling to a heavy head ringed with iron-hard studs. */
function club(kit, pal, s, { color = null, studs = null } = {}) {
  const wood = color || pal.wood;
  const stud = studs || shadeC(wood, 0.55);
  kit.loft([ps(0, -0.08 * s, 0, 0.034 * s), ps(0, 0.05 * s, 0, 0.03 * s), ps(0, 0.22 * s, 0, 0.04 * s), ps(0, 0.38 * s, 0, 0.066 * s), ps(0, 0.5 * s, 0, 0.088 * s), ps(0, 0.58 * s, 0, 0.07 * s)], {
    ref: [1, 0, 0], rings: 12, sides: 10, start: 'round', end: 'round', capDepth: [0.014 * s, 0.045 * s], color: wood, mat: 'wood',
    warp: (p, a, u) => {
      // knots and burrs along the trunk
      const k = Math.max(0, Math.sin(u * 17 + a * 2.3)) ** 3 * 0.012 * s * (0.4 + u);
      p[0] += Math.cos(a) * k;
      p[2] += Math.sin(a) * k;
    },
    paint: (o, x, y, z, u) => mul(o, 0.8 + 0.3 * u + 0.08 * Math.sin(u * 40 + y * 9)),
  });
  grip(kit, -0.06 * s, 0.12 * s, 0.0375 * s, pal.leather, 4);
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

/** A recurved bow: tapering flat limbs curving away from the archer, a wrapped grip, horn nocks and a drawn-string line. */
function bow(kit, pal, s, { color = null } = {}) {
  const wood = color || pal.woodDark;
  const L = 0.84 * s;
  const at = (t) => {
    const k = Math.abs(t) * 2; // 0 at the grip, 1 at the tips
    const x = (0.108 * Math.cos(t * PI) ** 1.15 - 0.046 + 0.034 * sstep(0.62, 1, k)) * s;
    return [x, t * L];
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
    ref: [0, 0, 1], rings: 12, sides: 6, capRings: 2, start: 'round', end: 'round', capDepth: 0.01 * s, color: wood, mat: 'wood',
    paint: (o, x, y, z, u) => mul(o, 0.9 + 0.14 * Math.sin(u * 34) * Math.sin(u * PI)),
  });
  // leather-wrapped grip
  const g0 = at(-0.075);
  const g1 = at(0.075);
  kit.loft([ps(g0[0], g0[1], 0, 0.026 * s, 0.03 * s), ps(0.0 + at(0)[0], 0, 0, 0.0285 * s, 0.032 * s), ps(g1[0], g1[1], 0, 0.026 * s, 0.03 * s)], {
    ref: [0, 0, 1], rings: 5, sides: 8, start: null, end: null, color: pal.leather, mat: 'leather',
  });
  // horn nocks at the tips, and the string between them
  for (const sgn of [-1, 1]) {
    const [x, y] = at(sgn * 0.5);
    kit.loft([ps(x, y - sgn * 0.012 * s, 0, 0.012 * s), ps(x - 0.006 * s, y + sgn * 0.016 * s, 0, 0.008 * s)], {
      ref: [0, 0, 1], sides: 6, start: 'round', end: 'round', capDepth: 0.007 * s, color: pal.bone, mat: 'bone',
    });
  }
  const [x0, y0] = at(-0.5);
  const [x1, y1] = at(0.5);
  kit.loft([ps(x0 - 0.008 * s, y0, 0, 0.0035 * s), ps((x0 + x1) / 2 - 0.006 * s, 0, 0, 0.0035 * s), ps(x1 - 0.008 * s, y1, 0, 0.0035 * s)], {
    ref: [0, 0, 1], sides: 4, start: null, end: null, color: mixC(pal.white, pal.leather, 0.25), mat: 'cloth',
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
 * Add weapon `id` to `kit` in the grip frame (origin = palm, +Y along the weapon, blade
 * width along X, thickness along Z), like the low-poly addWeapon. opts.glowBlade: a flaming
 * blade; opts.runes: the runic glow color of a god's hammer.
 */
export function richWeapon(kit, pal, id, s, opts = {}) {
  switch (id) {
    case 'sword': sword(kit, pal, s, { flame: !!opts.glowBlade }); return true;
    case 'axe': axe(kit, pal, s, opts); return true;
    case 'hammer': hammer(kit, pal, s, { glow: opts.runes || null }); return true;
    case 'spear': spear(kit, pal, s, { runes: opts.runes || null }); return true;
    case 'club': club(kit, pal, s, opts); return true;
    case 'bow': bow(kit, pal, s, opts); return true;
    case 'staff': staff(kit, pal, s, opts); return true;
    default: return false;
  }
}
