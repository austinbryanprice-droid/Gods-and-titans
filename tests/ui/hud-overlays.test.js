// The defeat screen while the game goes on (src/ui/hud-overlays.js): on a host
// with other players connected, Return to Menu ends the game for all of them,
// so it says so and asks first (like Quit in the F10 menu); its text only
// mentions allies when there are allies left. Fake DOM, fake game.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Overlays } from '../../src/ui/hud-overlays.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

function setup({ host = true, clients = 1, allyAlive = true } = {}) {
  const quits = [];
  const game = {
    session: { isHost: host, clients: new Map(Array.from({ length: clients }, (_, i) => [i + 1, {}])) },
    viewState: {
      myIndex: 0,
      myTeam: 1,
      players: [
        { i: 0, team: 1, defeated: true },
        { i: 1, team: 1, defeated: !allyAlive },
        { i: 2, team: 2, defeated: false },
      ],
    },
    quitToMenu: () => quits.push(1),
    setPaused: () => false,
  };
  const root = document.createElement('div');
  const ov = new Overlays(root, game);
  return { ov, root, game, quits };
}

test('defeated host with players connected: Return to Menu warns and asks before ending the game', () => {
  const { ov, root, quits } = setup();
  ov.showDefeated();
  assert.equal(ov.name, 'defeated');
  assert.match(root.textContent, /Your allies fight on/);
  assert.match(root.textContent, /leaving ends the game for every player/);
  root.button('Return to Menu').click();
  assert.equal(quits.length, 0, 'no one-click quit');
  assert.equal(ov.name, 'confirm');
  assert.match(root.textContent, /The game ends for every player/);
  // Cancel goes back to the defeat screen, Esc too.
  root.button('Cancel').click();
  assert.equal(ov.name, 'defeated');
  root.button('Return to Menu').click();
  ov.escape();
  assert.equal(ov.name, 'defeated');
  assert.equal(quits.length, 0);
  root.button('Return to Menu').click();
  root.button('Quit').click();
  assert.equal(quits.length, 1);
});

test('defeated without other players to host for: Return to Menu leaves at once', () => {
  for (const o of [{ host: true, clients: 0 }, { host: false, clients: 0 }]) {
    const { ov, root, quits } = setup(o);
    ov.showDefeated();
    assert.doesNotMatch(root.textContent, /leaving ends the game/);
    root.button('Return to Menu').click();
    assert.equal(quits.length, 1, JSON.stringify(o));
  }
});

test('the defeat text only promises allies when an ally is still in the game', () => {
  const { ov, root } = setup({ host: false, clients: 0, allyAlive: false });
  ov.showDefeated();
  assert.doesNotMatch(root.textContent, /allies/);
  assert.match(root.textContent, /The battle goes on without you/);
  root.button('Keep Watching').click();
  assert.equal(ov.open, false);
});
