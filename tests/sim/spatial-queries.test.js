import test from 'node:test';
import assert from 'node:assert/strict';
import { titanFor } from '../../src/data/index.js';
import { buildingsNear } from '../../src/sim/building-grid.js';
import { findTarget } from '../../src/sim/combat.js';
import { distPointRect } from '../../src/sim/common.js';
import { makeWorld, place, spawn, clearUnits } from './helpers.js';

function townWorld() {
  const w = makeWorld({ map: { width: 64, height: 64 } });
  clearUnits(w, 0);
  clearUnits(w, 1);
  let k = 0;
  for (let ty = 4; ty < 58; ty += 5) {
    for (let tx = 4; tx < 58; tx += 6) {
      if (w.canPlaceBuilding(k % 2, 'house', tx, ty)) place(w, k % 2, 'house', tx, ty);
      k++;
    }
  }
  return w;
}

const near = (w, x, y, r) => w.buildingList.filter((b) => distPointRect(x, y, b.tx, b.ty, b.tx + b.size, b.ty + b.size) <= r);

test('buildingsNear finds every building in reach, in buildingList order', () => {
  const w = townWorld();
  assert.ok(w.buildingList.length > 40);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 300; i++) {
    const x = rnd() * 70 - 3;
    const y = rnd() * 70 - 3;
    const r = rnd() * 20;
    const got = buildingsNear(w, x, y, r, []).filter((b) => distPointRect(x, y, b.tx, b.ty, b.tx + b.size, b.ty + b.size) <= r);
    assert.deepEqual(got.map((b) => b.id), near(w, x, y, r).map((b) => b.id));
  }
  // The grid follows the list: a new building, and the dead dropped by cleanup.
  const b = place(w, 0, 'house', 60, 60);
  assert.ok(buildingsNear(w, 61, 61, 1, []).includes(b));
  b.dead = true;
  w.cleanup();
  assert.ok(!buildingsNear(w, 61, 61, 1, []).includes(b));
});

test('findTarget picks the nearest building, the first in the list on a tie', () => {
  const w = makeWorld({ map: { width: 64, height: 64 } });
  clearUnits(w, 0);
  clearUnits(w, 1);
  const a = place(w, 1, 'house', 30, 20);
  const b = place(w, 1, 'house', 30, 26);
  place(w, 1, 'house', 50, 50);
  const u = spawn(w, 0, 'archer', 31, 24);
  // Equally far from both houses (the gap between them is centred on the archer).
  const dA = distPointRect(u.x, u.y, a.tx, a.ty, a.tx + a.size, a.ty + a.size);
  const dB = distPointRect(u.x, u.y, b.tx, b.ty, b.tx + b.size, b.ty + b.size);
  assert.equal(dA, dB);
  assert.equal(findTarget(w, u, 6), a);
  assert.equal(findTarget(w, u, 6, { spots: true }), a);
  assert.equal(findTarget(w, u, 6, { exclude: a.id }), b);
  assert.equal(findTarget(w, u, 0.5), null);
});

test('maxRadius shrinks back once the largest unit is gone', () => {
  const w = makeWorld();
  const base = w.maxRadius;
  const titan = spawn(w, 0, titanFor(w.players[0].pantheon).id, 20, 20);
  assert.ok(titan.radius > base);
  assert.equal(w.maxRadius, titan.radius);
  w.killEntity(titan, null, true);
  w.tick();
  assert.equal(w.maxRadius, base);
});
