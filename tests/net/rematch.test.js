// Online rematch and room for friends (DESIGN 7): an online lobby starts with every seat Open, friends fill the
// emptier side, Open seats do not hold up the start; after the game the host's room becomes the lobby again
// with the same players, sides and settings, each player's seat held for their rejoin token.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LobbyHost, LobbyClient } from '../../src/net/lobby.js';
import { HostSession, ClientSession } from '../../src/net/session.js';
import { createLoopbackPair, hostRoom } from '../../src/net/transport.js';
import { fakeWorldFactory, makeFakeMap } from '../../src/net/fake-world.js';
import { REASONS } from '../../src/net/protocol.js';
import { PLAYER_COLORS } from '../../src/config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}
const kinds = (state) => state.slots.map((s) => s.kind);
const join = (host, name, extra = {}) => LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name, ...extra });

test('an online lobby opens every seat on two sides; friends fill the emptier side, and an Open seat does not hold up the start', async () => {
  const host = await LobbyHost.create({ transport: 'loopback', name: 'Hosta' });
  assert.deepEqual(kinds(host.state), ['host', 'open', 'open', 'open']);
  assert.deepEqual(host.state.slots.map((s) => s.team), [1, 2, 1, 2], 'two sides, row by row');
  assert.equal(host.state.preset, null);
  assert.equal(host.state.mapSize, 'small', 'most rooms are two friends');

  const cleo = await join(host, 'Cleo');
  assert.equal(cleo.mySlot, 1, 'the first friend plays against the host');
  assert.equal(host.state.slots[1].team, 2);
  assert.equal(host.startProblem(), null, 'two Open seats left, and the game can start');

  const dax = await join(host, 'Dax');
  assert.equal(dax.mySlot, 2, 'then the host\'s side');
  assert.equal(host.state.slots[2].team, 1);
  const eve = await join(host, 'Eve');
  assert.equal(eve.mySlot, 3);
  assert.deepEqual(kinds(host.state), ['host', 'human', 'human', 'human']);

  // A fifth is turned away, and the host hears about it (once in a while, not for every knock).
  const lines = [];
  host.onChat((l) => lines.push(l));
  await assert.rejects(join(host, 'Finn'), /full/);
  await assert.rejects(join(host, 'Finn'), /full/);
  assert.equal(lines.filter((l) => l.system && /Finn tried to join/.test(l.text)).length, 1);
  host.close();
});

test('online presets leave seats Open for friends; against the computer they are AI', async () => {
  const online = await LobbyHost.create({ transport: 'loopback', name: 'Hosta' });
  assert.ok(online.applyPreset('ffa'));
  assert.deepEqual(kinds(online.state), ['host', 'open', 'open', 'open']);
  assert.ok(online.applyPreset('2v2'));
  assert.deepEqual(kinds(online.state), ['host', 'open', 'open', 'open']);
  assert.deepEqual(online.state.slots.map((s) => s.team), [1, 1, 2, 2]);
  assert.ok(online.applyPreset('1v1'));
  assert.deepEqual(kinds(online.state), ['host', 'open', 'closed', 'closed']);
  assert.ok(online.applyPreset('2v2'));
  const cleo = await join(online, 'Cleo');
  assert.equal(cleo.mySlot, 2, 'in a 2v2 the first friend still plays against the host');
  online.close();
  const solo = await LobbyHost.create({ transport: 'none', name: 'Solo' });
  assert.deepEqual(kinds(solo.state), ['host', 'ai', 'closed', 'closed'], 'a game against the computer starts 1v1');
  assert.ok(solo.applyPreset('2v2'));
  assert.deepEqual(kinds(solo.state), ['host', 'ai', 'ai', 'ai']);
  solo.close();
});

