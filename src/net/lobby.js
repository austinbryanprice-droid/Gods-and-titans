// Pre-game lobby (DESIGN 7): the host owns the LobbyState (4 slots, map size)
// and broadcasts it; clients join with a room code, pick their own pantheon /
// team / color, chat, and receive the GameSetup when the host starts.
// Both sides distrust each other's messages: the host validates and rate-limits
// every client patch / chat / ping; a client cleans the lobby state and checks
// the GameSetup before it uses them.
import { MAX_PLAYERS, PLAYER_COLORS, PEACE_LENGTHS } from '../config.js';
import { PANTHEONS, PANTHEON_LIST } from '../data/index.js';
import { RNG, hashSeed } from '../sim/rng.js';
import * as mapgen from '../sim/mapgen.js';
import { LANDSCAPE_CHOICES, resolveLandscape } from '../data/landscapes.js';
import {
  MSG, REASONS, JOIN_TIMEOUT_MS, GAME_TIMEOUT_MS, MAX_NAME_LENGTH, RateLimiter,
  sanitizeName, sanitizeChat, sanitizeReason, versionMismatchReason, normalizeRoomCode,
} from './protocol.js';
import { PROTOCOL_VERSION } from './wire-version.js';
import { validateSetup } from './sanitize.js';
import { hostRoom, joinRoom, abortError } from './transport.js';

export const SLOT_KINDS = ['host', 'human', 'ai', 'open', 'closed'];
export const DIFFICULTIES = ['easy', 'normal', 'hard', 'brutal'];
export const PRESETS = ['coop', '1v1', '2v2', 'ffa'];
export const MAP_SIZE_NAMES = ['small', 'medium'];
const HELLO_TIMEOUT_MS = 10000;
const KICK_CLOSE_DELAY_MS = 300;
// After the game started, closing the lobby (back at the title) also drops any game
// connection still open, e.g. when the game never got to create its session. A normal
// quit has closed them by then: the session closes each 300 ms after its `end`.
const GAME_CLOSE_DELAY_MS = 1000;
// Connections that have not said HELLO yet. An honest client says it as soon as
// its link opens, so only a few are ever waiting; more are turned away at once
// (they hold no member, limiters or timer), which bounds what a flood of
// connections costs the host. Joined members are bounded by the slots.
export const MAX_WAITING_MEMBERS = MAX_PLAYERS;
// Per-member limits on the host (token buckets: rate per second, burst).
export const MEMBER_LIMITS = { patch: [5, 10], chat: [1, 5], ping: [4, 8] };
const CLIENT_CHAT_LIMIT = [10, 30]; // lobby chat lines a client shows per second
const FULL_NOTICE_MS = 5000; // the host hears "someone was turned away, every seat is taken" at most this often
const NOTIFY_MIN_MS = 50; // a client re-renders the lobby at most this often

const isPlayerKind = (k) => k === 'host' || k === 'human' || k === 'ai';
const hasOwn = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** A valid pantheon choice: 'random' or a pantheon id (own key: never '__proto__' or 'constructor'). */
export const isPantheonChoice = (v) => v === 'random' || hasOwn(PANTHEONS, v);
/** Integer from a number or numeric string within [lo, hi], else null. */
function intIn(v, lo, hi) {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}
const difficultyLabel = (d) => `${d[0].toUpperCase()}${d.slice(1)}`;
/** A computer player's lobby slot name: 'AI (Easy)'. In the game it plays under a figure's name (aiFigureName). */
export const aiName = (difficulty) => `AI (${difficultyLabel(difficulty)})`;
/** True when an AI slot carries no name of its own: empty, or the lobby's 'AI (Difficulty)' for its level. */
export const hasDefaultAiName = (slot) => !!slot && slot.kind === 'ai' && (!slot.name || slot.name === aiName(slot.difficulty || 'normal'));

/**
 * A computer player's name in the game: a figure of its pantheon with its level, 'Thor (Easy AI)', so an
 * ally and two foes on the same level are told apart in the alerts, chat and scores (DESIGN 6.1). The figure
 * is drawn deterministically from the seat (the player index), skipping names already `taken` (lower case)
 * and figures too long for a player name; 'Thor (Easy)' and then 'AI (Easy)' are the fallbacks.
 */
export function aiFigureName(pantheonId, difficulty, seat, taken = new Set()) {
  const p = PANTHEONS[pantheonId];
  const figures = p ? [...p.gods.map((g) => g.name), p.titan && p.titan.name].filter(Boolean) : [];
  const level = difficultyLabel(difficulty || 'normal');
  for (const tag of [`${level} AI`, level]) {
    for (let k = 0; k < figures.length; k++) {
      const cand = `${figures[(seat + k) % figures.length]} (${tag})`;
      if ([...cand].length <= MAX_NAME_LENGTH && !taken.has(cand.toLowerCase())) return cand;
    }
  }
  return aiName(difficulty || 'normal');
}

/**
 * Make player names distinct in a game: the second 'AI (Normal)' becomes 'AI (Normal) 2',
 * so banners, stats and chat lines can tell them apart. Lobby slots keep their names.
 */
function distinctNames(names) {
  const taken = new Set(names.map((n) => n.toLowerCase()));
  const seen = new Set();
  return names.map((name) => {
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      return name;
    }
    for (let n = 2; ; n++) {
      const suffix = ` ${n}`;
      const cand = name.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
      if (!taken.has(cand.toLowerCase()) && !seen.has(cand.toLowerCase())) {
        seen.add(cand.toLowerCase());
        return cand;
      }
    }
  });
}

// What a preset lays out for a slot. Humans and open slots count as one (a player
// joining or leaving keeps the preset); a pantheon, color or name edit does not matter.
const layoutOf = (s) => `${s.kind === 'human' ? 'open' : s.kind}|${s.team}|${s.kind === 'ai' ? s.difficulty : ''}`;

function slotOf(kind, extra = {}) {
  return { kind, name: '', pantheon: 'random', team: 1, color: 0, difficulty: 'normal', peerId: null, ...extra };
}

