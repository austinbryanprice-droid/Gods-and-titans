// Tests for the game renderer's building blocks (src/render/camera.js, fog.js,
// terrain.js, overlays.js, placement.js): camera controls and limits, fog of
// war levels / easing / shader patching, terrain geometry heights and winding,
// and the instanced overlay layers' bookkeeping. Pure math and three.js
// objects, no WebGL.
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
const { CameraController, CAMERA_DEFAULTS } = await import('../../src/render/camera.js');
const { FogOfWar, FOW_UNIFORMS, FOW_VISIBLE, FOW_EXPLORED, FOW_UNEXPLORED, FOW_FADE_SECONDS, patchFowMaterial, patchFowObject } = await import('../../src/render/fog.js');
const { buildTerrainGeometry, buildTerrainLodIndex, tileLayers, createTerrain, WATER_LEVEL } = await import('../../src/render/terrain.js');
const { groundField, FIELD_RES } = await import('../../src/render/ground-field.js');
const { LAYER, LAYER_COUNT, GROUND_SIZE, terrainTextureData } = await import('../../src/render/terrain-textures.js');
const { RingLayer, BlobLayer, StarLayer, BarLayer, MarkerLayer, FloatingTextLayer, RallyFlags, OrderPaths, healthColor } = await import('../../src/render/overlays.js');
const { PlacementLayer } = await import('../../src/render/placement.js');
const { NoBuildZone, zoneMask } = await import('../../src/render/no-build-zone.js');
const { peaceBlocksFootprint } = await import('../../src/sim/peace.js');
const { FireLayer, fireCount } = await import('../../src/render/fires.js');
const { heightAt } = await import('../../src/render/height.js');
const { TERRAIN, PEACE_BUILD_GAP } = await import('../../src/config.js');

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function hillyMap(W = 24, H = 20) {
  const heights = new Float32Array((W + 1) * (H + 1));
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) heights[y * (W + 1) + x] = Math.sin(x * 0.7) * 0.5 + Math.cos(y * 0.45) * 0.4 - (x > 15 && y > 12 ? 0.8 : 0);
  const terrain = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) terrain[i] = [TERRAIN.GRASS, TERRAIN.DIRT, TERRAIN.FOREST, TERRAIN.SAND, TERRAIN.ROCK][i % 5];
  for (let y = 13; y < H; y++) for (let x = 16; x < W; x++) terrain[y * W + x] = TERRAIN.WATER;
  return { width: W, height: H, heights, terrain, seed: 9, decor: [], mines: [], starts: [] };
}

// ------------------------------------------------------------------ camera

function makeCamera(opts = {}) {
  const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 400);
  const c = new CameraController(cam, { mapWidth: 96, mapHeight: 96, heightFn: () => 0, ...opts });
  c.setViewport(1600, 900);
  return c;
}

test('camera: looks north and down from the south of its target', () => {
  const c = makeCamera();
  c.centerOn(40, 50);
  const p = c.camera.position;
  assert.ok(p.z > 50, 'camera sits south of the target');
  assert.ok(p.y > 10, 'camera is above the ground');
  assert.ok(close(p.x, 40));
  const pitch = Math.atan2(p.y, p.z - 50) * (180 / Math.PI);
  assert.ok(pitch > 45 && pitch < 62, `pitch ${pitch}`);
  const fwd = new THREE.Vector3();
  c.camera.getWorldDirection(fwd);
  assert.ok(fwd.z < 0 && fwd.y < 0, 'looks north (−z) and down');
  // the screen center ray hits the target
  const ray = c.rayFromNdc(0, 0);
  const t = -ray.origin.y / ray.dir.y;
  assert.ok(close(ray.origin.x + ray.dir.x * t, 40, 1e-3));
  assert.ok(close(ray.origin.z + ray.dir.z * t, 50, 1e-3));
});

test('camera: pan moves exactly, scroll scales with zoom, the view eases and clamps to the map', () => {
  const c = makeCamera();
  c.centerOn(40, 40);
  c.pan(3, -2);
  assert.deepEqual([c.goal.x, c.goal.y], [43, 38]);
  assert.deepEqual([c.target.x, c.target.y], [40, 40], 'pan is eased, not instant');
  for (let i = 0; i < 120; i++) c.update(1 / 60);
  assert.ok(close(c.target.x, 43, 1e-3) && close(c.target.y, 38, 1e-3));
  // scroll: same tiles at default zoom, more when zoomed out
  c.setDistance(CAMERA_DEFAULTS.defaultDistance, true);
  c.scroll(1, 0);
  assert.ok(close(c.goal.x, 44));
  c.setDistance(CAMERA_DEFAULTS.defaultDistance * 1.5, true);
  c.scroll(1, 0);
  assert.ok(close(c.goal.x, 45.5));
  // clamps
  c.centerOn(-50, 500);
  assert.equal(c.target.x, CAMERA_DEFAULTS.edgeMargin);
  assert.equal(c.target.y, 96 - CAMERA_DEFAULTS.edgeMargin);
  c.pan(Number.NaN, 2);
  assert.equal(c.goal.x, CAMERA_DEFAULTS.edgeMargin, 'non-finite pans are ignored');
});

test('camera: zoomBy (+ = closer) eases between the limits and steepens the pitch when far', () => {
  const c = makeCamera();
  const d0 = c.goalDistance;
  c.zoomBy(1);
  assert.ok(c.goalDistance < d0, 'positive steps zoom in');
  c.zoomBy(-2);
  assert.ok(c.goalDistance > d0, 'negative steps zoom out');
  c.zoomBy(100);
  assert.equal(c.goalDistance, CAMERA_DEFAULTS.minDistance);
  for (let i = 0; i < 200; i++) c.update(1 / 60);
  assert.ok(close(c.distance, CAMERA_DEFAULTS.minDistance, 1e-3));
  const near = c.pitch;
  c.zoomBy(-100);
  assert.equal(c.goalDistance, CAMERA_DEFAULTS.maxDistance);
  for (let i = 0; i < 200; i++) c.update(1 / 60);
  assert.ok(c.pitch > near);
});

