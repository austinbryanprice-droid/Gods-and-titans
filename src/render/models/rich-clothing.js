// Garments for the rich humanoids, each a smooth layer lofted over the body's own stations
// (rich-body.js) and weighted to the same bones, so cloth follows the limb under it: tunics,
// belts, cuirasses, pauldrons, mantles and capes. The pantheon outfits (rich-outfits.js) choose
// and color them.
import { shadeC } from './unit-geo.js';
import { vs, ps, B, smoothstep } from './rich-kit.js';
import { torsoStations } from './rich-body.js';
import { clamp, lerp, hash, mul, gradY, paints } from './rich-paint.js';

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

export function addBelt(kit, D, pal, bind, color = pal.leather, buckle = pal.accentMetal) {
  const y = (f) => D.hipY + (D.shoulderY - D.hipY) * f;
  const g = 0.02;
  kit.loft([vs(y(0.03), D.depth * 0.52 + g, D.waistW * 0.56 + g), vs(y(0.13), D.depth * 0.5 + g, D.waistW * 0.52 + g)],
    { sides: 14, rings: 3, start: null, end: null, color, mat: 'leather', bind: bind.torso });
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

export function addCape(kit, D, color, hemColor, lining, bind) {
  const top = D.shoulderY + 0.005;
  const len = (D.shoulderY - 0.05) - 0.12;
  const w0 = D.chestW * 0.78;
  const w1 = D.chestW * 1.28;
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
