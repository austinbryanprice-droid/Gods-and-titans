// The daily challenge (src/game/daily.js, src/data/twists.js, DESIGN 9.3): one seeded game per day,
// the same everywhere, today's best and the streak kept on this device, and the twists the sim applies.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as lobbyMod from '../../src/net/lobby.js';
import { createWorld } from '../../src/sim/world.js';
import { START_RESOURCES, START_WORKERS } from '../../src/config.js';
import { TWISTS, TWIST_BY_ID, twistOf } from '../../src/data/twists.js';
import {
  dayKey, shiftDay, dailyChallenge, dailyLobbyState, dailyLaunch, dailyLabel, recordDaily, loadDaily, sanitizeDaily, streakOf, dailyStatus, DAILY_KEY,
} from '../../src/game/daily.js';

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

test('day keys are local calendar days and step across months and years', () => {
  assert.equal(dayKey(new Date(2026, 9, 28, 23, 59)), '2026-10-28');
  assert.equal(shiftDay('2026-10-28', -1), '2026-10-27');
  assert.equal(shiftDay('2026-11-01', -1), '2026-10-31');
  assert.equal(shiftDay('2027-01-01', -1), '2026-12-31');
  assert.equal(shiftDay('nonsense', -1), null);
});

test('a day always draws the same challenge, and the next day another', () => {
  const a = dailyChallenge('2026-10-28');
  const b = dailyChallenge('2026-10-28');
  assert.deepEqual(a, b);
  const c = dailyChallenge('2026-10-29');
  assert.ok(a.seed !== c.seed);
  assert.ok(a.seed > 0 && a.seed < 0x7fffffff);
  const all = [a.pantheon, ...a.allies, ...a.enemies];
  assert.equal(new Set(all).size, all.length, 'no pantheon twice in one challenge');
});

test('twists come round in a cycle: every twist once in each run of days, never the same two days running', () => {
  const n = TWISTS.length;
  // Any 2n - 1 days in a row hold one whole cycle, so every twist.
  let start = '2026-03-05';
  for (let w = 0; w < 10; w++) {
    const ids = new Set();
    for (let i = 0, d = start; i < 2 * n - 1; i++, d = shiftDay(d, 1)) ids.add(dailyChallenge(d).twist.id);
    assert.equal(ids.size, n);
    start = shiftDay(start, 7);
  }
  let prev = null;
  let day = '2026-01-01';
  let repeats = 0;
  for (let i = 0; i < 365; i++) {
    const id = dailyChallenge(day).twist.id;
    if (id === prev) repeats++;
    prev = id;
    day = shiftDay(day, 1);
  }
  assert.ok(repeats <= 365 / n, `at most a repeat where two cycles meet (${repeats})`);
});

test('every twist builds a valid game against the computer', () => {
  for (const tw of TWISTS) {
    // Find a day with this twist.
    let day = '2026-01-01';
    while (dailyChallenge(day).twist.id !== tw.id) day = shiftDay(day, 1);
    const launch = dailyLaunch(lobbyMod, day, 'Austin');
    assert.equal(launch.role, 'host');
    assert.equal(launch.daily, day);
    assert.equal(launch.myIndex, 0);
    const { setup } = launch;
    assert.equal(setup.players[0].name, 'Austin');
    assert.equal(setup.players[0].kind, 'human');
    assert.equal(setup.players.length, 1 + (tw.allies || 0) + (tw.enemies || ['normal']).length, tw.id);
    assert.equal(!!setup.survival, !!tw.survival, tw.id);
    assert.equal(!!setup.sacredVictory, !!tw.sacred, tw.id);
    assert.equal(setup.twist, tw.start ? tw.id : undefined, tw.id);
    if (!tw.survival) assert.ok(new Set(setup.players.map((p) => p.team)).size >= 2, `${tw.id}: two sides`);
    assert.ok(lobbyMod.sanitizeLobbyState(dailyLobbyState(dailyChallenge(day))), tw.id);
    assert.ok(dailyLabel(dailyChallenge(day)).startsWith(tw.name));
  }
});

test('the sim starts every city by the twist; other games are unchanged', () => {
  const base = dailyLaunch(lobbyMod, '2026-10-28').setup;
  const plain = createWorld({ ...base, twist: undefined });
  assert.equal(plain.players[0].gold, START_RESOURCES.gold);
  assert.equal(plain.unitsOf(0).length, START_WORKERS);
  const golden = createWorld({ ...base, twist: 'golden' });
  for (const p of golden.players) {
    assert.equal(p.gold, START_RESOURCES.gold * 3);
    assert.equal(p.wood, START_RESOURCES.wood * 3);
  }
  const humble = createWorld({ ...base, twist: 'humble' });
  assert.equal(humble.unitsOf(0).length, 2);
  assert.equal(humble.unitsOf(1).length, 2, 'the AI too');
  assert.equal(createWorld({ ...base, twist: 'crowded' }).unitsOf(0).length, 10);
  assert.equal(createWorld({ ...base, twist: 'blessed' }).players[0].faith, START_RESOURCES.faith + 350);
  assert.equal(twistOf({ twist: '__proto__' }), null);
  assert.equal(createWorld({ ...base, twist: 'toString' }).players[0].gold, START_RESOURCES.gold);
  assert.ok(TWIST_BY_ID.golden);
});

test("today's best keeps the highest score, and a streak counts days played in a row", () => {
  const store = memStore();
  let r = recordDaily('2026-10-26', 800, false, store, '2026-10-26');
  assert.equal(r.first, true);
  assert.equal(r.streak, 1);
  r = recordDaily('2026-10-27', 500, true, store, '2026-10-27');
  assert.equal(r.streak, 2);
  r = recordDaily('2026-10-27', 300, false, store, '2026-10-27');
  assert.equal(r.isNew, false);
  assert.equal(r.best, 500);
  assert.equal(r.plays, 2);
  r = recordDaily('2026-10-27', 900, false, store, '2026-10-27');
  assert.equal(r.isNew, true);
  assert.equal(r.previous, 500);
  const rec = loadDaily(store);
  assert.deepEqual(rec.days['2026-10-27'], { best: 900, plays: 3, won: true });
  // Not yet played today: yesterday's streak still stands; a skipped day ends it.
  assert.equal(streakOf(rec, '2026-10-28'), 2);
  assert.equal(streakOf(rec, '2026-10-29'), 0);
  const st = dailyStatus('2026-10-28', store);
  assert.equal(st.playedToday, false);
  assert.equal(st.streak, 2);
  assert.equal(st.challenge.day, '2026-10-28');
  assert.equal(recordDaily('2026-10-28', 10, false, store, '2026-10-28').streak, 3);
});

test('a damaged or old record is cleaned and kept short', () => {
  assert.deepEqual(sanitizeDaily(null), { days: {} });
  assert.deepEqual(sanitizeDaily({ days: { nope: { best: 1, plays: 1 }, '2026-10-01': { best: -5, plays: 2, won: 'yes' } } }), { days: { '2026-10-01': { best: 0, plays: 2, won: false } } });
  const days = {};
  for (let i = 0, d = '2026-01-01'; i < 100; i++, d = shiftDay(d, 1)) days[d] = { best: i, plays: 1 };
  const clean = sanitizeDaily({ days });
  assert.equal(Object.keys(clean.days).length, 60);
  assert.ok(!clean.days['2026-01-01'], 'the oldest days go');
  const store = memStore();
  store.setItem(DAILY_KEY, '{broken');
  assert.deepEqual(loadDaily(store), { days: {} });
  assert.deepEqual(loadDaily(null), { days: {} });
});
