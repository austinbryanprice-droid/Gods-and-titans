// The rich battering ram (High and Ultra): the siege engine every pantheon trains, drawn as one smooth skinned mesh in place of the rigid
// low-poly parts. A frame of squared timbers on two axles of spoked wheels, a gabled roof of stitched hides in the team's color stretched over
// battens, and under it a log of bark hung from the ridge on ropes with an iron ram's head on its end; a banner at the rear. The bones: the
// frame (`body`), the log (`log`, which the ropes swing), the two ropes' pivots (`ropeA`, `ropeB`), one bone for each axle (it turns the
// wheels) and four for the flag. The pose key of the low-poly rig (unit-anim.js, the 'ram' case: the log's stroke `lx`) stays the source of
// truth, and so does the turn of the wheels (m.wheelAngle); rich-ram-anim.js turns them into bone rotations. All ten pantheons share the
// body and dress it in their own colors only, as the low-poly ram is.
import { shadeC, withMat, TEAM } from './unit-geo.js';
import { MeshKit, ps, rigid, alongPath, smoothstep } from './rich-kit.js';
import { creatureSpec } from './rich-creature-kit.js';
import { mul, tint, dye, hash } from './rich-paint.js';
import { grain, run, timber, lathe, wheel, ramHead, hideRoof, hemRoll, flagCloth } from './rich-ram-parts.js';

const TAU = Math.PI * 2;

/** The wheels' radius: the low-poly ram's (its turn is read from the speed over this). */
export const WHEEL_R = 0.14;
const AXLE_X = 0.36;
const WHEEL_Z = 0.3;
export const SILL_Y = 0.178;
const SILL_Z = 0.24;
export const RIDGE_Y = 0.748;
const FRAME_X = 0.38;
/** The end frames' posts: how far from the middle they stand at the sill and at the ridge, and the height of the tie across them. */
export const POST_Z = [0.24, 0.05];
export const TIE_Y = 0.66;
/** The log's axis, and where the two pairs of ropes hold it (along it). */
export const LOG_Y = 0.38;
const ROPE_X = [-0.25, 0.2];
/** The ropes hang from the ridge at PIVOT_Y and hold the log by eyes on its bands at EYE_Y: ROPE_LEN is how far the log swings from. */
const PIVOT_Y = 0.735;
const EYE_Y = 0.455;
export const ROPE_LEN = PIVOT_Y - EYE_Y;
const POLE_X = -0.42;
const FLAG_Y = 1.12;
/** The battens across the roof, along its length. */
const BATTENS = [-0.39, -0.13, 0.13, 0.39];
const ROOF = { x0: -0.47, x1: 0.47, ridge: [0.77, 0.01], eave: [0.46, 0.288] };

/** Which units this plan builds: the battering ram, with no head, gear or extras of any kind. */
export function ramSupported(v) {
  if (v.body !== 'ram') return false;
  if ((v.head || 'none') !== 'none' || (v.heads || 1) !== 1 || (v.headgear || 'none') !== 'none') return false;
  if ((v.weapon || 'none') !== 'none' || (v.offhand || 'none') !== 'none') return false;
  return (v.extras || []).length === 0;
}

/** The ram's bones: [name, parent, rest position]. */
function skeleton() {
  return creatureSpec([
    ['root', null, [0, 0, 0]],
    ['body', 'root', [0, SILL_Y, 0]],
    ['log', 'body', [0, LOG_Y, 0]],
    ['ropeA', 'body', [ROPE_X[0], PIVOT_Y, 0]],
    ['ropeB', 'body', [ROPE_X[1], PIVOT_Y, 0]],
    ['axleF', 'root', [AXLE_X, WHEEL_R, 0]],
    ['axleB', 'root', [-AXLE_X, WHEEL_R, 0]],
    ['flag1', 'body', [POLE_X + 0.012, FLAG_Y, 0]],
    ['flag2', 'flag1', [POLE_X + 0.092, FLAG_Y, 0]],
    ['flag3', 'flag2', [POLE_X + 0.172, FLAG_Y, 0]],
    ['flag4', 'flag3', [POLE_X + 0.252, FLAG_Y, 0]],
  ]);
}

