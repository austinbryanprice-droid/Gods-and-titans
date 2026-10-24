// Procedural animation for the unit models (no skeletons): rigid part
// rotations plus morph-target joints (knees, elbows, wing flaps, waves).
// animateModel(model, state, t, dt, extra) is called once per frame.
import { KNEE_SAMPLES, WING_SAMPLES } from './unit-bodies.js';
import { applyRich } from './rich-anim.js';
import { applyCreature } from './rich-creature-anim.js';

const PI = Math.PI;
const D90 = PI / 2;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x) => {
  const k = clamp01(x);
  return k * k * (3 - 2 * k);
};
const lerp = (a, b, t) => a + (b - a) * t;

/** Set a morph influence by name (no-op when the mesh lacks it). */
function inf(mesh, name, value) {
  if (!mesh || !mesh.morphTargetDictionary) return;
  const i = mesh.morphTargetDictionary[name];
  if (i !== undefined) mesh.morphTargetInfluences[i] = value;
}

/** Drive a morph-series hinge (samples ascending, base 0 has no morph). */
function hinge(mesh, names, samples, angle) {
  if (!mesh || !mesh.morphTargetDictionary) return;
  const dict = mesh.morphTargetDictionary;
  const infl = mesh.morphTargetInfluences;
  for (const n of names) if (n && dict[n] !== undefined) infl[dict[n]] = 0;
  const lo = samples[0];
  const hi = samples[samples.length - 1];
  const a = angle < lo ? lo : angle > hi ? hi : angle;
  for (let i = 0; i < samples.length - 1; i++) {
    if (a >= samples[i] && a <= samples[i + 1]) {
      const f = (a - samples[i]) / (samples[i + 1] - samples[i] || 1);
      if (names[i] && dict[names[i]] !== undefined) infl[dict[names[i]]] = 1 - f;
      if (names[i + 1] && dict[names[i + 1]] !== undefined) infl[dict[names[i + 1]]] = f;
      return;
    }
  }
}

const KNEE_NAMES = [null, 'k45', 'k90'];
const ELBOW_NAMES = [null, 'e45', 'e90'];
const WING_NAMES = ['wd2', 'wd1', null, 'wu1', 'wu2'];
const knee = (mesh, a) => hinge(mesh, KNEE_NAMES, KNEE_SAMPLES, a);
const elbow = (mesh, a) => hinge(mesh, ELBOW_NAMES, KNEE_SAMPLES, a);
const wings = (mesh, a) => hinge(mesh, WING_NAMES, WING_SAMPLES, a);

/** 1 when a grounded winged unit should fold its wings (standing about), else 0. */
function restingWings(m, state) {
  return !m.air && !m.moving && state !== 'attack' && state !== 'cast' && state !== 'dead' ? 1 : 0;
}

/** Exponential approach of every key in cur toward tgt. */
function blend(cur, tgt, dt, rate = 22) {
  const k = dt > 0 ? 1 - Math.exp(-rate * Math.min(dt, 0.25)) : 1;
  for (const key in tgt) {
    const c = cur[key];
    cur[key] = c === undefined ? tgt[key] : c + (tgt[key] - c) * k;
  }
}

