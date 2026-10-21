// Untrusted input: the host must survive anything a malicious or buggy client
// sends, and a client must survive a bad host (DESIGN 7, notes/decisions.md [netfix]).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoopbackPair, hostRoom, FramedConn } from '../../src/net/transport.js';
import {
  encodeFrames, FrameDecoder, RateLimiter, sanitizeName, sanitizeChat, MAX_CHAT_LENGTH, MAX_NAME_LENGTH,
  MAX_CLIENT_MESSAGE_CHARS, MAX_FRAME_ERRORS,
} from '../../src/net/protocol.js';
import { sanitizeCommand, validateSetup, isValidSnapshot, sanitizeFelled, COMMAND_TYPES } from '../../src/net/sanitize.js';
import { HostSession, ClientSession, CLIENT_LIMITS } from '../../src/net/session.js';
import { LobbyHost, LobbyClient, sanitizeLobbyState } from '../../src/net/lobby.js';
import { fakeWorldFactory, makeFakeMap } from '../../src/net/fake-world.js';
import { PANTHEONS } from '../../src/data/index.js';
import { PLAYER_COLORS, MAX_PLAYERS } from '../../src/config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 3000, what = 'condition') {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(1);
  }
}
const json = (v) => JSON.parse(JSON.stringify(v));
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f​‎‏‪-‮⁦-⁩﻿]/;

/** Run fn with console.warn / console.error silenced; returns what was logged. */
async function quietly(fn) {
  const logged = [];
  const { warn, error } = console;
  console.warn = (...a) => logged.push(a.join(' '));
  console.error = (...a) => logged.push(a.join(' '));
  try {
    await fn();
  } finally {
    console.warn = warn;
    console.error = error;
  }
  return logged;
}

/** Raw garbage frames covering every way a frame can be malformed. */
function garbageFrames() {
  return [
    '{not json', '[1,2]', '"text"', 'null', '42', 'true', '{"t":5}', '{"x":1}', '{"t":null}', '',
    'x'.repeat(5000), '~bad|x', '~1,0|x', '~a,b,c|x', '~1,5,3|x', '~1,-1,3|x', '~1,0,1e9|x',
    `~${'9'.repeat(40)},0,2|x`, '~1.5,0,2|x', '\u0000\u0001', '{"t":"cmd","cmd":' + '['.repeat(2000),
  ];
}

// ---------------------------------------------------------------- framing

test('FrameDecoder: garbage, oversized frames, chunk bombs and floods are dropped with bounded memory', () => {
  const dec = new FrameDecoder({ maxChars: 4096 });
  for (const f of garbageFrames()) assert.equal(dec.push(f), null, JSON.stringify(f.slice(0, 20)));
  assert.equal(dec.push(42), null);
  assert.equal(dec.push({ t: 'x' }), null);
  const errorsAfterGarbage = dec.errors;
  assert.ok(errorsAfterGarbage >= garbageFrames().length);
  // One single frame over the limit.
  assert.equal(dec.push(JSON.stringify({ t: 'chat', text: 'y'.repeat(5000) })), null);
  // A chunked message whose total exceeds the limit: dropped as soon as it does, the rest skipped.
  const big = encodeFrames({ t: 'chat', text: 'z'.repeat(20000) }, 77, 1000);
  for (const f of big) assert.equal(dec.push(f), null);
  assert.equal(dec.partial, null, 'nothing kept of the oversized message');
  // A chunk count over the cap and a chunk over the per-chunk size.
  assert.equal(dec.push(`~5,0,${dec.maxChunks + 1}|{}`), null);
  assert.equal(dec.push(`~6,0,2|${'q'.repeat(70 * 1024)}`), null);
  // A flood of first chunks with ever new sequence numbers never piles up.
  for (let i = 0; i < 2000; i++) dec.push(`~${1000 + i},0,3|{"t":"x"`);
  assert.ok(dec.partial && dec.partial.parts.length === 3, 'only one partial message is ever kept');
  // Chunk count changing within one message.
  dec.push('~9000,0,3|{"t":');
  assert.equal(dec.push('~9000,1,2|"x"}'), null);
  // Valid traffic still works afterwards.
  const ok = { t: 'chat', text: 'still fine' };
  assert.deepEqual(dec.push(JSON.stringify(ok)), ok);
  const chunks = encodeFrames(ok, 9999, 8);
  let out = null;
  for (const f of chunks) out = dec.push(f);
  assert.deepEqual(out, ok);
});

