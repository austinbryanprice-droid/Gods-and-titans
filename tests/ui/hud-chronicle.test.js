// The after-game chronicle screen (src/ui/hud-chronicle.js, src/ui/hud-overlays.js): tabs,
// awards and the timeline chart. Fake DOM, fake game.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { Overlays } from '../../src/ui/hud-overlays.js';
import { Chronicle } from '../../src/game/chronicle.js';
import { chronicleView } from '../../src/ui/hud-chronicle.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

const stats = (o) => ({ gathered: 0, gold: 0, wood: 0, faith: 0, unitsTrained: 0, kills: 0, losses: 0, buildings: 0, razed: 0, killValue: 0, lostValue: 0, army: 0, ...o });

function view(time = 600) {
  return {
    myIndex: 0,
    myTeam: 1,
    time,
    gameOver: { winningTeam: 1 },
    players: [
      { i: 0, name: 'Austin', team: 1, pantheon: 'greek', color: '#d63a3a', tier: 3, up: ['a'], stats: stats({ kills: 30, gathered: 5000, gold: 3000, wood: 2000, razed: 4, killValue: 2500, army: 40 }) },
      { i: 1, name: 'AI', team: 2, pantheon: 'norse', color: '#3a78d6', tier: 2, up: [], defeated: true, stats: stats({ kills: 9, gathered: 6000, faith: 300, killValue: 400, lostValue: 2500 }) },
    ],
  };
}

function chronicleOf(vs) {
  const c = new Chronicle();
  for (let t = 0; t <= vs.time; t += 30) {
    c.observe({ time: t, players: vs.players.map((p) => ({ ...p, stats: { ...p.stats, army: Math.round(p.stats.army * t / vs.time), kills: Math.round(p.stats.kills * t / vs.time) } })), gameOver: null });
  }
  return c;
}

test('the victory screen opens on the summary with the score and the awards', () => {
  const vs = view();
  const game = { viewState: vs, chronicle: chronicleOf(vs), quitToMenu() {} };
  const root = document.createElement('div');
  const ov = new Overlays(root, game);
  ov.showGameOver({ result: 'victory', winningTeam: 1 });
  assert.equal(ov.name, 'gameover');
  assert.ok(root.find('hud-chronicle'));
  assert.match(root.textContent, /Score/);
  const awards = root.findAll('hud-ch-award');
  const ids = awards.map((a) => a.dataset.award);
  assert.ok(ids.includes('warlord') && ids.includes('treasurer'), ids.join());
  const warlord = awards.find((a) => a.dataset.award === 'warlord');
  assert.ok(warlord.className.includes('is-mine'), 'my award is lit');
  assert.match(warlord.textContent, /Austin/);
});

test('the tabs swap the body: economy, military and the timeline chart', () => {
  const vs = view();
  const node = chronicleView(vs, 1, chronicleOf(vs));
  node.button('Economy').click();
  assert.match(node.textContent, /Gold/);
  assert.match(node.textContent, /3,000/);
  node.button('Military').click();
  assert.match(node.textContent, /Razed/);
  assert.match(node.textContent, /Largest army/);
  node.button('Timeline').click();
  const paths = node.all('path');
  assert.equal(paths.length, 2, 'a line per player');
  assert.equal(paths[0].getAttribute('stroke'), '#d63a3a');
  assert.ok(paths[0].getAttribute('class').includes('is-mine'));
  assert.ok(paths[0].getAttribute('d').startsWith('M'));
  const before = paths[0].getAttribute('d');
  node.button('Kills').click();
  assert.notEqual(node.all('path')[0].getAttribute('d'), before, 'another metric, another line');
});

test('without a chronicle the timeline says why it is empty and nothing breaks', () => {
  const node = chronicleView(view(20), 1, null);
  node.button('Timeline').click();
  assert.equal(node.all('path').length, 0);
  assert.match(node.textContent, /every 30 seconds/);
});

test('a hostile colour from the host never reaches the chart', () => {
  const vs = view();
  vs.players[1].color = 'url(javascript:alert(1))';
  const node = chronicleView(vs, 1, chronicleOf(vs));
  node.button('Timeline').click();
  assert.equal(node.all('path')[1].getAttribute('stroke'), '#888888');
});
