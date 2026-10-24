// The skeleton and the small helpers every rich creature body plan shares (the four-legged beasts,
// the birds, the serpents ...). A creature rig is a list of named bones in model space (facing +X,
// feet on y = 0, right side +Z), so a plan asks for a bone by name:
//
//   const spec = creatureSpec([['hips', 'root', [x, y, z]], ['spine', 'hips', [...]], ...]);
//   spec.ix.hips                  // the bone's index in spec.pos
//   alongPath([spec.ix.hips, ...], pts)   // skin weights along them (rich-kit.js)
//
// Bones are plain pivots: the animation (rich-creature-anim.js) rotates them about their own origin,
// so a bone sits at the joint it turns about.
import * as THREE from 'three';
import { ps, vs, smoothstep } from './rich-kit.js';
import { clamp, lerp } from './rich-paint.js';

/** The bones of a plan's tails: tail1 .. tail4, then tailA1 .. tailA4 and so on for the others of a fan. */
export const TAIL_KEYS = ['tail', 'tailA', 'tailB', 'tailC', 'tailD'];

/** The bones of a plan's extra heads (a many-headed beast's): hAn1 hAn2 hAh hAj (neck, neck, head, jaw), then hB ... */
export const HEAD_KEYS = ['hA', 'hB', 'hC', 'hD'];

/** Bone data for MeshKit / instantiate / syncRich: spec.names, spec.pos, spec.parent (-1: none), spec.ix[name]. */
export function creatureSpec(list, extra = {}) {
  const spec = { names: [], pos: [], parent: [], ix: {}, fit: true, ...extra };
  return addBones(spec, list);
}

/** More bones on a spec (a hybrid's tail on a humanoid's): [name, parentName | index | null, [x, y, z]] each. */
export function addBones(spec, list) {
  for (const [name, parent, at] of list) {
    spec.ix[name] = spec.pos.length;
    spec.names.push(name);
    spec.pos.push(at);
    spec.parent.push(parent === null || parent === undefined ? -1 : typeof parent === 'number' ? parent : spec.ix[parent]);
  }
  return spec;
}

/** Indices of the named bones, in order. */
export const bonesOf = (spec, names) => names.map((n) => spec.ix[n]);

/** The bone positions of the named bones, in order (the points of a path along them). */
export const pathOf = (spec, names) => names.map((n) => spec.pos[spec.ix[n]]);

/** A point `t` of the way along a polyline of points (t in 0..1 by arc length): { p, dir } with dir the unit tangent. */
export function along(pts, t) {
  const lens = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]);
    lens.push(l);
    total += l;
  }
  let s = clamp(t) * total;
  let i = 0;
  while (i < lens.length - 1 && s > lens[i]) {
    s -= lens[i];
    i++;
  }
  const f = lens[i] > 0 ? s / lens[i] : 0;
  const a = pts[i];
  const b = pts[i + 1];
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const dl = Math.hypot(...d) || 1;
  return { p: [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)], dir: [d[0] / dl, d[1] / dl, d[2] / dl] };
}

/** A point at fractional index `u` along a list of points (u = 1.5: halfway from pts[1] to pts[2]; clamped to the ends). */
export function atJoint(pts, u) {
  const i = Math.max(0, Math.min(pts.length - 2, Math.floor(u)));
  const f = Math.max(0, Math.min(1, u - i));
  return [lerp(pts[i][0], pts[i + 1][0], f), lerp(pts[i][1], pts[i + 1][1], f), lerp(pts[i][2], pts[i + 1][2], f)];
}

/**
 * The point on a loft's surface at station `i` and ring angle `a` (the loft's own frame: the first radius along `ref`
 * projected off the path, a = 0 on that side), with the outward normal and the unit tangent / across directions there.
 */
export function ringPoint(st, i, a, ref = [0, 1, 0]) {
  const ns = st.length;
  const A = st[Math.max(0, i - 1)].c;
  const B = st[Math.min(ns - 1, i + 1)].c;
  const t = norm([B[0] - A[0], B[1] - A[1], B[2] - A[2]]);
  let r = ref;
  if (Math.abs(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]) > 0.98) r = [1, 0, 0];
  const d = r[0] * t[0] + r[1] * t[1] + r[2] * t[2];
  const u = norm([r[0] - d * t[0], r[1] - d * t[1], r[2] - d * t[2]]);
  const w = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]];
  const s = st[i];
  const e = 2 / (s.n || 2);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cx = Math.sign(ca) * Math.abs(ca) ** e * s.rx;
  const cz = Math.sign(sa) * Math.abs(sa) ** e * s.rz;
  const p = [s.c[0] + u[0] * cx + w[0] * cz, s.c[1] + u[1] * cx + w[1] * cz, s.c[2] + u[2] * cx + w[2] * cz];
  const nu = ca / s.rx;
  const nw = sa / s.rz;
  const n = norm([u[0] * nu + w[0] * nw, u[1] * nu + w[1] * nw, u[2] * nu + w[2] * nw]);
  const across = norm([-u[0] * sa * s.rx + w[0] * ca * s.rz, -u[1] * sa * s.rx + w[1] * ca * s.rz, -u[2] * sa * s.rx + w[2] * ca * s.rz]);
  return { p, n, t, across };
}

const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Catmull-Rom through points (0..1 by index), for a spine or a neck drawn through a few key points. */
export function spline(pts, t) {
  const m = pts.length - 1;
  const f = clamp(t) * m;
  const i = Math.min(m - 1, Math.floor(f));
  const u = f - i;
  const at = (k) => pts[clamp(k, 0, m)];
  const p0 = at(i - 1);
  const p1 = at(i);
  const p2 = at(i + 1);
  const p3 = at(i + 2);
  return [0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * u + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u * u + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * u * u * u));
}

/**
 * Stations along a spline of key points (each [x, y, z, rVertical, rLateral]): `count` rings, radii interpolated
 * by the same spline. A loft along them takes ref [0, 1, 0] (the first radius is the vertical one).
 */
export function pathStations(keys, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const t = count > 1 ? k / (count - 1) : 0;
    const q = spline(keys.map((p) => [p[0], p[1], p[2]]), t);
    const r = spline(keys.map((p) => [p[3], p[4], p[5] ?? 2]), t);
    out.push(ps(q[0], q[1], q[2], Math.max(1e-3, r[0]), Math.max(1e-3, r[1]), r[2]));
  }
  return out;
}

/** A matrix placing something modelled in a frame of its own (origin at `at`, +X forward, tilted `pitch` about Z, then yawed `yaw` about Y, scaled `s`). */
export function frameMatrix(at, pitch = 0, yaw = 0, s = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(at[0], at[1], at[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, pitch, 'YXZ')),
    new THREE.Vector3(s, s, s),
  );
}

/** A matrix moving a rigid piece from model space into the frame of the bone at `at` (the piece is built in model space). */
export const intoBone = (at) => new THREE.Matrix4().makeTranslation(-at[0], -at[1], -at[2]);

export { ps, vs, smoothstep };
