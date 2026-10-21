import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, MORTALS, godsFor } from '../../src/data/index.js';
import { UPGRADES } from '../../src/data/upgrades.js';
import { REPAIR_COST, CARRY_AMOUNT } from '../../src/config.js';
import { makeWorld, run, runCollect, runUntil, place, spawn, errorsOf, eventsOf, clearUnits, PLAIN_PANTHEONS } from './helpers.js';

const workers = (w, p = 0) => w.unitsOf(p).filter((u) => u.type === 'worshipper');
const rich = (w, p = 0) => Object.assign(w.players[p], { gold: 5000, wood: 5000, faith: 5000 });

/** Finish a research at once (the queue still runs it through updateProduction). */
function research(w, b, upId) {
  w.issueCommand(b.owner, { type: 'research', building: b.id, upgrade: upId });
  w.tick();
  const item = b.queue.find((q) => q.u === upId);
  assert.ok(item, `${upId} queued`);
  return runUntil(w, () => w.players[b.owner].upgrades[upId], item.time + 2);
}

test('worshippers repair a damaged building, paying a share of its cost as it mends', () => {
  const w = makeWorld();
  const house = place(w, 0, 'house', 14, 14);
  house.hp = 100;
  const [u] = workers(w);
  const gold0 = w.players[0].gold;
  const wood0 = w.players[0].wood;
  w.issueCommand(0, { type: 'repair', units: [u.id], target: house.id });
  runUntil(w, () => u.state === 'build', 10);
  const snap = w.getSnapshot();
  const view = snap.entities.find((e) => e.id === u.id);
  assert.equal(view.tk, 'repair');
  assert.equal(view.tg, house.id);
  assert.ok(runUntil(w, () => house.hp >= house.maxHp, 60) > 0, 'reaches full health');
  run(w, 0.5);
  assert.equal(u.order, null, 'the order ends when the building is whole');
  const missing = (BUILDINGS.house.hp - 100) / BUILDINGS.house.hp;
  assert.ok(Math.abs(gold0 - w.players[0].gold - BUILDINGS.house.cost.gold * REPAIR_COST * missing) < 0.01);
  assert.ok(Math.abs(wood0 - w.players[0].wood - BUILDINGS.house.cost.wood * REPAIR_COST * missing) < 0.01);
});

test('every building type can be repaired', () => {
  const spots = { town_center: [20, 20], titan_gate: [20, 30] };
  for (const type of Object.keys(BUILDINGS)) {
    const w = makeWorld();
    rich(w);
    const [tx, ty] = spots[type] || [16, 16];
    const b = place(w, 0, type, tx, ty);
    b.hp = Math.round(b.maxHp / 2);
    const hp0 = b.hp;
    w.issueCommand(0, { type: 'repair', units: workers(w).map((u) => u.id), target: b.id });
    run(w, 15);
    assert.ok(b.hp > hp0, `${type} gained health`);
  }
});

test('more repairers mend faster', () => {
  const rate = (n) => {
    const w = makeWorld();
    rich(w);
    const b = place(w, 0, 'barracks', 14, 14);
    b.hp = 100;
    w.issueCommand(0, { type: 'repair', units: workers(w).slice(0, n).map((u) => u.id), target: b.id });
    runUntil(w, () => b.repairers > 0 || workers(w).slice(0, n).every((u) => u.state === 'build'), 10);
    run(w, 6);
    const start = b.hp;
    run(w, 4);
    return b.hp - start;
  };
  assert.ok(rate(3) > rate(1) * 1.5);
});

test('repair stops with an error when the owner cannot pay', () => {
  const w = makeWorld();
  const house = place(w, 0, 'house', 14, 14);
  house.hp = 100;
  const [u] = workers(w);
  w.players[0].gold = 0;
  w.issueCommand(0, { type: 'repair', units: [u.id], target: house.id });
  const ev = runCollect(w, 10);
  assert.ok(errorsOf(ev).includes('Not enough gold to repair.'));
  assert.equal(house.hp, 100);
  assert.equal(u.order, null, 'the worshipper gives up');
});

