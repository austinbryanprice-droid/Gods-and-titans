// The rich humanoid (High and Ultra): one smooth skinned mesh for the body and its layered
// clothing, armor, hair and headgear (rich-kit.js), plus a few rigid pieces that ride bones:
// the weapon in the hand, the shield on the forearm, worker tools, flames. It reads the same
// `visual` the low-poly bodies read (unit-bodies.js) and the same palette, so a unit keeps
// its colors, team-colored cloth and gear; units whose look it cannot dress yet
// (richSupported) keep the low-poly model.
import * as THREE from 'three';
import { PartBuilder, TEAM, shadeC, mixC, bakeAO } from './unit-geo.js';
import { addWeapon, addOffhand, addTool, WEAPON_INFO, OFFHAND_ELBOW, gripRotation } from './unit-parts.js';
import { PROFILES, unitContext, humanoidItems, holdsAloft } from './unit-bodies.js';
import { MeshKit, humanoidSpec, B, vs, ps, chain, rigid, mixBind, smoothstep } from './rich-kit.js';
import { RICH_WEAPONS, richWeapon, handFrame, finishGear } from './rich-gear.js';

const PI = Math.PI;
const TAU = PI * 2;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => (a > PI ? a - TAU : a);

const RICH_BODIES = new Set(['humanoid', 'giant']);
const IRON = '#37292a'; // forged black iron (a fire giant's armor)
const RICH_HEADGEAR = new Set(['none', 'hood', 'horned_helmet', 'horns']);
const RICH_EXTRAS = new Set(['beard', 'long_hair', 'cape', 'armor', 'fur', 'skirt', 'flames', 'eye_glow']);

/**
 * The pantheons whose units are drawn with the rich characters in play. The Norse are the
 * sample; the builder already dresses supported units of the others, which stay low-poly
 * until each has had its look pass (tools pin it for all with GameRenderer.setUnitDetail('rich')).
 */
export const RICH_PANTHEONS = new Set(['norse']);

/** Whether the rich builder can dress this unit type (else it keeps its low-poly model). */
export function richSupported(unitType) {
  const v = unitType.visual;
  if (!v || !RICH_BODIES.has(v.body || 'humanoid')) return false;
  if ((v.head || 'human') !== 'human' || (v.heads || 1) !== 1) return false;
  if (!RICH_HEADGEAR.has(v.headgear || 'none')) return false;
  return (v.extras || []).every((e) => RICH_EXTRAS.has(e));
}

// ---------------------------------------------------------------------------
// paint helpers (per-vertex color work on top of a primitive's base color)
// ---------------------------------------------------------------------------

