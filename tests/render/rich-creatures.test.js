// Tests for the rich creatures (High and Ultra): the beasts, birds, serpents, lizards and half-human bodies that are not on the
// humanoid rig. src/render/models/rich-creatures.js picks a body plan by what a unit looks like; each plan builds one
// smooth skinned mesh on its own skeleton (rich-quadruped.js, rich-bird.js ...) plus a few rigid pieces, and
// rich-creature-anim.js poses it from the same pose keys as the low-poly rig (unit-anim.js). Low and Medium keep the
// low-poly models.
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
const { buildUnitModel, getUnitModelInfo } = await import('../../src/render/models/unit-models.js');
const { richSupported, buildRichTemplate } = await import('../../src/render/models/rich-humanoid.js');
const { creatureSupported } = await import('../../src/render/models/rich-creatures.js');
const { UNITS } = await import('../../src/data/index.js');
const { unitLook } = await import('../../src/render/models/unit-looks.js');
const { PLAYER_COLORS } = await import('../../src/config.js');

// A rich creature is one smooth mesh of a few thousand triangles (its wings and held things ride on top as rigid
// pieces). These are the same budgets as the rich humanoids (rich-models.test.js): a creature, a minion, a titan.
const RICH_BUDGET = { creature: 10500, minion: 8500, titan: 14000 };
const STATES = ['idle', 'move', 'attack', 'cast', 'dead'];

/** The units each body plan dresses: [pantheon, unit id]. */
const QUADRUPEDS = [
  ['norse', 'norse_wolf_of_fenrir'], ['greek', 'greek_pegasus'], ['greek', 'greek_cerberus'], ['egyptian', 'egyptian_sphinx'],
  ['egyptian', 'egyptian_jackal'], ['japanese', 'japanese_kitsune'], ['japanese', 'japanese_myobu_fox'], ['japanese', 'japanese_tenko'],
  ['chinese', 'chinese_guardian_lion'], ['aztec', 'aztec_jaguar_spirit'], ['aztec', 'aztec_ahuizotl'], ['celtic', 'celtic_cu_sith'],
  ['mesopotamian', 'mesopotamian_lamassu'], ['mesopotamian', 'mesopotamian_bull_of_heaven'], ['west_african', 'west_african_osebo'],
];

const BIRDS = [
  ['norse', 'norse_raven'], ['egyptian', 'egyptian_bennu'], ['chinese', 'chinese_fenghuang'], ['celtic', 'celtic_battle_crow'], ['mesopotamian', 'mesopotamian_anzu'],
];

const SERPENTS = [['egyptian', 'egyptian_apep'], ['aztec', 'aztec_xiuhcoatl'], ['west_african', 'west_african_onini']];
const HYDRAS = [['japanese', 'japanese_yamata_no_orochi']];
const DRAGONS = [['chinese', 'chinese_celestial_dragon'], ['mesopotamian', 'mesopotamian_tiamat'], ['west_african', 'west_african_ninki_nanka']];
const LONG_BODIES = [...SERPENTS, ...DRAGONS];
const LIZARDS = [['mesopotamian', 'mesopotamian_mushussu'], ['aztec', 'aztec_cipactli']];

const look = ([pantheon, id]) => unitLook(UNITS[id], pantheon);
const BY_ID = Object.fromEntries([...QUADRUPEDS, ...BIRDS, ...SERPENTS, ...HYDRAS, ...DRAGONS, ...LIZARDS].map((pair) => [pair[1], look(pair)]));
const unit = (id) => BY_ID[id];
const withVisual = (u, change) => ({ ...u, visual: { ...u.visual, ...change(u.visual) } });

function finite(arr, label) {
  for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), `${label}: non-finite value at ${i}`);
}

/** Walk a model through every state a few times and check its bone matrices stay finite. */
function runStates(model, label) {
  const skel = model.rich.mesh.skeleton;
  for (const st of STATES) {
    model.animate('idle', 0, 0, {});
    for (let i = 0; i < 40; i++) {
      const ex = { moving: st === 'move' };
      if (st === 'attack') ex.attackPhase = i < 20 ? i / 20 : undefined;
      model.animate(st, i / 30, 1 / 30, ex);
    }
    model.root.updateMatrixWorld(true);
    skel.update();
    finite(skel.boneMatrices, `${label}/${st} bone matrices`);
  }
}

/** The world position of a bone of the model's skeleton, by name. */
function bonePos(model, name) {
  model.root.updateMatrixWorld(true);
  const b = model.rich.bones[model.rich.ix[name]];
  return b.getWorldPosition(new THREE.Vector3());
}

test('the four-legged beasts are built by the rich builder, as far as it can dress them', () => {
  for (const pair of QUADRUPEDS) {
    const u = look(pair);
    assert.ok(creatureSupported(u), `${u.id} is a rich creature`);
    assert.ok(richSupported(u), `${u.id} is supported`);
  }
  // only the heads and extras the plan builds are let through: any other beast keeps its low-poly model
  const pegasus = unit('greek_pegasus');
  assert.ok(!richSupported(withVisual(pegasus, (v) => ({ extras: [...v.extras, 'rider'] }))), 'a rider is not dressed');
  assert.ok(!richSupported(withVisual(pegasus, () => ({ head: 'gorilla' }))), 'a head the plan has no table for');
  const cerberus = unit('greek_cerberus');
  assert.ok(richSupported(cerberus));
  assert.ok(!richSupported(withVisual(cerberus, () => ({ heads: 5 }))), 'five heads are too many for the plan');
  assert.ok(!richSupported(withVisual(unit('egyptian_sphinx'), () => ({ headgear: 'crown' }))), 'a crown the human head cannot wear');
});

