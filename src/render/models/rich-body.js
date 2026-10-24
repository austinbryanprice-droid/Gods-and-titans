// The rich humanoid's body (rich-humanoid.js assembles it, the pantheon outfits dress it): the
// dimensions of a build, the skin weights that bind meshes to the 23 bones, and the smooth body
// parts themselves (head and face, neck, hands, boots) plus the station lists the garments
// follow so a sleeve, tunic or greave hugs the limb it covers.
import { PROFILES } from './unit-bodies.js';
import { shadeC, mixC } from './unit-geo.js';
import { vs, ps, B, chain, rigid, mixBind, smoothstep } from './rich-kit.js';
import { clamp, lerp, gradY, mul } from './rich-paint.js';
import { BEAST_HEADS, addBeastHead } from './rich-heads.js';

const PI = Math.PI;
const TAU = PI * 2;
const wrap = (a) => (a > PI ? a - TAU : a);

/** Molten crust: dark skin broken by glowing veins (vertex color and self-glow). */
export function lavaSkin(pal) {
  const crust = pal.skin;
  const vein = pal.fire;
  const hot = pal.fireHot;
  return (o, x, y, z) => {
    const a = Math.sin(x * 15 + Math.sin(y * 9 + z * 7) * 1.7 + 0.3);
    const b = Math.sin(y * 12 + Math.sin(z * 13 + x * 6) * 1.5 + 1.1);
    const c = Math.sin(z * 14 + Math.sin(x * 8 + y * 11) * 1.6 + 2.0);
    const d = Math.min(Math.abs(a), Math.abs(b), Math.abs(c));
    const v = 1 - smoothstep(0.03, 0.24, d);
    const h = v * v;
    o.r = lerp(crust.r, lerp(vein.r, hot.r, h * 0.7), v);
    o.g = lerp(crust.g, lerp(vein.g, hot.g, h * 0.7), v);
    o.b = lerp(crust.b, lerp(vein.b, hot.b, h * 0.7), v);
    o.glow = 0.9 * v;
  };
}

// ---------------------------------------------------------------------------
// dimensions
// ---------------------------------------------------------------------------

export function richDims(ctx, name) {
  const P = { ...PROFILES[name] };
  if (ctx.grand && name === 'humanoid') {
    P.chestW *= 1.08;
    P.weaponSize = 1.15;
  }
  const hs = P.headR / 0.122;
  return {
    ...P,
    name,
    hs,
    k: P.chestW / 0.36,
    headRad: 0.105 * hs,
    headCY: P.headY, // center of the face
    headPivot: P.headY - 0.07 * hs, // base of the skull: the head bone
    neckY: P.shoulderY + 0.025,
    ankleY: P.footH + 0.014,
  };
}

// ---------------------------------------------------------------------------
// skin binds
// ---------------------------------------------------------------------------

export const UP = [0, 1, 0];
export const DOWN = [0, -1, 0];

