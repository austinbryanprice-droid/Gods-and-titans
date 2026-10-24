// The heads of the four-legged beasts (the wolf, the fox, the lion, the cat, the bull, the horse), built
// as one table of numbers per kind: a skull and muzzle lofted along the head's length, a lower jaw on its own
// bone, a nose, eyes, ears, teeth, a mouth. A head is modeled in a frame of its own, 1 long from the back of
// the skull (the origin, where the neck joins: the head bone) to the tip of the nose, facing +X; `len` scales it
// and `kit.placed` puts it on the body. (The jackal, the monkey, the crow and the oni are rich-heads.js's.)
import { shadeC, mixC, withMat } from './unit-geo.js';
import { ps, smoothstep } from './rich-kit.js';
import { frameMatrix, pathStations } from './rich-creature-kit.js';
import { clamp, lerp, mul, tint } from './rich-paint.js';

const INK = withMat('#16120f', 'gloss');
const AMBER = withMat('#e6b24a', 'gloss');
const MOUTH = withMat('#4a1c1c', 'skin');
const TONGUE = withMat('#c4585c', 'skin');
const IVORY = withMat('#efe8d4', 'bone');

/** A head table with its skull and jaw slimmer (the jackal's: a wolf's head, narrower in the face). */
function slim(S) {
  const f = (st) => st.map(([x, y, ry, rz, n]) => [x, y, ry * 0.96, rz * (x > 0.3 ? 0.8 : 0.92), n]);
  return { ...S, skull: f(S.skull), jaw: S.jaw.map(([x, y, ry, rz]) => [x, y, ry * 0.95, rz * 0.82]) };
}

/** A head table with its skull and jaw made `k` taller and wider (a cat's head is nearly as wide as it is long). */
function fat(S, k) {
  const f = (st) => st.map(([x, y, ry, rz, n]) => (n === undefined ? [x, y * k, ry * k, rz * k] : [x, y * k, ry * k, rz * k, n]));
  return { ...S, skull: f(S.skull), jaw: f(S.jaw), jawAt: [S.jawAt[0], S.jawAt[1] * k] };
}

/**
 * Per kind (all in head lengths): skull = [x, yCenter, ryVertical, rzLateral] along the head, ending in a round
 * cap; jaw = the same for the lower jaw; jawAt = the jaw's hinge [x, y]; eye = [x, y, (unused), size] (it sits on the
 * skull's surface there); ear = the ear's foot [x, (unused), z], its height, width, lean back / out; fang = [x, length];
 * `pad`: how much of the muzzle's end the nose covers. The nose is derived from the muzzle's last station.
 */
