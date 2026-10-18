import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS } from '../../src/data/index.js';
import { makeWorld, run, runCollect, runUntil, place, eventsOf, errorsOf, spawn } from './helpers.js';

const workers = (w, p = 0) => w.unitsOf(p).filter((u) => u.type === 'worshipper');

test('placement validity rules', () => {
  const w = makeWorld({ map: { forest: [{ x: 20, y: 20, w: 2, h: 2 }], water: [{ x: 30, y: 4, w: 3, h: 3 }] } });
  assert.equal(w.canPlaceBuilding(0, 'house', 14, 14), true);
  assert.equal(w.canPlaceBuilding(0, 'house', 19, 19), false, 'forest');
  assert.equal(w.canPlaceBuilding(0, 'house', 29, 3), false, 'water');
  assert.equal(w.canPlaceBuilding(0, 'house', 7, 7), false, 'overlaps town center');
  assert.equal(w.canPlaceBuilding(0, 'house', 13, 6), false, 'overlaps mine');
  assert.equal(w.canPlaceBuilding(0, 'house', -1, 5), false, 'out of bounds');
  assert.equal(w.canPlaceBuilding(0, 'house', 47, 5), false, 'out of bounds right');
  // Town center must keep 3 tiles from mines.
  assert.equal(w.canPlaceBuilding(0, 'town_center', 17, 6), false);
  assert.equal(w.canPlaceBuilding(0, 'town_center', 19, 6), true);
  // Enemy units block, own units do not.
  spawn(w, 1, 'warrior', 15, 15);
  assert.equal(w.canPlaceBuilding(0, 'house', 14, 14), false);
  assert.equal(w.canPlaceBuilding(1, 'house', 14, 14), true);
  const p = w.findPlacement(0, 'barracks', 15, 15, 10);
  assert.ok(p && w.canPlaceBuilding(0, 'barracks', p.tx, p.ty));
});

test('placement refusals say why: trees, building, mine, unit; water and the map edge stay generic', () => {
  const w = makeWorld({ map: { forest: [{ x: 20, y: 20, w: 2, h: 2 }], water: [{ x: 30, y: 4, w: 3, h: 3 }] } });
  const err = (type, tx, ty) => w.placementError(0, type, tx, ty);
  assert.equal(err('house', 14, 14), null);
  assert.equal(err('house', 19, 19), 'Trees in the way.');
  assert.equal(err('house', 7, 7), 'Another building is in the way.', 'the Town Center');
  assert.equal(err('house', 13, 6), 'A gold mine is in the way.');
  assert.equal(err('house', 29, 3), "Can't build there.", 'water');
  assert.equal(err('house', -1, 5), "Can't build there.", 'off the map');
  assert.equal(err('house', 47, 5), "Can't build there.", 'off the map');
  spawn(w, 1, 'warrior', 15, 15);
  assert.equal(err('house', 14, 14), 'Something is in the way.', 'an enemy unit');
  assert.equal(err('house', 19, 19), 'Trees in the way.');
  assert.equal(w.placementError(1, 'house', 14, 14), null, 'own units are pushed out of the way');
  // Only the text differs by reason: every refusal is still a refusal.
  for (const [type, tx, ty] of [['house', 19, 19], ['house', 7, 7], ['house', 13, 6], ['house', 14, 14], ['house', 29, 3]]) {
    assert.equal(w.canPlaceBuilding(0, type, tx, ty), false, `${type} ${tx},${ty}`);
  }
});

test('build deducts cost immediately, completes, raises pop cap', () => {
  const w = makeWorld();
  const u = workers(w)[0];
  w.issueCommand(0, { type: 'build', units: [u.id], building: 'house', tx: 14, ty: 14 });
  w.tick();
  assert.equal(w.players[0].gold, 400 - 80);
  assert.equal(w.players[0].wood, 200 - 30);
  const snapU = w.getSnapshot().entities.find((e) => e.id === u.id);
  assert.deepEqual(snapU.bo, { b: 'house', tx: 14, ty: 14 });
  const ev = runCollect(w, 8);
  const placed = eventsOf(ev, 'construction');
  assert.equal(placed.length, 1);
  const house = w.getEntity(placed[0].id);
  assert.equal(house.constructed, false);
  assert.ok(house.hp >= house.maxHp * 0.1 && house.hp < house.maxHp);
  assert.equal(u.state, 'build');
  assert.ok(!w.map.isPassable(14, 14));
  const ev2 = runCollect(w, BUILDINGS.house.buildTime + 1);
  assert.equal(eventsOf(ev2, 'buildingComplete').length, 1);
  assert.equal(house.constructed, true);
  assert.equal(Math.round(house.hp), house.maxHp);
  assert.equal(w.players[0].popCap, 20);
  assert.equal(w.players[0].stats.buildings, 1);
  // builder no longer inside the footprint
  assert.ok(!(u.x > 14 && u.x < 16 && u.y > 14 && u.y < 16));
});

