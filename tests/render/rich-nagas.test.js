// Tests for the rich nagas (High and Ultra): the Hindu Naga, Nüwa and Quetzalcoatl. They stand on the humanoid skeleton as far as
// the waist, dressed by their pantheon's outfit, and a serpent's tail takes the legs' place: a chain of nine bones hangs from the
// pelvis (rich-kit.js humanoidSpec, opts.tail) and one scaled loft is skinned along it (rich-naga.js), so the tail undulates behind
// a naga that glides and sways about one that stands (rich-anim.js poseTail, 'serpent'). The Naga has a cobra's head under a hood
// (rich-naga-head.js), Quetzalcoatl a feathered tail with wings and a fan at its tip. Low and Medium keep the low-poly nagas.
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
const { nagaBones, nagaBelly, scalesOf, dorsalDiamonds } = await import('../../src/render/models/rich-naga.js');
const { B, BONE_COUNT } = await import('../../src/render/models/rich-kit.js');
const { UNITS, MORTALS } = await import('../../src/data/index.js');
const { unitLook } = await import('../../src/render/models/unit-looks.js');
const { PLAYER_COLORS } = await import('../../src/config.js');
const { UnitFader, FadeMaterials } = await import('../../src/render/unit-fade.js');

// The same budgets as the rich humanoids and creatures: a god, a creature.
const RICH_BUDGET = { god: 9000, creature: 10500 };
const STATES = ['idle', 'move', 'attack', 'cast', 'pray', 'dead'];
const TAIL_BONES = 9;

const NAGAS = [['hindu', 'hindu_naga'], ['chinese', 'chinese_nuwa'], ['aztec', 'aztec_quetzalcoatl']];
const look = ([pantheon, id]) => unitLook(UNITS[id], pantheon);
const hinduNaga = look(NAGAS[0]);
const nuwa = look(NAGAS[1]);
const quetzalcoatl = look(NAGAS[2]);
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

test('the nagas are built by the rich builder on the humanoid rig, with a serpent\'s tail for legs', () => {
  for (const pair of NAGAS) {
    const u = look(pair);
    assert.equal(u.visual.body, 'naga');
    assert.ok(richSupported(u), `${u.id} is supported`);
    assert.ok(!creatureSupported(u), `${u.id} is not a creature body plan: it is dressed on the humanoid rig`);
  }
  // only the heads, headgear and extras the kit builds are let through: any other naga keeps its low-poly model
  assert.ok(!richSupported(withVisual(nuwa, () => ({ head: 'gorilla' }))), 'a head the kit has no table for');
  assert.ok(!richSupported(withVisual(nuwa, (v) => ({ extras: [...v.extras, 'rider'] }))), 'a rider is not dressed');
  assert.ok(!richSupported(withVisual(hinduNaga, () => ({ heads: 3 }))), 'a many-headed naga is not one head and a hood');
  assert.ok(richSupported(withVisual(hinduNaga, () => ({ head: 'human' }))), 'a naga with a person\'s head is dressed too');
  // the others that stay low-poly (the rams) are not nagas
  for (const id of ['battering_ram']) assert.ok(!richSupported(unitLook(UNITS[id], 'hindu')), `${id} stays low-poly`);
});

test('every naga is dressed by its own people and carries what it is known by', () => {
  for (const pantheon of ['hindu', 'chinese', 'aztec']) {
    const outfit = outfitFor(pantheon, 'naga');
    for (const layer of LAYERS) assert.equal(typeof outfit[layer], 'function', `the ${pantheon} ${layer} layer`);
    assert.equal(outfit.legs, outfitFor(pantheon).legs, `${pantheon}: the naga's tail is built where the people build the legs`);
  }
  // the spirits are the only body whose outfit is the same for every people
  assert.notEqual(outfitFor('hindu', 'naga').legs, outfitFor('chinese', 'naga').legs);
  const weapons = (u) => buildRichTemplate(u).rich.attach.filter((a) => a.name.startsWith('weapon')).length;
  assert.equal(weapons(hinduNaga), 1, 'the Naga\'s spear');
  assert.equal(weapons(nuwa), 2, 'Nuwa\'s staff and the stone in her other hand');
  assert.equal(weapons(quetzalcoatl), 1, 'Quetzalcoatl\'s staff');
});

