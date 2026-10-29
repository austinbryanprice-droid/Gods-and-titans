// The rejoin ticket (DESIGN 7): what this browser needs to get back into an online game it was
// playing after a lost link or a reloaded page: the room code, the secret token the host gave
// it with `start`, and the transport. One at a time (a browser plays one online game); kept for
// a few hours, and dropped once that game is over or the host refuses it. A client also keeps where the
// game would go if its host left (`next`: the heir's room and this seat's proof there, from the host's PLAN),
// so that a reload while the host moves finds the game at the heir's (seekGame).
import { normalizeRoomCode, isValidRoomCode, sanitizeName } from './protocol.js';

export const REJOIN_KEY = 'mythicwar-rejoin';
export const TICKET_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const TRANSPORTS = ['peer', 'local'];

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // storage blocked
  }
}

/** Keep the ticket of the game that just started: { roomCode, token, myIndex, name, transport }. */
export function saveTicket(t, store = storage(), nowMs = Date.now()) {
  const ticket = cleanTicket({ ...t, at: nowMs }, nowMs);
  if (!ticket || !store) return null;
  try {
    store.setItem(REJOIN_KEY, JSON.stringify(ticket));
  } catch {
    return null; // full or blocked: the game still plays, it just cannot be rejoined
  }
  return ticket;
}

/** The kept ticket, or null (none, unreadable, or older than TICKET_MAX_AGE_MS). */
export function readTicket(store = storage(), nowMs = Date.now()) {
  if (!store) return null;
  try {
    const raw = store.getItem(REJOIN_KEY);
    return raw ? cleanTicket(JSON.parse(raw), nowMs) : null;
  } catch {
    return null;
  }
}

/** Forget the ticket (the game is over, or the host will not take it). With `token`, only that game's. */
export function clearTicket(store = storage(), token = null) {
  if (!store) return;
  try {
    if (token) {
      const raw = store.getItem(REJOIN_KEY);
      const t = raw ? JSON.parse(raw) : null;
      if (t && typeof t === 'object' && t.token !== token) return; // another game's ticket
    }
    store.removeItem(REJOIN_KEY);
    store.removeItem(REJOIN_VIEW_KEY);
  } catch {
    // ignore
  }
}

// What the player had seen (the fog explored, enemy buildings and mines as last seen), kept under its own
// key with the token so a rejoined game does not come back with a black map. Packed by the game (a string).
export const REJOIN_VIEW_KEY = 'mythicwar-rejoin-view';
const MAX_VIEW_CHARS = 600000;

/** Keep this game's view memory (a packed string) for a rejoin. False when too big or storage refuses. */
export function saveView(token, packed, store = storage()) {
  if (!store || !token || typeof packed !== 'string' || packed.length > MAX_VIEW_CHARS) return false;
  try {
    const raw = store.getItem(REJOIN_KEY);
    const t = raw ? JSON.parse(raw) : null;
    if (!t || typeof t !== 'object' || t.token !== token) return false; // the game is over (or another one's)
    store.setItem(REJOIN_VIEW_KEY, JSON.stringify({ token, view: packed }));
    return true;
  } catch {
    return false;
  }
}

