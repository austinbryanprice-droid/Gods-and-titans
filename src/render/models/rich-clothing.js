// Garments for the rich humanoids, each a smooth layer lofted over the body's own stations
// (rich-body.js) and weighted to the same bones, so cloth follows the limb under it: tunics,
// belts, cuirasses, pauldrons, mantles and capes. The pantheon outfits (rich-outfits.js) choose
// and color them.
import * as THREE from 'three';
import { shadeC, TEAM } from './unit-geo.js';
import { vs, ps, B, smoothstep } from './rich-kit.js';
import { torsoStations, torsoRing, legRing, ringAt, legStations, legFrom, armStations } from './rich-body.js';
import { clamp, lerp, hash, mul, dye, gradY, paints, recolor, quilt, tartan, mailSheen } from './rich-paint.js';

const PI = Math.PI;
const TAU = PI * 2;
const wrap = (a) => (a > PI ? a - TAU : a);

/** A shade of a color that stays a team color when it is one (shadeC would turn it into a plain grey). */
const shade = (c, k) => (c && c.team ? TEAM(c.team * k, c.mat) : shadeC(c, k));

/** The front surface (x) of a garment's stations (ascending in height) at height y: where a panel hanging on its front rests. */
function frontAt(st, y) {
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i];
    const b = st[i + 1];
    if (y <= b.c[1] || i + 2 === st.length) return lerp(a.c[0] + a.rx, b.c[0] + b.rx, clamp((y - a.c[1]) / (b.c[1] - a.c[1] || 1e-9)));
  }
  return st[0].c[0] + st[0].rx;
}

export function addTunic(kit, D, color, bind, hem, opts = {}) {
  const st = torsoStations(D, 0.012);
  const y0 = D.hipY - hem;
  const out = [vs(y0, D.depth * 0.62 + 0.02, D.waistW * 0.66 + 0.02), ...st];
  kit.loft(out, {
    rings: 11, start: null, end: 'round', capDepth: 0.01, color, bind: opts.skirted ? bind.skirt : bind.torso, mat: opts.mat,
    paint: paints(gradY(D.hipY - hem, D.hipY + 0.05, 0.82, 1), opts.paint),
  });
}

export function addBelt(kit, D, pal, bind, color = pal.leather, buckle = pal.accentMetal, mat = 'leather', g = 0.02) {
  const y = (f) => D.hipY + (D.shoulderY - D.hipY) * f;
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

/** Round shoulder guards: two domed plates a side over a rim. `fine` (sides, rings) coarsens them where a figure is already heavy. */
export function addPauldrons(kit, D, pal, bind, color, trim, trimGlow = 0, { sides = 12, rings = 6 } = {}) {
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
      ], { rings, sides, start: null, end: 'round', capDepth: 0.02 * K, capRings: rings < 6 ? 2 : undefined, color: i ? shadeC(color, 0.9) : color, bind: bd, mat: trimGlow ? 'iron' : undefined });
    }
    kit.loft([vs(sh - 0.034, 0.083 * K, 0.079 * K, 0, z), vs(sh - 0.022, 0.082 * K, 0.078 * K, 0, z)], { sides: sides === 12 ? 14 : sides, start: null, end: null, color: trim, bind: bd, glow: trimGlow });
  }
}

/** The fur collar over the shoulders. opts.paint: more color work over the fur (a jaguar's rosettes). */
export function addFurMantle(kit, D, pal, bind, { paint = null } = {}) {
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
    { rings: 6, sides: 16, start: null, end: null, color: fur, mat: 'fur', bind: bind.torso, warp: tuft(1), paint: paints((o, x, y, z, u) => mul(o, lerp(1.08, 0.84, u)), paint) });
  kit.loft([vs(sh - 0.006, 0.1 * K, 0.16 * K, -0.012), vs(sh - 0.05, 0.122 * K, 0.208 * K, -0.014), vs(sh - 0.1, 0.108 * K, 0.19 * K, -0.012)],
    { rings: 6, sides: 16, start: null, end: null, color: shadeC(fur, 0.92), mat: 'fur', bind: bind.torso, warp: tuft(2), paint: paints((o, x, y, z, u) => mul(o, lerp(1.0, 0.8, u)), paint) });
}

