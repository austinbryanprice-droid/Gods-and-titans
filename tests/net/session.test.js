import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession, ClientSession, RESYNC_MIN_INTERVAL_MS } from '../../src/net/session.js';
import { MAX_CLIENT_BUFFER_BYTES, STALL_NOTICE_MS } from '../../src/net/protocol.js';
import { LobbyHost, LobbyClient } from '../../src/net/lobby.js';
import { createLoopbackPair } from '../../src/net/transport.js';
import { FakeWorld, fakeWorldFactory, makeFakeMap } from '../../src/net/fake-world.js';
import { Ticker } from '../../src/net/ticker.js';
import { generateMap, mapHash } from '../../src/sim/mapgen.js';
import { TERRAIN } from '../../src/config.js';

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

function makeSetup(n = 3) {
  const players = [];
  for (let i = 0; i < n; i++) {
    players.push({ index: i, name: ['Host', 'Ann', 'Ben', 'Cy'][i], team: i === 0 ? 1 : 2, pantheon: 'greek', color: '#d63a3a', kind: 'human', difficulty: null });
  }
  return { version: '0.1.0', seed: 99, mapSize: 'small', players };
}

/** Host + clients over loopback pairs; FakeWorld; manual stepping. */
function makeGame({ clients = 2, units = 300, aiSlots = [] } = {}) {
  const setup = makeSetup(clients + 1 + aiSlots.length);
  for (const i of aiSlots) Object.assign(setup.players[i], { kind: 'ai', difficulty: 'easy', name: 'AI' });
  const conns = new Map();
  const clientSessions = [];
  const aiCalls = [];
  const createAI = (world, index, difficulty) => {
    const ai = { index, difficulty, ticks: 0, tick() { this.ticks++; } };
    aiCalls.push({ world, index, difficulty, ai });
    return ai;
  };
  const humanIdx = setup.players.filter((p) => p.kind === 'human' && p.index !== 0).map((p) => p.index);
  for (const i of humanIdx) {
    const [hostSide, clientSide] = createLoopbackPair();
    conns.set(i, hostSide);
    clientSessions.push(new ClientSession({ setup, myIndex: i, conn: clientSide, generateMap: fakeMap, pingIntervalMs: 20 }));
  }
  const host = new HostSession({ setup, myIndex: 0, conns, createWorld: fakeWorldFactory({ units, buildings: 4, churn: 2 }), createAI, autoTick: false });
  return { setup, host, clients: clientSessions, conns, aiCalls };
}

async function stepAndSync(host, clients, n = 1) {
  for (let i = 0; i < n; i++) {
    host.step(1);
    const tick = host.lastSnap.tick;
    await waitFor(() => clients.every((c) => c.stopped || (c.snap && c.snap.tick === tick)), 3000, `tick ${tick}`);
  }
}

test('sessions: clients reconstruct exactly the host snapshot every tick', async () => {
  const { host, clients } = makeGame({ clients: 2, units: 400 });
  host.start();
  for (const c of clients) c.start();
  await Promise.all(clients.map((c) => c.ready));
  assert.ok(JSON.stringify(host.lastSnap).length > 64 * 1024, 'first full snapshot is large (chunked)');
  for (const c of clients) assert.deepStrictEqual(c.snap, json(host.lastSnap));
  for (let i = 0; i < 150; i++) {
    await stepAndSync(host, clients);
    for (const c of clients) assert.deepStrictEqual(c.snap, json(host.lastSnap), `tick ${host.lastSnap.tick}`);
  }
  // ViewStates agree on the entity set and the felled trees.
  for (const c of clients) {
    assert.deepEqual([...c.viewState.entities.keys()], [...host.viewState.entities.keys()]);
    assert.deepEqual(c.viewState.felledAll, host.viewState.felledAll);
    assert.equal(c.viewState.tick, host.viewState.tick);
    assert.equal(c.resyncs, 0);
  }
  assert.ok(host.felledAll.length > 0, 'some trees were felled');
  for (const c of clients) c.stop();
  host.stop();
});

