// The daily challenge's twists (DESIGN 9.3): one is drawn for each day. A twist either changes the
// start of the match in the sim (`start`: resources multiplied or added, a number of worshippers;
// read by the World through setup.twist) or only shapes the lobby (sides, AI difficulty, game mode),
// which src/game/daily.js builds. Every player starts the same way, AI players included.
//
//   { id, name, icon, desc,
//     start?: { gold?, wood? (multipliers), faith? (added), workers? },
//     allies?: AI teammates, enemies?: [difficulty, …] (one team), survival?, sacred?, mapSize? }

export const TWISTS = [
  { id: 'golden', name: 'Golden Age', icon: '💰', desc: 'Every city starts with three times the gold and wood.', start: { gold: 3, wood: 3 } },
  { id: 'blessed', name: 'Blessed Start', icon: '🙏', desc: 'Every city starts with 400 faith: a god is within reach from the first minute.', start: { faith: 350 } },
  { id: 'humble', name: 'Humble Beginnings', icon: '🌾', desc: 'Every city starts with two worshippers and half the gold and wood.', start: { gold: 0.5, wood: 0.5, workers: 2 } },
  { id: 'crowded', name: 'Crowded Hearths', icon: '🏘️', desc: 'Every city starts with ten worshippers.', start: { workers: 10 } },
  { id: 'worthy', name: 'A Worthy Foe', icon: '⚔️', desc: 'One rival, and a Hard one.', enemies: ['hard'] },
  { id: 'outnumbered', name: 'Outnumbered', icon: '🐺', desc: 'Two rivals, allied against you.', enemies: ['normal', 'easy'], mapSize: 'medium' },
  { id: 'brothers', name: 'Brothers in Arms', icon: '🤝', desc: 'You and an AI ally against two rivals.', allies: 1, enemies: ['normal', 'normal'], mapSize: 'medium' },
  { id: 'holy', name: 'Holy Ground', icon: '⛩️', desc: 'Sacred Victory is on: hold every sacred site for 8 minutes to win.', sacred: true },
  { id: 'trial', name: 'Trial of the Titans', icon: '🐉', desc: 'You and an AI ally against waves of monsters.', allies: 1, enemies: [], survival: true },
];

export const TWIST_BY_ID = Object.fromEntries(TWISTS.map((t) => [t.id, t]));

/** The twist a setup asks for, or null (a normal game, or an unknown id). */
export function twistOf(setup) {
  const id = setup && setup.twist;
  return typeof id === 'string' && Object.hasOwn(TWIST_BY_ID, id) ? TWIST_BY_ID[id] : null;
}

/** A player's starting gold, wood and faith and number of worshippers under a setup's twist. */
export function startOf(setup, base, workers) {
  const s = (twistOf(setup) || {}).start || {};
  return {
    gold: Math.round(base.gold * (s.gold ?? 1)),
    wood: Math.round(base.wood * (s.wood ?? 1)),
    faith: base.faith + (s.faith || 0),
    workers: Number.isInteger(s.workers) ? s.workers : workers,
  };
}