export function makeBinds(spec, D) {
  const pos = spec.pos;
  const j = (bone, dir, hw) => ({ at: pos[bone], dir, hw });
  const K = D.k;
  const bind = {
    torso: chain([B.pelvis, B.spine, B.chest], [j(B.spine, UP, 0.06 * K), j(B.chest, UP, 0.06 * K)]),
    neck: chain([B.chest, B.neck, B.head], [j(B.neck, UP, 0.04), j(B.head, UP, 0.05)]),
    head: rigid(B.head),
    arm: {},
    leg: {},
    thigh: {},
    chest: rigid(B.chest),
  };
  const hip = pos[B.thighR][1];
  for (const side of [1, -1]) {
    const R = side > 0;
    const upper = R ? B.upperR : B.upperL;
    const fore = R ? B.foreR : B.foreL;
    const hand = R ? B.handR : B.handL;
    const shY = pos[upper][1];
    const arm = chain([upper, fore, hand], [j(fore, DOWN, 0.035), j(hand, DOWN, 0.02)]);
    bind.arm[side] = mixBind(arm, rigid(B.chest), (x, y) => smoothstep(shY + 0.0, shY + 0.07 * K, y));
    const thigh = R ? B.thighR : B.thighL;
    const shin = R ? B.shinR : B.shinL;
    const foot = R ? B.footR : B.footL;
    const leg = chain([foot, shin, thigh], [j(foot, UP, 0.03), j(shin, UP, 0.045)]);
    bind.leg[side] = mixBind(leg, rigid(B.pelvis), (x, y) => smoothstep(hip - 0.01, hip + 0.07, y));
    bind.thigh[side] = rigid(thigh);
  }
  // skirts and robes follow the legs a little more toward the hem
  const skirt = (x, y, z, S) => {
    const t = clamp((hip + 0.02 - y) / 0.4);
    const k = 0.55 * t;
    const sgn = smoothstep(-0.07, 0.07, z);
    S.add(B.pelvis, 1 - k);
    S.add(B.thighR, k * sgn);
    S.add(B.thighL, k * (1 - sgn));
  };
  bind.skirt = mixBind(skirt, bind.torso, (x, y) => smoothstep(hip + 0.02, hip + 0.1, y));
  // a cape hangs from the shoulders: chest, then the three cape bones by height
  const sh = D.shoulderY;
  bind.cape = chain([B.chest, B.cape1, B.cape2, B.cape3], [j(B.cape1, DOWN, 0.04), j(B.cape2, DOWN, 0.07), j(B.cape3, DOWN, 0.07)]);
  bind.hair = chain([B.head, B.hair1, B.hair2], [j(B.hair1, DOWN, 0.03), j(B.hair2, DOWN, 0.05)]);
  bind.shoulderY = sh;
  return bind;
}

// ---------------------------------------------------------------------------
// body parts
// ---------------------------------------------------------------------------

/** Torso stations (hip to neck base); `grow` thickens them for clothing layers. */
export function torsoStations(D, grow = 0, from = -0.11) {
  const y = (f) => D.hipY + (D.shoulderY - D.hipY) * f;
  const g = grow;
  const st = [
    vs(y(-0.11), D.depth * 0.56 + g, D.waistW * 0.6 + g),
    vs(y(0.0), D.depth * 0.52 + g, D.waistW * 0.56 + g),
    vs(y(0.22), D.depth * 0.5 + g, D.waistW * 0.5 + g),
    vs(y(0.5), D.chestD * 0.46 + g, D.chestW * 0.43 + g, 0.004),
    vs(y(0.74), D.chestD * 0.5 + g, D.chestW * 0.5 + g, 0.008),
    vs(y(0.93), D.chestD * 0.42 + g, D.chestW * 0.46 + g, 0.004),
    vs(y(1.03), D.chestD * 0.3 + g * 0.6, D.chestW * 0.3 + g * 0.6),
    vs(y(1.09), 0.056 * D.k + g * 0.3, 0.06 * D.k + g * 0.3),
  ];
  return from === -0.11 ? st : st.filter((s) => s.c[1] >= y(from) - 1e-6);
}

/** Leg stations from the ankle up to the top of the thigh. */
export function legStations(D, side, g = 0) {
  const r = D.legR;
  const z = side * D.hipZ;
  const knee = D.hipY - D.thigh;
  const a = D.ankleY;
  return [
    vs(a, r * 0.66 + g, r * 0.62 + g, 0, z),
    vs(a + 0.05, r * 0.72 + g, r * 0.7 + g, -0.004, z),
    vs(lerp(a, knee, 0.45), r * 0.92 + g, r * 0.9 + g, -0.006, z),
    vs(knee, r * 0.84 + g, r * 0.82 + g, 0.004, z),
    vs(knee + D.thigh * 0.35, r * 1.06 + g, r * 1.02 + g, 0.002, z),
    vs(D.hipY - 0.03, r * 1.22 + g, r * 1.15 + g, 0, z),
    vs(D.hipY + 0.04, r * 1.28 + g, r * 1.18 + g, 0, z),
  ];
}

/** Height of the top of the boot shaft. */
export const bootTop = (D) => D.ankleY + (D.hipY - D.thigh - D.ankleY) * 0.55;

