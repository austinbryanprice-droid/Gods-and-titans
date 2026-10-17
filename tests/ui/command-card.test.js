import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { getCommandCard, buttonForKey, trainCheck, pickTrainBuilding, godCount, CARD_SLOTS } from '../../src/ui/command-card.js';
import { subgroups } from '../../src/ui/hud-data.js';
import { makeWorld, spawn, place, run, runUntil } from '../sim/helpers.js';

let clock = 0;
/** A ViewState for player `me` fed one real snapshot from the world. */
function viewOf(world, me = 0) {
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: me });
  vs.pushSnapshot(world.getSnapshot(), (clock += 50));
  return vs;
}

const ids = (list) => list.map((e) => e.id);
const slotsOf = (card) => card.map((b, i) => (b ? `${i}:${b.id}` : null)).filter(Boolean);
const byId = (card, id) => card.find((b) => b && b.id === id) || null;
const workersOf = (world, p = 0) => world.unitsOf(p).filter((u) => u.type === 'worshipper');
const tcOf = (world, p = 0) => world.buildingsOf(p).find((b) => b.type === 'town_center');

function rich(world, p = 0) {
  Object.assign(world.players[p], { gold: 5000, wood: 5000, faith: 5000 });
}

test('empty, unknown and foreign selections give an empty card of 12 slots', () => {
  const world = makeWorld();
  const vs = viewOf(world);
  assert.equal(getCommandCard([], vs).length, CARD_SLOTS);
  assert.ok(getCommandCard([], vs).every((b) => b === null));
  assert.ok(getCommandCard([99999], vs).every((b) => b === null));
  const enemy = world.unitsOf(1)[0];
  assert.ok(getCommandCard({ ids: [enemy.id] }, vs).every((b) => b === null), 'enemy units: info only');
  const mine = world.mineList[0];
  assert.ok(getCommandCard([mine.id], vs).every((b) => b === null), 'gold mine: info only');
  assert.ok(getCommandCard([tcOf(world, 1).id], vs).every((b) => b === null), 'enemy building: info only');
});

test('worker card: WC3 layout, hotkeys and states', () => {
  const world = makeWorld();
  const vs = viewOf(world);
  const workers = workersOf(world);
  const card = getCommandCard({ ids: ids(workers) }, vs);
  assert.deepEqual(slotsOf(card), ['0:move', '1:stop', '2:hold', '3:attack', '4:gather', '5:return', '6:pray', '8:build']);
  assert.deepEqual(card.filter(Boolean).map((b) => b.key), ['M', 'S', 'H', 'A', 'G', 'C', 'P', 'B']);
  assert.equal(byId(card, 'return').state, 'disabled', 'nobody carries anything yet');
  assert.equal(byId(card, 'pray').state, 'locked');
  assert.equal(byId(card, 'pray').reason, 'Requires a Shrine.');
  assert.equal(byId(card, 'move').enabled, true);
  assert.deepEqual(byId(card, 'gather').action, { kind: 'target', order: 'gather', target: 'resource' });
  assert.deepEqual(byId(card, 'build').action, { kind: 'submenu', menu: 'build' });
  assert.equal(buttonForKey(card, 'b').id, 'build');
  assert.equal(buttonForKey(card, 'G').id, 'gather');
  assert.equal(buttonForKey(card, 'Q'), null);

  // A worker carrying gold enables Return; a finished Shrine enables Pray.
  const mine = world.mineList[0];
  world.issueCommand(0, { type: 'gather', units: [workers[0].id], target: mine.id });
  assert.ok(runUntil(world, () => workers[0].carryAmount > 0, 20) > 0);
  place(world, 0, 'shrine', 6, 13);
  const vs2 = viewOf(world);
  const card2 = getCommandCard({ ids: ids(workers) }, vs2);
  assert.equal(byId(card2, 'return').state, 'ready');
  assert.equal(byId(card2, 'pray').state, 'ready');
});