const mul = (o, k) => {
  if (o.team) o.team *= k;
  else {
    o.r *= k;
    o.g *= k;
    o.b *= k;
  }
};
/** Brighten / darken by height: k0 at y0 to k1 at y1. */
const gradY = (y0, y1, k0, k1) => (o, x, y) => mul(o, lerp(k0, k1, clamp((y - y0) / (y1 - y0))));
/** Several paints in a row. */
const paints = (...fns) => (o, x, y, z, u, a) => {
  for (const f of fns) if (f) f(o, x, y, z, u, a);
};
/** Cheap deterministic value noise in 3D (for cloth mottling in the vertex colors, fur tufts). */
const hash = (x, y, z) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Molten crust: dark skin broken by glowing veins (vertex color and self-glow). */
function lavaSkin(pal) {
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

function richDims(ctx, name) {
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

const UP = [0, 1, 0];
const DOWN = [0, -1, 0];

function makeBinds(spec, D) {
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
function torsoStations(D, grow = 0, from = -0.11) {
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
function legStations(D, side, g = 0) {
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
const bootTop = (D) => D.ankleY + (D.hipY - D.thigh - D.ankleY) * 0.55;

/** Leg stations from height y0 up (the first one interpolated): trousers that start inside a boot cuff. */
function legFrom(D, side, g, y0) {
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
function armStations(D, side, g = 0, from = 'wrist') {
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

function faceWarp(D) {
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

function addHeadAndNeck(kit, D, pal, ctx, bind, skinPaint = null) {
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

function addHands(kit, D, pal, bind, color, skinPaint = null) {
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

function addBoots(kit, D, pal, bind, color, cuff) {
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

// ---------------------------------------------------------------------------
// clothing and armor
// ---------------------------------------------------------------------------

function addTunic(kit, D, color, bind, hem, opts = {}) {
  const st = torsoStations(D, 0.012);
  const y0 = D.hipY - hem;
  const out = [vs(y0, D.depth * 0.62 + 0.02, D.waistW * 0.66 + 0.02), ...st];
  kit.loft(out, {
    rings: 11, start: null, end: 'round', capDepth: 0.01, color, bind: opts.skirted ? bind.skirt : bind.torso, mat: opts.mat,
    paint: paints(gradY(D.hipY - hem, D.hipY + 0.05, 0.82, 1), opts.paint),
  });
}

function addBelt(kit, D, pal, bind, color = pal.leather, buckle = pal.accentMetal) {
  const y = (f) => D.hipY + (D.shoulderY - D.hipY) * f;
  const g = 0.02;
  kit.loft([vs(y(0.03), D.depth * 0.52 + g, D.waistW * 0.56 + g), vs(y(0.13), D.depth * 0.5 + g, D.waistW * 0.52 + g)],
    { sides: 14, rings: 3, start: null, end: null, color, mat: 'leather', bind: bind.torso });
  // buckle
  kit.loft([ps(D.depth * 0.5 + g + 0.004, y(0.08), 0, 0.022, 0.03), ps(D.depth * 0.5 + g + 0.012, y(0.08), 0, 0.02, 0.026)],
    { ref: [0, 1, 0], sides: 4, capDepth: 0.004, color: buckle, bind: bind.torso, glow: 0 });
}

/** A metal breastplate, with a few lames below it, over the tunic. */
function addCuirass(kit, D, pal, bind, color, trim, trimGlow = 0) {
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

function addPauldrons(kit, D, pal, bind, color, trim, trimGlow = 0) {
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

function addFurMantle(kit, D, pal, bind) {
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

function addCape(kit, D, color, hemColor, lining, bind) {
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

function addHairCap(kit, D, pal, bind) {
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

function addLongHair(kit, D, pal, bind) {
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

function addBeard(kit, D, pal, bind, fiery = false) {
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

function addHood(kit, D, pal, bind, color, trim) {
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

function addHornedHelm(kit, D, pal, bind, steel, trim, horn) {
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
  // nose guard
  kit.loft([ps(hx + 0.095 * hs, hy + 0.045 * hs, 0, 0.007 * hs, 0.011 * hs), ps(hx + 0.108 * hs, hy - 0.002 * hs, 0, 0.007 * hs, 0.011 * hs), ps(hx + 0.108 * hs, hy - 0.042 * hs, 0, 0.007 * hs, 0.013 * hs)],
    { ref: [1, 0, 0], sides: 6, capDepth: 0.006 * hs, color: steel, bind: bind.head });
  // cheek guards hint
  for (const side of [1, -1]) {
    kit.loft([ps(hx + 0.01 * hs, hy - 0.002 * hs, side * 0.094 * hs, 0.05 * hs, 0.01 * hs), ps(hx + 0.01 * hs, hy - 0.05 * hs, side * 0.088 * hs, 0.04 * hs, 0.008 * hs)],
      { ref: [1, 0, 0], sides: 8, capDepth: 0.008 * hs, color: shadeC(steel, 0.9), bind: bind.head });
  }
  addHornPair(kit, D, bind, horn, g);
}

/** Curved horns out of the temples, sweeping up and forward (bare-headed horned units, and on a helmet). */
function addHornPair(kit, D, bind, horn, g = 0, big = 1) {
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

// ---------------------------------------------------------------------------
// held items (rigid pieces that ride a bone)
// ---------------------------------------------------------------------------

function finishPiece(b) {
  const g = b.build();
  if (g) bakeAO([{ geo: g }], { ground: 0 });
  return g;
}

/** A weapon / tool in the hand: built in the arm frame like the low-poly arm does, then moved into the hand bone's frame. */
function heldPiece(ctx, P, side, item, sizeK = 1) {
  const { pal } = ctx;
  const b = new PartBuilder();
  const elbowY = -P.upper;
  const handY = elbowY - P.fore - P.handR * 0.55;
  const id = item.id;
  let grip = 'fwd';
  if (item.kind === 'weapon') grip = (WEAPON_INFO[id] || WEAPON_INFO.none).grip;
  else if (item.kind === 'bow') grip = 'bow';
  else if (item.kind === 'offhand') grip = id === 'lantern' ? 'hang' : 'fwd';
  if (grip === 'fist') return null;
  const size = P.weaponSize * sizeK;
  if (item.kind === 'weapon' && RICH_WEAPONS.has(id)) {
    const kit = new MeshKit(null, { sides: 10 });
    richWeapon(kit, pal, id, size, { glowBlade: ctx.grand && id === 'sword', runes: ctx.grand && id === 'hammer' ? pal.glow : null });
    return finishGear(kit, handFrame(P, side, grip));
  }
  b.frame([0.01, handY, side * 0.005], gripRotation(grip), 1, () => {
    if (item.kind === 'weapon') addWeapon(b, pal, id, size, { glowBlade: ctx.grand && id === 'sword', lowDetail: false });
    else if (item.kind === 'bow') addWeapon(b, pal, 'bow', size);
    else if (item.kind === 'tool') addTool(b, pal, id, size);
    else addOffhand(b, pal, id, size, { dark: ctx.unit.id && ctx.unit.id.includes('tezcatlipoca') });
  });
  const g = finishPiece(b);
  if (g) g.translate(0, P.upper + P.fore, 0); // arm frame (shoulder) to the hand bone (wrist)
  return g;
}

/** A round shield on the left forearm: team-painted face, iron rim and boss. */
function shieldPiece(ctx, D) {
  const { pal } = ctx;
  const kit = new MeshKit(null, { sides: 20 });
  const R = 0.2 * (D.weaponSize > 1 ? 0.92 : 1);
  const z0 = -(D.armR + 0.05);
  const iron = shadeC(pal.darkMetal, 1.1);
  const rim = pal.accentMetal;
  // lofts run along the shield's axis (the sideways axis): u = a vertical-ish radius, the path points outward
  const face = [
    ps(0, -D.fore * 0.5 + 0, z0 + 0.0, R * 0.98, R * 0.98),
    ps(0, -D.fore * 0.5 + 0, z0 - 0.012, R * 0.97, R * 0.97),
    ps(0, -D.fore * 0.5 + 0, z0 - 0.03, R * 0.62, R * 0.62),
  ];
  kit.loft(face, { ref: [1, 0, 0], rings: 6, sides: 22, start: 'round', end: 'round', capDepth: [0.006, 0.03], color: TEAM(0.9, 'painted'), bind: null,
    paint: (o, x, y, z, u, a) => {
      // painted wedges alternate with the plain face
      const k = Math.floor((a * 8) % 2);
      if (k === 1) mul(o, 0.72);
    } });
  kit.loft([ps(0, -D.fore * 0.5, z0 + 0.004, R * 1.03, R * 1.03), ps(0, -D.fore * 0.5, z0 - 0.02, R * 1.03, R * 1.03)],
    { ref: [1, 0, 0], sides: 22, start: null, end: null, color: rim, bind: null });
  kit.loft([ps(0, -D.fore * 0.5, z0 - 0.02, R * 0.24, R * 0.24), ps(0, -D.fore * 0.5, z0 - 0.04, R * 0.2, R * 0.2), ps(0, -D.fore * 0.5, z0 - 0.058, R * 0.06, R * 0.06)],
    { ref: [1, 0, 0], rings: 5, sides: 14, start: null, end: 'round', capDepth: 0.014, color: iron, bind: null });
  const g = kit.build({ ground: 0, strength: 0.3 });
  g.deleteAttribute('skinIndex');
  g.deleteAttribute('skinWeight');
  // the elbow bone's frame: the forearm hangs below it
  return g;
}

// ---------------------------------------------------------------------------
// template
// ---------------------------------------------------------------------------

/**
 * The rich template of a unit type: { kind, rich: { spec, geo, attach[], ... }, rig, parts: [] }.
 * Shaped like a low-poly template where the animation code reads it (kind, rig).
 */
export function buildRichTemplate(unitType, detail = 1) {
  const ctx = unitContext(unitType);
  const { v, pal, ex } = ctx;
  const name = v.body === 'giant' ? 'giant' : 'humanoid';
  const D = richDims(ctx, name);
  const spec = humanoidSpec({ ...D, headY: D.headPivot, shoulderDrop: 0.02 });
  const bind = makeBinds(spec, D);
  const lava = ex.has('flames') && D.bare; // a fire giant: dark crust, glowing veins, iron plates
  const sides = name === 'giant' ? 20 : ctx.grand ? 14 : 12;
  const kit = new MeshKit(spec, { sides: Math.round(sides * (detail >= 1 ? 1 : 0.7)), rings: (name === 'giant' ? 1.6 : 1) * (detail >= 1 ? 1 : 0.7) });
  const armor = ex.has('armor');
  const bare = D.bare;
  const skinPaint = lava ? lavaSkin(pal) : null;
  const worker = ctx.worker;
  const robe = ex.has('skirt') && (worker || ctx.cls === 'support' || (ctx.grand && !armor));
  const tunicColor = ctx.tunic || pal.primary;
  const steel = armor ? (ctx.mortal ? pal.accentMetal : pal.accentMetal) : null;
  const skin = pal.skin;

  addHeadAndNeck(kit, D, pal, ctx, bind, skinPaint);
  addHands(kit, D, pal, bind, skin, skinPaint);

  // legs
  if (bare) {
    for (const side of [1, -1]) kit.loft(legStations(D, side), { rings: 8, start: null, end: null, color: skin, bind: bind.leg[side], paint: skinPaint });
    addBoots(kit, D, pal, bind, lava ? IRON : ex.has('armor') ? shadeC(pal.accentMetal, 0.7) : shadeC(skin, 0.8), null);
  } else if (robe) {
    addBoots(kit, D, pal, bind, pal.leather, shadeC(pal.leather, 0.8));
  } else {
    const pants = shadeC(pal.primary, 0.78);
    for (const side of [1, -1]) {
      kit.loft(legFrom(D, side, 0.011, bootTop(D) - 0.012), { rings: 7, start: null, end: null, color: pants, bind: bind.leg[side], paint: gradY(0.2, D.hipY, 0.85, 1) });
    }
    addBoots(kit, D, pal, bind, pal.leather, shadeC(pal.leather, 0.85));
  }

  // torso
  if (bare && !armor) {
    kit.loft(torsoStations(D), { rings: 11, start: null, end: 'round', color: skin, bind: bind.torso, paint: skinPaint });
  } else {
    if (robe) {
      addTunic(kit, D, tunicColor, bind, 0.04);
      // long skirt to the boots
      const y0 = D.ankleY + 0.05;
      const st = [vs(y0, D.depth * 0.5 + 0.12, D.waistW * 0.5 + 0.13), vs(y0 + 0.12, D.depth * 0.5 + 0.09, D.waistW * 0.5 + 0.1), vs(D.hipY - 0.04, D.depth * 0.5 + 0.045, D.waistW * 0.5 + 0.055), vs(D.hipY + 0.07, D.depth * 0.5 + 0.02, D.waistW * 0.5 + 0.025)];
      kit.loft(st, {
        rings: 7, sides: 18, start: null, end: null, color: ctx.skirt || pal.primary, bind: bind.skirt,
        warp: (p, a, u) => {
          const k = 1 - u;
          const s = Math.sin(a * 9) * 0.006 * k;
          p[0] += Math.cos(a) * s;
          p[2] += Math.sin(a) * s;
        },
        paint: gradY(y0, D.hipY, 0.8, 1),
      });
      kit.loft([vs(y0 - 0.002, D.depth * 0.5 + 0.126, D.waistW * 0.5 + 0.136), vs(y0 + 0.03, D.depth * 0.5 + 0.119, D.waistW * 0.5 + 0.129)],
        { sides: 18, start: null, end: null, color: pal.secondary, bind: bind.skirt });
    } else {
      addTunic(kit, D, tunicColor, bind, armor && ctx.mortal ? 0.02 : 0.09);
      if (armor && ctx.mortal) {
        // pteruges: a short team kilt of leather-edged strips under the cuirass
        const y1 = D.hipY - 0.12;
        kit.loft([vs(y1, D.depth * 0.5 + 0.075, D.waistW * 0.5 + 0.09), vs(D.hipY + 0.02, D.depth * 0.5 + 0.035, D.waistW * 0.5 + 0.04)],
          { sides: 18, rings: 3, start: null, end: null, color: TEAM(0.8), bind: bind.skirt,
            warp: (p, a, u) => { const s = Math.sin(a * 12) * 0.005 * (1 - u); p[0] += Math.cos(a) * s; p[2] += Math.sin(a) * s; } });
        kit.loft([vs(y1 - 0.004, D.depth * 0.5 + 0.077, D.waistW * 0.5 + 0.092), vs(y1 + 0.022, D.depth * 0.5 + 0.073, D.waistW * 0.5 + 0.088)],
          { sides: 18, start: null, end: null, color: pal.leather, mat: 'leather', bind: bind.skirt });
      } else if (ctx.grand) {
        // a long tabard front and back, with a metal hem
        for (const dir of [1, -1]) {
          const x0 = dir * (D.depth * 0.5 + 0.03);
          kit.sheet(4, 5, (u, vv, out) => {
            out[0] = x0 + dir * 0.012 * vv;
            out[1] = D.hipY + 0.05 - vv * 0.3;
            out[2] = (u - 0.5) * D.waistW * 0.78 * (1 + 0.1 * vv);
            if (dir < 0) out[2] = -out[2];
          }, { thick: 0.007, color: TEAM(0.9), inner: shadeC(pal.secondary, 0.8), bind: bind.skirt, flip: dir });
        }
      }
    }
    addBelt(kit, D, pal, bind);
  }

  // arms
  for (const side of [1, -1]) {
    const bd = bind.arm[side];
    if (bare) {
      kit.loft(armStations(D, side), { rings: 8, start: null, end: null, color: skin, bind: bd, paint: skinPaint });
    } else {
      // forearm skin, sleeve over the upper arm
      kit.loft(armStations(D, side).slice(0, 4), { rings: 5, start: null, end: null, color: skin, bind: bd });
      const sleeveColor = ctx.sleeve || (armor ? shadeC(pal.primary, 0.9) : pal.primary);
      kit.loft(armStations(D, side, 0.009, 'elbow'), {
        rings: 5, start: null, end: 'round', capDepth: 0.012, color: sleeveColor, bind: bd, paint: gradY(D.shoulderY - D.upper - 0.05, D.shoulderY, 0.9, 1),
      });
      // sleeve cuff
      const e = D.shoulderY - 0.02 - D.upper;
      kit.loft([vs(e - 0.012, D.armR * 0.96 + 0.012, D.armR * 0.94 + 0.012, 0, side * D.shoulderZ), vs(e + 0.03, D.armR * 1.02 + 0.014, D.armR * 1.0 + 0.014, 0, side * D.shoulderZ)],
        { sides: 12, start: null, end: null, color: ctx.sleeveTrim || pal.leather, bind: bd });
    }
    if (armor || ctx.grand) {
      // bracer
      const w = D.shoulderY - 0.02 - D.upper - D.fore;
      kit.loft([vs(w + 0.012, D.armR * 0.66 + 0.007, D.armR * 0.64 + 0.007, 0, side * D.shoulderZ), vs(w + D.fore * 0.52, D.armR * 0.86 + 0.007, D.armR * 0.84 + 0.007, 0.002, side * D.shoulderZ)],
        { sides: 12, rings: 3, start: null, end: null, color: ctx.mortal ? pal.leather : pal.accentMetal, mat: ctx.mortal ? 'leather' : undefined, bind: bd });
    }
  }

  // armor and trim
  if (armor) {
    if (lava) {
      // forged black iron with the fire showing at every edge
      addCuirass(kit, D, pal, bind, IRON, pal.fire, 0.9);
      addPauldrons(kit, D, pal, bind, IRON, pal.fire, 0.9);
    } else {
      addCuirass(kit, D, pal, bind, ctx.mortal ? mixC(pal.accentMetal, '#8a93a0', 0.35) : pal.accentMetal, shadeC(pal.accentMetal, 0.7));
      addPauldrons(kit, D, pal, bind, ctx.mortal ? shadeC(pal.accentMetal, 0.8) : pal.accentMetal, shadeC(pal.leather, 1));
    }
    if (ctx.mortal) {
      // leather baldric across the chest
    }
  }
  if (ex.has('fur') || (ctx.unit.pantheon === 'norse' && ctx.grand && !ex.has('fur') && false)) addFurMantle(kit, D, pal, bind);
  if (ex.has('cape')) addCape(kit, D, TEAM(1), ctx.grand ? pal.accent : pal.secondary, shadeC(pal.secondary, 0.7), bind);

  // head dressing
  const gear = v.headgear;
  const hoodColor = ctx.mortal ? (worker ? pal.secondary : shadeC(pal.primary, ctx.cls === 'support' ? 0.95 : 0.8)) : pal.secondary;
  if (gear === 'hood') addHood(kit, D, pal, bind, hoodColor, pal.secondary);
  else if (gear === 'horned_helmet') addHornedHelm(kit, D, pal, bind, pal.accentMetal, shadeC(pal.accentMetal, 0.7), pal.horn);
  else if (lava) {
    // a fire giant has no hair: its mane is flame (below), over great swept horns
    addHornPair(kit, D, bind, lava ? mixC(pal.bone, '#2a1814', 0.35) : pal.horn, 0, 1.15);
  } else {
    addHairCap(kit, D, pal, bind);
    if (gear === 'horns') addHornPair(kit, D, bind, pal.horn, 0.012 * D.hs);
  }
  if (gear !== 'hood' && gear !== 'horned_helmet' && gear !== 'horns') {
    // bare head: hair already added
  }
  if (gear === 'horned_helmet' || gear === 'hood') {
    // hair peeking out under the gear is left to the beard and long hair below
  }
  if (ex.has('long_hair') && gear !== 'hood') addLongHair(kit, D, pal, bind);
  if (ex.has('beard')) addBeard(kit, D, pal, bind, lava);

  const geo = kit.build({ ground: 1 });

  // rigid pieces
  const items = humanoidItems(v);
  const attach = [];
  const P = D;
  const rightPiece = items.right.kind !== 'none' ? heldPiece(ctx, P, 1, items.right) : null;
  if (rightPiece) attach.push({ name: 'weaponR', bone: B.handR, geo: rightPiece });
  if (items.left.kind === 'offhand' && items.left.id === 'shield') {
    attach.push({ name: 'shield', bone: B.foreL, geo: shieldPiece(ctx, P), shield: true });
  } else if (items.left.kind !== 'none') {
    const left = heldPiece(ctx, P, -1, items.left);
    if (left) attach.push({ name: 'weaponL', bone: B.handL, geo: left });
  }
  const rig = {
    hipY: P.hipY, thigh: P.thigh, lean: P.lean, shoulderY: P.shoulderY,
    weapon: v.weapon, offhand: v.offhand, info: WEAPON_INFO[v.weapon] || WEAPON_INFO.none,
    rightElbow: (WEAPON_INFO[v.weapon] || WEAPON_INFO.none).elbow,
    leftElbow: v.weapon === 'bow' ? 0.15 : v.weapon === 'claws' ? 0.3 : OFFHAND_ELBOW[v.offhand] ?? 0.25,
    stride: name === 'giant' ? 1.1 : 1.25,
    heavy: name === 'giant',
    holdAloft: holdsAloft(v),
  };
  if (worker) {
    rig.tools = ['pick', 'axe', 'hammer'];
    for (const id of rig.tools) attach.push({ name: `tool_${id}`, bone: B.handR, geo: heldPiece(ctx, P, 1, { kind: 'tool', id }), tool: id });
  }
  if (ex.has('flames')) attach.push(...flamePieces(ctx, D, spec));
  if (lava) attach.push(flameMane(ctx, D, spec));
  let triangles = geo.userData.triangles;
  for (const a of attach) if (!a.tool || a.tool === 'pick') triangles += a.geo.userData.triangles ?? a.geo.attributes.position.count / 3;
  return {
    kind: 'humanoid', rich: { spec, geo, attach, dims: D, carryAt: spec.pos[B.chest] }, parts: [], rig,
    triangles, meshes: 1 + attach.filter((a) => !a.tool || a.tool === 'pick').length,
  };
}

/** One tongue of flame: a tapered curl from `base` along `dir`, bent back by `bend`, with a flicker morph. */
function tongue(kit, pal, base, dir, L, r, { bend = 0.3, k = 0.35, sides = 6 } = {}) {
  const n = 5;
  const st = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const rr = r * (1 - t) ** 0.85 + 0.0025;
    st.push(ps(base[0] + dir[0] * L * t - bend * L * t * t, base[1] + dir[1] * L * t, base[2] + dir[2] * L * t, rr, rr * 0.85));
  }
  const f = pal.fire;
  const h = pal.fireHot;
  kit.loft(st, {
    rings: 6, sides, start: 'round', end: 'round', capDepth: [r * 0.5, L * 0.08], color: pal.fire, mat: 'gem', glow: 0.95, flicker: { base, k },
    paint: (o, x, y, z, u) => {
      const t = u * u;
      o.r = f.r + (h.r - f.r) * t;
      o.g = f.g + (h.g - f.g) * t;
      o.b = f.b + (h.b - f.b) * t;
    },
  });
}

/** A mane of fire over the crown and back of the head (rides the head bone). */
function flameMane(ctx, D, spec) {
  const { pal } = ctx;
  const hs = D.hs;
  const kit = new MeshKit(null, { sides: 6 });
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = 0.8 + (i / (n - 1)) * (TAU - 1.6);
    const wob = 0.8 + 0.4 * hash(i, 2, 5);
    const base = [D.headX + Math.cos(a) * 0.066 * hs, D.headCY + 0.088 * hs, Math.sin(a) * 0.062 * hs];
    const dir = [Math.cos(a) * 0.45 - 0.3, 1, Math.sin(a) * 0.6];
    const l = Math.hypot(...dir);
    tongue(kit, pal, base, dir.map((x) => x / l), 0.21 * hs * wob, 0.03 * hs, { bend: 0.5, k: 0.4 });
  }
  const o = spec.pos[B.head];
  return { name: 'mane', bone: B.head, geo: finishGear(kit, new THREE.Matrix4().makeTranslation(-o[0], -o[1], -o[2])), flicker: true };
}

/** Fire on the shoulders and back (riding the chest bone). */
function flamePieces(ctx, D, spec) {
  const { pal } = ctx;
  const kit = new MeshKit(null, { sides: 6 });
  const k = D.chestW / 0.38;
  const sh = D.shoulderY;
  for (const side of [1, -1]) {
    for (let i = 0; i < 4; i++) {
      const base = [-0.02 - 0.012 * i, sh + 0.035 - 0.012 * i, side * (D.shoulderZ * 0.92 + (i - 1.5) * 0.034 * k)];
      const dir = [-0.12 - 0.1 * i, 1, side * (0.08 + 0.12 * i)];
      const l = Math.hypot(...dir);
      tongue(kit, pal, base, dir.map((x) => x / l), (0.17 - 0.025 * Math.abs(i - 1.2)) * k, 0.032 * k, { bend: 0.45, k: 0.33 });
    }
  }
  // a fan of tongues rising behind the shoulders
  for (let i = 0; i < 5; i++) {
    const z = (i - 2) * 0.095 * k;
    const base = [-D.chestD * 0.52, sh - 0.12 - 0.02 * Math.abs(i - 2), z];
    const dir = [-0.35, 1, (i - 2) * 0.22];
    const l = Math.hypot(...dir);
    tongue(kit, pal, base, dir.map((x) => x / l), (0.23 - 0.035 * Math.abs(i - 2)) * k, 0.036 * k, { bend: 0.6, k: 0.3 });
  }
  const o = spec.pos[B.chest];
  return [{ name: 'flames', bone: B.chest, geo: finishGear(kit, new THREE.Matrix4().makeTranslation(-o[0], -o[1], -o[2])), flicker: true }];
}
