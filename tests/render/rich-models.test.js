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
const { richSupported, buildRichTemplate, RICH_PANTHEONS } = await import('../../src/render/models/rich-humanoid.js');
const { BONE_COUNT, B, MeshKit, ps, humanoidSpec } = await import('../../src/render/models/rich-kit.js');
const { outfitFor, LAYERS } = await import('../../src/render/models/rich-outfits.js');
const { RICH_ARMS, RICH_OFFHANDS } = await import('../../src/render/models/rich-arms.js');
const { RICH_WEAPONS } = await import('../../src/render/models/rich-gear.js');
const { jaguarSpots, quilt, featherRows, tartan, mailSheen } = await import('../../src/render/models/rich-paint.js');
const { richDims, makeBinds } = await import('../../src/render/models/rich-body.js');
const { addDrape } = await import('../../src/render/models/rich-clothing.js');
const { unitContext } = await import('../../src/render/models/unit-bodies.js');
const { TEAM } = await import('../../src/render/models/unit-geo.js');
const { UNITS, MORTALS, PANTHEON_LIST } = await import('../../src/data/index.js');
const { unitLook } = await import('../../src/render/models/unit-looks.js');
const { PLAYER_COLORS } = await import('../../src/config.js');

// A rich character is one smooth mesh of a few thousand triangles. These budgets are their own:
// the low-poly ones (unit-models.test.js) are untouched. At the game's default zoom a unit is
// ~60 px tall, so these are for the close zoom levels; mortals dominate an army, and a player
// fields one or two gods and a titan.
// (a winged creature carries ~1.5k triangles of feathers; a giant creature is built denser)
const RICH_BUDGET = { mortal: 8500, god: 9000, titan: 14000, creature: 10500, minion: 8500 };
// four more arms and what they carry (a trident, a chakra, a mace, a lotus ...) are ~4k triangles of their own
const MULTI_ARMS = 4000;
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
const greek = (id) => looks(UNITS[id] || MORTALS[id], 'greek');
const egyptian = (id) => looks(UNITS[id] || MORTALS[id], 'egyptian');
const hindu = (id) => looks(UNITS[id] || MORTALS[id], 'hindu');
const japanese = (id) => looks(UNITS[id] || MORTALS[id], 'japanese');
const chinese = (id) => looks(UNITS[id] || MORTALS[id], 'chinese');
const aztec = (id) => looks(UNITS[id] || MORTALS[id], 'aztec');
const celtic = (id) => looks(UNITS[id] || MORTALS[id], 'celtic');
const mesopotamian = (id) => looks(UNITS[id] || MORTALS[id], 'mesopotamian');
const westAfrican = (id) => looks(UNITS[id] || MORTALS[id], 'west_african');
const SAMPLE =['worshipper', 'warrior', 'norse_thor', 'norse_surtr'];
const FINISHED = ['norse_odin', 'norse_freyja', 'norse_valkyrie', 'norse_einherjar', 'norse_frost_troll', 'norse_loki', 'norse_berserker', 'archer', 'priest'];
// every Greek unit on the humanoid and giant bodies (the pegasus, centaur, Cerberus and shade keep their low-poly models)
const GREEK = ['worshipper', 'warrior', 'archer', 'priest', 'greek_zeus', 'greek_athena', 'greek_poseidon', 'greek_hades', 'greek_kronos', 'greek_cyclops', 'greek_hoplite'];
const EGYPTIAN = ['worshipper', 'warrior', 'archer', 'priest', 'egyptian_ra', 'egyptian_anubis', 'egyptian_isis', 'egyptian_set', 'egyptian_mummy', 'egyptian_chariot_archer'];
// every Hindu unit on the humanoid body (the elephant, the monkey soldier and the naga keep their low-poly models)
const HINDU = ['worshipper', 'warrior', 'archer', 'priest', 'hindu_shiva', 'hindu_vishnu', 'hindu_durga', 'hindu_hanuman', 'hindu_garuda', 'hindu_kshatriya'];
// every Japanese unit on the humanoid and giant bodies (the great serpent, the foxes and the fox spirits keep their low-poly models)
const JAPANESE = ['worshipper', 'warrior', 'archer', 'priest', 'japanese_amaterasu', 'japanese_susanoo', 'japanese_raijin', 'japanese_inari', 'japanese_tengu', 'japanese_oni', 'japanese_samurai'];
// every Chinese unit on the humanoid, giant and upright-monkey bodies (Nuwa, the lion, the phoenix and the dragon keep their low-poly models)
const CHINESE = ['worshipper', 'warrior', 'archer', 'priest', 'chinese_sun_wukong', 'chinese_guan_yu', 'chinese_chang_e', 'chinese_pangu', 'chinese_monkey_clone', 'chinese_clay_warrior', 'chinese_crossbowman'];
// every Aztec unit on the humanoid body (Quetzalcoatl, Cipactli, the jaguar spirit, the ahuizotl and Xiuhcoatl keep their low-poly models)
const AZTEC = ['worshipper', 'warrior', 'archer', 'priest', 'aztec_huitzilopochtli', 'aztec_tezcatlipoca', 'aztec_tlaloc', 'aztec_tlaloque', 'aztec_eagle_warrior'];
// every Celtic unit on the humanoid and giant bodies (the hound, the banshee, the headless horseman and the crow keep their low-poly models)
const CELTIC = ['worshipper', 'warrior', 'archer', 'priest', 'celtic_the_dagda', 'celtic_the_morrigan', 'celtic_lugh', 'celtic_brigid', 'celtic_balor', 'celtic_woad_raider'];
// every Mesopotamian unit on the humanoid body (Tiamat, the scorpion man, Anzu, the lamassu, the bull of heaven and the mushussu keep their low-poly models)
const MESOPOTAMIAN = ['worshipper', 'warrior', 'archer', 'priest', 'mesopotamian_marduk', 'mesopotamian_ishtar', 'mesopotamian_enki', 'mesopotamian_nergal', 'mesopotamian_apkallu', 'mesopotamian_slinger'];
// every West African unit on the humanoid body (Ninki Nanka, the Sasabonsam, the Bultungin, Osebo and Onini keep their low-poly models)
const WEST_AFRICAN = ['worshipper', 'warrior', 'archer', 'priest', 'west_african_shango', 'west_african_oya', 'west_african_ogun', 'west_african_anansi', 'west_african_aziza', 'west_african_dart_hunter'];

function finite(arr, label) {
  for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), `${label}: non-finite value at ${i}`);
}

/** The bounding box of the skinned body of a template (the rigid pieces that ride a bone are not in it). */
function bodyBox(tpl) {
  tpl.rich.geo.computeBoundingBox();
  return tpl.rich.geo.boundingBox;
}

/** The size of a rigid piece (a held item) of a template, by its attach name. */
function pieceSize(unit, name) {
  const geo = buildRichTemplate(unit).rich.attach.find((a) => a.name === name).geo;
  geo.computeBoundingBox();
  return geo.boundingBox.getSize(new THREE.Vector3());
}

const pieceTris = (unit, name) => buildRichTemplate(unit).rich.attach.find((a) => a.name === name).geo.userData.triangles;

/** The unit with its extras changed, or its head. */
const withVisual = (u, change) => ({ ...u, visual: { ...u.visual, ...change(u.visual) } });

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
  // a ram, a bird or a many-headed serpent keep their low-poly model
  assert.ok(!richSupported(norse('battering_ram')));
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
    const budget = RICH_BUDGET[klass(u)] + (u.visual.extras.includes('multi_arms') ? MULTI_ARMS : 0);
    assert.ok(tpl.triangles > 800, `${u.id}: suspiciously few triangles`);
    assert.ok(tpl.triangles <= budget, `${u.id}: ${tpl.triangles} triangles > ${budget}`);
    assert.ok(tpl.meshes <= 12, `${u.id}: ${tpl.meshes} meshes`);
    for (const name of ['position', 'normal', 'color', 'aFx', 'aAo']) finite(g.attributes[name].array, `${u.id} ${name}`);
    const n = g.attributes.position.count;
    const bones = tpl.rich.spec.pos.length;
    const idx = g.attributes.skinIndex.array;
    const w = g.attributes.skinWeight.array;
    for (let i = 0; i < n; i++) {
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

test('a pantheon overrides only the layers it dresses differently; the rest is the default look', () => {
  const base = outfitFor('norse');
  const greekOutfit = outfitFor('greek');
  for (const layer of LAYERS) assert.equal(typeof greekOutfit[layer], 'function', `the Greek ${layer} layer`);
  for (const layer of ['legs', 'torso', 'arms', 'armor', 'cloaks', 'head']) assert.notEqual(greekOutfit[layer], base[layer], `the Greeks dress their ${layer} their own way`);
  assert.equal(greekOutfit.extras, base.extras, 'jewelry, spikes and chains are shared');
  assert.ok(greekOutfit.shield && !base.shield, 'the Greeks carry a hoplon, not the default round shield');
  assert.equal(outfitFor('a-people-without-an-outfit').torso, base.torso, 'a pantheon with no outfit wears the default look');
});

test('every Greek humanoid and giant is dressed in the Greek look, the centaur and the shade stay low-poly', () => {
  for (const id of GREEK) assert.ok(richSupported(greek(id)), `${id} is supported`);
  for (const id of ['greek_centaur', 'greek_shade', 'battering_ram']) assert.ok(!richSupported(greek(id)), `${id} stays low-poly`);
  // the same shared mortal is dressed by its own people: a Greek warrior is not a Norse one
  const a = buildRichTemplate(greek('warrior'));
  const b = buildRichTemplate(norse('warrior'));
  assert.notEqual(a.triangles, b.triangles);
  assert.notEqual(a.rich.attach.find((x) => x.shield).geo.attributes.position.count, b.rich.attach.find((x) => x.shield).geo.attributes.position.count);
});

test('the Greek gods carry what they are known by and the hoplites a round bronze-rimmed hoplon', () => {
  const names = (id) => buildRichTemplate(greek(id)).rich.attach.map((x) => x.name).sort();
  assert.deepEqual(names('greek_zeus'), ['weaponR'], 'a lightning bolt in the right hand');
  assert.deepEqual(names('greek_poseidon'), ['weaponL', 'weaponR'], 'a trident, and a conch in the other hand');
  assert.deepEqual(names('greek_athena'), ['shield', 'weaponR'], 'a spear and a shield');
  assert.deepEqual(names('greek_hades'), ['weaponR'], 'a scepter');
  assert.deepEqual(names('greek_kronos'), ['weaponR'], 'a scythe');
  assert.deepEqual(names('greek_hoplite'), ['shield', 'weaponR']);
  // the hoplon is round, larger and deeper than the Norse shield
  const hoplon = buildRichTemplate(greek('greek_hoplite')).rich.attach.find((x) => x.shield).geo;
  const round = buildRichTemplate(norse('norse_einherjar')).rich.attach.find((x) => x.shield).geo;
  for (const g of [hoplon, round]) g.computeBoundingBox();
  const size = (g) => g.boundingBox.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size(hoplon).x - size(hoplon).y) < size(hoplon).x * 0.03, 'the hoplon is a disc');
  assert.ok(size(hoplon).x > size(round).x * 1.1 && size(hoplon).z > size(round).z, 'a bigger, deeper shield');
});

test('Greek mortals wear team-colored linen under bronze that keeps its own color', () => {
  for (const id of ['worshipper', 'greek_hoplite']) {
    const fx = buildRichTemplate(greek(id)).rich.geo.attributes.aFx.array;
    let team = 0;
    let metal = 0;
    for (let i = 0; i < fx.length; i += 4) {
      if (fx[i] > 0) team++;
      if (fx[i + 3] > 0.3) metal++;
    }
    const n = fx.length / 4;
    assert.ok(team > n * 0.06, `${id}: team-colored vertices ${team} of ${n}`);
    if (id === 'greek_hoplite') assert.ok(metal > n * 0.04, `${id}: metal vertices ${metal} of ${n}`);
  }
});

test('the Greek gods, mortals and giants animate every state without a NaN', () => {
  for (const id of GREEK) {
    const m = buildUnitModel(greek(id), PLAYER_COLORS[2], { detail: 'rich' });
    assert.ok(m.rich, `${id} should be rich`);
    runStates(m, id);
    m.dispose();
  }
});

test('a third eye on a god adds the eye on the brow, and a giant\'s is its one great eye', () => {
  const zeus = greek('greek_zeus');
  // (the same id: a god's dress is chosen by name; buildRichTemplate does not cache)
  const withEye = { ...zeus, visual: { ...zeus.visual, extras: [...zeus.visual.extras, 'third_eye'] } };
  assert.ok(richSupported(withEye));
  assert.ok(buildRichTemplate(withEye).triangles > buildRichTemplate(zeus).triangles, 'the forehead eye is extra geometry');
  const cyclops = greek('greek_cyclops');
  assert.ok(richSupported(cyclops));
  const tpl = buildRichTemplate(cyclops);
  finite(tpl.rich.geo.attributes.position.array, 'cyclops');
  assert.ok(tpl.triangles <= RICH_BUDGET.creature);
});

test('the Egyptians dress their own way: kilts, corselets, collars and a wrapped mummy', () => {
  const base = outfitFor('norse');
  const egy = outfitFor('egyptian');
  for (const layer of LAYERS) assert.equal(typeof egy[layer], 'function', `the Egyptian ${layer} layer`);
  for (const layer of LAYERS) assert.notEqual(egy[layer], base[layer], `the Egyptians dress their ${layer} their own way`);
  assert.ok(egy.shield && !base.shield, 'a tall hide shield');
  assert.equal(typeof egy.skinPaint, 'function', 'the dead paint their bare skin');
  assert.equal(base.skinPaint, undefined, 'no other people does');
});

test('every Egyptian humanoid is dressed in the Egyptian look, the serpent, the scarab and the phoenix stay low-poly', () => {
  for (const id of EGYPTIAN) assert.ok(richSupported(egyptian(id)), `${id} is supported`);
  for (const id of ['egyptian_apep', 'egyptian_scarab', 'egyptian_bennu', 'battering_ram']) assert.ok(!richSupported(egyptian(id)), `${id} stays low-poly`);
  // only the animal heads the kit builds (the jackal's, the falcon's) are let through
  const anubis = egyptian('egyptian_anubis');
  assert.ok(!richSupported({ ...anubis, visual: { ...anubis.visual, head: 'wolf' } }));
  assert.ok(richSupported({ ...anubis, visual: { ...anubis.visual, head: 'falcon' } }));
  // a Egyptian warrior is not a Greek one
  assert.notEqual(buildRichTemplate(egyptian('warrior')).triangles, buildRichTemplate(greek('warrior')).triangles);
});

test('the Egyptian gods carry what they are known by and the soldiers a tall hide shield', () => {
  const names = (id) => buildRichTemplate(egyptian(id)).rich.attach.map((x) => x.name).sort();
  assert.deepEqual(names('egyptian_ra'), ['weaponL', 'weaponR'], 'a scepter, and an ankh in the other hand');
  assert.deepEqual(names('egyptian_anubis'), ['weaponR'], 'a staff');
  assert.deepEqual(names('egyptian_isis'), ['weaponR', 'wingL1', 'wingL2', 'wingR1', 'wingR2'], 'an ankh, and her wings');
  assert.deepEqual(names('egyptian_set'), ['weaponR'], 'a spear');
  assert.deepEqual(names('priest'), ['weaponR'], 'an ankh');
  assert.deepEqual(names('warrior'), ['shield', 'weaponR']);
  assert.ok(RICH_ARMS.has('ankh') && RICH_OFFHANDS.has('ankh'), 'the ankh is built, in the hand and as an emblem');
  const shield = buildRichTemplate(egyptian('warrior')).rich.attach.find((x) => x.shield).geo;
  shield.computeBoundingBox();
  const size = shield.boundingBox.getSize(new THREE.Vector3());
  assert.ok(size.y > size.x * 1.5, `a tall oval, not a round shield (${size.x.toFixed(2)} x ${size.y.toFixed(2)})`);
});

test('the falcon\'s and the jackal\'s heads are built on the head bone, and Set\'s tail and crown are extra geometry', () => {
  const ra = egyptian('egyptian_ra');
  const human = buildRichTemplate({ ...ra, visual: { ...ra.visual, head: 'human' } });
  const falcon = buildRichTemplate(ra);
  assert.notEqual(falcon.triangles, human.triangles, 'a beak is not a face');
  const set = egyptian('egyptian_set');
  const bare = buildRichTemplate({ ...set, visual: { ...set.visual, extras: set.visual.extras.filter((e) => e !== 'tail'), headgear: 'none' } });
  assert.ok(buildRichTemplate(set).triangles > bare.triangles + 150, 'the forked tail and the double crown');
  // every vertex of the heads follows the skeleton, with weights that sum to one
  for (const id of ['egyptian_ra', 'egyptian_anubis', 'egyptian_set']) {
    const g = buildRichTemplate(egyptian(id)).rich.geo;
    finite(g.attributes.position.array, id);
    finite(g.attributes.skinWeight.array, id);
  }
});

test('Egyptian mortals wear team-colored linen, and the gods the team\'s color on apron and collar', () => {
  for (const [id, share] of [['worshipper', 0.06], ['warrior', 0.06], ['archer', 0.015], ['priest', 0.012], ['egyptian_ra', 0.01], ['egyptian_isis', 0.01]]) {
    const fx = buildRichTemplate(egyptian(id)).rich.geo.attributes.aFx.array;
    let team = 0;
    for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) team++;
    const n = fx.length / 4;
    assert.ok(team > n * share, `${id}: team-colored vertices ${team} of ${n}`);
  }
});

test('the mummy is dark dried skin under pale bandage, and its eyes glow', () => {
  const tpl = buildRichTemplate(egyptian('egyptian_mummy'));
  const col = tpl.rich.geo.attributes.color.array;
  let dark = 0;
  let pale = 0;
  for (let i = 0; i < col.length; i += 3) {
    const l = (col[i] + col[i + 1] + col[i + 2]) / 3;
    if (l < 0.16) dark++;
    else if (l > 0.45) pale++;
  }
  const n = col.length / 3;
  assert.ok(dark > n * 0.12, `dark skin: ${dark} of ${n}`);
  assert.ok(pale > n * 0.12, `pale bandage: ${pale} of ${n}`);
  const fx = tpl.rich.geo.attributes.aFx.array;
  let glow = 0;
  for (let i = 1; i < fx.length; i += 4) if (fx[i] > 0.5) glow++;
  assert.ok(glow > 0, 'glowing eyes');
  assert.ok(tpl.triangles > 5500, 'the wraps are geometry, not paint');
});

test('the Egyptian gods, mortals and the dead animate every state without a NaN', () => {
  for (const id of EGYPTIAN) {
    const m = buildUnitModel(egyptian(id), PLAYER_COLORS[2], { detail: 'rich' });
    assert.ok(m.rich, `${id} should be rich`);
    runStates(m, id);
    m.dispose();
  }
});

test('the Hindus dress their own way: dhotis, quilted coats, garlands and gods with many arms', () => {
  const base = outfitFor('norse');
  const hin = outfitFor('hindu');
  for (const layer of LAYERS) assert.equal(typeof hin[layer], 'function', `the Hindu ${layer} layer`);
  for (const layer of LAYERS) assert.notEqual(hin[layer], base[layer], `the Hindus dress their ${layer} their own way`);
  assert.ok(hin.shield && hin.shield !== outfitFor('egyptian').shield, 'a round dhal of their own');
  assert.equal(typeof hin.skinPaint, 'function', 'Hanuman\'s fur is painted on the bare skin');
});

