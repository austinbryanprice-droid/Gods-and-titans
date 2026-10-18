// Transports (DESIGN 7). Every transport hands out the same connection object:
//   conn = { id, send(msg), onMessage(cb) → off, onClose(cb) → off, close(), open }
// Messages are JSON objects; larger ones are split into ordered chunks
// (protocol.js framing) because WebRTC data channels limit message sizes.
// Idle connections exchange heartbeats so a vanished peer (closed tab, lost
// network) is detected within TIMEOUT_MS (GAME_TIMEOUT_MS once a game runs)
// even when no close event arrives. Silence is measured in time this page was
// actually running (see MAX_PULSE_GAP_MS), so a long main-thread stall here
// never closes a link whose messages are merely waiting to be dispatched.
// Incoming frames are untrusted: size limits, malformed-frame budget (see
// FrameDecoder); a connection that keeps sending garbage is closed.
//   peer     — PeerJS (WebRTC) through a signaling server, room code → host peer id
//   local    — BroadcastChannel `mythicwar-<code>`: tabs of one browser (testing)
//   loopback — in-memory, for Node tests
//   none     — no network (single player)
import { MAX_PLAYERS } from '../config.js';
import {
  CHUNK_SIZE, HEARTBEAT_MS, TIMEOUT_MS, JOIN_TIMEOUT_MS, CONNECT_TIMEOUT_MS, FRAME_HEARTBEAT, FRAME_BYE,
  MAX_PULSE_GAP_MS, MAX_HOST_MESSAGE_CHARS, MAX_CLIENT_MESSAGE_CHARS, MAX_FRAME_ERRORS, ERROR_WINDOW_MS,
  encodeFrames, FrameDecoder, makeRoomCode, normalizeRoomCode, peerIdFor, readNetParams, peerOptions, PEER_CLOUD,
} from './protocol.js';
import { createPulse } from './ticker.js';

export const TRANSPORTS = ['peer', 'local', 'loopback', 'none'];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const later = typeof setImmediate === 'function' ? setImmediate : (fn) => setTimeout(fn, 0);

/** The error a cancelled join rejects with (`signal` in joinRoom; `type` 'aborted'). */
export function abortError() {
  const e = new Error('Cancelled.');
  e.name = 'AbortError';
  e.type = 'aborted';
  return e;
}

// ---------------------------------------------------------------- liveness

const liveConns = new Set();
let livePulse = null;
let livePeriod = 0;
let unloadHooked = false;

function trackConn(conn) {
  liveConns.add(conn);
  // One shared timer checks every connection; it runs often enough for the most demanding one.
  const want = Math.max(20, Math.min(500, conn.heartbeatMs / 2, conn.timeoutMs > 0 ? conn.timeoutMs / 4 : 500));
  if (!livePulse || want < livePeriod) {
    if (livePulse) livePulse.stop();
    livePeriod = want;
    livePulse = createPulse(() => {
      const t = now();
      for (const c of [...liveConns]) c._heartbeat(t);
    }, want);
  }
  if (!unloadHooked && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    unloadHooked = true;
    // Say goodbye so the other side notices at once instead of after TIMEOUT_MS.
    window.addEventListener('pagehide', () => {
      for (const c of [...liveConns]) c.close('unload');
    });
  }
}

function untrackConn(conn) {
  liveConns.delete(conn);
  if (liveConns.size === 0 && livePulse) {
    livePulse.stop();
    livePulse = null;
  }
}

// ---------------------------------------------------------------- framed connection

let connSeq = 0;

/**
 * Connection over any ordered, reliable string pipe. Transports call
 * `_receive(frame)` for incoming frames and `_closed(reason)` when the pipe dies.
 */