test('FramedConn: malformed frames are ignored, then a connection that keeps sending them is closed', async () => {
  const c = new FramedConn({ id: 'evil', heartbeatMs: 0, rawSend: () => {} });
  const got = [];
  c.onMessage((m) => got.push(m.t));
  const logged = await quietly(async () => {
    for (const f of garbageFrames()) c._receive(f);
    c._receive(123);
    c._receive(null);
    c._receive({ t: 'object-not-string' });
    for (const f of encodeFrames({ t: 'ok' }, 1)) c._receive(f);
    await sleep(5);
    assert.equal(c.open, true, 'a burst of garbage is survived');
    assert.deepEqual(got, ['ok']);
    for (let i = 0; i < MAX_FRAME_ERRORS + 5; i++) c._receive('{garbage');
  });
  assert.equal(c.open, false);
  assert.equal(c.closeReason, 'protocol-error');
  assert.ok(logged.some((l) => /malformed/.test(l)));
});

test('host endpoint: a client may not send huge messages, the host may', async () => {
  const ep = await hostRoom({ transport: 'loopback' });
  let server = null;
  ep.onConnection((c) => (server = c));
  const { joinRoom } = await import('../../src/net/transport.js');
  const client = await joinRoom({ transport: 'loopback', roomCode: ep.roomCode });
  await waitFor(() => server);
  const atServer = [];
  const atClient = [];
  server.onMessage((m) => atServer.push(m.t));
  client.onMessage((m) => atClient.push(m.t));
  const huge = 'w'.repeat(MAX_CLIENT_MESSAGE_CHARS + 10);
  await quietly(async () => {
    client.send({ t: 'chat', text: huge });
    client.send({ t: 'chat', text: 'small' });
    server.send({ t: 'full', snap: huge });
    await waitFor(() => atServer.length === 1 && atClient.length === 1);
  });
  assert.deepEqual(atServer, ['chat'], 'the oversized client message was dropped');
  assert.equal(server.stats.badFrames > 0, true);
  assert.deepEqual(atClient, ['full']);
  ep.close();
});

test('RateLimiter: bursts, refill, counted drops', () => {
  let t = 0;
  const r = new RateLimiter(2, 4, () => t);
  let ok = 0;
  for (let i = 0; i < 10; i++) if (r.take()) ok++;
  assert.equal(ok, 4);
  assert.equal(r.dropped, 6);
  t += 1000;
  ok = 0;
  for (let i = 0; i < 10; i++) if (r.take()) ok++;
  assert.equal(ok, 2);
  t += 60000;
  ok = 0;
  for (let i = 0; i < 10; i++) if (r.take()) ok++;
  assert.equal(ok, 4, 'never more than the burst');
});

// ---------------------------------------------------------------- sanitizers

test('sanitizeName / sanitizeChat: lengths, control and bidi characters, non-strings', () => {
  assert.equal(sanitizeName('A‮B\u0007C​⁦D'), 'A B C D');
  assert.equal(sanitizeName({ toString: 1 }), 'Player');
  assert.equal(sanitizeName(['Zeus']), 'Player');
  assert.equal(sanitizeName(7), '7');
  assert.equal([...sanitizeName('Ω'.repeat(5000))].length, MAX_NAME_LENGTH);
  assert.equal(sanitizeChat({ text: 'x' }), '');
  assert.equal([...sanitizeChat('é'.repeat(10000))].length, MAX_CHAT_LENGTH);
  assert.equal(sanitizeChat('a b c\r\nd'), 'a b c d');
  assert.ok(!UNSAFE.test(sanitizeChat('‮hello\u0000﻿')));
});

