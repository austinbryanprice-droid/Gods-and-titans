// Combining four Houses into a Manor (DESIGN 5.3): the square finder, the upgrade in place (paid at once,
// run without a worker, the Houses sheltering all the while), cancelling it, a House lost half way, and
// the bonuses a Manor holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, BUILD_MENU } from '../../src/data/index.js';
import { UPGRADES, buildingMods, upgradesFor } from '../../src/data/upgrades.js';
import { MANOR, MERGE_TEXT, mergeRule, houseBlocks, planMerges, researchHostOf } from '../../src/data/houses.js';
import { POP_MAX, TICK_RATE } from '../../src/config.js';
import { makeWorld, place, run, runUntil, runCollect, errorsOf } from './helpers.js';

const TC_POP = BUILDINGS.town_center.popProvided;
const HOUSE = BUILDINGS.house;
const rule = mergeRule();

const rich = (w) => Object.assign(w.players[0], { gold: 5000, wood: 5000, faith: 5000 });
const manors = (w, p = 0) => w.buildingList.filter((b) => !b.dead && b.owner === p && b.type === MANOR);
const houses = (w, p = 0) => w.buildingList.filter((b) => !b.dead && b.owner === p && b.type === 'house');
const merge = (w, hs, p = 0) => w.issueCommand(p, { type: 'upgradeHouses', houses: hs.map((h) => h.id) });

/** The settlement is a Town (the player's tier follows the Town Center's). */
function town(w) {
  const tc = w.buildingList.find((b) => b.owner === 0 && b.type === 'town_center');
  tc.tier = 2;
  w.recomputeTier(0, true);
}

/** Four finished Houses in a square with the top left House at tile (tx, ty): [top-left, top-right, bottom-left, bottom-right]. */
function square(w, tx, ty, owner = 0) {
  const s = HOUSE.size;
  return [[0, 0], [s, 0], [0, s], [s, s]].map(([dx, dy]) => place(w, owner, 'house', tx + dx, ty + dy));
}

/** Finish a research at once (the queue still runs it through updateProduction). */
function research(w, b, upId) {
  w.issueCommand(b.owner, { type: 'research', building: b.id, upgrade: upId });
  w.tick();
  const item = b.queue.find((q) => q.u === upId);
  assert.ok(item, `${upId} queued`);
  return runUntil(w, () => w.players[b.owner].upgrades[upId], item.time + 2);
}

const sq = (id, tx, ty, busy = false) => ({ id, tx, ty, busy });

test('a Manor shelters more than the four Houses it replaces, holds more, and costs what they and the merge cost', () => {
  const m = BUILDINGS[MANOR];
  assert.equal(rule.building, 'house');
  assert.equal(rule.count, 4);
  assert.equal(m.size, 2 * HOUSE.size, 'a 2x2 block of Houses, so the Manor stands on the four footprints');
  assert.equal(m.popProvided - 4 * HOUSE.popProvided, 16, 'the gain: 48 against 32');
  assert.ok(m.hp > 4 * HOUSE.hp && m.armor > HOUSE.armor);
  for (const res of ['gold', 'wood', 'faith']) assert.equal(m.cost[res], 4 * HOUSE.cost[res] + rule.cost[res], `${res}: four Houses plus the merge`);
  assert.ok(m.tier >= 2, 'a Town');
  assert.ok(!BUILD_MENU.includes(MANOR), 'a Manor comes only from combining Houses');
  assert.deepEqual(m.upgrades, [], 'and takes the House upgrades instead of its own');
  assert.equal(researchHostOf(MANOR), 'house');
  assert.equal(researchHostOf('house'), 'house');
  assert.equal(researchHostOf('barracks'), 'barracks');
  assert.equal(researchHostOf('constructor'), 'constructor', 'unknown names pass through');
  assert.deepEqual(upgradesFor(MANOR).map((u) => u.id), upgradesFor('house').map((u) => u.id));
});

