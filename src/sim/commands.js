// Player commands (DESIGN 6.2): validation, group moves with formations, and
// smart (right-click) resolution per unit.
import { formationSlots } from './movement.js';
import { canAttackTarget } from './combat.js';
import { reservePrayerSlot } from './economy.js';
import { issueBuild, cancelBuild, issueRepair, needsRepair } from './construction.js';
import { issueTrain, cancelTrain, issueTierUp, issueResearch, setRally } from './production.js';
import { findAbility, isUnlocked, cooldownLeft, resolveCastTarget, executeAbility } from './abilities.js';
import { issueTrade } from './trade.js';
import { hyp } from './common.js';

// ---- Input normalization (commands are untrusted: network, AI, HUD) ----

export const MAX_COMMAND_UNITS = 512; // ids kept per command
const MAX_UNITS_SCAN = 4096; // array elements looked at per command
export const MAX_COMMANDS_PER_TICK = 256; // per player; the rest are dropped
const MAX_NAME = 64;

const COMMAND_TYPES = new Set(['move', 'attackMove', 'attack', 'smart', 'gather', 'pray', 'returnCargo', 'build', 'train', 'cancelTrain', 'upgradeTier', 'cancelBuild', 'rally', 'stop', 'hold', 'cast', 'surrender', 'repair', 'research', 'autoRepair', 'trade']);

const idOf = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const clampTo = (v, hi) => (v === undefined ? undefined : v < 0 ? 0 : v > hi ? hi : v);
/** A type id (short string) or an entity id (positive integer): 'building' and 'unit' are both, by command. */
const nameOrId = (v) => (typeof v === 'string' ? (v.length <= MAX_NAME ? v : undefined) : idOf(v) || undefined);