// Pose key groups with explicit (named-property) blends: generic keyed access
// boxes every number it reads or writes, named access does not.
const POSE_GROUPS = {
  arms: {
    keys: ['aRz', 'aRx', 'aRe', 'aRp', 'aLz', 'aLx', 'aLe', 'aLp', 'tRz', 'tRy', 'tRx'],
    blend(c, t, k) {
      c.aRz += (t.aRz - c.aRz) * k; c.aRx += (t.aRx - c.aRx) * k; c.aRe += (t.aRe - c.aRe) * k; c.aRp += (t.aRp - c.aRp) * k;
      c.aLz += (t.aLz - c.aLz) * k; c.aLx += (t.aLx - c.aLx) * k; c.aLe += (t.aLe - c.aLe) * k; c.aLp += (t.aLp - c.aLp) * k;
      c.tRz += (t.tRz - c.tRz) * k; c.tRy += (t.tRy - c.tRy) * k; c.tRx += (t.tRx - c.tRx) * k;
    },
  },
  human: {
    keys: ['pY', 'pX', 'lRz', 'lRk', 'lLz', 'lLk', 'cape', 'fold'],
    blend(c, t, k) {
      c.pY += (t.pY - c.pY) * k; c.pX += (t.pX - c.pX) * k;
      c.lRz += (t.lRz - c.lRz) * k; c.lRk += (t.lRk - c.lRk) * k; c.lLz += (t.lLz - c.lLz) * k; c.lLk += (t.lLk - c.lLk) * k;
      c.cape += (t.cape - c.cape) * k; c.fold += (t.fold - c.fold) * k;
    },
  },
  quad: {
    keys: ['bY', 'bX', 'bRz', 'bRx', 'hRz', 'hRy', 'jaw', 'tailA', 'wing', 'fold'],
    blend(c, t, k) {
      c.bY += (t.bY - c.bY) * k; c.bX += (t.bX - c.bX) * k; c.bRz += (t.bRz - c.bRz) * k; c.bRx += (t.bRx - c.bRx) * k;
      c.hRz += (t.hRz - c.hRz) * k; c.hRy += (t.hRy - c.hRy) * k; c.jaw += (t.jaw - c.jaw) * k;
      c.tailA += (t.tailA - c.tailA) * k; c.wing += (t.wing - c.wing) * k; c.fold += (t.fold - c.fold) * k;
    },
  },
  legs: {
    keys: ['gFL', 'kFL', 'gFR', 'kFR', 'gBL', 'kBL', 'gBR', 'kBR'],
    blend(c, t, k) {
      c.gFL += (t.gFL - c.gFL) * k; c.kFL += (t.kFL - c.kFL) * k; c.gFR += (t.gFR - c.gFR) * k; c.kFR += (t.kFR - c.kFR) * k;
      c.gBL += (t.gBL - c.gBL) * k; c.kBL += (t.kBL - c.kBL) * k; c.gBR += (t.gBR - c.gBR) * k; c.kBR += (t.kBR - c.kBR) * k;
    },
  },
  bird: {
    keys: ['wing', 'bRz', 'bX', 'bY', 'fold'],
    blend(c, t, k) {
      c.wing += (t.wing - c.wing) * k; c.bRz += (t.bRz - c.bRz) * k; c.bX += (t.bX - c.bX) * k; c.bY += (t.bY - c.bY) * k;
      c.fold += (t.fold - c.fold) * k;
    },
  },
  serpent: {
    keys: ['st', 'jaw', 'lunge', 'ga', 'wing', 'fold'],
    blend(c, t, k) {
      c.st += (t.st - c.st) * k; c.jaw += (t.jaw - c.jaw) * k; c.lunge += (t.lunge - c.lunge) * k; c.ga += (t.ga - c.ga) * k;
      c.wing += (t.wing - c.wing) * k; c.fold += (t.fold - c.fold) * k;
    },
  },
  insect: {
    keys: ['ga', 'la', 'lb', 'st', 'bX', 'bRz'],
    blend(c, t, k) {
      c.ga += (t.ga - c.ga) * k; c.la += (t.la - c.la) * k; c.lb += (t.lb - c.lb) * k; c.st += (t.st - c.st) * k;
      c.bX += (t.bX - c.bX) * k; c.bRz += (t.bRz - c.bRz) * k;
    },
  },
  ram: {
    keys: ['lx'],
    blend(c, t, k) {
      c.lx += (t.lx - c.lx) * k;
    },
  },
};

/** The key groups a model's target pose is made of (null for an unknown kind). */
function poseGroupsFor(m) {
  const G = POSE_GROUPS;
  switch (m.kind) {
    case 'humanoid':
    case 'naga':
    case 'spirit': return [G.arms, G.human];
    case 'quadruped': return [G.quad, G.legs];
    case 'centaur': return [G.quad, G.legs, G.arms];
    case 'bird': return [G.bird];
    case 'serpent':
    case 'hydra':
    case 'dragon': return [G.serpent];
    case 'insect': return m.rig.humanTop ? [G.insect, G.arms] : [G.insect];
    case 'ram': return [G.ram];
    default: return null;
  }
}

/** The explicit blends for T when its keys are exactly those groups' keys, else null (generic blend). */
function poseBlender(m, T) {
  const groups = poseGroupsFor(m);
  if (!groups) return null;
  const keys = new Set();
  for (const g of groups) for (const k of g.keys) keys.add(k);
  const own = Object.keys(T);
  if (own.length !== keys.size || !own.every((k) => keys.has(k))) return null;
  return groups.map((g) => g.blend);
}

/**
 * Blend the model's current pose toward the target pose T (same result as
 * blend()). The first call starts the current pose as a same-shape copy of T.
 * T and cur keep a fixed set of keys and stay fast-mode objects: deleting keys,
 * or adding many keys one by one through keyed stores, turns an object into a
 * dictionary that allocates a heap number for every number stored.
 */
function blendPose(m, T, dt, rate) {
  if (m.cur === null) {
    m.cur = { ...T };
    m.blendFns = poseBlender(m, T);
    return;
  }
  const fns = m.blendFns;
  if (fns === null) {
    blend(m.cur, T, dt, rate);
    return;
  }
  const k = dt > 0 ? 1 - Math.exp(-rate * Math.min(dt, 0.25)) : 1;
  for (let i = 0; i < fns.length; i++) fns[i](m.cur, T, k);
}

// Attack phase curve helpers -------------------------------------------------

const PHASES = { wind: 0, hit: 0, rec: 0 };

/**
 * Windup (0..w), strike (w..s), recover (s..1). Returns { wind, hit, rec } 0..1,
 * or null without an attack phase. The result object is shared: read it before
 * the next phases() call.
 */
function phases(p, w = 0.3, s = 0.5) {
  if (p === undefined || p === null) return null;
  PHASES.wind = p < w ? smooth(p / w) : 1;
  PHASES.hit = p < w ? 0 : p < s ? smooth((p - w) / (s - w)) : 1;
  PHASES.rec = p < s ? 0 : smooth((p - s) / (1 - s));
  return PHASES;
}

const PUNCH_INFO = { style: 'punch' };
const NO_INFO = {};

// ---------------------------------------------------------------------------
// Humanoid upper body (arms + torso) shared by humanoid, naga, spirit,
// centaur and human-topped insects. Writes targets into T.
// ---------------------------------------------------------------------------

