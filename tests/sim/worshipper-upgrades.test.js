// Worshipper upgrade lines at the Town Center: work speed (Work Songs →
// Master Craftsmen → Tireless Devotion) and health (Hearty Meals → Healing
// Herbs → Blessed Vigor). Levels chain with `after`, apply to every Worshipper
// the player has now and later, and leave other units and players alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, MORTALS } from '../../src/data/index.js';
import { UPGRADES, computeMods, workSpeed, chopSpeed, offeredUpgrades, lineOf } from '../../src/data/upgrades.js';
import { CARRY_AMOUNT } from '../../src/config.js';
import { makeWorld, run, runUntil, runCollect, place, spawn, errorsOf, eventsOf } from './helpers.js';

const WORK = ['tc_work_songs', 'tc_master_craftsmen', 'tc_tireless_devotion'];
const HEALTH = ['tc_hearty_meals', 'tc_healing_herbs', 'tc_blessed_vigor'];

const workers = (w, p = 0) => w.unitsOf(p).filter((u) => u.type === 'worshipper');
const rich = (w, p = 0) => Object.assign(w.players[p], { gold: 5000, wood: 5000, faith: 5000 });
const tcOf = (w, p = 0) => w.buildingsOf(p).find((b) => b.type === 'town_center');
const own = (w, ids, p = 0) => ids.forEach((id) => w.completeResearch(p, id));

/** Queue a research at a building and tick until it finishes. */
function research(w, b, upId) {
  w.issueCommand(b.owner, { type: 'research', building: b.id, upgrade: upId });
  w.tick();
  const item = b.queue.find((q) => q.u === upId);
  assert.ok(item, `${upId} queued`);
  return runUntil(w, () => w.players[b.owner].upgrades[upId], item.time + 2);
}

test('the Town Center offers two three-level lines, chained by after, one hotkey per line', () => {
  const tc = BUILDINGS.town_center;
  for (const [ids, line, key] of [[WORK, 'worshipper_work', 'K'], [HEALTH, 'worshipper_health', 'H']]) {
    const levels = ids.map((id) => UPGRADES[id]);
    levels.forEach((up, i) => {
      assert.equal(up.building, 'town_center');
      assert.equal(up.line, line);
      assert.equal(up.hotkey, key);
      assert.equal(up.tier, i + 1, 'level n needs settlement tier n');
      assert.equal(up.after, i ? ids[i - 1] : undefined);
    });
    assert.deepEqual(lineOf(levels[2]).map((u) => u.id), ids);
  }
  assert.ok(tc.upgrades.some((u) => u.id === 'tc_iron_picks'), 'the existing Town Center upgrades stay');
});

test('a line offers its next level to research, then its last once the line is done', () => {
  const ids = (owned) => offeredUpgrades('town_center', owned).map((u) => u.id);
  assert.deepEqual(ids([]), ['tc_iron_picks', 'tc_palisade', WORK[0], HEALTH[0]]);
  assert.deepEqual(ids([WORK[0]]), ['tc_iron_picks', 'tc_palisade', WORK[1], HEALTH[0]]);
  assert.deepEqual(ids([WORK[0], WORK[1], HEALTH[0], 'tc_palisade']), ['tc_iron_picks', 'tc_palisade', WORK[2], HEALTH[1]]);
  assert.deepEqual(ids([...WORK, ...HEALTH]), ['tc_iron_picks', 'tc_palisade', WORK[2], HEALTH[2]]);
  assert.deepEqual(ids(new Set(WORK)), ['tc_iron_picks', 'tc_palisade', WORK[2], HEALTH[0]], 'a Set works too');
  assert.deepEqual(offeredUpgrades('barracks', []).map((u) => u.id), BUILDINGS.barracks.upgrades.map((u) => u.id), 'buildings without lines list every upgrade');
});

test('work levels add up; chopping stacks Sharpened Axes on top', () => {
  assert.equal(workSpeed(computeMods([])), 1);
  assert.equal(workSpeed(computeMods([WORK[0]])), 1.15);
  assert.ok(Math.abs(workSpeed(computeMods(WORK)) - 1.5) < 1e-9);
  assert.ok(Math.abs(chopSpeed(computeMods([...WORK, 'storehouse_sharp_axes'])) - 1.5 * 1.25) < 1e-9);
  assert.equal(chopSpeed(computeMods(['storehouse_sharp_axes'])), 1.25);
});

