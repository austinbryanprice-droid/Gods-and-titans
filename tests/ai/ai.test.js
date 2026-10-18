// Computer opponent tests (DESIGN 10): economy and tech progress against a
// passive opponent, generic ability use for every god and titan, base
// defense, rebuilding, team targeting, error containment and think cost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, World } from '../../src/sim/world.js';
import { createAI } from '../../src/ai/ai.js';
import { teamTarget } from '../../src/ai/team.js';
import { PANTHEON_LIST, godsFor, titanFor, creaturesFor } from '../../src/data/index.js';
import { TICK_RATE } from '../../src/config.js';
import { makeMap, makeSetup } from '../sim/helpers.js';

const PANTHEON_IDS = PANTHEON_LIST.map((p) => (typeof p === 'string' ? p : p.id));

/** A real generated map with player 0 run by the AI and player 1 idle. */
function soloGame(seed, pantheon = 'egyptian', difficulty = 'normal') {
  const world = createWorld({
    version: '0.1.0',
    seed,
    mapSize: 'small',
    players: [
      { index: 0, name: 'AI', team: 1, pantheon, kind: 'ai', difficulty },
      { index: 1, name: 'Idle', team: 2, pantheon: 'norse', kind: 'human', difficulty: null },
    ],
  });
  const ai = createAI(world, 0, difficulty);
  let faithGained = 0;
  const step = (seconds, each) => {
    const n = Math.round(seconds * TICK_RATE);
    for (let i = 0; i < n; i++) {
      const before = world.players[0].faith;
      ai.tick();
      world.tick();
      const gain = world.players[0].faith - before;
      if (gain > 0) faithGained += gain;
      if (each) each(world.events);
      world.events.length = 0;
      world.felled.length = 0;
    }
  };
  return { world, ai, step, faith: () => faithGained };
}

const built = (world, i, type) => world.buildingsOf(i).filter((b) => b.type === type && b.constructed).length;

test('AI builds an economy, prays, techs and summons a god against a passive opponent', () => {
  const g = soloGame(11, 'egyptian', 'normal');
  g.step(8 * 60);
  const { world, ai } = g;
  const units = world.unitsOf(0);
  const workers = units.filter((u) => u.def.class === 'worker');
  const army = units.filter((u) => u.def.class !== 'worker' && !u.summoned);
  const gods = units.filter((u) => u.def.class === 'god');
  assert.ok(workers.length >= 16, `workers ${workers.length}`);
  assert.ok(built(world, 0, 'shrine') >= 1, 'shrine');
  assert.ok(built(world, 0, 'temple') >= 1, 'temple');
  assert.ok(built(world, 0, 'barracks') >= 1, 'barracks');
  assert.ok(built(world, 0, 'house') >= 3, 'houses');
  assert.ok(g.faith() > 300, `faith prayed ${g.faith()}`);
  assert.ok(workers.some((u) => u.order && u.order.type === 'pray'), 'someone prays');
  assert.ok(gods.length >= 1, 'a god');
  assert.ok(army.length >= 12, `army ${army.length}`);
  assert.ok(world.players[0].tier >= 2, `tier ${world.players[0].tier}`);
  assert.ok(world.players[0].popCap > world.players[0].popUsed || world.players[0].popCap >= 150, 'houses ahead of the cap');
  assert.equal(ai.ai.errors, 0);
});

/** Gods (or a titan) of player 0 next to a tough enemy clump, with wounded allies. */
function stagedFight(pantheon, spawnHeroes, seconds = 40) {
  const map = makeMap({ width: 64, height: 64, starts: [{ x: 4, y: 4 }, { x: 54, y: 54 }] });
  const world = new World(makeSetup(2, { pantheons: [pantheon, 'norse'] }), map);
  const heroes = spawnHeroes(world);
  for (let i = 0; i < 8; i++) {
    const u = world.spawnUnit(0, i % 2 ? 'archer' : 'warrior', 27 + (i % 4), 34 + Math.floor(i / 4), { silent: true });
    u.hp = Math.round(u.maxHp * 0.45);
  }
  const foes = [];
  for (let i = 0; i < 18; i++) {
    const u = world.spawnUnit(1, i % 2 ? 'archer' : 'warrior', 35 + (i % 5) * 1.4, 29 + Math.floor(i / 5) * 1.4, { silent: true });
    u.hp = u.maxHp = 2000;
    foes.push(u.id);
  }
  world.hash.rebuild(world.unitList);
  world.issueCommand(1, { type: 'attackMove', units: foes, x: 28, y: 33 });
  const ai = createAI(world, 0, 'hard');
  const used = new Map();
  for (let t = 0; t < seconds * TICK_RATE; t++) {
    ai.tick();
    world.tick();
    for (const e of world.events) {
      if (e.type !== 'cast') continue;
      const u = world.entities.get(e.src);
      if (u && u.owner === 0) used.set(e.ability, (used.get(e.ability) || 0) + 1);
    }
    world.events.length = 0;
  }
  return { heroes, used, ai };
}

