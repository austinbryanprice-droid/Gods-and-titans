// The heads of the rich serpents, dragons and crocodiles, built the way the mammals' are (rich-mammal-heads.js):
// one table of numbers per kind, a skull and snout lofted along the head's length, a lower jaw on its own bone, eyes
// with slit pupils, nostrils, brows, fangs, a tongue, and what a unit wears on its head (horns, antlers, a crown) or
// grows from it (whiskers, a mane, cheek fins). A head is modeled in a frame of its own, 1 long from the back of the skull
// (the origin, where the neck joins: the head bone) to the tip of the snout, facing +X; `len` scales it and `kit.placed`
// puts it on the body.
import { shadeC, mixC, withMat } from './unit-geo.js';
import { ps, smoothstep } from './rich-kit.js';
import { frameMatrix, pathStations } from './rich-creature-kit.js';
import { clamp, lerp, mul, tint, hash } from './rich-paint.js';
import { skullAt, topAt, widthAt, eyes } from './rich-mammal-heads.js';
import { tuft, spike } from './rich-creature-parts.js';

const INK = withMat('#16120f', 'gloss');
const AMBER = withMat('#e6b24a', 'gloss');
const MOUTH = withMat('#5a1c22', 'skin');
const TONGUE = withMat('#c4283a', 'skin');
const IVORY = withMat('#efe8d4', 'bone');

/**
 * Per kind (all in head lengths): skull = [x, yCenter, ryVertical, rzLateral] along the head; jaw = the same for the lower
 * jaw; jawAt = the jaw's hinge [x, y]; eye = [x, y, (unused), size]; fang = [x, length] (the upper canines); brow: how heavy
 * the ridge over each eye is (`browTone`: how far toward the back's tone it is painted, 1 by default); nostril: [x, z] of the pits (on the top of the snout); `bulb`: the nostrils stand up as bulbs and
 * a row of teeth runs along the lip; `teeth`: [count a side, x of the first, step] of that row (a bulb's default is 4 from 0.42 by
 * 0.13), `toothLen` its length, `lowerTeeth`: another row stands up from the lower jaw (a crocodile's).
 */
export const REPTILES = {
  serpent: {
    skull: [[0, 0.03, 0.15, 0.15], [0.08, 0.04, 0.19, 0.25], [0.2, 0.04, 0.2, 0.3], [0.36, 0.02, 0.17, 0.25], [0.54, -0.01, 0.13, 0.17], [0.74, -0.03, 0.105, 0.12], [0.9, -0.04, 0.09, 0.095], [0.99, -0.045, 0.07, 0.07]],
    jaw: [[0.1, -0.1, 0.05, 0.2], [0.28, -0.125, 0.055, 0.22], [0.5, -0.12, 0.045, 0.15], [0.74, -0.1, 0.035, 0.1], [0.92, -0.085, 0.028, 0.065]],
    jawAt: [0.1, -0.065], eye: [0.5, 0.05, 0, 0.062], fang: [0.8, 0.2], brow: 0.5, nostril: [0.93, 0.03],
  },
  dragon: {
    skull: [[0, 0.03, 0.2, 0.2], [0.1, 0.07, 0.27, 0.29], [0.22, 0.07, 0.29, 0.31], [0.34, 0.03, 0.25, 0.26], [0.48, -0.02, 0.2, 0.2], [0.68, -0.04, 0.17, 0.165], [0.86, -0.045, 0.16, 0.155], [0.98, -0.05, 0.14, 0.14]],
    jaw: [[0.1, -0.13, 0.07, 0.16], [0.3, -0.17, 0.07, 0.16], [0.55, -0.16, 0.06, 0.14], [0.78, -0.14, 0.05, 0.12], [0.93, -0.125, 0.04, 0.1]],
    jawAt: [0.1, -0.085], eye: [0.36, 0.1, 0, 0.065], fang: [0.9, 0.16], brow: 1, nostril: [0.9, 0.06], bulb: true,
  },
  // flat and wide at the back, a long snout that swells at the tip, the eyes standing up on the brow ridges
  crocodile: {
    skull: [[0, 0.05, 0.11, 0.2], [0.08, 0.055, 0.125, 0.27], [0.2, 0.05, 0.12, 0.275], [0.32, 0.035, 0.1, 0.22], [0.46, 0.02, 0.085, 0.165], [0.62, 0.01, 0.075, 0.13], [0.8, 0.0, 0.07, 0.14], [0.93, -0.005, 0.066, 0.145], [0.99, -0.008, 0.058, 0.105]],
    jaw: [[0.08, -0.07, 0.045, 0.21], [0.25, -0.082, 0.05, 0.215], [0.5, -0.072, 0.042, 0.15], [0.75, -0.062, 0.04, 0.14], [0.92, -0.056, 0.036, 0.125]],
    jawAt: [0.08, -0.04], eye: [0.3, 0.12, 0, 0.055], fang: null, brow: 0.7, browTone: 0.45, nostril: [0.965, 0.05], bulb: true, teeth: [9, 0.3, 0.072], toothLen: 0.06, lowerTeeth: true,
  },
};

