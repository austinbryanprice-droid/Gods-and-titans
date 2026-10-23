// Head dressing for the rich humanoids: hair, beards, hoods, helmets and horns, lofted over the
// skull the body builds (rich-body.js addHeadAndNeck) and weighted to the head bone. The pantheon
// outfits (rich-outfits.js) choose among them.
import * as THREE from 'three';
import { shadeC, tintC } from './unit-geo.js';
import { vs, ps, smoothstep, mixBind } from './rich-kit.js';
import { torsoRing } from './rich-body.js';
import { clamp, lerp, gradY, paints, recolor, mul, hash, featherRows } from './rich-paint.js';
import { feather } from './rich-feathers.js';

const PI = Math.PI;
const TAU = PI * 2;
const wrap = (a) => (a > PI ? a - TAU : a);

/** A shade of a color that stays a team color when it is one. */
const shade = (c, k) => (c && c.team ? { team: c.team * k, mat: c.mat } : shadeC(c, k));

export function addHairCap(kit, D, pal, bind) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.011 * hs;
  const st = [
    vs(hy - 0.06 * hs, 0.088 * hs + g, 0.078 * hs + g, hx - 0.012 * hs),
    vs(hy - 0.008 * hs, 0.1 * hs + g, 0.088 * hs + g, hx),
    vs(hy + 0.035 * hs, 0.102 * hs + g, 0.09 * hs + g, hx - 0.002 * hs),
    vs(hy + 0.072 * hs, 0.095 * hs + g, 0.084 * hs + g, hx - 0.004 * hs),
    vs(hy + 0.1 * hs, 0.072 * hs + g, 0.066 * hs + g, hx - 0.006 * hs),
    vs(hy + 0.112 * hs, 0.04 * hs + g, 0.04 * hs + g, hx - 0.007 * hs),
  ];
  kit.loft(st, {
    rings: 9, start: null, end: 'round', capDepth: 0.02 * hs, color: pal.hair, mat: 'hair', bind: bind.head,
    warp: (p, a) => {
      const aa = wrap(a);
      // hairline: raised over the forehead, lower at the temples and the nape
      const line = hy + 0.058 * hs - 0.085 * hs * smoothstep(0.5, 1.35, Math.abs(aa));
      if (p[1] < line) p[1] = line;
    },
    paint: gradY(hy - 0.06 * hs, hy + 0.11 * hs, 0.85, 1.12),
  });
}

export function addLongHair(kit, D, pal, bind) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  kit.loft([
    ps(hx - 0.082 * hs, hy + 0.03 * hs, 0, 0.026 * hs, 0.085 * hs),
    ps(hx - 0.1 * hs, hy - 0.06 * hs, 0, 0.03 * hs, 0.085 * hs),
    ps(hx - 0.115 * hs, hy - 0.16 * hs, 0, 0.032 * hs, 0.082 * hs),
    ps(hx - 0.13 * hs, hy - 0.26 * hs, 0, 0.026 * hs, 0.066 * hs),
    ps(hx - 0.14 * hs, hy - 0.34 * hs, 0, 0.012 * hs, 0.036 * hs),
  ], { ref: [1, 0, 0], rings: 8, sides: 10, start: null, end: 'round', capDepth: 0.02 * hs, color: pal.hair, mat: 'hair', bind: bind.hair, paint: gradY(hy - 0.34 * hs, hy, 0.82, 1.04) });
}

export function addBeard(kit, D, pal, bind, fiery = false) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  kit.loft([
    ps(hx + 0.07 * hs, hy - 0.06 * hs, 0, 0.034 * hs, 0.078 * hs),
    ps(hx + 0.088 * hs, hy - 0.115 * hs, 0, 0.046 * hs, 0.074 * hs),
    ps(hx + 0.082 * hs, hy - 0.19 * hs, 0, 0.044 * hs, 0.06 * hs),
    ps(hx + 0.07 * hs, hy - 0.265 * hs, 0, 0.03 * hs, 0.034 * hs),
  ], { ref: [1, 0, 0], rings: 8, sides: 12, start: 'round', end: 'round', capDepth: [0.02 * hs, 0.03 * hs], color: pal.hair, mat: 'hair', bind: bind.head,
    paint: fiery ? (o, x, y, z, u) => {
      // embers: dark at the roots, burning orange to a hot tip
      const t = smoothstep(0.0, 1.0, u);
      o.r = lerp(0.2, pal.fire.r, t) + 0.2 * t * t;
      o.g = lerp(0.03, pal.fire.g, t) + 0.25 * t * t * t;
      o.b = lerp(0.015, pal.fire.b, t);
      o.glow = 0.55 * t;
    } : gradY(hy - 0.265 * hs, hy - 0.06 * hs, 0.82, 1.04) });
  addMoustache(kit, D, pal, bind);
}

/** The moustache: a slim tube swept out and down over each side of the lip. */
export function addMoustache(kit, D, pal, bind) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  for (const side of [1, -1]) {
    kit.loft([ps(hx + 0.095 * hs, hy - 0.04 * hs, side * 0.004 * hs, 0.012 * hs, 0.018 * hs), ps(hx + 0.093 * hs, hy - 0.046 * hs, side * 0.034 * hs, 0.012 * hs, 0.016 * hs),
      ps(hx + 0.08 * hs, hy - 0.062 * hs, side * 0.06 * hs, 0.01 * hs, 0.012 * hs)], { ref: [1, 0, 0], sides: 6, capDepth: 0.01 * hs, color: pal.hair, mat: 'hair', bind: bind.head });
  }
}

export function addHood(kit, D, pal, bind, color, trim) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const arc0 = 0.62;
  const arc1 = TAU - 0.62;
  const prof = [
    [0.0, 0.0, 0.134], [0.1, 0.05, 0.126], [0.22, 0.088, 0.105], [0.36, 0.108, 0.07], [0.5, 0.113, 0.03],
    [0.68, 0.118, -0.05], [0.85, 0.132, -0.105], [1.0, 0.17, -0.17],
  ];
  const at = (v) => {
    const t = clamp(v) * (prof.length - 1);
    const i = Math.min(prof.length - 2, Math.floor(t));
    const f = t - i;
    return [lerp(prof[i][1], prof[i + 1][1], f), lerp(prof[i][2], prof[i + 1][2], f)];
  };
  const fn = (u, v, out) => {
    const a = lerp(arc0, arc1, u);
    const [r, dy] = at(v);
    const back = Math.exp(-(((Math.abs(wrap(a)) - PI) / 0.55) ** 2));
    const rr = r * hs + 0.012 * hs * Math.min(1, v * 5);
    out[0] = hx + Math.cos(a) * rr * 1.02 - back * 0.04 * hs * smoothstep(0.35, 1, v);
    out[1] = hy + dy * hs - back * 0.012 * hs * smoothstep(0.5, 1, v);
    out[2] = Math.sin(a) * rr * (0.94 + 0.1 * v);
  };
  kit.sheet(14, 10, fn, {
    thick: 0.008 * hs, color, inner: shadeC(color, 0.55), bind: (x, y, z, S) => bind.neck(x, y, z, S),
    paint: paints(gradY(hy - 0.2 * hs, hy + 0.1 * hs, 0.78, 1.06)),
  });
  void trim;
}

/**
 * The shell of a helmet: dome, brow band, nasal and cheek guards, weighted to the head bone.
 * opts: nasal, cheeks (both default on), neck (a flared guard over the nape), g (extra clearance).
 */
export function helmShell(kit, D, bind, steel, trim, { nasal = true, cheeks = true, neck = false } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.012 * hs;
  const dome = [
    vs(hy + 0.0 * hs, 0.097 * hs + g, 0.086 * hs + g, hx),
    vs(hy + 0.035 * hs, 0.102 * hs + g, 0.09 * hs + g, hx - 0.002 * hs),
    vs(hy + 0.072 * hs, 0.095 * hs + g, 0.084 * hs + g, hx - 0.004 * hs),
    vs(hy + 0.102 * hs, 0.072 * hs + g, 0.066 * hs + g, hx - 0.006 * hs),
    vs(hy + 0.118 * hs, 0.036 * hs + g, 0.036 * hs + g, hx - 0.007 * hs),
  ];
  kit.loft(dome, { rings: 8, sides: 16, start: null, end: 'round', capDepth: 0.024 * hs, color: steel, bind: bind.head, paint: gradY(hy, hy + 0.12 * hs, 0.82, 1.12) });
  // brow band
  kit.loft([vs(hy + 0.016 * hs, 0.099 * hs + g + 0.004, 0.088 * hs + g + 0.004, hx), vs(hy + 0.052 * hs, 0.103 * hs + g + 0.004, 0.092 * hs + g + 0.004, hx - 0.002 * hs)],
    { sides: 16, start: null, end: null, color: trim, bind: bind.head });
  if (nasal) {
    kit.loft([ps(hx + 0.095 * hs, hy + 0.045 * hs, 0, 0.007 * hs, 0.011 * hs), ps(hx + 0.108 * hs, hy - 0.002 * hs, 0, 0.007 * hs, 0.011 * hs), ps(hx + 0.108 * hs, hy - 0.042 * hs, 0, 0.007 * hs, 0.013 * hs)],
      { ref: [1, 0, 0], sides: 6, capDepth: 0.006 * hs, color: steel, bind: bind.head });
  }
  if (cheeks) {
    for (const side of [1, -1]) {
      kit.loft([ps(hx + 0.01 * hs, hy - 0.002 * hs, side * 0.094 * hs, 0.05 * hs, 0.01 * hs), ps(hx + 0.01 * hs, hy - 0.05 * hs, side * 0.088 * hs, 0.04 * hs, 0.008 * hs)],
        { ref: [1, 0, 0], sides: 8, capDepth: 0.008 * hs, color: shadeC(steel, 0.9), bind: bind.head });
    }
  }
  if (neck) {
    // a flared neck guard over the nape
    kit.loft([vs(hy + 0.012 * hs, 0.1 * hs + g, 0.09 * hs + g, hx), vs(hy - 0.045 * hs, 0.112 * hs + g, 0.104 * hs + g, hx - 0.012 * hs), vs(hy - 0.085 * hs, 0.128 * hs + g, 0.118 * hs + g, hx - 0.026 * hs)],
      { rings: 4, sides: 20, start: null, end: null, color: shadeC(steel, 0.88), bind: bind.head,
        // open at the face: the front of the flare folds back up to the brow band
        warp: (p, a) => { const k = smoothstep(1.05, 1.75, Math.abs(wrap(a))); p[1] = lerp(hy + 0.012 * hs, p[1], k); } });
  }
  return g;
}

export function addHornedHelm(kit, D, pal, bind, steel, trim, horn) {
  const g = helmShell(kit, D, bind, steel, trim);
  addHornPair(kit, D, bind, horn, g);
}

/**
 * A helmet with a crest: 'fin' (a team-colored fin from brow to nape, readable from the game
 * camera), 'brush' (a tall horsehair brush), 'none'. opts: steel, trim, crestColor, neck.
 */
export function addHelmet(kit, D, pal, bind, { steel, trim, crest = 'fin', crestColor, neck = false, nasal = true, cheeks = true } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  helmShell(kit, D, bind, steel, trim, { nasal, cheeks, neck });
  if (crest === 'fin') {
    const o = [
      [hx + 0.066 * hs, hy + 0.095 * hs], [hx + 0.058 * hs, hy + 0.14 * hs], [hx + 0.02 * hs, hy + 0.19 * hs], [hx - 0.03 * hs, hy + 0.2 * hs],
      [hx - 0.078 * hs, hy + 0.165 * hs], [hx - 0.112 * hs, hy + 0.098 * hs], [hx - 0.1 * hs, hy + 0.074 * hs], [hx - 0.055 * hs, hy + 0.1 * hs], [hx + 0.01 * hs, hy + 0.108 * hs],
    ];
    kit.slab(o, { depth: 0.024 * hs, bevel: 0.008 * hs, color: crestColor, mat: 'painted', bind: bind.head, paint: gradY(hy + 0.08 * hs, hy + 0.2 * hs, 0.86, 1.08) });
  } else if (crest === 'brush') {
    const o = [
      [hx + 0.07 * hs, hy + 0.092 * hs], [hx + 0.064 * hs, hy + 0.16 * hs], [hx + 0.03 * hs, hy + 0.235 * hs], [hx - 0.03 * hs, hy + 0.27 * hs], [hx - 0.1 * hs, hy + 0.252 * hs],
      [hx - 0.16 * hs, hy + 0.19 * hs], [hx - 0.19 * hs, hy + 0.1 * hs], [hx - 0.185 * hs, hy + 0.01 * hs], [hx - 0.15 * hs, hy + 0.06 * hs], [hx - 0.09 * hs, hy + 0.096 * hs], [hx + 0.0, hy + 0.108 * hs],
    ];
    kit.slab(o, {
      depth: 0.03 * hs, bevel: 0.01 * hs, color: crestColor, mat: 'hair', bind: bind.head,
      paint: (o2, x, y, z, u, a) => {
        // bristles: bands radiating from the base of the brush
        const k = 0.88 + 0.16 * Math.sin((u * 36 + a * 7) + Math.sin(a * 11));
        o2.team ? (o2.team *= k) : ((o2.r *= k), (o2.g *= k), (o2.b *= k));
      },
    });
  }
}

/** A helmet with feathered wings at the temples (a god's), the feathers swept up and back and splayed out. */
export function addWingedHelm(kit, D, pal, bind, { steel, trim, feather: fcol, tip }) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  helmShell(kit, D, bind, steel, trim);
  const g = 0.012 * hs;
  for (const side of [1, -1]) {
    const root = [hx - 0.012 * hs, hy + 0.055 * hs, side * (0.094 * hs + g)];
    const fan = [[0.34, 0.2], [0.55, 0.23], [0.78, 0.2], [1.0, 0.16]];
    fan.forEach(([a, len], i) => {
      // a swept fan: back and up, each feather splayed outward more than the one before it
      const dir = [-Math.cos(a * 1.35) * 0.9, Math.sin(a * 1.35), side * (0.28 + 0.12 * i)];
      feather(kit, root, dir, [0.2, 0.55, side * 1], len * hs, 0.034 * hs, { color: fcol, tip, bind: bind.head, bend: [-0.02 * hs, -0.015 * hs, side * 0.02 * hs], thick: 0.0026 * hs });
    });
  }
}

