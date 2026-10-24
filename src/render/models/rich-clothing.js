// Garments for the rich humanoids, each a smooth layer lofted over the body's own stations
// (rich-body.js) and weighted to the same bones, so cloth follows the limb under it: tunics,
// belts, cuirasses, pauldrons, mantles and capes. The pantheon outfits (rich-outfits.js) choose
// and color them.
import { shadeC } from './unit-geo.js';
import { vs, ps, B, smoothstep } from './rich-kit.js';
import { torsoStations, torsoRing, legRing } from './rich-body.js';
import { clamp, lerp, hash, mul, dye, gradY, paints } from './rich-paint.js';

const PI = Math.PI;
const TAU = PI * 2;
const wrap = (a) => (a > PI ? a - TAU : a);

export function addTunic(kit, D, color, bind, hem, opts = {}) {
  const st = torsoStations(D, 0.012);
  const y0 = D.hipY - hem;
  const out = [vs(y0, D.depth * 0.62 + 0.02, D.waistW * 0.66 + 0.02), ...st];
  kit.loft(out, {
    rings: 11, start: null, end: 'round', capDepth: 0.01, color, bind: opts.skirted ? bind.skirt : bind.torso, mat: opts.mat,
    paint: paints(gradY(D.hipY - hem, D.hipY + 0.05, 0.82, 1), opts.paint),
  });
}

export function addBelt(kit, D, pal, bind, color = pal.leather, buckle = pal.accentMetal, mat = 'leather') {
  const y = (f) => D.hipY + (D.shoulderY - D.hipY) * f;
  const g = 0.02;
  kit.loft([vs(y(0.03), D.depth * 0.52 + g, D.waistW * 0.56 + g), vs(y(0.13), D.depth * 0.5 + g, D.waistW * 0.52 + g)],
    { sides: 14, rings: 3, start: null, end: null, color, mat, bind: bind.torso });
  // buckle
  kit.loft([ps(D.depth * 0.5 + g + 0.004, y(0.08), 0, 0.022, 0.03), ps(D.depth * 0.5 + g + 0.012, y(0.08), 0, 0.02, 0.026)],
    { ref: [0, 1, 0], sides: 4, capDepth: 0.004, color: buckle, bind: bind.torso, glow: 0 });
}

/** A metal breastplate, with a few lames below it, over the tunic. */
export function addCuirass(kit, D, pal, bind, color, trim, trimGlow = 0) {
  const y = (f) => D.hipY + (D.shoulderY - D.hipY) * f;
  const g = 0.026;
  const plate = [
    vs(y(0.24), D.depth * 0.5 + g, D.waistW * 0.5 + g),
    vs(y(0.5), D.chestD * 0.46 + g, D.chestW * 0.43 + g, 0.004),
    vs(y(0.74), D.chestD * 0.5 + g, D.chestW * 0.5 + g, 0.008),
    vs(y(0.93), D.chestD * 0.42 + g, D.chestW * 0.45 + g, 0.004),
    vs(y(1.0), D.chestD * 0.32 + g, D.chestW * 0.34 + g),
  ];
  // (fire-forged plate: a glowing seam down the front and under each arm)
  const seam = trimGlow ? (o, x, y, z, u, a) => {
    const w = Math.max(smoothstep(0.07, 0.0, Math.min(a, 1 - a)), 0.8 * smoothstep(0.06, 0.0, Math.abs(a - 0.25)), 0.8 * smoothstep(0.06, 0.0, Math.abs(a - 0.75)));
    if (w <= 0) return;
    o.r = lerp(o.r, trim.r, w);
    o.g = lerp(o.g, trim.g, w);
    o.b = lerp(o.b, trim.b, w);
    o.glow = trimGlow * w;
  } : null;
  kit.loft(plate, { rings: 8, start: null, end: null, sides: 16, color, bind: bind.torso, paint: paints(gradY(y(0.2), y(1.0), 0.78, 1.08), seam), mat: trimGlow ? 'iron' : undefined });
  // gorget ring at the neck and a rim along the bottom edge
  kit.loft([vs(y(0.225), D.depth * 0.5 + g + 0.004, D.waistW * 0.5 + g + 0.004), vs(y(0.27), D.depth * 0.5 + g + 0.006, D.waistW * 0.5 + g + 0.006)],
    { sides: 16, start: null, end: null, color: trim, bind: bind.torso, glow: trimGlow });
  // lames: overlapping bands below the plate
  for (let i = 0; i < 3; i++) {
    const f = 0.2 - i * 0.085;
    const rx = D.depth * 0.53 + 0.02 + i * 0.006;
    const rz = D.waistW * 0.56 + 0.026 + i * 0.01;
    kit.loft([vs(y(f - 0.075), rx + 0.012, rz + 0.012), vs(y(f), rx, rz)], { sides: 16, start: null, end: null, color: shadeC(color, 0.9 - i * 0.03), bind: bind.skirt, mat: trimGlow ? 'iron' : undefined });
  }
}

