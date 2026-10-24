// The heads of the rich elephant (rich-elephant.js): a tall domed skull with a face like a wall, a trunk that hangs from it in a
// chain of five bones, two curving tusks, two broad ears that flap on bones of their own, the small gentle eyes. A head is modeled in
// a frame of its own, 1 long from the back of the skull (the origin, where the head bone is) to the front of the face, facing +X;
// `len` scales it and `kit.placed` puts it on the body (as the mammal heads, rich-mammal-heads.js). A bind given to a piece that is
// built inside the frame is asked for the point in the frame's own coordinates, so the trunk's weights run along the trunk's points
// as they are here (`trunkPoints`) and the skull's back is blended into the body by a wrapper that turns the point into model space.
import { shadeC, mixC, withMat } from './unit-geo.js';
import { ps, rigid, alongPath, mixBind, smoothstep } from './rich-kit.js';
import { frameMatrix, headToModel, pathStations } from './rich-creature-kit.js';
import { eyes } from './rich-mammal-heads.js';
import { collar } from './rich-creature-parts.js';
import { feather } from './rich-feathers.js';
import { clamp, lerp, mul, tint, dye } from './rich-paint.js';

const PI = Math.PI;
const TAU = PI * 2;

const PINK = '#e8b4a8';

/** The skull, in head lengths: [x, yCenter, ryVertical, rzLateral, n] from the back of the head to the face (the face ends in a round cap). */
const SKULL = [
  [0.0, 0.05, 0.3, 0.25, 2.2],
  [0.1, 0.1, 0.42, 0.31, 2.3],
  [0.28, 0.14, 0.47, 0.335, 2.4],
  [0.5, 0.1, 0.45, 0.325, 2.4],
  [0.72, 0.02, 0.41, 0.29, 2.4],
  [0.88, -0.06, 0.36, 0.24, 2.4],
  [0.97, -0.12, 0.3, 0.19, 2.4],
];

/** What `eyes` (rich-mammal-heads.js) reads of a head: the skull it sits on, where the eye is [x, y, _, radius]. */
const EYE_TABLE = { skull: SKULL, eye: [0.62, 0.03, 0, 0.036], round: true };

/** The trunk: [x, y, ry (fore and aft), rz (sideways)] from inside the face to the tip, in head lengths. */
const TRUNK = [
  [0.86, -0.02, 0.15, 0.19],
  [0.99, -0.22, 0.14, 0.18],
  [1.05, -0.5, 0.118, 0.145],
  [1.07, -0.82, 0.096, 0.115],
  [1.06, -1.12, 0.078, 0.092],
  [1.07, -1.38, 0.064, 0.074],
  [1.15, -1.56, 0.05, 0.056],
];

/** The head bone's children: the trunk's five bones sit at TRUNK[1] .. TRUNK[5] (the first stretch, in the face, belongs to the head), the ears' two feet. */
export const TRUNK_BONES = 5;

/** Head-local positions the plan needs before the head is built: the trunk's points (the bones sit at the first five after the first) and the ears' feet, scaled by len. */
export function elephantMetrics(len) {
  return {
    trunk: TRUNK.map(([x, y]) => [x * len, y * len, 0]),
    ear: (side) => [0.37 * len, 0.06 * len, side * 0.3 * len],
  };
}

/** The skull's [yCenter, ryVertical, rzLateral] at x along the head (straight between its stations). */
function skullAt(x) {
  let i = 0;
  while (i < SKULL.length - 2 && x > SKULL[i + 1][0]) i++;
  const t = clamp((x - SKULL[i][0]) / (SKULL[i + 1][0] - SKULL[i][0]));
  return [lerp(SKULL[i][1], SKULL[i + 1][1], t), lerp(SKULL[i][2], SKULL[i + 1][2], t), lerp(SKULL[i][3], SKULL[i + 1][3], t), lerp(SKULL[i][4], SKULL[i + 1][4], t)];
}

