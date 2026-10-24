// Tests for the rich spirits (High and Ultra): the Greek Shade and the Celtic Banshee. They stand on the humanoid skeleton as far
// as the waist and trail a wisp below it: a chain of four tail bones hangs from the pelvis (rich-kit.js humanoidSpec, opts.tail) and
// a ragged shroud is skinned along it (rich-spirit.js), swaying about a still spirit and streaming behind a moving one
// (rich-anim.js poseTail). The body is see-through: a per vertex alpha (the kit's paint.alpha) read by the ghost material. Low and
// Medium keep the low-poly spirits.
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
const { outfitFor, LAYERS } = await import('../../src/render/models/rich-outfits.js');
const { ghostly } = await import('../../src/render/models/rich-spirit.js');
const { B, BONE_COUNT, MeshKit, ps, humanoidSpec } = await import('../../src/render/models/rich-kit.js');
const { UNITS, MORTALS } = await import('../../src/data/index.js');
const { unitLook } = await import('../../src/render/models/unit-looks.js');
const { PLAYER_COLORS } = await import('../../src/config.js');
const { UnitFader, FadeMaterials, FADE_LEVELS } = await import('../../src/render/unit-fade.js');

// The same budgets as the rich humanoids and creatures: a creature, a minion.
const RICH_BUDGET = { creature: 10500, minion: 8500 };
const STATES = ['idle', 'move', 'attack', 'cast', 'dead'];

const SPIRITS = [['greek', 'greek_shade'], ['celtic', 'celtic_banshee']];
const look = ([pantheon, id]) => unitLook(UNITS[id], pantheon);
const shade = look(SPIRITS[0]);
const banshee = look(SPIRITS[1]);
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

test('the spirits are built by the rich builder on the humanoid rig, with a wisp for legs', () => {
  for (const pair of SPIRITS) {
    const u = look(pair);
    assert.equal(u.visual.body, 'spirit');
    assert.ok(richSupported(u), `${u.id} is supported`);
    assert.ok(!creatureSupported(u), `${u.id} is not a creature body plan: it is dressed on the humanoid rig`);
  }
  // only the heads and extras the kit builds are let through: any other spirit keeps its low-poly model
  assert.ok(!richSupported(withVisual(shade, () => ({ head: 'gorilla' }))), 'a head the kit has no table for');
  assert.ok(!richSupported(withVisual(shade, (v) => ({ extras: [...v.extras, 'rider'] }))), 'a rider is not dressed');
  assert.ok(richSupported(withVisual(banshee, () => ({ headgear: 'hood' }))), 'a hood or a veil, whichever a spirit wears');
});

test('every spirit wears the one look of the spirits, whatever its people, with a face and hands of its own', () => {
  const greekOutfit = outfitFor('greek', 'spirit');
  const celticOutfit = outfitFor('celtic', 'spirit');
  for (const layer of LAYERS) {
    assert.equal(typeof greekOutfit[layer], 'function', `the ${layer} layer`);
    assert.equal(greekOutfit[layer], celticOutfit[layer], `${layer}: the dead are not dressed by their pantheon`);
  }
  for (const hook of ['hands', 'face', 'skinPaint', 'palette']) assert.equal(typeof greekOutfit[hook], 'function', `the ${hook} hook`);
  // the hooks are for the spirits only: the people's outfits are what they were
  for (const pantheon of ['greek', 'celtic', 'norse']) {
    for (const hook of ['hands', 'face']) assert.equal(outfitFor(pantheon)[hook], undefined, `${pantheon} has no ${hook} hook`);
    assert.equal(outfitFor(pantheon, 'humanoid').legs, outfitFor(pantheon).legs, 'a person is dressed by the people');
  }
});

/** The checks every rich spirit's template passes: a valid skinned mesh inside the budget, about as tall as its low-poly model. */
function checkSkinned(u, tpl) {
  const g = tpl.rich.geo;
  const budget = RICH_BUDGET[u.class] ?? RICH_BUDGET.creature;
  assert.ok(tpl.triangles > 3000, `${u.id}: suspiciously few triangles`);
  assert.ok(tpl.triangles <= budget, `${u.id}: ${tpl.triangles} triangles > ${budget}`);
  assert.equal(tpl.meshes, 1, `${u.id}: one skinned mesh and no rigid pieces`);
  assert.equal(tpl.rich.attach.length, 0, `${u.id} carries nothing`);
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
  const base = getUnitModelInfo(u, 'base').height;
  const rich = getUnitModelInfo(u, 'rich').height;
  assert.ok(rich > base * 0.6 && rich < base * 1.5, `${u.id}: rich height ${rich.toFixed(2)} vs base ${base.toFixed(2)}`);
}

