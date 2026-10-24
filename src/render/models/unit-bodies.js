// Body assemblers for the procedural unit models. buildTemplate(unitType)
// returns { kind, parts, rig } where parts is a flat list of
// { name, parent, pos, rot?, geo, ghost? } (geo null = plain Group) and rig
// holds the numbers the animator needs. Models face +X, feet on y = 0, at
// visual scale 1 (the instance scales the rig).
import {
  PartBuilder, TEAM, C, mixC, shadeC, tintC, withMat,
  box, cyl, cone, ball, ico, dodeca, octa, torus, dome, slab, taper, seg, tube, T,
} from './unit-geo.js';
import {
  makePalette, addHead, addHeadgear, hairCap, headgearCoversHair, isAnimalHead,
  addWeapon, addOffhand, addTool, WEAPON_INFO, OFFHAND_ELBOW, gripRotation, flickerMorph,
} from './unit-parts.js';

const PI = Math.PI;
const DEG = PI / 180;

/** Joint sample angles (radians) for the rotation morph series. */
export const KNEE_SAMPLES = [0, 45 * DEG, 90 * DEG];
export const WING_SAMPLES = [-45 * DEG, -20 * DEG, 0, 25 * DEG, 55 * DEG];
const WING_NAMES = ['wd2', 'wd1', null, 'wu1', 'wu2'];

// ---------------------------------------------------------------------------
// visual normalisation
// ---------------------------------------------------------------------------

/** Fill in defaults so partial or unknown visual specs still build. */
export function normalizeVisual(v = {}) {
  return {
    body: v.body || 'humanoid',
    scale: Number.isFinite(v.scale) && v.scale > 0 ? v.scale : 1,
    colors: { skin: '#d8b090', primary: '#8888aa', secondary: '#444466', accent: '#ffd84a', ...(v.colors || {}) },
    head: v.head || 'human',
    headgear: v.headgear || 'none',
    weapon: v.weapon || 'none',
    offhand: v.offhand || 'none',
    extras: Array.isArray(v.extras) ? v.extras : [],
    heads: Math.max(1, Math.min(9, Math.round(v.heads || 1))),
    aura: v.aura || null,
  };
}

// ---------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------

/** Cheap joint filler: octahedron for mortals/creatures, icosahedron for gods. */
function joint(ctx, r) {
  return ctx.lod >= 2 ? ico(r) : octa(r * 1.12);
}

/** Wave morphs (wa / wb): lateral (axis 'z') or vertical ('y') traveling wave. */
function waveMorph(sOf, amp, k, axis = 'z', phase = 0) {
  return {
    wa: (p, out) => {
      const s = sOf(p);
      const a = amp(s);
      const d = a * Math.sin(k * s + phase);
      out.set(0, axis === 'y' ? d : 0, axis === 'z' ? d : 0);
    },
    wb: (p, out) => {
      const s = sOf(p);
      const a = amp(s);
      const d = -a * Math.cos(k * s + phase);
      out.set(0, axis === 'y' ? d : 0, axis === 'z' ? d : 0);
    },
  };
}

/** Rotation morph series for a hinge (one morph per non-zero sample). */
function hingeMorphs(b, names, samples, pivot, axis) {
  const m = {};
  samples.forEach((a, i) => {
    if (names[i]) m[names[i]] = b.rotMorphLocal(pivot, axis, a);
  });
  return m;
}

/**
 * A feathered (or membrane) wing on the +Z side in the current frame, root at
 * the origin, spanning +Z. Adds wing flap morphs about the X axis.
 * style: 'feather' | 'bat'. span: wing length.
 */
function addWing(b, pal, { span = 0.8, style = 'feather', colA, colB, colC, sweep = 0.35, lift = 0.25 }, side) {
  b.push([0, 0, 0], [0, 0, 0], [1, 1, side]);
  const morph = hingeMorphs(b, WING_NAMES, WING_SAMPLES.map((a) => -a), [0, 0, 0], [1, 0, 0]);
  // 'wf': wing folded back along the body (resting on the ground)
  morph.wf = b.rotMorphLocal([0, 0, 0], [0, 1, 0], -1.2);
  b.push([0, 0, 0], [-lift, -sweep, 0], 1);
  // wing pieces below are authored as (thickness, chord, span); turn the
  // chord onto +X so the wing lies flat (top face up) and flaps about X
  b.push([0, 0, 0], [0, 0, -PI / 2], 1);
  const S = span;
  if (style === 'bat') {
    const pts = [[0, 0.04], [0.35, 0.22], [0.7, 0.3], [1.0, 0.18], [0.82, 0.0], [0.72, -0.2], [0.5, -0.12], [0.35, -0.3], [0.15, -0.18], [0, -0.12]];
    const mem = slab(pts.map(([z, y]) => [-z * S, y * S]), 0.02 * S);
    T(mem, [0, 0, 0], [0, PI / 2, 0]);
    b.add(mem, colA, { morph });
    const bones = [[0, 0.04, 0], [0, 0.22 * S, 0.35 * S], [0, 0.3 * S, 0.7 * S], [0, 0.18 * S, 1.0 * S]];
    for (let i = 0; i < bones.length - 1; i++) b.add(seg(bones[i], bones[i + 1], 0.035 * S, 0.025 * S, 4), colB, { morph });
    b.add(seg(bones[2], [0, -0.2 * S, 0.72 * S], 0.02 * S, 0.01 * S, 3), colB, { morph });
    b.add(seg(bones[1], [0, -0.3 * S, 0.35 * S], 0.02 * S, 0.01 * S, 3), colB, { morph });
    const claw = cone(0.03 * S, 0.1 * S, 3);
    T(claw, [0, 0.36 * S, 0.7 * S]);
    b.add(claw, pal.horn, { morph });
  } else {
    const cov = [[0, 0.06], [0.3, 0.2], [0.62, 0.3], [0.95, 0.24], [0.8, 0.08], [0.55, 0.0], [0.3, -0.04], [0, -0.06]];
    const fly = [[0.02, -0.02], [0.3, 0.02], [0.6, 0.1], [0.92, 0.2], [1.02, 0.1], [0.9, -0.08], [0.72, -0.22], [0.5, -0.32], [0.3, -0.36], [0.12, -0.34], [0.02, -0.2]];
    const g1 = slab(fly.map(([z, y]) => [-z * S, y * S]), 0.02 * S);
    T(g1, [0.01 * S, 0, 0], [0, PI / 2, 0]);
    b.add(g1, colB, { morph });
    const g2 = slab(cov.map(([z, y]) => [-z * S, y * S]), 0.03 * S);
    T(g2, [-0.012 * S, 0, 0], [0, PI / 2, 0]);
    b.add(g2, colA, { morph });
    if (colC) {
      const tip = slab([[0.78, 0.2], [0.95, 0.24], [1.02, 0.1], [0.9, -0.08], [0.8, 0.0]].map(([z, y]) => [-z * S, y * S]), 0.025 * S);
      T(tip, [-0.02 * S, 0, 0], [0, PI / 2, 0]);
      b.add(tip, colC, { morph });
    }
    b.add(seg([0, 0.04 * S, 0], [0, 0.26 * S, 0.62 * S], 0.035 * S, 0.025 * S, 4), colA, { morph });
  }
  b.pop();
  b.pop();
  b.pop();
}

/** Symmetric pair of wings rooted at (x, y, ±z). */
function addWings(b, pal, x, y, z, opts) {
  b.frame([x, y, z], [0, 0, 0], 1, () => addWing(b, pal, opts, 1));
  b.frame([x, y, -z], [0, 0, 0], 1, () => addWing(b, pal, opts, -1));
}

/**
 * A tapering tail through `pts` ([x,y,z] list) with radii r0 → r1 and a
 * lateral wave morph. style adds a tuft / bushy end.
 */
function addTail(b, pal, pts, r0, r1, color, { style = 'plain', tipColor, amp = 0.12, k = 4, sides = 5, count = 1, spread = 0.5 } = {}) {
  const root = pts[0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  for (let c = 0; c < count; c++) {
    const yaw = count > 1 ? (c / (count - 1) - 0.5) * spread * 2 : 0;
    b.push(root, [0, yaw, 0], 1);
    const R = b.toRoot([0, 0, 0]);
    const morph = waveMorph((p) => Math.hypot(p.x - R[0], p.y - R[1], p.z - R[2]), (s) => amp * Math.min(1, s / total) ** 1.2, k, 'z', c * 1.3);
    const local = pts.map((p) => [p[0] - root[0], p[1] - root[1], p[2] - root[2]]);
    if (style === 'bushy') {
      // full brush: swells from the root and closes to a (tip colored) point
      const end = local[local.length - 1];
      const prev = local[local.length - 2];
      const d = [end[0] - prev[0], end[1] - prev[1], end[2] - prev[2]];
      const L = Math.hypot(...d) || 1;
      const ext = total * 0.25;
      const tip = [end[0] + (d[0] / L) * ext, end[1] + (d[1] / L) * ext, end[2] + (d[2] / L) * ext];
      const pts2 = [...local, tip];
      const n2 = pts2.length;
      const radii = pts2.map((_, i) => (i === n2 - 1 ? 0 : r0 * (0.8 + 1.5 * Math.sin((PI * 0.85 * i) / (n2 - 1)))));
      tube(pts2, radii, sides).forEach((g, i) => b.add(g, i >= n2 - 2 && tipColor ? tipColor : color, { morph }));
      b.pop();
      continue;
    }
    const radii = local.map((_, i) => r0 + (r1 - r0) * (i / (local.length - 1)));
    for (const g of tube(local, radii, sides)) b.add(g, color, { morph });
    const end = local[local.length - 1];
    const prev = local[local.length - 2];
    if (style === 'tuft' || style === 'hair') {
      const dir = [end[0] - prev[0], end[1] - prev[1], end[2] - prev[2]];
      const L = Math.hypot(...dir) || 1;
      const len = style === 'hair' ? total * 0.6 : total * 0.22;
      const rad = style === 'hair' ? r0 * 1.4 : r0 * 1.3;
      const tipEnd = [end[0] + (dir[0] / L) * len, end[1] + (dir[1] / L) * len, end[2] + (dir[2] / L) * len];
      const mid = [(end[0] + tipEnd[0]) / 2, (end[1] + tipEnd[1]) / 2, (end[2] + tipEnd[2]) / 2];
      b.add(seg(end, mid, rad * 0.6, rad, 5), tipColor || color, { morph });
      b.add(seg(mid, tipEnd, rad, 0.0, 5), tipColor || color, { morph });
    }
    b.pop();
  }
}

/**
 * Team caparison draped over a back whose top is at height y: a fitted
 * cloth hugging the barrel (its front and back edges sink into the body like
 * a saddle blanket), a trim band along its hem with tassels hanging from it,
 * and a metal roundel on each flank.
 */
function addSaddle(b, x, y, len, width, drop, trim = TEAM(0.55)) {
  const d = drop * 0.95;
  const cloth = dome(1, 8, 2);
  T(cloth, [x, y - d + 0.004, 0], [0, PI / 8, 0], [len * 0.62, d, width * 0.54]);
  b.add(cloth, TEAM(1));
  const hem = cyl(1, 1, 0.032, 8, true);
  T(hem, [x, y - d + 0.012, 0], [0, PI / 8, 0], [len * 0.63, 1, width * 0.545]);
  b.add(hem, trim);
  for (let i = 0; i < 6; i++) {
    const a = PI * (0.18 + (i % 3) * 0.32) * (i < 3 ? 1 : -1);
    const t = cone(0.018, 0.07, 4);
    T(t, [x + Math.cos(a) * len * 0.63, y - d - 0.02, Math.sin(a) * width * 0.545], [PI, 0, 0]);
    b.add(t, trim);
  }
  const roundel = octa(Math.min(0.05, width * 0.16));
  T(roundel, [x, y - d * 0.5, width * 0.535], [0, 0, 0], [1, 1, 0.35]);
  b.addSym(roundel, trim, { glow: 0.25 });
}

/** Small seated rider (team tunic) on a mount, seat at the current origin. */
function addRider(b, pal, ctx, size = 1) {
  const s = size;
  const skin = withMat('#c8a07a', 'skin');
  b.push([0, 0, 0], [0, 0, 0], s);
  b.add(T(taper(0.16, 0.2, 0.22, 1.1, 1.25), [0, 0.02, 0]), TEAM(1));
  b.add(T(box(0.17, 0.05, 0.24), [0, 0.05, 0]), pal.secondary);
  b.add(seg([0, 0.02, 0.08], [0.12, -0.06, 0.16], 0.04, 0.035, 4), shadeC(pal.primary, 0.7));
  b.add(seg([0, 0.02, -0.08], [0.12, -0.06, -0.16], 0.04, 0.035, 4), shadeC(pal.primary, 0.7));
  b.add(seg([0.12, -0.06, 0.16], [0.1, -0.2, 0.17], 0.035, 0.03, 4), shadeC(pal.primary, 0.6));
  b.add(seg([0.12, -0.06, -0.16], [0.1, -0.2, -0.17], 0.035, 0.03, 4), shadeC(pal.primary, 0.6));
  b.frame([0.02, 0.33, 0], [0, 0, 0], 0.1, () => {
    const anchor = addHead(b, { ...pal, skin, skinDark: shadeC(skin, 0.7), hair: withMat('#2a1c14', 'hair'), eyeGlow: null }, ctx.v, 'human');
    addHeadgear(b, pal, ctx.v, 'helmet', anchor, {});
  });
  b.add(seg([0, 0.2, 0.13], [0.12, 0.08, 0.15], 0.035, 0.03, 4), skin);
  b.add(seg([0, 0.2, -0.13], [0.14, 0.1, -0.12], 0.035, 0.03, 4), skin);
  const w = ctx.v.weapon !== 'none' && ctx.v.weapon !== 'bow' && ctx.v.weapon !== 'claws' ? ctx.v.weapon : 'spear';
  b.frame([0.13, 0.1, -0.13], [0, 0, -0.6], 0.8, () => addWeapon(b, pal, w, 1));
  b.pop();
}

/** Ring behind/around the body: drums or glowing orbs (aura_ring extra). */
function addAuraRing(b, pal, center, r, drums, plane = 'yz') {
  const ring = torus(r, r * 0.05, 3, 10);
  T(ring, center, plane === 'yz' ? [0, PI / 2, 0] : [PI / 2, 0, 0]);
  b.add(ring, drums ? pal.secondary : tintC(pal.glow, 0.2), { glow: drums ? 0.1 : 1 });
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2;
    const off = plane === 'yz' ? [0, Math.sin(a) * r, Math.cos(a) * r] : [Math.cos(a) * r, 0, Math.sin(a) * r];
    const p = [center[0] + off[0], center[1] + off[1], center[2] + off[2]];
    if (drums) {
      const d = cyl(r * 0.17, r * 0.17, r * 0.13, 6);
      T(d, p, plane === 'yz' ? [0, 0, PI / 2] : [0, 0, 0]);
      b.add(d, i % 2 ? pal.primary : pal.accent, { glow: i % 2 ? 0 : 0.2 });
    } else {
      const o = octa(r * 0.09);
      T(o, p);
      b.add(o, tintC(pal.glow, 0.35), { glow: 1 });
    }
  }
}

/**
 * A crest of swept-back dorsal fins along a body chain (points i0..i1 of
 * pts / rad), following its morphs: a continuous ridge that gives serpents
 * and eastern dragons a jagged, readable back line instead of a bare tube.
 */
function addDorsalFins(b, pts, rad, i0, i1, color, morph, size = 1) {
  for (let i = i0; i <= i1; i++) {
    const p = pts[i];
    const q = pts[Math.min(pts.length - 1, i + 1)];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const a = Math.atan2(-dy, -dx); // local +x toward the head, +y up off the spine
    const r = rad[i];
    const w = Math.max(0.05, Math.hypot(dx, dy) * 0.9);
    const h = r * 1.5 * size;
    const fin = slab([[w * 0.5, r * 0.7], [-w * 0.45, r * 0.7], [-w * 0.95, r + h], [-w * 0.2, r + h * 0.55]], Math.max(0.012, r * 0.18));
    T(fin, p, [0, 0, a]);
    b.add(fin, i % 2 ? color : shadeC(color, 0.8), { morph });
  }
}

