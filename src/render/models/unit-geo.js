// Geometry helpers for the procedural unit models: low-poly primitives, color
// helpers and PartBuilder, which merges colored pieces into one vertex-colored
// BufferGeometry (attributes: position, normal, color, aFx, aAo) with optional
// relative morph targets. aFx.x > 0 marks team-colored vertices (value = shade),
// aFx.y is the self-glow amount (0..1), aFx.zw the surface's roughness and
// metalness (from its material class, see MATS); aAo is baked ambient
// occlusion (1 = open, see bakeAO).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _o = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export const WHITE = new THREE.Color(1, 1, 1);
export const BLACK = new THREE.Color(0, 0, 0);

/**
 * Surface classes: [roughness, metalness]. A color carries its class as a
 * `mat` tag (see withMat) through C / mixC / shadeC / tintC; PartBuilder.add
 * takes it from opts.mat, else the color's tag, else 'cloth'.
 */
export const MATS = {
  cloth: [0.9, 0],
  trim: [0.62, 0], // embroidery, ornaments, feathers of a headdress
  painted: [0.48, 0], // painted wood and lacquered pads
  lacquer: [0.3, 0], // glossy enamel (colored "metal" accents)
  skin: [0.62, 0],
  fur: [0.95, 0],
  feather: [0.82, 0],
  scales: [0.46, 0],
  hair: [0.66, 0],
  leather: [0.55, 0],
  wood: [0.82, 0],
  bone: [0.5, 0], // bone, horn, teeth, beaks, chitin
  gloss: [0.32, 0], // eyes, wet noses, obsidian
  gem: [0.24, 0],
  // stylized metal: enough diffuse left that the sunlit color still reads
  // where a facet mirrors a dull patch of sky
  metal: [0.36, 0.66], // steel, silver, electrum
  gold: [0.3, 0.62], // gold, brass, bronze
  copper: [0.34, 0.45], // orange metal: copper, fire-forged armor
  iron: [0.52, 0.56], // dark, worn iron
};

/** Team color marker for PartBuilder.add (shade multiplies the team color; mat = surface class). */
export function TEAM(shade = 1, mat = 'cloth') {
  return { team: shade, mat };
}

/** Parse a CSS color (hex string, number or THREE.Color) into a new THREE.Color (keeps a `mat` tag). */
export function C(c) {
  if (c instanceof THREE.Color) {
    const out = c.clone();
    if (c.mat) out.mat = c.mat;
    return out;
  }
  return new THREE.Color(c);
}
/** Copy of a color tagged with a surface class (MATS key). */
export function withMat(c, mat) {
  const out = C(c);
  out.mat = mat;
  return out;
}
/** Linear blend of two colors (keeps the tag of the dominant one). */
export function mixC(a, b, t) {
  const A = C(a);
  const B = C(b);
  const mat = t < 0.5 ? A.mat || B.mat : B.mat || A.mat;
  const out = A.lerp(B, t);
  if (mat) out.mat = mat;
  return out;
}
/** Darken (k < 1) or brighten (k > 1) a color. */
export function shadeC(c, k) {
  return C(c).multiplyScalar(k);
}
/** Blend toward white. */
export function tintC(c, t) {
  return C(c).lerp(WHITE, t);
}
/** Perceived brightness 0..1 of a (linear) color, in sRGB terms. */
export function lumaC(c) {
  const s = C(c).convertLinearToSRGB();
  return 0.299 * s.r + 0.587 * s.g + 0.114 * s.b;
}

function prep(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position') n.deleteAttribute(k);
  n.morphAttributes = {};
  return n;
}

