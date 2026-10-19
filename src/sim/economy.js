// Worker economy: gold mining (MINE_SLOTS miners per mine, the rest wait their
// turn in FIFO order at their own spot on the mine's edge), wood chopping,
// returning cargo to drop-offs, and praying at shrines/temples for faith
// (with prayer slots).
import { MINE_TIME, CARRY_AMOUNT, CHOP_INTERVAL, DT } from '../config.js';
import { moveToRect, moveToPoint, stopMove } from './movement.js';
import { hyp, distPointRect } from './common.js';
import { NO_MODS } from '../data/upgrades.js';

const REACH = 0.5; // edge distance to work at a mine / tree / drop-off
const SPOT_OFFSET = 0.42; // mining spots stand this far outside the mine's edge

function modsOf(world, u) {
  const p = world.players[u.owner];
  return p ? p.mods : NO_MODS;
}

/** Gold ('g') or wood ('w') a worker brings back per trip (Iron Picks, Handcarts add to it). */
export function carryCap(world, u, res) {
  return CARRY_AMOUNT + modsOf(world, u).carry[res];
}

/** Seconds per wood chopped (Sharpened Axes shortens it). */
function chopInterval(world, u) {
  return CHOP_INTERVAL / (1 + modsOf(world, u).chop);
}

function reachRect(u, tx, ty, size) {
  return distPointRect(u.x, u.y, tx, ty, tx + size, ty + size) - u.radius <= REACH;
}

