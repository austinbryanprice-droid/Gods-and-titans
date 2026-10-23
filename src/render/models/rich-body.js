// The rich humanoid's body (rich-humanoid.js assembles it, the pantheon outfits dress it): the
// dimensions of a build, the skin weights that bind meshes to the 23 bones, and the smooth body
// parts themselves (head and face, neck, hands, boots) plus the station lists the garments
// follow so a sleeve, tunic or greave hugs the limb it covers.
import { PROFILES } from './unit-bodies.js';
import { vs, ps, B, chain, rigid, mixBind, smoothstep } from './rich-kit.js';
import { clamp, lerp, gradY } from './rich-paint.js';

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

export function faceWarp(D) {
  const hs = D.hs;
  const hy = D.headCY;
  return (p, a) => {
    const aa = wrap(a);
    const front = Math.max(0, Math.cos(aa));
    const y = p[1];
    // nose
    const nose = Math.exp(-((aa / 0.3) ** 2)) * Math.exp(-(((y - (hy - 0.016 * hs)) / (0.024 * hs)) ** 2));
    p[0] += 0.024 * hs * nose;
    // brow ridge
    p[0] += 0.009 * hs * front * front * Math.exp(-(((y - (hy + 0.03 * hs)) / (0.014 * hs)) ** 2));
    // eye sockets
    p[0] -= 0.006 * hs * Math.exp(-(((Math.abs(aa) - 0.42) / 0.16) ** 2)) * Math.exp(-(((y - (hy + 0.008 * hs)) / (0.014 * hs)) ** 2));
    // cheekbones
    p[0] += 0.003 * hs * Math.exp(-(((Math.abs(aa) - 0.95) / 0.3) ** 2)) * Math.exp(-(((y - (hy - 0.028 * hs)) / (0.02 * hs)) ** 2));
  };
}

export function addHeadAndNeck(kit, D, pal, ctx, bind, skinPaint = null) {
  const hs = D.hs;
  const hx = D.headX;
  const hy = D.headCY;
  const st = [
    vs(hy - 0.1 * hs, 0.046 * hs, 0.04 * hs, hx + 0.03 * hs),
    vs(hy - 0.082 * hs, 0.072 * hs, 0.064 * hs, hx + 0.02 * hs),
    vs(hy - 0.05 * hs, 0.092 * hs, 0.08 * hs, hx + 0.006 * hs),
    vs(hy - 0.008 * hs, 0.1 * hs, 0.088 * hs, hx),
    vs(hy + 0.035 * hs, 0.102 * hs, 0.09 * hs, hx - 0.002 * hs),
    vs(hy + 0.072 * hs, 0.095 * hs, 0.084 * hs, hx - 0.004 * hs),
    vs(hy + 0.1 * hs, 0.072 * hs, 0.066 * hs, hx - 0.006 * hs),
    vs(hy + 0.112 * hs, 0.04 * hs, 0.04 * hs, hx - 0.007 * hs),
  ];
  const skin = pal.skin;
  kit.loft(st, { rings: 12, capDepth: [0.012 * hs, 0.02 * hs], warp: faceWarp(D), color: skin, bind: bind.head, paint: skinPaint });
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
  for (const side of [1, -1]) {
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
