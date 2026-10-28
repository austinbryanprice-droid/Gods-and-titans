// Saved games (DESIGN 9.4): the object-graph packer keeps identity, cycles and the odd values JSON
// loses; a match packed mid-game and loaded again carries on tick for tick exactly like the original
// (AI minds and random numbers included); the slot store; and a loaded game's first view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { packGraph, unpackGraph, staticTable, toBase64, fromBase64 } from '../../src/sim/save-graph.js';
import { packMatch, unpackMatch, canSaveSetup } from '../../src/game/save-game.js';
import { writeSave, readSave, listSaves, deleteSave, saveInfo, AUTO_SLOT, savedAgo } from '../../src/game/save-store.js';
import { matchLabel, MatchSaver } from '../../src/game/game-saves.js';
import { createWorld } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { HostSession } from '../../src/net/session.js';
import { tutorialSetup } from '../../src/sim/tutorial.js';
import { BUILDINGS, getUnitType } from '../../src/data/index.js';

test('packGraph keeps identity, cycles, Maps, Sets, typed arrays and odd numbers', () => {
  class Thing {
    constructor() {
      this.n = 1;
    }

    twice() {
      return this.n * 2;
    }
  }
  const shared = { name: 'shared' };
  const root = {
    a: shared, b: [shared, shared], m: new Map([[1, shared], ['k', [1, 2]]]), s: new Set([shared, 3]),
    f32: new Float32Array([1.5, -2.25]), u16: Uint16Array.from([1, 65535, 7]),
    odd: [NaN, Infinity, -Infinity, -0, undefined, null, true, 'x'],
    thing: new Thing(),
  };
  root.self = root;
  shared.back = root;
  const data = JSON.parse(JSON.stringify(packGraph(root, { classes: { Thing } })));
  const r = unpackGraph(data, { classes: { Thing } });
  assert.equal(r.self, r);
  assert.equal(r.a, r.b[0]);
  assert.equal(r.b[1], r.a);
  assert.equal(r.a.back, r);
  assert.equal(r.m.get(1), r.a);
  assert.deepEqual(r.m.get('k'), [1, 2]);
  assert.ok(r.s.has(r.a) && r.s.has(3));
  assert.ok(r.f32 instanceof Float32Array);
  assert.deepEqual([...r.f32], [1.5, -2.25]);
  assert.deepEqual([...r.u16], [1, 65535, 7]);
  assert.ok(Number.isNaN(r.odd[0]));
  assert.equal(r.odd[1], Infinity);
  assert.equal(r.odd[2], -Infinity);
  assert.ok(Object.is(r.odd[3], -0));
  assert.equal(r.odd[4], undefined);
  assert.deepEqual(r.odd.slice(5), [null, true, 'x']);
  assert.ok(r.thing instanceof Thing);
  assert.equal(r.thing.twice(), 2);
});

test('packGraph stores statics by name and refuses functions and unknown classes, saying where', () => {
  const table = { unit: { hp: 10, attack: { damage: 3 } } };
  const statics = staticTable({ table });
  const root = { def: table.unit, atk: table.unit.attack };
  const data = packGraph(root, { statics });
  assert.deepEqual(data.objs[0].o.def, { s: 'table.unit' });
  const r = unpackGraph(data, { statics });
  assert.equal(r.def, table.unit);
  assert.equal(r.atk, table.unit.attack);
  assert.throws(() => packGraph({ units: [{ cb: () => 1 }] }), /function at root\.units\[0\]\.cb/);
  assert.throws(() => packGraph({ when: new Date() }), /class Date at root\.when/);
  for (const n of [0, 1, 2, 3, 4, 5, 300]) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
    assert.deepEqual([...fromBase64(toBase64(bytes))], [...bytes]);
  }
});

function aiSetup(extra = {}) {
  return {
    version: '0.1.0', seed: 11, mapSize: 'small', ...extra,
    players: extra.players || [
      { index: 0, name: 'A', team: 1, pantheon: 'greek', kind: 'ai', difficulty: 'hard' },
      { index: 1, name: 'B', team: 2, pantheon: 'norse', kind: 'ai', difficulty: 'hard' },
    ],
  };
}

function step(world, ais) {
  for (const c of ais.values()) c.tick();
  world.tick();
  world.events.length = 0;
  world.felled.length = 0;
}

/** The whole state as one string (minus the AIs' think timings, which are wall-clock). */
function fingerprint(world, ais) {
  for (const c of ais.values()) c.ai.stats.thinkMs = 0;
  world.perf.lastTickMs = 0;
  return JSON.stringify(packMatch(world, ais).graph);
}

