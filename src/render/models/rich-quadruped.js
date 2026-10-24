// The rich four-legged beasts (High and Ultra): one smooth skinned mesh on a bone rig of a spine, a neck, a
// head with a jaw and ears, a tail and four legs of three bones each, in place of the low-poly rigid parts.
// A build (canine, feline, bovine, equine ...) is a table of proportions; a unit's visual picks the build by
// its head and says what it wears (fur, a mane, spikes, a tail, wings). The pose keys of the low-poly rig
// (unit-anim.js quadPose) stay the source of truth: rich-creature-anim.js turns them into bone rotations.
import { shadeC, mixC, TEAM } from './unit-geo.js';
import { WEAPON_INFO } from './unit-parts.js';
import { holdsAloft } from './unit-bodies.js';
import { MeshKit, ps, rigid, alongPath, mixBind, smoothstep } from './rich-kit.js';
import { creatureSpec, addBones, pathStations, frameMatrix, pathOf, bonesOf, atJoint, ringPoint, TAIL_KEYS, HEAD_KEYS } from './rich-creature-kit.js';
import { mammalHead, mammalMetrics } from './rich-mammal-heads.js';
import { clamp, lerp, tint, dye, furStreaks, jaguarSpots } from './rich-paint.js';
import { paw, hoof, collar, spike, halo } from './rich-creature-parts.js';
import { ruff, lionMane, crestMane, forelock, hairTail } from './rich-creature-hair.js';
import { wingJoints, wingBones, featherWings } from './rich-creature-wings.js';
import { humanHead, HUMAN_HEADGEAR } from './rich-creature-human-head.js';

const PI = Math.PI;

/** The build under a head: a human one sits on a bull when the beast has wings (the lamassu), else on a heavy lion's (the sphinx). */
const buildOf = (v) => (v.head === 'human' ? (v.extras.includes('wings') ? 'bovine' : 'sphinx') : QUAD_BUILD_OF[v.head]);

/** The head kinds this body plan builds (the unit's visual.head), and the build each one rides on. */
export const QUAD_BUILD_OF = { wolf: 'canine', jackal: 'canine', fox: 'fox', cat: 'feline', lion: 'feline', bull: 'bovine', horse: 'equine' };

/**
 * Proportions at scale 1 (about what the low-poly beasts cover, so a rich beast keeps its place on the map):
 * L body length, H chest depth, W body width, leg (shoulder height less the chest), legR leg radius, neck length /
 * angle (radians up from horizontal), head length, head pitch (absolute, nose down negative), tail length, and
 * `body`: the barrel's stations [x of L, height of H, half depth of H, half width of W] from the rump to the chest.
 */
