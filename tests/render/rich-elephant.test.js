// Tests for the rich elephant (High and Ultra): Airavata, the white king of elephants, with the three heads of his legend and Indra on his
// back (rich-elephant.js). One skinned mesh on the humanoid's bones for the person (dressed by the pantheon's outfit as any person is, the
// layers of rich-elephant-outfits.js laid over it, and posed as any rider is, rich-centaur-anim.js poseRider) and the elephant's own for the
// back, the tail, the four legs and each head with its trunk and ears (rich-elephant-anim.js). The pose keys of the low-poly rig (a stride, a
// bend and a swing for each leg, the head's pitch and yaw, the arms') stay the source of truth. Low and Medium keep the low-poly elephant.
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
const { elephantSupported, elephantFrame, ELEPHANT_LEGS, HEADS } = await import('../../src/render/models/rich-elephant.js');
const { outfitFor, LAYERS } = await import('../../src/render/models/rich-outfits.js');
const { ELEPHANT_OUTFITS } = await import('../../src/render/models/rich-elephant-outfits.js');
const { richDims } = await import('../../src/render/models/rich-body.js');
const { B, BONE_COUNT } = await import('../../src/render/models/rich-kit.js');
const { PROFILES, unitContext } = await import('../../src/render/models/unit-bodies.js');
const { UNITS, MORTALS } = await import('../../src/data/index.js');
const { unitLook } = await import('../../src/render/models/unit-looks.js');
const { PLAYER_COLORS } = await import('../../src/config.js');
const { UnitFader, FadeMaterials } = await import('../../src/render/unit-fade.js');

// The titans' budget, as the other rich creatures'.
const RICH_BUDGET = { titan: 14000 };
const STATES = ['idle', 'move', 'attack', 'cast', 'pray', 'dead'];

const airavata = unitLook(UNITS.hindu_airavata, 'hindu');
const withVisual = (u, change) => ({ ...u, visual: { ...u.visual, ...change(u.visual) } });

// the elephant's bones: the back's three, four of the tail, four legs of three, and for each of the three heads its own, five of the trunk and two of the ears
const ELEPHANT_BONES = 3 + 4 + 4 * 3 + 3 * (1 + 5 + 2);

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

test('Airavata is an elephant under a person: the plan dresses him, a body plan of its own', () => {
  assert.equal(airavata.visual.body, 'elephant');
  assert.equal(airavata.visual.heads, 3);
  assert.ok(elephantSupported(airavata.visual), 'the white king of elephants is one the plan builds');
  assert.ok(richSupported(airavata), 'supported');
  assert.ok(!creatureSupported(airavata), 'not a creature body plan: his rider is dressed on the humanoid rig');
  // only the heads, headgear, weapons and extras the plan dresses are let through: any other elephant keeps its low-poly model
  assert.ok(richSupported(withVisual(airavata, () => ({ heads: 1 }))), 'one head is');
  assert.ok(!richSupported(withVisual(airavata, () => ({ heads: 2 }))), 'two heads are not');
  assert.ok(!richSupported(withVisual(airavata, () => ({ heads: 5 }))), 'five heads are not');
  assert.ok(!richSupported(withVisual(airavata, () => ({ head: 'lion' }))), 'a head that is not an elephant\'s');
  assert.ok(!richSupported(withVisual(airavata, () => ({ headgear: 'helmet' }))), 'a helmet is not an elephant\'s headdress');
  assert.ok(richSupported(withVisual(airavata, () => ({ headgear: 'none' }))), 'bare heads are');
  assert.ok(!richSupported(withVisual(airavata, () => ({ weapon: 'spear' }))), 'what the rider holds is his outfit\'s: no weapon of the unit\'s');
  assert.ok(!richSupported(withVisual(airavata, (v) => ({ extras: [...v.extras, 'wings'] }))), 'wings are not built for an elephant');
  assert.ok(!richSupported(withVisual(airavata, () => ({ extras: ['jewelry'] }))), 'an elephant with no rider has no plan');
  assert.ok(richSupported(withVisual(airavata, () => ({ extras: ['rider'] }))), 'no jewelry is fine');
  // the rider is dressed by his pantheon's outfit: one that has none for him keeps the low-poly model
  assert.ok(richSupported({ ...airavata, lookOf: 'hindu' }));
  assert.ok(!richSupported({ ...airavata, lookOf: 'norse' }), 'no Norse elephant is dressed');
  // the others that stay low-poly are not elephants
  assert.ok(!richSupported(unitLook(UNITS.battering_ram, 'greek')), 'the ram stays low-poly');
});

