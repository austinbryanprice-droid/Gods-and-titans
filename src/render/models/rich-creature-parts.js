// Small pieces every rich creature plan reuses: locks of fur (tufts), a spike, a paw or a hoof, a collar, a glowing ring.
// Each is built into a MeshKit in model space and bound by a bind function (rich-kit.js), so a piece follows
// whichever bone (or run of bones) the caller gives it.
import { ps } from './rich-kit.js';
import { mul } from './rich-paint.js';

/**
 * A lock of fur, a feather quill or a spine: a tapering blade from `at` along `dir`, `len` long, bending toward
 * `bend` (a vector added at the tip: the weight of the hair), `w` wide (along `across`, default the model's Z axis)
 * and `th` thick, ending in a point (a blunt one with `blunt`, or the shape `profile(t)` gives: the width factor at t along it).
 * o: { at, dir, len, w, th, bend, across, color, bind, mat, paint, sides, rings, blunt, profile }.
 */
export function tuft(kit, o) {
  const { at, len } = o;
  const d = o.dir;
  const dl = Math.hypot(d[0], d[1], d[2]) || 1;
  const bend = o.bend || [0, 0, 0];
  const th = o.th ?? o.w * 0.4;
  const rings = o.rings ?? 4;
  const st = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const taper = o.profile ? o.profile(t) : o.blunt ? 1 - t ** 2.6 * 0.82 : 1 - t ** 1.6 * 0.96;
    st.push(ps(
      at[0] + (d[0] / dl) * len * t + bend[0] * t * t,
      at[1] + (d[1] / dl) * len * t + bend[1] * t * t,
      at[2] + (d[2] / dl) * len * t + bend[2] * t * t,
      Math.max(1e-3, o.w * taper), Math.max(1e-3, th * taper),
    ));
  }
  // the loft's first radius runs along `ref` (projected off the blade): that is the blade's width
  return kit.loft(st, { ref: o.across || [0, 0, 1], sides: o.sides ?? 5, start: 'round', end: null, capRings: 1, capDepth: th, color: o.color, mat: o.mat ?? 'fur', bind: o.bind, paint: o.paint });
}

/** A hoof under a lower leg at (x, z): a flared horn cup. o: { x, z, r (the leg's radius), h, color, bind }. */
export function hoof(kit, o) {
  const { x, z, r } = o;
  const h = o.h ?? r * 1.5;
  kit.loft([ps(x, h, z, r, r * 0.94), ps(x + r * 0.08, h * 0.5, z, r * 1.18, r * 1.08), ps(x + r * 0.2, 0, z, r * 1.32, r * 1.18)],
    { ref: [1, 0, 0], rings: 5, sides: 12, start: null, end: 'flat', color: o.color, mat: 'bone', bind: o.bind, paint: o.paint });
}

/**
 * A paw under the lower leg at (x, z), toes forward: a rounded pad with the toes shown by two dark grooves and, when
 * `claw` (a color) is given, tiny claws. o: { x, z, r (the leg's radius), color, bind, claw, mat, paint }.
 */
export function paw(kit, o) {
  const { x, z, r, claw } = o;
  const len = r * 3.2;
  kit.loft([
    ps(x - r * 0.55, r * 1.25, z, r * 0.55, r * 0.72),
    ps(x - r * 0.1, r * 0.78, z, r * 0.62, r * 0.9),
    ps(x + len * 0.42, r * 0.46, z, r * 0.52, r),
    ps(x + len * 0.78, r * 0.36, z, r * 0.4, r * 0.92),
  ], {
    ref: [0, 1, 0], rings: 7, sides: 10, start: 'round', end: 'round', capRings: 2, capDepth: r * 0.5, color: o.color, mat: o.mat, bind: o.bind,
    paint: (out, px, py, pz, u, a) => {
      if (o.paint) o.paint(out, px, py, pz, u, a);
      if (px > x + len * 0.5 && Math.abs(Math.abs(pz - z) - r * 0.3) < r * 0.07) mul(out, 0.62);
    },
  });
  if (claw) {
    for (const k of [-1, 0, 1]) {
      tuft(kit, { at: [x + len * 0.86, r * 0.3, z + k * r * 0.5], dir: [1, -0.15, 0], len: r * 0.7, w: r * 0.14, th: r * 0.14, color: claw, mat: 'bone', bind: o.bind, sides: 4, rings: 2, across: [0, 1, 0] });
    }
  }
}

