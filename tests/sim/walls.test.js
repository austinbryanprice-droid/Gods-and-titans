import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, BUILD_MENU } from '../../src/data/index.js';
import { isWallType, wallUpgradeOf, wallLine, wallMask, WALL_N, WALL_E, WALL_S, WALL_W } from '../../src/data/walls.js';
import { MAX_WALL_LINE, WALL_PLACE_RANGE } from '../../src/config.js';
import { WALL_TOO_FAR } from '../../src/sim/construction.js';
import { findTarget, findBreach } from '../../src/sim/combat.js';
import { makeWorld, run, runCollect, runUntil, place, spawn, clearUnits, eventsOf, errorsOf } from './helpers.js';

const workers = (w, p = 0) => w.unitsOf(p).filter((u) => u.type === 'worshipper');
const walls = (w, p = 0) => w.buildingList.filter((b) => !b.dead && b.def.wall && b.owner === p);
const done = (w, p = 0) => walls(w, p).filter((b) => b.constructed);
const buildLine = (w, ws, type, tx, ty, tx2, ty2, extra = {}) => w.issueCommand(0, { type: 'build', units: ws.map((u) => u.id), building: type, tx, ty, tx2, ty2, ...extra });

test('wall data: two segment types, the stone one reached by upgrading the wooden one', () => {
  assert.ok(isWallType('wooden_wall') && isWallType('stone_wall'));
  assert.ok(!isWallType('tower') && !isWallType('nope') && !isWallType('constructor'));
  const wood = BUILDINGS.wooden_wall;
  const stone = BUILDINGS.stone_wall;
  assert.equal(wood.size, 1);
  assert.equal(stone.size, 1);
  assert.ok(stone.hp > wood.hp && stone.armor > wood.armor, 'stone is the tougher wall');
  assert.deepEqual(wallUpgradeOf('wooden_wall'), wood.wallUpgrade);
  assert.equal(wallUpgradeOf('stone_wall'), null);
  assert.equal(wood.wallUpgrade.to, 'stone_wall');
  // Building stone outright costs what building wood and upgrading it does (a tower replacing a segment refunds the same either way).
  for (const res of ['gold', 'wood', 'faith']) assert.equal(stone.cost[res], wood.cost[res] + wood.wallUpgrade.cost[res], res);
  assert.ok(BUILD_MENU.includes('wooden_wall'), 'worshippers build the wooden wall from the menu');
  assert.ok(!BUILD_MENU.includes('stone_wall'), 'stone comes only from the upgrade');
  assert.equal(BUILDINGS.tower.joinsWalls, true);
});

test('stone comes only from the upgrade: a build command for a Stone Wall, single or as a line, is refused', () => {
  const w = makeWorld();
  w.players[0].wood = 1000;
  w.players[0].gold = 1000;
  const ws = workers(w).slice(0, 2);
  buildLine(w, ws, 'stone_wall', 14, 20, 20, 20);
  w.issueCommand(0, { type: 'build', units: ws.map((u) => u.id), building: 'stone_wall', tx: 14, ty: 24 });
  w.tick();
  assert.equal(walls(w).length, 0, 'nothing is raised');
  assert.equal(w.players[0].wood, 1000);
  assert.equal(w.players[0].gold, 1000);
  assert.ok(ws.every((u) => !u.order || u.order.type !== 'build'), 'and no worshipper was sent');
  buildLine(w, ws, 'wooden_wall', 14, 20, 20, 20);
  w.tick();
  assert.equal(walls(w).length, 7, 'the wooden wall is still built');
});

test('a dragged wall goes up only within WALL_PLACE_RANGE of an ordered worshipper; the rest of the line is left out and not paid for', () => {
  const w = makeWorld();
  clearUnits(w, 0);
  const a = spawn(w, 0, 'worshipper', 10, 12);
  w.players[0].wood = 1000;
  buildLine(w, [a], 'wooden_wall', 4, 12, 47, 12);
  w.tick();
  assert.deepEqual(errorsOf(w.events), [], 'part of the line is raised, so there is no refusal');
  const xs = walls(w).map((b) => b.tx).sort((p, q) => p - q);
  assert.equal(xs[0], 4);
  assert.equal(xs.at(-1), 33, 'the last segment is the one whose centre is still 23.5 tiles from the worshipper');
  assert.equal(xs.length, 30);
  assert.equal(w.players[0].wood, 1000 - 30 * BUILDINGS.wooden_wall.cost.wood, 'only the segments raised are paid for');
  // The reach is measured from the worshipper where it stands, not from the end of the line.
  assert.ok(Math.hypot(33.5 - 10, 0.5) <= WALL_PLACE_RANGE && Math.hypot(34.5 - 10, 0.5) > WALL_PLACE_RANGE);
});

