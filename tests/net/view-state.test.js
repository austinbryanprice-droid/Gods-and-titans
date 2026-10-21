import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { makeFakeMap } from '../../src/net/fake-world.js';
import { TERRAIN, TREE_WOOD } from '../../src/config.js';

const W = 48;
const setup = {
  version: '0.1.0', seed: 1, mapSize: 'small',
  players: [
    { index: 0, name: 'Me', team: 1, pantheon: 'greek', color: '#d63a3a', kind: 'human' },
    { index: 1, name: 'Foe', team: 2, pantheon: 'norse', color: '#3a78d6', kind: 'ai' },
    { index: 2, name: 'Pal', team: 1, pantheon: 'egyptian', color: '#2fb85c', kind: 'human' },
  ],
};
const players = setup.players.map((p) => ({ i: p.index, name: p.name, team: p.team, defeated: false }));

const unit = (id, o, x, y, extra = {}) => ({ id, k: 'u', t: 'warrior', o, x, y, f: 0, hp: 420, mhp: 420, sh: 0, st: 'idle', tg: 0, c: 0, cd: {}, fx: [], ...extra });
const house = (id, o, tx, ty) => ({ id, k: 'b', t: 'house', o, x: tx + 1, y: ty + 1, f: 0, hp: 500, mhp: 500, sh: 0, st: 'idle', tg: 0, tx, ty, bp: 1, q: [], rp: null });
let tick = 0;
const snap = (entities, extra = {}) => {
  tick++;
  return { tick, time: tick * 0.05, players, entities, fields: [], reveals: [], events: [], felled: [], gameOver: null, ...extra };
};

function makeVS(opts = {}) {
  tick = 0;
  return new ViewState({ setup, mapData: makeFakeMap(W, W), myIndex: 0, ...opts });
}

test('fog of war: own and allied sight, reveals, explored memory', () => {
  const vs = makeVS();
  vs.pushSnapshot(snap([unit(1, 0, 10.5, 10.5), unit(2, 2, 30.5, 10.5), unit(3, 1, 11.5, 11.5), unit(4, 1, 40.5, 40.5)], {
    reveals: [{ x: 40, y: 30, r: 3, tm: 1, rem: 5 }, { x: 5, y: 40, r: 3, tm: 2, rem: 5 }],
  }), 0);
  assert.ok(vs.isVisibleAt(10.5, 10.5));
  assert.ok(vs.isVisibleAt(10.5 + 7.5, 10.5), 'warrior sight 8');
  assert.ok(!vs.isVisibleAt(10.5 + 9, 10.5));
  assert.ok(vs.isVisibleAt(30.5, 10.5), 'allied vision is shared');
  assert.ok(vs.isVisibleAt(40, 30), 'my team’s reveal');
  assert.ok(!vs.isVisibleAt(5, 40), 'the enemy team’s reveal is not mine');
  assert.ok(vs.isEntityVisible(vs.getEntity(3)), 'enemy next to my unit');
  assert.ok(!vs.isEntityVisible(vs.getEntity(4)), 'enemy in the dark');
  assert.ok(vs.isEntityVisible(vs.getEntity(2)), 'allies always');
  assert.equal(vs.relation(0), 'own');
  assert.equal(vs.relation(2), 'ally');
  assert.equal(vs.relation(1), 'enemy');
  assert.equal(vs.relation(-1), 'neutral');
  assert.equal(vs.myTeam, 1);
  assert.equal(vs.me.name, 'Me');

  // My unit walks away: the old area stays explored but is no longer visible.
  vs.pushSnapshot(snap([unit(1, 0, 30.5, 30.5)]), 50);
  assert.ok(!vs.isVisibleAt(10.5, 10.5));
  assert.ok(vs.isExplored(10, 10));
  assert.ok(!vs.isExplored(2, 45));
  assert.ok(vs.isVisibleAt(30.5, 30.5));
  assert.equal(vs.entities.size, 1, 'removed entities are dropped');
  assert.equal(vs.getEntity(3), null);
});

