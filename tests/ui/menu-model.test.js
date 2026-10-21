// Pure lobby/menu helpers (src/ui/menu-model.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/ui/menu-model.js';
import { PANTHEON_LIST } from '../../src/data/index.js';
import { PLAYER_COLORS } from '../../src/config.js';
import { versionMismatchReason } from '../../src/net/protocol.js';

const slot = (kind, extra = {}) => ({ kind, name: '', pantheon: 'random', team: 1, color: 0, difficulty: 'normal', peerId: null, ...extra });

test('cleanRoomCode accepts typed codes, lower case, spaces and invite links', () => {
  assert.equal(M.cleanRoomCode('k7qx2'), 'K7QX2');
  assert.equal(M.cleanRoomCode(' k7 qx-2 '), 'K7QX2');
  assert.equal(M.cleanRoomCode('https://x.github.io/game/?join=abcde&transport=local'), 'ABCDE');
  assert.equal(M.cleanRoomCode('ABCDEFGH'), 'ABCDE');
  assert.equal(M.cleanRoomCode('O0I1'), ''); // ambiguous characters are not in the alphabet
  assert.ok(M.isCompleteRoomCode('K7QX2'));
  assert.ok(!M.isCompleteRoomCode('K7QX'));
});

test('cleanRoomCode finds the code inside a pasted sentence instead of mixing in letters from the words', () => {
  assert.equal(M.cleanRoomCode('Join with code K7QX2'), 'K7QX2');
  assert.equal(M.cleanRoomCode('room code: K7QX2'), 'K7QX2');
  assert.equal(M.cleanRoomCode('come play K7QX2!'), 'K7QX2');
  assert.equal(M.cleanRoomCode('please K7QX2'), 'K7QX2'); // 'please' is made of valid letters too
  assert.equal(M.cleanRoomCode('hello kqxzb'), 'KQXZB');
  assert.equal(M.cleanRoomCode('K7QX2 2'), 'K7QX2');
  assert.equal(M.cleanRoomCode('k7 qx2'), 'K7QX2'); // a code typed in pieces still works
});

test('inviteLink keeps only join + network params', () => {
  const link = M.inviteLink('https://host.example/mythic/index.html?mockLobby=1&transport=local&peerHost=localhost&join=OLD#x', 'K7QX2');
  const u = new URL(link);
  assert.equal(u.pathname, '/mythic/index.html');
  assert.equal(u.searchParams.get('join'), 'K7QX2');
  assert.equal(u.searchParams.get('transport'), 'local');
  assert.equal(u.searchParams.get('peerHost'), 'localhost');
  assert.equal(u.searchParams.get('mockLobby'), null);
  assert.equal(u.hash, '');
});

test('slot kind dropdown values, options and patches', () => {
  const host = slot('host', { name: 'Austin' });
  const human = slot('human', { name: 'Sigrun' });
  const ai = slot('ai', { difficulty: 'hard' });
  assert.equal(M.slotKindValue(host, 0, 0), 'you');
  assert.equal(M.slotKindValue(human, 1, 0), 'human');
  assert.equal(M.slotKindValue(ai, 2, 0), 'ai:hard');
  assert.equal(M.slotKindValue(slot('open'), 3, 0), 'open');
  assert.equal(M.slotKindValue(slot('closed'), 3, 0), 'closed');
  const online = M.slotKindOptions(human, 1, { myIndex: 0, online: true }).map((o) => o.value);
  assert.deepEqual(online, ['human', 'open', 'ai:easy', 'ai:normal', 'ai:hard', 'closed']);
  const offline = M.slotKindOptions(ai, 1, { myIndex: 0, online: false }).map((o) => o.value);
  assert.deepEqual(offline, ['ai:easy', 'ai:normal', 'ai:hard', 'closed']); // nobody can join a local game
  assert.deepEqual(M.kindPatch('ai:easy'), { kind: 'ai', difficulty: 'easy' });
  assert.deepEqual(M.kindPatch('open'), { kind: 'open' });
  assert.deepEqual(M.kindPatch('closed'), { kind: 'closed' });
  assert.equal(M.kindPatch('human'), null);
  assert.equal(M.kindPatch('you'), null);
});

