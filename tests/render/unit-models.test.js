// Tests for the procedural unit models (src/render/models/unit-models.js):
// every unit type and every visual vocabulary value builds, stays inside the
// triangle / mesh budgets, has sane proportions, animates every state without
// producing NaNs, shares cached geometry and materials between instances, and
// carries per-vertex surface classes (roughness / metalness) and baked AO.
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
const { UNITS, MORTALS, PANTHEON_LIST } = await import('../../src/data/index.js');
const { unitLook } = await import('../../src/render/models/unit-looks.js');
const { BODIES, HEADS, HEADGEAR, WEAPONS, OFFHANDS, EXTRAS } = await import('../../src/data/schema.js');
const { PLAYER_COLORS } = await import('../../src/config.js');

// Mortals and gods have rounded, smooth-shaded limbs and layered clothing.
// Even a full army (~100 mortals on screen) stays near 100k triangles, and the
// draw-call budget (meshes per unit) is unchanged. Gods carry layered
// pauldrons, bracers and a pantheon piece (collar, halo, banners ...); a
// player fields one or two at a time, so their extra hundred triangles is
// noise next to an army.
const BUDGET = { mortal: 1000, god: 1500, titan: 2000, creature: 1200, minion: 1200 };
const STATES = ['idle', 'move', 'attack', 'gather', 'return', 'build', 'pray', 'cast', 'dead'];

const unitClass = (u) => (MORTALS[u.id] || u.mortal ? 'mortal' : u.class || 'creature'); // a pantheon's elite soldier is dressed as a mortal

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