/** The lower jaw's [yCenter, ryVertical, rzLateral] at x (straight between its stations). */
function jawProfileAt(S, x) {
  const k = S.jaw;
  let i = 0;
  while (i < k.length - 2 && x > k[i + 1][0]) i++;
  const t = clamp((x - k[i][0]) / (k[i + 1][0] - k[i][0]));
  return [lerp(k[i][1], k[i + 1][1], t), lerp(k[i][2], k[i + 1][2], t), lerp(k[i][3], k[i + 1][3], t)];
}

/** Head-local positions the body plan needs before the head is built: the jaw's hinge, scaled by len. */
export function reptileMetrics(kind, len) {
  const S = REPTILES[kind];
  return { jawAt: [S.jawAt[0] * len, S.jawAt[1] * len, 0] };
}

/** A horn or a tine: a smooth tapering curve through key points [x, y, z, r], ivory at the root, darker toward the tip. */
function curve(kit, keys, o) {
  const base = o.color;
  const tip = o.tip ?? shadeC(base, 0.45);
  kit.loft(pathStations(keys.map(([x, y, z, r]) => [x, y, z, r, r]), o.n ?? 9), {
    ref: [0, 1, 0], sides: o.sides ?? 8, start: 'round', end: 'round', capRings: 2, capDepth: [0.03, 0.012], color: base, mat: o.mat ?? 'bone', bind: o.bind,
    paint: (oo, x, y, z, u) => {
      mul(oo, 0.86 + 0.14 * smoothstep(0, 0.2, u));
      tint(oo, tip, smoothstep(0.7, 0.96, u) * (o.tipAmount ?? 1));
      mul(oo, 1 - 0.07 * (Math.sin(u * 48) > 0.7 ? 1 : 0) * (1 - u));
    },
  });
}

/** Two swept-back horns from behind the brow. */
function horns(kit, S, o) {
  const x0 = 0.16;
  const z0 = 0.17;
  const y0 = topAt(S, x0, z0) - 0.03;
  for (const side of [1, -1]) {
    const keys = [[x0, y0, z0, 0.075], [x0 - 0.1, y0 + 0.12, z0 + 0.1, 0.066], [x0 - 0.3, y0 + 0.28, z0 + 0.15, 0.05], [x0 - 0.55, y0 + 0.36, z0 + 0.12, 0.03], [x0 - 0.8, y0 + 0.34, z0 + 0.04, 0.012]].map(([x, y, z, r]) => [x, y, side * z, r]);
    curve(kit, keys, { color: o.horn, bind: o.bind.head, sides: 9 });
  }
}

/** Branching antlers: a beam sweeping back and up from the poll, with tines rising from it. */
function antlers(kit, S, o) {
  const x0 = 0.14;
  const z0 = 0.13;
  const y0 = topAt(S, x0, z0) - 0.03;
  for (const side of [1, -1]) {
    const beam = [[x0, y0, z0, 0.05], [x0 - 0.1, y0 + 0.14, z0 + 0.1, 0.045], [x0 - 0.24, y0 + 0.3, z0 + 0.17, 0.038], [x0 - 0.42, y0 + 0.44, z0 + 0.2, 0.028], [x0 - 0.62, y0 + 0.52, z0 + 0.2, 0.014]];
    curve(kit, beam.map(([x, y, z, r]) => [x, y, side * z, r]), { color: o.antler, bind: o.bind.head, sides: 7, tipAmount: 0.4 });
    // tines from the second to the fourth point, each forking up and a little forward
    [[1, 0.22, 0.2], [2, 0.26, 0.26], [3, 0.2, 0.3]].forEach(([i, h, fwd], k) => {
      const [bx, by, bz, br] = beam[i];
      curve(kit, [[bx, by, side * bz, br * 0.8], [bx + fwd * 0.35, by + h * 0.55, side * (bz + 0.03), br * 0.55], [bx + fwd * 0.55, by + h, side * (bz + 0.05 + 0.02 * k), br * 0.18]], { color: o.antler, bind: o.bind.head, sides: 6, n: 5, tipAmount: 0.3 });
    });
  }
}

