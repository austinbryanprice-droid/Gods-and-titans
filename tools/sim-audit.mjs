#!/usr/bin/env node
// Bug hunt harness: headless AI-vs-AI games with invariant checks on the world
// every few ticks (entity index, positions, health, map occupancy, resources,
// population that the sim's own recount would hide), a watch for units that
// stop moving on a move-like order, for worshippers that hold a gather order
// but deliver nothing for 90 s, and a same-seed determinism check.
// (Mine slots and prayer slots are checked lazily by the sim itself, so stale
// ids left in them are not reported. "pop-over-cap" is legal after losing Houses.)
//
// Usage: node tools/sim-audit.mjs [--seeds=1-3] [--max=25] [--teams=1v1|2v2|ffa] [--diff=hard]
//        [--pantheons=greek,norse] [--every=20] [--peace=30] [--sacred] [--determinism]
import { createWorld } from '../src/sim/world.js';
import { createAI } from '../src/ai/ai.js';
import { PANTHEON_LIST } from '../src/data/index.js';
import { TICK_RATE } from '../src/config.js';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const seeds = [];
for (const part of String(opt.seeds || '1-2').split(',')) {
  const m = /^(\d+)-(\d+)$/.exec(part);
  if (m) for (let i = +m[1]; i <= +m[2]; i++) seeds.push(i);
  else seeds.push(+part);
}
const ids = opt.pantheons ? String(opt.pantheons).split(',') : PANTHEON_LIST.map((p) => p.id);
const every = +(opt.every || 20);
const maxTicks = Math.round(+(opt.max || 25) * 60 * TICK_RATE);

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function check(world, issues, tick) {
  const add = (k, msg) => {
    const rec = issues.get(k) || { count: 0, first: msg, tick };
    rec.count++;
    issues.set(k, rec);
  };
  const W = world.map.width;
  const H = world.map.height;
  // Entities map and lists agree.
  let listed = 0;
  for (const u of world.unitList) {
    listed++;
    if (world.entities.get(u.id) !== u) add('unit-not-in-map', `${u.type}#${u.id}`);
    if (u.dead) add('dead-unit-listed', `${u.type}#${u.id}`);
    for (const k of ['x', 'y', 'hp', 'maxHp', 'facing', 'speedNow', 'armorNow', 'dmgMult']) {
      if (!finite(u[k])) add(`unit-nonfinite-${k}`, `${u.type}#${u.id} ${k}=${u[k]}`);
    }
    if (u.hp > u.maxHp + 1e-6) add('unit-hp-over-max', `${u.type}#${u.id} ${u.hp}/${u.maxHp}`);
    if (u.hp <= 0 && !u.dead) add('unit-zero-hp-alive', `${u.type}#${u.id} hp=${u.hp}`);
    if (u.x < 0 || u.y < 0 || u.x > W || u.y > H) add('unit-out-of-map', `${u.type}#${u.id} ${u.x},${u.y}`);
    if (!u.air && !u.ghost && u.state !== 'garrison') {
      const tx = Math.floor(u.x);
      const ty = Math.floor(u.y);
      if (!world.map.isWalkableTerrain(tx, ty)) add('unit-on-unwalkable-terrain', `${u.type}#${u.id} o${u.owner} ${u.x.toFixed(2)},${u.y.toFixed(2)} state=${u.state} order=${u.order && u.order.type}`);
      else if (!world.map.isPassable(tx, ty)) add('unit-inside-building', `${u.type}#${u.id} o${u.owner} ${u.x.toFixed(2)},${u.y.toFixed(2)} state=${u.state} order=${u.order && u.order.type} occ=${world.map.occ[ty * W + tx]}`);
    }
    if (u.carryAmount < 0 || !finite(u.carryAmount)) add('unit-bad-carry', `${u.type}#${u.id} ${u.carryAmount}`);
    for (const k in u.cooldowns) if (!finite(u.cooldowns[k])) add('unit-nonfinite-cooldown', `${u.type}#${u.id} ${k}`);
  }
  for (const b of world.buildingList) {
    listed++;
    if (world.entities.get(b.id) !== b) add('building-not-in-map', `${b.type}#${b.id}`);
    if (!finite(b.hp) || b.hp > b.maxHp + 1e-6) add('building-bad-hp', `${b.type}#${b.id} ${b.hp}/${b.maxHp}`);
    if (b.hp <= 0 && !b.dead) add('building-zero-hp-alive', `${b.type}#${b.id} hp=${b.hp} constructed=${b.constructed}`);
    if (!finite(b.buildProgress) || b.buildProgress < 0 || b.buildProgress > 1 + 1e-9) add('building-bad-progress', `${b.type}#${b.id} ${b.buildProgress}`);
    for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) {
      if (world.map.occ[y * W + x] !== b.id) add('building-occupancy-mismatch', `${b.type}#${b.id} at ${x},${y} occ=${world.map.occ[y * W + x]}`);
    }
    for (const id of b.prayers || []) {
      if (!id) continue;
      const u = world.entities.get(id);
      if (!u || u.dead) add('prayer-slot-dangling', `${b.type}#${b.id} slot holds ${id}`);
      else if (!u.order || u.order.type !== 'pray' || u.order.building !== b.id) add('prayer-slot-stale', `${b.type}#${b.id} slot holds ${u.type}#${id} order=${u.order && u.order.type}`);
    }
    if (b.builders < 0 || b.repairers < 0) add('building-neg-counters', `${b.type}#${b.id} builders=${b.builders} repairers=${b.repairers}`);
  }
  // Mine slots, waiters and spot holders are validated lazily (economy.js minerValid / holdsSpot), so a
  // dead id left in them is by design; only the amount is checked.
  for (const m of world.mineList) {
    listed++;
    if (m.amount < 0 || !finite(m.amount)) add('mine-bad-amount', `#${m.id} ${m.amount}`);
  }
  if (listed !== world.entities.size) add('entity-count-mismatch', `listed=${listed} map=${world.entities.size}`);
  // Players: resources and population.
  const pop = world.players.map(() => 0);
  for (const u of world.unitList) if (!u.dead && !u.summoned && u.owner >= 0) pop[u.owner] += u.def.pop;
  for (const b of world.buildingList) if (!b.dead && b.owner >= 0) for (const q of b.queue) pop[b.owner] += q.pop;
  world.players.forEach((p, i) => {
    for (const k of ['gold', 'wood', 'faith']) {
      if (!finite(p[k])) add(`player-nonfinite-${k}`, `p${i} ${p[k]}`);
      else if (p[k] < -1e-6) add(`player-negative-${k}`, `p${i} ${k}=${p[k]}`);
    }
    if (Math.abs(p.popUsed - pop[i]) > 1e-6) add('pop-drift', `p${i} popUsed=${p.popUsed} actual=${pop[i]} t=${world.time.toFixed(1)}`);
    if (pop[i] > p.popCap && pop[i] > 0 && !p.defeated) {
      // Over cap is legal only after losing a house; record for a look.
      add('pop-over-cap', `p${i} pop=${pop[i]} cap=${p.popCap}`);
    }
  });
}

