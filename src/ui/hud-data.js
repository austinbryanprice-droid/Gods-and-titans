// Shared lookups for the HUD, the command card and the input controller:
// entity definitions, names, icons, subgroup ordering and small helpers that
// read a ViewState. Pure (no DOM), so Node tests can use it.
import { UNITS, BUILDINGS, GOLD_MINE, PANTHEONS, UPGRADES } from '../data/index.js';
import { MINE_TIME, CARRY_AMOUNT, PEACE_NAME } from '../config.js';
import { NO_MODS, computeMods, workSpeed } from '../data/upgrades.js';
import { MANOR } from '../data/houses.js';
import { peaceClock } from '../sim/peace.js';

/** Subgroup order (WC3 sorts heroes first): lower comes first. */
const CLASS_ORDER = { god: 0, titan: 1, creature: 2, infantry: 3, ranged: 4, siege: 5, support: 6, minion: 7, worker: 8 };

/** Unit type, building type or the gold mine definition of a view entity. */
export function defOf(e) {
  if (!e) return null;
  if (e.k === 'u') return UNITS[e.t] || null;
  if (e.k === 'b') return BUILDINGS[e.t] || null;
  if (e.k === 'm') return GOLD_MINE;
  return null;
}

/** Display name of an entity (town centers use their tier name). */
export function nameOf(e) {
  const d = defOf(e);
  if (!d) return e ? String(e.t) : '';
  if (e.k === 'b' && e.t === 'town_center' && d.tierNames) return d.tierNames[Math.max(0, Math.min(2, (e.tr || 1) - 1))];
  return d.name;
}

/** Emoji icon of an entity. */
export function iconOf(e) {
  const d = defOf(e);
  return (d && d.icon) || '❔';
}

/** Icon for a unit / building type id. */
export function typeIcon(typeId) {
  const d = UNITS[typeId] || BUILDINGS[typeId] || UPGRADES[typeId];
  if (typeId === 'tier_up') return '⬆️';
  return (d && d.icon) || '❔';
}

/** Name for a unit / building type id. */
export function typeName(typeId) {
  if (typeId === 'tier_up') return 'Growing';
  const d = UNITS[typeId] || BUILDINGS[typeId] || UPGRADES[typeId];
  return (d && d.name) || String(typeId);
}

/** Sort key of a unit type for subgroups (gods first, workers last). */
export function subgroupRank(typeId) {
  const d = UNITS[typeId];
  if (!d) return 50;
  return CLASS_ORDER[d.class] ?? 20;
}

/** Is the building finished? */
export function isComplete(e) {
  return !!e && e.k === 'b' && (e.bp === undefined || e.bp >= 1) && e.st !== 'build';
}

/** Is this view entity a wall segment (wooden or stone)? */
export function isWallEntity(e) {
  return !!e && e.k === 'b' && !!BUILDINGS[e.t] && BUILDINGS[e.t].wall === true;
}

/** Is this view entity a House whose square is being combined into a Manor (sim/homes.js)? */
export function isMergingEntity(e) {
  return !!e && e.k === 'b' && (e.q || []).some((it) => it.u === MANOR);
}

/**
 * Ids of a selection given as an array or as { ids }.
 * @returns {number[]}
 */
export function selectionIds(selection) {
  if (!selection) return [];
  if (Array.isArray(selection)) return selection;
  return Array.isArray(selection.ids) ? selection.ids : [];
}

/**
 * Subgroups of a selection: [{ type, ids }] in display order (gods first).
 * Only living entities present in the view are counted.
 */
export function subgroups(ids, vs) {
  const map = new Map();
  for (const id of ids) {
    const e = vs.entities.get(id);
    if (!e) continue;
    let g = map.get(e.t);
    if (!g) map.set(e.t, (g = { type: e.t, kind: e.k, ids: [] }));
    g.ids.push(id);
  }
  return [...map.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'u' ? -1 : 1;
    return subgroupRank(a.type) - subgroupRank(b.type) || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0);
  });
}

/** Living own buildings of a type. completedOnly skips construction sites. */
export function ownBuildings(vs, typeId = null, completedOnly = false) {
  const out = [];
  for (const e of vs.entities.values()) {
    if (e.k !== 'b' || e.o !== vs.myIndex) continue;
    if (typeId && e.t !== typeId) continue;
    if (completedOnly && !isComplete(e)) continue;
    out.push(e);
  }
  return out;
}