test('the person on Airavata is dressed by his own people and the elephant is built where a person\'s legs would be', () => {
  const outfit = outfitFor('hindu', 'elephant');
  for (const layer of LAYERS) assert.equal(typeof outfit[layer], 'function', `the ${layer} layer`);
  assert.notEqual(outfit.legs, outfitFor('hindu').legs, 'the legs are an elephant\'s');
  assert.notEqual(outfit.torso, outfitFor('hindu').torso, 'the rider has a dress of his own');
  assert.notEqual(outfit.palette, outfitFor('hindu').palette, 'and a skin of his own: the white is the elephant\'s');
  assert.deepEqual(ELEPHANT_OUTFITS.hindu.rider, { head: 'human', headgear: 'tall_crown', weapon: 'lightning_bolt', offhand: 'none' }, 'a god with a person\'s head, a tiered crown and a thunderbolt');
  // only the pantheon with an elephant has one: the others keep their people's outfit as it was
  assert.equal(outfitFor('norse', 'elephant').legs, outfitFor('norse').legs);
  assert.equal(outfitFor('hindu').legs, outfitFor('hindu', 'humanoid').legs);
  const attach = buildRichTemplate(airavata).rich.attach;
  const bolt = attach.filter((a) => a.name.startsWith('weapon'));
  assert.equal(bolt.length, 1, 'a thunderbolt');
  assert.equal(bolt[0].bone, B.handR, 'in his right hand');
  assert.ok(attach.some((a) => a.name === 'prabhavali' && a.bone === B.head), 'and the flaming arch behind his head');
  // the person has a head and a crown of his own whatever the elephant's: the unit's visual is the elephant's
  const ctx = unitContext(airavata);
  assert.equal(ctx.v.head, 'elephant');
  assert.equal(ctx.v.headgear, 'headdress');
});

