// Which unit models the renderer builds: the rich skinned humanoids on high and ultra, the
// low-poly ones on low and medium, rebuilt when the quality changes, pinned by setUnitDetail.
// Real World and ViewState, stub WebGL (Node has no GL).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const VENDOR = new URL('../../vendor/three/', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: ${JSON.stringify(`${VENDOR}three.module.js`)}, shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ${JSON.stringify(VENDOR + 'addons/')} + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}`)}`);

const { GameRenderer } = await import('../../src/render/game-renderer.js');
const { createWorld } = await import('../../src/sim/world.js');
const { ViewState } = await import('../../src/game/view-state.js');
const { PLAYER_COLORS } = await import('../../src/config.js');

const W = 1280;
const H = 720;

function stubWebgl() {
  return {
    shadowMap: { enabled: false, type: 0, autoUpdate: true },
    info: { render: { calls: 0, triangles: 0 } },
    renderLists: { dispose() {} },
    setClearColor() {},
    setPixelRatio() {},
    setSize() {},
    render() {},
    compile() {},
    dispose() {},
  };
}

/** Two players on one team, so each sees the other's units (their start areas are far apart). */
function makeMatch(quality) {
  const setup = {
    version: '0.1.0',
    seed: 4242,
    mapSize: 'small',
    players: ['norse', 'celtic'].map((p, i) => ({ index: i, name: `P${i}`, team: 1, pantheon: p, color: PLAYER_COLORS[i], kind: 'human', difficulty: 'normal' })),
  };
  const world = createWorld(setup);
  const vs = new ViewState({ setup, mapData: world.mapData, myIndex: 0, interpDelayMs: 50 });
  let now = 1000;
  vs.pushSnapshot(world.getSnapshot(), now);
  const canvas = { clientWidth: W, clientHeight: H, width: W, height: H, style: {} };
  const r = new GameRenderer(canvas, { viewState: vs, setup, quality, webgl: stubWebgl() });
  const step = (seconds, fps = 30) => {
    const n = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < n; i++) {
      now += 1000 / fps;
      world.tick();
      vs.pushSnapshot(world.getSnapshot(), now);
      vs.update(now);
      r.update(1 / fps);
    }
  };
  // look at the start of the first player, where the first workers stand
  const start = [...vs.entities.values()].find((e) => e.k === 'u' && e.o === 0);
  if (start) r.camera.centerOn(start.x, start.y, false);
  return { world, vs, r, step };
}

const richViews = (r) => [...r.units.values()].filter((v) => v.model.rich);
const baseViews = (r) => [...r.units.values()].filter((v) => !v.model.rich);
const ownedBy = (r, owner) => [...r.units.values()].filter((v) => v.e.o === owner);

test('high and ultra draw the rich humanoids, low and medium the low-poly models', () => {
  for (const [quality, rich] of [['low', false], ['medium', false], ['high', true], ['ultra', true]]) {
    const { r, step } = makeMatch(quality);
    assert.equal(r.unitDetail(), rich ? 'rich' : 'base', quality);
    step(0.3);
    assert.ok(r.units.size > 0, `${quality}: unit views exist`);
    if (rich) assert.ok(richViews(r).length > 0, `${quality}: some units are rich humanoids`);
    else assert.equal(richViews(r).length, 0, `${quality}: none is`);
    r.dispose();
  }
});

test('only the pantheons that have the new characters get them: the Norse sample, not the Celts', () => {
  const { r, step } = makeMatch('high');
  step(0.3);
  const norse = ownedBy(r, 0);
  const celts = ownedBy(r, 1);
  assert.ok(norse.length > 0 && celts.length > 0, 'both players have unit views');
  assert.ok(norse.every((v) => v.model.rich), 'every Norse unit the builder can dress is rich');
  assert.equal(celts.filter((v) => v.model.rich).length, 0, 'the Celtic ones stay low-poly');
  assert.equal(r.detailFor('norse'), 'rich');
  assert.equal(r.detailFor('celtic'), 'base');
  // a tool pinning rich shows them all
  r.setUnitDetail('rich');
  step(0.3);
  assert.ok(ownedBy(r, 1).some((v) => v.model.rich), 'the Celtic warriors take the rich build when pinned');
  r.dispose();
});

test('changing the quality rebuilds the unit views at the new detail', () => {
  const { r, step } = makeMatch('medium');
  step(0.3);
  const before = [...r.units.values()];
  assert.ok(before.length > 0 && richViews(r).length === 0);
  r.setQuality('high');
  assert.equal(r.units.size, 0, 'the old views are dropped');
  step(0.3);
  assert.ok(richViews(r).length > 0, 'the next frame builds rich ones');
  for (const v of before) assert.equal(v.model.disposed, true, 'and the old models are released');
  const rich = [...r.units.values()];
  r.setQuality('high'); // same detail: nothing is rebuilt
  assert.deepEqual([...r.units.values()], rich);
  r.setQuality('low');
  assert.equal(r.units.size, 0);
  step(0.3);
  assert.equal(richViews(r).length, 0);
  assert.ok(baseViews(r).length > 0);
  r.dispose();
});

test('setUnitDetail pins the detail whatever the quality, and auto hands it back', () => {
  const { r, step } = makeMatch('high');
  step(0.3);
  assert.ok(richViews(r).length > 0);
  r.setUnitDetail('base');
  assert.equal(r.unitDetail(), 'base');
  step(0.3);
  assert.equal(richViews(r).length, 0, 'low-poly even on high');
  r.setQuality('ultra');
  assert.equal(r.unitDetail(), 'base', 'a quality change does not undo the pin');
  r.setUnitDetail('auto');
  assert.equal(r.unitDetail(), 'rich');
  step(0.3);
  assert.ok(richViews(r).length > 0);
  r.dispose();
});