test('camera: the far limit holds a whole medium map; the pitch rises smoothly to it', () => {
  assert.equal(CAMERA_DEFAULTS.maxDistance, 170);
  const c = makeCamera({ mapWidth: 128, mapHeight: 128 });
  const deg = (d) => {
    c.setDistance(d, true);
    return (c.pitch * 180) / Math.PI;
  };
  const { minDistance: lo, midDistance: mid, maxDistance: hi } = CAMERA_DEFAULTS;
  assert.ok(close(deg(lo), CAMERA_DEFAULTS.pitchNear, 1e-9));
  assert.ok(close(deg(mid), CAMERA_DEFAULTS.pitchMid, 1e-9), 'the old zoom range ends on the old pitch');
  assert.ok(close(deg(hi), CAMERA_DEFAULTS.pitchFar, 1e-9));
  assert.ok(CAMERA_DEFAULTS.pitchFar < 70, 'the view stays under the vertical');
  // it rises all the way, easing out past the old limit (no kink where the old range ended, the slope only falls)
  const slope = (a, b) => (deg(b) - deg(a)) / (b - a);
  let prev = -Infinity;
  for (let d = lo; d <= hi; d += 1) {
    const p = deg(d);
    assert.ok(p >= prev - 1e-9, `pitch falls at ${d}`);
    prev = p;
  }
  assert.ok(Math.abs(slope(mid - 1, mid) - slope(mid, mid + 1)) < 0.03, 'no kink at the old limit');
  assert.ok(slope(mid + 60, mid + 61) < slope(mid, mid + 1), 'the pitch eases out toward the far limit');
  // the view at the far limit spans the map in a 16:9 window (the quad's ground band is longer than the map is deep)
  c.setViewport(1600, 900);
  c.centerOn(64, 64);
  c.setDistance(hi, true);
  c.update(0);
  const [tl, tr, br, bl] = c.getViewQuad();
  assert.ok(bl.y - tl.y > 128, `ground band ${bl.y - tl.y}`);
  assert.ok(br.x - bl.x > 128, `bottom edge ${br.x - bl.x}`);
  assert.ok(tr.x - tl.x > br.x - bl.x);
});

test('camera: the clip planes follow the zoom and always hold the ground in view, at any window shape', () => {
  const c = makeCamera({ mapWidth: 128, mapHeight: 128 });
  const cam = c.camera;
  assert.equal(cam.near, 0.5, 'the original planes up close');
  assert.equal(cam.far, 400);
  const dist = (p, g) => Math.hypot(p.x - g.x, p.y - g.y, p.z - g.z);
  const g = new THREE.Vector3();
  for (const [w, h] of [[1600, 900], [1280, 1024], [3440, 1440], [5120, 1440]]) {
    c.setViewport(w, h);
    let lastNear = 0;
    for (let d = CAMERA_DEFAULTS.minDistance; d <= CAMERA_DEFAULTS.maxDistance; d += 4) {
      c.setDistance(d, true);
      c.centerOn(64, 64);
      c.update(0);
      assert.ok(cam.near >= 0.5 && cam.near <= 6 && cam.near < d * 0.5, `near ${cam.near} at ${d}`);
      assert.ok(cam.near >= lastNear - 1e-9, 'the near plane only moves out');
      lastNear = cam.near;
      assert.ok(cam.far >= 400 && cam.far >= d * 3, `far ${cam.far} at ${d}`);
      const nearest = Math.min(...c.getViewQuad().map((q) => dist(cam.position, g.set(q.x, c.groundY, q.y))));
      const farthest = Math.max(...c.getViewQuad().map((q) => dist(cam.position, g.set(q.x, c.groundY, q.y))));
      assert.ok(farthest < cam.far * 0.9, `the ground ${farthest.toFixed(0)} away passes the far plane ${cam.far.toFixed(0)} at ${d} in ${w}x${h}`);
      assert.ok(nearest > cam.near * 3, `the near ground ${nearest.toFixed(1)} is cut by the near plane ${cam.near.toFixed(2)}`);
      for (const q of c.getViewQuad()) assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y));
    }
  }
  // zooming back restores the original planes
  c.setDistance(CAMERA_DEFAULTS.defaultDistance, true);
  c.update(0);
  assert.equal(cam.near, 0.5);
  assert.equal(cam.far, 400);
  // the projection matches the planes
  assert.ok(close(cam.projectionMatrix.elements[10], -(cam.far + cam.near) / (cam.far - cam.near), 1e-9));
});

