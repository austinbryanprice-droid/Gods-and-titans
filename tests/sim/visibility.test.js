import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVisibility } from '../../src/sim/visibility.js';

test('sight circles have no lone tile sticking out at the top and bottom', () => {
  for (const s of [{ x: 12.3, y: 12.8, r: 8 }, { x: 12.5, y: 12.5, r: 7 }, { x: 10, y: 10, r: 6 }]) {
    const vis = computeVisibility(24, 24, [s]);
    let n = 0;
    for (let i = 0; i < vis.length; i++) {
      if (!vis[i]) continue;
      n++;
      const dy = Math.floor(i / 24) + 0.5 - s.y;
      assert.ok(Math.abs(dy) <= s.r, `tile ${i} row centre is ${Math.abs(dy)} away, sight ${s.r}`);
    }
    assert.ok(vis[Math.floor(s.y) * 24 + Math.floor(s.x)], 'own tile is visible');
    assert.ok(n > Math.PI * s.r * s.r * 0.8 && n < Math.PI * s.r * s.r * 1.2, `area ${n}`);
  }
});

test('visibility marks explored tiles and clips at the map edge', () => {
  const explored = new Uint8Array(100);
  const vis = computeVisibility(10, 10, [{ x: 0.5, y: 0.5, r: 3 }], explored);
  assert.equal(vis[0], 1);
  assert.equal(explored[0], 1);
  assert.equal(vis[9 * 10 + 9], 0);
  assert.equal(explored[9 * 10 + 9], 0);
});
