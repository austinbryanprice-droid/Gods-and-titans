import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession, ClientSession, standInDifficulty, REJOIN_GRACE_MS } from '../../src/net/session.js';
import { LobbyHost, LobbyClient } from '../../src/net/lobby.js';
import { MSG, REASONS } from '../../src/net/protocol.js';
import { createLoopbackPair } from '../../src/net/transport.js';
import { fakeWorldFactory, makeFakeMap } from '../../src/net/fake-world.js';
import { saveTicket, readTicket, clearTicket, saveTally, saveView, readView, REJOIN_KEY, REJOIN_VIEW_KEY, TICKET_MAX_AGE_MS } from '../../src/net/rejoin-ticket.js';
import { ViewState } from '../../src/game/view-state.js';
import { packView, restoreView } from '../../src/game/game-saves.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(1);
  }
}
const json = (v) => JSON.parse(JSON.stringify(v));
const fakeMap = () => makeFakeMap(48, 48);

function setupWith(kinds) {
  const players = kinds.map((k, i) => ({
    index: i, name: ['Host', 'Ann', 'Ben', 'Cy'][i], team: i < 2 ? 1 : 2, pantheon: 'greek', color: '#d63a3a',
    kind: k === 'human' ? 'human' : 'ai', difficulty: k === 'human' ? null : k,
  }));
  return { version: '0.1.0', seed: 7, mapSize: 'small', players };
}

function makeHost(setup, opts = {}) {
  const aiCalls = [];
  const createAI = (world, index, difficulty) => {
    const ai = { index, difficulty, ticks: 0, tick() { this.ticks++; } };
    aiCalls.push(ai);
    return ai;
  };
  const conns = new Map();
  const clients = new Map();
  for (const p of setup.players) {
    if (p.kind !== 'human' || p.index === 0) continue;
    const [hostSide, clientSide] = createLoopbackPair();
    conns.set(p.index, hostSide);
    clients.set(p.index, new ClientSession({ setup, myIndex: p.index, conn: clientSide, generateMap: fakeMap, pingIntervalMs: 20 }));
  }
  const host = new HostSession({ setup, myIndex: 0, conns, createWorld: fakeWorldFactory({ units: 60, buildings: 2, churn: 1, ...opts }), createAI, autoTick: false });
  return { host, clients, aiCalls };
}

/** A new client link into the host session, as the lobby hands it over: START first, then the full snapshot. */
function rejoinLink(host, index) {
  const [hostSide, clientSide] = createLoopbackPair();
  const seen = [];
  const off = clientSide.onMessage((m) => seen.push(m));
  const problem = host.rejoin(index, hostSide);
  return { problem, hostSide, clientSide, seen, off };
}

test('rejoin: the stand-in AI plays at the hardest difficulty of the game, Normal among people only', () => {
  assert.equal(standInDifficulty(setupWith(['human', 'human', 'hard', 'easy'])), 'hard');
  assert.equal(standInDifficulty(setupWith(['human', 'human', 'brutal'])), 'brutal');
  assert.equal(standInDifficulty(setupWith(['human', 'human', 'human'])), 'normal');
  assert.equal(standInDifficulty(null), 'normal');
});