test('each level needs the one before it, then its settlement tier', () => {
  for (const [ids, names] of [[WORK, ['Work Songs', 'Master Craftsmen']], [HEALTH, ['Hearty Meals', 'Healing Herbs']]]) {
    const w = makeWorld();
    rich(w);
    const tc = tcOf(w);
    const ask = (id) => {
      w.issueCommand(0, { type: 'research', building: tc.id, upgrade: id });
      return errorsOf(runCollect(w, 0.1));
    };
    assert.deepEqual(ask(ids[1]), [`Requires ${names[0]}.`], 'level 2 before level 1');
    assert.deepEqual(ask(ids[2]), [`Requires ${names[1]}.`], 'level 3 before level 2');
    research(w, tc, ids[0]);
    assert.deepEqual(ask(ids[1]), ['Requires Town.'], 'level 2 needs a Town');
    w.players[0].tier = 2;
    research(w, tc, ids[1]);
    assert.deepEqual(ask(ids[2]), ['Requires City.'], 'level 3 needs a City');
    w.players[0].tier = 3;
    research(w, tc, ids[2]);
    assert.deepEqual(ask(ids[2]), ['Already researched.']);
    assert.deepEqual(w.getSnapshot().players[0].up, ids);
  }
});

test('levels are paid for up front and a finished level raises a researched event', () => {
  const w = makeWorld();
  rich(w);
  const tc = tcOf(w);
  const p = w.players[0];
  const gold = p.gold;
  const wood = p.wood;
  w.issueCommand(0, { type: 'research', building: tc.id, upgrade: WORK[0] });
  w.tick();
  assert.equal(p.gold, gold - UPGRADES[WORK[0]].cost.gold);
  assert.equal(p.wood, wood - UPGRADES[WORK[0]].cost.wood);
  const ev = runCollect(w, UPGRADES[WORK[0]].time + 1);
  assert.deepEqual(eventsOf(ev, 'researched'), [{ type: 'researched', player: 0, up: WORK[0] }]);
  assert.equal(p.mods.work, 0.15);
});

// ---- Work speed

/** Ticks one lone Worshipper spends digging a gold trip (the mine's work phase). */
function miningTicks(upgrades) {
  const w = makeWorld();
  own(w, upgrades);
  const [u] = workers(w);
  w.issueCommand(0, { type: 'gather', units: [u.id], target: w.mineList[0].id });
  assert.ok(runUntil(w, () => u.order && u.order.phase === 'work', 30) > 0, 'reaches the mine');
  const o = u.order;
  let ticks = 0;
  while (o.phase === 'work' && ticks < 200) {
    w.tick();
    ticks++;
  }
  return ticks;
}

test('Work Songs and its levels shorten a mining trip', () => {
  const base = miningTicks([]);
  const l1 = miningTicks(WORK.slice(0, 1));
  const l3 = miningTicks(WORK);
  assert.ok(base >= 30 && base <= 32, `a normal trip takes about 1.5 s (${base} ticks)`);
  assert.ok(l1 < base && l3 < l1, `${base} > ${l1} > ${l3}`);
  assert.ok(l3 <= Math.ceil(base / 1.5) + 1, `level 3 digs 50% faster (${l3} vs ${base})`);
  assert.equal(miningTicks(HEALTH), base, 'health upgrades do not change the work');
});

test('Worshippers chop faster with the work upgrades, on top of Sharpened Axes', () => {
  const chopTime = (upgrades) => {
    const w = makeWorld({ map: { forest: [{ x: 4, y: 16, w: 6, h: 3 }] } });
    own(w, upgrades);
    const [u] = workers(w);
    w.issueCommand(0, { type: 'gather', units: [u.id], tx: 6, ty: 18 });
    runUntil(w, () => u.order && u.order.phase === 'work', 30);
    return runUntil(w, () => u.carryAmount >= CARRY_AMOUNT, 30);
  };
  const base = chopTime([]);
  const songs = chopTime([WORK[0]]);
  const all = chopTime(WORK);
  const both = chopTime([...WORK, 'storehouse_sharp_axes']);
  assert.ok(Math.abs(base - 6) < 0.2, `10 wood take about 6 s (${base})`);
  assert.ok(songs < base * 0.9, `${songs} vs ${base}`);
  assert.ok(all < base * 0.72 && all > base * 0.6, `+50%: ${all} vs ${base}`);
  assert.ok(both < all * 0.85, `Sharpened Axes stack: ${both} vs ${all}`);
});