/** The checks every rich naga's template passes: a valid skinned mesh inside the budget, about as tall as its low-poly model. */
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

test('every naga builds a valid skinned mesh inside the rich budget', () => {
  const seen = new Set();
  for (const pair of NAGAS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    checkSkinned(u, tpl);
    assert.equal(tpl.kind, 'naga', 'it keeps its kind: the sway and the raised arms of a naga');
    assert.equal(tpl.rich.ghost, false, 'a naga is solid');
    assert.equal(tpl.rich.geo.attributes.skinIndex.count, tpl.rich.geo.attributes.position.count);
    seen.add(fingerprint(tpl));
  }
  assert.equal(seen.size, 3, 'no two nagas are the same mesh');
  // a naga builds the same mesh every time
  assert.equal(fingerprint(buildRichTemplate(nuwa)), fingerprint(buildRichTemplate(nuwa)));
  // and a lean build (fewer sides and rings) is a smaller, valid mesh
  for (const u of [hinduNaga, nuwa, quetzalcoatl]) {
    const lean = buildRichTemplate(u, 0.7);
    assert.ok(lean.triangles < buildRichTemplate(u).triangles * 0.9, `${u.id}: the lean build is smaller`);
    finite(lean.rich.geo.attributes.position.array, `${u.id} lean positions`);
  }
});

test('the skeleton is the humanoid\'s with a chain of nine bones that hang from the pelvis, after the wings\' if it has them', () => {
  for (const pair of NAGAS) {
    const u = look(pair);
    const { spec } = buildRichTemplate(u).rich;
    const first = BONE_COUNT + (spec.wing ? 4 : 0);
    assert.equal(spec.pos.length, first + TAIL_BONES, `${u.id}: the humanoid's bones and nine more`);
    assert.deepEqual(spec.tail, { first, count: TAIL_BONES, style: 'serpent' });
    assert.equal(spec.parent[first], B.pelvis, 'the tail hangs from the pelvis');
    for (let i = 1; i < TAIL_BONES; i++) assert.equal(spec.parent[first + i], first + i - 1, 'each bone is the child of the one above');
    assert.equal(spec.names[first], 'tail0');
    assert.equal(spec.names.length, spec.pos.length);
    const hip = spec.pos[B.pelvis][1];
    const tail = spec.pos.slice(first);
    assert.ok(tail[0][1] < hip && tail[0][1] > hip * 0.6, 'the first joint is just below the hip');
    for (let i = 1; i < TAIL_BONES; i++) {
      assert.ok(tail[i][0] < tail[i - 1][0], 'each joint lies further back than the one before');
      assert.ok(tail[i][1] <= tail[i - 1][1] + 1e-9, 'and no higher');
    }
    assert.ok(tail[TAIL_BONES - 1][0] < -1, 'the tail runs out more than a stride behind');
    assert.ok(tail[TAIL_BONES - 1][1] > 0.04, 'but lies on the ground, not in it');
  }
  assert.equal(buildRichTemplate(nuwa).rich.spec.wing, false);
  assert.equal(buildRichTemplate(quetzalcoatl).rich.spec.wing, true, 'the feathered serpent has wings: they come before the tail');
  // the people and the winged have no tail bones; the kit's tail is opt-in
  const warrior = buildRichTemplate(unitLook(MORTALS.warrior, 'hindu'));
  assert.equal(warrior.rich.spec.tail, undefined);
  assert.equal(warrior.rich.spec.pos.length, BONE_COUNT);
  // nagaBones keeps to the body's own proportions
  const bones = nagaBones({ hipY: 0.46 });
  assert.equal(bones.length, TAIL_BONES);
  const tall = nagaBones({ hipY: 0.9 });
  assert.ok(tall[0][1] > bones[0][1] + 0.3, 'the first joint follows the hip');
});

