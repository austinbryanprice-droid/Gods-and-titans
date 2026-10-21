// Production: training queues with cost and population reserved up front,
// god/titan summoning rules, reviving fallen gods, tier upgrades, building
// upgrade research, rally points and spawning at the footprint edge nearest
// the rally.
import { MAX_QUEUE, MAX_GODS, MAX_TITANS, GOD_SLOT_TIER, GOD_MAX_LEVEL, GOD_XP_LEVELS, DT, POP_MAX } from '../config.js';
import { getUnitType, producibleAt } from '../data/index.js';
import { getUpgrade, buildingMods, reviveMult } from '../data/upgrades.js';
import { refund, tierMessage, requiresMessage } from './construction.js';
import { hyp } from './common.js';

/** Count living + queued units of a class for a player. */
function countClass(world, player, cls) {
  let n = 0;
  for (const u of world.unitList) if (!u.dead && u.owner === player && u.def.class === cls && !u.summoned) n++;
  for (const b of world.buildingList) {
    if (b.dead || b.owner !== player) continue;
    for (const q of b.queue) {
      if (q.u === 'tier_up') continue;
      const d = getUnitType(q.u);
      if (d && d.class === cls) n++;
    }
  }
  return n;
}

function hasGod(world, player, typeId) {
  for (const u of world.unitList) if (!u.dead && u.owner === player && u.type === typeId) return true;
  for (const b of world.buildingList) {
    if (b.dead || b.owner !== player) continue;
    for (const q of b.queue) if (q.u === typeId) return true;
  }
  return false;
}

function tierName(t) {
  return t >= 3 ? 'City' : 'Town';
}

function scaledCost(cost, mult) {
  return {
    gold: Math.round((cost.gold || 0) * mult),
    wood: Math.round((cost.wood || 0) * mult),
    faith: Math.round((cost.faith || 0) * mult),
  };
}

/** train command (also summons gods/titans and revives fallen gods). */
export function issueTrain(world, player, b, unitId) {
  if (!b || b.dead || b.kind !== 'building' || b.owner !== player || !b.constructed) return;
  const p = world.players[player];
  const def = getUnitType(unitId);
  if (!def) return;
  if (!producibleAt(b.type, p.pantheon).includes(unitId)) return;
  if (b.queue.some((q) => q.u === 'tier_up')) return world.error(player, 'Your settlement is already growing.');
  if (b.queue.length >= MAX_QUEUE) return world.error(player, 'Production queue is full.');
  const fallen = def.class === 'god' ? p.fallen[unitId] : null;
  if (def.class === 'god') {
    if (hasGod(world, player, unitId)) return world.error(player, 'You already have that god.');
    const n = countClass(world, player, 'god');
    if (n >= MAX_GODS) return world.error(player, `You can only have ${MAX_GODS} gods.`);
    const need = GOD_SLOT_TIER[n] || 3;
    if (p.tier < need) return world.error(player, `Your next god requires ${tierName(need)}.`);
  } else if (def.class === 'titan') {
    if (countClass(world, player, 'titan') >= MAX_TITANS) return world.error(player, 'You already have a Titan.');
    if (def.tier > p.tier) return world.error(player, tierMessage(def.tier));
  } else if (def.tier > p.tier) {
    return world.error(player, tierMessage(def.tier));
  }
  const revive = reviveMult(p.mods);
  const cost = fallen ? scaledCost(def.cost, revive) : { gold: def.cost.gold || 0, wood: def.cost.wood || 0, faith: def.cost.faith || 0 };
  const msg = world.affordError(player, cost);
  if (msg) return world.error(player, msg);
  if (p.popUsed + def.pop > p.popCap) {
    // At POP_MAX more Houses cannot help.
    return world.error(player, p.popCap >= POP_MAX ? `Population limit reached (${POP_MAX}).` : 'Not enough population. Build more Houses.');
  }
  world.pay(player, cost);
  const time = def.buildTime * (fallen ? revive : 1);
  b.queue.push({ u: unitId, time, elapsed: 0, cost, pop: def.pop, revive: fallen ? { level: fallen.level, xp: fallen.xp } : null });
  if (fallen) delete p.fallen[unitId];
  p.popUsed += def.pop;
  if (def.class === 'titan') world.emit({ type: 'titanSummoning', player, t: unitId });
}

