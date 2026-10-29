// The career and achievements (src/game/career.js, src/data/achievements.js, src/game/career-tracker.js):
// what a finished match adds, what unlocks mid-match and at the end, a damaged stored career,
// and the tracker reading facts from events and snapshots.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, EARNED_WIN_SECONDS, earnedWin } from '../../src/data/achievements.js';
import { PANTHEON_LIST } from '../../src/data/pantheon-list.js';
import { getCareer, recordMatch, checkLive, resetCareer, sanitizeCareer, careerSummary, markSeen } from '../../src/game/career.js';
import { CareerTracker } from '../../src/game/career-tracker.js';

const NEWER_EMOJI = /[\u{1FA70}-\u{1FAFF}\u{1F6D5}-\u{1F6D7}\u{1F6DC}-\u{1F6DF}\u{1F6FA}-\u{1F6FC}\u{1F7E0}-\u{1F7EB}\u{1F7F0}\u{1F90C}-\u{1F90F}\u{1F93F}\u{1F971}\u{1F972}\u{1F977}-\u{1F97B}\u{1F9A3}-\u{1F9AF}\u{1F9BA}-\u{1F9BF}\u{1F9C3}-\u{1F9CF}\u{26A7}\u{200D}]/u;

/** A plain match: one human vs one Normal AI, nothing special happened. */
function match(over = {}) {
  return {
    result: 'victory', pantheon: 'greek', time: 20 * 60,
    godsSummoned: 0, maxGodsAtOnce: 0, maxGodLevel: 0, titanSummoned: false, enemyTitansFallen: 0,
    maxRank: 0, kills: 10, losses: 5, gathered: 2000, buildingsLost: 1, maxTier: 1,
    manor: false, stoneWall: false,
    enemies: [{ kind: 'ai', difficulty: 'easy' }], teamSize: 1, peace: false,
    ...over,
  };
}

beforeEach(() => resetCareer({}));

test('about thirty achievements with unique ids, a group, a name, a description and an old-enough emoji', () => {
  assert.ok(ACHIEVEMENTS.length >= 30 && ACHIEVEMENTS.length <= 40, `${ACHIEVEMENTS.length}`);
  assert.equal(Object.keys(ACHIEVEMENT_BY_ID).length, ACHIEVEMENTS.length);
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.group && a.name && a.desc && a.icon && typeof a.test === 'function', a.id);
    assert.ok(!NEWER_EMOJI.test(a.icon), `${a.id} icon ${a.icon} needs Emoji 12 or newer`);
  }
  for (const p of PANTHEON_LIST) assert.ok(ACHIEVEMENT_BY_ID[`win_${p.id}`], p.id);
});

test('a win counts the game, the pantheon and the records, and unlocks First Victory and the pantheon win', () => {
  const got = recordMatch(match()).map((a) => a.id);
  const c = getCareer();
  assert.equal(c.games, 1);
  assert.equal(c.wins, 1);
  assert.deepEqual(c.pantheons.greek, { games: 1, wins: 1 });
  assert.equal(c.kills, 10);
  assert.equal(c.best.longest, 20 * 60);
  assert.equal(c.history[0].r, 'victory');
  assert.ok(got.includes('first_victory') && got.includes('win_greek'), got.join());
  // Nothing about a Normal AI, a flawless game or a quick one.
  for (const id of ['proving_ground', 'untouched', 'lightning_war', 'hard_won']) assert.ok(!got.includes(id), id);
  // Unlocked once only.
  assert.ok(!recordMatch(match()).some((a) => a.id === 'first_victory'));
  assert.deepEqual(new Set(getCareer().unseen).size, getCareer().unseen.length);
});

test('a defeat counts a loss and unlocks no win achievement', () => {
  const got = recordMatch(match({ result: 'defeat', buildingsLost: 0, time: 300, enemies: [{ kind: 'ai', difficulty: 'hard' }] }));
  const c = getCareer();
  assert.equal(c.losses, 1);
  assert.equal(c.wins, 0);
  assert.deepEqual(c.pantheons.greek, { games: 1, wins: 0 });
  assert.deepEqual(got.map((a) => a.id), []);
  assert.equal(recordMatch(match({ result: 'quit' })).length, 0, 'an unknown result is not counted');
  assert.equal(getCareer().games, 1);
});

