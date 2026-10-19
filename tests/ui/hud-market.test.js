// The team market panel (src/ui/hud-market.js): lists living teammates only,
// quick-add buttons never go past what the player has, the summary shows what
// arrives after the market's cut, and Send issues one trade command. Fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { MarketView, marketPartners } from '../../src/ui/hud-market.js';
import { installFakeDom } from './fake-dom.js';

before(installFakeDom);

function setup(players) {
  const sent = [];
  const vs = { myIndex: 0, players };
  const view = new MarketView({ viewState: vs, onSend: (cmd) => sent.push(cmd) });
  return { view, vs, sent, root: view.root };
}

const P = (i, team, extra = {}) => ({ i, name: `P${i}`, team, color: '#3a78d6', gold: 400, wood: 200, faith: 50, defeated: false, ...extra });

test('only living teammates are offered', () => {
  assert.deepEqual(marketPartners({ myIndex: 0, players: [P(0, 1), P(1, 2), P(2, 1), P(3, 1, { defeated: true })] }), [2]);
  assert.deepEqual(marketPartners({ myIndex: 0, players: [P(0, 1), P(1, 2)] }), []);
});

test('pick a teammate, resource and amount, then send one trade command', () => {
  const { view, root, sent } = setup([P(0, 1, { gold: 300 }), P(1, 2), P(2, 1), P(3, 1)]);
  view.open();
  assert.equal(root.findAll('hud-market-partner').length, 2, 'both teammates listed');
  assert.equal(root.button('Send').disabled, true, 'nothing to send yet');
  root.button('+100').click();
  root.button('+50').click();
  assert.match(root.textContent, /P2 receives 135 gold \(the market keeps 15\)/);
  root.findAll('hud-market-partner')[1].click();
  assert.match(root.textContent, /P3 receives 135 gold/);
  root.button('Send').click();
  assert.deepEqual(sent, [{ type: 'trade', to: 3, res: 'gold', amount: 150 }]);
  assert.equal(view.amount, 0, 'the amount resets after sending');
});

test('quick-add stops at what the player has; Max and Clear', () => {
  const { view, root } = setup([P(0, 1, { wood: 120 }), P(1, 1)]);
  view.open();
  root.findAll('hud-market-resbtn')[1].click();
  assert.equal(view.res, 'wood');
  root.button('+500').click();
  assert.equal(view.amount, 120);
  root.button('Clear').click();
  assert.equal(view.amount, 0);
  root.button('Max').click();
  assert.equal(view.amount, 120);
});

test('too small an amount explains itself and keeps Send disabled', () => {
  const { view, root, sent } = setup([P(0, 1, { faith: 15 }), P(1, 1)]);
  view.open();
  root.findAll('hud-market-resbtn')[2].click();
  root.button('Max').click();
  assert.match(root.textContent, /Send at least 20 faith/);
  assert.equal(root.button('Send').disabled, true);
  root.button('Send').click();
  assert.deepEqual(sent, []);
});