/** A circlet over the brow with a raised leaf and a gem at the front (a goddess's). */
export function addTiara(kit, D, pal, bind, { metal, gem, height = 1 } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.011 * hs + 0.007 * hs;
  kit.loft([vs(hy + 0.058 * hs, 0.098 * hs + g, 0.087 * hs + g, hx - 0.002 * hs), vs(hy + 0.078 * hs, 0.097 * hs + g, 0.086 * hs + g, hx - 0.003 * hs)],
    { sides: 20, start: null, end: null, color: metal, mat: 'gold', bind: bind.head });
  // the raised leaf at the front, a gem at its foot
  const fx = hx + 0.1 * hs + 0.011 * hs;
  kit.loft([ps(fx, hy + 0.062 * hs, 0, 0.0045 * hs, 0.016 * hs), ps(fx + 0.002 * hs, hy + 0.1 * hs * height, 0, 0.004 * hs, 0.011 * hs), ps(fx + 0.003 * hs, hy + 0.135 * hs * height, 0, 0.003 * hs, 0.003 * hs)],
    { ref: [1, 0, 0], rings: 5, sides: 6, start: null, end: 'round', capDepth: 0.004 * hs, color: metal, mat: 'gold', bind: bind.head });
  kit.loft([ps(fx + 0.003 * hs, hy + 0.066 * hs, 0, 0.007 * hs, 0.012 * hs), ps(fx + 0.0065 * hs, hy + 0.068 * hs, 0, 0.0075 * hs, 0.0125 * hs)],
    { ref: [1, 0, 0], sides: 8, start: 'round', end: 'round', capDepth: 0.005 * hs, color: gem, mat: 'gem', glow: 0.7, bind: bind.head });
  // two small side leaves
  for (const side of [1, -1]) {
    const z = side * 0.034 * hs;
    kit.loft([ps(fx - 0.004 * hs, hy + 0.062 * hs, z, 0.0035 * hs, 0.01 * hs), ps(fx - 0.003 * hs, hy + 0.088 * hs * height, z * 1.15, 0.003 * hs, 0.006 * hs), ps(fx - 0.002 * hs, hy + 0.103 * hs * height, z * 1.3, 0.002 * hs, 0.002 * hs)],
      { ref: [1, 0, 0], rings: 4, sides: 6, start: null, end: 'round', capDepth: 0.003 * hs, color: metal, mat: 'gold', bind: bind.head });
  }
}

/** Curved horns out of the temples, sweeping up and forward (bare-headed horned units, and on a helmet). */
export function addHornPair(kit, D, bind, horn, g = 0, big = 1) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  for (const side of [1, -1]) {
    const z0 = side * (0.092 * hs + g);
    kit.loft([
      ps(hx - 0.004 * hs, hy + 0.058 * hs, z0, 0.022 * hs * big),
      ps(hx - 0.01 * hs, hy + 0.082 * hs, z0 + side * 0.05 * hs * big, 0.019 * hs * big),
      ps(hx + 0.0 * hs, hy + 0.138 * hs, z0 + side * 0.098 * hs * big, 0.014 * hs * big),
      ps(hx + 0.024 * hs, hy + 0.2 * hs * big, z0 + side * 0.108 * hs * big, 0.008 * hs * big),
      ps(hx + 0.05 * hs, hy + 0.238 * hs * big, z0 + side * 0.098 * hs * big, 0.003 * hs * big),
    ], { ref: [1, 0, 0], rings: 9, sides: 8, start: 'round', end: 'round', capDepth: [0.012 * hs, 0.004 * hs], color: horn, mat: 'bone', bind: bind.head, paint: gradY(hy + 0.05 * hs, hy + 0.24 * hs * big, 0.78, 1.1) });
  }
}

const unit3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * A wreath of leaves round the brow, tied at the nape, the leaves sweeping forward and out from the
 * stem (laurel, olive; a god's is gold). opts: leaf (color), per (leaves a side), big (leaf length scale).
 */
export function addLaurel(kit, D, pal, bind, { leaf, per = 8, big = 1, mat = 'cloth' } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.011 * hs + 0.005 * hs;
  const y0 = hy + 0.052 * hs;
  const rx = 0.1 * hs + g;
  const rz = 0.088 * hs + g;
  const cx = hx - 0.002 * hs;
  kit.loft([vs(y0 - 0.005 * hs, rx, rz, cx), vs(y0 + 0.005 * hs, rx + 0.001, rz + 0.001, cx)],
    { sides: 22, start: null, end: null, color: shadeC(leaf, 0.55), mat: 'leather', bind: bind.head });
  for (const side of [1, -1]) {
    for (let i = 0; i < per; i++) {
      const k = i / (per - 1);
      const th = lerp(PI - 0.2, 0.42, k);
      const root = [cx + Math.cos(th) * rx, y0, side * Math.sin(th) * rz];
      // toward the front along the stem, out from it, a little up: alternate leaves lean out and in
      const out = i % 2 ? 0.55 : 0.2;
      const dir = unit3([Math.sin(th) * rx, 0.22, -side * Math.cos(th) * rz]);
      const radial = [Math.cos(th), 0, side * Math.sin(th)];
      const d = unit3([dir[0] + radial[0] * out, dir[1] + (i % 2 ? 0.2 : -0.05), dir[2] + radial[2] * out]);
      feather(kit, root, d, [0, 1, 0], 0.066 * hs * big * (0.9 + 0.2 * Math.sin(k * PI)), 0.0165 * hs * big, {
        color: i % 2 ? shadeC(leaf, 0.86) : leaf, mat, bind: bind.head, rows: 3, shape: 0.5, cup: 0.12, thick: 0.002 * hs,
      });
    }
  }
}

/**
 * A crown: a band round the brow with points standing up from it, the one over the forehead tallest
 * and a stone set in the band. opts: metal, gem, points, height (scale of the points), band (height).
 */
export function addCrown(kit, D, pal, bind, { metal, gem, points = 5, height = 1, band = 0.028, mat = 'gold' } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.011 * hs + 0.007 * hs;
  const y0 = hy + 0.05 * hs;
  const rx = 0.1 * hs + g;
  const rz = 0.088 * hs + g;
  const cx = hx - 0.002 * hs;
  kit.loft([vs(y0, rx, rz, cx), vs(y0 + band * hs * 0.5, rx + 0.002, rz + 0.002, cx), vs(y0 + band * hs, rx, rz, cx)],
    { rings: 3, sides: 24, start: null, end: null, color: metal, mat, bind: bind.head });
  for (let i = 0; i < points; i++) {
    const th = (i / points) * TAU;
    const front = (Math.cos(th) + 1) / 2;
    const h = (0.06 + 0.04 * front) * hs * height;
    const px = cx + Math.cos(th) * (rx - 0.002);
    const pz = Math.sin(th) * (rz - 0.002);
    const lean = 0.012 * hs;
    const ox = Math.cos(th) * lean;
    const oz = Math.sin(th) * lean;
    const base = y0 + band * hs * 0.8;
    kit.loft([ps(px, base, pz, 0.016 * hs, 0.011 * hs), ps(px + ox * 0.5, base + h * 0.55, pz + oz * 0.5, 0.011 * hs, 0.008 * hs), ps(px + ox, base + h, pz + oz, 0.002 * hs)],
      { ref: [Math.cos(th), 0, Math.sin(th)], rings: 5, sides: 6, start: null, end: 'round', capDepth: 0.006 * hs, color: metal, mat, bind: bind.head });
  }
  // a stone in the band over the brow
  const fx = cx + rx + 0.002;
  kit.loft([ps(fx, y0 + band * hs * 0.5, 0, 0.008 * hs, 0.011 * hs), ps(fx + 0.01 * hs, y0 + band * hs * 0.5, 0, 0.0085 * hs, 0.0115 * hs)],
    { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capDepth: 0.006 * hs, color: gem, mat: 'gem', glow: 0.7, bind: bind.head });
}

/**
 * A tall crown rising from the brow: a band, a body that narrows and then flares, and a ring of
 * spikes round the top (a king of the dead's, a lord of the sky's). opts: metal, trim, gem, height,
 * spikes (count), taper (how far the body narrows).
 */
export function addTallCrown(kit, D, pal, bind, { metal, trim, gem, height = 1, spikes = 8, taper = 0.84, mat = 'metal' } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.011 * hs + 0.008 * hs;
  const y0 = hy + 0.05 * hs;
  const rx = 0.1 * hs + g;
  const rz = 0.088 * hs + g;
  const cx = hx - 0.002 * hs;
  const H = 0.19 * hs * height;
  kit.loft([
    vs(y0, rx, rz, cx), vs(y0 + 0.03 * hs, rx * 1.01, rz * 1.01, cx), vs(y0 + H * 0.35, rx * (0.4 + 0.6 * taper), rz * (0.4 + 0.6 * taper), cx - 0.004 * hs),
    vs(y0 + H * 0.7, rx * taper, rz * taper, cx - 0.008 * hs), vs(y0 + H, rx * (taper + 0.06), rz * (taper + 0.06), cx - 0.01 * hs),
  ], {
    rings: 9, sides: 24, start: null, end: null, color: metal, mat,
    // vertical fluting up the body of the crown
    warp: (p, a, u) => {
      const f = 0.007 * hs * Math.sin(a * 12) * smoothstep(0.1, 0.4, u);
      p[0] += Math.cos(a) * f;
      p[2] += Math.sin(a) * f;
    },
    paint: gradY(y0, y0 + H, 0.8, 1.12), bind: bind.head,
  });
  // a band of trim at the foot and a rim at the top
  kit.loft([vs(y0 - 0.002, rx * 1.012, rz * 1.012, cx), vs(y0 + 0.022 * hs, rx * 1.02, rz * 1.02, cx)], { sides: 24, start: null, end: null, color: trim, mat: 'gold', bind: bind.head });
  const topx = cx - 0.01 * hs;
  const rt = (taper + 0.06);
  kit.loft([vs(y0 + H - 0.012 * hs, rx * rt, rz * rt, topx), vs(y0 + H + 0.008 * hs, rx * (rt + 0.03), rz * (rt + 0.03), topx)], { sides: 24, start: null, end: null, color: trim, mat: 'gold', bind: bind.head });
  for (let i = 0; i < spikes; i++) {
    const th = (i / spikes) * TAU;
    const px = topx + Math.cos(th) * rx * (rt + 0.015);
    const pz = Math.sin(th) * rz * (rt + 0.015);
    const h = (0.065 + 0.02 * ((Math.cos(th) + 1) / 2)) * hs * height;
    kit.loft([ps(px, y0 + H, pz, 0.014 * hs, 0.011 * hs), ps(px + Math.cos(th) * 0.01 * hs, y0 + H + h * 0.6, pz + Math.sin(th) * 0.01 * hs, 0.009 * hs, 0.007 * hs), ps(px + Math.cos(th) * 0.016 * hs, y0 + H + h, pz + Math.sin(th) * 0.016 * hs, 0.0015 * hs)],
      { ref: [Math.cos(th), 0, Math.sin(th)], rings: 4, sides: 5, start: null, end: 'round', capDepth: 0.005 * hs, color: metal, mat, bind: bind.head });
  }
  // a stone over the brow
  const fx = cx + rx * 1.02;
  kit.loft([ps(fx, y0 + 0.012 * hs, 0, 0.01 * hs, 0.013 * hs), ps(fx + 0.011 * hs, y0 + 0.012 * hs, 0, 0.0105 * hs, 0.0135 * hs)],
    { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capDepth: 0.006 * hs, color: gem, mat: 'gem', glow: 0.8, bind: bind.head });
}

/** A third eye on the brow: an upright lens of glowing stone (a god's, a seer's). */
export function addForeheadEye(kit, D, pal, bind) {
  const hs = D.hs;
  const fx = D.headX + 0.1 * hs;
  const y = D.headCY + 0.064 * hs;
  kit.loft([ps(fx - 0.012 * hs, y, 0, 0.024 * hs, 0.0105 * hs), ps(fx + 0.002 * hs, y, 0, 0.021 * hs, 0.0085 * hs)],
    { ref: [0, 1, 0], sides: 8, start: null, end: 'round', capDepth: 0.005 * hs, color: tintC(pal.glow, 0.25), mat: 'gem', glow: 1, bind: bind.head });
}

// ---------------------------------------------------------------------------
// Egyptian headgear: the striped headcloth, the sun disk, the rearing cobra, plumes
// ---------------------------------------------------------------------------

/** A rearing cobra over the brow, its hood spread (the uraeus): metal, gold. x: where its front stands, if not at a human brow. */
export function addUraeus(kit, D, bind, metal, { y = 0.066, size = 1, x = null } = {}) {
  const hs = D.hs;
  const k = size * hs;
  const fx = x ?? D.headX + 0.1 * hs + 0.012 * hs;
  const y0 = D.headCY + y * hs;
  kit.loft([vs(y0, 0.007 * k, 0.011 * k, fx), vs(y0 + 0.022 * k, 0.006 * k, 0.018 * k, fx + 0.004 * k), vs(y0 + 0.04 * k, 0.005 * k, 0.012 * k, fx + 0.006 * k), vs(y0 + 0.052 * k, 0.0045 * k, 0.006 * k, fx + 0.007 * k)],
    { rings: 6, sides: 10, start: 'round', end: 'round', capDepth: 0.004 * k, color: metal, mat: 'gold', bind: bind.head });
  kit.loft([ps(fx + 0.004 * k, y0 + 0.052 * k, 0, 0.0055 * k, 0.0055 * k), ps(fx + 0.019 * k, y0 + 0.05 * k, 0, 0.0045 * k, 0.0045 * k)],
    { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capDepth: 0.004 * k, color: metal, mat: 'gold', bind: bind.head });
}

/** A stripe ring on a head dome: a thin band of `color` at height dy over the head's middle (in head scales), hugging the dome profile. */
function domeBand(kit, D, bind, dy, g, color, mat = undefined) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  // the head's ellipse at this height (the human skull's stations)
  const prof = [[-0.008, 0.1, 0.088, 0], [0.035, 0.102, 0.09, -0.002], [0.072, 0.095, 0.084, -0.004], [0.1, 0.072, 0.066, -0.006], [0.112, 0.04, 0.04, -0.007]];
  let i = 0;
  while (i < prof.length - 2 && dy > prof[i + 1][0]) i++;
  const t = clamp((dy - prof[i][0]) / (prof[i + 1][0] - prof[i][0]));
  const at = (c) => lerp(prof[i][c], prof[i + 1][c], t);
  const rx = at(1) * hs + g;
  const rz = at(2) * hs + g;
  const cx = hx + at(3) * hs;
  kit.loft([vs(hy + (dy - 0.0075) * hs, rx, rz, cx), vs(hy + (dy + 0.0075) * hs, rx, rz, cx)], { sides: 22, start: null, end: null, color, mat, bind: bind.head });
}

/**
 * The striped royal headcloth: a dome over the skull with a brow band and gold stripes, a lappet
 * hanging in front of each shoulder and a queue down the back. opts: cloth (the main color, a team
 * color for the people's), stripe, trim (the band), tail (the queue, off under a cape).
 */