test('the winning challenges: Hard AI, flawless, fast, outnumbered, an ally, a human enemy, the peace', () => {
  const got = recordMatch(match({
    time: 10 * 60, buildingsLost: 0, peace: true, teamSize: 2,
    enemies: [{ kind: 'ai', difficulty: 'hard' }, { kind: 'human', difficulty: null }, { kind: 'ai', difficulty: 'normal' }],
  })).map((a) => a.id);
  for (const id of ['hard_won', 'proving_ground', 'untouched', 'lightning_war', 'against_all_odds', 'shoulder_to_shoulder', 'mortal_rival', 'decade_of_peace']) {
    assert.ok(got.includes(id), id);
  }
});

test('in-match achievements unlock live, and the ones about winning wait for the result', () => {
  const got = checkLive(match({ godsSummoned: 1, maxGodsAtOnce: 3, maxGodLevel: 6, titanSummoned: true, enemyTitansFallen: 1, maxRank: 3, kills: 120, gathered: 12000, maxTier: 3, manor: true, stoneWall: true, buildingsLost: 0, time: 61 * 60 })).map((a) => a.id);
  for (const id of ['answered_prayer', 'divine_council', 'ascension', 'titan_unleashed', 'titanfall', 'champion', 'hundred_slain', 'bountiful', 'city_of_gods', 'manor', 'stone_walls', 'the_long_war']) {
    assert.ok(got.includes(id), id);
  }
  for (const id of ['first_victory', 'untouched', 'win_greek']) assert.ok(!got.includes(id), id);
  assert.equal(getCareer().games, 0, 'a live check counts no game');
});

test('career milestones count across games: ten played, ten won, every pantheon', () => {
  for (let i = 0; i < 9; i++) recordMatch(match({ result: i % 2 ? 'defeat' : 'victory', pantheon: PANTHEON_LIST[i].id }));
  assert.ok(!getCareer().unlocked.seasoned);
  const got = recordMatch(match({ pantheon: PANTHEON_LIST[9].id })).map((a) => a.id);
  assert.ok(got.includes('seasoned'));
  assert.ok(!got.includes('all_pantheons'), 'four pantheons were played but lost');
  const all = ACHIEVEMENT_BY_ID.all_pantheons.progress(getCareer());
  assert.deepEqual(all, [6, 10]);
  for (const i of [1, 3, 5, 7]) recordMatch(match({ pantheon: PANTHEON_LIST[i].id }));
  assert.ok(getCareer().unlocked.all_pantheons);
  assert.ok(getCareer().unlocked.warlord);
  const s = careerSummary();
  assert.equal(s.unlocked, Object.keys(getCareer().unlocked).length);
  assert.ok(s.winRate > 0.7 && s.winRate < 0.8);
  assert.equal(getCareer().history.length, 12, 'the last twelve games');
});

test('a damaged stored career is cleaned, not thrown at the menu', () => {
  const c = sanitizeCareer({ games: -3, wins: 'x', pantheons: { greek: { games: 2, wins: 9 }, atlantis: { games: 1 } }, unlocked: { first_victory: 5, nope: 1 }, unseen: ['nope', 'first_victory', 'first_victory'], history: [{ r: 'victory', p: 'zz', t: 5 }, { r: 'odd' }, null] });
  assert.equal(c.games, 0);
  assert.equal(c.wins, 0);
  assert.deepEqual(c.pantheons, { greek: { games: 2, wins: 2 } });
  assert.deepEqual(Object.keys(c.unlocked), ['first_victory']);
  assert.deepEqual(c.unseen, ['first_victory']);
  assert.deepEqual(c.history, [{ r: 'victory', p: null, t: 5, at: 0 }]);
  assert.equal(sanitizeCareer('junk').games, 0);
});

test('opening the career screen clears the "new" marks', () => {
  recordMatch(match());
  assert.ok(getCareer().unseen.length > 0);
  markSeen();
  assert.equal(getCareer().unseen.length, 0);
});

// ---------------------------------------------------------------- the tracker

