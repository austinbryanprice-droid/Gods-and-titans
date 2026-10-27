// Combining Houses in the HUD (DESIGN 9): the Combine and Cancel buttons of the House card (what they
// say before an order is given, the sim's own rule), the Manor's card, the research buttons that skip
// Houses being combined, the controller's orders, and the selection panel's notes. Real World +
// ViewState, a stub renderer, the fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../../src/data/index.js';
import { UPGRADES } from '../../src/data/upgrades.js';
import { MANOR, MERGE_TEXT, mergeRule } from '../../src/data/houses.js';
import { ViewState } from '../../src/game/view-state.js';
import { getCommandCard, buttonForKey, researchCheck } from '../../src/ui/command-card.js';
import { isMergingEntity } from '../../src/ui/hud-data.js';
import { Selection } from '../../src/ui/hud-selection.js';
import { InfoView, researchedText } from '../../src/ui/hud-info.js';
import { InputController } from '../../src/ui/input.js';
import { makeWorld, place, run } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

const rule = mergeRule();
const HOUSE = BUILDINGS.house;

let clock = 0;
const push = (world, vs) => vs.pushSnapshot(world.getSnapshot(), (clock += 50));
/** A ViewState for player `me` fed one real snapshot from the world. */
function viewOf(world, me = 0) {
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: me });
  push(world, vs);
  vs.explored.fill(1);
  vs.visible.fill(1);
  return vs;
}
const ids = (list) => list.map((e) => e.id);
const slotsOf = (card) => card.map((b, i) => (b ? `${i}:${b.id}` : null)).filter(Boolean);
const byId = (card, id) => card.find((b) => b && b.id === id) || null;
const rich = (world, p = 0) => Object.assign(world.players[p], { gold: 5000, wood: 5000, faith: 5000 });
const manors = (w) => w.buildingList.filter((b) => !b.dead && b.owner === 0 && b.type === MANOR);

/** The settlement is a Town (the player's tier follows the Town Center's). */
function town(world) {
  const tc = world.buildingList.find((b) => b.owner === 0 && b.type === 'town_center');
  tc.tier = 2;
  world.recomputeTier(0, true);
}

/** Four finished Houses in a square, the top left House at tile (tx, ty). */
const square = (world, tx, ty) => [[0, 0], [2, 0], [0, 2], [2, 2]].map(([dx, dy]) => place(world, 0, 'house', tx + dx, ty + dy));

const merge = (world, houses) => {
  world.issueCommand(0, { type: 'upgradeHouses', houses: ids(houses) });
  run(world, 0.1);
};

// ---------------------------------------------------------------- command card

test('House card: Combine says what stops it before an order is given', () => {
  const world = makeWorld();
  rich(world);
  const one = place(world, 0, 'house', 20, 20);
  let card = getCommandCard([one.id], viewOf(world));
  assert.deepEqual(slotsOf(card), ['0:house-merge', '4:research:house_large_families', '5:research:house_stone_walls']);
  let b = byId(card, 'house-merge');
  assert.equal(b.key, 'U');
  assert.equal(b.icon, BUILDINGS[MANOR].icon);
  assert.deepEqual(b.action, { kind: 'upgradeHouses' });
  assert.equal(b.state, 'locked', 'a Village cannot combine Houses');
  assert.equal(b.reason, 'Requires Town.');
  assert.equal(b.enabled, false);
  assert.equal(buttonForKey(card, 'u').id, 'house-merge');

  town(world);
  card = getCommandCard([one.id], viewOf(world));
  b = byId(card, 'house-merge');
  assert.equal(b.state, 'disabled');
  assert.equal(b.reason, MERGE_TEXT.few, 'one House is not a square');
  assert.equal(b.title, 'Combine into a Manor');
  assert.equal(b.queued, 0);

  // Four that do not make a square.
  const row = [0, 1, 2, 3].map((i) => place(world, 0, 'house', 30 + 2 * i, 30));
  card = getCommandCard([...ids(row)], viewOf(world));
  assert.equal(byId(card, 'house-merge').reason, MERGE_TEXT.shape);
  // A square: ready, one Manor, the price of one square.
  const sq = square(world, 10, 30);
  card = getCommandCard({ ids: ids(sq) }, viewOf(world));
  b = byId(card, 'house-merge');
  assert.equal(b.state, 'ready');
  assert.equal(b.enabled, true);
  assert.equal(b.reason, null);
  assert.equal(b.title, 'Combine into a Manor');
  assert.deepEqual(b.cost, { gold: rule.cost.gold, wood: rule.cost.wood, faith: 0, pop: 0, time: rule.time });
  assert.match(b.description, /48 population instead of the 32 they shelter apart/);
  assert.match(b.description, /2400 health instead of 2000/);
  assert.match(b.description, /100 gold and 60 wood and 45 seconds for each square/);
});

