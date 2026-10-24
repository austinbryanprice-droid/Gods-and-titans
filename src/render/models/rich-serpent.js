// The rich serpents, dragons and hydra (High and Ultra): one smooth skinned body on a skeleton of its own in place of the
// rigid low-poly parts and their wave morphs. A serpent or an eastern dragon is a spine of bones from a base (the chest or the
// neck's foot, bone s0) forward through a neck of three bones to the head and its jaw, and backward through seven bones to
// the tip of the tail, so the body can undulate down its length while the neck rises, sways and strikes; a dragon also has
// four short legs. A hydra is a mound with a tail, four stumpy legs and a neck of three bones to each of its heads. What a
// unit wears (spikes, flames, a mane, horns, antlers, a crown, a pearl, glowing eyes) comes from its visual. The pose keys of
// the low-poly rig (unit-anim.js: st, jaw, lunge, the wave phase) stay the source of truth: rich-creature-anim.js turns them
// into bone rotations.
import { shadeC, mixC, tintC, lumaC, withMat, TEAM } from './unit-geo.js';
import { MeshKit, ps, rigid, alongPath, mixBind, smoothstep } from './rich-kit.js';
import { creatureSpec, addBones, pathStations, bonesOf, ringPoint, frameMatrix, headToModel, intoBone } from './rich-creature-kit.js';
import { tint, mul, hash } from './rich-paint.js';
import { tuft, spike, paw } from './rich-creature-parts.js';
import { reptileHead, reptileMetrics, backTone } from './rich-reptile-heads.js';
import { finishGear } from './rich-gear.js';
import { tongue } from './rich-regalia.js';

const PI = Math.PI;
const TAU = PI * 2;

const SERPENT_EXTRAS = new Set(['eye_glow', 'spikes', 'flames']);
const DRAGON_EXTRAS = new Set(['eye_glow', 'spikes', 'mane', 'tail']);
const HYDRA_EXTRAS = new Set(['eye_glow', 'spikes', 'tail']);
const DRAGON_GEAR = new Set(['none', 'horns', 'antlers', 'crown']);

/** The necks a hydra of each class can afford: a neck and its head cost about 960 triangles on a body of 4,250 (visual.heads is already capped at nine). */
const HYDRA_NECKS = { titan: 9, creature: 6, minion: 4 };

