// The match chronicle (src/game/chronicle.js): samples every 30 s of game time, a last sample
// at the game's end, the largest army, and the awards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chronicle, SAMPLE_EVERY, awardsFor } from '../../src/game/chronicle.js';
import { scoreOf } from '../../src/data/score.js';

const player = (i, stats = {}, extra = {}) => ({ i, team: i + 1, tier: 1, up: [], stats: { gathered: 0, faith: 0, kills: 0, army: 0, ...stats }, ...extra });

test('samples at the start, then once per 30 s of game time, and once more at the end', () => {
  const c = new Chronicle();
  const view = (time, army, over = false) => ({ time, players: [player(0, { army, gathered: time * 10 }), player(1)], gameOver: over ? { winningTeam: 1 } : null });
  for (let t = 0; t <= 95; t += 0.5) c.observe(view(t, Math.round(t)));
  assert.deepEqual(c.samples.map((s) => s.t), [0, 30, 60, 90]);
  assert.equal(c.samples[1].p[0].army, 30);
  assert.equal(c.samples[1].p[0].res, 300);
  assert.equal(c.samples[1].p[0].score, scoreOf(player(0, { gathered: 300 })).total);
  c.observe(view(97, 10, true));
  assert.equal(c.samples.at(-1).t, 97, 'the end is written down');
  assert.equal(c.peakArmy[0], 95, 'the largest army seen, not only the sampled ones');
  c.observe(view(120, 1, true));
  assert.equal(c.samples.length, 5, 'nothing after the end');
  assert.deepEqual(c.series('army', 0).map((q) => q[0]), [0, 30, 60, 90, 97]);
  assert.equal(SAMPLE_EVERY, 30);
});

test('attach listens to the view state snapshots and dispose stops', () => {
  const listeners = new Set();
  const vs = { time: 0, players: [player(0)], gameOver: null, on: (type, cb) => { assert.equal(type, 'snapshot'); listeners.add(cb); return () => listeners.delete(cb); } };
  const c = new Chronicle({ viewState: vs }).attach();
  for (const cb of listeners) cb();
  assert.equal(c.samples.length, 1);
  c.dispose();
  assert.equal(listeners.size, 0);
});

test('awards go to the best player, shared on a tie, and only for something real', () => {
  const players = [
    player(0, { kills: 12, gathered: 900, buildings: 5, razed: 2, killValue: 800, lostValue: 300 }),
    player(1, { kills: 4, gathered: 1500, buildings: 5, faith: 40, killValue: 100, lostValue: 900 }),
  ];
  const got = Object.fromEntries(awardsFor(players, [20, 8]).map((a) => [a.id, a]));
  assert.deepEqual(got.warlord.winners, [0]);
  assert.equal(got.warlord.value, 12);
  assert.deepEqual(got.treasurer.winners, [1]);
  assert.deepEqual(got.conqueror.winners, [0]);
  assert.deepEqual(got.tactician.winners, [0]);
  assert.deepEqual(got.marshal.winners, [0]);
  assert.deepEqual(got.prophet.winners, [1]);
  assert.equal(got.architect, undefined, 'a tie between everyone is no award');
  assert.deepEqual(awardsFor([player(0, { kills: 3 })]), [], 'no awards in a match of one');
  assert.deepEqual(awardsFor([player(0), player(1)]), [], 'nothing done, nothing earned');
});