/** A secret a client keeps to win its seat back after a lost link or a reload (DESIGN 7). */
function rejoinToken() {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const MAX_TOKEN_LENGTH = 64;
const cleanToken = (v) => (typeof v === 'string' && v.length > 0 && v.length <= MAX_TOKEN_LENGTH && /^[0-9a-f]+$/.test(v) ? v : null);

function chatLine(from, name, text, system = false) {
  return { from, name, text, system };
}

/**
 * Clean a LobbyState received from the host (a client never renders raw input):
 * known slot kinds, names, pantheons, teams, colors and difficulties only,
 * exactly MAX_PLAYERS slots. Returns null when it is not a lobby state at all.
 */
export function sanitizeLobbyState(state) {
  if (!isObject(state) || !Array.isArray(state.slots)) return null;
  const slots = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const s = state.slots[i];
    if (!isObject(s) || !SLOT_KINDS.includes(s.kind)) {
      slots.push(slotOf('closed', { team: i + 1, color: i }));
      continue;
    }
    slots.push(slotOf(s.kind, {
      name: sanitizeName(s.name, ''),
      pantheon: isPantheonChoice(s.pantheon) ? s.pantheon : 'random',
      team: intIn(s.team, 1, MAX_PLAYERS) ?? 1,
      color: intIn(s.color, 0, PLAYER_COLORS.length - 1) ?? 0,
      difficulty: DIFFICULTIES.includes(s.difficulty) ? s.difficulty : 'normal',
      peerId: typeof s.peerId === 'string' ? s.peerId.slice(0, 128) : null,
    }));
  }
  return {
    roomCode: typeof state.roomCode === 'string' ? normalizeRoomCode(state.roomCode) : null,
    version: typeof state.version === 'string' ? state.version.slice(0, 32) : '',
    mapSize: MAP_SIZE_NAMES.includes(state.mapSize) ? state.mapSize : 'small',
    landscape: LANDSCAPE_CHOICES.includes(state.landscape) ? state.landscape : 'classic',
    preset: PRESETS.includes(state.preset) ? state.preset : null,
    peace: PEACE_LENGTHS.includes(state.peace) ? state.peace : 0,
    survival: state.survival === true && !PEACE_LENGTHS.includes(state.peace),
    sacred: state.sacred === true,
    started: state.started === true,
    slots,
  };
}

/**
 * Resolve 'random' pantheons deterministically from the seed, preferring
 * pantheons nobody else plays.
 */
export function resolvePantheons(slots, seed) {
  const rng = new RNG(hashSeed(`${seed}:pantheons`));
  const used = new Set(slots.filter((s) => PANTHEONS[s.pantheon]).map((s) => s.pantheon));
  return slots.map((s) => {
    if (PANTHEONS[s.pantheon]) return s.pantheon;
    const pool = PANTHEON_LIST.filter((p) => !used.has(p.id));
    const pick = rng.pick(pool.length ? pool : PANTHEON_LIST).id;
    used.add(pick);
    return pick;
  });
}

/**
 * Build a GameSetup (DESIGN 6.1) from lobby slots. Open/closed slots are
 * skipped; players are dense in slot order.
 * @returns {{ setup: object, slotToPlayer: Map<number, number> }}
 */
export function buildSetup(state, seed, version = PROTOCOL_VERSION) {
  const active = [];
  state.slots.forEach((s, i) => {
    if (isPlayerKind(s.kind)) active.push({ slot: s, slotIndex: i });
  });
  const pantheons = resolvePantheons(active.map((a) => a.slot), seed);
  const slotToPlayer = new Map();
  // Computer players with no name of their own play under a figure of their pantheon (aiFigureName).
  const taken = new Set(active.filter(({ slot }) => !hasDefaultAiName(slot) && slot.name).map(({ slot }) => slot.name.toLowerCase()));
  const names = distinctNames(active.map(({ slot }, index) => {
    if (hasDefaultAiName(slot)) {
      const name = aiFigureName(pantheons[index], slot.difficulty, index, taken);
      taken.add(name.toLowerCase());
      return name;
    }
    return slot.name || `Player ${index + 1}`;
  }));
  const survival = state.survival === true && !PEACE_LENGTHS.includes(state.peace);
  const players = active.map(({ slot, slotIndex }, index) => {
    slotToPlayer.set(slotIndex, index);
    const ai = slot.kind === 'ai';
    return {
      index,
      name: names[index],
      team: survival ? 1 : slot.team, // the Trial of the Titans is played together
      pantheon: pantheons[index],
      color: PLAYER_COLORS[slot.color] || PLAYER_COLORS[index % PLAYER_COLORS.length],
      kind: ai ? 'ai' : 'human',
      difficulty: ai ? slot.difficulty : null,
    };
  });
  const setup = { version, seed, mapSize: state.mapSize, players };
  const landscape = resolveLandscape(state.landscape, seed); // Random is drawn here, from the seed
  if (landscape !== 'classic') setup.landscape = landscape; // the Wildlands keep the setup as it always was
  if (PEACE_LENGTHS.includes(state.peace)) setup.peaceMinutes = state.peace; // Decade of Peace
  else if (survival) setup.survival = true; // Trial of the Titans
  if (state.sacred === true && !setup.survival) setup.sacredVictory = true; // Sacred Victory (DESIGN 5.11), never in a trial
  if (typeof mapgen.mapHash === 'function') {
    setup.mapHash = mapgen.mapHash(mapgen.generateMap(mapgen.mapOptions(setup)));
  }
  return { setup, slotToPlayer };
}

export class LobbyHost {
  /**
   * Open a lobby.
   * @param {object} opts
   * @param {'peer'|'local'|'loopback'|'none'} [opts.transport]
   * @param {string} opts.name host player name
   * @param {string} [opts.roomCode] preferred room code
   * @param {object} [opts.params] network overrides (see protocol.readNetParams)
   * @param {string} [opts.version] protocol version (tests)
   * @param {string} [opts.aiDifficulty] the difficulty of the AI players the presets add (default 'normal')
   * @returns {Promise<LobbyHost>}
   */
  static async create(opts = {}) {
    const transport = opts.transport || 'none';
    const ep = await hostRoom({ transport, roomCode: opts.roomCode, params: opts.params });
    return new LobbyHost(ep, { ...opts, transport });
  }

  /**
   * The room of a game carried on by its new host (host migration, DESIGN 7): already started, it only
   * seats the game's players again, each by the rejoin token they got at the start.
   * @param {object} endpoint from hostRoom
   * @param {object} o { transport, version, tokens: Map<player index, token> }
   */
  static forGame(endpoint, { transport, version = PROTOCOL_VERSION, tokens }) {
    // Started from the constructor on: a player reaching the room as it opens is seated by token, never sent to the lobby.
    const lobby = new LobbyHost(endpoint, { transport, name: 'Host', version, started: true });
    for (const [index, token] of tokens || []) {
      const t = cleanToken(token);
      if (t) lobby.rejoinTokens.set(t, index);
    }
    return lobby;
  }