/** The view memory kept for this token, or null. */
export function readView(token, store = storage()) {
  if (!store || !token) return null;
  try {
    const raw = store.getItem(REJOIN_VIEW_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && v.token === token && typeof v.view === 'string' ? v.view : null;
  } catch {
    return null;
  }
}

const MAX_TALLY_CHARS = 8000;

/**
 * Keep the career's running tally of this game (CareerTracker.m: buildings lost, gods summoned, …) with its
 * ticket, so that a rejoined game carries on counting instead of starting from nothing. Only for that token.
 */
export function saveTally(token, tally, store = storage()) {
  if (!store || !token || !tally || typeof tally !== 'object') return false;
  try {
    const raw = store.getItem(REJOIN_KEY);
    const t = raw ? JSON.parse(raw) : null;
    if (!t || typeof t !== 'object' || t.token !== token) return false;
    const json = JSON.stringify(tally);
    if (json.length > MAX_TALLY_CHARS) return false;
    t.tally = JSON.parse(json);
    store.setItem(REJOIN_KEY, JSON.stringify(t));
    return true;
  } catch {
    return false;
  }
}

function cleanTally(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  try {
    return JSON.stringify(v).length <= MAX_TALLY_CHARS ? v : null;
  } catch {
    return null;
  }
}

function cleanTicket(t, nowMs) {
  if (!t || typeof t !== 'object') return null;
  const roomCode = normalizeRoomCode(t.roomCode);
  const token = typeof t.token === 'string' && /^[0-9a-f]{8,64}$/.test(t.token) ? t.token : null;
  const at = Number(t.at);
  if (!isValidRoomCode(roomCode) || !token || !Number.isFinite(at) || nowMs - at > TICKET_MAX_AGE_MS || at - nowMs > 60000) return null;
  return {
    roomCode,
    token,
    myIndex: Number.isInteger(t.myIndex) && t.myIndex >= 0 ? t.myIndex : 0,
    name: sanitizeName(t.name, 'Player'),
    transport: TRANSPORTS.includes(t.transport) ? t.transport : 'peer',
    at,
    tally: cleanTally(t.tally), // the career's running tally (saveTally), or null
    // after a host migration: my seat's proof (DESIGN 7), which the game's host shows in `start`; null before one
    proof: cleanProof(t.proof),
    // where the game goes if its host leaves (saveNext): { room, proof } or null (none known, or a ticket from before)
    next: cleanNext(t.next, roomCode),
  };
}

const cleanProof = (p) => (typeof p === 'string' && /^[0-9a-f]{8,64}$/.test(p) ? p : null);

function cleanNext(n, roomCode) {
  if (!n || typeof n !== 'object') return null;
  const room = normalizeRoomCode(n.room);
  return isValidRoomCode(room) && room !== roomCode ? { room, proof: cleanProof(n.proof) } : null;
}

/**
 * Keep with this token's ticket where the game goes if its host leaves: the heir's room and my seat's proof
 * there (a client's PLAN, DESIGN 7), or null when there is none (or I am the heir: nobody else could open it).
 * Writes only when it changed. True when the ticket holds it now.
 */
export function saveNext(token, next, store = storage()) {
  if (!store || !token) return false;
  try {
    const raw = store.getItem(REJOIN_KEY);
    const t = raw ? JSON.parse(raw) : null;
    if (!t || typeof t !== 'object' || t.token !== token) return false;
    const clean = cleanNext(next, normalizeRoomCode(t.roomCode));
    const had = cleanNext(t.next, normalizeRoomCode(t.roomCode));
    if (JSON.stringify(clean) === JSON.stringify(had)) return true;
    t.next = clean;
    store.setItem(REJOIN_KEY, JSON.stringify(t));
    return true;
  } catch {
    return false;
  }
}

/** How long Rejoin keeps looking for a game whose room is not there (the host may be moving it to the heir). */
export const REJOIN_SEEK_MS = 20000;
const SEEK_RETRY_MS = 1500;

/** A rejoin that failed because nobody answers at that room code (as opposed to a host saying no, or no network). */
export function isRoomGone(err) {
  if (!err || err.refused) return false;
  return /not found|peer-unavailable|could not connect to peer/i.test(String(err.message || ''));
}

/** The rooms a ticket may find its game in, in order: [{ room, proof }] (the room it was in, then the heir's). */
export function ticketRooms(ticket) {
  if (!ticket) return [];
  const out = [{ room: ticket.roomCode, proof: ticket.proof || null }];
  if (ticket.next && ticket.next.room !== ticket.roomCode) out.push({ room: ticket.next.room, proof: ticket.next.proof || null });
  return out;
}

/**
 * Find the ticket's game (DESIGN 7): try its room, then the heir's, again and again for up to `seekMs` while
 * nobody answers there (a host moving the game leaves a gap between its room closing and the heir's opening)
 * or the host says "later". Resolves with { info, room, proof } (info: what `rejoin` resolved with);
 * rejects with the host's refusal or any other error at once, and with an Error flagged `gone` when no room
 * answered in time. `onWait()` is called once, when the first round found nothing.
 * @param {object} o { ticket, rejoin(opts), seekMs, retryMs, signal, onWait, now }
 */
export async function seekGame({ ticket, rejoin, seekMs = REJOIN_SEEK_MS, retryMs = SEEK_RETRY_MS, signal, onWait, now = Date.now }) {
  const rooms = ticketRooms(ticket);
  if (!rooms.length) throw Object.assign(new Error('There is no online game to rejoin from this browser.'), { refused: true });
  const t0 = now();
  let waited = false;
  let later = null; // a host that said "not yet" (still loading, busy): the ticket stays good
  for (;;) {
    for (const { room, proof } of rooms) {
      if (signal && signal.aborted) throw Object.assign(new Error('aborted'), { type: 'aborted' });
      try {
        const info = await rejoin({ transport: ticket.transport, roomCode: room, token: ticket.token, name: ticket.name, proof: proof || undefined, signal });
        return { info, room, proof };
      } catch (err) {
        if (err && err.type === 'aborted') throw err;
        if (err && err.refused && err.retry) later = err;
        else if (!isRoomGone(err)) throw err;
      }
    }
    if (now() - t0 + retryMs > seekMs) break;
    later = null;
    if (!waited && onWait) onWait();
    waited = true;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(done, retryMs);
      function done() {
        if (signal) signal.removeEventListener('abort', aborted);
        resolve();
      }
      function aborted() {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { type: 'aborted' }));
      }
      if (signal) signal.addEventListener('abort', aborted, { once: true });
    });
  }
  if (later) throw later;
  throw Object.assign(new Error(`The game in room ${ticket.roomCode} is gone: the host has left it.`), { gone: true });
}