export function addNemes(kit, D, pal, bind, { cloth, stripe, trim, tail = true } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.017 * hs;
  const dome = [
    vs(hy - 0.06 * hs, 0.088 * hs + g, 0.078 * hs + g, hx - 0.012 * hs),
    vs(hy - 0.008 * hs, 0.1 * hs + g, 0.088 * hs + g, hx),
    vs(hy + 0.035 * hs, 0.102 * hs + g, 0.09 * hs + g, hx - 0.002 * hs),
    vs(hy + 0.072 * hs, 0.095 * hs + g, 0.084 * hs + g, hx - 0.004 * hs),
    vs(hy + 0.1 * hs, 0.072 * hs + g, 0.066 * hs + g, hx - 0.006 * hs),
    vs(hy + 0.112 * hs, 0.04 * hs + g, 0.04 * hs + g, hx - 0.007 * hs),
  ];
  kit.loft(dome, {
    rings: 9, sides: 22, start: null, end: 'round', capDepth: 0.022 * hs, color: cloth, bind: bind.head,
    warp: (p, a) => {
      const aa = wrap(a);
      // the front edge rides the brow, the sides drop to the ears and the back to the nape
      const line = hy + 0.05 * hs - 0.075 * hs * smoothstep(0.5, 1.35, Math.abs(aa));
      if (p[1] < line) p[1] = line;
    },
    paint: gradY(hy - 0.06 * hs, hy + 0.11 * hs, 0.86, 1.08),
  });
  // gold stripes across the crown and a band over the brow
  for (const dy of [0.062, 0.082, 0.1]) domeBand(kit, D, bind, dy, g + 0.002 * hs, stripe, 'gold');
  kit.loft([vs(hy + 0.046 * hs, 0.1 * hs + g + 0.005 * hs, 0.088 * hs + g + 0.005 * hs, hx), vs(hy + 0.058 * hs, 0.102 * hs + g + 0.005 * hs, 0.09 * hs + g + 0.005 * hs, hx - 0.002 * hs)],
    { sides: 22, start: null, end: null, color: trim, mat: 'gold', bind: bind.head });
  // the lappets: flat bands from the temples over the shoulders to the chest, striped along their length
  const strip = (paintFn) => ({ ref: [1, 0, 0], rings: 7, sides: 8, start: 'round', end: 'flat', capDepth: 0.004 * hs, color: cloth, bind: bind.neck, paint: paintFn });
  const bands = (o, x, y, z, u) => {
    if (Math.floor(u * 8.5) % 2 === 1) recolor(o, stripe, 1);
  };
  for (const side of [1, -1]) {
    const z = side * 0.098 * hs;
    const frontAt = (y, clear) => {
      const f = clamp((y - D.hipY) / (D.shoulderY - D.hipY), 0, 1.09);
      const r = torsoRing(D, f, clear);
      return r.dx + r.rx * Math.sqrt(Math.max(0, 1 - (z / r.rz) ** 2));
    };
    const y1 = hy - 0.1 * hs;
    const y2 = hy - 0.19 * hs;
    const y3 = hy - 0.29 * hs;
    kit.loft([
      ps(hx - 0.004 * hs, hy + 0.0 * hs, z, 0.008 * hs, 0.04 * hs),
      ps(hx + 0.012 * hs, y1, z * 1.02, 0.008 * hs, 0.05 * hs),
      ps(Math.max(hx + 0.03 * hs, frontAt(y2, 0.022)), y2, z * 1.0, 0.008 * hs, 0.058 * hs),
      ps(frontAt(y3, 0.024), y3, z * 0.98, 0.008 * hs, 0.064 * hs),
    ], strip(bands));
  }
  // the queue down the back
  if (tail) {
    const backAt = (y) => {
      const f = clamp((y - D.hipY) / (D.shoulderY - D.hipY), 0, 1.09);
      const r = torsoRing(D, f, 0.02);
      return r.dx - r.rx;
    };
    const ys = [hy - 0.04 * hs, hy - 0.12 * hs, hy - 0.22 * hs, hy - 0.34 * hs];
    kit.loft(ys.map((y, i) => ps(i === 0 ? hx - 0.1 * hs : Math.min(hx - 0.1 * hs, backAt(y) - 0.006), y, 0, 0.01 * hs, (0.034 - i * 0.003) * hs)),
      { ref: [1, 0, 0], rings: 6, sides: 8, start: 'round', end: 'flat', capDepth: 0.004 * hs, color: cloth, bind: bind.neck, paint: bands });
  }
  addUraeus(kit, D, bind, trim);
}

/**
 * The double crown: the red crown (a cap with a tall plate rising behind it) and the tall white crown
 * standing in it, slim enough to stand between the ears of an animal head, a cobra at its front.
 * opts: white, red, metal.
 */
export function addDoubleCrown(kit, D, pal, bind, { white, red, metal } = {}) {
  const hs = D.hs;
  const hy = D.headCY;
  const cx = D.headX - 0.012 * hs;
  kit.loft([
    vs(hy + 0.092 * hs, 0.054 * hs, 0.046 * hs, cx),
    vs(hy + 0.13 * hs, 0.05 * hs, 0.042 * hs, cx),
    vs(hy + 0.18 * hs, 0.044 * hs, 0.036 * hs, cx - 0.002 * hs),
    vs(hy + 0.215 * hs, 0.034 * hs, 0.028 * hs, cx - 0.004 * hs),
  ], { rings: 6, sides: 18, start: null, end: 'round', capDepth: 0.012 * hs, color: red, mat: 'trim', bind: bind.head });
  // the tall plate behind the red crown
  kit.loft([vs(hy + 0.1 * hs, 0.011 * hs, 0.03 * hs, cx - 0.045 * hs), vs(hy + 0.2 * hs, 0.011 * hs, 0.034 * hs, cx - 0.054 * hs), vs(hy + 0.3 * hs, 0.01 * hs, 0.03 * hs, cx - 0.066 * hs), vs(hy + 0.34 * hs, 0.008 * hs, 0.02 * hs, cx - 0.072 * hs)],
    { rings: 6, sides: 10, start: null, end: 'round', capDepth: 0.006 * hs, color: red, mat: 'trim', bind: bind.head });
  // the white crown: a tall bulb narrow at the foot
  kit.loft([
    vs(hy + 0.17 * hs, 0.028 * hs, 0.023 * hs, cx),
    vs(hy + 0.25 * hs, 0.032 * hs, 0.026 * hs, cx),
    vs(hy + 0.33 * hs, 0.037 * hs, 0.03 * hs, cx),
    vs(hy + 0.385 * hs, 0.036 * hs, 0.029 * hs, cx),
    vs(hy + 0.425 * hs, 0.024 * hs, 0.02 * hs, cx),
  ], { rings: 8, sides: 18, start: null, end: 'round', capDepth: 0.012 * hs, color: white, mat: 'trim', bind: bind.head, paint: gradY(hy + 0.17 * hs, hy + 0.43 * hs, 0.9, 1.06) });
  // a gold band where the red crown meets the skull
  kit.loft([vs(hy + 0.088 * hs, 0.056 * hs, 0.048 * hs, cx), vs(hy + 0.102 * hs, 0.055 * hs, 0.047 * hs, cx)], { sides: 18, start: null, end: null, color: metal, mat: 'gold', bind: bind.head });
  addUraeus(kit, D, bind, metal, { y: 0.116, size: 0.9, x: cx + 0.05 * hs + 0.008 * hs });
}

/**
 * A sun disk standing over the head: a glowing disc in a gold rim, cradled on the crown, with the
 * rearing cobra at the brow. opts: disk (the glowing face), metal, uraeus (false: no cobra), rays (a ring of
 * that many spikes of gold round the rim, alternately long and short).
 */
export function addSunDisk(kit, D, pal, bind, { disk, metal, size = 1, uraeus = true, rays = 0 } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const R = 0.1 * hs * size;
  const yc = hy + 0.108 * hs + R * 0.9;
  const cx = hx - 0.008 * hs;
  // the cradle: a ring on the crown the disk stands in
  kit.loft([vs(hy + 0.09 * hs, 0.06 * hs, 0.056 * hs, cx), vs(hy + 0.122 * hs, 0.05 * hs, 0.048 * hs, cx), vs(hy + 0.136 * hs, 0.034 * hs, 0.034 * hs, cx)],
    { rings: 4, sides: 14, start: null, end: null, color: metal, mat: 'gold', bind: bind.head });
  kit.loft([ps(cx - 0.006 * hs, yc, 0, R, R), ps(cx + 0.006 * hs, yc, 0, R, R)],
    { ref: [0, 1, 0], sides: 26, start: 'flat', end: 'flat', color: disk, mat: 'gem', glow: 1, bind: bind.head });
  const ring = [];
  const n = 22;
  for (let i = 0; i < n; i++) {
    const t = 0.32 + (i / (n - 1)) * (TAU - 0.64);
    ring.push(ps(cx, yc - Math.cos(t) * R * 1.02, Math.sin(t) * R * 1.02, 0.0085 * hs, 0.0085 * hs));
  }
  kit.loft(ring, { sides: 8, start: 'round', end: 'round', capDepth: 0.006 * hs, color: metal, mat: 'gold', glow: 0.25, bind: bind.head });
  for (let i = 0; i < rays; i++) {
    const t = (i / rays) * TAU;
    const c = Math.cos(t);
    const sn = Math.sin(t);
    const r0 = R * 1.08;
    const r1 = R * (i % 2 ? 1.32 : 1.55);
    kit.loft([ps(cx, yc + sn * r0, c * r0, 0.007 * hs, 0.013 * hs), ps(cx, yc + sn * r1, c * r1, 0.002 * hs, 0.0015 * hs)],
      { ref: [1, 0, 0], sides: 4, start: null, end: 'round', capRings: 1, capDepth: 0.004 * hs, color: metal, mat: 'gold', glow: 0.3, bind: bind.head });
  }
  if (uraeus) addUraeus(kit, D, bind, metal, { y: 0.048, size: 1.15 });
}

/**
 * A headband with a fan of plumes standing up and back from it. opts: band (color), colors (the
 * plumes', cycled), n, len (head scales), spread (how far the fan opens), tilt (how far it leans back).
 */
export function addPlumes(kit, D, pal, bind, { band, colors, n = 5, len = 0.2, width = 0.034, spread = 0.5, tilt = 0.4, tip = null } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.011 * hs + 0.006 * hs;
  const y0 = hy + 0.05 * hs;
  const rx = 0.1 * hs + g;
  const rz = 0.088 * hs + g;
  const cx = hx - 0.002 * hs;
  kit.loft([vs(y0, rx, rz, cx), vs(y0 + 0.014 * hs, rx + 0.002, rz + 0.002, cx), vs(y0 + 0.028 * hs, rx, rz, cx)],
    { rings: 3, sides: 24, start: null, end: null, color: band, mat: 'trim', bind: bind.head });
  for (let i = 0; i < n; i++) {
    const k = n > 1 ? i / (n - 1) : 0.5;
    const s = (k - 0.5) * 2;
    const root = [cx - rx * 0.62, y0 + 0.02 * hs, s * rz * 0.78];
    const dir = [-tilt - 0.15 * (1 - Math.abs(s)), 1, s * spread];
    feather(kit, root, dir, [1, 0, s * 0.4], len * hs * (1 - 0.22 * Math.abs(s)), width * hs, {
      color: colors[i % colors.length], tip, bind: bind.head, bend: [-0.03 * hs, 0, s * 0.02 * hs], rows: 5, thick: 0.003 * hs,
    });
  }
}

// ---------------------------------------------------------------------------
// Hindu headgear: the topknot, the matted bun with its crescent, the tiered kirita
// ---------------------------------------------------------------------------

/**
 * A topknot: the hair gathered into a bun on the crown, bound at its neck with a cord. opts: band (the
 * cord's color), size (scale of the bun). The hair cap under it is the outfit's to add (a shaved head has none).
 */
export function addTopknot(kit, D, pal, bind, { band = null, size = 1 } = {}) {
  const hs = D.hs;
  const k = hs * size;
  const x = D.headX - 0.014 * hs;
  const y0 = D.headCY + 0.104 * hs;
  const at = (y, rx, rz = rx) => ps(x - 0.004 * k * (y / 0.1), y0 + y * k, 0, rx * k, rz * k);
  kit.loft([at(-0.01, 0.034), at(0.012, 0.04), at(0.036, 0.052), at(0.062, 0.05), at(0.088, 0.034), at(0.106, 0.012)], {
    ref: [1, 0, 0], rings: 6, sides: 12, start: 'round', end: 'round', capRings: 2, capDepth: [0.012 * k, 0.016 * k], color: pal.hair, mat: 'hair', bind: bind.head,
    warp: (p, a, u) => {
      // strands wound round the bun
      const s = 0.0045 * k * Math.sin(a * 5 + u * 9) * Math.sin(u * PI);
      p[0] += Math.cos(a) * s;
      p[2] += Math.sin(a) * s;
    },
    paint: gradY(y0, y0 + 0.11 * k, 0.84, 1.08),
  });
  if (band) {
    kit.loft([at(0.0, 0.037), at(0.016, 0.039)], { sides: 12, start: null, end: null, color: band, mat: 'trim', bind: bind.head });
  }
}

/**
 * Matted hair coiled into a tall bun on the crown with a crescent moon set in its front (the god of
 * the ascetics'): the coil winds round and narrows to a tip. opts: moon (the crescent's color), band (the cord
 * round the coil's foot), coil (false: a smooth round knot of combed hair, a goddess's, in place of the coiled locks).
 */
export function addCrescent(kit, D, pal, bind, { moon, band, metal, coil = true } = {}) {
  const hs = D.hs;
  const x = D.headX - 0.016 * hs;
  const y0 = D.headCY + 0.1 * hs;
  const at = (y, r, dx = 0) => ps(x + dx * hs, y0 + y * hs, 0, r * hs, r * 0.94 * hs);
  const knot = coil
    ? [at(-0.01, 0.06), at(0.03, 0.074, -0.004), at(0.08, 0.07, -0.01), at(0.13, 0.054, -0.014), at(0.17, 0.03, -0.016), at(0.2, 0.006, -0.016)]
    : [at(-0.01, 0.06), at(0.03, 0.082, -0.004), at(0.072, 0.09, -0.01), at(0.114, 0.072, -0.014), at(0.148, 0.038, -0.016), at(0.164, 0.006, -0.016)];
  kit.loft(knot, {
    ref: [1, 0, 0], rings: 10, sides: 14, start: 'round', end: 'round', capRings: 2, capDepth: [0.014 * hs, 0.012 * hs], color: pal.hair, mat: 'hair', bind: bind.head,
    warp: coil ? (p, a, u) => {
      // coils: a rope wound round the bun, rising as it goes
      const s = 0.012 * hs * Math.sin(a - u * 19) * Math.sin(u * PI) ** 0.6;
      p[0] += Math.cos(a) * s;
      p[2] += Math.sin(a) * s;
    } : null,
    paint: coil ? (o, x2, y, z, u, a) => mul(o, 0.8 + 0.34 * (0.5 + 0.5 * Math.sin(a - u * 19)) * 0.9 + 0.1 * u) : gradY(y0, y0 + 0.17 * hs, 0.8, 1.14),
  });
  kit.loft([at(0.0, 0.064), at(0.016, 0.066)], { sides: 14, start: null, end: null, color: band, mat: 'trim', bind: bind.head });
  // the crescent: a horned moon in the frontal plane against the front of the coil, tips up
  const cx = x + 0.07 * hs;
  const cy = y0 + 0.095 * hs;
  const R = 0.056 * hs;
  const pts = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const b = (u - 0.5) * 2 * 2.1;
    const w = Math.sin(u * PI) ** 0.75;
    pts.push(ps(cx - 0.01 * hs * Math.cos(b), cy - R * Math.cos(b), R * Math.sin(b), 0.007 * hs * (0.3 + w), 0.0175 * hs * (0.08 + w)));
  }
  kit.loft(pts, { ref: [1, 0, 0], sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.004 * hs, color: moon, mat: 'gem', glow: 0.6, bind: bind.head });
  void metal;
}

