// The Delete key (src/ui/input.js, src/ui/delete-key.js): it destroys the selected own units through
// the sim's `kill` command. A few plain units go at once; a bigger group, a god or a Titan asks for a
// second press first, which the player has DELETE_CONFIRM_MS to give with the same units selected.
// Real World + ViewState, a stub renderer and HUD, the fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PANTHEONS, godsFor } from '../../src/data/index.js';
import { ViewState } from '../../src/game/view-state.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InputController } from '../../src/ui/input.js';
import { deletePlan, DELETE_CONFIRM_ABOVE, DELETE_CONFIRM_MS } from '../../src/ui/delete-key.js';
import { HINTS, hintParts, hintText } from '../../src/ui/hint-data.js';
import { makeWorld, spawn, clearUnits } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

function setup() {
  const world = makeWorld();
  clearUnits(world, 0);
  clearUnits(world, 1);
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  let clock = 0;
  const push = () => vs.pushSnapshot(world.getSnapshot(), (clock += 50));
  const sel = new Selection(vs);
  const sent = [];
  const messages = [];
  const centered = [];
  const game = {
    viewState: vs,
    selection: sel,
    renderer: {
      pickEntity: () => null,
      screenToWorld: (x, y) => ({ x, y }),
      showCommandMarker() {},
      hidePlacement() {},
      setSelection() {},
      camera: { centerOn: (x, y) => centered.push([x, y]), zoomBy() {} },
    },
    command: (c) => sent.push(c),
    setShowAllBars() {},
  };
  const input = new InputController({ game, canvas: document.createElement('canvas'), overlayRoot: document.createElement('div') });
  game.input = input;
  const overlays = { open: false, name: null, escape() {}, openMenu() {} };
  game.hud = {
    message: (text, kind) => messages.push([text, kind]),
    refreshCard() {},
    flashSlot() {},
    openChat() {},
    overlays,
    chatOpen: false,
    currentCard: () => [],
  };
  const prevented = [];
  const key = (k, extra = {}) => input.onKeyDown({ key: k, code: '', preventDefault: () => prevented.push(k), target: document.body, ...extra });
  /** n of the player's units of a type, known to the view and selected. */
  const select = (n, type = 'warrior') => {
    const units = Array.from({ length: n }, (_, i) => spawn(world, 0, type, 12 + (i % 8), 20 + Math.floor(i / 8)));
    push();
    sel.set(units.map((u) => u.id));
    return units;
  };
  return { world, vs, sel, input, sent, messages, centered, overlays, prevented, key, push, select };
}

const kills = (sent) => sent.filter((c) => c.type === 'kill');

test('a few plain units are destroyed by one press', () => {
  const { select, key, sent, messages, prevented, input } = setup();
  for (const n of [1, DELETE_CONFIRM_ABOVE]) {
    sent.length = 0;
    const units = select(n);
    key('Delete');
    assert.deepEqual(sent, [{ type: 'kill', units: units.map((u) => u.id).sort((a, b) => a - b) }], `${n} unit(s)`);
  }
  assert.deepEqual(messages, [], 'no question asked');
  assert.equal(prevented.length, 2, 'the browser does not get the key');
  input.dispose();
});

test('more than a handful asks first and needs a second press with the same units selected', () => {
  const { select, key, sent, messages, input } = setup();
  const units = select(DELETE_CONFIRM_ABOVE + 1);
  key('Delete');
  assert.deepEqual(sent, [], 'nothing yet');
  assert.deepEqual(messages, [[`Press Delete again to destroy ${units.length} units.`, 'error']]);
  key('Delete');
  assert.equal(kills(sent).length, 1);
  assert.deepEqual(kills(sent)[0].units.slice().sort((a, b) => a - b), units.map((u) => u.id).sort((a, b) => a - b));
  assert.equal(input.deleteArmed, null);
  // The question is asked afresh next time.
  select(DELETE_CONFIRM_ABOVE + 2);
  key('Delete');
  assert.equal(kills(sent).length, 1);
  assert.equal(messages.length, 2);
  input.dispose();
});

