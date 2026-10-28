// Difficulty profiles for the computer opponents (DESIGN 10). Every number the
// AI tunes by difficulty lives here. Times are game seconds.
import { AI_THINK_INTERVAL, POP_MAX } from '../config.js';

const BASE = {
  think: AI_THINK_INTERVAL.normal,
  workers: 30, // most worshippers ever (the target is what the mines, wood and prayer slots need)
  minersPerMine: 5, // gold workers per owned mine (+1 when its drop-off is farther than the minimum gap); 2 mine at once, 5–6 saturate it
  tcQueue: 1, // worshippers kept queued at a Town Center
  prayEarly: 3, // praying worshippers before a Temple stands
  prayLate: 9, // praying worshippers once a Temple stands (capped by the prayer slots)
  prayTitan: 10, // while saving for the Titan
  woodShare: 0.42, // share of non-praying workers on wood (early game, before the mines are full)
  woodPerGold: 0.5, // woodcutters wanted per gold worker (bank-adjusted)
  woodMin: 3,
  woodMax: 8,
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
  expandBelow: 3000, // owned mines' gold left that triggers one more expansion
  expandAt: 330, // second mine from this time (the start mine alone caps at 13.3 gold/s)
  expandAt2: 840, // third mine from this time
  towersMax: 2,
  godRetreat: 0.25, // god hp fraction that triggers a retreat
  godRejoin: 0.6,
  castChance: 1, // chance per think to look for a cast (easy reacts slowly)
  castThreshold: 1, // multiplier on the score a cast needs
  micro: true, // focus fire, rams on buildings, wounded units pulled back
  militia: true, // workers fight in emergencies
  helpAllies: true,
  armyCap: Math.round(POP_MAX * 0.8), // pop the army (gods and Titan included) stops growing at
  pilgrimsFrom: 150, // Worshippers go out to capture sacred sites from this time (ai/sacred.js)
  pilgrims: 2, // at most this many at once (+1 with Sacred Victory on)
  stealSites: true, // also take a rival's unguarded site
  godJitter: 0.4, // randomness in which gods it summons first (low = always the strongest picks)
  // Smarter play (Hard and Brutal); off by default.
  raids: null, // worker raids (raid.js): { from (s), every (s after the last raid came home), pop (squad pop), minArmy (army pop kept home) }
  pullWounded: 0, // soldiers under this hp fraction step back to a Priest in a fight (micro.js)
};

export const PROFILES = {
  easy: {
    ...BASE,
    think: AI_THINK_INTERVAL.easy,
    workers: 15,
    minersPerMine: 4,
    woodMax: 5,
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
    expandBelow: 1500,
    expandAt: 660,
    expandAt2: Infinity,
    towersMax: 1,
    godRetreat: 0.12,
    godRejoin: 0.5,
    castChance: 0.45,
    castThreshold: 1.6,
    micro: false,
    militia: false,
    armyCap: Math.round(POP_MAX * 0.4),
    pilgrimsFrom: 360,
    pilgrims: 1,
    stealSites: false,
  },
  normal: { ...BASE },
  hard: {
    ...BASE,
    think: AI_THINK_INTERVAL.hard,
    workers: 34,
    minersPerMine: 6,
    tcQueue: 2,
    prayEarly: 4,
    prayLate: 12,
    prayTitan: 13,
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
    expandBelow: 4000,
    expandAt: 270,
    expandAt2: 720,
    pilgrimsFrom: 100,
    pilgrims: 3,
    towersMax: 3,
    godRetreat: 0.3,
    godRejoin: 0.55,
    castThreshold: 0.85,
    armyCap: Math.round(POP_MAX * 0.93),
    godJitter: 0.15,
    raids: { from: 330, every: 110, pop: 10, minArmy: 14 },
    pullWounded: 0.3,
  },
};

// Brutal: Hard's play, thinking faster and raiding more often; fair, like every AI (no bonus).
// Sharper fair timings (earlier tiers, more workers, bolder waves, pickier casts) were measured
// and made no difference, so it keeps Hard's numbers.
PROFILES.brutal = {
  ...PROFILES.hard,
  think: AI_THINK_INTERVAL.brutal,
  raids: { from: 270, every: 80, pop: 12, minArmy: 12 },
};

/** Profile for a difficulty name (unknown → normal). */
export function profileFor(difficulty) {
  return PROFILES[difficulty] || PROFILES.normal;
}
