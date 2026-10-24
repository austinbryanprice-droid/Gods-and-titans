// Tests for the rich insects (High and Ultra): the Egyptian Scarab, a beetle of lapis and gold (rich-insect.js), and the Mesopotamian
// Scorpion Man, a bowman rising from the carapace of a scorpion (rich-scorpion.js). Both run on one skinned mesh and a bone rig of their
// own; the pose keys of the low-poly rig (a stride, a lift for each of two sets of legs, a thrust of the sting) stay the source of truth
// and rich-insect-anim.js turns them into bone rotations. The scorpion man's person is dressed by the pantheon's outfit as any person is
// and posed as any rider is (rich-centaur-anim.js poseRider). Low and Medium keep the low-poly insects.
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
const { insectSupported, BEETLE_LEGS } = await import('../../src/render/models/rich-insect.js');
const { scorpionSupported, SCORPION_LEGS } = await import('../../src/render/models/rich-scorpion.js');
const { outfitFor, LAYERS } = await import('../../src/render/models/rich-outfits.js');
const { SCORPION_OUTFITS } = await import('../../src/render/models/rich-scorpion-outfits.js');
const { B, BONE_COUNT } = await import('../../src/render/models/rich-kit.js');
const { PROFILES } = await import('../../src/render/models/unit-bodies.js');
const { UNITS, MORTALS } = await import('../../src/data/index.js');
const { unitLook } = await import('../../src/render/models/unit-looks.js');
const { PLAYER_COLORS } = await import('../../src/config.js');
const { UnitFader, FadeMaterials } = await import('../../src/render/unit-fade.js');

// The same budget as the rich creatures.
const RICH_BUDGET = { creature: 10500 };
const STATES = ['idle', 'move', 'attack', 'cast', 'pray', 'dead'];

const INSECTS = [['egyptian', 'egyptian_scarab'], ['mesopotamian', 'mesopotamian_scorpion_man']];
const look = ([pantheon, id]) => unitLook(UNITS[id], pantheon);
const scarab = look(INSECTS[0]);
const scorpion = look(INSECTS[1]);
const withVisual = (u, change) => ({ ...u, visual: { ...u.visual, ...change(u.visual) } });

// the scarab's bones: root, body, head, two mandibles, two antennae of two bones, six legs of three
const SCARAB_BONES = 1 + 1 + 1 + 2 + 4 + 6 * 3;
// the scorpion's bones: the carapace, two of the abdomen, five of the tail, two of each pincer, eight legs of three
const SCORPION_BONES = 1 + 2 + 5 + 4 + 8 * 3;

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

/** A fingerprint of a template's body geometry: the sum of its vertex positions, weighted so that moving a vertex changes it. */
function fingerprint(tpl) {
  const p = tpl.rich.geo.attributes.position.array;
  let h = 0;
  for (let i = 0; i < p.length; i++) h += p[i] * (1 + (i % 97) * 0.013);
  return h;
}

