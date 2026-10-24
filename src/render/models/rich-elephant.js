// The rich elephant (High and Ultra): Airavata, the white king of elephants, with the three heads of his legend and Indra on his back. A
// person's upper body, dressed as any person is (rich-humanoid.js, the outfit layers of the pantheon, rich-elephant-outfits.js), sits in a
// howdah on the back of an elephant: a barrel on four pillar legs with feet of five nails, a rope of a tail, a caparison in the team's color
// over its back, and three heads (rich-elephant-head.js) fanned out from the shoulders, each on a bone of its own with a trunk of five
// bones, two ears that flap and two tusks. One skinned mesh on the humanoid's bones (the legs' three bones a side stay at rest, unused) and
// the elephant's: a back of three bones, four of a tail, four legs of three, and for each head its own bone, five of its trunk and two of
// its ears. The person's pelvis is a child of the back's middle bone, so the body carries him as it walks and rears; the pose
// (rich-elephant-anim.js) keeps his chest steady above it.
//
// As the centaur's (rich-centaur.js) the model is built in a frame of its own, the person's pelvis at x = 0 (so every layer's lofts, which
// are made about the person's middle, are right as they are), and moved to the elephant's middle at the end (`settle`). The layout below
// is given in the elephant's own frame (x forward, the barrel's middle near the origin) and shifted by `sh` where it is built.
import { shadeC, mixC, TEAM } from './unit-geo.js';
import { ps, rigid, alongPath, mixBind, smoothstep, B, BONE_NAMES } from './rich-kit.js';
import { addBones, pathStations, frameMatrix, headToModel } from './rich-creature-kit.js';
import { legStations } from './rich-quadruped.js';
import { collar } from './rich-creature-parts.js';
import { hairTail } from './rich-creature-hair.js';
import { elephantHead, elephantMetrics, TRUNK_BONES } from './rich-elephant-head.js';
import { dye, mul, tint, hash, lerp } from './rich-paint.js';

const PI = Math.PI;
const TAU = PI * 2;

/** What an elephant may carry for this plan to dress it (anything else keeps the low-poly model). */
const ELEPHANT_EXTRAS = new Set(['jewelry', 'rider']);

/**
 * Which units this plan builds: an elephant with one head or three, its own headdress or none, a rider on its back (what he holds is his
 * outfit's, so the unit has no weapon of its own), and only extras it can show.
 */
export function elephantSupported(v) {
  if (v.body !== 'elephant') return false;
  if (!['elephant', 'none'].includes(v.head || 'elephant') || ![1, 3].includes(v.heads || 1)) return false;
  if (!['none', 'headdress'].includes(v.headgear || 'none')) return false;
  if ((v.weapon || 'none') !== 'none' || (v.offhand || 'none') !== 'none') return false;
  const ex = v.extras || [];
  return ex.includes('rider') && ex.every((e) => ELEPHANT_EXTRAS.has(e));
}

/** How far in front of the elephant's middle the person's pelvis is, and how high the seat is that he sits on. */
const TX = -0.04;
const SEAT = 0.955;

/** The barrel's stations in the elephant's frame: [x, centerHeight, 0, halfHeight, halfWidth, n], from the rump to the chest. */
const BARREL = [
  [-0.52, 0.64, 0, 0.1, 0.1, 2.2],
  [-0.46, 0.64, 0, 0.215, 0.2, 2.3],
  [-0.33, 0.625, 0, 0.275, 0.255, 2.4],
  [-0.12, 0.605, 0, 0.285, 0.27, 2.4],
  [0.08, 0.605, 0, 0.285, 0.275, 2.4],
  [0.26, 0.6, 0, 0.285, 0.295, 2.4],
  [0.38, 0.59, 0, 0.265, 0.3, 2.4],
  [0.46, 0.58, 0, 0.19, 0.24, 2.3],
];
const BARREL_ST = pathStations(BARREL, 41);

/** The barrel's center height, half height and half width at x (straight between the stations). */
function barrelAt(x) {
  const s = BARREL_ST;
  let i = 0;
  while (i < s.length - 2 && x > s[i + 1].c[0]) i++;
  const t = Math.min(1, Math.max(0, (x - s[i].c[0]) / (s[i + 1].c[0] - s[i].c[0] || 1)));
  const l = (a, b) => a + (b - a) * t;
  return { y: l(s[i].c[1], s[i + 1].c[1]), ry: l(s[i].rx, s[i + 1].rx), rz: l(s[i].rz, s[i + 1].rz), n: l(s[i].n, s[i + 1].n) };
}

