// One pass over the world per think: the AI's picture of its own forces,
// economy, buildings, and every other player. Only reads the World.
import { newForce, addToForce, addBuildingToForce, unitInfo } from './unit-info.js';

/** Job of a worker from its current order. */
export function workerJob(u) {
  const o = u.order;
  if (!o) return u.orders.length ? 'busy' : 'idle';
  switch (o.type) {
    case 'gather': return o.mine ? 'gold' : 'wood';
    case 'return': return o.resume ? (o.resume.mine ? 'gold' : 'wood') : 'busy';
    case 'pray': return 'pray';
    case 'build':
    case 'repair': return 'build';
    case 'attack':
    case 'attackMove': return 'fight';
    case 'relic':
    case 'deliver': return 'relic'; // carrying a relic to a Temple (ai/relics.js)
    default: return 'busy';
  }
}

// Per-player lists and strength estimates of the whole world, shared by every
// AI of a world and reused for a few ticks (AIs think on staggered ticks, so a
// strictly per-tick cache would never be shared). Consumers skip entries that
// died since the digest was taken.
const DIGEST_TTL = 4; // ticks
const digests = new WeakMap(); // world -> digest

function playerDigest(index) {
  return { index, units: [], buildings: [], force: newForce(), tcs: [], towers: 0, air: 0, titanSoon: null };
}

/** Shared per-player summary of the world (units, buildings, army strength). */
export function worldDigest(world) {
  const tick = world.tickCount;
  const d = digests.get(world);
  if (d && tick - d.tick < DIGEST_TTL && tick >= d.tick && d.n === world.players.length) return d;
  const per = [];
  for (let i = 0; i < world.players.length; i++) per.push(playerDigest(i));
  for (const u of world.unitList) {
    if (u.dead || u.owner < 0) continue;
    const rec = per[u.owner];
    if (!rec) continue;
    rec.units.push(u);
    if (u.def.class !== 'worker') {
      addToForce(rec.force, u);
      if (u.air) rec.air += u.def.pop || 1;
    }
  }
  for (const b of world.buildingList) {
    if (b.dead || b.owner < 0 || b.def.wall) continue; // wall segments are not targets for the AI (its armies break through them when blocked)
    const rec = per[b.owner];
    if (!rec) continue;
    rec.buildings.push(b);
    if (b.type === 'town_center') rec.tcs.push(b);
    if (b.def.attack && b.constructed) {
      rec.towers++;
      addBuildingToForce(rec.force, b, 0);
    }
    // A Titan being summoned is announced to everyone (titanSummoning event).
    const q = b.queue && b.queue[0];
    if (q && q.u) {
      const inf = unitInfo(q.u);
      if (inf && inf.cls === 'titan') rec.titanSoon = { type: q.u, left: Math.max(0, q.time - q.elapsed) };
    }
  }
  const camps = [];
  for (const camp of world.camps) {
    for (const m of camp.members) {
      if (!m.dead) {
        camps.push(camp);
        break;
      }
    }
  }
  const out = { tick, n: world.players.length, per, camps };
  digests.set(world, out);
  return out;
}

/**
 * Build the per-think snapshot for player `me`. Own units and buildings are
 * read fresh; other players come from the shared digest.
 * @param {object} world
 * @param {number} me
 */
export function scanWorld(world, me) {
  const p = world.players[me];
  const dg = worldDigest(world);
  const s = {
    t: world.time,
    p,
    me,
    team: p.team,
    workers: [],
    army: [],
    minions: [],
    gods: [],
    titan: null,
    jobs: { gold: 0, wood: 0, pray: 0, build: 0, idle: 0, fight: 0, busy: 0, relic: 0 },
    job: new Map(), // worker id -> job this think (see workerJob)
    alive: new Map(), // type -> living count (not summoned)
    queued: new Map(), // type -> queued count
    buildings: [],
    done: new Map(), // type -> completed buildings
    sites: [], // unfinished buildings
    have: new Map(), // type -> completed + unfinished + paid build orders
    pending: [], // { b, tx, ty, u } paid build orders not yet placed
    tcs: [],
    tierUp: false,
    queuedGods: 0,
    peace: !!world.peace, // Decade of Peace: no fighting between players yet
    enemies: [],
    enemyUnits: [],
    allyBuildings: [],
    camps: dg.camps,
    armyPop: 0,
  };
  for (let i = 0; i < world.players.length; i++) {
    if (i === me) continue;
    const op = world.players[i];
    const d = dg.per[i];
    const enemy = world.areEnemies(me, i);
    const rec = { index: i, team: op.team, p: op, enemy, defeated: op.defeated, buildings: d.buildings, units: d.units, force: d.force, tcs: d.tcs, towers: d.towers, air: d.air, titanSoon: d.titanSoon };
    if (enemy) {
      s.enemies.push(rec);
      for (const u of d.units) if (!u.dead) s.enemyUnits.push(u);
    } else {
      for (const b of d.buildings) if (!b.dead) s.allyBuildings.push(b);
    }
  }

  for (const u of world.unitList) {
    if (u.dead || u.owner !== me) continue;
    if (u.def.class === 'worker') {
      s.workers.push(u);
      const j = workerJob(u);
      s.job.set(u.id, j);
      s.jobs[j]++;
    } else if (u.summoned) {
      s.minions.push(u);
    } else {
      s.army.push(u);
      s.armyPop += u.def.pop || 0;
      if (u.def.class === 'god') s.gods.push(u);
      else if (u.def.class === 'titan') s.titan = u;
    }
    if (!u.summoned) s.alive.set(u.type, (s.alive.get(u.type) || 0) + 1);
    if (u.order && u.order.type === 'build' && u.order.paid && !u.order.site) {
      s.pending.push({ b: u.order.b, tx: u.order.tx, ty: u.order.ty, u });
      s.have.set(u.order.b, (s.have.get(u.order.b) || 0) + 1);
    }
    for (const q of u.orders) {
      if (q.type === 'build' && q.paid && !q.site) {
        s.pending.push({ b: q.b, tx: q.tx, ty: q.ty, u });
        s.have.set(q.b, (s.have.get(q.b) || 0) + 1);
      }
    }
  }

  for (const b of world.buildingList) {
    if (b.dead || b.owner !== me || b.def.wall) continue;
    s.buildings.push(b);
    s.have.set(b.type, (s.have.get(b.type) || 0) + 1);
    if (b.constructed) {
      let list = s.done.get(b.type);
      if (!list) s.done.set(b.type, (list = []));
      list.push(b);
      if (b.type === 'town_center') s.tcs.push(b);
    } else {
      s.sites.push(b);
    }
    for (const q of b.queue) {
      if (q.u === 'tier_up') s.tierUp = true;
      else {
        s.queued.set(q.u, (s.queued.get(q.u) || 0) + 1);
        if (q.u && b.type === 'temple') s.queuedGods++;
      }
    }
  }
  return s;
}

/** Count of a type alive + queued. */
export function countOf(s, type) {
  return (s.alive.get(type) || 0) + (s.queued.get(type) || 0);
}

/** Buildings of a type: completed + unfinished + paid orders. */
export function haveOf(s, type) {
  return s.have.get(type) || 0;
}

export function doneOf(s, type) {
  const l = s.done.get(type);
  return l ? l.length : 0;
}
