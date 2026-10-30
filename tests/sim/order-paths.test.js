// Order paths in the snapshot (DESIGN 6.3 wp, pe): a human player's unit sends where its current order
// and the next few queued ones go, and a patrol's two ends, so the HUD can draw a dotted path under a
// selection. AI seats send nothing, nor does a unit with no queue on a standing order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WAYPOINTS_MAX } from '../../src/sim/snapshot.js';
import { makeWorld, runUntil, spawn, clearUnits } from './helpers.js';

function arena() {
  const w = makeWorld();
  clearUnits(w, 0);
  clearUnits(w, 1);
  return w;
}

const view = (w, id) => w.getSnapshot().entities.find((e) => e.id === id);

test('Shift-queued moves send each point in order, with its kind', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 10, 20);
  assert.equal(view(w, a.id).wp, undefined, 'an idle unit sends no path');
  w.issueCommand(0, { type: 'move', units: [a.id], x: 14, y: 20 });
  w.issueCommand(0, { type: 'attackMove', units: [a.id], x: 18, y: 22, queue: true });
  w.issueCommand(0, { type: 'move', units: [a.id], x: 18, y: 26, queue: true });
  w.tick();
  const v = view(w, a.id);
  assert.deepEqual(v.wp, [[14, 20, 0], [18, 22, 1], [18, 26, 0]]);
  assert.equal(v.pe, undefined);
  // the path shortens as the unit gets there
  assert.ok(runUntil(w, () => (view(w, a.id).wp || []).length === 2, 10) > 0, 'the first point is passed');
  assert.ok(runUntil(w, () => !view(w, a.id).wp, 20) > 0, 'and none are left at the end');
});

test('a patrol, queued or current, sends its leg and its far end', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 10, 20);
  w.issueCommand(0, { type: 'move', units: [a.id], x: 12, y: 24 });
  w.issueCommand(0, { type: 'patrol', units: [a.id], x: 20, y: 24, queue: true });
  w.tick();
  const v = view(w, a.id);
  assert.deepEqual(v.wp, [[12, 24, 0], [20, 24, 1]]);
  assert.deepEqual(v.pe, [12, 24], 'the patrol comes back to where the queue had it start');

  const b = spawn(w, 0, 'warrior', 10, 10);
  w.issueCommand(0, { type: 'patrol', units: [b.id], x: 20, y: 10 });
  w.tick();
  const pv = view(w, b.id);
  assert.deepEqual(pv.wp, [[20, 10, 1]]);
  assert.ok(Math.hypot(pv.pe[0] - 10, pv.pe[1] - 10) < 0.2);
});

test('at most WAYPOINTS_MAX points go out; work orders take the place they name', () => {
  const w = arena();
  const a = spawn(w, 0, 'warrior', 10, 20);
  w.issueCommand(0, { type: 'move', units: [a.id], x: 11, y: 20 });
  for (let i = 0; i < 8; i++) w.issueCommand(0, { type: 'move', units: [a.id], x: 12 + i, y: 20, queue: true });
  w.tick();
  assert.equal(view(w, a.id).wp.length, WAYPOINTS_MAX);

  const mine = [...w.entities.values()].find((e) => e.kind === 'mine');
  const wk = spawn(w, 0, 'worshipper', mine.x + 3, mine.y + 3);
  w.issueCommand(0, { type: 'gather', units: [wk.id], target: mine.id });
  w.tick();
  assert.equal(view(w, wk.id).wp, undefined, 'a worker on its gather loop sends nothing');
  w.issueCommand(0, { type: 'move', units: [wk.id], x: mine.x + 6, y: mine.y + 6 });
  w.issueCommand(0, { type: 'gather', units: [wk.id], target: mine.id, queue: true });
  w.tick();
  const v = view(w, wk.id);
  assert.equal(v.wp.length, 2);
  assert.deepEqual(v.wp[1], [Math.round(mine.x * 100) / 100, Math.round(mine.y * 100) / 100, 2]);
});

test('AI seats send no paths', () => {
  const w = arena();
  const e = spawn(w, 1, 'warrior', 30, 20);
  w.issueCommand(1, { type: 'move', units: [e.id], x: 34, y: 20 });
  w.issueCommand(1, { type: 'move', units: [e.id], x: 34, y: 26, queue: true });
  w.tick();
  assert.equal(e.orders.length, 1);
  assert.equal(view(w, e.id).wp, undefined);
});