/**
 * A kirita: a crown of gold in tiers, each stepped out at its foot and narrower than the one below,
 * fluted, with a band of gems at the brow and a finial. opts: metal, trim (the ledges), gem, tiers,
 * height (scale of every tier), lift (head scales: raises it clear of a third eye), flat (a king's lower
 * crown: how much the tiers narrow by, 0.82 default).
 */
export function addKirita(kit, D, pal, bind, { metal, trim, gem, tiers = 3, height = 1, lift = 0, narrow = 0.8 } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.011 * hs + 0.008 * hs;
  const y0 = hy + (0.05 + lift) * hs;
  const rx = 0.1 * hs + g;
  const rz = 0.088 * hs + g;
  const cx = hx - 0.002 * hs;
  const band = 0.03;
  const rows = [[0, 1.0], [band, 1.012]];
  const ledges = [];
  let h = band;
  let sc = 1;
  for (let i = 0; i < tiers; i++) {
    rows.push([h + 0.005, sc * 1.07]);
    ledges.push([h + 0.005, sc * 1.07]);
    h += 0.064 * height;
    rows.push([h, sc * narrow]);
    sc *= narrow * 1.04;
  }
  // the dome that closes the top
  rows.push([h + 0.02 * height, sc * 0.62]);
  rows.push([h + 0.036 * height, sc * 0.22]);
  const tilt = 0.05;
  const X = (hh, s) => cx - tilt * hh * hs;
  const stations = rows.map(([hh, s]) => vs(y0 + hh * hs, rx * s, rz * s, X(hh)));
  const top = y0 + (h + 0.036 * height) * hs;
  kit.loft(stations, {
    sides: 16, start: null, end: 'round', capRings: 2, capDepth: 0.008 * hs, color: metal, mat: 'gold', bind: bind.head,
    warp: (p, a, u) => {
      // flutes up the tiers
      const s = 0.0042 * hs * Math.sin(a * 8) * smoothstep(0.12, 0.3, u);
      p[0] += Math.cos(a) * s;
      p[2] += Math.sin(a) * s;
    },
    paint: gradY(y0, top, 0.8, 1.12),
  });
  // the ledges, a gold roll at the foot of each tier, and the rim of the band
  for (const [hh, s] of ledges) {
    kit.loft([vs(y0 + (hh - 0.008) * hs, rx * s * 1.012, rz * s * 1.012, X(hh)), vs(y0 + (hh + 0.012) * hs, rx * s * 1.0, rz * s * 1.0, X(hh))],
      { sides: 16, start: null, end: null, color: trim, mat: 'gold', glow: 0.1, bind: bind.head });
  }
  kit.loft([vs(y0 - 0.003 * hs, rx * 1.014, rz * 1.014, cx), vs(y0 + 0.01 * hs, rx * 1.018, rz * 1.018, cx)], { sides: 16, start: null, end: null, color: trim, mat: 'gold', bind: bind.head });
  // gems set round the front half of the band, a larger one at the middle
  const gems = 5;
  for (let i = 0; i < gems; i++) {
    const t = ((i / (gems - 1)) - 0.5) * 2.5;
    const big = i === (gems - 1) / 2;
    const r = (big ? 0.0105 : 0.0072) * hs;
    const gx = cx + Math.cos(t) * rx * 1.022;
    const gz = Math.sin(t) * rz * 1.022;
    const y = y0 + band * 0.5 * hs;
    kit.loft([ps(gx, y, gz, r, r * 1.1), ps(gx + Math.cos(t) * 0.007 * hs, y, gz + Math.sin(t) * 0.007 * hs, r * 0.9, r)],
      { ref: [0, 1, 0], sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.004 * hs, color: gem, mat: 'gem', glow: 0.7, bind: bind.head });
  }
  // the finial: a bud of gold on the top
  const fx = X(h + 0.036 * (height));
  kit.loft([ps(fx, top - 0.004 * hs, 0, 0.011 * hs), ps(fx, top + 0.014 * hs, 0, 0.0125 * hs), ps(fx, top + 0.04 * hs, 0, 0.0035 * hs)],
    { ref: [1, 0, 0], rings: 3, sides: 6, start: null, end: 'round', capRings: 2, capDepth: 0.008 * hs, color: trim, mat: 'gold', glow: 0.15, bind: bind.head });
}

// ---------------------------------------------------------------------------
// Japanese headgear: the topknot, the war hat, the kabuto, the priest's cap, the tengu's box, the headband
// ---------------------------------------------------------------------------

/**
 * Wild hair: spikes of it swept up and back from the crown, round the back and sides of the head (a thunder
 * god's, an ogre's), each a tapering curl. opts: n, len (scale of the length), lift (how upright), color
 * (default the hair's).
 */
export function addHairSpikes(kit, D, pal, bind, { n = 9, len = 1, lift = 1, color = null } = {}) {
  const hs = D.hs;
  const hx = D.headX - 0.006 * hs;
  const hy = D.headCY;
  const col = color || pal.hair;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5;
    const th = lerp(1.0, TAU - 1.0, t); // from one temple over the back to the other, the face left clear
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const wob = 0.8 + 0.4 * hash(i, 7, 3);
    const base = [hx + c * 0.062 * hs, hy + (0.074 - 0.018 * Math.abs(c + 0.2)) * hs, sn * 0.058 * hs];
    const d = [c * 0.5 - 0.45, 1.1 * lift, sn * 0.62];
    const dl = Math.hypot(...d);
    const L = 0.19 * hs * len * wob;
    const stations = [];
    for (let k = 0; k <= 3; k++) {
      const u = k / 3;
      const r = 0.026 * hs * (1 - u) ** 0.85 + 0.002;
      stations.push(ps(base[0] + (d[0] / dl) * L * u - 0.3 * L * u * u, base[1] + (d[1] / dl) * L * u, base[2] + (d[2] / dl) * L * u, r, r * 0.9));
    }
    kit.loft(stations, { ref: [1, 0, 0], rings: 4, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: [0.012 * hs, 0.01 * hs], color: col, mat: 'hair', bind: bind.head, paint: (o, x, y, z, u) => mul(o, 0.88 + 0.2 * u) });
  }
}

/**
 * A chonmage: the hair drawn up and tied at the crown, the tail folded forward over the top of the head
 * (a samurai's). opts: band (the cord at the tie), size. The hair cap under it is the outfit's to add.
 */
export function addChonmage(kit, D, pal, bind, { band = null, size = 1 } = {}) {
  const hs = D.hs;
  const k = hs * size;
  const x0 = D.headX - 0.02 * hs;
  const y0 = D.headCY + 0.1 * hs;
  // w: the width across (Z), t: the thickness in the plane of the curve
  const at = (dx, dy, w, t) => ps(x0 + dx * k, y0 + dy * k, 0, w * k, t * k);
  kit.loft([at(0, -0.014, 0.034, 0.032), at(-0.002, 0.012, 0.03, 0.028), at(0.004, 0.032, 0.027, 0.024), at(0.024, 0.047, 0.026, 0.019), at(0.048, 0.05, 0.025, 0.015), at(0.07, 0.042, 0.02, 0.011)], {
    ref: [0, 0, 1], rings: 9, sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: [0.012 * k, 0.012 * k], color: pal.hair, mat: 'hair', bind: bind.head,
    paint: (o, x, y, z, u) => mul(o, 0.86 + 0.24 * Math.abs(Math.sin(z * 150 / (hs || 1))) + 0.1 * u),
  });
  if (band) kit.loft([vs(y0 - 0.006 * k, 0.034 * k, 0.034 * k, x0), vs(y0 + 0.016 * k, 0.03 * k, 0.03 * k, x0)], { sides: 12, start: null, end: null, color: band, mat: 'trim', bind: bind.head });
}

/**
 * A jingasa: the foot soldier's lacquered war hat, a low cone with a shallow curve to its sides and a wide
 * brim at the brow, a ring of metal at the rim and a badge on the front. opts: color, rim, crest (the badge's
 * color), size.
 */
export function addJingasa(kit, D, pal, bind, { color, rim, crest = null, size = 1 } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const R = 0.25 * hs * size;
  const y0 = hy + 0.036 * hs;
  const H = 0.19 * hs;
  const cx = hx - 0.004 * hs;
  const n = 6;
  const prof = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = R * (1 - t) ** 1.25 + 0.004 * hs;
    prof.push(vs(y0 + t * H + 0.014 * hs * (1 - t) ** 2, r * 0.98, r, cx));
  }
  kit.loft(prof, { rings: 6, sides: 22, start: null, end: 'round', capRings: 2, capDepth: 0.01 * hs, color, mat: 'lacquer', bind: bind.head, paint: gradY(y0, y0 + H, 0.82, 1.14) });
  // the rim, a rolled band of metal, and a gold knob at the apex
  kit.loft([vs(y0 - 0.006 * hs, R * 0.985, R * 1.003, cx), vs(y0 + 0.012 * hs, R * 0.96, R * 0.975, cx)], { sides: 22, start: null, end: null, color: rim, mat: 'gold', bind: bind.head });
  kit.loft([vs(y0 + H - 0.004 * hs, 0.012 * hs, 0.012 * hs, cx), vs(y0 + H + 0.016 * hs, 0.011 * hs, 0.011 * hs, cx), vs(y0 + H + 0.028 * hs, 0.003 * hs, 0.003 * hs, cx)],
    { rings: 3, sides: 6, start: null, end: 'round', capDepth: 0.004 * hs, color: rim, mat: 'gold', bind: bind.head });
  if (crest) {
    // a round badge on the front slope, facing out along it
    const t = 0.3;
    const r = R * (1 - t) ** 1.25;
    const al = Math.atan2(R, H);
    const fx = cx + r * 0.99;
    const fy = y0 + t * H + 0.014 * hs * (1 - t) ** 2;
    const d = [Math.sin(al), Math.cos(al)];
    kit.loft([ps(fx - d[0] * 0.003 * hs, fy - d[1] * 0.003 * hs, 0, 0.034 * hs, 0.034 * hs), ps(fx + d[0] * 0.006 * hs, fy + d[1] * 0.006 * hs, 0, 0.034 * hs, 0.034 * hs)],
      { ref: [0, 0, 1], sides: 12, start: 'flat', end: 'flat', color: crest, mat: 'painted', bind: bind.head });
  }
}

/**
 * A kabuto, the warrior's helmet: a ribbed iron bowl with a gold ring at the crown, a brow band, a small peak,
 * a neck guard of flared lames laced in the unit's color (open at the face, its corners turned back), and the
 * kuwagata: two gold horns springing from the brow in a V. opts: steel (the plate), trim (gold), lace, horns
 * (false: none), tall (scale of the horns).
 */
