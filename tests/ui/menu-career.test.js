// The Career screen's body (src/ui/menu-career.js): the profile numbers, every pantheon, the last
// games, and the gallery with the unlocked, locked, new and in-progress achievements. Fake DOM.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, FakeElement } from './fake-dom.js';
import { sanitizeCareer } from '../../src/game/career.js';
import { ACHIEVEMENTS } from '../../src/data/achievements.js';

before(() => {
  installFakeDom();
  if (typeof globalThis.Node === 'undefined') globalThis.Node = FakeElement; // menu-dom's h() checks instanceof Node
});

test('the career screen lists the profile, the pantheons, the last games and every achievement', async () => {
  const { renderCareerContent, formatPlayTime } = await import('../../src/ui/menu-career.js');
  const c = sanitizeCareer({
    games: 5, wins: 3, losses: 2, seconds: 3725, kills: 140,
    pantheons: { norse: { games: 4, wins: 3 }, greek: { games: 1, wins: 0 } },
    best: { kills: 60 },
    unlocked: { first_victory: 1, win_norse: 2 },
    history: [{ r: 'victory', p: 'norse', t: 900 }, { r: 'defeat', p: 'greek', t: 400 }],
  });
  const root = document.createElement('div');
  for (const n of renderCareerContent(c, new Set(['win_norse']))) root.appendChild(n);
  const text = root.textContent;
  assert.match(text, /60%/);
  assert.match(text, /Norse/);
  assert.match(text, /1 h 2 min/);
  assert.match(text, new RegExp(`2 / ${ACHIEVEMENTS.length}`));
  for (const a of ACHIEVEMENTS) assert.ok(text.includes(a.name), a.name);
  assert.match(text, /New/);
  assert.match(text, /3 \/ 10/, 'Warlord shows its progress');
  assert.equal(formatPlayTime(125), '2 min');
});
