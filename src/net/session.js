// Game sessions (DESIGN 7). The host runs the authoritative World and the AIs
// on a fixed-rate ticker and streams delta snapshots; clients only decode them
// into their ViewState and send commands. Both expose the same surface:
//   { setup, myIndex, mapData, viewState, sendCommand(cmd), sendChat(text), sendMark(mark), sendPause(on),
//     onChat(cb), onMark(cb), onEnd(cb), onPause(cb), start(), stop(), pingMs, isHost, pause }
// Everything that arrives over the network is untrusted: the host validates and
// rate-limits each client's messages (sanitize.js); clients validate snapshots
// and drop what they cannot use (a bad host can end the game, not crash it).
import { INTERP_DELAY_MS, SNAPSHOT_EVERY_TICKS } from '../config.js';
import { MARK_RATE } from '../data/marks.js';
import { ViewState } from '../game/view-state.js';
import * as mapgen from '../sim/mapgen.js';
import { encode, apply } from './delta.js';
import {
  MSG, REASONS, PING_INTERVAL_MS, GAME_TIMEOUT_MS, STALL_NOTICE_MS, MAX_CLIENT_BUFFER_BYTES,
  HANDOFF_EVERY_MS, HANDOFF_FIRST_MS, HANDOFF_WAIT_MS, ONLINE_PAUSES, PAUSE_MAX_MS,
  RateLimiter, sanitizeChat, sanitizeName, sanitizeReason, normalizeRoomCode, isValidRoomCode,
} from './protocol.js';
import { sanitizeCommand, sanitizeMark, isValidSnapshot, sanitizeFelled } from './sanitize.js';
import { sanitizePlan, sanitizeHandoff, randomProof } from './handoff.js';
import { Ticker } from './ticker.js';

export const HOST_VIEW_DELAY_MS = 50;
const END_CLOSE_DELAY_MS = 300;
const RESYNC_RETRY_MS = 2000;
// Per-client limits on the host (token buckets: rate per second, burst). A human
// sends a few commands per second (a 24-unit cast spree is 24 at once).
export const CLIENT_LIMITS = {
  cmd: [40, 80],
  chat: [1, 5],
  ping: [4, 8],
  mark: MARK_RATE, // team pings and markers: a few a second is plenty to talk with
  pause: [1, 5],
};
export const RESYNC_MIN_INTERVAL_MS = 1000;
// A player who rejoins builds the whole game (renderer, models) while the game runs on, and cannot
// answer meanwhile: their new link may stay silent this long, until a few pings show they are playing.
export const REJOIN_GRACE_MS = 120000;
const REJOIN_GRACE_PINGS = 3; // at most one full snapshot per client per second
const CLIENT_CHAT_LIMIT = [10, 30]; // chat lines a client shows per second (bad host flooding)
const CLIENT_MARK_LIMIT = [8, 20]; // teammates' marks a client shows per second (bad host flooding)
// Events and felled trees of snapshots held back from a congested client; past this the
// client gets a full snapshot instead (it repairs everything).
const MAX_HELD_ITEMS = 2000;
// A graceful hand-over (the host quits through the menu) waits at most this long for the fresh backup to leave.
const HANDOFF_FLUSH_MS = 4000;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'brutal'];
const difficultyName = (d) => `${d[0].toUpperCase()}${d.slice(1)}`;

/**
 * How well the AI that holds a dropped player's seat plays: as well as the hardest computer player
 * of the game, so a player who drops out of a Hard game is not left with an easy stand-in; Normal
 * in a game of people only.
 */
export function standInDifficulty(setup) {
  let best = -1;
  for (const p of (setup && setup.players) || []) if (p && p.kind === 'ai') best = Math.max(best, DIFFICULTY_ORDER.indexOf(p.difficulty));
  return best >= 0 ? DIFFICULTY_ORDER[best] : 'normal';
}

class SessionBase {
  constructor(setup, myIndex) {
    this.setup = setup;
    this.myIndex = myIndex;
    this.chatCbs = new Set();
    this.markCbs = new Set();
    this.endCbs = new Set();
    this.pauseCbs = new Set();
    this.rematchCbs = new Set();
    this.pause = null; // { by, reason: 'player'|'handoff', endsAt (local ms), left } while an online game is paused
    this.chatLog = [];
    this.ended = false;
    this.stopped = false;
    this.started = false;
    this.errorCounts = {};
  }

  playerName(i) {
    if (i < 0) return '';
    const p = this.setup.players[i];
    return p ? p.name : `Player ${i + 1}`;
  }

  /** cb({ from, name, text, system }) for every chat line, own lines included. */
  onChat(cb) {
    this.chatCbs.add(cb);
    return () => this.chatCbs.delete(cb);
  }

  /** cb({ reason }) when the game ends from the outside (host left, kicked, …). */
  onEnd(cb) {
    this.endCbs.add(cb);
    return () => this.endCbs.delete(cb);
  }

  /** cb({ from, name, kind, x, y }) for every team mark: a teammate's, and my own the moment I send it. */
  onMark(cb) {
    this.markCbs.add(cb);
    return () => this.markCbs.delete(cb);
  }

  /** cb(pause) whenever an online game is paused (pause: { by, reason, endsAt, left }) or goes on (null). */
  onPause(cb) {
    this.pauseCbs.add(cb);
    return () => this.pauseCbs.delete(cb);
  }

  /**
   * cb(info) about a rematch once the game is over (DESIGN 7). On the host: { from, name } when a player asks
   * for one. On a client: { room } when the host has opened its room again for the rematch.
   */
  onRematch(cb) {
    this.rematchCbs.add(cb);
    return () => this.rematchCbs.delete(cb);
  }

  emitRematch(info) {
    for (const cb of [...this.rematchCbs]) {
      try {
        cb(info);
      } catch (err) {
        console.error('[net] rematch listener failed', err);
      }
    }
  }

  emitPause() {
    for (const cb of [...this.pauseCbs]) {
      try {
        cb(this.pause);
      } catch (err) {
        console.error('[net] pause listener failed', err);
      }
    }
  }

  emitMark(mark) {
    for (const cb of [...this.markCbs]) {
      try {
        cb(mark);
      } catch (err) {
        console.error('[net] mark listener failed', err);
      }
    }
  }

  /** Team number (setup) of a player index, or null. */
  teamOf(i) {
    const p = Number.isInteger(i) ? this.setup.players[i] : null;
    return p && Number.isInteger(p.team) ? p.team : null;
  }