// ---- primitives (non-indexed, position only) ----
export const box = (sx, sy, sz) => prep(new THREE.BoxGeometry(sx, sy, sz));
export const cyl = (rt, rb, h, seg = 6, open = false) => prep(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
/** Upper half sphere (dome) of radius r sitting on y = 0. */
export const dome = (r, ws = 6, hs = 2) => prep(new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2));
export const cone = (r, h, seg = 5) => prep(new THREE.ConeGeometry(r, h, seg, 1));
export const ball = (r, ws = 6, hs = 4) => prep(new THREE.SphereGeometry(r, ws, hs));
export const ico = (r, detail = 0) => prep(new THREE.IcosahedronGeometry(r, detail));
export const dodeca = (r) => prep(new THREE.DodecahedronGeometry(r, 0));
export const octa = (r) => prep(new THREE.OctahedronGeometry(r, 0));
export const tetra = (r) => prep(new THREE.TetrahedronGeometry(r, 0));
export const torus = (r, tube, rs = 3, ts = 8, arc = Math.PI * 2) => prep(new THREE.TorusGeometry(r, tube, rs, ts, arc));

/** Flat polygon (in the XY plane, facing +Z) extruded by depth along Z, centered on z = 0. */
export function slab(points, depth) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = prep(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 }));
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * Box from y = 0 to y = sy whose top face is scaled by (tx, tz) and shifted by sx0 along x.
 * sx = depth (front/back), sz = width (left/right).
 */
export function taper(sx, sy, sz, tx = 1, tz = 1, shiftX = 0) {
  const g = box(sx, sy, sz);
  g.translate(0, sy / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > sy * 0.5) {
      p.setX(i, p.getX(i) * tx + shiftX);
      p.setZ(i, p.getZ(i) * tz);
    }
  }
  return g;
}

/** Tapered cylinder segment from point a (radius ra) to point b (radius rb). */
export function seg(a, b, ra, rb = ra, sides = 5, open = false) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const len = d.length() || 1e-4;
  const g = rb <= 0 ? cone(ra, len, sides) : cyl(rb, Math.max(ra, 1e-3), len, sides, open);
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(UP, d.normalize());
  g.applyQuaternion(_q);
  g.translate(A.x, A.y, A.z);
  return g;
}

/**
 * Continuous tube through pts ([x,y,z] list) with per-point radii, built from
 * parallel-transported rings so consecutive pieces share their seams. Returns
 * one geometry per span (pts.length − 1) so each span can take its own color;
 * the first / last span carry the end caps (a cap is skipped when its radius
 * is ~0, which closes the tube to a point).
 */
export function tube(pts, rad, sides = 6, { capStart = true, capEnd = true } = {}) {
  const n = pts.length;
  const P = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const rings = [];
  let nrm = null;
  for (let i = 0; i < n; i++) {
    const t = P[Math.min(n - 1, i + 1)].clone().sub(P[Math.max(0, i - 1)]);
    if (t.lengthSq() < 1e-12) t.set(1, 0, 0);
    t.normalize();
    if (!nrm) {
      nrm = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    }
    nrm = nrm.clone().addScaledVector(t, -nrm.dot(t));
    if (nrm.lengthSq() < 1e-10) nrm = new THREE.Vector3(0, 0, 1).addScaledVector(t, -t.z);
    nrm.normalize();
    const bin = new THREE.Vector3().crossVectors(t, nrm);
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + Math.PI / sides;
      ring.push(P[i].clone().addScaledVector(nrm, Math.cos(a) * rad[i]).addScaledVector(bin, Math.sin(a) * rad[i]));
    }
    rings.push({ ring, t: t.clone(), c: P[i] });
  }
  const out = [];
  const tri = (arr, a, b, c) => arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < n - 1; i++) {
    const arr = [];
    const A = rings[i].ring;
    const B = rings[i + 1].ring;
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      // skip the triangle that collapses when one ring has zero radius
      if (rad[i + 1] > 1e-4) tri(arr, A[k], B[k1], B[k]);
      if (rad[i] > 1e-4) tri(arr, A[k], A[k1], B[k1]);
    }
    if (i === 0 && capStart && rad[0] > 1e-3) {
      for (let k = 0; k < sides; k++) tri(arr, rings[0].c, A[(k + 1) % sides], A[k]);
    }
    if (i === n - 2 && capEnd && rad[n - 1] > 1e-3) {
      for (let k = 0; k < sides; k++) tri(arr, rings[n - 1].c, B[k], B[(k + 1) % sides]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    out.push(g);
  }
  return out;
}

