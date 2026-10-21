// Walls in the HUD (DESIGN 9): the client's placement check for a tower over my wall and for a
// dragged wall line, the wall command card (upgrade, dismantle, cancel), the long wall-only
// selection, the drag-out placement in the input controller, box select around a walled base,
// and the selection panel's summary of a long wall. Real World + ViewState, a stub renderer, the fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../../src/data/index.js';
import { ViewState } from '../../src/game/view-state.js';
import { checkPlacement, checkWallLine, WALL_THERE, WALL_TOO_FAR, CANT_BUILD, BUILDING_IN_WAY } from '../../src/game/placement.js';
import { getCommandCard } from '../../src/ui/command-card.js';
import { Selection, MAX_SELECTION } from '../../src/ui/hud-selection.js';
import { InfoView } from '../../src/ui/hud-info.js';
import { InputController } from '../../src/ui/input.js';
import { MAX_WALL_SELECTION, MAX_WALL_LINE, WALL_PLACE_RANGE } from '../../src/config.js';
import { makeWorld, place, run, clearUnits, spawn } from '../sim/helpers.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

let clock = 0;
const push = (world, vs) => vs.pushSnapshot(world.getSnapshot(), (clock += 50));
/** A ViewState for player `me` fed one real snapshot from the world. */
function viewOf(world, me = 0, { seeAll = true } = {}) {
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: me });
  push(world, vs);
  if (seeAll) {
    vs.explored.fill(1);
    vs.visible.fill(1);
  }
  return vs;
}
const ids = (list) => list.map((e) => e.id);
const slotsOf = (card) => card.map((b, i) => (b ? `${i}:${b.id}` : null)).filter(Boolean);
const byId = (card, id) => card.find((b) => b && b.id === id) || null;
const rich = (world, p = 0) => Object.assign(world.players[p], { gold: 5000, wood: 5000, faith: 5000 });
const row = (world, type, x0, n, y, p = 0, constructed = true) => Array.from({ length: n }, (_, i) => place(world, p, type, x0 + i, y, constructed));

// ---------------------------------------------------------------- placement check

test('a tower may stand on my own wall; a house may not; an ally\'s wall blocks the tower', () => {
  const world = makeWorld({ players: 3, teams: [1, 1, 2] });
  place(world, 0, 'wooden_wall', 12, 16);
  place(world, 1, 'stone_wall', 20, 16);
  const vs = viewOf(world);
  assert.equal(checkPlacement(vs, 0, 'tower', 11, 15).valid, true, 'the tower covers my segment at (12, 16)');
  assert.equal(world.canPlaceBuilding(0, 'tower', 11, 15), true, 'and the sim agrees');
  const house = checkPlacement(vs, 0, 'house', 11, 15);
  assert.equal(house.valid, false);
  assert.equal(house.message, BUILDING_IN_WAY);
  const ally = checkPlacement(vs, 0, 'tower', 19, 15);
  assert.equal(ally.valid, false, 'an ally\'s segment is not mine to build over');
  assert.equal(world.canPlaceBuilding(0, 'tower', 19, 15), false);
  // My own planned wall counts as wall too.
  assert.equal(checkPlacement(vs, 0, 'tower', 28, 15, [{ b: 'wooden_wall', tx: 28, ty: 16 }]).valid, true);
  assert.equal(checkPlacement(vs, 0, 'tower', 28, 15, [{ b: 'house', tx: 28, ty: 16 }]).valid, false);
});

test('a dragged wall line marks tiles to build, tiles the wall holds and tiles that cannot be built on', () => {
  const world = makeWorld({ map: { rock: [{ x: 15, y: 16, w: 1, h: 1 }] } });
  place(world, 0, 'wooden_wall', 12, 16);
  place(world, 0, 'tower', 17, 15); // a tower joined to the wall holds (17..18, 15..16)
  const vs = viewOf(world);
  const line = checkWallLine(vs, 0, 'wooden_wall', 10, 16, 19, 16);
  assert.deepEqual(line.tiles.map((t) => `${t.tx}:${t.state}`), [
    '10:build', '11:build', '12:held', '13:build', '14:build', '15:blocked', '16:build', '17:held', '18:held', '19:build',
  ]);
  assert.equal(line.build, 6);
  assert.deepEqual(line.cost, { gold: 0, wood: 72, faith: 0 });
  assert.equal(line.message, null);
  assert.equal(line.tiles[5].message, CANT_BUILD);
  // The sim builds exactly those tiles and charges the same.
  const wood = world.players[0].wood;
  world.issueCommand(0, { type: 'build', units: [world.unitsOf(0).find((u) => u.type === 'worshipper').id], building: 'wooden_wall', tx: 10, ty: 16, tx2: 19, ty2: 16 });
  run(world, 0.1);
  assert.equal(wood - world.players[0].wood, line.cost.wood);
  assert.equal(world.buildingList.filter((b) => b.type === 'wooden_wall' && !b.dead).length, 1 + line.build);
});