export function addKabuto(kit, D, pal, bind, { steel, trim, lace, horns = true, tall = 1 } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.012 * hs;
  const dome = [
    vs(hy + 0.0 * hs, 0.098 * hs + g, 0.087 * hs + g, hx),
    vs(hy + 0.035 * hs, 0.103 * hs + g, 0.091 * hs + g, hx - 0.002 * hs),
    vs(hy + 0.072 * hs, 0.097 * hs + g, 0.086 * hs + g, hx - 0.004 * hs),
    vs(hy + 0.103 * hs, 0.074 * hs + g, 0.068 * hs + g, hx - 0.006 * hs),
    vs(hy + 0.122 * hs, 0.04 * hs + g, 0.037 * hs + g, hx - 0.007 * hs),
  ];
  // the bowl: ribbed, the ribs running up to the ring at the crown
  kit.loft(dome, {
    rings: 6, sides: 20, start: null, end: 'round', capRings: 2, capDepth: 0.014 * hs, color: steel, mat: 'iron', bind: bind.head,
    warp: (p, a, u) => {
      const k = 0.0055 * hs * Math.sin(a * 10) * smoothstep(0.05, 0.4, u);
      p[0] += Math.cos(a) * k;
      p[2] += Math.sin(a) * k;
    },
    paint: gradY(hy, hy + 0.13 * hs, 0.8, 1.18),
  });
  kit.loft([vs(hy + 0.12 * hs, 0.026 * hs, 0.024 * hs, hx - 0.007 * hs), vs(hy + 0.134 * hs, 0.03 * hs, 0.028 * hs, hx - 0.007 * hs), vs(hy + 0.146 * hs, 0.012 * hs, 0.011 * hs, hx - 0.007 * hs)],
    { rings: 3, sides: 10, start: null, end: 'round', capDepth: 0.006 * hs, color: trim, mat: 'gold', bind: bind.head });
  // the brow band, gold
  kit.loft([vs(hy + 0.016 * hs, 0.099 * hs + g + 0.004, 0.088 * hs + g + 0.004, hx), vs(hy + 0.05 * hs, 0.104 * hs + g + 0.004, 0.092 * hs + g + 0.004, hx - 0.002 * hs)],
    { sides: 20, start: null, end: null, color: trim, mat: 'gold', bind: bind.head });
  // the peak over the brow
  kit.sheet(6, 2, (u, v, out) => {
    const th = (u - 0.5) * 2.3;
    const r = 1 + 0.5 * v;
    out[0] = hx + Math.cos(th) * (0.104 * hs + g + 0.005) * r;
    out[1] = hy + (0.054 + 0.012 * v) * hs;
    out[2] = Math.sin(th) * (0.092 * hs + g + 0.005) * (1 + 0.2 * v);
  }, { thick: 0.006 * hs, color: shade(steel, 0.9), inner: shade(steel, 0.7), bind: bind.head, flip: -1 });
  // the neck guard: stacked lames, each wider than the last, the lowest edge of each laced; the front of
  // every ring is drawn up to the brow so the face stays open
  const wrap2 = (a) => (a > PI ? a - TAU : a);
  for (let i = 0; i < 3; i++) {
    const yt = hy + (0.014 - 0.04 * i) * hs;
    const flare = 0.016 * i * hs;
    const rx = 0.106 * hs + g + flare;
    const rz = 0.095 * hs + g + flare;
    const cx = hx - (0.004 + 0.012 * i) * hs;
    kit.loft([vs(yt, rx, rz, cx), vs(yt - 0.046 * hs, rx * 1.1, rz * 1.12, cx - 0.01 * hs)], {
      rings: 2, sides: 20, start: null, end: null, color: i % 2 ? shade(steel, 0.88) : steel, mat: 'iron', bind: bind.head,
      warp: (p, a) => { const k = smoothstep(0.95, 1.75, Math.abs(wrap2(a))); p[1] = lerp(hy + 0.012 * hs, p[1], k); },
      paint: (o, x, y, z, u) => { if (u > 0.66) recolor(o, lace, 0.95); },
    });
  }
  // the turned-back corners at the front of the guard, a small plate each side
  for (const side of [1, -1]) {
    kit.sheet(2, 2, (u0, v, out) => {
      const u = side > 0 ? u0 : 1 - u0; // the outer face looks along u x v: run u the other way on the left
      out[0] = hx + (0.04 - 0.03 * u + 0.02 * v) * hs;
      out[1] = hy + (0.012 - 0.06 * v) * hs;
      out[2] = side * (0.098 + 0.03 * u + 0.012 * v) * hs;
    }, { thick: 0.006 * hs, color: shade(steel, 0.95), inner: shade(lace, 0.8), bind: bind.head });
  }
  if (!horns) return;
  // the kuwagata: two broad flat horns in a V, gold crescents facing the front, curving up and out
  const fx = hx + 0.1 * hs;
  const fy = hy + 0.06 * hs;
  for (const side of [1, -1]) {
    const M = new THREE.Matrix4().compose(
      new THREE.Vector3(fx, fy, side * 0.01 * hs),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(side * 0.58, -side * PI / 2, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    kit.placed(M, (k) => {
      const t = tall * hs;
      k.slab([[-0.008, 0.0], [0.026, 0.0], [0.05, 0.045], [0.064, 0.1], [0.062, 0.15], [0.046, 0.195], [0.02, 0.228], [0.004, 0.2], [0.012, 0.15], [0.004, 0.1], [-0.004, 0.05]].map(([x, y]) => [x * hs, y * t]),
        { depth: 0.011 * hs, bevel: 0.0035 * hs, color: trim, mat: 'gold', bind: bind.head, paint: gradY(0, 0.23 * t, 0.86, 1.1) });
    });
  }
  // the badge between the horns' feet
  kit.loft([ps(fx - 0.004 * hs, fy + 0.004 * hs, 0, 0.022 * hs, 0.022 * hs), ps(fx + 0.01 * hs, fy + 0.004 * hs, 0, 0.022 * hs, 0.022 * hs)],
    { ref: [0, 1, 0], sides: 10, start: 'flat', end: 'flat', color: trim, mat: 'gold', glow: 0.15, bind: bind.head });
}

/**
 * The priest's cap (eboshi): a tall black lacquered cap standing up from the brow, narrowing, its top leaning
 * forward, tied under the chin with a cord. opts: color (lacquer), cord.
 */
export function addEboshi(kit, D, pal, bind, { color, cord } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.011 * hs + 0.006 * hs;
  const y0 = hy + 0.05 * hs;
  const lean = (h) => 0.12 * h * h;
  kit.loft([
    vs(y0, 0.1 * hs + g, 0.088 * hs + g, hx - 0.002 * hs),
    vs(y0 + 0.05 * hs, 0.078 * hs, 0.082 * hs, hx - 0.004 * hs),
    vs(y0 + 0.11 * hs, 0.05 * hs, 0.076 * hs, hx + lean(0.11) * hs),
    vs(y0 + 0.17 * hs, 0.04 * hs, 0.07 * hs, hx + lean(0.17) * hs),
    vs(y0 + 0.215 * hs, 0.036 * hs, 0.056 * hs, hx + lean(0.215) * hs + 0.006 * hs),
  ], { rings: 8, sides: 18, start: null, end: 'round', capRings: 2, capDepth: 0.018 * hs, color, mat: 'lacquer', bind: bind.head, paint: gradY(y0, y0 + 0.22 * hs, 0.85, 1.25) });
  // the band at the foot, and the cord that ties it: from the temples down under the chin
  kit.loft([vs(y0 - 0.003 * hs, 0.1 * hs + g + 0.003, 0.088 * hs + g + 0.003, hx - 0.002 * hs), vs(y0 + 0.02 * hs, 0.1 * hs + g + 0.002, 0.088 * hs + g + 0.002, hx - 0.002 * hs)],
    { sides: 18, start: null, end: null, color: shade(color, 1.5), mat: 'lacquer', bind: bind.head });
  if (cord) {
    for (const side of [1, -1]) {
      kit.loft([ps(hx - 0.004 * hs, y0 + 0.004 * hs, side * (0.094 * hs + g), 0.005 * hs), ps(hx + 0.01 * hs, hy - 0.04 * hs, side * 0.1 * hs, 0.0045 * hs), ps(hx + 0.052 * hs, hy - 0.098 * hs, side * 0.05 * hs, 0.0045 * hs), ps(hx + 0.06 * hs, hy - 0.112 * hs, side * 0.01 * hs, 0.004 * hs)],
        { ref: [1, 0, 0], rings: 6, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.004 * hs, color: cord, mat: 'cloth', bind: bind.head });
    }
  }
}

/**
 * The tengu's tokin: a small black hexagonal box of lacquer worn on the brow, leaning forward, tied round the head
 * with a cord that hangs in two tails at the back. opts: color, cord.
 */
export function addTokin(kit, D, pal, bind, { color, cord } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const y0 = hy + 0.085 * hs;
  const fx = hx + 0.062 * hs;
  const rows = [[0, 0.046, 0.04, 0], [0.01, 0.05, 0.044, 0.002], [0.06, 0.044, 0.038, 0.018], [0.072, 0.034, 0.03, 0.022]];
  kit.loft(rows.map(([h, rx, rz, dx]) => vs(y0 + h * hs, rx * hs, rz * hs, fx + dx * hs)), { rings: 4, sides: 6, start: 'flat', end: 'flat', color, mat: 'lacquer', bind: bind.head, paint: gradY(y0, y0 + 0.075 * hs, 0.9, 1.2) });
  const c = cord || color;
  const rx = 0.1 * hs + 0.011 * hs;
  const rz = 0.088 * hs + 0.011 * hs;
  kit.loft([vs(y0 - 0.026 * hs, rx, rz, hx - 0.002 * hs), vs(y0 - 0.014 * hs, rx + 0.001, rz + 0.001, hx - 0.002 * hs)], { sides: 20, start: null, end: null, color: c, mat: 'cloth', bind: bind.head });
  for (const side of [1, -1]) {
    kit.loft([ps(hx - 0.1 * hs, y0 - 0.02 * hs, side * 0.008 * hs, 0.005 * hs), ps(hx - 0.118 * hs, y0 - 0.08 * hs, side * 0.02 * hs, 0.0045 * hs), ps(hx - 0.124 * hs, y0 - 0.15 * hs, side * 0.03 * hs, 0.004 * hs)],
      { ref: [0, 0, 1], rings: 4, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.004 * hs, color: c, mat: 'cloth', bind: bind.head });
  }
}

/**
 * A headband (hachimaki) round the brow, knotted at the back with two tails hanging. opts: color, tails (false: none).
 */
export function addHeadband(kit, D, pal, bind, { color, tails = true } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.011 * hs + 0.004 * hs;
  const y0 = hy + 0.046 * hs;
  const rx = 0.1 * hs + g;
  const rz = 0.088 * hs + g;
  kit.loft([vs(y0, rx, rz, hx - 0.002 * hs), vs(y0 + 0.016 * hs, rx + 0.001, rz + 0.001, hx - 0.002 * hs), vs(y0 + 0.03 * hs, rx, rz, hx - 0.002 * hs)],
    { rings: 3, sides: 22, start: null, end: null, color, mat: 'cloth', bind: bind.head });
  if (!tails) return;
  for (const [side, drop] of [[1, 0.16], [-1, 0.2]]) {
    kit.sheet(2, 4, (u, v, out) => {
      out[0] = hx - rx - 0.004 * hs - 0.03 * hs * v;
      out[1] = y0 + 0.012 * hs - drop * hs * v;
      out[2] = side * (0.012 + 0.03 * v) * hs + (0.5 - u) * 0.026 * hs * (1 + v);
    }, { thick: 0.004 * hs, color, inner: shade(color, 0.85), bind: bind.hair });
  }
}

// ---------------------------------------------------------------------------
// Chinese headgear: the bamboo hat, the scarf cap, the soldier's helm, the Taoist's crown, the pheasant crown, the
// fillet, the long beard, the hairpins
// ---------------------------------------------------------------------------

/** A little ball (a knot, a bead) at `p`: a short loft with round ends. */
function knob(kit, p, r, opts) {
  kit.loft([ps(p[0] - r * 0.1, p[1], p[2], r), ps(p[0] + r * 0.1, p[1], p[2], r)], { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: r, ...opts });
}

/**
 * A douli, the farmer's bamboo hat: a very wide, shallow cone of woven strips (ribs running from the apex to the rim, rings
 * between them), the rim bound, a small knot at the apex, a cord down each cheek to a knot under the chin. opts: color
 * (the straw), rim (the binding), cord (omit for none), size.
 */
export function addDouli(kit, D, pal, bind, { color, rim, cord = null, size = 1 } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const R = 0.3 * hs * size;
  const y0 = hy + 0.052 * hs;
  const H = 0.12 * hs;
  const cx = hx - 0.004 * hs;
  const n = 7;
  const prof = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = R * (1 - t) + 0.004 * hs;
    prof.push(vs(y0 + H * (1 - (1 - t) ** 1.45), r, r * 0.98, cx));
  }
  kit.loft(prof, {
    rings: 7, sides: 32, start: null, end: 'round', capRings: 2, capDepth: 0.01 * hs, color, mat: 'cloth', bind: bind.head,
    paint: (o, x, y, z, u, a) => mul(o, 0.8 + 0.22 * Math.abs(Math.sin(a * TAU * 8)) + 0.08 * Math.cos(u * PI * 9)),
  });
  // the rim, a rolled binding, and the knot at the apex
  kit.loft([vs(y0 - 0.006 * hs, R * 1.004, R * 0.984, cx), vs(y0 + 0.01 * hs, R * 0.968, R * 0.95, cx)], { sides: 32, start: null, end: null, color: rim, mat: 'wood', bind: bind.head });
  const top = y0 + H;
  kit.loft([vs(top - 0.004 * hs, 0.014 * hs, 0.014 * hs, cx), vs(top + 0.014 * hs, 0.014 * hs, 0.014 * hs, cx), vs(top + 0.03 * hs, 0.003 * hs, 0.003 * hs, cx)],
    { rings: 3, sides: 6, start: null, end: 'round', capDepth: 0.004 * hs, color: rim, mat: 'wood', bind: bind.head });
  if (cord) {
    for (const side of [1, -1]) {
      kit.loft([ps(hx - 0.004 * hs, hy + 0.054 * hs, side * (0.094 * hs + 0.017 * hs), 0.005 * hs), ps(hx + 0.01 * hs, hy - 0.04 * hs, side * 0.1 * hs, 0.0045 * hs), ps(hx + 0.052 * hs, hy - 0.098 * hs, side * 0.05 * hs, 0.0045 * hs), ps(hx + 0.06 * hs, hy - 0.112 * hs, side * 0.01 * hs, 0.004 * hs)],
        { ref: [1, 0, 0], rings: 6, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.004 * hs, color: cord, mat: 'cloth', bind: bind.head });
    }
  }
}

/**
 * A scarf cap: a length of cloth wound over the crown, its edge at the brow in front and down at the nape, a band at the brow,
 * the ends knotted behind the crown and hanging in two tails that swing like hair (the green scarf of the god of war, a
 * soldier's cap). opts: color, band (default none), tails (how far they hang, head scales: 0 for none), tail (their color).
 */
export function addScarfCap(kit, D, pal, bind, { color, band = null, tails = 0.24, tail = null } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.017 * hs;
  const dome = [
    vs(hy - 0.03 * hs, 0.092 * hs + g, 0.082 * hs + g, hx - 0.008 * hs),
    vs(hy + 0.0 * hs, 0.098 * hs + g, 0.087 * hs + g, hx - 0.002 * hs),
    vs(hy + 0.035 * hs, 0.103 * hs + g, 0.091 * hs + g, hx - 0.003 * hs),
    vs(hy + 0.072 * hs, 0.097 * hs + g, 0.086 * hs + g, hx - 0.007 * hs),
    vs(hy + 0.104 * hs, 0.076 * hs + g, 0.068 * hs + g, hx - 0.012 * hs),
    vs(hy + 0.126 * hs, 0.04 * hs + g, 0.038 * hs + g, hx - 0.016 * hs),
  ];
  kit.loft(dome, {
    rings: 9, sides: 18, start: null, end: 'round', capDepth: 0.03 * hs, color, mat: 'cloth', bind: bind.head,
    warp: (p, a, u) => {
      // the cloth is wound: its edge sits at the brow in front and drops to the nape behind, with soft folds between
      const line = hy + 0.05 * hs - 0.082 * hs * smoothstep(0.55, 1.5, Math.abs(wrap(a)));
      if (p[1] < line) p[1] = line;
      const s = 0.0035 * hs * Math.sin(a * 5 + u * 4);
      p[0] += Math.cos(a) * s;
      p[2] += Math.sin(a) * s;
    },
    paint: gradY(hy - 0.04 * hs, hy + 0.14 * hs, 0.82, 1.1),
  });
  if (band) {
    kit.loft([vs(hy + 0.034 * hs, 0.1 * hs + g + 0.004 * hs, 0.089 * hs + g + 0.004 * hs, hx - 0.002 * hs), vs(hy + 0.062 * hs, 0.104 * hs + g + 0.004 * hs, 0.093 * hs + g + 0.004 * hs, hx - 0.003 * hs)],
      { sides: 18, start: null, end: null, color: band, mat: 'cloth', bind: bind.head });
  }
  if (tails > 0) {
    const kx = hx - 0.11 * hs;
    const ky = hy + 0.062 * hs;
    const tc = tail || color;
    knob(kit, [kx, ky, 0], 0.021 * hs, { color: tc, mat: 'cloth', bind: bind.head });
    for (const [side, drop] of [[1, tails], [-1, tails * 1.18]]) {
      kit.sheet(2, 5, (u, v, out) => {
        out[0] = kx - 0.012 * hs - 0.02 * hs * v;
        out[1] = ky - 0.01 * hs - drop * hs * v;
        out[2] = side * (0.014 + 0.034 * v) * hs + (0.5 - u) * 0.034 * hs * (1 + 0.6 * v);
      }, { thick: 0.004 * hs, color: tc, inner: shade(tc, 0.85), bind: bind.hair });
    }
  }
}

/**
 * The soldier's helm: a steel dome with a raised ridge from brow to nape, a brow band, cheek guards and a flared neck guard,
 * a gold spike on the crown and, hung from the spike, a plume bell-shaped over the top of the dome, its hem ragged (the
 * team's color on a soldier's). opts: steel, trim, plume (omit for none), tall (scale of the spike).
 */
export function addCnHelm(kit, D, pal, bind, { steel, trim, plume = null, tall = 1 } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  helmShell(kit, D, bind, steel, trim, { nasal: false, cheeks: true, neck: true });
  // the ridge: a thin arch standing proud of the dome along the midline
  const arch = [[0.116, 0.03], [0.112, 0.07], [0.094, 0.108], [0.056, 0.136], [0.0, 0.148], [-0.05, 0.138], [-0.09, 0.108], [-0.11, 0.07], [-0.114, 0.03]];
  const outline = [...arch.map(([x, y]) => [hx + x * hs, hy + y * hs]), ...arch.slice().reverse().map(([x, y]) => [hx + x * hs * 0.93, hy + (y - 0.014) * hs])];
  kit.slab(outline, { depth: 0.012 * hs, bevel: 0.0035 * hs, color: shade(steel, 0.88), mat: 'iron', bind: bind.head });
  // the spike
  const ty = hy + 0.146 * hs;
  kit.loft([ps(hx - 0.007 * hs, ty - 0.006 * hs, 0, 0.017 * hs), ps(hx - 0.007 * hs, ty + 0.01 * hs, 0, 0.014 * hs), ps(hx - 0.007 * hs, ty + 0.03 * hs, 0, 0.008 * hs), ps(hx - 0.007 * hs, ty + 0.072 * tall * hs, 0, 0.002 * hs)],
    { ref: [1, 0, 0], rings: 4, sides: 6, start: null, end: 'round', capRings: 2, capDepth: 0.006 * hs, color: trim, mat: 'gold', bind: bind.head });
  if (plume) {
    kit.loft([
      vs(hy + 0.08 * hs, 0.114 * hs, 0.104 * hs, hx - 0.004 * hs),
      vs(hy + 0.098 * hs, 0.102 * hs, 0.092 * hs, hx - 0.005 * hs),
      vs(hy + 0.124 * hs, 0.08 * hs, 0.073 * hs, hx - 0.006 * hs),
      vs(hy + 0.148 * hs, 0.044 * hs, 0.042 * hs, hx - 0.007 * hs),
      vs(hy + 0.162 * hs, 0.012 * hs, 0.012 * hs, hx - 0.007 * hs),
    ], {
      rings: 6, sides: 18, start: null, end: 'round', capRings: 2, capDepth: 0.008 * hs, color: plume, mat: 'hair', bind: bind.head,
      warp: (p, a, u) => { p[1] -= 0.018 * hs * Math.abs(Math.sin(a * 6)) * (1 - smoothstep(0, 0.2, u)); },
      paint: (o, x, y, z, u, a) => mul(o, 0.78 + 0.34 * Math.abs(Math.sin(a * TAU * 6)) + 0.08 * u),
    });
  }
}

/**
 * A Taoist's crown (daoguan): the hair drawn up into a rounded bun on the crown, held in a small stepped crown of gold with a
 * lotus petal standing at its front, a long gold pin laid across through it with a bead at each end. opts: metal, bead.
 */
export function addDaoguan(kit, D, pal, bind, { metal, bead = null } = {}) {
  const hs = D.hs;
  const hx = D.headX - 0.014 * hs;
  const y0 = D.headCY + 0.104 * hs;
  const at = (y, r) => ps(hx, y0 + y * hs, 0, r * hs, r * hs);
  kit.loft([at(-0.01, 0.034), at(0.012, 0.042), at(0.04, 0.05), at(0.072, 0.046), at(0.098, 0.03), at(0.112, 0.008)], {
    ref: [1, 0, 0], rings: 6, sides: 12, start: 'round', end: 'round', capRings: 2, capDepth: [0.012 * hs, 0.014 * hs], color: pal.hair, mat: 'hair', bind: bind.head,
    paint: gradY(y0, y0 + 0.12 * hs, 0.84, 1.1),
  });
  kit.loft([at(0.002, 0.05), at(0.016, 0.058), at(0.034, 0.062), at(0.052, 0.056), at(0.062, 0.05)], {
    ref: [1, 0, 0], rings: 5, sides: 14, start: null, end: null, color: metal, mat: 'gold', glow: 0.1, bind: bind.head,
    warp: (p, a, u) => {
      const s = 0.003 * hs * Math.sin(a * 7) * smoothstep(0.1, 0.5, u);
      p[0] += Math.cos(a) * s;
      p[2] += Math.sin(a) * s;
    },
  });
  // the petal at the front: a pointed leaf standing in the frontal plane
  const M = new THREE.Matrix4().compose(new THREE.Vector3(hx + 0.058 * hs, y0 + 0.012 * hs, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -PI / 2, 0)), new THREE.Vector3(1, 1, 1));
  kit.placed(M, (k) => {
    k.slab([[-0.022, 0], [-0.027, 0.022], [-0.018, 0.048], [0, 0.07], [0.018, 0.048], [0.027, 0.022], [0.022, 0]].map(([x, y]) => [x * hs, y * hs]),
      { depth: 0.008 * hs, bevel: 0.0025 * hs, color: metal, mat: 'gold', glow: 0.1, bind: bind.head });
  });
  // the pin
  const py = y0 + 0.046 * hs;
  kit.loft([ps(hx, py, -0.092 * hs, 0.0042 * hs), ps(hx, py, 0, 0.0042 * hs), ps(hx, py, 0.092 * hs, 0.0042 * hs)],
    { ref: [1, 0, 0], rings: 4, sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.004 * hs, color: metal, mat: 'gold', bind: bind.head });
  for (const side of [1, -1]) knob(kit, [hx, py, side * 0.096 * hs], 0.0105 * hs, { color: bead || metal, mat: bead ? 'gem' : 'gold', glow: bead ? 0.3 : 0, bind: bind.head });
}