test('pose objects keep a fixed key set and explicit blends cover every model', () => {
  // unit-anim.js never deletes pose keys (dictionary-mode objects allocate on
  // every number store): each frame must write the same keys, and every model
  // kind's keys must match one of its POSE_GROUPS (else it falls back to the
  // slower generic blend).
  for (const u of Object.values(UNITS)) {
    const m = buildUnitModel(u, PLAYER_COLORS[1]);
    let keys = null;
    let t = 3;
    for (const st of STATES) {
      for (let i = 0; i < 6; i++) {
        t += 1 / 30;
        m.animate(st, t, 1 / 30, { moving: i % 2 === 1, attackPhase: st === 'attack' ? i / 6 : undefined, carry: st === 'return' ? 'g' : 0, gather: i % 3 ? 'g' : 'w' });
        const k = Object.keys(m.target).join(',');
        if (keys === null) keys = k;
        assert.equal(k, keys, `${u.id}: target pose keys changed in state ${st}`);
        assert.equal(Object.keys(m.cur).join(','), keys, `${u.id}: current pose keys differ from the target's`);
      }
    }
    assert.ok(Array.isArray(m.blendFns), `${u.id} (${m.kind}) uses the generic blend; add its keys to POSE_GROUPS in unit-anim.js`);
    m.dispose();
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
  // (the parts are joined into one skinned mesh: the torso's own vertices, posed by its bone)
  const torsoGeo = m.template.parts.find((p) => p.name === 'torso').geo;
  const tb = new THREE.Box3().setFromBufferAttribute(torsoGeo.attributes.position)
    .applyMatrix4(new THREE.Matrix4().multiplyMatrices(m.rigGroup.matrixWorld, m.joined.rel.get(m.parts.torso)));
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

test('unit surfaces carry material classes and baked occlusion', () => {
  let metalUnits = 0;
  for (const u of Object.values(UNITS)) {
    const m = buildUnitModel(u, PLAYER_COLORS[2]);
    let metal = 0;
    m.root.traverse((o) => {
      if (!o.isMesh || o.name === 'aura' || o.name === 'shadow') return;
      const { position, aFx, aAo } = o.geometry.attributes;
      assert.ok(aFx && aFx.itemSize === 4 && aFx.count === position.count, `${u.id}/${o.name}: aFx is (team, glow, roughness, metalness)`);
      assert.ok(aAo && aAo.itemSize === 1 && aAo.count === position.count, `${u.id}/${o.name}: aAo per vertex`);
      for (let i = 0; i < aFx.count; i++) {
        const r = aFx.getZ(i);
        const mt = aFx.getW(i);
        const ao = aAo.getX(i);
        assert.ok(r > 0.1 && r <= 1 && mt >= 0 && mt < 1, `${u.id}/${o.name}: roughness ${r} metalness ${mt}`);
        assert.ok(ao >= 0.2 && ao <= 1, `${u.id}/${o.name}: occlusion ${ao}`);
        if (mt > 0) metal++;
      }
    });
    if (metal) metalUnits++;
    m.dispose();
  }
  assert.ok(metalUnits > Object.keys(UNITS).length / 3, `only ${metalUnits} unit types show any metal`);
});

test('unit material: PBR shader patch survives fade clones', () => {
  const mat = getUnitMaterial(PLAYER_COLORS[5], 0);
  assert.ok(mat.isMeshStandardMaterial && mat.vertexColors && !mat.flatShading, 'smooth shaded: geometry carries creased normals');
  const compile = (m) => {
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    m.onBeforeCompile(shader, null);
    return shader;
  };
  const s = compile(mat);
  for (const part of ['attribute vec4 aFx', 'attribute float aAo', 'uTeamColor', 'vDirectionalShadowCoord[ i ].z -= unitShadowReach']) {
    assert.ok(s.vertexShader.includes(part), part);
  }
  for (const part of [
    'roughnessFactor *= vUnitFx.y', 'metalnessFactor *= vUnitFx.z', 'unitGlow', 'unitAo', 'unitHue', 'uUnitSheen',
    'reflectVec.y = abs', 'vec3( 0.2126, 0.7152, 0.0722 ) ) ), 0.7 )', 'radiance += iblRadiance * ( 1.0 + uUnitLook.z',
    'shadowIntensity * 0.85', 'cloudShade', 'uRimStrength', 'if ( directLight.visible ) RE_Direct(',
  ]) {
    assert.ok(s.fragmentShader.includes(part), part);
  }
  for (const chunk of ['lights_fragment_begin', 'lights_fragment_maps', 'envmap_physical_pars_fragment']) {
    assert.ok(!s.fragmentShader.includes(`#include <${chunk}>`), `${chunk} replaced`);
  }
  assert.ok(!s.vertexShader.includes('#include <shadowmap_vertex>'), 'shadowmap_vertex replaced');
  assert.equal(s.uniforms.uTeamColor, mat.userData.uTeamColor, 'team color uniform shared through userData');
  // unit-fade.js clones the material and shares userData and both hooks
  const fade = mat.clone();
  fade.userData = mat.userData;
  fade.onBeforeCompile = mat.onBeforeCompile;
  fade.customProgramCacheKey = mat.customProgramCacheKey;
  fade.alphaHash = true;
  const f = compile(fade);
  assert.equal(f.fragmentShader, s.fragmentShader);
  assert.equal(f.uniforms.uTeamColor, s.uniforms.uTeamColor);
  assert.equal(f.uniforms.uUnitLook, s.uniforms.uUnitLook);
  assert.equal(fade.customProgramCacheKey(), mat.customProgramCacheKey());
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
  // the right arm's variants are bones of the joined mesh: the one in hand has the arm's pose, the rest a zero matrix
  const arm = () => {
    const { skeleton } = m.joined;
    const shown = skeleton.bones.filter((b) => b.name.startsWith('armR') && b.matrixWorld.elements.some((v) => v !== 0));
    assert.equal(shown.length, 1, 'one right arm at a time');
    const i = skeleton.bones.indexOf(shown[0]);
    assert.deepEqual([...skeleton.boneMatrices.subarray(i * 16, i * 16 + 16)], shown[0].matrixWorld.elements.map(Math.fround));
    return shown[0].name;
  };
  const bare = arm();
  assert.equal(bare, 'armR:none');
  m.animate('gather', 0.2, 1 / 30, { gather: 'w' });
  assert.equal(arm(), 'armR:axe', 'tool in hand while gathering');
  m.animate('build', 0.3, 1 / 30, {});
  assert.equal(arm(), 'armR:hammer');
  m.animate('gather', 0.4, 1 / 30, { gather: 'g' });
  assert.equal(arm(), 'armR:pick', 'pick for gold differs from the hammer');
  m.animate('idle', 0.5, 1 / 30, {});
  assert.equal(arm(), bare, 'tool put away');
  m.dispose();
});

test('a low-poly unit draws its rigid parts in one call, and the joined mesh is posed as the parts were', () => {
  const drawn = (m) => {
    const out = [];
    m.root.traverse((o) => {
      if (o.isMesh && o.name !== 'aura' && o.name !== 'shadow' && o !== m.carryMesh) out.push(o);
    });
    return out;
  };
  let joined = 0;
  for (const u of Object.values(UNITS)) {
    if (!u.visual) continue;
    const m = buildUnitModel(u, PLAYER_COLORS[2]);
    const tpl = m.template;
    const solid = tpl.parts.filter((p) => p.geo && !p.ghost).length;
    const ghosts = tpl.parts.filter((p) => p.geo && p.ghost).length;
    // one draw for every solid part together (a single-part body is drawn as it was), one per see-through part
    assert.equal(drawn(m).length, (solid > 1 ? 1 : solid) + ghosts, `${u.id} draws`);
    if (m.joined) {
      joined++;
      const mat = m.joined.mesh.material;
      assert.ok(m.joined.mesh.isSkinnedMesh && !mat.transparent, `${u.id} is one solid skinned mesh`);
      assert.equal(m.joined.mesh.morphTargetInfluences.length % 4, 0, 'joint slots padded to a shared program size');
    }
    m.dispose();
  }
  assert.ok(joined > 80, `most unit types are joined (${joined})`);

  // every vertex of the joined mesh sits where its part, posed and bent by its own joint morphs, would put it
  for (const [id, st, ex] of [['warrior', 'attack', { attackPhase: 0.4 }], ['worshipper', 'gather', { gather: 'w' }], ['archer', 'move', { moving: true }],
    ['greek_pegasus', 'move', { moving: true }], ['norse_wolf_of_fenrir', 'attack', { attackPhase: 0.3 }]]) {
    const u = UNITS[id];
    if (!u) continue;
    const m = buildUnitModel(u, PLAYER_COLORS[1]);
    for (let t = 0; t < 0.5; t += 1 / 30) m.animate(st, t, 1 / 30, ex);
    m.root.updateMatrixWorld(true);
    const mesh = m.joined.mesh;
    const si = mesh.geometry.attributes.skinIndex;
    const geos = [];
    for (const p of m.template.parts) if (p.geo && !p.ghost) geos.push({ part: p.name, geo: p.geo, tool: p.name === 'armR' && m.rig.tools ? 'none' : undefined });
    for (const kind of Object.keys(m.rig.tools || {})) if (!geos.some((g) => g.geo === m.rig.tools[kind])) geos.push({ part: 'armR', geo: m.rig.tools[kind], tool: kind });
    const got = new THREE.Vector3();
    const want = new THREE.Vector3();
    let off = 0;
    let checked = 0;
    for (const g of geos) {
      const n = g.geo.attributes.position.count;
      const hidden = g.tool !== undefined && g.tool !== m.toolKind;
      const part = m.parts[g.part];
      const toWorld = new THREE.Matrix4().multiplyMatrices(m.rigGroup.matrixWorld, m.joined.rel.get(part));
      for (let i = 0; i < n; i += 7) {
        assert.equal(si.getX(off + i), m.joined.skeleton.bones.findIndex((b) => b.name === (g.tool ? `armR:${g.tool}` : g.part)));
        mesh.getVertexPosition(off + i, got).applyMatrix4(mesh.matrixWorld);
        want.fromBufferAttribute(g.geo.attributes.position, i);
        (g.geo.userData.morphNames || []).forEach((name, k) => {
          const w = part.morphTargetInfluences[part.morphTargetDictionary[name]];
          want.addScaledVector(new THREE.Vector3().fromBufferAttribute(g.geo.morphAttributes.position[k], i), w);
        });
        if (hidden) want.set(0, 0, 0).applyMatrix4(mesh.matrixWorld);
        else want.applyMatrix4(toWorld);
        assert.ok(got.distanceTo(want) < 1e-4, `${id} ${g.part}${g.tool ? `:${g.tool}` : ''} vertex ${i}: ${got.toArray()} vs ${want.toArray()}`);
        checked++;
      }
      off += n;
    }
    assert.equal(off, mesh.geometry.attributes.position.count);
    assert.ok(checked > 50);
    // the joints really bend: some part has a non-zero joint influence in these states
    assert.ok(mesh.morphTargetInfluences.some((w) => Math.abs(w) > 0.05), `${id} bends a joint`);
    m.dispose();
  }
});

test('preload and cache clearing rebuild cleanly', () => {
  preloadUnitModels(Object.values(MORTALS));
  const aoOf = (u) => {
    const m = buildUnitModel(u, PLAYER_COLORS[4]);
    const out = new Map();
    m.root.traverse((o) => {
      if (o.isMesh && o.geometry.attributes.aAo) out.set(o.name, o.geometry.attributes.aAo);
    });
    m.dispose();
    return out;
  };
  const before = aoOf(UNITS.worshipper);
  clearUnitModelCache();
  const m = buildUnitModel(UNITS.archer, PLAYER_COLORS[4]);
  runStates(m, 'archer after clear');
  m.dispose();
  // rebuilt templates get the occlusion baked before the clear (not a blank one)
  const after = aoOf(UNITS.worshipper);
  assert.equal(after.size, before.size);
  assert.ok([...after.values()].some((a) => a.array.some((v) => v < 0.95)), 'occlusion is baked');
  for (const [name, attr] of after) {
    assert.notEqual(attr, before.get(name), `${name}: new geometry after the clear`);
    assert.deepEqual([...attr.array], [...before.get(name).array], `${name}: same baked occlusion`);
  }
});

test('unit geometry: creased normals round limbs, keep box edges hard, and bend with morphs', async () => {
  const { creasedNormals, SMOOTH_CREASE, PartBuilder, cyl, box, T } = await import('../../src/render/models/unit-geo.js');
  const normalsOf = (g, crease) => creasedNormals(g.attributes.position.array, [[0, g.attributes.position.count, Math.cos(crease)]]);
  // 8-sided limb: the side normals of a corner shared by two faces agree (smooth)
  const c = cyl(1, 1, 1, 8, true);
  const n = normalsOf(c, SMOOTH_CREASE);
  const pos = c.attributes.position.array;
  const byPos = new Map();
  for (let i = 0; i < pos.length / 3; i++) {
    const k = `${pos[i * 3].toFixed(3)},${pos[i * 3 + 1].toFixed(3)},${pos[i * 3 + 2].toFixed(3)}`;
    (byPos.get(k) || byPos.set(k, []).get(k)).push([n[i * 3], n[i * 3 + 1], n[i * 3 + 2]]);
  }
  for (const list of byPos.values()) for (const v of list) assert.ok(Math.abs(v[0] - list[0][0]) + Math.abs(v[2] - list[0][2]) < 1e-5, 'smooth limb');
  // box: every normal stays axis aligned (90° edges are creases)
  const bn = normalsOf(box(1, 1, 1), SMOOTH_CREASE);
  for (let i = 0; i < bn.length; i += 3) assert.ok(Math.max(Math.abs(bn[i]), Math.abs(bn[i + 1]), Math.abs(bn[i + 2])) > 0.999, 'hard box edge');
  // a morph that turns a piece upside down (half a turn about z) turns its normals with it
  const b = new PartBuilder();
  const g = cyl(0.1, 0.1, 0.5, 6);
  T(g, [0, 0.25, 0]);
  b.add(g, '#888888', { morph: { flip: (p, out) => out.set(-2 * p.x, -2 * p.y, 0) } });
  const geo = b.build();
  assert.equal(geo.morphAttributes.normal.length, geo.morphAttributes.position.length);
  const N = geo.attributes.normal.array;
  const dN = geo.morphAttributes.normal[0].array;
  for (let i = 0; i < N.length; i += 3) {
    assert.ok(Math.abs(N[i] + dN[i] + N[i]) < 1e-4 && Math.abs(N[i + 1] + dN[i + 1] + N[i + 1]) < 1e-4, 'x / y normals turn with the piece');
  }
});

test('pantheon looks: a mortal dressed by its pantheon keeps its stats, builds within the mortal budget and caches apart from the plain one', () => {
  const plain = UNITS.warrior;
  assert.equal(unitLook(plain, null), plain);
  assert.equal(unitLook(plain, 'nowhere'), plain);
  assert.equal(unitLook(UNITS.greek_zeus, 'greek'), UNITS.greek_zeus, 'pantheon units are never dressed');
  const greek = unitLook(plain, 'greek');
  const norse = unitLook(plain, 'norse');
  assert.notEqual(greek, plain);
  assert.equal(unitLook(plain, 'greek'), greek, 'dressed once, then shared');
  assert.equal(greek.id, 'warrior');
  assert.equal(greek.attack, plain.attack, 'only the visual changes');
  assert.equal(greek.visual.scale, plain.visual.scale);
  assert.equal(greek.visual.colors.skin, plain.visual.colors.skin, 'colors merge key by key');
  assert.notEqual(greek.visual.colors.accent, plain.visual.colors.accent);
  assert.equal(plain.visual.weapon, 'sword', 'the shared unit is not touched');
  assert.notEqual(JSON.stringify(greek.visual), JSON.stringify(norse.visual));
  const a = getUnitModelInfo(greek);
  const b = getUnitModelInfo(norse);
  assert.ok(a.triangles > 20 && b.triangles > 20);
  const geometries = (m) => {
    const out = [];
    m.root.traverse((o) => {
      if (o.isMesh && o.geometry.attributes.aFx) out.push(o.geometry);
    });
    return out;
  };
  const m1 = buildUnitModel(greek, PLAYER_COLORS[0]);
  const m2 = buildUnitModel(greek, PLAYER_COLORS[0]);
  const m3 = buildUnitModel(norse, PLAYER_COLORS[0]);
  const [g1, g2, g3] = [m1, m2, m3].map(geometries);
  assert.ok(g1.length > 0);
  assert.deepEqual(g1, g2, 'two Greek warriors share geometry');
  assert.ok(g1.every((g, i) => g !== g3[i]), 'a Norse warrior has its own');
  for (const m of [m1, m2, m3]) m.dispose();
});

test('every pantheon look and elite soldier builds, stays inside the mortal budget and animates', () => {
  for (const p of PANTHEON_LIST) {
    for (const m of [...Object.values(MORTALS), p.elite]) {
      const def = unitLook(m, p.id);
      const info = getUnitModelInfo(def);
      assert.ok(info.triangles <= BUDGET.mortal, `${p.id} ${m.id}: ${info.triangles} triangles`);
      assert.ok(info.meshes <= 8, `${p.id} ${m.id}: ${info.meshes} meshes`);
      const model = buildUnitModel(def, PLAYER_COLORS[1]);
      model.animate('idle', 0, 0, {});
      for (const st of ['move', 'attack', 'dead']) {
        for (let i = 0; i < 12; i++) model.animate(st, i / 20, 1 / 20, { moving: st === 'move', attackPhase: st === 'attack' ? i / 12 : undefined, level: 1 });
        assertFiniteTree(model.root, `${p.id} ${m.id}/${st}`);
      }
      model.dispose();
    }
  }
});
