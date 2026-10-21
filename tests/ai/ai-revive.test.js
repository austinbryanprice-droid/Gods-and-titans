// The computer opponent plans a god's revival with the price the sim charges, Hindu Samsara
// included (data/upgrades.js reviveMult), so it neither waits for money it does not need nor
// holds back more than the revival costs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAI } from '../../src/ai/ai.js';
import { godsFor } from '../../src/data/index.js';
import { reviveMult } from '../../src/data/upgrades.js';
import { REVIVE_COST_MULT, TICK_RATE } from '../../src/config.js';
import { makeWorld, place } from '../sim/helpers.js';

/**
 * Does an AI of this pantheon queue the revival of its fallen first god when it holds `share` of that
 * god's faith? (Gold and wood are plentiful, so the higher-priority Worshippers and Houses cannot
 * crowd the revival out of its turn.)
 */
function revives(pantheon, share) {
  const w = makeWorld({ pantheons: [pantheon, 'norse'] });
  const ai = createAI(w, 0, 'hard');
  const p = w.players[0];
  const temple = place(w, 0, 'temple', 20, 14);
  const god = godsFor(pantheon)[0];
  p.fallen[god.id] = { level: 2, xp: 150 };
  for (let t = 0; t < 5 * TICK_RATE; t++) {
    p.gold = 5000;
    p.wood = 5000;
    p.faith = Math.ceil(god.cost.faith * share);
    ai.tick();
    w.tick();
    w.events.length = 0;
    w.felled.length = 0;
    if (temple.queue.some((q) => q.u === god.id && q.revive)) return true;
  }
  return false;
}

test('Samsara makes the Hindu AI revive a fallen god for less than the usual price, and no other AI', () => {
  const share = (reviveMult({ perks: { revive: 0.4 } }) + REVIVE_COST_MULT) / 2; // between Samsara's price and the usual one
  assert.ok(share > reviveMult({ perks: { revive: 0.4 } }) && share < REVIVE_COST_MULT);
  assert.equal(revives('hindu', share), true, 'the Hindu AI revives at the Samsara price');
  assert.equal(revives('greek', share), false, 'an AI without Samsara still waits for the usual price');
  assert.equal(revives('greek', REVIVE_COST_MULT), true, 'and revives once it has it');
});
