// Tests for the procedural unit models (src/render/models/unit-models.js):
// every unit type and every visual vocabulary value builds, stays inside the
// triangle / mesh budgets, has sane proportions, animates every state without
// producing NaNs, and shares cached geometry and materials between instances.
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
  buildUnitModel, getUnitModelInfo, preloadUnitModels, clearUnitModelCache, getUnitMaterial, AIR_HOVER_HEIGHT,
} = await import('../../src/render/models/unit-models.js');
const { UNITS, MORTALS } = await import('../../src/data/index.js');
const { BODIES, HEADS, HEADGEAR, WEAPONS, OFFHANDS, EXTRAS } = await import('../../src/data/schema.js');
const { PLAYER_COLORS } = await import('../../src/config.js');

const BUDGET = { mortal: 500, god: 1200, titan: 2000, creature: 1200, minion: 1200 };
const STATES = ['idle', 'move', 'attack', 'gather', 'return', 'build', 'pray', 'cast', 'dead'];

const unitClass = (u) => (MORTALS[u.id] ? 'mortal' : u.class || 'creature');

/** Synthetic unit type exercising one visual setup. */
function syn(id, visual, opt = {}) {
  return {
    id: `test_${id}`, name: id, class: opt.class || 'creature', air: !!opt.air, speed: 2.6, radius: 0.4,
    attack: { damage: 10, range: opt.proj ? 5 : 0.5, cooldown: 1.4, projectile: opt.proj || null },
    visual: {
      body: 'humanoid', scale: 1.2, colors: { skin: '#d8a880', primary: '#6a4aa8', secondary: '#e0c060', accent: '#c8ccd4' },
      head: 'human', headgear: 'none', weapon: 'none', offhand: 'none', extras: [], aura: null, ...visual,
    },
  };
}

/** One synthetic type per vocabulary value (plus a few combinations). */
function syntheticTypes() {
  const out = [];
  const bodyHead = { quadruped: 'wolf', serpent: 'serpent', bird: 'bird', insect: 'none', hydra: 'serpent', dragon: 'dragon', elephant: 'elephant', ram: 'none', beast_biped: 'monkey', spirit: 'skull' };
  for (const b of BODIES) out.push(syn(`body_${b}`, { body: b, head: bodyHead[b] || 'human', heads: b === 'hydra' ? 5 : undefined }, { air: b === 'bird' }));
  out.push(syn('body_dragon_winged', { body: 'dragon', head: 'dragon', extras: ['wings', 'spikes'] }));
  out.push(syn('body_pegasus', { body: 'quadruped', head: 'horse', extras: ['wings', 'mane', 'tail'] }, { air: true }));
  out.push(syn('body_scorpion_man', { body: 'insect', head: 'human', weapon: 'spear', extras: ['tail'] }));
  for (const h of HEADS) {
    out.push(syn(`head_${h}`, { head: h }));
    out.push(syn(`quadhead_${h}`, { body: 'quadruped', head: h, extras: ['tail'] }));
  }
  for (const g of HEADGEAR) out.push(syn(`gear_${g}`, { headgear: g, extras: ['long_hair'] }));
  for (const w of WEAPONS) out.push(syn(`weapon_${w}`, { weapon: w }, { proj: w === 'bow' ? 'arrow' : null }));
  for (const o of OFFHANDS) out.push(syn(`offhand_${o}`, { offhand: o, weapon: 'sword' }));
  for (const e of EXTRAS) {
    out.push(syn(`extra_${e}`, { extras: [e], aura: e === 'aura_ring' ? '#ffd84a' : null }));
    out.push(syn(`quadextra_${e}`, { body: 'quadruped', head: 'lion', extras: [e, 'tail'] }));
  }
  out.push(syn('three_heads', { heads: 3, extras: ['multi_arms', 'aura_ring'], aura: '#ff8040' }, { class: 'god' }));
  return out;
}

function assertFiniteTree(root, label) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    for (const v of [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()]) {
      assert.ok(Number.isFinite(v), `${label}: non-finite transform on ${o.name}`);
    }
    if (o.morphTargetInfluences) {
      for (const v of o.morphTargetInfluences) assert.ok(Number.isFinite(v), `${label}: non-finite morph influence on ${o.name}`);
    }
  });
}