test('a wall line with nothing to build says why', () => {
  const world = makeWorld({ map: { rock: [{ x: 15, y: 16, w: 1, h: 1 }] } });
  place(world, 0, 'wooden_wall', 12, 16);
  const vs = viewOf(world);
  const rock = checkWallLine(vs, 0, 'wooden_wall', 15, 16, 15, 16);
  assert.equal(rock.build, 0);
  assert.equal(rock.message, CANT_BUILD);
  const held = checkWallLine(vs, 0, 'wooden_wall', 12, 16, 12, 16);
  assert.equal(held.build, 0);
  assert.equal(held.message, WALL_THERE);
  assert.equal(checkWallLine(vs, 0, 'house', 12, 16, 14, 16).build, 0, 'not a wall type');
  assert.equal(checkWallLine(vs, 0, 'wooden_wall', NaN, 16, 14, 16).build, 0);
  // Long drags stop at MAX_WALL_LINE tiles; a diagonal keeps its tiles touching.
  assert.equal(checkWallLine(vs, 0, 'wooden_wall', 0, 30, 47, 30).tiles.length, 48);
  assert.ok(MAX_WALL_LINE >= 48);
});

test('a wall line leaves out the tiles farther than WALL_PLACE_RANGE from every worshipper it is ordered to', () => {
  const world = makeWorld();
  const vs = viewOf(world);
  const near = { x: 10, y: 12 };
  const line = checkWallLine(vs, 0, 'wooden_wall', 4, 12, 47, 12, null, [near]);
  assert.deepEqual(line.tiles.map((t) => t.state), line.tiles.map((t) => (t.tx <= 33 ? 'build' : 'blocked')));
  assert.equal(line.build, 30);
  assert.deepEqual(line.cost, { gold: 0, wood: 360, faith: 0 });
  assert.equal(line.message, null);
  assert.equal(line.tiles.at(-1).message, WALL_TOO_FAR);
  assert.equal(line.tiles[0].message, null);
  // Any worshipper in reach is enough, and with no worshippers given the range is left out.
  assert.equal(checkWallLine(vs, 0, 'wooden_wall', 4, 12, 47, 12, null, [near, { x: 44, y: 12 }]).build, 44);
  assert.equal(checkWallLine(vs, 0, 'wooden_wall', 4, 12, 47, 12).build, 44);
  // A line wholly out of reach says why.
  const far = checkWallLine(vs, 0, 'wooden_wall', 40, 12, 47, 12, null, [near]);
  assert.equal(far.build, 0);
  assert.equal(far.message, WALL_TOO_FAR);
  // The sim raises exactly those tiles.
  const sim = makeWorld();
  clearUnits(sim, 0);
  sim.players[0].wood = 1000;
  const a = spawn(sim, 0, 'worshipper', near.x, near.y);
  sim.issueCommand(0, { type: 'build', units: [a.id], building: 'wooden_wall', tx: 4, ty: 12, tx2: 47, ty2: 12 });
  run(sim, 0.1);
  const raised = sim.buildingList.filter((b) => b.type === 'wooden_wall' && !b.dead).map((b) => b.tx).sort((p, q) => p - q);
  assert.deepEqual(raised, line.tiles.filter((t) => t.state === 'build').map((t) => t.tx));
});

// ---------------------------------------------------------------- command card

