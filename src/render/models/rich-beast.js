// What the upright beasts (the body beast_biped, dressed on the humanoid rig by the pantheon outfits) have that people do not:
// claws on the hands, talons or paws for feet, legs of fur or scale, a lion's mane or a hyena's crest, a long or a bushy tail.
// Each piece takes the dressing environment E (rich-outfit-default.js says what it holds) and adds primitives to E.kit; the
// leathery wings of the Sasabonsam are rich-beast-wings.js's.
import { ps, vs, B, rigid } from './rich-kit.js';
import { torsoRing, legStations } from './rich-body.js';
import { lionMane } from './rich-creature-hair.js';
import { tuft } from './rich-creature-parts.js';
import { clamp, lerp, hash, mul, tint } from './rich-paint.js';

const unit = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * A claw or a talon: a tapering horn from `at` along `dir`, `len` long, curling by `curl` (a vector times len, added toward the
 * tip) and `r` thick at the root, its root closed (it is set into the finger).
 */
function talon(kit, { at, dir, curl = [0, 0, 0], len, r, color, mat = 'bone', bind, sides = 5, rings = 3 }) {
  const d = unit(dir);
  const st = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const rr = Math.max(0.0012, r * (1 - t ** 1.2 * 0.96));
    st.push(ps(at[0] + d[0] * len * t + curl[0] * len * t * t, at[1] + d[1] * len * t + curl[1] * len * t * t, at[2] + d[2] * len * t + curl[2] * len * t * t, rr, rr));
  }
  kit.loft(st, { ref: [0, 0, 1], sides, start: 'round', end: 'round', capRings: 1, capDepth: r * 0.5, color, mat, bind });
}

/**
 * Claws on both hands: `n` of them across the fingers, hooked down and forward at the tips, the outer ones a little shorter.
 * opts: color, len (scale of the length), r (of the thickness).
 */
export function addClaws(E, { color, len = 1, r = 1, n = 4 } = {}) {
  const { kit, D, bind } = E;
  const hr = D.handR / 0.048;
  const w = D.shoulderY - 0.02 - D.upper - D.fore;
  for (const side of [1, -1]) {
    const z0 = side * D.shoulderZ;
    for (let k = 0; k < n; k++) {
      const c = k - (n - 1) / 2;
      const L = len * (0.082 - 0.012 * Math.abs(c) / ((n - 1) / 2 || 1)) * hr;
      talon(kit, {
        at: [0.012 * hr + 0.002 * Math.abs(c), w - 0.088 * hr, z0 + c * 0.0225 * hr], dir: [0.3, -0.95, c * 0.06], curl: [0.62, -0.2, c * 0.1],
        len: L, r: 0.0112 * hr * r, color, bind: bind.arm[side],
      });
    }
  }
}

/** A tube along a path of [x, y, z, r] points, rounded at both ends. */
function tube(kit, pts, o) {
  kit.loft(pts.map(([x, y, z, rr]) => ps(x, y, z, rr, rr * (o.flat ?? 1))), { ref: o.ref || [0, 1, 0], rings: o.rings ?? pts.length, sides: o.sides ?? 7, start: 'round', end: 'round', capRings: 1, capDepth: pts[0][3] * 0.6, color: o.color, mat: o.mat, bind: o.bind, paint: o.paint });
}

/**
 * The legs of a beast: fur (or scale) to the ankle, the shank slimmer by `lower` (1: a man's, less: a bird's long thin shank),
 * from a little under the ankle up to the thigh. opts: color, paint, lower, sides (more than the kit's, for a pattern in the coat).
 */
export function addBeastLegs(E, { color, paint = null, lower = 1, sides } = {}) {
  const { kit, D, bind } = E;
  const r = D.legR;
  const ks = [lower, lower, lerp(lower, 1, 0.3), lerp(lower, 1, 0.55), 1, 1, 1];
  for (const side of [1, -1]) {
    const z = side * D.hipZ;
    const st = legStations(D, side).map((s, i) => ({ ...s, rx: s.rx * ks[i], rz: s.rz * ks[i] }));
    kit.loft([vs(D.ankleY - 0.03, r * 0.62 * lower, r * 0.58 * lower, 0, z), ...st], { rings: 9, sides, start: null, end: null, color, bind: bind.leg[side], paint });
  }
}

