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

test('the game-over screen shows the achievements the match unlocked and a line on the career', async () => {
  const { resetCareer } = await import('../../src/game/career.js');
  resetCareer({ games: 4, wins: 3, losses: 1, unlocked: { first_victory: 1 } });
  const { ov, root, game } = setup({ host: true, clients: 0 });
  game.viewState.time = 600;
  ov.statsTable = () => null; // (the table has its own checks; the fake DOM has no firstChild)
  ov.showGameOver({ result: 'victory', winningTeam: 1, unlocked: [{ id: 'titan_unleashed', name: 'Titan Unleashed', icon: '🌋', desc: 'Summon a Titan.' }, { id: 'warlord', name: 'Warlord', icon: '⚔️', desc: 'Win 10 games.' }] });
  assert.equal(ov.name, 'gameover');
  assert.match(root.textContent, /2 achievements unlocked/);
  assert.match(root.textContent, /Titan Unleashed/);
  assert.match(root.textContent, /Career: 3 wins in 4 games \(75%\) · 1 of \d+ achievements/);
  // Nothing unlocked: no cards.
  const second = setup({ host: true, clients: 0 });
  second.ov.statsTable = () => null;
  second.ov.showGameOver({ result: 'defeat', winningTeam: 2, unlocked: [] });
  assert.doesNotMatch(second.root.textContent, /unlocked/);
  resetCareer({});
});

test('the host closes a finished game: the open game-over panel says so (the message line is under it)', async () => {
  const { Game } = await import('../../src/game/game.js');
  const { ov, root } = setup({ host: false, clients: 0 });
  ov.statsTable = () => null;
  ov.showGameOver({ result: 'victory', winningTeam: 1, unlocked: [] });
  assert.doesNotMatch(root.textContent, /host has closed/);
  const messages = [];
  const g = { disposed: false, overShown: true, launch: { role: 'client' }, setLoading() {}, hud: { overlays: ov, message: (t) => messages.push(t) } };
  Game.prototype.onEnd.call(g, { reason: 'game-over' });
  assert.equal(ov.name, 'gameover', 'the panel stays');
  assert.match(root.textContent, /The host has closed the game\./);
  assert.deepEqual(messages, ['The host has closed the game.'], 'and the chat line, for after Keep Watching');
  // No game-over panel open (Keep Watching): nothing to note on.
  ov.hide();
  assert.equal(ov.noteEnded('The host has closed the game.'), false);
});