/** The joints of the back: the hips, the middle (the person's seat hangs from it), the withers. */
const JOINTS = { hips: [-0.3, 0.74, 0], back: [-0.02, 0.78, 0], withers: [0.26, 0.77, 0] };

/** The tail: its joints from the rump to the tuft. */
const TAIL = [[-0.5, 0.72, 0], [-0.555, 0.6, 0], [-0.585, 0.45, 0], [-0.59, 0.31, 0], [-0.585, 0.2, 0]];

/** The legs, the right side's (the left mirrors it): the hip or shoulder, the knee, the ankle and the toe of each. */
const LEGS = {
  F: [[0.25, 0.6, 0.165], [0.245, 0.31, 0.165], [0.255, 0.115, 0.16], [0.265, 0, 0.16]],
  B: [[-0.3, 0.6, 0.17], [-0.275, 0.31, 0.17], [-0.3, 0.115, 0.165], [-0.31, 0, 0.165]],
};
const mirror = (p, side) => [p[0], p[1], p[2] * side];
const legPts = (key) => LEGS[key[0]].map((p) => mirror(p, Number(key.slice(1))));
/** The legs by name (front or back, then 1 for the right side and -1 for the left). */
export const ELEPHANT_LEGS = ['F1', 'F-1', 'B1', 'B-1'];

/** The heads, in the elephant's frame: where each skull's base is, how it is turned out, how big it is (the middle one the largest). */
export const HEADS = [
  { key: 'h0', side: 0, at: [0.3, 0.76, 0], yaw: 0, len: 0.36 },
  { key: 'h1', side: 1, at: [0.215, 0.735, 0.31], yaw: -0.5, len: 0.31 },
  { key: 'h2', side: -1, at: [0.215, 0.735, -0.31], yaw: 0.5, len: 0.31 },
];
const HEAD_PITCH = -0.06;

/** The heads of a unit: the middle one only if it has one head, else all three. */
export const headsOf = (v) => ((v.heads || 1) >= 3 ? HEADS : HEADS.slice(0, 1));

/**
 * The dressing context of the person on the elephant's back: the unit's own, with the head, the headgear and the weapon of the person
 * (the outfit's `rider`: the unit's own head, headgear and heads are the elephant's) and the extras he can wear.
 */
export function riderContext(ctx, rider = {}) {
  const extras = ctx.v.extras.filter((e) => e !== 'rider');
  return { ...ctx, v: { ...ctx.v, ...rider, heads: 1, extras }, ex: new Set(extras) };
}

/**
 * Where the person sits on the elephant: `tx` how far in front of the elephant's middle his pelvis is, `lift` how far he is raised to sit
 * on the cushion of the howdah (his hip at the level of its top).
 */
export function elephantFrame(D, v) {
  return { tx: TX, lift: SEAT - D.hipY, heads: headsOf(v) };
}

/** The positions of a head's bones, in the elephant's frame: the head, the trunk's five, the ears' two. */
function headBones(h) {
  const M = frameMatrix(h.at, HEAD_PITCH, h.yaw, h.len);
  const m = elephantMetrics(h.len);
  const W = (p) => headToModel(frameMatrix([0, 0, 0], HEAD_PITCH, h.yaw, 1), p).map((c, i) => c + h.at[i]);
  const trunk = m.trunk.slice(1, 1 + TRUNK_BONES).map(W);
  return { M, head: h.at, trunk, ear: { 1: W(m.ear(1)), '-1': W(m.ear(-1)) } };
}

/**
 * The elephant's bones on a humanoid spec (rich-kit.js humanoidSpec): the back's three, four of the tail, three of each leg, and for each head
 * its own, five of the trunk and two of the ears, in the build frame. The person's pelvis hangs from the back's middle bone; `spec.ix` has the
 * bones by name.
 */
export function addElephantBones(spec, F) {
  const s = (p) => [p[0] - F.tx, p[1], p[2]];
  spec.names = BONE_NAMES.slice(0, spec.pos.length);
  spec.ix = { root: B.root };
  const list = [['hips', 'root', s(JOINTS.hips)], ['back', 'hips', s(JOINTS.back)], ['withers', 'back', s(JOINTS.withers)]];
  TAIL.slice(0, 4).forEach((p, i) => list.push([`tail${i + 1}`, i ? `tail${i}` : 'hips', s(p)]));
  for (const key of ELEPHANT_LEGS) {
    const pts = legPts(key).map(s);
    list.push([`${key}u`, key[0] === 'F' ? 'withers' : 'hips', pts[0]], [`${key}l`, `${key}u`, pts[1]], [`${key}p`, `${key}l`, pts[2]]);
  }
  for (const h of F.heads) {
    const b = headBones(h);
    list.push([h.key, 'withers', s(b.head)]);
    b.trunk.forEach((p, i) => list.push([`${h.key}t${i + 1}`, i ? `${h.key}t${i}` : h.key, s(p)]));
    list.push([`${h.key}eR`, h.key, s(b.ear[1])], [`${h.key}eL`, h.key, s(b.ear[-1])]);
  }
  addBones(spec, list);
  spec.parent[B.pelvis] = spec.ix.back;
  spec.fit = true;
  spec.elephant = { tx: F.tx, heads: F.heads.map((h) => h.key) };
  return spec;
}