/** Head frame contents: head + hair + headgear + head-level extras. Returns anchor. */
function headAssembly(b, ctx, headKind, opts = {}) {
  const { v, pal, ex } = ctx;
  const giant = v.body === 'giant';
  const gear = opts.headgear ?? v.headgear;
  const anchor = addHead(b, pal, v, headKind, {
    jaw: opts.jaw, lod: opts.lod ?? ctx.lod, cyclops: giant && ex.has('third_eye') && headKind === 'human',
    noEars: headgearCoversHair(gear) && gear !== 'flame', // ears would poke through hoods and helmets
  });
  if (!anchor) return null;
  const animal = isAnimalHead(headKind);
  if (anchor.hair && !headgearCoversHair(gear) && gear !== 'topknot') hairCap(b, pal);
  else if (anchor.hair && gear === 'topknot') hairCap(b, pal);
  if (ex.has('long_hair') && anchor.hair) {
    const h = taper(0.55, 1.7, 1.5, 0.8, 1.15);
    T(h, [-0.62, -1.75, 0], [0, 0, 0.12]);
    b.add(h, pal.hair);
    const lock = box(0.3, 1.3, 0.25);
    T(lock, [0.15, -1.1, 0.78], [0.12, 0, 0]);
    b.addSym(lock, pal.hair);
  } else if (ex.has('long_hair') && animal) {
    const h = taper(0.4, 1.1, 0.9, 0.8, 1.1);
    T(h, [-0.7, -1.0, 0]);
    b.add(h, pal.back);
  }
  if (ex.has('beard') && anchor.hair) {
    const beard = taper(0.55, 1.15, 1.25, 0.6, 0.4, 0.15);
    T(beard, [0.5, -1.55, 0], [0, 0, 0.18]);
    b.add(beard, pal.hair);
    const must = box(0.2, 0.15, 0.8);
    T(must, [0.92, -0.32, 0]);
    b.add(must, pal.hair);
  }
  if (ex.has('third_eye') && !(giant && headKind === 'human')) {
    const e = octa(0.14);
    T(e, [anchor.front * 0.9, anchor.brow + 0.15, 0], [0, 0, 0], [0.6, 1.5, 0.8]);
    b.add(e, tintC(pal.glow, 0.2), { glow: 1 });
  }
  if (ex.has('jewelry') && anchor.hair) {
    const ear = octa(0.12);
    T(ear, [0, -0.35, 0.95]);
    b.addSym(ear, pal.accentMetal, { glow: 0.2 });
  }
  if (ex.has('mane') && anchor.hair) {
    const m = dodeca(1.35);
    T(m, [-0.35, -0.2, 0], [0, 0, 0], [0.8, 1.05, 1.2]);
    b.add(m, pal.hair);
  }
  addHeadgear(b, pal, v, gear, anchor, {
    animal, crest: true, lod: opts.lod ?? ctx.lod,
    // mortals wear their team color on cloth and shields, not on caps
    hoodColor: ctx.mortal ? (ctx.worker ? pal.secondary : shadeC(pal.primary, ctx.cls === 'support' ? 0.95 : 0.8)) : null,
    crestColor: ctx.mortal ? pal.primary : null,
  });
  return anchor;
}

// ---------------------------------------------------------------------------
// humanoid family (humanoid, giant, beast_biped, spirit, naga, centaur torso)
// ---------------------------------------------------------------------------

/** Headless riders hold their glowing offhand (a lantern / orb "head") aloft. */
export function holdsAloft(v) {
  return v.head === 'none' && (v.offhand === 'lantern' || v.offhand === 'orb' || v.offhand === 'torch');
}

export const PROFILES = {
  humanoid: {
    hipY: 0.5, hipZ: 0.085, thigh: 0.245, legR: 0.056, footL: 0.15, footH: 0.06,
    waistW: 0.25, chestW: 0.36, depth: 0.17, chestD: 0.21, shoulderY: 0.86, shoulderZ: 0.2,
    upper: 0.185, fore: 0.17, armR: 0.044, handR: 0.048, headR: 0.122, headY: 1.0, headX: 0.012,
    padR: 0.075, lean: 0, bare: false, weaponSize: 1,
  },
  giant: {
    hipY: 0.36, hipZ: 0.135, thigh: 0.175, legR: 0.1, footL: 0.24, footH: 0.08,
    waistW: 0.44, chestW: 0.6, depth: 0.34, chestD: 0.38, shoulderY: 0.82, shoulderZ: 0.34,
    upper: 0.22, fore: 0.21, armR: 0.085, handR: 0.1, headR: 0.165, headY: 0.94, headX: 0.12,
    padR: 0.115, lean: -0.12, bare: true, weaponSize: 1.3,
  },
  beast_biped: {
    hipY: 0.4, hipZ: 0.1, thigh: 0.16, legR: 0.068, footL: 0.16, footH: 0.06, digi: true,
    waistW: 0.26, chestW: 0.42, depth: 0.2, chestD: 0.27, shoulderY: 0.76, shoulderZ: 0.235,
    upper: 0.17, fore: 0.17, armR: 0.055, handR: 0.068, headR: 0.15, headY: 0.92, headX: 0.07,
    padR: 0.085, lean: -0.18, bare: true, weaponSize: 1.1,
  },
  // (a spirit stands taller in the waist than a person and leans into its drift, as the low-poly torso is turned by; below the hip it has a wisp, not legs)
  spirit: {
    hipY: 0.5, hipZ: 0.085, thigh: 0.245, legR: 0.056, footL: 0.15, footH: 0.06,
    waistW: 0.25, chestW: 0.36, depth: 0.17, chestD: 0.21, shoulderY: 0.86, shoulderZ: 0.2,
    upper: 0.185, fore: 0.17, armR: 0.044, handR: 0.048, headR: 0.122, headY: 1.03, headX: 0.012,
    padR: 0.075, lean: -0.08, bare: false, weaponSize: 1,
  },
};

function armColorFor(ctx, P) {
  const { pal, ex } = ctx;
  if (P.bare || ctx.v.body === 'spirit') return { upper: P.bare ? pal.skin : pal.primary, fore: P.bare ? pal.skin : pal.skin };
  return { upper: ctx.sleeve || (ex.has('armor') ? shadeC(pal.primary, 0.9) : pal.primary), fore: pal.skin };
}

/**
 * Arm mesh geometry (pivot at the shoulder). side +1 right, −1 left.
 * item: { kind: 'weapon'|'offhand'|'bow'|'tool'|'none', id }
 */
function buildArm(ctx, P, side, item, sizeK = 1) {
  const { pal, ex } = ctx;
  const b = new PartBuilder();
  const cols = armColorFor(ctx, P);
  const elbowY = -P.upper;
  const lower = hingeMorphs(b, [null, 'e45', 'e90'], KNEE_SAMPLES, [0, elbowY, 0], [0, 0, 1]);
  const armSides = ctx.lod > 0 ? 6 : 5;
  b.add(seg([0, 0.02, 0], [0, elbowY, 0], P.armR * 1.2, P.armR * 0.95, armSides, true), cols.upper);
  if (ctx.mortal && !P.bare) {
    // short sleeve cuff over the upper arm
    const cuff = cyl(P.armR * 1.32, P.armR * 1.38, 0.035, armSides, true);
    T(cuff, [0, elbowY * 0.62, 0]);
    b.add(cuff, ctx.sleeveTrim || shadeC(pal.secondary, 1));
  }
  if (ctx.lod > 0) {
    const elbow = joint(ctx, P.armR * 1.02);
    T(elbow, [0, elbowY, 0]);
    b.add(elbow, cols.fore, { morph: lower });
  }
  const handY = elbowY - P.fore - P.handR * 0.55;
  b.add(seg([0, elbowY, 0], [0, elbowY - P.fore, 0], P.armR * 0.95, P.armR * 0.72, armSides, true), cols.fore, { morph: lower });
  const hand = ctx.lod > 0 ? dodeca(P.handR) : box(P.handR * 1.6, P.handR * 1.8, P.handR * 1.45);
  T(hand, [0.008, handY, 0], [0, 0, 0], ctx.lod > 0 ? [0.85, 1.05, 0.8] : 1);
  b.add(hand, ctx.v.body === 'spirit' ? pal.skin : pal.skin, { morph: lower });
  if (ex.has('armor')) {
    const br = cyl(P.armR * 1.25, P.armR * 1.1, P.fore * 0.55, ctx.lod ? 6 : 5, true);
    T(br, [0, elbowY - P.fore * 0.55, 0]);
    b.add(br, ctx.mortal ? pal.leather : pal.accentMetal, { morph: lower });
  } else if (ctx.mortal && ctx.lod > 0) {
    // leather wrist wrap
    const wr = cyl(P.armR * 0.95, P.armR * 0.92, P.fore * 0.3, 6, true);
    T(wr, [0, elbowY - P.fore * 0.8, 0]);
    b.add(wr, pal.leather, { morph: lower });
  }
  if (ctx.grand && ctx.lod > 0 && ctx.v.body !== 'spirit') {
    // god bracer: a metal cuff carrying a band of glowing runes
    if (!ex.has('armor') && !ex.has('multi_arms') && !ex.has('jewelry')) {
      const cuff = cyl(P.armR * 1.16, P.armR * 1.04, P.fore * 0.42, 7, true);
      T(cuff, [0, elbowY - P.fore * 0.6, 0]);
      b.add(cuff, pal.accentMetal, { morph: lower });
    }
    const runes = cyl(P.armR * 1.28, P.armR * 1.2, 0.022, 7, true);
    T(runes, [0, elbowY - P.fore * 0.55, 0]);
    b.add(runes, tintC(pal.glow, 0.25), { glow: 0.9, morph: lower });
  }
  if (ex.has('jewelry')) {
    const band = cyl(P.armR * 1.3, P.armR * 1.3, 0.025, 6, true);
    T(band, [0, elbowY * 0.45, 0]);
    b.add(band, pal.accentMetal);
    const wr = cyl(P.armR * 1.1, P.armR * 1.1, 0.02, 6, true);
    T(wr, [0, elbowY - P.fore * 0.85, 0]);
    b.add(wr, pal.accentMetal, { morph: lower });
  }
  if (ex.has('chains')) {
    const sh = cyl(P.armR * 1.35, P.armR * 1.35, 0.05, 6, true);
    T(sh, [0, elbowY - P.fore * 0.8, 0]);
    b.add(sh, pal.darkMetal, { morph: lower });
    for (let i = 0; i < 4; i++) {
      const l = torus(0.022 * sizeK * 1.4, 0.007 * sizeK * 1.6, 3, 5);
      T(l, [-0.01, elbowY - P.fore * 0.85 - (i + 1) * 0.035 * sizeK * 1.3, side * P.armR * 0.6], [0, i % 2 ? PI / 2 : 0, 0]);
      b.add(l, pal.darkMetal, { morph: lower });
    }
  }
  if (item && item.kind !== 'none') {
    const id = item.id;
    let grip = 'fwd';
    if (item.kind === 'weapon') grip = (WEAPON_INFO[id] || WEAPON_INFO.none).grip;
    else if (item.kind === 'bow') grip = 'bow';
    else if (item.kind === 'offhand') grip = id === 'lantern' ? 'hang' : 'fwd';
    const size = P.weaponSize * sizeK;
    if (item.kind === 'offhand' && id === 'shield') {
      b.frame([0.0, elbowY - P.fore * 0.5, side * (P.armR + 0.035 * size)], [0, 0, 0.35], 1, () => {
        addOffhand(b, pal, 'shield', size * (P.weaponSize > 1 ? 0.9 : 1));
      });
      // mark the shield pieces as part of the forearm
      for (const it of b.items.slice(-3)) it.morph = lower;
    } else if (grip !== 'fist') {
      const start = b.items.length;
      b.frame([0.01, handY, side * 0.005], gripRotation(grip), 1, () => {
        if (item.kind === 'weapon') addWeapon(b, pal, id, size, { glowBlade: ctx.grand && id === 'sword', lowDetail: ctx.lod === 0 });
        else if (item.kind === 'bow') addWeapon(b, pal, 'bow', size);
        else if (item.kind === 'tool') addTool(b, pal, id, size);
        else addOffhand(b, pal, id, size, { dark: ctx.unit.id && ctx.unit.id.includes('tezcatlipoca') });
      });
      for (const it of b.items.slice(start)) it.morph = it.morph ? { ...lower, ...it.morph } : lower;
    }
  }
  return b.build();
}

/** Leg mesh geometry (pivot at the hip joint). */
function buildLeg(ctx, P, side) {
  const { pal, ex } = ctx;
  const b = new PartBuilder();
  const L = P.hipY;
  const kneeY = -P.thigh;
  const pants = ex.has('skirt') || P.bare ? (P.bare ? pal.skin : shadeC(pal.primary, 0.8)) : shadeC(pal.primary, 0.78);
  const lower = hingeMorphs(b, [null, 'k45', 'k90'], KNEE_SAMPLES.map((a) => -a), [0, kneeY, 0], [0, 0, 1]);
  const boot = ctx.v.body === 'beast_biped' ? pal.skinDark : ex.has('armor') ? shadeC(pal.accentMetal, 0.75) : pal.leather;
  if (P.digi) {
    const k = [0.05, kneeY, 0];
    const ank = [-0.07, kneeY - P.thigh * 0.95, 0];
    b.add(seg([0, 0.03, 0], k, P.legR * 1.25, P.legR, 5, true), pants);
    b.add(seg(k, ank, P.legR * 0.95, P.legR * 0.7, 5, true), P.bare ? pal.skin : pants, { morph: lower });
    b.add(seg(ank, [0.0, -L + P.footH * 0.6, 0], P.legR * 0.7, P.legR * 0.6, 4, true), pal.skin, { morph: lower });
    const foot = box(P.footL, P.footH, P.legR * 2.1);
    T(foot, [P.footL * 0.32, -L + P.footH / 2, 0]);
    b.add(foot, boot, { morph: lower });
  } else {
    const ls = ctx.lod > 0 ? 6 : 5;
    b.add(seg([0, 0.03, 0], [0, kneeY, 0], P.legR * 1.25, P.legR * 0.98, ls, true), pants);
    const knee = joint(ctx, P.legR * 0.98);
    T(knee, [0, kneeY, 0]);
    b.add(knee, pants, { morph: lower });
    const shinY = -L + P.footH;
    if (ctx.mortal && !P.bare) {
      // trouser to mid-shin, then a boot shaft with a cuff
      const mid = kneeY + (shinY - kneeY) * 0.38;
      b.add(seg([0, kneeY, 0], [0, mid, 0], P.legR * 0.98, P.legR * 0.88, ls, true), pants, { morph: lower });
      b.add(seg([0, mid, 0], [0, shinY, 0], P.legR * 0.98, P.legR * 0.9, ls, true), boot, { morph: lower });
      const cuffB = cyl(P.legR * 1.12, P.legR * 1.08, 0.03, ls, true);
      T(cuffB, [0, mid, 0]);
      b.add(cuffB, shadeC(boot, 0.8), { morph: lower });
    } else {
      b.add(seg([0, kneeY, 0], [0, shinY, 0], P.legR, P.legR * 0.85, ls, true), P.bare ? pal.skin : pants, { morph: lower });
    }
    const foot = taper(P.footL, P.footH, P.legR * 2.0, 1, 0.8);
    T(foot, [P.footL * 0.25, -L, 0], [0, 0, 0]);
    b.add(foot, boot, { morph: lower });
    if (ex.has('armor') && ctx.lod > 0) {
      const gr = box(P.legR * 1.4, (L - P.thigh) * 0.6, P.legR * 2.2);
      T(gr, [P.legR * 0.35, kneeY - (L - P.thigh) * 0.38, 0]);
      b.add(gr, pal.accentMetal, { morph: lower });
    }
  }
  return b.build();
}

/** Static extra arms for multi_arms (Shiva, Vishnu, Durga). */
function addExtraArms(b, ctx, P, sh) {
  const { pal } = ctx;
  const items = ['lotus', 'orb', 'blade', 'shell'];
  for (let pair = 0; pair < 2; pair++) {
    for (const side of [1, -1]) {
      const base = [-0.03 - pair * 0.02, sh - 0.06 - pair * 0.07, side * (P.shoulderZ - 0.02)];
      const out = pair === 0 ? 0.95 : 1.45;
      const up = pair === 0 ? 0.55 : 0.0;
      const elbow = [base[0] + 0.02, base[1] + Math.cos(out) * -P.upper * -0.2 + up * 0.08, base[2] + side * Math.sin(out) * P.upper];
      const hand = [elbow[0] + 0.05, elbow[1] + P.fore * (pair === 0 ? 0.95 : 0.6), elbow[2] + side * P.fore * (pair === 0 ? 0.25 : 0.45)];
      b.add(seg(base, elbow, P.armR * 0.95, P.armR * 0.85, 5, true), pal.skin);
      b.add(seg(elbow, hand, P.armR * 0.85, P.armR * 0.75, 5, true), pal.skin);
      const h = box(P.handR * 1.4, P.handR * 1.5, P.handR * 1.3);
      T(h, hand);
      b.add(h, pal.skin);
      const it = items[(pair * 2 + (side > 0 ? 0 : 1)) % items.length];
      const ip = [hand[0], hand[1] + 0.07, hand[2]];
      if (it === 'lotus') {
        for (let i = 0; i < 4; i++) {
          const pet = cone(0.03, 0.07, 3);
          T(pet, ip, [Math.cos(i * 1.57) * 0.5, 0, Math.sin(i * 1.57) * 0.5]);
          b.add(pet, C('#f2a0c0'), { glow: 0.2 });
        }
      } else if (it === 'orb') {
        const o = octa(0.045);
        T(o, ip);
        b.add(o, tintC(pal.glow, 0.3), { glow: 1 });
      } else if (it === 'blade') {
        const bl = taper(0.04, 0.22, 0.015, 0.4, 1);
        T(bl, [hand[0], hand[1] + 0.02, hand[2]]);
        b.add(bl, pal.accentMetal);
      } else {
        const s = cone(0.035, 0.1, 5);
        T(s, ip, [0, 0, -0.5]);
        b.add(s, pal.white);
      }
    }
  }
}

