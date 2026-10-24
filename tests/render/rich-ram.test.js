// Tests for the rich battering ram (High and Ultra): the siege engine every pantheon trains, drawn as one smooth skinned mesh in place of the rigid
// low-poly parts (rich-ram.js): a frame of timbers on two axles of spoked wheels, a roof of stitched hides in the team's color, a log of bark hung from
// the ridge on ropes with an iron ram's head on its end, a banner. Its bones (the frame, the log, two pairs of ropes, an axle each, four of the flag)
// are posed by rich-ram-anim.js from the pose key of the low-poly rig (the log's stroke) and the turn of its wheels, which stay the source of truth.
// Low and Medium keep the low-poly ram. With the ram, every unit of every pantheon has a rich model.
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
const { richSupported, buildRichTemplate, RICH_PANTHEONS } = await import('../../src/render/models/rich-humanoid.js');
const { creatureSupported } = await import('../../src/render/models/rich-creatures.js');
const { ramSupported, WHEEL_R, SILL_Y, RIDGE_Y, LOG_Y, ROPE_LEN, POST_Z, TIE_Y } = await import('../../src/render/models/rich-ram.js');
const { UNITS, MORTALS, PANTHEON_LIST } = await import('../../src/data/index.js');
const { unitLook } = await import('../../src/render/models/unit-looks.js');
const { PLAYER_COLORS } = await import('../../src/config.js');
const { UnitFader, FadeMaterials } = await import('../../src/render/unit-fade.js');

// The siege engines' budget: a mortal's, as the other rich units that train in numbers.
const RICH_BUDGET = 8500;
const STATES = ['idle', 'move', 'attack', 'cast', 'pray', 'dead'];

const ram = (pantheon = 'greek') => unitLook(MORTALS.battering_ram, pantheon);
const withVisual = (u, change) => ({ ...u, visual: { ...u.visual, ...change(u.visual) } });

// the ram's bones: the frame, the log, the two ropes, one axle each end, and the four of the banner
const BONES = ['root', 'body', 'log', 'ropeA', 'ropeB', 'axleF', 'axleB', 'flag1', 'flag2', 'flag3', 'flag4'];

function finite(arr, label) {
  for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), `${label}: non-finite value at ${i}`);
}

