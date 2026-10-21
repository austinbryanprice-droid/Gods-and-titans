// Wall helpers shared by the simulation, the HUD and the 3D view (pure, no DOM):
// which building types are wall segments, the tiles of a dragged line, and which
// neighbours a segment joins. DESIGN 4.3 and 5.3.
import { MAX_WALL_LINE } from '../config.js';
import { BUILDINGS } from './buildings.js';

/** Neighbour bits of a wall segment's connection mask. */
export const WALL_N = 1;
export const WALL_E = 2;
export const WALL_S = 4;
export const WALL_W = 8;

// (dx, dy) of the four neighbours, in the order of the bits above (y grows towards the south).
const NEIGHBOURS = [[0, -1, WALL_N], [1, 0, WALL_E], [0, 1, WALL_S], [-1, 0, WALL_W]];

/** Is this building type id a wall segment? */
export function isWallType(typeId) {
  return typeof typeId === 'string' && Object.hasOwn(BUILDINGS, typeId) && BUILDINGS[typeId].wall === true;
}

/** The upgrade a wall segment type has ({ to, cost, time }), or null. */
export function wallUpgradeOf(typeId) {
  return isWallType(typeId) && BUILDINGS[typeId].wallUpgrade ? BUILDINGS[typeId].wallUpgrade : null;
}

// The eight directions of a dragged line, by sector of 45 degrees counted from east.
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/**
 * The tiles of a wall dragged from tile (x0, y0) towards tile (x1, y1): a straight line in the
 * nearest of eight directions, as long as the drag is in that direction. Diagonals are stepped
 * so that every tile touches the next one along an edge (a diagonal wall has no gap a unit
 * could squeeze through). At most MAX_WALL_LINE tiles; the start tile comes first.
 * @returns {Array<[number, number]>}
 */
export function wallLine(x0, y0, x1, y1) {
  x0 = Math.floor(x0);
  y0 = Math.floor(y0);
  const dx = Math.floor(x1) - x0;
  const dy = Math.floor(y1) - y0;
  const out = [[x0, y0]];
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return out;
  const sector = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  const [sx, sy] = DIRS[sector];
  if (sx === 0 || sy === 0) {
    const n = Math.min(Math.abs(sx * dx + sy * dy), MAX_WALL_LINE - 1);
    for (let i = 1; i <= n; i++) out.push([x0 + sx * i, y0 + sy * i]);
    return out;
  }
  const steps = Math.round((sx * dx + sy * dy) / 2);
  for (let i = 1; i <= steps && out.length < MAX_WALL_LINE; i++) {
    out.push([x0 + sx * i, y0 + sy * (i - 1)]); // the corner tile that joins the two diagonal tiles
    if (out.length < MAX_WALL_LINE) out.push([x0 + sx * i, y0 + sy * i]);
  }
  return out;
}

/**
 * Connection mask of the segment at (tx, ty): which of its four neighbours hold part of the
 * wall (another segment, or a tower that joined it).
 * @param {(tx: number, ty: number) => boolean} joins
 */
export function wallMask(tx, ty, joins) {
  let mask = 0;
  for (const [dx, dy, bit] of NEIGHBOURS) if (joins(tx + dx, ty + dy)) mask |= bit;
  return mask;
}

/** In a connection mask the bits WALL_N..WALL_W shifted up by this many mark the neighbours that are towers. */
export const WALL_TOWER_SHIFT = 4;

/**
 * Connection mask for drawing the segment at (tx, ty): the low four bits are wallMask, the next four
 * (WALL_TOWER_SHIFT) say which of those neighbours is a tower rather than another segment (the
 * wall reaches into a tower, which stands well inside its footprint).
 * @param {(tx: number, ty: number) => number} kindAt 0 nothing of this wall there, 1 a segment, 2 a tower
 */
export function wallConnections(tx, ty, kindAt) {
  let mask = 0;
  for (const [dx, dy, bit] of NEIGHBOURS) {
    const kind = kindAt(tx + dx, ty + dy);
    if (kind) mask |= bit | (kind === 2 ? bit << WALL_TOWER_SHIFT : 0);
  }
  return mask;
}