test('a wall line wholly out of reach is refused: nothing is placed, paid, or ordered', () => {
  const w = makeWorld();
  clearUnits(w, 0);
  const a = spawn(w, 0, 'worshipper', 10, 12);
  w.players[0].wood = 1000;
  buildLine(w, [a], 'wooden_wall', 40, 12, 47, 12);
  w.tick();
  assert.deepEqual(errorsOf(w.events), [WALL_TOO_FAR]);
  assert.equal(walls(w).length, 0);
  assert.equal(w.players[0].wood, 1000);
  assert.ok(!a.order || a.order.type !== 'build', 'and the worshipper was not sent');
  // Even a single segment, as a click makes it.
  buildLine(w, [a], 'wooden_wall', 44, 12, 44, 12);
  w.tick();
  assert.equal(walls(w).length, 0);
});

test('any one of the ordered worshippers can bring a stretch of the line into reach', () => {
  const w = makeWorld();
  clearUnits(w, 0);
  const near = spawn(w, 0, 'worshipper', 10, 12);
  const far = spawn(w, 0, 'worshipper', 44, 12);
  w.players[0].wood = 1000;
  buildLine(w, [near, far], 'wooden_wall', 4, 12, 47, 12);
  w.tick();
  assert.deepEqual(errorsOf(w.events), []);
  assert.equal(walls(w).length, 44, 'the whole line');
  // A worshipper that was not ordered counts for nothing.
  const w2 = makeWorld();
  clearUnits(w2, 0);
  const one = spawn(w2, 0, 'worshipper', 10, 12);
  spawn(w2, 0, 'worshipper', 44, 12);
  w2.players[0].wood = 1000;
  buildLine(w2, [one], 'wooden_wall', 4, 12, 47, 12);
  w2.tick();
  assert.equal(walls(w2).length, 30);
});

test('wallLine: eight directions, the start tile first, diagonals joined edge to edge, capped', () => {
  assert.deepEqual(wallLine(5, 5, 5, 5), [[5, 5]]);
  assert.deepEqual(wallLine(5, 5, 8, 5), [[5, 5], [6, 5], [7, 5], [8, 5]]);
  assert.deepEqual(wallLine(5, 5, 5, 3), [[5, 5], [5, 4], [5, 3]]);
  assert.deepEqual(wallLine(8, 5, 5, 5), [[8, 5], [7, 5], [6, 5], [5, 5]], 'drawn backwards');
  // Mostly horizontal drags snap to the horizontal.
  assert.deepEqual(wallLine(5, 5, 8, 6), wallLine(5, 5, 8, 5));
  const diag = wallLine(5, 5, 8, 8);
  assert.deepEqual(diag[0], [5, 5]);
  assert.deepEqual(diag[diag.length - 1], [8, 8]);
  for (let i = 1; i < diag.length; i++) {
    const d = Math.abs(diag[i][0] - diag[i - 1][0]) + Math.abs(diag[i][1] - diag[i - 1][1]);
    assert.equal(d, 1, `segments ${i - 1} and ${i} share an edge (no gap a unit could slip through)`);
  }
  assert.equal(wallLine(0, 0, 500, 0).length, MAX_WALL_LINE);
  assert.equal(wallLine(0, 0, 500, 500).length, MAX_WALL_LINE);
  assert.deepEqual(wallLine(NaN, 3, 4, 4).length, 1);
});

test('wallMask: the neighbours a segment joins', () => {
  const set = new Set(['4,5', '6,5', '5,6']);
  const joins = (x, y) => set.has(`${x},${y}`);
  assert.equal(wallMask(5, 5, joins), WALL_W | WALL_E | WALL_S);
  assert.equal(wallMask(5, 5, () => false), 0);
  assert.equal(wallMask(5, 5, (x, y) => y === 4), WALL_N);
});

