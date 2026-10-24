// Tests for the rich centaurs (High and Ultra): the Greek Centaur and the Celtic Dullahan. A person's upper body, dressed by the
// pantheon's outfit as any person is, rises from the withers of a horse's body: one skinned mesh on the humanoid's bones and the
// horse's (rich-centaur.js), the person's pelvis hanging from the withers. The pose (rich-centaur-anim.js) runs the horse and the
// rider from the one set of pose keys of the low-poly rig. The Dullahan has no head: his own, built by rich-dullahan.js, is
// held aloft on a bone of its own that the pose keeps upright, and his whip is a spine. Low and Medium keep the low-poly centaurs.
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
const { centaurSupported } = await import('../../src/render/models/rich-centaur.js');
const { outfitFor, LAYERS } = await import('../../src/render/models/rich-outfits.js');
const { B, BONE_COUNT } = await import('../../src/render/models/rich-kit.js');
const { PROFILES } = await import('../../src/render/models/unit-bodies.js');
const { UNITS, MORTALS } = await import('../../src/data/index.js');
const { unitLook } = await import('../../src/render/models/unit-looks.js');
const { PLAYER_COLORS } = await import('../../src/config.js');
const { UnitFader, FadeMaterials } = await import('../../src/render/unit-fade.js');

// The same budget as the rich creatures.
const RICH_BUDGET = { creature: 10500 };
const STATES = ['idle', 'move', 'attack', 'cast', 'pray', 'dead'];
// the horse's bones: hips, back, withers, four of a tail, four legs of three
const HORSE_BONES = 3 + 4 + 12;

const CENTAURS = [['greek', 'greek_centaur'], ['celtic', 'celtic_dullahan']];
const look = ([pantheon, id]) => unitLook(UNITS[id], pantheon);
const centaur = look(CENTAURS[0]);
const dullahan = look(CENTAURS[1]);
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

/** A fingerprint of a template's body geometry: the sum of its vertex positions, weighted so that moving a vertex changes it. */
function fingerprint(tpl) {
  const p = tpl.rich.geo.attributes.position.array;
  let h = 0;
  for (let i = 0; i < p.length; i++) h += p[i] * (1 + (i % 97) * 0.013);
  return h;
}

test('the centaurs are built by the rich builder on the humanoid rig and a horse\'s bones', () => {
  for (const pair of CENTAURS) {
    const u = look(pair);
    assert.equal(u.visual.body, 'centaur');
    assert.ok(centaurSupported(u.visual), `${u.id} is a centaur the plan builds`);
    assert.ok(richSupported(u), `${u.id} is supported`);
    assert.ok(!creatureSupported(u), `${u.id} is not a creature body plan: it is dressed on the humanoid rig`);
  }
  // only the heads, headgear and extras the plan dresses are let through: any other centaur keeps its low-poly model
  assert.ok(!richSupported(withVisual(centaur, () => ({ head: 'gorilla' }))), 'a head the kit has no table for');
  assert.ok(!richSupported(withVisual(centaur, () => ({ heads: 2 }))), 'two heads');
  assert.ok(!richSupported(withVisual(centaur, () => ({ headgear: 'helm' }))), 'headgear sits on a person\'s head');
  assert.ok(!richSupported(withVisual(centaur, (v) => ({ extras: [...v.extras, 'wings'] }))), 'wings are not built for a horse');
  assert.ok(richSupported(withVisual(centaur, (v) => ({ extras: [...v.extras, 'cape'] }))), 'a cape is');
  assert.ok(richSupported(withVisual(dullahan, () => ({ head: 'human' }))), 'the Dullahan with a head of his own is dressed too');
  // the others are not centaurs: the battering ram has a plan of its own (rich-ram.test.js)
  assert.ok(!centaurSupported(unitLook(UNITS.battering_ram, 'greek').visual), 'the ram is no centaur');
});

