// Relics (DESIGN 5.11): the bigger creep camps guard one each; a cleared camp drops it, a Worshipper
// or a god carries it to its owner's Temple, where it gives a lasting bonus until the Temple falls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RELIC_LIST, RELICS, RELIC_CAMP_LEVEL, getRelic } from '../../src/data/relics.js';
import { computeMods, unitMods, buildingMods } from '../../src/data/upgrades.js';
import { MORTALS, BUILDINGS, godsFor } from '../../src/data/index.js';
import { sanitizeCommand, isValidSnapshot } from '../../src/net/sanitize.js';
import { encode, apply } from '../../src/net/delta.js';
import { createWorld } from '../../src/sim/world.js';
import { makeWorld, run, runUntil, place, spawn, clearUnits, eventsOf, errorsOf, runCollect, PLAIN_PANTHEONS } from './helpers.js';

const json = (v) => JSON.parse(JSON.stringify(v));
const NEWER_EMOJI = /[\u{1FA70}-\u{1FAFF}\u{1F971}\u{1F97B}\u{1F9A5}-\u{1F9AA}\u{1F9AE}-\u{1F9AF}\u{1F9BA}-\u{1F9BF}\u{1F9C3}-\u{1F9CA}\u{1F9CD}-\u{1F9CF}\u{1F90D}-\u{1F90F}\u{1F7E0}-\u{1F7EB}\u{200D}]/u;

/** Player 0 and 1 with no units; one level-2 camp at (24, 24) and one level-1 camp. */
function arena(opts = {}) {
  const w = makeWorld({ pantheons: PLAIN_PANTHEONS, map: { camps: [{ x: 24, y: 24, level: 2 }, { x: 24, y: 40, level: 1 }] }, ...opts });
  clearUnits(w, 0);
  clearUnits(w, 1);
  w.events.length = 0;
  return w;
}

function clearCamp(w, camp, killer) {
  for (const m of camp.members) if (!m.dead) w.killEntity(m, killer);
  w.cleanup();
  w.hash.rebuild(w.unitList);
}

const relicCmd = (units, r) => ({ type: 'smart', units: units.map((u) => u.id), relic: r.i, x: r.x, y: r.y });

