import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_QUEUE } from '../../src/config.js';
import { UNITS, BUILDINGS, ABILITIES, producibleAt } from '../../src/data/index.js';
import { makeWorld, spawn, place } from './helpers.js';

// Robustness (DESIGN 6.2 / 7): World.issueCommand takes untrusted input. Any
// value, for any player index, must neither throw (now or at the next tick)
// nor corrupt the world.

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = ['move', 'attackMove', 'patrol', 'attack', 'smart', 'gather', 'pray', 'returnCargo', 'build', 'train', 'cancelTrain', 'upgradeTier', 'cancelBuild', 'rally', 'stop', 'hold', 'cast', 'surrender'];
const FIELDS = ['units', 'target', 'x', 'y', 'tx', 'ty', 'building', 'unit', 'ability', 'index', 'queue', 'player', 'type'];
const NASTY_STRINGS = ['', 'x', '__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf', 'length', '0', 'NaN', 'x'.repeat(5000)];
const NASTY_NUMBERS = [0, -0, 1, -1, 0.5, 2.5, 1e308, -1e308, Number.MAX_SAFE_INTEGER, 2 ** 53 + 2, 2 ** 31, -(2 ** 31), NaN, Infinity, -Infinity, 1e-320];

function generator(world, seed) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const W = world.map.width;
  const ids = () => [...world.entities.keys()];
  const own = (p) => world.unitList.filter((u) => u.owner === p).map((u) => u.id);
  const unitTypes = Object.keys(UNITS);
  const buildingTypes = Object.keys(BUILDINGS);
  const abilityIds = Object.keys(ABILITIES);

  function value(depth = 0) {
    const k = r();
    if (k < 0.25) return pick(NASTY_NUMBERS);
    if (k < 0.4) return (r() - 0.1) * W * 1.2;
    if (k < 0.5) {
      const all = ids();
      return all.length ? pick(all) + Math.floor(r() * 3) - 1 : 1;
    }
    if (k < 0.6) return pick(NASTY_STRINGS);
    if (k < 0.66) return pick([...unitTypes.slice(0, 8), ...buildingTypes, ...abilityIds.slice(0, 8)]);
    if (k < 0.72) return pick([true, false, null, undefined]);
    if (k < 0.8 && depth < 2) return Array.from({ length: Math.floor(r() * 6) }, () => value(depth + 1));
    if (k < 0.86) return pick([{}, { valueOf: 1, toString: 2 }, Object.create(null), { id: 1 }, { x: 1, y: 2 }, JSON.parse('{"__proto__": {"x": 1}}')]);
    if (k < 0.9) return pick([() => 1, Symbol('s'), 10n]);
    return pick(NASTY_NUMBERS);
  }

  function field(p, f) {
    // Plausible values half of the time so commands actually do things.
    if (r() < 0.5) {
      switch (f) {
        case 'units': return r() < 0.9 ? own(p).slice(0, 1 + Math.floor(r() * 12)) : own(1 - p);
        case 'target': { const all = ids(); return all.length ? pick(all) : 0; }
        case 'x': case 'y': return r() * W;
        case 'tx': case 'ty': return Math.floor(r() * W);
        case 'building': {
          if (r() < 0.5) return pick(buildingTypes);
          const bs = world.buildingList.filter((b) => b.owner === p);
          return bs.length ? pick(bs).id : 0;
        }
        case 'unit': {
          if (r() < 0.5) return pick(['worshipper', 'warrior', 'archer', 'priest', ...unitTypes]);
          const us = own(p);
          return us.length ? pick(us) : 0;
        }
        case 'ability': return pick(abilityIds);
        case 'index': return Math.floor(r() * 7) - 1;
        case 'queue': return r() < 0.5;
        default: return value();
      }
    }
    return value();
  }

  /** A well-formed command of a random type for player p (so the fuzz reaches deep code paths). */
  function template(p) {
    const us = world.unitList.filter((u) => u.owner === p);
    const ws = us.filter((u) => u.def.class === 'worker');
    const some = (list) => list.filter(() => r() < 0.5).map((u) => u.id);
    const bs = world.buildingList.filter((b) => b.owner === p);
    const enemies = [...world.entities.values()].filter((e) => e.owner !== p && e.kind !== 'mine');
    const near = () => (p === 0 ? 6 : 34) + r() * 14;
    const type = pick(TYPES);
    switch (type) {
      case 'move': case 'attackMove': case 'patrol': case 'stop': case 'hold': return { type, units: some(us), x: r() * W, y: r() * W, queue: r() < 0.3 };
      case 'attack': return { type, units: some(us), target: enemies.length ? pick(enemies).id : 0 };
      case 'smart': return { type, units: some(us), target: r() < 0.5 && ids().length ? pick(ids()) : 0, x: r() * W, y: r() * W, tx: Math.floor(r() * W), ty: Math.floor(r() * W), queue: r() < 0.3 };
      case 'gather': return r() < 0.5 ? { type, units: some(ws), target: world.mineList.length ? pick(world.mineList).id : 0 } : { type, units: some(ws), tx: 4 + Math.floor(r() * 6), ty: 16 + Math.floor(r() * 3) };
      case 'pray': return { type, units: some(ws), target: bs.length ? pick(bs).id : 0 };
      case 'returnCargo': return { type, units: some(ws) };
      case 'build': return { type, units: some(ws), building: pick(buildingTypes), tx: Math.floor(near()), ty: Math.floor(near()), queue: r() < 0.3 };
      case 'train': {
        const b = bs.length ? pick(bs) : null;
        const opts = b ? producibleAt(b.type, world.players[p].pantheon) : [];
        return { type, building: b ? b.id : 0, unit: opts.length ? pick(opts) : 'worshipper' };
      }
      case 'cancelTrain': return { type, building: bs.length ? pick(bs).id : 0, index: Math.floor(r() * 4) - 1 };
      case 'upgradeTier': case 'cancelBuild': return { type, building: bs.length ? pick(bs).id : 0 };
      case 'rally': return { type, building: bs.length ? pick(bs).id : 0, x: r() * W, y: r() * W, target: r() < 0.3 && ids().length ? pick(ids()) : 0 };
      case 'cast': {
        const casters = us.filter((u) => u.def.abilities.length);
        const c = casters.length ? pick(casters) : null;
        return { type, unit: c ? c.id : 0, ability: c ? pick(c.def.abilities).id : 'x', x: r() * W, y: r() * W, target: enemies.length && r() < 0.6 ? pick(enemies).id : us.length ? pick(us).id : 0 };
      }
      default: return { type };
    }
  }

  function command(p) {
    const k = r();
    if (k < 0.03) return value();
    if (k < 0.05) return { type: value() };
    if (k < 0.5) {
      // Well-formed, then 0–2 fields replaced with garbage.
      const cmd = template(p);
      const bad = Math.floor(r() * 3);
      for (let i = 0; i < bad; i++) cmd[pick(FIELDS)] = value();
      return cmd;
    }
    const cmd = { type: r() < 0.9 ? pick(TYPES) : pick(NASTY_STRINGS) };
    for (const f of FIELDS) {
      if (f === 'type') continue;
      if (r() < 0.55) cmd[f] = field(p, f);
    }
    if (r() < 0.002) cmd.units = Array.from({ length: 200000 }, (_, i) => i);
    return cmd;
  }

  function player() {
    return r() < 0.97 ? Math.floor(r() * 2) : pick([-1, 2, 7, 0.5, NaN, '0', null, undefined, {}, 1e308]);
  }

  return { command, player, r };
}

