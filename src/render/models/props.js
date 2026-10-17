// Instanced nature props: forests and map decor (DESIGN.md 8).
//
//   const forest = createForest(mapData, (x, y) => heightAt(mapData, x, y));
//   scene.add(forest.object3d);
//   forest.fell(tx, ty);        // hide that tile's trees, leave a stump (on 'treeFelled' events)
//   const decor = createDecor(mapData, heightFn);
//   scene.add(decor.object3d);
//   decor.hideInRect(x0, y0, x1, y1); // e.g. under a newly placed building footprint
//   forest.dispose(); decor.dispose();  // shared geometry and material stay cached
//
// Trees: 4 variants (pine, broadleaf, birch, palm near sand/water) picked by a
// tile hash and low-frequency noise, 1–2 per forest tile with random rotation,
// scale and color so forests read as solid walls. One InstancedMesh per variant
// per 32×32-tile chunk keeps draw calls low while letting off-screen chunks cull.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TERRAIN } from '../../config.js';
import { RNG, hashSeed } from '../../sim/rng.js';
import { heightAt } from '../height.js';

const CHUNK = 32;
const PI = Math.PI;
const VARIANTS = ['pine', 'broadleaf', 'birch', 'palm'];
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

// ---------------------------------------------------------------------------
// geometry helpers (non-indexed, vertex colors with per-face jitter)
// ---------------------------------------------------------------------------

function prep(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const key of Object.keys(n.attributes)) if (key !== 'position') n.deleteAttribute(key);
  n.morphAttributes = {};
  n.clearGroups();
  return n;
}

function paint(g, color, jit, rng) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (rng.next() * 2 - 1) * jit;
    for (let v = i; v < i + 3 && v < n; v++) {
      col[v * 3] = c.r * k;
      col[v * 3 + 1] = c.g * k;
      col[v * 3 + 2] = c.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
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

const cyl = (rt, rb, h, seg, open = true) => prep(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)).translate(0, h / 2, 0);
const cone = (r, h, seg) => prep(new THREE.ConeGeometry(r, h, seg, 1, true)).translate(0, h / 2, 0);
const ico = (r) => prep(new THREE.IcosahedronGeometry(r, 0));
const dodeca = (r) => prep(new THREE.DodecahedronGeometry(r, 0));
const octa = (r) => prep(new THREE.OctahedronGeometry(r, 0));

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

function finish(parts) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// tree and decor geometry (built once, shared)
// ---------------------------------------------------------------------------

function pineGeo() {
  const r = new RNG(11);
  const parts = [paint(cyl(0.05, 0.09, 0.55, 5), '#5a3e28', 0.08, r)];
  const tiers = [[0.62, 0.85, 0.32, '#2f5a32'], [0.5, 0.75, 0.75, '#356537'], [0.36, 0.65, 1.15, '#3b6f3c']];
  for (const [rad, h, y, col] of tiers) {
    const g = cone(rad, h, 7);
    g.rotateY(r.next() * PI);
    wobble(g, 0.07, r);
    parts.push(paint(g.translate(0, y, 0), col, 0.12, r));
  }
  return finish(parts);
}

function broadleafGeo() {
  const r = new RNG(12);
  const parts = [paint(cyl(0.06, 0.1, 0.62, 5), '#5e4129', 0.08, r)];
  const blobs = [[0.52, 0, 0.98, 0, '#4f8a38'], [0.36, 0.26, 0.82, 0.14, '#5a9640'], [0.34, -0.24, 0.86, -0.16, '#47803a'], [0.3, 0.02, 1.28, -0.05, '#62a046']];
  for (const [rad, x, y, z, col] of blobs) {
    const g = ico(rad);
    g.scale(1, 0.82, 1);
    wobble(g, 0.1, r);
    parts.push(paint(g.translate(x, y, z), col, 0.12, r));
  }
  return finish(parts);
}