/**
 * Layered pauldrons for gods, titans and creatures: three overlapping
 * lames stepping down and out over the upper arm (a hard, armoured shoulder
 * line instead of a round pad), the lowest edged in team paint, with a
 * glowing stud on gods. Beasts and giants without armour get leather lames.
 */
function addPauldrons(b, ctx, P, sh) {
  const { pal, ex } = ctx;
  const plated = ctx.grand || ex.has('armor');
  const top = plated ? pal.accentMetal : pal.leather;
  const mid = plated ? shadeC(pal.accentMetal, 0.82) : shadeC(pal.leather, 0.8);
  const R = P.padR * (ctx.grand ? 1.12 : 1);
  for (const side of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const lame = dome(R * (1.12 - k * 0.1), 6, 2);
      T(lame, [-k * 0.006, sh - 0.012 - k * R * 0.42, side * (P.shoulderZ * 1.02 + k * R * 0.22)],
        [side * -(0.38 + k * 0.28), 0, 0], [1.18, 0.58, 1]);
      b.add(lame, k === 2 ? TEAM(1, 'painted') : k === 0 ? top : mid);
    }
    if (ctx.grand) {
      const stud = octa(R * 0.2);
      T(stud, [0, sh - 0.012 + R * 0.62, side * P.shoulderZ * 1.04], [0, 0, 0], [1, 0.7, 1]);
      b.add(stud, tintC(pal.glow, 0.2), { glow: 0.85 });
    }
  }
}

/** Pantheons whose gods get each signature piece (see addGodRegalia). */
const REGALIA = {
  egyptian: 'usekh', norse: 'mantle', hindu: 'halo', japanese: 'banner', chinese: 'flags',
  aztec: 'fan', celtic: 'torc', mesopotamian: 'fleece', west_african: 'beads', greek: 'fibula',
};

/**
 * God costume on top of the base torso: a jewelled medallion on the chest and
 * one signature piece per pantheon that changes the silhouette (a broad
 * collar, a flame halo, back banners, a feather fan ...). Giants keep the
 * medallion only: their bulk already carries the silhouette.
 */
function addGodRegalia(b, ctx, P, sh) {
  const { v, pal, ex } = ctx;
  const k = P.chestW / 0.38;
  const frontX = P.chestD * 0.5;
  const backX = -P.chestD * 0.5 - 0.012;
  const headY = P.headY - P.hipY;
  // chest medallion: a gold ring around a glowing gem
  const ring = torus(0.042 * k, 0.011 * k, 3, 6);
  T(ring, [frontX + (ex.has('armor') ? 0.03 : 0.012), sh * 0.66, 0], [0, PI / 2, 0]);
  b.add(ring, pal.accentMetal);
  const gem = octa(0.032 * k);
  T(gem, [frontX + (ex.has('armor') ? 0.035 : 0.018), sh * 0.66, 0], [0, 0, 0], [0.6, 1.2, 1]);
  b.add(gem, tintC(pal.glow, 0.15), { glow: 1 });
  if (v.body === 'giant') return;
  const piece = REGALIA[ctx.unit.pantheon];
  const team = TEAM(1, 'trim');
  if (piece === 'usekh') {
    // broad collar: banded rings fanning over the shoulders
    const cols = [pal.accentMetal, TEAM(1, 'trim'), withMat('#2a9a9a', 'lacquer'), pal.accentMetal];
    for (let i = 0; i < 4; i++) {
      const c = cyl(P.chestW * (0.24 + i * 0.065), P.chestW * (0.3 + i * 0.065), 0.028, 10, true);
      T(c, [0.012, sh - 0.005 - i * 0.026, 0], [0, 0, 0.06], [P.chestD / P.chestW * 1.25, 1, 1]);
      b.add(c, cols[i], i === 0 ? { glow: 0.1 } : {});
    }
  } else if (piece === 'mantle' && !ex.has('fur')) {
    // a wolf-fur mantle over the shoulders and back
    for (let i = 0; i < 6; i++) {
      const a = PI * (0.42 + i / 5 * 1.16);
      const f = octa(P.chestW * 0.15);
      T(f, [Math.cos(a) * P.chestD * 0.5 - 0.01, sh - 0.01, Math.sin(a) * P.chestW * 0.5], [a, a * 2, 0], [1.3, 0.75, 1.15]);
      b.add(f, pal.fur, { mat: 'fur' });
    }
  } else if (piece === 'halo' && !ex.has('aura_ring')) {
    // prabhavali: an arch of flames behind the head
    const R = P.headR * 2.3;
    const c = [backX - 0.06, headY - P.headR * 0.4, 0];
    const arch = torus(R, R * 0.06, 3, 12, PI);
    T(arch, c, [0, PI / 2, 0]);
    b.add(arch, pal.accentMetal, { glow: 0.3 });
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * PI;
      const f = cone(R * 0.11, R * 0.32, 4);
      T(f, [c[0], c[1] + Math.sin(a) * R * 1.12, Math.cos(a) * R * 1.12], [-(a - PI / 2), 0, 0]);
      b.add(f, i % 2 ? pal.fire : pal.fireHot, { glow: 1 });
    }
  } else if (piece === 'banner' && !ex.has('aura_ring')) {
    // sashimono: a tall team banner on a pole at the back
    const x = backX - 0.04;
    b.add(seg([x, sh - 0.22, 0], [x, sh + 0.78, 0], 0.012, 0.01, 4), pal.woodDark);
    const flag = slab([[0, 0], [0.34, 0], [0.34, -0.5], [0, -0.5]], 0.012);
    T(flag, [x - 0.004, sh + 0.74, -0.17], [0, PI / 2, 0]);
    b.add(flag, team);
    const mon = octa(0.06);
    T(mon, [x - 0.02, sh + 0.5, 0], [0, 0, 0], [0.3, 1, 1]);
    b.add(mon, pal.accent, { glow: 0.4 });
  } else if (piece === 'flags' && ex.has('armor')) {
    // kaoqi: four pennants fanned out behind a general's shoulders
    for (let i = 0; i < 4; i++) {
      const z = (i - 1.5) * 0.075;
      const lean = (i - 1.5) * 0.16;
      b.frame([backX - 0.05, sh - 0.15, z], [lean, 0, 0.08], 1, () => {
        b.add(seg([0, 0, 0], [0, 0.82, 0], 0.01, 0.008, 4), pal.woodDark);
        const f = slab([[0, 0], [0, -0.32], [0.2, -0.05]], 0.01);
        T(f, [0, 0.8, 0], [0, PI / 2, 0]);
        b.add(f, i % 2 ? team : TEAM(0.75, 'trim'));
      });
    }
  } else if (piece === 'flags') {
    // pibo: a celestial ribbon arcing over the shoulders
    for (const side of [1, -1]) {
      const pts = [[backX, sh + 0.02, side * 0.08], [backX - 0.12, sh + 0.14, side * 0.3], [backX - 0.08, sh - 0.18, side * 0.42], [backX - 0.02, -0.25, side * 0.4]];
      for (const g of tube(pts, [0.016, 0.018, 0.018, 0.008], 4)) b.add(g, withMat(tintC(pal.secondary, 0.25), 'trim'), { glow: 0.15 });
    }
  } else if (piece === 'fan' && !ex.has('feather_cloak')) {
    // quetzal feather fan rising behind the shoulders
    const cols = [withMat('#1f9a6a', 'feather'), pal.accent, withMat('#2bb39a', 'feather'), pal.primary];
    for (let i = 0; i < 9; i++) {
      const a = (i / 8 - 0.5) * 2.4;
      const f = slab([[-0.035, 0], [0.035, 0], [0.025, 0.42], [0, 0.48], [-0.025, 0.42]], 0.012);
      T(f, [backX - 0.06, sh - 0.05, 0], [a, PI / 2, 0]);
      b.add(f, cols[i % 4], { glow: i % 4 === 1 ? 0.2 : 0 });
    }
  } else if (piece === 'torc') {
    const torc = torus(P.headR * 0.95, 0.013 * k, 3, 10, PI * 1.7);
    T(torc, [0.01, sh + 0.02, 0], [PI / 2, 0, PI * 0.15 + PI]);
    b.add(torc, pal.accentMetal, { glow: 0.1 });
    for (const side of [1, -1]) {
      const knob = octa(0.022 * k);
      T(knob, [P.headR * 0.85, sh + 0.02, side * 0.035]);
      b.add(knob, pal.accentMetal, { glow: 0.3 });
    }
  } else if (piece === 'fleece') {
    // kaunakes: tiered tufted fleece hanging from the waist or the shoulders
    const tiers = ex.has('skirt') ? [[-0.1, 0.62, 0.74], [-0.22, 0.72, 0.84]] : [[sh - 0.04, 0.5, 0.62], [sh - 0.12, 0.58, 0.68]];
    tiers.forEach(([y, r0, r1], i) => {
      const t = cyl(P.chestW * r0, P.chestW * r1, 0.09, 10, true);
      T(t, [0, y, 0], [0, PI / 10, 0], [P.chestD / P.chestW * 1.3, 1, 1]);
      b.add(t, i ? shadeC(pal.secondary, 0.85) : pal.secondary, { mat: 'fur' });
    });
  } else if (piece === 'beads' && !ex.has('armor')) {
    // a collar of beads and cowries
    for (let i = 0; i < 11; i++) {
      const a = PI * (-0.5 + i / 10);
      const bead = octa(i % 2 ? 0.026 * k : 0.022 * k);
      T(bead, [Math.cos(a) * P.chestD * 0.42 + 0.01, sh - 0.05 - Math.cos(a) * 0.06, Math.sin(a) * P.chestW * 0.36]);
      b.add(bead, i % 2 ? pal.white : i % 4 === 0 ? pal.accentMetal : team);
    }
  } else if (piece === 'fibula') {
    // a gold meander band over the chest and round brooches pinning the cloak
    const band = box(P.chestD * 1.02, 0.028, P.chestW * 0.98);
    T(band, [0, sh * 0.86, 0]);
    b.add(band, pal.accentMetal);
    for (const side of [1, -1]) {
      const fib = cyl(0.03 * k, 0.03 * k, 0.012, 8);
      T(fib, [frontX * 0.8, sh - 0.02, side * P.chestW * 0.36], [0, 0, PI / 2]);
      b.add(fib, pal.accentMetal, { glow: 0.2 });
    }
  }
}

