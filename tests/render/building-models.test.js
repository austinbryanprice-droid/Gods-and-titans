// Tests for the procedural building models (src/render/models/building-models.js):
// every building type × roster pantheon × tier builds inside its footprint and
// the triangle / mesh budgets, every DESIGN 4.7 style value is supported, the
// construction / tier / animation / dispose lifecycle works, geometry and
// materials are cached, and the gold mine reacts to its remaining amount.
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
const {
  buildBuildingModel, buildGoldMineModel, getBuildingModelInfo, getGoldMineInfo, setBuildingTime, clearBuildingCaches, PLINTH,
  setBuildingDetail, getBuildingDetail, pruneBuildingCaches,
} = await import('../../src/render/models/building-models.js');
const { bevelBox, bevelFrustum, courseSlope, courseLoft, courseCone, shadedTris } = await import('../../src/render/models/building-core.js');
const { BUILDINGS, PANTHEON_LIST, GOLD_MINE } = await import('../../src/data/index.js');
const { PLAYER_COLORS } = await import('../../src/config.js');
const { WALL_N, WALL_E, WALL_S, WALL_W, WALL_TOWER_SHIFT } = await import('../../src/data/walls.js');

const TRI_BUDGET = 3000;
const MESH_BUDGET = 6;
const ROOFS = ['gable', 'flat', 'pagoda', 'pyramid', 'dome', 'thatch_cone', 'stepped', 'shikhara', 'curved', 'longhouse'];
const WALLS = ['marble', 'timber', 'sandstone', 'stone', 'mudbrick', 'brick', 'lacquer'];
const ORNAMENTS = ['columns', 'carvings', 'obelisks', 'torii', 'lanterns', 'serpents', 'knots', 'winged_bulls', 'spikes', 'banners'];
const COLORS = { wall: '#c8b89a', roof: '#8a4a3a', trim: '#3a5a8a', accent: '#d4af37' };

/** [type, tier] for every model the game can show. */
const VARIANTS = Object.keys(BUILDINGS).flatMap((t) => (t === 'town_center' ? [[t, 1], [t, 2], [t, 3]] : [[t, 1]]));

const color = (c) => (typeof c === 'number' ? c : c.hex ?? c.color ?? c);
const teamColors = PLAYER_COLORS.map(color);

function meshesOf(root) {
  const out = [];
  root.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
}

function trianglesOf(root, visibleOnly = true) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || (visibleOnly && !o.visible)) return;
    const g = o.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return n;
}

function assertFinite(geo, label) {
  const p = geo.attributes.position.array;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) assert.fail(`${label}: non-finite vertex`);
}

test('building data has the types the models know about', () => {
  for (const t of ['town_center', 'house', 'manor', 'barracks', 'storehouse', 'shrine', 'temple', 'tower', 'titan_gate']) {
    assert.ok(BUILDINGS[t], `missing building ${t}`);
  }
  assert.ok(PANTHEON_LIST.length >= 10, 'expected the 10 roster pantheons');
});

test('every type × pantheon × tier fits its footprint and the budgets', () => {
  for (const p of PANTHEON_LIST) {
    for (const [type, tier] of VARIANTS) {
      const label = `${p.id}/${type}${tier}`;
      const info = getBuildingModelInfo(type, p, tier);
      const size = BUILDINGS[type].size;
      const wall = BUILDINGS[type].wall === true; // a lone post: the arms come with the connections (below)
      assert.equal(info.size, size, `${label}: size`);
      assert.ok(info.triangles > (wall ? 30 : 50) && info.triangles <= TRI_BUDGET, `${label}: ${info.triangles} triangles`);
      assert.ok(info.meshes >= 2 && info.meshes <= MESH_BUDGET, `${label}: ${info.meshes} meshes`);
      assert.ok(info.constructionMeshes <= MESH_BUDGET, `${label}: ${info.constructionMeshes} meshes while building`);
      assert.ok(info.fit === 1, `${label}: model had to be shrunk to ${info.fit.toFixed(3)} to fit`);
      assert.ok(info.extent <= (wall ? info.limit : size / 2 - 0.1 + 0.006), `${label}: reaches ${info.extent.toFixed(3)} from center`);
      assert.ok(info.height > 1 && info.height < 6, `${label}: height ${info.height}`);
    }
  }
});

test('town center tiers are clearly different and grow', () => {
  for (const p of PANTHEON_LIST) {
    const [a, b, c] = [1, 2, 3].map((t) => getBuildingModelInfo('town_center', p, t));
    assert.ok(b.triangles > a.triangles && c.triangles > b.triangles, `${p.id}: tiers should add detail (${a.triangles}/${b.triangles}/${c.triangles})`);
    assert.ok(c.height >= a.height, `${p.id}: the city should not be lower than the village`);
  }
});

