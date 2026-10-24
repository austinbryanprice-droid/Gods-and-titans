// Animation of the rich battering ram's skeleton (rich-ram.js). Like the other creatures the pose key of the low-poly rig (unit-anim.js, the
// 'ram' case: `lx`, how far the log has slid along the frame: drawn back in the wind-up, thrust forward in the blow) and the wheels' turn
// (m.wheelAngle, which that case integrates from the speed) stay the source of truth; this file turns them into bone rotations and adds what
// a skeleton shows that rigid parts cannot: the log hanging from the ridge on its ropes, swinging on an arc (it rises as it swings out, and
// rocks on the bumps of the road), the frame bobbing on its axles, and a banner whose cloth ripples from the pole to the free end.
import { ROPE_LEN } from './rich-ram.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth01 = (x) => {
  const k = x < 0 ? 0 : x > 1 ? 1 : x;
  return k * k * (3 - 2 * k);
};

/** How far the pose's stroke of the log (in the low-poly rig's units of distance) is taken, so that the log's arc is as long as the old slide. */
const SWING = 0.8;

/** The bones of the ram by role, looked up once (R.ix is the name -> index table of its spec). */
function ramBones(R) {
  const b = (n) => R.bones[R.ix[n]];
  return {
    body: b('body'), log: b('log'), ropes: [b('ropeA'), b('ropeB')], axles: [b('axleF'), b('axleB')], flag: [b('flag1'), b('flag2'), b('flag3'), b('flag4')],
    bodyRest: b('body').position.clone(), logRest: b('log').position.clone(),
  };
}

/**
 * Pose the skeleton of a ram from its blended pose key P: the wheels turned to the angle the low-poly rig has rolled to, the frame bobbing
 * a little as it rolls, the log swinging on its ropes to the stroke the pose gives, the banner rippling.
 */
export function applyRam(m, R, P, state, t) {
  const q = R.q || (R.q = ramBones(R));
  const moving = m.moving;
  const wa = m.wheelAngle;
  const dead = state === 'dead';
  const bump = Math.sin(wa * 2);

  // the wheels turn with the road
  q.axles.forEach((a) => a.rotation.set(0, 0, wa));

  // the frame rides the axles: it rises a little with each turn of the wheels and rocks about them
  q.body.position.y = q.bodyRest.y + (moving ? 0.008 * Math.abs(bump) : 0);
  q.body.rotation.set(0, 0, moving ? 0.006 * Math.sin(wa * 2 + 0.6) : 0);

  // the log hangs from the ridge by ropes of one length, so it moves on a circle: the pose's stroke is how far along the frame it has gone,
  // the ropes swing back or forward to that, and the log rises as they leave the vertical. It rocks on the bumps, drifts a little when it stands,
  // and flies forward off its ropes when the ram is wrecked
  const sway = moving ? 0.035 * Math.sin(wa * 2 + 1.3) : 0.012 * Math.sin(t * 1.1 + m.seed);
  const slump = dead ? 0.55 * smooth01(m.deadTime / 0.5) : 0;
  const theta = Math.asin(clamp((SWING * P.lx) / ROPE_LEN, -0.95, 0.95)) + sway + slump;
  q.ropes.forEach((r) => r.rotation.set(0, 0, theta));
  q.log.position.set(q.logRest.x + ROPE_LEN * Math.sin(theta), q.logRest.y + ROPE_LEN * (1 - Math.cos(theta)), q.logRest.z);

  // the banner: a ripple that runs down the cloth from the pole, stronger while the ram rolls, slack when it is wrecked
  const amp = dead ? 0.15 : moving ? 1 : 0.55;
  q.flag.forEach((b, i) => {
    b.rotation.set(0, Math.sin(m.wavePhase - i * 0.9) * (0.12 + 0.025 * i) * amp, 0.02 * Math.sin(m.wavePhase * 0.5 - i * 0.7) * amp);
  });
}
