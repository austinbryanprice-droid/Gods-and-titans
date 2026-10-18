import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import {
  checkPlacement, footprintAt, MINE_GAP, CANT_BUILD, TOO_CLOSE_TO_MINE, TREES_IN_WAY, BUILDING_IN_WAY, MINE_IN_WAY, UNIT_IN_WAY, UNEXPLORED,
} from '../../src/game/placement.js';
import * as simText from '../../src/sim/construction.js';
import { makeWorld, spawn, place, clearUnits, run } from '../sim/helpers.js';

/** A ViewState for player `me` fed one real snapshot from the world. */
function viewOf(world, me = 0, opts = {}) {
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: me });
  vs.pushSnapshot(world.getSnapshot(), 0);
  if (opts.seeAll) {
    vs.explored.fill(1);
    vs.visible.fill(1);
  }
  return vs;
}

test('open ground near my base is valid, every tile green', () => {
  const world = makeWorld();
  const vs = viewOf(world);
  const r = checkPlacement(vs, 0, 'house', 7, 12);
  assert.equal(r.valid, true);
  assert.equal(r.size, 2);
  assert.equal(r.tiles.length, 4);
  assert.ok(r.tiles.every(Boolean));
  assert.equal(world.canPlaceBuilding(0, 'house', 7, 12), true);
});

test('map edge, unknown type and NaN are invalid', () => {
  const world = makeWorld();
  const vs = viewOf(world, 0, { seeAll: true });
  const edge = checkPlacement(vs, 0, 'barracks', -1, 20);
  assert.equal(edge.valid, false);
  assert.deepEqual(edge.tiles.map(Boolean), [false, true, true, false, true, true, false, true, true]);
  assert.equal(checkPlacement(vs, 0, 'nope', 5, 5).valid, false);
  assert.equal(checkPlacement(vs, 0, 'house', NaN, 5).valid, false);
});

test('forest blocks until the tree is felled (from the snapshot)', () => {
  const world = makeWorld({ map: { forest: [{ x: 6, y: 14, w: 1, h: 1 }] } });
  const vs = viewOf(world);
  const r = checkPlacement(vs, 0, 'house', 6, 13);
  assert.equal(r.valid, false);
  assert.deepEqual(r.tiles, [true, true, false, true]);
  // The sim fells the tree; the next snapshot turns the tile into grass in the view.
  world.map.takeWood(6, 14, 50);
  world.onTreeFelled(6, 14);
  vs.pushSnapshot(world.getSnapshot(), 50);
  assert.equal(checkPlacement(vs, 0, 'house', 6, 13).valid, true);
});

test('buildings and mines block their footprint tiles only', () => {
  const world = makeWorld();
  place(world, 0, 'house', 7, 14);
  const vs = viewOf(world);
  const r = checkPlacement(vs, 0, 'barracks', 8, 15);
  assert.equal(r.valid, false);
  // House covers (7..8, 14..15): only the barracks tile (8, 15) overlaps.
  assert.deepEqual(r.tiles, [false, true, true, true, true, true, true, true, true]);
  // The start mine at (13, 6).
  const m = checkPlacement(vs, 0, 'house', 12, 5);
  assert.equal(m.valid, false);
  assert.deepEqual(m.tiles, [true, true, true, false]);
});