/** The checks every rich elephant's template passes: a valid skinned mesh inside the budget, about as tall as its low-poly model. */
function checkSkinned(u, tpl, minTris) {
  const g = tpl.rich.geo;
  const budget = RICH_BUDGET[u.class];
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

test('Airavata builds a valid skinned mesh inside the rich budget, as a quadruped with a person on top', () => {
  const tpl = buildRichTemplate(airavata);
  checkSkinned(airavata, tpl, 8000);
  assert.equal(tpl.kind, 'quadruped', 'it keeps its kind: the pose of a four-legged animal');
  assert.equal(tpl.rich.plan, 'elephant');
  assert.equal(tpl.rich.ghost ?? false, false, 'an elephant is solid');
  assert.equal(tpl.rig.humanTop, true, 'the person on top is posed by the arm keys');
  assert.equal(tpl.rig.elephant, true, 'the elephant\'s walk and blow');
  assert.equal(tpl.rig.gait, 'walk');
  // an elephant builds the same mesh every time
  assert.equal(fingerprint(tpl), fingerprint(buildRichTemplate(airavata)));
  // one head is a smaller mesh, a valid one, with the bones of the others gone
  const one = buildRichTemplate(withVisual(airavata, () => ({ heads: 1 })));
  assert.ok(one.triangles < tpl.triangles - 1500, `one head is a lighter mesh (${one.triangles} against ${tpl.triangles})`);
  assert.equal(one.rich.spec.pos.length, tpl.rich.spec.pos.length - 2 * 8, 'and has the bones of one head');
  assert.deepEqual(Object.keys(one.rich.spec.ix).filter((k) => /^h\d$/.test(k)), ['h0']);
  checkSkinned(withVisual(airavata, () => ({ heads: 1 })), one, 6000);
  // and a lean build (fewer sides and rings) is a smaller, valid mesh
  const lean = buildRichTemplate(airavata, 0.7);
  assert.ok(lean.triangles < tpl.triangles * 0.95, 'the lean build is smaller');
  finite(lean.rich.geo.attributes.position.array, 'lean positions');
});

test('Airavata\'s skeleton is the humanoid\'s and the elephant\'s: the person\'s pelvis hangs from the back', () => {
  const { spec } = buildRichTemplate(airavata).rich;
  assert.equal(spec.pos.length, BONE_COUNT + ELEPHANT_BONES);
  assert.equal(spec.names.length, spec.pos.length);
  const { ix } = spec;
  assert.equal(spec.parent[ix.hips], B.root, 'the elephant starts at the root');
  assert.equal(spec.parent[ix.back], ix.hips);
  assert.equal(spec.parent[ix.withers], ix.back);
  assert.equal(spec.parent[ix.tail1], ix.hips, 'the tail grows from the rump');
  for (const i of [2, 3, 4]) assert.equal(spec.parent[ix[`tail${i}`]], ix[`tail${i - 1}`], 'a chain of four');
  assert.equal(spec.parent[B.pelvis], ix.back, 'the person\'s pelvis hangs from the back, where the howdah is');
  assert.equal(ELEPHANT_LEGS.length, 4);
  for (const key of ELEPHANT_LEGS) {
    assert.equal(spec.parent[ix[`${key}u`]], key[0] === 'F' ? ix.withers : ix.hips, `${key} hangs from the shoulders or the hips`);
    assert.equal(spec.parent[ix[`${key}l`]], ix[`${key}u`]);
    assert.equal(spec.parent[ix[`${key}p`]], ix[`${key}l`]);
  }
  assert.equal(HEADS.length, 3);
  for (let i = 0; i < 3; i++) {
    const h = `h${i}`;
    assert.equal(spec.parent[ix[h]], ix.withers, `${h} grows from the shoulders`);
    assert.equal(spec.parent[ix[`${h}t1`]], ix[h], 'the trunk hangs from the head');
    for (const k of [2, 3, 4, 5]) assert.equal(spec.parent[ix[`${h}t${k}`]], ix[`${h}t${k - 1}`], 'a chain of five');
    assert.equal(spec.parent[ix[`${h}eR`]], ix[h]);
    assert.equal(spec.parent[ix[`${h}eL`]], ix[h]);
  }
  const at = (name) => spec.pos[ix[name]];
  assert.ok(at('withers')[0] > at('back')[0] && at('back')[0] > at('hips')[0] && at('hips')[0] > at('tail1')[0] - 0.05, 'the body runs front to back');
  assert.ok(at('tail4')[1] < at('tail1')[1] - 0.3, 'the tail hangs');
  assert.ok(at('h0')[0] > at('withers')[0], 'the heads are in front of the shoulders');
  assert.ok(at('h1')[2] > 0.2 && at('h2')[2] < -0.2 && Math.abs(at('h0')[2]) < 1e-9, 'one in the middle, one on each side');
  for (let i = 0; i < 3; i++) {
    for (const k of [2, 3, 4, 5]) assert.ok(at(`h${i}t${k}`)[1] < at(`h${i}t${k - 1}`)[1], 'the trunk hangs down');
    assert.ok(at(`h${i}eR`)[2] > at(`h${i}eL`)[2], 'an ear each side');
  }
  assert.ok(spec.pos[B.pelvis][1] > at('back')[1], 'the person sits over the back');
  for (const key of ELEPHANT_LEGS) assert.ok(at(`${key}p`)[1] < 0.15, 'the ankles are near the ground');
  for (const pair of [['F1', 'F-1'], ['B1', 'B-1']]) assert.ok(at(`${pair[0]}u`)[2] * at(`${pair[1]}u`)[2] < 0, 'a leg a side');
  assert.ok(at('F1u')[0] > at('B1u')[0], 'the front legs are in front of the hind ones');
  assert.ok(spec.fit, 'the loft binds fit the rest pose');
  // a person has none of it: the humanoid builds are not touched
  const warrior = buildRichTemplate(unitLook(MORTALS.warrior, 'hindu'));
  assert.equal(warrior.rich.spec.pos.length, BONE_COUNT);
  assert.equal(warrior.rich.spec.ix, undefined);
});

test('Airavata stands on four pillars with the tail behind, the heads in front, and the person over the back', () => {
  const tpl = buildRichTemplate(airavata);
  const m = tpl.rich.geo.boundingBox;
  assert.ok(m.min.y > -0.02 && m.min.y < 0.02, `the feet rest on the ground (${m.min.y.toFixed(3)})`);
  assert.ok(m.max.y > 1.3 && m.max.y < 1.7, `an elephant with a king on it (${m.max.y.toFixed(3)})`);
  assert.ok(m.min.x < -0.5 && m.min.x > -0.8, `the tail trails behind (${m.min.x.toFixed(3)})`);
  assert.ok(m.max.x > 0.7 && m.max.x < 1.1, `the trunks and the tusks reach out in front (${m.max.x.toFixed(3)})`);
  assert.ok(m.max.z < 0.8 && m.min.z > -0.8, 'the side heads spread no further than that');
  assert.ok(m.max.z > 0.45 && m.min.z < -0.45, 'a head each side');
  // the person is the scorpion man's profile, a smaller person, set on the cushion of the howdah
  const { dims } = tpl.rich;
  assert.ok(Math.abs(dims.headR / PROFILES.scorpion.headR - 0.72) < 1e-9, 'a person of the low-poly build, a little smaller');
  assert.ok(dims.hipY > 0.9 && dims.hipY < 1.0, `raised to sit on the cushion (${dims.hipY.toFixed(3)})`);
  const D = richDims(unitContext(airavata), 'rider');
  assert.ok(Math.abs(elephantFrame(D, airavata.visual).lift - (0.955 - D.hipY)) < 1e-9);
  assert.equal(elephantFrame(D, airavata.visual).heads.length, 3);
  assert.equal(elephantFrame(D, withVisual(airavata, () => ({ heads: 1 })).visual).heads.length, 1);
});

test('the elephant\'s body follows its own bones and the person follows the person\'s: nothing of one rides the other', () => {
  const tpl = buildRichTemplate(airavata);
  const g = tpl.rich.geo;
  const p = g.attributes.position.array;
  const idx = g.attributes.skinIndex.array;
  const w = g.attributes.skinWeight.array;
  const pelvis = tpl.rich.spec.pos[B.pelvis];
  let behind = 0;
  let behindElephant = 0;
  let high = 0;
  let highPerson = 0;
  for (let i = 0; i < g.attributes.position.count; i++) {
    let own = 0;
    for (let k = 0; k < 4; k++) if (idx[i * 4 + k] >= BONE_COUNT) own += w[i * 4 + k];
    const x = p[i * 3];
    const y = p[i * 3 + 1];
    const z = p[i * 3 + 2];
    if (x < pelvis[0] - 0.3) {
      behind++;
      behindElephant += own;
    } else if (y > pelvis[1] + 0.12 && Math.abs(x - pelvis[0]) < 0.15 && Math.abs(z) < 0.2) {
      // (above the cushion and over the person: not the plumes of the middle head, which stand in front of him)
      high++;
      highPerson += 1 - own;
    }
  }
  assert.ok(behind > 400 && high > 1000, `both halves have vertices (${behind}, ${high})`);
  assert.ok(behindElephant / behind > 0.99, `the rump and the tail are skinned to the elephant's bones (${(behindElephant / behind).toFixed(3)})`);
  assert.ok(highPerson / high > 0.99, `the person above the cushion to the person's (${(highPerson / high).toFixed(3)})`);
});

test('the team\'s color is on the caparison, the cushion, the foreheads and the rider\'s belt, so the owner can be told from above', () => {
  const g = buildRichTemplate(airavata).rich.geo;
  const fx = g.attributes.aFx.array;
  const p = g.attributes.position.array;
  const count = (pick) => {
    let n = 0;
    for (let i = 0; i < g.attributes.position.count; i++) if (fx[i * 4] > 0 && pick(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])) n++;
    return n;
  };
  assert.ok(count((x, y) => y < 0.95 && x < 0.2) > 150, 'the caparison over the back and down the flanks');
  assert.ok(count((x, y) => y > 0.95 && y < 1.05 && x < 0.1) > 20, 'the cushion of the howdah');
  assert.ok(count((x, y) => x > 0.3 && y > 0.6) > 30, 'the cloths on the foreheads');
  assert.ok(count((x, y) => y > 1.05) > 10, 'the rider\'s sash and cape');
});

