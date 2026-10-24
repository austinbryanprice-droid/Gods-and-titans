// Skinned character kit for the rich unit models (High and Ultra only). A bone rig,
// lofted and sculpted body parts with per-vertex skin weights, and one indexed,
// smooth-shaded, vertex-colored mesh per character, in the attributes the shared unit
// material already reads (color, aFx, aAo: unit-geo.js), so the same shader, team
// colors, per-vertex roughness / metalness, rim light and time of day apply.
//
//   const spec = humanoidSpec(dims);                // bone rest positions
//   const kit = new MeshKit(spec, { sides: 12 });
//   kit.loft(stations, { style, bind });            // tubes, limbs, torsos, heads, horns
//   kit.sheet(nu, nv, fn, { ... });                 // cloth: capes, banners
//   const geo = kit.build();                        // indexed + skinIndex / skinWeight + baked AO
//   const { mesh, bones } = instantiate(geo, spec, material);
//
// Everything is modeled in the bind pose, facing +X, feet on y = 0, right side +Z.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { C, MATS } from './unit-geo.js';

const PI = Math.PI;
const TAU = PI * 2;

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// skeleton
// ---------------------------------------------------------------------------

/** Bone indices of the humanoid rig. */
export const B = {
  root: 0, pelvis: 1, spine: 2, chest: 3, neck: 4, head: 5,
  upperR: 6, foreR: 7, handR: 8, upperL: 9, foreL: 10, handL: 11,
  thighR: 12, shinR: 13, footR: 14, thighL: 15, shinL: 16, footL: 17,
  cape1: 18, cape2: 19, cape3: 20, hair1: 21, hair2: 22,
  // a winged build (humanoidSpec with opts.wing) adds an inner and an outer wing segment per
  // side, riding the chest: rigid wing pieces hang from them (the body skin never uses them)
  wingR1: 23, wingR2: 24, wingL1: 25, wingL2: 26,
};
export const BONE_NAMES = Object.keys(B);
/** Bones of the standard rig; a winged build has four more (B.wingR1 .. B.wingL2). */
export const BONE_COUNT = 23;
const PARENT = [-1, 0, 1, 2, 3, 4, 3, 6, 7, 3, 9, 10, 1, 12, 13, 1, 15, 16, 3, 18, 19, 5, 21, 3, 23, 3, 25];

/**
 * Bone rest positions (model space, bind pose) for a humanoid build.
 * d: { hipY, hipZ, thigh, ankleY, shoulderY, shoulderZ, upper, fore, neckY, headY, headX, shoulderDrop }
 */
export function humanoidSpec(d, opts = {}) {
  const sh = d.shoulderY - (d.shoulderDrop ?? 0.02);
  const span = d.shoulderY - d.hipY;
  const pos = [
    [0, 0, 0],
    [0, d.hipY, 0],
    [0, d.hipY + 0.28 * span, 0],
    [0, d.hipY + 0.62 * span, 0],
    [d.headX * 0.5, d.neckY, 0],
    [d.headX, d.headY, 0],
    [0, sh, d.shoulderZ], [0, sh - d.upper, d.shoulderZ], [0, sh - d.upper - d.fore, d.shoulderZ],
    [0, sh, -d.shoulderZ], [0, sh - d.upper, -d.shoulderZ], [0, sh - d.upper - d.fore, -d.shoulderZ],
    [0, d.hipY, d.hipZ], [0, d.hipY - d.thigh, d.hipZ], [0, d.ankleY, d.hipZ],
    [0, d.hipY, -d.hipZ], [0, d.hipY - d.thigh, -d.hipZ], [0, d.ankleY, -d.hipZ],
    [-0.08, d.shoulderY - 0.01, 0], [-0.1, d.shoulderY - 0.17, 0], [-0.1, d.shoulderY - 0.34, 0],
    [d.headX - d.headRad * 0.55, d.headY + d.headRad * 0.5, 0], [d.headX - d.headRad * 0.9, d.headY - d.headRad * 0.4, 0],
  ];
  // wings: opts.wing = { root: [x, y, z], wrist: [x, y, z] } of the right wing (the left mirrors it)
  if (opts.wing) {
    const { root, wrist } = opts.wing;
    pos.push(root, wrist, [root[0], root[1], -root[2]], [wrist[0], wrist[1], -wrist[2]]);
  }
  return { d, pos, parent: PARENT.slice(0, pos.length) };
}

