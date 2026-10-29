// A new player's first games against the computer (DESIGN 9): Play vs AI starts its AI players on Easy until
// this device's career has a win against the computer, then on Normal; the lobby marks Easy as suggested
// meanwhile (src/ui/menu-model.js, src/net/lobby.js aiDifficulty, src/game/career.js hasBeatenComputer).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../src/ui/menu-model.js';
import { LobbyHost } from '../../src/net/lobby.js';
import { getCareer, recordMatch, resetCareer, sanitizeCareer, hasBeatenComputer } from '../../src/game/career.js';

const slot = (kind, extra = {}) => ({ kind, name: '', pantheon: 'random', team: 1, color: 0, difficulty: 'normal', peerId: null, ...extra });
const aiLevels = (lobby) => lobby.state.slots.filter((s) => s.kind === 'ai').map((s) => s.difficulty);

/** A finished match as the career tracker hands it over. */
function match(over = {}) {
  return {
    result: 'victory', pantheon: 'greek', time: 600, kills: 0, gathered: 0, godsSummoned: 0, maxGodsAtOnce: 0,
    maxGodLevel: 0, titanSummoned: false, enemyTitansFallen: 0, maxRank: 0, losses: 0, buildingsLost: 0, maxTier: 1,
    manor: false, stoneWall: false, enemies: [{ kind: 'ai', difficulty: 'easy' }], teamSize: 1, peace: false, ...over,
  };
}

beforeEach(() => resetCareer({}));

test('the default difficulty: Easy before the first win against the computer, Normal after', () => {
  assert.equal(M.defaultAiDifficulty(hasBeatenComputer()), 'easy', 'a new career');
  recordMatch(match({ result: 'defeat' }));
  recordMatch(match({ enemies: [{ kind: 'human', difficulty: null }] }));
  assert.equal(getCareer().aiWins, 0, 'a loss to the AI and a win over a human do not count');
  assert.equal(M.defaultAiDifficulty(hasBeatenComputer()), 'easy');
  recordMatch(match({ enemies: [{ kind: 'ai', difficulty: 'easy' }] }));
  assert.equal(getCareer().aiWins, 1, 'a win against any difficulty, Easy too');
  assert.equal(M.defaultAiDifficulty(hasBeatenComputer()), 'normal');
});

test('the default pantheon: Greek (as in the lesson) before the first win against the computer, Random after', () => {
  assert.equal(M.defaultPantheon(false), 'greek');
  assert.equal(M.defaultPantheon(true), 'random');
});

test('a career kept before aiWins existed: an achievement only won against the computer stands for a win', () => {
  assert.equal(hasBeatenComputer(sanitizeCareer({ games: 3, wins: 2, unlocked: { proving_ground: 1 } })), true);
  assert.equal(hasBeatenComputer(sanitizeCareer({ games: 3, wins: 2, unlocked: { first_victory: 1 } })), false);
  assert.equal(sanitizeCareer({ wins: 1, aiWins: 7 }).aiWins, 1, 'never more than the wins');
  assert.equal(sanitizeCareer({ wins: 2, aiWins: 'x' }).aiWins, 0);
});

test('the slot dropdown marks Easy as suggested only in a game against the computer while Easy is the default', () => {
  const ai = slot('ai', { difficulty: 'easy', team: 2 });
  const labels = (ctx) => M.slotKindOptions(ai, 1, { myIndex: 0, ...ctx }).map((o) => o.label);
  assert.deepEqual(labels({ online: false, suggested: 'easy' }).filter((l) => l.startsWith('AI')), ['AI — Easy (suggested)', 'AI — Normal', 'AI — Hard', 'AI — Brutal']);
  assert.ok(labels({ online: false, suggested: null }).includes('AI — Easy'), 'after a win: plain labels');
  assert.ok(labels({ online: true, suggested: 'easy' }).includes('AI — Easy'), 'never in an online lobby');
  assert.ok(!labels({ online: false }).some((l) => /suggested/.test(l)));
  assert.deepEqual(M.slotKindOptions(ai, 1, { myIndex: 0, online: false, suggested: 'easy' }).map((o) => o.value), M.slotKindOptions(ai, 1, { myIndex: 0, online: false }).map((o) => o.value), 'the values do not change');
});

test('the hint under the players shows while Easy is suggested and an AI is still on Easy', () => {
  const state = (d) => ({ slots: [slot('host'), slot('ai', { difficulty: d, team: 2 }), slot('closed'), slot('closed')] });
  assert.equal(M.difficultyNote(state('easy'), { online: false, suggested: 'easy' }), M.EASY_SUGGESTED_NOTE);
  assert.match(M.EASY_SUGGESTED_NOTE, /Easy for your first game/);
  assert.equal(M.difficultyNote(state('normal'), { online: false, suggested: 'easy' }), '', 'the player picked Normal');
  assert.equal(M.difficultyNote(state('easy'), { online: false, suggested: null }), '', 'already beaten the computer');
  assert.equal(M.difficultyNote(state('easy'), { online: true, suggested: 'easy' }), '', 'online');
});

test('a lobby can start its new AI players on Easy; one made without it (online, joining) stays on Normal', async () => {
  const solo = await LobbyHost.create({ transport: 'none', name: 'New', aiDifficulty: 'easy' });
  assert.deepEqual(aiLevels(solo), ['easy']);
  assert.equal(solo.state.slots[1].name, 'AI (Easy)');
  assert.ok(solo.applyPreset('ffa'));
  assert.deepEqual(aiLevels(solo), ['easy', 'easy', 'easy'], 'the presets add Easy AIs too');
  solo.setSlot(2, { difficulty: 'hard' });
  assert.ok(solo.applyPreset('2v2'));
  assert.equal(solo.state.slots[2].difficulty, 'hard', 'an AI the player set keeps its level');
  const plain = await LobbyHost.create({ transport: 'none', name: 'Old' });
  assert.ok(plain.applyPreset('ffa'));
  assert.deepEqual(aiLevels(plain), ['normal', 'normal', 'normal']);
  const odd = await LobbyHost.create({ transport: 'none', name: 'Odd', aiDifficulty: 'godlike' });
  assert.deepEqual(aiLevels(odd), ['normal']);
  for (const l of [solo, plain, odd]) if (typeof l.close === 'function') l.close();
});