test('houseBlocks: a block is four Houses touching edge to edge in a square, and no House is in two blocks', () => {
  // Whatever order they are given in: top left, top right, bottom left, bottom right.
  assert.deepEqual(houseBlocks([sq(4, 22, 22), sq(2, 22, 20), sq(1, 20, 20), sq(3, 20, 22)]), [{ tx: 20, ty: 20, ids: [1, 2, 3, 4] }]);
  assert.deepEqual(houseBlocks([]), []);
  assert.deepEqual(houseBlocks([sq(1, 20, 20), sq(2, 22, 20), sq(3, 20, 22)]), [], 'three are not a square');
  assert.deepEqual(houseBlocks([0, 1, 2, 3].map((i) => sq(i, 20 + 2 * i, 20))), [], 'four in a row are not a square');
  assert.deepEqual(houseBlocks([sq(1, 20, 20), sq(2, 23, 20), sq(3, 20, 22), sq(4, 23, 22)]), [], 'a gap of a tile between them');
  assert.deepEqual(houseBlocks([sq(1, 20, 20), sq(2, 22, 20), sq(3, 21, 22), sq(4, 23, 22)]), [], 'a brick pattern, one tile out of line');
  // Six in a 3x2 grid: one block, the left one; the two on the right are left over.
  const grid = (cols, rows) => {
    const out = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(sq(r * cols + c + 1, 20 + 2 * c, 20 + 2 * r));
    return out;
  };
  assert.deepEqual(houseBlocks(grid(3, 2)), [{ tx: 20, ty: 20, ids: [1, 2, 4, 5] }]);
  // Eight in a 4x2 grid: two blocks, left to right.
  assert.deepEqual(houseBlocks(grid(4, 2)), [{ tx: 20, ty: 20, ids: [1, 2, 5, 6] }, { tx: 24, ty: 20, ids: [3, 4, 7, 8] }]);
  // Nine in a 3x3 grid: the four blocks overlap, only the first (top left) is taken.
  assert.deepEqual(houseBlocks(grid(3, 3)), [{ tx: 20, ty: 20, ids: [1, 2, 4, 5] }]);
  // Rows come first: the block higher up is picked before one further left but lower down.
  const stairs = [sq(1, 24, 20), sq(2, 26, 20), sq(3, 24, 22), sq(4, 26, 22), sq(5, 20, 24), sq(6, 22, 24), sq(7, 20, 26), sq(8, 22, 26)];
  assert.deepEqual(houseBlocks(stairs).map((b) => [b.tx, b.ty]), [[24, 20], [20, 24]]);
  assert.deepEqual(houseBlocks([sq(1, 20, 20), sq(2, 22, 20), sq(3, 20, 22), sq(4, 22, 22)]), houseBlocks([sq(1, 20, 20), sq(2, 22, 20), sq(3, 20, 22), sq(4, 22, 22), sq(5, 40, 40)]), 'other Houses may stand anywhere');
});

test('planMerges: the squares that can start now, or why none can', () => {
  const four = [sq(1, 20, 20), sq(2, 22, 20), sq(3, 20, 22), sq(4, 22, 22)];
  assert.deepEqual(planMerges(four), { blocks: [{ tx: 20, ty: 20, ids: [1, 2, 3, 4] }], reason: null });
  assert.equal(planMerges([]).reason, 'few');
  assert.equal(planMerges(four.slice(0, 3)).reason, 'few');
  assert.equal(planMerges([sq(1, 20, 20), sq(2, 22, 20), sq(3, 24, 20), sq(4, 26, 20)]).reason, 'shape');
  assert.equal(planMerges([sq(1, 20, 20), sq(2, 22, 20), sq(3, 20, 22), sq(4, 22, 22, true)]).reason, 'busy');
  // A busy House spoils only its own square.
  const two = [...four, sq(5, 30, 20), sq(6, 32, 20), sq(7, 30, 22), sq(8, 32, 22, true)];
  assert.deepEqual(planMerges(two), { blocks: [{ tx: 20, ty: 20, ids: [1, 2, 3, 4] }], reason: null });
  for (const key of ['few', 'shape', 'busy']) assert.equal(typeof MERGE_TEXT[key], 'string');
});

