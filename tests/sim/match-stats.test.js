// Match statistics behind the after-game chronicle (DESIGN 5.11): resources split by kind,
// faith earned, the worth of what was destroyed and lost, razed buildings and army size.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, spawn, place, run } from './helpers.js';
import { getUnitType, BUILDINGS } from '../../src/data/index.js';
import { costValue, newStats, scoreOf } from '../../src/data/score.js';
import { deposit } from '../../src/sim/economy.js';

test('a deposit counts gold and wood apart and in gathered', () => {
  const w = makeWorld();
  const u = spawn(w, 0, 'worshipper', 10, 10);
  u.carry = 'g';
  u.carryAmount = 10;
  deposit(w, u);
  u.carry = 'w';
  u.carryAmount = 7;
  deposit(w, u);
  const st = w.getSnapshot().players[0].stats;
  assert.equal(st.gold, 10);
  assert.equal(st.wood, 7);
  assert.equal(st.gathered, 17);
});

test('killing a unit adds its worth to the killer and to the loser', () => {
  const w = makeWorld();
  const victim = spawn(w, 1, 'warrior', 20, 20);
  const killer = spawn(w, 0, 'warrior', 21, 20);
  w.killEntity(victim, killer);
  run(w, 0.1);
  const [a, b] = w.getSnapshot().players;
  const worth = costValue(getUnitType('warrior'));
  assert.ok(worth > 0);
  assert.equal(a.stats.killValue, worth);
  assert.equal(b.stats.lostValue, worth);
  assert.equal(a.stats.razed, 0);
});

test('a finished enemy building destroyed counts as razed; one never finished does not', () => {
  const w = makeWorld();
  const killer = spawn(w, 0, 'warrior', 30, 30);
  const house = place(w, 1, 'house', 30, 32);
  const site = place(w, 1, 'house', 34, 32, false);
  w.killEntity(house, killer);
  w.killEntity(site, killer);
  run(w, 0.1);
  const [a, b] = w.getSnapshot().players;
  assert.equal(a.stats.razed, 1);
  assert.equal(a.stats.killValue, costValue(BUILDINGS.house));
  assert.equal(b.stats.lostValue, costValue(BUILDINGS.house));
});

test('army counts the population of fighting units, not worshippers', () => {
  const w = makeWorld();
  const before = w.getSnapshot().players[0].stats.army;
  assert.equal(before, 0, 'five start worshippers are no army');
  spawn(w, 0, 'warrior', 20, 20);
  spawn(w, 0, 'archer', 21, 20);
  const pop = getUnitType('warrior').pop + getUnitType('archer').pop;
  assert.equal(w.getSnapshot().players[0].stats.army, pop);
});

test('prayer faith is counted as faith earned, in whole points in the snapshot', () => {
  const w = makeWorld();
  w.players[0].stats.faith = 12.6;
  assert.equal(w.getSnapshot().players[0].stats.faith, 12);
});

test('score: economy, military and civilization parts', () => {
  const st = { ...newStats(), gathered: 1000, faith: 200, killValue: 500 };
  const s = scoreOf({ stats: st, tier: 3, up: ['a', 'b'] });
  assert.equal(s.economy, 120);
  assert.equal(s.military, 100);
  assert.equal(s.civ, 250);
  assert.equal(s.total, 470);
  assert.deepEqual(scoreOf(null), { economy: 0, military: 0, civ: 0, total: 0 });
});