/** A point on a roof panel's base plane: `v` from the ridge (0) to the eave (1), at x, lifted `up` along its normal. */
function roofPoint(side, v, x, up = 0) {
  const { ridge, eave } = ROOF;
  const dy = eave[0] - ridge[0];
  const dz = (eave[1] - ridge[1]) * side;
  const len = Math.hypot(dy, dz);
  const n = [0, Math.abs(dz) / len, (side * Math.abs(dy)) / len];
  return [x, ridge[0] + dy * v + n[1] * up, ridge[1] * side + dz * v + n[2] * up];
}

/** The rich template of the battering ram: { kind, rich: { spec, geo, attach, ... }, rig, parts: [] }. */
export function buildRamTemplate(unitType, ctx) {
  const { pal } = ctx;
  const spec = skeleton();
  const ix = spec.ix;
  const kit = new MeshKit(spec, { sides: 12, rings: 1 });

  const wood = withMat(pal.primary, 'wood');
  const dark = withMat(pal.secondary, 'wood');
  const metal = pal.accentMetal;
  const iron = withMat('#3a3a3a', 'iron');
  const barkC = withMat('#6b4a2a', 'wood');
  const wheelC = withMat('#5a3e24', 'wood');
  const hemp = withMat('#b59a68', 'cloth');
  const body = rigid(ix.body);
  const logB = rigid(ix.log);

  // the sills: two long timbers, their ends curving up like a runner's
  for (const side of [1, -1]) {
    const st = [];
    for (let i = 0; i <= 6; i++) {
      const x = -0.53 + (1.06 * i) / 6;
      st.push(ps(x, SILL_Y + 0.03 * smoothstep(0.3, 0.53, Math.abs(x)), SILL_Z * side, 0.039, 0.036, 5));
    }
    kit.loft(st, { ref: [0, 1, 0], sides: 10, start: 'round', end: 'round', capRings: 1, capDepth: 0.03, color: wood, mat: 'wood', bind: body, paint: grain() });
  }
  // the cross beams that bind them (the two at the ends carry the posts)
  for (const x of [0.4, 0.13, -0.13, -0.4]) {
    const heavy = Math.abs(x) > 0.3;
    timber(kit, [x, SILL_Y + 0.064, -0.275], [x, SILL_Y + 0.064, 0.275], heavy ? 0.036 : 0.026, 0.028, { color: dark, bind: body });
  }

  // the two A-frames at the ends: a pair of leaning posts and the tie between them, under the ridge (they stand wide enough at the height of the
  // log for its horned head to be drawn back through the frame, and the tie is above the arc the log swings on)
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      timber(kit, [sx * FRAME_X, SILL_Y + 0.07, sz * POST_Z[0]], [sx * FRAME_X, RIDGE_Y - 0.02, sz * POST_Z[1]], 0.027, 0.031, {
        up: [1, 0, 0], h0: 0.033, w0: 0.03, h1: 0.026, w1: 0.023, color: dark, bind: body,
      });
    }
    const tieZ = POST_Z[0] + ((POST_Z[1] - POST_Z[0]) * (TIE_Y - (SILL_Y + 0.07))) / (RIDGE_Y - 0.02 - (SILL_Y + 0.07));
    timber(kit, [sx * FRAME_X, TIE_Y, -tieZ], [sx * FRAME_X, TIE_Y, tieZ], 0.02, 0.022, { up: [1, 0, 0], color: dark, bind: body });
  }
  // the ridge pole, and a band of iron over it at each frame
  kit.loft(run([-0.48, RIDGE_Y, 0], [0.48, RIDGE_Y, 0], 6, 0.034, 0.034, 0.034, 0.034, 2.4), {
    ref: [0, 1, 0], sides: 12, start: 'round', end: 'round', capRings: 2, capDepth: 0.025, color: dark, mat: 'wood', bind: body, paint: grain(0.1, 90),
  });
  for (const x of [-FRAME_X, FRAME_X]) {
    lathe(kit, { at: [x, RIDGE_Y, 0], axis: 'x', sides: 12, closed: true, profile: [[-0.014, 0.041], [0.014, 0.041], [0.014, 0.03], [-0.014, 0.03]], color: iron, mat: 'iron', bind: body });
  }

  // the roof: stitched hides in the team's color, stretched over battens
  const hidePaint = (side) => (o, x, y, z, u, a) => {
    let bay = -1;
    for (let i = 0; i + 1 < BATTENS.length; i++) if (x >= BATTENS[i] - 1e-6 && x <= BATTENS[i + 1] + 1e-6) bay = i;
    mul(o, 0.94 + 0.12 * hash(bay + 3, side, 1)); // hide by hide, each a little different
    mul(o, 1 + 0.05 * (Math.sin(x * 11 + a * 5 + side * 2) * 0.5 + Math.sin(x * 23 - a * 9 + 1.7) * 0.3 + Math.sin(a * 17 + x * 5) * 0.2)); // the mottle of a hide
    mul(o, 0.93 + 0.14 * Math.sin(Math.PI * smoothstep(0, 1, a))); // a hide stretched tight is darkest where it curls under the ridge and the hem
    for (const b of BATTENS) mul(o, 1 - 0.22 * Math.max(0, 1 - Math.abs(x - b) / 0.03)); // the creases where they meet at the battens
    dye(o, pal.accent, 0.9 * smoothstep(0.82, 0.96, a)); // a trim in the pantheon's color along the hem
    mul(o, 1 - 0.18 * (1 - smoothstep(0, 0.14, a))); // and the join under the ridge
  };
  for (const side of [1, -1]) {
    const surface = hideRoof(kit, {
      side, ...ROOF, battens: BATTENS, color: TEAM(0.88, 'leather'), inner: shadeC(pal.secondary, 0.7), bind: body, nu: 16, nv: 8, pillow: 0.03, scallop: 0.03, paint: hidePaint(side),
    });
    hemRoll(kit, { surface, count: 20, r: 0.0085, color: shadeC(pal.secondary, 0.85), bind: body });
    for (const x of BATTENS) {
      const a = roofPoint(side, -0.03, x, 0.01);
      const b = roofPoint(side, 1.07, x, 0.01);
      timber(kit, a, b, 0.014, 0.011, { up: [0, 0.687, side * 0.728], n: 4, sides: 8, color: dark, bind: body });
    }
    // the rake boards at the gable ends
    for (const x of [ROOF.x0 + 0.005, ROOF.x1 - 0.005]) {
      timber(kit, roofPoint(side, 0, x, 0.012), roofPoint(side, 1.04, x, 0.012), 0.012, 0.016, { up: [0, 0.687, side * 0.728], n: 4, sides: 8, color: dark, bind: body });
    }
  }

  // wheels on two axles, the axles on bones of their own
  for (const [bone, x] of [[ix.axleF, AXLE_X], [ix.axleB, -AXLE_X]]) {
    const axle = rigid(bone);
    kit.loft(run([x, WHEEL_R, -0.34], [x, WHEEL_R, 0.34], 2, 0.022, 0.022, 0.022, 0.022), {
      ref: [0, 1, 0], sides: 8, start: 'flat', end: 'flat', color: dark, mat: 'wood', bind: axle, paint: grain(),
    });
    for (const side of [1, -1]) wheel(kit, { at: [x, WHEEL_R, side * WHEEL_Z], side, r: WHEEL_R, bone: axle, wood: wheelC, iron, metal });
  }

  // the log, with bands of iron and the eyes the ropes hold it by
  const endGrain = { r: 0.84, g: 0.7, b: 0.5 };
  const bark = (o, x, y, z, u, a) => {
    mul(o, 0.84 + 0.16 * Math.abs(Math.sin(a * TAU * 6 + Math.sin(x * 9) * 1.4)));
    if (hash(Math.round(x * 14), Math.round(a * 8), 5) > 0.93) mul(o, 0.72);
    if (x < -0.545) {
      // the butt: pale wood with its rings
      tint(o, endGrain, 0.55);
      mul(o, 0.9 + 0.1 * Math.sin(Math.hypot(y - LOG_Y, z) * 240));
    }
  };
  kit.loft([
    ps(-0.56, LOG_Y, 0, 0.066, 0.066), ps(-0.5, LOG_Y, 0, 0.073, 0.073), ps(-0.3, LOG_Y, 0, 0.077, 0.077),
    ps(0.0, LOG_Y, 0, 0.078, 0.078), ps(0.28, LOG_Y, 0, 0.077, 0.077), ps(0.4, LOG_Y, 0, 0.074, 0.074),
  ], { ref: [0, 1, 0], rings: 14, sides: 14, start: 'round', end: null, capRings: 4, capDepth: 0.014, color: barkC, mat: 'wood', bind: logB, paint: bark });
  for (const x of [-0.53, ROPE_X[0], ROPE_X[1], 0.3]) {
    lathe(kit, { at: [x, LOG_Y, 0], axis: 'x', sides: 12, closed: true, profile: [[-0.013, 0.085], [0.013, 0.085], [0.013, 0.071], [-0.013, 0.071]], color: iron, mat: 'iron', bind: logB });
  }
  ramHead(kit, { at: [0.36, LOG_Y, 0], color: metal, bind: logB });

  // the ropes: a V of two from the ridge to the eyes on each of the two bands (the V swings as one, hung from the ridge)
  for (const [bone, x] of [[ix.ropeA, ROPE_X[0]], [ix.ropeB, ROPE_X[1]]]) {
    const hung = rigid(bone);
    for (const side of [1, -1]) {
      kit.loft(run([x, PIVOT_Y - 0.02, 0], [x, EYE_Y, 0.0415 * side], 2, 0.0085, 0.0085, 0.0085, 0.0085), {
        ref: [1, 0, 0], sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.006, color: hemp, mat: 'cloth', bind: hung,
        paint: (o, px, py, pz, u, a) => mul(o, 0.82 + 0.18 * Math.sin(u * 70 + a * TAU)),
      });
      kit.loft([ps(x, EYE_Y - 0.003, 0.0415 * side, 0.011, 0.011, 2), ps(x, EYE_Y + 0.002, 0.0415 * side, 0.0112, 0.0112, 2)], {
        ref: [0, 0, 1], sides: 8, start: 'round', end: 'round', capRings: 2, capDepth: 0.009, color: iron, mat: 'iron', bind: logB,
      });
    }
  }

  // the banner: a pole lashed to the ridge at the rear, a finial of metal on it, a swallow-tailed cloth in the team's color
  kit.loft(run([POLE_X, RIDGE_Y + 0.02, 0], [POLE_X, 1.25, 0], 5, 0.019, 0.019, 0.013, 0.013), {
    ref: [1, 0, 0], sides: 8, start: 'flat', end: 'round', capRings: 2, capDepth: 0.01, color: dark, mat: 'wood', bind: body, paint: grain(),
  });
  lathe(kit, {
    at: [POLE_X, 1.25, 0], axis: 'y', sides: 8, color: metal, mat: metal.mat, bind: body,
    profile: [[0, 0], [0, 0.017], [0.012, 0.021], [0.022, 0.017], [0.03, 0.026], [0.046, 0.024], [0.058, 0.013], [0.08, 0.004], [0.092, 0]],
  });
  const flagPts = [-0.41, -0.33, -0.25, -0.17, -0.09].map((x) => [x, FLAG_Y, 0]);
  flagCloth(kit, {
    at: [POLE_X + 0.012, FLAG_Y + 0.11, 0], w: 0.32, h: 0.22, notch: 0.3, nu: 8, nv: 4, color: TEAM(1), bind: alongPath([ix.flag1, ix.flag2, ix.flag3, ix.flag4], flagPts),
    paint: (o, x, y, z, u, a) => {
      // a darker hem along the pole and a fold or two in the cloth
      mul(o, 0.92 + 0.08 * Math.sin(u * 14 + a * 3));
      if (u < 0.05) mul(o, 0.8);
    },
  });

  const geo = kit.build({ ground: 1 });
  return {
    kind: 'ram',
    rich: { spec, geo, attach: [], dims: { shoulderY: 0.5, shoulderZ: 0.25 }, carryAt: [0, 0.4, 0], plan: 'ram', ix },
    parts: [], rig: { wheelR: WHEEL_R },
    triangles: geo.userData.triangles, meshes: 1,
  };
}