/** A band of metal round the skull behind the brow with points standing up from it and a stone in front. */
function crown(kit, S, o) {
  const cx = 0.2;
  const rx = 0.13;
  const rzk = 0.9;
  const n = 18;
  const st = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx;
    const z = Math.sin(a) * (skullAt(S, clamp(x, 0, 1))[2] * rzk);
    const y = topAt(S, clamp(x, 0, 1), Math.abs(z)) - 0.012;
    st.push(ps(x, y, z, 0.026, 0.02));
  }
  st.push(st[0]);
  kit.loft(st, { ref: [0, 1, 0], sides: 6, start: null, end: null, color: o.metal, mat: o.metal.mat ?? 'gold', bind: o.bind.head });
  const pts = 7;
  for (let i = 0; i < pts; i++) {
    const a = ((i + 0.5) / pts) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx;
    const z = Math.sin(a) * (skullAt(S, clamp(x, 0, 1))[2] * rzk);
    const y = topAt(S, clamp(x, 0, 1), Math.abs(z)) - 0.012;
    spike(kit, { at: [x, y, z], dir: [0, 1, 0], len: 0.17 + 0.03 * (i % 2), r: 0.03, color: o.metal, mat: o.metal.mat ?? 'gold', bind: o.bind.head, sides: 5, ref: [1, 0, 0] });
  }
  const gx = cx + rx;
  kit.loft([ps(gx - 0.01, topAt(S, gx, 0) + 0.015, 0, 0.032, 0.02), ps(gx + 0.02, topAt(S, gx, 0) + 0.02, 0, 0.03, 0.022)], {
    ref: [0, 1, 0], sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.02, color: o.gem, mat: 'gem', glow: 0.5, bind: o.bind.head,
  });
}

/** Long barbels from the sides of the snout, sweeping back and out. */
function whiskers(kit, S, o) {
  for (const side of [1, -1]) {
    for (let k = 0; k < 2; k++) {
      const f = k * 0.5;
      const keys = [[0.86 - 0.05 * k, -0.03 - 0.02 * k, 0.1 + 0.02 * k, 0.03], [0.72 - 0.07 * k, -0.07 - 0.04 * k, 0.28 + 0.07 * k, 0.024], [0.5 - 0.08 * k, -0.13 - 0.07 * k, 0.5 + 0.1 * k, 0.017], [0.26 - 0.08 * k, -0.2 - 0.12 * k - f * 0.05, 0.64 + 0.14 * k, 0.008]].map(([x, y, z, r]) => [x, y, side * z, r]);
      curve(kit, keys, { color: o.whisker, bind: o.bind.head, sides: 5, n: 8, tip: o.whisker, mat: 'cloth', tipAmount: 0 });
    }
  }
}

/** Locks of hair streaming back from the poll and the cheeks. */
function maneLocks(kit, S, o) {
  const n = 9;
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1) - 0.5;
    const side = s < 0 ? -1 : 1;
    const x = 0.2 - 0.12 * Math.abs(s);
    const z = s * 0.46;
    const y = topAt(S, x, Math.abs(z)) - 0.04 - 0.1 * Math.abs(s);
    tuft(kit, {
      at: [x, y, z], dir: [-1, 0.25 - 0.5 * Math.abs(s), side * 0.35 * Math.abs(s)], len: 0.62 - 0.14 * Math.abs(s) * 2, w: 0.075, th: 0.03, bend: [-0.1, -0.2, side * 0.12 * Math.abs(s)],
      across: [0, 0, 1], color: i % 2 ? o.mane : shadeC(o.mane, 0.8), bind: o.bind.head, sides: 5, rings: 4, mat: 'fur',
    });
  }
}