/** cancelTrain: remove a queue item and refund it. */
export function cancelTrain(world, player, b, index) {
  if (!b || b.dead || b.kind !== 'building' || b.owner !== player) return;
  const i = Number.isInteger(index) ? index : b.queue.length - 1;
  if (i < 0 || i >= b.queue.length) return;
  const [item] = b.queue.splice(i, 1);
  refund(world, player, item.cost);
  const p = world.players[player];
  if (item.revive) p.fallen[item.u] = { level: item.revive.level, xp: item.revive.xp };
  p.popUsed = Math.max(0, p.popUsed - item.pop);
}

/** upgradeTier: queue the Town Center's next tier. */
export function issueTierUp(world, player, b) {
  if (!b || b.dead || b.type !== 'town_center' || b.owner !== player || !b.constructed) return;
  const up = (b.def.tierUpgrades || [])[b.tier];
  if (!up) return;
  for (const o of world.buildingList) {
    if (!o.dead && o.owner === player && o.queue.some((q) => q.u === 'tier_up')) return;
  }
  for (const req of up.requires || []) {
    if (!world.hasBuilding(player, req, true)) return world.error(player, requiresMessage(req));
  }
  if (b.queue.length >= MAX_QUEUE) return world.error(player, 'Production queue is full.');
  const msg = world.affordError(player, up.cost);
  if (msg) return world.error(player, msg);
  world.pay(player, up.cost);
  b.queue.push({ u: 'tier_up', time: up.time, elapsed: 0, cost: { ...up.cost }, pop: 0, revive: null, toTier: up.toTier });
}

/** Is this upgrade queued at any of the player's buildings? */
export function researching(world, player, upId) {
  for (const b of world.buildingList) {
    if (!b.dead && b.owner === player && b.queue.some((q) => q.u === upId)) return true;
  }
  return false;
}

/** research: queue a building upgrade at a building of its type (one-time per player). */
export function issueResearch(world, player, b, upId) {
  if (!b || b.dead || b.kind !== 'building' || b.owner !== player || !b.constructed) return;
  const up = getUpgrade(upId);
  if (!up || up.building !== b.type) return;
  const p = world.players[player];
  if (p.upgrades[upId]) return world.error(player, 'Already researched.');
  if (researching(world, player, upId)) return world.error(player, 'Already being researched.');
  if (up.after && !p.upgrades[up.after]) return world.error(player, `Requires ${getUpgrade(up.after).name}.`);
  if (up.tier > p.tier) return world.error(player, tierMessage(up.tier));
  if (b.queue.some((q) => q.u === 'tier_up')) return world.error(player, 'Your settlement is already growing.');
  if (b.queue.length >= MAX_QUEUE) return world.error(player, 'Production queue is full.');
  const msg = world.affordError(player, up.cost);
  if (msg) return world.error(player, msg);
  world.pay(player, up.cost);
  b.queue.push({ u: upId, time: up.time, elapsed: 0, cost: { ...up.cost }, pop: 0, revive: null, research: true });
}

/** rally: point, mine (workers gather) or tree tile (workers chop). */
export function setRally(world, player, b, x, y, targetId) {
  if (!b || b.dead || b.kind !== 'building' || b.owner !== player) return;
  const t = targetId ? world.entities.get(targetId) : null;
  if (t && !t.dead && t.id !== b.id) {
    b.rally = { x: t.x, y: t.y, target: t.id, tree: null };
    return;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    b.rally = null;
    return;
  }
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const tree = world.map.isForest(tx, ty) ? { tx, ty } : null;
  b.rally = { x, y, target: 0, tree };
}

