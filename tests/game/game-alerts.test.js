// How the Game carries out an alert (src/game/game.js onAlert: the HUD line, sound, minimap ping,
// Space jump, tab flash and the pause on tips) and the tip on the loading screen (setLoading).
// Methods run on small fake Game objects, as the other game tests do.
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../../src/game/game.js';
import { sfx } from '../../src/audio/sfx.js';
import { HINTS, hintText } from '../../src/ui/hint-data.js';
import { saveSettings } from '../../src/settings.js';
import { installFakeDom } from '../ui/fake-dom.js';

before(() => {
  installFakeDom();
  saveSettings({ hints: true });
});
afterEach(() => {
  delete sfx.play;
  saveSettings({ hints: true });
});

/** A fake Game with a HUD that logs what it is asked to do, in order. */
function fake({ disposed = false, hud = true, input = true, tab = true } = {}) {
  const log = [];
  const game = {
    disposed,
    hud: hud && {
      message: (text, kind) => log.push(['message', text, kind]),
      minimap: { ping: (x, y, color) => log.push(['ping', x, y, color]) },
      holdHints: () => log.push(['holdHints']),
    },
    input: input && { noteAlert: (x, y) => log.push(['jump', x, y]) },
    tab: tab && { attention: (text) => log.push(['tab', text]) },
  };
  sfx.play = (name, opts) => {
    log.push(['sound', name, opts]);
    return true;
  };
  return { game, log };
}

const onAlert = (game, alert) => Game.prototype.onAlert.call(game, alert);

// ---------------------------------------------------------------- the alert sink

test('an alert is carried out in full: line, sound, ping, Space jump, tab flash, and no tip for a while', () => {
  const { game, log } = fake();
  onAlert(game, {
    text: 'Your base is under attack!',
    kind: 'alert',
    sound: 'drums',
    volume: 0.8,
    ping: { x: 12, y: 30, color: '#ff4040' },
    jump: { x: 12, y: 30 },
    attention: 'Your base is under attack!',
  });
  assert.deepEqual(log, [
    ['message', 'Your base is under attack!', 'alert'],
    ['sound', 'drums', { volume: 0.8 }],
    ['ping', 12, 30, '#ff4040'],
    ['jump', 12, 30],
    ['tab', 'Your base is under attack!'],
    ['holdHints'],
  ]);
});

test('a warning the settings silenced (only the tab flash is left) does not clear a tip; any part shown does', () => {
  const { game, log } = fake();
  onAlert(game, { kind: 'alert', attention: 'An enemy unit has been sighted near your base!' });
  assert.deepEqual(log, [['tab', 'An enemy unit has been sighted near your base!']], 'the player saw nothing, so the tip stays');
  log.length = 0;
  onAlert(game, { kind: 'alert', sound: 'drums' });
  onAlert(game, { kind: 'alert', ping: { x: 1, y: 2, color: '#fff' } });
  onAlert(game, { kind: 'alert', jump: { x: 3, y: 4 } });
  onAlert(game, { kind: 'alert', text: 'An ally is under attack!' });
  assert.equal(log.filter((l) => l[0] === 'holdHints').length, 4);
});

test('a friendly reminder is a line and a sound, and does not clear a tip', () => {
  const { game, log } = fake();
  onAlert(game, { text: 'Your Barracks is ready.', kind: 'info', sound: 'nudge', volume: 0.5 });
  assert.deepEqual(log, [
    ['message', 'Your Barracks is ready.', 'info'],
    ['sound', 'nudge', { volume: 0.5 }],
  ]);
});

test('an alert with only some parts does only those', () => {
  const { game, log } = fake();
  onAlert(game, { sound: 'milestone' });
  onAlert(game, { ping: { x: 1, y: 2, color: '#fff' } });
  onAlert(game, {});
  assert.deepEqual(log, [['sound', 'milestone', { volume: undefined }], ['ping', 1, 2, '#fff']]);
});

test('a Game without a tab flasher or an input, one that is gone, or one with no HUD yet, shrugs it off', () => {
  const bare = fake({ input: false, tab: false });
  onAlert(bare.game, { text: 'Hello', kind: 'info', jump: { x: 1, y: 1 }, attention: 'Hello' });
  assert.deepEqual(bare.log, [['message', 'Hello', 'info']]);

  const gone = fake({ disposed: true });
  onAlert(gone.game, { text: 'Hello', kind: 'alert', sound: 'drums' });
  assert.deepEqual(gone.log, []);

  const early = fake({ hud: false });
  assert.doesNotThrow(() => onAlert(early.game, { text: 'Hello', kind: 'alert', sound: 'drums' }));
  assert.deepEqual(early.log, []);
});

// ---------------------------------------------------------------- the loading screen

/** A fake Game on a root element; the loading node is what setLoading puts in it. */
function loading() {
  const root = document.createElement('div');
  return { game: { root, loadingEl: null }, root };
}
const setLoading = (game, on) => Game.prototype.setLoading.call(game, on);
const plain = (text) => text.replace(/\[\[(.+?)\]\]/g, '$1');

test('the loading screen gives a tip, with its keys as key caps', () => {
  const realRandom = Math.random;
  try {
    const general = HINTS.filter((h) => !h.when);
    const withKeys = general.find((h) => /\[\[/.test(hintText(h)));
    assert.ok(withKeys, 'at least one general tip names a key');
    const keys = (hintText(withKeys).match(/\[\[.+?\]\]/g) || []).length;
    Math.random = () => general.indexOf(withKeys) / general.length;
    const { game, root } = loading();
    setLoading(game, true);
    assert.equal(root.textContent, `Preparing the battlefield…Tip: ${plain(hintText(withKeys))}`);
    assert.equal(root.all('kbd').length, keys);
    assert.ok(root.find('hud-spinner'));
    assert.equal(game.loadingEl.getAttribute('role'), 'status');
    setLoading(game, false);
    assert.equal(root.children.length, 0);
    assert.equal(game.loadingEl, null);
  } finally {
    Math.random = realRandom;
  }
});

test('every general tip reads well on the loading screen; asking twice shows one card', () => {
  const realRandom = Math.random;
  try {
    const general = HINTS.filter((h) => !h.when);
    for (let i = 0; i < general.length; i++) {
      Math.random = () => i / general.length;
      const { game, root } = loading();
      setLoading(game, true);
      setLoading(game, true);
      assert.equal(root.children.length, 1);
      assert.ok(root.textContent.endsWith(plain(hintText(general[i]))), general[i].id);
      setLoading(game, false);
    }
  } finally {
    Math.random = realRandom;
  }
});

test('with gameplay tips turned off the loading screen has no tip', () => {
  saveSettings({ hints: false });
  const { game, root } = loading();
  setLoading(game, true);
  assert.equal(root.textContent, 'Preparing the battlefield…');
  assert.equal(root.all('kbd').length, 0);
  setLoading(game, false);
  assert.equal(root.children.length, 0);
});