/**
 * A fresh set of Bone objects in the bind pose (the root is returned too). Bone i is named spec.names[i] when the
 * spec has names (the creature rigs: rich-creature-kit.js), else after the humanoid's; a bone's parent may come
 * later in the list than the bone.
 */
export function createBones(spec) {
  const bones = spec.pos.map((p, i) => {
    const b = new THREE.Bone();
    b.name = (spec.names && spec.names[i]) || BONE_NAMES[i] || `bone${i}`;
    return b;
  });
  spec.pos.forEach((p, i) => {
    const par = spec.parent[i];
    const pp = par >= 0 ? spec.pos[par] : [0, 0, 0];
    bones[i].position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
    if (par >= 0) bones[par].add(bones[i]);
  });
  return bones;
}

// ---------------------------------------------------------------------------
// skin weights: a bind is (x, y, z, W) => void, adding (bone, weight) pairs to W
// ---------------------------------------------------------------------------

const W = {
  n: 0, k: 1, b: new Int16Array(16), w: new Float32Array(16),
  add(bone, wt) {
    wt *= this.k;
    if (wt <= 1e-4) return;
    for (let i = 0; i < this.n; i++) {
      if (this.b[i] === bone) {
        this.w[i] += wt;
        return;
      }
    }
    this.b[this.n] = bone;
    this.w[this.n++] = wt;
  },
};

export const rigid = (bone) => (x, y, z, S) => S.add(bone, 1);

/**
 * Weights along a chain of bones. Joint i sits between bones[i] and bones[i + 1]: a plane
 * through `at` with normal `dir` (pointing into the child), blended over +-hw.
 */
export function chain(bones, joints) {
  return (x, y, z, S) => {
    let rest = 1;
    for (let i = 0; i < joints.length; i++) {
      const j = joints[i];
      const dist = (x - j.at[0]) * j.dir[0] + (y - j.at[1]) * j.dir[1] + (z - j.at[2]) * j.dir[2];
      const s = smoothstep(-j.hw, j.hw, dist);
      S.add(bones[i], rest * (1 - s));
      rest *= s;
    }
    S.add(bones[joints.length], rest);
  };
}

/** Blend two binds by t(x, y, z) in 0..1 (0: f, 1: g). */
export const mixBind = (f, g, tOf) => (x, y, z, S) => {
  const t = tOf(x, y, z);
  const k = S.k;
  if (t < 1) {
    S.k = k * (1 - t);
    f(x, y, z, S);
  }
  if (t > 0) {
    S.k = k * t;
    g(x, y, z, S);
  }
  S.k = k;
};

/**
 * Weights along a chain of bones laid out along a polyline (a spine, a tail, a serpent's body, a bent leg):
 * bones[i] sits at pts[i], the polyline may run on past the last bone (that bone holds everything beyond).
 * A vertex takes the arc length of its nearest point on the polyline and the weights blend across each joint
 * (pts[1] .. pts[n - 1]) over +-hw of arc length: hw omitted is half of the shorter neighbouring segment, a smooth
 * bend all along the chain; a small hw keeps a segment stiff and bends it at the joint (a knee).
 */
export function alongPath(bones, pts, hw = null) {
  const n = bones.length;
  const segs = [];
  const arc = [0];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1e-6;
    segs.push({ a, dx, dy, dz, len, inv: 1 / (len * len) });
    arc.push(arc[i] + len);
  }
  const half = [];
  for (let j = 1; j < n; j++) {
    const lo = segs[j - 1].len;
    const hi = segs[j] ? segs[j].len : lo;
    half.push(Array.isArray(hw) ? hw[j - 1] : hw ?? 0.5 * Math.min(lo, hi));
  }
  return (x, y, z, S) => {
    let best = Infinity;
    let s = 0;
    for (let i = 0; i < segs.length; i++) {
      const g = segs[i];
      const px = x - g.a[0];
      const py = y - g.a[1];
      const pz = z - g.a[2];
      const t = clamp((px * g.dx + py * g.dy + pz * g.dz) * g.inv);
      const qx = px - g.dx * t;
      const qy = py - g.dy * t;
      const qz = pz - g.dz * t;
      const d = qx * qx + qy * qy + qz * qz;
      if (d < best) {
        best = d;
        s = arc[i] + t * g.len;
      }
    }
    let rest = 1;
    for (let j = 1; j < n; j++) {
      const w = smoothstep(arc[j] - half[j - 1], arc[j] + half[j - 1], s);
      S.add(bones[j - 1], rest * (1 - w));
      rest *= w;
    }
    S.add(bones[n - 1], rest);
  };
}

