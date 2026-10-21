// Tests for the look of the nature props (src/render/models/leaf-texture.js, foliage-shader.js,
// props.js): the procedural leaf and needle textures, the leaf puffs of broadleaf crowns and bushes,
// the needle sprays of spruce tiers and ferns, the quality hook that takes the sphere depth off the
// puffs on low, and the shader patches of the textured plant materials (alpha to coverage on the
// multisampled target, the night grade bound to the Lighting uniforms).
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
const { leafTexels, needleTexels, NEEDLE_SPRAYS } = await import('../../src/render/models/leaf-texture.js');
const { createForest, createDecor, getPropInfo } = await import('../../src/render/models/props.js');
const { WORLD_UNIFORMS } = await import('../../src/render/shading.js');
const { TERRAIN } = await import('../../src/config.js');

/** A forest block with a meadow around it, a few decor items of every plant kind. */
function synthMap(w = 24, h = 20) {
  const terrain = new Uint8Array(w * h).fill(TERRAIN.GRASS);
  for (let y = 2; y < 10; y++) for (let x = 2; x < 12; x++) terrain[y * w + x] = TERRAIN.FOREST;
  const heights = new Float32Array((w + 1) * (h + 1));
  const decor = [
    { x: 13.2, y: 4.1, kind: 'bush', rot: 1.1, scale: 1.2 },
    { x: 14.2, y: 5.3, kind: 'bush', rot: 0.3, scale: 1 },
    { x: 15.7, y: 6.3, kind: 'fern', rot: 2, scale: 1.1 },
    { x: 16.7, y: 7.1, kind: 'fern', rot: 0.4, scale: 1 },
    { x: 17.5, y: 8.3, kind: 'grass', rot: 0.2, scale: 1 },
    { x: 18.5, y: 9.3, kind: 'flowers', rot: 0.9, scale: 1 },
  ];
  return { width: w, height: h, terrain, heights, decor, seed: 5 };
}

function instancedOf(obj, name) {
  const out = [];
  obj.traverse((o) => { if (o.isInstancedMesh && (!name || o.name === name)) out.push(o); });
  return out;
}

/** Vertex shader and fragment shader of a patched material, compiled against the Lambert library. */
function compiled(mat) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  mat.onBeforeCompile(shader, null);
  return shader;
}

// ------------------------------------------------------------------ textures

test('leaf texture: deterministic, leaves over gaps, tileable', () => {
  const a = leafTexels();
  const b = leafTexels();
  assert.equal(a.length, 128 * 128 * 4);
  assert.deepEqual(a, b, 'every client paints the same leaves');
  assert.equal(leafTexels(64).length, 64 * 64 * 4);
  let covered = 0;
  let lit = 0;
  for (let i = 0; i < 128 * 128; i++) {
    if (a[i * 4 + 3] > 127) covered++;
    lit += a[i * 4];
    assert.equal(a[i * 4 + 2], 0, 'blue is unused');
  }
  const share = covered / (128 * 128);
  assert.ok(share > 0.6 && share < 0.97, `${(share * 100).toFixed(0)}% of the texels are leaf`);
  assert.ok(lit / (128 * 128) > 40, 'leaves are not black');
  // the texture repeats: across the wrap seam the alpha changes about as much as anywhere else
  let seam = 0;
  let inner = 0;
  for (let y = 0; y < 128; y++) {
    seam += Math.abs(a[(y * 128) * 4 + 3] - a[(y * 128 + 127) * 4 + 3]);
    inner += Math.abs(a[(y * 128 + 64) * 4 + 3] - a[(y * 128 + 63) * 4 + 3]);
  }
  assert.ok(seam < inner * 2 + 128 * 8, `seam ${seam} vs ${inner} inside`);
});