test('every centaur is dressed by its own people and builds a horse where a person\'s legs would be', () => {
  for (const pantheon of ['greek', 'celtic']) {
    const outfit = outfitFor(pantheon, 'centaur');
    for (const layer of LAYERS) assert.equal(typeof outfit[layer], 'function', `the ${pantheon} ${layer} layer`);
    assert.notEqual(outfit.legs, outfitFor(pantheon).legs, `${pantheon}: the legs are a horse's`);
    assert.notEqual(outfit.torso, outfitFor(pantheon).torso, `${pantheon}: the centaur has a dress of its own`);
  }
  // only the pantheons with a centaur have one: the others keep their people's outfit as it was
  assert.equal(outfitFor('norse', 'centaur').legs, outfitFor('norse').legs);
  assert.equal(outfitFor('greek').legs, outfitFor('greek', 'humanoid').legs);
  const weapons = (u) => buildRichTemplate(u).rich.attach.filter((a) => a.name.startsWith('weapon')).length;
  assert.equal(weapons(centaur), 1, 'the Centaur\'s bow');
  assert.equal(weapons(dullahan), 2, 'the Dullahan\'s head in one hand and his whip in the other');
});

/** The checks every rich centaur's template passes: a valid skinned mesh inside the budget, about as tall as its low-poly model. */
function checkSkinned(u, tpl) {
  const g = tpl.rich.geo;
  const budget = RICH_BUDGET[u.class] ?? RICH_BUDGET.creature;
  assert.ok(tpl.triangles > 3000, `${u.id}: suspiciously few triangles`);
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

test('every centaur builds a valid skinned mesh inside the rich budget', () => {
  const seen = new Set();
  for (const pair of CENTAURS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    checkSkinned(u, tpl);
    assert.equal(tpl.kind, 'centaur', 'it keeps its kind: the pose of a rider on a horse');
    assert.equal(tpl.rich.plan, 'centaur');
    assert.equal(tpl.rich.ghost, false, 'a centaur is solid');
    seen.add(fingerprint(tpl));
  }
  assert.equal(seen.size, 2, 'no two centaurs are the same mesh');
  // a centaur builds the same mesh every time
  assert.equal(fingerprint(buildRichTemplate(centaur)), fingerprint(buildRichTemplate(centaur)));
  // and a lean build (fewer sides and rings) is a smaller, valid mesh
  for (const u of [centaur, dullahan]) {
    const lean = buildRichTemplate(u, 0.7);
    assert.ok(lean.triangles < buildRichTemplate(u).triangles * 0.9, `${u.id}: the lean build is smaller`);
    finite(lean.rich.geo.attributes.position.array, `${u.id} lean positions`);
  }
});

test('the skeleton is the humanoid\'s and the horse\'s: the person\'s pelvis hangs from the withers', () => {
  for (const pair of CENTAURS) {
    const u = look(pair);
    const { spec } = buildRichTemplate(u).rich;
    const carries = u.id === 'celtic_dullahan';
    assert.equal(spec.pos.length, BONE_COUNT + HORSE_BONES + (carries ? 1 : 0), `${u.id}: the humanoid's bones, the horse's and the palm's if he carries something upright`);
    assert.equal(spec.names.length, spec.pos.length);
    const { ix } = spec;
    assert.equal(spec.parent[ix.hips], B.root, 'the horse\'s back starts at the root');
    assert.equal(spec.parent[ix.back], ix.hips);
    assert.equal(spec.parent[ix.withers], ix.back);
    assert.equal(spec.parent[B.pelvis], ix.withers, 'the rider\'s pelvis hangs from the withers');
    assert.equal(spec.parent[ix.tail1], ix.hips);
    for (const i of [2, 3, 4]) assert.equal(spec.parent[ix[`tail${i}`]], ix[`tail${i - 1}`], 'a chain of four');
    for (const key of ['F1', 'F-1']) assert.equal(spec.parent[ix[`${key}u`]], ix.withers, 'a foreleg hangs from the withers');
    for (const key of ['B1', 'B-1']) assert.equal(spec.parent[ix[`${key}u`]], ix.hips, 'a hind leg from the hips');
    for (const key of ['F1', 'F-1', 'B1', 'B-1']) {
      assert.equal(spec.parent[ix[`${key}l`]], ix[`${key}u`]);
      assert.equal(spec.parent[ix[`${key}p`]], ix[`${key}l`]);
    }
    // the horse lies along x: hips behind the withers, the rider over the front of the barrel, the tail behind it all
    const at = (name) => spec.pos[ix[name]];
    assert.ok(at('hips')[0] < at('back')[0] && at('back')[0] < at('withers')[0], 'the barrel runs front to back');
    assert.ok(at('tail4')[0] < at('hips')[0] - 0.15, 'the tail trails behind the hips');
    assert.ok(spec.pos[B.pelvis][0] > at('back')[0] - 0.05, 'the rider stands over the front half of the barrel');
    assert.ok(spec.pos[B.pelvis][1] > at('withers')[1] - 0.2, 'on its back');
    for (const key of ['F1', 'B1']) assert.ok(at(`${key}p`)[1] < 0.25, 'the pasterns are near the ground');
    // the front legs' root names a side: the rider's right and left are the horse's right and left
    assert.ok(at('F1u')[2] * at('F-1u')[2] < 0 && at('B1u')[2] * at('B-1u')[2] < 0, 'a leg a side');
    assert.ok(spec.fit, 'the loft binds fit the rest pose');
  }
  // a person has none of it: the humanoid builds are not touched
  const warrior = buildRichTemplate(unitLook(MORTALS.warrior, 'greek'));
  assert.equal(warrior.rich.spec.pos.length, BONE_COUNT);
  assert.equal(warrior.rich.spec.ix, undefined);
});

test('the horse stands on the ground with the rider on its back, a tail behind and nothing out in front of the rider', () => {
  for (const pair of CENTAURS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    const g = tpl.rich.geo;
    const box = g.boundingBox;
    assert.ok(box.min.y > -0.02, `${u.id}: nothing sinks into the ground (${box.min.y.toFixed(3)})`);
    assert.ok(box.min.y < 0.02, `${u.id}: the hooves rest on it (${box.min.y.toFixed(3)})`);
    assert.ok(box.max.x - box.min.x > 1.1, `${u.id}: a horse's length (${(box.max.x - box.min.x).toFixed(2)})`);
    assert.ok(box.min.x < -0.7, `${u.id}: the tail trails behind (${box.min.x.toFixed(3)})`);
    assert.ok(box.max.x < 0.5, `${u.id}: nothing out in front of the rider (${box.max.x.toFixed(3)})`);
    assert.ok(box.max.z < 0.4 && box.min.z > -0.4, `${u.id}: not wider than a horse`);
    assert.ok(box.max.y > 1.15, `${u.id}: the rider stands tall above the horse's back (${box.max.y.toFixed(3)})`);
    // the rider is drawn larger than the low-poly person: the horse under it is a big one (rich-body.js richDims)
    const { dims } = tpl.rich;
    assert.ok(Math.abs(dims.headR / PROFILES.centaur.headR - 1.12) < 1e-9, 'a person a touch larger than a humanoid');
    assert.ok(dims.hipY > PROFILES.centaur.hipY * 1.12 + 0.05, 'raised to stand on the horse\'s back');
  }
  // the low-poly centaur's person has the humanoid's proportions, as it always had
  for (const k of Object.keys(PROFILES.humanoid)) assert.equal(PROFILES.centaur[k], PROFILES.humanoid[k], `profile ${k}`);
});

test('the barrel and legs follow the horse\'s bones and the rider follows the person\'s: nothing of one rides the other', () => {
  for (const pair of CENTAURS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    const g = tpl.rich.geo;
    const p = g.attributes.position.array;
    const idx = g.attributes.skinIndex.array;
    const w = g.attributes.skinWeight.array;
    const pelvis = tpl.rich.spec.pos[B.pelvis];
    let low = 0;
    let lowHorse = 0;
    let high = 0;
    let highPerson = 0;
    for (let i = 0; i < g.attributes.position.count; i++) {
      let horse = 0;
      for (let k = 0; k < 4; k++) if (idx[i * 4 + k] >= BONE_COUNT) horse += w[i * 4 + k];
      const y = p[i * 3 + 1];
      const x = p[i * 3];
      if (y < pelvis[1] - 0.25 && x < pelvis[0] - 0.1) {
        low++;
        lowHorse += horse;
      } else if (y > pelvis[1] + 0.35) {
        high++;
        highPerson += 1 - horse;
      }
    }
    assert.ok(low > 250 && high > 400, `${u.id}: both halves have vertices (${low}, ${high})`);
    assert.ok(lowHorse / low > 0.97, `${u.id}: the horse's body is skinned to the horse's bones (${(lowHorse / low).toFixed(3)})`);
    assert.ok(highPerson / high > 0.99, `${u.id}: the person above the waist to the person's (${(highPerson / high).toFixed(3)})`);
  }
});

test('the Centaur is bare to the waist with a quiver, a baldric and a bow; the Dullahan is a headless rider in black iron', () => {
  const tris = (u) => buildRichTemplate(u).triangles;
  // the Greek Centaur: the bow in the left hand, rigid on the hand
  const bow = buildRichTemplate(centaur).rich.attach.find((a) => a.name === 'weaponL');
  assert.ok(bow, 'a bow in the left hand');
  assert.equal(bow.bone, B.handL);
  // the Dullahan: no head on his neck, so his body is shorter than the same rider with one
  const headed = withVisual(dullahan, () => ({ head: 'human' }));
  const bare = buildRichTemplate(dullahan);
  const full = buildRichTemplate(headed);
  assert.equal(dullahan.visual.head, 'none');
  assert.ok(full.rich.geo.boundingBox.max.y > bare.rich.geo.boundingBox.max.y + 0.1, 'the neck ends in a stump where the head would be');
  assert.ok(tris(headed) > tris(dullahan) + 400, 'no face, no hair, no eyes');
  // the head and the whip are pieces of their own, in the hands
  const head = bare.rich.attach.find((a) => a.name === 'weaponL');
  const whip = bare.rich.attach.find((a) => a.name === 'weaponR');
  assert.ok(head && whip, 'his head in the left hand, his whip in the right');
  assert.equal(bare.rich.ix.carry, head.bone, 'the head rides the palm bone');
  assert.equal(whip.bone, B.handR);
  assert.notEqual(head.bone, B.handL, 'not the hand itself: the palm\'s bone is turned upright by the pose');
  assert.ok(head.geo.attributes.position.count > 600, 'a head with a face, eyes and long hair');
  assert.ok(whip.geo.attributes.position.count > 400, 'a whip of vertebrae');
  const hbox = new THREE.Box3().setFromBufferAttribute(head.geo.attributes.position);
  assert.ok(hbox.max.y - hbox.min.y > 0.3, 'a head and its hair hanging below');
  // the iron is his: a darker, less saturated body than the Centaur's
  const lum = (t, pick) => {
    const c = t.rich.geo.attributes.color.array;
    const p = t.rich.geo.attributes.position.array;
    let s = 0;
    let n = 0;
    for (let i = 0; i < t.rich.geo.attributes.position.count; i++) {
      if (!pick(p[i * 3], p[i * 3 + 1])) continue;
      s += (c[i * 3] + c[i * 3 + 1] + c[i * 3 + 2]) / 3;
      n++;
    }
    return s / n;
  };
  const rider = (x, y) => y > 0.95 && x > 0.1;
  assert.ok(lum(bare, rider) < lum(buildRichTemplate(centaur), rider) * 0.6, 'black iron against a bare chest');
});

test('the team\'s color is on the saddle cloths, the Centaur\'s baldric and the Dullahan\'s cape, so the owner can be told from above', () => {
  for (const pair of CENTAURS) {
    const fx = buildRichTemplate(look(pair)).rich.geo.attributes.aFx.array;
    let team = 0;
    for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) team++;
    assert.ok(team > 100, `${pair[1]}: the team's color is worn (${team} vertices)`);
  }
});