/** Nearest completed drop-off building (Town Center / Storehouse) of the unit's owner. */
export function nearestDropOff(world, u) {
  let best = null;
  let bestD = Infinity;
  for (const b of world.buildingList) {
    if (b.dead || b.owner !== u.owner || !b.constructed || !b.def.dropOff) continue;
    const d = distPointRect(u.x, u.y, b.tx, b.ty, b.tx + b.size, b.ty + b.size);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** Nearest completed drop-off of a player to a point. */
export function nearestDropOffTo(world, owner, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const b of world.buildingList) {
    if (b.dead || b.owner !== owner || !b.constructed || !b.def.dropOff) continue;
    const d = distPointRect(x, y, b.tx, b.ty, b.tx + b.size, b.ty + b.size);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** Nearest gold mine to a point (optionally within maxR). */
export function nearestMine(world, x, y, maxR = Infinity) {
  let best = null;
  let bestD = maxR;
  for (const m of world.mineList) {
    if (m.dead) continue;
    const d = distPointRect(x, y, m.tx, m.ty, m.tx + m.size, m.ty + m.size);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

export function deposit(world, u) {
  if (!u.carry || u.carryAmount <= 0) {
    u.carry = 0;
    u.carryAmount = 0;
    return;
  }
  const p = world.players[u.owner];
  if (p) {
    if (u.carry === 'g') p.gold += u.carryAmount;
    else p.wood += u.carryAmount;
    p.stats.gathered += u.carryAmount;
  }
  u.carry = 0;
  u.carryAmount = 0;
}

/** Walk to the nearest drop-off and deposit. Returns 'done' | 'walking' | 'none'. */
function returnStep(world, u) {
  const drop = nearestDropOff(world, u);
  if (!drop) {
    if (u.mv) stopMove(u);
    return 'none';
  }
  u.target = drop.id;
  if (reachRect(u, drop.tx, drop.ty, drop.size)) {
    deposit(world, u);
    if (u.mv) stopMove(u);
    return 'done';
  }
  const mv = moveToRect(world, u, drop.tx, drop.ty, drop.size, `e${drop.id}`);
  // A failed walk stays on the unit (moveToRect retries it every 2 s), so a
  // carrier whose drop-off is walled in does not search the map every tick.
  if (mv.failed) return 'none';
  return 'walking';
}

function nextTree(world, x, y, exclude) {
  const map = world.map;
  return map.spiralNearest(x, y, 10, (tx, ty) => !(exclude && tx === exclude.tx && ty === exclude.ty) && map.isTreeAccessible(tx, ty));
}

/**
 * Remember the resource the worker gathers now (u.lastGather), whatever gave
 * the order (command, rally, a mine or tree switch), so Return Cargo resumes it.
 */
function noteGather(u, o) {
  const g = u.lastGather;
  if (o.mine) {
    if (!g || g.mine !== o.mine) u.lastGather = { type: 'gather', mine: o.mine };
  } else if (!g || !g.tree || g.tree.tx !== o.tree.tx || g.tree.ty !== o.tree.ty) {
    u.lastGather = { type: 'gather', tree: { tx: o.tree.tx, ty: o.tree.ty } };
  }
}

/**
 * Gather order: { type: 'gather', mine?: id, tree?: {tx, ty}, phase: 'go'|'work'|'return', timer, fails }.
 * Returns true when the order is finished.
 */
export function updateGather(world, u, o) {
  noteGather(u, o);
  const want = o.mine ? 'g' : 'w';
  if (o.phase !== 'return') {
    if (u.carry && u.carry !== want && u.carryAmount > 0) o.phase = 'return';
    else if (u.carry === want && u.carryAmount >= carryCap(world, u, want)) o.phase = 'return';
  }
  if (o.phase === 'return') {
    u.state = 'return';
    const r = returnStep(world, u);
    if (r === 'done') o.phase = 'go';
    else if (r === 'none') u.state = 'idle';
    if (r !== 'done') return false;
  }
  if (o.mine) return gatherGold(world, u, o);
  return gatherWood(world, u, o);
}

// ---- Gold mining ----

/**
 * Standing spots around a mine footprint: one per tile touching it (edges and
 * corners), just outside the edge, ordered row by row. Passability is checked
 * when a spot is claimed.
 */
export function mineSpots(tx, ty, size) {
  const spots = [];
  for (let y = ty - 1; y <= ty + size; y++) {
    for (let x = tx - 1; x <= tx + size; x++) {
      if (x >= tx && x < tx + size && y >= ty && y < ty + size) continue;
      const cx = Math.max(tx, Math.min(tx + size, x + 0.5));
      const cy = Math.max(ty, Math.min(ty + size, y + 0.5));
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = hyp(dx, dy);
      spots.push({ x: cx + (dx / d) * SPOT_OFFSET, y: cy + (dy / d) * SPOT_OFFSET, tx: x, ty: y });
    }
  }
  return spots;
}

function holdsSpot(world, m, i) {
  const id = m.spotHolders[i];
  if (!id) return false;
  const u = world.entities.get(id);
  const o = u && !u.dead ? u.order : null;
  return !!(o && o.type === 'gather' && o.mine === m.id && o.spot === i);
}

/**
 * The worker's own spot on the mine edge, claiming the free one closest to its
 * owner's nearest drop-off (so the first workers stand on the near side and
 * later ones spread around the mine). null when every usable spot is taken.
 */
function claimSpot(world, m, u, o) {
  const map = world.map;
  if (o.spot >= 0 && m.spotHolders[o.spot] === u.id) {
    const s = m.spots[o.spot];
    if (map.isPassable(s.tx, s.ty)) return s;
    m.spotHolders[o.spot] = 0;
  }
  o.spot = -1;
  const drop = nearestDropOffTo(world, u.owner, m.x, m.y);
  let best = -1;
  let bestC = Infinity;
  for (let i = 0; i < m.spots.length; i++) {
    if ((o.badSpots || 0) & (1 << i)) continue;
    const s = m.spots[i];
    if (!map.isPassable(s.tx, s.ty) || holdsSpot(world, m, i)) continue;
    const toWorker = hyp(s.x - u.x, s.y - u.y);
    const c = (drop ? distPointRect(s.x, s.y, drop.tx, drop.ty, drop.tx + drop.size, drop.ty + drop.size) : toWorker) + toWorker * 0.01;
    if (c < bestC - 1e-9) {
      bestC = c;
      best = i;
    }
  }
  if (best < 0) return null;
  m.spotHolders[best] = u.id;
  o.spot = best;
  return m.spots[best];
}

function minerValid(world, m, i) {
  const id = m.miners[i];
  if (!id) return false;
  const u = world.entities.get(id);
  const o = u && !u.dead ? u.order : null;
  return !!(o && o.type === 'gather' && o.mine === m.id && o.phase === 'work' && o.slot === i);
}

function waiterValid(world, m, id) {
  const u = world.entities.get(id);
  const o = u && !u.dead ? u.order : null;
  return !!(o && o.type === 'gather' && o.mine === m.id && o.phase === 'wait');
}

function freeSlot(world, m) {
  for (let i = 0; i < m.miners.length; i++) {
    if (!minerValid(world, m, i)) {
      m.miners[i] = 0;
      return i;
    }
  }
  return -1;
}

/** Workers mining a mine right now (0..MINE_SLOTS). */
export function activeMiners(world, m) {
  if (!m.miners) return 0;
  let n = 0;
  for (let i = 0; i < m.miners.length; i++) if (minerValid(world, m, i)) n++;
  return n;
}

/**
 * Start a trip in `slot`. The timer runs from the next tick on, so a slot is
 * busy exactly MINE_TIME per trip whether the worker took it during its own
 * update or was handed it during the previous miner's (and it pauses while
 * the worker is stunned, like every other order).
 */
function beginMining(world, m, u, o, slot) {
  m.miners[slot] = u.id;
  o.slot = slot;
  o.phase = 'work';
  o.timer = MINE_TIME;
  o.startT = world.tickCount;
}

/** Give a free slot to the first valid waiter (FIFO). */
function handOff(world, m) {
  const q = m.waiting;
  while (q.length) {
    const slot = freeSlot(world, m);
    if (slot < 0) return;
    const id = q.shift();
    if (!waiterValid(world, m, id)) continue;
    const w = world.entities.get(id);
    beginMining(world, m, w, w.order, slot);
    return;
  }
}

/** A waiting worker takes a slot when one is free and nobody waited longer. */
function tryStartMining(world, m, u, o) {
  const q = m.waiting;
  while (q.length && !waiterValid(world, m, q[0])) q.shift();
  if (!q.includes(u.id)) q.push(u.id);
  if (q[0] !== u.id) return false;
  const slot = freeSlot(world, m);
  if (slot < 0) return false;
  q.shift();
  beginMining(world, m, u, o, slot);
  return true;
}

function resetMineState(o) {
  o.phase = 'go';
  o.spot = -1;
  o.slot = -1;
  o.badSpots = 0;
}

function gatherGold(world, u, o) {
  let mine = world.entities.get(o.mine);
  if (!mine || mine.dead || mine.kind !== 'mine') {
    const repl = nearestMine(world, o.lastX ?? u.x, o.lastY ?? u.y, 16);
    if (!repl) {
      if (u.carryAmount > 0) {
        o.phase = 'return';
        return false;
      }
      return true;
    }
    o.mine = repl.id;
    mine = repl;
    resetMineState(o);
  }
  o.lastX = mine.x;
  o.lastY = mine.y;
  u.state = 'gather';
  u.target = mine.id;
  if (o.phase === 'go') {
    const spot = claimSpot(world, mine, u, o);
    let there = false;
    if (spot) {
      if (hyp(spot.x - u.x, spot.y - u.y) <= 0.1) there = true;
      else {
        const mv = moveToPoint(world, u, spot.x, spot.y);
        if (mv.arrived || mv.failed) {
          if (reachRect(u, mine.tx, mine.ty, mine.size)) there = true;
          else {
            // Spot not reachable from here: never try it again on this order.
            mine.spotHolders[o.spot] = 0;
            o.badSpots = (o.badSpots || 0) | (1 << o.spot);
            o.spot = -1;
            stopMove(u);
            return false;
          }
        }
      }
    } else if (reachRect(u, mine.tx, mine.ty, mine.size)) {
      there = true;
    } else {
      const mv = moveToRect(world, u, mine.tx, mine.ty, mine.size, `e${mine.id}`);
      if (mv.failed) {
        stopMove(u);
        return true;
      }
    }
    if (!there) return false;
    if (u.mv) stopMove(u);
    o.phase = 'wait';
  }
  u.facing = Math.atan2(mine.y - u.y, mine.x - u.x);
  if (o.phase === 'wait') {
    if (!reachRect(u, mine.tx, mine.ty, mine.size)) {
      o.phase = 'go'; // pushed away (knockback): walk back to the spot
      return false;
    }
    if (!tryStartMining(world, mine, u, o)) return false;
  }
  if (o.phase === 'work') {
    if (mine.miners[o.slot] !== u.id || !reachRect(u, mine.tx, mine.ty, mine.size)) {
      if (mine.miners[o.slot] === u.id) mine.miners[o.slot] = 0;
      o.slot = -1;
      o.phase = 'go';
      handOff(world, mine);
      return false;
    }
    if (world.tickCount > o.startT) o.timer -= DT;
    if (o.timer <= 1e-9) {
      const take = Math.min(carryCap(world, u, 'g'), mine.amount);
      mine.amount -= take;
      u.carry = 'g';
      u.carryAmount = take;
      mine.miners[o.slot] = 0;
      o.slot = -1;
      o.phase = 'return';
      if (mine.amount <= 0) world.depleteMine(mine);
      else handOff(world, mine);
    }
  }
  return false;
}

function gatherWood(world, u, o) {
  const map = world.map;
  let tree = o.tree;
  if (!map.isForest(tree.tx, tree.ty)) {
    const next = nextTree(world, tree.tx + 0.5, tree.ty + 0.5, null);
    if (!next) {
      if (u.carryAmount > 0) {
        o.phase = 'return';
        return false;
      }
      return true;
    }
    o.tree = tree = next;
    if (o.phase === 'work') o.phase = 'go';
  }
  u.state = 'gather';
  u.target = 0;
  if (o.phase === 'go') {
    if (reachRect(u, tree.tx, tree.ty, 1)) {
      if (u.mv) stopMove(u);
      o.phase = 'work';
      o.timer = chopInterval(world, u);
    } else {
      const mv = moveToRect(world, u, tree.tx, tree.ty, 1, `t${tree.tx},${tree.ty}`);
      if (mv.failed) {
        stopMove(u);
        o.fails = (o.fails || 0) + 1;
        const next = o.fails <= 3 ? nextTree(world, u.x, u.y, tree) : null;
        if (!next) return true;
        o.tree = next;
      }
      return false;
    }
  }
  if (o.phase === 'work') {
    u.facing = Math.atan2(tree.ty + 0.5 - u.y, tree.tx + 0.5 - u.x);
    o.timer -= DT;
    if (o.timer <= 1e-9) {
      o.timer += chopInterval(world, u);
      const res = map.takeWood(tree.tx, tree.ty, 1);
      if (res.taken > 0) {
        if (u.carry !== 'w') {
          u.carry = 'w';
          u.carryAmount = 0;
        }
        u.carryAmount += res.taken;
        o.fails = 0;
      }
      if (res.felled) world.onTreeFelled(tree.tx, tree.ty);
      if (u.carryAmount >= carryCap(world, u, 'w')) {
        o.phase = 'return';
      } else if (res.felled || res.taken === 0) {
        const next = nextTree(world, u.x, u.y, null);
        if (next) {
          o.tree = next;
          o.phase = 'go';
        } else if (u.carryAmount > 0) {
          o.phase = 'return';
        } else {
          return true;
        }
      }
    }
  }
  return false;
}

/** returnCargo order: { type: 'return', resume } — deposit then resume gathering. */
export function updateReturn(world, u, o) {
  if (!u.carry || u.carryAmount <= 0) return true;
  u.state = 'return';
  const r = returnStep(world, u);
  if (r === 'none') {
    u.state = 'idle';
    return true;
  }
  return r === 'done';
}

// ---- Praying ----

/** Kneeling positions around a prayer building (south side first). */
export function computePrayerSpots(world, b) {
  const map = world.map;
  const s = b.size;
  const spots = [];
  const add = (tx, ty, side, ox, oy) => {
    if (!map.isPassable(tx, ty)) return;
    spots.push({ x: tx + 0.5 + ox, y: ty + 0.5 + oy, side, d: Math.abs(tx + 0.5 - (b.tx + s / 2)) });
  };
  for (let x = b.tx; x < b.tx + s; x++) add(x, b.ty + s, 0, 0, -0.15);
  for (let y = b.ty; y < b.ty + s; y++) {
    add(b.tx - 1, y, 1, 0.15, 0);
    add(b.tx + s, y, 1, -0.15, 0);
  }
  add(b.tx - 1, b.ty + s, 2, 0.1, -0.1);
  add(b.tx + s, b.ty + s, 2, -0.1, -0.1);
  for (let x = b.tx; x < b.tx + s; x++) add(x, b.ty - 1, 3, 0, 0.15);
  add(b.tx - 1, b.ty - 1, 4, 0.1, 0.1);
  add(b.tx + s, b.ty - 1, 4, -0.1, 0.1);
  spots.sort((a, c) => a.side - c.side || a.d - c.d || a.y - c.y || a.x - c.x);
  const n = b.def.prayerSlots;
  const out = [];
  for (let i = 0; i < n; i++) {
    const sp = spots.length ? spots[i % spots.length] : { x: b.x, y: b.ty + s + 0.4 };
    const lap = spots.length ? Math.floor(i / spots.length) : i;
    out.push({ x: sp.x + lap * 0.25, y: sp.y + lap * 0.1 });
  }
  b.praySpots = out;
  b.praySpotsVer = map.version;
  return out;
}

function slotHolderValid(world, b, idx) {
  const id = b.prayers[idx];
  if (!id) return false;
  const u = world.entities.get(id);
  return !!(u && !u.dead && u.order && u.order.type === 'pray' && u.order.building === b.id && u.order.slot === idx);
}

/** Reserve a prayer slot for u. Returns the slot index or -1 when full. */
export function reservePrayerSlot(world, b, u) {
  for (let i = 0; i < b.prayers.length; i++) {
    if (b.prayers[i] === u.id) return i;
  }
  for (let i = 0; i < b.prayers.length; i++) {
    if (!slotHolderValid(world, b, i)) {
      b.prayers[i] = u.id;
      return i;
    }
  }
  return -1;
}

export function releasePrayerSlot(world, u, o) {
  const b = world.entities.get(o.building);
  if (b && b.prayers && b.prayers[o.slot] === u.id) b.prayers[o.slot] = 0;
}

/** Pray order: { type: 'pray', building, slot, kneel }. Returns true when finished. */
export function updatePray(world, u, o) {
  const b = world.entities.get(o.building);
  if (!b || b.dead || !b.constructed || b.owner !== u.owner || b.prayers[o.slot] !== u.id) return true;
  if (!b.praySpots || b.praySpotsVer !== world.map.version) computePrayerSpots(world, b);
  const spot = b.praySpots[o.slot];
  u.target = b.id;
  const d = hyp(spot.x - u.x, spot.y - u.y);
  if (o.kneel) {
    if (d > 1.0) o.kneel = false;
    else {
      u.state = 'pray';
      u.facing = Math.atan2(b.y - u.y, b.x - u.x);
      return false;
    }
  }
  if (d <= 0.15) {
    o.kneel = true;
    if (u.mv) stopMove(u);
    u.state = 'pray';
    u.facing = Math.atan2(b.y - u.y, b.x - u.x);
    return false;
  }
  u.state = 'move';
  const mv = moveToPoint(world, u, spot.x, spot.y);
  if (mv.arrived) {
    // Could not stand exactly on the spot (crowded): kneel if close to the building.
    if (distPointRect(u.x, u.y, b.tx, b.ty, b.tx + b.size, b.ty + b.size) - u.radius <= 1.0) {
      o.kneel = true;
      stopMove(u);
      u.state = 'pray';
      return false;
    }
    return true;
  }
  return false;
}