test('sanitizeCommand: whitelisted types and typed fields only', () => {
  const b = { width: 96, height: 96 };
  assert.deepEqual(
    sanitizeCommand({ type: 'move', units: [3, 3, -1, 2.5, '7', 9, null], x: 1e308, y: -5, queue: 'yes', player: 0, evil: { a: 1 } }, b),
    { type: 'move', units: [3, 9], x: 96, y: 0 },
  );
  assert.deepEqual(sanitizeCommand({ type: 'move', units: [1], x: 10.5, y: 3, queue: true }, b), { type: 'move', units: [1], x: 10.5, y: 3, queue: true });
  assert.equal(sanitizeCommand({ type: 'move', units: [1], x: 'a', y: 3 }, b), null, 'required coordinate');
  assert.equal(sanitizeCommand({ type: 'move', units: 'all', x: 1, y: 1 }, b), null);
  for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'debugGrantGold', '', null, 5]) {
    assert.equal(sanitizeCommand({ type, units: [1] }, b), null, String(type));
  }
  for (const building of ['__proto__', 'constructor', 'toString', 'castle', ['house'], 5]) {
    assert.equal(sanitizeCommand({ type: 'build', units: [1], building, tx: 1, ty: 1 }, b), null, String(building));
  }
  assert.deepEqual(sanitizeCommand({ type: 'build', units: [4], building: 'house', tx: 10.7, ty: 500 }, b), { type: 'build', units: [4], building: 'house', tx: 10, ty: 95 });
  // A dragged wall carries its far end; a bad far end is dropped, not trusted.
  assert.deepEqual(sanitizeCommand({ type: 'build', units: [4], building: 'wooden_wall', tx: 10, ty: 10, tx2: 30.9, ty2: -3 }, b), { type: 'build', units: [4], building: 'wooden_wall', tx: 10, ty: 10, tx2: 30, ty2: 0 });
  assert.deepEqual(sanitizeCommand({ type: 'build', units: [4], building: 'wooden_wall', tx: 10, ty: 10, tx2: 'far', ty2: NaN }, b), { type: 'build', units: [4], building: 'wooden_wall', tx: 10, ty: 10 });
  assert.deepEqual(sanitizeCommand({ type: 'upgradeWall', walls: [3, 3, -1, '7', 8] }, b), { type: 'upgradeWall', walls: [3, 8] });
  assert.equal(sanitizeCommand({ type: 'upgradeWall', walls: 'all' }, b), null);
  for (const unit of ['__proto__', 'constructor', 'dragon_of_doom', 3]) assert.equal(sanitizeCommand({ type: 'train', building: 5, unit }, b), null);
  assert.deepEqual(sanitizeCommand({ type: 'train', building: 5, unit: 'worshipper' }, b), { type: 'train', building: 5, unit: 'worshipper' });
  assert.equal(sanitizeCommand({ type: 'train', building: '5', unit: 'worshipper' }, b), null);
  for (const upgrade of ['__proto__', 'constructor', 'tier_up', 'worshipper', 5]) assert.equal(sanitizeCommand({ type: 'research', building: 5, upgrade }, b), null);
  assert.deepEqual(sanitizeCommand({ type: 'autoRepair', on: 'yes' }, b), { type: 'autoRepair' }, 'only a strict true turns it on');
  assert.equal(sanitizeCommand({ type: 'cast', unit: 2, ability: '__proto__' }, b), null);
  assert.deepEqual(sanitizeCommand({ type: 'cast', unit: 2, ability: 'greek_zeus_thunderbolt', x: 4, y: 5, target: 0 }, b), { type: 'cast', unit: 2, ability: 'greek_zeus_thunderbolt', x: 4, y: 5 });
  assert.deepEqual(sanitizeCommand({ type: 'cancelTrain', building: 9, index: 99 }, b), { type: 'cancelTrain', building: 9 });
  assert.deepEqual(sanitizeCommand({ type: 'surrender', units: [1] }, b), { type: 'surrender' });
  const many = sanitizeCommand({ type: 'stop', units: Array.from({ length: 10000 }, (_, i) => i + 1) }, b);
  assert.equal(many.units.length, 256, 'unit lists are capped');
  assert.equal(sanitizeCommand(null, b), null);
  // Trades: a known resource, a positive whole amount and a player index, or nothing.
  for (const bad of [{ to: 1, res: 'mana', amount: 50 }, { to: 1, res: 'gold', amount: -5 }, { to: 1, res: 'gold', amount: 2.5 },
    { to: -1, res: 'gold', amount: 50 }, { res: 'gold', amount: 50 }, { to: 1, res: 'gold', amount: 1e9 }, { to: 1, res: '__proto__', amount: 50 }]) {
    assert.equal(sanitizeCommand({ type: 'trade', ...bad }, b), null, JSON.stringify(bad));
  }
  assert.equal(sanitizeCommand([{ type: 'stop' }], b), null);
  assert.equal(sanitizeCommand('stop', b), null);
  // Every whitelisted type accepts a well-formed command.
  const good = {
    move: { units: [1], x: 1, y: 1 }, attackMove: { units: [1], x: 1, y: 1 }, attack: { units: [1], target: 2 },
    smart: { units: [1], x: 1, y: 1 }, gather: { units: [1], target: 3 }, pray: { units: [1], target: 4 },
    returnCargo: { units: [1] }, build: { units: [1], building: 'barracks', tx: 3, ty: 3 }, train: { building: 2, unit: 'warrior' },
    cancelTrain: { building: 2, index: 0 }, upgradeTier: { building: 2 }, cancelBuild: { building: 2 }, rally: { building: 2, x: 3, y: 3 },
    stop: { units: [1] }, hold: { units: [1] }, cast: { unit: 1, ability: 'greek_zeus_thunderbolt', target: 5 }, surrender: {},
    repair: { units: [1], target: 2 }, research: { building: 2, upgrade: 'house_stone_walls' }, autoRepair: { on: true },
    trade: { to: 1, res: 'gold', amount: 100 },
    autocast: { units: [1], ability: 'greek_zeus_thunderbolt', on: true },
    upgradeWall: { walls: [4, 5, 6] },
  };
  assert.deepEqual(Object.keys(good).sort(), [...COMMAND_TYPES].sort());
  for (const [type, f] of Object.entries(good)) assert.deepEqual(sanitizeCommand({ type, ...f }, b), { type, ...f }, type);
});