export function addPauldrons(kit, D, pal, bind, color, trim, trimGlow = 0) {
  const sh = D.shoulderY - 0.02;
  const K = D.k;
  for (const side of [1, -1]) {
    const upper = side > 0 ? B.upperR : B.upperL;
    const bd = (x, y, z, S) => {
      S.add(upper, 0.65);
      S.add(B.chest, 0.35);
    };
    const z = side * (D.shoulderZ + 0.004);
    for (let i = 0; i < 2; i++) {
      const s = 1 - i * 0.22;
      kit.loft([
        vs(sh - 0.012 - i * 0.028, 0.078 * K * s, 0.074 * K * s, 0.0, z),
        vs(sh + 0.018 - i * 0.02, 0.07 * K * s, 0.068 * K * s, 0.0, z),
        vs(sh + 0.04 - i * 0.012, 0.048 * K * s, 0.046 * K * s, 0.0, z),
      ], { rings: 6, sides: 12, start: null, end: 'round', capDepth: 0.02 * K, color: i ? shadeC(color, 0.9) : color, bind: bd, mat: trimGlow ? 'iron' : undefined });
    }
    kit.loft([vs(sh - 0.034, 0.083 * K, 0.079 * K, 0, z), vs(sh - 0.022, 0.082 * K, 0.078 * K, 0, z)], { sides: 14, start: null, end: null, color: trim, bind: bd, glow: trimGlow });
  }
}

export function addFurMantle(kit, D, pal, bind) {
  const sh = D.shoulderY;
  const K = D.k;
  const fur = pal.fur;
  const tuft = (rows) => (p, a, u) => {
    const aa = wrap(a);
    const n = hash(Math.round(aa * 20), rows, 3);
    p[1] -= 0.022 * u * (0.5 + n);
    p[0] += (n - 0.5) * 0.006;
  };
  kit.loft([vs(sh + 0.032, 0.07 * K, 0.1 * K, -0.004), vs(sh + 0.008, 0.108 * K, 0.17 * K, -0.012), vs(sh - 0.04, 0.12 * K, 0.215 * K, -0.014)],
    { rings: 6, sides: 16, start: null, end: null, color: fur, mat: 'fur', bind: bind.torso, warp: tuft(1), paint: (o, x, y, z, u) => mul(o, lerp(1.08, 0.84, u)) });
  kit.loft([vs(sh - 0.006, 0.1 * K, 0.16 * K, -0.012), vs(sh - 0.05, 0.122 * K, 0.208 * K, -0.014), vs(sh - 0.1, 0.108 * K, 0.19 * K, -0.012)],
    { rings: 6, sides: 16, start: null, end: null, color: shadeC(fur, 0.92), mat: 'fur', bind: bind.torso, warp: tuft(2), paint: (o, x, y, z, u) => mul(o, lerp(1.0, 0.8, u)) });
}