test('every Hindu humanoid is dressed in the Hindu look, the elephant, the monkey soldier and the naga stay low-poly', () => {
  for (const id of HINDU) assert.ok(richSupported(hindu(id)), `${id} is supported`);
  for (const id of ['hindu_airavata', 'hindu_vanara', 'hindu_naga', 'battering_ram']) assert.ok(!richSupported(hindu(id)), `${id} stays low-poly`);
  // only the monkey head the kit builds is let through, and only the extras it can dress
  const hanuman = hindu('hindu_hanuman');
  assert.ok(!richSupported({ ...hanuman, visual: { ...hanuman.visual, head: 'gorilla' } }));
  assert.ok(!richSupported({ ...hanuman, visual: { ...hanuman.visual, extras: [...hanuman.visual.extras, 'rider'] } }));
  // a Hindu warrior is not an Egyptian one
  assert.notEqual(buildRichTemplate(hindu('warrior')).triangles, buildRichTemplate(egyptian('warrior')).triangles);
});

test('the Hindu gods carry what they are known by: a chakra, a mace, a damaru, a lotus and the extra arms', () => {
  const names = (id) => buildRichTemplate(hindu(id)).rich.attach.map((x) => x.name).sort();
  assert.deepEqual(names('hindu_shiva'), ['extraArms', 'prabhavali', 'weaponL', 'weaponR'], 'a trident, a damaru, four more arms and the arch of flames');
  assert.deepEqual(names('hindu_vishnu'), ['extraArms', 'prabhavali', 'weaponL', 'weaponR'], 'a chakra, a conch, four more arms and the arch of flames');
  assert.deepEqual(names('hindu_durga'), ['extraArms', 'prabhavali', 'shield', 'weaponR'], 'a sword and shield, four more arms and the arch of flames');
  assert.deepEqual(names('hindu_hanuman'), ['prabhavali', 'weaponR'], 'a mace and the arch of flames');
  assert.deepEqual(names('hindu_garuda'), ['wingL1', 'wingL2', 'wingR1', 'wingR2'], 'his wings');
  assert.deepEqual(names('hindu_kshatriya'), ['shield', 'weaponR'], 'a mace and a dhal');
  assert.deepEqual(names('warrior'), ['shield', 'weaponR']);
  for (const id of ['mace', 'discus']) assert.ok(RICH_ARMS.has(id), `the ${id} is built`);
  for (const id of ['drum', 'lotus', 'flame', 'shell']) assert.ok(RICH_OFFHANDS.has(id), `the ${id} is built`);
});

test('a many-armed god\'s extra arms are one rigid piece on the chest bone, reaching wider than the body', () => {
  for (const [id, pairs] of [['hindu_shiva', 2], ['hindu_vishnu', 2], ['hindu_durga', 2]]) {
    const tpl = buildRichTemplate(hindu(id));
    const arms = tpl.rich.attach.find((a) => a.name === 'extraArms');
    assert.equal(arms.bone, B.chest, `${id}: the extra arms ride the chest`);
    assert.ok(!arms.geo.attributes.skinIndex, `${id}: a rigid piece`);
    arms.geo.computeBoundingBox();
    const size = arms.geo.boundingBox.getSize(new THREE.Vector3());
    // the body's own shoulders span ~0.5 (scale 1): the raised and the held-out hands reach beyond them
    assert.ok(size.z > 0.62, `${id}: the arms span ${size.z.toFixed(2)}`);
    assert.ok(arms.geo.userData.triangles > 300 * pairs, `${id}: ${arms.geo.userData.triangles} triangles for ${pairs} pairs of arms`);
  }
  // no extra arms without the extra
  const shiva = hindu('hindu_shiva');
  const plain = buildRichTemplate({ ...shiva, visual: { ...shiva.visual, extras: shiva.visual.extras.filter((e) => e !== 'multi_arms') } });
  assert.ok(!plain.rich.attach.some((a) => a.name === 'extraArms'));
});

test('the Hindu gods stand before an arch of flames: a rigid flickering piece on the head, behind the face', () => {
  for (const id of ['hindu_shiva', 'hindu_vishnu', 'hindu_durga', 'hindu_hanuman']) {
    const tpl = buildRichTemplate(hindu(id));
    const halo = tpl.rich.attach.find((a) => a.name === 'prabhavali');
    assert.equal(halo.bone, B.head, `${id}: the arch rides the head`);
    assert.ok(halo.flicker, `${id}: the flames flicker`);
    assert.ok(!halo.geo.attributes.skinIndex, `${id}: a rigid piece`);
    assert.ok(halo.geo.morphAttributes.position, `${id}: with a flicker morph`);
    halo.geo.computeBoundingBox();
    const size = halo.geo.boundingBox.getSize(new THREE.Vector3());
    assert.ok(size.z > 0.4 && size.z > size.x * 3, `${id}: an arch wider than the head and thin front to back (${size.x.toFixed(2)} x ${size.z.toFixed(2)})`);
    assert.ok(halo.geo.boundingBox.max.x < 0.02, `${id}: behind the face`);
    assert.ok(halo.geo.userData.triangles < 450, `${id}: ${halo.geo.userData.triangles} triangles for the arch`);
  }
  // the people and Garuda have none
  for (const id of ['worshipper', 'warrior', 'archer', 'priest', 'hindu_kshatriya', 'hindu_garuda']) {
    assert.ok(!buildRichTemplate(hindu(id)).rich.attach.some((a) => a.name === 'prabhavali'), `${id} has no arch`);
  }
});

test('a piece modelled in its own frame is placed in the kit by a matrix', () => {
  const kit = new MeshKit(null, { sides: 8 });
  kit.loft([ps(0, 0, 0, 0.1), ps(0, 1, 0, 0.1)], { ref: [1, 0, 0] });
  const before = kit.count;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(5, 0, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2), new THREE.Vector3(1, 1, 1));
  kit.placed(m, (k) => k.loft([ps(0, 0, 0, 0.1), ps(0, 1, 0, 0.1)], { ref: [0, 0, 1] }));
  const g = kit.build({ ao: false });
  const pos = g.attributes.position.array;
  let maxX = -Infinity;
  let maxXBefore = -Infinity;
  for (let i = 0; i < kit.count; i++) {
    if (i < before) maxXBefore = Math.max(maxXBefore, pos[i * 3]);
    else maxX = Math.max(maxX, pos[i * 3]);
  }
  assert.ok(maxXBefore < 0.2, 'what was built before stays where it was');
  assert.ok(Math.abs(maxX - 6) < 0.15, `the placed pole turned from +Y to +X and moved 5 along it (${maxX.toFixed(2)})`);
  finite(g.attributes.normal.array, 'placed normals');
});

test('Hanuman has a monkey\'s head, a long tail and fur on his skin', () => {
  const h = hindu('hindu_hanuman');
  const human = buildRichTemplate({ ...h, visual: { ...h.visual, head: 'human' } });
  const monkey = buildRichTemplate(h);
  assert.notEqual(monkey.triangles, human.triangles, 'a muzzle is not a face');
  const noTail = buildRichTemplate({ ...h, visual: { ...h.visual, extras: h.visual.extras.filter((e) => e !== 'tail') } });
  assert.ok(monkey.triangles > noTail.triangles + 200, 'the tail is geometry');
  // the tail rises behind the pelvis: the skinned mesh reaches further back than without it
  const back = (t) => {
    const pos = t.rich.geo.attributes.position.array;
    let min = Infinity;
    for (let i = 0; i < pos.length; i += 3) min = Math.min(min, pos[i]);
    return min;
  };
  assert.ok(back(monkey) < back(noTail) - 0.05, 'a tail behind the body');
  // the fur breaks the skin color up: streaks of lighter and darker orange on the bare arms
  const col = monkey.rich.geo.attributes.color.array;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < col.length; i += 3) {
    const l = col[i] + col[i + 1] + col[i + 2];
    if (col[i] > col[i + 2] * 2) { lo = Math.min(lo, l); hi = Math.max(hi, l); }
  }
  assert.ok(hi > lo * 1.15, `fur streaks: ${lo.toFixed(2)} to ${hi.toFixed(2)}`);
});

test('Hindu mortals and gods carry the team\'s color on their cloth, the metal keeps its own', () => {
  for (const [id, share] of [['worshipper', 0.04], ['warrior', 0.08], ['archer', 0.015], ['priest', 0.015], ['hindu_shiva', 0.012], ['hindu_vishnu', 0.012], ['hindu_durga', 0.012], ['hindu_hanuman', 0.05], ['hindu_kshatriya', 0.09]]) {
    const fx = buildRichTemplate(hindu(id)).rich.geo.attributes.aFx.array;
    let team = 0;
    for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) team++;
    const n = fx.length / 4;
    assert.ok(team > n * share, `${id}: team-colored vertices ${team} of ${n}`);
  }
});

test('the Hindu gods, mortals and Garuda animate every state without a NaN', () => {
  for (const id of HINDU) {
    const m = buildUnitModel(hindu(id), PLAYER_COLORS[2], { detail: 'rich' });
    assert.ok(m.rich, `${id} should be rich`);
    runStates(m, id);
    m.dispose();
  }
});

test('the Japanese dress their own way: kosode and hakama, laced armor, tiger skins and black hair', () => {
  const base = outfitFor('norse');
  const jp = outfitFor('japanese');
  for (const layer of LAYERS) assert.equal(typeof jp[layer], 'function', `the Japanese ${layer} layer`);
  for (const layer of LAYERS) assert.notEqual(jp[layer], base[layer], `the Japanese dress their ${layer} their own way`);
  assert.equal(typeof jp.palette, 'function', 'the people have black hair');
  assert.equal(typeof jp.gear, 'function', 'an oni\'s club is iron, a priestess\'s staff is ringed');
  assert.ok(!jp.shield, 'they fight with the blade and carry no shield');
  assert.ok(!base.palette && !base.gear, 'the other peoples keep the shared palette and the shared items');
});

test('every Japanese humanoid and giant is dressed in the Japanese look, the eight-headed serpent stays low-poly', () => {
  for (const id of JAPANESE) assert.ok(richSupported(japanese(id)), `${id} is supported`);
  for (const id of ['japanese_yamata_no_orochi', 'battering_ram']) assert.ok(!richSupported(japanese(id)), `${id} stays low-poly`);
  // only the crow's and the demon's heads the kit builds are let through
  const tengu = japanese('japanese_tengu');
  assert.ok(!richSupported(withVisual(tengu, () => ({ head: 'gorilla' }))));
  // a Japanese warrior is not a Hindu one
  assert.notEqual(buildRichTemplate(japanese('warrior')).triangles, buildRichTemplate(hindu('warrior')).triangles);
});

test('the Japanese carry what they are known by: a katana, a yumi, a fan, a mirror, drumsticks, a shakujo, a kanabo', () => {
  const names = (id) => buildRichTemplate(japanese(id)).rich.attach.map((x) => x.name).sort();
  assert.deepEqual(names('warrior'), ['weaponR'], 'a katana');
  assert.deepEqual(names('archer'), ['weaponL'], 'a yumi');
  assert.deepEqual(names('priest'), ['weaponR'], 'a folding fan');
  assert.deepEqual(names('japanese_samurai'), ['weaponR'], 'a katana');
  assert.deepEqual(names('japanese_amaterasu'), ['weaponL'], 'the sacred mirror');
  assert.deepEqual(names('japanese_susanoo'), ['weaponR'], 'the sword that slew the serpent');
  assert.deepEqual(names('japanese_raijin'), ['weaponL', 'weaponR'], 'a drumstick in each hand');
  assert.deepEqual(names('japanese_inari'), ['weaponL', 'weaponR'], 'a shakujo and a jewel');
  assert.deepEqual(names('japanese_tengu'), ['weaponR', 'wingL1', 'wingL2', 'wingR1', 'wingR2'], 'a fan of feathers and his wings');
  assert.deepEqual(names('japanese_oni'), ['weaponR'], 'a kanabo');
  assert.ok(RICH_WEAPONS.has('katana'), 'the katana is built');
  for (const id of ['fan', 'drum']) assert.ok(RICH_ARMS.has(id), `the ${id} is built`);
  for (const id of ['mirror', 'orb', 'drum']) assert.ok(RICH_OFFHANDS.has(id), `the ${id} is built`);
});

test('the Japanese hold their things their own way: an iron kanabo, a long yumi, a ringed shakujo, a fan of feathers, drumsticks', () => {
  // the same unit under another people's outfit holds the shared item
  const shared = (id) => ({ ...japanese(id), pantheon: 'norse' });
  assert.ok(pieceTris(japanese('japanese_oni'), 'weaponR') > pieceTris(shared('japanese_oni'), 'weaponR') * 1.5, 'the kanabo is studded');
  assert.ok(pieceSize(japanese('archer'), 'weaponL').x > pieceSize(norse('archer'), 'weaponL').x * 1.1, 'the yumi is longer than the shared bow');
  assert.ok(pieceSize(japanese('japanese_inari'), 'weaponR').z > pieceSize(shared('japanese_inari'), 'weaponR').z * 1.5, 'the shakujo carries a ring on its head, set to face the front');
  assert.notEqual(pieceTris(japanese('japanese_tengu'), 'weaponR'), pieceTris(shared('japanese_tengu'), 'weaponR'), 'a fan of feathers, not the priest\'s paper fan');
  assert.ok(pieceTris(japanese('japanese_tengu'), 'weaponR') < pieceTris(japanese('priest'), 'weaponR') && pieceSize(japanese('japanese_tengu'), 'weaponR').z > pieceSize(japanese('priest'), 'weaponR').z, 'with a thicker, feathered build');
  // the thunder god beats with a long stick in each hand, where Shiva's damaru is a small drum
  for (const name of ['weaponL', 'weaponR']) assert.ok(pieceSize(japanese('japanese_raijin'), name).x > 0.7, `Raijin's ${name} is a drumstick`);
  assert.ok(pieceSize(hindu('hindu_shiva'), 'weaponL').x < 0.4, 'Shiva keeps his damaru');
});

test('Amaterasu and Raijin stand before a ring on their backs, the other gods carry a banner on a pole', () => {
  for (const id of ['japanese_amaterasu', 'japanese_raijin']) {
    const u = japanese(id);
    const ring = buildRichTemplate(u);
    const plain = buildRichTemplate(withVisual(u, (v) => ({ extras: v.extras.filter((e) => e !== 'aura_ring') })));
    // the ring is skinned on the chest bone: behind the back, wider than the shoulders
    assert.ok(ring.triangles > plain.triangles + 400, `${id}: ${ring.triangles} triangles with the ring, ${plain.triangles} without`);
    assert.ok(bodyBox(ring).max.z > bodyBox(plain).max.z + 0.15, `${id}: the ring is wider than the body`);
    assert.ok(bodyBox(ring).min.x < bodyBox(plain).min.x - 0.05, `${id}: the ring is behind the back`);
    // without a ring the god carries a banner on a pole instead, up over the head
    assert.ok(bodyBox(plain).max.y > 1.8 && bodyBox(plain).max.y > bodyBox(ring).max.y, `${id}: a banner stands behind a god with no ring`);
  }
  for (const id of ['japanese_susanoo', 'japanese_inari']) {
    const tpl = buildRichTemplate(japanese(id));
    assert.ok(bodyBox(tpl).max.y > 1.8, `${id}: a banner on a pole rises over his head`);
    assert.ok(bodyBox(tpl).max.z < 0.4, `${id}: and no ring spreads wide behind him`);
  }
  // the creatures and the people carry neither
  for (const id of ['japanese_tengu', 'japanese_oni', 'warrior', 'japanese_samurai']) assert.ok(bodyBox(buildRichTemplate(japanese(id))).max.y < 1.5, `${id} has no banner`);
});

test('the Tengu has a crow\'s head with a beak, the Oni a demon\'s with tusks', () => {
  for (const [id, reach] of [['japanese_tengu', 0.07], ['japanese_oni', 0.02]]) {
    const u = japanese(id);
    const beast = buildRichTemplate(u);
    const human = buildRichTemplate(withVisual(u, () => ({ head: 'human' })));
    assert.notEqual(beast.triangles, human.triangles, `${id}: a muzzle is not a face`);
    assert.ok(bodyBox(beast).max.x > bodyBox(human).max.x + reach, `${id}: the head reaches further forward`);
  }
});

test('the Tengu stands on a one-toothed geta that hangs below the soles the others rest on', () => {
  assert.ok(bodyBox(buildRichTemplate(japanese('japanese_tengu'))).min.y < -0.1, 'the tooth hangs below the ground line (a flier never touches it)');
  for (const id of JAPANESE.filter((x) => x !== 'japanese_tengu')) assert.ok(bodyBox(buildRichTemplate(japanese(id))).min.y > -0.02, `${id} stands on the ground`);
});

test('the Japanese people have black hair, the gods and the creatures keep the shared palette', () => {
  const jp = outfitFor('japanese');
  const pal = { hair: new THREE.Color('#8a5a3a'), skin: new THREE.Color('#d9a678') };
  const people = jp.palette(pal, { mortal: true });
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  assert.ok(lum(people.hair) < 0.03, 'black hair');
  assert.equal(people.skin, pal.skin, 'the rest of the palette is kept');
  assert.equal(pal.hair.getHexString(), '8a5a3a', 'the shared palette itself is not touched');
  assert.equal(jp.palette(pal, { mortal: false }), pal, 'a god keeps his own');
});

test('Japanese mortals and gods carry the team\'s color on their cloth, the metal keeps its own', () => {
  for (const [id, share] of [['worshipper', 0.08], ['warrior', 0.09], ['archer', 0.012], ['priest', 0.01], ['japanese_samurai', 0.1], ['japanese_amaterasu', 0.012], ['japanese_susanoo', 0.025], ['japanese_raijin', 0.012], ['japanese_inari', 0.025], ['japanese_tengu', 0.03], ['japanese_oni', 0.003]]) {
    const fx = buildRichTemplate(japanese(id)).rich.geo.attributes.aFx.array;
    let team = 0;
    let metal = 0;
    for (let i = 0; i < fx.length; i += 4) {
      if (fx[i] > 0) team++;
      if (fx[i + 3] > 0.3) metal++;
    }
    const n = fx.length / 4;
    assert.ok(team > n * share, `${id}: team-colored vertices ${team} of ${n}`);
    if (id === 'japanese_samurai') assert.ok(metal > n * 0.08, `${id}: metal vertices ${metal} of ${n}`);
  }
});

test('the Japanese gods, mortals and creatures animate every state without a NaN', () => {
  for (const id of JAPANESE) {
    const m = buildUnitModel(japanese(id), PLAYER_COLORS[2], { detail: 'rich' });
    assert.ok(m.rich, `${id} should be rich`);
    runStates(m, id);
    m.dispose();
  }
});

test('the Chinese dress their own way: crossed jackets, mirror armor, a round tiger shield and black hair', () => {
  const base = outfitFor('norse');
  const cn = outfitFor('chinese');
  for (const layer of LAYERS) assert.equal(typeof cn[layer], 'function', `the Chinese ${layer} layer`);
  for (const layer of LAYERS) assert.notEqual(cn[layer], base[layer], `the Chinese dress their ${layer} their own way`);
  assert.equal(typeof cn.palette, 'function', 'the people have black hair');
  assert.equal(typeof cn.gear, 'function', 'a halberd, a crossbow, a Ruyi staff and a crane fan are styled');
  assert.equal(typeof cn.skinPaint, 'function', 'the monkeys\' fur is painted over their skin');
  assert.ok(cn.shield && cn.shield.studs === undefined, 'a round shield of their own');
});

test('every Chinese humanoid, giant and upright monkey is dressed in the Chinese look, Nuwa, the phoenix and the dragon stay low-poly', () => {
  for (const id of CHINESE) assert.ok(richSupported(chinese(id)), `${id} is supported`);
  for (const id of ['chinese_nuwa', 'chinese_fenghuang', 'chinese_celestial_dragon', 'battering_ram']) assert.ok(!richSupported(chinese(id)), `${id} stays low-poly`);
  // an upright monkey is dressed on the humanoid rig by the Chinese only: the Hindu monkey soldier keeps its low-poly beast
  const monkey = chinese('chinese_monkey_clone');
  assert.equal(monkey.visual.body, 'beast_biped');
  assert.ok(!richSupported({ ...monkey, pantheon: 'hindu' }), 'no other people\'s upright beast is let through');
  assert.ok(!richSupported(hindu('hindu_vanara')), 'the Hindu monkey soldier stays low-poly');
  // a Chinese warrior is not a Japanese one
  assert.notEqual(buildRichTemplate(chinese('warrior')).triangles, buildRichTemplate(japanese('warrior')).triangles);
});

