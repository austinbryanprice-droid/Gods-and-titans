// Construction: placement rules, build orders (cost paid up front, refunded if
// abandoned before the site is placed), construction progress with helpers,
// cancelling unfinished buildings, and repairing damaged ones.
import {
  BUILD_HELPER_BONUS, CANCEL_BUILD_REFUND, DROPOFF_MINE_GAP, DT, TERRAIN, REPAIR_COST, REPAIR_TIME,
} from '../config.js';
import { BUILDINGS } from '../data/index.js';
import { moveToRect, stopMove } from './movement.js';
import { workSpeedOf } from './economy.js';
import { hyp, distPointRect } from './common.js';

const BUILD_REACH = 0.6;

/** Error message for a missing tier (2 → Town, 3 → City). */
export function tierMessage(tier) {
  return tier >= 3 ? 'Requires City.' : 'Requires Town.';
}

export function requiresMessage(typeId) {
  const b = BUILDINGS[typeId];
  return `Requires a ${b ? b.name : typeId}.`;
}

// Refusal texts (src/game/placement.js repeats them for the ghost). Only the
// text depends on the reason; whether a site is valid does not.
export const CANT_BUILD = "Can't build there.";
export const TOO_CLOSE_TO_MINE = 'Too close to a gold mine.';
export const TREES_IN_WAY = 'Trees in the way.';
export const BUILDING_IN_WAY = 'Another building is in the way.';
export const MINE_IN_WAY = 'A gold mine is in the way.';
export const UNIT_IN_WAY = 'Something is in the way.';

/** Own building type ids only (no prototype keys such as 'constructor'). */
export function buildingDef(typeId) {
  return typeof typeId === 'string' && Object.hasOwn(BUILDINGS, typeId) ? BUILDINGS[typeId] : null;
}

/**
 * Footprint placement rules (DESIGN 5.3). Own units on the site are allowed
 * (they get pushed out); enemy and neutral ground units block it. Drop-offs
 * (Town Center, Storehouse) keep a Chebyshev gap of DROPOFF_MINE_GAP empty
 * tiles from every gold mine.
 * When several things are wrong the text names the first of: water / rock /
 * map edge ("Can't build there."), trees, a building, a gold mine, a unit,
 * the mine gap.
 * @returns {string|null} null when the site is valid, else the error message
 */
export function placementError(world, player, typeId, tx, ty) {
  const def = buildingDef(typeId);
  if (!def || !Number.isInteger(tx) || !Number.isInteger(ty)) return CANT_BUILD;
  const map = world.map;
  const s = def.size;
  if (tx < 0 || ty < 0 || tx + s > map.width || ty + s > map.height) return CANT_BUILD;
  let trees = false;
  let building = false;
  let mine = false;
  for (let y = ty; y < ty + s; y++) {
    for (let x = tx; x < tx + s; x++) {
      if (map.isBuildable(x, y)) continue;
      const i = y * map.width + x;
      if (map.terrain[i] === TERRAIN.FOREST) trees = true;
      else if (!map.isWalkableTerrain(x, y)) return CANT_BUILD;
      else {
        const occupant = world.entities.get(map.occ[i]);
        if (occupant && occupant.kind === 'mine') mine = true;
        else building = true;
      }
    }
  }
  if (trees) return TREES_IN_WAY;
  if (building) return BUILDING_IN_WAY;
  if (mine) return MINE_IN_WAY;
  const tmp = world._tmpQuery;
  tmp.length = 0;
  world.hash.query(tx + s / 2, ty + s / 2, s / 2 + world.maxRadius + 0.5, tmp);
  for (const u of tmp) {
    if (u.dead || u.air || !world.areEnemies(player, u.owner)) continue;
    if (distPointRect(u.x, u.y, tx, ty, tx + s, ty + s) < u.radius * 0.8) return UNIT_IN_WAY;
  }
  if (def.dropOff) {
    for (const m of world.mineList) {
      if (m.dead) continue;
      const gx = Math.max(m.tx - (tx + s), tx - (m.tx + m.size), 0);
      const gy = Math.max(m.ty - (ty + s), ty - (m.ty + m.size), 0);
      if (Math.max(gx, gy) < DROPOFF_MINE_GAP) return TOO_CLOSE_TO_MINE;
    }
  }
  return null;
}