test('rejoin: a dropped player in a Hard game gets a Hard stand-in, and takes the seat back with a full snapshot', async () => {
  const setup = setupWith(['human', 'human', 'hard', 'hard']);
  const { host, clients, aiCalls } = makeHost(setup);
  const ann = clients.get(1);
  host.start();
  ann.start();
  await ann.ready;
  assert.equal(aiCalls.length, 2, 'the two computer players');
  const hostLines = [];
  host.onChat((l) => hostLines.push(l));

  ann.stop(); // Ann's page reloads: her link goes
  await waitFor(() => aiCalls.length === 3, 3000, 'stand-in AI');
  const standIn = aiCalls[2];
  assert.equal(standIn.index, 1);
  assert.equal(standIn.difficulty, 'hard');
  assert.match(hostLines.at(-1).text, /^Ann has left the game\. An AI \(Hard\) plays for them until they rejoin, and keeps their god powers for them\.$/);
  host.step(3);
  assert.equal(standIn.ticks, 3, 'the stand-in plays while Ann is away');
  // Everyone's snapshot marks the seat a stand-in holds (the career counts no win over a person there, DESIGN 9.1).
  assert.equal(host.lastSnap.players[1].away, true);
  assert.equal(host.lastSnap.players[0].away, undefined);
  assert.equal(host.world.players[1].away, undefined, 'a mark on the snapshot, not on the world');

  // Ann comes back on a new link.
  const link = rejoinLink(host, 1);
  assert.equal(link.problem, null);
  await waitFor(() => link.seen.length >= 2, 3000, 'start + full');
  assert.equal(link.seen[0].t, MSG.START);
  assert.equal(link.seen[0].you, 1);
  assert.deepEqual(link.seen[0].setup, json(setup));
  assert.equal(link.seen[1].t, MSG.FULL);
  assert.equal(link.seen[1].snap.tick, host.lastSnap.tick);
  assert.match(hostLines.at(-1).text, /^Ann has rejoined the game and takes back control from the AI\.$/);
  assert.equal(host.ais.has(1), false, 'the stand-in is gone');
  assert.equal(host.leftPlayers.has(1), false);
  host.step(2);
  assert.equal(standIn.ticks, 3, 'and no longer plays');
  assert.equal(host.lastSnap.players[1].away, undefined, 'her seat is hers again');

  // A new ClientSession on the link picks up where the host is, and its commands are Ann's.
  link.off();
  const ann2 = new ClientSession({ setup, myIndex: 1, conn: link.clientSide, generateMap: fakeMap, pingIntervalMs: 20 });
  assert.equal(link.hostSide.timeoutMs, REJOIN_GRACE_MS, 'a long grace while Ann builds the game');
  ann2.start();
  await ann2.ready;
  await waitFor(() => link.hostSide.timeoutMs === host.connTimeoutMs, 3000, 'grace over once Ann pings');
  host.step(1);
  await waitFor(() => ann2.snap && ann2.snap.tick === host.lastSnap.tick, 3000, 'synced');
  assert.deepStrictEqual(ann2.snap, json(host.lastSnap));
  ann2.sendCommand({ type: 'stop', units: [1], playerIndex: 0 });
  await waitFor(() => host.world.queue.length + host.world.commands.length > 0, 3000, 'command');
  host.step(1);
  assert.ok(host.world.commands.some((c) => c.player === 1 && c.cmd.type === 'stop'), 'the command is Ann\'s');

  // Dropping out again brings a fresh stand-in.
  ann2.stop();
  await waitFor(() => aiCalls.length === 4, 3000, 'second stand-in');
  assert.equal(aiCalls[3].difficulty, 'hard');
  host.stop();
});

test('rejoin: a link still open is replaced (the old window is told), and the seat keeps no AI', async () => {
  const { host, clients, aiCalls } = makeHost(setupWith(['human', 'human', 'human']));
  const ann = clients.get(1);
  host.start();
  ann.start();
  await ann.ready;
  const ends = [];
  ann.onEnd((e) => ends.push(e));
  const link = rejoinLink(host, 1); // a reload before the old link timed out
  assert.equal(link.problem, null);
  await waitFor(() => ends.length === 1, 3000, 'old window ends');
  assert.equal(ends[0].reason, REASONS.REPLACED);
  assert.equal(aiCalls.length, 0, 'no AI ever took over');
  assert.equal(host.clients.get(1).conn, link.hostSide);
  await waitFor(() => link.seen.some((m) => m.t === MSG.FULL), 3000, 'full');
  // The old link closing later does not hand the seat to an AI.
  await sleep(400);
  assert.equal(aiCalls.length, 0);
  assert.equal(host.clients.get(1).conn, link.hostSide);
  host.stop();
});