test('the tail lies along the ground behind the body, is skinned along its bones and goes nowhere in front of the naga', () => {
  for (const pair of NAGAS) {
    const u = look(pair);
    const tpl = buildRichTemplate(u);
    const g = tpl.rich.geo;
    const box = g.boundingBox;
    const { first } = tpl.rich.spec.tail;
    assert.ok(box.min.y > -0.01, `${u.id}: nothing sinks into the ground (${box.min.y.toFixed(3)})`);
    assert.ok(box.min.y < 0.02, `${u.id}: the belly rests on it (${box.min.y.toFixed(3)})`);
    assert.ok(box.min.x < -1.3, `${u.id}: the tail runs out behind (${box.min.x.toFixed(3)})`);
    assert.ok(box.max.x < 0.4, `${u.id}: nothing out in front of it`);
    // the far end of the tail is weighted to the tail's last bones, the root of it to the pelvis and the first
    const p = g.attributes.position.array;
    const idx = g.attributes.skinIndex.array;
    const w = g.attributes.skinWeight.array;
    let tip = 0;
    let tipN = 0;
    for (let i = 0; i < g.attributes.position.count; i++) {
      if (p[i * 3] > -1.2 || p[i * 3 + 1] > 0.5) continue;
      tipN++;
      for (let k = 0; k < 4; k++) if (idx[i * 4 + k] >= first + TAIL_BONES - 3) tip += w[i * 4 + k];
    }
    assert.ok(tipN > 40, `${u.id}: the tip of the tail has vertices (${tipN})`);
    assert.ok(tip / tipN > 0.9, `${u.id}: and they follow the last bones (${(tip / tipN).toFixed(2)})`);
  }
});

test('the nagas have what their people know them by: a cobra\'s hood, a goddess\'s tiara, a plumed serpent\'s wings', () => {
  const tris = (u) => buildRichTemplate(u).triangles;
  // the Naga: the head of a cobra on a person's neck, under a hood that stands wider than a head does
  assert.equal(hinduNaga.visual.head, 'serpent');
  const human = withVisual(hinduNaga, () => ({ head: 'human' }));
  assert.notEqual(fingerprint(buildRichTemplate(hinduNaga)), fingerprint(buildRichTemplate(human)), 'the cobra\'s head is not a person\'s');
  const wide = (u) => {
    const t = buildRichTemplate(u);
    const p = t.rich.geo.attributes.position.array;
    const { shoulderY } = t.rich.dims;
    let z = 0;
    for (let i = 0; i < p.length; i += 3) if (p[i + 1] > shoulderY + 0.12 && p[i] < 0.1) z = Math.max(z, Math.abs(p[i + 2]));
    return z;
  };
  assert.ok(wide(hinduNaga) > 0.19, `the hood spreads behind the head (${wide(hinduNaga).toFixed(3)})`);
  assert.ok(wide(hinduNaga) > wide(human) + 0.04, 'wider than a person\'s head and crown');
  assert.equal(hinduNaga.visual.headgear, 'crown');
  assert.ok(tris(hinduNaga) > tris(withVisual(hinduNaga, () => ({ headgear: 'none' }))) + 200, 'the crown sits over the hood\'s root');
  // Nuwa: the tiara and hairpins her dress puts on her, long hair down her back
  assert.ok(tris(nuwa) > tris(withVisual(nuwa, (v) => ({ extras: v.extras.filter((e) => e !== 'long_hair') }))) + 150, 'the long hair is strands down her back');
  // Quetzalcoatl: wings and the plumes of a crown
  const wings = buildRichTemplate(quetzalcoatl).rich.attach.filter((a) => a.wing);
  assert.equal(wings.length, 4, 'two pieces of wing a side, flapping on their own bones');
  const wingless = buildRichTemplate(withVisual(quetzalcoatl, (v) => ({ extras: v.extras.filter((e) => e !== 'wings') })));
  assert.equal(wingless.rich.attach.filter((a) => a.wing).length, 0, 'the wings are the unit\'s extra');
  assert.equal(wingless.rich.spec.wing, false);
  // each is the colors of the codices and the reliefs: the three do not look alike
  const hues = NAGAS.map((pair) => {
    const t = buildRichTemplate(look(pair));
    const c = t.rich.geo.attributes.color.array;
    const p = t.rich.geo.attributes.position.array;
    const rgb = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < t.rich.geo.attributes.position.count; i++) {
      if (p[i * 3] > -0.4 || p[i * 3 + 1] > 0.5) continue; // the tail alone
      for (let k = 0; k < 3; k++) rgb[k] += c[i * 3 + k];
      n++;
    }
    return rgb.map((x) => x / n);
  });
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(...hues[i].map((x, k) => x - hues[j][k])) > 0.03, 'the tails are not the same color');
  }
});

