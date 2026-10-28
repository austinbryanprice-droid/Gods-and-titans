// Trial of the Titans across the lobby and the wire (DESIGN 5.11, 7): the lobby's mode switch,
// the GameSetup it builds (one team, no opponent needed), validateSetup, and the wave events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LobbyHost, buildSetup, sanitizeLobbyState } from '../../src/net/lobby.js';
import { validateSetup } from '../../src/net/sanitize.js';
import { encode, apply } from '../../src/net/delta.js';
import { PLAYER_COLORS } from '../../src/config.js';

const json = (v) => JSON.parse(JSON.stringify(v));

const slots = [
  { kind: 'host', name: 'A', pantheon: 'greek', team: 1, color: 0, difficulty: 'normal' },
  { kind: 'ai', name: '', pantheon: 'norse', team: 2, color: 1, difficulty: 'hard' },
  { kind: 'closed', name: '', pantheon: 'random', team: 3, color: 2, difficulty: 'normal' },
  { kind: 'closed', name: '', pantheon: 'random', team: 4, color: 3, difficulty: 'normal' },
];

test('a survival lobby builds a setup with every player on team 1 and no peace', () => {
  const { setup } = buildSetup({ mapSize: 'small', slots, survival: true }, 7);
  assert.equal(setup.survival, true);
  assert.deepEqual(setup.players.map((p) => p.team), [1, 1]);
  assert.equal('peaceMinutes' in setup, false);
  const plain = buildSetup({ mapSize: 'small', slots }, 7).setup;
  assert.equal('survival' in plain, false, 'a normal game keeps its old shape');
  assert.deepEqual(plain.players.map((p) => p.team), [1, 2]);
  const both = buildSetup({ mapSize: 'small', slots, survival: true, peace: 30 }, 7).setup;
  assert.equal(both.peaceMinutes, 30, 'a peace wins over a stray survival flag');
  assert.equal('survival' in both, false);
  assert.equal(sanitizeLobbyState({ slots, mapSize: 'small', survival: true }).survival, true);
  for (const bad of [1, 'yes', null, undefined]) assert.equal(sanitizeLobbyState({ slots, mapSize: 'small', survival: bad }).survival, false);
});

test('the host switches between the three modes, and a lone host can start the trial', async () => {
  const host = await LobbyHost.create({ transport: 'none', name: 'Austin' });
  for (let i = 1; i < 4; i++) host.setSlot(i, { kind: 'closed' });
  assert.ok(host.startProblem(), 'a normal game needs an opponent');
  assert.ok(host.setPeace(45));
  assert.ok(host.setSurvival(true));
  assert.equal(host.state.survival, true);
  assert.equal(host.state.peace, 0, 'one mode at a time');
  assert.equal(host.setSurvival(true), false, 'no change');
  assert.equal(host.startProblem(), null, 'the trial needs nobody else');
  assert.ok(host.setPeace(30), 'picking the peace turns the trial off');
  assert.equal(host.state.survival, false);
  assert.ok(host.setSurvival(true));
  assert.ok(host.setPeace(0), 'Standard turns it off too');
  assert.equal(host.state.survival, false);
  assert.ok(host.setSurvival(true));
  const res = host.start();
  assert.equal(res.setup.survival, true);
  assert.equal(res.setup.players.length, 1);
  assert.equal(host.setSurvival(false), false, 'too late once started');
  host.close();
});

test('validateSetup keeps the survival flag only when it is exactly true, and never beside a peace', () => {
  const players = [0, 1].map((i) => ({ index: i, name: `P${i}`, team: 1, pantheon: 'greek', color: PLAYER_COLORS[i], kind: 'human', difficulty: null }));
  const setup = { version: '0.1.0', seed: 123, mapSize: 'small', players, survival: true };
  assert.equal(validateSetup(json(setup), 0).setup.survival, true);
  for (const bad of [1, 'true', {}, null]) assert.equal('survival' in validateSetup(json({ ...setup, survival: bad }), 0).setup, false, String(bad));
  const both = validateSetup(json({ ...setup, peaceMinutes: 30 }), 0).setup;
  assert.equal(both.peaceMinutes, 30);
  assert.equal('survival' in both, false);
});

test('wave events travel packed, and the trial record rides the snapshot', () => {
  const a = { tick: 0, time: 0, players: [], entities: [], fields: [], reveals: [], events: [], felled: [], gameOver: null, sv: { w: 4, m: 2 } };
  const b = {
    ...a,
    tick: a.tick + 1,
    events: [{ type: 'wave', n: 5, count: 9, boss: 'greek_kronos', x: 3, y: 48 }, { type: 'waveCleared', n: 4, gold: 120 }],
    sv: { w: 5, m: 9 },
    gameOver: { winningTeam: null, wave: 5 },
  };
  const d = encode(a, b);
  assert.ok(Array.isArray(d.e[0]) && Array.isArray(d.e[1]), 'both packed');
  const back = apply(a, json(d));
  assert.deepStrictEqual(back.events, b.events);
  assert.deepStrictEqual(back.sv, b.sv);
  assert.deepStrictEqual(back.gameOver, b.gameOver);
});
