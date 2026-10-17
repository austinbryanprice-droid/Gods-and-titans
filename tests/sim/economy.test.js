import test from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN, CARRY_AMOUNT, TREE_WOOD, MINE_SLOTS, MINE_TIME, TICK_RATE } from '../../src/config.js';
import { activeMiners } from '../../src/sim/economy.js';
import { distPointRect } from '../../src/sim/common.js';
import { makeWorld, run, runCollect, runUntil, place, eventsOf, errorsOf, spawn } from './helpers.js';

function workers(world, p = 0) {
  return world.unitsOf(p).filter((u) => u.type === 'worshipper');
}

test('start state: town center, 5 worshippers, resources, pop', () => {
  const w = makeWorld();
  const p = w.players[0];
  assert.equal(p.gold, 400);
  assert.equal(p.wood, 200);
  assert.equal(p.faith, 50);
  assert.equal(workers(w).length, 5);
  assert.equal(w.buildingsOf(0).length, 1);
  const tc = w.buildingsOf(0)[0];
  assert.equal(tc.type, 'town_center');
  assert.equal(tc.tx, 6);
  assert.equal(tc.ty, 6);
  assert.ok(tc.constructed);
  assert.equal(p.popCap, 12);
  assert.equal(p.popUsed, 5);
  assert.equal(p.tier, 1);
  for (const u of workers(w)) assert.ok(w.map.isPassable(Math.floor(u.x), Math.floor(u.y)));
});

test('gold gathering raises gold and lowers the mine', () => {
  const w = makeWorld();
  const mine = w.mineList[0];
  const ws = workers(w);
  w.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: mine.id });
  run(w, 2);
  assert.ok(ws.every((u) => u.state === 'gather' || u.state === 'return'));
  run(w, 28);
  const gained = w.players[0].gold - 400;
  assert.ok(gained >= 200, `gained ${gained}`);
  assert.equal(gained % CARRY_AMOUNT, 0);
  assert.equal(mine.amount, 12000 - gained - ws.reduce((s, u) => s + (u.carry === 'g' ? u.carryAmount : 0), 0));
  assert.equal(w.players[0].stats.gathered, gained);
});

test('workers ghost through units while gathering', () => {
  const w = makeWorld();
  const ws = workers(w);
  w.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: w.mineList[0].id });
  run(w, 5);
  assert.ok(ws.some((u) => u.ghost));
});

test('mine depletion removes the mine with resourceDepleted', () => {
  const w = makeWorld();
  const mine = w.mineList[0];
  mine.amount = 20;
  const ws = workers(w);
  w.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: mine.id });
  const ev = runCollect(w, 15);
  assert.equal(eventsOf(ev, 'resourceDepleted').length, 1);
  assert.equal(w.getEntity(mine.id), null);
  assert.equal(w.players[0].gold, 420);
  assert.ok(w.map.isPassable(mine.tx + 1, mine.ty + 1));
});

test('wood gathering raises wood; trees fell and become passable', () => {
  const w = makeWorld({ map: { forest: [{ x: 4, y: 14, w: 3, h: 1 }] } });
  const ws = workers(w).slice(0, 3);
  // a tree with little wood so it falls quickly
  w.map.wood[14 * w.map.width + 5] = 3;
  w.issueCommand(0, { type: 'smart', units: ws.map((u) => u.id), x: 5.5, y: 14.5, tx: 5, ty: 14 });
  const ev = runCollect(w, 40);
  assert.ok(w.players[0].wood > 200, `wood ${w.players[0].wood}`);
  const felled = eventsOf(ev, 'treeFelled');
  assert.ok(felled.some((e) => e.tx === 5 && e.ty === 14));
  assert.equal(w.map.terrain[14 * w.map.width + 5], TERRAIN.GRASS);
  assert.ok(w.map.isPassable(5, 14));
  assert.ok(!w.map.isForest(5, 14));
  const snap = w.getSnapshot();
  assert.ok(Array.isArray(snap.felled));
  assert.ok(w.felledAll.some(([x, y]) => x === 5 && y === 14));
});

test('wood: worker chops 10 then returns, the rest of the tree remains', () => {
  const w = makeWorld({ map: { forest: [{ x: 6, y: 13, w: 1, h: 1 }] } });
  const u = workers(w)[0];
  w.issueCommand(0, { type: 'gather', units: [u.id], tx: 6, ty: 13 });
  const t = runUntil(w, () => u.carry === 'w' && u.carryAmount === CARRY_AMOUNT, 30);
  assert.ok(t > 0);
  assert.equal(w.map.woodAt(6, 13), TREE_WOOD - CARRY_AMOUNT);
  runUntil(w, () => w.players[0].wood === 210, 20);
  assert.equal(w.players[0].wood, 210);
});

