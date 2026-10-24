// The rich scorpion man (High and Ultra): a person's upper body, dressed as any person is (rich-humanoid.js, the outfit layers of the
// pantheon, rich-scorpion-outfits.js), rising from the carapace of a scorpion: a shield of chitin over eight legs, an abdomen in seven
// overlapping plates, a tail of five joints that curls over the back to a bulb and a hooked sting, and a pair of small pincers at the
// front. One skinned mesh on the humanoid's bones (the legs' three bones a side stay at rest, unused) and the scorpion's. The person's
// pelvis is a child of the carapace's bone, so the body carries him as it walks and rears; the pose (rich-insect-anim.js applyScorpion)
// keeps his chest steady above it.
//
// As the centaur's (rich-centaur.js) the model is built in a frame of its own, the person's pelvis at x = 0 (so every layer's lofts,
// which are made about the person's middle, are right as they are), and moved to the scorpion's middle at the end (`settle`). The
// layout below is given in the scorpion's own frame (x forward, the carapace's middle near the origin) and shifted by `sh` where it is built.
import { shadeC, mixC, withMat, TEAM } from './unit-geo.js';
import { ps, rigid, alongPath, smoothstep, B, BONE_NAMES } from './rich-kit.js';
import { addBones, pathStations } from './rich-creature-kit.js';
import { spike } from './rich-creature-parts.js';
import { insectLeg } from './rich-insect.js';
import { dye, hash, mul, tint } from './rich-paint.js';

const TAU = Math.PI * 2;

/** What a scorpion man may wear for this plan to dress him (anything else keeps the low-poly model). */
const SCORPION_EXTRAS = new Set(['beard', 'long_hair', 'cape', 'armor', 'eye_glow', 'tail']);

/** Which units this plan builds: an insect with a human head, no headgear, and only extras it can show. */
export function scorpionSupported(v) {
  if (v.body !== 'insect') return false;
  if ((v.head || 'none') !== 'human' || (v.heads || 1) !== 1) return false;
  if ((v.headgear || 'none') !== 'none') return false;
  return (v.extras || []).every((e) => SCORPION_EXTRAS.has(e));
}

/** How far in front of the scorpion's middle the person's pelvis is, and how high the carapace is under it. */
const TX = 0.16;
const TOP = 0.215;

/** The joints of the scorpion's body, in its frame: the carapace, the two bones of the abdomen. */
const JOINTS = { body: [0.1, 0.15, 0], meso1: [-0.08, 0.17, 0], meso2: [-0.24, 0.18, 0] };

/** The tail: its joints from the end of the abdomen, over the back, to the end of its fifth segment; the bulb and the sting follow. */
const TAIL = [[-0.4, 0.19, 0], [-0.49, 0.265, 0], [-0.535, 0.385, 0], [-0.52, 0.51, 0], [-0.44, 0.615, 0], [-0.335, 0.675, 0]];
const BULB = [-0.245, 0.69, 0];

/** The legs, the right side's (the left mirrors it), in pairs from the front: the hip, the knee, the ankle and the toe, and the thigh's radius. */
const LEGS = {
  a: { pts: [[0.2, 0.13, 0.12], [0.31, 0.225, 0.26], [0.405, 0.075, 0.355], [0.425, 0.006, 0.375]], r: 0.025 },
  b: { pts: [[0.12, 0.13, 0.13], [0.17, 0.235, 0.285], [0.225, 0.08, 0.4], [0.235, 0.006, 0.42]], r: 0.025 },
  c: { pts: [[0.03, 0.13, 0.14], [-0.01, 0.24, 0.3], [-0.045, 0.08, 0.41], [-0.05, 0.006, 0.43]], r: 0.024 },
  d: { pts: [[-0.07, 0.135, 0.15], [-0.17, 0.23, 0.29], [-0.28, 0.08, 0.385], [-0.3, 0.006, 0.405]], r: 0.023 },
};
/** The legs by name (the pair, then 1 for the right side and -1 for the left), from the front: a1, a-1, b1, b-1 ... */
export const SCORPION_LEGS = Object.keys(LEGS).flatMap((k) => [1, -1].map((side) => `${k}${side}`));

/** The pincers, the right side's: the joint at the carapace, the elbow and the hand. */
const PALP = { base: [0.27, 0.12, 0.1], elbow: [0.365, 0.135, 0.22], hand: [0.43, 0.125, 0.2] };

const mirror = (p, side) => [p[0], p[1], p[2] * side];
const legPts = (key) => LEGS[key[0]].pts.map((p) => mirror(p, Number(key.slice(1))));