test('repair refuses whole buildings; on a construction site it helps build', () => {
  const w = makeWorld();
  const house = place(w, 0, 'house', 14, 14);
  const [u, v] = workers(w);
  w.issueCommand(0, { type: 'repair', units: [u.id], target: house.id });
  const ev = runCollect(w, 0.2);
  assert.ok(errorsOf(ev).includes('That building is not damaged.'));
  const site = place(w, 0, 'barracks', 20, 14, false);
  w.issueCommand(0, { type: 'repair', units: [v.id], target: site.id });
  w.tick();
  assert.equal(v.order.type, 'build');
  assert.equal(v.order.site, site.id);
});

test('right-clicking a damaged building with worshippers repairs it; a whole Shrine still means pray', () => {
  const w = makeWorld();
  rich(w);
  const shrine = place(w, 0, 'shrine', 14, 14);
  const [u, v] = workers(w);
  w.issueCommand(0, { type: 'smart', units: [u.id], target: shrine.id });
  w.tick();
  assert.equal(u.order.type, 'pray');
  shrine.hp = 200;
  w.issueCommand(0, { type: 'smart', units: [v.id], target: shrine.id });
  w.tick();
  assert.equal(v.order.type, 'repair');
});

test('Auto-Repair sends idle worshippers to nearby damaged buildings, only when switched on', () => {
  const w = makeWorld();
  rich(w);
  const house = place(w, 0, 'house', 14, 14);
  for (const u of workers(w)) w.setOrder(u, null);
  house.hp = 200;
  run(w, 3);
  assert.ok(workers(w).every((u) => !u.order), 'off by default');
  w.issueCommand(0, { type: 'autoRepair', on: true });
  run(w, 2);
  assert.equal(w.players[0].autoRepair, true);
  assert.ok(workers(w).some((u) => u.order && u.order.type === 'repair'));
  assert.ok(runUntil(w, () => house.hp >= house.maxHp, 60) > 0);
  w.issueCommand(0, { type: 'autoRepair' });
  w.tick();
  assert.equal(w.players[0].autoRepair, false);
  assert.equal(w.getSnapshot().players[0].ar, false);
});

test('worshipper tasks in the snapshot: idle, gold, wood, pray, build', () => {
  const w = makeWorld({ map: { forest: [{ x: 4, y: 16, w: 6, h: 3 }] } });
  rich(w);
  const shrine = place(w, 0, 'shrine', 18, 10);
  const [a, b, c, d, e] = workers(w);
  w.issueCommand(0, { type: 'gather', units: [a.id], target: w.mineList[0].id });
  w.issueCommand(0, { type: 'gather', units: [b.id], tx: 6, ty: 16 });
  w.issueCommand(0, { type: 'pray', units: [c.id], target: shrine.id });
  w.issueCommand(0, { type: 'build', units: [d.id], building: 'house', tx: 22, ty: 20 });
  w.issueCommand(0, { type: 'stop', units: [e.id] });
  run(w, 1);
  const tk = (u) => w.getSnapshot().entities.find((x) => x.id === u.id).tk;
  assert.deepEqual([a, b, c, d, e].map(tk), ['gold', 'wood', 'pray', 'build', 'idle']);
});

