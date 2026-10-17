import test from 'node:test';
import assert from 'node:assert/strict';
import { Pathfinder, PathService, lineClear, segmentClear, smoothTilePath, octile } from '../../src/sim/pathfinding.js';
import { MapState } from '../../src/sim/map-state.js';
import { makeMap, makeWorld, run, runUntil, spawn, clearUnits, place, defineUnit } from './helpers.js';

function mapWith(opts) {
  return new MapState(makeMap({ width: 40, height: 40, starts: [], mines: [], ...opts }));
}

test('A* goes around a wall and never cuts corners', () => {
  const m = mapWith({ rock: [{ x: 10, y: 0, w: 1, h: 30 }] });
  const pf = new Pathfinder(m.width, m.height);
  const res = pf.search(m.pass, 5, 5, { kind: 'tile', tx: 15, ty: 5 }, 20000);
  assert.ok(res.reached);
  let px = 5;
  let py = 5;
  for (const i of res.tiles) {
    const x = i % m.width;
    const y = (i - x) / m.width;
    assert.ok(m.pass[i], 'path tile passable');
    assert.ok(Math.abs(x - px) <= 1 && Math.abs(y - py) <= 1, 'steps are adjacent');
    if (x !== px && y !== py) assert.ok(m.pass[py * m.width + x] && m.pass[y * m.width + px], 'no corner cutting');
    px = x;
    py = y;
  }
  assert.equal(px, 15);
  assert.equal(py, 5);
  assert.ok(res.tiles.some((i) => Math.floor(i / m.width) >= 30), 'went around the bottom of the wall');
  // diagonal squeeze between two touching corners is not allowed
  const m2 = mapWith({ rock: [{ x: 5, y: 5, w: 1, h: 1 }, { x: 6, y: 6, w: 1, h: 1 }] });
  const r2 = pf.search(m2.pass, 5, 6, { kind: 'tile', tx: 6, ty: 5 }, 1000);
  assert.ok(r2.reached);
  assert.ok(r2.tiles.length > 1, 'had to walk around instead of slipping diagonally');
});

test('unreachable target returns the closest reachable tile', () => {
  // closed box around (30, 30)
  const m = mapWith({ rock: [{ x: 27, y: 27, w: 7, h: 1 }, { x: 27, y: 33, w: 7, h: 1 }, { x: 27, y: 27, w: 1, h: 7 }, { x: 33, y: 27, w: 1, h: 7 }] });
  const pf = new Pathfinder(m.width, m.height);
  const res = pf.search(m.pass, 5, 30, { kind: 'tile', tx: 30, ty: 30 }, 50000);
  assert.equal(res.reached, false);
  const last = res.tiles[res.tiles.length - 1];
  const x = last % m.width;
  assert.equal(x, 26, 'stopped just outside the west wall');
  // node cap fallback still returns a partial path toward the goal
  const capped = pf.search(m.pass, 1, 1, { kind: 'tile', tx: 38, ty: 38 }, 30);
  assert.equal(capped.reached, false);
  assert.ok(capped.tiles.length > 0);
  assert.ok(capped.expanded <= 30);
});

test('rect goals target the nearest reachable tile adjacent to the footprint', () => {
  const m = mapWith({ rock: [{ x: 20, y: 9, w: 3, h: 1 }] });
  const pf = new Pathfinder(m.width, m.height);
  // footprint 20..22 x 10..12, approached from the north side which is rock
  const res = pf.search(m.pass, 21, 3, { kind: 'rect', x0: 20, y0: 10, x1: 22, y1: 12 }, 5000);
  assert.ok(res.reached);
  const last = res.tiles[res.tiles.length - 1];
  const x = last % m.width;
  const y = (last - x) / m.width;
  const adjacent = x >= 19 && x <= 23 && y >= 9 && y <= 13 && !(x >= 20 && x <= 22 && y >= 10 && y <= 12);
  assert.ok(adjacent, `ended at ${x},${y}`);
});

