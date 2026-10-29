// Match replays (src/game/replay.js, replay-session.js, replay-store.js): a game recorded on the host
// plays back to the same world, checksums catch a replay that drifts, a jump ahead lands on the same
// state as playing through, and the store keeps the newest replays, compressed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HostSession } from '../../src/net/session.js';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { buildSetup } from '../../src/net/lobby.js';
import { normalizeCommand } from '../../src/sim/commands.js';
import {
  ReplayRecorder, worldChecksum, compactCommand, sanitizeReplay, replayMeta, sidesLabel, resultLabel, MIN_REPLAY_TICKS, MAX_CARRIED_COMMANDS,
} from '../../src/game/replay.js';
import { ReplaySession, PlaybackClock } from '../../src/game/replay-session.js';
import { MatchSaver } from '../../src/game/game-saves.js';
import { unpackMatch } from '../../src/game/save-game.js';
import {
  setReplayBackend, memoryBackend, saveReplay, listReplays, loadReplay, deleteReplay, packReplay, unpackReplay, MAX_REPLAYS,
} from '../../src/game/replay-store.js';

function lobby(over = {}) {
  return {
    roomCode: 'ABCD', mapSize: 'small', peace: 0, sacred: false, started: true,
    slots: [
      { kind: 'host', name: 'Austin', pantheon: 'greek', team: 1, color: 0, difficulty: 'normal', peerId: 'me' },
      { kind: 'ai', name: '', pantheon: 'norse', team: 2, color: 1, difficulty: 'hard', peerId: null },
      { kind: 'ai', name: '', pantheon: 'egyptian', team: 3, color: 2, difficulty: 'hard', peerId: null },
      { kind: 'closed', team: 4, color: 3 },
    ],
    ...over,
  };
}

/** A hosted game: the host's own army is run by an AI too, through sendCommand, as a player's clicks are. */
function recordGame(ticks, seed = 11) {
  const { setup } = buildSetup(lobby(), seed);
  const host = new HostSession({ setup, myIndex: 0, createWorld, createAI, autoTick: false, useWorker: false });
  const me = createAI(host.world, 0, 'hard');
  // The host's player: an AI whose orders arrive by sendCommand, as clicks do.
  me.world = new Proxy(host.world, { get: (w, k) => (k === 'issueCommand' ? (p, c) => host.sendCommand(c) : Reflect.get(w, k)) });
  const rec = new ReplayRecorder({ world: host.world, setup, myIndex: 0, now: () => 1000 }).attach();
  host.viewState.on('snapshot', () => rec.sample());
  host.onChat((line) => rec.chat(line));
  host.start();
  for (let t = 0; t < ticks; t++) {
    me.tick();
    host.step(1);
    if (t === 50) host.sendChat('good luck');
  }
  return { host, rec, setup };
}

let recorded = null;
function game() {
  if (!recorded) {
    const g = recordGame(3600);
    recorded = { ...g, record: g.rec.finish({ result: null }), final: worldChecksum(g.host.world), tick: g.host.world.tickCount };
  }
  return recorded;
}

function play(record, opts = {}) {
  const s = new ReplaySession({ record, createWorld, autoTick: false, useWorker: false, ...opts });
  s.start();
  return s;
}

function playToEnd(s) {
  while (!s.ended) s.step(50);
  return s;
}

test('a recorded game plays back to the same world, every checksum matching', () => {
  const { record, final, tick } = game();
  assert.ok(record.cmds.length > 100, `commands recorded: ${record.cmds.length}`);
  assert.ok(record.cmds.some((c) => c[1] === 0) && record.cmds.some((c) => c[1] === 1) && record.cmds.some((c) => c[1] === 2), 'every player\'s commands');
  assert.ok(record.sums.length >= 10);
  assert.equal(record.ticks, tick);
  const s = playToEnd(play(record));
  assert.equal(s.world.tickCount, tick);
  assert.equal(s.drift, null);
  assert.equal(s.checked, record.sums.length);
  assert.equal(worldChecksum(s.world), final);
  assert.equal(s.errors, 0);
});

test('the chat comes back at its tick', () => {
  const { record } = game();
  assert.ok(record.chat.some((c) => c[2] === 'good luck' && c[1] === 0));
  const s = play(record);
  const heard = [];
  s.onChat((l) => heard.push(l));
  s.step(40);
  assert.equal(heard.length, 0);
  s.step(20);
  assert.deepEqual(heard.map((l) => [l.name, l.text]), [['Austin', 'good luck']]);
});