test('research: paid up front, queued at a building of its type, then applied to everything the player owns', () => {
  const w = makeWorld();
  rich(w);
  const house = place(w, 0, 'house', 14, 14);
  const barracks = place(w, 0, 'barracks', 20, 14);
  house.hp = 400;
  const gold = w.players[0].gold;
  w.issueCommand(0, { type: 'research', building: barracks.id, upgrade: 'house_stone_walls' });
  w.tick();
  assert.equal(barracks.queue.length, 0, 'only at a House');
  const secs = research(w, house, 'house_stone_walls');
  assert.ok(secs > 0);
  assert.equal(w.players[0].gold, gold - UPGRADES.house_stone_walls.cost.gold);
  assert.equal(house.maxHp, BUILDINGS.house.hp + 300);
  assert.equal(house.hp, 700, 'the new health is added, not refilled');
  assert.equal(house.armor, BUILDINGS.house.armor + 3);
  const later = place(w, 0, 'house', 26, 20);
  assert.equal(later.maxHp, BUILDINGS.house.hp + 300);
  assert.deepEqual(w.getSnapshot().players[0].up, ['house_stone_walls']);
  w.issueCommand(0, { type: 'research', building: house.id, upgrade: 'house_stone_walls' });
  const ev = runCollect(w, 0.1);
  assert.ok(errorsOf(ev).includes('Already researched.'));
});

test('research needs its tier, refunds on cancel and finishes with a researched event', () => {
  const w = makeWorld();
  rich(w);
  const house = place(w, 0, 'house', 14, 14);
  w.issueCommand(0, { type: 'research', building: house.id, upgrade: 'house_large_families' });
  assert.ok(errorsOf(runCollect(w, 0.1)).includes('Requires Town.'));
  w.players[0].tier = 2;
  const gold = w.players[0].gold;
  w.issueCommand(0, { type: 'research', building: house.id, upgrade: 'house_large_families' });
  w.tick();
  w.issueCommand(0, { type: 'cancelTrain', building: house.id, index: 0 });
  w.tick();
  assert.equal(w.players[0].gold, gold);
  const cap = w.players[0].popCap;
  w.issueCommand(0, { type: 'research', building: house.id, upgrade: 'house_large_families' });
  const ev = runCollect(w, UPGRADES.house_large_families.time + 1);
  assert.deepEqual(eventsOf(ev, 'researched'), [{ type: 'researched', player: 0, up: 'house_large_families' }]);
  assert.equal(w.players[0].popCap, cap + 2);
});

test('Bronze Weapons and Hoplite Shields change Barracks soldiers only, alive and new', () => {
  const w = makeWorld({ pantheons: PLAIN_PANTHEONS });
  rich(w);
  w.players[0].tier = 2;
  const barracks = place(w, 0, 'barracks', 20, 14);
  const warrior = spawn(w, 0, 'warrior', 16, 20);
  const priest = spawn(w, 0, 'priest', 17, 20);
  research(w, barracks, 'barracks_bronze_weapons');
  research(w, barracks, 'barracks_hoplite_shields');
  assert.ok(Math.abs(warrior.baseDamage - MORTALS.warrior.attack.damage * 1.15) < 1e-9);
  assert.equal(warrior.baseArmor, MORTALS.warrior.armor + 2);
  assert.equal(priest.baseDamage, MORTALS.priest.attack ? MORTALS.priest.attack.damage : 0);
  const archer = spawn(w, 0, 'archer', 18, 20);
  assert.equal(archer.baseArmor, MORTALS.archer.armor + 2);
  const enemy = spawn(w, 1, 'warrior', 30, 30);
  assert.equal(enemy.baseArmor, MORTALS.warrior.armor, 'other players are not affected');
});

test('Drill Yard trains faster', () => {
  const time = (drill) => {
    const w = makeWorld();
    rich(w);
    w.players[0].tier = 2;
    const b = place(w, 0, 'barracks', 20, 14);
    if (drill) research(w, b, 'barracks_drill_yard');
    w.issueCommand(0, { type: 'train', building: b.id, unit: 'warrior' });
    return runUntil(w, () => w.unitsOf(0).some((u) => u.type === 'warrior'), 60);
  };
  assert.ok(time(true) < time(false) * 0.85);
});

