// Decade of Peace (game mode): until the peace runs out, no player may harm
// another player, their units or their buildings, with weapons or with spells,
// and nobody may build near an enemy Town Center. Neutral creatures stay fair
// game. The rules themselves live in World.canHarm / World.peaceBlocks /
// World.peaceBuildBlocks (the sim) and in ViewState.peaceLeft and
// game/placement.js (the HUD and the placement ghost); the helpers here are the
// parts both sides share.
import { PEACE_BUILD_GAP, PEACE_LENGTHS, PEACE_NAME } from '../config.js';

/** The building type that keeps ground clear around it while the peace lasts. */
export const PEACE_ANCHOR = 'town_center';

/** Length of the peace in seconds for a GameSetup (0 = a normal game). Only the lobby's lengths count. */
export function peaceSeconds(setup) {
  const minutes = setup ? setup.peaceMinutes : 0;
  return PEACE_LENGTHS.includes(minutes) ? minutes * 60 : 0;
}

/** m:ss (or h:mm:ss) for a number of seconds, rounded up so "0:00" only shows once the peace is over. */
export function peaceClock(sec) {
  const s = Math.max(0, Math.ceil((sec || 0) - 1e-6));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The error a player gets for an order that peace turns into a plain move. */
export function peaceNotice(left) {
  return `The ${PEACE_NAME} holds for another ${peaceClock(left)}: no attacking yet.`;
}

/** The reason a building site is refused inside the ground an enemy Town Center keeps clear. */
export function peaceBuildNotice(left) {
  return `The ${PEACE_NAME} holds for another ${peaceClock(left)}: no building near an enemy Town Center yet.`;
}

/**
 * Is a footprint (top-left tile (tx, ty), `size` tiles a side; a single tile is size 1) within
 * PEACE_BUILD_GAP empty tiles of one of these Town Centers ({ tx, ty, size } each)? The gap is
 * the straight distance between the nearest tiles of the two footprints (0 when they touch), so
 * the ground kept clear is a square around each Town Center with rounded corners.
 */
export function peaceBlocksFootprint(centers, tx, ty, size) {
  const limit = PEACE_BUILD_GAP * PEACE_BUILD_GAP;
  for (const c of centers) {
    const gx = Math.max(c.tx - (tx + size), tx - (c.tx + c.size), 0);
    const gy = Math.max(c.ty - (ty + size), ty - (c.ty + c.size), 0);
    if (gx * gx + gy * gy < limit) return true;
  }
  return false;
}