test('needle texture: sprays open up toward the tips, tiles around', () => {
  const W = 128;
  const H = 64;
  const a = needleTexels();
  assert.equal(a.length, W * H * 4);
  assert.deepEqual(a, needleTexels());
  assert.equal(NEEDLE_SPRAYS, 8);
  const row = (y) => {
    let n = 0;
    for (let x = 0; x < W; x++) if (a[(y * W + x) * 4 + 3] > 127) n++;
    return n;
  };
  const base = row(4);
  const mid = row(Math.floor(H * 0.55));
  const tip = row(H - 4);
  assert.ok(base > W * 0.6, `${base} covered texels at the base`);
  assert.ok(tip < base * 0.5, `${tip} at the tips against ${base} at the base`);
  assert.ok(mid <= base, 'the sprays narrow');
  // the seam between the last spray and the first
  let seam = 0;
  for (let y = 0; y < H; y++) seam += Math.abs(a[(y * W) * 4 + 3] - a[(y * W + W - 1) * 4 + 3]);
  assert.ok(seam < H * 255 * 0.35, `seam ${seam}`);
});

// ------------------------------------------------------------------ geometry

test('broadleaf, birch and bushes are built of leaf puffs: six vertices at a center plus corners and a radius', () => {
  const map = synthMap();
  const f = createForest(map, null, { variants: ['broadleaf', 'birch'] });
  const d = createDecor(map);
  const geos = [...instancedOf(f.object3d).filter((m) => m.name !== 'forest-stumps'), ...instancedOf(d.object3d, 'decor-bush')].map((m) => [m.name, m.geometry]);
  assert.ok(geos.some(([n]) => n === 'forest-broadleaf') && geos.some(([n]) => n === 'forest-birch') && geos.some(([n]) => n === 'decor-bush'));
  const min = { 'forest-broadleaf': 20, 'forest-birch': 8, 'decor-bush': 4 };
  for (const [name, g] of geos) {
    const bb = g.attributes.aBb;
    const pos = g.attributes.position;
    assert.ok(bb && bb.itemSize === 4 && bb.count === pos.count, `${name}: aBb on every vertex`);
    let first = -1;
    for (let i = 0; i < bb.count; i++) {
      if (bb.getW(i) > 0.5 && first < 0) first = i;
      if (first >= 0) assert.equal(bb.getW(i), 1, `${name}: parts after the first puff are puffs`);
    }
    assert.ok(first >= 0, `${name} has puffs`);
    assert.equal((bb.count - first) % 6, 0, `${name}: whole puffs`);
    let puffs = 0;
    for (let i = first; i < bb.count; i += 6) {
      puffs++;
      const corners = new Set();
      for (let k = 0; k < 6; k++) {
        assert.ok(Math.abs(pos.getX(i + k) - pos.getX(i)) < 1e-6 && Math.abs(pos.getY(i + k) - pos.getY(i)) < 1e-6 && Math.abs(pos.getZ(i + k) - pos.getZ(i)) < 1e-6, `${name}: a puff sits at one point`);
        corners.add(`${bb.getX(i + k)},${bb.getY(i + k)}`);
        assert.equal(bb.getZ(i + k), bb.getZ(i), 'one radius per puff');
      }
      assert.deepEqual([...corners].sort(), ['-1,-1', '-1,1', '1,-1', '1,1'], `${name}: the four corners of a quad`);
      const r = bb.getZ(i);
      assert.ok(r > 0.02 && r < 0.6, `${name}: puff radius ${r}`);
    }
    assert.ok(puffs >= min[name], `${name}: ${puffs} puffs`);
    // bark carries no puff data at all
    for (let i = 0; i < first; i++) assert.equal(bb.getZ(i), 0);
  }
  f.dispose();
  d.dispose();
});

test('spruce tiers carry needle coordinates, the trunk none', () => {
  const f = createForest(synthMap(), null, { variants: ['pine'] });
  const mesh = instancedOf(f.object3d, 'forest-pine')[0];
  const uv = mesh.geometry.attributes.aUv;
  assert.ok(uv && uv.itemSize === 3 && uv.count === mesh.geometry.attributes.position.count);
  let needles = 0;
  let bare = 0;
  for (let i = 0; i < uv.count; i++) {
    if (uv.getZ(i) === 1) {
      needles++;
      assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 3.001, `u ${uv.getX(i)} runs around the tier`);
      assert.ok(uv.getY(i) >= 0 && uv.getY(i) <= 1.001, `v ${uv.getY(i)} runs out along it`);
    } else bare++;
  }
  assert.ok(needles >= 8 * 16 * 3, `${needles} needle vertices`);
  assert.ok(bare >= 12 && bare < needles / 5, `${bare} bare trunk vertices`);
  f.dispose();
});