/** Play `before` seconds, save, load, then play `after` seconds on both: they must stay identical. */
function roundTrip(setup, before, after) {
  const world = createWorld(setup);
  const ais = new Map(setup.players.map((p) => [p.index, createAI(world, p.index, p.difficulty)]));
  while (world.time < before && !world.gameOver) step(world, ais);
  const text = JSON.stringify(packMatch(world, ais, { note: 'hi' }));
  const loaded = unpackMatch(JSON.parse(text));
  assert.equal(loaded.extra.note, 'hi');
  assert.equal(loaded.world.tickCount, world.tickCount);
  assert.equal(fingerprint(loaded.world, loaded.ais), fingerprint(world, ais), 'the loaded state differs from the saved one');
  const end = world.time + after;
  while (world.time < end && !world.gameOver) {
    step(world, ais);
    step(loaded.world, loaded.ais);
  }
  assert.equal(fingerprint(loaded.world, loaded.ais), fingerprint(world, ais), 'the loaded game went its own way');
  return { world, loaded, bytes: text.length };
}

test('a saved AI-vs-AI match carries on exactly like the original after loading', () => {
  const { world, loaded, bytes } = roundTrip(aiSetup(), 7 * 60, 90);
  // The data tables are shared, not copied: every entity points at the game's own unit and building types.
  for (const u of loaded.world.unitList) assert.equal(u.def, getUnitType(u.type));
  for (const b of loaded.world.buildingList) assert.equal(b.def, BUILDINGS[b.type]);
  assert.ok(world.unitList.length > 30, `only ${world.unitList.length} units`);
  assert.ok(bytes < 1.5e6, `save is ${bytes} bytes`);
});

test('a Trial of the Titans, a Decade of Peace and a Sacred Victory game survive a save too', () => {
  roundTrip(aiSetup({ survival: true, players: [{ index: 0, name: 'A', team: 1, pantheon: 'egyptian', kind: 'ai', difficulty: 'normal' }] }), 4 * 60, 60);
  roundTrip(aiSetup({ peaceMinutes: 2 }), 100, 60);
  roundTrip(aiSetup({ sacredVictory: true, seed: 5 }), 4 * 60, 40);
});

test('only solo games against the computer can be saved, not the guided first match', () => {
  assert.equal(canSaveSetup(aiSetup({ players: [{ index: 0, kind: 'human' }, { index: 1, kind: 'ai' }] })), true);
  assert.equal(canSaveSetup(aiSetup({ players: [{ index: 0, kind: 'human' }, { index: 1, kind: 'human' }] })), false);
  assert.equal(canSaveSetup(tutorialSetup({ name: 'Me', version: '0.1.0' })), false);
});

test('a save from another format is refused with a plain message', () => {
  assert.throws(() => unpackMatch({ format: 99, setup: {}, graph: {} }), /another version/);
});

function fakeStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

function fakeBackend() {
  const m = new Map();
  return { get: async (k) => m.get(k), set: async (k, v) => m.set(k, v), delete: async (k) => m.delete(k), m };
}

test('slots: write, list newest first, read back, delete', async () => {
  const store = fakeStore();
  const backend = fakeBackend();
  await writeSave('2', { format: 1, a: [1, 2, 3] }, { label: 'Two', time: 61 }, { store, backend, now: 1000 });
  await writeSave(AUTO_SLOT, { format: 1, b: 'x'.repeat(5000) }, { label: 'Auto', time: 300 }, { store, backend, now: 2000 });
  assert.deepEqual(listSaves(store).map((s) => s.slot), [AUTO_SLOT, '2']);
  assert.equal(saveInfo('2', store).label, 'Two');
  // gzipped where the platform can (Node 18+ and current browsers): far smaller than the text
  assert.ok(saveInfo(AUTO_SLOT, store).bytes < 1000);
  assert.deepEqual(await readSave('2', { backend }), { format: 1, a: [1, 2, 3] });
  assert.equal((await readSave(AUTO_SLOT, { backend })).b.length, 5000);
  assert.equal(await readSave('3', { backend }), null);
  await deleteSave('2', { store, backend });
  assert.deepEqual(listSaves(store).map((s) => s.slot), [AUTO_SLOT]);
  await assert.rejects(writeSave('9', {}, {}, { store, backend }), /No save slot/);
  assert.equal(savedAgo(1000, 1000 + 30e3), 'just now');
  assert.equal(savedAgo(1000, 1000 + 5 * 60e3), '5 min ago');
});