test('every spirit builds a valid skinned mesh inside the rich budget', () => {
  for (const pair of SPIRITS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    checkSkinned(u, tpl);
    assert.equal(tpl.kind, 'spirit', 'it keeps its kind: the float, the lean and the raised arms of a spirit');
    assert.equal(tpl.rich.ghost, true);
    assert.equal(tpl.rig.float, 0.12, 'it drifts above the ground, as the low-poly spirit does');
  }
  // a spirit builds the same mesh every time
  assert.equal(fingerprint(buildRichTemplate(shade)), fingerprint(buildRichTemplate(shade)));
  assert.notEqual(fingerprint(buildRichTemplate(shade)), fingerprint(buildRichTemplate(banshee)), 'the Shade is not the Banshee');
});

test('the skeleton is the humanoid\'s with a chain of four bones that hang from the pelvis', () => {
  for (const pair of SPIRITS) {
    const u = look(pair);
    const { spec } = buildRichTemplate(u).rich;
    assert.equal(spec.pos.length, BONE_COUNT + 4, `${u.id}: the humanoid's bones and four more`);
    assert.deepEqual(spec.tail, { first: BONE_COUNT, count: 4, style: 'wisp' });
    assert.equal(spec.wing, false, 'a spirit has no wings');
    assert.equal(spec.parent[BONE_COUNT], B.pelvis, 'the wisp hangs from the pelvis');
    for (let i = 1; i < 4; i++) assert.equal(spec.parent[BONE_COUNT + i], BONE_COUNT + i - 1, 'each bone is the child of the one above');
    assert.equal(spec.names[BONE_COUNT], 'tail0');
    assert.equal(spec.names.length, spec.pos.length);
    const ys = spec.pos.slice(BONE_COUNT).map((p) => p[1]);
    for (let i = 0; i < 4; i++) assert.ok(ys[i] < spec.pos[B.pelvis][1] - (i ? 0.1 : 0.02), 'the chain hangs below the hip');
    for (let i = 1; i < 4; i++) assert.ok(ys[i] < ys[i - 1], 'and gets lower down it');
  }
  // the people and the winged have no tail bones; the kit's tail is opt-in
  const warrior = buildRichTemplate(unitLook(MORTALS.warrior, 'greek'));
  assert.equal(warrior.rich.spec.tail, undefined);
  assert.equal(warrior.rich.spec.wing, false);
  assert.equal(warrior.rich.spec.pos.length, BONE_COUNT);
  const d = { hipY: 0.5, hipZ: 0.085, thigh: 0.25, ankleY: 0.05, shoulderY: 0.86, shoulderZ: 0.2, upper: 0.18, fore: 0.17, neckY: 0.94, headY: 1.02, headX: 0.02, headRad: 0.12 };
  const both = humanoidSpec(d, { wing: { root: [-0.1, 0.8, 0.1], wrist: [-0.2, 0.9, 0.5] }, tail: [[-0.1, 0.4, 0], [-0.2, 0.3, 0]] });
  assert.equal(both.pos.length, BONE_COUNT + 4 + 2, 'wings come before the tail');
  assert.deepEqual(both.tail, { first: BONE_COUNT + 4, count: 2, style: 'wisp' });
  assert.equal(both.wing, true);
});