function runGame(g) {
  const setup = {
    version: '0.1.0', seed: g.seed, mapSize: g.size,
    players: g.players.map((p, i) => ({ index: i, name: `AI ${i}`, team: p.team, pantheon: p.pantheon, color: null, kind: 'ai', difficulty: p.difficulty })),
  };
  if (opt.peace) setup.peaceMinutes = +opt.peace;
  if (opt.sacred) setup.sacredVictory = true;
  const world = createWorld(setup);
  const ais = setup.players.map((p) => createAI(world, p.index, p.difficulty));
  const issues = new Map();
  const stuck = new Map(); // id -> { x, y, since, order }
  const stuckReports = [];
  const idle = new Map();
  let tick = 0;
  let hash = 0;
  for (; tick < maxTicks && !world.gameOver; tick++) {
    for (const ai of ais) ai.tick();
    // Check pop before the tick's own recompute hides drift.
    world.tick();
    world.events.length = 0;
    world.felled.length = 0;
    if (tick % every === 19 % every) check(world, issues, tick);
    if (tick % 40 === 0) {
      for (const u of world.unitList) {
        if (u.dead || u.owner < 0) continue;
        const o = u.order;
        const moving = o && (o.type === 'move' || o.type === 'attackMove' || o.type === 'gather' || o.type === 'returnCargo' || o.type === 'build' || o.type === 'pray' || o.type === 'attack');
        const s = stuck.get(u.id);
        const sig = o ? o.type : 'none';
        if (!moving || !s || s.sig !== sig || Math.hypot(u.x - s.x, u.y - s.y) > 0.6 || u.state === 'gather' || u.state === 'build' || u.state === 'attack' || (o.type === 'pray' && o.kneel)) {
          stuck.set(u.id, { x: u.x, y: u.y, since: world.time, sig, reported: false });
        } else if (!s.reported && world.time - s.since > 40) {
          s.reported = true;
          stuckReports.push(`${u.type}#${u.id} o${u.owner} at ${u.x.toFixed(1)},${u.y.toFixed(1)} order=${sig} state=${u.state} for ${(world.time - s.since).toFixed(0)}s t=${world.time.toFixed(0)}`);
        }
      }
      for (const id of stuck.keys()) if (!world.entities.has(id)) stuck.delete(id);
    }
    // Gatherers that hold a gather order but deliver nothing for 90 s.
    for (const u of world.unitList) {
      if (u.dead || u.def.class !== 'worker') continue;
      const o = u.order;
      let g = idle.get(u.id);
      if (!g) idle.set(u.id, (g = { last: world.time, carry: u.carryAmount, reported: false }));
      if (!o || o.type !== 'gather' || u.carryAmount < g.carry) { g.last = world.time; g.reported = false; }
      g.carry = u.carryAmount;
      if (!g.reported && world.time - g.last > 90) {
        g.reported = true;
        stuckReports.push(`unproductive ${u.type}#${u.id} o${u.owner} at ${u.x.toFixed(1)},${u.y.toFixed(1)} gather ${o.mine ? 'mine ' + o.mine : 'tree ' + JSON.stringify(o.tree)} phase=${o.phase} state=${u.state} carry=${u.carryAmount} t=${world.time.toFixed(0)}`);
      }
    }
    if (world.perf.commandErrors) {
      issues.set('command-error', { count: world.perf.commandErrors, first: world.perf.lastCommandError, tick });
    }
  }
  for (const u of world.unitList) hash = (hash * 31 + Math.round(u.x * 1000) + Math.round(u.hp * 10) + u.id) | 0;
  hash = (hash * 31 + world.players.reduce((s, p) => s + Math.round(p.gold) + Math.round(p.wood), 0)) | 0;
  const aiErrors = ais.map((a) => a.ai.errors);
  return { world, issues, stuckReports, hash, minutes: world.time / 60, over: world.gameOver, aiErrors };
}