test('drop-offs (Town Center, Storehouse) keep a 3-tile gap from gold mines', () => {
  const world = makeWorld({ map: { width: 64, height: 64, starts: [{ x: 6, y: 6 }, { x: 50, y: 50 }], mines: [{ tx: 13, ty: 6, amount: 12000 }, { tx: 30, ty: 30, amount: 12000 }] } });
  const vs = viewOf(world, 0, { seeAll: true });
  assert.equal(MINE_GAP, 3);
  // Mine footprint 30..32. A 4×4 TC at tx 23 spans 23..26: gap 30 - 27 = 3 → fine.
  const ok = checkPlacement(vs, 0, 'town_center', 23, 30);
  assert.equal(ok.valid, true);
  assert.equal(ok.message, null);
  assert.equal(world.canPlaceBuilding(0, 'town_center', 23, 30), true);
  const close = checkPlacement(vs, 0, 'town_center', 24, 30);
  assert.equal(close.valid, false);
  assert.equal(close.message, TOO_CLOSE_TO_MINE);
  assert.equal(world.placementError(0, 'town_center', 24, 30), TOO_CLOSE_TO_MINE);
  // Only the column of tiles within 2 tiles of the mine is red.
  for (let dy = 0; dy < 4; dy++) {
    assert.deepEqual(close.tiles.slice(dy * 4, dy * 4 + 4), [true, true, true, false]);
  }
  // Diagonal gap uses Chebyshev distance: corner to corner gap of 2 is too close.
  assert.equal(checkPlacement(vs, 0, 'town_center', 24, 24).valid, false);
  assert.equal(checkPlacement(vs, 0, 'town_center', 23, 23).valid, true);
  // Storehouse (2×2) too: 26..27 leaves a gap of 2, 25..26 a gap of 3.
  const sh = checkPlacement(vs, 0, 'storehouse', 26, 30);
  assert.equal(sh.valid, false);
  assert.equal(sh.message, TOO_CLOSE_TO_MINE);
  assert.deepEqual(sh.tiles, [true, false, true, false]);
  assert.equal(world.placementError(0, 'storehouse', 26, 30), TOO_CLOSE_TO_MINE);
  assert.equal(checkPlacement(vs, 0, 'storehouse', 25, 30).valid, true);
  assert.equal(checkPlacement(vs, 0, 'storehouse', 34, 33).valid, false, 'gap 1 east, diagonal');
  assert.equal(checkPlacement(vs, 0, 'storehouse', 36, 35).valid, true, 'gap 3 east and south');
  // Other buildings may hug a mine.
  assert.equal(checkPlacement(vs, 0, 'house', 28, 30).valid, true);
  // A footprint overlapping the mine is "in the way", not "too close", even for a drop-off.
  assert.equal(checkPlacement(vs, 0, 'storehouse', 29, 30).message, MINE_IN_WAY);
  assert.equal(checkPlacement(vs, 0, 'house', 29, 30).message, MINE_IN_WAY);
});

test('unexplored tiles are not buildable; explored but fogged ones are', () => {
  const world = makeWorld();
  const vs = viewOf(world);
  assert.equal(checkPlacement(vs, 0, 'house', 30, 30).valid, false, 'never seen');
  assert.equal(world.canPlaceBuilding(0, 'house', 30, 30), true);
  // A worker walks over, then away: the tiles stay explored.
  const w = spawn(world, 0, 'worshipper', 31, 31);
  vs.pushSnapshot(world.getSnapshot(), 50);
  assert.equal(checkPlacement(vs, 0, 'house', 30, 30).valid, true);
  w.x = 10;
  w.y = 12;
  vs.pushSnapshot(world.getSnapshot(), 100);
  assert.equal(vs.isVisibleAt(30.5, 30.5), false);
  assert.equal(checkPlacement(vs, 0, 'house', 30, 30).valid, true);
});

test('visible enemy and neutral units block; own and allied units do not; hidden enemies are unknown', () => {
  const world = makeWorld({ players: 3, teams: [1, 2, 1], map: { width: 64, height: 64 } });
  const vs0 = viewOf(world);
  // Own and allied workers on the site.
  spawn(world, 0, 'worshipper', 8.5, 13.5);
  spawn(world, 2, 'warrior', 7.5, 12.5);
  let vs = viewOf(world);
  assert.equal(checkPlacement(vs, 0, 'house', 7, 12).valid, true);
  assert.equal(world.canPlaceBuilding(0, 'house', 7, 12), true);
  // An enemy warrior steps onto it, in plain view.
  const foe = spawn(world, 1, 'warrior', 8.5, 12.5);
  vs = viewOf(world);
  const r = checkPlacement(vs, 0, 'house', 7, 12);
  assert.equal(r.valid, false);
  assert.deepEqual(r.tiles, [true, false, true, true]);
  assert.equal(world.canPlaceBuilding(0, 'house', 7, 12), false);
  // Neutral creep.
  foe.dead = true;
  world.cleanup();
  spawn(world, -1, 'warrior', 7.5, 13.5);
  vs = viewOf(world);
  assert.equal(checkPlacement(vs, 0, 'house', 7, 12).valid, false);
  // An enemy in an explored but dark area is not known to the client.
  clearUnits(world, -1);
  const vsFar = viewOf(world);
  vsFar.explored.fill(1);
  spawn(world, 1, 'warrior', 40.5, 40.5);
  vsFar.pushSnapshot(world.getSnapshot(), 50);
  vsFar.explored.fill(1);
  assert.equal(vsFar.isVisibleAt(40.5, 40.5), false);
  assert.equal(checkPlacement(vsFar, 0, 'house', 40, 40).valid, true);
  assert.ok(vs0);
});