  emitChat(line) {
    this.chatLog.push(line);
    if (this.chatLog.length > 100) this.chatLog.shift();
    for (const cb of [...this.chatCbs]) {
      try {
        cb(line);
      } catch (err) {
        console.error('[net] chat listener failed', err);
      }
    }
  }

  fireEnd(info) {
    if (this.ended) return;
    this.ended = true;
    for (const cb of [...this.endCbs]) {
      try {
        cb(info);
      } catch (err) {
        console.error('[net] end listener failed', err);
      }
    }
  }

  reportError(kind, err) {
    const n = (this.errorCounts[kind] = (this.errorCounts[kind] || 0) + 1);
    if (n <= 5 || n % 200 === 0) console.error(`[net] ${kind} error (#${n})`, err);
  }
}

export class HostSession extends SessionBase {
  /**
   * @param {object} o
   * @param {object} o.setup GameSetup
   * @param {number} [o.myIndex] the host's player index (0)
   * @param {Map<number, object>} [o.conns] player index → connection (from LobbyHost.start)
   * @param {(setup: object) => object} o.createWorld e.g. createWorld from src/sim/world.js
   * @param {(world: object, index: number, difficulty: string, opts?: { standIn?: boolean }) => { tick(): void }} [o.createAI]
   * @param {(world: object, players: number[]) => { step(events: object[]): { from: number, text: string }[] }} [o.createVoices]
   *   the AI players' chat lines (src/ai/voice.js); only the setup's own AI slots speak
   * @param {boolean} [o.autoTick] run the ticker on start() (tests step manually with step())
   * @param {boolean} [o.useWorker] allow the background-proof worker metronome
   * @param {number} [o.viewDelayMs] local interpolation delay
   * @param {number} [o.connTimeoutMs] silence after which a client counts as gone (GAME_TIMEOUT_MS)
   * @param {boolean} [o.resumed] createWorld hands back a loaded game (DESIGN 9.4): the trees felled before the
   *   save come down at once, and events left over from the saved tick are dropped
   * @param {object} [o.viewState] the ViewState to show this game in (a client that takes the game over keeps its own)
   */
  constructor({
    setup, myIndex = 0, conns = new Map(), createWorld, createAI = null, createVoices = null, autoTick = true, useWorker = true, viewDelayMs = HOST_VIEW_DELAY_MS,
    connTimeoutMs = GAME_TIMEOUT_MS, resumed = false, viewState = null,
  }) {
    super(setup, myIndex);
    this.connTimeoutMs = connTimeoutMs;
    if (typeof createWorld !== 'function') throw new Error('HostSession needs createWorld(setup).');
    this.isHost = true;
    this.createAI = createAI;
    this.autoTick = autoTick;
    this.world = createWorld(setup);
    this.mapData = this.world.mapData
      || mapgen.generateMap(mapgen.mapOptions(setup));
    this.viewState = viewState || new ViewState({ setup, mapData: this.mapData, myIndex, interpDelayMs: viewDelayMs });
    if (viewState) viewState.interpDelayMs = viewDelayMs; // the game runs here now: no network delay to cover
    this.pingMs = 0;
    this.ais = new Map();
    for (const p of setup.players) if (p.kind === 'ai') this.addAI(p.index, p.difficulty || 'normal');
    // An AI that took over from a player who left keeps quiet: it speaks under that player's name.
    this.voices = null;
    const voiced = [...this.ais.keys()];
    if (createVoices && voiced.length) {
      try {
        this.voices = createVoices(this.world, voiced);
        if (resumed && this.voices && typeof this.voices.resume === 'function') this.voices.resume();
      } catch (err) {
        this.reportError('voice-create', err);
      }
    }
    this.clients = new Map();
    this.leftPlayers = new Set();
    this.standIns = new Set(); // players whose seat an AI holds until they rejoin
    this.felledAll = [];
    this.ticksSinceSnap = 0;
    this.snapshotsSent = 0;
    this.lastSnap = null;
    this.netStats = { encodes: 0, encodeMs: 0, encodeMaxMs: 0, skipped: 0 };
    // Host migration (enableHandoff): { room, tokens, pack, heir, at, busy, sent }
    this.handoff = null;
    // Host migration: a secret per seat (index → hex) that only the game's host knows and shows in `start` to that seat,
    // so a player who reaches its room can tell the host from someone else sitting on the room's code (DESIGN 7).
    this.proofs = new Map();
    // Online pauses: each player's pauses left, the timer that ends a pause, and the players a new host waits for.
    this.pausesLeft = new Map();
    this.pauseTimer = null;
    this.waiting = new Set();
    if (resumed) {
      this.world.events = [];
      this.world.felled = [];
      this.felledAll = (this.world.felledAll || []).slice();
    }
    this.takeSnapshot();
    for (const [index, conn] of conns || []) this.attach(index, conn);
    this.ticker = new Ticker({ onTick: () => this.tickOnce(), onBatch: () => this.afterTicks(), useWorker });
  }

  /** @param {{ standIn?: boolean }} [opts] standIn: it holds the seat of a player who dropped out (createAI's 4th argument) */
  addAI(index, difficulty, opts = {}) {
    if (!this.createAI) {
      if (!this.warnedNoAI) console.warn('[net] HostSession has no createAI; AI players will stand still.');
      this.warnedNoAI = true;
      return null;
    }
    try {
      const ai = this.createAI(this.world, index, difficulty, opts);
      if (ai && typeof ai.tick === 'function') this.ais.set(index, ai);
      return ai;
    } catch (err) {
      this.reportError('ai-create', err);
      return null;
    }
  }

  attach(index, conn) {
    const c = {
      index, conn, base: null, needsFull: true, rtt: null, offs: [],
      lastFullAt: -Infinity, fullTimer: null, fulls: 0, held: null,
      limits: {
        cmd: new RateLimiter(...CLIENT_LIMITS.cmd),
        chat: new RateLimiter(...CLIENT_LIMITS.chat),
        ping: new RateLimiter(...CLIENT_LIMITS.ping),
        mark: new RateLimiter(...CLIENT_LIMITS.mark),
        pause: new RateLimiter(...CLIENT_LIMITS.pause),
      },
      dropped: { cmd: 0, chat: 0, ping: 0, mark: 0, pause: 0, invalid: 0, resync: 0 },
      skipped: 0, // snapshots held back while this client's send queue was full
      grace: null, // { pings } while a rejoined client may stay silent for REJOIN_GRACE_MS
    };
    if (typeof conn.setTimeoutMs === 'function') conn.setTimeoutMs(this.connTimeoutMs);
    this.clients.set(index, c);
    c.offs.push(conn.onMessage((msg) => this.handleClientMessage(c, msg)));
    c.offs.push(conn.onClose((reason) => this.handleDisconnect(c, reason)));
  }

