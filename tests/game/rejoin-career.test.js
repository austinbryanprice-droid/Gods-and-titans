import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, rejoinMatchId } from '../../src/game/game.js';
import { isSettled } from '../../src/game/game-saves.js';
import { saveTicket, saveTally, readTicket } from '../../src/net/rejoin-ticket.js';

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

test('a rejoined game carries on the career tally its ticket kept (buildings lost are not forgotten)', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    const token = 'cd'.repeat(16);
    saveTicket({ roomCode: 'ABCDE', token, myIndex: 1, name: 'Ann' });
    saveTally(token, { buildingsLost: 2, godsSummoned: 1 });
    const subs = [];
    const offs = [];
    const game = {
      launch: { role: 'client', rejoin: token },
      career: { m: { buildingsLost: 0, godsSummoned: 0, kills: 0 } },
      viewState: { on: (name, cb) => { subs.push(cb); return () => {}; } },
      offs,
      rejoinTicket: Game.prototype.rejoinTicket,
    };
    Game.prototype.keepTally.call(game);
    assert.deepEqual(game.career.m, { buildingsLost: 2, godsSummoned: 1, kills: 0 });
    game.career.m.buildingsLost = 4;
    for (const off of offs) off(); // leaving keeps the latest tally
    assert.equal(readTicket().tally.buildingsLost, 4);
    // A window replaced by a newer one (that took the seat back) leaves the ticket's tally alone.
    game.replaced = true;
    game.career.m.buildingsLost = 1;
    for (const off of offs) off();
    assert.equal(readTicket().tally.buildingsLost, 4);
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
});
