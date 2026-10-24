// The rich birds (High and Ultra): one smooth skinned mesh on a skeleton of a body, a chest, a neck, a head, a tail of four
// bones and a leg of two a side, with a pair of feathered wings (rigid pieces on two bones a side, rich-creature-wings.js)
// in place of the rigid low-poly parts. A species (the corvids' black and heavy-billed, the phoenixes' long tails and
// crests, the Anzu's lion head) is a table of proportions; what a unit wears (a long tail, flames, a mane, glowing
// eyes) comes from its visual. The pose keys of the low-poly rig (unit-anim.js: the wing's beat, the body's pitch and lunge)
// stay the source of truth: rich-creature-anim.js turns them into bone rotations.
import { shadeC, mixC, TEAM } from './unit-geo.js';
import { WEAPON_INFO } from './unit-parts.js';
import { MeshKit, ps, rigid, alongPath, smoothstep } from './rich-kit.js';
import { creatureSpec, addBones, pathStations, bonesOf, pathOf, ringPoint, frameMatrix, headToModel, intoBone, TAIL_KEYS } from './rich-creature-kit.js';
import { clamp, lerp, tint, mul, furStreaks } from './rich-paint.js';
import { feather } from './rich-feathers.js';
import { tuft } from './rich-creature-parts.js';
import { lionMane } from './rich-creature-hair.js';
import { wingJoints, wingBones, featherWings } from './rich-creature-wings.js';
import { mammalHead, mammalMetrics } from './rich-mammal-heads.js';
import { birdHead } from './rich-bird-heads.js';
import { finishGear } from './rich-gear.js';
import { tongue } from './rich-regalia.js';

const PI = Math.PI;
const TAU = PI * 2;

/** What a unit may wear for this plan to dress it (anything else keeps the low-poly model). */
const BIRD_EXTRAS = new Set(['tail', 'flames', 'wings', 'eye_glow', 'mane']);

/** Which units this plan builds: a bird with a crow's, a falcon's (the plan's phoenix) or a lion's head. */
export function birdSupported(v) {
  if (v.body !== 'bird') return false;
  if (v.head !== 'bird' && v.head !== 'lion') return false;
  if ((v.heads || 1) !== 1) return false;
  if (v.headgear !== 'none' && v.headgear !== 'feathers') return false;
  return v.extras.every((e) => BIRD_EXTRAS.has(e));
}

/** The species of a bird by what it wears: a lion's head is the Anzu's (a griffin), a long tail or flames a phoenix's, else a corvid. */
const speciesOf = (v, ex) => (v.head === 'lion' ? 'griffin' : ex.has('tail') || ex.has('flames') ? 'phoenix' : 'corvid');

/**
 * Proportions at scale 1 (about what the low-poly birds cover). `body`: the stations of the barrel from the tail to the
 * breast, [x, height above the body's middle, vertical radius, lateral radius]; `neck`: the same for the points of the
 * neck up to the skull; `head`: the middle of the skull, its scale (a humanoid's head is 1), its pitch; `span`: the wing's
 * reach; `tail`: its length, how many feathers, how far they fan; `wing`: feathers.
 */
