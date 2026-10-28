// Achievements (DESIGN 9.1): goals that last across matches, kept on this device by
// src/game/career.js. Each one is a test over the facts of one match (`m`, from
// src/game/career-tracker.js) and the career totals with that match counted (`c`).
// A match still running has m.result null, so the in-match ones (a god's summoning,
// a Champion) unlock the moment they happen and the ones about winning wait for the end.
// `progress` (optional) gives [have, need] for the gallery's progress bar.
import { PANTHEON_LIST } from './pantheon-list.js';
import { MAX_GODS, GOD_MAX_LEVEL } from '../config.js';
import { RANK_MAX, RANK_NAMES } from './ranks.js';

export const ACHIEVEMENT_GROUPS = [
  ['career', 'Career'],
  ['pantheon', 'Pantheons'],
  ['divine', 'Gods and Titans'],
  ['battle', 'Battle'],
  ['city', 'City'],
  ['challenge', 'Challenges'],
];

const won = (m) => m.result === 'victory';
const count = (n, need) => [Math.min(n, need), need];
const winsWith = (c, id) => (c.pantheons[id] && c.pantheons[id].wins) || 0;
const pantheonsWon = (c) => PANTHEON_LIST.filter((p) => winsWith(c, p.id) > 0).length;

// One per pantheon: win a game with it. Ordered like the pantheon list.
const PANTHEON_TITLES = {
  greek: ['Glory of Olympus', '🏛️'],
  norse: ['A Seat in Valhalla', '🐺'],
  egyptian: ['Lord of the Two Lands', '☥'],
  hindu: ['Turning the Wheel', '🕉️'],
  japanese: ['Way of the Kami', '⛩️'],
  chinese: ['Mandate of Heaven', '🐉'],
  aztec: ['The Fifth Sun', '☀️'],
  celtic: ['Song of the Tuatha', '🍀'],
  mesopotamian: ['King of the Four Quarters', '🏺'],
  west_african: ['Words of the Griot', '🥁'],
};

const pantheonAchievements = PANTHEON_LIST.map((p) => {
  const [name, icon] = PANTHEON_TITLES[p.id] || [`${p.name} Victory`, '✦'];
  return {
    id: `win_${p.id}`, group: 'pantheon', name, icon, pantheon: p.id,
    desc: `Win a game as the ${p.name} pantheon.`,
    test: (m, c) => winsWith(c, p.id) > 0,
  };
});

