// A production queue holds MAX_QUEUE (50) items (DESIGN 5.4). Every queued item is paid for and counted
// against the population cap the moment it is queued, so the purse and the cap end a queue long before the
// 50 do when they are short; cancelling gives back exactly what that item cost, one at a time or a run at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_QUEUE, POP_MAX, REVIVE_COST_MULT } from '../../src/config.js';
import { MORTALS, godsFor } from '../../src/data/index.js';
import { makeWorld, run, place, errorsOf } from './helpers.js';

const tcOf = (w, p = 0) => w.buildingsOf(p).find((b) => b.type === 'town_center');

/** Issue `n` train commands in one tick (what a Shift-click or a held hotkey adds up to) and return the errors. */
function train(w, b, unit, n = 1) {
  w.events.length = 0;
  for (let i = 0; i < n; i++) w.issueCommand(0, { type: 'train', building: b.id, unit });
  w.tick();
  return errorsOf(w.events, 0);
}

function cancel(w, b, index, count) {
  w.events.length = 0;
  w.issueCommand(0, { type: 'cancelTrain', building: b.id, index, count });
  w.tick();
  return errorsOf(w.events, 0);
}

const WORKER = MORTALS.worshipper;

test('the queue holds 50', () => {
  assert.equal(MAX_QUEUE, 50);
});

test('a Town Center queues 50 Worshippers, paid for and counted against the population up front, and refuses a 51st', () => {
  const w = makeWorld();
  const tc = tcOf(w);
  const p = w.players[0];
  Object.assign(p, { gold: 10000, popCap: POP_MAX });
  const pop0 = p.popUsed;
  assert.deepEqual(train(w, tc, 'worshipper', MAX_QUEUE), []);
  assert.equal(tc.queue.length, MAX_QUEUE);
  assert.equal(p.gold, 10000 - MAX_QUEUE * WORKER.cost.gold);
  assert.equal(p.popUsed, pop0 + MAX_QUEUE * WORKER.pop);
  assert.deepEqual(train(w, tc, 'worshipper'), ['Production queue is full.']);
  assert.equal(tc.queue.length, MAX_QUEUE);
  assert.equal(p.gold, 10000 - MAX_QUEUE * WORKER.cost.gold, 'the refused unit costs nothing');
  assert.equal(p.popUsed, pop0 + MAX_QUEUE * WORKER.pop);
  // The view carries the whole queue, the first item progressing.
  const q = w.getSnapshot().entities.find((e) => e.id === tc.id).q;
  assert.equal(q.length, MAX_QUEUE);
  assert.ok(q.every((it) => it.u === 'worshipper'));
  assert.ok(q[0].p > 0 && q.slice(1).every((it) => it.p === 0));
});

test('the purse ends a queue before 50 does: 12 Worshippers is all 600 gold buys', () => {
  const w = makeWorld();
  const tc = tcOf(w);
  const p = w.players[0];
  Object.assign(p, { gold: 12 * WORKER.cost.gold, popCap: POP_MAX });
  assert.deepEqual(train(w, tc, 'worshipper', 13), ['Not enough gold.']);
  assert.equal(tc.queue.length, 12);
  assert.equal(p.gold, 0);
});

test('the population cap ends a queue before 50 does, and every unit takes its own share', () => {
  const w = makeWorld();
  const b = place(w, 0, 'barracks', 20, 20);
  const p = w.players[0];
  const warrior = MORTALS.warrior;
  Object.assign(p, { gold: 99999, wood: 99999 });
  const room = 7 * warrior.pop;
  p.popCap = p.popUsed + room;
  const errors = train(w, b, 'warrior', 10);
  assert.deepEqual(errors, Array(3).fill('Not enough population. Build more Houses.'), 'seven fit, three are refused');
  assert.equal(b.queue.length, 7);
  assert.equal(p.popUsed, p.popCap);
});

test('production works through all 50 in order: each unit spawns once and the population never drifts', () => {
  const w = makeWorld();
  const tc = tcOf(w);
  const p = w.players[0];
  Object.assign(p, { gold: 10000, popCap: POP_MAX });
  const workers0 = w.unitsOf(0).length;
  train(w, tc, 'worshipper', MAX_QUEUE);
  const popQueued = p.popUsed;
  run(w, WORKER.buildTime * MAX_QUEUE + 2);
  assert.equal(tc.queue.length, 0);
  assert.equal(w.unitsOf(0).length, workers0 + MAX_QUEUE);
  assert.equal(p.stats.unitsTrained, MAX_QUEUE);
  assert.equal(p.popUsed, popQueued, 'the reserved population became living units one for one');
  const used = p.popUsed;
  w.recomputePop();
  assert.equal(p.popUsed, used, 'what the sim tracked equals what it counts');
});

test('a unit cancelled from the middle gives back its own cost and population', () => {
  const w = makeWorld();
  const tc = tcOf(w);
  const p = w.players[0];
  Object.assign(p, { gold: 10000, popCap: POP_MAX });
  train(w, tc, 'worshipper', 20);
  const gold = p.gold;
  const pop = p.popUsed;
  assert.deepEqual(cancel(w, tc, 9), []);
  assert.equal(tc.queue.length, 19);
  assert.equal(p.gold, gold + WORKER.cost.gold);
  assert.equal(p.popUsed, pop - WORKER.pop);
  cancel(w, tc); // no index: the last one
  assert.equal(tc.queue.length, 18);
  assert.equal(p.gold, gold + 2 * WORKER.cost.gold);
  cancel(w, tc, 18); // past the end: nothing
  cancel(w, tc, -1);
  assert.equal(tc.queue.length, 18);
});

