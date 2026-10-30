// The army keys of src/ui/input.js: Ctrl+A selects every fighting unit (Ctrl+Alt+A only those on
// screen), "," cycles the idle ones (Shift: all of them), and P on a soldier's card aims a Patrol.
// Real World + ViewState, a stub renderer and HUD, the fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InputController } from '../../src/ui/input.js';
import { getCommandCard } from '../../src/ui/command-card.js';
import { armyIds } from '../../src/ui/hud-data.js';
import { isBindableKey } from '../../src/ui/key-bindings.js';
import { makeWorld, spawn } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

function setup() {
  const world = makeWorld();
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  const push = () => vs.pushSnapshot(world.getSnapshot(), push.clock = (push.clock || 0) + 50);
  const warrior = spawn(world, 0, 'warrior', 10, 14);
  const archer = spawn(world, 0, 'archer', 30, 14);
  const zeus = spawn(world, 0, 'greek_zeus', 12, 16);
  spawn(world, 1, 'warrior', 40, 40);
  push();
  const sel = new Selection(vs);
  const sent = [];
  const messages = [];
  const centred = [];
  const game = {
    viewState: vs,
    selection: sel,
    renderer: {
      pickEntity: () => null,
      screenToWorld: (x, y) => ({ x, y }),
      worldToScreen: (x, y) => ({ sx: x, sy: y }), // the screen is the map's top-left 20 × 48 tiles
      showCommandMarker() {},
      hidePlacement() {},
      setSelection() {},
      camera: { centerOn: (x, y) => centred.push([x, y]), zoomBy() {} },
    },
    command: (c) => sent.push(c),
    setShowAllBars() {},
  };
  const input = new InputController({ game, canvas: document.createElement('canvas'), overlayRoot: document.createElement('div') });
  input.rect = { left: 0, top: 0, width: 20, height: 48 };
  game.input = input;
  game.hud = {
    message: (text) => messages.push(text),
    refreshCard() {},
    flashSlot() {},
    overlays: { open: false },
    currentCard: () => getCommandCard(sel.forCard(), vs, input.cardMode()),
  };
  const key = (k, extra = {}) => input.onKeyDown({ key: k, code: '', preventDefault() {}, target: document.body, ...extra });
  return { world, vs, sel, input, sent, messages, centred, warrior, archer, zeus, key, push };
}

test('Ctrl+A selects the whole army, gods first and no Worshippers; Ctrl+Alt+A only what is on screen', () => {
  const { sel, input, centred, warrior, archer, zeus, key } = setup();
  key('a', { ctrlKey: true });
  assert.deepEqual(sel.ids, [zeus.id, warrior.id, archer.id]);
  assert.equal(centred.length, 0);
  key('a', { ctrlKey: true });
  assert.equal(centred.length, 1, 'a second tap jumps to the army');
  key('a', { metaKey: true, altKey: true, code: 'KeyA' }); // a Mac's Option+A types 'å'
  assert.deepEqual(sel.ids, [zeus.id, warrior.id], 'the archer at x 30 is off screen');
  input.dispose();
});

test('"," cycles the idle soldiers, skipping the ones holding a position or patrolling; Shift takes them all', () => {
  const { world, sel, input, warrior, archer, zeus, key, push } = setup();
  world.issueCommand(0, { type: 'hold', units: [warrior.id] });
  world.issueCommand(0, { type: 'patrol', units: [archer.id], x: 30, y: 30 });
  world.tick();
  push();
  assert.deepEqual(armyIds(input.vs, { idle: true }), [zeus.id]);
  world.issueCommand(0, { type: 'stop', units: [warrior.id] });
  world.tick();
  push();
  key(',');
  assert.deepEqual(sel.ids, [zeus.id]);
  key(',');
  assert.deepEqual(sel.ids, [warrior.id]);
  key(',');
  assert.deepEqual(sel.ids, [zeus.id], 'round again');
  key('<', { shiftKey: true, code: 'Comma' });
  assert.deepEqual(sel.ids, [zeus.id, warrior.id]);
  assert.equal(isBindableKey(','), false, '"," keeps its job like "."');
  input.dispose();
});

test('P then a click orders a Patrol (Shift queues it)', () => {
  const { sel, input, sent, warrior, archer, key } = setup();
  sel.set([warrior.id, archer.id]);
  const card = getCommandCard(sel.forCard(), input.vs, 'root');
  assert.equal(card[7].id, 'patrol');
  key('p');
  assert.deepEqual([input.mode.kind, input.mode.order], ['target', 'patrol']);
  input.confirmTarget(22, 30, null, true);
  assert.deepEqual(sent.at(-1), { type: 'patrol', units: [warrior.id, archer.id], x: 22, y: 30, queue: true });
  input.dispose();
});

test('the army keys tell you when there is no one to select', () => {
  const { world, input, messages, key, push } = setup();
  for (const u of world.unitsOf(0)) if (u.def.class !== 'worker') world.issueCommand(0, { type: 'hold', units: [u.id] });
  world.tick();
  push();
  key(',');
  assert.deepEqual(messages, ['No idle soldiers.']);
  input.dispose();
});