/** Leg stations from height y0 up (the first one interpolated): trousers that start inside a boot cuff. */
export function legFrom(D, side, g, y0) {
  const st = legStations(D, side, g);
  const out = [];
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i];
    const b = st[i + 1];
    if (b.c[1] <= y0) continue;
    if (!out.length) {
      const t = clamp((y0 - a.c[1]) / (b.c[1] - a.c[1]));
      out.push({ c: [lerp(a.c[0], b.c[0], t), y0, lerp(a.c[2], b.c[2], t)], rx: lerp(a.rx, b.rx, t), rz: lerp(a.rz, b.rz, t), n: 2 });
    }
    out.push(b);
  }
  return out;
}

/** The leg's ring at height y (between the leg stations), clearance g: the base of greaves, straps and anklets. */
export function legRing(D, side, y, g = 0) {
  const st = legStations(D, side, g);
  const z = side * D.hipZ;
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i];
    const b = st[i + 1];
    if (y <= b.c[1] || i + 2 === st.length) {
      const t = clamp((y - a.c[1]) / (b.c[1] - a.c[1] || 1e-9));
      return vs(y, lerp(a.rx, b.rx, t), lerp(a.rz, b.rz, t), lerp(a.c[0], b.c[0], t), z);
    }
  }
  return st[0];
}

/** Arm stations from the wrist up over the shoulder. */
export function armStations(D, side, g = 0, from = 'wrist') {
  const sh = D.shoulderY - 0.02;
  const z = side * D.shoulderZ;
  const r = D.armR;
  const wrist = sh - D.upper - D.fore;
  const elbow = sh - D.upper;
  const st = [
    vs(wrist, r * 0.62 + g, r * 0.6 + g, 0, z),
    vs(wrist + D.fore * 0.38, r * 0.82 + g, r * 0.8 + g, 0.002, z),
    vs(elbow, r * 0.9 + g, r * 0.88 + g, 0, z),
    vs(elbow + D.upper * 0.5, r * 1.06 + g, r * 1.04 + g, 0, z),
    vs(sh - 0.012, r * 1.1 + g, r * 1.06 + g, 0, z),
    vs(sh + 0.016, r * 0.95 + g, r * 0.9 + g, 0, z),
  ];
  return from === 'elbow' ? st.slice(2) : st;
}

export function faceWarp(D, cyclops = false) {
  const hs = D.hs;
  const hy = D.headCY;
  return (p, a) => {
    const aa = wrap(a);
    const front = Math.max(0, Math.cos(aa));
    const y = p[1];
    // nose
    const nose = Math.exp(-((aa / 0.3) ** 2)) * Math.exp(-(((y - (hy - 0.016 * hs)) / (0.024 * hs)) ** 2));
    p[0] += 0.024 * hs * nose;
    if (cyclops) {
      // one heavy brow across the forehead, one deep socket under it
      p[0] += 0.016 * hs * front * front * Math.exp(-(((y - (hy + 0.05 * hs)) / (0.016 * hs)) ** 2));
      p[0] -= 0.008 * hs * Math.exp(-((aa / 0.34) ** 2)) * Math.exp(-(((y - (hy + 0.02 * hs)) / (0.03 * hs)) ** 2));
    } else {
      // brow ridge
      p[0] += 0.009 * hs * front * front * Math.exp(-(((y - (hy + 0.03 * hs)) / (0.014 * hs)) ** 2));
      // eye sockets
      p[0] -= 0.006 * hs * Math.exp(-(((Math.abs(aa) - 0.42) / 0.16) ** 2)) * Math.exp(-(((y - (hy + 0.008 * hs)) / (0.014 * hs)) ** 2));
    }
    // cheekbones
    p[0] += 0.003 * hs * Math.exp(-(((Math.abs(aa) - 0.95) / 0.3) ** 2)) * Math.exp(-(((y - (hy - 0.028 * hs)) / (0.02 * hs)) ** 2));
  };
}

/**
 * The one great eye of a Cyclops, in the middle of the brow (fx: the face surface in front of
 * the head's middle): a bulging white, a dark ringed iris, a black pupil, a heavy lid and brow.
 * glowColor: a burning eye (the whole eye takes the color).
 */