test('a dragged wall pays for every segment at once, places them all, and the worshippers build it', () => {
  const w = makeWorld();
  const ws = workers(w).slice(0, 3);
  w.players[0].wood = 500;
  buildLine(w, ws, 'wooden_wall', 14, 20, 29, 20);
  w.tick();
  assert.deepEqual(errorsOf(w.events), []);
  assert.equal(walls(w).length, 16);
  assert.equal(w.players[0].wood, 500 - 16 * BUILDINGS.wooden_wall.cost.wood);
  assert.equal(w.players[0].gold, 400, 'wooden walls cost no gold');
  assert.ok(walls(w).every((b) => !b.constructed), 'sites at first');
  assert.ok(!w.map.isPassable(20, 20), 'an unfinished segment already blocks the way');
  assert.ok(w.map.isPassable(20, 21));
  const t = runUntil(w, () => done(w).length === 16, 120);
  assert.ok(t > 0, 'all 16 segments get built');
  run(w, 1);
  assert.ok(ws.every((u) => !u.order && u.state === 'idle'), 'the worshippers are done and idle');
  assert.equal(w.players[0].stats.buildings, 0, 'segments are not counted as buildings built');
});

test('a dragged wall raises no completion messages and no population', () => {
  const w = makeWorld();
  const ws = workers(w).slice(0, 2);
  w.players[0].wood = 500;
  const cap = w.players[0].popCap;
  buildLine(w, ws, 'wooden_wall', 14, 20, 19, 20);
  const ev = runCollect(w, 60);
  assert.equal(done(w).length, 6);
  assert.equal(eventsOf(ev, 'buildingComplete').length, 0);
  assert.equal(eventsOf(ev, 'construction').length, 0);
  assert.equal(w.players[0].popCap, cap);
});

test('more worshippers build a dragged wall faster, each taking a stretch', () => {
  const solo = makeWorld();
  const crew = makeWorld();
  solo.players[0].wood = crew.players[0].wood = 500;
  buildLine(solo, workers(solo).slice(0, 1), 'wooden_wall', 14, 20, 25, 20);
  buildLine(crew, workers(crew).slice(0, 4), 'wooden_wall', 14, 20, 25, 20);
  const t1 = runUntil(solo, () => done(solo).length === 12, 200);
  const t2 = runUntil(crew, () => done(crew).length === 12, 200);
  assert.ok(t1 > 0 && t2 > 0);
  assert.ok(t2 < t1 * 0.45, `one worshipper ${t1}s, four ${t2}s`);
  // Each of the four was given its own stretch of the line to start on.
  const w = makeWorld();
  w.players[0].wood = 500;
  const four = workers(w).slice(0, 4);
  buildLine(w, four, 'wooden_wall', 14, 20, 25, 20);
  w.tick();
  const firstSites = four.map((u) => u.order.site);
  assert.equal(new Set(firstSites).size, 4, 'four different segments to start on');
});

test('a worshipper that finishes its stretch walks on to the unfinished segments nearby', () => {
  const w = makeWorld();
  w.players[0].wood = 500;
  const [a, b] = workers(w).slice(0, 2);
  buildLine(w, [a, b], 'wooden_wall', 14, 20, 25, 20);
  w.tick();
  assert.notEqual(a.order.site, b.order.site, 'two stretches');
  b.dead = true; // the second stretch's builder is lost: nobody is assigned to it any more
  w.cleanup();
  assert.ok(runUntil(w, () => done(w).length === 12, 300) > 0, 'the first worshipper builds the whole line');
});

test('wall placement: unaffordable lines pay nothing, held tiles are skipped, bad tiles left out', () => {
  const w = makeWorld({ map: { water: [{ x: 18, y: 20, w: 2, h: 1 }] } });
  const ws = workers(w).slice(0, 2);
  w.players[0].wood = 30;
  buildLine(w, ws, 'wooden_wall', 14, 20, 25, 20);
  w.tick();
  assert.deepEqual(errorsOf(w.events), ['Not enough wood.']);
  assert.equal(walls(w).length, 0);
  assert.equal(w.players[0].wood, 30, 'nothing was paid');

  w.players[0].wood = 500;
  w.events.length = 0;
  buildLine(w, ws, 'wooden_wall', 14, 20, 25, 20);
  w.tick();
  const placed = walls(w).map((b) => b.tx).sort((a, b) => a - b);
  assert.deepEqual(placed, [14, 15, 16, 17, 20, 21, 22, 23, 24, 25], 'the two water tiles are left out');
  assert.equal(w.players[0].wood, 500 - 10 * BUILDINGS.wooden_wall.cost.wood);

  // Dragging over what is already there pays only for the new segments.
  const before = w.players[0].wood;
  buildLine(w, ws, 'wooden_wall', 22, 20, 28, 20);
  w.tick();
  assert.equal(walls(w).length, 13);
  assert.equal(w.players[0].wood, before - 3 * BUILDINGS.wooden_wall.cost.wood);

  // Nothing left to build: say so, pay nothing.
  w.events.length = 0;
  const after = w.players[0].wood;
  buildLine(w, ws, 'wooden_wall', 22, 20, 28, 20);
  w.tick();
  assert.deepEqual(errorsOf(w.events), ['The wall is already there.']);
  assert.equal(w.players[0].wood, after);
});