function runStates(model, label) {
  for (const st of STATES) {
    model.animate('idle', 0, 0, {});
    for (let i = 0; i < 40; i++) {
      const t = i / 30;
      const ex = { moving: st === 'move' || st === 'return', level: 2, carry: st === 'return' ? (i % 2 ? 'g' : 'w') : 0 };
      if (st === 'attack') ex.attackPhase = i < 20 ? i / 20 : undefined;
      model.animate(st, t, 1 / 30, ex);
    }
    assertFiniteTree(model.root, `${label}/${st}`);
  }
}

test('every data unit type builds within its budget', () => {
  const types = Object.values(UNITS);
  assert.ok(types.length >= 85);
  for (const u of types) {
    const info = getUnitModelInfo(u);
    const budget = BUDGET[unitClass(u)];
    assert.ok(info.triangles > 20, `${u.id}: suspiciously few triangles`);
    assert.ok(info.triangles <= budget, `${u.id}: ${info.triangles} triangles > ${budget}`);
    assert.ok(info.meshes <= 8, `${u.id}: ${info.meshes} meshes`);
    assert.ok(info.height > 0.3 && info.height < 12, `${u.id}: height ${info.height}`);
  }
});

test('every visual vocabulary value builds and animates', () => {
  const types = syntheticTypes();
  const seen = { body: new Set(), head: new Set(), headgear: new Set(), weapon: new Set(), offhand: new Set(), extra: new Set() };
  for (const u of types) {
    const v = u.visual;
    seen.body.add(v.body); seen.head.add(v.head); seen.headgear.add(v.headgear);
    seen.weapon.add(v.weapon); seen.offhand.add(v.offhand);
    for (const e of v.extras) seen.extra.add(e);
    const model = buildUnitModel(u, PLAYER_COLORS[1]);
    assert.ok(model.root instanceof THREE.Group, u.id);
    assert.ok(model.height > 0.2, `${u.id}: height ${model.height}`);
    const info = getUnitModelInfo(u);
    assert.ok(info.triangles <= 2000, `${u.id}: ${info.triangles} triangles`);
    assert.ok(info.meshes <= 8, `${u.id}: ${info.meshes} meshes`);
    runStates(model, u.id);
    model.dispose();
  }
  assert.deepEqual([...seen.body].sort(), [...BODIES].sort());
  assert.deepEqual([...seen.head].sort(), [...HEADS].sort());
  assert.deepEqual([...seen.headgear].sort(), [...HEADGEAR].sort());
  assert.deepEqual([...seen.weapon].sort(), [...WEAPONS].sort());
  assert.deepEqual([...seen.offhand].sort(), [...OFFHANDS].sort());
  assert.deepEqual([...seen.extra].sort(), [...EXTRAS].sort());
});

test('every data unit animates every state without NaNs', () => {
  for (const u of Object.values(UNITS)) {
    const model = buildUnitModel(u, PLAYER_COLORS[0]);
    runStates(model, u.id);
    model.dispose();
  }
});

test('proportions: humanoid scale 1 is about 1.1 tall, worshipper about 0.95', () => {
  const warrior = buildUnitModel(UNITS.warrior, PLAYER_COLORS[0]);
  assert.ok(warrior.height > 1.0 && warrior.height < 1.3, `warrior ${warrior.height}`);
  const worker = buildUnitModel(UNITS.worshipper, PLAYER_COLORS[0]);
  assert.ok(worker.height > 0.85 && worker.height < 1.08, `worshipper ${worker.height}`);
  // titans are colossal: tall, or (crocodiles, serpents) very long
  for (const u of Object.values(UNITS)) {
    if (u.class !== 'titan') continue;
    const m = buildUnitModel(u, PLAYER_COLORS[0]);
    m.animate('idle', 0, 0, {});
    const size = new THREE.Box3().setFromObject(m.root, true).getSize(new THREE.Vector3());
    assert.ok(Math.max(m.height, size.x, size.z) > 2.5, `${u.id} titan size ${m.height} / ${size.x}`);
    m.dispose();
  }
});

test('air units hover and report their full height', () => {
  const flyers = Object.values(UNITS).filter((u) => u.air);
  assert.ok(flyers.length > 0);
  for (const u of flyers) {
    const m = buildUnitModel(u, PLAYER_COLORS[2]);
    m.animate('idle', 1, 1 / 30, {});
    let rig = null;
    m.root.traverse((o) => {
      if (!rig && o !== m.root && o.isGroup) rig = o;
    });
    assert.ok(rig.position.y > AIR_HOVER_HEIGHT - 0.4, `${u.id} hovers at ${rig.position.y}`);
    assert.ok(m.height > AIR_HOVER_HEIGHT, `${u.id} height ${m.height} includes the hover`);
    m.dispose();
  }
});