export class FramedConn {
  /**
   * @param {object} o
   * @param {string} o.id identifier of the remote side
   * @param {(frame: string) => void} o.rawSend
   * @param {() => void} [o.rawClose]
   * @param {number} [o.chunkSize]
   * @param {number} [o.heartbeatMs] 0 disables heartbeats and the timeout
   * @param {number} [o.timeoutMs]
   * @param {number} [o.maxMessageChars] largest incoming message accepted
   * @param {number} [o.maxFrameErrors] malformed frames tolerated per ERROR_WINDOW_MS (0 = any number)
   * @param {boolean} [o.autoPulse] false: nobody calls _heartbeat (tests drive it with their own clock)
   * @param {number} [o.maxPulseGapMs] most silence one late pulse can add (MAX_PULSE_GAP_MS)
   * @param {() => number} [o.bufferedFn] bytes handed to the pipe that it has not sent yet (0 when unknown)
   */
  constructor({
    id, rawSend, rawClose = () => {}, chunkSize = CHUNK_SIZE, heartbeatMs = HEARTBEAT_MS, timeoutMs = TIMEOUT_MS, transport = '',
    maxMessageChars = MAX_HOST_MESSAGE_CHARS, maxFrameErrors = MAX_FRAME_ERRORS, autoPulse = true, maxPulseGapMs = MAX_PULSE_GAP_MS,
    bufferedFn = null,
  }) {
    this.id = id || `conn-${++connSeq}`;
    this.transport = transport;
    this.rawSend = rawSend;
    this.rawClose = rawClose;
    this.bufferedFn = bufferedFn;
    this.chunkSize = chunkSize;
    this.heartbeatMs = heartbeatMs;
    this.timeoutMs = timeoutMs;
    this.decoder = new FrameDecoder({ maxChars: maxMessageChars });
    this.maxFrameErrors = maxFrameErrors;
    this.maxPulseGapMs = maxPulseGapMs;
    this.errorWindowStart = 0;
    this.errorsAtWindowStart = 0;
    this.seq = 0;
    this.listeners = [];
    this.closeListeners = [];
    this.backlog = [];
    this.flushing = false;
    this.open = true;
    this.closeReason = null;
    this.lastRx = now();
    this.lastTx = this.lastRx;
    this.lastBeat = this.lastRx; // when the liveness pulse last ran for this connection
    this.silentMs = 0; // running time without a frame from the other side
    this.stats = { sentMsgs: 0, sentChars: 0, recvMsgs: 0, recvChars: 0, badFrames: 0 };
    if (heartbeatMs > 0 && autoPulse) trackConn(this);
  }

  /** Bytes queued for the other side and not yet sent: a slow link shows here (0 when the pipe cannot tell). */
  get buffered() {
    if (!this.bufferedFn) return 0;
    try {
      return this.bufferedFn() || 0;
    } catch {
      return 0;
    }
  }

  /** Change how long the other side may stay silent (e.g. GAME_TIMEOUT_MS once a game starts). */
  setTimeoutMs(ms) {
    if (Number.isFinite(ms) && ms >= 0) this.timeoutMs = ms;
  }

  /** Accept incoming messages of at most `chars` characters (reassembled). */
  limitIncoming(chars) {
    this.decoder.maxChars = chars;
    this.decoder.maxChunks = Math.max(16, Math.ceil(chars / 1000));
  }

  /**
   * Send a JSON message. Returns false if the connection is closed.
   * @param {object} msg
   */
  send(msg) {
    if (!this.open) return false;
    let frames;
    try {
      frames = encodeFrames(msg, ++this.seq, this.chunkSize);
    } catch (err) {
      console.error('[net] could not serialize message', msg && msg.t, err);
      return false;
    }
    return this.sendFrames(frames);
  }

  /**
   * Send a message that is already JSON (one serialization shared by several
   * connections, e.g. the same delta for every client).
   * @param {string} json JSON.stringify of a message object
   */
  sendJSON(json) {
    if (!this.open) return false;
    if (typeof json !== 'string' || json[0] !== '{') return false;
    return this.sendFrames(encodeFrames(null, ++this.seq, this.chunkSize, json));
  }