/** The checks every rich creature's template passes: a valid skinned mesh with rigid pieces on top, inside the budget, about as tall as its low-poly model. */
function checkSkinned(u, tpl) {
  const g = tpl.rich.geo;
  const budget = RICH_BUDGET[u.class] ?? RICH_BUDGET.creature;
  assert.ok(tpl.triangles > 1500, `${u.id}: suspiciously few triangles`);
  assert.ok(tpl.triangles <= budget, `${u.id}: ${tpl.triangles} triangles > ${budget}`);
  assert.ok(tpl.meshes <= 12, `${u.id}: ${tpl.meshes} meshes`);
  for (const name of ['position', 'normal', 'color', 'aFx', 'aAo']) finite(g.attributes[name].array, `${u.id} ${name}`);
  const bones = tpl.rich.spec.pos.length;
  const idx = g.attributes.skinIndex.array;
  const w = g.attributes.skinWeight.array;
  for (let i = 0; i < g.attributes.position.count; i++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      assert.ok(idx[i * 4 + k] < bones, `${u.id}: bone index out of range`);
      assert.ok(w[i * 4 + k] >= 0);
      sum += w[i * 4 + k];
    }
    assert.ok(Math.abs(sum - 1) < 1e-3, `${u.id}: skin weights of vertex ${i} sum to ${sum}`);
  }
  for (const a of tpl.rich.attach) {
    finite(a.geo.attributes.position.array, `${u.id} ${a.name}`);
    assert.ok(!a.geo.attributes.skinIndex, `${a.name} is a rigid piece`);
  }
  // every bone has a parent that comes before it, and a unique name
  const names = new Set();
  for (const [name, i] of Object.entries(tpl.rich.ix)) {
    assert.ok(!names.has(i), `${u.id}: ${name} repeats a bone`);
    names.add(i);
  }
  // the unit stands about as tall as its low-poly model (selection and shadows are sized for it)
  const base = getUnitModelInfo(u, 'base').height;
  const rich = getUnitModelInfo(u, 'rich').height;
  assert.ok(rich > base * 0.6 && rich < base * 1.5, `${u.id}: rich height ${rich.toFixed(2)} vs base ${base.toFixed(2)}`);
}

test('every beast builds a valid skinned mesh inside the rich budget', () => {
  for (const pair of QUADRUPEDS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    assert.equal(tpl.kind, 'quadruped');
    assert.equal(tpl.rich.plan, 'quadruped');
    checkSkinned(u, tpl);
  }
});

test('Low and Medium keep the low-poly beasts; High and Ultra swap in the rich ones', () => {
  for (const pair of QUADRUPEDS) {
    const u = look(pair);
    const base = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'base' });
    assert.equal(base.rich, null, `${u.id} stays low-poly on Low and Medium`);
    assert.ok(base.parts.torso || base.parts.body || Object.keys(base.parts).length > 0, `${u.id} has its rigid parts`);
    const rich = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
    assert.ok(rich.rich, `${u.id} is rich on High and Ultra`);
    assert.equal(rich.rich.plan, 'quadruped');
    assert.ok(rich.root.getObjectByName('body')?.isSkinnedMesh, `${u.id}: one skinned body`);
    for (const m of [base, rich]) m.dispose();
  }
});

test('every beast animates every state without a NaN, through the same pose keys', () => {
  for (const pair of QUADRUPEDS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[2], { detail: 'rich' });
    runStates(m, u.id);
    m.dispose();
  }
});

test('a beast walks on four legs: the legs swing in turn, the spine and the tail follow', () => {
  const wolf = buildUnitModel(unit('norse_wolf_of_fenrir'), PLAYER_COLORS[1], { detail: 'rich' });
  const ix = wolf.rich.ix;
  for (const name of ['F1u', 'F-1u', 'B1u', 'B-1u', 'F1l', 'B1p', 'hips', 'spine', 'chest', 'neck1', 'neck2', 'head', 'jaw', 'earR', 'earL', 'tail1', 'tail4']) {
    assert.ok(ix[name] !== undefined, `the wolf has a ${name} bone`);
  }
  wolf.animate('idle', 0, 0, {});
  const swing = [];
  const tail = [];
  const spine = [];
  for (let i = 0; i < 60; i++) {
    wolf.animate('move', i / 30, 1 / 30, { moving: true });
    swing.push([wolf.rich.bones[ix.F1u].rotation.z, wolf.rich.bones[ix['F-1u']].rotation.z, wolf.rich.bones[ix.B1u].rotation.z, wolf.rich.bones[ix['B-1u']].rotation.z]);
    tail.push(wolf.rich.bones[ix.tail3].rotation.y);
    spine.push(wolf.rich.bones[ix.spine].rotation.y);
  }
  const range = (a) => Math.max(...a) - Math.min(...a);
  for (let k = 0; k < 4; k++) assert.ok(range(swing.map((s) => s[k])) > 0.5, `leg ${k} swings`);
  // the front legs and the hind ones are out of step (a gallop reaches with the fore, then gathers the hind)
  assert.ok(swing.some((s) => Math.abs(s[0] - s[2]) > 0.5), 'the front and hind legs alternate');
  assert.ok(range(tail) > 0.05, 'the tail waves');
  assert.ok(range(spine) > 0.03, 'the spine bends from side to side');
  wolf.dispose();
});

test('the jaw opens to bite and the head leans into the strike', () => {
  const m = buildUnitModel(unit('norse_wolf_of_fenrir'), PLAYER_COLORS[1], { detail: 'rich' });
  const jaw = m.rich.bones[m.rich.ix.jaw];
  m.animate('idle', 0, 0, {});
  const closed = jaw.rotation.z;
  let open = closed;
  for (let i = 0; i < 40; i++) {
    m.animate('attack', i / 30, 1 / 30, { attackPhase: i / 40 });
    open = Math.min(open, jaw.rotation.z);
  }
  assert.ok(open < closed - 0.15, `the jaw opens (${closed.toFixed(2)} -> ${open.toFixed(2)})`);
  m.dispose();
});

