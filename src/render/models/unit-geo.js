// Geometry helpers for the procedural unit models: low-poly primitives, color
// helpers and PartBuilder, which merges colored pieces into one vertex-colored
// BufferGeometry (attributes: position, normal, color, aFx) with optional
// relative morph targets. aFx.x > 0 marks team-colored vertices (value = shade),
// aFx.y is the self-glow amount (0..1).
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

/** Team color marker for PartBuilder.add (shade multiplies the team color). */
export function TEAM(shade = 1) {
  return { team: shade };
}

/** Parse a CSS color (hex string, number or THREE.Color) into a new THREE.Color. */
export function C(c) {
  return c instanceof THREE.Color ? c.clone() : new THREE.Color(c);
}
/** Linear blend of two colors. */
export function mixC(a, b, t) {
  return C(a).lerp(C(b), t);
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
   * opts: { glow: 0..1, morph: { name: (v, out) => void } }
   */
  add(geo, color, opts = {}) {
    if (!geo) return null;
    geo.applyMatrix4(this.matrix);
    if (this.matrix.determinant() < 0) flipWinding(geo);
    const team = color && typeof color === 'object' && 'team' in color ? color.team : 0;
    const c = team ? WHITE : C(color);
    this.items.push({ geo, color: c, team, glow: opts.glow || 0, morph: opts.morph || null });
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
      const fx = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        col[i * 3] = it.color.r;
        col[i * 3 + 1] = it.color.g;
        col[i * 3 + 2] = it.color.b;
        fx[i * 2] = it.team;
        fx[i * 2 + 1] = it.glow;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aFx', new THREE.BufferAttribute(fx, 2));
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    merged.computeVertexNormals();

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