/**
 * The Monkey King's crown (the purple-gold crown with the phoenix wings): a tall band of gold round the brow, a pointed plate
 * standing at its front with a gem set in it, and two long pheasant feathers springing from either side of the plate,
 * sweeping up and back in arcs that droop toward their tips. opts: metal, gem, plume (the feathers), tip, len (their length).
 */
export function addPheasantCrown(kit, D, pal, bind, { metal, gem, plume, tip = null, len = 1 } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.011 * hs + 0.007 * hs;
  const rx = 0.1 * hs + g;
  const rz = 0.088 * hs + g;
  kit.loft([vs(hy + 0.05 * hs, rx, rz, hx - 0.002 * hs), vs(hy + 0.07 * hs, rx + 0.003 * hs, rz + 0.003 * hs, hx - 0.002 * hs), vs(hy + 0.092 * hs, rx, rz, hx - 0.003 * hs)],
    { rings: 3, sides: 22, start: null, end: null, color: metal, mat: 'gold', glow: 0.1, bind: bind.head });
  for (const y of [0.05, 0.092]) {
    kit.loft([vs(hy + (y - 0.006) * hs, rx + 0.006 * hs, rz + 0.006 * hs, hx - 0.002 * hs), vs(hy + (y + 0.006) * hs, rx + 0.006 * hs, rz + 0.006 * hs, hx - 0.002 * hs)],
      { sides: 22, start: null, end: null, color: shade(metal, 0.85), mat: 'gold', bind: bind.head });
  }
  // the plate at the front, a gem in its foot
  const fx = hx - 0.002 * hs + rx + 0.002 * hs;
  const M = new THREE.Matrix4().compose(new THREE.Vector3(fx, hy + 0.074 * hs, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -PI / 2, 0)), new THREE.Vector3(1, 1, 1));
  kit.placed(M, (k) => {
    k.slab([[-0.05, 0], [-0.054, 0.03], [-0.04, 0.06], [-0.016, 0.092], [0, 0.138], [0.016, 0.092], [0.04, 0.06], [0.054, 0.03], [0.05, 0]].map(([x, y]) => [x * hs, y * hs]),
      { depth: 0.011 * hs, bevel: 0.0035 * hs, color: metal, mat: 'gold', glow: 0.1, bind: bind.head, paint: gradY(0, 0.14 * hs, 0.88, 1.1) });
  });
  kit.loft([ps(fx + 0.004 * hs, hy + 0.086 * hs, 0, 0.014 * hs, 0.014 * hs), ps(fx + 0.012 * hs, hy + 0.086 * hs, 0, 0.0125 * hs, 0.0125 * hs)],
    { ref: [0, 1, 0], sides: 10, start: 'round', end: 'round', capRings: 1, capDepth: 0.006 * hs, color: gem, mat: 'gem', glow: 0.8, bind: bind.head });
  // the two pheasant feathers
  for (const side of [1, -1]) {
    const root = [fx - 0.012 * hs, hy + 0.1 * hs, side * 0.044 * hs];
    feather(kit, root, [-0.22, 1, side * 0.3], [1, 0.1, side * 0.2], 0.4 * len * hs, 0.042 * hs, {
      color: plume, tip, bind: bind.head, bend: [-0.3 * len * hs, -0.16 * len * hs, side * 0.14 * len * hs], rows: 8, thick: 0.0032 * hs, shape: 0.45, cup: 0.2,
    });
  }
}

/** A plain gold fillet round the brow with a small boss at the front (the band the Monkey King's copies wear). */
export function addFillet(kit, D, pal, bind, { metal, boss = true } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.011 * hs + 0.005 * hs;
  const y0 = hy + 0.05 * hs;
  const rx = 0.1 * hs + g;
  const rz = 0.088 * hs + g;
  kit.loft([vs(y0, rx, rz, hx - 0.002 * hs), vs(y0 + 0.014 * hs, rx + 0.002 * hs, rz + 0.002 * hs, hx - 0.002 * hs), vs(y0 + 0.028 * hs, rx, rz, hx - 0.002 * hs)],
    { rings: 3, sides: 22, start: null, end: null, color: metal, mat: 'gold', glow: 0.1, bind: bind.head });
  if (boss) knob(kit, [hx - 0.002 * hs + rx + 0.004 * hs, y0 + 0.014 * hs, 0], 0.014 * hs, { color: metal, mat: 'gold', glow: 0.1, bind: bind.head });
}

/**
 * The long beard (the god of war's): whiskers sweep from the jaw into one broad lock that hangs over the breast and belly,
 * combed straight in long strands, ending in a rounded point, with a moustache. The head bone holds it at the jaw and the
 * chest at the breast. opts: len (how far it hangs, as a fraction of the torso's height; 0.58 to the belly).
 */
export function addLongBeard(kit, D, pal, bind, { len = 0.58 } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const st = [
    ps(hx + 0.068 * hs, hy - 0.05 * hs, 0, 0.032 * hs, 0.084 * hs),
    ps(hx + 0.09 * hs, hy - 0.108 * hs, 0, 0.044 * hs, 0.082 * hs),
  ];
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = torsoRing(D, lerp(1.0, 1.0 - len, t), 0.05);
    const thick = 0.042 * hs * (1 - 0.72 * t);
    st.push(ps(Math.max(r.dx + r.rx + thick * 0.7, hx + 0.09 * hs), r.y, 0, thick, 0.082 * hs * (1 - t ** 1.7) + 0.01 * hs));
  }
  const hold = mixBind(bind.head, bind.chest, (x, y) => smoothstep(hy - 0.04 * hs, hy - 0.2 * hs, y));
  kit.loft(st, {
    ref: [1, 0, 0], rings: 12, sides: 14, start: 'round', end: 'round', capDepth: [0.02 * hs, 0.02 * hs], color: pal.hair, mat: 'hair', bind: hold,
    paint: (o, x, y, z, u, a) => mul(o, 0.8 + 0.28 * Math.abs(Math.sin(a * TAU * 3.5 + u * 1.5)) + 0.1 * (1 - u)),
  });
  addMoustache(kit, D, pal, bind);
}

/**
 * Hairpins: a fan of slender gold pins swept out and back from the foot of the bun, a bead at the end of each (a goddess's).
 * opts: metal, bead, n (pins to a side).
 */
export function addHairpins(kit, D, pal, bind, { metal, bead = null, n = 3 } = {}) {
  const hs = D.hs;
  const bx = D.headX - 0.03 * hs;
  const by = D.headCY + 0.112 * hs;
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) : 0.5;
      const base = [bx, by + 0.02 * k * hs, side * 0.052 * hs];
      const d = [-0.45 - 0.2 * k, 0.5 - 0.42 * k, side * (0.62 + 0.3 * k)];
      const dl = Math.hypot(...d);
      const L = 0.19 * hs * (1 - 0.14 * k);
      const tip = [base[0] + (d[0] / dl) * L, base[1] + (d[1] / dl) * L, base[2] + (d[2] / dl) * L];
      kit.loft([ps(base[0], base[1], base[2], 0.0042 * hs), ps(tip[0], tip[1], tip[2], 0.0032 * hs)], { ref: [0, 1, 0.3], rings: 2, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.004 * hs, color: metal, mat: 'gold', bind: bind.head });
      knob(kit, tip, 0.0105 * hs, { color: bead || metal, mat: bead ? 'gem' : 'gold', glow: bead ? 0.3 : 0, bind: bind.head });
    }
  }
}

// ---------------------------------------------------------------------------
// Aztec headgear: the quetzal-feather crown, the eagle and hummingbird helms, the rain god's face
// ---------------------------------------------------------------------------

/**
 * The Mexica's feather crown (copilli): a band at the brow with a fan of long plumes rising from the back of the head and leaning out
 * and back, and a shorter row of another color in front of it. opts: band (the gold), colors (the long plumes', cycled), inner
 * (the short row's), tip (their ends), jade (a bead at the brow), n (plumes in the long row), len (scale of the length).
 */
export function addQuetzalFan(kit, D, pal, bind, { band, colors, inner = null, tip = null, jade = null, n = 9, len = 1 } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.011 * hs + 0.006 * hs;
  const y0 = hy + 0.05 * hs;
  const rx = 0.1 * hs + g;
  const rz = 0.088 * hs + g;
  const cx = hx - 0.002 * hs;
  kit.loft([vs(y0, rx, rz, cx), vs(y0 + 0.014 * hs, rx + 0.002, rz + 0.002, cx), vs(y0 + 0.028 * hs, rx, rz, cx)],
    { rings: 3, sides: 24, start: null, end: null, color: band, mat: 'gold', bind: bind.head });
  if (jade) knob(kit, [cx + rx + 0.004 * hs, y0 + 0.014 * hs, 0], 0.016 * hs, { color: jade, mat: 'gem', glow: 0.2, bind: bind.head });
  const row = (count, L, lean, w, cols, tipC, lift) => {
    for (let i = 0; i < count; i++) {
      const k = count > 1 ? i / (count - 1) : 0.5;
      const th = (k - 0.5) * PI * 1.1; // 0 straight back, out to either side
      const c = Math.cos(th);
      const s = Math.sin(th);
      feather(kit, [cx - rx * 0.86 * c, y0 + lift * hs, rz * 0.86 * s], [-lean * c, 1, s * 0.9], [-c, 0.25, s], L * hs * (1 - 0.2 * Math.abs(s)), w * hs, {
        color: cols[i % cols.length], tip: tipC, bind: bind.head, bend: [-0.04 * hs * L, 0, s * 0.03 * hs], rows: 5, thick: 0.0035 * hs,
      });
    }
  };
  row(n, 0.3 * len, 0.45, 0.034, colors, tip, 0.02);
  if (inner) row(Math.max(3, n - 2), 0.2 * len, 0.2, 0.03, [inner].flat(), tip, 0.012);
}

/**
 * The eagle warrior's helm: the head of an eagle in feathers, worn like a hood with the face looking out of the open beak: a feathered
 * cap over the crown, the ears and the nape, the upper beak hooked over the brow, a yellow eye on each side of it, down standing on
 * the crown and a tuft of long feathers falling behind. opts: plumage (the cap), tip (the pale ends of the feathers), beak, eye, down.
 */