test('Low and Medium keep the low-poly elephant; High and Ultra swap in the rich one', () => {
  const info = getUnitModelInfo(airavata, 'base');
  assert.equal(info.triangles, 1706, 'the low-poly elephant is what it was');
  assert.ok(Math.abs(info.height - 6.18016) < 1e-3);
  assert.equal(info.kind, 'quadruped');
  assert.equal(info.rich, false);
  const base = buildUnitModel(airavata, PLAYER_COLORS[0], { detail: 'base' });
  assert.equal(base.rich, null, 'it stays low-poly on Low and Medium');
  const rich = buildUnitModel(airavata, PLAYER_COLORS[0], { detail: 'rich' });
  assert.ok(rich.rich, 'it is rich on High and Ultra');
  assert.equal(rich.kind, 'quadruped');
  const body = rich.root.getObjectByName('body');
  assert.ok(body?.isSkinnedMesh, 'one skinned body');
  assert.ok(!body.material.transparent, 'it is drawn solid');
  assert.equal(rich.rich.plan, 'elephant', 'the instance runs its own pose');
  assert.ok(rich.aura, 'and keeps the glow of its aura');
  for (const m of [base, rich]) m.dispose();
});

test('Airavata fades in and out at the edge of the player\'s vision like any other unit', () => {
  const m = buildUnitModel(airavata, PLAYER_COLORS[0], { detail: 'rich' });
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
});