  constructor(endpoint, { transport, name, version = PROTOCOL_VERSION, aiDifficulty = 'normal', started = false }) {
    this.endpoint = endpoint;
    this.aiDifficulty = DIFFICULTIES.includes(aiDifficulty) ? aiDifficulty : 'normal'; // new AI players start at this level
    this.transport = transport;
    this.version = version;
    this.roomCode = endpoint.roomCode;
    this.online = transport !== 'none';
    this.members = new Set(); // { conn, peerId, name, joined, offs }
    this.changeCbs = new Set();
    this.chatCbs = new Set();
    this.started = started;
    this.closed = false;
    this.gameConns = null;
    this.rejoinTokens = new Map(); // token → player index, for the humans of the started game
    this.rejoining = new Set(); // connections after the start that have not said HELLO yet
    this.rejoinHandler = null; // (index, conn) → reason | null, set by the game's HostSession
    this.hostToken = null; // the host's own token: a new host (migration) seats this browser with it
    this.playerSlots = null; // player index → slot index of the started game (the rematch seats its players again)
    this.seats = new Map(); // after a rematch opens: rejoin token → { slot, pantheon, team, color } held for that player
    this.lastFullNotice = -Infinity;
    this.state = {
      roomCode: this.roomCode,
      version,
      mapSize: 'small',
      landscape: 'classic',
      preset: null,
      peace: 0,
      survival: false,
      sacred: false,
      started,
      slots: [slotOf('host', { name: sanitizeName(name, 'Host'), peerId: 'host' })],
    };
    for (let i = 1; i < MAX_PLAYERS; i++) this.state.slots.push(slotOf('closed', { team: i + 1, color: i }));
    // A game against the computer starts as one human against one AI. Online, every seat starts Open so that
    // friends can come in, the rows taking turns between two sides: the first friend plays against the host,
    // the next two make it 2v2 (in join order, top to bottom). The host picks a preset for anything else.
    this.applyPreset('1v1');
    if (this.online) {
      this.state.slots = this.state.slots.map((s, i) => (i === 0 ? s : slotOf('open', { team: i % 2 ? 2 : 1, color: i })));
      this.state.preset = null;
    }
    this.offConn = endpoint.onConnection((conn) => this.handleConnection(conn));
  }

  // ---------------------------------------------------------------- listeners

  /** @returns {() => void} unsubscribe */
  onChange(cb) {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }

  /** cb({ from, name, text, system }) for every chat line (own lines included). */
  onChat(cb) {
    this.chatCbs.add(cb);
    return () => this.chatCbs.delete(cb);
  }

  changed() {
    this.state.started = this.started;
    const msg = { t: MSG.LOBBY, lobby: this.state };
    for (const m of this.members) if (m.joined) m.conn.send(msg);
    for (const cb of [...this.changeCbs]) cb(this.state);
  }

  chat(line) {
    if (!this.started) {
      const msg = { t: MSG.CHAT, ...line };
      for (const m of this.members) if (m.joined) m.conn.send(msg);
    }
    for (const cb of [...this.chatCbs]) cb(line);
  }

  /** Send a chat line as the host. */
  sendChat(text) {
    const t = sanitizeChat(text);
    if (t) this.chat(chatLine(0, this.state.slots[0].name, t));
  }

  // ---------------------------------------------------------------- connections

  handleConnection(conn) {
    if (this.closed) return this.refuse(conn, REASONS.HOST_CLOSED);
    if (this.started) return this.handleRejoin(conn);
    let waiting = 0;
    for (const x of this.members) if (!x.joined) waiting++;
    if (waiting >= MAX_WAITING_MEMBERS) {
      conn.send({ t: MSG.KICK, reason: REASONS.BUSY });
      setTimeout(() => conn.close('kicked'), KICK_CLOSE_DELAY_MS);
      return;
    }
    const m = {
      conn, peerId: conn.id, name: '', joined: false, offs: [],
      limits: {
        patch: new RateLimiter(...MEMBER_LIMITS.patch),
        chat: new RateLimiter(...MEMBER_LIMITS.chat),
        ping: new RateLimiter(...MEMBER_LIMITS.ping),
      },
    };
    this.members.add(m);
    m.offs.push(conn.onMessage((msg) => this.handleMessage(m, msg)));
    m.offs.push(conn.onClose(() => this.handleLeave(m)));
    m.helloTimer = setTimeout(() => {
      if (!m.joined && conn.open) conn.close('no-hello');
    }, HELLO_TIMEOUT_MS);
  }

  refuse(conn, reason) {
    conn.send({ t: MSG.KICK, reason });
    setTimeout(() => conn.close('kicked'), KICK_CLOSE_DELAY_MS);
  }

  /**
   * The game's session takes rejoining players: handler(index, conn) attaches them and returns
   * null, or returns why it cannot. null stops taking them (the game is gone).
   */
  setRejoinHandler(handler) {
    this.rejoinHandler = typeof handler === 'function' ? handler : null;
  }

  /**
   * A connection after the start: a player of this game coming back (DESIGN 7). Its HELLO must
   * carry the rejoin token its browser got with `start`; anyone else is told the game has started.
   */
  handleRejoin(conn) {
    if (this.rejoining.size >= MAX_WAITING_MEMBERS) return this.refuse(conn, REASONS.BUSY);
    const r = { conn, offs: [], timer: null, done: null };
    const done = r.done = () => {
      clearTimeout(r.timer);
      for (const off of r.offs) off();
      this.rejoining.delete(r);
    };
    this.rejoining.add(r);
    r.offs.push(conn.onMessage((msg) => {
      if (!isObject(msg) || msg.t !== MSG.HELLO) return;
      done();
      if (this.closed) return this.refuse(conn, REASONS.HOST_CLOSED);
      if (msg.version !== this.version) {
        const theirs = typeof msg.version === 'string' ? sanitizeName(msg.version, '?') : '?';
        return this.refuse(conn, versionMismatchReason(this.version, theirs));
      }
      // A player asking for the rematch before the host has opened it: they may try again in a moment.
      if (!msg.rejoin && cleanToken(msg.rematch) && this.rejoinTokens.has(cleanToken(msg.rematch))) return this.refuse(conn, REASONS.REMATCH_LATER);
      const token = cleanToken(msg.rejoin);
      if (!token || !this.rejoinTokens.has(token)) return this.refuse(conn, REASONS.STARTED);
      if (!this.rejoinHandler) return this.refuse(conn, REASONS.REJOIN_LATER);
      let problem;
      try {
        problem = this.rejoinHandler(this.rejoinTokens.get(token), conn);
      } catch (err) {
        console.error('[net] rejoin failed', err);
        problem = REASONS.REJOIN_DENIED;
      }
      if (problem) this.refuse(conn, problem);
    }));
    r.offs.push(conn.onClose(() => done()));
    r.timer = setTimeout(() => {
      done();
      if (conn.open) conn.close('no-hello');
    }, HELLO_TIMEOUT_MS);
  }

