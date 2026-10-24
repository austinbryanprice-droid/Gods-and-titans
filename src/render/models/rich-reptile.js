// The rich lizards (High and Ultra): Cipactli, the crocodile, and the Mushussu, a dragon-headed beast on four legs. They have
// the four-legged beasts' skeleton (rich-quadruped.js: hips, spine, chest, a neck of two bones, a head with a jaw, a tail of four
// bones, four legs of three bones), so rich-creature-anim.js poses them from the same pose keys, but the body is a reptile's: a
// long barrel under a thick tail, legs that stand out to the sides, a crocodile's or a dragon's head (rich-reptile-heads.js), plates
// or scales for skin (the serpents' paint, rich-serpent.js) and a row or two of spikes down the back.
import { shadeC, mixC, TEAM, withMat } from './unit-geo.js';
import { WEAPON_INFO } from './unit-parts.js';
import { holdsAloft } from './unit-bodies.js';
import { MeshKit, rigid, alongPath, mixBind, smoothstep, ps } from './rich-kit.js';
import { creatureSpec, pathStations, frameMatrix, headToModel, pathOf, bonesOf, atJoint, TAIL_KEYS } from './rich-creature-kit.js';
import { reptileHead, reptileMetrics } from './rich-reptile-heads.js';
import { scalesPaint, ring, dorsal, glowEye, underside } from './rich-serpent.js';
import { paw, spike } from './rich-creature-parts.js';
import { barrelAt, legStations, saddle } from './rich-quadruped.js';
import { tint } from './rich-paint.js';

/** The head kinds this plan builds (the unit's visual.head) and the build each one rides on. */
const BUILD_OF = { crocodile: 'croc', dragon: 'drake' };

const LIZARD_EXTRAS = new Set(['spikes', 'tail', 'eye_glow']);
const DRAKE_GEAR = new Set(['none', 'horns', 'antlers', 'crown']);

/** Which units this plan builds: a quadruped with a crocodile's head, or a dragon's (bare or in the gear a dragon wears), holding nothing. */
export function reptileSupported(v) {
  if (v.body !== 'quadruped' || !BUILD_OF[v.head] || v.heads !== 1 || v.weapon !== 'none' || v.offhand !== 'none') return false;
  if (!(v.head === 'dragon' ? DRAKE_GEAR.has(v.headgear) : v.headgear === 'none')) return false;
  return v.extras.every((e) => LIZARD_EXTRAS.has(e));
}

/**
 * Proportions at scale 1 (what the low-poly reptile covers, so a rich one keeps its place on the map): L body length, H chest depth,
 * W body width, leg (shoulder height less the chest), legR leg radius, head length, head pitch (absolute, nose down negative), tail
 * length, stance (how far out the legs stand, of the width), out (how much further out the elbows and knees go than the hips), plates
 * (square plates for skin, else scale diamonds), `body`: the barrel's stations [x of L, height of H, half depth of H, half width of W]
 * from the rump to the chest, `neck`: the [half depth, half width] of the neck's two joints and the skull's base (model units),
 * neckLen / neckA: the neck's length and its angle up from horizontal (radians). `tail`: how it runs, see TAILS.
 */