/** Torso mesh for humanoid-family bodies (pivot at hip height). */
function buildTorso(ctx, P, opts = {}) {
  const { v, pal, ex, cls } = ctx;
  const b = opts.into || new PartBuilder();
  const sh = P.shoulderY - P.hipY;
  const bare = P.bare && !ex.has('armor');
  const spirit = v.body === 'spirit';
  const cloth = ctx.tunic || pal.primary;
  if (!opts.noHips && bare) {
    const hips = taper(P.depth * 1.02, 0.16, P.waistW, 1, 1);
    T(hips, [0, -0.09, 0]);
    b.add(hips, shadeC(pal.primary, 0.85));
  }
  const y0 = opts.noHips || bare ? 0.04 : -0.09;
  const tH = sh - y0 + 0.01;
  if (ctx.lod > 0 && !bare) {
    // rounded tunic: an elliptical barrel, broad at the chest, with a
    // rounded top over the shoulders
    const sx = (P.chestD / P.chestW + P.depth / P.waistW) / 2;
    const torso = cyl(P.chestW / 2, P.waistW * 0.48, tH * 0.86, 8);
    T(torso, [0, y0 + tH * 0.43, 0], [0, 0, 0], [sx, 1, 1]);
    b.add(torso, cloth);
    const top = cyl(P.chestW * 0.3, P.chestW / 2, tH * 0.14, 8);
    T(top, [0, y0 + tH * 0.93, 0], [0, 0, 0], [sx, 1, 1]);
    b.add(top, cloth);
  } else {
    const torso = taper(P.depth, tH, P.waistW * 0.96, P.chestD / P.depth, P.chestW / (P.waistW * 0.96), 0.012);
    T(torso, [0, y0, 0]);
    b.add(torso, bare ? pal.skin : cloth);
  }
  if (bare) {
    const pec = box(0.05, sh * 0.25, P.chestW * 0.7);
    T(pec, [P.chestD / 2 - 0.005, sh * 0.72, 0]);
    b.add(pec, pal.skinDark);
  }
  // belt + team sash
  const belt = box(P.depth * 1.08, 0.055, P.waistW * 1.04);
  T(belt, [0, 0.06, 0]);
  b.add(belt, ctx.mortal ? pal.leather : spirit ? TEAM(0.9) : pal.secondary, { mat: 'leather' });
  if (ctx.lod > 0) {
    const buckle = box(0.03, 0.05, 0.06);
    T(buckle, [P.depth * 0.55, 0.06, 0]);
    b.add(buckle, pal.accentMetal);
  }
  if (!spirit) {
    // team sash; over a team tunic it is a leather baldric instead
    const sash = box(P.chestD * 1.06, ctx.tunic ? 0.04 : 0.06, P.chestW * 1.08);
    T(sash, [0.004, sh * 0.5, 0], [0.72, 0, 0]);
    b.add(sash, ctx.tunic ? pal.leather : TEAM(1), ctx.tunic ? { mat: 'leather' } : {});
  }
  if (ctx.mortal && cls === 'support') {
    // priest's stole: two team bands hanging down the front of the robe
    for (const side of [1, -1]) {
      const st = box(0.02, sh * 0.95 + 0.2, 0.05);
      T(st, [P.chestD * 0.47, sh * 0.5 - 0.16, side * P.chestW * 0.16], [0, 0, 0.08]);
      b.add(st, TEAM(1), { mat: 'trim' });
    }
  }
  if (ctx.mortal && ex.has('armor')) {
    // pteruges: a short team kilt of leather-edged strips under the cuirass
    const k = cyl(P.waistW * 0.55, P.waistW * 0.68, 0.17, 8, true);
    T(k, [0, -0.13, 0], [0, 0, 0], [P.depth / P.waistW * 1.3, 1, 1]);
    b.add(k, TEAM(0.8));
    const hem = cyl(P.waistW * 0.69, P.waistW * 0.7, 0.03, 8, true);
    T(hem, [0, -0.2, 0], [0, 0, 0], [P.depth / P.waistW * 1.3, 1, 1]);
    b.add(hem, pal.leather);
  }
  // loincloth flap (front) for bare bodies and gods without skirt
  if (bare || (!ex.has('skirt') && ctx.grand)) {
    // gods wear a long team tabard with a metal hem; bare bodies a loincloth
    const tab = ctx.grand && !bare;
    const fl = tab ? 0.29 : 0.2;
    const flap = taper(0.03, fl, P.waistW * (tab ? 0.62 : 0.55), 1, tab ? 0.72 : 0.8);
    T(flap, [P.depth * 0.52, -0.04 - fl, 0]);
    b.add(flap, bare ? pal.primary : TEAM(0.9));
    if (tab) {
      const hem = box(0.036, 0.035, P.waistW * 0.6);
      T(hem, [P.depth * 0.52, -0.04 - fl + 0.03, 0]);
      b.add(hem, pal.accentMetal);
    }
    const back = taper(0.03, 0.18, P.waistW * 0.55, 1, 0.8);
    T(back, [-P.depth * 0.52, -0.22, 0]);
    b.add(back, bare ? shadeC(pal.primary, 0.8) : TEAM(0.7));
  }
  if (ex.has('skirt')) {
    const long = ctx.worker || cls === 'support' || (ctx.grand && !ex.has('armor'));
    const h = long ? 0.3 : 0.22;
    const sides = ctx.lod ? 8 : 6;
    const sk = cyl(P.waistW * 0.56, P.waistW * (long ? 0.86 : 0.78), h, sides, true);
    T(sk, [0, 0.03 - h / 2, 0], [0, PI / sides, 0], [P.depth / P.waistW * 1.2, 1, 1]);
    b.add(sk, ctx.skirt || pal.primary);
    const trim = cyl(P.waistW * (long ? 0.87 : 0.79), P.waistW * (long ? 0.88 : 0.8), 0.035, sides, true);
    T(trim, [0, 0.03 - h + 0.015, 0], [0, PI / sides, 0], [P.depth / P.waistW * 1.2, 1, 1]);
    b.add(trim, ctx.mortal && cls === 'support' ? TEAM(0.9, 'trim') : pal.secondary);
  }
  if (ex.has('armor')) {
    const plate = taper(P.depth * 0.55, sh * 0.62, P.waistW * 0.9, P.chestD / P.depth, P.chestW / P.waistW * 0.95, 0.02);
    T(plate, [P.depth * 0.26, sh * 0.32, 0]);
    b.add(plate, pal.accentMetal);
    if (ctx.lod > 0) {
      const back = taper(P.depth * 0.3, sh * 0.55, P.waistW * 0.85, 1.1, P.chestW / P.waistW * 0.9, -0.01);
      T(back, [-P.depth * 0.38, sh * 0.35, 0]);
      b.add(back, shadeC(pal.accentMetal, 0.8));
    }
  }
  // neck + head
  const headPos = [P.headX, P.headY - P.hipY, 0];
  if (v.head !== 'none' || opts.forceHead) {
    b.add(seg([0, sh - 0.04, 0], [P.headX * 0.8, headPos[1] - P.headR * 0.55, 0], 0.055 * (P.headR / 0.15), 0.05 * (P.headR / 0.15), 5, true), pal.skin);
  } else {
    const stump = cyl(0.06, 0.07, 0.04, 6);
    T(stump, [0, sh + 0.0, 0]);
    b.add(stump, C('#7a1a1a'));
  }
  const heads = v.heads > 1 ? Math.min(3, v.heads) : 1;
  let anchor = null;
  for (let i = 0; i < heads; i++) {
    const off = heads === 1 ? 0 : (i - (heads - 1) / 2) * P.headR * 1.9;
    const sc = heads > 1 && off !== 0 ? 0.85 : 1;
    b.frame([headPos[0] - Math.abs(off) * 0.3, headPos[1] - Math.abs(off) * 0.2, off], [Math.sign(off) * 0.25 * -1, Math.sign(off) * 0.35, 0], P.headR * sc, () => {
      const a = headAssembly(b, ctx, v.head);
      if (!anchor) anchor = a;
    });
  }
  // shoulders: armored mortals wear metal pauldrons, other mortals rounded
  // sleeves; gods and creatures keep team-painted pads
  if (ctx.mortal && !spirit && !ex.has('armor') && ctx.lod > 0) {
    for (const side of [1, -1]) {
      const s0 = dome(P.armR * 1.6, 6, 2);
      T(s0, [0, sh - 0.045, side * P.shoulderZ * 0.98], [side * -0.5, 0, 0], [1.05, 1, 1]);
      b.add(s0, ctx.sleeve || cloth);
    }
  }
  if (ctx.mortal && ex.has('armor')) {
    for (const side of [1, -1]) {
      const pad = dome(P.padR, 6, 2);
      T(pad, [0, sh - 0.015, side * P.shoulderZ * 1.02], [side * -0.35, 0, 0], [1.1, 0.85, 1]);
      b.add(pad, pal.accentMetal);
      if (ctx.lod > 0) {
        const rim = cyl(P.padR * 1.18, P.padR * 1.22, 0.03, 6, true);
        T(rim, [0, sh - 0.02, side * P.shoulderZ * 1.04], [side * -0.35, 0, 0]);
        b.add(rim, TEAM(1, 'painted'));
      }
    }
  } else if (!ctx.worker && !spirit && !ctx.mortal) addPauldrons(b, ctx, P, sh);
  if (!ctx.worker && !spirit && !ctx.mortal && ex.has('spikes')) {
    for (const side of [1, -1]) {
      const sp = cone(P.padR * 0.35, P.padR * 1.3, 4);
      T(sp, [0, sh + P.padR * 0.7, side * P.shoulderZ * 1.15], [side * 0.5, 0, 0]);
      b.add(sp, pal.horn);
    }
  }
  if (ctx.grand && !spirit && ctx.lod > 0) addGodRegalia(b, ctx, P, sh);
  if (ex.has('spikes')) {
    for (let i = 0; i < 3; i++) {
      const sp = cone(0.035, 0.12, 4);
      T(sp, [-P.chestD * 0.5 - 0.02, sh * (0.85 - i * 0.25), 0], [0, 0, 0.9]);
      b.add(sp, pal.horn);
    }
  }
  if (ex.has('fur')) {
    // fur mantle over the shoulders and back (kept clear of the face)
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = PI * (0.5 + i / (n - 1));
      const f = octa(P.chestW * 0.15);
      T(f, [Math.cos(a) * P.chestD * 0.5 - 0.01, sh - 0.01, Math.sin(a) * P.chestW * 0.46], [a, a * 2, 0], [1.25, 0.75, 1.15]);
      b.add(f, P.bare && ctx.v.body !== 'giant' ? pal.back : pal.fur, { mat: 'fur' });
    }
  }
  if (ex.has('jewelry')) {
    const col = cyl(0.13 * (P.chestW / 0.38), 0.15 * (P.chestW / 0.38), 0.03, 8, true);
    T(col, [0.01, sh - 0.01, 0]);
    b.add(col, pal.accentMetal, { glow: 0.15 });
    const col2 = cyl(0.155 * (P.chestW / 0.38), 0.165 * (P.chestW / 0.38), 0.02, 8, true);
    T(col2, [0.012, sh - 0.035, 0]);
    b.add(col2, pal.secondary);
  }
  if (ex.has('chains')) {
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const l = torus(0.028, 0.009, 3, 5);
      T(l, [P.chestD * 0.52, sh * (0.15 + t * 0.75), (t - 0.5) * P.chestW * 0.9], [0, PI / 2, i % 2 ? PI / 2 : 0], [1, 1, 1]);
      b.add(l, pal.darkMetal);
    }
  }
  if (ex.has('flames')) {
    for (const side of [1, -1]) {
      b.frame([-0.02, sh + 0.02, side * P.shoulderZ * 0.95], [0, 0, 0], 0.09 * (P.chestW / 0.38), () => {
        for (let i = 0; i < 3; i++) {
          const f = cone(0.45, 1.3 - i * 0.25, 4);
          T(f, [(i - 1) * 0.35, 0.6 - i * 0.1, side * 0.2 * i], [side * 0.2, 0, 0.15]);
          b.add(f, i === 1 ? pal.fireHot : pal.fire, { glow: 1, morph: flickerMorph(b, [(i - 1) * 0.35, 0, 0], 0.35) });
        }
      });
    }
    b.frame([-P.chestD * 0.5, sh * 0.7, 0], [0, 0, 0], 0.1 * (P.chestW / 0.38), () => {
      for (let i = 0; i < 3; i++) {
        const f = cone(0.5, 1.6, 4);
        T(f, [-0.2, 0.4 + i * 0.1, (i - 1) * 0.7], [0, 0, 0.5]);
        b.add(f, i === 1 ? pal.fireHot : pal.fire, { glow: 1, morph: flickerMorph(b, [0, 0, (i - 1) * 0.7], 0.3) });
      }
    });
  }
  // back: cape / feather cloak / wings / shell / tail / aura ring
  const backX = -P.chestD * 0.5 - 0.012;
  if (ex.has('cape') && !spirit) {
    const L = sh + P.hipY - 0.14;
    const wt = P.chestW * 0.8;
    const wb = P.chestW * 1.3;
    const pts = [[-wb / 2, -L], [wb / 2, -L], [wt / 2, 0], [-wt / 2, 0]];
    b.push([backX, sh - 0.01, 0], [0, 0, -0.14], 1);
    const capeMorph = { cape: b.rotMorphLocal([0, 0, 0], [0, 0, 1], -0.65) };
    const capeG = slab(pts, 0.024);
    T(capeG, [0, 0, 0], [0, PI / 2, 0]);
    b.add(capeG, TEAM(1), { morph: capeMorph });
    const hem = slab([[-wb / 2 - 0.005, -L], [wb / 2 + 0.005, -L], [wb / 2, -L + 0.045], [-wb / 2, -L + 0.045]], 0.03);
    T(hem, [0, 0, 0], [0, PI / 2, 0]);
    b.add(hem, ctx.grand ? pal.accent : pal.secondary, { morph: capeMorph });
    b.pop();
    if (ctx.lod > 0) {
      const clasp = octa(0.035);
      T(clasp, [P.chestD * 0.42, sh - 0.02, P.chestW * 0.38]);
      b.addSym(clasp, pal.accentMetal);
    }
  }
  if (ex.has('feather_cloak')) {
    const rows = [pal.primary, pal.secondary, pal.accent];
    b.push([backX - 0.01, sh + 0.0, 0], [0, 0, -0.18], 1);
    const cm = { cape: b.rotMorphLocal([0, 0, 0], [0, 0, 1], -0.5) };
    const L = sh + P.hipY * 0.6;
    // with wings on the back as well, one cloak row is enough
    const nRows = ex.has('wings') ? 1 : 3;
    for (let r = 0; r < nRows; r++) {
      const y0 = -r * L * 0.3;
      const wt = P.chestW * (0.85 + r * 0.22);
      const wb = P.chestW * (1.05 + r * 0.25);
      const n = 5 + r;
      const len = L * 0.45;
      const pts = [[-wt / 2, 0], [wt / 2, 0]];
      for (let i = n; i >= 0; i--) {
        const z = (i / n - 0.5) * wb;
        pts.push([z, i % 2 ? -len : -len * 0.78]);
      }
      const f = slab(pts, 0.02);
      T(f, [-0.012 * r, y0, 0], [0, PI / 2, 0]);
      b.add(f, rows[r], { morph: cm });
    }
    b.pop();
    for (const side of [1, -1]) {
      const sf = slab([[-0.06, 0], [0.06, 0], [0.04, -0.14], [0, -0.17], [-0.04, -0.14]], 0.02);
      T(sf, [0, sh + 0.03, side * P.shoulderZ * 1.15], [side * 0.6, 0, 0]);
      b.add(sf, pal.accent);
    }
  }
  if (ex.has('wings')) {
    const span = ctx.unit.air ? 0.7 : 0.58;
    addWings(b, pal, backX - 0.01, sh - 0.04, 0.07, {
      span: span * (P.chestW / 0.38), style: 'feather', colA: pal.primary, colB: tintC(pal.secondary, 0.15), colC: ctx.grand ? pal.accent : null,
      sweep: 0.5, lift: 0.35,
    });
  }
  if (ex.has('shell')) {
    const s = dome(P.chestW * 0.55, 7, 2);
    T(s, [backX - 0.02, sh * 0.5, 0], [0, 0, PI / 2], [0.55, 1.1, 1]);
    b.add(s, pal.secondary, { mat: 'bone' });
  }
  if (ex.has('tail')) {
    const hk = v.head;
    const style = hk === 'fox' ? 'bushy' : hk === 'lion' || hk === 'bull' || hk === 'cat' ? 'tuft' : hk === 'horse' ? 'hair' : 'plain';
    const col = isAnimalHead(hk) ? pal.skin : pal.skinDark;
    const L = P.hipY;
    addTail(b, pal, [[-P.depth * 0.5, 0.0, 0], [-P.depth * 0.5 - 0.12, -L * 0.45, 0], [-P.depth * 0.5 - 0.26, -L * 0.75, 0.04], [-P.depth * 0.5 - 0.42, -L * 0.62, 0.06], [-P.depth * 0.5 - 0.5, -L * 0.25, 0.05]],
      0.035 * (P.chestW / 0.38), 0.018 * (P.chestW / 0.38), col, { style, amp: 0.08, k: 5, tipColor: hk === 'fox' ? pal.white : shadeC(col, 0.7) });
  }
  if (ex.has('multi_arms')) addExtraArms(b, ctx, P, sh);
  if (ex.has('aura_ring')) {
    const drums = v.weapon === 'drum' || v.offhand === 'drum';
    addAuraRing(b, pal, [backX - 0.08, sh + 0.12, 0], P.chestW * (drums ? 1.15 : 1.05), drums);
  }
  return { geo: opts.into ? null : b.build(), anchor };
}

export function humanoidItems(v) {
  const w = v.weapon;
  if (w === 'bow') return { right: { kind: 'none' }, left: { kind: 'bow', id: 'bow' } };
  const right = w === 'none' ? { kind: 'none' } : { kind: 'weapon', id: w };
  let left = v.offhand !== 'none' ? { kind: 'offhand', id: v.offhand } : { kind: 'none' };
  if (w === 'claws' && v.offhand === 'none') left = { kind: 'weapon', id: 'claws' };
  if (w === 'drum' && v.offhand === 'none') left = { kind: 'weapon', id: 'drum' };
  return { right, left };
}

function humanoidTemplate(ctx, profileName) {
  const { v, pal, ex } = ctx;
  const P = { ...PROFILES[profileName] };
  if (ctx.grand && profileName === 'humanoid') {
    P.chestW *= 1.08;
    P.headR *= 1.0;
    P.weaponSize = 1.15;
  }
  const parts = [];
  const items = humanoidItems(v);
  parts.push({ name: 'pelvis', parent: null, pos: [0, P.hipY, 0], geo: null });
  const torso = buildTorso(ctx, P);
  parts.push({ name: 'torso', parent: 'pelvis', pos: [0, 0, 0], rot: [0, 0, P.lean], geo: torso.geo });
  const sh = P.shoulderY - P.hipY - 0.02;
  parts.push({ name: 'armR', parent: 'torso', pos: [0, sh, P.shoulderZ], geo: buildArm(ctx, P, 1, items.right) });
  parts.push({ name: 'armL', parent: 'torso', pos: [0, sh, -P.shoulderZ], geo: buildArm(ctx, P, -1, items.left) });
  parts.push({ name: 'legR', parent: 'pelvis', pos: [0, 0, P.hipZ], geo: buildLeg(ctx, P, 1) });
  parts.push({ name: 'legL', parent: 'pelvis', pos: [0, 0, -P.hipZ], geo: buildLeg(ctx, P, -1) });
  const rig = {
    hipY: P.hipY, thigh: P.thigh, lean: P.lean, shoulderY: P.shoulderY,
    weapon: v.weapon, offhand: v.offhand, info: WEAPON_INFO[v.weapon] || WEAPON_INFO.none,
    rightElbow: (WEAPON_INFO[v.weapon] || WEAPON_INFO.none).elbow,
    leftElbow: v.weapon === 'bow' ? 0.15 : v.weapon === 'claws' ? 0.3 : OFFHAND_ELBOW[v.offhand] ?? 0.25,
    stride: profileName === 'giant' ? 1.1 : profileName === 'beast_biped' ? 1.0 : 1.25,
    heavy: profileName === 'giant',
    holdAloft: holdsAloft(v),
  };
  if (ctx.worker) {
    // tool variants swapped onto the right arm while gathering / building
    rig.tools = {
      none: parts.find((p) => p.name === 'armR').geo,
      pick: buildArm(ctx, P, 1, { kind: 'tool', id: 'pick' }),
      axe: buildArm(ctx, P, 1, { kind: 'tool', id: 'axe' }),
      hammer: buildArm(ctx, P, 1, { kind: 'tool', id: 'hammer' }),
    };
    // cargo rides on the left shoulder, steadied by the raised left hand
    parts.push({ name: 'carry', parent: 'torso', pos: [-0.04, sh + 0.1, -P.shoulderZ * 1.02], geo: null });
  }
  return { kind: 'humanoid', parts, rig };
}

function spiritTemplate(ctx) {
  const { v, pal } = ctx;
  const P = { ...PROFILES.spirit };
  const parts = [];
  const items = humanoidItems(v);
  parts.push({ name: 'pelvis', parent: null, pos: [0, P.hipY, 0], geo: null });
  const torso = buildTorso(ctx, P, { noHips: false });
  parts.push({ name: 'torso', parent: 'pelvis', pos: [0, 0, 0], rot: [0, 0, -0.08], geo: torso.geo, ghost: true });
  // wispy lower robe: tapering cone trailing behind, waving
  const w = new PartBuilder();
  const pts = [[0, 0.02, 0], [-0.04, -0.18, 0], [-0.14, -0.32, 0], [-0.3, -0.4, 0], [-0.46, -0.38, 0]];
  const R = [0, 0.02, 0];
  const morph = waveMorph((p) => Math.hypot(p.x - R[0], p.y - R[1]), (s) => 0.09 * Math.min(1, s / 0.6), 5, 'z');
  const rad = [0.17, 0.15, 0.1, 0.06, 0.02];
  for (let i = 0; i < pts.length - 1; i++) w.add(seg(pts[i], pts[i + 1], rad[i], rad[i + 1], 7, i > 0), i % 2 ? shadeC(pal.primary, 0.85) : pal.primary, { morph });
  const sash = cyl(0.165, 0.17, 0.05, 7, true);
  T(sash, [0, -0.02, 0]);
  w.add(sash, TEAM(1));
  const wisp = cyl(0.17, 0.17, 0.02, 7);
  T(wisp, [0, 0.03, 0]);
  w.add(wisp, pal.primary);
  parts.push({ name: 'wisp', parent: 'pelvis', pos: [0, 0, 0], geo: w.build(), ghost: true });
  const sh = P.shoulderY - P.hipY - 0.02;
  parts.push({ name: 'armR', parent: 'torso', pos: [0, sh, P.shoulderZ], geo: buildArm(ctx, P, 1, items.right), ghost: true });
  parts.push({ name: 'armL', parent: 'torso', pos: [0, sh, -P.shoulderZ], geo: buildArm(ctx, P, -1, items.left), ghost: true });
  return {
    kind: 'spirit', parts,
    rig: { hipY: P.hipY, weapon: v.weapon, info: WEAPON_INFO[v.weapon] || WEAPON_INFO.none, rightElbow: (WEAPON_INFO[v.weapon] || WEAPON_INFO.none).elbow, leftElbow: OFFHAND_ELBOW[v.offhand] ?? 0.3, float: 0.12 },
  };
}