test('enemy buildings: unseen ones are unknown, remembered ones block', () => {
  const world = makeWorld({ map: { width: 64, height: 64 } });
  const hut = place(world, 1, 'house', 30, 30);
  const vs = viewOf(world);
  vs.explored.fill(1); // pretend the area was scouted before the house went up
  assert.equal(checkPlacement(vs, 0, 'house', 30, 30).valid, true, 'never seen: unknown');
  // A scout sees it, then leaves: the house is remembered.
  const scout = spawn(world, 0, 'worshipper', 33, 33);
  vs.pushSnapshot(world.getSnapshot(), 50);
  assert.ok(vs.lastSeen.has(hut.id));
  scout.x = 8;
  scout.y = 14;
  vs.pushSnapshot(world.getSnapshot(), 100);
  assert.equal(vs.isVisibleAt(30.5, 30.5), false);
  assert.equal(checkPlacement(vs, 0, 'house', 30, 30).valid, false);
  assert.equal(checkPlacement(vs, 0, 'house', 31, 31).valid, false);
});

test('agrees with the sim on a whole-map sweep when everything is visible', () => {
  const world = makeWorld({
    map: { width: 40, height: 40, forest: [{ x: 18, y: 4, w: 6, h: 3 }], water: [{ x: 2, y: 28, w: 6, h: 6 }], rock: [{ x: 30, y: 10, w: 2, h: 5 }], starts: [{ x: 6, y: 6 }, { x: 28, y: 28 }] },
  });
  place(world, 0, 'barracks', 12, 14);
  spawn(world, 1, 'warrior', 20.5, 20.5);
  run(world, 0.1);
  const vs = viewOf(world, 0, { seeAll: true });
  let checked = 0;
  for (const type of ['house', 'barracks', 'town_center', 'storehouse']) {
    for (let ty = -2; ty < 40; ty += 1) {
      for (let tx = -2; tx < 40; tx += 1) {
        const c = checkPlacement(vs, 0, type, tx, ty);
        const a = c.valid;
        const b = world.canPlaceBuilding(0, type, tx, ty);
        assert.equal(a, b, `${type} at ${tx},${ty}: client ${a} sim ${b}`);
        assert.equal(c.message, world.placementError(0, type, tx, ty), `${type} at ${tx},${ty}: message`);
        checked++;
      }
    }
  }
  assert.ok(checked > 4000);
});

test('footprintAt centres the footprint under the cursor', () => {
  assert.deepEqual(footprintAt('house', 10.2, 10.9), { tx: 9, ty: 10 });
  assert.deepEqual(footprintAt('barracks', 10.2, 10.9), { tx: 9, ty: 9 });
  assert.deepEqual(footprintAt('town_center', 10.6, 10.4), { tx: 9, ty: 8 });
});

test('planned buildings (ordered, not placed yet) block like buildings', () => {
  const world = makeWorld();
  const vs = viewOf(world);
  assert.equal(checkPlacement(vs, 0, 'house', 7, 12).valid, true);
  const planned = [{ b: 'house', tx: 7, ty: 12 }, { b: 'nope', tx: 0, ty: 0 }];
  const r = checkPlacement(vs, 0, 'house', 8, 12, planned);
  assert.equal(r.valid, false);
  assert.equal(r.message, BUILDING_IN_WAY);
  assert.deepEqual(r.tiles, [false, true, false, true], 'only the overlapping column');
  assert.equal(checkPlacement(vs, 0, 'house', 9, 12, planned).valid, true, 'right next to it is fine');
});