const games = [];
const diff = opt.diff || 'normal';
for (const seed of seeds) {
  const a = ids[seed % ids.length];
  const b = ids[(seed * 3 + 1) % ids.length];
  const c = ids[(seed * 5 + 2) % ids.length];
  const d = ids[(seed * 7 + 3) % ids.length];
  if (opt.teams === '2v2') games.push({ seed, size: 'medium', players: [{ pantheon: a, team: 1, difficulty: diff }, { pantheon: b, team: 1, difficulty: diff }, { pantheon: c, team: 2, difficulty: diff }, { pantheon: d, team: 2, difficulty: diff }] });
  else if (opt.teams === 'ffa') games.push({ seed, size: 'medium', players: [a, b, c, d].map((pan, k) => ({ pantheon: pan, team: k + 1, difficulty: diff })) });
  else games.push({ seed, size: 'small', players: [{ pantheon: a, team: 1, difficulty: diff }, { pantheon: b, team: 2, difficulty: diff }] });
}

for (const g of games) {
  const t0 = performance.now();
  const r = runGame(g);
  const label = `seed ${g.seed} ${g.players.map((p) => p.pantheon).join(' v ')}`;
  console.log(`\n== ${label}: ${r.minutes.toFixed(1)} min ${r.over ? `winner team ${r.over.winningTeam} ${r.over.how || ''}` : 'unfinished'} (${((performance.now() - t0) / 1000).toFixed(1)} s) aiErrors=${JSON.stringify(r.aiErrors)}`);
  for (const [k, v] of r.issues) console.log(`  ${k} x${v.count} (first tick ${v.tick}): ${v.first}`);
  for (const s of r.stuckReports.slice(0, 15)) console.log(`  stuck: ${s}`);
  if (r.stuckReports.length > 15) console.log(`  ... ${r.stuckReports.length - 15} more stuck`);
  if (opt.determinism) {
    const r2 = runGame(g);
    console.log(`  determinism: ${r.hash === r2.hash ? 'same' : `DIFFERENT ${r.hash} vs ${r2.hash}`}`);
  }
}
