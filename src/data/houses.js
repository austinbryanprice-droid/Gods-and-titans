// Houses and Manors (DESIGN 4.3, 5.3): four Houses that stand in a square (a 2x2 block, so 4x4 tiles)
// are combined into one Manor, an upgrade in place (sim/homes.js). Pure helpers the sim, the HUD and
// the data share, like data/walls.js.
import { BUILDINGS } from './buildings.js';

/** The building the Houses combine into. */
export const MANOR = 'manor';

/** The Manor's merge rule: { building, count, cost, time } (`mergesFrom` in data/buildings.js). */
export function mergeRule() {
  return BUILDINGS[MANOR].mergesFrom;
}

/** The building type whose upgrades a type researches: a Manor takes the House upgrades, every other type its own. */
export function researchHostOf(typeId) {
  const def = typeof typeId === 'string' && Object.hasOwn(BUILDINGS, typeId) ? BUILDINGS[typeId] : null;
  return def && def.mergesFrom ? def.mergesFrom.building : typeId;
}

/** Why a selection cannot be combined (the sim's error and the command card's reason, word for word). */
export const MERGE_TEXT = {
  few: 'Select four Houses that stand together in a square.',
  shape: 'Those Houses do not make a square, two by two.',
  busy: 'A House in the square is busy: wait for its research or upgrade to finish.',
};

/**
 * The squares of four Houses among `houses`: every 2x2 block of Houses that touch edge to edge, so that
 * together they cover a square of tiles. Blocks never share a House: they are picked in row order (the
 * top row first, left to right), each the first whole block the Houses still left make. Other Houses
 * may stand anywhere; only the blocks matter.
 * @param {{ id: number, tx: number, ty: number }[]} houses footprints as (top-left tile)
 * @returns {{ tx: number, ty: number, ids: number[] }[]} tx, ty: the square's top-left tile; ids: the
 *   top-left, top-right, bottom-left and bottom-right House
 */
export function houseBlocks(houses) {
  const s = BUILDINGS.house.size;
  const at = new Map();
  for (const h of houses) at.set(`${h.tx},${h.ty}`, h);
  const order = houses.slice().sort((a, b) => a.ty - b.ty || a.tx - b.tx || a.id - b.id);
  const used = new Set();
  const out = [];
  for (const a of order) {
    if (used.has(a.id)) continue;
    const b = at.get(`${a.tx + s},${a.ty}`);
    const c = at.get(`${a.tx},${a.ty + s}`);
    const d = at.get(`${a.tx + s},${a.ty + s}`);
    if (!b || !c || !d || used.has(b.id) || used.has(c.id) || used.has(d.id)) continue;
    for (const h of [a, b, c, d]) used.add(h.id);
    out.push({ tx: a.tx, ty: a.ty, ids: [a.id, b.id, c.id, d.id] });
  }
  return out;
}

/**
 * What combining these Houses (finished and the player's own; `busy`: researching or already being
 * combined) comes to: the blocks that can start now, or why none can (a MERGE_TEXT key).
 * @param {{ id: number, tx: number, ty: number, busy?: boolean }[]} houses
 * @returns {{ blocks: { tx: number, ty: number, ids: number[] }[], reason: string|null }}
 */
export function planMerges(houses) {
  const blocks = houseBlocks(houses.filter((h) => !h.busy));
  if (blocks.length) return { blocks, reason: null };
  if (houseBlocks(houses).length) return { blocks, reason: 'busy' };
  return { blocks, reason: houses.length < mergeRule().count ? 'few' : 'shape' };
}
