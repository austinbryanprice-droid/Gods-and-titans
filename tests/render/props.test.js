// Tests for terrain height lookups (src/render/height.js), the instanced
// forest / decor props (src/render/models/props.js) and the ground cover
// (src/render/models/ground-cover.js): bilinear heights, footprint ground level,
// 1–2 trees per forest tile in a few shared instanced meshes, felling leaves a
// stump, decor follows the ground and can be cleared under buildings, plants
// sway (shadows too) while stone stays still, the shader patches chain in the
// right order, ground cover only grows on suitable land, thins by quality and
// distance and clears under buildings, and dispose detaches everything.
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
const { createGroundCover, getGroundCoverInfo, GROUND_COVER_UNIFORMS } = await import('../../src/render/models/ground-cover.js');
const { patchFowObject } = await import('../../src/render/fog.js');
const { WATER_LEVEL } = await import('../../src/render/terrain.js');
const { TERRAIN } = await import('../../src/config.js');
const { generateMap } = await import('../../src/sim/mapgen.js');

/** Small synthetic map: a forest block, a coastal strip and a sloped height field. */
function synthMap(w = 24, h = 20) {
  const terrain = new Uint8Array(w * h).fill(TERRAIN.GRASS);
  for (let y = 2; y < 8; y++) for (let x = 2; x < 10; x++) terrain[y * w + x] = TERRAIN.FOREST;
  for (let y = 12; y < 16; y++) for (let x = 14; x < 18; x++) terrain[y * w + x] = TERRAIN.FOREST;
  for (let y = 12; y < 20; y++) for (let x = 19; x < 24; x++) terrain[y * w + x] = TERRAIN.WATER;
  for (let y = 0; y < 3; y++) for (let x = 12; x < 16; x++) terrain[y * w + x] = TERRAIN.ROCK;
  for (let y = 9; y < 12; y++) for (let x = 2; x < 8; x++) terrain[y * w + x] = TERRAIN.DIRT;
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

// ------------------------------------------------------------------ wind and materials

test('plants sway (their shadows too), stone and stumps stay still', () => {
  const map = synthMap();
  const f = createForest(map);
  const d = createDecor(map);
  for (const m of instancedOf(f.object3d)) {
    if (m.name === 'forest-stumps') {
      assert.equal(m.customDepthMaterial, undefined, 'stumps do not sway');
      assert.ok(!m.geometry.attributes.aFol, 'stumps carry no wind weights');
      continue;
    }
    assert.ok(m.material.userData.__foliage, `${m.name} uses the foliage material`);
    assert.ok(m.customDepthMaterial && m.customDepthMaterial.isMeshDepthMaterial, `${m.name} casts a swaying shadow`);
    assert.ok(m.castShadow && m.receiveShadow, `${m.name} casts and receives shadows`);
    // wind weights: no bend at the roots, most at the crown; only leaves flutter
    const pos = m.geometry.attributes.position;
    const fol = m.geometry.attributes.aFol;
    let low = Infinity;
    let high = -Infinity;
    let lowBend = 0;
    let highBend = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < low) [low, lowBend] = [pos.getY(i), fol.getY(i)];
      if (pos.getY(i) > high) [high, highBend] = [pos.getY(i), fol.getY(i)];
      if (fol.getX(i) === 0) assert.equal(fol.getZ(i), 0, 'bark does not flutter');
    }
    assert.ok(lowBend < 1e-3 && highBend > 0.02, `${m.name}: bend ${lowBend} at the roots, ${highBend} at the top`);
  }
  for (const m of instancedOf(d.object3d)) {
    const kind = m.name.slice('decor-'.length);
    const sways = kind === 'bush' || kind === 'flowers' || kind === 'grass';
    assert.equal(!!m.material.userData.__foliage, sways, `${m.name} sways: ${sways}`);
    assert.equal(!!m.customDepthMaterial, sways);
    if (!sways) assert.ok(m.material.isMeshStandardMaterial && m.geometry.attributes.aRough, `${m.name} is physically based stone`);
  }
  f.dispose();
  d.dispose();
});