test('the Chinese carry what they are known by: a halberd, a crossbow, a bow, a crane fan, a Ruyi staff, a lantern, an axe', () => {
  const names = (id) => buildRichTemplate(chinese(id)).rich.attach.map((x) => x.name).sort();
  assert.deepEqual(names('warrior'), ['shield', 'weaponR'], 'a halberd and a round shield');
  assert.deepEqual(names('archer'), ['weaponL'], 'a bow');
  assert.deepEqual(names('priest'), ['weaponR'], 'a fan');
  assert.deepEqual(names('chinese_crossbowman'), ['weaponL'], 'a repeating crossbow');
  assert.deepEqual(names('chinese_clay_warrior'), ['shield', 'weaponR'], 'a spear and a shield');
  assert.deepEqual(names('chinese_sun_wukong'), ['weaponR'], 'the Ruyi staff');
  assert.deepEqual(names('chinese_monkey_clone'), ['weaponR'], 'a copy of it');
  assert.deepEqual(names('chinese_guan_yu'), ['weaponR'], 'the Green Dragon crescent blade');
  assert.deepEqual(names('chinese_chang_e'), ['weaponL'], 'a lantern');
  assert.deepEqual(names('chinese_pangu'), ['weaponR'], 'an axe');
  assert.ok(RICH_WEAPONS.has('halberd'), 'the halberd is built');
  assert.ok(RICH_ARMS.has('fan'), 'the fan is built');
  assert.ok(RICH_OFFHANDS.has('lantern'), 'the lantern is built');
});

test('the Chinese hold their things their own way: a crescent blade, a level crossbow, a Ruyi pole, a fan of crane feathers, a broad yue', () => {
  // the same unit under another people's outfit holds the shared item
  const shared = (id) => ({ ...chinese(id), pantheon: 'norse' });
  const guan = pieceSize(chinese('chinese_guan_yu'), 'weaponR');
  assert.ok(guan.y > pieceSize(chinese('warrior'), 'weaponR').y * 1.1, 'the crescent blade is longer than a soldier\'s halberd');
  assert.ok(pieceSize(chinese('chinese_sun_wukong'), 'weaponR').x > pieceSize(shared('chinese_sun_wukong'), 'weaponR').x * 1.1, 'the Ruyi pole is long');
  assert.ok(pieceTris(chinese('chinese_sun_wukong'), 'weaponR') < pieceTris(shared('chinese_sun_wukong'), 'weaponR'), 'a plain lacquered pole with gold bands, not the shared staff\'s crown');
  assert.ok(pieceSize(chinese('chinese_pangu'), 'weaponR').x > pieceSize(shared('chinese_pangu'), 'weaponR').x * 1.1, 'the yue is broad');
  assert.notEqual(pieceTris(chinese('priest'), 'weaponR'), pieceTris(shared('priest'), 'weaponR') + 1, 'a fan of feathers');
  assert.ok(pieceTris(chinese('chinese_crossbowman'), 'weaponL') > pieceTris(chinese('archer'), 'weaponL') * 2, 'a crossbow with its stock, prod, bolt and magazine is more than a bow');
  // a crossbow is carried level before the body (the elbow square); a bow hangs at the side
  assert.equal(buildRichTemplate(chinese('chinese_crossbowman')).rig.leftElbow, 1);
  assert.ok(buildRichTemplate(chinese('archer')).rig.leftElbow < 0.3);
  const cross = pieceSize(chinese('chinese_crossbowman'), 'weaponL');
  assert.ok(cross.z > 0.4, `the prod spreads across the front of the body (${cross.z.toFixed(2)})`);
});

test('Guan Yu and the Monkey King stand before four pennants on poles, Chang\'e before two ribbons that float behind her', () => {
  const shared = (id) => ({ ...chinese(id), pantheon: 'norse' });
  for (const id of ['chinese_guan_yu', 'chinese_sun_wukong']) {
    const flags = bodyBox(buildRichTemplate(chinese(id)));
    const plain = bodyBox(buildRichTemplate(shared(id)));
    assert.ok(flags.max.z > plain.max.z + 0.08 && flags.min.z < plain.min.z - 0.08, `${id}: the pennants fan out wider than the shoulders`);
    assert.ok(flags.max.y > plain.max.y + 0.1, `${id}: the poles rise over the head`);
  }
  // the ribbons ride the cape bones, so they stream behind her when she moves
  const capeWeight = (u) => {
    const g = buildRichTemplate(u).rich.geo;
    const idx = g.attributes.skinIndex.array;
    const w = g.attributes.skinWeight.array;
    let sum = 0;
    for (let i = 0; i < idx.length; i++) if (idx[i] >= B.cape1 && idx[i] <= B.cape3) sum += w[i];
    return sum;
  };
  assert.ok(capeWeight(chinese('chinese_chang_e')) > capeWeight(shared('chinese_chang_e')) * 1.2, 'the pibo hangs on the cape chain');
  assert.ok(bodyBox(buildRichTemplate(chinese('chinese_chang_e'))).min.x < bodyBox(buildRichTemplate(shared('chinese_chang_e'))).min.x - 0.06, 'and falls behind her');
});

test('the Monkey King and his clones are dressed on the humanoid rig: a monkey\'s head, a long tail, fur, a tiger skin about the loins', () => {
  for (const id of ['chinese_sun_wukong', 'chinese_monkey_clone']) {
    const u = chinese(id);
    assert.equal(u.visual.head, 'monkey');
    const monkey = buildRichTemplate(u);
    const human = buildRichTemplate(withVisual(u, () => ({ head: 'human' })));
    assert.notEqual(monkey.triangles, human.triangles, `${id}: a muzzle is not a face`);
    const noTail = buildRichTemplate(withVisual(u, (v) => ({ extras: v.extras.filter((e) => e !== 'tail') })));
    assert.ok(monkey.triangles > noTail.triangles + 200, `${id}: the tail is geometry`);
    assert.ok(bodyBox(monkey).min.x < bodyBox(noTail).min.x - 0.05, `${id}: a tail behind the body`);
    // the fur breaks the skin color up: streaks of lighter and darker hair on the bare arms
    const col = monkey.rich.geo.attributes.color.array;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < col.length; i += 3) {
      const l = col[i] + col[i + 1] + col[i + 2];
      if (col[i] > col[i + 2] * 1.6) { lo = Math.min(lo, l); hi = Math.max(hi, l); }
    }
    assert.ok(hi > lo * 1.15, `${id}: fur streaks ${lo.toFixed(2)} to ${hi.toFixed(2)}`);
  }
  // the clone is a copy of him in a smaller, plainer dress: no armor, no pennants
  assert.ok(buildRichTemplate(chinese('chinese_monkey_clone')).triangles < buildRichTemplate(chinese('chinese_sun_wukong')).triangles * 0.7);
});

test('the Chinese people have black hair, a clay soldier\'s is clay, the gods keep the shared palette', () => {
  const cn = outfitFor('chinese');
  const pal = { hair: new THREE.Color('#8a5a3a'), skin: new THREE.Color('#d9a678'), primary: new THREE.Color('#b08a5a') };
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const people = cn.palette(pal, { mortal: true, unit: { id: 'warrior' } });
  assert.ok(lum(people.hair) < 0.03, 'black hair');
  assert.equal(people.skin, pal.skin, 'the rest of the palette is kept');
  assert.equal(pal.hair.getHexString(), '8a5a3a', 'the shared palette itself is not touched');
  assert.equal(cn.palette(pal, { mortal: false, unit: { id: 'chinese_guan_yu' } }), pal, 'a god keeps his own');
  const clay = cn.palette(pal, { mortal: false, unit: { id: 'chinese_clay_warrior' } });
  assert.ok(lum(clay.hair) > 0.05 && lum(clay.hair) < lum(pal.primary), 'the clay soldier\'s hair is the clay, darker');
});

test('Chinese mortals and gods carry the team\'s color on their cloth, plumes and pennants, the metal keeps its own', () => {
  for (const [id, share] of [['worshipper', 0.06], ['warrior', 0.08], ['archer', 0.015], ['priest', 0.025], ['chinese_crossbowman', 0.08], ['chinese_clay_warrior', 0.025], ['chinese_guan_yu', 0.025], ['chinese_sun_wukong', 0.015], ['chinese_chang_e', 0.03], ['chinese_monkey_clone', 0.03], ['chinese_pangu', 0.005]]) {
    const fx = buildRichTemplate(chinese(id)).rich.geo.attributes.aFx.array;
    let team = 0;
    let metal = 0;
    for (let i = 0; i < fx.length; i += 4) {
      if (fx[i] > 0) team++;
      if (fx[i + 3] > 0.3) metal++;
    }
    const n = fx.length / 4;
    assert.ok(team > n * share, `${id}: team-colored vertices ${team} of ${n}`);
    if (id === 'chinese_crossbowman' || id === 'warrior') assert.ok(metal > n * 0.1, `${id}: metal vertices ${metal} of ${n}`);
  }
});

test('the Chinese gods, mortals and the monkeys animate every state without a NaN', () => {
  for (const id of CHINESE) {
    const m = buildUnitModel(chinese(id), PLAYER_COLORS[2], { detail: 'rich' });
    assert.ok(m.rich, `${id} should be rich`);
    runStates(m, id);
    m.dispose();
  }
});

test('the Aztecs dress their own way: the loincloth, quilted armor, feathers and a black-haired people', () => {
  const base = outfitFor('norse');
  const az = outfitFor('aztec');
  for (const layer of LAYERS) assert.equal(typeof az[layer], 'function', `the Aztec ${layer} layer`);
  for (const layer of LAYERS) assert.notEqual(az[layer], base[layer], `the Aztecs dress their ${layer} their own way`);
  assert.equal(typeof az.palette, 'function', 'the people have black hair');
  assert.equal(typeof az.gear, 'function', 'a macuahuitl, a mirror and a jar are styled');
  assert.equal(typeof az.skinPaint, 'function', 'the gods\' faces are painted over their skin');
  assert.equal(typeof az.shield, 'function', 'the sun god\'s shield is not the soldiers\'');
  assert.ok(RICH_PANTHEONS.has('aztec'), 'the Aztec players get the new characters');
});

test('every Aztec humanoid and the eagle warrior is dressed in the Aztec look; Quetzalcoatl, the crocodile and the fire serpent stay low-poly', () => {
  for (const id of AZTEC) assert.ok(richSupported(aztec(id)), `${id} is supported`);
  for (const id of ['aztec_quetzalcoatl', 'aztec_cipactli', 'aztec_xiuhcoatl', 'battering_ram']) assert.ok(!richSupported(aztec(id)), `${id} stays low-poly`);
  // an Aztec warrior is not a Chinese one
  assert.notEqual(buildRichTemplate(aztec('warrior')).triangles, buildRichTemplate(chinese('warrior')).triangles);
  assert.notEqual(buildRichTemplate(aztec('priest')).triangles, buildRichTemplate(chinese('priest')).triangles);
});

test('the Aztecs carry what they are known by: a macuahuitl, a chimalli, a bow, a staff, a smoking mirror, a jar of rain', () => {
  const names = (id) => buildRichTemplate(aztec(id)).rich.attach.filter((x) => !x.tool).map((x) => x.name).sort();
  assert.deepEqual(names('warrior'), ['shield', 'weaponR'], 'a macuahuitl and a chimalli');
  assert.deepEqual(names('archer'), ['weaponL'], 'a bow');
  assert.deepEqual(names('priest'), ['weaponR'], 'a staff');
  assert.deepEqual(names('aztec_eagle_warrior'), ['weaponR'], 'a macuahuitl');
  assert.deepEqual(names('aztec_huitzilopochtli'), ['shield', 'weaponR'], 'a club and a shield of down');
  assert.deepEqual(names('aztec_tezcatlipoca'), ['weaponL', 'weaponR'], 'the mirror and a club');
  assert.deepEqual(names('aztec_tlaloc'), ['weaponR'], 'the lightning');
  assert.deepEqual(names('aztec_tlaloque'), ['weaponR'], 'a jar');
  assert.deepEqual(names('worshipper'), [], 'the worshippers\' tools are not held items');
});

test('the Aztecs hold their things their own way: a flat paddle set with obsidian, a fringed shield, a black mirror, a clay jar', () => {
  // the same unit under another people's outfit holds the shared item
  const shared = (id) => ({ ...aztec(id), pantheon: 'norse', lookOf: 'norse' });
  for (const id of ['warrior', 'aztec_eagle_warrior', 'aztec_huitzilopochtli']) {
    const mine = pieceSize(aztec(id), 'weaponR');
    const plain = pieceSize(shared(id), 'weaponR');
    assert.ok(mine.x > plain.x * 1.3, `${id}: the macuahuitl is longer than the shared weapon (${mine.x.toFixed(2)} against ${plain.x.toFixed(2)})`);
    assert.ok(mine.z < 0.1 && mine.z < mine.y * 0.5, `${id}: a paddle is flat (${mine.y.toFixed(2)} by ${mine.z.toFixed(2)})`);
  }
  // the Smoking Mirror's club is the macuahuitl too: narrower than a blade, its edges cut into teeth
  const club = pieceSize(aztec('aztec_tezcatlipoca'), 'weaponR');
  assert.ok(club.y < pieceSize(shared('aztec_tezcatlipoca'), 'weaponR').y * 0.6, 'a paddle is narrower than a blade');
  assert.ok(pieceTris(aztec('aztec_tezcatlipoca'), 'weaponR') > pieceTris(shared('aztec_tezcatlipoca'), 'weaponR') + 100, 'obsidian teeth are geometry');
  // a chimalli has a fringe of feathers about its rim; the sun god's has five balls of down as well
  for (const [id, more] of [['warrior', 120], ['aztec_huitzilopochtli', 150]]) {
    const mine = pieceSize(aztec(id), 'shield');
    const plain = pieceSize(shared(id), 'shield');
    assert.ok(mine.y > plain.y * 1.15, `${id}: the shield and its fringe are larger (${mine.y.toFixed(2)} against ${plain.y.toFixed(2)})`);
    assert.ok(pieceTris(aztec(id), 'shield') > pieceTris(shared(id), 'shield') + more, `${id}: the fringe is feathers`);
  }
  // the mirror: a disc of black glass, smaller than the shared one, with wisps of smoke standing above it
  const mirror = pieceSize(aztec('aztec_tezcatlipoca'), 'weaponL');
  const plainMirror = pieceSize(shared('aztec_tezcatlipoca'), 'weaponL');
  assert.ok(mirror.x > plainMirror.x * 1.25 && mirror.z < plainMirror.z, `the smoke rises above a smaller disc (${mirror.x.toFixed(2)} by ${mirror.z.toFixed(2)})`);
  assert.ok(pieceTris(aztec('aztec_tezcatlipoca'), 'weaponL') > pieceTris(shared('aztec_tezcatlipoca'), 'weaponL') + 100, 'with its wisps');
  // the helpers' jar of rain is rounder and lighter than the shared cauldron
  assert.ok(pieceTris(aztec('aztec_tlaloque'), 'weaponR') < pieceTris(shared('aztec_tlaloque'), 'weaponR'), 'a jar is simpler than a cauldron on its chains');
  assert.ok(pieceSize(aztec('aztec_tlaloque'), 'weaponR').z < pieceSize(shared('aztec_tlaloque'), 'weaponR').z * 0.85, 'and slimmer');
  // the macuahuitl is built by the same code for a club and a sword
  assert.ok(RICH_WEAPONS.has('club') && RICH_WEAPONS.has('sword'));
});

test('the gods and the eagle warrior wear their regalia: the hummingbird\'s needle, the eagle\'s beak, the rain god\'s fan of plumes', () => {
  const shared = (id) => ({ ...aztec(id), pantheon: 'norse', lookOf: 'norse' });
  const box = (u) => bodyBox(buildRichTemplate(u));
  // the beak of the eagle helm and the needle of the hummingbird helm stand out before the face
  assert.ok(box(aztec('aztec_eagle_warrior')).max.x > box(shared('aztec_eagle_warrior')).max.x + 0.06, 'the eagle\'s beak');
  assert.ok(box(aztec('aztec_huitzilopochtli')).max.x > box(shared('aztec_huitzilopochtli')).max.x + 0.15, 'the hummingbird\'s needle');
  // the fan of plumes behind Tlaloc's shoulders reaches out behind and to the sides
  const fan = box(aztec('aztec_tlaloc'));
  const plain = box(shared('aztec_tlaloc'));
  assert.ok(fan.min.x < plain.min.x - 0.06, 'the fan stands behind him');
  assert.ok(fan.max.z > plain.max.z + 0.08 && fan.min.z < plain.min.z - 0.08, 'and spreads wider than his shoulders');
  // the eagle's wing feathers trail from the forearms: wider than the same suit without them
  assert.ok(box(aztec('aztec_eagle_warrior')).max.z > box(shared('aztec_eagle_warrior')).max.z + 0.02);
});

test('the gods\' faces are painted: the sun god\'s black band across the eyes, the Smoking Mirror\'s stripes of yellow, nobody else\'s', () => {
  const az = outfitFor('aztec');
  const D = { hs: 1, headX: 0.02, headCY: 1.5 };
  const E = (id, more = {}) => ({ ctx: { unit: { id }, cls: 'infantry' }, worker: false, armor: true, D, ...more });
  // a vertex on the front of the face, dy above the eyes' line
  const at = (paint, dy, x = D.headX + 0.1, z = 0) => {
    const o = { r: 0.5, g: 0.4, b: 0.3, team: 0 };
    paint(o, x, D.headCY + dy * D.hs, z);
    return o;
  };
  for (const id of ['warrior', 'archer', 'priest', 'aztec_tlaloc', 'aztec_tlaloque', 'aztec_eagle_warrior']) {
    assert.equal(az.skinPaint(E(id, { armor: id === 'warrior' })), null, `${id} has no face paint`);
  }
  assert.equal(az.skinPaint(E('worshipper', { worker: true })), null, 'nor does a worshipper');
  const sun = az.skinPaint(E('aztec_huitzilopochtli'));
  assert.ok(at(sun, 0.01).r < 0.1 && at(sun, 0.01).b < 0.1, 'black across the eyes');
  assert.deepEqual(at(sun, 0.06), { r: 0.5, g: 0.4, b: 0.3, team: 0 }, 'and nothing above it');
  assert.deepEqual(at(sun, -0.05), { r: 0.5, g: 0.4, b: 0.3, team: 0 }, 'or below');
  assert.deepEqual(at(sun, 0.01, D.headX - 0.05), { r: 0.5, g: 0.4, b: 0.3, team: 0 }, 'or behind the face');
  const smoke = az.skinPaint(E('aztec_tezcatlipoca'));
  const stripe = at(smoke, 0.01);
  assert.ok(stripe.r > 0.6 && stripe.g > 0.4 && stripe.b < 0.1, 'a stripe of yellow across the eyes');
  assert.ok(at(smoke, -0.05).r > 0.6, 'and another across the chin');
  assert.deepEqual(at(smoke, -0.025), { r: 0.5, g: 0.4, b: 0.3, team: 0 }, 'black skin between them');
  assert.deepEqual(at(smoke, 0.01, D.headX + 0.1, 0.2), { r: 0.5, g: 0.4, b: 0.3, team: 0 }, 'none on the ears');
});