test('combining four Houses: paid at once, the Houses shelter on while it runs, then one Manor stands where they were', () => {
  const w = makeWorld();
  rich(w);
  town(w);
  const hs = square(w, 20, 20);
  const cap = w.players[0].popCap;
  assert.equal(cap, TC_POP + 4 * HOUSE.popProvided);
  const { gold, wood, faith } = w.players[0];
  merge(w, hs);
  w.tick();
  assert.equal(w.players[0].gold, gold - rule.cost.gold);
  assert.equal(w.players[0].wood, wood - rule.cost.wood);
  assert.equal(w.players[0].faith, faith);
  for (const h of hs) {
    assert.equal(h.queue.length, 1, 'every House shows the upgrade');
    assert.equal(h.queue[0].u, MANOR);
    assert.equal(h.queue[0].upgrade, true);
  }
  assert.equal(hs[0].queue[0].group, hs[3].queue[0].group, 'one upgrade, shared');
  const snap = w.getSnapshot();
  for (const h of hs) assert.deepEqual(snap.entities.find((e) => e.id === h.id).q.map((q) => q.u), [MANOR]);
  assert.equal(w.players[0].popCap, cap, 'the Houses go on sheltering while they are combined');
  assert.equal(manors(w).length, 0);
  // Half way: all four show the same progress, nothing has changed yet.
  run(w, rule.time / 2);
  const p = (h) => w.getSnapshot().entities.find((e) => e.id === h.id).q[0].p;
  assert.ok(p(hs[0]) > 0.4 && p(hs[0]) < 0.6);
  assert.deepEqual(hs.map(p), [p(hs[0]), p(hs[0]), p(hs[0]), p(hs[0])]);
  assert.equal(houses(w).length, 4);
  const events = [];
  const secs = runUntil(w, () => {
    events.push(...w.events);
    return manors(w).length === 1;
  }, rule.time);
  assert.ok(secs > 0, 'the Manor stands within the time');
  assert.ok(Math.abs(secs + rule.time / 2 - rule.time) <= 1.5, 'after the upgrade time (45 s)');
  assert.equal(houses(w).length, 0, 'the four Houses are gone');
  const m = manors(w)[0];
  assert.deepEqual([m.tx, m.ty, m.size], [20, 20, 4]);
  assert.equal(m.constructed, true);
  assert.equal(m.hp, m.maxHp);
  assert.equal(m.maxHp, BUILDINGS[MANOR].hp);
  assert.equal(m.queue.length, 0);
  for (let y = 20; y < 24; y++) for (let x = 20; x < 24; x++) assert.equal(w.map.occ[y * w.map.width + x], m.id, `tile ${x},${y} is the Manor's`);
  assert.equal(w.players[0].popCap, TC_POP + BUILDINGS[MANOR].popProvided);
  assert.equal(w.players[0].popCap - cap, 16, 'sixteen more than the four Houses sheltered');
  assert.ok(events.some((e) => e.type === 'buildingComplete' && e.t === MANOR && e.id === m.id && e.o === 0), 'the player is told');
  assert.equal(w.players[0].tier, 2, 'losing Houses does not touch the settlement tier');
});

