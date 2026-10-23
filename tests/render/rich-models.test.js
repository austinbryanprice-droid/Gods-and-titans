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
const { BONE_COUNT, B, MeshKit, ps } = await import('../../src/render/models/rich-kit.js');
const { outfitFor, LAYERS } = await import('../../src/render/models/rich-outfits.js');
const { RICH_ARMS, RICH_OFFHANDS } = await import('../../src/render/models/rich-arms.js');
const { RICH_WEAPONS } = await import('../../src/render/models/rich-gear.js');
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
const SAMPLE = ['worshipper', 'warrior', 'norse_thor', 'norse_surtr'];
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
    const budget = RICH_BUDGET[klass(u)] + (u.visual.extras.includes('multi_arms') ? MULTI_ARMS : 0);
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

test('a pantheon overrides only the layers it dresses differently; the rest is the default look', () => {
  const base = outfitFor('norse');
  const greekOutfit = outfitFor('greek');
  for (const layer of LAYERS) assert.equal(typeof greekOutfit[layer], 'function', `the Greek ${layer} layer`);
  for (const layer of ['legs', 'torso', 'arms', 'armor', 'cloaks', 'head']) assert.notEqual(greekOutfit[layer], base[layer], `the Greeks dress their ${layer} their own way`);
  assert.equal(greekOutfit.extras, base.extras, 'jewelry, spikes and chains are shared');
  assert.ok(greekOutfit.shield && !base.shield, 'the Greeks carry a hoplon, not the default round shield');
  assert.equal(outfitFor('a-people-without-an-outfit').torso, base.torso, 'a pantheon with no outfit wears the default look');
});

test('every Greek humanoid and giant is dressed in the Greek look, the beasts and shades stay low-poly', () => {
  for (const id of GREEK) assert.ok(richSupported(greek(id)), `${id} is supported`);
  for (const id of ['greek_pegasus', 'greek_centaur', 'greek_cerberus', 'greek_shade', 'battering_ram']) assert.ok(!richSupported(greek(id)), `${id} stays low-poly`);
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

test('every Egyptian humanoid is dressed in the Egyptian look, the beasts and the serpent stay low-poly', () => {
  for (const id of EGYPTIAN) assert.ok(richSupported(egyptian(id)), `${id} is supported`);
  for (const id of ['egyptian_apep', 'egyptian_scarab', 'egyptian_bennu', 'egyptian_sphinx', 'egyptian_jackal', 'battering_ram']) assert.ok(!richSupported(egyptian(id)), `${id} stays low-poly`);
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

test('every Japanese humanoid and giant is dressed in the Japanese look, the serpent, the foxes and the fox spirits stay low-poly', () => {
  for (const id of JAPANESE) assert.ok(richSupported(japanese(id)), `${id} is supported`);
  for (const id of ['japanese_yamata_no_orochi', 'japanese_kitsune', 'japanese_myobu_fox', 'japanese_tenko', 'battering_ram']) assert.ok(!richSupported(japanese(id)), `${id} stays low-poly`);
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

test('every Chinese humanoid, giant and upright monkey is dressed in the Chinese look, Nuwa, the lion, the phoenix and the dragon stay low-poly', () => {
  for (const id of CHINESE) assert.ok(richSupported(chinese(id)), `${id} is supported`);
  for (const id of ['chinese_nuwa', 'chinese_guardian_lion', 'chinese_fenghuang', 'chinese_celestial_dragon', 'battering_ram']) assert.ok(!richSupported(chinese(id)), `${id} stays low-poly`);
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
