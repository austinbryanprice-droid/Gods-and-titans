// Feathered wings for the rich creatures (the pegasus, the lamassu, the birds ...): an inner and an outer rigid piece a
// side that hang from two bones, posed by rich-creature-anim.js (the secondaries and coverts ride the inner bone, the
// primaries the outer one, so a wing flaps with its tip lagging and folds at the wrist). Built spread and swept back, in
// model space, then moved into their bone's frame. The same make as the humanoid's wings (rich-regalia.js wingPieces).
import * as THREE from 'three';
import { MeshKit, ps } from './rich-kit.js';
import { finishGear } from './rich-gear.js';
import { feather } from './rich-feathers.js';
import { shadeC } from './unit-geo.js';
import { lerp } from './rich-paint.js';

/** Where the right wing's root and wrist sit (the left mirrors them): the shoulder, then out and up by the span. */
export function wingJoints(root, span, { back = 0.045, up = 0.2, out = 0.5 } = {}) {
  return { root, wrist: [root[0] - back * span, root[1] + up * span, root[2] + out * span] };
}

/** The wing bones a creature plan adds to its skeleton: [name, parent, position] for both sides. */
export function wingBones(parent, joints) {
  const { root, wrist } = joints;
  const list = [];
  for (const side of [1, -1]) {
    const k = side > 0 ? 'R' : 'L';
    list.push([`wing${k}1`, parent, [root[0], root[1], root[2] * side]], [`wing${k}2`, `wing${k}1`, [wrist[0], wrist[1], wrist[2] * side]]);
  }
  return list;
}

/**
 * The attach pieces of the wings (named wingR1 ...). o: { span, joints: { root, wrist }, cover, flight (colors), tip (color
 * or null), nSec, nPri, wide (feather width, 1), long (feather length, 1), coverts (rows 1..2) }.
 */
export function featherWings(spec, o) {
  const S = o.span;
  const { root, wrist } = o.joints;
  const nSec = o.nSec ?? 6;
  const nPri = o.nPri ?? 7;
  const wide = o.wide ?? 1;
  const long = o.long ?? 1;
  const flightC = o.flight;
  const covertC = o.cover;
  const out = [];
  for (const side of [1, -1]) {
    const R = [root[0], root[1], root[2] * side];
    const W = [wrist[0], wrist[1], wrist[2] * side];
    const k = side > 0 ? 'R' : 'L';
    const b1 = spec.ix[`wing${k}1`];
    const b2 = spec.ix[`wing${k}2`];
    const inner = new MeshKit(null, { sides: 6 });
    const outer = new MeshKit(null, { sides: 6 });
    const at = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const up = [0, 1, 0];
    // the leading edge: shoulder to wrist to the tip of the hand
    const tip = [W[0] - 0.06 * S, W[1] + 0.03 * S, W[2] + side * 0.42 * S];
    inner.loft([ps(R[0], R[1], R[2], 0.022 * S * 1.2), ps(...at(R, W, 0.5), 0.017 * S * 1.2), ps(W[0], W[1], W[2], 0.014 * S * 1.2)],
      { ref: [1, 0, 0], rings: 4, sides: 6, start: 'round', end: null, capDepth: 0.014 * S, color: shadeC(covertC, 0.82), mat: 'feather' });
    outer.loft([ps(W[0], W[1], W[2], 0.014 * S * 1.2), ps(...at(W, tip, 0.5), 0.011 * S * 1.2), ps(tip[0], tip[1], tip[2], 0.006 * S)],
      { ref: [1, 0, 0], rings: 4, sides: 6, start: null, end: 'round', capDepth: 0.01 * S, color: shadeC(covertC, 0.82), mat: 'feather' });
    // secondaries along the inner arm, sweeping back and a little down
    for (let i = 0; i < nSec; i++) {
      const t = 0.08 + (0.86 * i) / Math.max(1, nSec - 1);
      const kk = 1 - Math.abs(t - 0.55) * 0.5;
      const dir = [-1, -0.18 - 0.06 * t, side * (0.1 + 0.34 * t)];
      feather(inner, at(R, W, t), dir, up, 0.5 * S * kk * long, 0.04 * S * wide * (6 / nSec) ** 0.5, { color: flightC, tip: o.tip, bend: [0, -0.03 * S, 0], thick: 0.003 * S, rows: 4 });
    }
    // primaries fan out of the wrist, the outermost longest and nearly straight out
    for (let i = 0; i < nPri; i++) {
      const kk = i / Math.max(1, nPri - 1);
      const a = lerp(0.18, 1.3, kk);
      const dir = [-Math.cos(a) * 0.95, -0.06 - 0.12 * (1 - kk), side * Math.sin(a)];
      feather(outer, at(W, tip, kk * 0.5), dir, up, (0.5 + 0.2 * Math.sin(kk * 2.2)) * S * long, 0.04 * S * wide * (7 / nPri) ** 0.5, { color: flightC, tip: o.tip, bend: [-0.02 * S, -0.025 * S, 0], thick: 0.003 * S, rows: 4 });
    }
    // coverts: shorter feathers over the roots of the flight feathers
    for (let i = 0; i < 5; i++) {
      const t = 0.1 + (0.8 * i) / 4;
      feather(inner, at(R, W, t), [-1, -0.1, side * (0.1 + 0.3 * t)], up, 0.26 * S * long, 0.034 * S * wide, { color: covertC, tip: null, bend: [0, -0.02 * S, 0], thick: 0.003 * S, mat: 'feather', rows: 3 });
    }
    for (let i = 0; i < 4; i++) {
      const kk = i / 3;
      const a = lerp(0.3, 1.2, kk);
      feather(outer, at(W, tip, 0.2 + kk * 0.4), [-Math.cos(a) * 0.95, -0.05, side * Math.sin(a)], up, 0.3 * S * long, 0.034 * S * wide, { color: covertC, tip: null, bend: [-0.01 * S, -0.015 * S, 0], thick: 0.003 * S, rows: 3 });
    }
    const m1 = new THREE.Matrix4().makeTranslation(-spec.pos[b1][0], -spec.pos[b1][1], -spec.pos[b1][2]);
    const m2 = new THREE.Matrix4().makeTranslation(-spec.pos[b2][0], -spec.pos[b2][1], -spec.pos[b2][2]);
    out.push({ name: `wing${k}1`, bone: b1, geo: finishGear(inner, m1), wing: true });
    out.push({ name: `wing${k}2`, bone: b2, geo: finishGear(outer, m2), wing: true });
  }
  return out;
}
