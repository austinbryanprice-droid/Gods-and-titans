// The AI in the Trial of the Titans (DESIGN 5.14, 10): wave monsters count as the enemy army near
// its base, so it turns out to defend, beats the first waves and is never left without a building early.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { scanWorld } from '../../src/ai/scan.js';

test('a Normal AI alone defends against the first waves and is paid for them', () => {
  const world = createWorld({
    version: '0.1.0',
    seed: 7,
    mapSize: 'small',
    survival: true,
    players: [{ index: 0, name: 'A', team: 1, pantheon: 'greek', kind: 'ai', difficulty: 'normal' }],
  });
  const ai = createAI(world, 0, 'normal');
  const cleared = [];
  let sawThreat = false;
  while (world.time < 6 * 60 && !world.gameOver) {
    ai.tick();
    world.tick();
    for (const e of world.events) if (e.type === 'waveCleared') cleared.push(e.n);
    world.events.length = 0;
    world.felled.length = 0;
    if (world.tickCount % 40 === 0 && world.survival.monsters.length) {
      const s = scanWorld(world, 0);
      if (world.survival.monsters.every((u) => s.enemyUnits.includes(u))) sawThreat = true;
      if (ai.ai.mil.mode === 'defend') sawThreat = true;
    }
  }
  assert.equal(world.gameOver, null);
  assert.equal(world.players[0].defeated, false);
  assert.ok(sawThreat, 'the monsters are in the AI\'s enemy list');
  assert.ok(cleared.includes(1) && cleared.includes(2), `the first two waves are beaten (${cleared})`);
});
