// The AI in a Decade of Peace: both sides keep building and massing armies, nobody lands a hit on
// anybody (not even where their creep hunts cross) until the peace is over, and then the waves go out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';

test('two Hard AIs mass armies without a single hit between players, then attack once the peace is over', () => {
  const world = createWorld({
    version: '0.1.0',
    seed: 3, // without a peace these two meet over the creep camps before minute 5
    mapSize: 'small',
    peaceMinutes: 30,
    players: [
      { index: 0, name: 'A', team: 1, pantheon: 'greek', kind: 'ai', difficulty: 'hard' },
      { index: 1, name: 'B', team: 2, pantheon: 'norse', kind: 'ai', difficulty: 'hard' },
    ],
  });
  const ais = [0, 1].map((i) => createAI(world, i, 'hard'));
  let hits = 0;
  const modes = new Set();
  const play = (untilMinutes) => {
    while (world.time < untilMinutes * 60 && !world.gameOver) {
      for (const a of ais) a.tick();
      world.tick();
      for (const e of world.events) {
        if (e.type !== 'hit') continue;
        const src = world.entities.get(e.src);
        const dst = world.entities.get(e.dst);
        if (src && dst && src.owner >= 0 && dst.owner >= 0 && src.owner !== dst.owner) hits++;
      }
      world.events.length = 0;
      world.felled.length = 0;
      for (const a of ais) modes.add(a.ai.mil.mode);
    }
  };
  const army = (i) => world.unitList.filter((u) => !u.dead && u.owner === i && u.def.class !== 'worker').length;

  play(12); // a Hard army is ready to attack by about minute 11
  assert.equal(world.peace, true);
  assert.equal(hits, 0, 'no player hit another player');
  assert.ok(!modes.has('attack'), `no wave left home (modes seen: ${[...modes]})`);
  assert.ok(modes.has('creep'), 'the armies were out hunting creatures, which stays allowed');
  assert.ok(army(0) >= 30 && army(1) >= 30, `both are massing armies (${army(0)} and ${army(1)})`);

  world.peaceEnd = world.time; // the real peace is thirty-plus game minutes
  play(15);
  assert.equal(world.peace, false);
  assert.ok(ais.some((a) => a.ai.mil.waves >= 1), 'a wave went out once the peace was over');
  assert.ok(hits > 0, 'and the armies fought');
  for (const a of ais) assert.equal(a.ai.errors, 0);
});