test('shader patches chain: foliage, then world (clouds), then fog of war', () => {
  const map = synthMap();
  const f = createForest(map);
  const d = createDecor(map);
  const cover = createGroundCover(map, null, { quality: 'high' });
  for (const root of [f.object3d, d.object3d, cover.object3d]) patchFowObject(root);
  const mats = new Set();
  for (const root of [f.object3d, d.object3d, cover.object3d]) root.traverse((o) => { if (o.material) mats.add(o.material); });
  assert.ok(mats.size >= 4);
  for (const mat of mats) {
    const key = mat.customProgramCacheKey();
    assert.match(key, /world/, `${mat.name}: cloud shadows`);
    assert.match(key, /fow/, `${mat.name}: fog of war`);
    const lib = mat.isMeshStandardMaterial ? THREE.ShaderLib.standard : THREE.ShaderLib.lambert;
    const shader = { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
    mat.onBeforeCompile(shader, null);
    assert.match(shader.fragmentShader, /cloudShade/, `${mat.name}: cloud patch applied`);
    assert.match(shader.fragmentShader, /fowApply/, `${mat.name}: fog patch applied`);
    assert.match(shader.vertexShader, /vWorldPos = /);
    assert.match(shader.vertexShader, /vFowXZ = /);
    if (mat.isMeshStandardMaterial) {
      assert.match(shader.fragmentShader, /roughnessFactor \*= vRough/, `${mat.name}: roughness per face`);
      continue;
    }
    assert.match(shader.vertexShader, /windOffset\(/, `${mat.name}: wind`);
    assert.ok(shader.uniforms.uTime && shader.uniforms.uWind, `${mat.name}: wind uniforms`);
    // the wind moves `transformed` right after begin_vertex, before everything that reads it
    const vs = shader.vertexShader;
    const call = vs.lastIndexOf('windOffset( ');
    assert.ok(call > vs.indexOf('#include <begin_vertex>') && call < vs.indexOf('#include <project_vertex>'));
    if (mat.userData.__foliage) assert.match(shader.fragmentShader, /uFoliage/, `${mat.name}: soft leaf light`);
  }
  const depth = instancedOf(f.object3d)[0].customDepthMaterial;
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader };
  depth.onBeforeCompile(shader, null);
  assert.match(shader.vertexShader, /windOffset\(/, 'shadows sway with the plants');
  f.dispose();
  d.dispose();
  cover.dispose();
});

// ------------------------------------------------------------------ ground cover

/** Visible (non-zero scale) ground-cover instances: [{ x, y, z, kind }]. */
function coverInstances(cover) {
  const out = [];
  cover.object3d.traverse((o) => {
    if (!o.isMesh) return;
    const a = o.geometry.attributes.aInst;
    for (let i = 0; i < a.count; i++) {
      if (a.getW(i) === 0) continue;
      out.push({ x: a.getX(i), y: a.getY(i), z: a.getZ(i), kind: o.name });
    }
  });
  return out;
}

test('ground cover grows on grass, forest floor and dirt borders, never in water or on rock', () => {
  const map = synthMap();
  const cover = createGroundCover(map, null, { quality: 'ultra' });
  const all = coverInstances(cover);
  assert.ok(all.length > 300, `${all.length} instances`);
  const byTerrain = new Map();
  for (const p of all) {
    const t = map.terrain[Math.floor(p.z) * map.width + Math.floor(p.x)];
    assert.notEqual(t, TERRAIN.WATER, 'no cover in water');
    assert.notEqual(t, TERRAIN.ROCK, 'no cover on rock');
    assert.ok(heightAt(map, p.x, p.z) > WATER_LEVEL, 'above the water line');
    assert.ok(Math.abs(p.y - heightAt(map, p.x, p.z)) < 0.05, 'on the ground');
    byTerrain.set(t, (byTerrain.get(t) || 0) + 1);
  }
  assert.ok(byTerrain.get(TERRAIN.GRASS) > byTerrain.get(TERRAIN.FOREST), 'meadows are the densest');
  assert.ok(byTerrain.get(TERRAIN.DIRT) > 0, 'grassy dirt borders');
  assert.ok(all.some((p) => p.kind === 'ground-cover-accent'), 'flowers, pebbles or mushrooms');
  for (const m of cover.object3d.children) {
    assert.ok(m.geometry.boundingSphere && m.geometry.boundingSphere.radius < 20, 'chunked for culling');
    assert.equal(m.castShadow, false);
  }
  cover.dispose();
});

test('ground cover density follows quality: none on low, more on high and ultra', () => {
  const map = synthMap();
  const counts = {};
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    const cover = createGroundCover(map, null, { quality: q });
    counts[q] = coverInstances(cover).length;
    if (q === 'low') {
      assert.equal(cover.object3d.visible, false);
      assert.equal(cover.object3d.children.length, 0, 'nothing is built on low');
    }
    cover.dispose();
  }
  assert.equal(counts.low, 0);
  assert.ok(counts.medium > 0 && counts.medium < counts.high && counts.high < counts.ultra, JSON.stringify(counts));
  // switching up rebuilds a denser set, switching down only draws less
  const cover = createGroundCover(map, null, { quality: 'low' });
  cover.setQuality('medium');
  assert.equal(coverInstances(cover).length, counts.medium);
  cover.setQuality('ultra');
  const ultra = coverInstances(cover).length;
  assert.equal(ultra, counts.ultra);
  cover.setQuality('medium');
  assert.equal(GROUND_COVER_UNIFORMS.uGcThin.value.w, 0.4);
  assert.equal(coverInstances(cover).length, ultra, 'the set is kept; the shader and draw count thin it');
  cover.dispose();
});

test('ground cover draws fewer instances far from the camera', () => {
  const map = synthMap(48, 48);
  map.terrain.fill(TERRAIN.GRASS);
  const cover = createGroundCover(map, null, { quality: 'high' });
  const mesh = cover.object3d.children.find((m) => m.name === 'ground-cover-grass');
  const n = mesh.geometry.attributes.aInst.count;
  const cam = new THREE.PerspectiveCamera();
  const drawn = (x, y, z) => {
    cam.position.set(x, y, z);
    cam.updateMatrixWorld();
    mesh.onBeforeRender(null, null, cam, mesh.geometry, mesh.material, null);
    return mesh.geometry.instanceCount;
  };
  const near = drawn(8, 10, 8);
  const far = drawn(8, 200, 8);
  assert.ok(near > 0 && near <= n);
  assert.ok(far < near * 0.5, `${far} far vs ${near} near`);
  // instances are sorted by rank (the fractional part), so the drawn prefix is the kept share
  const w = mesh.geometry.attributes.aInst;
  for (let i = 1; i < n; i++) assert.ok(w.getW(i) % 1 >= (w.getW(i - 1) % 1) - 1e-4, 'sorted by rank');
  cover.dispose();
});

test('ground cover clears under buildings and mines', () => {
  const map = synthMap();
  const cover = createGroundCover(map, null, { quality: 'high' });
  const before = coverInstances(cover);
  const inside = (p) => p.x >= 10 && p.x <= 13 && p.z >= 4 && p.z <= 7;
  const n = before.filter(inside).length;
  assert.ok(n > 0);
  assert.equal(cover.hideInRect(10, 4, 13, 7), n);
  assert.equal(cover.hideInRect(10, 4, 13, 7), 0, 'already cleared');
  const after = coverInstances(cover);
  assert.equal(after.length, before.length - n);
  assert.ok(!after.some(inside));
  // a footprint cleared on low stays cleared when the cover is built later
  const late = createGroundCover(map, null, { quality: 'low' });
  assert.equal(late.hideInRect(10, 4, 13, 7), 0);
  late.setQuality('high');
  assert.ok(coverInstances(late).length > 0 && !coverInstances(late).some(inside));
  const scene = new THREE.Group();
  scene.add(cover.object3d);
  cover.dispose();
  late.dispose();
  assert.equal(cover.object3d.parent, null);
  assert.equal(cover.object3d.children.length, 0);
});

test('ground cover on a generated map: quick to build, few meshes, tiny geometry', () => {
  const map = generateMap({ seed: 7, mapSize: 'medium', playerCount: 4 });
  const t0 = performance.now();
  const cover = createGroundCover(map, null, { quality: 'ultra' });
  const ms = performance.now() - t0;
  assert.ok(ms < 2500, `built in ${ms.toFixed(0)} ms`);
  const chunks = Math.ceil(map.width / 16) * Math.ceil(map.height / 16);
  assert.ok(cover.object3d.children.length <= chunks * 2, `${cover.object3d.children.length} meshes for ${chunks} chunks`);
  assert.ok(cover.count() > map.width * map.height, `${cover.count()} instances`);
  cover.dispose();
  const info = getGroundCoverInfo();
  assert.ok(info.tuft <= 16, `tuft: ${info.tuft} triangles`);
  assert.ok(info.accent <= 96, `accent: ${info.accent} triangles`);
});
