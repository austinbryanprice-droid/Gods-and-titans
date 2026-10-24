// Animation of the rich creatures' skeletons (rich-quadruped.js ...). Like the rich humanoid (rich-anim.js) the
// pose keys of the low-poly rig (unit-anim.js quadPose: body bob / pitch / roll, head pitch / yaw, jaw, tail
// amplitude, a swing and a knee bend per leg) stay the source of truth; this file turns them into bone rotations
// and adds what a skeleton shows that rigid parts cannot: the spine bending through its length, the head riding
// steady on a pitching body, paws rolling flat, a tail whose wave travels down its bones, ears that twitch.
import * as THREE from 'three';
import { syncRich } from './rich-kit.js';
import { TAIL_KEYS, HEAD_KEYS } from './rich-creature-kit.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth01 = (x) => {
  const k = x < 0 ? 0 : x > 1 ? 1 : x;
  return k * k * (3 - 2 * k);
};

const K = { w: 0, h: 0, r: 0 };
const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Y = new THREE.Vector3(0, 1, 0);
/** Wind-up / strike / recover envelopes of an attack phase 0..1 (all zero without one), written into the shared K. */
export function strike(ap) {
  if (ap === undefined || ap === null) {
    K.w = K.h = K.r = 0;
    return K;
  }
  K.w = ap < 0.3 ? smooth01(ap / 0.3) : 1;
  K.h = ap < 0.3 ? 0 : ap < 0.5 ? smooth01((ap - 0.3) / 0.2) : 1;
  K.r = ap < 0.5 ? 0 : smooth01((ap - 0.5) / 0.5);
  return K;
}

/** The bones of a rich creature by role, looked up once (R.ix is the name -> index table of its spec). */
function bonesOf(R, names) {
  return names.map((n) => (R.ix[n] === undefined ? null : R.bones[R.ix[n]]));
}

/**
 * Pose the skeleton of m (a UnitModel with m.rich on a creature plan) from its blended pose keys P, then bring the
 * skin and the riding pieces up to date (syncRich).
 */
export function applyCreature(m, P, state, t, dt) {
  const R = m.rich;
  switch (R.plan) {
    case 'quadruped': applyQuadruped(m, R, P, state, t); break;
    default: break;
  }
  syncRich(R);
}

/** The wing bones of a rig (wingR1, wingR2, wingL1, wingL2), or null when it has none. */
function wingBonesOf(R) {
  const [r1, r2, l1, l2] = bonesOf(R, ['wingR1', 'wingR2', 'wingL1', 'wingL2']);
  return r1 ? { r1, r2, l1, l2 } : null;
}

/**
 * Wings: rigid feather pieces on two bones a side (the same make as the rich humanoid's, rich-anim.js poseWings). A grounded
 * unit standing about (P.fold, which the pose blend eases in and out) holds them lifted and swept back over its hips, as on
 * the reliefs; walking they lift a little and flutter, to cast they spread, and in the air they beat, the outer bone
 * trailing the inner one. The right wing spans +Z, the left is its mirror: the same flap and sweep with the signs that
 * mirror them. `rate`: the beat's speed scale, `amp`: how far it beats.
 */
