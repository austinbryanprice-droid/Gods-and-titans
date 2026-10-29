// Host migration and online pauses (DESIGN 7): the host keeps an heir ready (plan to everyone, the game to
// the heir); when the host goes, the heir opens the planned room from its copy and the others follow with
// their rejoin tokens; a host who quits through the menu hands over a fresh copy first. Pauses: a few per
// player, anyone may resume, and they end by themselves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession, ClientSession } from '../../src/net/session.js';
import { LobbyHost, LobbyClient } from '../../src/net/lobby.js';
import { MSG, REASONS, ONLINE_PAUSES, PAUSE_MAX_MS, makeRoomCode } from '../../src/net/protocol.js';
import { createLoopbackPair } from '../../src/net/transport.js';
import { fakeWorldFactory, makeFakeMap } from '../../src/net/fake-world.js';
import { encodeState, decodeState, sanitizePlan, sanitizeHandoff, takeOver, followHeir, reachHost } from '../../src/net/handoff.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}
const fakeMap = () => makeFakeMap(48, 48);

function setupWith(kinds) {
  const players = kinds.map((k, i) => ({
    index: i, name: ['Host', 'Ann', 'Ben', 'Cy'][i], team: i < 2 ? 1 : 2, pantheon: 'greek', color: '#d63a3a',
    kind: k === 'human' ? 'human' : 'ai', difficulty: k === 'human' ? null : k,
  }));
  return { version: '0.1.0', seed: 7, mapSize: 'small', players };
}

const fakeAI = (calls) => (world, index, difficulty) => {
  const ai = { index, difficulty, ticks: 0, tick() { this.ticks++; } };
  calls.push(ai);
  return ai;
};

/** The game as a backup: the fake world's tick (enough to tell which copy a new host was built from). */
const packFake = (world) => encodeState(JSON.stringify({ tick: world.tickCount }));

function makeGame(setup, { tokens = null } = {}) {
  const aiCalls = [];
  const conns = new Map();
  const clients = new Map();
  for (const p of setup.players) {
    if (p.kind !== 'human' || p.index === 0) continue;
    const [hostSide, clientSide] = createLoopbackPair();
    conns.set(p.index, hostSide);
    clients.set(p.index, new ClientSession({ setup, myIndex: p.index, conn: clientSide, generateMap: fakeMap, pingIntervalMs: 20 }));
  }
  const host = new HostSession({ setup, myIndex: 0, conns, createWorld: fakeWorldFactory({ units: 30, buildings: 2 }), createAI: fakeAI(aiCalls), autoTick: false });
  const toks = tokens || new Map(setup.players.filter((p) => p.kind === 'human').map((p) => [p.index, `${p.index}`.repeat(8).padEnd(32, 'a')]));
  const room = makeRoomCode();
  host.enableHandoff({ room, tokens: toks, pack: packFake });
  return { host, clients, aiCalls, room, tokens: toks };
}

test('handoff: the state travels compressed and comes back the same; plans and backups are checked', async () => {
  const text = JSON.stringify({ a: 'x'.repeat(5000), n: [1, 2, 3] });
  const gz = await encodeState(text);
  assert.equal(gz.enc, 'gz');
  assert.ok(gz.data.length < text.length / 5, 'gzip makes it much smaller');
  assert.equal(await decodeState(gz), text);
  assert.equal(await decodeState(await encodeState(text, { compress: false })), text);
  await assert.rejects(decodeState({ enc: 'zip', data: '' }));

  const setup = setupWith(['human', 'human', 'hard']);
  const code = makeRoomCode();
  assert.deepEqual(sanitizePlan({ heir: 1, room: code.toLowerCase(), host: 0 }, setup), { heir: 1, room: code, host: 0, at: null, proof: null });
  assert.equal(sanitizePlan({ heir: 1, room: code, proof: 'ef'.repeat(16) }, setup).proof, 'ef'.repeat(16));
  assert.equal(sanitizePlan({ heir: 1, room: code, proof: 'not hex' }, setup).proof, null);
  assert.equal(sanitizePlan({ heir: 1, room: code, at: 'zz' }, setup).at, null);
  assert.equal(sanitizePlan({ heir: 1, room: code, host: 1 }, setup).host, -1);
  assert.equal(sanitizePlan({ heir: 2, room: code }, setup), null, 'a computer player is never the heir');
  assert.equal(sanitizePlan({ heir: 1, room: '??' }, setup), null);
  const b = sanitizeHandoff({ room: code, tick: 40, state: gz, tokens: { 0: 'ab'.repeat(16), 1: 'not hex!', 2: 'cd'.repeat(16) }, present: [0, 1, 1, 2, 9] }, setup);
  assert.deepEqual([...b.tokens], [[0, 'ab'.repeat(16)]], 'only humans, only real tokens');
  assert.deepEqual(b.present, [0, 1]);
  assert.equal(sanitizeHandoff({ room: code, tick: -1, state: gz }, setup), null);
  assert.equal(sanitizeHandoff({ room: code, tick: 1, state: { enc: 'gz', data: 5 } }, setup), null);
});

