// The heads of the upright beasts that are not a monkey's or a crow's (rich-heads.js dispatches to them): the lion of the
// storm demon and the hyena of the were-hyena, both built here as one carnivore's head from a table of numbers (a broad skull,
// a short deep muzzle with a dark nose and pale whisker pads, a lower jaw, the line of the lips, fangs, a heavy brow, round ears),
// and the gaunt iron-toothed bat of the Sasabonsam. A head is built where the human head would be: its middle at
// (D.headX, D.headCY), `D.hs` the head scale; every number below is in head scales, X(x) and Y(y) measured from that middle.
import { shadeC, mixC, withMat } from './unit-geo.js';
import { vs, ps } from './rich-kit.js';
import { clamp, tint } from './rich-paint.js';

const INK = withMat('#16120f', 'gloss');
const IVORY = withMat('#efe8d4', 'bone');
const MOUTH = withMat('#3a1618', 'skin');

/**
 * The tables of the two carnivores. skull: [y, rx, rz, dx] stations from the chin to the crown; muzzle: [x, y, ry, rz] stations
 * from the brow to the nose; jaw: the same for the lower jaw; nose: [x, y, ry, rz] of its pad; eye: [x, y, z, size]; ear: [y, z, rise,
 * size, lean (out)]; brow: [height, lowering of its ends]; fang: [x, z, length]; pads: the whisker pads [x, y, z, size].
 */
const LION = {
  skull: [[-0.105, 0.055, 0.075, 0.04], [-0.08, 0.085, 0.11, 0.025], [-0.045, 0.108, 0.135, 0.008], [-0.005, 0.116, 0.145, -0.002], [0.04, 0.114, 0.14, -0.006], [0.078, 0.098, 0.118, -0.01], [0.105, 0.066, 0.08, -0.012], [0.117, 0.03, 0.035, -0.012]],
  muzzle: [[0.06, -0.022, 0.056, 0.085], [0.115, -0.034, 0.058, 0.088], [0.16, -0.045, 0.052, 0.078], [0.186, -0.05, 0.044, 0.062]],
  jaw: [[0.05, -0.09, 0.034, 0.07], [0.12, -0.096, 0.03, 0.058], [0.168, -0.09, 0.022, 0.04]],
  nose: [0.178, -0.012, 0.025, 0.042],
  eye: [0.099, 0.026, 0.05, 1],
  ear: [0.088, 0.098, 0.034, 1, 0.1],
  brow: [0.05, 0.022],
  fang: [0.15, 0.032, 0.03],
  pads: [[0.12, -0.056, 0.034, 0.034]],
  mouthY: -0.07,
};

const HYENA = {
  skull: [[-0.105, 0.052, 0.07, 0.04], [-0.08, 0.08, 0.1, 0.025], [-0.045, 0.1, 0.118, 0.008], [-0.005, 0.108, 0.126, -0.002], [0.04, 0.102, 0.12, -0.004], [0.078, 0.086, 0.098, -0.008], [0.105, 0.058, 0.066, -0.01], [0.116, 0.028, 0.032, -0.01]],
  muzzle: [[0.05, -0.012, 0.058, 0.07], [0.115, -0.024, 0.06, 0.074], [0.175, -0.034, 0.056, 0.07], [0.228, -0.04, 0.05, 0.06]],
  jaw: [[0.05, -0.088, 0.038, 0.066], [0.13, -0.094, 0.034, 0.058], [0.205, -0.088, 0.026, 0.046]],
  nose: [0.222, -0.008, 0.03, 0.046],
  eye: [0.094, 0.03, 0.046, 1],
  ear: [0.074, 0.074, 0.05, 1.2, 0.12],
  earFlat: 0.55,
  mask: 0.7,
  brow: [0.05, 0.012],
  fang: [0.19, 0.036, 0.034],
  pads: [[0.12, -0.05, 0.036, 0.034]],
  mouthY: -0.07,
};

