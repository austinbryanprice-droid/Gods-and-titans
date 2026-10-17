import test from 'node:test';
import assert from 'node:assert/strict';
import { LobbyHost, LobbyClient, buildSetup, resolvePantheons } from '../../src/net/lobby.js';
import { PANTHEONS } from '../../src/data/index.js';
import { PLAYER_COLORS, GAME_VERSION } from '../../src/config.js';
import { generateMap, mapHash } from '../../src/sim/mapgen.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 2000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(2);
  }
}
const kinds = (state) => state.slots.map((s) => s.kind);

test('lobby flow: join, presets, setMine, chat, kick on version mismatch, start', async () => {
  const host = await LobbyHost.create({ transport: 'loopback', name: 'Austin' });
  assert.match(host.roomCode, /^[A-Z2-9]{5}$/);
  assert.deepEqual(kinds(host.state), ['host', 'open', 'closed', 'closed'], 'default 1v1 online');
  assert.equal(host.state.mapSize, 'small');
  assert.equal(host.canStart(), false, 'only one team so far');

  const hostChat = [];
  host.onChat((l) => hostChat.push(l));
  let changes = 0;
  host.onChange(() => changes++);

  const bob = await LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name: 'Bob' });
  assert.equal(bob.mySlot, 1);
  assert.equal(host.state.slots[1].kind, 'human');
  assert.equal(host.state.slots[1].name, 'Bob');
  assert.notEqual(host.state.slots[1].color, host.state.slots[0].color);
  assert.ok(changes > 0);
  await waitFor(() => hostChat.some((l) => l.system && /Bob joined/.test(l.text)));
  assert.equal(host.canStart(), true, 'host team 1 vs Bob team 2');

  // Lobby is full in 1v1.
  await assert.rejects(LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name: 'Cara' }), /full/);

  // Version check in hello.
  await assert.rejects(
    LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name: 'Old', version: '0.0.1' }),
    (err) => /Version mismatch/.test(err.message) && err.message.includes(GAME_VERSION) && err.message.includes('0.0.1'),
  );
  assert.deepEqual(kinds(host.state), ['host', 'human', 'closed', 'closed']);

  // Presets keep connected players and fill the rest.
  assert.ok(host.applyPreset('coop'));
  assert.deepEqual(kinds(host.state), ['host', 'human', 'ai', 'ai']);
  assert.deepEqual(host.state.slots.map((s) => s.team), [1, 1, 2, 2]);
  assert.equal(host.state.mapSize, 'medium');
  assert.ok(host.applyPreset('ffa'));
  assert.deepEqual(host.state.slots.map((s) => s.team), [1, 2, 3, 4]);
  assert.ok(host.applyPreset('2v2'));
  assert.deepEqual(host.state.slots.map((s) => s.team), [1, 1, 2, 2]);
  assert.equal(new Set(host.state.slots.map((s) => s.color)).size, 4, 'colors stay unique');
  assert.equal(host.state.slots[2].name, 'AI (Normal)');

  // Open a slot for a third player.
  assert.ok(host.setSlot(2, { kind: 'open' }));
  const cara = await LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name: 'Bob' });
  assert.equal(cara.mySlot, 2);
  assert.equal(host.state.slots[2].name, 'Bob (2)', 'duplicate names are made unique');

  // setMine changes only the sender's slot; everyone sees it.
  bob.setMine({ pantheon: 'norse', team: 2, color: 5 });
  await waitFor(() => cara.state.slots[1].pantheon === 'norse');
  assert.equal(host.state.slots[1].team, 2);
  assert.equal(host.state.slots[1].color, 5);
  assert.equal(bob.state.slots[1].color, 5);
  cara.setMine({ color: 5, pantheon: 'not-a-pantheon', team: 9 }); // all invalid / taken
  cara.setMine({ pantheon: 'egyptian' });
  await waitFor(() => host.state.slots[2].pantheon === 'egyptian');
  assert.notEqual(host.state.slots[2].color, 5);
  assert.equal(host.state.slots[2].team, 2);

  // Host-only settings.
  assert.ok(host.setSlot(3, { difficulty: 'hard', pantheon: 'aztec' }));
  assert.equal(host.state.slots[3].name, 'AI (Hard)');
  assert.ok(host.setSlot(0, { pantheon: 'greek', name: 'Austin P' }));
  assert.ok(host.setMapSize('small'));
  await waitFor(() => bob.state.mapSize === 'small' && bob.state.slots[3].difficulty === 'hard');

  // Chat reaches everyone, with the sender's slot and name.
  const bobChat = [];
  const caraChat = [];
  bob.onChat((l) => bobChat.push(l));
  cara.onChat((l) => caraChat.push(l));
  bob.sendChat('  hello gods  ');
  host.sendChat('welcome');
  await waitFor(() => caraChat.length >= 2);
  assert.deepEqual(caraChat.find((l) => l.from === 1), { from: 1, name: 'Bob', text: 'hello gods', system: false });
  assert.deepEqual(caraChat.find((l) => l.from === 0), { from: 0, name: 'Austin P', text: 'welcome', system: false });
  assert.ok(hostChat.some((l) => l.text === 'hello gods'));
  assert.ok(bobChat.some((l) => l.text === 'welcome'));

  // Start: every client gets the same setup and its own index.
  assert.equal(host.canStart(), true);
  const starts = [];
  bob.onStart((s) => starts.push(['bob', s]));
  cara.onStart((s) => starts.push(['cara', s]));
  const res = host.start();
  assert.equal(res.myIndex, 0);
  assert.deepEqual([...res.conns.keys()].sort(), [1, 2]);
  await waitFor(() => starts.length === 2);
  const setup = res.setup;
  for (const [, s] of starts) assert.deepEqual(s.setup, setup);
  assert.equal(starts.find(([n]) => n === 'bob')[1].myIndex, 1);
  assert.equal(starts.find(([n]) => n === 'cara')[1].myIndex, 2);
  assert.equal(setup.version, GAME_VERSION);
  assert.equal(setup.mapSize, 'small');
  assert.equal(setup.players.length, 4);
  assert.deepEqual(setup.players.map((p) => p.index), [0, 1, 2, 3]);
  assert.deepEqual(setup.players.map((p) => p.kind), ['human', 'human', 'human', 'ai']);
  assert.deepEqual(setup.players.map((p) => p.team), [1, 2, 2, 2]);
  assert.equal(setup.players[0].pantheon, 'greek');
  assert.equal(setup.players[1].pantheon, 'norse');
  assert.equal(setup.players[3].difficulty, 'hard');
  assert.equal(setup.players[0].difficulty, null);
  assert.equal(setup.players[1].color, PLAYER_COLORS[5]);
  for (const p of setup.players) assert.ok(PANTHEONS[p.pantheon], `resolved pantheon ${p.pantheon}`);
  assert.ok(Number.isInteger(setup.seed) && setup.seed > 0);
  assert.equal(setup.mapHash, mapHash(generateMap({ seed: setup.seed, mapSize: setup.mapSize, playerCount: 4 })));
  assert.equal(starts[0][1].conn, bob.conn);

  // Late joiners are turned away.
  await assert.rejects(LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name: 'Late' }), /already started/);
  for (const c of res.conns.values()) c.close();
});

