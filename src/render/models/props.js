// Instanced nature props: forests and map decor (DESIGN 8).
//
//   const forest = createForest(mapData, (x, y) => heightAt(mapData, x, y));
//   scene.add(forest.object3d);
//   forest.fell(tx, ty);        // hide that tile's trees, leave a stump (on 'treeFelled' events)
//   const decor = createDecor(mapData, heightFn);
//   scene.add(decor.object3d);
//   decor.hideInRect(x0, y0, x1, y1); // e.g. under a newly placed building footprint
//   forest.dispose(); decor.dispose();  // shared geometry and material stay cached
//
// Trees: 4 variants (layered pine, clumpy broadleaf, birch, palm near sand/water)
// picked by a tile hash and low-frequency noise, 1–2 per forest tile with
// random rotation, scale and leaf tint (some yellow-green and autumn
// broadleaves) so forests read as solid but varied walls. One InstancedMesh per
// variant per CHUNK×CHUNK-tile chunk keeps draw calls low while letting
// off-screen chunks cull. Plants sway in the wind (foliage-shader.js; shadows
// too), canopies have normals bent away from their center (soft, rounded
// light), baked occlusion toward the trunk and light shining through the
// leaves. Rocks, ruins and stumps are still, physically based stone / wood with
// roughness per face and moss on their tops.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TERRAIN } from '../../config.js';
import { RNG, hashSeed } from '../../sim/rng.js';
import { heightAt } from '../height.js';
import { patchWorldMaterial } from '../shading.js';
import { patchFoliageMaterial, patchStoneMaterial, foliageDepthMaterial } from './foliage-shader.js';

// Forest chunk size (tiles). Every variant in a chunk is one InstancedMesh,
// culled as a whole in the main and the shadow pass: at close and default zoom
// 20 draws under half the off-screen trees 32 did, for a few more draw calls
// (a medium map still stays well under 200 forest + decor meshes).
const CHUNK = 20;
const PI = Math.PI;
const VARIANTS = ['pine', 'broadleaf', 'birch', 'palm'];
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _n = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const smooth01 = (t) => {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// geometry helpers (non-indexed parts: position, normal, color, aFol | aRough)
// ---------------------------------------------------------------------------

function prep(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const key of Object.keys(n.attributes)) if (key !== 'position') n.deleteAttribute(key);
  n.morphAttributes = {};
  n.clearGroups();
  return n;
}

/** Randomly push the vertices of a non-indexed geometry, keeping shared corners together. */
function wobble(g, amt, rng, keepBottom = false) {
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let o = seen.get(key);
    if (!o) {
      o = [(rng.next() - 0.5) * amt, (rng.next() - 0.5) * amt, (rng.next() - 0.5) * amt];
      seen.set(key, o);
    }
    if (keepBottom && p.getY(i) < 1e-3) continue;
    p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  return g;
}

/** Flatten the lower half of a blob around its own center (canopies sit flatter underneath). */
function squashBottom(g, k) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setY(i, p.getY(i) * k);
  return g;
}

const cyl = (rt, rb, h, seg, open = true, hseg = 1) => prep(new THREE.CylinderGeometry(rt, rb, h, seg, hseg, open)).translate(0, h / 2, 0);
const cone = (r, h, seg) => prep(new THREE.ConeGeometry(r, h, seg, 1, true)).translate(0, h / 2, 0);
const ico = (r) => prep(new THREE.IcosahedronGeometry(r, 0));
const dodeca = (r) => prep(new THREE.DodecahedronGeometry(r, 0));
const octa = (r) => prep(new THREE.OctahedronGeometry(r, 0));

/** A thin open branch from a to b (3-sided, tapering). */
function limb(a, b, r) {
  const from = new THREE.Vector3(...a);
  const dir = new THREE.Vector3(...b).sub(from);
  const len = dir.length();
  const g = cyl(r * 0.55, r, len, 3);
  g.applyQuaternion(_q.setFromUnitVectors(_up, dir.normalize()));
  return g.translate(from.x, from.y, from.z);
}

