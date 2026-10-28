// The daily challenge (DESIGN 9.3): one seeded game against the computer per calendar day, the same
// for everyone (map seed, my pantheon, the rivals' pantheons and difficulty, a twist from
// src/data/twists.js), with the chronicle's score kept as today's best on this device and a streak of
// days played. Client only: localStorage 'mythicwar-daily', guarded like src/settings.js. The lobby
// module (src/net/lobby.js, loaded lazily by the menu) is passed in, since it builds the setup.

import { PANTHEON_LIST } from '../data/pantheon-list.js';
import { TWISTS } from '../data/twists.js';
import { hashSeed, RNG } from '../sim/rng.js';

export const DAILY_KEY = 'mythicwar-daily';
const KEEP_DAYS = 60; // days of results kept

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // storage blocked
  }
}

const pad = (n) => String(n).padStart(2, '0');

/** The local calendar day of a date as 'YYYY-MM-DD'. */
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The day before (or `n` days from) a day key. */
export function shiftDay(day, n) {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  return dayKey(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
}

/**
 * The challenge of a day: everything comes from the day's key, so every device draws the same one.
 * @returns {{ day, seed, twist, pantheon, enemies: string[] (pantheon ids), allies: string[], difficulty: string[] }}
 */
export function dailyChallenge(day = dayKey()) {
  const rng = new RNG(hashSeed(`daily:${day}`));
  const seed = (hashSeed(`daily:${day}:map`) % 0x7ffffffe) + 1;
  // Twists come round in a shuffled cycle, so the same one does not fall on two days running.
  const twist = TWISTS[cycleIndex(day, TWISTS.length)];
  const pool = PANTHEON_LIST.map((p) => p.id);
  const take = () => pool.splice(rng.int(0, pool.length - 1), 1)[0];
  const pantheon = take();
  const allies = Array.from({ length: twist.allies || 0 }, take);
  const difficulty = twist.enemies || ['normal'];
  const enemies = difficulty.map(take);
  return { day, seed, twist, pantheon, allies, enemies, difficulty };
}

/** Day number since 2026-01-01 (UTC math on the date only, so a clock change does not skip a day). */
function dayNumber(day) {
  const m = DAY_RE.exec(day);
  return m ? Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000) : 0;
}

/** Index into a list of `n` for a day: each run of n days uses every entry once, in a seeded order. */
function cycleIndex(day, n) {
  const d = dayNumber(day);
  const cycle = Math.floor(d / n);
  const order = Array.from({ length: n }, (_, i) => i);
  const rng = new RNG(hashSeed(`daily-cycle:${cycle}`));
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order[((d % n) + n) % n];
}

/** The lobby state of a challenge: me in slot 0, my AI allies, then the rivals on one team. */
export function dailyLobbyState(ch, name = '') {
  const slots = [{ kind: 'host', name, pantheon: ch.pantheon, team: 1, color: 0 }];
  for (const p of ch.allies) slots.push({ kind: 'ai', pantheon: p, team: 1, color: slots.length, difficulty: 'normal' });
  ch.enemies.forEach((p, i) => slots.push({ kind: 'ai', pantheon: p, team: 2, color: slots.length, difficulty: ch.difficulty[i] }));
  while (slots.length < 4) slots.push({ kind: 'closed', team: slots.length + 1, color: slots.length });
  return {
    mapSize: ch.twist.mapSize || (slots.filter((s) => s.kind !== 'closed').length > 2 ? 'medium' : 'small'),
    peace: 0,
    survival: !!ch.twist.survival,
    sacred: !!ch.twist.sacred,
    slots,
  };
}

/** A launch (as the menu gives main.startGame) for a day's challenge; `daily` marks it for the record. */
export function dailyLaunch(lobbyMod, day = dayKey(), name = '') {
  const ch = dailyChallenge(day);
  const st = lobbyMod.sanitizeLobbyState(dailyLobbyState(ch, name));
  const { setup, slotToPlayer } = lobbyMod.buildSetup(st, ch.seed);
  if (ch.twist.start) setup.twist = ch.twist.id;
  return { role: 'host', setup, myIndex: slotToPlayer.get(0), conns: new Map(), lobby: null, daily: day };
}

/** "Golden Age · as the Norse vs the Aztec" for the title screen. */
export function dailyLabel(ch) {
  const name = (id) => (PANTHEON_LIST.find((p) => p.id === id) || { name: id }).name;
  const mine = [ch.pantheon, ...ch.allies].map(name).join(' & ');
  const vs = ch.twist.survival ? 'the monsters' : ch.enemies.map(name).join(' & ');
  return `${ch.twist.name} · ${mine} vs ${vs}`;
}

// ------------------------------------------------------------------ the record

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Clean a stored record: { days: { 'YYYY-MM-DD': { best, plays, won } } }, the last KEEP_DAYS days. */
export function sanitizeDaily(raw) {
  const days = {};
  const src = raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object' ? raw.days : {};
  const keys = Object.keys(src).filter((k) => DAY_RE.test(k)).sort().slice(-KEEP_DAYS);
  for (const k of keys) {
    const d = src[k];
    if (!d || typeof d !== 'object') continue;
    const plays = num(d.plays);
    if (plays > 0) days[k] = { best: num(d.best), plays, won: d.won === true };
  }
  return { days };
}

export function loadDaily(store = storage()) {
  if (!store) return sanitizeDaily(null);
  try {
    const raw = store.getItem(DAILY_KEY);
    return sanitizeDaily(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeDaily(null);
  }
}

/**
 * Days played in a row up to today. A streak not yet extended today still counts until the day is
 * over (it ends at yesterday), so the title screen can say "play today to keep it".
 */
export function streakOf(rec, today = dayKey()) {
  let day = rec.days[today] ? today : shiftDay(today, -1);
  let n = 0;
  while (day && rec.days[day]) {
    n++;
    day = shiftDay(day, -1);
  }
  return n;
}

/**
 * Count a finished daily game: its score, and whether it was won. Returns what the game-over screen
 * shows: { score, best, previous, isNew, streak, plays }.
 */
export function recordDaily(day, score, won, store = storage(), today = dayKey()) {
  const rec = loadDaily(store);
  const d = rec.days[day] || { best: 0, plays: 0, won: false };
  const previous = d.plays > 0 ? d.best : 0;
  const s = num(score);
  rec.days[day] = { best: Math.max(d.best, s), plays: d.plays + 1, won: d.won || won === true };
  const clean = sanitizeDaily(rec);
  if (store) {
    try {
      store.setItem(DAILY_KEY, JSON.stringify(clean));
    } catch {
      // storage full or blocked: the result is still shown
    }
  }
  return { score: s, best: clean.days[day].best, previous, isNew: d.plays === 0 || s > d.best, first: d.plays === 0, streak: streakOf(clean, today), plays: d.plays + 1 };
}

/** What the title screen shows for today: the challenge, today's best (null before a game) and the streak. */
export function dailyStatus(today = dayKey(), store = storage()) {
  const rec = loadDaily(store);
  const d = rec.days[today] || null;
  return { challenge: dailyChallenge(today), today: d, streak: streakOf(rec, today), playedToday: !!d };
}
