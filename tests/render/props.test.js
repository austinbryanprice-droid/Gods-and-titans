// Tests for terrain height lookups (src/render/height.js) and the instanced
// forest / decor props (src/render/models/props.js): bilinear heights, footprint
// ground level, 1–2 trees per forest tile in a few shared instanced meshes,
// felling leaves a stump, decor follows the ground and can be cleared under
// buildings, and dispose detaches everything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Map the browser import map ('three', 'three/addons/…') onto the vendored copy.
const VENDOR = new URL('../../vendor/three/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(`${VENDOR}three.module.js`)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(VENDOR + 'addons/')} + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);

const THREE = await import('three');
const { heightAt, footprintHeight } = await import('../../src/render/height.js');
const { createForest, createDecor, getPropInfo } = await import('../../src/render/models/props.js');
const { TERRAIN } = await import('../../src/config.js');
const { generateMap } = await import('../../src/sim/mapgen.js');

/** Small synthetic map: a forest block, a coastal strip and a sloped height field. */
function synthMap(w = 24, h = 20) {
  const terrain = new Uint8Array(w * h).fill(TERRAIN.GRASS);
  for (let y = 2; y < 8; y++) for (let x = 2; x < 10; x++) terrain[y * w + x] = TERRAIN.FOREST;
  for (let y = 12; y < 16; y++) for (let x = 14; x < 18; x++) terrain[y * w + x] = TERRAIN.FOREST;
  for (let y = 12; y < 20; y++) for (let x = 19; x < 24; x++) terrain[y * w + x] = TERRAIN.WATER;
  const heights = new Float32Array((w + 1) * (h + 1));
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) heights[y * (w + 1) + x] = x * 0.1 + Math.sin(y * 0.5) * 0.3;
  const decor = [
    { x: 12.5, y: 3.5, kind: 'rock', rot: 0.4, scale: 1 },
    { x: 13.2, y: 4.1, kind: 'bush', rot: 1.1, scale: 0.9 },
    { x: 15.7, y: 6.3, kind: 'flowers', rot: 2, scale: 1.1 },
    { x: 4.5, y: 15.5, kind: 'ruin', rot: 0, scale: 1 },
    { x: 6.5, y: 16.5, kind: 'stump', rot: 0, scale: 1 },
    { x: 7.5, y: 17.2, kind: 'grass', rot: 0.2, scale: 1 },
    { x: 8.1, y: 17.9, kind: 'grass', rot: 0.9, scale: 1.2 },
    { x: 9, y: 9, kind: 'unknown_kind', rot: 0, scale: 1 },
  ];
  return { width: w, height: h, terrain, heights, decor, seed: 5 };
}

function instancedOf(obj) {
  const out = [];
  obj.traverse((o) => { if (o.isInstancedMesh) out.push(o); });
  return out;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** World positions of the visible (non-zero-scale) instances of a mesh. */
function visibleInstances(mesh) {
  const out = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, _m);
    const e = _m.elements;
    if (Math.max(Math.abs(e[0]), Math.abs(e[5]), Math.abs(e[10]), Math.abs(e[1]), Math.abs(e[2])) < 1e-6) continue; // hidden (zero scale)
    _m.decompose(_p, _q, _s);
    out.push(_p.clone());
  }
  return out;
}

test('heightAt interpolates the vertex grid bilinearly and clamps outside', () => {
  const map = { width: 2, height: 2, heights: new Float32Array([0, 1, 2, 1, 2, 3, 2, 3, 6]) };
  assert.equal(heightAt(map, 0, 0), 0);
  assert.equal(heightAt(map, 1, 0), 1);
  assert.equal(heightAt(map, 2, 2), 6);
  assert.equal(heightAt(map, 0.5, 0), 0.5);
  assert.equal(heightAt(map, 0.5, 0.5), 1);
  assert.ok(Math.abs(heightAt(map, 1.5, 1.5) - 3.5) < 1e-6);
  assert.equal(heightAt(map, -5, -5), 0, 'clamped to the corner');
  assert.equal(heightAt(map, 9, 9), 6, 'clamped to the far corner');
  assert.equal(heightAt(map, 2, 0.5), 2.5, 'right border');
  assert.equal(heightAt({ width: 4, height: 4 }, 1, 1), 0, 'no heights → flat');
  const m = synthMap();
  for (let i = 0; i < 200; i++) {
    const x = (i * 7.3) % m.width;
    const y = (i * 3.1) % m.height;
    assert.ok(Number.isFinite(heightAt(m, x, y)));
  }
});

test('footprintHeight is the highest vertex under the footprint', () => {
  const map = { width: 2, height: 2, heights: new Float32Array([0, 1, 2, 1, 2, 3, 2, 3, 6]) };
  assert.equal(footprintHeight(map, 0, 0, 1), 2);
  assert.equal(footprintHeight(map, 0, 0, 2), 6);
  assert.equal(footprintHeight(map, 1, 0, 1), 3);
  assert.equal(footprintHeight(map, 5, 5, 3), 6, 'clamped');
  assert.equal(footprintHeight({ width: 3, height: 3 }, 0, 0, 2), 0);
});