test('Low and Medium keep the low-poly centaurs; High and Ultra swap in the rich ones', () => {
  const expected = { greek_centaur: [1158, 1.6033], celtic_dullahan: [1188, 2.1101] };
  for (const pair of CENTAURS) {
    const u = look(pair);
    const info = getUnitModelInfo(u, 'base');
    assert.equal(info.triangles, expected[u.id][0], `${u.id}: the low-poly centaur is what it was`);
    assert.ok(Math.abs(info.height - expected[u.id][1]) < 1e-3);
    assert.equal(info.kind, 'centaur');
    assert.equal(info.rich, false);
    const base = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'base' });
    assert.equal(base.rich, null, `${u.id} stays low-poly on Low and Medium`);
    const rich = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
    assert.ok(rich.rich, `${u.id} is rich on High and Ultra`);
    assert.equal(rich.kind, 'centaur');
    const body = rich.root.getObjectByName('body');
    assert.ok(body?.isSkinnedMesh, `${u.id}: one skinned body`);
    assert.ok(!body.material.transparent, 'it is drawn solid');
    assert.equal(rich.rich.plan, 'centaur', 'the instance runs the centaur\'s pose');
    for (const m of [base, rich]) m.dispose();
  }
});

test('a centaur fades in and out at the edge of the player\'s vision like any other unit', () => {
  for (const u of [centaur, dullahan]) {
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

test('every centaur animates every state without a NaN, through the same pose keys', () => {
  for (const pair of CENTAURS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[2], { detail: 'rich' });
    runStates(m, u.id);
    m.dispose();
  }
});

test('at the gallop the horse\'s four legs swing and its tail waves, while the rider stays upright above it and the hooves meet the ground', () => {
  const v = new THREE.Vector3();
  const up = new THREE.Vector3();
  for (const pair of CENTAURS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[1], { detail: 'rich' });
    const { bones, ix, mesh } = m.rich;
    const n = mesh.geometry.attributes.position.count;
    const legs = ['F1', 'F-1', 'B1', 'B-1'];
    const lo = Object.fromEntries(legs.map((k) => [k, Infinity]));
    const hi = Object.fromEntries(legs.map((k) => [k, -Infinity]));
    let tailLo = Infinity;
    let tailHi = -Infinity;
    let tilt = 0;
    let minY = 9;
    for (let i = 0; i < 120; i++) {
      m.animate('move', i / 30, 1 / 30, { moving: true });
      for (const k of legs) {
        const r = bones[ix[`${k}u`]].rotation.z;
        lo[k] = Math.min(lo[k], r);
        hi[k] = Math.max(hi[k], r);
      }
      tailLo = Math.min(tailLo, bones[ix.tail4].rotation.y);
      tailHi = Math.max(tailHi, bones[ix.tail4].rotation.y);
      if (i < 30) continue;
      m.root.updateMatrixWorld(true);
      mesh.skeleton.update();
      up.set(0, 1, 0).transformDirection(bones[B.chest].matrixWorld);
      tilt = Math.max(tilt, Math.acos(Math.min(1, up.y)));
      if (i % 5) continue;
      for (let k = 0; k < n; k += 11) {
        mesh.getVertexPosition(k, v);
        v.applyMatrix4(mesh.matrixWorld);
        minY = Math.min(minY, v.y);
      }
    }
    for (const k of legs) assert.ok(hi[k] - lo[k] > 0.6, `${u.id}: the ${k} leg swings (${(hi[k] - lo[k]).toFixed(2)})`);
    assert.ok(tailHi - tailLo > 0.15, `${u.id}: the tail waves (${(tailHi - tailLo).toFixed(2)})`);
    assert.ok(tilt < 0.2, `${u.id}: the rider's chest stays within 0.2 rad of upright over the horse's pitch (${tilt.toFixed(3)})`);
    assert.ok(minY > -0.06 && minY < 0.06, `${u.id}: the hooves meet the ground, not sink into it or hang over it (${minY.toFixed(3)})`);
    m.dispose();
  }
});

test('the rider turns against the horse\'s pitch: the horse\'s front tips in a blow and the person\'s pelvis hardly does', () => {
  const up = new THREE.Vector3();
  const tilt = (bone) => Math.abs(Math.atan2(up.set(0, 1, 0).transformDirection(bone.matrixWorld).x, up.y));
  for (const pair of CENTAURS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[3], { detail: 'rich' });
    const { bones, ix } = m.rich;
    let front = 0;
    let pelvis = 0;
    for (let i = 0; i < 90; i++) {
      m.animate('attack', i / 30, 1 / 30, { attackPhase: (i % 45) / 45 });
      m.root.updateMatrixWorld(true);
      front = Math.max(front, tilt(bones[ix.withers]));
      pelvis = Math.max(pelvis, tilt(bones[B.pelvis]));
    }
    assert.ok(front > 0.04, `${u.id}: the horse's front pitches in the blow (${front.toFixed(3)})`);
    assert.ok(pelvis < front * 0.25, `${u.id}: the rider's pelvis turns most of it back (${pelvis.toFixed(3)} against ${front.toFixed(3)})`);
    m.dispose();
  }
});

