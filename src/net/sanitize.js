// Validation of untrusted network input (DESIGN 7). The host treats everything
// a client sends as hostile: commands are rebuilt from a whitelist of command
// types and typed fields before they reach World.issueCommand. Clients check
// what a (possibly buggy) host sends before it reaches the ViewState: the
// GameSetup from `start` and every snapshot. Pure: runs in Node too.
import { MAX_PLAYERS, PLAYER_COLORS, TRADE_RESOURCES, TRADE_MAX, PEACE_LENGTHS } from '../config.js';
import { UNITS, BUILDINGS, ABILITIES, PANTHEONS, UPGRADES } from '../data/index.js';
import { sanitizeName } from './protocol.js';

const hasOwn = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const MAX_COMMAND_UNITS = 256;

// Field kinds of a command; each returns the clean value or undefined (invalid / absent).
const FIELD = {
  id: (v) => (Number.isSafeInteger(v) && v > 0 ? v : undefined),
  units: (v) => {
    if (!Array.isArray(v)) return undefined;
    const out = [];
    const seen = new Set();
    for (const id of v) {
      if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= MAX_COMMAND_UNITS) break;
    }
    return out;
  },
  x: (v, b) => (Number.isFinite(v) ? Math.min(b.width, Math.max(0, v)) : undefined),
  y: (v, b) => (Number.isFinite(v) ? Math.min(b.height, Math.max(0, v)) : undefined),
  tx: (v, b) => (Number.isFinite(v) ? Math.min(b.width - 1, Math.max(0, Math.floor(v))) : undefined),
  ty: (v, b) => (Number.isFinite(v) ? Math.min(b.height - 1, Math.max(0, Math.floor(v))) : undefined),
  bool: (v) => v === true,
  index: (v) => (Number.isInteger(v) && v >= 0 && v < 64 ? v : undefined),
  unitType: (v) => (hasOwn(UNITS, v) ? v : undefined),
  buildingType: (v) => (hasOwn(BUILDINGS, v) ? v : undefined),
  ability: (v) => (hasOwn(ABILITIES, v) ? v : undefined),
  upgrade: (v) => (hasOwn(UPGRADES, v) ? v : undefined),
  resource: (v) => (TRADE_RESOURCES.includes(v) ? v : undefined),
  amount: (v) => (Number.isSafeInteger(v) && v > 0 && v <= TRADE_MAX ? v : undefined),
};

// Command type → { field: [kind, required] } (DESIGN 6.2). Anything else is dropped.
const U = ['units', true];
const Q = ['bool', false];
const XO = ['x', false];
const YO = ['y', false];
const TGT = ['id', false];
const COMMANDS = {
  move: { units: U, x: ['x', true], y: ['y', true], queue: Q },
  attackMove: { units: U, x: ['x', true], y: ['y', true], queue: Q },
  attack: { units: U, target: ['id', true], queue: Q },
  smart: { units: U, x: XO, y: YO, target: TGT, tx: ['tx', false], ty: ['ty', false], queue: Q },
  gather: { units: U, target: TGT, tx: ['tx', false], ty: ['ty', false], x: XO, y: YO, queue: Q },
  pray: { units: U, target: ['id', true], queue: Q },
  returnCargo: { units: U, queue: Q },
  build: { units: U, building: ['buildingType', true], tx: ['tx', true], ty: ['ty', true], tx2: ['tx', false], ty2: ['ty', false], queue: Q },
  train: { building: ['id', true], unit: ['unitType', true] },
  cancelTrain: { building: ['id', true], index: ['index', false] },
  upgradeTier: { building: ['id', true] },
  cancelBuild: { building: ['id', true] },
  upgradeWall: { walls: U },
  upgradeHouses: { houses: U },
  rally: { building: ['id', true], x: XO, y: YO, target: TGT },
  stop: { units: U },
  hold: { units: U, queue: Q },
  cast: { unit: ['id', true], ability: ['ability', true], x: XO, y: YO, target: TGT, queue: Q },
  surrender: {},
  repair: { units: U, target: ['id', true], queue: Q },
  research: { building: ['id', true], upgrade: ['upgrade', true] },
  autoRepair: { on: ['bool', false] },
  trade: { to: ['index', true], res: ['resource', true], amount: ['amount', true] },
  autocast: { units: U, ability: ['ability', false], on: ['bool', false] },
};
export const COMMAND_TYPES = Object.keys(COMMANDS);
export const COMMAND_SPECS = COMMANDS; // read-only: fingerprinted into the protocol version (wire-version.js)