test('a replay that parts from the recorded game says from when', () => {
  const { record } = game();
  const bent = { ...record, cmds: record.cmds.slice() };
  const i = bent.cmds.findIndex((c) => c[0] > 1500);
  bent.cmds.splice(i, 1);
  const s = playToEnd(play(bent));
  assert.ok(s.drift !== null && s.drift >= bent.cmds[i - 1][0], `drift at ${s.drift}`);
  assert.ok(s.checked > 0, 'the stretch before it matched');
});

test('jumping ahead lands on the same world as playing there', async () => {
  const { record } = game();
  const a = play(record);
  a.step(2000);
  const b = play(record);
  b.seek(2000);
  while (b.seeking) await new Promise((r) => setTimeout(r, 5));
  assert.equal(b.world.tickCount, 2000);
  assert.equal(worldChecksum(b.world), worldChecksum(a.world));
  assert.equal(b.viewState.tick, 2000, 'the view has the landing snapshot');
  // and a fresh session can open at a tick (going back is a fresh session)
  const c = play(record, { startAt: 1200, autoTick: false });
  while (c.seeking) await new Promise((r) => setTimeout(r, 5));
  assert.equal(c.world.tickCount, 1200);
});

test('speeds, pause and the viewer', () => {
  const { record } = game();
  const s = play(record);
  assert.equal(s.myIndex, -1);
  assert.equal(s.viewState.revealAll, true);
  s.setViewer(1);
  assert.equal(s.viewState.myIndex, 1);
  assert.equal(s.viewState.revealAll, false);
  assert.equal(s.viewState.myTeam, 2);
  s.step(1);
  assert.ok(s.viewState.visible.some((v) => v === 0), 'fog for player 2');
  s.setViewer(-1);
  s.step(1);
  assert.equal(s.viewState.revealAll, true);
  s.setSpeed(4);
  assert.equal(s.ticker.interval, 1000 / 80);
  assert.equal(s.snapEvery(), 2);
  s.nudgeSpeed(1);
  assert.equal(s.speed, 8);
  s.nudgeSpeed(1);
  assert.equal(s.speed, 8);
  s.setPaused(true);
  assert.equal(s.playing, false);
  s.setPaused(false);
  s.hold(true);
  assert.equal(s.playing, false);
  s.hold(false);
  assert.equal(s.playing, true);
  s.sendCommand({ type: 'surrender' }); // no orders in a replay
  s.step(1);
  assert.equal(s.world.players[0].defeated, false);
});

test('the playback clock runs at its speed and stops while paused', () => {
  let t = 0;
  const c = new PlaybackClock(1, () => t);
  c.setRunning(true);
  t = 100;
  assert.equal(c.now(), 100);
  c.setSpeed(4);
  t = 200;
  assert.equal(c.now(), 500);
  c.setRunning(false);
  t = 900;
  assert.equal(c.now(), 500);
});

test('a short game is not kept, and a stopped recorder adds nothing', () => {
  const { setup } = buildSetup(lobby(), 3);
  const host = new HostSession({ setup, myIndex: 0, createWorld, createAI, autoTick: false, useWorker: false });
  const rec = new ReplayRecorder({ world: host.world, setup, myIndex: 0 }).attach();
  host.step(MIN_REPLAY_TICKS - 5);
  assert.equal(rec.finish(), null);
  host.step(10);
  const r = rec.finish({ result: 'victory', winningTeam: 1 });
  assert.ok(r);
  const n = r.cmds.length;
  host.step(100);
  assert.equal(r.cmds.length, n, 'nothing recorded after finish');
  assert.equal(host.world.onCommand, null, 'unhooked');
});

test('compact commands normalize back to the same command', () => {
  const { record } = game();
  const map = { width: 1000, height: 1000 };
  for (const [, , c] of record.cmds.slice(0, 400)) {
    const full = normalizeCommand(c, map);
    assert.deepEqual(compactCommand(full), c);
  }
});

