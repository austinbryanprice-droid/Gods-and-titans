// Decade of Peace, building: until the peace runs out nobody builds within PEACE_BUILD_GAP tiles of an
// enemy Town Center (DESIGN 5.10). The rule is the sim's placementError, so every way a building gets
// ordered (a build command, a wall line, a queued order met on arrival, the AI's own search) obeys it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PEACE_BUILD_GAP } from '../../src/config.js';
import { peaceBlocksFootprint, peaceBuildNotice } from '../../src/sim/peace.js';
import { cancelBuild } from '../../src/sim/construction.js';
import { makeWorld, run, runCollect, place, spawn, errorsOf } from './helpers.js';

const NOTICE = /^The Decade of Peace holds for another \d+:\d\d: no building near an enemy Town Center yet\.$/;

/** Player 0's Town Center covers tiles 6..9, player 1's 60..63: far enough apart that only the test's sites are near either. */
function arena(opts = {}) {
  return makeWorld({ map: { width: 96, height: 96, starts: [{ x: 6, y: 6 }, { x: 60, y: 60 }] }, peaceMinutes: 30, ...opts });
}

const workerOf = (w, owner) => w.unitsOf(owner).find((u) => u.type === 'worshipper');

/** Order a House with player `owner`'s Worshipper and tick once; returns the errors that player got. */
function orderHouse(w, owner, tx, ty, queue = false) {
  w.events.length = 0;
  w.issueCommand(owner, { type: 'build', units: [workerOf(w, owner).id], building: 'house', tx, ty, queue });
  w.tick();
  return errorsOf(w.events, owner);
}

/** Jump to the end of the peace (the real countdown is thirty-plus game minutes). */
function endPeace(w) {
  w.peaceEnd = w.time;
  w.tick();
  w.events.length = 0;
}

test('the kept-clear ground is PEACE_BUILD_GAP empty tiles of straight distance, rounded at the corners', () => {
  const tc = [{ tx: 60, ty: 60, size: 4 }];
  assert.equal(PEACE_BUILD_GAP, 20);
  // West of the Town Center: tile 40 has 19 empty tiles (41..59) between, tile 39 has 20.
  assert.equal(peaceBlocksFootprint(tc, 40, 61, 1), true);
  assert.equal(peaceBlocksFootprint(tc, 39, 61, 1), false);
  // East (it covers 60..63): tile 83 has 19 empty tiles between, tile 84 has 20.
  assert.equal(peaceBlocksFootprint(tc, 83, 61, 1), true);
  assert.equal(peaceBlocksFootprint(tc, 84, 61, 1), false);
  // North and south the same.
  assert.equal(peaceBlocksFootprint(tc, 61, 40, 1), true);
  assert.equal(peaceBlocksFootprint(tc, 61, 39, 1), false);
  assert.equal(peaceBlocksFootprint(tc, 61, 83, 1), true);
  assert.equal(peaceBlocksFootprint(tc, 61, 84, 1), false);
  // A footprint counts by its nearest tile: a House on 38..39 keeps 20 away, on 39..40 it does not.
  assert.equal(peaceBlocksFootprint(tc, 38, 61, 2), false);
  assert.equal(peaceBlocksFootprint(tc, 39, 61, 2), true);
  // A Barracks (3 wide) on 37..39 is clear, on 38..40 is not.
  assert.equal(peaceBlocksFootprint(tc, 37, 61, 3), false);
  assert.equal(peaceBlocksFootprint(tc, 38, 61, 3), true);
  // Corners: the distance is straight, so (14, 14) empty tiles away is inside (19.8) and (15, 14) is out (20.5).
  assert.equal(peaceBlocksFootprint(tc, 45, 45, 1), true);
  assert.equal(peaceBlocksFootprint(tc, 44, 45, 1), false);
  assert.equal(peaceBlocksFootprint(tc, 45, 44, 1), false);
  // The Town Center's own tiles and the ring touching it are inside, and with no Town Center nothing is.
  assert.equal(peaceBlocksFootprint(tc, 61, 61, 1), true);
  assert.equal(peaceBlocksFootprint(tc, 64, 64, 1), true);
  assert.equal(peaceBlocksFootprint([], 61, 61, 1), false);
  // Every Town Center counts.
  const two = [...tc, { tx: 10, ty: 10, size: 4 }];
  assert.equal(peaceBlocksFootprint(two, 20, 12, 1), true);
  assert.equal(peaceBlocksFootprint(tc, 20, 12, 1), false);
});

