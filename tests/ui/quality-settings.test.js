// Graphics quality in the F10 menu of a match: the renderer changes quality live (game.js onSettings),
// so a player whose match runs slowly can lower it without leaving the game. Same four choices and
// notes as the title screen's Settings. Fake DOM.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDom } from './fake-dom.js';
import { getSettings, saveSettings, QUALITY_LEVELS } from '../../src/settings.js';
import { QUALITY_OPTIONS } from '../../src/ui/speed-options.js';
import { Overlays } from '../../src/ui/hud-overlays.js';

before(() => {
  installFakeDom();
  FakeElement.prototype.querySelectorAll = () => [];
  globalThis.requestAnimationFrame = () => 0;
});

beforeEach(() => saveSettings({ quality: 'medium' }));

function f10Quality() {
  const root = document.createElement('div');
  const game = { session: null, viewState: { myIndex: 0, time: 125, me: { defeated: false } }, setPaused: () => false, quitToMenu() {}, surrender() {} };
  new Overlays(root, game).openMenu();
  const row = root.findAll('hud-choice').find((c) => c.find('hud-choice-label').textContent === 'Graphics quality');
  return row && { buttons: row.findAll('mw-seg'), note: () => row.find('hud-choice-note').textContent };
}

test('the quality choices cover every quality level the settings accept', () => {
  assert.deepEqual(QUALITY_OPTIONS.map((o) => o[0]), [...QUALITY_LEVELS]);
});

test('F10 menu: Graphics quality shows the current level and saves a new one', () => {
  const q = f10Quality();
  assert.ok(q, 'the F10 menu has a Graphics quality row');
  assert.deepEqual(q.buttons.map((b) => b.textContent), ['Low', 'Medium', 'High', 'Ultra']);
  // (the fake DOM keeps the starting class name apart from the class list a click lights)
  assert.equal(q.buttons.find((b) => b.className.split(' ').includes('is-active')).textContent, 'Medium');
  q.buttons.find((b) => b.textContent === 'Low').click();
  assert.equal(getSettings().quality, 'low');
  assert.equal(q.note(), QUALITY_OPTIONS[0][2]);
});
