// Trial of the Titans (DESIGN 5.13, src/sim/survival.js): the wave clock, what each wave holds,
// the director inside World.tick (spawning, marching, rewards) and the end of the trial.
import { sacredVictoryOn } from '../../src/sim/sacred.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEUTRAL, SURVIVAL_FIRST_WAVE, SURVIVAL_INTERVAL, SURVIVAL_MAX_ALIVE } from '../../src/config.js';
import { UNITS } from '../../src/data/index.js';
import { RNG } from '../../src/sim/rng.js';
import {
  survivalOn, waveTime, wavesBy, nextWaveIn, isBossWave, waveBudget, waveBoost, bossBoost, wavePlan, waveReward, edgeName,
} from '../../src/sim/survival.js';
import { makeWorld, run } from './helpers.js';

/** Jump a world's clock to `sec` (the next tick starts there). */
function jumpTo(world, sec) {
  world.tickCount = Math.round(sec * 20);
  world.time = world.tickCount / 20;
}

const popOf = (types) => types.reduce((n, t) => n + UNITS[t].pop, 0);

test('the wave clock: the first wave at 2:00, then one every 90 s, a Titan every fifth', () => {
  assert.equal(waveTime(1), SURVIVAL_FIRST_WAVE);
  assert.equal(waveTime(2), SURVIVAL_FIRST_WAVE + SURVIVAL_INTERVAL);
  assert.equal(wavesBy(0), 0);
  assert.equal(wavesBy(119.95), 0);
  assert.equal(wavesBy(120), 1);
  assert.equal(wavesBy(209.95), 1);
  assert.equal(wavesBy(210), 2);
  assert.equal(nextWaveIn(0), 120);
  assert.equal(nextWaveIn(120), 90);
  assert.equal(nextWaveIn(200), 10);
  assert.deepEqual([1, 4, 5, 6, 10, 15].map(isBossWave), [false, false, true, false, true, true]);
  assert.equal(survivalOn({ survival: true }), true);
  for (const bad of [undefined, null, {}, { survival: 1 }, { survival: 'yes' }]) assert.equal(survivalOn(bad), false);
});

test('waves grow in size and strength, and with the number of players', () => {
  assert.ok(waveBudget(2, 1) > waveBudget(1, 1));
  assert.ok(waveBudget(10, 4) > waveBudget(10, 1) * 2);
  assert.deepEqual(waveBoost(1), { hp: 1, dmg: 1 });
  assert.ok(waveBoost(10).hp > waveBoost(5).hp && waveBoost(20).dmg > waveBoost(10).dmg);
  assert.ok(bossBoost(5, 1).hp < 1 && bossBoost(10, 1).hp === 1 && bossBoost(10, 4).hp > 1, 'half a Titan at wave 5 alone, a whole one at 10');
  assert.ok(waveReward(10) > waveReward(1));
});

test('a wave plan spends its budget: small creatures first, no flyers before wave 6, a Titan leads every fifth wave', () => {
  for (let n = 1; n <= 25; n++) {
    for (const players of [1, 2, 4]) {
      const plan = wavePlan(n, players, new RNG(n * 31 + players));
      assert.ok(plan.length > 0, `wave ${n}`);
      const boss = isBossWave(n);
      assert.equal(UNITS[plan[0]].class === 'titan', boss, `wave ${n}: titan first only on a boss wave`);
      const mobs = boss ? plan.slice(1) : plan;
      assert.ok(mobs.every((t) => UNITS[t].class === 'creature'), 'the rest are creatures');
      const budget = Math.round(waveBudget(n, players) * (boss ? 0.6 : 1));
      assert.ok(popOf(mobs) <= budget && popOf(mobs) >= budget - 1, `wave ${n}: ${popOf(mobs)} of ${budget}`);
      if (n <= 2) assert.ok(mobs.every((t) => UNITS[t].tier === 1), 'only tier 1 at first');
      if (n < 7) assert.ok(mobs.every((t) => UNITS[t].tier < 3), 'no tier 3 before wave 7');
      if (n < 6) assert.ok(mobs.every((t) => !UNITS[t].air), 'no flyers before wave 6');
      assert.ok(mobs.filter((t) => UNITS[t].air).length * 3 <= mobs.length + 1, 'at most a third fly');
    }
  }
  assert.deepEqual(wavePlan(9, 2, new RNG(5)), wavePlan(9, 2, new RNG(5)), 'deterministic');
});

