// Animation of the rich humanoid's skeleton. The low-poly rig's pose keys (unit-anim.js
// humanoidPose: arm swing / roll / elbow, leg swing / knee, torso lean / twist, pelvis bob,
// cape) stay the source of truth; this file turns them into bone rotations and adds what a
// skeleton can show that rigid parts cannot: the spine bending through its length, the
// head riding steady above a leaning body, feet rolling flat, weight shifting, breathing,
// the strike's wind-up and lunge, and cloth and hair that lag and swing after the body.
import * as THREE from 'three';
import { B, syncRich } from './rich-kit.js';

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
const AX_Z = new THREE.Vector3(0, 0, 1);

/** Wind-up / strike / recover envelopes of an attack phase 0..1 (all zero without one), written into the shared K. */
function strike(ap, bow) {
  if (ap === undefined || ap === null) {
    K.w = K.h = K.r = 0;
    return K;
  }
  const w0 = bow ? 0.15 : 0.3;
  const s0 = bow ? 0.3 : 0.5;
  K.w = ap < w0 ? smooth01(ap / w0) : 1;
  K.h = ap < w0 ? 0 : ap < s0 ? smooth01((ap - w0) / (s0 - w0)) : 1;
  K.r = ap < s0 ? 0 : smooth01((ap - s0) / (1 - s0));
  return K;
}

/**
 * Pose the skeleton of m (a UnitModel with m.rich) from its blended pose keys P.
 * @param {object} m the model
 * @param {object} P m.cur
 * @param {string} state idle|move|attack|gather|return|build|pray|cast|dead
 * @param {number} t seconds
 * @param {number} dt seconds since the last call
 */
export function applyRich(m, P, state, t, dt) {
  const R = m.rich;
  const b = R.bones;
  const rig = m.rig;
  const seed = m.seed;
  const moving = m.moving;
  const phi = m.walkPhase;
  const s = moving ? Math.sin(phi) : 0;
  const c = moving ? Math.cos(phi) : 0;
  const heavy = rig.heavy;
  const gait = moving ? 1 : 0;
  const attacking = state === 'attack';
  const k = strike(attacking ? m.ap : undefined, rig.weapon === 'bow');
  const lunge = k.h * (1 - k.r);
  const windBack = k.w * (1 - k.h);
  const breath = Math.sin(t * 1.8 + seed);
  const sway = Math.sin(t * 0.55 + seed * 1.7);
  const idle = !moving && state !== 'pray' && state !== 'dead' && !attacking ? 1 : 0;

  // pelvis: bounce and forward shift from the pose, a side to side weight shift while walking
  // and a slow rock while standing, a step into the blow
  const pel = b[B.pelvis];
  pel.position.set(P.pX + 0.035 * lunge * (rig.heavy ? 1.5 : 1) - 0.012 * windBack, rig.hipY + P.pY - 0.006 * lunge, (heavy ? 0.022 : 0.012) * s * gait + 0.006 * sway * idle);
  pel.rotation.set(0.05 * c * gait * (heavy ? 1.5 : 1) + 0.012 * sway * idle, -0.1 * s * gait, 0);

  // spine: the lean and twist of the torso are shared between two joints, so it bends
  const lean = (rig.lean || 0) + P.tRz - 0.1 * windBack + 0.16 * lunge + 0.012 * breath * idle;
  const twist = P.tRy;
  const roll = P.tRx + 0.02 * sway * idle - 0.03 * s * gait;
  b[B.spine].rotation.set(roll * 0.4, twist * 0.35 + 0.05 * s * gait, lean * 0.42);
  b[B.chest].rotation.set(roll * 0.6, twist * 0.65 + 0.07 * s * gait, lean * 0.58);

  // neck and head: counter the lean so the eyes stay level, look around while standing, set the chin to the work
  const look = idle * (0.4 * Math.sin(t * 0.37 + seed * 3) * Math.sin(t * 0.91 + seed) + 0.2 * Math.sin(t * 0.23 + seed * 5));
  const nod = 0.03 * Math.sin(phi * 2 + 0.6) * gait + 0.012 * breath * idle;
  const down = state === 'pray' ? 0.15 + 0.2 * Math.sin(t * 2.4 + seed) : state === 'gather' || state === 'build' ? 0.18 : 0;
  b[B.neck].rotation.set(0, look * 0.45 - twist * 0.25, -lean * 0.3 + nod * 0.5 + down * 0.4);
  b[B.head].rotation.set(0.02 * sway * idle, look * 0.55 - twist * 0.3, -lean * 0.32 + nod * 0.5 + down * 0.6);

  // arms
  const ur = b[B.upperR];
  const ul = b[B.upperL];
  ur.rotation.set(P.aRx, 0, P.aRz);
  ul.rotation.set(P.aLx, 0, P.aLz);
  ur.position.x = R.restUpper[0] + P.aRp;
  ul.position.x = R.restUpper[1] + P.aLp;
  b[B.foreR].rotation.set(0, 0, clamp(P.aRe, 0, 2.2));
  b[B.foreL].rotation.set(0, 0, clamp(P.aLe, 0, 2.2));
  // hands follow through a little: the wrist flicks after the forearm
  const flickR = (attacking ? (k.h * (1 - k.r) * 0.5 - k.w * (1 - k.h) * 0.35) : 0) + 0.04 * Math.sin(t * 1.4 + seed) * idle;
  b[B.handR].rotation.set(0, 0, flickR);
  b[B.handL].rotation.set(0, 0, 0.03 * Math.sin(t * 1.2 + seed * 2) * idle);

  // legs: hip swing and knee bend from the pose; the foot keeps flat on the ground under them
  b[B.thighR].rotation.set(0, 0, P.lRz);
  b[B.thighL].rotation.set(0, 0, P.lLz);
  b[B.shinR].rotation.set(0, 0, -P.lRk);
  b[B.shinL].rotation.set(0, 0, -P.lLk);
  b[B.footR].rotation.set(0, 0, clamp(-(P.lRz - P.lRk) * 0.9, -0.7, 0.7));
  b[B.footL].rotation.set(0, 0, clamp(-(P.lLz - P.lLk) * 0.9, -0.7, 0.7));

  // cloth: the cape hangs from the shoulders and trails behind the body; hair swings behind the head
  const fl = P.cape; // 0.05 standing .. 0.55 walking
  const wave = (i) => Math.sin(phi * 2 - i * 0.9) * 0.09 * gait + Math.sin(t * 1.3 + seed - i * 0.8) * 0.035;
  const drag = -0.5 * fl - 0.25 * lean;
  b[B.cape1].rotation.set(0.03 * Math.sin(t * 0.9 + seed), 0, drag * 0.55 + wave(0) * 0.4);
  b[B.cape2].rotation.set(0.05 * Math.sin(t * 1.1 + seed + 1), 0, drag * 0.4 + wave(1));
  b[B.cape3].rotation.set(0.07 * Math.sin(t * 1.3 + seed + 2), 0, drag * 0.35 + wave(2));
  b[B.hair1].rotation.set(0, 0, -0.1 - 0.35 * fl + 0.05 * Math.sin(phi * 2 + 0.5) * gait - lean * 0.2);
  b[B.hair2].rotation.set(0, 0, -0.08 - 0.3 * fl + 0.09 * Math.sin(phi * 2 - 0.4) * gait + 0.03 * Math.sin(t * 1.5 + seed));

  if (b.length > B.wingR1) poseWings(m, b, P, state, t, phi, seed);

  // the bones are outside the scene graph: bring their matrices, the skin and the riding pieces up to date once, here
  syncRich(R);
}

