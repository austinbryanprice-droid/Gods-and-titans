import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData, PANTHEON_LIST, UNITS } from '../../src/data/index.js';

test('all game data is valid', () => {
  const errors = validateData();
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('ten pantheons with 4 gods, a titan and 3 creatures each', () => {
  assert.equal(PANTHEON_LIST.length, 10);
  for (const p of PANTHEON_LIST) {
    assert.equal(p.gods.length, 4, p.id);
    assert.ok(p.titan, p.id);
    assert.equal(p.creatures.length, 3, p.id);
  }
  assert.ok(Object.keys(UNITS).length >= 5 + 80);
});
