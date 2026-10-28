// The guided first match (DESIGN 5.13): a fixed solo setup on one small map, a sleeping enemy camp
// and a head start for the learner. Everything here is decided by the setup's `tutorial` flag, so
// the match stays a pure function of setup + commands like every other game.
//
//   tutorialSetup({ name, version }) → GameSetup     the match the title screen's Learn to Play starts
//   isTutorial(setup)                → boolean
//   tutorialStart(world)                             called once by the World after the start positions
import { PLAYER_COLORS } from '../config.js';

export const TUTORIAL = Object.freeze({
  seed: 7101, // a small map whose two corners both have a close mine and forest (tests/sim/tutorial.test.js)
  mapSize: 'small',
  pantheon: 'greek', // the objectives name Greek buildings and gods
  enemyPantheon: 'norse',
  enemyName: 'Raiders of the North',
  start: Object.freeze({ gold: 600, wood: 300, faith: 100 }), // the learner's purse: a god within the first ten minutes
  enemyTownHp: 1200, // the raiders' Town Center (a normal one has 2000)
  guards: Object.freeze([['warrior', 3], ['archer', 1]]), // stand by the raiders' Town Center
});

/**
 * The GameSetup of the guided first match: the player (Greek, team 1) against a sleeping camp of
 * raiders (an AI with the 'tutorial' difficulty, which only sends its Worshippers to the mine).
 * @param {{ name?: string, version?: string }} [o]
 */
export function tutorialSetup({ name = 'Player', version = '0.1.0' } = {}) {
  return {
    version,
    seed: TUTORIAL.seed,
    mapSize: TUTORIAL.mapSize,
    tutorial: true,
    players: [
      { index: 0, name, team: 1, pantheon: TUTORIAL.pantheon, color: PLAYER_COLORS[0], kind: 'human', difficulty: null },
      { index: 1, name: TUTORIAL.enemyName, team: 2, pantheon: TUTORIAL.enemyPantheon, color: PLAYER_COLORS[1], kind: 'ai', difficulty: 'tutorial' },
    ],
  };
}

export function isTutorial(setup) {
  return !!(setup && setup.tutorial === true);
}

/**
 * Set the board for the lesson: the learner's head start, and for the raiders a weaker Town Center
 * with a few guards beside it. Neutral creep camps are left out by the World.
 * @param {object} world
 */
export function tutorialStart(world) {
  for (const p of world.players) {
    if (p.kind === 'ai') continue;
    p.gold = TUTORIAL.start.gold;
    p.wood = TUTORIAL.start.wood;
    p.faith = TUTORIAL.start.faith;
  }
  for (const b of world.buildingList) {
    const p = world.players[b.owner];
    if (!p || p.kind !== 'ai' || b.type !== 'town_center') continue;
    b.maxHp = TUTORIAL.enemyTownHp;
    b.hp = TUTORIAL.enemyTownHp;
    // The guards stand on the side of the Town Center that faces the middle of the map.
    const cx = world.map.width / 2;
    const cy = world.map.height / 2;
    const len = Math.hypot(cx - b.x, cy - b.y) || 1;
    const fx = (cx - b.x) / len;
    const fy = (cy - b.y) / len;
    const reach = b.size / 2 + 2;
    let k = 0;
    for (const [type, n] of TUTORIAL.guards) {
      for (let i = 0; i < n; i++, k++) {
        const side = (k - 1.5) * 1.3; // spread across the front
        world.spawnUnit(b.owner, type, b.x + fx * reach - fy * side, b.y + fy * reach + fx * side, { facing: Math.atan2(fy, fx), silent: true });
      }
    }
  }
}