/**
 * Feet of an eagle's or a bat's kind: a pad at the ankle, three long toes fanned forward and one back, each ending in a hooked
 * claw (the iron hooks of the Sasabonsam, the talons of the Ugallu). opts: color, claw, mat (of the claws), k (scale), paint.
 */
export function addTalonFeet(E, { color, claw, clawMat = 'bone', k = 1, paint = null } = {}) {
  const { kit, D } = E;
  const sc = (D.legR / 0.068) * k;
  const ay = D.ankleY;
  for (const side of [1, -1]) {
    const z = side * D.hipZ;
    const foot = rigid(side > 0 ? B.footR : B.footL);
    // the pad under the ankle: a low mound the toes spring from
    kit.loft([ps(-0.022 * sc, ay - 0.004, z, 0.036 * sc, 0.033 * sc), ps(0.022 * sc, ay - 0.026, z, 0.034 * sc, 0.04 * sc), ps(0.058 * sc, ay - 0.042, z, 0.022 * sc, 0.038 * sc)],
      { ref: [0, 1, 0], rings: 5, sides: 8, start: 'round', end: 'round', capRings: 1, capDepth: 0.02 * sc, color, bind: foot, paint });
    const toes = [[-0.5, 0.82], [0, 1], [0.5, 0.82]];
    for (const [phi, kl] of toes) {
      const cx = Math.cos(phi);
      const sz = Math.sin(phi);
      const L = 0.15 * sc * kl;
      const b0 = [0.04 * sc, 0.034, z + sz * 0.012 * sc];
      const pts = [0, 0.38, 0.7, 1].map((t, i) => [b0[0] + cx * L * t, Math.max(0.011, b0[1] - 0.026 * t * (i ? 1 : 0)), b0[2] + sz * L * t, (0.0235 - 0.0075 * t + (i === 1 ? 0.0035 : 0)) * sc]);
      tube(kit, pts, { color, bind: foot, sides: 6, paint, rings: 5 });
      const tip = pts[3];
      talon(kit, { at: [tip[0], tip[1], tip[2]], dir: [cx * 0.9, -0.42, sz * 0.9], curl: [cx * 0.25, -0.75, sz * 0.25], len: 0.07 * sc * kl, r: 0.0125 * sc, color: claw, mat: clawMat, bind: foot });
    }
    // the back toe, short, its claw hooked down behind the heel
    const hb = [-0.012 * sc, 0.03, z];
    tube(kit, [[hb[0], hb[1], hb[2], 0.02 * sc], [hb[0] - 0.035 * sc, 0.022, hb[2], 0.016 * sc], [hb[0] - 0.062 * sc, 0.015, hb[2], 0.011 * sc]], { color, bind: foot, sides: 6, paint, rings: 3 });
    talon(kit, { at: [hb[0] - 0.062 * sc, 0.015, hb[2]], dir: [-0.85, -0.5, 0], curl: [-0.2, -0.8, 0], len: 0.055 * sc, r: 0.0105 * sc, color: claw, mat: clawMat, bind: foot });
  }
}

/**
 * Feet of a hunting beast: a broad paw with four short toes and a heavy claw on each, standing flat (the were-hyena's).
 * opts: color, claw, paint, k.
 */
export function addPaws(E, { color, claw, paint = null, k = 1 } = {}) {
  const { kit, D } = E;
  const sc = (D.legR / 0.068) * k;
  const ay = D.ankleY;
  for (const side of [1, -1]) {
    const z = side * D.hipZ;
    const foot = rigid(side > 0 ? B.footR : B.footL);
    kit.loft([ps(-0.03 * sc, ay - 0.008, z, 0.052 * sc, 0.052 * sc), ps(0.03 * sc, ay - 0.03, z, 0.044 * sc, 0.064 * sc), ps(0.095 * sc, ay - 0.044, z, 0.027 * sc, 0.066 * sc)],
      { ref: [0, 1, 0], rings: 6, sides: 9, start: 'round', end: 'round', capRings: 2, capDepth: 0.03 * sc, color, bind: foot, paint });
    for (let i = 0; i < 4; i++) {
      const c = i - 1.5;
      const zz = z + c * 0.03 * sc;
      const x0 = 0.104 * sc + 0.006 * sc * (1 - Math.abs(c) / 1.5);
      tube(kit, [[x0 - 0.02 * sc, 0.03, zz, 0.0185 * sc], [x0 + 0.018 * sc, 0.019, zz, 0.0165 * sc]], { color, bind: foot, sides: 6, paint, rings: 2 });
      talon(kit, { at: [x0 + 0.02 * sc, 0.019, zz], dir: [0.95, -0.28, c * 0.12], curl: [0.1, -0.7, c * 0.06], len: 0.052 * sc, r: 0.0105 * sc, color: claw, bind: foot });
    }
  }
}