/** True when the building can be placed with its footprint top-left at (tx, ty). */
export function canPlace(world, player, typeId, tx, ty) {
  return placementError(world, player, typeId, tx, ty) === null;
}

function marginClear(world, tx, ty, s) {
  const map = world.map;
  for (let y = ty - 1; y <= ty + s; y++) {
    for (let x = tx - 1; x <= tx + s; x++) {
      if (x >= tx && x < tx + s && y >= ty && y < ty + s) continue;
      if (!map.inBounds(x, y)) return false;
      if (map.occ[y * map.width + x] !== 0) return false;
    }
  }
  return true;
}

/**
 * Find a valid footprint near a point. Prefers spots that keep a one-tile
 * walkway around the building, then accepts any valid spot.
 * @returns {{tx:number, ty:number}|null}
 */
export function findPlacement(world, player, typeId, nearX, nearY, maxR = 20) {
  const def = buildingDef(typeId);
  if (!def || !Number.isFinite(nearX) || !Number.isFinite(nearY)) return null;
  maxR = Math.min(Number.isFinite(maxR) ? maxR : 20, Math.max(world.map.width, world.map.height));
  const s = def.size;
  const cx = Math.round(nearX - s / 2);
  const cy = Math.round(nearY - s / 2);
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r <= maxR; r++) {
      let best = null;
      let bestD = Infinity;
      for (let ty = cy - r; ty <= cy + r; ty++) {
        const edge = ty === cy - r || ty === cy + r;
        for (let tx = cx - r; tx <= cx + r; tx += edge ? 1 : Math.max(1, 2 * r)) {
          const dx = tx + s / 2 - nearX;
          const dy = ty + s / 2 - nearY;
          const d = dx * dx + dy * dy;
          if (d >= bestD) continue;
          if (!canPlace(world, player, typeId, tx, ty)) continue;
          if (pass === 0 && !marginClear(world, tx, ty, s)) continue;
          best = { tx, ty };
          bestD = d;
        }
      }
      if (best) return best;
    }
  }
  return null;
}

/** Give back a paid cost. */
export function refund(world, player, cost, mult = 1) {
  const p = world.players[player];
  if (!p || !cost) return;
  p.gold += Math.floor((cost.gold || 0) * mult);
  p.wood += Math.floor((cost.wood || 0) * mult);
  p.faith += Math.floor((cost.faith || 0) * mult);
}

/**
 * build command (DESIGN 6.2). Validates, pays, and orders the closest worker
 * to build; other selected workers come along to help.
 */
export function issueBuild(world, player, workers, typeId, tx, ty, queue) {
  const def = buildingDef(typeId);
  if (!def || workers.length === 0 || !Number.isFinite(tx) || !Number.isFinite(ty)) return;
  const p = world.players[player];
  if (def.tier > p.tier) return world.error(player, tierMessage(def.tier));
  for (const req of def.requires || []) {
    if (!world.hasBuilding(player, req, true)) return world.error(player, requiresMessage(req));
  }
  const msg = world.affordError(player, def.cost);
  if (msg) return world.error(player, msg);
  tx = Math.floor(tx);
  ty = Math.floor(ty);
  const err = placementError(world, player, typeId, tx, ty);
  if (err) return world.error(player, err);
  world.pay(player, def.cost);
  const cx = tx + def.size / 2;
  const cy = ty + def.size / 2;
  let builder = workers[0];
  let bestD = Infinity;
  for (const w of workers) {
    const d = hyp(w.x - cx, w.y - cy);
    if (d < bestD) {
      bestD = d;
      builder = w;
    }
  }
  world.setOrder(builder, { type: 'build', b: typeId, tx, ty, paid: { ...def.cost }, site: 0, helper: false }, queue);
  for (const w of workers) {
    if (w !== builder) world.setOrder(w, { type: 'build', b: typeId, tx, ty, paid: null, site: 0, helper: true }, queue);
  }
}

