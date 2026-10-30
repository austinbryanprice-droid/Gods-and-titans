// Play Again and Quick Match (src/game/rematch.js): which games count as against the computer only,
// remembering their lobby, and starting it anew with a fresh seed.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as lobbyMod from '../../src/net/lobby.js';
import { isSoloLaunch, cleanSkirmish, saveSkirmish, loadSkirmish, launchFrom, skirmishLabel, stepUpSkirmish, LAST_SKIRMISH_KEY } from '../../src/game/rematch.js';

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m };
}

function soloState(over = {}) {
  return {
    roomCode: 'ABCD', mapSize: 'small', peace: 0, sacred: false, started: true,
    slots: [
      { kind: 'host', name: 'Austin', pantheon: 'greek', team: 1, color: 0, difficulty: 'normal', peerId: 'me' },
      { kind: 'ai', name: '', pantheon: 'random', team: 2, color: 1, difficulty: 'hard', peerId: null },
      { kind: 'closed', team: 3, color: 2 },
      { kind: 'closed', team: 4, color: 3 },
    ],
    ...over,
  };
}

test('only a hosted game with nobody but AI players counts as solo', () => {
  const setup = { players: [{ index: 0, kind: 'human' }, { index: 1, kind: 'ai' }] };
  assert.equal(isSoloLaunch({ role: 'host', setup, myIndex: 0, conns: new Map() }), true);
  assert.equal(isSoloLaunch({ role: 'client', setup, myIndex: 0 }), false);
  assert.equal(isSoloLaunch({ role: 'host', setup, myIndex: 0, conns: new Map([[1, {}]]) }), false, 'a friend is connected');
  assert.equal(isSoloLaunch({ role: 'host', setup: { players: [...setup.players, { index: 2, kind: 'human' }] }, myIndex: 0, conns: new Map() }), false);
  assert.equal(isSoloLaunch(null), false);
});

test('a remembered lobby comes back cleaned; a broken or online one does not', () => {
  const store = memStore();
  assert.equal(saveSkirmish(lobbyMod, soloState(), store), true);
  const back = loadSkirmish(lobbyMod, store);
  assert.equal(back.roomCode, null);
  assert.equal(back.started, false);
  assert.equal(back.slots[0].peerId, null);
  assert.equal(back.slots[1].difficulty, 'hard');
  store.setItem(LAST_SKIRMISH_KEY, '{nope');
  assert.equal(loadSkirmish(lobbyMod, store), null, 'unreadable');
  const withFriend = soloState();
  withFriend.slots[2] = { kind: 'human', name: 'Friend', pantheon: 'random', team: 2, color: 2 };
  assert.equal(cleanSkirmish(lobbyMod, withFriend), null, 'online games are not replayed');
  const oneTeam = soloState();
  oneTeam.slots[1].team = 1;
  assert.equal(cleanSkirmish(lobbyMod, oneTeam), null, 'nobody to fight');
  assert.equal(loadSkirmish(lobbyMod, null), null, 'no storage');
});

test('a launch from a lobby: fresh seed, my slot renamed, a valid setup with its map hash', () => {
  const a = launchFrom(lobbyMod, soloState({ peace: 30 }), 'Zeus fan', 11);
  const b = launchFrom(lobbyMod, soloState({ peace: 30 }), 'Zeus fan', 22);
  assert.equal(a.role, 'host');
  assert.equal(a.myIndex, 0);
  assert.equal(a.conns.size, 0);
  assert.equal(a.setup.players[0].name, 'Zeus fan');
  assert.equal(a.setup.players[1].kind, 'ai');
  assert.equal(a.setup.players[1].difficulty, 'hard');
  assert.equal(a.setup.peaceMinutes, 30);
  assert.equal(a.setup.seed, 11);
  assert.notEqual(a.setup.mapHash, b.setup.mapHash, 'a new seed is a new map');
  assert.equal(isSoloLaunch(a), true, 'Play Again works again from a Quick Match');
  assert.equal(launchFrom(lobbyMod, { slots: [] }, 'x'), null);
});

test('the Quick Match label says who fights whom, where and how', () => {
  assert.equal(skirmishLabel(cleanSkirmish(lobbyMod, soloState())), '1 vs 1 · Hard AI · small map');
  const big = soloState({ mapSize: 'medium', peace: 45, sacred: true });
  big.slots[2] = { kind: 'ai', pantheon: 'random', team: 1, color: 2, difficulty: 'normal' };
  big.slots[3] = { kind: 'ai', pantheon: 'random', team: 2, color: 3, difficulty: 'normal' };
  assert.equal(skirmishLabel(cleanSkirmish(lobbyMod, big)), '2 vs 2 · Hard / Normal AI · medium map · Decade of Peace 45 min · Sacred Victory');
  assert.equal(skirmishLabel(null), '');
});

test('a Trial of the Titans is replayed too, with everyone on one side', () => {
  const trial = soloState({ survival: true });
  trial.slots[1].team = 1;
  const st = cleanSkirmish(lobbyMod, trial);
  assert.ok(st, 'one team is fine in a trial');
  assert.equal(skirmishLabel(st), 'Trial of the Titans · 2 players · small map');
  const launch = launchFrom(lobbyMod, st, 'Me', 5);
  assert.equal(launch.setup.survival, true);
});

test('Ready for Normal?: a game against Easy computer players only steps up to the same lobby on Normal', () => {
  const easy = (name = 'AI (Easy)') => ({ kind: 'ai', name, pantheon: 'random', team: 2, color: 1, difficulty: 'easy', peerId: null });
  const host = soloState().slots[0];
  const st = soloState({ slots: [host, easy(), { ...easy('Hera'), team: 3, color: 2 }, { kind: 'closed', team: 4, color: 3 }] });
  const up = stepUpSkirmish(st);
  assert.deepEqual(up.slots.filter((s) => s.kind === 'ai').map((s) => [s.name, s.difficulty]), [['AI (Normal)', 'normal'], ['Hera', 'normal']]);
  assert.deepEqual(up.slots[0], host, 'the player keeps their slot');
  assert.equal(st.slots[1].difficulty, 'easy', 'the remembered lobby is not changed');
  const launch = launchFrom(lobbyMod, up, 'Austin', 7);
  assert.deepEqual(launch.setup.players.filter((p) => p.kind === 'ai').map((p) => p.difficulty), ['normal', 'normal']);
  const unnamed = stepUpSkirmish(soloState({ slots: [host, easy(''), { kind: 'closed', team: 4, color: 3 }] }));
  assert.equal(unnamed.slots[1].name, 'AI (Normal)', 'the default name follows the difficulty field, not a fixed string');
  const names = launchFrom(lobbyMod, up, 'Austin', 7).setup.players.filter((p) => p.kind === 'ai').map((p) => p.name);
  assert.match(names[0], / \(Normal AI\)$/, 'in the game the stepped-up AI plays under a figure on Normal');
  assert.equal(names[1], 'Hera');
  assert.equal(stepUpSkirmish(soloState()), null, 'a Hard AI: no step up');
  assert.equal(stepUpSkirmish(soloState({ slots: [host, easy(), { ...easy(), team: 3, difficulty: 'normal' }] })), null, 'not Easy only');
  assert.equal(stepUpSkirmish(soloState({ survival: true, slots: [host, easy()] })), null, 'not a Trial of the Titans');
  assert.equal(stepUpSkirmish(null), null);
});