test('build submenu: 8 buildings with costs, tier and requirement locks, Back', () => {
  const world = makeWorld();
  const vs = viewOf(world);
  const sel = { ids: ids(workersOf(world)) };
  const card = getCommandCard(sel, vs, 'build');
  assert.deepEqual(slotsOf(card), [
    '0:build:house', '1:build:barracks', '2:build:shrine', '3:build:storehouse',
    '4:build:tower', '5:build:temple', '6:build:titan_gate', '7:build:town_center', '11:back',
  ]);
  assert.deepEqual(card.slice(0, 8).map((b) => b.key), ['H', 'B', 'S', 'O', 'T', 'E', 'G', 'C']);
  const house = byId(card, 'build:house');
  assert.equal(house.state, 'ready');
  assert.deepEqual(house.cost, { gold: 80, wood: 30, faith: 0, pop: 0, time: 25 });
  assert.deepEqual(house.action, { kind: 'place', building: 'house' });
  assert.equal(byId(card, 'build:temple').state, 'locked');
  assert.equal(byId(card, 'build:temple').reason, 'Requires a Shrine.');
  assert.equal(byId(card, 'build:titan_gate').reason, 'Requires City.');
  assert.equal(byId(card, 'build:town_center').state, 'unaffordable', '400 gold / 250 wood > start wood');
  assert.equal(byId(card, 'build:town_center').reason, 'Not enough wood.');
  assert.equal(byId(card, 'back').key, 'Escape');
  assert.equal(byId(card, 'back').keyLabel, 'Esc');

  world.players[0].gold = 10;
  const poor = getCommandCard(sel, viewOf(world), 'build');
  assert.equal(byId(poor, 'build:house').state, 'unaffordable');
  assert.equal(byId(poor, 'build:house').reason, 'Not enough gold.');
  assert.equal(byId(poor, 'build:house').enabled, false);

  // A non-worker selection has no build submenu.
  const w = spawn(world, 0, 'warrior', 10, 14);
  assert.ok(getCommandCard([w.id], viewOf(world), 'build').every((b) => b === null));
});

test('targeting and placement modes show only Cancel', () => {
  const world = makeWorld();
  const vs = viewOf(world);
  for (const mode of ['target', 'place', { kind: 'target' }]) {
    const card = getCommandCard(ids(workersOf(world)), vs, mode);
    assert.deepEqual(slotsOf(card), ['11:cancel']);
    assert.equal(card[11].key, 'Escape');
  }
});

test('Town Center: Worshipper, Grow (with requirement), Rally, queue count, growing lock', () => {
  const world = makeWorld();
  const tc = tcOf(world);
  let card = getCommandCard([tc.id], viewOf(world));
  assert.deepEqual(slotsOf(card), ['0:train:worshipper', '1:tier', '11:rally']);
  const w = card[0];
  assert.equal(w.key, 'W');
  assert.equal(w.state, 'ready');
  assert.deepEqual(w.cost, { gold: 50, wood: 0, faith: 0, pop: 1, time: 12 });
  assert.equal(card[1].key, 'U');
  assert.equal(card[1].title, 'Grow into a Town');
  assert.equal(card[1].state, 'locked');
  assert.equal(card[1].reason, 'Requires a Shrine.');
  assert.equal(card[11].key, 'Y');

  world.issueCommand(0, { type: 'train', building: tc.id, unit: 'worshipper' });
  world.issueCommand(0, { type: 'train', building: tc.id, unit: 'worshipper' });
  run(world, 0.1);
  card = getCommandCard([tc.id], viewOf(world));
  assert.equal(card[0].queued, 2);

  place(world, 0, 'shrine', 6, 13);
  rich(world);
  card = getCommandCard([tc.id], viewOf(world));
  assert.equal(card[1].state, 'ready');
  assert.deepEqual(card[1].cost, { gold: 300, wood: 200, faith: 0, pop: 0, time: 60 });

  world.issueCommand(0, { type: 'upgradeTier', building: tc.id });
  run(world, 0.1);
  card = getCommandCard([tc.id], viewOf(world));
  assert.equal(card[0].state, 'disabled');
  assert.equal(card[0].reason, 'The Town Center is growing.');
  assert.equal(card[1].state, 'disabled');

  // Grown into a Town: next is City (needs a Temple), then no Grow button at all.
  assert.ok(runUntil(world, () => world.players[0].tier === 2, 90) > 0);
  card = getCommandCard([tc.id], viewOf(world));
  assert.equal(card[1].title, 'Grow into a City');
  assert.equal(card[1].reason, 'Requires a Temple.');
  tc.tier = 3;
  card = getCommandCard([tc.id], viewOf(world));
  assert.equal(card[1], null);
});