test('camera: panPixels drags the ground under the cursor, getViewQuad gives TL, TR, BR, BL', () => {
  const c = makeCamera();
  c.centerOn(48, 48);
  c.update(0);
  const g0 = { x: c.target.x, y: c.target.y };
  c.panPixels(-100, 0); // drag left: the view moves east
  assert.ok(c.target.x > g0.x);
  assert.ok(close(c.target.y, g0.y));
  c.centerOn(48, 48);
  c.update(0);
  const q = c.getViewQuad();
  assert.equal(q.length, 4);
  const [tl, tr, br, bl] = q;
  assert.ok(tl.x < tr.x && bl.x < br.x, 'left corners are west of right ones');
  assert.ok(tl.y < bl.y && tr.y < br.y, 'top corners are north of bottom ones');
  assert.ok(tr.x - tl.x > br.x - bl.x, 'the far edge is wider (perspective)');
  assert.ok(tl.y < 48 && bl.y > 48 && tl.x < 48 && tr.x > 48, 'the quad contains the target');
  for (const p of q) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

// ------------------------------------------------------------------ fog of war

function fogGrid(W, H, fill) {
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = fill(x, y) ? 1 : 0;
  return a;
}

test('fog: visible, explored and unexplored levels; the first goal snaps, later ones ease linearly', () => {
  const W = 32;
  const H = 24;
  const fow = new FogOfWar(W, H);
  const at = (x, y) => fow.sample(x, y) * 255; // sample() is 0..1
  const vis = fogGrid(W, H, (x) => x < 8);
  const exp = fogGrid(W, H, (x) => x < 20);
  fow.setGoal(vis, exp, false);
  fow.update(0);
  assert.ok(at(3.5, 10.5) >= 200, 'visible');
  assert.ok(Math.abs(at(14.5, 10.5) - FOW_EXPLORED) <= 2, 'explored');
  assert.ok(Math.abs(at(28.5, 10.5) - FOW_UNEXPLORED) <= 2, 'unexplored');
  assert.ok(FOW_VISIBLE > FOW_EXPLORED && FOW_EXPLORED > FOW_UNEXPLORED);
  // the uniforms point at this fog's texture
  assert.equal(FOW_UNIFORMS.uFowTex.value, fow.texture);
  assert.equal(FOW_UNIFORMS.uFowSize.value.x, W);
  // vision moves east: eases over FOW_FADE_SECONDS
  fow.setGoal(fogGrid(W, H, (x) => x >= 10 && x < 18), exp, false);
  fow.update(FOW_FADE_SECONDS / 4); // a full 0→255 swing takes FOW_FADE_SECONDS
  const mid = at(14.5, 10.5);
  assert.ok(mid > FOW_EXPLORED + 20 && mid < 240, `part-way ${mid}`);
  fow.update(FOW_FADE_SECONDS);
  assert.ok(at(14.5, 10.5) >= 200);
  assert.ok(Math.abs(at(3.5, 10.5) - FOW_EXPLORED) <= 2, 'left vision is now explored');
  // reveal all
  fow.setGoal(vis, exp, true);
  fow.update(1);
  assert.equal(at(28.5, 10.5), 255);
  assert.equal(fow.sample(-1, 3), 0, 'off the map is dark');
  fow.dispose();
  assert.notEqual(FOW_UNIFORMS.uFowTex.value, fow.texture, 'dispose resets the shared uniform');
});

test('fog: patchFowMaterial chains onBeforeCompile, keys the program and is idempotent', () => {
  const mat = new THREE.MeshLambertMaterial();
  let prevCalls = 0;
  mat.onBeforeCompile = () => prevCalls++;
  mat.customProgramCacheKey = () => 'prev-key';
  patchFowMaterial(mat);
  const once = mat.onBeforeCompile;
  patchFowMaterial(mat);
  assert.equal(mat.onBeforeCompile, once, 'second patch is a no-op');
  assert.match(mat.customProgramCacheKey(), /prev-key/);
  assert.match(mat.customProgramCacheKey(), /fow/);
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.lambert.vertexShader,
    fragmentShader: THREE.ShaderLib.lambert.fragmentShader,
  };
  mat.onBeforeCompile(shader, null);
  assert.equal(prevCalls, 1, 'the previous hook still runs');
  // every shared uniform is bound (an unbound uFowPow reads 0 in GLSL: pow(f, 0) = 1, no fog at all)
  for (const k of Object.keys(FOW_UNIFORMS)) assert.equal(shader.uniforms[k], FOW_UNIFORMS[k], k);
  assert.match(shader.vertexShader, /vFowXZ|vFow/);
  assert.match(shader.fragmentShader, /fowFactor/);
  assert.match(shader.fragmentShader, /fowApply\(/);
  // custom shader materials get the same uniforms
  const custom = new THREE.ShaderMaterial({ vertexShader: 'void main() { gl_Position = vec4( position, 1.0 ); }', fragmentShader: 'void main() { gl_FragColor = vec4( 1.0 ); }' });
  patchFowMaterial(custom);
  const cs = { uniforms: {}, vertexShader: custom.vertexShader, fragmentShader: custom.fragmentShader };
  custom.onBeforeCompile(cs, null);
  for (const k of Object.keys(FOW_UNIFORMS)) assert.equal(cs.uniforms[k], FOW_UNIFORMS[k], `custom ${k}`);
  assert.match(cs.fragmentShader, /pow\( fowFactor\( vFowXZ \), uFowPow \)/);
  // objects: every mesh material gets patched
  const g = new THREE.Group();
  const m1 = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const m2 = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshLambertMaterial(), new THREE.MeshLambertMaterial()]);
  g.add(m1, m2);
  patchFowObject(g);
  assert.ok(m1.material.userData.__fow && m2.material.every((m) => m.userData.__fow));
});

// ------------------------------------------------------------------ terrain

test('terrain: one vertex per field sample on heightAt, faces point up, chunks tile the index', () => {
  const map = hillyMap();
  const field = groundField(map);
  const geo = buildTerrainGeometry(map, field);
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const W = map.width;
  const H = map.height;
  const R = FIELD_RES;
  assert.equal(pos.count, (W * R + 1) * (H * R + 1));
  assert.equal(geo.index.count, W * H * R * R * 6);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    assert.ok(close(pos.getY(i), heightAt(map, x, z), 1e-5), `vertex ${i} at ${x},${z}`);
    // smooth shading: unit normals, tilted from the field's slope, never pointing down
    const len = Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i));
    assert.ok(close(len, 1, 1e-4) && nor.getY(i) > 0, `normal ${i}`);
  }
  // counter-clockwise from above: every face normal points up
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const idx = geo.index.array;
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(pos, idx[t]);
    b.fromBufferAttribute(pos, idx[t + 1]);
    c.fromBufferAttribute(pos, idx[t + 2]);
    const n = b.sub(a).cross(c.sub(a));
    assert.ok(n.y > 0, `triangle ${t / 3} faces down`);
  }
  // chunks: consecutive slices of the index that cover the map once, each with a box around its ground
  const chunks = geo.userData.chunks;
  let next = 0;
  let tiles = 0;
  for (const ch of chunks) {
    assert.equal(ch.start, next, 'chunks follow each other');
    next += ch.count;
    tiles += ch.count / (R * R * 6);
    for (let t = ch.start; t < ch.start + ch.count; t++) {
      const v = idx[t];
      assert.ok(ch.box.containsPoint(a.set(pos.getX(v), pos.getY(v), pos.getZ(v))), 'chunk box holds its vertices');
    }
  }
  assert.equal(next, idx.length);
  assert.equal(tiles, W * H);
  geo.dispose();
});