test('construction and repair go faster with the work upgrades', () => {
  const progress = (upgrades) => {
    const w = makeWorld();
    own(w, upgrades);
    rich(w);
    const site = place(w, 0, 'house', 14, 14, false);
    const [u] = workers(w);
    w.issueCommand(0, { type: 'repair', units: [u.id], target: site.id });
    runUntil(w, () => u.state === 'build', 20);
    const p0 = site.buildProgress;
    run(w, 5);
    return site.buildProgress - p0;
  };
  const mended = (upgrades) => {
    const w = makeWorld();
    own(w, upgrades);
    rich(w);
    const house = place(w, 0, 'house', 14, 14);
    house.hp = 50;
    const [u] = workers(w);
    w.issueCommand(0, { type: 'repair', units: [u.id], target: house.id });
    runUntil(w, () => u.state === 'build', 20);
    const h0 = house.hp;
    run(w, 4);
    return house.hp - h0;
  };
  const b0 = progress([]);
  const b3 = progress(WORK);
  assert.ok(Math.abs(b0 - 5 / BUILDINGS.house.buildTime) < 0.01, `${b0} in 5 s`);
  assert.ok(Math.abs(b3 / b0 - 1.5) < 0.05, `+50% construction: ${b3} vs ${b0}`);
  const m0 = mended([]);
  const m1 = mended([WORK[0]]);
  const m3 = mended(WORK);
  assert.ok(Math.abs(m1 / m0 - 1.15) < 0.05, `Work Songs: ${m1} vs ${m0}`);
  assert.ok(Math.abs(m3 / m0 - 1.5) < 0.05, `all levels: ${m3} vs ${m0}`);
  assert.equal(progress(HEALTH), b0, 'health upgrades do not speed up building');
});

test('work speed belongs to the player who researched it', () => {
  const w = makeWorld();
  own(w, WORK, 0);
  assert.equal(w.players[0].mods.work, 0.5);
  assert.equal(w.players[1].mods.work, 0);
  const rival = place(w, 1, 'house', 30, 30, false);
  const [theirs] = workers(w, 1);
  w.issueCommand(1, { type: 'repair', units: [theirs.id], target: rival.id });
  runUntil(w, () => theirs.state === 'build', 30);
  const p0 = rival.buildProgress;
  run(w, 5);
  assert.ok(Math.abs(rival.buildProgress - p0 - 5 / BUILDINGS.house.buildTime) < 0.01);
});

// ---- Health

test('health levels raise every Worshipper\'s health, the new health added to what they have', () => {
  const w = makeWorld();
  const base = MORTALS.worshipper.hp;
  const all = workers(w);
  assert.ok(all.length >= 2);
  all[0].hp = 100;
  own(w, [HEALTH[0]]);
  for (const u of all) assert.equal(u.maxHp, Math.round(base * 1.2));
  assert.equal(all[0].hp, 100 + Math.round(base * 1.2) - base, 'a wounded Worshipper gains the extra health');
  assert.equal(all[1].hp, all[1].maxHp, 'a healthy one stays full');
  own(w, [HEALTH[1]]);
  assert.equal(all[1].maxHp, Math.round(base * 1.4));
  own(w, [HEALTH[2]]);
  assert.equal(all[1].maxHp, Math.round(base * 1.6));
  assert.equal(all[1].hp, all[1].maxHp);
});

test('Worshippers trained or spawned later arrive with the boosted health', () => {
  const w = makeWorld();
  rich(w);
  const tc = tcOf(w);
  research(w, tc, HEALTH[0]);
  const spawned = spawn(w, 0, 'worshipper', 20, 20);
  assert.equal(spawned.maxHp, Math.round(MORTALS.worshipper.hp * 1.2));
  assert.equal(spawned.hp, spawned.maxHp);
  const before = new Set(workers(w).map((u) => u.id));
  w.issueCommand(0, { type: 'train', building: tc.id, unit: 'worshipper' });
  assert.ok(runUntil(w, () => workers(w).some((u) => !before.has(u.id)), 40) > 0);
  const trained = workers(w).find((u) => !before.has(u.id));
  assert.equal(trained.maxHp, Math.round(MORTALS.worshipper.hp * 1.2));
  assert.equal(trained.hp, trained.maxHp);
  assert.equal(w.getSnapshot().entities.find((e) => e.id === trained.id).mhp, trained.maxHp);
});

test('health levels leave soldiers and the other player\'s Worshippers alone', () => {
  const w = makeWorld();
  const warrior = spawn(w, 0, 'warrior', 20, 20);
  const foe = spawn(w, 1, 'warrior', 30, 30);
  own(w, HEALTH);
  assert.equal(warrior.maxHp, MORTALS.warrior.hp);
  assert.equal(foe.maxHp, MORTALS.warrior.hp);
  for (const u of workers(w, 1)) assert.equal(u.maxHp, MORTALS.worshipper.hp);
  for (const u of workers(w, 0)) assert.equal(u.maxHp, Math.round(MORTALS.worshipper.hp * 1.6));
});