test('colors: taken / blocked sets and CSS color', () => {
  const state = { slots: [slot('host', { color: 0 }), slot('ai', { color: 1 }), slot('human', { color: 2 }), slot('open', { color: 3 })] };
  assert.deepEqual([...M.takenColors(state, 0)].sort(), [1, 2]);
  assert.deepEqual([...M.blockedColors(state, 0, true)].sort(), [2]); // host may swap with an AI
  assert.deepEqual([...M.blockedColors(state, 2, false)].sort(), [0, 1]);
  assert.equal(M.slotColor(state.slots[2]), PLAYER_COLORS[2]);
});

test('startStatus prefers startProblem(), falls back to canStart()', () => {
  assert.deepEqual(M.startStatus({ startProblem: () => null }), { ok: true, reason: null });
  assert.deepEqual(M.startStatus({ startProblem: () => 'Waiting for Bob to connect.' }), { ok: false, reason: 'Waiting for Bob to connect.' });
  const sameTeam = { state: { slots: [slot('host', { team: 1 }), slot('ai', { team: 1 })] }, canStart: () => false };
  const st = M.startStatus(sameTeam);
  assert.equal(st.ok, false);
  assert.match(st.reason, /same team/);
  assert.deepEqual(M.startStatus({ canStart: () => ({ ok: false, reason: 'nope' }) }), { ok: false, reason: 'nope' });
  assert.equal(M.startStatus({ canStart: () => true }).ok, true);
  assert.equal(M.startStatus({ canStart: () => { throw new Error('boom'); } }).reason, 'boom');
  const alone = { slots: [slot('host'), slot('open'), slot('closed'), slot('closed')] };
  assert.match(M.startBlockReason(alone), /opponent/);
});

test('startStatus says nobody has joined yet instead of quoting the team rule', () => {
  const teams = 'Players must be on at least two different teams.';
  const lone = { state: { slots: [slot('host'), slot('open', { team: 2 }), slot('closed'), slot('closed')] }, startProblem: () => teams };
  assert.match(M.startStatus(lone, { online: true }).reason, /friend to join/);
  assert.match(M.startStatus(lone, { online: false }).reason, /slot to AI/);
  // two players on one team keep the lobby's own wording
  const same = { state: { slots: [slot('host'), slot('ai'), slot('closed'), slot('closed')] }, startProblem: () => teams };
  assert.equal(M.startStatus(same, { online: true }).reason, teams);
  // other problems are never replaced
  const waiting = { state: lone.state, startProblem: () => 'Waiting for Bob to connect.' };
  assert.equal(M.startStatus(waiting, { online: true }).reason, 'Waiting for Bob to connect.');
});

test('matchup summary groups filled slots by team', () => {
  const state = { slots: [slot('host', { name: 'A', team: 2 }), slot('ai', { team: 1, difficulty: 'easy', color: 3 }), slot('open'), slot('human', { name: 'B', team: 2, color: 1 })] };
  const sum = M.matchupSummary(state);
  assert.deepEqual(sum.map((t) => t.team), [1, 2]);
  assert.deepEqual(sum[0].names, ['AI (Easy)']);
  assert.deepEqual(sum[1].names, ['A', 'B']);
  assert.equal(sum[1].colors[1], PLAYER_COLORS[1]);
});

test('normalizeChat understands the lobby line shape and plain arguments', () => {
  assert.deepEqual(M.normalizeChat({ from: 0, name: 'Austin', text: 'hi', system: false }), { from: 'Austin', text: 'hi', system: false });
  assert.deepEqual(M.normalizeChat({ from: -1, name: '', text: 'Bob joined the lobby.', system: true }), { from: null, text: 'Bob joined the lobby.', system: true });
  assert.deepEqual(M.normalizeChat({ from: 'Zed', text: 'yo' }), { from: 'Zed', text: 'yo', system: false });
  assert.deepEqual(M.normalizeChat('Zed', 'yo'), { from: 'Zed', text: 'yo', system: false });
  assert.deepEqual(M.normalizeChat('just text'), { from: null, text: 'just text', system: true });
});

