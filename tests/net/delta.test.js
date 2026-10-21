import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, apply, same } from '../../src/net/delta.js';
import { FakeWorld } from '../../src/net/fake-world.js';
import { RNG } from '../../src/sim/rng.js';

const json = (v) => JSON.parse(JSON.stringify(v));

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

// ---- an independent random snapshot generator (not the FakeWorld) ----

const OPTIONAL = {
  lv: (r) => r.int(1, 6),
  xp: (r) => r.int(0, 1400),
  ex: (r) => Math.round(r.range(0, 30) * 10) / 10,
  bo: (r) => ({ b: r.pick(['house', 'barracks']), tx: r.int(0, 90), ty: r.int(0, 90) }),
  tr: (r) => r.int(1, 3),
  pr: (r) => r.int(0, 5),
  amt: (r) => r.int(0, 12000),
  rp: (r) => (r.chance(0.3) ? null : [r.int(0, 9000) / 100, r.int(0, 9000) / 100]),
  mn: (r) => r.int(0, 2),
  mw: () => 1,
};
const OPT_KEYS = Object.keys(OPTIONAL);

function randomEntity(r, id) {
  const e = {
    id, k: r.pick(['u', 'u', 'u', 'b', 'm']), t: r.pick(['warrior', 'house', 'greek_zeus', 'gold_mine']), o: r.int(-1, 3),
    x: r.int(0, 9600) / 100, y: r.int(0, 9600) / 100, f: r.int(-314, 314) / 100,
    hp: r.int(1, 1000), mhp: 1000, sh: 0, st: r.pick(['idle', 'move', 'attack']), tg: 0,
    c: r.pick([0, 'g', 'w']), cd: {}, fx: [], q: [],
  };
  for (const k of OPT_KEYS) if (r.chance(0.3)) e[k] = OPTIONAL[k](r);
  return e;
}

function mutateEntity(r, pe) {
  const e = { ...pe };
  const roll = r.next();
  if (roll < 0.5) {
    e.x = r.int(0, 9600) / 100;
    e.y = r.int(0, 9600) / 100;
    if (r.chance(0.5)) e.f = r.int(-314, 314) / 100;
  } else if (roll < 0.7) {
    e.hp = r.int(0, 1000);
    if (r.chance(0.3)) e.st = r.pick(['idle', 'move', 'attack', 'cast']);
  } else if (roll < 0.85) {
    const k = r.pick(OPT_KEYS);
    if (k in e) delete e[k];
    else e[k] = OPTIONAL[k](r);
  } else {
    const which = r.int(0, 3);
    if (which === 0) e.cd = r.chance(0.5) ? {} : { a: r.int(1, 9), b: r.int(1, 9) };
    else if (which === 1) e.fx = r.chance(0.5) ? [] : ['stun', 'slow'].slice(0, r.int(1, 2));
    else if (which === 2) e.q = r.chance(0.5) ? [] : [{ u: 'worshipper', p: r.int(0, 99) / 100 }, { u: 'tier_up', p: 0 }];
    else e.tg = r.int(0, 50);
  }
  return e;
}

function randomPlayer(r, i) {
  return {
    i, name: `P${i}`, team: (i % 2) + 1, pantheon: 'greek', color: '#d63a3a', kind: 'human',
    gold: r.int(0, 2000), wood: r.int(0, 2000), faith: r.int(0, 900), faithRate: r.int(0, 30) / 10,
    pop: r.int(0, 150), popCap: 150, tier: r.int(1, 3), defeated: r.chance(0.05), gods: ['greek_zeus'],
    fallen: r.chance(0.2) ? { greek_hades: 3 } : {}, titan: r.chance(0.1),
    stats: { gathered: r.int(0, 9000), unitsTrained: 3, kills: r.int(0, 50), losses: 0, buildings: 4 },
  };
}