test('two lobbies get different seeds; random pantheons are resolved from the seed', () => {
  const state = {
    mapSize: 'small',
    slots: [
      { kind: 'host', name: 'A', pantheon: 'random', team: 1, color: 0, difficulty: 'normal' },
      { kind: 'closed', name: '', pantheon: 'random', team: 2, color: 1, difficulty: 'normal' },
      { kind: 'ai', name: 'AI (Easy)', pantheon: 'random', team: 2, color: 2, difficulty: 'easy' },
      { kind: 'open', name: '', pantheon: 'random', team: 2, color: 3, difficulty: 'normal' },
    ],
  };
  const a = buildSetup(state, 1234).setup;
  const b = buildSetup(state, 1234).setup;
  assert.deepEqual(a, b, 'same seed → same resolution');
  assert.equal(a.players.length, 2, 'closed and open slots are skipped');
  assert.deepEqual(a.players.map((p) => p.index), [0, 1]);
  assert.equal(a.players[1].kind, 'ai');
  assert.equal(a.players[1].color, PLAYER_COLORS[2]);
  assert.notEqual(a.players[0].pantheon, a.players[1].pantheon, 'random picks avoid duplicates');
  const seen = new Set();
  for (let s = 1; s < 60; s++) seen.add(resolvePantheons(state.slots.slice(0, 1), s)[0]);
  assert.ok(seen.size >= 6, 'random really varies with the seed');
});

test('offline lobby: 1v1 vs AI by default, coop adds an AI ally, start without connections', async () => {
  const host = await LobbyHost.create({ transport: 'none', name: 'Solo' });
  assert.equal(host.roomCode, null);
  assert.deepEqual(kinds(host.state), ['host', 'ai', 'closed', 'closed']);
  assert.ok(host.canStart());
  assert.ok(host.applyPreset('coop'));
  assert.deepEqual(kinds(host.state), ['host', 'ai', 'ai', 'ai']);
  assert.deepEqual(host.state.slots.map((s) => s.team), [1, 1, 2, 2]);
  host.setSlot(1, { kind: 'closed' });
  const { setup, myIndex, conns } = host.start();
  assert.equal(myIndex, 0);
  assert.equal(conns.size, 0);
  assert.equal(setup.players.length, 3);
  assert.deepEqual(setup.players.map((p) => p.team), [1, 2, 2]);
});