/** Which units this plan builds: a serpent, a hydra or a wingless (eastern) dragon, bare or in the dress listed above. */
export function serpentSupported(v, unitType) {
  if (v.weapon !== 'none') return false;
  switch (v.body) {
    case 'serpent': return v.head === 'serpent' && v.headgear === 'none' && v.offhand === 'none' && v.heads === 1 && v.extras.every((e) => SERPENT_EXTRAS.has(e));
    case 'hydra': return v.head === 'serpent' && v.headgear === 'none' && v.offhand === 'none' && v.heads >= 2 && v.heads <= (HYDRA_NECKS[unitType?.class] ?? 4) && v.extras.every((e) => HYDRA_EXTRAS.has(e));
    case 'dragon': return v.head === 'dragon' && DRAGON_GEAR.has(v.headgear) && (v.offhand === 'none' || v.offhand === 'orb') && v.heads === 1 && v.extras.every((e) => DRAGON_EXTRAS.has(e));
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// layouts
// ---------------------------------------------------------------------------

/**
 * The spine from the head joint (key 0) to the tip of the tail (key 11): [x, y, z, radius]. Key 4 is the base, where
 * the bone s0 sits; the neck bones n1, n2, n3 sit on keys 3, 2, 1, the head on key 0, and the back bones b1 .. b7 on 5 .. 11.
 */
const SPINE = {
  serpent: [
    [0.36, 0.7, 0, 0.066], [0.23, 0.635, 0, 0.078], [0.14, 0.49, 0, 0.092], [0.09, 0.31, 0, 0.108], [0.03, 0.14, 0, 0.125], [-0.18, 0.115, 0.11, 0.13],
    [-0.42, 0.105, 0.19, 0.125], [-0.66, 0.095, 0.08, 0.11], [-0.84, 0.085, -0.11, 0.095], [-1.02, 0.07, -0.17, 0.075], [-1.2, 0.055, -0.06, 0.05], [-1.34, 0.04, 0.07, 0.02],
  ],
  dragon: [
    [0.54, 0.575, 0, 0.062], [0.42, 0.56, 0.02, 0.078], [0.28, 0.49, 0.05, 0.095], [0.12, 0.39, 0.07, 0.108], [-0.06, 0.31, 0.04, 0.112], [-0.26, 0.28, -0.03, 0.112],
    [-0.46, 0.265, -0.1, 0.1], [-0.66, 0.255, -0.13, 0.085], [-0.86, 0.255, -0.08, 0.068], [-1.04, 0.27, 0.02, 0.05], [-1.2, 0.3, 0.09, 0.034], [-1.32, 0.35, 0.11, 0.016],
  ],
};

/** The bones of the spine in order of the keys (key 0 first). */
const SPINE_BONES = ['head', 'n3', 'n2', 'n1', 's0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'];

/** The color of a glowing eye: the unit's own aura, lit, rather than the washed-out tint the humanoids' glow uses. */
const glowEye = (pal) => withMat(mixC(pal.glow, pal.eyeGlow, 0.3), 'gem');

/** The pale underside of a reptile: its skin lifted toward cream (the palette's belly mixes in the second tone, which muddies a blue or a gold skin). */
const underside = (skin) => mixC(tintC(skin, 0.5), '#efe6c8', 0.4);

const polyDist = (pts) => {
  const segs = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const d = [pts[i + 1][0] - a[0], pts[i + 1][1] - a[1], pts[i + 1][2] - a[2]];
    segs.push({ a, d, inv: 1 / (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1e-9) });
  }
  return (x, y, z) => {
    let best = Infinity;
    for (const g of segs) {
      const px = x - g.a[0];
      const py = y - g.a[1];
      const pz = z - g.a[2];
      const t = Math.max(0, Math.min(1, (px * g.d[0] + py * g.d[1] + pz * g.d[2]) * g.inv));
      const qx = px - g.d[0] * t;
      const qy = py - g.d[1] * t;
      const qz = pz - g.d[2] * t;
      best = Math.min(best, qx * qx + qy * qy + qz * qz);
    }
    return Math.sqrt(best);
  };
};

/** The spine's key points for a kind, the radii scaled for a titan (and a serpent's ground part kept resting on the ground). */
function spineKeys(kind, grand) {
  const k = grand ? 1.3 : 1;
  return SPINE[kind].map(([x, y, z, r], i) => {
    const rr = r * k;
    return [x, kind === 'serpent' && i >= 4 ? Math.max(y, rr * 0.92 + 0.004) : y, z, rr];
  });
}

// ---------------------------------------------------------------------------
// serpent and dragon
// ---------------------------------------------------------------------------

/** The body's middle height at x along a dragon's back (x runs one way down the stations): the hips of its legs hang from it. */
function heightAt(st, x) {
  for (let i = 0; i + 1 < st.length; i++) {
    const a = st[i];
    const b = st[i + 1];
    if ((a.c[0] - x) * (b.c[0] - x) <= 0) {
      const t = (x - a.c[0]) / (b.c[0] - a.c[0] || 1e-9);
      return { y: a.c[1] + (b.c[1] - a.c[1]) * t, z: a.c[2] + (b.c[2] - a.c[2]) * t, ry: a.rx + (b.rx - a.rx) * t, rz: a.rz + (b.rz - a.rz) * t };
    }
  }
  return { y: 0.3, z: 0, ry: 0.1, rz: 0.1 };
}

/** The four legs of a dragon: hip, knee and ankle of each in model space (front legs on the chest, hind legs on the hips). */
function dragonLegs(st, grand) {
  const s = grand ? 1.15 : 1;
  const out = {};
  for (const [key, x, dk, front] of [['F', 0.04, 0.05, true], ['B', -0.34, -0.06, false]]) {
    const b = heightAt(st, x);
    for (const side of [1, -1]) {
      const hip = [x, b.y - b.ry * 0.55, b.z + side * b.rz * 0.72];
      const zk = b.z + side * (b.rz * 0.72 + 0.045 * s);
      out[`${key}${side}`] = { front, side, hip, knee: [x + dk, (hip[1] + 0.045) * 0.5, zk], ankle: [x + dk * 0.7, 0.04, zk + side * 0.012] };
    }
  }
  return out;
}

function spineSpec(K, o) {
  const P = (i) => [K[i][0], K[i][1], K[i][2]];
  const list = [
    ['root', null, [0, 0, 0]], ['s0', 'root', P(4)], ['n1', 's0', P(3)], ['n2', 'n1', P(2)], ['n3', 'n2', P(1)], ['head', 'n3', P(0)], ['jaw', 'head', o.jaw],
  ];
  for (let i = 5; i < K.length; i++) list.push([`b${i - 4}`, i === 5 ? 's0' : `b${i - 5}`, P(i)]);
  const spec = creatureSpec(list);
  if (o.legs) {
    const more = [];
    for (const [key, L] of Object.entries(o.legs)) more.push([`${key}u`, L.front ? 's0' : 'b1', L.hip], [`${key}l`, `${key}u`, L.knee], [`${key}p`, `${key}l`, L.ankle]);
    addBones(spec, more);
  }
  return spec;
}

/** Scale diamonds over the body, the back toward the second tone (see backTone), the belly pale: u runs from the head to the tail. */
function scalesPaint(len, o) {
  const rows = Math.round(len * 12.5);
  const per = 9;
  const { k, lo, hi } = backTone(o.skin, o.back, o.backK);
  // a loft hands its paint the angle round the ring as a fraction (0 at the top), not radians
  return (out, x, y, z, u, a) => {
    const c = Math.cos(a * TAU);
    tint(out, o.back, k * smoothstep(lo, hi, c));
    tint(out, o.belly, 0.8 * smoothstep(0.45, 0.95, -c));
    const row = u * rows;
    const i = Math.floor(row);
    const f = row - i;
    const col = a * per + (i & 1) * 0.5;
    const cc = col - Math.floor(col);
    const dd = Math.abs(f - 0.5) + Math.abs(cc - 0.5);
    mul(out, 0.78 + 0.3 * smoothstep(0.62, 0.12, dd) + 0.05 * (hash(i, Math.floor(col), 3) - 0.5));
    if (o.mark) o.mark(out, x, y, z, u, a);
  };
}

/** A ring round the body over the stations i0 .. i1, `k` times as thick as the body there. */
function ring(kit, st, i0, i1, k, color, bind, opts = {}) {
  const sub = st.slice(Math.max(0, i0), Math.min(st.length, i1 + 1)).map((s) => ({ ...s, rx: s.rx * k, rz: s.rz * k }));
  kit.loft(sub, { ref: [0, 1, 0], sides: opts.sides ?? 18, start: null, end: null, color, mat: opts.mat, glow: opts.glow ?? 0, bind });
}

/** Spikes or locks of a mane along the back, from station `from` to `to` every `step`. */
function dorsal(kit, st, bind, o) {
  const n = st.length;
  for (let i = o.from; i <= Math.min(o.to, n - 1); i += o.step) {
    const s = st[i];
    const { p, n: up, t } = ringPoint(st, i, 0);
    const fade = 1 - 0.55 * Math.max(0, (i - n * 0.6) / (n * 0.4));
    const rv = s.rx;
    const sway = Math.sin(i * 1.3) * 0.5;
    if (o.mane) {
      const len = (0.12 + 2.9 * rv) * o.k * fade;
      tuft(kit, {
        at: [p[0] - up[0] * 0.01, p[1] - up[1] * 0.01, p[2] - up[2] * 0.01], dir: [up[0] * 0.65 + t[0] * 0.85, up[1] * 0.65 + t[1] * 0.85, up[2] * 0.65 + t[2] * 0.85 + sway * 0.1],
        len, w: 0.028 * o.k + 0.42 * rv * 0.3, th: 0.012, bend: [t[0] * len * 0.22, -len * 0.3, t[2] * len * 0.22 + sway * len * 0.1], across: [0, 0, 1],
        color: i % 2 ? o.color : shadeC(o.color, 0.78), bind, sides: 5, rings: 4, mat: 'fur',
      });
    } else {
      const len = (0.04 + 0.95 * rv) * o.k * fade;
      spike(kit, {
        at: [p[0] - up[0] * 0.012, p[1] - up[1] * 0.012, p[2] - up[2] * 0.012], dir: [up[0] + t[0] * 0.45, up[1] + t[1] * 0.45, up[2] + t[2] * 0.45], len,
        r: 0.02 * o.k + 0.05 * rv, bend: [t[0] * len * 0.2, -len * 0.05, t[2] * len * 0.2], color: o.color, mat: 'bone', bind, sides: 5, ref: t, flat: 0.5,
      });
    }
  }
}

/** One leg of a dragon: thigh, shin and a paw with claws, bound to its three bones. */
function dragonLeg(kit, spec, key, L, pal, skin, grand) {
  const k = grand ? 1.15 : 1;
  const ix = spec.ix;
  const lb = alongPath([ix[`${key}u`], ix[`${key}l`], ix[`${key}p`]], [L.hip, L.knee, L.ankle], [0.03, 0.03]);
  kit.loft([ps(L.hip[0], L.hip[1] + 0.02, L.hip[2], 0.052 * k, 0.05 * k), ps(L.knee[0], L.knee[1], L.knee[2], 0.036 * k, 0.034 * k), ps(L.ankle[0], L.ankle[1] + 0.012, L.ankle[2], 0.026 * k, 0.026 * k)],
    { ref: [0, 0, 1], rings: 6, sides: 8, start: 'round', end: 'round', capDepth: 0.02, color: skin, bind: lb });
  paw(kit, { x: L.ankle[0] - 0.012, z: L.ankle[2], r: 0.03 * k, color: shadeC(skin, 0.85), bind: rigid(ix[`${key}p`]), claw: pal.accent });
}

/** Tongues of flame along the back of a serpent, one rigid piece for each of the bones it rides (they flicker). */
function flamePieces(spec, ctx, st, K) {
  const { pal } = ctx;
  const groups = new Map();
  const N = st.length;
  for (let i = 3; i < N * 0.62; i += 3) {
    const f = (i / (N - 1)) * (K.length - 1);
    const bone = ['n2', 's0', 'b2', 'b4'][Math.max(0, Math.min(3, Math.floor((f - 1.2) / 1.9)))];
    if (!groups.has(bone)) groups.set(bone, []);
    groups.get(bone).push(i);
  }
  const out = [];
  for (const [bone, list] of groups) {
    const kit = new MeshKit(null, { sides: 6 });
    for (const i of list) {
      const { p, n, t } = ringPoint(st, i, 0);
      const rv = st[i].rx;
      const fade = 1 - 0.5 * Math.max(0, (i - N * 0.5) / (N * 0.5));
      for (const side of [-1, 1]) {
        const at = [p[0] - n[0] * 0.01, p[1] - n[1] * 0.01, p[2] + side * rv * 0.45];
        const d = [n[0] * 1 + t[0] * 0.5, n[1] * 1 + t[1] * 0.5, n[2] * 1 + t[2] * 0.5 + side * 0.28];
        const l = Math.hypot(...d);
        tongue(kit, pal, at, d.map((v) => v / l), (0.1 + 0.95 * rv) * fade, 0.02 + 0.1 * rv, { bend: 0.4, k: 0.33, sides: 5, n: 4, rings: 4, cap: 2 });
      }
    }
    const o = spec.pos[spec.ix[bone]];
    out.push({ name: `flames:${bone}`, bone: spec.ix[bone], geo: finishGear(kit, intoBone(o)), flicker: true });
  }
  return out;
}

/** The rich template of a serpent or an eastern dragon. */
function buildSpine(unitType, ctx, kind) {
  const { v, pal, ex, grand } = ctx;
  const dragon = kind === 'dragon';
  const K = spineKeys(kind, grand);
  const N = 64;
  const st = pathStations(K.map(([x, y, z, r]) => [x, y, z, r * 0.92, r]), N);
  const legs = dragon ? dragonLegs(st, grand) : null;
  const headLen = (dragon ? 0.4 : 0.34) * (grand ? 1.12 : 1);
  const headPitch = dragon ? -0.12 : -0.22;
  const headAt = [K[0][0], K[0][1], K[0][2]];
  const M0 = frameMatrix(headAt, headPitch, 0, 1);
  const jaw = headToModel(M0, reptileMetrics(dragon ? 'dragon' : 'serpent', headLen).jawAt);
  const spec = spineSpec(K, { jaw, legs });
  const ix = spec.ix;
  const kit = new MeshKit(spec, { sides: ctx.grand ? 16 : 12, rings: 1 });
  const skin = pal.skin;
  const belly = underside(skin);
  // a mane of a very dark second tone is lifted toward the skin, or it reads as black against the shadows
  const maneColor = lumaC(pal.primary) < 0.15 ? mixC(pal.primary, skin, 0.45) : pal.primary;
  // the spine's length, for the scale rows
  let len = 0;
  for (let i = 1; i < K.length; i++) len += Math.hypot(K[i][0] - K[i - 1][0], K[i][1] - K[i - 1][1], K[i][2] - K[i - 1][2]);

  // skin weights: two chains from the base (the neck and head forward, the back bones behind), each chosen by which polyline the vertex lies nearer
  const P = (i) => [K[i][0], K[i][1], K[i][2]];
  // each chain's line runs on a little past its last bone, so the end caps belong wholly to the head and to the tail's tip
  const beyond = (a, b, k) => [b[0] + (b[0] - a[0]) * k, b[1] + (b[1] - a[1]) * k, b[2] + (b[2] - a[2]) * k];
  const frontPts = [4, 3, 2, 1, 0].map(P);
  const backPts = [4, 5, 6, 7, 8, 9, 10, 11].map(P);
  const frontLine = [...frontPts, beyond(frontPts[3], frontPts[4], 1.5)];
  const backLine = [...backPts, beyond(backPts[6], backPts[7], 1.5)];
  const frontBind = alongPath(bonesOf(spec, ['s0', 'n1', 'n2', 'n3', 'head']), frontLine);
  const backBind = alongPath(bonesOf(spec, ['s0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7']), backLine);
  const dF = polyDist(frontPts);
  const dB = polyDist(backPts);
  const m = 0.05;
  // (mixBind: 0 is its first bind, 1 its second: a vertex nearer the neck's line than the tail's takes the neck chain)
  const bind = mixBind(backBind, frontBind, (x, y, z) => smoothstep(-m, m, dB(x, y, z) - dF(x, y, z)));

  // the body
  const back = pal.back;
  const mark = (out, x, y, z, u, a) => {
    if (kind === 'serpent' && !ex.has('flames') && !ex.has('spikes')) {
      // a plain snake: dark blotches down the back
      const w = Math.abs(((u * 14) % 1) - 0.5) * 2;
      const c = Math.cos(a * TAU);
      mul(out, 1 - 0.38 * smoothstep(0.55, 0.2, w) * smoothstep(0.3, 0.8, c));
    }
  };
  kit.loft(st, {
    ref: [0, 1, 0], sides: ctx.grand ? 20 : 16, start: 'round', end: 'round', capRings: 3, capDepth: [0.05, 0.03], color: skin, bind,
    paint: scalesPaint(len, { skin, back, belly, backK: dragon ? 0.5 : 0.4, mark }),
  });
  // the team's color in two bands, and on a titan glowing rings between them
  const at = (f) => Math.round(f * (N - 1));
  const bands = dragon ? [0.2, 0.58] : [0.34, 0.62];
  for (const f of bands) ring(kit, st, at(f) - 1, at(f) + 1, 1.07, TEAM(1), bind);
  if (grand) for (const f of dragon ? [0.4, 0.78] : [0.26, 0.5, 0.74]) ring(kit, st, at(f), at(f) + 1, 1.04, tintC(pal.glow, 0.2), bind, { mat: 'gem', glow: 0.9 });

  // the back: spikes, or the dragon's mane of long locks
  const k = grand ? 1.2 : 1;
  if (ex.has('mane')) dorsal(kit, st, bind, { from: 4, to: N - 6, step: 2, color: maneColor, mane: true, k: grand ? 1.1 : 1 });
  else if (ex.has('spikes') || grand) dorsal(kit, st, bind, { from: 5, to: N - 6, step: 4, color: mixC(pal.back, pal.horn, 0.35), k });
  if (ex.has('spikes') && ex.has('mane')) dorsal(kit, st, bind, { from: 7, to: N - 8, step: 6, color: pal.horn, k: k * 0.7 });

  // the head
  const headBind = rigid(ix.head);
  const jawBind = rigid(ix.jaw);
  const glow = ex.has('eye_glow') && !!pal.eyeGlow;
  reptileHead(kit, {
    kind: dragon ? 'dragon' : 'serpent', at: headAt, pitch: headPitch, len: headLen, bind: { head: headBind, jaw: jawBind },
    skin, belly, back: shadeC(pal.back, 1), glowEyes: glow, eyeColor: glow ? glowEye(pal) : withMat(dragon ? '#ffd040' : '#f0d040', 'gloss'), tongue: !dragon,
    gear: dragon ? v.headgear : 'none', horn: pal.horn, antler: withMat(mixC(pal.accent, pal.bone, 0.4), 'bone'), metal: pal.accentMetal, gem: pal.secondary,
    whisker: dragon ? pal.accent : null, mane: dragon && ex.has('mane') ? maneColor : null, fin: dragon ? pal.secondary : null,
  });
  if (dragon && v.offhand === 'orb') {
    // the pearl it chases, a little ahead of the jaws
    const c = [K[0][0] + headLen * 0.98 + 0.2, K[0][1] - headLen * 0.2, 0];
    const r = 0.065 * (grand ? 1.15 : 1);
    kit.loft([ps(c[0] - r * 0.1, c[1], c[2], r, r), ps(c[0] + r * 0.1, c[1], c[2], r, r)], { ref: [0, 1, 0], sides: 14, start: 'round', end: 'round', capRings: 5, capDepth: r, color: tintC(pal.glow, 0.3), mat: 'gem', glow: 1, bind: headBind });
  }

  // the tail's tip: a tuft of the mane's color, or a few spare blades of the skin's
  if (dragon && ex.has('tail')) {
    const tip = P(11);
    const tb = rigid(ix.b7);
    for (let i = 0; i < 5; i++) {
      const s = (i - 2) / 2;
      tuft(kit, {
        at: [tip[0] + 0.01, tip[1], tip[2] + s * 0.012], dir: [-0.8, 0.45 + 0.12 * Math.cos(s * 1.5), s * 0.45], len: 0.3 - 0.05 * Math.abs(s), w: 0.045, th: 0.012,
        bend: [-0.06, -0.14 - 0.04 * Math.abs(s), s * 0.06], across: [0, 0, 1], color: ex.has('mane') ? maneColor : pal.back, bind: tb, sides: 5, rings: 4, mat: 'fur',
      });
    }
  }

  // legs
  if (legs) for (const [key, L] of Object.entries(legs)) dragonLeg(kit, spec, key, L, pal, skin, grand);

  const geo = kit.build({ ground: 1 });
  const attach = ex.has('flames') ? flamePieces(spec, ctx, st, K) : [];
  const rig = { eastern: dragon, stride: 1, plan: 'serpent' };
  const triangles = geo.userData.triangles + attach.reduce((s, a) => s + (a.geo.userData.triangles ?? a.geo.attributes.position.count / 3), 0);
  return {
    kind, rich: { spec, geo, attach, dims: { shoulderY: 0.4, shoulderZ: 0.1 }, carryAt: P(4), plan: 'serpent', ix, eastern: dragon, legs: legs ? Object.keys(legs) : [] }, parts: [], rig, triangles, meshes: 1 + attach.length,
  };
}

// ---------------------------------------------------------------------------
// hydra
// ---------------------------------------------------------------------------

/** Where the necks of a hydra go: base, the top (the head joint) and the control point of the curve between them. */
function hydraNecks(n) {
  const out = [];
  const wide = n > 4;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const a = (t - 0.5) * (wide ? 2.5 : 1.7);
    const h = 0.64 + 0.2 * Math.cos(i * 2.3) + (wide ? 0.1 : 0);
    const reach = 0.4 + 0.12 * Math.sin(i * 1.7);
    const base = [0.17 + 0.04 * Math.cos(a), 0.38 - 0.05 * Math.abs(Math.sin(a)), Math.sin(a) * (wide ? 0.27 : 0.2)];
    const top = [base[0] + Math.cos(a) * reach, base[1] + h, base[2] + Math.sin(a) * reach * 0.95];
    const ctrl = [base[0] + (top[0] - base[0]) * 0.1, base[1] + h * 0.95, base[2] + (top[2] - base[2]) * 0.3];
    const at = (u) => [0, 1, 2].map((c) => (1 - u) * (1 - u) * base[c] + 2 * (1 - u) * u * ctrl[c] + u * u * top[c]);
    out.push({ a, base, top, pts: [base, at(0.34), at(0.67), top] });
  }
  return out;
}