function birchGeo() {
  const r = new RNG(13);
  const trunk = cyl(0.035, 0.055, 1.05, 5);
  const parts = [paint(trunk, '#e6e2d6', 0.18, r)];
  const marks = [0.25, 0.5, 0.78];
  for (const y of marks) parts.push(paint(cyl(0.05, 0.052, 0.04, 5).translate(0, y, 0), '#3a332c', 0.05, r));
  const blobs = [[0.32, 0, 1.12, 0, '#9cbf4a'], [0.26, 0.12, 0.88, 0.1, '#8fb444'], [0.22, -0.1, 1.38, -0.04, '#a8c955']];
  for (const [rad, x, y, z, col] of blobs) {
    const g = ico(rad);
    g.scale(0.9, 1.35, 0.9);
    wobble(g, 0.07, r);
    parts.push(paint(g.translate(x, y, z), col, 0.12, r));
  }
  return finish(parts);
}

function palmGeo() {
  const r = new RNG(14);
  const parts = [];
  // curved trunk in three leaning segments
  let px = 0;
  let py = 0;
  const segs = [[0.08, 0.07, 0.55, 0.05], [0.07, 0.06, 0.55, 0.14], [0.06, 0.05, 0.5, 0.24]];
  for (const [rb, rt, h, lean] of segs) {
    const g = cyl(rt, rb, h, 5);
    g.rotateZ(-lean);
    g.translate(px, py, 0);
    parts.push(paint(g, '#8a6a44', 0.12, r));
    px += Math.sin(lean) * h;
    py += Math.cos(lean) * h * 0.98;
  }
  const top = [px, py, 0];
  // fronds: drooping two-segment leaves (both faces)
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * PI * 2 + r.next() * 0.3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const len = 0.62 + r.next() * 0.15;
    const w = 0.13;
    const mid = [top[0] + ca * len * 0.5, top[1] + 0.12, top[2] + sa * len * 0.5];
    const tip = [top[0] + ca * len, top[1] - 0.2, top[2] + sa * len];
    const side = (p, k) => [p[0] - sa * w * k, p[1], p[2] + ca * w * k];
    const tris = [
      [top, side(mid, 1), mid], [top, mid, side(mid, -1)],
      [mid, side(mid, 1), tip], [mid, tip, side(mid, -1)],
    ];
    const both = tris.flatMap((t) => [t, [t[0], t[2], t[1]]]);
    parts.push(paint(triGeo(both), i % 2 ? '#4f9a3a' : '#5aa842', 0.1, r));
  }
  const nut = octa(0.07);
  parts.push(paint(nut.translate(top[0], top[1] - 0.06, top[2]), '#6a4a2a', 0.1, r));
  const g = finish(parts);
  g.translate(-px * 0.4, 0, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function stumpGeo() {
  const r = new RNG(15);
  const parts = [paint(cyl(0.11, 0.14, 0.14, 7, false), '#6a4a30', 0.1, r)];
  parts.push(paint(cyl(0.1, 0.1, 0.01, 7, false).translate(0, 0.14, 0), '#c49a68', 0.06, r));
  for (let i = 0; i < 3; i++) {
    const g = cyl(0.025, 0.04, 0.16, 4);
    g.rotateZ(PI / 2 - 0.35);
    g.rotateY((i / 3) * PI * 2 + 0.4);
    parts.push(paint(g.translate(0, 0.02, 0), '#5a3e28', 0.08, r));
  }
  return finish(parts);
}

function rockGeo(variant) {
  const r = new RNG(20 + variant);
  const parts = [];
  const list = variant === 0 ? [[0.24, 0, 0, 0.7, '#8a8378']] : [[0.18, -0.08, 0.02, 0.8, '#7e776d'], [0.13, 0.14, -0.06, 0.9, '#948c80'], [0.08, 0.05, 0.16, 1, '#8a8378']];
  for (const [rad, x, z, sy, col] of list) {
    const g = dodeca(rad);
    wobble(g, rad * 0.35, r);
    g.scale(1, sy, 1);
    parts.push(paint(g.translate(x, rad * sy * 0.55, z), col, 0.12, r));
  }
  return finish(parts);
}

function bushGeo() {
  const r = new RNG(30);
  const parts = [];
  for (const [rad, x, y, z, col] of [[0.18, 0, 0.13, 0, '#3f7330'], [0.14, 0.15, 0.1, 0.06, '#4a8236'], [0.13, -0.13, 0.1, -0.05, '#386a2c'], [0.1, 0.02, 0.24, -0.03, '#558f3c']]) {
    const g = ico(rad);
    wobble(g, rad * 0.3, r);
    parts.push(paint(g.translate(x, y, z), col, 0.12, r));
  }
  return finish(parts);
}

function flowersGeo(variant) {
  const r = new RNG(40 + variant);
  const parts = [];
  const leaf = octa(0.13);
  leaf.scale(1.2, 0.25, 1.2);
  parts.push(paint(leaf.translate(0, 0.02, 0), '#4f8a36', 0.12, r));
  const colors = variant === 0 ? ['#e8463a', '#f2c63a', '#f6f0e6', '#e8463a', '#f2c63a', '#ff8a3a'] : ['#9a5ad8', '#f6f0e6', '#4a8ae8', '#e86ab0', '#9a5ad8', '#f6f0e6'];
  for (let i = 0; i < colors.length; i++) {
    const a = (i / colors.length) * PI * 2 + r.next() * 0.6;
    const d = 0.05 + r.next() * 0.1;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const h = 0.1 + r.next() * 0.08;
    parts.push(paint(triGeo([[[x - 0.008, 0, z], [x + 0.008, 0, z], [x, h, z]], [[x + 0.008, 0, z], [x - 0.008, 0, z], [x, h, z]]]), '#3f7a2c', 0.05, r));
    const head = octa(0.032);
    head.scale(1, 0.6, 1);
    parts.push(paint(head.translate(x, h, z), colors[i], 0.05, r));
  }
  return finish(parts);
}

function grassGeo() {
  const r = new RNG(50);
  const tris = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2 + r.next() * 0.5;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const h = 0.16 + r.next() * 0.12;
    const lean = 0.06 + r.next() * 0.06;
    const w = 0.025;
    const b0 = [-sa * w + ca * 0.02, 0, ca * w + sa * 0.02];
    const b1 = [sa * w + ca * 0.02, 0, -ca * w + sa * 0.02];
    const tip = [ca * lean, h, sa * lean];
    tris.push([b0, b1, tip], [b1, b0, tip]);
  }
  const g = triGeo(tris);
  paint(g, '#5f9a3e', 0.18, r);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function ruinGeo(variant) {
  const r = new RNG(60 + variant);
  const parts = [];
  const stone = '#c9c2b2';
  if (variant === 0) {
    parts.push(paint(prep(new THREE.BoxGeometry(0.34, 0.08, 0.34)).translate(0, 0.04, 0), '#b2ab9c', 0.06, r));
    const shaft = cyl(0.09, 0.105, 0.55, 7, false);
    const p = shaft.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.5) p.setY(i, p.getY(i) - 0.18 * (0.5 + 0.5 * Math.sin(p.getX(i) * 20 + p.getZ(i) * 13)));
    parts.push(paint(shaft.translate(0, 0.08, 0), stone, 0.08, r));
    const drum = cyl(0.095, 0.095, 0.22, 7, false);
    drum.rotateZ(PI / 2);
    drum.rotateY(0.6);
    parts.push(paint(drum.translate(0.25, 0.09, 0.12), stone, 0.08, r));
    parts.push(paint(dodeca(0.06).translate(-0.18, 0.04, 0.16), '#a9a292', 0.1, r));
  } else {
    const blocks = [[0, 0.07, 0, 0.5, 0.14, 0.16], [0.05, 0.21, 0, 0.36, 0.14, 0.15], [-0.1, 0.35, 0.01, 0.18, 0.12, 0.14], [0.28, 0.06, 0.2, 0.18, 0.12, 0.16]];
    for (const [x, y, z, w, h, d] of blocks) {
      const g = prep(new THREE.BoxGeometry(w, h, d));
      g.rotateY((r.next() - 0.5) * 0.4);
      parts.push(paint(g.translate(x, y, z), r.next() > 0.5 ? stone : '#b6af9f', 0.08, r));
    }
  }
  return finish(parts);
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.name = 'props';
  SHARED = {
    mat,
    trees: { pine: pineGeo(), broadleaf: broadleafGeo(), birch: birchGeo(), palm: palmGeo() },
    stump: stumpGeo(),
    decor: {
      rock: [rockGeo(0), rockGeo(1)],
      bush: [bushGeo()],
      flowers: [flowersGeo(0), flowersGeo(1)],
      ruin: [ruinGeo(0), ruinGeo(1)],
      stump: null,
      grass: [grassGeo()],
    },
  };
  SHARED.decor.stump = [SHARED.stump];
  return SHARED;
}