const SPECIES = {
  corvid: {
    cy: 0.32,
    body: [[-0.285, 0, 0.016, 0.016], [-0.2, 0, 0.06, 0.056], [-0.1, 0.006, 0.11, 0.1], [0.0, 0, 0.138, 0.122], [0.12, 0, 0.142, 0.126], [0.2, 0.03, 0.105, 0.096]],
    neck: [[0.25, 0.085, 0.074, 0.068], [0.29, 0.148, 0.062, 0.058]],
    head: { at: [0.33, 0.205], scale: 0.42, pitch: -0.1 },
    span: 0.74, tail: { len: 0.27, n: 7, fan: 0.42, droop: 0.12 }, wing: { nSec: 7, nPri: 9, wide: 1.25, long: 1.0 },
  },
  phoenix: {
    cy: 0.32,
    body: [[-0.28, 0, 0.016, 0.016], [-0.2, 0, 0.055, 0.05], [-0.1, 0.004, 0.1, 0.09], [0.0, 0, 0.126, 0.11], [0.12, 0, 0.13, 0.116], [0.2, 0.04, 0.096, 0.088]],
    neck: [[0.25, 0.1, 0.068, 0.062], [0.3, 0.19, 0.054, 0.05], [0.335, 0.265, 0.046, 0.044]],
    head: { at: [0.365, 0.3], scale: 0.38, pitch: -0.12 },
    span: 0.88, tail: { len: 0.66, n: 6, fan: 0.34, droop: 0.2 }, wing: { nSec: 7, nPri: 8, wide: 1.2, long: 1.1 },
  },
  griffin: {
    cy: 0.33,
    body: [[-0.29, 0, 0.02, 0.02], [-0.2, 0, 0.07, 0.065], [-0.1, 0.006, 0.125, 0.115], [0.0, 0, 0.155, 0.14], [0.12, 0, 0.162, 0.146], [0.21, 0.035, 0.125, 0.115]],
    neck: [[0.26, 0.08, 0.1, 0.095], [0.3, 0.14, 0.09, 0.085]],
    head: { at: [0.325, 0.2], scale: 0.46, pitch: -0.1 },
    span: 0.96, tail: { len: 0.46, n: 5, fan: 0.4, droop: 0.2 }, wing: { nSec: 7, nPri: 8, wide: 1.3, long: 1.1 },
  },
};

/** The barrel's radii and middle height at x (the stations of S.body, straight between them). */
function bodyAt(S, x) {
  const k = S.body;
  let i = 0;
  while (i < k.length - 2 && x > k[i + 1][0]) i++;
  const t = clamp((x - k[i][0]) / (k[i + 1][0] - k[i][0]));
  return { y: S.cy + lerp(k[i][1], k[i + 1][1], t), ry: lerp(k[i][2], k[i + 1][2], t), rz: lerp(k[i][3], k[i + 1][3], t) };
}

// ---------------------------------------------------------------------------
// layout: where every bone and landmark sits
// ---------------------------------------------------------------------------

function layout(S, o) {
  const { cy } = S;
  const nk = S.neck.map(([x, dy]) => [x, cy + dy, 0]);
  const head = [S.head.at[0], cy + S.head.at[1], 0];
  const t0 = [-0.215, cy + 0.01, 0];
  const f = [0, 0.22, 0.5, 0.78, 1];
  const tail = f.map((k) => [t0[0] - k * S.tail.len * 0.92, t0[1] - k * k * S.tail.len * 0.12, 0]);
  const legs = {};
  for (const side of [1, -1]) {
    legs[side] = { hip: [0.0, cy - 0.085, side * 0.062], ankle: [-0.02, cy - 0.235, side * 0.074], knee: [0.045, cy - 0.155, side * 0.074] };
  }
  const wing = o.wings ? wingJoints([0.03, cy + 0.09, 0.06], S.span, { back: 0.05, up: 0.2, out: 0.5 }) : null;
  return { cy, body: [0, cy, 0], chest: [0.12, cy + 0.008, 0], neck: nk, head, tail, legs, wing };
}

function skeleton(Lay, o) {
  const nk = Lay.neck;
  const list = [
    ['root', null, [0, 0, 0]],
    ['body', 'root', Lay.body], ['chest', 'body', Lay.chest],
    ['neck1', 'chest', nk[0]], ['neck2', 'neck1', nk[nk.length - 1]], ['head', 'neck2', Lay.head],
  ];
  if (o.lion) list.push(['jaw', 'head', o.lion.jaw], ['earR', 'head', o.lion.ears[0]], ['earL', 'head', o.lion.ears[1]]);
  Lay.tail.slice(0, 4).forEach((p, i) => list.push([`${TAIL_KEYS[0]}${i + 1}`, i ? `${TAIL_KEYS[0]}${i}` : 'body', p]));
  for (const side of [1, -1]) {
    const k = side > 0 ? 'R' : 'L';
    list.push([`leg${k}`, 'body', Lay.legs[side].hip], [`foot${k}`, `leg${k}`, Lay.legs[side].ankle]);
  }
  const spec = creatureSpec(list);
  if (Lay.wing) addBones(spec, wingBones('chest', Lay.wing));
  return spec;
}

