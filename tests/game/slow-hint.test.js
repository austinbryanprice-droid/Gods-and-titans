// The slow-frame hint (src/game/slow-hint.js): a match whose median frame interval stays above 33 ms for a
// 10 s stretch at a quality above Low says once, per device, to lower Graphics quality in the F10 menu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlowFrameWatch, SLOW_HINT_KEY, slowHintText } from '../../src/game/slow-hint.js';

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

/** Feed `seconds` of frames `ms` apart; returns every hint given. */
function run(watch, { ms, seconds, quality = 'medium', from = 0 }) {
  const out = [];
  let t = from;
  for (let i = 0; i <= (seconds * 1000) / ms; i++) {
    t += ms;
    const h = watch.frame(t, quality);
    if (h) out.push(h);
  }
  return { out, t };
}

test('the words name the F10 menu and the current quality', () => {
  assert.equal(slowHintText('medium'), 'The game is running slowly. Lower Graphics quality in the [[F10]] menu (now: Medium).');
  assert.match(slowHintText('ultra'), /\(now: Ultra\)\.$/);
});

test('10 s of slow frames above Low gives the hint once, and it is kept for this device', () => {
  const store = memoryStore();
  const w = new SlowFrameWatch({ store });
  const first = run(w, { ms: 50, seconds: 9 });
  assert.deepEqual(first.out, [], 'not before 10 s');
  const more = run(w, { ms: 50, seconds: 30, from: first.t });
  assert.deepEqual(more.out, [slowHintText('medium')], 'once');
  assert.equal(store.getItem(SLOW_HINT_KEY), '1');
  assert.deepEqual(run(new SlowFrameWatch({ store }), { ms: 50, seconds: 30 }).out, [], 'not again on this device');
});

test('no hint at 30 fps or better, on Low, or across pauses; a few long frames do not count', () => {
  assert.deepEqual(run(new SlowFrameWatch({ store: memoryStore() }), { ms: 16.7, seconds: 30 }).out, []);
  assert.deepEqual(run(new SlowFrameWatch({ store: memoryStore() }), { ms: 33, seconds: 30 }).out, []);
  assert.deepEqual(run(new SlowFrameWatch({ store: memoryStore() }), { ms: 60, seconds: 30, quality: 'low' }).out, []);
  // fast frames with a long hitch every second: the median stays fast
  const w = new SlowFrameWatch({ store: memoryStore() });
  let t = 0;
  for (let i = 0; i < 3000; i++) {
    t += i % 60 === 0 ? 200 : 16;
    assert.equal(w.frame(t, 'high'), null);
  }
  // slow stretches broken by pauses (gaps over 250 ms) never fill a window
  const p = new SlowFrameWatch({ store: memoryStore() });
  t = 0;
  for (let k = 0; k < 10; k++) {
    t = run(p, { ms: 50, seconds: 8, from: t }).t + 5000;
  }
  assert.equal(p.done, false);
});

test('lowering the quality starts the stretch over; blocked storage still gives the hint once', () => {
  const w = new SlowFrameWatch({ store: memoryStore() });
  const a = run(w, { ms: 50, seconds: 8, quality: 'high' });
  const b = run(w, { ms: 50, seconds: 8, quality: 'medium', from: a.t });
  assert.deepEqual(b.out, [], 'the medium stretch is only 8 s long');
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(run(new SlowFrameWatch({ store: throwing }), { ms: 50, seconds: 30 }).out.length, 1);
});