const BUILDS = {
  canine: {
    L: 0.64, H: 0.29, W: 0.235, leg: 0.3, legR: 0.04, neck: 0.17, neckA: 0.6, head: 0.37, pitch: -0.2, tail: 0.38, gait: 'gallop', tailKind: 'bushy', neckK: 1.0,
    body: [[-0.55, 0.12, 0.3, 0.32], [-0.45, 0.08, 0.45, 0.52], [-0.28, 0.1, 0.42, 0.45], [-0.06, 0.07, 0.46, 0.44], [0.14, 0, 0.52, 0.47], [0.31, -0.04, 0.6, 0.48], [0.45, 0.04, 0.48, 0.4]],
  },
  fox: {
    L: 0.58, H: 0.22, W: 0.17, leg: 0.28, legR: 0.033, neck: 0.15, neckA: 0.6, head: 0.26, pitch: -0.2, tail: 0.42, gait: 'gallop', tailKind: 'brush', neckK: 0.95,
    body: [[-0.54, 0.1, 0.28, 0.28], [-0.44, 0.1, 0.42, 0.42], [-0.26, 0.12, 0.38, 0.38], [-0.06, 0.07, 0.44, 0.42], [0.14, 0, 0.5, 0.44], [0.31, -0.03, 0.55, 0.45], [0.45, 0.04, 0.45, 0.38]],
  },
  feline: {
    L: 0.6, H: 0.33, W: 0.26, leg: 0.4, legR: 0.056, neck: 0.2, neckA: 0.75, head: 0.4, pitch: -0.08, tail: 0.6, gait: 'gallop', tailKind: 'long', pawK: 1.15, claws: false, neckK: 1.3,
    body: [[-0.55, 0.08, 0.3, 0.34], [-0.45, 0.08, 0.42, 0.46], [-0.28, 0.08, 0.34, 0.38], [-0.06, 0.08, 0.34, 0.36], [0.14, 0.05, 0.44, 0.42], [0.31, 0.03, 0.58, 0.5], [0.45, 0.04, 0.5, 0.42]],
  },
  sphinx: {
    L: 0.68, H: 0.44, W: 0.34, leg: 0.3, legR: 0.082, neck: 0.16, neckA: 0.55, head: 0.42, pitch: 0.0, tail: 0.6, gait: 'gallop', tailKind: 'long', pawK: 1.3, claws: false, neckK: 1.2,
    body: [[-0.55, 0.06, 0.3, 0.34], [-0.45, 0.06, 0.4, 0.46], [-0.28, 0.06, 0.36, 0.4], [-0.06, 0.06, 0.4, 0.42], [0.14, 0.04, 0.5, 0.46], [0.31, 0.04, 0.58, 0.5], [0.45, 0.05, 0.5, 0.42]],
  },
  bovine: {
    L: 0.72, H: 0.33, W: 0.3, leg: 0.3, legR: 0.062, neck: 0.14, neckA: 0.3, head: 0.34, pitch: -0.55, tail: 0.32, gait: 'gallop', hoof: true, tailKind: 'tassel', neckK: 1.4,
    body: [[-0.54, 0.08, 0.36, 0.36], [-0.44, 0.08, 0.48, 0.48], [-0.26, 0.08, 0.5, 0.5], [-0.06, 0.06, 0.54, 0.5], [0.14, 0.05, 0.62, 0.52], [0.31, 0.06, 0.7, 0.54], [0.45, 0.07, 0.52, 0.43]],
  },
  equine: {
    L: 0.74, H: 0.28, W: 0.24, leg: 0.46, legR: 0.042, neck: 0.34, neckA: 1.0, head: 0.36, pitch: -0.7, tail: 0.38, gait: 'gallop', hoof: true, tailKind: 'hair', neckK: 1.0,
    body: [[-0.54, 0.1, 0.36, 0.36], [-0.44, 0.1, 0.46, 0.46], [-0.26, 0.08, 0.46, 0.45], [-0.06, 0.05, 0.5, 0.45], [0.14, 0.02, 0.53, 0.46], [0.31, 0.0, 0.55, 0.46], [0.45, 0.06, 0.46, 0.4]],
  },
};

/** What a unit may wear for this plan to dress it (anything else keeps the low-poly model). */
const QUAD_EXTRAS = new Set(['fur', 'tail', 'eye_glow', 'wings', 'mane', 'spikes', 'aura_ring', 'jewelry', 'beard']);

/** Which units this plan builds: a quadruped whose head it has a table for, wearing only extras it can show. */
export function quadSupported(v) {
  if (v.body !== 'quadruped') return false;
  if (!QUAD_BUILD_OF[v.head] && v.head !== 'human') return false;
  if (!(v.heads === 1 || (v.heads === 3 && v.head === 'wolf'))) return false;
  if (!(v.head === 'human' ? HUMAN_HEADGEAR.has(v.headgear) : v.headgear === 'none')) return false;
  return v.extras.every((e) => QUAD_EXTRAS.has(e));
}

// ---------------------------------------------------------------------------
// layout: where every bone and landmark sits
// ---------------------------------------------------------------------------

