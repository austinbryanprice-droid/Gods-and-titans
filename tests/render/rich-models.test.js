// Tests for the rich characters (High and Ultra): src/render/models/rich-humanoid.js builds one
// smooth skinned mesh on a 23 bone rig plus a few rigid pieces; rich-anim.js poses it from the
// same pose keys as the low-poly rig; unit-models.js picks it by detail. The low-poly models
// (and their triangle budgets in unit-models.test.js) stay what Low and Medium draw.
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
  buildUnitModel, getUnitModelInfo, preloadUnitModels, clearUnitModelCache, getUnitMaterial,
} = await import('../../src/render/models/unit-models.js');
const { richSupported, buildRichTemplate } = await import('../../src/render/models/rich-humanoid.js');
const { BONE_COUNT, B } = await import('../../src/render/models/rich-kit.js');
const { UNITS, MORTALS, PANTHEON_LIST } = await import('../../src/data/index.js');
const { unitLook } = await import('../../src/render/models/unit-looks.js');
const { PLAYER_COLORS } = await import('../../src/config.js');

// A rich character is one smooth mesh of a few thousand triangles. These budgets are their own:
// the low-poly ones (unit-models.test.js) are untouched. At the game's default zoom a unit is
// ~60 px tall, so these are for the close zoom levels; mortals dominate an army, and a player
// fields one or two gods and a titan.
// (a winged creature carries ~1.5k triangles of feathers; a giant creature is built denser)
const RICH_BUDGET = { mortal: 8500, god: 9000, titan: 14000, creature: 10500, minion: 8500 };
const STATES = ['idle', 'move', 'attack', 'gather', 'return', 'build', 'pray', 'cast', 'dead'];

const looks = (u, pantheon) => unitLook(u, pantheon);
const klass = (u) => (MORTALS[u.id] || u.mortal ? 'mortal' : u.class);

/** Every shared mortal as each pantheon dresses it, and every pantheon's own units. */
function allTypes() {
  const out = [];
  for (const p of PANTHEON_LIST) {
    for (const m of Object.values(MORTALS)) out.push(looks(m, p.id));
    for (const u of Object.values(UNITS)) if (u.pantheon === p.id) out.push(looks(u, p.id));
  }
  return out;
}

const norse = (id) => looks(UNITS[id] || MORTALS[id], 'norse');
const SAMPLE = ['worshipper', 'warrior', 'norse_thor', 'norse_surtr'];
const FINISHED = ['norse_odin', 'norse_freyja', 'norse_valkyrie', 'norse_einherjar', 'norse_frost_troll', 'norse_loki', 'norse_berserker', 'archer', 'priest'];

function finite(arr, label) {
  for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), `${label}: non-finite value at ${i}`);
}

function runStates(model, label) {
  const skel = model.rich.mesh.skeleton;
  for (const st of STATES) {
    model.animate('idle', 0, 0, {});
    for (let i = 0; i < 40; i++) {
      const ex = { moving: st === 'move' || st === 'return', level: 2, carry: st === 'return' ? (i % 2 ? 'g' : 'w') : 0 };
      if (st === 'attack') ex.attackPhase = i < 20 ? i / 20 : undefined;
      model.animate(st, i / 30, 1 / 30, ex);
    }
    model.root.updateMatrixWorld(true);
    skel.update();
    finite(skel.boneMatrices, `${label}/${st} bone matrices`);
    for (const f of model.rich.flames) finite(f.morphTargetInfluences, `${label}/${st} flame`);
  }
}

test('the rich builder dresses humanoids and giants and leaves everything else low-poly', () => {
  const types = allTypes();
  const rich = types.filter(richSupported);
  assert.ok(rich.length >= 20, `only ${rich.length} supported`);
  for (const id of SAMPLE) assert.ok(richSupported(norse(id)), `${id} is part of the sample`);
  // a ram, an animal or a multi-headed body keep their low-poly model
  assert.ok(!richSupported(norse('battering_ram')));
  assert.ok(!richSupported(norse('norse_wolf_of_fenrir')));
  assert.ok(!richSupported(norse('norse_raven')));
  assert.ok(!richSupported({ id: 'x', class: 'creature', visual: { body: 'hydra', head: 'serpent', heads: 5, extras: [] } }));
  for (const u of types.filter((t) => !richSupported(t)).slice(0, 12)) {
    const info = getUnitModelInfo(u, 'rich');
    assert.equal(info.rich, false, `${u.id} should stay low-poly`);
  }
});