function nextSnapshot(r, prev, nextId) {
  let entities = [];
  for (const pe of prev.entities) {
    if (r.chance(0.04)) continue; // removed
    entities.push(r.chance(0.4) ? mutateEntity(r, pe) : (r.chance(0.5) ? pe : { ...pe }));
  }
  const adds = r.chance(0.3) ? r.int(1, 4) : 0;
  for (let i = 0; i < adds; i++) entities.push(randomEntity(r, nextId.v++));
  if (r.chance(0.03)) entities = r.shuffle(entities.slice()); // arbitrary order now and then
  let players = prev.players.map((p, i) => (r.chance(0.3) ? randomPlayer(r, i) : p));
  if (r.chance(0.02)) players = Array.from({ length: r.int(1, 4) }, (_, i) => randomPlayer(r, i));
  const events = r.chance(0.6) ? Array.from({ length: r.int(1, 5) }, () => ({ type: 'hit', dst: r.int(1, 99), amount: r.int(1, 99), src: r.int(1, 99) })) : [];
  const felled = r.chance(0.2) ? [[r.int(0, 95), r.int(0, 95)]] : [];
  const fields = r.chance(0.3) ? [{ id: 1, x: 5, y: 6, r: 2, el: 'fire', rem: r.int(0, 40) / 10 }] : prev.fields;
  const reveals = r.chance(0.1) ? [] : r.chance(0.1) ? [{ x: 1, y: 2, r: 6, tm: 1, rem: 3 }] : prev.reveals;
  const snap = {
    tick: prev.tick + 1,
    time: Math.round((prev.tick + 1) * 5) / 100,
    players, entities, fields, reveals, events, felled,
    gameOver: r.chance(0.02) ? { winningTeam: r.int(1, 2) } : r.chance(0.5) ? prev.gameOver : null,
  };
  if (r.chance(0.05)) snap.extraKey = { n: r.int(0, 9) }; // keys appearing / disappearing
  else if ('extraKey' in prev && r.chance(0.7)) snap.extraKey = prev.extraKey;
  return snap;
}

function initialSnapshot(r, n, nextId) {
  return {
    tick: 0, time: 0,
    players: [randomPlayer(r, 0), randomPlayer(r, 1)],
    entities: Array.from({ length: n }, () => randomEntity(r, nextId.v++)),
    fields: [], reveals: [], events: [], felled: [], gameOver: null,
  };
}