export function addEagleHelm(kit, D, pal, bind, { plumage, tip = null, beak, eye, down = null } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.016 * hs;
  const dome = [
    vs(hy - 0.075 * hs, 0.09 * hs + g, 0.078 * hs + g, hx - 0.012 * hs),
    vs(hy - 0.03 * hs, 0.098 * hs + g, 0.087 * hs + g, hx - 0.006 * hs),
    vs(hy + 0.02 * hs, 0.103 * hs + g, 0.091 * hs + g, hx - 0.002 * hs),
    vs(hy + 0.06 * hs, 0.099 * hs + g, 0.087 * hs + g, hx - 0.004 * hs),
    vs(hy + 0.098 * hs, 0.078 * hs + g, 0.07 * hs + g, hx - 0.008 * hs),
    vs(hy + 0.124 * hs, 0.042 * hs + g, 0.04 * hs + g, hx - 0.012 * hs),
  ];
  kit.loft(dome, {
    rings: 8, sides: 22, start: null, end: 'round', capRings: 2, capDepth: 0.018 * hs, color: plumage, mat: 'feather', bind: bind.head,
    warp: (p, a) => {
      // the edge: high over the brow, falling past the ear to the nape, so the face stays open
      const line = hy + 0.062 * hs - 0.12 * hs * smoothstep(0.45, 1.4, Math.abs(wrap(a)));
      if (p[1] < line) p[1] = line;
    },
    paint: featherRows({ pitch: 0.026 * hs, per: 18, cx: hx, dark: 0.66, light: 1.12 }),
  });
  // the upper beak: a hooked cone over the brow, deep at its root, its point turned down
  const bp = [[0.085, 0.083, 0.048, 0.04], [0.14, 0.094, 0.042, 0.036], [0.19, 0.082, 0.032, 0.027], [0.224, 0.052, 0.018, 0.016], [0.23, 0.03, 0.004, 0.004]];
  kit.loft(bp.map(([x, y, w, h]) => ps(hx + x * hs, hy + y * hs, 0, w * hs, h * hs)), {
    ref: [0, 0, 1], rings: 7, sides: 10, start: 'round', end: 'round', capRings: 2, capDepth: [0.014 * hs, 0.004 * hs], color: beak, mat: 'gold', bind: bind.head,
    paint: gradY(hy + 0.03 * hs, hy + 0.1 * hs, 0.8, 1.1),
  });
  // the eyes: a yellow disc with a dark pupil on each side of the beak's root
  for (const side of [1, -1]) {
    const ex = hx + 0.054 * hs;
    const ey = hy + 0.07 * hs;
    kit.loft([ps(ex, ey, side * 0.082 * hs, 0.019 * hs, 0.019 * hs), ps(ex + 0.004 * hs, ey, side * 0.094 * hs, 0.017 * hs, 0.017 * hs)],
      { ref: [1, 0, 0], sides: 10, start: null, end: 'round', capRings: 2, capDepth: 0.004 * hs, color: eye, mat: 'gloss', glow: 0.25, bind: bind.head });
    kit.loft([ps(ex + 0.006 * hs, ey, side * 0.0955 * hs, 0.008 * hs, 0.008 * hs), ps(ex + 0.008 * hs, ey, side * 0.0985 * hs, 0.0075 * hs, 0.0075 * hs)],
      { ref: [1, 0, 0], sides: 8, start: null, end: 'round', capRings: 1, capDepth: 0.002 * hs, color: pal.eye, mat: 'gloss', bind: bind.head });
  }
  // down standing on the crown, and a tuft of long feathers behind
  const d = down || plumage;
  for (let i = 0; i < 5; i++) {
    const k = (i - 2) / 2;
    feather(kit, [hx - 0.012 * hs, hy + 0.118 * hs, k * 0.03 * hs], [-0.5, 1, k * 0.55], [1, 0.2, 0], 0.12 * hs * (1 - 0.2 * Math.abs(k)), 0.026 * hs, { color: d, tip, bind: bind.head, bend: [-0.02 * hs, 0, k * 0.01 * hs], rows: 4, thick: 0.003 * hs });
  }
  for (let i = 0; i < 5; i++) {
    const k = (i - 2) / 2;
    feather(kit, [hx - 0.104 * hs, hy - 0.03 * hs, k * 0.06 * hs], [-0.5, -1, k * 0.5], [1, 0, 0], 0.17 * hs * (1 - 0.15 * Math.abs(k)), 0.03 * hs, { color: shade(plumage, 0.9), tip, bind: bind.hair, bend: [-0.03 * hs, 0, 0], rows: 4, thick: 0.003 * hs });
  }
}

/**
 * The hummingbird helm of the god of the sun and of war: a gold cap fitted to the crown with a brow band, a long needle of a beak
 * springing from the brow and pointing forward and up, a jewel for an eye on each side and a crest of iridescent plumes sweeping back
 * from the crown. opts: gold, beak (default a dark shade of the gold), eye (a gem), crest (the plumes' colors, cycled), tip.
 */
export function addHummingbirdHelm(kit, D, pal, bind, { gold, beak = null, eye, crest, tip = null } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.012 * hs;
  const dome = [
    vs(hy - 0.045 * hs, 0.092 * hs + g, 0.08 * hs + g, hx + 0.004 * hs),
    vs(hy + 0.0 * hs, 0.097 * hs + g, 0.086 * hs + g, hx),
    vs(hy + 0.035 * hs, 0.102 * hs + g, 0.09 * hs + g, hx - 0.002 * hs),
    vs(hy + 0.072 * hs, 0.095 * hs + g, 0.084 * hs + g, hx - 0.004 * hs),
    vs(hy + 0.102 * hs, 0.072 * hs + g, 0.066 * hs + g, hx - 0.006 * hs),
    vs(hy + 0.118 * hs, 0.036 * hs + g, 0.036 * hs + g, hx - 0.007 * hs),
  ];
  // the rim: high over the brow so the eyes look out, falling past the ear to the nape
  const rim = (a) => hy + 0.054 * hs - 0.096 * hs * smoothstep(0.5, 1.5, Math.abs(wrap(a)));
  kit.loft(dome, {
    rings: 7, sides: 20, start: null, end: 'round', capRings: 2, capDepth: 0.014 * hs, color: gold, mat: 'gold', glow: 0.08, bind: bind.head,
    warp: (p, a) => { const line = rim(a); if (p[1] < line) p[1] = line; },
    paint: gradY(hy, hy + 0.13 * hs, 0.8, 1.16),
  });
  // the brow band along the rim, and a nape guard of two lames
  kit.loft([vs(hy + 0.05 * hs, 0.101 * hs + g + 0.004, 0.09 * hs + g + 0.004, hx - 0.001 * hs), vs(hy + 0.078 * hs, 0.1 * hs + g + 0.004, 0.088 * hs + g + 0.004, hx - 0.003 * hs)],
    { sides: 20, start: null, end: null, color: shade(gold, 0.82), mat: 'gold', bind: bind.head });
  for (let i = 0; i < 2; i++) {
    const yt = hy + (0.012 - 0.038 * i) * hs;
    const rx = (0.104 + 0.012 * i) * hs + g;
    const rz = (0.093 + 0.012 * i) * hs + g;
    kit.loft([vs(yt, rx, rz, hx - (0.004 + 0.01 * i) * hs), vs(yt - 0.042 * hs, rx * 1.08, rz * 1.1, hx - (0.012 + 0.01 * i) * hs)], {
      rings: 2, sides: 20, start: null, end: null, color: i ? shade(gold, 0.88) : gold, mat: 'gold', bind: bind.head,
      warp: (p, a) => { const k = smoothstep(0.95, 1.75, Math.abs(wrap(a))); p[1] = lerp(hy + 0.012 * hs, p[1], k); },
    });
  }
  // the beak: a needle from the brow, slightly up-curved
  kit.loft([ps(hx + 0.09 * hs, hy + 0.064 * hs, 0, 0.026 * hs), ps(hx + 0.16 * hs, hy + 0.074 * hs, 0, 0.018 * hs), ps(hx + 0.27 * hs, hy + 0.1 * hs, 0, 0.009 * hs), ps(hx + 0.38 * hs, hy + 0.14 * hs, 0, 0.0025 * hs)],
    { ref: [0, 0, 1], rings: 6, sides: 8, start: 'round', end: 'round', capRings: 1, capDepth: [0.012 * hs, 0.003 * hs], color: beak || shade(gold, 0.55), mat: 'metal', bind: bind.head });
  for (const side of [1, -1]) {
    kit.loft([ps(hx + 0.05 * hs, hy + 0.054 * hs, side * 0.086 * hs, 0.017 * hs, 0.017 * hs), ps(hx + 0.053 * hs, hy + 0.054 * hs, side * 0.098 * hs, 0.014 * hs, 0.014 * hs)],
      { ref: [1, 0, 0], sides: 10, start: null, end: 'round', capRings: 2, capDepth: 0.004 * hs, color: eye, mat: 'gem', glow: 0.5, bind: bind.head });
  }
  // the crest: plumes sweeping back and out over the crown
  const n = 7;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const s = (k - 0.5) * 2;
    feather(kit, [hx + 0.02 * hs - 0.05 * hs * Math.abs(s), hy + 0.106 * hs - 0.008 * hs * Math.abs(s), s * 0.05 * hs], [-0.85 + 0.2 * Math.abs(s), 0.5, s * 0.8], [0.1, 1, 0], (0.28 - 0.06 * Math.abs(s)) * hs, 0.026 * hs, {
      color: crest[i % crest.length], tip, bind: bind.head, bend: [-0.02 * hs, -0.05 * hs, s * 0.03 * hs], rows: 5, thick: 0.003 * hs,
    });
  }
}

/**
 * The rain god's face: a ring of white standing off the face round each eye (the goggles), a curled lip of white across the mouth and
 * a pair of jaguar fangs hanging from it. opts: ring (the goggles), fang (the teeth), lip (default the ring's color).
 */
export function addTlalocMask(kit, D, pal, bind, { ring, fang, lip = null } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const faceX = (z) => hx - 0.002 * hs + 0.102 * hs * Math.sqrt(Math.max(0, 1 - (z / (0.09 * hs)) ** 2));
  for (const side of [1, -1]) {
    const z = side * 0.041 * hs;
    const fx = faceX(z);
    const y = hy + 0.012 * hs;
    kit.loft([ps(fx - 0.006 * hs, y, z, 0.029 * hs, 0.029 * hs), ps(fx + 0.004 * hs, y, z, 0.04 * hs, 0.04 * hs), ps(fx + 0.012 * hs, y, z, 0.038 * hs, 0.038 * hs)],
      { ref: [0, 1, 0], rings: 3, sides: 14, start: null, end: null, color: ring, mat: 'bone', bind: bind.head });
  }
  const l = lip || ring;
  kit.loft([-0.045, -0.025, 0, 0.025, 0.045].map((z) => ps(faceX(z * hs) + 0.004 * hs, hy - 0.047 * hs, z * hs, 0.0065 * hs, 0.0065 * hs)),
    { ref: [1, 0, 0], rings: 6, sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.005 * hs, color: l, mat: 'bone', bind: bind.head });
  for (const side of [1, -1]) {
    const z = side * 0.022 * hs;
    kit.loft([ps(faceX(z) + 0.001 * hs, hy - 0.048 * hs, z, 0.009 * hs), ps(faceX(z) + 0.01 * hs, hy - 0.072 * hs, z * 1.15, 0.0065 * hs), ps(faceX(z) + 0.014 * hs, hy - 0.1 * hs, z * 1.3, 0.0015 * hs)],
      { ref: [1, 0, 0], rings: 4, sides: 6, start: null, end: 'round', capRings: 1, capDepth: 0.004 * hs, color: fang, mat: 'bone', bind: bind.head });
  }
}

/**
 * A stag's antlers, the druid's: on each side a beam that rises from the brow, out and up, curving back in toward its end,
 * a tine forward at its foot and others forking up from it, the end forked; over a band across the brow. opts: color (the
 * antler), band (the band's color; none: no band), size (scale of the antlers), tines (how many a side besides the fork, up to 3), mat.
 */
export function addAntlers(kit, D, pal, bind, { color, band = null, size = 1, tines = 3, mat = 'bone' } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  if (band) {
    const g = 0.011 * hs + 0.006 * hs;
    const y0 = hy + 0.046 * hs;
    const rx = 0.1 * hs + g;
    const rz = 0.088 * hs + g;
    kit.loft([vs(y0, rx, rz, hx - 0.002 * hs), vs(y0 + 0.014 * hs, rx + 0.002, rz + 0.002, hx - 0.002 * hs), vs(y0 + 0.028 * hs, rx, rz, hx - 0.002 * hs)],
      { rings: 3, sides: 22, start: null, end: null, color: band, mat: 'leather', bind: bind.head });
  }
  const beam = [[-0.004, 0.066, 0.056, 0.0158], [-0.012, 0.108, 0.092, 0.0138], [-0.03, 0.165, 0.122, 0.0112], [-0.056, 0.235, 0.132, 0.0088], [-0.076, 0.305, 0.12, 0.0062], [-0.086, 0.35, 0.102, 0.0036]];
  const list = [
    { i: 1, d: [0.85, 0.5, 0.15], L: 0.075 }, // the brow tine, forward over the face
    { i: 2, d: [0.45, 0.85, 0.3], L: 0.085 },
    { i: 3, d: [0.05, 0.95, 0.35], L: 0.1 },
  ].slice(0, Math.min(3, tines));
  list.push({ i: 4, d: [0.3, 1, 0.4], L: 0.075 }); // the fork at the end
  const wide = Math.sqrt(size);
  for (const side of [1, -1]) {
    const pt = ([dx, dy, dz]) => [hx + dx * hs, hy + dy * hs * size, side * dz * hs * wide];
    kit.loft(beam.map((b) => { const q = pt(b); return ps(q[0], q[1], q[2], b[3] * hs, b[3] * hs); }), {
      ref: [1, 0, 0], rings: 9, sides: 6, start: 'round', end: 'round', capDepth: [0.012 * hs, 0.004 * hs], color, mat, bind: bind.head, paint: gradY(hy + 0.06 * hs, hy + 0.36 * hs * size, 0.78, 1.08),
    });
    for (const t of list) {
      const b = beam[t.i];
      const base = pt(b);
      const d = [t.d[0], t.d[1], t.d[2] * side];
      const dl = Math.hypot(...d);
      const L = t.L * hs * size;
      const st = [];
      for (let k = 0; k <= 3; k++) {
        const u = k / 3;
        const r = b[3] * hs * 0.72 * (1 - u) ** 0.8 + 0.0025 * hs;
        st.push(ps(base[0] + (d[0] / dl) * L * u, base[1] + (d[1] / dl) * L * u + 0.35 * L * u * u, base[2] + (d[2] / dl) * L * u, r, r));
      }
      kit.loft(st, { ref: [1, 0, 0], rings: 4, sides: 5, start: null, end: 'round', capRings: 1, capDepth: 0.006 * hs, color, mat, bind: bind.head, paint: gradY(base[1], base[1] + L, 0.82, 1.1) });
    }
  }
}

// ---------------------------------------------------------------------------
// Mesopotamian headgear: the pointed helmet, the horned crown, the curled beard, the bun at the nape
// ---------------------------------------------------------------------------

/**
 * The pointed helmet of a Mesopotamian soldier: a tall cone of metal on a brow band, leaning back a little toward its point, a
 * ridge up the front, plates over the ears and a flap over the nape (a team color works for it). opts: steel, trim (the band and
 * the ridge), flap (the flap's color; none: no flap), tall (scale of the cone's height).
 */