test('sanitizeReplay keeps a good record and refuses a bad one', () => {
  const { record } = game();
  const clean = sanitizeReplay(JSON.parse(JSON.stringify(record)));
  assert.ok(clean);
  assert.equal(clean.cmds.length, record.cmds.length);
  assert.equal(clean.ticks, record.ticks);
  assert.equal(sanitizeReplay({ ...record, setup: { ...record.setup, twist: 'golden' } }).setup.twist, 'golden', 'a daily challenge\'s twist stays');
  assert.equal(sanitizeReplay({ ...record, setup: { ...record.setup, twist: 'nope' } }).setup.twist, undefined);
  assert.equal(sanitizeReplay({ ...record, setup: { ...record.setup, campaign: 'shore' } }).setup.campaign, 'shore', 'a campaign mission stays');
  assert.equal(sanitizeReplay({ ...record, setup: { ...record.setup, campaign: 'toString' } }).setup.campaign, undefined);
  assert.equal(sanitizeReplay({ ...record, format: 99 }), null);
  assert.equal(sanitizeReplay({ ...record, cmds: [[5, 0, { type: 'nope' }]] }), null);
  assert.equal(sanitizeReplay({ ...record, cmds: [[5, 9, { type: 'stop' }]] }), null, 'no such player');
  assert.equal(sanitizeReplay({ ...record, cmds: [[9, 0, { type: 'stop' }], [5, 0, { type: 'stop' }]] }), null, 'out of order');
  assert.equal(sanitizeReplay({ ...record, setup: { players: [] } }), null);
  const named = sanitizeReplay({ ...record, players: record.players.map((p) => ({ ...p, name: '<b>x</b>'.repeat(20) })) });
  assert.ok(named.players[0].name.length <= 32);
  assert.equal(sidesLabel(record), 'Greek vs Norse vs Egyptian');
  assert.equal(resultLabel(record), 'Left early');
  assert.equal(replayMeta(record).cmds, undefined);
});

test('the store keeps the newest replays, compressed, and loads them back', async () => {
  setReplayBackend(memoryBackend());
  try {
    const { record } = game();
    const packed = await packReplay(record);
    assert.ok(packed instanceof Uint8Array, 'gzip in Node');
    assert.ok(packed.byteLength < JSON.stringify(record).length / 5);
    const back = await unpackReplay(packed);
    assert.equal(back.cmds.length, record.cmds.length);
    assert.equal(await unpackReplay(new Uint8Array([1, 2, 3])), null);
    for (let i = 0; i < MAX_REPLAYS + 2; i++) await saveReplay({ ...record, id: `r${i}`, date: 1000 + i });
    const list = await listReplays();
    assert.equal(list.length, MAX_REPLAYS);
    assert.equal(list[0].id, `r${MAX_REPLAYS + 1}`, 'newest first');
    assert.ok(!list.some((m) => m.id === 'r0' || m.id === 'r1'), 'the oldest went');
    assert.equal(list[0].cmds, undefined);
    assert.equal(list[0].commands, record.cmds.length);
    const loaded = await loadReplay('r5');
    assert.equal(loaded.ticks, record.ticks);
    assert.equal(await loadReplay('nope'), null);
    await deleteReplay('r5');
    assert.equal((await listReplays()).length, MAX_REPLAYS - 1);
  } finally {
    setReplayBackend(null);
  }
});

/** The player's own clicks in the carried-on game test, on fixed ticks: train at the Town Center, send the army out. */
function myOrders(host, t) {
  const w = host.world;
  if (t % 300 === 20) {
    const tc = w.buildingList.find((b) => !b.dead && b.owner === 0 && b.type === 'town_center');
    if (tc) host.sendCommand({ type: 'train', building: tc.id, unit: 'worshipper' });
  }
  if (t % 400 === 150) {
    const ids = w.unitList.filter((u) => !u.dead && u.owner === 0).slice(0, 3).map((u) => u.id);
    if (ids.length) host.sendCommand({ type: 'move', units: ids, x: 20 + (t % 7), y: 22 });
  }
}