test('same() is structural', () => {
  assert.ok(same({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert.ok(!same({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!same({ a: 1, b: undefined }, { a: 1, c: undefined }));
  assert.ok(!same([1, 2], { 0: 1, 1: 2 }));
  assert.ok(!same(null, {}));
  assert.ok(same(0, -0));
});

test('delta round-trips a long randomized snapshot sequence exactly', () => {
  const r = new RNG(42);
  const nextId = { v: 1 };
  let prev = initialSnapshot(r, 60, nextId);
  let client = json(prev); // what a client reconstructs from JSON deltas
  let usedOrder = 0;
  let usedRemovedKeys = 0;
  let usedMove = 0;
  for (let i = 0; i < 3000; i++) {
    const next = nextSnapshot(r, prev, nextId);
    const d = encode(prev, next);
    if (d.o) usedOrder++;
    if (d.cr) usedRemovedKeys++;
    if (d.m || d.mf) usedMove++;
    deepFreeze(prev);
    const out = apply(prev, d);
    assert.deepStrictEqual(out, next, `step ${i}`);
    client = apply(client, json(d));
    assert.deepStrictEqual(client, json(next), `client step ${i}`);
    prev = next;
  }
  assert.ok(usedOrder > 10 && usedRemovedKeys > 100 && usedMove > 100, 'all code paths exercised');
});

test('delta from nothing and to an empty world', () => {
  const r = new RNG(7);
  const nextId = { v: 1 };
  const s = initialSnapshot(r, 10, nextId);
  s.events = [{ type: 'spawn', id: 1, t: 'warrior', o: 0 }];
  s.felled = [[3, 4]];
  s.gameOver = { winningTeam: 2 };
  assert.deepStrictEqual(apply(null, encode(null, s)), s);
  const empty = { ...s, tick: 1, entities: [], players: [], events: [], felled: [], gameOver: null };
  delete empty.reveals;
  assert.deepStrictEqual(apply(s, encode(s, empty)), empty);
  // Unchanged snapshot → tiny delta.
  const again = { ...s, tick: 2, events: [], felled: [] };
  const d = encode(s, again);
  assert.deepEqual(Object.keys(d).sort(), ['b', 'tick', 'time']);
  assert.deepStrictEqual(apply(s, d), again);
});

test('delta carries events, felled and gameOver; unchanged entities stay shared', () => {
  const r = new RNG(9);
  const nextId = { v: 1 };
  const a = initialSnapshot(r, 5, nextId);
  const b = { ...a, tick: 1, entities: a.entities.slice(), events: [{ type: 'treeFelled', tx: 1, ty: 2 }], felled: [[1, 2]], gameOver: { winningTeam: 1 } };
  b.entities[2] = { ...b.entities[2], hp: 1 };
  const d = encode(a, b);
  assert.ok(Array.isArray(d.e[0]) && d.e[0].length === 3, 'known event shapes are packed as arrays');
  assert.deepEqual(apply(a, json(d)).events, b.events);
  assert.deepEqual(d.fl, [[1, 2]]);
  assert.deepEqual(d.x, { gameOver: { winningTeam: 1 } });
  const out = apply(a, d);
  assert.deepStrictEqual(out, b);
  assert.equal(out.entities[0], a.entities[0], 'unchanged entity object reused');
  assert.notEqual(out.entities[2], a.entities[2]);
});

test('delta packs bounty events, with and without the resource they pay in', () => {
  const r = new RNG(5);
  const a = initialSnapshot(r, 3, { v: 1 });
  const events = [
    { type: 'bounty', player: 0, amount: 25, x: 10.5, y: 20.25 }, // a creep's gold, as before
    { type: 'bounty', player: 1, amount: 16, x: 3, y: 4, res: 'g' }, // Norse plunder
    { type: 'bounty', player: 0, amount: 6, x: 12.5, y: 7, res: 'f' }, // Aztec sacrifice
  ];
  const b = { ...a, tick: 1, events };
  const d = encode(a, b);
  assert.deepEqual(d.e.map((e) => e.length), [5, 6, 6], 'packed as arrays; the plain gold bounty keeps its short shape, the others carry res');
  const out = apply(a, json(d)).events;
  assert.deepEqual(out.map((e) => [e.player, e.amount, e.res || 'g']), [[0, 25, 'g'], [1, 16, 'g'], [0, 6, 'f']]);
  assert.deepEqual(out, events.map((e) => ({ ...e })));
});

test('delta round-trips FakeWorld streams (big snapshots, small deltas)', () => {
  const setup = { seed: 11, mapSize: 'small', players: [0, 1, 2].map((i) => ({ index: i, name: `P${i}`, team: i + 1, pantheon: 'greek', color: '#fff', kind: 'human' })) };
  const w = new FakeWorld(setup, { units: 500, buildings: 8, churn: 3, gameOverTick: 700 });
  let prev = w.getSnapshot();
  let client = json(prev);
  let fullChars = JSON.stringify(prev).length;
  let deltaChars = 0;
  for (let i = 0; i < 800; i++) {
    w.tick();
    const next = w.getSnapshot();
    const d = encode(prev, next);
    const wire = JSON.stringify(d);
    deltaChars += wire.length;
    client = apply(client, JSON.parse(wire));
    assert.deepStrictEqual(client, json(next), `tick ${next.tick}`);
    prev = next;
  }
  assert.ok(prev.gameOver, 'game over reached');
  assert.ok(fullChars > 64 * 1024, `full snapshot ${fullChars} chars`);
  assert.ok(deltaChars / 800 < fullChars / 5, 'deltas are much smaller than full snapshots');
});

test('delta round-trips real World snapshots', async () => {
  const { createWorld } = await import('../../src/sim/world.js');
  const setup = {
    version: '0.1.0', seed: 4242, mapSize: 'small',
    players: [
      { index: 0, name: 'A', team: 1, pantheon: 'greek', color: '#d63a3a', kind: 'human', difficulty: null },
      { index: 1, name: 'B', team: 2, pantheon: 'norse', color: '#3a78d6', kind: 'human', difficulty: null },
    ],
  };
  const world = createWorld(setup);
  let prev = world.getSnapshot();
  let client = json(prev);
  let deltaChars = 0;
  for (let t = 0; t < 300; t++) {
    if (t === 2) {
      for (const p of [0, 1]) {
        const units = world.unitsOf(p).map((u) => u.id);
        const mine = [...world.entities.values()].find((e) => e.kind === 'mine');
        world.issueCommand(p, { type: 'gather', units, target: mine.id });
      }
    }
    world.tick();
    const next = world.getSnapshot();
    const d = encode(prev, next);
    const wire = JSON.stringify(d);
    deltaChars += wire.length;
    client = apply(client, JSON.parse(wire));
    assert.deepStrictEqual(client, json(next), `tick ${next.tick}`);
    prev = next;
  }
  assert.ok(deltaChars / 300 < 4000, `average delta ${Math.round(deltaChars / 300)} chars`);
});

test('delta carries the waiting-miner key mw exactly (added, kept, removed) into the ViewState', async () => {
  const { createWorld } = await import('../../src/sim/world.js');
  const { generateMap } = await import('../../src/sim/mapgen.js');
  const { ViewState } = await import('../../src/game/view-state.js');
  const setup = {
    version: '0.1.0', seed: 99, mapSize: 'small',
    players: [
      { index: 0, name: 'A', team: 1, pantheon: 'greek', color: '#d63a3a', kind: 'human', difficulty: null },
      { index: 1, name: 'B', team: 2, pantheon: 'norse', color: '#3a78d6', kind: 'human', difficulty: null },
    ],
  };
  const world = createWorld(setup);
  const mapData = generateMap({ seed: setup.seed, mapSize: setup.mapSize, playerCount: 2 });
  const vs = new ViewState({ setup, mapData, myIndex: 0 });
  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  for (let i = 0; i < 4; i++) world.spawnUnit(0, 'worshipper', tc.x + (i - 1.5), tc.y + 3, { silent: true });
  const crew = world.unitsOf(0).filter((u) => u.type === 'worshipper');
  assert.equal(crew.length, 9);
  const mine = world.mineList.reduce((a, m) => (Math.hypot(m.x - tc.x, m.y - tc.y) < Math.hypot(a.x - tc.x, a.y - tc.y) ? m : a));
  world.issueCommand(0, { type: 'gather', units: crew.map((u) => u.id), target: mine.id });
  let prev = world.getSnapshot();
  let client = json(prev);
  vs.pushSnapshot(client, 0);
  let added = 0;
  let removed = 0;
  let maxWaiting = 0;
  for (let t = 0; t < 40 * 20; t++) {
    world.tick();
    const next = world.getSnapshot();
    client = apply(client, JSON.parse(JSON.stringify(encode(prev, next))));
    assert.deepStrictEqual(client, json(next), `tick ${next.tick}`);
    vs.pushSnapshot(client, t * 50);
    let waiting = 0;
    for (const u of crew) {
      const wait = !!(u.order && u.order.type === 'gather' && u.order.phase === 'wait');
      const e = next.entities.find((x) => x.id === u.id);
      const pe = prev.entities.find((x) => x.id === u.id);
      if (wait) {
        waiting++;
        assert.equal(e.mw, 1, `tick ${next.tick}: worker ${u.id} waits`);
      } else assert.ok(!('mw' in e), `tick ${next.tick}: worker ${u.id} (${u.order && u.order.phase}) has no mw`);
      if (wait && !(pe && 'mw' in pe)) added++;
      if (!wait && pe && 'mw' in pe) removed++;
      assert.equal(vs.getEntity(u.id).mw, wait ? 1 : undefined, 'the ViewState mirrors mw');
    }
    maxWaiting = Math.max(maxWaiting, waiting);
    prev = next;
  }
  assert.ok(maxWaiting >= 3, `waiting at once ${maxWaiting}`);
  assert.ok(added > 10 && removed > 10, `mw added ${added}, removed ${removed}`);
});

// ---- edge cases of the compact format (notes/decisions.md [netfix]) ----

/** Encode → JSON wire → apply, against a frozen base; returns the delta. */
function roundTrip(prev, next, what) {
  const base = deepFreeze(json(prev));
  const d = encode(base, next);
  const out = apply(base, JSON.parse(JSON.stringify(d)));
  assert.deepStrictEqual(json(out), json(next), what);
  return d;
}

const ent = (id, extra = {}) => ({ id, k: 'u', t: 'warrior', o: 0, x: 10, y: 10, f: 0, hp: 100, ...extra });
const snapOf = (tick, entities, players = [{ i: 0, gold: 1 }], extra = {}) => ({ tick, time: tick / 20, players, entities, events: [], felled: [], ...extra });

test('delta: keys the path syntax cannot express fall back to whole values (cx)', () => {
  const weird = JSON.parse('{"a.b":1,"+x":2,"~0":3,"__proto__":{"p":1},"n":{"c.d":1}}');
  const a = snapOf(1, [ent(1, weird), ent(2)]);
  const bw = JSON.parse('{"a.b":5,"+x":2,"~0":4,"__proto__":{"p":2},"n":{"c.d":2}}');
  const b = snapOf(2, [ent(1, bw), ent(2, { hp: 50 })]);
  const d = roundTrip(a, b, 'weird keys changed');
  assert.ok(d.cx && d.cx.length === 1 && d.cx[0][0] === 1, 'entity 1 sent as cx');
  assert.ok(d.c && d.c.hp, 'entity 2 still uses columns');
  const out = apply(json(a), d);
  assert.ok(Object.prototype.hasOwnProperty.call(out.entities[0], '__proto__'), '__proto__ stays an own key');
  assert.equal(Object.getPrototypeOf(out.entities[0]), Object.prototype, 'and never becomes a prototype');
  // Removing weird keys, adding them to a plain entity.
  const c = snapOf(3, [ent(1), ent(2, JSON.parse('{"x.y":1,"__proto__":null}'))]);
  roundTrip(b, c, 'weird keys removed / added');
});

test('delta: nested objects that reorder keys, change shape or type are replaced exactly', () => {
  const a = snapOf(1, [ent(1, { cd: { bolt: 2, aura: 5 }, q: [{ u: 'w', p: 0.1 }], fx: ['stun'], bo: { b: 'house', tx: 1, ty: 2 } })]);
  const steps = [
    { cd: { aura: 5, bolt: 1 } }, // same keys, other order
    { cd: { aura: 4, bolt: 1 } }, // '~i' positional path
    { cd: { aura: 4 } }, // key removed
    { cd: [] }, // object → array
    { cd: null }, // → null
    { cd: { deep: { deeper: { deepest: { bottom: 1 } } } } }, // beyond MAX_DEPTH
    { cd: { deep: { deeper: { deepest: { bottom: 2 } } } } },
    { q: [{ u: 'w', p: 0.2 }, { u: 'x', p: 0 }] }, // array grows
    { q: [{ u: 'w', p: 0.3 }] },
    { q: [{ u: 'w', p: 0.3, extra: undefined }] }, // undefined value = absent
    { fx: 'stun' },
    { bo: { b: 'house', tx: 1.5, ty: -0 } },
  ];
  let prev = a;
  for (let i = 0; i < steps.length; i++) {
    const next = snapOf(i + 2, [{ ...prev.entities[0], ...steps[i] }]);
    roundTrip(prev, next, `step ${i} ${JSON.stringify(steps[i])}`);
    prev = json(next);
  }
});

test('delta: odd ids, coordinates and values stay exact', () => {
  const a = snapOf(1, [ent(1), ent(2.5), ent(-3), ent(2 ** 53 + 2), ent(7, { x: 1 / 3, y: 1e-7, f: -0 })]);
  const b = snapOf(2, [ent(1, { x: 10.01, y: 9.99 }), ent(2.5, { x: 11 }), ent(-3, { hp: 1 }), ent(2 ** 53 + 2, { y: 0.5 }), ent(7, { x: 2 / 3, y: 1e21, f: 0.1 + 0.2 })]);
  roundTrip(a, b, 'odd ids and floats');
  const c = snapOf(3, [ent(7, { x: 1e300, y: -1e-300, f: 3 }), ent(1, { x: 0.07, y: 0.29 })]);
  const d = roundTrip(b, c, 'removed + reordered');
  assert.ok(d.r && d.o, 'removals and a new order');
  roundTrip(c, snapOf(4, [ent(7, { x: 1e300, y: -1e-300, f: 3, hp: 'many', st: { odd: [1, { z: 2 }] } })]), 'non-number fields');
});

test('delta: events of unknown or odd shapes, players with odd keys, top-level extras', () => {
  const players = JSON.parse('[{"i":0,"gold":1,"stats":{"k":1}},{"i":1,"a.b":2,"__proto__":{"x":1}}]');
  const a = snapOf(1, [ent(1)], players, { fields: [], gameOver: null });
  const events = [
    { type: 'hit', dst: 1, amount: 2, src: 3 }, // known shape
    { amount: 2, type: 'hit', src: 3, dst: 1 }, // known keys, other order
    { type: 'hit', dst: 1, amount: 2 }, // missing key
    { type: 'hit', dst: 1, amount: 2, src: 3, crit: true }, // extra key
    { type: 'hit', dst: 1, amount: undefined, src: 3 }, // undefined value
    { type: 'mystery', payload: [1, { a: 2 }] }, // unknown type
    5, null, 'str', [1, 2], [-1, 'looks packed'], // not objects
  ];
  const p2 = JSON.parse('[{"i":0,"gold":2,"stats":{"k":2}},{"i":1,"a.b":3,"__proto__":{"x":2}},{"i":2}]');
  const b = snapOf(2, [ent(1)], p2, { events, gameOver: { winningTeam: 1 }, newKey: [1] });
  const d = roundTrip(a, b, 'events, players, extras');
  assert.ok(d.P, 'player count changed: full players');
  const p3 = JSON.parse('[{"i":0,"gold":3,"stats":{"k":2}},{"i":1,"a.b":4,"__proto__":{"x":2}},{"i":2,"gold":1}]');
  const c = snapOf(3, [ent(1)], p3, { gameOver: { winningTeam: 1 } });
  const d2 = roundTrip(b, c, 'player patches');
  assert.ok(d2.p && d2.pw, 'plain players patched, odd ones replaced whole');
  assert.deepEqual(d2.xr, ['newKey']);
});

test('delta: a randomized fuzz over odd keys and values round-trips exactly', () => {
  const r = new RNG(1234);
  const KEYS = ['hp', 'x', 'y', 'f', 'cd', 'q', 'st', 'a.b', '+x', '~1', '__proto__', 'longkey', 'zz'];
  const value = (depth) => {
    const roll = r.next();
    if (depth > 4 || roll < 0.35) return r.pick([0, -0, 1, 1.5, 0.07, 1 / 3, -2, 'a', '', true, false, null, 1e21, 123.45]);
    if (roll < 0.6) return Array.from({ length: r.int(0, 3) }, () => value(depth + 1));
    const o = {};
    for (let i = r.int(0, 3); i > 0; i--) setOwn(o, r.pick(KEYS), value(depth + 1));
    return o;
  };
  function setOwn(o, k, v) {
    Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  }
  const entity = (id) => {
    const e = ent(id, { x: r.int(0, 9000) / 100, y: r.int(0, 9000) / 100 });
    for (let i = r.int(0, 3); i > 0; i--) setOwn(e, r.pick(KEYS.slice(4)), value(1));
    return e;
  };
  let nextId = 1;
  let prev = snapOf(0, Array.from({ length: 30 }, () => entity(nextId++)));
  for (let tick = 1; tick <= 400; tick++) {
    const entities = [];
    for (const pe of prev.entities) {
      if (r.chance(0.03)) continue;
      if (!r.chance(0.5)) { entities.push(pe); continue; }
      const e = { ...pe };
      for (let i = r.int(1, 3); i > 0; i--) {
        const k = r.pick(KEYS);
        if (k === 'x' || k === 'y' || k === 'f') e[k] = r.chance(0.8) ? r.int(-500, 9000) / 100 : r.next() * 90;
        else if (r.chance(0.2)) delete e[k];
        else setOwn(e, k, value(1));
      }
      entities.push(e);
    }
    for (let i = r.int(0, 2); i > 0; i--) entities.push(entity(nextId++));
    const next = snapOf(tick, r.chance(0.05) ? r.shuffle(entities) : entities, [{ i: 0, gold: tick, x: value(1) }], {
      events: r.chance(0.5) ? [value(1), { type: 'death', id: 1, t: 'w', o: 0, x: 1, y: 2, k: 'u' }] : [],
    });
    roundTrip(prev, next, `fuzz tick ${tick}`);
    prev = json(next);
  }
});

test('delta: a hostile delta throws or stays contained; it never pollutes prototypes', () => {
  const base = deepFreeze(json(snapOf(1, [ent(1, { cd: { bolt: 1 } }), ent(2)], [{ i: 0, gold: 1 }])));
  const hostile = [
    { c: { '__proto__.polluted': [1, 1] } },
    { c: { 'cd.__proto__.polluted': [1, 1] } },
    { c: { 'constructor.prototype.polluted': [1, 1] } },
    { c: { '+__proto__': [1, 1] } },
    { c: { 'cd.~9': [1, 1] } },
    { c: { hp: [99, 1] } },
    { p: [['__proto__', { polluted: 1 }]] },
    { p: [[0, { '__proto__.polluted': 1 }]] },
    { pw: [[7, { polluted: 1 }]] },
    { m: [5, 1, 1] },
    { e: [[999, 1, 2]] },
  ];
  for (const extra of hostile) {
    const d = JSON.parse(JSON.stringify({ b: 1, time: 0.1, ...extra }));
    try {
      apply(base, d);
    } catch {
      // throwing is fine: the client asks for a full snapshot
    }
    assert.equal({}.polluted, undefined, JSON.stringify(extra));
    assert.equal([].polluted, undefined, JSON.stringify(extra));
  }
  // Own '__proto__' keys from JSON stay plain data.
  const out = apply(base, JSON.parse('{"b":1,"time":0.1,"x":{"__proto__":{"polluted":1}},"cx":[[1,{"__proto__":{"polluted":1}}]]}'));
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.equal(Object.getPrototypeOf(out.entities[0]), Object.prototype);
  assert.deepEqual(Object.keys(base.entities[0]).includes('__proto__'), false, 'base untouched');
});