test('the manor is a bigger house: it stands on the ground of four Houses and shows more of them in every pantheon', () => {
  for (const p of PANTHEON_LIST) {
    const house = getBuildingModelInfo('house', p);
    const manor = getBuildingModelInfo('manor', p);
    assert.equal(manor.size, BUILDINGS.house.size * 2, `${p.id}: a Manor covers the 2 x 2 Houses it replaces`);
    assert.ok(manor.triangles > house.triangles * 1.5, `${p.id}: the Manor shows more detail (${manor.triangles}) than one House (${house.triangles})`);
    assert.ok(manor.height >= house.height, `${p.id}: and stands as tall (${manor.height.toFixed(2)} against ${house.height.toFixed(2)})`);
  }
});

test('every DESIGN 4.7 style value builds (sampled combinations) without NaNs', () => {
  const combos = [];
  ROOFS.forEach((roof, i) => {
    combos.push({ roof, wall: WALLS[i % WALLS.length], ornament: ORNAMENTS[i % ORNAMENTS.length] });
    combos.push({ roof, wall: WALLS[(i + 3) % WALLS.length], ornament: ORNAMENTS[(i + 5) % ORNAMENTS.length] });
  });
  WALLS.forEach((wall, i) => combos.push({ roof: ROOFS[(i * 3) % ROOFS.length], wall, ornament: ORNAMENTS[(i * 7) % ORNAMENTS.length] }));
  ORNAMENTS.forEach((ornament, i) => combos.push({ roof: ROOFS[(i * 7 + 1) % ROOFS.length], wall: WALLS[(i * 2) % WALLS.length], ornament }));
  for (const style of combos) {
    const p = { id: 'syn', style, colors: COLORS };
    for (const [type, tier] of VARIANTS) {
      const label = `${style.roof}/${style.wall}/${style.ornament} ${type}${tier}`;
      const info = getBuildingModelInfo(type, p, tier);
      assert.ok(info.triangles <= TRI_BUDGET, `${label}: ${info.triangles} triangles`);
      assert.ok(info.fit === 1, `${label}: fit ${info.fit}`);
      const m = buildBuildingModel(type, p, '#3070e0', tier);
      for (const mesh of meshesOf(m.root)) assertFinite(mesh.geometry, label);
      m.dispose();
    }
    clearBuildingCaches();
  }
});

test('missing or partial pantheon styles fall back to a neutral look', () => {
  for (const p of [null, undefined, {}, { style: { roof: 'nonsense' } }, { colors: { wall: '#fff' } }]) {
    for (const [type, tier] of VARIANTS) {
      const m = buildBuildingModel(type, p, 0xff0000, tier);
      assert.ok(m.root.isObject3D);
      assert.ok(trianglesOf(m.root) > (BUILDINGS[type].wall ? 30 : 50));
      m.dispose();
    }
  }
});

test('team color drives the team material and is visible on every building', () => {
  const p = PANTHEON_LIST[0];
  for (const [type, tier] of VARIANTS) {
    const m = buildBuildingModel(type, p, teamColors[1] ?? '#2f6fe0', tier);
    const team = meshesOf(m.root).filter((o) => o.name === 'building-team');
    assert.equal(team.length, 1, `${type}${tier}: one team mesh`);
    const c = new THREE.Color(teamColors[1] ?? '#2f6fe0');
    assert.ok(team[0].material.color.equals(c), `${type}: team material color`);
    assert.ok(trianglesOf(team[0]) >= 12, `${type}: team parts are substantial`);
    m.dispose();
  }
  const a = buildBuildingModel('house', p, '#ff0000');
  const b = buildBuildingModel('barracks', p, '#ff0000');
  const c = buildBuildingModel('house', p, '#00ff00');
  const ta = meshesOf(a.root).find((o) => o.name === 'building-team').material;
  const tb = meshesOf(b.root).find((o) => o.name === 'building-team').material;
  const tc = meshesOf(c.root).find((o) => o.name === 'building-team').material;
  assert.equal(ta, tb, 'team materials are shared per color');
  assert.notEqual(ta, tc);
  for (const m of [a, b, c]) m.dispose();
});

test('geometry is cached per (type, style, tier) and shared between instances', () => {
  const p = PANTHEON_LIST[1];
  const a = buildBuildingModel('temple', p, '#ff0000');
  const b = buildBuildingModel('temple', p, '#0000ff');
  const ga = meshesOf(a.root).map((o) => o.geometry);
  const gb = meshesOf(b.root).map((o) => o.geometry);
  assert.deepEqual(ga, gb, 'same geometry objects');
  const body = (m) => meshesOf(m.root).find((o) => o.name === 'building-body').material;
  assert.equal(body(a), body(b), 'body material is shared');
  a.dispose();
  b.dispose();
});