/** Apply scale, rotation (Euler XYZ) and translation to a geometry in place. */
export function T(g, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
  _e.set(r[0], r[1], r[2]);
  _q.setFromEuler(_e);
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  _p.set(p[0], p[1], p[2]);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  // a negative scale determinant flips triangle winding: restore it
  if (_s.x * _s.y * _s.z < 0) flipWinding(g);
  return g;
}

/** Swap the 2nd and 3rd vertex of every triangle (non-indexed geometry). */
export function flipWinding(g) {
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const t = p[i + 3 + k];
      p[i + 3 + k] = p[i + 6 + k];
      p[i + 6 + k] = t;
    }
  }
  g.attributes.position.needsUpdate = true;
  return g;
}

/** Copy of g mirrored across the XY plane (z → −z), with winding fixed. */
export function mirrorZ(g) {
  const c = g.clone();
  c.scale(1, 1, -1);
  return flipWinding(c);
}

/** Pull vertices of g with y above `y0` toward the axis by factor k (cheap taper). */
export function squeezeAbove(g, y0, kx, kz) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > y0) { p.setX(i, p.getX(i) * kx); p.setZ(i, p.getZ(i) * kz); }
  return g;
}

/**
 * Morph function: rigid rotation of the tagged vertices about `pivot` around
 * `axis` by `angle`. Returns (v, out) => out = displacement.
 */
export function rotMorph(pivot, axis, angle) {
  const P = new THREE.Vector3(...pivot);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), angle);
  return (v, out) => {
    out.copy(v).sub(P).applyQuaternion(q).add(P).sub(v);
  };
}

/** Compose several morph functions (displacements are added). */
export function sumMorph(...fns) {
  const t = new THREE.Vector3();
  return (v, out) => {
    out.set(0, 0, 0);
    for (const f of fns) {
      f(v, t);
      out.add(t);
    }
  };
}

/**
 * Collects colored pieces under a transform stack and merges them into one
 * geometry. Morph functions receive positions in the builder's root frame.
 */
/** Default crease angle: facets of 5- to 8-sided limbs, domes and dodecahedra blend; box edges stay hard. */
export const SMOOTH_CREASE = 76 * (Math.PI / 180);

const _fa = new THREE.Vector3();
const _fb = new THREE.Vector3();
const _fc = new THREE.Vector3();

/**
 * Normals for a non-indexed position array, item by item: within one range
 * [start, count, cosCrease], vertices at the same spot average the
 * (area-weighted) normals of the faces whose direction lies within the crease
 * angle of their own face; cosCrease >= 1 gives plain facet normals. Ranges
 * never share normals, so pieces stay distinct. Positions outside every
 * range get zero normals.
 */