/** A cape down the back. opts: len (scale of the length, 1 reaches the knees), wide (scale of the width). */
export function addCape(kit, D, color, hemColor, lining, bind, { len: lenK = 1, wide = 1 } = {}) {
  const top = D.shoulderY + 0.005;
  const len = ((D.shoulderY - 0.05) - 0.12) * lenK;
  const w0 = D.chestW * 0.78 * wide;
  const w1 = D.chestW * 1.28 * wide;
  const fn = (u, v, out) => {
    const z = (0.5 - u) * lerp(w0, w1, v);
    const edge = 1 - Math.abs(u - 0.5) * 2;
    const pleat = Math.sin(u * PI * 7) * 0.013 * v * (0.4 + 0.6 * edge);
    out[0] = -D.chestD * 0.52 - 0.012 - 0.07 * v - 0.025 * v * v + pleat - 0.02 * (1 - edge) * v;
    out[1] = top - v * len;
    out[2] = z;
  };
  kit.sheet(7, 9, fn, {
    thick: 0.007, color, inner: lining, bind: bind.cape, paint: paints(gradY(top - len, top, 0.82, 1.0)),
  });
  // a trim band along the hem
  kit.sheet(7, 1, (u, v, out) => {
    fn(u, 0.9 + 0.1 * v, out);
  }, { thick: 0.008, color: hemColor, inner: hemColor, bind: bind.cape });
}

// ---------------------------------------------------------------------------
// classical dress: a hero's bronze, kilts of leather strips, shin guards, drapes and collars
// ---------------------------------------------------------------------------

/**
 * A hero's cuirass of bronze, the chest and belly sculpted in the metal (pectorals, a ridge under
 * the chest, the bands of the belly, a groove down the middle), flared at the lower edge and
 * rimmed at the neck. opts: medallion (a gem disc over the breastbone, given its color).
 */
export function addMuscleCuirass(kit, D, pal, bind, color, trim, { medallion = null } = {}) {
  const y = (f) => D.hipY + (D.shoulderY - D.hipY) * f;
  const K = D.k;
  const g = 0.02;
  const plate = [
    vs(y(0.1), D.depth * 0.5 + g + 0.014, D.waistW * 0.52 + g + 0.014),
    vs(y(0.2), D.depth * 0.5 + g, D.waistW * 0.5 + g),
    vs(y(0.5), D.chestD * 0.46 + g, D.chestW * 0.43 + g, 0.004),
    vs(y(0.74), D.chestD * 0.5 + g, D.chestW * 0.5 + g, 0.008),
    vs(y(0.93), D.chestD * 0.42 + g, D.chestW * 0.45 + g, 0.004),
    vs(y(1.0), D.chestD * 0.32 + g, D.chestW * 0.34 + g),
  ];
  const sculpt = (p, a) => {
    const aa = wrap(a);
    const yy = p[1];
    const pec = Math.exp(-(((Math.abs(aa) - 0.36) / 0.24) ** 2)) * Math.exp(-(((yy - y(0.7)) / (0.075 * K)) ** 2));
    const under = Math.exp(-(((Math.abs(aa) - 0.3) / 0.3) ** 2)) * Math.exp(-(((yy - y(0.56)) / (0.016 * K)) ** 2));
    const belly = Math.exp(-((aa / 0.34) ** 2)) * (yy < y(0.52) && yy > y(0.14) ? Math.max(0, Math.sin(((yy - y(0.14)) / (0.05 * K)) * PI)) : 0);
    const groove = Math.exp(-((aa / 0.07) ** 2)) * (yy < y(0.52) ? 1 : 0);
    const k = 0.014 * pec + 0.006 * under + 0.006 * belly - 0.005 * groove;
    p[0] += Math.cos(aa) * k;
    p[2] += Math.sin(aa) * k;
  };
  kit.loft(plate, { rings: 14, start: null, end: null, sides: 24, color, bind: bind.torso, warp: sculpt, paint: gradY(y(0.1), y(1.0), 0.8, 1.1) });
  // a rolled rim along the bottom edge and round the neck
  kit.loft([vs(y(0.085), D.depth * 0.5 + g + 0.02, D.waistW * 0.52 + g + 0.02), vs(y(0.125), D.depth * 0.5 + g + 0.016, D.waistW * 0.52 + g + 0.016)],
    { sides: 18, start: null, end: null, color: trim, bind: bind.torso });
  kit.loft([vs(y(0.985), D.chestD * 0.32 + g + 0.004, D.chestW * 0.34 + g + 0.004), vs(y(1.03), D.chestD * 0.3 + g + 0.004, D.chestW * 0.32 + g + 0.004)],
    { sides: 16, start: null, end: null, color: trim, bind: bind.torso });
  if (medallion) {
    const r = torsoRing(D, 0.68, g + 0.006);
    const xf = r.dx + r.rx;
    kit.loft([ps(xf - 0.004, y(0.68), 0, 0.034 * K, 0.034 * K), ps(xf + 0.008, y(0.68), 0, 0.03 * K, 0.03 * K)],
      { ref: [0, 1, 0], sides: 14, start: 'round', end: 'round', capDepth: 0.008, color: medallion, mat: 'gem', glow: 0.55, bind: bind.torso });
    kit.loft([ps(xf - 0.002, y(0.68), 0, 0.041 * K, 0.041 * K), ps(xf + 0.004, y(0.68), 0, 0.041 * K, 0.041 * K)],
      { ref: [0, 1, 0], sides: 14, start: null, end: null, color: trim, bind: bind.torso });
  }
}