test('rematch: the room is a lobby again, each player gets their own seat back by token, strangers the others', async () => {
  const host = await LobbyHost.create({ transport: 'loopback', name: 'Hosta' });
  host.setPeace(30);
  host.setLandscape('rivers');
  const cleo = await join(host, 'Cleo');
  const dax = await join(host, 'Dax');
  assert.ok(host.setSlot(3, { kind: 'ai', difficulty: 'hard', pantheon: 'aztec' }));
  cleo.setMine({ pantheon: 'egyptian', color: 5 });
  await waitFor(() => host.state.slots[1].pantheon === 'egyptian' && host.state.slots[1].color === 5);
  const tokens = {};
  cleo.onStart((s) => (tokens.cleo = s.rejoin));
  dax.onStart((s) => (tokens.dax = s.rejoin));
  const before = host.state.slots.map((s) => ({ ...s }));
  const res = host.start();
  await waitFor(() => tokens.cleo && tokens.dax);

  // Asked before the host opens the room: "not yet", and the asker may try again.
  await assert.rejects(join(host, 'Cleo', { rematch: tokens.cleo }), (err) => err.message === REASONS.REMATCH_LATER);
  // Waiting for it: the join goes through once the host opens the room.
  const early = join(host, 'Dax', { rematch: tokens.dax, laterTries: 5 });

  for (const conn of res.conns.values()) conn.close('end'); // the game is over (its session closes these)
  assert.ok(host.reopen({ setup: res.setup, myIndex: res.myIndex, name: 'Hosta' }));
  assert.equal(host.started, false);
  assert.deepEqual(kinds(host.state), ['host', 'open', 'open', 'ai'], 'the humans\' seats are Open, held for them');
  assert.equal(host.state.peace, 30);
  assert.equal(host.state.landscape, 'rivers');
  assert.equal(host.state.slots[3].difficulty, 'hard');
  assert.equal(host.state.slots[3].pantheon, 'aztec');
  assert.equal(host.reopen(), false, 'once');

  const dax2 = await early;
  assert.equal(dax2.mySlot, 2, 'Dax back in their own seat');
  // Cleo: her seat, her pantheon and colour.
  const cleo2 = await join(host, 'Cleo', { rematch: tokens.cleo });
  assert.equal(cleo2.mySlot, 1);
  assert.equal(host.state.slots[1].pantheon, 'egyptian');
  assert.equal(host.state.slots[1].color, 5);
  assert.equal(host.state.slots[1].team, before[1].team);
  await assert.rejects(join(host, 'Finn'), /full/);
  // An old token is good once.
  assert.ok(host.kick(1));
  const again = await join(host, 'Mallory', { rematch: tokens.cleo });
  assert.equal(again.mySlot, 1, 'a used token is just a newcomer');
  assert.equal(host.state.slots[1].pantheon, 'random');

  assert.equal(host.startProblem(), null);
  const res2 = host.start();
  assert.deepEqual(res2.setup.players.map((p) => p.kind), ['human', 'human', 'human', 'ai']);
  assert.equal(res2.setup.peaceMinutes, 30);
  host.close();
});

test('rematch: a held seat goes to a stranger only when no other seat is Open', async () => {
  const host = await LobbyHost.create({ transport: 'loopback', name: 'Hosta' });
  const cleo = await join(host, 'Cleo');
  let token = null;
  cleo.onStart((s) => (token = s.rejoin));
  const res = host.start();
  await waitFor(() => token);
  assert.ok(host.reopen());
  assert.deepEqual(kinds(host.state), ['host', 'open', 'open', 'open']);
  const finn = await join(host, 'Finn');
  assert.notEqual(finn.mySlot, 1, 'Cleo\'s seat stays hers');
  const cleo2 = await join(host, 'Cleo', { rematch: token });
  assert.equal(cleo2.mySlot, 1);
  for (const conn of res.conns.values()) conn.close('end');
  host.close();
});