const BUILDS = {
  croc: {
    L: 1.0, H: 0.27, W: 0.27, leg: 0.115, legR: 0.04, pawK: 1.25, toes: 5, head: 0.52, pitch: -0.03, tail: 0.95, stance: 0.74, out: 1.5, plates: true, rowsK: 9, per: 13, neckLen: 0.1, neckA: -0.05, tailKind: 'croc',
    body: [[-0.5, 0.08, 0.42, 0.5], [-0.4, 0.04, 0.5, 0.62], [-0.2, 0, 0.52, 0.7], [0.0, 0, 0.52, 0.72], [0.2, 0.0, 0.5, 0.68], [0.32, 0.02, 0.44, 0.56], [0.45, 0.05, 0.36, 0.44]],
    neck: [[0.105, 0.15], [0.09, 0.14], [0.075, 0.125]],
  },
  drake: {
    L: 0.8, H: 0.27, W: 0.25, leg: 0.22, legR: 0.045, pawK: 1.1, head: 0.34, pitch: -0.32, tail: 0.9, stance: 0.55, out: 1.3, plates: false, rowsK: 11, per: 10, neckLen: 0.3, neckA: 0.55, tailKind: 'drake',
    body: [[-0.5, 0.1, 0.34, 0.4], [-0.4, 0.06, 0.46, 0.55], [-0.2, 0.03, 0.5, 0.6], [0.0, 0.0, 0.5, 0.6], [0.2, 0.0, 0.5, 0.6], [0.32, 0.03, 0.46, 0.52], [0.45, 0.08, 0.4, 0.45]],
    neck: [[0.085, 0.075], [0.065, 0.058], [0.055, 0.05]],
  },
};

/** How a tail runs from the rump: `back` (fractions of its length), `drop` and `swing` (of its length, down and sideways at each joint), `r` the [half depth, half width] there. */
const TAILS = {
  croc: { back: [0.2, 0.46, 0.74, 1.0], drop: [-0.005, -0.03, -0.06, -0.075], swing: [0, 0.035, -0.04, 0.05], r: [[0.118, 0.13], [0.095, 0.1], [0.066, 0.064], [0.038, 0.034], [0.012, 0.01]] },
  drake: { back: [0.2, 0.47, 0.75, 1.0], drop: [0.02, 0.03, 0.0, -0.04], swing: [0, 0.04, -0.04, 0.05], r: [[0.075, 0.075], [0.06, 0.06], [0.043, 0.043], [0.026, 0.026], [0.008, 0.008]] },
};

/** A lizard's foot under the lower leg at (x, z): a flat pad with `n` toes fanned out from the front, the outer ones turned out, each ending in a claw. */
function lizardFoot(kit, o) {
  const { x, z, r, n, color, claw, bind, paint } = o;
  const side = z < 0 ? -1 : 1;
  kit.loft([ps(x - r * 0.7, r * 0.95, z, r * 0.55, r * 0.85), ps(x - r * 0.05, r * 0.6, z, r * 0.6, r * 1.15), ps(x + r * 0.8, r * 0.42, z, r * 0.42, r * 1.0)],
    { ref: [0, 1, 0], rings: 5, sides: 10, start: 'round', end: 'round', capRings: 2, capDepth: r * 0.45, color, bind, paint });
  for (let k = 0; k < n; k++) {
    const a = (n === 1 ? 0 : k / (n - 1) - 0.5) * 1.8 + side * 0.22;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const b0 = [x + r * 0.6 * c, r * 0.42, z + r * 0.6 * sn];
    const len = r * (2.5 - 0.35 * Math.abs(k - (n - 1) / 2));
    const mid = [b0[0] + c * len * 0.55, r * 0.34, b0[2] + sn * len * 0.55];
    const tip = [b0[0] + c * len, r * 0.26, b0[2] + sn * len];
    kit.loft([ps(b0[0], b0[1], b0[2], r * 0.4, r * 0.4), ps(mid[0], mid[1], mid[2], r * 0.33, r * 0.34), ps(tip[0], tip[1], tip[2], r * 0.27, r * 0.28)],
      { ref: [0, 1, 0], rings: 3, sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: r * 0.25, color, bind, paint });
    if (claw) spike(kit, { at: [tip[0] - c * r * 0.1, r * 0.25, tip[2] - sn * r * 0.1], dir: [c, -0.18, sn], len: r * 0.75, r: r * 0.2, color: claw, mat: 'bone', bind, sides: 4, ref: [0, 1, 0] });
  }
}

// ---------------------------------------------------------------------------
// layout: where every bone and landmark sits
// ---------------------------------------------------------------------------