function fakeView() {
  const handlers = new Map();
  const vs = {
    myIndex: 0, time: 0, entities: new Map(),
    players: [{ i: 0, team: 1, pantheon: 'norse', tier: 1, gods: [], titan: false, stats: { kills: 0, gathered: 0, losses: 0 } }, { i: 1, team: 2 }],
    get me() { return this.players[0]; },
    isAlly: (o) => o === 0,
    on(type, cb) {
      handlers.set(type, [...(handlers.get(type) || []), cb]);
      return () => handlers.set(type, handlers.get(type).filter((f) => f !== cb));
    },
    fire(type, ev) {
      for (const f of handlers.get(type) || []) f(ev);
      if (type !== 'snapshot') for (const f of handlers.get('*') || []) f(ev);
    },
  };
  return vs;
}

const SETUP = { players: [{ index: 0, team: 1, pantheon: 'norse', kind: 'human' }, { index: 1, team: 2, pantheon: 'greek', kind: 'ai', difficulty: 'hard' }], peaceMinutes: 30 };

test('the tracker reads summons, ranks, lost buildings and the snapshot record, and counts the match once', () => {
  const vs = fakeView();
  const live = [];
  const calls = { live: [], record: [] };
  const career = {
    checkLive: (m) => { calls.live.push({ ...m }); return m.titanSummoned && !live.length ? [{ id: 'titan_unleashed', name: 'Titan Unleashed' }] : []; },
    recordMatch: (m) => { calls.record.push({ ...m }); return [{ id: 'first_victory' }]; },
  };
  const t = new CareerTracker({ viewState: vs, setup: SETUP, career, onUnlock: (list) => live.push(...list) }).attach();
  vs.entities.set(5, { id: 5, k: 'u', t: 'warrior', o: 0, rk: 2 });
  vs.entities.set(6, { id: 6, k: 'b', t: 'manor', o: 0, bp: 1 });
  vs.entities.set(7, { id: 7, k: 'u', t: 'warrior', o: 1, rk: 3 }); // an enemy's Champion is not mine
  vs.fire('spawn', { type: 'spawn', o: 0, t: 'norse_odin' });
  vs.fire('spawn', { type: 'spawn', o: 1, t: 'greek_zeus' });
  vs.fire('spawn', { type: 'spawn', o: 0, t: 'norse_surtr' });
  vs.fire('death', { type: 'death', k: 'b', o: 0, t: 'house' });
  vs.fire('death', { type: 'death', k: 'b', o: 0, t: 'wooden_wall' });
  vs.fire('death', { type: 'death', k: 'u', o: 1, t: 'greek_kronos' });
  vs.fire('tierUp', { type: 'tierUp', player: 0, tier: 2 });
  vs.time = 30;
  vs.players[0].stats = { kills: 7, gathered: 900, losses: 2 };
  vs.players[0].gods = ['odin', 'thor'];
  vs.fire('snapshot', {});
  assert.equal(live.length, 1, 'the titan unlocked mid-match');
  const m = t.m;
  assert.equal(m.godsSummoned, 1);
  assert.equal(m.titanSummoned, true);
  assert.equal(m.buildingsLost, 1, 'a wall segment does not count');
  assert.equal(m.enemyTitansFallen, 1);
  assert.equal(m.maxTier, 2);
  assert.equal(m.maxRank, 2);
  assert.equal(m.manor, true);
  assert.equal(m.maxGodsAtOnce, 2);
  assert.equal(m.kills, 7);
  assert.equal(m.pantheon, 'norse');
  assert.equal(m.peace, true);
  assert.deepEqual(m.enemies, [{ index: 1, kind: 'ai', difficulty: 'hard', away: false, surrendered: false, out: false }]);
  const all = t.finish('victory');
  assert.deepEqual(all.map((a) => a.id), ['titan_unleashed', 'first_victory']);
  assert.equal(calls.record.length, 1);
  assert.equal(calls.record[0].result, 'victory');
  assert.equal(t.finish('defeat'), null, 'counted once');
  vs.fire('spawn', { type: 'spawn', o: 0, t: 'norse_odin' });
  assert.equal(t.m.godsSummoned, 1, 'nothing more after the end');
  t.dispose();
});