test('oneLine trims long descriptions to a sentence or clause', () => {
  assert.equal(M.oneLine('Short. Second sentence.'), 'Short.');
  const long = 'Thunder-wielding king of the gods, who rules sky and storm from the summit of Mount Olympus and hurls bolts at those who defy him, forever and ever.';
  const line = M.oneLine(long, 60);
  assert.ok(line.length <= 61, line);
  assert.ok(line.endsWith('…'));
});

test('every pantheon has an emblem, a summary with 4 gods, a titan and 3 creatures, and header colors', () => {
  for (const p of PANTHEON_LIST) {
    const s = M.pantheonSummary(p);
    assert.ok(M.PANTHEON_EMBLEMS[p.id], p.id);
    assert.equal(s.gods.length, 4);
    assert.ok(s.titan && s.titan.name);
    assert.equal(s.creatures.length, 3);
    for (const g of s.gods) {
      assert.ok(g.icon && g.name && g.line, `${p.id} ${g.id}`);
    }
    assert.equal(s.head.length, 2);
    for (const c of s.head) assert.match(c, /^#[0-9a-f]{6}$/i);
  }
});

test('every pantheon summary carries its identity: tagline, playstyle, two blessings and the elite soldier', () => {
  const taglines = new Set();
  for (const p of PANTHEON_LIST) {
    const s = M.pantheonSummary(p);
    assert.equal(s.tagline, p.identity.tagline);
    assert.equal(s.playstyle, p.identity.playstyle);
    taglines.add(s.tagline);
    assert.equal(s.blessings.length, 2, p.id);
    for (const b of s.blessings) assert.ok(b.id.startsWith(`${p.id}_`) && b.icon && b.name && b.description, `${p.id} ${b.id}`);
    assert.equal(s.elite.id, p.elite.id);
    assert.ok(s.elite.icon && s.elite.name && s.elite.line, p.id);
  }
  assert.equal(taglines.size, PANTHEON_LIST.length, 'every pantheon says something different');
  // a pantheon without an identity still summarizes (older saves, test fixtures)
  const bare = M.pantheonSummary({ ...PANTHEON_LIST[0], identity: undefined, elite: undefined });
  assert.deepEqual([bare.tagline, bare.playstyle, bare.blessings, bare.elite], ['', '', [], null]);
});

test('friendlyJoinError turns the lobby version-mismatch reason (with build fingerprints) into plain words', () => {
  const reason = versionMismatchReason('0.1.0+1a2b3c4d', '0.1.0+9f8e7d6c');
  const msg = M.friendlyJoinError(new Error(reason), 'ABCDE');
  assert.equal(msg, 'You and the host are running different versions of the game. Reload this page (Ctrl+F5) and try again.');
  assert.doesNotMatch(msg, /1a2b3c4d|9f8e7d6c|0\.1\.0/);
});

test('friendlyJoinError maps transport errors to clear messages', () => {
  assert.match(M.friendlyJoinError(new Error('Room ABCDE was not found. Check the code.'), 'ABCDE'), /^Room not found/);
  assert.match(M.friendlyJoinError(new Error('Room ABCDE was not found in this browser.'), 'ABCDE'), /^Room not found/);
  assert.match(M.friendlyJoinError(new Error('Version mismatch: the host runs v0.1.0 but you have v0.0.9.')), /different versions of the game/);
  assert.equal(M.friendlyJoinError(new Error('The game is full.')), 'That game is full. Ask the host to open a slot.');
  assert.match(M.friendlyJoinError('The host did not answer. Check the room code and try again.'), /did not answer/);
  assert.match(M.friendlyJoinError(null), /Could not join/);
});
