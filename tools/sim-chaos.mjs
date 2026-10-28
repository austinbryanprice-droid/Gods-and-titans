#!/usr/bin/env node
// Bug hunt: AI-vs-AI games on generated maps, with a "clumsy human" layered on top
// that sends plausible but random commands for every player (shift-queues,
// cancels, rallies, pray/gather swaps, Delete, wall lines, casts). Checks
// world invariants every tick that the sim's own recount does not hide.
//
// Usage: node tools/sim-chaos.mjs [--seeds=1-4] [--max=12] [--rate=0.3]
import { createWorld } from '../src/sim/world.js';
import { createAI } from '../src/ai/ai.js';
import { PANTHEON_LIST, BUILD_MENU, producibleAt, UPGRADES } from '../src/data/index.js';
import { TICK_RATE } from '../src/config.js';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] ?? true] : [a, true];
}));
const seeds = [];
for (const part of String(opt.seeds || '1-3').split(',')) {
  const m = /^(\d+)-(\d+)$/.exec(part);
  if (m) for (let i = +m[1]; i <= +m[2]; i++) seeds.push(i);
  else seeds.push(+part);
}
const rate = +(opt.rate || 0.3);
const maxTicks = Math.round(+(opt.max || 12) * 60 * TICK_RATE);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

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

function chaos(world, p, r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const us = world.unitList.filter((u) => u.owner === p && !u.dead);
  if (!us.length) return null;
  const ws = us.filter((u) => u.def.class === 'worker');
  const some = (list) => {
    const n = 1 + Math.floor(r() * Math.min(8, list.length));
    const out = [];
    for (let i = 0; i < n; i++) out.push(pick(list).id);
    return out;
  };
  const bs = world.buildingList.filter((b) => b.owner === p && !b.dead);
  const base = bs.length ? pick(bs) : us[0];
  const nx = () => base.x + (r() - 0.5) * 24;
  const ny = () => base.y + (r() - 0.5) * 24;
  const queue = r() < 0.3;
  const enemies = world.unitList.filter((u) => u.owner !== p && world.areEnemies(p, u.owner)).concat(world.buildingList.filter((b) => world.areEnemies(p, b.owner)));
  const k = Math.floor(r() * 18);
  switch (k) {
    case 0: return { type: 'move', units: some(us), x: nx(), y: ny(), queue };
    case 1: return { type: 'attackMove', units: some(us), x: nx(), y: ny(), queue };
    case 2: return ws.length && world.mineList.length ? { type: 'smart', units: some(ws), target: pick(world.mineList).id, queue } : null;
    case 3: {
      const shrines = bs.filter((b) => b.def.prayerSlots > 0 && b.constructed);
      return ws.length && shrines.length ? { type: 'smart', units: some(ws), target: pick(shrines).id, queue } : null;
    }
    case 4: return ws.length ? { type: 'build', units: some(ws), building: pick(BUILD_MENU), tx: Math.floor(nx()), ty: Math.floor(ny()), queue } : null;
    case 5: return ws.length ? { type: 'build', units: some(ws), building: 'wooden_wall', tx: Math.floor(nx()), ty: Math.floor(ny()), tx2: Math.floor(nx()), ty2: Math.floor(ny()), queue } : null;
    case 6: {
      if (!bs.length) return null;
      const b = pick(bs);
      const opts = producibleAt(b.type, world.players[p].pantheon);
      return opts.length ? { type: 'train', building: b.id, unit: pick(opts) } : null;
    }
    case 7: return bs.length ? { type: 'cancelTrain', building: pick(bs).id, index: Math.floor(r() * 4) - 1, count: Math.floor(r() * 4) } : null;
    case 8: return bs.length ? { type: 'cancelBuild', building: pick(bs).id } : null;
    case 9: return bs.length ? { type: 'rally', building: pick(bs).id, x: nx(), y: ny(), target: r() < 0.5 && world.mineList.length ? pick(world.mineList).id : 0 } : null;
    case 10: return { type: 'stop', units: some(us) };
    case 11: return enemies.length ? { type: 'attack', units: some(us), target: pick(enemies).id, queue } : null;
    case 12: {
      const casters = us.filter((u) => u.def.abilities && u.def.abilities.length);
      if (!casters.length) return null;
      const c = pick(casters);
      const tgt = r() < 0.5 && enemies.length ? pick(enemies) : pick(us);
      return { type: 'cast', unit: c.id, ability: pick(c.def.abilities).id, x: tgt.x, y: tgt.y, target: tgt.id, queue };
    }
    case 13: return r() < 0.05 ? { type: 'kill', units: [pick(us).id] } : null;
    case 14: return ws.length ? { type: 'returnCargo', units: some(ws), queue } : null;
    case 15: {
      const ups = Object.keys(UPGRADES || {});
      return bs.length && ups.length ? { type: 'research', building: pick(bs).id, upgrade: pick(ups) } : null;
    }
    case 16: {
      const dmg = bs.filter((b) => b.hp < b.maxHp);
      return ws.length && dmg.length ? { type: 'repair', units: some(ws), target: pick(dmg).id, queue } : null;
    }
    case 17: return bs.length ? { type: 'upgradeTier', building: pick(bs).id } : null;
    default: return null;
  }
}

