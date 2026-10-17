import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { generateMap } from '../../src/sim/mapgen.js';
import { makeSetup, run } from './helpers.js';

function setupFor(n, mapSize, seed) {
  const s = makeSetup(n, { seed });
  s.mapSize = mapSize;
  return s;
}

for (const [n, size] of [[2, 'small'], [4, 'medium']]) {
  test(`createWorld with mapgen: ${n} players on ${size}`, () => {
    const setup = setupFor(n, size, 777);
    const w = createWorld(setup);
    const map = generateMap({ seed: 777, mapSize: size, playerCount: n });
    assert.equal(w.map.width, map.width);
    for (let i = 0; i < n; i++) {
      const tc = w.buildingsOf(i)[0];
      assert.equal(tc.type, 'town_center');
      assert.equal(tc.tx, Math.floor(map.starts[i].x));
      assert.equal(tc.ty, Math.floor(map.starts[i].y));
      const ws = w.unitsOf(i);
      assert.equal(ws.length, 5);
      for (const u of ws) assert.ok(w.map.isPassable(Math.floor(u.x), Math.floor(u.y)));
      const mine = w.mineList[i];
      assert.equal(mine.tx, map.mines[i].tx);
    }
    assert.equal(w.camps.length, map.camps.length);
    for (const c of w.camps) assert.ok(c.members.length >= 2);

    // Everyone mines their start mine and chops the nearest forest for a minute.
    for (let i = 0; i < n; i++) {
      const ws = w.unitsOf(i);
      w.issueCommand(i, { type: 'gather', units: ws.slice(0, 3).map((u) => u.id), target: w.mineList[i].id });
      const tc = w.buildingsOf(i)[0];
      const tree = w.map.nearestForest(tc.x, tc.y, 20, true);
      assert.ok(tree, 'a forest near the start');
      w.issueCommand(i, { type: 'gather', units: ws.slice(3).map((u) => u.id), tx: tree.tx, ty: tree.ty });
    }
    let blocked = 0;
    for (let t = 0; t < 60 * 20; t++) {
      w.tick();
      if (t % 10 === 0) for (const u of w.unitList) if (!u.air && !w.map.isPassable(Math.floor(u.x), Math.floor(u.y))) blocked++;
    }
    assert.equal(blocked, 0, 'no unit ever stood in a blocked tile');
    for (let i = 0; i < n; i++) {
      assert.ok(w.players[i].gold > 600, `player ${i} gold ${w.players[i].gold}`);
      assert.ok(w.players[i].wood > 260, `player ${i} wood ${w.players[i].wood}`);
    }
    assert.doesNotThrow(() => JSON.stringify(w.getSnapshot()));
  });
}

test('createWorld is deterministic for a seed', () => {
  const a = createWorld(setupFor(2, 'small', 4242));
  const b = createWorld(setupFor(2, 'small', 4242));
  for (const w of [a, b]) {
    const ws = w.unitsOf(0);
    w.issueCommand(0, { type: 'gather', units: ws.map((u) => u.id), target: w.mineList[0].id });
    run(w, 20);
  }
  assert.equal(JSON.stringify(a.getSnapshot()), JSON.stringify(b.getSnapshot()));
});
