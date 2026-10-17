// Game sessions (DESIGN 7). The host runs the authoritative World and the AIs
// on a fixed-rate ticker and streams delta snapshots; clients only decode them
// into their ViewState and send commands. Both expose the same surface:
//   { setup, myIndex, mapData, viewState, sendCommand(cmd), sendChat(text),
//     onChat(cb), onEnd(cb), start(), stop(), pingMs, isHost }
import { INTERP_DELAY_MS, SNAPSHOT_EVERY_TICKS } from '../config.js';
import { ViewState } from '../game/view-state.js';
import * as mapgen from '../sim/mapgen.js';
import { encode, apply } from './delta.js';
import { MSG, REASONS, PING_INTERVAL_MS, sanitizeChat } from './protocol.js';
import { Ticker } from './ticker.js';

export const HOST_VIEW_DELAY_MS = 50;
const END_CLOSE_DELAY_MS = 300;
const RESYNC_RETRY_MS = 2000;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

class SessionBase {
  constructor(setup, myIndex) {
    this.setup = setup;
    this.myIndex = myIndex;
    this.chatCbs = new Set();
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
   * @param {boolean} [o.autoTick] run the ticker on start() (tests step manually with step())
   * @param {boolean} [o.useWorker] allow the background-proof worker metronome
   * @param {number} [o.viewDelayMs] local interpolation delay
   */
  constructor({ setup, myIndex = 0, conns = new Map(), createWorld, createAI = null, autoTick = true, useWorker = true, viewDelayMs = HOST_VIEW_DELAY_MS }) {
    super(setup, myIndex);
    if (typeof createWorld !== 'function') throw new Error('HostSession needs createWorld(setup).');
    this.isHost = true;
    this.createAI = createAI;
    this.autoTick = autoTick;
    this.world = createWorld(setup);
    this.mapData = this.world.mapData
      || mapgen.generateMap({ seed: setup.seed, mapSize: setup.mapSize, playerCount: setup.players.length });
    this.viewState = new ViewState({ setup, mapData: this.mapData, myIndex, interpDelayMs: viewDelayMs });
    this.pingMs = 0;
    this.ais = new Map();
    for (const p of setup.players) if (p.kind === 'ai') this.addAI(p.index, p.difficulty || 'normal');
    this.clients = new Map();
    this.leftPlayers = new Set();
    this.felledAll = [];
    this.ticksSinceSnap = 0;
    this.snapshotsSent = 0;
    this.lastSnap = null;
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
    const c = { index, conn, base: null, needsFull: true, rtt: null, offs: [] };
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

  handleClientMessage(c, msg) {
    if (this.stopped) return;
    switch (msg.t) {
      case MSG.CMD: {
        const cmd = msg.cmd;
        if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd) || typeof cmd.type !== 'string') return;
        const clean = { ...cmd };
        delete clean.player;
        delete clean.playerIndex;
        try {
          this.world.issueCommand(c.index, clean); // always the sender's own player index
        } catch (err) {
          this.reportError('command', err);
        }
        break;
      }
      case MSG.CHAT: {
        const text = sanitizeChat(msg.text);
        if (text) this.broadcastChat({ from: c.index, name: this.playerName(c.index), text, system: false });
        break;
      }
      case MSG.PING:
        c.conn.send({ t: MSG.PONG, ts: msg.ts });
        if (typeof msg.rtt === 'number' && Number.isFinite(msg.rtt)) c.rtt = msg.rtt;
        break;
      case MSG.RESYNC:
        c.needsFull = true;
        if (!this.ticker.running) this.sendSnapshot(c, this.lastSnap);
        break;
      default:
        break;
    }
  }

  handleDisconnect(c) {
    if (this.stopped || this.clients.get(c.index) !== c) return;
    for (const off of c.offs) off();
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

  broadcastChat(line) {
    this.emitChat(line);
    const msg = { t: MSG.CHAT, ...line };
    for (const c of this.clients.values()) c.conn.send(msg);
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
    this.viewState.pushSnapshot(snap, now());
    if (this.lastSnap) this.broadcastSnapshot(snap);
    // felledAll in a `full` lists trees felled before that snapshot; its own felled come with it.
    if (snap.felled) for (const f of snap.felled) this.felledAll.push(f);
    this.lastSnap = snap;
    return snap;
  }

  broadcastSnapshot(snap) {
    const cache = new Map(); // one encode per distinct base (normally all clients share one)
    for (const c of this.clients.values()) {
      if (!c.conn.open) continue;
      if (c.needsFull || !c.base) {
        this.sendSnapshot(c, snap);
        continue;
      }
      let d = cache.get(c.base);
      if (!d) {
        d = encode(c.base, snap);
        cache.set(c.base, d);
      }
      c.conn.send({ t: MSG.DELTA, d });
      c.base = snap;
      this.snapshotsSent++;
    }
  }

  sendSnapshot(c, snap) {
    if (!snap) return;
    c.conn.send({ t: MSG.FULL, snap, felledAll: this.felledAll });
    c.base = snap;
    c.needsFull = false;
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
   */
  constructor({ setup, myIndex, conn, generateMap = mapgen.generateMap, interpDelayMs = INTERP_DELAY_MS, pingIntervalMs = PING_INTERVAL_MS, mapData = null }) {
    super(setup, myIndex);
    this.isHost = false;
    this.conn = conn;
    this.pingIntervalMs = pingIntervalMs;
    this.mapData = mapData || generateMap({ seed: setup.seed, mapSize: setup.mapSize, playerCount: setup.players.length });
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
    this.offs = [
      conn.onMessage((msg) => this.handleMessage(msg)),
      conn.onClose(() => {
        if (!this.stopped) this.finish({ reason: REASONS.HOST_LEFT });
      }),
    ];
  }

  handleMessage(msg) {
    if (this.stopped) return;
    switch (msg.t) {
      case MSG.FULL:
        if (!msg.snap) return;
        this.snap = msg.snap;
        this.awaitingFull = false;
        this.viewState.pushSnapshot(msg.snap, now(), { felledAll: msg.felledAll || [] });
        if (this.readyCbs.size) {
          for (const cb of [...this.readyCbs]) cb(this);
          this.readyCbs.clear();
        }
        break;
      case MSG.DELTA: {
        const d = msg.d;
        if (!d || !this.snap || d.b !== this.snap.tick) {
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
        this.snap = next;
        this.viewState.pushSnapshot(next, now());
        break;
      }
      case MSG.CHAT:
        this.emitChat({ from: msg.from, name: msg.name || this.playerName(msg.from), text: String(msg.text || ''), system: !!msg.system });
        break;
      case MSG.PONG:
        if (typeof msg.ts === 'number') this.pingMs = Math.max(0, Math.round(now() - msg.ts));
        break;
      case MSG.KICK:
      case MSG.END:
        this.finish({ reason: msg.reason || REASONS.HOST_QUIT });
        break;
      default:
        break;
    }
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

  /** cb(session) once the first full snapshot has arrived (at once if it already has). */
  onReady(cb) {
    if (this.snap) queueMicrotask(() => cb(this));
    else this.readyCbs.add(cb);
  }

  ping() {
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