test('ferns: arching frond ribbons, each on one spray of the needle texture', () => {
  const info = getPropInfo();
  assert.equal(info.decor.fern.length, 2, 'two fern shapes');
  for (const t of info.decor.fern) assert.ok(t >= 40 && t <= 120, `${t} triangles`);
  const d = createDecor(synthMap());
  const ferns = instancedOf(d.object3d, 'decor-fern');
  assert.ok(ferns.length >= 1);
  for (const m of ferns) {
    assert.equal(m.material.name, 'props-plant-fern');
    assert.equal(m.material.side, THREE.DoubleSide, 'lit from both sides');
    assert.equal(m.castShadow, false, 'ground plants cast no shadows');
    const uv = m.geometry.attributes.aUv;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      assert.equal(uv.getZ(i), 1);
      assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1, 'inside one width of the needle texture');
      assert.ok(pos.getY(i) > 0 && pos.getY(i) < 0.35, 'low to the ground');
      assert.ok(Math.hypot(pos.getX(i), pos.getZ(i)) < 0.5, 'a compact rosette');
    }
    // a frond's vertices stay inside one spray (an eighth of the width)
    for (let i = 0; i < uv.count; i += 24) {
      let lo = 1;
      let hi = 0;
      for (let k = 0; k < 24; k++) {
        lo = Math.min(lo, uv.getX(i + k));
        hi = Math.max(hi, uv.getX(i + k));
      }
      assert.ok(hi - lo <= 1 / NEEDLE_SPRAYS + 1e-6, `frond spans ${(hi - lo).toFixed(3)} of the width`);
    }
  }
  d.dispose();
});

// ------------------------------------------------------------------ quality and materials

