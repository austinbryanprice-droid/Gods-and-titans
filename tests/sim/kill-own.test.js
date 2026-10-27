// The kill command (DESIGN 6.2), behind the Delete key: a player's own units die the way they do in a
// fight but with no killer, so nobody earns credit, experience or spoils.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MORTALS, godsFor } from '../../src/data/index.js';
import { sanitizeCommand } from '../../src/net/sanitize.js';
import { makeWorld, place, spawn, clearUnits, eventsOf, PLAIN_PANTHEONS } from './helpers.js';

function arena(opts = {}) {
  const w = makeWorld({ pantheons: PLAIN_PANTHEONS, ...opts });
  clearUnits(w, 0);
  clearUnits(w, 1);
  w.events.length = 0;
  return w;
}

const ids = (list) => list.map((u) => u.id);

test('kill destroys the listed own units on the next tick: a death each, population freed, a loss counted', () => {
  const w = arena();
  const doomed = [0, 1, 2].map((i) => spawn(w, 0, 'warrior', 20 + i, 20));
  const kept = spawn(w, 0, 'warrior', 20, 24);
  const pop = w.players[0].popUsed;
  assert.equal(pop, 4 * MORTALS.warrior.pop);
  w.issueCommand(0, { type: 'kill', units: ids(doomed) });
  assert.ok(doomed.every((u) => !u.dead), 'queued: it is applied at the start of the next tick');
  w.tick();
  assert.ok(doomed.every((u) => u.dead && !w.entities.has(u.id)));
  assert.ok(!kept.dead && w.entities.has(kept.id));
  const deaths = eventsOf(w.events, 'death');
  assert.deepEqual(deaths.map((e) => e.id).sort(), ids(doomed).sort(), 'each one dies with the event the renderer plays the death from');
  for (const e of deaths) assert.deepEqual([e.t, e.o, e.k], ['warrior', 0, 'u']);
  assert.equal(w.players[0].popUsed, pop - 3 * MORTALS.warrior.pop, 'their population is free again at once');
  assert.equal(w.players[0].stats.losses, 3);
});

test('nobody gets credit: no kill, no experience for a god nearby, no plunder', () => {
  const w = arena({ pantheons: ['hindu', 'norse'] }); // the Norse pay plunder for every enemy killed
  const enemyGod = spawn(w, 1, godsFor('norse')[0].id, 23, 20);
  const soldier = spawn(w, 1, 'warrior', 23, 21);
  const gold = w.players[1].gold;
  const victim = spawn(w, 0, 'warrior', 21, 20);
  w.issueCommand(0, { type: 'kill', units: [victim.id] });
  w.tick();
  assert.ok(victim.dead);
  assert.equal(enemyGod.xp, 0);
  assert.equal(soldier.xp, 0);
  assert.equal(w.players[1].stats.kills, 0);
  assert.equal(w.players[1].gold, gold);
  assert.deepEqual(eventsOf(w.events, 'bounty'), []);

  // The same warrior killed by that soldier does pay all three.
  const other = spawn(w, 0, 'warrior', 21, 21);
  w.killEntity(other, soldier);
  assert.ok(enemyGod.xp > 0 && soldier.xp > 0, 'experience');
  assert.equal(w.players[1].stats.kills, 1);
  assert.ok(w.players[1].gold > gold, 'plunder');
});

test('only the issuing player\'s living units die: enemy and allied units, buildings, mines, duplicates and junk are skipped', () => {
  const w = arena({ players: 3, teams: [1, 1, 2] });
  const own = spawn(w, 0, 'warrior', 20, 20);
  const ally = spawn(w, 1, 'warrior', 22, 20);
  const enemy = spawn(w, 2, 'warrior', 24, 20);
  const house = place(w, 0, 'house', 14, 14);
  const mine = w.mineList[0];
  w.issueCommand(0, { type: 'kill', units: [ally.id, enemy.id, house.id, mine.id, 99999, -4, 'x', null, own.id, own.id] });
  w.tick();
  assert.ok(own.dead);
  for (const e of [ally, enemy, house, mine]) assert.ok(!e.dead, `${e.kind} ${e.id} is not the player's unit`);

  for (const bad of [{ type: 'kill' }, { type: 'kill', units: 'all' }, { type: 'kill', units: [] }, { type: 'kill', units: { length: 1e9 } }]) w.issueCommand(0, bad);
  w.tick();
  assert.ok(!ally.dead && !enemy.dead);
  assert.equal(w.perf.commandErrors, 0);
});