test('handoff: the host names the lowest connected player still playing as heir and sends them the game', async () => {
  const setup = setupWith(['human', 'human', 'human', 'hard']);
  const { host, clients, room } = makeGame(setup);
  const ann = clients.get(1);
  const ben = clients.get(2);
  host.start();
  ann.start();
  ben.start();
  await ann.ready;
  await ben.ready;
  const { proof: annProof, ...annPlan } = ann.plan;
  const { proof: benProof, ...benPlan } = ben.plan;
  assert.deepEqual(annPlan, { heir: 1, room, host: 0, at: null });
  assert.deepEqual(benPlan, { heir: 1, room, host: 0, at: null });
  assert.ok(annProof && benProof && annProof !== benProof, 'each player hears only their own seat\'s proof');
  assert.equal(host.canHandOff, false, 'no copy sent yet');
  await host.backup(true);
  await waitFor(() => ann.backup, 2000, 'backup at the heir');
  assert.equal(ben.backup, null, 'only the heir gets the game');
  assert.equal(ann.backup.room, room);
  assert.deepEqual(ann.backup.present.sort(), [0, 1, 2]);
  assert.equal(ann.backup.tokens.size, 3);
  assert.deepEqual([...ann.backup.proofs].sort(), [[1, annProof], [2, benProof]], 'the heir gets every seat\'s proof');
  assert.equal(JSON.parse(await decodeState(ann.backup.state)).tick, host.world.tickCount);
  assert.equal(host.canHandOff, true);

  // Ann drops: Ben is the heir now.
  ann.stop();
  await waitFor(() => ben.plan && ben.plan.heir === 2, 2000, 'new plan');
  assert.equal(host.heir, 2);
  host.stop();
});