test('a single click is an ordinary build order for one segment', () => {
  const w = makeWorld();
  const ws = workers(w).slice(0, 1);
  w.players[0].wood = 100;
  w.issueCommand(0, { type: 'build', units: [ws[0].id], building: 'wooden_wall', tx: 20, ty: 20 });
  w.tick();
  assert.deepEqual(errorsOf(w.events), []);
  assert.equal(walls(w).length, 0, 'a one-segment wall is an ordinary build order: the site appears when the worshipper arrives');
  run(w, 12);
  assert.equal(walls(w).length, 1);
  assert.ok(runUntil(w, () => done(w).length === 1, 30) > 0);
});

test('a wall segment cannot be placed on enemy units or other buildings', () => {
  const w = makeWorld();
  spawn(w, 1, 'warrior', 20.5, 20.5);
  assert.equal(w.placementError(0, 'wooden_wall', 20, 20), 'Something is in the way.');
  assert.equal(w.placementError(0, 'wooden_wall', 7, 7), 'Another building is in the way.');
  assert.equal(w.placementError(0, 'wooden_wall', 25, 25), null);
});

test('upgrading to stone: every segment pays and builds its own upgrade and stays a wall meanwhile', () => {
  const w = makeWorld();
  w.players[0].wood = 500;
  w.players[0].gold = 500;
  const mine = [place(w, 0, 'wooden_wall', 20, 20), place(w, 0, 'wooden_wall', 21, 20), place(w, 0, 'wooden_wall', 22, 20)];
  mine[0].hp = 100; // damaged
  const up = BUILDINGS.wooden_wall.wallUpgrade;
  w.issueCommand(0, { type: 'upgradeWall', walls: mine.map((b) => b.id) });
  w.tick();
  assert.deepEqual(errorsOf(w.events), []);
  assert.equal(w.players[0].gold, 500 - 3 * up.cost.gold);
  assert.equal(w.players[0].wood, 500 - 3 * up.cost.wood);
  assert.ok(mine.every((b) => b.queue.length === 1 && b.type === 'wooden_wall'));
  assert.ok(!w.map.isPassable(21, 20), 'still blocks');
  // A second order while upgrading does nothing (no double payment).
  w.issueCommand(0, { type: 'upgradeWall', walls: mine.map((b) => b.id) });
  w.tick();
  assert.equal(w.players[0].gold, 500 - 3 * up.cost.gold);
  const t = runUntil(w, () => mine.every((b) => b.type === 'stone_wall'), 40);
  assert.ok(t > 0 && Math.abs(t - up.time) < 1.5, `took ${t}s`);
  assert.equal(mine[1].hp, BUILDINGS.stone_wall.hp, 'a full-health segment becomes a full-health stone one');
  assert.ok(mine[0].hp < mine[0].maxHp, 'a damaged segment keeps what it lost');
  assert.equal(mine[1].armor, BUILDINGS.stone_wall.armor);
  assert.equal(mine[1].queue.length, 0);
  assert.equal(mine[1].def, BUILDINGS.stone_wall);
  // Stone walls have no further upgrade.
  w.issueCommand(0, { type: 'upgradeWall', walls: [mine[1].id] });
  w.tick();
  assert.equal(mine[1].queue.length, 0);
  assert.deepEqual(errorsOf(w.events), []);
});