/** Triangle counts of the shared prop geometries (for tests and budgets). */
export function getPropInfo() {
  const s = shared();
  const tri = (g) => g.attributes.position.count / 3;
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
  const ch = Math.ceil(H / CHUNK);
  const buckets = new Map(); // `${chunk}|${variant}` → { variant, list: [{ tile, x, y, h, rot, sx, sy, tilt, tint }] }
  const trees = [];
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const i = ty * W + tx;
      if (T[i] !== FOREST) continue;
      const h0 = ihash(tx, ty, seed);
      const count = h0 < 0.55 ? 2 : 1;
      let variant;
      const pick = ihash(tx, ty, seed + 1);
      if (coast[i]) variant = pick < 0.72 ? 'palm' : 'broadleaf';
      else {
        const n = valueNoise(tx / 9, ty / 9, seed + 7) * 0.8 + valueNoise(tx / 3.5, ty / 3.5, seed + 9) * 0.2;
        if (n < 0.42) variant = pick < 0.82 ? 'pine' : 'birch';
        else if (n < 0.62) variant = pick < 0.38 ? 'pine' : pick < 0.8 ? 'broadleaf' : 'birch';
        else variant = pick < 0.68 ? 'broadleaf' : pick < 0.9 ? 'birch' : 'pine';
      }
      const chunk = Math.floor(ty / CHUNK) * cw + Math.floor(tx / CHUNK);
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
        const tree = { tile: i, x, y, h: hf(x, y) - 0.04, rot: r1 * PI * 2, sx: s, sy: s * (0.92 + r2 * 0.2), tilt: (r2 - 0.5) * 0.12, tint: r3, bucket: b, index: b.list.length };
        b.list.push(tree);
        trees.push(tree);
      }
    }
  }

  const meshes = [];
  for (const b of buckets.values()) {
    const mesh = new THREE.InstancedMesh(S.trees[b.variant], S.mat, b.list.length);
    mesh.name = `forest-${b.variant}`;
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    b.list.forEach((t, idx) => {
      _e.set(t.tilt, t.rot, t.tilt * 0.6);
      _q.setFromEuler(_e);
      _p.set(t.x, t.h, t.y);
      _s.set(t.sx, t.sy, t.sx);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(idx, _m);
      const k = 0.84 + t.tint * 0.3;
      const warm = (t.tint - 0.5) * 0.12;
      _c.setRGB(k * (1 + warm), k, k * (1 - warm * 0.5));
      mesh.setColorAt(idx, _c);
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
  const stumps = new THREE.InstancedMesh(S.stump, S.mat, Math.max(1, byTile.size));
  stumps.name = 'forest-stumps';
  stumps.count = 0;
  stumps.frustumCulled = false;
  stumps.castShadow = false;
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
    const mesh = new THREE.InstancedMesh(l.geo, S.mat, l.items.length);
    mesh.name = `decor-${l.kind}`;
    mesh.castShadow = l.kind === 'rock' || l.kind === 'ruin' || l.kind === 'bush';
    mesh.receiveShadow = true;
    const jit = DECOR_JITTER[l.kind] ?? 0.1;
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
      _c.setRGB(k, k * (1 + (r - 0.5) * 0.05), k);
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