test('forest: 1–2 trees per forest tile in a handful of instanced meshes', () => {
  const map = synthMap();
  const forestTiles = map.terrain.reduce((n, t) => n + (t === TERRAIN.FOREST ? 1 : 0), 0);
  const f = createForest(map);
  assert.ok(f.object3d.isObject3D);
  assert.ok(f.count >= forestTiles && f.count <= forestTiles * 2, `${f.count} trees for ${forestTiles} tiles`);
  assert.ok(f.count > forestTiles * 1.2, 'many tiles carry two trees');
  const meshes = instancedOf(f.object3d);
  assert.ok(meshes.length <= 12, `${meshes.length} instanced meshes`);
  let shown = 0;
  for (const m of meshes) if (m.name !== 'forest-stumps') shown += visibleInstances(m).length;
  assert.equal(shown, f.count);
  // every tree stands on a forest tile at terrain height
  for (const m of meshes) {
    if (m.name === 'forest-stumps') continue;
    for (const p of visibleInstances(m)) {
      const tx = Math.floor(p.x);
      const ty = Math.floor(p.z);
      assert.equal(map.terrain[ty * map.width + tx], TERRAIN.FOREST, `tree at ${p.x},${p.z} is on forest`);
      assert.ok(Math.abs(p.y - heightAt(map, p.x, p.z)) < 0.2, 'tree sits on the ground');
    }
  }
  f.dispose();
});

test('forest uses the caller height function and palms near water', () => {
  const map = synthMap();
  const f = createForest(map, () => 5);
  for (const m of instancedOf(f.object3d)) for (const p of visibleInstances(m)) assert.ok(Math.abs(p.y - 5) < 0.2);
  const names = instancedOf(f.object3d).map((m) => m.name).join(' ');
  assert.match(names, /palm/, 'coastal tiles grow palms');
  f.dispose();
});

test('felling hides the tile trees, leaves one stump and is idempotent', () => {
  const map = synthMap();
  const f = createForest(map);
  const stumps = instancedOf(f.object3d).find((m) => m.name === 'forest-stumps');
  const trees = () => instancedOf(f.object3d).filter((m) => m.name !== 'forest-stumps').reduce((n, m) => n + visibleInstances(m).length, 0);
  const before = trees();
  assert.equal(stumps.count, 0);
  assert.equal(f.isStanding(3, 3), true);
  assert.equal(f.fell(3, 3), true);
  assert.equal(f.isStanding(3, 3), false);
  assert.equal(stumps.count, 1, 'one stump');
  const after = trees();
  assert.ok(before - after >= 1 && before - after <= 2, 'the tile trees are gone');
  assert.equal(f.fell(3, 3), false, 'already felled');
  assert.equal(f.fell(0, 0), false, 'not a forest tile');
  assert.equal(f.fell(-1, 99), false, 'outside the map');
  assert.equal(stumps.count, 1);
  const stumpPos = visibleInstances(stumps)[0];
  assert.ok(stumpPos.x >= 3 && stumpPos.x < 4 && stumpPos.z >= 3 && stumpPos.z < 4, 'stump stays on the tile');
  let n = 0;
  for (let y = 2; y < 8; y++) for (let x = 2; x < 10; x++) if (f.fell(x, y)) n++;
  assert.equal(n, 6 * 8 - 1);
  assert.equal(stumps.count, 6 * 8);
  assert.equal(map.terrain[3 * map.width + 3], TERRAIN.FOREST, 'mapData is not modified');
  const scene = new THREE.Group();
  scene.add(f.object3d);
  f.dispose();
  assert.equal(f.object3d.parent, null);
});

test('decor: instanced per kind, on the ground, hideInRect clears building sites', () => {
  const map = synthMap();
  const d = createDecor(map);
  const meshes = instancedOf(d.object3d);
  const total = meshes.reduce((n, m) => n + visibleInstances(m).length, 0);
  assert.equal(total, map.decor.length - 1, 'unknown kinds are skipped');
  assert.ok(meshes.length <= 8);
  for (const m of meshes) {
    for (const p of visibleInstances(m)) assert.ok(Math.abs(p.y - heightAt(map, p.x, p.z)) < 0.1, `${m.name} on the ground`);
  }
  assert.equal(d.hideInRect(12, 3, 14, 5), 2, 'rock and bush under the footprint');
  assert.equal(d.hideInRect(12, 3, 14, 5), 0, 'already hidden');
  const left = instancedOf(d.object3d).reduce((n, m) => n + visibleInstances(m).length, 0);
  assert.equal(left, total - 2);
  d.dispose();
  const empty = createDecor({ width: 4, height: 4, heights: new Float32Array(25) });
  assert.equal(instancedOf(empty.object3d).length, 0);
  assert.equal(empty.hideInRect(0, 0, 4, 4), 0);
  empty.dispose();
});

test('a generated map builds its forest quickly within the instance budget', () => {
  const map = generateMap({ seed: 7, mapSize: 'medium', playerCount: 4 });
  const forestTiles = map.terrain.reduce((n, t) => n + (t === TERRAIN.FOREST ? 1 : 0), 0);
  const t0 = performance.now();
  const f = createForest(map);
  const d = createDecor(map);
  const ms = performance.now() - t0;
  assert.ok(f.count >= forestTiles && f.count <= forestTiles * 2);
  assert.ok(ms < 2000, `built in ${ms.toFixed(0)} ms`);
  const meshes = instancedOf(f.object3d).length + instancedOf(d.object3d).length;
  assert.ok(meshes < 200, `${meshes} instanced meshes`);
  f.dispose();
  d.dispose();
});

test('prop geometries stay low-poly', () => {
  const info = getPropInfo();
  for (const [v, tris] of Object.entries(info.trees)) assert.ok(tris > 10 && tris <= 160, `${v}: ${tris} triangles`);
  assert.ok(Object.keys(info.trees).length >= 3, '3–4 tree variants');
  assert.ok(info.stump <= 100, `stump: ${info.stump} triangles`);
  for (const [k, list] of Object.entries(info.decor)) for (const t of list) assert.ok(t <= 200, `${k}: ${t} triangles`);
});