test('lastSeen keeps enemy buildings under fog until the spot is seen again', () => {
  const vs = makeVS();
  const enemyHouse = house(10, 1, 14, 10);
  vs.pushSnapshot(snap([unit(1, 0, 10.5, 10.5), enemyHouse, house(11, 2, 12, 14)]), 0);
  assert.ok(vs.lastSeen.has(10));
  assert.ok(!vs.lastSeen.has(11), 'allied buildings are not remembered');
  assert.equal(vs.lastSeen.get(10).hp, 500);

  // Walk away; the house is damaged and then destroyed out of sight.
  vs.pushSnapshot(snap([unit(1, 0, 40.5, 40.5), { ...enemyHouse, hp: 100 }]), 50);
  assert.equal(vs.lastSeen.get(10).hp, 500, 'remembered as last seen');
  vs.pushSnapshot(snap([unit(1, 0, 40.5, 40.5)]), 100);
  assert.ok(vs.lastSeen.has(10), 'still remembered: we did not see it fall');
  vs.update(400);
  assert.equal(vs.lastSeen.get(10).ix, 15);

  // Come back: we see it is gone.
  vs.pushSnapshot(snap([unit(1, 0, 13.5, 11.5)]), 150);
  assert.ok(!vs.lastSeen.has(10));
});

test('interpolation renders interpDelayMs behind, wraps facing, snaps teleports', () => {
  const vs = makeVS({ interpDelayMs: 100 });
  // Sim time 0.05 / 0.10 / 0.15 arrive at local 1050 / 1100 / 1150 (offset 1000).
  vs.pushSnapshot(snap([unit(1, 0, 10, 10, { f: 3.0 }), unit(2, 0, 20, 20)]), 1050);
  vs.pushSnapshot(snap([unit(1, 0, 11, 10, { f: -3.0 }), unit(2, 0, 30, 20)]), 1100);
  vs.update(1000 + 75 + 100); // offset 1000, render sim time 75 ms → halfway between the two
  const e = vs.getEntity(1);
  assert.ok(Math.abs(e.ix - 10.5) < 1e-9, `ix ${e.ix}`);
  assert.equal(e.iy, 10);
  assert.ok(Math.abs(Math.abs(e.if) - Math.PI) < 0.02, `facing takes the short way round (${e.if})`);
  assert.ok(Math.abs(vs.renderTime - 0.075) < 1e-9);
  const t = vs.getEntity(2);
  assert.ok(t.ix === 20 || t.ix === 30, 'a 10-tile jump is not smeared');
  vs.update(0);
  assert.equal(e.ix, 10, 'before the oldest sample');
  vs.update(5000);
  assert.equal(e.ix, 11, 'after the newest sample');
  assert.equal(e.x, 11, 'raw snapshot fields are kept');

  // A late snapshot (jitter) barely moves the clock; an early one lowers the latency estimate at once.
  vs.pushSnapshot(snap([unit(1, 0, 12, 10)]), 1190); // sim 150 ms, 40 ms late
  assert.equal(vs.clockOffset, 1002);
  vs.pushSnapshot(snap([unit(1, 0, 13, 10)]), 1180); // sim 200 ms, 20 ms early
  assert.equal(vs.clockOffset, 980);
  vs.pushSnapshot(snap([unit(1, 0, 14, 10)]), 9000); // a long stall: resynchronize
  assert.equal(vs.clockOffset, 9000 - 250);
});

test('persistent entity objects drop fields that disappear and keep ix/iy', () => {
  const vs = makeVS();
  vs.pushSnapshot(snap([unit(1, 0, 5, 5, { bo: { b: 'house', tx: 3, ty: 3 }, lv: 2 })]), 0);
  const obj = vs.getEntity(1);
  assert.deepEqual(obj.bo, { b: 'house', tx: 3, ty: 3 });
  vs.pushSnapshot(snap([unit(1, 0, 6, 5)]), 50);
  assert.equal(vs.getEntity(1), obj, 'same object across snapshots');
  assert.ok(!('bo' in obj) && !('lv' in obj));
  assert.ok('ix' in obj && 'iy' in obj && 'if' in obj);
  assert.equal(obj.x, 6);
});