  /** Round-trip times reported by the clients: Map<playerIndex, ms>. */
  get peerPings() {
    const m = new Map();
    for (const c of this.clients.values()) if (c.rtt !== null) m.set(c.index, c.rtt);
    return m;
  }

  /** Map bounds for command sanitizing. */
  get bounds() {
    return { width: this.mapData.width, height: this.mapData.height };
  }

  handleClientMessage(c, msg) {
    if (this.stopped || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case MSG.CMD: {
        if (!this.started || this.pause) return; // nothing to command before the game runs, or while it stands still
        if (!c.limits.cmd.take()) {
          c.dropped.cmd++;
          return;
        }
        const clean = sanitizeCommand(msg.cmd, this.bounds);
        if (!clean) {
          c.dropped.invalid++;
          return;
        }
        try {
          this.world.issueCommand(c.index, clean); // always the sender's own player index
        } catch (err) {
          this.reportError('command', err);
        }
        break;
      }
      case MSG.CHAT: {
        if (!c.limits.chat.take()) {
          c.dropped.chat++;
          return;
        }
        const text = sanitizeChat(msg.text);
        if (text) this.broadcastChat({ from: c.index, name: this.playerName(c.index), text, system: false });
        break;
      }
      case MSG.MARK: {
        if (!this.started) return;
        if (!c.limits.mark.take()) {
          c.dropped.mark++;
          return;
        }
        const clean = sanitizeMark(msg, this.bounds);
        if (!clean) {
          c.dropped.invalid++;
          return;
        }
        this.relayMark(c.index, clean); // always the sender's own player index
        break;
      }
      case MSG.PING:
        if (!c.limits.ping.take()) {
          c.dropped.ping++;
          return;
        }
        if (c.grace && ++c.grace.pings >= REJOIN_GRACE_PINGS) {
          c.grace = null;
          if (typeof c.conn.setTimeoutMs === 'function') c.conn.setTimeoutMs(this.connTimeoutMs);
        }
        c.conn.send({ t: MSG.PONG, ts: Number.isFinite(msg.ts) ? msg.ts : 0 });
        if (Number.isFinite(msg.rtt) && msg.rtt >= 0) c.rtt = Math.min(msg.rtt, 60000);
        break;
      case MSG.RESYNC:
        this.requestFull(c);
        break;
      case MSG.PAUSE:
        if (!c.limits.pause.take()) {
          c.dropped.pause++;
          return;
        }
        this.setPause(c.index, msg.on === true);
        break;
      case MSG.REMATCH:
        // Once per player, and only once the game is over: everyone hears who wants to play again.
        if (c.askedRematch || !(this.lastSnap && this.lastSnap.gameOver)) return;
        c.askedRematch = true;
        this.broadcastChat({ from: -1, name: '', text: `${this.playerName(c.index)} wants a rematch.`, system: true });
        this.emitRematch({ from: c.index, name: this.playerName(c.index) });
        break;
      default:
        break;
    }
  }

  /** A client asked for a full snapshot: at most one per RESYNC_MIN_INTERVAL_MS (resync spam). */
  requestFull(c) {
    if (!this.started) return; // start() sends the first one
    c.needsFull = true;
    const wait = c.lastFullAt + RESYNC_MIN_INTERVAL_MS - now();
    if (wait > 0) {
      c.dropped.resync++;
      if (!c.fullTimer) {
        c.fullTimer = setTimeout(() => {
          c.fullTimer = null;
          if (c.needsFull && !this.stopped && this.clients.get(c.index) === c) this.sendSnapshot(c, this.lastSnap);
        }, wait);
      }
      return;
    }
    // A running ticker sends it with the next snapshot; a paused one right now.
    if (!this.ticker.running) this.sendSnapshot(c, this.lastSnap);
  }

  /** Stop listening to a client's connection (it is gone, or replaced by a newer one). */
  detach(c) {
    for (const off of c.offs) off();
    if (c.fullTimer) clearTimeout(c.fullTimer);
    this.clients.delete(c.index);
  }

  handleDisconnect(c) {
    if (this.stopped || this.clients.get(c.index) !== c) return;
    this.detach(c);
    this.leftPlayers.add(c.index);
    const name = this.playerName(c.index);
    const p = this.lastSnap && this.lastSnap.players && this.lastSnap.players[c.index];
    const over = this.lastSnap && this.lastSnap.gameOver;
    let text = `${name} has left the game.`;
    if (!over && !(p && p.defeated) && !this.ais.has(c.index)) {
      const difficulty = standInDifficulty(this.setup);
      if (this.addAI(c.index, difficulty, { standIn: true })) {
        this.standIns.add(c.index);
        text = `${name} has left the game. An AI (${difficultyName(difficulty)}) plays for them until they rejoin, and keeps their god powers for them.`;
      }
    }
    this.broadcastChat({ from: -1, name: '', text, system: true });
    this.updatePlan();
  }

  /**
   * A player of this game comes back on a new connection (a lost link, a reloaded page; the lobby
   * has checked their rejoin token, DESIGN 7): the AI holding their seat hands it back, a link of
   * theirs still open is replaced, and they get the setup (`start`) and then a full snapshot.
   * @returns {string|null} why they cannot (a reason to show them), or null once they are back
   */
  rejoin(index, conn) {
    const p = Number.isInteger(index) ? this.setup.players[index] : null;
    if (this.stopped) return REASONS.HOST_QUIT;
    if (!p || p.kind !== 'human' || index === this.myIndex || !conn) return REASONS.REJOIN_DENIED;
    if (this.lastSnap && this.lastSnap.gameOver) return REASONS.REJOIN_OVER;
    const old = this.clients.get(index);
    if (old) {
      this.detach(old);
      old.conn.send({ t: MSG.KICK, reason: REASONS.REPLACED });
      setTimeout(() => old.conn.close('replaced'), END_CLOSE_DELAY_MS);
    }
    this.leftPlayers.delete(index);
    const tookOver = this.standIns.delete(index);
    if (tookOver) this.ais.delete(index);
    const proof = this.proofs.get(index);
    conn.send({ t: MSG.START, setup: this.setup, you: index, rejoin: true, ...(proof ? { proof } : {}) });
    this.attach(index, conn);
    const c = this.clients.get(index);
    c.grace = { pings: 0 };
    if (typeof conn.setTimeoutMs === 'function') conn.setTimeoutMs(Math.max(REJOIN_GRACE_MS, this.connTimeoutMs));
    if (this.started) this.sendSnapshot(c, this.lastSnap);
    if (this.pause) conn.send(this.pauseMessage());
    const name = this.playerName(index);
    // Everyone else hears it; the player who came back knows (no "<me> has rejoined" on their own screen).
    this.broadcastChat({ from: -1, name: '', text: tookOver ? `${name} has rejoined the game and takes back control from the AI.` : `${name} has rejoined the game.`, system: true }, index);
    if (this.plan) conn.send(this.planFor(index));
    this.updatePlan();
    // A new host waits for the players who were in the game when it moved (DESIGN 7), then plays on.
    if (this.waiting.delete(index) && !this.waiting.size && this.pause && this.pause.reason === 'handoff') this.setPause(-1, false);
    return null;
  }