test('the body is see-through: a fourth color component, faint toward the hem, solid in the eyes', () => {
  for (const pair of SPIRITS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    const g = tpl.rich.geo;
    const col = g.attributes.color;
    assert.equal(col.itemSize, 4, `${u.id}: red, green, blue and alpha`);
    const fx = g.attributes.aFx.array;
    const pos = g.attributes.position.array;
    const { hipY, shoulderY } = tpl.rich.dims;
    let eyes = 0;
    let hem = 0;
    let hemN = 0;
    let chest = 0;
    let chestN = 0;
    let faint = 0;
    for (let i = 0; i < col.count; i++) {
      const a = col.array[i * 4 + 3];
      assert.ok(a >= 0.05 && a <= 1, `${u.id}: alpha ${a} of vertex ${i}`);
      if (fx[i * 4 + 1] >= 0.6) {
        assert.equal(a, 1, `${u.id}: what glows strongly (the eyes) is solid`);
        eyes++;
      } else if (a < 0.3) faint++;
      const y = pos[i * 3 + 1];
      if (y < hipY - 0.2) {
        hem += a;
        hemN++;
      } else if (y > hipY + 0.05 && y < shoulderY) {
        chest += a;
        chestN++;
      }
    }
    assert.ok(eyes >= 8, `${u.id}: two eyes that burn (${eyes} vertices)`);
    assert.ok(faint > 100, `${u.id}: the hem and the tips of the tongues fade out (${faint} faint vertices)`);
    assert.ok(hem / hemN < chest / chestN - 0.2, `${u.id}: fainter below the hip (${(hem / hemN).toFixed(2)}) than at the chest (${(chest / chestN).toFixed(2)})`);
    assert.ok(chest / chestN < 1, 'even the chest is a little see-through');
    // a faint light of its own, so that it still reads at dusk: no vertex of cloth is dark in the glow channel
    for (let i = 0; i < col.count; i++) assert.ok(fx[i * 4 + 1] >= 0.1, `${u.id}: vertex ${i} gives off a faint light`);
  }
  // an ordinary body carries no alpha
  assert.equal(buildRichTemplate(unitLook(MORTALS.warrior, 'greek')).rich.geo.attributes.color.itemSize, 3);
});

test('the kit writes a vertex alpha only when a paint fades a vertex; ghostly makes a built body see-through but its eyes', () => {
  const plain = new MeshKit(null, { sides: 8 });
  plain.loft([ps(0, 0, 0, 0.1), ps(0, 1, 0, 0.1)], { ref: [1, 0, 0] });
  assert.equal(plain.fade, false);
  assert.equal(plain.build({ ao: false }).attributes.color.itemSize, 3, 'three components when nothing fades');
  const kit = new MeshKit(null, { sides: 8 });
  kit.loft([ps(0, 0, 0, 0.1), ps(0, 1, 0, 0.1)], { ref: [1, 0, 0], paint: (o, x, y) => { o.alpha = y < 0.5 ? 0.25 : 1; } });
  assert.equal(kit.fade, true);
  const g = kit.build({ ao: false });
  assert.equal(g.attributes.color.itemSize, 4);
  const alphas = [];
  for (let i = 0; i < kit.count; i++) alphas.push(g.attributes.color.array[i * 4 + 3]);
  assert.ok(alphas.includes(0.25) && alphas.includes(1) && alphas.every((a) => a === 0.25 || a === 1), 'the alpha is what the paint set');
  // the glow of the eyes keeps them solid: the rest takes the body's alpha and a faint light
  const body = new MeshKit(null, { sides: 8 });
  body.loft([ps(0, 0, 0, 0.1), ps(0, 1, 0, 0.1)], { ref: [1, 0, 0], color: '#ffffff' });
  body.loft([ps(1, 0, 0, 0.1), ps(1, 1, 0, 0.1)], { ref: [1, 0, 0], color: '#ffffff', glow: 1 });
  body.loft([ps(2, 0, 0, 0.1), ps(2, 1, 0, 0.1)], { ref: [1, 0, 0], color: '#ffffff', paint: (o) => { o.alpha = 0.2; } });
  const n = body.count / 3;
  ghostly(body);
  assert.equal(body.fade, true);
  for (let i = 0; i < n; i++) {
    assert.ok(body.alpha[i] > 0.5 && body.alpha[i] < 1, 'cloth takes the body\'s alpha');
    assert.ok(body.fx[i * 4 + 1] > 0 && body.fx[i * 4 + 1] < 0.4, 'and a faint light');
    assert.equal(body.alpha[n + i], 1, 'what glows is solid');
    assert.equal(body.fx[(n + i) * 4 + 1], 1, 'and keeps its glow');
    assert.ok(body.alpha[2 * n + i] < body.alpha[i] * 0.3, 'a part that fades stays fainter than the rest');
  }
});

