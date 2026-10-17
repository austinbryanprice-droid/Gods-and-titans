// Difficulty profiles for the computer opponents (DESIGN 10). Every number the
// AI tunes by difficulty lives here. Times are game seconds.
import { AI_THINK_INTERVAL } from '../config.js';

const BASE = {
  think: AI_THINK_INTERVAL.normal,
  workers: 22, // worshipper target
  tcQueue: 1, // worshippers kept queued at a Town Center
  prayEarly: 3, // praying worshippers before a Temple stands
  prayLate: 7, // praying worshippers once a Temple stands
  prayTitan: 9, // while saving for the Titan
  woodShare: 0.42, // share of non-praying workers on wood
  houseBuffer: 6, // free pop kept ahead of the cap (+2 per production building)
  shrineAt: 30, // earliest Shrine (s)
  barracksWorkers: 9, // workers before the first Barracks
  templeAt: 95,
  tier2At: 260, // earliest Grow into a Town
  tier3At: 480, // earliest Grow into a City
  secondBarracks: true,
  secondShrine: false, // a second Shrine at City even without spare gold
  maxShrines: 2,
  maxBarracks: 4,
  prodQueue: 1, // units kept queued per production building
  firstAttack: 450, // earliest attack wave (s)
  attackPop: 26, // army pop that triggers a wave
  attackGrowth: 6, // extra pop needed per wave already sent
  waveInterval: 150, // a wave is also sent this long after the last one if the army is decent
  attackRatio: 1.05, // estimated fight ratio needed vs the enemy army
  retreatRatio: 0.55, // local fight ratio that triggers a retreat
  creepRatio: 1.7,
  creepFrom: 150,
  expandBelow: 4200, // main mine gold left that triggers an expansion
  expandAt: Infinity, // expand by this time even if the main mine is fine
  towersMax: 2,
  godRetreat: 0.25, // god hp fraction that triggers a retreat
  godRejoin: 0.6,
  castChance: 1, // chance per think to look for a cast (easy reacts slowly)
  castThreshold: 1, // multiplier on the score a cast needs
  micro: true, // focus fire, rams on buildings, wounded units pulled back
  militia: true, // workers fight in emergencies
  helpAllies: true,
  armyCap: 120, // pop the army stops growing at
};

export const PROFILES = {
  easy: {
    ...BASE,
    think: AI_THINK_INTERVAL.easy,
    workers: 14,
    prayEarly: 2,
    prayLate: 5,
    prayTitan: 7,
    houseBuffer: 3,
    shrineAt: 60,
    barracksWorkers: 10,
    templeAt: 200,
    tier2At: 480,
    tier3At: 900,
    secondBarracks: false,
    maxShrines: 1,
    maxBarracks: 1,
    firstAttack: 690,
    attackPop: 18,
    attackGrowth: 4,
    waveInterval: 260,
    attackRatio: 0.8,
    retreatRatio: 0.3,
    creepRatio: 2.2,
    creepFrom: 300,
    expandBelow: 2000,
    towersMax: 1,
    godRetreat: 0.12,
    godRejoin: 0.5,
    castChance: 0.45,
    castThreshold: 1.6,
    micro: false,
    militia: false,
    armyCap: 60,
  },
  normal: { ...BASE },
  hard: {
    ...BASE,
    think: AI_THINK_INTERVAL.hard,
    workers: 26,
    tcQueue: 2,
    prayEarly: 4,
    prayLate: 8,
    prayTitan: 10,
    houseBuffer: 8,
    shrineAt: 20,
    barracksWorkers: 8,
    templeAt: 80,
    tier2At: 210,
    tier3At: 400,
    secondShrine: true,
    maxBarracks: 5,
    prodQueue: 2,
    firstAttack: 390,
    attackPop: 30,
    attackGrowth: 8,
    waveInterval: 130,
    attackRatio: 1.15,
    retreatRatio: 0.65,
    creepRatio: 1.45,
    creepFrom: 130,
    expandBelow: 5500,
    expandAt: 540,
    towersMax: 3,
    godRetreat: 0.3,
    godRejoin: 0.55,
    castThreshold: 0.85,
    armyCap: 140,
  },
};

/** Profile for a difficulty name (unknown → normal). */
export function profileFor(difficulty) {
  return PROFILES[difficulty] || PROFILES.normal;
}