function finiteReplacer(path) {
  return function (key, v) {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`non-finite number at ${path}.${key}: ${v}`);
    return v;
  };
}

/** The world is in a sane state. */
function checkInvariants(world, where) {
  const W = world.map.width;
  const H = world.map.height;
  for (const p of world.players) {
    for (const k of ['gold', 'wood', 'faith', 'popUsed', 'popCap']) {
      assert.ok(Number.isFinite(p[k]) && p[k] >= 0, `${where}: player ${p.index} ${k} = ${p[k]}`);
    }
  }
  for (const u of world.unitList) {
    if (u.dead) continue;
    assert.equal(world.entities.get(u.id), u, `${where}: unit ${u.id} not indexed`);
    assert.ok(Number.isFinite(u.x) && Number.isFinite(u.y), `${where}: unit ${u.id} at ${u.x},${u.y}`);
    assert.ok(u.x >= 0 && u.y >= 0 && u.x <= W && u.y <= H, `${where}: unit ${u.id} off the map at ${u.x},${u.y}`);
    assert.ok(Number.isFinite(u.hp) && u.hp > 0 && u.hp <= u.maxHp + 1e-6, `${where}: unit ${u.id} hp ${u.hp}/${u.maxHp}`);
    assert.ok(Number.isFinite(u.facing), `${where}: unit ${u.id} facing ${u.facing}`);
    if (u.mana !== undefined) assert.ok(Number.isFinite(u.mana) && u.mana >= 0, `${where}: unit ${u.id} mana ${u.mana}`);
    assert.ok(Array.isArray(u.orders) && u.orders.length < 10000, `${where}: unit ${u.id} order queue ${u.orders.length}`);
    const o = u.order;
    if (o) {
      for (const k of ['x', 'y']) if (o[k] !== undefined) assert.ok(Number.isFinite(o[k]), `${where}: unit ${u.id} order ${o.type}.${k} = ${o[k]}`);
    }
  }
  for (const b of world.buildingList) {
    if (b.dead) continue;
    assert.ok(Number.isInteger(b.tx) && Number.isInteger(b.ty) && b.tx >= 0 && b.ty >= 0 && b.tx + b.size <= W && b.ty + b.size <= H, `${where}: building ${b.id} at ${b.tx},${b.ty}`);
    assert.ok(Number.isFinite(b.hp) && b.hp > 0 && b.hp <= b.maxHp + 1e-6, `${where}: building ${b.id} hp ${b.hp}/${b.maxHp}`);
    assert.ok(b.queue.length <= MAX_QUEUE, `${where}: building ${b.id} queue ${b.queue.length}`);
    if (b.rally) assert.ok(Number.isFinite(b.rally.x) && Number.isFinite(b.rally.y), `${where}: rally ${b.rally.x},${b.rally.y}`);
  }
  for (const m of world.mineList) assert.ok(Number.isFinite(m.amount) && m.amount >= 0, `${where}: mine ${m.id} amount ${m.amount}`);
}

