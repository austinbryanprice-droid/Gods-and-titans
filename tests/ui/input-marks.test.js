// Pinging and marking from the input controller (src/ui/input.js): Alt+click and the middle button
// ping the team on the map and the minimap, a click with a marker button armed places that marker, and
// none of it selects, orders, or steals the camera drag. Real World + ViewState, a stub renderer and
// HUD, the fake DOM.
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InputController } from '../../src/ui/input.js';
import { sfx } from '../../src/audio/sfx.js';
import { makeWorld, spawn, clearUnits } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(() => {
  installFakeDom();
  sfx.play = () => true;
});
afterEach(() => {
  sfx.play = () => true;
});

/** A click: canvas pixels are ten times the tile coordinates in this stub (screenToWorld divides by ten). */
const mouse = (button, x, y, extra = {}) => ({ button, clientX: x, clientY: y, shiftKey: false, ctrlKey: false, altKey: false, preventDefault() {}, ...extra });

function setup() {
  const world = makeWorld();
  clearUnits(world, 0);
  clearUnits(world, 1);
  const mine = spawn(world, 0, 'warrior', 10, 14);
  const rival = spawn(world, 1, 'warrior', 14, 14);
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  vs.pushSnapshot(world.getSnapshot(), 50);
  const sel = new Selection(vs);
  sel.set([mine.id]);
  const marks = [];
  const sent = [];
  const pans = [];
  const centered = [];
  const messages = [];
  const state = { picked: null, allow: true };
  const game = {
    viewState: vs,
    selection: sel,
    renderer: {
      pickEntity: () => (state.picked ? state.picked.id : null),
      screenToWorld: (x, y) => ({ x: x / 10, y: y / 10 }),
      showCommandMarker() {},
      hidePlacement() {},
      setSelection() {},
      camera: { centerOn: (x, y) => centered.push([x, y]), zoomBy() {}, panPixels: (dx, dy) => pans.push([dx, dy]) },
    },
    command: (c) => sent.push(c),
    sendMark: (kind, x, y) => {
      marks.push([kind, x, y]);
      return state.allow;
    },
    setShowAllBars() {},
  };
  const input = new InputController({ game, canvas: document.createElement('canvas'), overlayRoot: document.createElement('div') });
  game.input = input;
  game.hud = {
    message: (text, kind) => messages.push([text, kind]),
    refreshCard() {},
    flashSlot() {},
    chatOpen: false,
    currentCard: () => [],
    overlays: { open: false },
  };
  return { world, vs, sel, input, game, mine, rival, marks, sent, pans, centered, messages, state };
}

// ---------------------------------------------------------------- Alt+click on the map

test('Alt+click pings the ground under the cursor, and selects and orders nothing', () => {
  const { input, sel, mine, marks, sent } = setup();
  input.onMouseDown(mouse(0, 40, 50, { altKey: true }));
  input.onMouseUp(mouse(0, 40, 50, { altKey: true }));
  assert.deepEqual(marks, [['ping', 4, 5]]);
  assert.equal(input.leftDown, null, 'no selection box begins');
  assert.deepEqual(sel.ids, [mine.id], 'the selection is as it was');
  assert.deepEqual(sent, []);
});

test('Alt+click on a unit or building pings the spot where it stands', () => {
  const { input, rival, state, marks } = setup();
  state.picked = rival;
  input.onMouseDown(mouse(0, 5, 5, { altKey: true }));
  assert.deepEqual(marks, [['ping', rival.x, rival.y]]);
});

test('a plain click still selects, and a right-click still orders', () => {
  const { input, sel, rival, state, marks, sent } = setup();
  state.picked = rival;
  input.onMouseDown(mouse(2, 140, 140));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'smart');
  input.onMouseDown(mouse(0, 140, 140));
  input.onMouseUp(mouse(0, 140, 140));
  assert.deepEqual(sel.ids, [rival.id]);
  assert.deepEqual(marks, []);
});

test('with an order or a building pending, Alt+click is an ordinary click (it does not eat the order)', () => {
  const { input, marks, sent } = setup();
  input.setMode({ kind: 'target', order: 'attack', target: 'point' });
  input.onMouseDown(mouse(0, 100, 120, { altKey: true }));
  assert.deepEqual(marks, []);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'attackMove');
  assert.deepEqual([sent[0].x, sent[0].y], [10, 12]);
  assert.equal(input.mode.kind, 'normal');
});