test('Iron Picks and Handcarts carry more', () => {
  const w = makeWorld({ map: { forest: [{ x: 4, y: 16, w: 6, h: 3 }] } });
  rich(w);
  w.players[0].tier = 2;
  research(w, w.buildingsOf(0)[0], 'tc_iron_picks');
  const store = place(w, 0, 'storehouse', 6, 20);
  research(w, store, 'storehouse_handcarts');
  const [a, b] = workers(w);
  w.issueCommand(0, { type: 'gather', units: [a.id], target: w.mineList[0].id });
  w.issueCommand(0, { type: 'gather', units: [b.id], tx: 6, ty: 18 });
  runUntil(w, () => a.carry === 'g' && a.carryAmount > 0, 30);
  assert.equal(a.carryAmount, CARRY_AMOUNT + 2);
  runUntil(w, () => b.order && b.order.phase === 'return', 30);
  assert.equal(b.carryAmount, CARRY_AMOUNT + 5);
});

test('Sharpened Axes chop faster', () => {
  const chopTime = (axes) => {
    const w = makeWorld({ map: { forest: [{ x: 4, y: 16, w: 6, h: 3 }] } });
    rich(w);
    if (axes) research(w, place(w, 0, 'storehouse', 6, 20), 'storehouse_sharp_axes');
    const [u] = workers(w);
    w.issueCommand(0, { type: 'gather', units: [u.id], tx: 6, ty: 18 });
    runUntil(w, () => u.order && u.order.phase === 'work', 30);
    return runUntil(w, () => u.carryAmount >= CARRY_AMOUNT, 30);
  };
  const slow = chopTime(false);
  const fast = chopTime(true);
  assert.ok(fast < slow * 0.85, `${fast} vs ${slow}`);
});

test('Sacred Chants and Incense raise the Faith from praying', () => {
  const w = makeWorld();
  rich(w);
  const shrine = place(w, 0, 'shrine', 18, 10);
  const [a] = workers(w);
  w.issueCommand(0, { type: 'pray', units: [a.id], target: shrine.id });
  runUntil(w, () => w.players[0].faithRate > 0, 20);
  assert.equal(w.players[0].faithRate, BUILDINGS.shrine.faithRate);
  research(w, shrine, 'shrine_sacred_chants');
  w.tick();
  assert.ok(Math.abs(w.players[0].faithRate - BUILDINGS.shrine.faithRate * 1.4) < 1e-9);
});

test('tower upgrades: damage, range, health', () => {
  const w = makeWorld();
  rich(w);
  w.players[0].tier = 2;
  const tower = place(w, 0, 'tower', 18, 10);
  research(w, tower, 'tower_burning_arrows');
  research(w, tower, 'tower_lookout');
  research(w, tower, 'tower_iron_bracing');
  assert.ok(Math.abs(tower.dmgMult - 1.4) < 1e-9);
  assert.equal(tower.rangeBonus, 1.5);
  assert.equal(tower.maxHp, BUILDINGS.tower.hp + 300);
  // An enemy just past the base range but inside the new one gets shot.
  clearUnits(w, 1);
  const range = BUILDINGS.tower.attack.range;
  const foe = spawn(w, 1, 'warrior', tower.x + 1 + range + 0.9, tower.y);
  run(w, 2);
  assert.ok(foe.hp < foe.maxHp || foe.dead);
});

test('Rite of Ascension summons gods at level 2', () => {
  const w = makeWorld({ pantheons: PLAIN_PANTHEONS });
  rich(w);
  w.players[0].tier = 3;
  const temple = place(w, 0, 'temple', 18, 10);
  research(w, temple, 'temple_rite_of_ascension');
  research(w, temple, 'temple_divine_favor');
  const [g] = godsFor(w.players[0].pantheon);
  w.issueCommand(0, { type: 'train', building: temple.id, unit: g.id });
  assert.ok(runUntil(w, () => w.unitsOf(0).some((u) => u.type === g.id), 200) > 0);
  const u = w.unitsOf(0).find((x) => x.type === g.id);
  assert.equal(u.level, 2);
  assert.ok(u.baseRegen >= 1 + 2, 'Divine Favor regeneration');
});