test('validateSetup / isValidSnapshot / sanitizeFelled reject what a client cannot use', () => {
  const players = [0, 1].map((i) => ({ index: i, name: `P${i}`, team: i + 1, pantheon: 'greek', color: PLAYER_COLORS[i], kind: 'human', difficulty: null }));
  const setup = { version: '0.1.0', seed: 123, mapSize: 'small', players, mapHash: 'abcd1234' };
  assert.deepEqual(validateSetup(json(setup), 1), { setup, myIndex: 1 });
  for (const [bad, you] of [
    [{ ...setup, players: [] }, 0], [{ ...setup, players: 'x' }, 0], [setup, 2], [setup, -1], [setup, '1'],
    [{ ...setup, mapSize: 'galaxy' }, 0], [{ ...setup, seed: { x: 1 } }, 0],
    [{ ...setup, players: [{ ...players[0], pantheon: '__proto__' }, players[1]] }, 0],
    [{ ...setup, players: [{ ...players[0], team: 9 }, players[1]] }, 0],
    [{ ...setup, players: [players[1], players[0]] }, 0], // indices out of order
    [null, 0], ['setup', 0],
  ]) assert.equal(validateSetup(bad, you), null, JSON.stringify(bad && bad.players && bad.players[0]));
  for (const m of [30, 45, 60]) assert.equal(validateSetup(json({ ...setup, peaceMinutes: m }), 0).setup.peaceMinutes, m, 'a Decade of Peace length is kept');
  for (const bad of [0, 10, 31, '30', null, NaN, [30], {}]) assert.equal('peaceMinutes' in validateSetup(json({ ...setup, peaceMinutes: bad }), 0).setup, false, `dropped ${JSON.stringify(bad)}`);
  const dirty = validateSetup({ ...setup, players: [{ ...players[0], name: '‮evil'.repeat(9), color: 'url(x)' }, players[1]], extra: 1 }, 0);
  assert.ok(dirty.setup.players[0].name.length <= MAX_NAME_LENGTH && !UNSAFE.test(dirty.setup.players[0].name));
  assert.equal(dirty.setup.players[0].color, PLAYER_COLORS[0]);
  assert.equal(dirty.setup.extra, undefined);

  const snap = { tick: 1, time: 0.05, players: [{ i: 0 }], entities: [{ id: 1, k: 'u', x: 1, y: 2 }], events: [{ type: 'hit' }], felled: [[1, 2]], fields: [] };
  assert.ok(isValidSnapshot(snap));
  for (const bad of [
    null, 'snap', { ...snap, tick: 'x' }, { ...snap, entities: {} }, { ...snap, entities: [null] }, { ...snap, entities: [{ id: 'a', k: 'u', x: 1, y: 1 }] },
    { ...snap, entities: [{ id: 1, k: 'u', x: 'a', y: 1 }] }, { ...snap, players: [null] }, { ...snap, events: [null] }, { ...snap, events: [{ type: 3 }] },
    { ...snap, felled: [[1]] }, { ...snap, fields: 'x' },
  ]) assert.equal(isValidSnapshot(bad), false, JSON.stringify(bad));
  assert.deepEqual(sanitizeFelled([[1, 2], [-1, 0], [1.5, 2], 'x', [3, 4, 5], [99, 0]], 10, 10), [[1, 2], [3, 4]]);
  assert.deepEqual(sanitizeFelled('x', 10, 10), []);
});

// ---------------------------------------------------------------- host vs a malicious client

function gameSetup(n = 3) {
  const players = [];
  for (let i = 0; i < n; i++) players.push({ index: i, name: ['Host', 'Honest', 'Evil'][i] || `P${i}`, team: i === 0 ? 1 : 2, pantheon: 'greek', color: PLAYER_COLORS[i], kind: 'human', difficulty: null });
  return { version: '0.1.0', seed: 99, mapSize: 'small', players };
}