test('a menu over the game takes the click: nothing is pinged', () => {
  const { input, game, marks } = setup();
  game.hud.overlays.open = true;
  input.onMouseDown(mouse(0, 40, 50, { altKey: true }));
  input.onMouseDown(mouse(1, 40, 50));
  input.onMouseUp(mouse(1, 40, 50));
  input.onMinimap({ button: 1, phase: 'down', x: 3, y: 4 });
  assert.equal(input.pingAt(3, 4), false);
  assert.deepEqual(marks, []);
});

// ---------------------------------------------------------------- the middle button

test('a middle click pings where it was pressed; the camera does not move', () => {
  const { input, marks, pans } = setup();
  input.onMouseDown(mouse(1, 60, 70));
  assert.ok(input.midDown);
  assert.equal(input.cursor, 'pan');
  input.onMouseUp(mouse(1, 60, 70));
  assert.deepEqual(marks, [['ping', 6, 7]]);
  assert.equal(input.midDown, null);
  assert.equal(input.cursor, '');
  assert.deepEqual(pans, []);
});

test('a little shake of the hand is still a click: the ping is where the press was, and the camera stays', () => {
  const { input, marks, pans } = setup();
  input.onMouseDown(mouse(1, 60, 70));
  input.onMouseMove(mouse(1, 62, 71));
  input.onMouseMove(mouse(1, 58, 68));
  input.onMouseUp(mouse(1, 58, 68));
  assert.deepEqual(marks, [['ping', 6, 7]]);
  assert.deepEqual(pans, []);
});

test('dragging with the middle button still moves the camera, from where the press began, and pings nothing', () => {
  const { input, marks, pans } = setup();
  input.onMouseDown(mouse(1, 60, 70));
  input.onMouseMove(mouse(1, 100, 70));
  input.onMouseMove(mouse(1, 110, 75));
  input.onMouseUp(mouse(1, 110, 75));
  assert.deepEqual(pans, [[40, 0], [10, 5]], 'no jump when the drag starts, then smooth');
  assert.deepEqual(marks, []);
});

test('a middle press held for a while is not a click', () => {
  const { input, marks } = setup();
  input.onMouseDown(mouse(1, 60, 70));
  input.midDown.t -= 1000;
  input.onMouseUp(mouse(1, 60, 70));
  assert.deepEqual(marks, []);
});

test('a middle click on a unit pings the unit’s spot, and works with an order pending', () => {
  const { input, rival, state, marks } = setup();
  state.picked = rival;
  input.setMode({ kind: 'target', order: 'move', target: 'point' });
  input.onMouseDown(mouse(1, 5, 5));
  input.onMouseUp(mouse(1, 5, 5));
  assert.deepEqual(marks, [['ping', rival.x, rival.y]]);
  assert.equal(input.mode.kind, 'target', 'the pending order is still pending');
});

test('losing the window mid-press drops the press without a ping', () => {
  const { input, marks } = setup();
  input.onMouseDown(mouse(1, 60, 70));
  input.onBlur();
  input.onMouseUp(mouse(1, 60, 70));
  assert.deepEqual(marks, []);
});

// ---------------------------------------------------------------- the minimap

test('on the minimap the middle button and Alt+click ping; the left button still moves the camera', () => {
  const { input, marks, centered } = setup();
  input.onMinimap({ button: 1, phase: 'down', x: 12.5, y: 20, shift: false, alt: false });
  input.onMinimap({ button: 0, phase: 'down', x: 30, y: 31, shift: false, alt: true });
  assert.deepEqual(marks, [['ping', 12.5, 20], ['ping', 30, 31]]);
  assert.deepEqual(centered, []);
  input.onMinimap({ button: 1, phase: 'up', x: 1, y: 1 });
  assert.equal(marks.length, 2, 'only the press pings');
  input.onMinimap({ button: 0, phase: 'down', x: 5, y: 6, shift: false, alt: false });
  input.onMinimap({ button: 0, phase: 'drag', x: 7, y: 8, shift: false, alt: false });
  assert.deepEqual(centered, [[5, 6], [7, 8]]);
});

test('on the minimap Alt+click with an order pending is the order’s click', () => {
  const { input, marks, sent } = setup();
  input.setMode({ kind: 'target', order: 'attack', target: 'point' });
  input.onMinimap({ button: 0, phase: 'down', x: 30, y: 31, shift: false, alt: true });
  assert.deepEqual(marks, []);
  assert.equal(sent[0].type, 'attackMove');
});

// ---------------------------------------------------------------- the marker buttons

