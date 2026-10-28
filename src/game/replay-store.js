// Where the replays live (DESIGN 9.5): in this browser on this device, in IndexedDB (a replay is a
// few hundred kilobytes of JSON, far past what localStorage holds), gzip-compressed where the browser
// has CompressionStream (to about a twentieth). The newest MAX_REPLAYS are kept; saving one more
// drops the oldest. Every call is async and never throws: storage that is off (a private window, a
// blocked site) just keeps nothing. Tests swap in a memory backend (setReplayBackend).
import { replayMeta, sanitizeReplay } from './replay.js';

export const MAX_REPLAYS = 12;
const DB_NAME = 'mythicwar-replays';
const DB_VERSION = 1;

// --------------------------------------------------------------- compression

async function pipe(bytes, Stream, mode) {
  const stream = new Blob([bytes]).stream().pipeThrough(new Stream(mode));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const canGzip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function';

/** JSON text as gzip bytes, or the text itself where the browser cannot compress. */
export async function packReplay(rec) {
  const json = JSON.stringify(rec);
  if (!canGzip()) return json;
  try {
    return await pipe(new TextEncoder().encode(json), CompressionStream, 'gzip');
  } catch {
    return json;
  }
}

/** The record from packReplay's output (or a file's bytes: gzip or plain JSON), checked; null if unusable. */
export async function unpackReplay(data) {
  try {
    let text;
    if (typeof data === 'string') text = data;
    else {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      const gz = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
      text = gz ? new TextDecoder().decode(await pipe(bytes, DecompressionStream, 'gzip')) : new TextDecoder().decode(bytes);
    }
    return sanitizeReplay(JSON.parse(text));
  } catch {
    return null;
  }
}

// --------------------------------------------------------------- backends

/** IndexedDB: 'meta' holds the list rows, 'data' the packed records, both keyed by id. */
function idbBackend() {
  let opening = null;
  const open = () => {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('replay storage is blocked'));
    });
    opening.catch(() => {
      opening = null;
    });
    return opening;
  };
  const done = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
  const result = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return {
    async list() {
      const db = await open();
      return result(db.transaction('meta').objectStore('meta').getAll());
    },
    async get(id) {
      const db = await open();
      const row = await result(db.transaction('data').objectStore('data').get(id));
      return row ? row.data : null;
    },
    async put(meta, data) {
      const db = await open();
      const tx = db.transaction(['meta', 'data'], 'readwrite');
      tx.objectStore('meta').put(meta);
      tx.objectStore('data').put({ id: meta.id, data });
      return done(tx);
    },
    async remove(id) {
      const db = await open();
      const tx = db.transaction(['meta', 'data'], 'readwrite');
      tx.objectStore('meta').delete(id);
      tx.objectStore('data').delete(id);
      return done(tx);
    },
  };
}

/** In memory (tests, or a browser without IndexedDB: the replays last until the page is closed). */
export function memoryBackend() {
  const meta = new Map();
  const data = new Map();
  return {
    async list() {
      return [...meta.values()].map((m) => ({ ...m }));
    },
    async get(id) {
      return data.has(id) ? data.get(id) : null;
    },
    async put(m, d) {
      meta.set(m.id, { ...m });
      data.set(m.id, d);
    },
    async remove(id) {
      meta.delete(id);
      data.delete(id);
    },
  };
}

let backend = null;
function store() {
  if (!backend) backend = typeof indexedDB !== 'undefined' && indexedDB ? idbBackend() : memoryBackend();
  return backend;
}

/** Use another backend (tests); null goes back to the default. */
export function setReplayBackend(b) {
  backend = b;
}

// --------------------------------------------------------------- API

const changeCbs = new Set();
/** cb() whenever the list changes (a replay saved or deleted). */
export function onReplaysChange(cb) {
  changeCbs.add(cb);
  return () => changeCbs.delete(cb);
}
function changed() {
  for (const cb of [...changeCbs]) {
    try {
      cb();
    } catch (err) {
      console.error('[replays] listener failed', err);
    }
  }
}

/** The kept replays' list rows, newest first ([] when storage is off). */
export async function listReplays() {
  try {
    const rows = await store().list();
    return (rows || []).filter((m) => m && typeof m.id === 'string').sort((a, b) => (b.date || 0) - (a.date || 0));
  } catch (err) {
    console.warn('[replays] could not read the list', err);
    return [];
  }
}

/**
 * Keep a replay record (ReplayRecorder.finish); the oldest past MAX_REPLAYS go. Resolves to its list
 * row, or null when it could not be stored.
 */
export async function saveReplay(rec) {
  if (!rec || typeof rec.id !== 'string') return null;
  try {
    const data = await packReplay(rec);
    const meta = { ...replayMeta(rec), commands: rec.cmds.length, bytes: typeof data === 'string' ? data.length : data.byteLength };
    await store().put(meta, data);
    const all = await listReplays();
    for (const old of all.slice(MAX_REPLAYS)) await store().remove(old.id);
    changed();
    return meta;
  } catch (err) {
    console.warn('[replays] could not save the replay', err);
    return null;
  }
}

/** A kept replay, checked (null when it is gone or unreadable). */
export async function loadReplay(id) {
  try {
    const data = await store().get(id);
    return data ? await unpackReplay(data) : null;
  } catch (err) {
    console.warn('[replays] could not load the replay', err);
    return null;
  }
}

/** The packed bytes of a kept replay, for a download (null when it is gone). */
export async function replayBytes(id) {
  try {
    const data = await store().get(id);
    if (!data) return null;
    return typeof data === 'string' ? new TextEncoder().encode(data) : data;
  } catch {
    return null;
  }
}

export async function deleteReplay(id) {
  try {
    await store().remove(id);
    changed();
    return true;
  } catch (err) {
    console.warn('[replays] could not delete the replay', err);
    return false;
  }
}