/** The bat of the Sasabonsam: a small round skull, a short flat muzzle, huge round glowing eyes, tall pointed ears. */
const BAT = {
  skull: [[-0.1, 0.048, 0.062, 0.035], [-0.078, 0.078, 0.092, 0.022], [-0.044, 0.098, 0.112, 0.008], [-0.004, 0.104, 0.118, -0.002], [0.04, 0.098, 0.112, -0.004], [0.078, 0.082, 0.092, -0.008], [0.104, 0.054, 0.06, -0.01], [0.115, 0.026, 0.03, -0.01]],
  muzzle: [[0.06, -0.016, 0.05, 0.066], [0.1, -0.026, 0.05, 0.068], [0.134, -0.034, 0.044, 0.06]],
  jaw: [[0.05, -0.086, 0.032, 0.058], [0.1, -0.092, 0.028, 0.05], [0.135, -0.088, 0.02, 0.036]],
  nose: [0.144, -0.018, 0.022, 0.04],
  eye: [0.094, 0.034, 0.05, 1.45],
  ear: [0.07, 0.066, 0.24, 1.15, 0.16],
  earFlat: 0.42,
  earTip: 0.1,
  brow: [0.05, 0.03],
  fang: [0.12, 0.034, 0.05],
  pads: [],
  mouthY: -0.07,
};

/**
 * A carnivore's head from a table (LION, HYENA). o: { fur (the coat), pale (muzzle, chin and whisker pads), mask (the muzzle's own
 * color, if it is not the coat's), nose, eye (the lens), glow, earInner, brow (the ridge's color), slit (a cat's pupil) }.
 */