test('every supported unit builds a valid skinned mesh inside the rich budget', () => {
  for (const u of allTypes().filter(richSupported)) {
    const tpl = buildRichTemplate(u);
    const g = tpl.rich.geo;
    const budget = RICH_BUDGET[klass(u)];
    assert.ok(tpl.triangles > 800, `${u.id}: suspiciously few triangles`);
    assert.ok(tpl.triangles <= budget, `${u.id}: ${tpl.triangles} triangles > ${budget}`);
    assert.ok(tpl.meshes <= 12, `${u.id}: ${tpl.meshes} meshes`);
    for (const name of ['position', 'normal', 'color', 'aFx', 'aAo']) finite(g.attributes[name].array, `${u.id} ${name}`);
    const n = g.attributes.position.count;
    const idx = g.attributes.skinIndex.array;
    const w = g.attributes.skinWeight.array;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        assert.ok(idx[i * 4 + k] < BONE_COUNT, `${u.id}: bone index out of range`);
        assert.ok(w[i * 4 + k] >= 0);
        sum += w[i * 4 + k];
      }
      assert.ok(Math.abs(sum - 1) < 1e-3, `${u.id}: skin weights of vertex ${i} sum to ${sum}`);
    }
    for (const a of tpl.rich.attach) {
      finite(a.geo.attributes.position.array, `${u.id} ${a.name}`);
      assert.ok(!a.geo.attributes.skinIndex, `${a.name} is a rigid piece`);
    }
    // standing height stays near the low-poly model's (the sim's selection and shadows are sized for it)
    const base = getUnitModelInfo(u, 'base').height;
    const rich = getUnitModelInfo(u, 'rich').height;
    // (a raised offhand, an orb or a lantern, makes the low-poly model measure taller than the standing rich one)
    assert.ok(rich > base * 0.6 && rich < base * 1.5, `${u.id}: rich height ${rich.toFixed(2)} vs base ${base.toFixed(2)}`);
  }
});

test('rich characters animate every state without a NaN, through the same pose keys', () => {
  for (const id of [...SAMPLE, ...FINISHED]) {
    const u = norse(id);
    const m = buildUnitModel(u, PLAYER_COLORS[2], { detail: 'rich' });
    assert.ok(m.rich, `${id} should be rich`);
    runStates(m, id);
    m.dispose();
  }
});

test('the Norse gods, creatures and elite soldiers are dressed too: helmets, wings, spikes, staffs and bows', () => {
  for (const id of FINISHED) assert.ok(richSupported(norse(id)), `${id} is supported`);
  const odin = buildRichTemplate(norse('norse_odin'));
  assert.ok(odin.rich.attach.some((a) => a.name === 'weaponR'), 'Odin carries his spear');
  const troll = buildRichTemplate(norse('norse_frost_troll'));
  assert.ok(troll.triangles > buildRichTemplate(norse('warrior')).triangles, 'a frost troll with its ice spikes is the heavier model');
  const archer = buildRichTemplate(norse('archer'));
  assert.ok(archer.rich.attach.some((a) => a.name === 'weaponL'), 'the bow rides the left hand');
});

test('winged units grow four wing bones and four feather pieces; the body skin never uses them', () => {
  const m = buildUnitModel(norse('norse_valkyrie'), PLAYER_COLORS[0], { detail: 'rich' });
  assert.equal(m.rich.bones.length, BONE_COUNT + 4);
  for (const name of ['wingR1', 'wingR2', 'wingL1', 'wingL2']) {
    const piece = m.root.getObjectByName(name);
    assert.ok(piece && piece.isMesh && !piece.isSkinnedMesh, `${name} is a rigid piece`);
    assert.equal(m.rich.mounts.find((x) => x.obj === piece.parent)?.bone, B[name]);
  }
  const tpl = buildRichTemplate(norse('norse_valkyrie'));
  const idx = tpl.rich.geo.attributes.skinIndex.array;
  for (let i = 0; i < idx.length; i++) assert.ok(idx[i] < BONE_COUNT, 'the body is not skinned to the wings');
  // a unit without wings keeps the 23 bone rig
  const plain = buildUnitModel(norse('norse_odin'), PLAYER_COLORS[0], { detail: 'rich' });
  assert.equal(plain.rich.bones.length, BONE_COUNT);
  m.dispose();
  plain.dispose();
});