  sendFrames(frames) {
    try {
      for (const f of frames) {
        this.rawSend(f);
        this.stats.sentChars += f.length;
      }
    } catch (err) {
      console.warn('[net] send failed, closing connection', err);
      this._closed('error');
      return false;
    }
    this.stats.sentMsgs++;
    this.lastTx = now();
    return true;
  }

  /**
   * Listen for messages. Messages that arrive while nobody listens are kept and
   * delivered (in order) to the next listener, so a connection can be handed
   * from the lobby to a game session without losing anything.
   * @param {(msg: object) => void} cb
   * @returns {() => void} unsubscribe
   */
  onMessage(cb) {
    this.listeners.push(cb);
    if (this.backlog.length) this.scheduleFlush();
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /**
   * Called once when the connection closes (immediately, asynchronously, if it already has).
   * @param {(reason: string) => void} cb
   * @returns {() => void} unsubscribe
   */
  onClose(cb) {
    if (!this.open) {
      later(() => cb(this.closeReason));
      return () => {};
    }
    this.closeListeners.push(cb);
    return () => {
      const i = this.closeListeners.indexOf(cb);
      if (i >= 0) this.closeListeners.splice(i, 1);
    };
  }

  /** Close the connection (tells the other side). */
  close(reason = 'closed') {
    if (!this.open) return;
    try {
      this.rawSend(FRAME_BYE);
    } catch {
      // already gone
    }
    this._closed(reason);
  }

  _receive(frame) {
    if (!this.open) return;
    this.lastRx = now();
    this.silentMs = 0;
    if (typeof frame !== 'string') {
      this.badFrame();
      return;
    }
    this.stats.recvChars += frame.length;
    if (frame === FRAME_HEARTBEAT) return;
    if (frame === FRAME_BYE) {
      this._closed('remote-closed');
      return;
    }
    const errors = this.decoder.errors;
    const msg = this.decoder.push(frame);
    if (this.decoder.errors !== errors) this.badFrame();
    if (!msg) return;
    this.stats.recvMsgs++;
    if (this.listeners.length && !this.backlog.length && !this.flushing) this.dispatch(msg);
    else {
      this.backlog.push(msg);
      if (this.listeners.length) this.scheduleFlush();
    }
  }

  /** Count a malformed frame; too many in a short time close the connection. */
  badFrame() {
    this.stats.badFrames++;
    if (!(this.maxFrameErrors > 0)) return;
    const t = now();
    if (t - this.errorWindowStart > ERROR_WINDOW_MS) {
      this.errorWindowStart = t;
      this.errorsAtWindowStart = this.stats.badFrames - 1;
    }
    if (this.stats.badFrames - this.errorsAtWindowStart > this.maxFrameErrors) {
      console.warn(`[net] connection ${this.id} sent too many malformed frames; closing it`);
      this.close('protocol-error');
    }
  }

  dispatch(msg) {
    const ls = this.listeners.length === 1 ? this.listeners : this.listeners.slice();
    for (const cb of ls) {
      try {
        cb(msg);
      } catch (err) {
        console.error(`[net] error handling '${msg.t}' message`, err);
      }
    }
  }

  scheduleFlush() {
    if (this.flushing) return;
    this.flushing = true;
    queueMicrotask(() => {
      while (this.backlog.length && this.listeners.length) this.dispatch(this.backlog.shift());
      this.flushing = false;
    });
  }

  _heartbeat(t) {
    if (!this.open) return;
    // Silence counts only time this page ran: a pulse that comes late (our main
    // thread was stalled, the tab was frozen) adds at most MAX_PULSE_GAP_MS, so
    // frames that queued up meanwhile are dispatched before the link is judged.
    const gap = t - this.lastBeat;
    this.lastBeat = t;
    this.silentMs += Math.max(0, Math.min(gap, this.maxPulseGapMs));
    if (this.timeoutMs > 0 && this.silentMs > this.timeoutMs) {
      console.warn(`[net] connection ${this.id} timed out`);
      try {
        this.rawSend(FRAME_BYE);
      } catch {
        // ignore
      }
      this._closed('timeout');
      return;
    }
    if (t - this.lastTx >= this.heartbeatMs) {
      try {
        this.rawSend(FRAME_HEARTBEAT);
        this.lastTx = t;
      } catch {
        this._closed('error');
      }
    }
  }

  _closed(reason) {
    if (!this.open) return;
    this.open = false;
    this.closeReason = reason;
    untrackConn(this);
    try {
      this.rawClose();
    } catch {
      // ignore
    }
    const ls = this.closeListeners.slice();
    this.closeListeners.length = 0;
    for (const cb of ls) {
      try {
        cb(reason);
      } catch (err) {
        console.error('[net] error in close handler', err);
      }
    }
  }
}

// ---------------------------------------------------------------- host endpoint

// A room never needs more than a handful of links (MAX_PLAYERS - 1 clients, a
// few rejoins whose old link has not timed out yet, kicks that are closing);
// beyond these ceilings new connections are closed at once, so a flood of them
// cannot grow the host's memory without bound.
export const MAX_HOST_CONNECTIONS = MAX_PLAYERS * 4;
export const MAX_PENDING_HANDSHAKES = MAX_PLAYERS * 2; // PeerJS links still negotiating WebRTC

/** Accepts incoming connections for one room. */
class HostEndpoint {
  constructor(transport) {
    this.transport = transport;
    this.roomCode = null;
    this.closed = false;
    this.conns = new Set();
    this.handlers = [];
    this.pending = [];
    this.cleanup = [];
    this.pendingOpen = 0; // incoming PeerJS connections whose data channel is not open yet
  }