test('handoff: when the host vanishes, the heir carries the game on and the others follow with their tokens', async () => {
  const setup = setupWith(['human', 'human', 'human', 'hard']);
  const { host, clients, room, tokens } = makeGame(setup);
  const ann = clients.get(1);
  const ben = clients.get(2);
  host.start();
  ann.start();
  ben.start();
  await ben.ready;
  host.pausesLeft.set(2, 1); // Ben has paused twice
  host.step(6);
  await host.backup(true);
  await waitFor(() => ann.backup && ann.backup.tick === host.world.tickCount, 2000, 'backup');
  assert.equal(ann.backup.pauses.get(2), 1);
  const savedTick = host.world.tickCount;
  host.step(6); // play the backup never saw

  const ends = new Map();
  ann.onEnd((info) => ends.set(1, info));
  ben.onEnd((info) => ends.set(2, info));
  // The host's tab closes: its links simply go.
  host.stopped = true;
  host.ticker.stop();
  for (const c of host.clients.values()) c.conn.close('gone');
  await waitFor(() => ends.size === 2, 2000, 'both ends');
  assert.equal(ends.get(1).reason, REASONS.HOST_LEFT);
  assert.deepEqual({ ...ends.get(1).handoff.plan, proof: null }, { heir: 1, room, host: 0, at: null, proof: null });
  assert.ok(ends.get(1).handoff.backup, 'the heir has the game');
  assert.equal(ends.get(2).handoff.backup, null, 'the others only know where to go');

  // Ann takes over from her copy.
  const aiCalls = [];
  let built = null;
  const { session: annHost, lobby } = await takeOver({
    plan: ends.get(1).handoff.plan, backup: ends.get(1).handoff.backup, transport: 'loopback',
    makeSession: (save) => {
      built = save;
      return new HostSession({ setup, myIndex: 1, createWorld: fakeWorldFactory({ units: 30, buildings: 2 }), createAI: fakeAI(aiCalls), autoTick: false, viewState: ann.viewState });
    },
  });
  assert.equal(built.tick, savedTick, 'built from the newest copy');
  assert.equal(annHost.pausesLeft.get(2), 1, 'pauses used stay used with the new host');
  assert.equal(annHost.viewState, ann.viewState, 'shown in the view the player already has');
  assert.deepEqual([...annHost.standIns].sort(), [0, 2], 'AIs hold the absent seats');
  annHost.enableHandoff({ room: makeRoomCode(), tokens, pack: packFake }); // ready to move on again
  annHost.start();
  assert.equal(annHost.pause && annHost.pause.reason, 'handoff', 'waits for Ben, paused');
  assert.deepEqual([...annHost.waiting], [2], 'not for the host who left');

  // Ben follows: the room may take a moment to open, so he tries again.
  const info = await followHeir({ plan: ends.get(2).handoff.plan, token: tokens.get(2), name: 'Ben', transport: 'loopback', retryMs: 20, timeoutMs: 3000 });
  assert.equal(info.myIndex, 2);
  const ben2 = new ClientSession({ setup: info.setup, myIndex: 2, conn: info.conn, generateMap: fakeMap, pingIntervalMs: 20, viewState: ben.viewState });
  ben2.start();
  await ben2.ready;
  await waitFor(() => !annHost.pause, 2000, 'game goes on once Ben is back');
  assert.ok(!annHost.standIns.has(2), 'Ben has his seat back');
  assert.ok(annHost.standIns.has(0), 'the old host is still played by an AI');
  await waitFor(() => ben2.pause === null && ben2.plan && ben2.plan.heir === 2, 2000, 'Ben hears the new plan');
  assert.equal(annHost.heir, 2, 'and Ben is next in line');

  // The old host can come back as a player with its own token.
  const back = await LobbyClient.rejoin({ transport: 'loopback', roomCode: room, token: tokens.get(0), name: 'Host' });
  assert.equal(back.myIndex, 0);
  await waitFor(() => !annHost.standIns.has(0), 2000, 'the old host takes its seat back');
  back.conn.close('done');
  ben2.stop();
  annHost.stop();
  lobby.close();
});

test('handoff: a host quitting through the menu sends a fresh copy first, then the game goes on', async () => {
  const setup = setupWith(['human', 'human', 'hard']);
  const { host, clients } = makeGame(setup);
  const ann = clients.get(1);
  host.start();
  ann.start();
  await ann.ready;
  await host.backup(true);
  await waitFor(() => ann.backup, 2000, 'first backup');
  host.step(9);
  const tick = host.world.tickCount;
  let end = null;
  ann.onEnd((info) => (end = info));
  assert.equal(await host.handOff(), true);
  await waitFor(() => end, 2000, 'end');
  assert.equal(end.reason, REASONS.HOST_QUIT);
  assert.equal(end.handoff.backup.tick, tick, 'the copy is as the host left it');
});

test('handoff: a host quitting while a backup is still compressing waits for it and still hands over', async () => {
  const setup = setupWith(['human', 'human', 'hard']);
  const { host, clients } = makeGame(setup);
  const ann = clients.get(1);
  host.start();
  ann.start();
  await ann.ready;
  await host.backup(true);
  let release;
  const slow = new Promise((r) => (release = r));
  host.handoff.pack = (world) => slow.then(() => packFake(world));
  host.step(3);
  const inFlight = host.backup(true); // compressing...
  assert.ok(host.handoff.busy);
  let end = null;
  ann.onEnd((info) => (end = info));
  const quitting = host.handOff();
  setTimeout(release, 20);
  await inFlight;
  await quitting;
  await waitFor(() => end, 2000, 'end');
  assert.ok(end.handoff, 'the game goes on with the heir');
  assert.equal(end.handoff.backup.tick, host.world.tickCount);
});