test('Cerberus has three heads, each on a neck of its own that looks about', () => {
  const u = unit('greek_cerberus');
  const tpl = buildRichTemplate(u);
  for (const k of ['hAn1', 'hAn2', 'hAh', 'hAj', 'hBn1', 'hBn2', 'hBh', 'hBj']) assert.ok(tpl.rich.ix[k] !== undefined, `Cerberus has a ${k} bone`);
  assert.equal(tpl.rich.ix.hCn1, undefined, 'two more heads, not three');
  const m = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
  const a = m.rich.bones[m.rich.ix.hAn1];
  const seen = new Set();
  for (let i = 0; i < 90; i++) {
    m.animate('idle', i / 30, 1 / 30, {});
    seen.add(a.rotation.y.toFixed(2));
  }
  assert.ok(seen.size > 10, 'a side head sweeps from side to side while it stands');
  // the heads sit apart: the side ones stand out to the left and the right of the first
  const hz = ['hAh', 'head', 'hBh'].map((n) => tpl.rich.spec.pos[tpl.rich.ix[n]][2]);
  assert.ok(Math.abs(hz[0] - hz[1]) > 0.1 && Math.abs(hz[2] - hz[1]) > 0.1 && hz[0] * hz[2] < 0, 'the heads are spread out');
  // three heads cost more than one but stay in the minion budget
  assert.ok(tpl.triangles > buildRichTemplate(unit('norse_wolf_of_fenrir')).triangles);
  m.dispose();
});

test('a fox spirit with an aura carries three tails; the plain beasts carry one', () => {
  for (const id of ['japanese_kitsune', 'japanese_myobu_fox', 'japanese_tenko']) {
    const tpl = buildRichTemplate(unit(id));
    assert.ok(tpl.rich.ix.tail1 !== undefined && tpl.rich.ix.tailA1 !== undefined && tpl.rich.ix.tailB1 !== undefined, `${id} has three tails`);
  }
  assert.equal(buildRichTemplate(unit('egyptian_jackal')).rich.ix.tailA1, undefined, 'the jackal has one tail');
  // the Tenko wears a ring of gems over its back
  const tenko = buildRichTemplate(unit('japanese_tenko'));
  const myobu = buildRichTemplate(unit('japanese_myobu_fox'));
  assert.ok(tenko.triangles > myobu.triangles * 0.9);
});

test('winged beasts hold their wings up and back standing about, and beat them in the air', () => {
  for (const id of ['greek_pegasus', 'mesopotamian_lamassu']) {
    const tpl = buildRichTemplate(unit(id));
    for (const name of ['wingR1', 'wingR2', 'wingL1', 'wingL2']) {
      assert.ok(tpl.rich.attach.some((a) => a.name === name && a.wing), `${id} has ${name} as a rigid wing piece`);
      assert.ok(tpl.rich.ix[name] !== undefined, `${id} has a ${name} bone`);
    }
  }
  const lamassu = buildUnitModel(unit('mesopotamian_lamassu'), PLAYER_COLORS[0], { detail: 'rich' });
  assert.ok(!lamassu.air, 'the lamassu keeps to the ground');
  for (let i = 0; i < 60; i++) lamassu.animate('idle', i / 30, 1 / 30, {});
  const root = bonePos(lamassu, 'wingR1');
  const wrist = bonePos(lamassu, 'wingR2');
  assert.ok(wrist.y > root.y + 0.02, 'standing about, the wing is lifted above the shoulder');
  assert.ok(wrist.x < root.x, 'and swept back');
  assert.ok(wrist.z > root.z, 'the right wing spans to the right');
  const left = bonePos(lamassu, 'wingL2');
  assert.ok(Math.abs(left.z + wrist.z - 2 * bonePos(lamassu, 'wingL1').z) < 0.02 || left.z < bonePos(lamassu, 'wingL1').z, 'the left wing mirrors it');
  for (let i = 0; i < 20; i++) lamassu.animate('dead', i / 30, 1 / 30, {});
  assert.ok(bonePos(lamassu, 'wingR2').y < wrist.y - 0.02, 'a dead one lets its wings fall');
  lamassu.dispose();

  const pegasus = buildUnitModel(unit('greek_pegasus'), PLAYER_COLORS[0], { detail: 'rich' });
  assert.ok(pegasus.air, 'the pegasus flies');
  const ys = [];
  for (let i = 0; i < 40; i++) {
    pegasus.animate('move', i / 30, 1 / 30, { moving: true });
    ys.push(bonePos(pegasus, 'wingR2').y - bonePos(pegasus, 'wingR1').y);
  }
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.3, 'the wing beats up and down in flight');
  pegasus.dispose();
});

test('the sphinx and the lamassu wear a human head on a beast\'s body', () => {
  const sphinx = buildRichTemplate(unit('egyptian_sphinx'));
  const lamassu = buildRichTemplate(unit('mesopotamian_lamassu'));
  for (const tpl of [sphinx, lamassu]) {
    assert.equal(tpl.rich.ix.jaw, undefined, 'a human head has no muzzle to open');
    assert.ok(tpl.rich.ix.neck1 !== undefined && tpl.rich.ix.head !== undefined);
  }
  // the sphinx wears the striped headcloth and its human face rises above the shoulders; the lamassu is a bull
  const box = (tpl) => { tpl.rich.geo.computeBoundingBox(); return tpl.rich.geo.boundingBox; };
  assert.ok(box(sphinx).max.y > 0.9, 'a head carried high');
  assert.ok(box(lamassu).max.y > 0.9);
  // the lamassu's horned crown and curled beard cost triangles the plain bull does not
  assert.ok(lamassu.triangles > buildRichTemplate(unit('mesopotamian_bull_of_heaven')).triangles);
});

test('each beast has its own coat: spots, a mane, a ruff, a plume of hair', () => {
  const tri = (id) => buildRichTemplate(unit(id)).triangles;
  // a mane costs hair on top of the same body (the lion against the jaguar)
  assert.ok(tri('chinese_guardian_lion') > tri('aztec_jaguar_spirit') + 800, 'the lion\'s mane');
  // the pegasus's mane and tail of hair, its wings, against a plain horse-less beast
  assert.ok(tri('greek_pegasus') > 5000);
  // the dorsal spikes of the ahuizotl show on top of the wolf's body
  assert.ok(tri('aztec_ahuizotl') > tri('celtic_cu_sith') + 100, 'the ahuizotl\'s spikes');
  // the same wolf body: Fenrir's wolf and the Cu Sith are built alike
  assert.equal(tri('norse_wolf_of_fenrir'), tri('celtic_cu_sith'));
});