/**
 * Rebuild a client's command from the whitelist: known type, known fields of the
 * right type only (ids positive integers, type ids that exist, coordinates finite
 * and clamped to the map, booleans strict). Returns null for anything unusable.
 * The player index is never taken from the command.
 * @param {*} cmd
 * @param {{ width: number, height: number }} bounds map size in tiles
 * @returns {object|null}
 */
export function sanitizeCommand(cmd, bounds) {
  if (!isObject(cmd) || !hasOwn(COMMANDS, cmd.type)) return null;
  const spec = COMMANDS[cmd.type];
  const b = bounds && bounds.width > 0 && bounds.height > 0 ? bounds : { width: 256, height: 256 };
  const out = { type: cmd.type };
  for (const field in spec) {
    const [kind, required] = spec[field];
    const v = hasOwn(cmd, field) ? FIELD[kind](cmd[field], b) : undefined;
    if (v === undefined) {
      if (required) return null;
      continue;
    }
    if (kind === 'bool' && !v) continue;
    out[field] = v;
  }
  return out;
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Check and clean the GameSetup a host sent with `start`. Returns
 * `{ setup, myIndex }` (a clean copy) or null when it cannot be played.
 */
export function validateSetup(setup, myIndex) {
  if (!isObject(setup) || !Array.isArray(setup.players)) return null;
  const n = setup.players.length;
  if (n < 1 || n > MAX_PLAYERS || !Number.isInteger(myIndex) || myIndex < 0 || myIndex >= n) return null;
  const seed = setup.seed;
  if (!(Number.isFinite(seed) || (typeof seed === 'string' && seed.length <= 64))) return null;
  const mapSize = setup.mapSize;
  if (!(mapSize === 'small' || mapSize === 'medium' || (Number.isInteger(mapSize) && mapSize >= 32 && mapSize <= 256))) return null;
  const players = [];
  for (let i = 0; i < n; i++) {
    const p = setup.players[i];
    if (!isObject(p) || p.index !== i || !hasOwn(PANTHEONS, p.pantheon)) return null;
    if (!Number.isInteger(p.team) || p.team < 1 || p.team > MAX_PLAYERS) return null;
    const kind = p.kind === 'ai' ? 'ai' : 'human';
    players.push({
      index: i,
      name: sanitizeName(p.name, `Player ${i + 1}`),
      team: p.team,
      pantheon: p.pantheon,
      color: typeof p.color === 'string' && COLOR_RE.test(p.color) ? p.color : PLAYER_COLORS[i % PLAYER_COLORS.length],
      kind,
      difficulty: kind === 'ai' && ['easy', 'normal', 'hard'].includes(p.difficulty) ? p.difficulty : kind === 'ai' ? 'normal' : null,
    });
  }
  const clean = { version: typeof setup.version === 'string' ? setup.version.slice(0, 32) : '', seed, mapSize, players };
  if (typeof setup.mapHash === 'string' && setup.mapHash.length <= 64) clean.mapHash = setup.mapHash;
  if (PEACE_LENGTHS.includes(setup.peaceMinutes)) clean.peaceMinutes = setup.peaceMinutes; // Decade of Peace
  return { setup: clean, myIndex };
}

/**
 * Structural check of a ViewSnapshot from the host before it reaches the
 * ViewState (which would otherwise throw half-way through an update).
 * @returns {boolean}
 */
export function isValidSnapshot(snap) {
  if (!isObject(snap) || !Number.isFinite(snap.tick) || !Number.isFinite(snap.time)) return false;
  if (!Array.isArray(snap.entities) || !Array.isArray(snap.players)) return false;
  for (const e of snap.entities) {
    if (!isObject(e) || !Number.isFinite(e.id) || typeof e.k !== 'string' || !Number.isFinite(e.x) || !Number.isFinite(e.y)) return false;
  }
  for (const p of snap.players) if (!isObject(p)) return false;
  for (const key of ['events', 'fields', 'reveals']) {
    const list = snap[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return false;
    for (const item of list) if (!isObject(item)) return false;
  }
  for (const ev of snap.events || []) if (typeof ev.type !== 'string') return false;
  if (snap.felled !== undefined && !Array.isArray(snap.felled)) return false;
  for (const f of snap.felled || []) if (!Array.isArray(f) || !Number.isInteger(f[0]) || !Number.isInteger(f[1])) return false;
  return true;
}

/** Felled-tree list from the host: only [tx, ty] integer pairs inside the map. */
export function sanitizeFelled(list, width, height) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const f of list) {
    if (Array.isArray(f) && Number.isInteger(f[0]) && Number.isInteger(f[1]) && f[0] >= 0 && f[1] >= 0 && f[0] < width && f[1] < height) out.push([f[0], f[1]]);
  }
  return out;
}
