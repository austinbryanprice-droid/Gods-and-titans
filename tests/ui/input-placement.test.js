// Shift multi-placement (src/ui/input.js + src/game/placement.js): a spot
// already planned in this Shift placement, or a selected worker's pending
// build, shows red and cannot be ordered (and paid) a second time; the planned
// spots are drawn, and forgotten when the placement ends. And the Decade of
// Peace's kept-clear ground: the renderer is told the enemy Town Centers whose
// surroundings are tinted, a tip beside the cursor says why the ghost is red,
// and a click there is refused before it reaches the sim. Real World +
// ViewState, a fake renderer and DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InputController } from '../../src/ui/input.js';
import { makeWorld } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

function setup(worldOpts = {}, seeAll = false) {
  const world = makeWorld(worldOpts);
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  let clock = 0;
  const push = () => vs.pushSnapshot(world.getSnapshot(), (clock += 50));
  push();
  if (seeAll) {
    vs.explored.fill(1);
    vs.visible.fill(1);
  }
  const sel = new Selection(vs);
  const worker = world.unitsOf(0).find((u) => u.type === 'worshipper');
  sel.set([worker.id]);
  const sent = [];
  const errors = [];
  const ghosts = [];
  const zones = [];
  let planned = [];
  const renderer = {
    pickEntity: () => null,
    screenToWorld: (x, y) => ({ x, y }), // canvas px = tiles, for the test
    showCommandMarker() {},
    hidePlacement() {},
    showPlacement: (b, tx, ty, valid) => ghosts.push({ b, tx, ty, valid }),
    setPlannedBuilds: (list) => (planned = list.slice()),
    setNoBuildZones: (list) => zones.push(list.map((a) => ({ ...a }))),
    setSelection() {},
    setHover() {},
    camera: { centerOn() {} },
  };
  const hud = { message: (text, kind) => kind === 'error' && errors.push(text), refreshCard() {}, overlays: { open: false }, chatOpen: false };
  const game = {
    viewState: vs,
    selection: sel,
    renderer,
    hud,
    command: (c) => {
      sent.push(c);
      world.issueCommand(0, c);
    },
    setShowAllBars() {},
  };
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 });
  const input = new InputController({ game, canvas, overlayRoot: document.createElement('div') });
  /** The ghost the next frame shows with the mouse over (x, y). */
  const ghostAt = (x, y, shift) => {
    input.onMouseMove({ clientX: x, clientY: y, shiftKey: shift, target: canvas });
    input.placeAt = -1e9;
    input.update(0.016);
    return ghosts[ghosts.length - 1];
  };
  return { world, vs, push, worker, input, sent, errors, ghostAt, zones, planned: () => planned };
}