  /**
   * The Open seat a newcomer takes, or -1: one on the side with the fewest players (so the first friend
   * in a room of two teams plays against the host), the first such seat on a tie. Seats held for the
   * last game's players (a rematch) go only when no other seat is open.
   */
  openSlotFor() {
    const slots = this.state.slots;
    const held = new Set([...this.seats.values()].map((x) => x.slot));
    const count = new Map();
    for (const s of slots) if (isPlayerKind(s.kind)) count.set(s.team, (count.get(s.team) || 0) + 1);
    let best = -1;
    let bestKey = Infinity;
    slots.forEach((s, i) => {
      if (s.kind !== 'open') return;
      const key = (held.has(i) ? 100 : 0) + (count.get(s.team) || 0);
      if (key < bestKey) {
        best = i;
        bestKey = key;
      }
    });
    return best;
  }

  /** Tell the host (in the lobby chat) that someone was turned away because every seat is taken; at most every few seconds. */
  fullNotice(name) {
    const now = Date.now();
    if (now - this.lastFullNotice < FULL_NOTICE_MS) return;
    this.lastFullNotice = now;
    this.chat(chatLine(-1, '', `${name} tried to join, but every seat is taken. Set a seat to Open to let them in.`, true));
  }

  slotIndexOf(peerId) {
    return this.state.slots.findIndex((s) => s.kind === 'human' && s.peerId === peerId);
  }