function nagaTemplate(ctx) {
  const { v, pal } = ctx;
  const P = { ...PROFILES.humanoid, hipY: 0.46, shoulderY: 0.82, headY: 0.99 };
  if (ctx.grand) { P.chestW *= 1.08; P.weaponSize = 1.15; P.padR *= 1.1; }
  const parts = [];
  const items = humanoidItems(v);
  parts.push({ name: 'pelvis', parent: null, pos: [0, P.hipY, 0], geo: null });
  const torso = buildTorso(ctx, P, { noHips: true });
  parts.push({ name: 'torso', parent: 'pelvis', pos: [0, 0, 0], geo: torso.geo });
  // serpent tail (pelvis frame: y = 0 at hip, ground at −hipY)
  const t = new PartBuilder();
  const g = -P.hipY;
  const pts = [[0.0, 0.06, 0], [0.02, -0.16, 0], [-0.05, g + 0.14, 0], [-0.25, g + 0.1, 0.06], [-0.5, g + 0.08, 0.12], [-0.72, g + 0.07, 0.04], [-0.92, g + 0.06, -0.08], [-1.1, g + 0.05, -0.1], [-1.25, g + 0.04, -0.02]];
  const rad = [0.14, 0.14, 0.13, 0.12, 0.1, 0.085, 0.065, 0.045, 0.02];
  const morph = waveMorph((p) => Math.max(0, -p.x), (s) => 0.11 * Math.min(1, s / 0.9), 4.2, 'z');
  const scale = pal.primary;
  for (let i = 0; i < pts.length - 1; i++) {
    t.add(seg(pts[i], pts[i + 1], rad[i], rad[i + 1], 6, i > 0), i % 2 ? scale : shadeC(scale, 0.88), { morph });
    if (i > 0 && i < pts.length - 2) {
      const j = octa(rad[i + 1] * 1.15);
      T(j, pts[i + 1]);
      t.add(j, shadeC(scale, 0.88), { morph });
      const belly = box(0.04, 0.02, rad[i + 1] * 1.4);
      T(belly, [pts[i + 1][0], pts[i + 1][1] - rad[i + 1] * 0.92, pts[i + 1][2]]);
      t.add(belly, pal.secondary, { morph });
    }
  }
  const band = cyl(0.15, 0.15, 0.05, 6, true);
  T(band, [0.005, 0.0, 0]);
  t.add(band, TEAM(1));
  parts.push({ name: 'tail', parent: 'pelvis', pos: [0, 0, 0], geo: t.build() });
  const sh = P.shoulderY - P.hipY - 0.02;
  parts.push({ name: 'armR', parent: 'torso', pos: [0, sh, P.shoulderZ], geo: buildArm(ctx, P, 1, items.right) });
  parts.push({ name: 'armL', parent: 'torso', pos: [0, sh, -P.shoulderZ], geo: buildArm(ctx, P, -1, items.left) });
  return {
    kind: 'naga', parts,
    rig: { hipY: P.hipY, weapon: v.weapon, info: WEAPON_INFO[v.weapon] || WEAPON_INFO.none, rightElbow: (WEAPON_INFO[v.weapon] || WEAPON_INFO.none).elbow, leftElbow: v.weapon === 'bow' ? 0.15 : OFFHAND_ELBOW[v.offhand] ?? 0.25 },
  };
}

// ---------------------------------------------------------------------------
// four-legged family (quadruped, elephant, centaur)
// ---------------------------------------------------------------------------

const QUAD = {
  dog: { L: 0.62, H: 0.25, W: 0.23, leg: 0.3, legR: 0.045, neck: 0.16, neckA: 0.75, headR: 0.13, tail: 0.32, chest: 1.1 },
  horse: { L: 0.74, H: 0.28, W: 0.25, leg: 0.46, legR: 0.045, neck: 0.3, neckA: 1.0, headR: 0.11, tail: 0.38, chest: 1.05, hoof: true },
  cat: { L: 0.7, H: 0.25, W: 0.23, leg: 0.3, legR: 0.055, neck: 0.12, neckA: 0.55, headR: 0.15, tail: 0.5, chest: 1.12 },
  bull: { L: 0.72, H: 0.33, W: 0.32, leg: 0.3, legR: 0.065, neck: 0.1, neckA: 0.3, headR: 0.15, tail: 0.32, chest: 1.18, hoof: true },
  reptile: { L: 1.0, H: 0.2, W: 0.34, leg: 0.17, legR: 0.06, neck: 0.12, neckA: 0.1, headR: 0.13, tail: 0.95, chest: 1.0, sprawl: true },
  sphinx: { L: 0.72, H: 0.26, W: 0.25, leg: 0.3, legR: 0.06, neck: 0.12, neckA: 1.2, headR: 0.15, tail: 0.5, chest: 1.12 },
};

function quadProfile(head, ctx) {
  if (head === 'horse' || ctx.v.body === 'centaur') return QUAD.horse;
  if (head === 'cat' || head === 'lion') return QUAD.cat;
  if (head === 'bull' || head === 'boar' || head === 'ram' || head === 'elephant') return QUAD.bull;
  if (head === 'crocodile' || head === 'dragon' || head === 'serpent') return QUAD.reptile;
  if (head === 'human' || head === 'demon' || head === 'skull' || head === 'monkey') return QUAD.sphinx;
  return QUAD.dog;
}

function buildQuadLeg(ctx, Q, front, colors) {
  const { pal } = ctx;
  const b = new PartBuilder();
  const L = Q.leg;
  const k = -L * 0.5;
  const lower = hingeMorphs(b, [null, 'k45', 'k90'], KNEE_SAMPLES.map((a) => (front ? -a : -a * 0.8)), [0, k, 0], [0, 0, 1]);
  const rTop = Q.legR * (front ? 1.35 : 1.7);
  b.add(seg([front ? 0.0 : -0.02, Q.H * 0.25, 0], [0, k, 0], rTop, Q.legR, 5, true), colors.upper);
  const kn = joint(ctx, Q.legR * 0.98);
  T(kn, [0, k, 0]);
  b.add(kn, colors.upper, { morph: lower });
  b.add(seg([0, k, 0], [front ? 0.0 : -0.02, -L + 0.04, 0], Q.legR, Q.legR * 0.8, 5, true), colors.lower, { morph: lower });
  if (Q.hoof) {
    const h = cyl(Q.legR * 1.05, Q.legR * 1.25, 0.06, 6);
    T(h, [0.0, -L + 0.03, 0]);
    b.add(h, colors.paw, { morph: lower });
  } else {
    const paw = box(Q.legR * 2.6, 0.05, Q.legR * 2.1);
    T(paw, [Q.legR * 0.6, -L + 0.025, 0]);
    b.add(paw, colors.paw, { morph: lower });
    if (ctx.ex.has('fur') || ctx.ex.has('spikes')) {
      const c = cone(0.012, 0.05, 3);
      T(c, [Q.legR * 1.9, -L + 0.02, 0], [0, 0, -PI / 2]);
      b.add(c, pal.bone, { morph: lower });
    }
  }
  if (ctx.ex.has('jewelry')) {
    const band = cyl(Q.legR * 1.2, Q.legR * 1.2, 0.025, 6, true);
    T(band, [0, -L * 0.75, 0]);
    b.add(band, pal.accentMetal, { morph: lower });
  }
  if (ctx.ex.has('armor') && front) {
    const g = box(Q.legR * 1.6, L * 0.3, Q.legR * 2.3);
    T(g, [Q.legR * 0.4, -L * 0.7, 0]);
    b.add(g, pal.accentMetal, { morph: lower });
  }
  return b.build();
}

/** Body + neck/head + 4 legs for quadrupeds (and the horse half of centaurs). */
function quadTemplate(ctx) {
  const { v, pal, ex } = ctx;
  const head = v.head;
  const centaur = v.body === 'centaur';
  const Q = { ...quadProfile(head, ctx) };
  if (ctx.unit.class === 'titan' || v.scale >= 3) Q.legR *= 1.15;
  const parts = [];
  const body = new PartBuilder();
  const cy = Q.leg + Q.H * 0.45;
  const fur = pal.skin;
  const back = pal.back;
  // barrel + chest + rump
  const barrel = ball(1, 7, 4);
  T(barrel, [0, cy, 0], [0, 0, 0], [Q.L * 0.5, Q.H * 0.5, Q.W * 0.5]);
  body.add(barrel, fur);
  const chest = dodeca(1);
  T(chest, [Q.L * 0.3, cy + Q.H * 0.05, 0], [0, 0, 0], [Q.L * 0.24, Q.H * 0.55 * Q.chest, Q.W * 0.52 * Q.chest]);
  body.add(chest, fur);
  const rump = dodeca(1);
  T(rump, [-Q.L * 0.32, cy + Q.H * 0.04, 0], [0, 0, 0], [Q.L * 0.22, Q.H * 0.5, Q.W * 0.5]);
  body.add(rump, fur);
  const dorsal = ball(1, 6, 3);
  T(dorsal, [-0.02, cy + Q.H * 0.28, 0], [0, 0, 0], [Q.L * 0.42, Q.H * 0.22, Q.W * 0.3]);
  body.add(dorsal, back);
  const belly = ball(1, 6, 3);
  T(belly, [0.02, cy - Q.H * 0.25, 0], [0, 0, 0], [Q.L * 0.36, Q.H * 0.2, Q.W * 0.38]);
  body.add(belly, pal.belly);
  // team saddle cloth (or a harness band on huge beasts)
  const topY = cy + Q.H * 0.5;
  if (!centaur && !ex.has('rider')) {
    if (v.scale < 2.6) addSaddle(body, -0.02, topY + 0.005, Q.L * 0.36, Q.W * 1.02, Q.H * 0.55, pal.accentMetal);
    else {
      const band = cyl(Q.W * 0.56, Q.W * 0.56, Q.L * 0.12, 8, true);
      T(band, [-0.05, cy, 0], [0, 0, 0], [Q.H / Q.W, 1, 1]);
      body.add(band, TEAM(1));
      const band2 = band.clone();
      T(band2, [-0.35 * Q.L, 0, 0]);
      body.add(band2, TEAM(0.85));
    }
  }
  if (ex.has('armor')) {
    const plate = taper(0.03, Q.H * 0.8, Q.W * 1.05, 1, 0.9);
    T(plate, [Q.L * 0.48, cy - Q.H * 0.4, 0]);
    body.add(plate, pal.accentMetal);
    const back2 = box(Q.L * 0.5, 0.03, Q.W * 0.9);
    T(back2, [0, topY + 0.02, 0]);
    body.add(back2, shadeC(pal.accentMetal, 0.8));
  }
  if (ex.has('spikes')) {
    for (let i = 0; i < 5; i++) {
      const sp = cone(Q.W * 0.08, Q.H * 0.5, 4);
      T(sp, [Q.L * (0.3 - i * 0.16), topY + Q.H * 0.12, 0], [0, 0, 0.35]);
      body.add(sp, pal.horn);
    }
  }
  if (ex.has('fur')) {
    for (let i = 0; i < 6; i++) {
      const tf = cone(Q.W * 0.16, Q.H * 0.45, 4);
      T(tf, [Q.L * (0.35 - i * 0.12), topY - 0.01, (i % 2 ? 1 : -1) * Q.W * 0.12], [i % 2 ? 0.4 : -0.4, 0, 0.9]);
      body.add(tf, shadeC(back, 0.9), { mat: 'fur' });
    }
  }
  if (ex.has('shell')) {
    const sh = dome(1, 8, 3);
    T(sh, [-0.02, topY - Q.H * 0.15, 0], [0, 0, 0], [Q.L * 0.5, Q.H * 0.75, Q.W * 0.62]);
    body.add(sh, pal.secondary, { mat: 'bone' });
  }
  if (ex.has('flames')) {
    body.frame([0, topY, 0], [0, 0, 0], Q.W * 0.35, () => {
      for (let i = 0; i < 5; i++) {
        const f = cone(0.35, 1.2 - (i % 2) * 0.4, 4);
        T(f, [(1 - i * 0.6) * (Q.L / Q.W), 0.5, (i % 2 ? 0.3 : -0.3)], [0, 0, 0.5]);
        body.add(f, i % 2 ? pal.fire : pal.fireHot, { glow: 1, morph: flickerMorph(body, [(1 - i * 0.6) * (Q.L / Q.W), 0, 0], 0.35) });
      }
    });
  }
  // tail
  const tailStyle = head === 'fox' || head === 'wolf' ? 'bushy' : head === 'horse' ? 'hair' : head === 'lion' || head === 'cat' || head === 'bull' || head === 'human' ? 'tuft' : 'plain';
  {
    const tl = Q.tail * (ex.has('tail') ? 1.15 : 0.7) * (tailStyle === 'bushy' ? 0.75 : 1);
    const tx = -Q.L * 0.5;
    const ty = cy + Q.H * 0.15;
    const reptile = Q === QUAD.reptile;
    const pts = reptile
      ? [[tx + 0.05, ty - 0.02, 0], [tx - tl * 0.3, ty - Q.H * 0.3, 0.03], [tx - tl * 0.62, Q.H * 0.35, -0.04], [tx - tl, 0.06, 0.02]]
      : tailStyle === 'hair'
        ? [[tx, ty + 0.02, 0], [tx - tl * 0.25, ty - 0.05, 0], [tx - tl * 0.45, ty - tl * 0.45, 0]]
        : [[tx, ty, 0], [tx - tl * 0.35, ty + tl * 0.18, 0], [tx - tl * 0.7, ty + tl * 0.12, 0], [tx - tl, ty - tl * 0.1, 0]];
    const r0 = reptile ? Q.W * 0.3 : tailStyle === 'hair' ? 0.03 : tailStyle === 'bushy' ? Q.legR * 0.6 : Q.legR * 0.55;
    const many = head === 'fox' && ex.has('tail') && v.aura ? 3 : 1;
    addTail(body, pal, pts, r0, reptile ? 0.02 : r0 * 0.6, tailStyle === 'hair' ? pal.back : fur, {
      style: reptile ? 'plain' : tailStyle, tipColor: head === 'fox' ? pal.white : tailStyle === 'hair' ? pal.back : shadeC(back, 0.8),
      amp: reptile ? 0.14 : 0.1, k: reptile ? 3 : 5, count: many, spread: 0.45,
    });
  }
  // wings (pegasus etc.)
  if (ex.has('wings')) {
    addWings(body, pal, Q.L * 0.12, topY - 0.02, Q.W * 0.3, {
      span: 0.55 + Q.L * 0.55, style: head === 'dragon' || head === 'serpent' || head === 'crocodile' ? 'bat' : 'feather',
      colA: pal.primary, colB: tintC(pal.secondary, 0.1), colC: null, sweep: 0.45, lift: 0.45,
    });
  }
  if (ex.has('rider') && !centaur) body.frame([0.0, topY + 0.02, 0], [0, 0, 0], 1, () => addRider(body, pal, ctx, 0.95));
  if (ex.has('aura_ring')) addAuraRing(body, pal, [0, topY + 0.25, 0], Q.W * 1.1, false, 'xz');
  if (ex.has('chains')) {
    for (let i = 0; i < 5; i++) {
      const l = torus(0.025, 0.008, 3, 5);
      T(l, [Q.L * 0.45 - i * 0.02, cy - i * 0.05, Q.W * 0.3], [0, i % 2 ? PI / 2 : 0, 0]);
      body.add(l, pal.darkMetal);
    }
  }

  // centaur: human torso rises from the front (merged into the body mesh)
  const torsoBase = [Q.L * 0.36, cy + Q.H * 0.25, 0];
  const CP = { ...PROFILES.humanoid };
  if (centaur) {
    if (ctx.grand) CP.chestW *= 1.08;
    body.frame(torsoBase, [0, 0, 0], 1, () => buildTorso(ctx, CP, { noHips: true, into: body }));
    addSaddle(body, -0.08, topY + 0.005, Q.L * 0.3, Q.W * 1.02, Q.H * 0.5, pal.accentMetal);
  }

  const bodyGeo = body.build();
  parts.push({ name: 'body', parent: null, pos: [0, 0, 0], geo: bodyGeo });
  if (centaur) {
    const items = humanoidItems(v);
    const sh = CP.shoulderY - CP.hipY - 0.02;
    parts.push({ name: 'armR', parent: 'body', pos: [torsoBase[0], torsoBase[1] + sh, CP.shoulderZ], geo: buildArm(ctx, CP, 1, items.right) });
    parts.push({ name: 'armL', parent: 'body', pos: [torsoBase[0], torsoBase[1] + sh, -CP.shoulderZ], geo: buildArm(ctx, CP, -1, items.left) });
  } else {
    // neck + head as one mesh pivoting at the neck base
    const hb = new PartBuilder();
    const n0 = [0, 0, 0];
    const n1 = [Math.cos(Q.neckA) * Q.neck, Math.sin(Q.neckA) * Q.neck, 0];
    const nR = Math.max(Q.headR * 0.62, Q.W * 0.3);
    const heads = Math.min(5, v.heads);
    for (let i = 0; i < heads; i++) {
      const zoff = heads === 1 ? 0 : (i - (heads - 1) / 2) * Q.headR * 2.1;
      const yaw = heads === 1 ? 0 : -(i - (heads - 1) / 2) * 0.35;
      const end = [n1[0] + Math.abs(zoff) * -0.15, n1[1] - Math.abs(zoff) * 0.15, n1[2] + zoff];
      hb.add(seg([n0[0], n0[1], zoff * 0.3], end, nR * 1.1, nR * 0.85, 6, true), fur);
      if (ex.has('mane')) {
        for (let m = 0; m < 4; m++) {
          const t = m / 3;
          const mp = [n0[0] + (end[0] - n0[0]) * t - nR * 0.3, n0[1] + (end[1] - n0[1]) * t + nR * 0.75, zoff * (0.3 + 0.7 * t)];
          const mn = box(nR * 0.9, nR * 0.8, nR * 0.35);
          T(mn, mp, [0, 0, Q.neckA - PI / 2]);
          hb.add(mn, head === 'lion' ? shadeC(back, 0.9) : pal.secondary);
        }
      }
      if (ex.has('jewelry')) {
        const col = cyl(nR * 1.25, nR * 1.3, 0.04, 7, true);
        T(col, [n1[0] * 0.3, n1[1] * 0.3, zoff * 0.4], [0, 0, Q.neckA - PI / 2]);
        hb.add(col, pal.accentMetal, { glow: 0.15 });
      } else if (i === 0) {
        const col = cyl(nR * 1.2, nR * 1.2, 0.035, 7, true);
        T(col, [n1[0] * 0.25, n1[1] * 0.25, 0], [0, 0, Q.neckA - PI / 2]);
        hb.add(col, TEAM(0.9));
      }
      const tilt = head === 'horse' ? 0.15 : Q === QUAD.reptile ? 0.0 : -0.05;
      hb.frame([end[0] + Q.headR * 0.35, end[1] + Q.headR * 0.25, end[2]], [0, yaw, tilt], Q.headR, () => {
        // extra heads of multi-headed beasts are built cheaper
        headAssembly(hb, ctx, head, zoff === 0 || (heads === 2 && i === 0) ? { jaw: true } : { jaw: true, lod: 0 });
      });
    }
    parts.push({ name: 'head', parent: 'body', pos: [Q.L * 0.42, cy + Q.H * 0.22, 0], geo: hb.build() });
  }
  // legs
  const legCols = { upper: fur, lower: Q.hoof ? shadeC(fur, 0.92) : fur, paw: Q.hoof ? pal.leather : shadeC(fur, 0.75) };
  const fx = Q.L * 0.3;
  const bx = -Q.L * 0.32;
  const lz = Q.W * (Q.sprawl ? 0.48 : 0.32);
  const legY = Q.leg;
  const fl = buildQuadLeg(ctx, Q, true, legCols);
  const bl = buildQuadLeg(ctx, Q, false, legCols);
  const splay = Q.sprawl ? 0.35 : 0;
  parts.push({ name: 'legFR', parent: 'body', pos: [fx, legY, lz], rot: [-splay, 0, 0], geo: fl });
  parts.push({ name: 'legFL', parent: 'body', pos: [fx, legY, -lz], rot: [splay, 0, 0], geo: fl });
  parts.push({ name: 'legBR', parent: 'body', pos: [bx, legY, lz], rot: [-splay, 0, 0], geo: bl });
  parts.push({ name: 'legBL', parent: 'body', pos: [bx, legY, -lz], rot: [splay, 0, 0], geo: bl });
  return {
    kind: centaur ? 'centaur' : 'quadruped', parts,
    rig: {
      legLen: Q.leg, bodyY: cy, sprawl: !!Q.sprawl, stride: Q.leg * 3.2 + Q.L * 0.6,
      weapon: v.weapon, info: WEAPON_INFO[v.weapon] || WEAPON_INFO.none,
      rightElbow: (WEAPON_INFO[v.weapon] || WEAPON_INFO.none).elbow, leftElbow: v.weapon === 'bow' ? 0.15 : OFFHAND_ELBOW[v.offhand] ?? 0.25,
      gait: Q === QUAD.reptile ? 'walk' : 'gallop', holdAloft: holdsAloft(v),
    },
  };
}