/** A nail on the front of a foot: a small blunt horn on the ground, pointing out from the foot's middle along `ang`. */
function nail(kit, x, z, r, ang, color, bind) {
  const d = [Math.cos(ang), Math.sin(ang)];
  const c = [x + d[0] * r * 1.28, z + d[1] * r * 1.2];
  kit.loft([ps(c[0] - d[0] * 0.006, 0.026, c[1] - d[1] * 0.006, 0.012, 0.017), ps(c[0] + d[0] * 0.012, 0.018, c[1] + d[1] * 0.012, 0.01, 0.015)], {
    ref: [0, 1, 0], rings: 2, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.008, color, mat: 'bone', bind,
  });
}

/** A tassel of gold: a cord, a bulb and a short fringe, hanging from `at`. */
function tassel(kit, at, r, len, color, bind) {
  kit.loft([ps(at[0], at[1], at[2], r * 0.3), ps(at[0], at[1] - len * 0.3, at[2], r), ps(at[0], at[1] - len * 0.62, at[2], r * 0.62), ps(at[0], at[1] - len, at[2], r * 0.22)], {
    ref: [1, 0, 0], rings: 4, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: r * 0.5, color, mat: 'gold', bind,
  });
}

/**
 * The elephant: barrel, four legs with feet and nails, the tail, the three heads, the team's caparison and the howdah (the layers' `legs`
 * calls it where a person's legs would go). o: { hide (the skin), gold, ivory, plume ({ gold, red } of the middle head's), cloth (the color of the caparison and the
 * cloths on the heads), trim (the border of both), lacquer (the howdah) }.
 */