  /** True while another not-yet-open incoming connection may be negotiated. */
  acceptsPending() {
    return this.pendingOpen < MAX_PENDING_HANDSHAKES && this.conns.size + this.pendingOpen < MAX_HOST_CONNECTIONS;
  }

  /**
   * @param {(conn: FramedConn) => void} cb
   * @returns {() => void} unsubscribe
   */
  onConnection(cb) {
    this.handlers.push(cb);
    const pend = this.pending.splice(0);
    for (const c of pend) if (c.open) cb(c);
    return () => {
      const i = this.handlers.indexOf(cb);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  _accept(conn) {
    if (this.closed) {
      conn.close('closed');
      return;
    }
    if (this.conns.size >= MAX_HOST_CONNECTIONS) {
      conn.close('too-many-connections');
      return;
    }
    // Everything a client sends is small; refuse huge frames from untrusted peers.
    if (typeof conn.limitIncoming === 'function') conn.limitIncoming(MAX_CLIENT_MESSAGE_CHARS);
    this.conns.add(conn);
    conn.onClose(() => this.conns.delete(conn));
    if (!this.handlers.length) this.pending.push(conn);
    for (const cb of this.handlers.slice()) cb(conn);
  }

  /** Stop accepting connections and close every connection of this room. */
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const c of [...this.conns]) c.close('closed');
    for (const fn of this.cleanup) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
  }
}

// ---------------------------------------------------------------- loopback

const loopbackRooms = new Map();
let loopbackSeq = 0;

/**
 * Two connected in-memory connections. Frames are delivered asynchronously
 * and in order. `link.drop = true` silently discards frames (simulates a dead
 * network for timeout tests).
 * @returns {[FramedConn, FramedConn, { drop: boolean }]}
 */
export function createLoopbackPair(opts = {}) {
  const link = { drop: false };
  const n = ++loopbackSeq;
  const make = (id) => new FramedConn({ id, transport: 'loopback', ...opts, rawSend: () => {} });
  const a = make(opts.idA || `loop-${n}-a`);
  const b = make(opts.idB || `loop-${n}-b`);
  const pipe = (from, to) => {
    const queue = [];
    let scheduled = false;
    from.rawSend = (frame) => {
      if (link.drop) return;
      queue.push(frame);
      if (!scheduled) {
        scheduled = true;
        later(() => {
          scheduled = false;
          const frames = queue.splice(0);
          for (const f of frames) to._receive(f);
        });
      }
    };
  };
  pipe(a, b);
  pipe(b, a);
  return [a, b, link];
}

function hostLoopback(ep, opts) {
  let code = opts.roomCode ? normalizeRoomCode(opts.roomCode) : makeRoomCode();
  while (loopbackRooms.has(code)) code = makeRoomCode();
  ep.roomCode = code;
  loopbackRooms.set(code, ep);
  ep.cleanup.push(() => {
    if (loopbackRooms.get(code) === ep) loopbackRooms.delete(code);
  });
}

async function joinLoopback(code, opts) {
  const ep = loopbackRooms.get(code);
  if (!ep || ep.closed) throw new Error(`Room ${code} was not found.`);
  const [client, server] = createLoopbackPair(opts.conn || {});
  later(() => ep._accept(server));
  return client;
}

// ---------------------------------------------------------------- local (BroadcastChannel)

const channelName = (code) => `mythicwar-${code}`;
const randomId = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

function requireBroadcastChannel() {
  if (typeof BroadcastChannel === 'undefined') throw new Error('This browser does not support BroadcastChannel (local play).');
}

/** True if some other tab already hosts this room code. */
function localRoomTaken(code) {
  return new Promise((resolve) => {
    const ch = new BroadcastChannel(channelName(code));
    const me = randomId('probe');
    const done = (v) => {
      clearTimeout(timer);
      ch.close();
      resolve(v);
    };
    ch.onmessage = (e) => {
      const m = e.data;
      if (m && m.k === 'here' && m.to === me) done(true);
    };
    const timer = setTimeout(() => done(false), 200);
    ch.postMessage({ k: 'probe', from: me });
  });
}

async function hostLocal(ep, opts) {
  requireBroadcastChannel();
  let code = opts.roomCode ? normalizeRoomCode(opts.roomCode) : makeRoomCode();
  for (let i = 0; await localRoomTaken(code); i++) {
    if (opts.roomCode && i === 0) throw new Error(`Room ${code} is already hosted in another tab.`);
    code = makeRoomCode();
  }
  ep.roomCode = code;
  const ch = new BroadcastChannel(channelName(code));
  const byClient = new Map();
  ch.onmessage = (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object' || ep.closed) return;
    if (m.k === 'probe') ch.postMessage({ k: 'here', to: m.from });
    else if (m.k === 'join' && typeof m.from === 'string' && !byClient.has(m.from)) {
      const cid = m.from;
      const conn = new FramedConn({
        id: cid,
        transport: 'local',
        rawSend: (f) => ch.postMessage({ k: 'f', from: 'host', to: cid, f }),
        rawClose: () => byClient.delete(cid),
      });
      byClient.set(cid, conn);
      ch.postMessage({ k: 'accept', to: cid });
      ep._accept(conn);
    } else if (m.k === 'f' && m.to === 'host') {
      const conn = byClient.get(m.from);
      if (conn) conn._receive(m.f);
    }
  };
  ep.cleanup.push(() => ch.close());
}

function joinLocal(code, opts) {
  requireBroadcastChannel();
  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel(channelName(code));
    const me = randomId('tab');
    let conn = null;
    const timer = setTimeout(() => {
      ch.close();
      reject(new Error(`Room ${code} was not found in this browser.`));
    }, opts.timeoutMs ?? 3000);
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        if (conn) return; // already joined: joinRoom closes the link
        clearTimeout(timer);
        ch.close();
        reject(abortError());
      }, { once: true });
    }
    ch.onmessage = (e) => {
      const m = e.data;
      if (!m || m.to !== me) return;
      if (m.k === 'accept' && !conn) {
        clearTimeout(timer);
        conn = new FramedConn({
          id: me,
          transport: 'local',
          rawSend: (f) => ch.postMessage({ k: 'f', from: me, to: 'host', f }),
          rawClose: () => setTimeout(() => ch.close(), 50),
        });
        resolve(conn);
      } else if (m.k === 'f' && conn) conn._receive(m.f);
    };
    ch.postMessage({ k: 'join', from: me });
  });
}

