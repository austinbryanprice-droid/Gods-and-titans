// Match replays (DESIGN 9.5). The sim is deterministic: the same GameSetup and the same commands on
// the same ticks give the same game (tests/sim/world.test.js). So a replay is the setup, every
// command the World accepted (from every player, the AIs too) with the tick it was applied on, the
// chat lines with their ticks, and now and then a checksum of the world, by which a replay played on
// a later build of the game can tell where it parts from what really happened. The recorder hangs on
// the host's World (World.onCommand); clients have no World and record nothing.
// Pure data, no DOM: runs in Node. Storage is src/game/replay-store.js, playback replay-session.js.
import { PROTOCOL_VERSION } from '../net/wire-version.js';
import { validateSetup } from '../net/sanitize.js';
import { sanitizeChat, sanitizeName } from '../net/protocol.js';
import { normalizeCommand } from '../sim/commands.js';
import { survivalOn } from '../sim/survival.js';
import { peaceSeconds } from '../sim/peace.js';
import { sacredVictoryOn } from '../sim/sacred.js';
import { PANTHEONS } from '../data/index.js';
import { twistOf } from '../data/twists.js';
import { MISSION_BY_ID } from '../data/campaign.js';
import { TICK_RATE } from '../config.js';

export const REPLAY_FORMAT = 1;
export const SUM_EVERY_TICKS = 10 * TICK_RATE; // a checksum every 10 s of game time (at most)
export const MIN_REPLAY_TICKS = 30 * TICK_RATE; // a game left in its first 30 s is not kept
export const MAX_REPLAY_COMMANDS = 600000; // far past any real game (a 4-AI game gives ~750 a minute)
// A saved game carries its recording so far (DESIGN 9.4), up to this many commands (about 3 hours of a
// 4-player game, a few MB of JSON before the save is gzipped); a longer one is saved without it and
// gets no replay once carried on.
export const MAX_CARRIED_COMMANDS = 150000;
const MAX_CHAT = 2000;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 32-bit FNV-1a step over an integer (as 4 bytes). */
function mix(h, v) {
  v |= 0;
  h = Math.imul(h ^ (v & 0xff), 0x01000193);
  h = Math.imul(h ^ ((v >>> 8) & 0xff), 0x01000193);
  h = Math.imul(h ^ ((v >>> 16) & 0xff), 0x01000193);
  h = Math.imul(h ^ (v >>> 24), 0x01000193);
  return h >>> 0;
}

/**
 * A checksum of the world as it stands: the tick, each player's resources and every living unit's
 * place and health and every building's health. Cheap (a few thousand numbers), and any drift of a
 * replay from the recorded game shows in it within a few seconds.
 */
export function worldChecksum(world) {
  let h = mix(0x811c9dc5, world.tickCount);
  for (const p of world.players) {
    h = mix(h, Math.round(p.gold * 16));
    h = mix(h, Math.round(p.wood * 16));
    h = mix(h, Math.round(p.faith * 16));
    h = mix(h, p.defeated ? 1 : 0);
  }
  for (const u of world.unitList) {
    if (u.dead) continue;
    h = mix(h, u.id);
    h = mix(h, Math.round(u.x * 256));
    h = mix(h, Math.round(u.y * 256));
    h = mix(h, Math.round(u.hp * 16));
  }
  for (const b of world.buildingList) {
    if (b.dead) continue;
    h = mix(h, b.id);
    h = mix(h, Math.round(b.hp * 16));
  }
  return h;
}