// ---------------------------------------------------------------------------
// birds
// ---------------------------------------------------------------------------

test('the birds are built by the rich builder, as far as it can dress them', () => {
  for (const pair of BIRDS) {
    const u = look(pair);
    assert.ok(creatureSupported(u), `${u.id} is a rich creature`);
    assert.ok(richSupported(u), `${u.id} is supported`);
  }
  // only the heads and extras the plan builds are let through: any other bird keeps its low-poly model
  const raven = unit('norse_raven');
  assert.ok(!richSupported(withVisual(raven, () => ({ heads: 2 }))), 'two heads are too many for the plan');
  assert.ok(!richSupported(withVisual(raven, () => ({ head: 'dragon' }))), 'a head the plan has no table for');
  assert.ok(!richSupported(withVisual(raven, (v) => ({ extras: [...v.extras, 'spikes'] }))), 'an extra the plan does not build');
  assert.ok(!richSupported(withVisual(raven, () => ({ headgear: 'crown' }))), 'a crown the bird cannot wear');
  assert.ok(richSupported(withVisual(raven, (v) => ({ extras: [...v.extras, 'tail', 'flames'] }))), 'a long tail and flames are built');
});

test('every bird builds a valid skinned mesh inside the rich budget', () => {
  for (const pair of BIRDS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    assert.equal(tpl.kind, 'bird');
    assert.equal(tpl.rich.plan, 'bird');
    checkSkinned(u, tpl);
    for (const name of ['body', 'chest', 'neck1', 'neck2', 'head', 'tail1', 'tail4', 'legR', 'footR', 'legL', 'footL', 'wingR1', 'wingR2', 'wingL1', 'wingL2']) {
      assert.ok(tpl.rich.ix[name] !== undefined, `${u.id} has a ${name} bone`);
    }
  }
});

test('Low and Medium keep the low-poly birds; High and Ultra swap in the rich ones', () => {
  for (const pair of BIRDS) {
    const u = look(pair);
    const base = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'base' });
    assert.equal(base.rich, null, `${u.id} stays low-poly on Low and Medium`);
    const rich = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
    assert.ok(rich.rich, `${u.id} is rich on High and Ultra`);
    assert.equal(rich.rich.plan, 'bird');
    assert.ok(rich.root.getObjectByName('body')?.isSkinnedMesh, `${u.id}: one skinned body`);
    assert.ok(rich.air, `${u.id} flies`);
    for (const m of [base, rich]) m.dispose();
  }
});

test('every bird animates every state without a NaN, through the same pose keys', () => {
  for (const pair of BIRDS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[2], { detail: 'rich' });
    runStates(m, u.id);
    m.dispose();
  }
});

test('a bird beats its wings in flight, the outer bone trailing the inner one, and lets them fall when it dies', () => {
  const m = buildUnitModel(unit('norse_raven'), PLAYER_COLORS[0], { detail: 'rich' });
  const ys = [];
  const lags = [];
  for (let i = 0; i < 60; i++) {
    m.animate('move', i / 30, 1 / 30, { moving: true });
    const root = bonePos(m, 'wingR1');
    const wrist = bonePos(m, 'wingR2');
    ys.push(wrist.y - root.y);
    lags.push(m.rich.bones[m.rich.ix.wingR2].rotation.x);
  }
  const range = (a) => Math.max(...a) - Math.min(...a);
  assert.ok(range(ys) > 0.2, 'the wing goes up and down');
  assert.ok(range(lags) > 0.05, 'the wrist bends through the stroke');
  const root = bonePos(m, 'wingR1');
  assert.ok(bonePos(m, 'wingR2').z > root.z, 'the right wing spans to the right');
  assert.ok(bonePos(m, 'wingL2').z < bonePos(m, 'wingL1').z, 'the left wing spans to the left');
  for (let i = 0; i < 40; i++) m.animate('dead', i / 30, 1 / 30, {});
  assert.ok(bonePos(m, 'wingR2').y < bonePos(m, 'wingR1').y, 'a dead bird\'s wings hang');
  m.dispose();
});

test('a bird strikes with its head and its legs, and a lion-headed one opens its jaw', () => {
  const crow = buildUnitModel(unit('celtic_battle_crow'), PLAYER_COLORS[1], { detail: 'rich' });
  const legR = crow.rich.bones[crow.rich.ix.legR];
  crow.animate('idle', 0, 0, {});
  for (let i = 0; i < 20; i++) crow.animate('idle', i / 30, 1 / 30, {});
  const tucked = legR.rotation.z;
  let reach = tucked;
  for (let i = 0; i < 60; i++) {
    crow.animate('attack', i / 30, 1 / 30, { attackPhase: Math.min(0.99, i / 40) });
    reach = Math.max(reach, legR.rotation.z);
  }
  assert.ok(reach > tucked + 0.3, `the legs come forward to strike (${tucked.toFixed(2)} -> ${reach.toFixed(2)})`);
  crow.dispose();

  const anzu = buildUnitModel(unit('mesopotamian_anzu'), PLAYER_COLORS[1], { detail: 'rich' });
  for (const name of ['jaw', 'earR', 'earL']) assert.ok(anzu.rich.ix[name] !== undefined, `the Anzu has a ${name} bone`);
  assert.equal(crow.rich.ix.jaw, undefined, 'a crow\'s beak is one piece');
  const jaw = anzu.rich.bones[anzu.rich.ix.jaw];
  for (let i = 0; i < 20; i++) anzu.animate('idle', i / 30, 1 / 30, {});
  const closed = jaw.rotation.z;
  let open = closed;
  for (let i = 0; i < 60; i++) {
    anzu.animate('attack', i / 30, 1 / 30, { attackPhase: Math.min(0.99, i / 40) });
    open = Math.min(open, jaw.rotation.z);
  }
  assert.ok(open < closed - 0.1, `the jaw opens (${closed.toFixed(2)} -> ${open.toFixed(2)})`);
  anzu.dispose();
});

