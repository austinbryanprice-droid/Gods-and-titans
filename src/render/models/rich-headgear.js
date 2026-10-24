// Head dressing for the rich humanoids: hair, beards, hoods, helmets and horns, lofted over the
// skull the body builds (rich-body.js addHeadAndNeck) and weighted to the head bone. The pantheon
// outfits (rich-outfits.js) choose among them.
import { shadeC } from './unit-geo.js';
import { vs, ps, smoothstep } from './rich-kit.js';
import { clamp, lerp, gradY, paints } from './rich-paint.js';
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