  /**
   * Players who are not here (yet): an AI holds each seat until they come (back), as when a link drops.
   * A new host does this for everyone else of the game it took over (DESIGN 7).
   */
  seatAbsent(indices) {
    const difficulty = standInDifficulty(this.setup);
    const snapPlayers = (this.lastSnap && this.lastSnap.players) || [];
    for (const i of indices) {
      const p = this.setup.players[i];
      if (!p || p.kind !== 'human' || i === this.myIndex || this.clients.has(i) || this.ais.has(i)) continue;
      this.leftPlayers.add(i);
      if (snapPlayers[i] && snapPlayers[i].defeated) continue;
      if (this.addAI(i, difficulty, { standIn: true })) this.standIns.add(i);
    }
  }

  /**
   * Hold the game, paused, until these players have come back (a new host, DESIGN 7), or HANDOFF_WAIT_MS at most.
   * Anyone may go on sooner.
   */
  waitFor(indices) {
    this.waiting = new Set(indices.filter((i) => i !== this.myIndex && !this.clients.has(i)));
    if (this.waiting.size && this.started) this.setPause(-1, true, 'handoff');
  }

  // ---------------------------------------------------------------- pause (online games)

  /** The PAUSE message telling a client how the game stands. */
  pauseMessage() {
    const p = this.pause;
    if (!p) return { t: MSG.PAUSE, on: false };
    return { t: MSG.PAUSE, on: true, by: p.by, reason: p.reason, ms: Math.max(0, Math.round(p.endsAt - now())), left: p.left };
  }

  /**
   * Pause or resume the game for everyone (DESIGN 7): a player may pause ONLINE_PAUSES times a game, and a
   * pause ends after PAUSE_MAX_MS; any player still in the game may resume it. by -1 is the game itself
   * (a new host waiting for the players). Returns true if something changed.
   */
  setPause(by, on, reason = 'player') {
    if (this.stopped || !this.started || (this.lastSnap && this.lastSnap.gameOver)) return false;
    const me = by >= 0 && this.lastSnap && this.lastSnap.players ? this.lastSnap.players[by] : null;
    if (by >= 0 && me && me.defeated) return false; // a fallen player watches; they do not hold up the game
    if (on) {
      if (this.pause) return false;
      let left = null;
      if (by >= 0) {
        left = this.pausesLeft.has(by) ? this.pausesLeft.get(by) : ONLINE_PAUSES;
        if (left <= 0) {
          this.tellPlayer(by, `You have no pauses left in this game (${ONLINE_PAUSES} each).`);
          return false;
        }
        this.pausesLeft.set(by, --left);
      }
      const ms = reason === 'handoff' ? HANDOFF_WAIT_MS : PAUSE_MAX_MS;
      this.pause = { by, reason, endsAt: now() + ms, left };
      this.ticker.stop();
      this.pauseTimer = setTimeout(() => {
        this.pauseTimer = null;
        this.setPause(-1, false);
      }, ms);
      if (this.pauseTimer && typeof this.pauseTimer.unref === 'function') this.pauseTimer.unref();
      if (by >= 0) {
        const n = left === 1 ? '1 pause' : `${left} pauses`;
        this.broadcastChat({ from: -1, name: '', text: `${this.playerName(by)} paused the game (${n} left).`, system: true });
      } else if (reason === 'handoff') {
        const names = [...this.waiting].map((i) => this.playerName(i)).join(', ');
        this.broadcastChat({ from: -1, name: '', text: `${this.playerName(this.myIndex)} now hosts the game. Waiting for ${names || 'the other players'} to reconnect…`, system: true });
      }
    } else {
      if (!this.pause) return false;
      this.pause = null;
      this.waiting.clear();
      if (this.pauseTimer) clearTimeout(this.pauseTimer);
      this.pauseTimer = null;
      // Sim time stood still: the view re-anchors its clock on the next snapshot.
      this.viewState.resetClock();
      if (this.autoTick) this.ticker.start();
      this.broadcastChat({ from: -1, name: '', text: by >= 0 ? `${this.playerName(by)} resumed the game.` : 'The game goes on.', system: true });
    }
    const msg = this.pauseMessage();
    for (const c of this.clients.values()) c.conn.send(msg);
    this.emitPause();
    return true;
  }

  /** Pause (true) or resume (false) as the host's own player. */
  sendPause(on) {
    return this.setPause(this.myIndex, !!on);
  }

  /** A system line for one player only. */
  tellPlayer(index, text) {
    const line = { from: -1, name: '', text, system: true };
    if (index === this.myIndex) this.emitChat(line);
    else {
      const c = this.clients.get(index);
      if (c) c.conn.send({ t: MSG.CHAT, ...line });
    }
  }

  // ---------------------------------------------------------------- host migration (DESIGN 7)

  /**
   * Keep an heir ready to take the game over if this host leaves: the connected player picked by pickHeir
   * hears the plan (with every other client) and gets the whole game every HANDOFF_EVERY_MS.
   * @param {object} o
   * @param {string} o.room the room code the heir will open
   * @param {string} [o.here] this host's own room code, where everyone is now: a player who loses only their own link finds the host still there (Game.migrate)
   * @param {Map<number, string>} o.tokens every player's rejoin token (the heir seats them with these)
   * @param {(world: object, ais: Map) => Promise<{ enc, data }>|{ enc, data }} o.pack the game as handoff.encodeState gives it
   *   (packs the world when called; may compress after)
   */
  enableHandoff({ room, here = null, tokens, pack }) {
    if (typeof pack !== 'function' || !room) return;
    this.handoff = { room, here, tokens: tokens || new Map(), pack, at: -Infinity, busy: null, sent: 0 };
    // (A game carried on keeps the proofs it came with: the players got theirs from the host before.)
    // (Mine too: when I come back after leaving, the next host shows it to me.)
    for (const p of this.setup.players) if (p.kind === 'human' && !this.proofs.has(p.index)) this.proofs.set(p.index, randomProof());
    this.plan = null;
    this.updatePlan();
  }

