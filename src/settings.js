// Player settings, persisted in localStorage under 'mythicwar-settings'.
// Every storage access is guarded: private windows, blocked storage and Node
// (tests) simply fall back to in-memory settings.

const STORAGE_KEY = 'mythicwar-settings';
const QUALITIES = ['low', 'medium', 'high'];
const MAX_NAME_LENGTH = 20;

const listeners = new Set();
let current = null;

function randomName() {
  return `Player${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
}

function cleanName(name) {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, MAX_NAME_LENGTH).join('');
}

/** Defaults; the name gets 3 random digits once and is then saved. */
export function defaultSettings() {
  return { name: randomName(), volume: 0.7, quality: 'medium', edgeScroll: true, showAllBars: false };
}

/** Merge a raw object onto base, keeping only valid values. */
function sanitize(raw, base) {
  const out = { ...base };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.name === 'string' && cleanName(raw.name)) out.name = cleanName(raw.name);
  if (typeof raw.volume === 'number' && Number.isFinite(raw.volume)) out.volume = Math.min(1, Math.max(0, raw.volume));
  if (QUALITIES.includes(raw.quality)) out.quality = raw.quality;
  if (typeof raw.edgeScroll === 'boolean') out.edgeScroll = raw.edgeScroll;
  if (typeof raw.showAllBars === 'boolean') out.showAllBars = raw.showAllBars;
  return out;
}

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readStored() {
  try {
    const s = storage();
    const text = s && s.getItem(STORAGE_KEY);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeStored(value) {
  try {
    const s = storage();
    if (s) s.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage full or blocked: keep the in-memory copy.
  }
}

function load() {
  if (current) return current;
  const stored = readStored();
  current = Object.freeze(sanitize(stored, defaultSettings()));
  // Persist the generated default name so it stays the same next visit.
  if (!stored || stored.name !== current.name) writeStored(current);
  return current;
}

/**
 * Current settings (a frozen object; use saveSettings to change it).
 * @returns {{ name: string, volume: number, quality: 'low'|'medium'|'high', edgeScroll: boolean, showAllBars: boolean }}
 */
export function getSettings() {
  return load();
}

/**
 * Merge a partial update, persist it and notify listeners. Invalid values are ignored.
 * @param {object} patch
 * @returns {object} the new settings
 */
export function saveSettings(patch) {
  const prev = load();
  const next = Object.freeze(sanitize(patch, prev));
  const changed = Object.keys(next).filter((k) => next[k] !== prev[k]);
  current = next;
  writeStored(next);
  if (changed.length) {
    for (const cb of [...listeners]) {
      try {
        cb(next, changed);
      } catch (err) {
        console.error('[settings] listener failed', err);
      }
    }
  }
  return next;
}

/**
 * Subscribe to changes: cb(settings, changedKeys).
 * @returns {() => void} unsubscribe
 */
export function onSettingsChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Test helper: forget the cached copy (and optionally the stored one). */
export function _resetSettingsForTests({ clearStorage = false } = {}) {
  current = null;
  listeners.clear();
  if (clearStorage) {
    try {
      const s = storage();
      if (s) s.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export const SETTINGS_KEY = STORAGE_KEY;
export const QUALITY_LEVELS = QUALITIES;