test('helpers speed construction', () => {
  const a = makeWorld();
  const b = makeWorld();
  const solo = workers(a)[0];
  a.issueCommand(0, { type: 'build', units: [solo.id], building: 'house', tx: 14, ty: 14 });
  const ws = workers(b).slice(0, 3);
  b.issueCommand(0, { type: 'build', units: ws.map((u) => u.id), building: 'house', tx: 14, ty: 14 });
  const t1 = runUntil(a, () => a.buildingsOf(0).some((x) => x.type === 'house' && x.constructed), 60);
  const t2 = runUntil(b, () => b.buildingsOf(0).some((x) => x.type === 'house' && x.constructed), 60);
  assert.ok(t1 > 0 && t2 > 0);
  assert.ok(t2 < t1 * 0.7, `solo ${t1} vs team ${t2}`);
  assert.equal(b.players[0].gold, 400 - 80, 'helpers do not pay');
});

test('build errors: tier, requires, resources, placement', () => {
  const w = makeWorld();
  const u = workers(w)[0];
  const errs = [];
  const tryBuild = (building, tx, ty) => {
    w.events.length = 0;
    w.issueCommand(0, { type: 'build', units: [u.id], building, tx, ty });
    w.tick();
    errs.push(...errorsOf(w.events));
  };
  tryBuild('titan_gate', 20, 20);
  tryBuild('temple', 20, 20);
  w.players[0].gold = 10;
  tryBuild('house', 20, 20);
  w.players[0].gold = 500;
  w.players[0].wood = 0;
  tryBuild('house', 20, 20);
  w.players[0].wood = 500;
  tryBuild('house', 7, 7);
  assert.deepEqual(errs, ['Requires City.', 'Requires a Shrine.', 'Not enough gold.', 'Not enough wood.', 'Another building is in the way.']);
  assert.equal(w.players[0].gold, 500);
});

test('a different order before arrival refunds the cost', () => {
  const w = makeWorld();
  const u = workers(w)[0];
  w.issueCommand(0, { type: 'build', units: [u.id], building: 'barracks', tx: 30, ty: 20 });
  w.tick();
  assert.equal(w.players[0].gold, 400 - 180);
  w.issueCommand(0, { type: 'move', units: [u.id], x: 10, y: 20 });
  w.tick();
  assert.equal(w.players[0].gold, 400);
  assert.equal(w.players[0].wood, 200);
});

test('site blocked on arrival refunds with an error', () => {
  const w = makeWorld();
  const u = workers(w)[0];
  w.issueCommand(0, { type: 'build', units: [u.id], building: 'house', tx: 24, ty: 24 });
  w.tick();
  // Another building appears on the site before the worker arrives.
  place(w, 0, 'house', 24, 24);
  const ev = runCollect(w, 12);
  assert.ok(errorsOf(ev).includes('Another building is in the way.'));
  assert.equal(w.players[0].gold, 400);
});

test('cancelBuild refunds 75% and removes the site', () => {
  const w = makeWorld();
  const u = workers(w)[0];
  w.issueCommand(0, { type: 'build', units: [u.id], building: 'barracks', tx: 14, ty: 14 });
  const ev = runCollect(w, 8);
  const site = w.getEntity(eventsOf(ev, 'construction')[0].id);
  assert.ok(site && !site.constructed);
  w.issueCommand(0, { type: 'cancelBuild', building: site.id });
  w.tick();
  assert.equal(w.getEntity(site.id), null);
  assert.equal(w.players[0].gold, 400 - 180 + 135);
  assert.equal(w.players[0].wood, 200 - 60 + 45);
  assert.ok(w.map.isPassable(15, 15));
  run(w, 0.2);
  assert.notEqual(u.state, 'build');
});

test('smart-click on own unfinished building helps build; leaving pauses', () => {
  const w = makeWorld();
  const [a, b] = workers(w);
  w.issueCommand(0, { type: 'build', units: [a.id], building: 'house', tx: 14, ty: 14 });
  const ev = runCollect(w, 8);
  const site = w.getEntity(eventsOf(ev, 'construction')[0].id);
  w.issueCommand(0, { type: 'move', units: [a.id], x: 30, y: 30 });
  run(w, 1);
  const bp = site.buildProgress;
  run(w, 3);
  assert.equal(site.buildProgress, bp, 'paused');
  w.issueCommand(0, { type: 'smart', units: [b.id], target: site.id, x: site.x, y: site.y });
  run(w, 6);
  assert.ok(site.buildProgress > bp);
  assert.equal(b.state, 'build');
});

