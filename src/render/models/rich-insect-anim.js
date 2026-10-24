// Animation of the rich insects' skeletons: the scarab (rich-insect.js) and the scorpion man's lower body (rich-scorpion.js). Like the other
// creatures the pose keys of the low-poly rig (unit-anim.js, the 'insect' case: a stride `ga` and a lift for each of two sets of legs `la` and
// `lb`, a thrust of the sting `st`, a lunge `bX` and a pitch `bRz`) stay the source of truth; this file turns them into bone rotations and
// adds what a skeleton shows that rigid parts cannot: every leg bending as it steps, the antennae feeling, the mandibles opening and snapping
// shut, the abdomen swaying behind the legs, the tail curling and uncurling joint by joint. The scorpion man's person is posed as any
// rider is (rich-centaur-anim.js poseRider).
import { B } from './rich-kit.js';
import { strike } from './rich-anim.js';
import { rhythm, poseRider } from './rich-centaur-anim.js';
import { BEETLE_LEGS } from './rich-insect.js';
import { SCORPION_LEGS } from './rich-scorpion.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** The bones of a rig by role, looked up once (R.ix is the name -> index table of its spec). */
function bonesOf(R, names) {
  return names.map((n) => R.bones[R.ix[n]]);
}

/**
 * The legs of an insect, in pairs from the front: the bones of each (thigh, shin, foot), the side it is on (+1 the right) and the set it
 * steps with. The two sets alternate, so that two legs of one side never step together and the body is always held by one of each pair's
 * legs: the right front leg steps with the left second and the right third (and the left fourth).
 */
function legsOf(R, keys) {
  return keys.map((key, i) => {
    const pair = Math.floor(i / 2);
    const side = i % 2 === 0 ? 1 : -1;
    const [u, l, p] = bonesOf(R, [`${key}u`, `${key}l`, `${key}p`]);
    return { u, l, p, side, pair, set: (pair + (side < 0 ? 1 : 0)) % 2 };
  });
}

/**
 * Step the legs: a leg swings about the vertical at its hip (forward for the set whose lift is rising: `ga` is the stride in -1 .. 1, one set
 * going forward while the other goes back) and lifts when its set lifts (`la` for the first set, `lb` for the other, 0 .. 1), rolling up
 * about the body's axis with the knee folding. `o`: { swing, roll, flex } the size of each, in radians; `reach` and `raise` add to the
 * front pair (a strike: a leg thrust forward and held up). `curl` (0 .. 1) folds every leg up under the body.
 */
function stepLegs(legs, P, o, reach = 0, raise = 0, curl = 0) {
  for (const { u, l, p, side, pair, set } of legs) {
    const go = set === 0 ? P.ga : -P.ga;
    const lift = set === 0 ? P.la : P.lb;
    const front = pair === 0 ? 1 : 0;
    const swing = o.swing * go + o.swing * 1.3 * reach * front;
    const up = lift + raise * front;
    u.rotation.set(-side * (up * o.roll + curl * 0.9), side * swing, 0);
    l.rotation.set(side * (curl * 1.0 - up * o.flex), 0, 0);
    p.rotation.set(-side * (curl * 0.5 - up * o.flex * 0.6), 0, 0);
  }
}

// ---------------------------------------------------------------------------
// the scarab
// ---------------------------------------------------------------------------

function insectBones(R) {
  const [root, body, head, mandR, mandL, antR1, antR2, antL1, antL2] = bonesOf(R, ['root', 'body', 'head', 'mandR', 'mandL', 'antR1', 'antR2', 'antL1', 'antL2']);
  return { root, body, head, mand: [mandR, mandL], ant: [[antR1, antR2], [antL1, antL2]], legs: legsOf(R, BEETLE_LEGS) };
}

/**
 * Pose the skeleton of a scarab from its blended pose keys P: the legs in the tripod gait of the low-poly rig, the body bobbing as it walks
 * and lunging with the pose, the head looking about while it stands and rearing then snapping down in a bite with the mandibles spread
 * and shut, the antennae feeling ahead.
 */
export function applyInsect(m, R, P, state, t) {
  const q = R.q || (R.q = insectBones(R));
  const seed = m.seed;
  const moving = m.moving;
  const phi = m.walkPhase;
  const dead = state === 'dead';
  const attacking = state === 'attack';
  const k = strike(attacking ? m.ap : undefined, false);
  const lunge = k.h * (1 - k.r);
  const wind = k.w * (1 - k.h);
  const idle = !moving && !dead && !attacking ? 1 : 0;
  const breath = Math.sin(t * 1.7 + seed);

  // body: the lunge and the pitch of the pose, a small bob as it walks, a slow breath
  q.root.position.set(P.bX, moving ? 0.008 * Math.abs(Math.sin(phi * 2)) : 0.002 * breath * idle, 0);
  q.root.rotation.set(0, 0, P.bRz);

  // head: looks about while it stands, rears in the wind-up and snaps down with the blow; the mandibles open and shut
  const look = idle * 0.5 * Math.sin(t * 0.43 + seed * 3) * Math.sin(t * 0.97 + seed);
  q.head.rotation.set(0, look + 0.03 * Math.sin(phi) * (moving ? 1 : 0), 0.35 * wind - 0.5 * lunge + 0.02 * breath * idle);
  const open = dead ? 0.35 : 0.12 + 0.8 * wind + 0.06 * Math.sin(t * 2.6 + seed) * idle;
  q.mand[0].rotation.set(0, -open, 0);
  q.mand[1].rotation.set(0, open, 0);

  // antennae: feel ahead and about, swept back for the strike
  q.ant.forEach(([a1, a2], i) => {
    const side = i === 0 ? 1 : -1;
    const wave = Math.sin(t * 2.3 + seed * 2 + i * 1.7);
    a1.rotation.set(0, side * (0.12 + 0.35 * wind) + 0.1 * wave * (moving ? 1.5 : 1), 0.05 * Math.sin(t * 1.9 + seed + i));
    a2.rotation.set(0, side * 0.1 + 0.16 * Math.sin(t * 2.9 + seed * 3 + i * 2.1), 0.08 * wave);
  });

  stepLegs(q.legs, P, { swing: 0.6, roll: 0.2, flex: 0.12 }, lunge, 0.9 * wind, dead ? 1 : 0);
}

