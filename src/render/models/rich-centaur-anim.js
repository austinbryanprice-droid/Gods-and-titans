// Animation of the rich centaurs' skeleton (rich-centaur.js). Two poses run on the one rig, both from the pose keys of the low-poly rig
// (unit-anim.js quadPose, which also writes the arm and torso keys of a centaur). The horse's is the quadruped plan's
// (rich-creature-anim.js applyQuadruped): body bob / pitch / roll, the barrel bending through its three bones so the hind legs stay
// planted while the front rises and falls, four legs swinging at the gallop, the tail's wave. The person's is the humanoid's
// (rich-anim.js applyRich): the torso leaning and twisting, the head riding steady, the arms from the arm keys, cloth and hair that
// lag behind. The person's pelvis hangs from the horse's withers: it turns back against the pitch and the sway of the horse's front,
// so the torso stays upright over a galloping horse.
import * as THREE from 'three';
import { B } from './rich-kit.js';
import { strike } from './rich-anim.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const _hand = new THREE.Quaternion();
const _up = new THREE.Quaternion();
const _e = new THREE.Euler();

/** The bones of a centaur by role, and the rest positions the pose is added to (read once, before the first pose). */
function centaurBones(R) {
  const b = R.bones;
  const at = (name) => b[R.ix[name]];
  const leg = (key) => [at(`${key}u`), at(`${key}l`), at(`${key}p`)];
  return {
    hips: at('hips'),
    back: at('back'),
    withers: at('withers'),
    tail: [1, 2, 3, 4].map((i) => at(`tail${i}`)),
    legs: { FR: leg('F1'), FL: leg('F-1'), BR: leg('B1'), BL: leg('B-1') },
    // what the left hand carries on a bone of its own (the Dullahan's head), if anything
    carry: R.ix.carry === undefined ? null : b[R.ix.carry],
    // (the root stands at the horse's middle, the pelvis hangs from the withers, the arms hang at their rest x)
    root: b[B.root].position.clone(),
    pelvis: b[B.pelvis].position.clone(),
    upper: [b[B.upperR].position.x, b[B.upperL].position.x],
  };
}