function primaryPending(world, owner, o) {
  for (const u of world.unitList) {
    if (u.dead || u.owner !== owner) continue;
    const check = (q) => q && q.type === 'build' && !q.helper && !q.site && q.paid && q.tx === o.tx && q.ty === o.ty && q.b === o.b;
    if (check(u.order)) return true;
    for (const q of u.orders) if (check(q)) return true;
  }
  return false;
}

/**
 * Build order: walk to the site, place it on arrival, then construct.
 * Returns true when the order is finished.
 */
export function updateBuild(world, u, o) {
  if (o.site) {
    const b = world.entities.get(o.site);
    if (!b || b.dead || b.constructed) return true;
    if (distPointRect(u.x, u.y, b.tx, b.ty, b.tx + b.size, b.ty + b.size) - u.radius <= BUILD_REACH) {
      if (u.mv) stopMove(u);
      u.state = 'build';
      u.target = b.id;
      u.facing = Math.atan2(b.y - u.y, b.x - u.x);
      b.builders++;
      return false;
    }
    u.state = 'move';
    u.target = b.id;
    const mv = moveToRect(world, u, b.tx, b.ty, b.size, `e${b.id}`);
    if (mv.failed) {
      stopMove(u);
      return true;
    }
    return false;
  }
  const def = BUILDINGS[o.b];
  const s = def.size;
  const d = distPointRect(u.x, u.y, o.tx, o.ty, o.tx + s, o.ty + s) - u.radius;
  u.target = 0;
  if (o.helper) {
    const occ = world.map.inBounds(o.tx, o.ty) ? world.map.occ[o.ty * world.map.width + o.tx] : 0;
    const site = occ ? world.entities.get(occ) : null;
    if (site && site.kind === 'building' && site.owner === u.owner && site.type === o.b && site.tx === o.tx && site.ty === o.ty) {
      o.site = site.id;
      return site.constructed;
    }
    if (!primaryPending(world, u.owner, o)) return true;
    if (d > 1.2) {
      u.state = 'move';
      const mv = moveToRect(world, u, o.tx, o.ty, s, `site${o.tx},${o.ty}`);
      if (mv.failed) return true;
    } else {
      if (u.mv) stopMove(u);
      u.state = 'idle';
    }
    return false;
  }
  if (d <= BUILD_REACH) {
    if (u.mv) stopMove(u);
    const err = placementError(world, u.owner, o.b, o.tx, o.ty);
    if (!err) {
      const b = world.createBuilding(u.owner, o.b, o.tx, o.ty, false);
      o.site = b.id;
      o.paid = null;
      u.state = 'build';
      return false;
    }
    refund(world, u.owner, o.paid);
    o.paid = null;
    world.error(u.owner, err);
    return true;
  }
  u.state = 'move';
  const mv = moveToRect(world, u, o.tx, o.ty, s, `site${o.tx},${o.ty}`);
  if (mv.failed) {
    stopMove(u);
    refund(world, u.owner, o.paid);
    o.paid = null;
    world.error(u.owner, CANT_BUILD);
    return true;
  }
  return false;
}

/** Pyramid Builders: how much faster than usual its owner raises and mends buildings. */
function buildSpeed(world, b) {
  const p = world.players[b.owner];
  return p ? 1 + p.mods.perks.buildSpeed : 1;
}

/** Advance construction of an unfinished building from this tick's builders. */
export function updateConstruction(world, b) {
  if (b.constructed) return;
  const n = b.builders;
  b.builders = 0;
  if (n <= 0) return;
  const rate = (1 + BUILD_HELPER_BONUS * (n - 1)) * workSpeedOf(world, b.owner) * buildSpeed(world, b) / b.def.buildTime;
  const dp = Math.min(rate * DT, 1 - b.buildProgress);
  b.buildProgress += dp;
  b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * dp);
  if (b.buildProgress >= 1 - 1e-9) world.completeBuilding(b);
}

/** cancelBuild: remove an unfinished building and refund 75%. */
export function cancelBuild(world, player, b) {
  if (!b || b.dead || b.kind !== 'building' || b.owner !== player || b.constructed) return;
  refund(world, player, b.def.cost, CANCEL_BUILD_REFUND);
  world.removeBuilding(b);
}