  /**
   * The player who takes the game over: the connected one who is still playing (not defeated) with the
   * lowest index, else any connected one; null when nobody is.
   */
  pickHeir() {
    const players = (this.lastSnap && this.lastSnap.players) || [];
    let best = null;
    for (const c of this.clients.values()) {
      if (!c.conn.open || this.setup.players[c.index]?.kind !== 'human') continue;
      const out = !!(players[c.index] && players[c.index].defeated);
      if (!best || (best.out && !out) || (best.out === out && c.index < best.index)) best = { index: c.index, out };
    }
    return best ? best.index : null;
  }

  /** Tell every client who the heir is now (when that changed), and send a new heir the game soon. */
  updatePlan() {
    const h = this.handoff;
    if (!h || this.stopped) return;
    const heir = this.pickHeir();
    if (this.plan && this.plan.heir === heir) return;
    this.plan = heir === null ? null : { heir, room: h.room, host: this.myIndex, ...(h.here ? { at: h.here } : {}) };
    h.at = -Infinity;
    h.sent = 0;
    if (!this.plan) return;
    for (const c of this.clients.values()) c.conn.send(this.planFor(c.index));
  }

  /** The PLAN for one client: with that seat's proof, which only it and the heir get. */
  planFor(index) {
    const proof = this.proofs.get(index);
    return { t: MSG.PLAN, ...this.plan, ...(proof ? { proof } : {}) };
  }

  /** Send the heir the game when it is due (or now, with force). Resolves once it is handed to the link. */
  backup(force = false) {
    const h = this.handoff;
    if (!h || !this.plan || this.stopped || !this.started) return Promise.resolve(false);
    if (h.busy) return force ? h.busy.then(() => this.backup(true)) : Promise.resolve(false); // one at a time; a forced one goes next
    const t = now();
    if (!force && t - h.at < (h.sent ? HANDOFF_EVERY_MS : HANDOFF_FIRST_MS)) return Promise.resolve(false);
    const c = this.clients.get(this.plan.heir);
    if (!c || !c.conn.open || (!force && c.conn.buffered > MAX_CLIENT_BUFFER_BYTES)) return Promise.resolve(false);
    h.at = t;
    const heir = this.plan.heir;
    const tick = this.world.tickCount ?? (this.lastSnap ? this.lastSnap.tick : 0);
    const present = [this.myIndex, ...this.clients.keys()];
    const minds = new Map([...this.ais].filter(([i]) => !this.standIns.has(i)));
    const pauses = Object.fromEntries(this.pausesLeft); // pauses used stay used with the next host
    let packed;
    try {
      packed = h.pack(this.world, minds); // the world as it is now; the compression may finish later
    } catch (err) {
      this.reportError('handoff-pack', err);
      return Promise.resolve(false);
    }
    // While it compresses, h.busy is the promise of this backup (handOff waits for it).
    const done = h.busy = Promise.resolve(packed).then((state) => {
      if (this.stopped && !force) return false;
      const cc = this.clients.get(heir);
      if (!cc || !cc.conn.open || !this.plan || this.plan.heir !== heir) return false;
      cc.conn.send({ t: MSG.HANDOFF, room: h.room, tick, state, tokens: Object.fromEntries(h.tokens), present, pauses, proofs: Object.fromEntries(this.proofs) });
      h.sent++;
      return true;
    }, (err) => {
      this.reportError('handoff-pack', err);
      return false;
    }).finally(() => {
      if (h.busy === done) h.busy = null;
    });
    return done;
  }

  /** Can this host hand the game over if it leaves now (someone is there to take it)? */
  get canHandOff() {
    return !!(this.handoff && this.plan && this.handoff.sent > 0 && !(this.lastSnap && this.lastSnap.gameOver) && !this.stopped);
  }

  /** The player who would take the game over, or null. */
  get heir() {
    return this.plan ? this.plan.heir : null;
  }

  /**
   * Leave the game without ending it (DESIGN 7): the heir gets the game as it is now, and once it has gone
   * out (or after HANDOFF_FLUSH_MS) every client hears that the host quit; they carry on with the heir.
   * @returns {Promise<boolean>} whether the clients carry the game on with the heir (from this copy, or the
   *   one before when this one did not go out): the old host is told who hosts now (Game.quitToMenu)
   */
  async handOff() {
    if (!this.canHandOff) {
      this.stop();
      return false;
    }
    if (this.pause && this.pause.reason === 'player') this.setPause(-1, false);
    this.ticker.stop();
    const h = this.handoff;
    await this.backup(true); // (after any backup still compressing)
    const c = this.plan && this.clients.get(this.plan.heir);
    const t0 = now();
    while (c && c.conn.open && c.conn.buffered > 0 && now() - t0 < HANDOFF_FLUSH_MS) await new Promise((r) => setTimeout(r, 50));
    // Even when the newest copy did not go out, the heir carries on from the one before.
    const carry = h.sent > 0 && !!(this.plan && this.clients.has(this.plan.heir));
    this.stop(REASONS.HOST_QUIT, { carry });
    return carry;
  }

  /** The AIs' chat lines for these events (DESIGN 10.1), flagged `voice` so that a player can hide them. */
  speak(events) {
    let lines;
    try {
      lines = this.voices.step(events);
    } catch (err) {
      this.reportError('voice', err);
      return;
    }
    for (const l of lines || []) {
      const text = sanitizeChat(l.text);
      if (text && this.ais.has(l.from)) this.broadcastChat({ from: l.from, name: this.playerName(l.from), text, system: false, voice: true });
    }
  }

  /** A chat line for everyone (but the player `except`, when given: a line about that player meant for the others). */
  broadcastChat(line, except = null) {
    this.emitChat(line);
    const msg = { t: MSG.CHAT, ...line };
    for (const c of this.clients.values()) if (c.index !== except) c.conn.send(msg);
  }

  /**
   * A team mark (DESIGN 7, 9) goes to the sender's teammates and nobody else: the other teams'
   * connections never see it, so it cannot tell an enemy where an attack is called. The host's own
   * screen shows it when the host is on the team; the sender has shown it to itself already.
   */
  relayMark(from, mark) {
    const team = this.teamOf(from);
    if (team === null) return;
    const msg = { t: MSG.MARK, from, kind: mark.kind, x: mark.x, y: mark.y };
    for (const c of this.clients.values()) {
      if (c.index !== from && c.conn.open && this.teamOf(c.index) === team) c.conn.send(msg);
    }
    if (from !== this.myIndex && this.teamOf(this.myIndex) === team) {
      this.emitMark({ from, name: this.playerName(from), kind: mark.kind, x: mark.x, y: mark.y });
    }
  }