test('the slot label names the sides and the map', () => {
  const world = createWorld(aiSetup({ players: [
    { index: 0, name: 'Me', team: 1, pantheon: 'greek', kind: 'human' },
    { index: 1, name: 'B', team: 2, pantheon: 'norse', kind: 'ai', difficulty: 'hard' },
  ] }));
  assert.equal(matchLabel(world, 0), 'Greek vs Norse (Hard) · small map');
});

test('a loaded game opens with the felled trees down and the computer players thinking where they left off', () => {
  const setup = aiSetup({ players: [
    { index: 0, name: 'Me', team: 1, pantheon: 'greek', kind: 'human' },
    { index: 1, name: 'B', team: 2, pantheon: 'norse', kind: 'ai', difficulty: 'hard' },
  ] });
  const world = createWorld(setup);
  const ais = new Map([[1, createAI(world, 1, 'hard')]]);
  // My workers stand idle; the AI chops wood, so trees fall.
  while (world.felledAll.length < 3 && world.time < 600) step(world, ais);
  assert.ok(world.felledAll.length >= 3, 'no trees felled');
  const loaded = unpackMatch(JSON.parse(JSON.stringify(packMatch(world, ais))));
  const session = new HostSession({
    setup: loaded.world.setup, myIndex: 0, resumed: true, autoTick: false, useWorker: false,
    createWorld: () => loaded.world, createAI: (w, i) => loaded.ais.get(i),
  });
  assert.equal(session.world, loaded.world);
  assert.equal(session.ais.get(1).ai, loaded.ais.get(1).ai);
  const vs = session.viewState;
  for (const [tx, ty] of world.felledAll) assert.ok(vs.felledAll.some(([x, y]) => x === tx && y === ty), `tree ${tx},${ty} still standing`);
  assert.equal(vs.time, world.time);
  session.stop();
});

test('MatchSaver: saves solo games only, autosaves on the game clock, forgets its autosave when the match ends', async () => {
  const writes = [];
  const deletes = [];
  let auto = null;
  const store = {
    writeSave: async (slot, save, info) => {
      writes.push([slot, save, info]);
      if (slot === AUTO_SLOT) auto = { ...info, slot };
      return { ...info, slot };
    },
    saveInfo: () => auto,
    deleteSave: async (slot) => deletes.push(slot),
  };
  const setup = aiSetup({ players: [
    { index: 0, name: 'Me', team: 1, pantheon: 'greek', kind: 'human' },
    { index: 1, name: 'B', team: 2, pantheon: 'norse', kind: 'ai', difficulty: 'easy' },
  ] });
  const session = new HostSession({ setup, myIndex: 0, autoTick: false, useWorker: false, createWorld, createAI });
  const messages = [];
  const game = {
    session, viewState: session.viewState, myIndex: 0, paused: false, disposed: false,
    hud: { message: (t) => messages.push(t) }, renderer: null, selection: { groups: new Map([[1, [5]]]) },
    chronicle: { samples: [{ t: 0 }], peakArmy: [1], next: 30 }, career: null, launch: { skirmish: { mapSize: 'small' } },
  };
  const saver = new MatchSaver(game, { store });
  assert.ok(saver.canSave());
  saver.tick(); // too early
  assert.equal(writes.length, 0);
  session.viewState.time = 181;
  saver.tick();
  await saver.busy;
  assert.equal(writes.length, 1);
  const [slot, save, info] = writes[0];
  assert.equal(slot, AUTO_SLOT);
  assert.equal(info.label, 'Greek vs Norse (Easy) · small map');
  assert.deepEqual(info.skirmish, { mapSize: 'small' });
  assert.deepEqual(save.extra.groups, [[1, [5]]]);
  assert.equal(save.extra.nextAuto, 360);
  assert.deepEqual(messages, ['Game autosaved.']);
  saver.tick(); // not again until the next mark
  assert.equal(writes.length, 1);
  await saver.save('2');
  assert.equal(writes[1][0], '2');
  saver.onGameOver();
  assert.deepEqual(deletes, [AUTO_SLOT]);
  game.viewState.gameOver = { winningTeam: 1 };
  assert.equal(saver.canSave(), false);
  session.stop();

  const tut = new HostSession({ setup: tutorialSetup({ name: 'Me', version: '0.1.0' }), myIndex: 0, autoTick: false, useWorker: false, createWorld, createAI });
  assert.equal(new MatchSaver({ ...game, session: tut, viewState: tut.viewState }, { store }).canSave(), false);
  tut.stop();
});
