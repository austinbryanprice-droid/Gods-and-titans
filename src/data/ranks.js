// Soldier ranks (DESIGN 5.9): mortal soldiers earn experience in battle and rise from Recruit
// to Champion. Pure helpers shared by the sim and the HUD, so both show the same numbers.
import { RANK_XP, RANK_HP, RANK_DAMAGE, RANK_ARMOR, BUILDING_XP_HP } from '../config.js';
import { xpValue } from './index.js';

export const RANK_NAMES = ['Recruit', 'Veteran', 'Elite', 'Champion'];
export const RANK_NUMERALS = ['', 'I', 'II', 'III']; // the HUD badge of each rank (a Recruit has none)
export const RANK_COLORS = ['#9a8a70', '#cd8c52', '#cfd8e6', '#ffd23a']; // Recruit, then bronze, silver, gold: HUD badges and the pips over units
export const RANK_MAX = RANK_XP.length - 1;

/** Can units of this type rank up? Everything the Barracks trains: Warrior, Archer, Priest, Battering Ram and the pantheon's elite soldier. */
export function canRank(def) {
  return !!def && def.producedAt === 'barracks';
}

/** Rank (0..RANK_MAX) of a soldier with this much experience. */
export function rankForXp(xp) {
  let r = 0;
  while (r < RANK_MAX && xp >= RANK_XP[r + 1]) r++;
  return r;
}

/** Experience needed for the next rank after `rank`, or null at the top. */
export function nextRankXp(rank) {
  return rank >= 0 && rank < RANK_MAX ? RANK_XP[rank + 1] : null;
}

export function rankName(rank) {
  return RANK_NAMES[Math.max(0, Math.min(RANK_MAX, rank | 0))];
}

const BONUSES = RANK_XP.map((_, r) => Object.freeze({ hp: RANK_HP * r, damage: RANK_DAMAGE * r, armor: RANK_ARMOR * r }));

/** What a rank adds: max hp and attack damage as fractions (0.1 = +10%), armor flat. */
export function rankBonus(rank) {
  return BONUSES[Math.max(0, Math.min(RANK_MAX, rank | 0))];
}

/**
 * Experience a soldier earns for destroying `victim`: a unit is worth what gods earn from its
 * death (xpValue), a completed building a share of its health (a wall segment is worth nothing).
 * @param {object} victim sim entity (unit or building)
 */
export function killXp(victim) {
  if (victim.kind === 'unit') return xpValue(victim.def, victim.level || 1);
  if (victim.kind === 'building' && victim.constructed && !victim.def.wall) return Math.round(victim.def.hp / BUILDING_XP_HP);
  return 0;
}
