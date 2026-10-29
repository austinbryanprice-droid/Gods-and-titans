// Load Game in the F10 menu (src/ui/hud-overlays.js, src/game/game.js loadSave / leaveForLoad, DESIGN 9.4): shown
// next to Save Game in a solo match against the computer; it lists the saved games like the title screen and
// asks before leaving the match. Leaving counts like Quit to Menu, unless the save is of this very match.
// Fake DOM, fake game.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Overlays } from '../../src/ui/hud-overlays.js';
import { Game } from '../../src/game/game.js';
import { SAVES_KEY } from '../../src/game/save-store.js';
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

const flush = () => new Promise((r) => setTimeout(r, 0));

function setSaves(list) {
  mem.set(SAVES_KEY, JSON.stringify(Object.fromEntries(list.map((s) => [s.slot, s]))));
}

function setup({ savable = true, onLoad = true, time = 300, matchId = 'this-match', load = null } = {}) {
  const calls = { loads: [], quits: 0 };
  const game = {
    session: { isHost: true, clients: new Map() },
    viewState: { time, myIndex: 0, players: [] },
    setPaused: () => true,
    quitToMenu: () => calls.quits++,
    canSave: () => savable,
    canLoad: () => savable && onLoad,
    isOwnSave: (info) => info.matchId === matchId,
    loadSave: (slot) => {
      calls.loads.push(slot);
      return load ? load(slot) : Promise.resolve();
    },
    hud: { message: (text) => (calls.message = text) },
  };
  const root = document.createElement('div');
  const ov = new Overlays(root, game);
  return { ov, root, game, calls };
}

const buttons = (root) => root.all('button').map((b) => b.textContent);

test('the F10 menu has Load Game next to Save Game in a solo match against the computer, and not elsewhere', () => {
  const solo = setup();
  solo.ov.openMenu();
  const names = buttons(solo.root);
  assert.ok(names.includes('Load Game'));
  assert.equal(names.indexOf('Load Game'), names.indexOf('Save Game') + 1, 'right after Save Game');
  for (const o of [{ savable: false }, { onLoad: false }]) {
    const other = setup(o);
    other.ov.openMenu();
    assert.ok(!buttons(other.root).includes('Load Game'), JSON.stringify(o));
  }
});

test('Load Game lists the saved games like the title screen, newest first, and Back returns to the menu', () => {
  setSaves([
    { slot: '1', label: 'Greek vs Norse (Easy) · small map', time: 400, savedAt: Date.now() - 3600e3, matchId: 'old' },
    { slot: 'auto', label: 'Greek vs Norse (Normal) · small map', time: 1390, savedAt: Date.now() - 120e3, matchId: 'this-match' },
  ]);
  const { ov, root } = setup();
  ov.openMenu();
  root.button('Load Game').click();
  assert.equal(ov.name, 'loads');
  const rows = root.all('button').filter((b) => /^(Autosave|Slot)/.test(b.textContent));
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /^Autosave · this battle/);
  assert.match(rows[0].textContent, /Greek vs Norse \(Normal\) · small map · 23:10 · 2 min ago/);
  assert.match(rows[1].textContent, /^Slot 1Greek vs Norse \(Easy\)/);
  root.button('Back').click();
  assert.equal(ov.name, 'menu');
  root.button('Load Game').click();
  ov.escape();
  assert.equal(ov.name, 'menu', 'Esc goes back too');
});

test('with no saved games the panel says so', () => {
  mem.delete(SAVES_KEY);
  const { ov, root } = setup();
  ov.openLoads();
  assert.match(root.textContent, /No saved games yet/);
});

test('loading another game asks first and says it counts as a loss; Cancel goes back to the list', async () => {
  setSaves([{ slot: '2', label: 'Egyptian vs Aztec (Hard)', time: 90, savedAt: Date.now(), matchId: 'other' }]);
  const { ov, root, calls } = setup();
  ov.openLoads();
  root.all('button').find((b) => b.textContent.startsWith('Slot 2')).click();
  assert.equal(ov.name, 'confirm');
  assert.match(root.textContent, /Load Slot 2\?/);
  assert.match(root.textContent, /counts as a loss in your career, like Quit to Menu/);
  root.button('Cancel').click();
  assert.equal(ov.name, 'loads');
  assert.equal(calls.loads.length, 0);
  root.all('button').find((b) => b.textContent.startsWith('Slot 2')).click();
  root.button('Load').click();
  assert.deepEqual(calls.loads, ['2']);
  assert.match(root.textContent, /Loading the saved game/);
});

test('loading a save of this very match says nothing about a loss; a failed load returns to the list with the reason', async () => {
  setSaves([{ slot: 'auto', label: 'Greek vs Norse', time: 900, savedAt: Date.now(), matchId: 'this-match' }]);
  const { ov, root, calls } = setup({ load: () => Promise.reject(new Error('That saved game is gone.')) });
  ov.openLoads();
  root.all('button').find((b) => b.textContent.startsWith('Autosave')).click();
  assert.doesNotMatch(root.textContent, /loss/);
  assert.match(root.textContent, /What happened since it was saved is lost/);
  root.button('Load').click();
  await flush();
  assert.equal(ov.name, 'loads');
  assert.equal(calls.message, 'Could not load: That saved game is gone.');
});

test('in the first minute leaving is not called a loss (it is not counted, like Quit to Menu)', () => {
  setSaves([{ slot: '3', label: 'x', time: 10, savedAt: Date.now(), matchId: 'other' }]);
  const { ov, root } = setup({ time: 30 });
  ov.openLoads();
  root.all('button').find((b) => b.textContent.startsWith('Slot 3')).click();
  assert.doesNotMatch(root.textContent, /loss/);
});

test('the game leaves for a loaded save: counted like a quit, except for a save of this very match', async () => {
  const fake = (matchId) => ({ disposed: false, counted: 0, saver: { matchId }, countLeave() { this.counted++; }, dispose() { this.disposed = true; } });
  const other = fake('m1');
  Game.prototype.leaveForLoad.call(other, { resume: { extra: { matchId: 'm2' } } });
  assert.equal(other.counted, 1);
  assert.equal(other.disposed, true);
  const own = fake('m1');
  Game.prototype.leaveForLoad.call(own, { resume: { extra: { matchId: 'm1' } } });
  assert.equal(own.counted, 0, 'nothing counted');
  assert.equal(own.disposed, true);
  const noId = fake('m1');
  Game.prototype.leaveForLoad.call(noId, { resume: { extra: {} } });
  assert.equal(noId.counted, 1, 'a save without an id is another match');
  // loadSave: only where loading is allowed; it hands main.js the slot and the leave step.
  const g = { disposed: false, canLoad: () => true, onLoad: async (slot, leave) => ({ slot, leave }) };
  const res = await Game.prototype.loadSave.call(g, '2');
  assert.equal(res.slot, '2');
  assert.equal(typeof res.leave, 'function');
  await assert.rejects(Game.prototype.loadSave.call({ ...g, canLoad: () => false }, '2'), /cannot be loaded now/);
  // isOwnSave compares the slot's match id with this match's.
  assert.equal(Game.prototype.isOwnSave.call({ saver: { matchId: 'm1' } }, { matchId: 'm1' }), true);
  assert.equal(Game.prototype.isOwnSave.call({ saver: { matchId: 'm1' } }, { matchId: 'm2' }), false);
  assert.equal(Game.prototype.isOwnSave.call({ saver: null }, { matchId: 'm1' }), false);
});