test('leaf puffs lose their sphere depth on low and get it back', () => {
  const map = synthMap();
  const f = createForest(map, null, { variants: ['broadleaf', 'birch', 'pine'], quality: 'low' });
  const d = createDecor(map, null, { quality: 'low' });
  const puffs = [...instancedOf(f.object3d), ...instancedOf(d.object3d)].filter((m) => /^(forest-(broadleaf|birch)|decor-bush)$/.test(m.name));
  assert.ok(puffs.length >= 3);
  const pines = instancedOf(f.object3d, 'forest-pine');
  const pineMat = pines[0].material;
  for (const m of puffs) assert.equal(m.material.name, 'props-plant-puff-flat', `${m.name} draws flat discs on low`);
  const depth = puffs.map((m) => m.customDepthMaterial);
  f.setQuality('high');
  d.setQuality('high');
  for (const m of puffs) assert.equal(m.material.name, 'props-plant-puff', `${m.name} writes the sphere depth on high`);
  f.setQuality('low');
  d.setQuality('low');
  for (const m of puffs) assert.equal(m.material.name, 'props-plant-puff-flat');
  f.setQuality('medium');
  d.setQuality('ultra');
  for (const m of puffs) assert.equal(m.material.name, 'props-plant-puff');
  puffs.forEach((m, i) => assert.equal(m.customDepthMaterial, depth[i], 'shadows are the same either way'));
  for (const m of pines) assert.equal(m.material, pineMat, 'spruces are drawn alike on every quality');
  const low = createForest(map, null, { variants: ['broadleaf'], quality: 'low' });
  const high = createForest(map, null, { variants: ['broadleaf'], quality: 'high' });
  const flat = compiled(instancedOf(low.object3d)[0].material);
  const sphere = compiled(instancedOf(high.object3d)[0].material);
  assert.doesNotMatch(flat.fragmentShader, /gl_FragDepth/, 'flat discs keep the early depth test');
  assert.match(sphere.fragmentShader, /gl_FragDepth = \( isOrthographic/, 'the sphere writes its own depth');
  low.dispose();
  high.dispose();
  f.dispose();
  d.dispose();
});

test('textured plants: leaf puffs, spruce needles and ferns patch their own shader parts', () => {
  const map = synthMap();
  const f = createForest(map, null, { variants: ['broadleaf', 'pine', 'palm'] });
  const d = createDecor(map);
  const by = (name) => [...instancedOf(f.object3d), ...instancedOf(d.object3d)].find((m) => m.name === name);
  const puff = by('forest-broadleaf').material;
  const pine = by('forest-pine').material;
  const fern = by('decor-fern').material;
  const plain = by('decor-grass').material;
  for (const m of [puff, pine, fern]) assert.equal(m.alphaToCoverage, true, `${m.name}: cut edges ride on alpha to coverage`);
  assert.equal(plain.alphaToCoverage, false);
  const keys = new Set([puff, pine, fern, plain].map((m) => m.customProgramCacheKey()));
  assert.equal(keys.size, 4, 'one program per kind');
  assert.match(pine.customProgramCacheKey(), /foliage\d+p/);
  assert.match(fern.customProgramCacheKey(), /foliage\d+n/);
  assert.match(puff.customProgramCacheKey(), /foliage\d+bd?t/);

  const sp = compiled(puff);
  assert.match(sp.vertexShader, /attribute vec4 aBb/);
  assert.match(sp.fragmentShader, /uLeafTex/);
  assert.doesNotMatch(sp.fragmentShader, /uNeedleTex/);
  const sn = compiled(pine);
  assert.match(sn.vertexShader, /attribute vec4 aPine/);
  assert.match(sn.vertexShader, /aPine\.x \* 0\.37/, 'every spruce tier starts its needles somewhere else');
  assert.match(sn.fragmentShader, /uNeedleTex/);
  const sf = compiled(fern);
  assert.match(sf.vertexShader, /attribute vec3 aUv/);
  assert.doesNotMatch(sf.vertexShader, /aPine|pineMorph|aShape/, 'a fern is not reshaped like a spruce');
  assert.match(sf.vertexShader, /floor\( fract\(/, 'a fern shifts its texture by whole sprays');
  assert.match(sf.fragmentShader, /uNeedleTex/);
  const sg = compiled(plain);
  assert.doesNotMatch(sg.fragmentShader, /uLeafTex|uNeedleTex/);
  assert.doesNotMatch(sg.vertexShader, /aBb|aUv/);
  // wind, shadows and the sun-side rim are in all of them
  for (const s of [sp, sn, sf, sg]) {
    assert.match(s.vertexShader, /windOffset\(/);
    assert.match(s.fragmentShader, /rimEdge/);
  }
  f.dispose();
  d.dispose();
});

test('the multisample flag follows the render target; the night grade follows the Lighting uniforms', () => {
  const f = createForest(synthMap(), null, { variants: ['broadleaf'] });
  const mat = instancedOf(f.object3d, 'forest-broadleaf')[0].material;
  const shader = compiled(mat);
  const ms = shader.uniforms.uFolMS;
  assert.equal(ms.value, 0);
  mat.onBeforeRender({ getRenderTarget: () => ({ samples: 4 }) });
  assert.equal(ms.value, 1, 'multisampled target: soft leaf edges');
  mat.onBeforeRender({ getRenderTarget: () => null });
  assert.equal(ms.value, 0, 'the canvas: a hard cut');
  mat.onBeforeRender({ getRenderTarget: () => ({ samples: 0 }) });
  assert.equal(ms.value, 0);
  // the night grade reads the shared time-of-day uniform, and stays at day without one
  const had = Object.prototype.hasOwnProperty.call(WORLD_UNIFORMS, 'uNight') ? WORLD_UNIFORMS.uNight : undefined;
  try {
    delete WORLD_UNIFORMS.uNight;
    assert.equal(compiled(mat).uniforms.uFolNight.value, 0, 'day without the Lighting uniforms');
    const night = { value: 0.7 };
    WORLD_UNIFORMS.uNight = night;
    assert.equal(compiled(mat).uniforms.uFolNight, night, 'bound to the shared uniform');
  } finally {
    if (had === undefined) delete WORLD_UNIFORMS.uNight;
    else WORLD_UNIFORMS.uNight = had;
  }
  f.dispose();
});

test('the budgets of the new plant shapes stay low', () => {
  const info = getPropInfo();
  for (const [v, tris] of Object.entries(info.trees)) assert.ok(tris <= 160, `${v}: ${tris} triangles`);
  for (const [k, list] of Object.entries(info.decor)) for (const t of list) assert.ok(t <= 200, `${k}: ${t} triangles`);
  // puffs are two triangles each: the crowns are cheaper than the meshes they replaced
  assert.ok(info.trees.broadleaf <= 100 && info.trees.birch <= 100, `${info.trees.broadleaf} / ${info.trees.birch}`);
});