test('refusal texts say why: fog, trees, a building, a mine, a unit; water and the map edge stay generic', () => {
  const world = makeWorld({ map: { forest: [{ x: 20, y: 20, w: 2, h: 2 }], water: [{ x: 30, y: 4, w: 3, h: 3 }] } });
  const vs = viewOf(world, 0, { seeAll: true });
  const msg = (type, tx, ty) => checkPlacement(vs, 0, type, tx, ty).message;
  assert.equal(msg('house', 14, 14), null);
  assert.equal(msg('house', 19, 19), TREES_IN_WAY);
  assert.equal(msg('house', 7, 7), BUILDING_IN_WAY, 'the Town Center');
  assert.equal(msg('house', 13, 6), MINE_IN_WAY);
  assert.equal(msg('house', 29, 3), CANT_BUILD, 'water');
  assert.equal(msg('house', -1, 5), CANT_BUILD, 'off the map');
  assert.equal(msg('town_center', 17, 6), TOO_CLOSE_TO_MINE);
  assert.equal(msg('nope', 14, 14), CANT_BUILD);
  // An enemy warrior in plain view.
  spawn(world, 1, 'warrior', 15, 15);
  const seen = viewOf(world, 0, { seeAll: true });
  assert.equal(checkPlacement(seen, 0, 'house', 14, 14).message, UNIT_IN_WAY);
  assert.equal(world.placementError(0, 'house', 14, 14), UNIT_IN_WAY);
  // Several reasons at once: the first of terrain, building, mine, unit, gap names it.
  assert.equal(checkPlacement(seen, 0, 'house', 19, 19).message, TREES_IN_WAY);
});

test('unexplored ground is named as such, whatever lies in it', () => {
  const world = makeWorld({ map: { forest: [{ x: 30, y: 30, w: 4, h: 4 }], water: [{ x: 38, y: 30, w: 4, h: 4 }] } });
  const vs = viewOf(world);
  assert.equal(vs.explored[31 * vs.map.width + 31], 0);
  // Open ground, trees and water that nobody has seen all read the same.
  for (const [tx, ty] of [[24, 30], [31, 31], [39, 31], [33, 30]]) {
    const r = checkPlacement(vs, 0, 'house', tx, ty);
    assert.equal(r.valid, false, `${tx},${ty}`);
    assert.equal(r.message, UNEXPLORED, `${tx},${ty}`);
  }
  // Once the area is explored the real reason shows.
  vs.explored.fill(1);
  assert.equal(checkPlacement(vs, 0, 'house', 31, 31).message, TREES_IN_WAY);
  assert.equal(checkPlacement(vs, 0, 'house', 39, 31).message, CANT_BUILD);
  assert.equal(checkPlacement(vs, 0, 'house', 24, 30).message, null);
});

test('the texts match the sim\'s (the fog text is the client\'s own)', () => {
  assert.equal(CANT_BUILD, simText.CANT_BUILD);
  assert.equal(TOO_CLOSE_TO_MINE, simText.TOO_CLOSE_TO_MINE);
  assert.equal(TREES_IN_WAY, simText.TREES_IN_WAY);
  assert.equal(BUILDING_IN_WAY, simText.BUILDING_IN_WAY);
  assert.equal(MINE_IN_WAY, simText.MINE_IN_WAY);
  assert.equal(UNIT_IN_WAY, simText.UNIT_IN_WAY);
  const all = [CANT_BUILD, TOO_CLOSE_TO_MINE, TREES_IN_WAY, BUILDING_IN_WAY, MINE_IN_WAY, UNIT_IN_WAY, UNEXPLORED];
  assert.equal(new Set(all).size, all.length, 'no two reasons share a text');
});