test('sessions: commands always use the sender’s player index', async () => {
  const { host, clients } = makeGame({ clients: 2 });
  host.start();
  await Promise.all(clients.map((c) => c.ready));
  const [ann, ben] = clients;
  ann.sendCommand({ type: 'move', units: [1, 2], x: 10, y: 11, player: 0, playerIndex: 0 });
  ben.sendCommand({ type: 'stop', units: [3] });
  host.sendCommand({ type: 'hold', units: [4] });
  ann.sendCommand({ nope: true }); // malformed: dropped
  await waitFor(() => host.world.queue.length >= 3, 3000, 'commands to reach the host');
  await sleep(10); // let the malformed one arrive too, so the test would see it if it were kept
  host.step(1);
  const cmds = host.world.commands.map((c) => [c.player, c.cmd.type]);
  assert.deepEqual(cmds.sort(), [[0, 'hold'], [1, 'move'], [2, 'stop']].sort());
  const move = host.world.commands.find((c) => c.cmd.type === 'move');
  assert.equal(move.cmd.player, undefined);
  assert.equal(move.cmd.playerIndex, undefined);
  assert.deepEqual(move.cmd.units, [1, 2]);
  host.stop();
});

test('sessions: chat, pings and AI ticking', async () => {
  const { host, clients, aiCalls } = makeGame({ clients: 2, aiSlots: [3] });
  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].index, 3);
  assert.equal(aiCalls[0].difficulty, 'easy');
  assert.equal(aiCalls[0].world, host.world);
  host.start();
  for (const c of clients) c.start();
  await Promise.all(clients.map((c) => c.ready));
  const lines = { host: [], a: [], b: [] };
  host.onChat((l) => lines.host.push(l));
  clients[0].onChat((l) => lines.a.push(l));
  clients[1].onChat((l) => lines.b.push(l));
  clients[0].sendChat('for Olympus!');
  host.sendChat('gg');
  await waitFor(() => lines.b.length === 2 && lines.a.length === 2 && lines.host.length === 2);
  assert.deepEqual(lines.b.find((l) => l.from === 1), { from: 1, name: 'Ann', text: 'for Olympus!', system: false });
  assert.deepEqual(lines.a.find((l) => l.from === 0), { from: 0, name: 'Host', text: 'gg', system: false });
  await waitFor(() => clients.every((c) => typeof c.pingMs === 'number'));
  await waitFor(() => host.peerPings.size === 2, 3000, 'rtt reported to host');
  assert.equal(host.pingMs, 0);
  await stepAndSync(host, clients, 10);
  assert.equal(aiCalls[0].ai.ticks, 10, 'AI ticked once per sim tick');
  for (const c of clients) c.stop();
  host.stop();
});

test('sessions: a disconnected human is taken over by an AI (Normal)', async () => {
  const { host, clients, aiCalls } = makeGame({ clients: 2 });
  host.start();
  await Promise.all(clients.map((c) => c.ready));
  const annLines = [];
  const hostLines = [];
  clients[0].onChat((l) => annLines.push(l));
  host.onChat((l) => hostLines.push(l));
  assert.equal(aiCalls.length, 0);
  clients[1].stop(); // Ben closes the tab
  await waitFor(() => aiCalls.length === 1, 3000, 'AI takeover');
  assert.equal(aiCalls[0].index, 2);
  assert.equal(aiCalls[0].difficulty, 'normal');
  assert.equal(aiCalls[0].world, host.world);
  await waitFor(() => annLines.length === 1);
  assert.equal(annLines[0].system, true);
  assert.match(annLines[0].text, /Ben has left the game\. An AI \(Normal\) plays for them until they rejoin\./);
  assert.match(hostLines[0].text, /Ben has left/);
  await stepAndSync(host, [clients[0]], 5);
  assert.equal(aiCalls[0].ai.ticks, 5);
  assert.deepStrictEqual(clients[0].snap, json(host.lastSnap));
  host.stop();
});