test('rematch in a room carried on by a new host: the seats come from the game\'s setup, the new host first', async () => {
  const ep = await hostRoom({ transport: 'loopback' });
  const setup = {
    version: '0.1.0', seed: 5, mapSize: 'medium', landscape: 'highlands', sacredVictory: true,
    players: [
      { index: 0, name: 'Old Host', team: 1, pantheon: 'greek', color: PLAYER_COLORS[0], kind: 'human', difficulty: null },
      { index: 1, name: 'Cleo', team: 2, pantheon: 'norse', color: PLAYER_COLORS[1], kind: 'human', difficulty: null },
      { index: 2, name: 'AI (Easy)', team: 2, pantheon: 'celtic', color: PLAYER_COLORS[2], kind: 'ai', difficulty: 'easy' },
    ],
  };
  const tokens = new Map([[0, 'aa'.repeat(16)], [1, 'bb'.repeat(16)]]);
  const lobby = LobbyHost.forGame(ep, { transport: 'loopback', tokens });
  assert.ok(lobby.reopen({ setup, myIndex: 1, name: 'Cleo' }));
  const s = lobby.state;
  assert.deepEqual(kinds(s), ['host', 'open', 'ai', 'closed']);
  assert.equal(s.slots[0].name, 'Cleo');
  assert.equal(s.slots[0].team, 2);
  assert.equal(s.slots[0].color, 1);
  assert.equal(s.slots[1].team, 1, 'the old host\'s seat, held');
  assert.equal(s.slots[2].difficulty, 'easy');
  assert.deepEqual([s.mapSize, s.landscape, s.sacred, s.peace, s.survival], ['medium', 'highlands', true, 0, false]);
  const old = await LobbyClient.join({ transport: 'loopback', roomCode: lobby.roomCode, name: 'Old Host', rematch: tokens.get(0) });
  assert.equal(old.mySlot, 1);
  assert.equal(lobby.state.slots[1].pantheon, 'greek');
  assert.equal(lobby.startProblem(), null);
  lobby.close();
});

// ---------------------------------------------------------------- the game sessions

function makeGame() {
  const players = ['Hosta', 'Cleo'].map((name, index) => ({ index, name, team: index + 1, pantheon: 'greek', color: PLAYER_COLORS[index], kind: 'human', difficulty: null }));
  const setup = { version: '0.1.0', seed: 7, mapSize: 'small', players };
  const [hostSide, clientSide] = createLoopbackPair();
  const client = new ClientSession({ setup, myIndex: 1, conn: clientSide, generateMap: () => makeFakeMap(48, 48), pingIntervalMs: 20 });
  const host = new HostSession({ setup, myIndex: 0, conns: new Map([[1, hostSide]]), createWorld: fakeWorldFactory({ units: 4, buildings: 1, churn: 0, gameOverTick: 3 }), createAI: () => ({ tick() {} }), autoTick: false });
  return { host, client };
}

test('rematch on the wire: a client asks once the game is over, the host says where its room is', async () => {
  const { host, client } = makeGame();
  host.start();
  client.start();
  await client.ready;
  const hostHeard = [];
  const chat = [];
  host.onRematch((i) => hostHeard.push(i));
  host.onChat((l) => chat.push(l));
  const clientHeard = [];
  client.onRematch((i) => clientHeard.push(i));

  assert.equal(client.askRematch(), false, 'not while the game is played');
  assert.equal(host.inviteRematch('ABCDE'), false);
  host.step(4);
  await waitFor(() => client.snap && client.snap.gameOver, 3000, 'game over at the client');
  assert.equal(client.askRematch(), true);
  assert.equal(client.askRematch(), false, 'once');
  await waitFor(() => hostHeard.length === 1, 3000, 'the ask');
  assert.deepEqual(hostHeard[0], { from: 1, name: 'Cleo' });
  assert.ok(chat.some((l) => l.system && l.text === 'Cleo wants a rematch.'));

  assert.equal(host.inviteRematch('ABCDE'), true);
  const ends = [];
  client.onEnd((e) => ends.push(e));
  host.stop();
  await waitFor(() => ends.length === 1, 3000, 'the end');
  assert.deepEqual(clientHeard, [{ room: 'ABCDE' }], 'the room arrives before the end');
  assert.equal(client.rematchRoom, 'ABCDE');
});

test('rematch on the wire: a host cannot send a client to a room before the game is over, nor to junk', async () => {
  const { host, client } = makeGame();
  host.start();
  client.start();
  await client.ready;
  const heard = [];
  client.onRematch((i) => heard.push(i));
  for (const c of host.clients.values()) c.conn.send({ t: 'rematch', room: 'ABCDE' });
  host.step(4);
  await waitFor(() => client.snap && client.snap.gameOver);
  for (const c of host.clients.values()) c.conn.send({ t: 'rematch', room: { evil: 1 } });
  for (const c of host.clients.values()) c.conn.send({ t: 'rematch', room: 'AB' });
  await sleep(30);
  assert.deepEqual(heard, []);
  assert.equal(client.rematchRoom, undefined);
  host.stop();
});