/** Spawn point on the footprint edge nearest a point (passable tile). */
export function spawnPoint(world, b, toX, toY, big) {
  const map = world.map;
  const s = b.size;
  let best = null;
  let bestD = Infinity;
  for (let ring = 1; ring <= 4 && !best; ring++) {
    for (let y = b.ty - ring; y < b.ty + s + ring; y++) {
      for (let x = b.tx - ring; x < b.tx + s + ring; x++) {
        if (x > b.tx - ring && x < b.tx + s + ring - 1 && y > b.ty - ring && y < b.ty + s + ring - 1) continue;
        if (!(big ? map.inBounds(x, y) && map.pass3[y * map.width + x] === 1 : map.isPassable(x, y))) continue;
        const d = hyp(x + 0.5 - toX, y + 0.5 - toY);
        if (d < bestD) {
          bestD = d;
          best = { x: x + 0.5, y: y + 0.5 };
        }
      }
    }
    if (!best && big) big = false;
  }
  return best || { x: b.x, y: b.ty + s + 0.5 };
}

/** Send a freshly spawned unit to its building's rally. */
function followRally(world, b, u) {
  const r = b.rally;
  if (!r) return;
  const worker = u.def.class === 'worker';
  if (r.target) {
    const t = world.entities.get(r.target);
    if (t && !t.dead) {
      if (worker && t.kind === 'mine') return world.setOrder(u, { type: 'gather', mine: t.id, phase: 'go', timer: 0 }, false);
      if (t.kind === 'unit' && t.owner === u.owner) return world.setOrder(u, { type: 'follow', target: t.id }, false);
      if (t.kind === 'unit' || t.kind === 'building') {
        if (world.areEnemies(u.owner, t.owner)) return world.setOrder(u, { type: 'attackMove', x: t.x, y: t.y, group: null, target: 0 }, false);
      }
      return world.setOrder(u, { type: 'move', x: t.x, y: t.y + (t.kind === 'unit' ? 0 : t.size / 2 + 0.7), group: null }, false);
    }
  }
  if (worker && r.tree) return world.setOrder(u, { type: 'gather', tree: { tx: r.tree.tx, ty: r.tree.ty }, phase: 'go', timer: 0 }, false);
  world.setOrder(u, { type: 'move', x: r.x, y: r.y, group: null }, false);
}

/** Advance the first queue item; spawn or tier up on completion. */
export function updateProduction(world, b) {
  if (!b.constructed || b.queue.length === 0) return;
  const item = b.queue[0];
  const p = world.players[b.owner];
  const unit = item.u !== 'tier_up' && !item.research;
  // Drill Yard / Widened Rift: units of this building train faster; Imperial Bureaucracy speeds up research and growth.
  item.elapsed += p ? DT * (unit ? 1 + buildingMods(p.mods, b.type).train : 1 + p.mods.perks.techSpeed) : DT;
  if (item.elapsed < item.time - 1e-9) return;
  b.queue.shift();
  if (item.u === 'tier_up') {
    b.tier = item.toTier;
    world.recomputeTier(b.owner);
    return;
  }
  if (item.research) {
    world.completeResearch(b.owner, item.u);
    return;
  }
  p.popUsed = Math.max(0, p.popUsed - item.pop);
  const def = getUnitType(item.u);
  if (!def) return;
  const r = b.rally;
  const sp = spawnPoint(world, b, r ? r.x : b.x, r ? r.y : b.ty + b.size + 2, def.radius >= 0.75);
  let level = item.revive ? item.revive.level : 1;
  let xp = item.revive ? item.revive.xp : 0;
  if (def.class === 'god' && p && p.mods.godLevel > 0) {
    // Rite of Ascension: gods arrive at least godLevel levels above 1.
    level = Math.min(GOD_MAX_LEVEL, Math.max(level, 1 + p.mods.godLevel));
    xp = Math.max(xp, GOD_XP_LEVELS[level - 1] || 0);
  }
  const u = world.spawnUnit(b.owner, item.u, sp.x, sp.y, { level, xp, facing: Math.atan2(sp.y - b.y, sp.x - b.x) });
  p.stats.unitsTrained++;
  if (u) followRally(world, b, u);
}