/** Format seconds as m:ss (or h:mm:ss). */
export function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Tier names for the top bar and messages. */
export const TIER_NAMES = ['Village', 'Town', 'City'];
export function tierName(t) {
  return TIER_NAMES[Math.max(0, Math.min(2, (t || 1) - 1))];
}

/**
 * "You lead the Norse pantheon." from the game setup (the lobby's Random is already
 * drawn there), or '' for a spectator / an unknown pantheon.
 */
export function leadText(vs) {
  const players = vs && vs.setup && vs.setup.players;
  const mine = players && vs.myIndex >= 0 ? players[vs.myIndex] : null;
  const pantheon = mine && PANTHEONS[mine.pantheon];
  return pantheon ? `You lead the ${pantheon.name} pantheon.` : '';
}

/** Seconds left on the Decade of Peace clock at which the HUD speaks up once (the second is when the clock starts to pulse). */
export const PEACE_WARNINGS = [300, 60, 10];

/** The line the HUD shows once, as a game with a Decade of Peace opens. */
export function peaceStartText(sec) {
  return `The ${PEACE_NAME} is on: no fighting between players, and no building near an enemy Town Center, for another ${peaceClock(sec)}. Build, train and mass your armies.`;
}

/** The reminder at a PEACE_WARNINGS mark: "The Decade of Peace ends in 5 minutes." */
export function peaceWarning(sec) {
  const when = sec >= 60 ? `${Math.round(sec / 60)} minute${sec === 60 ? '' : 's'}` : `${sec} seconds`;
  return `The ${PEACE_NAME} ends in ${when}. Get your armies ready.`;
}

// ---- The message feed (bottom-left of the HUD, drawn by hud.js)

/** The emblem a message card wears when its sender names none, by kind. */
export const MESSAGE_ICONS = { info: '📜', good: '✨', alert: '⚠️', system: '📢', chat: '💬' };

/** The emblems of the three resources, for the cards that name one (a shipment from a teammate). */
export const RESOURCE_ICONS = { gold: '💰', wood: '🌲', faith: '✨' };

/** A card's emblem: the sender's own (a unit's or building's emoji) when it is a short string, else the kind's. */
export function messageIcon(kind, icon) {
  if (typeof icon === 'string' && icon !== '' && [...icon].length <= 8) return icon;
  return Object.hasOwn(MESSAGE_ICONS, kind) ? MESSAGE_ICONS[kind] : MESSAGE_ICONS.info;
}

const MESSAGE_BASE_MS = 8500; // a card stays this long, plus a little per letter, between the next two
const MESSAGE_MS_PER_CHAR = 45;
const MESSAGE_MIN_MS = 10000;
const MESSAGE_MAX_MS = 16000;
const MESSAGE_ALERT_EXTRA_MS = 2500; // a warning stays a little longer than a note

/** How long a message card stays on screen: 10 to 16 s by length ([[Key]] markers count as the key's name), 2.5 s more for a warning. */
export function messageDwell(text, kind) {
  const letters = String(text ?? '').replace(/\[\[(.+?)\]\]/g, '$1').length;
  const ms = Math.min(MESSAGE_MAX_MS, Math.max(MESSAGE_MIN_MS, MESSAGE_BASE_MS + letters * MESSAGE_MS_PER_CHAR));
  return kind === 'alert' ? ms + MESSAGE_ALERT_EXTRA_MS : ms;
}

// An AI's taunt at the top centre (Hud.showTaunt, DESIGN 10.1): long enough to read twice, short enough not to linger.
const TAUNT_BASE_MS = 4500;
const TAUNT_MS_PER_CHAR = 55;
const TAUNT_MIN_MS = 6000;
const TAUNT_MAX_MS = 9500;

/** How long an AI's taunt stays at the top centre: 6 to 9.5 s by length. */
export function tauntDwell(text) {
  const letters = String(text ?? '').length;
  return Math.min(TAUNT_MAX_MS, Math.max(TAUNT_MIN_MS, TAUNT_BASE_MS + letters * TAUNT_MS_PER_CHAR));
}

/**
 * The connection warning for a joined (client) session while the host has been silent
 * for STALL_NOTICE_MS (session.stalled / stalledMs), else '' (also for a HostSession,
 * which has neither property, and for no session).
 */
export function stallText(session) {
  if (!session || session.isHost || session.stalled !== true) return '';
  const ms = Number.isFinite(session.stalledMs) ? session.stalledMs : 0;
  return `Connection problem: waiting for the host… (${Math.max(0, Math.floor(ms / 1000))}s)`;
}