/**
 * A tail from the small of the back, riding the pelvis: `lion`'s hangs down behind and curves out, thin, ending in a dark tuft
 * of hair; `hyena`'s is short and bushy with a dark tip. opts: color, tip (the tuft's color), len (scale of the length).
 */
export function addBeastTail(E, { kind = 'lion', color = null, tip = null, len = 1 } = {}) {
  const { kit, D, pal } = E;
  const K = D.k * len;
  const col = color || pal.skin;
  const bind = rigid(B.pelvis);
  const root = torsoRing(D, 0.16, 0);
  const x0 = root.dx - root.rx + 0.01;
  const y0 = root.y;
  const dark = tip || mulColor(col, 0.4);
  if (kind === 'lion') {
    const path = [[0, 0, 0.032], [-0.06, -0.012, 0.028], [-0.115, -0.065, 0.025], [-0.15, -0.15, 0.022], [-0.16, -0.25, 0.02], [-0.15, -0.34, 0.019], [-0.14, -0.385, 0.034], [-0.135, -0.43, 0.047], [-0.13, -0.475, 0.04], [-0.125, -0.52, 0.012]];
    kit.loft(path.map(([dx, dy, r]) => ps(x0 + dx * K, y0 + dy * K, 0, r * D.k, r * D.k)), {
      ref: [0, 0, 1], rings: 14, sides: 8, start: 'round', end: 'round', capDepth: [0.012 * K, 0.014 * K], color: col, mat: 'skin', bind,
      paint: (o, x, y, z, u) => {
        mul(o, 0.9 + 0.12 * Math.abs(Math.sin(u * 60 + z * 40)));
        tint(o, dark, clamp((u - 0.66) / 0.14) * 0.92);
      },
    });
    // the tuft's long locks
    for (let i = 0; i < 6; i++) {
      const h = hash(i, 5, 11);
      const a = (i / 6) * Math.PI * 2;
      tuft(kit, {
        at: [x0 - 0.138 * K, y0 - 0.43 * K, Math.sin(a) * 0.026 * K], dir: [Math.cos(a) * 0.3 - 0.12, -1, Math.sin(a) * 0.45], len: (0.1 + 0.04 * h) * K, w: 0.016 * K, th: 0.006 * K,
        bend: [-0.012 * K, -0.02 * K, 0], across: [0, 0, 1], sides: 4, rings: 3, color: dark, bind,
      });
    }
    return;
  }
  // hyena: short, thickening to a brush
  const path = [[0, 0, 0.03], [-0.055, -0.008, 0.034], [-0.11, -0.04, 0.042], [-0.155, -0.1, 0.046], [-0.18, -0.17, 0.043], [-0.19, -0.24, 0.032], [-0.185, -0.285, 0.009]];
  kit.loft(path.map(([dx, dy, r]) => ps(x0 + dx * K, y0 + dy * K, 0, r * D.k, r * D.k)), {
    ref: [0, 0, 1], rings: 11, sides: 8, start: 'round', end: 'round', capDepth: [0.012 * K, 0.016 * K], color: col, mat: 'fur', bind,
    paint: (o, x, y, z, u) => {
      mul(o, 0.88 + 0.2 * Math.abs(Math.sin(u * 50 + z * 70)));
      tint(o, dark, clamp((u - 0.5) / 0.3) * 0.95);
    },
  });
}

const mulColor = (c, k) => ({ r: c.r * k, g: c.g * k, b: c.b * k, mat: c.mat });

/** The width of a rounded lock along its length (1 at the root, round at the tip). */
const scallop = (t) => Math.sqrt(Math.max(0, 1 - t ** 2.4)) * 0.9 + 0.1 * (1 - t);

/**
 * A lion's mane: a halo of broad locks all round the head, swept back and out from behind the cheeks, and rings of them laid over one
 * another from the shoulders up to the neck, lying down over the chest and the back and standing out about the cheeks (never across
 * the face). opts: color, dark (the second tone), tip, size (scale of length), w (the width of a lock).
 */
