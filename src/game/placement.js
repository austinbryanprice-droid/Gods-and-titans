// Client-side building placement check (DESIGN 5.3), used for the green / red
// ghost while placing a building. Mirrors the sim's canPlace() with only what
// the local player knows: the terrain as seen (trees felled in the fog still
// stand until seen), explored tiles, gold mines,
// own / allied buildings, enemy buildings that are visible or remembered, and
// visible enemy / neutral ground units. In a Decade of Peace the enemy Town Centers
// I know keep the ground around them clear too (sim/peace.js). Pure: runs in Node tests.
import { TERRAIN, DROPOFF_MINE_GAP, WALL_PLACE_RANGE } from '../config.js';
import { BUILDINGS, UNITS, GOLD_MINE } from '../data/index.js';
import { wallLine } from '../data/walls.js';
import { PEACE_ANCHOR, peaceBlocksFootprint, peaceBuildNotice } from '../sim/peace.js';

/** Minimum Chebyshev gap (empty tiles) between a drop-off (Town Center, Storehouse) and a gold mine. */
export const MINE_GAP = DROPOFF_MINE_GAP;
/** @deprecated same as MINE_GAP (it applies to every drop-off now). */
export const TC_MINE_GAP = DROPOFF_MINE_GAP;

/** Error texts, identical to the sim's (UNEXPLORED excepted: the sim does not know the fog). */
export const CANT_BUILD = "Can't build there.";
export const TOO_CLOSE_TO_MINE = 'Too close to a gold mine.';
export const TREES_IN_WAY = 'Trees in the way.';
export const BUILDING_IN_WAY = 'Another building is in the way.';
export const MINE_IN_WAY = 'A gold mine is in the way.';
export const UNIT_IN_WAY = 'Something is in the way.';
export const UNEXPLORED = 'Unexplored ground.';
export const WALL_THERE = 'The wall is already there.';
export const WALL_TOO_FAR = 'Too far from your Worshippers.';

const WALKABLE = new Set([TERRAIN.GRASS, TERRAIN.DIRT, TERRAIN.SAND]);

function distPointRect(px, py, x0, y0, x1, y1) {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
  return Math.hypot(dx, dy);
}

/**
 * Footprints that block placement: [{ tx, ty, size, mine, wall, joins }]. wall: one of my own wall
 * segments (a tower may be raised over it); joins: my own wall segment or a tower that joined
 * the wall (a dragged wall skips the tile).
 */
function knownFootprints(vs, planned) {
  const out = [];
  for (const p of planned || []) {
    const def = p && BUILDINGS[p.b];
    if (def) out.push({ tx: p.tx, ty: p.ty, size: def.size, mine: false, wall: !!def.wall, joins: !!(def.wall || def.joinsWalls) });
  }
  for (const e of vs.entities.values()) {
    if (e.k === 'm') {
      out.push({ tx: e.tx, ty: e.ty, size: GOLD_MINE.size, mine: true });
      continue;
    }
    if (e.k !== 'b') continue;
    // Enemy buildings only when seen (no information leak through the ghost).
    if (vs.isEnemy(e.o) && !(vs.lastSeen && vs.lastSeen.has(e.id)) && !vs.isEntityVisible(e)) continue;
    const d = BUILDINGS[e.t];
    const mine = e.o === vs.myIndex;
    out.push({ tx: e.tx, ty: e.ty, size: (d && d.size) || 2, mine: false, wall: mine && !!(d && d.wall), joins: mine && !!(d && (d.wall || d.joinsWalls)) });
  }
  if (vs.lastSeen) {
    for (const [id, ls] of vs.lastSeen) {
      if (vs.entities.has(id)) continue; // already counted from the live view
      out.push({ tx: ls.tx, ty: ls.ty, size: (BUILDINGS[ls.t] && BUILDINGS[ls.t].size) || 2, mine: false });
    }
  }
  return out;
}

/**
 * The enemy Town Centers I know of while the Decade of Peace lasts, [{ tx, ty, size }]: the ground
 * around each stays clear of building (sim/peace.js peaceBlocksFootprint). Like the enemy buildings
 * that block a site, only those in sight or remembered count; the sim knows them all and has the
 * last word. Empty in a normal game and once the peace is over.
 */
export function peaceAnchors(vs) {
  const out = [];
  if (!vs.peaceActive()) return out;
  const size = BUILDINGS[PEACE_ANCHOR].size;
  for (const e of vs.entities.values()) {
    if (e.k !== 'b' || e.t !== PEACE_ANCHOR || !vs.isEnemy(e.o)) continue;
    if (!(vs.lastSeen && vs.lastSeen.has(e.id)) && !vs.isEntityVisible(e)) continue;
    out.push({ tx: e.tx, ty: e.ty, size });
  }
  if (vs.lastSeen) {
    for (const [id, ls] of vs.lastSeen) {
      if (ls.t === PEACE_ANCHOR && !vs.entities.has(id)) out.push({ tx: ls.tx, ty: ls.ty, size });
    }
  }
  return out;
}