function triGeo(tris) {
  const arr = new Float32Array(tris.length * 9);
  let o = 0;
  for (const t of tris) for (const v of t) {
    arr[o++] = v[0];
    arr[o++] = v[1];
    arr[o++] = v[2];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Wind the triangles so each face normal points along ref(centroid) (outward / up). */
function orient(tris, ref) {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  return tris.map((t) => {
    a.set(...t[0]);
    b.set(...t[1]);
    c.set(...t[2]);
    const n = b.clone().sub(a).cross(c.clone().sub(a));
    const m = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    return n.dot(ref(m)) < 0 ? [t[0], t[2], t[1]] : t;
  });
}

/**
 * Colors, normals and wind data of one plant part (non-indexed): per-face color
 * jitter (faceColor(faceIndex) may replace the base color of a face) times a
 * per-vertex occlusion factor ao(p), face normals bent by `soft` toward the
 * direction away from `center` (rounded, "fluffy" light on canopies), and the
 * leaf flag (aFol.x; bend and flutter weights are filled in by finish()).
 * grad: { to, t(p) } blends each vertex toward a second color (e.g. sun-bleached leaf tips).
 */
function shade(g, color, rng, { jit = 0.1, ao = null, center = null, soft = 0, leaf = 0, faceColor = null, grad = null } = {}) {
  g.computeVertexNormals(); // non-indexed: face normals
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const fol = new Float32Array(n * 3);
  const base = new THREE.Color(color);
  const to = grad ? new THREE.Color(grad.to) : null;
  for (let i = 0, f = 0; i < n; i += 3, f++) {
    const k = 1 + (rng.next() * 2 - 1) * jit;
    const fc = faceColor ? faceColor(f) : null;
    const c = fc ? _c2.set(fc) : base;
    for (let v = i; v < i + 3 && v < n; v++) {
      _p.fromBufferAttribute(pos, v);
      const a = (ao ? ao(_p) : 1) * k;
      const t = to ? grad.t(_p) : 0;
      col[v * 3] = (c.r + (to ? (to.r - c.r) * t : 0)) * a;
      col[v * 3 + 1] = (c.g + (to ? (to.g - c.g) * t : 0)) * a;
      col[v * 3 + 2] = (c.b + (to ? (to.b - c.b) * t : 0)) * a;
      fol[v * 3] = leaf;
      if (center && soft > 0) {
        _n.fromBufferAttribute(nor, v);
        _d.subVectors(_p, center).normalize();
        _n.lerp(_d, soft).normalize();
        nor.setXYZ(v, _n.x, _n.y, _n.z);
      }
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aFol', new THREE.BufferAttribute(fol, 3));
  return g;
}

/** Occlusion inside a canopy of radius r around c: darker low down and toward the middle. */
function canopyAO(c, r, min) {
  return (p) => {
    const d = p.distanceTo(c) / r;
    const h = (p.y - c.y) / r;
    const t = 0.45 * smooth01((h + 1) * 0.5) + 0.7 * smooth01((d - 0.15) / 0.9);
    return min + (1 - min) * Math.min(1, t);
  };
}

/** Bark: dark where it meets the ground and in the shade of the crown from `top` up. */
const trunkAO = (top) => (p) => (0.6 + 0.4 * smooth01(p.y / 0.3)) * (p.y > top ? 0.7 : 1);

/**
 * Merge plant parts and fill in the wind weights: bend grows with height
 * (stiff trunk, supple crown), flutter only on leaves.
 */
function finish(parts, { height = 1, bend = 0, flutter = 0 } = {}) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  const pos = g.attributes.position;
  const fol = g.attributes.aFol;
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, pos.getY(i)) / height;
    fol.setY(i, bend * Math.pow(h, 1.6));
    fol.setZ(i, flutter * fol.getX(i) * smooth01(h * 1.3 - 0.15));
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Colors and roughness of one stone / wood part (non-indexed, flat shaded):
 * per-face color jitter and roughness, moss on faces that look up, occlusion ao(p).
 */
function shadeStone(g, color, rng, { jit = 0.1, ao = null, moss = 0, mossColor = '#4f6a2c', rough = [0.7, 1], faceColor = null } = {}) {
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  const rgh = new Float32Array(n);
  const base = new THREE.Color(color);
  const mossC = new THREE.Color(mossColor);
  for (let i = 0, f = 0; i < n; i += 3, f++) {
    const k = 1 + (rng.next() * 2 - 1) * jit;
    const fc = faceColor ? faceColor(f) : null;
    const c = _c2.copy(fc ? _c.set(fc) : base);
    let r = rough[0] + (rough[1] - rough[0]) * rng.next();
    // moss / lichen on faces turned to the sky
    const ny = (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) / 3;
    const m = moss * smooth01((ny - 0.45) / 0.4);
    if (m > 0 && rng.next() < m * 1.4) {
      c.lerp(mossC, 0.55 + 0.35 * rng.next());
      r = 1;
    }
    for (let v = i; v < i + 3 && v < n; v++) {
      _p.fromBufferAttribute(pos, v);
      const a = ao ? ao(_p) : 1;
      col[v * 3] = c.r * k * a;
      col[v * 3 + 1] = c.g * k * a;
      col[v * 3 + 2] = c.b * k * a;
      rgh[v] = r;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aRough', new THREE.BufferAttribute(rgh, 1));
  return g;
}

function finishStone(parts) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Stone darkens toward the ground it sits in. */
const groundAO = (h) => (p) => 0.58 + 0.42 * smooth01(p.y / h);

// ---------------------------------------------------------------------------
// trees (≤ 160 triangles each, built once, shared)
// ---------------------------------------------------------------------------

/**
 * One drooping pine tier: a mid ring and a jagged rim of n branch tips (2n
 * triangles). The tier's top is left open: the tier above (or the tip) covers it.
 */
function pineTier(R, h, n, rot, rng, droop = 0.07) {
  const mid = [];
  const rim = [];
  for (let i = 0; i < n; i++) {
    const a = rot + ((i + (rng.next() - 0.5) * 0.35) / n) * PI * 2;
    const long = i % 2 === 0;
    const rm = R * (0.46 + rng.next() * 0.1);
    const rr = R * (long ? 1 : 0.74) * (0.9 + rng.next() * 0.2);
    mid.push([Math.cos(a) * rm, h * (0.44 + rng.next() * 0.06), Math.sin(a) * rm]);
    // branch tips droop below the tier's base, the short ones less
    rim.push([Math.cos(a) * rr, long ? -droop * (0.8 + rng.next() * 0.4) : -droop * 0.15, Math.sin(a) * rr]);
  }
  const tris = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push([mid[i], rim[i], rim[j]], [mid[i], rim[j], mid[j]]);
  }
  return triGeo(orient(tris, (m) => _d.set(m.x, R * 0.6, m.z)));
}

/**
 * Spruce: a tall, narrow spire of seven drooping tiers (dark and blue-green
 * low in the shade, fresher toward the light at the branch tips and the
 * crown), on a short flared trunk.
 */
function pineGeo() {
  const r = new RNG(11);
  const parts = [shade(cyl(0.04, 0.09, 0.5, 5), '#4a3323', r, { jit: 0.08, ao: trunkAO(0.3) })];
  const tiers = [
    [0.6, 0.5, 0.26, '#26502a'], [0.53, 0.46, 0.5, '#2a572c'], [0.46, 0.43, 0.74, '#2e5e2f'], [0.39, 0.4, 0.97, '#336632'],
    [0.32, 0.37, 1.19, '#386d35'], [0.25, 0.34, 1.4, '#3d7438'], [0.18, 0.3, 1.6, '#427b3b'],
  ];
  tiers.forEach(([R, h, y, col], ti) => {
    const g = pineTier(R, h, 8, r.next() * PI, r, 0.05 + R * 0.12).translate(0, y, 0);
    const c = new THREE.Vector3(0, y - h * 0.1, 0);
    const tierK = 0.82 + ti * 0.03; // lower tiers sit in the shade of the upper ones
    // darker only deep inside, toward the trunk; the outer branches stay bright
    const ao = (p) => tierK * (0.66 + 0.34 * smooth01(Math.hypot(p.x, p.z) / R * 1.15 - 0.1));
    // branch tips catch the light: a fresher, yellower green
    const grad = { to: '#5e8c40', t: (p) => 0.6 * smooth01(Math.hypot(p.x, p.z) / R * 1.4 - 0.5) };
    // normals only a little rounded: the faceted tiers keep a crisp lit / shaded side
    parts.push(shade(g, col, r, { jit: 0.14, leaf: 1, center: c, soft: 0.2, ao, grad }));
  });
  // the leader: a slim spike wide enough at its base to close the top tier
  const tip = cone(0.12, 0.46, 5).translate(0, 1.72, 0);
  wobble(tip, 0.015, r);
  parts.push(shade(tip, '#467f3f', r, { jit: 0.08, leaf: 1, center: new THREE.Vector3(0, 1.8, 0), soft: 0.25 }));
  return finish(parts, { height: 2.2, bend: 0.075, flutter: 0.008 });
}

/**
 * Oak-like broadleaf: a forked trunk carrying an irregular crown of six leaf
 * clusters at different heights (a broad, lumpy silhouette with gaps), lit
 * as one soft volume.
 */
function broadleafGeo() {
  const r = new RNG(12);
  const C = new THREE.Vector3(0, 1.08, 0);
  const parts = [shade(cyl(0.05, 0.11, 0.78, 5), '#523727', r, { jit: 0.08, ao: trunkAO(0.6) })];
  for (const [a, b, rad] of [[[0, 0.5, 0], [0.32, 0.92, 0.12], 0.04], [[0, 0.58, 0], [-0.28, 0.96, -0.16], 0.035], [[0, 0.66, 0], [-0.05, 1.02, 0.3], 0.03]]) {
    parts.push(shade(limb(a, b, rad), '#4a3122', r, { jit: 0.06, ao: () => 0.7 }));
  }
  const lobes = [
    [0.4, 0.02, 1.16, 0.0, '#4a8636'], [0.34, 0.36, 0.98, 0.14, '#538f3a'], [0.32, -0.33, 1.0, -0.17, '#447f32'],
    [0.29, -0.06, 0.94, 0.38, '#4e8a37'], [0.27, 0.16, 0.92, -0.34, '#4b8735'], [0.27, 0.06, 1.46, 0.05, '#5c9a42'],
  ];
  for (const [rad, x, y, z, col] of lobes) {
    const g = ico(rad);
    squashBottom(g, 0.62);
    wobble(g, rad * 0.28, r);
    const grad = { to: '#78a64a', t: (p) => 0.45 * smooth01((p.y - 1.0) / 0.5) };
    parts.push(shade(g.translate(x, y, z), col, r, { jit: 0.09, leaf: 1, center: C, soft: 0.62, ao: canopyAO(C, 0.72, 0.5), grad }));
  }
  return finish(parts, { height: 1.8, bend: 0.07, flutter: 0.014 });
}

function birchGeo() {
  const r = new RNG(13);
  const C = new THREE.Vector3(0.02, 1.2, 0);
  // white bark with dark lenticel marks on random facets (pairs: whole quads)
  const marks = new RNG(131);
  const markOf = [];
  const trunk = cyl(0.032, 0.056, 1.16, 5, true, 4);
  trunk.rotateZ(0.035);
  const parts = [shade(trunk, '#e6e2d6', r, {
    jit: 0.06,
    ao: trunkAO(0.95),
    faceColor: (f) => {
      const q = f >> 1;
      if (markOf[q] === undefined) markOf[q] = marks.next();
      return markOf[q] < 0.3 ? '#35302b' : markOf[q] < 0.42 ? '#a9a59b' : null;
    },
  })];
  for (const [a, b, rad] of [[[0.02, 0.8, 0], [0.2, 1.05, 0.08], 0.018], [[0.025, 0.88, 0], [-0.17, 1.1, -0.06], 0.016]]) {
    parts.push(shade(limb(a, b, rad), '#d8d3c5', r, { jit: 0.05, ao: () => 0.72 }));
  }
  const lobes = [[0.3, 0, 1.2, 0, '#8db544'], [0.25, 0.15, 0.98, 0.1, '#83aa3e'], [0.24, -0.13, 1.03, -0.08, '#8fb746'], [0.21, 0.01, 1.5, -0.03, '#9cc250']];
  for (const [rad, x, y, z, col] of lobes) {
    const g = ico(rad);
    g.scale(0.88, 1.3, 0.88);
    squashBottom(g, 0.75);
    wobble(g, rad * 0.22, r);
    parts.push(shade(g.translate(x, y, z), col, r, { jit: 0.08, leaf: 1, center: C, soft: 0.78, ao: canopyAO(C, 0.5, 0.5) }));
  }
  return finish(parts, { height: 1.75, bend: 0.08, flutter: 0.016 });
}

function palmGeo() {
  const r = new RNG(14);
  const parts = [];
  // curved, ringed trunk in four leaning segments
  let px = 0;
  let py = 0;
  const segs = [[0.085, 0.075, 0.44, 0.04], [0.075, 0.068, 0.42, 0.1], [0.068, 0.06, 0.42, 0.17], [0.06, 0.055, 0.38, 0.25]];
  for (const [rb, rt, h, lean] of segs) {
    const g = cyl(rt, rb, h, 5);
    // each segment darker at its base: the ring scars of old fronds
    const ao = (p) => 0.68 + 0.32 * smooth01(p.y / h);
    shade(g, '#8a6b45', r, { jit: 0.1, ao });
    g.rotateZ(-lean);
    g.translate(px, py, 0);
    parts.push(g);
    px += Math.sin(lean) * h;
    py += Math.cos(lean) * h * 0.98;
  }
  const top = new THREE.Vector3(px, py, 0);
  // fronds: arching, folded along the spine (V section), drooping at the tip
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2 + r.next() * 0.35;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const len = 0.74 + r.next() * 0.16;
    const rise = i % 2 ? 0.1 : 0.15;
    const at = (t, up) => [top.x + ca * len * t, top.y + up, top.z + sa * len * t];
    const side = (p, w, down) => [[p[0] - sa * w, p[1] - down, p[2] + ca * w], [p[0] + sa * w, p[1] - down, p[2] - ca * w]];
    const B = [top.x, top.y + 0.02, top.z];
    const M1 = at(0.38, rise);
    const M2 = at(0.72, rise * 0.25);
    const T = at(1, -0.24);
    const [L1, R1] = side(M1, 0.15, 0.05);
    const [L2, R2] = side(M2, 0.11, 0.045);
    const tris = [[B, L1, M1], [B, M1, R1], [M1, L1, L2], [M1, L2, M2], [M1, M2, R2], [M1, R2, R1], [M2, L2, T], [M2, T, R2]];
    const g = triGeo(orient(tris, () => _up));
    const out = (p) => Math.hypot(p.x - top.x, p.z - top.z) / len;
    const ao = (p) => 0.6 + 0.45 * smooth01(out(p) * 1.5);
    const grad = { to: '#94a447', t: (p) => 0.75 * smooth01(out(p) * 1.6 - 0.55) };
    parts.push(shade(g, i % 2 ? '#3d7a30' : '#468334', r, { jit: 0.08, leaf: 1, center: _n.set(top.x, top.y - 0.25, top.z).clone(), soft: 0.35, ao, grad }));
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + 0.4;
    const nut = octa(0.055).translate(top.x + Math.cos(a) * 0.06, top.y - 0.07, top.z + Math.sin(a) * 0.06);
    parts.push(shade(nut, '#5e4226', r, { jit: 0.1, ao: () => 0.8 }));
  }
  const g = finish(parts, { height: 1.7, bend: 0.09, flutter: 0.022 });
  g.translate(-px * 0.4, 0, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function stumpGeo() {
  const r = new RNG(15);
  const parts = [shadeStone(cyl(0.1, 0.14, 0.15, 7), '#5e4330', r, { jit: 0.1, ao: groundAO(0.12), rough: [0.8, 1] })];
  // cut face: light wood, darker heart and bark ring
  const tris = [];
  const c = [0, 0.15, 0];
  for (let i = 0; i < 7; i++) {
    const a0 = (i / 7) * PI * 2;
    const a1 = ((i + 1) / 7) * PI * 2;
    tris.push([c, [Math.cos(a1) * 0.1, 0.15, Math.sin(a1) * 0.1], [Math.cos(a0) * 0.1, 0.15, Math.sin(a0) * 0.1]]);
  }
  const cut = triGeo(orient(tris, () => _up));
  parts.push(shadeStone(cut, '#c9a06c', r, { jit: 0.05, rough: [0.85, 0.95], ao: (p) => 0.72 + 0.4 * smooth01(Math.hypot(p.x, p.z) / 0.1) }));
  for (let i = 0; i < 3; i++) {
    const g = cyl(0.025, 0.045, 0.17, 4);
    g.rotateZ(PI / 2 - 0.35);
    g.rotateY((i / 3) * PI * 2 + 0.4);
    parts.push(shadeStone(g.translate(0, 0.02, 0), '#53392a', r, { jit: 0.08, ao: groundAO(0.08), rough: [0.85, 1] }));
  }
  return finishStone(parts);
}

// ---------------------------------------------------------------------------
// decor (≤ 200 triangles each)
// ---------------------------------------------------------------------------

function rockGeo(variant) {
  const r = new RNG(20 + variant);
  const parts = [];
  let list;
  if (variant === 0) list = [[0.24, 0, 0, 0.7, '#8a8479']];
  else if (variant === 1) list = [[0.18, -0.08, 0.02, 0.8, '#7f786e'], [0.13, 0.14, -0.06, 0.9, '#958d81'], [0.08, 0.05, 0.16, 1, '#8a8378']];
  else list = [[0.07, 0.15, 0.08, 0.8, '#8d867b']];
  for (const [rad, x, z, sy, col] of list) {
    const g = dodeca(rad);
    wobble(g, rad * 0.35, r);
    g.scale(1, sy, 1);
    const h = rad * sy * 1.1;
    parts.push(shadeStone(g.translate(x, rad * sy * 0.55, z), col, r, { jit: 0.12, moss: 0.75, ao: groundAO(h), rough: [0.55, 0.95] }));
  }
  if (variant === 2) {
    // a tall weathered shard leaning out of the ground
    const g = ico(0.15);
    g.scale(0.85, 1.75, 0.7);
    wobble(g, 0.05, r);
    g.rotateZ(0.16);
    g.rotateX(-0.08);
    parts.push(shadeStone(g.translate(0, 0.2, 0), '#837d74', r, { jit: 0.12, moss: 0.6, ao: groundAO(0.3), rough: [0.5, 0.9] }));
  }
  return finishStone(parts);
}

function bushGeo(variant) {
  const r = new RNG(30 + variant);
  const parts = [];
  const C = new THREE.Vector3(0, 0.12, 0);
  const lobes = variant === 0
    ? [[0.18, 0, 0.13, 0, '#36692b'], [0.14, 0.15, 0.1, 0.06, '#3f7530'], [0.13, -0.13, 0.1, -0.05, '#315f27'], [0.11, 0.02, 0.25, -0.03, '#4a8437']]
    : [[0.17, 0, 0.12, 0, '#3a6e2c'], [0.13, 0.13, 0.09, -0.07, '#427731'], [0.12, -0.11, 0.1, 0.08, '#356628']];
  for (const [rad, x, y, z, col] of lobes) {
    const g = ico(rad);
    squashBottom(g, 0.6);
    wobble(g, rad * 0.3, r);
    parts.push(shade(g.translate(x, y, z), col, r, { jit: 0.12, leaf: 1, center: C, soft: 0.7, ao: canopyAO(C, 0.26, 0.45) }));
  }
  if (variant === 1) {
    // berries / blossoms peeking out of the leaves
    const colors = ['#c3303a', '#d8424a', '#b52a35'];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * PI * 2 + r.next() * 0.5;
      const y = 0.12 + r.next() * 0.12;
      const d = 0.13 + (0.2 - Math.abs(y - 0.15)) * 0.25;
      const b = octa(0.026).translate(Math.cos(a) * d, y, Math.sin(a) * d);
      parts.push(shade(b, colors[i % 3], r, { jit: 0.05, leaf: 1 }));
    }
  }
  return finish(parts, { height: 0.35, bend: 0.03, flutter: 0.008 });
}

function flowersGeo(variant) {
  const r = new RNG(40 + variant);
  const parts = [];
  // a few leafy blades at the foot
  const blades = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2 + r.next() * 0.5;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const w = 0.03;
    blades.push([[-sa * w, 0, ca * w], [sa * w, 0, -ca * w], [ca * (0.1 + r.next() * 0.05), 0.07 + r.next() * 0.05, sa * (0.1 + r.next() * 0.05)]]);
  }
  parts.push(shade(triGeo(blades), '#3f7a2e', r, { jit: 0.1, leaf: 1, center: new THREE.Vector3(0, -0.3, 0), soft: 0.8, ao: (p) => 0.6 + 0.5 * smooth01(p.y / 0.1) }));
  const colors = variant === 0 ? ['#e8463a', '#f2c63a', '#f6f0e6', '#e8463a', '#f2c63a', '#ff8a3a'] : ['#9a5ad8', '#f6f0e6', '#4a8ae8', '#e86ab0', '#9a5ad8', '#f6f0e6'];
  for (let i = 0; i < colors.length; i++) {
    const a = (i / colors.length) * PI * 2 + r.next() * 0.6;
    const d = 0.04 + r.next() * 0.1;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const h = 0.12 + r.next() * 0.1;
    const hx = x + (r.next() - 0.5) * 0.04;
    const hz = z + (r.next() - 0.5) * 0.04;
    parts.push(shade(triGeo([[[x - 0.008, 0, z], [x + 0.008, 0, z], [hx, h, hz]]]), '#3f7a2c', r, { jit: 0.05, leaf: 1 }));
    // five petals around a raised center
    const petals = [];
    const rot = r.next() * PI;
    for (let k = 0; k < 5; k++) {
      const b = rot + (k / 5) * PI * 2;
      const tip = [hx + Math.cos(b) * 0.042, h + 0.004, hz + Math.sin(b) * 0.042];
      const s1 = [hx + Math.cos(b - 0.5) * 0.022, h + 0.008, hz + Math.sin(b - 0.5) * 0.022];
      const s2 = [hx + Math.cos(b + 0.5) * 0.022, h + 0.008, hz + Math.sin(b + 0.5) * 0.022];
      petals.push([[hx, h + 0.01, hz], s1, tip], [[hx, h + 0.01, hz], tip, s2]);
    }
    parts.push(shade(triGeo(orient(petals, () => _up)), colors[i], r, { jit: 0.05, leaf: 1, center: new THREE.Vector3(hx, h - 0.05, hz), soft: 0.4 }));
    const eye = octa(0.012).translate(hx, h + 0.012, hz);
    parts.push(shade(eye, i % 2 ? '#f0c43a' : '#e3a02a', r, { jit: 0.05, leaf: 1 }));
  }
  return finish(parts, { height: 0.22, bend: 0.035, flutter: 0.01 });
}

function grassGeo() {
  const r = new RNG(50);
  const tris = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * PI * 2 + r.next() * 0.5;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const h = 0.17 + r.next() * 0.15;
    const lean = 0.06 + r.next() * 0.08;
    const w = 0.028;
    const b0 = [-sa * w + ca * 0.02, 0, ca * w + sa * 0.02];
    const b1 = [sa * w + ca * 0.02, 0, -ca * w + sa * 0.02];
    const tip = [ca * lean, h, sa * lean];
    tris.push([b0, b1, tip]);
  }
  const g = triGeo(tris);
  // lit like the ground it grows from: normals point up and a little outward
  shade(g, '#5a9a3a', r, { jit: 0.15, leaf: 1, center: new THREE.Vector3(0, -0.35, 0), soft: 0.85, ao: (p) => 0.55 + 0.6 * smooth01(p.y / 0.3) });
  return finish([g], { height: 0.3, bend: 0.045, flutter: 0 });
}

function ruinGeo(variant) {
  const r = new RNG(60 + variant);
  const parts = [];
  const tones = ['#c4bcab', '#b4ac9b', '#a79f8f', '#bdb4a2'];
  const stone = (g, ao, moss = 0.55) => shadeStone(g, tones[Math.floor(r.next() * tones.length)], r, {
    jit: 0.1,
    moss,
    mossColor: '#5a6e34',
    ao,
    rough: [0.75, 1],
    // weathering: the odd darker, stained facet
    faceColor: () => (r.next() < 0.12 ? '#8f8778' : null),
  });
  if (variant === 0) {
    parts.push(stone(prep(new THREE.BoxGeometry(0.36, 0.08, 0.36)).translate(0, 0.04, 0), groundAO(0.08), 0.3));
    const shaft = cyl(0.09, 0.105, 0.55, 7, false);
    const p = shaft.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.5) p.setY(i, p.getY(i) - 0.18 * (0.5 + 0.5 * Math.sin(p.getX(i) * 20 + p.getZ(i) * 13)));
    parts.push(stone(shaft.translate(0, 0.08, 0), groundAO(0.3), 0.7));
    const drum = cyl(0.095, 0.095, 0.22, 7, false);
    drum.rotateZ(PI / 2);
    drum.rotateY(0.6);
    parts.push(stone(drum.translate(0.25, 0.09, 0.12), groundAO(0.12), 0.8));
    for (const [rad, x, z] of [[0.06, -0.18, 0.16], [0.045, 0.06, 0.24], [0.04, -0.2, -0.12]]) {
      const g = dodeca(rad);
      wobble(g, rad * 0.4, r);
      parts.push(stone(g.translate(x, rad * 0.5, z), groundAO(rad), 0.4));
    }
  } else {
    const blocks = [[0, 0.07, 0, 0.5, 0.14, 0.16], [0.05, 0.21, 0, 0.36, 0.14, 0.15], [-0.1, 0.35, 0.01, 0.18, 0.12, 0.14], [0.28, 0.06, 0.2, 0.18, 0.12, 0.16]];
    for (const [x, y, z, w, h, d] of blocks) {
      const g = prep(new THREE.BoxGeometry(w, h, d));
      wobble(g, 0.018, r);
      g.rotateY((r.next() - 0.5) * 0.4);
      parts.push(stone(g.translate(x, y, z), groundAO(0.3), 0.75));
    }
    for (const [rad, x, z] of [[0.05, -0.3, 0.12], [0.04, 0.12, -0.18]]) {
      const g = dodeca(rad);
      wobble(g, rad * 0.4, r);
      parts.push(stone(g.translate(x, rad * 0.5, z), groundAO(rad), 0.4));
    }
  }
  return finishStone(parts);
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  // Plants: Lambert (cheap; hemisphere ambient only) with wind and soft leaf
  // light; the double-sided variant for flat leaves (palm fronds, flowers, grass).
  // Closed crowns (broadleaf, birch, bushes) cast from their back faces, the default.
  const plant = new THREE.MeshLambertMaterial({ vertexColors: true });
  plant.name = 'props-plant';
  // leafy crowns: clumped leaf texture with ragged edges (foliage-shader.js uFolDetail)
  patchWorldMaterial(patchFoliageMaterial(plant, { detail: [9, 0.4, 0.85, 0] }), { cloud: true, rim: 0.12 });
  // Pine tiers are open skirts flatter than the sun is high: with the default
  // back-face shadow pass they would cast only thin rings, so both faces cast.
  // Same program as `plant`; only the shadow pass differs.
  const plantOpen = new THREE.MeshLambertMaterial({ vertexColors: true });
  plantOpen.name = 'props-plant-open';
  plantOpen.shadowSide = THREE.DoubleSide;
  // less wrap than the round crowns: needles keep a crisp lit and shaded side
  patchWorldMaterial(patchFoliageMaterial(plantOpen, { wrap: 0.15, translucency: 0.3, detail: [8, 0.34, 0.55, 1] }), { cloud: true, rim: 0.12 });
  const plant2 = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  plant2.name = 'props-plant-2s';
  patchWorldMaterial(patchFoliageMaterial(plant2, { wrap: 0.5, translucency: 0.45 }), { cloud: true, rim: 0.12 });
  // Still props: physically based stone / wood, flat shaded, roughness per face.
  const stone = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, metalness: 0 });
  stone.name = 'props-stone';
  patchWorldMaterial(patchStoneMaterial(stone), { cloud: true });
  SHARED = {
    mat: { plant, plantOpen, plant2, stone },
    depth: foliageDepthMaterial(),
    trees: { pine: pineGeo(), broadleaf: broadleafGeo(), birch: birchGeo(), palm: palmGeo() },
    stump: stumpGeo(),
    decor: {
      rock: [rockGeo(0), rockGeo(1), rockGeo(2)],
      bush: [bushGeo(0), bushGeo(1)],
      flowers: [flowersGeo(0), flowersGeo(1)],
      ruin: [ruinGeo(0), ruinGeo(1)],
      stump: null,
      grass: [grassGeo()],
    },
  };
  SHARED.decor.stump = [SHARED.stump];
  return SHARED;
}

