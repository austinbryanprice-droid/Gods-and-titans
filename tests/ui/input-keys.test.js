// Keyboard and wheel handling in src/ui/input.js: another command hotkey replaces a
// pending targeting / placement order, key auto-repeat acts once (except Train),
// Esc / F10 still reach the menu from a focused toggle or slider, the wheel zooms by
// the size of the scroll, and the build menu does not outlive its worker selection.
// Real World + ViewState, a stub renderer and HUD, the fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InputController } from '../../src/ui/input.js';
import { getCommandCard, withCardKeys } from '../../src/ui/command-card.js';
import { cardKeysOf } from '../../src/ui/key-bindings.js';
import { getSettings, saveSettings, _resetSettingsForTests } from '../../src/settings.js';
import { makeWorld, spawn } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

function setup() {
  const world = makeWorld();
  Object.assign(world.players[0], { gold: 5000, wood: 5000, faith: 5000 });
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  const push = () => vs.pushSnapshot(world.getSnapshot(), push.clock = (push.clock || 0) + 50);
  const warrior = spawn(world, 0, 'warrior', 10, 14);
  push();
  const sel = new Selection(vs);
  const sent = [];
  const zooms = [];
  const calls = { escape: 0, openMenu: 0, openChat: 0 };
  const overlays = { open: false, name: null, escape: () => calls.escape++, openMenu: () => calls.openMenu++ };
  const game = {
    viewState: vs,
    selection: sel,
    renderer: {
      pickEntity: () => null,
      screenToWorld: (x, y) => ({ x, y }),
      showCommandMarker() {},
      hidePlacement() {},
      setSelection() {},
      camera: { centerOn() {}, zoomBy: (n) => zooms.push(n) },
    },
    command: (c) => sent.push(c),
    setShowAllBars() {},
  };
  const input = new InputController({ game, canvas: document.createElement('canvas'), overlayRoot: document.createElement('div') });
  game.input = input;
  game.hud = {
    message() {},
    refreshCard() {},
    flashSlot() {},
    openChat: () => calls.openChat++,
    overlays,
    chatOpen: false,
    currentCard: () => getCommandCard(sel.forCard(), vs, input.cardMode()),
  };
  const key = (k, extra = {}) => input.onKeyDown({ key: k, code: '', preventDefault() {}, target: document.body, ...extra });
  return { world, vs, sel, input, sent, zooms, calls, overlays, warrior, key, push };
}

const workersOf = (world) => world.unitsOf(0).filter((u) => u.type === 'worshipper').map((u) => u.id);

test('another command hotkey replaces a pending targeting order (A then S stops)', () => {
  const { sel, input, sent, warrior, key } = setup();
  sel.set([warrior.id]);
  key('a');
  assert.equal(input.mode.kind, 'target');
  key('s');
  assert.equal(input.mode.kind, 'normal');
  assert.deepEqual(sent.map((c) => c.type), ['stop']);
  // Esc still just cancels, and an unbound key leaves the order pending.
  key('a');
  key('z');
  assert.equal(input.mode.kind, 'target');
  key('Escape');
  assert.equal(input.mode.kind, 'normal');
  assert.equal(sent.length, 1);
  input.dispose();
});

test('while placing, another building hotkey switches the building', () => {
  const { world, sel, input, key } = setup();
  sel.set(workersOf(world).slice(0, 2));
  key('b');
  key('h');
  assert.deepEqual([input.mode.kind, input.mode.building], ['place', 'house']);
  key('s');
  assert.deepEqual([input.mode.kind, input.mode.building], ['place', 'shrine']);
  input.dispose();
});

test('key auto-repeat: holding B does not open the build menu and start placing; Train repeats', () => {
  const { world, sel, input, sent, key } = setup();
  sel.set(workersOf(world).slice(0, 2));
  key('b');
  key('b', { repeat: true });
  assert.equal(input.mode.kind, 'normal');
  assert.equal(input.menu, 'build');
  key('Escape');
  key('Escape', { repeat: true });
  assert.equal(input.menu, 'root');

  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  sel.set([tc.id]);
  key('w');
  key('w', { repeat: true });
  assert.equal(sent.filter((c) => c.type === 'train').length, 2, 'hold W to queue more');
  input.dispose();
});