function buildHydra(unitType, ctx) {
  const { v, pal, ex, grand } = ctx;
  const n = v.heads;
  const necks = hydraNecks(n);
  const nr = n > 5 ? 0.72 : n > 3 ? 0.88 : 1;
  const headLen = (n > 5 ? 0.21 : n > 3 ? 0.25 : 0.29) * (grand ? 1.05 : 1);
  const tailPts = [[-0.44, 0.24, 0], [-0.68, 0.17, 0.06], [-0.9, 0.11, -0.05], [-1.1, 0.07, 0.03], [-1.26, 0.05, 0.08]];
  const hips = { FR: [0.2, 0.18, 0.27], FL: [0.2, 0.18, -0.27], BR: [-0.3, 0.18, 0.25], BL: [-0.3, 0.18, -0.25] };
  const list = [['root', null, [0, 0, 0]], ['body', 'root', [0, 0.27, 0]]];
  tailPts.slice(0, 4).forEach((p, i) => list.push([`t${i + 1}`, i ? `t${i}` : 'body', p]));
  for (const [k, p] of Object.entries(hips)) list.push([`leg${k}`, 'body', p]);
  // each neck: base, two more joints and the head joint, then the jaw
  const heads = necks.map((nk, i) => {
    const M = frameMatrix(nk.top, -0.4, -nk.a * 0.6, 1);
    return { M, jaw: headToModel(M, reptileMetrics('serpent', headLen).jawAt) };
  });
  necks.forEach((nk, i) => {
    list.push([`h${i}a`, 'body', nk.pts[0]], [`h${i}b`, `h${i}a`, nk.pts[1]], [`h${i}c`, `h${i}b`, nk.pts[2]], [`h${i}h`, `h${i}c`, nk.pts[3]], [`h${i}j`, `h${i}h`, heads[i].jaw]);
  });
  const spec = creatureSpec(list);
  const ix = spec.ix;
  const kit = new MeshKit(spec, { sides: 12, rings: 1 });
  const skin = pal.skin;
  // moss-green necks over a belly of dull crimson (the unit's second tone)
  const neckSkin = mixC(tintC(skin, 0.1), '#4f8a3c', 0.3);
  const hBelly = mixC(neckSkin, pal.secondary, 0.4);

  // the mound: a barrel with a ridge, its belly pale, scale diamonds over it
  const bodyKeys = [[-0.56, 0.2, 0, 0.05, 0.05], [-0.46, 0.24, 0, 0.16, 0.19], [-0.26, 0.28, 0, 0.25, 0.33], [0.0, 0.29, 0, 0.27, 0.38], [0.2, 0.28, 0, 0.24, 0.34], [0.36, 0.26, 0, 0.17, 0.24], [0.45, 0.25, 0, 0.09, 0.1]];
  const bodySt = pathStations(bodyKeys, 18);
  const bodyBind = rigid(ix.body);
  kit.loft(bodySt, {
    ref: [0, 1, 0], sides: 18, start: 'round', end: 'round', capRings: 3, capDepth: [0.06, 0.05], color: skin, bind: bodyBind,
    paint: scalesPaint(1.0, { skin, back: pal.back, belly: hBelly, backK: 0.4 }),
  });
  ring(kit, bodySt, 9, 10, 1.04, TEAM(1), bodyBind);
  if (grand) ring(kit, bodySt, 5, 6, 1.03, pal.glow, bodyBind, { mat: 'gem', glow: 0.7 });
  if (ex.has('spikes')) {
    // a back overgrown with moss and young cypress: dark cones of green along the ridge, among low pads of moss
    const cypress = mixC(skin, '#2f6a32', 0.6);
    const moss = mixC(tintC(skin, 0.2), '#86a840', 0.5);
    for (let i = 0; i < 7; i++) {
      const x = 0.3 - i * 0.1;
      const s = bodySt[Math.max(0, Math.min(bodySt.length - 1, Math.round(((x + 0.56) / 1.01) * (bodySt.length - 1))))];
      const z = (i % 2 ? 1 : -1) * 0.07 * (i % 3);
      spike(kit, { at: [x, s.c[1] + s.rx * 0.9, z], dir: [-0.12, 1, 0], len: 0.17 - 0.012 * i, r: 0.04, bend: [-0.03, 0, 0], color: cypress, mat: 'cloth', bind: bodyBind, sides: 6, ref: [1, 0, 0], flat: 0.9 });
      kit.loft([ps(x - 0.07, s.c[1] + s.rx * 0.8, z + 0.1, 0.07, 0.05), ps(x, s.c[1] + s.rx * 0.93, z + 0.09, 0.09, 0.05), ps(x + 0.07, s.c[1] + s.rx * 0.8, z + 0.1, 0.07, 0.05)], { ref: [0, 1, 0], rings: 3, sides: 8, start: 'round', end: 'round', capDepth: 0.03, color: moss, mat: 'cloth', bind: bodyBind });
    }
  }

  // the tail: a thick taper of four bones, a spade at its tip
  const tb = alongPath(bonesOf(spec, ['body', 't1', 't2', 't3', 't4']), [[0, 0.27, 0], ...tailPts]);
  const tailKeys = [[-0.3, 0.26, 0, 0.18, 0.2], [-0.5, 0.23, 0.02, 0.14, 0.15], ...tailPts.slice(1).map((p, i) => [p[0], p[1], p[2], [0.115, 0.08, 0.05, 0.02][i] * 1.05, [0.115, 0.08, 0.05, 0.02][i] * 1.05])];
  kit.loft(pathStations(tailKeys, 12), {
    ref: [0, 1, 0], sides: 12, start: null, end: 'round', capRings: 3, capDepth: 0.04, color: skin, bind: tb,
    paint: scalesPaint(1.0, { skin, back: pal.back, belly: hBelly, backK: 0.35 }),
  });
  const tip = tailPts[4];
  spike(kit, { at: [tip[0] + 0.02, tip[1], tip[2]], dir: [-1, 0.1, 0], len: 0.16, r: 0.05, color: pal.back, bind: rigid(ix.t4), sides: 6, ref: [0, 1, 0], flat: 0.35 });

  // the legs: stout and bent out like a lizard's, one bone each, with claws
  for (const [k, p] of Object.entries(hips)) {
    const lb = rigid(ix[`leg${k}`]);
    kit.loft([
      ps(p[0], p[1] + 0.14, p[2] * 0.8, 0.15, 0.14), ps(p[0] + 0.01, p[1] - 0.01, p[2] * 1.18, 0.115, 0.105),
      ps(p[0] + 0.02, 0.12, p[2] * 1.22, 0.075, 0.07), ps(p[0] + 0.03, 0.05, p[2] * 1.22, 0.075, 0.07),
    ], { ref: [0, 0, 1], rings: 7, sides: 10, start: 'round', end: 'round', capDepth: 0.04, color: skin, bind: lb });
    paw(kit, { x: p[0] + 0.02, z: p[2] * 1.22, r: 0.07, color: shadeC(skin, 0.8), bind: lb, claw: pal.horn });
  }

  // the necks and the heads
  const glow = ex.has('eye_glow') && !!pal.eyeGlow;
  necks.forEach((nk, i) => {
    const bones = [`h${i}a`, `h${i}b`, `h${i}c`, `h${i}h`].map((nm) => ix[nm]);
    const nb = alongPath(bones, nk.pts);
    const rr = [0.12, 0.1, 0.082, 0.066].map((r) => r * nr * (grand ? 1.05 : 1));
    const keys = [[nk.pts[0][0] - 0.05, nk.pts[0][1] - 0.04, nk.pts[0][2], rr[0] * 1.15, rr[0] * 1.15], ...nk.pts.map((p, j) => [p[0], p[1], p[2], rr[j] * 0.92, rr[j]])];
    kit.loft(pathStations(keys, 14), {
      ref: [0, 1, 0], sides: 10, start: 'round', end: 'round', capRings: 2, capDepth: [0.05, 0.03], color: neckSkin, bind: nb,
      paint: scalesPaint(0.9, { skin: neckSkin, back: pal.back, belly: hBelly, backK: 0.3 }),
    });
    reptileHead(kit, {
      kind: 'serpent', at: nk.top, pitch: -0.4, yaw: -nk.a * 0.6, len: headLen, bind: { head: rigid(ix[`h${i}h`]), jaw: rigid(ix[`h${i}j`]) }, lean: true,
      skin: neckSkin, belly: hBelly, back: mixC(neckSkin, pal.back, 0.45), glowEyes: glow, eyeColor: glow ? glowEye(pal) : withMat('#f0d040', 'gloss'), tongue: false, gear: 'none', horn: pal.horn,
    });
  });

  const geo = kit.build({ ground: 1 });
  const rig = { stride: 1, plan: 'hydra' };
  return {
    kind: 'hydra', rich: { spec, geo, attach: [], dims: { shoulderY: 0.5, shoulderZ: 0.2 }, carryAt: [0, 0.3, 0], plan: 'hydra', ix, necks: n }, parts: [], rig, triangles: geo.userData.triangles, meshes: 1,
  };
}

/** The rich template of a serpent, hydra or dragon unit type: { kind, rich: { spec, geo, attach, ... }, rig, parts: [] }. */
export function buildSerpentTemplate(unitType, ctx) {
  switch (ctx.v.body) {
    case 'hydra': return buildHydra(unitType, ctx);
    case 'dragon': return buildSpine(unitType, ctx, 'dragon');
    default: return buildSpine(unitType, ctx, 'serpent');
  }
}