// ---------------------------------------------------------------------------
// stations
// ---------------------------------------------------------------------------

/** A vertical-loft station: height y, half extents rx (front / back, X) and rz (sideways, Z), center offset dx, dz. */
export const vs = (y, rx, rz, dx = 0, dz = 0, n = 2) => ({ c: [dx, y, dz], rx, rz, n });

/** Station on a free path. */
export const ps = (x, y, z, rx, rz = rx, n = 2) => ({ c: [x, y, z], rx, rz, n });

/** Catmull-Rom resample of a station list to `count` stations (smooth silhouettes from a few key numbers). */
export function resample(st, count) {
  if (st.length < 3 || count <= st.length) return st;
  const out = [];
  const m = st.length - 1;
  const at = (i) => st[clamp(i, 0, m)];
  for (let k = 0; k < count; k++) {
    const f = (k / (count - 1)) * m;
    const i = Math.min(m - 1, Math.floor(f));
    const t = f - i;
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    out.push({
      c: [cr(p0.c[0], p1.c[0], p2.c[0], p3.c[0]), cr(p0.c[1], p1.c[1], p2.c[1], p3.c[1]), cr(p0.c[2], p1.c[2], p2.c[2], p3.c[2])],
      rx: Math.max(1e-4, cr(p0.rx, p1.rx, p2.rx, p3.rx)),
      rz: Math.max(1e-4, cr(p0.rz, p1.rz, p2.rz, p3.rz)),
      n: lerp(p1.n ?? 2, p2.n ?? 2, t),
      rot: lerp(p1.rot ?? 0, p2.rot ?? 0, t),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// mesh kit
// ---------------------------------------------------------------------------

const _c = { r: 1, g: 1, b: 1, team: 0, glow: 0 };
const _v = new THREE.Vector3();

/**
 * Surface style of a primitive. color: THREE.Color | css | TEAM(shade, mat). opts.mat overrides
 * the surface class (MATS key), opts.glow is the self-glow 0..1, opts.paint(out, x, y, z, u, a)
 * recolors per vertex (out: { r, g, b, team, glow }; u runs along the primitive, a around it).
 */
function styleOf(color, opts) {
  const team = color && typeof color === 'object' && 'team' in color ? color.team : 0;
  const c = team ? new THREE.Color(1, 1, 1) : C(color);
  const matKey = MATS[opts.mat] ? opts.mat : team ? color.mat : c.mat;
  const mat = MATS[matKey] || MATS.cloth;
  return { r: c.r, g: c.g, b: c.b, team, glow: opts.glow || 0, rough: mat[0], metal: mat[1], paint: opts.paint || null };
}

export class MeshKit {
  /** quality: { sides (ring vertices), rings (multiplier on resampled station counts) } */
  constructor(spec, quality = {}) {
    this.spec = spec;
    this.sides = quality.sides ?? 12;
    this.ringK = quality.rings ?? 1;
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.fx = [];
    this.skin = []; // 4 indices, 4 weights per vertex
    this.idx = [];
    this.flick = []; // primitives with a flicker morph: { start, count, base, k }
    this.count = 0;
    this.parts = 0;
  }

  get triangles() {
    return this.idx.length / 3;
  }

  /**
   * Append a primitive: P positions (flat), I triangles (flat, outward winding), colored by `color`
   * (see styleOf), weighted by `bind`. Normals are the smoothed face normals of the primitive.
   * Returns the index of its first vertex.
   */
  add(P, I, color, opts = {}, bind = null, uv = null) {
    const n = P.length / 3;
    const base = this.count;
    const nor = new Float32Array(n * 3);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3;
      const b = I[t + 1] * 3;
      const c = I[t + 2] * 3;
      const ux = P[b] - P[a];
      const uy = P[b + 1] - P[a + 1];
      const uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a];
      const vy = P[c + 1] - P[a + 1];
      const vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      for (const o of [a, b, c]) {
        nor[o] += nx;
        nor[o + 1] += ny;
        nor[o + 2] += nz;
      }
    }
    const st = styleOf(color, opts);
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const l = Math.hypot(nor[o], nor[o + 1], nor[o + 2]) || 1;
      this.nor.push(nor[o] / l, nor[o + 1] / l, nor[o + 2] / l);
      this.pos.push(P[o], P[o + 1], P[o + 2]);
      _c.r = st.r;
      _c.g = st.g;
      _c.b = st.b;
      _c.team = st.team;
      _c.glow = st.glow;
      if (st.paint) st.paint(_c, P[o], P[o + 1], P[o + 2], uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
      this.col.push(_c.r, _c.g, _c.b);
      this.fx.push(_c.team, _c.glow, st.rough, st.metal);
      // skin weights: the top four, normalized
      W.n = 0;
      W.k = 1;
      if (bind) bind(P[o], P[o + 1], P[o + 2], W);
      if (W.n === 0) W.add(0, 1);
      const order = [];
      for (let k = 0; k < W.n; k++) order.push(k);
      order.sort((p, q) => W.w[q] - W.w[p]);
      let sum = 0;
      const top = Math.min(4, order.length);
      for (let k = 0; k < top; k++) sum += W.w[order[k]];
      for (let k = 0; k < 4; k++) this.skin.push(k < top ? W.b[order[k]] : 0);
      for (let k = 0; k < 4; k++) this.skin.push(k < top ? W.w[order[k]] / sum : 0);
    }
    for (let t = 0; t < I.length; t++) this.idx.push(I[t] + base);
    if (opts.flicker) this.flick.push({ start: base, count: n, base: opts.flicker.base, k: opts.flicker.k ?? 0.3 });
    this.count += n;
    this.parts++;
    return base;
  }

  /**
   * Sweep elliptical rings along a list of stations ({ c, rx, rz, n?, rot? }, see vs / ps).
   * opts: sides, ringK-scaled `rings` (resample count), start / end ('round' | 'flat' | null),
   * capRings, capDepth, ref (reference vector of the ring frame, default +X), warp(p, a, u) to
   * displace a ring vertex (a: angle, u: 0..1 along the sweep), color / mat / glow / paint, bind.
   */
  loft(stations, opts = {}) {
    const sides = opts.sides ?? this.sides;
    let st = stations;
    if (opts.rings) st = resample(stations, Math.max(stations.length, Math.round(opts.rings * this.ringK)));
    const ns = st.length;
    const ref = opts.ref || [1, 0, 0];
    // frames
    const frames = [];
    for (let i = 0; i < ns; i++) {
      const a = st[Math.max(0, i - 1)].c;
      const b = st[Math.min(ns - 1, i + 1)].c;
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      let tz = b[2] - a[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      let d = ref[0] * tx + ref[1] * ty + ref[2] * tz;
      let ux = ref[0] - d * tx;
      let uy = ref[1] - d * ty;
      let uz = ref[2] - d * tz;
      let ul = Math.hypot(ux, uy, uz);
      if (ul < 1e-4) {
        // tangent parallel to the reference: use another axis
        const alt = Math.abs(ty) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        d = alt[0] * tx + alt[1] * ty + alt[2] * tz;
        ux = alt[0] - d * tx;
        uy = alt[1] - d * ty;
        uz = alt[2] - d * tz;
        ul = Math.hypot(ux, uy, uz);
      }
      ux /= ul;
      uy /= ul;
      uz /= ul;
      // w = u x t
      frames.push({ t: [tx, ty, tz], u: [ux, uy, uz], w: [uy * tz - uz * ty, uz * tx - ux * tz, ux * ty - uy * tx] });
    }
    // rings, with round cap rings before / after
    const rings = [];
    const capRings = opts.capRings ?? 3;
    const addCap = (idx, dir, kind) => {
      const s = st[idx];
      const f = frames[idx];
      const cd = opts.capDepth !== null && typeof opts.capDepth === 'object' ? opts.capDepth[idx === 0 ? 0 : 1] : opts.capDepth;
      const depth = cd ?? Math.min(s.rx, s.rz);
      const out = [];
      if (kind === 'round') {
        for (let k = 1; k <= capRings; k++) {
          const phi = (k / capRings) * (PI / 2);
          const sc = Math.cos(phi);
          const off = Math.sin(phi) * depth * dir;
          out.push({ s, f, sc, off: [f.t[0] * off, f.t[1] * off, f.t[2] * off], pole: k === capRings, u: idx === 0 ? 0 : 1 });
        }
      } else if (kind === 'flat') {
        out.push({ s, f, sc: 0, off: [0, 0, 0], pole: true, u: idx === 0 ? 0 : 1 });
      }
      return out;
    };
    const startCap = addCap(0, -1, opts.start === undefined ? 'round' : opts.start);
    const endCap = addCap(ns - 1, 1, opts.end === undefined ? 'round' : opts.end);
    for (let k = startCap.length - 1; k >= 0; k--) rings.push(startCap[k]);
    for (let i = 0; i < ns; i++) rings.push({ s: st[i], f: frames[i], sc: 1, off: [0, 0, 0], pole: false, u: ns > 1 ? i / (ns - 1) : 0 });
    for (const r of endCap) rings.push(r);
    // vertices
    const P = [];
    const UV = [];
    const ringStart = [];
    const p3 = [0, 0, 0];
    for (const r of rings) {
      ringStart.push(P.length / 3);
      const { s, f } = r;
      if (r.pole) {
        const c = s.c;
        p3[0] = c[0] + r.off[0];
        p3[1] = c[1] + r.off[1];
        p3[2] = c[2] + r.off[2];
        if (opts.warp) opts.warp(p3, 0, r.u);
        P.push(p3[0], p3[1], p3[2]);
        UV.push(r.u, 0);
        continue;
      }
      const rot = s.rot || 0;
      const e = 2 / (s.n || 2);
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * TAU;
        const ca = Math.cos(a + rot);
        const sa = Math.sin(a + rot);
        const cx = Math.sign(ca) * Math.abs(ca) ** e * s.rx * r.sc;
        const cz = Math.sign(sa) * Math.abs(sa) ** e * s.rz * r.sc;
        p3[0] = s.c[0] + r.off[0] + f.u[0] * cx + f.w[0] * cz;
        p3[1] = s.c[1] + r.off[1] + f.u[1] * cx + f.w[1] * cz;
        p3[2] = s.c[2] + r.off[2] + f.u[2] * cx + f.w[2] * cz;
        if (opts.warp) opts.warp(p3, a, r.u);
        P.push(p3[0], p3[1], p3[2]);
        UV.push(r.u, k / sides);
      }
    }
    // triangles
    const I = [];
    for (let i = 0; i + 1 < rings.length; i++) {
      const A = rings[i];
      const Bq = rings[i + 1];
      const a0 = ringStart[i];
      const b0 = ringStart[i + 1];
      if (A.pole && Bq.pole) continue;
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        if (A.pole) I.push(a0, b0 + k1, b0 + k);
        else if (Bq.pole) I.push(a0 + k, a0 + k1, b0);
        else I.push(a0 + k, a0 + k1, b0 + k1, a0 + k, b0 + k1, b0 + k);
      }
    }
    // outward winding: sum of (face normal . (centroid - object centroid))
    orient(P, I);
    return this.add(P, I, opts.color ?? '#ff00ff', opts, opts.bind, UV);
  }

  /**
   * A cloth sheet over a (nu x nv) grid: fn(u, v, out) writes the surface point. Two layers
   * `thick` apart (outer: color, inner: opts.inner), so it needs no double-sided material.
   * Winding follows the grid: u runs one way, v the other, the outer face looks along u x v.
   */
  sheet(nu, nv, fn, opts = {}) {
    const thick = opts.thick ?? 0.006;
    const P = [];
    const UV = [];
    const out = [0, 0, 0];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        fn(i / nu, j / nv, out);
        P.push(out[0], out[1], out[2]);
        UV.push(i / nu, j / nv);
      }
    }
    const stride = nu + 1;
    const I = [];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = j * stride + i;
        I.push(a, a + 1, a + stride + 1, a, a + stride + 1, a + stride);
      }
    }
    // vertex normals of the outer layer, to offset the inner one
    const nor = new Float32Array(P.length);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3;
      const b = I[t + 1] * 3;
      const c = I[t + 2] * 3;
      const ux = P[b] - P[a]; const uy = P[b + 1] - P[a + 1]; const uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a]; const vy = P[c + 1] - P[a + 1]; const vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
      for (const o of [a, b, c]) { nor[o] += nx; nor[o + 1] += ny; nor[o + 2] += nz; }
    }
    const Pi = new Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
      Pi[i] = P[i] - (nor[i] / l) * thick;
      Pi[i + 1] = P[i + 1] - (nor[i + 1] / l) * thick;
      Pi[i + 2] = P[i + 2] - (nor[i + 2] / l) * thick;
    }
    const Ii = [];
    for (let t = 0; t < I.length; t += 3) Ii.push(I[t], I[t + 2], I[t + 1]);
    const first = this.add(P, I, opts.color ?? '#ff00ff', opts, opts.bind, UV);
    this.add(Pi, Ii, opts.inner ?? opts.color ?? '#ff00ff', { ...opts, paint: opts.innerPaint ?? opts.paint, mat: opts.innerMat ?? opts.mat }, opts.bind, UV);
    return first;
  }

  /**
   * A plate from a closed 2D outline ([x, y] pairs), `depth` thick along Z (centered) with a
   * rounded bevel all round: axe heads, blades, rims. Smooth shaded across the bevel; paint
   * gets u, a = the point's position in the outline's box (0..1 each).
   */
  slab(outline, opts = {}) {
    const depth = opts.depth ?? 0.02;
    const bevel = Math.min(opts.bevel ?? depth * 0.3, depth * 0.45);
    const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
    const eg = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(1e-4, depth - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2, curveSegments: 6, steps: 1,
    });
    eg.deleteAttribute('normal');
    eg.deleteAttribute('uv');
    const g = mergeVertices(eg, 1e-5);
    const P = Array.from(g.attributes.position.array);
    const I = Array.from(g.index.array);
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (let i = 0; i < P.length; i += 3) {
      P[i + 2] -= (depth - 2 * bevel) / 2;
      x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]);
      y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]);
    }
    const UV = [];
    for (let i = 0; i < P.length; i += 3) UV.push((P[i] - x0) / (x1 - x0 || 1), (P[i + 1] - y0) / (y1 - y0 || 1));
    orient(P, I);
    eg.dispose();
    g.dispose();
    return this.add(P, I, opts.color ?? '#ff00ff', opts, opts.bind, UV);
  }

  /**
   * Model something in a frame of its own with `fn(this)` (a held item in its grip frame), then
   * move every vertex it added by `matrix` (rigid): the item ends up in this mesh, placed on a limb.
   */
  placed(matrix, fn) {
    const v0 = this.count;
    const f0 = this.flick.length;
    fn(this);
    for (let i = v0; i < this.count; i++) {
      const o = i * 3;
      _v.set(this.pos[o], this.pos[o + 1], this.pos[o + 2]).applyMatrix4(matrix);
      this.pos[o] = _v.x;
      this.pos[o + 1] = _v.y;
      this.pos[o + 2] = _v.z;
      _v.set(this.nor[o], this.nor[o + 1], this.nor[o + 2]).transformDirection(matrix);
      this.nor[o] = _v.x;
      this.nor[o + 1] = _v.y;
      this.nor[o + 2] = _v.z;
    }
    for (let k = f0; k < this.flick.length; k++) {
      const f = this.flick[k];
      f.base = _v.set(f.base[0], f.base[1], f.base[2]).applyMatrix4(matrix).toArray();
    }
  }

  /**
   * Finish: typed attributes, an index, and baked ambient occlusion. `matrix` (rigid) moves the
   * whole kit into another frame first (pieces modelled in a grip frame, placed in a bone's).
   * Primitives built with opts.flicker = { base, k } get a flame flicker morph ('fl', as the
   * low-poly flames have): vertices move away from `base` by k, more up than sideways.
   */
  build({ ao = true, ground = 1, strength = 0.4, matrix = null } = {}) {
    const n = this.count;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(this.pos);
    const nor = new Float32Array(this.nor);
    if (matrix) {
      for (let i = 0; i < n; i++) {
        _v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(matrix);
        pos[i * 3] = _v.x;
        pos[i * 3 + 1] = _v.y;
        pos[i * 3 + 2] = _v.z;
        _v.set(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]).transformDirection(matrix);
        nor[i * 3] = _v.x;
        nor[i * 3 + 1] = _v.y;
        nor[i * 3 + 2] = _v.z;
      }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (this.flick.length) {
      const d = new Float32Array(n * 3);
      for (const f of this.flick) {
        const b = matrix ? _v.set(f.base[0], f.base[1], f.base[2]).applyMatrix4(matrix).toArray() : f.base;
        for (let i = f.start; i < f.start + f.count; i++) {
          d[i * 3] = (pos[i * 3] - b[0]) * f.k * 0.4;
          d[i * 3 + 1] = (pos[i * 3 + 1] - b[1]) * f.k;
          d[i * 3 + 2] = (pos[i * 3 + 2] - b[2]) * f.k * 0.4;
        }
      }
      const a = new THREE.Float32BufferAttribute(d, 3);
      a.name = 'fl';
      g.morphAttributes.position = [a];
      g.morphTargetsRelative = true;
    }
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aFx', new THREE.BufferAttribute(new Float32Array(this.fx), 4));
    const skin = this.skin;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) {
        si[i * 4 + k] = skin[i * 8 + k];
        sw[i * 4 + k] = skin[i * 8 + 4 + k];
      }
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    const occ = ao ? gridAO(pos, g.attributes.normal.array, this.idx, { ground, strength }) : new Float32Array(n).fill(1);
    g.setAttribute('aAo', new THREE.BufferAttribute(occ, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    g.userData.triangles = this.idx.length / 3;
    g.userData.morphNames = this.flick.length ? ['fl'] : [];
    g.userData.rich = true;
    return g;
  }
}