// ---------------------------------------------------------------------------
// the template
// ---------------------------------------------------------------------------

/** The rich template of a bird unit type: { kind, rich: { spec, geo, attach, ... }, rig, parts: [] }. */
export function buildBirdTemplate(unitType, ctx) {
  const { v, pal, ex } = ctx;
  const species = speciesOf(v, ex);
  const S = SPECIES[species];
  const lionHead = species === 'griffin';
  const longTail = ex.has('tail');
  const Sx = longTail ? { ...S, tail: { ...S.tail, len: Math.max(S.tail.len, 0.4) } } : { ...S, tail: { ...S.tail, len: Math.min(S.tail.len, 0.3) } };
  const lionAt = lionHead ? lionMetrics(Sx) : null;
  const Lay = layout(Sx, { wings: true });
  const spec = skeleton(Lay, { lion: lionAt });
  const ix = spec.ix;
  const cy = Lay.cy;
  const kit = new MeshKit(spec, { sides: ctx.grand ? 16 : 12, rings: 1 });

  const skin = pal.skin;
  const backC = pal.back;
  const belly = pal.belly;
  const dark = shadeC(skin, 0.6);

  // the barrel and the neck as one loft, from the tail's root to the skull
  const nk = Sx.neck;
  const headRel = Sx.head.at;
  const keys = Sx.body.map(([x, dy, rv, rl]) => [x, cy + dy, 0, rv, rl]);
  nk.forEach(([x, dy, rv, rl]) => keys.push([x, cy + dy, 0, rv, rl]));
  const hr = nk[nk.length - 1];
  keys.push([headRel[0] - 0.012, cy + headRel[1] - 0.012, 0, hr[2] * 0.85, hr[3] * 0.85]);
  const bodyBones = bonesOf(spec, ['body', 'chest', 'neck1', 'neck2', 'head']);
  const bodyPts = pathOf(spec, ['body', 'chest', 'neck1', 'neck2', 'head']);
  const bodyBind = alongPath(bodyBones, bodyPts, [0.06, 0.05, 0.035, 0.03]);
  const st = pathStations(keys, 22);
  // plumage: the back a shade toward the second tone, the belly paler, rows of feathers lying toward the tail
  const rows = 34;
  const per = 12;
  const plumage = (o, x, y, z, u, a) => {
    const c = Math.cos(a);
    tint(o, backC, 0.7 * smoothstep(0.1, 0.9, c));
    tint(o, belly, 0.75 * smoothstep(0.2, 0.95, -c));
    const row = u * rows;
    const i = Math.floor(row);
    const f = row - i;
    const col = (a / TAU) * per + (i & 1) * 0.5;
    const cc = col - Math.floor(col);
    const edge = f + 0.34 * (2 * cc - 1) ** 2;
    if (edge < 0.3) mul(o, 0.8);
    else mul(o, 1.06 - 0.14 * Math.min(1, (edge - 0.3) / 0.7));
  };
  kit.loft(st, { ref: [0, 1, 0], sides: 18, start: 'round', end: 'round', capRings: 3, capDepth: [0.05, 0.03], color: skin, bind: bodyBind, paint: plumage });

  // hackles under the throat and over the breast
  if (species === 'corvid') {
    const i0 = Math.floor(st.length * 0.62);
    for (let i = i0; i < st.length - 2; i += 1) {
      for (const a of [PI - 0.7, PI - 0.25, PI + 0.25, PI + 0.7]) {
        const { p, n, t, across } = ringPoint(st, i, a + 0.1 * (i % 2));
        const len = 0.07 - 0.01 * (i - i0);
        tuft(kit, {
          at: [p[0] - n[0] * 0.01, p[1] - n[1] * 0.01, p[2] - n[2] * 0.01], dir: [n[0] * 0.2 - t[0] * 0.9, n[1] * 0.2 - t[1] * 0.9, n[2] * 0.2 - t[2] * 0.9], len, w: 0.016, th: 0.004,
          bend: [0, -len * 0.3, 0], across, sides: 4, rings: 3, mat: 'feather', color: shadeC(skin, 0.92), bind: bodyBind,
        });
      }
    }
  }

  // the head
  const headBind = { head: rigid(ix.head) };
  if (lionHead) {
    mammalHead(kit, {
      kind: 'lion', at: Lay.head, pitch: Sx.head.pitch, len: lionAt.len, bind: { head: rigid(ix.head), jaw: rigid(ix.jaw), ear: { 1: rigid(ix.earR), '-1': rigid(ix.earL) } },
      pal, fur: skin, pale: mixC(skin, '#f4ead4', 0.5), glowEyes: ex.has('eye_glow') && !!pal.eyeGlow, paint: (o, x, y, z) => furStreaks(o, x, y, z),
    });
    if (ex.has('mane')) {
      const base = pal.primary;
      const nkx = Sx.neck;
      const coreKeys = [[Lay.chest[0] - 0.02, Lay.chest[1] + 0.03, 0, 0.115, 0.115], [nkx[0][0], cy + nkx[0][1] + 0.02, 0, 0.115, 0.115], [nkx[nkx.length - 1][0], cy + nkx[nkx.length - 1][1] + 0.03, 0, 0.1, 0.1], [Lay.head[0] + 0.0, Lay.head[1], 0, 0.092, 0.092]];
      const coreSt = pathStations(coreKeys, 6);
      kit.loft(coreSt, { ref: [0, 1, 0], sides: 14, start: 'round', end: 'round', capRings: 2, capDepth: [0.04, 0.03], color: shadeC(base, 0.8), mat: 'fur', bind: bodyBind });
      lionMane(kit, coreSt, { from: -1, len: 0.17, w: 0.075, color: shadeC(base, 0.95), dark: shadeC(base, 0.72), tip: shadeC(base, 0.5), bind: bodyBind });
    }
  } else {
    const crest = v.headgear === 'feathers' ? { n: 5, len: species === 'phoenix' ? 1 : 0.8, color: pal.secondary, alt: pal.primary, tip: pal.accent } : null;
    birdHead(kit, { ctx, pal, at: Lay.head, pitch: Sx.head.pitch, scale: Sx.head.scale, kind: species === 'phoenix' ? 'falcon' : 'bird', bind: headBind, crest });
  }

  // shoulders: scapulars lying back over the roots of the wings
  const sc = species === 'corvid' ? pal.secondary : mixC(pal.primary, pal.secondary, 0.35);
  for (const side of [1, -1]) {
    for (let i = 0; i < 5; i++) {
      const kk = i / 4;
      feather(kit, [0.04 - 0.045 * kk, cy + 0.115 - 0.01 * kk, side * (0.07 + 0.012 * kk)], [-1, -0.14 - 0.06 * kk, side * (0.22 + 0.25 * kk)], [0, 1, 0], (0.2 + 0.07 * Math.sin(kk * 3)) * (Sx.span / 0.74) ** 0.5, 0.042 * (Sx.span / 0.74) ** 0.5, {
        color: i % 2 ? shadeC(sc, 1.0) : shadeC(sc, 0.88), tip: null, bend: [0, -0.04, side * 0.03], thick: 0.003, rows: 4, bind: rigid(ix.chest),
      });
    }
  }

  // tail: feathers fanned from the rump, bound along its bones so that it waves
  const tb = bonesOf(spec, [1, 2, 3, 4].map((i) => `${TAIL_KEYS[0]}${i}`));
  const tailBind = alongPath(tb, Lay.tail, 0.05);
  const T = Sx.tail;
  const t0 = Lay.tail[0];
  for (let i = 0; i < T.n; i++) {
    const s = T.n > 1 ? (i / (T.n - 1) - 0.5) * 2 : 0;
    const a = s * T.fan;
    const as = Math.abs(s);
    const len = T.len * (1 - 0.3 * as ** 1.4) * (longTail ? 1 : 0.95);
    const dir = [-Math.cos(a), -(T.droop * (0.5 + 0.5 * as)) * 0.5, Math.sin(a)];
    const plume = longTail && species === 'phoenix';
    feather(kit, [t0[0] + 0.03, t0[1], s * 0.012], dir, [0, 1, 0], len, (plume ? 0.045 : 0.036) * (1 - 0.15 * as), {
      color: i % 2 ? pal.secondary : pal.primary, tip: plume ? pal.accent : longTail ? pal.accent : null, bend: [0, -len * 0.14, s * len * 0.06], thick: 0.003, rows: plume ? 8 : 5, shape: plume ? 0.7 : 0.45, cup: 0.2, bind: tailBind,
    });
  }
  // the phoenixes' two long streamers, spade-tipped, trailing past the fan
  if (longTail && species === 'phoenix') {
    for (const side of [-1, 1]) {
      const len = T.len * 1.2;
      feather(kit, [t0[0] + 0.03, t0[1] + 0.008, side * 0.014], [-1, -T.droop * 0.3, side * 0.2], [0, 1, 0], len, 0.05, {
        color: pal.secondary, tip: pal.accent, bend: [0, -len * 0.16, side * len * 0.1], thick: 0.003, rows: 10, shape: 0.82, cup: 0.15, bind: tailBind,
      });
    }
  }
  // the team's band round the body, at the base of the tail
  {
    const x0 = -0.15;
    const x1 = -0.09;
    const a = bodyAt(Sx, x0);
    const b = bodyAt(Sx, x1);
    kit.loft([ps(x0, a.y, 0, a.ry + 0.008, a.rz + 0.008), ps(x1, b.y, 0, b.ry + 0.008, b.rz + 0.008)], { ref: [0, 1, 0], rings: 2, sides: 18, start: null, end: null, color: TEAM(1), bind: bodyBind });
  }

  // legs: a thigh and a shank tucked under the belly, the toes curled
  const legCol = shadeC(pal.beak, 1);
  for (const side of [1, -1]) {
    const k = side > 0 ? 'R' : 'L';
    const L = Lay.legs[side];
    const lb = alongPath([ix[`leg${k}`], ix[`foot${k}`]], [L.hip, L.knee, L.ankle], [0.04]);
    kit.loft([ps(...L.hip, 0.034, 0.03), ps(...L.knee, 0.024, 0.022), ps(...L.ankle, 0.0125, 0.012)], { ref: [0, 0, 1], rings: 6, sides: 8, start: 'round', end: 'round', capDepth: 0.01, color: legCol, bind: lb });
    const fb = rigid(ix[`foot${k}`]);
    const [ax, ay, az] = L.ankle;
    for (const a of [-0.42, 0, 0.42]) {
      kit.loft([ps(ax, ay + 0.004, az, 0.011, 0.011), ps(ax + 0.032 * Math.cos(a), ay - 0.012, az + side * 0.032 * Math.sin(a), 0.008, 0.008), ps(ax + 0.06 * Math.cos(a), ay - 0.03, az + side * 0.06 * Math.sin(a), 0.005, 0.005)],
        { ref: [0, 0, 1], rings: 3, sides: 5, start: 'round', end: 'round', capDepth: 0.006, color: legCol, bind: fb });
    }
    kit.loft([ps(ax, ay + 0.004, az, 0.01, 0.01), ps(ax - 0.03, ay - 0.012, az, 0.007, 0.007), ps(ax - 0.05, ay - 0.026, az, 0.004, 0.004)], { ref: [0, 0, 1], rings: 3, sides: 5, start: 'round', end: 'round', capDepth: 0.005, color: legCol, bind: fb });
  }

  const geo = kit.build({ ground: 0 });
  const attach = featherWings(spec, {
    span: Sx.span, joints: Lay.wing, cover: pal.primary, flight: mixC(pal.secondary, '#ffffff', species === 'corvid' ? 0.04 : 0.12),
    tip: species === 'corvid' ? mixC(pal.secondary, '#6a7ab0', 0.5) : v.aura || ctx.grand ? pal.accent : null, ...Sx.wing,
  });
  if (ex.has('flames')) attach.push(flamePiece(spec, ctx, Sx, Lay));
  const rig = { bodyY: cy, stride: 1, weapon: v.weapon, info: WEAPON_INFO[v.weapon] || WEAPON_INFO.none, plan: 'bird' };
  const triangles = geo.userData.triangles + attach.reduce((s, a) => s + (a.geo.userData.triangles ?? a.geo.attributes.position.count / 3), 0);
  return {
    kind: 'bird', rich: { spec, geo, attach, dims: { shoulderY: cy + 0.15, shoulderZ: 0.07 }, carryAt: Lay.chest, plan: 'bird', ix }, parts: [], rig,
    triangles, meshes: 1 + attach.length,
  };
}

