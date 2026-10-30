// Player settings, persisted in localStorage under 'mythicwar-settings'.
// Every storage access is guarded: private windows, blocked storage and Node
// (tests) simply fall back to in-memory settings.

import { GAME_SPEEDS, UI_SCALES } from './config.js';
import { TEAM_PALETTES } from './team-colors.js';
import { CARD_LAYOUTS, cleanBindings } from './ui/key-bindings.js';

const STORAGE_KEY = 'mythicwar-settings';
const QUALITIES = ['low', 'medium', 'high', 'ultra'];
// The sky: the day and night cycle that follows the match clock, or one time of day held
// for the whole match (the render side is src/render/atmosphere.js; a test keeps both lists equal).
const TIMES_OF_DAY = ['cycle', 'golden', 'day', 'dusk', 'night', 'dawn'];
// Alerts: how much the game speaks up (src/game/alerts.js). 'important' keeps only the warnings
// (enemies near, an ally under attack, the Decade of Peace ending); 'off' silences the reminders too.
const ALERT_LEVELS = ['all', 'important', 'off'];
// What a tab in the background does when the game needs the player (src/ui/tab-attention.js):
// nothing, flash the tab's title, or also raise a desktop notification (needs the browser's permission).
const TAB_ALERTS = ['off', 'title', 'notify'];
// Game speed of a match against the computer, and the size of the in-game interface (src/config.js).
const SPEEDS = Object.keys(GAME_SPEEDS);
const SCALES = Object.keys(UI_SCALES);
// When the intro film plays at the page's start (src/ui/intro.js introWanted): every launch, only until it has been
// seen once (`introSeen`), or never.
const INTRO_MODES = ['always', 'first', 'never'];
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

/**
 * Defaults; the name gets 3 random digits once and is then saved. `tipsDismissed`
 * becomes true once the player closes (or finishes) the in-game "getting started" tips.
 * `timeOfDay` is 'cycle' (day and night follow the match clock, opening on the golden morning)
 * or one fixed time of day. `alerts` is how much the game speaks up ('all', 'important', 'off'),
 * `hints` whether a gameplay tip appears now and then, `tabAlerts` what a background tab does
 * when the game needs the player ('off', 'title', 'notify'). `intro` is when the intro film plays
 * as the game opens (src/ui/intro.js): 'always', 'first' (until `introSeen`, set once it has played) or 'never'; and `narration` has a voice read its captions aloud
 * (src/intro/narrator.js). `aiChat` shows the computer players' in-character chat lines (src/ai/voice.js). `volume` is the sound effects; `musicVolume` (0..1) and `musicMuted`
 * are the background music's own (src/audio/music.js). `gameSpeed` is the pace of a match against the
 * computer (online games always run at normal speed) and `uiScale` the size of the in-game interface.
 * `teamColors` draws the teams in the lobby's colours or a colour-blind-safe set (src/team-colors.js),
 * `cardKeys` is the command card's key layout ('classic' letters or 'grid' by position) and `keyBindings`
 * the keys changed from their defaults (src/ui/key-bindings.js), kept per device like the rest.
 */
export function defaultSettings() {
  return { name: randomName(), volume: 0.7, quality: 'medium', timeOfDay: 'cycle', edgeScroll: true, showAllBars: false, tipsDismissed: false, alerts: 'all', hints: true, tabAlerts: 'title', intro: 'first', introSeen: false, narration: true, aiChat: true, musicVolume: 0.5, musicMuted: false, gameSpeed: 'normal', uiScale: 'normal', teamColors: 'standard', cardKeys: 'classic', keyBindings: Object.freeze({}) };
}

