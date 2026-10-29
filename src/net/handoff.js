// Host migration (DESIGN 7): an online game goes on when its host leaves. The host names an heir among
// the connected players and a room code for them (PLAN, to every client), and sends that heir the whole
// game every HANDOFF_EVERY_MS (HANDOFF: the save-game graph of the World and the computer players' minds,
// gzip + base64 where the browser can compress, and every player's rejoin token). When the host's link
// goes, the heir rebuilds the game from the newest of these and opens the named room (takeOver); every
// other player connects to that room with their own rejoin token, as after a lost link (followHeir).
// The game goes back to that backup: at most HANDOFF_EVERY_MS of play is lost, nothing when the host
// quits through the menu (the host sends a fresh one first, HostSession.handOff).
import { toBase64, fromBase64 } from '../sim/save-graph.js';
import { MAX_PLAYERS } from '../config.js';
import { HANDOFF_JOIN_MS, MAX_HOST_MESSAGE_CHARS, ONLINE_PAUSES, REASONS, isValidRoomCode, normalizeRoomCode } from './protocol.js';
import { hostRoom } from './transport.js';
import { LobbyHost, LobbyClient } from './lobby.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const TOKEN_RE = /^[0-9a-f]{8,64}$/;

const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Response === 'function';

async function pipeBytes(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/**
 * A game's JSON text as it travels to the heir: gzip + base64 where the browser has CompressionStream
 * (about a tenth of the size: some 90 KB for a 4-player game at 25 minutes), else the text itself.
 * @returns {Promise<{ enc: 'gz'|'json', data: string }>}
 */
export async function encodeState(text, { compress = canCompress() } = {}) {
  if (!compress) return { enc: 'json', data: text };
  const gz = await pipeBytes(new TextEncoder().encode(text), new CompressionStream('gzip'));
  return { enc: 'gz', data: toBase64(gz) };
}

/** The JSON text back from encodeState's { enc, data }. Throws on anything else. */
export async function decodeState(state) {
  if (!isObject(state) || typeof state.data !== 'string') throw new Error('no game state');
  if (state.enc === 'json') return state.data;
  if (state.enc !== 'gz' || !canCompress()) throw new Error('cannot read this game state');
  const bytes = await pipeBytes(fromBase64(state.data), new DecompressionStream('gzip'));
  return new TextDecoder().decode(bytes);
}

/** A seat's proof (HostSession.proofs): 32 random hex digits. */
export function randomProof() {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const readProofs = (obj, setup) => {
  const out = new Map();
  if (!isObject(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const i = Number(k);
    const p = Number.isInteger(i) ? setup.players[i] : null;
    if (p && p.kind === 'human' && typeof v === 'string' && TOKEN_RE.test(v)) out.set(i, v);
  }
  return out;
};

/**
 * A PLAN from the host, checked against the setup: { heir, room, host, at, proof } or null (host: the host's index, -1 if
 * unknown; at: the room the game is in now, null if unknown; proof: my seat's, that the next host shows me, or null).
 */
export function sanitizePlan(msg, setup) {
  if (!isObject(msg) || !setup || !Array.isArray(setup.players)) return null;
  const heir = msg.heir;
  const p = Number.isInteger(heir) ? setup.players[heir] : null;
  const room = normalizeRoomCode(msg.room);
  if (!p || p.kind !== 'human' || !isValidRoomCode(room)) return null;
  const host = Number.isInteger(msg.host) && setup.players[msg.host] && msg.host !== heir ? msg.host : -1;
  const at = msg.at === undefined ? '' : normalizeRoomCode(msg.at);
  const proof = typeof msg.proof === 'string' && TOKEN_RE.test(msg.proof) ? msg.proof : null;
  return { heir, room, host, at: isValidRoomCode(at) && at !== room ? at : null, proof };
}

/**
 * A HANDOFF from the host: { room, tick, state: { enc, data }, tokens: Map<index, token>, present: number[], pauses, proofs: Map<index, proof> }, or
 * null. Only shape is checked here: the game inside is read (and may still fail) when it is needed.
 */
export function sanitizeHandoff(msg, setup) {
  if (!isObject(msg) || !setup || !Array.isArray(setup.players)) return null;
  const room = normalizeRoomCode(msg.room);
  const s = msg.state;
  if (!isValidRoomCode(room) || !Number.isSafeInteger(msg.tick) || msg.tick < 0) return null;
  if (!isObject(s) || (s.enc !== 'gz' && s.enc !== 'json') || typeof s.data !== 'string' || s.data.length > MAX_HOST_MESSAGE_CHARS) return null;
  const tokens = readProofs(msg.tokens, setup); // (tokens have the same shape)
  const present = Array.isArray(msg.present)
    ? [...new Set(msg.present.filter((i) => Number.isInteger(i) && setup.players[i] && setup.players[i].kind === 'human'))].slice(0, MAX_PLAYERS)
    : [];
  const pauses = new Map();
  if (isObject(msg.pauses)) {
    for (const [k, v] of Object.entries(msg.pauses)) {
      const i = Number(k);
      if (Number.isInteger(i) && setup.players[i] && Number.isInteger(v) && v >= 0 && v <= ONLINE_PAUSES) pauses.set(i, v);
    }
  }
  return { room, tick: msg.tick, state: { enc: s.enc, data: s.data }, tokens, present, pauses, proofs: readProofs(msg.proofs, setup) };
}

/**
 * The heir takes the game over: opens the planned room, rebuilds the game from the backup and seats the
 * other players as they reconnect (their tokens from the backup). Rejects when any of that fails.
 * @param {object} o
 * @param {object} o.plan { heir, room, host }
 * @param {object} o.backup sanitizeHandoff's
 * @param {(save: object) => object} o.makeSession builds the HostSession from the parsed save (the caller knows the AI and world code)
 * @param {string} [o.transport] 'peer' | 'local' | 'loopback'
 * @param {object} [o.params] network overrides
 * @param {string} [o.version] protocol version
 * @returns {Promise<{ session, lobby }>}
 */
export async function takeOver({ plan, backup, makeSession, transport = 'peer', params, version }) {
  if (!plan || !backup) throw new Error('There was no copy of the game to carry on from.');
  const text = await decodeState(backup.state);
  const save = JSON.parse(text);
  const session = makeSession(save);
  session.pausesLeft = new Map(backup.pauses || []);
  session.proofs = new Map(backup.proofs || []); // the seats' proofs: the others check them in my `start`
  let endpoint;
  try {
    endpoint = await hostRoom({ transport, roomCode: plan.room, params });
  } catch (err) {
    session.stop('handoff-failed');
    throw err;
  }
  if (endpoint.roomCode !== plan.room) {
    // The broker gave the room's code to someone else in the meantime: nobody would find this one.
    endpoint.close();
    session.stop('handoff-failed');
    throw new Error(`Room ${plan.room} could not be opened.`);
  }
  const lobby = LobbyHost.forGame(endpoint, { transport, version, tokens: backup.tokens });
  lobby.setRejoinHandler((index, conn) => session.rejoin(index, conn));
  // Everyone but me is away until they reconnect: AIs hold their seats, the game waits a while for those who were playing.
  const absent = session.setup.players.filter((p) => p.kind === 'human' && p.index !== session.myIndex).map((p) => p.index);
  session.seatAbsent(absent);
  session.waitFor(backup.present.filter((i) => i !== session.myIndex && i !== plan.host)); // not for the host who left
  return { session, lobby };
}

/**
 * Before anything moves: is the host still there? Only my own link may have dropped (the host's AI holds my
 * seat meanwhile), and taking the game over then would split it in two. Tries the room the game is in now
 * (plan.at) with my token for a few seconds: resolves with LobbyClient.rejoin's { setup, myIndex, conn } when the
 * host takes me back, null when nobody answers there (or a room closing says so); rejects when the host is there and
 * the game is over.
 */
export async function reachHost({ plan, token, name, transport = 'peer', params, version, timeoutMs = 5000, rejoin = LobbyClient.rejoin }) {
  if (!plan || !plan.at || !token) return null;
  try {
    return await rejoin({ transport, roomCode: plan.at, token, name, params, version, timeoutMs, proof: plan.proof || undefined });
  } catch (err) {
    if (err && err.refused && err.message === REASONS.REJOIN_OVER) throw err;
    return null;
  }
}

/**
 * Every other player follows the heir to their room, trying again while it is not open yet.
 * Resolves with LobbyClient.rejoin's { setup, myIndex, conn }; rejects when the heir refuses or never shows up.
 * @param {object} o { plan, token, name, transport, params, version, timeoutMs, retryMs, signal }
 */
export async function followHeir({ plan, token, name, transport = 'peer', params, version, timeoutMs = HANDOFF_JOIN_MS, retryMs = 1500, signal, rejoin = LobbyClient.rejoin }) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { type: 'aborted' });
    try {
      return await rejoin({ transport, roomCode: plan.room, token, name, params, version, timeoutMs: Math.min(15000, Math.max(3000, timeoutMs)), signal, proof: plan.proof || undefined });
    } catch (err) {
      last = err;
      if (err && err.refused && !err.retry) throw err;
      if (err && err.type === 'aborted') throw err;
    }
    if (Date.now() - t0 + retryMs > timeoutMs) break;
    await new Promise((r) => setTimeout(r, retryMs));
  }
  throw Object.assign(new Error('The new host could not be reached.'), { cause: last });
}