test('a run goes back with one command: index and count, clamped to the end of the queue', () => {
  const w = makeWorld();
  const tc = tcOf(w);
  const p = w.players[0];
  Object.assign(p, { gold: 10000, popCap: POP_MAX });
  train(w, tc, 'worshipper', MAX_QUEUE);
  const gold = p.gold;
  const pop = p.popUsed;
  cancel(w, tc, 10, 5);
  assert.equal(tc.queue.length, MAX_QUEUE - 5);
  assert.equal(p.gold, gold + 5 * WORKER.cost.gold);
  assert.equal(p.popUsed, pop - 5 * WORKER.pop);
  cancel(w, tc, 30, 99); // from 30 to the end, however many are asked for
  assert.equal(tc.queue.length, 30);
  assert.equal(p.gold, gold + 20 * WORKER.cost.gold);
  cancel(w, tc, 0, 30); // the whole queue, the one in progress too
  assert.equal(tc.queue.length, 0);
  assert.equal(p.gold, 10000);
  assert.equal(p.popUsed, pop - MAX_QUEUE * WORKER.pop);
  assert.equal(w.getSnapshot().entities.find((e) => e.id === tc.id).q.length, 0);
});

test('a run of mixed units refunds each one at its own price', () => {
  const w = makeWorld();
  const b = place(w, 0, 'barracks', 20, 20);
  const p = w.players[0];
  Object.assign(p, { gold: 50000, wood: 50000, popCap: POP_MAX });
  for (const unit of ['warrior', 'archer', 'warrior', 'archer', 'archer']) train(w, b, unit);
  const spent = { gold: 50000 - p.gold, wood: 50000 - p.wood };
  const pop = p.popUsed;
  const w1 = MORTALS.warrior;
  const a1 = MORTALS.archer;
  cancel(w, b, 1, 3); // archer, warrior, archer
  assert.deepEqual(b.queue.map((it) => it.u), ['warrior', 'archer']);
  assert.equal(p.gold, 50000 - spent.gold + 2 * (a1.cost.gold || 0) + (w1.cost.gold || 0));
  assert.equal(p.wood, 50000 - spent.wood + 2 * (a1.cost.wood || 0) + (w1.cost.wood || 0));
  assert.equal(p.popUsed, pop - 2 * a1.pop - w1.pop);
});

test('a revived god in a cancelled run goes back to the fallen', () => {
  const w = makeWorld();
  const p = w.players[0];
  place(w, 0, 'shrine', 20, 20);
  const temple = place(w, 0, 'temple', 26, 20);
  Object.assign(p, { gold: 9000, faith: 9000, tier: 2, popCap: POP_MAX }); // a second god needs Town
  const [first, second] = godsFor(p.pantheon);
  p.fallen[first.id] = { level: 3, xp: 320 };
  train(w, temple, first.id);
  train(w, temple, second.id);
  assert.equal(p.fallen[first.id], undefined);
  const gold = p.gold;
  cancel(w, temple, 0, 2);
  assert.equal(temple.queue.length, 0);
  assert.deepEqual(p.fallen[first.id], { level: 3, xp: 320 });
  assert.equal(p.gold, gold + Math.round(first.cost.gold * REVIVE_COST_MULT) + second.cost.gold);
});

test('a Town Center full of Worshippers cannot grow until a place frees up, and the growth waits at the back', () => {
  const w = makeWorld();
  const tc = tcOf(w);
  const p = w.players[0];
  place(w, 0, 'shrine', 20, 20);
  Object.assign(p, { gold: 20000, wood: 5000, faith: 500, popCap: POP_MAX });
  train(w, tc, 'worshipper', MAX_QUEUE);
  w.events.length = 0;
  w.issueCommand(0, { type: 'upgradeTier', building: tc.id });
  w.tick();
  assert.deepEqual(errorsOf(w.events, 0), ['Production queue is full.']);
  cancel(w, tc); // one place free
  w.events.length = 0;
  w.issueCommand(0, { type: 'upgradeTier', building: tc.id });
  w.tick();
  assert.deepEqual(errorsOf(w.events, 0), []);
  assert.equal(tc.queue.length, MAX_QUEUE);
  assert.equal(tc.queue[MAX_QUEUE - 1].u, 'tier_up', 'queued behind the units');
  assert.deepEqual(train(w, tc, 'worshipper'), ['Your settlement is already growing.']);
});

test('a destroyed building frees the population of everything it had queued', () => {
  const w = makeWorld();
  const b = place(w, 0, 'barracks', 20, 20);
  const p = w.players[0];
  Object.assign(p, { gold: 50000, wood: 50000, popCap: POP_MAX });
  const pop0 = p.popUsed;
  train(w, b, 'warrior', 30);
  assert.equal(p.popUsed, pop0 + 30 * MORTALS.warrior.pop);
  w.killEntity(b, null);
  w.cleanup();
  assert.equal(p.popUsed, pop0);
  w.recomputePop();
  assert.equal(p.popUsed, pop0);
});