test('handoff: a player whose own link dropped finds the host still there and simply rejoins', async () => {
  const lobby = await LobbyHost.create({ transport: 'loopback', name: 'Host' });
  const ann = await LobbyClient.join({ transport: 'loopback', roomCode: lobby.roomCode, name: 'Ann' });
  const starts = [];
  ann.onStart((i) => starts.push(i));
  const res = lobby.start();
  await waitFor(() => starts.length === 1, 2000, 'start');
  const host = new HostSession({ setup: res.setup, myIndex: res.myIndex, conns: res.conns, createWorld: fakeWorldFactory({ units: 10 }), createAI: () => ({ tick() {} }), autoTick: false });
  lobby.setRejoinHandler((i, conn) => host.rejoin(i, conn));
  host.enableHandoff({ room: makeRoomCode(), here: lobby.roomCode, tokens: lobby.gameTokens(), pack: packFake });
  host.start();
  const client = new ClientSession({ setup: { ...starts[0].setup, mapHash: undefined }, myIndex: starts[0].myIndex, conn: starts[0].conn, generateMap: fakeMap, pingIntervalMs: 20 });
  client.start();
  await client.ready;
  await waitFor(() => client.plan, 2000, 'plan');
  assert.equal(client.plan.at, lobby.roomCode, 'the plan says where the game is now');
  res.conns.get(starts[0].myIndex).close('lost'); // only Ann's link goes
  await waitFor(() => host.standIns.has(starts[0].myIndex), 2000, 'stand-in');
  const back = await reachHost({ plan: client.plan, token: starts[0].rejoin, name: 'Ann', transport: 'loopback' });
  assert.ok(back && back.myIndex === starts[0].myIndex, 'the host takes Ann back: no takeover');
  await waitFor(() => !host.standIns.has(starts[0].myIndex), 2000, 'seat back');
  back.conn.close('done');
  host.stop();
  lobby.close();
  await sleep(400);
  assert.equal(await reachHost({ plan: client.plan, token: starts[0].rejoin, name: 'Ann', transport: 'loopback', timeoutMs: 500 }), null, 'gone host: carry on');
});

test('handoff: nothing to carry on after the game is over, or without a copy', async () => {
  const setup = setupWith(['human', 'human', 'hard']);
  const { host, clients } = makeGame(setup);
  const ann = clients.get(1);
  host.start();
  ann.start();
  await ann.ready;
  let end = null;
  ann.onEnd((info) => (end = info));
  host.stop();
  await waitFor(() => end, 2000, 'end');
  assert.deepEqual(end, { reason: REASONS.HOST_QUIT }, 'the heir has no copy yet: the game ends as before');
});

test('pause: a player pauses for everyone a few times a game, anyone resumes, commands wait', async () => {
  const setup = setupWith(['human', 'human', 'hard']);
  const { host, clients } = makeGame(setup);
  const ann = clients.get(1);
  host.start();
  ann.start();
  await ann.ready;
  const lines = [];
  ann.onChat((l) => lines.push(l.text));
  const seen = [];
  ann.onPause((p) => seen.push(p && { ...p }));

  ann.sendPause(true);
  await waitFor(() => host.pause, 2000, 'paused');
  assert.equal(host.pause.by, 1);
  assert.equal(host.pause.left, ONLINE_PAUSES - 1);
  await waitFor(() => ann.pause, 2000, 'client hears');
  assert.equal(ann.pause.by, 1);
  assert.ok(ann.pause.endsAt > performance.now() + 60000, 'it says when it ends');
  await waitFor(() => lines.some((t) => /Ann paused the game \(2 pauses left\)/.test(t)), 2000, 'chat line');

  const before = host.world.commands ? host.world.commands.length : 0;
  host.sendCommand({ type: 'stop', units: [1] });
  assert.equal(host.world.commands ? host.world.commands.length : 0, before, 'no orders while paused');

  assert.equal(host.sendPause(false), true, 'the host resumes Ann\'s pause');
  await waitFor(() => ann.pause === null, 2000, 'resumed');
  assert.ok(seen.length >= 2 && seen.at(-1) === null);

  for (let i = 0; i < ONLINE_PAUSES - 1; i++) {
    ann.sendPause(true);
    await waitFor(() => host.pause, 2000, 'paused again');
    host.sendPause(false);
  }
  ann.sendPause(true);
  await waitFor(() => lines.some((t) => /no pauses left/.test(t)), 3000, 'refused');
  assert.equal(host.pause, null);
  host.stop();
});