test('a build order inside the ground of an enemy Town Center is refused with the reason, and costs nothing', () => {
  const w = arena();
  const gold = w.players[0].gold;
  const wood = w.players[0].wood;
  const blocked = orderHouse(w, 0, 39, 61); // covers 39..40: 19 empty tiles from the Town Center
  assert.equal(blocked.length, 1);
  assert.match(blocked[0], NOTICE);
  assert.equal(blocked[0], peaceBuildNotice(w.peaceLeft()), 'the same words the client puts on the ghost');
  assert.equal(w.players[0].gold, gold, 'nothing was paid');
  assert.equal(w.players[0].wood, wood);
  const order = workerOf(w, 0).order;
  assert.notEqual(order && order.type, 'build', 'the Worshipper was not sent');
  assert.equal(w.placementError(0, 'house', 39, 61), blocked[0]);
  assert.equal(w.canPlaceBuilding(0, 'house', 39, 61), false);
  // One tile further out is fine: the order is paid and the Worshipper goes.
  assert.deepEqual(orderHouse(w, 0, 38, 61), []);
  assert.equal(w.players[0].gold, gold - 80);
  assert.equal(workerOf(w, 0).order.type, 'build');
});

test('a Shift-queued build is refused the same way, and so is every building type', () => {
  const w = arena();
  const gold = w.players[0].gold;
  assert.match(orderHouse(w, 0, 39, 61, true)[0], NOTICE);
  for (const type of ['barracks', 'shrine', 'storehouse', 'tower', 'town_center']) {
    assert.match(w.placementError(0, type, 45, 61), NOTICE, type);
  }
  assert.equal(w.players[0].gold, gold);
});

test('the rule is read from the real Town Centers, so no client can place around it', () => {
  const w = arena();
  const gold = w.players[0].gold;
  // Hand-made commands: fractions are floored, the way a build is always read, and nothing slips through.
  for (const [tx, ty] of [[39.9, 61.2], [45, 61], [62, 40], [70, 70], [61, 61]]) {
    w.events.length = 0;
    w.issueCommand(0, { type: 'build', units: [workerOf(w, 0).id], building: 'house', tx, ty });
    w.tick();
    const errs = errorsOf(w.events, 0);
    assert.equal(errs.length, 1, `${tx},${ty}`);
    assert.ok(NOTICE.test(errs[0]) || /in the way/.test(errs[0]), `${tx},${ty}: ${errs[0]}`);
  }
  assert.equal(w.players[0].gold, gold);
  assert.equal(w.perf.commandErrors, 0);
});

test('only an enemy Town Center keeps ground clear: teammates, your own and other buildings do not', () => {
  const w = makeWorld({ players: 3, teams: [1, 1, 2], map: { width: 96, height: 96 }, peaceMinutes: 30 });
  // Player 1 (a teammate) has its Town Center at (86, 86), player 2 (an enemy) at (86, 6).
  assert.equal(w.placementError(0, 'house', 80, 80), null, 'next to a teammate\'s Town Center');
  assert.match(w.placementError(0, 'house', 80, 12), NOTICE, 'next to an enemy Town Center');
  assert.match(w.placementError(1, 'house', 80, 12), NOTICE, 'the teammate is kept away from it too');
  assert.equal(w.placementError(2, 'house', 80, 12), null, 'its owner builds there freely');
  assert.match(w.placementError(2, 'house', 80, 80), NOTICE, 'and is kept from both of the others');
  // An enemy House, Barracks or Tower does not claim ground; only the Town Center does.
  place(w, 2, 'barracks', 40, 40);
  place(w, 2, 'tower', 44, 44);
  assert.equal(w.placementError(0, 'house', 43, 41), null, 'between their Barracks and Tower');
});

test('a Town Center site claims ground the moment it is placed, and gives it back when cancelled', () => {
  const w = arena();
  assert.equal(w.placementError(0, 'house', 30, 61), null);
  const site = place(w, 1, 'town_center', 45, 60, false);
  assert.equal(site.constructed, false);
  assert.match(w.placementError(0, 'house', 30, 61), NOTICE, 'a second Town Center, still a site, keeps 20 tiles clear');
  assert.equal(w.placementError(0, 'house', 23, 61), null, 'and no more');
  cancelBuild(w, 1, site);
  w.cleanup();
  assert.equal(w.placementError(0, 'house', 30, 61), null, 'gone with the site');
});