test('the wisp hangs below the waist and trails behind it; nothing goes below the ground a spirit floats over', () => {
  for (const pair of SPIRITS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    const box = tpl.rich.geo.boundingBox;
    const { hipY } = tpl.rich.dims;
    assert.ok(box.min.y > -0.06, `${u.id}: nothing sinks into the ground (${box.min.y.toFixed(3)})`);
    assert.ok(box.min.y < hipY * 0.2, `${u.id}: the hem comes down toward the ground (${box.min.y.toFixed(3)})`);
    assert.ok(box.min.x < -0.35, `${u.id}: the tongues stream out behind (${box.min.x.toFixed(3)})`);
    assert.ok(box.max.x < 0.4, `${u.id}: nothing out in front of it`);
  }
});

test('the Shade is a hooded wraith and the Banshee a wailing woman with a veil, a circlet and long hair', () => {
  const tris = (u) => buildRichTemplate(u).triangles;
  assert.equal(shade.visual.headgear, 'hood');
  assert.ok(tris(shade) > tris(withVisual(shade, () => ({ headgear: 'none' }))) + 100, 'the hood is cloth over the head');
  assert.equal(banshee.visual.headgear, 'veil');
  assert.ok(tris(banshee) > tris(withVisual(banshee, () => ({ headgear: 'none' }))) + 200, 'the veil and the circlet');
  assert.ok(tris(banshee) > tris(withVisual(banshee, (v) => ({ extras: v.extras.filter((e) => e !== 'long_hair') }))) + 300, 'the long hair is strands down her back');
  // what a spirit wears on its head is what the unit's visual says: the veil is not the hood
  assert.notEqual(fingerprint(buildRichTemplate(banshee)), fingerprint(buildRichTemplate(withVisual(banshee, () => ({ headgear: 'hood' })))));
});

test('the pale Banshee is brought down to where the sun and the bloom do not burn her out to white', () => {
  const tpl = buildRichTemplate(banshee);
  const col = tpl.rich.geo.attributes.color.array;
  const fx = tpl.rich.geo.attributes.aFx.array;
  let max = 0;
  for (let i = 0; i < tpl.rich.geo.attributes.position.count; i++) {
    if (fx[i * 4] > 0 || fx[i * 4 + 1] >= 0.6) continue; // the team's sash and what glows
    max = Math.max(max, col[i * 4], col[i * 4 + 1], col[i * 4 + 2]);
  }
  assert.ok(max < 0.9, `no vertex of her gown, skin or hair is nearly white (${max.toFixed(2)})`);
  assert.ok(max > 0.4, 'but she is still pale');
});

test('the sash is the team\'s color, so the owner of a spirit can be told from above', () => {
  for (const pair of SPIRITS) {
    const fx = buildRichTemplate(look(pair)).rich.geo.attributes.aFx.array;
    let team = 0;
    for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) team++;
    assert.ok(team > 40, `${pair[1]}: the sash and its knot take the team's color (${team} vertices)`);
  }
});

test('Low and Medium keep the low-poly spirits; High and Ultra swap in the rich ones, drawn with the ghost material', () => {
  for (const pair of SPIRITS) {
    const u = look(pair);
    const base = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'base' });
    assert.equal(base.rich, null, `${u.id} stays low-poly on Low and Medium`);
    let ghosts = 0;
    base.root.traverse((o) => {
      if (o.isMesh && o.material.transparent && o.material.opacity === 0.62) ghosts++;
    });
    assert.ok(ghosts >= 4, `${u.id}: the low-poly spirit is drawn as a ghost (opacity 0.62)`);
    const rich = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
    assert.ok(rich.rich, `${u.id} is rich on High and Ultra`);
    const body = rich.root.getObjectByName('body');
    assert.ok(body?.isSkinnedMesh, `${u.id}: one skinned body`);
    assert.equal(body.material.transparent, true, 'the ghost material is transparent');
    assert.equal(body.material.opacity, 1, 'its see-through look is the vertices\' alpha, not a flat opacity');
    assert.equal(body.material.depthWrite, true, 'a single body of cloth sorts by depth, not by draw order');
    assert.equal(body.geometry.attributes.color.itemSize, 4);
    assert.ok(rich.rich.spec.tail, 'the instance knows its skeleton has a tail');
    for (const m of [base, rich]) m.dispose();
  }
});