test('leaving frees the slot; kicking and closing the lobby notify clients', async () => {
  const host = await LobbyHost.create({ transport: 'loopback', name: 'H' });
  host.applyPreset('ffa');
  host.setSlot(1, { kind: 'open' });
  host.setSlot(2, { kind: 'open' });
  const a = await LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name: 'A' });
  const b = await LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name: 'B' });
  const c = await LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name: 'C' }).catch((e) => e);
  assert.ok(c instanceof Error, 'slot 3 is an AI, so the lobby is full');
  assert.deepEqual(kinds(host.state), ['host', 'human', 'human', 'ai']);

  a.leave();
  await waitFor(() => host.state.slots[1].kind === 'open');
  await waitFor(() => b.state.slots[1].kind === 'open');

  const kicked = [];
  b.onKicked((r) => kicked.push(r));
  assert.ok(host.kick(2));
  await waitFor(() => kicked.length === 1);
  assert.match(kicked[0], /removed/);
  assert.equal(host.state.slots[2].kind, 'open');

  const d = await LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name: 'D' });
  const dk = [];
  d.onKicked((r) => dk.push(r));
  host.close();
  await waitFor(() => dk.length === 1);
  assert.match(dk[0], /closed the lobby/);
});

test('start needs two teams and connected humans', async () => {
  const host = await LobbyHost.create({ transport: 'loopback', name: 'H' });
  const a = await LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name: 'A' });
  host.setSlot(1, {}); // no-op
  a.setMine({ team: 1 });
  await waitFor(() => host.state.slots[1].team === 1);
  assert.equal(host.canStart(), false);
  assert.match(host.startProblem(), /two different teams/);
  assert.throws(() => host.start(), /two different teams/);
  a.setMine({ team: 3 });
  await waitFor(() => host.state.slots[1].team === 3);
  assert.equal(host.canStart(), true);
  a.conn.close();
  await waitFor(() => host.state.slots[1].kind === 'open');
  assert.equal(host.canStart(), false);
  host.close();
});

test('lobby caps connections waiting to say HELLO; joined players still join, leave and rejoin', async () => {
  const { joinRoom } = await import('../../src/net/transport.js');
  const { MSG, REASONS } = await import('../../src/net/protocol.js');
  const { MAX_WAITING_MEMBERS } = await import('../../src/net/lobby.js');
  const host = await LobbyHost.create({ transport: 'loopback', name: 'Host' });

  // Connections that open but never say HELLO (what a connection-flood looks like).
  const waiters = [];
  for (let i = 0; i < MAX_WAITING_MEMBERS; i++) {
    waiters.push(await joinRoom({ transport: 'loopback', roomCode: host.roomCode }));
  }
  await waitFor(() => host.members.size === MAX_WAITING_MEMBERS, 2000, 'waiters accepted');

  // One more is turned away at once with BUSY and becomes no member (no timer / limiters held).
  const extra = await joinRoom({ transport: 'loopback', roomCode: host.roomCode });
  const extraMsgs = [];
  let extraClosed = false;
  extra.onMessage((m) => extraMsgs.push(m));
  extra.onClose(() => { extraClosed = true; });
  await waitFor(() => extraMsgs.some((m) => m.t === MSG.KICK && m.reason === REASONS.BUSY), 2000, 'busy kick');
  await waitFor(() => extraClosed, 2000, 'extra closed');
  assert.equal(host.members.size, MAX_WAITING_MEMBERS, 'the refused connection held no member');

  // A waiting connection can still complete HELLO and take the open slot.
  waiters[0].send({ t: MSG.HELLO, name: 'Joe', version: host.version });
  await waitFor(() => host.state.slots[1].kind === 'human' && host.state.slots[1].name === 'Joe', 2000, 'Joe joined');
  assert.ok(host.members.size <= MAX_WAITING_MEMBERS + 1);

  // With a member now joined, the waiting count dropped, so a fresh connection is accepted again.
  const after = await joinRoom({ transport: 'loopback', roomCode: host.roomCode });
  const afterMsgs = [];
  after.onMessage((m) => afterMsgs.push(m));
  await sleep(30);
  assert.ok(!afterMsgs.some((m) => m.t === MSG.KICK && m.reason === REASONS.BUSY), 'a new connection is not refused as busy');

  // Free the idle connections, then the joined player leaves: the slot opens and
  // a fresh client can rejoin it (the cap never blocks a legitimate flow).
  for (const w of waiters.slice(1)) w.close();
  extra.close();
  after.close();
  await waitFor(() => host.members.size <= 1, 2000, 'idle connections cleared');
  waiters[0].close();
  await waitFor(() => host.state.slots[1].kind === 'open', 2000, 'slot freed on leave');
  const rejoin = await LobbyClient.join({ transport: 'loopback', roomCode: host.roomCode, name: 'Joe2' });
  assert.equal(rejoin.mySlot, 1, 'a player can rejoin the freed slot');
  rejoin.leave();
  host.close();
});
