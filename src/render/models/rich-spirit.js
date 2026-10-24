// The rich spirits (High and Ultra): the Greek Shade and the Celtic Banshee. They stand on the humanoid skeleton as far as the
// waist (arms that reach with long fingers, a head under a deep hood or a veil, eyes that burn) and trail a wisp where the legs
// would be: a chain of bones (rich-kit.js humanoidSpec, opts.tail) hangs from the pelvis and a ragged shroud of cloth tongues is
// skinned along it, so the hem streams behind a drifting spirit and sways about a still one (rich-anim.js poseTail). The whole
// body is translucent: the mesh carries a per vertex alpha (the kit's paint.alpha), faint toward the hem and the tips of the
// hair and burning solid in the eyes (`ghostly`), and is drawn with the ghost material (unit-models.js). The pantheons' outfits
// are not used: a spirit wears one look, colored by the unit's palette (rich-outfits.js, SPIRIT).
import { TEAM, shadeC, mixC, lumaC } from './unit-geo.js';
import { vs, ps, B, mixBind, alongPath, resample, smoothstep } from './rich-kit.js';
import { torsoStations, armStations } from './rich-body.js';
import { addHairCap } from './rich-headgear.js';
import { clamp, lerp, hash, gradY, paints, mul, tint } from './rich-paint.js';

const PI = Math.PI;
const TAU = PI * 2;
const wrap = (a) => (a > PI ? a - TAU : a);

/** How solid the body is where it is not fading (the eyes and the circlet's gem, which glow strongly, are always solid). */
const BODY_ALPHA = 0.88;
/** The faint light a spirit gives off (so it still reads at dusk), and the glow from which a part stays solid. */
const BASE_GLOW = 0.12;
const SOLID_GLOW = 0.6;

// ---------------------------------------------------------------------------
// the wisp: bones, skin weights and the shroud's shape
// ---------------------------------------------------------------------------

/** The shroud's key stations below the hip: [forward, drop below the hip (negative: above it), half width, half thickness]. */
const WISP = [
  [0.0, -0.07, 0.15, 0.125], [-0.005, 0.02, 0.18, 0.15], [-0.03, 0.14, 0.175, 0.145], [-0.085, 0.25, 0.145, 0.12],
  [-0.17, 0.33, 0.1, 0.085], [-0.29, 0.38, 0.062, 0.05], [-0.42, 0.395, 0.03, 0.026], [-0.55, 0.39, 0.006, 0.006],
];
/** The wisp's bones, down its path: [forward, drop below the hip]. */
const WISP_BONES = [[-0.012, 0.05], [-0.045, 0.17], [-0.12, 0.29], [-0.25, 0.37]];

/** The rest positions of the wisp's bones for humanoidSpec (opts.tail). */
export const wispBones = (D) => WISP_BONES.map(([x, drop]) => [x, D.hipY - drop, 0]);

/**
 * The skin weights of the wisp (bind.wisp: along its bones, which hang from the pelvis) and of a robe that runs from the torso
 * down into it (bind.robe: the torso's weights at the waist, the wisp's below the hip).
 */
export function addWispBinds(spec, D, bind) {
  const bones = [B.pelvis, ...WISP_BONES.map((p, i) => spec.tail.first + i)];
  const tip = WISP[WISP.length - 1];
  const pts = [[0, D.hipY, 0], ...wispBones(D), [tip[0], D.hipY - tip[1], 0]];
  bind.wisp = alongPath(bones, pts);
  bind.robe = mixBind(bind.wisp, bind.torso, (x, y) => smoothstep(D.hipY - 0.03, D.hipY + 0.05, y));
}