  uniqueName(name, exceptIndex = -1) {
    const taken = new Set(this.state.slots.filter((s, i) => i !== exceptIndex && (s.kind === 'host' || s.kind === 'human')).map((s) => s.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const cand = `${name.slice(0, 16)} (${n})`;
      if (!taken.has(cand.toLowerCase())) return cand;
    }
  }

  freeColor(preferred, exceptIndex) {
    const used = new Set(this.state.slots.filter((s, i) => i !== exceptIndex && isPlayerKind(s.kind)).map((s) => s.color));
    if (preferred !== undefined && !used.has(preferred)) return preferred;
    for (let c = 0; c < PLAYER_COLORS.length; c++) if (!used.has(c)) return c;
    return preferred ?? 0;
  }

  kickMember(m, reason) {
    m.conn.send({ t: MSG.KICK, reason });
    setTimeout(() => m.conn.close('kicked'), KICK_CLOSE_DELAY_MS);
  }

  handleMessage(m, msg) {
    if (this.started || this.closed || !isObject(msg) || !this.members.has(m)) return;
    if (!m.joined) {
      if (msg.t !== MSG.HELLO || m.helloDone) return;
      m.helloDone = true;
      clearTimeout(m.helloTimer);
      if (msg.version !== this.version) {
        const theirs = typeof msg.version === 'string' ? sanitizeName(msg.version, '?') : '?';
        return this.kickMember(m, versionMismatchReason(this.version, theirs));
      }
      // A player of the last game coming back for the rematch gets their own seat (and side, pantheon, colour) again.
      const token = cleanToken(msg.rematch);
      const seat = token ? this.seats.get(token) : null;
      const index = seat && this.state.slots[seat.slot].kind === 'open' ? seat.slot : this.openSlotFor();
      if (index < 0) {
        this.fullNotice(sanitizeName(msg.name, 'A player'));
        return this.kickMember(m, REASONS.FULL);
      }
      if (seat) this.seats.delete(token);
      const prev = this.state.slots[index];
      const name = this.uniqueName(sanitizeName(msg.name, `Player ${index + 1}`));
      const keep = seat && seat.slot === index;
      this.state.slots[index] = slotOf('human', {
        name,
        team: keep ? seat.team : prev.team,
        pantheon: keep ? seat.pantheon : 'random',
        color: this.freeColor(keep ? seat.color : prev.color, index),
        peerId: m.peerId,
      });
      m.joined = true;
      m.name = name;
      m.conn.send({ t: MSG.WELCOME, slot: index, lobby: this.state });
      this.changed();
      this.chat(chatLine(-1, '', `${name} joined the lobby.`, true));
      return;
    }
    const index = this.slotIndexOf(m.peerId);
    if (msg.t === MSG.LOBBY) {
      if (index >= 0 && isObject(msg.patch) && m.limits.patch.take()) {
        const { pantheon, team, color } = msg.patch;
        if (this.patchSlot(index, { pantheon, team, color }, false)) this.changed();
      }
    } else if (msg.t === MSG.CHAT) {
      if (index < 0 || !m.limits.chat.take()) return;
      const text = sanitizeChat(msg.text);
      if (text) this.chat(chatLine(index, this.state.slots[index].name, text));
    } else if (msg.t === MSG.PING) {
      if (m.limits.ping.take()) m.conn.send({ t: MSG.PONG, ts: Number.isFinite(msg.ts) ? msg.ts : 0 });
    }
  }

  handleLeave(m) {
    clearTimeout(m.helloTimer);
    this.members.delete(m);
    if (this.started || !m.joined) return;
    const index = this.slotIndexOf(m.peerId);
    if (index < 0) return;
    const s = this.state.slots[index];
    this.state.slots[index] = slotOf('open', { team: s.team, color: s.color });
    this.changed();
    this.chat(chatLine(-1, '', `${m.name} left the lobby.`, true));
  }

  // ---------------------------------------------------------------- slot editing

  /**
   * Validate and apply a patch to one slot. `byHost` allows kind / difficulty / name changes.
   * @returns {boolean} whether anything changed
   */
  patchSlot(i, patch, byHost) {
    const s = this.state.slots[i];
    if (!s || !patch) return false;
    const before = JSON.stringify(s);
    const layoutBefore = layoutOf(s);
    if (byHost && patch.kind !== undefined && patch.kind !== s.kind && i !== 0) {
      const kind = patch.kind;
      if (kind === 'ai' || kind === 'open' || kind === 'closed') {
        if (s.kind === 'human') {
          const m = [...this.members].find((x) => x.peerId === s.peerId);
          if (m) {
            this.members.delete(m);
            for (const off of m.offs) off();
            this.kickMember(m, REASONS.REMOVED);
          }
        }
        const difficulty = DIFFICULTIES.includes(patch.difficulty) ? patch.difficulty : s.difficulty;
        this.state.slots[i] = slotOf(kind, {
          team: s.team,
          color: s.color,
          pantheon: kind === 'ai' ? s.pantheon : 'random',
          difficulty,
          name: kind === 'ai' ? aiName(difficulty) : '',
        });
        if (kind === 'ai') this.state.slots[i].color = this.freeColor(s.color, i);
      }
    }
    const t = this.state.slots[i];
    if (isPantheonChoice(patch.pantheon)) t.pantheon = patch.pantheon;
    const team = intIn(patch.team, 1, MAX_PLAYERS);
    if (team !== null) t.team = team;
    const color = intIn(patch.color, 0, PLAYER_COLORS.length - 1);
    if (color !== null) this.setColor(i, color, byHost);
    if (byHost && t.kind === 'ai' && DIFFICULTIES.includes(patch.difficulty)) {
      t.difficulty = patch.difficulty;
      t.name = aiName(t.difficulty);
    }
    if (byHost && i === 0 && patch.name !== undefined) t.name = this.uniqueName(sanitizeName(patch.name, t.name), 0);
    if (layoutOf(this.state.slots[i]) !== layoutBefore) this.state.preset = null; // no longer the preset's layout
    return JSON.stringify(this.state.slots[i]) !== before;
  }

  setColor(i, color, byHost) {
    if (!(color >= 0 && color < PLAYER_COLORS.length)) return;
    const slots = this.state.slots;
    const other = slots.findIndex((s, j) => j !== i && isPlayerKind(s.kind) && s.color === color);
    if (other < 0) {
      slots[i].color = color;
      return;
    }
    // A human keeps their color; the host may take an AI's color (they swap).
    if (slots[other].kind === 'ai' && byHost) {
      slots[other].color = slots[i].color;
      slots[i].color = color;
    }
  }

  /**
   * Host edits a slot: { kind: 'ai'|'open'|'closed', name (own slot), pantheon, team, color, difficulty }.
   * Turning a human's slot into anything else removes that player.
   */
  setSlot(i, patch) {
    if (this.started) return false;
    const ok = this.patchSlot(i, patch, true);
    if (ok) this.changed();
    return ok;
  }

  /** Remove a joined player (their slot becomes open). */
  kick(i) {
    return this.setSlot(i, { kind: 'open' });
  }

  /** 'small' | 'medium' */
  setMapSize(size) {
    if (this.started || !MAP_SIZE_NAMES.includes(size) || this.state.mapSize === size) return false;
    this.state.mapSize = size;
    this.changed();
    return true;
  }

  /** The landscape of the map (src/data/landscapes.js), or 'random'. */
  setLandscape(id) {
    if (this.started || !LANDSCAPE_CHOICES.includes(id) || this.state.landscape === id) return false;
    this.state.landscape = id;
    this.changed();
    return true;
  }

  /** Decade of Peace: minutes of game time without combat between players (30 | 45 | 60), or 0 for a normal game. */
  setPeace(minutes) {
    if (this.started || (minutes !== 0 && !PEACE_LENGTHS.includes(minutes))) return false;
    if (this.state.peace === minutes && !this.state.survival) return false;
    this.state.peace = minutes;
    this.state.survival = false; // one game mode at a time (0 is the standard game)
    this.changed();
    return true;
  }

  /** Trial of the Titans: everyone on one team against waves of monsters (on), or back to the other modes (off). */
  setSurvival(on) {
    on = on === true;
    if (this.started || (this.state.survival === on && !(on && this.state.peace))) return false;
    this.state.survival = on;
    if (on) this.state.peace = 0;
    this.changed();
    return true;
  }

  /** Sacred Victory (DESIGN 5.11): holding every sacred site for 8 minutes also wins the game. */
  setSacred(on) {
    if (this.started || typeof on !== 'boolean' || this.state.sacred === on) return false;
    this.state.sacred = on;
    this.changed();
    return true;
  }

  /**
   * Arrange slots: 'coop' (humans on team 1 vs AI Normal on team 2, medium map),
   * '1v1' (2 slots, small map), '2v2' (teams 1,1,2,2), 'ffa' (everyone alone); online the
   * seats for other players are Open, against the computer AI.
   * Connected players keep their settings (and are moved to the first slots).
   * Returns false if the preset cannot hold the connected players.
   */
  applyPreset(name) {
    if (this.started || !PRESETS.includes(name)) return false;
    const slots = this.state.slots;
    const humans = slots.filter((s) => s.kind === 'host' || s.kind === 'human');
    const prevAi = slots.filter((s) => s.kind === 'ai');
    // Online, the seats of the other players are Open for friends (the host sets one to AI if they want);
    // against the computer they are AI. Co-op keeps its AI opponents either way.
    const seat = this.online ? 'open' : 'ai';
    let layout; // [{ team, fill }]
    if (name === '1v1') {
      if (humans.length > 2) return false;
      layout = [{ team: 1 }, { team: 2, fill: seat }, { fill: 'closed' }, { fill: 'closed' }];
    } else if (name === '2v2') {
      layout = [1, 1, 2, 2].map((team) => ({ team, fill: seat }));
    } else if (name === 'ffa') {
      layout = [1, 2, 3, 4].map((team) => ({ team, fill: seat }));
    } else {
      // coop
      if (humans.length >= MAX_PLAYERS) return false;
      layout = [];
      for (let i = 0; i < MAX_PLAYERS; i++) {
        if (i < humans.length) layout.push({ team: 1 });
        else if (i === humans.length && humans.length < 2) layout.push({ team: 1, fill: seat });
        else layout.push({ team: 2, fill: 'ai' });
      }
    }
    if (humans.length > layout.filter((l) => l.fill !== 'closed').length) return false;
    const next = [];
    let ai = 0;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const l = layout[i];
      if (i < humans.length) {
        next.push({ ...humans[i], team: l.team ?? humans[i].team });
        continue;
      }
      if (l.fill === 'ai') {
        const old = prevAi[ai++];
        const difficulty = old ? old.difficulty : this.aiDifficulty;
        next.push(slotOf('ai', { team: l.team, pantheon: old ? old.pantheon : 'random', difficulty, name: aiName(difficulty), color: -1 }));
      } else next.push(slotOf(l.fill, { team: l.team ?? i + 1, color: -1 }));
    }
    // Colors: players keep theirs; everyone else gets the first free one.
    const used = new Set(next.filter((s) => s.color >= 0).map((s) => s.color));
    for (const s of next) {
      if (s.color >= 0) continue;
      let c = 0;
      while (used.has(c) && c < PLAYER_COLORS.length - 1) c++;
      s.color = c;
      used.add(c);
    }
    this.state.slots = next;
    this.state.mapSize = name === '1v1' ? 'small' : 'medium';
    this.state.preset = name;
    this.changed();
    return true;
  }