test('combining needs a Town, four Houses in a square and none of them busy: each refusal says why and costs nothing', () => {
  const w = makeWorld();
  rich(w);
  const hs = square(w, 20, 20);
  const { gold, wood } = w.players[0];
  merge(w, hs);
  assert.deepEqual(errorsOf(runCollect(w, 0.1)), ['Requires Town.']);
  town(w);
  merge(w, hs.slice(0, 3));
  assert.deepEqual(errorsOf(runCollect(w, 0.1)), [MERGE_TEXT.few]);
  merge(w, []);
  assert.deepEqual(errorsOf(runCollect(w, 0.1)), [MERGE_TEXT.few]);
  const line = [0, 1, 2, 3].map((i) => place(w, 0, 'house', 30 + 2 * i, 30));
  merge(w, line);
  assert.deepEqual(errorsOf(runCollect(w, 0.1)), [MERGE_TEXT.shape]);
  // Houses of another player, a Town Center and a Barracks do not count; they are not Houses of ours.
  const foe = square(w, 30, 34, 1);
  merge(w, foe);
  assert.deepEqual(errorsOf(runCollect(w, 0.1)), [MERGE_TEXT.few], 'only the player\'s own Houses are looked at');
  assert.equal(foe.every((h) => h.queue.length === 0), true);
  // A square with one House researching.
  w.issueCommand(0, { type: 'research', building: hs[1].id, upgrade: 'house_stone_walls' });
  w.tick();
  const researchCost = UPGRADES.house_stone_walls.cost;
  merge(w, hs);
  assert.deepEqual(errorsOf(runCollect(w, 0.1)), [MERGE_TEXT.busy]);
  assert.equal(hs[0].queue.length, 0);
  assert.equal(w.players[0].gold, gold - researchCost.gold, 'nothing was paid for the refused merge');
  assert.equal(w.players[0].wood, wood - researchCost.wood);
  // A House already being combined is busy too.
  const w2 = makeWorld();
  rich(w2);
  town(w2);
  const again = square(w2, 20, 20);
  merge(w2, again);
  w2.tick();
  const wood2 = w2.players[0].wood;
  merge(w2, again);
  assert.deepEqual(errorsOf(runCollect(w2, 0.1)), [MERGE_TEXT.busy]);
  assert.equal(w2.players[0].wood, wood2);
  // Houses still being built are not Houses to combine.
  const w3 = makeWorld();
  rich(w3);
  town(w3);
  const site = [[20, 20], [22, 20], [20, 22]].map(([x, y]) => place(w3, 0, 'house', x, y));
  site.push(place(w3, 0, 'house', 22, 22, false));
  merge(w3, site);
  assert.deepEqual(errorsOf(runCollect(w3, 0.1)), [MERGE_TEXT.few], 'a House under construction is left out');
});

test('combining a bigger selection starts every square it holds, in row order, for as many as the purse allows', () => {
  const w = makeWorld({ map: { width: 64, height: 64, starts: [{ x: 6, y: 6 }, { x: 50, y: 50 }] } });
  town(w);
  const left = square(w, 20, 20);
  const right = square(w, 26, 20);
  const stray = place(w, 0, 'house', 40, 40);
  Object.assign(w.players[0], { gold: rule.cost.gold + 5, wood: 5000, faith: 0 });
  merge(w, [...right, ...left, stray]);
  assert.deepEqual(errorsOf(runCollect(w, 0.1)), ['Not enough gold. Combined 1 of 2 squares.']);
  assert.equal(left.every((h) => h.queue.length === 1), true, 'the square further left goes first');
  assert.equal(right.every((h) => h.queue.length === 0), true);
  assert.equal(stray.queue.length, 0);
  assert.equal(w.players[0].gold, 5 + 0, 'the one square was paid for');
  w.players[0].gold = 2 * rule.cost.gold;
  merge(w, [...right, ...left, stray]);
  w.tick();
  assert.equal(right.every((h) => h.queue.length === 1), true, 'the squares still free start once the purse allows');
  assert.equal(left.every((h) => h.queue.length === 1), true, 'and the one under way is left alone, not paid for twice');
  assert.equal(w.players[0].gold, rule.cost.gold);
  assert.equal(runUntil(w, () => manors(w).length === 2, rule.time + 5) > 0, true);
  assert.equal(houses(w).length, 1, 'the stray House stands');
  const w2 = makeWorld({ map: { width: 64, height: 64, starts: [{ x: 6, y: 6 }, { x: 50, y: 50 }] } });
  town(w2);
  const both = [...square(w2, 20, 20), ...square(w2, 26, 20)];
  Object.assign(w2.players[0], { gold: 5000, wood: 5000, faith: 0 });
  merge(w2, both);
  w2.tick();
  assert.equal(w2.players[0].gold, 5000 - 2 * rule.cost.gold);
  assert.equal(w2.players[0].wood, 5000 - 2 * rule.cost.wood);
});

test('cancelling on any one of the four Houses stops all of it and gives the whole price back', () => {
  const w = makeWorld();
  rich(w);
  town(w);
  const hs = square(w, 20, 20);
  const { gold, wood } = w.players[0];
  merge(w, hs);
  run(w, 5);
  w.issueCommand(0, { type: 'cancelTrain', building: hs[3].id, index: 0 });
  w.tick();
  assert.equal(w.players[0].gold, gold);
  assert.equal(w.players[0].wood, wood);
  assert.equal(hs.every((h) => h.queue.length === 0), true);
  assert.equal(houses(w).length, 4);
  assert.equal(manors(w).length, 0);
  run(w, rule.time + 2);
  assert.equal(manors(w).length, 0, 'nothing is left running');
  // And the Houses can be combined again.
  merge(w, hs);
  w.tick();
  assert.equal(w.players[0].gold, gold - rule.cost.gold);
  // A second cancel on the same group (the other Houses' queues are empty now) does nothing more.
  w.issueCommand(0, { type: 'cancelTrain', building: hs[0].id, index: 0 });
  w.issueCommand(0, { type: 'cancelTrain', building: hs[0].id, index: 0 });
  w.tick();
  assert.equal(w.players[0].gold, gold, 'refunded once, not twice');
});

