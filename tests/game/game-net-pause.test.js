// The online pause from a player's Game (src/game/game.js Game.togglePause, DESIGN 7): a defeated player can
// neither pause nor resume (the host ignores both), so the Pause key and the bar's Resume send nothing for them.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/game/game.js';
import { installFakeDom } from '../ui/fake-dom.js';

before(installFakeDom);

function onlineGame({ defeated = false, paused = false } = {}) {
  const sent = [];
  const session = { isHost: false, pause: paused ? { by: 0, reason: 'player' } : null, sendPause: (on) => sent.push(on) };
  const g = Object.create(Game.prototype);
  Object.assign(g, { session, ended: false, disposed: false, replay: null, launch: { role: 'client' }, viewState: { gameOver: null, me: { defeated } } });
  return { g, sent };
}

test('togglePause: a player still in the game pauses and resumes for everyone', () => {
  const a = onlineGame();
  assert.equal(a.g.togglePause(), true);
  assert.deepEqual(a.sent, [true]);
  const b = onlineGame({ paused: true });
  assert.equal(b.g.togglePause(), true);
  assert.deepEqual(b.sent, [false]);
});

test('togglePause: a defeated player sends neither a pause nor a resume', () => {
  for (const paused of [false, true]) {
    const { g, sent } = onlineGame({ defeated: true, paused });
    assert.equal(g.togglePause(), false);
    assert.deepEqual(sent, []);
  }
});