test('Storehouse mine gap: Chebyshev distance between footprints', () => {
  const w = makeWorld({ map: { mines: [{ tx: 13, ty: 6, amount: 12000 }, { tx: 30, ty: 20, amount: 12000 }, { tx: 38, ty: 38, amount: 12000 }] } });
  const err = (tx, ty, type = 'storehouse') => w.placementError(0, type, tx, ty);
  // West: footprint 25..26, gap 30 - 27 = 3 → fine; 26..27 gap 2 → too close.
  assert.equal(err(25, 20), null);
  assert.equal(err(26, 20), 'Too close to a gold mine.');
  assert.equal(err(27, 21), 'Too close to a gold mine.');
  // East: mine ends at 33; storehouse at 36 → gap 3.
  assert.equal(err(36, 21), null);
  assert.equal(err(35, 21), 'Too close to a gold mine.');
  // Diagonal: corner gap max(dx, dy).
  assert.equal(err(26, 15), null, 'gap x 2, y 3 → 3');
  assert.equal(err(26, 16), 'Too close to a gold mine.', 'gap x 2, y 2');
  // Overlapping the mine itself is a different refusal.
  assert.equal(err(30, 20), 'A gold mine is in the way.');
  assert.equal(w.canPlaceBuilding(0, 'storehouse', 26, 20), false);
  assert.equal(w.canPlaceBuilding(0, 'storehouse', 25, 20), true);
  // Other buildings may hug a mine.
  assert.equal(err(28, 20, 'house'), null);
  assert.equal(err(28, 20, 'barracks'), 'A gold mine is in the way.', 'barracks is 3×3: overlaps');
  assert.equal(err(27, 20, 'barracks'), null);
  // Town Center: 4×4.
  assert.equal(err(23, 20, 'town_center'), null);
  assert.equal(err(24, 20, 'town_center'), 'Too close to a gold mine.');
});

test('build command near a mine reports "Too close to a gold mine." and costs nothing', () => {
  const w = makeWorld({ map: { mines: [{ tx: 13, ty: 6, amount: 12000 }, { tx: 30, ty: 20, amount: 12000 }, { tx: 38, ty: 38, amount: 12000 }] } });
  const u = workers(w)[0];
  w.issueCommand(0, { type: 'build', units: [u.id], building: 'storehouse', tx: 27, ty: 20 });
  w.tick();
  assert.deepEqual(errorsOf(w.events), ['Too close to a gold mine.']);
  assert.equal(w.players[0].gold, 400);
  w.events.length = 0;
  w.issueCommand(0, { type: 'build', units: [u.id], building: 'storehouse', tx: 25, ty: 20 });
  w.tick();
  assert.deepEqual(errorsOf(w.events), []);
  assert.equal(w.players[0].gold, 400 - 120);
  // findPlacement never proposes a drop-off too close to a mine.
  for (let i = 0; i < 20; i++) {
    const p = w.findPlacement(0, 'storehouse', 31 + (i % 5) - 2, 21 + Math.floor(i / 5) - 2, 10);
    assert.ok(p, 'found a spot');
    assert.equal(w.placementError(0, 'storehouse', p.tx, p.ty), null);
  }
});

test('placement rejects out-of-range, huge and non-integer coordinates', () => {
  const w = makeWorld();
  for (const [tx, ty] of [[1e308, 5], [5, 1e308], [-1e308, 5], [Infinity, 5], [NaN, 5], [5.5, 5], [47, 47], [47, 10], [10, 47], [2 ** 31, 0], [-0.5, 3]]) {
    assert.equal(w.canPlaceBuilding(0, 'house', tx, ty), false, `${tx},${ty}`);
    assert.equal(w.placementError(0, 'house', tx, ty), "Can't build there.");
  }
  for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '', null, undefined, 3, {}]) {
    assert.equal(w.canPlaceBuilding(0, type, 20, 20), false, String(type));
  }
  assert.equal(w.findPlacement(0, '__proto__', 20, 20, 10), null);
  assert.equal(w.findPlacement(0, 'house', NaN, 20, 10), null);
  assert.ok(w.findPlacement(0, 'house', 20, 20, 1e9), 'huge search radius is capped, not a hang');
});
