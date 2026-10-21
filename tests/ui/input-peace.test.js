// Orders during the Decade of Peace (src/ui/input.js): a right-click or attack order on another
// player's unit still goes to the sim (which turns it into a walk and says why), but the marker is a
// walk, not a sword, and the cursor shows no attack over a protected player. Creatures stay targets.
// Real World + ViewState, a stub renderer and HUD, the fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InputController } from '../../src/ui/input.js';
import { makeWorld, spawn, clearUnits } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';
import { NEUTRAL } from '../../src/config.js';

before(installFakeDom);

function setup(opts = {}) {
  const world = makeWorld({ peaceMinutes: 30, ...opts });
  clearUnits(world, 0);
  clearUnits(world, 1);
  const mine = spawn(world, 0, 'warrior', 10, 14);
  const rival = spawn(world, 1, 'warrior', 14, 14);
  const creep = spawn(world, NEUTRAL, 'warrior', 10, 20);
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  let clock = 0;
  const push = (time) => {
    const snap = world.getSnapshot();
    vs.pushSnapshot(time === undefined ? snap : { ...snap, time }, (clock += 50));
  };
  push();
  const sel = new Selection(vs);
  sel.set([mine.id]);
  const sent = [];
  const markers = [];
  const errors = [];
  let picked = null;
  const game = {
    viewState: vs,
    selection: sel,
    renderer: {
      pickEntity: () => (picked ? picked.id : null),
      screenToWorld: (x, y) => ({ x, y }),
      showCommandMarker: (x, y, kind) => markers.push(kind),
      hidePlacement() {},
      setSelection() {},
      camera: { centerOn() {}, zoomBy() {} },
    },
    command: (c) => sent.push(c),
    setShowAllBars() {},
  };
  const input = new InputController({ game, canvas: document.createElement('canvas'), overlayRoot: document.createElement('div') });
  game.input = input;
  game.hud = { message: (text) => errors.push(text), refreshCard() {}, flashSlot() {}, chatOpen: false, currentCard: () => [] };
  const pick = (u) => {
    picked = u;
    input.hoverId = u ? u.id : null;
  };
  return { world, vs, push, input, sent, markers, errors, mine, rival, creep, pick };
}

test('right-clicking a rival in the peace sends the smart order but marks a walk; a creature is an attack', () => {
  const { input, sent, markers, rival, creep, pick } = setup();
  pick(rival);
  input.smartAt(14, 14, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'smart');
  assert.equal(sent[0].target, rival.id, 'the sim decides, and tells the player why');
  assert.deepEqual(markers, ['move']);
  pick(creep);
  input.smartAt(10, 20, false);
  assert.deepEqual(markers, ['move', 'attack']);
});

test('once the peace is over the same click is an attack marker again', () => {
  const { input, markers, rival, pick, push } = setup();
  push(1800);
  pick(rival);
  input.smartAt(14, 14, false);
  assert.deepEqual(markers, ['attack']);
});

test('the sword cursor shows over creatures, not over a protected rival, and comes back with the war', () => {
  const { input, rival, creep, pick, push } = setup();
  pick(rival);
  input.updateCursor();
  assert.equal(input.cursor, 'select');
  pick(creep);
  input.updateCursor();
  assert.equal(input.cursor, 'enemy');
  input.mode = { kind: 'target' };
  pick(rival);
  input.updateCursor();
  assert.equal(input.cursor, 'target');
  pick(creep);
  input.updateCursor();
  assert.equal(input.cursor, 'target-enemy');
  push(1800);
  pick(rival);
  input.updateCursor();
  assert.equal(input.cursor, 'target-enemy');
  input.mode = { kind: 'normal' };
  input.updateCursor();
  assert.equal(input.cursor, 'enemy');
});

test('a normal game keeps the sword over a rival', () => {
  const { input, markers, rival, pick } = setup({ peaceMinutes: 0 });
  pick(rival);
  input.updateCursor();
  assert.equal(input.cursor, 'enemy');
  input.smartAt(14, 14, false);
  assert.deepEqual(markers, ['attack']);
});
