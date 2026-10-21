// The AI against walls (DESIGN 10): it never targets wall segments, and an army shut out of a
// walled base breaks through instead of standing at the wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { TICK_RATE } from '../../src/config.js';
import { worldDigest } from '../../src/ai/scan.js';

/** A passive player 0 whose Town Center is ringed by stone walls (radius tiles out), against an AI. */
function walledBase(seed, difficulty, radius) {
  const world = createWorld({
    version: '0.1.0',
    seed,
    mapSize: 'small',
    players: [
      { index: 0, name: 'Walled', team: 1, pantheon: 'greek', kind: 'human', difficulty: null },
      { index: 1, name: 'AI', team: 2, pantheon: 'norse', kind: 'ai', difficulty },
    ],
  });
  const tc = world.buildingList.find((b) => b.owner === 0 && b.type === 'town_center');
  const cx = Math.round(tc.x);
  const cy = Math.round(tc.y);
  let placed = 0;
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let y = cy - radius; y <= cy + radius; y++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== radius) continue;
      const m = world.map;
      if (!m.inBounds(x, y) || !m.isPassable(x, y) || m.occ[y * m.width + x]) continue;
      world.completeBuilding(world.createBuilding(0, 'stone_wall', x, y, true, true));
      placed++;
    }
  }
  world.events.length = 0;
  return { world, tc, placed };
}

test('an AI army breaks into a walled base and razes it, leaving most of the wall standing', () => {
  const { world, tc, placed } = walledBase(7, 'hard', 7);
  assert.ok(placed > 30, 'a real ring');
  const ai = createAI(world, 1, 'hard');
  const end = 25 * 60 * TICK_RATE;
  for (let t = 0; t < end && !world.gameOver; t++) {
    ai.tick();
    world.tick();
    world.events.length = 0;
    world.felled.length = 0;
  }
  assert.ok(world.gameOver && world.gameOver.winningTeam === 2, `the AI wins (${(world.time / 60).toFixed(1)} min)`);
  assert.ok(tc.dead);
  const left = world.buildingList.filter((b) => !b.dead && b.def.wall).length;
  assert.ok(left >= placed - 8, `it broke in, it did not level the ring (${placed - left} of ${placed} segments lost)`);
  assert.equal(ai.ai.errors, 0);
});

test('the AI does not count wall segments as the enemy\'s buildings', () => {
  const { world, placed } = walledBase(7, 'normal', 7);
  const rec = worldDigest(world).per[0];
  assert.ok(placed > 30);
  assert.equal(rec.buildings.length, world.buildingList.filter((b) => b.owner === 0 && !b.def.wall).length);
  assert.ok(rec.buildings.every((b) => !b.def.wall));
});