/** The shroud's centerline at s (0 at the waist, 1 at the tip): { c: [x, y], a: half width, b: half thickness, n: the unit normal in the vertical plane, facing forward }. */
function wispAt(D) {
  const dense = resample(WISP.map(([x, drop, a, b]) => ps(x, D.hipY - drop, 0, a, b)), 40);
  return (s) => {
    const f = clamp(s) * (dense.length - 1);
    const i = Math.min(dense.length - 2, Math.floor(f));
    const k = f - i;
    const p = dense[i];
    const q = dense[i + 1];
    const j0 = dense[Math.max(0, i - 1)].c;
    const j1 = dense[Math.min(dense.length - 1, i + 2)].c;
    let tx = j1[0] - j0[0];
    let ty = j1[1] - j0[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    return { c: [lerp(p.c[0], q.c[0], k), lerp(p.c[1], q.c[1], k)], a: lerp(p.rx, q.rx, k), b: lerp(p.rz, q.rz, k), n: [-ty, tx] };
  };
}

/** Torn teeth around a ring: 0 .. 1, `teeth` of them round the circle, each a different height. */
const jag = (a, teeth, seed = 0) => {
  const t = ((wrap(a) + PI) / TAU) * teeth;
  const i = Math.floor(t);
  const f = t - i;
  return (0.45 + 0.55 * hash(i, seed, 1.7)) * (1 - Math.abs(2 * f - 1));
};

/** The fade of the body below the hip: 1 at the waist, faint toward the hem and the trailing tip. */
const fadeHem = (D) => (o, x, y) => {
  o.alpha *= lerp(0.16, 1, smoothstep(D.hipY - 0.4, D.hipY + 0.02, y));
};

function shroud(E) {
  const { kit, D, bind, pal } = E;
  const color = pal.primary;
  const dark = shadeC(color, 0.84);
  const at = wispAt(D);
  // the body of the skirt: a bell that tapers and curves back, closed before the tip (the tongues carry on)
  kit.loft(WISP.slice(0, 6).map(([x, drop, a, b]) => ps(x, D.hipY - drop, 0, a, b)), {
    ref: [0, 0, 1], rings: 11, sides: 18, start: 'round', end: 'round', capDepth: 0.03, color, bind: bind.robe,
    warp: (p, a, u) => {
      // long pleats down the cloth
      const k = Math.sin(a * 7) * 0.007 * smoothstep(0, 0.4, u);
      p[2] += k;
    },
    paint: paints(gradY(D.hipY - 0.35, D.hipY + 0.05, 0.8, 1.02), fadeHem(D)),
  });
  // the ragged tongues of the hem, hanging over the bell and streaming past its end
  const n = 11;
  for (let i = 0; i < n; i++) {
    const phi = -PI + ((i + 0.5 + (hash(i, 5, 1) - 0.5) * 0.4) / n) * TAU;
    const rear = (1 - Math.cos(phi)) / 2; // 0 in front, 1 behind
    const s0 = 0.1 + 0.06 * hash(i, 2, 7);
    const s1 = lerp(0.62, 1, Math.pow(rear, 0.8)) - 0.07 * hash(i, 9, 3);
    const w0 = lerp(0.075, 0.055, rear);
    const flare = 0.02 + 0.08 * rear + 0.03 * hash(i, 4, 8);
    const m = 7;
    const st = [];
    const ca = Math.cos(phi);
    const sa = Math.sin(phi);
    for (let j = 0; j <= m; j++) {
      const k = j / m;
      const f = at(lerp(s0, s1, k));
      const off = 0.012 + flare * k * k;
      const x = f.c[0] + f.n[0] * ca * (f.b + off);
      const y = f.c[1] + f.n[1] * ca * (f.b + off);
      const z = sa * (f.a + off) + 0.02 * Math.sin(k * 5 + i * 1.7) * k;
      st.push(ps(x, y, z, w0 * (1 - 0.7 * k), 0.005));
    }
    const mid = at((s0 + s1) / 2);
    kit.loft(st, {
      ref: [-sa * mid.b * mid.n[0], -sa * mid.b * mid.n[1], ca * mid.a], rings: 8, sides: 6, start: 'round', end: 'round', capRings: 2, capDepth: 0.012,
      color: i % 2 ? dark : color, bind: bind.wisp,
      paint: paints(gradY(D.hipY - 0.4, D.hipY, 0.78, 1), (o, x, y, z, u) => {
        const k = smoothstep(0.35, 1, u);
        o.alpha *= lerp(1, 0.2, k);
        tint(o, pal.accent, 0.3 * k);
        o.glow = 0.3 * k;
      }),
    });
  }
}

// ---------------------------------------------------------------------------
// the upper body
// ---------------------------------------------------------------------------

/** The robe over the chest and belly, down to the shroud, with the sash of the team's color about the waist. */
function robe(E) {
  const { kit, D, bind, pal } = E;
  kit.loft(torsoStations(D, 0.016), {
    rings: 11, start: null, end: 'round', capDepth: 0.012, color: pal.primary, bind: bind.torso, paint: gradY(D.hipY - 0.1, D.shoulderY, 0.8, 1.04),
  });
  const y = (f) => D.hipY + (D.shoulderY - D.hipY) * f;
  const g = 0.034;
  kit.loft([vs(y(0.2), D.depth * 0.5 + g, D.waistW * 0.5 + g), vs(y(0.32), D.depth * 0.5 + g - 0.004, D.waistW * 0.5 + g - 0.004)],
    { sides: 16, rings: 3, start: null, end: null, color: TEAM(1), bind: bind.torso });
  // the knot at the hip and its two ends, hanging in the wisp
  const kx = D.depth * 0.5 + g + 0.004;
  const kz = -D.waistW * 0.3;
  kit.loft([ps(kx, y(0.26), kz, 0.018, 0.016), ps(kx + 0.006, y(0.26), kz, 0.016, 0.014)], { ref: [0, 1, 0], sides: 8, capDepth: 0.008, color: TEAM(0.85), bind: bind.torso });
  for (const [dz, len, lean] of [[-0.012, 0.3, 0.02], [0.014, 0.23, 0.05]]) {
    const top = y(0.26);
    const st = [];
    for (let j = 0; j <= 5; j++) {
      const k = j / 5;
      st.push(ps(kx + 0.01 + lean * k + 0.004 * Math.sin(k * 4), top - 0.01 - k * len, kz + dz * (1 + 1.6 * k), 0.016 * (1 - 0.6 * k), 0.004));
    }
    kit.loft(st, { ref: [0, 0, 1], rings: 6, sides: 6, start: null, end: 'round', capDepth: 0.01, color: TEAM(0.92), bind: bind.robe, paint: fadeHem(D) });
  }
}

/** A shawl over the shoulders, torn along its edge. */
function mantle(E, { color, long = 1 }) {
  const { kit, D, bind } = E;
  const sh = D.shoulderY;
  const K = D.k;
  kit.loft([vs(sh + 0.034, 0.072 * K, 0.1 * K, -0.004), vs(sh + 0.004, 0.118 * K, 0.19 * K, -0.012), vs(sh - 0.06 * long, 0.14 * K, 0.255 * K, -0.014), vs(sh - 0.13 * long, 0.138 * K, 0.272 * K, -0.012)], {
    rings: 8, sides: 20, start: null, end: null, color, bind: bind.torso,
    warp: (p, a, u) => {
      p[1] -= 0.05 * long * jag(a, 7, 3) * smoothstep(0.78, 1, u);
    },
    paint: gradY(sh - 0.16, sh + 0.03, 0.8, 1),
  });
}

/** Long sleeves that open wide at the wrist and end in rags; the bare forearm inside, then the hand. */
function sleeves(E, { color }) {
  const { kit, D, bind, pal } = E;
  const flare = [0.07, 0.052, 0.03, 0.014, 0.008, 0.006];
  for (const side of [1, -1]) {
    const bd = bind.arm[side];
    kit.loft(armStations(D, side).slice(0, 4), { rings: 5, start: null, end: null, color: pal.skin, bind: bd });
    const st = armStations(D, side, 0.012).map((s, i) => ({ ...s, rx: s.rx + flare[i], rz: s.rz + flare[i] }));
    kit.loft(st, {
      rings: 7, sides: 14, start: null, end: 'round', capDepth: 0.014, color, bind: bd,
      warp: (p, a, u) => {
        p[1] -= 0.06 * jag(a, 5, side + 4) * (1 - smoothstep(0, 0.12, u));
      },
      paint: gradY(D.shoulderY - D.upper - D.fore, D.shoulderY, 0.82, 1),
    });
  }
}

/** Long thin hands: a narrow palm, four fingers that curl forward at the tips, a thumb. */
function hands(E) {
  const { kit, D, pal, bind } = E;
  for (const side of [1, -1]) {
    const z = side * D.shoulderZ;
    const w = D.shoulderY - 0.02 - D.upper - D.fore;
    const bd = bind.arm[side];
    kit.loft([vs(w + 0.012, 0.02, 0.026, 0.003, z), vs(w - 0.035, 0.024, 0.032, 0.006, z), vs(w - 0.062, 0.018, 0.03, 0.008, z)],
      { rings: 5, start: null, sides: 8, capDepth: 0.012, color: pal.skin, bind: bd });
    const fingers = [[-0.024, 0.105], [-0.008, 0.125], [0.008, 0.118], [0.024, 0.09]];
    for (const [dz, len] of fingers) {
      const zz = z + side * dz;
      const spread = side * dz * 0.7;
      kit.loft([
        ps(0.006, w - 0.06, zz, 0.0085, 0.0085),
        ps(0.012, w - 0.06 - len * 0.45, zz + spread * 0.5, 0.0072, 0.0072),
        ps(0.026, w - 0.06 - len * 0.82, zz + spread, 0.0055, 0.0055),
        ps(0.044, w - 0.06 - len, zz + spread * 1.2, 0.0032, 0.0032),
      ], { ref: [0, 0, 1], sides: 5, rings: 5, start: null, end: 'round', capRings: 2, capDepth: 0.006, color: pal.skin, bind: bd });
    }
    kit.loft([ps(0.026, w - 0.014, z + side * 0.018, 0.011), ps(0.044, w - 0.05, z + side * 0.012, 0.008), ps(0.062, w - 0.072, z + side * 0.008, 0.004)],
      { ref: [0, 0, 1], sides: 6, end: 'round', capRings: 2, capDepth: 0.006, color: pal.skin, bind: bd });
  }
}

// ---------------------------------------------------------------------------
// the head
// ---------------------------------------------------------------------------

/**
 * A cloth that falls from the crown over the back of the head and shoulders, open at the face: a deep hood, a long veil.
 * prof: [v (0 crown .. 1 hem), radius about the head, drop from the face's height]; arcAt(v): the half angle of the opening
 * at the front; drag: how far the cloth sags behind; peak: how far the crown is drawn up and back into a point.
 */
function cowl(E, { color, inner, prof, arcAt, drag, thick = 0.008, alpha = 1, peak = 0 }) {
  const { kit, D, bind } = E;
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const at = (v) => {
    const t = clamp(v) * (prof.length - 1);
    const i = Math.min(prof.length - 2, Math.floor(t));
    const f = t - i;
    return [lerp(prof[i][1], prof[i + 1][1], f), lerp(prof[i][2], prof[i + 1][2], f)];
  };
  const fn = (u, v, out) => {
    const arc = arcAt(v);
    const a = lerp(arc, TAU - arc, u);
    const [r, dy] = at(v);
    const back = Math.exp(-(((Math.abs(wrap(a)) - PI) / 0.55) ** 2));
    const rr = r * hs + 0.012 * hs * Math.min(1, v * 5);
    const tip = peak * (1 - v) ** 2.5;
    out[0] = hx + Math.cos(a) * rr * 1.02 - back * drag * hs * smoothstep(0.35, 1, v) - tip * hs;
    out[1] = hy + dy * hs - back * 0.012 * hs * smoothstep(0.5, 1, v) + tip * 0.6 * hs;
    out[2] = Math.sin(a) * rr * (0.94 + 0.1 * v);
  };
  kit.sheet(16, 12, fn, {
    thick: thick * hs, color, inner, bind: (x, y, z, S) => bind.neck(x, y, z, S),
    paint: paints(gradY(hy - 0.5, hy + 0.1, 0.78, 1.04), (o, x, y) => {
      o.alpha *= lerp(alpha, 1, smoothstep(hy - 0.5, hy - 0.05, y));
    }),
  });
}

/** Long hair that streams down the back, its ends gone thin and faint. */
function hairStrands(E) {
  const { kit, D, pal, bind } = E;
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const f = ((i + 0.5) / n) * 2 - 1;
    const z0 = f * 0.075 * hs;
    const len = 0.44 + 0.16 * hash(i, 3, 4) + 0.08 * (1 - Math.abs(f));
    const st = [];
    const m = 7;
    for (let j = 0; j <= m; j++) {
      const k = j / m;
      st.push(ps(
        hx - (0.05 + 0.12 * k + 0.02 * Math.sin(k * 3 + i)) * hs,
        hy + 0.02 * hs - k * len,
        z0 * (1 + 0.9 * k) + 0.022 * Math.sin(k * 5 + i * 1.7) * k,
        0.015 * (1 - 0.8 * k), 0.006,
      ));
    }
    kit.loft(st, {
      ref: [0, 0, 1], rings: 8, sides: 6, start: 'round', end: 'round', capRings: 2, capDepth: 0.01, color: i % 2 ? shadeC(pal.hair, 0.92) : pal.hair, mat: 'hair', bind: bind.hair,
      paint: (o, x, y, z, u) => {
        o.alpha *= lerp(1, 0.1, smoothstep(0.35, 1, u));
      },
    });
  }
}

