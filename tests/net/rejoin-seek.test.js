// Rejoin while the host moves the game (DESIGN 7): the ticket keeps the heir's room, and Rejoin looks for
// the game a while instead of giving the ticket up the moment its room is gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveTicket, readTicket, saveNext, saveTally, seekGame, ticketRooms, isRoomGone, REJOIN_KEY } from '../../src/net/rejoin-ticket.js';
import { REASONS } from '../../src/net/protocol.js';

function memStore() {
  const mem = new Map();
  return { mem, getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
}
const token = 'c0ffee'.repeat(4);
const proof = 'ab'.repeat(16);
const notFound = (room) => new Error(`Room ${room} was not found. Check the code and that the host is still in the lobby.`);

// A fake clock: setTimeout advances it by the delay and runs the callback on the next turn.
function withClock(fn) {
  const clock = { t: 0 };
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (cb, ms) => { clock.t += ms || 0; return realTimeout(cb, 0); };
  return Promise.resolve()
    .then(() => fn(clock))
    .finally(() => { globalThis.setTimeout = realTimeout; });
}

test('rejoin ticket: keeps the heir\'s room and my proof there, for this game only; old tickets read without it', () => {
  const store = memStore();
  const t0 = Date.now();
  saveTicket({ roomCode: 'ABCDE', token, myIndex: 1, name: 'Ann', transport: 'peer' }, store, t0);
  assert.equal(readTicket(store, t0).next, null);
  assert.equal(saveNext('beef'.repeat(8), { room: 'FGHJK', proof }, store), false, 'another game\'s token');
  assert.equal(saveNext(token, { room: 'fghjk', proof }, store), true);
  assert.deepEqual(readTicket(store, t0).next, { room: 'FGHJK', proof });
  // The tally and the heir's room live side by side.
  saveTally(token, { buildingsLost: 2 }, store);
  assert.deepEqual(readTicket(store, t0).next, { room: 'FGHJK', proof });
  assert.deepEqual(readTicket(store, t0).tally, { buildingsLost: 2 });
  // Junk is dropped: a bad room, the ticket's own room, a bad proof (the room stays, without a proof).
  saveNext(token, { room: 'AB', proof }, store);
  assert.equal(readTicket(store, t0).next, null);
  saveNext(token, { room: 'ABCDE', proof }, store);
  assert.equal(readTicket(store, t0).next, null);
  saveNext(token, { room: 'FGHJK', proof: '<x>' }, store);
  assert.deepEqual(readTicket(store, t0).next, { room: 'FGHJK', proof: null });
  saveNext(token, null, store);
  assert.equal(readTicket(store, t0).next, null);
  // A ticket written before `next` existed still reads (and an older build drops the key it does not know).
  store.setItem(REJOIN_KEY, JSON.stringify({ roomCode: 'ABCDE', token, myIndex: 1, name: 'Ann', transport: 'peer', at: t0 }));
  assert.equal(readTicket(store, t0).token, token);
  assert.equal(readTicket(store, t0).next, null);
  assert.deepEqual(ticketRooms(readTicket(store, t0)), [{ room: 'ABCDE', proof: null }]);
});

test('rejoin seek: the room is gone, the heir\'s opens a few seconds later: found there, with my proof', () => withClock(async (clock) => {
  const ticket = { roomCode: 'ABCDE', token, name: 'Ann', transport: 'peer', proof: null, next: { room: 'FGHJK', proof } };
  const calls = [];
  const rejoin = async (o) => {
    calls.push([o.roomCode, o.proof]);
    clock.t += 200; // a "not found" comes back fast
    if (o.roomCode === 'FGHJK' && clock.t > 6000) return { setup: {}, myIndex: 1, conn: {} };
    throw notFound(o.roomCode);
  };
  let waits = 0;
  const found = await seekGame({ ticket, rejoin, now: () => clock.t, onWait: () => waits++ });
  assert.equal(found.room, 'FGHJK');
  assert.equal(found.proof, proof);
  assert.equal(waits, 1, 'the "Looking for the game" state shows once');
  assert.deepEqual(calls.slice(0, 2), [['ABCDE', undefined], ['FGHJK', proof]], 'its own room first, then the heir\'s');
  assert.ok(calls.length > 4);
}));

test('rejoin seek: an old host reopening its tab finds the heir\'s room (its ticket\'s own) once it opens', () => withClock(async (clock) => {
  // The host's ticket already points at the heir's room, with its own proof.
  const ticket = { roomCode: 'FGHJK', token, name: 'Host', transport: 'peer', proof, next: null };
  const rejoin = async (o) => {
    clock.t += 200;
    if (clock.t > 9000) return { setup: {}, myIndex: 0, conn: {}, proof: o.proof };
    throw notFound(o.roomCode);
  };
  const found = await seekGame({ ticket, rejoin, now: () => clock.t });
  assert.equal(found.room, 'FGHJK');
  assert.equal(found.info.proof, proof);
}));

test('rejoin seek: gives up as `gone` only after REJOIN_SEEK_MS; a refusal or another error comes back at once', () => withClock(async (clock) => {
  const ticket = { roomCode: 'ABCDE', token, name: 'Ann', transport: 'peer', proof: null, next: null };
  let tries = 0;
  await assert.rejects(
    seekGame({ ticket, rejoin: async (o) => { tries++; throw notFound(o.roomCode); }, now: () => clock.t, seekMs: 20000 }),
    (err) => err.gone === true && /ABCDE.*gone/.test(err.message),
  );
  assert.ok(clock.t >= 18000 && clock.t <= 20000, `looked for about 20 s (${clock.t})`);
  assert.ok(tries > 5);
  // The host said no: no waiting.
  clock.t = 0;
  await assert.rejects(
    seekGame({ ticket, rejoin: async () => { throw Object.assign(new Error(REASONS.REJOIN_OVER), { refused: true, retry: false }); }, now: () => clock.t }),
    (err) => err.refused && !err.gone,
  );
  assert.equal(clock.t, 0);
  // No network: as before, the error at once (the ticket is kept, Try Again offered).
  await assert.rejects(seekGame({ ticket, rejoin: async () => { throw new Error("Couldn't reach the matchmaking server (host)."); }, now: () => clock.t }), (err) => !err.gone);
  assert.equal(clock.t, 0);
  // "Still loading" is waited on, and if it never lets me in it is that answer, not `gone` (the ticket stays good).
  await assert.rejects(
    seekGame({ ticket, rejoin: async () => { throw Object.assign(new Error('still loading'), { refused: true, retry: true }); }, now: () => clock.t, seekMs: 5000 }),
    (err) => err.refused && err.retry && !err.gone,
  );
  // Aborting (Back) stops the search.
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(seekGame({ ticket, rejoin: async (o) => { throw notFound(o.roomCode); }, signal: ctrl.signal }), (err) => err.type === 'aborted');
}));

test('rejoin seek: what counts as "nobody at that room"', () => {
  assert.equal(isRoomGone(notFound('ABCDE')), true);
  assert.equal(isRoomGone(new Error('Room ABCDE was not found in this browser.')), true);
  assert.equal(isRoomGone(Object.assign(new Error('not found'), { refused: true })), false);
  assert.equal(isRoomGone(new Error("Couldn't connect to the host.")), false);
  assert.equal(isRoomGone(null), false);
});
