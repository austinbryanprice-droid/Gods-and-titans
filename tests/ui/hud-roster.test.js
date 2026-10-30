// The in-match player list (src/ui/hud-roster.js): players by team with my team first, a
// free-for-all as one list, the live score, fallen / surrendered / away rows, folding, and
// hidden when there is nobody else. Fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { RosterView, rosterGroups, standingText, rowTitle } from '../../src/ui/hud-roster.js';
import { scoreOf } from '../../src/data/score.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

const P = (i, team, extra = {}) => ({
  i, name: `P${i}`, team, pantheon: 'greek', color: '#3a78d6', kind: 'human', tier: 1, up: [], defeated: false,
  stats: { gathered: 0, faith: 0, killValue: 0 }, ...extra,
});
const VS = (players, myIndex = 0) => ({ players, myIndex, myTeam: players[myIndex] ? players[myIndex].team : null, setup: { players } });

test('teams are grouped with my team first and labelled', () => {
  const groups = rosterGroups(VS([P(0, 2), P(1, 1), P(2, 2), P(3, 1)]));
  assert.deepEqual(groups.map((g) => g.label), ['Your team', 'Team 1']);
  assert.deepEqual(groups[0].rows.map((r) => r.i), [0, 2]);
  assert.equal(groups[0].rows[0].me, true);
  assert.deepEqual(groups[1].rows.map((r) => r.i), [1, 3]);
});

test('a free-for-all is one list without team labels, me first', () => {
  const groups = rosterGroups(VS([P(0, 1), P(1, 2), P(2, 3)], 1));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, '');
  assert.deepEqual(groups[0].rows.map((r) => r.i), [1, 0, 2]);
});

test('rows carry pantheon, tier and the game-over score', () => {
  const p = P(1, 2, { pantheon: 'norse', tier: 2, up: ['a', 'b'], stats: { gathered: 1000, faith: 200, killValue: 500 } });
  const row = rosterGroups(VS([P(0, 1), p]))[0].rows[1];
  assert.equal(row.pantheonName, 'Norse');
  assert.equal(row.tierName, 'Town');
  assert.equal(row.score, scoreOf(p).total);
  assert.equal(row.score, 120 + 100 + 100 + 50);
  assert.match(rowTitle(row), /Norse pantheon/);
});

test('fallen, surrendered and away players say so', () => {
  const rows = rosterGroups(VS([P(0, 1), P(1, 2, { defeated: true }), P(2, 3, { defeated: true, sur: true }), P(3, 4, { away: true })]))[0].rows;
  assert.deepEqual(rows.map(standingText), ['', 'Defeated', 'Surrendered', 'Away (AI plays)']);
});

test('names are cleaned and colours kept safe', () => {
  const row = rosterGroups(VS([P(0, 1), P(1, 2, { name: '  <b>x</b>\n', color: 'url(evil)' })]))[0].rows[1];
  assert.ok(!/\n/.test(row.name));
  assert.equal(row.color, '#888888');
});

test('the view lists every player, folds, and hides when alone', () => {
  const vs = VS([P(0, 1), P(1, 2, { defeated: true })]);
  const toggles = [];
  const view = new RosterView({ viewState: vs, onToggle: (o) => toggles.push(o) });
  view.update(0);
  assert.equal(view.root.hidden, false);
  assert.equal(view.root.findAll('hud-roster-row').length, 2);
  assert.equal(view.root.findAll('hud-roster-row')[1].classList.contains('is-out'), true);
  assert.match(view.root.textContent, /1\/2/, 'one of two still in');
  view.head.click();
  assert.equal(view.list.hidden, true);
  assert.deepEqual(toggles, [false]);
  // the score moves: redrawn on the next look
  vs.players[0].stats.gathered = 500;
  view.update(1000);
  assert.match(view.root.findAll('hud-roster-score')[0].textContent, /^50$/);
  const solo = new RosterView({ viewState: VS([P(0, 1)]) });
  solo.update(0);
  assert.equal(solo.root.hidden, true);
});