/** Walk a model through every state a few times and check its bone matrices stay finite. */
function runStates(model, label) {
  const skel = model.rich.mesh.skeleton;
  for (const st of STATES) {
    model.animate('idle', 0, 0, {});
    for (let i = 0; i < 40; i++) {
      const ex = { moving: st === 'move', speed: 2 };
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

/** The sum of a template's vertex colors (a pantheon dresses the same body in its own). */
function paintSum(tpl) {
  const c = tpl.rich.geo.attributes.color.array;
  let h = 0;
  for (let i = 0; i < c.length; i++) h += c[i] * (1 + (i % 89) * 0.011);
  return h;
}

/** Indices of the vertices bound mostly to the bone `name`. */
function boundTo(tpl, name) {
  const g = tpl.rich.geo;
  const bone = tpl.rich.spec.ix[name];
  const idx = g.attributes.skinIndex.array;
  const w = g.attributes.skinWeight.array;
  const out = [];
  for (let i = 0; i < g.attributes.position.count; i++) {
    let own = 0;
    for (let k = 0; k < 4; k++) if (idx[i * 4 + k] === bone) own += w[i * 4 + k];
    if (own > 0.5) out.push(i);
  }
  return out;
}

test('the battering ram is a siege engine on a body plan of its own: the gate lets through the ram with nothing on it', () => {
  const u = ram();
  assert.equal(u.visual.body, 'ram');
  assert.ok(ramSupported(u.visual), 'the ram is the one the plan builds');
  assert.ok(richSupported(u), 'supported');
  assert.ok(creatureSupported(u), 'a creature body plan: it has no person on it');
  // only the ram with no head, gear or extras is let through: any other ram-shaped unit keeps its low-poly model
  assert.ok(!ramSupported(withVisual(u, () => ({ body: 'quadruped' })).visual), 'another body');
  assert.ok(!richSupported(withVisual(u, () => ({ head: 'ram' }))), 'a head of any kind');
  assert.ok(!richSupported(withVisual(u, () => ({ heads: 2 }))), 'two heads');
  assert.ok(!richSupported(withVisual(u, () => ({ headgear: 'helmet' }))), 'headgear');
  assert.ok(!richSupported(withVisual(u, () => ({ weapon: 'spear' }))), 'a weapon');
  assert.ok(!richSupported(withVisual(u, () => ({ offhand: 'shield' }))), 'an offhand');
  assert.ok(!richSupported(withVisual(u, () => ({ extras: ['wings'] }))), 'extras');
  assert.ok(richSupported(withVisual(u, () => ({ head: 'none', headgear: 'none', weapon: 'none', offhand: 'none', extras: [] }))), 'nothing on it is fine');
  // every pantheon trains the same ram, in its own colors
  for (const pantheon of RICH_PANTHEONS) assert.ok(richSupported(ram(pantheon)), `${pantheon} ram`);
});

test('with the ram every unit of every pantheon has a rich model: no unit is left low-poly', () => {
  let n = 0;
  for (const p of PANTHEON_LIST) {
    const list = [...Object.values(MORTALS), ...Object.values(UNITS).filter((u) => u.pantheon === p.id)];
    for (const def of list) {
      const u = unitLook(def, p.id);
      assert.ok(richSupported(u), `${p.id} ${u.id} is supported`);
      n++;
    }
  }
  assert.ok(n >= 150, `${n} units checked`);
});

test('the ram builds a valid skinned mesh inside the rich budget, taller than a cart and no taller than the low-poly one by much', () => {
  for (const pantheon of RICH_PANTHEONS) {
    const u = ram(pantheon);
    const tpl = buildRichTemplate(u);
    const g = tpl.rich.geo;
    assert.ok(tpl.triangles > 3000, `${pantheon}: suspiciously few triangles (${tpl.triangles})`);
    assert.ok(tpl.triangles <= RICH_BUDGET, `${pantheon}: ${tpl.triangles} triangles > ${RICH_BUDGET}`);
    assert.equal(tpl.meshes, 1, 'one skinned mesh, no rigid pieces');
    assert.deepEqual(tpl.rich.attach, [], 'nothing rides a bone as a separate piece');
    for (const name of ['position', 'normal', 'color', 'aFx', 'aAo']) finite(g.attributes[name].array, `${pantheon} ${name}`);
    assert.equal(g.attributes.color.itemSize, 3, 'a solid body has no alpha');
    const bones = tpl.rich.spec.pos.length;
    const idx = g.attributes.skinIndex.array;
    const w = g.attributes.skinWeight.array;
    for (let i = 0; i < g.attributes.position.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        assert.ok(idx[i * 4 + k] < bones, `${pantheon}: bone index out of range`);
        assert.ok(w[i * 4 + k] >= 0);
        sum += w[i * 4 + k];
      }
      assert.ok(Math.abs(sum - 1) < 1e-3, `${pantheon}: skin weights of vertex ${i} sum to ${sum}`);
    }
    const base = getUnitModelInfo(u, 'base').height;
    const rich = getUnitModelInfo(u, 'rich').height;
    assert.ok(rich > base * 0.6 && rich < base * 1.5, `${pantheon}: rich height ${rich.toFixed(2)} vs base ${base.toFixed(2)}`);
  }
  const tpl = buildRichTemplate(ram());
  assert.equal(tpl.kind, 'ram', 'it keeps its kind: the pose of the low-poly ram');
  assert.equal(tpl.rich.plan, 'ram');
  assert.equal(tpl.rig.wheelR, WHEEL_R, 'the wheels turn by the same radius as the low-poly rig\'s');
  // a ram builds the same mesh every time
  assert.equal(fingerprint(tpl), fingerprint(buildRichTemplate(ram())));
});

test('every pantheon dresses the same body in its own colors', () => {
  const greek = buildRichTemplate(ram('greek'));
  const sums = new Set();
  for (const pantheon of RICH_PANTHEONS) {
    const tpl = buildRichTemplate(ram(pantheon));
    assert.equal(fingerprint(tpl), fingerprint(greek), `${pantheon}: the same shape`);
    sums.add(paintSum(tpl).toFixed(3));
  }
  assert.ok(sums.size >= 6, `the paints differ (${sums.size} of ${RICH_PANTHEONS.length})`);
});

test('the ram\'s skeleton is a frame on two axles with a log and two pairs of ropes hung from the ridge, and a banner of four bones', () => {
  const { spec } = buildRichTemplate(ram()).rich;
  assert.deepEqual(spec.names, BONES);
  const { ix } = spec;
  assert.equal(spec.parent[ix.root], -1);
  assert.equal(spec.parent[ix.body], ix.root, 'the frame rides the axles');
  assert.equal(spec.parent[ix.log], ix.body, 'the log hangs from the frame');
  assert.equal(spec.parent[ix.ropeA], ix.body);
  assert.equal(spec.parent[ix.ropeB], ix.body);
  assert.equal(spec.parent[ix.axleF], ix.root, 'an axle turns on its own');
  assert.equal(spec.parent[ix.axleB], ix.root);
  assert.equal(spec.parent[ix.flag1], ix.body, 'the banner is lashed to the frame');
  for (const i of [2, 3, 4]) assert.equal(spec.parent[ix[`flag${i}`]], ix[`flag${i - 1}`], 'the cloth is a chain of four');
  const at = (name) => spec.pos[ix[name]];
  assert.ok(Math.abs(at('axleF')[1] - WHEEL_R) < 1e-9 && Math.abs(at('axleB')[1] - WHEEL_R) < 1e-9, 'the axles are a wheel\'s radius off the ground');
  assert.ok(at('axleF')[0] > 0 && at('axleB')[0] < 0 && Math.abs(at('axleF')[0] + at('axleB')[0]) < 1e-9, 'one forward, one behind');
  assert.ok(Math.abs(at('log')[1] - LOG_Y) < 1e-9, 'the log lies under the ridge');
  assert.ok(at('ropeA')[1] - at('log')[1] > ROPE_LEN, 'the ropes hang from above the log');
  assert.ok(at('ropeA')[0] < at('ropeB')[0], 'a pair of ropes toward the tail of the log and one toward its head');
  assert.ok(at('ropeA')[1] < RIDGE_Y && at('ropeA')[1] > RIDGE_Y - 0.05, 'hung from the ridge');
  for (let i = 2; i <= 4; i++) assert.ok(at(`flag${i}`)[0] > at(`flag${i - 1}`)[0], 'the cloth streams back from the pole');
  assert.ok(spec.fit, 'the loft binds fit the rest pose');
  assert.ok(Math.abs(spec.pos[ix.body][1] - SILL_Y) < 1e-9, 'the frame sits on the axles');
});

test('the ram stands on four wheels, a frame over them, the log under its roof and the banner above', () => {
  const tpl = buildRichTemplate(ram());
  const g = tpl.rich.geo;
  g.computeBoundingBox();
  const m = g.boundingBox;
  assert.ok(Math.abs(m.min.y) < 0.01, `the wheels rest on the ground (${m.min.y.toFixed(3)})`);
  assert.ok(m.max.y > 1.2 && m.max.y < 1.5, `with the banner it is about as tall as the low-poly ram (${m.max.y.toFixed(3)})`);
  assert.ok(m.min.x < -0.5 && m.min.x > -0.65, `the butt of the log and the sills reach out behind (${m.min.x.toFixed(3)})`);
  assert.ok(m.max.x > 0.6 && m.max.x < 0.85, `the iron head leads (${m.max.x.toFixed(3)})`);
  assert.ok(m.max.z > 0.33 && m.max.z < 0.4 && m.min.z < -0.33 && m.min.z > -0.4, 'two wheels each side of the frame');
  // the wheels are round and the right size: the tire's tallest and lowest points on an axle are a diameter apart
  const w = boundTo(tpl, 'axleF');
  assert.ok(w.length > 300, `a few hundred vertices of wheels (${w.length})`);
  let lo = 9;
  let hi = -9;
  for (const i of w) {
    lo = Math.min(lo, g.attributes.position.getY(i));
    hi = Math.max(hi, g.attributes.position.getY(i));
  }
  assert.ok(Math.abs(hi - lo - 2 * WHEEL_R) < 0.01, `a wheel is ${(2 * WHEEL_R).toFixed(2)} across (${(hi - lo).toFixed(3)})`);
  // the ridge is where the ropes hang from, and a gabled roof falls away from it on both sides
  let ridgeTop = -9;
  for (let i = 0; i < g.attributes.position.count; i++) if (Math.abs(g.attributes.position.getZ(i)) < 0.05 && g.attributes.position.getX(i) > 0) ridgeTop = Math.max(ridgeTop, g.attributes.position.getY(i)); // (clear of the banner)
  assert.ok(ridgeTop > RIDGE_Y && ridgeTop < RIDGE_Y + 0.12, `the ridge pole (${ridgeTop.toFixed(3)})`);
});

test('the team\'s color is on the roof of hides and the banner, so the owner can be told from above', () => {
  const g = buildRichTemplate(ram()).rich.geo;
  const fx = g.attributes.aFx.array;
  const p = g.attributes.position.array;
  const count = (pick) => {
    let n = 0;
    for (let i = 0; i < g.attributes.position.count; i++) if (fx[i * 4] > 0 && pick(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])) n++;
    return n;
  };
  assert.ok(count((x, y, z) => y > 0.45 && y < 0.8 && z > 0.05) > 100, 'the roof, one side');
  assert.ok(count((x, y, z) => y > 0.45 && y < 0.8 && z < -0.05) > 100, 'and the other');
  assert.ok(count((x, y) => y > 1.0) > 20, 'the banner');
  assert.equal(count((x, y) => y < 0.2), 0, 'not the wheels and the sills');
});

test('Low and Medium keep the low-poly ram; High and Ultra swap in the rich one', () => {
  const u = ram();
  const info = getUnitModelInfo(u, 'base');
  assert.equal(info.triangles, 484, 'the low-poly ram is what it was');
  assert.ok(Math.abs(info.height - 1.3) < 1e-3);
  assert.equal(info.kind, 'ram');
  assert.equal(info.rich, false);
  const base = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'base' });
  assert.equal(base.rich, null, 'it stays low-poly on Low and Medium');
  assert.ok(!base.root.getObjectByProperty('isSkinnedMesh', true));
  const rich = buildUnitModel(u, PLAYER_COLORS[0], { detail: 'rich' });
  assert.ok(rich.rich, 'it is rich on High and Ultra');
  assert.equal(rich.kind, 'ram', 'and has the ram\'s pose');
  const body = rich.root.getObjectByName('body');
  assert.ok(body?.isSkinnedMesh, 'one skinned body');
  assert.ok(!body.material.transparent, 'it is drawn solid');
  assert.equal(rich.rich.plan, 'ram', 'the instance runs its own pose');
  assert.ok(rich.rich.mesh.skeleton.bones.length === BONES.length);
  for (const m of [base, rich]) m.dispose();
});