/**
 * A kilt of leather strips (pteruges) hanging from the waist in two overlapping rows, each strip
 * rounded off at the bottom. opts: color (the cloth or leather of the strips), lower (the longer
 * row, default the same), edge (hem color), strips (per row), len (scale of the length).
 */
export function addPteruges(kit, D, pal, bind, { color, lower = null, edge = null, strips = 16, len = 1 } = {}) {
  const sides = strips * 2;
  const top = D.hipY + 0.035;
  const row = (y1, cTop, cBottom, col, hem) => {
    const r = (c) => [D.depth * 0.5 + c, D.waistW * 0.5 + c * 1.15];
    const [tx, tz] = r(cTop);
    const [bx, bz] = r(cBottom);
    kit.loft([vs(y1, bx, bz), vs(lerp(y1, top, 0.5), (tx + bx) / 2, (tz + bz) / 2), vs(top, tx, tz)], {
      rings: 4, sides, start: null, end: null, color: col, bind: bind.skirt,
      warp: (p, a, u) => {
        // strips lobe out and round off toward the hem; between them the leather is cut higher
        const ph = Math.cos(a * strips);
        const k = 1 - u;
        const rad = 0.005 * ph * k;
        p[0] += Math.cos(a) * rad;
        p[2] += Math.sin(a) * rad;
        p[1] += 0.016 * k * k * (ph - 1) * 0.5;
      },
      paint: (o, x, yy, z, u, a) => {
        mul(o, 0.9 + 0.1 * Math.cos(a * TAU * strips / TAU));
        if (hem && u < 0.12) dye(o, hem, 0.85);
      },
    });
  };
  row(D.hipY - 0.185 * len, 0.036, 0.1, lower || color, edge);
  row(D.hipY - 0.1 * len, 0.044, 0.088, color, edge);
}

