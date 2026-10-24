// Tests for the rich beast bipeds (High and Ultra): the Hindu Vanara, the Ugallu (a lion-headed storm demon), the Sasabonsam (a bat
// with iron teeth and leathery wings) and the Bultungin (a were-hyena). They stand and walk on two legs, so they are dressed on the
// humanoid rig by their people's outfit (rich-humanoid.js, the body 'beast_biped': hunched, long in the arm, bare); what makes
// them beasts is rich-beast.js (claws, taloned feet and paws, a mane, a crest, tails), their heads rich-beast-heads.js and the
// Sasabonsam's wings rich-beast-wings.js. Low and Medium keep the low-poly models.
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
const { outfitFor } = await import('../../src/render/models/rich-outfits.js');
const { B } = await import('../../src/render/models/rich-kit.js');
const { UNITS } = await import('../../src/data/index.js');
const { unitLook } = await import('../../src/render/models/unit-looks.js');
const { PLAYER_COLORS } = await import('../../src/config.js');

// The same budgets as the rich humanoids and creatures: a creature, a minion.
const RICH_BUDGET = { creature: 10500, minion: 8500 };
const STATES = ['idle', 'move', 'attack', 'cast', 'dead'];

const BEAST_BIPEDS = [
  ['hindu', 'hindu_vanara'], ['mesopotamian', 'mesopotamian_ugallu'], ['west_african', 'west_african_sasabonsam'], ['west_african', 'west_african_bultungin'],
];
const look = ([pantheon, id]) => unitLook(UNITS[id], pantheon);
const BY_ID = Object.fromEntries(BEAST_BIPEDS.map((pair) => [pair[1], look(pair)]));
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

/** The world position of a bone of the model's skeleton, by name (the humanoid rig's: rich-kit.js B). */
function bonePos(model, name) {
  model.root.updateMatrixWorld(true);
  return model.rich.bones[B[name]].getWorldPosition(new THREE.Vector3());
}

/** A fingerprint of a template's body geometry: the sum of its vertex positions, weighted so that moving a vertex changes it. */
function fingerprint(tpl) {
  const p = tpl.rich.geo.attributes.position.array;
  let h = 0;
  for (let i = 0; i < p.length; i++) h += p[i] * (1 + (i % 97) * 0.013);
  return h;
}

test('the beast bipeds are built by the rich builder on the humanoid rig, as far as it can dress them', () => {
  for (const pair of BEAST_BIPEDS) {
    const u = look(pair);
    assert.equal(u.visual.body, 'beast_biped');
    assert.ok(richSupported(u), `${u.id} is supported`);
    assert.ok(!creatureSupported(u), `${u.id} is not a creature body plan: it is dressed on the humanoid rig`);
  }
  // only the heads and extras the kit builds are let through: any other beast keeps its low-poly model
  const ugallu = unit('mesopotamian_ugallu');
  assert.ok(!richSupported(withVisual(ugallu, () => ({ head: 'gorilla' }))), 'a head the kit has no table for');
  assert.ok(!richSupported(withVisual(ugallu, (v) => ({ extras: [...v.extras, 'rider'] }))), 'a rider is not dressed');
  assert.ok(richSupported(withVisual(ugallu, () => ({ head: 'wolf' }))), 'the hyena\'s head would do on any of them');
  // the people's upright beasts that the humanoid code already dressed (the Chinese monkeys) are still dressed
  for (const id of ['chinese_sun_wukong', 'chinese_monkey_clone']) assert.ok(richSupported(unitLook(UNITS[id], 'chinese')), `${id} is still supported`);
});

/** The checks every rich beast biped's template passes: a valid skinned mesh with rigid pieces on top, inside the budget, about as tall as its low-poly model. */
function checkSkinned(u, tpl) {
  const g = tpl.rich.geo;
  const budget = RICH_BUDGET[u.class] ?? RICH_BUDGET.creature;
  assert.ok(tpl.triangles > 3000, `${u.id}: suspiciously few triangles`);
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
  const base = getUnitModelInfo(u, 'base').height;
  const rich = getUnitModelInfo(u, 'rich').height;
  assert.ok(rich > base * 0.6 && rich < base * 1.5, `${u.id}: rich height ${rich.toFixed(2)} vs base ${base.toFixed(2)}`);
}