test('the low-poly ram is untouched: its log slides on its rigid part and its wheels turn on theirs', () => {
  const m = buildUnitModel(ram(), PLAYER_COLORS[0], { detail: 'base' });
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 90; i++) {
    m.animate('attack', i / 30, 1 / 30, { attackPhase: (i % 45) / 45 });
    lo = Math.min(lo, m.parts.log.position.x);
    hi = Math.max(hi, m.parts.log.position.x);
  }
  assert.ok(lo < -0.1 && hi > 0.1, `the log is drawn back and thrust forward (${lo.toFixed(2)} to ${hi.toFixed(2)})`);
  const before = m.parts.axleF.rotation.z;
  for (let i = 0; i < 30; i++) m.animate('move', 4 + i / 30, 1 / 30, { moving: true, speed: 2 });
  assert.notEqual(m.parts.axleF.rotation.z, before, 'the wheels turn');
  m.dispose();
});

test('the ram fades in and out at the edge of the player\'s vision like any other unit', () => {
  const m = buildUnitModel(ram(), PLAYER_COLORS[0], { detail: 'rich' });
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

test('the ram animates every state without a NaN, through the same pose keys, even one first seen dead', () => {
  for (const pantheon of ['greek', 'norse', 'west_african']) {
    const m = buildUnitModel(ram(pantheon), PLAYER_COLORS[2], { detail: 'rich' });
    runStates(m, `${pantheon} ram`);
    m.dispose();
  }
  // (a unit that comes into view already dead: its first pose is the last)
  const d = buildUnitModel(ram(), PLAYER_COLORS[2], { detail: 'rich' });
  d.animate('dead', 0, 1 / 30, {});
  d.root.updateMatrixWorld(true);
  d.rich.mesh.skeleton.update();
  finite(d.rich.mesh.skeleton.boneMatrices, 'first seen dead');
  d.dispose();
});

test('the frame rides its axles at its own height in every state, rising a little as the wheels turn', () => {
  const m = buildUnitModel(ram(), PLAYER_COLORS[1], { detail: 'rich' });
  const { bones, ix } = m.rich;
  const rest = SILL_Y;
  for (const st of ['idle', 'attack', 'cast', 'pray']) {
    for (let i = 0; i < 40; i++) m.animate(st, i / 30, 1 / 30, { attackPhase: st === 'attack' ? (i % 20) / 20 : undefined });
    assert.ok(Math.abs(bones[ix.body].position.y - rest) < 1e-9, `the frame is on its axles while ${st} (${bones[ix.body].position.y.toFixed(4)})`);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 120; i++) {
    m.animate('move', i / 30, 1 / 30, { moving: true, speed: 2 });
    lo = Math.min(lo, bones[ix.body].position.y);
    hi = Math.max(hi, bones[ix.body].position.y);
  }
  assert.ok(lo >= rest - 1e-9, 'it never sinks below the axles');
  assert.ok(hi - rest > 0.003 && hi - rest < 0.02, `it rises a little with the turn of the wheels (${(hi - rest).toFixed(4)})`);
  // and the world position of the frame is the same as in the bind pose
  m.animate('idle', 0, 0, {});
  m.root.updateMatrixWorld(true);
  const p = new THREE.Vector3().setFromMatrixPosition(bones[ix.body].matrixWorld);
  assert.ok(Math.abs(p.y - SILL_Y) < 1e-6, `the frame's bone is where it was built (${p.y.toFixed(4)})`);
  m.dispose();
});

test('the wheels turn with the road, both axles together by the angle the low-poly rig rolls to, and stay on the ground', () => {
  const m = buildUnitModel(ram(), PLAYER_COLORS[1], { detail: 'rich' });
  const { bones, ix, mesh } = m.rich;
  const v = new THREE.Vector3();
  const tpl = buildRichTemplate(ram());
  const wheels = [...boundTo(tpl, 'axleF'), ...boundTo(tpl, 'axleB')];
  const start = m.wheelAngle;
  let minY = 9;
  let maxY = -9;
  for (let i = 0; i < 120; i++) {
    m.animate('move', i / 30, 1 / 30, { moving: true, speed: 2 });
    assert.equal(bones[ix.axleF].rotation.z, m.wheelAngle, 'the front axle turns to the angle of the rig');
    assert.equal(bones[ix.axleB].rotation.z, m.wheelAngle, 'and so does the rear');
    if (i % 7) continue;
    m.root.updateMatrixWorld(true);
    mesh.skeleton.update();
    for (const k of wheels) {
      mesh.getVertexPosition(k, v);
      v.applyMatrix4(mesh.matrixWorld);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
    }
  }
  const rolled = start - m.wheelAngle;
  const expected = (120 * 2) / (30 * WHEEL_R * m.scale);
  assert.ok(Math.abs(rolled - expected) < 1e-6, `they roll by distance over radius (${rolled.toFixed(3)} against ${expected.toFixed(3)})`);
  assert.ok(rolled > 3, 'a few turns of the wheels in four seconds');
  assert.ok(minY > -0.01 && minY < 0.01, `the lowest point of a wheel is the ground whatever its angle (${minY.toFixed(4)})`);
  assert.ok(Math.abs(maxY - 2 * WHEEL_R) < 0.01, `and the highest its diameter above it (${maxY.toFixed(3)})`);
  // they stand still when the ram does
  const parked = m.wheelAngle;
  for (let i = 0; i < 30; i++) m.animate('idle', 5 + i / 30, 1 / 30, {});
  assert.equal(m.wheelAngle, parked);
  m.dispose();
});

test('the log hangs from the ridge on its ropes and swings on a circle: it rises as the ropes leave the vertical', () => {
  const m = buildUnitModel(ram(), PLAYER_COLORS[1], { detail: 'rich' });
  const { bones, ix } = m.rich;
  const rest = new THREE.Vector3(0, LOG_Y - SILL_Y, 0);
  const range = { dx: [Infinity, -Infinity], dy: [Infinity, -Infinity], th: [Infinity, -Infinity] };
  let worst = 0;
  for (let i = 0; i < 180; i++) {
    m.animate('attack', i / 30, 1 / 30, { attackPhase: (i % 45) / 45 });
    const log = bones[ix.log].position;
    const dx = log.x - rest.x;
    const dy = log.y - rest.y;
    // the log is always ROPE_LEN from the point it hangs from: it moves on a circle about it, and its height follows its distance forward
    worst = Math.max(worst, Math.abs(Math.hypot(dx, dy - ROPE_LEN) - ROPE_LEN));
    assert.ok(dy > -1e-9, 'it never drops below where it hangs');
    assert.ok(Math.abs(bones[ix.ropeA].rotation.z - bones[ix.ropeB].rotation.z) < 1e-12, 'the two pairs of ropes swing as one');
    assert.ok(Math.abs(ROPE_LEN * Math.sin(bones[ix.ropeA].rotation.z) - dx) < 1e-9, 'the ropes\' angle is where the log is');
    range.dx = [Math.min(range.dx[0], dx), Math.max(range.dx[1], dx)];
    range.dy = [Math.min(range.dy[0], dy), Math.max(range.dy[1], dy)];
    range.th = [Math.min(range.th[0], bones[ix.ropeA].rotation.z), Math.max(range.th[1], bones[ix.ropeA].rotation.z)];
  }
  assert.ok(worst < 1e-9, `the log moves on a circle (${worst.toExponential(2)})`);
  assert.ok(range.dx[0] < -0.1, `the log is drawn back in the wind-up (${range.dx[0].toFixed(3)})`);
  assert.ok(range.dx[1] > 0.1, `and thrown forward in the blow (${range.dx[1].toFixed(3)})`);
  assert.ok(range.dy[1] > 0.04, `it rises on the swing (${range.dy[1].toFixed(3)})`);
  assert.ok(range.th[0] < -0.3 && range.th[1] > 0.3, `the ropes swing back and forward (${range.th[0].toFixed(2)} to ${range.th[1].toFixed(2)})`);
  // standing it hangs plumb, with a drift of a few millimeters
  for (let i = 0; i < 120; i++) m.animate('idle', 10 + i / 30, 1 / 30, {});
  assert.ok(Math.abs(bones[ix.log].position.x - rest.x) < 0.02, 'idle: hanging from the ridge');
  m.dispose();
});

test('the log, its bands and its horned head swing clear of the end frames\' posts and tie, drawn all the way back and thrown all the way forward', () => {
  const tpl = buildRichTemplate(ram());
  const g = tpl.rich.geo;
  const verts = boundTo(tpl, 'log').map((i) => [g.attributes.position.getX(i), g.attributes.position.getY(i), g.attributes.position.getZ(i)]);
  assert.ok(verts.length > 600, `the log's vertices (${verts.length})`);
  // a post is a bar from the sill to the ridge, 0.03 half wide at its foot and 0.023 at the top
  const foot = [SILL_Y + 0.07, POST_Z[0]];
  const top = [RIDGE_Y - 0.02, POST_Z[1]];
  const gap = (y, z) => {
    const dy = top[0] - foot[0];
    const dz = top[1] - foot[1];
    const s = Math.max(0, Math.min(1, ((y - foot[0]) * dy + (z - foot[1]) * dz) / (dy * dy + dz * dz)));
    return Math.hypot(y - (foot[0] + dy * s), z - (foot[1] + dz * s)) - (0.03 - 0.007 * s);
  };
  const tieZ = POST_Z[0] + ((POST_Z[1] - POST_Z[0]) * (TIE_Y - foot[0])) / (top[0] - foot[0]);
  let worst = 0;
  for (let th = -0.75; th <= 1.26; th += 0.02) {
    const dx = ROPE_LEN * Math.sin(th);
    const dy = ROPE_LEN * (1 - Math.cos(th));
    for (const [x0, y0, z0] of verts) {
      const x = x0 + dx;
      const y = y0 + dy;
      for (const fx of [0.38, -0.38]) {
        if (Math.abs(x - fx) > 0.033) continue; // (the posts are 0.033 half thick)
        worst = Math.max(worst, -gap(y, Math.abs(z0)));
        if (Math.abs(x - fx) < 0.022 && Math.abs(z0) < tieZ && Math.abs(y - TIE_Y) < 0.02) worst = Math.max(worst, 1 - Math.abs(y - TIE_Y) / 0.02);
      }
    }
  }
  assert.ok(worst < 1e-6, `nothing of the log goes through a post or the tie (${worst.toFixed(4)} in)`);
});

test('the banner ripples from the pole to the free end while the ram rolls, and hangs slack when it is wrecked', () => {
  const m = buildUnitModel(ram(), PLAYER_COLORS[1], { detail: 'rich' });
  const { bones, ix } = m.rich;
  const flags = ['flag1', 'flag2', 'flag3', 'flag4'].map((k) => bones[ix[k]]);
  const swing = (state, frames, ex = {}) => {
    const r = flags.map(() => [Infinity, -Infinity]);
    for (let i = 0; i < frames; i++) {
      m.animate(state, i / 30, 1 / 30, ex);
      flags.forEach((b, k) => { r[k] = [Math.min(r[k][0], b.rotation.y), Math.max(r[k][1], b.rotation.y)]; });
    }
    return r.map(([lo, hi]) => hi - lo);
  };
  const moving = swing('move', 120, { moving: true, speed: 2 });
  for (let k = 0; k < 4; k++) assert.ok(moving[k] > 0.15, `bone ${k} of the cloth ripples (${moving[k].toFixed(3)})`);
  assert.ok(moving[3] > moving[0], 'the free end more than the root');
  const stand = swing('idle', 120);
  assert.ok(stand[3] > 0.05 && stand[3] < moving[3], `it stirs a little when it stands (${stand[3].toFixed(3)})`);
  const phases = flags.map((b) => b.rotation.y);
  assert.ok(Math.abs(phases[0] - phases[2]) > 1e-4, 'each bone on its own phase of the wave');
  m.dispose();
});

test('a wrecked ram topples, the log slumps forward off its ropes, and its bones stay finite', () => {
  const m = buildUnitModel(ram(), PLAYER_COLORS[3], { detail: 'rich' });
  const { bones, ix } = m.rich;
  for (let i = 0; i < 10; i++) m.animate('idle', i / 30, 1 / 30, {});
  const alive = bones[ix.log].position.x;
  for (let i = 0; i < 40; i++) m.animate('dead', 1 + i / 30, 1 / 30, {});
  assert.ok(Math.abs(m.rigGroup.rotation.x) > 1.0, 'it falls over');
  assert.ok(bones[ix.log].position.x - alive > 0.15, `the log swings forward as it falls (${(bones[ix.log].position.x - alive).toFixed(3)})`);
  m.root.updateMatrixWorld(true);
  m.rich.mesh.skeleton.update();
  finite(m.rich.mesh.skeleton.boneMatrices, 'after death');
  // it can be raised again (a unit slot is reused): the ropes and the log come back
  for (let i = 0; i < 60; i++) m.animate('idle', 3 + i / 30, 1 / 30, {});
  assert.ok(Math.abs(bones[ix.log].position.x - alive) < 0.05, 'the log hangs plumb again');
  m.dispose();
});