test('the Scarab has a body plan of its own and the Scorpion Man is a person on a scorpion\'s body', () => {
  assert.equal(scarab.visual.body, 'insect');
  assert.ok(insectSupported(scarab.visual), 'the Scarab is a beetle the plan builds');
  assert.ok(creatureSupported(scarab) && richSupported(scarab), 'a creature body plan');
  assert.ok(!scorpionSupported(scarab.visual), 'it has no person on it');
  assert.equal(scorpion.visual.body, 'insect');
  assert.equal(scorpion.visual.head, 'human');
  assert.ok(scorpionSupported(scorpion.visual), 'the Scorpion Man is a scorpion the plan builds');
  assert.ok(richSupported(scorpion), 'supported');
  assert.ok(!creatureSupported(scorpion), 'not a creature body plan: he is dressed on the humanoid rig');
  assert.ok(!insectSupported(scorpion.visual), 'a beetle has no head of a person\'s');
  // only the heads, weapons, headgear and extras the plans dress are let through: any other insect keeps its low-poly model
  assert.ok(!richSupported(withVisual(scarab, () => ({ weapon: 'spear' }))), 'a beetle with a spear');
  assert.ok(!richSupported(withVisual(scarab, (v) => ({ extras: [...v.extras, 'wings'] }))), 'wings are not built for a beetle');
  assert.ok(!richSupported(withVisual(scarab, () => ({ head: 'lion' }))), 'a head that is not a beetle\'s');
  assert.ok(richSupported(withVisual(scarab, (v) => ({ extras: [...v.extras, 'eye_glow'] }))), 'glowing eyes are');
  assert.ok(!richSupported(withVisual(scorpion, () => ({ head: 'lion' }))), 'a head the kit has no table for');
  assert.ok(!richSupported(withVisual(scorpion, () => ({ heads: 2 }))), 'two heads');
  assert.ok(!richSupported(withVisual(scorpion, () => ({ headgear: 'helmet' }))), 'headgear sits on a person\'s head');
  assert.ok(!richSupported(withVisual(scorpion, (v) => ({ extras: [...v.extras, 'wings'] }))), 'wings are not built for a scorpion');
  assert.ok(richSupported(withVisual(scorpion, (v) => ({ extras: [...v.extras, 'cape'] }))), 'a cape is');
  // a scorpion man is dressed by his pantheon's outfit: one that has none for him keeps the low-poly model
  assert.ok(richSupported({ ...scorpion, lookOf: 'mesopotamian' }));
  assert.ok(!richSupported({ ...scorpion, lookOf: 'norse' }), 'no Norse scorpion man is dressed');
  // the others that stay low-poly are not insects
  for (const [pantheon, id] of [['greek', 'battering_ram']]) {
    assert.ok(!richSupported(unitLook(UNITS[id], pantheon)), `${id} stays low-poly`);
  }
});

test('the Scorpion Man is dressed by his own people and builds a scorpion where a person\'s legs would be', () => {
  const outfit = outfitFor('mesopotamian', 'insect');
  for (const layer of LAYERS) assert.equal(typeof outfit[layer], 'function', `the ${layer} layer`);
  assert.notEqual(outfit.legs, outfitFor('mesopotamian').legs, 'the legs are a scorpion\'s');
  assert.notEqual(outfit.torso, outfitFor('mesopotamian').torso, 'the scorpion man has a dress of his own');
  assert.equal(outfit.palette, outfitFor('mesopotamian').palette, 'and keeps his people\'s black hair');
  assert.ok(SCORPION_OUTFITS.mesopotamian);
  // only the pantheon with a scorpion man has one: the others keep their people's outfit as it was
  assert.equal(outfitFor('norse', 'insect').legs, outfitFor('norse').legs);
  assert.equal(outfitFor('mesopotamian').legs, outfitFor('mesopotamian', 'humanoid').legs);
  const bow = buildRichTemplate(scorpion).rich.attach.filter((a) => a.name.startsWith('weapon'));
  assert.equal(bow.length, 1, 'a bow');
  assert.equal(bow[0].bone, B.handL, 'in the left hand, as every archer\'s');
});

/** The checks every rich insect's template passes: a valid skinned mesh inside the budget, about as tall as its low-poly model. */
function checkSkinned(u, tpl, minTris) {
  const g = tpl.rich.geo;
  const budget = RICH_BUDGET[u.class] ?? RICH_BUDGET.creature;
  assert.ok(tpl.triangles > minTris, `${u.id}: suspiciously few triangles`);
  assert.ok(tpl.triangles <= budget, `${u.id}: ${tpl.triangles} triangles > ${budget}`);
  for (const name of ['position', 'normal', 'color', 'aFx', 'aAo']) finite(g.attributes[name].array, `${u.id} ${name}`);
  assert.equal(g.attributes.color.itemSize, 3, `${u.id}: a solid body has no alpha`);
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
  const base = getUnitModelInfo(u, 'base').height;
  const rich = getUnitModelInfo(u, 'rich').height;
  assert.ok(rich > base * 0.6 && rich < base * 1.5, `${u.id}: rich height ${rich.toFixed(2)} vs base ${base.toFixed(2)}`);
}