test('HostSession survives a malicious client; the honest client stays exactly in sync', async () => {
  const setup = gameSetup(3);
  const [hostHonest, honestSide] = createLoopbackPair();
  const [hostEvil, evil] = createLoopbackPair();
  const honest = new ClientSession({ setup, myIndex: 1, conn: honestSide, generateMap: () => makeFakeMap(48, 48) });
  const evilGot = [];
  evil.onMessage((m) => evilGot.push(m));
  const host = new HostSession({ setup, conns: new Map([[1, hostHonest], [2, hostEvil]]), createWorld: fakeWorldFactory({ units: 60 }), autoTick: false });
  const hostChat = [];
  host.onChat((l) => hostChat.push(l));

  // Commands before the game starts are ignored.
  evil.send({ t: 'cmd', cmd: { type: 'stop', units: [1] } });
  await sleep(5);
  host.step(1);
  assert.equal(host.world.commands.length, 0, 'no command before start');
  host.start();
  await honest.ready;

  await quietly(async () => {
    for (const f of garbageFrames()) hostEvil._receive(f); // straight onto the host's side of the wire
    const junk = [
      null, 5, 'x', [], { t: 'nope' }, { t: 'cmd' }, { t: 'cmd', cmd: null }, { t: 'cmd', cmd: [] }, { t: 'cmd', cmd: 'stop' },
      { t: 'cmd', cmd: { type: '__proto__' } }, { t: 'cmd', cmd: { type: 'build', units: [1], building: 'constructor', tx: 1, ty: 1 } },
      { t: 'cmd', cmd: { type: 'train', building: 1, unit: '__proto__' } }, { t: 'cmd', cmd: { type: 'move', units: { length: 1e9 }, x: 1, y: 1 } },
      { t: 'chat' }, { t: 'chat', text: { evil: true } }, { t: 'ping', ts: 'x', rtt: -5 }, { t: 'hello', name: 'again' },
      { t: 'lobby', patch: { team: 3 } }, { t: 'full', snap: {} }, { t: 'delta', d: {} }, { t: 'start', setup: {} }, { t: 'end' },
    ];
    for (const m of junk) evil.send(m);
    // Floods.
    evil.send({ t: 'chat', text: `‮${'spam '.repeat(300)}\u0000` });
    for (let i = 0; i < 50; i++) evil.send({ t: 'chat', text: `flood ${i}` });
    for (let i = 0; i < 100; i++) evil.send({ t: 'ping', ts: i });
    for (let i = 0; i < 40; i++) evil.send({ t: 'resync' });
    for (let i = 0; i < 400; i++) evil.send({ t: 'cmd', cmd: { type: 'move', units: [1, 2], x: i, y: 1e9, player: 0 } });
    await sleep(20);
    for (let i = 0; i < 20; i++) {
      host.step(1);
      const tick = host.lastSnap.tick;
      await waitFor(() => honest.snap && honest.snap.tick === tick, 3000, `tick ${tick}`);
      assert.deepStrictEqual(honest.snap, json(host.lastSnap), `honest client at tick ${tick}`);
    }
  });

  assert.equal(host.errorCounts.sim, undefined, 'the simulation never threw');
  assert.equal(host.errorCounts.command, undefined);
  const evilCmds = host.world.commands.filter((c) => c.player === 2);
  assert.ok(evilCmds.length <= CLIENT_LIMITS.cmd[1] + 2, `command flood capped (${evilCmds.length})`);
  for (const { cmd } of evilCmds) {
    assert.ok(COMMAND_TYPES.includes(cmd.type));
    assert.equal(cmd.player, undefined);
    assert.ok(cmd.y <= 48 && cmd.x <= 48, 'coordinates clamped to the map');
  }
  const evilLines = hostChat.filter((l) => l.from === 2);
  assert.ok(evilLines.length >= 1 && evilLines.length <= CLIENT_LIMITS.chat[1] + 1, `chat flood capped (${evilLines.length})`);
  for (const l of evilLines) assert.ok(l.text.length <= MAX_CHAT_LENGTH && !UNSAFE.test(l.text));
  const pongs = evilGot.filter((m) => m.t === 'pong').length;
  assert.ok(pongs <= CLIENT_LIMITS.ping[1] + 2, `ping flood capped (${pongs})`);
  const fulls = evilGot.filter((m) => m.t === 'full').length;
  assert.ok(fulls <= 3, `resync spam capped (${fulls} full snapshots)`);
  assert.equal(hostEvil.open, true, 'a few bad frames alone do not drop a client (bugs happen)');
  assert.ok(hostEvil.stats.badFrames >= garbageFrames().length, 'bad frames are counted');

  // A sustained stream of malformed frames gets the connection closed…
  const closeLog = await quietly(async () => {
    for (let i = 0; i <= MAX_FRAME_ERRORS; i++) hostEvil._receive(`{garbage ${i}`);
    await waitFor(() => host.leftPlayers.has(2), 3000, 'evil client removed');
  });
  assert.equal(hostEvil.open, false, 'the garbage stream got the evil connection closed…');
  assert.ok(closeLog.some((l) => /malformed/.test(l)));
  assert.equal(honestSide.open, true, '…and only that one');
  host.step(1);
  const tick = host.lastSnap.tick;
  await waitFor(() => honest.snap && honest.snap.tick === tick, 3000, `tick ${tick}`);
  assert.deepStrictEqual(honest.snap, json(host.lastSnap), 'the game goes on for the honest client');
  honest.stop();
  host.stop();
});