/** The height of the skull's surface at x and a sideways offset z (the skull's top), or its lowest height with `below`. */
function surfaceY(x, z, below = false) {
  const [yc, ry, rz, n] = skullAt(x);
  const k = clamp(Math.abs(z) / rz, 0, 0.985);
  const h = ry * (1 - k ** n) ** (1 / n);
  return below ? yc - h : yc + h;
}

/** Wrap a bind made for model space so that it can be asked for points in the frame M (a head's). */
const inModel = (M, bind) => (x, y, z, S) => {
  const p = headToModel(M, [x, y, z]);
  bind(p[0], p[1], p[2], S);
};

/** A tapering tusk path: [x, y, z, radius], from the root in the face out and up, in head lengths (the right one; the left mirrors it). */
const TUSK = [[0.84, -0.3, 0.17, 0.062], [0.98, -0.45, 0.25, 0.056], [1.18, -0.54, 0.33, 0.047], [1.42, -0.48, 0.38, 0.036], [1.62, -0.3, 0.37, 0.02], [1.72, -0.13, 0.34, 0.004]];

/** The ear, in the head's frame: a rounded triangle hung from the side of the skull, reaching out and back (`side` 1 the right, -1 the left). u 0..1 from the foot to the edge, v 0..1 from the top down to the point. */
const EAR = { w: 0.6, h: 0.86 };
function earPoint(side, u, v, out) {
  const f = v;
  // the width of the ear at f: broad at the top, widest a third of the way down, closing in a round to the point
  const prof = f < 0.3 ? 0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - ((0.3 - f) / 0.3) ** 2)) : Math.sqrt(Math.max(0, 1 - ((f - 0.3) / 0.7) ** 2.1));
  const e = u * EAR.w * prof;
  // the foot runs down the side of the head, behind the eye
  const ax = 0.42 - 0.08 * f;
  const ay = 0.36 - EAR.h * f * 0.72;
  const az = 0.295 + 0.02 * f;
  // out, a little back and drooping; the edge curls forward
  const drop = 0.3 * e * e;
  out[0] = ax - 0.36 * e + 0.2 * e * e * (1 - 0.4 * f) - 0.05 * f * u;
  out[1] = ay - 0.12 * e - drop - 0.06 * u * f;
  out[2] = side * (az + 0.9 * e);
}

/**
 * An elephant's head built into `kit`: o: { at, pitch, yaw, len, bind: { head, trunk: [5 bones], ear: { 1, -1 }, body (a model-space bind that the back of
 * the skull is blended into, optional) }, hide (the skin), pink (the inside of the ear, the tip of the trunk), ivory (the tusks), gold (the rings on the
 * tusks), cloth (the forehead cloth, a color or TEAM), trim (the cloth's border), plume: { gold, red } or null, lean (a lighter build: the side heads'),
 * paint (a recoloring of the skin) }.
 */