function addCyclopsEye(kit, D, pal, bind, fx, glowColor = null) {
  const hs = D.hs;
  const ey = D.headCY + 0.022 * hs;
  const white = glowColor || pal.eyeWhite;
  const g = glowColor ? 0.9 : 0.1;
  kit.loft([ps(fx - 0.02 * hs, ey, 0, 0.029 * hs, 0.036 * hs), ps(fx - 0.004 * hs, ey, 0, 0.028 * hs, 0.035 * hs), ps(fx + 0.004 * hs, ey, 0, 0.024 * hs, 0.03 * hs)],
    { ref: [0, 1, 0], rings: 4, sides: 16, start: null, end: 'round', capDepth: 0.007 * hs, color: white, mat: 'gloss', glow: g, bind: bind.head });
  const iris = glowColor ? pal.glow : mixC(pal.eye, '#8a5a1e', 0.55);
  kit.loft([ps(fx - 0.002 * hs, ey - 0.001 * hs, 0, 0.018 * hs, 0.018 * hs), ps(fx + 0.0065 * hs, ey - 0.001 * hs, 0, 0.0165 * hs, 0.0165 * hs)],
    { ref: [0, 1, 0], sides: 14, start: null, end: 'round', capDepth: 0.003 * hs, color: iris, mat: 'gloss', glow: glowColor ? 1 : 0, bind: bind.head });
  kit.loft([ps(fx + 0.0065 * hs, ey - 0.001 * hs, 0, 0.009 * hs, 0.009 * hs), ps(fx + 0.0092 * hs, ey - 0.001 * hs, 0, 0.0082 * hs, 0.0082 * hs)],
    { ref: [0, 1, 0], sides: 12, start: null, end: 'round', capDepth: 0.002 * hs, color: pal.eye, mat: 'gloss', bind: bind.head });
  // the upper lid, and a single heavy brow of the hair color across the forehead
  kit.loft([ps(fx - 0.006 * hs, ey + 0.03 * hs, -0.04 * hs, 0.009 * hs, 0.012 * hs), ps(fx - 0.002 * hs, ey + 0.036 * hs, 0, 0.01 * hs, 0.012 * hs), ps(fx - 0.006 * hs, ey + 0.03 * hs, 0.04 * hs, 0.009 * hs, 0.012 * hs)],
    { ref: [1, 0, 0], rings: 6, sides: 8, start: 'round', end: 'round', capDepth: 0.008 * hs, color: shadeC(pal.skin, 0.82), mat: 'skin', bind: bind.head });
  kit.loft([
    ps(fx + 0.0 * hs, ey + 0.05 * hs, -0.082 * hs, 0.011 * hs, 0.012 * hs),
    ps(fx + 0.012 * hs, ey + 0.056 * hs, -0.04 * hs, 0.012 * hs, 0.012 * hs),
    ps(fx + 0.016 * hs, ey + 0.058 * hs, 0, 0.0125 * hs, 0.0125 * hs),
    ps(fx + 0.012 * hs, ey + 0.056 * hs, 0.04 * hs, 0.012 * hs, 0.012 * hs),
    ps(fx + 0.0 * hs, ey + 0.05 * hs, 0.082 * hs, 0.011 * hs, 0.012 * hs),
  ], { ref: [1, 0, 0], rings: 8, sides: 8, start: 'round', end: 'round', capDepth: 0.01 * hs, color: pal.hair, mat: 'hair', bind: bind.head });
}

/** The stations of the human head (chin to crown), which hoods, wraps and caps are built over. */
export function headStations(D) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  return [
    vs(hy - 0.1 * hs, 0.046 * hs, 0.04 * hs, hx + 0.03 * hs),
    vs(hy - 0.082 * hs, 0.072 * hs, 0.064 * hs, hx + 0.02 * hs),
    vs(hy - 0.05 * hs, 0.092 * hs, 0.08 * hs, hx + 0.006 * hs),
    vs(hy - 0.008 * hs, 0.1 * hs, 0.088 * hs, hx),
    vs(hy + 0.035 * hs, 0.102 * hs, 0.09 * hs, hx - 0.002 * hs),
    vs(hy + 0.072 * hs, 0.095 * hs, 0.084 * hs, hx - 0.004 * hs),
    vs(hy + 0.1 * hs, 0.072 * hs, 0.066 * hs, hx - 0.006 * hs),
    vs(hy + 0.112 * hs, 0.04 * hs, 0.04 * hs, hx - 0.007 * hs),
  ];
}

