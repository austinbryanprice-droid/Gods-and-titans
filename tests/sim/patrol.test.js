// Patrol (DESIGN 6.2): a unit attack-moves back and forth between where it was and the spot it was
// sent to, until another order; it fights what it meets on the way, keeps going after, and is the
// same in every copy of the match (a plain order: replays, saves and online games carry it).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCommand } from '../../src/sim/commands.js';
import { createWorld } from '../../src/sim/world.js';
import { packMatch, unpackMatch } from '../../src/game/save-game.js';
import { makeWorld, run, runUntil, spawn, clearUnits } from './helpers.js';

function arena() {
  const w = makeWorld();
  clearUnits(w, 0);
  clearUnits(w, 1);
  w.events.length = 0;
  return w;
}

const near = (u, x, y, r = 0.8) => Math.hypot(u.x - x, u.y - y) < r;

test('a patrol walks to the spot, back to where it began, and on, until told otherwise', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 10, 20);
  w.issueCommand(0, { type: 'patrol', units: [a.id], x: 22, y: 20 });
  let visits = 0;
  let at = 'start';
  for (let i = 0; i < 4; i++) {
    const [x, y] = at === 'start' ? [22, 20] : [10, 20];
    assert.ok(runUntil(w, () => near(a, x, y), 30) > 0, `reached ${x},${y} (leg ${i + 1})`);
    at = at === 'start' ? 'end' : 'start';
    visits++;
  }
  assert.equal(visits, 4);
  assert.equal(a.order && a.order.type, 'patrol', 'still patrolling');
  w.issueCommand(0, { type: 'stop', units: [a.id] });
  run(w, 0.2);
  assert.equal(a.order, null);
});

test('a patrol fights the enemies it meets, then carries on', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 10, 20);
  const e = spawn(w, 1, 'worshipper', 16, 20);
  w.setOrder(e, { type: 'hold', target: 0 });
  w.issueCommand(0, { type: 'patrol', units: [a.id], x: 22, y: 20 });
  assert.ok(runUntil(w, () => e.dead, 30) > 0, 'the enemy on the road is killed');
  assert.ok(runUntil(w, () => near(a, 22, 20), 30) > 0, 'then on to the far end');
  assert.ok(runUntil(w, () => near(a, 10, 20), 30) > 0, 'and back');
});

test('a group keeps its formation on the patrol, and Shift queues it from the end of the last order', () => {
  const w = arena();
  const units = [0, 1, 2].map((i) => spawn(w, 0, 'warrior', 10, 18 + i));
  w.issueCommand(0, { type: 'patrol', units: units.map((u) => u.id), x: 24, y: 19 });
  w.tick();
  const ends = units.map((u) => [u.order.x, u.order.y].join());
  assert.equal(new Set(ends).size, 3, 'each has its own slot');
  for (const u of units) assert.ok(Math.hypot(u.order.ax - u.x, u.order.ay - u.y) < 0.3, 'each comes back to where it stood');

  const b = spawn(w, 0, 'archer', 26, 8);
  w.issueCommand(0, { type: 'move', units: [b.id], x: 30, y: 8 });
  w.issueCommand(0, { type: 'patrol', units: [b.id], x: 30, y: 16, queue: true });
  w.tick();
  const p = b.orders[0];
  assert.equal(p.type, 'patrol');
  assert.deepEqual([Math.round(p.ax), Math.round(p.ay)], [30, 8], 'the queued patrol starts where the move ends');
  assert.ok(runUntil(w, () => near(b, 30, 16), 30) > 0);
  assert.ok(runUntil(w, () => near(b, 30, 8), 30) > 0);
  // A further queued order replaces the endless patrol at the end of the queue.
  w.issueCommand(0, { type: 'move', units: [b.id], x: 26, y: 8, queue: true });
  w.tick();
  assert.equal(b.order.type, 'move');
});

test('a patrol to where the unit stands is over at once', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 10, 20);
  w.issueCommand(0, { type: 'patrol', units: [a.id], x: 10.1, y: 20 });
  run(w, 0.2);
  assert.equal(a.order, null);
});

test('patrol passes the command whitelist and survives a save, tick for tick', () => {
  const map = { width: 48, height: 48 };
  assert.deepEqual(normalizeCommand({ type: 'patrol', units: [3, 3, 4], x: 99, y: 5, queue: 1 }, map), {
    ...normalizeCommand({ type: 'move', units: [3, 4], x: 48, y: 5, queue: true }, map), type: 'patrol',
  });
  const setup = {
    version: '0.1.0', seed: 11, mapSize: 'small',
    players: [
      { index: 0, name: 'A', team: 1, pantheon: 'greek', kind: 'human', difficulty: null },
      { index: 1, name: 'B', team: 2, pantheon: 'norse', kind: 'human', difficulty: null },
    ],
  };
  const world = createWorld(setup);
  const home = world.buildingList.find((b) => b.owner === 0 && b.type === 'town_center');
  const guards = [0, 1, 2].map((i) => world.spawnUnit(0, 'archer', home.x + 4, home.y + i, { silent: true }));
  world.issueCommand(0, { type: 'patrol', units: guards.map((u) => u.id), x: home.x + 4, y: home.y + 12 });
  const step = (wd) => {
    wd.tick();
    wd.events.length = 0;
    wd.felled.length = 0;
  };
  for (let i = 0; i < 20 * 7; i++) step(world);
  const loaded = unpackMatch(JSON.parse(JSON.stringify(packMatch(world, new Map())))).world;
  for (let i = 0; i < 20 * 20; i++) {
    step(world);
    step(loaded);
  }
  const where = (wd) => guards.map((g) => {
    const u = wd.entities.get(g.id);
    return [u.x, u.y, u.order && u.order.type];
  });
  assert.deepEqual(where(loaded), where(world));
  assert.ok(where(world).every((r) => r[2] === 'patrol'));
});