test('sessions: a dropped delta triggers resync and a full snapshot with felledAll', async () => {
  const { host, clients, conns } = makeGame({ clients: 1, units: 120 });
  const [ann] = clients;
  host.start();
  await ann.ready;
  await stepAndSync(host, clients, 60);
  assert.ok(host.felledAll.length > 0, 'trees felled before the resync');
  // Drop the next delta on the wire.
  const hostSide = conns.get(1);
  const send = hostSide.rawSend;
  let dropped = 0;
  hostSide.rawSend = (f) => {
    if (!dropped && f.startsWith('{"t":"delta"')) {
      dropped++;
      return;
    }
    send(f);
  };
  const resyncBefore = ann.resyncs;
  host.step(1); // dropped
  host.step(1); // arrives out of sequence → resync
  await waitFor(() => ann.resyncs === resyncBefore + 1);
  await stepAndSync(host, clients, 3); // host answers with a full snapshot
  assert.equal(dropped, 1);
  assert.deepStrictEqual(ann.snap, json(host.lastSnap));
  assert.equal(ann.awaitingFull, false);
  // Every felled tree is gone from the client's map too.
  for (const [tx, ty] of host.felledAll) assert.notEqual(ann.viewState.map.terrain[ty * 48 + tx], TERRAIN.FOREST);
  assert.deepEqual(new Set(ann.viewState.felledAll.map(String)), new Set(host.felledAll.map(String)));
  await stepAndSync(host, clients, 20);
  assert.deepStrictEqual(ann.snap, json(host.lastSnap));
  host.stop();
});

test('sessions: a client with a full send queue is skipped, then caught up without losing events or trees', async () => {
  const { host, clients, conns } = makeGame({ clients: 2, units: 120 });
  const [ann, ben] = clients;
  host.start();
  for (const c of clients) c.start();
  await Promise.all(clients.map((c) => c.ready));
  await stepAndSync(host, clients, 20);
  const felledSeen = (c) => c.viewState.felledAll.length;

  // Ann's link is congested: her send queue stays over the limit while the host plays on.
  conns.get(1).bufferedFn = () => MAX_CLIENT_BUFFER_BYTES + 1;
  const annTick = ann.snap.tick;
  const skippedBefore = host.netStats.skipped;
  const sentEvents = [];
  const sentFelled = [];
  const felledBefore = host.felledAll.length;
  for (let i = 0; i < 12; i++) {
    host.step(1);
    sentEvents.push(...(host.lastSnap.events || []));
    sentFelled.push(...(host.lastSnap.felled || []));
    await waitFor(() => ben.snap.tick === host.lastSnap.tick, 3000, 'ben keeps up');
  }
  await sleep(20);
  assert.equal(ann.snap.tick, annTick, 'nothing was queued for the congested client');
  assert.equal(host.netStats.skipped - skippedBefore, 12);
  assert.ok(sentEvents.length > 0 && host.felledAll.length > felledBefore, 'events and trees happened meanwhile');
  assert.equal(ann.resyncs, 0);

  // The queue drains: one delta brings her to the host's state, with everything that happened in between.
  conns.get(1).bufferedFn = null;
  const annEvents = [];
  ann.viewState.on('*', (ev) => annEvents.push(ev));
  const fulls = host.clients.get(1).fulls;
  host.step(1);
  sentEvents.push(...(host.lastSnap.events || []));
  sentFelled.push(...(host.lastSnap.felled || []));
  await waitFor(() => ann.snap.tick === host.lastSnap.tick, 3000, 'ann catches up');
  const { events: aEv, felled: aFl, ...annRest } = ann.snap;
  const { events: hEv, felled: _hFl, ...hostRest } = json(host.lastSnap);
  assert.deepStrictEqual(annRest, hostRest, 'same world state');
  assert.deepStrictEqual(aEv, json(sentEvents), 'events of the skipped ticks arrive with the catch-up, in order');
  assert.deepStrictEqual(aFl, json(sentFelled), 'and so do the felled trees');
  assert.ok(aEv.length > hEv.length, 'more than the last tick alone');
  assert.equal(ann.resyncs, 0, 'no resync was needed');
  assert.equal(host.clients.get(1).fulls, fulls, 'and no full snapshot either');
  assert.deepEqual(new Set(ann.viewState.felledAll.map(String)), new Set(host.felledAll.map(String)));
  assert.equal(felledSeen(ann), felledSeen(ben));
  assert.equal(annEvents.filter((ev) => ev.type !== 'snapshot').length >= sentEvents.length, true);
  await stepAndSync(host, clients, 5);
  for (const c of clients) assert.equal(c.resyncs, 0);
  host.stop();
});