test('a House that falls while its square is being combined stops the upgrade: the price comes back and the others stand', () => {
  const w = makeWorld();
  rich(w);
  town(w);
  const hs = square(w, 20, 20);
  const { gold, wood } = w.players[0];
  merge(w, hs);
  run(w, 10);
  assert.equal(w.players[0].popCap, TC_POP + 32);
  w.killEntity(hs[2]);
  w.cleanup();
  assert.equal(w.players[0].gold, gold, 'the whole price came back');
  assert.equal(w.players[0].wood, wood);
  assert.deepEqual([hs[0], hs[1], hs[3]].map((h) => h.queue.length), [0, 0, 0], 'the other Houses carry on as before');
  assert.equal(w.players[0].popCap, TC_POP + 24);
  run(w, rule.time + 2);
  assert.equal(manors(w).length, 0);
  assert.equal(houses(w).length, 3);
  // The leader falling is the same.
  const w2 = makeWorld();
  rich(w2);
  town(w2);
  const hs2 = square(w2, 20, 20);
  const gold2 = w2.players[0].gold;
  merge(w2, hs2);
  run(w2, 3);
  w2.killEntity(hs2[0]);
  w2.cleanup();
  assert.equal(w2.players[0].gold, gold2);
  assert.equal(hs2.slice(1).every((h) => h.queue.length === 0), true);
});

test('the Manor keeps the damage its Houses had, on average: combining does not heal', () => {
  const w = makeWorld();
  rich(w);
  town(w);
  const hs = square(w, 20, 20);
  hs[0].hp = HOUSE.hp / 4;
  hs[1].hp = HOUSE.hp / 4;
  merge(w, hs);
  assert.ok(runUntil(w, () => manors(w).length === 1, rule.time + 5) > 0);
  const m = manors(w)[0];
  assert.equal(m.hp, Math.round(BUILDINGS[MANOR].hp * 0.625), 'five eighths: two Houses at a quarter, two whole');
  // Hurt and finished off at the same time never leaves a Manor with no health.
  const w2 = makeWorld();
  rich(w2);
  town(w2);
  const dying = square(w2, 20, 20);
  for (const h of dying) h.hp = 1;
  merge(w2, dying);
  assert.ok(runUntil(w2, () => manors(w2).length === 1, rule.time + 5) > 0);
  assert.ok(manors(w2)[0].hp >= 1);
});

test('Imperial Bureaucracy (techSpeed) quickens the upgrade like any other growth', () => {
  const secs = (pantheons) => {
    const w = makeWorld({ pantheons });
    rich(w);
    town(w);
    const hs = square(w, 20, 20);
    merge(w, hs);
    return runUntil(w, () => manors(w).length === 1, rule.time + 5);
  };
  const plain = secs(['norse', 'hindu']);
  const fast = secs(['chinese', 'hindu']);
  assert.ok(plain > 0 && fast > 0);
  assert.ok(Math.abs(plain - rule.time) <= 1);
  assert.ok(Math.abs(fast - rule.time / 1.3) <= 1, `${fast} s against ${rule.time / 1.3}`);
});