test('both insects build a valid skinned mesh inside the rich budget', () => {
  const seen = new Set();
  for (const pair of INSECTS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    checkSkinned(u, tpl, 3000);
    assert.equal(tpl.kind, 'insect', 'it keeps its kind: the pose of an insect');
    assert.equal(tpl.rich.ghost ?? false, false, 'an insect is solid');
    assert.equal(tpl.rig.humanTop, u.id === 'mesopotamian_scorpion_man', 'only the scorpion man has a person on top');
    seen.add(fingerprint(tpl));
  }
  assert.equal(seen.size, 2, 'no two insects are the same mesh');
  assert.equal(buildRichTemplate(scarab).rich.plan, 'insect');
  assert.equal(buildRichTemplate(scorpion).rich.plan, 'scorpion');
  // an insect builds the same mesh every time
  for (const u of [scarab, scorpion]) assert.equal(fingerprint(buildRichTemplate(u)), fingerprint(buildRichTemplate(u)));
  // and a lean build (fewer sides and rings) of the scorpion man is a smaller, valid mesh
  const lean = buildRichTemplate(scorpion, 0.7);
  assert.ok(lean.triangles < buildRichTemplate(scorpion).triangles * 0.95, 'the lean build is smaller');
  finite(lean.rich.geo.attributes.position.array, 'lean positions');
});

test('the Scarab\'s skeleton is a body, a head with two mandibles and two antennae, and three legs a side', () => {
  const { spec } = buildRichTemplate(scarab).rich;
  assert.equal(spec.pos.length, SCARAB_BONES);
  assert.equal(spec.names.length, spec.pos.length);
  const { ix } = spec;
  assert.equal(spec.parent[ix.body], ix.root);
  assert.equal(spec.parent[ix.head], ix.body);
  for (const k of ['mandR', 'mandL', 'antR1', 'antL1']) assert.equal(spec.parent[ix[k]], ix.head, `${k} hangs from the head`);
  assert.equal(spec.parent[ix.antR2], ix.antR1);
  assert.equal(spec.parent[ix.antL2], ix.antL1);
  assert.equal(BEETLE_LEGS.length, 6);
  for (const key of BEETLE_LEGS) {
    assert.equal(spec.parent[ix[`${key}u`]], ix.body, `${key} hangs from the body`);
    assert.equal(spec.parent[ix[`${key}l`]], ix[`${key}u`]);
    assert.equal(spec.parent[ix[`${key}p`]], ix[`${key}l`]);
  }
  const at = (name) => spec.pos[ix[name]];
  assert.ok(at('head')[0] > at('body')[0], 'the head is in front');
  for (const pair of [['F1', 'F-1'], ['M1', 'M-1'], ['B1', 'B-1']]) assert.ok(at(`${pair[0]}u`)[2] * at(`${pair[1]}u`)[2] < 0, 'a leg a side');
  assert.ok(at('F1u')[0] > at('M1u')[0] && at('M1u')[0] > at('B1u')[0], 'the legs run front to back');
  for (const key of BEETLE_LEGS) assert.ok(at(`${key}p`)[1] < 0.1, 'the ankles are near the ground');
  assert.ok(spec.fit, 'the loft binds fit the rest pose');
});

