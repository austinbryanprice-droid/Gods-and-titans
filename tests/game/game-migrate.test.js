// Host migration seen from a player's Game (src/game/game.js Game.migrate, DESIGN 7): when the host quit
// through the menu and this player cannot follow the heir, the game ends as a lost link ('host-left'), which
// keeps the ticket into the heir's room and offers Rejoin, not as 'host-quit' ("The host has closed the game",
// ticket dropped) while the heir may well be carrying the game on.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/game/game.js';
import { LobbyHost } from '../../src/net/lobby.js';
import { MSG, REASONS, makeRoomCode } from '../../src/net/protocol.js';
import { hostRoom } from '../../src/net/transport.js';
import { installFakeDom } from '../ui/fake-dom.js';

before(installFakeDom);

/** Just enough of a Game for migrate(): a client of an online game whose host has quit. */
function fakeGame(token) {
  const ended = [];
  const g = {
    myIndex: 2,
    myToken: token,
    launch: { role: 'client', rejoin: token, transport: 'loopback' },
    session: { playerName: (i) => ['Host', 'Ann', 'Ben'][i] },
    hud: null,
    input: null,
    disposed: false,
    viewState: {},
    netTransport: () => 'loopback',
    onEnd: (info) => ended.push(info),
  };
  return { g, ended };
}

test('migrate: a player who cannot follow the heir after a menu quit ends as a lost link (Rejoin kept)', async () => {
  const room = makeRoomCode();
  const token = 'b'.repeat(32);
  // The planned room answers, but not as the game's host (no proof): following it is refused at once.
  const ep = await hostRoom({ transport: 'loopback', roomCode: room });
  const fake = LobbyHost.forGame(ep, { transport: 'loopback', tokens: new Map([[2, token]]) });
  const setup = { version: '0.1.0', seed: 1, mapSize: 'small', players: [0, 1, 2].map((i) => ({ index: i, name: `P${i}`, team: 1, pantheon: 'greek', color: '#fff', kind: 'human', difficulty: null })) };
  fake.setRejoinHandler((index, conn) => {
    conn.send({ t: MSG.START, setup, you: index, rejoin: true });
    return null;
  });
  const { g, ended } = fakeGame(token);
  const warn = console.warn;
  console.warn = () => {};
  try {
    await Game.prototype.migrate.call(g, REASONS.HOST_QUIT, { plan: { heir: 1, room, host: 0, at: makeRoomCode(), proof: 'f'.repeat(32) }, backup: null });
  } finally {
    console.warn = warn;
    fake.close();
  }
  assert.equal(ended.length, 1);
  assert.equal(ended[0].reason, REASONS.HOST_LEFT);
  assert.equal(g.migrating, false);
});

/** A host of an online game with a friend connected, quitting through the menu (Game.quitToMenu). */
function quittingHost(handOff) {
  const exits = [];
  const g = {
    disposed: false,
    leaving: false,
    hud: null,
    launch: { role: 'host' },
    countLeave() {},
    dispose() {
      this.disposed = true;
    },
    onExit: (info) => exits.push(info),
    session: { isHost: true, canHandOff: true, clients: new Map([[1, {}]]), heir: 1, playerName: (i) => ['Host', 'Ann'][i], handOff },
  };
  return { g, exits };
}

test('quitToMenu: a host whose game went on with the heir is told so on the title screen', async () => {
  const { g, exits } = quittingHost(async () => true);
  Game.prototype.quitToMenu.call(g);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(exits.length, 1);
  assert.match(exits[0].notice, /Ann now hosts the game\. Rejoin Online Game takes your seat back\./);
  // No hand-over went out: no such notice.
  const failed = quittingHost(async () => false);
  Game.prototype.quitToMenu.call(failed.g);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(failed.exits, [undefined]);
});
