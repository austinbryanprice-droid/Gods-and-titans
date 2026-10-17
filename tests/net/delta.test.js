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
    if (d.c && d.c.some((c) => c[2])) usedRemovedKeys++;
    if (d.m) usedMove++;
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
  assert.deepEqual(d.e, b.events);
  assert.deepEqual(d.fl, [[1, 2]]);
  assert.deepEqual(d.x, { gameOver: { winningTeam: 1 } });
  const out = apply(a, d);
  assert.deepStrictEqual(out, b);
  assert.equal(out.entities[0], a.entities[0], 'unchanged entity object reused');
  assert.notEqual(out.entities[2], a.entities[2]);
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