test('terrain: the coarser indices cover the same ground with every 2nd or 4th sample, chunk by chunk', () => {
  const map = hillyMap(40, 36); // chunks of 16 tiles: 40 x 36 leaves partial ones at the east and south edges
  const field = groundField(map);
  const geo = buildTerrainGeometry(map, field);
  const pos = geo.attributes.position;
  const chunks = geo.userData.chunks;
  assert.equal(chunks.length, 3 * 3);
  const area = (idx, k0 = 0, k1 = idx.length) => {
    let total = 0;
    let down = 0;
    for (let k = k0; k < k1; k += 3) {
      const ax = pos.getX(idx[k]);
      const az = pos.getZ(idx[k]);
      const cross = (pos.getX(idx[k + 1]) - ax) * (pos.getZ(idx[k + 2]) - az) - (pos.getX(idx[k + 2]) - ax) * (pos.getZ(idx[k + 1]) - az);
      // x east, z south: counter-clockwise seen from above is a negative cross product here
      if (cross >= 0) down++;
      total += Math.abs(cross) / 2;
    }
    return { total, down };
  };
  for (const stride of [2, 4]) {
    const lists = buildTerrainLodIndex(map, field, stride);
    assert.equal(lists.length, chunks.length);
    let tiles = 0;
    lists.forEach((idx, k) => {
      const c = chunks[k];
      const w = Math.min(map.width, c.cx + 16) - c.cx;
      const h = Math.min(map.height, c.cy + 16) - c.cy;
      assert.equal(idx.length, ((w * FIELD_RES) / stride) * ((h * FIELD_RES) / stride) * 6, `chunk ${k} at step ${stride}`);
      assert.equal(idx.length * stride * stride, c.count, 'a fraction of the full index');
      const a = area(idx);
      assert.ok(close(a.total, w * h, 1e-6), `chunk ${k} covers ${a.total} of ${w * h} tiles`);
      assert.equal(a.down, 0, `chunk ${k}: every face looks up`);
      for (let i = 0; i < idx.length; i++) {
        assert.ok(idx[i] < pos.count);
        assert.equal((idx[i] % field.nx) % stride, 0, 'only every step-th column');
        assert.equal(Math.floor(idx[i] / field.nx) % stride, 0, 'only every step-th row');
      }
      tiles += w * h;
    });
    assert.equal(tiles, map.width * map.height, 'the chunks tile the map');
  }
  // the full index is the same kind of cover (the first chunk, for comparison)
  const full = area(geo.index.array, chunks[0].start, chunks[0].start + chunks[0].count);
  assert.ok(close(full.total, 256, 1e-6) && full.down === 0);
  assert.throws(() => buildTerrainLodIndex(map, field, 3), /does not divide/);
  assert.throws(() => buildTerrainLodIndex(map, field, 0));
});

test('terrain: setStride swaps every chunk to a coarser index and back to the very same buffers', () => {
  const map = hillyMap(40, 36);
  const t = createTerrain(map, { quality: 'low' });
  const full = t.chunks.map((m) => m.geometry.index);
  const counts = full.map((a) => a.count);
  assert.equal(t.stride, 1);
  t.setStride(2);
  assert.equal(t.stride, 2);
  t.chunks.forEach((m, k) => assert.equal(m.geometry.index.count * 4, counts[k]));
  const half = t.chunks.map((m) => m.geometry.index);
  t.setStride(4);
  assert.equal(t.stride, 4);
  t.chunks.forEach((m, k) => assert.equal(m.geometry.index.count * 16, counts[k]));
  t.setStride(3); // not a divisor of the field resolution: ignored
  assert.equal(t.stride, 4);
  t.setStride(2);
  t.chunks.forEach((m, k) => assert.equal(m.geometry.index, half[k], 'the coarser index is made once'));
  t.setStride(1);
  t.chunks.forEach((m, k) => assert.equal(m.geometry.index, full[k], 'the full index is the one it began with'));
  assert.ok(t.chunks.every((m) => m.geometry.attributes.position === t.chunks[0].geometry.attributes.position), 'the vertices stay shared');
  t.dispose();
});

test('terrain: water only over low ground at the water level, a dark border, and a clean dispose', () => {
  const map = hillyMap();
  const t = createTerrain(map);
  assert.ok(t.chunks.length > 0 && t.chunks.every((m) => m.isMesh && m.receiveShadow) && t.water && t.border);
  assert.equal(t.terrain.children.length, t.chunks.length);
  const wp = t.water.geometry.attributes.position;
  assert.ok(wp.count > 0);
  for (let i = 0; i < wp.count; i++) assert.ok(close(wp.getY(i), WATER_LEVEL, 1e-6));
  t.update(1.25);
  assert.ok(t.group.children.length >= 3);
  t.dispose();
  // a map without low ground gets no water surface
  const dry = hillyMap();
  dry.heights.fill(0.3);
  dry.terrain.fill(TERRAIN.GRASS);
  const t2 = createTerrain(dry);
  assert.ok(!t2.water || t2.water.geometry.attributes.position.count === 0);
  t2.dispose();
});

test('terrain: a building wears its yard to dirt on grass only, once', () => {
  const map = hillyMap();
  map.terrain.fill(TERRAIN.GRASS);
  const t = createTerrain(map);
  assert.equal(t.paintYard(2, 2, 2), true);
  assert.equal(t.paintYard(2, 2, 2), false, 'already dirt');
  t.dispose();
  const wood = hillyMap();
  wood.terrain.fill(TERRAIN.FOREST);
  const t2 = createTerrain(wood);
  assert.equal(t2.paintYard(2, 2, 2), false, 'forest keeps its floor');
  t2.dispose();
});

