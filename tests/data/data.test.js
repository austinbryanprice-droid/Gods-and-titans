import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData, PANTHEON_LIST, UNITS, BUILDINGS } from '../../src/data/index.js';

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

test('data icons stay within Emoji 11 so older systems draw them', () => {
  // Emoji 12+ is U+1FA70.. (Extended-A) plus a few older-block additions; those render as
  // empty boxes on Windows 10, macOS before 11.1 and Android before 11.
  const newer = /[\u{1FA70}-\u{1FAFF}\u{1F6D5}\u{1F6FA}-\u{1F6FC}\u{1F7E0}-\u{1F7EB}\u{1F90C}\u{1F90F}\u{1F971}\u{1F972}\u{1F977}\u{1F978}\u{1F97B}\u{1F9A5}-\u{1F9AA}\u{1F9BB}-\u{1F9BF}\u{1F9C9}-\u{1F9CF}]/u;
  const icons = [];
  for (const u of Object.values(UNITS)) {
    icons.push([u.id, u.icon]);
    for (const a of u.abilities || []) icons.push([a.id, a.icon]);
    for (const p of u.passives || []) if (p.icon) icons.push([u.id, p.icon]);
  }
  for (const b of Object.values(BUILDINGS)) icons.push([b.id, b.icon]);
  for (const [id, icon] of icons) assert.ok(!newer.test(icon), `${id} icon ${icon} needs Emoji 12 or newer`);
});