export const MAMMALS = {
  wolf: {
    skull: [[0, 0.1, 0.14, 0.13, 2], [0.07, 0.12, 0.19, 0.19, 2.1], [0.18, 0.13, 0.225, 0.23, 2.1], [0.3, 0.12, 0.205, 0.205, 2.1], [0.4, 0.08, 0.175, 0.16, 2.2], [0.46, 0.03, 0.135, 0.125, 2.4], [0.54, 0.0, 0.118, 0.106, 2.5], [0.68, -0.015, 0.104, 0.09, 2.5], [0.82, -0.02, 0.092, 0.078, 2.5], [0.91, -0.02, 0.082, 0.068, 2.4]],
    jaw: [[0.1, -0.1, 0.065, 0.125], [0.26, -0.13, 0.08, 0.12], [0.46, -0.115, 0.063, 0.088], [0.66, -0.1, 0.052, 0.07], [0.85, -0.085, 0.042, 0.054]],
    jawAt: [0.1, -0.06], eye: [0.38, 0.115, 0.152, 0.047], ear: [0.12, 0.26, 0.1, 0.24, 0.2, 0.12, 0.12], fang: [0.8, 0.075], brow: 0.35,
  },
  jackal: slim({
    skull: [[0, 0.1, 0.14, 0.13, 2], [0.07, 0.12, 0.19, 0.19, 2.1], [0.18, 0.13, 0.225, 0.23, 2.1], [0.3, 0.12, 0.205, 0.205, 2.1], [0.4, 0.08, 0.175, 0.16, 2.2], [0.46, 0.03, 0.135, 0.125, 2.4], [0.54, 0.0, 0.118, 0.106, 2.5], [0.68, -0.015, 0.104, 0.09, 2.5], [0.82, -0.02, 0.092, 0.078, 2.5], [0.91, -0.02, 0.082, 0.068, 2.4]],
    jaw: [[0.1, -0.1, 0.065, 0.125], [0.26, -0.13, 0.08, 0.12], [0.46, -0.115, 0.063, 0.088], [0.66, -0.1, 0.052, 0.07], [0.85, -0.085, 0.042, 0.054]],
    jawAt: [0.1, -0.06], eye: [0.38, 0.115, 0.152, 0.047], ear: [0.14, 0.26, 0.09, 0.44, 0.2, 0.08, 0.1], fang: [0.8, 0.075], brow: 0.3, pad: 0.9,
  }),
  fox: {
    skull: [[0, 0.1, 0.15, 0.13], [0.1, 0.12, 0.19, 0.16], [0.22, 0.12, 0.2, 0.175], [0.36, 0.09, 0.17, 0.14], [0.47, 0.04, 0.12, 0.1], [0.64, 0.015, 0.088, 0.08], [0.82, 0.0, 0.07, 0.064], [0.97, -0.01, 0.06, 0.055]],
    jaw: [[0.1, -0.09, 0.05, 0.1], [0.26, -0.12, 0.055, 0.09], [0.5, -0.1, 0.042, 0.066], [0.72, -0.08, 0.034, 0.05], [0.92, -0.065, 0.026, 0.038]],
    jawAt: [0.1, -0.055], eye: [0.4, 0.12, 0.12, 0.04], ear: [0.15, 0.22, 0.09, 0.42, 0.15, 0.1, 0.14], fang: [0.88, 0.06], brow: 0.2,
  },
  cat: fat({
    skull: [[0, 0.04, 0.2, 0.2, 2], [0.1, 0.07, 0.28, 0.3, 2.1], [0.26, 0.07, 0.31, 0.35, 2.1], [0.44, 0.04, 0.28, 0.33, 2.2], [0.6, 0.0, 0.24, 0.28, 2.3], [0.76, -0.03, 0.21, 0.25, 2.4], [0.88, -0.05, 0.19, 0.22, 2.4], [0.96, -0.055, 0.15, 0.15, 2.3]],
    jaw: [[0.12, -0.14, 0.07, 0.14], [0.3, -0.19, 0.075, 0.16], [0.55, -0.18, 0.065, 0.14], [0.78, -0.16, 0.055, 0.115], [0.9, -0.145, 0.045, 0.085]],
    jawAt: [0.12, -0.1], eye: [0.52, 0.06, 0, 0.055], ear: [0.16, 0.3, 0.2, 0.18, 0.22, 0.1, 0.15], fang: [0.9, 0.08], brow: 0.6, round: true, pad: 0.45,
  }, 1.15),
  lion: fat({
    skull: [[0, 0.04, 0.22, 0.22, 2], [0.1, 0.07, 0.3, 0.33, 2.1], [0.26, 0.07, 0.34, 0.39, 2.1], [0.44, 0.04, 0.31, 0.37, 2.2], [0.6, 0.0, 0.27, 0.31, 2.3], [0.76, -0.03, 0.235, 0.27, 2.4], [0.88, -0.05, 0.21, 0.24, 2.4], [0.96, -0.055, 0.17, 0.17, 2.3]],
    jaw: [[0.12, -0.15, 0.075, 0.16], [0.3, -0.2, 0.08, 0.17], [0.55, -0.2, 0.07, 0.15], [0.78, -0.18, 0.058, 0.125], [0.9, -0.165, 0.048, 0.095]],
    jawAt: [0.12, -0.105], eye: [0.52, 0.06, 0, 0.058], ear: [0.14, 0.32, 0.22, 0.15, 0.2, 0.08, 0.12], fang: [0.9, 0.09], brow: 0.8, round: true, pad: 0.45,
  }, 1.15),
  bull: {
    skull: [[0, 0.1, 0.2, 0.2], [0.1, 0.14, 0.26, 0.255], [0.24, 0.12, 0.265, 0.26], [0.4, 0.04, 0.23, 0.23], [0.56, -0.04, 0.2, 0.2], [0.74, -0.09, 0.185, 0.185], [0.9, -0.12, 0.17, 0.175], [0.98, -0.135, 0.15, 0.16]],
    jaw: [[0.12, -0.13, 0.07, 0.15], [0.3, -0.19, 0.07, 0.15], [0.55, -0.22, 0.06, 0.13], [0.78, -0.215, 0.052, 0.12], [0.93, -0.205, 0.045, 0.1]],
    jawAt: [0.12, -0.08], eye: [0.36, 0.12, 0.215, 0.05], ear: [0.08, 0.17, 0.235, 0.22, 0.14, 0.78, 0.5], fang: null, brow: 0.5, horns: true, pad: 0.95,
  },
  horse: {
    skull: [[0, 0.12, 0.16, 0.14], [0.1, 0.14, 0.2, 0.17], [0.22, 0.12, 0.205, 0.175], [0.36, 0.06, 0.17, 0.15], [0.52, -0.02, 0.125, 0.115], [0.7, -0.07, 0.1, 0.095], [0.88, -0.1, 0.09, 0.09], [0.98, -0.11, 0.085, 0.087]],
    jaw: [[0.1, -0.1, 0.06, 0.1], [0.24, -0.15, 0.065, 0.1], [0.5, -0.17, 0.05, 0.075], [0.75, -0.17, 0.045, 0.065], [0.94, -0.165, 0.04, 0.06]],
    jawAt: [0.1, -0.07], eye: [0.34, 0.12, 0.155, 0.04], ear: [0.12, 0.22, 0.07, 0.22, 0.09, 0.0, 0.1], fang: null, brow: 0.2, pad: 0.85,
  },
};