/** A thin circlet about the brow. */
function circlet(E) {
  const { kit, D, pal, bind } = E;
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const g = 0.014 * hs;
  kit.loft([vs(hy + 0.04 * hs, 0.1 * hs + g, 0.088 * hs + g, hx), vs(hy + 0.056 * hs, 0.102 * hs + g, 0.09 * hs + g, hx - 0.002 * hs)],
    { sides: 18, start: null, end: null, color: pal.accentMetal, bind: bind.head });
  kit.loft([ps(hx + 0.108 * hs, hy + 0.05 * hs, 0, 0.012 * hs, 0.009 * hs), ps(hx + 0.118 * hs, hy + 0.05 * hs, 0, 0.008 * hs, 0.006 * hs)],
    { ref: [0, 1, 0], sides: 6, capDepth: 0.005, color: pal.glow, glow: 0.7, bind: bind.head });
}

const HOOD = [
  [0.0, 0.0, 0.145], [0.1, 0.06, 0.138], [0.22, 0.1, 0.116], [0.36, 0.125, 0.08], [0.5, 0.135, 0.03],
  [0.68, 0.14, -0.06], [0.85, 0.16, -0.135], [1.0, 0.205, -0.2],
];
const VEIL = [
  [0.0, 0.0, 0.14], [0.08, 0.06, 0.132], [0.18, 0.1, 0.11], [0.3, 0.118, 0.07], [0.42, 0.126, 0.02],
  [0.55, 0.14, -0.07], [0.72, 0.175, -0.22], [0.88, 0.225, -0.4], [1.0, 0.26, -0.56],
];