// ---------------------------------------------------------------- peer (PeerJS / WebRTC)

let peerJsPromise = null;

/** window.Peer, loading vendor/peerjs.min.js on demand if the page did not include it. */
export function loadPeerJS() {
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  if (typeof document === 'undefined') return Promise.reject(new Error('PeerJS is not available in this environment.'));
  if (!peerJsPromise) {
    peerJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../../vendor/peerjs.min.js', import.meta.url).href;
      s.onload = () => (globalThis.Peer ? resolve(globalThis.Peer) : reject(new Error('PeerJS failed to load.')));
      s.onerror = () => {
        peerJsPromise = null;
        reject(new Error('Could not load PeerJS (vendor/peerjs.min.js).'));
      };
      document.head.appendChild(s);
    });
  }
  return peerJsPromise;
}

/** What the join / host screens show for a failed online connection. */
export const PEER_MESSAGES = {
  broker: 'Couldn\'t reach the matchmaking server (0.peerjs.com). Check your internet connection and try again.',
  webrtc: 'Couldn\'t connect to the host. You may be behind a strict firewall; try another network.',
  incompatible: 'This browser does not support WebRTC, which online play needs.',
  idTaken: 'That room code is already in use.',
};

/** PEER_MESSAGES.broker naming the signaling server actually used (?peerHost= or the public one). */
export function brokerMessage(params) {
  const host = params && params.peerHost ? String(params.peerHost).slice(0, 80) : PEER_CLOUD.host;
  return PEER_MESSAGES.broker.replace(PEER_CLOUD.host, host);
}

