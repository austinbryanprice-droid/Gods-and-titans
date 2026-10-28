// Medals of the guided first match (DESIGN 9.2), by the game time of the victory, best first.
// Kept on its own so the menu's career screen can name a medal without the game's code.

export const MEDALS = [
  { id: 'gold', rank: 3, icon: '🥇', name: 'Gold', within: 12 * 60 },
  { id: 'silver', rank: 2, icon: '🥈', name: 'Silver', within: 18 * 60 },
  { id: 'bronze', rank: 1, icon: '🥉', name: 'Bronze', within: Infinity },
];

/** The medal for a victory after `seconds` of game time. */
export function medalFor(seconds) {
  const t = Number.isFinite(seconds) ? seconds : Infinity;
  return MEDALS.find((m) => t <= m.within) || MEDALS[MEDALS.length - 1];
}

/** The medal with this rank (1 bronze … 3 gold), or null. */
export function medalByRank(rank) {
  return MEDALS.find((m) => m.rank === rank) || null;
}

/** "🥇 Gold medal" for a rank ('' for none). */
export function medalLabel(rank) {
  const m = medalByRank(rank);
  return m ? `${m.icon} ${m.name} medal` : '';
}