test('every beast biped builds a valid skinned mesh inside the rich budget', () => {
  for (const pair of BEAST_BIPEDS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    checkSkinned(u, tpl);
    // the skeleton is the humanoid's (23 bones), and four more for wings
    assert.equal(tpl.rich.spec.pos.length, u.visual.extras.includes('wings') ? 27 : 23, `${u.id}: the humanoid skeleton`);
  }
});

test('Low and Medium keep the low-poly beasts; High and Ultra swap in the rich ones', () => {
  for (const pair of BEAST_BIPEDS) {
    const u = look(pair);
    const base = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'base' });
    assert.equal(base.rich, null, `${u.id} stays low-poly on Low and Medium`);
    const rich = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
    assert.ok(rich.rich, `${u.id} is rich on High and Ultra`);
    assert.ok(rich.root.getObjectByName('body')?.isSkinnedMesh, `${u.id}: one skinned body`);
    for (const m of [base, rich]) m.dispose();
  }
});

test('every beast biped animates every state without a NaN, through the same pose keys', () => {
  for (const pair of BEAST_BIPEDS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[2], { detail: 'rich' });
    runStates(m, u.id);
    m.dispose();
  }
});

test('they carry what they are known by: a club, a mace, claws and nothing else', () => {
  const names = (id) => buildRichTemplate(unit(id)).rich.attach.filter((x) => !x.tool).map((x) => x.name).sort();
  assert.deepEqual(names('hindu_vanara'), ['weaponR'], 'the Vanara\'s club');
  assert.deepEqual(names('mesopotamian_ugallu'), ['weaponR'], 'the Ugallu\'s mace');
  assert.deepEqual(names('west_african_bultungin'), [], 'the Bultungin fights with its claws and its jaws: nothing in the hand');
  assert.deepEqual(names('west_african_sasabonsam'), ['wingL1', 'wingL2', 'wingR1', 'wingR2'], 'the Sasabonsam has its wings and its claws');
});

test('each beast has a head of its own: a lion\'s, a hyena\'s, a bat\'s, a monkey\'s', () => {
  const print = (u) => fingerprint(buildRichTemplate(u));
  const ugallu = unit('mesopotamian_ugallu');
  const lion = print(ugallu);
  const hyena = print(withVisual(ugallu, () => ({ head: 'wolf' })));
  const monkey = print(withVisual(ugallu, () => ({ head: 'monkey' })));
  assert.notEqual(lion, hyena, 'the lion\'s head is not the hyena\'s');
  assert.notEqual(lion, monkey);
  assert.notEqual(hyena, monkey);
  // the bat's head is the demon's on a beast biped (a person who wears the oni's still gets the oni)
  const sasabonsam = unit('west_african_sasabonsam');
  const bat = print(sasabonsam);
  assert.notEqual(bat, print(withVisual(sasabonsam, () => ({ head: 'jackal' }))), 'the bat is not a jackal');
  assert.notEqual(bat, print(withVisual(sasabonsam, () => ({ body: 'humanoid' }))), 'nor the oni of the people');
});

test('the Ugallu\'s mane and tail, the Bultungin\'s crest and tail, the Vanara\'s tail are all extras of their visual', () => {
  const tris = (u) => buildRichTemplate(u).triangles;
  const ugallu = unit('mesopotamian_ugallu');
  assert.ok(tris(ugallu) > tris(withVisual(ugallu, (v) => ({ extras: v.extras.filter((e) => e !== 'mane') }))) + 200, 'the mane is a few hundred triangles');
  assert.ok(tris(ugallu) > tris(withVisual(ugallu, (v) => ({ extras: v.extras.filter((e) => e !== 'tail') }))) + 50, 'and the tail some more');
  const bultungin = unit('west_african_bultungin');
  assert.ok(tris(bultungin) > tris(withVisual(bultungin, (v) => ({ extras: v.extras.filter((e) => e !== 'mane') }))) + 400, 'the crest of the hyena is a row of tufts');
  assert.ok(tris(bultungin) > tris(withVisual(bultungin, (v) => ({ extras: v.extras.filter((e) => e !== 'tail') }))) + 50);
  const vanara = unit('hindu_vanara');
  assert.ok(tris(vanara) > tris(withVisual(vanara, (v) => ({ extras: v.extras.filter((e) => e !== 'tail') }))) + 100, 'the monkey\'s long tail');
});

