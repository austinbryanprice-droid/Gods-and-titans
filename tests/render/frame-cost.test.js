// Per-frame costs kept down (the late-game frame-cost pass): the top bar's number format, the fog goal
// skipped when the vision did not change, and additive double-sided glows drawn in one pass.
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
const { fmt } = await import('../../src/ui/hud-dom.js');
const { FogOfWar } = await import('../../src/render/fog.js');
const { buildUnitModel } = await import('../../src/render/models/unit-models.js');
const { vortexMaterial } = await import('../../src/render/models/building-materials.js');
const { createProjectileBatches } = await import('../../src/render/vfx-projectiles.js');
const { UNITS } = await import('../../src/data/index.js');
const { PLAYER_COLORS } = await import('../../src/config.js');

test('fmt writes the same text as toLocaleString("en-US")', () => {
  const values = [0, 1, 7.9, 999, 999.99, 1000, 1001, 12345, 99999, 100000, 123456.7, 1234567, 9007199254740991,
    -0.5, -1, -999, -1000, -1234567.2, NaN, undefined, null, '', Infinity, -Infinity, 1e300];
  for (let i = 0; i < 2000; i++) values.push(Math.random() * 10 ** Math.floor(Math.random() * 12) * (i % 5 === 0 ? -1 : 1));
  for (const v of values) assert.equal(fmt(v), Math.floor(v || 0).toLocaleString('en-US'), `fmt(${v})`);
});

test('the fog keeps its goal, and its easing, when a snapshot brings the same vision', () => {
  const W = 16;
  const H = 12;
  const fog = new FogOfWar(W, H);
  const visible = new Uint8Array(W * H);
  const explored = new Uint8Array(W * H);
  for (let i = 0; i < 40; i++) explored[i] = 1;
  for (let i = 0; i < 20; i++) visible[i] = 1;
  fog.setGoal(visible, explored);
  const first = fog.goal.slice();
  // vision grows: the goal changes and the fog starts easing toward it
  for (let i = 20; i < 30; i++) visible[i] = 1;
  fog.setGoal(visible, explored);
  const grown = fog.goal.slice();
  assert.notDeepEqual(grown, first);
  assert.equal(fog.settled, false);
  fog.update(0.05);
  const mid = fog.cur.slice();
  // the next snapshot sees the same: nothing is recomputed and the easing carries on from where it was
  const goalBefore = fog.goal;
  fog.goal = new Proxy(goalBefore, { set() { throw new Error('goal written for an unchanged vision'); } });
  fog.setGoal(visible.slice(), explored.slice());
  fog.goal = goalBefore;
  assert.deepEqual(fog.goal, grown);
  assert.deepEqual(fog.cur, mid);
  assert.equal(fog.settled, false);
  // and a changed grid still recomputes the same goal as a fresh fog would
  visible[5] = 0;
  fog.setGoal(visible, explored);
  const fresh = new FogOfWar(W, H);
  fresh.setGoal(visible, explored);
  assert.deepEqual(fog.goal, fresh.goal);
  // reveal all, twice
  fog.setGoal(visible, explored, true);
  const all = fog.goal.slice();
  fog.setGoal(visible, explored, true);
  assert.deepEqual(fog.goal, all);
  fresh.setGoal(visible, explored, true);
  assert.deepEqual(all, fresh.goal);
});

/** A transparent, double-sided material three.js would draw twice (back faces, then front) with two program lookups. */
const twoPass = (m) => m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass;
/** Additive with no depth writes: the faces add up the same in any order, so one pass draws the same picture. */
const orderFree = (m) => m.blending === THREE.AdditiveBlending && !m.depthWrite;

test('additive double-sided glows (unit auras, portal vortex, crescent projectiles) draw in one pass', () => {
  const mats = new Set();
  let auras = 0;
  for (const u of Object.values(UNITS)) {
    const model = buildUnitModel(u, PLAYER_COLORS[1]);
    model.root.traverse((o) => {
      if (!o.material) return;
      if (o.name === 'aura') auras++;
      for (const m of [].concat(o.material)) mats.add(m);
    });
    model.dispose();
  }
  assert.ok(auras > 0, 'some unit has an aura');
  mats.add(vortexMaterial('#ff0000', '#00ff00', '#0000ff'));
  for (const m of createProjectileBatches(new THREE.Group()).materials) mats.add(m);
  const additive = [...mats].filter(orderFree);
  assert.ok(additive.length >= 3);
  for (const m of additive) assert.ok(!twoPass(m), `${m.name || m.type} is drawn in two passes`);
});