/** Pose the skeleton of m (a UnitModel with m.rich on the 'centaur' plan) from its blended pose keys P (applyCreature then syncs the skin). */
export function applyCentaur(m, R, P, state, t, dt) {
  const q = R.q || (R.q = centaurBones(R));
  const b = R.bones;
  const rig = m.rig;
  const seed = m.seed;
  const moving = m.moving;
  const phi = m.walkPhase;
  const gait = moving ? 1 : 0;
  const s = moving ? Math.sin(phi) : 0;
  const attacking = state === 'attack';
  const k = strike(attacking ? m.ap : undefined, rig.weapon === 'bow');
  const lunge = k.h * (1 - k.r);
  const wind = k.w * (1 - k.h);
  const idle = !moving && state !== 'dead' && !attacking ? 1 : 0;
  const breath = Math.sin(t * 1.7 + seed);
  const sway = Math.sin(t * 0.55 + seed * 1.7);
  const alpha = P.bRz;

  // the horse: bob and lunge on the root, a roll and a side shift while running; the pitch bends the barrel, so the hind legs stay
  // planted while the front rises and falls
  const root = b[B.root];
  root.position.set(q.root.x + P.bX, q.root.y + P.bY, q.root.z + 0.012 * s * gait);
  root.rotation.set(P.bRx + 0.02 * s * gait, 0, 0);
  q.hips.rotation.set(0, -0.05 * s * gait, 0.012 * breath * idle);
  q.back.rotation.set(0, 0.06 * s * gait, alpha * 0.45 - 0.02 * lunge + 0.01 * breath * idle);
  q.withers.rotation.set(0, 0.05 * s * gait, alpha * 0.55 + 0.03 * wind);
  const pitchB = q.hips.rotation.z;
  const pitchF = pitchB + q.back.rotation.z + q.withers.rotation.z;
  const yawF = q.hips.rotation.y + q.back.rotation.y + q.withers.rotation.y;

  // the tail: a wave that travels down its bones, lifted while running
  const lift = -0.14 * gait - 0.05 * Math.sin(t * 1.3 + seed) * idle + 0.1 * lunge;
  q.tail.forEach((bone, i) => {
    bone.rotation.set(0, Math.sin(m.wavePhase - i * 0.9) * (0.1 + 0.07 * i) * P.tailA * 1.35, i === 0 ? lift : lift * 0.35);
  });

  // the legs: swing about the shoulder / hip (kept absolute against the pitch of the body), the knee bending the lower leg back and up,
  // the hoof rolling to stay under it
  const legAt = ([u, l, p], g, kn, front) => {
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

  // the person: the pelvis turns back against the pitch and the sway of the horse's front (most of it: a rider is not nailed in
  // place), steps a little into the blow
  const pel = b[B.pelvis];
  pel.position.set(q.pelvis.x + 0.025 * lunge - 0.01 * wind, q.pelvis.y - 0.004 * lunge + 0.004 * breath * idle, q.pelvis.z + 0.006 * sway * idle);
  pel.rotation.set(0, -0.7 * yawF, -0.85 * pitchF);

  // the spine: the lean and twist of the torso (the pose's, and a rider's forward lean at the gallop) shared between two joints
  const lean = (rig.lean || 0) + P.tRz - 0.08 * gait + 0.04 * wind - 0.05 * lunge + 0.012 * breath * idle;
  const twist = P.tRy;
  const roll = P.tRx + 0.02 * sway * idle - 0.03 * s * gait;
  b[B.spine].rotation.set(roll * 0.4, twist * 0.35 + 0.05 * s * gait, lean * 0.42);
  b[B.chest].rotation.set(roll * 0.6, twist * 0.65 + 0.07 * s * gait, lean * 0.58);

  // neck and head: counter the lean so the eyes stay level, look around while standing, dip with a blow
  const look = idle * (0.4 * Math.sin(t * 0.37 + seed * 3) * Math.sin(t * 0.91 + seed) + 0.2 * Math.sin(t * 0.23 + seed * 5));
  const nod = 0.03 * Math.sin(phi * 2 + 0.6) * gait + 0.012 * breath * idle + 0.25 * P.hRz;
  b[B.neck].rotation.set(0, look * 0.45 - twist * 0.25, -lean * 0.3 + nod * 0.5);
  b[B.head].rotation.set(0.02 * sway * idle, look * 0.55 - twist * 0.3, -lean * 0.32 + nod * 0.5);

  // arms
  const ur = b[B.upperR];
  const ul = b[B.upperL];
  ur.rotation.set(P.aRx, 0, P.aRz);
  ul.rotation.set(P.aLx, 0, P.aLz);
  ur.position.x = q.upper[0] + P.aRp;
  ul.position.x = q.upper[1] + P.aLp;
  b[B.foreR].rotation.set(0, 0, clamp(P.aRe, 0, 2.2));
  b[B.foreL].rotation.set(0, 0, clamp(P.aLe, 0, 2.2));
  const flickR = (attacking ? k.h * (1 - k.r) * 0.5 - k.w * (1 - k.h) * 0.35 : 0) + 0.04 * Math.sin(t * 1.4 + seed) * idle;
  b[B.handR].rotation.set(0, 0, flickR);
  b[B.handL].rotation.set(0, 0, 0.03 * Math.sin(t * 1.2 + seed * 2) * idle);

  // what he carries on his palm stays upright and faces ahead whatever his arm does (his wrist takes the arm's turn off it), swinging a
  // little from the hand
  if (q.carry) {
    b[B.handL].getWorldQuaternion(_hand);
    _up.setFromEuler(_e.set(0.05 * Math.sin(t * 1.3 + seed) + 0.03 * s, 0, 0.06 * Math.sin(t * 1.1 + seed * 2) - 0.05 * gait));
    q.carry.quaternion.copy(_hand).invert().multiply(_up);
  }

  // cloth and hair: the cape hangs from the shoulders and streams behind the gallop; hair swings behind the head
  const to = moving ? 0.55 : 0.1;
  const fl = (m.capeFl = (m.capeFl ?? 0.1) + (to - (m.capeFl ?? 0.1)) * (dt > 0 ? Math.min(1, dt * 5) : 1));
  const wave = (i) => Math.sin(phi * 2 - i * 0.9) * 0.09 * gait + Math.sin(t * 1.3 + seed - i * 0.8) * 0.035;
  const drag = -0.5 * fl - 0.25 * lean;
  b[B.cape1].rotation.set(0.03 * Math.sin(t * 0.9 + seed), 0, drag * 0.55 + wave(0) * 0.4);
  b[B.cape2].rotation.set(0.05 * Math.sin(t * 1.1 + seed + 1), 0, drag * 0.4 + wave(1));
  b[B.cape3].rotation.set(0.07 * Math.sin(t * 1.3 + seed + 2), 0, drag * 0.35 + wave(2));
  b[B.hair1].rotation.set(0, 0, -0.1 - 0.35 * fl + 0.05 * Math.sin(phi * 2 + 0.5) * gait - lean * 0.2);
  b[B.hair2].rotation.set(0, 0, -0.08 - 0.3 * fl + 0.09 * Math.sin(phi * 2 - 0.4) * gait + 0.03 * Math.sin(t * 1.5 + seed));
}