test('House card: several squares, what the purse covers, a square busy with research', () => {
  const world = makeWorld({ map: { width: 64, height: 64, starts: [{ x: 6, y: 6 }, { x: 50, y: 50 }] } });
  town(world);
  const a = square(world, 20, 20);
  const b = square(world, 26, 20);
  const stray = place(world, 0, 'house', 40, 40);
  const all = [...a, ...b, stray];
  Object.assign(world.players[0], { gold: 5000, wood: 5000 });
  let card = getCommandCard({ ids: ids(all) }, viewOf(world));
  let btn = byId(card, 'house-merge');
  assert.equal(btn.title, 'Combine into 2 Manors');
  assert.deepEqual(btn.cost, { gold: 2 * rule.cost.gold, wood: 2 * rule.cost.wood, faith: 0, pop: 0, time: rule.time });
  assert.equal(btn.state, 'ready');
  assert.doesNotMatch(btn.description, /You can pay for/);
  // The purse covers one of the two: still ready, and it says so.
  world.players[0].gold = rule.cost.gold + 5;
  btn = byId(getCommandCard({ ids: ids(all) }, viewOf(world)), 'house-merge');
  assert.equal(btn.state, 'ready');
  assert.match(btn.description, /You can pay for 1 of the 2 squares right now\./);
  // Not even one.
  world.players[0].gold = 5;
  btn = byId(getCommandCard({ ids: ids(all) }, viewOf(world)), 'house-merge');
  assert.equal(btn.state, 'unaffordable');
  assert.equal(btn.reason, 'Not enough gold.');
  assert.equal(btn.enabled, false);
  // One of the squares has a House researching: only the other counts.
  rich(world);
  world.issueCommand(0, { type: 'research', building: b[2].id, upgrade: 'house_stone_walls' });
  run(world, 0.1);
  card = getCommandCard({ ids: ids(all) }, viewOf(world));
  btn = byId(card, 'house-merge');
  assert.equal(btn.title, 'Combine into a Manor');
  assert.equal(btn.state, 'ready');
  // And the busy square alone says why.
  card = getCommandCard({ ids: ids(b) }, viewOf(world));
  assert.equal(byId(card, 'house-merge').state, 'disabled');
  assert.equal(byId(card, 'house-merge').reason, MERGE_TEXT.busy);
});

test('House card: while the square is combined the button is spent, the badge counts squares and Cancel appears', () => {
  const world = makeWorld();
  rich(world);
  town(world);
  const sq = square(world, 20, 20);
  merge(world, sq);
  let card = getCommandCard({ ids: ids(sq) }, viewOf(world));
  assert.deepEqual(slotsOf(card), ['0:house-merge', '1:house-merge-cancel', '4:research:house_large_families', '5:research:house_stone_walls']);
  const btn = byId(card, 'house-merge');
  assert.equal(btn.state, 'disabled');
  assert.equal(btn.reason, 'Already being combined.');
  assert.equal(btn.queued, 1, 'one square under way');
  const cancel = byId(card, 'house-merge-cancel');
  assert.equal(cancel.key, 'C');
  assert.equal(cancel.title, 'Cancel Combining');
  assert.deepEqual(cancel.action, { kind: 'cancelMerge' });
  assert.match(cancel.description, /get back everything it cost/);
  // A single House of the square carries it too: it is the square that counts.
  card = getCommandCard([sq[3].id], viewOf(world));
  assert.equal(byId(card, 'house-merge-cancel').title, 'Cancel Combining');
  assert.equal(byId(card, 'house-merge').queued, 1);
  assert.equal(byId(card, 'house-merge').reason, 'Already being combined.');
  // Research cannot start at Houses being combined.
  for (const id of ['research:house_stone_walls']) {
    const r = byId(getCommandCard({ ids: ids(sq) }, viewOf(world)), id);
    assert.equal(r.state, 'disabled');
    assert.equal(r.reason, 'That House is being combined into a Manor.');
  }
  // When the Manor stands the House card is gone with the Houses.
  run(world, rule.time + 1);
  assert.equal(manors(world).length, 1);
  assert.ok(getCommandCard({ ids: ids(sq) }, viewOf(world)).every((x) => x === null), 'the Houses are gone');
});