test('the Scorpion Man\'s skeleton is the humanoid\'s and the scorpion\'s: the person\'s pelvis hangs from the carapace', () => {
  const { spec } = buildRichTemplate(scorpion).rich;
  assert.equal(spec.pos.length, BONE_COUNT + SCORPION_BONES);
  assert.equal(spec.names.length, spec.pos.length);
  const { ix } = spec;
  assert.equal(spec.parent[ix.body], B.root, 'the scorpion starts at the root');
  assert.equal(spec.parent[ix.meso1], ix.body);
  assert.equal(spec.parent[ix.meso2], ix.meso1);
  assert.equal(spec.parent[ix.tail1], ix.meso2, 'the tail grows from the end of the abdomen');
  for (const i of [2, 3, 4, 5]) assert.equal(spec.parent[ix[`tail${i}`]], ix[`tail${i - 1}`], 'a chain of five');
  assert.equal(spec.parent[B.pelvis], ix.body, 'the person\'s pelvis hangs from the carapace');
  for (const k of ['R', 'L']) {
    assert.equal(spec.parent[ix[`palp${k}1`]], ix.body);
    assert.equal(spec.parent[ix[`palp${k}2`]], ix[`palp${k}1`]);
  }
  assert.equal(SCORPION_LEGS.length, 8, 'four pairs');
  for (const key of SCORPION_LEGS) {
    assert.equal(spec.parent[ix[`${key}u`]], ix.body, `${key} hangs from the carapace`);
    assert.equal(spec.parent[ix[`${key}l`]], ix[`${key}u`]);
    assert.equal(spec.parent[ix[`${key}p`]], ix[`${key}l`]);
  }
  // the scorpion lies along x: carapace in front, the abdomen behind it, the tail rising over the back from the end of it
  const at = (name) => spec.pos[ix[name]];
  assert.ok(at('body')[0] > at('meso1')[0] && at('meso1')[0] > at('meso2')[0] && at('meso2')[0] > at('tail1')[0], 'the body runs front to back');
  assert.ok(at('tail5')[1] > at('tail1')[1] + 0.3, 'the tail rises over the back');
  assert.ok(at('tail5')[0] > at('tail3')[0], 'and curls forward over it');
  assert.ok(spec.pos[B.pelvis][0] > at('body')[0] - 0.05, 'the person stands over the front of the carapace');
  assert.ok(spec.pos[B.pelvis][1] > at('body')[1], 'on its back');
  for (const key of SCORPION_LEGS) assert.ok(at(`${key}p`)[1] < 0.12, 'the ankles are near the ground');
  for (const pair of [['a1', 'a-1'], ['b1', 'b-1'], ['c1', 'c-1'], ['d1', 'd-1']]) assert.ok(at(`${pair[0]}u`)[2] * at(`${pair[1]}u`)[2] < 0, 'a leg a side');
  assert.ok(spec.fit, 'the loft binds fit the rest pose');
  // a person has none of it: the humanoid builds are not touched
  const warrior = buildRichTemplate(unitLook(MORTALS.warrior, 'mesopotamian'));
  assert.equal(warrior.rich.spec.pos.length, BONE_COUNT);
  assert.equal(warrior.rich.spec.ix, undefined);
});

test('the Scarab stands on its six legs and the Scorpion Man on eight, with the tail behind and the person over the front', () => {
  const box = (u) => buildRichTemplate(u).rich.geo.boundingBox;
  const s = box(scarab);
  assert.ok(s.min.y > -0.02 && s.min.y < 0.02, `the scarab's feet rest on the ground (${s.min.y.toFixed(3)})`);
  assert.ok(s.max.y < 0.4 && s.max.y > 0.25, `a low beetle (${s.max.y.toFixed(3)})`);
  assert.ok(s.max.x - s.min.x > 0.8 && s.max.x - s.min.x < 1.2, `about a body's length with the legs (${(s.max.x - s.min.x).toFixed(2)})`);
  assert.ok(s.max.z < 0.45 && s.min.z > -0.45, 'the legs splay a little to the sides');
  const m = box(scorpion);
  assert.ok(m.min.y > -0.02 && m.min.y < 0.02, `the scorpion man's feet rest on the ground (${m.min.y.toFixed(3)})`);
  assert.ok(m.max.y > 0.8 && m.max.y < 1.0, `the person stands tall over the carapace (${m.max.y.toFixed(3)})`);
  assert.ok(m.min.x < -0.45, `the tail trails behind (${m.min.x.toFixed(3)})`);
  assert.ok(m.max.x > 0.45 && m.max.x < 0.75, `the pincers reach out in front, no further (${m.max.x.toFixed(3)})`);
  assert.ok(m.max.z < 0.5 && m.min.z > -0.5, 'the legs spread no further than the radius of the unit');
  // the person is the low-poly person's: the same profile, set on the carapace
  const { dims } = buildRichTemplate(scorpion).rich;
  assert.ok(Math.abs(dims.headR / PROFILES.scorpion.headR - 1) < 1e-9, 'a person of the low-poly build');
  assert.ok(dims.hipY > 0.15, 'raised to stand on the carapace');
  for (const k of ['hipY', 'shoulderY', 'headY', 'chestW', 'waistW']) {
    assert.equal(PROFILES.scorpion[k], k === 'hipY' ? 0 : k === 'shoulderY' ? 0.36 : k === 'headY' ? 0.52 : k === 'chestW' ? 0.34 : 0.24, `profile ${k}`);
  }
});