test('wall card: upgrade with the total cost and a badge for those upgrading, dismantle, cancel', () => {
  const world = makeWorld();
  rich(world);
  const walls = row(world, 'wooden_wall', 12, 3, 16);
  let card = getCommandCard({ ids: ids(walls) }, viewOf(world));
  assert.deepEqual(slotsOf(card), ['0:wall-upgrade', '1:wall-dismantle']);
  const up = byId(card, 'wall-upgrade');
  assert.equal(up.key, 'U');
  assert.equal(up.title, 'Upgrade 3 Segments to Stone Wall');
  assert.equal(up.icon, '🧱');
  assert.deepEqual(up.cost, { gold: 60, wood: 30, faith: 0, pop: 0, time: 12 });
  assert.equal(up.state, 'ready');
  assert.equal(up.queued, 0);
  assert.deepEqual(up.action, { kind: 'upgradeWall' });
  assert.match(up.description, /1000 health and 6 armor instead of 350 and 1/);
  assert.equal(byId(card, 'wall-dismantle').key, 'D');
  assert.match(byId(card, 'wall-dismantle').description, /50%/);

  // One segment upgrading: the rest can still be upgraded, and Cancel Upgrade appears.
  world.issueCommand(0, { type: 'upgradeWall', walls: [walls[0].id] });
  run(world, 0.1);
  card = getCommandCard({ ids: ids(walls) }, viewOf(world));
  assert.equal(byId(card, 'wall-upgrade').title, 'Upgrade 2 Segments to Stone Wall');
  assert.equal(byId(card, 'wall-upgrade').queued, 1);
  assert.equal(byId(card, 'wall-cancel').title, 'Cancel Upgrade');
  assert.equal(byId(card, 'wall-cancel').key, 'C');

  // All of them upgrading: nothing left to order.
  world.issueCommand(0, { type: 'upgradeWall', walls: ids(walls) });
  run(world, 0.1);
  card = getCommandCard({ ids: ids(walls) }, viewOf(world));
  assert.equal(byId(card, 'wall-upgrade').state, 'disabled');
  assert.equal(byId(card, 'wall-upgrade').reason, 'Already being upgraded.');
  assert.equal(byId(card, 'wall-upgrade').queued, 3);

  // Done: stone has no upgrade of its own; the same ids now read as stone.
  run(world, 13);
  card = getCommandCard({ ids: ids(walls) }, viewOf(world));
  assert.deepEqual(slotsOf(card), ['1:wall-dismantle']);
});

test('wall card: what the purse covers, and an unaffordable upgrade', () => {
  const world = makeWorld();
  const walls = row(world, 'wooden_wall', 12, 3, 16);
  Object.assign(world.players[0], { gold: 45, wood: 500 });
  let up = byId(getCommandCard({ ids: ids(walls) }, viewOf(world)), 'wall-upgrade');
  assert.equal(up.state, 'ready', 'two of the three can be paid');
  assert.match(up.description, /You can pay for 2 of the 3 right now\./);
  world.players[0].gold = 5;
  up = byId(getCommandCard({ ids: ids(walls) }, viewOf(world)), 'wall-upgrade');
  assert.equal(up.state, 'unaffordable');
  assert.equal(up.reason, 'Not enough gold.');
  assert.equal(up.enabled, false);
});

test('wall card: unfinished segments can only be cancelled, other players\' walls give no card', () => {
  const world = makeWorld();
  const sites = row(world, 'wooden_wall', 12, 2, 16, 0, false);
  const card = getCommandCard({ ids: ids(sites) }, viewOf(world));
  assert.deepEqual(slotsOf(card), ['2:wall-cancel']);
  assert.equal(card[2].title, 'Cancel Construction');
  assert.deepEqual(card[2].action, { kind: 'cancelWall' });
  const enemy = row(world, 'stone_wall', 30, 2, 30, 1);
  assert.ok(getCommandCard({ ids: ids(enemy) }, viewOf(world)).every((b) => b === null));
});

// ---------------------------------------------------------------- selection

test('a selection of only wall segments may hold many; any mix is capped at 24', () => {
  const world = makeWorld();
  const walls = [];
  for (let y = 20; y < 26; y++) walls.push(...row(world, 'wooden_wall', 2, 44, y));
  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  const vs = viewOf(world);
  const sel = new Selection(vs);
  sel.set(ids(walls.slice(0, 100)));
  assert.equal(sel.size, 100);
  sel.set(ids(walls));
  assert.equal(sel.size, MAX_WALL_SELECTION, 'a very long wall stops at the wall limit');
  sel.set([...ids(walls.slice(0, 60)), tc.id]);
  assert.equal(sel.size, MAX_SELECTION);
  sel.set(ids(walls.slice(0, 60)));
  assert.ok(sel.saveGroup(1));
  assert.ok(sel.addToGroup(1));
  assert.equal(sel.groupIds(1).length, 60, 'a control group keeps a long wall too');
});