/** Material of a tree variant / decor kind, and whether it sways (needs the swaying shadow material). */
const TREE_MAT = { pine: 'plantOpen', broadleaf: 'plant', birch: 'plant', palm: 'plant2' };
const DECOR_MAT = { rock: 'stone', bush: 'plant', flowers: 'plant2', ruin: 'stone', stump: 'stone', grass: 'plant2' };

/** Triangle counts of the shared prop geometries (for tests and budgets). */
export function getPropInfo() {
  const s = shared();
  const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  const trees = {};
  for (const v of VARIANTS) trees[v] = tri(s.trees[v]);
  const decor = {};
  for (const [k, list] of Object.entries(s.decor)) decor[k] = list.map(tri);
  return { trees, stump: tri(s.stump), decor };
}

// ---------------------------------------------------------------------------
// noise
// ---------------------------------------------------------------------------

function ihash(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = ihash(x0, y0, seed);
  const b = ihash(x0 + 1, y0, seed);
  const c = ihash(x0, y0 + 1, seed);
  const d = ihash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a + (d - c - b + a) * sx) * sy;
}

function resolveHeightFn(mapData, heightFn) {
  if (typeof heightFn === 'function') return heightFn;
  return (x, y) => heightAt(mapData, x, y);
}

/**
 * Leaf tint of one tree (a multiplier of its vertex colors; the bark only takes
 * the green channel as brightness). r1, r2: per-tree randoms, n: low-frequency
 * noise so tints come in patches (a stand of autumn broadleaves).
 */