test('the scorpion\'s body follows its own bones and the person follows the person\'s: nothing of one rides the other', () => {
  const tpl = buildRichTemplate(scorpion);
  const g = tpl.rich.geo;
  const p = g.attributes.position.array;
  const idx = g.attributes.skinIndex.array;
  const w = g.attributes.skinWeight.array;
  const pelvis = tpl.rich.spec.pos[B.pelvis];
  let behind = 0;
  let behindScorpion = 0;
  let high = 0;
  let highPerson = 0;
  for (let i = 0; i < g.attributes.position.count; i++) {
    let own = 0;
    for (let k = 0; k < 4; k++) if (idx[i * 4 + k] >= BONE_COUNT) own += w[i * 4 + k];
    const y = p[i * 3 + 1];
    const x = p[i * 3];
    if (x < pelvis[0] - 0.3) {
      behind++;
      behindScorpion += own;
    } else if (y > pelvis[1] + 0.3 && x > pelvis[0] - 0.12) {
      // (above the waist and over the person: not the sting, which hooks forward over the back and is skinned to the tail)
      high++;
      highPerson += 1 - own;
    }
  }
  assert.ok(behind > 800 && high > 1000, `both halves have vertices (${behind}, ${high})`);
  assert.ok(behindScorpion / behind > 0.99, `the abdomen and the tail are skinned to the scorpion's bones (${(behindScorpion / behind).toFixed(3)})`);
  assert.ok(highPerson / high > 0.99, `the person above the waist to the person's (${(highPerson / high).toFixed(3)})`);
});

test('the team\'s color is on the Scarab\'s seam and on the scorpion man\'s shawl, headband and the plates down his back, so the owner can be told from above', () => {
  const team = (u, pick) => {
    const g = buildRichTemplate(u).rich.geo;
    const fx = g.attributes.aFx.array;
    const p = g.attributes.position.array;
    let n = 0;
    for (let i = 0; i < g.attributes.position.count; i++) if (fx[i * 4] > 0 && pick(p[i * 3], p[i * 3 + 1])) n++;
    return n;
  };
  assert.ok(team(scarab, () => true) > 60, 'the beetle\'s seam');
  assert.ok(team(scorpion, (x, y) => y < 0.5 && x < -0.05) > 40, 'the plates of the abdomen');
  assert.ok(team(scorpion, (x, y) => y > 0.5) > 100, 'the shawl and the headband of the man');
});