test('population cap and queue limit make training unavailable', () => {
  const world = makeWorld();
  const tc = tcOf(world);
  rich(world);
  world.players[0].popCap = world.players[0].popUsed; // capped
  world.recomputePopCap = () => {};
  let card = getCommandCard([tc.id], viewOf(world));
  assert.equal(card[0].state, 'unaffordable');
  assert.equal(card[0].reason, 'Not enough population. Build more Houses.');

  world.players[0].popCap = 100;
  for (let i = 0; i < 5; i++) world.issueCommand(0, { type: 'train', building: tc.id, unit: 'worshipper' });
  run(world, 0.1);
  card = getCommandCard([tc.id], viewOf(world));
  assert.equal(card[0].queued, 5);
  assert.equal(card[0].reason, 'Production queue is full.');
});

test('Barracks: Warrior W, Archer A, Priest P (Town), Ram R (Town); several barracks share the queue', () => {
  const world = makeWorld();
  const b1 = place(world, 0, 'barracks', 6, 13);
  const b2 = place(world, 0, 'barracks', 11, 13);
  rich(world);
  const vs = viewOf(world);
  const card = getCommandCard([b1.id, b2.id], vs);
  assert.deepEqual(slotsOf(card), ['0:train:warrior', '1:train:archer', '2:train:priest', '3:train:battering_ram', '11:rally']);
  assert.deepEqual(card.slice(0, 4).map((b) => b.key), ['W', 'A', 'P', 'R']);
  assert.equal(card[0].state, 'ready');
  assert.equal(card[2].state, 'locked');
  assert.equal(card[2].reason, 'Requires Town.');
  assert.deepEqual(card[1].cost, { gold: 120, wood: 30, faith: 0, pop: 2, time: 20 });
  // Train goes to the barracks with the shorter queue.
  world.issueCommand(0, { type: 'train', building: b1.id, unit: 'warrior' });
  run(world, 0.1);
  const vs2 = viewOf(world);
  const pick = pickTrainBuilding([vs2.getEntity(b1.id), vs2.getEntity(b2.id)]);
  assert.equal(pick.id, b2.id);
});

test('Shrine creatures Q W E with tier locks; Titan Gate titan T', () => {
  const world = makeWorld();
  const shrine = place(world, 0, 'shrine', 6, 13);
  const gate = place(world, 0, 'titan_gate', 11, 13);
  rich(world);
  let vs = viewOf(world);
  let card = getCommandCard([shrine.id], vs);
  assert.deepEqual(slotsOf(card), ['0:train:greek_centaur', '1:train:greek_pegasus', '2:train:greek_cyclops', '11:rally']);
  assert.deepEqual(card.slice(0, 3).map((b) => b.key), ['Q', 'W', 'E']);
  assert.equal(card[0].state, 'ready');
  assert.equal(card[0].title, 'Summon Centaur');
  assert.equal(card[1].reason, 'Requires Town.');
  assert.equal(card[2].reason, 'Requires City.');

  card = getCommandCard([gate.id], vs);
  assert.deepEqual(slotsOf(card), ['0:train:greek_kronos', '11:rally']);
  assert.equal(card[0].key, 'T');
  assert.equal(card[0].reason, 'Requires City.');
  tcOf(world).tier = 3;
  world.recomputeTier(0);
  world.players[0].popCap = 150;
  card = getCommandCard([gate.id], viewOf(world));
  assert.equal(card[0].state, 'ready');
  assert.deepEqual(card[0].cost, { gold: 400, wood: 200, faith: 800, pop: 10, time: 60 });
  world.issueCommand(0, { type: 'train', building: gate.id, unit: 'greek_kronos' });
  run(world, 0.1);
  vs = viewOf(world);
  card = getCommandCard([gate.id], vs);
  assert.equal(card[0].reason, 'You already have a Titan.');
  assert.equal(card[0].queued, 1);
});