function treeTint(variant, r1, r2, n, out) {
  const k = 0.8 + r1 * 0.36;
  const h = (r2 - 0.5) * 0.24;
  if (variant === 'broadleaf') {
    const autumn = r2 * 0.75 + n * 0.5; // 0 … 1.25
    if (autumn > 0.99) return out.setRGB(k * 4.2, k * 0.78, k * 0.55); // rust red-orange
    if (autumn > 0.87) return out.setRGB(k * 3.0, k * 1.0, k * 0.5); // ochre
    if (autumn > 0.74) return out.setRGB(k * 1.75, k * 1.12, k * 0.62); // yellow-green
    return out.setRGB(k * (1 + h), k * (1 + h * 0.3), k * (1 - h));
  }
  if (variant === 'birch') {
    if (r2 > 0.8) return out.setRGB(k * 1.7, k * 0.9, k * 0.48); // golden (warm, not lemon)
    return out.setRGB(k * (1 + h), k, k * (1 - h));
  }
  if (variant === 'palm') return out.setRGB(k * (1 + h * 1.4), k, k * (1 - h));
  // pine: mostly deep teal-green, with stands of olive spruce and a few
  // golden larches turning (the mixed conifer edge of the reference look)
  const larch = r2 * 0.7 + n * 0.45; // 0 … 1.15
  if (larch > 1.0) return out.setRGB(k * 2.6, k * 1.25, k * 0.55);
  if (larch > 0.86) return out.setRGB(k * 1.35, k * 1.08, k * 0.72);
  // slightly blue-green to olive
  return out.setRGB(k * (0.78 + h), k * (0.92 + h * 0.2), k * (1.02 - h * 0.5)); // deep teal-green
}

