// UI text that states game rules or numbers must match the sim (src/config.js,
// src/data/**, src/sim/**): mine panel, range stat, tooltips, ability level
// line, tier-up unlocks and the new-player checklist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewState } from '../../src/game/view-state.js';
import { MINE_SLOTS, MINE_TIME, CARRY_AMOUNT, DROPOFF_MINE_GAP, ABILITY_LEVEL_SCALE, CANCEL_BUILD_REFUND } from '../../src/config.js';
import { UNITS, BUILDINGS } from '../../src/data/index.js';
import { abilityScale } from '../../src/sim/abilities.js';
import { minersText, rangeText, unitStateText } from '../../src/ui/hud-info.js';
import { getCommandCard, buildingDescription, tierUnlocks, abilityLevelText } from '../../src/ui/command-card.js';
import { tipSteps, splitKeys } from '../../src/ui/hud-tips.js';
import { makeWorld, spawn, place, run, runUntil } from '../sim/helpers.js';

let clock = 0;
function viewOf(world, me = 0) {
  const vs = new ViewState({ setup: world.setup, mapData: world.mapData, myIndex: me });
  vs.pushSnapshot(world.getSnapshot(), (clock += 50));
  return vs;
}
const workersOf = (world, p = 0) => world.unitsOf(p).filter((u) => u.type === 'worshipper');
const tcOf = (world, p = 0) => world.buildingsOf(p).find((b) => b.type === 'town_center');
const byId = (card, id) => card.find((b) => b && b.id === id) || null;
const doneOf = (vs) => Object.fromEntries(tipSteps(vs).map((s) => [s.id, s.done]));

test('mine panel: "Miners n/2" is the snapshot count of workers mining right now', () => {
  const world = makeWorld();
  const mine = world.mineList[0];
  let vs = viewOf(world);
  const view = vs.entities.get(mine.id);
  assert.equal(view.mn, 0);
  assert.equal(minersText(view), `0/${MINE_SLOTS}`);
  // Five workers on one mine: never more than MINE_SLOTS mine at once.
  const ws = workersOf(world);
  for (let i = ws.length; i < 5; i++) spawn(world, 0, 'worshipper', ws[0].x + 1, ws[0].y + 1);
  world.issueCommand(0, { type: 'gather', units: workersOf(world).map((u) => u.id), target: mine.id });
  let maxSeen = 0;
  assert.ok(runUntil(world, () => {
    const mn = viewOf(world).entities.get(mine.id).mn;
    maxSeen = Math.max(maxSeen, mn);
    return mn === MINE_SLOTS;
  }, 40) > 0, 'two workers end up mining');
  vs = viewOf(world);
  assert.equal(minersText(vs.entities.get(mine.id)), `${MINE_SLOTS}/${MINE_SLOTS}`);
  run(world, 10);
  for (let i = 0; i < 40; i++) {
    run(world, 0.25);
    maxSeen = Math.max(maxSeen, viewOf(world).entities.get(mine.id).mn);
  }
  assert.equal(maxSeen, MINE_SLOTS);
  // Odd values from a host are clamped, missing ones read as 0.
  assert.equal(minersText({ mn: 9 }), `${MINE_SLOTS}/${MINE_SLOTS}`);
  assert.equal(minersText({ mn: -3 }), `0/${MINE_SLOTS}`);
  assert.equal(minersText({}), `0/${MINE_SLOTS}`);
  assert.equal(minersText(null), `0/${MINE_SLOTS}`);
});

test('range stat: melee attacks (no projectile) read "Melee", ranged ones show the range', () => {
  for (const u of Object.values(UNITS)) {
    if (!u.attack) continue;
    assert.equal(rangeText(u.attack), u.attack.projectile ? String(u.attack.range) : 'Melee', u.id);
  }
  assert.equal(rangeText(UNITS.warrior.attack), 'Melee');
  assert.equal(rangeText(null), '');
});

test('Gather and Pray tooltips state the mining and prayer rules from the config and data', () => {
  const world = makeWorld();
  const card = getCommandCard({ ids: workersOf(world).map((u) => u.id) }, viewOf(world));
  const gather = byId(card, 'gather').description;
  assert.match(gather, new RegExp(`Up to ${MINE_SLOTS} Worshippers`));
  assert.ok(gather.includes(`${MINE_TIME} s per ${CARRY_AMOUNT} gold`), gather);
  const pray = byId(card, 'pray').description;
  for (const id of ['shrine', 'temple']) {
    const b = BUILDINGS[id];
    assert.ok(b.prayerSlots > 0 && pray.includes(`${b.prayerSlots} at a time`), `${id} slots in "${pray}"`);
    assert.ok(pray.includes(`${b.name} ${b.faithRate}/s`), `${id} rate in "${pray}"`);
  }
});