export function addHeadAndNeck(kit, D, pal, ctx, bind, skinPaint = null) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const st = headStations(D);
  const skin = pal.skin;
  if (BEAST_HEADS.has(ctx.v.head)) addBeastHead(kit, D, pal, ctx, bind, skinPaint);
  else {
    // a giant with a third eye is a Cyclops: one great eye in the middle of the forehead
    const cyclops = ctx.v.body === 'giant' && ctx.v.extras.includes('third_eye');
    kit.loft(st, { rings: 12, capDepth: [0.012 * hs, 0.02 * hs], warp: faceWarp(D, cyclops), color: skin, bind: bind.head, paint: skinPaint });
    // ears
    for (const side of [1, -1]) {
      kit.loft([ps(hx - 0.004 * hs, hy - 0.004 * hs, side * 0.082 * hs, 0.017 * hs, 0.027 * hs), ps(hx - 0.004 * hs, hy - 0.004 * hs, side * 0.103 * hs, 0.012 * hs, 0.022 * hs)],
        { ref: [1, 0, 0], sides: 8, capDepth: 0.006 * hs, color: skin, bind: bind.head });
    }
    // the face surface in front of a point: the head ellipse at brow height, plus the brow ridge
    const faceX = (z) => hx - 0.002 * hs + 0.102 * hs * Math.sqrt(Math.max(0, 1 - (z / (0.09 * hs)) ** 2));
    // eyes: dark, slightly glossy, set well apart in their sockets
    const eye = ctx.v.extras.includes('eye_glow') && pal.eyeGlow ? pal.eyeGlow : pal.eye;
    const glow = ctx.v.extras.includes('eye_glow') ? 1 : 0;
    if (cyclops) addCyclopsEye(kit, D, pal, bind, faceX(0), glow ? pal.eyeGlow : null);
    else for (const side of [1, -1]) {
      const z = side * 0.041 * hs;
      kit.loft([ps(faceX(z) - 0.012 * hs, hy + 0.012 * hs, z, 0.011 * hs, 0.0155 * hs), ps(faceX(z) - 0.0015 * hs, hy + 0.012 * hs, z, 0.0095 * hs, 0.013 * hs)],
        { ref: [0, 1, 0], sides: 8, capDepth: 0.004 * hs, color: eye, mat: 'gloss', glow, bind: bind.head });
      // brow: a short arched bar of the hair color, rising toward the temple
      kit.loft([
        ps(faceX(side * 0.018 * hs) + 0.004 * hs, hy + 0.039 * hs, side * 0.018 * hs, 0.005 * hs, 0.0055 * hs),
        ps(faceX(side * 0.042 * hs) + 0.006 * hs, hy + 0.043 * hs, side * 0.042 * hs, 0.0055 * hs, 0.0058 * hs),
        ps(faceX(side * 0.066 * hs) + 0.004 * hs, hy + 0.036 * hs, side * 0.066 * hs, 0.004 * hs, 0.0045 * hs),
      ], { ref: [1, 0, 0], rings: 5, sides: 6, capDepth: 0.004 * hs, color: pal.hair, mat: 'hair', bind: bind.head });
    }
    // a thin mouth under the nose (a beard, where there is one, covers it)
    if (!ctx.v.extras.includes('beard')) {
      kit.loft([
        ps(faceX(-0.03 * hs) - 0.004 * hs, hy - 0.052 * hs, -0.03 * hs, 0.004 * hs, 0.004 * hs),
        ps(faceX(0) - 0.001 * hs, hy - 0.054 * hs, 0, 0.0045 * hs, 0.004 * hs),
        ps(faceX(0.03 * hs) - 0.004 * hs, hy - 0.052 * hs, 0.03 * hs, 0.004 * hs, 0.004 * hs),
      ], { ref: [1, 0, 0], rings: 5, sides: 6, capDepth: 0.003 * hs, color: pal.mouth, mat: 'skin', bind: bind.head });
    }
  }
  // neck
  const nk = 0.05 * D.k;
  kit.loft([vs(D.shoulderY - 0.03, nk * 1.3, nk * 1.4, 0), vs(D.shoulderY + 0.01, nk * 1.05, nk * 1.1, D.headX * 0.3), vs(hy - 0.075 * hs, nk * 0.95, nk * 1.0, D.headX * 0.7)],
    { rings: 5, start: null, end: null, color: skin, bind: bind.neck, paint: skinPaint });
}