export function creasedNormals(pos, ranges) {
  const out = new Float32Array(pos.length);
  const key = (i) => `${Math.round(pos[i * 3] * 4096)},${Math.round(pos[i * 3 + 1] * 4096)},${Math.round(pos[i * 3 + 2] * 4096)}`;
  for (const [start, count, cosC] of ranges) {
    const nf = count / 3;
    const fn = new Float32Array(nf * 3); // unnormalized face normals (area weighted)
    const fu = new Float32Array(nf * 3); // unit face normals
    for (let f = 0; f < nf; f++) {
      const i = (start + f * 3) * 3;
      _fa.set(pos[i], pos[i + 1], pos[i + 2]);
      _fb.set(pos[i + 3], pos[i + 4], pos[i + 5]).sub(_fa);
      _fc.set(pos[i + 6], pos[i + 7], pos[i + 8]).sub(_fa);
      _fb.cross(_fc);
      fn[f * 3] = _fb.x; fn[f * 3 + 1] = _fb.y; fn[f * 3 + 2] = _fb.z;
      const l = _fb.length() || 1;
      fu[f * 3] = _fb.x / l; fu[f * 3 + 1] = _fb.y / l; fu[f * 3 + 2] = _fb.z / l;
    }
    if (cosC >= 0.9999) {
      for (let v = 0; v < count; v++) {
        const f = Math.floor(v / 3);
        out.set(fu.subarray(f * 3, f * 3 + 3), (start + v) * 3);
      }
      continue;
    }
    const groups = new Map();
    for (let v = 0; v < count; v++) {
      const k = key(start + v);
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(v);
    }
    for (const g of groups.values()) {
      for (const v of g) {
        const f = Math.floor(v / 3);
        let x = 0; let y = 0; let z = 0;
        for (const w of g) {
          const h = Math.floor(w / 3);
          if (fu[f * 3] * fu[h * 3] + fu[f * 3 + 1] * fu[h * 3 + 1] + fu[f * 3 + 2] * fu[h * 3 + 2] < cosC) continue;
          x += fn[h * 3]; y += fn[h * 3 + 1]; z += fn[h * 3 + 2];
        }
        const l = Math.hypot(x, y, z) || 1;
        const o = (start + v) * 3;
        out[o] = x / l; out[o + 1] = y / l; out[o + 2] = z / l;
      }
    }
  }
  return out;
}

export class PartBuilder {
  constructor() {
    this.items = [];
    this.stack = [new THREE.Matrix4()];
  }

  get matrix() {
    return this.stack[this.stack.length - 1];
  }

  /** Push a local frame (position, Euler rotation, scale). */
  push(p = [0, 0, 0], r = [0, 0, 0], s = 1) {
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    if (typeof s === 'number') _s.set(s, s, s);
    else _s.set(s[0], s[1], s[2]);
    _p.set(p[0], p[1], p[2]);
    const local = new THREE.Matrix4().compose(_p, _q, _s);
    this.stack.push(this.matrix.clone().multiply(local));
    return this;
  }

