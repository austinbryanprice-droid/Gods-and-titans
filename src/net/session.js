// Game sessions (DESIGN 7). The host runs the authoritative World and the AIs
// on a fixed-rate ticker and streams delta snapshots; clients only decode them
// into their ViewState and send commands. Both expose the same surface:
//   { setup, myIndex, mapData, viewState, sendCommand(cmd), sendChat(text), sendMark(mark),
//     onChat(cb), onMark(cb), onEnd(cb), start(), stop(), pingMs, isHost }
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
  RateLimiter, sanitizeChat, sanitizeName, sanitizeReason,
} from './protocol.js';
import { sanitizeCommand, sanitizeMark, isValidSnapshot, sanitizeFelled } from './sanitize.js';
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
};
export const RESYNC_MIN_INTERVAL_MS = 1000; // at most one full snapshot per client per second
const CLIENT_CHAT_LIMIT = [10, 30]; // chat lines a client shows per second (bad host flooding)
const CLIENT_MARK_LIMIT = [8, 20]; // teammates' marks a client shows per second (bad host flooding)
// Events and felled trees of snapshots held back from a congested client; past this the
// client gets a full snapshot instead (it repairs everything).
const MAX_HELD_ITEMS = 2000;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

class SessionBase {
  constructor(setup, myIndex) {
    this.setup = setup;
    this.myIndex = myIndex;
    this.chatCbs = new Set();
    this.markCbs = new Set();
    this.endCbs = new Set();
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
   * @param {(world: object, index: number, difficulty: string) => { tick(): void }} [o.createAI]
   * @param {(world: object, players: number[]) => { step(events: object[]): { from: number, text: string }[] }} [o.createVoices]
   *   the AI players' chat lines (src/ai/voice.js); only the setup's own AI slots speak
   * @param {boolean} [o.autoTick] run the ticker on start() (tests step manually with step())
   * @param {boolean} [o.useWorker] allow the background-proof worker metronome
   * @param {number} [o.viewDelayMs] local interpolation delay
   * @param {number} [o.connTimeoutMs] silence after which a client counts as gone (GAME_TIMEOUT_MS)
   */
  constructor({
    setup, myIndex = 0, conns = new Map(), createWorld, createAI = null, createVoices = null, autoTick = true, useWorker = true, viewDelayMs = HOST_VIEW_DELAY_MS,
    connTimeoutMs = GAME_TIMEOUT_MS,
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
    this.viewState = new ViewState({ setup, mapData: this.mapData, myIndex, interpDelayMs: viewDelayMs });
    this.pingMs = 0;
    this.ais = new Map();
    for (const p of setup.players) if (p.kind === 'ai') this.addAI(p.index, p.difficulty || 'normal');
    // An AI that took over from a player who left keeps quiet: it speaks under that player's name.
    this.voices = null;
    const voiced = [...this.ais.keys()];
    if (createVoices && voiced.length) {
      try {
        this.voices = createVoices(this.world, voiced);
      } catch (err) {
        this.reportError('voice-create', err);
      }
    }
    this.clients = new Map();
    this.leftPlayers = new Set();
    this.felledAll = [];
    this.ticksSinceSnap = 0;
    this.snapshotsSent = 0;
    this.lastSnap = null;
    this.netStats = { encodes: 0, encodeMs: 0, encodeMaxMs: 0, skipped: 0 };
    this.takeSnapshot();
    for (const [index, conn] of conns || []) this.attach(index, conn);
    this.ticker = new Ticker({ onTick: () => this.tickOnce(), onBatch: () => this.afterTicks(), useWorker });
  }

  addAI(index, difficulty) {
    if (!this.createAI) {
      if (!this.warnedNoAI) console.warn('[net] HostSession has no createAI; AI players will stand still.');
      this.warnedNoAI = true;
      return null;
    }
    try {
      const ai = this.createAI(this.world, index, difficulty);
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
      },
      dropped: { cmd: 0, chat: 0, ping: 0, mark: 0, invalid: 0, resync: 0 },
      skipped: 0, // snapshots held back while this client's send queue was full
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
        if (!this.started) return; // nothing to command before the game runs
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
        c.conn.send({ t: MSG.PONG, ts: Number.isFinite(msg.ts) ? msg.ts : 0 });
        if (Number.isFinite(msg.rtt) && msg.rtt >= 0) c.rtt = Math.min(msg.rtt, 60000);
        break;
      case MSG.RESYNC:
        this.requestFull(c);
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

  handleDisconnect(c) {
    if (this.stopped || this.clients.get(c.index) !== c) return;
    for (const off of c.offs) off();
    if (c.fullTimer) clearTimeout(c.fullTimer);
    this.clients.delete(c.index);
    this.leftPlayers.add(c.index);
    const name = this.playerName(c.index);
    const p = this.lastSnap && this.lastSnap.players && this.lastSnap.players[c.index];
    const over = this.lastSnap && this.lastSnap.gameOver;
    let text = `${name} has left the game.`;
    if (!over && !(p && p.defeated) && !this.ais.has(c.index)) {
      if (this.addAI(c.index, 'normal')) text = `${name} has left the game. An AI (Normal) takes over.`;
    }
    this.broadcastChat({ from: -1, name: '', text, system: true });
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

  broadcastChat(line) {
    this.emitChat(line);
    const msg = { t: MSG.CHAT, ...line };
    for (const c of this.clients.values()) c.conn.send(msg);
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
    this.takeSnapshot();
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
    if (this.voices && this.lastSnap) this.speak(snap.events);
    this.viewState.pushSnapshot(snap, now());
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
    if (this.autoTick) this.ticker.start();
  }

  /** Run `n` ticks now and send the resulting snapshot (tests, or a paused ticker). */
  step(n = 1) {
    if (this.stopped) return;
    if (!this.started) this.start();
    this.ticker.run(n);
  }

  /** Issue a command for the host's own player. */
  sendCommand(cmd) {
    if (this.stopped || !cmd || typeof cmd.type !== 'string') return;
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
   * Stop the game: clients get `end` and their connections close.
   * @param {string} [reason] defaults to 'game-over' after a victory, else 'host-quit'
   */
  stop(reason) {
    if (this.stopped) return;
    this.stopped = true;
    this.ticker.stop();
    const why = reason || (this.lastSnap && this.lastSnap.gameOver ? 'game-over' : REASONS.HOST_QUIT);
    for (const c of this.clients.values()) {
      for (const off of c.offs) off();
      if (c.fullTimer) clearTimeout(c.fullTimer);
      c.conn.send({ t: MSG.END, reason: why });
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
   */
  constructor({
    setup, myIndex, conn, generateMap = mapgen.generateMap, interpDelayMs = INTERP_DELAY_MS, pingIntervalMs = PING_INTERVAL_MS, mapData = null,
    connTimeoutMs = GAME_TIMEOUT_MS,
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
    this.viewState = new ViewState({ setup, mapData: this.mapData, myIndex, interpDelayMs });
    this.snap = null;
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
        if (!this.stopped) this.finish({ reason: REASONS.HOST_LEFT });
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
      case MSG.KICK:
      case MSG.END:
        this.finish({ reason: sanitizeReason(msg.reason, REASONS.HOST_QUIT) });
        break;
      default:
        break;
    }
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

  /** Leave the game (closes the connection; the host's AI takes over). */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stopTimers();
    for (const off of this.offs) off();
    this.conn.close('quit');
  }
}