/**
 * Can `playerIndex` place `buildingTypeId` with its footprint top-left at (tx, ty)?
 * @param {object} vs ViewState
 * @param {number} playerIndex
 * @param {string} buildingTypeId
 * @param {number} tx
 * @param {number} ty
 * @param {{ b: string, tx: number, ty: number }[]} [planned] my own buildings ordered but not placed yet
 *   (Shift-queued in this placement, workers' pending builds): they block like buildings
 * @returns {{ valid: boolean, tiles: boolean[], size: number, message: string|null, peace: boolean }} tiles:
 *   size×size row-major, true = this tile is fine; message: null when valid, else the reason, in this order
 *   of preference: UNEXPLORED (fog; checked before the terrain so the text does not tell what lies in it),
 *   CANT_BUILD (water, rock, map edge), TREES_IN_WAY, BUILDING_IN_WAY, MINE_IN_WAY, UNIT_IN_WAY,
 *   the Decade of Peace's notice (near an enemy Town Center; peace is true then), TOO_CLOSE_TO_MINE (the
 *   mine gap alone). The sim words the same reasons the same way.
 */
export function checkPlacement(vs, playerIndex, buildingTypeId, tx, ty, planned = null) {
  const def = typeof buildingTypeId === 'string' && Object.hasOwn(BUILDINGS, buildingTypeId) ? BUILDINGS[buildingTypeId] : null;
  if (!def || !Number.isFinite(tx) || !Number.isFinite(ty)) return { valid: false, tiles: [], size: 0, message: CANT_BUILD, peace: false };
  return checkFootprint(vs, def, Math.floor(tx), Math.floor(ty), knownFootprints(vs, planned), peaceAnchors(vs));
}

/** checkPlacement for a known building def, with the blocking footprints and kept-clear Town Centers worked out once. */
function checkFootprint(vs, def, tx, ty, footprints, anchors) {
  const s = def.size;
  const tiles = new Array(s * s).fill(true);
  const map = vs.map;
  const terrain = vs.seenTerrain || map.terrain;
  const W = map.width;
  const H = map.height;

  // Terrain, bounds and fog. Fog comes first: what lies in it is not known yet.
  let fog = false;
  let hardTerrain = false;
  let trees = false;
  for (let dy = 0; dy < s; dy++) {
    for (let dx = 0; dx < s; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      let ok = x >= 0 && y >= 0 && x < W && y < H;
      if (ok) {
        const i = y * W + x;
        if (vs.explored && !vs.revealAll && vs.explored[i] !== 1) {
          ok = false;
          fog = true;
        } else if (!WALKABLE.has(terrain[i])) {
          ok = false;
          if (terrain[i] === TERRAIN.FOREST) trees = true;
          else hardTerrain = true;
        }
      } else hardTerrain = true;
      if (!ok) tiles[dy * s + dx] = false;
    }
  }

  // Buildings and mines (drop-offs also keep MINE_GAP empty tiles from every mine).
  const gapped = !!def.dropOff;
  let otherProblem = tiles.some((ok) => !ok);
  let mineProblem = false;
  let buildingBlock = false;
  let mineBlock = false;
  let unitBlock = false;
  for (const f of footprints) {
    if (f.wall && def.joinsWalls) continue; // a tower is raised over my own wall segments
    const fx1 = f.tx + f.size;
    const fy1 = f.ty + f.size;
    const reach = gapped && f.mine ? MINE_GAP : 0;
    if (f.tx - reach >= tx + s || fx1 + reach <= tx || f.ty - reach >= ty + s || fy1 + reach <= ty) continue;
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        // Chebyshev gap between this tile and the footprint (0 = overlapping or touching inside).
        const gx = Math.max(f.tx - (x + 1), x - fx1, 0);
        const gy = Math.max(f.ty - (y + 1), y - fy1, 0);
        const inside = x >= f.tx && x < fx1 && y >= f.ty && y < fy1;
        if (inside) {
          otherProblem = true;
          if (f.mine) mineBlock = true;
          else buildingBlock = true;
        } else if (reach > 0 && Math.max(gx, gy) < reach) mineProblem = true;
        if (inside || (reach > 0 && Math.max(gx, gy) < reach)) tiles[dy * s + dx] = false;
      }
    }
  }

  // Visible enemy and neutral ground units (own and allied units get pushed out).
  for (const e of vs.entities.values()) {
    if (e.k !== 'u') continue;
    if (e.o >= 0 && !vs.isEnemy(e.o)) continue; // own / allied
    const ud = UNITS[e.t];
    if (!ud || ud.air) continue;
    if (!vs.isEntityVisible(e)) continue;
    const r = (ud.radius || 0.4) * 0.8;
    if (distPointRect(e.x, e.y, tx, ty, tx + s, ty + s) >= r) continue;
    otherProblem = true;
    unitBlock = true;
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) {
        if (distPointRect(e.x, e.y, tx + dx, ty + dy, tx + dx + 1, ty + dy + 1) < r) tiles[dy * s + dx] = false;
      }
    }
  }

  // Decade of Peace: the ground around an enemy Town Center stays clear until the peace is over.
  let peaceBlock = false;
  if (anchors.length) {
    for (let dy = 0; dy < s; dy++) {
      for (let dx = 0; dx < s; dx++) {
        if (!peaceBlocksFootprint(anchors, tx + dx, ty + dy, 1)) continue;
        tiles[dy * s + dx] = false;
        peaceBlock = true;
      }
    }
  }

  const valid = tiles.every(Boolean);
  let message = null;
  let peace = false;
  if (!valid) {
    if (fog) message = UNEXPLORED;
    else if (hardTerrain) message = CANT_BUILD;
    else if (trees) message = TREES_IN_WAY;
    else if (buildingBlock) message = BUILDING_IN_WAY;
    else if (mineBlock) message = MINE_IN_WAY;
    else if (unitBlock) message = UNIT_IN_WAY;
    else if (peaceBlock) {
      message = peaceBuildNotice(vs.peaceLeft());
      peace = true;
    } else message = mineProblem && !otherProblem ? TOO_CLOSE_TO_MINE : CANT_BUILD;
  }
  return { valid, tiles, size: s, message, peace };
}