  pop() {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  /** Run fn inside a pushed frame. */
  frame(p, r, s, fn) {
    this.push(p, r, s);
    try {
      fn();
    } finally {
      this.pop();
    }
    return this;
  }

  /**
   * Add a piece. color: THREE.Color | css string | TEAM(shade).
   * opts: { glow: 0..1, mat: MATS key (overrides the color's tag), morph: { name: (v, out) => void } }
   */
  add(geo, color, opts = {}) {
    if (!geo) return null;
    geo.applyMatrix4(this.matrix);
    if (this.matrix.determinant() < 0) flipWinding(geo);
    const team = color && typeof color === 'object' && 'team' in color ? color.team : 0;
    const c = team ? WHITE : C(color);
    const matKey = MATS[opts.mat] ? opts.mat : team ? color.mat : c.mat;
    const mat = MATS[matKey] || MATS.cloth;
    // shading: facets meeting at less than `crease` blend smoothly (rounded
    // limbs, heads and cloth); gems keep hard facets
    const crease = opts.crease ?? (opts.flat || matKey === 'gem' ? 0 : SMOOTH_CREASE);
    this.items.push({ geo, color: c, team, glow: opts.glow || 0, mat, crease, morph: opts.morph || null });
    return geo;
  }

  /** Add a piece and its mirror image across z = 0 of the current frame. */
  addSym(geo, color, opts = {}, mirrorOpts = opts) {
    const m = mirrorZ(geo);
    this.add(geo, color, opts);
    this.add(m, color, mirrorOpts);
  }

  /** Transform a point from the current frame into the builder's root frame. */
  toRoot(p) {
    return new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(this.matrix).toArray();
  }

  /**
   * Rotation morph defined in the current frame (pivot, axis local). Mirrored
   * frames rotate the opposite way so symmetric parts stay symmetric.
   */
  rotMorphLocal(pivot, axis, angle) {
    const P = this.toRoot(pivot);
    const A = new THREE.Vector3(axis[0], axis[1], axis[2]).transformDirection(this.matrix);
    const sign = this.matrix.determinant() < 0 ? -1 : 1;
    return rotMorph(P, A.toArray(), angle * sign);
  }

  get triangles() {
    let n = 0;
    for (const it of this.items) n += it.geo.attributes.position.count / 3;
    return n;
  }

  /** Merge into one BufferGeometry (or null when empty). */
  build() {
    if (this.items.length === 0) return null;
    const geos = [];
    for (const it of this.items) {
      const g = it.geo;
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const fx = new Float32Array(n * 4);
      const ao = new Float32Array(n).fill(1);
      for (let i = 0; i < n; i++) {
        col[i * 3] = it.color.r;
        col[i * 3 + 1] = it.color.g;
        col[i * 3 + 2] = it.color.b;
        fx[i * 4] = it.team;
        fx[i * 4 + 1] = it.glow;
        fx[i * 4 + 2] = it.mat[0];
        fx[i * 4 + 3] = it.mat[1];
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aFx', new THREE.BufferAttribute(fx, 4));
      g.setAttribute('aAo', new THREE.BufferAttribute(ao, 1));
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    const ranges = [];
    let start = 0;
    for (const it of this.items) {
      const n = it.geo.attributes.position.count;
      ranges.push([start, n, Math.cos(it.crease)]);
      start += n;
    }
    const baseNormals = creasedNormals(merged.attributes.position.array, ranges);
    merged.setAttribute('normal', new THREE.BufferAttribute(baseNormals, 3));

    const names = [];
    for (const it of this.items) if (it.morph) for (const k of Object.keys(it.morph)) if (!names.includes(k)) names.push(k);
    if (names.length) {
      const total = merged.attributes.position.count;
      const pos = merged.attributes.position;
      const attrs = names.map((name) => {
        const a = new THREE.Float32BufferAttribute(new Float32Array(total * 3), 3);
        a.name = name;
        return a;
      });
      let off = 0;
      for (const it of this.items) {
        const n = it.geo.attributes.position.count;
        if (it.morph) {
          names.forEach((name, mi) => {
            const f = it.morph[name];
            if (!f) return;
            const arr = attrs[mi].array;
            for (let i = off; i < off + n; i++) {
              _v.fromBufferAttribute(pos, i);
              _o.set(0, 0, 0);
              f(_v, _o);
              arr[i * 3] = _o.x;
              arr[i * 3 + 1] = _o.y;
              arr[i * 3 + 2] = _o.z;
            }
          });
        }
        off += n;
      }
      merged.morphAttributes.position = attrs;
      // matching normal deltas, so bent knees / elbows / wings shade right
      // (only the ranges a morph moves are recomputed)
      const base = pos.array;
      merged.morphAttributes.normal = attrs.map((a, mi) => {
        const moved = new Float32Array(base.length);
        for (let i = 0; i < base.length; i++) moved[i] = base[i] + a.array[i];
        const sub = [];
        this.items.forEach((it, k) => {
          if (it.morph && it.morph[names[mi]]) sub.push(ranges[k]);
        });
        const nn = creasedNormals(moved, sub);
        const d = new Float32Array(base.length);
        for (const [s0, n] of sub) for (let i = s0 * 3; i < (s0 + n) * 3; i++) d[i] = nn[i] - baseNormals[i];
        const na = new THREE.Float32BufferAttribute(d, 3);
        na.name = a.name;
        return na;
      });
      merged.morphTargetsRelative = true;
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    merged.userData.triangles = merged.attributes.position.count / 3;
    merged.userData.morphNames = names;
    return merged;
  }
}

/** Highest base-pose y of a geometry (ignores morphs). */
export function topY(g) {
  if (!g) return 0;
  const p = g.attributes.position;
  let m = -Infinity;
  for (let i = 0; i < p.count; i++) m = Math.max(m, p.getY(i));
  return m;
}

const _ma = new THREE.Vector3();
const _mb = new THREE.Vector3();
const _mc = new THREE.Vector3();

/**
 * Bake ambient occlusion into the aAo attribute of a model's geometries.
 * entries: each geometry where it sits in a typical pose (matrix: model
 * space, feet on y = 0; positions: optional posed vertex positions, e.g. with
 * the elbow bent, in place of the geometry's own). A geometry listed more than
 * once (mirrored legs, two axles) gets the mean over its instances. Three
 * terms, multiplied per vertex:
 *  - crevices: every emitting triangle is a small disc occluder (Bunnell's
 *    form-factor approximation A·cosθr·cosθe / (πd² + A)). Both cosines are
 *    clamped, so the faces of one convex piece never occlude each other: a
 *    vertex only darkens where pieces meet (arm on torso, belt on tunic, hair
 *    on skull) or one part hangs over another. Discs seen from behind count
 *    half (open domes and cones have no inner faces).
 *  - ground: side faces darken toward the feet (fades out on faces that look
 *    up at the sky); opts.ground scales it (0 for flyers).
 *  - underside: faces turned down are a little darker.
 * @param {{ geo: THREE.BufferGeometry, matrix?: THREE.Matrix4, positions?: THREE.BufferAttribute, emit?: boolean, receive?: boolean }[]} entries
 * @param {{ ground?: number, strength?: number }} [opts]
 */
export function bakeAO(entries, { ground = 1, strength = 0.4 } = {}) {
  // emitters: center, unit normal, area, reach (beyond it a disc adds < ~1%)
  let nTri = 0;
  for (const e of entries) if (e.emit !== false) nTri += e.geo.attributes.position.count / 3;
  const posOf = (e) => e.positions || e.geo.attributes.position;
  const E = new Float32Array(nTri * 8);
  let end = 0;
  for (const e of entries) {
    if (e.emit === false) continue;
    const pos = posOf(e);
    for (let i = 0; i < pos.count; i += 3) {
      triangle(pos, i, e.matrix);
      const cx = (_ma.x + _mb.x + _mc.x) / 3;
      const cy = (_ma.y + _mb.y + _mc.y) / 3;
      const cz = (_ma.z + _mb.z + _mc.z) / 3;
      _mb.sub(_ma);
      _mc.sub(_ma);
      _ma.crossVectors(_mb, _mc);
      const len = _ma.length();
      if (len < 1e-9) continue;
      E[end] = cx;
      E[end + 1] = cy;
      E[end + 2] = cz;
      E[end + 3] = _ma.x / len;
      E[end + 4] = _ma.y / len;
      E[end + 5] = _ma.z / len;
      E[end + 6] = len / 2;
      E[end + 7] = Math.sqrt(len / 2 / 0.03);
      end += 8;
    }
  }
  const near = new Int32Array(nTri); // emitters within reach of the current receiver triangle
  const sums = new Map(); // geo → { acc, n }
  for (const e of entries) {
    if (e.receive === false) continue;
    const pos = posOf(e);
    let rec = sums.get(e.geo);
    if (!rec) {
      rec = { acc: new Float32Array(pos.count), n: 0 };
      sums.set(e.geo, rec);
    }
    rec.n++;
    const acc = rec.acc;
    for (let i = 0; i < pos.count; i += 3) {
      triangle(pos, i, e.matrix);
      const ax = _ma.x, ay = _ma.y, az = _ma.z;
      const bx = _mb.x, by = _mb.y, bz = _mb.z;
      const qx = _mc.x, qy = _mc.y, qz = _mc.z;
      // face normal (flat shading: one per triangle)
      let nx = (by - ay) * (qz - az) - (bz - az) * (qy - ay);
      let ny = (bz - az) * (qx - ax) - (bx - ax) * (qz - az);
      let nz = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
      const nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-12) {
        acc[i] += 1;
        acc[i + 1] += 1;
        acc[i + 2] += 1;
        continue;
      }
      nx /= nl;
      ny /= nl;
      nz /= nl;
      // candidate emitters: in front of the face (the three samples share its
      // plane, so this is the per-sample cosθr > 0 test done once) and in
      // reach of some point of the triangle
      const tx = (ax + bx + qx) / 3;
      const ty = (ay + by + qy) / 3;
      const tz = (az + bz + qz) / 3;
      const tr = Math.sqrt(Math.max(
        (ax - tx) ** 2 + (ay - ty) ** 2 + (az - tz) ** 2,
        (bx - tx) ** 2 + (by - ty) ** 2 + (bz - tz) ** 2,
        (qx - tx) ** 2 + (qy - ty) ** 2 + (qz - tz) ** 2,
      )) + 0.004;
      let nn = 0;
      for (let j = 0; j < end; j += 8) {
        const dx = E[j] - tx;
        const dy = E[j + 1] - ty;
        const dz = E[j + 2] - tz;
        if (nx * dx + ny * dy + nz * dz <= 0.003) continue;
        const r = E[j + 7] + tr;
        if (dx * dx + dy * dy + dz * dz <= r * r) near[nn++] = j;
      }
      for (let v = 0; v < 3; v++) {
        // sample a little off the face so coplanar neighbours do not count
        const px = (v === 0 ? ax : v === 1 ? bx : qx) + nx * 0.003;
        const py = (v === 0 ? ay : v === 1 ? by : qy) + ny * 0.003;
        const pz = (v === 0 ? az : v === 1 ? bz : qz) + nz * 0.003;
        let occ = 0;
        for (let k = 0; k < nn; k++) {
          const j = near[k];
          const dx = E[j] - px;
          const dy = E[j + 1] - py;
          const dz = E[j + 2] - pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          const A = E[j + 6];
          if (d2 * 0.03 > A) continue; // would add less than ~1%
          const cr = nx * dx + ny * dy + nz * dz;
          if (cr <= 0) continue;
          let ce = -(E[j + 3] * dx + E[j + 4] * dy + E[j + 5] * dz);
          if (ce < 0) ce *= -0.5;
          // (n·d)(−m·d) / d² = cosθr·cosθe, so no square root is needed
          occ += (A * cr * ce) / (d2 * (Math.PI * d2 + A) + 1e-12);
        }
        const cav = 1 - strength * (1 - Math.exp(-0.9 * occ));
        const h = Math.min(1, Math.max(0, py / 0.28));
        const low = 1 - h * h * (3 - 2 * h);
        const gr = 1 - ground * 0.2 * low * (1 - Math.max(0, ny));
        const under = 1 - 0.12 * Math.max(0, -ny);
        acc[i + v] += Math.max(0.22, cav * gr * under);
      }
    }
  }
  for (const [geo, rec] of sums) {
    let attr = geo.attributes.aAo;
    if (!attr || attr.count !== rec.acc.length) {
      attr = new THREE.BufferAttribute(new Float32Array(rec.acc.length), 1);
      geo.setAttribute('aAo', attr);
    }
    const a = attr.array;
    for (let i = 0; i < a.length; i++) a[i] = rec.acc[i] / rec.n;
    attr.needsUpdate = true;
  }
}

/** Triangle i..i+2 of a position attribute into _ma, _mb, _mc (optionally transformed). */
function triangle(pos, i, matrix) {
  _ma.fromBufferAttribute(pos, i);
  _mb.fromBufferAttribute(pos, i + 1);
  _mc.fromBufferAttribute(pos, i + 2);
  if (matrix) {
    _ma.applyMatrix4(matrix);
    _mb.applyMatrix4(matrix);
    _mc.applyMatrix4(matrix);
  }
}
