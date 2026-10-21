// Settings persistence (src/settings.js) with a fake localStorage.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getSettings, saveSettings, onSettingsChange, defaultSettings, _resetSettingsForTests, SETTINGS_KEY } from '../../src/settings.js';

class FakeStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

beforeEach(() => {
  globalThis.localStorage = new FakeStorage();
  _resetSettingsForTests();
});

test('defaults: random 3-digit player name, volume 0.7, medium quality, edge scroll on', () => {
  const s = getSettings();
  assert.match(s.name, /^Player\d{3}$/);
  assert.equal(s.volume, 0.7);
  assert.equal(s.quality, 'medium');
  assert.equal(s.edgeScroll, true);
  assert.equal(s.showAllBars, false);
  assert.ok(Object.isFrozen(s));
  // the generated name is persisted so it stays the same next visit
  const stored = JSON.parse(globalThis.localStorage.getItem(SETTINGS_KEY));
  assert.equal(stored.name, s.name);
  _resetSettingsForTests();
  assert.equal(getSettings().name, s.name);
});

test('saveSettings merges, validates, persists and notifies', () => {
  const seen = [];
  const off = onSettingsChange((s, changed) => seen.push([s.volume, changed]));
  const next = saveSettings({ volume: 0.25, quality: 'extreme', edgeScroll: 'yes', name: '  Zeus   Fan  ' });
  assert.equal(next.volume, 0.25);
  assert.equal(next.quality, 'medium'); // invalid value ignored
  assert.equal(next.edgeScroll, true); // non-boolean ignored
  assert.equal(next.name, 'Zeus Fan');
  assert.deepEqual(seen, [[0.25, ['name', 'volume']]]);
  assert.equal(JSON.parse(globalThis.localStorage.getItem(SETTINGS_KEY)).volume, 0.25);
  saveSettings({ volume: 0.25 }); // no change → no notification
  assert.equal(seen.length, 1);
  off();
  saveSettings({ volume: 0.5 });
  assert.equal(seen.length, 1);
  // every quality the Settings menu offers is accepted
  for (const q of ['low', 'high', 'ultra', 'medium']) assert.equal(saveSettings({ quality: q }).quality, q, q);
});

test('clamps volume and limits the name to 20 characters', () => {
  assert.equal(saveSettings({ volume: 7 }).volume, 1);
  assert.equal(saveSettings({ volume: -1 }).volume, 0);
  assert.equal(saveSettings({ name: 'x'.repeat(40) }).name.length, 20);
  const before = getSettings().name;
  assert.equal(saveSettings({ name: '   ' }).name, before); // empty name ignored
});

test('loads stored settings and ignores corrupt or hostile values', () => {
  globalThis.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ name: 'Athena', volume: 0.3, quality: 'high', edgeScroll: false, showAllBars: true, extra: 1 }));
  _resetSettingsForTests();
  assert.deepEqual({ ...getSettings() }, { name: 'Athena', volume: 0.3, quality: 'high', timeOfDay: 'cycle', edgeScroll: false, showAllBars: true, tipsDismissed: false });
  globalThis.localStorage.setItem(SETTINGS_KEY, '{not json');
  _resetSettingsForTests();
  assert.equal(getSettings().volume, 0.7);
});

test('works without storage at all, and when storage throws', () => {
  delete globalThis.localStorage;
  _resetSettingsForTests();
  assert.equal(getSettings().quality, 'medium');
  assert.equal(saveSettings({ quality: 'low' }).quality, 'low');
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  _resetSettingsForTests();
  assert.equal(getSettings().volume, 0.7);
  assert.equal(saveSettings({ volume: 0.4 }).volume, 0.4);
  assert.ok(defaultSettings().name.startsWith('Player'));
});

test('tipsDismissed: false by default, only booleans accepted, remembered across reloads', () => {
  assert.equal(getSettings().tipsDismissed, false);
  assert.equal(saveSettings({ tipsDismissed: 'yes' }).tipsDismissed, false);
  const seen = [];
  onSettingsChange((s, changed) => seen.push(changed));
  assert.equal(saveSettings({ tipsDismissed: true }).tipsDismissed, true);
  assert.deepEqual(seen, [['tipsDismissed']]);
  _resetSettingsForTests();
  assert.equal(getSettings().tipsDismissed, true);
  assert.equal(saveSettings({ tipsDismissed: false }).tipsDismissed, false);
});

test('timeOfDay: the day and night cycle by default, only the known times accepted, remembered across reloads', () => {
  assert.equal(getSettings().timeOfDay, 'cycle');
  assert.equal(saveSettings({ timeOfDay: 'midnight' }).timeOfDay, 'cycle');
  assert.equal(saveSettings({ timeOfDay: 7 }).timeOfDay, 'cycle');
  const seen = [];
  onSettingsChange((s, changed) => seen.push(changed));
  for (const t of ['golden', 'day', 'dusk', 'night', 'dawn', 'cycle']) assert.equal(saveSettings({ timeOfDay: t }).timeOfDay, t, t);
  assert.deepEqual(seen.length, 6);
  saveSettings({ timeOfDay: 'night' });
  _resetSettingsForTests();
  assert.equal(getSettings().timeOfDay, 'night');
});
