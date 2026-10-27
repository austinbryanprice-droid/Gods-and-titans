// Homes (DESIGN 5.3): four Houses that stand in a square are combined into one Manor. An upgrade in
// place: paid for up front, run by itself with no worker, and the Houses keep sheltering their people
// while it runs. Each of the four Houses carries the same queue item (they share one `group`): the top
// left House's timer runs it and the others show its progress, so any of them can be selected, and
// cancelling the item on one of them cancels the whole upgrade. When the time is up the four Houses are
// replaced by one Manor on their ground, which keeps the damage they had (the average of the four). A
// cancelled upgrade, or a House that falls first, gives the price back and the other Houses carry on.
import { DT } from '../config.js';
import { BUILDINGS } from '../data/index.js';
import { MANOR, MERGE_TEXT, mergeRule, planMerges } from '../data/houses.js';
import { refund, tierMessage } from './construction.js';

/** Is this building one of four Houses being combined? */
export function isMerging(b) {
  return b.queue.some((q) => q.group);
}

/** Start the upgrade on one square of four Houses (already paid for). */
function start(world, player, block, rule) {
  const group = { owner: player, ids: block.ids.slice(), tx: block.tx, ty: block.ty, cost: { ...rule.cost }, done: false };
  for (const id of group.ids) {
    // The price is held by the group (one refund); the items themselves cost nothing.
    world.entities.get(id).queue.push({ u: MANOR, time: rule.time, elapsed: 0, cost: { gold: 0, wood: 0, faith: 0 }, pop: 0, revive: null, upgrade: true, group });
  }
}

/**
 * upgradeHouses: combine the squares of four Houses among the player's `ids` into Manors. Every square
 * that can start (all four Houses finished and idle: not researching, not already being combined) pays
 * and runs its own upgrade, in row order, for as many as the purse allows. A square must be a 2x2 block
 * of Houses touching edge to edge (data/houses.js houseBlocks); the settlement must be a Town.
 */
export function issueHouseUpgrade(world, player, ids) {
  if (!Array.isArray(ids)) return;
  const p = world.players[player];
  const manor = BUILDINGS[MANOR];
  const rule = mergeRule();
  if (manor.tier > p.tier) return world.error(player, tierMessage(manor.tier));
  const houses = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const b = world.entities.get(id);
    if (!b || b.dead || b.kind !== 'building' || b.owner !== player || b.type !== rule.building || !b.constructed) continue;
    houses.push({ id, tx: b.tx, ty: b.ty, busy: b.queue.length > 0 });
  }
  const plan = planMerges(houses);
  if (!plan.blocks.length) return world.error(player, MERGE_TEXT[plan.reason]);
  let started = 0;
  let short = null;
  for (const block of plan.blocks) {
    const msg = world.affordError(player, rule.cost);
    if (msg) {
      short = msg;
      break;
    }
    world.pay(player, rule.cost);
    start(world, player, block, rule);
    started++;
  }
  if (short) world.error(player, started ? `${short} Combined ${started} of ${plan.blocks.length} squares.` : short);
}

/** Stop an upgrade and give its price back (the Houses carry on as before). */
export function cancelMerge(world, group) {
  if (group.done) return;
  group.done = true;
  for (const id of group.ids) {
    const h = world.entities.get(id);
    if (h && !h.dead) h.queue = h.queue.filter((q) => q.group !== group);
  }
  refund(world, group.owner, group.cost);
}

/** Replace the four Houses by one Manor on their ground, with the health fraction they had on average. */
function complete(world, group) {
  const houses = group.ids.map((id) => world.entities.get(id));
  if (houses.some((h) => !h || h.dead || h.type !== mergeRule().building)) return cancelMerge(world, group);
  group.done = true;
  let share = 0;
  for (const h of houses) share += h.hp / h.maxHp;
  share /= houses.length;
  for (const h of houses) {
    h.queue = [];
    world.removeBuilding(h);
  }
  const m = world.createBuilding(group.owner, MANOR, group.tx, group.ty, true, true);
  m.hp = Math.max(1, Math.round(m.maxHp * share));
  world.emit({ type: 'buildingComplete', id: m.id, t: MANOR, o: group.owner });
}

/**
 * One tick of a House's first queue item when it belongs to an upgrade. The top left House runs the
 * timer (Imperial Bureaucracy's `techSpeed` quickens it, like any growth) and the others copy its
 * progress; when it is full the Manor takes the Houses' place.
 */
export function advanceMerge(world, b, item) {
  const group = item.group;
  if (b.id !== group.ids[0]) return;
  const p = world.players[b.owner];
  item.elapsed += DT * (1 + (p ? p.mods.perks.techSpeed : 0));
  for (let i = 1; i < group.ids.length; i++) {
    const h = world.entities.get(group.ids[i]);
    if (h && h.queue[0] && h.queue[0].group === group) h.queue[0].elapsed = item.elapsed;
  }
  if (item.elapsed >= item.time - 1e-9) complete(world, group);
}