function elephantTemplate(ctx) {
  const { v, pal, ex } = ctx;
  const Q = { L: 0.9, H: 0.52, W: 0.5, leg: 0.36, legR: 0.1, headR: 0.24, hoof: true };
  const parts = [];
  const b = new PartBuilder();
  const cy = Q.leg + Q.H * 0.45;
  const skin = pal.skin;
  const barrel = ball(1, 8, 5);
  T(barrel, [0, cy, 0], [0, 0, 0], [Q.L * 0.5, Q.H * 0.5, Q.W * 0.5]);
  b.add(barrel, skin);
  const hump = dodeca(1);
  T(hump, [Q.L * 0.18, cy + Q.H * 0.2, 0], [0, 0, 0], [Q.L * 0.3, Q.H * 0.35, Q.W * 0.42]);
  b.add(hump, skin);
  const rump = dodeca(1);
  T(rump, [-Q.L * 0.3, cy + Q.H * 0.05, 0], [0, 0, 0], [Q.L * 0.25, Q.H * 0.45, Q.W * 0.48]);
  b.add(rump, skin);
  const topY = cy + Q.H * 0.5;
  // caparison: team blanket with trims, readable from above
  const blanket = box(Q.L * 0.55, 0.035, Q.W * 1.08);
  T(blanket, [0, topY - 0.01, 0]);
  b.add(blanket, TEAM(1));
  for (const side of [1, -1]) {
    const fl = box(Q.L * 0.5, Q.H * 0.55, 0.025);
    T(fl, [0, topY - Q.H * 0.3, side * Q.W * 0.54]);
    b.add(fl, TEAM(0.85));
    const trim = box(Q.L * 0.52, 0.05, 0.03);
    T(trim, [0, topY - Q.H * 0.58, side * Q.W * 0.545]);
    b.add(trim, pal.secondary);
    for (let i = 0; i < 3; i++) {
      const tas = cone(0.025, 0.06, 4);
      T(tas, [(i - 1) * Q.L * 0.18, topY - Q.H * 0.64, side * Q.W * 0.55], [PI, 0, 0]);
      b.add(tas, pal.accent);
    }
  }
  if (ex.has('rider')) {
    const how = box(Q.L * 0.3, 0.1, Q.W * 0.6);
    T(how, [-0.02, topY + 0.05, 0]);
    b.add(how, pal.primary, { mat: 'painted' });
    b.frame([-0.02, topY + 0.1, 0], [0, 0, 0], 1.0, () => addRider(b, pal, ctx, 0.9));
  }
  if (ex.has('armor')) {
    const pl = box(Q.L * 0.5, 0.04, Q.W * 0.95);
    T(pl, [Q.L * 0.25, topY - 0.05, 0], [0, 0, -0.3]);
    b.add(pl, pal.accentMetal);
  }
  if (ex.has('flames')) {
    b.frame([0, topY + 0.04, 0], [0, 0, 0], Q.W * 0.3, () => flameRow(b, pal, 4, Q.L / (Q.W * 0.3)));
  }
  if (ex.has('aura_ring')) addAuraRing(b, pal, [0, topY + 0.3, 0], Q.W * 1.0, false, 'xz');
  addTail(b, pal, [[-Q.L * 0.48, cy + Q.H * 0.1, 0], [-Q.L * 0.55, cy - Q.H * 0.2, 0], [-Q.L * 0.56, cy - Q.H * 0.5, 0]], 0.03, 0.015, skin, { style: 'tuft', tipColor: shadeC(skin, 0.5), amp: 0.06 });
  parts.push({ name: 'body', parent: null, pos: [0, 0, 0], geo: b.build() });
  // heads (trunk morph = 'jaw', ear flap = 'ear')
  const hb = new PartBuilder();
  const heads = Math.min(3, v.heads);
  for (let i = 0; i < heads; i++) {
    const z = heads === 1 ? 0 : (i - (heads - 1) / 2) * Q.headR * 1.7;
    const yaw = heads === 1 ? 0 : -(i - (heads - 1) / 2) * 0.45;
    const sc = heads > 1 && z !== 0 ? 0.85 : 1;
    hb.frame([Math.abs(z) * -0.25, -Math.abs(z) * 0.1, z], [0, yaw, -0.15], Q.headR * sc, () => {
      const side = heads > 1 && z !== 0;
      const a = headAssembly(hb, ctx, v.head === 'none' ? 'elephant' : v.head, side ? { jaw: true, lod: 0, headgear: 'none' } : { jaw: true });
      if (i === Math.floor(heads / 2) && v.headgear === 'none') {
        // head cloth in the team color between the eyes
        const cloth = slab([[-0.5, 0.5], [0.5, 0.5], [0.3, -0.6], [0, -0.85], [-0.3, -0.6]], 0.08);
        T(cloth, [1.0, 0.25, 0], [0, PI / 2, 0]);
        hb.add(cloth, TEAM(0.95));
      }
      return a;
    });
  }
  parts.push({ name: 'head', parent: 'body', pos: [Q.L * 0.5, cy + Q.H * 0.2, 0], geo: hb.build() });
  const legCols = { upper: skin, lower: skin, paw: tintC(skin, 0.3) };
  const leg = buildQuadLeg({ ...ctx, ex: new Set([...ex].filter((x) => x !== 'fur' && x !== 'spikes')) }, { ...Q, legR: Q.legR }, true, legCols);
  const lz = Q.W * 0.3;
  parts.push({ name: 'legFR', parent: 'body', pos: [Q.L * 0.28, Q.leg, lz], geo: leg });
  parts.push({ name: 'legFL', parent: 'body', pos: [Q.L * 0.28, Q.leg, -lz], geo: leg });
  parts.push({ name: 'legBR', parent: 'body', pos: [-Q.L * 0.3, Q.leg, lz], geo: leg });
  parts.push({ name: 'legBL', parent: 'body', pos: [-Q.L * 0.3, Q.leg, -lz], geo: leg });
  return { kind: 'quadruped', parts, rig: { legLen: Q.leg, bodyY: cy, stride: 1.6, gait: 'walk', elephant: true, info: WEAPON_INFO.none } };
}

function flameRow(b, pal, n, len) {
  for (let i = 0; i < n; i++) {
    const x = (0.5 - i / Math.max(1, n - 1)) * len;
    const f = cone(0.4, 1.3 - (i % 2) * 0.4, 4);
    T(f, [x, 0.55, (i % 2 ? 0.25 : -0.25)], [0, 0, 0.45]);
    b.add(f, i % 2 ? pal.fire : pal.fireHot, { glow: 1, morph: flickerMorph(b, [x, 0, 0], 0.35) });
  }
}

// ---------------------------------------------------------------------------
// bird
// ---------------------------------------------------------------------------

function birdTemplate(ctx) {
  const { v, pal, ex } = ctx;
  const b = new PartBuilder();
  const cy = 0.32;
  const L = 0.46;
  const W = 0.24;
  const bodyCol = pal.skin;
  const torso = ball(1, 7, 4);
  T(torso, [0, cy, 0], [0, 0, -0.18], [L * 0.5, 0.13, W * 0.5]);
  b.add(torso, bodyCol);
  const breast = dodeca(1);
  T(breast, [L * 0.22, cy - 0.01, 0], [0, 0, 0], [0.13, 0.12, W * 0.48]);
  b.add(breast, mixC(bodyCol, pal.secondary, 0.25));
  // team band around the body + tail base
  const band = cyl(W * 0.52, W * 0.52, 0.06, 7, true);
  T(band, [-0.02, cy + 0.0, 0], [0, 0, PI / 2 - 0.18], [1, 1, 1]);
  b.add(band, TEAM(1));
  // neck + head
  const headKind = v.head === 'none' ? 'bird' : v.head;
  const hR = isAnimalHead(headKind) && headKind !== 'bird' && headKind !== 'falcon' ? 0.12 : 0.105;
  const heads = Math.min(3, v.heads);
  for (let i = 0; i < heads; i++) {
    const z = heads === 1 ? 0 : (i - (heads - 1) / 2) * 0.17;
    b.add(seg([L * 0.32, cy + 0.04, z * 0.4], [L * 0.5, cy + 0.14, z], 0.075, 0.06, 6, true), bodyCol);
    b.frame([L * 0.55, cy + 0.19, z], [0, -z * 1.2, -0.05], hR, () => headAssembly(b, ctx, headKind, {}));
  }
  // tail fan
  const long = ex.has('tail');
  const n = long ? 5 : 4;
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1) - 0.5) * (long ? 0.9 : 0.7);
    const len = long ? 0.55 + (i % 2) * 0.15 : 0.22;
    const f = slab([[0, -0.03], [len * 0.7, -0.045], [len, 0], [len * 0.7, 0.045], [0, 0.03]], 0.015);
    T(f, [-L * 0.42, cy + 0.02, 0], [PI / 2, a, PI - 0.15]);
    const R = b.toRoot([-L * 0.42, cy, 0]);
    b.add(f, i % 2 ? pal.secondary : (long ? pal.accent : pal.primary), {
      morph: waveMorph((p) => Math.hypot(p.x - R[0], p.z - R[2]), (s) => 0.09 * s / 0.6, 4, 'y', i * 0.4),
    });
  }
  // tucked legs
  for (const side of [1, -1]) {
    b.add(seg([0.02, cy - 0.1, side * 0.06], [-0.06, cy - 0.2, side * 0.07], 0.02, 0.015, 4), pal.beak);
    const claw = box(0.06, 0.025, 0.05);
    T(claw, [-0.07, cy - 0.21, side * 0.07]);
    b.add(claw, pal.beak);
  }
  if (ex.has('flames')) b.frame([-0.05, cy + 0.1, 0], [0, 0, 0], 0.12, () => flameRow(b, pal, 4, 3.5));
  if (ex.has('feather_cloak') || ex.has('mane')) {
    for (let i = 0; i < 5; i++) {
      const f = cone(0.04, 0.14, 4);
      T(f, [L * 0.3, cy + 0.13 - i * 0.02, (i - 2) * 0.04], [0, 0, 1.9]);
      b.add(f, pal.secondary);
    }
  }
  if (ex.has('rider')) b.frame([-0.02, cy + 0.12, 0], [0, 0, 0], 0.8, () => addRider(b, pal, ctx, 0.8));
  if (ex.has('jewelry')) {
    const col = cyl(0.07, 0.075, 0.03, 7, true);
    T(col, [L * 0.42, cy + 0.08, 0], [0, 0, -0.9]);
    b.add(col, pal.accentMetal);
  }
  if (ex.has('spikes')) {
    for (let i = 0; i < 3; i++) {
      const sp = cone(0.025, 0.09, 4);
      T(sp, [0.05 - i * 0.08, cy + 0.13, 0], [0, 0, 0.4]);
      b.add(sp, pal.horn);
    }
  }
  if (ex.has('aura_ring')) addAuraRing(b, pal, [0, cy + 0.22, 0], 0.3, false, 'xz');
  // wings
  addWings(b, pal, 0.02, cy + 0.08, W * 0.3, {
    span: 0.78, style: headKind === 'dragon' ? 'bat' : 'feather', colA: pal.primary, colB: pal.secondary,
    colC: ctx.grand || v.aura ? pal.accent : null, sweep: 0.2, lift: 0.05,
  });
  return { kind: 'bird', parts: [{ name: 'body', parent: null, pos: [0, 0, 0], geo: b.build() }], rig: { bodyY: cy } };
}

// ---------------------------------------------------------------------------
// serpent, hydra, dragon, insect
// ---------------------------------------------------------------------------

/** Chain of joined segments with per-point radius. */
function addChain(b, pts, rad, colorAt, morph, sides = 6) {
  tube(pts, rad, sides).forEach((g, i) => b.add(g, colorAt(i), { morph }));
}

