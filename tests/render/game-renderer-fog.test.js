// Fog of war on the client side of the renderer: snapshots carry the whole
// world, so nothing drawn may follow an enemy into tiles the local player
// cannot see. Real World + ViewState, stub WebGL (Node has no GL).
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
const { PLAYER_COLORS, DT } = await import('../../src/config.js');

const W = 1280;
const H = 720;

function stubWebgl() {
  return {
    shadowMap: { enabled: false, type: 0, autoUpdate: true },
    info: { render: { calls: 0, triangles: 0 } },
    renderLists: { dispose() {} },
    setClearColor() {},
    setPixelRatio(r) {
      this.pixelRatio = r;
    },
    setSize() {},
    render() {},
    compile() {},
    dispose() {},
  };
}

function makeMatch({ myIndex = 0 } = {}) {
  const setup = {
    version: '0.1.0',
    seed: 4242,
    mapSize: 'small',
    players: ['greek', 'egyptian'].map((p, i) => ({ index: i, name: `P${i}`, team: i + 1, pantheon: p, color: PLAYER_COLORS[i], kind: 'human', difficulty: 'normal' })),
  };
  const world = createWorld(setup);
  const vs = new ViewState({ setup, mapData: world.mapData, myIndex, interpDelayMs: 50 });
  let now = 1000;
  vs.pushSnapshot(world.getSnapshot(), now);
  const canvas = { clientWidth: W, clientHeight: H, width: W, height: H, style: {} };
  const webgl = stubWebgl();
  const r = new GameRenderer(canvas, { viewState: vs, setup, webgl });
  let acc = 0;
  const step = (seconds, fps = 30) => {
    const n = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < n; i++) {
      now += 1000 / fps;
      acc += 1000 / fps;
      while (acc >= DT * 1000) {
        acc -= DT * 1000;
        world.tick();
        vs.pushSnapshot(world.getSnapshot(), now);
      }
      vs.update(now);
      r.update(1 / fps);
    }
  };
  return { world, vs, r, webgl, step };
}

const tcOf = (vs, o) => [...vs.entities.values()].find((e) => e.k === 'b' && e.o === o && e.t === 'town_center');

/** A passable tile center the local player sees right now, about `d` tiles from (x, y). */
function visibleSpot(world, vs, x, y, d) {
  for (let a = 0; a < Math.PI * 2; a += 0.15) {
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (vs.isVisibleAt(px, py) && world.map.isPassable(Math.floor(px), Math.floor(py))) return { x: Math.floor(px) + 0.5, y: Math.floor(py) + 0.5 };
  }
  return null;
}

const shields = (r) => r.vfx.effects.filter((f) => f.shape === 'shield');

test('GameRenderer: a shield cast in sight does not follow its enemy into the fog', () => {
  const { world, vs, r, step } = makeMatch();
  step(0.3);
  const tc = tcOf(vs, 0);
  const spot = visibleSpot(world, vs, tc.x, tc.y, 5);
  assert.ok(spot, 'a visible spot near my base');
  const enemy = world.spawnUnit(1, 'warrior', spot.x, spot.y, { silent: true });
  const own = world.spawnUnit(0, 'warrior', spot.x - 1, spot.y, { silent: true });
  step(0.2);
  assert.ok(vs.isEntityVisible(vs.entities.get(enemy.id)));
  // An 8 s shield on each, the way the sim announces it (effect at the caster).
  for (const u of [enemy, own]) vs.fire({ type: 'effect', el: 'holy', shape: 'shield', x: u.x, y: u.y, r: 1, duration: 8, src: u.id, ability: 'test_shield' });
  step(0.3);
  assert.equal(shields(r).length, 2, 'both shields show while seen');
  // The enemy walks off into the fog; my own unit walks a few tiles too.
  const far = { x: world.mapData.width - 6, y: world.mapData.height - 6 };
  enemy.x = far.x;
  enemy.y = far.y;
  own.x += 2;
  step(0.2);
  assert.equal(vs.isEntityVisible(vs.entities.get(enemy.id)), false, 'the enemy is out of sight');
  step(0.5);
  const left = shields(r);
  assert.equal(left.length, 1, 'only the shield on my own unit is left');
  for (const f of left) assert.ok(Math.hypot(f.x - far.x, f.y - far.y) > 10, `no effect near the hidden enemy (${f.x}, ${f.y})`);
  const o = vs.entities.get(own.id);
  assert.ok(Math.hypot(left[0].x - (o.ix ?? o.x), left[0].y - (o.iy ?? o.y)) < 0.2, 'the own shield still follows its unit');
  r.dispose();
});

test('GameRenderer: a fogged gold mine keeps the gold pile it had when last seen', () => {
  const { world, vs, r, step } = makeMatch();
  step(0.2);
  const etc = tcOf(vs, 1);
  const mine = [...world.mineList].sort((a, b) => Math.hypot(a.x - etc.x, a.y - etc.y) - Math.hypot(b.x - etc.x, b.y - etc.y))[0];
  const scout = world.spawnUnit(0, 'worshipper', mine.x, mine.y + 3, { silent: true });
  step(0.2);
  assert.ok(vs.mineInSight(vs.entities.get(mine.id)));
  const seen = mine.amount;
  assert.equal(r.mines.get(mine.id).amt, seen);
  const home = tcOf(vs, 0);
  scout.x = home.x + 3;
  scout.y = home.y + 3;
  world.issueCommand(1, { type: 'gather', units: world.unitsOf(1).map((u) => u.id), target: mine.id });
  step(40, 10);
  assert.ok(mine.amount < seen, `the enemy mined it (${mine.amount})`);
  assert.equal(vs.mineInSight(vs.entities.get(mine.id)), false);
  assert.ok(r.mines.has(mine.id), 'still drawn (explored)');
  assert.equal(r.mines.get(mine.id).amt, seen, 'the pile shows what I saw');
  r.dispose();
});