test('Airavata animates every state without a NaN, through the same pose keys, even one first seen dead', () => {
  const m = buildUnitModel(airavata, PLAYER_COLORS[2], { detail: 'rich' });
  runStates(m, airavata.id);
  m.dispose();
  // (a unit that comes into view already dead: its first pose is the last)
  const d = buildUnitModel(airavata, PLAYER_COLORS[2], { detail: 'rich' });
  d.animate('dead', 0, 1 / 30, {});
  d.root.updateMatrixWorld(true);
  d.rich.mesh.skeleton.update();
  finite(d.rich.mesh.skeleton.boneMatrices, `${airavata.id} first seen dead`);
  d.dispose();
  // and one with a single head
  const one = buildUnitModel(withVisual(airavata, () => ({ heads: 1 })), PLAYER_COLORS[2], { detail: 'rich' });
  runStates(one, 'one head');
  one.dispose();
});

test('walking, Airavata steps with four legs in a four-beat walk, each swinging and lifting, and his feet meet the ground', () => {
  const m = buildUnitModel(airavata, PLAYER_COLORS[1], { detail: 'rich' });
  const { bones, ix, mesh } = m.rich;
  const v = new THREE.Vector3();
  const n = mesh.geometry.attributes.position.count;
  const swing = Object.fromEntries(ELEPHANT_LEGS.map((k) => [k, [Infinity, -Infinity]]));
  const bend = Object.fromEntries(ELEPHANT_LEGS.map((k) => [k, [Infinity, -Infinity]]));
  let minY = 9;
  for (let i = 0; i < 160; i++) {
    m.animate('move', i / 30, 1 / 30, { moving: true });
    for (const k of ELEPHANT_LEGS) {
      swing[k] = [Math.min(swing[k][0], bones[ix[`${k}u`]].rotation.z), Math.max(swing[k][1], bones[ix[`${k}u`]].rotation.z)];
      bend[k] = [Math.min(bend[k][0], bones[ix[`${k}l`]].rotation.z), Math.max(bend[k][1], bones[ix[`${k}l`]].rotation.z)];
    }
    if (i < 40 || i % 5) continue;
    m.root.updateMatrixWorld(true);
    mesh.skeleton.update();
    for (let k = 0; k < n; k += 11) {
      mesh.getVertexPosition(k, v);
      v.applyMatrix4(mesh.matrixWorld);
      minY = Math.min(minY, v.y);
    }
  }
  for (const k of ELEPHANT_LEGS) {
    assert.ok(swing[k][1] - swing[k][0] > 0.6, `the ${k} leg swings (${(swing[k][1] - swing[k][0]).toFixed(2)})`);
    assert.ok(bend[k][0] < -0.25, `the ${k} leg bends at the knee as it comes forward (${bend[k][0].toFixed(2)})`);
  }
  assert.ok(minY > -0.05 * 3.8 && minY < 0.05 * 3.8, `the feet meet the ground (${(minY / 3.8).toFixed(3)} of his height)`);
  // the legs go in turn: the four feet are never all forward of their rest at once, nor all behind
  const foot = (key) => new THREE.Vector3().setFromMatrixPosition(bones[ix[key]].matrixWorld);
  m.animate('idle', 0, 0, {});
  m.root.updateMatrixWorld(true);
  const rest = Object.fromEntries(ELEPHANT_LEGS.map((k) => [k, foot(`${k}p`).x]));
  let front = 0;
  let behind = 0;
  let frames = 0;
  for (let i = 0; i < 160; i++) {
    m.animate('move', 5 + i / 30, 1 / 30, { moving: true });
    if (i < 40) continue;
    m.root.updateMatrixWorld(true);
    frames++;
    const d = ELEPHANT_LEGS.map((k) => foot(`${k}p`).x - rest[k]);
    if (d.every((x) => x > 0.01)) front++;
    if (d.every((x) => x < -0.01)) behind++;
  }
  assert.ok(front < frames * 0.1 && behind < frames * 0.1, `the legs take turns (${front} and ${behind} of ${frames})`);
  m.dispose();
});