  // ---------------------------------------------------------------- start

  /** Why the game cannot start yet, or null if it can. */
  startProblem() {
    if (this.started) return 'The game has already started.';
    const active = this.state.slots.filter((s) => isPlayerKind(s.kind));
    // (The Trial of the Titans puts everyone on one team, so it needs no opponent: one player is enough.)
    if (!this.state.survival && new Set(active.map((s) => s.team)).size < 2) return 'Players must be on at least two different teams.';
    for (const s of this.state.slots) {
      if (s.kind !== 'human') continue;
      const m = [...this.members].find((x) => x.peerId === s.peerId);
      if (!m || !m.joined || !m.conn.open) return `Waiting for ${s.name || 'a player'} to connect.`;
    }
    return null;
  }

  /** True when ≥ 2 teams have players and every human slot is connected. */
  canStart() {
    return this.startProblem() === null;
  }

  /**
   * Start the game: builds the GameSetup (fresh seed, random pantheons resolved,
   * mapHash) and sends each client its `start`. The lobby stops listening to the
   * connections, which now belong to the game session.
   * @returns {{ setup: object, myIndex: number, conns: Map<number, object> }}
   */
  start() {
    const problem = this.startProblem();
    if (problem) throw new Error(problem);
    const seed = (Math.floor(Math.random() * 0x7ffffffe) + 1) >>> 0;
    const { setup, slotToPlayer } = buildSetup(this.state, seed, this.version);
    const conns = new Map();
    this.playerSlots = new Map([...slotToPlayer].map(([slot, index]) => [index, slot]));
    for (const m of [...this.members]) {
      for (const off of m.offs) off();
      clearTimeout(m.helloTimer);
      const slot = m.joined ? this.slotIndexOf(m.peerId) : -1;
      if (slot < 0) {
        this.kickMember(m, REASONS.STARTED);
        continue;
      }
      const index = slotToPlayer.get(slot);
      conns.set(index, m.conn);
      // In the game a client may be unable to send for many seconds (loading, building the renderer).
      if (typeof m.conn.setTimeoutMs === 'function') m.conn.setTimeoutMs(GAME_TIMEOUT_MS);
      const token = rejoinToken();
      this.rejoinTokens.set(token, index);
      m.conn.send({ t: MSG.START, setup, you: index, rejoin: token });
    }
    // The host gets one too: should the game move to another player's browser (DESIGN 7), this one can take its seat back there.
    this.hostToken = rejoinToken();
    this.rejoinTokens.set(this.hostToken, slotToPlayer.get(0));
    this.members.clear();
    this.started = true;
    this.state.started = true;
    this.gameConns = conns;
    for (const cb of [...this.changeCbs]) cb(this.state);
    // The endpoint (the PeerJS peer of the room code) stays open for the whole game, so that a player
    // who drops out can come back (handleRejoin); close() drops it when the host leaves the game.
    return { setup, myIndex: slotToPlayer.get(0), conns };
  }

  /** Every player's rejoin token of the started game: Map<player index, token> (for the host's heir, DESIGN 7). */
  gameTokens() {
    const m = new Map();
    for (const [token, index] of this.rejoinTokens) m.set(index, token);
    return m;
  }

  /**
   * Rematch (DESIGN 7): after the game is over, this room becomes a lobby again with the same players,
   * sides and settings. The AI players are back as they were; each human seat is Open and held for its
   * player, who gets it back by joining with the rejoin token of the last game (LobbyClient.join
   * `rematch`). A room carried on by a new host (forGame) has no lobby of its own: its seats are built
   * from the game's setup, the new host in the first.
   * @param {object} [o] { setup, myIndex, name } of the game that ended (needed for a room from forGame)
   * @returns {boolean} false when the room is closed or has no game to rematch
   */
  reopen({ setup = null, myIndex = 0, name = null } = {}) {
    if (this.closed || !this.started) return false;
    for (const r of [...this.rejoining]) {
      r.done();
      this.refuse(r.conn, REASONS.REJOIN_OVER);
    }
    this.rejoinHandler = null;
    this.gameConns = null; // the game's links belong to its session, which closes them
    let slots;
    let playerSlots = this.playerSlots;
    if (playerSlots) {
      slots = this.state.slots.map((s) => ({ ...s }));
    } else {
      const players = setup && Array.isArray(setup.players) ? setup.players.slice(0, MAX_PLAYERS) : [];
      if (!players[myIndex]) return false;
      const order = [myIndex, ...players.map((p, i) => i).filter((i) => i !== myIndex)];
      playerSlots = new Map(order.map((index, slot) => [index, slot]));
      slots = order.map((index, slot) => {
        const p = players[index];
        const color = Math.max(0, PLAYER_COLORS.indexOf(p.color));
        const extra = { team: intIn(p.team, 1, MAX_PLAYERS) ?? 1, color, pantheon: isPantheonChoice(p.pantheon) ? p.pantheon : 'random' };
        if (slot === 0) return slotOf('host', { ...extra, name: sanitizeName(name || p.name, 'Host'), peerId: 'host' });
        if (p.kind === 'ai') {
          const difficulty = DIFFICULTIES.includes(p.difficulty) ? p.difficulty : 'normal';
          return slotOf('ai', { ...extra, difficulty, name: aiName(difficulty) });
        }
        return slotOf('human', extra);
      });
      while (slots.length < MAX_PLAYERS) slots.push(slotOf('closed', { team: slots.length + 1, color: slots.length }));
      this.state.mapSize = MAP_SIZE_NAMES.includes(setup.mapSize) ? setup.mapSize : 'small';
      this.state.landscape = LANDSCAPE_CHOICES.includes(setup.landscape) ? setup.landscape : 'classic';
      this.state.peace = PEACE_LENGTHS.includes(setup.peaceMinutes) ? setup.peaceMinutes : 0;
      this.state.survival = setup.survival === true && !this.state.peace;
      this.state.sacred = setup.sacredVictory === true;
      this.state.preset = null;
    }
    // Each human seat of the last game is held for its player (by their token), Open meanwhile.
    this.seats = new Map();
    for (const [token, index] of this.rejoinTokens) {
      const slot = playerSlots.get(index);
      if (slot === undefined || !slots[slot] || slots[slot].kind !== 'human') continue;
      const s = slots[slot];
      this.seats.set(token, { slot, pantheon: s.pantheon, team: s.team, color: s.color });
    }
    slots = slots.map((s) => (s.kind === 'human' ? slotOf('open', { team: s.team, color: s.color }) : s));
    this.state.slots = slots;
    this.rejoinTokens = new Map();
    this.hostToken = null;
    this.playerSlots = null;
    this.members.clear();
    this.started = false;
    this.changed();
    return true;
  }

