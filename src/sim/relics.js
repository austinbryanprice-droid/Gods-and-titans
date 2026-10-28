// Relics (DESIGN 5.13): every creep camp of level RELIC_CAMP_LEVEL or more guards one relic, of a
// type drawn from data/relics.js (no type twice on a map). Once the camp's last creature falls the
// relic lies on the ground; a Worshipper or a god of any player picks it up and carries it to one of
// its owner's finished Temples, where it rests and gives the owner its bonus (computeMods folds in
// p.relics). A carrier that dies drops it where it fell; a Temple that falls drops what rested in it
// beside its ruin, and the owner loses those bonuses.
//
// A relic: { i, type, state, x, y, camp, carrier, temple, owner }
//   state 'guarded' (its camp still stands), 'ground', 'carried' (carrier: the unit) or
//   'housed' (temple: the building; owner: whose bonus it is)
import { RELIC_CAMP_LEVEL, RELIC_LIST, canCarryRelic } from '../data/relics.js';
import { RNG, hashSeed } from './rng.js';
import { moveToPoint, moveToRect, stopMove } from './movement.js';
import { hyp, distPointRect } from './common.js';

export const PICK_RANGE = 0.6; // edge distance from a carrier to the relic it picks up
const HOUSE_REACH = 0.5; // edge distance from a carrier to the Temple it brings the relic to
const AUTO_EVERY = 10; // ticks between looks for idle carriers to send to a Temple
const r2 = (v) => Math.round(v * 100) / 100;

/** Put a relic under every big enough camp (called once the creeps stand). */
export function setupRelics(world) {
  world.relics = [];
  const rng = new RNG(hashSeed(`${world.setup.seed}:relics`));
  const pool = rng.shuffle(RELIC_LIST.map((r) => r.id));
  for (const camp of world.camps) {
    if (camp.level < RELIC_CAMP_LEVEL || !pool.length) continue;
    const r = { i: world.relics.length, type: pool.shift(), state: 'guarded', x: camp.x, y: camp.y, camp, carrier: null, temple: null, owner: -1 };
    if (!camp.members.some((m) => !m.dead)) r.state = 'ground';
    camp.relic = r;
    world.relics.push(r);
  }
}

function emitRelic(world, r, ev, player) {
  world.emit({ type: 'relic', ev, i: r.i, t: r.type, player, x: r2(r.x), y: r2(r.y) });
}

/** A camp creature died (World.killEntity): the last one lets the camp's relic fall. */
export function onCampMemberKilled(world, u, killer) {
  const r = u.camp && u.camp.relic;
  if (!r || r.state !== 'guarded' || u.camp.members.some((m) => !m.dead)) return;
  r.state = 'ground';
  emitRelic(world, r, 'drop', killer !== undefined && killer >= 0 ? killer : -1);
}

/** Can unit u pick up a relic (alive, a Worshipper or a god of a player, not a summoned copy, empty-handed)? */
export function canCarry(world, u) {
  return !!u && !u.dead && u.kind === 'unit' && u.owner >= 0 && !u.summoned && canCarryRelic(u.def) && !relicOf(world, u);
}

/** The relic unit u carries, or null. */
export function relicOf(world, u) {
  for (const r of world.relics) if (r.state === 'carried' && r.carrier === u) return r;
  return null;
}

/** Relic by index (commands name relics by their index), or null. */
export function relicAt(world, i) {
  return Number.isInteger(i) && i >= 0 && i < world.relics.length ? world.relics[i] : null;
}

/** Relic types resting in player i's Temples, in the order they arrived. */
export function heldRelics(world, i) {
  const out = [];
  for (const r of world.relics) if (r.state === 'housed' && r.owner === i) out.push(r.type);
  return out;
}

/** The player's bonuses follow what rests in their Temples. */
function refreshHolder(world, i) {
  const p = world.players[i];
  if (!p) return;
  p.relics = heldRelics(world, i);
  world.refreshMods(i);
}

/** Lay a relic on the ground at a point (or the nearest passable tile). */
function layDown(world, r, x, y) {
  const map = world.map;
  if (!map.isPassable(Math.floor(x), Math.floor(y))) {
    const p = map.nearestPassable(x, y, 12, false);
    if (p) {
      x = p.tx + 0.5;
      y = p.ty + 0.5;
    }
  }
  r.state = 'ground';
  r.x = x;
  r.y = y;
  r.carrier = null;
  r.temple = null;
  r.owner = -1;
}

function takeRelic(world, r, u) {
  r.state = 'carried';
  r.carrier = u;
  r.owner = u.owner;
  r.x = u.x;
  r.y = u.y;
  emitRelic(world, r, 'take', u.owner);
}