test('the phoenixes trail long tails, the Bennu burns, and the Anzu wears a lion\'s mane', () => {
  const box = (id) => {
    const tpl = buildRichTemplate(unit(id));
    tpl.rich.geo.computeBoundingBox();
    return tpl.rich.geo.boundingBox;
  };
  // a long tail (the extra 'tail') reaches well behind the rump of the corvids'
  assert.ok(box('egyptian_bennu').min.x < box('norse_raven').min.x - 0.3, 'the Bennu\'s tail is long');
  assert.ok(box('chinese_fenghuang').min.x < box('celtic_battle_crow').min.x - 0.3, 'the fenghuang\'s tail is long');
  // flames ride the Bennu's body and flicker
  const bennu = buildUnitModel(unit('egyptian_bennu'), PLAYER_COLORS[0], { detail: 'rich' });
  assert.ok(bennu.rich.flames.length > 0, 'the Bennu has flames');
  for (const f of bennu.rich.flames) assert.equal(f.morphTargetInfluences.length, 1);
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    bennu.animate('idle', i / 30, 1 / 30, {});
    seen.add(bennu.rich.flames[0].morphTargetInfluences[0].toFixed(3));
  }
  assert.ok(seen.size > 5, 'the flames flicker');
  bennu.dispose();
  const fenghuang = buildUnitModel(unit('chinese_fenghuang'), PLAYER_COLORS[0], { detail: 'rich' });
  assert.equal(fenghuang.rich.flames.length, 0, 'the fenghuang does not burn');
  fenghuang.dispose();
  // the mane costs hair on top of the same body: the Anzu is heavier than the raven
  const tri = (id) => buildRichTemplate(unit(id)).triangles;
  assert.ok(tri('mesopotamian_anzu') > tri('norse_raven') + 300, 'the lion\'s head and mane');
  // the two crows are built alike
  assert.equal(tri('norse_raven'), tri('celtic_battle_crow'), 'the same corvid body');
});

// ---------------------------------------------------------------------------
// serpents, the hydra and the eastern dragons
// ---------------------------------------------------------------------------

test('the serpents, the hydra and the dragons are built by the rich builder, as far as it can dress them', () => {
  for (const pair of [...SERPENTS, ...HYDRAS, ...DRAGONS]) {
    const u = look(pair);
    assert.ok(creatureSupported(u), `${u.id} is a rich creature`);
    assert.ok(richSupported(u), `${u.id} is supported`);
  }
  // only what the plan builds is let through: any other serpent keeps its low-poly model
  const apep = unit('egyptian_apep');
  assert.ok(!richSupported(withVisual(apep, () => ({ weapon: 'sword' }))), 'a serpent holds nothing');
  assert.ok(!richSupported(withVisual(apep, () => ({ head: 'wolf' }))), 'a head the plan has no table for');
  assert.ok(!richSupported(withVisual(apep, (v) => ({ extras: [...v.extras, 'wings'] }))), 'wings are not built on a serpent');
  assert.ok(!richSupported(withVisual(apep, () => ({ heads: 3 }))), 'a serpent has one head, the hydra has many');
  const tiamat = unit('mesopotamian_tiamat');
  assert.ok(!richSupported(withVisual(tiamat, (v) => ({ extras: [...v.extras, 'wings'] }))), 'a winged dragon keeps its low-poly model');
  assert.ok(!richSupported(withVisual(tiamat, () => ({ headgear: 'helmet' }))), 'a dragon wears no helmet');
  assert.ok(richSupported(withVisual(tiamat, () => ({ headgear: 'antlers' }))), 'antlers are built');
  assert.ok(richSupported(withVisual(unit('chinese_celestial_dragon'), () => ({ offhand: 'orb' }))), 'a pearl is built');
  const orochi = unit('japanese_yamata_no_orochi');
  assert.ok(richSupported(withVisual(orochi, () => ({ heads: 5 }))), 'a hydra of any ordinary number of necks is built');
  assert.ok(richSupported(withVisual(orochi, () => ({ heads: 99 }))), 'a titan hydra is built with up to nine necks (the cap every unit has)');
  assert.ok(!richSupported({ ...withVisual(orochi, () => ({ heads: 7 })), class: 'creature' }), 'seven necks do not fit the creature budget');
  assert.ok(richSupported({ ...withVisual(orochi, () => ({ heads: 6 })), class: 'creature' }), 'six necks do');
  assert.ok(!richSupported(withVisual(orochi, (v) => ({ extras: [...v.extras, 'wings'] }))), 'a winged hydra keeps its low-poly model');
  assert.ok(!richSupported(withVisual(orochi, () => ({ headgear: 'crown' }))), 'a hydra wears no crown');
});

test('every serpent, hydra and dragon builds a valid skinned mesh inside the rich budget', () => {
  for (const pair of LONG_BODIES) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    assert.equal(tpl.kind, UNITS[u.id].visual.body, `${u.id} keeps its kind so the low-poly animate switch still dispatches`);
    assert.equal(tpl.rich.plan, 'serpent');
    checkSkinned(u, tpl);
    for (const name of ['root', 's0', 'n1', 'n2', 'n3', 'head', 'jaw', 'b1', 'b4', 'b7']) {
      assert.ok(tpl.rich.ix[name] !== undefined, `${u.id} has a ${name} bone`);
    }
  }
  for (const pair of HYDRAS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    assert.equal(tpl.kind, 'hydra');
    assert.equal(tpl.rich.plan, 'hydra');
    checkSkinned(u, tpl);
  }
});

test('Low and Medium keep the low-poly serpents; High and Ultra swap in the rich ones', () => {
  for (const pair of [...SERPENTS, ...HYDRAS, ...DRAGONS]) {
    const u = look(pair);
    const base = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'base' });
    assert.equal(base.rich, null, `${u.id} stays low-poly on Low and Medium`);
    const rich = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
    assert.ok(rich.rich, `${u.id} is rich on High and Ultra`);
    assert.ok(rich.root.getObjectByName('body')?.isSkinnedMesh, `${u.id}: one skinned body`);
    assert.equal(rich.air, base.air, `${u.id} keeps its flight`);
    for (const m of [base, rich]) m.dispose();
  }
  assert.ok(buildUnitModel(unit('chinese_celestial_dragon'), PLAYER_COLORS[0], { detail: 'rich' }).air, 'the celestial dragon flies');
});