test('upgrading with too little money upgrades what it can and says so; other players\' and unfinished walls are left alone', () => {
  const w = makeWorld();
  const own = [20, 21, 22, 23].map((x) => place(w, 0, 'wooden_wall', x, 20));
  const enemy = place(w, 1, 'wooden_wall', 30, 30);
  const site = place(w, 0, 'wooden_wall', 24, 20, false);
  w.players[0].gold = 50; // two upgrades' worth
  w.players[0].wood = 500;
  w.issueCommand(0, { type: 'upgradeWall', walls: [site.id, enemy.id, ...own.map((b) => b.id)] });
  w.tick();
  assert.equal(own.filter((b) => b.queue.length).length, 2);
  assert.equal(enemy.queue.length, 0);
  assert.equal(site.queue.length, 0);
  assert.equal(errorsOf(w.events).length, 1);
  assert.match(errorsOf(w.events)[0], /^Not enough gold\. Upgraded 2 wall segments\.$/);
  assert.equal(w.players[0].gold, 10);
});

test('cancelling a wall upgrade refunds it', () => {
  const w = makeWorld();
  w.players[0].gold = 100;
  w.players[0].wood = 100;
  const s = place(w, 0, 'wooden_wall', 20, 20);
  w.issueCommand(0, { type: 'upgradeWall', walls: [s.id] });
  w.tick();
  const up = BUILDINGS.wooden_wall.wallUpgrade;
  assert.equal(w.players[0].gold, 100 - up.cost.gold);
  w.issueCommand(0, { type: 'cancelTrain', building: s.id });
  w.tick();
  assert.equal(w.players[0].gold, 100);
  assert.equal(w.players[0].wood, 100);
  assert.equal(s.queue.length, 0);
  assert.equal(s.type, 'wooden_wall');
});

test('a tower raised on your own wall takes the segments\' place and gives their cost back; an enemy wall blocks it', () => {
  const w = makeWorld();
  w.players[0].gold = 1000;
  w.players[0].wood = 1000;
  for (let x = 16; x <= 25; x++) place(w, 0, 'stone_wall', x, 20);
  place(w, 1, 'wooden_wall', 30, 20);
  assert.equal(w.placementError(0, 'tower', 20, 20), null, 'on the wall');
  assert.equal(w.placementError(0, 'tower', 20, 19), null, 'overlapping only one row of it');
  assert.equal(w.placementError(0, 'tower', 29, 20), 'Another building is in the way.', 'an enemy wall is in the way');
  assert.equal(w.placementError(0, 'house', 20, 20), 'Another building is in the way.', 'only towers join a wall');
  const stone = BUILDINGS.stone_wall.cost;
  const tower = BUILDINGS.tower.cost;
  const u = workers(w)[0];
  w.issueCommand(0, { type: 'build', units: [u.id], building: 'tower', tx: 20, ty: 20 });
  w.tick();
  assert.equal(w.players[0].gold, 1000 - tower.gold, 'the tower is paid for when ordered');
  assert.equal(walls(w).length, 10, 'the wall stands until the worshipper starts the tower');
  assert.ok(runUntil(w, () => w.buildingList.some((b) => b.type === 'tower' && !b.dead), 60) > 0);
  assert.equal(walls(w).length, 10 - 2, 'the two segments under the 2x2 tower are gone');
  assert.equal(w.players[0].gold, 1000 - tower.gold + 2 * stone.gold);
  assert.equal(w.players[0].wood, 1000 - tower.wood + 2 * stone.wood);
  // No gap: every tile of the old line is still blocked (wall or tower).
  for (let x = 16; x <= 25; x++) assert.ok(!w.map.isPassable(x, 20), `tile ${x},20 still blocked`);
  assert.ok(runUntil(w, () => w.buildingList.some((b) => b.type === 'tower' && b.constructed), 120) > 0);
});

test('a tower works as a tower while it is part of the wall', () => {
  const w = makeWorld();
  for (let x = 16; x <= 25; x++) place(w, 0, 'stone_wall', x, 20);
  place(w, 0, 'tower', 20, 20); // the 2x2 tower over the wall (placed directly)
  const tower = w.buildingList.find((b) => b.type === 'tower');
  const enemy = spawn(w, 1, 'warrior', 20.5, 24);
  const t = runUntil(w, () => enemy.hp < enemy.maxHp, 20);
  assert.ok(t > 0, 'the tower shoots the enemy');
  assert.ok(tower.hp > 0);
});

