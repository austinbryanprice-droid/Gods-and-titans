// Where saved games live (DESIGN 9.4): on this device only. A save's state (a few hundred KB of
// JSON, gzipped when the browser can) goes to IndexedDB; a small index of the slots (what each
// holds, for the title screen and the save panel) goes to localStorage under 'mythicwar-saves'.
// Slots: 'auto' (the autosave, also what Continue loads) and three for the player.
//
//   listSaves()                      // [{ slot, savedAt, time, label, … }] newest first
//   await writeSave(slot, save, info)
//   await readSave(slot)             // the save object (save-game.js packMatch), or null
//   await deleteSave(slot)

export const SAVES_KEY = 'mythicwar-saves';
export const AUTO_SLOT = 'auto';
export const SLOTS = ['1', '2', '3'];
const DB_NAME = 'mythicwar-saves';
const STORE = 'saves';

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // storage blocked
  }
}

/** The slot index: { slot: info }. */
function readIndex(store) {
  if (!store) return {};
  try {
    const v = JSON.parse(store.getItem(SAVES_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function writeIndex(store, index) {
  if (!store) return false;
  try {
    store.setItem(SAVES_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

const VALID = new Set([AUTO_SLOT, ...SLOTS]);

/** Every filled slot's info, newest first. */
export function listSaves(store = storage()) {
  const index = readIndex(store);
  return Object.values(index).filter((s) => s && VALID.has(s.slot)).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

/** One slot's info, or null. */
export function saveInfo(slot, store = storage()) {
  const s = readIndex(store)[slot];
  return s && VALID.has(s.slot) ? s : null;
}

// ------------------------------------------------------------------ IndexedDB

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot keep saved games (no IndexedDB).'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Saved games could not be opened.'));
    req.onblocked = () => reject(new Error('Saved games are busy in another tab.'));
  }).catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function request(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    let value;
    req.onsuccess = () => (value = req.result);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error || req.error || new Error('Saved games could not be written.'));
    tx.onabort = () => reject(tx.error || new Error('Saving was cancelled (is the disk full?).'));
  }));
}

/** The default backend: IndexedDB. Tests pass a Map-like { get, set, delete } of their own. */
export const idbBackend = {
  get: (key) => request('readonly', (s) => s.get(key)),
  set: (key, value) => request('readwrite', (s) => s.put(value, key)),
  delete: (key) => request('readwrite', (s) => s.delete(key)),
};

// ------------------------------------------------------------------ compression

async function gzip(text) {
  if (typeof CompressionStream !== 'function' || typeof Blob !== 'function' || typeof Response !== 'function') return null;
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

// ------------------------------------------------------------------ slots

/**
 * Store a save in a slot.
 * @param {string} slot AUTO_SLOT or one of SLOTS
 * @param {object} save packMatch's object
 * @param {object} info what the slot list shows ({ label, time, pantheon, matchId, skirmish, … })
 * @returns {Promise<object>} the slot's info as stored
 */
export async function writeSave(slot, save, info = {}, { backend = idbBackend, store = storage(), now = Date.now() } = {}) {
  if (!VALID.has(slot)) throw new Error(`No save slot ${slot}.`);
  const text = JSON.stringify(save);
  const packed = await gzip(text);
  const record = packed ? { z: 1, data: packed } : { z: 0, data: text };
  await backend.set(slot, record);
  const entry = { ...info, slot, savedAt: now, bytes: packed ? packed.length : text.length };
  const index = readIndex(store);
  index[slot] = entry;
  if (!writeIndex(store, index)) throw new Error('The list of saved games could not be updated (storage is blocked or full).');
  return entry;
}

/** The save in a slot, or null when the slot is empty. Throws when it cannot be read. */
export async function readSave(slot, { backend = idbBackend } = {}) {
  if (!VALID.has(slot)) return null;
  const record = await backend.get(slot);
  if (!record) return null;
  const text = record.z ? await gunzip(record.data) : record.data;
  return JSON.parse(text);
}

/** Empty a slot. */
export async function deleteSave(slot, { backend = idbBackend, store = storage() } = {}) {
  const index = readIndex(store);
  delete index[slot];
  writeIndex(store, index);
  try {
    await backend.delete(slot);
  } catch {
    // the index no longer lists it: an orphan record is harmless
  }
}

/** "12 min ago", "yesterday 18:04", or a date, for the slot list. */
export function savedAgo(savedAt, now = Date.now()) {
  const s = Math.max(0, (now - savedAt) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  const d = new Date(savedAt);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (s < 86400 && new Date(now).getDate() === d.getDate()) return `today ${hm}`;
  if (s < 2 * 86400) return `yesterday ${hm}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
}