function restArms(T, rig) {
  T.aRz = 0.14;
  T.aRx = -0.1;
  T.aRe = (rig.rightElbow ?? 0.25) * D90;
  T.aRp = 0;
  T.aLz = 0.14;
  T.aLx = 0.1;
  T.aLe = (rig.leftElbow ?? 0.25) * D90;
  T.aLp = 0;
  if (rig.holdAloft) {
    // raised high and a little outward (a raised arm opens with a negative roll on the left)
    T.aLz = 2.5; T.aLx = -0.3; T.aLe = 0.55;
  }
  T.tRz = 0;
  T.tRy = 0;
  T.tRx = 0;
}

function attackUpper(T, rig, m, ap, ranged) {
  const info = rig.info || PUNCH_INFO;
  let style = info.style;
  if (ranged && style !== 'bow') {
    if (style === 'swing' || style === 'thrust' || style === 'punch' || style === 'claw') style = m.rangedStyle;
  }
  const P = phases(ap, style === 'bow' ? 0.15 : 0.3, style === 'bow' ? 0.3 : 0.5);
  const restE = T.aRe;
  switch (style) {
    case 'swing': {
      const readyZ = 0.85;
      const readyE = Math.max(restE, 0.9);
      if (!P) {
        T.aRz = readyZ; T.aRe = readyE; T.tRy = -0.1;
      } else {
        const z = lerp(lerp(readyZ, 2.75, P.wind), 0.15, P.hit);
        T.aRz = lerp(z, readyZ, P.rec);
        T.aRe = lerp(lerp(lerp(readyE, 1.1, P.wind), 0.1, P.hit), readyE, P.rec);
        T.aRx = -0.15 - 0.25 * P.wind * (1 - P.hit);
        T.tRy = lerp(lerp(-0.1, -0.4, P.wind), 0.3, P.hit) * (1 - P.rec) + -0.1 * P.rec;
        T.tRz = -0.22 * P.hit * (1 - P.rec) + 0.05 * P.wind * (1 - P.hit);
      }
      T.aLz = 0.55; T.aLe = Math.max(T.aLe, 1.0);
      break;
    }
    case 'thrust': {
      T.aRe = D90;
      if (!P) {
        T.aRz = 0.1; T.aRp = 0;
      } else {
        T.aRz = lerp(lerp(0.1, -0.35, P.wind), 0.45, P.hit) * (1 - P.rec) + 0.1 * P.rec;
        T.aRp = lerp(lerp(0, -0.06, P.wind), 0.14, P.hit) * (1 - P.rec);
        T.tRy = lerp(lerp(0, -0.3, P.wind), 0.3, P.hit) * (1 - P.rec);
        T.tRz = -0.15 * P.hit * (1 - P.rec);
      }
      T.aLz = 0.5; T.aLe = Math.max(T.aLe, 1.0);
      break;
    }
    case 'bow': {
      // left arm extended with the bow, right hand draws to the chest
      T.aLz = 1.5; T.aLx = 0.12; T.aLe = 0.05;
      T.tRy = -0.35;
      const draw = P ? (P.wind < 1 ? 1 - P.wind : P.hit * (1 - P.rec) + P.rec) : 1;
      T.aRz = lerp(1.45, 1.05, draw);
      T.aRx = -0.05;
      T.aRe = lerp(0.3, D90, draw);
      break;
    }
    case 'throw': {
      if (!P) {
        T.aRz = 2.2; T.aRe = 1.0; T.tRy = -0.2;
      } else {
        T.aRz = lerp(lerp(2.2, 2.95, P.wind), 0.9, P.hit) * (1 - P.rec) + 2.2 * P.rec;
        T.aRe = lerp(lerp(1.0, 1.3, P.wind), 0.05, P.hit) * (1 - P.rec) + 1.0 * P.rec;
        T.tRy = lerp(lerp(-0.2, -0.45, P.wind), 0.35, P.hit) * (1 - P.rec) - 0.2 * P.rec;
        T.tRz = (0.08 * P.wind - 0.28 * P.hit) * (1 - P.rec);
      }
      T.aLz = 0.9; T.aLe = 0.6;
      break;
    }
    case 'cast': {
      if (!P) {
        T.aRz = 1.4; T.aRe = 0.4; T.aLz = 1.0;
      } else {
        T.aRz = lerp(lerp(1.4, 2.4, P.wind), 1.45, P.hit) * (1 - P.rec) + 1.4 * P.rec;
        T.aRe = lerp(lerp(0.4, 0.5, P.wind), 0.0, P.hit) * (1 - P.rec) + 0.4 * P.rec;
        T.aLz = lerp(lerp(1.0, 1.9, P.wind), 1.2, P.hit) * (1 - P.rec) + 1.0 * P.rec;
        T.tRz = (0.08 * P.wind - 0.15 * P.hit) * (1 - P.rec);
      }
      T.aLe = Math.max(T.aLe * 0.6, 0.3);
      break;
    }
    case 'drum': {
      const a = P ? Math.sin(Math.min(1, ap * 2) * PI * 2) : 0.3;
      T.aRz = 1.25 + 0.55 * a; T.aRe = 0.7;
      T.aLz = 1.25 - 0.55 * a; T.aLe = 0.7;
      T.tRz = -0.05;
      break;
    }
    case 'fan': {
      if (!P) {
        T.aRz = 1.2; T.aRx = -0.9;
      } else {
        T.aRz = 1.25;
        T.aRx = lerp(lerp(-0.9, -1.3, P.wind), 0.55, P.hit) * (1 - P.rec) - 0.9 * P.rec;
        T.tRy = lerp(-0.25, 0.35, P.hit) * (1 - P.rec);
      }
      T.aRe = 0.5;
      break;
    }
    default: {
      // punch / claw: alternate fists
      const right = m.punchSide > 0;
      if (!P) {
        T.aRz = 0.7; T.aRe = 1.3; T.aLz = 0.7; T.aLe = 1.3;
      } else {
        const z = lerp(lerp(0.6, -0.3, P.wind), 1.45, P.hit) * (1 - P.rec) + 0.7 * P.rec;
        const e = lerp(lerp(1.3, 1.5, P.wind), 0.1, P.hit) * (1 - P.rec) + 1.3 * P.rec;
        if (right) { T.aRz = z; T.aRe = e; T.aLz = 0.7; T.aLe = 1.3; } else { T.aLz = z; T.aLe = e; T.aRz = 0.7; T.aRe = 1.3; }
        T.tRy = (right ? 1 : -1) * lerp(-0.25, 0.3, P.hit) * (1 - P.rec);
        T.tRz = -0.12 * P.hit * (1 - P.rec);
      }
    }
  }
}