test('a wall line is laid only where it is outside the ground, and refused when it is all inside', () => {
  const w = arena();
  const me = spawn(w, 0, 'worshipper', 38.5, 61.5);
  const wood = w.players[0].wood;
  w.events.length = 0;
  // From tile 30 east towards 49, all on row 61: tiles 30..39 are clear (39 has 20 empty tiles to the Town Center), 40.. are not.
  w.issueCommand(0, { type: 'build', units: [me.id], building: 'wooden_wall', tx: 30, ty: 61, tx2: 49, ty2: 61 });
  w.tick();
  assert.deepEqual(errorsOf(w.events, 0), [], 'part of the line can be built, so there is no error');
  const segs = w.buildingsOf(0).filter((b) => b.def.wall);
  assert.equal(segs.length, 10);
  assert.ok(segs.every((b) => b.tx <= 39 && b.ty === 61), 'every segment is outside the ground');
  assert.equal(w.players[0].wood, wood - 10 * 12, 'and only those are paid');
  // A line wholly inside is refused with the reason.
  const woodLeft = w.players[0].wood;
  w.events.length = 0;
  w.issueCommand(0, { type: 'build', units: [me.id], building: 'wooden_wall', tx: 42, ty: 61, tx2: 50, ty2: 61 });
  w.tick();
  const errs = errorsOf(w.events, 0);
  assert.equal(errs.length, 1);
  assert.match(errs[0], NOTICE);
  assert.equal(w.players[0].wood, woodLeft);
});

test('a build ordered earlier is refused on arrival when a Town Center has been founded beside the site since', () => {
  const w = arena();
  const gold = w.players[0].gold;
  assert.deepEqual(orderHouse(w, 0, 30, 61), []);
  assert.equal(w.players[0].gold, gold - 80);
  place(w, 1, 'town_center', 45, 62, false); // the enemy founds a Town Center while the Worshipper is on its way
  const ev = runCollect(w, 60);
  const errs = errorsOf(ev, 0);
  assert.equal(errs.length, 1);
  assert.match(errs[0], NOTICE);
  assert.equal(w.players[0].gold, gold, 'refunded');
  assert.equal(w.buildingsOf(0).filter((b) => b.type === 'house').length, 0);
});

test('findPlacement never proposes a site inside the ground', () => {
  const w = arena();
  const spot = w.findPlacement(0, 'house', 50, 61, 30);
  assert.ok(spot, 'there is room outside');
  assert.equal(w.peaceBuildBlocks(0, spot.tx, spot.ty, 2), false);
  const gx = Math.max(60 - (spot.tx + 2), spot.tx - 64, 0);
  const gy = Math.max(60 - (spot.ty + 2), spot.ty - 64, 0);
  assert.ok(Math.hypot(gx, gy) >= PEACE_BUILD_GAP, `${spot.tx},${spot.ty} is ${Math.hypot(gx, gy).toFixed(1)} tiles from the Town Center`);
});

test('the ground is free again the moment the peace ends, and a normal game never had the rule', () => {
  const w = arena();
  assert.match(orderHouse(w, 0, 45, 61)[0], NOTICE);
  endPeace(w);
  assert.equal(w.peace, false);
  assert.equal(w.peaceBuildBlocks(0, 45, 61, 2), false);
  assert.deepEqual(orderHouse(w, 0, 45, 61), []);
  assert.equal(workerOf(w, 0).order.type, 'build');
  const normal = arena({ peaceMinutes: 0 });
  assert.equal(normal.peace, false);
  assert.equal(normal.placementError(0, 'house', 45, 61), null);
  assert.deepEqual(orderHouse(normal, 0, 45, 61), []);
});

test('the notice counts the peace down in whole game time, so it ages with the clock', () => {
  const w = arena();
  const first = orderHouse(w, 0, 45, 61)[0];
  assert.match(first, /another 30:00:/);
  run(w, 90);
  assert.match(orderHouse(w, 0, 45, 61)[0], /another 28:3\d:/);
});