test('a Manor holds what the Houses held: House bonuses count again for it, whether researched before or after', () => {
  const w = makeWorld();
  rich(w);
  town(w);
  const hs = square(w, 20, 20);
  const extra = place(w, 0, 'house', 30, 20);
  research(w, extra, 'house_large_families');
  research(w, extra, 'house_stone_walls');
  // Four Houses of 10 shelter 40; a Manor holds the same four bonuses: 48 + 4 x 2.
  const m = buildingMods(w.players[0].mods, MANOR);
  assert.deepEqual([m.pop, m.hp, m.armor], [8, 1200, 3]);
  merge(w, hs);
  assert.ok(runUntil(w, () => manors(w).length === 1, rule.time + 5) > 0);
  const manor = manors(w)[0];
  assert.equal(manor.maxHp, BUILDINGS[MANOR].hp + 1200);
  assert.equal(manor.hp, manor.maxHp, 'stone Houses were whole, so is the stone Manor');
  assert.equal(manor.armor, BUILDINGS[MANOR].armor + 3);
  assert.equal(w.players[0].popCap, TC_POP + 10 + BUILDINGS[MANOR].popProvided + 8, 'the lone House shelters 10, the Manor 56');
  assert.equal(w.players[0].popCap, TC_POP + 10 + 56);
  // Researched after: a Manor takes the House upgrades itself.
  const w2 = makeWorld();
  rich(w2);
  town(w2);
  const m2 = place(w2, 0, MANOR, 20, 20);
  assert.equal(w2.players[0].popCap, TC_POP + 48);
  assert.ok(research(w2, m2, 'house_large_families') > 0, 'researched at the Manor');
  assert.equal(w2.players[0].popCap, TC_POP + 56);
  assert.equal(research(w2, m2, 'house_stone_walls') > 0, true);
  assert.equal(m2.maxHp, BUILDINGS[MANOR].hp + 1200);
  assert.equal(m2.armor, BUILDINGS[MANOR].armor + 3);
  const lone = place(w2, 0, 'house', 30, 20);
  assert.equal(lone.maxHp, HOUSE.hp + 300, 'a House gets one share');
  assert.equal(w2.players[0].popCap, TC_POP + 56 + 10);
  // A bonus to every building ('*') counts once, not four times.
  assert.equal(buildingMods(w2.players[0].mods, MANOR).armor, 3, 'armor is not multiplied');
});

test('Mesopotamian Crowded Cities: every Manor shelters 8 more, the share of the four Houses it replaces', () => {
  const w = makeWorld({ pantheons: ['mesopotamian', 'norse'] });
  const mods = buildingMods(w.players[0].mods, MANOR);
  assert.equal(buildingMods(w.players[0].mods, 'house').pop, 2);
  assert.equal(mods.pop, 8);
  place(w, 0, MANOR, 20, 20);
  assert.equal(w.players[0].popCap, TC_POP + BUILDINGS[MANOR].popProvided + 8);
});

test('research is refused at a House being combined, and the Manor takes the House upgrades', () => {
  const w = makeWorld();
  rich(w);
  town(w);
  const hs = square(w, 20, 20);
  merge(w, hs);
  w.tick();
  const wood = w.players[0].wood;
  w.issueCommand(0, { type: 'research', building: hs[1].id, upgrade: 'house_stone_walls' });
  assert.deepEqual(errorsOf(runCollect(w, 0.1)), ['That House is being combined into a Manor.']);
  assert.equal(w.players[0].wood, wood);
  assert.equal(hs[1].queue.length, 1, 'only the upgrade itself');
  // A Barracks does not take a House upgrade, a Manor does.
  const barracks = place(w, 0, 'barracks', 30, 30);
  const m = place(w, 0, MANOR, 40, 20);
  w.issueCommand(0, { type: 'research', building: barracks.id, upgrade: 'house_stone_walls' });
  w.issueCommand(0, { type: 'research', building: m.id, upgrade: 'house_large_families' });
  w.tick();
  assert.equal(barracks.queue.length, 0);
  assert.equal(m.queue.length, 1);
  assert.equal(m.queue[0].u, 'house_large_families');
  // A Manor cannot be combined again: it is not a House.
  merge(w, [m]);
  assert.deepEqual(errorsOf(runCollect(w, 0.1)), [MERGE_TEXT.few]);
});

