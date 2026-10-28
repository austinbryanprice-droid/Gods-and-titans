// The computer opponent spends its god powers (data/powers.js): a blessing once its economy works,
// a strike on a crowd of enemies its team can see, never on an empty field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { TICK_RATE } from '../../src/config.js';

function setup(pantheon) {
  const world = createWorld({
    version: '0.1.0',
    seed: 7,
    mapSize: 'small',
    players: [
      { index: 0, name: 'AI', team: 1, pantheon, kind: 'ai', difficulty: 'normal' },
      { index: 1, name: 'Idle', team: 2, pantheon: 'norse', kind: 'human', difficulty: null },
    ],
  });
  return { world, ai: createAI(world, 0, 'normal') };
}

function play(world, ai, seconds, each) {
  const cast = [];
  for (let t = 0; t < seconds * TICK_RATE; t++) {
    if (each) each(t);
    ai.tick();
    world.tick();
    for (const e of world.events) if (e.type === 'godPower') cast.push(e);
    world.events.length = 0;
    world.felled.length = 0;
  }
  return cast;
}

test('the AI blesses its harvest once its worshippers are at work', () => {
  const { world, ai } = setup('greek');
  const cast = play(world, ai, 240);
  assert.deepEqual(cast.map((e) => e.power), ['greek_power_demeters_bounty']);
  assert.equal(ai.ai.errors, 0);
});

test('the AI strikes a crowd of enemies it can see, and keeps the power while there is none', () => {
  const { world, ai } = setup('norse');
  const me = world.players[0];
  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  tc.tier = 2;
  world.recomputeTier(0, true);
  assert.equal(play(world, ai, 5).filter((e) => e.power === 'norse_power_hammerfall').length, 0, 'no target, no strike');
  // Eight enemy warriors at the AI's door.
  for (let i = 0; i < 8; i++) world.spawnUnit(1, 'warrior', tc.x + 4 + (i % 4) * 0.8, tc.y + 4 + Math.floor(i / 4) * 0.8, {});
  const cast = play(world, ai, 5);
  const strike = cast.find((e) => e.power === 'norse_power_hammerfall');
  assert.ok(strike, `cast: ${cast.map((e) => e.power)}`);
  const near = world.unitList.filter((u) => u.owner === 1 && u.type === 'warrior' && Math.hypot(u.x - strike.x, u.y - strike.y) < 6).length;
  assert.ok(near >= 4 || world.unitList.filter((u) => u.owner === 1 && !u.dead).length < 8, `on the crowd (${near} warriors near ${strike.x}, ${strike.y})`);
  assert.equal(me.powers.used & 2, 2);
  assert.equal(ai.ai.errors, 0);
});