test('Low and Medium keep the low-poly insects; High and Ultra swap in the rich ones', () => {
  const expected = { egyptian_scarab: [426, 0.33854], mesopotamian_scorpion_man: [966, 1.0409] };
  for (const pair of INSECTS) {
    const u = look(pair);
    const info = getUnitModelInfo(u, 'base');
    assert.equal(info.triangles, expected[u.id][0], `${u.id}: the low-poly insect is what it was`);
    assert.ok(Math.abs(info.height - expected[u.id][1]) < 1e-3);
    assert.equal(info.kind, 'insect');
    assert.equal(info.rich, false);
    const base = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'base' });
    assert.equal(base.rich, null, `${u.id} stays low-poly on Low and Medium`);
    const rich = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
    assert.ok(rich.rich, `${u.id} is rich on High and Ultra`);
    assert.equal(rich.kind, 'insect');
    const body = rich.root.getObjectByName('body');
    assert.ok(body?.isSkinnedMesh, `${u.id}: one skinned body`);
    assert.ok(!body.material.transparent, 'it is drawn solid');
    assert.equal(rich.rich.plan, u.id === 'egyptian_scarab' ? 'insect' : 'scorpion', 'the instance runs its own pose');
    for (const m of [base, rich]) m.dispose();
  }
});

test('an insect fades in and out at the edge of the player\'s vision like any other unit', () => {
  for (const u of [scarab, scorpion]) {
    const m = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
    const body = m.root.getObjectByName('body');
    const base = body.material;
    const fader = new UnitFader(m.root);
    const mats = new FadeMaterials();
    fader.apply(0.5, mats);
    assert.notEqual(body.material, base, 'a variant while it fades');
    assert.ok(body.material.alphaHash && Math.abs(body.material.opacity - 0.5) < 1e-9, 'half as opaque, hashed like any solid body');
    fader.apply(1, mats);
    assert.equal(body.material, base, 'the same material when it is fully there');
    mats.dispose();
    m.dispose();
  }
});

test('every insect animates every state without a NaN, through the same pose keys, even one first seen dead', () => {
  for (const pair of INSECTS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[2], { detail: 'rich' });
    runStates(m, u.id);
    m.dispose();
    // (a unit that comes into view already dead: its first pose is the last)
    const d = buildUnitModel(u, PLAYER_COLORS[2], { detail: 'rich' });
    d.animate('dead', 0, 1 / 30, {});
    d.root.updateMatrixWorld(true);
    d.rich.mesh.skeleton.update();
    finite(d.rich.mesh.skeleton.boneMatrices, `${u.id} first seen dead`);
    d.dispose();
  }
});

/** Walk a model for a few seconds and report the range of each named leg's swing (about the vertical) and lift (about its axis), and how high the lowest vertex gets. */
function walk(u, legs, thigh) {
  const m = buildUnitModel(u, PLAYER_COLORS[1], { detail: 'rich' });
  const { bones, ix, mesh } = m.rich;
  const v = new THREE.Vector3();
  const n = mesh.geometry.attributes.position.count;
  const swing = Object.fromEntries(legs.map((k) => [k, [Infinity, -Infinity]]));
  const lift = Object.fromEntries(legs.map((k) => [k, [Infinity, -Infinity]]));
  let minY = 9;
  for (let i = 0; i < 120; i++) {
    m.animate('move', i / 30, 1 / 30, { moving: true });
    for (const k of legs) {
      const r = bones[ix[`${k}${thigh}`]].rotation;
      swing[k] = [Math.min(swing[k][0], r.y), Math.max(swing[k][1], r.y)];
      lift[k] = [Math.min(lift[k][0], r.x), Math.max(lift[k][1], r.x)];
    }
    if (i < 30 || i % 5) continue;
    m.root.updateMatrixWorld(true);
    mesh.skeleton.update();
    for (let k = 0; k < n; k += 11) {
      mesh.getVertexPosition(k, v);
      v.applyMatrix4(mesh.matrixWorld);
      minY = Math.min(minY, v.y);
    }
  }
  m.dispose();
  return { swing, lift, minY };
}