function houseRelic(world, r, b) {
  r.state = 'housed';
  r.carrier = null;
  r.temple = b;
  r.owner = b.owner;
  r.x = b.x;
  r.y = b.y;
  emitRelic(world, r, 'house', b.owner);
  refreshHolder(world, b.owner);
}

/** Is b a finished Temple of player i (where a relic can rest)? */
export function isRelicTemple(b, i) {
  return !!b && !b.dead && b.kind === 'building' && b.owner === i && b.constructed && b.type === 'temple';
}

/** The nearest finished Temple of u's owner, or null. */
export function nearestTemple(world, u) {
  let best = null;
  let bestD = Infinity;
  for (const b of world.buildingList) {
    if (!isRelicTemple(b, u.owner)) continue;
    const d = hyp(b.x - u.x, b.y - u.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

/** Order { type: 'relic', relic: i }: walk to a relic on the ground and pick it up. Returns true when done. */
export function updateRelicPickup(world, u, o) {
  const r = relicAt(world, o.relic);
  if (!r || r.state !== 'ground' || !canCarry(world, u)) {
    if (u.mv) stopMove(u);
    u.state = 'idle';
    return true;
  }
  if (hyp(r.x - u.x, r.y - u.y) - u.radius <= PICK_RANGE) {
    if (u.mv) stopMove(u);
    takeRelic(world, r, u);
    // Straight on to the nearest Temple, unless the player queued something else.
    const b = u.orders.length ? null : nearestTemple(world, u);
    if (b) u.orders.push({ type: 'deliver', building: b.id });
    u.state = 'idle';
    return true;
  }
  u.state = 'move';
  const mv = moveToPoint(world, u, r.x, r.y);
  if (mv.failed) {
    u.state = 'idle';
    return true;
  }
  return false;
}

/** Order { type: 'deliver', building }: bring the carried relic into one of the owner's Temples. Returns true when done. */
export function updateRelicDeliver(world, u, o) {
  const r = relicOf(world, u);
  const b = world.entities.get(o.building);
  if (!r || !isRelicTemple(b, u.owner)) {
    if (u.mv) stopMove(u);
    u.state = 'idle';
    return true;
  }
  u.target = b.id;
  if (distPointRect(u.x, u.y, b.tx, b.ty, b.tx + b.size, b.ty + b.size) - u.radius <= HOUSE_REACH) {
    if (u.mv) stopMove(u);
    houseRelic(world, r, b);
    u.state = 'idle';
    return true;
  }
  u.state = 'move';
  const mv = moveToRect(world, u, b.tx, b.ty, b.size, `e${b.id}`);
  if (mv.failed) {
    u.state = 'idle';
    return true;
  }
  return false;
}

/**
 * Per tick: carried relics follow their carriers and fall when a carrier dies, housed ones fall
 * when their Temple does; every AUTO_EVERY ticks an idle carrier sets off for its nearest Temple.
 */
export function updateRelics(world) {
  const relics = world.relics;
  if (!relics.length) return;
  const auto = world.tickCount % AUTO_EVERY === 0;
  for (const r of relics) {
    if (r.state === 'carried') {
      const u = r.carrier;
      if (!u || u.dead) {
        const owner = r.owner;
        layDown(world, r, u ? u.x : r.x, u ? u.y : r.y);
        emitRelic(world, r, 'lose', owner);
        continue;
      }
      r.x = u.x;
      r.y = u.y;
      if (auto && !u.order && !u.orders.length && !u.forced) {
        const b = nearestTemple(world, u);
        if (b) world.setOrder(u, { type: 'deliver', building: b.id });
      }
    } else if (r.state === 'housed') {
      const b = r.temple;
      if (!b || b.dead || b.owner !== r.owner) {
        const owner = r.owner;
        // beside the ruin, on its south side (where the prayers knelt)
        layDown(world, r, b ? b.x : r.x, b ? b.ty + b.size + 0.5 : r.y);
        emitRelic(world, r, 'lose', owner);
        refreshHolder(world, owner);
      }
    }
  }
}

/** A relic's state on the wire: kept by its camp, on the ground, carried, housed in a Temple. */
export const STATE_CODES = { guarded: 'k', ground: 'g', carried: 'c', housed: 'h' };

/** Snapshot views of the relics (DESIGN 6.3): carried and housed ones go by their holder's id. */
export function relicViews(world) {
  return world.relics.map((r) => {
    const v = { i: r.i, t: r.type, s: STATE_CODES[r.state] };
    if (r.state === 'carried') {
      v.c = r.carrier.id;
      v.o = r.owner;
    } else if (r.state === 'housed') {
      v.b = r.temple.id;
      v.o = r.owner;
    } else {
      v.x = r2(r.x);
      v.y = r2(r.y);
    }
    return v;
  });
}