// ---------------------------------------------------------------- input

function inputScene({ wood = 1000, gold = 1000 } = {}) {
  const world = makeWorld();
  Object.assign(world.players[0], { wood, gold });
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: 0 });
  push(world, vs);
  vs.explored.fill(1);
  vs.visible.fill(1);
  const sel = new Selection(vs);
  const workers = world.unitsOf(0).filter((u) => u.type === 'worshipper');
  sel.set(ids(workers));
  const sent = [];
  const errors = [];
  const lines = [];
  let hidden = 0;
  let boxed = [];
  const renderer = {
    pickEntity: () => null,
    screenToWorld: (x, y) => ({ x, y }), // canvas px = tiles, for the test
    worldToScreen: (x, y) => ({ sx: x, sy: y }),
    entitiesInRect: () => boxed,
    showCommandMarker() {},
    hidePlacement: () => hidden++,
    showPlacement() {},
    showWallLine: (b, tiles) => lines.push({ b, tiles }),
    setPlannedBuilds() {},
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
  const move = (x, y, shift = false) => {
    input.onMouseMove({ clientX: x, clientY: y, shiftKey: shift, target: canvas });
    input.placeAt = -1e9;
    input.update(0.016);
  };
  const down = (x, y, shift = false) => input.onMouseDown({ button: 0, clientX: x, clientY: y, shiftKey: shift, preventDefault() {} });
  const up = (x, y, shift = false) => input.onMouseUp({ button: 0, clientX: x, clientY: y, shiftKey: shift });
  return { world, vs, sel, workers, input, sent, errors, lines, move, down, up, canvas, hiddenCount: () => hidden, setBox: (v) => (boxed = v) };
}

test('drag a wall: press on a tile, the ghost and the tip follow, release orders the line for every selected worshipper', () => {
  const { world, workers, input, sent, lines, move, down, up } = inputScene();
  input.setMode({ kind: 'place', building: 'wooden_wall' });
  move(10.5, 16.5);
  assert.equal(lines.at(-1).tiles.length, 1, 'one tile under the cursor before the press');
  assert.equal(input.wallTip.hidden, true);
  down(10.5, 16.5);
  assert.deepEqual(input.mode.anchor, { tx: 10, ty: 16 });
  move(15.5, 16.9);
  assert.deepEqual(lines.at(-1).tiles.map((t) => `${t.tx},${t.ty}:${t.state}`), ['10,16:build', '11,16:build', '12,16:build', '13,16:build', '14,16:build', '15,16:build']);
  assert.equal(input.wallTip.hidden, false);
  assert.match(input.wallTip.textContent, /6 × Wooden Wall/);
  assert.match(input.wallTip.textContent, /🌲 72/);
  assert.equal(input.wallTip.classList.contains('is-bad'), false);
  up(15.5, 16.9);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { type: 'build', units: workers.map((w) => w.id), building: 'wooden_wall', tx: 10, ty: 16, tx2: 15, ty2: 16, queue: false });
  assert.equal(input.mode.kind, 'normal', 'a plain release ends the placement');
  assert.equal(input.wallTip.hidden, true);
  run(world, 0.1);
  assert.equal(world.buildingList.filter((b) => b.type === 'wooden_wall' && !b.dead).length, 6);
  assert.equal(world.players[0].wood, 1000 - 72);
  input.dispose();
});

test('drag a wall past the worshippers\' reach: the ghost and the tip leave that part out, and a line wholly out of reach is refused', () => {
  const { world, workers, input, sent, errors, lines, move, down, up } = inputScene();
  input.setMode({ kind: 'place', building: 'wooden_wall' });
  const reach = (t) => workers.some((u) => Math.hypot(u.x - (t.tx + 0.5), u.y - (t.ty + 0.5)) <= WALL_PLACE_RANGE);
  move(10.5, 30.5);
  down(10.5, 30.5);
  move(44.5, 30.5);
  const tiles = lines.at(-1).tiles;
  const inReach = tiles.filter(reach).length;
  assert.ok(inReach > 0 && inReach < tiles.length, 'the near end of the line is in reach and the far end is not');
  assert.deepEqual(tiles.map((t) => t.state), tiles.map((t) => (reach(t) ? 'build' : 'blocked')));
  assert.ok(input.wallTip.textContent.startsWith(`${inReach} × Wooden Wall`), input.wallTip.textContent);
  up(44.5, 30.5);
  assert.equal(sent.length, 1);
  run(world, 0.1);
  assert.equal(world.buildingList.filter((b) => b.type === 'wooden_wall' && !b.dead).length, inReach, 'the sim raises what the ghost showed');
  // Wholly out of reach: red tip, no order, the placement stays open.
  input.setMode({ kind: 'place', building: 'wooden_wall' });
  move(44.5, 40.5);
  down(44.5, 40.5);
  move(47.5, 40.5);
  assert.equal(input.wallTip.textContent, WALL_TOO_FAR);
  assert.equal(input.wallTip.classList.contains('is-bad'), true);
  up(47.5, 40.5);
  assert.deepEqual(errors, [WALL_TOO_FAR]);
  assert.equal(sent.length, 1, 'nothing more was ordered');
  assert.equal(input.mode.kind, 'place');
  input.dispose();
});