/** Merge a raw object onto base, keeping only valid values. */
function sanitize(raw, base) {
  const out = { ...base };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.name === 'string' && cleanName(raw.name)) out.name = cleanName(raw.name);
  if (typeof raw.volume === 'number' && Number.isFinite(raw.volume)) out.volume = Math.min(1, Math.max(0, raw.volume));
  if (QUALITIES.includes(raw.quality)) out.quality = raw.quality;
  if (TIMES_OF_DAY.includes(raw.timeOfDay)) out.timeOfDay = raw.timeOfDay;
  if (typeof raw.edgeScroll === 'boolean') out.edgeScroll = raw.edgeScroll;
  if (typeof raw.showAllBars === 'boolean') out.showAllBars = raw.showAllBars;
  if (typeof raw.tipsDismissed === 'boolean') out.tipsDismissed = raw.tipsDismissed;
  if (ALERT_LEVELS.includes(raw.alerts)) out.alerts = raw.alerts;
  if (typeof raw.hints === 'boolean') out.hints = raw.hints;
  if (TAB_ALERTS.includes(raw.tabAlerts)) out.tabAlerts = raw.tabAlerts;
  if (INTRO_MODES.includes(raw.intro)) out.intro = raw.intro;
  else if (typeof raw.intro === 'boolean') out.intro = raw.intro ? 'first' : 'never'; // a save from the on / off toggle
  if (typeof raw.introSeen === 'boolean') out.introSeen = raw.introSeen;
  if (typeof raw.narration === 'boolean') out.narration = raw.narration;
  if (typeof raw.aiChat === 'boolean') out.aiChat = raw.aiChat;
  if (typeof raw.musicVolume === 'number' && Number.isFinite(raw.musicVolume)) out.musicVolume = Math.min(1, Math.max(0, raw.musicVolume));
  if (typeof raw.musicMuted === 'boolean') out.musicMuted = raw.musicMuted;
  if (SPEEDS.includes(raw.gameSpeed)) out.gameSpeed = raw.gameSpeed;
  if (SCALES.includes(raw.uiScale)) out.uiScale = raw.uiScale;
  if (TEAM_PALETTES.includes(raw.teamColors)) out.teamColors = raw.teamColors;
  if (CARD_LAYOUTS.includes(raw.cardKeys)) out.cardKeys = raw.cardKeys;
  if (raw.keyBindings && typeof raw.keyBindings === 'object' && raw.keyBindings !== base.keyBindings) {
    const kb = cleanBindings(raw.keyBindings);
    const same = JSON.stringify(kb) === JSON.stringify(base.keyBindings || {});
    out.keyBindings = same ? base.keyBindings : Object.freeze(kb);
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
  // A save from before `introSeen` is a returning player's, who has seen the film (it played on every launch).
  const base = defaultSettings();
  if (stored && typeof stored === 'object' && typeof stored.introSeen !== 'boolean') base.introSeen = true;
  current = Object.freeze(sanitize(stored, base));
  // Persist the generated default name so it stays the same next visit.
  if (!stored || stored.name !== current.name || typeof stored.introSeen !== 'boolean') writeStored(current);
  return current;
}

/**
 * Current settings (a frozen object; use saveSettings to change it).
 * @returns {{ name: string, volume: number, quality: 'low'|'medium'|'high'|'ultra', timeOfDay: 'cycle'|'golden'|'day'|'dusk'|'night'|'dawn', edgeScroll: boolean, showAllBars: boolean, tipsDismissed: boolean, alerts: 'all'|'important'|'off', hints: boolean, tabAlerts: 'off'|'title'|'notify', intro: 'always'|'first'|'never', introSeen: boolean, narration: boolean, aiChat: boolean, musicVolume: number, musicMuted: boolean, gameSpeed: 'slow'|'normal'|'fast'|'faster', uiScale: 'small'|'normal'|'large'|'larger', teamColors: 'standard'|'colorblind', cardKeys: 'classic'|'grid', keyBindings: Object<string, string> }}
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
export const TIME_OF_DAY_MODES = TIMES_OF_DAY;
export const ALERT_LEVEL_IDS = ALERT_LEVELS;
export const TAB_ALERT_MODES = TAB_ALERTS;
export const INTRO_MODE_IDS = INTRO_MODES;
export const GAME_SPEED_IDS = SPEEDS;
export const UI_SCALE_IDS = SCALES;
export const TEAM_COLOR_IDS = TEAM_PALETTES;
export const CARD_KEY_LAYOUTS = CARD_LAYOUTS;