/** True when the right hand holds an item gripped across the fist (staff, sword…). */
function holdsCrossGrip(rig) {
  return !!rig && rig.weapon && rig.weapon !== 'none' && rig.weapon !== 'bow' && (rig.info || NO_INFO).grip === 'fwd';
}

/** Hold a cross-gripped item upright in front of the chest. */
function itemUpright(T, w = 0) {
  T.aRz = 1.15 + w; T.aRx = -0.2; T.aRe = 0.45;
}

function castUpper(T, t, rig) {
  const w = Math.sin(t * 9) * 0.06;
  // arms raised in a wide V so the gesture reads from the RTS camera (the
  // roll is applied after the forward swing, so a raised arm opens outward
  // with the opposite sign of a hanging one)
  T.aRz = 2.45 + w; T.aRx = 0.7; T.aRe = 0.2;
  T.aLz = 2.45 - w; T.aLx = -0.7; T.aLe = 0.2;
  // a staff / sword / scepter is raised upright rather than held flat overhead
  if (holdsCrossGrip(rig)) itemUpright(T, w * 2);
  T.tRz = 0.14; T.tRy = 0;
}

function walkArms(T, rig, phi, amp) {
  const s = Math.sin(phi);
  const info = rig.info || NO_INFO;
  const heldR = info.grip === 'pole' || rig.rightElbow >= 0.85 ? 0.12 : info.grip === 'fist' ? 1 : 0.45;
  const heldL = rig.leftElbow >= 0.85 ? 0.15 : rig.weapon === 'bow' ? 0.6 : 0.8;
  T.aRz += -amp * s * heldR;
  T.aLz += amp * s * heldL;
  T.tRy = 0.12 * s;
}

// ---------------------------------------------------------------------------