test('the paints of the Aztec look: a jaguar\'s rosettes, quilting stitched on a diamond grid, rows of feathers', () => {
  // each paint over a patch of the unit's surface: how much it darkens, and by how much
  const stat = (paint) => {
    let dark = 0;
    let n = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        for (let k = 0; k < 10; k++) {
          const o = { r: 1, g: 1, b: 1, team: 0 };
          paint(o, i * 0.0173, j * 0.0171, (k - 5) * 0.0169);
          n++;
          if (o.r < 0.9) dark++;
          min = Math.min(min, o.r);
          max = Math.max(max, o.r);
          assert.ok(o.r === o.g && o.g === o.b, 'a shade, not a tint');
        }
      }
    }
    return { share: dark / n, min, max };
  };
  const spots = stat(jaguarSpots(0.05));
  assert.ok(spots.share > 0.05 && spots.share < 0.3, `rosettes cover some of the pelt (${spots.share.toFixed(2)})`);
  assert.ok(spots.min < 0.4 && spots.max === 1, 'a dark middle and clear tawny between');
  const stitches = stat(quilt(0.05, 0.8));
  assert.ok(stitches.share > 0.25 && stitches.share < 0.5, `the stitching is a grid of lines (${stitches.share.toFixed(2)})`);
  assert.ok(Math.abs(stitches.min - 0.8) < 1e-9 && stitches.max === 1, 'a shade darker than the cotton');
  const rows = stat(featherRows({ pitch: 0.04, per: 14 }));
  assert.ok(rows.min < 0.75 && rows.max > 1.05, 'dark where one feather lies over the next, light on its face');
  // a seam is stitched, the middle of a quilted diamond is not; on a team-painted vertex the team's color is what is scaled
  const seam = { r: 1, g: 1, b: 1, team: 1 };
  quilt(0.05, 0.8)(seam, 0, 0.05, 0);
  assert.ok(Math.abs(seam.team - 0.8) < 1e-9 && seam.r === 1, 'the stitching on team-colored cotton is a darker team color');
  const middle = { r: 1, g: 1, b: 1, team: 1 };
  quilt(0.05, 0.8)(middle, 0, 0.025, 0);
  assert.equal(middle.team, 1);
});

test('the Aztec people have black hair, the gods have it too', () => {
  const az = outfitFor('aztec');
  const pal = { hair: new THREE.Color('#8a5a3a'), skin: new THREE.Color('#d9a678'), primary: new THREE.Color('#b08a5a') };
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  for (const mortal of [true, false]) {
    const people = az.palette(pal, { mortal, unit: { id: mortal ? 'warrior' : 'aztec_huitzilopochtli' } });
    assert.ok(lum(people.hair) < 0.03, 'black hair');
    assert.equal(people.skin, pal.skin, 'the rest of the palette is kept');
  }
  assert.equal(pal.hair.getHexString(), '8a5a3a', 'the shared palette itself is not touched');
});

test('Aztec mortals, gods and helpers carry the team\'s color on their cloth, plumes and shields, the gold keeps its own', () => {
  for (const [id, share] of [['worshipper', 0.04], ['warrior', 0.06], ['archer', 0.02], ['priest', 0.03], ['aztec_huitzilopochtli', 0.008], ['aztec_tezcatlipoca', 0.02], ['aztec_tlaloc', 0.02], ['aztec_tlaloque', 0.06], ['aztec_eagle_warrior', 0.15]]) {
    const fx = buildRichTemplate(aztec(id)).rich.geo.attributes.aFx.array;
    let team = 0;
    let metal = 0;
    for (let i = 0; i < fx.length; i += 4) {
      if (fx[i] > 0) team++;
      if (fx[i + 3] > 0.3) metal++;
    }
    const n = fx.length / 4;
    assert.ok(team > n * share, `${id}: team-colored vertices ${team} of ${n}`);
    if (id === 'aztec_huitzilopochtli') assert.ok(metal > n * 0.1, `${id}: gold vertices ${metal} of ${n}`);
  }
  // the sun god's shield is the team's color too, under its balls of white down
  const shield = buildRichTemplate(aztec('aztec_huitzilopochtli')).rich.attach.find((a) => a.name === 'shield');
  const fx = shield.geo.attributes.aFx.array;
  let team = 0;
  for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) team++;
  assert.ok(team > fx.length / 4 * 0.2, `the sun god's shield face is team painted (${team} of ${fx.length / 4})`);
});

test('the Aztec gods, mortals and the eagle warrior animate every state without a NaN', () => {
  for (const id of AZTEC) {
    const m = buildUnitModel(aztec(id), PLAYER_COLORS[2], { detail: 'rich' });
    assert.ok(m.rich, `${id} should be rich`);
    runStates(m, id);
    m.dispose();
  }
});

test('the Celts dress their own way: tartan, mail, a pinned plaid cloak, torcs and a red-haired people', () => {
  const base = outfitFor('norse');
  const celt = outfitFor('celtic');
  for (const layer of LAYERS) assert.equal(typeof celt[layer], 'function', `the Celtic ${layer} layer`);
  for (const layer of LAYERS) assert.notEqual(celt[layer], base[layer], `the Celts dress their ${layer} their own way`);
  assert.equal(typeof celt.palette, 'function', 'the people\'s hair is red, straw or white');
  assert.equal(typeof celt.gear, 'function', 'a double axe, a torch and a druid\'s staff are styled');
  assert.equal(typeof celt.skinPaint, 'function', 'the raiders\' woad and the Morrigan\'s kohl are painted over their skin');
  assert.equal(typeof celt.shield, 'function', 'the tall oval shield is not the shared round one');
  assert.ok(RICH_PANTHEONS.has('celtic'), 'the Celtic players get the new characters');
});

test('every Celtic humanoid, the giant and the Woad Raider are dressed in the Celtic look; the banshee, the headless rider, the crow and the ram stay low-poly', () => {
  for (const id of CELTIC) assert.ok(richSupported(celtic(id)), `${id} is supported`);
  for (const id of ['celtic_banshee', 'celtic_dullahan', 'celtic_battle_crow', 'battering_ram']) assert.ok(!richSupported(celtic(id)), `${id} stays low-poly`);
  // a Celtic warrior is not an Aztec one
  assert.notEqual(buildRichTemplate(celtic('warrior')).triangles, buildRichTemplate(aztec('warrior')).triangles);
  assert.notEqual(buildRichTemplate(celtic('priest')).triangles, buildRichTemplate(aztec('priest')).triangles);
});

test('the Celts carry what they are known by: a sword and the tall shield, a bow, a druid\'s staff, a club, spears, a torch, a double axe, a mace', () => {
  const names = (id) => buildRichTemplate(celtic(id)).rich.attach.filter((x) => !x.tool).map((x) => x.name).sort();
  assert.deepEqual(names('warrior'), ['shield', 'weaponR'], 'a sword and a shield');
  assert.deepEqual(names('archer'), ['weaponL'], 'a bow');
  assert.deepEqual(names('priest'), ['weaponR'], 'a staff');
  assert.deepEqual(names('celtic_woad_raider'), ['weaponR'], 'a double axe');
  assert.deepEqual(names('celtic_the_dagda'), ['weaponR'], 'the club');
  assert.deepEqual(names('celtic_the_morrigan'), ['raven', 'weaponR'], 'a spear and the raven on her shoulder');
  assert.deepEqual(names('celtic_lugh'), ['weaponR'], 'the spear');
  assert.deepEqual(names('celtic_brigid'), ['flameCrown', 'weaponR'], 'a torch under a crown of flame');
  assert.deepEqual(names('celtic_balor'), ['weaponR'], 'a mace');
  assert.deepEqual(names('worshipper'), [], 'the worshippers\' tools are not held items');
});

test('the Celts hold their things their own way: a double axe, a torch, an oak staff with a crescent, a tall oval shield', () => {
  // the same unit under another people's outfit holds the shared item
  const shared = (id) => ({ ...celtic(id), pantheon: 'norse', lookOf: 'norse' });
  // the double axe and the torch are built by the rich gear for the Celts only (no other outfit asks for them), the others keep the low-poly ones
  assert.ok(!RICH_WEAPONS.has('double_axe') && !RICH_WEAPONS.has('torch'));
  const axe = pieceSize(celtic('celtic_woad_raider'), 'weaponR');
  const plainAxe = pieceSize(shared('celtic_woad_raider'), 'weaponR');
  assert.ok(axe.x > plainAxe.x * 1.4, `a long haft (${axe.x.toFixed(2)} against ${plainAxe.x.toFixed(2)})`);
  assert.ok(axe.y > plainAxe.y * 1.1, 'and broader blades');
  assert.ok(pieceTris(celtic('celtic_woad_raider'), 'weaponR') > pieceTris(shared('celtic_woad_raider'), 'weaponR') + 400, 'two horned blades on an iron block, a wrapped grip');
  const torch = pieceSize(celtic('celtic_brigid'), 'weaponR');
  const plainTorch = pieceSize(shared('celtic_brigid'), 'weaponR');
  assert.ok(torch.x > plainTorch.x * 1.3, `a long stave (${torch.x.toFixed(2)} against ${plainTorch.x.toFixed(2)})`);
  assert.ok(pieceTris(celtic('celtic_brigid'), 'weaponR') > pieceTris(shared('celtic_brigid'), 'weaponR') + 400, 'a head of rags bound in iron and three tongues of flame');
  // the druid's staff: a crescent of gold at its head, twice as broad as the plain staff's
  const staff = pieceSize(celtic('priest'), 'weaponR');
  const plainStaff = pieceSize(shared('priest'), 'weaponR');
  assert.ok(staff.y > plainStaff.y * 1.5, `the crescent (${staff.y.toFixed(2)} against ${plainStaff.y.toFixed(2)})`);
  // the shield: a tall oval, with a band and two studs of bronze in its face; the shared one is round
  const shield = pieceSize(celtic('warrior'), 'shield');
  const plain = pieceSize(shared('warrior'), 'shield');
  assert.ok(shield.y > shield.x * 1.5, `taller than it is wide (${shield.y.toFixed(2)} by ${shield.x.toFixed(2)})`);
  assert.ok(plain.x > plain.y * 0.95, 'the shared one is as wide as it is tall');
  assert.ok(pieceTris(celtic('warrior'), 'shield') > pieceTris(shared('warrior'), 'shield') + 300, 'the band and the studs are geometry');
  // Balor's mace is black iron, darker than the shared one
  const lum = (u, name) => {
    const c = buildRichTemplate(u).rich.attach.find((a) => a.name === name).geo.attributes.color.array;
    let sum = 0;
    for (let i = 0; i < c.length; i += 3) sum += 0.2126 * c[i] + 0.7152 * c[i + 1] + 0.0722 * c[i + 2];
    return sum / (c.length / 3);
  };
  assert.ok(lum(celtic('celtic_balor'), 'weaponR') < lum(shared('celtic_balor'), 'weaponR') * 0.6, 'black iron');
});

test('the Celtic gear styles: what the outfit asks the gear builder for', () => {
  const celt = outfitFor('celtic');
  const at = (id, item) => celt.gear({ unit: { id } }, { id: item });
  assert.equal(at('celtic_woad_raider', 'double_axe').build, true, 'the double axe is built by the rich gear');
  assert.equal(at('celtic_brigid', 'torch').build, true, 'and the torch');
  assert.equal(at('priest', 'staff').staff, 'druid', 'the staff of a druid');
  assert.ok(at('celtic_the_dagda', 'club').studs, 'the club studded with iron');
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  assert.ok(lum(at('celtic_the_morrigan', 'spear').shaftColor) < lum(at('celtic_lugh', 'spear').shaftColor) * 0.5, 'the Morrigan\'s spear is black ash, Lugh\'s the pale one');
  assert.equal(at('celtic_balor', 'mace').color, at('celtic_balor', 'mace').color);
  assert.equal(at('celtic_balor', 'bow'), null, 'the rest are as shared');
});

/** The dressing environment of a unit's own size, with an empty kit: for the pieces of clothing and regalia on their own. */
function dressing(unit) {
  const ctx = unitContext(unit);
  const D = richDims(ctx, unit.visual.body === 'giant' ? 'giant' : 'humanoid');
  const spec = humanoidSpec({ ...D, headY: D.headPivot, shoulderDrop: 0.02 }, {});
  const bind = makeBinds(spec, D);
  const kit = new MeshKit(spec, { sides: 12, rings: 1 });
  return { ctx, D, spec, bind, kit, pal: ctx.pal, E: { D, pal: ctx.pal, spec, ctx } };
}

const boxOf = (geo) => {
  geo.computeBoundingBox();
  return geo.boundingBox;
};

test('a torc is an open ring of rope about the neck with a knob at each end of the gap at the throat', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addTorc } = await import('../../src/render/models/rich-clothing.js');
  const { kit, D, bind } = dressing(celtic('celtic_the_dagda'));
  addTorc(kit, D, bind, { color: withMat('#dfb54a', 'gold'), big: 1 });
  const geo = kit.build({ ground: 1 });
  const b = boxOf(geo);
  assert.ok(b.min.y > D.shoulderY - 0.06 && b.max.y < D.shoulderY + 0.1, `about the base of the neck (y ${b.min.y.toFixed(2)} to ${b.max.y.toFixed(2)}, shoulders at ${D.shoulderY.toFixed(2)})`);
  assert.ok(b.max.z - b.min.z > 0.2 && b.max.z - b.min.z < 0.5, 'a ring, not a collar');
  // the gap: between the two knobs, nothing in front of the throat (the face is +x)
  const pos = geo.attributes.position.array;
  const cx = (b.min.x + b.max.x) / 2;
  let front = 0;
  let knobs = 0;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i] > cx + 0.05 && Math.abs(pos[i + 2]) < 0.008) front++;
    if (pos[i] > cx + 0.05 && Math.abs(pos[i + 2]) < 0.045) knobs++;
  }
  assert.equal(front, 0, 'open at the throat');
  assert.ok(knobs > 20, 'a knob at each end of the gap');
  assert.ok(geo.userData.triangles > 150 && geo.userData.triangles < 600, `a rope of a few hundred triangles (${geo.userData.triangles})`);
  // a bigger torc is a thicker rope on a ring of the same neck
  const thick = dressing(celtic('celtic_the_dagda'));
  addTorc(thick.kit, thick.D, thick.bind, { color: withMat('#dfb54a', 'gold'), big: 1.7 });
  const bt = boxOf(thick.kit.build({ ground: 1 }));
  assert.ok(bt.max.y - bt.min.y > b.max.y - b.min.y + 0.01, 'the rope is thicker');
});

test('a penannular brooch pins the cloak at the shoulder: a small open ring with a pin across it, a gem at its foot if it has one', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addBrooch } = await import('../../src/render/models/rich-clothing.js');
  const make = (opts) => {
    const { kit, D, bind } = dressing(celtic('warrior'));
    addBrooch(kit, D, bind, { color: withMat('#b87a3c', 'gold'), ...opts });
    return kit.build({ ground: 1 });
  };
  const plain = make({});
  const gem = make({ gem: withMat('#3a6ad0', 'gem') });
  const size = boxOf(plain).getSize(new THREE.Vector3());
  assert.ok(Math.max(size.x, size.y, size.z) < 0.1 && Math.max(size.x, size.y, size.z) > 0.03, `a brooch is a few centimeters across (${size.toArray().map((v) => v.toFixed(3))})`);
  assert.ok(gem.userData.triangles > plain.userData.triangles + 20, 'the stone is a bead of its own');
  const big = boxOf(make({ size: 1.6 })).getSize(new THREE.Vector3());
  assert.ok(Math.max(big.x, big.y, big.z) > Math.max(size.x, size.y, size.z) * 1.3, 'size scales it');
  // set on a surface of its own (a cloak's collar): its center is where it was asked
  const at = make({ at: { c: [0.05, 1.2, 0.15], n: [0, 0, 1] } });
  const c = boxOf(at).getCenter(new THREE.Vector3());
  assert.ok(Math.abs(c.x - 0.05) < 0.03 && Math.abs(c.y - 1.2) < 0.03 && Math.abs(c.z - 0.15) < 0.04, `set at the point given (${c.toArray().map((v) => v.toFixed(3))})`);
});

test('a mail shirt hangs from the neck below the hip, flares at its hem and its sleeves end at the elbow', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addMailShirt } = await import('../../src/render/models/rich-clothing.js');
  const make = (opts) => {
    const { kit, D, bind } = dressing(celtic('warrior'));
    addMailShirt(kit, D, bind, { color: withMat('#8b949e', 'metal'), ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const bare = make({ sleeves: false, hem: 0.16 });
  const sleeved = make({ sleeves: true, hem: 0.16, trim: withMat('#6a4528', 'leather') });
  const b = boxOf(bare.geo);
  assert.ok(b.min.y < bare.D.hipY - 0.1, `it hangs below the hip (${b.min.y.toFixed(2)} against ${bare.D.hipY.toFixed(2)})`);
  assert.ok(b.max.y > bare.D.shoulderY - 0.02, 'from the shoulders');
  const pos = bare.geo.attributes.position.array;
  const half = (y0, y1) => {
    let w = 0;
    for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] > y0 && pos[i + 1] < y1) w = Math.max(w, Math.abs(pos[i + 2]));
    return w;
  };
  assert.ok(half(b.min.y, b.min.y + 0.03) > half(bare.D.hipY + 0.02, bare.D.hipY + 0.05) + 0.015, 'the hem flares out');
  assert.ok(boxOf(sleeved.geo).max.z > b.max.z + 0.03, 'the sleeves reach out over the arms');
  assert.ok(sleeved.geo.userData.triangles > bare.geo.userData.triangles + 100);
  // the sleeves stop at the elbow
  const elbow = sleeved.D.shoulderY - 0.02 - sleeved.D.upper;
  const sp = sleeved.geo.attributes.position.array;
  let lowest = Infinity;
  for (let k = 0; k < sp.length; k += 3) if (Math.abs(sp[k + 2]) > b.max.z + 0.005) lowest = Math.min(lowest, sp[k + 1]);
  assert.ok(lowest > elbow - 0.02 && lowest < elbow + 0.1, `the sleeve ends at the elbow (${lowest.toFixed(2)} against ${elbow.toFixed(2)})`);
});

test('trews are woven in a check from the ankle to the hip', async () => {
  const { addTrews } = await import('../../src/render/models/rich-clothing.js');
  const { kit, D, bind } = dressing(celtic('warrior'));
  addTrews(kit, D, bind, { color: TEAM(0.92, 'cloth'), hue: new THREE.Color('#2f6b3a'), cell: 0.1, from: D.ankleY + 0.036 });
  const geo = kit.build({ ground: 1 });
  const b = boxOf(geo);
  assert.ok(b.min.y < D.ankleY + 0.05 && b.max.y > D.hipY - 0.02, `from the ankle (${b.min.y.toFixed(2)}) to the hip (${b.max.y.toFixed(2)})`);
  // the check: some of the cloth is the team's color, some the green of the bands, some in between
  const fx = geo.attributes.aFx.array;
  const col = geo.attributes.color.array;
  let team = 0;
  let green = 0;
  for (let i = 0; i < fx.length / 4; i++) {
    if (fx[i * 4] > 0) team++;
    else if (col[i * 3 + 1] > col[i * 3] * 1.3 && col[i * 3 + 1] > col[i * 3 + 2] * 1.3) green++;
  }
  const n = fx.length / 4;
  assert.ok(team > n * 0.1 && green > n * 0.1, `team ${team}, green ${green} of ${n}`);
});

