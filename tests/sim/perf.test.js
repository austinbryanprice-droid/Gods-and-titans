import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../../src/sim/world.js';
import { creaturesFor } from '../../src/data/index.js';
import { makeMap, makeSetup } from './helpers.js';

// 4 players, ~400 units on a 128×128 map: armies attack-move into one big
// battle in the middle while workers mine. Target: < 4 ms per tick on average.
test('performance: 4 players with ~400 units', () => {
  const W = 128;
  const forest = [];
  for (let i = 0; i < 40; i++) forest.push({ x: ((i * 37) % 110) + 5, y: ((i * 53) % 110) + 5, w: 3 + (i % 4), h: 2 + (i % 5) });
  const starts = [{ x: 10, y: 10 }, { x: 114, y: 114 }, { x: 114, y: 10 }, { x: 10, y: 114 }];
  const map = makeMap({ width: W, height: W, forest, starts, mines: starts.map((s) => ({ tx: s.x + 7, ty: s.y, amount: 12000 })) });
  for (const s of starts) {
    for (let y = s.y - 6; y < s.y + 16; y++) {
      for (let x = s.x - 6; x < s.x + 14; x++) {
        if (x < 0 || y < 0 || x >= W || y >= W) continue;
        map.terrain[y * W + x] = 0;
        map.wood[y * W + x] = 0;
      }
    }
  }
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