function humanoidPose(m, T, state, t, ex) {
  const rig = m.rig;
  const heavy = rig.heavy;
  restArms(T, rig);
  T.pY = 0; T.pX = 0;
  T.lRz = 0; T.lRk = 0.06; T.lLz = 0; T.lLk = 0.06;
  T.cape = 0.05 + 0.04 * Math.sin(t * 1.3 + m.seed);
  const breath = Math.sin(t * 1.8 + m.seed);
  const moving = m.moving;
  const phi = m.walkPhase;
  if (state === 'dead') {
    T.aRz = 0.3; T.aLz = 0.3; T.aRe = 0.2; T.aLe = 0.2;
    return;
  }
  if (state === 'pray' && !moving) {
    const cyc = (Math.sin(t * 2.4 + m.seed) + 1) / 2; // 0 upright .. 1 bowed
    const drop = rig.hipY - (rig.hipY - rig.thigh) - 0.025;
    T.pY = -drop;
    T.pX = -0.03;
    T.lRz = 1.45; T.lRk = D90;
    T.lLz = -0.12; T.lLk = D90;
    T.tRz = lerp(-0.12, -0.85, cyc);
    T.aRz = lerp(2.5, 1.05, cyc); T.aRx = -0.25; T.aRe = lerp(0.35, 0.2, cyc);
    T.aLz = lerp(2.5, 1.05, cyc); T.aLx = 0.25; T.aLe = lerp(0.35, 0.2, cyc);
    if (holdsCrossGrip(rig)) itemUpright(T, -0.25 * cyc);
    return;
  }
  if (moving) {
    const A = heavy ? 0.45 : 0.62;
    const s = Math.sin(phi);
    const c = Math.cos(phi);
    T.lRz = A * s; T.lLz = -A * s;
    T.lRk = 0.12 + 1.0 * Math.max(0, c) ** 1.5;
    T.lLk = 0.12 + 1.0 * Math.max(0, -c) ** 1.5;
    T.pY = 0.022 * (Math.abs(c) - 0.6) * (heavy ? 1.6 : 1);
    T.tRz = heavy ? -0.1 : -0.07;
    walkArms(T, rig, phi, heavy ? 0.4 : 0.55);
    if (heavy) T.tRx = 0.05 * s;
    T.cape = 0.55 + 0.12 * Math.sin(phi * 2);
  } else {
    T.pY = 0.006 * breath;
    T.tRz = 0.012 * breath;
    T.aRz += 0.03 * breath;
    T.aLz += 0.03 * breath;
  }
  if (state === 'attack') {
    attackUpper(T, rig, m, m.ap, m.ranged);
    if (!moving) {
      T.lRz = 0.3; T.lLz = -0.25; T.lRk = 0.25; T.lLk = 0.2; T.pY = -0.015;
    }
  } else if (state === 'cast') {
    castUpper(T, t, rig);
    T.cape = 0.25 + 0.1 * Math.sin(t * 6);
  } else if ((state === 'gather' || state === 'build') && !moving) {
    const chop = state === 'gather';
    const freq = chop ? 1.35 : 2.2;
    const x = (t * freq + m.seed) % 1;
    const up = x < 0.62 ? smooth(x / 0.62) : 1 - smooth((x - 0.62) / 0.12);
    if (chop) {
      T.aRz = lerp(0.55, 2.65, up); T.aRe = lerp(0.15, 0.7, up); T.aRx = -0.05;
      T.aLz = lerp(0.6, 2.55, up); T.aLe = lerp(0.25, 0.75, up); T.aLx = 0.25;
      T.tRz = lerp(-0.4, 0.05, up); T.tRy = -0.25;
    } else {
      T.aRz = lerp(0.65, 1.95, up); T.aRe = lerp(0.35, 1.1, up);
      T.aLz = 0.55; T.aLe = 1.2; T.aLx = 0.2;
      T.tRz = -0.38;
    }
    T.lRz = 0.28; T.lLz = -0.22; T.lRk = 0.3; T.lLk = 0.2; T.pY = -0.025;
  } else if (state === 'return' || (m.carry && moving)) {
    // carrying cargo over the left shoulder
    T.aLz = 2.45; T.aLx = 0.35; T.aLe = 1.4;
  }
  if (m.carry && state !== 'gather' && state !== 'build') {
    T.aLz = 2.45; T.aLx = 0.35; T.aLe = 1.4;
  }
}

function applyHumanoid(m, P) {
  const p = m.parts;
  const rig = m.rig;
  if (p.pelvis) {
    p.pelvis.position.y = rig.hipY + P.pY;
    p.pelvis.position.x = P.pX;
  }
  if (p.torso) {
    p.torso.rotation.set(P.tRx, P.tRy, (m.rest.torsoRz || 0) + P.tRz);
    inf(p.torso, 'cape', P.cape);
  }
  if (p.legR) {
    p.legR.rotation.z = P.lRz;
    knee(p.legR, P.lRk);
  }
  if (p.legL) {
    p.legL.rotation.z = P.lLz;
    knee(p.legL, P.lLk);
  }
  applyArms(m, P);
}

function applyArms(m, P) {
  const p = m.parts;
  if (p.armR) {
    p.armR.rotation.set(P.aRx, 0, P.aRz);
    p.armR.position.x = m.rest.armRx + P.aRp;
    elbow(p.armR, P.aRe);
  }
  if (p.armL) {
    p.armL.rotation.set(P.aLx, 0, P.aLz);
    p.armL.position.x = m.rest.armLx + P.aLp;
    elbow(p.armL, P.aLe);
  }
}

// ---------------------------------------------------------------------------

// leg phase offsets (fraction of a cycle) for FL, FR, BL, BR
const GALLOP_OFFS = [0, 0.13, 0.55, 0.68];
const WALK_OFFS = [0, 0.5, 0.75, 0.25];
const legSwing = (phi, off, amp) => amp * Math.sin(phi + off * PI * 2);
const legKnee = (phi, off, amp, tuck) => (tuck ? 1.2 : 0.1 + 0.95 * Math.max(0, Math.cos(phi + off * PI * 2)) ** 1.3 * (amp > 0.05 ? 1 : 0));

function quadLegs(m, T, gait, phi, amp, tuck) {
  const o = gait === 'gallop' ? GALLOP_OFFS : WALK_OFFS;
  // named stores keep the pose object's shape fixed (see blendPose)
  T.gFL = legSwing(phi, o[0], amp);
  T.kFL = legKnee(phi, o[0], amp, tuck);
  T.gFR = legSwing(phi, o[1], amp);
  T.kFR = legKnee(phi, o[1], amp, tuck);
  T.gBL = legSwing(phi, o[2], amp);
  T.kBL = legKnee(phi, o[2], amp, tuck);
  T.gBR = legSwing(phi, o[3], amp);
  T.kBR = legKnee(phi, o[3], amp, tuck);
}