test('every serpent, hydra and dragon animates every state without a NaN, through the same pose keys', () => {
  for (const pair of [...SERPENTS, ...HYDRAS, ...DRAGONS]) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[2], { detail: 'rich' });
    runStates(m, u.id);
    m.dispose();
  }
});

test('a serpent undulates down its length while it travels and rears and lunges to strike', () => {
  const m = buildUnitModel(unit('egyptian_apep'), PLAYER_COLORS[1], { detail: 'rich' });
  const ix = m.rich.ix;
  const range = (a) => Math.max(...a) - Math.min(...a);
  const yaw = (name, state, moving, steps = 90) => {
    const out = [];
    m.animate('idle', 0, 0, {});
    for (let i = 0; i < steps; i++) {
      m.animate(state, i / 30, 1 / 30, { moving });
      out.push(m.rich.bones[ix[name]].rotation.y);
    }
    return out;
  };
  // the wave runs down the bones: stronger toward the tail, stronger while it travels than while it lies
  const mid = range(yaw('b3', 'move', true));
  const tail = range(yaw('b7', 'move', true));
  const still = range(yaw('b7', 'idle', false));
  assert.ok(mid > 0.1, `the body bends from side to side (${mid.toFixed(2)})`);
  assert.ok(tail > mid, 'the wave grows toward the tail');
  assert.ok(tail > still * 1.5, `it undulates harder while it travels (${tail.toFixed(2)} against ${still.toFixed(2)})`);
  // the wave travels: the bones do not swing in step
  m.animate('idle', 0, 0, {});
  let apart = 0;
  for (let i = 0; i < 60; i++) {
    m.animate('move', i / 30, 1 / 30, { moving: true });
    apart = Math.max(apart, Math.abs(m.rich.bones[ix.b2].rotation.y - m.rich.bones[ix.b5].rotation.y));
  }
  assert.ok(apart > 0.1, 'a wave runs down the body, not a swing of the whole');
  // a strike: the neck leans forward, the jaw opens and the whole body lunges
  m.animate('idle', 0, 0, {});
  for (let i = 0; i < 20; i++) m.animate('idle', i / 30, 1 / 30, {});
  const rest = { n: m.rich.bones[ix.n2].rotation.z, jaw: m.rich.bones[ix.jaw].rotation.z, x: m.rich.bones[ix.root].position.x };
  const peak = { n: rest.n, jaw: rest.jaw, x: rest.x };
  for (let i = 0; i < 40; i++) {
    m.animate('attack', i / 30, 1 / 30, { attackPhase: Math.min(0.99, i / 30) });
    peak.n = Math.min(peak.n, m.rich.bones[ix.n2].rotation.z);
    peak.jaw = Math.min(peak.jaw, m.rich.bones[ix.jaw].rotation.z);
    peak.x = Math.max(peak.x, m.rich.bones[ix.root].position.x);
  }
  assert.ok(peak.jaw < rest.jaw - 0.2, `the jaw opens (${rest.jaw.toFixed(2)} -> ${peak.jaw.toFixed(2)})`);
  assert.ok(Math.abs(peak.n - rest.n) > 0.05, 'the neck bends into the strike');
  assert.ok(peak.x > rest.x + 0.02, 'the body lunges forward');
  m.dispose();
});

test('an eastern dragon walks on four short legs in diagonal pairs and tucks them in flight', () => {
  const walker = buildUnitModel(unit('mesopotamian_tiamat'), PLAYER_COLORS[1], { detail: 'rich' });
  const ix = walker.rich.ix;
  for (const k of ['F1', 'F-1', 'B1', 'B-1']) for (const part of ['u', 'l', 'p']) assert.ok(ix[`${k}${part}`] !== undefined, `Tiamat has a ${k}${part} bone`);
  walker.animate('idle', 0, 0, {});
  const swing = [];
  for (let i = 0; i < 90; i++) {
    walker.animate('move', i / 30, 1 / 30, { moving: true });
    swing.push(['F1u', 'F-1u', 'B1u', 'B-1u'].map((n) => walker.rich.bones[ix[n]].rotation.z));
  }
  const range = (a) => Math.max(...a) - Math.min(...a);
  for (let k = 0; k < 4; k++) assert.ok(range(swing.map((s) => s[k])) > 0.5, `leg ${k} swings`);
  assert.ok(swing.some((s) => Math.abs(s[0] - s[1]) > 0.5), 'the left and right legs are out of step');
  assert.ok(swing.some((s) => Math.abs(s[0] - s[3]) < 0.1), 'a front leg moves with the opposite hind one');
  walker.dispose();
  // the celestial dragon flies: its legs hang folded under it, and a serpent has none
  const flyer = buildUnitModel(unit('chinese_celestial_dragon'), PLAYER_COLORS[1], { detail: 'rich' });
  flyer.animate('idle', 0, 0, {});
  const fold = [];
  for (let i = 0; i < 90; i++) {
    flyer.animate('move', i / 30, 1 / 30, { moving: true });
    fold.push(flyer.rich.bones[flyer.rich.ix.F1u].rotation.z);
  }
  assert.ok(range(fold) < 0.1 && fold[0] < -0.5, 'in the air the legs stay tucked, not walking');
  assert.equal(buildRichTemplate(unit('egyptian_apep')).rich.ix.F1u, undefined, 'a serpent has no legs');
  flyer.dispose();
});