test('the underside is pale and laid in plates, the back darker and marked: the belly reads at a glance from a low camera', () => {
  for (const pair of NAGAS) {
    const u = look(pair);
    const t = buildRichTemplate(u);
    const g = t.rich.geo;
    const { hipY } = t.rich.dims;
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    const c = g.attributes.color.array;
    let back = 0;
    let backN = 0;
    let belly = 0;
    let bellyN = 0;
    for (let i = 0; i < g.attributes.position.count; i++) {
      if (p[i * 3] > -0.3 || p[i * 3 + 1] > hipY - 0.1) continue; // the tail beyond its root
      const lum = (c[i * 3] + c[i * 3 + 1] + c[i * 3 + 2]) / 3;
      if (n[i * 3 + 1] > 0.6) {
        back += lum;
        backN++;
      } else if (n[i * 3 + 1] < -0.6) {
        belly += lum;
        bellyN++;
      }
    }
    assert.ok(backN > 40 && bellyN > 40, `${u.id}: both sides of the tail have vertices (${backN}, ${bellyN})`);
    assert.ok(belly / bellyN > back / backN + 0.08, `${u.id}: the belly (${(belly / bellyN).toFixed(2)}) is paler than the back (${(back / backN).toFixed(2)})`);
  }
  // the paint itself: scales' diamonds light and dark along a row, the belly's tone where the ring turns under
  const col = (hex) => new THREE.Color(hex);
  const skin = col('#3a8a68');
  const belly = nagaBelly(skin);
  assert.ok(belly.r > skin.r + 0.3 && belly.g > skin.g, 'the belly is a warm cream with a trace of the skin');
  assert.ok(belly.r > belly.b, 'warm, not grey');
  const paint = scalesOf(2, { skin, back: col('#2a6a58'), belly });
  const at = (u, a) => {
    const o = { r: skin.r, g: skin.g, b: skin.b };
    paint(o, 0, 0, 0, u, a);
    return o;
  };
  const backPx = at(0.3, 0);
  const bellyPx = at(0.3, 0.5);
  assert.ok(bellyPx.r + bellyPx.g + bellyPx.b > (backPx.r + backPx.g + backPx.b) * 1.5, 'the ring\'s underside is far lighter than its back');
  // a chain of diamonds marks the back only
  const marked = (c) => {
    const o = { r: 0.2, g: 0.4, b: 0.3 };
    dorsalDiamonds(9, col('#e8c040'))(o, 0, 0, 0, 0.5 / 9, 0, c);
    return o;
  };
  assert.ok(marked(1).r > 0.4, 'a diamond on the ridge takes the mark\'s color');
  assert.equal(marked(-1).r, 0.2, 'none on the belly');
});