test('a game saved and carried on keeps one replay of the whole match', async () => {
  const { setup } = buildSetup(lobby(), 23);
  const host = new HostSession({ setup, myIndex: 0, createWorld, createAI, autoTick: false, useWorker: false });
  const rec = new ReplayRecorder({ world: host.world, setup, myIndex: 0, now: () => 1000 }).attach();
  host.viewState.on('snapshot', () => rec.sample());
  host.onChat((line) => rec.chat(line));
  host.start();
  const SAVE_AT = 1500;
  const END = 3000;
  for (let t = 0; t < SAVE_AT; t++) {
    myOrders(host, t);
    host.step(1);
    if (t === 50) host.sendChat('good luck');
  }
  // Save as the F10 menu does (MatchSaver.extras carries the recording), through JSON as the store keeps it.
  const writes = [];
  const store = { writeSave: async (slot, save, info) => (writes.push(JSON.parse(JSON.stringify(save))), { ...info, slot }), saveInfo: () => null, deleteSave: async () => {} };
  const game = {
    session: host, viewState: host.viewState, myIndex: 0, paused: false, disposed: false, recorder: rec,
    hud: { message() {} }, renderer: null, selection: { groups: new Map() }, chronicle: null, career: null, launch: {},
  };
  await new MatchSaver(game, { store }).save('1');
  const carried = writes[0].extra.replay;
  assert.ok(carried && carried.cmds.length > 50, 'the save carries the recording');
  assert.equal(carried.tick, host.world.tickCount);

  // Load it as Game.init does: the loaded world and minds, and a recorder that carries on.
  const loaded = unpackMatch(writes[0]);
  const host2 = new HostSession({
    setup: loaded.world.setup, myIndex: 0, resumed: true, autoTick: false, useWorker: false, createWorld: () => loaded.world,
    createAI: (world, index, difficulty) => loaded.ais.get(index) || createAI(world, index, difficulty),
  });
  const rec2 = ReplayRecorder.resume({ world: host2.world, carried: loaded.extra.replay, now: () => 5000 }).attach();
  host2.viewState.on('snapshot', () => rec2.sample());
  host2.onChat((line) => rec2.chat(line));
  host2.start();
  // The original plays on beside it with the same clicks: the two games stay one.
  for (let t = SAVE_AT; t < END; t++) {
    myOrders(host, t);
    myOrders(host2, t);
    host.step(1);
    host2.step(1);
  }
  assert.equal(worldChecksum(host2.world), worldChecksum(host.world), 'the carried-on game is the same game');

  const record = rec2.finish({ result: null });
  assert.equal(record.ticks, END);
  assert.equal(record.date, 1000, 'dated when the match began');
  assert.ok(record.cmds.some((c) => c[0] < SAVE_AT) && record.cmds.some((c) => c[0] > SAVE_AT));
  assert.ok(record.cmds.some((c) => c[1] === 0 && c[0] > SAVE_AT), 'the player\'s clicks after the load');
  assert.ok(record.chat.some((c) => c[2] === 'good luck'));
  assert.ok(record.sums.some((r) => r[0] < SAVE_AT) && record.sums.some((r) => r[0] > SAVE_AT));
  // Through the store's check, then played from the setup: the same final world, every checksum matching.
  const clean = sanitizeReplay(JSON.parse(JSON.stringify(record)));
  assert.ok(clean);
  const s = playToEnd(play(clean));
  assert.equal(s.world.tickCount, END);
  assert.equal(s.drift, null);
  assert.equal(s.checked, record.sums.length);
  assert.equal(worldChecksum(s.world), worldChecksum(host2.world));
  host.stop();
  host2.stop();
  rec.detach();
});

test('a carried recording that does not fit the loaded game, or is too long, is dropped', () => {
  const { setup } = buildSetup(lobby(), 23);
  const host = new HostSession({ setup, myIndex: 0, createWorld, createAI, autoTick: false, useWorker: false });
  const rec = new ReplayRecorder({ world: host.world, setup, myIndex: 0 }).attach();
  host.start();
  host.step(40);
  const carried = JSON.parse(JSON.stringify(rec.carry()));
  assert.ok(ReplayRecorder.resume({ world: host.world, carried }));
  assert.equal(ReplayRecorder.resume({ world: host.world, carried: { ...carried, tick: carried.tick - 1 } }), null, 'another tick');
  assert.equal(ReplayRecorder.resume({ world: host.world, carried: { ...carried, setup: { ...carried.setup, seed: 99 } } }), null, 'another game');
  assert.equal(ReplayRecorder.resume({ world: host.world, carried: { ...carried, cmds: [[5, 9, {}]] } }), null, 'a bad row');
  assert.equal(ReplayRecorder.resume({ world: host.world, carried: null }), null);
  // Too long to carry: the save goes without it.
  rec.cmds.length = MAX_CARRIED_COMMANDS + 1;
  assert.equal(rec.carry(), null);
  rec.cmds.length = 0;
  rec.truncated = true;
  assert.equal(rec.carry(), null);
  host.stop();
  rec.detach();
});