test('walking, the Scarab steps with its legs in two alternating sets, each swinging and lifting, and its feet meet the ground', () => {
  const { swing, lift, minY } = walk(scarab, BEETLE_LEGS, 'u');
  for (const k of BEETLE_LEGS) {
    assert.ok(swing[k][1] - swing[k][0] > 0.6, `the ${k} leg swings (${(swing[k][1] - swing[k][0]).toFixed(2)})`);
    assert.ok(lift[k][1] - lift[k][0] > 0.12, `the ${k} leg lifts (${(lift[k][1] - lift[k][0]).toFixed(2)})`);
  }
  assert.ok(minY > -0.04 && minY < 0.04, `the feet meet the ground, not sink into it or hang over it (${minY.toFixed(3)})`);
  // the two sets alternate: when the right front foot is forward of where it stands at rest the left front one is behind its own
  const m = buildUnitModel(scarab, PLAYER_COLORS[1], { detail: 'rich' });
  const { bones, ix } = m.rich;
  const foot = (key) => new THREE.Vector3().setFromMatrixPosition(bones[ix[key]].matrixWorld);
  m.animate('idle', 0, 0, {});
  m.root.updateMatrixWorld(true);
  const rest = { right: foot('F1p').x, left: foot('F-1p').x };
  let opposed = 0;
  let frames = 0;
  for (let i = 0; i < 90; i++) {
    m.animate('move', i / 30, 1 / 30, { moving: true });
    if (i < 20) continue;
    m.root.updateMatrixWorld(true);
    frames++;
    if ((foot('F1p').x - rest.right) * (foot('F-1p').x - rest.left) < 0) opposed++;
  }
  assert.ok(opposed > frames * 0.6, `the sets are out of step (${opposed} of ${frames})`);
  m.dispose();
});

test('walking, the Scorpion Man steps with eight legs and the person rides steady on the carapace', () => {
  const { swing, lift, minY } = walk(scorpion, SCORPION_LEGS, 'u');
  for (const k of SCORPION_LEGS) {
    assert.ok(swing[k][1] - swing[k][0] > 0.4, `the ${k} leg swings (${(swing[k][1] - swing[k][0]).toFixed(2)})`);
    assert.ok(lift[k][1] - lift[k][0] > 0.1, `the ${k} leg lifts (${(lift[k][1] - lift[k][0]).toFixed(2)})`);
  }
  assert.ok(minY > -0.05 && minY < 0.05, `the feet meet the ground (${minY.toFixed(3)})`);
  const up = new THREE.Vector3();
  const m = buildUnitModel(scorpion, PLAYER_COLORS[1], { detail: 'rich' });
  const { bones } = m.rich;
  let tilt = 0;
  for (let i = 0; i < 120; i++) {
    m.animate('move', i / 30, 1 / 30, { moving: true });
    if (i < 30) continue;
    m.root.updateMatrixWorld(true);
    up.set(0, 1, 0).transformDirection(bones[B.chest].matrixWorld);
    tilt = Math.max(tilt, Math.acos(Math.min(1, up.y)));
  }
  assert.ok(tilt < 0.2, `his chest stays within 0.2 rad of upright (${tilt.toFixed(3)})`);
  m.dispose();
});

test('the Scarab rears and snaps its mandibles in a bite, and its antennae feel ahead', () => {
  const m = buildUnitModel(scarab, PLAYER_COLORS[3], { detail: 'rich' });
  const { bones, ix } = m.rich;
  const range = (f) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 90; i++) {
      m.animate('attack', i / 30, 1 / 30, { attackPhase: (i % 45) / 45 });
      const x = f();
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    return hi - lo;
  };
  assert.ok(range(() => bones[ix.mandR].rotation.y) > 0.4, 'the mandibles open and shut');
  assert.ok(range(() => bones[ix.head].rotation.z) > 0.4, 'the head rears and snaps down');
  assert.ok(range(() => bones[ix.root].position.x) > 0.05, 'the body lunges');
  let wave = 0;
  const a = bones[ix.antR1];
  const before = a.rotation.y;
  for (let i = 0; i < 90; i++) {
    m.animate('idle', i / 30, 1 / 30, {});
    wave = Math.max(wave, Math.abs(a.rotation.y - before));
  }
  assert.ok(wave > 0.03, `the antennae feel about while it stands (${wave.toFixed(3)})`);
  m.dispose();
});