test('the Sasabonsam beats leathery wings in the air and lets them fall when it dies', () => {
  const tpl = buildRichTemplate(unit('west_african_sasabonsam'));
  for (const name of ['wingR1', 'wingR2', 'wingL1', 'wingL2']) {
    assert.ok(tpl.rich.attach.some((a) => a.name === name && a.wing), `the Sasabonsam has ${name} as a rigid wing piece`);
    assert.ok(B[name] < tpl.rich.spec.pos.length, `and a ${name} bone`);
  }
  // a membrane is a few broad sheets between long fingers: its triangles are not a feathered wing's
  const feathered = buildRichTemplate(withVisual(unit('west_african_sasabonsam'), () => ({ body: 'humanoid' })));
  const tri = (t, side) => t.rich.attach.filter((a) => a.name.startsWith(side)).reduce((n, a) => n + a.geo.index.count / 3, 0);
  assert.notEqual(tri(tpl, 'wingR'), tri(feathered, 'wingR'), 'a bat\'s wing is not a bird\'s');
  const m = buildUnitModel(unit('west_african_sasabonsam'), PLAYER_COLORS[0], { detail: 'rich' });
  assert.ok(m.air, 'the Sasabonsam flies');
  const ys = [];
  for (let i = 0; i < 40; i++) {
    m.animate('move', i / 30, 1 / 30, { moving: true });
    ys.push(bonePos(m, 'wingR2').y - bonePos(m, 'wingR1').y);
  }
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.3, 'the wing beats up and down in flight');
  const right = bonePos(m, 'wingR2');
  const left = bonePos(m, 'wingL2');
  assert.ok(right.z * left.z < 0 || Math.abs(right.z - left.z) > 0.1, 'the wings are on the two sides');
  m.dispose();
});

test('the Bultungin\'s coat is spotted and the other beasts\' are furred', () => {
  const wa = outfitFor('west_african');
  const E = (id) => ({ ctx: { unit: { id } }, pal: { skin: new THREE.Color('#b0925e') } });
  const paint = wa.skinPaint(E('west_african_bultungin'));
  assert.equal(typeof paint, 'function', 'a paint for the bare skin');
  let dark = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const o = { r: 0.45, g: 0.3, b: 0.12 };
    paint(o, Math.sin(i * 12.9) * 0.3, 0.5 + Math.cos(i * 7.7) * 0.3, Math.sin(i * 3.3) * 0.25, 0, 0);
    if (o.r < 0.3) dark++;
  }
  assert.ok(dark > N * 0.12 && dark < N * 0.6, `spots cover a part of the coat, not all of it (${dark}/${N})`);
  assert.equal(wa.skinPaint(E('west_african_sasabonsam')), null, 'no spots on the Sasabonsam');
  assert.equal(wa.skinPaint(E('warrior')), null, 'nor on the people');
  assert.equal(typeof outfitFor('mesopotamian').skinPaint, 'function', 'the Ugallu\'s fur is painted over its skin');
});

test('a beast stands hunched, long in the arm and low on its legs, unlike the people', () => {
  const tpl = (u) => buildRichTemplate(u);
  const bult = tpl(unit('west_african_bultungin'));
  const man = tpl(unitLook(UNITS.west_african_shango, 'west_african'));
  assert.ok(bult.rig.lean < man.rig.lean, 'the beast leans forward more than a man');
  assert.ok(bult.rig.hipY < man.rig.hipY, 'its hips are lower');
});