export function addConeHelm(kit, D, pal, bind, { steel, trim, flap = null, tall = 1 } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.012 * hs;
  const T = tall;
  const cone = [
    vs(hy, 0.097 * hs + g, 0.086 * hs + g, hx),
    vs(hy + 0.04 * hs, 0.102 * hs + g, 0.09 * hs + g, hx - 0.002 * hs),
    vs(hy + 0.09 * hs * T, 0.09 * hs + g, 0.081 * hs + g, hx - 0.008 * hs),
    vs(hy + 0.15 * hs * T, 0.066 * hs + g, 0.06 * hs + g, hx - 0.02 * hs),
    vs(hy + 0.21 * hs * T, 0.036 * hs + g, 0.034 * hs + g, hx - 0.036 * hs),
    vs(hy + 0.262 * hs * T, 0.01 * hs, 0.01 * hs, hx - 0.05 * hs),
  ];
  kit.loft(cone, { rings: 9, sides: 16, start: null, end: 'round', capRings: 2, capDepth: 0.01 * hs, color: steel, mat: 'metal', bind: bind.head, paint: gradY(hy, hy + 0.27 * hs * T, 0.8, 1.14) });
  // the brow band, and the ridge from the band up the front to the point
  kit.loft([vs(hy + 0.012 * hs, 0.099 * hs + g + 0.004, 0.088 * hs + g + 0.004, hx), vs(hy + 0.05 * hs, 0.103 * hs + g + 0.004, 0.092 * hs + g + 0.004, hx - 0.002 * hs)],
    { sides: 16, start: null, end: null, color: trim, mat: 'gold', bind: bind.head });
  kit.loft(cone.slice(1).map((s) => ps(s.c[0] + s.rx + 0.003 * hs, s.c[1], 0, 0.006 * hs, 0.0075 * hs)), {
    ref: [0, 0, 1], rings: 5, sides: 6, start: null, end: null, color: trim, mat: 'gold', bind: bind.head,
  });
  // plates over the ears
  for (const side of [1, -1]) {
    kit.loft([ps(hx + 0.004 * hs, hy - 0.002 * hs, side * 0.094 * hs, 0.046 * hs, 0.01 * hs), ps(hx + 0.004 * hs, hy - 0.058 * hs, side * 0.088 * hs, 0.038 * hs, 0.008 * hs)],
      { ref: [1, 0, 0], sides: 8, capDepth: 0.008 * hs, color: shadeC(steel, 0.9), mat: 'metal', bind: bind.head });
  }
  if (flap) {
    // a flap of cloth over the nape, open at the face
    kit.loft([vs(hy + 0.012 * hs, 0.1 * hs + g, 0.09 * hs + g, hx), vs(hy - 0.06 * hs, 0.114 * hs + g, 0.106 * hs + g, hx - 0.014 * hs), vs(hy - 0.125 * hs, 0.134 * hs + g, 0.122 * hs + g, hx - 0.03 * hs)], {
      rings: 4, sides: 20, start: null, end: null, color: flap, mat: 'cloth', bind: bind.head, paint: gradY(hy - 0.125 * hs, hy + 0.012 * hs, 0.84, 1.02),
      warp: (p, a) => {
        const k = smoothstep(1.05, 1.75, Math.abs(wrap(a)));
        p[1] = lerp(hy + 0.012 * hs, p[1], k);
      },
    });
  }
}

/**
 * The horned crown of a god: a cap standing on the brow, `tiers` pairs of bull's horns one over another, each wound out from the
 * front of the cap to the side and lifting off it at the tip, the lowest the longest, a ring of metal between the tiers and a disc
 * on the top. opts: cap (the cap's color), horn (the horns' color), trim (the rings and the disc), tiers, tall (scale of a tier's
 * height), star (the color of an eight-pointed star on the front: Ishtar's), hornMat (the horns' surface class), horns (false: a plain
 * cap, a priest's).
 */
export function addHornedTiara(kit, D, pal, bind, { cap, horn, trim, tiers = 3, tall = 1, star = null, hornMat = 'gold', horns = true } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.012 * hs;
  const tier = 0.034 * hs * tall;
  const y0 = hy + 0.04 * hs;
  const H = tier * tiers + 0.01 * hs;
  const rx = (y) => (0.1 - 0.02 * ((y - y0) / H)) * hs + g;
  const rz = (y) => (0.089 - 0.018 * ((y - y0) / H)) * hs + g;
  const ring = (y, r = 0.004 * hs) => vs(y, rx(y) + r, rz(y) + r, hx - 0.004 * hs);
  // the cap, from the brow to a rounded top
  kit.loft([ring(y0 - 0.024 * hs, 0.007 * hs), ring(y0 + H * 0.5, 0.007 * hs), ring(y0 + H, 0.007 * hs)], {
    rings: 4, sides: 20, start: null, end: 'round', capRings: 2, capDepth: 0.016 * hs, color: cap, mat: 'cloth', bind: bind.head, paint: gradY(y0, y0 + H, 0.86, 1.06),
  });
  // rings of metal at the foot, between the tiers and at the top
  for (let i = 0; i <= tiers; i++) {
    const y = y0 + i * tier + (i === tiers ? 0.004 * hs : 0);
    kit.loft([ring(y - 0.005 * hs, 0.012 * hs), ring(y + 0.005 * hs, 0.012 * hs)], { sides: 20, start: null, end: null, color: trim, mat: 'gold', bind: bind.head });
  }
  // the horns: each a tube from the front quarter of the cap round to its side, standing off it more and more, its tip lifting
  for (let i = 0; horns && i < tiers; i++) {
    const y = y0 + tier * (i + 0.5);
    const big = 1 - 0.16 * i;
    for (const side of [1, -1]) {
      const st = [];
      const n = 6;
      for (let j = 0; j <= n; j++) {
        const t = j / n;
        const th = 0.55 + t * 0.9;
        const out = (0.01 + 0.075 * t ** 1.2) * hs * big;
        const x = hx - 0.004 * hs + (rx(y) + out) * Math.cos(th);
        const z = side * (rz(y) + out) * Math.sin(th);
        const rise = 0.09 * hs * big * t ** 2;
        const r = (0.021 - 0.017 * t ** 0.8) * hs * (0.8 + 0.2 * big);
        st.push(ps(x, y + rise, z, r, r));
      }
      kit.loft(st, { ref: [0, 1, 0], rings: n, sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: [0.01 * hs, 0.004 * hs], color: horn, mat: hornMat, bind: bind.head });
    }
  }
  // the disc on the top, and a knob
  const yt = y0 + H + 0.012 * hs;
  kit.loft([vs(yt, rx(y0 + H) * 0.8, rz(y0 + H) * 0.8, hx - 0.004 * hs), vs(yt + 0.008 * hs, rx(y0 + H) * 0.7, rz(y0 + H) * 0.7, hx - 0.004 * hs)],
    { sides: 16, start: 'flat', end: 'round', capRings: 2, capDepth: 0.006 * hs, color: trim, mat: 'gold', bind: bind.head });
  if (star) {
    // an eight-pointed star on the front of the second tier
    const ys = y0 + tier * Math.min(tiers - 1, 1.5) + 0.01 * hs;
    const R = 0.04 * hs;
    const xf = hx - 0.004 * hs + rx(ys) + 0.012 * hs;
    kit.loft([ps(xf, ys, 0, R, R), ps(xf + 0.007 * hs, ys, 0, R * 0.92, R * 0.92)], {
      ref: [0, 1, 0], sides: 32, start: 'round', end: 'round', capRings: 1, capDepth: 0.005 * hs, color: star, mat: 'gold', glow: 0.55, bind: bind.head,
      warp: (p, a) => {
        const k = 0.42 + 0.58 * Math.abs(Math.cos(a * 4)) ** 1.4;
        p[1] = ys + (p[1] - ys) * k;
        p[2] *= k;
      },
    });
  }
}

/**
 * The Assyrian beard: squared off, broad, in rows of tight curls from the lip to the chest. opts: len (scale of its length),
 * wide (scale of its breadth), rows (of curls), color (a shade that lets the curls show: black hair is too dark to read).
 */
export function addCurledBeard(kit, D, pal, bind, { len = 1, wide = 1, rows = 4, color = null } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const L = len;
  kit.loft([
    ps(hx + 0.068 * hs, hy - 0.05 * hs, 0, 0.03 * hs, 0.072 * hs * wide, 3),
    ps(hx + 0.084 * hs, hy - 0.1 * hs, 0, 0.042 * hs, 0.076 * hs * wide, 3),
    ps(hx + 0.088 * hs, hy - (0.1 + 0.07 * L) * hs, 0, 0.046 * hs, 0.074 * hs * wide, 3),
    ps(hx + 0.08 * hs, hy - (0.1 + 0.13 * L) * hs, 0, 0.04 * hs, 0.062 * hs * wide, 3),
    ps(hx + 0.07 * hs, hy - (0.1 + 0.18 * L) * hs, 0, 0.022 * hs, 0.034 * hs * wide, 3),
  ], {
    ref: [1, 0, 0], rings: rows * 3 + 2, sides: 12, start: 'round', end: 'round', capDepth: [0.02 * hs, 0.022 * hs], color: color || pal.hair, mat: 'hair', bind: bind.head,
    warp: (p, a, u) => {
      const k = 0.017 * hs * Math.max(0, Math.sin(u * rows * TAU - 1.2)) ** 1.3 * smoothstep(0.05, 0.25, u);
      p[0] += Math.cos(a) * k;
      p[2] += Math.sin(a) * k;
    },
    paint: (o, x, y, z, u) => mul(o, 0.64 + 0.54 * Math.max(0, Math.sin(u * rows * TAU - 1.2))),
  });
}

/**
 * The head of a fish worn as a hood, the apkallu's: a cap over the skull and down the nape with the snout out over the brow and a
 * pale lip under it, an eye bulging at each temple and a crest of spines along the top. opts: color (the scales), belly (the lip),
 * fin (the crest; a team color works), eye.
 */
export function addFishHood(kit, D, pal, bind, { color, belly, fin, eye = '#f3efe0' } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.013 * hs;
  const cap = [
    vs(hy - 0.11 * hs, 0.112 * hs + g, 0.1 * hs + g, hx - 0.026 * hs),
    vs(hy - 0.04 * hs, 0.108 * hs + g, 0.098 * hs + g, hx - 0.014 * hs),
    vs(hy + 0.02 * hs, 0.108 * hs + g, 0.098 * hs + g, hx - 0.008 * hs),
    vs(hy + 0.064 * hs, 0.102 * hs + g, 0.092 * hs + g, hx - 0.01 * hs),
    vs(hy + 0.102 * hs, 0.08 * hs + g, 0.074 * hs + g, hx - 0.014 * hs),
    vs(hy + 0.13 * hs, 0.044 * hs + g, 0.042 * hs + g, hx - 0.016 * hs),
  ];
  kit.loft(cap, {
    rings: 9, sides: 18, start: null, end: 'round', capDepth: 0.012 * hs, color, mat: 'painted', bind: bind.head,
    warp: (p, a) => {
      // the lower edge: up over the brow, hanging at the cheeks, long at the nape
      const line = hy + 0.052 * hs - 0.17 * hs * smoothstep(0.55, 1.7, Math.abs(wrap(a)));
      if (p[1] < line) p[1] = line;
    },
    paint: (o, x, y, z, u) => mul(o, 0.8 + 0.26 * ((u * 7) % 1)),
  });
  // the snout over the brow, blunt and broad, and the lip under it
  kit.loft([
    ps(hx + 0.02 * hs, hy + 0.09 * hs, 0, 0.04 * hs, 0.074 * hs),
    ps(hx + 0.07 * hs, hy + 0.086 * hs, 0, 0.04 * hs, 0.078 * hs),
    ps(hx + 0.115 * hs, hy + 0.076 * hs, 0, 0.032 * hs, 0.066 * hs),
    ps(hx + 0.145 * hs, hy + 0.062 * hs, 0, 0.018 * hs, 0.04 * hs),
  ], { ref: [0, 1, 0], rings: 5, sides: 10, start: null, end: 'round', capRings: 2, capDepth: 0.016 * hs, color, mat: 'painted', bind: bind.head });
  kit.loft([ps(hx + 0.05 * hs, hy + 0.052 * hs, 0, 0.01 * hs, 0.07 * hs), ps(hx + 0.128 * hs, hy + 0.044 * hs, 0, 0.007 * hs, 0.044 * hs)],
    { ref: [0, 1, 0], sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.006 * hs, color: belly, mat: 'trim', bind: bind.head });
  // an eye at each temple: a pale ball with a dark pupil
  for (const side of [1, -1]) {
    knob(kit, [hx + 0.035 * hs, hy + 0.076 * hs, side * 0.108 * hs], 0.017 * hs, { color: eye, mat: 'bone', bind: bind.head });
    knob(kit, [hx + 0.04 * hs, hy + 0.076 * hs, side * 0.12 * hs], 0.009 * hs, { color: '#1b1814', mat: 'gem', bind: bind.head });
  }
  // the fin along the top: a row of spines from the snout's root over the crown to the nape, swept back
  const n = 10;
  kit.sheet(n, 1, (u, j, out) => {
    const phi = lerp(1.3, 2.85, u);
    const spike = Math.round(u * n) % 2 ? 1 : 0.5;
    const h = (0.012 + 0.03 * Math.sin(PI * u) ** 0.8) * hs * spike * j;
    const R = 0.108 * hs + g;
    const bx = hx - 0.016 * hs + Math.cos(phi) * R;
    const by = hy + 0.028 * hs + Math.sin(phi) * 0.108 * hs;
    out[0] = bx + (Math.cos(phi) * 0.6 - Math.sin(phi) * 0.8) * h;
    out[1] = by + (Math.sin(phi) * 0.6 + Math.cos(phi) * 0.8) * h;
    out[2] = 0;
  }, { thick: 0.004 * hs, color: fin, inner: fin, bind: bind.head });
}

/** Hair rolled up at the nape in rows of curls, the Assyrian way (under a headband or bare). opts: size (its scale). */
export function addNapeBun(kit, D, pal, bind, { size = 1 } = {}) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const rows = 3;
  kit.loft([
    ps(hx - 0.1 * hs, hy + 0.03 * hs, 0, 0.026 * hs * size, 0.07 * hs * size),
    ps(hx - 0.122 * hs, hy - 0.02 * hs, 0, 0.034 * hs * size, 0.085 * hs * size),
    ps(hx - 0.13 * hs, hy - 0.08 * hs, 0, 0.036 * hs * size, 0.082 * hs * size),
    ps(hx - 0.118 * hs, hy - 0.13 * hs, 0, 0.026 * hs * size, 0.06 * hs * size),
  ], {
    ref: [1, 0, 0], rings: rows * 3 + 1, sides: 12, start: 'round', end: 'round', capDepth: 0.02 * hs, color: pal.hair, mat: 'hair', bind: bind.head,
    warp: (p, a, u) => {
      const k = 0.008 * hs * Math.max(0, Math.sin(u * rows * TAU - 0.8));
      p[0] += Math.cos(a) * k;
      p[2] += Math.sin(a) * k;
    },
    paint: (o, x, y, z, u) => mul(o, 0.74 + 0.34 * Math.max(0, Math.sin(u * rows * TAU - 0.8))),
  });
}