test('the hydra has a neck of three bones to each of its eight heads, and each head looks about on its own', () => {
  const u = unit('japanese_yamata_no_orochi');
  const tpl = buildRichTemplate(u);
  for (let i = 0; i < 8; i++) for (const c of ['a', 'b', 'c', 'h', 'j']) assert.ok(tpl.rich.ix[`h${i}${c}`] !== undefined, `neck ${i} has a ${c} bone`);
  assert.equal(tpl.rich.ix.h8a, undefined, 'no ninth neck');
  for (const name of ['legFR', 'legFL', 'legBR', 'legBL', 't1', 't4']) assert.ok(tpl.rich.ix[name] !== undefined, `the hydra has a ${name} bone`);
  // the heads stand apart in a fan across the shoulders
  const hz = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => tpl.rich.spec.pos[tpl.rich.ix[`h${i}h`]][2]);
  assert.ok(Math.max(...hz) - Math.min(...hz) > 0.8, 'the heads fan out');
  for (let i = 1; i < 8; i++) assert.ok(hz[i] > hz[i - 1] - 0.02, 'in order from one side to the other');
  const m = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
  const seen = [new Set(), new Set()];
  for (let i = 0; i < 120; i++) {
    m.animate('idle', i / 30, 1 / 30, {});
    seen[0].add(m.rich.bones[m.rich.ix.h0c].rotation.y.toFixed(2));
    seen[1].add(m.rich.bones[m.rich.ix.h5c].rotation.y.toFixed(2));
  }
  assert.ok(seen[0].size > 10 && seen[1].size > 10, 'the necks sway while it stands');
  m.animate('idle', 0.5, 1 / 30, {});
  const a = m.rich.bones[m.rich.ix.h0c].rotation.y;
  const b = m.rich.bones[m.rich.ix.h5c].rotation.y;
  assert.notEqual(a.toFixed(3), b.toFixed(3), 'the necks are out of step');
  // every jaw opens in a strike
  const jaws = [0, 3, 7].map((i) => m.rich.bones[m.rich.ix[`h${i}j`]]);
  const closed = jaws.map((j) => j.rotation.z);
  const open = [...closed];
  for (let i = 0; i < 40; i++) {
    m.animate('attack', i / 30, 1 / 30, { attackPhase: Math.min(0.99, i / 30) });
    jaws.forEach((j, k) => { open[k] = Math.min(open[k], j.rotation.z); });
  }
  jaws.forEach((j, k) => assert.ok(open[k] < closed[k] - 0.1, `jaw ${k} opens`));
  m.dispose();
});

test('what a serpent wears comes from its visual: flames, spikes, a mane, antlers, a pearl', () => {
  const tri = (u) => buildRichTemplate(u).triangles;
  const tiamat = unit('mesopotamian_tiamat');
  // antlers and a mane cost triangles on top of the same body
  assert.ok(tri(withVisual(tiamat, () => ({ headgear: 'antlers' }))) > tri(withVisual(tiamat, () => ({ headgear: 'none' }))) + 100, 'antlers');
  assert.ok(tri(withVisual(tiamat, (v) => ({ extras: [...v.extras, 'mane'] }))) > tri(tiamat) + 500, 'a mane');
  const celestial = unit('chinese_celestial_dragon');
  assert.ok(tri(withVisual(celestial, (v) => ({ extras: v.extras.filter((e) => e !== 'spikes') }))) < tri(celestial), 'spikes');
  // a pearl rides ahead of the head's jaws, skinned to the head bone
  const pearl = (offhand) => tri(withVisual(celestial, () => ({ offhand })));
  assert.ok(pearl('orb') > pearl('none'), 'the pearl');
  // flames ride the Xiuhcoatl's back and flicker
  const xiuh = buildUnitModel(unit('aztec_xiuhcoatl'), PLAYER_COLORS[0], { detail: 'rich' });
  assert.ok(xiuh.rich.flames.length > 0, 'the fire serpent burns');
  for (const f of xiuh.rich.flames) assert.equal(f.morphTargetInfluences.length, 1);
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    xiuh.animate('idle', i / 30, 1 / 30, {});
    seen.add(xiuh.rich.flames[0].morphTargetInfluences[0].toFixed(3));
  }
  assert.ok(seen.size > 5, 'the flames flicker');
  xiuh.dispose();
  const apep = buildUnitModel(unit('egyptian_apep'), PLAYER_COLORS[0], { detail: 'rich' });
  assert.equal(apep.rich.flames.length, 0, 'Apep does not burn');
  apep.dispose();
  // a titan is thicker and glows with rune rings: it costs more than a plain serpent of the same body
  assert.ok(tri(unit('egyptian_apep')) > tri(unit('west_african_onini')), 'a titan serpent is richer than a minion');
});

// ---------------------------------------------------------------------------
// lizards: a crocodile and a dragon-headed beast on the four-legged skeleton (rich-reptile.js)
// ---------------------------------------------------------------------------

test('the lizards are built by the rich builder, as far as it can dress them', () => {
  for (const pair of LIZARDS) {
    const u = look(pair);
    assert.ok(creatureSupported(u), `${u.id} is a rich creature`);
    assert.ok(richSupported(u), `${u.id} is supported`);
  }
  // only what the plan builds is let through: any other lizard keeps its low-poly model
  const croc = unit('aztec_cipactli');
  assert.ok(!richSupported(withVisual(croc, () => ({ weapon: 'sword' }))), 'a lizard holds nothing');
  assert.ok(!richSupported(withVisual(croc, () => ({ headgear: 'crown' }))), 'a crocodile wears nothing on its head');
  assert.ok(!richSupported(withVisual(croc, (v) => ({ extras: [...v.extras, 'wings'] }))), 'wings are not built on a lizard');
  assert.ok(!richSupported(withVisual(croc, () => ({ heads: 2 }))), 'a lizard has one head');
  assert.ok(!richSupported(withVisual(croc, () => ({ head: 'gorilla' }))), 'a head no plan has a table for');
  const mushussu = unit('mesopotamian_mushussu');
  for (const headgear of ['none', 'horns', 'antlers', 'crown']) assert.ok(richSupported(withVisual(mushussu, () => ({ headgear }))), `a dragon's head in ${headgear} is built`);
  assert.ok(!richSupported(withVisual(mushussu, () => ({ headgear: 'helmet' }))), 'a dragon wears no helmet');
  assert.ok(!richSupported(withVisual(mushussu, (v) => ({ extras: [...v.extras, 'rider'] }))), 'nobody rides it');
});