// ---------------------------------------------------------------------------
// the scorpion man
// ---------------------------------------------------------------------------

function scorpionBones(R) {
  const b = R.bones;
  const at = (name) => b[R.ix[name]];
  const palp = (side) => bonesOf(R, [`palp${side}1`, `palp${side}2`]);
  return {
    body: at('body'),
    meso: [at('meso1'), at('meso2')],
    tail: [1, 2, 3, 4, 5].map((i) => at(`tail${i}`)),
    palps: [palp('R'), palp('L')],
    legs: legsOf(R, SCORPION_LEGS),
    // what the left hand carries on a bone of its own (none for the scorpion man today; the pose is shared with the Dullahan's)
    carry: R.ix.carry === undefined ? null : b[R.ix.carry],
    // (the root stands where the model was settled, the pelvis hangs from the body bone, the arms hang at their rest x)
    root: b[B.root].position.clone(),
    pelvis: b[B.pelvis].position.clone(),
    upper: [b[B.upperR].position.x, b[B.upperL].position.x],
  };
}

/**
 * Pose the skeleton of a scorpion man from its blended pose keys P: the eight legs stepping in the alternating gait, the abdomen swaying
 * behind them, the tail's five joints curled over the back and swaying, then uncurling with the thrust of the sting (P.st), the pincers
 * held out in front and snapping; the person on the carapace as any person on a rig is (the lean and twist of the torso, the head
 * riding steady, the arms from the arm keys, the cape and the hair lagging behind).
 */
export function applyScorpion(m, R, P, state, t, dt) {
  const q = R.q || (R.q = scorpionBones(R));
  const b = R.bones;
  const r = rhythm(m, state, t);
  const { seed, phi, gait, s, lunge, wind, idle, breath, sway } = r;
  const dead = state === 'dead';
  const moving = r.moving;

  // body: bob and lunge on the root, the pitch of the pose; the whole trunk rocks a little with the steps
  b[B.root].position.set(q.root.x + P.bX, q.root.y + (moving ? 0.008 * Math.abs(Math.sin(phi * 2)) : 0.002 * breath * idle), q.root.z);
  b[B.root].rotation.set(0, 0, P.bRz);
  q.body.rotation.set(0.012 * sway * idle + 0.02 * Math.cos(phi) * gait, 0.025 * s * gait, 0);
  // the abdomen sways behind the legs, a wave that runs back along it
  q.meso[0].rotation.set(0, -0.05 * Math.sin(phi - 0.4) * gait + 0.012 * sway * idle, 0);
  q.meso[1].rotation.set(0, -0.08 * Math.sin(phi - 0.9) * gait + 0.02 * sway * idle, 0);

  // the tail: five joints curled over the back. The thrust of the sting (P.st, -0.3 in the wind-up to 1.1 at the blow) uncurls them,
  // the tip coming forward and down; it sways from side to side and bobs with the steps
  const st = clamp(P.st, -0.5, 1.2);
  const sw = 0.6 * Math.sin(t * 1.5 + seed);
  q.tail.forEach((bone, i) => {
    const w = i + 1;
    bone.rotation.set(
      0,
      0.035 * sw * (0.6 + 0.2 * i) + 0.03 * Math.sin(phi - i * 0.7) * gait,
      -st * (i === 0 ? 0.1 : 0.22) + 0.03 * Math.sin(t * 1.1 + seed + i * 0.5) * idle * (w / 5) + 0.025 * Math.sin(phi * 2 + i * 0.6) * gait + (dead ? 0.12 : 0),
    );
  });

  // the pincers: held out in front, clasping and opening a little as he stands, flung wide for the blow
  q.palps.forEach(([p1, p2], i) => {
    const side = i === 0 ? 1 : -1;
    const idleWave = Math.sin(t * 1.6 + seed * 2 + i * 2.2);
    p1.rotation.set(0, -side * (0.05 * idleWave * (1 - 0.5 * gait) + 0.3 * wind) + side * 0.04 * Math.sin(phi) * gait, 0.05 * idleWave + 0.1 * wind - 0.15 * lunge);
    p2.rotation.set(0, side * (0.1 + 0.08 * idleWave * idle - 0.25 * lunge), 0);
  });

  stepLegs(q.legs, P, { swing: 0.34, roll: 0.14, flex: 0.28 }, 0, 0, dead ? 1 : 0);

  // the person: stays on the carapace (it steps a little into the blow); the spine, the head, the arms, the cape and the hair as any rider's
  const pel = b[B.pelvis];
  pel.position.set(q.pelvis.x + 0.02 * lunge - 0.01 * wind, q.pelvis.y + 0.004 * breath * idle, q.pelvis.z);
  pel.rotation.set(0, 0, -0.6 * P.bRz);
  poseRider(m, q, b, P, state, t, dt, r, 0.03);
}
