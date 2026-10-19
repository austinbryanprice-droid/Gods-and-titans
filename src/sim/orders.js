// Per-unit order state machines: move, attack-move, attack, follow, hold,
// economy and construction orders, casts, idle auto-acquire and fight-back.
import { moveToPoint, moveToUnit, stopMove } from './movement.js';
import { engage, findTarget, findReachableTarget, targetCategory, acquisitionRange, canTarget } from './combat.js';
import { updateGather, updateReturn, updatePray, releasePrayerSlot } from './economy.js';
import { updateBuild, updateRepair, findRepairTarget, refund } from './construction.js';
import { updateCastOrder, tryAutocast } from './abilities.js';
import { updateCreep, aggroCamp } from './creeps.js';
import { isMelee } from './surround.js';
import { hyp, edgeDist } from './common.js';
import { AUTO_REPAIR_RANGE } from '../config.js';

const SCAN_EVERY = 4; // ticks between target scans for attack-move / idle units
const AUTOCAST_EVERY = 6;
const RETARGET_TICKS = 20; // ~1 s approaching / blocked before attack-move and auto-acquire look for a closer target
const SKIP_TICKS = 40; // an unreachable target is not re-acquired for this long
const SPOT_OPTS = { spots: true };
const AUTO_REPAIR_EVERY = 20; // ticks between an idle worshipper's looks for something to repair

/** Undo side effects of an order that will never run (refund builds, free prayer slots). */
export function discardOrder(world, u, o) {
  if (!o) return;
  if (o.type === 'build' && o.paid && !o.site) {
    refund(world, u.owner, o.paid);
    o.paid = null;
  } else if (o.type === 'pray') {
    releasePrayerSlot(world, u, o);
  }
}

/** Orders that never finish by themselves (gather and pray loop, hold and follow last). */
function openEnded(o) {
  const t = o.type;
  return t === 'gather' || t === 'pray' || t === 'hold' || t === 'follow' || (t === 'return' && !!o.resume);
}

/**
 * Append o to a unit's order queue. An open-ended order at the end of the
 * queue would keep everything behind it waiting forever, so (as with a WC3 /
 * SC2 harvest order) it is replaced by o instead; Return Cargo just drops
 * its resume and deposits first.
 */
function queueOrder(world, u, o) {
  const n = u.orders.length;
  const last = n ? u.orders[n - 1] : u.order;
  if (!last || !openEnded(last)) {
    u.orders.push(o);
  } else if (last.type === 'return') {
    last.resume = null;
    u.orders.push(o);
  } else if (n) {
    discardOrder(world, u, last);
    u.orders[n - 1] = o;
  } else {
    discardOrder(world, u, last);
    u.order = o;
    u.mv = null;
    u.target = 0;
    u.arrivedGroup = null;
  }
}

/** Replace (or with queue, append to) a unit's orders. o = null clears them. */
export function setOrder(world, u, o, queue = false) {
  if (queue && o && (u.order || u.orders.length)) {
    queueOrder(world, u, o);
    return;
  }
  discardOrder(world, u, u.order);
  for (const q of u.orders) discardOrder(world, u, q);
  u.orders.length = 0;
  u.order = o;
  u.mv = null;
  u.target = 0;
  u.arrivedGroup = null;
  if (!o) u.state = 'idle';
}

export function nextOrder(world, u) {
  u.order = u.orders.length ? u.orders.shift() : null;
  u.mv = null;
  u.target = 0;
}

function scanTick(world, u) {
  return (world.tickCount + u.id) % SCAN_EVERY === 0;
}

/**
 * Attack-move / auto-acquire re-targeting (WC3): after ~1 s of approaching,
 * switch to an enemy in attack range right now (same or better priority than
 * the current target); after ~1 s blocked (no free attack spot, no progress),
 * switch to the nearest enemy u can actually reach.
 */
function retarget(world, u, t) {
  const blocked = u.blockedT >= RETARGET_TICKS;
  if (!blocked && u.engT < RETARGET_TICKS) return null;
  const atk = u.def.attack;
  const inReach = findTarget(world, u, atk.range + 0.02, { exclude: t.id, maxCat: blocked ? 9 : targetCategory(t) });
  if (inReach) return inReach;
  return blocked ? findReachableTarget(world, u, acquisitionRange(u), t) : null;
}

