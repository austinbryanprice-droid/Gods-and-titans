// Animation of the rich elephant's skeleton (rich-elephant.js). Two poses run on the one rig, both from the pose keys of the low-poly rig
// (unit-anim.js quadPose, which also writes the arm and torso keys of a rider). The elephant's is the quadruped plan's (rich-creature-anim.js
// applyQuadruped) as an animal of its weight keeps it: a slow four-beat walk on pillar legs that bend little, the barrel rocking and bending
// through its three bones, three heads that each look about on a phase of their own, trunks that swing in time with the steps, curl up to
// trumpet in the wind-up of a blow and come down with it, ears that flap, a rope of a tail that swishes. The person's is the humanoid's
// (rich-anim.js applyRich) as the centaur's is (rich-centaur-anim.js poseRider): the torso leaning and twisting, the head riding steady, the
// arms from the arm keys, cloth and hair that lag behind. The person's pelvis hangs from the back's middle bone, which carries the howdah:
// it turns back against the pitch of the body so that he sits upright over it.
import { B } from './rich-kit.js';
import { rhythm, poseRider } from './rich-centaur-anim.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** How much of the trunk's curl each of its five bones takes (the tip's the most). */
const CURL = [0.12, 0.17, 0.22, 0.27, 0.32];

/** The bones of an elephant by role, and the rest positions the pose is added to (read once, before the first pose). */
function elephantBones(R) {
  const b = R.bones;
  const at = (name) => b[R.ix[name]];
  const leg = (key) => [at(`${key}u`), at(`${key}l`), at(`${key}p`)];
  const heads = [];
  for (let i = 0; R.ix[`h${i}`] !== undefined; i++) {
    heads.push({ head: at(`h${i}`), trunk: [1, 2, 3, 4, 5].map((j) => at(`h${i}t${j}`)), ears: [at(`h${i}eR`), at(`h${i}eL`)] });
  }
  return {
    hips: at('hips'),
    back: at('back'),
    withers: at('withers'),
    tail: [1, 2, 3, 4].map((i) => at(`tail${i}`)),
    legs: { FR: leg('F1'), FL: leg('F-1'), BR: leg('B1'), BL: leg('B-1') },
    heads,
    carry: null,
    // (the root stands at the elephant's middle, the pelvis hangs from the back, the arms hang at their rest x)
    root: b[B.root].position.clone(),
    pelvis: b[B.pelvis].position.clone(),
    upper: [b[B.upperR].position.x, b[B.upperL].position.x],
  };
}

/** Pose the skeleton of m (a UnitModel with m.rich on the 'elephant' plan) from its blended pose keys P (applyCreature then syncs the skin). */
export function applyElephant(m, R, P, state, t, dt) {
  const q = R.q || (R.q = elephantBones(R));
  const b = R.bones;
  const r = rhythm(m, state, t);
  const { seed, phi, gait, s, lunge, wind, idle, breath, sway, moving } = r;
  const dead = state === 'dead';
  const alpha = P.bRz;

  // the body: bob and lunge on the root, a slow roll from side to side as the weight goes from leg to leg; the pitch bends the barrel through
  // its three bones, so the hind legs stay planted while the front rises and falls
  b[B.root].position.set(q.root.x + P.bX, q.root.y + P.bY, q.root.z + 0.01 * s * gait);
  b[B.root].rotation.set(P.bRx + 0.02 * s * gait, 0, 0);
  q.hips.rotation.set(0, -0.04 * s * gait, 0.01 * breath * idle);
  q.back.rotation.set(0, 0.05 * s * gait, alpha * 0.45 - 0.02 * lunge + 0.008 * breath * idle);
  q.withers.rotation.set(0, 0.04 * s * gait, alpha * 0.55 + 0.03 * wind);
  const pitchB = q.hips.rotation.z;
  const pitchF = pitchB + q.back.rotation.z + q.withers.rotation.z;
  const pitchM = pitchB + q.back.rotation.z;
  const yawM = q.hips.rotation.y + q.back.rotation.y;

  // the tail: a swish that travels down its bones, a little livelier while walking
  const lift = -0.06 * gait + 0.05 * lunge;
  q.tail.forEach((bone, i) => {
    bone.rotation.set(0, Math.sin(m.wavePhase * 0.8 - i * 0.9) * (0.12 + 0.08 * i) * P.tailA, i === 0 ? lift : lift * 0.3);
  });

  // the legs: pillars that swing about the hip and the shoulder (kept absolute against the pitch of the body), the lower leg folding back
  // a little as it comes forward, the foot rolling to stay flat under it
  const reach = 1 + 0.3 * gait;
  const legAt = ([u, l, p], g, kn, front) => {
    const sw = g * reach;
    const bend = (front ? 0.5 : 0.6) * kn;
    u.rotation.set(0, 0, sw - (front ? pitchF : pitchB));
    l.rotation.set(0, 0, -bend);
    p.rotation.set(0, 0, -clamp(0.8 * (sw - bend), -0.6, 0.6) - 0.06 * kn);
  };
  legAt(q.legs.FR, P.gFR, P.kFR, true);
  legAt(q.legs.FL, P.gFL, P.kFL, true);
  legAt(q.legs.BR, P.gBR, P.kBR, false);
  legAt(q.legs.BL, P.gBL, P.kBL, false);

  // the heads: each on a phase of its own, looking about while the elephant stands, the pose's pitch and yaw (the heads rear in the wind-up
  // of a blow and come down with it) over the pitch of the body's front half cancelled so that the eyes stay level
  const hz = P.hRz;
  q.heads.forEach((h, i) => {
    const ph = seed * 2 + i * 2.3;
    const look = idle * (0.5 * Math.sin(t * 0.37 + ph * 3) * Math.sin(t * 0.91 + ph) + 0.2 * Math.sin(t * 0.23 + ph * 5));
    const nod = 0.03 * Math.sin(phi * 2 + 0.6 + i) * gait + 0.012 * breath * idle;
    h.head.rotation.set(0, (P.hRy + look) * (i ? 0.6 : 0.45), hz * (i ? 1.3 : 1.5) - 0.7 * pitchF + nod);
    // the trunk: swings in time with the steps, wanders as the elephant stands, curls up in the wind-up and comes down with the blow
    const curl = 0.95 * wind - 0.25 * lunge + 0.06 * Math.sin(t * 0.9 + ph) * idle + (dead ? -0.1 : 0);
    h.trunk.forEach((bone, k) => {
      const w = k + 1;
      const wander = Math.sin(t * 0.8 + ph - k * 0.8) * (0.03 + 0.02 * k) * (0.4 + idle);
      const step = Math.sin(phi + ph * 0.3 - k * 0.7) * gait * (0.03 + 0.012 * k);
      bone.rotation.set(
        0.02 * Math.sin(t * 0.6 + ph + k) * w * idle,
        0.6 * wander + 0.012 * Math.sin(t * 1.3 + ph * 2 - k) * w * idle,
        curl * CURL[k] + wander * 0.6 + step,
      );
    });
    // the ears: a slow flap standing, a quicker one walking, flared forward for the blow, laid back when it falls
    const flap = (moving ? 0.34 : 0.22) * Math.sin(t * (moving ? 4.2 : 2.2) + ph) + 0.22 + 0.45 * (wind + lunge) - (dead ? 0.35 : 0);
    h.ears[0].rotation.set(0, flap, 0);
    h.ears[1].rotation.set(0, -flap, 0);
  });

  // the person: the pelvis turns back against the pitch and the sway of the body under the howdah (most of it: a rider is not nailed in
  // place), steps a little into the blow
  const pel = b[B.pelvis];
  pel.position.set(q.pelvis.x + 0.02 * lunge - 0.008 * wind, q.pelvis.y - 0.003 * lunge + 0.003 * breath * idle, q.pelvis.z + 0.005 * sway * idle);
  pel.rotation.set(0, -0.7 * yawM, -0.85 * pitchM);

  // the rider: the torso, the head, the arms, what he carries, the cape and the hair (a rider leans a little into the walk)
  poseRider(m, q, b, P, state, t, dt, r, 0.03);
}
