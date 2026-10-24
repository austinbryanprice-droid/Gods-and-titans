// Head dressing for the rich humanoids: hair, beards, hoods, helmets and horns, lofted over the
// skull the body builds (rich-body.js addHeadAndNeck) and weighted to the head bone. The pantheon
// outfits (rich-outfits.js) choose among them.
import { shadeC, tintC } from './unit-geo.js';
import { vs, ps, smoothstep } from './rich-kit.js';
import { torsoRing } from './rich-body.js';
import { clamp, lerp, gradY, paints, recolor } from './rich-paint.js';
import { feather } from './rich-feathers.js';

const PI = Math.PI;
const TAU = PI * 2;
const wrap = (a) => (a > PI ? a - TAU : a);

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
  // moustache
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
 * rearing cobra at the brow. opts: disk (the glowing face), metal.
 */
export function addSunDisk(kit, D, pal, bind, { disk, metal, size = 1 } = {}) {
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
  addUraeus(kit, D, bind, metal, { y: 0.048, size: 1.15 });
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