/** Flip the winding of an indexed mesh when its faces look inward (sum over faces of n . (centroid - object centroid)). */
function orient(P, I) {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const n = P.length / 3;
  for (let i = 0; i < P.length; i += 3) {
    cx += P[i];
    cy += P[i + 1];
    cz += P[i + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let s = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3;
    const b = I[t + 1] * 3;
    const c = I[t + 2] * 3;
    const ux = P[b] - P[a]; const uy = P[b + 1] - P[a + 1]; const uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a]; const vy = P[c + 1] - P[a + 1]; const vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    const mx = (P[a] + P[b] + P[c]) / 3 - cx;
    const my = (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - cy;
    const mz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - cz;
    s += nx * mx + ny * my + nz * mz;
  }
  if (s < 0) {
    for (let t = 0; t < I.length; t += 3) {
      const x = I[t + 1];
      I[t + 1] = I[t + 2];
      I[t + 2] = x;
    }
  }
}

// ---------------------------------------------------------------------------
// baked ambient occlusion (grid accelerated: the same disc-occluder form factor as
// unit-geo.js bakeAO, which is quadratic in triangles and too slow for ~6000)
// ---------------------------------------------------------------------------

function gridAO(pos, nor, idx, { ground = 1, strength = 0.4 } = {}) {
  const nT = idx.length / 3;
  const nV = pos.length / 3;
  const E = new Float32Array(nT * 8);
  let ne = 0;
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
    minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
    minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
  }
  for (let t = 0; t < nT; t++) {
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a]; const uy = pos[b + 1] - pos[a + 1]; const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a]; const vy = pos[c + 1] - pos[a + 1]; const vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-10) continue;
    const o = ne * 8;
    E[o] = (pos[a] + pos[b] + pos[c]) / 3;
    E[o + 1] = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
    E[o + 2] = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    E[o + 3] = nx / len;
    E[o + 4] = ny / len;
    E[o + 5] = nz / len;
    E[o + 6] = len / 2;
    E[o + 7] = Math.min(0.2, Math.sqrt(len / 2 / 0.03));
    ne++;
  }
  const cell = 0.08;
  const gx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const gy = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  const gz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
  const cells = gx * gy * gz;
  const counts = new Int32Array(cells + 1);
  const span = (o) => {
    const r = E[o + 7];
    return [
      Math.max(0, Math.floor((E[o] - r - minX) / cell)), Math.min(gx - 1, Math.floor((E[o] + r - minX) / cell)),
      Math.max(0, Math.floor((E[o + 1] - r - minY) / cell)), Math.min(gy - 1, Math.floor((E[o + 1] + r - minY) / cell)),
      Math.max(0, Math.floor((E[o + 2] - r - minZ) / cell)), Math.min(gz - 1, Math.floor((E[o + 2] + r - minZ) / cell)),
    ];
  };
  for (let e = 0; e < ne; e++) {
    const s = span(e * 8);
    for (let z = s[4]; z <= s[5]; z++) for (let y = s[2]; y <= s[3]; y++) for (let x = s[0]; x <= s[1]; x++) counts[(z * gy + y) * gx + x + 1]++;
  }
  for (let i = 0; i < cells; i++) counts[i + 1] += counts[i];
  const fill = counts.slice(0, cells);
  const list = new Int32Array(counts[cells]);
  for (let e = 0; e < ne; e++) {
    const s = span(e * 8);
    for (let z = s[4]; z <= s[5]; z++) for (let y = s[2]; y <= s[3]; y++) for (let x = s[0]; x <= s[1]; x++) list[fill[(z * gy + y) * gx + x]++] = e * 8;
  }
  const out = new Float32Array(nV);
  for (let i = 0; i < nV; i++) {
    const nx = nor[i * 3]; const ny = nor[i * 3 + 1]; const nz = nor[i * 3 + 2];
    const px = pos[i * 3] + nx * 0.004;
    const py = pos[i * 3 + 1] + ny * 0.004;
    const pz = pos[i * 3 + 2] + nz * 0.004;
    const cx = clamp(Math.floor((px - minX) / cell), 0, gx - 1);
    const cy = clamp(Math.floor((py - minY) / cell), 0, gy - 1);
    const cz = clamp(Math.floor((pz - minZ) / cell), 0, gz - 1);
    const ci = (cz * gy + cy) * gx + cx;
    let occ = 0;
    for (let k = counts[ci]; k < counts[ci + 1]; k++) {
      const j = list[k];
      const dx = E[j] - px;
      const dy = E[j + 1] - py;
      const dz = E[j + 2] - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      const A = E[j + 6];
      if (d2 * 0.03 > A) continue;
      const cr = nx * dx + ny * dy + nz * dz;
      if (cr <= 0) continue;
      let ce = -(E[j + 3] * dx + E[j + 4] * dy + E[j + 5] * dz);
      if (ce < 0) ce *= -0.5;
      occ += (A * cr * ce) / (d2 * (PI * d2 + A) + 1e-12);
    }
    const cav = 1 - strength * (1 - Math.exp(-0.9 * occ));
    const h = clamp(py / 0.28);
    const low = 1 - h * h * (3 - 2 * h);
    const gr = 1 - ground * 0.2 * low * (1 - Math.max(0, ny));
    const under = 1 - 0.12 * Math.max(0, -ny);
    out[i] = Math.max(0.22, cav * gr * under);
  }
  return out;
}