function poseWings(w, m, P, state, t, phi, seed, rate = 1, amp = 1) {
  const fold = P.fold || 0;
  const r = (m.moving ? 8.5 : 5) * rate;
  let flap;
  let lag;
  if (state === 'dead') {
    flap = -0.5;
    lag = -0.25;
  } else if (m.air) {
    flap = (0.15 + 0.7 * Math.sin(t * r + seed)) * amp;
    lag = (0.1 + 0.55 * Math.sin(t * r + seed - 0.9)) * amp;
  } else if (state === 'cast') {
    flap = 0.6 + 0.1 * Math.sin(t * 6);
    lag = 0.3 + 0.12 * Math.sin(t * 6 - 0.7);
  } else if (m.moving) {
    flap = 0.3 + 0.22 * Math.sin(phi * 2);
    lag = 0.1 + 0.2 * Math.sin(phi * 2 - 0.8);
  } else {
    flap = 0.38 + 0.05 * Math.sin(t * 1.4 + seed);
    lag = 0.12 + 0.04 * Math.sin(t * 1.4 + seed - 0.6);
  }
  const sweep1 = 0.1 + fold * 0.5;
  const sweep2 = 0.12 + fold * 0.22;
  const a2 = lag - flap;
  for (const side of [1, -1]) {
    const w1 = side > 0 ? w.r1 : w.l1;
    const w2 = side > 0 ? w.r2 : w.l2;
    // flap about the body's axis, then sweep back about the vertical one
    _q.setFromAxisAngle(AX_Y, -side * sweep1);
    _r.setFromAxisAngle(AX_X, -side * flap);
    w1.quaternion.copy(_q.multiply(_r));
    w2.rotation.set(-side * a2, -side * sweep2, 0);
  }
}

// ---------------------------------------------------------------------------
// four-legged beasts
// ---------------------------------------------------------------------------

function quadBones(R) {
  const [root, hips, spine, chest, neck1, neck2, head, jaw, earR, earL] = bonesOf(R, ['root', 'hips', 'spine', 'chest', 'neck1', 'neck2', 'head', 'jaw', 'earR', 'earL']);
  const tails = TAIL_KEYS.map((k) => bonesOf(R, [1, 2, 3, 4].map((i) => `${k}${i}`))).filter((t) => t[0]);
  const leg = (key) => bonesOf(R, [`${key}u`, `${key}l`, `${key}p`]);
  const extra = HEAD_KEYS.map((k) => bonesOf(R, [`${k}n1`, `${k}n2`, `${k}h`, `${k}j`])).filter((h) => h[0]);
  return { root, hips, spine, chest, neck1, neck2, head, jaw, ears: [earR, earL], tails, extra, wings: wingBonesOf(R), legs: { FR: leg('F1'), FL: leg('F-1'), BR: leg('B1'), BL: leg('B-1') } };
}