test('antlers rise from the brow, a tine at a time, over a band; Brigid\'s flame crown and the Morrigan\'s raven are rigid pieces that ride the head and the chest', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addAntlers } = await import('../../src/render/models/rich-headgear.js');
  const { addFlameCrown, addRaven } = await import('../../src/render/models/rich-regalia.js');
  const make = (opts) => {
    const { kit, D, pal, bind } = dressing(celtic('priest'));
    addAntlers(kit, D, pal, bind, { color: withMat('#ebe3cf', 'bone'), ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const a3 = make({ tines: 3 });
  const a0 = make({ tines: 0 });
  assert.ok(a3.geo.userData.triangles > a0.geo.userData.triangles + 40, 'the tines are geometry');
  assert.ok(boxOf(a3.geo).max.y > a3.D.headCY + 0.2 * a3.D.hs, 'the antlers stand above the head');
  assert.ok(Math.abs(boxOf(a3.geo).min.z + boxOf(a3.geo).max.z) < 0.01, 'a stag\'s pair, even on both sides');
  const banded = make({ band: withMat('#6a4528', 'leather') });
  assert.ok(banded.geo.userData.triangles > make({}).geo.userData.triangles + 20, 'a band across the brow');
  assert.ok(boxOf(make({ size: 1.5 }).geo).max.y > boxOf(a3.geo).max.y + 0.03, 'size scales them');
  // the flame crown: more tongues, more flame; rides the head and flickers
  const { E } = dressing(celtic('celtic_brigid'));
  const nine = addFlameCrown(E, { tongues: 9 });
  const five = addFlameCrown(E, { tongues: 5 });
  assert.equal(nine.bone, B.head);
  assert.ok(nine.flicker && nine.geo.morphAttributes.position, 'the flames flicker');
  assert.ok(nine.geo.userData.triangles > five.geo.userData.triangles + 100);
  // the raven: perched on the shoulder it is asked for, small
  const left = addRaven(dressing(celtic('celtic_the_morrigan')).E, { side: -1 });
  const right = addRaven(dressing(celtic('celtic_the_morrigan')).E, { side: 1 });
  assert.equal(left.bone, B.chest);
  assert.ok(boxOf(left.geo).getCenter(new THREE.Vector3()).z < -0.1 && boxOf(right.geo).getCenter(new THREE.Vector3()).z > 0.1, 'on the left shoulder or the right');
  const bird = boxOf(left.geo).getSize(new THREE.Vector3());
  assert.ok(Math.max(bird.x, bird.y, bird.z) < 0.5 && Math.max(bird.x, bird.y, bird.z) > 0.15, `a bird on a shoulder (${bird.toArray().map((v) => v.toFixed(2))})`);
  assert.ok(!left.flicker, 'a bird does not flicker');
});

test('the gods and the druid wear their regalia: a stag\'s antlers, a crown of rays, a crown of feathers; the torc and the mail show on the body', () => {
  const shared = (id) => ({ ...celtic(id), pantheon: 'norse', lookOf: 'norse' });
  const box = (u) => bodyBox(buildRichTemplate(u));
  assert.ok(box(celtic('priest')).max.y > box(shared('priest')).max.y + 0.2, 'the druid\'s antlers');
  assert.ok(box(celtic('celtic_lugh')).max.y > box(shared('celtic_lugh')).max.y + 0.08, 'Lugh\'s crown of rays');
  assert.ok(box(celtic('celtic_the_morrigan')).max.y > box(shared('celtic_the_morrigan')).max.y + 0.06, 'the Morrigan\'s feathers');
  // the tails of the raiders' hair and the plaid down a warrior's back reach behind the unit
  assert.ok(box(celtic('warrior')).min.x < box(shared('warrior')).min.x - 0.05, 'a cloak hangs down the warrior\'s back');
  // every Celtic unit is built from more than the shared look (the dress, the torc, the cloak): none is plainer
  for (const id of CELTIC) {
    assert.ok(buildRichTemplate(celtic(id)).rich.geo.userData.triangles > buildRichTemplate(shared(id)).rich.geo.userData.triangles, `${id} is dressed in more than the shared look`);
  }
  // Brigid's crown of flame and her torch flicker; nothing else of the Celts' does
  const flick = (id) => buildRichTemplate(celtic(id)).rich.attach.filter((a) => a.flicker).map((a) => a.name).sort();
  assert.deepEqual(flick('celtic_brigid'), ['flameCrown', 'weaponR']);
  for (const id of CELTIC.filter((x) => x !== 'celtic_brigid')) assert.deepEqual(flick(id), [], `${id}: no flames`);
});

test('the woad: the raiders\' skin is painted in bands of blue, the Morrigan\'s eyes are blacked, nobody else is painted', () => {
  const celt = outfitFor('celtic');
  const D = { hs: 1, headX: 0.02, headCY: 1.5, shoulderY: 1.3, upper: 0.3, fore: 0.28, shoulderZ: 0.2 };
  const E = (id, more = {}) => ({ ctx: { unit: { id }, cls: 'infantry', worker: false, ex: new Set(more.armor ? ['armor'] : []) }, worker: false, armor: false, D, ...more });
  const base = { r: 0.5, g: 0.4, b: 0.3, team: 0 };
  const at = (paint, x, y, z) => {
    const o = { ...base };
    paint(o, x, y, z);
    return o;
  };
  for (const id of ['warrior', 'archer', 'priest', 'celtic_the_dagda', 'celtic_lugh', 'celtic_brigid', 'celtic_balor']) assert.equal(celt.skinPaint(E(id, { armor: id === 'warrior' })), null, `${id} is not painted`);
  assert.equal(celt.skinPaint(E('worshipper', { worker: true, ctx: { unit: { id: 'worshipper' }, cls: 'worker', worker: true, ex: new Set() } })), null, 'nor is a worshipper');
  const woad = celt.skinPaint(E('celtic_woad_raider'));
  const blue = (o) => o.b > o.r * 3 && o.b > 0.2;
  const skin = (o) => o.r > 0.4 && o.r > o.b;
  // the face: fair, a band of woad across the eyes, stripes down the cheeks
  assert.ok(blue(at(woad, D.headX + 0.1, D.headCY + 0.01, 0)), 'the band across the eyes');
  assert.ok(skin(at(woad, D.headX + 0.1, D.headCY + 0.07, 0)), 'a fair forehead');
  assert.ok(blue(at(woad, D.headX + 0.1, D.headCY - 0.06, 0.04)), 'a stripe down the cheek');
  assert.ok(skin(at(woad, D.headX + 0.1, D.headCY - 0.06, 0.049)), 'and fair skin between the stripes');
  assert.ok(skin(at(woad, D.headX - 0.05, D.headCY + 0.01, 0)), 'no paint on the back of the head');
  // the body: wavy bands of blue about the chest, the forearms blue to the elbow, the hands bare
  assert.ok(blue(at(woad, 0.1, 1.0, 0)) && skin(at(woad, 0.1, 1.06, 0)), 'bands of woad and of skin');
  assert.ok(blue(at(woad, 0, 0.85, 0.2)), 'the forearm is blue');
  assert.ok(skin(at(woad, 0, 0.6, 0.2)), 'the hand is not');
  const kohl = celt.skinPaint(E('celtic_the_morrigan'));
  assert.ok(at(kohl, D.headX + 0.1, D.headCY + 0.01, 0).r < 0.1, 'black across her eyes');
  assert.deepEqual(at(kohl, D.headX + 0.1, D.headCY + 0.07, 0), base, 'and nothing above');
  assert.deepEqual(at(kohl, D.headX + 0.1, D.headCY + 0.01, 0.2), base, 'or on her ears');
  assert.deepEqual(at(kohl, D.headX - 0.05, D.headCY + 0.01, 0), base, 'or behind');
});

test('tartan is a woven check: bands of the warp and the weft, darkest where they cross; mail is a flecked, uneven sheen', () => {
  const stat = (paint, team = 0) => {
    let dark = 0;
    let n = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        for (let k = 0; k < 10; k++) {
          const o = { r: 1, g: 1, b: 1, team };
          paint(o, i * 0.0173, j * 0.0171, (k - 5) * 0.0169);
          const v = team ? o.team : o.r;
          n++;
          if (v < 0.97) dark++;
          min = Math.min(min, v);
          max = Math.max(max, v);
          if (!team) assert.ok(o.r === o.g && o.g === o.b, 'a shade, not a tint');
        }
      }
    }
    return { share: dark / n, min, max };
  };
  const check = stat(tartan({ cell: 0.1, k: 0.7 }));
  assert.ok(check.share > 0.6 && check.share < 0.85, `most of the cloth is in a band of one set or the other (${check.share.toFixed(2)})`);
  assert.ok(Math.abs(check.min - 0.49) < 1e-9 && check.max === 1, 'darkest where the two cross');
  const teamCheck = stat(tartan({ cell: 0.1, k: 0.7 }), 1);
  assert.ok(Math.abs(teamCheck.min - 0.49) < 1e-9 && teamCheck.max === 1, 'on team colored cloth the team\'s color is what is scaled');
  // flat: the warp bands run along z, the same at any x; about a limb they follow the arc, which changes with x
  const flat = tartan({ cell: 0.1, flat: true });
  const arc = tartan({ cell: 0.1 });
  const val = (paint, x, y, z) => {
    const o = { r: 1, g: 1, b: 1, team: 0 };
    paint(o, x, y, z);
    return o.r;
  };
  assert.equal(val(flat, 0.01, 0.07, 0.02), val(flat, 0.5, 0.07, 0.02), 'a hanging sheet is woven across z only');
  assert.notEqual(val(arc, 0.01, 0.07, 0.02), val(arc, 0.5, 0.07, 0.02), 'a limb\'s bands follow its arc');
  // hue: the warp bands are of that color (a team painted vertex turns plain there)
  const green = new THREE.Color('#2f6b3a');
  const band = tartan({ cell: 0.1, flat: true, hue: green, band: 0.5 });
  const g1 = { r: 1, g: 1, b: 1, team: 0 };
  band(g1, 0, 0.07, 0.02);
  assert.ok(g1.g > g1.r * 1.5 && g1.g > g1.b * 1.5, 'the warp band is green');
  const g2 = { r: 1, g: 1, b: 1, team: 1 };
  band(g2, 0, 0.07, 0.02);
  assert.equal(g2.team, 0);
  assert.equal(g2.g, green.g, 'a team painted vertex in a green band is the green');
  const g3 = { r: 1, g: 1, b: 1, team: 1 };
  band(g3, 0, 0.07, 0.07);
  assert.equal(g3.team, 1, 'and in the gap between bands it keeps the team\'s color');
  // mail: every ring a little darker than a flat plate, the rows alternating
  const mail = stat(mailSheen(0.03, 0.2));
  assert.ok(mail.max < 1 && mail.min > 0.7 && mail.share > 0.5, `an uneven sheen (${mail.min.toFixed(2)} to ${mail.max.toFixed(2)})`);
  const rowMean = (row) => {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < 60; i++) {
      for (let j = 0; j < 20; j++) {
        const o = { r: 1, g: 1, b: 1, team: 0 };
        mailSheen(0.03, 0.2)(o, i * 0.011, (row + 0.5) * 0.03, j * 0.013);
        sum += o.r;
        n++;
      }
    }
    return sum / n;
  };
  assert.ok(Math.abs(rowMean(2) - rowMean(3)) > 0.03, 'the next row of rings catches the light the other way');
});

test('a drape across the chest is worn from either shoulder with its outer face out: the shawls and slings of the Celts, a Hindu goddess\'s pallu', () => {
  for (const side of [1, -1]) {
    const { kit, D, bind } = dressing(celtic('worshipper'));
    addDrape(kit, D, bind, TEAM(1, 'cloth'), null, { side, width: 0.4 });
    const geo = kit.build({ ground: 1 });
    const pos = geo.attributes.position.array;
    const idx = geo.index.array;
    const fx = geo.attributes.aFx.array;
    // the outer face of the strip is the team's color, its inner face a plain grey
    let outward = 0;
    let faces = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      if (!(fx[a * 4] > 0 && fx[b * 4] > 0 && fx[c * 4] > 0)) continue;
      const p = (i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      const n = pb.clone().sub(pa).cross(pc.clone().sub(pa));
      const m = pa.clone().add(pb).add(pc).multiplyScalar(1 / 3);
      faces++;
      if (n.x * m.x + n.z * m.z > 0) outward++;
    }
    assert.ok(faces > 100, `side ${side}: the strip has faces (${faces})`);
    assert.ok(outward > faces * 0.95, `side ${side}: its team colored face looks outward (${outward} of ${faces})`);
  }
});

test('Celtic mortals, gods and helpers carry the team\'s color in their plaid, trews, kilts and shields; the gold and the iron keep their own', () => {
  for (const [id, share] of [['worshipper', 0.07], ['warrior', 0.1], ['archer', 0.02], ['priest', 0.02], ['celtic_the_dagda', 0.012], ['celtic_the_morrigan', 0.03], ['celtic_lugh', 0.012], ['celtic_brigid', 0.025], ['celtic_balor', 0.012], ['celtic_woad_raider', 0.05]]) {
    const fx = buildRichTemplate(celtic(id)).rich.geo.attributes.aFx.array;
    let team = 0;
    let metal = 0;
    for (let i = 0; i < fx.length; i += 4) {
      if (fx[i] > 0) team++;
      if (fx[i + 3] > 0.3) metal++;
    }
    const n = fx.length / 4;
    assert.ok(team > n * share, `${id}: team-colored vertices ${team} of ${n}`);
    if (id === 'celtic_lugh') assert.ok(metal > n * 0.12, `${id}: gold vertices ${metal} of ${n}`);
    if (id === 'warrior') assert.ok(metal > n * 0.1, `${id}: iron vertices ${metal} of ${n}`);
  }
  // a warrior's shield face is the team's color, under its band of bronze
  const shield = buildRichTemplate(celtic('warrior')).rich.attach.find((a) => a.name === 'shield');
  const fx = shield.geo.attributes.aFx.array;
  let team = 0;
  for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) team++;
  assert.ok(team > fx.length / 4 * 0.2, `the shield's face is team painted (${team} of ${fx.length / 4})`);
});

test('the people of the Celts are red-haired, the archers fair, the druid white and the raiders limed; the gods keep their own', () => {
  const celt = outfitFor('celtic');
  const pal = { hair: new THREE.Color('#222222'), skin: new THREE.Color('#d9a678'), primary: new THREE.Color('#b08a5a') };
  const hairOf = (unit, mortal = true) => celt.palette(pal, { mortal, unit: { id: unit.id }, worker: !!unit.worker, cls: unit.cls || 'infantry', ex: new Set(unit.armor ? ['armor'] : []) }).hair;
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const worker = hairOf({ id: 'worshipper', worker: true, cls: 'worker' });
  const warrior = hairOf({ id: 'warrior', armor: true });
  const druid = hairOf({ id: 'priest', cls: 'support' });
  const raider = hairOf({ id: 'celtic_woad_raider', armor: true });
  assert.ok(warrior.r > warrior.g * 1.5 && warrior.r > warrior.b * 2, 'red hair');
  assert.ok(worker.r > worker.b * 2, 'the workers\' is red too');
  assert.ok(lum(druid) > 0.6, 'a white beard and hair');
  assert.ok(lum(raider) > 0.4 && raider.r > raider.b * 1.5, 'limed straw');
  assert.equal(celt.palette(pal, { mortal: false, unit: { id: 'celtic_lugh' }, ex: new Set() }), pal, 'a god\'s palette is the unit\'s own');
  assert.equal(pal.hair.getHexString(), '222222', 'the shared palette itself is not touched');
});

test('the Celtic gods, mortals and the raider animate every state without a NaN', () => {
  for (const id of CELTIC) {
    const m = buildUnitModel(celtic(id), PLAYER_COLORS[2], { detail: 'rich' });
    assert.ok(m.rich, `${id} should be rich`);
    runStates(m, id);
    m.dispose();
  }
});

test('the Mesopotamians dress their own way: kaunakes, fringed shawls, scale coats, horned crowns and a black-haired people', () => {
  const base = outfitFor('norse');
  const meso = outfitFor('mesopotamian');
  for (const layer of LAYERS) assert.equal(typeof meso[layer], 'function', `the Mesopotamian ${layer} layer`);
  for (const layer of LAYERS) assert.notEqual(meso[layer], base[layer], `the Mesopotamians dress their ${layer} their own way`);
  assert.equal(typeof meso.palette, 'function', 'the people\'s hair is black');
  assert.equal(typeof meso.gear, 'function', 'a sling, spears of reed and a studded mace are styled');
  assert.equal(typeof meso.shield, 'function', 'the tall arched shield is not the shared round one');
  assert.ok(RICH_PANTHEONS.has('mesopotamian'), 'the Mesopotamian players get the new characters');
});

test('every Mesopotamian humanoid, the apkallu and the Slinger are dressed in the Mesopotamian look; Tiamat, the scorpion man, Anzu, the mushussu and the ram stay low-poly', () => {
  for (const id of MESOPOTAMIAN) assert.ok(richSupported(mesopotamian(id)), `${id} is supported`);
  for (const id of ['mesopotamian_tiamat', 'mesopotamian_scorpion_man', 'mesopotamian_anzu', 'mesopotamian_mushussu', 'mesopotamian_ugallu', 'battering_ram']) {
    assert.ok(!richSupported(mesopotamian(id)), `${id} stays low-poly`);
  }
  // a Mesopotamian warrior is not a Celtic one
  assert.notEqual(buildRichTemplate(mesopotamian('warrior')).triangles, buildRichTemplate(celtic('warrior')).triangles);
  assert.notEqual(buildRichTemplate(mesopotamian('priest')).triangles, buildRichTemplate(celtic('priest')).triangles);
});

test('the Mesopotamians carry what they are known by: a spear and the tall shield, a bow, a staff, a sling, a mace, a sword and the apkallu\'s bucket', () => {
  const names = (id) => buildRichTemplate(mesopotamian(id)).rich.attach.filter((x) => !x.tool).map((x) => x.name).sort();
  assert.deepEqual(names('warrior'), ['shield', 'weaponR'], 'a spear and a shield');
  assert.deepEqual(names('archer'), ['weaponL'], 'a bow');
  assert.deepEqual(names('priest'), ['weaponR'], 'a staff');
  assert.deepEqual(names('mesopotamian_slinger'), ['weaponR'], 'a sling');
  assert.deepEqual(names('mesopotamian_marduk'), ['weaponL'], 'the bow');
  assert.deepEqual(names('mesopotamian_ishtar'), ['weaponR', 'wingL1', 'wingL2', 'wingR1', 'wingR2'], 'a sword and her wings');
  assert.deepEqual(names('mesopotamian_enki'), ['weaponR'], 'a staff');
  assert.deepEqual(names('mesopotamian_nergal'), ['weaponR'], 'a mace');
  assert.deepEqual(names('mesopotamian_apkallu'), ['weaponR'], 'a bucket');
  assert.deepEqual(names('worshipper'), [], 'the worshippers\' tools are not held items');
});