/** The skull's [yCenter, ryVertical, rzLateral] at x along the head (straight between its stations). */
export function skullAt(S, x) {
  const k = S.skull;
  let i = 0;
  while (i < k.length - 2 && x > k[i + 1][0]) i++;
  const t = clamp((x - k[i][0]) / (k[i + 1][0] - k[i][0]));
  return [lerp(k[i][1], k[i + 1][1], t), lerp(k[i][2], k[i + 1][2], t), lerp(k[i][3], k[i + 1][3], t)];
}

const surfaceN = (S) => (S.round ? 2.3 : 2.15);

/** The skull's half width at x and height y (the superellipse of the station there): the surface an eye or a brow sits on. */
export function widthAt(S, x, y) {
  const [yc, ry, rz] = skullAt(S, x);
  const k = clamp(Math.abs(y - yc) / ry, 0, 0.97);
  const n = surfaceN(S);
  return rz * (1 - k ** n) ** (1 / n);
}

/** The skull's top at x and a sideways offset z: where an ear or a horn is rooted. */
export function topAt(S, x, z) {
  const [yc, ry, rz] = skullAt(S, x);
  const k = clamp(Math.abs(z) / rz, 0, 0.97);
  const n = surfaceN(S);
  return yc + ry * (1 - k ** n) ** (1 / n);
}

/** Head-local positions the body plan needs before the head is built: the jaw's hinge and the ears' feet, scaled by len. */
export function mammalMetrics(kind, len) {
  const S = MAMMALS[kind];
  return {
    jawAt: [S.jawAt[0] * len, S.jawAt[1] * len, 0],
    earAt: S.ear ? [S.ear[0] * len, (topAt(S, S.ear[0], S.ear[2]) - 0.03) * len, S.ear[2] * len] : null,
    top: Math.max(...S.skull.map((s) => s[1] + s[2])) * len,
  };
}