// ---- Worshipper tasks (the snapshot's `tk`, see sim/snapshot.js workerTask)

/** Task rows in display order. */
export const WORKER_TASKS = [
  { id: 'gold', icon: '⛏️', label: 'Mining gold' },
  { id: 'wood', icon: '🌲', label: 'Chopping wood' },
  { id: 'pray', icon: '🙏', label: 'Praying' },
  { id: 'build', icon: '🔨', label: 'Building' },
  { id: 'repair', icon: '🔧', label: 'Repairing' },
  { id: 'idle', icon: '💤', label: 'Idle' },
  { id: 'other', icon: '🚶', label: 'Walking or fighting' },
];
const TASK_IDS = new Set(WORKER_TASKS.map((t) => t.id));

/** Task of a worshipper view entity ('other' when the host did not say). */
export function taskOf(e) {
  if (e.tk && TASK_IDS.has(e.tk)) return e.tk;
  if (e.st === 'idle' && !e.bo) return 'idle';
  return 'other';
}

/**
 * Own worshippers by task: { counts: { gold: n, … }, ids: { gold: [id…], … }, total }.
 * @param {object} vs ViewState
 * @param {number[]} [only] limit to these entity ids (a selection)
 */
export function workerTasks(vs, only = null) {
  const counts = {};
  const ids = {};
  for (const t of WORKER_TASKS) {
    counts[t.id] = 0;
    ids[t.id] = [];
  }
  let total = 0;
  const list = only ? only.map((id) => vs.entities.get(id)) : vs.entities.values();
  for (const e of list) {
    if (!e || e.k !== 'u' || e.o !== vs.myIndex) continue;
    const d = UNITS[e.t];
    if (!d || d.class !== 'worker') continue;
    const t = taskOf(e);
    counts[t]++;
    ids[t].push(e.id);
    total++;
  }
  for (const t of WORKER_TASKS) ids[t.id].sort((a, b) => a - b);
  return { counts, ids, total };
}

/** Own worshippers working at a building: { build, repair, pray } counts. */
export function workersAt(vs, buildingId) {
  const out = { build: 0, repair: 0, pray: 0 };
  for (const e of vs.entities.values()) {
    if (e.k !== 'u' || e.o !== vs.myIndex || e.tg !== buildingId) continue;
    const t = taskOf(e);
    if (t === 'build' || t === 'repair' || t === 'pray') out[t]++;
  }
  return out;
}

// ---- Upgrades

/** Upgrade ids a player has researched (from the snapshot's players[i].up). */
export function upgradesOf(vs, owner) {
  const p = Number.isInteger(owner) && owner >= 0 ? vs.players[owner] : null;
  return p && Array.isArray(p.up) ? p.up : [];
}

const modsCache = new Map();
/** Pantheon id of a player in the view (null for a spectator slot or neutral). */
export function pantheonOf(vs, owner) {
  if (!Number.isInteger(owner) || owner < 0) return null;
  const p = (vs.players && vs.players[owner]) || (vs.setup && vs.setup.players && vs.setup.players[owner]);
  return p && typeof p.pantheon === 'string' && Object.hasOwn(PANTHEONS, p.pantheon) ? p.pantheon : null;
}

/**
 * Combined effects of a player's pantheon blessings and researched upgrades
 * (data/upgrades.js computeMods), cached by pantheon and upgrade list.
 */
export function modsOf(vs, owner) {
  const up = upgradesOf(vs, owner);
  const pantheon = pantheonOf(vs, owner);
  if (!up.length && !pantheon) return NO_MODS;
  const key = `${pantheon || ''}|${up.join(',')}`;
  let m = modsCache.get(key);
  if (!m) {
    if (modsCache.size > 64) modsCache.clear();
    m = computeMods(up, pantheon);
    modsCache.set(key, m);
  }
  return m;
}

/** "Normal" or "+30%": how much faster a player's Worshippers work (Work Songs and its later levels). */
export function workText(mods) {
  const pct = Math.round((workSpeed(mods) - 1) * 100);
  return pct > 0 ? `+${pct}%` : 'Normal';
}

/** "1.3 s per 12 gold": one mining trip with the player's work speed and Iron Picks. */
export function mineTripText(mods) {
  const secs = Math.round((MINE_TIME / workSpeed(mods)) * 10) / 10;
  return `${secs} s per ${CARRY_AMOUNT + mods.carry.g} gold`;
}