function fuzzWorld() {
  const w = makeWorld({ map: { width: 48, height: 48, forest: [{ x: 4, y: 16, w: 6, h: 3 }, { x: 30, y: 28, w: 4, h: 4 }] } });
  // Give both sides something to command: an army, a god, a shrine, a barracks.
  for (let p = 0; p < 2; p++) {
    const tc = w.buildingsOf(p)[0];
    for (let i = 0; i < 4; i++) spawn(w, p, i % 2 ? 'archer' : 'warrior', tc.x + 3 + i * 0.8, tc.y + 3);
    // A wounded enemy scout next to the army, so every run has a fight to the death.
    spawn(w, 1 - p, 'warrior', tc.x + 4, tc.y + 6).hp = 1;
    spawn(w, p, p ? 'norse_thor' : 'greek_zeus', tc.x + 3, tc.y + 4.5);
    spawn(w, p, 'priest', tc.x + 4, tc.y + 4.5);
    w.players[p].gold = 5000;
    w.players[p].wood = 5000;
    w.players[p].faith = 5000;
  }
  place(w, 0, 'shrine', 6, 12);
  place(w, 0, 'barracks', 12, 12);
  place(w, 1, 'barracks', 32, 34);
  for (let i = 0; i < 4; i++) {
    place(w, 0, 'house', 2 + i * 2, 2);
    place(w, 1, 'house', 44 - i * 2, 44);
  }
  w.recomputePop();
  return w;
}

test('fuzz: thousands of random and malformed commands never throw or corrupt the world', () => {
  const seen = {};
  for (const seed of [1, 2, 3]) {
    const w = fuzzWorld();
    const g = generator(w, seed);
    let issued = 0;
    for (let tick = 0; tick < 600 && !w.gameOver; tick++) {
      const n = Math.floor(g.r() * 8);
      for (let i = 0; i < n; i++) {
        const p = g.player();
        const cmd = g.command(typeof p === 'number' && p >= 0 && p < 2 ? p : 0);
        if (cmd && typeof cmd === 'object' && cmd.type === 'surrender') cmd.type = 'stop'; // keep the game going
        assert.doesNotThrow(() => w.issueCommand(p, cmd), `seed ${seed} tick ${tick}: issueCommand(${String(p)}, ${safeStr(cmd)})`);
        issued++;
      }
      assert.doesNotThrow(() => w.tick(), `seed ${seed} tick ${tick}`);
      for (const e of w.events) seen[e.type] = (seen[e.type] || 0) + 1;
      checkInvariants(w, `seed ${seed} tick ${tick}`);
      if (tick % 25 === 0) {
        const snap = w.getSnapshot();
        JSON.stringify(snap, finiteReplacer(`seed ${seed} tick ${tick} snapshot`));
      }
    }
    assert.ok(issued > 1500, `issued ${issued}`);
    assert.equal(w.perf.commandErrors, 0, `no command threw inside the sim: ${w.perf.lastCommandError}`);
  }
  // The fuzz reached deep code: production, construction, spells, fights.
  for (const t of ['spawn', 'construction', 'cast', 'attack', 'death', 'error']) assert.ok(seen[t] > 0, `no ${t} event (${JSON.stringify(seen)})`);
});

