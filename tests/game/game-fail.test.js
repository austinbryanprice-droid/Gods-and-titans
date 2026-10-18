// A match that cannot start (src/game/game.js Game.fail): the player gets a
// "Could not start the game" screen in plain words (no results table, the raw
// message small underneath, a way back to the menu), and the other players are
// told at once instead of waiting for the lobby to time out. Fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Game, describeStartFailure } from '../../src/game/game.js';
import { createLoopbackPair } from '../../src/net/transport.js';
import { Overlays } from '../../src/ui/hud-overlays.js';
import { MSG, REASONS } from '../../src/net/protocol.js';
import { installFakeDom } from '../ui/fake-dom.js';
import { makeSetup } from '../sim/helpers.js';

before(installFakeDom);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeRoot() {
  const canvas = document.createElement('canvas');
  const hudRoot = document.createElement('div');
  return {
    hudRoot,
    root: {
      hidden: true,
      clientWidth: 1280,
      clientHeight: 720,
      querySelector: (sel) => (sel === '#hud-root' ? hudRoot : sel === '#game-canvas' || sel === 'canvas' ? canvas : null),
    },
  };
}

/** Collect what a loopback peer receives and whether it was closed. */
function listen(conn) {
  const seen = { messages: [], closed: null };
  conn.onMessage((m) => seen.messages.push(m));
  conn.onClose((reason) => {
    seen.closed = reason;
  });
  return seen;
}

async function startFailing(opts) {
  const { root, hudRoot } = fakeRoot();
  const exits = [];
  const quiet = console.error;
  console.error = () => {};
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  try {
    const game = new Game({ root, settings: { quality: 'high' }, onExit: () => exits.push(1), createAI: () => ({ tick() {} }), ...opts });
    await game.ready.catch(() => {});
    return { game, hudRoot, exits };
  } finally {
    console.error = quiet;
  }
}

test('describeStartFailure: WebGL and context errors become a graphics hint, the raw message stays', () => {
  for (const msg of ['THREE.WebGLRenderer: Error creating WebGL context.', 'Error creating WebGL context with your selected attributes', 'WebGL2 is not available']) {
    const d = describeStartFailure(new Error(msg));
    assert.match(d.text, /could not start 3D graphics/);
    assert.match(d.text, /hardware acceleration/);
    assert.equal(d.detail, msg);
  }
});

test('describeStartFailure: failed downloads, other errors and non-errors', () => {
  assert.match(describeStartFailure(new TypeError('Failed to fetch dynamically imported module: https://x/y.js')).text, /could not be loaded/);
  const other = describeStartFailure(new Error('Cannot read properties of undefined'));
  assert.match(other.text, /Something went wrong/);
  assert.equal(other.detail, 'Cannot read properties of undefined');
  assert.equal(describeStartFailure('boom').detail, 'boom');
  for (const odd of [undefined, null, {}, new Error('')]) {
    const d = describeStartFailure(odd);
    assert.match(d.text, /Something went wrong/);
    assert.equal(d.detail, '');
  }
  const long = describeStartFailure(new Error(`line one\nline two ${'x'.repeat(1000)}`));
  assert.ok(!long.detail.includes('\n'));
  assert.ok(long.detail.length <= 300);
});