test('taking a finished wall segment down returns half its cost; only the owner can, and only for walls', () => {
  const w = makeWorld();
  w.players[0].wood = 0;
  w.players[0].gold = 0;
  const s = place(w, 0, 'stone_wall', 20, 20);
  const enemy = place(w, 1, 'stone_wall', 22, 20);
  const house = place(w, 0, 'house', 30, 30);
  w.issueCommand(0, { type: 'cancelBuild', building: enemy.id });
  w.issueCommand(0, { type: 'cancelBuild', building: house.id });
  w.tick();
  assert.ok(!enemy.dead && !house.dead, 'not another player\'s wall, not a finished house');
  w.issueCommand(0, { type: 'cancelBuild', building: s.id });
  w.tick();
  assert.ok(s.dead);
  assert.equal(w.players[0].gold, Math.floor(BUILDINGS.stone_wall.cost.gold / 2));
  assert.equal(w.players[0].wood, Math.floor(BUILDINGS.stone_wall.cost.wood / 2));
  assert.ok(w.map.isPassable(20, 20), 'a gap in the wall');
});

test('taking down a segment that is being upgraded refunds the upgrade in full', () => {
  const w = makeWorld();
  w.players[0].gold = 100;
  w.players[0].wood = 100;
  const s = place(w, 0, 'wooden_wall', 20, 20);
  w.issueCommand(0, { type: 'upgradeWall', walls: [s.id] });
  w.tick();
  w.issueCommand(0, { type: 'cancelBuild', building: s.id });
  w.tick();
  const wood = BUILDINGS.wooden_wall.cost;
  assert.equal(w.players[0].gold, 100 + Math.floor(wood.gold / 2));
  assert.equal(w.players[0].wood, 100 + Math.floor(wood.wood / 2));
});

test('walls do not keep a player in the game', () => {
  const w = makeWorld();
  for (let x = 20; x < 30; x++) place(w, 0, 'stone_wall', x, 20);
  const tc = w.buildingList.find((b) => b.owner === 0 && b.type === 'town_center');
  w.killEntity(tc, null);
  w.tick();
  assert.ok(w.players[0].defeated, 'only walls left: defeated');
  assert.ok(w.gameOver && w.gameOver.winningTeam === 2);
});

test('a defeated player\'s walls come down with them, so no teammate is shut in or out for good', () => {
  const w = makeWorld({ players: 3, teams: [1, 1, 2] });
  for (let x = 20; x < 30; x++) {
    place(w, 0, 'stone_wall', x, 20);
    place(w, 1, 'wooden_wall', x, 22);
  }
  assert.ok(!w.map.isPassable(25, 22), 'the teammate\'s wall blocks the way');
  const tc = w.buildingList.find((b) => b.owner === 1 && b.type === 'town_center');
  w.killEntity(tc, null);
  w.tick();
  assert.ok(w.players[1].defeated);
  assert.equal(walls(w, 1).length, 0, 'their walls are gone');
  assert.ok(w.map.isPassable(25, 22), 'and the way is open');
  assert.equal(walls(w, 0).length, 10, 'the surviving teammate\'s walls stand');
  assert.ok(!w.gameOver, 'the game goes on');
});

test('soldiers do not pick walls as targets; towers and idle soldiers leave them alone', () => {
  const w = makeWorld();
  clearUnits(w, 0);
  clearUnits(w, 1);
  const wall = place(w, 0, 'wooden_wall', 20, 20);
  const warrior = spawn(w, 1, 'warrior', 20.5, 22);
  assert.equal(findTarget(w, warrior, 10), null, 'nothing but a wall in range');
  const house = place(w, 0, 'house', 24, 20);
  assert.equal(findTarget(w, warrior, 10), house, 'a house is');
  run(w, 10);
  assert.equal(wall.hp, wall.maxHp, 'an idle soldier does not hack at a wall');
});

test('walls are worth no experience to the soldier that breaks them', () => {
  const w = makeWorld();
  clearUnits(w, 1);
  const wall = place(w, 0, 'stone_wall', 20, 20);
  const soldier = spawn(w, 1, 'warrior', 20.5, 22);
  w.killEntity(wall, soldier);
  assert.equal(soldier.xp, 0);
});