test('Temple: four gods, god limits by tier, duplicates, and Revive for the fallen', () => {
  const world = makeWorld();
  const temple = place(world, 0, 'temple', 6, 13);
  rich(world);
  world.players[0].popCap = 150;
  let card = getCommandCard([temple.id], viewOf(world));
  assert.deepEqual(slotsOf(card), ['0:train:greek_zeus', '1:train:greek_athena', '2:train:greek_poseidon', '3:train:greek_hades', '11:rally']);
  assert.deepEqual(card.slice(0, 4).map((b) => b.key), ['Q', 'W', 'E', 'R']);
  assert.ok(card.slice(0, 4).every((b) => b.state === 'ready'));
  assert.deepEqual(card[0].cost, { gold: 100, wood: 0, faith: 200, pop: 5, time: 35 });

  world.issueCommand(0, { type: 'train', building: temple.id, unit: 'greek_zeus' });
  run(world, 0.1);
  let vs = viewOf(world);
  assert.equal(godCount(vs), 1);
  card = getCommandCard([temple.id], vs);
  assert.equal(card[0].reason, 'You already have that god.');
  assert.equal(card[1].reason, 'Your next god requires Town.');

  // At City with 3 gods: the 4th is refused.
  tcOf(world).tier = 3;
  world.recomputeTier(0);
  world.issueCommand(0, { type: 'train', building: temple.id, unit: 'greek_athena' });
  world.issueCommand(0, { type: 'train', building: temple.id, unit: 'greek_poseidon' });
  run(world, 0.1);
  card = getCommandCard([temple.id], viewOf(world));
  assert.equal(card[3].reason, 'You can only have 3 gods.');

  // Zeus is summoned, levels up, and falls: the Temple offers a half-price revive.
  assert.ok(runUntil(world, () => world.unitsOf(0).some((u) => u.type === 'greek_zeus'), 60) > 0);
  for (const b of world.buildingsOf(0)) b.queue.length = 0;
  world.recomputePop();
  const zeus = world.unitsOf(0).find((u) => u.type === 'greek_zeus');
  world.gainXp(zeus, 320);
  assert.equal(zeus.level, 3);
  world.killEntity(zeus, null);
  run(world, 0.1);
  vs = viewOf(world);
  card = getCommandCard([temple.id], vs);
  assert.equal(card[0].title, 'Revive Zeus (level 3)');
  assert.equal(card[0].state, 'ready');
  assert.deepEqual(card[0].cost, { gold: 50, wood: 0, faith: 100, pop: 5, time: 17.5 });
  const chk = trainCheck(vs, 'greek_zeus', [vs.getEntity(temple.id)]);
  assert.equal(chk.revive, 3);
});