  tickOnce() {
    for (const ai of this.ais.values()) {
      try {
        ai.tick();
      } catch (err) {
        this.reportError('ai', err);
      }
    }
    try {
      this.world.tick();
    } catch (err) {
      this.reportError('sim', err);
    }
    this.ticksSinceSnap++;
  }

  afterTicks() {
    if (this.stopped || this.ticksSinceSnap < SNAPSHOT_EVERY_TICKS) return;
    const snap = this.takeSnapshot();
    if (this.handoff && snap) {
      // A defeated heir passes the turn to one still playing.
      if (this.plan && snap.players && snap.players[this.plan.heir] && snap.players[this.plan.heir].defeated) this.updatePlan();
      this.backup();
    }
  }

  takeSnapshot() {
    let snap;
    try {
      snap = this.world.getSnapshot();
    } catch (err) {
      this.reportError('snapshot', err);
      return null;
    }
    this.ticksSinceSnap = 0;
    // Seats a stand-in AI holds for a player who dropped out are marked, for everyone's career (DESIGN 9.1).
    if (this.standIns.size && Array.isArray(snap.players)) for (const i of this.standIns) if (snap.players[i]) snap.players[i].away = true;
    if (this.voices && this.lastSnap) this.speak(snap.events);
    // The first snapshot of a loaded game brings down the trees felled before the save.
    this.viewState.pushSnapshot(snap, now(), !this.lastSnap && this.felledAll.length ? { felledAll: this.felledAll } : null);
    if (this.lastSnap) this.broadcastSnapshot(snap);
    // felledAll in a `full` lists trees felled before that snapshot; its own felled come with it.
    if (snap.felled) for (const f of snap.felled) this.felledAll.push(f);
    this.lastSnap = snap;
    return snap;
  }

  broadcastSnapshot(snap) {
    const cache = new Map(); // one encode + one JSON per distinct base (normally all clients share one)
    const t = now();
    for (const c of this.clients.values()) {
      if (!c.conn.open) continue;
      if (!c.base) {
        this.sendSnapshot(c, snap);
        continue;
      }
      // A client whose link cannot keep up (its send queue is full) is skipped: queueing more
      // would only make its view older. The next delta is encoded against what it last got, so
      // the catch-up is lossless; only the events and felled trees of the skipped snapshots need
      // carrying over. A full snapshot it is waiting for goes out once the queue has drained.
      if (c.conn.buffered > MAX_CLIENT_BUFFER_BYTES) {
        if (!c.needsFull) this.holdSnapshot(c, snap);
        continue;
      }
      if (c.needsFull && t - c.lastFullAt >= RESYNC_MIN_INTERVAL_MS) {
        this.sendSnapshot(c, snap);
        continue;
      }
      let wire = c.held ? null : cache.get(c.base);
      if (!wire) {
        const t0 = now();
        const d = encode(c.base, c.held ? this.withHeld(c, snap) : snap);
        const ms = now() - t0;
        this.netStats.encodes++;
        this.netStats.encodeMs += ms;
        if (ms > this.netStats.encodeMaxMs) this.netStats.encodeMaxMs = ms;
        wire = { d, json: null };
        if (!c.held) cache.set(c.base, wire);
      }
      c.held = null;
      if (typeof c.conn.sendJSON === 'function') {
        if (wire.json === null) wire.json = JSON.stringify({ t: MSG.DELTA, d: wire.d });
        c.conn.sendJSON(wire.json);
      } else c.conn.send({ t: MSG.DELTA, d: wire.d });
      c.base = snap;
      this.snapshotsSent++;
    }
  }

  /** Skip this snapshot for a congested client, remembering the parts of it a delta cannot recover. */
  holdSnapshot(c, snap) {
    c.skipped++;
    this.netStats.skipped++;
    const h = c.held || (c.held = { events: [], felled: [] });
    if (snap.events) for (const ev of snap.events) h.events.push(ev);
    if (snap.felled) for (const f of snap.felled) h.felled.push(f);
    if (h.events.length + h.felled.length > MAX_HELD_ITEMS) {
      c.held = null;
      c.needsFull = true; // too much to carry: a full snapshot (once the queue drains) repairs it
    }
  }

  /** `snap` with the events and felled trees held back from the client in front of its own. */
  withHeld(c, snap) {
    return {
      ...snap,
      events: c.held.events.concat(snap.events || []),
      felled: c.held.felled.concat(snap.felled || []),
    };
  }

  sendSnapshot(c, snap) {
    if (!snap) return;
    c.conn.send({ t: MSG.FULL, snap, felledAll: this.felledAll });
    c.held = null; // a full snapshot starts the client over from `snap`
    c.base = snap;
    c.needsFull = false;
    c.lastFullAt = now();
    c.fulls++;
    this.snapshotsSent++;
  }