test('terrain: the water depth at every vertex is the depth of the ground below it', () => {
  const map = hillyMap();
  const t = createTerrain(map);
  const geo = t.water.geometry;
  const pos = geo.attributes.position;
  const depth = geo.attributes.aDepth;
  for (let i = 0; i < pos.count; i++) {
    assert.ok(close(depth.getX(i), WATER_LEVEL - heightAt(map, pos.getX(i), pos.getZ(i)), 1e-5), `water vertex ${i}`);
  }
  // two triangles per field cell, so depth interpolates like the ground does
  assert.equal(geo.index.count % 6, 0);
  // no depth writes: rings, blob shadows and ground effects at the shore stay whole
  assert.equal(t.water.material.depthWrite, false);
  t.update(2.5);
  assert.equal(t.water.material.uniforms.uTime.value, 2.5);
  t.dispose();
});

test('terrain: ground layers per tile, procedural textures, quality tiers', () => {
  const map = hillyMap();
  const layers = tileLayers(map);
  assert.equal(layers.length, map.width * map.height);
  for (let i = 0; i < layers.length; i++) {
    const t = map.terrain[i];
    const l = layers[i];
    if (t === TERRAIN.FOREST) assert.equal(l, LAYER.FOREST);
    else if (t === TERRAIN.WATER) assert.equal(l, LAYER.BED);
    else if (t === TERRAIN.ROCK) assert.equal(l, LAYER.ROCK);
    else if (t === TERRAIN.GRASS) assert.ok(l === LAYER.GRASS || l === LAYER.DRY);
  }
  // painted once with typed arrays (no DOM): albedo + height per layer, all bytes used sensibly
  const d = terrainTextureData();
  assert.equal(d.ground.length, GROUND_SIZE * GROUND_SIZE * 4 * LAYER_COUNT);
  assert.strictEqual(terrainTextureData(), d, 'shared, built once');
  for (let l = 0; l < LAYER_COUNT; l++) {
    let lo = 255;
    let hi = 0;
    const o = l * GROUND_SIZE * GROUND_SIZE * 4;
    for (let i = 0; i < GROUND_SIZE * GROUND_SIZE; i++) {
      lo = Math.min(lo, d.ground[o + i * 4 + 3]);
      hi = Math.max(hi, d.ground[o + i * 4 + 3]);
    }
    assert.ok(lo === 0 && hi === 255, `layer ${l} height spans the byte range`);
  }
  const t = createTerrain(map, { quality: 'low' });
  const mat = t.material;
  assert.ok(mat.isMeshStandardMaterial && mat.userData.__fow && mat.userData.__world);
  assert.ok(t.chunks.every((m) => m.material === mat), 'one material for every chunk');
  // the shader's tile map: lush and dry grass share one layer (R), split per
  // pixel by the dryness field (G); B = dirt density, A = building yard contact
  const tiles = mat.userData.terrainUniforms.uTiles.value.image.data;
  assert.equal(tiles.length, map.width * map.height * 4);
  for (let i = 0; i < layers.length; i++) {
    assert.equal(tiles[i * 4], layers[i] === LAYER.DRY ? LAYER.GRASS : layers[i]);
    if (layers[i] === LAYER.DRY) assert.ok(tiles[i * 4 + 1] >= 0.64 * 255 - 1);
  }
  assert.ok(!('TERRAIN_BUMP' in mat.defines) && !('TERRAIN_FACE' in mat.defines));
  assert.ok(!('WATER_HQ' in t.water.material.defines));
  t.setQuality('ultra');
  assert.ok('TERRAIN_BUMP' in mat.defines && 'TERRAIN_ANTITILE' in mat.defines && 'TERRAIN_FACE' in mat.defines);
  assert.ok('WATER_HQ' in t.water.material.defines);
  // the water keeps its program when its detail does not change
  const wv = t.water.material.version;
  t.setQuality('high');
  assert.equal(t.water.material.version, wv);
  t.setQuality('nonsense');
  assert.ok('TERRAIN_BUMP' in mat.defines);
  t.dispose();
});