function carnivore(kit, D, pal, bind, skinPaint, S, o) {
  const hs = D.hs;
  const X = (x) => D.headX + x * hs;
  const Y = (y) => D.headCY + y * hs;
  const fur = o.fur;
  const mask = o.mask || fur;
  const bd = bind.head;
  // the skull and the cheeks
  kit.loft(S.skull.map(([y, rx, rz, dx]) => vs(Y(y), rx * hs, rz * hs, X(dx))), {
    rings: 12, capDepth: [0.012 * hs, 0.012 * hs], color: fur, bind: bd,
    paint: (out, x, y, z, u, a) => {
      if (skinPaint) skinPaint(out, x, y, z, u, a);
      // a dark mask over the face, fading out toward the crown and the cheeks
      if (S.mask && o.mask) {
        const f = clamp((x - X(0.0)) / (0.1 * hs)) * clamp((Y(0.075) - y) / (0.08 * hs) + 0.4);
        tint(out, o.mask, f * S.mask);
      }
    },
  });
  // the muzzle: broad and deep, a bridge sloping from the brow to the nose, a paler underside
  kit.loft(S.muzzle.map(([x, y, ry, rz]) => ps(X(x), Y(y), 0, ry * hs, rz * hs)), {
    ref: [0, 1, 0], rings: 6, sides: 14, start: null, end: 'round', capRings: 2, capDepth: 0.02 * hs, color: mask, bind: bd,
    paint: (out, x, y, z, u, a) => {
      if (skinPaint) skinPaint(out, x, y, z, u, a);
      const under = clamp((a - 0.58) / 0.14) * clamp((0.92 - a) / 0.14);
      if (o.pale) { out.r += (o.pale.r - out.r) * 0.45 * under; out.g += (o.pale.g - out.g) * 0.45 * under; out.b += (o.pale.b - out.b) * 0.45 * under; }
    },
  });
  // the whisker pads: a bulge of pale fur on each side of the upper lip
  for (const side of [1, -1]) {
    for (const [x, y, z, r] of S.pads) {
      kit.loft([ps(X(x - 0.03), Y(y), side * z * hs, r * 0.9 * hs, r * hs), ps(X(x + 0.02), Y(y - 0.004), side * (z + 0.004) * hs, r * 0.95 * hs, r * 1.02 * hs)],
        { ref: [0, 1, 0], rings: 3, sides: 9, start: 'round', end: 'round', capRings: 2, capDepth: 0.014 * hs, color: o.pale || fur, bind: bd, paint: skinPaint });
    }
  }
  // the nose: a broad dark pad across the front of the bridge
  const [nx, ny, nry, nrz] = S.nose;
  kit.loft([ps(X(nx - 0.016), Y(ny), 0, nry * hs, nrz * hs), ps(X(nx + 0.012), Y(ny - 0.007), 0, nry * 0.9 * hs, nrz * 0.94 * hs)],
    { ref: [0, 1, 0], sides: 10, start: null, end: 'round', capRings: 2, capDepth: 0.012 * hs, color: o.nose, mat: 'gloss', bind: bd });
  // the lower jaw, under the muzzle, closed
  kit.loft(S.jaw.map(([x, y, ry, rz]) => ps(X(x), Y(y), 0, ry * hs, rz * hs)), {
    ref: [0, 1, 0], rings: 4, sides: 10, start: null, end: 'round', capRings: 2, capDepth: 0.014 * hs, color: o.pale || fur, bind: bd, paint: skinPaint,
  });
  // the lips: a dark line from under the nose down and back along the jaw to the corner of the mouth, one on each side
  const my = S.mouthY;
  const lastM = S.muzzle[S.muzzle.length - 1];
  for (const side of [1, -1]) {
    const pts = [
      [lastM[0] + 0.004, ny - 0.03, side * 0.006],
      [lastM[0] - 0.016, my + 0.002, side * lastM[3] * 0.38],
      [lastM[0] - 0.062, my - 0.004, side * lastM[3] * 0.84],
      [S.muzzle[1][0] - 0.01, my + 0.004, side * S.muzzle[1][3] * 0.98],
      [S.muzzle[0][0] - 0.01, my + 0.018, side * S.muzzle[0][3] * 1.0],
    ];
    kit.loft(pts.map(([x, y, z]) => ps(X(x), Y(y), z * hs, 0.0072 * hs, 0.0072 * hs)), { ref: [0, 1, 0], rings: 5, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.006 * hs, color: MOUTH, mat: 'skin', bind: bd });
  }
  // the fangs: a pair from the upper lip, a little proud of the jaw
  const [fx, fz, fl] = S.fang;
  for (const side of [1, -1]) {
    kit.loft([ps(X(fx), Y(my + 0.006), side * fz * hs, 0.0085 * hs, 0.0085 * hs), ps(X(fx + 0.004), Y(my - fl), side * fz * hs, 0.0012 * hs, 0.0012 * hs)],
      { ref: [0, 0, 1], sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.005 * hs, color: o.teeth || IVORY, mat: o.teeth ? 'metal' : 'bone', bind: bd });
  }
  // a row of small teeth along the upper lip (iron, in the Sasabonsam's case), the longer fangs over them
  if (o.teeth) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const k = (i / (n - 1)) * 2 - 1;
      const zz = k * lastM[3] * 0.62;
      const xx = lastM[0] - 0.01 - 0.05 * Math.abs(k) ** 1.6;
      kit.loft([ps(X(xx), Y(my + 0.006), zz * hs, 0.0048 * hs, 0.0048 * hs), ps(X(xx + 0.003), Y(my - 0.012 - 0.005 * (1 - Math.abs(k))), zz * hs, 0.0008 * hs, 0.0008 * hs)],
        { ref: [0, 0, 1], sides: 4, start: 'round', end: 'round', capRings: 1, capDepth: 0.003 * hs, color: o.teeth, mat: 'metal', bind: bd });
    }
  }
  // the brow: a heavy ridge over both eyes, its ends lower than its middle (a glare)
  const [bh, bl] = S.brow;
  kit.loft([-0.092, -0.06, -0.026, 0, 0.026, 0.06, 0.092].map((z) => ps(X(0.1 - 0.058 * (z / 0.092) ** 2), Y(bh - bl * (Math.abs(z) / 0.092) ** 2 + 0.01 * (1 - Math.abs(z) / 0.092)), z * hs, 0.0125 * hs, 0.0165 * hs)),
    { ref: [1, 0, 0], rings: 8, sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.01 * hs, color: o.browColor, bind: bd });
  // the eyes: a lens under the ridge in a dark ring, the pupil a slit for the lion, round for the hyena
  const [ex, ey, ez, esz = 1] = S.eye;
  for (const side of [1, -1]) {
    const z = side * ez * hs;
    const e = hs * esz;
    kit.loft([ps(X(ex - 0.014), Y(ey), z, 0.0195 * e, 0.021 * e), ps(X(ex + 0.002), Y(ey), z, 0.0185 * e, 0.02 * e)],
      { ref: [0, 1, 0], sides: 10, start: null, end: 'round', capRings: 1, capDepth: 0.005 * hs, color: INK, mat: 'gloss', bind: bd });
    kit.loft([ps(X(ex - 0.012), Y(ey), z, 0.0155 * e, 0.0165 * e), ps(X(ex + 0.006), Y(ey), z, 0.0145 * e, 0.0155 * e)],
      { ref: [0, 1, 0], sides: 10, start: null, end: 'round', capRings: 1, capDepth: 0.006 * hs, color: o.eye, mat: 'gloss', glow: o.glow ? 1 : 0.1, bind: bd });
    const pz = o.slit ? [0.0045, 0.0135] : [0.0085, 0.0085];
    kit.loft([ps(X(ex + 0.005), Y(ey), z, pz[1] * e, pz[0] * e), ps(X(ex + 0.0098), Y(ey), z, pz[1] * 0.9 * e, pz[0] * 0.9 * e)],
      { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capRings: 1, capDepth: 0.003 * hs, color: INK, mat: 'gloss', bind: bd });
  }
  // the ears: round, at the upper corners of the head, the inside darker
  const [ey0, ez0, rise, sz, lean] = S.ear;
  for (const side of [1, -1]) {
    const z0 = side * ez0 * hs;
    const out = side * lean * hs * 0.5;
    const fl = S.earFlat ?? 1;
    const tipK = S.earTip ?? 0.72;
    kit.loft([
      ps(X(-0.016), Y(ey0), z0, 0.034 * sz * hs * fl, 0.03 * sz * hs),
      ps(X(-0.02), Y(ey0 + rise * 0.55), z0 + out * 0.5, 0.036 * sz * hs * fl, 0.031 * sz * hs),
      ps(X(-0.022), Y(ey0 + rise), z0 + out, 0.036 * tipK * sz * hs * fl, 0.031 * tipK * sz * hs),
    ], { ref: [1, 0, 0], rings: 5, sides: 9, start: 'round', end: 'round', capRings: 2, capDepth: 0.014 * sz * hs, color: shadeC(fur, 0.92), bind: bd, paint: skinPaint });
    kit.loft([
      ps(X(-0.004), Y(ey0 + rise * 0.05), z0, 0.024 * sz * hs * fl, 0.021 * sz * hs),
      ps(X(-0.008), Y(ey0 + rise * 0.55), z0 + out * 0.5, 0.025 * sz * hs * fl, 0.021 * sz * hs),
    ], { ref: [1, 0, 0], rings: 3, sides: 8, start: null, end: 'round', capRings: 1, capDepth: 0.008 * sz * hs, color: o.earInner, bind: bd });
  }
}