test('a click without a drag lays one segment', () => {
  const { world, input, sent, move, down, up } = inputScene();
  input.setMode({ kind: 'place', building: 'wooden_wall' });
  move(20.5, 20.5);
  down(20.5, 20.5);
  up(20.5, 20.5);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].tx, 20);
  assert.equal(sent[0].tx2, 20);
  run(world, 0.1);
  assert.equal(world.buildingList.filter((b) => b.type === 'wooden_wall' && !b.dead).length, 1);
  input.dispose();
});

test('Shift keeps the placement for the next wall; letting go of Shift ends it', () => {
  const { input, sent, move, down, up } = inputScene();
  input.setMode({ kind: 'place', building: 'wooden_wall' });
  move(10.5, 16.5, true);
  down(10.5, 16.5, true);
  move(13.5, 16.5, true);
  up(13.5, 16.5, true);
  assert.equal(sent[0].queue, true);
  assert.equal(input.mode.kind, 'place');
  down(10.5, 18.5, true);
  input.onKeyUp({ key: 'Shift', preventDefault() {} });
  assert.equal(input.mode.kind, 'place', 'a wall still being dragged is not cut off');
  move(13.5, 18.5);
  up(13.5, 18.5, false);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].queue, false);
  assert.equal(input.mode.kind, 'normal');
  input.dispose();
});

test('Esc or a right-click first drops the wall being dragged, then leaves the placement', () => {
  const { input, sent, move, down, up, hiddenCount } = inputScene();
  input.setMode({ kind: 'place', building: 'wooden_wall' });
  move(10.5, 16.5);
  down(10.5, 16.5);
  move(14.5, 16.5);
  const hidden = hiddenCount();
  assert.equal(input.cancelMode(), true);
  assert.equal(input.mode.kind, 'place', 'still placing walls');
  assert.equal(input.mode.anchor, null);
  assert.equal(input.wallTip.hidden, true);
  assert.ok(hiddenCount() > hidden, 'the ghost line went away');
  up(14.5, 16.5);
  assert.equal(sent.length, 0, 'the release after the drop orders nothing');
  down(10.5, 16.5);
  input.onMouseDown({ button: 2, clientX: 10, clientY: 10, shiftKey: false, preventDefault() {} });
  assert.equal(input.mode.kind, 'place');
  assert.equal(input.mode.anchor, null);
  input.onMouseDown({ button: 2, clientX: 10, clientY: 10, shiftKey: false, preventDefault() {} });
  assert.equal(input.mode.kind, 'normal');
  // Losing focus mid-drag drops it too.
  input.setMode({ kind: 'place', building: 'wooden_wall' });
  move(10.5, 16.5);
  down(10.5, 16.5);
  input.onBlur();
  assert.equal(input.mode.anchor, null);
  input.dispose();
});

test('releasing the button off the map orders nothing', () => {
  const { input, sent, canvas, move, down } = inputScene();
  input.setMode({ kind: 'place', building: 'wooden_wall' });
  move(10.5, 16.5);
  down(10.5, 16.5);
  input.onMouseMove({ clientX: 14, clientY: 800, shiftKey: false, target: { tagName: 'DIV' } }); // over the HUD
  assert.notEqual(canvas, null);
  input.onMouseUp({ button: 0, clientX: 14, clientY: 800, shiftKey: false });
  assert.equal(sent.length, 0);
  assert.equal(input.mode.kind, 'place');
  assert.equal(input.mode.anchor, null);
  input.dispose();
});