test('pause: a rejoining player hears the pause, and a pause ends by itself', async (t) => {
  const setup = setupWith(['human', 'human', 'hard']);
  const { host } = makeGame(setup);
  host.start();
  assert.equal(host.sendPause(true), true);
  assert.equal(host.sendPause(true), false, 'already paused');
  const [hostSide, clientSide] = createLoopbackPair();
  const seen = [];
  clientSide.onMessage((m) => seen.push(m));
  host.rejoin(1, hostSide);
  await waitFor(() => seen.some((m) => m.t === MSG.PAUSE && m.on && m.by === 0), 2000, 'pause told');
  host.sendPause(false);

  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    host.sendPause(true);
    t.mock.timers.tick(PAUSE_MAX_MS - 10);
    assert.ok(host.pause, 'still paused');
    t.mock.timers.tick(20);
    assert.equal(host.pause, null, 'ended by itself');
  } finally {
    t.mock.timers.reset();
  }
  host.stop();
});

test('handoff: a player sitting on the planned room cannot pass for the heir', async () => {
  const setup = setupWith(['human', 'human', 'human', 'hard']);
  const { host, clients, room, tokens } = makeGame(setup);
  const ben = clients.get(2);
  host.start();
  clients.get(1).start();
  ben.start();
  await ben.ready;
  const plan = ben.plan;
  assert.ok(plan.proof);
  // Ann (not playing fair) opens the room the plan names before the heir would, and answers like a host.
  const { hostRoom } = await import('../../src/net/transport.js');
  const ep = await hostRoom({ transport: 'loopback', roomCode: room });
  const fake = LobbyHost.forGame(ep, { transport: 'loopback', tokens });
  fake.setRejoinHandler((index, conn) => {
    conn.send({ t: MSG.START, setup, you: index, rejoin: true });
    return null;
  });
  host.stop();
  await assert.rejects(followHeir({ plan, token: tokens.get(2), name: 'Ben', transport: 'loopback', retryMs: 20, timeoutMs: 1000 }), (err) => err.message === REASONS.NOT_HOST);
  // The host's own `start` carries the proof (a player reaching the host again checks it too).
  await assert.rejects(reachHost({ plan: { ...plan, at: room }, token: tokens.get(2), name: 'Ben', transport: 'loopback', timeoutMs: 500 }).then((r) => {
    if (!r) throw new Error('no host');
    return r;
  }));
  fake.close();
});

test('lobby: the host gets a token too, and a carried-on game seats players by theirs', async () => {
  const lobby = await LobbyHost.create({ transport: 'loopback', name: 'Host' });
  const client = await LobbyClient.join({ transport: 'loopback', roomCode: lobby.roomCode, name: 'Ann' });
  const res = lobby.start();
  const tokens = lobby.gameTokens();
  assert.ok(lobby.hostToken && tokens.get(res.myIndex) === lobby.hostToken);
  assert.equal(tokens.size, 2);
  lobby.close();
  client.conn.close('x');
});

test('lobby: a player who reaches a carried-on room as it opens is seated by token', async () => {
  const { hostRoom, joinRoom } = await import('../../src/net/transport.js');
  const ep = await hostRoom({ transport: 'loopback', roomCode: makeRoomCode() });
  const conn = await joinRoom({ transport: 'loopback', roomCode: ep.roomCode }); // waits in the room before the lobby is there
  await waitFor(() => ep.pending.length === 1, 2000, 'the link waiting in the room');
  const token = 'ab'.repeat(16);
  const lobby = LobbyHost.forGame(ep, { transport: 'loopback', tokens: new Map([[1, token]]) });
  const seated = [];
  lobby.setRejoinHandler((index) => {
    seated.push(index);
    return null;
  });
  conn.send({ t: MSG.HELLO, name: 'Ann', version: lobby.version, rejoin: token });
  await waitFor(() => seated.length, 2000, 'seated');
  assert.deepEqual(seated, [1]);
  lobby.close();
  conn.close('x');
});
