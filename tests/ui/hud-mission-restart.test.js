// Restart Mission in the F10 menu (src/ui/hud-overlays.js): the campaign's objective panel says "F10 opens the menu,
// where you can restart the mission", so a mission's game menu has a Restart Mission button that asks first and
// then starts the mission again (Game.rematch, the end screen's Retry Mission). Fake DOM, fake game.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Overlays } from '../../src/ui/hud-overlays.js';
import { MISSION_BY_ID } from '../../src/data/campaign.js';
import { installFakeDom } from './fake-dom.js';

const mem = new Map();
const hadStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
before(() => {
  installFakeDom();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
});
after(() => {
  if (hadStorage) Object.defineProperty(globalThis, 'localStorage', hadStorage);
  else delete globalThis.localStorage;
});

function setup({ mission = MISSION_BY_ID.hordaland, gameOver = null, replay = null } = {}) {
  const calls = { rematches: 0, quits: 0 };
  const game = {
    mission,
    replay,
    session: { isHost: true, clients: new Map() },
    viewState: { time: 300, myIndex: 0, players: [], gameOver },
    setPaused: () => true,
    quitToMenu: () => calls.quits++,
    canSave: () => false,
    canRematch: () => true,
    rematch: () => calls.rematches++,
  };
  const root = document.createElement('div');
  const ov = new Overlays(root, game);
  return { ov, root, calls };
}

const buttons = (root) => root.all('button').map((b) => b.textContent);

test('a campaign mission\'s F10 menu offers Restart Mission, as its objective panel promises', () => {
  const { ov, root, calls } = setup();
  ov.openMenu();
  assert.ok(buttons(root).includes('Restart Mission'));
  root.button('Restart Mission').click();
  root.button('Cancel').click();
  assert.equal(calls.rematches, 0, 'Cancel keeps the mission going');
  assert.ok(buttons(root).includes('Restart Mission'), 'back on the menu');
  root.button('Restart Mission').click();
  root.button('Restart').click();
  assert.equal(calls.rematches, 1);
  assert.equal(calls.quits, 0);
});

test('Restart Mission is only in a mission still being played', () => {
  for (const o of [{ mission: null }, { gameOver: { winningTeam: 1 } }, { replay: { record: {} } }]) {
    const { ov, root } = setup(o);
    ov.openMenu();
    assert.ok(!buttons(root).includes('Restart Mission'), JSON.stringify(Object.keys(o)));
  }
});