test('releasing the button where no ground shows orders nothing, not a one-segment wall at the start', () => {
  const { input, sent, move, down, up } = inputScene();
  input.setMode({ kind: 'place', building: 'wooden_wall' });
  move(10.5, 16.5);
  down(10.5, 16.5);
  input.renderer.screenToWorld = () => null; // the pointer is past the edge of the map
  up(14.5, 16.5);
  assert.equal(sent.length, 0);
  assert.equal(input.mode.kind, 'place', 'the placement stays open');
  assert.equal(input.mode.anchor, null);
  input.dispose();
});

test('a wall line that cannot be paid or built is refused and the placement stays open', () => {
  const { input, sent, errors, move, down, up, lines } = inputScene({ wood: 30 });
  input.setMode({ kind: 'place', building: 'wooden_wall' });
  move(10.5, 16.5);
  down(10.5, 16.5);
  move(15.5, 16.5);
  assert.match(input.wallTip.textContent, /Not enough wood\./);
  assert.equal(input.wallTip.classList.contains('is-bad'), true);
  up(15.5, 16.5);
  assert.deepEqual(errors, ['Not enough wood.']);
  assert.equal(sent.length, 0);
  assert.equal(input.mode.kind, 'place');
  // A shorter line fits the purse (2 × 12 wood).
  down(10.5, 16.5);
  move(11.5, 16.5);
  up(11.5, 16.5);
  assert.equal(sent.length, 1);
  assert.ok(lines.length > 0);
  input.dispose();
});