function applyQuadruped(m, R, P, state, t) {
  const q = R.q || (R.q = quadBones(R));
  const seed = m.seed;
  const moving = m.moving;
  const phi = m.walkPhase;
  const gait = moving ? 1 : 0;
  const k = strike(state === 'attack' ? m.ap : undefined);
  const lunge = k.h * (1 - k.r);
  const wind = k.w * (1 - k.h);
  const dead = state === 'dead';
  const idle = !moving && !dead && state !== 'attack' ? 1 : 0;
  const breath = Math.sin(t * 1.7 + seed);
  const sway = Math.sin(t * 0.5 + seed * 1.9);
  const s = moving ? Math.sin(phi) : 0;
  const alpha = P.bRz;

  // body: bob and lunge on the root, a roll and a side shift while running; the pitch bends the spine, so
  // the hind legs stay planted while the front of the beast rises and falls
  q.root.position.set(P.bX, P.bY, 0.012 * s * gait);
  q.root.rotation.set(P.bRx + 0.02 * s * gait, 0, 0);
  q.hips.rotation.set(0, -0.05 * s * gait, 0.012 * breath * idle);
  q.spine.rotation.set(0, 0.06 * s * gait, alpha * 0.45 - 0.02 * lunge + 0.01 * breath * idle);
  q.chest.rotation.set(0, 0.05 * s * gait, alpha * 0.55 + 0.03 * wind);
  const pitchB = q.hips.rotation.z;
  const pitchF = pitchB + q.spine.rotation.z + q.chest.rotation.z;

  // neck and head: the pose's head pitch and yaw shared along the neck, the body's pitch half cancelled so the
  // eyes stay level; the head sweeps a little while it walks
  const look = idle * (0.5 * Math.sin(t * 0.37 + seed * 3) * Math.sin(t * 0.91 + seed));
  const nod = 0.04 * Math.sin(phi * 2 + 0.6) * gait + 0.012 * breath * idle;
  const hz = P.hRz;
  const hy = P.hRy + look;
  const hold = -0.55 * alpha;
  q.neck1.rotation.set(0, hy * 0.25, hz * 0.3 + hold * 0.35 + nod * 0.3);
  q.neck2.rotation.set(0, hy * 0.35, hz * 0.3 + hold * 0.35 + nod * 0.3);
  q.head.rotation.set(0, hy * 0.4, hz * 0.4 + hold * 0.3 + nod * 0.4);
  if (q.jaw) q.jaw.rotation.set(0, 0, -clamp(P.jaw, 0, 1.3) * 0.5);
  // the other heads follow the first a little behind, each looking about on its own
  q.extra.forEach(([n1, n2, h, j], k) => {
    const ph = seed * 2 + (k + 1) * 2.3;
    const sweep = idle * 0.5 * Math.sin(t * 0.6 + ph) + 0.15 * Math.sin(t * 2.1 + ph) * (1 - idle);
    const lag = 0.12 * Math.sin(t * 1.3 + ph) * idle;
    n1.rotation.set(0, hy * 0.25 + sweep * 0.3, hz * 0.3 + hold * 0.35 + nod * 0.3 + lag);
    n2.rotation.set(0, hy * 0.35 + sweep * 0.4, hz * 0.3 + hold * 0.35 + nod * 0.3);
    h.rotation.set(0, hy * 0.4 + sweep * 0.3, hz * 0.4 + hold * 0.3 + nod * 0.4);
    j.rotation.set(0, 0, -clamp(P.jaw * (1 - 0.15 * (k + 1)), 0, 1.3) * 0.5);
  });
  const flat = 0.5 * wind + 0.3 * lunge;
  const twitch = [Math.sin(t * 2.1 + seed * 2) * Math.sin(t * 0.7 + seed), Math.sin(t * 1.9 + seed * 5) * Math.sin(t * 0.6 + seed * 3)];
  q.ears.forEach((ear, i) => {
    if (!ear) return;
    const side = i === 0 ? 1 : -1;
    ear.rotation.set(side * (0.12 + 0.12 * twitch[i] * idle), 0, 0.1 + flat + 0.2 * twitch[i] * idle * side * 0.5);
  });

  // tail: a wave that travels down its bones, lifted while running
  const amp = P.tailA;
  const lift = -0.14 * gait - 0.05 * Math.sin(t * 1.3 + seed) * idle + 0.1 * lunge;
  q.tails.forEach((tail, k) => {
    const spread = k === 0 ? 0 : (k % 2 ? -1 : 1) * 0.12;
    tail.forEach((b, i) => {
      b.rotation.set(0, Math.sin(m.wavePhase - i * 0.9 + k * 1.7) * (0.1 + 0.07 * i) * amp * 1.35 + (i === 0 ? spread * 0.5 : 0), i === 0 ? lift : lift * 0.35);
    });
  });
  if (q.wings) poseWings(q.wings, m, P, state, t, phi, seed);

  // legs: swing about the shoulder / hip (kept absolute against the pitch of the body), the knee bending the
  // lower leg back and up, the paw rolling to stay under it
  const legAt = (ls, g, kn, front) => {
    const [u, l, p] = ls;
    if (!u) return;
    u.rotation.set(0, 0, g - (front ? pitchF : pitchB));
    if (front) {
      l.rotation.set(0, 0, -0.4 * kn);
      p.rotation.set(0, 0, -clamp(0.7 * (g - 0.4 * kn), -0.6, 0.6) - 0.45 * kn);
    } else {
      l.rotation.set(0, 0, -0.85 * kn);
      p.rotation.set(0, 0, clamp(-0.65 * (g - 0.85 * kn), -0.9, 1.0) + 0.45 * kn);
    }
  };
  legAt(q.legs.FR, P.gFR, P.kFR, true);
  legAt(q.legs.FL, P.gFL, P.kFL, true);
  legAt(q.legs.BR, P.gBR, P.kBR, false);
  legAt(q.legs.BL, P.gBL, P.kBL, false);
}