/**
 * Where the person stands on the scorpion: `tx` how far in front of the scorpion's middle his pelvis is, `lift` how far he is raised
 * to stand on the carapace (his waist at the level of its top).
 */
export function scorpionFrame(D) {
  return { tx: TX, lift: TOP - D.hipY };
}

/**
 * The scorpion's bones on a humanoid spec (rich-kit.js humanoidSpec): the carapace's, two of the abdomen, five of the tail, two of each
 * pincer, three of each leg, in the build frame. The person's pelvis hangs from the carapace's bone; `spec.ix` has the bones by name.
 */
export function addScorpionBones(spec, F) {
  const s = (p) => [p[0] - F.tx, p[1], p[2]];
  spec.names = BONE_NAMES.slice(0, spec.pos.length);
  spec.ix = { root: B.root };
  const list = [['body', 'root', s(JOINTS.body)], ['meso1', 'body', s(JOINTS.meso1)], ['meso2', 'meso1', s(JOINTS.meso2)]];
  TAIL.slice(0, 5).forEach((p, i) => list.push([`tail${i + 1}`, i ? `tail${i}` : 'meso2', s(p)]));
  for (const side of [1, -1]) {
    const k = side > 0 ? 'R' : 'L';
    list.push([`palp${k}1`, 'body', s(mirror(PALP.base, side))], [`palp${k}2`, `palp${k}1`, s(mirror(PALP.elbow, side))]);
  }
  for (const key of SCORPION_LEGS) {
    const pts = legPts(key).map(s);
    list.push([`${key}u`, 'body', pts[0]], [`${key}l`, `${key}u`, pts[1]], [`${key}p`, `${key}l`, pts[2]]);
  }
  addBones(spec, list);
  spec.parent[B.pelvis] = spec.ix.body;
  spec.fit = true;
  spec.scorpion = { tx: F.tx };
  return spec;
}

/** The abdomen's plates: seven, each a ramp up to a ledge, four rings to a plate. */
const PLATES = 7;
const PER = 4;
const RAMP = [0.02, 0.36, 0.68, 0.97];

/**
 * The scorpion: carapace, abdomen, tail with its sting, eight legs and two pincers (the layers' `legs` calls it where a person's legs
 * would go). o: { chitin (the shell), dark (the joints, the underside), light (a lighter shell for the plates' edges), trim (the legs'
 * rings: none when it is null), trimMat, sting (the tip of the sting), team (the color of the ridge down the back) }.
 */