/** A command as normalizeCommand gives it, without its empty fields (normalizing it again gives the same command). */
export function compactCommand(cmd) {
  const out = {};
  for (const k in cmd) {
    const v = cmd[k];
    if (v === undefined || v === false || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (k === 'target' && v === 0) continue;
    out[k] = Array.isArray(v) ? v.slice() : v;
  }
  return out;
}

function newId(now) {
  return `${now.toString(36)}-${Math.floor(Math.random() * 0x100000).toString(36)}`;
}

/** What kind of game a setup is, in a word or two (the replay list). */
export function modeName(setup) {
  if (survivalOn(setup)) return 'Trial of the Titans';
  if (peaceSeconds(setup) > 0) return 'Decade of Peace';
  if (sacredVictoryOn(setup)) return 'Sacred Victory';
  return 'Skirmish';
}

/**
 * Records one match on the host. attach() hooks the World; chat(line) takes the chat lines as the
 * session shows them; sample() checksums the world (call it after the host's ticks, e.g. on each
 * snapshot); finish(...) gives the replay record, or null when the game was too short to keep.
 */
export class ReplayRecorder {
  /**
   * @param {object} o
   * @param {object} o.world the host's World
   * @param {object} o.setup its GameSetup
   * @param {number} o.myIndex the recording player's index (whose eyes the replay opens with)
   * @param {() => number} [o.now] Date.now (tests)
   */
  constructor({ world, setup, myIndex, now = Date.now }) {
    this.world = world;
    this.setup = JSON.parse(JSON.stringify(setup));
    this.myIndex = myIndex;
    this.started = now();
    this.now = now;
    this.cmds = [];
    this.chatLines = [];
    this.sums = [];
    this.lastSum = -Infinity;
    this.truncated = false;
    this.done = null;
    this.prevHook = null;
  }

  /**
   * The recording so far, as plain data that rides in a saved game's extra (game-saves.js), or null when
   * there is none worth carrying (finished, cut short, or too long). Copies: the save is written later.
   */
  carry() {
    if (this.done || this.truncated || this.cmds.length > MAX_CARRIED_COMMANDS) return null;
    return {
      format: REPLAY_FORMAT,
      setup: this.setup,
      myIndex: this.myIndex,
      started: this.started,
      tick: this.world.tickCount,
      cmds: this.cmds.slice(),
      chat: this.chatLines.slice(),
      sums: this.sums.slice(),
      lastSum: Number.isFinite(this.lastSum) ? this.lastSum : null,
    };
  }

  /**
   * A recorder that carries on a saved game's recording (carry()) on its loaded World, so the replay
   * kept at the end plays the whole match from the setup. Null when the data does not fit this world.
   * @param {object} o
   * @param {object} o.world the loaded World
   * @param {object} o.carried what carry() gave when the game was saved
   * @param {() => number} [o.now]
   */
  static resume({ world, carried, now = Date.now }) {
    const c = carried;
    if (!isObj(c) || c.format !== REPLAY_FORMAT || !isObj(c.setup) || !world || !world.setup) return null;
    if (c.tick !== world.tickCount || c.setup.seed !== world.setup.seed || !Array.isArray(c.cmds) || c.cmds.length > MAX_CARRIED_COMMANDS) return null;
    const n = world.players.length;
    let last = 0;
    for (const row of c.cmds) {
      if (!Array.isArray(row) || row.length !== 3 || !Number.isSafeInteger(row[0]) || row[0] < last || row[0] > c.tick) return null;
      if (!Number.isInteger(row[1]) || row[1] < 0 || row[1] >= n || !isObj(row[2])) return null;
      last = row[0];
    }
    const myIndex = Number.isInteger(c.myIndex) ? c.myIndex : 0;
    const rec = new ReplayRecorder({ world, setup: c.setup, myIndex, now });
    if (Number.isFinite(c.started)) rec.started = c.started;
    rec.cmds = c.cmds.slice();
    rec.chatLines = (Array.isArray(c.chat) ? c.chat : []).filter((r) => Array.isArray(r) && Number.isSafeInteger(r[0]) && r[0] <= c.tick).slice(0, MAX_CHAT);
    rec.sums = (Array.isArray(c.sums) ? c.sums : []).filter((r) => Array.isArray(r) && Number.isSafeInteger(r[0]) && r[0] <= c.tick && Number.isSafeInteger(r[1]));
    rec.lastSum = Number.isSafeInteger(c.lastSum) ? c.lastSum : rec.sums.length ? rec.sums[rec.sums.length - 1][0] : -Infinity;
    return rec;
  }

  attach() {
    const w = this.world;
    this.prevHook = w.onCommand;
    w.onCommand = (tick, player, cmd) => this.command(tick, player, cmd);
    return this;
  }

  detach() {
    if (this.world.onCommand && this.prevHook !== undefined) this.world.onCommand = this.prevHook || null;
  }

  command(tick, player, cmd) {
    if (this.done) return;
    if (this.cmds.length >= MAX_REPLAY_COMMANDS) {
      this.truncated = true;
      return;
    }
    this.cmds.push([tick, player, compactCommand(cmd)]);
  }

  chat(line) {
    if (this.done || !line || this.chatLines.length >= MAX_CHAT) return;
    const text = sanitizeChat(line.text);
    if (!text) return;
    const row = [this.world.tickCount, Number.isInteger(line.from) ? line.from : -1, text];
    if (line.voice || line.system || line.team) row.push(line.voice ? 1 : 0, line.system ? 1 : 0);
    if (line.team) row.push(1); // a line to the host's allies only (only the host's own team's lines ever reach it)
    this.chatLines.push(row);
  }

  sample() {
    if (this.done) return;
    const t = this.world.tickCount;
    if (t - this.lastSum < SUM_EVERY_TICKS) return;
    this.lastSum = t;
    this.sums.push([t, worldChecksum(this.world)]);
  }

  /** Long enough to keep? */
  worthKeeping() {
    return this.world.tickCount >= MIN_REPLAY_TICKS;
  }

  /**
   * Stop recording and build the record.
   * @param {{ result?: string|null, winningTeam?: number|null }} [end] how it ended for the recording player (null: left early)
   */
  finish({ result = null, winningTeam = null } = {}) {
    if (this.done) return this.done;
    if (!this.worthKeeping()) return null;
    const w = this.world;
    this.sample();
    // The last checksum: on the last tick, so a replay that reaches its end knows it played true.
    if (!this.sums.length || this.sums[this.sums.length - 1][0] !== w.tickCount) this.sums.push([w.tickCount, worldChecksum(w)]);
    this.detach();
    const players = w.players.map((p) => ({ name: p.name, pantheon: p.pantheon, team: p.team, color: p.color, kind: p.kind, difficulty: p.difficulty || null }));
    this.done = {
      format: REPLAY_FORMAT,
      id: newId(this.started),
      version: PROTOCOL_VERSION,
      date: this.started,
      saved: this.now(),
      setup: this.setup,
      pov: this.myIndex,
      ticks: w.tickCount,
      result,
      winningTeam: Number.isInteger(winningTeam) ? winningTeam : null,
      mode: modeName(this.setup),
      players,
      truncated: this.truncated,
      cmds: this.cmds,
      chat: this.chatLines,
      sums: this.sums,
    };
    return this.done;
  }
}

/** The list row of a replay: everything but its commands, chat and checksums. */
export function replayMeta(rec) {
  const { cmds, chat, sums, ...meta } = rec;
  return meta;
}

const RESULTS = new Set(['victory', 'defeat', 'draw', 'survival']);

/**
 * Check a replay read from storage or from a file (untrusted: a file may come from anyone). Returns
 * a clean record or null. Commands go through the sim's own normalizeCommand when played, as a
 * client's do; here they only have to be [tick, player, object] rows in tick order.
 */
export function sanitizeReplay(rec) {
  if (!isObj(rec) || rec.format !== REPLAY_FORMAT) return null;
  const v = validateSetup(rec.setup, 0);
  if (!v) return null;
  const setup = v.setup;
  if (twistOf(rec.setup)) setup.twist = rec.setup.twist; // the daily challenge's twist changes the start (a solo game: no client checks it)
  // A campaign mission's start board, script and objectives (DESIGN 5.16) come from its id.
  if (typeof rec.setup.campaign === 'string' && Object.prototype.hasOwnProperty.call(MISSION_BY_ID, rec.setup.campaign)) setup.campaign = rec.setup.campaign;
  const n = setup.players.length;
  const ticks = rec.ticks;
  if (!Number.isSafeInteger(ticks) || ticks < 1 || ticks > 24 * 3600 * TICK_RATE) return null;
  if (!Array.isArray(rec.cmds) || rec.cmds.length > MAX_REPLAY_COMMANDS) return null;
  const cmds = [];
  let last = 0;
  const map = { width: 1e6, height: 1e6 }; // the bounds check happens again in the World
  for (const row of rec.cmds) {
    if (!Array.isArray(row) || row.length !== 3) return null;
    const [t, p, c] = row;
    if (!Number.isSafeInteger(t) || t < last || t > ticks || !Number.isInteger(p) || p < 0 || p >= n) return null;
    if (!normalizeCommand(c, map)) return null;
    last = t;
    cmds.push([t, p, c]);
  }
  const chat = [];
  for (const row of Array.isArray(rec.chat) ? rec.chat.slice(0, MAX_CHAT) : []) {
    if (!Array.isArray(row) || !Number.isSafeInteger(row[0]) || !Number.isInteger(row[1])) continue;
    const text = sanitizeChat(row[2]);
    if (!text || row[1] >= n) continue;
    const flags = [row[3] ? 1 : 0, row[4] ? 1 : 0];
    if (row[5] && !row[4]) flags.push(1); // team (allies-only) line
    chat.push(flags.some(Boolean) ? [row[0], row[1], text, ...flags] : [row[0], row[1], text]);
  }
  chat.sort((a, b) => a[0] - b[0]);
  const sums = [];
  let lastSum = -1;
  for (const row of Array.isArray(rec.sums) ? rec.sums : []) {
    if (!Array.isArray(row) || !Number.isSafeInteger(row[0]) || row[0] <= lastSum || !Number.isSafeInteger(row[1])) continue;
    lastSum = row[0];
    sums.push([row[0], row[1] >>> 0]);
  }
  const players = setup.players.map((sp, i) => {
    const p = Array.isArray(rec.players) && isObj(rec.players[i]) ? rec.players[i] : {};
    return {
      name: sanitizeName(p.name, sp.name),
      pantheon: typeof p.pantheon === 'string' && Object.hasOwn(PANTHEONS, p.pantheon) ? p.pantheon : sp.pantheon,
      team: Number.isInteger(p.team) ? p.team : sp.team,
      color: sp.color,
      kind: sp.kind,
      difficulty: sp.difficulty,
    };
  });
  const date = Number.isFinite(rec.date) ? rec.date : 0;
  return {
    format: REPLAY_FORMAT,
    id: typeof rec.id === 'string' && /^[a-z0-9-]{1,40}$/.test(rec.id) ? rec.id : newId(date || Date.now()),
    version: typeof rec.version === 'string' ? rec.version.slice(0, 32) : '',
    date,
    saved: Number.isFinite(rec.saved) ? rec.saved : date,
    setup,
    pov: Number.isInteger(rec.pov) && rec.pov >= -1 && rec.pov < n ? rec.pov : -1,
    ticks,
    result: RESULTS.has(rec.result) ? rec.result : null,
    winningTeam: Number.isInteger(rec.winningTeam) ? rec.winningTeam : null,
    mode: modeName(setup),
    players,
    truncated: rec.truncated === true,
    cmds,
    chat,
    sums,
  };
}

/** "Victory", "Defeat", "Draw", "Wave 7", "Left early": how the game ended for the recording player. */
export function resultLabel(meta) {
  switch (meta && meta.result) {
    case 'victory':
      return 'Victory';
    case 'defeat':
      return 'Defeat';
    case 'draw':
      return 'Draw';
    case 'survival':
      return 'Trial ended';
    default:
      return 'Left early';
  }
}

/** "Greek & Norse vs Egyptian": the sides by team, each player by pantheon name. */
export function sidesLabel(meta) {
  const teams = new Map();
  for (const p of (meta && meta.players) || []) {
    const name = (PANTHEONS[p.pantheon] && PANTHEONS[p.pantheon].name) || p.pantheon;
    if (!teams.has(p.team)) teams.set(p.team, []);
    teams.get(p.team).push(name);
  }
  return [...teams.values()].map((t) => t.join(' & ')).join(' vs ');
}

/** True when this build may play the replay differently from how it was recorded (a newer game). */
export function fromOtherBuild(meta) {
  return !!meta && meta.version !== PROTOCOL_VERSION;
}