test('the tail\'s paint is lapped feathers on the feathered serpent and diamonds of scales on the rest', () => {
  const skin = new THREE.Color('#2e9a5c');
  const base = { skin, back: new THREE.Color('#1d7a52'), belly: new THREE.Color('#f4efd8') };
  const scales = scalesOf(2, base);
  const feathers = scalesOf(2, { ...base, feathers: { rows: 24, per: 11 } });
  const row = (paint, a) => {
    const out = [];
    for (let k = 0; k < 40; k++) {
      const o = { r: skin.r, g: skin.g, b: skin.b };
      paint(o, 0, 0, 0, 0.2 + k * 0.0042, a);
      out.push(o.g);
    }
    return out;
  };
  const spread = (xs) => Math.max(...xs) - Math.min(...xs);
  assert.ok(spread(row(feathers, 0.02)) > 0.1, 'each feather has a dark edge and a bright body');
  assert.notDeepEqual(row(scales, 0.02), row(feathers, 0.02), 'not the same pattern as the scales');
  // the plates under the belly are the same either way: only the back and the flanks are feathered
  const bellyOnly = (paint) => {
    const o = { r: 0.3, g: 0.4, b: 0.3 };
    paint(o, 0, 0, 0, 0.5, 0.5);
    return o.g;
  };
  assert.ok(Math.abs(bellyOnly(feathers) - bellyOnly(scales)) < 0.12, 'the belly is pale in both');
});

test('the sash and the bands are the team\'s color, so the owner of a naga can be told from above', () => {
  for (const pair of NAGAS) {
    const fx = buildRichTemplate(look(pair)).rich.geo.attributes.aFx.array;
    let team = 0;
    for (let i = 0; i < fx.length; i += 4) if (fx[i] > 0) team++;
    assert.ok(team > 80, `${pair[1]}: the waist and a ring of the tail take the team's color (${team} vertices)`);
  }
});

test('Low and Medium keep the low-poly nagas; High and Ultra swap in the rich ones', () => {
  const expected = { hindu_naga: [878, 1.5329], chinese_nuwa: [1180, 1.8241], aztec_quetzalcoatl: [1452, 2.3336] };
  for (const pair of NAGAS) {
    const u = look(pair);
    const info = getUnitModelInfo(u, 'base');
    assert.equal(info.triangles, expected[u.id][0], `${u.id}: the low-poly naga is what it was`);
    assert.ok(Math.abs(info.height - expected[u.id][1]) < 1e-3);
    assert.equal(info.kind, 'naga');
    assert.equal(info.rich, false);
    const base = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'base' });
    assert.equal(base.rich, null, `${u.id} stays low-poly on Low and Medium`);
    const rich = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
    assert.ok(rich.rich, `${u.id} is rich on High and Ultra`);
    assert.equal(rich.kind, 'naga');
    const body = rich.root.getObjectByName('body');
    assert.ok(body?.isSkinnedMesh, `${u.id}: one skinned body`);
    assert.ok(!body.material.transparent, 'it is drawn solid');
    assert.ok(rich.rich.spec.tail, 'the instance knows its skeleton has a tail');
    assert.equal(rich.rich.spec.tail.style, 'serpent');
    for (const m of [base, rich]) m.dispose();
  }
});