test('ten relics from ten myths, each with effects in the upgrade vocabulary and an Emoji 11 icon', () => {
  assert.equal(RELIC_LIST.length, 10);
  assert.equal(new Set(RELIC_LIST.map((r) => r.myth)).size, 10);
  for (const r of RELIC_LIST) {
    assert.equal(RELICS[r.id], r);
    assert.equal(getRelic(r.id), r);
    for (const f of ['name', 'icon', 'description', 'myth']) assert.ok(typeof r[f] === 'string' && r[f], `${r.id}.${f}`);
    assert.match(r.color, /^#[0-9a-f]{6}$/i);
    assert.ok(!NEWER_EMOJI.test(r.icon), `${r.id} icon`);
    assert.ok(r.effects.length > 0);
    // every effect changes something computeMods knows about
    const before = JSON.stringify(computeMods([], null));
    assert.notEqual(JSON.stringify(computeMods([], null, [r.id])), before, r.id);
  }
  assert.equal(getRelic('nope'), null);
  assert.equal(getRelic('__proto__'), null);
});

test('camps of level 2 and more guard a relic each, of different types; the draw follows the seed', () => {
  const w = arena();
  assert.equal(RELIC_CAMP_LEVEL, 2);
  assert.equal(w.relics.length, 1);
  const r = w.relics[0];
  assert.equal(r.state, 'guarded');
  assert.equal(r.camp, w.camps[0]);
  assert.deepEqual([r.x, r.y], [24, 24]);
  const a = createWorld({ ...arena().setup, seed: 77, mapSize: 'small' });
  const b = createWorld({ ...arena().setup, seed: 77, mapSize: 'small' });
  assert.deepEqual(a.relics.map((x) => x.type), b.relics.map((x) => x.type));
  assert.equal(a.relics.length, a.camps.filter((c) => c.level >= 2).length);
  assert.equal(new Set(a.relics.map((x) => x.type)).size, a.relics.length);
});

test('the last creature of the camp lets the relic fall, credited to the killer', () => {
  const w = arena();
  const r = w.relics[0];
  const camp = r.camp;
  const killer = spawn(w, 0, 'warrior', 20, 20);
  const members = camp.members.filter((m) => !m.dead);
  assert.ok(members.length >= 2);
  w.killEntity(members[0], killer);
  assert.equal(r.state, 'guarded');
  for (const m of members.slice(1)) w.killEntity(m, killer);
  assert.equal(r.state, 'ground');
  const drops = eventsOf(w.events, 'relic');
  assert.equal(drops.length, 1);
  assert.deepEqual({ ...drops[0] }, { type: 'relic', ev: 'drop', i: 0, t: r.type, player: 0, x: 24, y: 24 });
});

test('a Worshipper picks it up, walks it to the Temple, and the owner gains the bonus', () => {
  const w = arena();
  const r = w.relics[0];
  r.type = 'golden_fleece';
  clearCamp(w, r.camp, null);
  const temple = place(w, 0, 'temple', 8, 14);
  const worker = spawn(w, 0, 'worshipper', 20, 24);
  const soldier = spawn(w, 0, 'warrior', 10, 10);
  const hp0 = soldier.maxHp;
  w.issueCommand(0, relicCmd([worker], r));
  assert.ok(runUntil(w, () => r.state === 'carried', 20) > 0, 'picked up');
  assert.equal(r.carrier, worker);
  assert.equal(worker.order && worker.order.type, 'deliver', 'heads for the Temple at once');
  const ev = [];
  assert.ok(runUntil(w, () => { ev.push(...w.events); w.events.length = 0; return r.state === 'housed'; }, 40) > 0, 'housed');
  assert.equal(r.temple, temple);
  assert.equal(r.owner, 0);
  assert.deepEqual(w.players[0].relics, ['golden_fleece']);
  assert.equal(soldier.maxHp, Math.round(hp0 * 1.1), 'soldiers have 10% more health');
  assert.deepEqual(eventsOf(ev, 'relic').map((e) => e.ev), ['take', 'house']);
  const snap = w.getSnapshot();
  assert.deepEqual(snap.players[0].rl, ['golden_fleece']);
  assert.equal(snap.players[1].rl, undefined, 'omitted while a player holds none');
  assert.deepEqual(snap.relics, [{ i: 0, t: 'golden_fleece', s: 'h', b: temple.id, o: 0 }]);
});

test('a Temple that falls drops its relic beside the ruin and takes the bonus away', () => {
  const w = arena();
  const r = w.relics[0];
  r.type = 'eye_of_horus';
  clearCamp(w, r.camp, null);
  const temple = place(w, 0, 'temple', 8, 14);
  const tc = w.buildingList.find((b) => b.owner === 0 && b.type === 'town_center');
  const armor0 = tc.armor;
  const worker = spawn(w, 0, 'worshipper', 12, 18);
  r.x = 12.4;
  r.y = 18;
  w.issueCommand(0, relicCmd([worker], r));
  assert.ok(runUntil(w, () => r.state === 'housed', 30) > 0);
  assert.equal(tc.armor, armor0 + 2);
  w.events.length = 0;
  w.killEntity(temple, null);
  w.tick();
  assert.equal(r.state, 'ground');
  assert.ok(Math.abs(r.x - temple.x) < 2 && r.y > temple.ty + temple.size - 0.01, 'south of the ruin');
  assert.deepEqual(w.players[0].relics, []);
  assert.equal(tc.armor, armor0);
  assert.deepEqual(eventsOf(w.events, 'relic').map((e) => [e.ev, e.player]), [['lose', 0]]);
});

test('a carrier that dies drops the relic where it fell; an enemy god can take it', () => {
  const w = arena();
  const r = w.relics[0];
  clearCamp(w, r.camp, null);
  const worker = spawn(w, 0, 'worshipper', 23, 24);
  w.issueCommand(0, relicCmd([worker], r));
  assert.ok(runUntil(w, () => r.state === 'carried', 10) > 0);
  w.setOrder(worker, { type: 'move', x: 30, y: 24 });
  run(w, 1);
  const x = worker.x;
  w.killEntity(worker, null);
  w.tick();
  assert.equal(r.state, 'ground');
  assert.ok(Math.abs(r.x - x) < 0.6);
  const god = spawn(w, 1, godsFor('hindu')[0].id, 32, 24);
  w.issueCommand(1, relicCmd([god], r));
  assert.ok(runUntil(w, () => r.state === 'carried', 15) > 0);
  assert.equal(r.carrier, god);
  assert.equal(r.owner, 1);
  // no Temple: it stays with the god until there is one, then the idle god sets off
  run(w, 1);
  assert.equal(r.state, 'carried');
  place(w, 1, 'temple', 36, 30);
  w.setOrder(god, null);
  assert.ok(runUntil(w, () => r.state === 'housed', 30) > 0, 'an idle carrier brings it to the new Temple');
  assert.equal(r.owner, 1);
});

test('soldiers cannot carry: a smart order sends the nearest carrier and walks the rest along', () => {
  const w = arena();
  const r = w.relics[0];
  clearCamp(w, r.camp, null);
  const soldier = spawn(w, 0, 'warrior', 22, 24);
  w.issueCommand(0, relicCmd([soldier], r));
  const ev = runCollect(w, 0.1);
  assert.deepEqual(errorsOf(ev), ['Only a Worshipper or a god can carry a relic.']);
  assert.equal(soldier.order && soldier.order.type, 'move');
  const far = spawn(w, 0, 'worshipper', 10, 24);
  const near = spawn(w, 0, 'worshipper', 18, 24);
  w.issueCommand(0, relicCmd([soldier, far, near], r));
  w.tick();
  assert.equal(near.order.type, 'relic');
  assert.equal(far.order.type, 'move');
  // a guarded relic cannot be taken: the order is a plain move
  const w2 = arena();
  const g = spawn(w2, 0, 'worshipper', 15, 24);
  w2.issueCommand(0, relicCmd([g], w2.relics[0]));
  w2.tick();
  assert.equal(g.order.type, 'move');
});

test('a carrier holds one relic; smart on its own Temple delivers before praying', () => {
  const w = arena({ map: { camps: [{ x: 24, y: 24, level: 2 }, { x: 30, y: 30, level: 3 }] } });
  const [a, b] = w.relics;
  clearCamp(w, a.camp, null);
  clearCamp(w, b.camp, null);
  const worker = spawn(w, 0, 'worshipper', 24.5, 24);
  w.issueCommand(0, relicCmd([worker], a));
  assert.ok(runUntil(w, () => a.state === 'carried', 5) > 0);
  w.setOrder(worker, { type: 'relic', relic: b.i });
  run(w, 5);
  assert.equal(b.state, 'ground', 'one at a time');
  const temple = place(w, 0, 'temple', 20, 28);
  w.issueCommand(0, { type: 'smart', units: [worker.id], target: temple.id });
  w.tick();
  assert.equal(worker.order.type, 'deliver');
  assert.ok(runUntil(w, () => a.state === 'housed', 20) > 0);
});

test('the bonus of each relic reaches the sim rules', () => {
  const plain = computeMods([], 'norse');
  const m = (id) => computeMods([], 'norse', [id]);
  assert.equal(unitMods(m('golden_fleece'), MORTALS.archer).hp, 0.1);
  assert.equal(buildingMods(m('brisingamen'), 'temple').faith, 0.25);
  assert.equal(buildingMods(m('eye_of_horus'), 'house').armor, 2);
  assert.equal(unitMods(m('amrita'), godsFor('norse')[0]).regen, 1.5);
  assert.equal(unitMods(m('kusanagi'), MORTALS.warrior).damage, 0.08);
  assert.equal(unitMods(m('peaches'), MORTALS.priest).regen, 0.5);
  assert.equal(m('smoking_mirror').perks.cooldown, plain.perks.cooldown + 0.1);
  assert.deepEqual(m('dagda_cauldron').carry, { g: plain.carry.g + 2, w: plain.carry.w + 2 });
  assert.equal(m('tablet_of_destinies').perks.techSpeed, plain.perks.techSpeed + 0.2);
  assert.equal(m('anansi_stories').work, plain.work + 0.1);
  assert.ok(BUILDINGS.temple.prayerSlots > 0);
});

test('the smart command carries the relic index over the wire; snapshots with relics check out and delta-encode', () => {
  assert.deepEqual(sanitizeCommand({ type: 'smart', units: [3], relic: 2, x: 4, y: 5 }, { width: 48, height: 48 }), { type: 'smart', units: [3], x: 4, y: 5, relic: 2 });
  assert.deepEqual(sanitizeCommand({ type: 'smart', units: [3], relic: -1 }, { width: 48, height: 48 }), { type: 'smart', units: [3] });
  assert.deepEqual(sanitizeCommand({ type: 'smart', units: [3], relic: 'x' }, { width: 48, height: 48 }), { type: 'smart', units: [3] });
  const w = arena();
  const s0 = json(w.getSnapshot());
  assert.ok(isValidSnapshot(s0));
  assert.deepEqual(s0.relics, [{ i: 0, t: w.relics[0].type, s: 'k', x: 24, y: 24 }]);
  assert.equal(isValidSnapshot({ ...s0, relics: [3] }), false);
  clearCamp(w, w.relics[0].camp, null);
  const worker = spawn(w, 0, 'worshipper', 22, 24);
  w.issueCommand(0, relicCmd([worker], w.relics[0]));
  runUntil(w, () => w.relics[0].state === 'carried', 10);
  const s1 = json(w.getSnapshot());
  assert.deepEqual(s1.relics, [{ i: 0, t: w.relics[0].type, s: 'c', c: worker.id, o: 0 }]);
  assert.deepEqual(apply(s0, json(encode(s0, s1))), s1);
  w.tick();
  const s2 = json(w.getSnapshot());
  const d = json(encode(s1, s2));
  assert.ok(!d.x || !('relics' in d.x), 'a relic on the move costs nothing while its carrier walks');
});