function serpentTemplate(ctx) {
  const { v, pal, ex } = ctx;
  const b = new PartBuilder();
  const body = pal.skin;
  const band = pal.back;
  const pts = [[0.3, 0.72, 0], [0.32, 0.52, 0], [0.22, 0.3, 0], [0.05, 0.13, 0], [-0.18, 0.1, 0.12], [-0.42, 0.09, 0.2], [-0.66, 0.08, 0.08], [-0.84, 0.07, -0.12], [-1.02, 0.06, -0.18], [-1.2, 0.05, -0.06], [-1.32, 0.04, 0.06]];
  // titans are thicker in the body: a world-ending serpent, not a big snake
  const rad = [0.1, 0.11, 0.12, 0.13, 0.13, 0.125, 0.11, 0.095, 0.075, 0.05, 0.02].map((r) => r * (ctx.grand ? 1.3 : 1));
  const neckX = 0.1;
  const sOf = (p) => Math.max(0, neckX - p.x);
  const wave = waveMorph(sOf, (s) => 0.13 * Math.min(1, s / 0.5), 4.2, 'z');
  const strike = (p, out) => {
    const h = Math.max(0, Math.min(1, (p.y - 0.12) / 0.6));
    out.set(0.3 * h * h, -0.18 * h * h, 0);
  };
  const morph = { ...wave, st: strike };
  addChain(b, pts, rad, (i) => (i % 3 === 1 ? band : body), morph);
  // belly plates on the raised part
  for (let i = 0; i < 3; i++) {
    const p = pts[i + 1];
    const plate = box(0.03, 0.12, rad[i + 1] * 1.3);
    T(plate, [p[0] + rad[i + 1] * 0.9, p[1], p[2]], [0, 0, 0.3]);
    b.add(plate, pal.belly, { morph });
  }
  // team bands, and on titans glowing rune rings between them
  for (const i of [3, 6]) {
    const p = pts[i];
    const r = cyl(rad[i] * 1.08, rad[i] * 1.08, 0.045, 7, true);
    T(r, p, [0, 0, PI / 2]);
    b.add(r, TEAM(1), { morph });
  }
  if (ctx.grand) {
    for (const i of [2, 5, 8]) {
      const r = cyl(rad[i] * 1.04, rad[i] * 1.04, 0.022, 7, true);
      T(r, pts[i], [0, 0, PI / 2 + 0.3]);
      b.add(r, tintC(pal.glow, 0.2), { glow: 0.9, morph });
    }
  }
  if (ctx.grand || ex.has('spikes')) addDorsalFins(b, pts, rad, 1, pts.length - 3, mixC(pal.back, pal.horn, 0.35), morph, ctx.grand ? 1.2 : 0.9);
  if (ex.has('flames')) {
    for (let i = 2; i < pts.length - 2; i++) {
      const p = pts[i];
      if (ex.has('flames') && i % 2 === 0) {
        const f = cone(rad[i] * 0.55, rad[i] * 2.4, 4);
        T(f, [p[0], p[1] + rad[i] * 1.6, p[2]], [0, 0, 0.3]);
        b.add(f, i % 4 ? pal.fire : pal.fireHot, { glow: 1, morph: { ...wave, st: strike, ...flickerMorph(b, [p[0], p[1] + rad[i], p[2]], 0.35) } });
      } else if (ex.has('spikes')) {
        const sp = cone(rad[i] * 0.35, rad[i] * 1.0, 4);
        T(sp, [p[0], p[1] + rad[i] * 1.2, p[2]], [0, 0, 0.5]);
        b.add(sp, pal.horn, { morph });
      }
    }
  }
  const hk = v.head === 'none' ? 'serpent' : v.head;
  b.frame([0.36, 0.78, 0], [0, 0, -0.35], 0.13, () => {
    const st = b.items.length;
    headAssembly(b, ctx, hk, { jaw: true });
    for (const it of b.items.slice(st)) it.morph = it.morph ? { ...morph, ...it.morph } : morph;
  });
  if (ex.has('wings')) {
    addWings(b, pal, 0.22, 0.45, 0.08, { span: 0.75, style: 'feather', colA: pal.primary, colB: pal.secondary, colC: pal.accent, sweep: 0.4, lift: 0.3 });
  }
  if (ex.has('rider')) b.frame([-0.3, 0.22, 0.2], [0, 0, 0], 0.8, () => addRider(b, pal, ctx, 0.8));
  if (ex.has('aura_ring')) addAuraRing(b, pal, [0.2, 0.55, 0], 0.32, false, 'xz');
  return { kind: 'serpent', parts: [{ name: 'body', parent: null, pos: [0, 0, 0], geo: b.build() }], rig: {} };
}

function hydraTemplate(ctx) {
  const { v, pal, ex } = ctx;
  const b = new PartBuilder();
  const n = Math.max(1, v.heads);
  const skin = pal.skin;
  const cy = 0.26;
  const mound = ball(1, 8, 5);
  T(mound, [-0.1, cy, 0], [0, 0, 0], [0.45, 0.26, 0.36]);
  b.add(mound, skin);
  const belly = ball(1, 7, 3);
  T(belly, [0.0, cy - 0.08, 0], [0, 0, 0], [0.38, 0.17, 0.3]);
  b.add(belly, pal.belly);
  const ridge = ball(1, 6, 3);
  T(ridge, [-0.12, cy + 0.12, 0], [0, 0, 0], [0.38, 0.14, 0.2]);
  b.add(ridge, pal.back);
  for (const z of [1, -1]) {
    const leg = dodeca(0.1);
    T(leg, [0.15, 0.08, z * 0.28], [0, 0, 0], [1.2, 0.9, 1]);
    b.add(leg, skin);
    const leg2 = dodeca(0.1);
    T(leg2, [-0.32, 0.08, z * 0.26], [0, 0, 0], [1.2, 0.9, 1]);
    b.add(leg2, skin);
  }
  const band = cyl(0.38, 0.38, 0.06, 8, true);
  T(band, [-0.08, cy, 0], [0, 0, PI / 2], [0.72, 1, 1]);
  b.add(band, TEAM(1));
  // tails
  addTail(b, pal, [[-0.42, cy - 0.02, 0], [-0.66, 0.14, 0.05], [-0.88, 0.09, -0.04], [-1.08, 0.05, 0.02]], 0.13, 0.02, skin, { amp: 0.1, k: 4 });
  // necks fan out from the front
  const necks = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const a = (t - 0.5) * (n > 4 ? 2.3 : 1.6);
    const h = 0.7 + 0.18 * Math.cos(i * 2.3) + (n > 4 ? 0.1 : 0);
    const reach = 0.42 + 0.1 * Math.sin(i * 1.7);
    const base = [0.22, cy + 0.08, Math.sin(a) * 0.2];
    const mid = [base[0] + Math.cos(a) * reach * 0.5, base[1] + h * 0.55, base[2] + Math.sin(a) * reach * 0.55];
    const top = [base[0] + Math.cos(a) * reach, base[1] + h, base[2] + Math.sin(a) * reach * 0.85];
    necks.push({ base, mid, top, a, phase: i * 1.9 });
  }
  const hk = v.head === 'none' ? 'serpent' : v.head;
  for (const nk of necks) {
    const sway = {
      wa: (p, out) => {
        const w = Math.max(0, (p.y - cy) / 0.9);
        out.set(0, 0, 0.09 * w * Math.cos(nk.phase));
      },
      wb: (p, out) => {
        const w = Math.max(0, (p.y - cy) / 0.9);
        out.set(0.03 * w * Math.sin(nk.phase), 0, 0.09 * w * Math.sin(nk.phase));
      },
      st: (p, out) => {
        const w = Math.max(0, (p.y - cy) / 0.9);
        out.set(0.32 * w * w, -0.25 * w * w, 0);
      },
    };
    const pts = [nk.base, [(nk.base[0] + nk.mid[0]) / 2 + 0.05, (nk.base[1] + nk.mid[1]) / 2, (nk.base[2] + nk.mid[2]) / 2], nk.mid, [(nk.mid[0] + nk.top[0]) / 2 - 0.04, (nk.mid[1] + nk.top[1]) / 2 + 0.03, (nk.mid[2] + nk.top[2]) / 2], nk.top];
    const nr = n > 5 ? 0.85 : 1;
    addChain(b, pts, [0.12 * nr, 0.1 * nr, 0.088 * nr, 0.078 * nr, 0.072 * nr], (i) => (i === 0 ? pal.back : skin), sway, 5);
    b.frame([nk.top[0] + 0.05, nk.top[1] + 0.02, nk.top[2]], [0, -nk.a * 0.6, -0.35], (n > 5 ? 0.125 : n > 3 ? 0.14 : 0.16), () => {
      const st = b.items.length;
      headAssembly(b, ctx, hk, { jaw: true });
      for (const it of b.items.slice(st)) it.morph = it.morph ? { ...sway, ...it.morph } : sway;
    });
  }
  if (ex.has('spikes')) {
    for (let i = 0; i < 5; i++) {
      const sp = cone(0.04, 0.14, 4);
      T(sp, [0.15 - i * 0.12, cy + 0.24 - Math.abs(i - 2) * 0.03, 0], [0, 0, 0.4]);
      b.add(sp, pal.horn);
    }
  }
  if (ex.has('flames')) b.frame([-0.1, cy + 0.2, 0], [0, 0, 0], 0.12, () => flameRow(b, pal, 4, 5));
  if (ex.has('aura_ring')) addAuraRing(b, pal, [0, cy + 0.5, 0], 0.5, false, 'xz');
  return { kind: 'hydra', parts: [{ name: 'body', parent: null, pos: [0, 0, 0], geo: b.build() }], rig: {} };
}

function dragonTemplate(ctx) {
  const { v, pal, ex } = ctx;
  const b = new PartBuilder();
  const winged = ex.has('wings');
  const skin = pal.skin;
  const hk = v.head === 'none' ? 'dragon' : v.head;
  let rig;
  if (!winged) {
    // eastern dragon: long undulating serpentine body with small legs
    const pts = [];
    const rad = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push([0.55 - t * 1.75, 0.3 + Math.sin(t * PI * 2.0) * 0.12 + (1 - t) * 0.1, Math.sin(t * PI * 1.5) * 0.12]);
      rad.push((0.1 * (1 - t * 0.8) + 0.012) * (ctx.grand ? 1.3 : 1));
    }
    const sOf = (p) => Math.max(0, 0.55 - p.x);
    const wave = waveMorph(sOf, (s) => 0.1 * Math.min(1, 0.4 + s / 1.2), 3.6, 'y');
    addChain(b, pts, rad, (i) => (i % 3 === 0 ? pal.back : skin), wave, 6);
    for (let i = 1; i < N - 1; i += 2) {
      const p = pts[i];
      const belly = box(0.03, 0.03, rad[i] * 1.2);
      T(belly, [p[0], p[1] - rad[i] * 0.95, p[2]]);
      b.add(belly, pal.belly, { morph: wave });
    }
    if (ex.has('mane') || ex.has('spikes') || ctx.grand) {
      addDorsalFins(b, pts, rad, 1, N - 2, ex.has('mane') ? pal.primary : mixC(pal.back, pal.horn, 0.35), wave, ctx.grand ? 1.3 : 1);
    }
    for (const i of [2, 7]) {
      const p = pts[i];
      const r = cyl(rad[i] * 1.1, rad[i] * 1.1, 0.04, 7, true);
      T(r, p, [0, 0, PI / 2]);
      b.add(r, TEAM(1), { morph: wave });
    }
    if (ctx.grand) {
      for (const i of [4, 10]) {
        const r = cyl(rad[i] * 1.05, rad[i] * 1.05, 0.02, 7, true);
        T(r, pts[i], [0, 0, PI / 2 + 0.3]);
        b.add(r, tintC(pal.glow, 0.2), { glow: 0.9, morph: wave });
      }
    }
    for (const [i, side] of [[2, 1], [2, -1], [8, 1], [8, -1]]) {
      const p = pts[i];
      const foot = [p[0] + 0.05, p[1] - 0.17, p[2] + side * 0.12];
      b.add(seg(p, foot, 0.045, 0.03, 4), skin, { morph: wave });
      for (let c = 0; c < 3; c++) {
        const cl = cone(0.012, 0.05, 3);
        T(cl, [foot[0] + 0.02, foot[1] - 0.01, foot[2] + (c - 1) * 0.02], [0, 0, -1.9]);
        b.add(cl, pal.accent, { morph: wave, mat: 'bone' });
      }
    }
    {
      const end = pts[N];
      const tuft = cone(0.06, 0.18, 4);
      T(tuft, [end[0] - 0.08, end[1], end[2]], [0, 0, PI / 2]);
      b.add(tuft, ex.has('mane') ? pal.primary : skin, { morph: wave });
    }
    b.frame([0.62, 0.48, 0], [0, 0, -0.1], 0.12, () => {
      const st = b.items.length;
      headAssembly(b, ctx, hk, { jaw: true });
      if (ex.has('mane')) {
        for (const z of [1, -1]) {
          b.add(seg([1.6, -0.25, z * 0.3], [2.4, -0.6, z * 1.5], 0.05, 0.0, 3), pal.accent);
          b.add(seg([-0.2, 0.2, z * 0.5], [-1.2, 0.0, z * 0.9], 0.3, 0.05, 4), pal.primary);
        }
      }
      for (const it of b.items.slice(st)) it.morph = it.morph ? { ...wave, ...it.morph } : wave;
    });
    if (v.offhand === 'orb') {
      // the pearl it chases, just ahead of the jaws
      const o = ico(0.065);
      T(o, [0.92, 0.36, 0]);
      b.add(o, tintC(pal.glow, 0.3), { glow: 1, morph: wave });
    }
    rig = { eastern: true };
  } else {
    const L = 0.9;
    const cy = 0.34;
    const torso = ball(1, 7, 4);
    T(torso, [0, cy, 0], [0, 0, -0.1], [L * 0.38, 0.17, 0.2]);
    b.add(torso, skin);
    const belly = ball(1, 6, 3);
    T(belly, [0.05, cy - 0.08, 0], [0, 0, -0.1], [L * 0.3, 0.1, 0.16]);
    b.add(belly, pal.belly);
    const neckPts = [[0.28, cy + 0.06, 0], [0.42, cy + 0.2, 0], [0.5, cy + 0.36, 0], [0.6, cy + 0.46, 0]];
    const strike = (p, out) => {
      const w = Math.max(0, Math.min(1, (p.x - 0.25) / 0.45));
      out.set(0.15 * w, -0.15 * w * w, 0);
    };
    const heads = Math.min(3, v.heads);
    for (let h = 0; h < heads; h++) {
      const z = heads === 1 ? 0 : (h - (heads - 1) / 2) * 0.22;
      const np = neckPts.map((p, i) => [p[0], p[1] - Math.abs(z) * 0.3 * (i / 3), p[2] + z * (i / 3)]);
      addChain(b, np, [0.1, 0.08, 0.07, 0.06], () => skin, { st: strike }, 5);
      b.frame([np[3][0] + 0.06, np[3][1] + 0.03, np[3][2]], [0, -z * 1.5, -0.2], 0.11, () => {
        const st = b.items.length;
        headAssembly(b, ctx, hk, { jaw: true });
        for (const it of b.items.slice(st)) it.morph = it.morph ? { st: strike, ...it.morph } : { st: strike };
      });
    }
    addTail(b, pal, [[-0.3, cy, 0], [-0.55, cy - 0.06, 0.04], [-0.8, cy - 0.12, -0.03], [-1.05, cy - 0.18, 0.02]], 0.1, 0.02, skin, { amp: 0.12, k: 3.5, style: 'plain' });
    const spade = cone(0.06, 0.12, 3);
    T(spade, [-1.1, cy - 0.19, 0.02], [0, 0, PI / 2], [1, 1, 0.3]);
    b.add(spade, pal.back);
    // legs inside the body mesh, with a stride morph
    for (const [x, side, ph] of [[0.2, 1, 1], [0.2, -1, -1], [-0.22, 1, -1], [-0.22, -1, 1]]) {
      const hip = [x, cy - 0.04, side * 0.13];
      const knee = [x + 0.04, cy - 0.18, side * 0.16];
      const foot = [x, 0.03, side * 0.16];
      const stride = { ga: b.rotMorphLocal(hip, [0, 0, 1], 0.4 * ph) };
      b.add(seg(hip, knee, 0.06, 0.045, 5), skin, { morph: stride });
      b.add(seg(knee, foot, 0.045, 0.035, 5), skin, { morph: stride });
      const paw = box(0.08, 0.03, 0.06);
      T(paw, [foot[0] + 0.03, 0.015, foot[2]]);
      b.add(paw, shadeC(skin, 0.7), { morph: stride });
    }
    if (ex.has('spikes') || ex.has('mane')) {
      for (let i = 0; i < 6; i++) {
        const sp = cone(0.03, 0.1, 4);
        T(sp, [0.3 - i * 0.14, cy + 0.17 - Math.max(0, i - 2) * 0.04, 0], [0, 0, 0.5]);
        b.add(sp, ex.has('mane') ? pal.primary : pal.horn);
      }
    }
    if (ex.has('rider')) b.frame([-0.05, cy + 0.17, 0], [0, 0, 0], 0.85, () => addRider(b, pal, ctx, 0.85));
    else addSaddle(b, -0.04, cy + 0.165, 0.22, 0.24, 0.1, pal.accentMetal);
    if (ex.has('flames')) b.frame([0, cy + 0.15, 0], [0, 0, 0], 0.1, () => flameRow(b, pal, 4, 5));
    addWings(b, pal, 0.05, cy + 0.12, 0.1, { span: 0.95, style: 'bat', colA: pal.primary, colB: pal.back, sweep: 0.35, lift: 0.3 });
    rig = { eastern: false };
  }
  if (ex.has('aura_ring')) addAuraRing(b, pal, [0, 0.6, 0], 0.4, false, 'xz');
  return { kind: 'dragon', parts: [{ name: 'body', parent: null, pos: [0, 0, 0], geo: b.build() }], rig };
}