test('HostSession: valid client commands still go through unchanged; garbage-free resync spam is throttled', async () => {
  const setup = gameSetup(2);
  const [hostSide, clientSide] = createLoopbackPair();
  const got = [];
  clientSide.onMessage((m) => got.push(m.t));
  const host = new HostSession({ setup, conns: new Map([[1, hostSide]]), createWorld: fakeWorldFactory({ units: 20 }), autoTick: false });
  host.start();
  const cmds = [
    { type: 'build', units: [3], building: 'house', tx: 10, ty: 12, queue: true },
    { type: 'cast', unit: 4, ability: 'greek_zeus_thunderbolt', x: 3.25, y: 4.5 },
    { type: 'smart', units: [1, 2], x: 5, y: 6, target: 7, tx: 5, ty: 6 },
    { type: 'rally', building: 8, x: 1, y: 2, target: 9 },
  ];
  for (const cmd of cmds) clientSide.send({ t: 'cmd', cmd });
  await sleep(10);
  host.step(1);
  assert.deepEqual(host.world.commands.map((c) => c.cmd), cmds);
  assert.ok(host.world.commands.every((c) => c.player === 1));
  // Resync spam without garbage: the connection stays open, fulls are throttled to one per second.
  got.length = 0;
  for (let i = 0; i < 30; i++) {
    clientSide.send({ t: 'resync' });
    host.step(1);
    await sleep(5);
  }
  assert.equal(hostSide.open, true);
  assert.ok(got.filter((t) => t === 'full').length <= 1, `fulls: ${got.filter((t) => t === 'full').length}`);
  await waitFor(() => got.filter((t) => t === 'full').length >= 1, 2000, 'the deferred full snapshot');
  host.stop();
});

// ---------------------------------------------------------------- lobby host vs a malicious member

test('LobbyHost survives malicious members: patches, names, floods; the setup stays valid', async () => {
  const lobby = await LobbyHost.create({ transport: 'loopback', name: 'Host' });
  lobby.applyPreset('ffa');
  lobby.setSlot(1, { kind: 'open' });
  lobby.setSlot(2, { kind: 'open' });
  const honest = await LobbyClient.join({ transport: 'loopback', roomCode: lobby.roomCode, name: 'Honest' });
  let honestUpdates = 0;
  honest.onChange(() => honestUpdates++);
  const honestChat = [];
  honest.onChat((l) => honestChat.push(l));
  // The evil member speaks raw protocol.
  const { joinRoom } = await import('../../src/net/transport.js');
  const evil = await joinRoom({ transport: 'loopback', roomCode: lobby.roomCode });
  const evilGot = [];
  evil.onMessage((m) => evilGot.push(m));
  evil.send({ t: 'chat', text: 'before hello' });
  evil.send({ t: 'lobby', patch: { team: 1 } });
  evil.send({ t: 'hello', name: `‮${'Ä'.repeat(100)}\u0000\n`, version: lobby.version });
  evil.send({ t: 'hello', name: 'second hello', version: lobby.version });
  await waitFor(() => evilGot.some((m) => m.t === 'welcome'));
  const slot = evilGot.find((m) => m.t === 'welcome').slot;
  const name = lobby.state.slots[slot].name;
  assert.ok([...name].length <= MAX_NAME_LENGTH && !UNSAFE.test(name) && name.length > 0, `name ${JSON.stringify(name)}`);
  assert.equal(lobby.state.slots.filter((s) => s.kind === 'human').length, 2, 'the second hello took no slot');

  const before = honestUpdates;
  await quietly(async () => {
    const bad = [
      { pantheon: '__proto__' }, { pantheon: 'constructor' }, { pantheon: 'toString' }, { pantheon: ['greek'] }, { pantheon: { id: 'greek' } }, { pantheon: 5 },
      { team: 0 }, { team: 5 }, { team: 2.5 }, { team: null }, { team: '1e400' }, { team: [3] }, { team: { valueOf: 2 } },
      { color: -1 }, { color: PLAYER_COLORS.length }, { color: 1.5 }, { color: 'red' }, { color: [1] },
      { kind: 'host' }, { name: 'Renamed' }, { difficulty: 'hard' },
    ];
    for (const patch of bad) evil.send({ t: 'lobby', patch });
    evil.send({ t: 'lobby', patch: 'x' });
    evil.send({ t: 'lobby', patch: null });
    for (let i = 0; i < 100; i++) evil.send({ t: 'lobby', patch: { team: (i % 4) + 1 } });
    evil.send({ t: 'chat', text: 'x'.repeat(5000) });
    for (let i = 0; i < 50; i++) evil.send({ t: 'chat', text: `spam ${i}` });
    for (let i = 0; i < 100; i++) evil.send({ t: 'ping', ts: i });
    for (const m of [null, 1, 'x', [], { t: 'start' }, { t: 'welcome', slot: 0 }, { t: 'kick', reason: 'you' }]) evil.send(m);
    await sleep(100);
  });
  const s = lobby.state.slots[slot];
  assert.equal(s.kind, 'human');
  assert.equal(s.name, name, 'a member cannot rename itself');
  assert.ok(s.pantheon === 'random' || Object.prototype.hasOwnProperty.call(PANTHEONS, s.pantheon));
  assert.ok(Number.isInteger(s.team) && s.team >= 1 && s.team <= MAX_PLAYERS);
  assert.ok(Number.isInteger(s.color) && s.color >= 0 && s.color < PLAYER_COLORS.length);
  assert.ok(honestUpdates - before <= 15, `patch flood → ${honestUpdates - before} lobby updates for the others`);
  const spam = honestChat.filter((l) => l.from === slot);
  assert.ok(spam.length <= 6, `chat flood capped (${spam.length})`);
  for (const l of spam) assert.ok(l.text.length <= MAX_CHAT_LENGTH);
  assert.ok(evilGot.filter((m) => m.t === 'pong').length <= 10);
  lobby.setSlot(0, { team: 1 });
  lobby.setSlot(1, { team: 2 });
  const { setup, conns } = lobby.start();
  assert.ok(validateSetup(json(setup), 1), 'the GameSetup is valid');
  assert.equal(conns.size, 2);
  lobby.close();
});