test('construction: progress clips the structure, shows a scaffold and restores on completion', () => {
  for (const p of PANTHEON_LIST.slice(0, 4)) {
    for (const [type, tier] of VARIANTS) {
      const m = buildBuildingModel(type, p, '#e04040', tier);
      const done = meshesOf(m.root).map((o) => o.material);
      const full = trianglesOf(m.root);
      m.setProgress(0);
      let meshes = meshesOf(m.root);
      const scaffold = meshes.find((o) => o.name === 'building-scaffold');
      if (BUILDINGS[type].wall) assert.ok(!scaffold, `${type}: a one-tile segment simply rises out of the ground`);
      else assert.ok(scaffold && scaffold.visible, `${type}: scaffold while building`);
      assert.ok(meshes.length <= MESH_BUDGET, `${type}: ${meshes.length} meshes while building`);
      const body = meshes.find((o) => o.name === 'building-body');
      const cut0 = body.material.userData.uCut.value;
      assert.ok(cut0 > PLINTH && cut0 < m.height * 0.2, `${type}: barely started (${cut0})`);
      assert.equal(body.castShadow, false);
      m.setProgress(0.5);
      const cut5 = body.material.userData.uCut.value;
      assert.ok(cut5 > cut0 && cut5 < m.height, `${type}: half way (${cut5})`);
      m.setProgress(0.8);
      assert.ok(body.material.userData.uCut.value > cut5);
      const glow = meshes.find((o) => o.name === 'building-glow');
      if (glow) assert.equal(glow.visible, false, `${type}: fires stay unlit until finished`);
      m.setProgress(1);
      meshes = meshesOf(m.root);
      assert.ok(!meshes.some((o) => o.name === 'building-scaffold'), `${type}: scaffold removed`);
      assert.deepEqual(meshes.map((o) => o.material), done, `${type}: finished materials restored`);
      assert.equal(trianglesOf(m.root), full);
      m.setProgress(NaN);
      m.setProgress(2);
      m.dispose();
    }
  }
});

test('setTier swaps the town center model in place', () => {
  const p = PANTHEON_LIST[2];
  const m = buildBuildingModel('town_center', p, '#40a0e0', 1);
  const h1 = m.height;
  const t1 = trianglesOf(m.root);
  m.setTier(3);
  const t3 = trianglesOf(m.root);
  assert.ok(t3 > t1, 'city has more detail than the village');
  assert.ok(m.height >= h1);
  m.setProgress(0.3);
  m.setTier(2);
  assert.ok(meshesOf(m.root).some((o) => o.name === 'building-scaffold'), 'construction state survives a tier change');
  m.setProgress(1);
  m.setTier(2);
  m.setTier(99);
  assert.equal(trianglesOf(m.root), t3, 'tiers clamp to 3');
  const house = buildBuildingModel('house', p, '#40a0e0');
  const th = trianglesOf(house.root);
  house.setTier(3);
  assert.equal(trianglesOf(house.root), th, 'setTier is a no-op for other buildings');
  m.dispose();
  house.dispose();
});

// ---- wall segments: one tile, arms to the neighbours that the connection mask names ----

/** Every connection mask a segment can have: neighbours N E S W (low bits), and which of them are towers. */
function* wallMasks() {
  for (let low = 0; low < 16; low++) {
    for (let towers = 0; towers < 16; towers++) {
      if (towers & ~low) continue;
      yield low | (towers << WALL_TOWER_SHIFT);
    }
  }
}

test('wall segments: every neighbour combination builds in budget, with arms that stay within their reach', () => {
  for (const p of PANTHEON_LIST.slice(0, 3)) {
    for (const type of ['wooden_wall', 'stone_wall']) {
      for (const mask of wallMasks()) {
        const label = `${p.id}/${type}/${mask.toString(2)}`;
        const info = getBuildingModelInfo(type, p, 1, mask);
        assert.equal(info.meshes, 2, `${label}: body and team color, two draws a segment`);
        assert.equal(info.level, 1, `${label}: the rounded detailed build fits the budget, no rebuild at the plain level`);
        assert.ok(info.triangles > 30 && info.triangles <= 700, `${label}: ${info.triangles} triangles`);
        assert.equal(info.fit, 1, `${label}: never shrunk`);
        assert.ok(info.extent <= info.limit, `${label}: reaches ${info.extent.toFixed(3)}`);
        assert.ok(info.height > 1 && info.height < 1.6, `${label}: height ${info.height}`);
        const reach = mask >> WALL_TOWER_SHIFT ? 1.05 : mask & 15 ? 0.45 : 0;
        assert.ok(info.extent >= reach, `${label}: the arms reach out (${info.extent.toFixed(3)})`);
      }
    }
  }
  // the rest of the pantheons: the most and the least connected
  for (const p of PANTHEON_LIST) {
    for (const type of ['wooden_wall', 'stone_wall']) {
      for (const mask of [0, WALL_E, WALL_N | WALL_S, 15, 15 | (15 << WALL_TOWER_SHIFT)]) {
        const info = getBuildingModelInfo(type, p, 1, mask);
        assert.ok(info.triangles <= 700 && info.extent <= info.limit && info.fit === 1, `${p.id}/${type}/${mask}`);
      }
    }
  }
});

