// The rich scarab (High and Ultra): Khepri's sacred beetle, armored in a shell of lapis and gold. One smooth skinned mesh on a bone rig of a
// body, a head with two mandibles and two antennae of two bones, and three legs of three bones a side, in place of the low-poly rigid
// parts. The pose keys of the low-poly rig (unit-anim.js, the 'insect' case: a stride, a lift for each of two sets of legs, a lunge)
// stay the source of truth; rich-insect-anim.js turns them into bone rotations. The legs and the helpers they are made with
// (insectLeg, bead) are shared with the scorpion man's lower body (rich-scorpion.js).
import { shadeC, mixC, withMat, TEAM } from './unit-geo.js';
import { WEAPON_INFO } from './unit-parts.js';
import { MeshKit, ps, rigid, alongPath, smoothstep } from './rich-kit.js';
import { creatureSpec, pathStations } from './rich-creature-kit.js';
import { legStations } from './rich-quadruped.js';
import { spike, collar } from './rich-creature-parts.js';
import { dye, mul, tint, hash } from './rich-paint.js';

const TAU = Math.PI * 2;

/** What a beetle may wear for this plan to dress it (anything else keeps the low-poly model). */
const BEETLE_EXTRAS = new Set(['shell', 'eye_glow']);

/** Which units this plan builds: an insect with no head of a person's and nothing in its hands (a beetle), wearing only a shell. */
export function insectSupported(v) {
  if (v.body !== 'insect') return false;
  if ((v.head || 'none') !== 'none' || (v.heads || 1) !== 1 || (v.headgear || 'none') !== 'none') return false;
  if ((v.weapon || 'none') !== 'none' || (v.offhand || 'none') !== 'none') return false;
  return (v.extras || []).every((e) => BEETLE_EXTRAS.has(e));
}

/**
 * The legs of a beetle, the right side's (the left mirrors it): the hip, the knee, the ankle and the toe of the front legs, the middle ones
 * and the hind ones, and the radius of the thigh. The front legs dig: a broad shin with teeth.
 */
const LEGS = {
  F: { pts: [[0.19, 0.15, 0.1], [0.29, 0.235, 0.235], [0.355, 0.07, 0.325], [0.375, 0.006, 0.345]], r: 0.027, digger: true },
  M: { pts: [[0.02, 0.15, 0.115], [0.05, 0.26, 0.265], [0.075, 0.085, 0.365], [0.08, 0.006, 0.385]], r: 0.023 },
  B: { pts: [[-0.17, 0.15, 0.1], [-0.25, 0.245, 0.24], [-0.345, 0.075, 0.33], [-0.365, 0.006, 0.35]], r: 0.022 },
};
/** The beetle's legs by name (the key, then 1 for the right side and -1 for the left): F1, F-1, M1, M-1, B1, B-1. */
export const BEETLE_LEGS = Object.keys(LEGS).flatMap((k) => [1, -1].map((side) => `${k}${side}`));

const mirror = (p, side) => [p[0], p[1], p[2] * side];

/** A small ball (an eye, a knob) at `p`, `r` across: a short loft with round ends. */
export function bead(kit, p, r, opts) {
  kit.loft([ps(p[0] - r * 0.12, p[1], p[2], r, r), ps(p[0] + r * 0.12, p[1], p[2], r, r)], { ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: r, ...opts });
}

/**
 * One jointed leg: a tube along `pts` (the hip, the knee, the ankle and the toe), thickest at the thigh and pinched at the joints, a ring
 * of gold at the knee and the ankle, spurs on the shin and a claw at the toe. o: { pts, bones: [thigh, shin, foot], r (the thigh's
 * radius), color, spur (the color of the rings, spurs and claw), spurMat (their surface class, gold), rings (false: no rings at the joints), spurs (false: no
 * spur at the ankle),
 * shin: [width, depth] (the shin's radii, as a share of the usual: the digging legs' broad blade), teeth (spikes along the shin's outer
 * edge), sides, lite (a plainer profile, fewer rings), paint }.
 */