  /** Start ticking and send every client its first full snapshot. */
  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    for (const c of this.clients.values()) this.sendSnapshot(c, this.lastSnap);
    if (this.waiting.size) this.setPause(-1, true, 'handoff');
    if (this.autoTick && !this.pause) this.ticker.start();
  }

  /** Run `n` ticks now and send the resulting snapshot (tests, or a paused ticker). */
  step(n = 1) {
    if (this.stopped) return;
    if (!this.started) this.start();
    this.ticker.run(n);
  }

  /** Issue a command for the host's own player. */
  sendCommand(cmd) {
    if (this.stopped || this.pause || !cmd || typeof cmd.type !== 'string') return;
    const clean = { ...cmd };
    delete clean.player;
    delete clean.playerIndex;
    try {
      this.world.issueCommand(this.myIndex, clean);
    } catch (err) {
      this.reportError('command', err);
    }
  }

  sendChat(text) {
    const t = sanitizeChat(text);
    if (t) this.broadcastChat({ from: this.myIndex, name: this.playerName(this.myIndex), text: t, system: false });
  }

  /**
   * Mark a spot for my teammates ({ kind, x, y }, kinds in src/data/marks.js): shown on my own
   * screen at once and relayed to the rest of the team. Returns the clean mark, or null if unusable.
   */
  sendMark(mark) {
    if (this.stopped) return null;
    const clean = sanitizeMark(mark, this.bounds);
    if (!clean) return null;
    this.emitMark({ from: this.myIndex, name: this.playerName(this.myIndex), ...clean });
    this.relayMark(this.myIndex, clean);
    return clean;
  }

  /**
   * The game is over and this host's room is a lobby again (LobbyHost.reopen): tell every player still
   * here, so that their game-over screen can take them there. Sent right before `stop`.
   * @param {string} room the room code to join
   */
  inviteRematch(room) {
    if (this.stopped || !(this.lastSnap && this.lastSnap.gameOver)) return false;
    for (const c of this.clients.values()) c.conn.send({ t: MSG.REMATCH, room });
    return true;
  }

  /**
   * Stop the game: clients get `end` and their connections close.
   * @param {string} [reason] defaults to 'game-over' after a victory, else 'host-quit'
   * @param {object} [o] { carry: true } when the heir has the game and carries it on (handOff)
   */
  stop(reason, { carry = false } = {}) {
    if (this.stopped) return;
    this.stopped = true;
    this.ticker.stop();
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
    const why = reason || (this.lastSnap && this.lastSnap.gameOver ? 'game-over' : REASONS.HOST_QUIT);
    for (const c of this.clients.values()) {
      for (const off of c.offs) off();
      if (c.fullTimer) clearTimeout(c.fullTimer);
      c.conn.send(carry ? { t: MSG.END, reason: why, carry: true } : { t: MSG.END, reason: why });
      setTimeout(() => c.conn.close('end'), END_CLOSE_DELAY_MS);
    }
    this.clients.clear();
  }
}

export class ClientSession extends SessionBase {
  /**
   * @param {object} o
   * @param {object} o.setup GameSetup from the host's `start`
   * @param {number} o.myIndex
   * @param {object} o.conn connection to the host
   * @param {(opts: object) => object} [o.generateMap] map generator (src/sim/mapgen.js)
   * @param {number} [o.interpDelayMs]
   * @param {number} [o.pingIntervalMs]
   * @param {number} [o.connTimeoutMs] silence after which the host counts as gone (GAME_TIMEOUT_MS)
   * @param {object} [o.viewState] the ViewState to show the game in (a player following a new host keeps theirs)
   */
  constructor({
    setup, myIndex, conn, generateMap = mapgen.generateMap, interpDelayMs = INTERP_DELAY_MS, pingIntervalMs = PING_INTERVAL_MS, mapData = null,
    connTimeoutMs = GAME_TIMEOUT_MS, viewState = null,
  }) {
    super(setup, myIndex);
    this.isHost = false;
    this.conn = conn;
    this.pingIntervalMs = pingIntervalMs;
    this.mapData = mapData || generateMap(mapgen.mapOptions(setup));
    this.mapMismatch = false;
    if (setup.mapHash && typeof mapgen.mapHash === 'function') {
      const mine = mapgen.mapHash(this.mapData);
      if (mine !== setup.mapHash) {
        this.mapMismatch = true;
        console.error(`[net] Map mismatch: the host generated map ${setup.mapHash} but this browser generated ${mine}. Reload the page (Ctrl+Shift+R) so both players run the same version.`);
      }
    }
    this.viewState = viewState || new ViewState({ setup, mapData: this.mapData, myIndex, interpDelayMs });
    this.snap = null;
    this.plan = null; // { heir, room }: who takes the game over if the host leaves (DESIGN 7)
    this.backup = null; // the game itself, when I am that heir (sanitizeHandoff)
    this.awaitingFull = false;
    this.resyncAt = -Infinity;
    this.resyncs = 0;
    this.pingMs = null;
    this.pingTimer = null;
    this.readyCbs = new Set();
    this.ready = new Promise((resolve) => this.readyCbs.add(resolve));
    this.chatLimit = new RateLimiter(...CLIENT_CHAT_LIMIT);
    this.markLimit = new RateLimiter(...CLIENT_MARK_LIMIT);
    this.badMessages = 0;
    if (typeof conn.setTimeoutMs === 'function') conn.setTimeoutMs(connTimeoutMs);
    this.offs = [
      conn.onMessage((msg) => this.handleMessage(msg)),
      conn.onClose(() => {
        if (!this.stopped) this.finish(this.endInfo(REASONS.HOST_LEFT));
      }),
    ];
  }

  handleMessage(msg) {
    if (this.stopped || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case MSG.FULL: {
        const snap = msg.snap;
        if (!isValidSnapshot(snap)) {
          this.badMessage('full');
          this.requestResync();
          return;
        }
        if (!this.pushView(snap, sanitizeFelled(msg.felledAll, this.mapData.width, this.mapData.height))) return;
        this.awaitingFull = false;
        if (this.readyCbs.size) {
          for (const cb of [...this.readyCbs]) cb(this);
          this.readyCbs.clear();
        }
        break;
      }
      case MSG.DELTA: {
        const d = msg.d;
        if (!d || typeof d !== 'object' || !this.snap || d.b !== this.snap.tick) {
          this.requestResync();
          return;
        }
        let next;
        try {
          next = apply(this.snap, d);
        } catch (err) {
          this.reportError('delta', err);
          this.requestResync();
          return;
        }
        if (!isValidSnapshot(next)) {
          this.badMessage('delta');
          this.requestResync();
          return;
        }
        this.pushView(next, null);
        break;
      }
      case MSG.CHAT: {
        if (!this.chatLimit.take()) return;
        const text = sanitizeChat(msg.text);
        if (!text) return;
        const system = msg.system === true;
        const from = Number.isInteger(msg.from) && msg.from >= -1 && msg.from < this.setup.players.length ? msg.from : -1;
        const line = { from, name: system ? '' : sanitizeName(msg.name, this.playerName(from)), text, system };
        if (msg.voice === true && !system) line.voice = true; // an AI's line (DESIGN 10.1)
        this.emitChat(line);
        break;
      }
      case MSG.MARK: {
        // The host relays a mark to the sender's teammates only; a mark from anyone else is not shown.
        if (!this.markLimit.take()) return;
        const from = msg.from;
        if (!Number.isInteger(from) || from === this.myIndex || this.teamOf(from) === null || this.teamOf(from) !== this.teamOf(this.myIndex)) return;
        const clean = sanitizeMark(msg, { width: this.mapData.width, height: this.mapData.height });
        if (clean) this.emitMark({ from, name: this.playerName(from), ...clean });
        break;
      }
      case MSG.PONG:
        if (Number.isFinite(msg.ts) && msg.ts <= now()) this.pingMs = Math.max(0, Math.round(now() - msg.ts));
        break;
      case MSG.PLAN: {
        const plan = sanitizePlan(msg, this.setup);
        if (plan) this.plan = plan;
        break;
      }
      case MSG.HANDOFF: {
        const b = sanitizeHandoff(msg, this.setup);
        if (b) this.backup = b;
        else this.badMessage('handoff');
        break;
      }
      case MSG.PAUSE: {
        const was = this.pause;
        if (msg.on === true) {
          const by = Number.isInteger(msg.by) && msg.by >= -1 && msg.by < this.setup.players.length ? msg.by : -1;
          const ms = Number.isFinite(msg.ms) ? Math.min(Math.max(0, msg.ms), 10 * 60000) : 0;
          this.pause = { by, reason: msg.reason === 'handoff' ? 'handoff' : 'player', endsAt: now() + ms, left: Number.isInteger(msg.left) ? msg.left : null };
        } else {
          this.pause = null;
          if (was) this.viewState.resetClock(); // sim time stood still meanwhile
        }
        this.emitPause();
        break;
      }
      case MSG.REMATCH: {
        // Only after the game is over, and only a room code: the host's room is a lobby again.
        const room = typeof msg.room === 'string' && msg.room.length <= 16 ? normalizeRoomCode(msg.room) : '';
        if (!(this.snap && this.snap.gameOver) || !isValidRoomCode(room)) return this.badMessage('rematch');
        this.rematchRoom = room;
        this.emitRematch({ room });
        break;
      }
      case MSG.KICK:
        this.finish({ reason: sanitizeReason(msg.reason, REASONS.HOST_QUIT) });
        break;
      case MSG.END: {
        const reason = sanitizeReason(msg.reason, REASONS.HOST_QUIT);
        // A host who quits a game still being played leaves it to the heir (DESIGN 7), when it says so.
        this.finish(reason === REASONS.HOST_QUIT && msg.carry === true ? this.endInfo(reason) : { reason });
        break;
      }
      default:
        break;
    }
  }