/** The barrel's half depth, half width and center height at x (the stations of Q.body, straight between them). */
function barrelAt(Q, cy, x) {
  const k = Q.body;
  const f = x / Q.L;
  let i = 0;
  while (i < k.length - 2 && f > k[i + 1][0]) i++;
  const t = clamp((f - k[i][0]) / (k[i + 1][0] - k[i][0]));
  return { y: cy + lerp(k[i][1], k[i + 1][1], t) * Q.H, ry: lerp(k[i][2], k[i + 1][2], t) * Q.H, rz: lerp(k[i][3], k[i + 1][3], t) * Q.W };
}

/** `n` tails fanned out from the first: path 0 straight back, the others turned sideways and lifted. */
function fanTails(tail, n) {
  const out = [tail];
  const [t0] = tail;
  for (let k = 1; k < n; k++) {
    const side = k % 2 ? 1 : -1;
    const ang = side * (0.3 + 0.2 * Math.floor((k - 1) / 2));
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    out.push(tail.map((p, i) => {
      const dx = p[0] - t0[0];
      const dz = p[2] - t0[2];
      return [t0[0] + dx * ca - dz * sa, p[1] + 0.05 * i, t0[2] + dx * sa + dz * ca];
    }));
  }
  return out;
}

function layout(Q, kind, o) {
  const { L, H, W, leg } = Q;
  const cy = leg + H * 0.45;
  const lz = W * 0.3;
  const fx = L * 0.3;
  const bx = -L * 0.3;
  const hips = [bx, cy + H * 0.1, 0];
  const spine = [0, cy + H * 0.08, 0];
  const chest = [L * 0.28, cy + H * 0.05, 0];
  const neck1 = [L * 0.38, cy + H * 0.22, 0];
  const dn = [Math.cos(Q.neckA), Math.sin(Q.neckA), 0];
  const neck2 = [neck1[0] + dn[0] * Q.neck * 0.5, neck1[1] + dn[1] * Q.neck * 0.5, 0];
  const head = [neck1[0] + dn[0] * Q.neck, neck1[1] + dn[1] * Q.neck, 0];
  const hm = kind === 'human' ? null : mammalMetrics(kind, Q.head);
  const M = frameMatrix(head, Q.pitch, 0, 1);
  const jaw = hm && headToModel(M, hm.jawAt);
  const ears = hm && [1, -1].map((s) => headToModel(M, [hm.earAt[0], hm.earAt[1], hm.earAt[2] * s]));
  // the tail leaves the top of the rump and arcs back, drooping or lifting by its kind
  const t0 = [-L * 0.52, cy + H * 0.3, 0];
  const tl = Q.tail;
  const lift = Q.tailKind === 'long' ? [0.06, 0.1, 0.06, -0.02] : Q.tailKind === 'tassel' || Q.tailKind === 'hair' ? [-0.05, -0.2, -0.45, -0.7] : [0.06, 0.02, -0.12, -0.34];
  const back = [0.18, 0.45, 0.75, 0.98];
  const tail = [t0, ...back.map((b, i) => [t0[0] - tl * b, t0[1] + tl * lift[i], 0])];
  const tails = fanTails(tail, o.tails);
  // legs: shoulder / hip, elbow / stifle, wrist / hock, ground (the paw's top: the lofts end a little above it)
  const legs = {};
  for (const side of [1, -1]) {
    const z = side * lz;
    legs[`F${side}`] = [[fx, leg + H * 0.35, z], [fx - 0.012, leg * 0.86, z], [fx + 0.006, leg * 0.26, z], [fx + 0.012, 0.0, z]];
    legs[`B${side}`] = [[bx + 0.012, leg + H * 0.55, z * 0.8], [bx + L * 0.14, leg * 0.9, z], [bx - L * 0.06, leg * 0.46, z], [bx - L * 0.045, 0.0, z]];
  }
  // the extra heads of a many-headed beast: each on a neck of its own, turned out to its side
  const extra = [];
  for (let k = 0; k < o.heads - 1; k++) {
    const side = k % 2 ? -1 : 1;
    const yaw = -side * (0.66 + 0.12 * Math.floor(k / 2));
    const base = [neck1[0] - 0.01, neck1[1] - 0.02, side * W * (0.3 + 0.08 * Math.floor(k / 2))];
    const dir = [Math.cos(Q.neckA) * Math.cos(yaw), Math.sin(Q.neckA), -Math.cos(Q.neckA) * Math.sin(yaw)];
    const mid = [base[0] + dir[0] * Q.neck * 0.5, base[1] + dir[1] * Q.neck * 0.5, base[2] + dir[2] * Q.neck * 0.5];
    const hd = [base[0] + dir[0] * Q.neck, base[1] + dir[1] * Q.neck, base[2] + dir[2] * Q.neck];
    const Mh = frameMatrix(hd, Q.pitch, yaw, 1);
    extra.push({ side, yaw, neck1: base, neck2: mid, head: hd, jaw: headToModel(Mh, hm.jawAt), dir });
  }
  // wings: from behind the shoulders, out over the back
  let wing = null;
  if (o.wings) {
    const wx = chest[0] - 0.05;
    const b = barrelAt(Q, cy, wx);
    wing = wingJoints([wx, b.y + b.ry * 0.62, W * 0.2], o.wings, { back: 0.06, up: 0.18, out: 0.5 });
  }
  return { cy, lz, fx, bx, hips, spine, chest, neck1, neck2, head, jaw, ears, tail, tails, legs, wing, extra, hm, dn };
}