test('wall segments: arms point to the neighbours the mask names, and run further into a tower', () => {
  const p = PANTHEON_LIST[0];
  for (const type of ['wooden_wall', 'stone_wall']) {
    const box = (mask) => {
      const m = buildBuildingModel(type, p, '#ffffff');
      m.setConnections(mask);
      const b = new THREE.Box3().setFromObject(m.root);
      m.dispose();
      return b;
    };
    const lone = box(0);
    assert.ok(lone.max.x < 0.4 && lone.min.x > -0.4 && lone.max.z < 0.4 && lone.min.z > -0.4, `${type}: a post inside its tile`);
    const e = box(WALL_E);
    assert.ok(e.max.x > 0.45 && e.min.x > -0.4 && e.max.z < 0.4 && e.min.z > -0.4, `${type}: east`);
    const w = box(WALL_W);
    assert.ok(w.min.x < -0.45 && w.max.x < 0.4, `${type}: west`);
    const n = box(WALL_N);
    assert.ok(n.min.z < -0.45 && n.max.z < 0.4 && n.max.x < 0.4, `${type}: north is −z`);
    const s = box(WALL_S);
    assert.ok(s.max.z > 0.45 && s.min.z > -0.4, `${type}: south is +z`);
    const tower = box(WALL_E | (WALL_E << WALL_TOWER_SHIFT));
    assert.ok(tower.max.x > 1.0 && tower.max.x <= 1.11, `${type}: runs on into the tower (${tower.max.x})`);
    // a bend and a cross are the arms together
    const bend = box(WALL_N | WALL_E);
    assert.ok(bend.min.z < -0.45 && bend.max.x > 0.45);
    const cross = box(15);
    assert.ok(cross.min.z < -0.45 && cross.max.z > 0.45 && cross.min.x < -0.45 && cross.max.x > 0.45);
  }
});

test('wall segments: connections swap the geometry in place, cached per mask, and keep a site clipped', () => {
  const p = PANTHEON_LIST[1];
  for (const type of ['wooden_wall', 'stone_wall']) {
    const a = buildBuildingModel(type, p, '#ff0000');
    const b = buildBuildingModel(type, p, '#0000ff');
    const lone = trianglesOf(a.root);
    a.setConnections(WALL_E | WALL_W);
    b.setConnections(WALL_E | WALL_W);
    assert.ok(trianglesOf(a.root) > lone, `${type}: arms add geometry`);
    assert.deepEqual(meshesOf(a.root).map((o) => o.geometry), meshesOf(b.root).map((o) => o.geometry), `${type}: one geometry per mask, shared`);
    const same = trianglesOf(a.root);
    a.setConnections(WALL_E | WALL_W);
    assert.equal(trianglesOf(a.root), same, 'the same mask again changes nothing');
    a.setConnections(WALL_N | WALL_S);
    const ns = meshesOf(a.root).map((o) => o.geometry);
    a.setConnections(WALL_N | WALL_S | 0xff00); // bits beyond the mask are ignored
    assert.deepEqual(meshesOf(a.root).map((o) => o.geometry), ns);
    // a segment under construction stays clipped as its arms change
    a.setProgress(0.4);
    a.setConnections(WALL_E);
    const body = meshesOf(a.root).find((o) => o.name === 'building-body');
    assert.ok(body.material.userData.uCut, `${type}: still clipped while it rises`);
    assert.ok(!meshesOf(a.root).some((o) => o.name === 'building-scaffold'), `${type}: and no scaffold around a one-tile wall`);
    a.setProgress(1);
    assert.ok(!meshesOf(a.root).find((o) => o.name === 'building-body').material.userData.uCut, 'finished: the plain material is back');
    a.setConnections(NaN);
    a.setConnections(undefined);
    for (const m of [a, b]) m.dispose();
  }
  // every other building ignores connections
  const house = buildBuildingModel('house', p, '#40a0e0');
  const th = trianglesOf(house.root);
  house.setConnections(255);
  assert.equal(trianglesOf(house.root), th);
  house.dispose();
});