function friendlyPeerError(err, code, params) {
  if (err && (err.name === 'AbortError' || err.type === 'aborted')) return err; // a cancelled join keeps its identity
  const type = err && err.type;
  let message;
  if (type === 'peer-unavailable') message = `Room ${code} was not found. Check the code and that the host is still in the lobby.`;
  else if (type === 'browser-incompatible') message = PEER_MESSAGES.incompatible;
  else if (type === 'unavailable-id') message = PEER_MESSAGES.idTaken;
  else if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed' || type === 'disconnected') {
    message = brokerMessage(params);
  } else if (type === 'webrtc' || type === 'negotiation-failed' || type === 'connection-closed') message = PEER_MESSAGES.webrtc;
  else message = (err && err.message) || 'Network error.';
  const e = new Error(message);
  e.type = type || 'unknown';
  e.cause = err;
  return e;
}

function waitPeerOpen(peer, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    if (signal) {
      if (signal.aborted) return reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => {
      cleanup();
      const e = new Error('timeout');
      e.type = 'network';
      reject(e);
    }, timeoutMs);
    const onOpen = (id) => {
      cleanup();
      resolve(id);
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      peer.off('open', onOpen);
      peer.off('error', onError);
    };
    peer.on('open', onOpen);
    peer.on('error', onError);
  });
}

// The only PeerJS serialization the game uses: the pass-through one, so every
// frame reaches FramedConn / FrameDecoder (size, shape and flood limits) as the
// string it was sent as. PeerJS picks the serializer the CONNECTING side asks
// for, and its binary / json serializers decode each message before any of our
// limits run, so the host must refuse those connections itself.
export const PEER_SERIALIZATION = 'raw';

