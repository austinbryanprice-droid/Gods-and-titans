// Test helpers for the simulation: synthetic MapData, setups, worlds and
// test-only unit types registered into the data registry.
import { World } from '../../src/sim/world.js';
import { TERRAIN, TREE_WOOD, GOLD_MINE_AMOUNT, TICK_RATE } from '../../src/config.js';
import { UNITS, MORTALS } from '../../src/data/index.js';

/**
 * Build a synthetic MapData (DESIGN 6.7).
 * opts: { width, height, forest: [rects], water: [rects], rock: [rects], starts, mines, camps }
 * rect = { x, y, w, h } in tiles.
 */
export function makeMap(opts = {}) {
  const width = opts.width ?? 48;
  const height = opts.height ?? 48;
  const terrain = new Uint8Array(width * height).fill(TERRAIN.GRASS);
  const wood = new Uint16Array(width * height);
  const fill = (rects, code) => {
    for (const r of rects || []) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          terrain[y * width + x] = code;
          wood[y * width + x] = code === TERRAIN.FOREST ? TREE_WOOD : 0;
        }
      }
    }
  };
  fill(opts.forest, TERRAIN.FOREST);
  fill(opts.water, TERRAIN.WATER);
  fill(opts.rock, TERRAIN.ROCK);
  const starts = opts.starts ?? [{ x: 6, y: 6 }, { x: width - 10, y: height - 10 }];
  const mines = opts.mines ?? starts.map((s) => ({ tx: s.x + 7, ty: s.y, amount: GOLD_MINE_AMOUNT }));
  return {
    width,
    height,
    seed: 1,
    terrain,
    heights: new Float32Array((width + 1) * (height + 1)),
    wood,
    starts,
    mines,
    camps: opts.camps ?? [],
    decor: [],
  };
}

const PANTHEONS = ['greek', 'norse', 'egyptian', 'hindu'];

/** GameSetup with n players on teams [1, 2, ...] unless teams given. */
export function makeSetup(n = 2, opts = {}) {
  const teams = opts.teams ?? Array.from({ length: n }, (_, i) => i + 1);
  const setup = {
    version: '0.1.0',
    seed: opts.seed ?? 12345,
    mapSize: 'small',
    players: Array.from({ length: n }, (_, i) => ({
      index: i,
      name: `P${i}`,
      team: teams[i],
      pantheon: (opts.pantheons && opts.pantheons[i]) || PANTHEONS[i % PANTHEONS.length],
      color: '#d63a3a',
      kind: i === 0 ? 'human' : 'ai',
      difficulty: i === 0 ? null : 'normal',
    })),
  };
  if (opts.peaceMinutes) setup.peaceMinutes = opts.peaceMinutes; // Decade of Peace
  return setup;
}

/** A World on a synthetic map. opts: { players, teams, map: makeMap opts, seed, peaceMinutes } */
export function makeWorld(opts = {}) {
  const n = opts.players ?? 2;
  const mapOpts = { ...(opts.map || {}) };
  if (!mapOpts.starts && n > 2) {
    const w = mapOpts.width ?? 48;
    const h = mapOpts.height ?? 48;
    mapOpts.starts = [{ x: 6, y: 6 }, { x: w - 10, y: h - 10 }, { x: w - 10, y: 6 }, { x: 6, y: h - 10 }].slice(0, n);
  }
  const map = makeMap(mapOpts);
  return new World(makeSetup(n, opts), map);
}

/** Advance the world by seconds (rounded to ticks). */
export function run(world, seconds) {
  const n = Math.round(seconds * TICK_RATE);
  for (let i = 0; i < n; i++) world.tick();
}

/** Tick (at least once) until pred() is true or maxSeconds pass. Returns seconds elapsed or -1. */
export function runUntil(world, pred, maxSeconds = 60) {
  const n = Math.round(maxSeconds * TICK_RATE);
  for (let i = 1; i <= n; i++) {
    world.tick();
    if (pred()) return i / TICK_RATE;
  }
  return -1;
}

/** Tick for seconds and collect every event emitted. */
export function runCollect(world, seconds) {
  const events = [];
  const n = Math.round(seconds * TICK_RATE);
  for (let i = 0; i < n; i++) {
    world.tick();
    events.push(...world.events);
    world.events.length = 0;
  }
  return events;
}

/** Spawn a unit (no spawn event noise). */
export function spawn(world, owner, type, x, y, opts = {}) {
  const u = world.spawnUnit(owner, type, x, y, { silent: true, ...opts });
  world.hash.rebuild(world.unitList);
  return u;
}

/** Place a building (complete by default). */
export function place(world, owner, type, tx, ty, constructed = true) {
  const b = world.createBuilding(owner, type, tx, ty, constructed, true);
  if (constructed) world.completeBuilding(b);
  world.events.length = 0;
  return b;
}

/** Remove every unit of a player (e.g. start workers) without events. */
export function clearUnits(world, owner) {
  for (const u of world.unitList) if (u.owner === owner) u.dead = true;
  world.cleanup();
  world.recomputePop();
  world.hash.rebuild(world.unitList);
}

let testTypeSeq = 0;

/**
 * Register a test-only unit type based on the warrior, with overrides.
 * Returns its id.
 */
export function defineUnit(overrides = {}) {
  const id = overrides.id || `test_unit_${++testTypeSeq}`;
  const base = MORTALS.warrior;
  UNITS[id] = {
    ...base,
    attack: base.attack ? { ...base.attack } : null,
    visual: { ...base.visual },
    abilities: [],
    passives: [],
    ...overrides,
    id,
  };
  return id;
}

/** A minimal ability with one or more effects. */
export function ability(id, effects, extra = {}) {
  return {
    id, name: id, key: 'Q', unlockLevel: 1, autocast: false, cooldown: 10, target: 'point', range: 8, castTime: 0,
    effects, vfx: { element: 'fire', shape: 'nova' }, ai: { use: 'damage' }, icon: '*', description: id, ...extra,
  };
}

export function eventsOf(events, type) {
  return events.filter((e) => e.type === type);
}

export function errorsOf(events, player = 0) {
  return events.filter((e) => e.type === 'error' && e.player === player).map((e) => e.message);
}