  /**
   * Leave the lobby. Before the game starts this tells everyone and closes all
   * connections; after the start it stops accepting new players and, a moment later,
   * closes whatever game connection is still open (the session closes its own).
   */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.rejoinHandler = null;
    if (this.started) {
      for (const r of [...this.rejoining]) {
        r.done();
        this.refuse(r.conn, REASONS.HOST_CLOSED);
      }
      setTimeout(() => this.endpoint.close(), GAME_CLOSE_DELAY_MS);
      return;
    }
    for (const m of [...this.members]) {
      for (const off of m.offs) off();
      clearTimeout(m.helloTimer);
      m.conn.send({ t: MSG.KICK, reason: REASONS.HOST_CLOSED });
    }
    this.members.clear();
    setTimeout(() => this.endpoint.close(), KICK_CLOSE_DELAY_MS);
  }
}

export class LobbyClient {
  /**
   * Join a lobby by room code. Rejects with a readable Error (room not found,
   * version mismatch, game full, …).
   * @param {object} opts
   * @param {'peer'|'local'|'loopback'} [opts.transport]
   * @param {string} opts.roomCode
   * @param {string} opts.name
   * @param {object} [opts.params]
   * @param {number} [opts.timeoutMs]
   * @param {AbortSignal} [opts.signal] cancel the join: rejects with transport.abortError() and leaves nothing open
   * @param {string} [opts.version] protocol version (tests)
   * @param {string} [opts.rematch] my rejoin token of the room's last game: the host's rematch gives me my seat back
   * @param {number} [opts.laterTries] how many more times to try while the host has not opened the rematch yet (one every second)
   * @returns {Promise<LobbyClient>}
   */
  static async join(opts = {}) {
    for (let left = opts.laterTries || 0; ; left--) {
      try {
        return await LobbyClient.joinOnce(opts);
      } catch (err) {
        if (left <= 0 || !err || err.message !== REASONS.REMATCH_LATER || (opts.signal && opts.signal.aborted)) throw err;
      }
      await new Promise((r) => setTimeout(r, 1000));
      if (opts.signal && opts.signal.aborted) throw abortError();
    }
  }

