// The computer opponent fields its pantheon's elite soldier (data/pantheons/<id>.js `elite`) from the
// Barracks once it is a Town, as the melee or ranged soldier its army is short of.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { pantheonRoster } from '../../src/ai/unit-info.js';
import { PANTHEON_LIST, eliteFor } from '../../src/data/index.js';
import { TICK_RATE } from '../../src/config.js';

test('every pantheon roster names its elite soldier', () => {
  for (const p of PANTHEON_LIST) assert.equal(pantheonRoster(p.id).elite, p.elite.id, p.id);
});

test('the AI trains its elite soldier once it is a Town: a melee one for the Greeks, a ranged one for the Chinese', () => {
  for (const pantheon of ['greek', 'chinese']) {
    const world = createWorld({
      version: '0.1.0',
      seed: 31,
      mapSize: 'small',
      players: [
        { index: 0, name: 'AI', team: 1, pantheon, kind: 'ai', difficulty: 'normal' },
        { index: 1, name: 'Idle', team: 2, pantheon: 'norse', kind: 'human', difficulty: null },
      ],
    });
    const ai = createAI(world, 0, 'normal');
    const elite = eliteFor(pantheon);
    const p = world.players[0];
    let tierWhenSeen = 0;
    let t = 0;
    for (; t < 10 * 60 * TICK_RATE && !tierWhenSeen; t++) {
      if (t % TICK_RATE === 0) {
        p.gold = Math.max(p.gold, 3000); // a rich AI reaches the Barracks and the Town quickly
        p.wood = Math.max(p.wood, 3000);
      }
      ai.tick();
      world.tick();
      world.events.length = 0;
      world.felled.length = 0;
      if (t % 10 === 0 && world.buildingsOf(0).some((b) => b.queue.some((q) => q.u === elite.id)) || world.unitsOf(0).some((u) => u.type === elite.id)) {
        tierWhenSeen = p.tier;
      }
    }
    assert.ok(tierWhenSeen >= 2, `${pantheon}: the AI queued ${elite.id} (tier ${tierWhenSeen}) within ${(t / TICK_RATE).toFixed(0)}s`);
    assert.equal(ai.ai.errors, 0);
  }
});
