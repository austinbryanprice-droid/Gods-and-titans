// The command card's tooltip (src/ui/hud-card.js): a train or summon button shows the unit's combat stats
// (command-card.js unitStats) between its cost and its description. Fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { CardView } from '../../src/ui/hud-card.js';

before(installFakeDom);

test('the tooltip shows a unit\'s stats lines before its description; other buttons have none', () => {
  const tip = document.createElement('div');
  const view = new CardView(document.createElement('div'), tip, {});
  const train = { id: 'train:archer', icon: '🏹', keyLabel: 'A', state: 'ready', title: 'Train Archer', description: 'Ranged soldier.', cost: { gold: 120, wood: 30 }, stats: ['290 HP · 16 ranged damage, range 6 · 0 armor · speed 2.7', 'Hits flyers'] };
  view.card = [train, { id: 'rally', icon: '🚩', keyLabel: 'Y', state: 'ready', title: 'Set Rally Point', description: 'Where new units go.', stats: null }];
  view.hoverSlot = 0;
  view.renderTip();
  const stats = tip.find('ht-stats');
  assert.ok(stats);
  assert.deepEqual(stats.children.map((c) => c.textContent), train.stats);
  const kinds = tip.children.map((c) => c.className);
  assert.ok(kinds.indexOf('ht-stats') < kinds.indexOf('ht-desc'), 'the stats come before the description');
  view.hoverSlot = 1;
  view.renderTip();
  assert.equal(tip.find('ht-stats'), null);
});
