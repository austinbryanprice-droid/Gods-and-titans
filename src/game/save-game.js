// Saved games (DESIGN 9.4): a solo match's whole state as plain data, and back. The World, its
// entities, its random number generator and every computer player's mind are packed with
// sim/save-graph.js; unit and building data and the generated map are not copied (the map is
// generated again from the setup's seed on load). A loaded match carries on exactly as the saved
// one would have: the same ticks give the same game (tests/game/save-game.test.js).
//
//   const save = packMatch(world, ais, extra);   // JSON-safe
//   const { world, ais, extra } = unpackMatch(save);
import * as config from '../config.js';
import * as data from '../data/index.js';
import * as upgrades from '../data/upgrades.js';
import * as ranks from '../data/ranks.js';
import * as powers from '../data/powers.js';
import * as relics from '../data/relics.js';
import * as walls from '../data/walls.js';
import * as houses from '../data/houses.js';
import * as score from '../data/score.js';
import { packGraph, unpackGraph, staticTable } from '../sim/save-graph.js';
import { World } from '../sim/world.js';
import { generateMap, mapOptions } from '../sim/mapgen.js';
import { MapState } from '../sim/map-state.js';
import { PathService, Pathfinder } from '../sim/pathfinding.js';
import { SpatialHash } from '../sim/spatial.js';
import { RNG } from '../sim/rng.js';
import { AIPlayer } from '../ai/ai.js';
import { isTutorial } from '../sim/tutorial.js';
import { GAME_VERSION } from '../config.js';

/** Bumped when a save's layout changes in a way older saves cannot follow. */
export const SAVE_FORMAT = 1;

// The pathfinder's scratch buffers (a few hundred KB on a big map) hold nothing between searches.
const PATHFINDER_SCRATCH = ['g', 'parent', 'openGen', 'closedGen', 'goalGen', 'heapIdx', 'heapF'];

const CLASSES = {
  // onCommand is the replay recorder's hook (src/game/replay.js), a function: the loaded game has none.
  // _bgrid is a lookup grid of the buildings (sim/building-grid.js), rebuilt on demand.
  World: { cls: World, skip: ['onCommand', '_bgrid'], revive(w) { w.onCommand = null; w._bgrid = null; } },
  MapState,
  PathService,
  Pathfinder: {
    cls: Pathfinder,
    skip: [...PATHFINDER_SCRATCH, 'gen', 'heapSize'],
    revive(pf) {
      const fresh = new Pathfinder(pf.w, pf.h);
      for (const k of [...PATHFINDER_SCRATCH, 'gen', 'heapSize']) pf[k] = fresh[k];
    },
  },
  SpatialHash,
  RNG,
  AIPlayer,
};

let codeStatics = null;
/** Everything the game's code owns (data tables, config): stored by name, never copied. */
function codeTable() {
  if (!codeStatics) codeStatics = staticTable({ config, data, upgrades, ranks, powers, relics, walls, houses, score });
  return codeStatics;
}

/** The statics of one match: the code's plus its generated map and its setup. */
function matchStatics(mapData) {
  const t = new Map(codeTable());
  for (const [obj, name] of staticTable({ map: mapData })) if (!t.has(obj)) t.set(obj, name);
  return t;
}

/** Can this match be saved? Single-player games against the computer, not the guided first match. */
export function canSaveSetup(setup) {
  return !!setup && !isTutorial(setup) && Array.isArray(setup.players) && setup.players.filter((p) => p.kind !== 'ai').length === 1;
}

/**
 * Pack a running match.
 * @param {World} world
 * @param {Map<number, { ai?: AIPlayer }>} ais the session's AI controllers by player index
 * @param {object} [extra] JSON data that rides along (camera, control groups, …)
 */
export function packMatch(world, ais, extra = {}) {
  const minds = [];
  for (const [index, c] of ais || []) if (c && c.ai) minds.push([index, c.ai]);
  const root = { world, minds };
  const graph = packGraph(root, { classes: CLASSES, statics: matchStatics(world.mapData) });
  return {
    format: SAVE_FORMAT,
    version: GAME_VERSION,
    setup: world.setup,
    tick: world.tickCount,
    graph,
    extra,
  };
}

/** Rebuild a match from packMatch's data: { world, ais (Map index -> { ai, tick }), extra }. */
export function unpackMatch(save) {
  if (!save || save.format !== SAVE_FORMAT || !save.setup || !save.graph) throw new Error('This saved game is from another version of the game and cannot be loaded.');
  const mapData = generateMap(mapOptions(save.setup));
  const root = unpackGraph(save.graph, { classes: CLASSES, statics: matchStatics(mapData) });
  const world = root.world;
  if (!(world instanceof World)) throw new Error('This saved game is damaged.');
  const ais = new Map();
  for (const [index, ai] of root.minds) ais.set(index, { ai, tick: () => ai.tick() });
  return { world, ais, extra: save.extra || {} };
}