test('every god casts each of its abilities in a staged fight (escapes excepted)', () => {
  const missing = [];
  for (const pan of PANTHEON_IDS) {
    const { heroes, used, ai } = stagedFight(pan, (world) =>
      godsFor(pan).slice(0, 3).map((g, k) => world.spawnUnit(0, g.id, 28 + k * 1.5, 32, { level: 5, silent: true })),
    );
    assert.equal(ai.ai.errors, 0);
    for (const h of heroes) {
      for (const ab of h.def.abilities) {
        if (ab.autocast || (ab.ai && ab.ai.use === 'escape')) continue;
        if (!used.get(ab.id)) missing.push(ab.id);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('every titan casts both of its abilities in a staged fight', () => {
  const missing = [];
  for (const pan of PANTHEON_IDS) {
    const tdef = titanFor(pan);
    const { used } = stagedFight(pan, (world) => [world.spawnUnit(0, tdef.id, 28, 32, { silent: true })]);
    for (const ab of tdef.abilities) if (!ab.autocast && !used.get(ab.id)) missing.push(ab.id);
  }
  assert.deepEqual(missing, []);
});

test('AI defends its base against a raid and rebuilds a lost Town Center', () => {
  const g = soloGame(3, 'egyptian', 'normal');
  const { world, ai } = g;
  // The raid appears 9 tiles from the Town Center: keep the army home (not out creeping) so the
  // outcome does not hinge on where it happens to be at that second.
  ai.ai.prof = { ...ai.ai.prof, creepFrom: Infinity };
  g.step(330);
  const tc = world.buildingsOf(0).find((b) => b.type === 'town_center');
  assert.ok(tc);
  const side = tc.x < world.map.width / 2 ? -1 : 1;
  const raid = [];
  for (let i = 0; i < 10; i++) {
    raid.push(world.spawnUnit(1, i % 3 ? 'warrior' : 'archer', tc.x + side * 9 + (i % 3), tc.y + Math.floor(i / 3), { silent: true }));
  }
  world.hash.rebuild(world.unitList);
  world.issueCommand(1, { type: 'attack', units: raid.map((u) => u.id), target: tc.id });
  let defended = false;
  for (let s = 0; s < 50 && raid.some((u) => !u.dead); s++) {
    g.step(1);
    if (ai.ai.mil.mode === 'defend') defended = true;
  }
  assert.ok(defended, 'switched to defense');
  assert.equal(raid.filter((u) => !u.dead).length, 0, 'raid destroyed');
  assert.ok(!tc.dead, 'Town Center held');

  // Lose the Town Center: the AI builds a new one.
  world.killEntity(tc, null);
  g.step(150);
  assert.ok(world.buildingsOf(0).some((b) => b.type === 'town_center'), 'Town Center rebuilt');
  assert.equal(ai.ai.errors, 0);
});

test('an AI created mid-game takes over a running base', () => {
  const g = soloGame(5, 'greek', 'hard');
  g.step(200);
  const { world } = g;
  const fresh = createAI(world, 0, 'normal');
  const trainedBefore = world.players[0].stats.unitsTrained;
  for (let i = 0; i < 150 * TICK_RATE; i++) {
    fresh.tick();
    world.tick();
    world.events.length = 0;
    world.felled.length = 0;
  }
  assert.equal(fresh.ai.errors, 0);
  assert.ok(world.players[0].stats.unitsTrained > trainedBefore + 5, 'keeps training');
  assert.ok(world.unitsOf(0).some((u) => u.def.class !== 'worker'), 'has an army');
});

test('a failing think is contained: logged once, the AI keeps ticking', () => {
  const g = soloGame(2);
  const { ai } = g;
  const errors = [];
  const orig = console.error;
  console.error = (...args) => errors.push(args);
  try {
    ai.ai.think = () => {
      throw new Error('boom');
    };
    assert.doesNotThrow(() => g.step(10));
  } finally {
    console.error = orig;
  }
  assert.ok(ai.ai.errors >= 5);
  assert.equal(errors.length, 1);
});

test('allied AIs share one deterministic target: the weakest enemy by buildings', () => {
  const map = makeMap({ width: 64, height: 64, starts: [{ x: 6, y: 6 }, { x: 54, y: 6 }, { x: 54, y: 54 }, { x: 6, y: 54 }] });
  const world = new World(makeSetup(4, { teams: [1, 1, 2, 2] }), map);
  // Player 3 has an extra building: player 2 is weaker.
  const put = (i, x, y) => {
    const spot = world.findPlacement(i, 'house', x, y, 12);
    world.completeBuilding(world.createBuilding(i, 'house', spot.tx, spot.ty, true, true));
  };
  put(3, 12, 50);
  assert.equal(teamTarget(world, 1), 2);
  // The choice is held so both allies agree even if numbers shift.
  put(2, 50, 48);
  put(2, 46, 48);
  assert.equal(teamTarget(world, 1), 2);
  const a = createAI(world, 0, 'normal');
  const b = createAI(world, 1, 'hard');
  for (let i = 0; i < 40; i++) {
    a.tick();
    b.tick();
    world.tick();
  }
  assert.equal(teamTarget(world, 1), 2);
  assert.equal(a.ai.errors + b.ai.errors, 0);
});

test('performance: AI thinks stay cheap with 400 units fighting on a medium map', () => {
  const pans = ['greek', 'norse', 'egyptian', 'hindu'];
  const world = createWorld({
    version: '0.1.0',
    seed: 5,
    mapSize: 'medium',
    players: pans.map((p, i) => ({ index: i, name: `P${i}`, team: i + 1, pantheon: p, kind: 'ai', difficulty: 'hard' })),
  });
  const ais = pans.map((_, i) => createAI(world, i, 'hard'));
  for (const a of ais) a.ai.prof = { ...a.ai.prof, firstAttack: 0, attackRatio: 0.5, attackPop: 10, creepFrom: 1e9 };
  for (let i = 0; i < 4; i++) {
    const tc = world.buildingsOf(i)[0];
    const p = world.players[i];
    p.gold = 3000;
    p.wood = 2000;
    p.faith = 1000;
    for (const type of ['house', 'house', 'house', 'house', 'barracks', 'shrine', 'temple']) {
      const spot = world.findPlacement(i, type, tc.x + (i < 2 ? 8 : -8), tc.y + (i % 2 ? -8 : 8), 20);
      if (spot) world.completeBuilding(world.createBuilding(i, type, spot.tx, spot.ty, true, true));
    }
    const cre = creaturesFor(p.pantheon).map((c) => c.id);
    const gods = godsFor(p.pantheon).map((g) => g.id);
    for (let k = 0; k < 96; k++) {
      const t = k < 2 ? gods[k] : k % 4 === 0 ? cre[k % 3] : k % 2 ? 'archer' : 'warrior';
      world.spawnUnit(i, t, tc.x + 6 + (k % 9) * 0.9, tc.y + 6 + Math.floor(k / 9) * 0.9, { silent: true, level: 3 });
    }
  }
  world.recomputePop();
  for (let i = 0; i < 4; i++) world.recomputePopCap(i);
  world.hash.rebuild(world.unitList);
  assert.ok(world.unitList.length >= 400);
  const ticks = 50 * TICK_RATE;
  for (let t = 0; t < ticks; t++) {
    if (t === 10 * TICK_RATE) for (const a of ais) Object.assign(a.ai.stats, { thinkMs: 0, thinks: 0 });
    for (const a of ais) a.tick();
    world.tick();
    world.events.length = 0;
    world.felled.length = 0;
  }
  for (const a of ais) {
    const avg = a.ai.stats.thinkMs / a.ai.stats.thinks;
    // Target < 1 ms; the bound is loose because tests share the CPU.
    assert.ok(avg < 3, `player ${a.ai.me} averages ${avg.toFixed(3)} ms per think`);
    assert.equal(a.ai.errors, 0);
  }
});