test('terrain: the ground shader reads the field data texture, the sandstone layers and the lake level', () => {
  const map = hillyMap();
  const field = groundField(map);
  const t = createTerrain(map, { quality: 'high' });
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  t.material.onBeforeCompile(shader, null);
  const u = t.material.userData.terrainUniforms;
  assert.equal(shader.uniforms.uGData, u.uGData);
  assert.equal(u.uLayer.value.length, LAYER_COUNT);
  // one texel per field sample, texel centers on the samples: world x of tile edge 0 and of the far edge
  const img = u.uGData.value.image;
  assert.ok(img.width === field.nx && img.height === field.ny && img.data.length === field.nx * field.ny * 4);
  const m = u.uGMap.value;
  assert.ok(close(m.z, 0.5 / field.nx, 1e-9));
  assert.ok(close(m.x * map.width + m.z, (field.nx - 0.5) / field.nx, 1e-9));
  assert.ok(close(m.y * map.height + m.w, (field.ny - 0.5) / field.ny, 1e-9));
  const fs = shader.fragmentShader;
  assert.match(fs, /uniform sampler2D uGData;/);
  assert.match(fs, /vec4 rockTex\(/);
  assert.match(fs, /float gShore = /);
  assert.match(fs, new RegExp(`, ${LAYER.FACE}\\.0 \\)`), 'the wall strata layer is sampled');
  // medium and up map the walls from the side, low keeps the top texture only
  assert.match(fs, /#ifdef TERRAIN_FACE/);
  t.dispose();
});

// ------------------------------------------------------------------ overlays

test('overlays: instanced layers count what was added this frame and respect their caps', () => {
  const root = new THREE.Group();
  const rings = new RingLayer(root, 4);
  rings.begin(0);
  for (let i = 0; i < 6; i++) rings.add(i, 0, 0, null, 1, new THREE.Color('#fff'), 1, 0.1);
  rings.end();
  assert.equal(rings.mesh.count, 4);
  rings.begin(1);
  rings.end();
  assert.equal(rings.mesh.count, 0);

  const blobs = new BlobLayer(root, 8);
  blobs.begin();
  blobs.add(1, 0, 1, new THREE.Vector3(0, 1, 0), 0.5, 0.4, 0, 0.3);
  blobs.end();
  assert.equal(blobs.mesh.count, 1);

  const stars = new StarLayer(root, 5);
  stars.begin();
  stars.addRing(0, 2, 0, 0.4, 0.3, 3, 1);
  stars.addRing(0, 2, 0, 0.4, 0.3, 3, 1);
  stars.end();
  assert.equal(stars.mesh.count, 5);

  const bars = new BarLayer(root, 16);
  bars.begin();
  bars.add(0, 2, 0, 1, 0.1, 1.7, 0.5, healthColor(0.5, new THREE.Color()));
  bars.end();
  assert.equal(bars.mesh.count, 1);
  assert.equal(bars.aBar.array[0], 1, 'fill is clamped');
  assert.equal(bars.aBar.array[1], 0, 'shield never overflows the bar');
  const m = new THREE.Matrix4();
  bars.mesh.getMatrixAt(0, m);
  assert.ok(close(m.elements[12], 0) && close(m.elements[13], 2));

  const green = healthColor(1, new THREE.Color());
  const red = healthColor(0.05, new THREE.Color());
  assert.ok(green.g > green.r && red.r > red.g);

  for (const l of [rings, blobs, stars, bars]) l.dispose();
  assert.equal(root.children.length, 0);
});

test('overlays: markers expire, text is a no-op without a DOM, rally lines follow the ground', () => {
  const root = new THREE.Group();
  const markers = new MarkerLayer(root);
  markers.spawn(5, 0, 5, 'move', new THREE.Vector3(0, 1, 0));
  markers.spawn(6, 0, 5, 'attack', null);
  markers.spawn(7, 0, 5, 'no-such-kind', null);
  markers.update(0.1);
  const live = () => root.children.filter((o) => o.visible).length;
  assert.ok(live() > 0);
  markers.update(2);
  markers.update(0.01);
  markers.dispose();

  const texts = new FloatingTextLayer(root);
  texts.spawn(0, 1, 0, '+25', '#ff0');
  texts.update(0.5);
  texts.dispose();

  const flags = new RallyFlags(root, 4, (x, y) => x * 0.1 + y * 0.05);
  flags.prewarm();
  flags.prewarm();
  assert.equal(flags.items.length, 1, 'one hidden flag, made once');
  assert.equal(flags.items[0].g.visible, false);
  flags.begin();
  flags.add(10, 1, 10, '#ff0000', 0);
  assert.equal(flags.items.length, 1, 'the first flag reuses the primed one');
  assert.equal(flags.items[0].g.visible, true);
  flags.addLine(0, 0, 10, 10, 2, '#ff0000', 0.3);
  flags.end();
  assert.ok(flags.dots.count > 10 && flags.dots.count < 30, `${flags.dots.count} dots`);
  const m = new THREE.Matrix4();
  flags.dots.getMatrixAt(3, m);
  const x = m.elements[12];
  const z = m.elements[14];
  assert.ok(close(m.elements[13], x * 0.1 + z * 0.05 + 0.05, 1e-4), 'dots sit on the ground');
  flags.begin();
  flags.end();
  assert.equal(flags.dots.count, 0);
  flags.dispose();
  assert.equal(root.children.length, 0);
});

test('placement: prewarm primes a hidden ghost that the first show of its type reuses', () => {
  const root = new THREE.Group();
  const layer = new PlacementLayer(root, hillyMap(), () => ({ pantheon: null, color: '#3366ff' }));
  layer.prewarm();
  const primed = layer.ghost;
  assert.ok(primed && primed.model.root.visible === false);
  assert.ok(layer.matsOk && layer.matsBad && layer.orderMats, 'every ghost material exists');
  layer.prewarm();
  assert.equal(layer.ghost, primed, 'primed once');
  layer.show(primed.type, 3, 3, false, null);
  assert.equal(layer.ghost, primed, 'the same type reuses the primed ghost');
  assert.equal(primed.model.root.visible, true);
  layer.show('barracks', 3, 3, true, null);
  assert.notEqual(layer.ghost, primed, 'another type replaces it');
  layer.dispose();
  assert.equal(root.children.length, 0);
});

test('placement: a ghost with a per-tile footprint, hidden on demand, pending order ghosts pooled', () => {
  const map = hillyMap();
  const root = new THREE.Group();
  const layer = new PlacementLayer(root, map, () => ({ pantheon: null, color: '#3366ff' }));
  layer.show('barracks', 3, 3, true, null);
  layer.update(0.1);
  const visibleMeshes = () => {
    let n = 0;
    root.traverseVisible((o) => {
      if (o.isMesh) n++;
    });
    return n;
  };
  assert.ok(visibleMeshes() > 0);
  layer.show('barracks', 4, 3, false, [1, 1, 0, 1, 1, 1, 1, 0, 1]);
  layer.update(0.1);
  layer.hide();
  layer.update(0.1);
  assert.equal(visibleMeshes(), 0);
  layer.setOrders([{ b: 'house', tx: 8, ty: 8 }, { b: 'tower', tx: 12, ty: 4 }]);
  layer.update(0.1);
  assert.ok(visibleMeshes() >= 2);
  layer.setOrders([]);
  layer.update(0.1);
  assert.equal(visibleMeshes(), 0);
  layer.dispose();
  assert.equal(root.children.length, 0);
});

// ------------------------------------------------------------------ no-build zone (Decade of Peace)

const ZONE_ANCHORS = [{ tx: 30, ty: 20, size: 4 }, { tx: 1, ty: 2, size: 4 }];

test('no-build zone: the mask is the sim\'s own rule, tile by tile, clipped to the map with rounded corners', () => {
  const W = 64;
  const H = 48;
  const mask = zoneMask(W, H, ZONE_ANCHORS);
  assert.equal(mask.length, W * H);
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const want = peaceBlocksFootprint(ZONE_ANCHORS, x, y, 1) ? 1 : 0;
      assert.equal(mask[y * W + x], want, `tile ${x},${y}`);
      n += want;
    }
  }
  assert.ok(n > 1500, `${n} tiles kept clear`);
  // One Town Center on its own (the other one's ground overlaps this one's west side).
  const one = zoneMask(W, H, [ZONE_ANCHORS[0]]);
  const at = (x, y) => one[y * W + x];
  // The Town Center's own tiles (30..33 by 20..23) and the ground up to PEACE_BUILD_GAP - 1 empty tiles from it are in, the next one is out.
  assert.equal(at(30, 20), 1);
  assert.equal(at(30 - PEACE_BUILD_GAP, 21), 1, 'west side: 19 empty tiles');
  assert.equal(at(30 - PEACE_BUILD_GAP - 1, 21), 0);
  assert.equal(at(34 + PEACE_BUILD_GAP - 1, 21), 1, 'east side: 19 empty tiles');
  assert.equal(at(34 + PEACE_BUILD_GAP, 21), 0);
  // The corner of the square is cut off: 15 empty tiles out on both axes is over the line (450 > 400), 14 is not.
  assert.equal(at(14, 4), 0);
  assert.equal(at(15, 5), 1);
  // Nothing known, nothing kept clear.
  assert.ok(zoneMask(W, H, []).every((v) => v === 0));
});

