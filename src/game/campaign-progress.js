// The campaign's progress on this device (DESIGN 5.16): which missions are won and the best game time of each,
// kept in localStorage under 'mythicwar-campaign' (nothing goes over the wire). A mission opens once the one before
// it is won, so a chapter's first mission opens with the last of the chapter before. Every storage access is guarded like src/game/career.js: blocked storage or Node keeps it in memory.
import { CHAPTER_BY_ID, MISSIONS, chapterOf } from '../data/campaign.js';

const STORAGE_KEY = 'mythicwar-campaign';

let current = null;

export function emptyProgress() {
  return { won: {} }; // mission id -> { best: seconds, at: unix ms of the first win }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Keep only valid entries of a stored progress. */
export function sanitizeProgress(raw) {
  const out = emptyProgress();
  if (!raw || typeof raw !== 'object' || !raw.won || typeof raw.won !== 'object') return out;
  for (const m of MISSIONS) {
    const r = raw.won[m.id];
    if (r && typeof r === 'object') out.won[m.id] = { best: num(r.best), at: num(r.at) };
  }
  return out;
}

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function getProgress() {
  if (current) return current;
  let raw = null;
  try {
    const s = storage();
    raw = s ? JSON.parse(s.getItem(STORAGE_KEY) || 'null') : null;
  } catch {
    raw = null;
  }
  current = sanitizeProgress(raw);
  return current;
}

function persist() {
  try {
    const s = storage();
    if (s) s.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // full or blocked: the progress lives on in memory for this visit
  }
}

/** Is this mission open to play: the first one, or the one after a mission won. */
export function isUnlocked(id, p = getProgress()) {
  const i = MISSIONS.findIndex((m) => m.id === id);
  if (i < 0) return false;
  return i === 0 || Object.hasOwn(p.won, MISSIONS[i - 1].id);
}

/** The mission to play next: the first open one not yet won (the last one once all are). */
export function nextToPlay(p = getProgress()) {
  return MISSIONS.find((m) => isUnlocked(m.id, p) && !Object.hasOwn(p.won, m.id)) || MISSIONS[MISSIONS.length - 1];
}

/** How many missions are won: of one chapter (its id), or of the whole campaign. */
export function wonCount(p = getProgress(), chapter = null) {
  const list = chapter && Object.hasOwn(CHAPTER_BY_ID, chapter) ? CHAPTER_BY_ID[chapter].missions : MISSIONS;
  return list.filter((m) => Object.hasOwn(p.won, m.id)).length;
}

/** Is a chapter open: its first mission is. */
export function chapterUnlocked(chapter, p = getProgress()) {
  const c = CHAPTER_BY_ID[chapter];
  return !!c && isUnlocked(c.missions[0].id, p);
}

/**
 * A mission was won after `seconds` of game time. Returns { first (never won before), best (the record now),
 * previous (the old record, 0 for none), chapterDone (this win finished its chapter for the first time) }.
 */
export function recordMission(id, seconds, now = Date.now()) {
  const p = getProgress();
  const t = Math.max(1, num(seconds));
  const before = p.won[id];
  const c = chapterOf(id);
  if (!c) return { first: false, best: 0, previous: 0, chapterDone: false };
  const wasDone = wonCount(p, c.id) === c.missions.length;
  p.won[id] = before ? { best: Math.min(before.best || t, t), at: before.at } : { best: t, at: now };
  persist();
  return { first: !before, best: p.won[id].best, previous: before ? before.best : 0, chapterDone: !wasDone && wonCount(p, c.id) === c.missions.length };
}

/** Forget everything (tests, and a reset from the chapter screen). */
export function resetProgress() {
  current = emptyProgress();
  persist();
}

/** Tests: drop the cached copy so the next read goes to storage. */
export function reloadProgress() {
  current = null;
}