test('titan gate has an animated vortex; animate and setBuildingTime are safe everywhere', () => {
  for (const p of PANTHEON_LIST) {
    const m = buildBuildingModel('titan_gate', p, '#a040e0');
    const vortex = meshesOf(m.root).find((o) => o.name === 'building-vortex');
    assert.ok(vortex, `${p.id}: vortex`);
    m.animate(0);
    const r0 = vortex.rotation.z;
    m.animate(2.5);
    assert.notEqual(vortex.rotation.z, r0, 'vortex swirls');
    assert.ok(vortex.scale.x > 0.5 && vortex.scale.y > 0.5);
    m.setProgress(0.4);
    assert.equal(vortex.visible, false, 'no portal while building');
    m.setProgress(1);
    assert.equal(vortex.visible, true);
    m.dispose();
  }
  for (const [type, tier] of VARIANTS) {
    const m = buildBuildingModel(type, PANTHEON_LIST[3], '#ffffff', tier);
    m.animate(1.234);
    m.dispose();
  }
  setBuildingTime(42);
});

test('dispose detaches the model and keeps shared caches usable', () => {
  const scene = new THREE.Group();
  const p = PANTHEON_LIST[4];
  const m = buildBuildingModel('barracks', p, '#ffaa00');
  scene.add(m.root);
  m.setProgress(0.5);
  m.dispose();
  assert.equal(m.root.parent, null);
  const again = buildBuildingModel('barracks', p, '#ffaa00');
  assert.ok(trianglesOf(again.root) > 100);
  again.dispose();
  clearBuildingCaches();
  const fresh = buildBuildingModel('barracks', p, '#ffaa00');
  assert.ok(trianglesOf(fresh.root) > 100, 'rebuilds after clearing caches');
  fresh.dispose();
});

test('models sit on their origin: foundation below, nothing far underground', () => {
  for (const [type, tier] of VARIANTS) {
    const m = buildBuildingModel(type, PANTHEON_LIST[5], '#ffffff', tier);
    const box = new THREE.Box3().setFromObject(m.root);
    assert.ok(box.min.y < -0.3 && box.min.y > -1, `${type}: foundation reaches below ground (${box.min.y})`);
    assert.ok(Math.abs(box.max.y - m.height) < 0.6, `${type}: height ${m.height} matches bounds ${box.max.y}`);
    m.dispose();
  }
});

test('gold mine: 3×3 fit, budget and remaining-gold levels', () => {
  const info = getGoldMineInfo();
  assert.equal(info.size, GOLD_MINE.size);
  assert.ok(info.triangles <= TRI_BUDGET);
  const mine = buildGoldMineModel();
  const box = new THREE.Box3().setFromObject(mine.root);
  const lim = GOLD_MINE.size / 2 - 0.1 + 0.01;
  assert.ok(Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z) <= lim, 'mine fits its footprint');
  assert.ok(meshesOf(mine.root).length <= MESH_BUDGET);
  const gold = meshesOf(mine.root).find((o) => o.name === 'mine-gold');
  const tri = () => (gold.visible ? trianglesOf(gold, false) : 0);
  mine.setAmountFraction(1);
  const full = tri();
  mine.setAmountFraction(0.5);
  const half = tri();
  mine.setAmountFraction(0.05);
  const low = tri();
  mine.setAmountFraction(0);
  assert.equal(tri(), 0, 'no gold left, no veins');
  assert.ok(full > half && half > low && low > 0, `gold shrinks (${full}/${half}/${low})`);
  mine.setAmountFraction(NaN);
  mine.animate(3);
  mine.dispose();
});

// ---- the detail levels (quality tiers) and the toolkit's new geometry ----

test('detail levels: both build every roster building in budget, the plain level is the lighter, the detailed one is never degraded', () => {
  const was = getBuildingDetail();
  try {
    const plain = new Map();
    for (const level of [0, 1]) {
      setBuildingDetail(level);
      pruneBuildingCaches();
      for (const p of PANTHEON_LIST) {
        for (const [type, tier] of VARIANTS) {
          const label = `${p.id}/${type}${tier}@${level}`;
          const info = getBuildingModelInfo(type, p, tier);
          const wall = BUILDINGS[type].wall === true;
          assert.equal(info.level, level, `${label}: built at the level asked for, not the fallback`);
          assert.ok(info.triangles > (wall ? 30 : 50) && info.triangles <= TRI_BUDGET, `${label}: ${info.triangles} triangles`);
          assert.ok(info.meshes >= 2 && info.meshes <= MESH_BUDGET, `${label}: ${info.meshes} meshes`);
          assert.equal(info.fit, 1, `${label}: fits its footprint as built`);
          if (level === 0) plain.set(label.slice(0, -2), info.triangles);
          else assert.ok(info.triangles >= plain.get(label.slice(0, -2)), `${label}: the detailed build adds to the plain one`);
        }
      }
    }
  } finally {
    setBuildingDetail(was);
    pruneBuildingCaches();
  }
});