export function addScorpion(E, o = {}) {
  const { kit, spec, pal } = E;
  const { tx } = E.scorpion;
  const ix = spec.ix;
  const sh = (p) => [p[0] - tx, p[1], p[2]];
  const chitin = o.chitin ?? mixC(pal.skin, pal.primary, 0.8);
  const dark = o.dark ?? shadeC(chitin, 0.55);
  const light = o.light ?? shadeC(chitin, 1.12);
  const team = o.team ?? TEAM(1, 'lacquer');
  const bonesOfBody = [ix.body, ix.meso1, ix.meso2];
  const bodyPts = [JOINTS.body, JOINTS.meso1, JOINTS.meso2, TAIL[0]].map(sh);

  // the carapace: a broad shield, rounded in front and behind, a groove down its middle
  const carapace = pathStations([
    [-0.115, 0.152, 0, 0.045, 0.1, 2.2],
    [-0.06, 0.153, 0, 0.058, 0.16, 2.3],
    [0.03, 0.155, 0, 0.066, 0.19, 2.4],
    [0.15, 0.155, 0, 0.064, 0.195, 2.4],
    [0.25, 0.15, 0, 0.055, 0.17, 2.3],
    [0.315, 0.138, 0, 0.04, 0.115, 2.2],
  ].map((k) => [k[0] - tx, ...k.slice(1)]), 14);
  kit.loft(carapace, {
    ref: [0, 1, 0], sides: 20, start: 'round', end: 'round', capRings: 3, capDepth: [0.04, 0.05], color: chitin, mat: 'bone',
    bind: alongPath([ix.body, ix.meso1], bodyPts.slice(0, 3), [0.045]),
    paint: (c, x, y, z, u, a) => {
      const top = Math.cos(a * TAU);
      mul(c, 0.6 + 0.4 * smoothstep(-0.5, 0.55, top));
      tint(c, light, 0.3 * smoothstep(0.5, 1, top));
      // the groove down the middle, the granules over the whole shell
      if (Math.abs(z) < 0.011 && top > 0.5) mul(c, 0.78);
      mul(c, 0.9 + 0.1 * hash(Math.round(x * 70), Math.round(y * 70), Math.round(z * 70)));
      // a thin rim of the trim's metal round the edge of the shield
      if (o.trim && (Math.abs(a - 0.25) < 0.02 || Math.abs(a - 0.75) < 0.02)) dye(c, o.trim, 0.8);
    },
  });

  // the abdomen: seven plates, each rising to a ledge that overlaps the next, narrowing to the tail
  const abdomen = [];
  const ridge = [];
  for (let p = 0; p < PLATES; p++) {
    for (let j = 0; j < PER; j++) {
      const f = RAMP[j];
      const t = (p + f) / PLATES;
      const k = 0.9 + 0.1 * smoothstep(0, 1, f);
      const x = -0.07 + (TAIL[0][0] + 0.07) * t;
      const y = 0.172 + 0.018 * t + 0.008 * Math.sin(Math.PI * t);
      const ry = (0.108 + (0.058 - 0.108) * t ** 0.9) * k;
      const rz = (0.19 + (0.072 - 0.19) * t ** 0.85) * k;
      abdomen.push(ps(x - tx, y, 0, ry, rz, 2.3));
      ridge.push([x - tx, y + ry + 0.003, 0, (0.8 + 0.2 * f) * k, t]);
    }
  }
  kit.loft(abdomen, {
    ref: [0, 1, 0], sides: 16, start: 'round', end: 'round', capRings: 3, capDepth: [0.03, 0.06], color: chitin, mat: 'bone',
    bind: alongPath(bonesOfBody, bodyPts, [0.05, 0.05]),
    paint: (c, x, y, z, u, a) => {
      const top = Math.cos(a * TAU);
      // a ramp from the groove to the ledge of each plate, the underside dark
      const f = (u * PLATES * PER - 0.5) / PER;
      const ramp = f - Math.floor(f);
      mul(c, (0.62 + 0.38 * smoothstep(-0.5, 0.5, top)) * (0.82 + 0.18 * smoothstep(0, 0.9, ramp)));
      tint(c, dark, 0.35 * (1 - smoothstep(-0.7, 0, top)));
      mul(c, 0.92 + 0.08 * hash(Math.round(x * 60), Math.round(y * 60), Math.round(z * 60)));
    },
  });
  // the team's ridge: a plate of its color on each of the seven, down the back
  kit.loft(ridge.slice(2, -1).map((p, i, a) => ps(p[0], p[1], 0, 0.012 * p[3], (0.052 - 0.03 * p[4]) * p[3] * Math.min(1, (i + 1) / 2, (a.length - i) / 2))), {
    ref: [0, 1, 0], sides: 6, start: 'round', end: 'round', capRings: 2, capDepth: 0.02, color: team, bind: alongPath(bonesOfBody, bodyPts, [0.05, 0.05]),
  });

  // the tail: five segments, each a barrel pinched at its joints, bent over the back to the bulb of the sting
  const tailBones = [1, 2, 3, 4, 5].map((i) => ix[`tail${i}`]);
  const tailPts = [...TAIL, BULB].map(sh);
  const tailSt = [];
  const segs = TAIL.length - 1;
  const spline = (pts, t) => {
    // a point along the polyline of joints, smoothed: the stations follow a Catmull-Rom through them
    const m = pts.length - 1;
    const fi = Math.min(m - 1e-6, t * m);
    const i = Math.floor(fi);
    const u = fi - i;
    const at = (n) => pts[Math.max(0, Math.min(m, n))];
    return [0, 1, 2].map((c) => 0.5 * (2 * at(i)[c] + (-at(i - 1)[c] + at(i + 1)[c]) * u + (2 * at(i - 1)[c] - 5 * at(i)[c] + 4 * at(i + 1)[c] - at(i + 2)[c]) * u * u + (-at(i - 1)[c] + 3 * at(i)[c] - 3 * at(i + 1)[c] + at(i + 2)[c]) * u * u * u));
  };
  const per = 5;
  for (let s = 0; s < segs; s++) {
    for (let j = 0; j < per; j++) {
      const f = j / per;
      const t = (s + f) / segs;
      const q = spline(TAIL, t);
      // a barrel: full in the middle of a segment, pinched at its joints, the segments narrowing toward the tip
      const bar = 0.84 + 0.2 * Math.sin(Math.PI * (f * 0.92 + 0.04)) ** 0.7;
      const r = (0.05 - 0.017 * t) * bar;
      tailSt.push(ps(q[0] - tx, q[1], q[2], r, r));
    }
  }
  const last = spline(TAIL, 1);
  tailSt.push(ps(last[0] - tx, last[1], last[2], 0.034, 0.034));
  const tailPaint = (c, x, y, z, u, a) => {
    // the segments in two tones, the joints dark, a keel of lighter chitin along the outer curve
    const f = u * segs - Math.floor(u * segs);
    const seg = Math.floor(u * segs);
    mul(c, 0.9 + 0.1 * (seg % 2));
    mul(c, 0.72 + 0.28 * smoothstep(0.04, 0.3, f) * (1 - smoothstep(0.86, 1, f)));
    tint(c, light, 0.25 * Math.max(0, Math.cos(a * TAU * 2)) ** 3);
  };
  kit.loft(tailSt, {
    ref: [0, 0, 1], sides: 10, start: 'round', end: null, capRings: 2, capDepth: 0.04, color: chitin, mat: 'bone',
    bind: alongPath(tailBones, tailPts, [0.028, 0.028, 0.028, 0.028]), paint: tailPaint,
  });
  // the telson: a bulb on the end of the tail and a hooked sting curving down and forward
  const bulb = sh(BULB);
  const tailEnd = sh(TAIL[5]);
  kit.loft([ps(tailEnd[0], tailEnd[1], tailEnd[2], 0.034, 0.034), ps((tailEnd[0] + bulb[0]) / 2, (tailEnd[1] + bulb[1]) / 2 + 0.004, 0, 0.048, 0.048), ps(bulb[0] + 0.03, bulb[1], 0, 0.042, 0.042)], {
    ref: [0, 0, 1], sides: 12, rings: 5, start: null, end: 'round', capRings: 3, capDepth: 0.03, color: shadeC(chitin, 0.9), mat: 'bone', bind: rigid(tailBones[4]),
  });
  spike(kit, {
    at: [bulb[0] + 0.035, bulb[1] - 0.004, 0], dir: [0.85, -0.2, 0], len: 0.1, r: 0.025, bend: [0.01, -0.075, 0], color: o.sting ?? withMat('#e6d8a8', 'gem'), mat: 'gem', bind: rigid(tailBones[4]), sides: 8,
    paint: (c, x, y, z, u) => {
      c.glow = 0.7 * smoothstep(0.35, 1, u);
    },
  });

  // the legs, jointed, a spur at the ankle and a claw at the toe
  for (const key of SCORPION_LEGS) {
    insectLeg(kit, {
      pts: legPts(key).map(sh), bones: [ix[`${key}u`], ix[`${key}l`], ix[`${key}p`]], r: LEGS[key[0]].r, color: shadeC(chitin, 0.85), spur: dark,
      spurMat: 'bone', rings: false, spurs: false, sides: 6, lite: true,
      paint: (c, x, y, z, u) => mul(c, 1.08 - 0.3 * u),
    });
  }

  // the pincers: an arm of two bones, a hand, a finger fixed to it and one that closes against it
  for (const side of [1, -1]) {
    const k = side > 0 ? 'R' : 'L';
    const b = sh(mirror(PALP.base, side));
    const e = sh(mirror(PALP.elbow, side));
    const h = sh(mirror(PALP.hand, side));
    const bones = [ix[`palp${k}1`], ix[`palp${k}2`]];
    kit.loft([ps(b[0], b[1], b[2], 0.034, 0.034), ps(e[0], e[1], e[2], 0.03, 0.03), ps(h[0] - 0.02, h[1], h[2], 0.032, 0.032)], {
      ref: [0, 1, 0], sides: 8, rings: 5, start: 'round', end: null, capRings: 2, capDepth: 0.03, color: shadeC(chitin, 0.95), mat: 'bone', bind: alongPath(bones, [b, e, h], [0.02]),
    });
    // (the hand's frame: forward and a little inward, `l` outward)
    const fl = Math.hypot(1, 0.4);
    const f = [1 / fl, 0, (-side * 0.4) / fl];
    const at = (df, dl, dy = 0) => [h[0] + f[0] * df + dl * 0, h[1] + dy, h[2] + f[2] * df + side * dl];
    kit.loft([ps(...at(-0.03, 0), 0.034, 0.038), ps(...at(0.025, 0), 0.044, 0.052), ps(...at(0.075, 0), 0.032, 0.036)], {
      ref: [0, 1, 0], sides: 10, rings: 5, start: 'round', end: 'round', capRings: 2, capDepth: 0.03, color: chitin, mat: 'bone', bind: rigid(bones[1]),
    });
    for (const [dl, bend] of [[-0.022, 0.014], [0.03, -0.036]]) {
      spike(kit, { at: at(0.07, dl), dir: f, len: 0.1, r: 0.022, bend: [0, 0, side * bend], color: dark, mat: 'bone', bind: rigid(bones[1]), sides: 6, ref: [0, 1, 0] });
    }
  }
  return E;
}