test('the wall buttons order the whole active subgroup: one upgrade command, a dismantle per segment, cancels', () => {
  const { world, vs, sel, input, sent, errors } = inputScene();
  const wooden = row(world, 'wooden_wall', 12, 4, 16);
  const stone = row(world, 'stone_wall', 12, 2, 18);
  const sites = row(world, 'wooden_wall', 12, 2, 20, 0, false);
  push(world, vs);
  sel.set([...ids(wooden), ...ids(stone), ...ids(sites)]);
  const card = () => getCommandCard(sel.forCard(), vs, input.cardMode());
  sel.setActiveType('wooden_wall');
  input.activate(byId(card(), 'wall-upgrade'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'upgradeWall');
  assert.deepEqual(sent[0].walls.slice().sort(), ids(wooden).slice().sort(), 'only the finished wooden segments, not the stone or the sites');
  sent.length = 0;
  run(world, 0.1);
  push(world, vs);
  // Cancel: the unfinished segments are torn down, upgrades are called off.
  input.activate(byId(card(), 'wall-cancel'));
  assert.deepEqual(sent.map((c) => c.type).sort(), ['cancelBuild', 'cancelBuild', 'cancelTrain', 'cancelTrain', 'cancelTrain', 'cancelTrain'].sort());
  assert.deepEqual(errors, []);
  sent.length = 0;
  run(world, 0.1);
  push(world, vs);
  // Dismantle the stone segments (the active subgroup now).
  sel.setActiveType('stone_wall');
  input.activate(byId(card(), 'wall-dismantle'));
  assert.deepEqual(sent.map((c) => c.type), ['cancelBuild', 'cancelBuild']);
  assert.deepEqual(sent.map((c) => c.building).sort(), ids(stone).slice().sort());
  input.dispose();
});

test('Esc with walls selected never cancels a wall upgrade', () => {
  const { world, vs, sel, input, sent } = inputScene();
  rich(world);
  const walls = row(world, 'wooden_wall', 12, 3, 16);
  world.issueCommand(0, { type: 'upgradeWall', walls: ids(walls) });
  run(world, 0.1);
  push(world, vs);
  sel.set(ids(walls));
  input.game.hud.currentCard = () => getCommandCard(sel.forCard(), vs, input.cardMode());
  input.game.hud.flashSlot = () => {};
  input.onKeyDown({ key: 'Escape', code: 'Escape', preventDefault() {}, target: document.body });
  assert.equal(sent.length, 0);
  input.dispose();
});

test('a box over a walled base takes its buildings, a box over only wall takes the segments', () => {
  const { world, vs, sel, input, setBox } = inputScene();
  const wall = [...row(world, 'wooden_wall', 2, 30, 30), ...row(world, 'wooden_wall', 2, 30, 31)];
  push(world, vs);
  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  setBox([]);
  input.boxSelect(0, 0, 47, 47, false);
  assert.deepEqual(sel.ids, [tc.id], 'the town center, not the 60 segments');
  input.boxSelect(0, 29, 47, 33, false);
  assert.equal(sel.size, 60, 'only wall in the box: all of it');
  assert.ok(sel.ids.every((id) => ids(wall).includes(id)));
  input.dispose();
});

// ---------------------------------------------------------------- selection panel

function panelScene() {
  const world = makeWorld();
  const vs = viewOf(world, 0, { seeAll: false });
  const sel = new Selection(vs);
  const root = document.createElement('div');
  const info = new InfoView(root, { selection: sel, viewState: vs, onSelectOnly() {}, onRemove() {}, onSelectType() {}, onCancelQueue() {}, onPortrait() {} });
  return { world, vs, sel, root, info };
}

test('a long wall shows a cell per type with its count, and one line for the health of the whole selection', () => {
  const { world, vs, sel, root, info } = panelScene();
  rich(world);
  const wooden = row(world, 'wooden_wall', 4, 30, 24);
  const stone = row(world, 'stone_wall', 4, 10, 25);
  world.issueCommand(0, { type: 'upgradeWall', walls: ids(wooden.slice(0, 3)) });
  run(world, 0.1);
  wooden[0].hp -= 100;
  push(world, vs);
  sel.set([...ids(wooden), ...ids(stone)]);
  info.update();
  assert.equal(root.findAll('hi-cell').length, 2, 'two type cells, not forty buttons');
  const counts = root.findAll('hi-cell-count').map((n) => n.textContent).sort();
  assert.deepEqual(counts, ['10', '30']);
  assert.equal(root.find('hi-grid-label').textContent, 'Walls × 40');
  const note = root.findAll('hi-note')[0].textContent;
  assert.equal(note, 'Health 20,400 / 20,500 · 1 damaged · 3 upgrading');
  // An ordinary group (24 or fewer) keeps one button per entity.
  sel.set(ids(wooden.slice(0, 10)));
  info.update();
  assert.equal(root.findAll('hi-cell').length, 10);
});

test('walls that turn to stone while selected move to their own cell, in a long selection and in a short one', () => {
  const { world, vs, sel, root, info } = panelScene();
  rich(world);
  const wooden = row(world, 'wooden_wall', 4, 30, 24);
  push(world, vs);
  sel.set(ids(wooden));
  info.update();
  assert.deepEqual(root.findAll('hi-cell-count').map((n) => n.textContent), ['30']);
  for (const w of wooden.slice(0, 10)) world.changeBuildingType(w, 'stone_wall'); // part of the upgrade finishes
  push(world, vs);
  info.update();
  assert.deepEqual(root.findAll('hi-cell-count').map((n) => n.textContent).sort(), ['10', '20'], 'a Stone Wall cell appears, the Wooden Wall one shrinks');
  // The same in a selection of 24 or fewer: every cell shows the type it is now.
  sel.set(ids(wooden.slice(8, 12)));
  info.update();
  const icons = () => root.findAll('hi-cell-icon').map((n) => n.textContent);
  assert.deepEqual(icons(), [BUILDINGS.stone_wall.icon, BUILDINGS.stone_wall.icon, BUILDINGS.wooden_wall.icon, BUILDINGS.wooden_wall.icon]);
  world.changeBuildingType(wooden[10], 'stone_wall');
  push(world, vs);
  info.update();
  assert.deepEqual(icons(), [BUILDINGS.stone_wall.icon, BUILDINGS.stone_wall.icon, BUILDINGS.stone_wall.icon, BUILDINGS.wooden_wall.icon]);
});

test('a wall upgrading shows "Upgrading to Stone Wall" with its progress; a finished wall says what it is for', () => {
  const { world, vs, sel, root, info } = panelScene();
  rich(world);
  const [a, b] = row(world, 'wooden_wall', 4, 2, 24);
  world.issueCommand(0, { type: 'upgradeWall', walls: [a.id] });
  run(world, 0.1);
  push(world, vs);
  sel.set([a.id]);
  info.update();
  assert.equal(root.find('hi-q-label').textContent, 'Upgrading to Stone Wall');
  assert.equal(root.find('hi-class').textContent, 'Wall');
  sel.set([b.id]);
  info.update();
  assert.match(root.findAll('hi-note').map((n) => n.textContent).join(' '), /Upgrade it to stone/);
});
