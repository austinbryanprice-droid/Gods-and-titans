// The F10 menu's Controls (src/ui/hud-overlays.js openControls): How to Play's mouse and hotkey tables
// (src/ui/menu-howto.js renderControls), read only, showing the player's own camera keys (src/ui/key-bindings.js)
// and, in the Grid layout, the card's keys. Fake DOM.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installFakeDom } from './fake-dom.js';
import { saveSettings } from '../../src/settings.js';
import { Overlays } from '../../src/ui/hud-overlays.js';

before(() => {
  installFakeDom();
  FakeElement.prototype.querySelectorAll = () => [];
  globalThis.requestAnimationFrame = () => 0;
});
after(() => saveSettings({ keyBindings: {}, cardKeys: 'classic' }));

function controls() {
  const root = document.createElement('div');
  const game = { session: null, viewState: { myIndex: 0, time: 125, me: { defeated: false } }, setPaused: () => false, quitToMenu() {}, surrender() {} };
  const ov = new Overlays(root, game);
  ov.openMenu();
  root.button('Controls').click();
  return { root, ov };
}

const rowOf = (root, text) => root.all('tr').find((r) => r.children[1] && r.children[1].textContent === text);
const keysOf = (row) => row.all('kbd').map((k) => k.textContent);

test('Controls lists How to Play\'s tables with the default keys, and Back returns to the game menu', () => {
  saveSettings({ keyBindings: {}, cardKeys: 'classic' });
  const { root, ov } = controls();
  assert.equal(ov.name, 'controls');
  for (const part of ['Mouse', 'Units', 'Worshippers', 'Buildings', 'Camera & groups', 'Team signals', 'Attack-move (then click the ground)', 'Box-select units']) {
    assert.ok(root.textContent.includes(part), part);
  }
  assert.deepEqual(keysOf(rowOf(root, 'Center on selection or the last alert')), ['Space']);
  assert.deepEqual(keysOf(rowOf(root, 'Zoom in and out from the keyboard')), ['=', '-']);
  assert.equal(root.all('button').filter((b) => b.className.includes('mw-key-btn')).length, 0, 'read only: no key buttons');
  assert.equal(root.textContent.includes('Command keys: Grid'), false);
  root.button('Back').click();
  assert.equal(ov.name, 'menu');
});

test('Controls shows the player\'s rebound camera keys and, in the Grid layout, the card\'s keys', () => {
  saveSettings({ keyBindings: { cam_jump: 'J', cam_up: 'I', card_0: 'Y' }, cardKeys: 'grid' });
  const { root, ov } = controls();
  assert.deepEqual(keysOf(rowOf(root, 'Center on selection or the last alert')), ['J']);
  assert.deepEqual(keysOf(rowOf(root, 'Move the camera (also the screen edge, a middle-drag or the minimap)')), ['I', '↓', '←', '→']);
  assert.match(root.textContent, /Command keys: Grid\. The card's buttons take Y W E R · A S D F · Z X C V by place/);
  ov.escape();
  assert.equal(ov.name, 'menu', 'Esc goes back to the game menu');
});
