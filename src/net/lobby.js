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
const aiName = (difficulty) => `AI (${difficulty[0].toUpperCase()}${difficulty.slice(1)})`;

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
    preset: PRESETS.includes(state.preset) ? state.preset : null,
    peace: PEACE_LENGTHS.includes(state.peace) ? state.peace : 0,
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
  const names = distinctNames(active.map(({ slot }, index) => slot.name || (slot.kind === 'ai' ? aiName(slot.difficulty) : `Player ${index + 1}`)));
  const players = active.map(({ slot, slotIndex }, index) => {
    slotToPlayer.set(slotIndex, index);
    const ai = slot.kind === 'ai';
    return {
      index,
      name: names[index],
      team: slot.team,
      pantheon: pantheons[index],
      color: PLAYER_COLORS[slot.color] || PLAYER_COLORS[index % PLAYER_COLORS.length],
      kind: ai ? 'ai' : 'human',
      difficulty: ai ? slot.difficulty : null,
    };
  });
  const setup = { version, seed, mapSize: state.mapSize, players };
  if (PEACE_LENGTHS.includes(state.peace)) setup.peaceMinutes = state.peace; // Decade of Peace
  if (state.sacred === true) setup.sacredVictory = true; // Sacred Victory (DESIGN 5.11)
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
   * @returns {Promise<LobbyHost>}
   */
  static async create(opts = {}) {
    const transport = opts.transport || 'none';
    const ep = await hostRoom({ transport, roomCode: opts.roomCode, params: opts.params });
    return new LobbyHost(ep, { ...opts, transport });
  }

  constructor(endpoint, { transport, name, version = PROTOCOL_VERSION }) {
    this.endpoint = endpoint;
    this.transport = transport;
    this.version = version;
    this.roomCode = endpoint.roomCode;
    this.online = transport !== 'none';
    this.members = new Set(); // { conn, peerId, name, joined, offs }
    this.changeCbs = new Set();
    this.chatCbs = new Set();
    this.started = false;
    this.closed = false;
    this.gameConns = null;
    this.state = {
      roomCode: this.roomCode,
      version,
      mapSize: 'small',
      preset: null,
      peace: 0,
      sacred: false,
      started: false,
      slots: [slotOf('host', { name: sanitizeName(name, 'Host'), peerId: 'host' })],
    };
    for (let i = 1; i < MAX_PLAYERS; i++) this.state.slots.push(slotOf('closed', { team: i + 1, color: i }));
    this.applyPreset('1v1');
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
    if (this.started || this.closed) {
      conn.send({ t: MSG.KICK, reason: this.started ? REASONS.STARTED : REASONS.HOST_CLOSED });
      setTimeout(() => conn.close('kicked'), KICK_CLOSE_DELAY_MS);
      return;
    }
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
      const index = this.state.slots.findIndex((s) => s.kind === 'open');
      if (index < 0) return this.kickMember(m, REASONS.FULL);
      const prev = this.state.slots[index];
      const name = this.uniqueName(sanitizeName(msg.name, `Player ${index + 1}`));
      this.state.slots[index] = slotOf('human', { name, team: prev.team, color: this.freeColor(prev.color, index), peerId: m.peerId });
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

  /** Decade of Peace: minutes of game time without combat between players (30 | 45 | 60), or 0 for a normal game. */
  setPeace(minutes) {
    if (this.started || (minutes !== 0 && !PEACE_LENGTHS.includes(minutes)) || this.state.peace === minutes) return false;
    this.state.peace = minutes;
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
   * '1v1' (2 slots, small map), '2v2' (teams 1,1,2,2), 'ffa' (everyone alone).
   * Connected players keep their settings (and are moved to the first slots).
   * Returns false if the preset cannot hold the connected players.
   */
  applyPreset(name) {
    if (this.started || !PRESETS.includes(name)) return false;
    const slots = this.state.slots;
    const humans = slots.filter((s) => s.kind === 'host' || s.kind === 'human');
    const prevAi = slots.filter((s) => s.kind === 'ai');
    let layout; // [{ team, fill }]
    if (name === '1v1') {
      if (humans.length > 2) return false;
      layout = [{ team: 1 }, { team: 2, fill: this.online ? 'open' : 'ai' }, { fill: 'closed' }, { fill: 'closed' }];
    } else if (name === '2v2') {
      layout = [1, 1, 2, 2].map((team) => ({ team, fill: 'ai' }));
    } else if (name === 'ffa') {
      layout = [1, 2, 3, 4].map((team) => ({ team, fill: 'ai' }));
    } else {
      // coop
      if (humans.length >= MAX_PLAYERS) return false;
      layout = [];
      for (let i = 0; i < MAX_PLAYERS; i++) {
        if (i < humans.length) layout.push({ team: 1 });
        else if (i === humans.length && humans.length < 2) layout.push({ team: 1, fill: this.online ? 'open' : 'ai' });
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
        const difficulty = old ? old.difficulty : 'normal';
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
    if (new Set(active.map((s) => s.team)).size < 2) return 'Players must be on at least two different teams.';
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
      m.conn.send({ t: MSG.START, setup, you: index });
    }
    this.members.clear();
    this.started = true;
    this.state.started = true;
    this.gameConns = conns;
    for (const cb of [...this.changeCbs]) cb(this.state);
    // The endpoint (PeerJS peer) must outlive the game connections; drop it once they are all gone.
    let live = conns.size;
    if (live === 0) this.endpoint.close();
    for (const conn of conns.values()) {
      conn.onClose(() => {
        if (--live === 0) this.endpoint.close();
      });
    }
    return { setup, myIndex: slotToPlayer.get(0), conns };
  }

  /**
   * Leave the lobby. Before the game starts this tells everyone and closes all
   * connections; after the start it stops accepting new players and, a moment later,
   * closes whatever game connection is still open (the session closes its own).
   */
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.started) {
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
   * @returns {Promise<LobbyClient>}
   */
  static async join(opts = {}) {
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

  constructor(conn, { name, version = PROTOCOL_VERSION } = {}) {
    this.conn = conn;
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
      this.conn.send({ t: MSG.HELLO, name: this.name, version: this.version });
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
      this.startInfo = { setup: valid.setup, myIndex: valid.myIndex, conn: this.conn };
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