function idle(world, u) {
  u.state = 'idle';
  u.target = 0;
  if (u.mv) stopMove(u);
  if (u.def.class === 'worker') {
    const p = world.players[u.owner];
    if (p && p.autoRepair && (world.tickCount + u.id) % AUTO_REPAIR_EVERY === 0) {
      const b = findRepairTarget(world, u, AUTO_REPAIR_RANGE);
      if (b) u.order = { type: 'repair', target: b.id, auto: true };
    }
    return;
  }
  if (!u.def.attack) return;
  if (!scanTick(world, u)) return;
  const t = findTarget(world, u, acquisitionRange(u), isMelee(u) ? SPOT_OPTS : undefined);
  if (t) {
    u.order = { type: 'attack', target: t.id, auto: true, ox: u.x, oy: u.y };
    engage(world, u, t, true);
  }
}

function runAttackMove(world, u, o) {
  if (!u.def.attack) {
    u.state = 'move';
    return moveToPoint(world, u, o.x, o.y, o.group).arrived;
  }
  if (o.target) {
    const t = world.entities.get(o.target);
    if (t && !t.dead && canTarget(world, u, t)) {
      const leash = acquisitionRange(u) + 3;
      if (u.state === 'attack' || edgeDist(u, t) <= leash) {
        const r = engage(world, u, t, true);
        if (r === 'hit') return false;
        if (r === 'approach' || r === 'blocked') {
          const alt = scanTick(world, u) ? retarget(world, u, t) : null;
          if (alt) {
            o.target = alt.id;
            u.mv = null;
            engage(world, u, alt, true);
          }
          return false;
        }
        if (r === 'unreachable') {
          o.skip = t.id;
          o.skipUntil = world.tickCount + SKIP_TICKS;
        }
      }
    }
    o.target = 0;
    u.mv = null;
  }
  if (scanTick(world, u) || o.rescan) {
    o.rescan = false;
    const skip = o.skip && world.tickCount < o.skipUntil ? o.skip : 0;
    const t = findTarget(world, u, acquisitionRange(u), { exclude: skip, spots: isMelee(u) });
    if (t) {
      o.target = t.id;
      u.mv = null;
      engage(world, u, t, true);
      return false;
    }
  }
  u.state = 'move';
  u.target = 0;
  const mv = moveToPoint(world, u, o.x, o.y, o.group);
  return mv.arrived;
}

function runAttack(world, u, o) {
  const t = world.entities.get(o.target);
  if (!t || t.dead || !canTarget(world, u, t)) {
    if (o.auto) {
      const nt = findTarget(world, u, acquisitionRange(u));
      if (nt) {
        o.target = nt.id;
        u.mv = null;
        return false;
      }
    }
    return true;
  }
  if (o.auto) {
    // Guard leash: don't chase forever after auto-acquiring.
    const acq = acquisitionRange(u);
    if (hyp(u.x - o.ox, u.y - o.oy) > acq + 5 && edgeDist(u, t) > u.def.attack.range) {
      u.order = { type: 'move', x: o.ox, y: o.oy, group: null, back: true };
      u.mv = null;
      return false;
    }
  }
  const r = engage(world, u, t, true);
  if (o.auto) {
    // Auto-acquired fights switch to an enemy in reach when this one is blocked or unreachable.
    let alt = null;
    if (r === 'unreachable') alt = findReachableTarget(world, u, acquisitionRange(u), t);
    else if ((r === 'approach' || r === 'blocked') && scanTick(world, u)) alt = retarget(world, u, t);
    if (alt) {
      o.target = alt.id;
      u.mv = null;
      return false;
    }
  }
  // Explicit attack orders keep their target (engage keeps trying other attack spots).
  return r === 'lost' || r === 'unreachable';
}

function runHold(world, u, o) {
  if (u.mv) stopMove(u);
  if (!u.def.attack) {
    u.state = 'idle';
    return false;
  }
  const range = u.def.attack.range;
  let t = o.target ? world.entities.get(o.target) : null;
  if (t && (t.dead || !canTarget(world, u, t) || edgeDist(u, t) > range + 0.35)) t = null;
  if (!t && (world.tickCount + u.id) % 3 === 0) t = findTarget(world, u, range);
  o.target = t ? t.id : 0;
  if (t) engage(world, u, t, false);
  else {
    u.state = 'idle';
    u.target = 0;
  }
  return false;
}

