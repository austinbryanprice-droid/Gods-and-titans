import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, rejoinMatchId } from '../../src/game/game.js';
import { isSettled } from '../../src/game/game-saves.js';

test('quitting an online game counts it once: rejoining it later does not count it again', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    const launch = { role: 'client', rejoin: 'ab'.repeat(16) };
    assert.equal(rejoinMatchId(launch), `rejoin:${'ab'.repeat(16)}`);
    assert.equal(rejoinMatchId({ role: 'host', rejoin: 'x' }), null);
    assert.equal(rejoinMatchId({ role: 'client' }), null);
    const finished = [];
    const game = {
      launch, recorder: null, saver: null, ended: false,
      viewState: { gameOver: null, me: { defeated: false }, time: 120 },
      career: { finish: (r) => finished.push(r) },
      countDaily() {},
    };
    assert.equal(isSettled(rejoinMatchId(launch)), false);
    Game.prototype.countLeave.call(game); // Return to Menu two minutes in: a loss
    assert.deepEqual(finished, ['defeat']);
    assert.equal(isSettled(rejoinMatchId(launch)), true, 'a rejoined Game of this match keeps no career');
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
});