/** One ear: a flat blade (or a rounded one) from its foot, leaning back by `back` and out by `out` of its height. */
function ear(kit, S, side, o, k, fur, inner) {
  const [fx, , fz, h, w, back, out] = S.ear;
  const base = [fx, topAt(S, fx, fz) - 0.03, side * fz];
  const dir = [-back, 1, side * out];
  const dl = Math.hypot(...dir);
  const n = 5;
  const st = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const taper = S.round ? Math.sqrt(Math.max(0, 1 - t * t * 0.95)) : Math.max(0.04, (1 - t) ** 0.85);
    st.push(ps(base[0] + (dir[0] / dl) * h * t, base[1] + (dir[1] / dl) * h * t, base[2] + (dir[2] / dl) * h * t, 0.018 * (1 - t * 0.5), w * 0.5 * taper));
  }
  // the ear's flat side faces forward and a little outward
  const ref = [0.92, 0, side * 0.38];
  kit.loft(st, { ref, rings: 5, sides: 6, capRings: 2, start: 'round', end: S.round ? 'round' : 'flat', capDepth: [0.02, 0.01], color: fur, bind: o.bind.ear?.[side] ?? o.bind.head, paint: o.paint });
  // the inside of the ear, a shade lighter (or the accent's), on its front face
  const st2 = st.slice(0, n - 1).map((s) => ({ ...s, c: [s.c[0] + 0.012 * ref[0], s.c[1], s.c[2] + 0.012 * ref[2]], rx: s.rx * 0.5, rz: s.rz * 0.62 }));
  kit.loft(st2, { ref, rings: 4, sides: 6, start: null, end: null, color: inner, bind: o.bind.ear?.[side] ?? o.bind.head });
  void k;
}

/** A glossy eye on the skull's surface, looking forward and out: a dark rim, the iris, a pupil (a slit for the cats). */
export function eyes(kit, S, o, color, glow, slit, lean) {
  const [x, y, , r] = S.eye;
  const sz = widthAt(S, x, y);
  for (const side of [1, -1]) {
    const d = [0.38, 0, 0.925 * side];
    const dome = (k0, k1, rv, rw, cap, col, gl) => {
      const st = [k0, k1].map((k) => ps(x + d[0] * k * r, y, side * sz + d[2] * k * r, rv, rw));
      kit.loft(st, { ref: [0, 1, 0], sides: lean ? 8 : 10, start: null, end: 'round', capRings: 1, capDepth: cap * r, color: col, mat: 'gloss', glow: gl, bind: o.bind.head });
    };
    if (!lean) dome(-0.35, 0.0, r * 1.32, r * 1.2, 0.3, INK, 0);
    dome(-0.25, 0.1, r * 1.0, r * 0.92, 0.28, color, glow);
    if (slit) dome(-0.1, 0.34, r * 0.7, r * 0.15, 0.12, INK, 0);
    else dome(-0.1, 0.3, r * 0.4, r * 0.36, 0.14, INK, 0);
  }
}

/** Crescent horns from the poll: out, up and forward, ivory with a dark tip. */
function bullHorns(kit, S, o) {
  const x0 = 0.1;
  const z0 = 0.2;
  const y0 = topAt(S, x0, z0) - 0.035;
  const base = o.hornBase ?? mixC('#efe8d4', '#8a7a5a', 0.3);
  const tip = shadeC('#3a3026', 1);
  for (const side of [1, -1]) {
    const keys = [[x0, y0, z0, 0.068, 0.062], [x0 - 0.03, y0 + 0.05, 0.42, 0.058, 0.054], [x0 + 0.0, y0 + 0.13, 0.62, 0.045, 0.042], [x0 + 0.1, y0 + 0.3, 0.74, 0.03, 0.028], [x0 + 0.26, y0 + 0.52, 0.76, 0.012, 0.012]].map(([x, y, z, a, b]) => [x, y, side * z, a, b]);
    kit.loft(pathStations(keys, 10), {
      ref: [0, 1, 0], sides: 10, start: 'round', end: 'round', capRings: 2, capDepth: [0.03, 0.012], color: base, mat: 'bone', bind: o.bind.head,
      paint: (oo, x, y, z, u) => {
        mul(oo, 0.86 + 0.14 * smoothstep(0, 0.22, u));
        tint(oo, tip, smoothstep(0.72, 0.93, u));
        // growth rings
        mul(oo, 1 - 0.07 * (Math.sin(u * 55) > 0.7 ? 1 : 0) * (1 - u));
      },
    });
  }
}

