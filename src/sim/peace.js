// Decade of Peace (game mode): until the peace runs out, no player may harm
// another player, their units or their buildings, with weapons or with spells.
// Neutral creatures stay fair game. The rule itself lives in World.canHarm /
// World.peaceBlocks (the sim) and in ViewState.peaceLeft (the HUD); the
// helpers here are the parts both sides share.
import { PEACE_LENGTHS, PEACE_NAME } from '../config.js';

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