export function addHands(kit, D, pal, bind, color, skinPaint = null) {
  for (const side of [1, -1]) {
    const z = side * D.shoulderZ;
    const w = D.shoulderY - 0.02 - D.upper - D.fore;
    const r = D.handR / 0.048;
    // palm and fingers: a rounded mitten; the thumb a small tube
    kit.loft([vs(w + 0.012, 0.027 * r, 0.032 * r, 0.003, z), vs(w - 0.03 * r, 0.031 * r, 0.042 * r, 0.006, z), vs(w - 0.068 * r, 0.025 * r, 0.036 * r, 0.008, z)],
      { rings: 6, start: null, capDepth: 0.02 * r, sides: 10, color, bind: bind.arm[side], paint: skinPaint });
    kit.loft([ps(0.026 * r, w - 0.014 * r, z + side * 0.016 * r, 0.011 * r), ps(0.04 * r, w - 0.04 * r, z + side * 0.008 * r, 0.009 * r)],
      { ref: [0, 0, 1], sides: 6, capDepth: 0.008 * r, color, bind: bind.arm[side], paint: skinPaint });
  }
}

export function addBoots(kit, D, pal, bind, color, cuff) {
  const r = D.legR;
  for (const side of [1, -1]) {
    const z = side * D.hipZ;
    const h = D.footH;
    kit.loft([
      ps(-r * 0.8, h * 0.75, z, h * 0.75, r * 0.8),
      ps(r * 0.25, h * 0.6, z, h * 0.62, r * 0.84),
      ps(r * 1.45, h * 0.5, z, h * 0.5, r * 0.84),
      ps(r * 2.3, h * 0.4, z, h * 0.4, r * 0.72),
    ], { ref: [0, 1, 0], rings: 8, sides: 10, capDepth: h * 0.38, color, mat: 'leather', bind: rigid(side > 0 ? B.footR : B.footL), paint: gradY(0, 0.03, 0.7, 1) });
    // shaft up to the calf, with a folded cuff
    const top = bootTop(D);
    const ls = legStations(D, side, 0.007).filter((s) => s.c[1] <= top + 0.01);
    ls[ls.length - 1] = vs(top, ls[ls.length - 1].rx, ls[ls.length - 1].rz, ls[ls.length - 1].c[0], z);
    kit.loft(ls, { rings: 6, start: null, end: null, color, mat: 'leather', bind: bind.leg[side], paint: gradY(0, 0.14, 0.78, 1) });
    if (cuff) {
      const e = ls[ls.length - 1];
      kit.loft([vs(top - 0.03, e.rx + 0.003, e.rz + 0.003, e.c[0], z), vs(top + 0.012, e.rx + 0.012, e.rz + 0.012, e.c[0], z)],
        { sides: 12, start: null, end: null, color: cuff, mat: 'leather', bind: bind.leg[side] });
    }
  }
}

/**
 * Bare feet in sandals: the foot itself, a flat sole, a strap at the ankle and one across the
 * instep, and `ladder` straps up the shin (laced sandals). opts: skin, skinPaint, strap, sole.
 */