function quadPose(m, T, state, t) {
  const rig = m.rig;
  const moving = m.moving;
  const air = m.air;
  const phi = m.walkPhase;
  T.bY = 0; T.bX = 0; T.bRz = 0; T.bRx = 0;
  T.hRz = 0; T.hRy = 0.18 * Math.sin(t * 0.45 + m.seed) * (moving ? 0.2 : 1); T.jaw = 0;
  T.tailA = 0.35; T.wing = air ? 0.2 : -0.35;
  // grounded winged beasts fold their wings while standing still
  T.fold = !air && !moving && state !== 'attack' && state !== 'cast' && state !== 'dead' ? 1 : 0;
  quadLegs(m, T, rig.gait, phi, 0, false);
  const breath = Math.sin(t * 1.7 + m.seed);
  if (state === 'dead') return;
  if (air) {
    // legs tucked, paddling
    quadLegs(m, T, 'walk', t * 3, 0.15, true);
    T.wing = 0.25 + 0.75 * Math.sin(t * (moving ? 9 : 5.5) + m.seed);
    T.bRz = moving ? -0.08 : 0.03 * breath;
  } else if (moving) {
    const amp = rig.elephant ? 0.38 : rig.gait === 'gallop' ? 0.62 : 0.5;
    quadLegs(m, T, rig.gait, phi, amp, false);
    if (rig.gait === 'gallop') {
      T.bRz = 0.07 * Math.sin(phi * 2 + 0.6);
      T.bY = 0.025 * Math.abs(Math.sin(phi));
    } else {
      T.bRx = 0.03 * Math.sin(phi);
      T.bY = 0.012 * Math.abs(Math.sin(phi * 2));
    }
    T.hRz = (rig.elephant ? 0.04 : 0.06) * Math.sin(phi * 2);
    T.tailA = 1;
    T.wing = m.hasWings ? 0.0 + 0.5 * Math.sin(phi * 2) : T.wing;
  } else {
    T.bY = 0.006 * breath;
    T.hRz = 0.03 * breath;
  }
  if (state === 'attack') {
    const P = phases(m.ap, 0.3, 0.5);
    if (P) {
      T.bX = (-0.05 * P.wind + 0.17 * P.hit) * (1 - P.rec);
      T.hRz = (0.3 * P.wind - 0.55 * P.hit) * (1 - P.rec);
      T.bRz = (0.08 * P.wind - 0.1 * P.hit) * (1 - P.rec);
      T.jaw = (P.wind * (1 - P.hit) + 0.3 * P.hit) * (1 - P.rec);
      if (rig.elephant) {
        T.hRz = (0.35 * P.wind - 0.25 * P.hit) * (1 - P.rec);
        T.jaw = (P.wind - P.hit) * (1 - P.rec) + 0.0;
        T.gFR = (0.9 * P.wind) * (1 - P.hit);
        T.kFR = 0.6 * P.wind * (1 - P.hit);
      } else if (!moving && !air) {
        T.gFR = 0.5 * P.hit * (1 - P.rec);
        T.gFL = 0.35 * P.hit * (1 - P.rec);
      }
    } else {
      T.hRz = -0.12;
      T.jaw = 0.25;
    }
  } else if (state === 'cast') {
    T.hRz = 0.4;
    T.jaw = 0.8;
    T.bRz = 0.08;
  }
  if (m.kind === 'centaur') {
    restArms(T, rig);
    if (state === 'attack') attackUpper(T, rig, m, m.ap, m.ranged);
    else if (state === 'cast') castUpper(T, t, rig);
    else if (moving) walkArms(T, rig, phi, 0.3);
    T.tRz += 0;
  }
}

function quadLeg(leg, swing, bend) {
  if (!leg) return;
  leg.rotation.z = swing;
  knee(leg, bend);
}

function applyQuad(m, P) {
  const p = m.parts;
  if (p.body) {
    p.body.position.set(P.bX, P.bY, 0);
    p.body.rotation.set(P.bRx, 0, P.bRz);
    m.waveA(p.body, P.tailA);
    wings(p.body, P.wing);
    inf(p.body, 'wf', P.fold);
  }
  if (p.head) {
    p.head.rotation.set(0, P.hRy, P.hRz);
    inf(p.head, 'jaw', P.jaw);
    inf(p.head, 'ear', 0.5 + 0.5 * Math.sin(m.time * 1.3 + m.seed));
  }
  quadLeg(p.legFL, P.gFL, P.kFL);
  quadLeg(p.legFR, P.gFR, P.kFR);
  quadLeg(p.legBL, P.gBL, P.kBL);
  quadLeg(p.legBR, P.gBR, P.kBR);
  if (m.kind === 'centaur') {
    inf(p.body, 'cape', m.moving ? 0.6 : 0.1);
    applyArms(m, P);
  }
}

// ---------------------------------------------------------------------------

/**
 * Animate one model. Called by UnitModel.animate.
 * @param {object} m UnitModel internals
 */
