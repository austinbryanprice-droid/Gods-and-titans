import test from 'node:test';
import assert from 'node:assert/strict';
import { MapState } from '../../src/sim/map-state.js';
import { makeMap } from './helpers.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test('spiralNearest: exact ties are symmetric under 180° and 90° rotation of the map', () => {
  const N = 24;
  const map = new MapState(makeMap({ width: N, height: N }));
  const r = rng(7);
  // A set of tiles symmetric under 90° rotation about the centre.
  const set = new Set();
  const rot90 = (x, y) => [N - 1 - y, x];
  for (let i = 0; i < 18; i++) {
    let x = Math.floor(r() * N);
    let y = Math.floor(r() * N);
    for (let k = 0; k < 4; k++) {
      set.add(y * N + x);
      [x, y] = rot90(x, y);
    }
  }
  const pred = (x, y) => set.has(y * N + x);
  let ties = 0;
  for (let i = 0; i < 3000; i++) {
    // Tile centres and tile corners give the most exact ties.
    const qx = Math.floor(r() * N * 2) / 2;
    const qy = Math.floor(r() * N * 2) / 2;
    if (qx === N / 2 && qy === N / 2) continue; // the centre itself has no symmetric answer
    const a = map.spiralNearest(qx, qy, 30, pred);
    // 180°: (x, y) → (N - x, N - y) for points, (N - 1 - tx, N - 1 - ty) for tiles.
    const b = map.spiralNearest(N - qx, N - qy, 30, pred);
    assert.deepEqual(b, { tx: N - 1 - a.tx, ty: N - 1 - a.ty }, `query ${qx},${qy}`);
    // 90°: point (x, y) → (N - y, x), tile (tx, ty) → (N - 1 - ty, tx).
    const c = map.spiralNearest(N - qy, qx, 30, pred);
    assert.deepEqual(c, { tx: N - 1 - a.ty, ty: a.tx }, `query ${qx},${qy} (90°)`);
    // Count queries that had a tie.
    let n = 0;
    const d = (a.tx + 0.5 - qx) ** 2 + (a.ty + 0.5 - qy) ** 2;
    for (const k of set) if (Math.abs(((k % N) + 0.5 - qx) ** 2 + (Math.floor(k / N) + 0.5 - qy) ** 2 - d) < 1e-9) n++;
    if (n > 1) ties++;
  }
  assert.ok(ties > 100, `ties ${ties}`);
});

test('spiralNearest: still the nearest tile; bad input returns null quickly', () => {
  const map = new MapState(makeMap({ width: 32, height: 32, forest: [{ x: 20, y: 5, w: 2, h: 2 }] }));
  const pred = (x, y) => map.isForest(x, y);
  assert.deepEqual(map.spiralNearest(18.2, 5.6, 10, pred), { tx: 20, ty: 5 });
  assert.deepEqual(map.spiralNearest(23.9, 7.9, 10, pred), { tx: 21, ty: 6 });
  assert.equal(map.spiralNearest(5, 5, 4, pred), null, 'out of reach');
  const t0 = performance.now();
  for (const [x, y] of [[NaN, 1], [1, Infinity], [1e308, 1], [-1e308, -1e308], [Number.MAX_SAFE_INTEGER, 3], [3, -9007199254740991]]) {
    assert.equal(map.spiralNearest(x, y, 6, pred), null, `${x},${y}`);
  }
  assert.equal(map.spiralNearest(10, 10, Infinity, () => false), null);
  assert.equal(map.spiralNearest(10, 10, NaN, () => true)?.tx, 10, 'NaN radius searches only the tile itself');
  assert.ok(performance.now() - t0 < 200);
  // From just outside the map, tiles inside are still found.
  assert.deepEqual(map.spiralNearest(-1.5, 5.5, 4, (x, y) => x === 0 && y === 5), { tx: 0, ty: 5 });
});