/** The lion: a broad flat-faced head, a heavy brow, small round ears in the mane, amber slit eyes, the muzzle a shade paler. */
export function lionHead(kit, D, pal, bind, skinPaint) {
  const fur = pal.skin;
  carnivore(kit, D, pal, bind, skinPaint, LION, {
    fur, pale: mixC(fur, '#f4e6c4', 0.5), nose: withMat('#1c100e', 'gloss'), eye: withMat('#e8b840', 'gloss'), slit: true, glow: false,
    earInner: mixC(fur, '#4a2a22', 0.5), browColor: shadeC(fur, 0.7),
  });
}

/** The hyena: a heavy blunt muzzle in a dark mask, big round ears high on the skull, glowing eyes for the were-hyena of the night. */
export function hyenaHead(kit, D, pal, bind, skinPaint, glowEyes) {
  const fur = pal.skin;
  carnivore(kit, D, pal, bind, skinPaint, HYENA, {
    fur, mask: mixC(fur, '#2a1c14', 0.6), pale: mixC(fur, '#2a1c14', 0.4), nose: INK, eye: withMat(glowEyes ? '#ffc23a' : '#d9a53a', 'gloss'), slit: false, glow: glowEyes,
    earInner: mixC(fur, '#1c1210', 0.6), browColor: shadeC(fur, 0.55),
  });
}

/** The Sasabonsam's head: a bat's, its skin dark, its teeth iron, its eyes a hot amber glow (white ones with a black pupil read as a toy's). */
export function batHead(kit, D, pal, bind, skinPaint, glowEyes) {
  const fur = pal.skin;
  carnivore(kit, D, pal, bind, skinPaint, BAT, {
    fur, pale: mixC(fur, '#5a2a2a', 0.35), nose: INK, eye: glowEyes && pal.eyeGlow ? mixC(pal.eyeGlow, '#ff8c14', 0.92) : withMat('#d8bf5a', 'gloss'), slit: false, glow: glowEyes,
    earInner: mixC(fur, '#6a2a2c', 0.55), browColor: shadeC(fur, 0.6), teeth: withMat(pal.accent, 'metal'),
  });
}