function runFollow(world, u, o) {
  const t = world.entities.get(o.target);
  if (!t || t.dead) return true;
  u.target = t.id;
  const d = edgeDist(u, t);
  if (d > 1.2) {
    u.state = 'move';
    moveToUnit(world, u, t);
  } else if (d < 0.6 || !t.moving) {
    if (u.mv) stopMove(u);
    u.state = 'idle';
  }
  return false;
}

/** Run the current order for one tick. Returns true when it finished. */
function runOrder(world, u, o) {
  switch (o.type) {
    case 'move': {
      u.state = 'move';
      u.target = 0;
      return moveToPoint(world, u, o.x, o.y, o.group).arrived;
    }
    case 'attackMove': return runAttackMove(world, u, o);
    case 'attack': return runAttack(world, u, o);
    case 'hold': return runHold(world, u, o);
    case 'follow': return runFollow(world, u, o);
    case 'gather': return u.def.class !== 'worker' || updateGather(world, u, o);
    case 'return': {
      const done = updateReturn(world, u, o);
      if (done && o.resume) {
        u.order = { ...o.resume, phase: 'go', timer: 0 };
        u.mv = null;
        return false;
      }
      return done;
    }
    case 'build': return u.def.class !== 'worker' || updateBuild(world, u, o);
    case 'repair': return u.def.class !== 'worker' || updateRepair(world, u, o);
    case 'pray': return u.def.class !== 'worker' || updatePray(world, u, o);
    case 'cast': return updateCastOrder(world, u, o);
    default: return true;
  }
}

function autocastAllowed(u) {
  const o = u.order;
  if (!o) return true;
  return o.type === 'attack' || o.type === 'attackMove' || o.type === 'hold' || o.type === 'follow';
}

/** Per-tick update for one unit. */
export function updateUnit(world, u) {
  if (u.dead) return;
  if (u.forced) {
    u.ghost = true;
    return;
  }
  if (u.stunned) {
    u.state = 'idle';
    u.ghost = false;
    return;
  }
  if (u.camp) {
    u.ghost = false;
    if (u.order && u.order.type === 'cast') {
      if (updateCastOrder(world, u, u.order)) nextOrder(world, u);
    } else {
      u.order = null;
      updateCreep(world, u);
      if (u.autocast.length && u.creepState === 'fight' && (world.tickCount + u.id) % AUTOCAST_EVERY === 0) tryAutocast(world, u);
    }
    return;
  }
  for (let guard = 0; guard < 4; guard++) {
    const o = u.order;
    if (!o) {
      idle(world, u);
      break;
    }
    if (!runOrder(world, u, o)) break;
    nextOrder(world, u);
  }
  u.ghost = u.def.class === 'worker' && (u.state === 'gather' || u.state === 'return' || u.state === 'pray');
  if (u.autocast.length && (world.tickCount + u.id) % AUTOCAST_EVERY === 0 && autocastAllowed(u)) tryAutocast(world, u);
}

/**
 * A unit was damaged: idle units fight back (workers too, unless busy), idle
 * nearby allies join in, creep camps wake up.
 */
export function onUnitAttacked(world, t, src) {
  if (t.kind !== 'unit' || t.dead || !src || src.dead) return;
  if (!world.areEnemies(t.owner, src.owner)) return;
  if (t.camp) {
    if (t.creepState === 'idle') aggroCamp(world, t.camp, src);
    return;
  }
  if (!t.order && !t.forced && canTarget(world, t, src)) {
    t.order = { type: 'attack', target: src.id, auto: true, ox: t.x, oy: t.y };
    t.mv = null;
  }
  if (t.owner < 0 || world.time - (t.lastHelpT ?? -99) < 1.5) return;
  t.lastHelpT = world.time;
  for (const o of world.queryRadius(t.x, t.y, 7, (e) => e.kind === 'unit' && e.owner === t.owner && e !== t)) {
    if (o.order || o.forced || o.def.class === 'worker' || !canTarget(world, o, src)) continue;
    o.order = { type: 'attack', target: src.id, auto: true, ox: o.x, oy: o.y };
    o.mv = null;
  }
}