export function elephantHead(kit, o) {
  const len = o.len;
  const lean = !!o.lean;
  const M = frameMatrix(o.at, o.pitch ?? 0, o.yaw ?? 0, len);
  const hide = o.hide;
  const pink = o.pink ?? mixC(hide, PINK, 0.55);
  const dark = shadeC(hide, 0.74);
  const head = o.bind.head;
  const skin = (oo, x, y, z, u, a) => {
    if (o.paint) o.paint(oo, x, y, z, u, a);
  };
  const skullBind = o.bind.body ? mixBind(head, inModel(M, o.bind.body), (x) => smoothstep(0.34, 0.02, x)) : head;
  const trunkPts = TRUNK.slice(1).map(([x, y]) => [x, y, 0]);
  const trunkBind = alongPath(o.bind.trunk, trunkPts, 0.11);

  kit.placed(M, () => {
    // the skull: a tall dome over a flat face, the wrinkles of old skin on it
    kit.loft(SKULL.map(([x, y, ry, rz, n]) => ps(x, y, 0, ry, rz, n)), {
      ref: [0, 1, 0], rings: lean ? 7 : 11, sides: lean ? 11 : 14, start: 'round', end: 'round', capRings: lean ? 2 : 3, capDepth: [0.1, 0.07], color: hide, bind: skullBind,
      paint: (oo, x, y, z, u, a) => {
        skin(oo, x, y, z, u, a);
        // a pale cheek and brow
        tint(oo, pink, 0.2 * smoothstep(0.5, 0.95, u) * (1 - smoothstep(0.1, 0.45, Math.abs(y - 0.02))));
        // the two domes of the forehead, with a shallow groove between them
        if (Math.abs(z) < 0.03 && y > 0.3) mul(oo, 0.93);
      },
    });

    // the trunk: wide at the face, ringed with creases, thinning to a tip that curls forward and ends in a finger
    kit.loft(pathStations(TRUNK.map(([x, y, ry, rz]) => [x, y, 0, ry, rz]), lean ? 9 : 12), {
      ref: [1, 0, 0], sides: lean ? 8 : 10, start: null, end: 'round', capRings: 2, capDepth: 0.035, color: hide, bind: trunkBind,
      paint: (oo, x, y, z, u, a) => {
        skin(oo, x, y, z, u, a);
        // creases across it, closer set toward the tip
        const crease = Math.sin(u * (46 + 38 * u) + 0.8);
        mul(oo, 1 - 0.14 * smoothstep(0.62, 0.95, crease));
        // paler underneath and at the tip, pink at the very end
        tint(oo, pink, 0.28 * smoothstep(0.3, 0.9, -Math.cos(a * TAU)) + 0.5 * smoothstep(0.86, 1, u));
      },
    });
    // the finger at the tip
    const tip = TRUNK[TRUNK.length - 1];
    kit.loft([ps(tip[0] - 0.03, tip[1] + 0.02, 0, 0.034, 0.05), ps(tip[0] + 0.03, tip[1] - 0.005, 0, 0.026, 0.042), ps(tip[0] + 0.1, tip[1] + 0.018, 0, 0.012, 0.022)], {
      ref: [0, 1, 0], rings: 4, sides: 8, start: null, end: 'round', capRings: 2, capDepth: 0.02, color: mixC(hide, PINK, 0.62), bind: rigid(o.bind.trunk[TRUNK_BONES - 1]),
    });

    // the tusks: ivory, curving out and up, a ring of gold at the root and another along them
    for (const side of [1, -1]) {
      const keys = TUSK.map(([x, y, z, r]) => [x, y, side * z, r, r]);
      kit.loft(pathStations(keys, lean ? 6 : 8), {
        ref: [0, 1, 0], sides: lean ? 6 : 8, start: 'round', end: 'round', capRings: 2, capDepth: [0.03, 0.012], color: o.ivory, mat: 'bone', bind: head,
        paint: (oo, x, y, z, u) => {
          mul(oo, 0.88 + 0.12 * smoothstep(0, 0.35, u));
          tint(oo, mixC(o.ivory, '#8a7a58', 0.5), 0.5 * smoothstep(0.85, 1, u));
        },
      });
      const [x, y, z, r] = TUSK[1];
      const [x2, y2, z2] = TUSK[2];
      collar(kit, { at: [x, y, side * z], dir: [x2 - x, y2 - y, side * (z2 - z)], rx: r * 1.2, rz: r * 1.2, h: 0.03, color: o.gold, mat: 'gold', bind: head, sides: 8 });
    }

    // the eyes: small, dark and mild
    eyes(kit, EYE_TABLE, { bind: { head } }, withMat('#5a3a22', 'gloss'), 0, false, true);
    // a heavy lid over each
    for (const side of lean ? [] : [1, -1]) {
      const [x, y, , r] = EYE_TABLE.eye;
      const yb = y + r * 1.15;
      const z = side * (skullAt(x)[2] * (1 - 0.04));
      kit.loft([ps(x - 0.05, yb, z * 0.96, 0.012, 0.03), ps(x + 0.01, yb + 0.006, z, 0.016, 0.034), ps(x + 0.07, yb - 0.004, z * 0.98, 0.01, 0.028)], {
        ref: [0, 1, 0], rings: 3, sides: 6, start: 'round', end: 'round', capRings: 1, capDepth: 0.01, color: dark, bind: head,
      });
    }

    // the ears: hung from the sides of the head, a vein-pink lining; they flap on bones of their own
    for (const side of [1, -1]) {
      if (lean && side === (o.inner ?? 0)) continue;
      const eb = o.bind.ear[side];
      const earBind = (x, y, z, S) => {
        const w = smoothstep(0.01, 0.2, Math.abs(z) - 0.3);
        if (w < 1) S.add(head, 1 - w);
        if (w > 0) S.add(eb, w);
      };
      kit.sheet(lean ? 4 : 5, lean ? 5 : 7, (u, v, out) => earPoint(side, side > 0 ? u : 1 - u, v, out), {
        thick: 0.007, color: hide, inner: pink, bind: earBind,
        paint: (oo, x, y, z, u, v) => {
          skin(oo, x, y, z, u, v);
          // darker veins and a pale rim
          mul(oo, 1 - 0.07 * smoothstep(0.7, 0.95, Math.sin(v * 31 + u * 5)));
        },
      });
    }

    // the forehead cloth in the team's color: over the dome, down the face to the root of the trunk, bordered and hung with a fringe of gold
    if (o.cloth) {
      const half = lean ? 0.12 : 0.14;
      kit.sheet(3, lean ? 7 : 10, (u, v, out) => {
        // v runs from the poll, over the dome, down the face
        let x;
        let y;
        const wv = half * (1 - 0.35 * smoothstep(0.7, 1, v)) * (1 + 0.15 * Math.sin(v * PI));
        const z = (u - 0.5) * 2 * wv;
        if (v < 0.78) {
          x = lerp(0.14, 0.97, v / 0.78);
          y = surfaceY(x, z) + 0.014;
        } else {
          const f = (v - 0.78) / 0.22;
          x = 0.985 + 0.012 + 0.45 * z * z;
          y = lerp(surfaceY(0.97, z) + 0.01, -0.3, f ** 1.05);
          // (the lower edge is cut in points)
          y -= 0.05 * f * Math.abs(Math.sin(u * PI * 2));
        }
        out[0] = x;
        out[1] = y;
        out[2] = z;
      }, {
        thick: 0.007, color: o.cloth, inner: shadeC(o.trim ?? o.gold, 0.8), bind: head,
        paint: (oo, x, y, z, u, v) => {
          // a border of gold along both edges and across the lower end, a band of it between
          if (Math.abs(u - 0.5) > 0.42 || v > 0.965 || Math.abs(v - 0.55) < 0.03) dye(oo, o.trim ?? o.gold, 0.9);
        },
      });
    }

    // a fan of plumes over the dome, gold and red, swept up and back
    if (o.plume) {
      const root = [0.2, 0.58, 0];
      const n = 7;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        const a = lerp(-0.15, 1.55, k);
        const d = [Math.cos(a) * 0.55 + 0.1, Math.sin(a), 0];
        const dl = Math.hypot(d[0], d[1]);
        const reach = 0.46 + 0.36 * Math.sin(PI * (0.15 + 0.7 * k));
        feather(kit, root, [d[0] / dl, d[1] / dl, 0], [0, 0, 1], reach, 0.07 + 0.015 * Math.sin(PI * k), {
          color: i % 2 ? o.plume.red : o.plume.gold, tip: i % 2 ? shadeC(o.plume.red, 0.75) : o.plume.red, bind: head, bend: [-0.1, -0.06, 0], cup: 0.3, rows: 4,
        });
      }
      // the gold plate the plumes stand in
      kit.loft([ps(0.1, 0.55, 0, 0.034, 0.1), ps(0.2, 0.6, 0, 0.044, 0.12), ps(0.3, 0.58, 0, 0.034, 0.1)], {
        ref: [0, 1, 0], rings: 4, sides: 10, start: 'round', end: 'round', capRings: 2, capDepth: 0.03, color: o.gold, mat: 'gold', bind: head,
      });
    }
  });
}