test('drop-off buildings say how far they must stay from gold mines', () => {
  for (const [id, b] of Object.entries(BUILDINGS)) {
    const d = buildingDescription(id);
    assert.ok(d.startsWith(b.description || ''), id);
    assert.equal(d.includes(`Must stay ${DROPOFF_MINE_GAP} tiles away from gold mines.`), !!b.dropOff, id);
  }
  assert.ok(BUILDINGS.town_center.dropOff && BUILDINGS.storehouse.dropOff);
  assert.equal(buildingDescription('nope'), '');
});

test('tier-up tooltip lists what the data unlocks at that tier', () => {
  for (const tier of [2, 3]) {
    const text = tierUnlocks(tier, 'greek');
    for (const b of Object.values(BUILDINGS)) if (b.tier === tier) assert.ok(text.includes(b.name), `${b.name} in "${text}"`);
    for (const u of Object.values(UNITS)) {
      if (!u.pantheon && u.producedAt && u.tier === tier) assert.ok(text.includes(u.name), `${u.name} in "${text}"`);
    }
  }
  assert.match(tierUnlocks(2, 'greek'), /second god/);
  assert.match(tierUnlocks(3, 'greek'), /Titan Gate.*third god/);
});

test('ability level line uses the sim scale (+10% per level) and only the amounts that scale', () => {
  const zeus = UNITS.greek_zeus;
  const bolt = zeus.abilities.find((a) => a.id === 'greek_zeus_thunderbolt');
  const k = abilityScale({ def: zeus, level: 3 });
  assert.equal(k, 1 + 2 * ABILITY_LEVEL_SCALE);
  assert.equal(abilityLevelText(bolt, 3), `At level 3 (+20%): ${Math.round(140 * k)} damage.`);
  assert.equal(abilityLevelText(bolt, 1), '', 'level 1 adds nothing');
  const wrath = zeus.abilities.find((a) => a.id === 'greek_zeus_wrath_of_olympus');
  assert.equal(abilityLevelText(wrath, 5), `At level 5 (+40%): ${Math.round(160 * 1.4)} damage, ${Math.round(45 * 1.4)} damage/s.`);
  assert.equal(abilityLevelText({ effects: [{ type: 'stun', duration: 1 }] }, 4), '', 'durations do not scale');
  // Every god ability of every pantheon renders without throwing or NaN.
  for (const u of Object.values(UNITS)) {
    if (u.class !== 'god') continue;
    for (const ab of u.abilities || []) assert.doesNotMatch(abilityLevelText(ab, 6), /NaN|undefined/, ab.id);
  }
});

test('cancel-construction tooltip quotes the refund from the config', () => {
  const world = makeWorld();
  const site = place(world, 0, 'house', 14, 14, false);
  const card = getCommandCard([site.id], viewOf(world));
  const cancel = card.find((b) => b && /cancel/i.test(b.id));
  assert.ok(cancel, 'construction site has a cancel button');
  assert.ok(cancel.description.includes(`${Math.round(CANCEL_BUILD_REFUND * 100)}%`), cancel.description);
});

test('getting-started checklist ticks itself off as the player progresses', () => {
  const world = makeWorld();
  Object.assign(world.players[0], { gold: 9000, wood: 9000, faith: 9000 });
  const vs0 = viewOf(world);
  const steps = tipSteps(vs0);
  assert.deepEqual(steps.map((s) => s.id), ['mine', 'build', 'pray', 'god', 'titan']);
  assert.deepEqual(doneOf(vs0), { mine: false, build: false, pray: false, god: false, titan: false });
  for (const s of steps) for (const key of s.keys) assert.match(s.text, new RegExp(`\\b${key}\\b`), `${s.id} mentions ${key}`);

  const ws = workersOf(world);
  world.issueCommand(0, { type: 'gather', units: [ws[0].id], target: world.mineList[0].id });
  run(world, 0.5);
  assert.equal(doneOf(viewOf(world)).mine, true);

  const shrine = place(world, 0, 'shrine', 6, 14);
  assert.equal(doneOf(viewOf(world)).build, true);
  world.issueCommand(0, { type: 'pray', units: [ws[1].id], target: shrine.id });
  assert.ok(runUntil(world, () => doneOf(viewOf(world)).pray, 30) > 0, 'praying gives faith');

  const temple = place(world, 0, 'temple', 14, 6);
  const god = Object.values(UNITS).find((u) => u.class === 'god' && u.pantheon === world.players[0].pantheon);
  world.issueCommand(0, { type: 'train', building: temple.id, unit: god.id });
  run(world, 0.2);
  assert.equal(doneOf(viewOf(world)).god, true, 'a god in the queue counts');

  assert.equal(doneOf(viewOf(world)).titan, false);
  place(world, 0, 'titan_gate', 18, 12);
  assert.equal(doneOf(viewOf(world)).titan, true);

  // The other player's progress never ticks my list.
  assert.equal(doneOf(viewOf(world, 1)).titan, false);
  assert.ok(tcOf(world, 1));
});