test('Manor card: the House upgrades, no Combine, researched at the Manor', () => {
  const world = makeWorld();
  rich(world);
  town(world);
  const m = place(world, 0, MANOR, 20, 20);
  let card = getCommandCard([m.id], viewOf(world));
  assert.deepEqual(slotsOf(card), ['4:research:house_large_families', '5:research:house_stone_walls']);
  assert.equal(byId(card, 'research:house_stone_walls').state, 'ready');
  assert.equal(byId(card, 'research:house_stone_walls').key, 'W');
  world.issueCommand(0, { type: 'research', building: m.id, upgrade: 'house_stone_walls' });
  run(world, 0.1);
  card = getCommandCard([m.id], viewOf(world));
  assert.equal(byId(card, 'research:house_stone_walls').reason, 'Already being researched.');
  run(world, UPGRADES.house_stone_walls.time + 1);
  card = getCommandCard([m.id], viewOf(world));
  assert.equal(byId(card, 'research:house_stone_walls').state, 'passive');
  // An enemy's Manor gives no card.
  const foe = place(world, 1, MANOR, 30, 30);
  assert.ok(getCommandCard([foe.id], viewOf(world)).every((x) => x === null));
  // Houses and Manors in one selection: the card follows the active subgroup (Tab).
  const h = place(world, 0, 'house', 40, 20);
  const vs = viewOf(world);
  assert.ok(byId(getCommandCard({ ids: [m.id, h.id], activeType: 'house' }, vs), 'house-merge'));
  assert.equal(byId(getCommandCard({ ids: [m.id, h.id], activeType: MANOR }, vs), 'house-merge'), null);
});

test('researchCheck skips Houses being combined but not their neighbours', () => {
  const world = makeWorld();
  rich(world);
  town(world);
  const sq = square(world, 20, 20);
  const free = place(world, 0, 'house', 30, 20);
  merge(world, sq);
  const vs = viewOf(world);
  const up = UPGRADES.house_large_families;
  const ents = (list) => list.map((b) => vs.entities.get(b.id));
  assert.equal(researchCheck(vs, up, ents(sq)).reason, 'That House is being combined into a Manor.');
  assert.equal(researchCheck(vs, up, ents([...sq, free])).state, 'ready', 'the free House can research it');
  assert.ok(isMergingEntity(vs.entities.get(sq[0].id)));
  assert.ok(!isMergingEntity(vs.entities.get(free.id)));
});

// ---------------------------------------------------------------- input

function scene({ me = 0 } = {}) {
  const world = makeWorld({ map: { width: 64, height: 64, starts: [{ x: 6, y: 6 }, { x: 50, y: 50 }] } });
  rich(world, me);
  town(world);
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: me });
  push(world, vs);
  vs.explored.fill(1);
  vs.visible.fill(1);
  const sel = new Selection(vs);
  const sent = [];
  const errors = [];
  const game = {
    viewState: vs,
    selection: sel,
    renderer: {
      pickEntity: () => null,
      screenToWorld: (x, y) => ({ x, y }),
      showCommandMarker() {},
      hidePlacement() {},
      setSelection() {},
      camera: { centerOn() {} },
    },
    command: (c) => {
      sent.push(c);
      world.issueCommand(me, c);
    },
    setShowAllBars() {},
  };
  const input = new InputController({ game, canvas: document.createElement('canvas'), overlayRoot: document.createElement('div') });
  game.input = input;
  const refresh = () => push(world, vs);
  game.hud = {
    message: (text, kind) => kind === 'error' && errors.push(text),
    refreshCard() {},
    flashSlot() {},
    overlays: { open: false },
    chatOpen: false,
    currentCard: () => getCommandCard(sel.forCard(), vs, input.cardMode()),
  };
  const key = (k, extra = {}) => input.onKeyDown({ key: k, code: '', preventDefault() {}, target: document.body, ...extra });
  return { world, vs, sel, input, sent, errors, key, refresh };
}

test('input: U sends the Houses of the active group and the sim combines the squares', () => {
  const { world, sel, input, sent, key, refresh } = scene();
  const a = square(world, 20, 20);
  const b = square(world, 26, 20);
  const stray = place(world, 0, 'house', 40, 40);
  const tc = world.buildingList.find((x) => x.owner === 0 && x.type === 'town_center');
  refresh();
  sel.set([...ids(a), ...ids(b), stray.id, tc.id]);
  key('u');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'upgradeHouses');
  assert.deepEqual([...sent[0].houses].sort((p, q) => p - q), [...ids(a), ...ids(b), stray.id].sort((p, q) => p - q), 'the Houses only, not the Town Center');
  run(world, 0.1);
  assert.equal([...a, ...b].every((h) => h.queue.length === 1), true);
  assert.equal(stray.queue.length, 0);
  run(world, rule.time + 1);
  assert.equal(manors(world).length, 2);
  input.dispose();
});