/** Shin guards from above the ankle to below the knee: a ridge down the shin and a flared top. */
export function addGreaves(kit, D, pal, bind, color, trim) {
  const knee = D.hipY - D.thigh;
  const y0 = D.ankleY + 0.035;
  const y1 = knee + 0.03;
  const n = 7;
  for (const side of [1, -1]) {
    const st = [];
    for (let i = 0; i < n; i++) st.push(legRing(D, side, lerp(y0, y1, i / (n - 1)), 0.012 + (i === n - 1 ? 0.01 : 0)));
    kit.loft(st, {
      rings: 7, sides: 14, start: null, end: null, color, bind: bind.leg[side],
      warp: (p, a) => {
        const aa = wrap(a);
        p[0] += Math.cos(aa) * 0.007 * Math.exp(-((aa / 0.32) ** 2));
      },
      paint: gradY(y0, y1, 0.84, 1.08),
    });
    kit.loft([legRing(D, side, y0 - 0.008, 0.017), legRing(D, side, y0 + 0.012, 0.016)], { sides: 14, start: null, end: null, color: trim, bind: bind.leg[side] });
    kit.loft([legRing(D, side, y1 - 0.014, 0.027), legRing(D, side, y1 + 0.004, 0.024)], { sides: 14, start: null, end: null, color: trim, bind: bind.leg[side] });
  }
}

/**
 * A drape across the chest from one shoulder to the opposite hip, close over the body (a himation
 * worn over bare skin). side: 1 from the left shoulder to the right hip, -1 the other way.
 */
export function addDrape(kit, D, bind, color, trim, { side = 1, width = 0.2 } = {}) {
  const fn = (u, v, out) => {
    const th = lerp(-1.3, 1.45, v) * side;
    const f = lerp(1.04, 0.14, v) + (u - 0.5) * width;
    const r = torsoRing(D, clamp(f, 0.02, 1.07), 0.024 + 0.004 * Math.sin(v * PI * 3 + u * 2.4));
    out[0] = r.dx + r.rx * Math.cos(th);
    out[1] = r.y;
    out[2] = r.rz * Math.sin(th);
  };
  kit.sheet(6, 16, fn, {
    thick: 0.008, color, inner: shadeC(color, 0.82), bind: bind.torso,
    paint: (o, x, y, z, u, a) => {
      mul(o, 0.9 + 0.1 * Math.sin(a * PI));
      if (trim && (u < 0.1 || u > 0.9)) dye(o, trim, 0.9);
    },
  });
}

/**
 * A short cape (chlamys): a collar of the same cloth over both shoulders, the cape itself down the
 * back to the thighs, a clasp at the throat. clasp: the metal of the clasp.
 */
export function addChlamys(kit, D, color, hemColor, lining, bind, clasp) {
  const K = D.k;
  const sh = D.shoulderY;
  addCape(kit, D, color, hemColor, lining, bind, { len: 0.62, wide: 0.9 });
  kit.loft([vs(sh + 0.03, 0.068 * K, 0.1 * K, -0.004), vs(sh + 0.006, 0.104 * K, 0.172 * K, -0.011), vs(sh - 0.034, 0.114 * K, 0.212 * K, -0.013)], {
    rings: 5, sides: 16, start: null, end: null, color, bind: bind.torso, paint: (o, x, y, z, u) => mul(o, lerp(1.04, 0.86, u)),
  });
  if (clasp) {
    const x = 0.066 * K + 0.026;
    kit.loft([ps(x - 0.004, sh + 0.004, 0, 0.017 * K, 0.017 * K), ps(x + 0.01, sh + 0.004, 0, 0.012 * K, 0.012 * K)],
      { ref: [0, 1, 0], sides: 10, start: 'round', end: 'round', capDepth: 0.008, color: clasp, bind: bind.torso });
  }
}

/**
 * A band of Greek key (meander) round a skirt hem or collar at height y: ink ground with the key
 * picked out in light squares. rx, rz the ring at its foot.
 */
export function addMeander(kit, bind, y, rx, rz, { color, ink, h = 0.034, cols = 26, bound = bind.skirt } = {}) {
  kit.loft([vs(y, rx, rz), vs(y + h, rx - 0.004, rz - 0.004)], {
    rings: 4, sides: cols * 2, start: null, end: null, color: ink, bind: bound,
    paint: (o, x, yy, z, u, a) => {
      const col = Math.floor(a * cols * 2) / 2;
      const row = u < 0.5 ? 0 : 1;
      if ((Math.floor(col) + row) % 2 === 0) dye(o, color, 0.9);
    },
  });
}