export function addSandals(kit, D, pal, bind, { skin, skinPaint = null, strap, sole, ladder = 0 }) {
  const r = D.legR;
  const h = D.footH;
  for (const side of [1, -1]) {
    const z = side * D.hipZ;
    const foot = rigid(side > 0 ? B.footR : B.footL);
    kit.loft([
      ps(-r * 0.8, h * 0.66, z, h * 0.66, r * 0.78),
      ps(r * 0.25, h * 0.54, z, h * 0.54, r * 0.8),
      ps(r * 1.45, h * 0.42, z, h * 0.42, r * 0.8),
      ps(r * 2.3, h * 0.32, z, h * 0.32, r * 0.68),
    ], { ref: [0, 1, 0], rings: 5, sides: 8, capRings: 2, capDepth: h * 0.34, color: skin, bind: foot, paint: skinPaint });
    kit.loft([
      ps(-r * 0.9, h * 0.11, z, h * 0.11, r * 0.84),
      ps(r * 0.3, h * 0.11, z, h * 0.11, r * 0.88),
      ps(r * 1.7, h * 0.11, z, h * 0.11, r * 0.84),
      ps(r * 2.5, h * 0.1, z, h * 0.1, r * 0.66),
    ], { ref: [0, 1, 0], rings: 4, sides: 8, capRings: 2, capDepth: h * 0.13, color: sole, mat: 'leather', bind: foot });
    const ya = D.ankleY + 0.004;
    kit.loft([legRing(D, side, ya, 0.006), legRing(D, side, ya + 0.018, 0.006)], { sides: 10, start: null, end: null, color: strap, mat: 'leather', bind: bind.leg[side] });
    kit.loft([ps(r * 1.0, h * 0.5, z, h * 0.5 + 0.004, r * 0.8 + 0.004), ps(r * 1.0 + 0.016, h * 0.46, z, h * 0.46 + 0.004, r * 0.8 + 0.004)],
      { ref: [0, 1, 0], sides: 10, start: null, end: null, color: strap, mat: 'leather', bind: foot });
    for (let i = 0; i < ladder; i++) {
      const y = D.ankleY + 0.05 + i * 0.045;
      kit.loft([legRing(D, side, y, 0.005), legRing(D, side, y + 0.016, 0.005)], { sides: 10, start: null, end: null, color: strap, mat: 'leather', bind: bind.leg[side] });
    }
  }
}

/**
 * Geta: a bare foot on a wooden board held by a thong, the board standing on teeth. `ippon` is one tall
 * tooth under the middle of the board (the tengu's), else two low ones. `tooth` is how far the teeth
 * hang below the sole, so a unit that stands on the ground wears them low (0.02) and a flier high.
 * opts: skin, skinPaint, strap (the thong), wood, tooth, ippon.
 */