test('rejoin: refused for the host\'s own seat, a computer player, an unknown index and a finished game', async () => {
  const setup = setupWith(['human', 'human', 'easy']);
  const { host } = makeHost(setup, { gameOverTick: 3 });
  host.start();
  assert.equal(rejoinLink(host, 0).problem, REASONS.REJOIN_DENIED);
  assert.equal(rejoinLink(host, 2).problem, REASONS.REJOIN_DENIED);
  assert.equal(rejoinLink(host, 9).problem, REASONS.REJOIN_DENIED);
  assert.equal(rejoinLink(host, '1').problem, REASONS.REJOIN_DENIED);
  host.step(4);
  assert.ok(host.lastSnap.gameOver);
  assert.equal(rejoinLink(host, 1).problem, REASONS.REJOIN_OVER);
  host.stop();
  assert.equal(rejoinLink(host, 1).problem, REASONS.HOST_QUIT);
});

test('rejoin through the lobby: the start carries a token, and only that token wins the seat back', async () => {
  const lobby = await LobbyHost.create({ transport: 'loopback', name: 'Host' });
  const bob = await LobbyClient.join({ transport: 'loopback', roomCode: lobby.roomCode, name: 'Bob' });
  const starts = [];
  bob.onStart((i) => starts.push(i));
  const res = lobby.start();
  await waitFor(() => starts.length === 1, 3000, 'start');
  const token = starts[0].rejoin;
  assert.match(token, /^[0-9a-f]{32}$/);
  const bobIndex = starts[0].myIndex;

  // The host is still loading: no session takes rejoins yet.
  await assert.rejects(LobbyClient.rejoin({ transport: 'loopback', roomCode: lobby.roomCode, token, name: 'Bob' }), (e) => e.refused && e.retry && e.message === REASONS.REJOIN_LATER);

  const host = new HostSession({ setup: res.setup, myIndex: res.myIndex, conns: res.conns, createWorld: fakeWorldFactory({ units: 40 }), createAI: () => ({ tick() {} }), autoTick: false });
  lobby.setRejoinHandler((i, conn) => host.rejoin(i, conn));
  host.start();

  // Someone who was never in the game, a made-up token, another build.
  await assert.rejects(LobbyClient.rejoin({ transport: 'loopback', roomCode: lobby.roomCode, token: 'ab'.repeat(16), name: 'Eve' }), (e) => e.refused && !e.retry && e.message === REASONS.STARTED);
  await assert.rejects(LobbyClient.rejoin({ transport: 'loopback', roomCode: lobby.roomCode, token: 'not a token', name: 'Eve' }), (e) => e.message === REASONS.REJOIN_UNKNOWN);
  await assert.rejects(LobbyClient.rejoin({ transport: 'loopback', roomCode: lobby.roomCode, token, name: 'Bob', version: '0.0.1' }), (e) => e.refused && /Version mismatch/.test(e.message));
  // A stranger joining the room normally is still told the game started.
  await assert.rejects(LobbyClient.join({ transport: 'loopback', roomCode: lobby.roomCode, name: 'Late' }), /already started/);

  // Bob's link drops; he rejoins with his token.
  res.conns.get(bobIndex).close('lost');
  await waitFor(() => host.standIns.has(bobIndex), 3000, 'stand-in');
  const info = await LobbyClient.rejoin({ transport: 'loopback', roomCode: lobby.roomCode, token, name: 'Bob' });
  assert.equal(info.myIndex, bobIndex);
  assert.equal(info.rejoin, token);
  assert.deepEqual(info.setup.players.map((p) => p.name), res.setup.players.map((p) => p.name));
  assert.equal(host.standIns.has(bobIndex), false);
  // The full snapshot waited in the connection for the game session.
  const session = new ClientSession({ setup: { ...info.setup, mapHash: undefined }, myIndex: info.myIndex, conn: info.conn, generateMap: fakeMap, pingIntervalMs: 20 });
  session.start();
  await session.ready;
  assert.deepStrictEqual(session.snap, json(host.lastSnap));

  // Closing the lobby (the host back at the menu) ends rejoining.
  host.stop();
  lobby.close();
  await assert.rejects(LobbyClient.rejoin({ transport: 'loopback', roomCode: lobby.roomCode, token, name: 'Bob', timeoutMs: 1500 }));
  session.stop();
  bob.leave();
});