test('the Dullahan holds his head upright by its hair whatever his arm does, and the arm that holds it is raised', () => {
  const up = new THREE.Vector3();
  const v = new THREE.Vector3();
  const m = buildUnitModel(dullahan, PLAYER_COLORS[0], { detail: 'rich' });
  const { bones, ix } = m.rich;
  const carry = bones[ix.carry];
  assert.equal(carry.parent, bones[B.handL], 'the palm\'s bone is a child of the hand');
  for (const state of ['idle', 'move', 'attack', 'cast']) {
    let worst = 1;
    let handLow = 9;
    for (let i = 0; i < 90; i++) {
      m.animate(state, i / 30, 1 / 30, { moving: state === 'move', attackPhase: state === 'attack' ? (i % 45) / 45 : undefined });
      m.root.updateMatrixWorld(true);
      up.set(0, 1, 0).transformDirection(carry.matrixWorld);
      worst = Math.min(worst, up.y);
      handLow = Math.min(handLow, v.setFromMatrixPosition(bones[B.handL].matrixWorld).y);
    }
    assert.ok(worst > 0.95, `${state}: the head stays within about 18 degrees of upright (${worst.toFixed(3)})`);
    if (state === 'idle' || state === 'move') assert.ok(handLow > 1.2, `${state}: held aloft (${handLow.toFixed(2)})`);
  }
  // the head hangs from the hand: the palm's bone moves with the hand, and the head is turned by the palm
  m.animate('idle', 0, 0, {});
  m.root.updateMatrixWorld(true);
  const rest = v.setFromMatrixPosition(carry.matrixWorld).clone();
  for (let i = 0; i < 40; i++) m.animate('attack', i / 30, 1 / 30, { attackPhase: i / 40 });
  m.root.updateMatrixWorld(true);
  assert.ok(v.setFromMatrixPosition(carry.matrixWorld).distanceTo(rest) > 0.1, 'the head goes where the hand goes');
  m.dispose();
});

test('a centaur that dies topples like any other unit and its bones stay finite', () => {
  for (const pair of CENTAURS) {
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
