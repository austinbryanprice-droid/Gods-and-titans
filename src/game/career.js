// The player's career (DESIGN 9.1): games, wins and losses, wins per pantheon, records and
// unlocked achievements, kept in localStorage under 'mythicwar-career' on this device only
// (nothing goes over the wire). Every storage access is guarded like src/settings.js: a
// private window, blocked storage or Node (tests) keep the career in memory instead.
import { PANTHEON_LIST } from '../data/pantheon-list.js';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID } from '../data/achievements.js';

const STORAGE_KEY = 'mythicwar-career';
const HISTORY = 12; // the last games shown on the career screen
const RESULTS = ['victory', 'defeat', 'draw', 'survival']; // survival: a finished Trial of the Titans (no win, no loss)

let current = null;
const listeners = new Set();

/** A career with nothing played. */
export function emptyCareer() {
  return {
    games: 0, wins: 0, losses: 0, draws: 0,
    aiWins: 0, // wins against a team with a computer player in it (Play vs AI then starts on Normal, not Easy)
    seconds: 0, // game time played, in seconds
    kills: 0, gathered: 0,
    pantheons: {}, // id -> { games, wins }
    best: { kills: 0, gathered: 0, longest: 0, wave: 0, medal: 0 }, // medal: the guided first match's best (1 bronze … 3 gold)
    unlocked: {}, // achievement id -> unix ms when unlocked
    unseen: [], // unlocked since the career screen was last opened
    history: [], // newest first: { r: result, p: pantheon, t: seconds, at: unix ms }
  };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Keep only valid values from a stored career (an old or hand-edited one must not break the menu). */
export function sanitizeCareer(raw) {
  const out = emptyCareer();
  if (!raw || typeof raw !== 'object') return out;
  for (const k of ['games', 'wins', 'losses', 'draws', 'aiWins', 'seconds', 'kills', 'gathered']) out[k] = num(raw[k]);
  out.aiWins = Math.min(out.aiWins, out.wins);
  if (raw.pantheons && typeof raw.pantheons === 'object') {
    for (const p of PANTHEON_LIST) {
      const r = raw.pantheons[p.id];
      if (r && typeof r === 'object') out.pantheons[p.id] = { games: num(r.games), wins: Math.min(num(r.wins), num(r.games)) };
    }
  }
  if (raw.best && typeof raw.best === 'object') for (const k in out.best) out.best[k] = num(raw.best[k]);
  if (raw.unlocked && typeof raw.unlocked === 'object') {
    for (const id in raw.unlocked) if (Object.hasOwn(ACHIEVEMENT_BY_ID, id)) out.unlocked[id] = num(raw.unlocked[id]);
  }
  if (Array.isArray(raw.unseen)) out.unseen = [...new Set(raw.unseen.filter((id) => Object.hasOwn(out.unlocked, id)))];
  if (Array.isArray(raw.history)) {
    out.history = raw.history
      .filter((g) => g && RESULTS.includes(g.r))
      .slice(0, HISTORY)
      .map((g) => ({ r: g.r, p: PANTHEON_LIST.some((p) => p.id === g.p) ? g.p : null, t: num(g.t), at: num(g.at) }));
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

function persist() {
  try {
    const s = storage();
    if (s) s.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // storage full or blocked: keep the in-memory career
  }
  for (const fn of listeners) {
    try {
      fn(current);
    } catch (err) {
      console.warn('[career] listener failed', err);
    }
  }
}

/** The career (loaded once from storage). Treat it as read-only. */
export function getCareer() {
  if (!current) {
    let raw = null;
    try {
      const s = storage();
      const text = s && s.getItem(STORAGE_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch {
      raw = null;
    }
    current = sanitizeCareer(raw);
  }
  return current;
}

/** Called after every change. Returns an unsubscribe function. */
export function onCareerChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests: forget the cached career (the next getCareer reads storage again), or start from `raw`. */
export function resetCareer(raw = undefined) {
  current = raw === undefined ? null : sanitizeCareer(raw);
}

/**
 * Unlock every achievement whose test passes for this match (`m`, see career-tracker.js) and the
 * career `c`. Mutates c; returns the newly unlocked achievement definitions.
 */
export function checkAchievements(m, c, now = Date.now()) {
  const got = [];
  for (const a of ACHIEVEMENTS) {
    if (Object.hasOwn(c.unlocked, a.id)) continue;
    let pass = false;
    try {
      pass = !!a.test(m, c);
    } catch {
      pass = false;
    }
    if (!pass) continue;
    c.unlocked[a.id] = now;
    c.unseen.push(a.id);
    got.push(a);
  }
  return got;
}

/** Mid-match: unlock what this match has already earned (m.result is null). Saves only on a change. */
export function checkLive(m) {
  const c = getCareer();
  const got = checkAchievements({ ...m, result: null }, c);
  if (got.length) persist();
  return got;
}

/**
 * Count a finished match (m.result 'victory' | 'defeat' | 'draw') and unlock its achievements.
 * Returns the achievements this call unlocked.
 */
export function recordMatch(m, now = Date.now()) {
  if (!m || !RESULTS.includes(m.result)) return [];
  const c = getCareer();
  const t = num(m.time);
  c.games++;
  if (m.result === 'victory') {
    c.wins++;
    if (Array.isArray(m.enemies) && m.enemies.some((e) => e && e.kind === 'ai')) c.aiWins++;
  } else if (m.result === 'defeat') c.losses++;
  else if (m.result === 'draw') c.draws++;
  c.seconds += t;
  c.kills += num(m.kills);
  c.gathered += num(m.gathered);
  if (m.pantheon && PANTHEON_LIST.some((p) => p.id === m.pantheon)) {
    const r = c.pantheons[m.pantheon] || (c.pantheons[m.pantheon] = { games: 0, wins: 0 });
    r.games++;
    if (m.result === 'victory') r.wins++;
  }
  c.best.kills = Math.max(c.best.kills, num(m.kills));
  c.best.gathered = Math.max(c.best.gathered, num(m.gathered));
  c.best.longest = Math.max(c.best.longest, t);
  if (m.wave) c.best.wave = Math.max(c.best.wave, num(m.wave));
  c.history.unshift({ r: m.result, p: m.pantheon || null, t, at: now });
  c.history.length = Math.min(c.history.length, HISTORY);
  const got = checkAchievements(m, c, now);
  persist();
  return got;
}

/**
 * The guided first match was won with a medal (rank 1 bronze … 3 gold). It is not counted as a game:
 * it keeps the best medal and unlocks the achievements about it. Returns the achievements it unlocked.
 */
export function recordTutorial(rank, now = Date.now()) {
  const r = Math.min(3, num(rank));
  if (!r) return [];
  const c = getCareer();
  c.best.medal = Math.max(c.best.medal, r);
  const got = checkAchievements({ tutorial: true, medal: r, result: null }, c, now);
  persist();
  return got;
}

// Achievements that can only be won against the computer: a career from before aiWins was kept still shows its wins.
const BEAT_AI_ACHIEVEMENTS = ['proving_ground', 'hard_won', 'undaunted'];

/** Has this device's player ever won against the computer (any difficulty)? */
export function hasBeatenComputer(c = getCareer()) {
  return c.aiWins > 0 || BEAT_AI_ACHIEVEMENTS.some((id) => Object.hasOwn(c.unlocked, id));
}

/** The career screen was opened: nothing is new any more. */
export function markSeen() {
  const c = getCareer();
  if (!c.unseen.length) return;
  c.unseen = [];
  persist();
}

/** Derived numbers for the profile: win rate, favourite pantheon, best pantheon. */
export function careerSummary(c = getCareer()) {
  const decided = c.wins + c.losses + c.draws;
  let favourite = null;
  let best = null;
  for (const p of PANTHEON_LIST) {
    const r = c.pantheons[p.id];
    if (!r || !r.games) continue;
    if (!favourite || r.games > c.pantheons[favourite].games) favourite = p.id;
    if (r.wins && (!best || r.wins > c.pantheons[best].wins)) best = p.id;
  }
  return {
    winRate: decided ? c.wins / decided : 0,
    favourite,
    best,
    unlocked: ACHIEVEMENTS.filter((a) => Object.hasOwn(c.unlocked, a.id)).length,
    total: ACHIEVEMENTS.length,
  };
}