function layout(Q, kind) {
  const { L, H, W, leg } = Q;
  const cy = leg + H * 0.45;
  const lz = W * Q.stance;
  const fx = L * 0.3;
  const bx = -L * 0.3;
  const hips = [bx, cy + H * 0.1, 0];
  const spine = [0, cy + H * 0.08, 0];
  const chest = [L * 0.28, cy + H * 0.05, 0];
  const neck1 = [L * 0.38, cy + H * 0.2, 0];
  const dn = [Math.cos(Q.neckA), Math.sin(Q.neckA), 0];
  const neck2 = [neck1[0] + dn[0] * Q.neckLen * 0.5, neck1[1] + dn[1] * Q.neckLen * 0.5, 0];
  const head = [neck1[0] + dn[0] * Q.neckLen, neck1[1] + dn[1] * Q.neckLen, 0];
  const M = frameMatrix(head, Q.pitch, 0, 1);
  const jaw = headToModel(M, reptileMetrics(kind, Q.head).jawAt);
  // the tail leaves the rump low and trails back, swinging a little from side to side
  const T = TAILS[Q.tailKind];
  const t0 = [-L * 0.5, cy + H * 0.02, 0];
  const tail = [t0, ...T.back.map((b, i) => [t0[0] - Q.tail * b, t0[1] + Q.tail * T.drop[i], Q.tail * T.swing[i]])];
  // legs: shoulder / hip, elbow / knee (out to the side), wrist / ankle, ground
  const legs = {};
  for (const side of [1, -1]) {
    const z = side * lz;
    legs[`F${side}`] = [[fx, leg + H * 0.38, z * 0.7], [fx - 0.012, leg * 0.78, z * Q.out], [fx + 0.008, leg * 0.28, z * Q.out * 0.92], [fx + 0.02, 0.0, z * Q.out * 0.92]];
    legs[`B${side}`] = [[bx + 0.012, leg + H * 0.5, z * 0.7], [bx + L * 0.13, leg * 0.8, z * Q.out], [bx - L * 0.05, leg * 0.34, z * Q.out * 0.95], [bx - L * 0.04, 0.0, z * Q.out * 0.95]];
  }
  return { cy, lz, fx, bx, hips, spine, chest, neck1, neck2, head, jaw, tail, legs, dn };
}

function skeleton(Lay) {
  const list = [
    ['root', null, [0, 0, 0]],
    ['hips', 'root', Lay.hips], ['spine', 'hips', Lay.spine], ['chest', 'spine', Lay.chest],
    ['neck1', 'chest', Lay.neck1], ['neck2', 'neck1', Lay.neck2], ['head', 'neck2', Lay.head], ['jaw', 'head', Lay.jaw],
  ];
  Lay.tail.slice(0, 4).forEach((p, i) => list.push([`tail${i + 1}`, i ? `tail${i}` : 'hips', p]));
  for (const [key, pts] of Object.entries(Lay.legs)) {
    const par = key[0] === 'F' ? 'chest' : 'hips';
    list.push([`${key}u`, par, pts[0]], [`${key}l`, `${key}u`, pts[1]], [`${key}p`, `${key}l`, pts[2]]);
  }
  return creatureSpec(list);
}

// ---------------------------------------------------------------------------
// the template
// ---------------------------------------------------------------------------