test('walking, the rider sits steady on the howdah and the howdah rides the back', () => {
  const up = new THREE.Vector3();
  const m = buildUnitModel(airavata, PLAYER_COLORS[1], { detail: 'rich' });
  const { bones, ix } = m.rich;
  let tilt = 0;
  let back = [9, -9];
  for (let i = 0; i < 160; i++) {
    m.animate('move', i / 30, 1 / 30, { moving: true });
    if (i < 40) continue;
    m.root.updateMatrixWorld(true);
    up.set(0, 1, 0).transformDirection(bones[B.chest].matrixWorld);
    tilt = Math.max(tilt, Math.acos(Math.min(1, up.y)));
    const y = new THREE.Vector3().setFromMatrixPosition(bones[ix.back].matrixWorld).y;
    back = [Math.min(back[0], y), Math.max(back[1], y)];
  }
  assert.ok(tilt < 0.2, `his chest stays within 0.2 rad of upright (${tilt.toFixed(3)})`);
  assert.ok(back[1] - back[0] > 0.002 && back[1] - back[0] < 0.1, `the back bobs a little with the steps (${(back[1] - back[0]).toFixed(3)})`);
  m.dispose();
});

test('the three heads look about on their own, the trunks sway and the ears flap while he stands', () => {
  const m = buildUnitModel(airavata, PLAYER_COLORS[1], { detail: 'rich' });
  const { bones, ix } = m.rich;
  const range = { yaw: [[9, -9], [9, -9], [9, -9]], ear: [9, -9], trunk: [9, -9], tail: [9, -9] };
  const at = [];
  for (let i = 0; i < 360; i++) {
    m.animate('idle', i / 30, 1 / 30, {});
    for (let h = 0; h < 3; h++) {
      const y = bones[ix[`h${h}`]].rotation.y;
      range.yaw[h] = [Math.min(range.yaw[h][0], y), Math.max(range.yaw[h][1], y)];
    }
    const e = bones[ix.h0eR].rotation.y;
    range.ear = [Math.min(range.ear[0], e), Math.max(range.ear[1], e)];
    const t = bones[ix.h0t5].rotation.z;
    range.trunk = [Math.min(range.trunk[0], t), Math.max(range.trunk[1], t)];
    const tl = bones[ix.tail3].rotation.y;
    range.tail = [Math.min(range.tail[0], tl), Math.max(range.tail[1], tl)];
    if (i === 200) at.push(...[0, 1, 2].map((h) => bones[ix[`h${h}`]].rotation.y));
  }
  for (let h = 0; h < 3; h++) assert.ok(range.yaw[h][1] - range.yaw[h][0] > 0.05, `head ${h} looks about (${(range.yaw[h][1] - range.yaw[h][0]).toFixed(3)})`);
  assert.ok(Math.abs(at[0] - at[1]) > 0.005 && Math.abs(at[1] - at[2]) > 0.005, 'each head on a phase of its own');
  assert.ok(range.ear[1] - range.ear[0] > 0.25, `the ear flaps (${(range.ear[1] - range.ear[0]).toFixed(3)})`);
  assert.ok(range.trunk[1] - range.trunk[0] > 0.02, `the trunk's tip sways (${(range.trunk[1] - range.trunk[0]).toFixed(3)})`);
  assert.ok(range.tail[1] - range.tail[0] > 0.02, `the tail swishes (${(range.tail[1] - range.tail[0]).toFixed(3)})`);
  m.dispose();
});