test('the Mesopotamians hold their things their own way: a sling, a studded mace of black iron, spears of pale reed, a tall shield of wicker closing in an arch', () => {
  // the same unit under another people's outfit holds the shared item
  const shared = (id) => ({ ...mesopotamian(id), pantheon: 'norse', lookOf: 'norse' });
  const lum = (u, name) => {
    const c = buildRichTemplate(u).rich.attach.find((a) => a.name === name).geo.attributes.color.array;
    let sum = 0;
    for (let i = 0; i < c.length; i += 3) sum += 0.2126 * c[i] + 0.7152 * c[i + 1] + 0.0722 * c[i + 2];
    return sum / (c.length / 3);
  };
  // the sling is built by the rich gear for the Mesopotamians only (the whip is not one of its weapons): two cords, a pouch and a stone
  assert.ok(!RICH_WEAPONS.has('whip'));
  assert.ok(pieceTris(mesopotamian('mesopotamian_slinger'), 'weaponR') > pieceTris(shared('mesopotamian_slinger'), 'weaponR') + 150, 'the cords, the pouch and the stone are geometry');
  // Nergal's mace: black iron, its head a studded pear
  assert.ok(pieceTris(mesopotamian('mesopotamian_nergal'), 'weaponR') > pieceTris(shared('mesopotamian_nergal'), 'weaponR') + 80, 'two rows of studs');
  assert.ok(lum(mesopotamian('mesopotamian_nergal'), 'weaponR') < lum(shared('mesopotamian_nergal'), 'weaponR') * 0.6, 'black iron');
  // the spear's shaft is the pale one
  assert.ok(lum(mesopotamian('warrior'), 'weaponR') > lum(shared('warrior'), 'weaponR') * 1.1, 'a shaft of pale reed-wood');
  // the shield: a tall rectangle closing in an arch at the top; the shared one is round
  const shield = pieceSize(mesopotamian('warrior'), 'shield');
  const plain = pieceSize(shared('warrior'), 'shield');
  assert.ok(shield.y > shield.x * 1.8, `taller than it is wide (${shield.y.toFixed(2)} by ${shield.x.toFixed(2)})`);
  assert.ok(plain.x > plain.y * 0.95, 'the shared one is as wide as it is tall');
  const geo = buildRichTemplate(mesopotamian('warrior')).rich.attach.find((a) => a.name === 'shield').geo;
  const box = boxOf(geo);
  const pos = geo.attributes.position.array;
  const reach = (y0, y1) => {
    let w = 0;
    for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] >= y0 && pos[i + 1] <= y1) w = Math.max(w, Math.abs(pos[i]));
    return w;
  };
  const H = box.max.y - box.min.y;
  assert.ok(reach(box.max.y - 0.08 * H, box.max.y) < reach(box.min.y + 0.4 * H, box.min.y + 0.6 * H) * 0.7, 'closing in to an arch at the top');
  assert.ok(pieceTris(mesopotamian('warrior'), 'shield') > pieceTris(shared('warrior'), 'shield') + 200, 'the band and the studs are geometry');
});

test('the Mesopotamian gear styles: what the outfit asks the gear builder for', () => {
  const meso = outfitFor('mesopotamian');
  const at = (id, item) => meso.gear({ unit: { id } }, { id: item });
  assert.equal(at('mesopotamian_slinger', 'whip').build, true, 'the sling is built by the rich gear');
  assert.ok(at('warrior', 'spear').shaftColor, 'the spears have a pale shaft');
  assert.equal(at('mesopotamian_nergal', 'mace').head, 'pear', 'the mace has a pear for a head');
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  assert.ok(lum(at('mesopotamian_nergal', 'mace').color) < lum(at('mesopotamian_ugallu', 'mace').color) * 0.5, 'Nergal\'s is black iron, the others\' plain');
  assert.equal(at('mesopotamian_marduk', 'bow'), null, 'the rest are as shared');
});

test('the kaunakes hangs in tiers of woolly tufts from the waist: a tier is a row of its own, a long skirt reaches the ankles and a short one the knee', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addKaunakes } = await import('../../src/render/models/rich-clothing.js');
  const make = (opts) => {
    const { kit, D, bind } = dressing(mesopotamian('priest'));
    const r = addKaunakes(kit, D, bind, { color: withMat('#e2d6b6', 'fur'), ...opts });
    return { geo: kit.build({ ground: 1 }), D, r };
  };
  const three = make({ tiers: 3, len: 1 });
  const one = make({ tiers: 1, len: 1 });
  const knee = make({ tiers: 3, len: 0.5 });
  assert.ok(three.geo.userData.triangles > one.geo.userData.triangles * 2, 'every tier is a row of tufts of its own');
  assert.ok(boxOf(three.geo).min.y < three.D.ankleY + 0.1, 'a long skirt hangs to the ankles');
  assert.ok(boxOf(knee.geo).min.y > boxOf(three.geo).min.y + 0.15, 'a short one to the knee');
  assert.ok(three.r.y0 < knee.r.y0 && Math.abs(boxOf(three.geo).min.y - three.r.y0) < 0.12, 'it says where its lowest row ends');
  // it opens toward the hem: the tufts at the foot stand out wider than the waist
  const waist = boxOf(three.geo);
  const pos = three.geo.attributes.position.array;
  let atWaist = 0;
  let atHem = 0;
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i + 1] > three.D.hipY - 0.02) atWaist = Math.max(atWaist, Math.abs(pos[i + 2]));
    if (pos[i + 1] < waist.min.y + 0.06) atHem = Math.max(atHem, Math.abs(pos[i + 2]));
  }
  assert.ok(atHem > atWaist + 0.06, `wider at the hem (${atHem.toFixed(2)}) than at the waist (${atWaist.toFixed(2)})`);
});

test('tassels hang a length below each point they are given; a fringed drape hangs them along its lower edge', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addFringe } = await import('../../src/render/models/rich-clothing.js');
  const { kit, D, bind } = dressing(mesopotamian('worshipper'));
  addFringe(kit, bind.torso, [[0.1, 0.9, 0.1], [0.1, 0.9, 0], [0.1, 0.9, -0.1]], { len: 0.06, color: withMat('#d6c69a', 'cloth') });
  const geo = kit.build({ ground: 1 });
  const b = boxOf(geo);
  assert.ok(Math.abs(b.max.y - 0.9) < 0.012 && Math.abs(b.min.y - 0.84) < 0.012, `a strand is 0.06 long, hanging from the point (y ${b.min.y.toFixed(3)} to ${b.max.y.toFixed(3)})`);
  assert.equal(geo.userData.triangles, 18, 'three strands of three sides');
  const drape = (fringe) => {
    const d = dressing(mesopotamian('worshipper'));
    addDrape(d.kit, d.D, d.bind, TEAM(1, 'cloth'), null, { side: -1, width: 0.34, fringe });
    return d.kit.build({ ground: 1 });
  };
  const plain = drape(null);
  const fringed = drape({ n: 14, len: 0.05 });
  assert.equal(fringed.userData.triangles, plain.userData.triangles + 14 * 6, 'a strand for each of its fourteen points');
  assert.ok(boxOf(fringed).min.y < boxOf(plain).min.y - 0.02, 'they hang below the strip');
  void D;
});

test('a coat of scale hangs from the shoulders to below the hip in rows, each ending in a row of rounded scales', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addScaleCoat } = await import('../../src/render/models/rich-clothing.js');
  const make = (opts) => {
    const { kit, D, bind } = dressing(mesopotamian('warrior'));
    addScaleCoat(kit, D, bind, { color: withMat('#8b949e', 'metal'), ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const six = make({ rows: 6, hem: 0.1 });
  const three = make({ rows: 3, hem: 0.1 });
  const long = make({ rows: 6, hem: 0.2 });
  const b = boxOf(six.geo);
  assert.ok(b.max.y > six.D.shoulderY - 0.06 && b.max.y < six.D.shoulderY + 0.1, 'to the shoulders');
  assert.ok(b.min.y < six.D.hipY - 0.08 && b.min.y > six.D.hipY - 0.2, `below the hip (${b.min.y.toFixed(2)}, hip at ${six.D.hipY.toFixed(2)})`);
  assert.ok(six.geo.userData.triangles > three.geo.userData.triangles + 200, 'a row is a flounce of its own');
  assert.ok(boxOf(long.geo).min.y < b.min.y - 0.07, 'the hem sets how far it hangs');
  assert.ok(b.max.z - b.min.z > six.D.waistW + 0.05, 'it stands out from the body');
  // the foot of the lowest row is cut into scales: its lowest points are not all at one height
  const pos = six.geo.attributes.position.array;
  const feet = [];
  for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] < b.min.y + 0.03) feet.push(pos[i + 1]);
  assert.ok(Math.max(...feet) - Math.min(...feet) > 0.006, 'scallops');
});

test('the pointed helmet is a tall cone leaning back over a band, with a ridge up the front, plates at the ears and a flap at the nape if it has one', async () => {
  const { withMat, TEAM: team } = await import('../../src/render/models/unit-geo.js');
  const { addConeHelm } = await import('../../src/render/models/rich-headgear.js');
  const make = (opts) => {
    const { kit, D, pal, bind } = dressing(mesopotamian('warrior'));
    addConeHelm(kit, D, pal, bind, { steel: withMat('#8b949e', 'metal'), trim: withMat('#b87a3c', 'gold'), ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const plain = make({});
  const flap = make({ flap: team(0.9, 'cloth') });
  const tall = make({ tall: 1.3 });
  assert.ok(boxOf(plain.geo).max.y > plain.D.headCY + 0.2 * plain.D.hs, 'it stands well above the head');
  assert.ok(boxOf(tall.geo).max.y > boxOf(plain.geo).max.y + 0.03, 'tall scales it');
  assert.ok(flap.geo.userData.triangles > plain.geo.userData.triangles + 80, 'the flap is cloth of its own');
  assert.ok(boxOf(flap.geo).min.y < boxOf(plain.geo).min.y - 0.04, 'it hangs over the nape');
  // the point leans back: the apex is behind the front of the band
  const pos = plain.geo.attributes.position.array;
  let apex = [0, -Infinity, 0];
  for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] > apex[1]) apex = [pos[i], pos[i + 1], pos[i + 2]];
  assert.ok(apex[0] < plain.D.headX - 0.02 * plain.D.hs && Math.abs(apex[2]) < 0.02, 'the point leans back, on the middle');
  // the flap is the team's color, the helmet is not
  const fx = flap.geo.attributes.aFx.array;
  let teamed = 0;
  for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) teamed++;
  assert.ok(teamed > 40 && teamed < fx.length / 4 * 0.5, `only the flap is team painted (${teamed})`);
});

test('a horned crown is a cap with a pair of horns for each tier, each wound out from the front to the side, standing off the cap and lifting at the tip; a priest\'s cap has none', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addHornedTiara } = await import('../../src/render/models/rich-headgear.js');
  const make = (opts) => {
    const { kit, D, pal, bind } = dressing(mesopotamian('mesopotamian_marduk'));
    addHornedTiara(kit, D, pal, bind, { cap: withMat('#2a4c9a', 'cloth'), horn: withMat('#dfb54a', 'gold'), trim: withMat('#dfb54a', 'gold'), ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const three = make({ tiers: 3 });
  const one = make({ tiers: 1 });
  const plain = make({ tiers: 3, horns: false });
  const star = make({ tiers: 3, star: withMat('#dfb54a', 'gold') });
  assert.ok(three.geo.userData.triangles > one.geo.userData.triangles + 250, 'a pair of horns for each tier');
  assert.ok(three.geo.userData.triangles > plain.geo.userData.triangles + 400, 'the horns are geometry');
  assert.ok(boxOf(three.geo).max.y > boxOf(one.geo).max.y + 0.03, 'each tier makes the crown taller');
  const { hs, headCY } = three.D;
  assert.ok(boxOf(plain.geo).max.y > headCY + 0.1 * hs, 'the cap stands on the brow');
  assert.ok(boxOf(three.geo).max.z - boxOf(three.geo).min.z > (boxOf(plain.geo).max.z - boxOf(plain.geo).min.z) + 0.06 * hs, 'the horns stand out to the sides of the cap');
  assert.ok(Math.abs(boxOf(three.geo).min.z + boxOf(three.geo).max.z) < 0.01, 'a pair, even on both sides');
  assert.ok(star.geo.userData.triangles > three.geo.userData.triangles + 100, 'the star on the front is its own piece');
  assert.ok(boxOf(star.geo).max.x > boxOf(three.geo).max.x - 1e-6, 'and stands on the front');
});

test('the Assyrian beard hangs squared off from the lip in rows of curls: longer or broader as asked, in the shade it is given', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addCurledBeard, addNapeBun } = await import('../../src/render/models/rich-headgear.js');
  const make = (opts) => {
    const { kit, D, pal, bind } = dressing(mesopotamian('priest'));
    addCurledBeard(kit, D, pal, bind, opts);
    return { geo: kit.build({ ground: 1 }), D, pal };
  };
  const base = make({});
  const long = make({ len: 1.4 });
  const wide = make({ wide: 1.3 });
  const { hs, headCY, headX } = base.D;
  assert.ok(boxOf(base.geo).min.y < headCY - 0.2 * hs && boxOf(base.geo).max.y > headCY - 0.06 * hs, 'from the lip to the chest');
  assert.ok(boxOf(base.geo).max.x > headX + 0.08 * hs, 'before the face');
  assert.ok(boxOf(long.geo).min.y < boxOf(base.geo).min.y - 0.04, 'len makes it longer');
  assert.ok(boxOf(wide.geo).max.z - boxOf(wide.geo).min.z > boxOf(base.geo).max.z - boxOf(base.geo).min.z + 0.03, 'wide makes it broader');
  assert.ok(Math.abs(boxOf(base.geo).min.z + boxOf(base.geo).max.z) < 1e-6, 'even on both sides');
  // curls: the surface is not a smooth cone (its width changes down its length more than the taper alone would)
  const lum = (geo) => {
    const c = geo.attributes.color.array;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < c.length; i += 3) {
      lo = Math.min(lo, c[i]);
      hi = Math.max(hi, c[i]);
    }
    return [lo, hi];
  };
  const [lo, hi] = lum(base.geo);
  assert.ok(hi > lo * 1.4, `rows of curls shaded light and dark (${lo.toFixed(2)} to ${hi.toFixed(2)})`);
  const pale = make({ color: withMat('#e0d8c8', 'hair') });
  assert.ok(lum(pale.geo)[1] > hi * 3, 'the color it is given');
  // the hair rolled at the nape sits behind the head
  const { kit, D, pal, bind } = dressing(mesopotamian('worshipper'));
  addNapeBun(kit, D, pal, bind, {});
  const bun = kit.build({ ground: 1 });
  assert.ok(boxOf(bun).max.x < D.headX - 0.06 * D.hs, 'behind the head');
  assert.ok(boxOf(bun).min.y < D.headCY - 0.06 * D.hs, 'down the nape');
});

test('the apkallu wears the head and the skin of a fish: a blunt snout and staring eyes under a crest in the team\'s color, scales down the back to a forked tail', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addFishHood } = await import('../../src/render/models/rich-headgear.js');
  const { addFishCloak } = await import('../../src/render/models/rich-clothing.js');
  const fish = withMat('#7f9fa4', 'painted');
  const belly = withMat('#d9d3b8', 'trim');
  const teamShare = (geo) => {
    const fx = geo.attributes.aFx.array;
    let team = 0;
    for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) team++;
    return team / (fx.length / 4);
  };
  const hood = (() => {
    const { kit, D, pal, bind } = dressing(mesopotamian('mesopotamian_apkallu'));
    addFishHood(kit, D, pal, bind, { color: fish, belly, fin: TEAM(0.95, 'cloth') });
    return { geo: kit.build({ ground: 1 }), D };
  })();
  const b = boxOf(hood.geo);
  const { hs, headCY, headX } = hood.D;
  assert.ok(b.max.x > headX + 0.12 * hs, 'a snout stands out in front of the face');
  assert.ok(b.min.x < headX - 0.08 * hs, 'the crest sweeps back over the head');
  assert.ok(b.max.z - b.min.z > 0.22 * hs, 'the eyes stand out at the sides');
  assert.ok(b.max.y > headCY + 0.1 * hs, 'over the crown of the head');
  assert.ok(Math.abs(b.min.z + b.max.z) < 1e-6, 'a pair of eyes, even on both sides');
  assert.ok(teamShare(hood.geo) > 0.04 && teamShare(hood.geo) < 0.3, `only the crest is the team\'s (${teamShare(hood.geo).toFixed(2)})`);
  const cloak = (opts) => {
    const { kit, D, bind } = dressing(mesopotamian('mesopotamian_apkallu'));
    addFishCloak(kit, D, bind, { color: fish, belly, fin: TEAM(0.95, 'cloth'), ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const full = cloak({});
  const short = cloak({ len: 0.7 });
  const few = cloak({ rows: 4 });
  const c = boxOf(full.geo);
  assert.ok(c.max.y > full.D.shoulderY - 0.05 && c.max.y < full.D.shoulderY + 0.1, 'from the shoulders');
  assert.ok(c.min.y > 0 && c.min.y < full.D.hipY - 0.25, `to below the knee, clear of the ground (${c.min.y.toFixed(2)})`);
  assert.ok(c.min.x < -full.D.chestD - 0.06, 'it hangs clear of the back');
  assert.ok(boxOf(short.geo).min.y > c.min.y + 0.15, 'len sets how far it hangs');
  assert.ok(few.geo.userData.triangles < full.geo.userData.triangles - 50, 'every row is a strip of scales of its own');
  assert.ok(teamShare(full.geo) > 0.25, `the spine and the forked tail are the team\'s, to be seen from behind (${teamShare(full.geo).toFixed(2)})`);
});

test('Enki\'s streams run from each shoulder past the hip to the ground, outside the arms, all of them glowing water', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addWaterStreams } = await import('../../src/render/models/rich-regalia.js');
  const { kit, D, bind, ctx, pal } = dressing(mesopotamian('mesopotamian_enki'));
  addWaterStreams({ kit, D, bind, ctx, pal }, { color: withMat('#5cc8ea', 'gem') });
  const geo = kit.build({ ground: 1 });
  const b = boxOf(geo);
  assert.ok(b.max.y > D.shoulderY && b.min.y < 0.2, `from the shoulder to the ground (y ${b.min.y.toFixed(2)} to ${b.max.y.toFixed(2)})`);
  assert.ok(b.max.z - b.min.z > 0.65, 'one down each side, outside the arms');
  assert.ok(Math.abs(b.min.z + b.max.z) < 0.02, 'a pair');
  const fx = geo.attributes.aFx.array;
  let glow = 0;
  for (let i = 0; i < fx.length; i += 4) if (fx[i + 1] > 0.2) glow++;
  assert.ok(glow > fx.length / 4 * 0.9, `all of it glows (${glow} of ${fx.length / 4})`);
  assert.ok(geo.userData.triangles > 400, 'two broad ribbons');
  // they ride the cape bones: they sway when the god moves
  const idx = geo.attributes.skinIndex.array;
  const wgt = geo.attributes.skinWeight.array;
  const bones = new Set();
  for (let i = 0; i < idx.length; i += 4) if (wgt[i] > 0) bones.add(idx[i]);
  assert.ok(bones.size > 1, `they follow more than one bone (${[...bones]})`);
});

test('the crowns, helms, streams and cloaks show against the shared look: Marduk\'s and Nergal\'s heads rise, the soldier\'s helm points, Enki is wider, the apkallu\'s cloak hangs behind', () => {
  const shared = (id) => ({ ...mesopotamian(id), pantheon: 'norse', lookOf: 'norse' });
  const body = (u) => boxOf(buildRichTemplate(u).rich.geo);
  const rise = (id) => body(mesopotamian(id)).max.y - body(shared(id)).max.y;
  assert.ok(rise('mesopotamian_marduk') > 0.05, `Marduk's crown (${rise('mesopotamian_marduk').toFixed(2)})`);
  assert.ok(rise('mesopotamian_nergal') > 0.04, `Nergal's helm and horns (${rise('mesopotamian_nergal').toFixed(2)})`);
  assert.ok(rise('warrior') > 0.05, `the soldier's pointed helmet (${rise('warrior').toFixed(2)})`);
  const width = (u) => { const b = body(u); return b.max.z - b.min.z; };
  assert.ok(width(mesopotamian('mesopotamian_enki')) > width(shared('mesopotamian_enki')) + 0.15, 'the streams run outside his arms');
  const back = (id) => body(shared(id)).min.x - body(mesopotamian(id)).min.x;
  assert.ok(back('mesopotamian_apkallu') > 0.06, `the fish skin hangs behind (${back('mesopotamian_apkallu').toFixed(2)})`);
  assert.ok(back('warrior') > 0.08, `a soldier's cloak (${back('warrior').toFixed(2)})`);
  // the horns are the gods': the priest wears a plain cap, lower than the shared look's headgear, over the broad fleece skirt
  assert.ok(rise('priest') < -0.05, `the priest's plain cap (${rise('priest').toFixed(2)})`);
  assert.ok(width(mesopotamian('priest')) > width(shared('priest')) + 0.05, 'the fleece skirt and the shawl are broad');
});