test('return cargo command deposits and resumes gathering', () => {
  const w = makeWorld();
  const u = workers(w)[0];
  const mine = w.mineList[0];
  w.issueCommand(0, { type: 'gather', units: [u.id], target: mine.id });
  runUntil(w, () => u.carry === 'g', 20);
  w.issueCommand(0, { type: 'stop', units: [u.id] });
  run(w, 0.1);
  assert.equal(u.carry, 'g');
  w.issueCommand(0, { type: 'returnCargo', units: [u.id] });
  runUntil(w, () => u.carry === 0, 20);
  assert.equal(w.players[0].gold, 410);
  run(w, 0.5);
  assert.equal(u.order && u.order.type, 'gather');
});

test('faith accrues from praying worshippers; shrine full error', () => {
  const w = makeWorld();
  const shrine = place(w, 0, 'shrine', 12, 12);
  const extra = [];
  for (let i = 0; i < 2; i++) extra.push(spawn(w, 0, 'worshipper', 12 + i, 16));
  const ws = [...workers(w)];
  assert.equal(ws.length, 7);
  w.issueCommand(0, { type: 'pray', units: ws.slice(0, 5).map((u) => u.id), target: shrine.id });
  run(w, 6);
  const praying = ws.slice(0, 5).filter((u) => u.state === 'pray').length;
  assert.equal(praying, 5);
  assert.equal(shrine.prayingCount, 5);
  const f0 = w.players[0].faith;
  run(w, 10);
  const gained = w.players[0].faith - f0;
  assert.ok(Math.abs(gained - 5 * 0.5 * 10) < 0.6, `gained ${gained}`);
  assert.equal(w.getSnapshot().players[0].faithRate, 2.5);
  w.events.length = 0;
  w.issueCommand(0, { type: 'smart', units: [ws[5].id], target: shrine.id, x: shrine.x, y: shrine.y });
  w.tick();
  assert.deepEqual(errorsOf(w.events), ['This shrine is full.']);
  // Praying continues until another order; a new order frees the slot.
  w.issueCommand(0, { type: 'move', units: [ws[0].id], x: 20, y: 20 });
  w.tick();
  w.events.length = 0;
  w.issueCommand(0, { type: 'pray', units: [ws[5].id], target: shrine.id });
  w.tick();
  assert.deepEqual(errorsOf(w.events), []);
  assert.equal(ws[5].order.type, 'pray');
  const snap = w.getSnapshot();
  const view = snap.entities.find((e) => e.id === shrine.id);
  assert.equal(typeof view.pr, 'number');
});

test('temple prays at 0.7 faith/s per worshipper', () => {
  const w = makeWorld();
  place(w, 0, 'shrine', 20, 20);
  const temple = place(w, 0, 'temple', 12, 12);
  const u = workers(w)[0];
  w.issueCommand(0, { type: 'smart', units: [u.id], target: temple.id, x: temple.x, y: temple.y });
  runUntil(w, () => u.state === 'pray', 10);
  const f0 = w.players[0].faith;
  run(w, 10);
  assert.ok(Math.abs(w.players[0].faith - f0 - 7) < 0.2);
});

// ---- Gold mine slots (DESIGN 5.2): MINE_SLOTS concurrent miners, MINE_TIME per trip, FIFO wait at own spot ----

function goldCrew(w, n) {
  const tc = w.buildingsOf(0)[0];
  const ws = workers(w);
  while (ws.length < n) ws.push(spawn(w, 0, 'worshipper', tc.x, tc.ty + tc.size + 0.6));
  return ws.slice(0, n);
}

function mineEdge(u, m) {
  return distPointRect(u.x, u.y, m.tx, m.ty, m.tx + m.size, m.ty + m.size);
}

test('gold: at most MINE_SLOTS workers mine at once; the rest wait next to the mine', () => {
  const w = makeWorld();
  const mine = w.mineList[0];
  const ws = goldCrew(w, 8);
  w.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: mine.id });
  let maxActive = 0;
  let waits = 0;
  for (let i = 0; i < 30 * TICK_RATE; i++) {
    w.tick();
    const n = activeMiners(w, mine);
    assert.ok(n <= MINE_SLOTS, `tick ${i}: ${n} miners`);
    maxActive = Math.max(maxActive, n);
    assert.ok(ws.filter((u) => u.order.phase === 'work').length <= MINE_SLOTS);
    for (const u of ws) {
      assert.ok(u.state === 'gather' || u.state === 'return', `state ${u.state}`);
      if (u.order.phase !== 'wait') continue;
      waits++;
      assert.equal(u.mv, null, 'a waiting worker stands still');
      assert.ok(mineEdge(u, mine) - u.radius < 0.3, `waits ${mineEdge(u, mine).toFixed(2)} from the mine`);
    }
  }
  assert.equal(maxActive, MINE_SLOTS);
  assert.ok(waits > 100, `waiting ticks ${waits}`);
});

