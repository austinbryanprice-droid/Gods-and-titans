// Relics (DESIGN 5.13): treasures of world myth that the bigger neutral creep camps guard. A cleared
// camp drops its relic; a Worshipper or a god carries it to its owner's Temple, where it gives the
// owner a lasting bonus for as long as it rests there. Effects use the upgrade vocabulary of
// data/upgrades.js (computeMods folds in the relics a player holds), so the sim and the HUD read the
// same numbers. Icons are single Emoji (11 or older); `color` tints the relic's glow in the 3D view.

/** Camps of at least this level guard a relic (level 1 camps are a handful of small creatures). */
export const RELIC_CAMP_LEVEL = 2;

export const RELIC_LIST = [
  {
    id: 'golden_fleece', name: 'Golden Fleece', myth: 'Greek', icon: '🐏', color: '#ffc63a',
    effects: [{ type: 'unit', classes: ['infantry', 'ranged', 'support', 'siege'], stat: 'hp', amount: 0.1 }],
    description: 'Your soldiers have 10% more health.',
  },
  {
    id: 'brisingamen', name: 'Brísingamen', myth: 'Norse', icon: '📿', color: '#ff9a3c',
    effects: [
      { type: 'building', building: 'shrine', stat: 'faith', amount: 0.25 },
      { type: 'building', building: 'temple', stat: 'faith', amount: 0.25 },
    ],
    description: 'Worshippers praying at Shrines and Temples earn 25% more Faith.',
  },
  {
    id: 'eye_of_horus', name: 'Eye of Horus', myth: 'Egyptian', icon: '👁️', color: '#4fb0ff',
    effects: [{ type: 'building', building: '*', stat: 'armor', amount: 2 }],
    description: 'Your buildings have 2 more armor.',
  },
  {
    id: 'amrita', name: 'Pot of Amrita', myth: 'Hindu', icon: '🏺', color: '#9cf0d2',
    effects: [{ type: 'unit', classes: ['god'], stat: 'regen', amount: 1.5 }],
    description: 'Your gods regenerate 1.5 more health per second.',
  },
  {
    id: 'kusanagi', name: 'Kusanagi', myth: 'Japanese', icon: '🗡️', color: '#c9e4ff',
    effects: [{ type: 'unit', classes: ['infantry', 'ranged'], stat: 'damage', amount: 0.08 }],
    description: 'Your warriors and archers deal 8% more damage.',
  },
  {
    id: 'peaches', name: 'Peaches of Immortality', myth: 'Chinese', icon: '🍑', color: '#ff9fb0',
    effects: [{ type: 'unit', classes: ['infantry', 'ranged', 'support', 'creature'], stat: 'regen', amount: 0.5 }],
    description: 'Your soldiers and creatures heal 0.5 health per second.',
  },
  {
    id: 'smoking_mirror', name: 'Smoking Mirror', myth: 'Aztec', icon: '🌑', color: '#b98cff',
    effects: [{ type: 'perk', stat: 'cooldown', amount: 0.1 }],
    description: 'God and Titan abilities recharge 10% faster.',
  },
  {
    id: 'dagda_cauldron', name: 'Cauldron of the Dagda', myth: 'Celtic', icon: '🍲', color: '#8fe36b',
    effects: [{ type: 'carry', resource: 'g', amount: 2 }, { type: 'carry', resource: 'w', amount: 2 }],
    description: 'Worshippers carry 2 more gold and wood on every trip.',
  },
  {
    id: 'tablet_of_destinies', name: 'Tablet of Destinies', myth: 'Mesopotamian', icon: '📜', color: '#ffe08a',
    effects: [{ type: 'perk', stat: 'techSpeed', amount: 0.2 }],
    description: 'Research and growing your Town Center go 20% faster.',
  },
  {
    id: 'anansi_stories', name: 'Box of Stories', myth: 'West African', icon: '🕸️', color: '#ffb36b',
    effects: [{ type: 'work', amount: 0.1 }],
    description: 'Anansi’s stories: your Worshippers mine, chop and build 10% faster.',
  },
];

/** Every relic by id. */
export const RELICS = Object.fromEntries(RELIC_LIST.map((r) => [r.id, r]));

export function getRelic(id) {
  return typeof id === 'string' && Object.hasOwn(RELICS, id) ? RELICS[id] : null;
}

/** Can a unit of this type carry a relic? Worshippers and gods can (not summoned minions: the sim checks that). */
export function canCarryRelic(def) {
  return !!def && (def.class === 'worker' || def.class === 'god');
}