// ---------------------------------------------------------------------------
// instances
// ---------------------------------------------------------------------------

const IDENTITY = new THREE.Matrix4();
const noop = () => {};

/**
 * A skinned mesh sharing `geometry` with every other instance, with its own bones. The bones
 * are a detached skeleton (bind mode 'detached', bind matrix identity): they live in the
 * model's space, outside the scene graph, so the scene's per frame matrix pass never walks
 * them. The pose is refreshed only when the animation moves it (syncRich), which is
 * what the renderer's animation budget meters; rigid pieces riding a bone hang from `mounts`
 * (Groups under the rig that syncRich moves to the bone's matrix).
 * The mesh is added to the unit's rig group by the caller, then bindInstance() once.
 */
export function instantiate(geometry, spec, material) {
  const bones = createBones(spec);
  bones[0].updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.bindMode = THREE.DetachedBindMode;
  const skeleton = new THREE.Skeleton(bones);
  mesh.skeleton = skeleton;
  // a fixed generous sphere: the skinned pose moves vertices well off the bind pose
  const top = geometry.boundingBox.max.y;
  if (spec.fit) {
    // a creature is not a standing figure: wrap the whole body
    const box = geometry.boundingBox;
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() * 0.5;
    mesh.boundingSphere = new THREE.Sphere(c, r * 1.12 + 0.3);
    mesh.boundingBox = box.clone().expandByScalar(Math.max(0.3, r * 0.25));
  } else {
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, top * 0.5, 0), top * 0.95 + 0.4);
    mesh.boundingBox = new THREE.Box3(new THREE.Vector3(-0.7, 0, -0.7).multiplyScalar(top), new THREE.Vector3(0.7, top * 1.3, 0.7).multiplyScalar(top));
  }
  // the renderer calls skeleton.update() once a frame for every skinned mesh it draws: that is
  // replaced by syncRich, run when the pose changes
  const refresh = THREE.Skeleton.prototype.update.bind(skeleton);
  skeleton.update = noop;
  return { mesh, bones, mounts: [], refresh };
}

/** A Group under `parent` that follows bone `bone` of the instance (rigid pieces ride it). */
export function mountOn(inst, parent, bone, name) {
  const g = new THREE.Group();
  g.name = name;
  g.matrixAutoUpdate = false;
  parent.add(g);
  inst.mounts.push({ obj: g, bone });
  return g;
}

/** Bind an instance's mesh to its skeleton in the current (bind) pose and fill the skin matrices. */
export function bindInstance(inst) {
  inst.mesh.bind(inst.mesh.skeleton, IDENTITY);
  syncRich(inst);
}

/** After the bones moved: their world matrices, the skin matrices, and the pieces riding them. */
export function syncRich(inst) {
  inst.bones[0].updateMatrixWorld(true);
  inst.refresh();
  for (const m of inst.mounts) {
    m.obj.matrix.copy(inst.bones[m.bone].matrixWorld);
    m.obj.matrixWorldNeedsUpdate = true;
  }
}