test('every lizard builds a valid skinned mesh inside the rich budget, on the four-legged skeleton', () => {
  for (const pair of LIZARDS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    assert.equal(tpl.kind, 'quadruped', `${u.id} keeps its kind so the low-poly animate switch still dispatches`);
    assert.equal(tpl.rich.plan, 'quadruped', `${u.id} is posed like a four-legged beast`);
    checkSkinned(u, tpl);
    for (const name of ['root', 'hips', 'spine', 'chest', 'neck1', 'neck2', 'head', 'jaw', 'tail1', 'tail4', 'F1u', 'F-1l', 'B1p', 'B-1u']) {
      assert.ok(tpl.rich.ix[name] !== undefined, `${u.id} has a ${name} bone`);
    }
    assert.equal(tpl.rich.ix.earR, undefined, `${u.id} has no ears`);
    // the team's color is on the body (bands round a big one, a cloth on a small one)
    const fx = tpl.rich.geo.attributes.aFx.array;
    let team = 0;
    for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0.5) team++;
    assert.ok(team > 30, `${u.id} wears the team's color`);
  }
});

test('Low and Medium keep the low-poly lizards; High and Ultra swap in the rich ones', () => {
  for (const pair of LIZARDS) {
    const u = look(pair);
    const base = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'base' });
    assert.equal(base.rich, null, `${u.id} stays low-poly on Low and Medium`);
    const rich = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
    assert.ok(rich.rich, `${u.id} is rich on High and Ultra`);
    assert.ok(rich.root.getObjectByName('body')?.isSkinnedMesh, `${u.id}: one skinned body`);
    for (const m of [base, rich]) m.dispose();
  }
});

test('every lizard animates every state without a NaN, through the same pose keys', () => {
  for (const pair of LIZARDS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[2], { detail: 'rich' });
    runStates(m, u.id);
    m.dispose();
  }
});

test('a lizard stands with its elbows out to the sides and its trunk wags harder than a beast\'s as it walks', () => {
  for (const pair of LIZARDS) {
    const tpl = buildRichTemplate(look(pair));
    const { ix, spec } = tpl.rich;
    for (const side of ['1', '-1']) {
      const [shoulder, elbow] = [`F${side}u`, `F${side}l`].map((n) => spec.pos[ix[n]]);
      assert.equal(Math.sign(elbow[2]), Math.sign(shoulder[2]), `${pair[1]}: the elbow is on its own side`);
      assert.ok(Math.abs(elbow[2]) > Math.abs(shoulder[2]) * 1.5, `${pair[1]}: the elbow stands out from the shoulder`);
    }
    assert.equal(tpl.rig.sprawl, true, `${pair[1]} sprawls, so it wags`);
  }
  assert.equal(buildRichTemplate(unit('norse_wolf_of_fenrir')).rig.sprawl, false, 'a beast keeps the plain gait');
  const yaw = (model) => {
    const out = [];
    model.animate('idle', 0, 0, {});
    for (let i = 0; i < 90; i++) {
      model.animate('move', i / 30, 1 / 30, { moving: true });
      out.push(model.rich.bones[model.rich.ix.spine].rotation.y);
    }
    return Math.max(...out) - Math.min(...out);
  };
  const croc = buildUnitModel(unit('aztec_cipactli'), PLAYER_COLORS[1], { detail: 'rich' });
  const wolf = buildUnitModel(unit('norse_wolf_of_fenrir'), PLAYER_COLORS[1], { detail: 'rich' });
  assert.ok(yaw(croc) > yaw(wolf) * 1.5, 'the lizard\'s spine bends further from side to side');
  for (const m of [croc, wolf]) m.dispose();
});

test('a crocodile opens its jaws to bite and its legs and tail follow the walk', () => {
  const m = buildUnitModel(unit('aztec_cipactli'), PLAYER_COLORS[1], { detail: 'rich' });
  const ix = m.rich.ix;
  const jaw = m.rich.bones[ix.jaw];
  m.animate('idle', 0, 0, {});
  const closed = jaw.rotation.z;
  let open = closed;
  for (let i = 0; i < 40; i++) {
    m.animate('attack', i / 30, 1 / 30, { attackPhase: i / 40 });
    open = Math.min(open, jaw.rotation.z);
  }
  assert.ok(open < closed - 0.15, `the jaw opens (${closed.toFixed(2)} -> ${open.toFixed(2)})`);
  m.animate('idle', 0, 0, {});
  const swing = [];
  const tail = [];
  for (let i = 0; i < 90; i++) {
    m.animate('move', i / 30, 1 / 30, { moving: true });
    swing.push(['F1u', 'F-1u', 'B1u', 'B-1u'].map((n) => m.rich.bones[ix[n]].rotation.z));
    tail.push(m.rich.bones[ix.tail3].rotation.y);
  }
  const range = (a) => Math.max(...a) - Math.min(...a);
  for (let k = 0; k < 4; k++) assert.ok(range(swing.map((x) => x[k])) > 0.3, `leg ${k} swings`);
  assert.ok(range(tail) > 0.05, 'the tail waves');
  m.dispose();
});

test('what a lizard wears comes from its visual: scutes down the back, the gear on a dragon\'s head', () => {
  const tri = (u) => buildRichTemplate(u).triangles;
  const croc = unit('aztec_cipactli');
  assert.ok(tri(withVisual(croc, (v) => ({ extras: v.extras.filter((e) => e !== 'spikes') }))) < tri(croc) - 100, 'scutes cost triangles on top of the same body');
  const mushussu = unit('mesopotamian_mushussu');
  assert.ok(tri(withVisual(mushussu, () => ({ headgear: 'antlers' }))) > tri(withVisual(mushussu, () => ({ headgear: 'none' }))) + 100, 'antlers');
  assert.ok(tri(withVisual(mushussu, (v) => ({ extras: v.extras.filter((e) => e !== 'spikes') }))) < tri(mushussu), 'spikes');
  // a big one is a crocodile of titan size: thicker legs, a team-colored band round its barrel
  assert.ok(tri(croc) > tri(mushussu), 'the titan crocodile is richer than the minion');
});
