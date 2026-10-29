// Chat over an online game's end panel (DESIGN 7, "Chat over the end panel"): with the game-over panel up,
// Enter (Shift+Enter: the allies) opens the chat box, a line that arrives shows in the feed raised over the
// overlay layer (`is-panel-chat`), and Esc in the box closes only the box. A game against the computer keeps
// its panel as it was. Real Hud and InputController, the fake DOM.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InputController } from '../../src/ui/input.js';
import { ViewState } from '../../src/game/view-state.js';
import { saveSettings } from '../../src/settings.js';
import { makeWorld } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(() => {
  installFakeDom();
  saveSettings({ tipsDismissed: true });
});

const live = [];
after(() => {
  for (const x of live) x.dispose();
});

function setup({ online = true, teams = [1, 1, 2] } = {}) {
  const world = makeWorld({ players: teams.length, teams });
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  vs.pushSnapshot(world.getSnapshot(), 50);
  const sent = [];
  const root = document.createElement('div');
  const game = {
    viewState: vs,
    selection: new Selection(vs),
    session: null,
    renderer: null,
    online,
    ended: false,
    command() {},
    setShowAllBars() {},
    sendChat: (...a) => sent.push(a),
  };
  const hud = new Hud({ root, game });
  game.hud = hud;
  const input = new InputController({ game, canvas: document.createElement('canvas'), overlayRoot: hud.overlayRoot });
  game.input = input;
  live.push(input, hud);
  const key = (k, extra = {}) => input.onKeyDown({ key: k, code: '', preventDefault() {}, target: document.body, ...extra });
  hud.overlays.showGameOver({ result: 'victory', winningTeam: 1 });
  return { hud, root, game, input, sent, key };
}

test('online, game-over panel up: Enter opens the chat box over it, and a line sent goes out', () => {
  const { hud, root, key, sent } = setup();
  assert.equal(hud.overlays.name, 'gameover');
  key('Enter');
  assert.equal(hud.chatOpen, true);
  assert.equal(hud.chatBox.hidden, false);
  assert.equal(root.classList.contains('is-panel-chat'), true, 'the box and the feed stand over the overlay layer');
  hud.chatInput.value = 'gg';
  hud.chatInput.fire('keydown', { key: 'Enter' });
  assert.deepEqual(sent, [['gg']]);
  assert.equal(hud.chatOpen, false);
  assert.equal(hud.overlays.name, 'gameover', 'the panel stays');
});

test('online, game-over panel up: Shift+Enter opens the box on the allies', () => {
  const { hud, key } = setup();
  key('Enter', { shiftKey: true });
  assert.equal(hud.chatOpen, true);
  assert.equal(hud.chatAllies, true);
});

test('online, game-over panel up: a line received shows in the feed over the panel', () => {
  const { hud, root } = setup();
  hud.chat({ from: 1, name: 'Cleo', text: 'gg, rematch?' });
  assert.match(hud.msgs.textContent, /Cleo: gg, rematch\?/);
  assert.equal(root.classList.contains('is-panel-chat'), true);
});

test('Esc in the chat box closes the box only; the next Esc puts the panel away', () => {
  const { hud, key } = setup();
  key('Enter');
  hud.chatInput.fire('keydown', { key: 'Escape' });
  assert.equal(hud.chatOpen, false);
  assert.equal(hud.overlays.name, 'gameover', 'the panel is still up');
  key('Escape');
  assert.equal(hud.overlays.name, null);
});

test('a focused button on the panel keeps Enter', () => {
  const { hud, key } = setup();
  key('Enter', { target: document.createElement('button') });
  assert.equal(hud.chatOpen, false);
});

test('the session gone (the host closed the game): Enter does nothing, and an open box closes', () => {
  const { hud, game, key } = setup();
  key('Enter');
  assert.equal(hud.chatOpen, true);
  game.ended = true;
  hud.syncPanelChat();
  assert.equal(hud.chatOpen, false);
  key('Enter');
  assert.equal(hud.chatOpen, false);
});

test('a game against the computer: Enter on the game-over panel opens no chat, as before', () => {
  const { hud, root, key } = setup({ online: false });
  key('Enter');
  assert.equal(hud.chatOpen, false);
  assert.equal(root.classList.contains('is-panel-chat'), false);
});