  static async joinOnce(opts) {
    const { signal } = opts;
    const conn = await joinRoom({ transport: opts.transport || 'peer', roomCode: opts.roomCode, params: opts.params, timeoutMs: opts.timeoutMs, signal });
    const client = new LobbyClient(conn, opts);
    const onAbort = () => client.pending && client.pending.reject(abortError());
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      await client.handshake(opts.timeoutMs ?? JOIN_TIMEOUT_MS);
      if (signal && signal.aborted) throw abortError();
    } catch (err) {
      conn.close('join-failed');
      throw err;
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
    }
    return client;
  }

  /**
   * Go back into a game that has started (DESIGN 7): connect to the room again and show the token
   * this browser got with `start`. Resolves with what `onStart` gives ({ setup, myIndex, conn }),
   * the connection handed over to the game; rejects with a readable Error (the game is over, this
   * browser was not in it, the room is gone, …), flagged `refused` when the host itself said no (and `retry` when only for now: still loading, busy).
   * @param {object} opts { transport, roomCode, token, name, params, timeoutMs, signal, version, proof }
   *   (proof: my seat's proof from the host's PLAN; a START without it is refused)
   */
  static async rejoin(opts = {}) {
    const { signal } = opts;
    const token = cleanToken(opts.token);
    if (!token) throw new Error(REASONS.REJOIN_UNKNOWN);
    const conn = await joinRoom({ transport: opts.transport || 'peer', roomCode: opts.roomCode, params: opts.params, timeoutMs: opts.timeoutMs, signal });
    const offs = [];
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The host did not answer. The game may be over.')), opts.timeoutMs ?? JOIN_TIMEOUT_MS);
        offs.push(() => clearTimeout(timer));
        const onAbort = () => reject(abortError());
        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
          offs.push(() => signal.removeEventListener('abort', onAbort));
        }
        offs.push(conn.onMessage((msg) => {
          if (!isObject(msg) || (msg.t !== MSG.KICK && msg.t !== MSG.START)) return;
          // Let go of the link at once: the full snapshot right behind `start` waits in it for the game session.
          for (const off of offs.splice(0)) off();
          if (msg.t === MSG.KICK) {
            const reason = sanitizeReason(msg.reason, REASONS.REJOIN_DENIED);
            // "still loading" and "busy" pass: the ticket stays good for another try
            reject(Object.assign(new Error(reason), { refused: true, retry: reason === REASONS.REJOIN_LATER || reason === REASONS.BUSY }));
          }
          else if (msg.t === MSG.START) {
            const valid = validateSetup(msg.setup, msg.you);
            if (!valid) reject(new Error('The host sent an invalid game setup. Make sure you both run the same version (reload the page).'));
            // After a host migration only the game's host knows my seat's proof: anyone else in that room is not it.
            else if (opts.proof && msg.proof !== opts.proof) reject(Object.assign(new Error(REASONS.NOT_HOST), { refused: true, retry: false }));
            else resolve({ setup: valid.setup, myIndex: valid.myIndex, conn, rejoin: token });
          }
        }));
        offs.push(conn.onClose(() => reject(new Error(REASONS.LOST))));
        conn.send({ t: MSG.HELLO, name: sanitizeName(opts.name), version: opts.version || PROTOCOL_VERSION, rejoin: token });
      }).then((info) => {
        if (typeof conn.setTimeoutMs === 'function') conn.setTimeoutMs(GAME_TIMEOUT_MS);
        return info;
      });
    } catch (err) {
      conn.close('rejoin-failed');
      throw err;
    } finally {
      for (const off of offs.splice(0)) off();
    }
  }

  constructor(conn, { name, version = PROTOCOL_VERSION, rematch = null } = {}) {
    this.conn = conn;
    this.rematch = cleanToken(rematch);
    this.name = sanitizeName(name);
    this.version = version;
    this.state = null;
    this.peerId = null;
    this.started = false;
    this.kicked = null;
    this.startInfo = null;
    this.changeCbs = new Set();
    this.chatCbs = new Set();
    this.startCbs = new Set();
    this.kickCbs = new Set();
    this.pending = null;
    this.chatLimit = new RateLimiter(...CLIENT_CHAT_LIMIT);
    this.lastNotify = -Infinity;
    this.notifyTimer = null;
    this.offs = [
      conn.onMessage((msg) => this.handleMessage(msg)),
      conn.onClose(() => this.handleClose()),
    ];
  }

  get roomCode() {
    return this.state ? this.state.roomCode : null;
  }

  /** My slot index in state.slots (-1 if none). */
  get mySlot() {
    if (!this.state) return -1;
    return this.state.slots.findIndex((s) => s.kind === 'human' && s.peerId === this.peerId);
  }

  handshake(timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('The host did not answer. Check the room code and try again.'));
      }, timeoutMs);
      this.pending = {
        resolve: () => {
          clearTimeout(timer);
          this.pending = null;
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          this.pending = null;
          reject(err);
        },
      };
      this.conn.send(this.rematch ? { t: MSG.HELLO, name: this.name, version: this.version, rematch: this.rematch } : { t: MSG.HELLO, name: this.name, version: this.version });
    });
  }

  handleMessage(msg) {
    if (this.started || this.kicked || !isObject(msg)) return;
    if (msg.t === MSG.WELCOME) {
      const state = sanitizeLobbyState(msg.lobby);
      const index = intIn(msg.slot, 0, MAX_PLAYERS - 1);
      if (!state || index === null || state.slots[index].kind !== 'human' || this.peerId) return;
      this.state = state;
      this.peerId = state.slots[index].peerId;
      if (this.pending) this.pending.resolve();
      this.notifyChange(true);
    } else if (msg.t === MSG.LOBBY) {
      const state = sanitizeLobbyState(msg.lobby);
      if (!state || !this.state) return;
      this.state = state;
      this.notifyChange();
    } else if (msg.t === MSG.CHAT) {
      if (!this.chatLimit.take()) return;
      const text = sanitizeChat(msg.text);
      if (!text) return;
      const system = msg.system === true;
      const from = Number.isInteger(msg.from) && msg.from >= -1 && msg.from < MAX_PLAYERS ? msg.from : -1;
      const line = chatLine(from, system ? '' : sanitizeName(msg.name, `Player ${from + 1}`), text, system);
      for (const cb of [...this.chatCbs]) cb(line);
    } else if (msg.t === MSG.KICK) {
      this.kick(sanitizeReason(msg.reason, REASONS.REMOVED));
    } else if (msg.t === MSG.START) {
      if (!this.state) return;
      const valid = validateSetup(msg.setup, msg.you);
      if (!valid) {
        this.kick('The host sent an invalid game setup. Make sure you both run the same version (reload the page).');
        return;
      }
      this.started = true;
      for (const off of this.offs) off();
      this.flushNotify();
      if (typeof this.conn.setTimeoutMs === 'function') this.conn.setTimeoutMs(GAME_TIMEOUT_MS);
      this.startInfo = { setup: valid.setup, myIndex: valid.myIndex, conn: this.conn, rejoin: cleanToken(msg.rejoin) };
      this.state.started = true;
      for (const cb of [...this.startCbs]) cb(this.startInfo);
    }
  }

  handleClose() {
    if (this.started || this.kicked) return;
    this.kick(REASONS.LOST);
  }

  kick(reason) {
    if (this.kicked || this.started) return;
    this.kicked = reason;
    for (const off of this.offs) off();
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
    this.notifyTimer = null;
    if (this.pending) this.pending.reject(new Error(reason));
    else for (const cb of [...this.kickCbs]) cb(reason);
    this.conn.close('kicked');
  }

  /**
   * Tell listeners about a new lobby state: at once, unless the last update was
   * less than NOTIFY_MIN_MS ago (a host flooding updates), then once at the end.
   */
  notifyChange(now = false) {
    const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now || t - this.lastNotify >= NOTIFY_MIN_MS) {
      if (this.notifyTimer) clearTimeout(this.notifyTimer);
      this.notifyTimer = null;
      this.lastNotify = t;
      for (const cb of [...this.changeCbs]) cb(this.state);
      return;
    }
    if (!this.notifyTimer) this.notifyTimer = setTimeout(() => this.flushNotify(), NOTIFY_MIN_MS - (t - this.lastNotify));
  }

  flushNotify() {
    if (!this.notifyTimer) return;
    clearTimeout(this.notifyTimer);
    this.notifyTimer = null;
    this.notifyChange(true);
  }

  /** @returns {() => void} unsubscribe */
  onChange(cb) {
    this.changeCbs.add(cb);
    return () => this.changeCbs.delete(cb);
  }

  /** cb({ from, name, text, system }) */
  onChat(cb) {
    this.chatCbs.add(cb);
    return () => this.chatCbs.delete(cb);
  }

  /** cb({ setup, myIndex, conn }); called at once if the game already started. */
  onStart(cb) {
    this.startCbs.add(cb);
    if (this.startInfo) queueMicrotask(() => this.startCbs.has(cb) && cb(this.startInfo));
    return () => this.startCbs.delete(cb);
  }

  /** cb(reason) when removed from the lobby or the host is gone. */
  onKicked(cb) {
    this.kickCbs.add(cb);
    return () => this.kickCbs.delete(cb);
  }

  /** Change my own slot: { pantheon, team, color }. */
  setMine(patch = {}) {
    const p = {};
    for (const k of ['pantheon', 'team', 'color']) if (patch[k] !== undefined) p[k] = patch[k];
    return this.conn.send({ t: MSG.LOBBY, patch: p });
  }

  sendChat(text) {
    const t = sanitizeChat(text);
    if (t) this.conn.send({ t: MSG.CHAT, text: t });
  }

  /** Leave the lobby. */
  leave() {
    if (this.started) {
      this.conn.close('left'); // the game session closes it too; this covers a game that never started
      return;
    }
    this.kicked = this.kicked || 'left';
    for (const off of this.offs) off();
    this.conn.close('left');
  }
}
