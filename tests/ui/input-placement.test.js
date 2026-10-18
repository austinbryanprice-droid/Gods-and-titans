// Shift multi-placement (src/ui/input.js + src/game/placement.js): a spot
// already planned in this Shift placement, or a selected worker's pending
// build, shows red and cannot be ordered (and paid) a second time; the planned
// spots are drawn, and forgotten when the placement ends. Real World +
// ViewState, a fake renderer and DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InputController } from '../../src/ui/input.js';
import { makeWorld } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

function setup() {
  const world = makeWorld();
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  let clock = 0;
  const push = () => vs.pushSnapshot(world.getSnapshot(), (clock += 50));
  push();
  const sel = new Selection(vs);
  const worker = world.unitsOf(0).find((u) => u.type === 'worshipper');
  sel.set([worker.id]);
  const sent = [];
  const errors = [];
  const ghosts = [];
  let planned = [];
  const renderer = {
    pickEntity: () => null,
    screenToWorld: (x, y) => ({ x, y }), // canvas px = tiles, for the test
    showCommandMarker() {},
    hidePlacement() {},
    showPlacement: (b, tx, ty, valid) => ghosts.push({ b, tx, ty, valid }),
    setPlannedBuilds: (list) => (planned = list.slice()),
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
  return { world, vs, push, worker, input, sent, errors, ghostAt, planned: () => planned };
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