/** Cheek fins behind the jaw's hinge: three blades fanned back from each side. */
function cheekFins(kit, S, o) {
  for (const side of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const a = -0.35 + k * 0.4;
      tuft(kit, {
        at: [0.13, -0.05 - 0.03 * k, side * 0.2], dir: [-0.8, Math.sin(a) * 0.5, side * 0.55], len: 0.4 - 0.05 * k, w: 0.055, th: 0.012, bend: [-0.08, -0.04, side * 0.06],
        across: [0, 1, 0], color: k === 1 ? o.fin : shadeC(o.fin, 0.85), bind: o.bind.head, sides: 4, rings: 3, mat: 'cloth', blunt: true,
      });
    }
  }
}

/**
 * How a second tone sits on a reptile's back: a stripe along the ridge when it is far from the skin (a wash of it would only turn
 * both to mud, as orange over blue does), a wide wash when it is near. { k, lo, hi }: the amount, and the smoothstep edges on cos(angle).
 */
export function backTone(skin, back, k) {
  const far = Math.abs(back.r - skin.r) + Math.abs(back.g - skin.g) + Math.abs(back.b - skin.b) > 0.35;
  return far ? { k: Math.max(k, 0.9), lo: 0.74, hi: 0.985 } : { k, lo: 0.4, hi: 0.95 };
}

/**
 * A reptile's head, kind in REPTILES, built into `kit` in a frame of its own placed at `o.at` (the skull base, model
 * space) pitched `o.pitch`, yawed `o.yaw` and scaled to `o.len`. o: { kind, at, pitch, len, bind: { head, jaw }, skin, belly, back, glowEyes,
 * eyeColor, lean, tongue (a forked tongue out of the mouth), gear: 'horns' | 'antlers' | 'crown' | 'none', horn, antler,
 * metal, gem, whisker (a color: long barbels), mane (a color: locks from the poll), fin (a color: cheek fins), paint }.
 */