test('sessions: a congested client that falls too far behind gets a full snapshot once its queue drains', async () => {
  const { host, clients, conns } = makeGame({ clients: 1, units: 60 });
  const [ann] = clients;
  host.start();
  await ann.ready;
  await stepAndSync(host, clients, 5);
  const c = host.clients.get(1);
  conns.get(1).bufferedFn = () => MAX_CLIENT_BUFFER_BYTES * 4;
  host.step(1);
  assert.ok(c.held, 'events are held back while the queue is full');
  host.holdSnapshot(c, { tick: 0, events: new Array(3000).fill({ type: 'levelUp', id: 1, level: 2 }), felled: [] });
  assert.equal(c.held, null);
  assert.equal(c.needsFull, true, 'too much to carry over: a full snapshot repairs it');
  const fulls = c.fulls;
  host.step(1);
  assert.equal(c.fulls, fulls, 'no full snapshot is pushed onto a congested link');
  conns.get(1).bufferedFn = null;
  await sleep(RESYNC_MIN_INTERVAL_MS + 20);
  host.step(1);
  await waitFor(() => c.fulls === fulls + 1, 2000, 'full snapshot');
  await waitFor(() => ann.snap.tick === host.lastSnap.tick, 3000, 'ann is current');
  assert.deepStrictEqual(ann.snap, json(host.lastSnap));
  host.stop();
});

test('ClientSession reports a quiet host (stalledMs) and drops the stale ping figure', async () => {
  const { host, clients } = makeGame({ clients: 1, units: 20 });
  const [ann] = clients;
  host.start();
  ann.start();
  await ann.ready;
  assert.equal(ann.stalledMs, 0);
  assert.equal(ann.stalled, false);
  await waitFor(() => ann.pingMs !== null, 2000, 'first pong');
  ann.conn.silentMs = STALL_NOTICE_MS - 1;
  assert.equal(ann.stalled, false);
  ann.conn.silentMs = STALL_NOTICE_MS + 500;
  assert.equal(ann.stalledMs, STALL_NOTICE_MS + 500);
  assert.equal(ann.stalled, true);
  ann.ping();
  assert.equal(ann.pingMs, null, 'the HUD falls back to its "…" placeholder');
  // Any frame from the host clears it; the next pong brings a fresh figure.
  host.step(1);
  await waitFor(() => ann.stalledMs === 0, 2000, 'frames resumed');
  await waitFor(() => ann.pingMs !== null, 2000, 'fresh pong');
  ann.stop();
  ann.conn.silentMs = 10000;
  assert.equal(ann.stalledMs, 0, 'a stopped session reports nothing');
  host.stop();
});

test('sessions: host quitting or vanishing ends client sessions', async () => {
  {
    const { host, clients } = makeGame({ clients: 2 });
    host.start();
    await Promise.all(clients.map((c) => c.ready));
    const ends = [];
    clients.forEach((c, i) => c.onEnd((e) => ends.push([i, e])));
    host.stop();
    await waitFor(() => ends.length === 2);
    for (const [, e] of ends) assert.deepEqual(e, { reason: 'host-quit' });
  }
  {
    const { host, clients, conns } = makeGame({ clients: 1 });
    host.start();
    await clients[0].ready;
    const ends = [];
    clients[0].onEnd((e) => ends.push(e));
    conns.get(1).rawSend = () => {}; // the host's tab dies: no 'end', no goodbye...
    conns.get(1)._closed('crash');
    clients[0].conn._closed('disconnected'); // ...the transport notices the link is gone
    await waitFor(() => ends.length === 1);
    assert.deepEqual(ends[0], { reason: 'host-left' });
    assert.equal(clients[0].stopped, true);
    host.stop();
  }
});