/** Close an incoming PeerJS connection (or call) we do not want, before its data channel exists. */
function refusePeerConnection(dc) {
  try {
    dc.close();
  } catch {
    // not something PeerJS can close; nothing of ours is attached to it
  }
}

function wrapDataConnection(dc) {
  const conn = new FramedConn({
    id: dc.peer,
    transport: 'peer',
    rawSend: (f) => dc.send(f),
    bufferedFn: () => (dc.dataChannel ? dc.dataChannel.bufferedAmount : 0),
    rawClose: () => {
      try {
        dc.close();
      } catch {
        // ignore
      }
    },
  });
  dc.on('data', (d) => conn._receive(typeof d === 'string' ? d : String(d)));
  dc.on('close', () => conn._closed('disconnected'));
  dc.on('error', (err) => {
    console.warn('[net] data connection error', err);
    conn._closed('error');
  });
  // 'disconnected' may recover by itself; 'failed' / 'closed' will not.
  dc.on('iceStateChanged', (state) => {
    if (state === 'failed' || state === 'closed') conn._closed('disconnected');
  });
  return conn;
}

async function hostPeer(ep, opts) {
  const Peer = await loadPeerJS();
  const params = opts.params || readNetParams();
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = attempt === 0 && opts.roomCode ? normalizeRoomCode(opts.roomCode) : makeRoomCode();
    const peer = new Peer(peerIdFor(code), peerOptions(params));
    try {
      await waitPeerOpen(peer, opts.timeoutMs ?? JOIN_TIMEOUT_MS);
    } catch (err) {
      peer.destroy();
      lastErr = err;
      if (err && err.type === 'unavailable-id') continue;
      throw friendlyPeerError(err, code, params);
    }
    ep.roomCode = code;
    ep.peer = peer;
    peer.on('connection', (dc) => {
      // Checked when PeerJS announces the connection, before its data channel
      // exists: a refused connection never receives a byte. `serialization` is
      // set by the serializer class PeerJS instantiated, not copied from the offer.
      if (ep.closed || !dc || dc.serialization !== PEER_SERIALIZATION) {
        refusePeerConnection(dc);
        return;
      }
      if (!ep.acceptsPending()) {
        refusePeerConnection(dc);
        return;
      }
      ep.pendingOpen++;
      let pending = true;
      const settle = () => {
        if (pending) ep.pendingOpen--;
        pending = false;
      };
      dc.on('close', settle);
      dc.on('error', settle);
      const timer = setTimeout(() => {
        settle();
        refusePeerConnection(dc);
      }, JOIN_TIMEOUT_MS);
      dc.on('open', () => {
        clearTimeout(timer);
        settle();
        ep._accept(wrapDataConnection(dc));
      });
    });
    // The game never uses media calls; drop them so they hold nothing on the host.
    peer.on('call', refusePeerConnection);
    peer.on('disconnected', () => {
      // Lost the signaling server: existing games keep working, but reconnect so new players can still join.
      if (!ep.closed && !peer.destroyed) setTimeout(() => !ep.closed && !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (err && err.type !== 'peer-unavailable') console.warn('[net] peer error', err.type, err.message);
    });
    ep.cleanup.push(() => setTimeout(() => peer.destroy(), 100));
    return;
  }
  throw friendlyPeerError(lastErr, '', params);
}

