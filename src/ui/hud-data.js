// Shared lookups for the HUD, the command card and the input controller:
// entity definitions, names, icons, subgroup ordering and small helpers that
// read a ViewState. Pure (no DOM), so Node tests can use it.
import { UNITS, BUILDINGS, GOLD_MINE, PANTHEONS, UPGRADES } from '../data/index.js';
import { NO_MODS, computeMods } from '../data/upgrades.js';

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
/** Combined upgrade effects of a player (data/upgrades.js computeMods), cached by upgrade list. */
export function modsOf(vs, owner) {
  const up = upgradesOf(vs, owner);
  if (!up.length) return NO_MODS;
  const key = up.join(',');
  let m = modsCache.get(key);
  if (!m) {
    if (modsCache.size > 64) modsCache.clear();
    m = computeMods(up);
    modsCache.set(key, m);
  }
  return m;
}