test('wings fold down the back of a grounded unit standing about, and open to cast, walk or fly', () => {
  const grounded = { ...norse('norse_valkyrie'), id: 'test_grounded_valkyrie', air: false };
  const m = buildUnitModel(grounded, PLAYER_COLORS[0], { detail: 'rich' });
  const b = m.rich.bones;
  const wrist = new THREE.Vector3();
  const at = () => {
    m.root.updateMatrixWorld(true);
    return wrist.setFromMatrixPosition(b[B.wingR2].matrixWorld).clone();
  };
  for (let i = 0; i < 90; i++) m.animate('idle', i / 30, 1 / 30, {});
  const folded = at();
  for (let i = 0; i < 90; i++) m.animate('cast', 4 + i / 30, 1 / 30, {});
  const open = at();
  assert.ok(open.z > folded.z + 0.2, `the cast spreads the wings (z ${folded.z.toFixed(2)} -> ${open.z.toFixed(2)})`);
  assert.ok(folded.x < open.x - 0.15, `the folded wing lies back along the body (x ${folded.x.toFixed(2)} vs ${open.x.toFixed(2)})`);
  // the left wing mirrors the right one: the same turn with the signs of a reflection across the body's plane
  for (const [r, l] of [[B.wingR1, B.wingL1], [B.wingR2, B.wingL2]]) {
    const qr = b[r].quaternion;
    const ql = b[l].quaternion;
    assert.ok(Math.abs(ql.x + qr.x) < 1e-6 && Math.abs(ql.y + qr.y) < 1e-6 && Math.abs(ql.z - qr.z) < 1e-6 && Math.abs(ql.w - qr.w) < 1e-6, 'the wings are mirror images');
  }
  // a flier beats them: the tip rises and falls
  const flier = buildUnitModel(norse('norse_valkyrie'), PLAYER_COLORS[0], { detail: 'rich' });
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 60; i++) {
    flier.animate('idle', i / 30, 1 / 30, {});
    flier.root.updateMatrixWorld(true);
    const y = new THREE.Vector3().setFromMatrixPosition(flier.rich.bones[B.wingR2].matrixWorld).y;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  assert.ok(hi - lo > 0.2, `the wingbeat moves the wrist (${(hi - lo).toFixed(2)})`);
  m.dispose();
  flier.dispose();
});

test('the bones follow the pose: a strike lifts the arm and a stride swings the legs', () => {
  const m = buildUnitModel(norse('warrior'), PLAYER_COLORS[0], { detail: 'rich' });
  const b = m.rich.bones;
  m.animate('idle', 0, 0, {});
  for (let i = 0; i < 30; i++) m.animate('idle', i / 30, 1 / 30, {});
  const armIdle = b[B.upperR].rotation.x;
  let reach = 0;
  for (let i = 0; i < 40; i++) {
    m.animate('attack', 1 + i / 30, 1 / 30, { attackPhase: Math.min(0.99, i / 40) });
    reach = Math.max(reach, Math.abs(b[B.upperR].rotation.z - 0) + Math.abs(b[B.upperR].rotation.x - armIdle));
  }
  assert.ok(reach > 0.5, `the strike moves the arm (${reach.toFixed(2)})`);
  let swing = 0;
  for (let i = 0; i < 60; i++) {
    m.animate('move', 2 + i / 30, 1 / 30, { moving: true, speed: 2.5 });
    swing = Math.max(swing, Math.abs(b[B.thighR].rotation.z));
  }
  assert.ok(swing > 0.2, `the stride swings the thigh (${swing.toFixed(2)})`);
  m.dispose();
});