function check(world, add) {
  const W = world.map.width;
  const H = world.map.height;
  let listed = 0;
  for (const u of world.unitList) {
    listed++;
    if (world.entities.get(u.id) !== u) add('unit-not-in-map', `${u.type}#${u.id}`);
    for (const k of ['x', 'y', 'hp', 'maxHp', 'facing']) if (!finite(u[k])) add(`unit-nonfinite-${k}`, `${u.type}#${u.id}`);
    if (u.hp > u.maxHp + 1e-6) add('unit-hp-over-max', `${u.type}#${u.id} ${u.hp}/${u.maxHp}`);
    if (u.x < 0 || u.y < 0 || u.x > W || u.y > H) add('unit-out-of-map', `${u.type}#${u.id}`);
    if (!u.air && !u.ghost) {
      const tx = Math.floor(u.x);
      const ty = Math.floor(u.y);
      if (!world.map.isWalkableTerrain(tx, ty)) add('unit-on-unwalkable', `${u.type}#${u.id} o${u.owner} ${u.x.toFixed(2)},${u.y.toFixed(2)} order=${u.order && u.order.type}`);
    }
    if (u.orders.length > 200) add('order-queue-huge', `${u.type}#${u.id} ${u.orders.length}`);
  }
  for (const b of world.buildingList) {
    listed++;
    if (!finite(b.hp) || b.hp > b.maxHp + 1e-6 || b.hp <= 0) add('building-bad-hp', `${b.type}#${b.id} ${b.hp}/${b.maxHp}`);
    for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) {
      if (world.map.occ[y * W + x] !== b.id) add('occupancy', `${b.type}#${b.id} at ${x},${y} occ=${world.map.occ[y * W + x]}`);
    }
  }
  for (const m of world.mineList) listed++;
  if (listed !== world.entities.size) add('entity-count', `listed=${listed} map=${world.entities.size}`);
  // Every occupied tile belongs to a living building or mine.
  for (let i = 0; i < W * H; i++) {
    const id = world.map.occ[i];
    if (!id) continue;
    const e = world.entities.get(id);
    if (!e || e.dead || (e.kind !== 'building' && e.kind !== 'mine')) add('occ-orphan', `tile ${i % W},${Math.floor(i / W)} id=${id}`);
  }
  const pop = world.players.map(() => 0);
  for (const u of world.unitList) if (!u.dead && !u.summoned && u.owner >= 0) pop[u.owner] += u.def.pop;
  for (const b of world.buildingList) if (!b.dead && b.owner >= 0) for (const q of b.queue) pop[b.owner] += q.pop;
  world.players.forEach((p, i) => {
    for (const k of ['gold', 'wood', 'faith']) if (!finite(p[k]) || p[k] < -1e-6) add(`player-bad-${k}`, `p${i} ${p[k]}`);
    if (Math.abs(p.popUsed - pop[i]) > 1e-6) add('pop-drift', `p${i} popUsed=${p.popUsed} actual=${pop[i]}`);
  });
}

for (const seed of seeds) {
  const ids = PANTHEON_LIST.map((x) => x.id);
  const setup = {
    version: '0.1.0', seed, mapSize: 'small',
    players: [0, 1].map((i) => ({ index: i, name: `P${i}`, team: i + 1, pantheon: ids[(seed * (i + 3)) % ids.length], color: null, kind: 'ai', difficulty: 'hard' })),
  };
  const world = createWorld(setup);
  const ais = setup.players.map((p) => createAI(world, p.index, p.difficulty));
  const r = rng(seed * 7919);
  const issues = new Map();
  let lastCmd = null;
  const add = (k, msg) => {
    const rec = issues.get(k) || { count: 0, first: msg, tick: world.tickCount, cmd: lastCmd };
    rec.count++;
    issues.set(k, rec);
  };
  // Give them a head start so there is something to command.
  for (const p of world.players) { p.gold += 3000; p.wood += 3000; p.faith += 2000; }
  for (let tick = 0; tick < maxTicks && !world.gameOver; tick++) {
    for (const ai of ais) ai.tick();
    for (let p = 0; p < 2; p++) {
      if (r() < rate) {
        const cmd = chaos(world, p, r);
        if (cmd) {
          lastCmd = JSON.stringify(cmd);
          world.issueCommand(p, cmd);
        }
      }
    }
    world.tick();
    world.events.length = 0;
    world.felled.length = 0;
    if (world.tickCount % 20 !== 1) check(world, add); // the recount runs on ticks where tickCount % 20 === 0
    if (world.perf.commandErrors) add('command-error', world.perf.lastCommandError);
  }
  console.log(`\n== seed ${seed} ${setup.players.map((p) => p.pantheon).join(' v ')}: ${(world.time / 60).toFixed(1)} min aiErrors=${ais.map((a) => a.ai.errors)}`);
  for (const [k, v] of issues) console.log(`  ${k} x${v.count} (tick ${v.tick}): ${v.first}\n      last cmd: ${v.cmd}`);
}
