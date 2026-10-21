// Full AI-vs-AI games on generated maps: a normal-vs-normal game reaches a
// winner, and hard beats easy in most seeds. Longer tournaments live in
// tools/ai-tournament.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { TICK_RATE } from '../../src/config.js';

/** Play an AI-only 1v1 until someone wins or maxMinutes pass. */
function playGame({ seed, pantheons, difficulties, maxMinutes }) {
  const world = createWorld({
    version: '0.1.0',
    seed,
    mapSize: 'small',
    players: pantheons.map((p, i) => ({ index: i, name: `AI ${i + 1}`, team: i + 1, pantheon: p, kind: 'ai', difficulty: difficulties[i] })),
  });
  const ais = pantheons.map((_, i) => createAI(world, i, difficulties[i]));
  const gods = [new Set(), new Set()];
  const end = maxMinutes * 60 * TICK_RATE;
  for (let t = 0; t < end && !world.gameOver; t++) {
    for (const a of ais) a.tick();
    world.tick();
    world.events.length = 0;
    world.felled.length = 0;
    if (t % (30 * TICK_RATE) === 0) for (const u of world.unitList) if (!u.dead && u.owner >= 0 && u.def.class === 'god') gods[u.owner].add(u.type);
  }
  return { world, ais, gods, minutes: world.time / 60 };
}

test('a normal-vs-normal AI game ends with a winner', () => {
  const g = playGame({ seed: 1, pantheons: ['greek', 'norse'], difficulties: ['normal', 'normal'], maxMinutes: 40 });
  assert.ok(g.world.gameOver, `no winner after ${g.minutes.toFixed(1)} minutes`);
  assert.ok(g.world.gameOver.winningTeam === 1 || g.world.gameOver.winningTeam === 2);
  assert.ok(g.minutes >= 8, `game too short: ${g.minutes.toFixed(1)} minutes`);
  assert.ok(g.gods[0].size >= 2 && g.gods[1].size >= 2, 'both sides summoned gods');
  for (const a of g.ais) assert.equal(a.ai.errors, 0);
});

test('hard beats easy in most seeds', () => {
  const results = [];
  for (const [seed, pantheons] of [[2, ['egyptian', 'hindu']], [3, ['norse', 'greek']], [4, ['celtic', 'aztec']]]) {
    // Alternate sides so the start position does not decide it.
    const hardFirst = seed % 2 === 0;
    const difficulties = hardFirst ? ['hard', 'easy'] : ['easy', 'hard'];
    const g = playGame({ seed, pantheons, difficulties, maxMinutes: 25 });
    const hardTeam = hardFirst ? 1 : 2;
    results.push(g.world.gameOver && g.world.gameOver.winningTeam === hardTeam);
    for (const a of g.ais) assert.equal(a.ai.errors, 0);
  }
  assert.ok(results.filter(Boolean).length >= 2, `hard won ${results.filter(Boolean).length}/3`);
});

test('two equal hard armies at the population cap do not sit at home forever', () => {
  // Hard's army tops out at 150 pop minus its workers, short of 90 % of its army cap; both used to idle at 150/150 pop.
  const g = playGame({ seed: 3, pantheons: ['egyptian', 'chinese'], difficulties: ['hard', 'hard'], maxMinutes: 22 });
  assert.ok(g.world.gameOver, `no winner after ${g.minutes.toFixed(1)} minutes`);
  for (const a of g.ais) assert.equal(a.ai.errors, 0);
});