/**
 * Wings (winged units only, bones past the 23 of the body): rigid feather sheets on two bones a
 * side. A grounded unit standing about folds them down its back (P.fold, which the pose blend
 * eases in and out); they breathe a little at rest, hang half open walking, spread to cast, and
 * beat in the air, the outer bone trailing the inner one. The right wing spans +Z, the left is
 * its mirror: the same flap, sweep and roll with the signs that mirror them.
 */
function poseWings(m, b, P, state, t, phi, seed) {
  const air = m.air;
  const fold = P.fold || 0;
  const rate = m.moving ? 8.5 : 5;
  let flap;
  let lag;
  if (air) {
    flap = 0.15 + 0.7 * Math.sin(t * rate + seed);
    lag = 0.1 + 0.55 * Math.sin(t * rate + seed - 0.9);
  } else if (state === 'cast') {
    flap = 0.45 + 0.1 * Math.sin(t * 6);
    lag = 0.35 + 0.12 * Math.sin(t * 6 - 0.7);
  } else if (m.moving) {
    flap = -0.2 + 0.25 * Math.sin(phi * 2);
    lag = -0.15 + 0.2 * Math.sin(phi * 2 - 0.8);
  } else {
    flap = -0.3 + 0.06 * Math.sin(t * 1.4 + seed);
    lag = -0.25 + 0.05 * Math.sin(t * 1.4 + seed - 0.6);
  }
  // folded: swept back along the body, rolled so the feathers hang, drooping at the tip;
  // open: spread, a little swept (flap about the forward axis, sweep about the vertical one)
  const sweep1 = 0.1 + fold * 1.15;
  const roll1 = fold * 1.15;
  const droop = fold * 0.42;
  const sweep2 = 0.12 + fold * 0.1;
  const a1 = flap * (1 - fold) - 0.1 * fold;
  const a2 = (lag - flap) * (1 - fold * 0.8);
  for (const side of [1, -1]) {
    const w1 = b[side > 0 ? B.wingR1 : B.wingL1];
    const w2 = b[side > 0 ? B.wingR2 : B.wingL2];
    // roll about the span first, then flap, sweep back, and droop (the last about the lateral axis)
    _q.setFromAxisAngle(AX_Z, droop);
    _r.setFromAxisAngle(AX_Y, -side * sweep1);
    _q.multiply(_r);
    _r.setFromAxisAngle(AX_X, -side * a1);
    _q.multiply(_r);
    _r.setFromAxisAngle(AX_Z, roll1);
    w1.quaternion.copy(_q.multiply(_r));
    w2.rotation.set(-side * a2, -side * sweep2, 0);
  }
}