test('a god or a Titan always asks, by name', () => {
  const { world, push, sel, key, sent, messages, input } = setup();
  const zeus = godsFor('greek')[0];
  const god = spawn(world, 0, zeus.id, 15, 20);
  push();
  sel.set([god.id]);
  key('Delete');
  assert.deepEqual(sent, []);
  assert.deepEqual(messages, [['Press Delete again to destroy Zeus.', 'error']]);
  key('Delete');
  assert.deepEqual(sent, [{ type: 'kill', units: [god.id] }]);

  sent.length = 0;
  messages.length = 0;
  const titan = spawn(world, 0, PANTHEONS.greek.titan.id, 18, 20);
  const guards = [1, 2].map((i) => spawn(world, 0, 'warrior', 18 + i, 22));
  push();
  sel.set([titan.id, ...guards.map((u) => u.id)]);
  key('Delete');
  assert.deepEqual(sent, []);
  assert.deepEqual(messages, [[`Press Delete again to destroy 3 units, including ${PANTHEONS.greek.titan.name}.`, 'error']]);
  input.dispose();
});

test('the second press lapses after DELETE_CONFIRM_MS, with Esc and with a window switch', () => {
  const { select, key, sent, messages, input } = setup();
  select(8);
  key('Delete');
  input.deleteArmed.until = performance.now() - 1; // too late
  key('Delete');
  assert.deepEqual(sent, []);
  assert.equal(messages.length, 2, 'asked again');
  assert.ok(input.deleteArmed.until > performance.now() && input.deleteArmed.until <= performance.now() + DELETE_CONFIRM_MS);

  key('Escape');
  assert.equal(input.deleteArmed, null, 'Esc takes the question back');
  key('Delete');
  assert.deepEqual(sent, [], 'and the next press asks again');
  assert.equal(messages.length, 3);

  input.onBlur();
  key('Delete');
  assert.deepEqual(sent, [], 'leaving the window forgets it too');
  assert.equal(messages.length, 4);
  input.dispose();
});

test('losing or dropping a unit between the presses does not matter, adding one does', () => {
  const { world, select, sel, push, key, sent, messages, input } = setup();
  const units = select(8);
  key('Delete');
  sel.remove([units[0].id]); // shift-clicked off, or killed by an enemy
  key('Delete');
  assert.equal(kills(sent).length, 1);
  assert.equal(kills(sent)[0].units.length, 7, 'only what is still selected');

  sent.length = 0;
  messages.length = 0;
  select(8);
  key('Delete');
  const extra = spawn(world, 0, 'warrior', 20, 24);
  push();
  sel.add([extra.id]);
  key('Delete');
  assert.deepEqual(sent, [], 'a ninth unit has not been asked about');
  assert.equal(messages[1][0], 'Press Delete again to destroy 9 units.');
  key('Delete');
  assert.equal(kills(sent).length, 1);
  assert.equal(kills(sent)[0].units.length, 9);
  input.dispose();
});

test('holding the key, a modifier, a text field and an open menu do nothing, for Delete and for Backspace', () => {
  for (const name of ['Delete', 'Backspace']) {
    const { select, key, sent, messages, prevented, overlays, input } = setup();
    select(2);
    key(name, { repeat: true });
    assert.deepEqual(sent, [], `${name}: auto-repeat is not another press`);
    key(name, { ctrlKey: true });
    key(name, { metaKey: true });
    key(name, { altKey: true });
    assert.deepEqual(sent, [], `Ctrl+${name} and friends stay with the browser`);
    assert.equal(prevented.filter((k) => k === name).length, 1, 'only the repeat was swallowed');
    key(name, { target: { tagName: 'INPUT', type: 'text' } });
    assert.deepEqual(sent, [], 'typing in chat keeps its keys');
    overlays.open = true;
    key(name);
    assert.deepEqual(sent, []);
    assert.deepEqual(messages, []);
    overlays.open = false;
    key(name);
    assert.equal(kills(sent).length, 1, `${name} destroys the selection`);
    input.dispose();
  }
});

test('only the player\'s own units: an enemy unit and buildings are left alone, and buildings are explained', () => {
  const { world, vs, push, sel, key, sent, messages, input } = setup();
  const enemy = spawn(world, 1, 'warrior', 30, 30);
  push();
  sel.set([enemy.id]);
  key('Delete');
  assert.deepEqual(sent, [], 'an enemy unit selected for a look');

  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  sel.set([tc.id]);
  key('Delete');
  assert.deepEqual(sent, []);
  assert.deepEqual(messages, [['Delete destroys units, not buildings.', 'error']]);

  const mine = spawn(world, 0, 'warrior', 15, 20);
  push();
  sel.set([tc.id, mine.id]);
  assert.ok(vs.entities.get(tc.id));
  key('Delete');
  assert.deepEqual(sent, [{ type: 'kill', units: [mine.id] }], 'the unit, not the building');
  key('Delete');
  assert.equal(kills(sent).length, 2, 'nothing was left armed (one warrior goes at once)');
  input.dispose();
});