test('input: C cancels one order per square, and Esc does not take a combining back', () => {
  const { world, sel, input, sent, key, refresh } = scene();
  const a = square(world, 20, 20);
  const b = square(world, 26, 20);
  const gold = world.players[0].gold;
  merge(world, [...a, ...b]);
  refresh();
  sel.set(ids([...a, ...b]));
  sent.length = 0;
  key('Escape');
  assert.deepEqual(sent, [], 'Esc by habit leaves the upgrade alone');
  key('c');
  assert.equal(sent.length, 2, 'one cancel for each square');
  assert.deepEqual(sent.map((c) => [c.type, c.index]), [['cancelTrain', 0], ['cancelTrain', 0]]);
  assert.deepEqual(sent.map((c) => c.building).sort((p, q) => p - q), [a[0].id, b[0].id].sort((p, q) => p - q), 'the top left House of each');
  run(world, 0.1);
  assert.equal([...a, ...b].every((h) => h.queue.length === 0), true);
  assert.equal(world.players[0].gold, gold, 'everything came back');
  input.dispose();
});

test('input: Cancel on part of a square stops the whole square', () => {
  const { world, sel, input, sent, key, refresh } = scene();
  const a = square(world, 20, 20);
  const gold = world.players[0].gold;
  merge(world, a);
  refresh();
  sel.set([a[1].id, a[2].id]);
  sent.length = 0;
  key('c');
  assert.equal(sent.length, 2, 'one for each House selected');
  run(world, 0.1);
  assert.equal(a.every((h) => h.queue.length === 0), true, 'all four stop');
  assert.equal(world.players[0].gold, gold, 'and the price comes back once');
  input.dispose();
});

test('input: a research order goes to a House that is not being combined', () => {
  const { world, sel, input, sent, key, refresh } = scene();
  const sq = square(world, 20, 20);
  const free = place(world, 0, 'house', 30, 20);
  merge(world, sq);
  refresh();
  sel.set([...ids(sq), free.id]);
  key('w');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { type: 'research', building: free.id, upgrade: 'house_stone_walls' });
  input.dispose();
});

test('input: Combine with nothing to combine says why instead of sending an order', () => {
  const { world, sel, input, sent, errors, key, refresh } = scene();
  const one = place(world, 0, 'house', 20, 20);
  refresh();
  sel.set([one.id]);
  key('u');
  assert.deepEqual(sent, []);
  assert.deepEqual(errors, [MERGE_TEXT.few]);
  input.dispose();
});

// ---------------------------------------------------------------- panels and text

test('selection panel: the House and Manor notes, the queue label and the Manor\'s upgrades', () => {
  const world = makeWorld();
  rich(world);
  town(world);
  const sq = square(world, 20, 20);
  const m = place(world, 0, MANOR, 30, 20);
  let vs = viewOf(world);
  const panel = (id) => {
    const sel = new Selection(vs);
    const root = document.createElement('div');
    const info = new InfoView(root, { selection: sel, viewState: vs, onSelectOnly() {}, onRemove() {}, onSelectType() {}, onCancelQueue() {}, onPortrait() {} });
    sel.set([id]);
    info.update();
    return root.textContent;
  };
  assert.match(panel(sq[0].id), /Provides housing for 8 population\. Select four Houses that stand in a square to combine them into a Manor\./);
  assert.match(panel(m.id), /Provides housing for 48 population: 16 more than the Houses it replaced\./);
  merge(world, sq);
  vs = viewOf(world);
  assert.match(panel(sq[1].id), /Upgrading to Manor/);
  assert.match(panel(sq[1].id), new RegExp(BUILDINGS[MANOR].icon));
  // The Manor lists the House upgrades researched, as a House does.
  world.players[0].upgrades.house_stone_walls = true;
  assert.equal(researchedText(['house_stone_walls'], MANOR), researchedText(['house_stone_walls'], 'house'));
  assert.match(researchedText(['house_stone_walls'], MANOR), /Stone Walls/);
});

test('How to Play tells how to combine Houses, with the numbers from the data', async () => {
  // menu-dom's h() asks `instanceof Node`; the fake nodes carry a nodeType instead.
  globalThis.Node = class {
    static [Symbol.hasInstance](x) {
      return !!x && (x.nodeType === 1 || x.nodeType === 3);
    }
  };
  const { renderHowToContent } = await import('../../src/ui/menu-howto.js');
  const text = renderHowToContent().textContent;
  assert.match(text, /four Houses that stand together in a square and press U to combine them into a Manor: 48 population instead of the 32 they shelter apart \(45 seconds/);
  assert.match(text, /Houses: combine four in a square into a Manor \(U\), or cancel it \(C\)/);
  assert.equal(BUILDINGS.house.popProvided, HOUSE.popProvided);
});