test('detail levels: a model refreshes onto the new level and the old level\'s cache is dropped', () => {
  const was = getBuildingDetail();
  try {
    setBuildingDetail(1);
    const m = buildBuildingModel('house', PANTHEON_LIST[0], '#ff0000');
    const detailed = trianglesOf(m.root);
    assert.equal(setBuildingDetail(0), true);
    assert.equal(setBuildingDetail(0), false, 'no change, no rebuild');
    assert.equal(trianglesOf(m.root), detailed, 'a model keeps its geometry until it refreshes');
    m.refresh();
    assert.ok(trianglesOf(m.root) < detailed, 'the plain level is lighter');
    pruneBuildingCaches();
    setBuildingDetail(1);
    m.refresh();
    assert.equal(trianglesOf(m.root), detailed, 'and back');
    m.dispose();
  } finally {
    setBuildingDetail(was);
    pruneBuildingCaches();
  }
});

test('bevelBox: a rounded box with a square foot, 30 triangles (44 rounded all round), every face turned outward', () => {
  for (const bottom of [false, true]) {
    const g = bevelBox(1, 0.6, 0.8, 0.1, 0, 0, 0, 0, bottom);
    const p = g.attributes.position;
    assert.equal(p.count / 3, bottom ? 44 : 30);
    g.computeBoundingBox();
    const bb = g.boundingBox;
    assert.ok(Math.abs(bb.max.x - 0.5) < 1e-5 && Math.abs(bb.min.x + 0.5) < 1e-5 && Math.abs(bb.max.z - 0.4) < 1e-5);
    assert.ok(Math.abs(bb.min.y) < 1e-5 && Math.abs(bb.max.y - 0.6) < 1e-5, 'stands on y');
    for (let i = 0; i < p.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i);
      const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      const mid = a.clone().add(b).add(c).divideScalar(3).sub(new THREE.Vector3(0, 0.3, 0));
      assert.ok(n.dot(mid) > 0, 'faces point away from the center');
    }
    for (let i = 0; i < g.attributes.normal.count; i++) {
      const n = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, i);
      assert.ok(Math.abs(n.length() - 1) < 1e-4);
    }
  }
});

test('courseSlope: a roof slope in overlapping courses, four triangles a course with a shade per vertex', () => {
  const a0 = [-1, 0, 1], a1 = [1, 0, 1], b0 = [-1, 0.5, 0], b1 = [1, 0.5, 0];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const g = courseSlope(a0, a1, b0, b1, 6, 0.03, { rnd });
  assert.equal(g.attributes.position.count / 3, 6 * 4);
  assert.equal(g.attributes.color.count, g.attributes.position.count);
  let up = 0;
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, i);
    const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
    const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    if (n.y > 0.5) up++;
    assert.ok(n.z > -1e-6, 'every course faces the eave side (+z) or up');
  }
  assert.equal(up, 6 * 2, 'the faces of the courses point up the slope');
  const col = g.attributes.color;
  for (let i = 0; i < col.count; i++) assert.ok(col.getX(i) > 0.3 && col.getX(i) < 1.2);
});

test('shadedTris: per-vertex shades, faces turned away from the reference point', () => {
  const g = shadedTris([[[0, 0, 0], [1, 0, 0], [0, 0, 1], 0.5, 0.75, 1], [[0, 0, 0], [0, 0, 1], [1, 0, 0], 0.5, 1, 0.75]], () => [0.2, -1, 0.2]);
  const p = g.attributes.position;
  assert.equal(p.count, 6);
  for (let i = 0; i < p.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, i);
    const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
    assert.ok(new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).y > 0, 'turned up, away from below');
  }
  assert.deepEqual([...g.attributes.color.array].slice(0, 9), [0.5, 0.5, 0.5, 1, 1, 1, 0.75, 0.75, 0.75], 'a flipped face swaps its shades with its vertices');
});

/** The triangles of a geometry as [a, b, c] vectors. */
function trisOf(g) {
  const p = g.attributes.position;
  const out = [];
  for (let i = 0; i < p.count; i += 3) {
    out.push([0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(p, i + j)));
  }
  return out;
}