/** The lion head's jaw hinge and ear roots in model space (the Anzu): the same metrics the quadruped uses, placed by the head's frame. */
function lionMetrics(S) {
  const at = [S.head.at[0], S.cy + S.head.at[1], 0];
  const len = 0.4 * S.head.scale / 0.62;
  const m = mammalMetrics('lion', len);
  const M = frameMatrix(at, S.head.pitch, 0, 1);
  return { len, jaw: headToModel(M, m.jawAt), ears: [1, -1].map((side) => headToModel(M, [m.earAt[0], m.earAt[1], m.earAt[2] * side])) };
}

/**
 * Tongues of flame licking up from the back and trailing from the rump (the Bennu's, riding the body bone, flickering).
 */
function flamePiece(spec, ctx, S, Lay) {
  const { pal } = ctx;
  const kit = new MeshKit(null, { sides: 6 });
  const cy = Lay.cy;
  const flame = (base, dir, L, r, bend = 0.45) => {
    const l = Math.hypot(...dir);
    tongue(kit, pal, base, dir.map((x) => x / l), L, r, { bend, k: 0.33, sides: 5, n: 4, rings: 4, cap: 2 });
  };
  // along the back, over the shoulders: two rows leaning back
  for (let i = 0; i < 6; i++) {
    const x = 0.17 - i * 0.065;
    const b = bodyAt(S, x);
    for (const side of [-1, 1]) {
      const z = side * b.rz * 0.5;
      flame([x, b.y + b.ry * 0.92, z], [-0.25 - 0.05 * i, 1, side * 0.25], 0.12 - 0.012 * i, 0.026 - 0.002 * i);
    }
  }
  // the tail's base: a few tongues streaming back
  for (let i = 0; i < 4; i++) {
    const t = Lay.tail[Math.min(i, Lay.tail.length - 1)];
    flame([t[0], t[1] + 0.012, 0], [-0.7, 0.5 + 0.15 * (i % 2), (i - 1.5) * 0.18], 0.16 - 0.02 * i, 0.024);
  }
  const o = spec.pos[spec.ix.body];
  return { name: 'flames', bone: spec.ix.body, geo: finishGear(kit, intoBone(o)), flicker: true };
}