function insectTemplate(ctx) {
  const { v, pal, ex } = ctx;
  const b = new PartBuilder();
  const cy = 0.18;
  const skin = pal.skin;
  const humanTop = !['none', 'bird', 'serpent', 'crocodile', 'dragon'].includes(v.head) && (v.head === 'human' || v.head === 'demon' || v.head === 'skull' || v.weapon !== 'none' && v.weapon !== 'claws');
  const thorax = ball(1, 6, 4);
  T(thorax, [0.08, cy, 0], [0, 0, 0], [0.14, 0.09, 0.15]);
  b.add(thorax, skin);
  const abd = ball(1, 7, 4);
  T(abd, [-0.2, cy + 0.02, 0], [0, 0, 0.08], [0.24, 0.12, 0.2]);
  b.add(abd, shadeC(skin, 0.9));
  if (ex.has('shell') || !ex.has('tail')) {
    for (const side of [1, -1]) {
      const sh = dome(1, 6, 2);
      T(sh, [-0.14, cy + 0.03, side * 0.085], [side * 0.15, 0, 0], [0.3, 0.13, 0.12]);
      b.add(sh, pal.primary, { mat: 'bone' });
    }
    const seam = box(0.5, 0.03, 0.035);
    T(seam, [-0.14, cy + 0.14, 0]);
    b.add(seam, TEAM(1));
    const rim = cyl(0.2, 0.2, 0.03, 8, true);
    T(rim, [-0.14, cy + 0.02, 0], [0, 0, 0], [1.5, 1, 1.05]);
    b.add(rim, pal.accentMetal, { glow: 0.2 });
  } else {
    const st = box(0.36, 0.03, 0.05);
    T(st, [-0.2, cy + 0.14, 0]);
    b.add(st, TEAM(1));
  }
  // legs: tripod gait morphs (ga stride, la / lb lift)
  const legs = [[0.14, 1, 'A'], [0.04, -1, 'A'], [-0.08, 1, 'A'], [0.14, -1, 'B'], [0.04, 1, 'B'], [-0.08, -1, 'B']];
  for (const [x, side, grp] of legs) {
    const hip = [x, cy - 0.02, side * 0.1];
    const knee = [x + 0.03 * (x > 0.1 ? 1 : x < 0 ? -1 : 0.2), cy + 0.08, side * 0.24];
    const foot = [x + 0.08 * (x > 0.1 ? 1 : x < 0 ? -1.2 : 0.1), 0.0, side * 0.32];
    const sgn = grp === 'A' ? 1 : -1;
    const m = {
      ga: b.rotMorphLocal(hip, [0, 1, 0], -0.35 * sgn * 1),
      [grp === 'A' ? 'la' : 'lb']: (p, out) => out.set(0, 0.05 * Math.min(1, Math.abs(p.z - hip[2]) / 0.2), 0),
    };
    b.add(seg(hip, knee, 0.025, 0.02, 4), shadeC(skin, 0.75), { morph: m });
    b.add(seg(knee, foot, 0.02, 0.008, 4), shadeC(skin, 0.75), { morph: m });
  }
  // head
  if (!humanTop) {
    const hk = v.head === 'none' ? null : v.head;
    if (hk) b.frame([0.28, cy + 0.03, 0], [0, 0, 0], 0.09, () => headAssembly(b, ctx, hk, {}));
    else {
      const hd = dodeca(0.075);
      T(hd, [0.26, cy, 0], [0, 0, 0], [1, 0.8, 1.1]);
      b.add(hd, shadeC(skin, 0.85));
      eyesSmall(b, pal, [0.31, cy + 0.03, 0.05]);
      if (ex.has('shell')) {
        const horn = seg([0.3, cy + 0.03, 0], [0.42, cy + 0.14, 0], 0.03, 0.0, 4);
        b.add(horn, pal.accent, { mat: 'bone' });
      }
      for (const side of [1, -1]) {
        const md = seg([0.31, cy - 0.02, side * 0.04], [0.38, cy - 0.03, side * 0.015], 0.015, 0.005, 3);
        b.add(md, pal.accent, { mat: 'bone' });
      }
    }
  }
  // pincers
  if (v.weapon === 'claws' || (ex.has('tail') && !humanTop)) {
    for (const side of [1, -1]) {
      const arm = [[0.2, cy, side * 0.08], [0.32, cy + 0.02, side * 0.18], [0.45, cy + 0.03, side * 0.16]];
      b.add(seg(arm[0], arm[1], 0.03, 0.025, 4), skin);
      b.add(seg(arm[1], arm[2], 0.025, 0.035, 4), skin);
      const p1 = cone(0.03, 0.12, 4);
      T(p1, [0.5, cy + 0.03, side * 0.19], [0, 0, -PI / 2 - 0.2]);
      b.add(p1, pal.accent, { mat: 'bone' });
      const p2 = cone(0.025, 0.1, 4);
      T(p2, [0.5, cy + 0.03, side * 0.13], [0, 0, -PI / 2 + 0.2]);
      b.add(p2, pal.accent, { mat: 'bone' });
    }
  }
  // scorpion tail curling over the back
  if (ex.has('tail')) {
    const tp = [[-0.4, cy + 0.04, 0], [-0.5, cy + 0.18, 0], [-0.48, cy + 0.36, 0], [-0.36, cy + 0.48, 0], [-0.2, cy + 0.5, 0]];
    const R = tp[0];
    const m = {
      st: (p, out) => {
        const w = Math.max(0, Math.min(1, (p.y - cy) / 0.5));
        out.set(0.25 * w * w, -0.06 * w, 0);
      },
      wa: (p, out) => out.set(0, 0, 0.04 * Math.max(0, (p.y - R[1]) / 0.5)),
    };
    addChain(b, tp, [0.07, 0.06, 0.05, 0.045, 0.04], (i) => (i % 2 ? skin : pal.back), m, 5);
    const sting = cone(0.035, 0.12, 4);
    T(sting, [-0.13, cy + 0.46, 0], [0, 0, -2.2]);
    b.add(sting, tintC(pal.glow, 0.1), { glow: 0.8, morph: m });
  }
  if (ex.has('wings')) addWings(b, pal, -0.05, cy + 0.12, 0.06, { span: 0.45, style: 'bat', colA: tintC(pal.secondary, 0.4), colB: pal.secondary, sweep: 0.8, lift: 0.1 });
  if (ex.has('spikes')) {
    for (let i = 0; i < 3; i++) {
      const sp = cone(0.02, 0.07, 4);
      T(sp, [-0.05 - i * 0.12, cy + 0.15, 0], [0, 0, 0.4]);
      b.add(sp, pal.horn);
    }
  }
  if (ex.has('flames')) b.frame([-0.1, cy + 0.12, 0], [0, 0, 0], 0.08, () => flameRow(b, pal, 3, 4));
  if (ex.has('aura_ring')) addAuraRing(b, pal, [0, cy + 0.3, 0], 0.3, false, 'xz');
  if (ex.has('rider')) b.frame([-0.12, cy + 0.15, 0], [0, 0, 0], 0.75, () => addRider(b, pal, ctx, 0.75));
  const parts = [{ name: 'body', parent: null, pos: [0, 0, 0], geo: null }];
  const bodyGeo = b.build();
  parts[0].geo = bodyGeo;
  const rig = { humanTop: false, info: WEAPON_INFO[v.weapon] || WEAPON_INFO.none };
  if (humanTop) {
    const P = { ...PROFILES.humanoid, hipY: 0.0, shoulderY: 0.36, headY: 0.52, chestW: 0.34, waistW: 0.24 };
    const tb = buildTorso(ctx, P, { noHips: true });
    parts.push({ name: 'torso', parent: 'body', pos: [0.16, cy + 0.05, 0], rot: [0, 0, -0.05], geo: tb.geo });
    const items = humanoidItems(v);
    const sh = P.shoulderY - P.hipY - 0.02;
    parts.push({ name: 'armR', parent: 'torso', pos: [0, sh, P.shoulderZ], geo: buildArm(ctx, P, 1, items.right) });
    parts.push({ name: 'armL', parent: 'torso', pos: [0, sh, -P.shoulderZ], geo: buildArm(ctx, P, -1, items.left) });
    rig.humanTop = true;
    rig.rightElbow = (WEAPON_INFO[v.weapon] || WEAPON_INFO.none).elbow;
    rig.leftElbow = OFFHAND_ELBOW[v.offhand] ?? 0.25;
  }
  return { kind: 'insect', parts, rig };
}

function eyesSmall(b, pal, p) {
  const e = box(0.02, 0.025, 0.025);
  T(e, p);
  b.addSym(e, pal.eyeGlow || C('#101010'), { glow: pal.eyeGlow ? 1 : 0 });
}

// ---------------------------------------------------------------------------
// siege ram
// ---------------------------------------------------------------------------

function ramTemplate(ctx) {
  const { pal } = ctx;
  const wood = withMat(pal.primary, 'wood');
  const dark = withMat(pal.secondary, 'wood');
  const metal = pal.accentMetal;
  const b = new PartBuilder();
  const wr = 0.14;
  const baseY = wr + 0.04;
  for (const z of [0.24, -0.24]) {
    const beam = box(1.05, 0.07, 0.07);
    T(beam, [0, baseY, z]);
    b.add(beam, wood);
  }
  for (const x of [0.4, -0.4]) {
    const cross = box(0.07, 0.06, 0.55);
    T(cross, [x, baseY + 0.04, 0]);
    b.add(cross, dark);
  }
  // A-frame posts and roof (team-colored hides)
  for (const x of [0.38, -0.38]) {
    for (const z of [0.22, -0.22]) b.add(seg([x, baseY, z], [x, 0.72, z * 0.15], 0.03, 0.03, 4, true), dark);
  }
  b.add(seg([0.42, 0.74, 0], [-0.42, 0.74, 0], 0.035, 0.035, 4, true), dark);
  for (const side of [1, -1]) {
    const roof = box(0.9, 0.035, 0.36);
    T(roof, [0, 0.6, side * 0.15], [side * 0.82, 0, 0]);
    b.add(roof, TEAM(1, 'leather'));
    const ribs = box(0.04, 0.045, 0.37);
    for (const x of [0.22, -0.22]) {
      const r = ribs.clone();
      T(r, [x, 0.6, side * 0.155], [side * 0.82, 0, 0]);
      b.add(r, dark);
    }
  }
  // banner pole + team flag (waving)
  b.add(seg([-0.42, 0.72, 0], [-0.42, 1.25, 0], 0.018, 0.016, 4, true), dark);
  const flag = slab([[0, 0], [0.32, -0.02], [0.28, -0.1], [0.32, -0.2], [0, -0.22]], 0.015);
  T(flag, [-0.4, 1.23, 0]);
  const R = [-0.42, 1.2, 0];
  b.add(flag, TEAM(1), { morph: waveMorph((p) => Math.max(0, p.x - R[0]), (s) => 0.07 * s / 0.32, 9, 'z') });
  const knob = octa(0.03);
  T(knob, [-0.42, 1.27, 0]);
  b.add(knob, metal);
  const bodyGeo = b.build();
  // log hanging from the ridge
  const lb = new PartBuilder();
  lb.add(seg([-0.55, 0, 0], [0.45, 0, 0], 0.075, 0.075, 6), withMat('#6b4a2a', 'wood'));
  const head = cyl(0.1, 0.085, 0.14, 6, true);
  T(head, [0.5, 0, 0], [0, 0, -PI / 2]);
  lb.add(head, metal);
  const cap = cone(0.1, 0.12, 6);
  T(cap, [0.63, 0, 0], [0, 0, -PI / 2]);
  lb.add(cap, shadeC(metal, 0.8));
  for (const x of [-0.25, 0.2]) {
    lb.add(seg([x, 0.05, 0], [x, 0.36, 0], 0.012, 0.012, 3, true), withMat('#3a3a3a', 'iron'));
    const band = cyl(0.08, 0.08, 0.03, 6, true);
    T(band, [x, 0, 0], [0, 0, PI / 2]);
    lb.add(band, withMat('#3a3a3a', 'iron'));
  }
  // axles with wheels
  const axle = new PartBuilder();
  axle.add(seg([0, 0, -0.32], [0, 0, 0.32], 0.025, 0.025, 4, true), dark);
  for (const z of [0.3, -0.3]) {
    const w = cyl(wr, wr, 0.06, 7);
    T(w, [0, 0, z], [PI / 2, 0, 0]);
    axle.add(w, withMat('#5a3e24', 'wood'));
    const hub = octa(0.045);
    T(hub, [0, 0, z * 1.12]);
    axle.add(hub, metal);
    const sp = box(0.025, wr * 1.9, 0.07);
    T(sp, [0, 0, z]);
    axle.add(sp, dark);
  }
  const axleGeo = axle.build();
  return {
    kind: 'ram',
    parts: [
      { name: 'body', parent: null, pos: [0, 0, 0], geo: bodyGeo },
      { name: 'log', parent: 'body', pos: [0, 0.38, 0], geo: lb.build() },
      { name: 'axleF', parent: null, pos: [0.36, wr, 0], geo: axleGeo },
      { name: 'axleB', parent: null, pos: [-0.36, wr, 0], geo: axleGeo },
    ],
    rig: { wheelR: wr },
  };
}

// ---------------------------------------------------------------------------

/** The dressing context of a unit type: normalized visual, palette and the mortal / worker / god flags the body builders read. */
export function unitContext(unitType) {
  const v = normalizeVisual(unitType.visual);
  const unit = { ...unitType, visual: v };
  const pal = makePalette(unit);
  const cls = unitType.class;
  const ctx = {
    unit, v, pal, cls,
    ex: new Set(v.extras),
    mortal: !unitType.pantheon || !!unitType.mortal, // a pantheon's own soldier dresses like the shared ones
    worker: cls === 'worker',
    grand: cls === 'god' || cls === 'titan',
    lod: cls === 'god' || cls === 'titan' ? 2 : cls === 'minion' && unitType.pantheon ? 0 : 1,
  };
  if (ctx.mortal && !v.body.startsWith('ram')) {
    // mortal clothing: workers and soldiers wear team tunics; archers and
    // priests keep their own colors with a team cape / stole / sash
    const teamTunic = ctx.worker || ctx.ex.has('armor');
    if (teamTunic) {
      ctx.tunic = TEAM(0.92);
      ctx.sleeve = TEAM(0.8);
      ctx.sleeveTrim = shadeC(pal.secondary, 0.9);
      ctx.skirt = ctx.worker ? pal.primary : null;
    } else {
      ctx.sleeve = shadeC(pal.primary, 0.9);
      ctx.sleeveTrim = cls === 'support' ? pal.secondary : pal.leather;
    }
  }
  return ctx;
}

/** Build the template for a unit type (not cached; see unit-models.js). */
export function buildTemplate(unitType) {
  const ctx = unitContext(unitType);
  const v = ctx.v;
  switch (v.body) {
    case 'giant': return humanoidTemplate(ctx, 'giant');
    case 'beast_biped': return humanoidTemplate(ctx, 'beast_biped');
    case 'spirit': return spiritTemplate(ctx);
    case 'naga': return nagaTemplate(ctx);
    case 'centaur': return quadTemplate(ctx);
    case 'quadruped': return quadTemplate(ctx);
    case 'elephant': return elephantTemplate(ctx);
    case 'bird': return birdTemplate(ctx);
    case 'serpent': return serpentTemplate(ctx);
    case 'hydra': return hydraTemplate(ctx);
    case 'dragon': return dragonTemplate(ctx);
    case 'insect': return insectTemplate(ctx);
    case 'ram': return ramTemplate(ctx);
    default: return humanoidTemplate(ctx, 'humanoid');
  }
}
