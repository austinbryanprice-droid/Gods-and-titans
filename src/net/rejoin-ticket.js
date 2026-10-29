// The rejoin ticket (DESIGN 7): what this browser needs to get back into an online game it was
// playing after a lost link or a reloaded page: the room code, the secret token the host gave
// it with `start`, and the transport. One at a time (a browser plays one online game); kept for
// a few hours, and dropped once that game is over or the host refuses it.
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
  } catch {
    // ignore
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
  };
}