test('issueCommand tolerates any player index and non-object commands', () => {
  const w = fuzzWorld();
  const junk = [undefined, null, 0, 1, NaN, '', 'move', [], [1, 2], () => {}, Symbol('x'), 10n, true, { type: 'move' }, { type: 'move', units: 'abc' }, { type: { toString: 1 } }];
  for (const p of [0, 1, -1, 2, 99, 0.5, NaN, Infinity, '0', null, undefined, {}, []]) {
    for (const c of junk) assert.doesNotThrow(() => w.issueCommand(p, c));
  }
  // A command object whose fields throw when read is dropped.
  const hostile = new Proxy({}, { get() { throw new Error('boom'); } });
  assert.doesNotThrow(() => w.issueCommand(0, hostile));
  assert.doesNotThrow(() => w.tick());
  checkInvariants(w, 'junk');
});

test('commands are copied when issued: later changes to the object do nothing', () => {
  const w = fuzzWorld();
  const u = w.unitList.find((e) => e.owner === 0 && e.type === 'warrior');
  const cmd = { type: 'move', units: [u.id], x: 20, y: 20 };
  w.issueCommand(0, cmd);
  cmd.x = NaN;
  cmd.units.push(...w.unitList.filter((e) => e.owner === 1).map((e) => e.id));
  w.tick();
  assert.equal(u.order.type, 'move');
  assert.ok(Number.isFinite(u.order.x));
  assert.ok(Math.hypot(u.order.x - 20, u.order.y - 20) < 3);
  assert.ok(w.unitList.filter((e) => e.owner === 1).every((e) => !e.order || e.order.type !== 'move'));
});

test('a flood of commands is capped per player per tick; others still get through', () => {
  const w = fuzzWorld();
  const mine = w.unitList.find((e) => e.owner === 0 && e.type === 'warrior');
  const theirs = w.unitList.find((e) => e.owner === 1 && e.type === 'warrior');
  for (let i = 0; i < 100000; i++) w.issueCommand(1, { type: 'hold', units: [theirs.id] });
  w.issueCommand(0, { type: 'move', units: [mine.id], x: 30, y: 30 });
  assert.ok(w.cmdQueue.length < 2000, `queued ${w.cmdQueue.length}`);
  const t0 = performance.now();
  w.tick();
  assert.ok(performance.now() - t0 < 500);
  assert.equal(mine.order && mine.order.type, 'move');
  assert.equal(theirs.order && theirs.order.type, 'hold');
});

test('huge coordinates and odd ids are clamped or ignored', () => {
  const w = fuzzWorld();
  const us = w.unitList.filter((e) => e.owner === 0 && e.def.attack).map((e) => e.id);
  const bar = w.buildingList.find((b) => b.owner === 0 && b.type === 'barracks');
  w.issueCommand(0, { type: 'move', units: us, x: 1e308, y: -1e308 });
  w.issueCommand(0, { type: 'rally', building: bar.id, x: 1e300, y: 5 });
  w.issueCommand(0, { type: 'build', units: us, building: 'house', tx: 1e308, ty: 1 });
  w.issueCommand(0, { type: 'train', building: bar.id, unit: '__proto__' });
  w.issueCommand(0, { type: 'train', building: bar.id, unit: 'constructor' });
  w.issueCommand(0, { type: 'cancelTrain', building: bar.id, index: 1e308 });
  w.issueCommand(0, { type: 'cast', unit: us[0], ability: '__proto__', x: 1, y: 1 });
  for (let i = 0; i < 100; i++) w.tick();
  checkInvariants(w, 'huge');
  assert.ok(bar.rally && bar.rally.x <= w.map.width);
  assert.equal(bar.queue.length, 0);
});

function safeStr(v) {
  try {
    return JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : typeof x === 'string' && x.length > 40 ? `${x.slice(0, 40)}…` : x))?.slice(0, 300);
  } catch {
    return String(typeof v);
  }
}