  /**
   * What this player needs to carry the game on without the host (DESIGN 7), or null: { plan, backup } (the
   * backup only for the heir). Nothing once the game is over: there is nothing left to carry on.
   */
  handoffInfo() {
    if (!this.plan || (this.snap && this.snap.gameOver)) return null;
    if (this.plan.heir === this.myIndex && !this.backup) return null;
    return { plan: this.plan, backup: this.plan.heir === this.myIndex ? this.backup : null };
  }

  /** The end callback's info for the host leaving: { reason }, with { handoff } when the game can go on. */
  endInfo(reason) {
    const handoff = this.handoffInfo();
    return handoff ? { reason, handoff } : { reason };
  }

  /** Accept a decoded snapshot; false (and a resync) if the view could not take it. */
  pushView(snap, felledAll) {
    const prev = this.snap;
    this.snap = snap;
    try {
      this.viewState.pushSnapshot(snap, now(), felledAll ? { felledAll } : null);
      return true;
    } catch (err) {
      this.reportError('view', err);
      this.snap = prev;
      this.requestResync();
      return false;
    }
  }

  badMessage(kind) {
    this.badMessages++;
    this.reportError(`bad ${kind}`, new Error('invalid snapshot from the host'));
  }

  /** Ask the host for a full snapshot (deltas arrived out of sequence). */
  requestResync() {
    const t = now();
    if (this.awaitingFull && t - this.resyncAt < RESYNC_RETRY_MS) return;
    this.awaitingFull = true;
    this.resyncAt = t;
    this.resyncs++;
    this.conn.send({ t: MSG.RESYNC });
  }

  /**
   * Running milliseconds without a frame from the host (0 while frames flow or once the
   * link is closed). Deltas come every 50 ms and heartbeats every 2 s, so a few seconds
   * mean the connection is stuck, long before the 30 s timeout drops it. A stall of this
   * machine itself does not count (see MAX_PULSE_GAP_MS).
   */
  get stalledMs() {
    const c = this.conn;
    return c && c.open && !this.stopped ? c.silentMs || 0 : 0;
  }

  /** True when the host has gone quiet long enough to tell the player (STALL_NOTICE_MS). */
  get stalled() {
    return this.stalledMs >= STALL_NOTICE_MS;
  }

  /** cb(session) once the first full snapshot has arrived (at once if it already has). */
  onReady(cb) {
    if (this.snap) queueMicrotask(() => cb(this));
    else this.readyCbs.add(cb);
  }

  ping() {
    if (this.stalled) this.pingMs = null; // the last figure is stale: show '…' until a pong arrives
    this.conn.send({ t: MSG.PING, ts: now(), rtt: this.pingMs });
  }

  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    this.ping();
    this.pingTimer = setInterval(() => this.ping(), this.pingIntervalMs);
    if (this.pingTimer && typeof this.pingTimer.unref === 'function') this.pingTimer.unref();
  }

  sendCommand(cmd) {
    if (this.stopped || !cmd || typeof cmd.type !== 'string') return;
    this.conn.send({ t: MSG.CMD, cmd });
  }

  sendChat(text) {
    const t = sanitizeChat(text);
    if (t && !this.stopped) this.conn.send({ t: MSG.CHAT, text: t });
  }

  /** Ask the host to pause (true) or resume (false) the game for everyone. */
  sendPause(on) {
    if (this.stopped) return false;
    this.conn.send({ t: MSG.PAUSE, on: !!on });
    return true;
  }

  /**
   * Mark a spot for my teammates ({ kind, x, y }, kinds in src/data/marks.js): shown on my own
   * screen at once, then relayed by the host to the rest of the team. Returns the clean mark, or
   * null if unusable.
   */
  sendMark(mark) {
    if (this.stopped) return null;
    const clean = sanitizeMark(mark, { width: this.mapData.width, height: this.mapData.height });
    if (!clean) return null;
    this.conn.send({ t: MSG.MARK, ...clean });
    this.emitMark({ from: this.myIndex, name: this.playerName(this.myIndex), ...clean });
    return clean;
  }

  finish(info) {
    this.stopTimers();
    this.fireEnd(info);
    this.stopped = true;
    for (const off of this.offs) off();
    this.conn.close('end');
  }

  stopTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** Ask the host for a rematch (once, after the game is over). */
  askRematch() {
    if (this.stopped || this.askedRematch || !(this.snap && this.snap.gameOver)) return false;
    this.askedRematch = true;
    this.conn.send({ t: MSG.REMATCH });
    return true;
  }

  /** Leave the game (closes the connection; the host's AI takes over). */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stopTimers();
    for (const off of this.offs) off();
    this.conn.close('quit');
  }
}
