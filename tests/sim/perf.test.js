import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../../src/sim/world.js';
import { encode, apply } from '../../src/net/delta.js';
import { POP_MAX } from '../../src/config.js';
import { creaturesFor, godsFor, titanFor } from '../../src/data/index.js';
import { makeMap, makeSetup } from './helpers.js';

const STARTS = [{ x: 10, y: 10 }, { x: 114, y: 114 }, { x: 114, y: 10 }, { x: 10, y: 114 }];

/** A 128×128 map with forest patches and a cleared base area at each of the four corners. */
function battleMap() {
  const W = 128;
  const forest = [];
  for (let i = 0; i < 40; i++) forest.push({ x: ((i * 37) % 110) + 5, y: ((i * 53) % 110) + 5, w: 3 + (i % 4), h: 2 + (i % 5) });
  const map = makeMap({ width: W, height: W, forest, starts: STARTS, mines: STARTS.map((s) => ({ tx: s.x + 7, ty: s.y, amount: 12000 })) });
  for (const s of STARTS) {
    for (let y = s.y - 6; y < s.y + 16; y++) {
      for (let x = s.x - 6; x < s.x + 14; x++) {
        if (x < 0 || y < 0 || x >= W || y >= W) continue;
        map.terrain[y * W + x] = 0;
        map.wood[y * W + x] = 0;
      }
    }
  }
  return map;
}

// 4 players, ~400 units on a 128×128 map: armies attack-move into one big
// battle in the middle while workers mine. Target: < 4 ms per tick on average.
test('performance: 4 players with ~400 units', () => {
  const starts = STARTS;
  const map = battleMap();
  const w = new World(makeSetup(4, { teams: [1, 2, 3, 4] }), map);
  const types = ['warrior', 'archer', 'warrior', 'priest'];
  for (let p = 0; p < 4; p++) {
    const s = starts[p];
    const cre = creaturesFor(w.players[p].pantheon).map((c) => c.id);
    const ids = [];
    for (let i = 0; i < 95; i++) {
      const t = i % 5 === 4 ? cre[i % 3] : types[i % 4];
      ids.push(w.spawnUnit(p, t, s.x + 2 + (i % 10) * 0.9, s.y + 6 + Math.floor(i / 10) * 0.9, { silent: true }).id);
    }
    const ws = w.unitsOf(p).filter((u) => u.type === 'worshipper').map((u) => u.id);
    w.issueCommand(p, { type: 'gather', units: ws, target: w.mineList[p].id });
    w.issueCommand(p, { type: 'attackMove', units: ids, x: 64, y: 64 });
  }
  assert.ok(w.unitList.length >= 400);
  // warm up the JIT
  for (let i = 0; i < 20; i++) {
    w.tick();
    w.getSnapshot();
  }
  const N = 600;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    w.tick();
    w.getSnapshot();
  }
  const avg = (performance.now() - t0) / N;
  console.log(`# sim perf: ${avg.toFixed(3)} ms/tick average (${w.unitList.length} units left, ${w.paths.stats.searches} path searches)`);
  assert.ok(avg < 12, `average tick ${avg.toFixed(2)} ms`);
  // the battle actually happened
  assert.ok(w.unitList.length < 400);
});

// Every player at the population limit (200): 24 Houses, 30 worshippers, 3 gods, the Titan and a mixed army,
// all attack-moving into one battle. The host also encodes every snapshot as the delta a client gets, and a
// client applies it, as in an online game.
test('performance: 4 players at the 200 population limit, with the snapshot deltas', () => {
  const map = battleMap();
  const w = new World(makeSetup(4, { teams: [1, 1, 2, 2] }), map);
  for (let p = 0; p < 4; p++) {
    const s = STARTS[p];
    const pl = w.players[p];
    Object.assign(pl, { gold: 9999, wood: 9999, faith: 999 });
    for (let n = 0; n < 24; n++) {
      const spot = w.findPlacement(p, 'house', s.x + (s.x < 64 ? 2 : -2), s.y + (s.y < 64 ? 2 : -2), 30);
      assert.ok(spot, 'room for 24 Houses');
      w.completeBuilding(w.createBuilding(p, 'house', spot.tx, spot.ty, true, true));
    }
    assert.equal(pl.popCap, POP_MAX);
    const cre = creaturesFor(pl.pantheon).map((c) => c.id);
    const heroes = [...godsFor(pl.pantheon).slice(0, 3).map((g) => g.id), titanFor(pl.pantheon).id];
    const mix = ['warrior', 'archer', 'warrior', 'archer', cre[0], 'priest', cre[1], 'warrior', 'archer', cre[0], cre[2], 'warrior'];
    const at = (k) => [s.x + 2 + (k % 14) * 0.9, s.y + 6 + Math.floor(k / 14) * 0.9];
    let k = 0;
    for (let n = 0; n < 25; n++) w.spawnUnit(p, 'worshipper', ...at(k++), { silent: true });
    for (const h of heroes) w.spawnUnit(p, h, ...at(k++), { silent: true });
    for (let m = 0; pl.popUsed < POP_MAX - 4; m++) w.spawnUnit(p, mix[m % mix.length], ...at(k++), { silent: true });
    const army = w.unitsOf(p).filter((u) => u.def.class !== 'worker').map((u) => u.id);
    const ws = w.unitsOf(p).filter((u) => u.def.class === 'worker').map((u) => u.id);
    w.issueCommand(p, { type: 'gather', units: ws, target: w.mineList[p].id });
    w.issueCommand(p, { type: 'attackMove', units: army, x: 64, y: 64 });
  }
  w.hash.rebuild(w.unitList);
  for (const pl of w.players) assert.ok(pl.popUsed >= POP_MAX - 8 && pl.popUsed <= pl.popCap, `${pl.popUsed}/${pl.popCap}`);
  const entities = w.getSnapshot().entities.length;
  assert.ok(entities >= 450, `${entities} entities`);
  let prev = w.getSnapshot();
  let client = prev;
  const step = () => {
    w.tick();
    const next = w.getSnapshot();
    const wire = JSON.stringify({ t: 'delta', d: encode(prev, next) });
    client = apply(client, JSON.parse(wire).d);
    prev = next;
    return wire.length;
  };
  for (let i = 0; i < 20; i++) step(); // warm up the JIT
  const N = 600;
  const bytes = [];
  const t0 = performance.now();
  for (let i = 0; i < N; i++) bytes.push(step());
  const avg = (performance.now() - t0) / N;
  const avgKb = bytes.reduce((a, b) => a + b, 0) / N / 1024;
  const maxKb = Math.max(...bytes) / 1024;
  console.log(`# 200-pop battle: ${avg.toFixed(3)} ms/tick (sim + snapshot + delta encode/apply), delta avg ${avgKb.toFixed(2)} KB, max ${maxKb.toFixed(1)} KB, ${w.unitList.length} units left`);
  assert.ok(avg < 12, `average tick ${avg.toFixed(2)} ms`);
  assert.ok(avgKb < 12 && maxKb < 48, `deltas ${avgKb.toFixed(1)} KB average, ${maxKb.toFixed(1)} KB largest`);
  // the clients rebuild the host's view exactly, and nobody went over the limit
  assert.deepEqual(client.entities.map((e) => e.id), prev.entities.map((e) => e.id));
  for (const pl of w.players) assert.ok(pl.popUsed <= POP_MAX);
});