function head(E) {
  const { v, pal, kit, D, bind } = E;
  if (v.headgear === 'hood') {
    cowl(E, { color: pal.secondary, inner: shadeC(pal.secondary, 0.45), prof: HOOD, arcAt: (t) => 0.6 * smoothstep(0.34, 0.54, t), drag: 0.09, thick: 0.01, peak: 0.08 });
    return;
  }
  addHairCap(kit, D, pal, bind);
  if (E.ex.has('long_hair')) hairStrands(E);
  if (v.headgear === 'veil') {
    cowl(E, { color: mixC(pal.primary, pal.secondary, 0.55), inner: shadeC(pal.secondary, 0.6), prof: VEIL, arcAt: (t) => lerp(0.95, 1.9, smoothstep(0.4, 0.85, t)), drag: 0.1, thick: 0.004, alpha: 0.7 });
    circlet(E);
  }
}

/** Hollow eyes with a light burning in each, and a mouth (a wail, when the spirit has a veil). */
function face(E) {
  const { kit, D, pal, bind, v } = E;
  const hs = D.hs;
  const hy = D.headCY;
  const wail = v.headgear === 'veil';
  const hollow = shadeC(pal.skin, 0.2);
  const eye = pal.eyeGlow || pal.glow;
  const slant = wail ? -0.3 : 0.5;
  return (faceX) => {
    for (const side of [1, -1]) {
      const z = side * 0.041 * hs;
      const tilt = (p) => {
        p[1] += slant * side * (p[2] - z) * 0.5;
      };
      kit.loft([ps(faceX(z) - 0.014 * hs, hy + 0.012 * hs, z, 0.021 * hs, 0.026 * hs), ps(faceX(z) - 0.0015 * hs, hy + 0.012 * hs, z, 0.0195 * hs, 0.024 * hs)],
        { ref: [0, 1, 0], sides: 10, capDepth: 0.006 * hs, color: hollow, bind: bind.head, warp: tilt });
      kit.loft([ps(faceX(z) - 0.008 * hs, hy + 0.011 * hs, z, 0.0105 * hs, 0.0165 * hs), ps(faceX(z) + 0.0015 * hs, hy + 0.011 * hs, z, 0.009 * hs, 0.014 * hs)],
        { ref: [0, 1, 0], sides: 8, capDepth: 0.004 * hs, color: eye, mat: 'gloss', glow: 1, bind: bind.head, warp: tilt });
    }
    const mouth = shadeC(pal.skin, 0.12);
    if (wail) {
      kit.loft([ps(faceX(0) - 0.012 * hs, hy - 0.056 * hs, 0, 0.026 * hs, 0.017 * hs), ps(faceX(0) + 0.0005 * hs, hy - 0.058 * hs, 0, 0.022 * hs, 0.014 * hs)],
        { ref: [0, 1, 0], sides: 10, capDepth: 0.006 * hs, color: mouth, bind: bind.head });
    } else {
      kit.loft([ps(faceX(-0.034 * hs) - 0.004 * hs, hy - 0.063 * hs, -0.034 * hs, 0.004 * hs, 0.004 * hs), ps(faceX(0) - 0.001 * hs, hy - 0.054 * hs, 0, 0.0055 * hs, 0.004 * hs), ps(faceX(0.034 * hs) - 0.004 * hs, hy - 0.063 * hs, 0.034 * hs, 0.004 * hs, 0.004 * hs)],
        { ref: [1, 0, 0], rings: 5, sides: 6, capDepth: 0.003 * hs, color: mouth, bind: bind.head });
    }
  };
}