/**
 * What a wall dragged from tile (x0, y0) towards (x1, y1) would do (the sim's issueBuildLine):
 * every tile of data/walls.js wallLine as 'build' (a segment will be raised there), 'held' (my
 * wall, or a tower joined to it, already stands there: skipped and free) or 'blocked' (cannot be
 * built on, or is more than WALL_PLACE_RANGE from every one of `workers`: left out, with the
 * reason). The segments to build are paid for together.
 * @param {{ x: number, y: number }[]|null} [workers] the worshippers the line would be ordered to; null
 *   when there are none to tell, which leaves the range out
 * @returns {{ tiles: { tx: number, ty: number, state: string, message: string|null }[], build: number,
 *   cost: { gold: number, wood: number, faith: number }, message: string|null }} message: null when at
 *   least one segment can be raised, else why not
 */
export function checkWallLine(vs, playerIndex, typeId, x0, y0, x1, y1, planned = null, workers = null) {
  const def = typeof typeId === 'string' && Object.hasOwn(BUILDINGS, typeId) ? BUILDINGS[typeId] : null;
  const none = { tiles: [], build: 0, cost: { gold: 0, wood: 0, faith: 0 }, message: CANT_BUILD };
  if (!def || !def.wall || ![x0, y0, x1, y1].every(Number.isFinite)) return none;
  const footprints = knownFootprints(vs, planned);
  const anchors = peaceAnchors(vs);
  const held = (tx, ty) => footprints.some((f) => f.joins && tx >= f.tx && tx < f.tx + f.size && ty >= f.ty && ty < f.ty + f.size);
  const inReach = (tx, ty) => !workers || workers.some((w) => Math.hypot(w.x - (tx + 0.5), w.y - (ty + 0.5)) <= WALL_PLACE_RANGE);
  const tiles = [];
  let build = 0;
  let reason = null;
  for (const [tx, ty] of wallLine(x0, y0, x1, y1)) {
    if (held(tx, ty)) {
      tiles.push({ tx, ty, state: 'held', message: null });
      continue;
    }
    if (!inReach(tx, ty)) {
      reason = reason || WALL_TOO_FAR;
      tiles.push({ tx, ty, state: 'blocked', message: WALL_TOO_FAR });
      continue;
    }
    const chk = checkFootprint(vs, def, tx, ty, footprints, anchors);
    if (chk.valid) build++;
    else reason = reason || chk.message;
    tiles.push({ tx, ty, state: chk.valid ? 'build' : 'blocked', message: chk.message });
  }
  const cost = { gold: def.cost.gold * build, wood: def.cost.wood * build, faith: def.cost.faith * build };
  return { tiles, build, cost, message: build ? null : reason || WALL_THERE };
}

/**
 * Footprint top-left for a building centred under the cursor at world (x, y).
 * @returns {{ tx: number, ty: number }}
 */
export function footprintAt(buildingTypeId, x, y) {
  const def = BUILDINGS[buildingTypeId];
  const s = def ? def.size : 1;
  return { tx: Math.round(x - s / 2), ty: Math.round(y - s / 2) };
}