/** The rich template of a lizard unit type: { kind, rich: { spec, geo, attach, ... }, rig, parts: [] }. */
export function buildReptileTemplate(unitType, ctx) {
  const { v, pal, ex } = ctx;
  const head = v.head;
  const Q = { ...BUILDS[BUILD_OF[head]] };
  if (ctx.unit.class === 'titan' || v.scale >= 3) Q.legR *= 1.15;
  const Lay = layout(Q, head);
  const spec = skeleton(Lay);
  const ix = spec.ix;
  const kit = new MeshKit(spec, { sides: ctx.grand ? 16 : 12, rings: 1 });
  const { L, H, W, leg, legR } = Q;
  const cy = Lay.cy;

  const skin = pal.skin;
  const belly = underside(skin);
  const dark = shadeC(skin, 0.62);
  const scales = (len, back) => scalesPaint(len, { skin, back: pal.back, belly, backK: back, plates: Q.plates, rowsK: Q.rowsK, per: Q.per });

  // the barrel and the neck as one loft, from the rump through the chest to the skull's base
  const keys = Q.body.slice(0, -1).map(([f, yo, ry, rz]) => [L * f, cy + H * yo, 0, H * ry, W * rz]);
  keys.push([Lay.neck1[0], Lay.neck1[1], 0, ...Q.neck[0]], [Lay.neck2[0], Lay.neck2[1], 0, ...Q.neck[1]], [Lay.head[0] - 0.012, Lay.head[1] - 0.004, 0, ...Q.neck[2]]);
  const names = ['hips', 'spine', 'chest', 'neck1', 'neck2', 'head'];
  const bodyPts = pathOf(spec, names);
  const frontBind = alongPath(bonesOf(spec, names), bodyPts, [0.06, 0.07, 0.05, 0.05, 0.04].map((x) => x * Math.max(1, L / 0.64)));
  const bodyBind = alongPath(bonesOf(spec, ['hips', 'spine', 'chest']), [...bodyPts.slice(0, 3), [L * 0.5, cy + H * 0.12, 0]]);
  const bodySt = pathStations(keys, 19);
  kit.loft(bodySt, { ref: [0, 1, 0], rings: 30, sides: 22, start: 'round', end: 'round', capRings: 3, capDepth: [L * 0.1, Q.neck[2][1] * 0.5], color: skin, bind: frontBind, paint: scales(L + Q.neckLen, 0.5) });

  // the team's color: two bands round a big one's barrel, a cloth over a small one's back
  if (v.scale >= 2.6) {
    ring(kit, bodySt, 6, 7, 1.06, TEAM(1), frontBind);
    ring(kit, bodySt, 11, 12, 1.06, TEAM(0.85), frontBind);
  } else {
    saddle(kit, Q, cy, frontBind, pal);
  }

  // the head, with its jaw
  const glow = ex.has('eye_glow') && !!pal.eyeGlow;
  const dragon = head === 'dragon';
  reptileHead(kit, {
    kind: head, at: Lay.head, pitch: Q.pitch, len: Q.head, bind: { head: rigid(ix.head), jaw: rigid(ix.jaw) },
    skin, belly, back: pal.back, glowEyes: glow, eyeColor: glow ? glowEye(pal) : withMat(dragon ? '#f0d040' : '#d8b030', 'gloss'), tongue: dragon,
    gear: dragon ? v.headgear : 'none', horn: pal.horn, antler: withMat(mixC(pal.accent, pal.bone, 0.4), 'bone'), metal: pal.accentMetal, gem: pal.secondary,
  });

  // legs
  for (const key of Object.keys(Lay.legs)) {
    const front = key[0] === 'F';
    const pts = Lay.legs[key];
    const bones = [ix[`${key}u`], ix[`${key}l`], ix[`${key}p`]];
    const legBind = alongPath(bones, pts, [0.03, 0.022]);
    const top = pts[0][1];
    const bind = mixBind(legBind, bodyBind, (x, y) => smoothstep(top - 0.01, top + H * 0.2, y));
    const r = legR;
    const path = [[pts[0][0] + (front ? 0.01 : 0.0), pts[0][1] + H * 0.3, pts[0][2] * 0.85], ...pts.slice(0, 3), [pts[3][0], r * 1.5, pts[3][2]]];
    const st = front
      ? legStations(path, [[0, 1.5, 1.1], [1, 1.8, 1.25], [1.5, 1.5, 1.1], [2, 1.12, 0.92], [2.5, 0.86, 0.72], [3, 0.68, 0.6], [3.5, 0.62, 0.57], [4, 0.72, 0.64]], r)
      : legStations(path, [[0, 2.3, 1.1], [1, 2.9, 1.25], [1.5, 2.6, 1.25], [2, 1.65, 1.1], [2.5, 1.12, 0.9], [3, 0.82, 0.7], [3.5, 0.62, 0.56], [4, 0.7, 0.62]], r);
    // a leg's loft runs about a forward axis, so the body's back and belly tones do not belong on it: only the pattern
    const legPaint = scalesPaint(1.2, { skin, back: skin, belly: skin, backK: 0, plates: Q.plates, rowsK: Q.rowsK, per: Q.per });
    kit.loft(st, {
      ref: [1, 0, 0], rings: 12, sides: 10, start: null, end: null, color: skin, bind,
      paint: (o, x, y, z, u, a) => {
        legPaint(o, x, y, z, u, a);
        tint(o, dark, 0.45 * smoothstep(leg * 0.5, leg * 0.1, y));
      },
    });
    const footPaint = (o) => tint(o, dark, 0.3);
    if (Q.toes) lizardFoot(kit, { x: pts[3][0] - r * 0.7, z: pts[3][2], r: r * 1.05 * Q.pawK, n: front ? Q.toes : Q.toes - 1, color: shadeC(skin, 0.85), claw: pal.bone, bind: rigid(ix[`${key}p`]), paint: footPaint });
    else paw(kit, { x: pts[3][0] - r * 0.7, z: pts[3][2], r: r * 1.05 * Q.pawK, color: shadeC(skin, 0.85), bind: rigid(ix[`${key}p`]), claw: pal.bone, paint: footPaint });
  }

  // the tail: a thick taper of four bones
  const tb = alongPath(bonesOf(spec, [1, 2, 3, 4].map((i) => `${TAIL_KEYS[0]}${i}`)), Lay.tail, 0.05);
  const T = TAILS[Q.tailKind];
  const tailKeys = Lay.tail.map((p, i) => [p[0], p[1], p[2], ...T.r[i]]);
  const tailSt = pathStations(tailKeys, 11);
  kit.loft(tailSt, { ref: [0, 1, 0], sides: 12, start: 'round', end: 'round', capRings: 3, capDepth: [0.05, 0.05], color: skin, bind: tb, paint: scales(Q.tail, 0.4) });

  // spikes: two rows of low plates down a crocodile's back and tail, one row of horns down a dragon's neck, back and tail
  if (ex.has('spikes')) {
    const sc = pal.horn;
    if (Q.plates) {
      dorsal(kit, bodySt, frontBind, { from: 1, to: bodySt.length - 5, step: 2, color: sc, k: 0.36, w: 2.1, a: 0.5, flip: true });
      dorsal(kit, tailSt, tb, { from: 1, to: tailSt.length - 3, step: 2, color: sc, k: 0.32, w: 2.1, a: 0.45 });
    } else {
      dorsal(kit, bodySt, frontBind, { from: 2, to: bodySt.length - 3, step: 3, color: sc, k: 0.95, flip: true });
      dorsal(kit, tailSt, tb, { from: 1, to: tailSt.length - 3, step: 3, color: sc, k: 0.8 });
    }
  }

  const geo = kit.build({ ground: 1 });
  const rig = {
    legLen: leg, bodyY: cy, sprawl: true, stride: leg * 3.2 + L * 0.6,
    weapon: v.weapon, info: WEAPON_INFO[v.weapon] || WEAPON_INFO.none, rightElbow: 0.25, leftElbow: 0.25,
    gait: 'walk', holdAloft: holdsAloft(v), plan: 'quadruped',
  };
  return {
    kind: 'quadruped', rich: { spec, geo, attach: [], dims: { shoulderY: cy + H, shoulderZ: Lay.lz }, carryAt: Lay.chest, plan: 'quadruped', ix }, parts: [], rig,
    triangles: geo.userData.triangles, meshes: 1,
  };
}