test('ClientSession regenerates the map and flags a mapHash mismatch', () => {
  const setup = { version: '0.1.0', seed: 777, mapSize: 'small', players: makeSetup(2).players };
  const real = generateMap({ seed: 777, mapSize: 'small', playerCount: 2 });
  const [, c1] = createLoopbackPair({ heartbeatMs: 0 });
  const ok = new ClientSession({ setup: { ...setup, mapHash: mapHash(real) }, myIndex: 1, conn: c1 });
  assert.equal(ok.mapMismatch, false);
  assert.equal(ok.mapData.width, real.width);
  assert.deepEqual(ok.mapData.terrain, real.terrain);
  const [, c2] = createLoopbackPair({ heartbeatMs: 0 });
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  const bad = new ClientSession({ setup: { ...setup, mapHash: 'deadbeef' }, myIndex: 1, conn: c2 });
  console.error = orig;
  assert.equal(bad.mapMismatch, true);
  assert.ok(errors.some((e) => /Map mismatch/.test(e)));
});

test('full flow: lobby start → sessions over the same connections', async () => {
  const lobby = await LobbyHost.create({ transport: 'loopback', name: 'Host' });
  lobby.applyPreset('ffa');
  lobby.setSlot(1, { kind: 'open' });
  lobby.setSlot(3, { kind: 'closed' });
  const ann = await LobbyClient.join({ transport: 'loopback', roomCode: lobby.roomCode, name: 'Ann' });
  let annSession = null;
  ann.onStart(({ setup, myIndex, conn }) => {
    // The client builds its session a little later (e.g. after a loading screen): nothing is lost.
    setTimeout(() => {
      annSession = new ClientSession({ setup, myIndex, conn, generateMap: fakeMap });
      annSession.start();
    }, 30);
  });
  const { setup, myIndex, conns } = lobby.start();
  setup.mapHash = undefined; // FakeWorld map, not the generated one
  const host = new HostSession({ setup, myIndex, conns, createWorld: fakeWorldFactory({ units: 50 }), autoTick: false });
  const warn = console.warn;
  console.warn = () => {}; // no createAI: warns once
  host.start();
  host.step(3);
  console.warn = warn;
  await waitFor(() => annSession && annSession.snap && annSession.snap.tick === host.lastSnap.tick);
  assert.equal(annSession.myIndex, 1);
  assert.deepStrictEqual(annSession.snap, json(host.lastSnap));
  assert.equal(annSession.resyncs, 0);
  host.stop();
});

test('single player: HostSession without connections ticks on its own with the ticker', async () => {
  const setup = makeSetup(2);
  setup.players[1].kind = 'ai';
  setup.players[1].difficulty = 'hard';
  let aiTicks = 0;
  const host = new HostSession({
    setup, myIndex: 0, createWorld: (s) => new FakeWorld(s, { units: 10 }), createAI: () => ({ tick: () => aiTicks++ }),
  });
  const snaps = [];
  host.viewState.on('snapshot', (s) => snaps.push(s.tick));
  host.start();
  await sleep(520);
  host.stop();
  const ticks = host.world.tickCount;
  assert.ok(ticks >= 6 && ticks <= 12, `~10 ticks in 0.5 s, got ${ticks}`);
  assert.equal(aiTicks, ticks);
  assert.ok(snaps.length >= 4 && snaps.at(-1) === ticks, 'snapshots pushed to the local view');
  await sleep(120);
  assert.equal(host.world.tickCount, ticks, 'stopped');
});

test('Ticker: exact rate from the clock, catch-up capped at 5 ticks', () => {
  let n = 0;
  let batches = 0;
  const t = new Ticker({ onTick: () => n++, onBatch: () => batches++, useWorker: false });
  t.start();
  t.pulse.stop(); // drive wake() by hand
  t.t0 = 0;
  assert.equal(t.wake(10), 0);
  assert.equal(t.wake(50), 1);
  assert.equal(t.wake(99), 0);
  assert.equal(t.wake(160), 2);
  assert.equal(t.wake(1000), 5, 'capped');
  assert.equal(t.dropped, 12);
  assert.equal(t.wake(1049), 0, 'dropped ticks are not owed later');
  assert.equal(t.wake(1100), 2);
  assert.equal(n, 10);
  assert.equal(batches, 4);
  t.running = false;
});