test('gold: workers stand on their own spots around the mine edge', () => {
  const w = makeWorld();
  const mine = w.mineList[0];
  const ws = goldCrew(w, 8);
  w.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: mine.id });
  let checked = 0;
  for (let i = 0; i < 20 * TICK_RATE; i++) {
    w.tick();
    const at = ws.filter((u) => u.order.phase === 'wait' || u.order.phase === 'work');
    for (let a = 0; a < at.length; a++) {
      for (let b = a + 1; b < at.length; b++) {
        const d = Math.hypot(at[a].x - at[b].x, at[a].y - at[b].y);
        assert.ok(d > 0.5, `workers ${at[a].id} and ${at[b].id} ${d.toFixed(2)} apart`);
        assert.notEqual(at[a].order.spot, at[b].order.spot);
        checked++;
      }
    }
  }
  assert.ok(checked > 200, `pairs ${checked}`);
  // The first spots taken face the Town Center (west of the mine).
  assert.ok(ws.every((u) => u.order.spot >= 0 && mine.spots[u.order.spot].x <= mine.x + 0.5));
});

test('gold: waiting workers take free slots in arrival order (FIFO)', () => {
  const w = makeWorld();
  const mine = w.mineList[0];
  const ws = goldCrew(w, 7);
  w.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: mine.id });
  const since = new Map();
  let starts = 0;
  for (let i = 0; i < 40 * TICK_RATE; i++) {
    const prev = new Map(ws.map((u) => [u.id, u.order && u.order.phase]));
    w.tick();
    for (const u of ws) {
      const ph = u.order.phase;
      if (ph === 'wait' && prev.get(u.id) !== 'wait') since.set(u.id, i);
    }
    for (const u of ws) {
      if (u.order.phase !== 'work' || prev.get(u.id) === 'work') continue;
      const mine0 = since.has(u.id) ? since.get(u.id) : i;
      for (const v of ws) {
        if (v.order.phase === 'wait') assert.ok(since.get(v.id) >= mine0, `worker ${u.id} started before ${v.id}, who waited longer`);
      }
      since.delete(u.id);
      starts++;
    }
  }
  assert.ok(starts > 40, `trips started ${starts}`);
});

test('gold: one trip takes MINE_TIME; rate ≈ 3 g/s per worker, one mine caps at MINE_SLOTS×10/MINE_TIME', () => {
  const cap = (MINE_SLOTS * CARRY_AMOUNT) / MINE_TIME;
  const rate = (n) => {
    const w = makeWorld();
    const ws = goldCrew(w, n);
    w.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: w.mineList[0].id });
    run(w, 15);
    const g0 = w.players[0].gold;
    run(w, 60);
    return (w.players[0].gold - g0) / 60;
  };
  const r1 = rate(1);
  assert.ok(r1 >= 2.5 && r1 <= 3.6, `1 worker ${r1} g/s`);
  const r2 = rate(2);
  assert.ok(Math.abs(r2 - 2 * r1) < 0.4, `2 workers ${r2} g/s`);
  for (const n of [8, 12]) {
    const r = rate(n);
    assert.ok(r <= cap + 0.2 && r >= cap - 0.4, `${n} workers ${r} g/s, cap ${cap}`);
  }
  // A single trip: wait ends → MINE_TIME of mining → 10 gold carried.
  const w = makeWorld();
  const [u] = goldCrew(w, 1);
  w.issueCommand(0, { type: 'gather', units: [u.id], target: w.mineList[0].id });
  runUntil(w, () => u.order.phase === 'work', 20);
  const t = runUntil(w, () => u.carry === 'g', 5);
  assert.ok(Math.abs(t - MINE_TIME) < 1e-9, `trip ${t} s`);
  assert.equal(u.carryAmount, CARRY_AMOUNT);
});

test('gold: a miner that leaves frees its slot for the next waiter; mn in the snapshot', () => {
  const w = makeWorld();
  const mine = w.mineList[0];
  const ws = goldCrew(w, 3);
  w.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: mine.id });
  assert.ok(runUntil(w, () => ws.filter((u) => u.order.phase === 'work').length === 2 && ws.some((u) => u.order.phase === 'wait'), 20) > 0);
  const view = () => w.getSnapshot().entities.find((e) => e.id === mine.id);
  assert.equal(view().mn, 2);
  const waiter = ws.find((u) => u.order.phase === 'wait');
  const miner = ws.find((u) => u.order.phase === 'work');
  w.issueCommand(0, { type: 'move', units: [miner.id], x: 30, y: 30 });
  run(w, 0.15);
  assert.equal(waiter.order.phase, 'work');
  assert.equal(activeMiners(w, mine), 2);
  // Killing a miner frees its slot too.
  w.killEntity(waiter, null);
  w.tick();
  assert.equal(activeMiners(w, mine), 1);
  assert.equal(view().mn, 1);
  assert.equal(typeof view().mn, 'number');
});

test('gold: enemy workers share the same slots of a mine', () => {
  const w = makeWorld();
  const mine = w.mineList[0];
  const ws = goldCrew(w, 3);
  const foes = [spawn(w, 1, 'worshipper', mine.x + 3, mine.y + 2), spawn(w, 1, 'worshipper', mine.x + 3, mine.y - 1)];
  w.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: mine.id });
  w.issueCommand(1, { type: 'gather', units: foes.map((u) => u.id), target: mine.id });
  for (let i = 0; i < 20 * TICK_RATE; i++) {
    w.tick();
    assert.ok(activeMiners(w, mine) <= MINE_SLOTS);
  }
  assert.ok(w.players[1].gold > 0 && w.players[0].gold > 400);
});