test('in a blow the heads rear, the trunks curl up and come down with it, the front leg lifts and the rider throws the thunderbolt', () => {
  const m = buildUnitModel(airavata, PLAYER_COLORS[3], { detail: 'rich' });
  const { bones, ix } = m.rich;
  const hand = new THREE.Vector3();
  const range = (f) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 90; i++) {
      m.animate('attack', i / 30, 1 / 30, { attackPhase: (i % 45) / 45 });
      m.root.updateMatrixWorld(true);
      const x = f();
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    return [lo, hi];
  };
  const head = range(() => bones[ix.h0].rotation.z);
  assert.ok(head[1] - head[0] > 0.3, `the head rears and comes down (${(head[1] - head[0]).toFixed(2)})`);
  const curl = range(() => [1, 2, 3, 4, 5].reduce((a, k) => a + bones[ix[`h0t${k}`]].rotation.z, 0));
  assert.ok(curl[1] > 0.5, `the trunk curls up in the wind-up (${curl[1].toFixed(2)})`);
  assert.ok(curl[0] < curl[1] - 0.5, 'and comes down with the blow');
  const leg = range(() => bones[ix.F1u].rotation.z);
  assert.ok(leg[1] > 0.4, `the front leg lifts (${leg[1].toFixed(2)})`);
  const lunge = range(() => bones[B.root].position.x);
  assert.ok(lunge[1] - lunge[0] > 0.1, `the body lunges into the blow (${(lunge[1] - lunge[0]).toFixed(2)})`);
  const arm = range(() => hand.setFromMatrixPosition(bones[B.handR].matrixWorld).y);
  assert.ok(arm[1] - arm[0] > 0.2, `the rider's arm swings through the throw (${(arm[1] - arm[0]).toFixed(2)})`);
  m.dispose();
});

test('the rider\'s pelvis turns back against the body\'s pitch, so the person is not tipped in a blow', () => {
  const up = new THREE.Vector3();
  const tilt = (bone) => Math.abs(Math.atan2(up.set(0, 1, 0).transformDirection(bone.matrixWorld).x, up.y));
  const m = buildUnitModel(airavata, PLAYER_COLORS[3], { detail: 'rich' });
  const { bones, ix } = m.rich;
  let back = 0;
  let pelvis = 0;
  for (let i = 0; i < 90; i++) {
    m.animate('attack', i / 30, 1 / 30, { attackPhase: (i % 45) / 45 });
    m.root.updateMatrixWorld(true);
    back = Math.max(back, tilt(bones[ix.back]));
    pelvis = Math.max(pelvis, tilt(bones[B.pelvis]));
  }
  assert.ok(back > 0.02, `the back pitches in the blow (${back.toFixed(3)})`);
  assert.ok(pelvis < back * 0.7, `the person's pelvis turns some of it back (${pelvis.toFixed(3)} against ${back.toFixed(3)})`);
  m.dispose();
});

test('Airavata dies like any other unit: he topples and his bones stay finite', () => {
  const m = buildUnitModel(airavata, PLAYER_COLORS[3], { detail: 'rich' });
  for (let i = 0; i < 40; i++) m.animate('dead', i / 30, 1 / 30, {});
  assert.ok(Math.abs(m.rigGroup.rotation.x) > 1.0, 'he falls over');
  m.root.updateMatrixWorld(true);
  m.rich.mesh.skeleton.update();
  finite(m.rich.mesh.skeleton.boneMatrices, `${airavata.id} after death`);
  m.dispose();
});