test('a host whose session could not be built shows the failure screen and closes every client connection at once', async () => {
  const [hostSide, clientSide] = createLoopbackPair();
  const peer = listen(clientSide);
  // A setup without players makes the world fail to build, so no session ever exists.
  const launch = { role: 'host', setup: { version: '0.1.0', seed: 1, mapSize: 'small', players: null }, myIndex: 0, conns: new Map([[1, hostSide]]) };
  const { game, hudRoot, exits } = await startFailing({ launch });
  assert.equal(game.session, null);
  assert.equal(hostSide.open, false, 'closed without waiting for the menu');
  await sleep(30);
  assert.equal(clientSide.open, false);
  assert.ok(peer.messages.some((m) => m.t === MSG.END && m.reason === REASONS.HOST_QUIT), 'the client was told the host closed the game');
  // The screen: a title for the start-up failure, no results table, the raw message, one way out.
  const text = hudRoot.textContent;
  assert.match(text, /Could not start the game/);
  assert.doesNotMatch(text, /Game Ended/);
  assert.equal(hudRoot.find('hud-stats'), null, 'no results table');
  assert.ok(hudRoot.find('hud-startfail-raw'), 'the raw message is kept small underneath');
  assert.equal(game.errors.length, 1);
  // Closing twice (the net layer does it again when the menu shows) is harmless.
  game.releasePlayers();
  hostSide.close('closed');
  hudRoot.button('Return to Menu').click();
  assert.equal(exits.length, 1);
  assert.equal(game.disposed, true);
});

test('a client whose session could not be built leaves the host at once', async () => {
  const [clientSide, hostSide] = createLoopbackPair();
  const peer = listen(hostSide);
  const launch = { role: 'client', setup: { version: '0.1.0', seed: 1, mapSize: 'small', players: null }, myIndex: 1, conn: clientSide };
  const { game, hudRoot } = await startFailing({ launch });
  assert.equal(game.session, null);
  assert.equal(clientSide.open, false);
  await sleep(30);
  assert.equal(hostSide.open, false);
  assert.equal(peer.closed, 'remote-closed');
  assert.match(hudRoot.textContent, /Could not start the game/);
  game.quitToMenu();
});

test('a failure after the session exists stops it, so the other players are told too', async () => {
  const [hostSide, clientSide] = createLoopbackPair();
  const peer = listen(clientSide);
  const setup = makeSetup(2);
  setup.players[1].kind = 'human';
  setup.players[1].difficulty = null;
  class NoGraphics {
    constructor() {
      throw new Error('THREE.WebGLRenderer: Error creating WebGL context.');
    }
  }
  // The fake DOM cannot build the real HUD, so start-up stops there; what matters is that fail() runs with a live session.
  const launch = { role: 'host', setup, myIndex: 0, conns: new Map([[1, hostSide]]) };
  const { game, exits } = await startFailing({ launch, Renderer: NoGraphics });
  assert.ok(game.session, 'the session had been built');
  assert.equal(game.session.stopped, true, 'and was stopped');
  await sleep(400);
  assert.ok(peer.messages.some((m) => m.t === MSG.END && m.reason === REASONS.HOST_QUIT), 'the client was told the host closed the game');
  assert.notEqual(peer.closed, null, 'and its connection closed');
  assert.equal(exits.length, 1, 'the player is back at the menu (the screen above needs the HUD)');
});

test('with the HUD up the failure screen says what went wrong in plain words and offers the menu', () => {
  const { hudRoot } = fakeRoot();
  const layer = document.createElement('div');
  hudRoot.appendChild(layer);
  const exits = [];
  const game = { errors: [], disposed: false, viewState: {}, releasePlayers() {}, quitToMenu: () => exits.push(1) };
  game.hud = { overlays: new Overlays(layer, game) };
  Game.prototype.fail.call(game, new Error('THREE.WebGLRenderer: Error creating WebGL context.'));
  const text = hudRoot.textContent;
  assert.equal(game.hud.overlays.name, 'ended', 'F10 stays shut under it');
  assert.match(text, /Could not start the game/);
  assert.match(text, /Your browser could not start 3D graphics\. Check that hardware acceleration is on, or try another browser\./);
  assert.match(text, /THREE\.WebGLRenderer: Error creating WebGL context\./);
  assert.doesNotMatch(text, /Game Ended/);
  assert.equal(hudRoot.find('hud-stats'), null, 'no results table');
  assert.equal(hudRoot.all('button').length, 1);
  hudRoot.button('Return to Menu').click();
  assert.deepEqual(exits, [1]);
});
