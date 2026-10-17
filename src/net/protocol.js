// Network protocol (DESIGN 7): message names, room codes, URL overrides for the
// PeerJS server / ICE servers, input sanitizing and the wire framing that
// splits large JSON messages into ordered chunks. Pure: runs in Node too.
import { GAME_VERSION, PEER_ID_PREFIX, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../config.js';

export const PROTOCOL_VERSION = GAME_VERSION;

/** Message `t` values. client→host: HELLO LOBBY CMD CHAT PING RESYNC; host→client: the rest (+ LOBBY, CHAT). */
export const MSG = {
  HELLO: 'hello',
  LOBBY: 'lobby',
  CMD: 'cmd',
  CHAT: 'chat',
  PING: 'ping',
  RESYNC: 'resync',
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
export const TIMEOUT_MS = 15000; // a connection silent for this long is considered dead
export const PING_INTERVAL_MS = 2000; // in-game RTT pings (client → host)
export const JOIN_TIMEOUT_MS = 15000; // waiting for the host to answer a join
export const MAX_CHAT_LENGTH = 200;
export const MAX_NAME_LENGTH = 20;

export const FRAME_HEARTBEAT = 'h';
export const FRAME_BYE = 'b';

/** Kick / end reasons shown to players. */
export const REASONS = {
  FULL: 'The game is full.',
  STARTED: 'The game has already started.',
  HOST_CLOSED: 'The host closed the lobby.',
  REMOVED: 'You were removed from the lobby by the host.',
  HOST_LEFT: 'host-left',
  HOST_QUIT: 'host-quit',
  LOST: 'Lost connection to the host.',
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
  if (m) s = decodeURIComponent(m[1]);
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
 * Network overrides from a URL query string:
 * `?peerHost=&peerPort=&peerPath=&peerSecure=0|1&turn=turn:host:port&turnUser=&turnPass=&transport=peer|local`.
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
    peerDebug: get('peerDebug') !== null ? Number(get('peerDebug')) || 0 : 0,
    // ?transport=local (or ?net=local) makes online menus use BroadcastChannel (two tabs, testing).
    transport: ['peer', 'local'].includes(get('transport') || get('net')) ? get('transport') || get('net') : null,
  };
}

/** ICE servers: Google + Cloudflare STUN, plus an optional TURN server from the params. */
export function iceServers(params = {}) {
  const list = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  if (params.turn) {
    const urls = String(params.turn).split(',').map((s) => s.trim()).filter(Boolean);
    const turn = { urls };
    if (params.turnUser) turn.username = params.turnUser;
    if (params.turnPass) turn.credential = params.turnPass;
    list.push(turn);
  }
  return list;
}

/** PeerJS constructor options for the given params (PeerJS cloud broker unless overridden). */
export function peerOptions(params = {}) {
  const opts = { debug: params.peerDebug || 0, config: { iceServers: iceServers(params) } };
  if (params.peerHost) opts.host = params.peerHost;
  if (params.peerPort !== null && params.peerPort !== undefined) opts.port = params.peerPort;
  if (params.peerPath) opts.path = params.peerPath;
  if (params.peerSecure !== null && params.peerSecure !== undefined) opts.secure = params.peerSecure;
  else if (params.peerHost) opts.secure = params.peerHost !== 'localhost' && params.peerHost !== '127.0.0.1';
  return opts;
}

/** Player name: trimmed, control characters removed, at most MAX_NAME_LENGTH. */
export function sanitizeName(name, fallback = 'Player') {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, MAX_NAME_LENGTH).join('') || fallback;
}

/** Chat text: trimmed, single line, at most MAX_CHAT_LENGTH. '' means nothing to send. */
export function sanitizeChat(text) {
  const s = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, MAX_CHAT_LENGTH).join('');
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
 * @returns {string[]}
 */
export function encodeFrames(msg, seq, chunkSize = CHUNK_SIZE) {
  const s = JSON.stringify(msg);
  if (s.length <= chunkSize) return [s];
  const count = Math.ceil(s.length / chunkSize);
  const frames = new Array(count);
  for (let i = 0; i < count; i++) frames[i] = `~${seq},${i},${count}|${s.slice(i * chunkSize, (i + 1) * chunkSize)}`;
  return frames;
}

/** Reassembles chunked frames. `push(frame)` returns the message once complete, else null. */
export class FrameDecoder {
  constructor() {
    this.partial = null; // { seq, count, parts: string[], got }
    this.errors = 0;
  }

  /**
   * @param {string} frame a JSON frame or a chunk frame (heartbeat/bye are handled by the caller)
   * @returns {object|null}
   */
  push(frame) {
    if (typeof frame !== 'string' || frame.length === 0) return null;
    if (frame[0] === '~') return this.pushChunk(frame);
    return this.parse(frame);
  }

  pushChunk(frame) {
    const bar = frame.indexOf('|');
    const head = bar > 0 ? frame.slice(1, bar).split(',') : [];
    const seq = Number(head[0]);
    const index = Number(head[1]);
    const count = Number(head[2]);
    if (head.length !== 3 || !(count > 0) || !(index >= 0 && index < count)) {
      this.errors++;
      return null;
    }
    let p = this.partial;
    if (!p || p.seq !== seq) {
      // A new message: anything half-received before it is lost (cannot happen on an ordered channel).
      if (p) this.errors++;
      p = this.partial = { seq, count, parts: new Array(count), got: 0 };
    }
    if (p.parts[index] === undefined) p.got++;
    p.parts[index] = frame.slice(bar + 1);
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