// ---------------------------------------------------------------------------
// the outfit
// ---------------------------------------------------------------------------

/**
 * A spirit's colors brought into the range where the shape reads: a pale one down to where sun and bloom do not burn it out to
 * white (the Banshee's gown is nearly white to begin with: nothing brighter than a pale grey), a dark one up toward its skin
 * (the Shade's hood is nearly black and, seen from above in a low sun, a flat black blob).
 */
function palette(pal) {
  const cap = (c, max) => {
    const l = lumaC(c);
    return l > max ? shadeC(c, (max / l) ** 2.2) : c;
  };
  const skin = cap(pal.skin, 0.78);
  const ls = lumaC(skin);
  const lift = (c, min) => {
    const l = lumaC(c);
    return l < min && ls > l ? mixC(c, skin, Math.min(0.6, (min - l) / (ls - l))) : c;
  };
  return {
    ...pal,
    skin,
    primary: lift(cap(pal.primary, 0.68), 0.37),
    secondary: lift(cap(pal.secondary, 0.7), 0.29),
    hair: cap(pal.hair, 0.74),
    accentMetal: cap(pal.accentMetal, 0.76),
  };
}

/** The skin of a spirit: more solid than its cloth, and under a deep hood darker toward the brow and the sides of the face. */
function skinPaint(E) {
  const { D, v } = E;
  const hs = D.hs;
  const hy = D.headCY;
  const hooded = v.headgear === 'hood';
  return (o, x, y, z) => {
    o.alpha = 1.35;
    if (hooded) mul(o, lerp(0.6, 1, smoothstep(hy + 0.09 * hs, hy - 0.05 * hs, y)) * lerp(0.72, 1, smoothstep(0.085 * hs, 0.035 * hs, Math.abs(z))));
  };
}