test('an explicit attack order on a wall segment breaks it', () => {
  const w = makeWorld();
  clearUnits(w, 0);
  clearUnits(w, 1);
  const wall = place(w, 0, 'wooden_wall', 20, 20);
  const soldiers = [0, 1, 2].map((i) => spawn(w, 1, 'warrior', 20.5 + i * 0.3, 23));
  w.issueCommand(1, { type: 'attack', units: soldiers.map((u) => u.id), target: wall.id });
  assert.ok(runUntil(w, () => wall.dead, 30) > 0);
  assert.ok(w.map.isPassable(20, 20), 'the gap is open');
});

// A ring of stone around the first player's Town Center, and soldiers of the second sent in.
function ringWorld(type = 'stone_wall', opts = {}) {
  const w = makeWorld(opts);
  clearUnits(w, 0);
  clearUnits(w, 1);
  const ring = [];
  for (let x = 2; x <= 20; x++) ring.push([x, 2], [x, 20]);
  for (let y = 3; y <= 19; y++) ring.push([2, y], [20, y]);
  for (const [x, y] of ring) place(w, 0, type, x, y);
  return { w, ring };
}

test('soldiers shut out by a wall break through it and go on to the buildings behind it', () => {
  const { w, ring } = ringWorld();
  const army = [0, 1, 2, 3, 4, 5].map((i) => spawn(w, 1, 'warrior', 30 + (i % 3), 30 + Math.floor(i / 3)));
  w.issueCommand(1, { type: 'attackMove', units: army.map((u) => u.id), x: 8, y: 8 });
  const tc = w.buildingList.find((b) => b.owner === 0 && b.type === 'town_center');
  const searchesBefore = w.paths.stats.expanded;
  // (With the Town Center gone the player is defeated and the rest of the ring comes down: count before that.)
  let lost = 0;
  const t = runUntil(w, () => {
    if (!tc.dead) lost = ring.length - walls(w).length;
    return tc.dead;
  }, 400);
  assert.ok(t > 0, 'the Town Center falls');
  assert.ok(lost > 0, 'a way in was broken');
  assert.ok(lost <= 4, `the army broke in, it did not tear the ring down (${lost} segments lost)`);
  assert.ok(w.paths.stats.expanded - searchesBefore < 400000, `pathfinding stayed cheap while shut out (${w.paths.stats.expanded - searchesBefore} nodes)`);
  assert.equal(w.perf.commandErrors, 0);
});

test('while the Decade of Peace holds nobody breaks a wall; when it ends the army breaks in', () => {
  const { w, ring } = ringWorld('stone_wall', { peaceMinutes: 30 });
  const army = [0, 1, 2].map((i) => spawn(w, 1, 'warrior', 10.5 + i * 0.6, 0.8));
  w.issueCommand(1, { type: 'attackMove', units: army.map((u) => u.id), x: 8, y: 8 });
  const searches = w.paths.stats.expanded;
  run(w, 40);
  assert.equal(walls(w).length, ring.length);
  assert.ok(walls(w).every((b) => b.hp === b.maxHp), 'the peace protects the wall');
  assert.ok(w.paths.stats.expanded - searches < 400000, 'and shut-out soldiers do not search without end');
  w.peaceEnd = w.time;
  w.tick();
  assert.equal(w.peace, false);
  assert.ok(runUntil(w, () => walls(w).length < ring.length, 120) > 0, 'once the peace is over they break in');
});

test('a crowd works on one segment of the wall, not on many', () => {
  const { w } = ringWorld();
  const army = [0, 1, 2, 3, 4, 5].map((i) => spawn(w, 1, 'warrior', 10 + i * 0.4, 0.8));
  w.issueCommand(1, { type: 'attackMove', units: army.map((u) => u.id), x: 8, y: 8 });
  run(w, 8);
  const hurt = walls(w).filter((b) => b.hp < b.maxHp);
  assert.ok(hurt.length <= 2, `${hurt.length} segments are being hit`);
});

test('soldiers prefer the weakest stretch: they break in through a wooden segment of a stone wall', () => {
  const { w } = ringWorld();
  const weak = w.getEntity(w.map.occ[2 * w.map.width + 12]);
  w.changeBuildingType(weak, 'wooden_wall');
  const army = [0, 1, 2].map((i) => spawn(w, 1, 'warrior', 10.5 + i * 0.6, 0.8));
  w.issueCommand(1, { type: 'attackMove', units: army.map((u) => u.id), x: 8, y: 8 });
  assert.ok(runUntil(w, () => weak.dead, 60) > 0, 'the wooden segment falls first');
  assert.ok(walls(w).every((b) => b.hp === b.maxHp), 'the stone around it is untouched');
});