export function addGeta(kit, D, pal, bind, { skin, skinPaint = null, strap, wood, tooth = 0.02, ippon = false }) {
  const r = D.legR;
  const h = D.footH;
  for (const side of [1, -1]) {
    const z = side * D.hipZ;
    const foot = rigid(side > 0 ? B.footR : B.footL);
    kit.loft([
      ps(-r * 0.8, h * 0.66, z, h * 0.66, r * 0.78),
      ps(r * 0.25, h * 0.54, z, h * 0.54, r * 0.8),
      ps(r * 1.45, h * 0.42, z, h * 0.42, r * 0.8),
      ps(r * 2.3, h * 0.32, z, h * 0.32, r * 0.68),
    ], { ref: [0, 1, 0], rings: 5, sides: 8, capRings: 2, capDepth: h * 0.34, color: skin, bind: foot, paint: skinPaint });
    // the board: longer than the foot, rounded, a little under the sole
    kit.loft([
      ps(-r * 1.0, -0.006, z, 0.009, r * 0.88),
      ps(r * 0.3, -0.006, z, 0.009, r * 0.95),
      ps(r * 1.7, -0.006, z, 0.009, r * 0.9),
      ps(r * 2.6, -0.006, z, 0.009, r * 0.66),
    ], { ref: [0, 1, 0], rings: 4, sides: 10, capRings: 2, capDepth: 0.009, color: wood, mat: 'wood', bind: foot });
    // the teeth: planks across the board
    const plank = (x, w, hgt) => {
      kit.loft([ps(x, -0.012, z, w, r * 0.74, 4), ps(x, -0.012 - hgt * 0.5, z, w * 0.96, r * 0.72, 4), ps(x, -0.012 - hgt, z, w * 0.9, r * 0.68, 4)],
        { ref: [1, 0, 0], sides: 8, start: null, end: 'round', capRings: 1, capDepth: 0.004, color: wood, mat: 'wood', bind: foot, paint: (o, px, py) => mul(o, 0.8 + 0.2 * clamp((py + 0.012 + hgt) / hgt + 0.2)) });
    };
    if (ippon) plank(r * 0.7, 0.014, tooth);
    else {
      plank(r * 0.05, 0.012, tooth);
      plank(r * 1.95, 0.012, tooth);
    }
    // the thong: over the toes and across the instep, and a ring at the board's edge
    kit.loft([ps(r * 2.0, h * 0.3, z, h * 0.3 + 0.003, 0.009), ps(r * 1.05, h * 0.5, z, h * 0.5 + 0.004, r * 0.8 + 0.004)],
      { ref: [0, 1, 0], sides: 6, start: null, end: null, color: strap, mat: 'cloth', bind: foot });
    kit.loft([ps(r * 1.0, h * 0.5, z, h * 0.5 + 0.004, r * 0.8 + 0.004), ps(r * 1.0 + 0.016, h * 0.46, z, h * 0.46 + 0.004, r * 0.8 + 0.004)],
      { ref: [0, 1, 0], sides: 10, start: null, end: null, color: strap, mat: 'cloth', bind: foot });
    const ya = D.ankleY + 0.004;
    kit.loft([legRing(D, side, ya, 0.006), legRing(D, side, ya + 0.016, 0.006)], { sides: 10, start: null, end: null, color: strap, mat: 'cloth', bind: bind.leg[side] });
  }
}

/** The leg of a bare-legged unit: skin from a little below the ankle (so it overlaps the foot) up to the thigh, or only up to `top` under a robe. */
export function addBareLegs(kit, D, bind, skin, skinPaint = null, top = Infinity) {
  const r = D.legR;
  for (const side of [1, -1]) {
    const st = legStations(D, side).filter((s, i) => i < 2 || s.c[1] <= top);
    kit.loft([vs(D.ankleY - 0.03, r * 0.62, r * 0.58, 0, side * D.hipZ), ...st], { rings: 9, start: null, end: top === Infinity ? null : 'round', color: skin, bind: bind.leg[side], paint: skinPaint });
  }
}

/**
 * The ring of a list of stations (ascending in height: a limb's, the head's) at height y, standing off its
 * surface by g: the base of a band, a strap or a wrap that hugs the part.
 */
export function ringAt(st, y, g = 0) {
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i];
    const b = st[i + 1];
    if (y <= b.c[1] || i + 2 === st.length) {
      const t = clamp((y - a.c[1]) / (b.c[1] - a.c[1] || 1e-9));
      return vs(y, lerp(a.rx, b.rx, t) + g, lerp(a.rz, b.rz, t) + g, lerp(a.c[0], b.c[0], t), lerp(a.c[2], b.c[2], t));
    }
  }
  return st[0];
}

/**
 * The torso's ring at height fraction f (0 at the hip, 1 at the shoulder line, up to about 1.09
 * at the neck base), with clearance g: { y, rx, rz, dx }, interpolated between the torso stations so
 * collars, straps and pendants sit on the body without sinking in.
 */
export function torsoRing(D, f, g = 0) {
  const st = torsoStations(D, g);
  const y = D.hipY + (D.shoulderY - D.hipY) * f;
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i];
    const b = st[i + 1];
    if (y <= b.c[1] || i + 2 === st.length) {
      const t = clamp((y - a.c[1]) / (b.c[1] - a.c[1] || 1e-9));
      return { y, rx: lerp(a.rx, b.rx, t), rz: lerp(a.rz, b.rz, t), dx: lerp(a.c[0], b.c[0], t) };
    }
  }
  return { y, rx: st[0].rx, rz: st[0].rz, dx: 0 };
}
