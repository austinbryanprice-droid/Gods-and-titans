import test from 'node:test';
import assert from 'node:assert/strict';
import { TRADE_MIN, TRADE_TAX_PCT } from '../../src/config.js';
import { tradeReceived, tradePartners, tradeError } from '../../src/sim/trade.js';
import { makeWorld, runCollect, errorsOf, eventsOf } from './helpers.js';
import { encode, apply } from '../../src/net/delta.js';

const teamWorld = () => makeWorld({ players: 4, teams: [1, 2, 1, 2] });

test('the market keeps its cut, rounded up', () => {
  assert.equal(TRADE_TAX_PCT, 10);
  assert.equal(tradeReceived(100), 90);
  assert.equal(tradeReceived(25), 22);
  assert.equal(tradeReceived(20), 18);
  assert.equal(tradeReceived(0), 0);
});

test('a player sends gold, wood and faith to a teammate', () => {
  const w = teamWorld();
  const [a, , b] = w.players;
  Object.assign(a, { gold: 500, wood: 300, faith: 100 });
  Object.assign(b, { gold: 10, wood: 0, faith: 0 });
  w.issueCommand(0, { type: 'trade', to: 2, res: 'gold', amount: 200 });
  w.issueCommand(0, { type: 'trade', to: 2, res: 'wood', amount: 100 });
  w.issueCommand(0, { type: 'trade', to: 2, res: 'faith', amount: 50 });
  const events = runCollect(w, 0.05);
  assert.deepEqual(errorsOf(events, 0), []);
  assert.equal(a.gold, 300);
  assert.equal(a.wood, 200);
  assert.equal(a.faith, 50);
  assert.equal(b.gold, 10 + 180);
  assert.equal(b.wood, 90);
  assert.equal(b.faith, 45);
  assert.deepEqual(eventsOf(events, 'trade')[0], { type: 'trade', from: 0, to: 2, res: 'gold', amt: 200, got: 180 });
});

test('trades to enemies, the defeated, yourself, too little or more than you have are refused', () => {
  const w = teamWorld();
  const a = w.players[0];
  Object.assign(a, { gold: 100, wood: 100, faith: 100 });
  w.players[2].defeated = true;
  const tries = [
    [{ to: 1, res: 'gold', amount: 50 }, 'You can only send resources to a teammate.'],
    [{ to: 2, res: 'gold', amount: 50 }, 'That ally has been defeated.'],
    [{ to: 0, res: 'gold', amount: 50 }, 'Choose a teammate to send to.'],
    [{ to: 9, res: 'gold', amount: 50 }, 'Choose a teammate to send to.'],
  ];
  for (const [cmd, msg] of tries) {
    w.issueCommand(0, { type: 'trade', ...cmd });
    assert.deepEqual(errorsOf(runCollect(w, 0.05), 0), [msg], JSON.stringify(cmd));
  }
  w.players[2].defeated = false;
  w.issueCommand(0, { type: 'trade', to: 2, res: 'wood', amount: TRADE_MIN - 1 });
  assert.deepEqual(errorsOf(runCollect(w, 0.05), 0), [`Send at least ${TRADE_MIN} wood.`]);
  w.issueCommand(0, { type: 'trade', to: 2, res: 'faith', amount: 101 });
  assert.deepEqual(errorsOf(runCollect(w, 0.05), 0), ['Not enough faith.']);
  w.issueCommand(0, { type: 'trade', to: 2, res: 'mana', amount: 50 });
  assert.deepEqual(errorsOf(runCollect(w, 0.05), 0), ['Choose gold, wood or faith to send.']);
  assert.deepEqual([a.gold, a.wood, a.faith], [100, 100, 100], 'nothing left the treasury');
  assert.equal(w.players[2].gold, 400);
});

test('a defeated player cannot trade, and partners list living teammates only', () => {
  const w = teamWorld();
  assert.deepEqual(tradePartners(w.players, 0), [2]);
  assert.deepEqual(tradePartners(w.players, 1), [3]);
  w.players[3].defeated = true;
  assert.deepEqual(tradePartners(w.players, 1), []);
  w.players[0].defeated = true;
  assert.equal(tradeError(w.players, 0, 2, 'gold', 50), 'You cannot trade now.');
  const ffa = makeWorld({ players: 3 });
  assert.deepEqual(tradePartners(ffa.players, 0), []);
});

test('trades reach clients: resources and the event travel in the delta snapshots', () => {
  const w = teamWorld();
  w.players[0].gold = 1000;
  const before = w.getSnapshot();
  w.issueCommand(0, { type: 'trade', to: 2, res: 'gold', amount: 500 });
  w.tick();
  const after = w.getSnapshot();
  const json = JSON.parse(JSON.stringify(encode(before, after)));
  const view = apply(before, json);
  assert.equal(view.players[0].gold, after.players[0].gold);
  assert.equal(view.players[2].gold, after.players[2].gold);
  assert.equal(view.players[2].gold - before.players[2].gold, 450);
  assert.deepEqual(view.events.filter((e) => e.type === 'trade'), [{ type: 'trade', from: 0, to: 2, res: 'gold', amt: 500, got: 450 }]);
});

test('AI allies send part of their surplus to a broke teammate, never to enemies', async () => {
  const { planAid, runAid, AID_RULES } = await import('../../src/ai/team.js');
  const w = teamWorld();
  w.time = AID_RULES.start + 1;
  Object.assign(w.players[0], { gold: 2000, wood: 2000 });
  Object.assign(w.players[2], { gold: 30, wood: 500 });
  Object.assign(w.players[1], { gold: 0, wood: 0 }); // broke, but an enemy
  assert.deepEqual(planAid(w, 0), [{ to: 2, res: 'gold', amount: AID_RULES.gold.send }]);
  assert.deepEqual(planAid(w, 0, { gold: 710, wood: 2000, faith: 0 }), [], 'only from what purchases left over');
  w.time = 10;
  assert.deepEqual(planAid(w, 0), [], 'nobody counts as struggling at the start');
  w.time = AID_RULES.start + 1;
  const sent = [];
  const ai = { world: w, me: 0, issue: (cmd) => { sent.push(cmd); w.issueCommand(0, cmd); } };
  runAid(ai);
  runAid(ai);
  assert.equal(sent.length, 1, 'one gift per interval');
  w.tick();
  assert.equal(w.players[2].gold, 30 + AID_RULES.gold.send * 0.9);
  assert.equal(w.players[0].gold, 2000 - AID_RULES.gold.send);
});