test('Mesopotamian mortals, gods and helpers carry the team\'s color in their shawls, cloaks, helmet flaps and shields; the gold and the iron keep their own', () => {
  for (const [id, share] of [['worshipper', 0.02], ['warrior', 0.09], ['archer', 0.025], ['priest', 0.02], ['mesopotamian_marduk', 0.012], ['mesopotamian_ishtar', 0.014], ['mesopotamian_enki', 0.012], ['mesopotamian_nergal', 0.022], ['mesopotamian_apkallu', 0.04], ['mesopotamian_slinger', 0.04]]) {
    const fx = buildRichTemplate(mesopotamian(id)).rich.geo.attributes.aFx.array;
    let team = 0;
    let metal = 0;
    for (let i = 0; i < fx.length; i += 4) {
      if (fx[i] > 0) team++;
      if (fx[i + 3] > 0.3) metal++;
    }
    const n = fx.length / 4;
    assert.ok(team > n * share, `${id}: team-colored vertices ${team} of ${n}`);
    if (['warrior', 'mesopotamian_marduk', 'mesopotamian_ishtar', 'mesopotamian_nergal'].includes(id)) assert.ok(metal > n * 0.14, `${id}: iron and gold vertices ${metal} of ${n}`);
  }
  // a warrior's shield face is the team's color, under its band of bronze
  const shield = buildRichTemplate(mesopotamian('warrior')).rich.attach.find((a) => a.name === 'shield');
  const fx = shield.geo.attributes.aFx.array;
  let team = 0;
  for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) team++;
  assert.ok(team > fx.length / 4 * 0.25, `the shield's face is team painted (${team} of ${fx.length / 4})`);
});

test('the people of Mesopotamia are black-haired, whoever they are; the gods and the apkallu keep their own', () => {
  const meso = outfitFor('mesopotamian');
  const pal = { hair: new THREE.Color('#c9a56a'), skin: new THREE.Color('#d9a678'), primary: new THREE.Color('#b08a5a') };
  const hairOf = (id, extra = {}) => meso.palette(pal, { mortal: true, unit: { id }, worker: false, cls: 'infantry', ex: new Set(), ...extra }).hair;
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  for (const [what, hair] of [
    ['a worker', hairOf('worshipper', { worker: true, cls: 'worker' })],
    ['a soldier', hairOf('warrior', { ex: new Set(['armor']) })],
    ['an archer', hairOf('archer')],
    ['a priest', hairOf('priest', { cls: 'support' })],
    ['the Slinger', hairOf('mesopotamian_slinger')],
  ]) assert.ok(lum(hair) < 0.03, `${what} has black hair`);
  for (const id of ['mesopotamian_marduk', 'mesopotamian_ishtar', 'mesopotamian_enki', 'mesopotamian_nergal', 'mesopotamian_apkallu']) {
    assert.equal(meso.palette(pal, { mortal: false, unit: { id }, ex: new Set() }), pal, `${id}'s palette is the unit's own`);
  }
  assert.equal(pal.hair.getHexString(), 'c9a56a', 'the shared palette itself is not touched');
});

test('the Mesopotamian gods, mortals, the apkallu and the Slinger animate every state without a NaN', () => {
  for (const id of MESOPOTAMIAN) {
    const m = buildUnitModel(mesopotamian(id), PLAYER_COLORS[2], { detail: 'rich' });
    assert.ok(m.rich, `${id} should be rich`);
    runStates(m, id);
    m.dispose();
  }
});

test('the West Africans dress their own way: kente, mud cloth, the war smock hung with charms, beaded crowns and a deep-brown, black-haired people', () => {
  const base = outfitFor('norse');
  const wa = outfitFor('west_african');
  for (const layer of LAYERS) assert.equal(typeof wa[layer], 'function', `the West African ${layer} layer`);
  for (const layer of LAYERS) assert.notEqual(wa[layer], base[layer], `the West Africans dress their ${layer} their own way`);
  assert.equal(typeof wa.palette, 'function', 'the people\'s skin is a deep brown and their hair black');
  assert.equal(typeof wa.gear, 'function', 'the oshe, the whisk, the cutlass, the spider staff and the drums are styled');
  assert.equal(typeof wa.shield, 'function', 'the tall oval shield of hide is not the shared round one');
  // the last of the ten: every people has the new characters now
  for (const p of PANTHEON_LIST) assert.ok(RICH_PANTHEONS.has(p.id), `the ${p.id} players get the new characters`);
});

test('every West African humanoid, the Aziza and the Dart Hunter are dressed in the West African look; Ninki Nanka, the Sasabonsam, the Bultungin, Onini and the ram stay low-poly', () => {
  for (const id of WEST_AFRICAN) assert.ok(richSupported(westAfrican(id)), `${id} is supported`);
  for (const id of ['west_african_ninki_nanka', 'west_african_sasabonsam', 'west_african_bultungin', 'west_african_onini', 'battering_ram']) {
    assert.ok(!richSupported(westAfrican(id)), `${id} stays low-poly`);
  }
  // a West African warrior is not a Mesopotamian one
  assert.notEqual(buildRichTemplate(westAfrican('warrior')).triangles, buildRichTemplate(mesopotamian('warrior')).triangles);
  assert.notEqual(buildRichTemplate(westAfrican('priest')).triangles, buildRichTemplate(mesopotamian('priest')).triangles);
});

test('the West Africans carry what they are known by: a spear and the oval shield, a bow, the talking drum and its stick, the oshe, the whisk, a cutlass, staffs', () => {
  const names = (id) => buildRichTemplate(westAfrican(id)).rich.attach.filter((x) => !x.tool).map((x) => x.name).sort();
  assert.deepEqual(names('warrior'), ['shield', 'weaponR'], 'a spear and a shield');
  assert.deepEqual(names('archer'), ['weaponL'], 'a bow');
  assert.deepEqual(names('priest'), ['weaponL', 'weaponR'], 'the talking drum in one hand and its stick in the other');
  assert.deepEqual(names('west_african_dart_hunter'), ['weaponL'], 'a bow');
  assert.deepEqual(names('west_african_shango'), ['weaponR'], 'the oshe');
  assert.deepEqual(names('west_african_oya'), ['weaponR'], 'the whisk');
  assert.deepEqual(names('west_african_ogun'), ['weaponR'], 'the cutlass');
  assert.deepEqual(names('west_african_anansi'), ['extraArms', 'weaponR'], 'a staff, and four more arms with the calabash and a drum');
  assert.deepEqual(names('west_african_aziza'), ['weaponR'], 'a staff');
  assert.deepEqual(names('worshipper'), [], 'the worshippers\' tools are not held items');
});

test('the West Africans hold their things their own way: the oshe, a whisk of horsehair, a cutlass of dark iron, a gold spider on a staff, the talking drum and its hooked stick, a tall oval shield', () => {
  // the same unit under another people's outfit holds the shared item
  const shared = (id) => ({ ...westAfrican(id), pantheon: 'norse', lookOf: 'norse' });
  const lum = (u, name) => {
    const c = buildRichTemplate(u).rich.attach.find((a) => a.name === name).geo.attributes.color.array;
    let sum = 0;
    for (let i = 0; i < c.length; i += 3) sum += 0.2126 * c[i] + 0.7152 * c[i + 1] + 0.0722 * c[i + 2];
    return sum / (c.length / 3);
  };
  // the oshe and the whisk are built by the rich gear for the West Africans only (the double axe and the whip are not among its weapons)
  assert.ok(!RICH_WEAPONS.has('double_axe') && !RICH_WEAPONS.has('whip'));
  const oshe = pieceSize(westAfrican('west_african_shango'), 'weaponR');
  const plainAxe = pieceSize(shared('west_african_shango'), 'weaponR');
  assert.ok(oshe.x > plainAxe.x + 0.3, `a staff with the double blade at its head (${oshe.x.toFixed(2)} against ${plainAxe.x.toFixed(2)})`);
  assert.ok(pieceTris(westAfrican('west_african_shango'), 'weaponR') > pieceTris(shared('west_african_shango'), 'weaponR') + 500, 'the bands of beads, the knob and the blades are geometry');
  // Oya's whisk: a lock of hair from the knob falling back over the hand, as wide as a hand
  const whisk = pieceSize(westAfrican('west_african_oya'), 'weaponR');
  assert.ok(whisk.z > 0.12, `its strands fan apart (${whisk.z.toFixed(2)})`);
  assert.ok(boxOf(buildRichTemplate(westAfrican('west_african_oya')).rich.attach.find((a) => a.name === 'weaponR').geo).min.x < -0.1, 'and fall back past the grip');
  assert.ok(pieceTris(westAfrican('west_african_oya'), 'weaponR') > pieceTris(shared('west_african_oya'), 'weaponR') + 500, 'a beaded handle, a knob and the strands');
  // Ogun's cutlass is dark iron
  assert.ok(lum(westAfrican('west_african_ogun'), 'weaponR') < lum(shared('west_african_ogun'), 'weaponR') * 0.5, 'dark iron');
  // Anansi's staff carries a spider of gold, its legs spread wider than the plain staff's head
  const spider = pieceSize(westAfrican('west_african_anansi'), 'weaponR');
  assert.ok(spider.z > pieceSize(shared('west_african_anansi'), 'weaponR').z + 0.1, `the spider's legs (${spider.z.toFixed(2)})`);
  // the priest: the talking drum lies across his left hand, its hooked stick is a slim rod in his right
  const drum = pieceSize(westAfrican('priest'), 'weaponL');
  const stick = pieceSize(westAfrican('priest'), 'weaponR');
  assert.ok(drum.z > 0.3, `a long drum across the grip (${drum.z.toFixed(2)})`);
  assert.ok(stick.x > 0.25 && stick.z < 0.04, `a slim stick (${stick.x.toFixed(2)} by ${stick.z.toFixed(2)})`);
  assert.ok(stick.y > 0.08, 'bent round at its end');
  // the shield: a tall oval of hide; the shared one is round
  const shield = pieceSize(westAfrican('warrior'), 'shield');
  const plain = pieceSize(shared('warrior'), 'shield');
  assert.ok(shield.y > shield.x * 1.35, `taller than it is wide (${shield.y.toFixed(2)} by ${shield.x.toFixed(2)})`);
  assert.ok(plain.x > plain.y * 0.95, 'the shared one is as wide as it is tall');
});

test('the West African gear styles: what the outfit asks the gear builder for, hand by hand', () => {
  const wa = outfitFor('west_african');
  const at = (id, item, side = 1) => wa.gear({ unit: { id }, pal: { eyeGlow: TEAM(1, 'gem') } }, { id: item }, side);
  assert.equal(at('west_african_shango', 'double_axe').build, true, 'the oshe is built by the rich gear');
  assert.equal(at('west_african_shango', 'double_axe').oshe, true);
  assert.equal(at('west_african_oya', 'whip').build, true, 'and the whisk');
  assert.equal(at('west_african_oya', 'whip').whisk, true);
  assert.equal(at('west_african_ogun', 'sword').machete, true, 'Ogun\'s cutlass');
  assert.equal(at('west_african_anansi', 'staff').staff, 'spider', 'a spider on Anansi\'s staff');
  assert.ok(at('west_african_aziza', 'staff').orb, 'a green light on the Aziza\'s');
  assert.equal(at('priest', 'drum', -1).drum, 'talking', 'the talking drum in the left hand');
  assert.equal(at('priest', 'drum', 1).drum, 'beater', 'its stick in the right');
  assert.ok(at('warrior', 'spear').shaftColor, 'the spears have a dark shaft');
  assert.equal(at('west_african_shango', 'mace'), null, 'the rest are as shared');
});

test('kente is woven in narrow strips, each its own color and banded across; mud cloth is a dark ground laddered and dotted in pale', async () => {
  const { kente, kenteAt, mudcloth } = await import('../../src/render/models/rich-paint.js');
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const cols = ['#e2a72a', '#1f6e4a', '#b3261e', '#211b16'].map((h) => withMat(h, 'cloth'));
  // block j of strip i: an even strip is banded in the colors that follow its own, an odd one plain with a band every third block
  assert.deepEqual([0, 1, 2, 3].map((j) => cols.indexOf(kenteAt(cols, 0, j))), [0, 1, 2, 3]);
  assert.deepEqual([0, 1, 2, 3].map((j) => cols.indexOf(kenteAt(cols, 1, j))), [3, 1, 1, 3]);
  assert.deepEqual([0, 1, 2, 3].map((i) => cols.indexOf(kenteAt(cols, i, 0))), [0, 3, 2, 1], 'the strips side by side differ');
  const hexAt = (paint, y, z, ground = new THREE.Color(1, 1, 1)) => {
    const o = ground.clone();
    paint(o, 0, y, z, 0, 0);
    return o.team ? `team ${o.team}` : o.getHexString();
  };
  // laid flat: the strips run along z, the blocks up y
  const k = kente({ colors: cols, strip: 0.1, block: 0.1, flat: true });
  assert.deepEqual([0.05, 0.15, 0.25].map((y) => hexAt(k, y, 0.05)), ['e2a72a', '1f6e4a', 'b3261e'], 'banded up the first strip');
  assert.deepEqual([0.05, 0.15, 0.25].map((y) => hexAt(k, y, 0.15)), ['211b16', '1f6e4a', '1f6e4a'], 'the next strip plain, a band on its first block');
  // a team color is woven in as the team's
  const teamed = kente({ colors: [TEAM(0.9, 'cloth'), cols[0]], strip: 0.1, block: 0.1, flat: true });
  assert.equal(hexAt(teamed, 0.05, 0.05), 'team 0.9');
  // mud cloth: the ladders in the even strips, a dash in every other cell of the odd strips between
  const ink = withMat('#e2d2a6', 'cloth');
  const ground = new THREE.Color('#3e2a1c');
  const m = mudcloth({ ink, cell: 0.1, flat: true });
  const mud = (y, z) => hexAt(m, y, z, ground);
  assert.equal(mud(0.01, 0.05), 'e2d2a6', 'a rung of the ladder');
  assert.equal(mud(0.05, 0.05), '3e2a1c', 'the ground between the rungs');
  assert.equal(mud(0.11, 0.05), 'e2d2a6', 'the next rung a cell up');
  assert.equal(mud(0.15, 0.15), 'e2d2a6', 'a dash in an odd row of the next strip');
  assert.equal(mud(0.05, 0.15), '3e2a1c', 'none in an even row');
  assert.equal(mud(0.15, 0.11), '3e2a1c', 'the dash stands clear of the strip\'s edge');
});

