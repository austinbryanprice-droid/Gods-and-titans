// A production queue of up to MAX_QUEUE items on the wire (DESIGN 7): a client's cancelTrain reaches every slot
// of a full queue, and a deep queue costs a bounded amount in deltas and full snapshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_QUEUE, POP_MAX } from '../../src/config.js';
import { sanitizeCommand } from '../../src/net/sanitize.js';
import { encode, apply } from '../../src/net/delta.js';
import { makeWorld, place, runUntil } from '../sim/helpers.js';

const bounds = { width: 96, height: 96 };
const json = (v) => JSON.parse(JSON.stringify(v));
const bytes = (v) => Buffer.byteLength(JSON.stringify(v));

test('cancelTrain reaches every slot of a full queue and takes back up to a whole queue at once', () => {
  const cancel = (f) => sanitizeCommand({ type: 'cancelTrain', building: 9, ...f }, bounds);
  assert.deepEqual(cancel({ index: MAX_QUEUE - 1 }), { type: 'cancelTrain', building: 9, index: MAX_QUEUE - 1 });
  assert.deepEqual(cancel({ index: 0, count: MAX_QUEUE }), { type: 'cancelTrain', building: 9, index: 0, count: MAX_QUEUE });
  for (const count of [0, -1, 2.5, MAX_QUEUE + 1, '3', null, NaN, Infinity]) {
    assert.deepEqual(cancel({ index: 4, count }), { type: 'cancelTrain', building: 9, index: 4 }, `count ${count} is dropped`);
  }
  assert.deepEqual(cancel({ index: 64 }), { type: 'cancelTrain', building: 9 }, 'a slot past the end is dropped');
});

test('a 50-deep queue goes through the delta codec exactly, and only a change in its length resends it', () => {
  const w = makeWorld();
  const tc = w.buildingsOf(0).find((b) => b.type === 'town_center');
  Object.assign(w.players[0], { gold: 99999, popCap: POP_MAX });
  const snap = () => json(w.getSnapshot());
  const queue = (n) => {
    for (let i = 0; i < n; i++) w.issueCommand(0, { type: 'train', building: tc.id, unit: 'worshipper' });
    w.tick();
  };
  const qOf = (s) => s.entities.find((e) => e.id === tc.id).q;
  const send = (a, b) => {
    const d = json(encode(a, b));
    assert.deepEqual(json(apply(a, d)), b, 'the client rebuilds the host snapshot exactly');
    return bytes(d);
  };

  queue(MAX_QUEUE - 1);
  const a = snap();
  queue(1);
  const b = snap();
  assert.equal(qOf(b).length, MAX_QUEUE);
  w.tick();
  const c = snap();
  const grew = send(a, b);
  const progressed = send(b, c);
  assert.ok(grew < 2048, `one more item resends the queue: ${grew} bytes`);
  assert.ok(progressed < 100, `a tick of progress sends the head's fraction only: ${progressed} bytes`);

  // The head finishes: a unit appears and the queue shrinks by one.
  let prev = c;
  let shrank = 0;
  assert.ok(runUntil(w, () => {
    const next = snap();
    if (qOf(next).length < qOf(prev).length) {
      shrank = send(prev, next);
      return true;
    }
    send(prev, next);
    prev = next;
    return false;
  }, 20) > 0, 'the first Worshipper comes out');
  assert.ok(shrank < 2048, `a finished unit resends the queue and adds the unit: ${shrank} bytes`);
});

test('the population cap bounds how much queue a full snapshot can carry', () => {
  const w = makeWorld();
  const tc = w.buildingsOf(0).find((b) => b.type === 'town_center');
  const barracks = [place(w, 0, 'barracks', 20, 20), place(w, 0, 'barracks', 26, 20), place(w, 0, 'barracks', 32, 20)];
  Object.assign(w.players[0], { gold: 99999, wood: 99999, popCap: POP_MAX });
  for (let i = 0; i < MAX_QUEUE; i++) {
    for (const b of [tc, ...barracks]) w.issueCommand(0, { type: 'train', building: b.id, unit: b === tc ? 'worshipper' : 'warrior' });
  }
  w.tick();
  const queued = [tc, ...barracks].reduce((n, b) => n + b.queue.length, 0);
  assert.ok(queued > MAX_QUEUE * 2, `three Barracks and a Town Center hold ${queued} items`);
  assert.equal(w.players[0].popUsed, w.players[0].popCap, 'until the cap says no');
  assert.ok(queued <= POP_MAX, 'every queued unit takes at least one population, so a player never queues more than the cap');
  const inSnapshot = json(w.getSnapshot()).entities.reduce((n, e) => n + (e.q ? bytes(e.q) : 0), 0);
  assert.ok(inSnapshot < 4 * 1024, `${queued} queued items are ${inSnapshot} bytes of a full snapshot`);
});
