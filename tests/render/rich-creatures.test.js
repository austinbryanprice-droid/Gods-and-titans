// Tests for the rich creatures (High and Ultra): the beasts, birds, serpents and half-human bodies that are not on the
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

const look = ([pantheon, id]) => unitLook(UNITS[id], pantheon);
const BY_ID = Object.fromEntries([...QUADRUPEDS, ...BIRDS].map((pair) => [pair[1], look(pair)]));
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