test('Esc and F10 reach an open menu from a focused toggle or slider, not from a text field', () => {
  const { calls, overlays, key, input } = setup();
  overlays.open = true;
  overlays.name = 'menu';
  const target = (tagName, type) => ({ tagName, type });
  key('Escape', { target: target('INPUT', 'checkbox') });
  key('F10', { target: target('INPUT', 'range') });
  assert.equal(calls.escape, 2);
  key('Escape', { target: target('INPUT', 'text') });
  assert.equal(calls.escape, 2, 'typing in a text field keeps its keys');
  key('F10', { repeat: true });
  assert.equal(calls.escape, 2, 'holding F10 does not flicker the menu');
  // F5 / F11 / F12 keep working while the overlay is up; the browser's F1 / F3 do not.
  const prevented = [];
  for (const k of ['F1', 'F3', 'F5', 'F11', 'F12']) key(k, { preventDefault: () => prevented.push(k) });
  assert.deepEqual(prevented, ['F1', 'F3']);
  input.dispose();
});

test('the wheel zooms by the size of the scroll: a notch is one step, trackpad flecks are small', () => {
  const { input, zooms } = setup();
  const wheel = (deltaY, deltaMode = 0) => input.onWheel({ deltaY, deltaMode, preventDefault() {} });
  wheel(-100);
  wheel(100);
  wheel(-4);
  wheel(-300);
  wheel(3, 1); // Firefox: one notch is 3 lines
  wheel(0);
  assert.equal(zooms.length, 5);
  assert.ok(Math.abs(zooms[0] - 1) < 1e-9 && Math.abs(zooms[1] + 1) < 1e-9);
  assert.ok(zooms[2] > 0 && zooms[2] < 0.1, 'a fleck zooms a little');
  assert.equal(zooms[3], 3, 'one event is capped');
  assert.ok(zooms[4] < 0 && Math.abs(zooms[4] + 1) < 0.05, 'a line-mode notch is about one step');
  input.dispose();
});

test('the build menu closes when the active subgroup is not a worker', () => {
  const { world, sel, input, warrior } = setup();
  sel.set([...workersOf(world).slice(0, 3), warrior.id]);
  sel.activeType = 'worshipper';
  input.menu = 'build';
  assert.equal(input.cardMode(), 'build');
  // A unit icon in the selection panel picks the warrior without going through afterSelect.
  sel.set([warrior.id]);
  assert.equal(input.cardMode(), 'root');
  assert.equal(input.menu, 'root');
  input.dispose();
});

test('camera keys are rebindable: a letter bound to the camera pans and stops reaching the card; zoom keys', () => {
  _resetSettingsForTests();
  const { sel, input, sent, zooms, warrior, key } = setup();
  sel.set([warrior.id]);
  key('ArrowUp');
  assert.deepEqual([...input.keys], ['cam_up']);
  input.onKeyUp({ key: 'ArrowUp', preventDefault() {} });
  assert.deepEqual([...input.keys], []);
  key('=');
  key('-', { repeat: true }); // held: keeps zooming
  assert.deepEqual(zooms, [1, -1]);
  saveSettings({ keyBindings: { cam_up: 'S', card_5: 'ArrowUp' } });
  key('s');
  assert.deepEqual([...input.keys], ['cam_up'], 'S pans now');
  assert.deepEqual(sent, [], 'and no longer stops');
  input.onKeyUp({ key: 'S', preventDefault() {} }); // let go with Shift held: the same key
  assert.deepEqual([...input.keys], []);
  key('ArrowUp'); // the arrow is free in the Classic layout: nothing happens
  assert.deepEqual([...input.keys], []);
  key('s', { ctrlKey: true }); // Ctrl+S is the browser's, not the camera's
  assert.deepEqual([...input.keys], []);
  input.dispose();
  _resetSettingsForTests();
});

test('Grid layout: keys press buttons by position, Esc still cancels, held Train repeats', () => {
  _resetSettingsForTests();
  saveSettings({ cardKeys: 'grid' });
  const { world, sel, input, sent, warrior, key, vs } = setup();
  const hud = input.game.hud;
  hud.currentCard = () => withCardKeys(getCommandCard(sel.forCard(), vs, input.cardMode()), cardKeysOf(getSettings()));
  sel.set([warrior.id]);
  const card = hud.currentCard();
  const stop = card.find((b) => b && b.id === 'stop');
  const gridKey = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F', 'Z', 'X', 'C', 'V'][stop.slot];
  assert.equal(stop.key, gridKey);
  key(gridKey.toLowerCase());
  assert.deepEqual(sent.map((c) => c.type), ['stop']);
  const attack = card.find((b) => b && b.id === 'attack');
  key(attack.key);
  assert.equal(input.mode.kind, 'target');
  key('Escape');
  assert.equal(input.mode.kind, 'normal');
  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  sel.set([tc.id]);
  const train = hud.currentCard().find((b) => b && b.action && b.action.kind === 'train');
  key(train.key);
  key(train.key, { repeat: true });
  assert.equal(sent.filter((c) => c.type === 'train').length, 2);
  input.dispose();
  _resetSettingsForTests();
});