test('no-build zone: one mesh of tile quads on the terrain, edge flags only where the zone ends, rebuilt only when it changes', () => {
  const map = hillyMap(64, 48);
  const root = new THREE.Group();
  const zone = new NoBuildZone(root, map);
  assert.equal(root.children.length, 0, 'nothing is made until there is a zone');
  zone.set([]);
  assert.equal(root.children.length, 0);

  const anchors = [{ tx: 1, ty: 2, size: 4 }]; // touches the west and north edges of the map
  zone.set(anchors);
  const mask = zoneMask(map.width, map.height, anchors);
  const cells = mask.reduce((a, v) => a + v, 0);
  assert.equal(zone.cells, cells);
  assert.equal(root.children.length, 1);
  const mesh = zone.mesh;
  assert.equal(mesh.name, 'no-build-zone');
  assert.equal(mesh.visible, false, 'drawn only with the placement ghost');
  const geo = mesh.geometry;
  assert.equal(geo.getAttribute('position').count, cells * 4);
  assert.equal(geo.index.count, cells * 6);
  assert.equal(geo.index.array.constructor, Uint32Array);
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.depthWrite, false);

  // The edge flags (west, east, north, south neighbour is outside the zone) per quad, found by the quad's tile.
  const pos = geo.getAttribute('position');
  const sides = geo.getAttribute('aSides');
  const flagsAt = (tx, ty) => {
    for (let q = 0; q < cells; q++) {
      const x = Math.floor(pos.getX(q * 4));
      const z = Math.floor(pos.getZ(q * 4));
      if (x === tx && z === ty) return [0, 1, 2, 3].map((k) => sides.getComponent(q * 4, k));
    }
    return null;
  };
  const east = 5 + PEACE_BUILD_GAP - 1; // the last tile east of the Town Center (tiles 1..4) that is kept clear
  assert.deepEqual(flagsAt(east, 3), [0, 1, 0, 0], 'a quad on the east rim: only its east side is open');
  assert.deepEqual(flagsAt(3, 3), [0, 0, 0, 0], 'inside: no line');
  assert.deepEqual(flagsAt(0, 3), [0, 0, 0, 0], 'on the map edge: no line along it');
  assert.deepEqual(flagsAt(east, 2), [0, 1, 0, 0]);
  const south = 6 + PEACE_BUILD_GAP - 1;
  assert.deepEqual(flagsAt(2, south), [0, 0, 0, 1], 'south rim');
  assert.equal(flagsAt(east + 1, 3), null, 'nothing past the rim');

  // Draped on the terrain: each corner sits a hair over the ground (never under the water line).
  for (const q of [0, Math.floor(cells / 2), cells - 1]) {
    for (let v = 0; v < 4; v++) {
      const i = q * 4 + v;
      const want = Math.max(heightAt(map, pos.getX(i), pos.getZ(i)), -0.2) + 0.05;
      assert.ok(close(pos.getY(i), want, 1e-5), `corner ${i}`);
    }
  }

  // The same Town Centers again: not rebuilt. Shown and hidden with the ghost.
  zone.set(anchors.map((a) => ({ ...a })));
  assert.equal(zone.mesh, mesh);
  zone.show();
  assert.equal(mesh.visible, true);
  zone.hide();
  assert.equal(mesh.visible, false);
  zone.show();
  // Another set of Town Centers: a new mesh in place of the old one, still shown.
  zone.set([{ tx: 40, ty: 30, size: 4 }]);
  assert.notEqual(zone.mesh, mesh);
  assert.equal(root.children.length, 1, 'the old one is gone');
  assert.equal(zone.mesh.visible, true);
  // None: nothing drawn.
  zone.set([]);
  assert.equal(zone.mesh, null);
  assert.equal(zone.cells, 0);
  assert.equal(root.children.length, 0);

  // The edge line pulses with time.
  const t0 = zone.uniforms.uTime.value;
  zone.update(0.5);
  assert.ok(close(zone.uniforms.uTime.value, t0 + 0.5));
  zone.set(anchors);
  zone.dispose();
  assert.equal(root.children.length, 0);
});

