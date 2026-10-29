// Rebindable keys (src/ui/key-bindings.js), the Grid layout of the command card (command-card.js
// withCardKeys) and the rebinding panel (src/ui/key-panel.js) on the fake DOM.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { KEY_ACTIONS, normKey, isBindableKey, cleanBindings, bindingsOf, rebind, actionOf, gridKeys, keyLabel, cardKeysOf, cameraLetterClashes } from '../../src/ui/key-bindings.js';
import { withCardKeys, buttonForKey } from '../../src/ui/command-card.js';
import { getSettings, saveSettings, _resetSettingsForTests } from '../../src/settings.js';
import { buildKeyPanel } from '../../src/ui/key-panel.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);
beforeEach(() => {
  delete globalThis.localStorage;
  _resetSettingsForTests();
});

test('defaults: arrows, = and -, Space and Home for the camera; Q W E R / A S D F / Z X C V for the grid', () => {
  const b = bindingsOf({});
  assert.equal(b.cam_up, 'ArrowUp');
  assert.equal(b.cam_zoom_in, '=');
  assert.equal(b.cam_jump, 'Space');
  assert.equal(b.cam_home, 'Home');
  assert.deepEqual(gridKeys(b), ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V']);
  // every default is bindable and no default key is used twice
  const keys = KEY_ACTIONS.map((a) => a.def);
  assert.ok(keys.every(isBindableKey));
  assert.equal(new Set(keys).size, keys.length);
});

test('normKey names keys the way bindings store them', () => {
  assert.equal(normKey({ key: 'q' }), 'Q');
  assert.equal(normKey({ key: 'Q' }), 'Q');
  assert.equal(normKey({ key: ' ' }), 'Space');
  assert.equal(normKey({ key: 'ArrowLeft' }), 'ArrowLeft');
  assert.equal(normKey({}), '');
});

test('reserved keys cannot be bound', () => {
  for (const k of ['Escape', 'Pause', 'F10', 'F1', 'Enter', 'Tab', 'Shift', 'Delete', 'Backspace', '1', '9', '.', '`', '', 'q', null]) assert.equal(isBindableKey(k), false, String(k));
  for (const k of ['W', '=', 'Space', 'PageUp', 'ArrowUp', 'Insert']) assert.equal(isBindableKey(k), true, k);
});

test('rebind swaps with the action that had the key, and keeps only changes', () => {
  let ch = rebind({}, 'cam_up', 'W'); // W was card_1
  assert.deepEqual(ch, { cam_up: 'W', card_1: 'ArrowUp' });
  const b = bindingsOf(ch);
  assert.equal(actionOf(b, 'W', 'camera'), 'cam_up');
  assert.equal(actionOf(b, 'W', 'card'), null);
  assert.equal(actionOf(b, 'ArrowUp', 'card'), 'card_1');
  ch = rebind(ch, 'cam_up', 'ArrowUp'); // back: both return to their defaults
  assert.deepEqual(ch, {});
  assert.equal(rebind({}, 'cam_up', 'Escape'), null);
  assert.equal(rebind({}, 'nope', 'K'), null);
  ch = rebind({}, 'cam_home', 'K'); // a free key: nothing else moves
  assert.deepEqual(ch, { cam_home: 'K' });
});

test('cleanBindings drops unknown actions, reserved keys, defaults and a key used twice', () => {
  assert.deepEqual(cleanBindings({ cam_up: 'ArrowUp', cam_down: 'Delete', x: 'K', cam_left: 'K', cam_right: 'K', cam_home: 'J' }), { cam_home: 'J' });
  assert.deepEqual(cleanBindings(rebind({}, 'cam_up', 'W')), { cam_up: 'W', card_1: 'ArrowUp' }); // a swap survives
  assert.deepEqual(cleanBindings(null), {});
  assert.deepEqual(cleanBindings({ cam_up: 'Q' }), {}); // Q is still card_0's: cam_up goes back
});

test('labels for named keys', () => {
  assert.equal(keyLabel('ArrowUp'), '↑');
  assert.equal(keyLabel('PageDown'), 'PgDn');
  assert.equal(keyLabel('Q'), 'Q');
});

test('a camera letter takes that letter away from the Classic card, and the panel says so', () => {
  assert.deepEqual(cameraLetterClashes(bindingsOf({})), []);
  assert.deepEqual(cameraLetterClashes(bindingsOf({ cam_up: 'W' })), [{ action: 'cam_up', key: 'W' }]);
});

const card = () => {
  const c = new Array(12).fill(null);
  c[0] = { slot: 0, id: 'move', key: 'M', keyLabel: 'M', passive: false };
  c[1] = { slot: 1, id: 'stop', key: 'S', keyLabel: 'S', passive: false };
  c[8] = { slot: 8, id: 'aura', key: null, keyLabel: '', passive: true };
  c[11] = { slot: 11, id: 'cancel', key: 'Escape', keyLabel: 'Esc', passive: false };
  return c;
};

test('Grid layout: each button takes its slot key; Cancel still answers Esc; passives stay keyless', () => {
  assert.equal(withCardKeys(card(), null)[0].key, 'M'); // Classic: untouched
  const g = withCardKeys(card(), cardKeysOf({ cardKeys: 'grid', keyBindings: { card_11: 'PageDown' } }));
  assert.equal(g[0].key, 'Q');
  assert.equal(g[1].key, 'W');
  assert.equal(g[8].key, null);
  assert.equal(g[11].key, 'PageDown');
  assert.equal(g[11].keyLabel, 'PgDn');
  assert.equal(buttonForKey(g, 'q').id, 'move');
  assert.equal(buttonForKey(g, 'M'), null);
  assert.equal(buttonForKey(g, 'Escape').id, 'cancel');
  assert.equal(buttonForKey(g, 'PageDown').id, 'cancel');
  assert.equal(cardKeysOf({ cardKeys: 'classic' }), null);
});

function fakeWin() {
  const handlers = [];
  return {
    handlers,
    addEventListener: (t, fn) => handlers.push(fn),
    removeEventListener: (t, fn) => handlers.splice(handlers.indexOf(fn), 1),
    press(key, extra = {}) {
      const e = { key, repeat: false, stopped: false, preventDefault() {}, stopPropagation() { this.stopped = true; }, ...extra };
      for (const h of [...handlers]) h(e);
      return e;
    },
  };
}

const find = (root, pred) => {
  if (pred(root)) return root;
  for (const c of root.children || root.childNodes || []) {
    const f = find(c, pred);
    if (f) return f;
  }
  return null;
};

test('panel: click a key, press a new one, it is saved; Esc keeps the old one; reset restores all', () => {
  const win = fakeWin();
  const panel = buildKeyPanel({ win });
  const up = find(panel.el, (n) => n.dataset && n.dataset.action === 'cam_up');
  assert.ok(up);
  assert.equal(up.textContent, '↑');
  // a key press with nothing waiting is not the panel's
  assert.equal(win.press('W').stopped, false);
  up.fire('click', { stopPropagation() {} });
  assert.equal(panel.waiting, 'cam_up');
  const esc = win.press('Escape');
  assert.equal(esc.stopped, true); // the menu's own Esc never sees it
  assert.equal(panel.waiting, null);
  assert.deepEqual({ ...getSettings().keyBindings }, {});
  up.fire('click', { stopPropagation() {} });
  win.press('Delete'); // refused: still waiting
  assert.equal(panel.waiting, 'cam_up');
  win.press('w');
  assert.equal(panel.waiting, null);
  assert.deepEqual({ ...getSettings().keyBindings }, { cam_up: 'W', card_1: 'ArrowUp' });
  assert.equal(up.textContent, 'W');
  const reset = find(panel.el, (n) => typeof n.className === 'string' && n.className.includes('mw-key-reset'));
  reset.fire('click', { stopPropagation() {} });
  assert.deepEqual({ ...getSettings().keyBindings }, {});
  assert.equal(up.textContent, '↑');
  panel.dispose();
  assert.equal(win.handlers.length, 0);
  saveSettings({ keyBindings: {} });
});