// ---------------------------------------------------------------- clients vs a bad host

test('LobbyClient survives a bad host: broken lobby states, chat floods, invalid setup', async () => {
  const ep = await hostRoom({ transport: 'loopback' });
  let server = null;
  ep.onConnection((c) => {
    server = c;
    c.onMessage((m) => {
      if (m.t !== 'hello') return;
      for (const junk of [null, 'x', { t: 'welcome' }, { t: 'welcome', slot: 1, lobby: { slots: 'none' } }, { t: 'welcome', slot: 9, lobby: { slots: [] } }]) c.send(junk);
      c.send({
        t: 'welcome', slot: 1,
        lobby: {
          roomCode: ep.roomCode, mapSize: 'galaxy', preset: '__proto__', started: 'yes',
          slots: [
            { kind: 'host', name: { x: 1 }, pantheon: '__proto__', team: 99, color: 'red', difficulty: 'godlike', peerId: 'host' },
            { kind: 'human', name: `Me‮${'x'.repeat(99)}`, pantheon: 'norse', team: 2, color: 3, peerId: 'me' },
            'garbage',
          ],
        },
      });
    });
  });
  const client = await LobbyClient.join({ transport: 'loopback', roomCode: ep.roomCode, name: 'Me' });
  const st = client.state;
  assert.equal(st.slots.length, MAX_PLAYERS);
  assert.equal(st.mapSize, 'small');
  assert.equal(st.preset, null);
  assert.equal(st.started, false);
  assert.deepEqual(
    { name: st.slots[0].name, pantheon: st.slots[0].pantheon, team: st.slots[0].team, color: st.slots[0].color, difficulty: st.slots[0].difficulty },
    { name: '', pantheon: 'random', team: 1, color: 0, difficulty: 'normal' },
  );
  assert.ok(st.slots[1].name.length <= MAX_NAME_LENGTH && !UNSAFE.test(st.slots[1].name));
  assert.equal(st.slots[2].kind, 'closed');
  assert.equal(client.mySlot, 1);

  let updates = 0;
  client.onChange(() => updates++);
  const lines = [];
  client.onChat((l) => lines.push(l));
  for (let i = 0; i < 200; i++) server.send({ t: 'lobby', lobby: { roomCode: ep.roomCode, mapSize: 'medium', slots: st.slots.map((s) => ({ ...s, team: (i % 4) + 1 })) } });
  for (let i = 0; i < 200; i++) server.send({ t: 'chat', from: { x: 1 }, name: ['n'], text: i % 2 ? { t: 1 } : `line ${i} ${'y'.repeat(400)}`, system: 'yes' });
  server.send({ t: 'lobby', lobby: 'broken' });
  await sleep(120);
  assert.ok(updates >= 1 && updates <= 10, `lobby flood coalesced into ${updates} updates`);
  assert.equal(client.state.slots[1].team, 4, 'the last state wins');
  assert.equal(client.state.mapSize, 'medium');
  assert.ok(lines.length > 0 && lines.length <= 30, `chat flood capped (${lines.length})`);
  for (const l of lines) {
    assert.equal(typeof l.text, 'string');
    assert.ok(l.text.length <= MAX_CHAT_LENGTH);
    assert.equal(l.system, false);
    assert.equal(l.from, -1);
  }
  // A start with an unusable setup ends the lobby with a readable reason instead of crashing the game.
  let kicked = null;
  client.onKicked((r) => (kicked = r));
  let started = false;
  client.onStart(() => (started = true));
  server.send({ t: 'start', setup: { players: [{ pantheon: '__proto__' }] }, you: 0 });
  await waitFor(() => kicked !== null);
  assert.match(kicked, /invalid game setup/);
  assert.equal(started, false);
  ep.close();
});

