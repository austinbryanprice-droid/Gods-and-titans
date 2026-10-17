// Neutral creep camps: spawning from map camps and the guard/chase/leash AI.
import { CREEP_AGGRO_RANGE, CREEP_LEASH_RANGE, NEUTRAL } from '../config.js';
import { PANTHEON_LIST } from '../data/index.js';
import { findTarget, engage, canTarget } from './combat.js';
import { moveToPoint, stopMove } from './movement.js';
import { hyp } from './common.js';

function creaturesOfTier(tier) {
  const out = [];
  for (const p of PANTHEON_LIST) for (const c of p.creatures) if (c.tier === tier) out.push(c.id);
  return out;
}

/** Spawn creeps for every camp (DESIGN 5.1 / task spec composition). */
export function spawnCreeps(world, camps) {
  const t1 = creaturesOfTier(1);
  const t2 = creaturesOfTier(2);
  const t3 = creaturesOfTier(3);
  const rng = world.rng;
  camps.forEach((c, idx) => {
    const level = Math.max(1, Math.min(3, c.level || 1));
    let types;
    if (level === 1) {
      const n = rng.int(2, 3);
      types = [];
      for (let i = 0; i < n; i++) types.push(rng.pick(t1));
    } else if (level === 2) {
      types = [rng.pick(t2), rng.pick(t1), rng.pick(t1)];
    } else {
      types = [rng.pick(t3), rng.pick(t2), rng.pick(t2)];
    }
    const camp = { index: idx, x: c.x, y: c.y, level, members: [] };
    world.camps.push(camp);
    const base = rng.next() * Math.PI * 2;
    types.forEach((t, i) => {
      const a = base + (i * Math.PI * 2) / types.length;
      const rr = i === 0 && level > 1 ? 0 : 1.4;
      const u = world.spawnUnit(NEUTRAL, t, c.x + Math.cos(a) * rr, c.y + Math.sin(a) * rr, { facing: rng.next() * Math.PI * 2, silent: true });
      if (!u) return;
      u.camp = camp;
      u.home = { x: u.x, y: u.y };
      u.creepState = 'idle';
      camp.members.push(u);
    });
  });
}

/** Wake a whole camp against an attacker. */
export function aggroCamp(world, camp, t) {
  for (const m of camp.members) {
    if (m.dead || m.creepState === 'return') continue;
    if (!canTarget(world, m, t)) continue;
    if (m.creepState !== 'fight' || !m.creepTarget) {
      m.creepState = 'fight';
      m.creepTarget = t.id;
    }
  }
}

function startReturn(u) {
  u.creepState = 'return';
  u.creepTarget = 0;
  u.target = 0;
  u.mv = null;
}

/** Per-tick creep behaviour. Returns nothing; sets state and movement. */
export function updateCreep(world, u) {
  const camp = u.camp;
  if (u.creepState === 'return') {
    u.state = 'move';
    const mv = moveToPoint(world, u, u.home.x, u.home.y);
    if (mv.arrived || hyp(u.x - u.home.x, u.y - u.home.y) < 0.4) {
      stopMove(u);
      u.creepState = 'idle';
      u.hp = u.maxHp;
      u.state = 'idle';
    }
    return;
  }
  if (hyp(u.x - camp.x, u.y - camp.y) > CREEP_LEASH_RANGE) {
    startReturn(u);
    return;
  }
  if (u.creepState === 'fight') {
    let t = u.creepTarget ? world.entities.get(u.creepTarget) : null;
    if (t && (t.dead || !canTarget(world, u, t) || hyp(t.x - camp.x, t.y - camp.y) > CREEP_LEASH_RANGE + 2)) t = null;
    if (!t) {
      t = findTarget(world, u, CREEP_AGGRO_RANGE);
      u.creepTarget = t ? t.id : 0;
    }
    if (!t) {
      startReturn(u);
      return;
    }
    const r = engage(world, u, t, true);
    if (r === 'lost' || r === 'unreachable') {
      u.creepTarget = 0;
      startReturn(u);
    }
    return;
  }
  // Idle at camp.
  u.state = 'idle';
  u.target = 0;
  if (u.mv) stopMove(u);
  if ((world.tickCount + u.id) % 4 === 0) {
    const t = findTarget(world, u, CREEP_AGGRO_RANGE);
    if (t) aggroCamp(world, camp, t);
  }
}