test('courseLoft: a roof in courses, faces turned up and butts turned away from the axis, no degenerate triangle', () => {
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const n = 5;
  const g = courseLoft({ cx: 1, cz: -2, y: 0.5, hw: 1, hd: 0.7, tw: 0.1, td: 0.1, h: 0.8, n, per: 2, lip: 0.03, rnd });
  const cols = 8;
  const tris = trisOf(g);
  assert.ok(tris.length === n * cols * 4, `${tris.length} triangles: four a course for each of the ${cols} columns`);
  assert.equal(g.attributes.color.count, g.attributes.position.count);
  let up = 0;
  for (const [a, b, c] of tris) {
    const nrm = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    assert.ok(nrm.length() > 1e-4, 'no sliver');
    nrm.normalize();
    if (nrm.y > 0.05) { up++; continue; }
    const mid = a.clone().add(b).add(c).divideScalar(3);
    assert.ok(nrm.x * (mid.x - 1) + nrm.z * (mid.z + 2) > -1e-6, 'a butt edge faces away from the axis');
  }
  assert.equal(up, n * cols * 2, 'the face of every course points up the slope');
  g.computeBoundingBox();
  const bb = g.boundingBox;
  assert.ok(Math.abs(bb.min.y - 0.5) < 1e-5 && bb.max.y > 1.29 && bb.max.y < 1.3 + 0.031, 'from the eave to the top');
  assert.ok(Math.abs(bb.max.x - 2) < 1e-5 && Math.abs(bb.min.z + 2.7) < 1e-5, 'on the footprint');
  const col = g.attributes.color;
  for (let i = 0; i < col.count; i++) assert.ok(col.getX(i) > 0.2 && col.getX(i) < 1.2, 'shades stay in a sane range');
});

test('courseLoft: a point at the top leaves no sliver, a cap closes a flat top, alt bands the courses', () => {
  const pointed = courseLoft({ y: 0, hw: 1, hd: 1, tw: 0, td: 0, h: 1, n: 4, rnd: () => 0.5 });
  const flat = courseLoft({ y: 0, hw: 1, hd: 1, tw: 0.3, td: 0.3, h: 1, n: 4, cap: true, rnd: () => 0.5 });
  assert.ok(trisOf(pointed).length < 4 * 4 * 4 && trisOf(pointed).length > 3 * 4 * 4, 'the collapsed top ring drops its slivers');
  assert.equal(trisOf(flat).length, 4 * 4 * 4 + 2, 'a cap over four corners is two triangles');
  const banded = courseLoft({ y: 0, hw: 1, hd: 1, tw: 0.2, td: 0.2, h: 1, n: 4, alt: 0.5, tint: 0, shadow: 0, butt: 1, rnd: () => 0.5 });
  const shades = new Set();
  for (let i = 0; i < banded.attributes.color.count; i++) shades.add(banded.attributes.color.getX(i).toFixed(3));
  assert.deepEqual([...shades].sort(), ['0.500', '1.000'], 'every other course is half as bright');
});

test('courseCone: round roofs in courses with smooth normals, a cone or a half ellipsoid', () => {
  let seed = 5;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const seg = 10;
  const n = 4;
  for (const dome of [false, true]) {
    const g = courseCone({ cx: 0.5, cz: 0.25, y: 1, r: 0.8, h: 0.7, seg, n, dome, lip: 0.03, rnd });
    const tris = trisOf(g);
    assert.ok(tris.length <= n * seg * 4 && tris.length > (n - 1) * seg * 4, `${tris.length} triangles`);
    g.computeBoundingBox();
    const bb = g.boundingBox;
    assert.ok(Math.abs(bb.min.y - 1) < 1e-5 && bb.max.y > 1.69 - 1e-5 && bb.max.y < 1.7 + 0.031, `the ${dome ? 'dome' : 'cone'} stands on y and rises to its height`);
    assert.ok(bb.max.x <= 0.5 + 0.8 + 1e-5 && bb.max.x > 0.5 + 0.7, 'on its radius');
    const nor = g.attributes.normal;
    const pos = g.attributes.position;
    assert.equal(nor.count, pos.count, 'every vertex has a normal');
    let smooth = 0;
    for (let i = 0; i < nor.count; i++) {
      const nv = new THREE.Vector3().fromBufferAttribute(nor, i);
      assert.ok(Math.abs(nv.length() - 1) < 1e-4, 'unit normals');
      const out = nv.x * (pos.getX(i) - 0.5) + nv.z * (pos.getZ(i) - 0.25);
      assert.ok(out > -1e-6, 'the normals point outward');
      if (nv.y > 0.05) smooth++;
    }
    assert.ok(smooth > 0, 'the faces are smooth-shaded up and outward');
  }
});