function unitIds(v) {
  const out = [];
  if (!Array.isArray(v)) return out;
  const n = Math.min(v.length, MAX_UNITS_SCAN);
  for (let i = 0; i < n && out.length < MAX_COMMAND_UNITS; i++) {
    const id = idOf(v[i]);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * A clean copy of a command (DESIGN 6.2) with every field of a known type:
 * units an id array, ids positive integers (0 = none), x / y finite and
 * clamped to the map, tx / ty finite (validated where used), names short
 * strings. Unknown command types, non-objects and objects whose fields throw
 * on access give null. Copying also keeps a caller from changing a queued
 * command before the tick applies it.
 */
export function normalizeCommand(cmd, map) {
  if (cmd === null || typeof cmd !== 'object' || Array.isArray(cmd)) return null;
  try {
    const type = cmd.type;
    if (typeof type !== 'string' || !COMMAND_TYPES.has(type)) return null;
    const ability = cmd.ability;
    const upgrade = cmd.upgrade;
    return {
      type,
      units: unitIds(cmd.units),
      target: idOf(cmd.target),
      x: clampTo(num(cmd.x), map.width),
      y: clampTo(num(cmd.y), map.height),
      tx: num(cmd.tx),
      ty: num(cmd.ty),
      building: nameOrId(cmd.building),
      unit: nameOrId(cmd.unit),
      ability: typeof ability === 'string' && ability.length <= MAX_NAME ? ability : undefined,
      upgrade: typeof upgrade === 'string' && upgrade.length <= MAX_NAME ? upgrade : undefined,
      on: cmd.on === true,
      to: Number.isSafeInteger(cmd.to) ? cmd.to : undefined,
      res: typeof cmd.res === 'string' && cmd.res.length <= MAX_NAME ? cmd.res : undefined,
      amount: num(cmd.amount),
      index: Number.isSafeInteger(cmd.index) ? cmd.index : undefined,
      queue: !!cmd.queue,
    };
  } catch {
    return null;
  }
}

/** Own, living units from a list of ids (duplicates and foreign ids dropped). */
export function ownUnits(world, player, ids) {
  const out = [];
  if (!Array.isArray(ids)) return out;
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = world.entities.get(id);
    if (e && !e.dead && e.kind === 'unit' && e.owner === player) out.push(e);
  }
  return out;
}

function ownBuilding(world, player, id) {
  const b = world.entities.get(id);
  return b && !b.dead && b.kind === 'building' && b.owner === player ? b : null;
}

/** Issue a move-like order to a group, spreading destinations into a formation. */
export function groupOrder(world, units, x, y, type, queue) {
  if (!units.length || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const slots = formationSlots(world, units, x, y);
  let group = null;
  if (units.length > 1 && !queue) {
    let cx = 0;
    let cy = 0;
    for (const u of units) {
      cx += u.x;
      cy += u.y;
    }
    cx /= units.length;
    cy /= units.length;
    let lead = units[0];
    let best = Infinity;
    for (const u of units) {
      const d = hyp(u.x - cx, u.y - cy);
      if (d < best && !u.air) {
        best = d;
        lead = u;
      }
    }
    group = { n: units.length, sx: lead.x, sy: lead.y, cx: x, cy: y };
  }
  units.forEach((u, i) => {
    const o = type === 'attackMove' ? { type, x: slots[i].x, y: slots[i].y, group, target: 0 } : { type: 'move', x: slots[i].x, y: slots[i].y, group };
    world.setOrder(u, o, queue);
  });
}

function gatherOrderFor(world, u, mine, tree) {
  if (mine) return { type: 'gather', mine: mine.id, phase: 'go', timer: 0, spot: -1, slot: -1, startT: 0, badSpots: 0 };
  return { type: 'gather', tree: { tx: tree.tx, ty: tree.ty }, phase: 'go', timer: 0 };
}

function giveGather(world, u, mine, tree, queue) {
  const o = gatherOrderFor(world, u, mine, tree);
  u.lastGather = mine ? { type: 'gather', mine: mine.id } : { type: 'gather', tree: { tx: tree.tx, ty: tree.ty } };
  world.setOrder(u, o, queue);
}

function givePray(world, u, b, queue, state) {
  // Already praying here: keep the slot.
  if (u.order && u.order.type === 'pray' && u.order.building === b.id && !queue) return true;
  const slot = reservePrayerSlot(world, b, u);
  if (slot < 0) {
    if (!state.fullReported) world.error(u.owner, `This ${(b.def && b.def.name) || 'shrine'} is full.`);
    state.fullReported = true;
    return false;
  }
  world.setOrder(u, { type: 'pray', building: b.id, slot, kneel: false }, queue);
  // setOrder discarded the previous order, which may have freed this slot; re-reserve.
  b.prayers[slot] = u.id;
  return true;
}

function returnOrder(u) {
  return { type: 'return', resume: u.lastGather ? { ...u.lastGather } : null };
}

function treeAt(world, cmd, target) {
  const map = world.map;
  if (Number.isInteger(cmd.tx) && Number.isInteger(cmd.ty) && map.isForest(cmd.tx, cmd.ty)) return { tx: cmd.tx, ty: cmd.ty };
  if (!target && Number.isFinite(cmd.x) && Number.isFinite(cmd.y)) {
    const tx = Math.floor(cmd.x);
    const ty = Math.floor(cmd.y);
    if (map.isForest(tx, ty)) return { tx, ty };
  }
  return null;
}

function smart(world, player, units, cmd) {
  const tRaw = cmd.target ? world.entities.get(cmd.target) : null;
  const t = tRaw && !tRaw.dead ? tRaw : null;
  const tree = treeAt(world, cmd, t);
  const queue = !!cmd.queue;
  const movers = [];
  const state = { fullReported: false };
  for (const u of units) {
    const worker = u.def.class === 'worker';
    if (t && t.kind !== 'mine' && world.areEnemies(player, t.owner)) {
      if (canAttackTarget(u, t)) world.setOrder(u, { type: 'attack', target: t.id }, queue);
      else movers.push(u);
      continue;
    }
    if (worker && t && t.kind === 'mine') {
      giveGather(world, u, t, null, queue);
      continue;
    }
    if (worker && !t && tree) {
      giveGather(world, u, null, tree, queue);
      continue;
    }
    if (worker && t && t.kind === 'building' && t.owner === player) {
      if (u.carry && u.carryAmount > 0 && t.constructed && t.def.dropOff) {
        world.setOrder(u, returnOrder(u), queue);
        continue;
      }
      if (!t.constructed) {
        world.setOrder(u, { type: 'build', b: t.type, tx: t.tx, ty: t.ty, paid: null, site: t.id, helper: true }, queue);
        continue;
      }
      if (needsRepair(t)) {
        world.setOrder(u, { type: 'repair', target: t.id }, queue);
        continue;
      }
      if (t.def.prayerSlots > 0) {
        if (!givePray(world, u, t, queue, state)) movers.push(u);
        continue;
      }
    }
    if (t && t.kind === 'unit' && t !== u && !world.areEnemies(player, t.owner)) {
      world.setOrder(u, { type: 'follow', target: t.id }, queue);
      continue;
    }
    movers.push(u);
  }
  if (movers.length) {
    let x = cmd.x;
    let y = cmd.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (t) {
        x = t.x;
        y = t.kind === 'unit' ? t.y : t.ty + t.size + 0.6;
      } else if (tree) {
        x = tree.tx + 0.5;
        y = tree.ty + 0.5;
      }
    }
    groupOrder(world, movers, x, y, 'move', queue);
  }
}

function castCommand(world, player, cmd) {
  const u = world.entities.get(cmd.unit);
  if (!u || u.dead || u.kind !== 'unit' || u.owner !== player) return;
  const ab = findAbility(u, cmd.ability);
  if (!ab) return;
  if (!isUnlocked(u, ab)) return world.error(player, `That ability unlocks at level ${ab.unlockLevel || 1}.`);
  if (cooldownLeft(u, ab) > 0 && !cmd.queue) return world.error(player, 'That ability is not ready.');
  const tgt = resolveCastTarget(world, u, ab, cmd.x, cmd.y, cmd.target);
  if (!tgt) return;
  const queue = !!cmd.queue && !!(u.order || u.orders.length);
  // Instant self abilities fire without interrupting the current order.
  if (!queue && ab.target === 'none' && !(ab.castTime > 0) && !u.stunned && !u.forced) {
    executeAbility(world, u, ab, tgt);
    return;
  }
  const o = { type: 'cast', ability: ab.id, x: tgt.x, y: tgt.y, target: tgt.target ? tgt.target.id : 0, phase: 'approach', timer: 0 };
  if (queue) {
    world.setOrder(u, o, true);
    return;
  }
  const cur = u.order;
  if (cur && (cur.type === 'attack' || cur.type === 'attackMove' || cur.type === 'hold')) {
    // Resume fighting after the cast.
    u.order = o;
    u.orders.unshift(cur);
    u.mv = null;
    return;
  }
  world.setOrder(u, o, false);
}

/** Apply one command for a player (called at the start of a tick). */
export function applyCommand(world, player, cmd) {
  if (!cmd || typeof cmd !== 'object') return;
  const p = world.players[player];
  if (!p || p.defeated || world.gameOver) return;
  const queue = !!cmd.queue;
  switch (cmd.type) {
    case 'move':
    case 'attackMove':
      groupOrder(world, ownUnits(world, player, cmd.units), cmd.x, cmd.y, cmd.type, queue);
      break;
    case 'attack': {
      const t = world.entities.get(cmd.target);
      if (!t || t.dead) break;
      const units = ownUnits(world, player, cmd.units);
      const movers = [];
      for (const u of units) {
        if (canAttackTarget(u, t) && world.areEnemies(player, t.owner)) world.setOrder(u, { type: 'attack', target: t.id }, queue);
        else movers.push(u);
      }
      if (movers.length) groupOrder(world, movers, t.x, t.y, 'move', queue);
      break;
    }
    case 'smart':
      smart(world, player, ownUnits(world, player, cmd.units), cmd);
      break;
    case 'gather': {
      const workers = ownUnits(world, player, cmd.units).filter((u) => u.def.class === 'worker');
      const t = cmd.target ? world.entities.get(cmd.target) : null;
      if (t && !t.dead && t.kind === 'mine') {
        for (const u of workers) giveGather(world, u, t, null, queue);
        break;
      }
      let tree = treeAt(world, cmd, null);
      if (!tree && Number.isFinite(cmd.tx) && Number.isFinite(cmd.ty) && world.map.inBounds(Math.floor(cmd.tx), Math.floor(cmd.ty))) {
        tree = world.map.spiralNearest(cmd.tx + 0.5, cmd.ty + 0.5, 4, (x, y) => world.map.isTreeAccessible(x, y));
      }
      if (tree) for (const u of workers) giveGather(world, u, null, tree, queue);
      break;
    }
    case 'pray': {
      const b = ownBuilding(world, player, cmd.target);
      if (!b || !b.constructed || !(b.def.prayerSlots > 0)) break;
      const state = { fullReported: false };
      for (const u of ownUnits(world, player, cmd.units)) {
        if (u.def.class === 'worker') givePray(world, u, b, queue, state);
      }
      break;
    }
    case 'returnCargo':
      for (const u of ownUnits(world, player, cmd.units)) {
        if (u.def.class === 'worker' && u.carry && u.carryAmount > 0) world.setOrder(u, returnOrder(u), queue);
      }
      break;
    case 'build': {
      const workers = ownUnits(world, player, cmd.units).filter((u) => u.def.class === 'worker');
      if (workers.length && Number.isFinite(cmd.tx) && Number.isFinite(cmd.ty)) issueBuild(world, player, workers, cmd.building, cmd.tx, cmd.ty, queue);
      break;
    }
    case 'train':
      issueTrain(world, player, ownBuilding(world, player, cmd.building), cmd.unit);
      break;
    case 'cancelTrain':
      cancelTrain(world, player, ownBuilding(world, player, cmd.building), cmd.index);
      break;
    case 'upgradeTier':
      issueTierUp(world, player, ownBuilding(world, player, cmd.building));
      break;
    case 'cancelBuild':
      cancelBuild(world, player, ownBuilding(world, player, cmd.building));
      break;
    case 'repair': {
      const workers = ownUnits(world, player, cmd.units).filter((u) => u.def.class === 'worker');
      if (workers.length) issueRepair(world, player, workers, ownBuilding(world, player, cmd.target), queue);
      break;
    }
    case 'research':
      issueResearch(world, player, ownBuilding(world, player, cmd.building), cmd.upgrade);
      break;
    case 'autoRepair':
      p.autoRepair = !!cmd.on;
      break;
    case 'trade':
      issueTrade(world, player, cmd.to, cmd.res, cmd.amount);
      break;
    case 'rally':
      setRally(world, player, ownBuilding(world, player, cmd.building), cmd.x, cmd.y, cmd.target);
      break;
    case 'stop':
      for (const u of ownUnits(world, player, cmd.units)) world.setOrder(u, null, false);
      break;
    case 'hold':
      for (const u of ownUnits(world, player, cmd.units)) world.setOrder(u, { type: 'hold', target: 0 }, queue);
      break;
    case 'cast':
      castCommand(world, player, cmd);
      break;
    case 'surrender':
      world.defeatPlayer(player, true);
      break;
    default:
      break;
  }
}