test('Shift placement: a spot planned a moment ago is red and refused, the next one is fine', () => {
  const { world, push, input, sent, errors, ghostAt, planned } = setup();
  input.setMode({ kind: 'place', building: 'house' });
  // A House centred at (8, 13): footprint (7, 12).
  assert.equal(ghostAt(8, 13, true).valid, true);
  input.confirmPlace(8, 13, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(planned(), [{ b: 'house', tx: 7, ty: 12 }], 'drawn as planned');
  world.tick();
  push();
  const gold = world.players[0].gold;
  // The same spot again (before the worker got there): red, and no second order or payment.
  assert.equal(ghostAt(8, 13, true).valid, false);
  input.confirmPlace(8, 13, true);
  assert.equal(sent.length, 1, 'refused on the client');
  assert.deepEqual(errors, ['Another building is in the way.']);
  world.tick();
  assert.equal(world.players[0].gold, gold, 'not paid twice');
  // Overlapping by a column is refused too; a free spot next to it is fine.
  assert.equal(ghostAt(9, 13, true).valid, false);
  assert.equal(ghostAt(10, 13, true).valid, true);
  input.confirmPlace(10, 13, true);
  assert.equal(sent.length, 2);
  assert.equal(planned().length, 2);
  // Letting go of Shift ends the placement and forgets the plan.
  input.onKeyUp({ key: 'Shift', preventDefault() {} });
  assert.equal(input.mode.kind, 'normal');
  assert.deepEqual(planned(), []);
  input.dispose();
});

test('a selected worker\'s pending build (from the snapshot) blocks a queued order there, not a replacing one', () => {
  const { world, push, worker, input, ghostAt } = setup();
  input.setMode({ kind: 'place', building: 'house' });
  input.confirmPlace(8, 13, false); // plain click: the worker walks there
  world.tick();
  push();
  assert.deepEqual(input.vs.entities.get(worker.id).bo, { b: 'house', tx: 7, ty: 12 });
  input.setMode({ kind: 'place', building: 'house' });
  assert.equal(ghostAt(8, 13, true).valid, false, 'queueing a second House there would fail');
  assert.equal(ghostAt(8, 13, false).valid, true, 'a new plain order replaces the old one');
  input.dispose();
});

// ---------------------------------------------------------------- Decade of Peace

/** Player 0's Town Center covers tiles 6..9 and player 1's 60..63 of a 96×96 map; the peace lasts 30 minutes. */
const PEACE = { map: { width: 96, height: 96, starts: [{ x: 6, y: 6 }, { x: 60, y: 60 }] }, peaceMinutes: 30 };
const PEACE_TIP = /^The Decade of Peace holds for another \d+:\d\d:\nno building near an enemy Town Center yet\.$/;

test('Decade of Peace: the ghost is red beside an enemy Town Center, a tip says why, and the renderer gets the ground once', () => {
  const { world, input, ghostAt, zones } = setup(PEACE, true);
  input.setMode({ kind: 'place', building: 'house' });
  // A House centred at (40, 62) has its top-left tile at (39, 61): 19 empty tiles from the Town Center.
  const red = ghostAt(40, 62);
  assert.equal(red.valid, false);
  assert.deepEqual(zones, [[{ tx: 60, ty: 60, size: 4 }]], 'told the Town Center once, before the ghost');
  assert.equal(input.wallTip.hidden, false);
  assert.match(input.wallTip.textContent, PEACE_TIP);
  assert.equal(input.wallTip.classList.contains('is-bad'), true);
  assert.equal(world.placementError(0, 'house', 39, 61).replace(': ', ':\n'), input.wallTip.textContent, 'the sim\'s words');
  // One step back (20 empty tiles) is fine: green, no tip.
  assert.equal(ghostAt(39, 62).valid, true);
  assert.equal(input.wallTip.hidden, true);
  assert.equal(ghostAt(40, 62).valid, false);
  assert.equal(input.wallTip.hidden, false);
  assert.equal(zones.length, 1, 'nothing new to tell');
  // Leaving the placement takes the tip away.
  input.setMode({ kind: 'normal' });
  assert.equal(input.wallTip.hidden, true);
  input.dispose();
});

test('Decade of Peace: a click in the kept-clear ground is refused with the reason and sends nothing', () => {
  const { world, worker, input, sent, errors, ghostAt } = setup(PEACE, true);
  input.setMode({ kind: 'place', building: 'house' });
  ghostAt(40, 62);
  input.confirmPlace(40, 62, false);
  assert.equal(sent.length, 0);
  assert.deepEqual(errors, [world.placementError(0, 'house', 39, 61)]);
  assert.equal(input.mode.kind, 'place', 'the placement stays open for another spot');
  input.confirmPlace(39, 62, false);
  assert.deepEqual(sent.map((c) => [c.type, c.building, c.tx, c.ty, c.units]), [['build', 'house', 38, 61, [worker.id]]], 'one tile further it is ordered');
  assert.equal(input.mode.kind, 'normal');
  input.dispose();
});

test('Decade of Peace: no tip and no zone in a normal game, nor once the peace has run out', () => {
  const normal = setup({ ...PEACE, peaceMinutes: 0 }, true);
  normal.input.setMode({ kind: 'place', building: 'house' });
  assert.equal(normal.ghostAt(40, 62).valid, true);
  assert.equal(normal.input.wallTip.hidden, true);
  assert.deepEqual(normal.zones, [], 'the renderer never hears of a zone');
  normal.input.dispose();

  const { vs, world, input, ghostAt, zones } = setup(PEACE, true);
  input.setMode({ kind: 'place', building: 'house' });
  assert.equal(ghostAt(40, 62).valid, false);
  assert.equal(zones.length, 1);
  // The clock runs past the peace: the ground is free, the tip gone and the zone cleared.
  vs.pushSnapshot({ ...world.getSnapshot(), time: 30 * 60 }, 1000);
  assert.equal(vs.peaceActive(), false);
  assert.equal(ghostAt(40, 62).valid, true);
  assert.equal(input.wallTip.hidden, true);
  assert.deepEqual(zones, [[{ tx: 60, ty: 60, size: 4 }], []]);
  input.dispose();
});

test('Decade of Peace: a renderer without zones (older stubs) still places', () => {
  const { input, ghostAt } = setup(PEACE, true);
  input.renderer.setNoBuildZones = undefined;
  input.setMode({ kind: 'place', building: 'house' });
  assert.equal(ghostAt(40, 62).valid, false);
  assert.equal(input.wallTip.hidden, false, 'the tip does not need the zone');
  input.dispose();
});