async function joinPeer(code, opts) {
  const { signal } = opts;
  const Peer = await loadPeerJS();
  if (signal && signal.aborted) throw abortError();
  const params = opts.params || readNetParams();
  // 1. Signaling server (broker): unreachable → PEER_MESSAGES.broker.
  const peer = new Peer(peerOptions(params));
  try {
    await waitPeerOpen(peer, opts.timeoutMs ?? JOIN_TIMEOUT_MS, signal);
  } catch (err) {
    peer.destroy();
    throw friendlyPeerError(err, code, params);
  }
  // A client only talks to the host: other peers who learn its id (lobby states
  // carry them) get no connection, so nothing they send is ever decoded here.
  peer.on('connection', refusePeerConnection);
  peer.on('call', refusePeerConnection);
  // 2. The direct WebRTC link to the host. Unknown room → 'peer-unavailable' at once;
  // ICE that never connects (strict NAT / firewall, no TURN) → PEER_MESSAGES.webrtc
  // after CONNECT_TIMEOUT_MS at the latest.
  const dc = peer.connect(peerIdFor(code), { reliable: true, serialization: PEER_SERIALIZATION });
  const connectMs = opts.connectTimeoutMs ?? opts.timeoutMs ?? CONNECT_TIMEOUT_MS;
  try {
    await new Promise((resolve, reject) => {
      const onAbort = () => fail(abortError());
      const fail = (err) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(err);
      };
      const timer = setTimeout(() => fail(Object.assign(new Error('webrtc'), { type: 'webrtc' })), connectMs);
      dc.on('open', () => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      });
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      dc.on('error', (err) => fail(err && err.type ? err : Object.assign(new Error('webrtc'), { type: 'webrtc', cause: err })));
      dc.on('close', () => fail(Object.assign(new Error('webrtc'), { type: 'connection-closed' })));
      dc.on('iceStateChanged', (state) => {
        if (state === 'failed') fail(Object.assign(new Error('webrtc'), { type: 'webrtc' }));
      });
      peer.on('error', fail);
    });
  } catch (err) {
    peer.destroy();
    throw friendlyPeerError(err, code, params);
  }
  const conn = wrapDataConnection(dc);
  peer.on('error', (err) => console.warn('[net] peer error', err.type, err.message));
  conn.onClose(() => setTimeout(() => peer.destroy(), 100));
  return conn;
}

// ---------------------------------------------------------------- public API

/**
 * Open a room and accept connections.
 * @param {object} opts
 * @param {'peer'|'local'|'loopback'|'none'} opts.transport
 * @param {string} [opts.roomCode] preferred code (random otherwise)
 * @param {object} [opts.params] network overrides (readNetParams() by default)
 * @returns {Promise<HostEndpoint>} `{ roomCode, transport, onConnection(cb) → off, close() }`
 */
export async function hostRoom(opts = {}) {
  const transport = opts.transport || 'none';
  const ep = new HostEndpoint(transport);
  if (transport === 'peer') await hostPeer(ep, opts);
  else if (transport === 'local') await hostLocal(ep, opts);
  else if (transport === 'loopback') hostLoopback(ep, opts);
  else if (transport !== 'none') throw new Error(`Unknown transport '${transport}'.`);
  return ep;
}

/**
 * Connect to a room's host.
 * @param {object} opts
 * @param {'peer'|'local'|'loopback'} opts.transport
 * @param {string} opts.roomCode
 * @param {object} [opts.params]
 * @param {number} [opts.timeoutMs]
 * @param {AbortSignal} [opts.signal] abort a join in progress: rejects with abortError(), nothing is left open
 * @returns {Promise<FramedConn>}
 */
export async function joinRoom(opts = {}) {
  const transport = opts.transport || 'peer';
  const code = normalizeRoomCode(opts.roomCode);
  if (!code) throw new Error('Enter a room code.');
  const { signal } = opts;
  if (signal && signal.aborted) throw abortError();
  let conn;
  if (transport === 'peer') conn = await joinPeer(code, opts);
  else if (transport === 'local') conn = await joinLocal(code, opts);
  else if (transport === 'loopback') conn = await joinLoopback(code, opts);
  else throw new Error(`Cannot join a room with transport '${transport}'.`);
  if (signal && signal.aborted) {
    conn.close('aborted'); // cancelled just as the link opened: do not leave a half-joined player behind
    throw abortError();
  }
  return conn;
}