test('a god destroyed this way falls like any other: its level and experience are kept to revive it', () => {
  const w = arena();
  const zeus = godsFor(w.players[0].pantheon)[0];
  const god = spawn(w, 0, zeus.id, 20, 20, { level: 3, xp: 120 });
  w.issueCommand(0, { type: 'kill', units: [god.id] });
  w.tick();
  assert.ok(god.dead);
  assert.deepEqual(w.players[0].fallen[zeus.id], { level: 3, xp: 120 });
  assert.deepEqual(eventsOf(w.events, 'death').map((e) => e.t), [zeus.id]);
  assert.equal(w.players[0].popUsed, 0);
});

test('a worker with a paid order is cleaned up as in a fight: the building is refunded and the prayer slot freed', () => {
  const w = arena();
  Object.assign(w.players[0], { gold: 1000, wood: 1000 });
  const builder = spawn(w, 0, 'worshipper', 10, 30);
  const spot = w.findPlacement(0, 'house', 30, 30);
  w.issueCommand(0, { type: 'build', units: [builder.id], building: 'house', tx: spot.tx, ty: spot.ty });
  w.tick();
  assert.ok(w.players[0].gold < 1000, 'the House is paid for when it is ordered');
  w.issueCommand(0, { type: 'kill', units: [builder.id] });
  w.tick();
  assert.ok(builder.dead);
  assert.equal(w.players[0].gold, 1000);
  assert.equal(w.players[0].wood, 1000);

  const shrine = place(w, 0, 'shrine', 12, 12);
  const pilgrim = spawn(w, 0, 'worshipper', 14, 18);
  w.issueCommand(0, { type: 'pray', units: [pilgrim.id], target: shrine.id });
  w.tick();
  assert.ok(shrine.prayers.includes(pilgrim.id), 'it holds a prayer slot');
  w.issueCommand(0, { type: 'kill', units: [pilgrim.id] });
  w.tick();
  assert.ok(!shrine.prayers.includes(pilgrim.id), 'the slot is free for the next worshipper');
});

test('it works during a Decade of Peace and is refused once the game is over', () => {
  const w = arena({ peaceMinutes: 30 });
  assert.ok(w.peace);
  const a = spawn(w, 0, 'warrior', 20, 20);
  const b = spawn(w, 0, 'warrior', 22, 20);
  w.issueCommand(0, { type: 'kill', units: [a.id] });
  w.tick();
  assert.ok(a.dead, 'a player may always dismiss their own units');
  w.gameOver = { winningTeam: 2 };
  w.issueCommand(0, { type: 'kill', units: [b.id] });
  w.tick();
  assert.ok(!b.dead);
});

test('over the wire the sanitizer keeps distinct unit ids and nothing else, and needs a list', () => {
  const bounds = { width: 48, height: 48 };
  assert.deepEqual(sanitizeCommand({ type: 'kill', units: [3, 3, -1, '7', 8], x: 5, evil: { a: 1 }, player: 1 }, bounds), { type: 'kill', units: [3, 8] });
  assert.equal(sanitizeCommand({ type: 'kill' }, bounds), null);
  assert.equal(sanitizeCommand({ type: 'kill', units: 'all' }, bounds), null);
  const w = arena();
  const u = spawn(w, 0, 'warrior', 20, 20);
  w.issueCommand(0, sanitizeCommand({ type: 'kill', units: [u.id, u.id, 'x'] }, bounds));
  w.tick();
  assert.ok(u.dead);
});