test('ClientSession survives a bad host: invalid snapshots and deltas resync, floods are capped, the end is clean', async () => {
  const setup = gameSetup(2);
  const [hostSide, clientSide] = createLoopbackPair();
  const client = new ClientSession({ setup, myIndex: 1, conn: clientSide, generateMap: () => makeFakeMap(48, 48), pingIntervalMs: 1e6 });
  const resyncs = [];
  hostSide.onMessage((m) => m.t === 'resync' && resyncs.push(m));
  const lines = [];
  client.onChat((l) => lines.push(l));
  const ends = [];
  client.onEnd((e) => ends.push(e));
  const good = { tick: 5, time: 0.25, players: [{ i: 0, team: 1 }, { i: 1, team: 2 }], entities: [{ id: 1, k: 'u', t: 'warrior', o: 1, x: 3, y: 4, f: 0, hp: 10 }], events: [], felled: [], fields: [] };
  const logged = await quietly(async () => {
    for (const junk of [null, 7, 'x', { t: 'full' }, { t: 'full', snap: 'x' }, { t: 'full', snap: { ...good, entities: {} } }, { t: 'full', snap: { ...good, entities: [{ id: 1, k: 'u', x: 'a', y: 1 }] } }]) hostSide.send(junk);
    await sleep(20);
    assert.equal(client.snap, null, 'nothing invalid was accepted');
    hostSide.send({ t: 'full', snap: good, felledAll: [[1, 1], 'x', [-4, 2], [3, 3]] });
    await client.ready;
    assert.equal(client.viewState.tick, 5);
    assert.equal(client.viewState.felledAll.length, client.viewState.felledAll.filter((f) => f[0] >= 0).length);
    for (const d of ['x', null, { b: 99, tick: 6 }, { b: 5, c: { hp: [999, 1] } }, { b: 5, m: [1, 'a', 'b'] }, { b: 5, a: [null] }, { b: 5, e: [[999]] }, { b: 5, c: { 'q.0.p': [1, 1] } }]) hostSide.send({ t: 'delta', d });
    for (let i = 0; i < 100; i++) hostSide.send({ t: 'chat', from: 'host', name: { n: 1 }, text: i % 3 ? `msg ${i}` : ['x'], system: 1 });
    hostSide.send({ t: 'pong', ts: 1e15 });
    await sleep(50);
  });
  assert.equal(client.viewState.tick, 5, 'bad deltas never reached the view');
  assert.ok(client.snap === null || client.snap.tick === 5);
  assert.ok(resyncs.length >= 1 && resyncs.length <= 3, `resyncs requested (${resyncs.length}), throttled`);
  assert.ok(lines.length <= 30, `chat flood capped (${lines.length})`);
  for (const l of lines) assert.ok(typeof l.text === 'string' && typeof l.name === 'string' && l.system === false && l.from === -1);
  assert.equal(client.pingMs, null, 'a pong from the future is ignored');
  assert.ok(logged.length > 0);
  // A good delta after all that applies normally.
  hostSide.send({ t: 'full', snap: good });
  await sleep(20);
  hostSide.send({ t: 'delta', d: { b: 5, time: 0.3, m: [1, 10, -10] } });
  await waitFor(() => client.viewState.tick === 6);
  assert.equal(client.viewState.getEntity(1).x, 3.1);
  // A host that ends the game with a junk reason: a clean end with a readable text.
  hostSide.send({ t: 'end', reason: { evil: true } });
  await waitFor(() => ends.length === 1);
  assert.deepEqual(ends[0], { reason: 'host-quit' });
  assert.equal(client.stopped, true);
});

test('a client that loses the host mid-game (no close event) ends cleanly after the timeout', async () => {
  const setup = gameSetup(2);
  const [hostSide, clientSide, link] = createLoopbackPair({ heartbeatMs: 30 });
  const host = new HostSession({ setup, conns: new Map([[1, hostSide]]), createWorld: fakeWorldFactory({ units: 10 }), autoTick: false, connTimeoutMs: 10000 });
  const client = new ClientSession({ setup, myIndex: 1, conn: clientSide, generateMap: () => makeFakeMap(48, 48), connTimeoutMs: 400 });
  host.start();
  await client.ready;
  const ends = [];
  client.onEnd((e) => ends.push(e));
  link.drop = true; // the host's network vanishes: no 'end', no goodbye, no close event
  await quietly(async () => {
    await waitFor(() => ends.length === 1, 3000, 'client end');
  });
  assert.deepEqual(ends[0], { reason: 'host-left' });
  assert.equal(client.stopped, true);
  host.stop();
});

test('sanitizeLobbyState rejects non-states and fills missing slots', () => {
  assert.equal(sanitizeLobbyState(null), null);
  assert.equal(sanitizeLobbyState({ slots: 'x' }), null);
  const s = sanitizeLobbyState({ slots: [] });
  assert.equal(s.slots.length, MAX_PLAYERS);
  assert.ok(s.slots.every((x) => x.kind === 'closed'));
});