export function insectLeg(kit, o) {
  const { pts, bones, r, color, spur } = o;
  const spurMat = o.spurMat ?? 'gold';
  const bind = alongPath(bones, pts, [0.03, 0.022]);
  const [sx, sz] = o.shin || [1, 1];
  const side = pts[0][2] < 0 ? -1 : 1;
  const list = o.lite
    ? [[0, 0.85, 0.85], [0.6, 1.12, 1.12], [0.95, 0.62, 0.62], [1.45, 0.86 * sx, 0.86 * sz], [1.95, 0.46, 0.46], [2.5, 0.42, 0.42], [3.0, 0.3, 0.3]]
    : [
      [0, 0.85, 0.85], [0.45, 1.15, 1.15], [0.93, 0.92, 0.92],
      [1.0, 0.62, 0.62],
      [1.1, 0.78 * sx, 0.78 * sz], [1.5, 0.88 * sx, 0.88 * sz], [1.93, 0.66 * sx, 0.66 * sz],
      [2.0, 0.46, 0.46],
      [2.1, 0.52, 0.52], [2.5, 0.42, 0.42], [3.0, 0.3, 0.3],
    ];
  kit.loft(legStations(pts, list, r), { ref: [1, 0, 0], sides: o.sides ?? 8, start: 'round', end: 'round', capRings: 2, color, mat: 'bone', bind, paint: o.paint });
  const dir = (a, b) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...d) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  };
  // a ring of gold at each joint
  if (o.rings !== false) {
    for (const [i, k] of [[1, 0.95], [2, 0.62]]) {
      collar(kit, { at: pts[i], dir: dir(pts[i - 1], pts[i + 1]), rx: r * k + 0.003, rz: r * k + 0.003, h: 0.014, color: spur, mat: spurMat, bind: rigid(bones[i - 1]), sides: o.sides ?? 8 });
    }
  }
  // spurs at the end of the shin, teeth along its edge when it digs
  const shin = dir(pts[1], pts[2]);
  if (o.spurs !== false) spike(kit, { at: pts[2], dir: [shin[0] * 0.5, 0, side * 0.85], len: 0.03, r: 0.007, color: spur, mat: spurMat, bind: rigid(bones[1]), sides: 4, ref: [0, 1, 0] });
  if (o.teeth) {
    for (let k = 0; k < o.teeth; k++) {
      const u = 1.25 + (0.55 * k) / Math.max(1, o.teeth - 1);
      const at = [pts[1][0] + (pts[2][0] - pts[1][0]) * (u - 1), pts[1][1] + (pts[2][1] - pts[1][1]) * (u - 1), pts[1][2] + (pts[2][2] - pts[1][2]) * (u - 1)];
      spike(kit, { at: [at[0] + 0.012, at[1], at[2]], dir: [1, 0.2, side * 0.25], len: 0.03, r: 0.0085, color: spur, mat: spurMat, bind: rigid(bones[1]), sides: 4, ref: [0, 1, 0] });
    }
  }
  // the claw
  const toe = pts[3];
  spike(kit, { at: [toe[0] - 0.004, toe[1] + 0.014, toe[2]], dir: [0.5, -0.6, side * 0.65], len: 0.034, r: 0.006, color: spur, mat: spurMat, bind: rigid(bones[2]), sides: 4, ref: [0, 1, 0] });
}

// ---------------------------------------------------------------------------
// the template
// ---------------------------------------------------------------------------

/** The beetle's bones: [name, parent, rest position] (the legs follow, three bones a side). */
function skeleton() {
  const list = [
    ['root', null, [0, 0, 0]],
    ['body', 'root', [0.0, 0.2, 0]],
    ['head', 'body', [0.3, 0.185, 0]],
    ['mandR', 'head', [0.385, 0.15, 0.035]], ['mandL', 'head', [0.385, 0.15, -0.035]],
    ['antR1', 'head', [0.4, 0.205, 0.05]], ['antR2', 'antR1', [0.455, 0.245, 0.085]],
    ['antL1', 'head', [0.4, 0.205, -0.05]], ['antL2', 'antL1', [0.455, 0.245, -0.085]],
  ];
  for (const key of BEETLE_LEGS) {
    const [k, side] = [key[0], Number(key.slice(1))];
    const pts = LEGS[k].pts.map((p) => mirror(p, side));
    list.push([`${key}u`, 'body', pts[0]], [`${key}l`, `${key}u`, pts[1]], [`${key}p`, `${key}l`, pts[2]]);
  }
  return creatureSpec(list);
}

