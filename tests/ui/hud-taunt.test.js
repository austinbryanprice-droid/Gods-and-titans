// A computer player's taunt at the top centre (Hud.showTaunt, DESIGN 10.1): emblem, name in
// their colour, the words larger than the feed, replaced by the next one, gone after its dwell;
// the game controller sends AI lines there with the taunt sound, and players' chat to the feed.
import { test, mock, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Hud } from '../../src/ui/hud.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { tauntDwell } from '../../src/ui/hud-data.js';
import { PANTHEON_EMBLEMS } from '../../src/ui/menu-model.js';
import { ViewState } from '../../src/game/view-state.js';
import { Game } from '../../src/game/game.js';
import { sfx } from '../../src/audio/sfx.js';
import { saveSettings } from '../../src/settings.js';
import { makeWorld } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(() => {
  installFakeDom();
  saveSettings({ tipsDismissed: true, aiChat: true });
});

const huds = [];
afterEach(() => mock.timers.reset());
after(() => {
  for (const h of huds) h.dispose();
});

function setup() {
  const world = makeWorld({ pantheons: ['greek', 'norse'] });
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  vs.pushSnapshot(world.getSnapshot(), 50);
  const root = document.createElement('div');
  const game = { viewState: vs, selection: new Selection(vs), session: null, input: null, renderer: null, command() {}, sendChat() {} };
  const hud = new Hud({ root, game });
  huds.push(hud);
  return { hud, vs };
}

test('tauntDwell: 6 to 9.5 s by length', () => {
  assert.equal(tauntDwell(''), 6000);
  assert.equal(tauntDwell('x'.repeat(40)), 6700);
  assert.equal(tauntDwell('x'.repeat(200)), 9500);
});

test('a taunt shows at the top centre with the emblem, the name and the words, then goes', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { hud, vs } = setup();
  const norse = vs.players[1];
  const line = { from: 1, name: 'AI (Hard)', text: 'Blood for blood!', system: false, voice: true };
  assert.equal(hud.showTaunt(line), true);
  const t = hud.taunt;
  assert.equal(t.hidden, false);
  assert.ok(t.classList.contains('is-on'));
  assert.equal(t.dataset.icon, PANTHEON_EMBLEMS[norse.pantheon]);
  assert.equal(t.children[0].textContent, 'AI (Hard)');
  assert.equal(t.children[1].textContent, '“Blood for blood!”');
  assert.equal(t.style.getPropertyValue('--taunt-accent'), norse.color);
  assert.equal(hud.msgs.children.length, 0, 'not also in the feed');
  // The next one replaces it and its own dwell starts over.
  mock.timers.tick(5000);
  hud.showTaunt({ ...line, text: 'Skål!' });
  assert.equal(t.children[1].textContent, '“Skål!”');
  mock.timers.tick(5000);
  assert.ok(t.classList.contains('is-on'), 'still up: the second taunt has its own time');
  mock.timers.tick(tauntDwell('Skål!') - 5000);
  assert.ok(!t.classList.contains('is-on'));
  mock.timers.tick(500);
  assert.equal(t.hidden, true);
});

test('no taunt behind the end screens: the one up goes when they open, and new ones are not shown', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const { hud } = setup();
  const line = { from: 1, name: 'AI (Hard)', text: 'Blood for blood!', system: false, voice: true };
  for (const name of ['gameover', 'defeated', 'ended']) {
    hud.overlays.hide();
    assert.equal(hud.showTaunt(line), true);
    hud.overlays.show(name, document.createElement('div'));
    hud.update(0);
    assert.equal(hud.taunt.hidden, true, name);
    assert.equal(hud.taunt.classList.contains('is-on'), false, name);
    assert.equal(hud.showTaunt(line), false, `${name}: refused`);
    assert.equal(hud.taunt.hidden, true);
  }
  // Other overlays (the in-game menu) leave it alone.
  hud.overlays.hide();
  hud.overlays.show('menu', document.createElement('div'));
  assert.equal(hud.showTaunt(line), true);
  hud.update(0);
  assert.equal(hud.taunt.hidden, false);
  hud.overlays.hide();
});

test('bad lines are refused; hostile text stays text', () => {
  const { hud } = setup();
  assert.equal(hud.showTaunt(null), false);
  assert.equal(hud.showTaunt({ from: 1, text: '   ' }), false);
  assert.equal(hud.taunt.hidden, true);
  assert.equal(hud.showTaunt({ from: 99, name: '<b>x</b>', text: '<img src=x onerror=alert(1)>' }), true);
  assert.equal(hud.taunt.children[1].textContent, '“<img src=x onerror=alert(1)>”');
  assert.equal(hud.taunt.dataset.icon, '⚔️', 'no player: a generic emblem');
});

test('the game sends AI lines to the taunt with its sound, players\' chat to the feed', () => {
  const shown = [];
  const played = [];
  const fake = {
    myIndex: 0,
    hud: { showTaunt: (l) => (shown.push(['taunt', l.text]), true), chat: (l) => shown.push(['chat', l.text]) },
  };
  const play = mock.method(sfx, 'play', (name) => played.push(name));
  try {
    Game.prototype.onChat.call(fake, { from: 1, name: 'AI', text: 'Kneel!', system: false, voice: true });
    Game.prototype.onChat.call(fake, { from: 1, name: 'Ann', text: 'gg', system: false });
    saveSettings({ aiChat: false });
    Game.prototype.onChat.call(fake, { from: 1, name: 'AI', text: 'Hidden', system: false, voice: true });
  } finally {
    saveSettings({ aiChat: true });
    play.mock.restore();
  }
  assert.deepEqual(shown, [['taunt', 'Kneel!'], ['chat', 'gg']]);
  assert.deepEqual(played, ['taunt', 'select']);
});

test('the stylesheet places it at the top centre, larger than the feed, still for reduced motion', async () => {
  const css = await readFile(new URL('../../src/ui/hud.css', import.meta.url), 'utf8');
  const rule = css.match(/\.hud-taunt \{[^}]*\}/)[0];
  assert.match(rule, /left: 50%/);
  assert.match(rule, /translateX\(-50%\)/);
  assert.match(rule, /pointer-events: none/);
  const size = Number(css.match(/\.hud-taunt-text \{[^}]*font: 700 ([\d.]+)em/)[1]);
  assert.ok(size > 1.18, 'larger than a feed card (1.18em)');
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.hud-taunt\.is-on \{ animation: none; \}/);
});