test('a locked button does not repeat its red reason inside the description', () => {
  const world = makeWorld();
  const sel = { ids: workersOf(world).map((u) => u.id) };
  const gate = byId(getCommandCard(sel, viewOf(world), 'build'), 'build:titan_gate');
  assert.equal(gate.state, 'locked');
  assert.equal(gate.reason, 'Requires City.');
  assert.ok(!gate.description.includes('Requires City.'), gate.description);
  assert.ok(gate.description.startsWith(BUILDINGS.titan_gate.description.replace(' Requires City.', '')), gate.description);
  const temple = byId(getCommandCard(sel, viewOf(world), 'build'), 'build:temple');
  assert.equal(temple.reason, 'Requires a Shrine.');
  assert.doesNotMatch(temple.description, /Requires a Shrine\.|\s{2}/);
  // Unlocked: the data description is shown whole.
  place(world, 0, 'shrine', 6, 14);
  const t2 = byId(getCommandCard(sel, viewOf(world), 'build'), 'build:temple');
  assert.equal(t2.reason, null);
  assert.equal(t2.description, buildingDescription('temple'));
});

test('tip hotkeys: "(H)" becomes a bare key cap, other capitals stay text', () => {
  assert.deepEqual(splitKeys('Press B to build. Houses (H) raise it.', ['B', 'H']), ['Press ', { key: 'B' }, ' to build. Houses ', { key: 'H' }, ' raise it.']);
  assert.deepEqual(splitKeys('A City (U), then', ['U']), ['A City ', { key: 'U' }, ', then']);
  assert.deepEqual(splitKeys('Build a Shrine', ['S']), ['Build a Shrine'], 'S inside a word is not a key');
  assert.deepEqual(splitKeys('no keys', []), ['no keys']);
  for (const s of tipSteps(viewOf(makeWorld()))) {
    const keys = splitKeys(s.text, s.keys).filter((p) => typeof p !== 'string').map((p) => p.key);
    assert.deepEqual(keys, s.keys, s.id);
  }
});

test('worker state line: gold, waiting its turn (sim key mw), wood, carrying; foreign units say nothing', () => {
  const w = UNITS.worshipper;
  assert.equal(unitStateText({ o: 0, st: 'gather', tg: 5 }, w, 0), 'Gathering gold');
  assert.equal(unitStateText({ o: 0, st: 'gather', tg: 5, mw: 1 }, w, 0), 'Waiting its turn at the gold mine');
  assert.equal(unitStateText({ o: 0, st: 'gather' }, w, 0), 'Chopping wood');
  assert.equal(unitStateText({ o: 0, st: 'return', c: 'g' }, w, 0), 'Returning resources · Carrying gold');
  assert.equal(unitStateText({ o: 0, st: 'move', bo: { b: 'house' } }, w, 0), 'On the way to build a House');
  assert.equal(unitStateText({ o: 1, st: 'gather', tg: 5 }, w, 0), '');
  assert.equal(unitStateText({ o: 1, st: 'idle', ex: 4.2 }, UNITS.warrior, 0), 'Vanishes in 5s');
  // A real gathering worker from the sim reads "Gathering gold".
  const world = makeWorld();
  const ws = workersOf(world);
  world.issueCommand(0, { type: 'gather', units: [ws[0].id], target: world.mineList[0].id });
  run(world, 0.5);
  assert.equal(unitStateText(viewOf(world).entities.get(ws[0].id), w, 0), 'Gathering gold');
});