/**
 * A mammal's head, kind in MAMMALS, built into `kit` in a frame of its own placed at `o.at` (the skull base, model
 * space) pitched `o.pitch` and scaled to `o.len`. o: { kind, at, pitch, len, bind: { head, jaw, ear: { 1, -1 } },
 * pal, fur, pale, glowEyes, eyeColor, paint, open, snarl }. The lower jaw and the tongue ride bind.jaw.
 */
export function mammalHead(kit, o) {
  const S = MAMMALS[o.kind];
  const fur = o.fur;
  const pale = o.pale ?? mixC(fur, '#f0e6d2', 0.35);
  const dark = shadeC(fur, 0.55);
  const jawBind = o.bind.jaw ?? o.bind.head;
  const M = frameMatrix(o.at, o.pitch ?? 0, o.yaw ?? 0, o.len);
  const lean = !!o.lean;
  const paint = (oo, x, y, z, u, a) => {
    if (o.paint) o.paint(oo, x, y, z, u, a);
  };
  kit.placed(M, () => {
    // skull and muzzle: the top lighter toward the nose, a muzzle a shade paler under the line of the lip
    const sk = S.skull.map(([x, y, ry, rz, n]) => ps(x, y, 0, ry, rz, n ?? (S.round ? 2.4 : 2.2)));
    kit.loft(sk, {
      ref: [0, 1, 0], rings: lean ? 10 : 14, sides: lean ? 12 : 14, start: 'round', end: 'round', capRings: lean ? 2 : 3, capDepth: [0.07, 0.05], color: fur, bind: o.bind.head,
      paint: (oo, x, y, z, u, a) => {
        paint(oo, x, y, z, u, a);
        // the underside of the muzzle and the cheeks lighter
        const under = clamp((-(y - lerp(0.1, 0, clamp(x))) - 0.04) / 0.1) * clamp((x - 0.25) / 0.35);
        tint(oo, pale, 0.55 * under * (o.pale ? 1 : 0.6));
        // the stop and the brow: a little darker
        mul(oo, 1 - 0.1 * clamp(1 - Math.abs(x - 0.4) / 0.12) * clamp((y + 0.02) / 0.1));
      },
    });
    // the dark inside of the mouth, seen when the jaw drops
    if (!lean) {
      kit.loft([ps(S.jawAt[0] + 0.02, S.jawAt[1] + 0.02, 0, 0.05, 0.1), ps(0.45, S.jaw[2][1] + 0.06, 0, 0.04, 0.075), ps(S.jaw[4][0] - 0.02, S.jaw[4][1] + 0.05, 0, 0.026, 0.04)],
        { ref: [0, 1, 0], rings: 4, sides: 6, capRings: 2, start: 'round', end: 'round', capDepth: 0.02, color: MOUTH, bind: o.bind.head });
    }
    // the lower jaw (and the tongue lying in it)
    const jw = S.jaw.map(([x, y, ry, rz]) => ps(x, y, 0, ry, rz));
    kit.loft(jw, {
      ref: [0, 1, 0], rings: lean ? 5 : 6, sides: lean ? 8 : 10, start: 'round', end: 'round', capRings: 2, capDepth: [0.05, 0.035], color: fur, bind: jawBind,
      paint: (oo, x, y, z, u, a) => {
        paint(oo, x, y, z, u, a);
        tint(oo, pale, (0.12 + 0.6 * smoothstep(0, 0.9, -Math.cos(a * 2 * Math.PI))) * (o.pale ? 1 : 0.6));
      },
    });
    if (!lean) {
      kit.loft([ps(S.jawAt[0] + 0.1, S.jawAt[1] - 0.05, 0, 0.012, 0.07), ps(0.5, S.jaw[2][1] - 0.01, 0, 0.012, 0.06), ps(S.jaw[4][0] - 0.1, S.jaw[4][1] + 0.0, 0, 0.01, 0.035)],
        { ref: [0, 1, 0], rings: 3, sides: 5, capRings: 1, start: 'round', end: 'round', capDepth: 0.02, color: TONGUE, mat: 'skin', bind: jawBind });
    }
    // the nose: a pad over the end of the muzzle, standing a little proud of it
    const last = S.skull[S.skull.length - 1];
    const pad = S.pad ?? 0.88;
    const xe = last[0] + 0.05;
    kit.loft([ps(xe - 0.08, last[1] - 0.004, 0, last[2] * pad * 0.9, last[3] * pad * 0.9), ps(xe - 0.025, last[1] - 0.006, 0, last[2] * pad, last[3] * pad)],
      { ref: [0, 1, 0], sides: lean ? 8 : 10, start: null, end: 'round', capRings: 2, capDepth: 0.04, color: o.noseColor ?? INK, mat: 'gloss', bind: o.bind.head });
    // fangs
    if (S.fang) {
      const [fx, fl] = S.fang;
      const up = skullAt(S, fx);
      for (const side of [1, -1]) {
        const zu = side * up[2] * 0.8;
        const yu = up[0] - up[1] * 0.72;
        kit.loft([ps(fx, yu, zu, 0.016, 0.016), ps(fx + 0.005, yu - fl, zu, 0.0015, 0.0015)],
          { ref: [0, 0, 1], sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.006, color: IVORY, mat: 'bone', bind: o.bind.head });
        const zl = side * (S.jaw[4][3] * 0.72);
        kit.loft([ps(fx - 0.02, S.jaw[4][1] + S.jaw[4][2] * 0.5, zl, 0.014, 0.014), ps(fx - 0.018, S.jaw[4][1] + S.jaw[4][2] * 0.5 + fl * 0.85, zl, 0.0012, 0.0012)],
          { ref: [0, 0, 1], sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.006, color: IVORY, mat: 'bone', bind: jawBind });
      }
    }
    // the lip line: a dark seam from the nose back to the corner of the mouth, one on each side
    if (!lean) for (const side of [1, -1]) {
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const x = lerp(S.jaw[4][0] - 0.02, S.jawAt[0] + 0.1, t);
        const jr = S.jaw[Math.min(4, Math.round((1 - t) * 4))];
        pts.push(ps(x, lerp(S.jaw[4][1] + S.jaw[4][2] * 0.9, S.jawAt[1] + 0.045, t * t), side * lerp(S.jaw[4][3] * 0.98, S.jaw[1][3] * 0.98, t) * 1.02 * (jr ? 1 : 1), 0.0075, 0.0075));
      }
      kit.loft(pts, { ref: [1, 0, 0], rings: 7, sides: 4, capRings: 1, start: 'round', end: 'round', capDepth: 0.006, color: dark, bind: o.bind.head });
    }
    eyes(kit, S, o, o.eyeColor ?? AMBER, o.glowEyes ? 1 : 0, !!S.round, lean);
    // brow: a heavy ridge over each eye (more with a bigger `brow`), lying on the skull
    if (!lean) for (const side of [1, -1]) {
      const [x, y, , r] = S.eye;
      const yb = y + r * 1.3;
      const keys = [[x - 0.07, 0.9], [x + 0.02, 1.15], [x + 0.1, 0.8]].map(([xi, k]) => ps(xi, yb + (k > 1 ? 0.006 : 0), side * (widthAt(S, xi, yb) - r * 0.25), 0.012 + 0.014 * S.brow * k, 0.03));
      kit.loft(keys, { ref: [0, 1, 0], rings: 3, sides: 5, capRings: 1, start: 'round', end: 'round', capDepth: 0.012, color: shadeC(fur, 0.72), bind: o.bind.head });
    }
    if (S.horns && !o.noHorns) bullHorns(kit, S, o);
    for (const side of [1, -1]) ear(kit, S, side, o, 1, S.ear[3] < 0.2 ? fur : shadeC(fur, 0.82), o.earInner ?? mixC(fur, '#d89a9a', 0.35));
  });
}