test('a survival setup puts every player on one team; other games have no director', () => {
  const w = makeWorld({ players: 3, teams: [1, 2, 3], survival: true });
  assert.deepEqual(w.players.map((p) => p.team), [1, 1, 1]);
  assert.ok(w.survival);
  assert.ok(w.getSnapshot().sv, 'the snapshot carries the trial');
  const normal = makeWorld();
  assert.equal(normal.survival, null);
  assert.equal('sv' in normal.getSnapshot(), false);
});

test('the first wave comes out of an edge at 2:00, as neutral monsters marching on the nearest building', () => {
  const w = makeWorld({ players: 2, survival: true, map: { width: 64, height: 64 } });
  run(w, 2);
  assert.equal(w.getSnapshot().sv.w, 0);
  jumpTo(w, SURVIVAL_FIRST_WAVE - 0.05);
  w.tick();
  assert.equal(w.survival.wave, 0, 'not a tick early');
  w.tick();
  const snap = w.getSnapshot();
  const ev = snap.events.find((e) => e.type === 'wave');
  assert.ok(ev, 'a wave event');
  assert.equal(ev.n, 1);
  assert.equal(ev.boss, '');
  assert.ok(ev.count >= 2);
  assert.equal(snap.sv.w, 1);
  assert.equal(snap.sv.m, ev.count);
  const monsters = w.unitList.filter((u) => u.wave === 1);
  assert.equal(monsters.length, ev.count);
  for (const u of monsters) {
    assert.equal(u.owner, NEUTRAL);
    assert.equal(u.camp, null, 'not a camp creature: no leash');
    assert.equal(u.order && u.order.type, 'attackMove');
    const edge = Math.min(u.x, u.y, 64 - u.x, 64 - u.y);
    assert.ok(edge < 8, `came out near an edge (${u.x.toFixed(1)}, ${u.y.toFixed(1)})`);
  }
  assert.ok(['north', 'south', 'east', 'west', 'north-east', 'north-west', 'south-east', 'south-west'].includes(edgeName(64, 64, ev.x, ev.y)));
  // They reach the players' buildings and fight.
  run(w, 60);
  const hurt = w.buildingList.some((b) => b.owner >= 0 && b.hp < b.maxHp) || w.players.some((p) => p.stats.losses > 0) || w.survival.monsters.length < ev.count;
  assert.ok(hurt, 'the wave reached the base');
});

test('later waves are tougher: health and damage multiplied, a boss Titan on wave 5', () => {
  const w = makeWorld({ players: 1, survival: true, map: { width: 64, height: 64 } });
  jumpTo(w, waveTime(5));
  w.tick();
  assert.equal(w.survival.wave, 5, 'the waves due all come out');
  const boss = w.unitList.find((u) => u.wave === 5 && u.def.class === 'titan');
  assert.ok(boss, 'a Titan leads wave 5');
  assert.equal(boss.maxHp, Math.round(boss.def.hp * bossBoost(5, 1).hp));
  const mob = w.unitList.find((u) => u.wave === 4);
  assert.equal(mob.maxHp, Math.round(mob.def.hp * waveBoost(4).hp));
  assert.ok(Math.abs(mob.baseDamage - mob.def.attack.damage * waveBoost(4).dmg) < 1e-9);
  const evs = w.getSnapshot().events.filter((e) => e.type === 'wave');
  assert.deepEqual(evs.map((e) => e.n), [1, 2, 3, 4, 5]);
  assert.equal(evs[4].boss, boss.type);
});