test('placement: the no-build zone shows with the ghost (building or wall line), hides with it and goes away on dispose', () => {
  const map = hillyMap(64, 48);
  const root = new THREE.Group();
  const layer = new PlacementLayer(root, map, () => ({ pantheon: null, color: '#3366ff' }));
  const zoneShown = () => {
    let on = false;
    root.traverseVisible((o) => {
      if (o.name === 'no-build-zone') on = true;
    });
    return on;
  };
  layer.setZones([{ tx: 40, ty: 30, size: 4 }]);
  assert.equal(zoneShown(), false, 'set, but no ghost yet');
  layer.show('house', 30, 30, false, [1, 0, 1, 1]);
  assert.equal(zoneShown(), true);
  layer.update(0.1);
  assert.ok(layer.zone.uniforms.uTime.value > 0, 'the layer advances its time');
  layer.hide();
  assert.equal(zoneShown(), false);
  // A wall line shows it too, and a type that is not a building takes it down.
  layer.showLine('wooden_wall', [{ tx: 30, ty: 30, state: 'build' }, { tx: 31, ty: 30, state: 'blocked' }]);
  assert.equal(zoneShown(), true);
  layer.show('no-such-building', 1, 1, true, null);
  assert.equal(zoneShown(), false);
  // New Town Centers while a ghost is up: the zone is replaced and stays shown.
  layer.show('house', 30, 30, true, null);
  layer.setZones([{ tx: 10, ty: 10, size: 4 }]);
  assert.equal(zoneShown(), true);
  layer.setZones(null);
  assert.equal(zoneShown(), false, 'cleared');
  layer.setZones([{ tx: 10, ty: 10, size: 4 }]);
  layer.dispose();
  assert.equal(root.children.length, 0);
});

test('fires: damaged buildings burn more the lower their health, at stable spots', () => {
  assert.equal(fireCount(1), 0);
  assert.equal(fireCount(0.7), 0);
  assert.equal(fireCount(0.6), 1);
  assert.equal(fireCount(0.3), 2);
  assert.equal(fireCount(0.1), 3);
  assert.equal(fireCount(Number.NaN), 0);
  const root = new THREE.Group();
  const fires = new FireLayer(root);
  const spots = () => {
    const m = new THREE.Matrix4();
    const out = [];
    for (let i = 0; i < fires.flames.mesh.count; i++) {
      fires.flames.mesh.getMatrixAt(i, m);
      out.push([m.elements[12], m.elements[13], m.elements[14]]);
    }
    return out;
  };
  fires.begin(0);
  fires.addBuilding(7, 10, 0.2, 10, 3, 2.5, 0.5);
  fires.addBuilding(8, 20, 0.2, 20, 4, 3, 0.1);
  fires.addBuilding(9, 30, 0.2, 30, 4, 3, 0.9);
  fires.end();
  assert.equal(fires.fires, 4);
  assert.equal(fires.smoke.mesh.count, 16);
  const first = spots();
  for (const [x, y, z] of first.slice(0, 2)) {
    assert.ok(Math.abs(x - 10) <= 1.5 && Math.abs(z - 10) <= 1.5, 'over the footprint');
    assert.ok(y > 0.2 && y < 0.2 + 2.5, 'on the building');
  }
  fires.begin(5);
  fires.addBuilding(7, 10, 0.2, 10, 3, 2.5, 0.5);
  fires.addBuilding(8, 20, 0.2, 20, 4, 3, 0.1);
  fires.end();
  assert.deepEqual(spots(), first, 'the same spots every frame');
  assert.equal(fires.flames.material.uniforms.uTime.value, 5);
  fires.dispose();
  assert.equal(root.children.length, 0);
});

test('order paths: dots through each queued point and back along a patrol, pips at the points, bad points end the path', () => {
  const root = new THREE.Group();
  const paths = new OrderPaths(root, (x, y) => x * 0.1 + y * 0.05, 200);
  paths.begin();
  paths.add(0, 0, 0.4, [[6, 0, 0], [6, 6, 1]], null, 0);
  paths.end();
  const plain = paths.mesh.count;
  assert.ok(plain > 15 && plain < 25, `${plain} dots`);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  paths.mesh.getMatrixAt(plain - 1, m);
  p.setFromMatrixPosition(m);
  assert.ok(close(p.x, 6) && close(p.z, 6) && close(p.y, 6 * 0.1 + 6 * 0.05 + 0.05), 'the last pip sits on the ground at the last point');
  assert.equal(m.elements[0], 2, 'pips are bigger than the dots');
  const col = new THREE.Color();
  paths.mesh.getColorAt(plain - 1, col);
  assert.equal(col.getHex(), paths.colors[1].getHex(), 'an attack point takes the attack colour');

  paths.begin();
  paths.add(0, 0, 0.4, [[6, 0, 1]], [0, 0], 0);
  paths.end();
  assert.ok(paths.mesh.count > 15, 'a patrol draws its way back too');

  paths.begin();
  paths.add(0, 0, 0.4, [[6, 0, 0], [NaN, 2, 0], [9, 9, 0]], [1, 1], 0);
  paths.add(0, 0, 0.4, 'junk', null, 0);
  paths.end();
  assert.ok(paths.mesh.count > 0 && paths.mesh.count < 12, 'stops at the bad point');

  // a point on a unit: drawn where the unit is seen, and the path stops there when it is not
  paths.begin();
  paths.add(0, 0, 0.4, [[6, 0, 1, 7]], null, 0, (id) => (id === 7 ? { x: 0, y: 6 } : null));
  paths.end();
  const seen = paths.mesh.count;
  const m2 = new THREE.Matrix4();
  paths.mesh.getMatrixAt(seen - 1, m2);
  assert.ok(close(m2.elements[12], 0) && close(m2.elements[14], 6), 'the pip follows the seen unit, not the sent point');
  paths.begin();
  paths.add(0, 0, 0.4, [[6, 0, 1, 8], [9, 9, 0]], null, 0, () => null);
  paths.add(0, 0, 0.4, [[6, 0, 1, 8]], null, 0);
  paths.end();
  assert.equal(paths.mesh.count, 0, 'nothing toward a unit out of sight, nor past it');

  paths.begin();
  for (let i = 0; i < 50; i++) paths.add(0, i, 0.4, [[40, i, 0]], null, 0);
  paths.end();
  assert.equal(paths.mesh.count, 200, 'never more dots than the mesh holds');
  paths.dispose();
  assert.equal(root.children.length, 0);
});