test('the Scorpion Man draws his bow as the strike lands: the tail uncurls its joints and the sting comes forward and down', () => {
  const v = new THREE.Vector3();
  const m = buildUnitModel(scorpion, PLAYER_COLORS[3], { detail: 'rich' });
  const { bones, ix } = m.rich;
  const tailEnd = () => {
    m.root.updateMatrixWorld(true);
    return v.setFromMatrixPosition(bones[ix.tail5].matrixWorld).clone();
  };
  m.animate('idle', 0, 0, {});
  const rest = tailEnd();
  let best = 0;
  let curl = 0;
  const hand = new THREE.Vector3();
  let handHi = -9;
  let handLo = 9;
  for (let i = 0; i < 90; i++) {
    m.animate('attack', i / 30, 1 / 30, { attackPhase: (i % 45) / 45 });
    const tip = tailEnd();
    best = Math.max(best, tip.x - rest.x);
    curl = Math.max(curl, Math.abs(bones[ix.tail3].rotation.z));
    hand.setFromMatrixPosition(bones[B.handR].matrixWorld);
    handHi = Math.max(handHi, hand.y);
    handLo = Math.min(handLo, hand.y);
  }
  assert.ok(best > 0.1, `the tail's end comes forward over the back (${best.toFixed(3)})`);
  assert.ok(curl > 0.15, `the joints bend through the strike (${curl.toFixed(3)})`);
  assert.ok(handHi - handLo > 0.1, 'the drawing arm moves through the shot');
  // (standing, the tail sways a little: it is never rigid)
  const sway = [];
  for (let i = 0; i < 90; i++) {
    m.animate('idle', 2 + i / 30, 1 / 30, {});
    sway.push(bones[ix.tail2].rotation.y);
  }
  assert.ok(Math.max(...sway) - Math.min(...sway) > 0.005, 'the tail sways while he stands');
  m.dispose();
});

test('the Scorpion Man\'s pelvis turns back against the body\'s pitch, so the person is not tipped in a blow', () => {
  const up = new THREE.Vector3();
  const tilt = (bone) => Math.abs(Math.atan2(up.set(0, 1, 0).transformDirection(bone.matrixWorld).x, up.y));
  const m = buildUnitModel(scorpion, PLAYER_COLORS[3], { detail: 'rich' });
  const { bones, ix } = m.rich;
  let root = 0;
  let pelvis = 0;
  for (let i = 0; i < 90; i++) {
    m.animate('attack', i / 30, 1 / 30, { attackPhase: (i % 45) / 45 });
    m.root.updateMatrixWorld(true);
    root = Math.max(root, tilt(bones[B.root]));
    pelvis = Math.max(pelvis, tilt(bones[B.pelvis]));
  }
  assert.ok(root > 0.03, `the body pitches in the blow (${root.toFixed(3)})`);
  assert.ok(pelvis < root * 0.7, `the person's pelvis turns some of it back (${pelvis.toFixed(3)} against ${root.toFixed(3)})`);
  assert.ok(bones[ix.body], 'the carapace is the pelvis\'s parent');
  m.dispose();
});

test('an insect that dies topples like any other unit and its bones stay finite', () => {
  for (const pair of INSECTS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[3], { detail: 'rich' });
    for (let i = 0; i < 40; i++) m.animate('dead', i / 30, 1 / 30, {});
    assert.ok(Math.abs(m.rigGroup.rotation.x) > 1.0, `${u.id}: it falls over`);
    m.root.updateMatrixWorld(true);
    m.rich.mesh.skeleton.update();
    finite(m.rich.mesh.skeleton.boneMatrices, `${u.id} after death`);
    m.dispose();
  }
});