test('beating a wave pays every surviving player once', () => {
  const w = makeWorld({ players: 2, survival: true, map: { width: 64, height: 64 } });
  jumpTo(w, waveTime(1));
  w.tick();
  w.getSnapshot();
  const gold = w.players.map((p) => p.gold);
  for (const u of w.survival.monsters) w.killEntity(u, null);
  run(w, 1.1);
  const evs = w.getSnapshot().events.filter((e) => e.type === 'waveCleared');
  assert.deepEqual(evs, [{ type: 'waveCleared', n: 1, gold: waveReward(1) }]);
  w.players.forEach((p, i) => assert.ok(p.gold >= gold[i] + waveReward(1) - 1e-6));
  run(w, 2);
  assert.equal(w.getSnapshot().events.filter((e) => e.type === 'waveCleared').length, 0, 'paid once');
});

test('the trial ends when the last player falls, with the wave reached and no winner', () => {
  const w = makeWorld({ players: 2, survival: true, map: { width: 64, height: 64 } });
  jumpTo(w, waveTime(3));
  w.tick();
  for (const b of w.buildingsOf(0)) w.killEntity(b, null);
  run(w, 0.1);
  assert.equal(w.players[0].defeated, true);
  assert.equal(w.gameOver, null, 'the other player fights on');
  for (const b of w.buildingsOf(1)) w.killEntity(b, null);
  run(w, 0.1);
  assert.deepEqual(w.gameOver, { winningTeam: null, wave: 3 });
  const snap = w.getSnapshot();
  assert.deepEqual(snap.gameOver, { winningTeam: null, wave: 3 });
  const waves = w.survival.wave;
  jumpTo(w, waveTime(6));
  w.tick();
  assert.equal(w.survival.wave, waves, 'no waves after the end');
});

test('never more than the cap of wave monsters alive at once', () => {
  const w = makeWorld({ players: 4, survival: true, map: { width: 96, height: 96 } });
  jumpTo(w, waveTime(30));
  w.tick();
  assert.ok(w.survival.monsters.length <= SURVIVAL_MAX_ALIVE);
  assert.ok(w.survival.monsters.length > SURVIVAL_MAX_ALIVE / 2);
});

test('a wave the cap leaves empty is never paid as beaten', () => {
  const w = makeWorld({ players: 2, survival: true, map: { width: 96, height: 96 } });
  jumpTo(w, waveTime(30));
  w.tick();
  const full = w.survival.monsters.length;
  // Fill the cap so the next wave has no room.
  const extra = SURVIVAL_MAX_ALIVE - full;
  for (let i = 0; i < extra; i++) {
    const u = w.spawnUnit(NEUTRAL, w.survival.monsters[0].type, 48, 48, { silent: true });
    u.wave = 30;
    w.survival.monsters.push(u);
  }
  w.getSnapshot();
  jumpTo(w, waveTime(31));
  for (let i = 0; i < 25; i++) w.tick();
  const evs = w.getSnapshot().events;
  assert.equal(evs.find((e) => e.type === 'wave').count, 0);
  assert.equal(evs.filter((e) => e.type === 'waveCleared').length, 0, 'no gold for an empty wave');
});

test('a boosted monster carries its damage boost in the snapshot for the info panel', () => {
  const w = makeWorld({ players: 1, survival: true, map: { width: 64, height: 64 } });
  jumpTo(w, waveTime(6));
  w.tick();
  const views = w.getSnapshot().entities;
  const v = views.find((e) => e.id === w.unitList.find((u) => u.wave === 6).id);
  assert.equal(v.wd, Math.round(waveBoost(6).dmg * 1000) / 1000);
  const plain = views.find((e) => e.k === 'u' && e.o === 0);
  assert.equal('wd' in plain, false);
});

test('Sacred Victory never runs in a trial, where every player is on one team', () => {
  assert.equal(sacredVictoryOn({ sacredVictory: true }), true);
  assert.equal(sacredVictoryOn({ sacredVictory: true, survival: true }), false);
});
