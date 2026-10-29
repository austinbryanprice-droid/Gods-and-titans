// Network protocol (DESIGN 7): message names, room codes, URL overrides for the
// PeerJS server / ICE servers, input sanitizing and the wire framing that
// splits large JSON messages into ordered chunks. Pure: runs in Node too.
import { PEER_ID_PREFIX, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../config.js';

// The version two builds compare at join (HELLO.version) is PROTOCOL_VERSION in
// wire-version.js: it needs the sanitizer and codec tables, which import this file.

/**
 * Message `t` values. client→host: HELLO LOBBY CMD CHAT PING RESYNC MARK; host→client: the rest
 * (+ LOBBY, CHAT, and MARK, which the host relays to the sender's teammates only).
 */
export const MSG = {
  HELLO: 'hello',
  LOBBY: 'lobby',
  CMD: 'cmd',
  CHAT: 'chat',
  PING: 'ping',
  RESYNC: 'resync',
  MARK: 'mark',
  WELCOME: 'welcome',
  START: 'start',
  FULL: 'full',
  DELTA: 'delta',
  PONG: 'pong',
  KICK: 'kick',
  END: 'end',
};

// Wire framing. A frame is a string: a JSON object ('{…}'), a chunk
// ('~id,index,count|payload'), a heartbeat ('h') or a goodbye ('b').
export const CHUNK_SIZE = 16000; // max characters per frame; larger messages are chunked
export const HEARTBEAT_MS = 2000; // idle connections send a heartbeat this often
export const TIMEOUT_MS = 15000; // a connection silent for this long is considered dead (lobby)
// In a game the other side can be busy for many seconds (building the renderer,
// compiling shaders, a CPU-starved machine) and cannot send heartbeats meanwhile.
export const GAME_TIMEOUT_MS = 30000;
// A heartbeat pulse that comes this late means our own page did not run (main
// thread stalled, tab frozen); only this much of the gap counts as silence, so
// messages that queued up during the stall are delivered before the link is judged.
export const MAX_PULSE_GAP_MS = 1000;
export const PING_INTERVAL_MS = 2000; // in-game RTT pings (client → host)
// A client that has heard nothing from the host for this long (a delta every 50 ms, a
// pong every 2 s) tells the player the connection is in trouble; the link itself is
// only dropped after GAME_TIMEOUT_MS. Above MAX_PULSE_GAP_MS so a local stall cannot raise it.
export const STALL_NOTICE_MS = 3000;
// A client whose send queue to the host's connection holds more than this is skipped
// when deltas go out (see HostSession.broadcastSnapshot): queueing more only makes it lag.
export const MAX_CLIENT_BUFFER_BYTES = 128 * 1024;
export const JOIN_TIMEOUT_MS = 15000; // waiting for the signaling server / the host to answer a join
export const CONNECT_TIMEOUT_MS = 15000; // waiting for the WebRTC data channel to open
export const MAX_CHAT_LENGTH = 200;
export const MAX_NAME_LENGTH = 20;
// Untrusted input limits. Messages from a client are small (commands, chat, lobby
// patches); the host's full snapshots can be a few hundred KB.
export const MAX_CLIENT_MESSAGE_CHARS = 1 << 20; // 1 MB reassembled, on the host side
export const MAX_HOST_MESSAGE_CHARS = 32 << 20; // 32 MB reassembled, on the client side
export const MAX_CHUNK_CHARS = 64 * 1024; // one chunk frame (we send CHUNK_SIZE)
export const MAX_FRAME_ERRORS = 100; // malformed frames tolerated per ERROR_WINDOW_MS before closing
export const ERROR_WINDOW_MS = 10000;

export const FRAME_HEARTBEAT = 'h';
export const FRAME_BYE = 'b';

/** Kick / end reasons shown to players. */
export const REASONS = {
  FULL: 'The game is full.',
  BUSY: 'The host is busy with other connections. Try again in a moment.',
  STARTED: 'The game has already started.',
  HOST_CLOSED: 'The host closed the lobby.',
  REMOVED: 'You were removed from the lobby by the host.',
  HOST_LEFT: 'host-left',
  HOST_QUIT: 'host-quit',
  LOST: 'Lost connection to the host.',
  // Rejoining a game in progress (DESIGN 7)
  REJOIN_UNKNOWN: 'That game has already started, and this browser was not one of its players.',
  REJOIN_LATER: 'The host is still loading the game. Try again in a moment.',
  REJOIN_OVER: 'That game is over.',
  REJOIN_DENIED: 'You cannot rejoin that game.',
  REPLACED: 'You rejoined this game from another window.',
};

/** Kick reason for a client running a different build than the host. */
export function versionMismatchReason(hostVersion, clientVersion) {
  return `Version mismatch: the host runs v${hostVersion} but you have v${clientVersion || '?'}. Reload the page (Ctrl+Shift+R) so you both run the same version.`;
}

/**
 * Random room code of ROOM_CODE_LENGTH characters from ROOM_CODE_ALPHABET.
 * @param {() => number} [rand] source of floats in [0, 1)
 */
export function makeRoomCode(rand = Math.random) {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[Math.floor(rand() * ROOM_CODE_ALPHABET.length) % ROOM_CODE_ALPHABET.length];
  return s;
}

/**
 * Clean a typed or pasted room code: accepts lower case, spaces, an invite
 * link (`…?join=CODE`) or a full peer id. Returns '' when nothing usable is left.
 */
export function normalizeRoomCode(input) {
  let s = String(input ?? '').trim();
  const m = s.match(/[?&#]join=([^&#\s]+)/i);
  if (m) {
    try {
      s = decodeURIComponent(m[1]);
    } catch {
      s = m[1]; // a malformed %-escape: use the text as it is
    }
  }
  if (s.toLowerCase().startsWith(PEER_ID_PREFIX)) s = s.slice(PEER_ID_PREFIX.length);
  s = s.toUpperCase();
  let out = '';
  for (const ch of s) if (ROOM_CODE_ALPHABET.includes(ch)) out += ch;
  return out.slice(0, ROOM_CODE_LENGTH);
}

/** True for a well-formed room code. */
export function isValidRoomCode(code) {
  return typeof code === 'string' && code.length === ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_ALPHABET.includes(c));
}

/** PeerJS id of the host of a room. */
export function peerIdFor(roomCode) {
  return PEER_ID_PREFIX + roomCode;
}

/**
 * Network overrides from a URL query string. With none of them, online play
 * uses the public PeerJS cloud broker (0.peerjs.com, port 443, path '/', wss)
 * for signaling and these ICE servers: Google + Cloudflare STUN and the PeerJS
 * cloud's public TURN relays (eu-0 / us-0.turn.peerjs.com:3478).
 *
 *   ?peerHost=host&peerPort=9000&peerPath=/myapp&peerSecure=0|1
 *        a self-hosted PeerJS server (`npx peerjs --port 9000 --path /myapp`);
 *        secure defaults to on except for localhost / 127.0.0.1
 *   ?turn=turn:turn.example.com:3478[,turns:turn.example.com:5349?transport=tcp]
 *   &turnUser=name&turnPass=secret
 *        an extra TURN relay (comma-separated URLs share the credentials) for
 *        players behind symmetric NATs / strict firewalls where direct WebRTC
 *        fails; both players should open the link with the same parameters
 *        (invite links keep them)
 *   ?relay=1  force all traffic through TURN (iceTransportPolicy 'relay'):
 *        a quick way to check that a TURN server works
 *   ?transport=local (or ?net=local)  BroadcastChannel between tabs (testing)
 *   ?peerDebug=0..3  PeerJS log level
 * @param {string} [search] defaults to the page's location.search
 */
export function readNetParams(search) {
  const src = search ?? (typeof globalThis.location !== 'undefined' ? globalThis.location.search : '');
  const q = new URLSearchParams(src || '');
  const get = (k) => {
    const v = q.get(k);
    return v === null || v === '' ? null : v;
  };
  const port = get('peerPort');
  const secure = get('peerSecure');
  return {
    peerHost: get('peerHost'),
    peerPort: port !== null && Number.isFinite(Number(port)) ? Number(port) : null,
    peerPath: get('peerPath'),
    peerSecure: secure === null ? null : !(secure === '0' || secure === 'false'),
    turn: get('turn'),
    turnUser: get('turnUser'),
    turnPass: get('turnPass'),
    relay: get('relay') === '1' || get('relay') === 'true',
    peerDebug: get('peerDebug') !== null ? Number(get('peerDebug')) || 0 : 0,
    // ?transport=local (or ?net=local) makes online menus use BroadcastChannel (two tabs, testing).
    transport: ['peer', 'local'].includes(get('transport') || get('net')) ? get('transport') || get('net') : null,
  };
}

/** The public PeerJS cloud broker (PeerJS's own defaults, spelled out). */
export const PEER_CLOUD = { host: '0.peerjs.com', port: 443, path: '/', secure: true };
/** The PeerJS cloud's public TURN relays (from PeerJS's default config). */
export const PEER_CLOUD_TURN = { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' };

/**
 * ICE servers: Google + Cloudflare STUN, the PeerJS cloud TURN relays when the
 * cloud broker is used, plus an optional TURN server from the params.
 */
export function iceServers(params = {}) {
  const list = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  if (!params.peerHost) list.push({ ...PEER_CLOUD_TURN, urls: PEER_CLOUD_TURN.urls.slice() });
  if (params.turn) {
    const urls = String(params.turn).split(',').map((s) => s.trim()).filter(Boolean);
    const turn = { urls };
    if (params.turnUser) turn.username = params.turnUser;
    if (params.turnPass) turn.credential = params.turnPass;
    list.push(turn);
  }
  return list;
}

/** PeerJS constructor options for the given params (the PeerJS cloud broker unless overridden). */
export function peerOptions(params = {}) {
  const config = { iceServers: iceServers(params) };
  if (params.relay) config.iceTransportPolicy = 'relay';
  const opts = { debug: params.peerDebug || 0, config };
  if (!params.peerHost) Object.assign(opts, PEER_CLOUD);
  else {
    opts.host = params.peerHost;
    if (params.peerPort !== null && params.peerPort !== undefined) opts.port = params.peerPort;
    if (params.peerPath) opts.path = params.peerPath;
    if (params.peerSecure !== null && params.peerSecure !== undefined) opts.secure = params.peerSecure;
    else opts.secure = params.peerHost !== 'localhost' && params.peerHost !== '127.0.0.1';
  }
  return opts;
}

// Characters that have no place in a name or a chat line: C0 / DEL / C1 controls,
// zero-width spaces and marks, bidi embeddings / overrides / isolates (which can
// flip the text around them), invisible operators, line / paragraph separators
// and the BOM. (The zero-width joiner U+200D stays: emoji sequences need it.)
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b\u200c\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]/g;

/** Clean free text: strings and numbers only, unsafe characters removed, whitespace collapsed, at most `max` code points. */
function cleanText(v, max) {
  if (typeof v === 'number') v = String(v);
  if (typeof v !== 'string') return '';
  const s = v.slice(0, max * 4).replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, max).join('').trim();
}

/** Player name: trimmed, control / invisible / bidi characters removed, at most MAX_NAME_LENGTH. */
export function sanitizeName(name, fallback = 'Player') {
  return cleanText(name, MAX_NAME_LENGTH) || fallback;
}

/** Chat text: trimmed, single line, at most MAX_CHAT_LENGTH. '' means nothing to send. */
export function sanitizeChat(text) {
  return cleanText(text, MAX_CHAT_LENGTH);
}

/** A short free-text reason from the other side (kick / end), or the fallback. */
export function sanitizeReason(reason, fallback) {
  return cleanText(reason, 300) || fallback;
}

/**
 * Token bucket: `take()` is true while the sender stays within `rate` per
 * second with bursts up to `burst`; excess calls return false (and are counted).
 */
export class RateLimiter {
  constructor(rate, burst, clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    this.rate = rate;
    this.burst = burst;
    this.clock = clock;
    this.tokens = burst;
    this.last = clock();
    this.dropped = 0;
  }

  take(n = 1) {
    const t = this.clock();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    this.dropped++;
    return false;
  }
}

/** True for a protocol message object. */
export function isMessage(msg) {
  return !!msg && typeof msg === 'object' && !Array.isArray(msg) && typeof msg.t === 'string';
}

/**
 * Serialize a message into one or more wire frames.
 * @param {object} msg JSON-serializable message
 * @param {number} seq message number used to tag chunks
 * @param {number} [chunkSize]
 * @param {string} [json] the message already serialized (msg is then ignored)
 * @returns {string[]}
 */
export function encodeFrames(msg, seq, chunkSize = CHUNK_SIZE, json = null) {
  const s = json ?? JSON.stringify(msg);
  if (s.length <= chunkSize) return [s];
  const count = Math.ceil(s.length / chunkSize);
  const frames = new Array(count);
  for (let i = 0; i < count; i++) frames[i] = `~${seq},${i},${count}|${s.slice(i * chunkSize, (i + 1) * chunkSize)}`;
  return frames;
}

/**
 * Reassembles chunked frames, defensively: the other side may be buggy or
 * malicious. A frame or reassembled message over `maxChars`, a chunk header that
 * does not parse, more than `maxChunks` chunks, chunks out of place, invalid JSON
 * and anything that is not a `{ t: string }` object are dropped and counted in
 * `errors` (the rest of an oversized message is skipped too). Memory stays
 * bounded by one partial message of at most `maxChars`.
 */
export class FrameDecoder {
  /**
   * @param {object} [o]
   * @param {number} [o.maxChars] largest message accepted (reassembled)
   * @param {number} [o.maxChunks] most chunks per message
   * @param {number} [o.maxChunkChars] largest single chunk frame
   */
  constructor({ maxChars = MAX_HOST_MESSAGE_CHARS, maxChunks, maxChunkChars = MAX_CHUNK_CHARS } = {}) {
    this.maxChars = maxChars;
    this.maxChunkChars = maxChunkChars;
    this.maxChunks = maxChunks ?? Math.max(16, Math.ceil(maxChars / 1000));
    this.partial = null; // { seq, count, parts: string[], got, chars }
    this.skipSeq = null; // chunks of an oversized message we are skipping
    this.errors = 0;
  }

  /**
   * @param {string} frame a JSON frame or a chunk frame (heartbeat/bye are handled by the caller)
   * @returns {object|null}
   */
  push(frame) {
    if (typeof frame !== 'string' || frame.length === 0) {
      this.errors++;
      return null;
    }
    if (frame[0] === '~') return this.pushChunk(frame);
    if (frame.length > this.maxChars) {
      this.errors++;
      return null;
    }
    return this.parse(frame);
  }

  pushChunk(frame) {
    const bar = frame.indexOf('|');
    if (bar < 6 || bar > 48 || frame.length - bar - 1 > this.maxChunkChars) {
      this.errors++;
      return null;
    }
    const head = frame.slice(1, bar).split(',');
    const seq = Number(head[0]);
    const index = Number(head[1]);
    const count = Number(head[2]);
    if (head.length !== 3 || !Number.isSafeInteger(seq) || !Number.isInteger(count) || !Number.isInteger(index)
      || count < 1 || count > this.maxChunks || index < 0 || index >= count) {
      this.errors++;
      return null;
    }
    if (seq === this.skipSeq) return null;
    let p = this.partial;
    if (!p || p.seq !== seq) {
      // A new message: anything half-received before it is lost (cannot happen on an ordered channel).
      if (p) this.errors++;
      p = this.partial = { seq, count, parts: new Array(count), got: 0, chars: 0 };
    } else if (count !== p.count) {
      this.errors++;
      this.partial = null;
      this.skipSeq = seq;
      return null;
    }
    const part = frame.slice(bar + 1);
    if (p.parts[index] === undefined) p.got++;
    else p.chars -= p.parts[index].length;
    p.parts[index] = part;
    p.chars += part.length;
    if (p.chars > this.maxChars) {
      this.errors++;
      this.partial = null;
      this.skipSeq = seq;
      return null;
    }
    if (p.got < p.count) return null;
    this.partial = null;
    return this.parse(p.parts.join(''));
  }

  parse(s) {
    try {
      const msg = JSON.parse(s);
      if (isMessage(msg)) return msg;
    } catch {
      // fall through
    }
    this.errors++;
    return null;
  }
}
