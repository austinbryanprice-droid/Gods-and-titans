// The leathery wings of the Sasabonsam: a bat's. An arm from the shoulder to the wrist and four long fingers fanned out from the
// wrist, a membrane of dark leather stretched between the fingers and from the last of them back to the body, a hooked claw at
// the wrist. Two rigid pieces a side (the arm and the membrane behind it ride the first wing bone, the fingers and the fans of
// membrane between them the second), posed by rich-anim.js like the feathered wings of the others (rich-regalia.js wingPieces):
// built spread and swept back, in model space, then moved into their bone's frame.
import * as THREE from 'three';
import { MeshKit, ps, B } from './rich-kit.js';
import { finishGear } from './rich-gear.js';
import { shadeC, mixC } from './unit-geo.js';
import { lerp, clamp, mul, tint } from './rich-paint.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The three long fingers of the right wing (out is +Z): [direction from the wrist, length in spans]. The fourth runs to the hip. */
const FINGERS = [
  [[-0.12, 0.3, 1], 0.92],
  [[-0.5, 0.06, 0.9], 0.98],
  [[-0.9, -0.14, 0.62], 0.86],
];

/**
 * The attach pieces of the wings (named wingR1 ...). layout: { span, root, wrist } as wingLayout (rich-regalia.js) gives. The
 * membrane is the leather of the unit's secondary and skin colors, the bones its skin, the claw its metal.
 */
export function batWingPieces(ctx, D, spec, layout) {
  const { pal } = ctx;
  const S = layout.span;
  const leather = mixC(pal.secondary, pal.skin, 0.4);
  const bone = shadeC(pal.skin, 0.8);
  const veins = shadeC(leather, 0.62);
  const edge = mixC(leather, '#8a3a2a', 0.28);
  const out = [];
  for (const side of [1, -1]) {
    const R = layout.root.map((x, i) => (i === 2 ? x * side : x));
    const W = layout.wrist.map((x, i) => (i === 2 ? x * side : x));
    const H = [-D.depth * 0.5 - 0.03, D.hipY + 0.03, side * 0.11 * D.k];
    const bone1 = side > 0 ? B.wingR1 : B.wingL1;
    const bone2 = side > 0 ? B.wingR2 : B.wingL2;
    const inner = new MeshKit(null, { sides: 7 });
    const outer = new MeshKit(null, { sides: 6 });
    // the fingers: a curve from the wrist, sweeping back and drooping toward the tip
    const dirs = FINGERS.map(([d]) => norm([d[0], d[1], d[2] * side]));
    const lens = FINGERS.map(([, l]) => l * S);
    const finger = (j, t) => {
      if (j === 3) return lerp3(W, add(H, [0, 0.0, 0]), t * 0.94);
      const d = dirs[j];
      const L = lens[j];
      return [W[0] + d[0] * L * t - 0.07 * S * t * t, W[1] + d[1] * L * t - 0.12 * S * t * t, W[2] + d[2] * L * t];
    };
    // the arm
    const mid = add(lerp3(R, W, 0.5), [-0.025 * S, 0.0, 0]);
    inner.loft([ps(R[0], R[1], R[2], 0.034 * S), ps(mid[0], mid[1], mid[2], 0.026 * S), ps(W[0], W[1], W[2], 0.02 * S)],
      { ref: [1, 0, 0], rings: 5, sides: 7, start: 'round', end: null, capDepth: 0.03 * S, color: bone, mat: 'skin' });
    // the membrane behind the arm, down to the hip (the triangle R, W, H), its lower edge scalloped
    inner.sheet(4, 6, (u, v, o) => {
      const s = v;
      const a = u;
      const top = lerp3(R, W, s);
      const bot = lerp3(H, W, s);
      const p = lerp3(top, bot, a);
      o[0] = p[0];
      o[1] = p[1] - 0.025 * S * Math.sin(Math.PI * a) * (1 - s);
      o[2] = p[2];
    }, { thick: 0.0035 * S, color: leather, inner: shadeC(leather, 0.8), mat: 'leather', paint: (o, x, y, z, u, a) => { mul(o, 0.8 + 0.3 * Math.sin(Math.PI * clamp(u))); if (u > 0.85) tint(o, edge, (u - 0.85) * 3); } });
    // the four fingers
    for (let j = 0; j < 4; j++) {
      const pts = [0, 0.3, 0.62, 1].map((t) => finger(j, t));
      const r0 = (j === 3 ? 0.012 : 0.017) * S;
      outer.loft(pts.map((p, i) => ps(p[0], p[1], p[2], r0 * (1 - 0.7 * (i / 3)))), { ref: [1, 0, 0], rings: 6, sides: 6, start: 'round', end: 'round', capDepth: r0 * 0.6, color: bone, mat: 'skin' });
    }
    // the fans of membrane between the fingers, each edge between two finger tips drawn in a scallop
    for (let j = 0; j < 3; j++) {
      outer.sheet(4, 6, (u, v, o) => {
        const a = u;
        const t = v;
        const p = lerp3(finger(j, t), finger(j + 1, t), a);
        const pull = 1 - 0.17 * Math.sin(Math.PI * a) * t ** 3;
        o[0] = W[0] + (p[0] - W[0]) * pull;
        o[1] = W[1] + (p[1] - W[1]) * pull - 0.03 * S * Math.sin(Math.PI * a) * t;
        o[2] = W[2] + (p[2] - W[2]) * pull;
      }, {
        thick: 0.0035 * S, color: leather, inner: shadeC(leather, 0.8), mat: 'leather',
        paint: (o, x, y, z, u, a) => {
          // darker along the fingers, a vein or two between them, paler and redder toward the edge
          mul(o, 0.74 + 0.36 * Math.sin(Math.PI * clamp(u)) ** 0.7 + 0.04 * Math.sin(a * 21 + j));
          if (a > 0.7) tint(o, edge, (a - 0.7) * 1.2);
          if (Math.abs(u - 0.5) < 0.03 && a > 0.1) tint(o, veins, 0.5);
        },
      });
    }
    // the claw on the wrist: a hook, pointing up and forward
    const c0 = W;
    const cl = norm([0.5, 1, side * 0.25]);
    outer.loft([0, 0.5, 1].map((t, i) => ps(c0[0] + cl[0] * 0.08 * S * t + 0.02 * S * t * t, c0[1] + cl[1] * 0.08 * S * t - 0.015 * S * t * t, c0[2] + cl[2] * 0.08 * S * t, 0.014 * S * (1 - 0.9 * t))),
      { ref: [1, 0, 0], rings: 4, sides: 5, start: 'round', end: 'round', capDepth: 0.008 * S, color: pal.accentMetal, mat: 'metal' });
    const m1 = new THREE.Matrix4().makeTranslation(-spec.pos[bone1][0], -spec.pos[bone1][1], -spec.pos[bone1][2]);
    const m2 = new THREE.Matrix4().makeTranslation(-spec.pos[bone2][0], -spec.pos[bone2][1], -spec.pos[bone2][2]);
    out.push({ name: side > 0 ? 'wingR1' : 'wingL1', bone: bone1, geo: finishGear(inner, m1), wing: true });
    out.push({ name: side > 0 ? 'wingR2' : 'wingL2', bone: bone2, geo: finishGear(outer, m2), wing: true });
  }
  return out;
}