/** A head-local point in model space. */
function headToModel(M, p) {
  const e = M.elements;
  return [e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12], e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13], e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]];
}

function skeleton(Lay) {
  const list = [
    ['root', null, [0, 0, 0]],
    ['hips', 'root', Lay.hips], ['spine', 'hips', Lay.spine], ['chest', 'spine', Lay.chest],
    ['neck1', 'chest', Lay.neck1], ['neck2', 'neck1', Lay.neck2], ['head', 'neck2', Lay.head],
  ];
  if (Lay.hm) list.push(['jaw', 'head', Lay.jaw], ['earR', 'head', Lay.ears[0]], ['earL', 'head', Lay.ears[1]]);
  Lay.tails.forEach((path, k) => {
    path.slice(0, 4).forEach((p, i) => list.push([`${TAIL_KEYS[k]}${i + 1}`, i ? `${TAIL_KEYS[k]}${i}` : 'hips', p]));
  });
  for (const [key, pts] of Object.entries(Lay.legs)) {
    const par = key[0] === 'F' ? 'chest' : 'hips';
    list.push([`${key}u`, par, pts[0]], [`${key}l`, `${key}u`, pts[1]], [`${key}p`, `${key}l`, pts[2]]);
  }
  Lay.extra.forEach((h, k) => {
    const key = HEAD_KEYS[k];
    list.push([`${key}n1`, 'chest', h.neck1], [`${key}n2`, `${key}n1`, h.neck2], [`${key}h`, `${key}n2`, h.head], [`${key}j`, `${key}h`, h.jaw]);
  });
  const spec = creatureSpec(list);
  if (Lay.wing) addBones(spec, wingBones('chest', Lay.wing));
  return spec;
}

// ---------------------------------------------------------------------------
// the template
// ---------------------------------------------------------------------------

/** The stations of a leg loft: `list` of [u, rx, rz] (in units of r), u the fractional index along the points `pts` (1.5: halfway from pts[1] to pts[2]). */
function legStations(pts, list, r) {
  return list.map(([u, rx, rz]) => {
    const p = atJoint(pts, u);
    return ps(p[0], p[1], p[2], rx * r, rz * r);
  });
}