test('felled trees update the map and fire treeFelled exactly once', () => {
  const vs = makeVS();
  const fired = [];
  vs.on('treeFelled', (ev) => fired.push(ev));
  const i = (tx, ty) => ty * W + tx;
  assert.equal(vs.map.terrain[i(1, 1)], TERRAIN.FOREST);
  assert.equal(vs.map.wood[i(1, 1)], TREE_WOOD);
  // With an event from the sim.
  vs.pushSnapshot(snap([], { felled: [[1, 1]], events: [{ type: 'treeFelled', tx: 1, ty: 1 }] }), 0);
  assert.equal(vs.map.terrain[i(1, 1)], TERRAIN.GRASS);
  assert.equal(vs.map.wood[i(1, 1)], 0);
  assert.equal(fired.length, 1);
  // Only in `felled` (no event): a synthetic event.
  vs.pushSnapshot(snap([], { felled: [[2, 1]] }), 50);
  assert.equal(fired.length, 2);
  assert.deepEqual(fired[1], { type: 'treeFelled', tx: 2, ty: 1 });
  // Resync felledAll: only trees we did not know about yet.
  const v0 = vs.mapVersion;
  vs.pushSnapshot(snap([]), 100, { felledAll: [[1, 1], [2, 1], [3, 1], [4, 2]] });
  assert.equal(fired.length, 4);
  assert.ok(fired.slice(2).every((e) => e.sync === true));
  assert.equal(vs.mapVersion, v0 + 2);
  assert.equal(vs.felledAll.length, 4);
  // The original map data is untouched.
  const fresh = makeFakeMap(W, W);
  assert.equal(fresh.terrain[i(1, 1)], TERRAIN.FOREST);
});

test('event bus: per type, wildcard, snapshot, unsubscribe; defeat reveals the map', () => {
  const vs = makeVS();
  const deaths = [];
  const all = [];
  const snaps = [];
  const off = vs.on('death', (e) => deaths.push(e.id));
  vs.on('*', (e) => all.push(e.type));
  vs.on('snapshot', (s) => snaps.push(s.tick));
  vs.on('hit', () => {
    throw new Error('listener bug');
  });
  const orig = console.error;
  console.error = () => {};
  vs.pushSnapshot(snap([], { events: [{ type: 'death', id: 7, x: 1, y: 1 }, { type: 'hit', dst: 1, amount: 3 }] }), 0);
  console.error = orig;
  assert.deepEqual(deaths, [7]);
  assert.deepEqual(all, ['death', 'hit'], 'a throwing listener does not stop the others');
  assert.deepEqual(snaps, [1]);
  off();
  vs.pushSnapshot(snap([], { events: [{ type: 'death', id: 8 }] }), 50);
  assert.deepEqual(deaths, [7]);
  assert.equal(all.length, 3);

  assert.ok(!vs.isVisibleAt(40, 40));
  vs.pushSnapshot(snap([], { players: players.map((p) => (p.i === 0 ? { ...p, defeated: true } : p)) }), 100);
  assert.ok(vs.isVisibleAt(40, 40), 'defeated players watch the whole map');
  vs.pushSnapshot(snap([], { gameOver: { winningTeam: 2 } }), 150);
  assert.deepEqual(vs.gameOver, { winningTeam: 2 });
  assert.ok(vs.revealAll);
});

test('Decade of Peace: the clock follows the snapshots, and only creatures and (after it) rivals may be hurt', () => {
  const peaceful = { ...setup, peaceMinutes: 30 };
  const vs = makeVS({ setup: peaceful });
  assert.equal(vs.peaceLeft(), 1800);
  assert.equal(vs.peaceActive(), true);
  assert.equal(vs.canHarm(1), false, 'a rival is protected');
  assert.equal(vs.canHarm(-1), true, 'creatures are not');
  assert.equal(vs.canHarm(0), false, 'my own units are not a target');
  assert.equal(vs.canHarm(2), false, 'nor are my allies');
  assert.equal(vs.canHarm(undefined), false);
  vs.pushSnapshot(snap([unit(1, 0, 10.5, 10.5)], { time: 1799.95 }), 0);
  assert.ok(Math.abs(vs.peaceLeft() - 0.05) < 1e-9);
  assert.equal(vs.peaceActive(), true);
  vs.pushSnapshot(snap([unit(1, 0, 10.5, 10.5)], { time: 1800 }), 50);
  assert.equal(vs.peaceLeft(), 0);
  assert.equal(vs.peaceActive(), false);
  assert.equal(vs.canHarm(1), true, 'the peace is over');
  assert.equal(vs.canHarm(2), false);
  vs.pushSnapshot(snap([unit(1, 0, 10.5, 10.5)], { time: 5000 }), 100);
  assert.equal(vs.peaceLeft(), 0, 'never negative');

  const normal = makeVS();
  assert.equal(normal.peaceLeft(), 0);
  assert.equal(normal.peaceActive(), false);
  assert.equal(normal.canHarm(1), true);
  assert.equal(normal.canHarm(-1), true);
  const odd = makeVS({ setup: { ...setup, peaceMinutes: 31 } });
  assert.equal(odd.peaceActive(), false, 'only a length the lobby offers counts, as in the sim');
});