test('detail picks the rich model on request and keeps the low-poly one by default', () => {
  const warrior = norse('warrior');
  const base = buildUnitModel(warrior, PLAYER_COLORS[0]);
  assert.equal(base.rich, null);
  assert.ok(!base.root.getObjectByProperty('isSkinnedMesh', true));
  const rich = buildUnitModel(warrior, PLAYER_COLORS[0], { detail: 'rich' });
  assert.ok(rich.rich);
  const body = rich.root.getObjectByName('body');
  assert.ok(body && body.isSkinnedMesh);
  assert.equal(body.skeleton.bones.length, BONE_COUNT);
  // a unit the rich builder cannot dress yet stays low-poly even on high
  const ram = buildUnitModel(norse('battering_ram'), PLAYER_COLORS[0], { detail: 'rich' });
  assert.equal(ram.rich, null);
  for (const m of [base, rich, ram]) m.dispose();
  const a = getUnitModelInfo(warrior, 'base');
  const b = getUnitModelInfo(warrior, 'rich');
  assert.ok(!a.rich && b.rich);
  assert.ok(b.triangles > a.triangles * 2, 'the rich model is the detailed one');
});

test('instances share geometry and materials; skinned and plain meshes keep apart', () => {
  const u = norse('warrior');
  const a = buildUnitModel(u, PLAYER_COLORS[3], { detail: 'rich' });
  const b = buildUnitModel(u, PLAYER_COLORS[3], { detail: 'rich' });
  const ba = a.root.getObjectByName('body');
  const bb = b.root.getObjectByName('body');
  assert.equal(ba.geometry, bb.geometry);
  assert.equal(ba.material, bb.material);
  assert.notEqual(ba.skeleton, bb.skeleton, 'each unit poses its own bones');
  assert.notEqual(getUnitMaterial(PLAYER_COLORS[3], 0, false, true), getUnitMaterial(PLAYER_COLORS[3], 0, false, false));
  // the weapon and shield are plain meshes riding mounts that follow the hand and forearm bones
  const mountOf = (obj) => a.rich.mounts.find((m) => m.obj === obj.parent);
  const w = a.root.getObjectByName('weaponR');
  assert.ok(w && w.isMesh && !w.isSkinnedMesh && mountOf(w)?.bone === B.handR);
  const shield = a.root.getObjectByName('shield');
  assert.ok(shield && mountOf(shield)?.bone === B.foreL);
  a.dispose();
  b.dispose();
  a.dispose(); // a second dispose is a no-op
});

test('the skeleton stays out of the scene graph and the weapon follows the hand through a strike', () => {
  const m = buildUnitModel(norse('warrior'), PLAYER_COLORS[0], { detail: 'rich' });
  m.root.updateMatrixWorld(true);
  let boneObjects = 0;
  m.root.traverse((o) => {
    if (o.isBone) boneObjects++;
  });
  assert.equal(boneObjects, 0, 'no bone is walked by the scene update');
  const w = m.root.getObjectByName('weaponR');
  const hand = m.rich.bones[B.handR];
  const at = new THREE.Vector3();
  const handAt = new THREE.Vector3();
  let moved = 0;
  let last = null;
  for (let i = 0; i < 40; i++) {
    m.animate('attack', 5 + i * 0.04, 0.04, { attackPhase: i / 40 });
    m.root.updateMatrixWorld(true);
    at.setFromMatrixPosition(w.parent.matrixWorld);
    handAt.setFromMatrixPosition(hand.matrixWorld).applyMatrix4(m.rigGroup.matrixWorld);
    assert.ok(at.distanceTo(handAt) < 1e-4, 'the weapon mount sits on the hand bone');
    if (last) moved += at.distanceTo(last);
    last = last ? last.copy(at) : at.clone();
  }
  assert.ok(moved > 1, `the hand (and weapon) swings through the strike: ${moved.toFixed(2)}`);
  for (const x of m.rich.mesh.skeleton.boneMatrices) assert.ok(Number.isFinite(x));
  m.dispose();
});

