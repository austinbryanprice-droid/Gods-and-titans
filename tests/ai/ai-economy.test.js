// AI economy under the MINE_SLOTS rule (DESIGN 5.2/10): gold workers sized to
// what a mine can take (2 mine at once, 5–6 saturate it), a second mine
// before the start mine runs out, and pop-free rebuilds after a raid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { minersFor } from '../../src/ai/economy.js';
import { TICK_RATE, MINE_SLOTS } from '../../src/config.js';

/** A generated small map with player 0 run by the AI and player 1 idle. */
function soloGame(seed, pantheon = 'egyptian', difficulty = 'normal') {
  const world = createWorld({
    version: '0.1.0',
    seed,
    mapSize: 'small',
    players: [
      { index: 0, name: 'AI', team: 1, pantheon, kind: 'ai', difficulty },
      { index: 1, name: 'Idle', team: 2, pantheon: 'norse', kind: 'human', difficulty: null },
    ],
  });
  const ai = createAI(world, 0, difficulty);
  const step = (seconds, each) => {
    const n = Math.round(seconds * TICK_RATE);
    for (let i = 0; i < n; i++) {
      ai.tick();
      world.tick();
      world.events.length = 0;
      world.felled.length = 0;
      if (each) each(i);
    }
  };
  return { world, ai, step };
}

/** Gold workers of player 0 per mine id, and how many of them wait their turn. */
function miners(world) {
  const per = new Map();
  let waiting = 0;
  for (const u of world.unitsOf(0)) {
    const o = u.order;
    if (u.def.class !== 'worker' || !o || o.type !== 'gather') continue;
    const m = world.entities.get(o.target);
    if (!m || m.kind !== 'mine') continue;
    per.set(m.id, (per.get(m.id) || 0) + 1);
    if (o.phase === 'wait') waiting++;
  }
  return { per, waiting };
}

test('gold workers match what each mine can take, and the AI takes a second mine early', () => {
  for (const [seed, pantheon] of [[3, 'egyptian'], [8, 'greek']]) {
    const g = soloGame(seed, pantheon, 'normal');
    const { world, ai } = g;
    g.step(150);
    let samples = 0;
    let waitSum = 0;
    let over = 0;
    let expandedAt = null;
    for (let t = 150; t < 9 * 60; t += 10) {
      g.step(10);
      const { per, waiting } = miners(world);
      samples++;
      waitSum += waiting;
      for (const pr of ai.ai.pairs) {
        const n = per.get(pr.mine.id) || 0;
        if (n > minersFor(ai.ai, pr) + 1) over++;
      }
      if (expandedAt === null && ai.ai.pairs.length >= 2) expandedAt = t;
    }
    const avgWait = waitSum / samples;
    // About (workers - MINE_SLOTS - walkers) wait at a saturated mine; more means idle hands.
    assert.ok(avgWait <= 2.5, `${pantheon}: ${avgWait.toFixed(1)} miners waiting on average (MINE_SLOTS ${MINE_SLOTS})`);
    assert.ok(over <= samples * 0.15, `${pantheon}: a mine had too many gold workers in ${over}/${samples} samples`);
    assert.ok(expandedAt !== null && expandedAt <= 8.5 * 60, `${pantheon}: second mine at ${expandedAt}`);
    assert.equal(ai.ai.errors, 0);
  }
});

test('over the pop cap after a raid, the AI still rebuilds its Town Center and houses', () => {
  const g = soloGame(5, 'norse', 'normal');
  const { world, ai } = g;
  ai.ai.prof = { ...ai.ai.prof, firstAttack: 1e9 }; // stay home: the idle opponent must not lose first
  g.step(480);
  const p = world.players[0];
  // A small raid and out: the Town Center and three houses die, no AI unit does.
  world.killEntity(world.buildingsOf(0).find((b) => b.type === 'town_center'), null);
  for (const h of world.buildingsOf(0).filter((b) => b.type === 'house').slice(0, 3)) world.killEntity(h, null);
  assert.ok(p.popUsed > p.popCap, `over the cap (${p.popUsed}/${p.popCap})`);
  g.step(120);
  assert.ok(world.buildingsOf(0).some((b) => b.type === 'town_center' && b.constructed), 'Town Center rebuilt');
  assert.ok(p.popCap >= p.popUsed, `houses back (${p.popUsed}/${p.popCap})`);
  assert.equal(ai.ai.errors, 0);
});