test('rams break walls too, on an attack order for a building behind them', () => {
  const { w, ring } = ringWorld();
  const tc = w.buildingList.find((b) => b.owner === 0 && b.type === 'town_center');
  const rams = [0, 1].map((i) => spawn(w, 1, 'battering_ram', 12 + i, 0.8));
  w.issueCommand(1, { type: 'attack', units: rams.map((u) => u.id), target: tc.id });
  assert.ok(runUntil(w, () => walls(w).length < ring.length, 120) > 0, 'a segment falls');
  assert.ok(runUntil(w, () => tc.dead, 200) > 0, 'then the Town Center');
});

test('archers shoot over a wall without breaking it', () => {
  const { w, ring } = ringWorld();
  const tc = w.buildingList.find((b) => b.owner === 0 && b.type === 'town_center');
  const archers = [0, 1, 2].map((i) => spawn(w, 1, 'archer', 8 + i, 0.9));
  w.issueCommand(1, { type: 'attackMove', units: archers.map((u) => u.id), x: 8, y: 8 });
  run(w, 20);
  assert.ok(tc.hp < tc.maxHp, 'the Town Center is being shot');
  assert.equal(walls(w).length, ring.length);
});

test('archers that cannot come within range of what lies behind a wall break it, slowly', () => {
  // A wide ring with a house deep inside: no spot outside the wall is within an archer's range of it.
  const w = makeWorld();
  clearUnits(w, 0);
  clearUnits(w, 1);
  const ring = [];
  for (let x = 2; x <= 30; x++) ring.push([x, 2], [x, 30]);
  for (let y = 3; y <= 29; y++) ring.push([2, y], [30, y]);
  for (const [x, y] of ring) place(w, 0, 'wooden_wall', x, y);
  const house = place(w, 0, 'house', 15, 15);
  const archers = [0, 1, 2, 3].map((i) => spawn(w, 1, 'archer', 34, 14 + i));
  w.issueCommand(1, { type: 'attack', units: archers.map((u) => u.id), target: house.id });
  assert.ok(runUntil(w, () => walls(w).length < ring.length, 150) > 0, 'a segment falls to their arrows');
  assert.equal(house.hp, house.maxHp, 'the house was out of reach until then');
  assert.ok(runUntil(w, () => house.dead, 150) > 0, 'and with the way open they get to it');
});

test('your own wall blocks your own soldiers, and taking a segment down opens the way', () => {
  const { w } = ringWorld();
  const inside = place(w, 0, 'house', 10, 10);
  const own = spawn(w, 0, 'warrior', 10, 15);
  w.issueCommand(0, { type: 'move', units: [own.id], x: 10, y: 28 });
  run(w, 20);
  assert.ok(own.y < 20, 'stopped at the wall');
  const gate = w.getEntity(w.map.occ[20 * w.map.width + 10]);
  w.issueCommand(0, { type: 'cancelBuild', building: gate.id });
  w.issueCommand(0, { type: 'move', units: [own.id], x: 10, y: 28 });
  run(w, 20);
  assert.ok(own.y > 21, 'through the gap');
  assert.ok(inside);
});

test('a worshipper that cannot reach a segment of a dragged wall builds the others and does not stall', () => {
  // A second line is dragged right behind a first, so the first's builders are boxed in for a while.
  const w = makeWorld();
  w.players[0].wood = 1000;
  const ws = workers(w).slice(0, 3);
  buildLine(w, ws, 'wooden_wall', 14, 20, 25, 20);
  w.tick();
  buildLine(w, ws, 'wooden_wall', 14, 21, 25, 21, { queue: true });
  w.tick();
  assert.equal(walls(w).length, 24);
  assert.ok(runUntil(w, () => done(w).length === 24, 300) > 0);
  assert.equal(w.perf.commandErrors, 0);
});

test('a snapshot carries a wall as an ordinary building view', () => {
  const w = makeWorld();
  const s = place(w, 0, 'wooden_wall', 20, 20);
  const snap = w.getSnapshot();
  const v = snap.entities.find((e) => e.id === s.id);
  assert.equal(v.k, 'b');
  assert.equal(v.t, 'wooden_wall');
  assert.deepEqual(v.q, []);
});