test('line of sight and smoothing', () => {
  const m = mapWith({ rock: [{ x: 10, y: 10, w: 2, h: 2 }] });
  assert.equal(lineClear(m.pass, m.width, m.height, 5.5, 10.5, 15.5, 10.5), false);
  assert.equal(lineClear(m.pass, m.width, m.height, 5.5, 5.5, 15.5, 5.5), true);
  assert.equal(segmentClear(m.pass, m.width, m.height, 5.5, 9.6, 15.5, 9.6, 0.45), false, 'body too wide to pass');
  const pf = new Pathfinder(m.width, m.height);
  const res = pf.search(m.pass, 2, 2, { kind: 'tile', tx: 30, ty: 2 }, 5000);
  const pts = smoothTilePath(m.pass, m.width, m.height, 2.5, 2.5, res.tiles, 0.3, 30.5, 2.5);
  assert.deepEqual(pts, [30.5, 2.5], 'open ground is a straight line');
  const res2 = pf.search(m.pass, 8, 10, { kind: 'tile', tx: 14, ty: 11 }, 5000);
  const pts2 = smoothTilePath(m.pass, m.width, m.height, 8.5, 10.5, res2.tiles, 0.3, 14.5, 11.5);
  assert.ok(pts2.length / 2 < res2.tiles.length, 'fewer waypoints than tiles');
  let ax = 8.5;
  let ay = 10.5;
  for (let i = 0; i < pts2.length; i += 2) {
    assert.ok(segmentClear(m.pass, m.width, m.height, ax, ay, pts2[i], pts2[i + 1], 0.3));
    ax = pts2[i];
    ay = pts2[i + 1];
  }
  assert.ok(Math.abs(octile(3, 4) - (4 + (Math.SQRT2 - 1) * 3)) < 1e-12);
});

test('path service spreads requests over ticks within a node budget', () => {
  const m = mapWith({ rock: [{ x: 20, y: 0, w: 1, h: 38 }] });
  const svc = new PathService(m, 2000);
  const units = [];
  for (let i = 0; i < 20; i++) {
    const u = { x: 2.5 + (i % 5), y: 2.5 + Math.floor(i / 5), radius: 0.35, terrainR: 0.35, mv: { goal: { kind: 'tile', tx: 30, ty: 2, endX: 30.5, endY: 2.5 } } };
    units.push(u);
    svc.request(u);
  }
  svc.process();
  const done1 = units.filter((u) => !u.mv.pending).length;
  assert.ok(done1 > 0 && done1 < 20, `first tick solved ${done1}`);
  for (let i = 0; i < 40 && svc.pendingCount > 0; i++) svc.process();
  assert.ok(units.every((u) => !u.mv.pending && u.mv.complete));
});

test('a unit walks around obstacles to its destination', () => {
  const w = makeWorld({ map: { width: 48, height: 48, rock: [{ x: 24, y: 0, w: 2, h: 40 }] } });
  clearUnits(w, 0);
  const u = spawn(w, 0, 'warrior', 20, 10);
  w.issueCommand(0, { type: 'move', units: [u.id], x: 30, y: 10 });
  let insideBlocked = false;
  const t = runUntil(w, () => {
    if (!w.map.isPassable(Math.floor(u.x), Math.floor(u.y))) insideBlocked = true;
    return !u.order;
  }, 40);
  assert.ok(t > 0, 'arrived');
  assert.ok(!insideBlocked);
  assert.ok(Math.hypot(u.x - 30, u.y - 10) < 0.3);
});

test('move to an unreachable spot ends at the closest reachable point', () => {
  const w = makeWorld({ map: { width: 48, height: 48, rock: [{ x: 30, y: 20, w: 9, h: 1 }, { x: 30, y: 28, w: 9, h: 1 }, { x: 30, y: 20, w: 1, h: 9 }, { x: 38, y: 20, w: 1, h: 9 }] } });
  clearUnits(w, 0);
  const u = spawn(w, 0, 'warrior', 20, 24);
  w.issueCommand(0, { type: 'move', units: [u.id], x: 34, y: 24 });
  const t = runUntil(w, () => !u.order, 40);
  assert.ok(t > 0, 'order finished');
  assert.ok(u.x < 30 && u.x > 28, `stopped at ${u.x}`);
});