export function reptileHead(kit, o) {
  const S = REPTILES[o.kind];
  const skin = o.skin;
  const belly = o.belly ?? mixC(skin, '#f0e6d2', 0.4);
  const back = o.back ?? shadeC(skin, 0.7);
  const tone = backTone(skin, back, 0.55);
  const dark = shadeC(skin, 0.5);
  const jawBind = o.bind.jaw ?? o.bind.head;
  const M = frameMatrix(o.at, o.pitch ?? 0, o.yaw ?? 0, o.len);
  const lean = !!o.lean;
  const paint = (oo, x, y, z, u, a) => {
    if (o.paint) o.paint(oo, x, y, z, u, a);
  };
  kit.placed(M, () => {
    // skull and snout: the crown a shade toward the back's tone, the underside and the lips toward the belly's
    const sk = S.skull.map(([x, y, ry, rz]) => ps(x, y, 0, ry, rz, 2.3));
    kit.loft(sk, {
      ref: [0, 1, 0], rings: lean ? 9 : 13, sides: lean ? 12 : 16, start: 'round', end: 'round', capRings: lean ? 2 : 3, capDepth: [0.07, 0.05], color: skin, bind: o.bind.head,
      paint: (oo, x, y, z, u, a) => {
        paint(oo, x, y, z, u, a);
        const c = Math.cos(a * 2 * Math.PI);
        tint(oo, back, tone.k * smoothstep(tone.lo, tone.hi, c));
        tint(oo, belly, 0.6 * smoothstep(0.35, 0.95, -c) * smoothstep(0.1, 0.35, u));
        mul(oo, 0.94 + 0.08 * hash(Math.round(x * 90), Math.round(y * 90), Math.round(z * 90)));
      },
    });
    // the dark inside of the mouth, seen when the jaw drops
    if (!lean) {
      kit.loft([ps(S.jawAt[0] + 0.02, S.jawAt[1] + 0.02, 0, 0.05, 0.11), ps(0.45, S.jaw[2][1] + 0.06, 0, 0.04, 0.085), ps(S.jaw[4][0] - 0.02, S.jaw[4][1] + 0.05, 0, 0.026, 0.045)],
        { ref: [0, 1, 0], rings: 4, sides: 6, capRings: 2, start: 'round', end: 'round', capDepth: 0.02, color: MOUTH, bind: o.bind.head });
    }
    // the lower jaw, its underside pale
    kit.loft(S.jaw.map(([x, y, ry, rz]) => ps(x, y, 0, ry, rz)), {
      ref: [0, 1, 0], rings: lean ? 5 : 6, sides: lean ? 8 : 12, start: 'round', end: 'round', capRings: 2, capDepth: [0.05, 0.035], color: skin, bind: jawBind,
      paint: (oo, x, y, z, u, a) => {
        paint(oo, x, y, z, u, a);
        tint(oo, belly, 0.15 + 0.7 * smoothstep(0, 0.9, -Math.cos(a * 2 * Math.PI)));
      },
    });
    // a tongue lying in the jaw; a snake's is forked and flicks out past the snout
    if (!lean) {
      const jl = S.jaw[4];
      kit.loft([ps(S.jawAt[0] + 0.1, S.jawAt[1] - 0.04, 0, 0.012, 0.07), ps(0.5, S.jaw[2][1] - 0.01, 0, 0.012, 0.06), ps(jl[0] - 0.05, jl[1] + 0.012, 0, 0.01, 0.035)],
        { ref: [0, 1, 0], rings: 3, sides: 5, capRings: 1, start: 'round', end: 'round', capDepth: 0.02, color: TONGUE, mat: 'skin', bind: jawBind });
    }
    if (o.tongue) {
      const jl = S.jaw[4];
      const x0 = jl[0] - 0.05;
      const y0 = jl[1] + 0.012;
      kit.loft([ps(x0, y0, 0, 0.011, 0.03), ps(x0 + 0.2, y0 - 0.005, 0, 0.007, 0.022), ps(x0 + 0.34, y0 - 0.01, 0, 0.005, 0.012)],
        { ref: [0, 1, 0], rings: 3, sides: 4, capRings: 1, start: 'round', end: null, capDepth: 0.01, color: TONGUE, mat: 'skin', bind: jawBind });
      for (const side of [1, -1]) {
        kit.loft([ps(x0 + 0.34, y0 - 0.01, side * 0.004, 0.005, 0.009), ps(x0 + 0.43, y0 - 0.012, side * 0.04, 0.004, 0.006), ps(x0 + 0.5, y0 - 0.012, side * 0.075, 0.0025, 0.0035)],
          { ref: [0, 1, 0], rings: 3, sides: 4, capRings: 1, start: 'round', end: 'round', capDepth: 0.006, color: TONGUE, mat: 'skin', bind: jawBind });
      }
    }
    // nostrils: pits on the top of the snout, or bulbs standing up from it with a dark slit in each
    const [nx, nz] = S.nostril;
    const ny = skullAt(S, nx)[0] + skullAt(S, nx)[1] * 0.92;
    for (const side of [1, -1]) {
      if (S.bulb) {
        kit.loft([ps(nx - 0.05, ny - 0.01, side * nz, 0.026, 0.032), ps(nx + 0.0, ny + 0.012, side * nz, 0.03, 0.036), ps(nx + 0.05, ny + 0.008, side * nz, 0.022, 0.03)],
          { ref: [0, 1, 0], rings: 3, sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: 0.02, color: shadeC(skin, 0.85), bind: o.bind.head });
        kit.loft([ps(nx + 0.045, ny + 0.012, side * nz, 0.012, 0.018), ps(nx + 0.065, ny + 0.01, side * nz, 0.008, 0.012)],
          { ref: [0, 1, 0], sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.008, color: INK, mat: 'gloss', bind: o.bind.head });
      } else {
        kit.loft([ps(nx - 0.015, ny, side * nz, 0.007, 0.012), ps(nx + 0.015, ny, side * nz, 0.007, 0.012)],
          { ref: [0, 1, 0], sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.008, color: INK, mat: 'gloss', bind: o.bind.head });
      }
    }
    // fangs: the upper canines hang outside the lower jaw, a short one behind each; a dragon's row of teeth along the lip
    if (S.fang) {
      const [fx, fl] = S.fang;
      const up = skullAt(S, fx);
      for (const side of [1, -1]) {
        const zu = side * up[2] * 0.78;
        const yu = up[0] - up[1] * 0.72;
        kit.loft([ps(fx, yu, zu, 0.02, 0.02), ps(fx - 0.01, yu - fl * 0.6, zu, 0.011, 0.011), ps(fx - 0.035, yu - fl, zu, 0.0015, 0.0015)],
          { ref: [0, 0, 1], sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.008, color: IVORY, mat: 'bone', bind: o.bind.head });
        if (!lean) {
          const zl = side * S.jaw[4][3] * 0.7;
          kit.loft([ps(fx - 0.02, S.jaw[4][1] + S.jaw[4][2] * 0.5, zl, 0.012, 0.012), ps(fx - 0.025, S.jaw[4][1] + S.jaw[4][2] * 0.5 + fl * 0.6, zl, 0.0012, 0.0012)],
            { ref: [0, 0, 1], sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.006, color: IVORY, mat: 'bone', bind: jawBind });
        }
      }
    }
    if (S.bulb && !lean) {
      const [count, first, step] = S.teeth ?? [4, 0.42, 0.13];
      const tl = S.toothLen ?? 0.065;
      for (const side of [1, -1]) {
        for (let i = 0; i < count; i++) {
          const x = first + i * step;
          const sk0 = skullAt(S, x);
          const z = side * widthAt(S, x, sk0[0] - sk0[1] * 0.7) * 0.9;
          const y = sk0[0] - sk0[1] * 0.78;
          kit.loft([ps(x, y, z, 0.012, 0.012), ps(x, y - tl, z, 0.0015, 0.0015)], { ref: [0, 0, 1], sides: 4, start: 'round', end: 'round', capRings: 1, capDepth: 0.005, color: IVORY, mat: 'bone', bind: o.bind.head });
        }
      }
    }
    // a crocodile's lower teeth stand up between the upper ones, outside the closed mouth
    if (S.lowerTeeth && !lean) {
      const [count, first, step] = S.teeth;
      const tl = S.toothLen ?? 0.065;
      for (const side of [1, -1]) {
        for (let i = 0; i < count - 1; i++) {
          const x = first + (i + 0.5) * step;
          const [jy, jr, jz] = jawProfileAt(S, x);
          kit.loft([ps(x, jy + jr * 0.7, side * jz * 0.9, 0.011, 0.011), ps(x, jy + jr * 0.7 + tl * 0.9, side * jz * 0.9, 0.0014, 0.0014)], { ref: [0, 0, 1], sides: 4, start: 'round', end: 'round', capRings: 1, capDepth: 0.005, color: IVORY, mat: 'bone', bind: jawBind });
        }
      }
    }
    // the lip line: a dark seam from the snout back to the corner of the mouth
    if (!lean) {
      for (const side of [1, -1]) {
        const pts = [];
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          const x = lerp(S.jaw[4][0] - 0.02, S.jawAt[0] + 0.1, t);
          pts.push(ps(x, lerp(S.jaw[4][1] + S.jaw[4][2] * 0.9, S.jawAt[1] + 0.045, t * t), side * lerp(S.jaw[4][3] * 0.98, S.jaw[1][3] * 0.98, t) * 1.02, 0.0075, 0.0075));
        }
        kit.loft(pts, { ref: [1, 0, 0], rings: 7, sides: 4, capRings: 1, start: 'round', end: 'round', capDepth: 0.006, color: dark, bind: o.bind.head });
      }
    }
    // eyes: slit pupils, glowing when the unit's eyes glow
    const eyeSpec = { ...S, round: true };
    eyes(kit, eyeSpec, o, o.eyeColor ?? AMBER, o.glowEyes ? 1 : 0, true, lean);
    // a ridge over each eye
    for (const side of [1, -1]) {
      const [x, y, , r] = S.eye;
      const yb = y + r * 1.25;
      const keys = [[x - 0.09, 0.8], [x + 0.0, 1.15], [x + 0.12, 0.8]].map(([xi, k]) => ps(xi, yb + (k > 1 ? 0.008 : 0), side * (widthAt(eyeSpec, xi, yb) - r * 0.2), 0.012 + 0.016 * S.brow * k, 0.032));
      kit.loft(keys, { ref: [0, 1, 0], rings: 3, sides: 5, capRings: 1, start: 'round', end: 'round', capDepth: 0.012, color: S.browTone ? mixC(skin, back, S.browTone) : back, bind: o.bind.head });
    }
    // what grows from it and what it wears
    if (o.whisker) whiskers(kit, S, o);
    if (o.mane) maneLocks(kit, S, o);
    if (o.fin) cheekFins(kit, S, o);
    if (o.gear === 'horns') horns(kit, S, o);
    else if (o.gear === 'antlers') antlers(kit, S, o);
    else if (o.gear === 'crown') crown(kit, S, o);
  });
}