test('a skirt of raffia hangs in rows of strands from the waist to the knee over a short skirt, standing out about the hips', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addRaffia } = await import('../../src/render/models/rich-clothing.js');
  const make = (opts) => {
    const { kit, D, bind } = dressing(westAfrican('west_african_ogun'));
    addRaffia(kit, D, bind, { color: withMat('#c2bc6a', 'cloth'), n: 24, ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const three = make({ rows: 3 });
  const one = make({ rows: 1 });
  const short = make({ rows: 3, len: 0.6 });
  const band = make({ rows: 3, band: withMat('#3a2618', 'leather') });
  assert.equal(three.geo.userData.triangles - one.geo.userData.triangles, 2 * 24 * 6, 'every row is 24 strands of three sides');
  const b = boxOf(three.geo);
  const knee = three.D.hipY - three.D.thigh;
  assert.ok(Math.abs(b.min.y - knee) < 0.05, `the strands end ragged at the knee (${b.min.y.toFixed(2)}, the knee at ${knee.toFixed(2)})`);
  assert.ok(boxOf(short.geo).min.y > b.min.y + 0.08, 'len sets how far they hang');
  assert.ok(b.max.z - b.min.z > three.D.waistW * 1.6, 'they stand out about the hips');
  assert.ok(boxOf(band.geo).max.y > b.max.y + 0.015, 'the band sits over their tops');
});

test('bangles stack up each forearm from the wrist, as many as asked, in turn in the colors they are given', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addBangles } = await import('../../src/render/models/rich-clothing.js');
  const make = (opts) => {
    const { kit, D, bind } = dressing(westAfrican('west_african_oya'));
    addBangles(kit, D, bind, { color: withMat('#c0703c', 'gold'), ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const nine = make({ n: 9, gap: 0.0105 });
  const three = make({ n: 3 });
  assert.equal(nine.geo.userData.triangles, 3 * three.geo.userData.triangles, 'a ring each, on both arms');
  const { D } = nine;
  const wrist = D.shoulderY - 0.02 - D.upper - D.fore;
  const b = boxOf(nine.geo);
  assert.ok(b.min.y > wrist && b.min.y < wrist + 0.03, 'the first at the wrist');
  assert.ok(b.max.y > boxOf(three.geo).max.y + 0.05, 'the rest up the forearm');
  assert.ok(Math.abs(b.min.z + b.max.z) < 1e-6 && b.max.z > D.shoulderZ, 'on both arms');
  const two = make({ n: 6, color: [withMat('#c4202a', 'lacquer'), withMat('#f2eee2', 'lacquer')], mat: 'lacquer' });
  const c = two.geo.attributes.color.array;
  const seen = new Set();
  for (let i = 0; i < c.length; i += 3) seen.add(`${c[i].toFixed(2)} ${c[i + 1].toFixed(2)} ${c[i + 2].toFixed(2)}`);
  assert.equal(seen.size, 2, 'red and white in turn');
});

test('the charms of a war smock: a strap across the chest from one shoulder to the other hip, leather packets along it and cowries between them', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addAmulets } = await import('../../src/render/models/rich-clothing.js');
  const make = (opts) => {
    const { kit, D, bind } = dressing(westAfrican('warrior'));
    addAmulets(kit, D, bind, { strap: withMat('#3a2618', 'leather'), packets: [withMat('#8e2e1c', 'leather')], n: 5, ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const five = make({});
  const left = make({ side: -1 });
  const three = make({ n: 3 });
  const shells = make({ cowrie: withMat('#f0e8d2', 'bone') });
  const b = boxOf(five.geo);
  assert.ok(b.max.y > five.D.shoulderY - 0.03 && b.min.y < five.D.hipY + 0.1, 'from the shoulder down to the hip');
  assert.ok(b.min.x > 0, 'over the front of the body');
  // the strap runs across: its top over one shoulder, its foot at the other hip
  const pos = five.geo.attributes.position.array;
  let hi = [0, -Infinity, 0];
  let lo = [0, Infinity, 0];
  for (let i = 0; i < pos.length; i += 3) {
    if (pos[i + 1] > hi[1]) hi = [pos[i], pos[i + 1], pos[i + 2]];
    if (pos[i + 1] < lo[1]) lo = [pos[i], pos[i + 1], pos[i + 2]];
  }
  assert.ok(hi[2] < -0.1 && lo[2] > 0.08, `across the body (the top at z ${hi[2].toFixed(2)}, the foot at ${lo[2].toFixed(2)})`);
  const bl = boxOf(left.geo);
  assert.ok(Math.abs(bl.min.z + b.max.z) < 1e-6 && Math.abs(bl.max.z + b.min.z) < 1e-6, 'side -1 wears it the other way');
  assert.ok(five.geo.userData.triangles > three.geo.userData.triangles + 40, 'a packet each');
  assert.ok(shells.geo.userData.triangles > five.geo.userData.triangles + 100, 'a cowrie between each two');
});

test('a head tie is wound over the crown in rolls, a fan of folds standing up on the side asked, the ends hanging behind if asked', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addHeadWrap } = await import('../../src/render/models/rich-headgear.js');
  const make = (opts) => {
    const { kit, D, pal, bind } = dressing(westAfrican('worshipper'));
    addHeadWrap(kit, D, pal, bind, { color: withMat('#b3261e', 'cloth'), ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const wrap = make({});
  const plain = make({ fan: false });
  const tall = make({ tall: 1.3 });
  const tails = make({ fan: false, tails: 0.3 });
  const left = make({ side: -1 });
  const { hs, headCY } = wrap.D;
  assert.ok(boxOf(plain.geo).min.y > headCY - 0.02 * hs && boxOf(plain.geo).max.y > headCY + 0.15 * hs, 'from the brow over the crown');
  assert.ok(boxOf(wrap.geo).max.y > boxOf(plain.geo).max.y + 0.06, 'the fan stands up over it');
  assert.ok(boxOf(tall.geo).max.y > boxOf(wrap.geo).max.y + 0.03, 'tall raises it');
  assert.ok(boxOf(tails.geo).min.y < headCY - 0.25 * hs && boxOf(tails.geo).min.x < boxOf(plain.geo).min.x, 'the tails hang down the back');
  // the fan: the points above the rolls lean to its side
  const sideOf = (geo) => {
    const p = geo.attributes.position.array;
    let s = 0;
    let n = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1] > headCY + 0.17 * hs) {
        s += p[i + 2];
        n++;
      }
    }
    return s / n;
  };
  assert.ok(sideOf(wrap.geo) > 0.05 && sideOf(left.geo) < -0.05, `on the right, or the left (${sideOf(wrap.geo).toFixed(2)}, ${sideOf(left.geo).toFixed(2)})`);
});

test('the beaded crown of the Yoruba kings: a cone of beadwork in two colors over a band, a knob at its point, a veil of strands over the face', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addBeadedCrown } = await import('../../src/render/models/rich-headgear.js');
  const red = withMat('#c4202a', 'lacquer');
  const white = withMat('#f2eee2', 'lacquer');
  const gold = withMat('#dcae3a', 'gold');
  const make = (opts) => {
    const { kit, D, pal, bind } = dressing(westAfrican('west_african_shango'));
    addBeadedCrown(kit, D, pal, bind, { beads: [red, white], band: gold, ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const crown = make({ ball: gold });
  const bare = make({ veil: 0 });
  const tall = make({ veil: 0, tall: 1.3 });
  const { hs, headCY, headX } = crown.D;
  assert.ok(boxOf(bare.geo).max.y > headCY + 0.24 * hs, 'a tall cone over the head');
  assert.ok(boxOf(tall.geo).max.y > boxOf(bare.geo).max.y + 0.04, 'tall scales it');
  assert.ok(crown.geo.userData.triangles > bare.geo.userData.triangles + 200, 'the strands of the veil and the knob are geometry');
  // the veil: strands before the face, from the band to the lip
  const before = (geo) => {
    const pos = geo.attributes.position.array;
    let n = 0;
    for (let i = 0; i < pos.length; i += 3) if (pos[i] > headX + 0.08 * hs && pos[i + 1] < headCY + 0.03 * hs) n++;
    return n;
  };
  assert.equal(before(bare.geo), 0, 'nothing before the face without it');
  assert.ok(before(crown.geo) > 40, `the veil hangs before the face (${before(crown.geo)})`);
  assert.ok(boxOf(crown.geo).min.y < headCY - 0.03 * hs, 'down to the lip');
  // the beadwork: squares of red and of white, as many of each
  const c = bare.geo.attributes.color.array;
  let reds = 0;
  let whites = 0;
  for (let i = 0; i < c.length; i += 3) {
    if (c[i] > 0.5 && c[i + 1] < 0.2) reds++;
    else if (c[i] > 0.8 && c[i + 1] > 0.8 && c[i + 2] > 0.7) whites++;
  }
  assert.ok(reds > 60 && whites > 60 && Math.abs(reds - whites) < (reds + whites) * 0.2, `red ${reds}, white ${whites}`);
});

test('a cap with a pair of antelope horns rising from the crown and swept back, a row of cowries on its band, or a tuft of feathers', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addHornedCap } = await import('../../src/render/models/rich-headgear.js');
  const cap = withMat('#3a2618', 'leather');
  const band = withMat('#8e2e1c', 'leather');
  const horn = withMat('#9a8262', 'bone');
  const make = (id, opts) => {
    const { kit, D, pal, bind } = dressing(westAfrican(id));
    addHornedCap(kit, D, pal, bind, { cap, ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const plain = make('warrior', {});
  const horns = make('warrior', { band, horn });
  const tall = make('warrior', { band, horn, tall: 1.3 });
  const shells = make('warrior', { band, horn, cowrie: withMat('#f0e8d2', 'bone') });
  const plume = make('archer', { plume: [withMat('#3c3c46', 'feather'), withMat('#ece6d8', 'feather'), withMat('#3c3c46', 'feather')] });
  const b = boxOf(horns.geo);
  assert.ok(b.max.y > boxOf(plain.geo).max.y + 0.04, 'the horns rise over the cap');
  assert.ok(b.min.x < boxOf(plain.geo).min.x - 0.05, 'and sweep back');
  assert.ok(Math.abs(b.min.z + b.max.z) < 1e-6, 'a pair');
  assert.ok(boxOf(tall.geo).max.y > b.max.y + 0.04 && boxOf(tall.geo).min.x < b.min.x - 0.04, 'tall makes them longer');
  const pale = (geo) => {
    const c = geo.attributes.color.array;
    let n = 0;
    for (let i = 0; i < c.length; i += 3) if (c[i] > 0.8 && c[i + 1] > 0.75) n++;
    return n;
  };
  assert.equal(pale(horns.geo), 0);
  assert.ok(pale(shells.geo) > 15, 'cowries on the band');
  assert.ok(boxOf(plume.geo).max.y > boxOf(plain.geo).max.y + 0.08, 'the feathers stand up from the crown');
});

test('a folded cap fits the crown and flops over to one side, down to the ear', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addFila } = await import('../../src/render/models/rich-headgear.js');
  const make = (opts) => {
    const { kit, D, pal, bind } = dressing(westAfrican('priest'));
    addFila(kit, D, pal, bind, { color: TEAM(0.9, 'cloth'), ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const right = make({ band: withMat('#e2a72a', 'cloth') });
  const left = make({ side: -1 });
  const flop = make({ flop: 1.3 });
  const b = boxOf(right.geo);
  const { hs, headCY } = right.D;
  assert.ok(b.max.z > -b.min.z + 0.05, `it hangs over the right (z ${b.min.z.toFixed(2)} to ${b.max.z.toFixed(2)})`);
  assert.ok(-boxOf(left.geo).min.z > boxOf(left.geo).max.z + 0.05, 'or the left');
  assert.ok(boxOf(flop.geo).max.z > b.max.z + 0.03, 'flop sets how far');
  assert.ok(b.max.y > headCY + 0.15 * hs && b.min.y < headCY, 'over the crown, down to the ear');
  const fx = right.geo.attributes.aFx.array;
  let team = 0;
  for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) team++;
  assert.ok(team > fx.length / 4 * 0.6 && team < fx.length / 4 * 0.95, `the cap is the team's color, its band not (${team} of ${fx.length / 4})`);
});

test('a crest of raffia rises from the crown of a helmet and falls about it like a fountain, wider than the head', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addRaffiaCrest } = await import('../../src/render/models/rich-headgear.js');
  const make = (opts) => {
    const { kit, D, pal, bind } = dressing(westAfrican('west_african_ogun'));
    addRaffiaCrest(kit, D, pal, bind, { color: withMat('#c2bc6a', 'cloth'), ...opts });
    return { geo: kit.build({ ground: 1 }), D };
  };
  const crest = make({});
  const few = make({ n: 8 });
  const long = make({ len: 1.4 });
  assert.equal(crest.geo.userData.triangles, 2 * few.geo.userData.triangles, 'a strand at a time');
  const b = boxOf(crest.geo);
  const { hs, headCY } = crest.D;
  assert.ok(b.min.y > headCY + 0.05 * hs && b.max.y > headCY + 0.2 * hs, 'above the head');
  assert.ok(b.max.z - b.min.z > 0.28 * hs, `it falls wider than the head (${(b.max.z - b.min.z).toFixed(2)})`);
  assert.ok(boxOf(long.geo).max.y > b.max.y + 0.02 && boxOf(long.geo).min.y < b.min.y - 0.02, 'len makes the strands longer');
});

test('the quiver hangs at the hip leaning back, its arrows standing out of its mouth with their fletching', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addQuiver } = await import('../../src/render/models/rich-regalia.js');
  const make = (opts) => {
    const d = dressing(westAfrican('archer'));
    addQuiver(d, { color: withMat('#6a4528', 'leather'), fletch: [withMat('#ece6d8', 'feather')], ...opts });
    return { geo: d.kit.build({ ground: 1 }), D: d.D };
  };
  const q = make({});
  const left = make({ side: -1 });
  const more = make({ n: 8 });
  const b = boxOf(q.geo);
  assert.ok(b.min.z > q.D.waistW * 0.5, 'at the right hip');
  assert.ok(boxOf(left.geo).max.z < -q.D.waistW * 0.5, 'or the left');
  assert.ok(b.min.y < q.D.hipY - 0.1 && b.max.y > q.D.hipY + 0.2, 'from below the hip, the arrows standing up behind');
  assert.ok(b.min.x < -0.1, 'leaning back');
  assert.ok(more.geo.userData.triangles > q.geo.userData.triangles + 100, 'a shaft and its fletching for each arrow');
});

test('Anansi\'s spider hangs on his breast on a cord of beads round the neck, eight legs spread, its eyes aglow if asked', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addSpiderPendant } = await import('../../src/render/models/rich-regalia.js');
  const make = (opts) => {
    const d = dressing(westAfrican('west_african_anansi'));
    addSpiderPendant(d, { color: withMat('#dcae3a', 'gold'), ...opts });
    return { geo: d.kit.build({ ground: 1 }), D: d.D };
  };
  const spider = make({});
  const cord = make({ cord: withMat('#e0b02a', 'lacquer') });
  const eyes = make({ eye: withMat('#ffcc33', 'gem') });
  const big = make({ size: 1.4 });
  const b = boxOf(spider.geo);
  const { D } = spider;
  assert.ok(b.min.x > 0.08, 'on the front of the chest');
  assert.ok(b.min.y > D.hipY + 0.5 * (D.shoulderY - D.hipY) && b.max.y < D.shoulderY + 0.05, 'on the breast');
  assert.ok(b.max.z - b.min.z > 0.15, 'its legs spread');
  assert.ok(boxOf(big.geo).max.z - boxOf(big.geo).min.z > b.max.z - b.min.z + 0.05, 'size scales it');
  assert.ok(boxOf(cord.geo).min.x < -0.05 && boxOf(cord.geo).max.y > D.shoulderY, 'the cord goes round the back of the neck');
  const glow = (geo) => {
    const fx = geo.attributes.aFx.array;
    let n = 0;
    for (let i = 0; i < fx.length; i += 4) if (fx[i + 1] > 0.5) n++;
    return n;
  };
  assert.equal(glow(spider.geo), 0);
  assert.ok(glow(eyes.geo) > 50, 'two glowing eyes');
});

test('a tunic, a wrap and a long skirt take a finer grid when asked, and a pattern woven into the cloth under its shading', async () => {
  const { withMat } = await import('../../src/render/models/unit-geo.js');
  const { addTunic, addWrapSkirt, addLongSkirt } = await import('../../src/render/models/rich-clothing.js');
  const { kente, mudcloth } = await import('../../src/render/models/rich-paint.js');
  const team = TEAM(0.9, 'cloth');
  const build = (fn) => {
    const { kit, D, bind } = dressing(westAfrican('worshipper'));
    fn(kit, D, bind);
    return kit.build({ ground: 1 });
  };
  const share = (geo) => {
    const fx = geo.attributes.aFx.array;
    let n = 0;
    for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) n++;
    return n / (fx.length / 4);
  };
  const weave = kente({ colors: [withMat('#e2a72a', 'cloth'), withMat('#1f6e4a', 'cloth')], r: 0.19 });
  const tunic = build((kit, D, bind) => addTunic(kit, D, team, bind, 0.1));
  const fine = build((kit, D, bind) => addTunic(kit, D, team, bind, 0.1, { sides: 24, rings: 18 }));
  const mud = build((kit, D, bind) => addTunic(kit, D, team, bind, 0.1, { weave: mudcloth({ ink: withMat('#e2d2a6', 'cloth'), cell: 0.1, r: 0.13 }) }));
  assert.ok(fine.userData.triangles > tunic.userData.triangles * 2, 'a finer grid');
  assert.equal(mud.userData.triangles, tunic.userData.triangles, 'the weave is color, not geometry');
  assert.ok(share(tunic) === 1 && share(mud) > 0.4 && share(mud) < 0.95, `the pale of the mud cloth over the team's cloth (${share(mud).toFixed(2)})`);
  const wrap = build((kit, D, bind) => addWrapSkirt(kit, D, bind, { color: team, len: 1 }));
  const wrapFine = build((kit, D, bind) => addWrapSkirt(kit, D, bind, { color: team, len: 1, sides: 48, rings: 12, weave }));
  assert.ok(wrapFine.userData.triangles > wrap.userData.triangles * 2 && share(wrap) === 1 && share(wrapFine) === 0, 'the wrap: finer, and the kente\'s own colors over it');
  const long = build((kit, D, bind) => addLongSkirt(kit, D, bind, team, {}));
  const longFine = build((kit, D, bind) => addLongSkirt(kit, D, bind, team, { sides: 48, rings: 14, weave }));
  assert.ok(longFine.userData.triangles > long.userData.triangles * 2 && share(long) === 1 && share(longFine) === 0, 'the long skirt too');
  // the weave goes on before the shading: the same block is darker toward the hem
  const c = wrapFine.attributes.color.array;
  const p = wrapFine.attributes.position.array;
  let lo = null;
  let hi = null;
  for (let i = 0; i < p.length; i += 3) {
    const l = 0.2126 * c[i] + 0.7152 * c[i + 1] + 0.0722 * c[i + 2];
    if (c[i] > c[i + 1] * 1.2 && c[i] > 0.3) {
      if (!lo || p[i + 1] < lo[0]) lo = [p[i + 1], l];
      if (!hi || p[i + 1] > hi[0]) hi = [p[i + 1], l];
    }
  }
  assert.ok(lo && hi && lo[1] < hi[1] * 0.95, 'the gold is shaded darker at the hem than at the waist');
});

test('the crowns, head ties, horns, caps and sleeves show against the shared look: the heads rise, the priest is broader', () => {
  const shared = (id) => ({ ...westAfrican(id), pantheon: 'norse', lookOf: 'norse' });
  const body = (u) => boxOf(buildRichTemplate(u).rich.geo);
  const rise = (id) => body(westAfrican(id)).max.y - body(shared(id)).max.y;
  assert.ok(rise('west_african_shango') > 0.1, `Shango's beaded crown (${rise('west_african_shango').toFixed(2)})`);
  assert.ok(rise('west_african_oya') > 0.1, `Oya's head tie (${rise('west_african_oya').toFixed(2)})`);
  assert.ok(rise('west_african_dart_hunter') > 0.08, `the hunter's horns (${rise('west_african_dart_hunter').toFixed(2)})`);
  assert.ok(rise('archer') > 0.1, `the archer's feathers (${rise('archer').toFixed(2)})`);
  assert.ok(rise('worshipper') > 0.02, `the head tie (${rise('worshipper').toFixed(2)})`);
  const width = (u) => {
    const b = body(u);
    return b.max.z - b.min.z;
  };
  assert.ok(width(westAfrican('priest')) > width(shared('priest')) + 0.08, 'the agbada\'s wide sleeves');
});

test('West African mortals, gods and helpers carry the team\'s color in their tunics, capes, linings, bands and shields; the gold and the iron keep their own', () => {
  for (const [id, share] of [['worshipper', 0.07], ['warrior', 0.1], ['archer', 0.03], ['priest', 0.1], ['west_african_shango', 0.015], ['west_african_oya', 0.014], ['west_african_ogun', 0.035], ['west_african_anansi', 0.05], ['west_african_aziza', 0.008], ['west_african_dart_hunter', 0.04]]) {
    const fx = buildRichTemplate(westAfrican(id)).rich.geo.attributes.aFx.array;
    let team = 0;
    let metal = 0;
    for (let i = 0; i < fx.length; i += 4) {
      if (fx[i] > 0) team++;
      if (fx[i + 3] > 0.3) metal++;
    }
    const n = fx.length / 4;
    assert.ok(team > n * share, `${id}: team-colored vertices ${team} of ${n}`);
    if (id === 'west_african_ogun') assert.ok(metal > n * 0.15, `${id}: iron vertices ${metal} of ${n}`);
    if (id === 'west_african_anansi') assert.ok(metal > n * 0.12, `${id}: gold vertices ${metal} of ${n}`);
  }
  // a warrior's shield face is the team's color, about a cross of hide
  const shield = buildRichTemplate(westAfrican('warrior')).rich.attach.find((a) => a.name === 'shield');
  const fx = shield.geo.attributes.aFx.array;
  let team = 0;
  for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) team++;
  assert.ok(team > fx.length / 4 * 0.3, `the shield's face is team painted (${team} of ${fx.length / 4})`);
});

test('the people of West Africa are deep brown and black-haired, whoever they are; the gods and the Aziza keep their own', () => {
  const wa = outfitFor('west_african');
  const pal = { hair: new THREE.Color('#c9a56a'), skin: new THREE.Color('#c8a07a'), primary: new THREE.Color('#b08a5a') };
  const of = (id, extra = {}) => wa.palette(pal, { mortal: true, unit: { id }, worker: false, cls: 'infantry', ex: new Set(), ...extra });
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  for (const [what, p] of [
    ['a worker', of('worshipper', { worker: true, cls: 'worker' })],
    ['a soldier', of('warrior', { ex: new Set(['armor']) })],
    ['an archer', of('archer')],
    ['a priest', of('priest', { cls: 'support' })],
    ['the Dart Hunter', of('west_african_dart_hunter')],
  ]) {
    assert.ok(lum(p.skin) < lum(pal.skin) * 0.4, `${what} is deep brown`);
    assert.ok(lum(p.hair) < 0.03, `${what} has black hair`);
  }
  for (const id of ['west_african_shango', 'west_african_oya', 'west_african_ogun', 'west_african_anansi', 'west_african_aziza']) {
    assert.equal(wa.palette(pal, { mortal: false, unit: { id }, ex: new Set() }), pal, `${id}'s palette is the unit's own`);
  }
  assert.equal(pal.skin.getHexString(), 'c8a07a', 'the shared palette itself is not touched');
  // and the body is built in it: the hands are the people's brown, not the shared skin
  const hands = (u) => {
    const geo = buildRichTemplate(u).rich.geo;
    const si = geo.attributes.skinIndex.array;
    const sw = geo.attributes.skinWeight.array;
    const c = geo.attributes.color.array;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < si.length / 4; i++) {
      if ((si[i * 4] === B.handR || si[i * 4] === B.handL) && sw[i * 4] > 0.99) {
        sum += 0.2126 * c[i * 3] + 0.7152 * c[i * 3 + 1] + 0.0722 * c[i * 3 + 2];
        n++;
      }
    }
    return sum / n;
  };
  const shared = (id) => ({ ...westAfrican(id), pantheon: 'norse', lookOf: 'norse' });
  for (const id of ['worshipper', 'warrior', 'west_african_dart_hunter']) assert.ok(hands(westAfrican(id)) < hands(shared(id)) * 0.4, `${id}'s hands`);
  assert.ok(Math.abs(hands(westAfrican('west_african_shango')) - hands(shared('west_african_shango'))) < 1e-6, 'Shango\'s are his own either way');
});

test('the West African gods, mortals, the Aziza and the Dart Hunter animate every state without a NaN', () => {
  for (const id of WEST_AFRICAN) {
    const m = buildUnitModel(westAfrican(id), PLAYER_COLORS[2], { detail: 'rich' });
    assert.ok(m.rich, `${id} should be rich`);
    runStates(m, id);
    m.dispose();
  }
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
