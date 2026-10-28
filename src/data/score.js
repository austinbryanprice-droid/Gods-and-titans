// Match statistics and the score (DESIGN 5.11), shared by the sim (which counts) and the HUD
// (which scores and charts). The score follows Age of Empires: an economy part for what was
// gathered and earned, a military part for the worth of what was destroyed, and a
// civilization part for the settlement's tier and research.

/** A player's counters at the start of a match (world.players[i].stats). */
export function newStats() {
  return {
    gathered: 0, // gold + wood delivered by worshippers
    gold: 0,
    wood: 0,
    faith: 0, // faith earned (prayer, blessings, spoils, spells)
    unitsTrained: 0,
    kills: 0, // enemy units slain (creeps included)
    losses: 0,
    buildings: 0, // own buildings completed (walls excluded)
    razed: 0, // enemy buildings destroyed (finished ones, walls excluded)
    killValue: 0, // gold + wood + faith worth of enemy units and buildings destroyed
    lostValue: 0, // the same for own units and buildings lost
  };
}

/** What an entity is worth: its gold, wood and faith cost added up. */
export function costValue(def) {
  const c = (def && def.cost) || {};
  return (c.gold || 0) + (c.wood || 0) + (c.faith || 0);
}

export const SCORE_ECONOMY_DIV = 10; // a point per 10 gold, wood or faith
export const SCORE_MILITARY_DIV = 5; // a point per 5 worth destroyed
export const SCORE_TIER = 100; // per settlement tier above Village
export const SCORE_UPGRADE = 25; // per finished upgrade

/**
 * A player's score from a snapshot player record ({ stats, tier, up }): economy, military,
 * civilization and their total, all whole numbers.
 */
export function scoreOf(p) {
  const st = (p && p.stats) || {};
  const economy = Math.floor(((st.gathered || 0) + (st.faith || 0)) / SCORE_ECONOMY_DIV);
  const military = Math.floor((st.killValue || 0) / SCORE_MILITARY_DIV);
  const tier = Math.max(1, (p && p.tier) || 1);
  const ups = (p && Array.isArray(p.up)) ? p.up.length : 0;
  const civ = (tier - 1) * SCORE_TIER + ups * SCORE_UPGRADE;
  return { economy, military, civ, total: economy + military + civ };
}