// ---- Repair ----

const REPAIR_ERROR_EVERY = 3; // seconds between "Not enough gold to repair." for one building

/** A completed own building that is missing health (repair target). */
export function needsRepair(b) {
  return !!b && !b.dead && b.kind === 'building' && b.constructed && b.hp < b.maxHp;
}

/** What mending `hp` health of a building costs: REPAIR_COST of its build cost per full health bar. */
export function repairCost(b, hp) {
  const f = (hp / b.maxHp) * REPAIR_COST;
  const c = b.def.cost;
  return { gold: (c.gold || 0) * f, wood: (c.wood || 0) * f, faith: (c.faith || 0) * f };
}

/** issue repair: worshippers among `workers` walk to an own damaged building and mend it. */
export function issueRepair(world, player, workers, b, queue) {
  if (!b || b.dead || b.kind !== 'building' || b.owner !== player) return;
  if (!b.constructed) {
    for (const w of workers) world.setOrder(w, { type: 'build', b: b.type, tx: b.tx, ty: b.ty, paid: null, site: b.id, helper: true }, queue);
    return;
  }
  if (!needsRepair(b)) return world.error(player, 'That building is not damaged.');
  for (const w of workers) world.setOrder(w, { type: 'repair', target: b.id }, queue);
}

/**
 * Repair order { type: 'repair', target }: walk to the building and mend it
 * until it is whole, gone, or the owner runs out of resources. Returns true
 * when the order is finished.
 */
export function updateRepair(world, u, o) {
  const b = world.entities.get(o.target);
  if (!b || b.owner !== u.owner || !needsRepair(b) || b.repairBlocked) return true;
  if (distPointRect(u.x, u.y, b.tx, b.ty, b.tx + b.size, b.ty + b.size) - u.radius <= BUILD_REACH) {
    if (u.mv) stopMove(u);
    u.state = 'build'; // the hammer animation; the snapshot's task says 'repair'
    u.target = b.id;
    u.facing = Math.atan2(b.y - u.y, b.x - u.x);
    b.repairers++;
    return false;
  }
  u.state = 'move';
  u.target = b.id;
  const mv = moveToRect(world, u, b.tx, b.ty, b.size, `e${b.id}`);
  if (mv.failed) {
    stopMove(u);
    return true;
  }
  return false;
}

/**
 * Mend a completed building from this tick's repairers (like construction:
 * each extra worshipper adds BUILD_HELPER_BONUS), paying as it goes. Short of
 * resources, the repair stops and the repairers give up.
 */
export function updateBuildingRepair(world, b) {
  const n = b.repairers;
  b.repairers = 0;
  if (n <= 0 || b.hp >= b.maxHp) {
    b.repairBlocked = false;
    return;
  }
  const rate = (1 + BUILD_HELPER_BONUS * (n - 1)) * workSpeedOf(world, b.owner) * buildSpeed(world, b) / (b.def.buildTime * REPAIR_TIME);
  const hp = Math.min(b.maxHp * rate * DT, b.maxHp - b.hp);
  const cost = repairCost(b, hp);
  const msg = world.affordError(b.owner, cost);
  if (msg) {
    b.repairBlocked = true;
    if (world.time - (b.repairErrT ?? -Infinity) >= REPAIR_ERROR_EVERY) {
      b.repairErrT = world.time;
      world.error(b.owner, msg.replace(/\.$/, ' to repair.'));
    }
    return;
  }
  world.pay(b.owner, cost);
  b.hp = Math.min(b.maxHp, b.hp + hp);
}

/** Nearest own damaged building an idle worshipper with Auto-Repair on should mend, or null. */
export function findRepairTarget(world, u, range) {
  let best = null;
  let bestD = range;
  for (const b of world.buildingList) {
    if (b.owner !== u.owner || b.repairBlocked || !needsRepair(b)) continue;
    const d = distPointRect(u.x, u.y, b.tx, b.ty, b.tx + b.size, b.ty + b.size);
    if (d > bestD) continue;
    if (!world.canAfford(u.owner, repairCost(b, b.maxHp * 0.02))) continue;
    bestD = d;
    best = b;
  }
  return best;
}