test('group move: formation, everyone arrives, no overlap, no jitter afterwards', () => {
  const w = makeWorld({ map: { width: 64, height: 64, forest: [{ x: 28, y: 10, w: 3, h: 30 }] } });
  clearUnits(w, 0);
  const units = [];
  for (let i = 0; i < 24; i++) units.push(spawn(w, 0, i % 3 === 0 ? 'archer' : 'warrior', 10 + (i % 6) * 0.9, 20 + Math.floor(i / 6) * 0.9));
  w.issueCommand(0, { type: 'move', units: units.map((u) => u.id), x: 45, y: 25 });
  let blocked = 0;
  const t = runUntil(w, () => {
    for (const u of units) if (!w.map.isPassable(Math.floor(u.x), Math.floor(u.y))) blocked++;
    return units.every((u) => !u.order);
  }, 60);
  assert.ok(t > 0, 'all arrived');
  assert.equal(blocked, 0, 'never inside forest');
  for (const u of units) assert.ok(Math.hypot(u.x - 45, u.y - 25) < 6, 'near the destination');
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i];
      const b = units[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= (a.radius + b.radius) * 0.85, 'no heavy overlap');
    }
  }
  const before = units.map((u) => [u.x, u.y]);
  run(w, 2);
  let moved = 0;
  units.forEach((u, i) => { moved = Math.max(moved, Math.hypot(u.x - before[i][0], u.y - before[i][1])); });
  assert.ok(moved < 0.05, `jitter ${moved}`);
});

test('a moving unit shoves an idle ally aside', () => {
  const w = makeWorld({ map: { width: 48, height: 48 } });
  clearUnits(w, 0);
  const idle = spawn(w, 0, 'warrior', 25, 20);
  const mover = spawn(w, 0, 'warrior', 20, 20);
  w.issueCommand(0, { type: 'move', units: [mover.id], x: 30, y: 20 });
  const t = runUntil(w, () => !mover.order, 15);
  assert.ok(t > 0 && t < 4, `took ${t}`);
  assert.ok(Math.abs(idle.y - 20) > 0.3, 'stepped aside');
  assert.ok(Math.abs(idle.x - 25) < 1.5, 'not bulldozed along');
});

test('units are pushed out of a building placed on them', () => {
  const w = makeWorld();
  clearUnits(w, 0);
  const u = spawn(w, 0, 'warrior', 21, 21);
  place(w, 0, 'barracks', 20, 20);
  w.tick();
  assert.ok(w.map.isPassable(Math.floor(u.x), Math.floor(u.y)));
});

test('air units fly straight over water and only separate from other flyers', () => {
  const flyer = defineUnit({ air: true, speed: 4 });
  const w = makeWorld({ map: { width: 48, height: 48, water: [{ x: 20, y: 0, w: 8, h: 48 }] } });
  clearUnits(w, 0);
  const a = spawn(w, 0, flyer, 15, 20);
  const g = spawn(w, 0, 'warrior', 24, 20.01);
  w.issueCommand(0, { type: 'move', units: [a.id], x: 33, y: 20 });
  let maxDev = 0;
  runUntil(w, () => {
    maxDev = Math.max(maxDev, Math.abs(a.y - 20));
    return !a.order;
  }, 10);
  assert.ok(Math.hypot(a.x - 33, a.y - 20) < 0.2);
  assert.ok(maxDev < 0.05, 'straight line');
  assert.ok(g.dead || g.x >= 0);
});

test('stuck detection gives up on a move blocked by enemies', () => {
  const w = makeWorld({ map: { width: 48, height: 48, rock: [{ x: 24, y: 0, w: 1, h: 19 }, { x: 24, y: 22, w: 1, h: 26 }] } });
  clearUnits(w, 0);
  clearUnits(w, 1);
  // plug the 3-tile gap with enemies on hold
  const plug = [];
  for (let k = 0; k < 6; k++) {
    const e = spawn(w, 1, 'battering_ram', 24.5, 19.2 + k * 0.55);
    w.setOrder(e, { type: 'hold', target: 0 });
    plug.push(e);
  }
  const u = spawn(w, 0, 'worshipper', 18, 20.5);
  w.issueCommand(0, { type: 'move', units: [u.id], x: 32, y: 20.5 });
  const t = runUntil(w, () => !u.order, 40);
  assert.ok(t > 0, 'gave up instead of trying forever');
  assert.ok(u.x < 25);
});

test('workers path to the reachable side of a mine', () => {
  const w = makeWorld({ map: { width: 48, height: 48, starts: [{ x: 6, y: 30 }, { x: 38, y: 38 }], mines: [{ tx: 20, ty: 10, amount: 5000 }, { tx: 40, ty: 30, amount: 5000 }], rock: [{ x: 18, y: 8, w: 7, h: 2 }, { x: 18, y: 8, w: 2, h: 7 }, { x: 23, y: 8, w: 2, h: 7 }] } });
  const u = w.unitsOf(0)[0];
  w.issueCommand(0, { type: 'gather', units: [u.id], target: w.mineList[0].id });
  const t = runUntil(w, () => u.carry === 'g', 40);
  assert.ok(t > 0, 'reached the open south side and mined');
});