// ---------------------------------------------------------------------------
// forest
// ---------------------------------------------------------------------------

/**
 * Instanced forest for every FOREST tile of mapData.
 * @param {{width:number, height:number, terrain:Uint8Array, heights?:Float32Array, seed?:number|string}} mapData
 * @param {(x:number, y:number)=>number} [heightFn] terrain height at sim (x, y); defaults to heightAt(mapData, x, y)
 * @returns {{object3d: THREE.Group, fell: (tx:number, ty:number)=>boolean, isStanding: (tx:number, ty:number)=>boolean,
 *   count: number, dispose: ()=>void}}
 */
export function createForest(mapData, heightFn) {
  const S = shared();
  const hf = resolveHeightFn(mapData, heightFn);
  const W = mapData.width;
  const H = mapData.height ?? mapData.width;
  const T = mapData.terrain;
  const { FOREST, SAND, WATER } = TERRAIN;
  const seed = hashSeed(`forest|${mapData.seed ?? 0}|${W}x${H}`) | 0;
  const group = new THREE.Group();
  group.name = 'forest';

  // wet[i] = sand or water within 2 tiles (palm country)
  const coast = new Uint8Array(W * H);
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const t = T[ty * W + tx];
      if (t !== SAND && t !== WATER) continue;
      for (let oy = -2; oy <= 2; oy++) {
        const yy = ty + oy;
        if (yy < 0 || yy >= H) continue;
        for (let ox = -2; ox <= 2; ox++) {
          const xx = tx + ox;
          if (xx >= 0 && xx < W) coast[yy * W + xx] = 1;
        }
      }
    }
  }

  // Lay out instances per chunk and variant.
  const cw = Math.ceil(W / CHUNK);
  const buckets = new Map(); // `${chunk}|${variant}` → { variant, list: [{ tile, x, y, h, rot, sx, sy, tilt, tint, r2, n }] }
  const trees = [];
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const i = ty * W + tx;
      if (T[i] !== FOREST) continue;
      const h0 = ihash(tx, ty, seed);
      const count = h0 < 0.55 ? 2 : 1;
      let variant;
      const pick = ihash(tx, ty, seed + 1);
      const n = valueNoise(tx / 9, ty / 9, seed + 7) * 0.8 + valueNoise(tx / 3.5, ty / 3.5, seed + 9) * 0.2;
      if (coast[i]) variant = pick < 0.72 ? 'palm' : 'broadleaf';
      else {
        if (n < 0.42) variant = pick < 0.82 ? 'pine' : 'birch';
        else if (n < 0.62) variant = pick < 0.38 ? 'pine' : pick < 0.8 ? 'broadleaf' : 'birch';
        else variant = pick < 0.68 ? 'broadleaf' : pick < 0.9 ? 'birch' : 'pine';
      }
      const chunk = Math.floor(ty / CHUNK) * cw + Math.floor(tx / CHUNK);
      const autumnN = valueNoise(tx / 6, ty / 6, seed + 11);
      for (let j = 0; j < count; j++) {
        const r1 = ihash(tx * 7 + j, ty * 13 + j * 3, seed + 3);
        const r2 = ihash(tx * 11 + j, ty * 5 + j * 7, seed + 4);
        const r3 = ihash(tx * 3 + j, ty * 17 + j, seed + 5);
        let ox = (r1 - 0.5) * 0.24;
        let oy = (r2 - 0.5) * 0.24;
        if (count === 2) {
          const a = h0 * 40 + j * PI;
          ox += Math.cos(a) * 0.22;
          oy += Math.sin(a) * 0.22;
        }
        const v = j === 1 && variant !== 'palm' && r3 < 0.25 ? (variant === 'pine' ? 'birch' : 'pine') : variant;
        const x = tx + 0.5 + ox;
        const y = ty + 0.5 + oy;
        const base = count === 2 ? 0.86 : 1.06;
        const s = base * (0.85 + r3 * 0.32);
        const key = `${chunk}|${v}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { variant: v, list: [] }));
        const tree = {
          // spruces vary more in height than in girth: a ragged skyline
          tile: i, x, y, h: hf(x, y) - 0.04, rot: r1 * PI * 2, sx: s, sy: s * (v === 'pine' ? 0.82 + r2 * 0.42 : 0.92 + r2 * 0.2), tilt: (r2 - 0.5) * 0.12,
          tint: r3, r2: ihash(tx * 5 + j, ty * 3 + j * 11, seed + 6), n: autumnN, bucket: b, index: b.list.length,
        };
        b.list.push(tree);
        trees.push(tree);
      }
    }
  }

  const meshes = [];
  for (const b of buckets.values()) {
    const mesh = new THREE.InstancedMesh(S.trees[b.variant], S.mat[TREE_MAT[b.variant]], b.list.length);
    mesh.name = `forest-${b.variant}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.customDepthMaterial = S.depth;
    b.list.forEach((t, idx) => {
      _e.set(t.tilt, t.rot, t.tilt * 0.6);
      _q.setFromEuler(_e);
      _p.set(t.x, t.h, t.y);
      _s.set(t.sx, t.sy, t.sx);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(idx, _m);
      mesh.setColorAt(idx, treeTint(b.variant, t.tint, t.r2, t.n, _c));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    b.mesh = mesh;
    meshes.push(mesh);
    group.add(mesh);
  }

  // tile → trees
  const byTile = new Map();
  for (const t of trees) {
    const list = byTile.get(t.tile);
    if (list) list.push(t);
    else byTile.set(t.tile, [t]);
  }
  const felled = new Uint8Array(W * H);
  const stumps = new THREE.InstancedMesh(S.stump, S.mat.stone, Math.max(1, byTile.size));
  stumps.name = 'forest-stumps';
  stumps.count = 0;
  stumps.frustumCulled = false;
  stumps.castShadow = false;
  stumps.receiveShadow = true;
  group.add(stumps);

  return {
    object3d: group,
    count: trees.length,
    fell(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
      const i = ty * W + tx;
      const list = byTile.get(i);
      if (!list || felled[i]) return false;
      felled[i] = 1;
      for (const t of list) {
        const m = t.bucket.mesh;
        m.setMatrixAt(t.index, ZERO);
        m.instanceMatrix.addUpdateRange(t.index * 16, 16);
        m.instanceMatrix.needsUpdate = true;
      }
      const t = list[0];
      const si = stumps.count;
      _e.set(0, t.rot, 0);
      _q.setFromEuler(_e);
      _p.set(t.x, t.h + 0.03, t.y);
      _s.setScalar(0.8 + t.tint * 0.4);
      _m.compose(_p, _q, _s);
      stumps.setMatrixAt(si, _m);
      stumps.count = si + 1;
      stumps.instanceMatrix.addUpdateRange(si * 16, 16);
      stumps.instanceMatrix.needsUpdate = true;
      return true;
    },
    isStanding(tx, ty) {
      const i = ty * W + tx;
      return byTile.has(i) && !felled[i];
    },
    dispose() {
      if (group.parent) group.parent.remove(group);
      for (const m of meshes) m.dispose();
      stumps.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// decor
// ---------------------------------------------------------------------------

const DECOR_JITTER = { rock: 0.14, bush: 0.18, flowers: 0.04, ruin: 0.1, stump: 0.12, grass: 0.22 };
const DECOR_SINK = { rock: 0.04, bush: 0.02, flowers: 0.01, ruin: 0.03, stump: 0.02, grass: 0.01 };

/**
 * Instanced decor props from mapData.decor (rocks, bushes, flowers, ruins, stumps, grass tufts).
 * @param {{decor: {x:number, y:number, kind:string, rot:number, scale:number}[]}} mapData
 * @param {(x:number, y:number)=>number} [heightFn]
 * @returns {{object3d: THREE.Group, hideInRect: (x0:number, y0:number, x1:number, y1:number)=>number, dispose: ()=>void}}
 */
export function createDecor(mapData, heightFn) {
  const S = shared();
  const hf = resolveHeightFn(mapData, heightFn);
  const group = new THREE.Group();
  group.name = 'decor';
  const lists = new Map();
  for (const d of mapData.decor || []) {
    const variants = S.decor[d.kind];
    if (!variants) continue;
    const vi = variants.length > 1 ? Math.floor(ihash(Math.round(d.x * 100), Math.round(d.y * 100), 77) * variants.length) : 0;
    const key = `${d.kind}|${vi}`;
    let l = lists.get(key);
    if (!l) lists.set(key, (l = { kind: d.kind, geo: variants[vi], items: [], hidden: null }));
    l.items.push(d);
  }
  const meshes = [];
  for (const l of lists.values()) {
    const matKey = DECOR_MAT[l.kind] || 'stone';
    const mesh = new THREE.InstancedMesh(l.geo, S.mat[matKey], l.items.length);
    mesh.name = `decor-${l.kind}`;
    mesh.castShadow = l.kind === 'rock' || l.kind === 'ruin' || l.kind === 'bush';
    mesh.receiveShadow = true;
    if (matKey !== 'stone') mesh.customDepthMaterial = S.depth;
    const jit = DECOR_JITTER[l.kind] ?? 0.1;
    const plant = matKey !== 'stone';
    l.items.forEach((d, idx) => {
      const s = d.scale || 1;
      _e.set(0, d.rot || 0, 0);
      _q.setFromEuler(_e);
      _p.set(d.x, hf(d.x, d.y) - (DECOR_SINK[l.kind] ?? 0) * s, d.y);
      _s.setScalar(s);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(idx, _m);
      const r = ihash(Math.round(d.x * 37), Math.round(d.y * 53), 5);
      const k = 1 + (r - 0.5) * 2 * jit;
      // plants also shift hue a little (fresh to dry), stone only in brightness
      const hue = plant ? (ihash(Math.round(d.x * 23), Math.round(d.y * 41), 9) - 0.5) * 0.3 : (r - 0.5) * 0.05;
      _c.setRGB(k * (1 + hue), k * (1 + hue * 0.3), k * (1 - hue * 0.8));
      mesh.setColorAt(idx, _c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    l.mesh = mesh;
    l.hidden = new Uint8Array(l.items.length);
    meshes.push(mesh);
    group.add(mesh);
  }
  return {
    object3d: group,
    hideInRect(x0, y0, x1, y1) {
      let n = 0;
      for (const l of lists.values()) {
        l.items.forEach((d, idx) => {
          if (l.hidden[idx] || d.x < x0 || d.x > x1 || d.y < y0 || d.y > y1) return;
          l.hidden[idx] = 1;
          l.mesh.setMatrixAt(idx, ZERO);
          l.mesh.instanceMatrix.addUpdateRange(idx * 16, 16);
          l.mesh.instanceMatrix.needsUpdate = true;
          n++;
        });
      }
      return n;
    },
    dispose() {
      if (group.parent) group.parent.remove(group);
      for (const m of meshes) m.dispose();
    },
  };
}
