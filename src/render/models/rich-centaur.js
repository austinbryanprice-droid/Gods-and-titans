// The rich centaurs (High and Ultra): a person's upper body, dressed as any person is (rich-humanoid.js, the outfit layers of the
// pantheon), rising from the withers of a horse's body: a barrel, four legs with hooves, a tail (the equine build of rich-quadruped.js,
// without its neck and head). One skinned mesh on the humanoid's bones (the legs' three bones a side stay at rest, unused) and the
// horse's: a back of three bones, four tails, four legs of three. The person's pelvis is a child of the horse's withers, so the
// body pitches with the horse's front while the pose (rich-centaur-anim.js) keeps the person's chest steady above it.
//
// The model is built in a frame of its own, the person's pelvis at x = 0 (so every layer's lofts, which are made about the person's
// middle, are right as they are), and moved to the horse's middle at the end (`settle`).
import { shadeC } from './unit-geo.js';
import { alongPath, mixBind, rigid, smoothstep, B, BONE_NAMES } from './rich-kit.js';
import { addBones, bonesOf, pathOf, pathStations } from './rich-creature-kit.js';
import { BUILDS, layout, legStations, saddle } from './rich-quadruped.js';
import { hoof } from './rich-creature-parts.js';
import { hairTail } from './rich-creature-hair.js';
import { tint, furStreaks } from './rich-paint.js';

const PI = Math.PI;

/** What a centaur may wear for this plan to dress it (anything else keeps the low-poly model). */
const CENTAUR_EXTRAS = new Set(['beard', 'long_hair', 'cape', 'armor', 'eye_glow', 'tail']);

/** Which units this plan builds: a centaur with a human head or none (the Dullahan carries his), no headgear, and only extras it can show. */
export function centaurSupported(v) {
  if (v.body !== 'centaur') return false;
  if (!['human', 'none'].includes(v.head || 'human') || (v.heads || 1) !== 1) return false;
  if ((v.headgear || 'none') !== 'none') return false;
  return (v.extras || []).every((e) => CENTAUR_EXTRAS.has(e));
}

/**
 * The horse under the person, as proportions at scale 1: the quadruped plan's equine build, heavier to carry a torso (broader, deeper,
 * thicker in the leg), the barrel ending under the person's front (the equine build's goes on to a neck) so that the chest does not
 * bulge out in front of the person's belly.
 */
const HORSE = {
  ...BUILDS.equine, W: 0.3, H: 0.3, legR: 0.052,
  body: [[-0.54, 0.1, 0.36, 0.36], [-0.44, 0.1, 0.46, 0.46], [-0.26, 0.08, 0.46, 0.45], [-0.06, 0.05, 0.5, 0.45], [0.14, 0.02, 0.53, 0.46], [0.3, 0.0, 0.5, 0.44], [0.37, 0.03, 0.4, 0.34]],
};

/**
 * Where the person stands on the horse: the horse's build and layout (rich-quadruped.js), `tx` how far in front of the barrel's middle
 * the person's pelvis is, `lift` how far the person is raised to stand on the horse's back (the waist at the level of the withers).
 */
export function centaurFrame(D) {
  const Q = { ...HORSE };
  const Lay = layout(Q, 'human', { wings: 0, tails: 1, heads: 1 });
  return { Q, Lay, tx: Q.L * 0.34, lift: Lay.cy + Q.H * 0.25 - D.hipY };
}

/** The person's dimensions raised by `dy`, in place: everything that stands above the ground (the layers read them). */
export function raiseDims(D, dy) {
  for (const k of ['hipY', 'shoulderY', 'headY', 'headCY', 'headPivot', 'neckY', 'ankleY']) D[k] += dy;
  return D;
}

/**
 * The horse's bones on a humanoid spec (rich-kit.js humanoidSpec): the back (hips, back, withers), four of a tail, four legs of three,
 * in the build frame. The person's pelvis hangs from the withers; `spec.ix` has the horse's bones by name.
 */
export function addCentaurBones(spec, F) {
  const { Lay, tx } = F;
  const s = (p) => [p[0] - tx, p[1], p[2]];
  spec.names = BONE_NAMES.slice(0, spec.pos.length);
  spec.ix = { root: B.root };
  const list = [['hips', 'root', s(Lay.hips)], ['back', 'hips', s(Lay.spine)], ['withers', 'back', s(Lay.chest)]];
  Lay.tails[0].slice(0, 4).forEach((p, i) => list.push([`tail${i + 1}`, i ? `tail${i}` : 'hips', s(p)]));
  for (const [key, pts] of Object.entries(Lay.legs)) {
    list.push([`${key}u`, key[0] === 'F' ? 'withers' : 'hips', s(pts[0])], [`${key}l`, `${key}u`, s(pts[1])], [`${key}p`, `${key}l`, s(pts[2])]);
  }
  addBones(spec, list);
  spec.parent[B.pelvis] = spec.ix.withers;
  spec.fit = true;
  spec.centaur = { tx };
  return spec;
}

/**
 * A bone of its own at a hand's palm (`offset` from the hand bone's origin, the wrist), for a held piece that the pose keeps upright
 * whatever the arm does (the Dullahan's head, rich-centaur-anim.js); returns its index. The skin never uses it.
 */
export function addPalmBone(spec, hand, offset, name) {
  const p = spec.pos[hand];
  addBones(spec, [[name, hand, [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]]]]);
  return spec.ix[name];
}

/**
 * The horse: barrel, legs with hooves, tail, the team's saddle cloth (the layers' `legs` calls it where a person's legs would go).
 * o: { coat, back (the ridge of the back, the second tone), belly, dark (the lower legs), hoof, hair (the tail), tip, tailKind, cloth }.
 */