test('Mortal Rival: a win over a seat counts as one over a person only if a person held it when it fell', () => {
  const human = (over = {}) => ({ index: 1, kind: 'human', difficulty: null, ...over });
  // The rival dropped out and a stand-in AI was beaten in their seat: no Mortal Rival, and no AI challenge either.
  let got = recordMatch(match({ enemies: [human({ away: true })] })).map((a) => a.id);
  assert.ok(!got.includes('mortal_rival'), got.join());
  assert.ok(!got.includes('proving_ground'));
  assert.equal(getCareer().aiWins, 0);
  assert.ok(got.includes('first_victory'), 'still a win');
  // Two rivals, one of them there to the end: it counts.
  got = recordMatch(match({ enemies: [human({ away: true }), human({ index: 2 })] })).map((a) => a.id);
  assert.ok(got.includes('mortal_rival'));
});

test('a win handed over by a surrender in the first five minutes is not a win for the career', () => {
  const enemies = [{ index: 1, kind: 'human', difficulty: null, surrendered: true }];
  // The 0:36 surrender of the audit: a game played, shown as a victory, but no win and no achievement about winning.
  const got = recordMatch(match({ time: 36, buildingsLost: 0, teamSize: 2, enemies })).map((a) => a.id);
  assert.deepEqual(got, []);
  const c = getCareer();
  assert.equal(c.games, 1);
  assert.equal(c.wins, 0);
  assert.deepEqual(c.pantheons.greek, { games: 1, wins: 0 });
  assert.equal(c.history[0].r, 'victory');
  assert.equal(EARNED_WIN_SECONDS, 300);
  assert.equal(earnedWin(match({ time: 299, enemies })), false);
  // After five minutes a surrender is a real one: the win counts, Lightning War with it.
  const later = recordMatch(match({ time: 6 * 60, buildingsLost: 0, enemies })).map((a) => a.id);
  for (const id of ['first_victory', 'win_greek', 'lightning_war', 'untouched', 'mortal_rival']) assert.ok(later.includes(id), id);
  assert.equal(getCareer().wins, 1);
  // A quick win nobody surrendered (all beaten in a fight) is earned, however fast.
  assert.equal(earnedWin(match({ time: 200, enemies: [{ kind: 'ai', difficulty: 'easy' }] })), true);
  assert.equal(earnedWin(match({ result: 'defeat', time: 1000 })), false);
});

test('the tracker reads stand-ins and surrenders from the snapshots, as they were when each enemy fell', () => {
  const vs = fakeView();
  vs.players.push({ i: 2, team: 2 });
  const setup = { players: [{ index: 0, team: 1, pantheon: 'norse', kind: 'human' }, { index: 1, team: 2, kind: 'human' }, { index: 2, team: 2, kind: 'human' }] };
  const calls = [];
  const t = new CareerTracker({ viewState: vs, setup, career: { checkLive: () => [], recordMatch: (m) => { calls.push(JSON.parse(JSON.stringify(m))); return []; } } }).attach();
  vs.fire('snapshot', {});
  // Player 1 drops out (a stand-in holds the seat) and comes back; player 2 drops out.
  vs.players[1].away = true;
  vs.players[2].away = true;
  vs.fire('snapshot', {});
  delete vs.players[1].away;
  vs.fire('snapshot', {});
  // Player 1 is beaten while there, then leaves: still beaten as a person. Player 2's seat falls to a surrender while a stand-in holds it.
  vs.players[1].defeated = true;
  vs.fire('snapshot', {});
  vs.players[1].away = true; // (a defeated player who leaves gets no stand-in, but even a mark later changes nothing)
  vs.players[2].defeated = true;
  vs.players[2].sur = true;
  vs.time = 40;
  vs.fire('snapshot', {});
  t.finish('victory');
  const [m] = calls;
  assert.deepEqual(m.enemies.map((e) => [e.index, e.away, e.surrendered, e.out]), [[1, false, false, true], [2, true, true, true]]);
  // A rejoined game's tally from before enemies had an index is read again from the setup.
  const t2 = new CareerTracker({ viewState: vs, setup, career: { checkLive: () => [], recordMatch: () => [] } });
  Object.assign(t2.m, { pantheon: 'norse', enemies: [{ kind: 'human', difficulty: null }] });
  t2.observe();
  assert.deepEqual(t2.m.enemies.map((e) => e.index), [1, 2]);
});

test('a spectator has no career to count', () => {
  const vs = fakeView();
  vs.myIndex = -1;
  const t = new CareerTracker({ viewState: vs, setup: SETUP, career: { checkLive: () => [], recordMatch: () => assert.fail('recorded') } }).attach();
  vs.fire('snapshot', {});
  assert.equal(t.finish('victory'), null);
});