test('rejoin ticket: kept for one game, a few hours, and cleared once that game is done', () => {
  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const t0 = 1_000_000;
  const token = 'c0ffee'.repeat(4);
  assert.equal(saveTicket({ roomCode: 'abcde', token, myIndex: 2, name: 'Ann', transport: 'local' }, store, t0).roomCode, 'ABCDE');
  assert.deepEqual(readTicket(store, t0 + 1000), { roomCode: 'ABCDE', token, myIndex: 2, name: 'Ann', transport: 'local', at: t0, tally: null, proof: null, next: null });
  // After a host migration the ticket keeps my seat's proof (DESIGN 7), checked in the next host's `start`.
  saveTicket({ roomCode: 'abcde', token, myIndex: 2, name: 'Ann', transport: 'local', proof: 'cd'.repeat(16) }, store, t0);
  assert.equal(readTicket(store, t0 + 1000).proof, 'cd'.repeat(16));
  saveTicket({ roomCode: 'abcde', token, myIndex: 2, name: 'Ann', transport: 'local' }, store, t0);
  // The career's running tally rides with the ticket of that game only.
  assert.equal(saveTally('beef'.repeat(8), { buildingsLost: 3 }, store), false);
  assert.equal(saveTally(token, { buildingsLost: 3, godsSummoned: 1 }, store), true);
  assert.deepEqual(readTicket(store, t0 + 1000).tally, { buildingsLost: 3, godsSummoned: 1 });
  assert.equal(saveTally(token, { junk: 'x'.repeat(9000) }, store), false, 'too big');
  assert.equal(readTicket(store, t0 + TICKET_MAX_AGE_MS + 1), null, 'too old');
  clearTicket(store, 'beef'.repeat(8)); // another game's token leaves it alone
  assert.ok(mem.has(REJOIN_KEY));
  clearTicket(store, token);
  assert.equal(mem.has(REJOIN_KEY), false);
  assert.equal(saveTicket({ roomCode: 'AB', token }, store, t0), null, 'a bad room code');
  assert.equal(saveTicket({ roomCode: 'ABCDE', token: '<script>' }, store, t0), null, 'a bad token');
  mem.set(REJOIN_KEY, '{nope');
  assert.equal(readTicket(store, t0), null);
  assert.equal(readTicket(null), null);
});

test('rejoin view: what the player had seen is kept with the ticket and put back, not a black map', () => {
  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const token = 'c0ffee'.repeat(4);
  const setup = { seed: 3, mapSize: 'small', players: [{ index: 0, team: 1, pantheon: 'greek', kind: 'human' }] };
  const map = makeFakeMap(32, 32);
  const before = new ViewState({ setup, mapData: map, myIndex: 0 });
  for (let i = 0; i < 300; i++) before.explored[i * 3] = 1;
  before.lastSeen.set(77, { type: 'house', owner: 1 });
  const packed = JSON.stringify(packView(before));
  assert.equal(saveView(token, packed, store), false, 'no ticket: the game is over, nothing kept');
  saveTicket({ roomCode: 'ABCDE', token, myIndex: 0, name: 'Ann', transport: 'local' }, store);
  assert.equal(saveView(token, packed, store), true);
  assert.equal(readView('beef'.repeat(8), store), null, 'another game');
  const after = new ViewState({ setup, mapData: map, myIndex: 0 });
  restoreView(after, JSON.parse(readView(token, store)));
  assert.deepEqual([...after.explored], [...before.explored]);
  assert.deepEqual(after.lastSeen.get(77), { type: 'house', owner: 1 });
  clearTicket(store, token);
  assert.equal(mem.has(REJOIN_VIEW_KEY), false, 'cleared with the ticket');
});