test('a naga fades in and out at the edge of the player\'s vision like any other unit', () => {
  for (const u of [hinduNaga, quetzalcoatl]) {
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

test('every naga animates every state without a NaN, through the same pose keys', () => {
  for (const pair of NAGAS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[2], { detail: 'rich' });
    runStates(m, u.id);
    m.dispose();
  }
});

test('the tail undulates: it sways when the naga is still and sweeps wider when it glides, yawing about the vertical only', () => {
  for (const pair of NAGAS) {
    const u = look(pair);
    const still = buildUnitModel(u, PLAYER_COLORS[1], { detail: 'rich' });
    const moving = buildUnitModel(u, PLAYER_COLORS[1], { detail: 'rich' });
    const { first, count } = still.rich.spec.tail;
    const swing = (m, state, ex) => {
      const yaw = [];
      for (let i = 0; i < 120; i++) {
        m.animate(state, i / 30, 1 / 30, ex);
        yaw.push(m.rich.bones[first + count - 1].rotation.y);
        for (let k = 0; k < count; k++) {
          const r = m.rich.bones[first + k].rotation;
          assert.ok(r.x === 0 && r.z === 0, `${u.id}: tail bone ${k} turns about the vertical only`);
        }
      }
      return Math.max(...yaw) - Math.min(...yaw);
    };
    const a = swing(still, 'idle', {});
    const b = swing(moving, 'move', { moving: true });
    assert.ok(a > 0.08, `${u.id}: the tip sways when the naga stands (${a.toFixed(3)})`);
    assert.ok(b > a * 1.3, `${u.id}: and sweeps wider when it moves (${a.toFixed(3)} still, ${b.toFixed(3)} moving)`);
    // the waves run down the chain: a bone further down is a phase behind the one above (it repeats the one above some frames later)
    const y0 = [];
    const y2 = [];
    for (let i = 0; i < 200; i++) {
      moving.animate('move', (120 + i) / 30, 1 / 30, { moving: true });
      y0.push(moving.rich.bones[first].rotation.y);
      y2.push(moving.rich.bones[first + 2].rotation.y);
    }
    let bestLag = 0;
    let best = -Infinity;
    for (let lag = -12; lag <= 12; lag++) {
      let sum = 0;
      for (let i = 20; i < 180; i++) sum += y0[i - lag] * y2[i];
      if (sum > best) {
        best = sum;
        bestLag = lag;
      }
    }
    assert.ok(bestLag >= 3 && bestLag <= 11, `${u.id}: the third bone repeats the first some frames later (${bestLag})`);
    for (const m of [still, moving]) m.dispose();
  }
});

test('a naga that dies topples like any other unit and its bones stay finite', () => {
  for (const pair of NAGAS) {
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

test('a naga that dies lays its tail straight out behind it, so the S of the tail does not roll under the ground with the body', () => {
  const v = new THREE.Vector3();
  for (const pair of NAGAS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[3], { detail: 'rich' });
    const { first, count } = m.rich.spec.tail;
    // the joints' sideways offsets from the line behind the pelvis (the bones live in the model's frame, outside the scene graph:
    // the topple turns the rig about the model's own length, which this does not see)
    const spread = () => {
      let widest = 0;
      for (let i = 0; i < count; i++) {
        m.rich.bones[first + i].getWorldPosition(v);
        widest = Math.max(widest, Math.abs(v.z));
      }
      return widest;
    };
    for (let i = 0; i < 60; i++) m.animate('idle', i / 30, 1 / 30, {});
    const standing = spread();
    assert.ok(standing > 0.12, `${u.id}: the tail of a standing naga lies in an S (${standing.toFixed(3)})`);
    for (let i = 0; i < 60; i++) m.animate('dead', i / 30, 1 / 30, {});
    const lying = spread();
    assert.ok(lying < 0.05, `${u.id}: a dead naga's tail lies straight (${lying.toFixed(3)})`);
    const tip = m.rich.bones[first + count - 1].getWorldPosition(v);
    assert.ok(tip.x < -1.1, `${u.id}: and stays as long as it was (${tip.x.toFixed(2)})`);
    m.dispose();
  }
});

test('a posed naga keeps its tail above the ground and within a few of its own lengths of where it stands', () => {
  const v = new THREE.Vector3();
  for (const pair of NAGAS) {
    const u = look(pair);
    const m = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
    const mesh = m.rich.mesh;
    const n = mesh.geometry.attributes.position.count;
    for (const state of ['idle', 'move', 'attack']) {
      for (let i = 0; i < 90; i++) m.animate(state, i / 30, 1 / 30, { moving: state === 'move', attackPhase: state === 'attack' ? (i % 30) / 30 : undefined });
      m.root.updateMatrixWorld(true);
      mesh.skeleton.update();
      let minY = 9;
      let maxR = 0;
      for (let k = 0; k < n; k += 5) {
        mesh.getVertexPosition(k, v);
        v.applyMatrix4(mesh.matrixWorld);
        minY = Math.min(minY, v.y);
        maxR = Math.max(maxR, Math.hypot(v.x, v.z));
      }
      assert.ok(minY > -0.08, `${u.id}/${state}: the tail does not dig into the ground (${minY.toFixed(3)})`);
      assert.ok(maxR < 3.3, `${u.id}/${state}: the tail stays close (${maxR.toFixed(2)})`);
    }
    m.dispose();
  }
});