export function addElephant(E, o = {}) {
  const { kit, spec, pal } = E;
  const F = E.elephant;
  const tx = F.tx;
  const ix = spec.ix;
  const sh = (p) => [p[0] - tx, p[1], p[2]];
  const hide = o.hide ?? pal.skin;
  const dark = shadeC(hide, 0.7);
  const pinkish = mixC(hide, '#e8b4a8', 0.4);
  const gold = o.gold ?? pal.accentMetal;
  const ivory = o.ivory ?? pal.white;
  const cloth = o.cloth ?? TEAM(1, 'cloth');
  const trim = o.trim ?? gold;
  const lacquer = o.lacquer ?? pal.primary;

  // the skin: faint mottling over the whole, creases across the limbs, the back a shade darker and the feet a shade dirtier
  const skin = (c, x, y, z, u, a) => {
    mul(c, 0.94 + 0.08 * hash(Math.round(x * 17), Math.round(y * 17), Math.round(z * 17)));
    mul(c, 1 - 0.05 * smoothstep(0.7, 1, Math.sin(y * 105 + Math.sin(x * 33 + z * 29) * 1.3)));
    tint(c, dark, 0.22 * smoothstep(0.35, 0.05, y));
  };

  // the barrel, from the rump to the chest
  const bodyBones = [ix.hips, ix.back, ix.withers];
  const bodyPts = [JOINTS.hips, JOINTS.back, JOINTS.withers, [0.45, 0.62, 0]].map(sh);
  const bodyBind = alongPath(bodyBones, bodyPts, [0.07, 0.07]);
  kit.loft(pathStations(BARREL.map((k) => [k[0] - tx, ...k.slice(1)]), 17), {
    ref: [0, 1, 0], sides: 18, start: 'round', end: 'round', capRings: 3, capDepth: [0.1, 0.06], color: hide, bind: bodyBind,
    paint: (c, x, y, z, u, a) => {
      skin(c, x, y, z, u, a);
      // the back a shade darker, the belly a shade paler
      const top = Math.cos(a * TAU);
      tint(c, dark, 0.16 * smoothstep(0.2, 1, top));
      tint(c, pinkish, 0.28 * smoothstep(0.35, 1, -top));
    },
  });

  // legs: pillars, thick at the top, creased at the knee and the ankle, a flat foot with its nails and a ring of gold
  for (const key of ELEPHANT_LEGS) {
    const front = key[0] === 'F';
    const pts = legPts(key).map(sh);
    const bones = [ix[`${key}u`], ix[`${key}l`], ix[`${key}p`]];
    const legBind = alongPath(bones, pts, [0.05, 0.04]);
    const top = pts[0][1];
    const bind = mixBind(legBind, bodyBind, (x, y) => smoothstep(top - 0.02, top + 0.1, y));
    const r = 0.078;
    const fx = pts[3][0];
    const fz = pts[3][2];
    // (the foot is the end of the leg's loft: it flares to the ground, so no seam shows between them)
    const path = [[pts[0][0], top + 0.1, pts[0][2] * 0.85], ...pts.slice(0, 3), [fx + 0.004, r * 0.85, fz], [fx + 0.01, 0, fz]];
    const st = front
      ? legStations(path, [[0, 1.55, 1.45], [1, 1.65, 1.5], [1.5, 1.38, 1.32], [2, 1.12, 1.1], [2.5, 1.0, 1.0], [3, 0.98, 0.98], [3.4, 1.15, 1.12], [4, 1.3, 1.24], [5, 1.36, 1.28]], r)
      : legStations(path, [[0, 1.9, 1.5], [1, 2.2, 1.55], [1.5, 1.7, 1.4], [2, 1.2, 1.15], [2.5, 1.0, 1.0], [3, 0.96, 0.96], [3.4, 1.12, 1.1], [4, 1.3, 1.24], [5, 1.36, 1.28]], r);
    kit.loft(st, {
      ref: [1, 0, 0], rings: 12, sides: 10, start: null, end: 'flat', color: hide, bind,
      paint: (c, x, y, z, u, a) => {
        skin(c, x, y, z, u, a);
        // the creases at the knee and the ankle, the foot a shade dirtier
        mul(c, 1 - 0.1 * smoothstep(0.55, 1, Math.sin(y * 150 + 1.2)) * smoothstep(0.13, 0.4, y));
        tint(c, dark, 0.25 * smoothstep(0.13, 0.04, y));
      },
    });
    // (the nails: four on a front foot, three on a hind one, along the front half of the rim)
    const nails = front ? 4 : 3;
    const foot = rigid(ix[`${key}p`]);
    for (let i = 0; i < nails; i++) nail(kit, fx + 0.01, fz, r, ((i / (nails - 1)) - 0.5) * 1.3 * (key.endsWith('-1') ? -1 : 1), shadeC(pal.bone, 0.95), foot);
    // (two bands of gold above the ankle, centered on the leg where they sit)
    for (const y of [0.2, 0.235]) {
      const k = (pts[1][1] - y) / (pts[1][1] - pts[2][1]);
      collar(kit, { at: [lerp(pts[1][0], pts[2][0], k), y, lerp(pts[1][2], pts[2][2], k)], dir: [0, 1, 0], rx: r * 1.17, rz: r * 1.15, h: 0.022, color: gold, mat: 'gold', bind: legBind });
    }
  }

  // the tail: a rope with a brush of hair at the end
  const tpts = TAIL.map(sh);
  const tr = 0.02;
  const tailBind = alongPath([1, 2, 3, 4].map((i) => ix[`tail${i}`]), tpts, 0.05);
  kit.loft(pathStations(tpts.map((p, i) => [p[0], p[1], p[2], tr * [1.25, 1, 0.9, 0.8, 0.7][i], tr * [1.25, 1, 0.9, 0.8, 0.7][i]]), 9), {
    ref: [0, 0, 1], sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: [tr, tr], color: hide, bind: tailBind,
    paint: (c, x, y, z, u) => {
      skin(c, x, y, z, u, 0);
      tint(c, dark, 0.35 * u);
    },
  });
  hairTail(kit, { pts: tpts.slice(-2), n: 9, len: 0.17, w: 0.02, color: shadeC(hide, 0.45), tip: shadeC(hide, 0.34), bind: tailBind, droop: 0.4, spread: 0.55 });

  // the heads, each on its own bone
  for (const h of F.heads) {
    const b = headBones(h);
    const middle = h.side === 0;
    elephantHead(kit, {
      at: sh(b.head), pitch: HEAD_PITCH, yaw: h.yaw, len: h.len, lean: !middle, inner: h.side,
      bind: { head: rigid(ix[h.key]), trunk: [1, 2, 3, 4, 5].map((i) => ix[`${h.key}t${i}`]), ear: { 1: ix[`${h.key}eR`], '-1': ix[`${h.key}eL`] }, body: bodyBind },
      hide, ivory, gold, cloth, trim, paint: skin, plume: middle ? (o.plume ?? null) : null,
    });
  }

  // the caparison: a cloth in the team's color over the back and down the flanks, a border and a band of gold, tassels along the hem
  const x0 = -0.31;
  const x1 = 0.21;
  const A = 1.78;
  kit.sheet(7, 14, (u, v, out) => {
    const x = x0 + u * (x1 - x0);
    const b = barrelAt(x);
    const a = (0.5 - v) * 2 * A;
    const e = 2 / b.n;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const hang = 1 + 0.05 * (Math.abs(a) / A) ** 2;
    out[0] = x - tx;
    out[1] = b.y + (b.ry + 0.013) * Math.sign(ca) * Math.abs(ca) ** e * hang;
    out[2] = (b.rz + 0.013) * Math.sign(sa) * Math.abs(sa) ** e * hang;
  }, {
    thick: 0.007, color: cloth, inner: shadeC(pal.secondary, 0.8), bind: bodyBind,
    paint: (c, x, y, z, u, v) => {
      const edge = Math.abs(v - 0.5) * 2;
      // gold along the hem, a thin line above it, the ends of the cloth bordered
      if (edge > 0.93 || (edge > 0.82 && edge < 0.855) || u < 0.045 || u > 0.955) dye(c, trim, 0.9);
    },
  });
  for (const side of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const x = lerp(x0 + 0.06, x1 - 0.06, i / 2);
      const b = barrelAt(x);
      const e = 2 / b.n;
      const ca = Math.cos(A);
      const sa = Math.sin(A);
      tassel(kit, [x - tx, b.y + (b.ry + 0.016) * Math.sign(ca) * Math.abs(ca) ** e * 1.05, side * (b.rz + 0.016) * Math.abs(sa) ** e * 1.05], 0.014, 0.07, gold, bodyBind);
    }
  }

  // the howdah: a platform of lacquer rimmed in gold, a cushion in the team's color, a rail on four posts
  const hx = (x) => x - tx;
  const seatX = [-0.21, -0.08, 0.06, 0.13];
  const back = rigid(ix.back);
  kit.loft(seatX.map((x) => ps(hx(x), 0.9, 0, 0.02, 0.152, 4.5)), {
    ref: [0, 1, 0], rings: 4, sides: 14, start: 'round', end: 'round', capRings: 2, capDepth: 0.03, color: lacquer, mat: 'lacquer', bind: back,
    paint: (c, x, y, z) => {
      // a gold rim round the platform
      if (y < 0.905 && (Math.abs(z) > 0.14 || x < hx(-0.2) || x > hx(0.12))) dye(c, trim, 0.85);
    },
  });
  kit.loft([-0.17, -0.06, 0.07].map((x) => ps(hx(x), 0.936, 0, 0.02, 0.125, 3)), {
    ref: [0, 1, 0], rings: 3, sides: 12, start: 'round', end: 'round', capRings: 2, capDepth: 0.03, color: TEAM(0.95, 'cloth'), bind: back,
  });
  // (the rail: a rounded rectangle in the horizontal plane, closed on itself)
  const rail = [];
  const rl = 0.17;
  const rw = 0.152;
  const rr = 0.06;
  const corners = [[rl - rr, rw - rr, 0], [-rl + rr, rw - rr, 1], [-rl + rr, -rw + rr, 2], [rl - rr, -rw + rr, 3]];
  for (const [cx, cz, k] of corners) {
    for (let i = 0; i <= 4; i++) {
      const ang = (k * 0.5 + i / 8) * PI;
      rail.push(ps(hx(-0.04 + cx + Math.cos(ang) * rr), 1.0, cz + Math.sin(ang) * rr, 0.012, 0.012));
    }
  }
  rail.push(rail[0]);
  kit.loft(rail, { ref: [0, 1, 0], sides: 5, start: null, end: null, color: gold, mat: 'gold', bind: back });
  for (const [cx, cz] of [[rl, rw], [-rl, rw], [-rl, -rw], [rl, -rw]]) {
    const px = hx(-0.04 + cx * 0.93);
    const pz = cz * 0.93;
    kit.loft([ps(px, 0.915, pz, 0.014, 0.014), ps(px, 0.96, pz, 0.011, 0.011), ps(px, 1.0, pz, 0.014, 0.014)], {
      ref: [1, 0, 0], rings: 2, sides: 5, start: 'round', end: 'round', capRings: 1, capDepth: 0.012, color: gold, mat: 'gold', bind: back,
    });
  }
  return E;
}