/** Every achievement, in gallery order. */
export const ACHIEVEMENTS = [
  // ---- career
  { id: 'first_victory', group: 'career', name: 'First Victory', icon: '🏆', desc: 'Win a game.',
    test: (m, c) => c.wins >= 1, progress: (c) => count(c.wins, 1) },
  { id: 'seasoned', group: 'career', name: 'Seasoned Commander', icon: '🎖️', desc: 'Play 10 games to the end.',
    test: (m, c) => c.games >= 10, progress: (c) => count(c.games, 10) },
  { id: 'warlord', group: 'career', name: 'Warlord', icon: '⚔️', desc: 'Win 10 games.',
    test: (m, c) => c.wins >= 10, progress: (c) => count(c.wins, 10) },
  { id: 'legend', group: 'career', name: 'Living Legend', icon: '👑', desc: 'Win 25 games.',
    test: (m, c) => c.wins >= 25, progress: (c) => count(c.wins, 25) },
  { id: 'all_pantheons', group: 'career', name: 'Pantheon of Pantheons', icon: '🌟', desc: `Win with all ${PANTHEON_LIST.length} pantheons.`,
    test: (m, c) => pantheonsWon(c) >= PANTHEON_LIST.length, progress: (c) => count(pantheonsWon(c), PANTHEON_LIST.length) },
  // ---- pantheons
  ...pantheonAchievements,
  // ---- gods and titans
  { id: 'answered_prayer', group: 'divine', name: 'Answered Prayer', icon: '🙏', desc: 'Summon a god.',
    test: (m) => m.godsSummoned >= 1 },
  { id: 'divine_council', group: 'divine', name: 'Divine Council', icon: '✨', desc: `Have ${MAX_GODS} gods on the field at once.`,
    test: (m) => m.maxGodsAtOnce >= MAX_GODS },
  { id: 'ascension', group: 'divine', name: 'Ascension', icon: '🌠', desc: `Raise a god to level ${GOD_MAX_LEVEL}.`,
    test: (m) => m.maxGodLevel >= GOD_MAX_LEVEL },
  { id: 'titan_unleashed', group: 'divine', name: 'Titan Unleashed', icon: '🌋', desc: 'Summon a Titan.',
    test: (m) => m.titanSummoned },
  { id: 'titanfall', group: 'divine', name: 'Titanfall', icon: '💥', desc: 'See an enemy Titan fall.',
    test: (m) => m.enemyTitansFallen >= 1 },
  // ---- battle
  { id: 'champion', group: 'battle', name: RANK_NAMES[RANK_MAX], icon: '🥇', desc: `Raise a soldier to the rank of ${RANK_NAMES[RANK_MAX]}.`,
    test: (m) => m.maxRank >= RANK_MAX },
  { id: 'hundred_slain', group: 'battle', name: 'Hundred Slain', icon: '💀', desc: 'Defeat 100 enemies in one game.',
    test: (m) => m.kills >= 100 },
  { id: 'lightning_war', group: 'battle', name: 'Lightning War', icon: '⚡', desc: 'Win a game in under 15 minutes.',
    test: (m) => won(m) && m.time < 15 * 60 },
  { id: 'untouched', group: 'battle', name: 'Not One Stone', icon: '🛡️', desc: 'Win a game without losing a building (walls do not count).',
    test: (m) => won(m) && m.buildingsLost === 0 },
  { id: 'against_all_odds', group: 'battle', name: 'Against All Odds', icon: '🦁', desc: 'Win a game against more enemies than your team has players.',
    test: (m) => won(m) && m.enemies.length > m.teamSize },
  // ---- city
  { id: 'city_of_gods', group: 'city', name: 'City of the Gods', icon: '🏙️', desc: 'Grow your Town Center into a City Palace.',
    test: (m) => m.maxTier >= 3 },
  { id: 'bountiful', group: 'city', name: 'Bountiful Harvest', icon: '🌾', desc: 'Gather 10,000 resources in one game.',
    test: (m) => m.gathered >= 10000 },
  { id: 'manor', group: 'city', name: 'Lord of the Manor', icon: '🏰', desc: 'Raise a Manor from four Houses.',
    test: (m) => m.manor },
  { id: 'stone_walls', group: 'city', name: 'Walls of Stone', icon: '🧱', desc: 'Raise a stone wall.',
    test: (m) => m.stoneWall },
  // ---- challenges
  { id: 'proving_ground', group: 'challenge', name: 'Proving Ground', icon: '🗡️', desc: 'Win against a Normal or Hard AI.',
    test: (m) => won(m) && m.enemies.some((e) => e.kind === 'ai' && (e.difficulty === 'normal' || e.difficulty === 'hard')) },
  { id: 'hard_won', group: 'challenge', name: 'Hard-Won', icon: '🔥', desc: 'Win against a Hard AI.',
    test: (m) => won(m) && m.enemies.some((e) => e.kind === 'ai' && e.difficulty === 'hard') },
  { id: 'mortal_rival', group: 'challenge', name: 'Mortal Rival', icon: '🤝', desc: 'Win against a human player.',
    test: (m) => won(m) && m.enemies.some((e) => e.kind === 'human') },
  { id: 'shoulder_to_shoulder', group: 'challenge', name: 'Shoulder to Shoulder', icon: '👥', desc: 'Win with an ally at your side.',
    test: (m) => won(m) && m.teamSize >= 2 },
  { id: 'decade_of_peace', group: 'challenge', name: 'Peace, Then War', icon: '🕊️', desc: 'Win a Decade of Peace game.',
    test: (m) => won(m) && m.peace },
  { id: 'the_long_war', group: 'challenge', name: 'The Long War', icon: '⏳', desc: 'Play one game for an hour of game time.',
    test: (m) => m.time >= 60 * 60 },
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
