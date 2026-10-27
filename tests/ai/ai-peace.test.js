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

test('the AI builds around an enemy Town Center\'s ground and never into it, and still builds its base', () => {
  const world = createWorld({
    version: '0.1.0',
    seed: 3,
    mapSize: 'small',
    peaceMinutes: 30,
    players: [
      { index: 0, name: 'AI', team: 1, pantheon: 'greek', kind: 'ai', difficulty: 'normal' },
      { index: 1, name: 'Rival', team: 2, pantheon: 'norse', kind: 'human', difficulty: null },
    ],
  });
  // The rival founds a second Town Center on the AI's doorstep (about as near as the rule lets it: 20 tiles of
  // open ground from the AI's), which puts most of the AI's usual building ground inside the rival's. It goes
  // where no creep camp can reach it.
  const home = world.buildingList.find((b) => b.owner === 0 && b.type === 'town_center');
  let spot = null;
  for (let a = 0; a < 24 && !spot; a++) {
    const px = home.x + Math.cos(a * (Math.PI / 12)) * 25;
    const py = home.y + Math.sin(a * (Math.PI / 12)) * 25;
    const s = world.findPlacement(1, 'town_center', px, py, 3);
    if (s && world.camps.every((c) => Math.hypot(c.x - (s.tx + 2), c.y - (s.ty + 2)) > 16)) spot = s;
  }
  assert.ok(spot, 'room for the rival\'s Town Center');
  const planted = world.createBuilding(1, 'town_center', spot.tx, spot.ty, true, true);
  assert.equal(world.peaceBuildBlocks(0, home.tx, home.ty, home.size), false, 'the AI\'s own Town Center is just outside');
  const ai = createAI(world, 0, 'normal');
  const near = (b) => Math.hypot(Math.max(planted.tx - (b.tx + b.size), b.tx - (planted.tx + planted.size), 0), Math.max(planted.ty - (b.ty + b.size), b.ty - (planted.ty + planted.size), 0));
  let blocked = 0;
  for (let t = 0; t < 8 * 60 * 20; t++) {
    ai.tick();
    world.tick();
    world.events.length = 0;
    world.felled.length = 0;
    if (t % 200 === 0) {
      for (const b of world.buildingList) if (!b.dead && b.owner === 0 && near(b) < 20) blocked++;
    }
  }
  assert.equal(world.peace, true);
  assert.equal(planted.dead, false, 'the rival\'s Town Center stood the whole time');
  assert.equal(blocked, 0, 'none of the AI\'s buildings ever stood inside the rival\'s ground');
  const mine = (type) => world.buildingList.filter((b) => !b.dead && b.owner === 0 && b.type === type && b.constructed).length;
  assert.ok(mine('house') >= 3 && mine('barracks') >= 1 && mine('shrine') >= 1, `the AI still builds its base (${mine('house')} houses, ${mine('barracks')} barracks, ${mine('shrine')} shrine)`);
  assert.equal(ai.ai.errors, 0);
});