/** The layers of a spirit's dress (rich-outfit-default.js LAYERS): the same for every spirit, colored by its palette. */
export const SPIRIT = {
  legs: shroud,
  torso: robe,
  arms: (E) => sleeves(E, { color: E.v.headgear === 'hood' ? E.pal.secondary : E.pal.primary }),
  armor: () => {},
  cloaks: (E) => mantle(E, E.v.headgear === 'hood' ? { color: E.pal.secondary } : { color: shadeC(E.pal.secondary, 0.82), long: 0.55 }),
  head,
  extras: () => {},
  hands,
  face,
  skinPaint,
  palette,
};

/**
 * Make the body translucent once it is built: every vertex takes the alpha the paints gave it (faint hem, faint tips of the
 * hair; a paint may ask for more than 1, as the skin does, to be more solid than the cloth) times BODY_ALPHA, except those
 * that glow strongly (the eyes), which stay solid; the rest gives off a faint light of its own. The ghost material draws it with that alpha.
 */
export function ghostly(kit) {
  for (let i = 0; i < kit.count; i++) {
    const glow = kit.fx[i * 4 + 1];
    if (glow >= SOLID_GLOW) {
      kit.alpha[i] = 1;
    } else {
      kit.alpha[i] = Math.min(1, kit.alpha[i] * BODY_ALPHA);
      kit.fx[i * 4 + 1] = Math.max(glow, BASE_GLOW);
    }
  }
  kit.fade = true;
}