test('team color reaches the rich cloth and the shield; the metal keeps its own color', () => {
  const tpl = buildRichTemplate(norse('warrior'));
  const fx = tpl.rich.geo.attributes.aFx.array;
  let team = 0;
  let metal = 0;
  for (let i = 0; i < fx.length; i += 4) {
    if (fx[i] > 0) team++;
    if (fx[i + 3] > 0.3) metal++;
  }
  const n = fx.length / 4;
  assert.ok(team > n * 0.06, `team-colored vertices: ${team} of ${n}`);
  assert.ok(metal > n * 0.04, `metal vertices: ${metal} of ${n}`);
  const shield = tpl.rich.attach.find((a) => a.shield);
  assert.ok(shield && Array.from(shield.geo.attributes.aFx.array).some((x, i) => i % 4 === 0 && x > 0), 'the shield face is team painted');
});

test('workers carry their tools in hand: hidden until the work, then one at a time', () => {
  const m = buildUnitModel(norse('worshipper'), PLAYER_COLORS[1], { detail: 'rich' });
  const tools = m.rich.tools;
  assert.deepEqual(Object.keys(tools).sort(), ['axe', 'hammer', 'pick']);
  for (const t of Object.values(tools)) assert.equal(t.visible, false);
  m.setTool('axe');
  assert.equal(tools.axe.visible, true);
  assert.equal(tools.pick.visible, false);
  m.setTool('none');
  for (const t of Object.values(tools)) assert.equal(t.visible, false);
  assert.ok(m.parts.carry, 'cargo has its place on the shoulder');
  m.dispose();
});

test('a fire giant has a crust of veins, black iron and flames that flicker', () => {
  const m = buildUnitModel(norse('norse_surtr'), PLAYER_COLORS[0], { detail: 'rich' });
  assert.ok(m.rich.flames.length >= 2, 'flames on the shoulders and a mane');
  for (const f of m.rich.flames) assert.equal(f.morphTargetInfluences.length, 1);
  const tpl = buildRichTemplate(norse('norse_surtr'));
  const fx = tpl.rich.geo.attributes.aFx.array;
  let glow = 0;
  for (let i = 1; i < fx.length; i += 4) if (fx[i] > 0.3) glow++;
  assert.ok(glow > 150, `glowing vertices: ${glow}`);
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    m.animate('attack', i / 30, 1 / 30, { attackPhase: i / 20 });
    seen.add(m.rich.flames[0].morphTargetInfluences[0].toFixed(3));
  }
  assert.ok(seen.size > 3, 'the flames flicker');
  m.dispose();
});

test('clearing the model cache frees buffers; rich templates rebuild without being re-baked', () => {
  const u = norse('norse_thor');
  const before = getUnitModelInfo(u, 'rich');
  preloadUnitModels([u], 'rich');
  clearUnitModelCache();
  const t0 = performance.now();
  const after = getUnitModelInfo(u, 'rich');
  const ms = performance.now() - t0;
  assert.equal(after.triangles, before.triangles);
  assert.ok(ms < 400, `the rich template is cached across a clear (${ms.toFixed(0)} ms)`);
  const m = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
  m.animate('idle', 0, 0, {});
  m.dispose();
});

test('the skinned mesh culls with a fixed sphere that holds every pose', () => {
  const m = buildUnitModel(norse('norse_thor'), PLAYER_COLORS[0], { detail: 'rich' });
  const body = m.root.getObjectByName('body');
  assert.ok(body.boundingSphere && body.boundingSphere.radius > 0.5);
  for (let i = 0; i < 40; i++) m.animate('attack', i / 30, 1 / 30, { attackPhase: i / 40 });
  m.root.updateMatrixWorld(true);
  body.skeleton.update();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const pos = body.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 7) {
    v.fromBufferAttribute(pos, i);
    body.applyBoneTransform(i, v);
    box.expandByPoint(v);
  }
  const s = body.boundingSphere;
  for (const p of [box.min, box.max]) assert.ok(p.distanceTo(s.center) < s.radius * 1.6, 'posed vertices stay near the culling sphere');
  m.dispose();
});