/** A cape down the back. opts: len (scale of the length, 1 reaches the knees), wide (scale of the width), paint (more color work over the cloth), mat (its surface class), cells ([across, down]: the grid a check or a pattern needs to show). */
export function addCape(kit, D, color, hemColor, lining, bind, { len: lenK = 1, wide = 1, paint = null, mat = undefined, cells = [7, 9] } = {}) {
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
  kit.sheet(cells[0], cells[1], fn, {
    thick: 0.007, color, inner: lining, bind: bind.cape, paint: paints(gradY(top - len, top, 0.82, 1.0), paint), mat,
  });
  // a trim band along the hem
  kit.sheet(cells[0], 1, (u, v, out) => {
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
export function addPteruges(kit, D, pal, bind, { color, lower = null, edge = null, strips = 16, len = 1, mat = undefined } = {}) {
  const sides = strips * 2;
  const top = D.hipY + 0.035;
  const row = (y1, cTop, cBottom, col, hem) => {
    const r = (c) => [D.depth * 0.5 + c, D.waistW * 0.5 + c * 1.15];
    const [tx, tz] = r(cTop);
    const [bx, bz] = r(cBottom);
    kit.loft([vs(y1, bx, bz), vs(lerp(y1, top, 0.5), (tx + bx) / 2, (tz + bz) / 2), vs(top, tx, tz)], {
      rings: 4, sides, start: null, end: null, color: col, bind: bind.skirt, mat,
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
        if (hem && u < 0.12) recolor(o, hem, 0.85);
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
 * worn over bare skin). side: 1 from the left shoulder to the right hip, -1 the other way. opts: width, paint (more color work
 * over the cloth: a check), cells ([across, along]: the grid it is built on), fringe ({ color, len, n }: tassels hanging from its
 * lower edge).
 */
export function addDrape(kit, D, bind, color, trim, { side = 1, width = 0.2, paint = null, cells = [6, 16], fringe = null } = {}) {
  const fn = (u, v, out) => {
    const th = lerp(-1.3, 1.45, v) * side;
    // (worn from the other shoulder the strip runs the other way round: its across direction turns with it, or its inner face shows)
    const f = lerp(1.04, 0.14, v) + ((side > 0 ? u : 1 - u) - 0.5) * width;
    const r = torsoRing(D, clamp(f, 0.02, 1.07), 0.024 + 0.004 * Math.sin(v * PI * 3 + u * 2.4));
    out[0] = r.dx + r.rx * Math.cos(th);
    out[1] = r.y;
    out[2] = r.rz * Math.sin(th);
  };
  kit.sheet(cells[0], cells[1], fn, {
    thick: 0.008, color, inner: shadeC(color, 0.82), bind: bind.torso,
    paint: (o, x, y, z, u, a) => {
      mul(o, 0.9 + 0.1 * Math.sin(a * PI));
      if (trim && (u < 0.1 || u > 0.9)) dye(o, trim, 0.9);
      if (paint) paint(o, x, y, z, u, a);
    },
  });
  if (fringe) {
    // tassels along the lower edge, from just below the shoulder to the hip
    const low = side > 0 ? 0 : 1;
    const n = fringe.n ?? 14;
    const at = [];
    const q = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      fn(low, lerp(0.22, 1, (i + 0.5) / n), q);
      at.push([q[0], q[1] - 0.006, q[2]]);
    }
    addFringe(kit, bind.torso, at, { len: fringe.len ?? 0.05, color: fringe.color ?? trim ?? color, mat: fringe.mat, r: fringe.r });
  }
}

/**
 * A short cape (chlamys): a collar of the same cloth over both shoulders, the cape itself down the
 * back to the thighs, a clasp at the throat. clasp: the metal of the clasp. opts: paint (more color work over the cloth), len and
 * wide (the cape's length and width), cells (the cape's grid).
 */
export function addChlamys(kit, D, color, hemColor, lining, bind, clasp, { paint = null, len = 0.62, wide = 0.9, cells = [7, 9] } = {}) {
  const K = D.k;
  const sh = D.shoulderY;
  addCape(kit, D, color, hemColor, lining, bind, { len, wide, paint, cells });
  kit.loft([vs(sh + 0.03, 0.068 * K, 0.1 * K, -0.004), vs(sh + 0.006, 0.104 * K, 0.172 * K, -0.011), vs(sh - 0.034, 0.114 * K, 0.212 * K, -0.013)], {
    rings: 5, sides: 16, start: null, end: null, color, bind: bind.torso, paint: paints((o, x, y, z, u) => mul(o, lerp(1.04, 0.86, u)), paint),
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

/**
 * A long skirt to the ankles, hugging the body at the waist (clearance `top`); returns the ring at
 * its hem so a border can go on. A wrap over a bare chest needs an addWaistBelt over its top edge.
 */
export function addLongSkirt(kit, D, bind, color, { flare = 1, pleat = 0.008, top = 0.008 } = {}) {
  const y0 = D.ankleY + 0.05;
  const rx = D.depth * 0.5 + 0.1 * flare;
  const rz = D.waistW * 0.5 + 0.11 * flare;
  const t = torsoRing(D, 0.12, top);
  kit.loft([
    vs(y0, rx, rz),
    vs(y0 + 0.12, D.depth * 0.5 + 0.075 * flare, D.waistW * 0.5 + 0.085 * flare),
    vs(D.hipY - 0.04, D.depth * 0.5 + 0.045, D.waistW * 0.5 + 0.055),
    vs(t.y, t.rx, t.rz, t.dx),
  ], {
    rings: 7, sides: 36, start: null, end: null, color, bind: bind.skirt,
    warp: (p, a, u) => {
      const s = Math.sin(a * 9) * pleat * (1 - u);
      p[0] += Math.cos(a) * s;
      p[2] += Math.sin(a) * s;
    },
    paint: gradY(y0, D.hipY, 0.8, 1),
  });
  return { y0, rx, rz };
}

/** A hem band in a contrasting color round the long skirt that ends at `sk` (what addLongSkirt returns). */
export function addHem(kit, bind, sk, color, h = 0.05) {
  kit.loft([vs(sk.y0 - 0.002, sk.rx + 0.004, sk.rz + 0.004), vs(sk.y0 + h, sk.rx - 0.004, sk.rz - 0.004)],
    { sides: 36, start: null, end: null, color, mat: 'trim', bind: bind.skirt });
}

/** A broad belt over the top edge of a wrap, with a round clasp at the front. */
export function addWaistBelt(kit, D, bind, color, clasp, mat = 'trim') {
  const a = torsoRing(D, -0.04, 0.05);
  const b = torsoRing(D, 0.2, 0.034);
  kit.loft([vs(a.y, a.rx, a.rz, a.dx), vs(b.y, b.rx, b.rz, b.dx)], { sides: 18, rings: 3, start: null, end: null, color, mat, bind: bind.torso });
  const m = torsoRing(D, 0.08, 0.044);
  const r = 0.026 * D.k;
  kit.loft([ps(m.dx + m.rx - 0.004, m.y, 0, r, r), ps(m.dx + m.rx + 0.01, m.y, 0, r * 0.85, r * 0.85)],
    { ref: [0, 1, 0], sides: 12, start: 'round', end: 'round', capDepth: 0.006, color: clasp, mat: 'gold', bind: bind.torso });
}

// ---------------------------------------------------------------------------
// Egyptian dress: the wrapped kilt with its stiff apron, a banded corselet, the broad collar
// ---------------------------------------------------------------------------

/**
 * The shendyt: a linen kilt wrapped about the hips and falling to the knee, pleated, with a stiff
 * apron standing out at the front. opts: color, trim (the hem), apron (the apron's color, default
 * the kilt's), len (scale of the length), flare (how far the skirt opens).
 */
export function addShendyt(kit, D, bind, { color, trim = null, apron = null, len = 1, flare = 1 } = {}) {
  const yb = D.hipY - 0.2 * len;
  const t = torsoRing(D, 0.12, 0.014);
  const bx = D.depth * 0.5 + 0.07 * flare;
  const bz = D.waistW * 0.5 + 0.085 * flare;
  const st = [
    vs(yb, bx, bz),
    vs(lerp(yb, D.hipY - 0.04, 0.5), D.depth * 0.5 + 0.052 * flare, D.waistW * 0.5 + 0.062 * flare),
    vs(D.hipY - 0.04, D.depth * 0.5 + 0.038, D.waistW * 0.5 + 0.048),
    vs(t.y, t.rx, t.rz, t.dx),
  ];
  kit.loft(st, {
    rings: 6, sides: 36, start: null, end: null, color, bind: bind.skirt,
    warp: (p, a, u) => {
      const s = Math.sin(a * 9) * 0.006 * (1 - u);
      p[0] += Math.cos(a) * s;
      p[2] += Math.sin(a) * s;
    },
    paint: gradY(yb, D.hipY, 0.84, 1),
  });
  if (trim) kit.loft([vs(yb - 0.002, bx + 0.003, bz + 0.003), vs(yb + 0.022, bx - 0.001, bz - 0.001)], { sides: 36, start: null, end: null, color: trim, mat: 'gold', bind: bind.skirt });
  // the apron: a panel narrow at the belt, wide at the hem, standing out from the front of the kilt
  const ap = apron || color;
  const top = D.hipY + 0.02;
  const hem = yb - 0.012 * len;
  const front = (y) => frontAt(st, y);
  kit.sheet(5, 8, (u, v, out) => {
    const y = lerp(top, hem, v);
    const w = lerp(0.042, 0.1, v ** 0.8) * D.k;
    const z = (u - 0.5) * 2 * w;
    // it follows the kilt to the knee, then leans out into a stiff point, its sides curving back
    out[0] = front(y) + 0.012 + 0.05 * v ** 2.2 * D.k - 0.016 * (z / (w || 1)) ** 2 * v;
    out[1] = y;
    out[2] = z;
  }, {
    thick: 0.008, color: ap, inner: shadeC(ap, 0.82), bind: bind.skirt,
    paint: (o, x, y, z, u, a) => {
      mul(o, 0.92 + 0.08 * Math.cos(u * PI * 8));
      if (trim && a > 0.9) dye(o, trim, 0.95);
    },
  });
}

/**
 * A corselet of overlapping bands of leather or scale from the waist to the chest, each band lipping
 * out over the one below, with a collar edge of trim. opts: color, trim, bands.
 */
export function addCorselet(kit, D, pal, bind, { color, trim, bands = 6 } = {}) {
  const y = (f) => D.hipY + (D.shoulderY - D.hipY) * f;
  const g = 0.024;
  const rows = [];
  for (let i = 0; i < bands; i++) {
    const f0 = 0.14 + (i / bands) * 0.8;
    const f1 = 0.14 + ((i + 1.45) / bands) * 0.8;
    const r0 = torsoRing(D, f0, g + 0.012);
    const r1 = torsoRing(D, Math.min(f1, 1.0), g);
    rows.push([r0, r1]);
  }
  rows.forEach(([r0, r1], i) => {
    kit.loft([vs(r0.y, r0.rx + 0.012, r0.rz + 0.012, r0.dx), vs(r0.y + (r1.y - r0.y) * 0.3, r0.rx + 0.002, r0.rz + 0.002, r0.dx), vs(r1.y, r1.rx, r1.rz, r1.dx)],
      { rings: 3, sides: 22, start: null, end: null, color: shadeC(color, 0.94 + (i % 2) * 0.1), bind: bind.torso, paint: gradY(r0.y, r1.y, 0.86, 1.04) });
  });
  // a rolled edge of trim at the top and the hem
  const hem = torsoRing(D, 0.12, g + 0.02);
  kit.loft([vs(hem.y - 0.008, hem.rx + 0.006, hem.rz + 0.006, hem.dx), vs(hem.y + 0.018, hem.rx + 0.002, hem.rz + 0.002, hem.dx)], { sides: 22, start: null, end: null, color: trim, mat: 'gold', bind: bind.torso });
  void y;
}

/**
 * The broad collar (usekh) that lies over the shoulders and chest: rows of beads, each a strip of
 * its own color (`rows`, from the neck out; a team color among them if wanted), its lower edge
 * fringed like a fringe of drops. grow: how far it stands off the body (over armor).
 */
export function addUsekh(kit, D, bind, { rows, reach = 0.78, grow = 0 } = {}) {
  const n = rows.length;
  const ring = (g) => {
    const r = torsoRing(D, lerp(1.07, reach, g), 0.026 + 0.004 * g + grow);
    return vs(r.y, r.rx, r.rz, r.dx);
  };
  const yTop = ring(0).c[1];
  const yFront = ring(1).c[1];
  rows.forEach((color, i) => {
    const g0 = i / n;
    const g1 = (i + 1) / n;
    kit.loft([ring(g0), ring(g1)], {
      sides: 32, start: null, end: null, color, mat: 'lacquer', bind: bind.torso,
      warp: (p, a, u) => {
        // a shoulder collar: full depth at the front, shallow at the sides and back
        const aa = Math.abs(wrap(a));
        const depth = 1 - smoothstep(0.35, 1.7, aa) * 0.78;
        const g = lerp(g0, g1, u);
        p[1] = lerp(yTop, yFront, g * depth);
        // the fringe: drops along the outer edge
        if (i === n - 1) p[1] -= 0.014 * smoothstep(0, 1, u) * (0.5 + 0.5 * Math.cos(a * 8)) * (aa < 2.4 ? 1 : 0);
      },
    });
  });
}

/**
 * Strips of bandage laid round a part: `n` bands from height y0 to y1 over the stations `st`
 * (a limb's or the head's), each slanting the other way from the last, a shade of its own, the
 * body showing dark in the gaps between. opts: g (stand-off), fill (how much of each pitch a
 * band covers), shades (how far the bands differ), seed.
 */
export function addWraps(kit, bind, st, y0, y1, n, color, { g = 0.009, fill = 0.9, sides = 14, shades = 0.16, seed = 1, slant = 0.3 } = {}) {
  const pitch = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const a = ringAt(st, y0 + i * pitch, g);
    const b = ringAt(st, y0 + (i + fill) * pitch, g);
    const tilt = (i % 2 ? 1 : -1) * slant * pitch;
    a.c[2] += tilt;
    b.c[2] -= tilt;
    kit.loft([a, b], { sides, start: null, end: null, color: shadeC(color, 1 - shades * 0.5 + shades * hash(i, seed, 5)), mat: 'cloth', bind });
  }
}

// ---------------------------------------------------------------------------
// Hindu dress: the dhoti, the quilted coat with its steel plates, the garland
// ---------------------------------------------------------------------------

/**
 * The dhoti: a long cloth wrapped about the hips and drawn up between the legs, hanging in loose
 * folds to the shin, a border at its hem, a fan of pleats at the front and a roll at the waist.
 * opts: color, border (the hem's color), fan (the pleats' color, default the cloth's), sash (a
 * knotted end hanging at the hip), len (1 = the mid-shin, 0.55 = just below the knee, 0.2 = a
 * loincloth), loose (how baggy it hangs), mark (a paint over the cloth: stripes of a hide).
 */
export function addDhoti(kit, D, bind, { color, border = null, fan = null, sash = null, len = 1, loose = 1, mark = null } = {}) {
  const knee = D.hipY - D.thigh;
  const yb = knee + 0.02 - (knee - D.ankleY) * 0.55 * len;
  const yh = D.hipY - 0.08;
  const t = torsoRing(D, 0.12, 0.012);
  const lz = D.hipZ + D.legR; // the outer edge of the thigh
  const st = [
    vs(yb, 0.074 + 0.02 * loose, lz + 0.016 + 0.018 * loose),
    vs(lerp(yb, yh, 0.5), 0.088 + 0.022 * loose, lz + 0.026 + 0.026 * loose),
    vs(yh, D.depth * 0.5 + 0.036 + 0.02 * loose, lz + 0.03 + 0.028 * loose),
    vs(D.hipY + 0.01, D.depth * 0.5 + 0.034, D.waistW * 0.5 + 0.05),
    vs(t.y, t.rx, t.rz, t.dx),
  ];
  // soft folds, slanting a little, deeper toward the hem; an uneven hem
  const fold = (amp, hemK = 1) => (p, a, u) => {
    const s = Math.sin(a * 7 + u * 2.4) * amp * loose * (1 - u * 0.7);
    p[0] += Math.cos(a) * s;
    p[2] += Math.sin(a) * s;
    p[1] += 0.012 * hemK * Math.sin(a * 3 + 0.5) * (1 - u) ** 3;
  };
  kit.loft(st, {
    rings: 6, sides: 26, start: null, end: null, color, mat: 'cloth', bind: bind.skirt,
    warp: fold(0.009),
    paint: paints(gradY(yb, D.hipY, 0.8, 1), mark),
  });
  if (border) {
    const a = st[0];
    const b = st[1];
    const k = 0.05 / (b.c[1] - a.c[1]);
    kit.loft([vs(a.c[1] - 0.004, a.rx + 0.004, a.rz + 0.004), vs(a.c[1] + 0.05, lerp(a.rx, b.rx, k) + 0.003, lerp(a.rz, b.rz, k) + 0.003)], {
      sides: 26, start: null, end: null, color: border, mat: 'cloth', bind: bind.skirt, warp: fold(0.009 * 0.9),
    });
  }
  // the roll of cloth at the waist
  kit.loft([vs(t.y - 0.014, t.rx + 0.012, t.rz + 0.012, t.dx), vs(t.y + 0.02, t.rx + 0.014, t.rz + 0.014, t.dx), vs(t.y + 0.046, t.rx + 0.004, t.rz + 0.004, t.dx)],
    { rings: 3, sides: 20, start: null, end: null, color: shade(color, 0.92), mat: 'cloth', bind: bind.skirt });
  // the pleats drawn up between the legs and tucked in at the front: a fan hanging from the waist
  const pc = fan || color;
  const top = t.y + 0.012;
  const hem = yb + 0.004;
  kit.sheet(7, 6, (u, v, out) => {
    const y = lerp(top, hem, v);
    const w = lerp(0.032, 0.088, v ** 0.8);
    const z = (u - 0.5) * 2 * w;
    out[0] = frontAt(st, y) + 0.016 + 0.03 * v ** 2 * loose - 0.012 * (z / (w || 1)) ** 2 * v + 0.005 * Math.cos(u * 7 * PI) * v;
    out[1] = y;
    out[2] = z;
  }, {
    thick: 0.008, color: pc, inner: shade(pc, 0.82), bind: bind.skirt,
    paint: (o, x, y, z, u, a) => {
      mul(o, 0.9 + 0.1 * Math.cos(u * PI * 7));
      if (mark) mark(o, x, y, z, u, a);
      if (border && a > 0.9) recolor(o, border, 0.95);
    },
  });
  // the end of a sash knotted at the right hip
  if (sash) {
    for (const [dir, drop] of [[1, 0.3], [0.5, 0.22]]) {
      kit.sheet(2, 4, (u, v, out) => {
        const th = 0.62 + (u - 0.5) * 0.11 + dir * 0.06 * v;
        const r = torsoRing(D, lerp(0.14, -0.14, v * drop / 0.3), 0.034 + 0.01 * v);
        out[0] = r.dx + r.rx * Math.cos(th);
        out[1] = r.y;
        out[2] = r.rz * Math.sin(th) * (1 + 0.12 * v);
      }, { thick: 0.006, color: sash, inner: shade(sash, 0.8), bind: bind.skirt, paint: (o, x, y, z, u, a) => mul(o, 0.94 + 0.08 * Math.sin(a * 5 + u * 3)) });
    }
  }
}

/**
 * The char-aina: a quilted sleeveless coat from the belt to the collar with a round steel plate on
 * the breast, one on the back and one at each side (the "four mirrors"), rimmed in gold, a hem of trim.
 * opts: color (the coat; a team color works), plate (steel), trim.
 */
export function addCharAina(kit, D, pal, bind, { color, plate, trim }) {
  const g = 0.02;
  const y = (f) => D.hipY + (D.shoulderY - D.hipY) * f;
  kit.loft(torsoStations(D, g, 0.04), { rings: 8, start: null, end: 'round', capDepth: 0.01, color, mat: 'cloth', bind: bind.torso, paint: gradY(y(0.04), y(1.0), 0.86, 1.02) });
  const hem = torsoRing(D, 0.06, g + 0.004);
  kit.loft([vs(hem.y - 0.01, hem.rx + 0.004, hem.rz + 0.004, hem.dx), vs(hem.y + 0.024, hem.rx, hem.rz, hem.dx)], { sides: 22, start: null, end: null, color: trim, mat: 'gold', bind: bind.torso });
  const collar = torsoRing(D, 1.03, g + 0.006);
  kit.loft([vs(collar.y - 0.012, collar.rx, collar.rz, collar.dx), vs(collar.y + 0.012, collar.rx - 0.002, collar.rz - 0.002, collar.dx)], { sides: 20, start: null, end: null, color: trim, mat: 'gold', bind: bind.torso });
  addMirrorDisc(kit, D, bind, 0.62, 0, 0.074 * D.k, { plate, trim, g });
  addMirrorDisc(kit, D, bind, 0.62, PI, 0.074 * D.k, { plate, trim, g });
  addMirrorDisc(kit, D, bind, 0.5, PI / 2, 0.062 * D.k, { plate, trim, g });
  addMirrorDisc(kit, D, bind, 0.5, -PI / 2, 0.062 * D.k, { plate, trim, g });
}

/**
 * A round mirror on the torso: a shallow dome of polished metal in a rim of trim with a boss at its centre, at height
 * fraction f and angle th about the torso (0 the front, PI the back, +-PI/2 the sides), r its radius. opts: plate (the disc),
 * trim (rim and boss), g (the clearance of the surface it sits on).
 */
export function addMirrorDisc(kit, D, bind, f, th, r, { plate, trim, g = 0.02, sides = 14, caps = 2 }) {
  const ring = torsoRing(D, f, g + 0.003);
  const snap = (v) => (Math.abs(v) < 1e-9 ? 0 : v);
  const ax = snap(Math.cos(th));
  const az = snap(Math.sin(th));
  const c = [ring.dx + ax * ring.rx, ring.y, az * ring.rz];
  // the outward normal of the ellipse there
  const nl = Math.hypot(ax / ring.rx, az / ring.rz);
  const nx = ax / ring.rx / nl;
  const nz = az / ring.rz / nl;
  const at = (d, k) => ps(c[0] + nx * d, c[1], c[2] + nz * d, r * k, r * k);
  const o = { ref: [0, 1, 0], sides };
  kit.loft([at(-0.004, 1), at(0.008, 0.98), at(0.017, 0.62)], { ...o, rings: 3, start: null, end: 'round', capRings: caps, capDepth: 0.012, color: plate, mat: 'metal', bind: bind.torso, paint: gradY(c[1] - r, c[1] + r, 0.86, 1.1) });
  kit.loft([at(0.003, 1.05), at(0.011, 1.05)], { ...o, start: null, end: null, color: trim, mat: 'gold', bind: bind.torso });
  kit.loft([at(0.015, 0.2), at(0.026, 0.14)], { ...o, sides: 7, start: null, end: 'round', capRings: 1, capDepth: 0.006, color: trim, mat: 'gold', bind: bind.torso });
}

/**
 * A garland or a string of beads from the neck down the chest, a rope of round blooms or beads,
 * `colors` cycling along it. opts: low (how far down it hangs, as a height fraction of the torso),
 * r (thickness), beads (how many), mat.
 */
export function addGarland(kit, D, bind, { colors, low = 0.4, r = 0.016, beads = 14, mat = 'cloth' } = {}) {
  const n = 22;
  const path = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const th = lerp(-1.32, 1.32, t);
    const ring = torsoRing(D, lerp(1.04, low, Math.sin(t * PI) ** 0.9), 0.026 + r);
    path.push([ring.dx + ring.rx * Math.cos(th), ring.y, ring.rz * Math.sin(th)]);
  }
  const centre = (u) => {
    const f = clamp(u, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const k = f - i;
    return [lerp(path[i][0], path[i + 1][0], k), lerp(path[i][1], path[i + 1][1], k), lerp(path[i][2], path[i + 1][2], k)];
  };
  kit.loft(path.map((q) => ps(q[0], q[1], q[2], r, r)), {
    ref: [0, 1, 0], rings: n, sides: 6, start: 'round', end: 'round', capRings: 2, capDepth: r, color: colors[0], mat, bind: bind.torso,
    // a bead or a bloom every so often along it
    warp: (p, a, u) => {
      const c = centre(u);
      const s = 1 + 0.38 * (0.5 + 0.5 * Math.cos(u * beads * TAU));
      p[0] = c[0] + (p[0] - c[0]) * s;
      p[1] = c[1] + (p[1] - c[1]) * s;
      p[2] = c[2] + (p[2] - c[2]) * s;
    },
    paint: (o, x, y, z, u) => dye(o, colors[Math.floor(u * beads + 0.5) % colors.length], 1),
  });
}

// ---------------------------------------------------------------------------
// Japanese dress: the crossed collar, the sash, the hakama, the lacquered armor and its plates
// ---------------------------------------------------------------------------

/**
 * The crossed collar of a kimono, one lapel over the other: the outer one runs from the left of the neck
 * down across the chest to the right hip, the inner one from the right of the neck to where the outer covers
 * it. opts: color (the outer collar), inner (the other's color, default the same), width.
 */
export function addKosodeCollar(kit, D, bind, { color, inner = null, width = 0.05 } = {}) {
  const strip = (th0, th1, f0, f1, g, col) => kit.sheet(2, 12, (u, v, out) => {
    const f = clamp(lerp(f0, f1, v) + (u - 0.5) * width, 0.02, 1.08);
    const r = torsoRing(D, f, g + 0.003 * Math.sin(v * PI));
    const th = lerp(th0, th1, v ** 0.9);
    out[0] = r.dx + r.rx * Math.cos(th);
    out[1] = r.y;
    out[2] = r.rz * Math.sin(th);
  }, { thick: 0.006, color: col, inner: shade(col, 0.8), bind: bind.torso });
  strip(0.42, 0.0, 1.07, 0.7, 0.02, inner || color);
  strip(-0.42, 0.62, 1.07, 0.14, 0.026, color);
}

/**
 * A sash (obi) round the waist, wide, with a cord over it and a flat drum knot at the back. opts: color, cord
 * (the cord's color; null for none), knot ('back' | null), wide (scale of the width).
 */
export function addObi(kit, D, bind, { color, cord = null, knot = 'back', wide = 1, mat = 'cloth' } = {}) {
  const a = torsoRing(D, -0.02, 0.044);
  const b = torsoRing(D, 0.19 * wide, 0.038);
  kit.loft([vs(a.y, a.rx, a.rz, a.dx), vs((a.y + b.y) / 2, (a.rx + b.rx) / 2 + 0.004, (a.rz + b.rz) / 2 + 0.004, (a.dx + b.dx) / 2), vs(b.y, b.rx, b.rz, b.dx)],
    { sides: 22, rings: 3, start: null, end: null, color, mat, bind: bind.torso, paint: (o, x, y, z, u) => mul(o, 0.94 + 0.08 * Math.sin(u * PI)) });
  if (cord) {
    const c = torsoRing(D, 0.12, 0.05);
    kit.loft([vs(c.y - 0.007, c.rx, c.rz, c.dx), vs(c.y + 0.007, c.rx, c.rz, c.dx)], { sides: 22, start: null, end: null, color: cord, mat: 'trim', bind: bind.torso });
  }
  if (knot === 'back') {
    // the drum knot: a flat cushion standing off the small of the back, a band across it
    const r = torsoRing(D, 0.09, 0.04);
    const M = new THREE.Matrix4().compose(
      new THREE.Vector3(r.dx - r.rx - 0.01, r.y + 0.01, 0),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, PI / 2, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    kit.placed(M, (k) => {
      k.slab([[-0.072, -0.04], [-0.076, 0.03], [-0.04, 0.056], [0.0, 0.058], [0.04, 0.056], [0.076, 0.03], [0.072, -0.04], [0.03, -0.054], [-0.03, -0.054]],
        { depth: 0.04, bevel: 0.014, color, mat, bind: bind.torso, paint: gradY(-0.05, 0.06, 0.86, 1.06) });
    });
    if (cord) kit.loft([ps(r.dx - r.rx - 0.034, r.y + 0.01, -0.082, 0.007), ps(r.dx - r.rx - 0.034, r.y + 0.01, 0.082, 0.007)],
      { ref: [0, 1, 0], sides: 6, start: 'round', end: 'round', capDepth: 0.006, color: cord, mat: 'trim', bind: bind.torso });
  }
}

/**
 * The hakama: wide pleated trousers from the waist to the ankle, flaring a little toward the hem, with a
 * stiff plate at the small of the back and a cord tied across the front. opts: color, trim (the cord and
 * the hem), len (1 reaches the ankle), flare, pleat, top (where the waist sits, as a torso height fraction).
 */
export function addHakama(kit, D, bind, { color, trim = null, len = 1, flare = 1, pleat = 0.007, top = 0.3, mat = 'cloth' } = {}) {
  const y0 = D.ankleY + 0.045 + (1 - len) * 0.26;
  const knee = D.hipY - D.thigh;
  const t = torsoRing(D, top, 0.03);
  const st = [
    vs(y0, D.depth * 0.5 + 0.1 * flare, D.waistW * 0.5 + 0.112 * flare),
    vs(lerp(y0, knee, 0.55) + 0.02, D.depth * 0.5 + 0.088 * flare, D.waistW * 0.5 + 0.1 * flare),
    vs(knee + 0.03, D.depth * 0.5 + 0.074 * flare, D.waistW * 0.5 + 0.088 * flare),
    vs(D.hipY - 0.03, D.depth * 0.5 + 0.058, D.waistW * 0.5 + 0.07),
    vs(t.y, t.rx, t.rz, t.dx),
  ].filter((q, i, a) => i === 0 || q.c[1] > a[i - 1].c[1] + 0.004);
  kit.loft(st, {
    rings: 7, sides: 40, start: null, end: null, color, mat, bind: bind.skirt,
    warp: (p, a, u) => {
      const sw = Math.sin(a * 10) * pleat * (1 - u * 0.7);
      p[0] += Math.cos(a) * sw;
      p[2] += Math.sin(a) * sw;
    },
    paint: (o, x, y, z, u, a) => mul(o, 0.86 + 0.16 * Math.abs(Math.cos(a * 10 * 0.5 * 2)) + 0.1 * u),
  });
  if (trim) {
    // a band of the trim color at the hem, folding as the cloth does
    const a = st[0];
    const b = st[1];
    const k = 0.04 / (b.c[1] - a.c[1]);
    kit.loft([vs(a.c[1] - 0.003, a.rx + 0.004, a.rz + 0.004, a.c[0]), vs(a.c[1] + 0.04, lerp(a.rx, b.rx, k) + 0.003, lerp(a.rz, b.rz, k) + 0.003, lerp(a.c[0], b.c[0], k))], {
      sides: 40, start: null, end: null, color: trim, mat: 'trim', bind: bind.skirt,
      warp: (p, ang) => {
        const sw = Math.sin(ang * 10) * pleat * 0.95;
        p[0] += Math.cos(ang) * sw;
        p[2] += Math.sin(ang) * sw;
      },
    });
  }
  // the back plate (koshi-ita): a stiff panel curving up the small of the back
  kit.sheet(3, 4, (u, v, out) => {
    const f = lerp(top - 0.06, top + 0.17, v);
    const r = torsoRing(D, f, 0.04 + 0.006 * Math.sin(v * PI));
    const th = PI + (u - 0.5) * 0.7;
    out[0] = r.dx + r.rx * Math.cos(th) * 1.0;
    out[1] = r.y;
    out[2] = r.rz * Math.sin(th);
  }, { thick: 0.006, color: shade(color, 1.1), inner: shade(color, 0.8), bind: bind.torso });
  // the cord across the front: a band round the waist with its bow hanging at the front
  if (trim) {
    kit.loft([vs(t.y - 0.012, t.rx + 0.006, t.rz + 0.006, t.dx), vs(t.y + 0.014, t.rx + 0.004, t.rz + 0.004, t.dx)], { sides: 22, start: null, end: null, color: trim, mat: 'trim', bind: bind.skirt });
  }
}

/**
 * The cuirass of a warrior: rows of lacquered plates, each lipping over the one below, the lower edge of every row
 * laced in a color, over the chest and belly to a rolled hem; two laced straps over the shoulders. opts: plate,
 * lace, trim, rows.
 */
export function addDoMaru(kit, D, pal, bind, { plate, lace, trim, rows = 7 } = {}) {
  const g = 0.024;
  const f0 = 0.08;
  const f1 = 0.97;
  for (let i = 0; i < rows; i++) {
    const fa = lerp(f0, f1, i / rows);
    const fb = Math.min(lerp(f0, f1, (i + 1.45) / rows), 1.03);
    const ra = torsoRing(D, fa, g + 0.012);
    const rb = torsoRing(D, fb, g);
    kit.loft([vs(ra.y, ra.rx + 0.012, ra.rz + 0.012, ra.dx), vs(ra.y + (rb.y - ra.y) * 0.3, ra.rx + 0.002, ra.rz + 0.002, ra.dx), vs(rb.y, rb.rx, rb.rz, rb.dx)], {
      rings: 3, sides: 22, start: null, end: null, color: i % 2 ? shade(plate, 0.9) : plate, mat: 'lacquer', bind: bind.torso,
      paint: (o, x, y, z, u, a) => {
        if (u < 0.2) recolor(o, lace, 0.95);
        else mul(o, 0.92 + 0.12 * Math.abs(Math.cos(a * TAU * 5)));
      },
    });
  }
  // a rolled hem of gold below the lowest row, and the collar
  const hem = torsoRing(D, f0 - 0.02, g + 0.02);
  kit.loft([vs(hem.y - 0.008, hem.rx + 0.006, hem.rz + 0.006, hem.dx), vs(hem.y + 0.014, hem.rx + 0.002, hem.rz + 0.002, hem.dx)], { sides: 22, start: null, end: null, color: trim, mat: 'gold', bind: bind.torso });
  // the shoulder straps, laced, from the breast over each shoulder to the back
  for (const side of [1, -1]) {
    kit.sheet(2, 8, (u, v, out) => {
      const th = lerp(0.62, PI - 0.7, v) * side;
      const f = 0.96 + 0.14 * Math.sin(v * PI);
      const rr = torsoRing(D, clamp(f - (v > 0.5 ? (v - 0.5) * 0.2 : 0) * 0 , 0.2, 1.1), g + 0.006);
      out[0] = rr.dx + rr.rx * Math.cos(th) * (0.9 + 0.12 * (1 - v));
      out[1] = lerp(D.shoulderY - 0.07, D.shoulderY + 0.028, Math.sin(v * PI)) + (v > 0.5 ? -(v - 0.5) * 0.14 : -(0.5 - v) * 0.1);
      out[2] = side * (D.shoulderZ * 0.33 + (u - 0.5) * 0.05);
    }, { thick: 0.006, color: lace, inner: shade(lace, 0.8), bind: bind.torso });
  }
}

/**
 * A pair of shoulder plates (sode): broad lacquered panels hanging from the shoulders over the upper arms,
 * four rows of plate each stepping a little outward from the one above, the lower edge of every row laced
 * in a color, a gold edge along the foot. opts: plate, lace, trim, size.
 */
export function addSode(kit, D, pal, bind, { plate, lace, trim, size = 1 } = {}) {
  const K = D.k * size;
  const sh = D.shoulderY - 0.012;
  const rows = 4;
  const rowH = 0.056 * K;
  const w = 0.16 * K;
  for (const side of [1, -1]) {
    const upper = side > 0 ? B.upperR : B.upperL;
    const bd = (x, y, z, S) => { S.add(upper, 0.7); S.add(B.chest, 0.3); };
    // a sheet's outer face looks along u x v (x forward, y down): toward -z, so the right side runs u backward
    const face = (u) => (side > 0 ? 1 - u : u);
    for (let r = 0; r < rows; r++) {
      const y0 = sh + 0.012 - r * rowH * 0.9;
      const fn = (u, v, out) => {
        const uu = face(u);
        const arch = 1 - (2 * uu - 1) ** 2;
        out[0] = (uu - 0.5) * w * (1 + 0.05 * r) - 0.004;
        out[1] = y0 - v * rowH + 0.014 * arch * (1 - v) * (r === 0 ? 1 : 0.25);
        out[2] = side * (D.shoulderZ + 0.05 * K + 0.012 * K * r + 0.012 * arch * (r === 0 ? 1 : 0.4) + 0.006 * v);
      };
      kit.sheet(6, 1, fn, { thick: 0.007, color: r % 2 ? shade(plate, 0.9) : plate, mat: 'lacquer', inner: shade(plate, 0.7), bind: bd });
      // the lacing along the lower edge of the row
      kit.sheet(6, 1, (u, v, out) => {
        fn(u, 0.7 + 0.3 * v, out);
        out[2] += side * 0.0022;
      }, { thick: 0.0085, color: lace, mat: 'cloth', inner: lace, bind: bd });
    }
    // a gold edge along the foot of the lowest row
    kit.sheet(6, 1, (u, v, out) => {
      const uu = face(u);
      const r = rows - 1;
      out[0] = (uu - 0.5) * w * (1 + 0.05 * r) - 0.004;
      out[1] = sh + 0.012 - (r * 0.9 + 1) * rowH - 0.004 * v;
      out[2] = side * (D.shoulderZ + 0.05 * K + 0.012 * K * r + 0.006 + 0.0032);
    }, { thick: 0.01, color: trim, mat: 'gold', inner: trim, bind: bd });
  }
}

/** Armored sleeves (kote): a lacquered plate along the outside of each forearm in cloth, bound at the wrist and elbow. */
export function addKote(kit, D, pal, bind, { plate, trim } = {}) {
  const w = D.shoulderY - 0.02 - D.upper - D.fore;
  for (const side of [1, -1]) {
    const bd = bind.arm[side];
    const z = side * D.shoulderZ;
    kit.loft([vs(w + 0.012, D.armR * 0.66 + 0.012, D.armR * 0.64 + 0.012, 0, z), vs(w + D.fore * 0.5, D.armR * 0.84 + 0.012, D.armR * 0.82 + 0.012, 0.002, z), vs(w + D.fore * 0.94, D.armR * 0.94 + 0.014, D.armR * 0.92 + 0.014, 0, z)],
      { sides: 12, rings: 3, start: null, end: null, color: plate, mat: 'lacquer', bind: bd, paint: gradY(w, w + D.fore, 0.86, 1.08) });
    for (const y of [w + 0.012, w + D.fore * 0.94]) {
      kit.loft([vs(y - 0.008, D.armR * 0.7 + 0.016, D.armR * 0.7 + 0.016, 0, z), vs(y + 0.008, D.armR * 0.72 + 0.016, D.armR * 0.72 + 0.016, 0, z)], { sides: 12, start: null, end: null, color: trim, mat: 'gold', bind: bd });
    }
  }
}

// ---------------------------------------------------------------------------
// Leg garments of the Japanese and the Chinese
// ---------------------------------------------------------------------------

/** Trousers from the ankle to the hip, snug to the leg. */
export function addTrousers(kit, D, bind, color) {
  for (const side of [1, -1]) {
    kit.loft(legFrom(D, side, 0.011, D.ankleY - 0.012), { rings: 7, start: null, end: null, color, mat: 'cloth', bind: bind.leg[side], paint: gradY(0.2, D.hipY, 0.85, 1) });
  }
}

/** Leg wraps: a snug gaiter from the ankle to below the knee, ridged where the cloth is wound, tied at the top. */
export function addLegWraps(kit, D, bind, color, steps = 14) {
  const knee = D.hipY - D.thigh;
  const y0 = D.ankleY + 0.012;
  const y1 = knee - 0.04;
  for (const side of [1, -1]) {
    const st = legStations(D, side, 0.011);
    const rings = [];
    for (let i = 0; i <= steps; i++) rings.push(ringAt(st, lerp(y0, y1, i / steps), 0.006));
    kit.loft(rings, { sides: 12, start: null, end: null, color, mat: 'cloth', bind: bind.leg[side], paint: (o, x, y) => mul(o, 0.84 + 0.18 * Math.abs(Math.cos((y - y0) * 130))) });
    kit.loft([ringAt(st, y1 - 0.012, 0.01), ringAt(st, y1 + 0.004, 0.01)], { sides: 12, start: null, end: null, color: shade(color, 0.7), mat: 'cloth', bind: bind.leg[side] });
  }
}

/** The leg below a long hem: skin from under the ankle to `top`. */
export function addAnkles(kit, D, bind, skin, skinPaint, top) {
  const r = D.legR;
  for (const side of [1, -1]) {
    const st = legStations(D, side).filter((q) => q.c[1] <= top);
    kit.loft([vs(D.ankleY - 0.03, r * 0.62, r * 0.58, 0, side * D.hipZ), ...st], { rings: 4, start: null, end: null, color: skin, bind: bind.leg[side], paint: skinPaint });
  }
}

// ---------------------------------------------------------------------------
// Chinese dress: wide sleeves, the sash, mirror armor and its shoulder beasts, the wrapped skirt
// ---------------------------------------------------------------------------

/**
 * The crossed collar of the Chinese jacket (jiaoling youren): a standing collar at the neck and the lapel closing in a
 * diagonal from the left of the throat across the breast to the right armpit, a row of frog knots along it. opts: color (the
 * collar and the lapel's band), knot (the knots' color; default the band's), width (of the lapel's band), knots (how many), lapel
 * (false: the collar alone, where a cuirass covers the breast).
 */
export function addJiaoling(kit, D, bind, { color, knot = null, width = 0.034, knots = 3, lapel = true } = {}) {
  const at = (t, g) => {
    const f = lerp(1.06, 0.72, t ** 1.1);
    const th = lerp(-0.3, 1.18, t);
    const r = torsoRing(D, f, g);
    return [r.dx + r.rx * Math.cos(th), r.y, r.rz * Math.sin(th)];
  };
  const a = torsoRing(D, 1.03, 0.02);
  const b = torsoRing(D, 1.1, 0.012);
  kit.loft([vs(a.y, a.rx, a.rz, a.dx), vs(b.y, b.rx * 0.93, b.rz * 0.93, b.dx)], { sides: 20, start: null, end: null, color, mat: 'trim', bind: bind.torso });
  if (!lapel) return;
  kit.sheet(2, 12, (u, v, out) => {
    const p = at(v, 0.02 + 0.004 * Math.sin(v * PI));
    out[0] = p[0];
    out[1] = p[1] + (u - 0.5) * width;
    out[2] = p[2];
  }, { thick: 0.006, color, inner: shade(color, 0.8), bind: bind.torso });
  for (let i = 0; i < knots; i++) {
    const p = at(0.3 + (0.55 * i) / Math.max(1, knots - 1), 0.03);
    kit.loft([ps(p[0] - 0.002, p[1], p[2], 0.011), ps(p[0] + 0.002, p[1], p[2], 0.011)], { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: 0.011, color: knot || color, mat: 'trim', bind: bind.torso });
  }
}

/**
 * Wide sleeves from the shoulder to the wrist, belling out toward the hem, which hangs back a little (a robe's, a
 * priest's, a goddess's). opts: color, trim (a band at the hem), wide (scale of how far they bell), mat.
 */
export function addWideSleeves(kit, D, bind, { color, trim = null, wide = 1, mat = 'cloth' }) {
  const g = 0.012;
  const r = D.armR;
  const sh = D.shoulderY - 0.02;
  const e = sh - D.upper;
  const w = e - D.fore;
  for (const side of [1, -1]) {
    const z = side * D.shoulderZ;
    const st = [
      vs(w, r * (1.5 + 1.1 * wide) + g, r * (1.3 + 0.8 * wide) + g, -0.022 * wide, z),
      vs(w + 0.035, r * (1.3 + 0.8 * wide) + g, r * (1.2 + 0.6 * wide) + g, -0.014 * wide, z),
      vs(e - 0.01, r * (1.2 + 0.3 * wide) + g, r * (1.15 + 0.3 * wide) + g, -0.004 * wide, z),
      vs(sh - 0.04, r * 1.2 + g + 0.005, r * 1.18 + g + 0.005, 0, z),
      vs(sh + 0.008, r * 1.18 + g, r * 1.16 + g, 0, z),
    ];
    kit.loft(st, { rings: 7, sides: 16, start: null, end: 'round', capDepth: 0.014, color, mat, bind: bind.arm[side], paint: gradY(w, sh, 0.86, 1.02) });
    if (trim) {
      const a = st[0];
      kit.loft([vs(w - 0.006, a.rx + 0.004, a.rz + 0.004, a.c[0], z), vs(w + 0.026, st[1].rx + 0.003, st[1].rz + 0.003, st[1].c[0], z)], { sides: 16, start: null, end: null, color: trim, mat: 'trim', bind: bind.arm[side] });
    }
  }
}

/** A fur cuff (a ring of shaggy hair) round a limb, from station `a` (the top) to `b`. */
export function addFurCuff(kit, a, b, color, bd, seed) {
  kit.loft([a, b], {
    sides: 14, start: null, end: null, color, mat: 'fur', bind: bd,
    warp: (p, ang, u) => { const n = hash(Math.round(ang * 14), seed, 3); p[1] -= 0.008 * (1 - u) * (0.5 + n); },
    paint: (o, x, y, z, u) => mul(o, 0.82 + 0.26 * u),
  });
}

/**
 * A sash round the waist, rolled at its edges, knotted at the left hip with two ends hanging down the thigh, one
 * longer than the other. opts: color, trim (a thin edge), tails (false: none), wide (scale of the band's width).
 */
export function addSash(kit, D, bind, { color, trim = null, tails = true, wide = 1 } = {}) {
  const a = torsoRing(D, -0.02, 0.042);
  const b = torsoRing(D, 0.17 * wide, 0.036);
  kit.loft([vs(a.y, a.rx, a.rz, a.dx), vs((a.y + b.y) / 2, (a.rx + b.rx) / 2 + 0.004, (a.rz + b.rz) / 2 + 0.004, (a.dx + b.dx) / 2), vs(b.y, b.rx, b.rz, b.dx)],
    { sides: 22, rings: 3, start: null, end: null, color, mat: 'cloth', bind: bind.torso, paint: (o, x, y, z, u) => mul(o, 0.92 + 0.12 * Math.sin(u * PI)) });
  if (trim) {
    for (const f of [-0.02, 0.17 * wide - 0.012]) {
      const r = torsoRing(D, f + 0.006, 0.046);
      kit.loft([vs(r.y - 0.006, r.rx, r.rz, r.dx), vs(r.y + 0.006, r.rx, r.rz, r.dx)], { sides: 22, start: null, end: null, color: trim, mat: 'trim', bind: bind.torso });
    }
  }
  if (!tails) return;
  const k = torsoRing(D, 0.07, 0.046);
  const th = -0.62;
  const x0 = k.dx + k.rx * Math.cos(th);
  const z0 = k.rz * Math.sin(th);
  kit.loft([ps(x0 + 0.004, k.y, z0, 0.02, 0.026), ps(x0 + 0.012, k.y - 0.004, z0, 0.012, 0.016)], { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capDepth: 0.01, color: shadeC(color, 0.88), mat: 'cloth', bind: bind.skirt });
  [[0.3, -0.05, 0.13], [0.22, 0.045, 0.1]].forEach(([drop, dz, w], i) => {
    kit.sheet(2, 5, (u, v, out) => {
      out[0] = x0 + 0.024 + 0.026 * v + 0.01 * Math.sin(v * 4 + i * 2);
      out[1] = k.y - 0.012 - drop * v;
      out[2] = z0 + dz * v - (0.5 - u) * w * 0.28 * (1 + 0.5 * v);
    }, { thick: 0.006, color, inner: shade(color, 0.8), bind: bind.skirt });
  });
}

/**
 * The cuirass of a Chinese soldier (mingguang, "bright light"): a lacquered breastplate with its lames, two round mirrors
 * of polished metal over the breast and two on the back, a belt with a gold boss at the buckle. opts: plate (the lacquer),
 * trim (gold), mirror (the discs; default the unit's metal), belt (the belt's color; default leather), discs (false: no mirrors).
 */
export function addMingguang(kit, D, pal, bind, { plate, trim, mirror = null, belt = null, discs = true } = {}) {
  const K = D.k;
  const g = 0.026;
  addCuirass(kit, D, pal, bind, plate, trim);
  if (discs) {
    for (const th of [0.52, -0.52, PI - 0.52, PI + 0.52]) addMirrorDisc(kit, D, bind, 0.66, th, 0.064 * K, { plate: mirror || pal.accentMetal, trim, g: 0.023, sides: 10, caps: 1 });
  }
  // the belt over the foot of the plate, and the boss at its buckle
  const a = torsoRing(D, 0.15, g + 0.016);
  const b = torsoRing(D, 0.27, g + 0.014);
  kit.loft([vs(a.y, a.rx, a.rz, a.dx), vs((a.y + b.y) / 2, (a.rx + b.rx) / 2 + 0.003, (a.rz + b.rz) / 2 + 0.003, (a.dx + b.dx) / 2), vs(b.y, b.rx, b.rz, b.dx)],
    { sides: 24, rings: 3, start: null, end: null, color: belt || pal.leather, mat: 'leather', bind: bind.torso });
  const m = torsoRing(D, 0.21, g + 0.02);
  const r = 0.034 * K;
  kit.loft([ps(m.dx + m.rx - 0.004, m.y, 0, r, r), ps(m.dx + m.rx + 0.01, m.y, 0, r * 0.92, r * 0.92), ps(m.dx + m.rx + 0.022, m.y, 0, r * 0.45, r * 0.45)],
    { ref: [0, 1, 0], rings: 3, sides: 12, start: null, end: 'round', capRings: 1, capDepth: 0.006, color: trim, mat: 'gold', bind: bind.torso });
}

/**
 * Shoulder guards in the Chinese manner (tunjian, "swallowing the shoulder"): the pauldrons with a flared lip at their foot
 * and on the crown a beast's head of gold, its ears pricked, looking forward. opts: plate, trim, face (the head's color,
 * default the trim).
 */
export function addTunjian(kit, D, pal, bind, { plate, trim, face = null } = {}) {
  addPauldrons(kit, D, pal, bind, plate, trim, 0, { sides: 10, rings: 4 });
  const sh = D.shoulderY - 0.02;
  const K = D.k;
  const head = face || trim;
  for (const side of [1, -1]) {
    const upper = side > 0 ? B.upperR : B.upperL;
    const bd = (x, y, z, S) => { S.add(upper, 0.65); S.add(B.chest, 0.35); };
    const z = side * (D.shoulderZ + 0.004);
    kit.loft([vs(sh - 0.05, 0.088 * K, 0.084 * K, 0, z), vs(sh - 0.062, 0.108 * K, 0.104 * K, 0, z)], { sides: 16, start: null, end: null, color: shadeC(plate, 0.82), mat: 'metal', bind: bd });
    // the beast's head on the crown: a rounded skull, a short muzzle toward the front, two ears
    const y = sh + 0.052 * K;
    kit.loft([ps(-0.012 * K, y, z, 0.026 * K, 0.026 * K), ps(0.014 * K, y + 0.002, z, 0.03 * K, 0.028 * K), ps(0.04 * K, y - 0.004, z + side * 0.004, 0.018 * K, 0.02 * K)],
      { ref: [0, 1, 0], rings: 4, sides: 10, start: 'round', end: 'round', capRings: 2, capDepth: 0.014 * K, color: head, mat: 'gold', bind: bd });
    for (const e of [1, -1]) {
      kit.loft([ps(-0.006 * K, y + 0.018 * K, z + e * 0.02 * K, 0.009 * K), ps(-0.01 * K, y + 0.042 * K, z + e * 0.026 * K, 0.0025 * K)],
        { ref: [1, 0, 0], sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.004, color: head, mat: 'gold', bind: bd });
    }
  }
}

/**
 * A skirt wrapped about the hips and falling to above the knee, bare of any apron: a hide, a kilt of leaves. opts: color,
 * len (1 reaches the knee), flare (how far it stands out), teeth (a ragged hem of this many points round; 0 an even hem), depth
 * (how deep the points hang), mark (a paint over the cloth: a hide's stripes), mat.
 */
export function addWrapSkirt(kit, D, bind, { color, len = 0.8, flare = 1, teeth = 0, depth = 0.04, mark = null, mat = 'cloth' } = {}) {
  const yb = D.hipY - D.thigh * len + 0.03;
  const t = torsoRing(D, 0.12, 0.016);
  const st = [
    vs(yb, D.depth * 0.5 + 0.082 * flare, D.waistW * 0.5 + 0.1 * flare),
    vs(lerp(yb, D.hipY - 0.04, 0.5), D.depth * 0.5 + 0.06 * flare, D.waistW * 0.5 + 0.076 * flare),
    vs(D.hipY - 0.04, D.depth * 0.5 + 0.042, D.waistW * 0.5 + 0.052),
    vs(t.y, t.rx, t.rz, t.dx),
  ];
  kit.loft(st, {
    rings: 6, sides: teeth ? Math.max(24, teeth * 4) : 28, start: null, end: null, color, mat, bind: bind.skirt,
    warp: (p, a, u) => {
      const s = Math.sin(a * 7 + u * 2) * 0.008 * (1 - u * 0.6);
      p[0] += Math.cos(a) * s;
      p[2] += Math.sin(a) * s;
      if (teeth && u < 0.02) p[1] -= depth * Math.abs(((a / TAU) * teeth) % 1 - 0.5) * 2;
    },
    paint: paints(gradY(yb - depth, D.hipY, 0.8, 1), mark),
  });
}

// ---------------------------------------------------------------------------
// Aztec dress: the loincloth, the quilted cotton armor, the cords bound about a leg
// ---------------------------------------------------------------------------

/**
 * The maxtlatl: a loincloth of cotton tied about the waist (a belt with a knot at the hip), its two ends falling as a long apron
 * in front and a shorter one behind, each bordered along its sides and hem in a stepped fret. opts: color, border (default the
 * cloth's own, a shade darker), band (the belt's color), len (scale of the fall), knot (false: no knot at the hip), mark (a paint
 * laid over the cloth before the border: a jaguar's rosettes), mat (the cloth's surface class).
 */
export function addMaxtlatl(kit, D, bind, { color, border = null, band = null, len = 1, knot = true, mark = null, mat = undefined } = {}) {
  const K = D.k;
  const t0 = torsoRing(D, 0.0, 0.028);
  const t1 = torsoRing(D, 0.15, 0.022);
  const bc = band || color;
  kit.loft([vs(t0.y, t0.rx, t0.rz, t0.dx), vs((t0.y + t1.y) / 2, (t0.rx + t1.rx) / 2 + 0.003, (t0.rz + t1.rz) / 2 + 0.003, (t0.dx + t1.dx) / 2), vs(t1.y, t1.rx, t1.rz, t1.dx)],
    { sides: 20, rings: 3, start: null, end: null, color: bc, mat: 'cloth', bind: bind.torso });
  const bd = border || shade(color, 0.7);
  const top = t0.y + 0.01;
  const bw = 0.014 * K; // the border along the sides
  const hemAt = 0.8; // where the border at the foot starts, as a fraction of the fall
  for (const dir of [1, -1]) {
    const drop = (dir > 0 ? 0.3 : 0.21) * len;
    const x0 = dir > 0 ? t0.dx + t0.rx + 0.008 : t0.dx - t0.rx - 0.008;
    const x1 = dir * 0.1;
    // the apron's surface: c across it (before the direction), v down its fall
    const surf = (c, v, out) => {
      out[0] = lerp(x0, x1, Math.min(1, v * 1.6)) + dir * 0.012 * v;
      out[1] = top - v * drop;
      out[2] = c * dir;
    };
    const half = (v) => lerp(0.064, 0.086, v) * K;
    // the cloth, then the border as strips of their own (a color that changes on a vertex blurs): up each side, and across the foot
    kit.sheet(2, 5, (u, v, out) => surf((u - 0.5) * 2 * (half(v * hemAt) - bw), v * hemAt, out), {
      thick: 0.006, color, inner: shade(color, 0.82), bind: bind.skirt, mat,
      paint: (o, x, y, z, u, a) => {
        mul(o, 0.94 + 0.08 * Math.sin(u * PI * 3));
        if (mark) mark(o, x, y, z, u, a);
      },
    });
    for (const side of [1, -1]) {
      kit.sheet(1, 5, (u, v, out) => {
        const w = half(v * hemAt);
        surf(lerp(side > 0 ? w - bw : -w, side > 0 ? w : -(w - bw), u), v * hemAt, out);
      }, { thick: 0.006, color: bd, inner: shade(bd, 0.82), bind: bind.skirt });
    }
    kit.sheet(6, 1, (u, v, out) => surf((u - 0.5) * 2 * half(lerp(hemAt, 1, v)), lerp(hemAt, 1, v), out), {
      thick: 0.006, color: bd, inner: shade(bd, 0.82), bind: bind.skirt,
      // squares of the cloth stepping along it
      paint: (o, x, y, z, u) => { if (Math.round(u * 6) % 2) mul(o, 0.74); },
    });
  }
  if (!knot) return;
  // the knot at the left hip, its two ends hanging a little way
  const k = torsoRing(D, 0.07, 0.036);
  const th = 0.72;
  const x = k.dx + k.rx * Math.cos(th);
  const z = k.rz * Math.sin(th);
  kit.loft([ps(x, k.y, z, 0.022, 0.026), ps(x + 0.01, k.y - 0.003, z + 0.004, 0.015, 0.018)], { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capDepth: 0.01, color: shade(bc, 0.9), mat: 'cloth', bind: bind.skirt });
  for (const [dz, drop] of [[-0.012, 0.15], [0.018, 0.11]]) {
    kit.sheet(2, 4, (u, v, out) => {
      out[0] = x + 0.016 + 0.012 * v;
      out[1] = k.y - 0.01 - drop * v;
      out[2] = z + dz * v + (u - 0.5) * 0.034;
    }, { thick: 0.005, color, inner: shade(color, 0.8), bind: bind.skirt });
  }
}

/**
 * The ichcahuipilli: a sleeveless tunic of quilted cotton from the throat to the thigh (the quilting a diamond grid of stitching),
 * a band of trim at the neck and a hem of the same trim with a scalloped fringe below it. opts: color, trim, hem (how far it
 * hangs below the hip), cell (the quilting's size), mat (the cotton's surface class).
 */
export function addIchcahuipilli(kit, D, bind, { color, trim, hem = 0.12, cell = 0.05, mat = 'cloth' } = {}) {
  addTunic(kit, D, color, bind, hem, { mat, paint: quilt(cell, 0.66) });
  const a = torsoRing(D, 1.03, 0.022);
  const b = torsoRing(D, 1.1, 0.014);
  kit.loft([vs(a.y, a.rx, a.rz, a.dx), vs(b.y, b.rx * 0.93, b.rz * 0.93, b.dx)], { sides: 20, start: null, end: null, color: trim, mat: 'trim', bind: bind.torso });
  const y0 = D.hipY - hem;
  kit.loft([vs(y0 - 0.006, D.depth * 0.62 + 0.026, D.waistW * 0.66 + 0.026), vs(y0 + 0.026, D.depth * 0.62 + 0.02, D.waistW * 0.66 + 0.02)], {
    sides: 28, start: null, end: null, color: trim, mat: 'trim', bind: bind.torso,
    warp: (p, ang, u) => { if (u < 0.02) p[1] -= 0.014 * Math.abs(((ang / TAU) * 14) % 1 - 0.5) * 2; },
  });
}

/**
 * Cords bound round the leg: a band below the knee (`knee`) and an anklet (`ankle`), each a color or a team color.
 */
export function addLegBands(kit, D, bind, { knee = null, ankle = null, mat = 'cloth' } = {}) {
  const k = D.hipY - D.thigh;
  for (const side of [1, -1]) {
    const st = legStations(D, side, 0.011);
    if (knee) kit.loft([ringAt(st, k - 0.052, 0.008), ringAt(st, k - 0.016, 0.008)], { sides: 12, start: null, end: null, color: knee, mat, bind: bind.leg[side] });
    if (ankle) kit.loft([ringAt(st, D.ankleY + 0.034, 0.008), ringAt(st, D.ankleY + 0.07, 0.008)], { sides: 12, start: null, end: null, color: ankle, mat, bind: bind.leg[side] });
  }
}

/** A band round the top of each upper arm (`upper`) and a cuff at each wrist (`wrist`): colors or team colors; `mat` their surface class. */
export function addArmBands(kit, D, bind, { upper = null, wrist = null, mat = 'gold' } = {}) {
  const w = D.shoulderY - 0.02 - D.upper - D.fore;
  for (const side of [1, -1]) {
    const bd = bind.arm[side];
    const z = side * D.shoulderZ;
    if (upper) {
      const y = D.shoulderY - 0.02 - D.upper * 0.42;
      kit.loft([vs(y - 0.016, D.armR * 1.06 + 0.012, D.armR * 1.03 + 0.012, 0, z), vs(y + 0.016, D.armR * 1.07 + 0.012, D.armR * 1.04 + 0.012, 0, z)],
        { sides: 12, start: null, end: null, color: upper, mat, bind: bd });
    }
    if (wrist) {
      kit.loft([vs(w + 0.012, D.armR * 0.66 + 0.009, D.armR * 0.64 + 0.009, 0, z), vs(w + D.fore * 0.5, D.armR * 0.86 + 0.009, D.armR * 0.84 + 0.009, 0.002, z)],
        { sides: 12, rings: 3, start: null, end: null, color: wrist, mat, bind: bd });
    }
  }
}

// ---------------------------------------------------------------------------
// Celtic dress: the torc, the penannular brooch, the mail shirt, the check of the trews
// ---------------------------------------------------------------------------

/** A little ball (a terminal, a stud, a stone) at `p`: a short loft with round ends. */
function bead(kit, p, r, opts) {
  kit.loft([ps(p[0] - r * 0.1, p[1], p[2], r), ps(p[0] + r * 0.1, p[1], p[2], r)], { ref: [0, 1, 0], sides: 6, start: 'round', end: 'round', capRings: 2, capDepth: r, ...opts });
}

/**
 * A torc, the Celts' neck ring: a thick rope of gold in an open ring about the base of the neck, resting a little lower at the
 * throat, a round knob at each end of the gap. opts: color, big (scale of the rope), mat, f (height on the torso, as for torsoRing),
 * gap (the opening at the throat, in radians).
 */
export function addTorc(kit, D, bind, { color, big = 1, mat = 'gold', f = 1.07, gap = 0.3 } = {}) {
  const K = D.k;
  const r = 0.0105 * big * K;
  const ring = torsoRing(D, f, 0.012 * K + r);
  const n = 18;
  const at = (th) => [ring.dx + ring.rx * Math.cos(th), ring.y - 0.014 * K * (0.5 + 0.5 * Math.cos(th)), ring.rz * Math.sin(th)];
  const path = [];
  for (let i = 0; i <= n; i++) path.push(at(lerp(gap, TAU - gap, i / n)));
  kit.loft(path.map((q) => ps(q[0], q[1], q[2], r, r)), {
    ref: [0, 1, 0], rings: n, sides: 6, start: null, end: null, color, mat, bind: bind.torso,
    paint: (o, x, y, z, u, a) => mul(o, 0.82 + 0.3 * Math.abs(Math.sin(u * 54 + a * TAU))), // the twist of the rope
  });
  for (const th of [gap, TAU - gap]) bead(kit, at(th), r * 1.75, { color, mat, bind: bind.torso });
}

/**
 * A penannular brooch, the Celts' cloak pin: an open ring of metal with a knob at each end of the gap and a long pin
 * across it, set on the breast at angle `th` about the torso (the face is 0, a positive angle toward +z), the gap upward.
 * opts: color, gem (a stone set at the foot of the ring), size, f (height on the torso), th, mat, at ({ c, n }: its center and the
 * way it faces, where a surface of its own carries it).
 */
export function addBrooch(kit, D, bind, { color, gem = null, size = 1, f = 0.95, th = -0.95, mat = 'gold', at: spot = null } = {}) {
  const K = D.k;
  const R = 0.03 * size * K;
  const tr = 0.0058 * size * K;
  let n;
  let c;
  if (spot) {
    // set on a surface of its own (a cloak's collar): its center and the way it faces
    const l = Math.hypot(...spot.n);
    n = spot.n.map((q) => q / l);
    c = [...spot.c];
  } else {
    const g = torsoRing(D, f, 0.006);
    const nx = Math.cos(th) / g.rx;
    const nz = Math.sin(th) / g.rz;
    const nl = Math.hypot(nx, nz) || 1;
    n = [nx / nl, 0, nz / nl];
    c = [g.dx + g.rx * Math.cos(th) + n[0] * (tr + 0.004), g.y, g.rz * Math.sin(th) + n[2] * (tr + 0.004)];
  }
  const sl = Math.hypot(n[2], n[0]) || 1;
  const side = [n[2] / sl, 0, -n[0] / sl];
  const at = (a, r = R, lift = 0) => [c[0] + side[0] * Math.sin(a) * r + n[0] * lift, c[1] + Math.cos(a) * r, c[2] + side[2] * Math.sin(a) * r + n[2] * lift];
  const gap = 0.42;
  const m = 14;
  const path = [];
  for (let i = 0; i <= m; i++) path.push(at(lerp(gap, TAU - gap, i / m)));
  kit.loft(path.map((q) => ps(q[0], q[1], q[2], tr, tr)), { ref: n, rings: m, sides: 6, start: null, end: null, color, mat, bind: bind.torso });
  for (const a of [gap, TAU - gap]) bead(kit, at(a), tr * 1.9, { color, mat, bind: bind.torso });
  // the pin: from the foot of the ring across it and out over the gap
  const a0 = at(PI, R * 0.78, tr * 1.6);
  const a1 = at(0, R * 1.5, tr * 1.6);
  kit.loft([ps(a0[0], a0[1], a0[2], 0.0034 * size * K), ps(a1[0], a1[1], a1[2], 0.0022 * size * K)], { ref: side, sides: 5, start: 'round', end: 'round', capDepth: 0.003, color, mat, bind: bind.torso });
  if (gem) bead(kit, at(PI, R, 0), tr * 2.1, { color: gem, mat: 'gem', glow: 0.35, bind: bind.torso });
}

/**
 * A mail shirt (lorica hamata): rings of iron from the neck to the thigh, flaring at the hem, short sleeves to the elbow,
 * its rows flecked so the light catches them unevenly. opts: color (the iron), sleeves (false: none), hem (how far below the hip it hangs),
 * trim (a band of leather or bronze at the hem and the sleeve ends), mat.
 */
export function addMailShirt(kit, D, bind, { color, sleeves = true, hem = 0.17, trim = null, mat = 'metal' } = {}) {
  const span = D.shoulderY - D.hipY;
  const n = 20;
  const below = hem / (span * 1.06 + hem);
  const st = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const f = lerp(-hem / span, 1.05, t);
    const flare = t < below ? 0.05 * ((below - t) / below) ** 1.3 : 0;
    const r = torsoRing(D, f, 0.017 + flare);
    st.push(vs(r.y, r.rx, r.rz, r.dx));
  }
  kit.loft(st, { rings: n + 1, sides: 18, start: null, end: null, color, mat, bind: bind.skirt, paint: paints(gradY(D.hipY - hem, D.shoulderY, 0.8, 1.06), mailSheen(0.03, 0.14)) });
  if (trim) {
    const r0 = torsoRing(D, -hem / span, 0.017 + 0.05);
    const r1 = torsoRing(D, -hem / span + 0.07, 0.017 + 0.045);
    kit.loft([vs(r0.y - 0.002, r0.rx, r0.rz, r0.dx), vs(r1.y, r1.rx, r1.rz, r1.dx)], { sides: 18, start: null, end: null, color: trim, mat: 'leather', bind: bind.skirt });
  }
  if (!sleeves) return;
  for (const side of [1, -1]) {
    const st2 = armStations(D, side, 0.015, 'elbow');
    kit.loft(st2, { rings: 6, sides: 12, start: null, end: 'round', capRings: 2, capDepth: 0.016, color, mat, bind: bind.arm[side], paint: paints(gradY(D.shoulderY - 0.02 - D.upper, D.shoulderY, 0.82, 1.04), mailSheen(0.03, 0.14)) });
    if (trim) {
      const e = st2[0];
      kit.loft([vs(e.c[1] - 0.004, e.rx + 0.004, e.rz + 0.004, e.c[0], e.c[2]), vs(e.c[1] + 0.022, e.rx + 0.006, e.rz + 0.006, e.c[0], e.c[2])], { sides: 12, start: null, end: null, color: trim, mat: 'leather', bind: bind.arm[side] });
    }
  }
}

/**
 * Trews (bracae), the Celts' snug trousers, woven in a check: from the ankle (or `from`) to the hip. opts: color, hue (the warp
 * bands' color: see tartan), cell (the check's repeat), k (how much the weft darkens it), mat.
 */
export function addTrews(kit, D, bind, { color, hue = null, cell = 0.1, k = 0.72, from = null, mat = 'cloth' } = {}) {
  for (const side of [1, -1]) {
    kit.loft(legFrom(D, side, 0.011, from ?? D.ankleY - 0.012), {
      rings: 13, sides: 12, start: null, end: null, color, mat, bind: bind.leg[side],
      paint: paints(gradY(0.2, D.hipY, 0.88, 1), tartan({ cell, hue, k, cx: 0, cz: side * D.hipZ, r: D.legR })),
    });
  }
}

// ---------------------------------------------------------------------------
// Mesopotamian dress: the fleece skirt in tiers (kaunakes), tassels, the coat of scale
// ---------------------------------------------------------------------------

/** A row of rounded tufts or scales round a ring: 0 where two meet, 1 in the middle of each; `fr` is the way round, in tufts. */
const tuftShape = (fr) => Math.sin(PI * (fr - Math.floor(fr))) ** 0.8;

/**
 * Tassels: a short strand hanging from each point of `at` ([x, y, z]), tapering to its tip, `len` long, weighted by the
 * bind function `bd`. opts: len, color, r (the strand's thickness at its root), mat.
 */
export function addFringe(kit, bd, at, { len = 0.05, color, r = 0.0062, mat = 'cloth' } = {}) {
  for (const p of at) {
    kit.loft([ps(p[0], p[1], p[2], r, r), ps(p[0], p[1] - len, p[2], r * 0.35, r * 0.35)], { ref: [1, 0, 0], sides: 3, start: null, end: null, color, mat, bind: bd });
  }
}

/**
 * The kaunakes, the Sumerians' skirt of fleece: tiers of woolly flounces from the waist down, each hanging over the one below
 * and ending in a row of rounded tufts, shaded darker where it lies under the tier above. opts: color (and color2 for every
 * second tier), tiers, len (1 reaches the ankle, 0.5 the knee), flare (how far it stands out), tufts (in the top row, one more
 * a tier lower), depth (how far a tuft hangs), mat. Returns the lowest row ({ y0, rx, rz }) so a border can go on.
 */
export function addKaunakes(kit, D, bind, { color, color2 = null, tiers = 3, len = 1, flare = 1, tufts = 10, depth = 0.034, mat = 'fur' } = {}) {
  const waist = torsoRing(D, 0.12, 0.012);
  const yTop = waist.y;
  const yEnd = lerp(D.hipY - 0.05, D.ankleY + 0.06, clamp(len, 0, 1.15));
  const reach = D.hipY - 0.04 - (D.ankleY + 0.05);
  // the half widths of the skirt at height y: hugging the hips, opening toward the ankles
  const wide = (y) => {
    const t = clamp((D.hipY - 0.04 - y) / reach);
    return [D.depth * 0.5 + 0.045 + 0.08 * flare * t, D.waistW * 0.5 + 0.055 + 0.09 * flare * t];
  };
  for (let i = 0; i < tiers; i++) {
    const yb = lerp(yTop, yEnd, (i + 1) / tiers);
    const ya = i === 0 ? yTop : lerp(yTop, yEnd, i / tiers) + 0.03;
    const ym = (yb + ya) / 2;
    const lip = 0.016 + 0.004 * i;
    const [bx, bz] = wide(yb);
    const [mx, mz] = wide(ym);
    const [tx, tz] = wide(ya);
    const nT = tufts + i;
    const st = [
      vs(yb, bx + lip, bz + lip),
      vs(ym, mx + 0.012, mz + 0.012),
      i === 0 ? vs(yTop, waist.rx + 0.014, waist.rz + 0.014, waist.dx) : vs(ya, tx + 0.002, tz + 0.002),
    ];
    const c = i % 2 && color2 ? color2 : i % 2 ? shade(color, 0.92) : color;
    kit.loft(st, {
      rings: 3, sides: nT * 4, start: null, end: null, color: c, mat, bind: bind.skirt,
      warp: (p, a, u) => {
        const fr = (a / TAU) * nT + 0.5;
        const sh = tuftShape(fr);
        const cs = Math.cos(a);
        const sn = Math.sin(a);
        if (u < 0.01) {
          // the foot: tufts hanging, each its own length
          p[1] -= depth * (0.74 + 0.5 * hash(Math.floor(fr), i, 3)) * sh;
          p[0] += cs * 0.01 * sh;
          p[2] += sn * 0.01 * sh;
        } else if (u < 0.9) {
          // a ridge up from every tuft
          p[0] += cs * 0.0075 * sh;
          p[2] += sn * 0.0075 * sh;
        }
      },
      paint: (o, x, y, z, u, a) => {
        const sh = tuftShape(a * nT + 0.5);
        mul(o, (0.7 + 0.3 * (1 - u)) * (0.84 + 0.16 * sh));
      },
    });
  }
  const [rx, rz] = wide(yEnd);
  return { y0: yEnd, rx, rz };
}

/**
 * A cloak of fish skin down the back, the apkallu's: the fish's body from the shoulders, fattest below the shoulder blades,
 * narrowing to the tail between the knees and spreading to a forked tail fin at the hem. The body is rows of overlapping
 * scales, each strip cut into points along its lower edge. opts: color (the scales), belly (their underside), fin (the tail; a team
 * color works), len (scale of the length, 1 reaches the ankles), rows.
 */
export function addFishCloak(kit, D, bind, { color, belly, fin, len: lenK = 1, rows = 7 } = {}) {
  const top = D.shoulderY + 0.005;
  const len = (top - (D.ankleY + 0.04)) * lenK;
  const w0 = D.chestW * 0.74;
  const wMax = D.chestW * 1.28;
  const stalk = 0.085;
  const finW = 0.32;
  // the fish's breadth, from the shoulders (v 0) to the end of the tail (v 1)
  const breadth = (v) => lerp(lerp(w0, wMax, smoothstep(0, 0.22, v)), stalk, smoothstep(0.22, 0.76, v)) + (finW - stalk) * smoothstep(0.8, 1, v);
  const px = (v) => -D.chestD * 0.52 - 0.01 - 0.08 * v - 0.12 * v * v;
  const py = (v) => top - v * len;
  const vEnd = 0.8;
  const dv = vEnd / rows;
  for (let i = 0; i < rows; i++) {
    const va = i * dv;
    const vb = va + dv * 1.7;
    const nu = 2 * Math.max(1, Math.round(breadth(vb) / 0.07));
    kit.sheet(nu, 1, (u, j, out) => {
      const v = lerp(va, vb, j);
      out[0] = px(v) - 0.0015 * (rows - i);
      out[1] = py(v) - (j ? 0.018 * (Math.round(u * nu) % 2) : 0);
      out[2] = (0.5 - u) * breadth(v);
    }, {
      thick: 0.005, color: i % 2 ? shade(color, 0.93) : color, inner: belly, bind: bind.cape, mat: 'painted',
      paint: (o, x, y, z, u, j) => mul(o, (0.78 + 0.26 * j) * lerp(0.88, 1.04, (y - py(1)) / len)),
    });
  }
  // the dorsal fin: a ridge of spines down the middle of the back
  kit.sheet(1, 14, (u, v, out) => {
    const t = v * vEnd;
    out[0] = px(t) - 0.0015 * rows - 0.004 - 0.022 * (Math.round(v * 14) % 2);
    out[1] = py(t);
    out[2] = (0.5 - u) * 0.026;
  }, { thick: 0.004, color: fin, inner: shade(fin, 0.85), bind: bind.cape, mat: 'cloth' });
  // the tail fin: a fan with a V cut in its end
  const vt = vEnd - dv * 0.3;
  kit.sheet(8, 4, (u, j, out) => {
    const v = lerp(vt, 1, j);
    out[0] = px(v) - 0.002;
    out[1] = py(v) + 0.08 * smoothstep(0.88, 1, v) * (1 - Math.abs(2 * u - 1));
    out[2] = (0.5 - u) * breadth(v);
  }, { thick: 0.005, color: fin, inner: shade(fin, 0.85), bind: bind.cape, mat: 'cloth', paint: (o, x, y, z, u) => mul(o, 0.86 + 0.14 * Math.cos(u * 8 * PI)) });
}

/**
 * A coat of scale: rows of small overlapping scales from the shoulders to below the hip, each row a flounce whose foot is cut
 * into rounded scales and which lies over the row below, the rows alternating in shade. opts: color, rows, hem (how far
 * below the hip it hangs), scales (round the body, in a row), mat, trim (a rolled edge at the hem).
 */
export function addScaleCoat(kit, D, bind, { color, trim = null, rows = 6, hem = 0.1, scales = 12, mat = 'metal' } = {}) {
  const span = D.shoulderY - D.hipY;
  const f0 = -hem / span;
  const g = 0.018;
  const flare = (f) => 0.05 * clamp(-f / (-f0 || 1)) ** 1.2;
  for (let i = 0; i < rows; i++) {
    const fa = lerp(f0, 1.0, i / rows);
    const fb = Math.min(lerp(f0, 1.0, (i + 1.6) / rows), 1.07);
    const ra = torsoRing(D, fa, g + 0.016 + flare(fa));
    const rb = torsoRing(D, fb, g + flare(fb));
    kit.loft([vs(ra.y, ra.rx, ra.rz, ra.dx), vs(rb.y, rb.rx, rb.rz, rb.dx)], {
      rings: 2, sides: scales * 3, start: null, end: null, color: i % 2 ? shade(color, 0.9) : color, mat, bind: bind.skirt,
      warp: (p, a, u) => {
        if (u > 0.01) return;
        const sh = tuftShape((a / TAU) * scales + 0.5);
        p[1] -= 0.02 * sh;
        p[0] += Math.cos(a) * 0.006 * sh;
        p[2] += Math.sin(a) * 0.006 * sh;
      },
      paint: (o, x, y, z, u, a) => {
        const sh = tuftShape(a * scales + 0.5);
        mul(o, (0.82 + 0.2 * (1 - u)) * (0.9 + 0.16 * sh));
      },
    });
  }
  if (trim) {
    const r0 = torsoRing(D, f0, g + 0.022 + flare(f0));
    kit.loft([vs(r0.y - 0.022, r0.rx + 0.004, r0.rz + 0.004, r0.dx), vs(r0.y + 0.008, r0.rx, r0.rz, r0.dx)], { sides: 24, start: null, end: null, color: trim, mat: 'leather', bind: bind.skirt });
  }
}