/** The rich template of a quadruped unit type: { kind, rich: { spec, geo, attach, ... }, rig, parts: [] }. */
export function buildQuadrupedTemplate(unitType, ctx) {
  const { v, pal, ex } = ctx;
  const head = v.head;
  const Q = { ...BUILDS[buildOf(v)] };
  if (head === 'human') Object.assign(Q, { neckA: 1.05, neck: Q.head * 0.55, pitch: 0, head: Q.head * 0.8, neckK: Q.neckK * 0.8 });
  if (ctx.unit.class === 'titan' || v.scale >= 3) Q.legR *= 1.15;
  const wings = ex.has('wings') ? (head === 'horse' ? 0.7 : 0.8) : 0;
  const nTails = head === 'fox' && ex.has('tail') && v.aura ? 3 : 1;
  const nHeads = Math.min(v.heads || 1, 3);
  const Lay = layout(Q, head, { wings, tails: nTails, heads: nHeads });
  const spec = skeleton(Lay);
  const ix = spec.ix;
  const kit = new MeshKit(spec, { sides: ctx.grand ? 16 : 12, rings: 1 });
  const { L, H, W, leg, legR } = Q;
  const cy = Lay.cy;

  const fur = pal.skin;
  const backC = pal.back;
  const belly = pal.belly;
  const dark = shadeC(fur, 0.62);
  const bodyBones = bonesOf(spec, ['hips', 'spine', 'chest']);
  const bodyPts = pathOf(spec, ['hips', 'spine', 'chest']);
  bodyPts.push([L * 0.5, cy + H * 0.12, 0]);
  const bodyBind = alongPath(bodyBones, bodyPts);
  // a coat: the back a shade toward the second tone, the belly paler, streaks of hair
  const rosettes = head === 'cat' ? jaguarSpots(0.045) : null;
  const coat = (o, x, y, z, u, a) => {
    const c = Math.cos(a);
    tint(o, backC, 0.7 * smoothstep(0.1, 0.9, c));
    tint(o, belly, 0.8 * smoothstep(0.2, 0.95, -c));
    furStreaks(o, x, y, z);
    if (rosettes) rosettes(o, x, y, z);
  };

  // the barrel and the neck as one loft, from the rump through the chest and up the neck to the skull: no seam at the shoulders
  const nr = Q.head * 0.24 * (Q.neckK ?? 1);
  const keys = Q.body.slice(0, -1).map(([f, yo, ry, rz]) => [L * f, cy + H * yo, 0, H * ry, W * rz]);
  keys.push(
    [Lay.neck1[0], Lay.neck1[1], 0, Math.max(nr * 1.35, H * 0.36), Math.max(nr * 1.05, W * 0.3)],
    [Lay.neck2[0], Lay.neck2[1], 0, nr * 1.2, nr * 0.96],
    [Lay.head[0] - 0.012, Lay.head[1] - 0.004, 0, nr * 1.04, nr * 0.86],
  );
  const frontBind = alongPath(bonesOf(spec, ['hips', 'spine', 'chest', 'neck1', 'neck2', 'head']), pathOf(spec, ['hips', 'spine', 'chest', 'neck1', 'neck2', 'head']), [0.06, 0.07, 0.05, 0.05, 0.04].map((x) => x * Math.max(1, L / 0.64)));
  const bodySt = pathStations(keys, 17);
  kit.loft(bodySt, { ref: [0, 1, 0], sides: 18, start: 'round', end: 'round', capRings: 3, capDepth: [L * 0.1, nr * 0.5], color: fur, bind: frontBind, paint: coat });
  if (ex.has('fur') && !ex.has('mane')) ruff(kit, bodySt, { from: L * 0.1, len: Q.head * 0.27, w: Q.head * 0.08, color: fur, back: backC, bind: frontBind });

  // head, with its jaw and ears
  const hb = head === 'human' ? { head: rigid(ix.head), neck: frontBind } : { head: rigid(ix.head), jaw: rigid(ix.jaw), ear: { 1: rigid(ix.earR), '-1': rigid(ix.earL) } };
  if (head === 'human') humanHead(kit, { ctx, pal, at: Lay.head, pitch: Q.pitch, scale: L > 0.7 ? 1.75 : 1.65, bind: hb });
  else mammalHead(kit, {
    kind: head, at: Lay.head, pitch: Q.pitch, len: Q.head, bind: hb, pal, fur, glowEyes: ex.has('eye_glow') && !!pal.eyeGlow,
    pale: head === 'fox' ? pal.white : head === 'lion' || head === 'cat' ? mixC(fur, '#f4ead4', 0.5) : undefined,
    noseColor: head === 'bull' ? shadeC(mixC(fur, '#7a5a58', 0.6), 0.8) : undefined,
    paint: (o, x, y, z) => furStreaks(o, x, y, z),
  });

  // the other heads, each on its own neck
  Lay.extra.forEach((h, k) => {
    const key = HEAD_KEYS[k];
    const nb = bonesOf(spec, ['chest', `${key}n1`, `${key}n2`, `${key}h`]);
    const pts = [Lay.chest, h.neck1, h.neck2, h.head];
    const nBind = alongPath(nb, pts, [0.05, 0.05, 0.04]);
    const nk = [[h.neck1[0] - h.dir[0] * 0.1, h.neck1[1] - h.dir[1] * 0.1, h.neck1[2] - h.dir[2] * 0.1, nr * 1.5, nr * 1.2], [...h.neck1, nr * 1.3, nr * 1.05], [...h.neck2, nr * 1.1, nr * 0.95], [h.head[0] - h.dir[0] * 0.012, h.head[1] - h.dir[1] * 0.012, h.head[2] - h.dir[2] * 0.012, nr * 1.0, nr * 0.85]];
    kit.loft(pathStations(nk, 8), { ref: [0, 1, 0], sides: 14, start: 'round', end: 'round', capRings: 2, capDepth: [nr * 0.5, nr * 0.5], color: fur, bind: nBind, paint: coat });
    mammalHead(kit, {
      kind: head, at: h.head, pitch: Q.pitch, yaw: h.yaw, len: Q.head * 0.92, lean: true, bind: { head: rigid(ix[`${key}h`]), jaw: rigid(ix[`${key}j`]), ear: {} }, pal, fur, glowEyes: ex.has('eye_glow') && !!pal.eyeGlow,
      paint: (o, x, y, z) => furStreaks(o, x, y, z),
    });
  });

  // manes
  if (ex.has('mane')) {
    if (head === 'lion') {
      const base = pal.primary;
      // the mass of the mane: a thick collar from the shoulders to the skull, its locks laid over it in rings
      const coreKeys = [[Lay.chest[0] - 0.03, Lay.chest[1] + 0.03, 0, H * 0.56, W * 0.56], [Lay.neck1[0], Lay.neck1[1] + 0.03, 0, H * 0.56, W * 0.58], [Lay.neck2[0], Lay.neck2[1] + 0.03, 0, Q.head * 0.4, Q.head * 0.4], [Lay.head[0] + 0.01, Lay.head[1], 0, Q.head * 0.38, Q.head * 0.38]];
      const coreSt = pathStations(coreKeys, 7);
      kit.loft(coreSt, { ref: [0, 1, 0], sides: 14, start: 'round', end: 'round', capRings: 2, capDepth: [0.05, 0.04], color: shadeC(base, 0.8), mat: 'fur', bind: frontBind, paint: (o, x, y, z) => furStreaks(o, x, y, z) });
      lionMane(kit, coreSt, { from: -1, len: Q.head * 0.82, w: Q.head * 0.3, color: shadeC(base, 0.95), dark: shadeC(base, 0.72), tip: shadeC(base, 0.5), bind: frontBind });
    } else if (head === 'horse') {
      const hair = pal.secondary;
      crestMane(kit, bodySt, { from: Lay.neck1[0] - 0.04, len: Q.head * 0.62, w: Q.head * 0.1, color: hair, tip: shadeC(hair, 0.9), bind: frontBind });
      const fo = headToModel(frameMatrix(Lay.head, Q.pitch, 0, Q.head), [0.2, 0.34, 0]);
      forelock(kit, { at: fo, dir: [0.7, -0.5, 0], len: Q.head * 0.4, w: Q.head * 0.045, color: hair, tip: shadeC(hair, 0.9), bind: rigid(ix.head) });
    }
  }

  // legs
  const horn = shadeC(fur, 0.35);
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
    kit.loft(st, {
      ref: [1, 0, 0], rings: 12, sides: 10, start: null, end: null, color: fur, bind,
      paint: (o, x, y, z, u, a) => {
        coat(o, x, y, z, u, 0.62 * PI);
        tint(o, dark, 0.45 * smoothstep(leg * 0.5, leg * 0.1, y));
      },
    });
    const pawBind = rigid(ix[`${key}p`]);
    if (Q.hoof) hoof(kit, { x: pts[3][0], z: pts[3][2], r: r * 0.78, h: r * 1.5, color: horn, bind: pawBind });
    else paw(kit, { x: pts[3][0] - r * 0.7, z: pts[3][2], r: r * 0.9 * (Q.pawK ?? 1), color: shadeC(fur, 0.85), bind: pawBind, claw: Q.claws === false ? null : pal.bone, paint: (o) => tint(o, dark, 0.3) });
    if (ex.has('jewelry')) {
      const at = atJoint(pts, 1.85);
      collar(kit, { at, dir: [0, 1, 0], rx: r * 1.18, rz: r * 1.1, h: 0.03, color: pal.accentMetal, mat: 'gold', bind: legBind });
    }
  }

  // tails
  const kindT = Q.tailKind;
  const tr = kindT === 'bushy' ? legR * 0.95 : kindT === 'brush' ? legR * 1.0 : kindT === 'long' ? legR * 0.82 : legR * 0.62;
  const prof = kindT === 'bushy' ? [0.7, 1.0, 1.4, 1.3, 0.55] : kindT === 'brush' ? [0.7, 1.2, 1.8, 1.5, 0.6] : kindT === 'long' ? [1.05, 1, 0.95, 0.9, 0.78] : [1, 1, 0.95, 0.85, 0.65];
  Lay.tails.forEach((tpts, k) => {
    const tb = bonesOf(spec, [1, 2, 3, 4].map((i) => `${TAIL_KEYS[k]}${i}`));
    const tailBind = alongPath(tb, tpts, 0.05);
    const tailKeys = tpts.map((p, i) => [p[0], p[1], p[2], tr * prof[i], tr * prof[i]]);
    kit.loft(pathStations(tailKeys, 9), {
      ref: [0, 0, 1], sides: 10, start: 'round', end: 'round', capRings: 3, capDepth: [tr, tr * 1.6], color: fur, bind: tailBind,
      paint: (o, x, y, z, u) => {
        furStreaks(o, x, y, z);
        tint(o, backC, 0.5 * (1 - u));
        if (head === 'fox') tint(o, pal.white, smoothstep(0.78, 0.9, u));
        else if (kindT === 'bushy') tint(o, dark, 0.5 * smoothstep(0.75, 0.97, u));
        else if (kindT === 'long') tint(o, dark, 0.7 * smoothstep(0.82, 0.96, u));
      },
    });
    if (kindT === 'hair' && ex.has('tail')) {
      hairTail(kit, { pts: tpts, n: 16, len: Q.tail * 0.95, w: 0.022, color: ex.has('mane') ? pal.secondary : fur, tip: shadeC(ex.has('mane') ? pal.secondary : fur, 0.88), bind: tailBind, droop: 0.65, spread: 1.2 });
    } else if (kindT === 'tassel') {
      hairTail(kit, { pts: tpts.slice(-2), n: 9, len: Q.tail * 0.34, w: 0.02, color: shadeC(fur, 0.55), tip: shadeC(fur, 0.4), bind: tailBind, droop: 0.6, spread: 0.7 });
    }
  });

  // dorsal spikes
  if (ex.has('spikes')) {
    const sc = pal.horn;
    const n = 7;
    for (let k = 0; k < n; k++) {
      const i = 2 + Math.round(k * 1.5);
      if (i >= bodySt.length - 4) break;
      const { p, n: nn, t } = ringPoint(bodySt, i, 0);
      const len = Q.head * (0.38 - 0.03 * Math.abs(k - 2));
      spike(kit, { at: [p[0] - nn[0] * 0.01, p[1] - nn[1] * 0.01, p[2]], dir: [nn[0] * 0.8 - t[0] * 0.55, nn[1] * 0.8 - t[1] * 0.55, 0], len, r: len * 0.2, bend: [-len * 0.12, 0, 0], color: sc, bind: frontBind });
    }
  }
  // a glowing ring of gems over the back
  if (ex.has('aura_ring')) halo(kit, { center: [0, cy + H + 0.24, 0], r: W * 1.15, color: pal.glow, gem: pal.glow, bind: rigid(ix.spine) });
  // a collar of gold
  if (ex.has('jewelry')) {
    const at = [lerp(Lay.neck1[0], Lay.neck2[0], 0.45), lerp(Lay.neck1[1], Lay.neck2[1], 0.45), 0];
    collar(kit, { at, dir: [Lay.dn[0], Lay.dn[1], 0], rx: nr * 1.5, rz: nr * 1.18, h: 0.045, color: pal.accentMetal, mat: 'gold', bind: frontBind, sides: 16 });
  }

  // the team's saddle cloth over the back
  saddle(kit, Q, cy, frontBind, pal);

  const geo = kit.build({ ground: 1 });
  const attach = wings ? featherWings(spec, { span: wings, joints: Lay.wing, cover: pal.primary, flight: mixC(pal.secondary, '#ffffff', 0.15), tip: null, nSec: 7, nPri: 8, wide: 1.45 }) : [];
  const rig = {
    legLen: leg, bodyY: cy, sprawl: false, stride: leg * 3.2 + L * 0.6,
    weapon: v.weapon, info: WEAPON_INFO[v.weapon] || WEAPON_INFO.none, rightElbow: 0.25, leftElbow: 0.25,
    gait: Q.gait, holdAloft: holdsAloft(v), plan: 'quadruped',
  };
  const triangles = geo.userData.triangles + attach.reduce((s, a) => s + (a.geo.userData.triangles ?? a.geo.attributes.position.count / 3), 0);
  return {
    kind: 'quadruped', rich: { spec, geo, attach, dims: { shoulderY: cy + H, shoulderZ: Lay.lz }, carryAt: Lay.chest, plan: 'quadruped', ix }, parts: [], rig,
    triangles, meshes: 1 + attach.length,
  };
}