test('a spirit fades in and out at the edge of the player\'s vision like any other unit: the variant keeps its vertex alpha', () => {
  const m = buildUnitModel(shade, PLAYER_COLORS[0], { detail: 'rich' });
  const body = m.root.getObjectByName('body');
  const base = body.material;
  const fader = new UnitFader(m.root);
  const mats = new FadeMaterials();
  fader.apply(0.5, mats);
  assert.notEqual(body.material, base, 'a variant while it fades');
  assert.ok(body.material.transparent && Math.abs(body.material.opacity - 0.5) < 1e-9, 'half as opaque as the ghost material');
  assert.equal(body.material.vertexColors, base.vertexColors, 'it still reads the vertices\' alpha');
  assert.equal(body.castShadow, false, 'no shadow while it is see-through');
  fader.apply(1, mats);
  assert.equal(body.material, base, 'the ghost material when it is fully there');
  assert.equal(base.opacity, 1);
  assert.equal(FADE_LEVELS, 8);
  mats.dispose();
  m.dispose();
});

test('the low-poly spirits are what they were: the shared profile did not change their model', () => {
  const info = (u) => getUnitModelInfo(u, 'base');
  assert.equal(info(shade).triangles, 414);
  assert.equal(info(shade).meshes, 5);
  assert.equal(info(banshee).triangles, 533);
  assert.equal(info(banshee).meshes, 6);
  assert.equal(info(shade).kind, 'spirit');
  assert.equal(info(shade).rich, false);
  assert.ok(Math.abs(info(shade).height - 1.1829) < 1e-3);
});

test('every spirit animates every state without a NaN, through the same pose keys', () => {
  for (const pair of SPIRITS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[2], { detail: 'rich' });
    runStates(m, u.id);
    m.dispose();
  }
});

test('a spirit drifts above the ground and bobs; its wisp sways when it is still and streams out behind it when it moves', () => {
  for (const pair of SPIRITS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[1], { detail: 'rich' });
    const { first, count } = m.rich.spec.tail;
    const rest = m.rich.spec.pos;
    // still: it floats and bobs
    const lift = [];
    const sway = [];
    for (let i = 0; i < 60; i++) {
      m.animate('idle', i / 30, 1 / 30, {});
      lift.push(m.rich.bones[B.pelvis].position.y - rest[B.pelvis][1]);
      sway.push(m.rich.bones[first + count - 1].rotation.y);
    }
    assert.ok(Math.min(...lift) > 0.04 && Math.max(...lift) < 0.2, `${u.id}: it floats ${Math.min(...lift).toFixed(2)} to ${Math.max(...lift).toFixed(2)} above where it stands`);
    assert.ok(Math.max(...lift) - Math.min(...lift) > 0.01, `${u.id}: it bobs`);
    assert.ok(Math.max(...sway) - Math.min(...sway) > 0.05, `${u.id}: the tip of the wisp sways from side to side`);
    // the tip of the chain, behind the pelvis: further back when it is moving than when it is not
    const tipBack = (bonesOf) => {
      bonesOf.root.updateMatrixWorld(true);
      const pel = bonesOf.rich.bones[B.pelvis].getWorldPosition(new THREE.Vector3());
      const tip = bonesOf.rich.bones[first + count - 1].getWorldPosition(new THREE.Vector3());
      return pel.x - tip.x;
    };
    const idle = buildUnitModel(u, PLAYER_COLORS[1], { detail: 'rich' });
    const moving = buildUnitModel(u, PLAYER_COLORS[1], { detail: 'rich' });
    for (let i = 0; i < 90; i++) {
      idle.animate('idle', i / 30, 1 / 30, {});
      moving.animate('move', i / 30, 1 / 30, { moving: true });
    }
    assert.ok(tipBack(moving) > tipBack(idle) + 0.02, `${u.id}: the wisp streams behind a moving spirit (${tipBack(idle).toFixed(3)} still, ${tipBack(moving).toFixed(3)} moving)`);
    for (const x of [m, idle, moving]) x.dispose();
  }
});

test('a spirit that dies topples like any other unit and its bones stay finite', () => {
  for (const pair of SPIRITS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[3], { detail: 'rich' });
    for (let i = 0; i < 40; i++) m.animate('dead', i / 30, 1 / 30, {});
    assert.ok(Math.abs(m.rigGroup.rotation.x) > 1.3, `${u.id}: it falls over`);
    m.root.updateMatrixWorld(true);
    m.rich.mesh.skeleton.update();
    finite(m.rich.mesh.skeleton.boneMatrices, `${u.id} after death`);
    m.dispose();
  }
});