export function addLionMane(E, { color, dark, tip, size = 1, w = 0.085 } = {}) {
  const { kit, D, bind } = E;
  const hs = D.hs;
  const hx = D.headX;
  const y = (f) => D.shoulderY + (D.headCY - D.shoulderY) * f;
  const st = [
    ps(-0.02, y(-0.1), 0, 0.16, 0.235),
    ps(-0.005, y(0.18), 0, 0.155, 0.215),
    ps(hx * 0.4, y(0.52), 0, 0.15, 0.185),
    ps(hx * 0.75, y(0.86), 0, 0.15, 0.165),
  ];
  lionMane(kit, st, {
    from: -Infinity, len: 0.17 * size * (hs / 1.23), w, color, dark, tip, bind: bind.neck,
    skip: (a, tt) => tt > 0.5 && Math.cos(a) > 0.35,
  });
  // the halo: two layers of broad locks rooted in rings behind the face (the inner one lying out along the radius, the outer one longer
  // and swept back), the tips darker
  const cx = hx - 0.07 * hs;
  const cy = D.headCY - 0.005 * hs;
  const K = size * (hs / 1.23);
  for (const [n, phase, back, reach, rise, len, wide] of [[18, 0.5, 0, 0.108, 0.085, 0.17, 0.62], [16, 0, -0.045, 0.1, 0.08, 0.25, 0.78]]) {
    for (let j = 0; j < n; j++) {
      const h = hash(j, 3, 19 + n);
      const a = ((j + phase) / n) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // (the top of the head is the ears' and the crown's: fewer, shorter locks there)
      const crown = sa > 0.6 ? 0.62 : 1;
      const L = len * K * (0.8 + 0.4 * h) * crown * (1 - 0.18 * Math.abs(ca));
      const swept = back ? 1.1 : 0.5;
      tuft(kit, {
        at: [cx + back * hs, cy + sa * rise * hs, ca * reach * hs], dir: [-swept, sa * 0.7 + 0.1, ca * 0.8], len: L, w: w * wide, th: w * 0.15, bend: [-L * 0.2, -L * 0.28, 0], across: [0, ca, -sa], sides: 4, rings: 4, profile: scallop,
        color: (j + phase * 2) % 3 ? color : dark, bind: bind.head,
        paint: (out, x, yy, z, u) => {
          tint(out, tip, smoothstepU(0.4, 1, u) * 0.7);
          mul(out, 0.86 + 0.26 * h);
        },
      });
    }
  }
}

const smoothstepU = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};

/** The width of a coarse lock along its length: broad at the root, narrowing to a blunt tip. */
const lock = (t) => 1 - t ** 1.7 * 0.9;

/**
 * The hyena's crest: a row of long coarse hairs standing up along the neck and the spine, leaning back, the middle row the tallest,
 * from the crown of the head down to the small of the back. opts: color, dark, tip, size.
 */
export function addHyenaCrest(E, { color, dark, tip, size = 1 } = {}) {
  const { kit, D, bind } = E;
  const rows = [[0, 1], [-0.032, 0.72], [0.032, 0.72]];
  const n = 11;
  for (const [dz, kz] of rows) {
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1); // 0 at the nape .. 1 at the small of the back
      const h = hash(i, Math.round(dz * 100), 17);
      const yy = lerp(D.headCY - 0.07 * D.hs, D.hipY + 0.06, f ** 0.9);
      const ring = torsoRing(D, clamp((yy - D.hipY) / (D.shoulderY - D.hipY), 0, 1.09), 0);
      const nape = yy > D.shoulderY;
      const back = nape ? D.headX * 0.55 - 0.055 : ring.dx - ring.rx;
      const L = (0.13 - 0.05 * f) * kz * size * (0.8 + 0.4 * h);
      tuft(kit, {
        at: [back + 0.012, yy, dz * (nape ? 0.7 : 1)], dir: [-0.5 - 0.3 * f, 1, 0], len: L, w: 0.03 * size, th: 0.01, bend: [-L * 0.45, -L * 0.18, dz * 0.4], across: [0, 0, 1], sides: 4, rings: 4, profile: lock,
        color: i % 3 ? color : dark, bind: nape ? bind.neck : bind.torso, mat: 'fur',
        paint: (out, x, y2, z, u) => tint(out, tip, clamp((u - 0.55) / 0.45) * 0.8),
      });
    }
  }
}