/** The team's colored saddle cloth: a cloth draped over the back with a trimmed hem, hugging the barrel. */
function saddle(kit, Q, cy, bind, pal) {
  const { L } = Q;
  const len = L * 0.25;
  const x0 = -L * 0.2;
  const half = PI * 0.5;
  const g = 0.012;
  const trim = shadeC(pal.accentMetal, 0.72);
  kit.sheet(5, 16, (u, v, out) => {
    const x = x0 + u * len;
    const p = barrelAt(Q, cy, x);
    // v runs from the right flank over the back to the left flank: the outer face looks outward
    const a = (0.5 - v) * 2 * half;
    const edge = Math.abs(v - 0.5) * 2;
    const hang = 1 - 0.08 * edge * edge;
    out[0] = x;
    out[1] = p.y + (p.ry + g) * Math.cos(a) * hang;
    out[2] = (p.rz + g) * Math.sin(a) * hang;
  }, {
    thick: 0.006, color: TEAM(1), inner: shadeC(pal.secondary, 0.8), bind,
    paint: (o, x, y, z, u, v) => {
      // a band of the hem's metal along the lower edge, and a thin stripe along the ends
      if (Math.abs(v - 0.5) * 2 > 0.93 || u < 0.04 || u > 0.96) dye(o, trim, 0.9);
    },
  });
}