test('killing leaves a pending placement or target: the units it was for are gone', () => {
  const { world, select, key, sent, input } = setup();
  const workers = select(2, 'worshipper');
  assert.ok(workers.length === 2 && world.unitsOf(0).length === 2);
  input.setMode({ kind: 'place', building: 'house' });
  input.menu = 'build';
  key('Delete');
  assert.equal(kills(sent).length, 1);
  assert.equal(input.mode.kind, 'normal');
  assert.equal(input.menu, 'root');

  select(8);
  input.setMode({ kind: 'target', order: 'attack', target: 'point' });
  key('Delete');
  assert.equal(input.mode.kind, 'target', 'the question alone keeps the order pending');
  key('Delete');
  assert.equal(input.mode.kind, 'normal');
  input.dispose();
});

test('Backspace, the delete key of a Mac, does what Delete does, and either key answers the other\'s question', () => {
  const { select, key, sent, messages, prevented, centered, input } = setup();
  const units = select(2);
  key('Backspace');
  assert.deepEqual(sent, [{ type: 'kill', units: units.map((u) => u.id).sort((a, b) => a - b) }], 'a few plain units go at once');
  assert.deepEqual(prevented, ['Backspace'], 'the browser does not get the key');
  assert.deepEqual(centered, [], 'and the camera stays where it is');

  sent.length = 0;
  const crowd = select(DELETE_CONFIRM_ABOVE + 1);
  key('Backspace');
  assert.deepEqual(sent, [], 'a big group asks first');
  assert.deepEqual(messages, [[`Press Delete again to destroy ${crowd.length} units.`, 'error']]);
  key('Delete');
  assert.equal(kills(sent).length, 1, 'Delete gives the second press to a question Backspace asked');

  select(DELETE_CONFIRM_ABOVE + 1);
  key('Delete');
  key('Backspace');
  assert.equal(kills(sent).length, 2, 'and the other way round');
  assert.equal(input.deleteArmed, null);
  input.dispose();
});

test('Home jumps to the Town Center, where Backspace used to, and kills nothing', () => {
  const { world, vs, select, key, sent, centered, input } = setup();
  select(3);
  key('Home');
  assert.deepEqual(sent, []);
  const tc = vs.entities.get(world.buildingsOf(0).find((b) => b.type === 'town_center').id);
  assert.deepEqual(centered, [[tc.x, tc.y]]);
  key('Home', { repeat: true });
  assert.equal(centered.length, 1, 'holding the key is not another jump');
  input.dispose();
});

test('the tip that teaches the jump to the Town Center names Home, not the key that destroys units now', () => {
  const tip = HINTS.find((h) => h.id === 'town-key');
  const named = hintParts(hintText(tip, { pantheon: 'greek' })).filter((part) => typeof part !== 'string').map((part) => part.key);
  assert.deepEqual(named, ['Home']);
});

test('deletePlan: who needs a second press and what the question says', () => {
  const warriors = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, t: 'warrior' }));
  assert.deepEqual(deletePlan([]), { ids: [], confirm: false, prompt: '' });
  assert.equal(deletePlan(warriors(DELETE_CONFIRM_ABOVE)).confirm, false);
  assert.deepEqual(deletePlan(warriors(DELETE_CONFIRM_ABOVE + 1)), { ids: [1, 2, 3, 4, 5, 6], confirm: true, prompt: 'Press Delete again to destroy 6 units.' });
  const [zeus, athena, poseidon] = godsFor('greek');
  const god = (d, id) => ({ id, t: d.id });
  assert.equal(deletePlan([god(zeus, 9)]).prompt, 'Press Delete again to destroy Zeus.');
  assert.equal(deletePlan([god(zeus, 9), god(athena, 10)]).prompt, 'Press Delete again to destroy 2 units, including Zeus and Athena.');
  assert.equal(
    deletePlan([...warriors(3), god(zeus, 9), god(athena, 10), god(poseidon, 11)]).prompt,
    'Press Delete again to destroy 6 units, including Zeus, Athena and Poseidon.',
  );
  assert.equal(deletePlan([{ id: 1, t: 'no_such_unit' }]).confirm, false, 'an unknown type is a plain unit');
});