test('arming a marker makes the next click a marker; the same button again puts it away', () => {
  const { input, messages } = setup();
  input.armMark('attack');
  assert.equal(input.marking(), true);
  assert.deepEqual(input.mode, { kind: 'target', order: 'mark', mark: 'attack', target: 'point' });
  assert.equal(input.cardMode(), 'target', 'the command card offers Cancel');
  assert.match(messages[0][0], /Attack: click the map or the minimap/);
  input.updateCursor();
  assert.equal(input.cursor, 'target');
  input.armMark('help');
  assert.equal(input.mode.mark, 'help', 'another button swaps the marker');
  input.armMark('help');
  assert.equal(input.mode.kind, 'normal');
  assert.equal(input.marking(), false);
  input.armMark('nuke');
  assert.equal(input.mode.kind, 'normal', 'not a kind');
});

test('a click on the map places the armed marker where the cursor is, once, and orders nothing', () => {
  const { input, sel, mine, marks, sent } = setup();
  input.armMark('defend');
  input.onMouseDown(mouse(0, 80, 90));
  assert.deepEqual(marks, [['defend', 8, 9]]);
  assert.equal(input.mode.kind, 'normal');
  assert.deepEqual(sent, []);
  assert.deepEqual(sel.ids, [mine.id]);
  input.onMouseDown(mouse(0, 80, 90));
  assert.equal(marks.length, 1, 'the next click is an ordinary click again');
});

test('a click on a unit marks the unit’s spot; Alt+click places the armed marker too, not a ping', () => {
  const { input, rival, state, marks } = setup();
  state.picked = rival;
  input.armMark('attack');
  input.onMouseDown(mouse(0, 5, 5, { altKey: true }));
  assert.deepEqual(marks, [['attack', rival.x, rival.y]]);
});

test('a click on the minimap places the armed marker, in world coordinates', () => {
  const { input, marks, centered } = setup();
  input.armMark('gather');
  input.onMinimap({ button: 0, phase: 'down', x: 20.5, y: 21, shift: false, alt: false });
  assert.deepEqual(marks, [['gather', 20.5, 21]]);
  assert.equal(input.mode.kind, 'normal');
  assert.deepEqual(centered, [], 'it did not also move the camera');
  input.armMark('help');
  input.onMinimap({ button: 0, phase: 'down', x: 3, y: 4, shift: false, alt: true });
  assert.deepEqual(marks[1], ['help', 3, 4], 'Alt+click while armed places the marker, not a ping');
});

test('Shift keeps the marker armed for several clicks; letting go of Shift puts it away', () => {
  const { input, marks } = setup();
  input.armMark('attack');
  input.onMouseDown(mouse(0, 10, 10, { shiftKey: true }));
  input.onMouseDown(mouse(0, 20, 20, { shiftKey: true }));
  assert.equal(marks.length, 2);
  assert.equal(input.marking(), true);
  input.onKeyUp({ key: 'Shift' });
  assert.equal(input.mode.kind, 'normal');
});

test('when the game refuses the mark (too many in a row) the marker stays armed to try again', () => {
  const { input, marks, state } = setup();
  state.allow = false;
  input.armMark('attack');
  input.onMouseDown(mouse(0, 10, 10));
  assert.equal(marks.length, 1);
  assert.equal(input.marking(), true);
  state.allow = true;
  input.onMouseDown(mouse(0, 10, 10));
  assert.equal(input.marking(), false);
});

test('Esc and a right-click put an armed marker away without marking', () => {
  const { input, marks } = setup();
  input.armMark('attack');
  input.onKeyDown({ key: 'Escape', code: 'Escape', preventDefault() {}, repeat: false, target: null });
  assert.equal(input.marking(), false);
  input.armMark('defend');
  input.onMouseDown(mouse(2, 10, 10));
  assert.equal(input.marking(), false);
  assert.deepEqual(marks, []);
});

test('a marker button does nothing with a menu open', () => {
  const { input, game } = setup();
  game.hud.overlays.open = true;
  input.armMark('attack');
  assert.equal(input.mode.kind, 'normal');
});

test('a marker button replaces a building being placed, and another command hotkey replaces an armed marker', () => {
  const { input, sent } = setup();
  input.setMode({ kind: 'place', building: 'house' });
  input.armMark('ping');
  assert.equal(input.mode.order, 'mark');
  input.onKeyDown({ key: 's', code: 'KeyS', preventDefault() {}, repeat: false, target: null });
  assert.equal(input.marking(), false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'stop');
});
