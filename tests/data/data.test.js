import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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

// Emoji 12+ is U+1FA70.. (Extended-A) plus a few older-block additions; those render as
// empty boxes on Windows 10, macOS before 11.1 and Android before 11. (ZWJ sequences such as
// the polar bear or the heart on fire are Emoji 13 as a whole, so U+200D is flagged too.)
const NEWER_EMOJI = /[\u{1FA70}-\u{1FAFF}\u{1F6D5}-\u{1F6D7}\u{1F6DC}-\u{1F6DF}\u{1F6FA}-\u{1F6FC}\u{1F7E0}-\u{1F7EB}\u{1F7F0}\u{1F90C}-\u{1F90F}\u{1F93F}\u{1F971}\u{1F972}\u{1F977}-\u{1F97B}\u{1F9A3}-\u{1F9AF}\u{1F9BA}-\u{1F9BF}\u{1F9C3}-\u{1F9CF}\u{26A7}\u{200D}]/u;

test('data icons stay within Emoji 11 so older systems draw them', () => {
  const icons = [];
  for (const u of Object.values(UNITS)) {
    icons.push([u.id, u.icon]);
    for (const a of u.abilities || []) icons.push([a.id, a.icon]);
    for (const p of u.passives || []) if (p.icon) icons.push([u.id, p.icon]);
  }
  for (const b of Object.values(BUILDINGS)) icons.push([b.id, b.icon]);
  for (const [id, icon] of icons) assert.ok(!NEWER_EMOJI.test(icon), `${id} icon ${icon} needs Emoji 12 or newer`);
});

test('UI strings stay within Emoji 11 too (HUD chips, command card, menu, tips)', () => {
  const dir = new URL('../../src/ui/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 10, 'found the src/ui modules');
  for (const f of files) {
    readFileSync(new URL(f, dir), 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(new RegExp(NEWER_EMOJI.source, 'gu'));
      assert.ok(!m, `src/ui/${f}:${i + 1} uses ${m && m.map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(' ')} (Emoji 12 or newer: an empty box on older systems)`);
    });
  }
});