test('models face +X with their feet at the origin', () => {
  const m = buildUnitModel(UNITS.warrior, PLAYER_COLORS[0]);
  m.animate('idle', 0, 0, {});
  m.root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m.root, true);
  assert.ok(Math.abs(box.min.y) < 0.08, `feet at ${box.min.y}`);
  // the head (topmost part of the torso mesh) sits forward of the body's back
  const torso = m.root.getObjectByName('torso');
  const tb = new THREE.Box3().setFromObject(torso, true);
  assert.ok(tb.max.x > Math.abs(tb.min.x) * 0.5, 'torso extends toward +X');
  m.dispose();
});

test('death topples and sinks the model within ~1.6 s', () => {
  const m = buildUnitModel(UNITS.greek_zeus, PLAYER_COLORS[0]);
  m.animate('idle', 0, 0, {});
  let t = 0;
  for (; t < 1.7; t += 1 / 30) m.animate('dead', t, 1 / 30, {});
  let rig = null;
  m.root.traverse((o) => {
    if (!rig && o !== m.root && o.isGroup) rig = o;
  });
  assert.ok(Math.abs(rig.rotation.x) > 1, 'toppled');
  assert.ok(rig.position.y < -0.3, `sunk to ${rig.position.y}`);
  m.dispose();
});

test('instances share cached geometry and per-team materials; dispose keeps shared data', () => {
  const a = buildUnitModel(UNITS.warrior, PLAYER_COLORS[0]);
  const b = buildUnitModel(UNITS.warrior, PLAYER_COLORS[0]);
  const c = buildUnitModel(UNITS.warrior, PLAYER_COLORS[1]);
  const meshes = (m) => {
    const out = [];
    m.root.traverse((o) => {
      if (o.isMesh) out.push(o);
    });
    return out;
  };
  const ma = meshes(a);
  const mb = meshes(b);
  const mc = meshes(c);
  assert.equal(ma.length, mb.length);
  for (let i = 0; i < ma.length; i++) {
    assert.equal(ma[i].geometry, mb[i].geometry, 'geometry shared');
    assert.equal(ma[i].material, mb[i].material, 'material shared per team color');
    assert.notEqual(ma[i].material, mc[i].material, 'different team colors use different materials');
  }
  assert.equal(getUnitMaterial(PLAYER_COLORS[0], 0), getUnitMaterial(PLAYER_COLORS[0], 0));
  let disposed = 0;
  for (const o of ma) o.geometry.addEventListener('dispose', () => disposed++);
  a.dispose();
  assert.equal(disposed, 0, 'dispose() must not dispose shared geometry');
  assert.equal(a.root.parent, null);
  b.animate('move', 1, 1 / 30, { moving: true });
  const d = buildUnitModel(UNITS.warrior, PLAYER_COLORS[0]);
  assert.equal(meshes(d)[0].geometry, mb[0].geometry);
  b.dispose();
  c.dispose();
  d.dispose();
});

test('workers swap tools and show cargo', () => {
  const m = buildUnitModel(UNITS.worshipper, PLAYER_COLORS[3]);
  const visibleMeshes = () => {
    let n = 0;
    m.root.traverseVisible((o) => {
      if (o.isMesh) n++;
    });
    return n;
  };
  m.animate('idle', 0, 1 / 30, {});
  const idle = visibleMeshes();
  m.animate('return', 0.1, 1 / 30, { moving: true, carry: 'w' });
  assert.equal(visibleMeshes(), idle + 1, 'cargo visible while returning');
  const arm = m.root.getObjectByName('armR');
  const bare = arm.geometry;
  m.animate('gather', 0.2, 1 / 30, { gather: 'w' });
  assert.notEqual(arm.geometry, bare, 'tool in hand while gathering');
  m.animate('build', 0.3, 1 / 30, {});
  const hammer = arm.geometry;
  m.animate('gather', 0.4, 1 / 30, { gather: 'g' });
  assert.notEqual(arm.geometry, hammer, 'pick for gold differs from the hammer');
  m.animate('idle', 0.5, 1 / 30, {});
  assert.equal(arm.geometry, bare, 'tool put away');
  m.dispose();
});

test('preload and cache clearing rebuild cleanly', () => {
  preloadUnitModels(Object.values(MORTALS));
  clearUnitModelCache();
  const m = buildUnitModel(UNITS.archer, PLAYER_COLORS[4]);
  runStates(m, 'archer after clear');
  m.dispose();
});