test('god card: abilities Q W R in the bottom row with level locks and cooldowns', () => {
  const world = makeWorld();
  rich(world);
  const zeus = spawn(world, 0, 'greek_zeus', 12, 16);
  let card = getCommandCard([zeus.id], viewOf(world));
  assert.deepEqual(slotsOf(card), ['0:move', '1:stop', '2:hold', '3:attack',
    '8:ability:greek_zeus_thunderbolt', '9:ability:greek_zeus_chain_lightning', '11:ability:greek_zeus_wrath_of_olympus']);
  const [q, w, r] = [card[8], card[9], card[11]];
  assert.equal(q.key, 'Q');
  assert.equal(q.state, 'ready');
  assert.deepEqual(q.action, { kind: 'target', order: 'cast', ability: 'greek_zeus_thunderbolt', target: 'point', unitType: 'greek_zeus' });
  assert.equal(w.state, 'locked');
  assert.equal(w.reason, 'Unlocks at level 2.');
  assert.doesNotMatch(w.description, /Unlocks at level/, 'the red reason line says it');
  assert.equal(r.level, 4);

  // Cast Q: the button shows a cooldown sweep.
  world.issueCommand(0, { type: 'cast', unit: zeus.id, ability: 'greek_zeus_thunderbolt', x: 14, y: 16 });
  assert.ok(runUntil(world, () => zeus.cooldowns.greek_zeus_thunderbolt > 0, 5) > 0);
  run(world, 1);
  world.gainXp(zeus, 130);
  card = getCommandCard([zeus.id], viewOf(world));
  assert.equal(card[8].state, 'cooldown');
  assert.equal(card[8].enabled, false);
  assert.ok(card[8].cooldown > 0.5 && card[8].cooldown < 1, `fraction ${card[8].cooldown}`);
  assert.ok(card[8].cooldownLeft > 5);
  assert.equal(card[9].state, 'ready', 'level 2 unlocks W');
  assert.doesNotMatch(card[9].description, /Unlocks at level/, 'already unlocked: no unlock note');
  assert.match(card[9].description, /At level 2 \(\+10%\): 121 chain damage\./);
  assert.equal(card[11].state, 'locked');
});

test('titan card shows abilities and its passive; creature autocast flagged', () => {
  const world = makeWorld();
  const kronos = spawn(world, 0, 'greek_kronos', 14, 16);
  const vs = viewOf(world);
  const card = getCommandCard([kronos.id], vs);
  assert.ok(card[8] && card[8].key === 'Q');
  assert.ok(card[11] && card[11].key === 'R');
  const passive = card[4];
  assert.ok(passive && passive.passive, 'aura shown in the middle row');
  assert.equal(passive.state, 'passive');
  assert.equal(passive.enabled, false);
  assert.match(passive.description, /Aura/);
  assert.equal(buttonForKey(card, passive.key), null);

  const priest = spawn(world, 0, 'priest', 12, 16);
  const pc = getCommandCard([priest.id], viewOf(world));
  assert.equal(pc[8].autocast, true);
  assert.equal(pc[8].title, 'Heal');
});

test('mixed selection: gods first, Tab-style activeType switches the card', () => {
  const world = makeWorld();
  const zeus = spawn(world, 0, 'greek_zeus', 12, 16);
  const w1 = spawn(world, 0, 'warrior', 12, 17);
  const workers = workersOf(world);
  const vs = viewOf(world);
  const all = [w1.id, ...ids(workers), zeus.id];
  const groups = subgroups(all, vs);
  assert.deepEqual(groups.map((g) => g.type), ['greek_zeus', 'warrior', 'worshipper']);
  let card = getCommandCard({ ids: all }, vs);
  assert.ok(card[8] && card[8].id === 'ability:greek_zeus_thunderbolt', 'god subgroup is active by default');
  card = getCommandCard({ ids: all, activeType: 'worshipper' }, vs);
  assert.ok(byId(card, 'gather') && byId(card, 'build'));
  card = getCommandCard({ ids: all, activeType: 'warrior' }, vs);
  assert.deepEqual(slotsOf(card), ['0:move', '1:stop', '2:hold', '3:attack']);
  card = getCommandCard({ ids: all, activeType: 'nonexistent' }, vs);
  assert.ok(card[8] && card[8].id.startsWith('ability:greek_zeus'));
});

test('construction site: only Cancel Construction (Esc)', () => {
  const world = makeWorld();
  const site = place(world, 0, 'barracks', 6, 13, false);
  const card = getCommandCard([site.id], viewOf(world));
  assert.deepEqual(slotsOf(card), ['11:cancel-build']);
  assert.equal(card[11].key, 'Escape');
  assert.deepEqual(card[11].action, { kind: 'cancelBuild' });
});

test('houses and storehouses have no commands; towers neither', () => {
  const world = makeWorld();
  const h = place(world, 0, 'house', 6, 13);
  const t = place(world, 0, 'tower', 9, 13);
  const vs = viewOf(world);
  assert.ok(getCommandCard([h.id], vs).every((b) => b === null));
  assert.ok(getCommandCard([t.id], vs).every((b) => b === null));
});