/** The rich template of a beetle unit type: { kind, rich: { spec, geo, attach, ... }, rig, parts: [] }. */
export function buildInsectTemplate(unitType, ctx) {
  const { v, pal } = ctx;
  const spec = skeleton();
  const ix = spec.ix;
  const kit = new MeshKit(spec, { sides: 12, rings: 1 });

  const lapis = pal.skin;
  const deep = pal.secondary;
  const gold = withMat(pal.accent, 'gold');
  const sheen = mixC(lapis, '#7fd0e6', 0.55);
  const legC = shadeC(lapis, 0.78);
  const body = rigid(ix.body);
  const headB = rigid(ix.head);

  // the elytra: two domes side by side, each a loft from the tail to the shoulder, their seam a crease that the team's ridge runs along
  const elytra = (side) => pathStations([
    [-0.435, 0.18, 0.03 * side, 0.03, 0.04, 2],
    [-0.385, 0.19, 0.045 * side, 0.08, 0.085, 2],
    [-0.29, 0.2, 0.058 * side, 0.112, 0.113, 2.2],
    [-0.15, 0.21, 0.063 * side, 0.125, 0.12, 2.3],
    [-0.01, 0.208, 0.062 * side, 0.12, 0.118, 2.3],
    [0.1, 0.2, 0.052 * side, 0.09, 0.095, 2],
  ], 14);
  const shellPaint = (side) => (o, x, y, z, u, a) => {
    const top = Math.cos(a * TAU);
    const outer = side > 0 ? 0.75 : 0.25;
    // the lower flank and the underside are dark chitin, the back has a sheen along it and fine ribs running lengthwise
    mul(o, 0.48 + 0.52 * smoothstep(-0.6, 0.25, top));
    tint(o, sheen, 0.34 * smoothstep(0.55, 1, top) * smoothstep(0.02, 0.35, u) * (1 - smoothstep(0.8, 1, u)));
    const rib = Math.abs(Math.sin(a * TAU * 6.5));
    mul(o, 0.9 + 0.1 * smoothstep(0.15, 0.7, rib) * smoothstep(-0.2, 0.5, top));
    // a rim of gold along the side, flecks of it in the lapis
    if (Math.abs(a - outer) < 0.02) dye(o, gold, 0.9);
    else if (hash(Math.round(x * 85), Math.round(y * 85), Math.round(z * 85)) > 0.965) dye(o, gold, 0.55);
  };
  const ridge = [];
  for (const side of [1, -1]) {
    const st = elytra(side);
    kit.loft(st, { ref: [0, 1, 0], sides: 24, start: 'round', end: 'round', capRings: 3, capDepth: [0.05, 0.05], color: lapis, mat: 'lacquer', bind: body, paint: shellPaint(side) });
    if (side > 0) {
      for (const s of st) {
        // where the two domes cross, over the crease between them
        const f = Math.min(0.999, Math.abs(s.c[2]) / s.rz);
        const n = s.n || 2;
        ridge.push([s.c[0], s.c[1] + s.rx * (1 - f ** n) ** (1 / n) + 0.004, 0]);
      }
    }
  }
  // the seam of the shell, in the team's color (a strip on the lapis, as the low-poly beetle has)
  kit.loft(ridge.slice(1).map((p, i, a) => ps(p[0], p[1], 0, 0.014, 0.034 * Math.min(1, (i + 1) / 3, (a.length - i) / 3))), {
    ref: [0, 1, 0], sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: 0.02, color: TEAM(1, 'lacquer'), bind: body,
  });

  // the pronotum: a broad shield behind the head, a rim of gold along its edge
  kit.loft(pathStations([
    [0.03, 0.2, 0, 0.1, 0.14, 2.4], [0.12, 0.21, 0, 0.108, 0.165, 2.5], [0.22, 0.205, 0, 0.098, 0.155, 2.4], [0.3, 0.195, 0, 0.075, 0.115, 2.2], [0.335, 0.19, 0, 0.05, 0.08, 2],
  ], 10), {
    ref: [0, 1, 0], sides: 20, start: 'round', end: 'round', capRings: 3, capDepth: [0.04, 0.03], color: lapis, mat: 'lacquer', bind: body,
    paint: (o, x, y, z, u, a) => {
      const top = Math.cos(a * TAU);
      mul(o, 0.5 + 0.5 * smoothstep(-0.55, 0.3, top));
      tint(o, sheen, 0.3 * smoothstep(0.5, 1, top));
      if (Math.abs(a - 0.25) < 0.03 || Math.abs(a - 0.75) < 0.03) dye(o, gold, 0.9);
    },
  });

  // under the shell, the dark belly between the legs
  kit.loft(pathStations([[-0.38, 0.13, 0, 0.04, 0.12], [-0.15, 0.125, 0, 0.05, 0.14], [0.1, 0.125, 0, 0.05, 0.13], [0.25, 0.13, 0, 0.04, 0.09]], 8), {
    ref: [0, 1, 0], sides: 12, start: 'round', end: 'round', capRings: 2, capDepth: 0.04, color: deep, mat: 'bone', bind: body,
  });

  // the head: a broad flat clypeus with its teeth, eyes at the sides, two mandibles under it, two antennae
  kit.loft(pathStations([[0.29, 0.185, 0, 0.055, 0.085, 2.4], [0.35, 0.18, 0, 0.05, 0.1, 3], [0.41, 0.17, 0, 0.034, 0.095, 3.2]], 6), {
    ref: [0, 1, 0], sides: 18, start: 'round', end: 'round', capRings: 2, capDepth: [0.03, 0.012], color: shadeC(lapis, 0.9), mat: 'lacquer', bind: headB,
    paint: (o, x, y, z, u) => {
      tint(o, gold, 0.5 * smoothstep(0.7, 1, u));
    },
  });
  for (const z of [-0.07, -0.035, 0, 0.035, 0.07]) {
    spike(kit, { at: [0.403, 0.172, z], dir: [1, -0.08, z * 1.5], len: 0.034, r: 0.011, flat: 0.8, color: gold, mat: 'gold', bind: headB, sides: 5, ref: [0, 1, 0] });
  }
  for (const side of [1, -1]) {
    bead(kit, [0.345, 0.2, 0.093 * side], 0.021, { color: withMat('#17120c', 'gloss'), mat: 'gloss', bind: headB });
    const mand = side > 0 ? ix.mandR : ix.mandL;
    kit.loft([ps(0.385, 0.15, 0.04 * side, 0.015, 0.015), ps(0.43, 0.142, 0.056 * side, 0.012, 0.012), ps(0.462, 0.146, 0.026 * side, 0.004, 0.004)], {
      ref: [0, 1, 0], sides: 6, rings: 5, start: 'round', end: 'round', capRings: 2, capDepth: 0.01, color: mixC(gold, '#6a4a1a', 0.55), mat: 'bone', bind: rigid(mand),
    });
    // an antenna: a shaft of two bones ending in a club of three flat lamellae
    const a1 = side > 0 ? ix.antR1 : ix.antL1;
    const a2 = side > 0 ? ix.antR2 : ix.antL2;
    const base = [0.4, 0.205, 0.05 * side];
    const mid = [0.455, 0.245, 0.085 * side];
    const tip = [0.495, 0.265, 0.108 * side];
    kit.loft([ps(...base, 0.008, 0.008), ps(...mid, 0.006, 0.006)], { ref: [0, 1, 0], sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.006, color: legC, mat: 'bone', bind: rigid(a1) });
    kit.loft([ps(...mid, 0.006, 0.006), ps(...tip, 0.005, 0.005)], { ref: [0, 1, 0], sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.005, color: legC, mat: 'bone', bind: rigid(a2) });
    const sd = [tip[0] - mid[0], tip[1] - mid[1], tip[2] - mid[2]];
    const sl = Math.hypot(...sd);
    for (const f of [-1, 0, 1]) {
      // the lamellae fan out in the vertical plane from the end of the shaft, flat sheets
      const d = [sd[0] / sl, sd[1] / sl + 0.55 * f, sd[2] / sl];
      const dl = Math.hypot(...d);
      const e = [tip[0] + (d[0] / dl) * 0.042, tip[1] + (d[1] / dl) * 0.042, tip[2] + (d[2] / dl) * 0.042];
      kit.loft([ps(...tip, 0.003, 0.011), ps((tip[0] + e[0]) / 2, (tip[1] + e[1]) / 2, (tip[2] + e[2]) / 2, 0.003, 0.015), ps(...e, 0.002, 0.006)], {
        ref: [0, 0, 1], sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.004, color: gold, mat: 'gold', bind: rigid(a2),
      });
    }
  }

  // legs
  for (const key of BEETLE_LEGS) {
    const [k, side] = [key[0], Number(key.slice(1))];
    const L = LEGS[k];
    insectLeg(kit, {
      pts: L.pts.map((p) => mirror(p, side)), bones: [ix[`${key}u`], ix[`${key}l`], ix[`${key}p`]], r: L.r, color: legC, spur: gold,
      shin: L.digger ? [2.1, 0.7] : undefined, teeth: L.digger ? 3 : 0,
      paint: (o, x, y, z, u) => mul(o, 1.05 - 0.28 * u),
    });
  }

  const geo = kit.build({ ground: 1 });
  const rig = {
    legLen: 0.15, bodyY: 0.2, sprawl: true, stride: 0.9, humanTop: false,
    weapon: v.weapon, info: WEAPON_INFO[v.weapon] || WEAPON_INFO.none, rightElbow: 0.25, leftElbow: 0.25,
    gait: 'walk', holdAloft: false, plan: 'insect',
  };
  return {
    kind: 'insect', rich: { spec, geo, attach: [], dims: { shoulderY: 0.3, shoulderZ: 0.18 }, carryAt: [0, 0.2, 0], plan: 'insect', ix }, parts: [], rig,
    triangles: geo.userData.triangles, meshes: 1,
  };
}