export function addHorse(E, o = {}) {
  const { kit, spec, pal } = E;
  const { Q, Lay, tx } = E.horse;
  const ix = spec.ix;
  const { L, H, W, leg, legR } = Q;
  const cy = Lay.cy;
  const sh = (p) => [p[0] - tx, p[1], p[2]];
  const coat = o.coat ?? pal.skin;
  const backC = o.back ?? pal.back;
  const belly = o.belly ?? pal.belly;
  const dark = o.dark ?? shadeC(coat, 0.62);
  const hair = o.hair ?? pal.back;
  // (the belly's lighter tone stops short of the chest, whose front would show it as a bare patch under the person)
  const furPaint = (c, x, y, z, u, a, bellyEnd = 1) => {
    const k = Math.cos(a * 2 * PI);
    tint(c, backC, 0.7 * smoothstep(0.1, 0.9, k));
    tint(c, belly, 0.8 * smoothstep(0.2, 0.95, -k) * bellyEnd);
    furStreaks(c, x, y, z);
  };

  // the barrel, from the rump to the chest
  const bodyBones = bonesOf(spec, ['hips', 'back', 'withers']);
  const bodyPts = pathOf(spec, ['hips', 'back', 'withers']);
  bodyPts.push([L * 0.42 - tx, cy + H * 0.1, 0]);
  const bodyBind = alongPath(bodyBones, bodyPts, [0.06, 0.07].map((x) => x * Math.max(1, L / 0.64)));
  const keys = Q.body.map(([f, yo, ry, rz]) => [L * f - tx, cy + H * yo, 0, H * ry, W * rz]);
  kit.loft(pathStations(keys, 17), {
    ref: [0, 1, 0], sides: 18, start: 'round', end: 'round', capRings: 3, capDepth: [L * 0.1, L * 0.05], color: coat, bind: bodyBind,
    paint: (c, x, y, z, u, a) => furPaint(c, x, y, z, u, a, 1 - smoothstep(0.62, 0.86, u)),
  });

  // legs
  const horn = o.hoof ?? shadeC(coat, 0.35);
  for (const key of Object.keys(Lay.legs)) {
    const front = key[0] === 'F';
    const pts = Lay.legs[key].map(sh);
    const bones = [ix[`${key}u`], ix[`${key}l`], ix[`${key}p`]];
    const legBind = alongPath(bones, pts, [0.03, 0.022]);
    const top = pts[0][1];
    const bind = mixBind(legBind, bodyBind, (x, y) => smoothstep(top - 0.01, top + H * 0.2, y));
    const r = legR;
    const path = [[pts[0][0] + (front ? 0.01 : 0.0), pts[0][1] + H * 0.3, pts[0][2] * 0.85], ...pts.slice(0, 3), [pts[3][0], r * 1.5, pts[3][2]]];
    const st = front
      ? legStations(path, [[0, 1.5, 1.1], [1, 1.8, 1.25], [1.5, 1.5, 1.1], [2, 1.12, 0.92], [2.5, 0.86, 0.72], [3, 0.68, 0.6], [3.5, 0.62, 0.57], [4, 0.72, 0.64]], r)
      : legStations(path, [[0, 2.3, 1.1], [1, 2.9, 1.25], [1.5, 2.6, 1.25], [2, 1.65, 1.1], [2.5, 1.12, 0.9], [3, 0.82, 0.7], [3.5, 0.62, 0.56], [4, 0.7, 0.62]], r);
    kit.loft(st, {
      ref: [1, 0, 0], rings: 12, sides: 10, start: null, end: null, color: coat, bind,
      paint: (c, x, y, z, u, a) => {
        furPaint(c, x, y, z, u, 0.31);
        tint(c, dark, 0.45 * smoothstep(leg * 0.5, leg * 0.1, y));
      },
    });
    hoof(kit, { x: pts[3][0], z: pts[3][2], r: r * 0.78, h: r * 1.5, color: horn, bind: rigid(ix[`${key}p`]) });
  }

  // the tail
  const tpts = Lay.tails[0].map(sh);
  const tr = legR * 0.62;
  const prof = [1, 1, 0.95, 0.85, 0.65];
  const tailBind = alongPath(bonesOf(spec, [1, 2, 3, 4].map((i) => `tail${i}`)), tpts, 0.05);
  kit.loft(pathStations(tpts.map((p, i) => [p[0], p[1], p[2], tr * prof[i], tr * prof[i]]), 9), {
    ref: [0, 0, 1], sides: 10, start: 'round', end: 'round', capRings: 3, capDepth: [tr, tr * 1.6], color: coat, bind: tailBind,
    paint: (c, x, y, z, u) => {
      furStreaks(c, x, y, z);
      tint(c, hair, 0.8 * (1 - u * 0.4));
    },
  });
  hairTail(kit, { pts: tpts, n: o.tailStrands ?? 16, len: Q.tail * (o.tailLen ?? 0.95), w: 0.022, color: hair, tip: o.tip ?? shadeC(hair, 0.88), bind: tailBind, droop: 0.65, spread: 1.2 });

  // the team's saddle cloth over the horse's back, behind the person
  if (o.cloth !== false) saddle(kit, Q, cy, bodyBind, pal, -tx);
}

/** Move the finished model from the build frame to the horse's middle: the mesh and every bone by `tx` along the horse. */
export function settle(geo, spec, F) {
  geo.translate(F.tx, 0, 0);
  for (const p of spec.pos) p[0] += F.tx;
}