export function animateModel(m, state, t, dt, ex) {
  const kind = m.kind;
  // Target pose. Every model writes the same set of keys each frame, so T is
  // only overwritten, never cleared: deleting its keys made it a dictionary-mode
  // object whose number stores all allocated (~240 KB per frame with 270 units).
  const T = m.target;
  m.time = t;
  // locomotion phase
  if (m.moving) {
    const speed = ex.speed ?? m.speed;
    m.walkPhase += dt * (speed / (m.strideLen || 1)) * PI * 2;
  }
  m.wavePhase += dt * (m.moving ? 7 : 2.2);
  const flick = 0.55 + 0.3 * Math.sin(t * 13.1 + m.seed) * Math.sin(t * 7.3 + m.seed * 2) + 0.15 * Math.sin(t * 23.0);

  switch (kind) {
    case 'humanoid': {
      humanoidPose(m, T, state, t, ex);
      T.fold = restingWings(m, state);
      blendPose(m, T, dt, 20);
      if (m.rich) {
        // the skinned rich body: bones in place of rigid parts and morph hinges
        applyRich(m, m.cur, state, t, dt);
        for (const f of m.rich.flames) inf(f, 'fl', flick);
        break;
      }
      applyHumanoid(m, m.cur);
      const torso = m.parts.torso;
      if (torso) {
        m.waveA(torso, m.moving ? 1 : 0.4);
        const wflap = m.air ? 0.15 + 0.7 * Math.sin(t * (m.moving ? 8.5 : 5) + m.seed)
          : m.moving ? -0.2 + 0.25 * Math.sin(m.walkPhase * 2) : state === 'cast' ? 0.45 + 0.1 * Math.sin(t * 6) : -0.3 + 0.06 * Math.sin(t * 1.4 + m.seed);
        wings(torso, wflap);
        inf(torso, 'wf', m.cur.fold);
        inf(torso, 'fl', flick);
      }
      inf(m.parts.armR, 'fl', flick);
      inf(m.parts.armL, 'fl', flick);
      break;
    }
    case 'naga':
    case 'spirit': {
      humanoidPose(m, T, state === 'pray' ? 'pray-upper' : state, t, ex);
      T.lRz = 0; T.lLz = 0;
      if (state === 'pray') {
        const cyc = (Math.sin(t * 2.4 + m.seed) + 1) / 2;
        T.tRz = lerp(-0.1, -0.7, cyc);
        T.aRz = lerp(2.5, 1.1, cyc); T.aLz = lerp(2.5, 1.1, cyc); T.aRe = 0.3; T.aLe = 0.3;
        T.pY = kind === 'naga' ? -0.08 : -0.1;
      }
      if (kind === 'spirit') {
        T.pY = (T.pY || 0) + m.rig.float + 0.05 * Math.sin(t * 1.6 + m.seed);
        T.tRz = (T.tRz || 0) + (m.moving ? -0.25 : 0);
        if (m.moving) { T.aRz -= 0.5; T.aLz -= 0.5; }
      } else {
        T.pY = (T.pY || 0) + 0.012 * Math.sin(m.wavePhase * 0.5);
      }
      T.fold = restingWings(m, state);
      blendPose(m, T, dt, 18);
      applyHumanoid(m, m.cur);
      const tail = m.parts.tail || m.parts.wisp;
      m.waveA(tail, m.moving ? 1 : 0.35);
      if (m.parts.torso) {
        m.waveA(m.parts.torso, m.moving ? 1 : 0.4);
        wings(m.parts.torso, m.air ? 0.15 + 0.7 * Math.sin(t * 6 + m.seed) : m.moving ? -0.1 + 0.3 * Math.sin(t * 5) : -0.3);
        inf(m.parts.torso, 'wf', m.cur.fold);
        inf(m.parts.torso, 'fl', flick);
      }
      break;
    }
    case 'quadruped':
    case 'centaur': {
      quadPose(m, T, state, t);
      blendPose(m, T, dt, 20);
      if (m.rich) {
        // the skinned rich beast: bones in place of rigid parts and morph hinges
        applyCreature(m, m.cur, state, t, dt);
        break;
      }
      applyQuad(m, m.cur);
      inf(m.parts.body, 'fl', flick);
      break;
    }
    case 'bird': {
      const moving = m.moving;
      T.wing = m.air || moving ? 0.2 + 0.75 * Math.sin(t * (moving ? 10 : 6.5) + m.seed) : -0.35;
      T.bRz = moving ? -0.12 : 0.02 * Math.sin(t * 2);
      T.bX = 0; T.bY = m.air ? 0 : 0;
      if (state === 'attack') {
        const P = phases(m.ap, 0.3, 0.5);
        if (P) {
          T.bRz = (0.25 * P.wind - 0.45 * P.hit) * (1 - P.rec);
          T.bX = (-0.05 * P.wind + 0.2 * P.hit) * (1 - P.rec);
          T.wing = lerp(lerp(T.wing, 0.95, P.wind), -0.6, P.hit) * (1 - P.rec) + T.wing * P.rec;
        }
      } else if (state === 'cast') {
        T.wing = 0.9;
        T.bRz = 0.15;
      }
      if (state === 'dead') T.wing = -0.5;
      T.fold = restingWings(m, state);
      blendPose(m, T, dt, 26);
      const body = m.parts.body;
      body.position.set(m.cur.bX, m.cur.bY, 0);
      body.rotation.z = m.cur.bRz;
      wings(body, m.cur.wing);
      inf(body, 'wf', m.cur.fold);
      m.waveA(body, moving ? 1 : 0.4);
      inf(body, 'fl', flick);
      break;
    }
    case 'serpent':
    case 'hydra':
    case 'dragon': {
      const body = m.parts.body;
      let st = 0;
      let jaw = 0.1;
      let lunge = 0;
      let ga = 0;
      if (state === 'attack') {
        const P = phases(m.ap, 0.3, 0.45);
        if (P) {
          st = (-0.35 * P.wind + 1.35 * P.hit) * (1 - P.rec);
          jaw = (P.wind * (1 - P.hit) + 0.2) * (1 - P.rec);
          lunge = (0.12 * P.hit) * (1 - P.rec);
        } else {
          st = -0.15;
          jaw = 0.3;
        }
      } else if (state === 'cast') {
        st = -0.4;
        jaw = 1;
      }
      if (kind === 'dragon' && !m.rig.eastern && m.moving && !m.air) ga = Math.sin(m.walkPhase);
      T.st = st; T.jaw = jaw; T.lunge = lunge; T.ga = ga;
      T.wing = m.air || m.moving ? 0.2 + 0.7 * Math.sin(t * (m.moving ? 7 : 4.5) + m.seed) : -0.3;
      if (state === 'cast') T.wing = 0.85;
      if (state === 'dead') { T.st = 0; T.wing = -0.4; }
      T.fold = restingWings(m, state);
      blendPose(m, T, dt, 22);
      inf(body, 'st', m.cur.st);
      inf(body, 'jaw', m.cur.jaw);
      inf(body, 'ga', m.cur.ga);
      wings(body, m.cur.wing);
      inf(body, 'wf', m.cur.fold);
      body.position.x = m.cur.lunge;
      const amp = kind === 'hydra' ? (state === 'idle' || !m.moving ? 0.6 : 1) : m.moving ? 1 : 0.35;
      if (kind === 'hydra') {
        inf(body, 'wa', amp * Math.sin(t * 1.7));
        inf(body, 'wb', amp * Math.cos(t * 1.7));
      } else m.waveA(body, amp);
      inf(body, 'fl', flick);
      break;
    }
    case 'insect': {
      const body = m.parts.body;
      const phi = m.walkPhase;
      T.ga = m.moving ? Math.sin(phi) : 0;
      T.la = m.moving ? Math.max(0, Math.cos(phi)) : 0;
      T.lb = m.moving ? Math.max(0, -Math.cos(phi)) : 0;
      T.st = 0; T.bX = 0; T.bRz = 0;
      if (state === 'attack') {
        const P = phases(m.ap, 0.3, 0.45);
        if (P) {
          T.st = (-0.3 * P.wind + 1.1 * P.hit) * (1 - P.rec);
          T.bX = 0.08 * P.hit * (1 - P.rec);
          T.bRz = (0.08 * P.wind - 0.08 * P.hit) * (1 - P.rec);
        }
      }
      if (m.rig.humanTop) {
        restArms(T, m.rig);
        if (state === 'attack') attackUpper(T, m.rig, m, m.ap, m.ranged);
        else if (state === 'cast') castUpper(T, t, m.rig);
        else if (m.moving) walkArms(T, m.rig, phi, 0.3);
      }
      blendPose(m, T, dt, 24);
      inf(body, 'ga', m.cur.ga);
      inf(body, 'la', m.cur.la);
      inf(body, 'lb', m.cur.lb);
      inf(body, 'st', m.cur.st);
      inf(body, 'wa', 0.6 * Math.sin(t * 1.5 + m.seed));
      wings(body, m.air ? 0.2 + 0.7 * Math.sin(t * 14) : -0.45);
      body.position.x = m.cur.bX;
      body.rotation.z = m.cur.bRz;
      body.position.y = m.moving ? 0.008 * Math.abs(Math.sin(phi * 2)) : 0;
      inf(body, 'fl', flick);
      if (m.rig.humanTop) {
        if (m.parts.torso) m.parts.torso.rotation.set(m.cur.tRx || 0, m.cur.tRy || 0, (m.rest.torsoRz || 0) + (m.cur.tRz || 0));
        applyArms(m, m.cur);
      }
      break;
    }
    case 'ram': {
      const p = m.parts;
      if (m.moving) {
        const speed = ex.speed ?? m.speed;
        m.wheelAngle -= (dt * speed) / (m.rig.wheelR * m.scale);
      }
      if (p.axleF) p.axleF.rotation.z = m.wheelAngle;
      if (p.axleB) p.axleB.rotation.z = m.wheelAngle;
      let lx = 0;
      if (state === 'attack') {
        const P = phases(m.ap, 0.45, 0.58);
        lx = P ? (-0.22 * P.wind + 0.4 * P.hit) * (1 - P.rec) : -0.1;
      }
      T.lx = lx;
      blendPose(m, T, dt, 24);
      if (p.log) {
        p.log.position.x = m.cur.lx;
        p.log.rotation.z = -m.cur.lx * 0.35;
      }
      p.body.position.y = m.moving ? 0.008 * Math.abs(Math.sin(m.wheelAngle * 2)) : 0;
      m.waveA(p.body, 1);
      break;
    }
    default:
      break;
  }
}

/** Shared helper used by the model: traveling-wave morph drive (wa / wb). */
export function driveWave(mesh, phase, amp) {
  if (!mesh || !mesh.morphTargetDictionary) return;
  inf(mesh, 'wa', amp * Math.cos(phase));
  inf(mesh, 'wb', amp * Math.sin(phase));
}

export { inf, smooth, clamp01 };