test('Manors are how a player reaches the population limit with fewer buildings', () => {
  // Sixteen Houses (four squares) are four Manors, and the cap is 12 + 192 = 204, past the limit of 200:
  // reaching it took 24 Houses before.
  assert.ok(TC_POP + 4 * BUILDINGS[MANOR].popProvided >= POP_MAX);
  assert.ok(TC_POP + 16 * HOUSE.popProvided < POP_MAX, 'sixteen Houses fall well short');
  assert.ok(TC_POP + 23 * HOUSE.popProvided < POP_MAX && TC_POP + 24 * HOUSE.popProvided >= POP_MAX, 'so 24 Houses were needed');
  const w = makeWorld({ map: { width: 64, height: 64, starts: [{ x: 6, y: 6 }, { x: 50, y: 50 }] } });
  town(w);
  Object.assign(w.players[0], { gold: 50000, wood: 50000 });
  const all = [];
  for (let c = 0; c < 4; c++) all.push(...square(w, 16 + 6 * c, 20));
  assert.equal(w.players[0].popCap, TC_POP + 16 * HOUSE.popProvided);
  merge(w, all);
  w.tick();
  assert.ok(all.every((h) => h.queue.length === 1), 'all four squares at once');
  assert.ok(runUntil(w, () => manors(w).length === 4, rule.time + 5) > 0);
  assert.equal(w.players[0].popCap, POP_MAX, 'four Manors and the Town Center fill the limit');
  assert.equal(houses(w).length, 0);
});

test('the combine command ignores another player\'s Houses, garbage and repeated ids', () => {
  const w = makeWorld();
  rich(w);
  town(w);
  const hs = square(w, 20, 20);
  const foe = square(w, 30, 30, 1);
  w.issueCommand(1, { type: 'upgradeHouses', houses: hs.map((h) => h.id) });
  w.issueCommand(0, { type: 'upgradeHouses', houses: foe.map((h) => h.id) });
  w.issueCommand(0, { type: 'upgradeHouses', houses: 'nope' });
  w.issueCommand(0, { type: 'upgradeHouses' });
  w.issueCommand(0, { type: 'upgradeHouses', houses: [hs[0].id, hs[0].id, hs[0].id, hs[0].id] });
  w.tick();
  assert.equal(hs.every((h) => h.queue.length === 0), true, 'nobody else can start it, and one House four times is one House');
  assert.equal(foe.every((h) => h.queue.length === 0), true);
  merge(w, [...hs, ...hs]);
  w.tick();
  assert.equal(hs.every((h) => h.queue.length === 1), true, 'a repeated House is read once');
  assert.equal(w.players[0].gold, 5000 - rule.cost.gold);
});

test('a Manor cannot be raised from scratch: a build order for one is ignored and costs nothing', () => {
  const w = makeWorld();
  rich(w);
  town(w);
  const worker = w.unitsOf(0).find((u) => u.type === 'worshipper');
  const before = { ...w.players[0] };
  w.issueCommand(0, { type: 'build', units: [worker.id], building: MANOR, tx: 24, ty: 24 });
  run(w, 3);
  assert.equal(w.players[0].gold, before.gold, 'nothing was paid');
  assert.equal(w.players[0].wood, before.wood);
  assert.equal(w.buildingList.filter((b) => b.type === MANOR).length, 0, 'and nothing was raised');
  assert.equal(w.getSnapshot().entities.find((e) => e.id === worker.id).bo, undefined, 'the worker was not sent off to build it');
});

test('combining is deterministic: the same setup and commands give identical snapshots', () => {
  const play = () => {
    const w = makeWorld({ map: { width: 64, height: 64, starts: [{ x: 6, y: 6 }, { x: 50, y: 50 }] } });
    rich(w);
    town(w);
    const hs = [...square(w, 20, 20), ...square(w, 26, 20)];
    hs[1].hp = 123;
    merge(w, hs);
    run(w, 10);
    w.issueCommand(0, { type: 'cancelTrain', building: hs[5].id, index: 0 });
    run(w, rule.time);
    return JSON.stringify(w.getSnapshot());
  };
  assert.equal(play(), play());
});

test('the upgrade takes its time in ticks, no more and no less', () => {
  const w = makeWorld();
  rich(w);
  town(w);
  const hs = square(w, 20, 20);
  merge(w, hs);
  w.tick();
  const start = w.tickCount;
  assert.ok(runUntil(w, () => manors(w).length === 1, rule.time + 5) > 0);
  const ticks = w.tickCount - start;
  assert.ok(Math.abs(ticks - rule.time * TICK_RATE) <= 2, `${ticks} ticks`);
});