test('bevelFrustum: a battered block with rounded edges, narrower toward the top, normals tilted up with the batter', () => {
  const w = 1;
  const h = 0.8;
  const d = 0.6;
  const g = bevelFrustum(w, h, d, 0.8, 0.05, 2, 1, 3);
  assert.equal(g.attributes.position.count / 3, 30);
  const p = g.attributes.position;
  const n = g.attributes.normal;
  let foot = 0;
  let head = 0;
  let tilted = 0;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) - 1;
    const x = Math.abs(p.getX(i) - 2);
    if (y < 0.04 * h) foot = Math.max(foot, x);
    if (y > 0.96 * h) head = Math.max(head, x);
    const nv = new THREE.Vector3().fromBufferAttribute(n, i);
    assert.ok(Math.abs(nv.length() - 1) < 1e-4, 'unit normals');
    if (nv.z > 0.9 && nv.y > 0.01) tilted++;
  }
  assert.ok(Math.abs(foot - w / 2) < 1e-4, 'the foot keeps its width');
  assert.ok(head < w / 2 * 0.8 + 1e-4 && head > w / 2 * 0.6, `the top is drawn in (${head.toFixed(3)})`);
  assert.ok(tilted > 0, 'a battered face leans back, its normal rises');
  g.computeBoundingBox();
  assert.ok(Math.abs(g.boundingBox.min.y - 1) < 1e-5 && Math.abs(g.boundingBox.max.y - 1.8) < 1e-5, 'stands on y');
  const straight = bevelFrustum(w, h, d, 1, 0.05);
  const box = bevelBox(w, h, d, 0.05);
  for (let i = 0; i < box.attributes.position.count; i++) {
    assert.ok(Math.abs(straight.attributes.position.getX(i) - box.attributes.position.getX(i)) < 1e-6, 'no batter, no change');
  }
});

// ---- team color ----

/**
 * The share (0 to 1) of a model's team-colored area, on the faces that turn toward the game camera
 * (pitched 55 degrees, looking north), that nothing stands in front of.
 */
function visibleTeamShare(model) {
  model.root.updateMatrixWorld(true);
  const meshes = meshesOf(model.root).filter((o) => o.visible);
  const team = meshes.find((o) => o.name === 'building-team');
  if (!team) return 0;
  const pitch = (55 * Math.PI) / 180;
  const dir = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch));
  const ray = new THREE.Raycaster();
  const pos = team.geometry.attributes.position;
  const idx = team.geometry.index;
  const count = (idx ? idx.count : pos.count) / 3;
  const step = Math.max(1, Math.floor(count / 400));
  const [a, b, c, n] = [0, 1, 2, 3].map(() => new THREE.Vector3());
  let seen = 0;
  let all = 0;
  for (let t = 0; t < count; t += step) {
    const at = (j) => (idx ? idx.getX(t * 3 + j) : t * 3 + j);
    a.fromBufferAttribute(pos, at(0)).applyMatrix4(team.matrixWorld);
    b.fromBufferAttribute(pos, at(1)).applyMatrix4(team.matrixWorld);
    c.fromBufferAttribute(pos, at(2)).applyMatrix4(team.matrixWorld);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    const area = n.length() / 2;
    if (n.normalize().dot(dir) >= 0) continue;
    all += area;
    ray.set(a.clone().add(b).add(c).divideScalar(3).addScaledVector(dir, -8), dir);
    const first = ray.intersectObjects(meshes, false)[0];
    if (first && (first.object === team || Math.abs(first.distance - 8) < 0.02)) seen += area;
  }
  return all ? seen / all : 0;
}

test('team color: every building shows some of it to the game camera, and the Celtic round roofs keep their band above the thatch courses', () => {
  const celtic = PANTHEON_LIST.find((q) => q.id === 'celtic');
  const banded = ['house', 'manor', 'barracks', 'town_center1', 'town_center2', 'town_center3', 'temple', 'tower'];
  for (const p of PANTHEON_LIST) {
    for (const [type, tier] of VARIANTS) {
      if (BUILDINGS[type].wall) continue; // a wall segment is team color in its own mesh, along both faces
      const m = buildBuildingModel(type, p, '#ff00ff');
      if (tier > 1) m.setTier(tier);
      const share = visibleTeamShare(m);
      assert.ok(share >= 0.03, `${p.id}/${type}${tier}: ${(share * 100).toFixed(0)}% of its team color shows`);
      if (p === celtic && banded.includes(`${type}${type === 'town_center' ? tier : ''}`)) {
        assert.ok(share >= 0.9, `${p.id}/${type}${tier}: the roof band stands clear of the courses (${(share * 100).toFixed(0)}% shows)`);
      }
      m.dispose();
    }
  }
});

// ---- the light of a lookout ----

test('the watch tower lights a lamp on its lookout at the detailed level, and the plain level draws none', () => {
  const was = getBuildingDetail();
  try {
    for (const p of PANTHEON_LIST) {
      const glowTriangles = (level) => {
        setBuildingDetail(level);
        pruneBuildingCaches();
        const m = buildBuildingModel('tower', p, '#ff0000');
        const g = meshesOf(m.root).find((o) => o.name === 'building-glow');
        const n = g ? g.geometry.attributes.position.count / 3 : 0;
        m.dispose();
        return n;
      };
      const plain = glowTriangles(0);
      assert.ok(glowTriangles(1) >= plain + 12, `${p.id}: the lookout has a lit lamp at the detailed level`);
    }
  } finally {
    setBuildingDetail(was);
    pruneBuildingCaches();
  }
});