/** A band of metal or cloth round a neck or a limb: a short open tube at `at` along `dir`. o: { at, dir, rx, rz, h, color, mat, bind }. */
export function collar(kit, o) {
  const { at, dir } = o;
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const h = (o.h ?? 0.02) / 2;
  const st = [-1, 1].map((k) => ps(at[0] + (dir[0] / l) * h * k, at[1] + (dir[1] / l) * h * k, at[2] + (dir[2] / l) * h * k, o.rx, o.rz));
  kit.loft(st, { ref: Math.abs(dir[1] / l) > 0.9 ? [1, 0, 0] : [0, 1, 0], sides: o.sides ?? 12, start: null, end: null, color: o.color, mat: o.mat ?? 'trim', bind: o.bind });
}

/**
 * A horn, a spine or a thorn: a cone from `at` along `dir`, `len` long and `r` wide at the root, curving by `bend` (added at
 * the tip), its root open (it is rooted inside the body). o: { at, dir, len, r, bend, color, mat, bind, sides, flat (ratio of
 * the cone's depth to its width), paint }.
 */
export function spike(kit, o) {
  const d = o.dir;
  const dl = Math.hypot(d[0], d[1], d[2]) || 1;
  const bend = o.bend || [0, 0, 0];
  const st = [];
  for (const [t, k] of [[0, 1], [0.4, 0.62], [1, 0.04]]) {
    st.push(ps(o.at[0] + (d[0] / dl) * o.len * t + bend[0] * t * t, o.at[1] + (d[1] / dl) * o.len * t + bend[1] * t * t, o.at[2] + (d[2] / dl) * o.len * t + bend[2] * t * t, o.r * k, o.r * k * (o.flat ?? 1)));
  }
  kit.loft(st, { ref: o.ref || [0, 0, 1], rings: 5, sides: o.sides ?? 6, start: null, end: 'round', capRings: 1, capDepth: o.r * 0.3, color: o.color, mat: o.mat ?? 'bone', bind: o.bind, paint: o.paint });
}

/**
 * A glowing ring with gems round it, floating in a horizontal plane (a spirit's halo): a thin torus of radius `r` about
 * `center` with `n` gems on it. o: { center, r, tube, color, gem, n, bind }.
 */
export function halo(kit, o) {
  const { center, r } = o;
  const tube = o.tube ?? r * 0.05;
  const n = 20;
  const st = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    st.push(ps(center[0] + Math.cos(a) * r, center[1], center[2] + Math.sin(a) * r, tube, tube));
  }
  kit.loft(st, { ref: [0, 1, 0], sides: 6, start: null, end: null, color: o.color, mat: 'gem', glow: 1, bind: o.bind });
  const gems = o.n ?? 8;
  for (let i = 0; i < gems; i++) {
    const a = (i / gems) * Math.PI * 2;
    const x = center[0] + Math.cos(a) * r;
    const z = center[2] + Math.sin(a) * r;
    kit.loft([ps(x, center[1] - r * 0.1, z, r * 0.01, r * 0.01), ps(x, center[1], z, r * 0.075, r * 0.075), ps(x, center[1] + r * 0.1, z, r * 0.01, r * 0.01)],
      { ref: [1, 0, 0], rings: 4, sides: 4, start: 'round', end: 'round', capRings: 1, capDepth: 0.01, color: o.gem ?? o.color, mat: 'gem', glow: 1, bind: o.bind });
  }
}
